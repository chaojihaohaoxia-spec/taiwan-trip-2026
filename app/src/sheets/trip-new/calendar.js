// =====================================================================
// sheets/trip-new/calendar.js：选区间日历的纯逻辑（新建行程、设置里改日期共用；不带城市表，设置页加载它不会多拉档案数据）。
//
//   pickDate(range, date)   新建：点出发 → 回来先按 4 天补上（auto）；再点一下定回来；点更早的换出发
//   pickEdit(range, date)   改日期：挪离它最近的那一头
//   monthGrid(ym) / cellRole(date, range) / monthTitle / addMonths / WEEK_HEAD   画日历
//   rangeDays / rangeText / zhDay / lengthText / startHint                      日历下面那行字
// =====================================================================

import { isValidDate, addDays, daysBetween, today, weekdayName } from '../../lib/datetime.js';

/** 一趟最长几天（和服务器 create_trip_v2 一样） */
export const MAX_DAYS = 60;
/** 只点了出发：默认几天 */
export const DEFAULT_DAYS = 4;

const str = (v) => (v === null || v === undefined ? '' : String(v));


/**
 * 日历点了一下。
 *   还没选 / 已经选好一段（不是 auto）→ 从这天出发，回来先按默认 4 天补上（auto）；
 *   只点了出发（auto）：点出发当天 → 一天的行程；点更晚的 → 定回来；点更早的 → 换出发。
 * 超过 60 天：不改，返回 { ...range, tooLong: true }。
 * @param {{ start: string, end: string, auto: boolean }} range
 * @param {string} date 'YYYY-MM-DD'
 */
export function pickDate(range, date) {
  if (!isValidDate(date)) return range;
  const fresh = { start: date, end: addDays(date, DEFAULT_DAYS - 1), auto: true };
  if (!range?.start || !range.auto) return fresh;
  const d = daysBetween(range.start, date);
  if (d < 0) return fresh;
  if (d + 1 > MAX_DAYS) return { ...range, tooLong: true };
  return { start: range.start, end: date, auto: false };
}

/**
 * 改日期时点了一下：挪离它最近的那一头（点在出发前 → 换出发；点在回来后 → 换回来；点在中间 → 近哪头挪哪头）。
 * 多加一天、少一天都只点一下；超过 60 天不改，返回 { ...range, tooLong: true }。
 */
export function pickEdit(range, date) {
  if (!isValidDate(date)) return range;
  if (!range?.start || !range.end) return pickDate(range, date);
  let { start, end } = range;
  if (date < start) start = date;
  else if (date > end) end = date;
  else if (date === start || date === end) return { start, end, auto: false };
  else if (daysBetween(start, date) <= daysBetween(date, end)) start = date;
  else end = date;
  if (daysBetween(start, end) + 1 > MAX_DAYS) return { ...range, tooLong: true };
  return { start, end, auto: false };
}

/** 一共几天（没选 → 0） */
export function rangeDays(range) {
  if (!range?.start || !range.end) return 0;
  const n = daysBetween(range.start, range.end);
  return n >= 0 ? n + 1 : 0;
}

/** '10月16日 周五' */
export function zhDay(date) {
  if (!isValidDate(date)) return '';
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${weekdayName(date)}`;
}

/** 几天几晚：'4 天 3 晚'、'1 天' */
export function lengthText(days) {
  if (!days) return '';
  return days > 1 ? `${days} 天 ${days - 1} 晚` : '1 天';
}

/**
 * 日历下面那一行。
 * @returns {{ main: string, sub: string }} main「10月16日 周五 → 10月19日 周一」；sub「4 天 3 晚 · 12 天后出发」/「再点一下选回来那天，不点就是 4 天」
 */
export function rangeText(range, at = new Date(), timeZone = 'Asia/Hong_Kong') {
  if (!range?.start) return { main: '', sub: '点出发那天，再点回来那天' };
  const days = rangeDays(range);
  const main = range.end && range.end !== range.start ? `${zhDay(range.start)} → ${zhDay(range.end)}` : zhDay(range.start);
  const parts = [lengthText(days)];
  const hint = startHint(range.start, at, timeZone);
  if (hint) parts.push(hint);
  const sub = range.auto ? `${parts.join(' · ')}。再点一下选回来那天` : parts.join(' · ');
  return { main, sub };
}

/** 出发前还有几天：「12 天后出发」；过去的日期：「已经过去了，记一趟以前的也行」 */
export function startHint(start, at = new Date(), timeZone = 'Asia/Hong_Kong') {
  if (!isValidDate(start)) return '';
  const d = daysBetween(today(timeZone, at), start);
  if (d > 1) return `${d} 天后出发`;
  if (d === 1) return '明天出发';
  if (d === 0) return '今天出发';
  return '已经过去了，记一趟以前的也行';
}

/** 'YYYY-MM' */
export const monthOf = (date) => str(date).slice(0, 7);

/** 'YYYY-MM' 加减几个月 */
export function addMonths(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** '2027 年 3 月'（同一年只写「3 月」） */
export function monthTitle(ym, thisYear) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return y === thisYear ? `${m} 月` : `${y} 年 ${m} 月`;
}

/** 星期一开头 */
export const WEEK_HEAD = Object.freeze(['一', '二', '三', '四', '五', '六', '日']);

/**
 * 一个月的格子（星期一开头，前后空位是 null），按周分行。
 * @param {string} ym 'YYYY-MM'
 * @returns {Array<Array<string|null>>}
 */
export function monthGrid(ym) {
  const first = `${ym}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: lead }, () => null);
  for (let d = first; monthOf(d) === ym; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 格子在区间里的位置：'start' | 'end' | 'single' | 'in' | null */
export function cellRole(date, range) {
  if (!date || !range?.start) return null;
  const end = range.end || range.start;
  if (date === range.start && date === end) return 'single';
  if (date === range.start) return 'start';
  if (date === end) return 'end';
  if (date > range.start && date < end) return 'in';
  return null;
}

