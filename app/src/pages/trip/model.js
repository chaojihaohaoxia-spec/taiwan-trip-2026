// =====================================================================
// pages/trip/model.js：行程概览页的纯逻辑（不碰 DOM、不读信号，Node 里能直接测：test/unit/page-overview.test.js）。
//
// 页面组件只负责“从 store 读出来 → 交给这里算 → 画出来”。这里的函数输入都是普通的行（数组 / Map）和时刻，
// 输出是界面直接能用的结构（中文说法已经拼好）。时间一律按各自的时区：航班按 start_tz / end_tz，
// 条目、待办按行程（或那一天所在分段）的时区；倒计时是两个确定时刻相减，跨时区天然正确。
//
//   航班       liveFlights / outboundFlight / returnFlight / flightView / flightStatus / tzShiftText
//   倒计时     departureTarget / countdownParts
//   待办       pendingTodos / dueInfo / todayTodos
//   卡片顺序   upcomingOrder / ongoingOrder（“这一刻最需要什么”排在前面）
//   进行中     nowModel / timelineWindow / spendSummary / stayInfo / sunInfo / weatherNote / minutesUntil
//   每天概要   dayRouteLine / paceLabel / stayShortName / dayCountWord / dayColorIndex
//   回顾       recapStats / settlementLines / topRatedPlaces / journalExcerpts / dayPhotos / segmentRoute
//   备选池     scheduleTarget
//   其他       tomorrowOf / dayCardModel / packingSummary / freeCancelDeadlines / weatherLine / sunsetLeft / isReturnDay
// =====================================================================

import {
  zonedParts, instantTimeParts, formatDuration, timeZoneLabel, tzOffsetMinutes, formatInstant, formatDate, parseDate,
  zonedToInstant, addDays, parseTime, isValidDate, weekdayName,
} from '../../lib/datetime.js';
import { normalizeCurrency, roundMoney, approxHKD } from '../../lib/money.js';
import { formatLeft } from '../../kit/status.js';
import { dayToneIndex } from '../../kit/day-tone.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ms = (ts) => {
  const v = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  return Number.isFinite(v) ? v : NaN;
};
const toList = (m) => (!m ? [] : Array.isArray(m) ? m : [...m.values()]);
const live = (row) => Boolean(row) && !row.deleted_at;

/** 一个时刻在某时区的当地日期 'YYYY-MM-DD'（时刻无效返回 null） */
export function localDateOf(ts, timeZone) {
  if (!Number.isFinite(ms(ts))) return null;
  return zonedParts(ts, timeZone).date;
}

// ---------------------------------------------------------------------
// 航班
// ---------------------------------------------------------------------

/** 没取消、有起飞时刻的航班，按起飞先后 */
export function liveFlights(bookings) {
  return toList(bookings)
    .filter((b) => b && b.kind === 'flight' && b.status !== 'cancelled' && Number.isFinite(ms(b.start_at)))
    .sort((a, b) => ms(a.start_at) - ms(b.start_at));
}

/**
 * 去程航班：出发当天（或前一天的红眼航班）起飞的第一班——按起飞地时区的日期 ≤ 行程第一天。
 * 行程中途的内陆航班不算去程（没有就返回 null，倒计时改成数到出发那天零点）。
 */
export function outboundFlight(bookings, trip) {
  if (!trip?.start_date) return null;
  const tz = trip.timezone;
  return liveFlights(bookings).find((f) => {
    const d = localDateOf(f.start_at, f.start_tz || tz);
    return d && d <= trip.start_date;
  }) || null;
}

/** 回程航班：最后一天（或之后）起飞的最后一班 */
export function returnFlight(bookings, trip) {
  if (!trip?.end_date) return null;
  const tz = trip.timezone;
  const list = liveFlights(bookings);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const d = localDateOf(list[i].start_at, list[i].start_tz || tz);
    if (d && d >= trip.end_date) return list[i];
  }
  return null;
}

/** 航班的票务状态（登机牌右上角的小芯片）：比通用的「已订」说得更具体 */
export function flightStatus(f) {
  switch (f?.status) {
    case 'booked':
      return { label: '机票已出票', tone: 'success', glyph: 'check' };
    case 'pending':
      return { label: '等出票', tone: 'warning', glyph: 'clock' };
    case 'idea':
      return { label: '机票还没订', tone: 'warning', glyph: 'pen' };
    case 'cancelled':
      return { label: '航班已取消', tone: 'neutral', glyph: 'x' };
    default:
      return { label: '机票', tone: 'neutral', glyph: 'plane' };
  }
}

/** 分钟数说成「1 小时」「1 小时 30 分」「45 分钟」 */
function hm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} 小时 ${m} 分`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}

/**
 * 时差提示（落地以后看哪边的钟）：
 *   diff −60、到达越南 → '落地按越南时间（慢 1 小时）'
 *   diff 0              → '两地没有时差'
 * @param {number} diffMinutes 到达地偏移 − 出发地偏移（分钟）
 * @param {string} arrivalTz
 */
export function tzShiftText(diffMinutes, arrivalTz) {
  if (!Number.isFinite(diffMinutes)) return null;
  if (diffMinutes === 0) return '两地没有时差';
  return `落地按${timeZoneLabel(arrivalTz)}时间（${diffMinutes < 0 ? '慢' : '快'} ${hm(Math.abs(diffMinutes))}）`;
}

/**
 * 航班显示用的全部字段（登机牌）。起飞时间按出发地时区、落地时间按到达地时区；落地跨日标「次日」。
 * @param {object} f bookings 行（kind = flight）
 * @param {{ fallbackTz?: string }} [o] 预订没写 start_tz 时用的时区（行程时区）
 */
export function flightView(f, { fallbackTz } = {}) {
  if (!f || !Number.isFinite(ms(f.start_at))) return null;
  const d = f.details || {};
  const depTz = f.start_tz || fallbackTz || 'Asia/Hong_Kong';
  const arrTz = f.end_tz || depTz;
  const dep = zonedParts(f.start_at, depTz);
  const hasArr = Number.isFinite(ms(f.end_at));
  const arr = hasArr ? instantTimeParts(f.end_at, arrTz, dep.date) : null;
  const minutes = hasArr ? Math.round((ms(f.end_at) - ms(f.start_at)) / MINUTE) : null;
  const diff = hasArr ? tzOffsetMinutes(arrTz, new Date(ms(f.end_at))) - tzOffsetMinutes(depTz, new Date(ms(f.start_at))) : null;
  const baggage = d.baggage || {};
  return {
    id: f.id,
    flightNo: d.flight_no || null,
    airline: d.airline || null,
    from: d.from_iata || null,
    to: d.to_iata || null,
    fromTerminal: d.from_terminal || null,
    toTerminal: d.to_terminal || null,
    depTime: dep.time,
    depDate: dep.date,
    depZone: timeZoneLabel(depTz),
    arrTime: arr?.time || null,
    arrDate: arr?.date || null,
    arrShift: arr?.shiftLabel || '',
    durationMinutes: minutes !== null && minutes > 0 ? minutes : null,
    duration: minutes !== null && minutes > 0 ? formatDuration(minutes, { style: 'short' }) : null,
    tzNote: diff === null ? null : tzShiftText(diff, arrTz),
    arrZone: timeZoneLabel(arrTz),
    seats: Array.isArray(d.seats) ? d.seats.filter(Boolean) : [],
    passengers: Number.isInteger(d.passengers) ? d.passengers : null,
    checkedKg: Number(baggage.checked_kg) > 0 ? Number(baggage.checked_kg) : null,
    carryKg: Number(baggage.carry_on_kg) > 0 ? Number(baggage.carry_on_kg) : null,
    status: flightStatus(f),
  };
}

// ---------------------------------------------------------------------
// 倒计时
// ---------------------------------------------------------------------

/**
 * 倒计时数到哪个时刻：有去程航班就是起飞那一刻（确定的时刻，人在香港、行程在越南也对），
 * 否则是出发那天在行程时区的零点。
 * @returns {{ at: number, kind: 'flight'|'trip' } | null}
 */
export function departureTarget(trip, flight) {
  if (flight && Number.isFinite(ms(flight.start_at))) return { at: ms(flight.start_at), kind: 'flight' };
  if (!trip?.start_date) return null;
  const d = zonedToInstant(trip.start_date, '00:00', trip.timezone || 'Asia/Hong_Kong');
  return d ? { at: d.getTime(), kind: 'trip' } : null;
}

/**
 * 倒计时的大数字 + 单位 + 后面的小字（样稿：「5 天」+「6 小时 45 分」）：
 *   ≥ 1 天      { big: 5, unit: '天', hours: 6, minutes: 45 }
 *   1–24 小时   { big: 17, unit: '小时', hours: null, minutes: 45 }
 *   < 1 小时    { big: 35, unit: '分钟' }
 * 不到 1 分钟按 1 分钟算；到点了返回 null。label 是读屏读的整句。
 * @param {number} msLeft
 */
export function countdownParts(msLeft) {
  if (!(msLeft > 0)) return null;
  const days = Math.floor(msLeft / DAY);
  const hours = Math.floor((msLeft % DAY) / HOUR);
  const minutes = Math.floor((msLeft % HOUR) / MINUTE);
  if (days >= 1) {
    const rest = hours || minutes ? ` ${hours} 小时 ${minutes} 分` : '';
    return { big: days, unit: '天', hours, minutes, label: `${days} 天${rest}` };
  }
  if (hours >= 1) return { big: hours, unit: '小时', hours: null, minutes, label: `${hours} 小时 ${minutes} 分` };
  const m = Math.max(1, minutes);
  return { big: m, unit: '分钟', hours: null, minutes: null, label: `${m} 分钟` };
}

// ---------------------------------------------------------------------
// 待办
// ---------------------------------------------------------------------

const LIST_ORDER = { confirm: 0, todo: 1, buy: 2, packing: 3 };

/**
 * 还没做的待办，最急的在前：过期的 → 有截止时间的（越早越前）→ 没有截止时间的（待确认在待办前面，再按清单里的顺序）。
 * @param {Map|object[]} todos
 * @param {{ lists?: string[] }} [o]
 */
export function pendingTodos(todos, { lists = ['confirm', 'todo'] } = {}) {
  return toList(todos)
    .filter((t) => t && !t.done && lists.includes(t.list))
    .sort((a, b) => {
      const da = Number.isFinite(ms(a.due_at)) ? ms(a.due_at) : Infinity;
      const db = Number.isFinite(ms(b.due_at)) ? ms(b.due_at) : Infinity;
      if (da !== db) return da - db;
      return (LIST_ORDER[a.list] ?? 9) - (LIST_ORDER[b.list] ?? 9)
        || (a.sort ?? 0) - (b.sort ?? 0)
        || String(a.created_at || '').localeCompare(String(b.created_at || ''))
        || String(a.id).localeCompare(String(b.id));
    });
}

/**
 * 截止时间的说法和语气（待办行下面那行小字）：
 *   已过        { state: 'overdue', tone: 'danger',  text: '1月8日 23:59 截止 · 已过期' }
 *   不到 1 天   { state: 'urgent',  tone: 'danger',  text: '今天 18:00 前 · 还剩 5 小时' }
 *   1–3 天      { state: 'soon',    tone: 'warning', text: '明天 20:00 前 · 还剩 1 天 6 小时' }
 *   更远        { state: 'later',   tone: 'neutral', text: '1月9日 08:05 前' }
 * @param {string} dueAt
 * @param {{ at: Date, timeZone: string }} o
 */
export function dueInfo(dueAt, { at, timeZone, displayZone, hereZone }) {
  const due = ms(dueAt);
  if (!Number.isFinite(due)) return null;
  const left = due - at.getTime();
  // 钟点按“那一刻人在哪个时区”写（displayZone = store.presenceZone(due)：出发前人在香港 → 香港钟点），
  // 和行程时区不同、或者和人此刻所在的时区（hereZone）不同时注明「（香港时间）」（10-14 现场走查 P1-1）
  const zone = displayZone || timeZone;
  const when = formatInstant(dueAt, { timeZone: zone, relative: true, year: 'never', at });
  const tag = displayZone && (displayZone !== timeZone || (hereZone && hereZone !== displayZone)) ? `（${timeZoneLabel(displayZone)}时间）` : '';
  if (left <= 0) return { state: 'overdue', tone: 'danger', text: `${when} 截止${tag} · 已过期`, msLeft: left };
  if (left < DAY) return { state: 'urgent', tone: 'danger', text: `${when} 前${tag} · 还剩 ${formatLeft(left)}`, msLeft: left };
  if (left < 3 * DAY) return { state: 'soon', tone: 'warning', text: `${when} 前${tag} · 还剩 ${formatLeft(left)}`, msLeft: left };
  return { state: 'later', tone: 'neutral', text: `${when} 前${tag}`, msLeft: left };
}

/**
 * 今天的待办（进行中）：挂在今天的、今天到期的在前（最急的在前），然后才是更早就过期还没做的（出发前拖下来的），去重。
 * @param {Map|object[]} todos
 * @param {{ dayId: string|null, date: string, timeZone: string }} o
 */
export function todayTodos(todos, { dayId, date, timeZone }) {
  const g = todayTodoGroups(todos, { dayId, date, timeZone });
  return [...g.today, ...g.stale];
}

/**
 * 同上，分成两组（概览「今天的待办」分两段显示，10-14 现场走查 P2-15）：
 *   today：挂在今天的、今天到期的（最急的在前）；stale：更早就过期还没做的（出发前拖下来的）。
 */
export function todayTodoGroups(todos, { dayId, date, timeZone }) {
  const list = toList(todos).filter((t) => t && !t.done && t.list !== 'packing');
  const dueDate = (t) => (Number.isFinite(ms(t.due_at)) ? localDateOf(t.due_at, timeZone) : null);
  const today = list.filter((t) => (dayId && t.day_id === dayId) || dueDate(t) === date);
  const stale = list.filter((t) => !today.includes(t) && dueDate(t) !== null && dueDate(t) < date);
  const opts = { lists: ['confirm', 'todo', 'buy'] };
  return { today: pendingTodos(today, opts), stale: pendingTodos(stale, opts) };
}

// ---------------------------------------------------------------------
// 卡片顺序：这一刻最需要什么排在前面
// ---------------------------------------------------------------------

/**
 * 出发前的卡片顺序。
 *   - 不到 1 天就截止的免费取消：紧跟倒计时（错过就要付钱）；否则在待办后面；
 *   - 3 天内出发、还有没打包的：打包提到天气前面；
 *   - 7 天内出发（天气预报有参考价值）：天气在每天安排前面；更远的放到后面（只有一句“出发前一周可看”）。
 * @param {{ daysUntil: number|null, urgentDeadline?: boolean, packingLeft?: number }} s
 * @returns {string[]} 'hero' | 'deadlines' | 'todos' | 'packing' | 'weather' | 'days' | 'pool'
 */
export function upcomingOrder({ daysUntil, urgentDeadline = false, packingLeft = 0 }) {
  const order = ['hero'];
  if (urgentDeadline) order.push('deadlines');
  order.push('todos');
  if (!urgentDeadline) order.push('deadlines');
  const packingSoon = daysUntil !== null && daysUntil !== undefined && daysUntil <= 3 && packingLeft > 0;
  const weatherSoon = daysUntil !== null && daysUntil !== undefined && daysUntil <= 7;
  if (packingSoon) order.push('packing');
  if (weatherSoon) order.push('weather');
  order.push('days');
  if (!weatherSoon) order.push('weather');
  if (!packingSoon) order.push('packing');
  order.push('pool');
  return order;
}

/**
 * 进行中的卡片顺序。
 *   - 最上面永远是「现在 / 接下来」；出发当天（去程还没落地）紧跟去程航班；最后一天紧跟回程航班；
 *   - 傍晚以后（18:00）或今天的安排都做完了：今晚住哪提到第二（回酒店是最常用的打车场景）；
 *   - 3 小时内到期的待办提前；
 *   - 离日落不到 2.5 小时：天气和日落提前（要赶日落）；
 * @param {{ minutes: number, hasUpcoming: boolean, isLastDay?: boolean, todoSoon?: boolean, sunsetSoon?: boolean, outbound?: boolean }} s
 * @returns {string[]} 'now' | 'outflight' | 'flight' | 'stay' | 'todos' | 'weather' | 'timeline' | 'spend' | 'deadlines' | 'tomorrow' | 'pool'
 */
export function ongoingOrder({ minutes, hasUpcoming, isLastDay = false, todoSoon = false, sunsetSoon = false, outbound = false }) {
  const order = ['now'];
  if (outbound) order.push('outflight');
  if (isLastDay) order.push('flight');
  const evening = minutes >= 18 * 60 || !hasUpcoming;
  const stayFirst = evening && !isLastDay;
  if (stayFirst) order.push('stay');
  if (todoSoon) order.push('todos');
  if (sunsetSoon) order.push('weather');
  order.push('timeline', 'spend');
  if (!sunsetSoon) order.push('weather');
  if (!stayFirst) order.push('stay');
  if (!todoSoon) order.push('todos');
  order.push('deadlines', 'tomorrow', 'pool');
  return order;
}

// ---------------------------------------------------------------------
// 进行中：现在 / 接下来、时间轴缩略、今天花了多少、今晚住哪、日出日落
// ---------------------------------------------------------------------

/**
 * 「现在 / 接下来」大卡的状态：
 *   current  有正在进行的（focus = 它，next = 下一项）
 *   next     现在空着，等下一项（focus = 下一项）
 *   loose    有计划中、但没写钟点的条目（focus = 第一条）
 *   done     今天的安排都做完 / 跳过了
 *   free     今天没有安排
 *   none     不在行程里
 * @param {{ day: object|null, current: object|null, next: object|null, minutesUntilNext: number|null }} today store.view.today
 * @param {object[]} primary 今天的主方案（已排序）
 */
export function nowModel(today, primary = []) {
  if (!today?.day) return { mode: 'none' };
  const { current, next, minutesUntilNext } = today;
  if (current) return { mode: 'current', focus: current, next: next || null, minutesUntilNext };
  if (next) return { mode: 'next', focus: next, next: null, minutesUntilNext };
  const loose = primary.find((i) => i.status === 'planned' && !i.start_time);
  if (loose) return { mode: 'loose', focus: loose, next: null, minutesUntilNext: null };
  if (primary.length) return { mode: 'done', focus: null, next: null, minutesUntilNext: null };
  return { mode: 'free', focus: null, next: null, minutesUntilNext: null };
}

/**
 * 时间轴缩略：围着“现在”的那几条（前面留一条已经过去的，后面接着几条）。
 * @param {object[]} primary 今天的主方案（已排序）
 * @param {{ anchorId?: string|null, size?: number }} [o]
 * @returns {{ items: object[], hiddenBefore: number, hiddenAfter: number, anchorIndex: number }}
 */
export function timelineWindow(primary, { anchorId = null, size = 5 } = {}) {
  const n = primary.length;
  if (n <= size) return { items: primary.slice(), hiddenBefore: 0, hiddenAfter: 0, anchorIndex: anchorId ? primary.findIndex((i) => i.id === anchorId) : -1 };
  let anchor = anchorId ? primary.findIndex((i) => i.id === anchorId) : -1;
  if (anchor < 0) anchor = primary.findIndex((i) => i.status === 'planned');
  if (anchor < 0) anchor = n - 1;
  let start = Math.max(0, anchor - 1);
  if (start + size > n) start = n - size;
  return { items: primary.slice(start, start + size), hiddenBefore: start, hiddenAfter: n - (start + size), anchorIndex: anchor - start };
}

/**
 * 某一天花了多少：按币种分别合计（不换汇）+ 折合港币（每笔记账时的汇率优先，没有用参考汇率）。
 * @param {object[]} expenses 未删除的记账（store.view.expenses，新 → 旧）
 * @param {{ date: string, homeOf?: (e: object) => number|null }} o homeOf：一笔折合港币多少（页面传 selectors.expenseHomeAmount）
 * @returns {{ count, byCurrency: Array<{ currency, total, count }>, hkd: number, complete: boolean, latest: object|null }}
 */
export function spendSummary(expenses, { date, homeOf }) {
  const list = toList(expenses).filter((e) => live(e) && e.date === date);
  const by = new Map();
  let hkd = 0;
  let complete = true;
  for (const e of list) {
    const cur = normalizeCurrency(e.currency_iso || e.currency) || 'HKD';
    const row = by.get(cur) || { currency: cur, total: 0, count: 0, home: 0, homeComplete: true };
    row.total += Number(e.amount) || 0;
    row.count += 1;
    by.set(cur, row);
    const h = homeOf ? homeOf(e) : approxHKD(Number(e.amount), cur);
    if (h === null || h === undefined || !Number.isFinite(h)) {
      complete = false;
      row.homeComplete = false;
    } else {
      hkd += h;
      row.home += h;
    }
  }
  // 每个币种的折合（home）：和上面的合计同一套数（记账时记下的汇率），卡片上「约 HK$…」不再另按参考汇率估
  const byCurrency = [...by.values()]
    .map(({ homeComplete, ...r }) => ({ ...r, total: roundMoney(r.total, r.currency), home: homeComplete ? r.home : null }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
  return { count: list.length, byCurrency, hkd: Math.round(hkd), complete, latest: list[0] || null };
}

/**
 * 今晚住哪的说法：入住那天「今天 14:00 起可入住」、退房前一晚「明天 12:00 前退房」、中间「住到 1月12日 周二 · 第 1 晚 / 共 2 晚」。
 * @param {object} booking 酒店预订
 * @param {{ date: string, timeZone: string }} o 今天（行程时区）
 */
export function stayInfo(booking, { date, timeZone }) {
  if (!booking) return null;
  const tzIn = booking.start_tz || timeZone;
  const tzOut = booking.end_tz || timeZone;
  const inDate = localDateOf(booking.start_at, tzIn);
  const outDate = localDateOf(booking.end_at, tzOut);
  const d = booking.details || {};
  const ci = d.check_in_time || (inDate ? zonedParts(booking.start_at, tzIn).time : null);
  const co = d.check_out_time || (outDate ? zonedParts(booking.end_at, tzOut).time : null);
  const nights = Number.isInteger(d.nights) && d.nights > 0 ? d.nights : inDate && outDate ? Math.max(1, Math.round((Date.parse(outDate) - Date.parse(inDate)) / DAY)) : null;
  const night = inDate ? Math.round((Date.parse(date) - Date.parse(inDate)) / DAY) + 1 : null;
  const nightText = nights && night && night >= 1 && night <= nights ? `第 ${night} 晚 / 共 ${nights} 晚` : null;
  let when = null;
  if (inDate === date && ci) when = `今天 ${ci} 起可入住`;
  else if (outDate === addDays(date, 1) && co) when = `明天 ${co} 前退房`;
  else if (outDate) when = `住到 ${formatDate(outDate, { year: 'never' })}`;
  return { when, nightText, checkIn: ci, checkOut: co, inDate, outDate, checkinToday: inDate === date };
}

/** 'HH:MM' → 当天第几分钟（无效 null） */
export const clockMinutes = (t) => parseTime(t);

/** 条目种类 → 记一笔的分类（预填；sheets/args.js 的 categoryToCode 认得这些中文），不认识返回 null */
const EXPENSE_CATEGORY_OF_KIND = Object.freeze({
  food: '餐饮', cafe: '餐饮', night_market: '餐饮',
  flight: '交通', transport: '交通',
  hotel: '住宿',
  shopping: '购物',
  sight: '门票',
  activity: '活动', spa: '活动', beach: '活动', sunset: '活动', walk_route: '活动', free: '活动',
});
export function expenseCategoryOf(kind) {
  return EXPENSE_CATEGORY_OF_KIND[kind] || null;
}

/** 离某个钟点还有几分钟（已经过了是负数；无效 null） */
export function minutesUntil(time, nowMinutes) {
  const t = parseTime(time);
  if (t === null || !Number.isFinite(nowMinutes)) return null;
  return Math.round(t - nowMinutes);
}

/**
 * 日出、日落、黄金时刻、蓝调：days.extra.sun（行程 JSON 里手写的）优先，没有用天气预报的日出日落。
 * @returns {{ sunrise: string|null, sunset: string|null, golden: string|null, blue: string|null }}
 */
export function sunInfo(day, weather) {
  const s = day?.extra?.sun && typeof day.extra.sun === 'object' ? day.extra.sun : {};
  // 单个钟点「17:41」或区间「17:59–18:07」（行程 JSON 里蓝调、黄金时刻常写成区间，10-14 现场走查 P2-3）
  const pick = (v) => {
    if (typeof v !== 'string') return null;
    const m = /^\s*(\d{1,2}:\d{2})(?::\d{2})?\s*(?:[–—~-]|到|至)\s*(\d{1,2}:\d{2})(?::\d{2})?\s*$/.exec(v);
    if (m && parseTime(m[1]) !== null && parseTime(m[2]) !== null) return `${m[1].padStart(5, '0')}–${m[2].padStart(5, '0')}`;
    return parseTime(v) !== null ? v.trim().slice(0, 5).padStart(5, '0') : null;
  };
  return {
    sunrise: pick(s.sunrise) || pick(weather?.sunrise),
    sunset: pick(s.sunset) || pick(weather?.sunset),
    golden: pick(s.golden_hour),
    blue: pick(s.blue_hour),
  };
}

/**
 * 当天的天气提示（行程 JSON 手写的一句话）：extra.weather_note，没有就取第一个以 weather 开头、值是文字的键
 * （有的行程按日期写成 weather_xxxx）。
 */
export function weatherNote(day) {
  const ex = day?.extra && typeof day.extra === 'object' ? day.extra : {};
  if (typeof ex.weather_note === 'string' && ex.weather_note.trim()) return ex.weather_note.trim();
  for (const [k, v] of Object.entries(ex)) {
    if (/^weather/i.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

// ---------------------------------------------------------------------
// 每天概要
// ---------------------------------------------------------------------

const PACE = Object.freeze({ relaxed: '轻松', medium: '适中', packed: '紧凑' });

/** 节奏：relaxed / medium / packed → 轻松 / 适中 / 紧凑（没写 null） */
export function paceLabel(pace) {
  return PACE[pace] || null;
}

/**
 * 一天的路线一句话（样稿「9G501 → Phở Hòa → Anh Anh Spa」）：主方案里的地点名（没有地点用条目标题），
 * 跳过纯交通和入住退房，相邻重复的合并，最多 max 个。
 * @param {object[]} primary
 * @param {(id: string) => object|null} getPlace
 */
export function dayRouteLine(primary = [], getPlace = () => null, { max = 3 } = {}) {
  const names = [];
  for (const it of primary) {
    if (it.kind === 'transport' || it.kind === 'hotel') continue;
    const place = it.place_id ? getPlace(it.place_id) : null;
    const name = String(place?.name || it.title || '').trim();
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (names.length >= max) break;
  }
  return names.join(' → ');
}

/** 酒店的短名字：地点名优先，否则预订标题「·」前面那段 */
export function stayShortName(booking, place) {
  if (place?.name) return place.name;
  return String(booking?.title || '').split(/\s*[·・]\s*/)[0].trim() || null;
}

const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 段标题里的天数：4 → '四天'、2 → '两天'、12 → '12 天' */
export function dayCountWord(n) {
  if (!Number.isInteger(n) || n < 1) return '每天';
  return n <= 10 ? `${CN_NUM[n]}天` : `${n} 天`;
}

/** 第 i 天（从 0 起）的徽章配色序号（四种轮流：青、蓝、红、紫，和样稿 D1–D4 一致） */
export function dayColorIndex(i) {
  // 第 i 天（从 0 起）→ 1–7：和地图同一套颜色（kit/day-tone.js，视觉评审 P1-2）
  return dayToneIndex((Math.max(0, Number(i) || 0)) + 1);
}

// ---------------------------------------------------------------------
// 回顾
// ---------------------------------------------------------------------

/**
 * 回顾的几个数字：几天、做完几件事、去了几个地方、记了几笔、几篇日记、几张照片。
 * 地方：做完的条目的地点（去重）；一条都没标完成时退回“安排过的地方”（planned = true，文字说「安排了」）。
 */
export function recapStats({ days = [], items = [], expenses = [], journal = [], reviews = [] }) {
  const scheduled = toList(items).filter((i) => live(i) && i.day_id && i.variant === 'primary');
  const done = scheduled.filter((i) => i.status === 'done');
  const placesOf = (list) => new Set(list.map((i) => i.place_id).filter(Boolean)).size;
  const visited = placesOf(done);
  const planned = !done.length;
  const photos = toList(journal).reduce((s, j) => s + (Array.isArray(j.photos) ? j.photos.length : 0), 0)
    + toList(reviews).reduce((s, r) => s + (Array.isArray(r.photos) ? r.photos.length : 0), 0);
  return {
    days: toList(days).length,
    done: done.length,
    places: planned ? placesOf(scheduled) : visited,
    placesPlanned: planned,
    expenses: toList(expenses).filter(live).length,
    journal: toList(journal).filter((j) => String(j.body || '').trim() || (j.photos || []).length).length,
    photos,
  };
}

/**
 * 结算：把各币种的转账按「谁给谁」合在一起（不换汇）——「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」。
 * 用数据层扣掉「已结清」记录以后的 ledger.settlement.outstanding（和账本页一致）；旧数据没有 settlement 时退回 currencies 的原始转账。
 * @param {{ currencies: Array<{ currency, transfers: Array<{ from, to, amount }> }>, settlement?: { outstanding: Array }, people: Array<{ id, name }> }} ledger store.view.ledger
 * @returns {Array<{ from, to, fromName, toName, parts: Array<{ amount, currency }>, hkd: number|null }>}
 */
export function settlementLines(ledger) {
  if (!ledger) return [];
  const names = new Map((ledger.people || []).map((p) => [p.id, p.name]));
  const pairs = new Map();
  for (const c of ledger.settlement ? ledger.settlement.outstanding : ledger.currencies || []) {
    for (const t of c.transfers || []) {
      if (!(Number(t.amount) > 0)) continue;
      const k = `${t.from}>${t.to}`;
      if (!pairs.has(k)) pairs.set(k, { from: t.from, to: t.to, fromName: names.get(t.from) || '成员', toName: names.get(t.to) || '成员', parts: [], hkd: 0 });
      const p = pairs.get(k);
      p.parts.push({ amount: Number(t.amount), currency: c.currency });
      const h = c.currency === 'HKD' ? Number(t.amount) : approxHKD(Number(t.amount), c.currency);
      p.hkd = p.hkd === null || h === null ? null : p.hkd + h;
    }
  }
  return [...pairs.values()].map((p) => ({ ...p, hkd: p.hkd === null ? null : Math.round(p.hkd) }));
}

/**
 * 评级最高的地方：两个人的平均分 ≥ 4（夯 / 顶级），平均分高的在前，同分评的人多的在前。
 * @param {object[]} reviews
 * @param {(id: string) => object|null} getPlace
 * @returns {Array<{ place, avg, count, reviews: object[] }>}
 */
export function topRatedPlaces(reviews, getPlace, { limit = 4, min = 4 } = {}) {
  const byPlace = new Map();
  for (const r of toList(reviews)) {
    if (!r?.place_id || !Number.isInteger(r.rating)) continue;
    if (!byPlace.has(r.place_id)) byPlace.set(r.place_id, []);
    byPlace.get(r.place_id).push(r);
  }
  const out = [];
  for (const [placeId, list] of byPlace) {
    const place = getPlace(placeId);
    if (!place) continue;
    const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
    if (avg < min) continue;
    out.push({ place, avg, count: list.length, reviews: list });
  }
  return out.sort((a, b) => b.avg - a.avg || b.count - a.count || String(a.place.name).localeCompare(String(b.place.name), 'zh-Hans-CN')).slice(0, limit);
}

/** 截一段：不超过 max 个字，尽量停在句号、逗号处；截了就加省略号 */
export function excerpt(text, max = 72) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('，'), cut.lastIndexOf('；'));
  const body = stop >= max * 0.5 ? cut.slice(0, stop) : cut;
  return `${body.replace(/[，、；：\s]+$/, '')}…`;
}

/**
 * 日记摘录：有正文的日记，尽量每天一篇（同一天两个人都写了先取第一篇），按日期先后，最多 limit 篇。
 * @param {object[]} entries journal_entries
 * @param {Map<string, object>} daysById
 */
export function journalExcerpts(entries, daysById, { limit = 3, max = 72 } = {}) {
  const withBody = toList(entries)
    .filter((j) => String(j.body || '').trim() && daysById.get(j.day_id))
    .sort((a, b) => String(daysById.get(a.day_id).date).localeCompare(String(daysById.get(b.day_id).date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const picked = [];
  const usedDays = new Set();
  for (const j of withBody) {
    if (usedDays.has(j.day_id)) continue;
    usedDays.add(j.day_id);
    picked.push(j);
  }
  for (const j of withBody) {
    if (picked.length >= limit) break;
    if (!picked.includes(j)) picked.push(j);
  }
  return picked.slice(0, limit)
    .sort((a, b) => String(daysById.get(a.day_id).date).localeCompare(String(daysById.get(b.day_id).date)))
    .map((j) => ({ entry: j, day: daysById.get(j.day_id), text: excerpt(j.body, max) }));
}

/**
 * 每天一张照片：那天日记里的第一张（按成员顺序）。没有照片的天 photo 为 null。
 * @param {object[]} days 已排序
 * @param {Map<string, object[]>} journalByDay
 */
export function dayPhotos(days, journalByDay) {
  return toList(days).map((day, i) => {
    const list = journalByDay?.get?.(day.id) || [];
    for (const j of list) {
      const photos = Array.isArray(j.photos) ? j.photos : [];
      const idx = photos.findIndex((p) => p && p.path);
      if (idx >= 0) return { day, index: i, photo: { path: photos[idx].path, caption: photos[idx].caption || null, entryId: j.id, index: idx }, count: photos.length };
    }
    return { day, index: i, photo: null, count: 0 };
  });
}

/**
 * 行程名「·」后面那一段（「富国岛 · 重阳 3 晚」→「重阳 3 晚」；外壳的副标题也是这么拆的，规则在 lib/trip-title.js）。
 * 回顾大卡的第三行用它，不用 trips.subtitle（真实行程的 subtitle 是整句描述，太长）。
 */
export { tripTitleRest } from '../../lib/trip-title.js';

/** 回顾大卡下面的路线（样稿「高雄 —— 垦丁 —— 台北」）：分段名，相邻重复合并 */
export function segmentRoute(segments) {
  const out = [];
  for (const s of toList(segments)) {
    const name = String(s?.name || '').trim();
    if (name && out[out.length - 1] !== name) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------
// 备选池
// ---------------------------------------------------------------------

/**
 * 把备选池里的条目排进某一天：放在那天最后（sort_key 比当天最大的大 10）。
 * @param {object[]} dayItems 那一天现有的条目（含备选）
 * @returns {{ day_id: string, sort_key: number }}
 */
export function scheduleTarget(dayId, dayItems = []) {
  const max = toList(dayItems).reduce((m, i) => (Number.isFinite(Number(i.sort_key)) ? Math.max(m, Number(i.sort_key)) : m), 0);
  return { day_id: dayId, sort_key: Math.floor(max / 10) * 10 + 10 };
}

// ---------------------------------------------------------------------
// 每天概要卡、打包、免费取消、天气行、日落
// ---------------------------------------------------------------------

/** 明天那一行（days 已排序；没有返回 null） */
export function tomorrowOf(days, date) {
  if (!date) return null;
  const next = addDays(date, 1);
  return toList(days).find((d) => d.date === next) || null;
}

/** 这一天是不是回程日（最后一天，或回程航班当天起飞） */
export function isReturnDay(day, trip, returnFlightRow) {
  if (!day?.date) return false;
  if (trip?.end_date && day.date === trip.end_date) return true;
  if (returnFlightRow && Number.isFinite(ms(returnFlightRow.start_at))) {
    return localDateOf(returnFlightRow.start_at, returnFlightRow.start_tz || trip?.timezone) === day.date;
  }
  return false;
}

/**
 * 每天概要卡要显示的字段。
 *   badge 'D1'、dateText '1月10日 周日'、title（没写标题时「第 1 天」）、sub（节奏 · N 条安排 · 路线一句话）、
 *   stay { glyph: 'bed'|'plane', text: '椰影湾酒店' | '回程 DM802' | '回家' }、count、isToday
 * @param {object} day
 * @param {{ primary?: object[] }|null} plan
 * @param {{ index: number, getPlace: (id) => object|null, stay?: { booking, place }|null, isLast?: boolean,
 *           returnFlight?: object|null, today?: string|null, timeZone?: string }} o
 */
export function dayCardModel(day, plan, { index, getPlace = () => null, stay = null, isLast = false, returnFlight = null, today = null, timeZone } = {}) {
  const primary = plan?.primary || [];
  const n = index + 1;
  const title = String(day?.title || '').trim() || `第 ${n} 天`;
  const parts = [];
  const pace = paceLabel(day?.pace);
  if (pace) parts.push(`节奏${pace}`);
  parts.push(primary.length ? `${primary.length} 条安排` : '还没安排');
  const route = dayRouteLine(primary, getPlace);
  let stayText = null;
  let stayGlyph = 'bed';
  if (stay?.booking) stayText = stayShortName(stay.booking, stay.place);
  else if (isLast && returnFlight) {
    stayText = returnFlight.details?.flight_no ? `回程 ${returnFlight.details.flight_no}` : '回程';
    stayGlyph = 'plane';
  } else if (isLast) {
    stayText = '回家';
    stayGlyph = 'plane';
  }
  return {
    id: day.id,
    date: day.date,
    n,
    badge: `D${n}`,
    dateText: formatDate(day.date, { timeZone, year: 'never' }),
    /** 徽章里的小字：'10 周日' */
    shortDate: `${parseDate(day.date)?.day ?? ''} ${weekdayName(day.date)}`.trim(),
    title,
    sub: parts.join(' · '),
    route: route || null,
    stay: stayText ? { glyph: stayGlyph, text: stayText } : null,
    count: primary.length,
    isToday: Boolean(today) && day.date === today,
    colorIndex: dayColorIndex(index),
  };
}

/**
 * 打包进度：总数、已打包、按「谁的东西」分（共用 / 各成员），比例。
 * @param {Map|object[]} todos
 * @param {{ nameOf?: (userId: string) => string }} [o]
 */
export function packingSummary(todos, { nameOf = () => '成员' } = {}) {
  const list = toList(todos).filter((t) => t && t.list === 'packing');
  const total = list.length;
  const done = list.filter((t) => t.done).length;
  const owners = new Map();
  for (const t of list) {
    const key = t.assignee_user_id || 'shared';
    if (!owners.has(key)) owners.set(key, { key, name: key === 'shared' ? '共用' : nameOf(key), total: 0, done: 0 });
    const o = owners.get(key);
    o.total += 1;
    if (t.done) o.done += 1;
  }
  return {
    total,
    done,
    left: total - done,
    ratio: total ? done / total : 0,
    owners: [...owners.values()].sort((a, b) => (a.key === 'shared' ? -1 : b.key === 'shared' ? 1 : a.name.localeCompare(b.name, 'zh-Hans-CN'))),
  };
}

/**
 * 截止提醒里只留预订的免费取消截止（待办的截止已经在待办卡里了）。
 * urgent：有没有不到 1 天就截止的（卡片换警示色、提到倒计时后面）。
 * @param {Array<{ type, id, title, at, ms }>} deadlines store.view.deadlines（selectors.upcomingDeadlines）
 * @param {{ at: Date, urgentMs?: number }} o
 */
export function freeCancelDeadlines(deadlines, { at, urgentMs = DAY }) {
  const nowMs = at.getTime();
  const list = toList(deadlines).filter((d) => d && d.type === 'free-cancel' && Number.isFinite(d.ms));
  return { list, urgent: list.some((d) => d.ms - nowMs < urgentMs) };
}

/**
 * 一天的天气一行：{ icon, text: '多云', temp: '25–31°', rain: '降雨概率 40%', umbrella, uv, sunrise, sunset }
 * @param {object|null} w useTripWeather 返回的 days[i].weather
 */
export function weatherLine(w) {
  if (!w) return null;
  const hi = Number.isFinite(Number(w.tempMax)) ? Math.round(w.tempMax) : null;
  const lo = Number.isFinite(Number(w.tempMin)) ? Math.round(w.tempMin) : null;
  const temp = hi !== null && lo !== null ? `${lo}–${hi}°` : hi !== null ? `${hi}°` : lo !== null ? `${lo}°` : null;
  const p = Number(w.precipProbability);
  const rain = Number.isFinite(p) ? Math.round(p) : null;
  return {
    icon: w.icon || 'cloud',
    text: w.text || '—',
    temp,
    rain,
    rainText: rain === null ? null : `降雨 ${rain}%`,
    umbrella: rain !== null && rain >= 50,
    uv: w.uv || null,
    sunrise: w.sunrise || null,
    sunset: w.sunset || null,
  };
}

/** 离日落还有多久（分钟；已经过了是负数；没有日落时间 null） */
export function sunsetLeft(sunset, nowMinutes) {
  return minutesUntil(sunset, nowMinutes);
}

/**
 * 条目的时间写法（「现在 / 接下来」、时间轴缩略、备选池用）：和每天页的时间栏同一份规则（kit/item-clock.js）——
 * '09:30–11:00' / '13:00–14:15 香港'（在香港发生的条目）/ '16:45 香港 → 18:35'（航班，传 booking）/ '傍晚' / ''。
 * 第二个参数 { timeZone, booking }：timeZone 是这一天的时区，不传时 local_time 一律按它自己的时区写。
 */
export { itemTimeText, itemClock } from '../../kit/item-clock.js';

/** 日期是不是合法的 'YYYY-MM-DD' */
export const validDate = (d) => isValidDate(d);
