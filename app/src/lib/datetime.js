// =====================================================================
// lib/datetime.js：日期、时刻、钟点、时长、相对时间的显示（全站统一，简体中文）。
//
// 三种“时间”要分清（见 docs/数据结构.md A2）：
//   1. 日期 date        'YYYY-MM-DD'，当地日期，没有时区（days.date、trips.start_date）；
//   2. 钟点 time        'HH:MM' / 'HH:MM:SS'，当地钟点，24 小时制（items.start_time）；
//   3. 时刻 timestamptz 带偏移的 ISO 串或 Date，一个确定的瞬间（bookings.start_at、updated_at）。
//      显示时必须指定时区：用旁边的 *_tz 字段，或行程时区 trips.timezone。
//
// 规则：
//   - “今天/明天”一律按行程时区算（不是手机所在时区）：人在香港看越南行程，“今天”是越南的今天；
//   - “现在”一律来自 lib/clock.js 的 now()（本机可用 ?now= 拨时间，测试可重复）；
//   - 日期本身（'YYYY-MM-DD'）的加减、星期几都按纯日历算，不经过任何时区，跨年、闰年不会错；
//   - 钟点 end < start 表示跨过午夜（显示“次日”）。
//
// 常用：
//   formatDate('2026-10-16')                          → '10月16日 周五'
//   formatDate('2027-01-10', { timeZone })            → '2027年1月10日 周日'（不是今年就带年份）
//   formatDate(d, { timeZone, relative: true })       → '今天' / '明天' / '10月16日 周五'
//   formatDayHeading(d, { timeZone })                 → { primary: '今天', secondary: '10月16日 周五' }
//   formatDateRange('2026-12-30', '2027-01-02')       → '2026年12月30日–2027年1月2日'
//   formatTimeRange('22:00', '01:30')                 → '22:00–次日 01:30'
//   formatDuration(80)                                → '1 小时 20 分钟'
//   formatRelativeTime(updatedAt)                     → '3 分钟前' / '昨天 14:30' / '10月3日'
//   formatInstant(booking.start_at, { timeZone: booking.start_tz }) → '1月10日 08:05'
//   tripPhase(trip)                                   → { phase: 'ongoing', dayNumber: 2, totalDays: 4, … }
// =====================================================================

import { now, todayIn, daysBetween } from './clock.js';

export { daysBetween };

/** 星期几（0 = 周日，和 Date#getUTCDay 一致） */
export const WEEKDAY_NAMES = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

/** 默认的“家”时区（Jeremy 和 Cathy 住在香港），时差说明用 */
export const HOME_TIME_ZONE = 'Asia/Hong_Kong';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------
// 日期（'YYYY-MM-DD'，纯日历）
// ---------------------------------------------------------------------

/**
 * 解析 'YYYY-MM-DD'。不是真实存在的日期（2 月 30 日、13 月）返回 null。
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseDate(value) {
  const m = DATE_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const t = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC 会把 0–99 年当成 1900+，这里的年份都是四位数，不受影响
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** 是不是合法的 'YYYY-MM-DD' */
export function isValidDate(value) {
  return parseDate(value) !== null;
}

function dateFromUtcMs(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function utcMsOf(date) {
  const p = parseDate(date);
  if (!p) throw new RangeError(`不是合法的日期：${date}`);
  return Date.UTC(p.year, p.month - 1, p.day);
}

/** 日期加减天数：addDays('2026-12-31', 1) → '2027-01-01' */
export function addDays(date, days) {
  return dateFromUtcMs(utcMsOf(date) + Math.round(days) * DAY);
}

/** 比较两个日期：a < b 返回负数，相等 0，a > b 正数 */
export function compareDates(a, b) {
  return utcMsOf(a) - utcMsOf(b);
}

/** 星期几：0 = 周日 … 6 = 周六 */
export function weekdayIndex(date) {
  return new Date(utcMsOf(date)).getUTCDay();
}

/** '周五' */
export function weekdayName(date) {
  return WEEKDAY_NAMES[weekdayIndex(date)];
}

/** 从 start 到 end（含两端）的每一天 */
export function eachDate(start, end) {
  const out = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i += 1) out.push(addDays(start, i));
  return out;
}

// ---------------------------------------------------------------------
// 时区
// ---------------------------------------------------------------------

const partsFormatters = new Map();
const validZones = new Map();

/** 时区名是否有效（IANA，如 'Asia/Ho_Chi_Minh'） */
export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  if (validZones.has(timeZone)) return validZones.get(timeZone);
  let ok = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    ok = false;
  }
  validZones.set(timeZone, ok);
  return ok;
}

/** 设备当前所在的时区（Node 里是 TZ 环境变量或 UTC） */
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 无效或没给时区时，退回设备时区（不抛错，避免一行脏数据让整页崩掉） */
function zoneOr(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
}

function partsFormatter(timeZone) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** 把 Date / ISO 串 / 毫秒数统一成 Date；无效返回 null */
export function toInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 某个时刻在某个时区里的“墙上时间”。
 * @returns {{ year, month, day, hour, minute, second, date: string, time: string, weekday: number }}
 */
export function zonedParts(at, timeZone) {
  const d = toInstant(at);
  if (!d) throw new RangeError(`不是合法的时刻：${at}`);
  const parts = {};
  for (const p of partsFormatter(zoneOr(timeZone)).formatToParts(d)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const date = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  return { year, month, day, hour, minute, second, date, time: `${pad2(hour)}:${pad2(minute)}`, weekday: weekdayIndex(date) };
}

/** 某个时区在某个时刻相对 UTC 的偏移（分钟），例如越南 420、尼泊尔 345 */
export function tzOffsetMinutes(timeZone, at = now()) {
  const d = toInstant(at) || now();
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / MINUTE);
}

/**
 * 当地日期 + 当地钟点 → 确定的时刻（Date）。夏令时切换的那一刻也按“最接近”的处理。
 * zonedToInstant('2027-01-10', '15:30', 'Asia/Ho_Chi_Minh') → 2027-01-10T08:30:00Z
 */
export function zonedToInstant(date, time = '00:00', timeZone) {
  const p = parseDate(date);
  const minutes = parseTime(time);
  if (!p || minutes === null) return null;
  const sec = secondsOf(time);
  const guess = Date.UTC(p.year, p.month - 1, p.day, Math.floor(minutes / 60), minutes % 60, sec);
  const off1 = tzOffsetMinutes(timeZone, new Date(guess));
  let t = guess - off1 * MINUTE;
  const off2 = tzOffsetMinutes(timeZone, new Date(t));
  if (off2 !== off1) t = guess - off2 * MINUTE;
  return new Date(t);
}

/** 偏移写法：420 → 'UTC+7'，345 → 'UTC+5:45'，-180 → 'UTC−3'，0 → 'UTC' */
export function formatUtcOffset(minutes) {
  if (!Number.isFinite(minutes) || minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad2(m)}` : ''}`;
}

/** 常见时区的中文地名（时差说明用）；没列出的用城市英文名 */
const ZONE_NAMES = Object.freeze({
  'Asia/Hong_Kong': '香港',
  'Asia/Macau': '澳门',
  'Asia/Shanghai': '北京',
  'Asia/Chongqing': '北京',
  'Asia/Taipei': '台北',
  'Asia/Ho_Chi_Minh': '越南',
  'Asia/Saigon': '越南',
  'Asia/Bangkok': '曼谷',
  'Asia/Singapore': '新加坡',
  'Asia/Kuala_Lumpur': '吉隆坡',
  'Asia/Tokyo': '东京',
  'Asia/Seoul': '首尔',
  'Asia/Manila': '马尼拉',
  'Asia/Jakarta': '雅加达',
  'Asia/Makassar': '巴厘岛',
  'Asia/Phnom_Penh': '金边',
  'Asia/Kathmandu': '加德满都',
  'Asia/Dubai': '迪拜',
  'Europe/London': '伦敦',
  'Europe/Paris': '巴黎',
  'Australia/Sydney': '悉尼',
  'America/New_York': '纽约',
  'America/Los_Angeles': '洛杉矶',
  UTC: '世界协调时',
});

/** 时区的中文名：'Asia/Ho_Chi_Minh' → '越南' */
export function timeZoneLabel(timeZone) {
  if (ZONE_NAMES[timeZone]) return ZONE_NAMES[timeZone];
  const last = String(timeZone || '').split('/').pop() || '';
  return last.replace(/_/g, ' ') || '当地';
}

function hoursMinutesText(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h} 小时 ${m} 分钟`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}

/**
 * 和“家”（默认香港）的时差说明：
 *   tzDifferenceLabel('Asia/Ho_Chi_Minh') → '比香港慢 1 小时'
 *   tzDifferenceLabel('Asia/Taipei')      → '和香港时间相同'
 *   tzDifferenceLabel('Asia/Kathmandu')   → '比香港慢 2 小时 15 分钟'
 */
export function tzDifferenceLabel(timeZone, homeTimeZone = HOME_TIME_ZONE, at = now()) {
  const diff = tzOffsetMinutes(timeZone, at) - tzOffsetMinutes(homeTimeZone, at);
  const home = timeZoneLabel(homeTimeZone);
  if (diff === 0) return `和${home}时间相同`;
  return `比${home}${diff < 0 ? '慢' : '快'} ${hoursMinutesText(Math.abs(diff))}`;
}

/** 某个时区里的“今天”（'YYYY-MM-DD'），默认取 now() */
export function today(timeZone, at = now()) {
  return todayIn(zoneOr(timeZone), toInstant(at) || now());
}

// ---------------------------------------------------------------------
// 日期显示
// ---------------------------------------------------------------------

const RELATIVE_DAY = Object.freeze({ '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' });

/** 把各种输入变成日历日期：'YYYY-MM-DD' 原样；时刻按时区换成当地日期 */
function civilDate(input, timeZone) {
  if (typeof input === 'string' && DATE_RE.test(input.trim())) return parseDate(input) ? input.trim() : null;
  const d = toInstant(input);
  return d ? zonedParts(d, timeZone).date : null;
}

/**
 * 相对今天的叫法：'前天' / '昨天' / '今天' / '明天' / '后天'，其他返回 null。
 * @param {string|Date} date 日期或时刻
 * @param {{ timeZone?: string, at?: Date|string, today?: string }} [o]
 *   today：直接给定“今天”（'YYYY-MM-DD'），不给就按 timeZone 和 at（默认 now()）算
 */
export function relativeDayName(date, { timeZone, at, today: todayOverride } = {}) {
  const d = civilDate(date, timeZone);
  if (!d) return null;
  const base = todayOverride || today(timeZone, at);
  return RELATIVE_DAY[daysBetween(base, d)] ?? null;
}

/** '1月10日'（不带年份、星期） */
export function formatMonthDay(date) {
  const p = parseDate(date);
  return p ? `${p.month}月${p.day}日` : '';
}

/**
 * 日期显示。
 * @param {string|Date} input 'YYYY-MM-DD'，或时刻（此时按 timeZone 换算成当地日期）
 * @param {object} [o]
 * @param {string} [o.timeZone]                   行程时区：决定“今天”是哪天、时刻落在哪天
 * @param {boolean} [o.weekday=true]              带“周五”
 * @param {'auto'|'always'|'never'} [o.year='auto'] auto = 不是今年才带年份
 * @param {boolean} [o.relative=false]            今天/明天/昨天/前天/后天 直接用叫法代替
 * @param {Date|string} [o.at]                    “现在”（默认 now()）
 * @returns {string} '10月16日 周五' / '2027年1月10日 周日' / '今天'；无效输入返回 ''
 */
export function formatDate(input, { timeZone, weekday = true, year = 'auto', relative = false, at } = {}) {
  const d = civilDate(input, timeZone);
  if (!d) return '';
  const base = today(timeZone, at);
  if (relative) {
    const name = RELATIVE_DAY[daysBetween(base, d)];
    if (name) return name;
  }
  const p = parseDate(d);
  const showYear = year === 'always' || (year === 'auto' && p.year !== parseDate(base).year);
  const main = `${showYear ? `${p.year}年` : ''}${p.month}月${p.day}日`;
  return weekday ? `${main} ${WEEKDAY_NAMES[weekdayIndex(d)]}` : main;
}

/**
 * 日期标题的两段式（大字 + 小字）：
 *   今天 → { primary: '今天', secondary: '10月16日 周五', relative: '今天' }
 *   其他 → { primary: '10月18日 周日', secondary: null, relative: null }
 */
export function formatDayHeading(input, { timeZone, at, year = 'auto' } = {}) {
  const relative = relativeDayName(input, { timeZone, at });
  const full = formatDate(input, { timeZone, at, year });
  return relative ? { primary: relative, secondary: full, relative } : { primary: full, secondary: null, relative: null };
}

/**
 * 日期区间：
 *   同一天        '1月10日'
 *   同月          '1月10日–13日'
 *   跨月          '1月30日–2月2日'
 *   跨年          '2026年12月30日–2027年1月2日'
 *   不是今年      '2027年1月10日–13日'（year: 'auto' 时，两端同年且不是今年，年份只写一次）
 * @param {{ timeZone?: string, at?: Date, year?: 'auto'|'always'|'never', weekday?: boolean }} [o]
 *   weekday：两端都带星期，改用带空格的分隔：'1月10日 周日 – 1月13日 周三'
 */
export function formatDateRange(start, end, { timeZone, at, year = 'auto', weekday = false } = {}) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a && !b) return '';
  if (!a || !b) return formatDate(a ? start : end, { timeZone, at, year, weekday });
  const [s, e, ps, pe] = compareDates(start, end) <= 0 ? [start, end, a, b] : [end, start, b, a];
  const thisYear = parseDate(today(timeZone, at)).year;
  const crossYear = ps.year !== pe.year;
  const showYear = year === 'always' || crossYear || (year === 'auto' && ps.year !== thisYear);
  if (weekday) {
    const left = formatDate(s, { timeZone, at, year: showYear ? 'always' : 'never' });
    const right = formatDate(e, { timeZone, at, year: crossYear ? 'always' : 'never' });
    return s === e ? left : `${left} – ${right}`;
  }
  const head = `${showYear ? `${ps.year}年` : ''}${ps.month}月${ps.day}日`;
  if (s === e) return head;
  if (crossYear) return `${head}–${pe.year}年${pe.month}月${pe.day}日`;
  if (ps.month === pe.month) return `${head}–${pe.day}日`;
  return `${head}–${pe.month}月${pe.day}日`;
}

/** 行程长度：('2027-01-10', '2027-01-13') → '4 天 3 晚'；同一天 → '1 天' */
export function formatTripLength(start, end) {
  if (!isValidDate(start) || !isValidDate(end)) return '';
  const nights = Math.abs(daysBetween(start, end));
  return nights ? `${nights + 1} 天 ${nights} 晚` : '1 天';
}

// ---------------------------------------------------------------------
// 时刻（timestamptz）显示
// ---------------------------------------------------------------------

/** 时刻在某时区的钟点 'HH:MM'；无效返回 '' */
export function formatClock(at, timeZone) {
  const d = toInstant(at);
  return d ? zonedParts(d, timeZone).time : '';
}

/**
 * 时刻显示：日期 + 钟点。
 *   formatInstant('2027-01-10T00:05:00Z', { timeZone: 'Asia/Hong_Kong' }) → '1月10日 08:05'（不是今年会带年份）
 *   relative: true 时今天/明天/昨天用叫法：'今天 08:05'
 * @param {object} [o]
 * @param {string} o.timeZone        显示用的时区（bookings.start_tz / trips.timezone）
 * @param {boolean} [o.date=true]    带日期
 * @param {boolean} [o.weekday=false]
 * @param {boolean} [o.relative=false]
 * @param {'auto'|'always'|'never'} [o.year='auto']
 * @param {Date} [o.at]
 */
export function formatInstant(at, { timeZone, date = true, weekday = false, relative = false, year = 'auto', at: base } = {}) {
  const d = toInstant(at);
  if (!d) return '';
  const p = zonedParts(d, timeZone);
  if (!date) return p.time;
  return `${formatDate(p.date, { timeZone, weekday, relative, year, at: base })} ${p.time}`;
}

/**
 * 时刻的钟点 + 相对参考日期偏了几天（航班落地“次日”、红眼航班）：
 *   instantTimeParts('2027-01-10T17:30:00Z', 'Asia/Ho_Chi_Minh', '2027-01-10') → { time: '00:30', shift: 1, shiftLabel: '次日' }
 * shiftLabel：0 → ''，1 → '次日'，-1 → '前一天'，其他 → '+2 天' / '−2 天'
 */
export function instantTimeParts(at, timeZone, refDate) {
  const d = toInstant(at);
  if (!d) return { time: '', shift: 0, shiftLabel: '' };
  const p = zonedParts(d, timeZone);
  const shift = isValidDate(refDate) ? daysBetween(refDate, p.date) : 0;
  return { time: p.time, date: p.date, shift, shiftLabel: dayShiftLabel(shift) };
}

/** 0 → ''，1 → '次日'，-1 → '前一天'，2 → '+2 天'，-3 → '−3 天' */
export function dayShiftLabel(shift) {
  if (!shift) return '';
  if (shift === 1) return '次日';
  if (shift === -1) return '前一天';
  return `${shift > 0 ? '+' : '−'}${Math.abs(shift)} 天`;
}

// ---------------------------------------------------------------------
// 钟点（time 列）
// ---------------------------------------------------------------------

/** 'HH:MM' / 'HH:MM:SS' / 'H:MM' → 当天的第几分钟（0–1439）；数字原样当分钟；无效返回 null */
export function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? ((Math.round(value) % 1440) + 1440) % 1440 : null;
  const m = TIME_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 24 || min > 59 || s > 59 || (h === 24 && (min || s))) return null;
  return (h * 60 + min) % 1440;
}

function secondsOf(value) {
  const m = TIME_RE.exec(String(value ?? '').trim());
  return m && m[3] !== undefined ? Number(m[3]) : 0;
}

/** 分钟数 → 'HH:MM'（超过 24 小时取余，负数从前一天倒推） */
export function minutesToTime(minutes) {
  if (!Number.isFinite(minutes)) return '';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 钟点显示：'09:05:00' → '09:05'；'9:05' → '09:05'；无效 → '' */
export function formatTime(value) {
  const m = parseTime(value);
  return m === null ? '' : minutesToTime(m);
}

/** end 比 start 早（或相等以外的更小）= 跨过午夜 */
export function isOvernight(start, end) {
  const a = parseTime(start);
  const b = parseTime(end);
  return a !== null && b !== null && b < a;
}

/** 两个钟点之间的分钟数，跨午夜自动加一天：('22:00', '01:30') → 210；任一无效返回 null */
export function timeSpanMinutes(start, end) {
  const a = parseTime(start);
  const b = parseTime(end);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + 1440 - a;
}

/**
 * 钟点区间：
 *   ('09:30', '11:00') → '09:30–11:00'
 *   ('22:00', '01:30') → '22:00–次日 01:30'
 *   ('09:30', null)    → '09:30'
 *   (null, '11:00')    → '至 11:00'
 */
export function formatTimeRange(start, end, { nextDayLabel = '次日' } = {}) {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) {
    if (s === e) return s;
    return `${s}–${isOvernight(start, end) ? `${nextDayLabel} ` : ''}${e}`;
  }
  if (s) return s;
  if (e) return `至 ${e}`;
  return '';
}

/**
 * 时间轴条目的时间显示（items 的 start_time / end_time / time_label）：
 *   { start_time: '09:30', end_time: '11:00', time_label: '上午' } → { main: '09:30–11:00', sub: '上午' }
 *   { time_label: '傍晚' }                                       → { main: '傍晚', sub: null }
 *   都没有                                                         → { main: '', sub: null }
 */
export function formatItemTime(item) {
  const range = formatTimeRange(item?.start_time, item?.end_time);
  const label = String(item?.time_label || '').trim() || null;
  if (range) return { main: range, sub: label };
  return { main: label || '', sub: null };
}

// ---------------------------------------------------------------------
// 时长
// ---------------------------------------------------------------------

/**
 * 时长（输入单位：分钟，可以有小数）：
 *   long（默认）：'45 分钟'、'1 小时 20 分钟'、'2 小时'、'1 天 3 小时'
 *   short：       '45 分钟'、'1 小时 20 分'、'2 小时'、'1 天 3 小时'（跟在“步行”“打车”后面更紧凑）
 * 0 → '0 分钟'；0 < x < 0.5 → '不到 1 分钟'；负数前面加 '−'；无效 → '—'。
 * 超过一天时不再显示分钟（按小时四舍五入）。
 */
export function formatDuration(minutes, { style = 'long' } = {}) {
  const n = Number(minutes);
  if (minutes === null || minutes === undefined || minutes === '' || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const total = Math.round(abs);
  if (total === 0) return abs > 0 ? `${sign}不到 1 分钟` : '0 分钟';
  const minuteWord = style === 'short' ? '分' : '分钟';
  if (total >= 1440) {
    const hoursTotal = Math.round(total / 60);
    const d = Math.floor(hoursTotal / 24);
    const h = hoursTotal % 24;
    return `${sign}${d} 天${h ? ` ${h} 小时` : ''}`;
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${sign}${h} 小时 ${m} ${minuteWord}`;
  if (h) return `${sign}${h} 小时`;
  return `${sign}${m} 分钟`;
}

/** 两个时刻之间的时长（b − a） */
export function formatDurationBetween(a, b, opts) {
  const x = toInstant(a);
  const y = toInstant(b);
  if (!x || !y) return '—';
  return formatDuration((y - x) / MINUTE, opts);
}

// ---------------------------------------------------------------------
// 相对时间（“3 分钟前”）
// ---------------------------------------------------------------------

/**
 * 相对时间：
 *   < 45 秒            '刚刚'
 *   < 1 小时           '3 分钟前' / '3 分钟后'
 *   < 6 小时           '2 小时前' / '2 小时后'
 *   今天/昨天/明天      '今天 09:15' / '昨天 14:30' / '明天 08:00'
 *   7 天以内           '3 天前' / '3 天后'
 *   更早/更晚          '10月3日'（不是今年带年份）
 * @param {Date|string|number} at
 * @param {{ now?: Date, timeZone?: string }} [o] timeZone 决定“今天/昨天”的边界（默认设备时区）
 */
export function formatRelativeTime(at, { now: base, timeZone } = {}) {
  const d = toInstant(at);
  if (!d) return '';
  const ref = toInstant(base) || now();
  const diff = d.getTime() - ref.getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < 45_000) return '刚刚';
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / MINUTE))} 分钟${future ? '后' : '前'}`;
  if (abs < 6 * HOUR) return `${Math.round(abs / HOUR)} 小时${future ? '后' : '前'}`;
  const tz = zoneOr(timeZone);
  const p = zonedParts(d, tz);
  const refDate = zonedParts(ref, tz).date;
  const dayDiff = daysBetween(refDate, p.date);
  if (dayDiff === 0) return `今天 ${p.time}`;
  if (dayDiff === -1) return `昨天 ${p.time}`;
  if (dayDiff === 1) return `明天 ${p.time}`;
  if (Math.abs(dayDiff) < 7) return `${Math.abs(dayDiff)} 天${future ? '后' : '前'}`;
  return formatDate(p.date, { weekday: false, year: 'auto', timeZone: tz, at: ref });
}

/**
 * “更新于”说明：'刚刚更新' / '3 分钟前更新' / '昨天 14:30 更新' / '10月3日更新'。无效时间返回 ''。
 */
export function formatUpdatedAt(at, opts) {
  const rel = formatRelativeTime(at, opts);
  if (!rel) return '';
  if (rel === '刚刚') return '刚刚更新';
  return /\d$/.test(rel) ? `${rel} 更新` : `${rel}更新`;
}

// ---------------------------------------------------------------------
// 行程：第几天、阶段、倒计时
// ---------------------------------------------------------------------

/** 第几天（从 1 开始）：days.date − trips.start_date + 1 */
export function tripDayNumber(date, startDate) {
  if (!isValidDate(date) || !isValidDate(startDate)) return null;
  return daysBetween(startDate, date) + 1;
}

/**
 * 行程阶段（按行程时区的“今天”对比开始 / 结束日期；trips.status 是手动状态，和这个无关）。
 * @param {{ start_date?: string, end_date?: string, timezone?: string }} trip
 * @param {Date} [at]
 * @returns {{ phase: 'upcoming'|'ongoing'|'ended'|'undated', today: string, totalDays: number|null,
 *             dayNumber: number|null, daysUntilStart: number|null, daysSinceEnd: number|null }}
 */
export function tripPhase(trip, at = now()) {
  const tz = trip?.timezone || HOME_TIME_ZONE;
  const t = today(tz, at);
  const start = isValidDate(trip?.start_date) ? trip.start_date : null;
  const end = isValidDate(trip?.end_date) ? trip.end_date : start;
  const base = { today: t, totalDays: null, dayNumber: null, daysUntilStart: null, daysSinceEnd: null };
  if (!start) return { phase: 'undated', ...base };
  const totalDays = daysBetween(start, end) + 1;
  const untilStart = daysBetween(t, start);
  const sinceEnd = daysBetween(end, t);
  if (untilStart > 0) return { ...base, phase: 'upcoming', totalDays, daysUntilStart: untilStart };
  if (sinceEnd > 0) return { ...base, phase: 'ended', totalDays, daysSinceEnd: sinceEnd };
  return { ...base, phase: 'ongoing', totalDays, dayNumber: daysBetween(start, t) + 1 };
}

/**
 * 行程阶段的一句话：
 *   还没开始：'明天出发' / '还有 3 天出发'
 *   进行中：  '第 2 天 · 共 4 天' / '最后一天'
 *   已结束：  '昨天结束' / '已结束 5 天' / '已结束'（超过 30 天）
 *   没日期：  '日期未定'
 */
export function formatTripPhase(trip, at = now()) {
  const p = tripPhase(trip, at);
  switch (p.phase) {
    case 'upcoming':
      return p.daysUntilStart === 1 ? '明天出发' : `还有 ${p.daysUntilStart} 天出发`;
    case 'ongoing':
      if (p.totalDays > 1 && p.dayNumber === p.totalDays) return `最后一天 · 共 ${p.totalDays} 天`;
      return `第 ${p.dayNumber} 天 · 共 ${p.totalDays} 天`;
    case 'ended':
      if (p.daysSinceEnd === 1) return '昨天结束';
      return p.daysSinceEnd <= 30 ? `已结束 ${p.daysSinceEnd} 天` : '已结束';
    default:
      return '日期未定';
  }
}
