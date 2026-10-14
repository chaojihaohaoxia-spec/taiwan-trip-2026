// 行程概览页（pages/trip）的纯逻辑：航班（去程 / 回程、起降按各自时区、时差提示）、倒计时、待办的急缓和截止说法、
// 卡片顺序（出发前 / 进行中）、「现在 / 接下来」、时间轴缩略、今天花了多少、今晚住哪、日出日落、每天概要、打包进度、
// 回顾（数字、结算、评级最高、日记摘录、每天一张照片、路线）、备选池排进某天。
// 数据用演示行程（demo/demo-db.json，全部虚构），时刻用固定的 Date，不碰 DOM。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDemoDb, JEREMY, CATHY } from './helpers/data.js';
import {
  liveFlights, outboundFlight, returnFlight, flightView, flightStatus, tzShiftText,
  departureTarget, countdownParts,
  pendingTodos, dueInfo, todayTodos,
  upcomingOrder, ongoingOrder,
  nowModel, timelineWindow, spendSummary, stayInfo, minutesUntil, sunInfo, weatherNote,
  dayRouteLine, paceLabel, stayShortName, dayCountWord, dayColorIndex, dayCardModel,
  recapStats, settlementLines, topRatedPlaces, excerpt, journalExcerpts, dayPhotos, segmentRoute,
  scheduleTarget, itemTimeText, localDateOf,
  tomorrowOf, isReturnDay, packingSummary, freeCancelDeadlines, weatherLine, sunsetLeft, expenseCategoryOf,
} from '../../src/pages/trip/model.js';
import * as selectors from '../../src/data/selectors.js';

const DB = loadDemoDb();
const rows = (table, tripId = 'demo-island') => DB.tables[table].filter((r) => r.trip_id === tripId);
const byId = (table, tripId) => new Map(rows(table, tripId).map((r) => [r.id, r]));
const island = DB.tables.trips.find((t) => t.id === 'demo-island');
const cities = DB.tables.trips.find((t) => t.id === 'demo-cities');
const bundle = (tripId) => selectors.bundleFromRows(tripId, Object.fromEntries(
  ['trip_members', 'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'expenses', 'journal_entries', 'reviews']
    .map((t) => [t, rows(t, tripId)]).concat([['trips', DB.tables.trips.filter((t) => t.id === tripId)]]),
));
const TZ = 'Asia/Ho_Chi_Minh';
const BEFORE = new Date('2027-01-08T09:00:00+07:00');
const DURING = new Date('2027-01-11T10:00:00+07:00');

// ---------------------------------------------------------------------
// 航班
// ---------------------------------------------------------------------

test('航班：去程是出发当天（或前一天红眼）起飞的第一班，回程是最后一天起飞的最后一班；取消的不算', () => {
  const bookings = rows('bookings');
  const out = outboundFlight(bookings, island);
  const back = returnFlight(bookings, island);
  assert.equal(out.details.flight_no, 'DM801');
  assert.equal(back.details.flight_no, 'DM802');
  assert.ok(liveFlights(bookings).every((f) => f.status !== 'cancelled'));
  // 没有航班 / 没有日期
  assert.equal(outboundFlight([], island), null);
  assert.equal(outboundFlight(bookings, { timezone: TZ }), null);
  // 行程中途的内陆航班不算去程：起飞日期在第一天之后
  const mid = { ...out, id: 'x', start_at: '2027-01-11T09:00:00+07:00', start_tz: TZ };
  assert.equal(outboundFlight([mid], island), null);
  assert.equal(returnFlight([mid], island), null);
});

test('航班显示：起飞按出发地时区、落地按到达地时区，时长和时差提示正确；落地跨日标「次日」', () => {
  const out = outboundFlight(rows('bookings'), island);
  const v = flightView(out, { fallbackTz: TZ });
  assert.equal(v.depTime, '08:05');
  assert.equal(v.arrTime, '10:20');
  assert.equal(v.depZone, '香港');
  assert.equal(v.arrZone, '越南');
  assert.equal(v.from, 'HKG');
  assert.equal(v.to, 'VCS');
  // 08:05 +08 → 10:20 +07 = 3 小时 15 分
  assert.equal(v.durationMinutes, 195);
  assert.equal(v.duration, '3 小时 15 分');
  assert.equal(v.tzNote, '落地按越南时间（慢 1 小时）');
  assert.equal(v.arrShift, '');
  assert.equal(v.status.label, '机票已出票');
  assert.deepEqual(v.seats, ['21A', '21B']);
  const back = flightView(returnFlight(rows('bookings'), island), { fallbackTz: TZ });
  assert.equal(back.checkedKg, 20);
  assert.equal(back.carryKg, 7);
  assert.equal(back.tzNote, '落地按香港时间（快 1 小时）');
  // 红眼：23:30 起飞，次日 02:10 落地
  const red = flightView({ id: 'r', status: 'booked', start_at: '2027-01-09T23:30:00+08:00', start_tz: 'Asia/Hong_Kong', end_at: '2027-01-10T02:10:00+07:00', end_tz: TZ, details: {} });
  assert.equal(red.depTime, '23:30');
  assert.equal(red.arrTime, '02:10');
  assert.equal(red.arrShift, '次日');
  // 没有落地时间：时长、时差都没有
  const open = flightView({ id: 'o', start_at: '2027-01-10T08:05:00+08:00', start_tz: 'Asia/Hong_Kong', details: { flight_no: 'X1' } });
  assert.equal(open.arrTime, null);
  assert.equal(open.duration, null);
  assert.equal(open.tzNote, null);
  assert.equal(flightView(null), null);
});

test('时差提示和票务状态的说法', () => {
  assert.equal(tzShiftText(0, TZ), '两地没有时差');
  assert.equal(tzShiftText(-60, TZ), '落地按越南时间（慢 1 小时）');
  assert.equal(tzShiftText(90, 'Asia/Tokyo'), '落地按东京时间（快 1 小时 30 分）');
  assert.equal(tzShiftText(NaN, TZ), null);
  assert.equal(flightStatus({ status: 'pending' }).label, '等出票');
  assert.equal(flightStatus({ status: 'idea' }).tone, 'warning');
  assert.equal(flightStatus({ status: 'cancelled' }).label, '航班已取消');
  assert.equal(flightStatus(null).label, '机票');
});

// ---------------------------------------------------------------------
// 倒计时
// ---------------------------------------------------------------------

test('倒计时：有去程航班数到起飞那一刻，否则数到出发日在行程时区的零点；天 / 小时 / 分钟三档', () => {
  const out = outboundFlight(rows('bookings'), island);
  const t = departureTarget(island, out);
  assert.equal(t.kind, 'flight');
  assert.equal(t.at, Date.parse('2027-01-10T08:05:00+08:00'));
  const t2 = departureTarget(island, null);
  assert.equal(t2.kind, 'trip');
  assert.equal(t2.at, Date.parse('2027-01-10T00:00:00+07:00'));
  assert.equal(departureTarget({ timezone: TZ }, null), null);

  // 2027-01-08 09:00 +07 → 起飞 01-10 08:05 +08（= 01-10 07:05 +07）：1 天 22 小时 5 分
  const left = t.at - BEFORE.getTime();
  const p = countdownParts(left);
  assert.deepEqual([p.big, p.unit, p.hours, p.minutes], [1, '天', 22, 5]);
  assert.equal(p.label, '1 天 22 小时 5 分');
  const h = countdownParts(5 * 3_600_000 + 7 * 60_000);
  assert.deepEqual([h.big, h.unit, h.minutes], [5, '小时', 7]);
  const m = countdownParts(20 * 60_000 + 10_000);
  assert.deepEqual([m.big, m.unit], [20, '分钟']);
  assert.deepEqual([countdownParts(10_000).big, countdownParts(10_000).unit], [1, '分钟']);
  assert.equal(countdownParts(0), null);
  assert.equal(countdownParts(-5), null);
  // 整天：小字不写小时分钟
  assert.equal(countdownParts(2 * 86_400_000).label, '2 天');
});

// ---------------------------------------------------------------------
// 待办
// ---------------------------------------------------------------------

test('待办：没做的按急缓排（过期 → 有截止 → 没截止；待确认在待办前面），打包不算', () => {
  const list = pendingTodos(byId('todos'));
  assert.ok(list.length > 0);
  assert.ok(list.every((t) => !t.done && ['confirm', 'todo'].includes(t.list)));
  const withDue = list.filter((t) => t.due_at);
  const noDue = list.filter((t) => !t.due_at);
  // 有截止的都在没截止的前面，并且按时间先后
  assert.equal(list.indexOf(withDue[withDue.length - 1]) < list.indexOf(noDue[0]), true);
  for (let i = 1; i < withDue.length; i++) assert.ok(Date.parse(withDue[i - 1].due_at) <= Date.parse(withDue[i].due_at));
  // 没截止的：待确认先于待办
  const firstTodo = noDue.findIndex((t) => t.list === 'todo');
  const lastConfirm = noDue.map((t) => t.list).lastIndexOf('confirm');
  if (firstTodo >= 0 && lastConfirm >= 0) assert.ok(lastConfirm < firstTodo);
});

test('截止说法：已过期 / 不到 1 天 / 1–3 天 / 更远，各自的语气', () => {
  const at = BEFORE;
  assert.equal(dueInfo('2027-01-08T08:00:00+07:00', { at, timeZone: TZ }).state, 'overdue');
  assert.match(dueInfo('2027-01-08T08:00:00+07:00', { at, timeZone: TZ }).text, /已过期$/);
  const urgent = dueInfo('2027-01-08T18:00:00+07:00', { at, timeZone: TZ });
  assert.deepEqual([urgent.state, urgent.tone], ['urgent', 'danger']);
  assert.equal(urgent.text, '今天 18:00 前 · 还剩 9 小时');
  const soon = dueInfo('2027-01-09T20:00:00+07:00', { at, timeZone: TZ });
  assert.deepEqual([soon.state, soon.tone], ['soon', 'warning']);
  assert.match(soon.text, /^明天 20:00 前 · 还剩 1 天 11 小时$/);
  const later = dueInfo('2027-01-20T08:05:00+07:00', { at, timeZone: TZ });
  assert.deepEqual([later.state, later.tone], ['later', 'neutral']);
  assert.equal(later.text, '1月20日 08:05 前');
  assert.equal(dueInfo('not a date', { at, timeZone: TZ }), null);
});

test('今天的待办：挂在今天的 + 今天到期的在前，更早过期还没做的排在后面，去重', () => {
  const todos = byId('todos');
  const d2 = rows('days').find((d) => d.date === '2027-01-11');
  const list = todayTodos(todos, { dayId: d2.id, date: d2.date, timeZone: TZ });
  assert.ok(list.length > 0);
  assert.ok(list.every((t) => !t.done && t.list !== 'packing'));
  assert.ok(list.some((t) => t.day_id === d2.id), '挂在今天的在里面');
  const isStale = (t) => t.day_id !== d2.id && t.due_at && localDateOf(t.due_at, TZ) < d2.date;
  assert.ok(list.some(isStale), '更早过期的也在');
  assert.ok(!list.some((t) => t.due_at && !t.day_id && localDateOf(t.due_at, TZ) > d2.date), '以后才到期的不在');
  const firstStale = list.findIndex(isStale);
  assert.ok(list.slice(firstStale).every(isStale), '过期的都在今天的后面');
  assert.ok(!list.slice(0, firstStale).some(isStale));
  assert.equal(new Set(list.map((t) => t.id)).size, list.length);
});

// ---------------------------------------------------------------------
// 卡片顺序
// ---------------------------------------------------------------------

test('出发前的顺序：倒计时永远第一；急的免费取消紧跟其后；3 天内出发还没打包完的打包提前；7 天内天气提前', () => {
  assert.deepEqual(upcomingOrder({ daysUntil: 20, packingLeft: 10 }), ['hero', 'todos', 'deadlines', 'days', 'weather', 'packing', 'pool']);
  assert.deepEqual(upcomingOrder({ daysUntil: 5, packingLeft: 10 }), ['hero', 'todos', 'deadlines', 'weather', 'days', 'packing', 'pool']);
  assert.deepEqual(upcomingOrder({ daysUntil: 2, packingLeft: 3 }), ['hero', 'todos', 'deadlines', 'packing', 'weather', 'days', 'pool']);
  assert.deepEqual(upcomingOrder({ daysUntil: 2, packingLeft: 0 }), ['hero', 'todos', 'deadlines', 'weather', 'days', 'packing', 'pool']);
  assert.deepEqual(upcomingOrder({ daysUntil: 2, urgentDeadline: true, packingLeft: 0 }), ['hero', 'deadlines', 'todos', 'weather', 'days', 'packing', 'pool']);
  assert.deepEqual(upcomingOrder({ daysUntil: null }), ['hero', 'todos', 'deadlines', 'days', 'weather', 'packing', 'pool']);
});

test('进行中的顺序：现在 / 接下来第一；最后一天紧跟回程航班；傍晚或都做完了住哪提前；急的待办、快日落提前', () => {
  const base = ongoingOrder({ minutes: 10 * 60, hasUpcoming: true });
  assert.deepEqual(base, ['now', 'timeline', 'spend', 'weather', 'stay', 'todos', 'deadlines', 'tomorrow', 'pool']);
  assert.deepEqual(ongoingOrder({ minutes: 19 * 60, hasUpcoming: true }).slice(0, 2), ['now', 'stay']);
  assert.deepEqual(ongoingOrder({ minutes: 10 * 60, hasUpcoming: false }).slice(0, 2), ['now', 'stay']);
  assert.deepEqual(ongoingOrder({ minutes: 19 * 60, hasUpcoming: true, isLastDay: true }).slice(0, 3), ['now', 'flight', 'timeline']);
  assert.deepEqual(ongoingOrder({ minutes: 10 * 60, hasUpcoming: true, todoSoon: true }).slice(0, 2), ['now', 'todos']);
  const sunset = ongoingOrder({ minutes: 16 * 60, hasUpcoming: true, sunsetSoon: true });
  assert.deepEqual(sunset.slice(0, 2), ['now', 'weather']);
  assert.equal(sunset.filter((k) => k === 'weather').length, 1);
  for (const o of [base, sunset]) assert.equal(new Set(o).size, o.length, '每种卡只出现一次');
});

// ---------------------------------------------------------------------
// 进行中
// ---------------------------------------------------------------------

test('现在 / 接下来：演示岛 01-11 10:00 正在浮潜，接下来是海鲜午餐；没有正在进行的就是 next；都做完 done；没安排 free', () => {
  const b = bundle('demo-island');
  const plans = new Map([...selectors.itemsByDay(b.items)].filter(([k]) => k !== null).map(([k, list]) => [k, selectors.dayPlan(list)]));
  const today = selectors.todaySummary(b, plans, DURING);
  const primary = plans.get(today.day.id).primary;
  const m = nowModel(today, primary);
  assert.equal(m.mode, 'current');
  assert.equal(m.focus.title, '半日浮潜');
  assert.equal(m.next.title, '老码头海鲜午餐');
  assert.equal(m.minutesUntilNext, 180);
  assert.equal(nowModel({ day: today.day, current: null, next: m.next, minutesUntilNext: 30 }, primary).mode, 'next');
  const allDone = primary.map((i) => ({ ...i, status: 'done' }));
  assert.equal(nowModel({ day: today.day, current: null, next: null }, allDone).mode, 'done');
  assert.equal(nowModel({ day: today.day, current: null, next: null }, []).mode, 'free');
  const loose = [{ id: 'x', status: 'planned', start_time: null, title: '随便逛' }];
  assert.deepEqual([nowModel({ day: today.day, current: null, next: null }, loose).mode, nowModel({ day: today.day, current: null, next: null }, loose).focus.id], ['loose', 'x']);
  assert.equal(nowModel({ day: null }).mode, 'none');
});

test('时间轴缩略：围着锚点取 5 条，前面留一条，前后各报还藏着几条；条数不够全给', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, status: i < 3 ? 'done' : 'planned', start_time: `${String(6 + i).padStart(2, '0')}:00` }));
  const w = timelineWindow(list, { anchorId: 'i5' });
  assert.deepEqual(w.items.map((i) => i.id), ['i4', 'i5', 'i6', 'i7', 'i8']);
  assert.deepEqual([w.hiddenBefore, w.hiddenAfter, w.anchorIndex], [4, 3, 1]);
  const tail = timelineWindow(list, { anchorId: 'i11' });
  assert.deepEqual(tail.items.map((i) => i.id), ['i7', 'i8', 'i9', 'i10', 'i11']);
  assert.equal(tail.hiddenAfter, 0);
  const noAnchor = timelineWindow(list);
  assert.equal(noAnchor.items[1].id, 'i3', '没有锚点时围着第一条计划中的');
  const few = timelineWindow(list.slice(0, 3));
  assert.deepEqual([few.items.length, few.hiddenBefore, few.hiddenAfter], [3, 0, 0]);
});

test('今天花了多少：按币种分别合计（不换汇）+ 折合港币；软删除的不算；最近一笔', () => {
  const expenses = selectors.liveExpenses(byId('expenses'));
  const s = spendSummary(expenses, { date: '2027-01-11', homeOf: (e) => selectors.expenseHomeAmount(e, 'HKD')?.value ?? null });
  assert.equal(s.count, 5);
  const vnd = s.byCurrency.find((c) => c.currency === 'VND');
  const cny = s.byCurrency.find((c) => c.currency === 'CNY');
  assert.equal(vnd.total, 140000 + 1180000 + 150000 + 240000);
  assert.equal(vnd.count, 4);
  assert.equal(cny.total, 35);
  assert.equal(s.byCurrency[0].currency, 'VND', '笔数多的币种在前');
  assert.ok(s.hkd > 0 && s.complete);
  assert.ok(s.latest);
  const none = spendSummary(expenses, { date: '2020-01-01' });
  assert.deepEqual([none.count, none.hkd, none.byCurrency.length, none.latest], [0, 0, 0, null]);
  // 没有汇率的币种：complete = false
  const odd = spendSummary([{ id: 'x', amount: 10, currency: 'XXX', date: '2027-01-11' }], { date: '2027-01-11' });
  assert.equal(odd.complete, false);
});

test('今晚住哪：入住当天「今天 14:00 起可入住」、退房前一晚「明天 12:00 前退房」、中间「住到…」，第几晚 / 共几晚', () => {
  const hotel = rows('bookings').find((b) => b.id === rows('bookings').find((x) => x.details?.nights === 2)?.id);
  const a = stayInfo(hotel, { date: '2027-01-10', timeZone: TZ });
  assert.equal(a.when, '今天 14:00 起可入住');
  assert.equal(a.nightText, '第 1 晚 / 共 2 晚');
  assert.equal(a.checkinToday, true);
  const b = stayInfo(hotel, { date: '2027-01-11', timeZone: TZ });
  assert.equal(b.when, '明天 12:00 前退房');
  assert.equal(b.nightText, '第 2 晚 / 共 2 晚');
  const three = { ...hotel, end_at: '2027-01-14T12:00:00+07:00', details: { ...hotel.details, nights: 4 } };
  assert.equal(stayInfo(three, { date: '2027-01-11', timeZone: TZ }).when, '住到 1月14日 周四');
  assert.equal(stayInfo(null, { date: '2027-01-11', timeZone: TZ }), null);
});

test('日出日落：days.extra.sun 优先，没有用天气预报的；离日落几分钟；天气提示一句话', () => {
  const d1 = rows('days').find((d) => d.date === '2027-01-10');
  const s = sunInfo(d1, { sunrise: '06:00', sunset: '18:00' });
  assert.deepEqual([s.sunrise, s.sunset, s.golden, s.blue], ['06:12', '17:41', '17:08', '17:58']);
  const fromWeather = sunInfo({ extra: {} }, { sunrise: '06:00', sunset: '18:00' });
  assert.deepEqual([fromWeather.sunrise, fromWeather.sunset, fromWeather.golden], ['06:00', '18:00', null]);
  assert.deepEqual(sunInfo(null, null), { sunrise: null, sunset: null, golden: null, blue: null });
  assert.equal(minutesUntil('17:41', 16 * 60), 101);
  assert.equal(sunsetLeft('17:41', 18 * 60), -19);
  assert.equal(sunsetLeft(null, 600), null);
  assert.match(weatherNote(d1), /^旱季/);
  assert.equal(weatherNote({ extra: { weather_0110: '  有风 ' } }), '有风');
  assert.equal(weatherNote({ extra: {} }), null);
});

test('天气一行：温度区间、降雨概率（≥50% 要带伞）、图标；没有数据返回 null', () => {
  const w = weatherLine({ text: '多云', icon: 'cloud-sun', tempMax: 31.4, tempMin: 24.6, precipProbability: 60, sunrise: '06:05', sunset: '17:52' });
  assert.deepEqual([w.text, w.icon, w.temp, w.rain, w.rainText, w.umbrella, w.sunset], ['多云', 'cloud-sun', '25–31°', 60, '降雨 60%', true, '17:52']);
  assert.equal(weatherLine({ text: '晴', tempMax: 30 }).temp, '30°');
  assert.equal(weatherLine({ text: '晴' }).temp, null);
  assert.equal(weatherLine({ text: '晴', precipProbability: 10 }).umbrella, false);
  assert.equal(weatherLine(null), null);
});

// ---------------------------------------------------------------------
// 每天概要、打包、免费取消、明天
// ---------------------------------------------------------------------

test('每天概要卡：徽章、短日期、标题、节奏 · 几条安排、路线一句话、住哪 / 回程，今天标出来，颜色四种轮流', () => {
  const b = bundle('demo-island');
  const days = selectors.sortedDays(b.days);
  const plans = new Map([...selectors.itemsByDay(b.items)].filter(([k]) => k !== null).map(([k, list]) => [k, selectors.dayPlan(list)]));
  const bookings = rows('bookings');
  const back = returnFlight(bookings, island);
  const getPlace = (id) => b.places.get(id) || null;
  const m1 = dayCardModel(days[0], plans.get(days[0].id), { index: 0, getPlace, stay: selectors.stayForDay(b, days[0]), today: '2027-01-10', timeZone: TZ });
  assert.deepEqual([m1.badge, m1.shortDate, m1.title, m1.isToday, m1.colorIndex], ['D1', '10 周日', '落地 · 椰影镇', true, 1]);
  assert.match(m1.sub, /^节奏轻松 · \d+ 条安排$/);
  assert.ok(m1.route && m1.route.includes('→'));
  assert.deepEqual(m1.stay, { glyph: 'bed', text: '椰影湾酒店' });
  const last = dayCardModel(days[3], plans.get(days[3].id), { index: 3, getPlace, stay: null, isLast: true, returnFlight: back, timeZone: TZ });
  assert.deepEqual([last.badge, last.colorIndex, last.stay], ['D4', 4, { glyph: 'plane', text: '回程 DM802' }]);
  assert.deepEqual(dayCardModel({ id: 'x', date: '2027-04-03', title: '' }, null, { index: 4, isLast: true, timeZone: 'Asia/Taipei' }).title, '第 5 天');
  assert.equal(dayCardModel({ id: 'x', date: '2027-04-03', title: '' }, null, { index: 4, timeZone: 'Asia/Taipei' }).sub, '还没安排');
  assert.deepEqual(dayCardModel({ id: 'x', date: '2027-04-03' }, null, { index: 1, isLast: true }).stay, { glyph: 'plane', text: '回家' });
  assert.deepEqual([dayColorIndex(0), dayColorIndex(3), dayColorIndex(4), dayColorIndex(6), dayColorIndex(7), dayColorIndex(-1)], [1, 4, 5, 7, 1, 1]);
  assert.deepEqual([dayCountWord(4), dayCountWord(2), dayCountWord(12), dayCountWord(0)], ['四天', '两天', '12 天', '每天']);
  assert.deepEqual([paceLabel('packed'), paceLabel(null)], ['紧凑', null]);
  assert.equal(stayShortName({ title: '椰影湾酒店 · 园景房' }, null), '椰影湾酒店');
  assert.equal(stayShortName({ title: 'x' }, { name: '地点名' }), '地点名');
});

test('路线一句话：跳过交通和入住退房、相邻重复合并、最多 3 个', () => {
  const places = new Map([['a', { name: '粉店' }], ['b', { name: '望海岭' }], ['c', { name: '夜市' }], ['d', { name: '酒吧' }]]);
  const items = [
    { kind: 'transport', place_id: 'a', title: '接机' },
    { kind: 'food', place_id: 'a' }, { kind: 'cafe', place_id: 'a' },
    { kind: 'hotel', place_id: 'b', title: '入住' },
    { kind: 'sunset', place_id: 'b' }, { kind: 'night_market', title: '逛夜市', place_id: 'c' }, { kind: 'free', place_id: 'd' },
  ];
  assert.equal(dayRouteLine(items, (id) => places.get(id)), '粉店 → 望海岭 → 夜市');
  assert.equal(dayRouteLine(items, (id) => places.get(id), { max: 4 }), '粉店 → 望海岭 → 夜市 → 酒吧');
  assert.equal(dayRouteLine([{ kind: 'free', title: '自由活动' }], () => null), '自由活动');
  assert.equal(dayRouteLine([], () => null), '');
});

test('打包进度：总数、已打包、按谁的东西分（共用在最前）', () => {
  const s = packingSummary(byId('todos'), { nameOf: (id) => (id === JEREMY ? 'Jeremy' : id === CATHY ? 'Cathy' : '?') });
  assert.equal(s.total, 26);
  assert.equal(s.done, 3);
  assert.equal(s.left, 23);
  assert.ok(s.ratio > 0.1 && s.ratio < 0.2);
  assert.equal(s.owners[0].key, 'shared');
  assert.ok(s.owners.some((o) => o.name === 'Jeremy') && s.owners.some((o) => o.name === 'Cathy'));
  assert.equal(s.owners.reduce((n, o) => n + o.total, 0), 26);
  assert.deepEqual(packingSummary([]), { total: 0, done: 0, left: 0, ratio: 0, owners: [] });
});

test('免费取消截止：只留预订的；不到 1 天的算急', () => {
  const b = bundle('demo-island');
  const all = selectors.upcomingDeadlines(b, BEFORE);
  const fc = freeCancelDeadlines(all, { at: BEFORE });
  assert.ok(fc.list.length > 0);
  assert.ok(fc.list.every((d) => d.type === 'free-cancel'));
  assert.equal(fc.urgent, true, '演示岛 01-08 23:59 截止的那一个不到 1 天');
  const far = freeCancelDeadlines([{ type: 'free-cancel', id: 'x', ms: BEFORE.getTime() + 3 * 86_400_000 }], { at: BEFORE });
  assert.equal(far.urgent, false);
  assert.deepEqual(freeCancelDeadlines([{ type: 'todo', id: 'y', ms: BEFORE.getTime() }], { at: BEFORE }).list, []);
});

test('明天、回程日', () => {
  const days = rows('days').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(tomorrowOf(days, '2027-01-11').date, '2027-01-12');
  assert.equal(tomorrowOf(days, '2027-01-13'), null);
  assert.equal(tomorrowOf(days, null), null);
  const back = returnFlight(rows('bookings'), island);
  assert.equal(isReturnDay(days[3], island, back), true);
  assert.equal(isReturnDay(days[2], island, back), false);
  assert.equal(isReturnDay(days[2], { timezone: TZ }, { ...back, start_at: '2027-01-12T20:00:00+07:00' }), true);
  assert.equal(isReturnDay(null, island, back), false);
});

test('条目种类 → 记一笔的分类（预填）', () => {
  assert.equal(expenseCategoryOf('food'), '餐饮');
  assert.equal(expenseCategoryOf('spa'), '活动');
  assert.equal(expenseCategoryOf('hotel'), '住宿');
  assert.equal(expenseCategoryOf('other'), null);
  assert.equal(itemTimeText({ start_time: '09:30:00', end_time: '11:00:00' }), '09:30–11:00');
  assert.equal(itemTimeText({ time_label: '傍晚' }), '傍晚');
  assert.equal(itemTimeText({}), '');
});

// ---------------------------------------------------------------------
// 回顾
// ---------------------------------------------------------------------

test('回顾的数字：三城行程的天数、完成数、去过的地方、记账、日记、照片', () => {
  const b = bundle('demo-cities');
  const s = recapStats({
    days: selectors.sortedDays(b.days), items: b.items, expenses: selectors.liveExpenses(b.expenses),
    journal: [...b.journal_entries.values()], reviews: [...b.reviews.values()],
  });
  assert.equal(s.days, 9);
  assert.ok(s.done > 0);
  assert.ok(s.places > 0);
  assert.equal(s.placesPlanned, false);
  assert.equal(s.expenses, selectors.liveExpenses(b.expenses).length);
  assert.equal(s.journal, 6);
  assert.ok(s.photos >= 8);
  // 一条都没标完成：退回“安排了的地方”
  const planned = recapStats({ days: [], items: [{ id: 'a', day_id: 'd', variant: 'primary', status: 'planned', place_id: 'p' }] });
  assert.deepEqual([planned.places, planned.placesPlanned, planned.done], [1, true, 0]);
});

test('结算：按币种分别结、合在「谁给谁」一行里、折合港币；没有欠账返回空', () => {
  const b = bundle('demo-cities');
  const ledger = selectors.ledgerSummary(b);
  const lines = settlementLines(ledger);
  assert.ok(lines.length >= 1);
  for (const l of lines) {
    assert.ok(l.fromName && l.toName && l.fromName !== l.toName);
    assert.ok(l.parts.length >= 1 && l.parts.every((p) => p.amount > 0 && p.currency));
    assert.ok(Number.isInteger(l.hkd));
  }
  const total = ledger.currencies.flatMap((c) => c.transfers).filter((t) => t.amount > 0).length;
  assert.equal(lines.reduce((n, l) => n + l.parts.length, 0), total, '每笔转账都归到一行里');
  assert.deepEqual(settlementLines({ currencies: [], people: [] }), []);
  assert.deepEqual(settlementLines(null), []);
  const fake = settlementLines({ people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], currencies: [{ currency: 'VND', transfers: [{ from: 'a', to: 'b', amount: 330000 }] }, { currency: 'HKD', transfers: [{ from: 'a', to: 'b', amount: 10 }] }] });
  assert.equal(fake.length, 1);
  assert.deepEqual(fake[0].parts.map((p) => p.currency), ['VND', 'HKD']);
  assert.equal(fake[0].hkd, 110);
});

test('评级最高：两人平均 ≥ 4，高分在前，最多 4 个；评语摘录；每天一张照片；路线', () => {
  const b = bundle('demo-cities');
  const reviews = [...b.reviews.values()];
  const top = topRatedPlaces(reviews, (id) => b.places.get(id) || null);
  assert.ok(top.length >= 1 && top.length <= 4);
  assert.ok(top.every((t) => t.avg >= 4));
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].avg >= top[i].avg);
  assert.deepEqual(topRatedPlaces([], () => null), []);

  assert.equal(excerpt('短句'), '短句');
  const long = '今天去了很多地方，吃了很多东西，看了海，还在老街走了一圈，最后在夜市吃了烤扇贝，很满足，明天继续。';
  const e = excerpt(long, 30);
  assert.ok(e.length <= 31 && e.endsWith('…'));
  assert.ok(!/[，、；：]…$/.test(e), '截断处不留逗号');

  const days = selectors.sortedDays(b.days);
  const byDay = new Map(days.map((d) => [d.id, d]));
  const picks = journalExcerpts([...b.journal_entries.values()], byDay, { limit: 3 });
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map((p) => p.day.id)).size, 3, '尽量每天一篇');
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i - 1].day.date <= picks[i].day.date);
  assert.ok(picks.every((p) => p.text.length > 0));

  const photos = dayPhotos(days, selectors.journalByDay(b));
  assert.equal(photos.length, 9);
  assert.ok(photos.some((p) => p.photo) && photos.some((p) => !p.photo));
  const hit = photos.find((p) => p.photo);
  assert.ok(hit.photo.path && hit.photo.entryId && hit.count >= 1);

  assert.deepEqual(segmentRoute(selectors.sortedSegments(b.segments)), ['雾港', '茶山', '南湾']);
  assert.deepEqual(segmentRoute([{ name: 'A' }, { name: 'A' }, { name: '' }, { name: 'B' }]), ['A', 'B']);
});

// ---------------------------------------------------------------------
// 备选池
// ---------------------------------------------------------------------

test('备选池排进某天：放在那天最后（比最大的 sort_key 大一级），空的那天从 10 起', () => {
  assert.deepEqual(scheduleTarget('d1', [{ sort_key: 10 }, { sort_key: 130 }, { sort_key: 'x' }]), { day_id: 'd1', sort_key: 140 });
  assert.deepEqual(scheduleTarget('d2', []), { day_id: 'd2', sort_key: 10 });
  assert.deepEqual(scheduleTarget('d3', [{ sort_key: 15 }]), { day_id: 'd3', sort_key: 20 });
});

test('行程名「·」后面那段（回顾大卡第三行）：「富国岛 · 重阳 3 晚」→「重阳 3 晚」；没有分隔符就是空', async () => {
  const { tripTitleRest } = await import('../../src/pages/trip/model.js');
  assert.equal(tripTitleRest('椰影岛 · 冬日海岛'), '冬日海岛');
  assert.equal(tripTitleRest('三城｜春日环岛'), '春日环岛');
  assert.equal(tripTitleRest('山雾镇'), '');
  assert.equal(tripTitleRest(''), '');
  assert.equal(tripTitleRest(null), '');
});
