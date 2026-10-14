// =====================================================================
// kit/item-clock.js：时间轴条目的钟点怎么写（每天页的时间栏、概览的「现在 / 接下来」和时间轴缩略共用一份）。
//
//   itemClock(item, { timeZone, booking })     → { main, end, label, sub, note, zone, endZone, arrow, alt, aria }
//   itemTimeText(item, { timeZone, booking })  → 一行字：「13:00–14:15 香港」「16:45 香港 → 18:35」「傍晚」
//   flightLeg(item, booking, timeZone)          → 这条是不是那个航班预订的起飞（是的话返回两头各自时区的钟点）
//
// 规则（10-14 现场走查：人在香港时概览和每天页的钟点对不上，见 pages/day/README.md「时间」一节）：
//   - 普通条目按这一天的时区（行程时区）写钟点，不加时区标签；
//   - 在别的时区发生的条目（extra.local_time = { tz, start, end }，例如在香港坐机场快线、值机）写那边的钟点，加「香港」小标签；
//   - 航班条目（kind = flight，关联的预订是航班、条目的开始正好是预订的起飞时刻）：起飞按起飞地时区写，落地按到达地时区写
//     「→ 23:10」，哪头和这一天的时区不同就在哪头加地名标签——和登机牌、概览的航班卡一致；
//   - 没标签的钟点永远是这一天的时区。
// 只依赖 lib/datetime.js，Node 里能直接测（test/unit/item-clock.test.js）。
// =====================================================================

import { parseTime, formatTime, isOvernight, timeZoneLabel, zonedParts, instantTimeParts } from '../lib/datetime.js';

const hhmm = (t) => formatTime(t);
const msOf = (ts) => {
  const v = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  return Number.isFinite(v) ? v : NaN;
};

/**
 * 这一条是不是航班预订的那一程（起飞那一刻）：是的话给出起飞 / 落地各自时区的钟点。
 * 条目的开始钟点（按这一天的时区）等于预订起飞时刻在这一天时区里的钟点，或者 extra.local_time 写的就是起飞地的起飞钟点，才算；
 * 「T1 值机」这种挂在同一张机票上、但不是起飞那一刻的条目照常显示。
 * @returns {null | { depTime, depTz, depZone, arrTime, arrTz, arrZone, arrShift, tripRange }}
 */
export function flightLeg(item, booking, timeZone) {
  if (!item || item.kind !== 'flight' || !booking || booking.kind !== 'flight') return null;
  if (!Number.isFinite(msOf(booking.start_at))) return null;
  const tz = timeZone || booking.start_tz || 'Asia/Hong_Kong';
  const depTz = booking.start_tz || tz;
  const arrTz = booking.end_tz || depTz;
  const depLocal = zonedParts(booking.start_at, depTz);
  const depTrip = zonedParts(booking.start_at, tz);
  const start = parseTime(item.start_time);
  const lt = item.extra?.local_time;
  const ltStart = lt && typeof lt === 'object' && lt.tz === depTz ? parseTime(lt.start) : null;
  const matches = (start !== null && start === parseTime(depTrip.time)) || (ltStart !== null && ltStart === parseTime(depLocal.time));
  if (!matches) return null;
  const hasArr = Number.isFinite(msOf(booking.end_at));
  const arr = hasArr ? instantTimeParts(booking.end_at, arrTz, depLocal.date) : null;
  const arrTrip = hasArr ? zonedParts(booking.end_at, tz) : null;
  return {
    depTime: depLocal.time,
    depTz,
    depZone: depTz !== tz ? timeZoneLabel(depTz) : null,
    arrTime: arr?.time || '',
    arrTz,
    arrZone: hasArr && arrTz !== tz ? timeZoneLabel(arrTz) : null,
    arrShift: arr?.shiftLabel || '',
    tripRange: [depTrip.time, arrTrip?.time].filter(Boolean).join('–'),
  };
}

/**
 * 条目左边那一栏的时间。
 *   - 主时间是开始钟点（Geist 等宽数字），下面一行是「–结束」（跨午夜写「–次日 01:30」）；航班是「→ 落地」（arrow: true）；
 *   - 没有钟点只有模糊时间（上午 / 日落前）时，主时间位置写模糊时间（label: true，字小一号）；超过 4 个字的放进 fuzzy（卡片副标题里写）；
 *   - 有钟点又有短的模糊时间（≤ 6 个字，例如「午饭后」）时，模糊时间写在钟点下面（sub）；长的说明交给 note（展开后显示在卡片里）；
 *   - 条目在别的时区发生（extra.local_time）：显示那边的当地钟点，zone 是时区小标签「香港」，这时模糊时间一律进 note；
 *     alt 是按这一天时区的同一段时间（「越南 12:00–13:15」，展开后的说明行里写一遍）；
 *   - 航班：起飞按起飞地时区（zone 标在起飞钟点旁），落地按到达地时区（endZone 标在落地钟点旁）。
 * @param {object} item
 * @param {{ timeZone?: string, booking?: object|null }} [o] timeZone：这一天的时区；booking：条目关联的预订（判断航班用）
 */
export function itemClock(item, { timeZone, booking = null } = {}) {
  const tl = String(item?.time_label || '').trim() || null;
  const leg = flightLeg(item, booking, timeZone);
  if (leg) {
    const alt = (leg.depZone || leg.arrZone) && leg.tripRange ? `${timeZoneLabel(timeZone)} ${leg.tripRange}` : null;
    const end = leg.arrTime ? `${leg.arrShift ? `${leg.arrShift} ` : ''}${leg.arrTime}` : '';
    const aria = [
      `${leg.depZone ? `${leg.depZone}时间 ` : ''}${leg.depTime} 起飞`,
      end ? `${leg.arrZone ? `${leg.arrZone}时间 ` : ''}${end} 落地` : null,
      tl,
    ].filter(Boolean).join('，');
    return { main: leg.depTime, end, label: false, fuzzy: null, sub: null, note: tl, zone: leg.depZone, endZone: leg.arrZone, arrow: Boolean(end), alt, aria, flight: true };
  }
  const lt = item?.extra?.local_time;
  const useLocal = lt && typeof lt === 'object' && lt.tz && lt.tz !== timeZone && parseTime(lt.start) !== null;
  const start = useLocal ? lt.start : item?.start_time;
  const end = useLocal ? lt.end : item?.end_time;
  const s = hhmm(start);
  const e = hhmm(end);
  const zone = useLocal ? timeZoneLabel(lt.tz) : null;
  const tripRange = useLocal ? [hhmm(item?.start_time), hhmm(item?.end_time)].filter(Boolean).join('–') : null;
  const alt = useLocal && tripRange ? `${timeZoneLabel(timeZone)} ${tripRange}` : null;
  if (!s) {
    // 只有模糊时间：4 个字以内（「上午」「日落前」）写在时间栏；更长的（「取完行李后」）时间栏放不下、会被拆成两行，
    // 交给卡片副标题（fuzzy），时间栏只留竖线上的圆点（视觉评审 P2-14）
    const fits = Boolean(tl) && [...tl].length <= 4;
    return { main: fits ? tl : '', end: '', label: Boolean(tl), fuzzy: tl && !fits ? tl : null, sub: null, note: null, zone: null, endZone: null, arrow: false, alt: null, aria: tl || '时间未定', flight: false };
  }
  const endText = e && e !== s ? `${isOvernight(start, end) ? '次日 ' : ''}${e}` : '';
  const short = Boolean(tl) && !useLocal && [...tl].length <= 6 && tl !== s;
  const ariaParts = [zone ? `${zone}时间` : null, endText ? `${s} 到 ${endText}` : s, alt ? `（${alt}）` : null, tl && tl !== s ? tl : null];
  return { main: s, end: endText, label: false, fuzzy: null, sub: short ? tl : null, note: tl && !short ? tl : null, zone, endZone: null, arrow: false, alt, aria: ariaParts.filter(Boolean).join(' '), flight: false };
}

/**
 * 一行字的时间（概览「现在 / 接下来」、时间轴缩略、搜索结果）：
 *   '09:30–11:00' / '13:00–14:15 香港' / '16:45 香港 → 18:35' / '19:05 → 23:10 香港' / '傍晚' / ''
 */
export function itemTimeText(item, o = {}) {
  const c = itemClock(item, o);
  if (!c.main) return c.fuzzy || '';
  if (c.label) return c.main;
  if (c.arrow) return `${c.main}${c.zone ? ` ${c.zone}` : ''} → ${c.end}${c.endZone ? ` ${c.endZone}` : ''}`;
  const range = c.end ? `${c.main}–${c.end}` : c.main;
  return c.zone ? `${range} ${c.zone}` : range;
}
