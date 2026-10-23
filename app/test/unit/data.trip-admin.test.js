// 数据层 · 平台化批 A 的 RPC（data/rpc.js + 演示后台）：新建行程 createTripV2（重试、两人成员、分段、每天空白页、行李清单、
// 通用待办）、改日期 setTripDates（有日记的天、挪进备选池、首末分段）、改档案 setTripDest（合并写）、拉对方 addPartner。
// 规则和报错与 supabase/migrations/20261022090000_platform_a.sql 一样（那边的 PGlite 测试在 supabase/tests/platform-a.test.mjs）。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestLayer, disposeLayers, JEREMY, CATHY } from './helpers/data.js';

afterEach(disposeLayers);

const stranger = '99999999-9999-4999-8999-999999999999';
const base = (over = {}) => ({
  token: 'form-token-0001', title: '椰影岛 · 二刷', startDate: '2027-03-05', endDate: '2027-03-08', timezone: 'Asia/Ho_Chi_Minh',
  localCurrency: 'vnd', cover: { emoji: '🏝️' }, dest: { region: 'VN', cities: ['phu-quoc'], move: 'ride' }, shortName: '椰影岛',
  segments: [{ name: '椰影岛', lat: 8.68, lng: 106.6, dest: { region: 'VN', city: 'phu-quoc' } }], copyFrom: 'demo-island', ...over,
});
const bundle = (layer, backend, tripId) => backend.fetchTripBundle(tripId);

test('createTripV2：一次建好；id 按城市和年份起；对方是 editor；每天一页；行李清单清勾；越南带 4 条通用待办', async () => {
  const { layer, backend } = await createTestLayer();
  const r = await layer.rpc.createTripV2(base());
  assert.deepEqual(r, { tripId: 'phu-quoc-2027', days: 4, segments: 1, packing: 26, todos: 4, added: [CATHY], inHousehold: true, replay: false });
  const b = await bundle(layer, backend, r.tripId);
  assert.equal(b.trips[0].owner_id, JEREMY);
  assert.deepEqual(b.trips[0].extra, { dest: { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' }, short_name: '椰影岛', party_size: 2 });
  assert.equal(b.trips[0].local_currency, 'VND');
  assert.deepEqual(b.trip_members.map((m) => [m.user_id, m.role, m.display_name]).sort(), [[CATHY, 'editor', 'Cathy'], [JEREMY, 'owner', 'Jeremy']].sort());
  assert.deepEqual(b.days.map((d) => d.date).sort(), ['2027-03-05', '2027-03-06', '2027-03-07', '2027-03-08']);
  assert.ok(b.days.every((d) => d.segment_id === b.segments[0].id && d.title === '' && d.planning_status === 'tbd'));
  assert.deepEqual(b.segments[0].extra, { dest: { region: 'VN', city: 'phu-quoc' } });
  assert.equal(b.segments[0].timezone, null);
  const packing = b.todos.filter((t) => t.list === 'packing');
  assert.equal(packing.length, 26);
  assert.ok(packing.every((t) => t.done === false && !t.done_by && !t.assignee_user_id && !t.day_id));
  assert.deepEqual(b.todos.filter((t) => t.list === 'todo').sort((x, y) => x.sort - y.sort).map((t) => t.title),
    ['买流量卡或 eSIM', '换点当地现金', '网上值机', '查入境要求（按你们的护照）']);
  // 列表里有了、自己是 owner；对方也看得到
  assert.equal(layer.trips.state.value.entries.find((e) => e.id === r.tripId).role, 'owner');
  assert.ok((await backend.fetchMyTrips(CATHY)).trips.some((t) => t.id === r.tripId), '对方的行程列表里也有');
});

test('createTripV2：同一个 token 重发返回同一趟、不多建；换 token → id 加 -2；token 按人算', async () => {
  const { layer, backend } = await createTestLayer();
  const a = await layer.rpc.createTripV2(base());
  const again = await layer.rpc.createTripV2(base());
  assert.equal(again.tripId, a.tripId);
  assert.equal(again.replay, true);
  assert.equal((await backend.fetchTripBundle(a.tripId)).days.length, 4);
  const b = await layer.rpc.createTripV2(base({ token: 'form-token-0002', copyFrom: null, todos: [] }));
  assert.equal(b.tripId, 'phu-quoc-2027-2');
  assert.deepEqual([b.packing, b.todos], [0, 0]);
  const c = await backend.demo.as(CATHY).rpc('create_trip_v2', { p: { token: 'form-token-0001', title: 'Cathy 建的', start_date: '2027-03-05', end_date: '2027-03-05', id: 'cathy-trip' } });
  assert.equal(c.trip_id, 'cathy-trip');
  assert.deepEqual(c.added, [JEREMY]);
});

test('createTripV2：两个城市两段（换城那天算新的一段）；香港不带通用待办；不带对方', async () => {
  const { layer, backend } = await createTestLayer();
  const r = await layer.rpc.createTripV2({
    token: 'form-two-cities', title: '雾港 · 南湾', startDate: '2027-05-01', endDate: '2027-05-05', timezone: 'Asia/Taipei', localCurrency: 'TWD',
    dest: { region: 'TW', cities: ['kaohsiung', 'kenting'] },
    segments: [
      { name: '南湾', startDate: '2027-05-03', endDate: '2027-05-05', dest: { region: 'TW', city: 'kenting' } },
      { name: '雾港', startDate: '2027-05-01', endDate: '2027-05-03', dest: { region: 'TW', city: 'kaohsiung' } },
    ],
  });
  assert.equal(r.tripId, 'kaohsiung-2027');
  const b = await backend.fetchTripBundle(r.tripId);
  const segName = Object.fromEntries(b.segments.map((s) => [s.id, s.name]));
  assert.deepEqual(b.days.sort((x, y) => (x.date < y.date ? -1 : 1)).map((d) => `${d.date.slice(8)}${segName[d.segment_id]}`), ['01雾港', '02雾港', '03南湾', '04南湾', '05南湾']);
  assert.deepEqual(b.segments.sort((x, y) => x.sort - y.sort).map((s) => s.name), ['雾港', '南湾']);
  const hk = await layer.rpc.createTripV2({ token: 'form-staycation', title: '在家附近玩两天', startDate: '2027-06-01', endDate: '2027-06-02', dest: { region: 'HK', cities: ['hong-kong'] }, withPartner: false });
  assert.deepEqual([hk.tripId, hk.todos, hk.added], ['hong-kong-2027', 0, []]);
  const hb = await backend.fetchTripBundle(hk.tripId);
  assert.equal(hb.trip_members.length, 1);
  assert.equal(hb.trips[0].extra.party_size, 1);
  assert.deepEqual(hb.segments.map((s) => [s.name, s.start_date, s.end_date, s.extra]), [['在家附近玩两天', '2027-06-01', '2027-06-02', { dest: { region: 'HK', city: 'hong-kong' } }]]);
});

test('createTripV2：先在本地挡（中文提示、不发请求）；服务器的规则和迁移一样', async () => {
  const { layer, backend } = await createTestLayer();
  await assert.rejects(layer.rpc.createTripV2(base({ title: ' ' })), /行程名字不能为空/);
  await assert.rejects(layer.rpc.createTripV2(base({ endDate: '2027-03-01' })), /回来的日期不能早于出发/);
  await assert.rejects(layer.rpc.createTripV2(base({ endDate: '2027-05-05' })), /一趟最多 60 天/);
  await assert.rejects(layer.rpc.createTripV2(base({ dest: { region: 'VN', move: 'fly' } })), /目的地的写法不对/);
  await assert.rejects(layer.rpc.createTripV2(base({ timezone: 'Mars/Base' })), /时区不对/);
  await assert.rejects(layer.rpc.createTripV2(base({ segments: [{ name: 'a', dest: { city: 'x' } }] })), /「a」的目的地写法不对/);
  // 这些只有服务器知道
  await assert.rejects(layer.rpc.createTripV2(base({ segments: [{ name: 'a', startDate: '2027-03-05', endDate: '2027-03-07' }, { name: 'b', startDate: '2027-03-06' }] })), /几个城市的日期重叠了/);
  await assert.rejects(layer.rpc.createTripV2(base({ copyFrom: 'nobody-trip' })), /没法从那一趟带清单过来/);
  await assert.rejects(backend.demo.as(JEREMY).rpc('create_trip_v2', { p: { title: 'x', start_date: '2027-01-01', end_date: '2027-01-01' } }), /缺少新建凭据/);
  // 陌生人：能建自己的，但拉不进我们俩、带不走我们的清单
  const s = await backend.demo.as(stranger).rpc('create_trip_v2', { p: { token: 'stranger-0001', title: '陌生人的', start_date: '2027-01-01', end_date: '2027-01-01' } });
  assert.deepEqual([s.added, s.in_household], [[], false]);
  await assert.rejects(backend.demo.as(stranger).rpc('create_trip_v2', { p: { token: 'stranger-0002', title: 'x', start_date: '2027-01-01', end_date: '2027-01-01', copy_from: 'demo-island' } }), /没法从那一趟带清单过来/);
});

test('setTripDates：有日记的天拦下；有条目的天不带 moveToPool → field need_move（带每天件数）；带了挪进备选池', async () => {
  const { layer, backend } = await createTestLayer();
  // demo-island 01-10、01-11 写了日记
  let e = await layer.rpc.setTripDates('demo-island', { startDate: '2027-01-12', endDate: '2027-01-13', moveToPool: true }).catch((x) => x);
  assert.equal(e.field, 'journal');
  assert.equal(e.message, '1月10日 写了日记，先挪走再改');
  e = await layer.rpc.setTripDates('demo-island', { startDate: '2027-01-10', endDate: '2027-01-12' }).catch((x) => x);
  assert.equal(e.field, 'need_move');
  assert.equal(e.message, '1月13日 还有 11 项，先挪走再改');
  assert.deepEqual(e.days, [{ date: '2027-01-13', items: 11, todos: 0, tips: 0, stay: false }]);
  const r = await layer.rpc.setTripDates('demo-island', { startDate: '2027-01-10', endDate: '2027-01-12', moveToPool: true });
  assert.deepEqual({ removed: r.removed, moved: r.movedItems, added: r.added }, { removed: 1, moved: 11, added: 0 });
  const b = await backend.fetchTripBundle('demo-island');
  assert.equal(b.days.length, 3);
  assert.equal(b.trips[0].end_date, '2027-01-12');
  const segs = b.segments.sort((x, y) => x.sort - y.sort).map((s) => [s.name, s.start_date, s.end_date]);
  assert.deepEqual(segs, [['椰影镇', '2027-01-10', '2027-01-12'], ['南岬', '2027-01-12', '2027-01-12']]);
  // 加长：补天，落到最后一段
  const r2 = await layer.rpc.setTripDates('demo-island', { startDate: '2027-01-10', endDate: '2027-01-14' });
  assert.equal(r2.added, 2);
  const b2 = await backend.fetchTripBundle('demo-island');
  const south = b2.segments.find((s) => s.name === '南岬');
  assert.equal(south.end_date, '2027-01-14');
  assert.ok(b2.days.filter((d) => d.date >= '2027-01-13').every((d) => d.segment_id === south.id));
  // 只读 / 陌生人改不了
  await assert.rejects(backend.demo.as(stranger).rpc('set_trip_dates', { p_trip_id: 'demo-island', p_start_date: '2027-01-10', p_end_date: '2027-01-11' }), /只有能编辑这个行程的人才能改日期/);
});

test('setTripDates：整趟挪（建错日期）→ 分段平移、天全换新；空行程直接改', async () => {
  const { layer, backend } = await createTestLayer();
  const r = await layer.rpc.createTripV2(base({ token: 'form-shift', copyFrom: null, todos: [] }));
  const moved = await layer.rpc.setTripDates(r.tripId, { startDate: '2027-03-12', endDate: '2027-03-14' });
  assert.deepEqual({ added: moved.added, removed: moved.removed }, { added: 3, removed: 4 });
  const b = await backend.fetchTripBundle(r.tripId);
  assert.deepEqual([b.segments[0].start_date, b.segments[0].end_date], ['2027-03-12', '2027-03-14']);
  assert.ok(b.days.every((d) => d.segment_id === b.segments[0].id));
  assert.equal(layer.trips.state.value.entries.find((x) => x.id === r.tripId).trip.start_date, '2027-03-12', '列表跟着刷新');
});

test('setTripDest：合并写，只改 ride，extra 里别的键（party_size、ledger_*）都还在；null 去掉一个键；某一段', async () => {
  const { layer, backend } = await createTestLayer();
  let row = await layer.rpc.setTripDest('demo-island', { region: 'VN', cities: ['phu-quoc'] });
  assert.deepEqual(row.extra, { party_size: 2, dest: { v: 1, region: 'VN', cities: ['phu-quoc'] } });
  row = await backend.demo.as(CATHY).rpc('set_trip_dest', { p_trip_id: 'demo-island', p_patch: { ride: 'xanhsm' }, p_segment_id: null });
  assert.deepEqual(row.extra.dest, { v: 1, region: 'VN', cities: ['phu-quoc'], ride: 'xanhsm' });
  row = await layer.rpc.setTripDest('demo-island', { ride: null, move: 'ride' });
  assert.deepEqual(row.extra.dest, { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' });
  await assert.rejects(layer.rpc.setTripDest('demo-island', { walk_km: 9 }), /目的地的写法不对/);
  await assert.rejects(layer.rpc.setTripDest('demo-empty', { ride: 'uber' }), /目的地的写法不对/, '第一次写要带 region');
  await assert.rejects(layer.rpc.setTripDest('demo-island', 'VN'), /目的地的写法不对/);
  await assert.rejects(backend.demo.as(stranger).rpc('set_trip_dest', { p_trip_id: 'demo-island', p_patch: { move: 'walk' } }), /只有能编辑这个行程的人才能改/);
  const seg = (await backend.fetchTripBundle('demo-island')).segments.find((s) => s.name === '南岬');
  row = await layer.rpc.setTripDest('demo-island', { region: 'VN', city: 'phu-quoc', move: 'walk' }, { segmentId: seg.id });
  assert.deepEqual(row.extra.dest, { region: 'VN', city: 'phu-quoc', move: 'walk' });
  row = await layer.rpc.setTripDest('demo-island', null);
  assert.ok(!('dest' in row.extra));
  // 网页的行程数据实时跟上
  const s = layer.openTrip('demo-island');
  await s.open();
  await layer.rpc.setTripDest('demo-island', { region: 'VN', move: 'ride' });
  const until = Date.now() + 1000;
  while (s.view.trip.value?.extra?.dest?.move !== 'ride' && Date.now() < until) await new Promise((x) => setTimeout(x, 10));
  assert.equal(s.view.trip.value.extra.dest.move, 'ride');
});

test('addPartner：只有自己时把对方加进来、人数跟着改；再点一次不重复；陌生人拉不动', async () => {
  const { layer, backend } = await createTestLayer();
  const r = await layer.rpc.createTripV2(base({ token: 'form-solo', withPartner: false, copyFrom: null }));
  assert.deepEqual(r.added, []);
  let p = await layer.rpc.addPartner(r.tripId);
  assert.deepEqual(p.added, [CATHY]);
  assert.equal(p.members.length, 2);
  assert.equal((await backend.fetchTripBundle(r.tripId)).trips[0].extra.party_size, 2);
  p = await layer.rpc.addPartner(r.tripId);
  assert.deepEqual(p.added, []);
  assert.equal((await backend.fetchTripBundle(r.tripId)).trip_members.length, 2);
  const s = await backend.demo.as(stranger).rpc('create_trip_v2', { p: { token: 'stranger-solo', title: 'x', start_date: '2027-01-01', end_date: '2027-01-01' } });
  const sp = await backend.demo.as(stranger).rpc('add_household_to_trip', { p_trip_id: s.trip_id });
  assert.deepEqual([sp.added, sp.in_household], [[], false]);
  await assert.rejects(backend.demo.as(stranger).rpc('add_household_to_trip', { p_trip_id: 'demo-island' }), /只有能编辑这个行程的人才能拉人进来/);
});

test('都要联网：离线时直接说，不发请求', async () => {
  const { layer } = await createTestLayer({ isOnline: () => false });
  await assert.rejects(layer.rpc.createTripV2(base()), /新建行程需要联网/);
  await assert.rejects(layer.rpc.setTripDates('demo-island', { startDate: '2027-01-10', endDate: '2027-01-12' }), /改日期需要联网/);
  await assert.rejects(layer.rpc.setTripDest('demo-island', { move: 'ride' }), /改目的地需要联网/);
  await assert.rejects(layer.rpc.addPartner('demo-island'), /拉对方进来需要联网/);
});
