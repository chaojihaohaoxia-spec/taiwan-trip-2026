// 账本页（pages/ledger/model.js）和记一笔表单（sheets/expense/form-model.js）的纯逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitMismatch, ledgerSummary, bundleFromRows } from '../../src/data/selectors.js';
import {
  formatAmountInput, caretAfter, amountToInput, multiplyAmount, trailingUnit, wantsQuickUnits, allowsDecimals,
  currencyChoices, otherCurrencyOptions, segmentForCurrency, currencyUnitLabel,
  categoryForItem, categoryForPlace, categoryForBooking,
  autoShares, buildSplit, splitStateFromExpense, perPerson, blankState, initialState, validateState, toInsert, toPatch, isDirty,
  smallAmountSuggestion, CATEGORIES, QUICK_UNITS,
} from '../../src/sheets/expense/form-model.js';
import {
  groupByDate, filterExpenses, categoryCounts, payerCounts, splitInfo, settlementLines,
  categoryBars, dayBars, peopleStats, countSince, fxNote, CATEGORY_COLOR,
} from '../../src/pages/ledger/model.js';
// 结清记录（整合后在数据层）
import {
  applySettlements, settlementRecord, readSettlements, withSettlements, settle as settleNet, LEDGER_SETTLEMENTS_KEY as SETTLEMENTS_KEY,
} from '../../src/data/selectors.js';
import { footerNote } from '../../src/sheets/expense/notes.js';
import { demoSnapshot, fallbackSnapshot } from '../../src/lib/services/fx.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

const A = 'aaaaaaaa-0000-5000-8000-000000000001';
const B = 'bbbbbbbb-0000-5000-8000-000000000002';
const TRIP = { id: 't', home_currency: 'HKD', local_currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', start_date: '2027-01-10', end_date: '2027-01-13' };
const CTX = {
  trip: TRIP,
  timeZone: TRIP.timezone,
  myId: A,
  sharers: [{ user_id: A, name: 'Jeremy' }, { user_id: B, name: 'Cathy' }],
  today: '2027-01-11',
  nowTime: '10:30',
};

// ---------------------------------------------------------------------
// 金额输入
// ---------------------------------------------------------------------

test('金额输入：边打边加千位分隔；越南盾只认数字（点号 / 逗号都当千位分隔）；港币最多两位小数', () => {
  assert.deepEqual(formatAmountInput('160000', 'VND'), { text: '160,000', value: 160000 });
  assert.deepEqual(formatAmountInput('450.000', 'VND'), { text: '450,000', value: 450000 });
  assert.deepEqual(formatAmountInput('1,250,000', 'VND'), { text: '1,250,000', value: 1250000 });
  assert.deepEqual(formatAmountInput('007', 'VND'), { text: '7', value: 7 });
  assert.deepEqual(formatAmountInput('', 'VND'), { text: '', value: null });
  assert.deepEqual(formatAmountInput('.', 'HKD'), { text: '0.', value: 0 });
  assert.deepEqual(formatAmountInput('12.', 'HKD'), { text: '12.', value: 12 });
  assert.deepEqual(formatAmountInput('12.345', 'HKD'), { text: '12.34', value: 12.34 });
  assert.deepEqual(formatAmountInput('１２３４．５', 'HKD'), { text: '1,234.5', value: 1234.5 });
  // 位数封顶（误触不会变成天文数字）
  assert.equal(formatAmountInput('1234567890123456', 'VND').value, 123456789012);
  assert.equal(allowsDecimals('VND'), false);
  assert.equal(allowsDecimals('HKD'), true);
  assert.equal(wantsQuickUnits('VND'), true);
  assert.equal(wantsQuickUnits('HKD'), false);
  assert.deepEqual(QUICK_UNITS.map((u) => u.factor), [1e3, 1e4]);
});

test('光标：重排以后放回“同一个数字后面”', () => {
  // 在 '16|0,000' 后面打了一个 5 → raw '165|0,000'，光标在第 3 位之后
  const raw = '1650,000';
  const { text } = formatAmountInput(raw, 'VND');
  assert.equal(text, '1,650,000');
  assert.equal(caretAfter(raw, 3, text, 'VND'), 4); // 1,65|0,000 → 数到第三个数字「5」后面
  assert.equal(caretAfter('', 0, '', 'VND'), 0);
  assert.equal(caretAfter('12.5', 4, '12.5', 'HKD'), 4);
  assert.equal(caretAfter('0012', 4, '12', 'VND'), 2);
});

test('「千 / 万」快捷和电脑上直接打单位', () => {
  assert.equal(multiplyAmount('350', 1000, 'VND'), '350,000');
  assert.equal(multiplyAmount('35', 10000, 'VND'), '350,000');
  assert.equal(multiplyAmount('1.5', 1000, 'HKD'), '1,500');
  assert.equal(multiplyAmount('', 1000, 'VND'), null);
  assert.equal(multiplyAmount('0', 1000, 'VND'), null);
  assert.deepEqual(trailingUnit('350k'), { rest: '350', factor: 1000 });
  assert.deepEqual(trailingUnit('35万'), { rest: '35', factor: 10000 });
  assert.deepEqual(trailingUnit('1.2m'), { rest: '1.2', factor: 1e6 });
  assert.equal(trailingUnit('350'), null);
  assert.equal(trailingUnit('k'), null);
  assert.equal(amountToInput(1234.5, 'HKD'), '1,234.5');
  assert.equal(amountToInput(350000, 'VND'), '350,000');
  assert.equal(amountToInput(null, 'VND'), '');
});

test('越南盾不到 1,000 多半是忘了按「千」', () => {
  assert.equal(smallAmountSuggestion({ currency: 'VND', amountText: '350' }), 350000);
  assert.equal(smallAmountSuggestion({ currency: 'VND', amountText: '1,000' }), null);
  assert.equal(smallAmountSuggestion({ currency: 'HKD', amountText: '35' }), null);
  assert.equal(smallAmountSuggestion({ currency: 'VND', amountText: '' }), null);
});

// ---------------------------------------------------------------------
// 币种、分类
// ---------------------------------------------------------------------

test('币种分段：当地币 / 港币 / 人民币 / 其他；当地币就是港币时不重复；其他币种落到「其他」', () => {
  assert.deepEqual(currencyChoices(TRIP).map((o) => o.value), ['VND', 'HKD', 'CNY', 'other']);
  assert.deepEqual(currencyChoices({ local_currency: 'HKD' }).map((o) => o.value), ['HKD', 'CNY', 'other']);
  assert.deepEqual(currencyChoices({ local_currency: 'TWD' }).map((o) => o.label), ['新台币', '港币', '人民币', '其他']);
  assert.equal(segmentForCurrency(TRIP, 'vnd'), 'VND');
  assert.equal(segmentForCurrency(TRIP, 'USD'), 'other');
  assert.ok(otherCurrencyOptions(TRIP).every((o) => !['VND', 'HKD', 'CNY'].includes(o.value)));
  assert.equal(currencyUnitLabel('VND'), '越南盾');
  assert.equal(currencyUnitLabel('JPY'), '日元 JPY');
});

test('从条目 / 地点 / 预订打开时自动选分类', () => {
  assert.equal(categoryForItem({ kind: 'food' }), '餐饮');
  assert.equal(categoryForItem({ kind: 'flight' }), '交通');
  assert.equal(categoryForItem({ kind: 'sight' }), '门票');
  assert.equal(categoryForPlace({ kind: 'cafe' }), '餐饮');
  assert.equal(categoryForPlace({ kind: 'hub' }), '交通');
  assert.equal(categoryForBooking({ kind: 'hotel' }), '住宿');
  assert.equal(categoryForBooking({ kind: 'transfer' }), '交通');
  assert.equal(categoryForItem(null), null);
  assert.equal(categoryForItem({ kind: 'nope' }), null);
  for (const c of CATEGORIES) assert.ok(CATEGORY_COLOR[c] >= 1 && CATEGORY_COLOR[c] <= 8, `${c} 有分类色`);
});

// ---------------------------------------------------------------------
// 分摊
// ---------------------------------------------------------------------

test('按金额：没动过的人自动补上剩下的；两人都没动时平分（余数给前面的人）', () => {
  assert.deepEqual(autoShares({ [A]: '420,000' }, { [A]: true }, 700000, [A, B], 'VND'), { [A]: '420,000', [B]: '280,000' });
  assert.deepEqual(autoShares({}, {}, 700001, [A, B], 'VND'), { [A]: '350,001', [B]: '350,000' });
  assert.deepEqual(autoShares({ [A]: '10.01' }, { [A]: true }, 20, [A, B], 'HKD'), { [A]: '10.01', [B]: '9.99' });
  // 填多了：剩下的记 0，交给对账提示
  assert.deepEqual(autoShares({ [A]: '900,000' }, { [A]: true }, 700000, [A, B], 'VND'), { [A]: '900,000', [B]: '0' });
  assert.deepEqual(autoShares({}, {}, null, [A, B], 'VND'), { [A]: '', [B]: '' });
});

test('表单 → split：平摊 / 个人 / 算别人的 / 按金额；一个人时就是 personal', () => {
  const base = { ...blankState(CTX), amountText: '700,000', currency: 'VND' };
  assert.deepEqual(buildSplit({ ...base, splitMode: 'equal' }, CTX), { mode: 'equal', user_ids: [A, B] });
  assert.deepEqual(buildSplit({ ...base, splitMode: 'personal' }, CTX), { mode: 'personal' });
  assert.deepEqual(buildSplit({ ...base, splitMode: 'personal', personalFor: B }, CTX), { mode: 'amounts', shares: [{ user_id: B, amount: 700000 }] });
  assert.deepEqual(buildSplit({ ...base, splitMode: 'amounts', shares: { [A]: '420,000' }, touched: { [A]: true } }, CTX), {
    mode: 'amounts', shares: [{ user_id: A, amount: 420000 }, { user_id: B, amount: 280000 }],
  });
  assert.deepEqual(buildSplit({ ...base, splitMode: 'equal' }, { sharers: [{ user_id: A, name: 'J' }] }), { mode: 'personal' });
  assert.equal(perPerson({ ...base, splitMode: 'equal' }, CTX), 350000);
  assert.equal(perPerson({ ...base, splitMode: 'personal' }, CTX), null);
});

test('已有的一笔 → 表单里的分摊：只有一个人、正好是总额的 amounts 显示成「个人」', () => {
  assert.equal(splitStateFromExpense({ amount: 700000, currency: 'VND', paid_by_user_id: A, split: { mode: 'equal', user_ids: [A, B] } }, CTX).splitMode, 'equal');
  const personal = splitStateFromExpense({ amount: 700000, currency: 'VND', paid_by_user_id: A, split: { mode: 'amounts', shares: [{ user_id: B, amount: 700000 }] } }, CTX);
  assert.deepEqual([personal.splitMode, personal.personalFor], ['personal', B]);
  const amounts = splitStateFromExpense({ amount: 700000, currency: 'VND', paid_by_user_id: B, split: { mode: 'amounts', shares: [{ user_id: A, amount: 420000 }, { user_id: B, amount: 280000 }] } }, CTX);
  assert.equal(amounts.splitMode, 'amounts');
  assert.deepEqual(amounts.shares, { [A]: '420,000', [B]: '280,000' });
  assert.equal(splitStateFromExpense({ amount: 1, currency: 'VND', split: {} }, CTX).splitMode, 'equal');
});

// ---------------------------------------------------------------------
// 预填、校验、提交
// ---------------------------------------------------------------------

const ITEM = { id: 'i1', title: '夜市烤海鲜', kind: 'night_market', day_id: 'd1', place_id: 'p1', start_time: '19:30:00', cost_estimate: { amount: 450000, currency: 'VND', per: 'person' } };
const PLACE = { id: 'p1', name: '椰影夜市', kind: 'market' };
const BOOKING = { id: 'b1', title: '半日浮潜', kind: 'activity', price_amount: 1800000, price_currency: 'VND', payment_status: 'unpaid' };
const DAY = { id: 'd1', date: '2027-01-10' };
const FULL = {
  ...CTX,
  getItem: (id) => (id === 'i1' ? ITEM : null),
  getPlace: (id) => (id === 'p1' ? PLACE : null),
  getBooking: (id) => (id === 'b1' ? BOOKING : null),
  getDay: (id) => (id === 'd1' ? DAY : null),
  getExpense: () => null,
  itemsOnDate: (date) => (date === '2027-01-10' ? [ITEM] : []),
};

test('空白表单：当地币、今天、现在的时间、我付、平摊', () => {
  const s = blankState(CTX);
  assert.equal(s.currency, 'VND');
  assert.equal(s.date, '2027-01-11');
  assert.equal(s.time, '10:30');
  assert.equal(s.payer, A);
  assert.equal(s.splitMode, 'equal');
  assert.equal(s.amountText, '');
});

test('预填：条目 → 日期、时间、分类、说明、地点、费用预估；预订 → 金额；日期 / 分类参数；地点顺手关联那天的条目', () => {
  const fromItem = initialState({ mode: 'new', id: null, fields: { item: 'i1' } }, FULL);
  assert.equal(fromItem.missing, false);
  assert.equal(fromItem.state.itemId, 'i1');
  assert.equal(fromItem.state.date, '2027-01-10');
  assert.equal(fromItem.state.time, '19:30');
  assert.equal(fromItem.state.category, '餐饮');
  assert.equal(fromItem.state.description, '夜市烤海鲜');
  assert.equal(fromItem.state.placeId, 'p1');
  assert.deepEqual(fromItem.hint, { amount: 450000, amountMax: null, currency: 'VND', per: 'person' });

  const fromBooking = initialState({ mode: 'new', id: null, fields: { booking: 'b1' } }, FULL);
  assert.equal(fromBooking.state.bookingId, 'b1');
  assert.equal(fromBooking.state.amountText, '1,800,000');
  assert.equal(fromBooking.state.category, '活动');

  const fromDate = initialState({ mode: 'new', id: null, fields: { date: '2027-01-12', category: '购物' } }, FULL);
  assert.equal(fromDate.state.date, '2027-01-12');
  assert.equal(fromDate.state.time, '', '不是今天：时间留空');
  assert.equal(fromDate.state.category, '购物');

  const fromPlace = initialState({ mode: 'new', id: null, fields: { place: 'p1', date: '2027-01-10' } }, FULL);
  assert.equal(fromPlace.state.itemId, 'i1', '那天有用这个地点的条目，顺手关联');
  assert.equal(fromPlace.state.description, '椰影夜市');
});

test('编辑：照那一笔填好；找不到的标 missing', () => {
  const e = {
    id: 'e1', amount: 700000, currency: 'VND', currency_iso: 'VND', date: '2027-01-10', category: '活动', description: '按摩', paid_by_user_id: B,
    split: { mode: 'amounts', shares: [{ user_id: A, amount: 420000 }, { user_id: B, amount: 280000 }] }, item_id: 'i1', booking_id: null, extra: { time: '21:00', place_id: 'p1' },
  };
  const ctx = { ...FULL, getExpense: (id) => (id === 'e1' ? e : null) };
  const r = initialState({ mode: 'edit', id: 'e1', fields: {} }, ctx);
  assert.equal(r.missing, false);
  assert.equal(r.state.amountText, '700,000');
  assert.equal(r.state.payer, B);
  assert.equal(r.state.splitMode, 'amounts');
  assert.equal(r.state.time, '21:00');
  assert.equal(r.state.placeId, 'p1');
  assert.equal(initialState({ mode: 'edit', id: 'nope', fields: {} }, ctx).missing, true);
  assert.equal(initialState({ mode: 'edit', id: 'e1', fields: {} }, { ...ctx, getExpense: () => ({ ...e, deleted_at: 'x' }) }).missing, true);
});

test('校验：没金额 → 金额；按金额对不上 → 分摊，带差多少（用 selectors.splitMismatch）', () => {
  const base = { ...blankState(CTX), currency: 'VND' };
  assert.deepEqual(validateState({ ...base, amountText: '' }, CTX, { splitMismatch }), { ok: false, field: 'amount', message: '先输入金额' });
  assert.deepEqual(validateState({ ...base, amountText: '0' }, CTX, { splitMismatch }).field, 'amount');
  const bad = { ...base, amountText: '700,000', splitMode: 'amounts', shares: { [A]: '500,000', [B]: '300,000' }, touched: { [A]: true, [B]: true } };
  const v = validateState(bad, CTX, { splitMismatch });
  assert.equal(v.ok, false);
  assert.equal(v.field, 'split');
  assert.equal(v.mismatch, -100000);
  assert.match(v.message, /多/);
  const ok = { ...base, amountText: '700,000', splitMode: 'amounts', shares: { [A]: '420,000' }, touched: { [A]: true } };
  assert.deepEqual(validateState(ok, CTX, { splitMismatch }), { ok: true });
  assert.equal(validateState({ ...base, amountText: '1', date: '2027-1-1' }, CTX).field, 'date');
});

test('提交：新建的参数；编辑只放改了的字段，金额变了分摊重写', () => {
  const s = { ...blankState(FULL), amountText: '350,000', currency: 'VND', category: '餐饮', description: ' 粉 ', itemId: 'i1', placeId: 'p1', time: '19:30' };
  const ins = toInsert(s, FULL);
  assert.equal(ins.amount, 350000);
  assert.equal(ins.currency, 'VND');
  assert.equal(ins.description, '粉');
  assert.equal(ins.category, '餐饮');
  assert.equal(ins.paid_by_user_id, A);
  assert.deepEqual(ins.split, { mode: 'equal', user_ids: [A, B] });
  assert.deepEqual(ins.extra, { time: '19:30', place_id: 'p1' });
  assert.equal(ins.item_id, 'i1');

  const e = { id: 'e1', amount: 350000, currency: 'VND', currency_iso: 'VND', date: '2027-01-11', category: '餐饮', description: '粉', paid_by_user_id: A, split: { mode: 'equal', user_ids: [A, B] }, item_id: 'i1', booking_id: null, receipt_path: null, extra: { time: '19:30', place_id: 'p1', fx_source: 'demo' } };
  assert.deepEqual(toPatch(s, e, FULL), {});
  const changed = toPatch({ ...s, amountText: '360,000', description: '两碗粉' }, e, FULL);
  assert.deepEqual(Object.keys(changed).sort(), ['amount', 'description']);
  assert.equal(changed.amount, 360000);
  const resplit = toPatch({ ...s, splitMode: 'personal', splitDirty: true }, e, FULL);
  assert.deepEqual(resplit, { split: { mode: 'personal' } });
  // extra 里别的键（fx_source）原样保留
  const retime = toPatch({ ...s, time: '20:00' }, e, FULL);
  assert.deepEqual(retime.extra, { fx_source: 'demo', time: '20:00', place_id: 'p1' });
  assert.equal(isDirty(s, s), false);
  assert.equal(isDirty({ ...s, amountText: '1' }, s), true);
  assert.equal(isDirty({ ...s, shares: { [A]: '1' } }, s), true);
});

// ---------------------------------------------------------------------
// 账本页：流水
// ---------------------------------------------------------------------

const EXP = [
  { id: 'e1', date: '2027-01-11', category: '餐饮', amount: 140000, currency: 'VND', paid_by_user_id: A, split: { mode: 'equal', user_ids: [A, B] }, created_at: '2027-01-11T01:00:00+00:00' },
  { id: 'e2', date: '2027-01-11', category: '交通', amount: 150000, currency: 'VND', paid_by_user_id: A, split: { mode: 'equal', user_ids: [A, B] }, created_at: '2027-01-11T02:00:00+00:00' },
  { id: 'e3', date: '2027-01-10', category: '购物', amount: 180000, currency: 'VND', paid_by_user_id: B, split: { mode: 'personal' }, created_at: '2027-01-10T03:00:00+00:00' },
  { id: 'e4', date: null, category: '奇怪', amount: 35, currency: 'CNY', paid_by_user_id: A, split: { mode: 'amounts', shares: [{ user_id: A, amount: 20 }, { user_id: B, amount: 15 }] }, created_at: '2027-01-12T03:00:00+00:00' },
];

test('按天分组：新 → 旧，没写日期的最后一组；每组带笔数、折合小计、D 几', () => {
  const g = groupByDate(EXP, { timeZone: 'Asia/Ho_Chi_Minh', startDate: '2027-01-10', at: new Date('2027-01-11T10:00:00+07:00'), homeOf: (e) => (e.currency === 'VND' ? e.amount / 3300 : null) });
  assert.deepEqual(g.map((x) => x.key), ['2027-01-11', '2027-01-10', 'undated']);
  assert.equal(g[0].primary, '今天');
  assert.equal(g[0].dayNo, 2);
  assert.equal(g[0].count, 2);
  assert.ok(Math.abs(g[0].homeTotal - 290000 / 3300) < 0.01);
  assert.equal(g[1].primary, '昨天');
  assert.equal(g[2].primary, '没写日期');
  assert.equal(g[2].homeTotal, null, '折不了的就不给小计');
  assert.equal(g[2].dayNo, null);
  assert.deepEqual(groupByDate([], {}), []);
});

test('筛选和计数：不认识的分类算「其他」；分类和谁付可以叠加；每个人付了几笔', () => {
  assert.deepEqual(filterExpenses(EXP, { category: '餐饮' }).map((e) => e.id), ['e1']);
  assert.deepEqual(filterExpenses(EXP, { category: '其他' }).map((e) => e.id), ['e4']);
  assert.deepEqual(filterExpenses(EXP, { payer: B }).map((e) => e.id), ['e3']);
  assert.deepEqual(filterExpenses(EXP, { category: '购物', payer: A }).map((e) => e.id), []);
  assert.deepEqual(filterExpenses(EXP, { category: '购物', payer: B }).map((e) => e.id), ['e3']);
  assert.equal(filterExpenses(EXP, {}).length, 4);
  const c = categoryCounts(EXP);
  assert.equal(c.餐饮, 1);
  assert.equal(c.其他, 1);
  assert.equal(c.住宿, 0);
  assert.deepEqual(payerCounts(EXP), { [A]: 3, [B]: 1 });
  assert.deepEqual(payerCounts([{ amount: 1 }]), {}, '没记付款人的不算');
});

test('汇率那一行：正常 / 离线按最近一次汇率并写更新时间 / 过期提醒 / 内置参考值 / 没外币不说', () => {
  const at = new Date('2027-01-11T10:00:00+07:00');
  const snap = demoSnapshot(at);
  assert.deepEqual(fxNote({ snapshot: snap, isOnline: true, foreign: 'VND', at }), { text: '演示汇率 · 5 小时前更新 · 1 港币 ≈ 3,294 越南盾', tone: undefined });
  assert.deepEqual(fxNote({ snapshot: snap, isOnline: false, foreign: 'VND', at }), { text: '离线 · 按最近一次汇率折算（5 小时前更新）', tone: 'offline' });
  assert.deepEqual(fxNote({ snapshot: { ...snap, source: 'cache', offline: true }, isOnline: true, foreign: 'VND', at }).tone, 'offline', '汇率服务自己说离线也算');
  assert.deepEqual(fxNote({ snapshot: { ...snap, source: 'cache', stale: true }, isOnline: true, foreign: 'VND', at }), { text: '汇率 5 小时前更新，可能已过期', tone: 'warning' });
  assert.deepEqual(fxNote({ snapshot: fallbackSnapshot(), isOnline: true, foreign: 'VND', at }), { text: '离线 · 暂时按内置参考汇率折算', tone: 'offline' });
  assert.match(fxNote({ snapshot: snap, isOnline: true, foreign: 'VND', approxCount: 2, at }).text, /2 笔按参考汇率估算/);
  assert.equal(fxNote({ snapshot: null, isOnline: true, foreign: 'VND', at }).text, '正在获取汇率…');
  assert.equal(fxNote({ snapshot: snap, isOnline: true, foreign: null, at }), null);
});

test('记一笔面板底部的说明：按什么汇率记、离线先存手机、过期提醒、只读、本币不说', () => {
  const at = new Date('2027-01-11T10:00:00+07:00');
  const snap = demoSnapshot(at);
  assert.deepEqual(footerNote({ snapshot: snap, isOnline: true, currency: 'VND', home: 'HKD', at }), { text: '按 1 港币 ≈ 3,294 越南盾 折算 · 演示汇率 · 5 小时前更新', tone: undefined });
  const off = footerNote({ snapshot: snap, isOnline: false, currency: 'VND', home: 'HKD', at });
  assert.equal(off.tone, 'offline');
  assert.match(off.text, /^现在离线：先存在手机上，联网后自动同步 · 按最近一次汇率（1 港币 ≈ 3,294 越南盾，5 小时前更新）记$/);
  assert.deepEqual(footerNote({ snapshot: null, isOnline: false, currency: 'VND', home: 'HKD', at }), { text: '现在离线：先存在手机上，联网后自动同步 · 联网后再补汇率', tone: 'offline' });
  const stale = footerNote({ snapshot: { ...snap, source: 'cache', stale: true, offline: true }, isOnline: true, currency: 'CNY', home: 'HKD', at });
  assert.deepEqual(stale, { text: '按 1 人民币 ≈ 1.17 港币 折算 · 汇率 5 小时前更新，先按这个汇率记', tone: 'warning' });
  assert.equal(footerNote({ snapshot: fallbackSnapshot(), isOnline: true, currency: 'VND', home: 'HKD', at }).tone, 'warning');
  assert.deepEqual(footerNote({ snapshot: snap, isOnline: true, currency: 'HKD', home: 'HKD', at }), { text: ' ', tone: undefined }, '本币：留一行空的，按钮不跳');
  assert.equal(footerNote({ snapshot: snap, isOnline: true, currency: 'VND', home: 'HKD', readOnly: true, at }).text, '你是只读成员，不能记账');
  assert.equal(footerNote({ snapshot: null, isOnline: true, currency: 'VND', home: 'HKD', at }).text, '正在获取汇率…');
});

test('怎么分的一句话：平摊每人、个人（算谁的）、按金额、旧数据', () => {
  assert.deepEqual(splitInfo(EXP[0], 'VND'), { mode: 'equal', text: '平摊', ids: [A, B], perPerson: 70000, n: 2 });
  assert.deepEqual(splitInfo(EXP[2], 'VND'), { mode: 'personal', text: '个人', forId: B, forOther: false });
  assert.equal(splitInfo(EXP[3], 'CNY').mode, 'amounts');
  const forOther = splitInfo({ amount: 100, currency: 'HKD', paid_by_user_id: A, split: { mode: 'amounts', shares: [{ user_id: B, amount: 100 }] } }, 'HKD');
  assert.deepEqual(forOther, { mode: 'personal', text: '个人', forId: B, forOther: true });
  assert.equal(splitInfo({ amount: 100, currency: 'HKD', split: {}, split_with: ['x', 'y'] }, 'HKD').mode, 'equal');
  assert.equal(splitInfo({ amount: 100, currency: 'HKD', split: {} }, 'HKD').legacy, true);
});

// ---------------------------------------------------------------------
// 账本页：结算
// ---------------------------------------------------------------------

const LEDGER = {
  count: 4,
  currencies: [
    { currency: 'VND', net: { [A]: 145000, [B]: -145000 }, transfers: [{ from: B, to: A, amount: 145000 }] },
    { currency: 'HKD', net: { [A]: -50, [B]: 50 }, transfers: [{ from: A, to: B, amount: 50 }] },
  ],
};

test('结算：扣掉已结清的转账 → 还没结的；结清后新记的账从零算；撤销后回来', () => {
  const before = applySettlements(LEDGER, []);
  assert.equal(before.balanced, false);
  assert.deepEqual(before.outstanding, [
    { currency: 'VND', transfers: [{ from: B, to: A, amount: 145000 }] },
    { currency: 'HKD', transfers: [{ from: A, to: B, amount: 50 }] },
  ]);
  const rec = settlementRecord(before.outstanding, { by: A, at: '2027-01-11T14:00:00+07:00', count: 4 });
  assert.equal(rec.at, '2027-01-11T07:00:00.000Z');
  assert.equal(rec.count, 4);
  assert.deepEqual(rec.transfers, [{ from: B, to: A, currency: 'VND', amount: 145000 }, { from: A, to: B, currency: 'HKD', amount: 50 }]);
  const after = applySettlements(LEDGER, [rec]);
  assert.equal(after.balanced, true);
  assert.equal(after.settledCount, 1);
  assert.equal(after.last.id, rec.id);
  // 之后又记了一笔：Jeremy 付 20,000₫ 平摊 → Cathy 应给 10,000₫
  const later = { ...LEDGER, currencies: [{ currency: 'VND', net: { [A]: 155000, [B]: -155000 } }, LEDGER.currencies[1]] };
  assert.deepEqual(applySettlements(later, [rec]).outstanding, [{ currency: 'VND', transfers: [{ from: B, to: A, amount: 10000 }] }]);
  // 结清以后把那些账删掉了：结清的钱变成反向的未结（Jeremy 要退给 Cathy）
  const gone = { count: 0, currencies: [] };
  assert.deepEqual(applySettlements(gone, [rec]).outstanding, [
    { currency: 'VND', transfers: [{ from: A, to: B, amount: 145000 }] },
    { currency: 'HKD', transfers: [{ from: B, to: A, amount: 50 }] },
  ]);
  // 没记付款人的（unknown）不参与结算
  assert.deepEqual(applySettlements({ currencies: [{ currency: 'HKD', net: { unknown: -10, [A]: 10 } }] }, []).outstanding, []);
  assert.deepEqual(settleNet(new Map([[A, 0], [B, 0]])), []);
});

test('结算行：同一对人的几种币种并成一行「Cathy 应给 Jeremy …」', () => {
  const lines = settlementLines([
    { currency: 'CNY', transfers: [{ from: B, to: A, amount: 2625.63 }] },
    { currency: 'HKD', transfers: [{ from: B, to: A, amount: 418.66 }] },
    { currency: 'VND', transfers: [{ from: A, to: B, amount: 50000 }] },
  ], (id) => (id === A ? 'Jeremy' : 'Cathy'));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { from: B, to: A, fromName: 'Cathy', toName: 'Jeremy', amounts: [{ currency: 'CNY', amount: 2625.63 }, { currency: 'HKD', amount: 418.66 }] });
  assert.equal(lines[1].fromName, 'Jeremy');
});

test('结清记录存在 trips.extra.ledger_settlements：读的时候过滤坏数据并按时间排，写的时候别的键原样保留', () => {
  const trip = { extra: { party_size: 2, [SETTLEMENTS_KEY]: [
    { id: 'b', at: '2027-01-12T00:00:00Z', by: A, transfers: [{ from: A, to: B, currency: 'HKD', amount: 1 }] },
    { id: 'a', at: '2027-01-11T00:00:00Z', by: B, transfers: [{ from: A, to: B, currency: 'HKD', amount: 2 }, { bad: true }] },
    'junk', { id: 'c' },
  ] } };
  const list = readSettlements(trip);
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
  assert.equal(list[0].transfers.length, 1, '坏的转账被丢掉');
  assert.deepEqual(readSettlements({ extra: {} }), []);
  assert.deepEqual(readSettlements(null), []);
  assert.deepEqual(withSettlements(trip.extra, list), { party_size: 2, [SETTLEMENTS_KEY]: list });
  assert.deepEqual(withSettlements(trip.extra, []), { party_size: 2 });
  assert.deepEqual(withSettlements(null, [list[0]]), { [SETTLEMENTS_KEY]: [list[0]] });
});

test('和数据层的汇总接得上：ledgerSummary 的 net → applySettlements 得到和它的 transfers 一样的结果', () => {
  const bundle = bundleFromRows('t', {
    trips: [{ id: 't', home_currency: 'HKD', local_currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', title: 't' }],
    trip_members: [{ trip_id: 't', user_id: A, role: 'owner', display_name: 'Jeremy' }, { trip_id: 't', user_id: B, role: 'editor', display_name: 'Cathy' }],
    expenses: EXP.map((e) => ({ ...e, trip_id: 't', currency_iso: e.currency, home_currency: 'HKD', fx_rate: e.currency === 'VND' ? 1 / 3300 : 1.17, deleted_at: null })),
  });
  const ledger = ledgerSummary(bundle);
  const mine = applySettlements(ledger, []);
  for (const c of ledger.currencies) {
    const got = mine.outstanding.find((x) => x.currency === c.currency)?.transfers || [];
    assert.deepEqual(got, c.transfers, c.currency);
  }
});

// ---------------------------------------------------------------------
// 账本页：统计
// ---------------------------------------------------------------------

test('分类横条、按天、按人', () => {
  const ledger = {
    byCategory: [{ category: '餐饮', total: 400, count: 4 }, { category: '交通', total: 100, count: 1 }, { category: '住宿', total: 0, count: 0 }],
    byDate: [{ date: '2027-01-11', total: 300, count: 3 }, { date: null, total: 50, count: 1 }, { date: '2027-01-10', total: 250, count: 2 }],
    home: { currency: 'HKD', paid: { [A]: 400, [B]: 100 }, share: { [A]: 250, [B]: 250 }, net: { [A]: 150, [B]: -150 } },
    currencies: [{ currency: 'HKD', paid: { [A]: 400, [B]: 100 }, share: { [A]: 250, [B]: 250 }, net: { [A]: 150, [B]: -150 } }],
    people: [{ id: A, name: 'Jeremy', color: '#2F6FDE', member: true }, { id: B, name: 'Cathy', color: null, member: true }, { id: 'unknown', name: '未记录付款人', member: false }],
  };
  const bars = categoryBars(ledger);
  assert.deepEqual(bars.map((b) => [b.category, b.ratio, Math.round(b.share * 100), b.color]), [['餐饮', 1, 80, 1], ['交通', 0.25, 20, 2]]);
  const days = dayBars(ledger, { timeZone: 'Asia/Ho_Chi_Minh', startDate: '2027-01-10', at: new Date('2027-01-11T10:00:00+07:00') });
  assert.deepEqual(days.map((d) => [d.date, d.dayNo, d.ratio]), [['2027-01-10', 1, 250 / 300], ['2027-01-11', 2, 1], [null, null, 50 / 300]]);
  assert.equal(days[1].label, '今天');
  assert.equal(days[2].label, '没写日期');
  const people = peopleStats(ledger);
  assert.deepEqual(people.map((p) => [p.name, p.paidHome, p.shareHome, p.netHome, p.paidRatio]), [['Jeremy', 400, 250, 150, 1], ['Cathy', 100, 250, -150, 0.25]]);
  assert.equal(categoryBars({ byCategory: [] }).length, 0);
});

test('结清之后新记了几笔：有 count 按笔数差，没有按 created_at', () => {
  assert.equal(countSince(EXP, { at: '2027-01-11T01:30:00+00:00', count: 3 }), 1);
  assert.equal(countSince(EXP, { at: '2027-01-11T01:30:00+00:00', count: 9 }), 0, '删掉了几笔也不会是负数');
  assert.equal(countSince(EXP, { at: '2027-01-11T01:30:00+00:00' }), 2);
  assert.equal(countSince(EXP, null), 0);
  assert.equal(countSince(EXP, { at: 'nope' }), 0);
});

// ---------------------------------------------------------------------
// 工程规则
// ---------------------------------------------------------------------

test('页面和弹层只从 data/index.js、sheets/index.js 拿数据和开弹层，不直接拼 Grab / 地图链接、不写 window.open', () => {
  for (const f of ['pages/ledger/LedgerPage.jsx', 'pages/ledger/parts.jsx', 'pages/ledger/hooks.js', 'pages/ledger/model.js', 'sheets/expense/ExpenseSheet.jsx', 'sheets/expense/AmountField.jsx', 'sheets/expense/parts.jsx', 'sheets/expense/notes.js']) {
    const src = read(f);
    assert.ok(!/window\.open\(/.test(src), `${f} 不直接 window.open`);
    assert.ok(!/supabase/.test(src), `${f} 不直接碰 supabase`);
    assert.ok(!/grab\.onelink|google\.com\/maps/.test(src), `${f} 不自己拼外链`);
    // data/dest.js 是规则包的胶水（目的地档案、这一项所在地的币种；纯函数、不碰后台），批 A 起也可以直接引
    assert.ok(!/from '\.\.\/\.\.\/data\/(?!index\.js|dest\.js)/.test(src), `${f} 只从 data/index.js 拿数据`);
  }
});

test('用户能看到的字是简体中文（没有繁体常见字、没有英文提示句）', () => {
  const traditional = /[這個們裡時說為對應該請點擊設確刪編輯錄賬帳餘額匯結費還沒]/;
  for (const f of ['pages/ledger/LedgerPage.jsx', 'pages/ledger/parts.jsx', 'pages/ledger/model.js', 'pages/ledger/hooks.js', 'sheets/expense/ExpenseSheet.jsx', 'sheets/expense/AmountField.jsx', 'sheets/expense/parts.jsx', 'sheets/expense/form-model.js', 'sheets/expense/notes.js']) {
    assert.ok(!traditional.test(read(f)), `${f} 不含繁体字`);
  }
});
