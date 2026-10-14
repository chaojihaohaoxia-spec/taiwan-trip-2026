// 数据层 · 行程数据（TripStore + 数据层 + 演示后台）：加载规范化、缓存命中、乐观更新、只提交改动字段、权限和校验、
// 软删除 / 撤销、删除级联、实时推送（含和本地未同步改动叠加、乱序防护）、离线排队后重放、失败可见可放弃、冲突处理。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestLayer, waitFor, settle, disposeLayers, JEREMY, CATHY } from './helpers/data.js';
import { createMemoryKv } from '../../src/data/kv.js';
import { readTripCache } from '../../src/data/cache.js';

const ISLAND = 'demo-island';

afterEach(disposeLayers);

async function openIsland(o = {}) {
  const env = await createTestLayer(o);
  const store = env.layer.openTrip(ISLAND);
  await store.open();
  return { ...env, store };
}

const synced = (layer) => waitFor(() => layer.outbox.pendingCount() === 0 && !layer.outbox.state.value.sending, { message: '写队列没发完' });
const firstDay = (store) => store.view.days.value[0];
/** 还没有人写日记的一天（演示数据里前两天已经有日记了） */
const dayWithoutJournal = (store) => store.view.days.value.find((d) => !(store.view.journalByDay.value.get(d.id) || []).length);

test('加载：13 张表规范化成按 id 的 Map，派生出按天的条目、按天的待办、主方案 / 备选', async () => {
  const { store, db } = await openIsland();
  assert.equal(store.status.value, 'ready');
  assert.equal(store.source.value, 'network');
  assert.equal(store.trip.value.title, '椰影岛 · 冬日海岛');
  for (const t of ['segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'expenses']) {
    assert.equal(store.tables[t].value.size, db.tables[t].filter((r) => r.trip_id === ISLAND).length, t);
  }
  assert.equal(store.tables.trip_members.value.size, 2);
  assert.ok(store.tables.trip_members.value.has(`${ISLAND}|${JEREMY}`), '成员按 trip_id|user_id 做键');
  const d1 = firstDay(store);
  assert.ok(store.view.itemsByDay.value.get(d1.id).length > 0);
  assert.ok(store.view.plans.value.get(d1.id).primary.length > 0);
  assert.equal(store.view.myRole.value, 'owner');
  assert.equal(store.view.canEdit.value, true);
  assert.ok(Object.isFrozen(store.tables.items.value.values().next().value), '行是冻结的，页面不能直接改');
});

test('缓存命中：先显示 IndexedDB 里的缓存，网络失败也不清空（离线打开）', async () => {
  const kv = createMemoryKv();
  const first = await openIsland({ kv });
  await waitFor(async () => true);
  assert.ok(await readTripCache(kv, ISLAND, JEREMY), '加载成功后写了缓存');

  const second = await createTestLayer({ kv });
  second.network.value = { mode: 'offline', latency: 0 };
  const store = second.layer.openTrip(ISLAND);
  await store.open();
  assert.equal(store.status.value, 'ready');
  assert.equal(store.source.value, 'cache');
  assert.equal(store.error.value.kind, 'network');
  assert.equal(store.tables.items.value.size, first.store.tables.items.value.size);
  // 联网后刷新成网络数据
  second.network.value = { mode: 'online', latency: 0 };
  await store.refresh();
  assert.equal(store.source.value, 'network');
  assert.equal(store.error.value, null);
});

test('换了账号读不到别人的缓存', async () => {
  const kv = createMemoryKv();
  await openIsland({ kv });
  assert.equal(await readTripCache(kv, ISLAND, CATHY), null);
});

test('乐观更新：新建立刻出现在派生数据里，服务器确认后行内容以服务器为准', async () => {
  const { layer, store } = await openIsland();
  const before = store.view.expenses.value.length;
  const res = store.addExpense({ amount: 150000, description: '打车', category: '交通' });
  assert.equal(store.view.expenses.value.length, before + 1, '马上显示');
  assert.equal(res.row.currency, 'VND', '默认当地币种');
  assert.equal(res.row.currency_iso, 'VND', '生成列在本地先算好');
  assert.equal(res.row.home_currency, 'HKD');
  assert.equal(res.row.amount_home, 45.45, '150,000 ÷ 3,300 保留两位');
  assert.equal(res.row.paid_by_user_id, JEREMY);
  assert.deepEqual(res.row.split, { mode: 'equal', user_ids: [JEREMY, CATHY] });
  assert.equal(res.row.created_by, JEREMY);
  await res.saved;
  const r = await res.synced;
  assert.equal(r.ok, true);
  await synced(layer);
  const row = store.tables.expenses.value.get(res.row.id);
  assert.equal(row.amount, 150000);
  assert.ok(row.updated_at && row.created_at, '服务器补上了时间戳');
  assert.equal(layer.outbox.pendingCount(), 0);
  const vnd = store.view.ledger.value.currencies.find((c) => c.currency === 'VND');
  assert.equal(vnd.count, store.view.expenses.value.filter((e) => e.currency === 'VND').length, '记账汇总跟着更新');
});

test('只提交改动的字段；什么都没变不进队列', async () => {
  const { layer, store } = await openIsland();
  layer.outbox.state.value; // 订阅
  const item = store.view.plans.value.get(firstDay(store).id).primary[0];
  const same = store.update('items', item.id, { title: item.title, tags: [...item.tags] });
  assert.equal(same.unchanged, true);
  assert.equal(layer.outbox.pendingCount(), 0);
  const res = store.update('items', item.id, { title: '改个标题', description: item.description, start_time: '9:05' });
  assert.deepEqual(res.op.patch, { title: '改个标题', start_time: '09:05:00' }, '只带改了的字段；钟点统一写法');
  assert.equal(store.tables.items.value.get(item.id).title, '改个标题');
  await synced(layer);
  assert.equal(store.tables.items.value.get(item.id).start_time, '09:05:00');
});

test('权限：只读成员不能改共享内容；日记、评级只能改自己的（提前给出中文提示）', async () => {
  const { layer, store, backend } = await openIsland({ userRef: 'cathy' });
  assert.equal(store.view.myRole.value, 'editor');
  // owner 把 Cathy 改成只读（在 Jeremy 的手机上）
  backend.demo.as(JEREMY).update('trip_members', { trip_id: ISLAND, user_id: CATHY }, { role: 'viewer' });
  await waitFor(() => store.view.myRole.value === 'viewer', { message: '实时推送没把角色改过来' });
  assert.equal(store.view.canEdit.value, false);
  assert.throws(() => store.addExpense({ amount: 10 }), /只读成员/);
  assert.equal(layer.outbox.pendingCount(), 0);
  // 只读成员也能写自己的日记
  const day = dayWithoutJournal(store);
  const j = store.saveJournal(day.id, { body: '今天下雨', mood: '🌧️' });
  assert.equal(j.row.user_id, CATHY);
  await synced(layer);
  assert.equal(layer.syncStatus.value.state, 'synced');
  // 别人的日记不能改
  const jeremyJournal = backend.demo.as(JEREMY).insert('journal_entries', { trip_id: ISLAND, day_id: day.id, user_id: JEREMY, body: 'J 的日记' });
  await waitFor(() => store.tables.journal_entries.value.has(jeremyJournal.id));
  assert.throws(() => store.update('journal_entries', jeremyJournal.id, { body: '偷改' }), /只能修改自己的日记/);
});

test('校验：必填、枚举、未知字段、旧版字段、引用别的行程的行，都在进队列之前报中文错误', async () => {
  const { layer, store, db } = await openIsland();
  assert.throws(() => store.insert('todos', { list: 'packing' }), /标题：不能为空/);
  assert.throws(() => store.insert('todos', { list: 'nope', title: 'x' }), /清单：取值不对/);
  assert.throws(() => store.insert('todos', { list: 'todo', title: 'x', color: 'red' }), /未知字段/);
  assert.throws(() => store.insert('expenses', { amount: 1, currency: 'HKD', paid_by: 'Jeremy', split: { mode: 'personal' } }), /旧版字段/);
  const otherTripDay = db.tables.days.find((d) => d.trip_id === 'demo-cities');
  assert.throws(() => store.insert('items', { title: 'x', day_id: otherTripDay.id }), /关联的日期不存在/);
  assert.throws(() => store.insert('places', { name: 'x', lat: 10 }), /经纬度要一起写/);
  assert.throws(() => store.insert('days', { date: firstDay(store).date }), /这一天已经有了/);
  assert.throws(() => store.update('items', 'not-there', { title: 'x' }), /已经不存在/);
  assert.throws(() => store.update('items', store.tables.items.value.keys().next().value, { trip_id: 'x' }), /不能修改/);
  assert.equal(layer.outbox.pendingCount(), 0, '不合规的改动一条都没进队列');
});

test('软删除 + 撤销：删条目时挂在它下面的雨天方案一起删；撤销一起恢复；登记“已删除 · 撤销”', async () => {
  const { layer, store } = await openIsland();
  const d1 = firstDay(store);
  const plan = store.view.plans.value.get(d1.id);
  const [parentId, alts] = [...plan.alternatives][0];
  const res = store.remove('items', parentId);
  assert.equal(res.ids.length, 1 + alts.length);
  const after = store.view.plans.value.get(d1.id);
  assert.ok(!after.primary.some((i) => i.id === parentId));
  assert.ok(!after.general.some((i) => alts.some((a) => a.id === i.id)), '雨天方案没有变成“孤儿”');
  assert.ok(store.tables.items.value.get(parentId).deleted_at, '软删除：行还在，只是写了 deleted_at');
  assert.match(layer.undoable.value.label, /已删除/);
  await synced(layer);
  await res.undo();
  assert.ok(store.view.plans.value.get(d1.id).primary.some((i) => i.id === parentId));
  assert.equal(store.view.plans.value.get(d1.id).alternatives.get(parentId).length, alts.length);
  await synced(layer);
  assert.equal(store.tables.items.value.get(parentId).deleted_at, null);
});

test('硬删除的撤销窗口：本地马上消失；窗口内撤销等于没删（不发请求）', async () => {
  const { layer, store, backend } = await openIsland();
  const todosBefore = backend.demo.stats().todos;
  const todo = store.view.todosByList.value.get('packing')[0];
  const res = store.remove('todos', todo.id, { undoMs: 60_000 });
  assert.equal(store.tables.todos.value.has(todo.id), false);
  assert.equal(layer.syncStatus.value.state, 'synced', '撤销窗口里的删除不算“正在同步”');
  assert.equal(await res.undo(), true);
  assert.equal(store.tables.todos.value.has(todo.id), true);
  await settle();
  assert.equal(backend.demo.stats().todos, todosBefore, '服务器上没删');
});

test('删除级联（乐观）：删掉一天，当天的条目立刻进备选池、当天的日记跟着消失；确认后和服务器一致', async () => {
  const { layer, store } = await openIsland();
  const day = dayWithoutJournal(store);
  const dayItems = store.view.itemsByDay.value.get(day.id).map((i) => i.id);
  assert.ok(dayItems.length > 0, '挑的这一天有条目');
  store.saveJournal(day.id, { body: '第二天' });
  await synced(layer);
  assert.equal(store.view.journalByDay.value.get(day.id).length, 1);
  store.remove('days', day.id, { undoMs: 0 });
  assert.equal(store.tables.days.value.has(day.id), false);
  const pool = store.view.pool.value.map((i) => i.id);
  for (const id of dayItems) assert.ok(pool.includes(id), '条目进了备选池');
  assert.equal(store.view.journalByDay.value.get(day.id), undefined, '日记跟着删');
  await synced(layer);
  await store.refresh();
  for (const id of dayItems) assert.equal(store.tables.items.value.get(id).day_id, null);
  assert.equal(store.view.journalByDay.value.get(day.id), undefined);
});

test('实时推送：对方新建 / 修改 / 删除，按 id 替换或删除；旧的推送（updated_at 更早）被忽略', async () => {
  const { store, backend } = await openIsland();
  await waitFor(() => store.realtime.value === 'live');
  const cathy = backend.demo.as(CATHY);
  const created = cathy.insert('todos', { trip_id: ISLAND, list: 'buy', title: 'Cathy 要买的' });
  await waitFor(() => store.tables.todos.value.has(created.id), { message: '新建没推送过来' });
  const updated = cathy.update('todos', { id: created.id }, { title: 'Cathy 改了' });
  await waitFor(() => store.tables.todos.value.get(created.id).title === 'Cathy 改了');
  // 乱序：一条更早的推送晚到
  store.applyServerRow('todos', { ...updated, title: '旧的', updated_at: '2000-01-01T00:00:00+00:00' });
  assert.equal(store.tables.todos.value.get(created.id).title, 'Cathy 改了');
  cathy.remove('todos', { id: created.id });
  await waitFor(() => !store.tables.todos.value.has(created.id), { message: '删除没推送过来' });
});

test('实时推送和本地还没同步的改动叠加：对方改的字段和我改的字段都在', async () => {
  const { layer, store, backend, network } = await openIsland();
  await waitFor(() => store.realtime.value === 'live');
  const item = store.view.plans.value.get(firstDay(store).id).primary[1];
  network.value = { mode: 'offline', latency: 0 };
  store.update('items', item.id, { title: '我改的标题' });
  await waitFor(() => layer.outbox.state.value.offline);
  // 对方（在线）改了说明。断网期间收不到推送；恢复后数据层补拉
  backend.demo.as(CATHY).update('items', { id: item.id }, { description: '对方加的说明' });
  network.value = { mode: 'online', latency: 0 };
  await waitFor(() => store.realtime.value === 'live');
  await store.refresh();
  let row = store.tables.items.value.get(item.id);
  assert.equal(row.title, '我改的标题', '本地改动还在（还没发出去）');
  assert.equal(row.description, '对方加的说明', '对方的改动也在');
  layer.outbox.wake();
  await synced(layer);
  row = store.tables.items.value.get(item.id);
  assert.deepEqual([row.title, row.description], ['我改的标题', '对方加的说明'], '只提交了标题，没有覆盖对方的说明');
});

test('刷新和推送赛跑：刷新请求发出后才到的推送 / 写入确认，不会被（更早生成的）刷新结果覆盖或删掉', async () => {
  const { store } = await openIsland();
  const [t1, t2] = [...store.tables.todos.value.values()];
  const seq = store.markSeq();           // 刷新请求发出
  const stale = store.snapshot();         // 服务器当时的样子（还没有下面两个变化）
  store.applyServerRow('todos', { ...t1, title: '推送来的新标题', updated_at: '2099-01-01T00:00:00+00:00' });
  const fresh = { ...t2, id: '00000000-0000-4000-8000-00000000abcd', title: '刚新建的' };
  store.applyServerRow('todos', fresh);
  const gone = [...store.tables.todos.value.values()][2];
  stale.todos = stale.todos.filter((x) => x.id !== gone.id); // 刷新结果里少了一行（服务器上被删了，且之后没再变过）
  store.mergeRows(stale, seq);            // 旧的刷新结果到达
  assert.equal(store.tables.todos.value.get(t1.id).title, '推送来的新标题', '推送的更新没被覆盖');
  assert.ok(store.tables.todos.value.has(fresh.id), '刷新期间新建的行没被删');
  assert.equal(store.tables.todos.value.has(gone.id), false, '刷新结果里没有、期间也没变过的行照常删掉');
});

test('离线排队：断网时照常记账（乐观显示、状态“离线”），联网后按顺序重放', async () => {
  const { layer, store, backend, network } = await openIsland();
  const expensesBefore = backend.demo.stats().expenses;
  network.value = { mode: 'offline', latency: 0 };
  const a = store.addExpense({ amount: 50000, description: '椰子' });
  const b = store.addExpense({ amount: 30, currency: 'HKD', description: '水' });
  store.updateExpense(a.row.id, { amount: 60000 });
  await waitFor(() => layer.outbox.state.value.offline);
  assert.equal(layer.syncStatus.value.state, 'offline');
  assert.match(layer.syncStatus.value.message, /离线 · 3 条改动联网后自动同步/, '两笔新建 + 一次修改（中间隔着别的行，不合并）');
  assert.equal(store.tables.expenses.value.get(a.row.id).amount, 60000);
  assert.equal(store.tables.expenses.value.get(a.row.id).amount_home, 18.18);
  network.value = { mode: 'online', latency: 0 };
  layer.outbox.wake();
  await synced(layer);
  assert.equal(layer.syncStatus.value.state, 'synced');
  assert.equal(backend.demo.stats().expenses, expensesBefore + 2);
  const server = await backend.fetchRow('expenses', { id: a.row.id });
  assert.equal(server.amount, 60000);
  assert.equal((await b.synced).ok, true);
});

test('服务器拒绝（权限在服务器上被收回）：失败可见、队列停住；放弃后界面回到服务器的样子', async () => {
  const { layer, store, backend } = await openIsland({ userRef: 'cathy' });
  const item = store.view.plans.value.get(firstDay(store).id).primary[0];
  // 服务器上 Cathy 被改成只读，但这台手机还没收到推送（先关掉推送）
  store.close();
  backend.demo.as(JEREMY).update('trip_members', { trip_id: ISLAND, user_id: CATHY }, { role: 'viewer' });
  const res = store.update('items', item.id, { title: '改不了' });
  const r = await res.synced;
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'permission');
  assert.equal(layer.syncStatus.value.state, 'error');
  assert.match(layer.syncStatus.value.message, /没有权限/);
  assert.equal(store.tables.items.value.get(item.id).title, '改不了', '失败前还是乐观显示');
  await layer.discardFailed();
  assert.equal(store.tables.items.value.get(item.id).title, item.title, '放弃后回到服务器上的样子');
  assert.equal(layer.syncStatus.value.state, 'synced');
});

test('插入撞主键（上次其实写成功了、只是没收到回复）：自动改成 update', async () => {
  const { layer, store, backend } = await openIsland();
  const res = store.insert('todos', { list: 'todo', title: '本地版本' });
  // 服务器上已经有这一行（模拟上一次请求成功但回复丢了）
  backend.demo.as(JEREMY).insert('todos', { id: res.row.id, trip_id: ISLAND, list: 'todo', title: '服务器版本' });
  const r = await res.synced;
  assert.equal(r.ok, true);
  await synced(layer);
  assert.equal((await backend.fetchRow('todos', { id: res.row.id })).title, '本地版本');
});

test('日记撞“每人每天一篇”（两台设备都离线写了）：和已有的那一篇合并（正文拼接，不整条覆盖），id 跟着换', async () => {
  const { layer, store, backend, network } = await openIsland();
  const day = dayWithoutJournal(store);
  network.value = { mode: 'offline', latency: 0 };
  const res = store.saveJournal(day.id, { body: '手机上写的' });
  const tempId = res.row.id;
  store.saveJournal(day.id, { mood: '😀' });
  // 另一台设备（同一个人）先同步了一篇
  const other = backend.demo.as(JEREMY).insert('journal_entries', { trip_id: ISLAND, day_id: day.id, user_id: JEREMY, body: '电脑上写的' });
  network.value = { mode: 'online', latency: 0 };
  layer.outbox.wake();
  await synced(layer);
  const mine = [...store.tables.journal_entries.value.values()].filter((j) => j.day_id === day.id && j.user_id === JEREMY);
  assert.equal(mine.length, 1, '只剩一篇');
  assert.equal(mine[0].id, other.id, '用的是已有那一篇的 id');
  assert.notEqual(mine[0].id, tempId);
  assert.equal(mine[0].body, '电脑上写的\n\n手机上写的', '两台设备写的正文都留着（另一台先写的在前）');
  assert.equal(mine[0].mood, '😀', '心情这类单值以这次为准');
});

test('修改时发现对方已经删了这一行：本地也删掉，不算失败', async () => {
  const { layer, store, backend, network } = await openIsland();
  const todo = [...store.tables.todos.value.values()][0];
  network.value = { mode: 'offline', latency: 0 };
  store.toggleTodo(todo.id);
  backend.demo.as(CATHY).remove('todos', { id: todo.id });
  network.value = { mode: 'online', latency: 0 };
  layer.outbox.wake();
  await synced(layer);
  assert.equal(store.tables.todos.value.has(todo.id), false);
  assert.equal(layer.syncStatus.value.state, 'synced');
});

test('清单勾选：本地先记下谁、什么时候勾的；步进器数量只能是不小于 0 的整数', async () => {
  const { layer, store } = await openIsland();
  const todo = store.view.todosByList.value.get('packing').find((t) => !t.done);
  const r = store.toggleTodo(todo.id);
  assert.equal(r.row.done, true);
  assert.equal(r.row.done_by, JEREMY);
  assert.ok(r.row.done_at);
  assert.deepEqual(r.op.patch, { done: true }, 'done_at / done_by 由数据库触发器写，不提交');
  await synced(layer);
  assert.equal(store.tables.todos.value.get(todo.id).done_by, JEREMY);
  store.toggleTodo(todo.id);
  assert.equal(store.tables.todos.value.get(todo.id).done_at, null);
  assert.throws(() => store.setTodoQty(todo.id, -1), /不小于 0/);
  assert.throws(() => store.setTodoQty(todo.id, 1.5), /整数/);
  store.setTodoQty(todo.id, 0);
  assert.equal(store.tables.todos.value.get(todo.id).qty, 0);
});

test('拖拽排序：条目取前后两条的中间值（只改一行）；清单没有整数空隙时整列重新编号', async () => {
  const { store } = await openIsland();
  const primary = store.view.plans.value.get(firstDay(store).id).primary;
  const moving = primary[primary.length - 1];
  const res = store.move('items', moving.id, 0, store.view.itemsByDay.value.get(firstDay(store).id));
  assert.equal(res.length, 1);
  assert.equal(store.view.plans.value.get(firstDay(store).id).primary[0].id, moving.id);
  const list = store.view.todosByList.value.get('buy');
  store.update('todos', list[0].id, { sort: 10 });
  store.update('todos', list[1].id, { sort: 11 });
  const fresh = store.view.todosByList.value.get('buy');
  const r2 = store.move('todos', fresh[1].id, 0, fresh);
  assert.ok(r2.length >= 1);
  assert.equal(store.view.todosByList.value.get('buy')[0].id, fresh[1].id);
});

test('记账默认日期：行程进行中用行程时区的今天，没开始时不填', async () => {
  const { store } = await openIsland({ now: () => new Date('2027-01-11T20:00:00+07:00') });
  assert.equal(store.view.phase.value.phase, 'ongoing');
  assert.equal(store.addExpense({ amount: 1000 }).row.date, '2027-01-11');
  const other = await openIsland({ now: () => new Date('2026-12-01T00:00:00Z') });
  assert.equal(other.store.addExpense({ amount: 1000 }).row.date, null);
  assert.throws(() => other.store.addExpense({ amount: 0 }), /不为 0/);
});

test('评级：没有就新建、有就修改；评级 1–5', async () => {
  const { layer, store } = await openIsland();
  const place = store.view.places.value[0];
  const a = store.saveReview(place.id, { rating: 5, notes: '很好' });
  const b = store.saveReview(place.id, { rating: 4 });
  assert.equal(a.row.id, b.row.id);
  assert.throws(() => store.saveReview(place.id, { rating: 6 }), /1–5/);
  await synced(layer);
  assert.equal(store.placeRating(place.id).mine.rating, 4);
});

test('行程列表：我是成员的行程、角色（owner_id 也算 owner）', async () => {
  const { layer } = await createTestLayer({ userRef: 'cathy' });
  await layer.trips.load();
  const entries = layer.trips.state.value.entries;
  assert.deepEqual(entries.map((e) => [e.id, e.role]).sort(), [['demo-cities', 'editor'], ['demo-empty', 'editor'], ['demo-island', 'editor']]);
});

test('改行程信息会同步到行程列表', async () => {
  const { layer, store } = await openIsland();
  await layer.trips.load();
  store.updateTrip({ subtitle: '新的副标题' });
  assert.equal(layer.trips.state.value.entries.find((e) => e.id === ISLAND).trip.subtitle, '新的副标题');
  await synced(layer);
});

test('切换行程：上一个行程退订实时，新的订阅', async () => {
  const { layer } = await createTestLayer();
  const a = layer.openTrip(ISLAND);
  await a.open();
  await waitFor(() => a.realtime.value === 'live');
  const b = layer.openTrip('demo-cities');
  assert.equal(a.realtime.value, 'off');
  await b.open();
  await waitFor(() => b.realtime.value === 'live');
  assert.equal(layer.activeStore.value, b);
});

test('不是成员 / 不存在的行程：status = missing', async () => {
  const { layer } = await createTestLayer();
  const s = layer.openTrip('no-such-trip');
  await s.open();
  assert.equal(s.status.value, 'missing');
  assert.match(s.error.value.message, /找不到这个行程/);
});

test('被移出行程：status = removed，缓存清掉', async () => {
  const { store, backend, kv } = await openIsland({ userRef: 'cathy' });
  await waitFor(() => store.realtime.value === 'live');
  backend.demo.as(JEREMY).remove('trip_members', { trip_id: ISLAND, user_id: CATHY });
  await waitFor(() => store.status.value === 'removed');
  await settle();
  assert.equal(await readTripCache(kv, ISLAND, CATHY), null);
});

test('备选条目排在主方案前面（数据库按 uuid 排序返回）也能正确挂到主方案下，不会被当成“正在删除”', async () => {
  const { store } = await openIsland();
  const rows = store.snapshot();
  const d1 = firstDay(store);
  const plan = store.view.plans.value.get(d1.id);
  const [parentId, alts] = [...plan.alternatives][0];
  // 把备选放到数组最前面，重新整包合并
  rows.items = [...rows.items.filter((i) => i.parent_item_id === parentId), ...rows.items.filter((i) => i.parent_item_id !== parentId)];
  store.mergeRows({ ...rows, items: [] });
  store.mergeRows(rows);
  assert.equal(store.view.plans.value.get(d1.id).alternatives.get(parentId)?.length, alts.length);
});

test('乐观删除地点（撤销窗口内）：它的评级跟着隐藏、条目的地点置空；撤销后全部回来', async () => {
  const { layer, store } = await openIsland();
  const item = [...store.tables.items.value.values()].find((i) => i.place_id && !i.deleted_at);
  const placeId = item.place_id;
  const review = store.saveReview(placeId, { rating: 5 });
  await waitFor(() => layer.outbox.pendingCount() === 0);
  const del = store.remove('places', placeId, { undoMs: 60_000 });
  assert.equal(store.tables.places.value.has(placeId), false);
  assert.equal(store.tables.reviews.value.has(review.row.id), false, '评级连带删除（cascade）');
  assert.equal(store.tables.items.value.get(item.id).place_id, null, '条目的地点置空（set null）');
  assert.equal(await del.undo(), true);
  assert.equal(store.tables.places.value.has(placeId), true);
  assert.equal(store.tables.reviews.value.has(review.row.id), true);
  assert.equal(store.tables.items.value.get(item.id).place_id, placeId);
});
