// 数据层 · 写队列（data/outbox.js）：顺序重放、合并、指数退避、永久失败可见可重试 / 放弃、持久化恢复、撤销窗口。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, backoffDelay, OP_PREFIX } from '../../src/data/outbox.js';
import { createMemoryKv } from '../../src/data/kv.js';
import { DataError } from '../../src/data/errors.js';
import { fakeClock, settle } from './helpers/data.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = 'demo-island';

/** 可控的“后台”：按顺序记录收到的 op；behaviour(op) 返回结果或抛错 */
function fakeSend(behaviour = () => ({ row: null })) {
  const sent = [];
  const send = async (op) => {
    sent.push(op);
    return behaviour(op, sent.length);
  };
  return { sent, send };
}

function make(o = {}) {
  const clock = o.clock || fakeClock();
  const kv = o.kv || createMemoryKv();
  const { sent, send } = o.fake || fakeSend(o.behaviour);
  let online = o.online ?? true;
  const applied = [];
  const ob = createOutbox({
    kv, send, getUserId: () => U, now: clock.now, timers: clock.timers, random: () => 0.5,
    isOnline: () => online, onApplied: (e) => applied.push(e),
  });
  return { ob, clock, kv, sent, applied, setOnline: (v) => { online = v; } };
}

const ins = (key, row = {}) => ({ tripId: T, table: 'expenses', kind: 'insert', key, match: { id: key }, row: { id: key, amount: 1, ...row } });
const upd = (key, patch) => ({ tripId: T, table: 'expenses', kind: 'update', key, match: { id: key }, patch });
const del = (key, extra = {}) => ({ tripId: T, table: 'todos', kind: 'delete', key, match: { id: key }, ...extra });

test('退避时间：1s、2s、4s…封顶 60s，带 0.8–1.2 的抖动', () => {
  assert.equal(backoffDelay(1, () => 0.5), 1000);
  assert.equal(backoffDelay(2, () => 0.5), 2000);
  assert.equal(backoffDelay(3, () => 0.5), 4000);
  assert.equal(backoffDelay(10, () => 0.5), 60000);
  assert.equal(backoffDelay(1, () => 0), 800);
  assert.equal(backoffDelay(1, () => 1), 1200);
});

test('进队后立即通知、写进存储，并按进队顺序一条一条发送；成功后从存储删除', async () => {
  const { ob, clock, kv, sent, applied } = make();
  await ob.load(U);
  const changed = [];
  ob.subscribe((e) => changed.push(...e.rows.map((r) => r.key)));
  const a = ob.enqueue(ins('a'));
  const b = ob.enqueue(upd('x', { amount: 2 }));
  assert.deepEqual(changed, ['a', 'x'], '进队时同步通知（乐观更新马上能显示）');
  await a.saved;
  await b.saved;
  assert.equal((await kv.keys(OP_PREFIX)).length, 2, '每条一个键');
  await clock.advance(0);
  assert.deepEqual(sent.map((o) => o.key), ['a', 'x']);
  assert.equal(ob.pendingCount(), 0);
  assert.equal((await kv.keys(OP_PREFIX)).length, 0);
  assert.equal(applied.length, 2);
  assert.deepEqual(await a.synced, { ok: true, row: null, result: { row: null } });
});

test('和队尾同一行时合并：insert + update → 一条 insert；update + update → 一条 update', async () => {
  const { ob, clock, sent } = make();
  await ob.load(U);
  ob.enqueue(ins('a', { amount: 1 }));
  const r = ob.enqueue(upd('a', { amount: 5, description: '改过' }));
  assert.equal(r.merged, true);
  assert.equal(ob.ops.length, 1);
  assert.deepEqual(ob.ops[0].row, { id: 'a', amount: 5, description: '改过' });
  ob.enqueue(upd('b', { amount: 1 }));
  ob.enqueue(upd('b', { description: 'x' }));
  assert.equal(ob.ops.length, 2);
  assert.deepEqual(ob.ops[1].patch, { amount: 1, description: 'x' });
  await clock.advance(0);
  assert.equal(sent.length, 2);
  // 合并进去的那次调用也能等到结果
  assert.equal((await r.synced).ok, true);
});

test('只和队尾合并（中间隔着别的行时不合并，保证顺序语义）', async () => {
  const { ob } = make({ online: false });
  await ob.load(U);
  ob.enqueue(upd('a', { amount: 1 }));
  ob.enqueue(ins('b'));
  ob.enqueue(upd('a', { amount: 2 }));
  assert.deepEqual(ob.ops.map((o) => `${o.kind}:${o.key}`), ['update:a', 'insert:b', 'update:a']);
});

test('新建后还没发出去就删除：两条都不用发', async () => {
  const { ob, clock, sent } = make({ online: false });
  await ob.load(U);
  const created = ob.enqueue({ ...ins('t1'), table: 'todos' });
  const removed = ob.enqueue(del('t1'));
  assert.equal(removed.cancelled, true);
  assert.equal(ob.ops.length, 0);
  assert.deepEqual(await created.synced, { ok: false, cancelled: true });
  await clock.advance(1000);
  assert.equal(sent.length, 0);
});

test('暂时性失败（断网）：指数退避重试，标记离线；联网后（wake）立即重试成功', async () => {
  let fail = 3;
  const { ob, clock, sent } = make({
    behaviour: () => {
      if (fail-- > 0) throw new DataError('网络连接失败', { kind: 'network' });
      return { row: { id: 'a' } };
    },
  });
  await ob.load(U);
  const r = ob.enqueue(ins('a'));
  await clock.advance(0);
  assert.equal(sent.length, 1);
  assert.equal(ob.state.value.offline, true);
  assert.equal(ob.ops[0].attempts, 1);
  assert.equal(ob.state.value.nextAttemptAt, clock.now() + 1000);
  await clock.advance(999);
  assert.equal(sent.length, 1, '没到时间不重试');
  await clock.advance(1);
  assert.equal(sent.length, 2, '1 秒后第二次');
  await clock.advance(1999);
  assert.equal(sent.length, 2);
  await clock.advance(1);
  assert.equal(sent.length, 3, '再等 2 秒第三次');
  // 第三次也失败，下一次要等 4 秒；这时联网了 → 立即重试
  ob.wake();
  await clock.advance(0);
  assert.equal(sent.length, 4);
  assert.deepEqual((await r.synced).ok, true);
  assert.equal(ob.state.value.offline, false);
  assert.equal(ob.pendingCount(), 0);
});

test('永久性失败（没权限）：标成 failed、队列停住、给出可见的原因；重试成功后继续发后面的', async () => {
  let allow = false;
  const { ob, clock, sent } = make({
    behaviour: (op) => {
      if (op.key === 'a' && !allow) throw new DataError('没有权限做这个操作', { kind: 'permission', code: '42501' });
      return { row: { id: op.key } };
    },
  });
  await ob.load(U);
  const a = ob.enqueue({ ...ins('a'), label: '记一笔「午饭」' });
  ob.enqueue(ins('b'));
  await clock.advance(0);
  const st = ob.state.value;
  assert.equal(st.failed.label, '记一笔「午饭」');
  assert.equal(st.failed.error.message, '没有权限做这个操作');
  assert.equal(st.failed.error.kind, 'permission');
  assert.deepEqual(sent.map((o) => o.key), ['a'], '后面的不发');
  const res = await a.synced;
  assert.equal(res.ok, false);
  assert.equal(res.error.kind, 'permission');
  await clock.advance(120_000);
  assert.equal(sent.length, 1, '永久失败不会自动重试');
  allow = true;
  await ob.retry();
  await clock.advance(0);
  assert.deepEqual(sent.map((o) => o.key), ['a', 'a', 'b']);
  assert.equal(ob.state.value.failed, null);
});

test('放弃失败的那条：撤回它、继续发后面的', async () => {
  const { ob, clock, sent } = make({
    behaviour: (op) => {
      if (op.key === 'a') throw new DataError('内容不符合规则', { kind: 'validation', code: '23514' });
      return { row: { id: op.key } };
    },
  });
  await ob.load(U);
  ob.enqueue(ins('a'));
  ob.enqueue(ins('b'));
  await clock.advance(0);
  const failed = ob.state.value.failed;
  assert.ok(failed);
  const changed = [];
  ob.subscribe((e) => changed.push(...e.rows.map((r) => r.key)));
  assert.equal(await ob.discard(failed.id), true);
  assert.ok(changed.includes('a'), '通知 a 那一行重算（乐观更新被撤回）');
  await clock.advance(0);
  assert.deepEqual(sent.map((o) => o.key), ['a', 'b']);
  assert.equal(ob.pendingCount(), 0);
});

test('持久化：重新创建（相当于刷新页面）后从存储恢复队列，按原来的顺序重放', async () => {
  const kv = createMemoryKv();
  const first = make({ kv, online: false });
  await first.ob.load(U);
  first.ob.enqueue(ins('a'));
  first.ob.enqueue(upd('z', { amount: 9 }));
  const last = first.ob.enqueue(ins('c'));
  await last.saved;
  first.ob.dispose();

  const second = make({ kv });
  assert.equal(await second.ob.load(U), 3);
  assert.deepEqual(second.ob.ops.map((o) => o.key), ['a', 'z', 'c']);
  await second.clock.advance(0);
  assert.deepEqual(second.sent.map((o) => o.key), ['a', 'z', 'c']);
  assert.deepEqual(await kv.keys(OP_PREFIX), []);
});

test('只加载当前用户的改动（换了账号，别人的改动不会被发出去）', async () => {
  const kv = createMemoryKv();
  const a = make({ kv, online: false });
  await a.ob.load(U);
  await a.ob.enqueue(ins('mine')).saved;
  const b = createOutbox({ kv, send: async () => ({}), getUserId: () => 'other', isOnline: () => false });
  assert.equal(await b.load('other'), 0);
  assert.equal(await b.load(U), 1);
});

test('多个标签页：存储里已经没有的 op（别的标签页发过了）不会重复发送', async () => {
  const { ob, clock, kv, sent } = make({ online: false });
  await ob.load(U);
  await ob.enqueue(ins('a')).saved;
  await ob.enqueue(ins('b')).saved;
  const [firstKey] = await kv.keys(OP_PREFIX);
  await kv.del(firstKey);
  ob.wake();
  // 联网
  const online = make({ kv, fake: { sent, send: async (op) => { sent.push(op); return {}; } } });
  await online.ob.load(U);
  await online.clock.advance(0);
  assert.deepEqual(sent.map((o) => o.key), ['b']);
  void clock;
});

test('撤销窗口：notBefore 之前不发送，cancel() 撤销成功；不撤销则到时间发送', async () => {
  const { ob, clock, sent } = make();
  await ob.load(U);
  const r1 = ob.enqueue(del('t1', { notBefore: clock.now() + 5000 }));
  await clock.advance(4000);
  assert.equal(sent.length, 0);
  assert.equal(ob.state.value.held, 1);
  assert.equal(await ob.cancel(r1.op.id), true);
  assert.deepEqual(await r1.synced, { ok: false, cancelled: true });
  const r2 = ob.enqueue(del('t2', { notBefore: clock.now() + 5000 }));
  await clock.advance(5000);
  assert.deepEqual(sent.map((o) => o.key), ['t2']);
  assert.equal(await ob.cancel(r2.op.id), false, '发出去之后不能撤销');
});

test('撤销窗口里的删除会挡住后面的改动（严格顺序）；退出登录前 releaseHolds() 立即发送', async () => {
  const { ob, clock, sent } = make();
  await ob.load(U);
  ob.enqueue(del('t1', { notBefore: clock.now() + 5000 }));
  ob.enqueue(ins('e1'));
  await clock.advance(100);
  assert.equal(sent.length, 0);
  await ob.releaseHolds();
  await ob.flush();
  await clock.advance(0);
  assert.deepEqual(sent.map((o) => o.key), ['t1', 'e1']);
});

test('离线时不发送；drain() 返回还剩几条', async () => {
  const { ob, setOnline, sent } = make({ online: false });
  await ob.load(U);
  ob.enqueue(ins('a'));
  assert.equal(await ob.drain({ timeoutMs: 50 }), 1);
  assert.equal(ob.state.value.offline, true);
  assert.equal(sent.length, 0);
  setOnline(true);
  assert.equal(await ob.drain({ timeoutMs: 50 }), 0);
  assert.equal(sent.length, 1);
});

test('clear() 清空当前用户的队列和待上传的文件', async () => {
  const { ob, kv } = make({ online: false });
  await ob.load(U);
  await kv.set('blob:1', 'x');
  await ob.enqueue({ tripId: T, table: '_files', kind: 'upload', key: 'p', file: { path: 'p', blobKey: 'blob:1', contentType: 'image/jpeg' } }).saved;
  await ob.enqueue(ins('a')).saved;
  await ob.clear();
  assert.equal(ob.pendingCount(), 0);
  assert.deepEqual(await kv.keys(''), []);
  await settle();
});

test('remap：日记撞了唯一约束改写到已有那一行后，排在后面的同一行改动跟着换 id', async () => {
  const { ob } = make({ online: false });
  await ob.load(U);
  ob.enqueue({ tripId: T, table: 'journal_entries', kind: 'insert', key: 'tmp', match: { id: 'tmp' }, row: { id: 'tmp', body: 'a' } });
  ob.enqueue(ins('x'));
  ob.enqueue({ tripId: T, table: 'journal_entries', kind: 'update', key: 'tmp', match: { id: 'tmp' }, patch: { body: 'b' } });
  await ob.remap(T, 'journal_entries', 'tmp', 'real', { id: 'real' });
  assert.deepEqual(ob.opsForRow(T, 'journal_entries', 'real').map((o) => o.match.id), ['real', 'real']);
  assert.deepEqual(ob.opsForRow(T, 'journal_entries', 'tmp'), []);
});
