// =====================================================================
// data/zoned.js：按 IANA 时区算“当地现在几点”“当地某天零点是哪个时刻”（数据层用的写法）。
//
// 行程里的日期和钟点都是当地的（文档 A2）：days.date、items.start_time 按该天所属分段的时区理解，
// 分段没写就按 trips.timezone。设备时区可能完全不同（人在香港看越南的行程），
// 所以“现在是行程第几天”“下一项是什么”都要先把“现在”换算到行程时区。
//
// 时区换算本身只在 lib/datetime.js 实现一份（zonedParts / tzOffsetMinutes / zonedToInstant，含夏令时、
// 无效时区退回设备时区不崩）；这里只是换成数据层（selectors.js）要的返回格式：带秒的钟点、毫秒时刻。
// =====================================================================

import { zonedParts, tzOffsetMinutes, zonedToInstant } from '../lib/datetime.js';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 某个时刻在 timeZone 里的当地日期和钟点。
 * @param {Date|number|string} at
 * @param {string} timeZone
 * @returns {{ date: string, time: string, minutes: number }} date 'YYYY-MM-DD'，time 'HH:MM:SS'，minutes 当天第几分钟（含秒的小数）
 */
export function nowInZone(at, timeZone) {
  const p = zonedParts(at, timeZone);
  return { date: p.date, time: `${p.time}:${pad2(p.second)}`, minutes: p.hour * 60 + p.minute + p.second / 60 };
}

/** 某个时刻 timeZone 相对 UTC 的偏移（毫秒，东八区 = +8h） */
export function tzOffsetMs(at, timeZone) {
  return tzOffsetMinutes(timeZone, at) * 60_000;
}

/**
 * 当地日期 + 钟点 → 时刻（毫秒）。夏令时切换的那一刻按“最接近”的处理（lib/datetime.js 的 zonedToInstant）。
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} [time='00:00:00']
 * @param {string} timeZone
 * @returns {number} 毫秒；日期或钟点无效时 NaN
 */
export function zonedTimeToMs(date, time = '00:00:00', timeZone) {
  const at = zonedToInstant(date, time || '00:00:00', timeZone);
  return at ? at.getTime() : Number.NaN;
}

/** 当地某天零点对应的时刻（毫秒） */
export function zonedStartOfDay(date, timeZone) {
  return zonedTimeToMs(date, '00:00:00', timeZone);
}

/**
 * 带偏移的时间戳 → 在 timeZone 里的当地日期和钟点（显示航班“当地起飞时间”等）。
 * @param {string} ts 如 '2027-01-10T01:00:00+00:00'
 */
export function tsInZone(ts, timeZone) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return nowInZone(new Date(ms), timeZone);
}
