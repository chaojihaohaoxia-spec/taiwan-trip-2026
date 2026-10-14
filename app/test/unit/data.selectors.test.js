// 数据层 · 派生计算（data/selectors.js）：今天 / 阶段 / 第几天 / 倒计时（按行程时区）、条目排序、主方案和备选、
// 当前和下一项、地图路线点、住处和天气点、预算汇总、记账汇总和结算、清单进度、截止提醒、搜索。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/data/selectors.js';
import { createFx } from '../../src/data/fx.js';
import { loadDemoDb, JEREMY, CATHY } from './helpers/data.js';

const db = loadDemoDb();
const island = S.bundleFromRows('demo-island', db.tables);
const cities = S.bundleFromRows('demo-cities', db.tables);
const at = (iso) => new Date(iso);

// 造一个最小的数据包
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function bundle(o = {}) {
  const trip = { id: 't1', title: '测试', start_date: '2027-01-10', end_date: '2027-01-13', timezone: 'Asia/Ho_Chi_Minh', home_currency: 'HKD', local_currency: 'VND', owner_id: JEREMY, extra: {}, ...o.trip };
  const rows = {
    trips: [trip],
    trip_members: o.members || [
      { trip_id: 't1', user_id: JEREMY, role: 'editor', display_name: 'Jeremy', email: 'jeremy@example.com', joined_at: '2026-01-01T00:00:00+00:00' },
      { trip_id: 't1', user_id: CATHY, role: 'editor', display_name: 'Cathy', email: 'cathy@example.com', joined_at: '2026-01-02T00:00:00+00:00' },
    ],
  };
  for (const t of ['segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'journal_entries', 'reviews', 'expenses']) rows[t] = (o[t] || []).map((r) => ({ trip_id: 't1', created_at: '2026-01-01T00:00:00+00:00', ...r }));
  return S.bundleFromRows('t1', rows);
}

test('今天、阶段、倒计时都按行程时区（越南 UTC+7），和设备时区无关', () => {
  const trip = island.trip;
  assert.equal(trip.timezone, 'Asia/Ho_Chi_Minh');
  // 越南 1 月 9 日 23:59:59 = UTC 16:59:59
  let c = S.countdown(trip, at('2027-01-09T16:59:59Z'));
  assert.equal(c.phase, 'upcoming');
  assert.equal(c.label, '明天出发');
  assert.equal(c.msUntilStart, 1000, '离当地零点还有 1 秒');
  c = S.countdown(trip, at('2027-01-09T17:00:00Z'));
  assert.deepEqual([c.phase, c.dayNumber, c.totalDays, c.label], ['ongoing', 1, 4, '第 1 天 · 共 4 天']);
  c = S.countdown(trip, at('2027-01-13T16:59:00Z'));
  assert.equal(c.isLastDay, true);
  c = S.countdown(trip, at('2027-01-13T17:00:00Z'));
  assert.deepEqual([c.phase, c.label], ['ended', '昨天结束']);
  c = S.countdown(trip, at('2027-01-20T05:00:00Z'));
  assert.equal(c.label, '已结束 7 天');
  c = S.countdown(trip, at('2026-12-01T00:00:00Z'));
  assert.equal(c.label, '还有 40 天出发');
  assert.equal(S.tripPhase(trip, at('2027-01-11T00:00:00Z')).label, '进行中');
  assert.deepEqual(S.countdown({ title: 'x' }, new Date()), { phase: 'undated', label: '日期未定', today: null });
  assert.equal(S.tripPhase(null).phase, 'undated');
});

test('第几天、行程天数、每一个日期', () => {
  const trip = island.trip;
  assert.equal(S.dayNumber(trip, '2027-01-10'), 1);
  assert.equal(S.dayNumber(trip, '2027-01-13'), 4);
  assert.equal(S.dayNumber(trip, '2027-01-09'), 0);
  assert.equal(S.tripLength(trip), 4);
  assert.deepEqual(S.tripDates(trip), ['2027-01-10', '2027-01-11', '2027-01-12', '2027-01-13']);
  assert.deepEqual(S.tripDates({ start_date: '2027-02-27', end_date: '2027-03-01' }), ['2027-02-27', '2027-02-28', '2027-03-01']);
  assert.equal(S.dayNumber({}, '2027-01-01'), null);
});

test('当天条目排序：sort_key → start_time（空值在后）→ created_at → id', () => {
  const rows = [
    { id: 'e', sort_key: 20, start_time: null, created_at: '2026-01-01T00:00:00+00:00' },
    { id: 'd', sort_key: 10, start_time: null, created_at: '2026-01-01T00:00:00+00:00' },
    { id: 'c', sort_key: 10, start_time: '09:00:00', created_at: '2026-01-03T00:00:00+00:00' },
    { id: 'b', sort_key: 10, start_time: '09:00:00', created_at: '2026-01-02T00:00:00+00:00' },
    { id: 'a', sort_key: 10, start_time: '08:30:00', created_at: '2026-01-05T00:00:00+00:00' },
    { id: 'f', sort_key: 5.5, start_time: '23:00:00', created_at: '2026-01-05T00:00:00+00:00' },
  ];
  assert.deepEqual([...rows].sort(S.compareItems).map((r) => r.id), ['f', 'a', 'b', 'c', 'd', 'e']);
});

test('按天分组：软删除的不显示；没排进哪天的在备选池', () => {
  const b = bundle({
    days: [{ id: 'D1', date: '2027-01-10' }],
    items: [
      { id: 'i1', day_id: 'D1', sort_key: 10, title: 'A', variant: 'primary', status: 'planned' },
      { id: 'i2', day_id: 'D1', sort_key: 20, title: 'B', variant: 'primary', status: 'planned', deleted_at: '2027-01-01T00:00:00+00:00' },
      { id: 'i3', day_id: null, sort_key: 10, title: '池', variant: 'primary', status: 'planned' },
    ],
  });
  const g = S.itemsByDay(b.items);
  assert.deepEqual(g.get('D1').map((i) => i.id), ['i1']);
  assert.deepEqual(S.poolItems(b.items).map((i) => i.id), ['i3']);
});

test('主方案和备选：挂在主方案下的 backup / rain，没挂的是当天通用备选', () => {
  const list = [
    { id: 'p1', variant: 'primary' },
    { id: 'r1', variant: 'rain', parent_item_id: 'p1' },
    { id: 'b1', variant: 'backup', parent_item_id: 'p1' },
    { id: 'g1', variant: 'backup', parent_item_id: null },
    { id: 'o1', variant: 'rain', parent_item_id: 'gone' },
    { id: 'p2', variant: 'primary' },
  ];
  const plan = S.dayPlan(list);
  assert.deepEqual(plan.primary.map((i) => i.id), ['p1', 'p2']);
  assert.deepEqual(plan.alternatives.get('p1').map((i) => i.id), ['r1', 'b1']);
  assert.deepEqual(plan.general.map((i) => i.id), ['g1', 'o1']);
  // 演示数据：海岛第一天夜市下面挂着一个雨天方案，另有一个当天通用的雨天方案
  const d1 = [...island.days.values()].find((d) => d.date === '2027-01-10');
  const p = S.dayPlan(S.itemsByDay(island.items).get(d1.id));
  const market = p.primary.find((i) => i.kind === 'night_market');
  assert.deepEqual(p.alternatives.get(market.id).map((i) => i.variant), ['rain']);
  assert.ok(p.general.some((i) => i.variant === 'rain'), '当天通用的雨天方案');
  assert.ok([...p.alternatives.values()].flat().every((i) => i.variant !== 'primary'));
});

test('当前进行中和下一项：只看计划中的主方案；没写结束时间的持续到下一条开始（最多 2 小时）；跨午夜', () => {
  const items = [
    { id: 'a', status: 'planned', start_time: '09:00:00', end_time: '10:00:00' },
    { id: 'b', status: 'done', start_time: '10:30:00', end_time: null },
    { id: 'c', status: 'planned', start_time: '11:00:00', end_time: null },
    { id: 'd', status: 'planned', start_time: '12:00:00', end_time: null },
    { id: 'e', status: 'planned', start_time: '23:00:00', end_time: '01:00:00' },
    { id: 'f', status: 'planned', start_time: null },
  ];
  let r = S.currentAndNext(items, 9 * 60 + 30);
  assert.deepEqual([r.current?.id, r.next?.id, r.minutesUntilNext], ['a', 'c', 90]);
  r = S.currentAndNext(items, 10 * 60 + 45);
  assert.deepEqual([r.current, r.next?.id], [null, 'c'], 'b 已完成，不算');
  r = S.currentAndNext(items, 11 * 60 + 30);
  assert.equal(r.current.id, 'c');
  r = S.currentAndNext(items, 23 * 60 + 30);
  assert.equal(r.current.id, 'e', '23:00–01:00 跨午夜');
  assert.equal(r.next, null);
  assert.deepEqual(S.itemSpan({ start_time: '23:00:00', end_time: '01:00:00' }), { start: 1380, end: 1500 });
});

test('今天概况：把“现在”换算到当天时区找到当前 / 下一项', () => {
  const s = S.todaySummary(island, null, at('2027-01-10T08:00:00+07:00'));
  assert.equal(s.day.date, '2027-01-10');
  assert.equal(s.local.time, '08:00:00');
  assert.ok(s.next, '早上 8 点，下一项是第一条有时间的条目');
  assert.equal(S.todaySummary(island, null, at('2026-10-01T00:00:00Z')).day, null, '行程之外没有今天');
});

test('地点坐标：没有坐标退回分段中心并标明“位置未知”', () => {
  const b = bundle({
    segments: [{ id: 'S1', name: '岛', sort: 10, center_lat: 10, center_lng: 106 }],
    places: [
      { id: 'P1', name: '有坐标', lat: 10.1, lng: 106.1, coord_precision: 'exact' },
      { id: 'P2', name: '大概', lat: 10.2, lng: 106.2, coord_precision: 'approximate' },
      { id: 'P3', name: '不知道', lat: null, lng: null, segment_id: 'S1' },
      { id: 'P4', name: '完全不知道', lat: null, lng: null },
    ],
  });
  assert.deepEqual(S.placeCoords(b, 'P1'), { lat: 10.1, lng: 106.1, precision: 'exact', approximate: false, unknown: false });
  assert.equal(S.placeCoords(b, 'P2').approximate, true);
  assert.deepEqual(S.placeCoords(b, 'P3'), { lat: 10, lng: 106, precision: 'city', approximate: true, unknown: true });
  assert.equal(S.placeCoords(b, 'P4'), null);
});

test('当天地图路线：主方案、未删除、按顺序；连续同一地点算一个点；没坐标的列在 missing', () => {
  const b = bundle({
    places: [
      { id: 'A', name: 'A', lat: 1, lng: 1 }, { id: 'B', name: 'B', lat: 2, lng: 2 }, { id: 'C', name: 'C', lat: null, lng: null },
    ],
    days: [{ id: 'D1', date: '2027-01-10' }],
    items: [
      { id: 'i1', day_id: 'D1', sort_key: 10, title: '1', variant: 'primary', place_id: 'A' },
      { id: 'i2', day_id: 'D1', sort_key: 20, title: '2', variant: 'primary', place_id: 'A' },
      { id: 'i3', day_id: 'D1', sort_key: 30, title: '3', variant: 'rain', place_id: 'C' },
      { id: 'i4', day_id: 'D1', sort_key: 40, title: '4', variant: 'primary', place_id: 'C' },
      { id: 'i5', day_id: 'D1', sort_key: 50, title: '5', variant: 'primary', place_id: 'B' },
      { id: 'i6', day_id: 'D1', sort_key: 60, title: '6', variant: 'primary', place_id: 'A', deleted_at: '2027-01-01T00:00:00+00:00' },
      { id: 'i7', day_id: 'D1', sort_key: 70, title: '7', variant: 'primary', place_id: null },
    ],
  });
  const r = S.dayRoute(b, 'D1');
  assert.deepEqual(r.points.map((p) => [p.placeId, p.order]), [['A', 1], ['B', 2]]);
  assert.deepEqual(r.missing.map((m) => m.itemId), ['i4']);
});

test('总路线、当晚住处、天气点（住处 → 当天分段中心 → 第一个分段）', () => {
  const b = bundle({
    segments: [{ id: 'S2', name: '二', sort: 20, center_lat: 20, center_lng: 120 }, { id: 'S1', name: '一', sort: 10, center_lat: 10, center_lng: 110, timezone: 'Asia/Bangkok' }],
    places: [{ id: 'H', name: '酒店', lat: 11, lng: 111 }],
    bookings: [{ id: 'BK', kind: 'hotel', title: '酒店', place_id: 'H' }],
    days: [{ id: 'D1', date: '2027-01-10', segment_id: 'S1', stay_booking_id: 'BK' }, { id: 'D2', date: '2027-01-11', segment_id: 'S2' }, { id: 'D3', date: '2027-01-12' }],
  });
  assert.deepEqual(S.tripRoute(b).map((p) => p.name), ['一', '二']);
  assert.equal(S.stayForDay(b, b.days.get('D1')).place.name, '酒店');
  assert.equal(S.stayForDay(b, b.days.get('D2')), null);
  assert.deepEqual(S.weatherPoint(b, b.days.get('D1')), { lat: 11, lng: 111, timezone: 'Asia/Bangkok', source: 'stay', name: '酒店' });
  assert.equal(S.weatherPoint(b, b.days.get('D2')).source, 'segment');
  assert.equal(S.weatherPoint(b, b.days.get('D3')).source, 'trip');
  assert.equal(S.dayTimezone(b, b.days.get('D1')), 'Asia/Bangkok', '分段写了时区就按分段');
  assert.equal(S.dayTimezone(b, b.days.get('D3')), 'Asia/Ho_Chi_Minh');
});

test('成员：trips.owner_id 指向的成员也算 owner；同行人数优先 extra.party_size', () => {
  const b = bundle();
  assert.equal(S.effectiveRole(b, JEREMY), 'owner', '表里是 editor，但 owner_id 是他');
  assert.equal(S.effectiveRole(b, CATHY), 'editor');
  assert.equal(S.effectiveRole(b, 'nobody'), null);
  assert.equal(S.memberList(b)[0].user_id, JEREMY);
  assert.equal(S.memberName(b, CATHY), 'Cathy');
  assert.equal(S.partySize(b), 2);
  assert.equal(S.partySize(bundle({ trip: { extra: { party_size: 3 } } })), 3);
  const viewer = bundle({ members: [{ trip_id: 't1', user_id: JEREMY, role: 'owner' }, { trip_id: 't1', user_id: CATHY, role: 'viewer' }] });
  assert.equal(S.partySize(viewer), 1, '只读成员不算同行人数');
  assert.equal(S.canEditTrip(viewer, CATHY), false);
});

test('预算：per person × 人数、区间分别汇总、预订价不重复算、候选只在排进行程时算、取消付过钱的算、换算成港币', () => {
  const fx = createFx();
  const b = bundle({
    days: [{ id: 'D1', date: '2027-01-10' }, { id: 'D2', date: '2027-01-11' }],
    bookings: [
      { id: 'HOTEL', kind: 'hotel', title: '酒店', status: 'booked', price_amount: 300, price_currency: 'CNY', payment_status: 'paid', sort: 1 },
      { id: 'FLIGHT', kind: 'flight', title: '航班', status: 'booked', price_amount: 1000, price_currency: 'HKD', payment_status: 'partial', paid_amount: 400, sort: 2 },
      { id: 'IDEA_LINKED', kind: 'restaurant', title: '候选餐厅', status: 'idea', price_amount: 660000, price_currency: 'VND', payment_status: 'unpaid', sort: 3 },
      { id: 'IDEA_LOOSE', kind: 'activity', title: '还没想好', status: 'idea', price_amount: 999, price_currency: 'HKD', payment_status: 'unpaid', sort: 4 },
      { id: 'CANCEL', kind: 'car_rental', title: '取消了', status: 'cancelled', price_amount: 500, price_currency: 'HKD', payment_status: 'unpaid', sort: 5 },
      { id: 'SUNK', kind: 'ticket', title: '退不了', status: 'cancelled', price_amount: 200, price_currency: 'HKD', payment_status: 'paid', sort: 6 },
      { id: 'REFUND', kind: 'ticket', title: '退款了', status: 'booked', price_amount: 80, price_currency: 'HKD', payment_status: 'refunded', sort: 7 },
      { id: 'SPA', kind: 'activity', title: '按摩', status: 'pending', price_amount: 330000, price_currency: 'VND', payment_status: 'pay_at_property', sort: 8 },
    ],
    items: [
      { id: 'i1', day_id: 'D1', sort_key: 10, title: '夜市', variant: 'primary', cost_estimate: { amount: 100000, currency: 'VND', per: 'person' } },
      { id: 'i2', day_id: 'D1', sort_key: 20, title: '咖啡', variant: 'primary', cost_estimate: { amount: 50, amount_max: 80, currency: 'HKD' } },
      { id: 'i3', day_id: 'D1', sort_key: 30, title: '入住', variant: 'primary', booking_id: 'HOTEL', cost_estimate: null },
      { id: 'i4', day_id: 'D2', sort_key: 10, title: '退房', variant: 'primary', booking_id: 'HOTEL' },
      { id: 'i5', day_id: 'D2', sort_key: 20, title: '晚餐', variant: 'primary', booking_id: 'IDEA_LINKED' },
      { id: 'i6', day_id: 'D2', sort_key: 30, title: '雨天', variant: 'rain', cost_estimate: { amount: 9999, currency: 'HKD' } },
      { id: 'i7', day_id: null, sort_key: 10, title: '池子里', variant: 'primary', cost_estimate: { amount: 9999, currency: 'HKD' } },
      { id: 'i8', day_id: 'D2', sort_key: 40, title: '日元', variant: 'primary', cost_estimate: { amount: 1000, currency: 'JPY' } },
    ],
  });
  const r = S.budgetSummary(b, { fx });
  assert.equal(r.home, 'HKD');
  assert.equal(r.partySize, 2);
  const byId = Object.fromEntries(r.lines.map((l) => [l.id, l]));
  assert.equal(byId.i1.min, 200000, '每人 10 万越南盾 × 2 人');
  assert.deepEqual([byId.i2.min, byId.i2.max], [50, 80]);
  assert.equal(r.lines.filter((l) => l.id === 'HOTEL').length, 1, '两条条目引用同一个预订，只算一次');
  assert.equal(byId.IDEA_LINKED.estimate, true, '候选预订被排进行程：算估算');
  assert.ok(!byId.IDEA_LOOSE, '没排进行程的候选不算');
  assert.ok(!byId.CANCEL, '取消且没付钱的不算');
  assert.equal(byId.SUNK.min, 200, '取消但钱退不了的算');
  assert.equal(byId.REFUND.min, 0, '退款的算 0');
  assert.ok(!byId.i6 && !byId.i7, '备选方案、备选池不算');
  assert.deepEqual(r.unconverted, [{ currency: 'JPY', min: 1000, max: 1000 }], '没有参考汇率的币种单独列出');
  // 港币合计：VND (200000 + 660000 + 330000) / 3300 + CNY 300 × 1.17 + HKD (50|80 + 1000 + 200 + 0)
  const vnd = (200000 + 660000 + 330000) / 3300;
  const expectMin = Math.round((vnd + 351 + 50 + 1000 + 200) * 100) / 100;
  const expectMax = Math.round((vnd + 351 + 80 + 1000 + 200) * 100) / 100;
  assert.deepEqual(r.total, { min: expectMin, max: expectMax });
  assert.equal(Math.round((r.booked.min + r.estimated.min) * 100) / 100, r.total.min, '已订 + 估算 = 合计');
  assert.ok(r.byDay.get('D1').min > 0 && r.byDay.get('D2').min > 0);
  // 付款：酒店已付、航班付了 400、按摩到店付、退不了的已付
  assert.equal(r.payments.paid, Math.round((351 + 400 + 200) * 100) / 100);
  assert.equal(r.payments.due, Math.round((600 + 100) * 100) / 100);
  assert.equal(r.payments.atProperty, 100);
});

test('预算：演示数据（海岛 越南盾 + 港币 + 人民币）能完整汇总', () => {
  const r = S.budgetSummary(island, { fx: createFx() });
  assert.equal(r.unconverted.length, 0);
  assert.ok(r.total.min > 0 && r.total.max >= r.total.min);
  assert.ok(r.byCurrency.some((c) => c.currency === 'VND'));
});

test('分摊：平摊除不尽时余数给前面的人（份额之和 = 总额）；按金额对不上记问题、差额算付款人；个人不分摊', () => {
  const b = bundle();
  let s = S.expenseShares({ amount: 100001, currency: 'VND', paid_by_user_id: JEREMY, split: { mode: 'equal', user_ids: [JEREMY, CATHY] } }, b);
  assert.deepEqual([...s.shares], [[JEREMY, 50001], [CATHY, 50000]]);
  s = S.expenseShares({ amount: 10, currency: 'HKD', paid_by_user_id: JEREMY, split: { mode: 'equal', user_ids: [JEREMY, CATHY, 'x'] } }, b);
  assert.deepEqual([...s.shares.values()], [334, 333, 333], '最小单位是分');
  s = S.expenseShares({ amount: 100, currency: 'HKD', paid_by_user_id: CATHY, split: { mode: 'amounts', shares: [{ user_id: JEREMY, amount: 70 }, { user_id: CATHY, amount: 20 }] } }, b);
  assert.deepEqual(s.issues, ['split-mismatch']);
  assert.equal(s.shares.get(CATHY), 3000, '没分完的 10 元算付款人');
  s = S.expenseShares({ amount: 88, currency: 'HKD', paid_by_user_id: CATHY, split: { mode: 'personal' } }, b);
  assert.deepEqual([...s.shares], [[CATHY, 8800]]);
});

test('分摊：旧数据（split 为空对象）按 split_with 的名字对到成员；对不上的保留名字；没写付款人标出来', () => {
  const b = bundle();
  let s = S.expenseShares({ amount: 300, currency: 'NTD', paid_by: 'Jeremy', split_with: ['jeremy', 'cathy@example.com', '小明'], split: {} }, b);
  assert.equal(s.currency, 'TWD', 'NTD → TWD');
  assert.equal(s.payer, JEREMY);
  assert.deepEqual([...s.shares], [[JEREMY, 100], [CATHY, 100], ['legacy:小明', 100]]);
  s = S.expenseShares({ amount: 50, currency: 'HKD', split: {} }, b);
  assert.deepEqual(s.issues, ['unknown-payer']);
});

test('结算建议：转账笔数最少、金额合计 = 欠款', () => {
  const t = S.settle(new Map([['a', 300], ['b', -100], ['c', -200], ['d', 0]]));
  assert.deepEqual(t, [{ from: 'c', to: 'a', minor: 200 }, { from: 'b', to: 'a', minor: 100 }]);
  const t2 = S.settle(new Map([['a', 150], ['b', 50], ['c', -120], ['d', -80]]));
  assert.equal(t2.length, 3);
  assert.equal(t2.reduce((s, x) => s + x.minor, 0), 200);
});

test('记账汇总：按币种分开（不换汇率）结算；折合港币用每笔记下的汇率；软删除不算', () => {
  const b = bundle({
    expenses: [
      { id: 'e1', amount: 200000, currency: 'VND', currency_iso: 'VND', paid_by_user_id: JEREMY, split: { mode: 'equal', user_ids: [JEREMY, CATHY] }, home_currency: 'HKD', fx_rate: 0.0003, amount_home: 60, date: '2027-01-10', category: '餐饮' },
      { id: 'e2', amount: 100000, currency: 'VND', currency_iso: 'VND', paid_by_user_id: CATHY, split: { mode: 'equal', user_ids: [JEREMY, CATHY] }, home_currency: 'HKD', fx_rate: 0.0003, amount_home: 30, date: '2027-01-11', category: '交通' },
      { id: 'e3', amount: 100, currency: 'HKD', currency_iso: 'HKD', paid_by_user_id: CATHY, split: { mode: 'personal' }, date: '2027-01-11', category: '购物' },
      { id: 'e4', amount: 999, currency: 'HKD', currency_iso: 'HKD', paid_by_user_id: CATHY, split: { mode: 'equal', user_ids: [JEREMY, CATHY] }, deleted_at: '2027-01-12T00:00:00+00:00' },
      { id: 'e5', amount: 50, currency: 'CNY', currency_iso: 'CNY', paid_by_user_id: CATHY, split: { mode: 'equal', user_ids: [JEREMY, CATHY] }, date: '2027-01-12', category: '奇怪分类' },
    ],
  });
  const L = S.ledgerSummary(b, { fx: createFx() });
  assert.equal(L.count, 4);
  const vnd = L.currencies.find((c) => c.currency === 'VND');
  assert.equal(vnd.total, 300000);
  assert.deepEqual(vnd.paid, { [JEREMY]: 200000, [CATHY]: 100000 });
  assert.deepEqual(vnd.share, { [JEREMY]: 150000, [CATHY]: 150000 });
  assert.deepEqual(vnd.transfers, [{ from: CATHY, to: JEREMY, amount: 50000 }], 'Cathy 用越南盾还 Jeremy 5 万');
  const hkd = L.currencies.find((c) => c.currency === 'HKD');
  assert.deepEqual(hkd.transfers, [], '个人消费不用结算');
  const cny = L.currencies.find((c) => c.currency === 'CNY');
  assert.deepEqual(cny.transfers, [{ from: JEREMY, to: CATHY, amount: 25 }]);
  // 折合港币：60 + 30（记账时的汇率）+ 100 + 50 × 1.17（参考汇率）
  assert.equal(L.home.total, 60 + 30 + 100 + 58.5);
  assert.equal(L.home.approxCount, 1, '一笔用了参考汇率');
  assert.equal(L.home.paid[JEREMY], 60);
  assert.equal(Math.round((L.home.share[JEREMY] + L.home.share[CATHY]) * 100), Math.round(L.home.total * 100), '份额加起来 = 总额');
  assert.equal(L.byCategory.find((c) => c.category === '其他').total, 58.5, '不认识的分类归到其他');
  assert.deepEqual(L.byDate.map((d) => d.date), ['2027-01-12', '2027-01-11', '2027-01-10']);
  assert.deepEqual(L.people.map((p) => p.name), ['Jeremy', 'Cathy']);
});

test('记账汇总：演示数据（三城：新台币 + 港币，含一条软删除）', () => {
  const L = S.ledgerSummary(cities, { fx: createFx() });
  assert.equal(L.count, [...cities.expenses.values()].filter((e) => !e.deleted_at).length);
  for (const c of L.currencies) {
    const paid = Object.values(c.paid).reduce((a, b) => a + b, 0);
    const share = Object.values(c.share).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(paid * 100), Math.round(c.total * 100), `${c.currency} 付款合计 = 总额`);
    assert.equal(Math.round(share * 100), Math.round(c.total * 100), `${c.currency} 承担合计 = 总额`);
  }
  assert.equal(L.home.missing.length, 0);
  assert.deepEqual(L.issues, []);
});

test('清单：按清单分开、进度、打包按分类首次出现的顺序分组、按天 / 按预订', () => {
  const b = bundle({
    todos: [
      { id: 't1', list: 'packing', title: '充电器', category: '电子', sort: 30, done: true },
      { id: 't2', list: 'packing', title: '袜子', category: '衣物', sort: 10, done: false },
      { id: 't3', list: 'packing', title: '耳机', category: '电子', sort: 20, done: false },
      { id: 't4', list: 'confirm', title: '确认酒店', sort: 10, done: true, booking_id: 'B1', day_id: 'D1' },
      { id: 't5', list: 'buy', title: '防晒', sort: 10, done: false, day_id: 'D1' },
    ],
  });
  assert.deepEqual([...S.todosByList(b.todos).keys()], ['confirm', 'packing', 'todo', 'buy']);
  assert.deepEqual(S.packingGroups(b.todos).map((g) => [g.category, g.items.map((i) => i.id), g.done]), [['衣物', ['t2'], 0], ['电子', ['t3', 't1'], 1]]);
  const p = S.todoProgress(b.todos);
  assert.deepEqual([p.total, p.done, p.remaining], [5, 2, 3]);
  assert.deepEqual(p.byList.packing, { total: 3, done: 1 });
  assert.equal(S.todoProgress(b.todos, { list: 'confirm' }).ratio, 1);
  assert.deepEqual(S.todosByDay(b.todos).get('D1').map((t) => t.id), ['t4', 't5']);
  assert.deepEqual(S.todosByBooking(b.todos).get('B1').map((t) => t.id), ['t4']);
});

test('截止提醒：未完成待办的截止时间、预订的免费取消截止（已过期的待办标 overdue）', () => {
  const b = bundle({
    todos: [
      { id: 't1', list: 'confirm', title: '确认', done: false, due_at: '2027-01-05T10:00:00+00:00' },
      { id: 't2', list: 'confirm', title: '已完成', done: true, due_at: '2027-01-05T10:00:00+00:00' },
      { id: 't3', list: 'todo', title: '过期', done: false, due_at: '2027-01-01T10:00:00+00:00' },
      { id: 't4', list: 'todo', title: '很久以后', done: false, due_at: '2027-03-01T10:00:00+00:00' },
    ],
    bookings: [{ id: 'B1', kind: 'hotel', title: '酒店', status: 'booked', free_cancel_until: '2027-01-04T16:59:00+00:00' }],
  });
  const list = S.upcomingDeadlines(b, at('2027-01-03T00:00:00Z'), 7);
  assert.deepEqual(list.map((x) => [x.type, x.id, x.overdue]), [['todo', 't3', true], ['free-cancel', 'B1', false], ['todo', 't1', false]]);
});

test('排序：预订（start_at 空值在后）、贴士（置顶在前）、联系人', () => {
  const b = bundle({
    bookings: [
      { id: 'b1', kind: 'other', title: '没时间', start_at: null, sort: 1 },
      { id: 'b2', kind: 'flight', title: '后', start_at: '2027-01-10T05:00:00+00:00', sort: 1 },
      { id: 'b3', kind: 'flight', title: '前', start_at: '2027-01-10T01:00:00+00:00', sort: 9 },
    ],
    tips: [{ id: 'x', title: '普通', sort: 1, pinned: false }, { id: 'y', title: '置顶', sort: 99, pinned: true }],
    contacts: [{ id: 'c2', name: '二', sort: 20 }, { id: 'c1', name: '一', sort: 10 }],
  });
  assert.deepEqual(S.sortedBookings(b.bookings).map((x) => x.id), ['b3', 'b2', 'b1']);
  assert.deepEqual(S.sortedTips(b.tips).map((x) => x.id), ['y', 'x']);
  assert.deepEqual(S.sortedContacts(b.contacts).map((x) => x.id), ['c1', 'c2']);
});

test('评级：按地点汇总、平均分对应的档位名', () => {
  const b = bundle({ reviews: [{ id: 'r1', place_id: 'P', user_id: JEREMY, rating: 5 }, { id: 'r2', place_id: 'P', user_id: CATHY, rating: 4 }] });
  const r = S.placeRating(b, 'P', CATHY);
  assert.equal(r.count, 2);
  assert.equal(r.avg, 4.5);
  assert.equal(r.mine.id, 'r2');
  assert.equal(S.RATING_LABELS[5], '夯');
  assert.deepEqual(S.reviewsByPlace(b).get('P').map((x) => x.id), ['r1', 'r2']);
});

test('搜索：多个词都要命中；标题开头命中排最前；软删除的不出现', () => {
  const b = bundle({
    places: [{ id: 'P1', name: '椰影夜市', aliases: ['night market'] }],
    items: [
      { id: 'i1', title: '逛夜市', day_id: null, place_id: 'P1', variant: 'primary', tags: [] },
      { id: 'i2', title: '夜市吃宵夜', day_id: null, variant: 'primary', tags: [] },
      { id: 'i3', title: '删掉的夜市', day_id: null, variant: 'primary', deleted_at: '2027-01-01T00:00:00+00:00', tags: [] },
    ],
    expenses: [{ id: 'e1', description: '夜市小吃', category: '餐饮', amount: 1, currency: 'VND' }],
  });
  const r = S.searchTrip(b, '夜市');
  assert.equal(r[0].title, '夜市吃宵夜');
  assert.ok(!r.some((x) => x.id === 'i3'));
  assert.ok(r.some((x) => x.type === 'expense'));
  assert.deepEqual(S.searchTrip(b, 'NIGHT market').map((x) => x.id), ['P1'], '不分大小写、别名也能搜');
  assert.deepEqual(S.searchTrip(b, '夜市 删除'), []);
  assert.deepEqual(S.searchTrip(b, '   '), []);
});
