// 数据层 · 评审修复的回归测试（弱网、存储故障、撤销、多标签页、换页、移出行程、时区、分摊……）。
// 每一条都对应代码评审里的一个问题编号（H1、H2、M3…），出问题时一眼能看出是哪一类回归。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toDataError, DataError } from '../../src/data/errors.js';
import { createKv, createMemoryKv, StorageUnavailableError } from '../../src/data/kv.js';
import { createOutbox, OP_PREFIX, UNKNOWN_RETRY_LIMIT, STORAGE_RETRY_LIMIT } from '../../src/data/outbox.js';
import { createAuth } from '../../src/data/auth.js';
import { createDataLayer, mergeUniqueRow } from '../../src/data/layer.js';
import { createFiles, MAX_UPLOADED_PREVIEWS } from '../../src/data/files.js';
import { allocateSigned } from '../../src/data/fx.js';
import { bundleFromRows, todaySummary, resolveToday, ledgerSummary, splitMismatch, currentAndNext } from '../../src/data/selectors.js';
import { diffPatch } from '../../src/data/util.js';
import { readTripCache } from '../../src/data/cache.js';
import { createTestLayer, fakeClock, waitFor, settle, disposeLayers, JEREMY, CATHY } from './helpers/data.js';

afterEach(disposeLayers);

const U = '11111111-1111-4111-8111-111111111111';
const T = 'demo-island';
const ISLAND = 'demo-island';
const upd = (key, patch, tripId = T) => ({ tripId, table: 'expenses', kind: 'update', key, match: { id: key }, patch });

/** 假的 idb-keyval：可以让接下来 n 次操作失败（模拟 iOS“Connection to Indexed Database server lost”、存储满） */
function fakeIdb() {
  const data = new Map();
  let failing = 0;
  let stores = 0;
  const lost = () => new Error('Connection to Indexed Database server lost. Refresh the page to try again');
  const op = (fn) => {
    if (failing > 0) {
      failing -= 1;
      return Promise.reject(lost());
    }
    return Promise.resolve().then(fn);
  };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    data,
    fail(n = Infinity) { failing = n; },
    heal() { failing = 0; },
    get storesCreated() { return stores; },
    createStore() { stores += 1; return { id: stores }; },
    get: (k) => op(() => clone(data.get(k))),
    set: (k, v) => op(() => { data.set(k, clone(v)); }),
    del: (k) => op(() => { data.delete(k); }),
    getMany: (ks) => op(() => ks.map((k) => clone(data.get(k)))),
    setMany: (pairs) => op(() => { for (const [k, v] of pairs) data.set(k, clone(v)); }),
    delMany: (ks) => op(() => { for (const k of ks) data.delete(k); }),
    keys: () => op(() => [...data.keys()]),
    clear: () => op(() => data.clear()),
  };
}

function makeOutbox(o = {}) {
  const clock = o.clock || fakeClock();
  const sent = [];
  let online = o.online ?? true;
  const ob = createOutbox({
    kv: o.kv || createMemoryKv(),
    send: async (op) => {
      sent.push(op);
      return o.behaviour ? o.behaviour(op, sent.length) : { row: null };
    },
    getUserId: () => U,
    now: clock.now,
    timers: clock.timers,
    random: () => 0.5,
    isOnline: () => online,
  });
  return { ob, clock, sent, setOnline: (v) => { online = v; } };
}

// ---------------------------------------------------------------------
// H1 请求超时被当成永久失败
// ---------------------------------------------------------------------

test('H1 超时：postgrest-js 包过的 TimeoutError（中文原因、状态 0）判成 network、可重试；断网 / 中止同样', () => {
  const timeout = toDataError({ message: 'TimeoutError: 请求超时', details: '', hint: '', code: '' }, { status: 0 });
  assert.equal(timeout.kind, 'network');
  assert.equal(timeout.retryable, true);
  assert.match(timeout.message, /超时/);
  assert.doesNotMatch(timeout.message, /TimeoutError/, '界面上不出现中英混杂的原始写法');
  assert.equal(toDataError(new DOMException('请求超时', 'TimeoutError')).kind, 'network', '没被包过的 DOMException');
  assert.equal(toDataError({ message: 'AbortError: signal is aborted without reason', code: '' }, { status: 0 }).kind, 'network');
  assert.equal(toDataError({ message: 'TypeError: Load failed', code: '' }, { status: 0 }).kind, 'network');
  assert.equal(toDataError({ message: 'TimeoutError: 请求超时', code: '' }, { status: 0, context: '加载行程' }).message, '加载行程：网络太慢，请求超时了，稍后会自动重试');
  // 我们自己的中文错误（没有网络特征）照旧不当成网络问题
  assert.equal(toDataError(new Error('未知的改动类型：x')).kind, 'unknown');
  assert.equal(toDataError({ code: '22023', message: '邀请码无效或已过期' }, { status: 400 }).kind, 'validation');
});

test('H1 超时：写队列里的改动超时后按退避重试，不标失败、不卡住队列；之后照常发出', async () => {
  let calls = 0;
  const { ob, clock, sent } = makeOutbox({
    behaviour: () => {
      calls += 1;
      if (calls === 1) throw { message: 'TimeoutError: 请求超时', details: '', hint: '', code: '' };
      return { row: null };
    },
  });
  await ob.load(U);
  const r = ob.enqueue(upd('a', { amount: 2 }));
  await clock.advance(0);
  assert.equal(ob.state.value.failed, null, '没有标失败');
  assert.equal(ob.ops[0].status, 'pending');
  assert.ok(ob.ops[0].nextAttemptAt > clock.now(), '排了重试');
  await clock.advance(1000);
  assert.equal(sent.length, 2);
  assert.deepEqual((await r.synced).ok, true);
});

test('H1 未知错误：先按退避重试 UNKNOWN_RETRY_LIMIT 次，再标失败（看得见、可重试 / 放弃）', async () => {
  const { ob, clock, sent } = makeOutbox({ behaviour: () => { throw { message: 'something odd', code: 'XX999' }; } });
  await ob.load(U);
  const r = ob.enqueue(upd('a', { amount: 2 }));
  await clock.advance(0);
  assert.equal(ob.state.value.failed, null, '第一次失败先重试');
  await clock.advance(60_000);
  assert.equal(sent.length, UNKNOWN_RETRY_LIMIT + 1);
  assert.ok(ob.state.value.failed, '重试用完后标失败');
  const res = await r.synced;
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------------
// H2 IndexedDB 失败一次就永久换成空内存
// ---------------------------------------------------------------------

test('H2 存储：偶尔一次“连接断了”会重开连接再试，调用方察觉不到', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  await kv.set('a', { v: 1 });
  idb.fail(1);
  assert.deepEqual(await kv.get('a'), { v: 1 });
  assert.equal(kv.status.value, 'ok');
  assert.ok(idb.storesCreated >= 2, '重新建了连接');
});

test('H2 存储：一直读不了时抛 StorageUnavailableError（不当成“没有”）；写不进去先留在内存、恢复后按顺序补写', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  await kv.set('old', 1);
  idb.fail();
  await assert.rejects(kv.get('old'), (e) => e instanceof StorageUnavailableError);
  await assert.rejects(kv.keys('o'), StorageUnavailableError);
  assert.equal(await kv.set('new', 2), false, '没写进去：返回 false');
  assert.equal(await kv.get('new'), 2, '这次会话自己写的还能读到');
  assert.equal(await kv.del('old'), false);
  assert.equal(await kv.get('old'), undefined, '这次会话删掉的读不到');
  assert.equal(kv.status.value, 'degraded');
  idb.heal();
  await kv.flush();
  assert.equal(idb.data.get('new'), 2, '恢复后补写进去了');
  assert.equal(idb.data.has('old'), false, '补删了');
  assert.equal(kv.status.value, 'ok');
  assert.equal(kv.pendingCount, 0);
});

test('H2 写队列：存储读不了时暂停发送、不丢改动、不撤回乐观更新；恢复后照常发出，并从存储删掉', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  const { ob, clock, sent, setOnline } = makeOutbox({ kv, online: false });
  await ob.load(U);
  const r = ob.enqueue(upd('a', { amount: 5 }));
  assert.deepEqual(await r.saved, { durable: true });
  assert.equal((await kv.keys(OP_PREFIX)).length, 1);
  idb.fail();
  setOnline(true);
  ob.wake();
  await clock.advance(0);
  assert.equal(sent.length, 0, '确认不了“还在不在库里”：先不发');
  assert.equal(ob.ops.length, 1, '没有丢掉');
  assert.equal(ob.state.value.storage, 'unavailable');
  idb.heal();
  await clock.advance(1000);
  assert.equal(sent.length, 1, '存储恢复后发出去了');
  assert.equal(ob.ops.length, 0);
  await kv.flush();
  assert.equal([...idb.data.keys()].filter((k) => k.startsWith(OP_PREFIX)).length, 0, '发完从存储删掉（下次冷启动不会重放）');
  assert.equal((await r.synced).ok, true);
});

test('H2 写队列：存储一直坏着时，连续确认失败几次后照常发送（不会什么都同步不了）', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  const { ob, clock, sent, setOnline } = makeOutbox({ kv, online: false });
  await ob.load(U);
  ob.enqueue(upd('a', { amount: 5 }));
  await settle();
  idb.fail();
  setOnline(true);
  ob.wake();
  await clock.advance(120_000);
  assert.equal(sent.length, 1, `连续 ${STORAGE_RETRY_LIMIT} 次读不了之后照常发送`);
  assert.equal(ob.ops.length, 0);
  idb.heal();
  await kv.flush();
  assert.equal([...idb.data.keys()].filter((k) => k.startsWith(OP_PREFIX)).length, 0, '存储恢复后补删');
});

test('H2 写队列：存储写不进去时 saved 兑现为 { durable: false }，状态标 memory；改动照常发送', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  const { ob, clock, sent } = makeOutbox({ kv });
  await ob.load(U);
  idb.fail();
  const r = ob.enqueue(upd('a', { amount: 5 }));
  assert.deepEqual(await r.saved, { durable: false });
  assert.equal(ob.state.value.storage, 'memory');
  await clock.advance(0);
  assert.equal(sent.length, 1, '只在内存里的改动也照常发送');
  assert.equal((await r.synced).ok, true);
});

test('H2 写队列：读队列失败时保留内存里已有的队列、稍后重读，不清空', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  const { ob, clock } = makeOutbox({ kv, online: false });
  await ob.load(U);
  ob.enqueue(upd('a', { amount: 1 }));
  await settle();
  idb.fail();
  await ob.load(U);
  assert.equal(ob.ops.length, 1, '读不了也不清空');
  idb.heal();
  await clock.advance(3000);
  assert.equal(ob.ops.length, 1, '重读成功');
});

test('H2 上传：照片数据读不了 → 暂时性错误（稍后重试）；真的不在了 → 标失败（看得见、可放弃），不当成功', async () => {
  const idb = fakeIdb();
  const kv = createKv('t', { idb });
  const backend = {
    kind: 'fake',
    auth: { init: async () => ({ user: { id: U, email: 'a@example.com' } }) },
    upload: async () => {},
    fetchMyTrips: async () => ({ trips: [], memberships: [] }),
  };
  const layer = createDataLayer({ backend, kv, isOnline: () => true });
  await layer.auth.init();
  await kv.set('blob:x', new Uint8Array([1, 2, 3]));
  const op = { tripId: T, table: '_files', kind: 'upload', key: 'p/1.jpg', file: { path: 'p/1.jpg', contentType: 'image/jpeg', blobKey: 'blob:x' } };
  idb.fail();
  const r1 = layer.outbox.enqueue(op);
  await waitFor(() => layer.outbox.state.value.lastError?.kind === 'storage', { message: '应该是存储类的暂时性错误' });
  assert.equal(layer.outbox.state.value.failed, null, '存储读不了：等会儿再传，不标失败');
  assert.equal(layer.outbox.ops.length, 1);
  idb.heal();
  layer.outbox.wake(); // 回到前台 / 联网：立即重试
  assert.equal((await r1.synced).ok, true, '存储恢复后传上去了');
  // 照片数据确实不在了
  const r2 = layer.outbox.enqueue({ ...op, key: 'p/2.jpg', file: { ...op.file, path: 'p/2.jpg', blobKey: 'blob:missing' } });
  const res = await r2.synced;
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'blob-missing');
  assert.ok(layer.outbox.state.value.failed, '失败看得见（可以放弃）');
  layer.dispose();
});

// ---------------------------------------------------------------------
// M3 撤销软删除按字符串比较时间
// ---------------------------------------------------------------------

test('M3 撤销：删除已经同步、服务器返回的时间写法不同（.12 vs .120）也能撤销；一条都没恢复时返回 false', async () => {
  const ITEM = '22222222-2222-4222-8222-222222222222';
  const pgTs = (iso) => iso.replace('Z', '+00:00').replace(/\.(\d*?)0+\+/, (m, d) => (d ? `.${d}+` : '+'));
  const rows = {
    trips: [{ id: T, title: 'x', timezone: 'Asia/Ho_Chi_Minh', home_currency: 'HKD', cover: {}, status: 'planning', sort: 0, extra: {}, owner_id: U, updated_at: '2026-10-01T00:00:00+00:00' }],
    trip_members: [{ trip_id: T, user_id: U, role: 'owner' }],
    items: [{ id: ITEM, trip_id: T, title: '夜市', kind: 'other', sort_key: 10, links: [], tags: [], status: 'planned', variant: 'primary', stops: [], extra: {}, deleted_at: null, updated_at: '2026-10-01T00:00:00+00:00' }],
  };
  const server = new Map(rows.items.map((r) => [r.id, { ...r }]));
  const empty = Object.fromEntries(['segments', 'places', 'bookings', 'days', 'contacts', 'todos', 'tips', 'journal_entries', 'reviews', 'expenses'].map((t) => [t, []]));
  const backend = {
    kind: 'fake',
    auth: { init: async () => ({ user: { id: U, email: 'a@example.com' } }) },
    fetchTripBundle: async () => ({ ...empty, trips: rows.trips, trip_members: rows.trip_members, items: [...server.values()] }),
    fetchMyTrips: async () => ({ trips: rows.trips, memberships: rows.trip_members }),
    update: async (table, match, patch) => {
      const next = { ...server.get(match.id), ...patch };
      if (patch.deleted_at) next.deleted_at = pgTs(new Date(patch.deleted_at).toISOString());
      next.updated_at = pgTs(new Date().toISOString());
      server.set(match.id, next);
      return next;
    },
    subscribeTrip: () => () => {},
  };
  const fixed = new Date('2026-10-11T03:00:00.120Z');
  const layer = createDataLayer({ backend, kv: createMemoryKv(), isOnline: () => true, now: () => fixed });
  await layer.auth.init();
  const store = layer.openTrip(T);
  await store.open();
  const res = store.softDelete('items', ITEM);
  await res.synced;
  assert.equal(server.get(ITEM).deleted_at, '2026-10-11T03:00:00.12+00:00', '服务器的写法去掉了末尾的 0');
  assert.equal(await res.undo(), true);
  await waitFor(() => store.tables.items.value.get(ITEM).deleted_at === null, { message: '撤销后应该恢复' });
  await waitFor(() => layer.outbox.pendingCount() === 0);
  assert.equal(server.get(ITEM).deleted_at, null);
  assert.equal(await res.undo(), false, '已经恢复过：这次一条都没恢复 → false');
  layer.dispose();
});

test('M3 只提交改动字段：同一时刻的不同写法不算改动', () => {
  assert.deepEqual(diffPatch({ deleted_at: '2026-10-11T03:00:00.12+00:00' }, { deleted_at: '2026-10-11T03:00:00.120+00:00' }), {});
  assert.deepEqual(diffPatch({ at: '2026-10-11T03:00:00+00:00' }, { at: '2026-10-11T10:00:00+07:00' }), {});
  assert.deepEqual(diffPatch({ at: '2026-10-11T03:00:00+00:00' }, { at: '2026-10-11T03:00:01+00:00' }), { at: '2026-10-11T03:00:01+00:00' });
});

// ---------------------------------------------------------------------
// M5 恢复登录状态出错就当成已退出
// ---------------------------------------------------------------------

test('M5 恢复会话：后台分包下载失败、本机存着会话 → 先“离线已登录”；联网后重试成功，不跳页', async () => {
  let calls = 0;
  const changes = [];
  const clock = fakeClock();
  const backend = {
    auth: {
      init: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module: https://x/assets/chunk-NEW.js');
        return { user: { id: 'u1', email: 'a@example.com' } };
      },
    },
  };
  const auth = createAuth({
    backend, outbox: {}, onUserChange: (a, b) => changes.push([a, b]), timers: clock.timers,
    storedUser: () => ({ id: 'u1', email: 'a@example.com', displayName: null }),
  });
  const s1 = await auth.init();
  assert.equal(s1.status, 'signed-in');
  assert.equal(s1.offline, true);
  assert.equal(auth.needsRetry, true);
  const s2 = await auth.retryInit();
  assert.equal(s2.status, 'signed-in');
  assert.equal(s2.offline, false);
  assert.equal(calls, 2, '重新调了后台的初始化');
  assert.deepEqual(changes, [[null, 'u1']], '同一个人：只换过一次用户（不重载、不跳页）');
  auth.dispose();
});

test('M5 恢复会话：本机没有会话 → 已退出；之后定时重试，成功后登录状态恢复', async () => {
  let calls = 0;
  const clock = fakeClock();
  const backend = {
    auth: {
      init: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return { user: null };
      },
    },
  };
  const auth = createAuth({ backend, outbox: {}, onUserChange: () => {}, timers: clock.timers, storedUser: () => null });
  assert.equal((await auth.init()).status, 'signed-out');
  assert.match(auth.notice.value, /网络/);
  await clock.advance(3000);
  assert.equal(calls, 2, '3 秒后自动重试');
  assert.equal(auth.needsRetry, false);
  auth.dispose();
});

// ---------------------------------------------------------------------
// M6 每换一个页面都重新拉 13 张表；L3 打开到一半被关
// ---------------------------------------------------------------------

test('M6 同一个行程里换页面：实时在线、刚同步过时不重拉整包；关掉再打开会重新拉', async () => {
  const env = await createTestLayer();
  let fetches = 0;
  const orig = env.backend.fetchTripBundle;
  env.backend.fetchTripBundle = (...a) => {
    fetches += 1;
    return orig(...a);
  };
  const store = env.layer.openTrip(ISLAND);
  await store.open();
  await waitFor(() => store.realtime.value === 'live', { message: '实时没有连上' });
  assert.equal(fetches, 1);
  // 概览 → 当天 → 地图 → 账本：每个页面都 useTrip → retainTrip → open
  for (let i = 0; i < 4; i++) {
    const release = env.layer.retainTrip(ISLAND);
    await store.open();
    release();
  }
  assert.equal(fetches, 1, '没有重拉');
  store.close();
  await store.open();
  assert.equal(fetches, 2, '关掉（退订）之后再打开：断开期间的变化收不到，要重拉');
});

test('L3 打开到一半就被关掉：不会在关掉之后又订阅上', async () => {
  const env = await createTestLayer();
  let active = 0;
  const orig = env.backend.subscribeTrip;
  env.backend.subscribeTrip = (id, h) => {
    active += 1;
    const off = orig(id, h);
    return () => {
      active -= 1;
      off();
    };
  };
  const store = env.layer.getStore(ISLAND);
  const p = store.open();
  store.close();
  await p;
  await settle();
  assert.equal(active, 0, '没有残留的订阅');
  assert.equal(store.realtime.value, 'off');
  await store.open();
  assert.equal(active, 1, '再打开照常订阅');
  store.close();
});

test('L3 离开行程：最后一个用它的页面离开一段时间后退订；中途又回来就不退订', async () => {
  const clock = fakeClock();
  const env = await createTestLayer({ timers: clock.timers });
  const release = env.layer.retainTrip(ISLAND);
  const store = env.layer.activeStore.value;
  await store.open();
  release();
  await clock.advance(5000);
  assert.equal(env.layer.activeStore.value, store, '换页面的空档里不退订');
  const again = env.layer.retainTrip(ISLAND);
  await clock.advance(30_000);
  assert.equal(env.layer.activeStore.value, store, '又回来了：不退订');
  again();
  await clock.advance(16_000);
  assert.equal(env.layer.activeStore.value, null, '回到行程列表：退订了');
  assert.equal(store.realtime.value, 'off');
});

// ---------------------------------------------------------------------
// L4 被移出行程后缓存又被写回；排队的改动堵住别的行程
// ---------------------------------------------------------------------

test('L4 被移出行程：缓存删掉且不再写回；这个行程排队中的改动丢弃并提示，别的行程的改动照常', async () => {
  const env = await createTestLayer({ userRef: 'cathy' });
  const { layer, backend, network, kv } = env;
  const store = layer.openTrip(ISLAND);
  await store.open();
  await waitFor(() => store.realtime.value === 'live');
  network.value = { mode: 'offline', latency: 0 };
  const todo = [...store.tables.todos.value.values()][0];
  store.toggleTodo(todo.id);
  const other = layer.getStore('demo-cities');
  await other.open().catch(() => {});
  assert.equal(layer.outbox.pendingCount(), 1);
  network.value = { mode: 'online', latency: 0 };
  // 创建者把 Cathy 移出了行程（实时推送一条 trip_members 的 DELETE）
  await backend.demo.as(JEREMY).remove('trip_members', { trip_id: ISLAND, user_id: CATHY });
  await waitFor(() => store.status.value === 'removed', { message: '应该变成 removed' });
  await waitFor(() => layer.outbox.pendingCount() === 0, { message: '这个行程排队中的改动应该被丢弃' });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await readTripCache(kv, ISLAND, CATHY), null, '400ms 后缓存也没有被写回');
  assert.equal(layer.syncStatus.value.state, 'synced', '没有卡住的失败');
});

// ---------------------------------------------------------------------
// L5 上传照片的本机预览一直占着内存
// ---------------------------------------------------------------------

test('L5 上传：传完以后只保留最近几张的本机预览，其余释放', async () => {
  const created = [];
  const revoked = [];
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const u = `blob:test/${created.length}`;
    created.push(u);
    return u;
  };
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    const outbox = { ops: [], enqueue: () => ({ saved: Promise.resolve({ durable: true }), synced: Promise.resolve({ ok: true }) }) };
    const files = createFiles({ backend: {}, kv: createMemoryKv(), outbox, getUserId: () => U, prepare: async (f) => ({ blob: f, type: 'image/jpeg' }) });
    const paths = [];
    for (let i = 0; i < 12; i++) {
      const r = await files.upload(T, 'journal', new Blob(['x'], { type: 'image/jpeg' }), { compress: false });
      paths.push(r.path);
      files.onUploaded(r.path);
    }
    assert.equal(files.localPreviewCount, MAX_UPLOADED_PREVIEWS);
    assert.equal(revoked.length, 12 - MAX_UPLOADED_PREVIEWS, '更早的预览释放了');
    assert.equal(files.peek(paths[0]), null, '最早那张不再给 blob: 网址（之后按签名链接显示）');
    assert.match(files.peek(paths[11]), /^blob:/, '最近的还在');
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }
});

// ---------------------------------------------------------------------
// L7 日记 / 评级撞“每人一条”时整条覆盖
// ---------------------------------------------------------------------

test('L7 合并：日记正文拼接、照片合并去重、心情以这次为准；评级的清单合并、评分以这次为准', () => {
  const j = mergeUniqueRow('journal_entries',
    { body: '电脑上写的', photos: [{ path: 'a.jpg' }, { path: 'b.jpg' }], mood: '😐' },
    { body: '手机上写的', photos: [{ path: 'b.jpg' }, { path: 'c.jpg' }], mood: '😀' });
  assert.deepEqual(j, { body: '电脑上写的\n\n手机上写的', photos: [{ path: 'a.jpg' }, { path: 'b.jpg' }, { path: 'c.jpg' }], mood: '😀' });
  assert.deepEqual(mergeUniqueRow('journal_entries', { body: '一样', photos: [] }, { body: '一样', photos: [] }), {}, '一样的内容不提交');
  assert.equal(mergeUniqueRow('journal_entries', { body: '早餐', photos: [] }, { body: '早餐很好吃', photos: [] }).body, '早餐很好吃', '一段包含另一段：取长的');
  const r = mergeUniqueRow('reviews',
    { rating: 3, notes: '咖啡偏甜', food_log: ['冰沙'], shop_log: [], photos: [] },
    { rating: 4, notes: null, food_log: ['冰沙', '面包'], shop_log: [], photos: [] });
  assert.deepEqual(r, { food_log: ['冰沙', '面包'], rating: 4 });
});

// ---------------------------------------------------------------------
// L8 默认平摊把只读成员算进去
// ---------------------------------------------------------------------

test('L8 记一笔：默认只在创建者和可编辑成员之间平摊（只读成员不算，和预算的“同行人数”一致）', async () => {
  const env = await createTestLayer();
  const store = env.layer.openTrip(ISLAND);
  await store.open();
  const a = store.addExpense({ amount: 100000, description: '咖啡' });
  assert.deepEqual(a.row.split, { mode: 'equal', user_ids: [JEREMY, CATHY] });
  await env.backend.demo.as(JEREMY).update('trip_members', { trip_id: ISLAND, user_id: CATHY }, { role: 'viewer' });
  await waitFor(() => store.view.members.value.find((m) => m.user_id === CATHY)?.role === 'viewer');
  const b = store.addExpense({ amount: 50000, description: '水' });
  assert.deepEqual(b.row.split, { mode: 'personal' }, 'Cathy 变成只读后，默认不再给她记欠款');
});

test('L9 分摊：按金额分摊加起来和总额对不上时不让保存', async () => {
  const env = await createTestLayer();
  const store = env.layer.openTrip(ISLAND);
  await store.open();
  assert.throws(() => store.addExpense({
    amount: 100000, currency: 'VND', description: '晚餐',
    split: { mode: 'amounts', shares: [{ user_id: JEREMY, amount: 70000 }, { user_id: CATHY, amount: 50000 }] },
  }), (e) => e instanceof DataError && e.field === 'split' && /多了/.test(e.message));
  assert.equal(splitMismatch({ mode: 'amounts', shares: [{ amount: 60 }, { amount: 40 }] }, 100, 'HKD'), 0);
  assert.equal(splitMismatch({ mode: 'equal', user_ids: ['a'] }, 100, 'HKD'), 0);
});

// ---------------------------------------------------------------------
// L9 账本：带负数的份额按绝对值分，折合港币的汇总对不上
// ---------------------------------------------------------------------

test('L9 按带正负号的份额分配：之和严格等于总额，正负号不反', () => {
  assert.deepEqual(allocateSigned(100, [70, 50, -20]), [70, 50, -20]);
  assert.deepEqual(allocateSigned(10, [7, 5, -2]).reduce((a, b) => a + b, 0), 10);
  const r = allocateSigned(331, [1200, 800, -500]);
  assert.equal(r.reduce((a, b) => a + b, 0), 331);
  assert.ok(r[2] < 0, '负的那份还是负的');
  assert.deepEqual(allocateSigned(-90, [1, 1, 1]), [-30, -30, -30]);
  assert.deepEqual(allocateSigned(10, [5, -5]).reduce((a, b) => a + b, 0), 10, '份额之和为 0：退回按绝对值分');
});

test('L9 账本：旧数据分摊多于总额时，折合港币的“各自承担”之和仍等于总额，和按币种的汇总方向一致', () => {
  const trip = { id: T, home_currency: 'HKD', timezone: 'Asia/Ho_Chi_Minh', start_date: '2027-01-10', end_date: '2027-01-13' };
  const members = [{ trip_id: T, user_id: 'a', role: 'owner' }, { trip_id: T, user_id: 'b', role: 'editor' }];
  const e = {
    id: 'e1', trip_id: T, amount: 100, currency: 'HKD', home_currency: 'HKD', amount_home: 100, paid_by_user_id: 'a',
    split: { mode: 'amounts', shares: [{ user_id: 'a', amount: 30 }, { user_id: 'b', amount: 90 }] }, date: '2027-01-10', deleted_at: null,
  };
  const bundle = bundleFromRows(T, { trips: [trip], trip_members: members, expenses: [e] });
  const L = ledgerSummary(bundle);
  const hk = L.currencies.find((c) => c.currency === 'HKD');
  assert.equal(hk.share.a, 10, '付款人那份 = 30 − 20（多分的 20 算他的）');
  assert.equal(L.home.share.a, hk.share.a, '折合 home 的份额和按币种的一致（之前按绝对值分会算成正数）');
  assert.equal(L.home.share.b, hk.share.b);
  assert.equal(L.home.share.a + L.home.share.b, 100);
});

// ---------------------------------------------------------------------
// L2 “今天”按行程时区选天，但钟点按分段时区算
// ---------------------------------------------------------------------

test('L2 今天：某一段在别的时区时，按那一段的当地日期选天（越南 23:30 = 香港第二天 00:30 时仍是越南的这一天）', () => {
  const trip = { id: T, timezone: 'Asia/Hong_Kong', start_date: '2027-01-10', end_date: '2027-01-12' };
  const seg = { id: 's1', trip_id: T, timezone: 'Asia/Ho_Chi_Minh', start_date: '2027-01-10', end_date: '2027-01-12', sort: 0 };
  const days = [
    { id: 'd1', trip_id: T, date: '2027-01-10', segment_id: 's1' },
    { id: 'd2', trip_id: T, date: '2027-01-11', segment_id: 's1' },
  ];
  const items = [
    { id: 'night', trip_id: T, day_id: 'd1', title: '夜市', variant: 'primary', status: 'planned', start_time: '22:00:00', end_time: '01:30:00', sort_key: 1, deleted_at: null },
    { id: 'late', trip_id: T, day_id: 'd1', title: '宵夜', variant: 'primary', status: 'planned', start_time: '23:45:00', end_time: null, sort_key: 2, deleted_at: null },
    { id: 'breakfast', trip_id: T, day_id: 'd2', title: '早餐', variant: 'primary', status: 'planned', start_time: '08:00:00', end_time: '09:00:00', sort_key: 1, deleted_at: null },
  ];
  const bundle = bundleFromRows(T, { trips: [trip], segments: [seg], days, items });
  const at = new Date('2027-01-10T16:30:00Z'); // 香港 1 月 11 日 00:30，越南 1 月 10 日 23:30
  const hit = resolveToday(bundle, at);
  assert.equal(hit.day.id, 'd1', '当地还是 10 号');
  const t = todaySummary(bundle, null, at);
  assert.equal(t.day.id, 'd1');
  assert.equal(t.current.id, 'night');
  assert.equal(t.next.id, 'late', '下一项照常有');
  // 过了当地 0 点：跨午夜的夜市（到 01:30）仍是“进行中”
  const after = todaySummary(bundle, null, new Date('2027-01-10T17:30:00Z')); // 越南 11 日 00:30
  assert.equal(after.day.id, 'd2');
  assert.equal(after.current.id, 'night', '前一天 22:00–01:30 的条目过了 0 点仍算进行中');
  assert.equal(after.next.id, 'breakfast');
  assert.equal(currentAndNext([], 100, { carry: [items[0]] }).current, null, '01:40 已经结束');
});

// ---------------------------------------------------------------------
// L11 多标签页：非发送者标签页里的 synced 一直不兑现
// ---------------------------------------------------------------------

test('L11 多标签页：别的标签页替我们发送成功后，本标签页的 synced 兑现；放弃的也兑现', async () => {
  const kv = createMemoryKv();
  const make = () => {
    const listeners = [];
    return { listeners, addEventListener: (t, fn) => listeners.push(fn) };
  };
  const ca = make();
  const cb = make();
  ca.postMessage = (m) => setTimeout(() => cb.listeners.forEach((fn) => fn({ data: m })), 0);
  cb.postMessage = (m) => setTimeout(() => ca.listeners.forEach((fn) => fn({ data: m })), 0);
  const sent = [];
  const leader = createOutbox({ kv, send: async (op) => { sent.push(op); return { row: { id: op.key } }; }, getUserId: () => U, channel: ca, leader: { isLeader: () => true } });
  const follower = createOutbox({ kv, send: async () => { throw new Error('非发送者不该发送'); }, getUserId: () => U, channel: cb, leader: { isLeader: () => false } });
  await leader.load(U);
  await follower.load(U);
  const r = follower.enqueue(upd('a', { amount: 1 }));
  const res = await Promise.race([r.synced, new Promise((ok) => setTimeout(() => ok('超时'), 2000))]);
  assert.notEqual(res, '超时', '非发送者标签页的 synced 兑现了');
  assert.equal(res.ok, true);
  assert.equal(sent.length, 1);
  // 发送者那边放弃一条：发起的标签页收到 dropped
  const r2 = follower.enqueue({ ...upd('b', { amount: 1 }), notBefore: Date.now() + 60_000 });
  await waitFor(() => leader.ops.some((o) => o.key === 'b'));
  await leader.cancel(leader.ops.find((o) => o.key === 'b').id);
  const res2 = await Promise.race([r2.synced, new Promise((ok) => setTimeout(() => ok('超时'), 2000))]);
  assert.equal(res2.cancelled, true);
  leader.dispose();
  follower.dispose();
});
