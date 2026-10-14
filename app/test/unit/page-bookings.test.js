// 预订页（pages/bookings）和预订详情弹层（sheets/booking）的纯逻辑：分组、筛选、汇总、免费取消倒计时、时间（各自时区、跨日）、
// 登机牌、入住退房、价格和付款、详情、关联、联系方式、附件和链接、一键改状态、编辑表单；页面自己的小函数（view.js）。
// 数据全部是这里现编的（不读真实行程，也不依赖演示数据的具体值）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_GROUPS, groupKeyOf, defaultGroupBy, FILTERS, isPayAtProperty, filterBookings, groupBookings, freeCancelState, bookingFreeCancel,
  freeCancelLine, sumByCurrency, formatSum, sumHkdNote, summarizeBookings, todaysBookings, todayNote, bookingWhen, whenLine, cardSubtitle,
  baggageText, flightView, hotelView, priceView, paymentView, expenseCategoryOf, detailRows, perksOf, briefLine, briefGlyph, bookingPlaceId,
  actionsSize, relatedOf, driverContactOf, phoneDigits, telLink, waHref, zaloHref, contactChannels, fileSizeText, attachmentsOf, linksOf,
  sheetSubtitle, titleText, quickActions, formOf, patchFromForm, formDirty, needsPayer, needsMethod, isPast, hasStarted, verifyNoteOf, isOpenItem,
  hotelStayDays, stayParts, stayNote, cardSubtitleParts, titleSegments,
} from '../../src/sheets/booking/model.js';
import { resolveGroupBy, resolveFilter, pageState, flatList, tileSub, countLine, groupByKey, shortTitle } from '../../src/pages/bookings/view.js';
import { parseAmount, formatMoney } from '../../src/lib/money.js';

const VN = 'Asia/Ho_Chi_Minh';
const HK = 'Asia/Hong_Kong';
const AT = new Date('2027-03-08T09:00:00+07:00');
const HOUR = 3_600_000;

let seq = 0;
/** 现编一个预订（只给要用到的字段） */
const bk = (o = {}) => ({
  id: o.id || `b${++seq}`,
  trip_id: 'test-trip',
  kind: 'activity',
  title: `测试预订 ${seq}`,
  status: 'booked',
  payment_status: 'unpaid',
  start_tz: VN,
  details: {},
  attachments: [],
  links: [],
  extra: {},
  sort: seq,
  ...o,
});

const trip = { id: 'test-trip', start_date: '2027-03-10', end_date: '2027-03-13', timezone: VN };

// ---------------------------------------------------------------------
// 分组、筛选
// ---------------------------------------------------------------------

test('分组：按类型的顺序是航班 / 酒店 / 活动体验 / 接送 / 餐厅 / 其他；门票并进活动、租车并进接送、保险进其他、不认识的进其他', () => {
  assert.deepEqual(KIND_GROUPS.map((g) => g.label), ['航班', '酒店', '活动体验', '接送', '餐厅', '其他']);
  assert.equal(groupKeyOf('ticket'), 'activity');
  assert.equal(groupKeyOf('car_rental'), 'transfer');
  assert.equal(groupKeyOf('insurance'), 'other');
  assert.equal(groupKeyOf('spaceship'), 'other');
  const list = [
    bk({ kind: 'restaurant', start_at: '2027-03-11T18:00:00+07:00' }),
    bk({ kind: 'car_rental', start_at: '2027-03-11T09:00:00+07:00' }),
    bk({ kind: 'flight', start_at: '2027-03-13T16:00:00+07:00' }),
    bk({ kind: 'flight', start_at: '2027-03-10T08:00:00+08:00', start_tz: HK }),
    bk({ kind: 'activity', status: 'cancelled', start_at: '2027-03-11T10:00:00+07:00' }),
    bk({ kind: 'hotel' }),
  ];
  const { groups, cancelled } = groupBookings(list, { by: 'kind', tripTz: VN, at: AT });
  assert.deepEqual(groups.map((g) => g.key), ['flight', 'hotel', 'transfer', 'restaurant']);
  assert.equal(groups.find((g) => g.key === 'transfer').label, '租车', '只有租车时组名叫租车');
  // 组内按时间：先起飞的在前
  assert.equal(groups[0].items[0].start_tz, HK);
  assert.equal(cancelled.length, 1, '已取消的单独放');
  const both = groupBookings([...list, bk({ kind: 'transfer', start_at: '2027-03-10T10:00:00+07:00' })], { by: 'kind', tripTz: VN, at: AT });
  assert.equal(both.groups.find((g) => g.key === 'transfer').label, '接送和租车');
});

test('分组：按日期按各自时区的当地日期，日期早的在前、时间未定的在最后；今天那组标出来、之前的标「过去」，组名带 D 几', () => {
  const at = new Date('2027-03-11T10:00:00+07:00');
  const list = [
    bk({ title: '没时间' }),
    bk({ title: '香港深夜', start_at: '2027-03-10T23:30:00+08:00', start_tz: HK }), // 香港 3/10，越南 3/10 22:30
    bk({ title: '越南凌晨', start_at: '2027-03-10T17:30:00Z', start_tz: VN }), // 越南 3/11 00:30
    bk({ title: '后天', start_at: '2027-03-13T08:00:00+07:00' }),
  ];
  const { groups } = groupBookings(list, { by: 'date', tripTz: VN, trip, at });
  assert.deepEqual(groups.map((g) => g.key), ['2027-03-10', '2027-03-11', '2027-03-13', 'undated']);
  assert.equal(groups[1].items[0].title, '越南凌晨');
  assert.equal(groups[1].today, true);
  assert.match(groups[1].sub, /^今天 · D2$/);
  assert.equal(groups[0].past, true);
  assert.equal(groups[2].past, false);
  assert.equal(groups[3].label, '时间未定');
  assert.match(groups[0].label, /3月10日 周三/);
});

test('筛选：还没订 / 待确认 / 到店付；到店付不算还没订和已取消的；不认识的键不筛', () => {
  const list = [
    bk({ status: 'idea', payment_status: 'pay_at_property' }),
    bk({ status: 'pending' }),
    bk({ status: 'booked', payment_status: 'pay_at_property' }),
    bk({ status: 'cancelled', payment_status: 'pay_at_property' }),
  ];
  assert.deepEqual(Object.keys(FILTERS), ['idea', 'pending', 'property']);
  assert.equal(filterBookings(list, 'idea').length, 1);
  assert.equal(filterBookings(list, 'pending').length, 1);
  assert.equal(filterBookings(list, 'property').length, 1);
  assert.equal(filterBookings(list, 'nope').length, 4);
  assert.equal(filterBookings(list, 'toString').length, 4, '原型上的名字不算筛选键');
  assert.equal(filterBookings(list, null).length, 4);
  assert.equal(isPayAtProperty(list[0]), false);
  // 给了 at：时间已经过去的「还没订 / 待确认」不算（和顶部汇总的数字一致）；没有时间的算；到店付不受影响
  const old = [
    bk({ status: 'idea', start_at: '2027-03-07T21:00:00+07:00', end_at: '2027-03-07T22:30:00+07:00' }),
    bk({ status: 'idea', start_at: '2027-03-09T12:00:00+07:00' }),
    bk({ status: 'idea' }),
    bk({ status: 'pending', start_at: '2027-03-08T08:00:00+07:00' }),
    bk({ status: 'booked', payment_status: 'pay_at_property', start_at: '2027-03-06T14:00:00+07:00', end_at: '2027-03-07T12:00:00+07:00' }),
  ];
  assert.deepEqual(filterBookings(old, 'idea', { at: AT }).map((b) => b.id), [old[1].id, old[2].id]);
  assert.equal(filterBookings(old, 'idea').length, 3, '不给 at 就不看时间');
  assert.equal(filterBookings(old, 'pending', { at: AT }).length, 0);
  assert.equal(filterBookings(old, 'property', { at: AT }).length, 1);
  assert.equal(defaultGroupBy('ongoing'), 'date');
  assert.equal(defaultGroupBy('upcoming'), 'kind');
  assert.equal(defaultGroupBy(undefined), 'kind');
});

// ---------------------------------------------------------------------
// 免费取消
// ---------------------------------------------------------------------

test('免费取消：>48 小时蓝色「…前可免费取消」、≤48 小时警示色、≤24 小时红色、过了「已不可免费取消」、预订开始了就不提醒', () => {
  const at = AT;
  const after = (h) => new Date(at.getTime() + h * HOUR).toISOString();
  const later = freeCancelState(after(72), { at, timeZone: VN });
  assert.equal(later.state, 'later');
  assert.equal(later.tone, 'info');
  assert.match(later.label, /前可免费取消$/);
  const soon = freeCancelState(after(48), { at, timeZone: VN });
  assert.equal(soon.state, 'soon', '正好 48 小时算快到了');
  assert.equal(soon.tone, 'warning');
  assert.equal(soon.label, '免费取消还剩 2 天');
  assert.equal(freeCancelState(after(30), { at, timeZone: VN }).label, '免费取消还剩 1 天 6 小时');
  const urgent = freeCancelState(after(5), { at, timeZone: VN });
  assert.equal(urgent.state, 'urgent');
  assert.equal(urgent.tone, 'danger');
  assert.equal(urgent.label, '免费取消还剩 5 小时');
  const passed = freeCancelState(after(-1), { at, timeZone: VN });
  assert.equal(passed.state, 'passed');
  assert.equal(passed.label, '已不可免费取消');
  assert.equal(freeCancelState(after(5), { at, timeZone: VN, start: after(-2) }), null, '已经开始了');
  assert.equal(freeCancelState(null, { at }), null);
  // 预订：已取消的、没写截止的不提醒；时区按预订自己的 start_tz
  assert.equal(bookingFreeCancel(bk({ status: 'cancelled', free_cancel_until: after(5) }), { at }), null);
  assert.equal(bookingFreeCancel(bk({}), { at }), null);
  const hk = bookingFreeCancel(bk({ start_tz: HK, free_cancel_until: '2027-03-20T15:59:00Z' }), { at, tripTz: VN });
  assert.match(hk.when, /3月20日 23:59/);
  const line = freeCancelLine(bk({ free_cancel_until: after(30) }), { at, tripTz: VN });
  assert.equal(line.state, 'soon');
  assert.match(line.detail, /^越南时间 · 还剩 1 天 6 小时$/);
  const gone = freeCancelLine(bk({ free_cancel_until: after(-30) }), { at, tripTz: VN });
  assert.equal(gone.title, '已不可免费取消');
  assert.match(gone.detail, /截止时间是 .*（越南时间）/);
});

// ---------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------

test('汇总：还没订 / 待确认 / 到店付的数量，到店付金额按币种 + 折合港币；最近的免费取消截止不算还没订的和已经过了的', () => {
  const after = (h) => new Date(AT.getTime() + h * HOUR).toISOString();
  const list = [
    bk({ status: 'idea', free_cancel_until: after(1) }),
    bk({ status: 'pending', free_cancel_until: after(20), price_amount: 680, price_currency: 'HKD', payment_status: 'partial', paid_amount: 200 }),
    bk({ status: 'booked', payment_status: 'pay_at_property', price_amount: 2400000, price_currency: 'VND', free_cancel_until: after(-2) }),
    bk({ status: 'booked', payment_status: 'pay_at_property', price_amount: 300, price_currency: 'HKD', free_cancel_until: after(60) }),
    bk({ status: 'cancelled', payment_status: 'refunded', price_amount: 360, price_currency: 'HKD' }),
  ];
  const s = summarizeBookings(list, { at: AT, tripTz: VN });
  assert.equal(s.total, 5);
  assert.equal(s.live, 4);
  assert.equal(s.cancelled, 1);
  assert.equal(s.idea.length, 1);
  assert.equal(s.pending.length, 1);
  assert.equal(s.property.length, 2);
  assert.deepEqual(s.propertySum.list, [{ currency: 'VND', amount: 2400000 }, { currency: 'HKD', amount: 300 }]);
  assert.equal(s.propertySum.mixed, true);
  assert.ok(s.propertySum.hkd > 300);
  assert.match(formatSum(s.propertySum), /^2,400,000₫ \+ HK\$300（合计约 HK\$[\d,]+）$/);
  assert.match(sumHkdNote(s.propertySum), /^合计约 HK\$/);
  assert.equal(s.nextDeadline.booking.id, list[1].id, '还没订的那个虽然更近，但不算');
  assert.equal(s.deadlines.length, 2);
  assert.deepEqual(s.dueSum.list.find((x) => x.currency === 'HKD'), { currency: 'HKD', amount: 780 });
  // 只有一种币种：formatSum 就是 formatMoney；没有：空串
  assert.equal(formatSum(sumByCurrency([{ currency: 'VND', amount: 150000 }])), formatMoney(150000, 'VND'));
  assert.equal(formatSum(sumByCurrency([])), '');
  assert.equal(sumHkdNote(sumByCurrency([{ currency: 'HKD', amount: 1 }])), null);
  // 行程里：昨天那个没订的、早上已经过去的待确认，不再算进要处理的数
  const trip2 = summarizeBookings([
    bk({ status: 'idea', start_at: '2027-03-07T21:00:00+07:00' }),
    bk({ status: 'idea', start_at: '2027-03-08T12:00:00+07:00' }),
    bk({ status: 'pending', start_at: '2027-03-08T07:00:00+07:00', end_at: '2027-03-08T08:00:00+07:00' }),
  ], { at: AT, tripTz: VN });
  assert.equal(trip2.idea.length, 1);
  assert.equal(trip2.pending.length, 0);
  assert.equal(trip2.live, 3, '卡片照样都在');
});

test('今天用得上：今天开始的、今晚住着的酒店（入住日到退房日）；今天的「还没订」也放进来（页面标出来），已取消的和还没订的酒店不放', () => {
  const today = '2027-03-11';
  const list = [
    bk({ kind: 'hotel', start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-12T12:00:00+07:00' }),
    bk({ kind: 'activity', start_at: '2027-03-11T08:30:00+07:00', end_at: '2027-03-11T12:30:00+07:00' }),
    bk({ kind: 'activity', start_at: '2027-03-12T08:30:00+07:00' }),
    bk({ kind: 'restaurant', status: 'idea', start_at: '2027-03-11T19:00:00+07:00' }),
    bk({ kind: 'activity', status: 'cancelled', start_at: '2027-03-11T15:00:00+07:00' }),
    bk({ kind: 'hotel', status: 'idea', start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-12T12:00:00+07:00' }),
  ];
  const got = todaysBookings(list, { today, tripTz: VN });
  assert.deepEqual(got.map((b) => b.id), [list[0].id, list[1].id, list[3].id]);
  const at = new Date('2027-03-11T07:00:00+07:00');
  assert.equal(todayNote(list[0], { today, tripTz: VN, at }), '今晚住这里');
  assert.equal(todayNote(list[0], { today: '2027-03-12', tripTz: VN, at }), '今天 12:00 前退房');
  assert.equal(todayNote(list[0], { today: '2027-03-10', tripTz: VN, at }), '今天 14:00 起入住');
  assert.equal(todayNote(list[1], { today, tripTz: VN, at }), '08:30–12:30');
  assert.deepEqual(todaysBookings(list, { today: null }), []);
});

// ---------------------------------------------------------------------
// 时间
// ---------------------------------------------------------------------

test('时间：按各自时区；今天 / 明天用叫法；跨午夜写「次日」；跨好几天写日期区间；时区和行程不同标出来；没有时间写「时间未定」', () => {
  const at = new Date('2027-03-10T09:00:00+07:00');
  assert.equal(whenLine(bk({ start_at: '2027-03-11T08:30:00+07:00', end_at: '2027-03-11T12:30:00+07:00' }), { tripTz: VN, at }), '明天 08:30–12:30');
  assert.equal(whenLine(bk({ start_at: '2027-03-12T21:00:00+07:00', end_at: '2027-03-13T01:00:00+07:00' }), { tripTz: VN, at }), '3月12日 周五 21:00 – 次日 01:00');
  assert.equal(whenLine(bk({ start_at: '2027-03-12T21:00:00+07:00' }), { tripTz: VN, at }), '3月12日 周五 21:00');
  assert.equal(
    whenLine(bk({ kind: 'flight', start_at: '2027-03-10T08:05:00+08:00', start_tz: HK, end_at: '2027-03-10T10:20:00+07:00', end_tz: VN }), { tripTz: VN, at }),
    '今天 08:05 香港时间 → 10:20 越南时间',
  );
  assert.equal(
    whenLine(bk({ kind: 'insurance', start_tz: HK, start_at: '2027-03-10T00:00:00+08:00', end_at: '2027-03-13T23:59:00+08:00', end_tz: HK }), { tripTz: VN, at }),
    '3月10日–13日 · 香港时间',
  );
  assert.equal(whenLine(bk({}), { tripTz: VN, at }), '时间未定');
  const w = bookingWhen(bk({ start_at: '2027-03-12T21:00:00+07:00', end_at: '2027-03-13T01:00:00+07:00' }), { tripTz: VN });
  assert.equal(w.shift, 1);
  assert.equal(w.shiftLabel, '次日');
  // 卡片副标题：航班只写日期（起降时间在登机牌里）、酒店写几晚、其他写时间；前面是平台
  assert.equal(cardSubtitle(bk({ kind: 'flight', provider: '某平台', start_at: '2027-03-11T08:05:00+07:00' }), { tripTz: VN, at }), '某平台 · 明天 · 3月11日 周四');
  assert.equal(cardSubtitle(bk({ kind: 'hotel', provider: '某平台', details: { nights: 2 } }), { tripTz: VN, at }), '某平台 · 2 晚');
  assert.equal(cardSubtitle(bk({ start_at: '2027-03-12T21:00:00+07:00' }), { tripTz: VN, at }), '3月12日 周五 21:00');
  assert.equal(isPast(bk({ start_at: '2027-03-09T21:00:00+07:00' }), at), true);
  assert.equal(isPast(bk({ start_at: '2027-03-09T21:00:00+07:00', end_at: '2027-03-11T21:00:00+07:00' }), at), false);
  assert.equal(hasStarted(bk({ start_at: '2027-03-09T21:00:00+07:00' }), at), true);
  assert.equal(isPast(bk({}), at), false);
});

// ---------------------------------------------------------------------
// 航班、酒店
// ---------------------------------------------------------------------

test('登机牌：三字码大写、起降时间各自时区、红眼航班落地 +1、时长、落地时差、行李一句话', () => {
  const b = bk({
    kind: 'flight',
    start_at: '2027-03-13T22:40:00+07:00', start_tz: VN,
    end_at: '2027-03-14T02:35:00+08:00', end_tz: HK,
    details: { flight_no: 'XX123', from_iata: 'abc', to_iata: 'DEF', to_terminal: 'T1', seats: ['1A', '', '1B'], passengers: 2, baggage: { carry_on_kg: 7, checked_kg: 20, checked_pieces: 1 } },
  });
  const f = flightView(b, { tripTz: VN, at: AT });
  assert.equal(f.from, 'ABC');
  assert.equal(f.dep.time, '22:40');
  assert.equal(f.arr.time, '02:35');
  assert.equal(f.arr.shift, 1);
  assert.equal(f.arr.shiftLabel, '+1');
  assert.equal(f.duration, '2 小时 55 分钟');
  assert.equal(f.tzNote, '落地按香港时间（比越南快 1 小时）');
  assert.equal(f.fromWhere, '越南时间');
  assert.equal(f.toWhere, '香港时间 · T1');
  assert.deepEqual(f.seats, ['1A', '1B']);
  assert.deepEqual(f.baggage, { carry: '手提 7kg', checked: '托运 20kg' });
  // 同一个时区的航班：不写时差、三字码下面只写航站楼
  const same = flightView(bk({ kind: 'flight', start_at: '2027-03-13T08:00:00+07:00', end_at: '2027-03-13T09:00:00+07:00', end_tz: VN, details: { from_terminal: 'T2' } }), { tripTz: VN, at: AT });
  assert.equal(same.tzNote, null);
  assert.equal(same.fromWhere, 'T2');
  assert.equal(same.toWhere, null);
  // 行李：加购、不含托运
  assert.deepEqual(baggageText({ checked_kg: 0, addons: [{ label: '托运 20kg × 1' }] }), { carry: null, checked: '加购托运 20kg × 1' });
  assert.deepEqual(baggageText({ checked_kg: 0 }), { carry: null, checked: '不含托运' });
  assert.deepEqual(baggageText(null), { carry: null, checked: null });
});

test('入住 / 退房：日期和时间按酒店时区、晚数没写按日期算、房型和标题重复时不再写、含早 / 不含早', () => {
  const b = bk({
    kind: 'hotel', title: '某酒店 · 海景房',
    start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-12T12:00:00+07:00', end_tz: VN,
    details: { room_type: '海景房', bed: '大床', breakfast: true, check_in_time: '14:00:00', check_out_time: '12:00' },
  });
  const h = hotelView(b, { tripTz: VN, at: new Date('2027-03-09T10:00:00+07:00') });
  assert.equal(h.nights, 2);
  assert.equal(h.checkIn.time, '14:00');
  assert.equal(h.checkIn.relative, '明天');
  assert.equal(h.checkOut.date, '2027-03-12');
  assert.equal(h.room, '大床 · 含早');
  assert.equal(h.earliest, '14:00');
  assert.equal(hotelView(bk({ kind: 'hotel', details: { nights: 3 } }), { tripTz: VN }).nights, 3);
});

// ---------------------------------------------------------------------
// 价格、付款
// ---------------------------------------------------------------------

test('价格：到店付 / 还没付和芯片重复（卡片上省掉）、订金写已付多少、还没订是「预计」、已取消划掉、免费、没价格不显示', () => {
  assert.deepEqual(priceView(bk({ price_amount: 100, price_currency: 'HKD', payment_status: 'pay_at_property' })), {
    amount: 100, currency: 'HKD', note: '到店付', redundant: true, tone: 'neutral', estimate: false,
  });
  assert.equal(priceView(bk({ price_amount: 680, price_currency: 'HKD', payment_status: 'partial', paid_amount: 200 })).note, '已付订金 HK$200');
  assert.equal(priceView(bk({ status: 'idea', price_amount: 5, price_currency: 'HKD' })).note, '预计');
  assert.equal(priceView(bk({ status: 'cancelled', price_amount: 5, price_currency: 'HKD', payment_status: 'refunded' })).note, '已退款');
  assert.equal(priceView(bk({ status: 'cancelled', price_amount: 5, price_currency: 'HKD', payment_status: 'paid' })).note, '没退款');
  assert.equal(priceView(bk({ payment_status: 'free' })).free, true);
  assert.equal(priceView(bk({ price_amount: 5 })), null, '没有币种');
  assert.equal(priceView(bk({})), null);
  assert.equal(priceView(bk({ price_amount: 5, price_currency: 'rmb', payment_status: 'paid' })).currency, 'CNY');
});

test('付款：订金 → 已付 / 还要付；到店付 → 到店付（不算还要付）；谁付的、付款方式、押金、行李加购', () => {
  const names = { u1: 'Jeremy', u2: 'Cathy' };
  const memberName = (id) => names[id];
  const p1 = paymentView(bk({ price_amount: 680, price_currency: 'HKD', payment_status: 'partial', paid_amount: 200, paid_by_user_id: 'u2', payment_method: '信用卡' }), { memberName });
  assert.deepEqual(p1.paid, { amount: 200, currency: 'HKD' });
  assert.deepEqual(p1.due, { amount: 480, currency: 'HKD' });
  assert.equal(p1.atProperty, null);
  assert.equal(p1.paidBy, 'Cathy');
  assert.equal(p1.method, '信用卡');
  const p2 = paymentView(bk({ kind: 'hotel', price_amount: 2400000, price_currency: 'VND', payment_status: 'pay_at_property', details: { deposit: { amount: 500000, currency: 'VND' } } }), { memberName });
  assert.equal(p2.due, null);
  assert.deepEqual(p2.atProperty, { amount: 2400000, currency: 'VND' });
  assert.deepEqual(p2.deposit, { amount: 500000, currency: 'VND' });
  const p3 = paymentView(bk({ kind: 'flight', payment_status: 'paid', details: { baggage: { addons: [{ label: '托运 20kg', price: { amount: 280, currency: 'CNY' }, paid_by_user_id: 'u1', paid_at: '2027-02-01' }] } } }), { memberName });
  assert.equal(p3.total, null, '没写价格');
  assert.equal(p3.addons[0].paidBy, 'Jeremy');
  assert.equal(p3.addons[0].amount, 280);
  assert.equal(paymentView(bk({ status: 'idea', price_amount: 9, price_currency: 'HKD' })).estimate, true);
  assert.equal(expenseCategoryOf('hotel'), '住宿');
  assert.equal(expenseCategoryOf('transfer'), '交通');
  assert.equal(expenseCategoryOf('restaurant'), '餐饮');
  assert.equal(expenseCategoryOf('ticket'), '门票');
  assert.equal(expenseCategoryOf('activity'), '活动');
  assert.equal(expenseCategoryOf('insurance'), '其他');
});

// ---------------------------------------------------------------------
// 详情、概要、关联
// ---------------------------------------------------------------------

test('详情：航班（舱位、座位、乘客、航站楼、行李、餐食）、酒店（房型、早餐、几点入住）、活动（集合、包含、凭证）、接送（路线）、附赠', () => {
  const place = (id) => ({ p1: { name: '甲地' }, p2: { name: '乙地' } })[id] || null;
  const flight = detailRows(bk({ kind: 'flight', start_at: '2027-03-13T08:00:00+07:00', end_at: '2027-03-13T09:30:00+07:00', end_tz: VN, details: { flight_no: 'XX1', airline: '某航空', cabin: '经济舱', seats: ['1A'], passengers: 2, from_terminal: 'T1', meal: false, baggage: { carry_on_kg: 7, checked_kg: 0, addons: [{ label: '托运 20kg' }] } } }), { tripTz: VN, at: AT });
  const byKey = Object.fromEntries(flight.map((r) => [r.key, r.value]));
  assert.equal(byKey.flight_no, 'XX1 · 某航空');
  assert.equal(byKey.seats, '1A');
  assert.equal(byKey.passengers, '2 人');
  assert.equal(byKey.terminal, '出发 T1');
  assert.equal(byKey.duration, '1 小时 30 分钟');
  assert.equal(byKey.carry, '每人 7kg');
  assert.equal(byKey.checked, '加购 托运 20kg');
  assert.equal(byKey.meal, '不含餐');
  const hotel = Object.fromEntries(detailRows(bk({ kind: 'hotel', details: { room_type: '海景房', rooms: 1, guests: 2, breakfast: true, check_in_time: '14:00' } }), { tripTz: VN }).map((r) => [r.key, r.value]));
  assert.equal(hotel.rooms, '1 间 · 2 人');
  assert.equal(hotel.breakfast, '含早餐');
  assert.equal(hotel.check_in_time, '14:00 起可入住');
  const act = detailRows(bk({ kind: 'activity', details: { meeting_place_id: 'p1', meeting_time: '08:15', includes: ['接送', ''], voucher: 'qr', pax: 2 } }), { place });
  assert.deepEqual(act.find((r) => r.key === 'meeting'), { key: 'meeting', label: '集合', value: '甲地 · 08:15 集合', placeId: 'p1' });
  assert.equal(act.find((r) => r.key === 'includes').value, '接送');
  assert.equal(act.find((r) => r.key === 'voucher').value, '出示二维码');
  const tr = detailRows(bk({ kind: 'transfer', details: { from_place_id: 'p1', to_place_id: 'p2', vehicle: '5 座车' } }), { place });
  assert.equal(tr[0].value, '甲地 → 乙地');
  assert.deepEqual(detailRows(bk({ kind: 'other' })), []);
  assert.deepEqual(perksOf(bk({ extra: { perks: [' 欢迎饮品 ', '', 3] } })), ['欢迎饮品']);
  // 概要和图形
  assert.equal(briefLine(bk({ kind: 'activity', details: { meeting_time: '08:15', meeting_point: '门口', pax: 2 } })), '08:15 集合 · 门口 · 2 人');
  assert.equal(briefGlyph(bk({ kind: 'activity', details: { pax: 2 } })), 'user');
  assert.equal(briefGlyph(bk({ kind: 'activity', details: { meeting_time: '08:15' } })), 'clock');
  assert.equal(briefLine(bk({ kind: 'transfer', details: { to_place_id: 'p2', vehicle: '7 座车' } }), { place }), '？ → 乙地 · 7 座车');
  assert.equal(briefLine(bk({ kind: 'flight' })), null);
  // 地点和动作行
  assert.equal(bookingPlaceId(bk({ kind: 'activity', details: { meeting_place_id: 'p1' } })), 'p1');
  assert.equal(bookingPlaceId(bk({ kind: 'car_rental', details: { pickup_place_id: 'p2' } })), 'p2');
  assert.equal(actionsSize(bk({ kind: 'hotel' })), 'full');
  assert.equal(actionsSize(bk({ kind: 'restaurant' })), 'full', '餐厅、活动也是带文字的完整版');
  assert.equal(actionsSize(bk({ kind: 'transfer' })), null);
  assert.equal(actionsSize(bk({ kind: 'flight' })), null);
  assert.equal(actionsSize(bk({ kind: 'hotel', status: 'cancelled' })), null);
  assert.equal(actionsSize(bk({ kind: 'hotel', start_at: '2027-03-01T10:00:00+07:00' }), { at: AT }), null, '已经过去了');
  assert.equal(sheetSubtitle(bk({ kind: 'hotel', provider: '某平台' })), '酒店 · 某平台');
  assert.equal(sheetSubtitle(bk({ kind: 'flight' })), '机票');
  assert.equal(titleText('某度假村 · 豪华房 · 含早'), '某度假村\u00a0· 豪华房\u00a0· 含早', '间隔号不会折到行首');
  assert.equal(titleText(null), '');
});

test('关联：联系人按 司机 → 挂在这个预订上的 → 同一个地点、没挂在别的预订上的 排、不重复；待办没勾的在前；条目按日期时间；账目去掉软删除', () => {
  const b = bk({ id: 'B', place_id: 'P', details: { driver_contact_id: 'c-driver' } });
  const contacts = new Map([
    ['c-place', { id: 'c-place', place_id: 'P', sort: 1 }],
    ['c-other', { id: 'c-other', place_id: 'P', booking_id: 'X', sort: 2 }],
    ['c-book', { id: 'c-book', booking_id: 'B', sort: 3 }],
    ['c-driver', { id: 'c-driver', booking_id: 'B', sort: 4 }],
  ]);
  const todos = [
    { id: 't1', booking_id: 'B', list: 'todo', done: true, sort: 1 },
    { id: 't2', booking_id: 'B', list: 'todo', done: false, sort: 2 },
    { id: 't3', booking_id: 'B', list: 'confirm', done: false, sort: 3 },
    { id: 't4', booking_id: 'X', list: 'confirm', done: false, sort: 4 },
  ];
  const days = [{ id: 'd1', date: '2027-03-11' }, { id: 'd2', date: '2027-03-10' }];
  const items = [
    { id: 'i1', booking_id: 'B', day_id: 'd1', start_time: '08:00:00' },
    { id: 'i2', booking_id: 'B', day_id: 'd2', start_time: '20:00:00' },
    { id: 'i3', booking_id: 'B', day_id: 'd2', deleted_at: '2027-01-01T00:00:00Z' },
    { id: 'i4', booking_id: 'B', day_id: null },
  ];
  const expenses = [{ id: 'e1', booking_id: 'B' }, { id: 'e2', booking_id: 'B', deleted_at: '2027-01-01T00:00:00Z' }];
  const r = relatedOf({ contacts, todos, items, days, expenses }, b);
  assert.deepEqual(r.contacts.map((c) => c.id), ['c-driver', 'c-book', 'c-place']);
  assert.deepEqual(r.todos.map((t) => t.id), ['t3', 't2', 't1']);
  assert.deepEqual(r.items.map((x) => x.item.id), ['i2', 'i1', 'i4']);
  assert.deepEqual(r.expenses.map((e) => e.id), ['e1']);
  assert.equal(driverContactOf({ contacts }, b).id, 'c-driver');
  assert.equal(driverContactOf({ contacts }, bk({})), null);
  assert.deepEqual(relatedOf({}, null), { contacts: [], todos: [], items: [], expenses: [] });
});

// ---------------------------------------------------------------------
// 联系方式、附件、链接
// ---------------------------------------------------------------------

test('联系方式：tel: 只留数字和 +；WhatsApp 用 https://wa.me/<数字>；Zalo 把 +84 换成 0；邮箱 / 微信 / LINE 只能复制', () => {
  assert.equal(phoneDigits('+99 (12) 345-678'), '9912345678');
  assert.equal(phoneDigits('0099 1234 5678'), '9912345678', '00 开头的国际冠码去掉');
  assert.equal(telLink('+99 1234 5678'), 'tel:+9912345678');
  assert.equal(telLink(' 1234 5678 '), 'tel:12345678');
  assert.equal(telLink('12'), null);
  assert.equal(waHref('+99 1234 5678'), 'https://wa.me/9912345678');
  assert.equal(waHref('123'), null);
  assert.equal(zaloHref('+84 90 000 0000'), 'https://zalo.me/0900000000');
  assert.equal(zaloHref(''), null);
  const ch = contactChannels({ name: '前台', phone: '+00 000 0000 0001', whatsapp: '+00 000 0000 0002', email: 'desk@example.com', wechat: 'demo_id' });
  assert.deepEqual(ch.actions.map((a) => a.key), ['call', 'whatsapp']);
  assert.ok(ch.actions[1].href.startsWith('https://wa.me/'));
  assert.deepEqual(ch.copies.map((c) => c.key), ['email', 'wechat']);
  assert.deepEqual(contactChannels({ name: '空' }), { actions: [], copies: [] });
});

test('附件和链接：确认单认得 PDF / 图片、显示大小；没有路径的跳过；链接只要 http(s)（javascript: 之类不要）', () => {
  assert.equal(fileSizeText(18432), '18 KB');
  assert.equal(fileSizeText(2 * 1024 * 1024), '2.0 MB');
  assert.equal(fileSizeText(0), null);
  const files = attachmentsOf(bk({ attachments: [
    { path: 't/u/bookings/a.pdf', name: '确认单.pdf', mime: 'application/pdf', size: 18432 },
    { path: 't/u/bookings/b.jpg', name: '截图' , mime: 'image/jpeg' },
    { name: '没有路径' },
  ] }));
  assert.deepEqual(files.map((f) => [f.kind, f.meta]), [['pdf', 'PDF · 18 KB'], ['image', '图片']]);
  const links = linksOf(bk({ links: [
    { label: '管理订单', url: 'https://www.example.com/manage', kind: 'booking' },
    { label: '坏的', url: 'javascript:alert(1)' },
    { label: '地图', url: 'https://example.com/map', kind: 'maps' },
  ] }));
  assert.deepEqual(links.map((l) => [l.label, l.host, l.glyph]), [['管理订单', 'example.com', 'external'], ['地图', 'example.com', 'map']]);
});

// ---------------------------------------------------------------------
// 一键改状态、编辑
// ---------------------------------------------------------------------

test('一键改状态：待确认 →「商家确认了」、还没订 →「已经订好了」、已订没付 →「已付清」（订金是「尾款付清了」、到店付是「到店付好了」），撤销写回原值', () => {
  assert.deepEqual(quickActions(bk({ status: 'pending' })).map((q) => q.key), ['confirm']);
  assert.deepEqual(quickActions(bk({ status: 'idea' })).map((q) => q.key), ['booked']);
  const paid = quickActions(bk({ status: 'booked', payment_status: 'partial', paid_amount: 200, price_amount: 680, price_currency: 'HKD' }));
  assert.equal(paid[0].label, '尾款付清了');
  assert.deepEqual(paid[0].patch, { payment_status: 'paid', paid_amount: null });
  assert.deepEqual(paid[0].revert, { payment_status: 'partial', paid_amount: 200 });
  assert.equal(quickActions(bk({ status: 'booked', payment_status: 'pay_at_property', price_amount: 1, price_currency: 'HKD' }))[0].label, '到店付好了');
  assert.deepEqual(quickActions(bk({ status: 'booked', payment_status: 'unpaid' })), [], '没价格不提「已付清」');
  assert.deepEqual(quickActions(bk({ status: 'cancelled' })), []);
  assert.deepEqual(quickActions(bk({ status: 'booked', payment_status: 'paid', price_amount: 1, price_currency: 'HKD' })), []);
  // 没记谁付的：记成点按钮的人；撤销时清掉。已经记了谁付的不动
  const mine = quickActions(bk({ status: 'booked', payment_status: 'pay_at_property', price_amount: 1, price_currency: 'HKD' }), { me: 'u-me' })[0];
  assert.deepEqual(mine.patch, { payment_status: 'paid', paid_amount: null, paid_by_user_id: 'u-me' });
  assert.deepEqual(mine.revert, { payment_status: 'pay_at_property', paid_amount: null, paid_by_user_id: null });
  const theirs = quickActions(bk({ status: 'booked', payment_status: 'unpaid', price_amount: 1, price_currency: 'HKD', paid_by_user_id: 'u-other' }), { me: 'u-me' })[0];
  assert.deepEqual(theirs.patch, { payment_status: 'paid', paid_amount: null });
});

test('编辑表单：只提交改了的字段；订金要填金额且不超过总价；不是订金清掉已付金额；不用记谁付的就清掉；订单号去空白；备注保留换行', () => {
  const b = bk({ status: 'pending', payment_status: 'unpaid', price_amount: 680, price_currency: 'HKD', confirmation_code: 'DEMO-1', notes: '第一行\n第二行', paid_by_user_id: null });
  const base = formOf(b);
  assert.equal(formDirty(b, base), false);
  assert.deepEqual(patchFromForm(b, base, { parseAmount }), { patch: {}, errors: {}, changed: false });
  // 订金没填 / 太多 / 正常
  let r = patchFromForm(b, { ...base, payment_status: 'partial', paid_amount: '' }, { parseAmount });
  assert.equal(r.errors.paid_amount, '填一下已经付了多少');
  assert.equal(r.patch.paid_amount, undefined);
  r = patchFromForm(b, { ...base, payment_status: 'partial', paid_amount: '900' }, { parseAmount });
  assert.equal(r.errors.paid_amount, '订金比总价还多');
  r = patchFromForm(b, { ...base, payment_status: 'partial', paid_amount: 'HK$200', paid_by_user_id: 'u2', payment_method: ' 信用卡 ' }, { parseAmount });
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.patch, { payment_status: 'partial', paid_amount: 200, paid_by_user_id: 'u2', payment_method: '信用卡' });
  // 没写币种记不了订金
  const noCur = bk({ price_amount: null, price_currency: null });
  assert.match(patchFromForm(noCur, { ...formOf(noCur), payment_status: 'partial', paid_amount: '5' }, { parseAmount }).errors.paid_amount, /币种/);
  // 改回未付：已付金额清掉、谁付的清掉
  const p = bk({ status: 'booked', payment_status: 'partial', paid_amount: 200, price_amount: 680, price_currency: 'HKD', paid_by_user_id: 'u2' });
  r = patchFromForm(p, { ...formOf(p), payment_status: 'unpaid' }, { parseAmount });
  assert.deepEqual(r.patch, { payment_status: 'unpaid', paid_amount: null, paid_by_user_id: null });
  // 状态、订单号、备注
  r = patchFromForm(b, { ...base, status: 'booked', confirmation_code: '  DEMO-2 ', notes: '第一行\n第二行\n\n' }, { parseAmount });
  assert.deepEqual(r.patch, { status: 'booked', confirmation_code: 'DEMO-2' });
  r = patchFromForm(b, { ...base, confirmation_code: '   ', notes: '' }, { parseAmount });
  assert.deepEqual(r.patch, { confirmation_code: null, notes: null });
  assert.equal(formDirty(b, { ...base, notes: 'x' }), true);
  assert.equal(needsPayer('paid'), true);
  assert.equal(needsPayer('pay_at_property'), false);
  assert.equal(needsMethod('pay_at_property'), true);
  assert.equal(needsMethod('free'), false);
});

// ---------------------------------------------------------------------
// 页面自己的小函数
// ---------------------------------------------------------------------

test('预订页：分组方式（网址 > 本机记住的 > 进行中按日期 / 其他按类型）、筛选键、加载状态、段标题和卡片拍平、格子小字、数量', () => {
  assert.equal(resolveGroupBy('date', 'kind', 'upcoming'), 'date');
  assert.equal(resolveGroupBy('bogus', 'date', 'upcoming'), 'date');
  assert.equal(resolveGroupBy(null, null, 'ongoing'), 'date');
  assert.equal(resolveGroupBy(undefined, 'x', 'ended'), 'kind');
  assert.equal(resolveGroupBy('constructor', 'valueOf', 'upcoming'), 'kind');
  assert.equal(groupByKey('t1'), 'bookings-by:t1');
  assert.equal(resolveFilter('pending'), 'pending');
  assert.equal(resolveFilter('toString'), null);
  assert.equal(resolveFilter(undefined), null);
  const sig = (v) => ({ value: v });
  assert.equal(pageState(null), 'loading');
  assert.equal(pageState({ status: sig('loading'), trip: sig(null) }), 'loading');
  assert.equal(pageState({ status: sig('loading'), trip: sig({ id: 't' }) }), 'ready', '有缓存先显示');
  assert.equal(pageState({ status: sig('error'), trip: sig(null) }), 'error');
  assert.equal(pageState({ status: sig('error'), trip: sig({ id: 't' }) }), 'ready', '刷新失败但有缓存');
  assert.equal(pageState({ status: sig('missing'), trip: sig(null) }), 'missing');
  assert.equal(pageState({ status: sig('removed'), trip: sig({ id: 't' }) }), 'missing');
  const rows = flatList([{ key: 'flight', items: [{ id: 'a' }, { id: 'b' }] }, { key: 'hotel', items: [{ id: 'c' }] }]);
  assert.deepEqual(rows.map((r) => r.key), ['h:flight', 'a', 'b', 'h:hotel', 'c']);
  assert.equal(tileSub([{ title: '甲' }]), '甲');
  assert.equal(tileSub([{ title: '甲' }, { title: '乙' }, { title: '丙' }]), '甲 等 3 个');
  assert.equal(tileSub([{ title: '某屋顶 · 很长很长的套餐名（两人一套）' }]), '某屋顶 · 很长很长的套餐名（两人一套）', '一个时写全名');
  assert.equal(tileSub([{ title: '某屋顶 · 很长很长的套餐名（两人一套）' }, { title: '乙' }]), '某屋顶 等 2 个', '多个时用短名，「等 N 个」不被挤掉');
  assert.equal(shortTitle('甲店 · 乙套餐 · 丙'), '甲店');
  assert.equal(shortTitle('没有间隔号'), '没有间隔号');
  assert.equal(tileSub([]), null);
  assert.equal(countLine({ total: 3, live: 2, cancelled: 1 }), '2 个预订 · 1 个已取消');
  assert.equal(countLine({ total: 2, live: 2, cancelled: 0 }), '2 个预订');
  assert.equal(countLine({ total: 0 }), '还没有预订');
});

test('资料待核：extra.待核 / extra.to_verify 是一句话就显示（去掉首尾空白），别的类型、空串都不显示；还要处理的「还没订 / 待确认」不算时间已过的', () => {
  assert.equal(verifyNoteOf(bk({ extra: { 待核: '  价格资料里没有 ' } })), '价格资料里没有');
  assert.equal(verifyNoteOf(bk({ extra: { to_verify: '订单号没有' } })), '订单号没有');
  assert.equal(verifyNoteOf(bk({ extra: { 待核: '' } })), null);
  assert.equal(verifyNoteOf(bk({ extra: { 待核: ['x'] } })), null);
  assert.equal(verifyNoteOf(bk({})), null);
  assert.equal(isOpenItem(bk({ status: 'idea', start_at: '2027-03-07T10:00:00+07:00' }), 'idea', AT), false);
  assert.equal(isOpenItem(bk({ status: 'idea', start_at: '2027-03-09T10:00:00+07:00' }), 'idea', AT), true);
  assert.equal(isOpenItem(bk({ status: 'idea' }), 'idea', AT), true, '没有时间的算');
  assert.equal(isOpenItem(bk({ status: 'pending' }), 'idea', AT), false);
});

test('登机牌的日期不带年份（窄栏里「周六」不被挤断）；卡片副标题照样带年份', () => {
  const b = bk({ kind: 'flight', start_at: '2026-03-14T09:10:00+08:00', end_at: '2026-03-14T11:00:00+08:00', start_tz: HK, end_tz: 'Asia/Taipei', details: { from_iata: 'hkg', to_iata: 'tpe' } });
  const f = flightView(b, { tripTz: 'Asia/Taipei', at: AT });
  assert.doesNotMatch(f.dep.dateText, /年/);
  assert.match(f.dep.dateText, /^3月14日 周六$/);
  assert.match(cardSubtitle(b, { tripTz: 'Asia/Taipei', at: AT }), /2026年3月14日/);
});

test('按日期分组：酒店在退房那天有「退房 12:00 前」一行、中间几天「续住 · 第 2 晚（共 3 晚）」；按时间和卡片排在一起；还没订、已取消的酒店不算；只有酒店那一行的日子也成一组', () => {
  const at = new Date('2027-03-11T10:00:00+07:00');
  const hotel = bk({ id: 'h1', kind: 'hotel', title: '某酒店 · 园景房', start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-13T12:00:00+07:00', end_tz: VN });
  const idea = bk({ id: 'h2', kind: 'hotel', status: 'idea', start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-12T12:00:00+07:00' });
  const gone = bk({ id: 'h3', kind: 'hotel', status: 'cancelled', start_at: '2027-03-10T14:00:00+07:00', end_at: '2027-03-12T12:00:00+07:00' });
  const morning = bk({ id: 'a1', start_at: '2027-03-13T09:30:00+07:00' });
  const lunch = bk({ id: 'a2', kind: 'restaurant', start_at: '2027-03-13T12:30:00+07:00' });
  const days = hotelStayDays([hotel, idea, gone], { tripTz: VN });
  assert.deepEqual([...days.keys()], ['2027-03-11', '2027-03-12', '2027-03-13']);
  assert.deepEqual(days.get('2027-03-11').map((x) => [x.role, x.night, x.nights]), [['night', 2, 3]]);
  assert.deepEqual(days.get('2027-03-13').map((x) => [x.role, x.time]), [['out', '12:00']]);
  const { groups } = groupBookings([hotel, idea, gone, morning, lunch], { by: 'date', tripTz: VN, trip, at });
  assert.deepEqual(groups.map((g) => g.key), ['2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13']);
  const g11 = groups[1];
  assert.equal(g11.today, true);
  assert.equal(g11.items.length, 0, '只有续住那一行的日子也成一组（今天那组一定在）');
  const g13 = groups[3];
  assert.deepEqual(g13.entries.map((e) => (e.type === 'card' ? e.booking.id : `${e.stay.role}:${e.stay.booking.id}`)), ['a1', 'out:h1', 'a2'], '退房按退房时间插在卡片中间');
  const rows = flatList(groups);
  assert.ok(rows.some((r) => r.key === 'stay:h1:2027-03-13' && r.type === 'stay'));
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'key 不重复（FLIP 用）');
  // 说法
  const out = days.get('2027-03-13')[0];
  assert.deepEqual(stayParts(out, { at }), { tag: '退房', detail: '12:00 前', label: '12:00 前退房', done: false });
  assert.equal(stayParts(out, { at: new Date('2027-03-13T12:30:00+07:00') }).label, '已退房');
  assert.equal(stayNote(days.get('2027-03-12')[0], { at }), '续住 · 第 3 晚（共 3 晚）');
  // 按类型分组不受影响
  const byKind = groupBookings([hotel, morning], { by: 'kind', tripTz: VN, trip, at });
  assert.equal(byKind.groups[0].entries, undefined);
});

test('卡片副标题分两段（平台、时间）；标题按「 · 」分段（间隔号跟着前一段）；房型里已经写了的床型、景观不再重复', () => {
  const at = new Date('2027-03-10T09:00:00+07:00');
  const b = bk({ provider: '某平台', start_at: '2027-03-11T12:00:00+07:00', end_at: '2027-03-11T13:15:00+07:00' });
  assert.deepEqual(cardSubtitleParts(b, { tripTz: VN, at }), { provider: '某平台', when: '明天 12:00–13:15' });
  assert.equal(cardSubtitle(b, { tripTz: VN, at }), '某平台 · 明天 12:00–13:15');
  assert.deepEqual(cardSubtitleParts(bk({ kind: 'hotel' }), { tripTz: VN, at }), { provider: null, when: '日期未定' });
  assert.deepEqual(titleSegments('Coral 某酒店 · 豪华大床房带阳台'), ['Coral 某酒店\u00a0·', '豪华大床房带阳台']);
  assert.deepEqual(titleSegments('没有间隔号'), ['没有间隔号']);
  assert.deepEqual(titleSegments(null), []);
  const h = hotelView(bk({ kind: 'hotel', title: '某酒店 · 景观房', details: { room_type: '景观房（花园景，53㎡，1 特大床）', bed: '特大床', view: '花园景', breakfast: true } }), { tripTz: VN, at });
  assert.equal(h.room, '景观房（花园景，53㎡，1 特大床） · 含早');
  const h2 = hotelView(bk({ kind: 'hotel', title: '某酒店', details: { room_type: '标准房', bed: '大床', view: '海景' } }), { tripTz: VN, at });
  assert.equal(h2.room, '标准房 · 大床 · 海景');
});
