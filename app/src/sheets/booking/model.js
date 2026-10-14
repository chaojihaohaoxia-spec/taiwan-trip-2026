// =====================================================================
// sheets/booking/model.js：预订页（pages/bookings）和预订详情弹层（sheets/booking）共用的纯逻辑（Node 里能直接测）。
//
//   groupBookings(list, { by: 'kind' | 'date', tripTz, trip, at })   分组：航班 / 酒店 / 活动体验 / 接送 / 餐厅 / 其他，或按日期
//   hotelStayDays / stayParts / stayNote                             按日期时酒店在退房那天、中间续住的几天各有一行（「退房 12:00 前」「续住 第 2 晚」）
//   filterBookings(list, only)                                       顶部汇总点了以后只看：还没订 / 待确认 / 到店付
//   summarizeBookings(list, { at, tripTz })                          顶部汇总：还没订、待确认、到店付（按币种 + 折合港币）、最近的免费取消截止
//   todaysBookings(list, { today, tripTz })                          行程进行中「今天用得上」的预订（今天开始的、今晚住的酒店）
//   freeCancelState(until, { at, timeZone, start })                  免费取消：≤48 小时警示色、≤24 小时红色、过了「已不可免费取消」
//   bookingWhen / whenLine / cardSubtitle(Parts)                     时间（各自时区，跨日标注「次日」，和行程时区不同时标「香港时间」）
//   titleSegments / titleText                                        标题按「 · 」分段（两行时在间隔号后面换行）
//   flightView / hotelView                                           登机牌、入住 / 退房
//   priceView / paymentView                                          卡片上的价格、弹层里的付款情况（谁付、付了多少、还要付多少）
//   detailRows / briefLine                                           弹层「详情」按种类列出 details；卡片上一行概要
//   relatedOf(tables, b)                                             关联的联系人、待办、条目、账目
//   contactChannels(c) / waHref / zaloHref                           打电话、WhatsApp（https://wa.me/<号码>）、Zalo
//   quickActions(b)                                                  弹层里一键改状态（商家确认了 → 已订、付了 → 已付）
//   formOf / patchFromForm / formDirty                               编辑表单（状态、付款、订单号、备注）
//
// ctx：{ tripTz, trip, at, memberName(uid), place(id) }——页面和弹层从数据层拼好传进来；
// 这里不碰数据层、不碰 DOM。金额只用 lib/money.js；时间只用 lib/datetime.js（按各自时区）。
// =====================================================================

import { formatMoney, approxHKD, normalizeCurrency, formatAmount } from '../../lib/money.js';
import {
  zonedParts, formatDate, formatDateRange, formatInstant, timeZoneLabel, tzDifferenceLabel, dayShiftLabel, daysBetween, formatDuration,
  toInstant, isValidDate, formatTime, relativeDayName,
} from '../../lib/datetime.js';
import { freeCancelInfo, FREE_CANCEL_WARN_MS, FREE_CANCEL_URGENT_MS } from '../../kit/status.js';
import { kindLabel } from '../../kit/kinds.js';
import { bookingCost, bookingPayment, compareBookings } from '../../data/selectors.js';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// ---------------------------------------------------------------------
// 分组、筛选
// ---------------------------------------------------------------------

/** 按种类分组的顺序（任务书：航班 / 酒店 / 活动体验 / 接送 / 餐厅 / 其他） */
export const KIND_GROUPS = Object.freeze([
  Object.freeze({ key: 'flight', label: '航班', glyph: 'plane', kinds: Object.freeze(['flight']) }),
  Object.freeze({ key: 'hotel', label: '酒店', glyph: 'bed', kinds: Object.freeze(['hotel']) }),
  Object.freeze({ key: 'activity', label: '活动体验', glyph: 'flag', kinds: Object.freeze(['activity', 'ticket']) }),
  Object.freeze({ key: 'transfer', label: '接送', glyph: 'car', kinds: Object.freeze(['transfer', 'car_rental']) }),
  Object.freeze({ key: 'restaurant', label: '餐厅', glyph: 'bowl', kinds: Object.freeze(['restaurant']) }),
  Object.freeze({ key: 'other', label: '其他', glyph: 'ledger', kinds: Object.freeze(['insurance', 'other']) }),
]);

/** 分组方式：按类型 / 按日期 */
export const GROUP_MODES = Object.freeze({ kind: '按类型', date: '按日期' });

/** 预订种类 → 分组键（不认识的进「其他」） */
export function groupKeyOf(kind) {
  return KIND_GROUPS.find((g) => g.kinds.includes(kind))?.key || 'other';
}

/** 默认的分组方式：行程进行中按日期（今天的在哪一眼看到），其他时候按类型（出发前对着清单查漏） */
export function defaultGroupBy(phase) {
  return phase === 'ongoing' ? 'date' : 'kind';
}

/** 筛选（顶部汇总的几个数字点了就只看那一类）：键 → 中文 */
export const FILTERS = Object.freeze({ idea: '还没订', pending: '待确认', property: '到店付' });

/** 这个预订算不算「到店付」（还没订的不算：只是打算到店付） */
export function isPayAtProperty(b) {
  return b?.status !== 'cancelled' && b?.status !== 'idea' && b?.payment_status === 'pay_at_property';
}

/**
 * 还要处理的「还没订 / 待确认」：时间已经过去的不算（行程里昨天那个没订的按摩、已经吃过的待确认订位，再提醒没有意义；
 * 卡片照样在列表里）。没有时间的算（还不知道什么时候）。
 */
export function isOpenItem(b, status, at) {
  return b?.status === status && !(at && isPast(b, at));
}

/**
 * 按筛选键过滤（不认识的键 = 不过滤）。已取消的永远不在筛选结果里。
 * 给了 at：还没订 / 待确认只留还没过去的（和顶部汇总的数字一致，见 isOpenItem）。
 */
export function filterBookings(list, only, { at } = {}) {
  const all = list || [];
  if (!only || !Object.hasOwn(FILTERS, only)) return all;
  if (only === 'property') return all.filter(isPayAtProperty);
  return all.filter((b) => isOpenItem(b, only, at));
}

/** 预订的开始时刻落在哪个当地日期（按它自己的 start_tz；没写用行程时区）；没有开始时间返回 null */
export function localStartDate(b, tripTz) {
  const d = toInstant(b?.start_at);
  return d ? zonedParts(d, b.start_tz || tripTz).date : null;
}

/** 预订已经结束了吗（有结束时间看结束，没有看开始；开始也没有 = 不知道 → false） */
export function isPast(b, at) {
  const end = toInstant(b?.end_at) || toInstant(b?.start_at);
  return Boolean(end && end.getTime() < at.getTime());
}

/** 预订已经开始了吗（开始了就不再提醒免费取消） */
export function hasStarted(b, at) {
  const s = toInstant(b?.start_at);
  return Boolean(s && s.getTime() <= at.getTime());
}

/**
 * 按日期分组时，酒店在入住日以外的日子也要露面：退房那天「12:00 前退房」、中间几天「续住 · 第 2 晚」
 * （行程中打开「按日期」看今天：要退哪家、今晚住哪，不用往上翻到入住那天）。还没订的酒店不算（不会去住）。
 * @returns {Map<string, Array<{ role: 'out'|'night', booking: object, date: string, night?: number, nights?: number, time?: string, at: number }>>}
 */
export function hotelStayDays(list, { tripTz } = {}) {
  const out = new Map();
  const put = (date, x) => {
    if (!out.has(date)) out.set(date, []);
    out.get(date).push(x);
  };
  for (const b of list || []) {
    if (b?.kind !== 'hotel' || b.status === 'idea' || b.status === 'cancelled') continue;
    const w = bookingWhen(b, { tripTz });
    if (!w.start || !w.end || w.shift <= 0) continue;
    const nights = w.shift;
    // 中间几晚（最多算 60 晚，数据写错时不至于铺满整页）
    for (let n = 2; n <= Math.min(nights, 60); n += 1) {
      const date = addDays(w.start.date, n - 1);
      put(date, { role: 'night', booking: b, date, night: n, nights, at: Number.MAX_SAFE_INTEGER });
    }
    put(w.end.date, { role: 'out', booking: b, date: w.end.date, time: w.end.time, at: toInstant(b.end_at).getTime() });
  }
  return out;
}

/** 'YYYY-MM-DD' 往后数 n 天（日历日期，不碰时区） */
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * 分组。已取消的单独放在 cancelled（页面放在最后、默认收起）。
 *   by 'kind'：KIND_GROUPS 的顺序，组内按时间（start_at，空的在后）；组名里有租车时叫「接送和租车」
 *   by 'date'：按开始的当地日期（各自时区），日期早的在前，没有时间的在最后「时间未定」；组名「1月10日 周日」+ 今天 · D1；
 *              另外每组有 stays（这一天退房 / 续住的酒店，hotelStayDays）和 entries（卡片和酒店那一行按时间排在一起：
 *              退房按退房时间插进去，续住放在最后）
 * @param {object[]} list bookings 行
 * @param {{ by?: 'kind'|'date', tripTz?: string, trip?: object, at?: Date }} [o]
 * @returns {{ groups: Array<{ key: string, label: string, glyph?: string, sub?: string|null, today?: boolean, past?: boolean, items: object[],
 *   stays?: object[], entries?: Array<{ type: 'card', booking: object } | { type: 'stay', stay: object }> }>, cancelled: object[] }}
 */
export function groupBookings(list, { by = 'kind', tripTz, trip, at = new Date() } = {}) {
  const sorted = [...(list || [])].sort(compareBookings);
  const live = sorted.filter((b) => b.status !== 'cancelled');
  const cancelled = sorted.filter((b) => b.status === 'cancelled');
  if (by === 'date') {
    const map = new Map();
    for (const b of live) {
      const date = localStartDate(b, tripTz) || 'undated';
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(b);
    }
    const stayDays = hotelStayDays(live, { tripTz });
    for (const date of stayDays.keys()) if (!map.has(date)) map.set(date, []);
    const keys = [...map.keys()].sort((a, b) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a < b ? -1 : a > b ? 1 : 0));
    const todayDate = tripTz ? zonedParts(at, tripTz).date : null;
    const total = trip?.start_date && trip?.end_date && isValidDate(trip.start_date) && isValidDate(trip.end_date)
      ? daysBetween(trip.start_date, trip.end_date) + 1 : null;
    const groups = keys.map((date) => {
      if (date === 'undated') return { key: 'undated', label: '时间未定', sub: null, items: map.get(date), stays: [], entries: map.get(date).map((b) => ({ type: 'card', booking: b })) };
      const rel = relativeDayName(date, { timeZone: tripTz, at });
      const n = total ? daysBetween(trip.start_date, date) + 1 : null;
      const dayTag = n && n >= 1 && n <= total ? `D${n}` : null;
      const sub = [rel, dayTag].filter(Boolean).join(' · ') || null;
      const items = map.get(date);
      const stays = stayDays.get(date) || [];
      // 卡片和酒店那一行按时间排在一起；同一时刻退房在前（12:00 退房、12:00 的午饭：先退房再去吃）
      const timeOf = (b) => toInstant(b.start_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const entries = [
        ...stays.map((s, i) => ({ type: 'stay', stay: s, t: s.at, i })),
        ...items.map((b, i) => ({ type: 'card', booking: b, t: timeOf(b), i: stays.length + i })),
      ].sort((a, b) => a.t - b.t || a.i - b.i).map(({ type, booking, stay }) => (type === 'card' ? { type, booking } : { type, stay }));
      return {
        key: date,
        label: formatDate(date, { timeZone: tripTz, at }),
        sub,
        today: rel === '今天',
        past: Boolean(todayDate && date < todayDate),
        items,
        stays,
        entries,
      };
    });
    return { groups, cancelled };
  }
  const groups = [];
  for (const g of KIND_GROUPS) {
    const items = live.filter((b) => groupKeyOf(b.kind) === g.key);
    if (!items.length) continue;
    const label = g.key === 'transfer' && items.some((b) => b.kind === 'car_rental')
      ? (items.some((b) => b.kind === 'transfer') ? '接送和租车' : '租车')
      : g.label;
    groups.push({ key: g.key, label, glyph: g.glyph, items });
  }
  return { groups, cancelled };
}

// ---------------------------------------------------------------------
// 免费取消
// ---------------------------------------------------------------------

/** ≤48 小时：警示色（任务书）；≤24 小时：红色 */
export const FREE_CANCEL_SOON_MS = FREE_CANCEL_WARN_MS;
export { FREE_CANCEL_URGENT_MS };

/**
 * 免费取消截止的说法和语气：就是 kit/status.js 的 freeCancelInfo（全站一套规则）。
 *   > 48 小时   later   info     「1月5日 23:59 前可免费取消」
 *   ≤ 48 小时   soon    warning  「免费取消还剩 1 天 20 小时」
 *   ≤ 24 小时   urgent  danger   「免费取消还剩 5 小时」
 *   已经过了     passed  neutral  「已不可免费取消」
 * 预订已经开始了（start 早于现在）就不再提醒（返回 null）。
 * @param {string|Date} until  bookings.free_cancel_until
 * @param {{ at?: Date, timeZone?: string, start?: string|Date }} [o]
 */
export function freeCancelState(until, { at = new Date(), timeZone, start } = {}) {
  const end = toInstant(until);
  if (!end) return null;
  return freeCancelInfo(end, { at, timeZone, start: toInstant(start) });
}

/** 一个预订的免费取消（已取消的、没写截止的、已开始的 → null） */
export function bookingFreeCancel(b, { at = new Date(), tripTz } = {}) {
  if (!b || b.status === 'cancelled' || !b.free_cancel_until) return null;
  return freeCancelState(b.free_cancel_until, { at, timeZone: b.start_tz || tripTz, start: b.start_at });
}

/**
 * 弹层里「免费取消」那一行：
 *   { tone, title: '1月5日 23:59 前可免费取消', detail: '越南时间 · 还剩 3 天', state }
 *   过了：{ title: '已不可免费取消', detail: '截止时间是 1月5日 23:59（越南时间）' }
 */
export function freeCancelLine(b, { at = new Date(), tripTz } = {}) {
  const info = bookingFreeCancel(b, { at, tripTz });
  if (!info) return null;
  const tz = b.start_tz || tripTz;
  const zone = tz ? tzName(tz) : null;
  if (info.state === 'passed') {
    return { state: info.state, tone: info.tone, glyph: info.glyph, title: '已不可免费取消', detail: `截止时间是 ${info.when}${zone ? `（${zone}）` : ''}` };
  }
  return { state: info.state, tone: info.tone, glyph: info.glyph, title: `${info.when} 前可免费取消`, detail: [zone, `还剩 ${info.left}`].filter(Boolean).join(' · ') };
}

// ---------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------

/** 按币种累加：[{ currency, amount }]（按第一次出现的顺序），外加能折合的港币合计 hkd（有不能折合的币种时 partial: true） */
export function sumByCurrency(entries) {
  const map = new Map();
  for (const { currency, amount } of entries) {
    const c = normalizeCurrency(currency);
    const n = Number(amount);
    if (!c || !Number.isFinite(n) || n === 0) continue;
    map.set(c, (map.get(c) || 0) + n);
  }
  const list = [...map.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
  let hkd = 0;
  let partial = false;
  for (const x of list) {
    const v = approxHKD(x.amount, x.currency);
    if (v === null) partial = true;
    else hkd += v;
  }
  return { list, hkd: list.length ? Math.round(hkd) : 0, partial, mixed: list.length > 1 };
}

/** 一串金额的显示：「2,400,000₫ + HK$480（合计约 HK$1,207）」；只有一种币种时就是 formatMoney */
export function formatSum(sum) {
  if (!sum?.list?.length) return '';
  if (sum.list.length === 1) return formatMoney(sum.list[0].amount, sum.list[0].currency);
  const main = sum.list.map((x) => formatAmount(x.amount, x.currency)).join(' + ');
  return sum.hkd ? `${main}（合计约 ${formatAmount(sum.hkd, 'HKD')}${sum.partial ? ' 起' : ''}）` : main;
}

/** 多币种合计的「合计约 HK$1,207」（只有港币或只有一种币种时 null：MoneyText 自己会标折合） */
export function sumHkdNote(sum) {
  if (!sum?.list?.length || !sum.mixed || !sum.hkd) return null;
  return `合计约 ${formatAmount(sum.hkd, 'HKD')}${sum.partial ? ' 起' : ''}`;
}

/**
 * 顶部汇总。
 * @returns {{ total: number, live: number, cancelled: number,
 *   idea: object[], pending: object[], property: object[], propertySum, dueSum, paidSum, spentSum,
 *   nextDeadline: { booking, info } | null, deadlines: Array<{ booking, info }> }}
 */
export function summarizeBookings(list, { at = new Date(), tripTz } = {}) {
  const all = list || [];
  const live = all.filter((b) => b.status !== 'cancelled');
  // 时间已经过去的「还没订 / 待确认」不算进要处理的数（isOpenItem）
  const idea = live.filter((b) => isOpenItem(b, 'idea', at));
  const pending = live.filter((b) => isOpenItem(b, 'pending', at));
  const property = live.filter(isPayAtProperty);
  const propertyEntries = [];
  const dueEntries = [];
  const paidEntries = [];
  const spentEntries = [];
  for (const b of all) {
    const p = bookingPayment(b);
    if (p) {
      if (p.atProperty) propertyEntries.push({ currency: p.currency, amount: p.atProperty });
      if (p.due && b.status !== 'cancelled') dueEntries.push({ currency: p.currency, amount: p.due });
      if (p.paid) paidEntries.push({ currency: p.currency, amount: p.paid });
    }
    const c = bookingCost(b);
    if (c && c.kind !== 'idea' && c.amount) spentEntries.push({ currency: c.currency, amount: c.amount });
  }
  // 「还没订」的截止没有意义（还没订哪来的取消）；已过的、已开始的不再算“要盯的”
  const deadlines = live
    .filter((b) => b.status !== 'idea')
    .map((b) => ({ booking: b, info: bookingFreeCancel(b, { at, tripTz }) }))
    .filter((x) => x.info && x.info.state !== 'passed')
    .sort((a, b) => a.info.msLeft - b.info.msLeft);
  return {
    total: all.length,
    live: live.length,
    cancelled: all.length - live.length,
    idea,
    pending,
    property,
    propertySum: sumByCurrency(propertyEntries),
    dueSum: sumByCurrency(dueEntries),
    paidSum: sumByCurrency(paidEntries),
    spentSum: sumByCurrency(spentEntries),
    nextDeadline: deadlines[0] || null,
    deadlines,
  };
}

/**
 * 行程进行中「今天用得上」的预订：今天开始的，或者今天正住着的酒店（入住日 ≤ 今天 ≤ 退房日）。
 * 今天的「还没订」也放进来（页面上标「还没订」：今天要去的话得先订 / 直接去）；已取消的不放。
 * @param {string} today 行程时区的今天 'YYYY-MM-DD'
 */
export function todaysBookings(list, { today, tripTz } = {}) {
  if (!today) return [];
  return [...(list || [])]
    .filter((b) => b.status !== 'cancelled')
    .filter((b) => b.status !== 'idea' || b.kind !== 'hotel')
    .filter((b) => {
      const start = localStartDate(b, tripTz);
      if (start === today) return true;
      if (b.kind === 'hotel' && start && b.end_at) {
        const end = zonedParts(b.end_at, b.end_tz || b.start_tz || tripTz).date;
        return start <= today && today <= end;
      }
      return false;
    })
    .sort(compareBookings);
}

/**
 * 「今天」一行的说法：酒店住着「今晚住这里」/「今天 12:00 退房」/「今天 14:00 起入住」；别的就是时间。
 */
export function todayNote(b, { today, tripTz, at = new Date() } = {}) {
  if (b?.kind === 'hotel') {
    const h = hotelView(b, { tripTz, at });
    if (h.checkIn?.date === today) return `今天 ${h.checkIn.time} 起入住`;
    if (h.checkOut?.date === today) return `今天 ${h.checkOut.time} 前退房`;
    return '今晚住这里';
  }
  const w = bookingWhen(b, { tripTz });
  if (!w.start) return '今天';
  return w.end && w.shift === 0 && w.sameTz && w.end.time !== w.start.time ? `${w.start.time}–${w.end.time}` : w.start.time;
}

// ---------------------------------------------------------------------
// 时间
// ---------------------------------------------------------------------

/** 时区的叫法：「越南时间」「香港时间」 */
export const tzName = (tz) => `${timeZoneLabel(tz)}时间`;

/**
 * 预订的开始 / 结束（各自时区）。
 * @returns {{ start: null | { date, time, tz, foreign, tzName }, end: null | { …同上 }, shift: number, shiftLabel: string, sameTz: boolean }}
 *   foreign：这个时区和行程时区不一样（显示时标「香港时间」）；shift：结束比开始晚几个当地日期（跨日 → 「次日」）
 */
export function bookingWhen(b, { tripTz } = {}) {
  const sTz = b?.start_tz || tripTz;
  const eTz = b?.end_tz || sTz;
  const part = (value, tz) => {
    const d = toInstant(value);
    if (!d) return null;
    const p = zonedParts(d, tz);
    return { date: p.date, time: p.time, tz, foreign: Boolean(tripTz && tz && tz !== tripTz), tzName: tzName(tz) };
  };
  const start = part(b?.start_at, sTz);
  const end = part(b?.end_at, eTz);
  const shift = start && end ? daysBetween(start.date, end.date) : 0;
  return { start, end, shift, shiftLabel: dayShiftLabel(shift), sameTz: sTz === eTz };
}

/**
 * 一行时间：
 *   今天 / 明天用叫法：「明天 08:30–12:30」
 *   同一天：「1月11日 周一 08:30–12:30」
 *   跨一天：「1月10日 周日 21:00 – 次日 01:00」
 *   跨多天（保险、酒店）：「1月10日–13日」（酒店另有入住 / 退房块）
 *   起止时区不同（航班）：「明天 08:05 香港时间 → 10:20 越南时间」
 *   时区和行程不同：后面加「 · 香港时间」
 *   没有开始时间：「时间未定」
 */
export function whenLine(b, { tripTz, at = new Date() } = {}) {
  const w = bookingWhen(b, { tripTz });
  if (!w.start) return '时间未定';
  // 今天 / 明天 / 昨天用叫法（「后天」「前天」不如日期好认，照写日期）
  const dateText = (p) => {
    const rel = relativeDayName(p.date, { timeZone: p.tz, at });
    return rel === '今天' || rel === '明天' || rel === '昨天' ? rel : formatDate(p.date, { timeZone: p.tz, at });
  };
  const fullDate = (p) => formatDate(p.date, { timeZone: p.tz, at });
  const head = `${dateText(w.start)} ${w.start.time}`;
  if (w.end && !w.sameTz) {
    const endDay = w.shift ? `${w.shift === 1 ? '次日' : fullDate(w.end)} ` : '';
    return `${head} ${w.start.tzName} → ${endDay}${w.end.time} ${w.end.tzName}`;
  }
  const tz = w.start.foreign ? ` · ${w.start.tzName}` : '';
  if (!w.end) return `${head}${tz}`;
  if (w.shift === 0) return w.end.time === w.start.time ? `${head}${tz}` : `${head}–${w.end.time}${tz}`;
  if (w.shift === 1 && b.kind !== 'hotel') return `${head} – 次日 ${w.end.time}${tz}`;
  return `${formatDateRange(w.start.date, w.end.date, { timeZone: w.start.tz, at })}${tz}`;
}

/**
 * 卡片标题下面一行：平台 + 时间。航班（登机牌里已经有起降时间）只写日期；酒店（入住退房块里有日期）写几晚。
 *   「Trip.com · 明天」「Agoda · 2 晚」「Klook · 1月11日 周一 08:30–12:30」
 */
export function cardSubtitle(b, o = {}) {
  const { provider, when } = cardSubtitleParts(b, o);
  return [provider, when].filter(Boolean).join(' · ');
}

/**
 * cardSubtitle 的两段：平台、时间（卡片上分开放：折行时整段时间一起换到下一行，不会把「周五」「13:15」单独甩下去）。
 * @returns {{ provider: string|null, when: string|null }}
 */
export function cardSubtitleParts(b, { tripTz, at = new Date() } = {}) {
  const provider = has(b?.provider) ? String(b.provider) : null;
  let when;
  if (b?.kind === 'flight') {
    const w = bookingWhen(b, { tripTz });
    if (w.start) {
      const rel = relativeDayName(w.start.date, { timeZone: w.start.tz, at });
      when = rel === '今天' || rel === '明天' || rel === '昨天'
        ? `${rel} · ${formatDate(w.start.date, { timeZone: w.start.tz, at })}`
        : formatDate(w.start.date, { timeZone: w.start.tz, at });
    } else when = '时间未定';
  } else if (b?.kind === 'hotel') {
    const h = hotelView(b, { tripTz, at });
    when = h.nights ? `${h.nights} 晚` : (h.checkIn ? null : '日期未定');
  } else {
    when = whenLine(b, { tripTz, at });
  }
  return { provider, when: when || null };
}

/**
 * 标题按「 · 」拆成几段（卡片上每段不拆开：两行时在间隔号后面换行，
 * 不会出现「Coral Bay / Resort · 豪华大床房带阳台」这种从店名中间断开的折法）。间隔号跟着前一段。
 *   '某度假村 · 豪华房' → ['某度假村 ·', '豪华房']
 */
export function titleSegments(title) {
  const parts = String(title ?? '').split(' · ').map((x) => x.trim()).filter(Boolean);
  return parts.map((x, i) => (i < parts.length - 1 ? `${x}\u00a0·` : x));
}

/**
 * 按日期分组时酒店那一行的说法（hotelStayDays 的一项）：
 *   退房：「12:00 前退房」；已经过了退房时间「已退房」
 *   续住：「续住 · 第 2 晚（共 3 晚）」
 */
export function stayNote(stay, { at = new Date() } = {}) {
  const p = stayParts(stay, { at });
  return p ? p.label : '';
}

/**
 * 酒店那一行拆开显示：小标签 tag +一句 detail；label 是整句（读屏、stayNote）。
 *   退房（还没到点）：{ tag: '退房', detail: '12:00 前', label: '12:00 前退房' }
 *   退房（过了点）：  { tag: '已退房', detail: null, label: '已退房', done: true }
 *   续住：            { tag: '续住', detail: '第 2 晚（共 3 晚）', label: '续住 · 第 2 晚（共 3 晚）' }
 */
export function stayParts(stay, { at = new Date() } = {}) {
  if (!stay) return null;
  if (stay.role === 'out') {
    const end = toInstant(stay.booking?.end_at);
    if (end && end.getTime() <= at.getTime()) return { tag: '已退房', detail: null, label: '已退房', done: true };
    return { tag: '退房', detail: stay.time ? `${stay.time} 前` : null, label: stay.time ? `${stay.time} 前退房` : '退房', done: false };
  }
  const detail = `第 ${stay.night} 晚（共 ${stay.nights} 晚）`;
  return { tag: '续住', detail, label: `续住 · ${detail}`, done: false };
}

// ---------------------------------------------------------------------
// 航班（登机牌）
// ---------------------------------------------------------------------

/** 行李一句话：「手提 7kg」「托运 20kg × 1」「托运 20kg（加购）」「不含托运」 */
export function baggageText(bg) {
  if (!bg || typeof bg !== 'object') return { carry: null, checked: null };
  const carry = Number(bg.carry_on_kg) > 0 ? `手提 ${bg.carry_on_kg}kg` : null;
  const addons = Array.isArray(bg.addons) ? bg.addons.filter((a) => a && has(a.label)) : [];
  let checked = null;
  const kg = Number(bg.checked_kg);
  const pcs = Number(bg.checked_pieces);
  if (kg > 0) checked = `托运 ${kg}kg${pcs > 1 ? ` × ${pcs}` : ''}`;
  else if (pcs > 0) checked = `托运 ${pcs} 件`;
  if (addons.length) {
    const extra = addons.map((a) => a.label).join('、');
    checked = checked ? `${checked} + 加购${extra}` : `加购${extra}`;
  } else if (!checked && (bg.checked_kg === 0 || bg.checked_pieces === 0)) {
    checked = '不含托运';
  }
  return { carry, checked };
}

/**
 * 登机牌要的东西。
 * @returns {null | { from, to, fromTerminal, toTerminal, fromWhere, toWhere, dep, arr, duration, tzNote, flightNo, airline, cabin, seats, passengers, meal, baggage }}
 *   dep / arr：{ time, date, dateText, tzName, foreign }；arr.shift / arr.shiftLabel：落地比起飞晚几天（红眼航班「+1」）
 *   fromWhere / toWhere：三字码下面那一小行（「香港时间 · T1」；起降同一个时区时只写航站楼）
 */
export function flightView(b, { tripTz, at = new Date() } = {}) {
  if (!b) return null;
  const d = b.details || {};
  const w = bookingWhen(b, { tripTz });
  // 登机牌一栏很窄：日期不带年份（卡片副标题、行程本身已经说明是哪一年；带上「2026年3月14日 周六」会把「周六」挤断成两行）
  const leg = (p) => (p ? { time: p.time, date: p.date, dateText: formatDate(p.date, { timeZone: p.tz, at, year: 'never' }), tzName: p.tzName, foreign: p.foreign } : null);
  const dep = leg(w.start);
  const arr = leg(w.end);
  if (arr) {
    arr.shift = w.shift;
    arr.shiftLabel = w.shift ? (w.shift > 0 ? `+${w.shift}` : String(w.shift)) : '';
  }
  const start = toInstant(b.start_at);
  const end = toInstant(b.end_at);
  const minutes = start && end ? (end - start) / 60_000 : null;
  const sTz = b.start_tz || tripTz;
  const eTz = b.end_tz || sTz;
  const crossZone = Boolean(sTz && eTz && sTz !== eTz);
  // 时差：落地地和起飞地不同（「落地按越南时间（比香港慢 1 小时）」）
  let tzNote = null;
  if (crossZone && start) {
    const diff = tzDifferenceLabel(eTz, sTz, start);
    if (!diff.startsWith('和')) tzNote = `落地按${tzName(eTz)}（${diff}）`;
  }
  const seats = Array.isArray(d.seats) ? d.seats.filter(has) : [];
  const fromTerminal = has(d.from_terminal) ? String(d.from_terminal) : null;
  const toTerminal = has(d.to_terminal) ? String(d.to_terminal) : null;
  const where = (tz, terminal) => [crossZone && tz ? tzName(tz) : null, terminal].filter(Boolean).join(' · ') || null;
  return {
    from: has(d.from_iata) ? String(d.from_iata).toUpperCase() : null,
    to: has(d.to_iata) ? String(d.to_iata).toUpperCase() : null,
    fromTerminal,
    toTerminal,
    fromCity: sTz ? timeZoneLabel(sTz) : null,
    toCity: eTz ? timeZoneLabel(eTz) : null,
    fromWhere: where(sTz, fromTerminal),
    toWhere: where(eTz, toTerminal),
    dep,
    arr,
    minutes: minutes !== null && minutes > 0 ? minutes : null,
    duration: minutes !== null && minutes > 0 ? formatDuration(minutes) : null,
    tzNote,
    flightNo: has(d.flight_no) ? String(d.flight_no) : null,
    airline: has(d.airline) ? d.airline : null,
    cabin: has(d.cabin) ? d.cabin : null,
    seats,
    passengers: Number(d.passengers) > 0 ? Number(d.passengers) : null,
    meal: typeof d.meal === 'boolean' ? d.meal : null,
    baggage: baggageText(d.baggage),
  };
}

// ---------------------------------------------------------------------
// 酒店（入住 / 退房）
// ---------------------------------------------------------------------

/**
 * @returns {null | { checkIn, checkOut, nights, room, earliest, latest }}
 *   checkIn / checkOut：{ date, dateText, relative, time, tzName, foreign }（按 start_tz / end_tz）；
 *   nights：details.nights，没写按日期算；room：「园景房 · 大床 · 含早」；earliest / latest：酒店规定的最早入住 / 最晚退房
 */
export function hotelView(b, { tripTz, at = new Date() } = {}) {
  if (!b) return null;
  const d = b.details || {};
  const w = bookingWhen(b, { tripTz });
  const side = (p) => (p ? { date: p.date, dateText: formatDate(p.date, { timeZone: p.tz, at }), relative: relativeDayName(p.date, { timeZone: p.tz, at }), time: p.time, tzName: p.tzName, foreign: p.foreign } : null);
  const nights = Number.isInteger(Number(d.nights)) && Number(d.nights) > 0
    ? Number(d.nights)
    : (w.start && w.end && w.shift > 0 ? w.shift : null);
  // 房型已经写进标题的不再写；床型、景观已经写在房型里的（「翡翠湾景观房（花园景，53㎡，1 特大床）」+「特大床」「花园景」）也不再写
  const roomType = has(d.room_type) ? String(d.room_type).trim() : '';
  const inRoom = (v) => roomType && roomType.includes(String(v).trim());
  const roomBits = [
    roomType && !String(b.title || '').includes(roomType) ? roomType : null,
    has(d.bed) && !inRoom(d.bed) ? d.bed : null,
    has(d.view) && !inRoom(d.view) ? d.view : null,
    d.breakfast === true ? '含早' : d.breakfast === false ? '不含早' : null,
  ].filter(Boolean);
  return {
    checkIn: side(w.start),
    checkOut: side(w.end),
    nights,
    room: roomBits.join(' · ') || null,
    earliest: formatTime(d.check_in_time) || null,
    latest: formatTime(d.check_out_time) || null,
  };
}

// ---------------------------------------------------------------------
// 价格、付款
// ---------------------------------------------------------------------

/**
 * 卡片右下角的价格。
 * @returns {null | { amount, currency, note: string|null, redundant?: boolean, tone: 'neutral'|'muted'|'success', estimate: boolean, free?: boolean }}
 *   note：「到店付」「已付订金 HK$200」「已退款」「预计」……；redundant：这句和付款芯片重复（卡片上省掉）
 */
export function priceView(b) {
  if (!b) return null;
  if (b.payment_status === 'free') return { free: true, amount: 0, currency: null, note: null, tone: 'success', estimate: false };
  const amount = Number(b.price_amount);
  if (b.price_amount === null || b.price_amount === undefined || !Number.isFinite(amount) || !b.price_currency) return null;
  const currency = normalizeCurrency(b.price_currency);
  if (b.status === 'cancelled') {
    return { amount, currency, note: b.payment_status === 'refunded' ? '已退款' : (b.payment_status === 'paid' || b.payment_status === 'partial') ? '没退款' : '已取消', tone: 'muted', estimate: false };
  }
  if (b.status === 'idea') return { amount, currency, note: '预计', tone: 'muted', estimate: true };
  // redundant：和旁边的付款芯片说的是一回事（卡片上不重复写，弹层 / 列表行照写）
  if (b.payment_status === 'pay_at_property') return { amount, currency, note: '到店付', redundant: true, tone: 'neutral', estimate: false };
  if (b.payment_status === 'partial') {
    const paid = Number(b.paid_amount);
    return { amount, currency, note: Number.isFinite(paid) && paid > 0 ? `已付订金 ${formatAmount(paid, currency)}` : '付了订金', tone: 'neutral', estimate: false };
  }
  if (b.payment_status === 'unpaid') return { amount, currency, note: '还没付', redundant: true, tone: 'neutral', estimate: false };
  if (b.payment_status === 'refunded') return { amount, currency, note: '已退款', tone: 'muted', estimate: false };
  return { amount, currency, note: null, tone: 'neutral', estimate: false };
}

/**
 * 弹层「付款」一节。
 * @param {object} b
 * @param {{ memberName?: (uid: string) => string }} [ctx]
 * @returns {{ total, paid, due, atProperty, estimate, paidBy, method, addons, deposit, statusLabel }}
 *   total / paid / due / atProperty：{ amount, currency } 或 null（due：还要付多少，不含到店付；atProperty：到店要付多少）
 */
export function paymentView(b, { memberName } = {}) {
  const cost = bookingCost(b);
  const p = bookingPayment(b);
  const currency = cost?.currency || (b?.price_currency ? normalizeCurrency(b.price_currency) : null);
  const money = (amount) => (currency && Number.isFinite(Number(amount)) ? { amount: Number(amount), currency } : null);
  const d = b?.details || {};
  const addons = Array.isArray(d.baggage?.addons) ? d.baggage.addons.filter((a) => a && has(a.label)).map((a) => ({
    label: a.label,
    amount: Number(a.price?.amount),
    currency: a.price?.currency ? normalizeCurrency(a.price.currency) : null,
    paidBy: a.paid_by_user_id && memberName ? memberName(a.paid_by_user_id) : null,
    paidAt: isValidDate(a.paid_at) ? formatDate(a.paid_at, { weekday: false }) : null,
  })) : [];
  const deposit = d.deposit && Number.isFinite(Number(d.deposit.amount)) && d.deposit.currency
    ? { amount: Number(d.deposit.amount), currency: normalizeCurrency(d.deposit.currency) } : null;
  const atProperty = p && p.atProperty ? money(p.atProperty) : null;
  return {
    total: b?.price_amount !== null && b?.price_amount !== undefined ? money(b.price_amount) : null,
    paid: p && p.paid ? money(p.paid) : null,
    // 还要付（不是到店付的那种：未付款 / 订金的尾款）
    due: p && p.due && !p.atProperty ? money(p.due) : null,
    atProperty,
    estimate: b?.status === 'idea',
    paidBy: b?.paid_by_user_id && memberName ? memberName(b.paid_by_user_id) : null,
    method: has(b?.payment_method) ? b.payment_method : null,
    addons,
    deposit,
  };
}

/** 记一笔时预填的分类（data/selectors.js 的 EXPENSE_CATEGORIES） */
export function expenseCategoryOf(kind) {
  switch (kind) {
    case 'hotel': return '住宿';
    case 'flight': case 'transfer': case 'car_rental': return '交通';
    case 'restaurant': return '餐饮';
    case 'ticket': return '门票';
    case 'activity': return '活动';
    default: return '其他';
  }
}

// ---------------------------------------------------------------------
// 详情（弹层「详情」一节：按种类列出 details 的每一项）
// ---------------------------------------------------------------------

export const VOUCHER_LABELS = Object.freeze({ qr: '出示二维码', pdf: 'PDF 电子票', name: '报名字入场', none: '不用凭证' });

/**
 * @param {object} b
 * @param {{ place?: (id: string) => object|null, tripTz?: string, at?: Date }} [ctx]
 * @returns {Array<{ key: string, label: string, value: string, list?: string[], placeId?: string }>}
 */
export function detailRows(b, { place, tripTz, at = new Date() } = {}) {
  const d = b?.details || {};
  const rows = [];
  const push = (key, label, value, extra) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    rows.push({ key, label, value: Array.isArray(value) ? value.join('、') : String(value), ...extra });
  };
  const placeName = (id) => (id && place ? place(id)?.name || null : null);
  const pax = (n) => (Number(n) > 0 ? `${Number(n)} 人` : null);
  switch (b?.kind) {
    case 'flight': {
      const f = flightView(b, { tripTz, at });
      push('flight_no', '航班', [f.flightNo, f.airline].filter(Boolean).join(' · ') || null);
      push('cabin', '舱位', f.cabin);
      push('seats', '座位', f.seats);
      push('passengers', '乘客', pax(f.passengers));
      push('terminal', '航站楼', [f.fromTerminal && `出发 ${f.fromTerminal}`, f.toTerminal && `到达 ${f.toTerminal}`].filter(Boolean).join(' · ') || null);
      push('duration', '飞行', f.duration);
      push('carry', '手提行李', d.baggage && Number(d.baggage.carry_on_kg) > 0 ? `每人 ${d.baggage.carry_on_kg}kg` : null);
      {
        const bg = d.baggage || {};
        const kg = Number(bg.checked_kg);
        const pcs = Number(bg.checked_pieces);
        let v = null;
        if (kg > 0) v = `每人 ${kg}kg${pcs > 0 ? ` · ${pcs} 件` : ''}`;
        else if (pcs > 0) v = `${pcs} 件`;
        else if (bg.checked_kg === 0 || bg.checked_pieces === 0) v = '不含';
        const extra = Array.isArray(bg.addons) ? bg.addons.filter((x) => x && has(x.label)).map((x) => x.label) : [];
        if (extra.length) v = v && v !== '不含' ? `${v}，另加购 ${extra.join('、')}` : `加购 ${extra.join('、')}`;
        push('checked', '托运行李', v);
      }
      push('meal', '餐食', f.meal === true ? '含餐' : f.meal === false ? '不含餐' : null);
      break;
    }
    case 'hotel': {
      const h = hotelView(b, { tripTz, at });
      push('room_type', '房型', d.room_type);
      push('bed', '床型', d.bed);
      push('rooms', '房间', [Number(d.rooms) > 0 ? `${d.rooms} 间` : null, pax(d.guests)].filter(Boolean).join(' · ') || null);
      push('view', '景观', d.view);
      push('breakfast', '早餐', d.breakfast === true ? '含早餐' : d.breakfast === false ? '不含早餐' : null);
      push('check_in_time', '入住', h.earliest ? `${h.earliest} 起可入住` : null);
      push('check_out_time', '退房', h.latest ? `${h.latest} 前退房` : null);
      push('features', '特色', d.features);
      break;
    }
    case 'activity':
    case 'ticket': {
      const meet = [has(d.meeting_point) ? d.meeting_point : placeName(d.meeting_place_id), formatTime(d.meeting_time) ? `${formatTime(d.meeting_time)} 集合` : null].filter(Boolean).join(' · ');
      push('meeting', '集合', meet || null, d.meeting_place_id ? { placeId: d.meeting_place_id } : undefined);
      push('pax', '人数', pax(d.pax));
      push('includes', '包含', Array.isArray(d.includes) ? d.includes.filter(has) : null);
      push('voucher', '入场凭证', VOUCHER_LABELS[d.voucher] || null);
      break;
    }
    case 'transfer': {
      const from = placeName(d.from_place_id);
      const to = placeName(d.to_place_id);
      push('route', '路线', from || to ? `${from || '（没写）'} → ${to || '（没写）'}` : null);
      push('vehicle', '车型', d.vehicle);
      push('pax', '人数', pax(d.pax));
      break;
    }
    case 'restaurant':
      push('pax', '人数', pax(d.pax));
      if (d.deposit && Number(d.deposit.amount) > 0 && d.deposit.currency) push('deposit', '订金', formatMoney(Number(d.deposit.amount), d.deposit.currency));
      break;
    case 'car_rental':
      push('pickup', '取车', placeName(d.pickup_place_id), d.pickup_place_id ? { placeId: d.pickup_place_id } : undefined);
      push('dropoff', '还车', placeName(d.dropoff_place_id), d.dropoff_place_id ? { placeId: d.dropoff_place_id } : undefined);
      push('vehicle', '车型', d.vehicle);
      break;
    case 'insurance':
      push('coverage', '保障', d.coverage);
      push('insured', '受保', pax(d.insured));
      break;
    default:
      break;
  }
  return rows;
}

/**
 * 资料待核（导入时写在 extra 里的一句话：「价格、订单号资料里没有」这种）：有就在弹层里提醒一句，没有返回 null。
 * 键名是导入脚本的约定（extra.待核 / extra.to_verify），值只当普通文字显示。
 */
export function verifyNoteOf(b) {
  const v = b?.extra?.['待核'] ?? b?.extra?.to_verify;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** 附赠 / 权益（extra.perks：字符串数组） */
export function perksOf(b) {
  return Array.isArray(b?.extra?.perks) ? b.extra.perks.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
}

/** 卡片上一行概要（种类相关的两三样）：活动「08:15 集合 · 潜水中心门口 · 2 人」、接送「机场 → 椰影湾酒店 · 5 座车」 */
export function briefLine(b, { place } = {}) {
  const d = b?.details || {};
  const placeName = (id) => (id && place ? place(id)?.name || null : null);
  switch (b?.kind) {
    case 'activity':
    case 'ticket':
      return [formatTime(d.meeting_time) ? `${formatTime(d.meeting_time)} 集合` : null, has(d.meeting_point) ? d.meeting_point : null, Number(d.pax) > 0 ? `${d.pax} 人` : null].filter(Boolean).join(' · ') || null;
    case 'transfer': {
      const from = placeName(d.from_place_id);
      const to = placeName(d.to_place_id);
      return [from || to ? `${from || '？'} → ${to || '？'}` : null, has(d.vehicle) ? d.vehicle : null].filter(Boolean).join(' · ') || null;
    }
    case 'car_rental':
      return [has(d.vehicle) ? d.vehicle : null, placeName(d.pickup_place_id) ? `${placeName(d.pickup_place_id)}取车` : null].filter(Boolean).join(' · ') || null;
    case 'restaurant':
      return Number(d.pax) > 0 ? `${d.pax} 人` : null;
    case 'insurance':
      return [has(d.coverage) ? d.coverage : null, Number(d.insured) > 0 ? `${d.insured} 人` : null].filter(Boolean).join(' · ') || null;
    default:
      return null;
  }
}

/** 概要那一行前面的图形：有集合时间是钟、只有人数是人、接送是路线、租车是车、保险是盾 */
export function briefGlyph(b) {
  const d = b?.details || {};
  switch (b?.kind) {
    case 'activity':
    case 'ticket':
      return formatTime(d.meeting_time) ? 'clock' : has(d.meeting_point) ? 'flag' : 'user';
    case 'transfer': return 'route';
    case 'car_rental': return 'scooter';
    case 'insurance': return 'shield';
    case 'restaurant': return 'user';
    default: return 'info';
  }
}

/** 预订的地点（有 place_id 用它；活动没写就用集合地点；租车用取车点；接送用目的地） */
export function bookingPlaceId(b) {
  const d = b?.details || {};
  if (b?.place_id) return b.place_id;
  if (b?.kind === 'activity' || b?.kind === 'ticket') return d.meeting_place_id || null;
  if (b?.kind === 'car_rental') return d.pickup_place_id || null;
  if (b?.kind === 'transfer') return d.to_place_id || null;
  return null;
}

/**
 * 卡片上要不要放动作行（导航 / 叫 Grab / 给司机看 / 复制地址）：酒店、活动、门票、餐厅放带文字的完整版
 * （街头单手、强光下看图标猜不出哪个是「给司机看」——四个都写字，和条目、地点面板里的同一个样子）；
 * 接送是别人来接、航班在机场——卡片上不放，弹层里照样有地点。已取消、已结束的不放。
 */
export function actionsSize(b, { at } = {}) {
  if (!b || b.status === 'cancelled') return null;
  if (at && isPast(b, at)) return null;
  if (['hotel', 'activity', 'ticket', 'restaurant'].includes(b.kind)) return 'full';
  return null;
}

// ---------------------------------------------------------------------
// 关联：联系人、待办、条目、账目
// ---------------------------------------------------------------------

const valuesOf = (m) => (m instanceof Map ? [...m.values()] : Array.isArray(m) ? m : m ? Object.values(m) : []);

/**
 * @param {{ contacts?, todos?, items?, expenses?, days? }} tables  Map<id, 行> 或数组
 * @param {object} b
 * @returns {{ contacts: object[], todos: object[], items: Array<{ item, day }>, expenses: object[] }}
 *   联系人：司机（details.driver_contact_id）→ 关联这个预订的 → 同一个地点、没挂在别的预订上的
 */
export function relatedOf(tables, b) {
  if (!b) return { contacts: [], todos: [], items: [], expenses: [] };
  const d = b.details || {};
  const contacts = [];
  const seen = new Set();
  const add = (c) => {
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      contacts.push(c);
    }
  };
  const allContacts = valuesOf(tables.contacts).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
  if (d.driver_contact_id) add(allContacts.find((c) => c.id === d.driver_contact_id));
  for (const c of allContacts) if (c.booking_id === b.id) add(c);
  if (b.place_id) for (const c of allContacts) if (c.place_id === b.place_id && !c.booking_id) add(c);
  const LIST_ORDER = ['confirm', 'todo', 'buy', 'packing'];
  const todos = valuesOf(tables.todos)
    .filter((t) => t.booking_id === b.id)
    .sort((x, y) => Number(Boolean(x.done)) - Number(Boolean(y.done)) || LIST_ORDER.indexOf(x.list) - LIST_ORDER.indexOf(y.list) || (x.sort ?? 0) - (y.sort ?? 0));
  const days = new Map(valuesOf(tables.days).map((x) => [x.id, x]));
  const items = valuesOf(tables.items)
    .filter((it) => it.booking_id === b.id && !it.deleted_at)
    .map((item) => ({ item, day: item.day_id ? days.get(item.day_id) || null : null }))
    .sort((x, y) => String(x.day?.date || '9').localeCompare(String(y.day?.date || '9')) || String(x.item.start_time || '99').localeCompare(String(y.item.start_time || '99')));
  const expenses = valuesOf(tables.expenses).filter((e) => e.booking_id === b.id && !e.deleted_at);
  return { contacts, todos, items, expenses };
}

/** 运输类预订的司机（卡片上直接放打电话 / WhatsApp） */
export function driverContactOf(tables, b) {
  const id = b?.details?.driver_contact_id;
  if (!id) return null;
  return valuesOf(tables.contacts).find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------------
// 联系方式
// ---------------------------------------------------------------------

// 号码 → 链接的规则在 lib/contact-links.js（联系人页、地点动作行同一套）；telLink 是这里原来的名字
export { phoneDigits, telHref as telLink, waHref, zaloHref } from '../../lib/contact-links.js';
import { telHref, waHref, zaloHref, isVnMobile } from '../../lib/contact-links.js';

/**
 * 联系人有哪些一键方式：
 *   actions：打电话（tel:）、WhatsApp（wa.me）、Zalo（zalo.me）——外链按钮
 *   copies：邮箱、微信、LINE——只能复制（点一下复制）
 * @returns {{ actions: Array<{ key, label, glyph, href }>, copies: Array<{ key, label, value }> }}
 */
export function contactChannels(c) {
  const actions = [];
  const tel = telHref(c?.phone);
  if (tel) actions.push({ key: 'call', label: '打电话', glyph: 'call', href: tel });
  const wa = waHref(c?.whatsapp);
  if (wa) actions.push({ key: 'whatsapp', label: 'WhatsApp', glyph: 'whatsapp', href: wa });
  // 没单独写 Zalo 号、电话是越南手机号：照联系人页的做法也给「Zalo」（越南的手机号基本都开着 Zalo，按手机号找）
  const zalo = zaloHref(c?.zalo) || (isVnMobile(c?.phone) ? zaloHref(c.phone) : null);
  if (zalo) actions.push({ key: 'zalo', label: 'Zalo', glyph: 'zalo', href: zalo });
  const copies = [];
  if (has(c?.email)) copies.push({ key: 'email', label: '邮箱', value: String(c.email).trim() });
  if (has(c?.wechat)) copies.push({ key: 'wechat', label: '微信', value: String(c.wechat).trim() });
  if (has(c?.line)) copies.push({ key: 'line', label: 'LINE', value: String(c.line).trim() });
  return { actions, copies };
}

/** 附件大小：18432 → '18 KB'；1.2 MB；没有返回 null */
export function fileSizeText(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 附件：{ path, name, kind: 'pdf'|'image'|'file', meta: 'PDF · 18 KB' }；没有 path 的跳过 */
export function attachmentsOf(b) {
  const list = Array.isArray(b?.attachments) ? b.attachments : [];
  return list.filter((a) => a && has(a.path)).map((a) => {
    const mime = String(a.mime || '').toLowerCase();
    const name = has(a.name) ? String(a.name) : String(a.path).split('/').pop();
    const kind = mime === 'application/pdf' || /\.pdf$/i.test(name) ? 'pdf' : mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name) ? 'image' : 'file';
    const meta = [kind === 'pdf' ? 'PDF' : kind === 'image' ? '图片' : '文件', fileSizeText(a.size)].filter(Boolean).join(' · ');
    return { path: String(a.path), name, kind, meta };
  });
}

/** 链接的显示：标签 + 域名（example.com） */
export function linkHost(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 管理链接、官网等（只要 http(s)，按 B5.1 的 kind 给个图形） */
export function linksOf(b) {
  const list = Array.isArray(b?.links) ? b.links : [];
  return list.filter((l) => l && has(l.url) && /^https?:\/\//i.test(String(l.url).trim())).map((l) => ({
    label: has(l.label) ? String(l.label) : linkHost(l.url) || '链接',
    url: String(l.url).trim(),
    host: linkHost(l.url),
    glyph: l.kind === 'maps' ? 'map' : l.kind === 'menu' ? 'bowl' : l.kind === 'guide' ? 'book' : l.kind === 'video' ? 'photo' : 'external',
  }));
}

/** 标题显示用：「 · 」前面换成不换行空格，折行时间隔号不会跑到下一行行首（「Coral Bay Resort / · 豪华大床房」） */
export function titleText(title) {
  return String(title ?? '').replace(/ · /g, '\u00a0· ');
}

/** 弹层副标题：「酒店 · Agoda」 */
export function sheetSubtitle(b) {
  return [kindLabel('booking', b?.kind), has(b?.provider) ? b.provider : null].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------
// 一键改状态（弹层里状态芯片旁边的按钮）
// ---------------------------------------------------------------------

/**
 * 最常用的两步，不用进编辑（me：当前用户 id，标已付时没记谁付的就记成他）：
 *   待确认 → 「商家确认了」（status: booked）；还没订 → 「已经订好了」（status: booked）
 *   已订、未付款 / 到店付 → 「已付清」（payment_status: paid，清掉订金金额）；付了订金 → 「尾款付清了」
 * @returns {Array<{ key: string, label: string, done: string, patch: object, revert: object }>}
 *   done：改完以后 Toast 说的话；revert：撤销时写回去的值
 */
export function quickActions(b, { me } = {}) {
  if (!b || b.status === 'cancelled') return [];
  const out = [];
  if (b.status === 'pending') out.push({ key: 'confirm', label: '商家确认了', done: '已改成「已订」', patch: { status: 'booked' }, revert: { status: 'pending' } });
  if (b.status === 'idea') out.push({ key: 'booked', label: '已经订好了', done: '已改成「已订」', patch: { status: 'booked' }, revert: { status: 'idea' } });
  if (b.status === 'booked' && ['unpaid', 'pay_at_property', 'partial'].includes(b.payment_status) && b.price_amount !== null && b.price_amount !== undefined) {
    out.push({
      key: 'paid',
      label: b.payment_status === 'partial' ? '尾款付清了' : b.payment_status === 'pay_at_property' ? '到店付好了' : '已付清',
      done: '已改成「已付」',
      // 没记谁付的：记成点按钮的人（和编辑表单的默认一样；不对可以在「修改」里改），以后账本对账用得上
      patch: { payment_status: 'paid', paid_amount: null, ...(!b.paid_by_user_id && me ? { paid_by_user_id: me } : {}) },
      revert: { payment_status: b.payment_status, paid_amount: b.paid_amount ?? null, ...(!b.paid_by_user_id && me ? { paid_by_user_id: null } : {}) },
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// 编辑（状态、付款、订单号、备注）
// ---------------------------------------------------------------------

export const STATUS_OPTIONS = Object.freeze(['idea', 'pending', 'booked', 'cancelled']);
export const PAYMENT_OPTIONS = Object.freeze(['unpaid', 'paid', 'partial', 'pay_at_property', 'free', 'refunded']);

export const EDIT_FIELDS = Object.freeze(['status', 'payment_status', 'paid_amount', 'paid_by_user_id', 'payment_method', 'confirmation_code', 'notes']);

/** 付款状态要不要记「谁付的」 */
export const needsPayer = (paymentStatus) => ['paid', 'partial', 'refunded'].includes(paymentStatus);
/** 付款状态要不要记「付款方式」 */
export const needsMethod = (paymentStatus) => ['paid', 'partial', 'pay_at_property', 'refunded'].includes(paymentStatus);

/** 预订行 → 表单的初值 */
export function formOf(b) {
  return {
    status: b?.status || 'booked',
    payment_status: b?.payment_status || 'unpaid',
    paid_amount: b?.paid_amount === null || b?.paid_amount === undefined ? '' : String(b.paid_amount),
    paid_by_user_id: b?.paid_by_user_id || '',
    payment_method: b?.payment_method || '',
    confirmation_code: b?.confirmation_code || '',
    notes: b?.notes || '',
  };
}

/**
 * 表单 → 要提交的改动（只含真正变了的字段）+ 出错原因。
 *   付了订金：已付金额要大于 0、不能超过总价、要有价格币种；不是订金就清掉已付金额；
 *   谁付的：只有已付 / 订金 / 已退款才记；订单号去掉首尾空白；备注保留换行、去掉首尾空白。
 * @param {object} b       原来的预订
 * @param {object} form    formOf() 的形状（字符串）
 * @param {{ parseAmount: (s: string, o: object) => number|null }} deps
 * @returns {{ patch: object, errors: Record<string, string>, changed: boolean }}
 */
export function patchFromForm(b, form, { parseAmount }) {
  const errors = {};
  const patch = {};
  const trimmed = (s) => String(s ?? '').trim();
  patch.status = form.status;
  patch.payment_status = form.payment_status;
  if (form.payment_status === 'partial') {
    const raw = trimmed(form.paid_amount);
    const n = raw ? parseAmount(raw, { currency: b?.price_currency }) : null;
    if (!b?.price_currency) errors.paid_amount = '这个预订没写价格币种，记不了订金金额';
    else if (n === null || !Number.isFinite(n) || n <= 0) errors.paid_amount = '填一下已经付了多少';
    else if (b.price_amount !== null && b.price_amount !== undefined && Number.isFinite(Number(b.price_amount)) && n > Number(b.price_amount)) errors.paid_amount = '订金比总价还多';
    else patch.paid_amount = n;
  } else {
    patch.paid_amount = null;
  }
  const paidish = needsPayer(form.payment_status);
  patch.paid_by_user_id = paidish ? (form.paid_by_user_id || b?.paid_by_user_id || null) : null;
  patch.payment_method = needsMethod(form.payment_status) ? (trimmed(form.payment_method) || null) : (b?.payment_method ?? null);
  patch.confirmation_code = trimmed(form.confirmation_code) || null;
  patch.notes = String(form.notes ?? '').replace(/\s+$/, '').replace(/^\s*\n/, '') || null;
  const same = (x, y) => {
    const a = x ?? null;
    const c = y ?? null;
    if (a === null || c === null) return a === c;
    return typeof a === 'number' || typeof c === 'number' ? Number(a) === Number(c) : a === c;
  };
  for (const k of Object.keys(patch)) if (same(patch[k], b?.[k])) delete patch[k];
  if (errors.paid_amount) delete patch.paid_amount;
  const changed = Object.keys(patch).length > 0;
  return { patch, errors, changed };
}

/** 表单有没有改过（未保存提醒用） */
export function formDirty(b, form) {
  const base = formOf(b);
  return Object.keys(base).some((k) => String(base[k] ?? '') !== String(form[k] ?? ''));
}
