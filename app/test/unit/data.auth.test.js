// 数据层 · 登录、RPC、文件、演示后台（同一套接口）：会话恢复、登录 / 验证码 / 注册、退出前确认未同步、
// 切回前台不乱跳（同一个人的 SIGNED_IN 不重载）、路由守卫、建行程 / 邀请 / 加入 / 撤销、上传进写队列、签名链接缓存、
// 演示后台的权限 / 约束 / 级联 / 持久化。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@preact/signals';
import { createTestLayer, waitFor, settle, disposeLayers, loadDemoDb, JEREMY, CATHY } from './helpers/data.js';
import { createMemoryKv } from '../../src/data/kv.js';
import { readTripCache } from '../../src/data/cache.js';
import { createFiles, buildFilePath } from '../../src/data/files.js';
import { installAuthGuard, nextAfterLogin, parseCallbackHash } from '../../src/data/guard.js';
import { createDemoBackend, DEMO_PASSWORD, DEMO_OTP, demoFingerprint } from '../../src/data/backend-demo.js';
import { normalizeInviteCode, suggestTripId } from '../../src/data/rpc.js';

afterEach(disposeLayers);

const synced = (layer) => waitFor(() => layer.outbox.pendingCount() === 0 && !layer.outbox.state.value.sending, { message: '写队列没发完' });

// ---------------------------------------------------------------------
// 登录
// ---------------------------------------------------------------------

test('会话恢复：启动后就是上次登录的人；?demouser= 可以换成 Cathy', async () => {
  const a = await createTestLayer();
  assert.equal(a.layer.auth.state.value.status, 'signed-in');
  assert.equal(a.layer.auth.state.value.user.id, JEREMY);
  const b = await createTestLayer({ userRef: 'cathy' });
  assert.equal(b.layer.auth.state.value.user.id, CATHY);
  assert.equal(b.layer.auth.state.value.user.displayName, 'Cathy');
});

test('输入检查给出具体的中文提示（不发请求）', async () => {
  const { layer } = await createTestLayer();
  await assert.rejects(layer.auth.signInWithPassword('', 'x'), /请填写邮箱/);
  await assert.rejects(layer.auth.signInWithPassword('abc', 'xxxxxx'), /邮箱格式不对/);
  await assert.rejects(layer.auth.signInWithPassword('a@example.com', '123'), /密码至少 6 位/);
  await assert.rejects(layer.auth.verifyEmailCode('a@example.com', '12ab'), /6 位数字/);
});

test('退出登录：还有没同步的改动时先不退，确认放弃后才退，并清掉本机缓存', async () => {
  const { layer, network, kv } = await createTestLayer();
  const store = layer.openTrip('demo-island');
  await store.open();
  network.value = { mode: 'offline', latency: 0 };
  store.addExpense({ amount: 1000, description: '离线记的' });
  const r = await layer.auth.signOut({ timeoutMs: 50 });
  assert.deepEqual([r.ok, r.reason, r.pending], [false, 'unsynced', 1]);
  assert.equal(layer.auth.state.value.status, 'signed-in', '还没退');
  const r2 = await layer.auth.signOut({ discardUnsynced: true, timeoutMs: 50 });
  assert.equal(r2.ok, true);
  assert.equal(layer.auth.state.value.status, 'signed-out');
  assert.equal(layer.outbox.pendingCount(), 0);
  assert.equal(await readTripCache(kv, 'demo-island', JEREMY), null, '缓存清掉了');
  assert.equal(layer.activeStore.value, null);
  assert.equal(layer.trips.state.value.entries.length, 0);
});

test('退出登录：改动都同步了就直接退（撤销窗口里的删除先立即发出）', async () => {
  const { layer, backend } = await createTestLayer();
  const store = layer.openTrip('demo-island');
  await store.open();
  const todosBefore = backend.demo.stats().todos;
  const todo = [...store.tables.todos.value.values()][0];
  store.remove('todos', todo.id, { undoMs: 60_000 });
  const r = await layer.auth.signOut();
  assert.equal(r.ok, true);
  assert.equal(backend.demo.stats().todos, todosBefore - 1, '删除在退出前发出去了');
});

test('密码登录（演示账号 demo1234）：换人后清空上一个人的内存数据、加载新的人的行程列表', async () => {
  const { layer } = await createTestLayer();
  const s1 = layer.openTrip('demo-island');
  await s1.open();
  await layer.auth.signOut();
  await assert.rejects(layer.auth.signInWithPassword('cathy@example.com', 'wrong-pass'), /邮箱或密码不对/);
  await layer.auth.signInWithPassword('Cathy@Example.com', DEMO_PASSWORD);
  assert.equal(layer.auth.state.value.user.id, CATHY);
  assert.notEqual(layer.getStore('demo-island'), s1, '换人后是新的 TripStore');
  await waitFor(() => layer.trips.state.value.status === 'ready');
  const cathyTrips = loadDemoDb().tables.trip_members.filter((m) => m.user_id === CATHY).length;
  assert.equal(layer.trips.state.value.entries.length, cathyTrips);
  assert.ok(cathyTrips >= 2);
});

test('邮箱验证码登录：没注册的邮箱不发码；验证码不对报错；对了就登录', async () => {
  const { layer } = await createTestLayer();
  await layer.auth.signOut();
  await assert.rejects(layer.auth.sendEmailCode('nobody@example.com'), /还没注册/);
  assert.equal(await layer.auth.sendEmailCode(' Cathy@example.com '), 'cathy@example.com');
  await assert.rejects(layer.auth.verifyEmailCode('cathy@example.com', '000000'), /验证码不对或已过期/);
  await layer.auth.verifyEmailCode('cathy@example.com', DEMO_OTP);
  assert.equal(layer.auth.state.value.user.id, CATHY);
});

test('注册：要邮箱验证 → 输入验证码完成；已注册的邮箱提示直接登录', async () => {
  const { layer } = await createTestLayer();
  await layer.auth.signOut();
  await assert.rejects(layer.auth.signUp('jeremy@example.com', 'abcdef'), /已经注册过了/);
  const r = await layer.auth.signUp('new.friend@example.com', 'abcdef');
  assert.deepEqual(r, { needsVerification: true, email: 'new.friend@example.com' });
  assert.equal(layer.auth.state.value.status, 'signed-out');
  await assert.rejects(layer.auth.signInWithPassword('new.friend@example.com', DEMO_PASSWORD), /还没验证/);
  await layer.auth.verifyEmailCode('new.friend@example.com', DEMO_OTP);
  assert.equal(layer.auth.state.value.status, 'signed-in');
  await layer.trips.load();
  assert.equal(layer.trips.state.value.entries.length, 0, '新用户还没有行程');
});

test('切回前台不乱跳：同一个人的 SIGNED_IN / TOKEN_REFRESHED 不重载数据；真的登出才处理', async () => {
  const { layer } = await createTestLayer();
  const store = layer.openTrip('demo-island');
  await store.open();
  await layer.trips.load();
  const listState = layer.trips.state.value;
  const user = layer.auth.state.value.user;
  layer.auth._handleEvent('SIGNED_IN', { ...user });
  layer.auth._handleEvent('TOKEN_REFRESHED', { ...user });
  layer.auth._handleEvent('INITIAL_SESSION', { ...user });
  await settle();
  assert.equal(layer.getStore('demo-island'), store, '还是同一个 TripStore');
  assert.equal(layer.trips.state.value, listState, '行程列表没被重置');
  assert.equal(layer.auth.state.value.user.id, user.id);
  layer.auth._handleEvent('USER_UPDATED', { ...user, displayName: '杰' });
  await settle();
  assert.equal(layer.auth.state.value.user.displayName, '杰', '资料变了只更新资料');
  assert.equal(layer.getStore('demo-island'), store);
  layer.auth._handleEvent('SIGNED_OUT', null);
  await settle();
  assert.equal(layer.auth.state.value.status, 'signed-out');
});

test('过时的登录事件被丢掉：退出后马上换账号登录，晚到的 SIGNED_OUT 不会把新账号踢出去', async () => {
  const { layer } = await createTestLayer();
  layer.auth._handleEvent('SIGNED_OUT', null); // 事件先收到、还没处理
  await layer.auth.signInWithPassword('cathy@example.com', DEMO_PASSWORD); // 紧接着自己登录
  await settle();
  assert.equal(layer.auth.state.value.status, 'signed-in');
  assert.equal(layer.auth.state.value.user.id, CATHY);
});

test('会话过期（不是自己点退出）：本机没同步的改动留着，同一个人重新登录后接着发', async () => {
  const kv = createMemoryKv();
  const { layer, network, backend } = await createTestLayer({ kv });
  const expensesBefore = backend.demo.stats().expenses;
  const store = layer.openTrip('demo-island');
  await store.open();
  network.value = { mode: 'offline', latency: 0 };
  store.addExpense({ amount: 2000, description: '过期前记的' });
  await settle();
  layer.auth._handleEvent('SIGNED_OUT', null);
  await waitFor(() => layer.auth.state.value.status === 'signed-out');
  assert.equal(layer.outbox.pendingCount(), 0, '内存里换掉了');
  assert.equal((await kv.keys('op:')).length, 1, '存储里还在');
  network.value = { mode: 'online', latency: 0 };
  await layer.auth.signInWithPassword('jeremy@example.com', DEMO_PASSWORD);
  await synced(layer);
  assert.equal(backend.demo.stats().expenses, expensesBefore + 1);
});

test('路由守卫：确定没登录才改道到登录页（带 next）；还在恢复会话时放行；会话中途失效时替换到登录页', async () => {
  const state = signal({ status: 'unknown', user: null });
  const routeSig = signal({ name: 'ledger', href: '#/t/x/ledger', meta: { auth: true } });
  const guards = [];
  const replaced = [];
  const router = {
    route: routeSig,
    addGuard: (fn) => { guards.push(fn); return () => {}; },
    replace: async (to) => { replaced.push(to); },
  };
  const off = installAuthGuard(router, { auth: { state, notice: signal(null), init: async () => {} } });
  const to = { name: 'ledger', href: '#/t/x/ledger', meta: { auth: true } };
  assert.equal(guards[0](to), undefined, 'unknown：放行');
  state.value = { status: 'signed-in', user: { id: 'u' } };
  assert.equal(guards[0](to), undefined);
  assert.equal(replaced.length, 0);
  state.value = { status: 'signed-out', user: null };
  assert.deepEqual(guards[0](to), { name: 'login', query: { next: '#/t/x/ledger' } });
  assert.deepEqual(replaced, [{ name: 'login', query: { next: '#/t/x/ledger' } }], '当前页要登录 → 替换到登录页');
  assert.equal(guards[0]({ name: 'join', meta: { auth: false } }), undefined, '不需要登录的页面不拦');
  off();
});

test('登录后去哪：只接受站内的 #/ 网址，不回登录页', () => {
  assert.equal(nextAfterLogin({ query: { next: '#/t/x/ledger' } }), '#/t/x/ledger');
  assert.deepEqual(nextAfterLogin({ query: { next: 'https://evil.example.com' } }), { name: 'trips' });
  assert.deepEqual(nextAfterLogin({ query: { next: '#/login?next=x' } }), { name: 'trips' });
  assert.deepEqual(nextAfterLogin({ query: {} }), { name: 'trips' });
  assert.deepEqual(parseCallbackHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'), {
    accessToken: null, refreshToken: null, error: 'access_denied', errorCode: 'otp_expired', errorDescription: 'Email link is invalid',
  });
});

// ---------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------

test('建行程：本地先校验（中文提示）；成功后自己是 owner、出现在列表里；id 重复报错', async () => {
  const { layer } = await createTestLayer();
  await assert.rejects(layer.rpc.createTrip({ id: 'A', title: 'x' }), /小写字母/);
  await assert.rejects(layer.rpc.createTrip({ id: 'trip-1', title: '  ' }), /标题不能为空/);
  await assert.rejects(layer.rpc.createTrip({ id: 'trip-1', title: 'x', startDate: '2027-02-02', endDate: '2027-02-01' }), /不能早于/);
  await assert.rejects(layer.rpc.createTrip({ id: 'trip-1', title: 'x', timezone: 'Mars/Base' }), /时区不对/);
  await assert.rejects(layer.rpc.createTrip({ id: 'trip-1', title: 'x', homeCurrency: 'HK' }), /三位代码/);
  const id = await layer.rpc.createTrip({ id: 'pq-2027', title: '富国岛', startDate: '2027-10-16', endDate: '2027-10-19', timezone: 'Asia/Ho_Chi_Minh', localCurrency: 'vnd', cover: { emoji: '🏝️' } });
  assert.equal(id, 'pq-2027');
  const entry = layer.trips.state.value.entries.find((e) => e.id === 'pq-2027');
  assert.equal(entry.role, 'owner');
  assert.equal(entry.trip.local_currency, 'VND');
  assert.equal(entry.trip.status, 'planning');
  await assert.rejects(layer.rpc.createTrip({ id: 'pq-2027', title: '又一个' }), /已存在/);
  const s = layer.openTrip('pq-2027');
  await s.open();
  assert.equal(s.view.myRole.value, 'owner');
});

test('邀请：生成 12 位码（只返回一次）→ 别人加入 → 再用一次不消耗；用完 / 撤销后无效', async () => {
  const { layer, backend } = await createTestLayer();
  const code = await layer.rpc.createInvite('demo-island', { role: 'viewer', maxUses: 1 });
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(layer.rpc.inviteLink(code.toLowerCase().replace(/-/g, ' ')).endsWith(`#/join/${code}`), true);
  // 新朋友注册后用码加入
  await layer.auth.signOut();
  await layer.auth.signUp('friend@example.com', 'abcdef');
  await layer.auth.verifyEmailCode('friend@example.com', DEMO_OTP);
  assert.equal(await layer.rpc.redeemInvite(code.toLowerCase()), 'demo-island');
  assert.equal(layer.trips.state.value.entries.find((e) => e.id === 'demo-island').role, 'viewer');
  assert.equal(await layer.rpc.redeemInvite(code), 'demo-island', '已经是成员：直接返回、不消耗次数');
  // 次数用完：另一个（还不是成员的）人用不了
  const stranger = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(backend.demo.as(stranger).rpc('redeem_invite', { p_code: code }), /无效或已过期/);
  await assert.rejects(layer.rpc.redeemInvite('ABCD'), /12 位/);
  // 撤销
  await layer.auth.signOut();
  await layer.auth.signInWithPassword('jeremy@example.com', DEMO_PASSWORD);
  const code2 = await layer.rpc.createInvite('demo-island');
  const list = await layer.rpc.loadInvites('demo-island');
  assert.deepEqual(list.map((i) => i.state).sort(), ['active', 'used']);
  assert.ok(!('code_hash' in list[0]), '列表里没有码的哈希');
  await layer.rpc.revokeInvite(list.find((i) => i.state === 'active').id);
  assert.deepEqual((await layer.rpc.loadInvites('demo-island')).map((i) => i.stateLabel).sort(), ['已撤销', '已用完']);
  await assert.rejects(backend.demo.as(stranger).rpc('redeem_invite', { p_code: code2 }), /无效或已过期/, '撤销后无效');
});

test('只读成员不能生成邀请码；断网时 RPC 直接提示需要联网', async () => {
  const { layer, backend } = await createTestLayer({ userRef: 'cathy' });
  backend.demo.as(JEREMY).update('trip_members', { trip_id: 'demo-island', user_id: CATHY }, { role: 'viewer' });
  await assert.rejects(layer.rpc.createInvite('demo-island'), /只有行程的 owner 或 editor/);
  const offline = await createTestLayer({ isOnline: () => false });
  await assert.rejects(offline.layer.rpc.createTrip({ id: 'trip-x', title: 'x' }), /需要联网/);
});

test('邀请码和行程 id 的小工具', () => {
  assert.equal(normalizeInviteCode('38s7 72q9-ftcz'), '38S7-72Q9-FTCZ');
  assert.equal(normalizeInviteCode('38S7-72Q9-FTC'), null);
  assert.equal(normalizeInviteCode('O0I1-72Q9-FTCZ'), null, '字母表里没有 O、0、I、1');
  assert.equal(suggestTripId('Phu Quoc 富国岛', '2027-10-16'), 'phu-quoc-2027');
  assert.equal(suggestTripId('富国岛', '2027-10-16'), 'trip-2027');
  assert.equal(suggestTripId('富国岛', '2027-10-16', ['trip-2027']), 'trip-2027-2');
  assert.equal(suggestTripId('', null), 'trip');
});

// ---------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------

test('上传：路径 {trip}/{自己的 uid}/{用途}/{uuid}.ext；进写队列（离线也能先“传”）；传完前用本机预览', async () => {
  const { layer, backend, network } = await createTestLayer();
  network.value = { mode: 'offline', latency: 0 };
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  const r = await layer.files.upload('demo-island', 'journal', blob, { compress: false });
  assert.match(r.path, new RegExp(`^demo-island/${JEREMY}/journal/[0-9a-f-]{36}\\.png$`));
  assert.match(layer.files.peek(r.path), /^blob:/, '马上有本机预览');
  assert.equal(layer.outbox.ops[0].kind, 'upload');
  // 引用照片的日记排在上传后面
  const store = layer.openTrip('demo-island');
  await store.open().catch(() => {});
  network.value = { mode: 'online', latency: 0 };
  await store.refresh();
  // 挑一天自己还没写日记的（演示数据前两天已经有日记，写了会变成合并修改）
  const day = store.view.days.value.find((d) => !(store.view.journalByDay.value.get(d.id) || []).some((j) => j.user_id === JEREMY));
  store.saveJournal(day.id, { body: '有照片', photos: [{ path: r.path, width: 10, height: 10 }] });
  assert.deepEqual(layer.outbox.ops.map((o) => o.kind), ['upload', 'insert']);
  layer.outbox.wake();
  await synced(layer);
  assert.equal(backend.demo.fileCount(), 1);
  assert.equal((await r.synced).ok, true);
});

test('上传：不允许的类型、太大的文件直接报错；用途只能是约定的几种', async () => {
  const { layer } = await createTestLayer();
  await assert.rejects(layer.files.upload('demo-island', 'journal', new Blob(['x'], { type: 'text/plain' })), /不支持这种文件类型/);
  assert.throws(() => buildFilePath('t', 'u', 'avatars', 'jpg'), /未知的文件用途/);
  const big = { size: 21 * 1024 * 1024, type: 'application/pdf', name: 'a.pdf' };
  await assert.rejects(layer.files.upload('demo-island', 'bookings', big, { compress: false }), /太大了/);
});

test('演示后台的文件权限：只能传到自己的目录、只能读自己行程的文件', async () => {
  const { backend } = await createTestLayer();
  await assert.rejects(backend.upload(`demo-island/${CATHY}/journal/x.jpg`, new Blob(['x']), 'image/jpeg'), /只能上传到自己的目录/);
  await assert.rejects(backend.upload(`not-mine/${JEREMY}/journal/x.jpg`, new Blob(['x']), 'image/jpeg'), /只能上传到自己的目录/);
  const map = await backend.signedUrls(['other-trip/u/journal/a.jpg']);
  assert.equal(map.get('other-trip/u/journal/a.jpg'), null);
});

test('签名链接：同一时刻的多次请求合并成一次；缓存到过期前 5 分钟', async () => {
  let t = 0;
  const calls = [];
  const backend = {
    async signedUrls(paths, ttl) {
      calls.push([...paths]);
      return new Map(paths.map((p) => [p, `https://example.com/${p}?ttl=${ttl}&n=${calls.length}`]));
    },
  };
  const files = createFiles({ backend, kv: createMemoryKv(), outbox: { ops: [], enqueue() {} }, getUserId: () => 'u', now: () => t });
  const [a, b] = await Promise.all([files.getSignedUrl('t/u/journal/a.jpg'), files.getSignedUrl('t/u/journal/b.jpg')]);
  assert.equal(calls.length, 1, '合并成一次请求');
  assert.deepEqual(calls[0], ['t/u/journal/a.jpg', 't/u/journal/b.jpg']);
  assert.match(a, /ttl=3600/);
  assert.ok(b);
  t = 50 * 60 * 1000;
  assert.equal(await files.getSignedUrl('t/u/journal/a.jpg'), a, '50 分钟时还用缓存');
  t = 56 * 60 * 1000;
  const a2 = await files.getSignedUrl('t/u/journal/a.jpg');
  assert.notEqual(a2, a, '离过期不到 5 分钟：重新取');
  assert.equal(calls.length, 2);
  assert.equal(await files.getSignedUrl(null), null);
});

// ---------------------------------------------------------------------
// 演示后台
// ---------------------------------------------------------------------

test('演示后台：改动保存在 IndexedDB（刷新后还在）；演示数据重新生成过（指纹变了）就自动重置', async () => {
  const kv = createMemoryKv();
  const a = await createTestLayer({ kv });
  const store = a.layer.openTrip('demo-island');
  await store.open();
  const r = store.addExpense({ amount: 12345, description: '刷新后还在吗' });
  await synced(a.layer);
  await a.backend.demo.persistNow();
  const b = await createTestLayer({ kv });
  const s2 = b.layer.openTrip('demo-island');
  await s2.open();
  assert.ok(s2.tables.expenses.value.has(r.row.id), '刷新后还在');
  // 指纹变了（demo-db.json 重新生成）→ 重置
  const db = loadDemoDb();
  db.tables.tips = db.tables.tips.slice(1);
  assert.notEqual(demoFingerprint(db), demoFingerprint(loadDemoDb()));
  const reset = await createDemoBackend({ db, kv, network: signal({ mode: 'online', latency: 0 }) });
  assert.equal(reset.demo.stats().expenses, loadDemoDb().tables.expenses.length, '重置回演示数据（刚才记的那笔没了）');
  await reset.demo.reset();
  assert.equal(reset.demo.stats().tips, db.tables.tips.length);
});

test('演示后台按数据库规则办事：RLS、外键、唯一约束、CHECK、触发器、级联删除', async () => {
  const { backend } = await createTestLayer();
  const as = backend.demo.as;
  const days = (await backend.fetchTripBundle('demo-island')).days;
  // 不是成员：读不到（不是报错，是空）
  const stranger = '99999999-9999-4999-8999-999999999999';
  assert.equal((await backend.fetchRow('todos', { id: (await backend.fetchTripBundle('demo-island')).todos[0].id })).trip_id, 'demo-island');
  assert.throws(() => as(stranger).insert('todos', { trip_id: 'demo-island', list: 'todo', title: 'x' }), /没有权限/);
  // 外键：引用别的行程的天
  const otherDay = loadDemoDb().tables.days.find((d) => d.trip_id === 'demo-cities');
  assert.throws(() => as(JEREMY).insert('items', { trip_id: 'demo-island', title: 'x', day_id: otherDay.id }), /关联的内容不存在/);
  // 唯一：同一天两个日期
  assert.throws(() => as(JEREMY).insert('days', { trip_id: 'demo-island', date: days[0].date }), /重复/);
  // CHECK：评级 1–5
  const place = (await backend.fetchTripBundle('demo-island')).places[0];
  assert.throws(() => as(JEREMY).insert('reviews', { trip_id: 'demo-island', place_id: place.id, rating: 9 }), /1–5/);
  // 触发器：勾选记下谁勾的；记账生成 currency_iso
  const t = as(CATHY).insert('todos', { trip_id: 'demo-island', list: 'todo', title: '勾我', done: true });
  assert.equal(t.done_by, CATHY);
  assert.ok(t.done_at);
  const un = as(CATHY).update('todos', { id: t.id }, { done: false });
  assert.deepEqual([un.done_at, un.done_by], [null, null]);
  assert.equal(as(JEREMY).insert('expenses', { trip_id: 'demo-island', amount: 1, currency: 'VND', split: { mode: 'personal' } }).currency_iso, 'VND');
  // updated_at 单调递增、created_by 不能改
  const t2 = as(JEREMY).update('todos', { id: t.id }, { title: '改了', created_by: JEREMY });
  assert.equal(t2.created_by, CATHY);
  assert.ok(Date.parse(t2.updated_at) > Date.parse(un.updated_at) - 1);
  // 只有 owner 能改角色
  assert.throws(() => as(CATHY).update('trip_members', { trip_id: 'demo-island', user_id: CATHY }, { role: 'owner' }), /只有 owner/);
  // 级联：删掉一个地点，评级连带删除、条目的 place_id 置空
  const placeWithItem = (await backend.fetchTripBundle('demo-island')).items.find((i) => i.place_id)?.place_id;
  const review = as(CATHY).insert('reviews', { trip_id: 'demo-island', place_id: placeWithItem, rating: 4 });
  as(JEREMY).remove('places', { id: placeWithItem });
  const after = await backend.fetchTripBundle('demo-island');
  assert.ok(!after.reviews.some((r) => r.id === review.id));
  assert.ok(!after.items.some((i) => i.place_id === placeWithItem));
  await settle();
});

test('演示网络：断网时请求报“网络连接失败”（可重试）；很差时部分请求失败', async () => {
  const db = loadDemoDb();
  const network = signal({ mode: 'offline', latency: 0 });
  const b = await createDemoBackend({ db, kv: createMemoryKv(), network, random: () => 0.1 });
  await assert.rejects(b.fetchTripBundle('demo-island'), (e) => e.kind === 'network' && e.retryable === true);
  network.value = { mode: 'flaky', latency: 0 };
  await assert.rejects(b.fetchTripBundle('demo-island'), /网络不稳定/);
  const ok = await createDemoBackend({ db, kv: createMemoryKv(), network: signal({ mode: 'flaky', latency: 0 }), random: () => 0.9 });
  assert.ok((await ok.fetchTripBundle('demo-island')).trips.length);
});

test('上传：返回压缩结果（尺寸、拍摄时间、为什么没转）', async () => {
  const { layer } = await createTestLayer();
  const blob = new Blob([new Uint8Array(20)], { type: 'image/jpeg' });
  const files = (await import('../../src/data/files.js')).createFiles({
    backend: layer.backend, kv: layer.kv, outbox: layer.outbox, getUserId: () => JEREMY,
    prepare: async () => ({ blob, type: 'image/jpeg', width: 2048, height: 1536, size: 20, originalSize: 900000, converted: true, reason: null, takenAt: '2027-01-10T18:30:00+07:00' }),
  });
  const r = await files.upload('demo-island', 'journal', { type: 'image/heic', name: 'a.heic', size: 900000 });
  assert.deepEqual([r.width, r.height, r.converted, r.reason, r.originalSize, r.takenAt, r.type], [2048, 1536, true, null, 900000, '2027-01-10T18:30:00+07:00', 'image/jpeg']);
  assert.match(r.path, /\.jpg$/, 'HEIC 转成 JPEG 后扩展名跟着变');
});
