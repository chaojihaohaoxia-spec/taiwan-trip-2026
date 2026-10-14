// =====================================================================
// lib/clock.js：统一的“现在”和“某个时区的今天”。
//
// 规则：凡是和“现在”有关的逻辑（今天是第几天、下一项、倒计时、行程阶段），
// 一律用 now() / todayIn(tz)，不要直接 new Date() / Date.now()。
// 这样本机测试时可以用网址 ?now=2027-01-11T10:00:00+07:00 把时间拨到行程当中，
// 截图和 e2e 都可重复。线上忽略 ?now=。
// =====================================================================

import { isLocalhost, searchParam } from './env.js';

let offsetMs = 0;

function initOverride() {
  if (typeof window === 'undefined' || !isLocalhost()) return;
  const raw = searchParam('now');
  if (!raw) return;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    console.warn(`[clock] 忽略无法解析的 ?now=${raw}（要带时区，如 2027-01-11T10:00:00+07:00）`);
    return;
  }
  offsetMs = t - Date.now();
}
initOverride();

/** 现在（Date）。本机带 ?now= 时是拨过的时间，并且照常往前走。 */
export function now() {
  return new Date(Date.now() + offsetMs);
}

/** 测试用：把时间拨到某个时刻（传 null 恢复真实时间） */
export function setNowForTesting(dateOrNull) {
  offsetMs = dateOrNull ? new Date(dateOrNull).getTime() - Date.now() : 0;
}

/**
 * 某个 IANA 时区里的“今天”，返回 'YYYY-MM-DD'。
 * @param {string} timeZone 例如 'Asia/Ho_Chi_Minh'
 * @param {Date} [at]
 */
export function todayIn(timeZone, at = now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 两个 'YYYY-MM-DD' 相差几天（b − a） */
export function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
