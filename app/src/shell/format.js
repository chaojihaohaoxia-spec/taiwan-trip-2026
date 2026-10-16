// =====================================================================
// shell/format.js：外壳用到的文字格式（纯函数，Node 里能直接测；首屏代码，故意不引 lib/datetime.js）。
//
//   splitTripTitle('富国岛 · 重阳 3 晚')         → { short: '富国岛', rest: '重阳 3 晚' }
//   dayLabel('2026-10-16')                       → { md: '10-16', day: '16', weekday: '周五' }
//   dateRangeLabel('2026-10-16', '2026-10-19', { thisYear: 2026 }) → '10-16 周五 – 10-19 周一'
//   tripSubtitle(trip, { thisYear })             → '重阳 3 晚 · 10-16 周五 – 10-19 周一'
//   switcherDates(trip, { thisYear })            → '10-16 周五 – 10-19 周一 · 3 晚'
//   phaseChip(phase)                             → { tone: 'accent', text: '5 天后出发' }
//   overviewLabel('upcoming')                    → '出发前'
//
// 大标题只用行程名的第一段（「富国岛 · 重阳 3 晚」的「富国岛」），后面那段放到副标题最前面——
// 样稿的「富国岛」+「重阳三晚 · 10-16 周五 – 10-19 周一」。日期用数字（系统字体等宽数字）。
// =====================================================================

export const WEEKDAYS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → { y, m, d }；不合法返回 null */
export function parseYmd(s) {
  const m = YMD.exec(String(s || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d, wd: t.getUTCDay() };
}

const pad = (n) => String(n).padStart(2, '0');

/** 一个日期的几种写法：{ md: '10-16', day: '16', weekday: '周五', year } */
export function dayLabel(s) {
  const p = parseYmd(s);
  if (!p) return { md: '', day: '', weekday: '', year: null };
  return { md: `${pad(p.m)}-${pad(p.d)}`, day: String(p.d), weekday: WEEKDAYS[p.wd], year: p.y };
}

/** 两个日期之间差几天（b − a） */
export function daysBetween(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

// 行程名的拆法在 lib/trip-title.js（行程概览的回顾大卡也用），这里转出去保持原来的引用方式
export { splitTripTitle } from '../lib/trip-title.js';
import { splitTripTitle } from '../lib/trip-title.js';

/**
 * 日期区间：'10-16 周五 – 10-19 周一'。不是今年的写上年份：'2027-01-10 周日 – 01-13 周三'；
 * 跨年两头都写年份；同一天只写一个。
 * @param {string} start
 * @param {string} end
 * @param {{ thisYear?: number|null }} [o]
 */
export function dateRangeLabel(start, end, { thisYear = null } = {}) {
  const a = dayLabel(start);
  const b = dayLabel(end || start);
  if (!a.md) return b.md ? `${b.md} ${b.weekday}` : '';
  const showYear = thisYear !== null && (a.year !== thisYear || (b.year && b.year !== thisYear));
  const left = `${showYear ? `${a.year}-` : ''}${a.md} ${a.weekday}`;
  if (!b.md || (start === end) || !end) return left;
  const right = `${b.year !== a.year ? `${b.year}-` : ''}${b.md} ${b.weekday}`;
  return `${left} – ${right}`;
}

/**
 * 顶栏副标题：行程名的后半段 + 日期区间（样稿「重阳三晚 · 10-16 周五 – 10-19 周一」）。
 * 没写日期：只有后半段；后半段也没有：「日期未定」。
 */
export function tripSubtitle(trip, { thisYear = null } = {}) {
  if (!trip) return '';
  const { rest } = splitTripTitle(trip.title);
  const range = trip.start_date ? dateRangeLabel(trip.start_date, trip.end_date || trip.start_date, { thisYear }) : '';
  const parts = [rest, range].filter(Boolean);
  return parts.length ? parts.join(' · ') : '日期未定';
}

/** 几晚 */
export function nightsOf(trip) {
  if (!trip?.start_date) return null;
  const n = daysBetween(trip.start_date, trip.end_date || trip.start_date);
  return n === null ? null : Math.max(0, n);
}

/**
 * 行程切换面板里的日期行：'10-16 周五 – 10-19 周一 · 3 晚'（和顶栏副标题、全部行程同一种写法：
 * 不是今年的写上年份，跨年两头都写；一天的不写晚数；没日期「日期未定」）
 * @param {object} trip
 * @param {{ thisYear?: number|null }} [o]
 */
export function switcherDates(trip, { thisYear = null } = {}) {
  if (!parseYmd(trip?.start_date)) return '日期未定';
  const range = dateRangeLabel(trip.start_date, trip.end_date || trip.start_date, { thisYear });
  const n = nightsOf(trip);
  return n ? `${range} · ${n} 晚` : range;
}

/**
 * 行程阶段的小标签（切换面板、菜单用）。phase 是 data/selectors.js 的 tripPhase() 结果：
 *   { phase: 'upcoming'|'ongoing'|'ended'|'undated', daysUntilStart, dayNumber, totalDays, daysSinceEnd }
 * @returns {{ tone: 'accent'|'success'|'neutral', text: string }}
 */
export function phaseChip(phase) {
  switch (phase?.phase) {
    case 'upcoming':
      return { tone: 'accent', text: phase.daysUntilStart === 1 ? '明天出发' : `${phase.daysUntilStart} 天后出发` };
    case 'ongoing':
      return {
        tone: 'success',
        text: phase.totalDays > 1 && phase.dayNumber === phase.totalDays ? '进行中 · 最后一天' : `进行中 · 第 ${phase.dayNumber} 天`,
      };
    case 'ended':
      return { tone: 'neutral', text: '已结束 · 回顾' };
    default:
      return { tone: 'neutral', text: '日期未定' };
  }
}

/**
 * 顶栏胶囊里行程名后面的短语（样稿「富国岛 · 5 天后出发」「台湾 · 回顾」）：
 *   出发前 'N 天后出发' / '明天出发'；进行中 '第 N 天' / '最后一天'；结束 '回顾'；日期未定 null（只写行程名）
 */
export function pillPhrase(phase) {
  switch (phase?.phase) {
    case 'upcoming':
      return phase.daysUntilStart === 1 ? '明天出发' : `${phase.daysUntilStart} 天后出发`;
    case 'ongoing':
      return phase.totalDays > 1 && phase.dayNumber === phase.totalDays ? '最后一天' : `第 ${phase.dayNumber} 天`;
    case 'ended':
      return '回顾';
    default:
      return null;
  }
}

/** 天数分段条「概览」格上方的小字：出发前 / 进行中 / 回顾 */
export function overviewLabel(phase) {
  if (phase === 'ongoing') return '进行中';
  if (phase === 'ended') return '回顾';
  if (phase === 'upcoming') return '出发前';
  return '计划中';
}
