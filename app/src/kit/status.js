// =====================================================================
// kit/status.js：各种状态的中文名、语气、图标，免费取消截止的倒计时说法（纯函数，Node 里能直接测）。
//
//   statusInfo('booking', 'pending')       → { label: '待确认', tone: 'warning', glyph: 'clock' }
//   statusInfo('payment', 'pay_at_property') → { label: '到店付', tone: 'info', glyph: 'wallet' }
//   statusInfo('item', 'done')             → { label: '已完成', tone: 'success', glyph: 'check' }
//   formatLeft(2 * 86400000 + 3 * 3600000) → '2 天 3 小时'
//   freeCancelInfo('2027-01-09T16:59:00Z', { at })  → { state: 'soon', tone: 'warning', label: '免费取消还剩 1 天 20 小时', short: '还剩 1 天 20 小时', … }（≤48 小时警示、≤24 小时红色）
//   phaseInfo(trip, at)                    → { phase: 'upcoming', label: '出发前', tone: 'info', detail: '还有 3 天出发' }
//
// 语气（tone）和 ui/Badge、overlay Toast 同一套词：neutral / accent / success / warning / danger / info。
// =====================================================================

import { now as clockNow } from '../lib/clock.js';
import { formatInstant, tripPhase, formatTripPhase, zonedParts, addDays, formatDate, weekdayName } from '../lib/datetime.js';

const S = (label, tone, glyph = null) => Object.freeze({ label, tone, glyph });

/** 每类状态的取值 → { label, tone, glyph }（取值和 data/schema.js 的 ENUMS 一致，单元测试核对） */
export const STATUS = Object.freeze({
  /** bookings.status */
  booking: Object.freeze({
    idea: S('还没订', 'neutral', 'pen'),
    pending: S('待确认', 'warning', 'clock'),
    booked: S('已订', 'success', 'check'),
    cancelled: S('已取消', 'neutral', 'x'),
  }),
  /** bookings.payment_status */
  payment: Object.freeze({
    unpaid: S('未付款', 'warning', 'wallet'),
    paid: S('已付', 'success', 'check'),
    partial: S('付了订金', 'info', 'wallet'),
    pay_at_property: S('到店付', 'info', 'wallet'),
    free: S('免费', 'success', 'check'),
    refunded: S('已退款', 'neutral', 'swap'),
  }),
  /** items.status */
  item: Object.freeze({
    planned: S('计划中', 'neutral', 'clock'),
    done: S('已完成', 'success', 'check'),
    skipped: S('已跳过', 'neutral', 'x'),
  }),
  /** trips.status（手动状态；“进行中 / 已结束”看 phaseInfo） */
  trip: Object.freeze({
    planning: S('规划中', 'neutral', 'pen'),
    ready: S('准备好了', 'success', 'check'),
    done: S('已完成', 'neutral', 'check'),
    archived: S('已归档', 'neutral', 'book'),
  }),
});

/** 状态 → { label, tone, glyph }；不认识的取值原样显示、中性语气 */
export function statusInfo(kind, value) {
  const table = STATUS[kind];
  if (table && Object.hasOwn(table, value)) return table[value];
  return S(value ? String(value) : '—', 'neutral');
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 剩下的时间说成中文：
 *   ≥ 3 天 '5 天'；1–3 天 '2 天 3 小时'（整天时只说天）；3 小时–1 天 '5 小时'；1–3 小时 '1 小时 20 分'；< 1 小时 '35 分钟'；< 1 分钟 '不到 1 分钟'
 * @param {number} ms 正数
 */
export function formatLeft(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v >= 3 * DAY) return `${Math.floor(v / DAY)} 天`;
  if (v >= DAY) {
    const d = Math.floor(v / DAY);
    const h = Math.floor((v - d * DAY) / HOUR);
    return h ? `${d} 天 ${h} 小时` : `${d} 天`;
  }
  if (v >= 3 * HOUR) return `${Math.floor(v / HOUR)} 小时`;
  if (v >= HOUR) {
    const h = Math.floor(v / HOUR);
    const m = Math.floor((v - h * HOUR) / MINUTE);
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  if (v >= MINUTE) return `${Math.floor(v / MINUTE)} 分钟`;
  return '不到 1 分钟';
}

/**
 * 截止时刻的写法：一般是「1月9日 23:59」；正好零点时写成前一天的「24:00（周五深夜）」——
 * 「10月17日 00:00 前」很容易读成 17 号全天都行（10-14 现场走查 P2-12）。
 * @param {string|Date} until
 * @param {{ timeZone?: string, at?: Date, year?: 'auto'|'always'|'never' }} [o]
 */
export function deadlineWhen(until, { timeZone, at = clockNow(), year = 'never' } = {}) {
  let p = null;
  try {
    p = zonedParts(until, timeZone);
  } catch {
    return '';
  }
  if (p.time === '00:00') {
    const prev = addDays(p.date, -1);
    return `${formatDate(prev, { timeZone, weekday: false, year, at })} 24:00（${weekdayName(prev)}深夜）`;
  }
  return formatInstant(until, { timeZone, year, at });
}

/** 免费取消：多久以内算“快到了”（警示色）、多久以内算“马上”（红色）——全站一套（预订页、概览、每天页、预订详情） */
export const FREE_CANCEL_WARN_MS = 48 * HOUR;
export const FREE_CANCEL_URGENT_MS = 24 * HOUR;

/**
 * 免费取消截止的说法和语气（全站一套，预订页的 freeCancelState 也用它）。
 *   > 48 小时   state 'later'   tone info     「1月9日 23:59 前可免费取消」
 *   ≤ 48 小时   state 'soon'    tone warning  「免费取消还剩 1 天 20 小时」
 *   ≤ 24 小时   state 'urgent'  tone danger   「免费取消还剩 5 小时」
 *   已经过了     state 'passed'  tone neutral  「已不可免费取消」
 * 给了 start（预订开始的时刻）且已经开始了 → null：那时候再说能不能免费取消没有意义。
 * @param {string|Date} until  bookings.free_cancel_until（时刻）
 * @param {{ at?: Date, timeZone?: string, start?: string|Date|null }} [o] timeZone：显示日期用的时区（预订的 start_tz 或行程时区）
 * @returns {null | { state: 'passed'|'urgent'|'soon'|'later', tone: string, glyph: string, label: string, short: string, msLeft: number, at: string, when: string, left: string|null }}
 */
export function freeCancelInfo(until, { at = clockNow(), timeZone, start } = {}) {
  if (!until) return null;
  const end = new Date(until).getTime();
  if (Number.isNaN(end)) return null;
  if (start) {
    const s = new Date(start).getTime();
    if (!Number.isNaN(s) && s <= at.getTime()) return null;
  }
  const left = end - at.getTime();
  const when = deadlineWhen(until, { timeZone, year: 'never', at });
  const out = (state, tone, glyph, label, short, rest) => ({ state, tone, glyph, label, short, msLeft: left, at: when, when, left: rest });
  if (left <= 0) return out('passed', 'neutral', 'x', '已不可免费取消', '已不可免费取消', null);
  const rest = formatLeft(left);
  if (left <= FREE_CANCEL_URGENT_MS) return out('urgent', 'danger', 'clock', `免费取消还剩 ${rest}`, `还剩 ${rest}`, rest);
  if (left <= FREE_CANCEL_WARN_MS) return out('soon', 'warning', 'clock', `免费取消还剩 ${rest}`, `还剩 ${rest}`, rest);
  const sp = when.endsWith('）') ? '' : ' ';
  return out('later', 'info', 'check-circle', `${when}${sp}前可免费取消`, `${when}${sp}前`, rest);
}

/** 行程阶段的说法（概览页小字「出发前 / 进行中 / 回顾」，SPEC §4） */
export const PHASE = Object.freeze({
  upcoming: S('出发前', 'info', 'plane'),
  ongoing: S('进行中', 'accent', 'route'),
  ended: S('回顾', 'neutral', 'book'),
  undated: S('日期未定', 'neutral', 'clock'),
});

/**
 * @param {object} trip trips 行（start_date / end_date / timezone）
 * @param {Date} [at]
 * @returns {{ phase: string, label: string, tone: string, glyph: string, detail: string }}
 */
export function phaseInfo(trip, at = clockNow()) {
  const p = tripPhase(trip, at).phase;
  return { phase: p, ...PHASE[p], detail: formatTripPhase(trip, at) };
}
