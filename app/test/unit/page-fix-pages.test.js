// 页面阶段四份评审（现场走查 / 视觉 / 交互 / 代码正确性）修改后的回归测试（纯逻辑）。
// 数据全部是测试里现编的（虚构），不含真实行程的任何值。

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { itemClock, itemTimeText, flightLeg } from '../../src/kit/item-clock.js';
import { dayToneIndex, dayTone, dayToneDeep } from '../../src/kit/day-tone.js';
import { rideHintFor, rideHintOfMode } from '../../src/kit/place-actions.js';
import { freeCancelInfo, deadlineWhen } from '../../src/kit/status.js';
import { presenceZone, tripFlights, ledgerSummary, bundleFromRows } from '../../src/data/selectors.js';
import { dueInfo as ovDueInfo, sunInfo, todayTodoGroups, ongoingOrder, spendSummary } from '../../src/pages/trip/model.js';
import { dueInfo as listDueInfo, splitRows, dueRank, zoneNote } from '../../src/pages/lists/model.js';
import { firstLine, todoHint, collapsedSubtitle } from '../../src/pages/day/model.js';
import { transfersText, flattenOutstanding } from '../../src/pages/ledger/model.js';
import { phoneSpans } from '../../src/lib/contact-links.js';
import { moneyParts, formatMoney } from '../../src/lib/money.js';
import { initialState, toPatch } from '../../src/sheets/expense/form-model.js';
import { formPatch as todoFormPatch, initialForm as todoInitialForm } from '../../src/sheets/todo/form.js';
import { searchTrip } from '../../src/kit/search/engine.js';
import { createTestLayer, disposeLayers, JEREMY, CATHY } from './helpers/data.js';

afterEach(disposeLayers);

const HK = 'Asia/Hong_Kong';
const VN = 'Asia/Ho_Chi_Minh';

// 虚构的一趟：香港 10:00 起飞 → 越南 11:50 落地；回程越南 18:00 起飞 → 香港 21:30 落地
const OUT = { id: 'f-out', kind: 'flight', status: 'booked', start_at: '2030-03-01T10:00:00+08:00', start_tz: HK, end_at: '2030-03-01T11:50:00+07:00', end_tz: VN };
const BACK = { id: 'f-back', kind: 'flight', status: 'booked', start_at: '2030-03-04T18:00:00+07:00', start_tz: VN, end_at: '2030-03-04T21:30:00+08:00', end_tz: HK };
const TRIP = { id: 't', title: '测试岛', timezone: VN, start_date: '2030-03-01', end_date: '2030-03-04', home_currency: 'HKD', local_currency: 'VND' };
const bundleOf = (extra = {}) => bundleFromRows('t', { trips: [TRIP], bookings: [OUT, BACK], ...extra });

// ---------------------------------------------------------------------
// 时区：条目钟点（现场走查 P0-1 / P1-2）
// ---------------------------------------------------------------------

test('条目钟点：在香港发生的条目写香港钟点 +「香港」；概览一行字和每天页同一份', () => {
  const express = { kind: 'transport', start_time: '07:00', end_time: '07:40', extra: { local_time: { tz: HK, start: '08:00', end: '08:40' } } };
  const c = itemClock(express, { timeZone: VN });
  assert.deepEqual([c.main, c.end, c.zone, c.arrow], ['08:00', '08:40', '香港', false]);
  assert.match(c.alt, /越南 07:00–07:40/);
  assert.equal(itemTimeText(express, { timeZone: VN }), '08:00–08:40 香港');
  // 普通条目：行程时区、不加标签
  assert.equal(itemTimeText({ start_time: '09:30:00', end_time: '11:00:00' }, { timeZone: VN }), '09:30–11:00');
});

test('航班条目：起飞按起飞地、落地按到达地（「10:00 香港 → 11:50」/「18:00 → 21:30 香港」）', () => {
  const outItem = { kind: 'flight', start_time: '09:00', end_time: '11:50', booking_id: 'f-out', extra: { local_time: { tz: HK, start: '10:00', end: '12:50' } } };
  const leg = flightLeg(outItem, OUT, VN);
  assert.deepEqual([leg.depTime, leg.depZone, leg.arrTime, leg.arrZone], ['10:00', '香港', '11:50', null]);
  const c = itemClock(outItem, { timeZone: VN, booking: OUT });
  assert.deepEqual([c.main, c.zone, c.end, c.endZone, c.arrow], ['10:00', '香港', '11:50', null, true]);
  assert.equal(itemTimeText(outItem, { timeZone: VN, booking: OUT }), '10:00 香港 → 11:50');
  assert.match(c.aria, /香港时间 10:00 起飞/);

  const backItem = { kind: 'flight', start_time: '18:00', end_time: '21:30', booking_id: 'f-back', extra: { local_time: { tz: HK, start: '19:00', end: '21:30' } } };
  assert.equal(itemTimeText(backItem, { timeZone: VN, booking: BACK }), '18:00 → 21:30 香港');

  // 同一张机票上的「值机」条目（不是起飞那一刻）：照常按自己的 local_time
  const checkin = { kind: 'flight', start_time: '07:30', end_time: '08:30', booking_id: 'f-out', extra: { local_time: { tz: HK, start: '08:30', end: '09:30' } } };
  assert.equal(flightLeg(checkin, OUT, VN), null);
  assert.equal(itemTimeText(checkin, { timeZone: VN, booking: OUT }), '08:30–09:30 香港');
  // 落地那一条（开始 = 落地时刻）：普通条目
  assert.equal(itemTimeText({ kind: 'flight', start_time: '11:50', booking_id: 'f-out' }, { timeZone: VN, booking: OUT }), '11:50');
});

test('只有模糊时间：4 个字以内写在时间栏；更长的放进副标题（视觉评审 P2-14）', () => {
  assert.deepEqual([itemClock({ time_label: '日落前' }).main, itemClock({ time_label: '日落前' }).fuzzy], ['日落前', null]);
  const long = itemClock({ time_label: '取完行李后' });
  assert.deepEqual([long.main, long.fuzzy, long.label], ['', '取完行李后', true]);
  assert.equal(itemTimeText({ time_label: '取完行李后' }), '取完行李后');
  assert.equal(collapsedSubtitle({ kind: 'food' }, { name: '粉店' }, null, '取完行李后'), '取完行李后 · 粉店');
  assert.equal(collapsedSubtitle({ kind: 'food' }, null, null, '取完行李后'), '取完行李后');
});

// ---------------------------------------------------------------------
// 人在哪个时区（现场走查 P1-1）
// ---------------------------------------------------------------------

test('presenceZone：去程落地前是起飞地、回程落地后是到达地，中间是行程时区；没有航班永远是行程时区', () => {
  const b = bundleOf();
  assert.deepEqual(tripFlights(b), { outbound: OUT, back: BACK });
  assert.equal(presenceZone(b, new Date('2030-02-20T12:00:00Z')), HK, '出发前好几天');
  assert.equal(presenceZone(b, new Date('2030-03-01T03:00:00Z')), HK, '出发当天还在机场（香港 11:00 = 飞着）');
  assert.equal(presenceZone(b, new Date('2030-03-01T05:00:00Z')), VN, '落地以后');
  assert.equal(presenceZone(b, new Date('2030-03-04T12:00:00Z')), VN, '回程起飞前');
  assert.equal(presenceZone(b, new Date('2030-03-04T14:00:00Z')), HK, '回程落地以后（香港 22:00）');
  assert.equal(presenceZone(b, '2030-03-04T23:59:00+08:00'), HK, '也收时间戳字符串');
  assert.equal(presenceZone(bundleFromRows('t', { trips: [TRIP] }), new Date('2030-02-20T12:00:00Z')), VN);
  // 取消了的航班不算
  assert.equal(presenceZone(bundleOf({ bookings: [{ ...OUT, status: 'cancelled' }, BACK] }), new Date('2030-02-20T12:00:00Z')), VN);
});

test('概览的截止时间：按那一刻人在的时区写，和行程时区不同注明（香港时间）', () => {
  const at = new Date('2030-02-28T12:00:00Z'); // 香港 20:00
  const due = '2030-02-28T15:59:00Z'; // 香港 23:59
  const plain = ovDueInfo(due, { at, timeZone: VN });
  assert.match(plain.text, /22:59 前/, '旧写法：按越南钟点');
  const shown = ovDueInfo(due, { at, timeZone: VN, displayZone: HK, hereZone: HK });
  assert.match(shown.text, /今天 23:59 前（香港时间） · 还剩 3 小时/);
  // 落地以后到期（越南时间）、人此刻还在香港：注明（越南时间）
  const later = ovDueInfo('2030-03-02T02:00:00Z', { at, timeZone: VN, displayZone: VN, hereZone: HK });
  assert.match(later.text, /（越南时间）/);
  // 都在越南：不加
  assert.doesNotMatch(ovDueInfo('2030-03-02T02:00:00Z', { at, timeZone: VN, displayZone: VN, hereZone: VN }).text, /时间）/);
});

test('清单的截止时间：同一套（行里一个「香港时间」小标签，卡片头不再说按越南时间）', () => {
  const at = new Date('2030-02-28T12:00:00Z');
  const d = listDueInfo('2030-02-28T15:59:00Z', { at, timeZone: VN, displayZone: HK, hereZone: HK });
  assert.equal(d.zoneTag, '香港时间');
  assert.deepEqual(d.parts, ['还剩 3 小时', '今天 23:59 前']);
  assert.match(d.label, /（香港时间）$/);
  assert.equal(zoneNote([{ due_at: '2030-02-28T15:59:00Z' }], { timeZone: VN, deviceZone: HK, at, tagged: true }), null);
  assert.ok(zoneNote([{ due_at: '2030-02-28T15:59:00Z' }], { timeZone: VN, deviceZone: HK, at }));
});

test('清单：没勾的按急缓排（过期 → 24 小时内 → 3 天内，同档按截止先后），其余保持清单顺序（现场走查 P1-4）', () => {
  const at = new Date('2030-02-28T12:00:00Z');
  const rows = [
    { id: 'a', title: '没截止 1' },
    { id: 'b', title: '5 天后', due_at: '2030-03-05T00:00:00Z' },
    { id: 'c', title: '过期', due_at: '2030-02-27T00:00:00Z' },
    { id: 'd', title: '没截止 2' },
    { id: 'e', title: '3 小时后', due_at: '2030-02-28T15:00:00Z' },
    { id: 'f', title: '2 天后', due_at: '2030-03-02T10:00:00Z' },
    { id: 'g', title: '1 小时后', due_at: '2030-02-28T13:00:00Z' },
    { id: 'h', title: '已勾', done: true, due_at: '2030-02-27T00:00:00Z' },
  ];
  assert.deepEqual(splitRows(rows, { at }).open.map((r) => r.id), ['c', 'g', 'e', 'f', 'a', 'b', 'd']);
  assert.deepEqual(splitRows(rows).open.map((r) => r.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], '不传 at：清单顺序');
  assert.deepEqual(rows.map((r) => dueRank(r, at)), [3, 3, 0, 3, 1, 2, 1, 0]);
  // 刚勾的（hold）留在原位：按勾之前的状态排
  const held = splitRows(rows.map((r) => (r.id === 'e' ? { ...r, done: true } : r)), { at, hold: new Map([['e', false]]) });
  assert.deepEqual(held.open.map((r) => r.id), ['c', 'g', 'e', 'f', 'a', 'b', 'd']);
});

test('概览「今天的待办」分两段：今天的在前，之前没做完的另起一段（现场走查 P2-15）', () => {
  const todos = [
    { id: 'old', list: 'todo', title: '前天的', due_at: '2030-02-27T10:00:00Z' },
    { id: 'today', list: 'todo', title: '今天的', due_at: '2030-03-02T05:00:00Z' },
    { id: 'day', list: 'confirm', title: '挂在今天', day_id: 'D2' },
    { id: 'pack', list: 'packing', title: '打包不算', day_id: 'D2' },
  ];
  const g = todayTodoGroups(todos, { dayId: 'D2', date: '2030-03-02', timeZone: VN });
  assert.deepEqual(g.today.map((t) => t.id), ['today', 'day']);
  assert.deepEqual(g.stale.map((t) => t.id), ['old']);
});

test('出发当天去程还没落地：「现在」下面紧跟去程航班卡（现场走查 P1-3）', () => {
  assert.deepEqual(ongoingOrder({ minutes: 600, hasUpcoming: true, outbound: true }).slice(0, 2), ['now', 'outflight']);
  assert.ok(!ongoingOrder({ minutes: 600, hasUpcoming: true }).includes('outflight'));
});

// ---------------------------------------------------------------------
// 其他现场走查
// ---------------------------------------------------------------------

test('蓝调 / 黄金时刻写成区间也认（「17:59–18:07」），单个钟点照旧', () => {
  const s = sunInfo({ extra: { sun: { sunset: '17:41:00', blue_hour: '17:59–18:07', golden_hour: '17:05 - 17:40' } } }, null);
  assert.deepEqual([s.sunset, s.blue, s.golden], ['17:41', '17:59–18:07', '17:05–17:40']);
  assert.equal(sunInfo({ extra: { sun: { blue_hour: '傍晚' } } }, null).blue, null);
});

test('免费取消截止正好零点：写成前一天 24:00（周几深夜），不让人读成那天全天', () => {
  const at = new Date('2030-02-20T00:00:00Z');
  assert.equal(deadlineWhen('2030-02-28T17:00:00Z', { timeZone: VN, at }), '2月28日 24:00（周四深夜）');
  assert.equal(freeCancelInfo('2030-02-28T17:00:00Z', { at, timeZone: VN }).label, '2月28日 24:00（周四深夜）前可免费取消');
  assert.equal(freeCancelInfo('2030-02-28T16:59:00Z', { at, timeZone: VN }).label, '2月28日 23:59 前可免费取消');
});

test('主按钮跟着交通方式走：走路 = 导航、打车 = 叫 Grab、不知道就没有主按钮（概览和每天页同一套）', () => {
  assert.deepEqual(rideHintFor({ options: [{ mode: 'walk', recommended: true }, { mode: 'grab' }] }), { primary: 'nav', navMode: 'walk' });
  assert.deepEqual(rideHintFor({ options: [{ mode: 'grab' }] }), { primary: 'grab', navMode: 'driving' });
  assert.deepEqual(rideHintFor(null), { primary: null, navMode: null });
  assert.deepEqual(rideHintOfMode('train'), { primary: 'nav', navMode: 'train' });
});

test('当天提醒：贴士正文先去掉 Markdown 再取第一行；待办写截止（按人那一刻的时区）+ 备注', () => {
  assert.equal(firstLine('标准：**评价里有**温水\n第二行'), '标准：评价里有温水');
  assert.equal(firstLine('- 末几班 **00:30**\n- 第二条'), '末几班 00:30');
  assert.equal(firstLine(''), '');
  const at = new Date('2030-03-01T00:00:00Z');
  const hint = todoHint({ due_at: '2030-03-01T08:45:00Z', note: '在官网填。**别找代填**' }, { at, timeZone: VN, displayZone: HK, hereZone: HK });
  assert.equal(hint, '今天 16:45 前截止（香港时间） · 在官网填。别找代填');
  assert.equal(todoHint({ title: '无' }, { at, timeZone: VN }), null);
});

test('结清记录说成一句话：按币种分别列、不换汇', () => {
  const names = (id) => ({ J: 'Jeremy', C: 'Cathy' })[id] || id;
  const t = transfersText([{ from: 'C', to: 'J', currency: 'CNY', amount: 2625.63 }, { from: 'C', to: 'J', currency: 'HKD', amount: 418.66 }], names, { verb: '给了' });
  assert.equal(t, 'Cathy 给了 Jeremy ¥2,625.63 + HK$418.66');
  assert.deepEqual(flattenOutstanding([{ currency: 'VND', transfers: [{ from: 'C', to: 'J', amount: 100000 }] }]), [{ from: 'C', to: 'J', currency: 'VND', amount: 100000 }]);
  assert.equal(transfersText([], names), '');
});

test('折合港币用同一份数（记账时的 amount_home）：行、币种小计、合计对得上（现场走查 P2-4）', () => {
  assert.equal(moneyParts(5000, 'CNY', { hkdValue: 5850.5 }).hkd, '约 HK$5,851');
  assert.equal(formatMoney(150000, 'VND', { hkdValue: 45.2 }), '150,000₫（约 HK$45）');
  assert.equal(formatMoney(150000, 'VND'), formatMoney(150000, 'VND', { hkdValue: null }), '不给就按参考汇率');
  const rows = {
    trips: [TRIP],
    trip_members: [{ trip_id: 't', user_id: 'J', role: 'owner' }, { trip_id: 't', user_id: 'C', role: 'editor' }],
    expenses: [
      { id: 'e1', trip_id: 't', amount: 100, currency: 'CNY', currency_iso: 'CNY', home_currency: 'HKD', amount_home: 117.3, fx_rate: 1.173, paid_by_user_id: 'J', split: { mode: 'equal', user_ids: ['J', 'C'] }, date: '2030-03-01' },
      { id: 'e2', trip_id: 't', amount: 200, currency: 'CNY', currency_iso: 'CNY', home_currency: 'HKD', amount_home: 233, fx_rate: 1.165, paid_by_user_id: 'J', split: { mode: 'equal', user_ids: ['J', 'C'] }, date: '2030-03-01' },
      { id: 'e3', trip_id: 't', amount: 50, currency: 'HKD', currency_iso: 'HKD', home_currency: 'HKD', amount_home: 50, fx_rate: 1, paid_by_user_id: 'C', split: { mode: 'personal' }, date: '2030-03-02' },
    ],
  };
  const L = ledgerSummary(bundleFromRows('t', rows));
  const cny = L.currencies.find((c) => c.currency === 'CNY');
  assert.equal(cny.home, 350.3);
  assert.equal(Math.round(L.currencies.reduce((s, c) => s + c.home, 0) * 100), Math.round(L.home.total * 100), '各币种小计加起来 = 合计');
  const s = spendSummary(rows.expenses, { date: '2030-03-01', homeOf: (e) => e.amount_home });
  assert.equal(s.byCurrency[0].home, 350.3);
});

test('正文里认电话：价格不是电话（代码评审 P2-6）', () => {
  const tels = (t) => phoneSpans(t).filter((x) => x.tel).map((x) => x.text);
  assert.deepEqual(tels('门票 150000 越南盾'), []);
  assert.deepEqual(tels('约 350000đ'), []);
  assert.deepEqual(tels('1500000₫/晚'), []);
  assert.deepEqual(tels('HK$ 1234567'), []);
  assert.deepEqual(tels('打 +84 000 111 222'), ['+84 000 111 222']);
  assert.deepEqual(tels('电话 0901112223'), ['0901112223']);
  assert.deepEqual(tels('热线 2345 6789'), ['2345 6789']);
});

// ---------------------------------------------------------------------
// 编辑面板只提交改了的字段（代码评审 P1-1）、旧记账（P1-2）
// ---------------------------------------------------------------------

const SHARERS = [{ user_id: 'J', name: 'Jeremy' }, { user_id: 'C', name: 'Cathy' }];
const ctxFor = (e, extra = {}) => ({
  trip: TRIP, timeZone: VN, myId: 'J', sharers: SHARERS, today: '2030-03-01', nowTime: '10:00', getExpense: () => e, ...extra,
});

test('记一笔（编辑）：和打开时的那一笔比——对方后来改的分类不会被这边只改说明的保存改回去', () => {
  const base = { id: 'x', amount: 50000, currency: 'VND', category: '餐饮', description: '粉', date: '2030-03-01', paid_by_user_id: 'J', split: { mode: 'equal', user_ids: ['J', 'C'] }, extra: {} };
  const { state } = initialState({ mode: 'edit', id: 'x', fields: {} }, ctxFor(base));
  const patch = toPatch({ ...state, description: '河粉' }, base, ctxFor(base));
  assert.deepEqual(patch, { description: '河粉' });
});

test('记一笔（编辑台湾那趟的旧记账）：付款人、分摊按数据层认出来的人填；只改说明不重写付款人和分摊', () => {
  const legacy = { id: 'old', amount: 500, currency: 'NTD', currency_iso: 'TWD', category: '餐饮', description: '夜市', date: '2026-05-01', paid_by: 'Cathy', split: {}, split_with: ['Cathy'], amount_hkd: 122, extra: {} };
  const ctx = ctxFor(legacy, { legacyShares: () => ({ payer: 'C', ids: ['C'] }) });
  const { state } = initialState({ mode: 'edit', id: 'old', fields: {} }, ctx);
  assert.equal(state.payer, 'C', '付款人是 Cathy，不是当前用户');
  assert.equal(state.splitMode, 'personal');
  assert.equal(state.personalFor, 'C');
  assert.deepEqual(toPatch({ ...state, description: '士林夜市' }, legacy, ctx), { description: '士林夜市' }, '只改说明');
  const shared = { ...legacy, split_with: ['Jeremy', 'Cathy'] };
  const s2 = initialState({ mode: 'edit', id: 'old', fields: {} }, ctxFor(shared, { legacyShares: () => ({ payer: 'C', ids: ['J', 'C'] }) })).state;
  assert.equal(s2.splitMode, 'equal');
  // 改了金额：付款人、分摊一起写成新格式
  const p2 = toPatch({ ...s2, amountText: '1,000' }, shared, ctxFor(shared));
  assert.equal(p2.amount, 1000);
  assert.equal(p2.paid_by_user_id, 'C');
  assert.deepEqual(p2.split, { mode: 'equal', user_ids: ['J', 'C'] });
});

test('人还在香港时记一笔：默认币种用本币（港币）', () => {
  const { state } = initialState({ mode: 'new', id: null, fields: {} }, ctxFor(null, { away: true }));
  assert.equal(state.currency, 'HKD');
  assert.equal(initialState({ mode: 'new', id: null, fields: {} }, ctxFor(null)).state.currency, 'VND');
});

test('待办（编辑）：只提交这次改了的字段，对方勾上的「已完成」不会被改回去', () => {
  const row = { id: 't1', list: 'todo', title: '买电话卡', note: null, qty: null, done: false, due_at: null, day_id: null, booking_id: null, item_id: null, assignee_user_id: null };
  const initial = todoInitialForm(row, {}, { timeZone: VN, items: new Map(), bookings: new Map(), days: new Map() });
  const patch = todoFormPatch({ ...initial, title: '买两张电话卡' }, initial, { timeZone: VN, row });
  assert.deepEqual(patch, { title: '买两张电话卡' });
  assert.deepEqual(todoFormPatch(initial, initial, { timeZone: VN, row }), {});
});

test('数据层：旧记账（没有 fx_rate，只有 amount_hkd）改金额时按它反推汇率，折合港币跟着变', async () => {
  const env = await createTestLayer();
  const store = env.layer.openTrip('demo-cities');
  await store.open();
  store.applyServerRow('expenses', {
    id: '00000000-0000-4000-8000-0000000000aa', trip_id: 'demo-cities', amount: 500, currency: 'NTD', date: '2026-03-15', category: '餐饮', description: '旧夜市',
    paid_by: 'Cathy', split: {}, split_with: ['Cathy'], amount_hkd: 122, fx_rate: null, home_currency: null, amount_home: null, extra: {},
    created_at: '2026-03-15T10:00:00+00:00', updated_at: '2026-03-15T10:00:00+00:00',
  });
  const res = store.updateExpense('00000000-0000-4000-8000-0000000000aa', { amount: 1000 });
  assert.equal(res.row.amount_home, 244);
  assert.ok(Math.abs(res.row.fx_rate - 0.244) < 1e-9);
});

// ---------------------------------------------------------------------
// 视觉 / 搜索
// ---------------------------------------------------------------------

test('第几天的颜色全站一套：7 天一轮，不合法的是灰色', () => {
  assert.deepEqual([1, 2, 7, 8, 9, 0, -1, 'x'].map(dayToneIndex), [1, 2, 7, 1, 2, 8, 8, 8]);
  assert.equal(dayTone(3), 'var(--color-day-3)');
  assert.equal(dayToneDeep(10), 'var(--color-day-3-deep)');
  assert.equal(dayTone(null), 'var(--color-cat-8)');
});

test('搜索：备选、雨天方案降权，主方案排前面（现场走查 P2-14）', () => {
  const b = bundleFromRows('t', {
    trips: [TRIP],
    days: [{ id: 'd1', trip_id: 't', date: '2030-03-01' }],
    items: [
      { id: 'rain', trip_id: 't', day_id: 'd1', variant: 'rain', parent_item_id: 'main', title: '缆车停运就去咖啡馆', sort_key: 3 },
      { id: 'alt', trip_id: 't', day_id: 'd1', variant: 'backup', parent_item_id: 'main', title: '缆车下山', sort_key: 2 },
      { id: 'main', trip_id: 't', day_id: 'd1', variant: 'primary', title: '首班缆车上岛', start_time: '09:30', sort_key: 1 },
    ],
  });
  const items = searchTrip(b, '缆车').find((g) => g.group === 'items');
  assert.equal(items.results[0].id, 'main');
});

test('只读成员也能看到演示后台：JEREMY / CATHY 两个账号都在（测试数据自检）', () => {
  assert.ok(JEREMY && CATHY && JEREMY !== CATHY);
});
