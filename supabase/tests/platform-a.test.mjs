// =====================================================================
// supabase/tests/platform-a.test.mjs：迁移 20261022090000_platform_a 的 PGlite 测试（只用虚构数据「椰影岛」）。
//
//   PGLITE_DIST=<…/@electric-sql/pglite/dist> node --test supabase/tests/platform-a.test.mjs
//
// 覆盖：
//   1. 老的 13 种桥接改动照旧：同一批改动（含重放、冲突、gone、报错）分别在「迁移到 20261017」和「再加上 platform_a」的
//      两个库里跑，逐条结果和最后的表一字不差（时间戳换成占位符）；
//   2. 分发器：不认识的改动走 private.wx_op_ext，报错和以前一样；wx_op_ext 认 place.set（只补当地名字）；
//   3. 条目「怎么去」transport_in：加、改、清，逐样比冲突，写法检查（transfer、推荐只能一个、≤ 8 条…）；
//   4. 档案写法 private.dest_ok / seg_dest_ok 和规则包 rules/dest.js 的 destOk / segDestOk 逐条一致；
//   5. 新 RPC：create_trip_v2（重放、id 自动起（只选了国家用 region_slug，和规则包一致）、成员、分段、每天、行李清单、通用待办）、set_trip_dates（S4：有日记的天、
//      挪进备选池、首末分段、整趟平移）、set_trip_dest（合并写）、add_household_to_trip、wx_bridge_trip_admin；
//   6. 权限：anon 调不了网页入口、authenticated 调不了小程序入口、陌生人拉不动我们俩、只读成员改不了、私有函数谁都调不了；
//   7. 迁移重复执行没问题。
// =====================================================================

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { freshDb, migrationFiles, runFile, one, rows, asRole, stable, sha256, REPO } from './helpers.mjs';
import { destOk, segDestOk, regionSlug } from '../../app/src/rules/dest.js';
import { REGIONS } from '../../app/src/rules/dest-data.js';

const MIG = '20261022090000_platform_a.sql';

// 虚构的人（uuid、邮箱都是编的）
const J = '11111111-1111-4111-8111-111111111111';   // 我们俩之一（owner）
const C = '22222222-2222-4222-8222-222222222222';   // 我们俩之二
const S = '33333333-3333-4333-8333-333333333333';   // 陌生人（注册了，但不是我们俩）
const V = '44444444-4444-4444-8444-444444444444';   // 演示行程里的只读成员
const KEY = 'k'.repeat(48);
const OPENID = { [J]: sha256('openid-j'), [C]: sha256('openid-c'), [S]: sha256('openid-s') };

const u = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TRIP = 'demo-island';
const SEG1 = u(1);
const D1 = u(11), D2 = u(12), D3 = u(13), D4 = u(14);
const P1 = u(21), P2 = u(22);
const B1 = u(31);
const I1 = u(41), I2 = u(42), I2B = u(43), I3 = u(44);
const T1 = u(51), T2 = u(52), T3 = u(53);
const E1 = u(61);
const JN1 = u(71);

const FIXTURE = `
INSERT INTO auth.users (id, email) VALUES
  ('${J}', 'jeremy@example.com'), ('${C}', 'cathy@example.com'), ('${S}', 'stranger@example.com'), ('${V}', 'viewer@example.com');
INSERT INTO public.trips (id, title, start_date, end_date, timezone, home_currency, local_currency, owner_id, extra)
VALUES ('${TRIP}', '椰影岛 · 冬日海岛', '2027-01-10', '2027-01-13', 'Asia/Ho_Chi_Minh', 'HKD', 'VND', '${J}', '{"party_size":2,"ledger_mirror":true}');
INSERT INTO public.trip_members (trip_id, user_id, email, role, display_name, color, joined_at) VALUES
  ('${TRIP}', '${J}', 'jeremy@example.com', 'owner', 'Jeremy', '#2F6FDE', '2026-11-11T08:01:00Z'),
  ('${TRIP}', '${C}', 'cathy@example.com', 'editor', 'Cathy', '#D9480F', '2026-11-11T08:02:00Z'),
  ('${TRIP}', '${V}', 'viewer@example.com', 'viewer', '只读', NULL, '2026-11-11T08:03:00Z');
INSERT INTO public.segments (id, trip_id, name, start_date, end_date) VALUES ('${SEG1}', '${TRIP}', '椰影岛', '2027-01-10', '2027-01-13');
INSERT INTO public.places (id, trip_id, name, lat, lng) VALUES
  ('${P1}', '${TRIP}', '椰影岛码头', 8.68, 106.6), ('${P2}', '${TRIP}', '南岬灯塔', 8.62, 106.55);
INSERT INTO public.bookings (id, trip_id, kind, title) VALUES ('${B1}', '${TRIP}', 'hotel', '椰林小屋');
INSERT INTO public.days (id, trip_id, date, segment_id, title) VALUES
  ('${D1}', '${TRIP}', '2027-01-10', '${SEG1}', '到岛'), ('${D2}', '${TRIP}', '2027-01-11', '${SEG1}', '浮潜'),
  ('${D3}', '${TRIP}', '2027-01-12', '${SEG1}', '环岛'), ('${D4}', '${TRIP}', '2027-01-13', '${SEG1}', '回家');
UPDATE public.days SET stay_booking_id = '${B1}' WHERE id = '${D3}';
INSERT INTO public.items (id, trip_id, day_id, sort_key, kind, title, place_id) VALUES
  ('${I1}', '${TRIP}', '${D1}', 10, 'transport', '坐船上岛', '${P1}'),
  ('${I2}', '${TRIP}', '${D1}', 20, 'sight', '南岬看日落', '${P2}'),
  ('${I3}', '${TRIP}', '${D2}', 10, 'activity', '浮潜', NULL);
INSERT INTO public.items (id, trip_id, day_id, sort_key, kind, title, variant, parent_item_id) VALUES
  ('${I2B}', '${TRIP}', '${D1}', 21, 'sight', '下雨就去书店', 'rain', '${I2}');
INSERT INTO public.todos (id, trip_id, list, title, qty, done, sort) VALUES
  ('${T1}', '${TRIP}', 'packing', '泳衣', 2, true, 10),
  ('${T2}', '${TRIP}', 'packing', '防晒霜', NULL, false, 20),
  ('${T3}', '${TRIP}', 'todo', '订船票', NULL, false, 10);
INSERT INTO public.journal_entries (id, trip_id, day_id, user_id, body) VALUES ('${JN1}', '${TRIP}', '${D2}', '${J}', '海水很清');
INSERT INTO public.expenses (id, trip_id, amount, currency, date, category, paid_by_user_id, split)
VALUES ('${E1}', '${TRIP}', 150000, 'VND', '2027-01-10', '交通', '${J}', '{"mode":"personal"}');
INSERT INTO private.wx_bridge_keys (key_sha256, label) VALUES ('${sha256(KEY)}', '测试');
INSERT INTO private.wx_bridge_users (openid_sha256, user_id, label) VALUES
  ('${OPENID[J]}', '${J}', 'J'), ('${OPENID[C]}', '${C}', 'C'), ('${OPENID[S]}', '${S}', 'S');
`;
const HOUSEHOLD = `INSERT INTO private.household (user_id, sort) VALUES ('${J}', 1), ('${C}', 2);`;

let oldDb;   // 迁移到 20261017（加上 19 号那个和 peek_invite）
let db;      // 再加 platform_a

before(async () => {
  const all = migrationFiles();
  oldDb = await freshDb(all.filter((f) => f !== MIG));
  db = await freshDb(all);
  await runFile(db, MIG);   // 重复执行一遍
  for (const x of [oldDb, db]) await x.exec(FIXTURE);
  await db.exec(HOUSEHOLD);
});

const applyOps = (x, uid, ops, trip = TRIP) => one(x, 'SELECT private.wx_bridge_apply_ops($1, $2, $3::jsonb) AS r', [uid, trip, JSON.stringify(ops)]);
const web = (uid, sql, params) => asRole(db, 'authenticated', uid, sql, params);
const bridge = (uid, action, p) => asRole(db, 'anon', null, 'SELECT public.wx_bridge_trip_admin($1, $2, $3, $4::jsonb) AS r', [KEY, OPENID[uid], action, JSON.stringify(p)]);
const tableState = async (x, trip = TRIP) => {
  const out = {};
  for (const t of ['items', 'todos', 'expenses', 'journal_entries', 'reviews', 'places']) {
    out[t] = (await rows(x, `SELECT to_jsonb(r.*) AS j FROM public.${t} r WHERE r.trip_id = $1 ORDER BY r.id`, [trip])).map((r) => r.j);
  }
  return stable(out);
};
const errOf = async (p) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('应该报错');
};

// ---------------------------------------------------------------------
// 1. 老的 13 种照旧（两个库逐字比）
// ---------------------------------------------------------------------

const OLD = '2000-01-01T00:00:00Z';     // 打开得很早：对方之后改过
const LATER = '2999-01-01T00:00:00Z';   // 打开得很晚：之后没人改过
const op = (n, type, data, extra = {}) => ({ op_id: `o${n}`, type, data, ...extra });

const BATCH1 = [
  op(1, 'expense.put', { id: u(101), amount: 85000, currency: 'vnd', category: '餐饮', description: '椰子' }),
  op(2, 'expense.put', { id: u(101), amount: 85000, currency: 'vnd', category: '餐饮', description: '椰子' }),
  op(3, 'expense.put', { id: E1, amount: 160000 }, { base_updated_at: OLD }),
  op(4, 'expense.put', { id: E1, amount: 160000 }, { base_updated_at: LATER }),
  op(5, 'expense.put', { id: u(102), amount: 1, currency: 'VN' }),
  op(6, 'expense.put', { id: u(103), amount: 0 }),
  op(7, 'expense.delete', { id: u(101) }),
  op(8, 'expense.delete', { id: u(101) }),
  op(9, 'expense.put', { id: u(101), amount: 1 }),
  op(10, 'expense.restore', { id: u(101) }),
  op(11, 'expense.put', { id: u(104), amount: 5, split: { mode: 'equal', user_ids: [S] } }),
  op(12, 'todo.add', { id: u(111), list: 'packing', title: '  雨伞  ', qty: '3' }),
  op(13, 'todo.add', { id: u(111), list: 'packing', title: '雨伞' }),
  op(14, 'todo.add', { id: u(112), list: 'nope', title: 'x' }),
  op(15, 'todo.add', { id: u(113), title: '' }),
  op(16, 'todo.add', { id: u(114), title: 'x', qty: 1.5 }),
  op(17, 'todo.set', { id: T2, done: true }),
  op(18, 'todo.set', { id: T2, done: true }),
  op(19, 'todo.set', { id: T3, title: '订回程船票' }, { base_updated_at: OLD }),
  op(20, 'todo.set', { id: T3, title: '订回程船票', list: 'confirm', day_id: D2 }, { base_updated_at: LATER }),
  op(21, 'todo.set', { id: T3, assignee_user_id: S }),
  op(22, 'todo.set', { id: u(199), done: true }),
  op(23, 'todo.delete', { id: u(111) }, { base_updated_at: OLD }),
  op(24, 'todo.delete', { id: u(111) }, { base_updated_at: LATER }),
  op(25, 'todo.delete', { id: u(111) }),
  op(26, 'todo.add', { id: u(111), list: 'packing', title: '雨伞', day_id: u(198), restore: true, done: true, sort: 15, extra: { a: 1 } }),
  op(27, 'todo.add', { id: u(115), title: '带现金', day_id: u(198) }),
  op(28, 'todo.set', { id: T1, done: 'yes' }),
  op(29, 'item.status', { id: I1, status: 'done', actual_time: '09:20', actual_note: '风浪不大' }),
  op(30, 'item.status', { id: I1, status: 'done', actual_time: '09:20', actual_note: '风浪不大' }),
  op(31, 'item.status', { id: I1, status: 'gone' }),
  op(32, 'journal.put', { day_id: D2, id: u(121), body: '下午起风了' }, { base_updated_at: OLD }),
  op(33, 'journal.put', { day_id: D3, id: u(122), mood: '🙂', body: '环岛' }),
  op(34, 'journal.put', { day_id: D3, mood: '这是一个太长太长太长太长的心情' }),
  op(35, 'journal.put', { day_id: u(197), body: 'x' }),
  op(36, 'review.put', { place_id: P1, id: u(131), rating: 4, notes: '船很稳' }),
  op(37, 'review.put', { place_id: P1, rating: 4, notes: '船很稳' }),
  op(38, 'review.put', { place_id: P1, rating: 7 }),
  op(39, 'review.put', { place_id: u(196), rating: 3 }),
  op(40, 'foo.bar', { id: 1 }),
  op(41, null, {}),
  { op_id: 'o42', type: 'item.status', data: 'x' },
  'not-an-object',
  op(44, 'whatever', {}, { base_updated_at: 'abc' }),
];

const BATCH2 = [
  op(51, 'item.add', { id: u(141), title: '  夜市  ', day_id: D2, start_time: '19:00', end_time: '21:00', kind: 'night_market', new_place: { id: u(151), name: '椰影夜市' } }),
  op(52, 'item.add', { id: u(141), title: '夜市', day_id: D2, new_place: { id: u(151), name: '椰影夜市' } }),
  op(53, 'item.add', { id: u(142), title: '只有结束', day_id: D2, end_time: '10:00', status: 'done', actual_note: '去了' }),
  op(54, 'item.add', { id: u(143), title: 'x', place_id: u(195) }),
  op(55, 'item.add', { id: u(144), title: 'x', kind: 'rocket' }),
  op(56, 'item.add', { id: u(145), title: '' }),
  op(57, 'item.add', { id: u(146), title: 'x', sort_key: 'abc' }),
  op(58, 'item.set', { id: I2, title: '南岬日落', from: { title: '南岬看日落' } }, { base_updated_at: LATER }),
  op(59, 'item.set', { id: I2, title: '南岬日落' }),
  op(60, 'item.set', { id: I3, description: '带面镜', from: { description: null } }, { base_updated_at: OLD }),
  op(61, 'item.set', { id: I3, title: '深潜' }, { base_updated_at: OLD }),
  op(62, 'item.set', { id: I2, day_id: D3 }),
  op(63, 'item.set', { id: I2, start_time: '' , end_time: '18:30' }),
  op(64, 'item.set', { id: I2, from: 'x' }),
  op(65, 'item.set', { id: u(194), title: 'x' }),
  op(66, 'item.delete', { id: I2 }),
  op(67, 'item.delete', { id: I2 }),
  op(68, 'item.set', { id: I2, title: 'x' }),
  op(69, 'item.restore', { id: I2 }),
  op(70, 'item.restore', { id: I2 }),
  op(71, 'item.delete', { id: u(193) }),
  op(72, 'item.set', { id: I1, place_id: null, time_label: '一早' }),
];

test('老的 13 种改动：迁移前后，同一批改动的结果一字不差', async () => {
  for (const [uid, batch] of [[J, BATCH1], [J, BATCH2], [V, [op(81, 'expense.put', { id: u(161), amount: 1 }), op(82, 'journal.put', { day_id: D4, id: u(162), body: '只读也能写自己的日记' }), op(83, 'item.add', { id: u(163), title: 'x' })]], [S, [op(91, 'todo.set', { id: T1, done: false })]]]) {
    const a = stable(await applyOps(oldDb, uid, batch));
    const b = stable(await applyOps(db, uid, batch));
    assert.deepEqual(b, a);
  }
  assert.deepEqual(await tableState(db), await tableState(oldDb));
  // 抽查几条，确认这批改动真的覆盖了各种结果（不是全都报错）
  const r = stable(await applyOps(db, J, [op(1, 'expense.put', { id: u(101), amount: 85000, currency: 'vnd', category: '餐饮', description: '椰子' })]));
  assert.equal(r[0].ok, true);
});

test('分发器：不认识的改动走 wx_op_ext，报错和以前一样', async () => {
  const [a, b, c] = await applyOps(db, J, [op(1, 'place.add', { id: u(171), name: 'x' }), op(2, 'item.add', 'x'), op(3, 'import.apply', {})], TRIP);
  assert.equal(a.ok, false);
  assert.equal(a.error, '不支持的改动：place.add');
  assert.equal(b.error, '改动的格式不对');
  assert.equal(c.code, '22023');
  const [d] = await applyOps(db, S, [op(4, 'place.add', {})]);
  assert.equal(d.error, '不是这个行程的成员');
  const src = await one(db, "SELECT prosrc FROM pg_proc WHERE proname = 'wx_bridge_apply_op'");
  assert.match(src, /wx_op_core/);
  assert.match(src, /wx_op_ext/);
});

test('place.set（补当地名字）：补上、一样的不写、清掉；只认 name_local；报错原话和小程序一样；只读成员、gone、陌生人', async () => {
  const [a, b, c, d, e, f, g] = await applyOps(db, J, [
    op(181, 'place.set', { id: P2, name_local: '  Ngọn Hải Đăng Ví Dụ  ' }),
    op(182, 'place.set', { id: P2, name_local: 'Ngọn Hải Đăng Ví Dụ' }),
    op(183, 'place.set', { id: P2, name: '改名' }),
    op(184, 'place.set', { id: P2, name_local: 12 }),
    op(185, 'place.set', { id: P2, name_local: 'x'.repeat(201) }),
    op(186, 'place.set', { id: u(199), name_local: 'x' }),
    op(187, 'place.set', { name_local: 'x' }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(a.row.name_local, 'Ngọn Hải Đăng Ví Dụ', '去掉首尾空白');
  assert.equal(b.ok, true);
  assert.equal(b.row.updated_at, a.row.updated_at, '和现在一样：原样返回，不写');
  // 这几句和小程序 shared/trip-core.js applyOpLocally('place.set') 的报错一字不差（小程序 tools/test-trip-core 那边核对同一组）
  assert.equal(c.error, '地点现在只能补当地名字');
  assert.equal(d.error, '名字的格式不对');
  assert.equal(e.error, '名字太长了');
  assert.ok(f.ok && f.gone, '地点不在这个行程里 → gone');
  assert.equal(g.error, '缺少地点 id');
  const [h] = await applyOps(db, C, [op(188, 'place.set', { id: P2, name_local: '   ' })]);
  assert.equal(h.row.name_local, null, 'editor 能清掉');
  const [i] = await applyOps(db, V, [op(189, 'place.set', { id: P2, name_local: 'x' })]);
  assert.equal(i.error, '只读成员不能改这项');
  const [k] = await applyOps(db, S, [op(190, 'place.set', { id: P2, name_local: 'x' })]);
  assert.equal(k.error, '不是这个行程的成员');
  assert.equal((await one(db, 'SELECT name_local FROM public.places WHERE id = $1', [P2])), null);
});

// ---------------------------------------------------------------------
// 2. 「怎么去」transport_in
// ---------------------------------------------------------------------

test('「怎么去」：加一项带 transport_in；改的时候只交 transport_in；null 回到自动', async () => {
  const ti = { options: [{ mode: 'taxi', recommended: true, source: 'app' }] };
  let [r] = await applyOps(db, J, [op(1, 'item.add', { id: u(201), title: '去码头', day_id: D3, transport_in: ti })]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.row.transport_in, ti);
  [r] = await applyOps(db, J, [op(2, 'item.add', { id: u(202), title: '没写怎么去', day_id: D3 })]);
  assert.equal(r.row.transport_in, null);
  const before = await one(db, 'SELECT title FROM public.items WHERE id = $1', [u(201)]);
  const transfer = { options: [{ mode: 'transfer', recommended: true, source: 'app' }] };
  [r] = await applyOps(db, J, [op(3, 'item.set', { id: u(201), transport_in: transfer })]);
  assert.deepEqual(r.row.transport_in, transfer, 'transfer「有人接」能存');
  assert.equal(r.row.title, before, '只改了 transport_in');
  [r] = await applyOps(db, J, [op(4, 'item.set', { id: u(201), transport_in: null })]);
  assert.equal(r.row.transport_in, null, 'null = 回到自动');
  // 导入过的：选「自动」只多一个 auto: true，两条都还在（transportPatch 的写法）
  const imported = { summary: '打车约 20 分钟', options: [{ mode: 'grab', recommended: true, cost: { amount: 120000, currency: 'VND' } }, { mode: 'taxi', note: '打表' }], auto: true };
  [r] = await applyOps(db, J, [op(5, 'item.set', { id: u(201), transport_in: imported })]);
  assert.deepEqual(r.row.transport_in, imported);
  // 一样的再发一次：不写（updated_at 不变）
  const ts = await one(db, 'SELECT updated_at::text FROM public.items WHERE id = $1', [u(201)]);
  [r] = await applyOps(db, J, [op(6, 'item.set', { id: u(201), transport_in: { auto: true, options: imported.options, summary: '打车约 20 分钟' } })]);
  assert.equal(r.ok, true);
  assert.equal(await one(db, 'SELECT updated_at::text FROM public.items WHERE id = $1', [u(201)]), ts);
});

test('「怎么去」冲突逐样比：对方改了标题照常存；对方也改了怎么去 → 40001', async () => {
  const mine = { options: [{ mode: 'walk', recommended: true, source: 'app' }] };
  const orig = await one(db, 'SELECT transport_in FROM public.items WHERE id = $1', [u(201)]);
  await applyOps(db, C, [op(1, 'item.set', { id: u(201), title: '去码头（对方改的）' })]);   // 对方先改了标题
  let [r] = await applyOps(db, J, [op(2, 'item.set', { id: u(201), transport_in: mine, from: { transport_in: orig } }, { base_updated_at: OLD })]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.row.title, '去码头（对方改的）');
  assert.deepEqual(r.row.transport_in, mine);
  // 对方又改了怎么去
  await applyOps(db, C, [op(3, 'item.set', { id: u(201), transport_in: { options: [{ mode: 'bus', recommended: true, source: 'app' }] } })]);
  [r] = await applyOps(db, J, [op(4, 'item.set', { id: u(201), transport_in: { options: [{ mode: 'taxi', recommended: true, source: 'app' }] }, from: { transport_in: mine } }, { base_updated_at: OLD })]);
  assert.equal(r.ok, false);
  assert.equal(r.code, '40001');
  // from 里键的顺序不一样也算同一个原值
  const cur = await one(db, 'SELECT transport_in FROM public.items WHERE id = $1', [u(201)]);
  const reordered = { options: cur.options.map((o) => ({ source: o.source, recommended: o.recommended, mode: o.mode })) };
  [r] = await applyOps(db, J, [op(5, 'item.set', { id: u(201), transport_in: null, from: { transport_in: reordered } }, { base_updated_at: OLD })]);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('「怎么去」写法检查', async () => {
  const bad = [
    [{ options: [{ mode: 'rocket' }] }, '不认识的交通方式'],
    [{ options: [{ mode: 'taxi', recommended: true }, { mode: 'walk', recommended: true }] }, '推荐的走法只能有一个'],
    [{ options: Array.from({ length: 9 }, () => ({ mode: 'walk' })) }, '「怎么去」最多写 8 种走法'],
    [{ mode: 'taxi' }, '「怎么去」的格式不对'],
    ['taxi', '「怎么去」的格式不对'],
    [{ options: [], auto: 'yes' }, '「怎么去」的格式不对'],
    [{ options: [{ mode: 'walk', note: 'x'.repeat(5000) }] }, '「怎么去」写得太长了'],
    [{ options: [{ mode: 'walk', recommended: 'y' }] }, '「怎么去」的格式不对'],
  ];
  for (const [ti, msg] of bad) {
    const [r] = await applyOps(db, J, [op(1, 'item.set', { id: u(202), transport_in: ti })]);
    assert.equal(r.error, msg, JSON.stringify(ti));
    const [r2] = await applyOps(db, J, [op(2, 'item.add', { id: u(203), title: 'x', transport_in: ti })]);
    assert.equal(r2.error, msg);
  }
  for (const mode of ['subway', 'cable_car', 'transfer', 'other', 'hsr']) {
    const [r] = await applyOps(db, J, [op(3, 'item.set', { id: u(202), transport_in: { options: [{ mode }] } })]);
    assert.equal(r.ok, true, mode);
  }
  const [r] = await applyOps(db, V, [op(4, 'item.set', { id: u(202), transport_in: null })]);
  assert.equal(r.error, '只读成员不能改这项');
});

// ---------------------------------------------------------------------
// 3. 档案写法：SQL 和规则包同一套
// ---------------------------------------------------------------------

test('dest_ok / seg_dest_ok 和 rules/dest.js 的 destOk / segDestOk 逐条一致', async () => {
  const cases = JSON.parse(readFileSync(path.join(REPO, 'app/src/rules/cases/dest.json'), 'utf8')).cases
    .filter((c) => c.fn === 'destOk' || c.fn === 'segDestOk')
    .map((c) => [c.fn, c.args[0]]);
  const extra = [
    { region: 'TW', cities: ['kaohsiung', 'kenting', 'taipei'] },
    { region: 'VN', cities: null, move: null, ride: null, walk_km: null },
    { region: 'VN', cities: 'phu-quoc' },
    { region: 'VN', cities: ['Phu Quoc'] },
    { region: 'VN', cities: [{ zh: '', lat: 1, lng: 2 }] },
    { region: 'VN', cities: [{ zh: '岛', lat: 0, lng: 0 }] },
    { region: 'VN', cities: [{ zh: '岛', lat: '8.6', lng: '106.6' }] },
    { region: 'VN', cities: [{ zh: '岛', lat: 91, lng: 0 }] },
    { region: 'VN', cities: [{ zh: '一'.repeat(41), lat: 1, lng: 1 }] },
    { region: 'VN', ride: 'Grab' },
    { region: 'VN', ride: 7 },
    { region: 'VN', move: 'self_drive', walk_km: 0.3 },
    { region: 'VN', walk_km: 5.01 },
    { region: 'VNM' },
    { region: 1 },
    {},
    [],
    'VN',
    { region: 'JP', extra_key: { a: 1 } },
  ];
  const segExtra = [
    { region: 'TW', city: 'kenting' },
    { region: 'TW', city: { zh: '小琉球', lat: 22.34, lng: 120.37 }, move: 'scooter' },
    { region: 'TW', city: null },
    { region: 'TW', city: 'Kenting' },
    { region: 'TW', move: 'boat' },
    { city: 'kenting' },
  ];
  const all = [...cases, ...extra.map((d) => ['destOk', d]), ...segExtra.map((d) => ['segDestOk', d])];
  for (const [fn, d] of all) {
    const js = fn === 'destOk' ? destOk(d) : segDestOk(d);
    const sql = await one(db, `SELECT private.${fn === 'destOk' ? 'dest_ok' : 'seg_dest_ok'}($1::jsonb) AS ok`, [JSON.stringify(d ?? null)]);
    assert.equal(sql, js, `${fn}(${JSON.stringify(d)})`);
  }
  assert.equal(await one(db, 'SELECT private.dest_ok(NULL) AS ok'), true);
});

// ---------------------------------------------------------------------
// 4. 新建行程
// ---------------------------------------------------------------------

const createP = (over = {}) => ({
  token: 'tok-island-0001', title: '椰影岛 · 二刷', start_date: '2027-03-05', end_date: '2027-03-08',
  timezone: 'Asia/Ho_Chi_Minh', local_currency: 'vnd', cover: { emoji: '🏝️' },
  dest: { region: 'VN', cities: ['phu-quoc'], move: 'ride' }, short_name: '椰影岛',
  segments: [{ name: '椰影岛', name_en: 'Coco Isle', center_lat: 8.68, center_lng: 106.6, dest: { region: 'VN', city: 'phu-quoc' } }],
  copy_from: TRIP, ...over,
});

let newId;
test('create_trip_v2：一次写好行程、两人成员、一段、每天空白页、行李清单（清勾）、通用待办', async () => {
  const res = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP())]);
  newId = res.trip_id;
  assert.equal(newId, 'phu-quoc-2027', 'id 按第一个城市和年份起');
  assert.deepEqual({ ...res, added: undefined }, { trip_id: newId, days: 4, segments: 1, packing: 3, todos: 4, added: undefined, in_household: true, replay: false });
  assert.deepEqual(res.added, [C]);
  const trip = (await rows(db, 'SELECT * FROM public.trips WHERE id = $1', [newId]))[0];
  assert.equal(trip.owner_id, J);
  assert.equal(trip.local_currency, 'VND');
  assert.equal(trip.cover_emoji, '🏝️');
  assert.equal(trip.status, 'planning');
  assert.deepEqual(trip.extra, { dest: { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' }, short_name: '椰影岛', party_size: 2 });
  assert.ok(!('create_token' in trip.extra), 'token 不放进 extra');
  const mem = await rows(db, 'SELECT user_id, role, display_name, color FROM public.trip_members WHERE trip_id = $1 ORDER BY role DESC', [newId]);
  assert.deepEqual(mem, [
    { user_id: J, role: 'owner', display_name: 'Jeremy', color: '#2F6FDE' },
    { user_id: C, role: 'editor', display_name: 'Cathy', color: '#D9480F' },
  ]);
  const seg = (await rows(db, 'SELECT * FROM public.segments WHERE trip_id = $1', [newId]))[0];
  assert.equal(seg.name, '椰影岛');
  assert.equal(seg.timezone, null, '和行程同一个时区就不写');
  assert.deepEqual(seg.extra, { dest: { region: 'VN', city: 'phu-quoc' } });
  const days = await rows(db, "SELECT to_char(date, 'MM-DD') AS d, segment_id, title, planning_status FROM public.days WHERE trip_id = $1 ORDER BY date", [newId]);
  assert.deepEqual(days.map((d) => d.d), ['03-05', '03-06', '03-07', '03-08']);
  assert.ok(days.every((d) => d.segment_id === seg.id && d.title === '' && d.planning_status === 'tbd'));
  const todos = await rows(db, 'SELECT list, title, done, done_by, qty, assignee_user_id FROM public.todos WHERE trip_id = $1 ORDER BY list, sort', [newId]);
  assert.deepEqual(todos.filter((t) => t.list === 'packing').map((t) => [t.title, t.done, t.done_by, t.qty]),
    [['泳衣', false, null, 2], ['雨伞', false, null, null], ['防晒霜', false, null, null]]);
  assert.deepEqual(todos.filter((t) => t.list === 'todo').map((t) => t.title), ['买流量卡或 eSIM', '换点当地现金', '网上值机', '查入境要求（按你们的护照）']);
  // 对方马上能读到（RLS 按成员）
  assert.equal(await web(C, 'SELECT count(*)::int AS n FROM public.days WHERE trip_id = $1', [newId]), 4);
});

test('create_trip_v2：同一个 token 重发返回同一趟、不多建；换 token 同名 → id 自动加 -2', async () => {
  const again = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP())]);
  assert.equal(again.trip_id, newId);
  assert.equal(again.replay, true);
  assert.equal(await one(db, "SELECT count(*)::int FROM public.trips WHERE id LIKE 'phu-quoc-2027%'"), 1);
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.days WHERE trip_id = $1', [newId]), 4);
  const second = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-island-0002', copy_from: null, todos: [] }))]);
  assert.equal(second.trip_id, 'phu-quoc-2027-2');
  assert.equal(second.todos, 0, 'todos: [] = 一条都不带');
  assert.equal(second.packing, 0);
  // Cathy 用同一个 token 是另一回事（token 按人算）
  const cathys = await web(C, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ copy_from: null, id: 'cathy-trip' }))]);
  assert.equal(cathys.trip_id, 'cathy-trip');
  assert.deepEqual(cathys.added, [J]);
});

test('create_trip_v2：两个城市 → 两段，换城那天算新的一段；没给段就整趟一段；地区不同，通用待办不同', async () => {
  const res = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify({
    token: 'tok-two-cities', title: '雾港 · 南湾', start_date: '2027-05-01', end_date: '2027-05-05', timezone: 'Asia/Taipei', local_currency: 'TWD',
    dest: { region: 'TW', cities: ['kaohsiung', 'kenting'] },
    segments: [
      { name: '南湾', start_date: '2027-05-03', end_date: '2027-05-05', dest: { region: 'TW', city: 'kenting' } },
      { name: '雾港', start_date: '2027-05-01', end_date: '2027-05-03', dest: { region: 'TW', city: 'kaohsiung' } },
    ],
  })]);
  assert.equal(res.trip_id, 'kaohsiung-2027');
  const map = await rows(db, "SELECT to_char(d.date, 'DD') AS d, s.name FROM public.days d JOIN public.segments s ON s.id = d.segment_id WHERE d.trip_id = $1 ORDER BY d.date", [res.trip_id]);
  assert.deepEqual(map.map((r) => `${r.d}${r.name}`), ['01雾港', '02雾港', '03南湾', '04南湾', '05南湾']);
  assert.deepEqual((await rows(db, 'SELECT name, sort FROM public.segments WHERE trip_id = $1 ORDER BY sort', [res.trip_id])).map((r) => r.name), ['雾港', '南湾']);
  const todos = (await rows(db, "SELECT title FROM public.todos WHERE trip_id = $1 AND list = 'todo' ORDER BY sort", [res.trip_id])).map((r) => r.title);
  assert.deepEqual(todos, ['买流量卡或 eSIM', '换点当地现金', '网上值机', '查入境要求（按你们的护照）']);

  const hk = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify({
    token: 'tok-staycation', title: '在家附近玩两天', start_date: '2027-06-01', end_date: '2027-06-02', dest: { region: 'HK', cities: ['hong-kong'] }, with_partner: false,
  })]);
  assert.equal(hk.trip_id, 'hong-kong-2027');
  assert.deepEqual(hk.added, []);
  assert.equal(hk.todos, 0, '香港：不用流量卡、换汇、值机、查入境');
  const seg = (await rows(db, 'SELECT name, start_date::text, end_date::text, extra FROM public.segments WHERE trip_id = $1', [hk.trip_id]))[0];
  assert.deepEqual(seg, { name: '在家附近玩两天', start_date: '2027-06-01', end_date: '2027-06-02', extra: { dest: { region: 'HK', city: 'hong-kong' } } });
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.trip_members WHERE trip_id = $1', [hk.trip_id]), 1);
  assert.equal(await one(db, "SELECT extra ->> 'party_size' FROM public.trips WHERE id = $1", [hk.trip_id]), '1');
});

test('create_trip_v2：只选了国家（没有内置城市）→ id 是「国家英文名-年份」，和规则包 regionSlug 一样（两端都不自己起 id）', async () => {
  for (const code of [...Object.keys(REGIONS), 'XX', '', null]) {
    assert.equal(await one(db, 'SELECT private.region_slug($1) AS s', [code]), regionSlug(code), `region_slug(${code})`);
  }
  const res = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify({
    token: 'tok-country-only', title: '清莱 · 3 月', start_date: '2027-03-01', end_date: '2027-03-04', timezone: 'Asia/Bangkok', local_currency: 'THB',
    dest: { region: 'TH' }, segments: [{ name: '清莱', dest: { region: 'TH' } }], with_partner: false,
  })]);
  assert.equal(res.trip_id, 'thailand-2027');
});

test('create_trip_v2：校验（中文报错，什么都不写）', async () => {
  const bad = [
    [{ token: 'x' }, '缺少新建凭据（token），刷新一下再试'],
    [{ title: '  ' }, '行程名字不能为空'],
    [{ end_date: '2027-03-01' }, '回来的日期不能早于出发'],
    [{ end_date: '2027-05-05' }, '一趟最多 60 天'],
    [{ start_date: null }, '要选出发和回来的日期'],
    [{ timezone: 'Mars/Base' }, '时区不对（例如 Asia/Ho_Chi_Minh）'],
    [{ local_currency: 'dong' }, '币种要写三位代码（如 HKD、VND）'],
    [{ dest: { region: 'VN', move: 'fly' } }, '目的地的写法不对'],
    [{ id: 'Bad Id' }, '行程 id 只能用小写字母、数字、- 和 _，2 到 40 位'],
    [{ segments: [{ name: 'a', start_date: '2027-03-01' }] }, '「a」的日期不在这趟的日期里'],
    [{ segments: [{ name: 'a', start_date: '2027-03-05', end_date: '2027-03-07' }, { name: 'b', start_date: '2027-03-06', end_date: '2027-03-08' }] }, '几个城市的日期重叠了'],
    [{ segments: [{ name: '' }] }, '每个城市都要有名字'],
    [{ segments: [{ name: 'a', center_lat: 8 }] }, '「a」的位置不对'],
    [{ segments: [{ name: 'a', dest: { city: 'x' } }] }, '「a」的目的地写法不对'],
    [{ todos: [{ title: '' }] }, '待办的格式不对'],
    [{ copy_from: 'nobody-trip' }, '没法从那一趟带清单过来'],
  ];
  const n0 = await one(db, 'SELECT count(*)::int FROM public.trips');
  for (const [over, msg] of bad) {
    const e = await errOf(web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: `tok-bad-${msg.length}x`, ...over }))]));
    assert.equal(e.message, msg);
  }
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.trips'), n0);
});

// ---------------------------------------------------------------------
// 5. 改日期（S4）
// ---------------------------------------------------------------------

const setDates = (uid, trip, s, e, move = false) => web(uid, 'SELECT public.set_trip_dates($1, $2::date, $3::date, $4) AS r', [trip, s, e, move]);

test('set_trip_dates：加长补天（落到最后一段）、缩短删空天，首末分段跟着改', async () => {
  const id = 'kaohsiung-2027';
  let r = await setDates(J, id, '2027-04-30', '2027-05-07');
  assert.deepEqual({ added: r.added, removed: r.removed }, { added: 3, removed: 0 });
  const segs = async () => (await rows(db, "SELECT name, to_char(start_date, 'MM-DD') AS s, to_char(end_date, 'MM-DD') AS e FROM public.segments WHERE trip_id = $1 ORDER BY sort", [id])).map((x) => `${x.name} ${x.s}~${x.e}`);
  assert.deepEqual(await segs(), ['雾港 04-30~05-03', '南湾 05-03~05-07']);
  const map = await rows(db, "SELECT to_char(d.date, 'MM-DD') AS d, s.name FROM public.days d LEFT JOIN public.segments s ON s.id = d.segment_id WHERE d.trip_id = $1 ORDER BY d.date", [id]);
  assert.deepEqual(map.map((x) => `${x.d}${x.name}`), ['04-30雾港', '05-01雾港', '05-02雾港', '05-03南湾', '05-04南湾', '05-05南湾', '05-06南湾', '05-07南湾']);
  r = await setDates(J, id, '2027-05-02', '2027-05-04');
  assert.deepEqual({ added: r.added, removed: r.removed, moved: r.moved_items }, { added: 0, removed: 5, moved: 0 });
  assert.deepEqual(await segs(), ['雾港 05-02~05-03', '南湾 05-03~05-04']);
  assert.deepEqual((await rows(db, "SELECT start_date::text AS s, end_date::text AS e FROM public.trips WHERE id = $1", [id]))[0], { s: '2027-05-02', e: '2027-05-04' });
  // 再缩到只剩南湾：雾港整段在外面 → 日期清空（段还在）
  r = await setDates(J, id, '2027-05-04', '2027-05-04');
  assert.deepEqual(await segs(), ['雾港 null~null', '南湾 05-04~05-04']);
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.days WHERE trip_id = $1 AND segment_id IS NULL', [id]), 0);
});

test('set_trip_dates：有日记的天一律拦下；范围外的天有条目 / 住处 → 不带 move 报错（HINT need_move）', async () => {
  // demo-island：01-12（心情 + 正文）、01-13（只读成员）都有上面那批改动写的日记 → 带 move 也不行，报最早的那天
  let j = await errOf(setDates(J, TRIP, '2027-01-10', '2027-01-11', true));
  assert.equal(j.message, '1月12日 写了日记，先挪走再改');
  assert.equal(j.hint, 'journal');
  await db.query("UPDATE public.journal_entries SET body = '', mood = NULL WHERE trip_id = $1 AND day_id = $2", [TRIP, D3]);
  j = await errOf(setDates(J, TRIP, '2027-01-10', '2027-01-11', true));
  assert.equal(j.message, '1月13日 写了日记，先挪走再改', '01-12 清空了，接着报 01-13');
  // 日记都清空以后（空日记不算）：01-12 有住处 + 条目 → 要先挪
  await db.query("UPDATE public.journal_entries SET body = '   ' WHERE trip_id = $1 AND day_id = $2", [TRIP, D4]);
  const e = await errOf(setDates(J, TRIP, '2027-01-10', '2027-01-11'));
  assert.equal(e.hint, 'need_move');
  assert.match(e.message, /^1月12日 还有 \d+ 项、住处，先挪走再改$/);
  const detail = JSON.parse(e.detail);
  assert.deepEqual(detail.map((x) => [x.date, x.stay]), [['2027-01-12', true]], '空的 01-13 不算');
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.days WHERE trip_id = $1', [TRIP]), 4, '报错时什么都没删');
  // 只读成员、陌生人改不了
  assert.equal((await errOf(setDates(V, TRIP, '2027-01-10', '2027-01-11', true))).code, '42501');
  assert.equal((await errOf(setDates(S, TRIP, '2027-01-10', '2027-01-11', true))).code, '42501');
});

test('set_trip_dates：带 move 后条目 day_id 为空、待办解除关联、空日记跟着删；对方马上看得到', async () => {
  // 新建一趟 4 天的，第 4 天放条目、待办、空日记
  const res = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-dates-1', id: 'dates-test', copy_from: null, todos: [] }))]);
  const id = res.trip_id;
  const d4 = await one(db, "SELECT id FROM public.days WHERE trip_id = $1 AND date = '2027-03-08'", [id]);
  const rr = await applyOps(db, J, [
    op(1, 'item.add', { id: u(301), title: '最后一天的早饭', day_id: d4 }),
    op(2, 'todo.add', { id: u(302), title: '退房前拍照', day_id: d4 }),
    op(3, 'journal.put', { day_id: d4, id: u(303), body: '   ' }),
  ], id);
  assert.ok(rr.every((x) => x.ok), JSON.stringify(rr));
  let e = await errOf(setDates(J, id, '2027-03-05', '2027-03-07'));
  assert.equal(e.message, '3月8日 还有 1 项、1 条待办，先挪走再改');
  const r = await setDates(C, id, '2027-03-05', '2027-03-07', true);   // 对方（editor）也能改
  assert.deepEqual({ removed: r.removed, moved: r.moved_items, todos: r.unlinked_todos }, { removed: 1, moved: 1, todos: 1 });
  assert.equal(await one(db, 'SELECT day_id FROM public.items WHERE id = $1', [u(301)]), null);
  assert.equal(await one(db, 'SELECT day_id FROM public.todos WHERE id = $1', [u(302)]), null);
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.journal_entries WHERE id = $1', [u(303)]), 0);
  assert.equal(await one(db, "SELECT to_char(end_date, 'MM-DD') FROM public.segments WHERE trip_id = $1", [id]), '03-07');
  // 整趟挪一周（建错日期）：段跟着平移，天全换新
  const r2 = await setDates(J, id, '2027-03-12', '2027-03-14', true);
  assert.deepEqual({ added: r2.added, removed: r2.removed }, { added: 3, removed: 3 });
  assert.equal(await one(db, "SELECT to_char(start_date, 'MM-DD') || '~' || to_char(end_date, 'MM-DD') FROM public.segments WHERE trip_id = $1", [id]), '03-12~03-14');
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.days WHERE trip_id = $1 AND segment_id IS NULL', [id]), 0);
  // 日期本身不对
  e = await errOf(setDates(J, id, '2027-03-14', '2027-03-12'));
  assert.equal(e.message, '回来的日期不能早于出发');
});

// ---------------------------------------------------------------------
// 6. 改档案、拉对方
// ---------------------------------------------------------------------

const setDest = (uid, trip, patch, seg = null) => web(uid, 'SELECT public.set_trip_dest($1, $2::jsonb, $3::uuid) AS r', [trip, JSON.stringify(patch), seg]);

test('set_trip_dest：合并写（只改 ride，cities 和 extra 里别的键都还在）；null 去掉一个键；写错了报错', async () => {
  let row = await setDest(J, TRIP, { region: 'VN', cities: ['phu-quoc'] });
  assert.deepEqual(row.extra, { party_size: 2, ledger_mirror: true, dest: { v: 1, region: 'VN', cities: ['phu-quoc'] } });
  row = await setDest(C, TRIP, { ride: 'xanhsm' });
  assert.deepEqual(row.extra.dest, { v: 1, region: 'VN', cities: ['phu-quoc'], ride: 'xanhsm' });
  assert.equal(row.extra.ledger_mirror, true);
  row = await setDest(J, TRIP, { ride: null, move: 'ride' });
  assert.deepEqual(row.extra.dest, { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' });
  const ts = await one(db, 'SELECT updated_at::text FROM public.trips WHERE id = $1', [TRIP]);
  await setDest(J, TRIP, { move: 'ride' });
  assert.equal(await one(db, 'SELECT updated_at::text FROM public.trips WHERE id = $1', [TRIP]), ts, '没变化不写');
  assert.equal((await errOf(setDest(J, TRIP, { walk_km: 9 }))).message, '目的地的写法不对');
  await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-nodest', id: 'nodest-trip', dest: null, segments: null, copy_from: null }))]);
  assert.equal((await errOf(setDest(J, 'nodest-trip', { ride: 'uber' }))).message, '目的地的写法不对', '第一次写要带 region');
  assert.equal((await setDest(J, 'nodest-trip', { region: 'TW', ride: 'uber' })).extra.dest.region, 'TW');
  assert.equal((await errOf(setDest(V, TRIP, { move: 'walk' }))).code, '42501');
  assert.equal((await errOf(setDest(S, TRIP, { move: 'walk' }))).code, '42501');
  // 某一段
  row = await setDest(J, TRIP, { region: 'VN', city: 'phu-quoc', move: 'walk' }, SEG1);
  assert.deepEqual(row.extra, { dest: { region: 'VN', city: 'phu-quoc', move: 'walk' } });
  assert.equal((await errOf(setDest(J, TRIP, { region: 'VN' }, u(999)))).message, '这一段不在这个行程里');
  // 整个去掉
  row = await web(J, 'SELECT public.set_trip_dest($1, NULL, NULL) AS r', [TRIP]);
  assert.ok(!('dest' in row.extra));
  await setDest(J, TRIP, { region: 'VN', cities: ['phu-quoc'], move: 'ride' });
});

test('add_household_to_trip：只有自己时把对方加进来；重复调用不重复加；陌生人拉不动我们俩', async () => {
  const solo = await web(J, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-solo', id: 'solo-trip', with_partner: false, copy_from: null }))]);
  assert.deepEqual(solo.added, []);
  let r = await web(J, 'SELECT public.add_household_to_trip($1) AS r', ['solo-trip']);
  assert.deepEqual(r.added, [C]);
  assert.equal(r.members.length, 2);
  assert.equal(await one(db, "SELECT extra ->> 'party_size' FROM public.trips WHERE id = 'solo-trip'"), '2');
  r = await web(J, 'SELECT public.add_household_to_trip($1) AS r', ['solo-trip']);
  assert.deepEqual(r.added, []);
  assert.equal(await one(db, "SELECT count(*)::int FROM public.trip_members WHERE trip_id = 'solo-trip'"), 2);
  // 陌生人：能建自己的行程，但拉不进我们俩
  const s = await web(S, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-stranger', id: 'stranger-trip', copy_from: null }))]);
  assert.deepEqual({ added: s.added, in_household: s.in_household }, { added: [], in_household: false });
  r = await web(S, 'SELECT public.add_household_to_trip($1) AS r', ['stranger-trip']);
  assert.deepEqual(r.added, []);
  assert.equal(await one(db, "SELECT count(*)::int FROM public.trip_members WHERE trip_id = 'stranger-trip'"), 1);
  assert.equal((await errOf(web(S, 'SELECT public.add_household_to_trip($1) AS r', [TRIP]))).code, '42501');
  assert.equal((await errOf(web(V, 'SELECT public.add_household_to_trip($1) AS r', [TRIP]))).code, '42501');
  // 陌生人也带不走我们的行李清单
  assert.equal((await errOf(web(S, 'SELECT public.create_trip_v2($1::jsonb) AS r', [JSON.stringify(createP({ token: 'tok-stranger-2' }))]))).message, '没法从那一趟带清单过来');
});

// ---------------------------------------------------------------------
// 7. 小程序入口 wx_bridge_trip_admin
// ---------------------------------------------------------------------

test('wx_bridge_trip_admin：新建（重放）、改日期、改档案、拉对方、删掉这趟；结果带 trips', async () => {
  const p = createP({ token: 'tok-wx-0001', title: '小程序里建的', id: null, copy_from: TRIP });
  let out = await bridge(J, 'create', p);
  const id = out.result.trip_id;
  assert.equal(id, 'phu-quoc-2027-3');
  assert.equal(out.me, J);
  assert.ok(out.trips.some((t) => t.id === id && t.role === 'owner'));
  out = await bridge(J, 'create', p);
  assert.equal(out.result.replay, true);
  assert.equal(out.result.trip_id, id);
  // 改日期：中文报错 + HINT
  const d = await one(db, "SELECT id FROM public.days WHERE trip_id = $1 AND date = '2027-03-08'", [id]);
  await applyOps(db, J, [op(1, 'item.add', { id: u(401), title: '最后一天', day_id: d })], id);
  let e = await errOf(bridge(J, 'set_dates', { trip_id: id, start_date: '2027-03-05', end_date: '2027-03-07' }));
  assert.equal(e.message, '3月8日 还有 1 项，先挪走再改');
  assert.equal(e.hint, 'need_move');
  out = await bridge(C, 'set_dates', { trip_id: id, start_date: '2027-03-05', end_date: '2027-03-07', move_to_pool: true });
  assert.equal(out.result.moved_items, 1);
  e = await errOf(bridge(J, 'set_dates', { trip_id: id, start_date: '三月', end_date: '2027-03-07' }));
  assert.equal(e.message, '日期或时间的格式不对', '数据库的英文报错换成中文');
  // 改档案
  out = await bridge(C, 'set_dest', { trip_id: id, dest: { ride: 'be' } });
  assert.equal(out.result.extra.dest.ride, 'be');
  assert.equal(out.result.extra.dest.move, 'ride');
  assert.equal((await errOf(bridge(C, 'set_dest', { trip_id: id }))).message, '缺少目的地');
  // 拉对方（已经在了）
  out = await bridge(J, 'add_partner', { trip_id: id });
  assert.deepEqual(out.result.added, []);
  // 删掉这趟：只有 owner、要确认；记了账的不让删
  assert.equal((await errOf(bridge(C, 'delete', { trip_id: id, confirm: id }))).code, '42501');
  assert.equal((await errOf(bridge(J, 'delete', { trip_id: id }))).message, '删之前要再确认一次');
  await applyOps(db, J, [op(2, 'expense.put', { id: u(402), amount: 1000 })], id);
  assert.equal((await errOf(bridge(J, 'delete', { trip_id: id, confirm: id }))).message, '这趟记了账或写了日记，到网页上删');
  await applyOps(db, J, [op(3, 'expense.delete', { id: u(402) })], id);
  out = await bridge(J, 'delete', { trip_id: id, confirm: id });
  assert.deepEqual(out.result, { deleted: id });
  assert.ok(!out.trips.some((t) => t.id === id));
  assert.equal(await one(db, 'SELECT count(*)::int FROM public.days WHERE trip_id = $1', [id]), 0);
  assert.equal(await one(db, 'SELECT count(*)::int FROM private.trip_create_tokens WHERE trip_id = $1', [id]), 0, '凭据跟着删');
  // 不认识的操作、认不出人
  assert.equal((await errOf(bridge(J, 'rename', {}))).message, '不认识的操作：rename');
  const bad = await errOf(asRole(db, 'anon', null, 'SELECT public.wx_bridge_trip_admin($1, $2, $3, $4::jsonb)', ['x'.repeat(48), OPENID[J], 'create', '{}']));
  assert.equal(bad.message, '未授权');
  // 陌生人经小程序也一样：能建自己的，改不了我们的
  assert.equal((await errOf(bridge(S, 'set_dates', { trip_id: TRIP, start_date: '2027-01-10', end_date: '2027-01-13' }))).code, '42501');
});

// ---------------------------------------------------------------------
// 8. 权限
// ---------------------------------------------------------------------

test('权限：anon 调不了网页入口；authenticated 调不了小程序入口；私有函数和表谁都碰不到', async () => {
  const denied = async (role, sql, params = []) => {
    const e = await errOf(asRole(db, role, role === 'authenticated' ? J : null, sql, params));
    assert.equal(e.code, '42501', `${role}: ${sql} → ${e.message}`);
  };
  await denied('anon', 'SELECT public.create_trip_v2($1::jsonb)', [JSON.stringify(createP({ token: 'tok-anon' }))]);
  await denied('anon', "SELECT public.set_trip_dates('demo-island', '2027-01-10', '2027-01-13')");
  await denied('anon', "SELECT public.set_trip_dest('demo-island', '{}'::jsonb)");
  await denied('anon', "SELECT public.add_household_to_trip('demo-island')");
  await denied('authenticated', 'SELECT public.wx_bridge_trip_admin($1, $2, $3, $4::jsonb)', [KEY, OPENID[J], 'create', '{}']);
  for (const role of ['anon', 'authenticated']) {
    await denied(role, `SELECT private.create_trip_full('${J}'::uuid, '{}'::jsonb)`);
    await denied(role, `SELECT private.add_household('${TRIP}', '${S}'::uuid)`);
    await denied(role, `SELECT private.wx_op_ext('${J}'::uuid, '${TRIP}', '{}'::jsonb)`);
    await denied(role, 'SELECT count(*) FROM private.household');
    await denied(role, 'SELECT count(*) FROM private.trip_create_tokens');
  }
  // 网页入口没登录（authenticated 但没有 sub）也不行
  const e = await errOf(asRole(db, 'authenticated', null, 'SELECT public.create_trip_v2($1::jsonb)', [JSON.stringify(createP({ token: 'tok-nosub' }))]));
  assert.equal(e.message, '需要先登录');
  // 老入口照旧：authenticated 能 create_trip，anon 能 wx_bridge_sync
  assert.equal(await web(J, "SELECT public.create_trip('old-style', '老写法') AS r"), 'old-style');
  const sync = await asRole(db, 'anon', null, 'SELECT public.wx_bridge_sync($1, $2, $3) AS r', [KEY, OPENID[C], TRIP]);
  assert.equal(sync.me, C);
  assert.ok(sync.tables.items.length > 0);
});

test('迁移再跑一遍：函数、数据都不受影响', async () => {
  const before = await tableState(db);
  await runFile(db, MIG);
  assert.deepEqual(await tableState(db), before);
  assert.equal(await one(db, 'SELECT count(*)::int FROM private.household'), 2);
});
