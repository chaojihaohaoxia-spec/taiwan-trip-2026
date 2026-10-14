// =====================================================================
// kit/day-tone.js：第几天的颜色（全站一套，视觉评审 P1-2）。
//
//   dayToneIndex(n)  → 1…7（7 天一轮）；n 不合法 → 8（灰，没排进哪天）
//   dayTone(n)       → 'var(--color-day-N)'       跟主题走：浅色是深色调、深色模式是浅色调（图钉、路线、小点；字用 --color-text-inverse）
//   dayToneDeep(n)   → 'var(--color-day-N-deep)'  两种主题一样的深色调（白字压在色块上的徽章用）
//
// 顺序（tokens.css）：青、蓝、珊瑚、紫、玫红、琥珀、绿——概览的 D1–D4 徽章和地图的图钉、筛选条小点同一天同一个颜色。
// =====================================================================

/** 一轮几种颜色 */
export const DAY_TONE_COUNT = 7;
/** 没排进哪天（灰） */
export const NEUTRAL_DAY_TONE = 8;

/** 第 n 天（从 1 起）→ 颜色编号 1–7；n 不合法时 8（灰） */
export function dayToneIndex(n) {
  const k = Number(n);
  if (!Number.isInteger(k) || k < 1) return NEUTRAL_DAY_TONE;
  return ((k - 1) % DAY_TONE_COUNT) + 1;
}

/** 跟主题走的那一份（CSS 值） */
export function dayTone(n) {
  const i = dayToneIndex(n);
  return i === NEUTRAL_DAY_TONE ? 'var(--color-cat-8)' : `var(--color-day-${i})`;
}

/** 两种主题都一样的深色调（CSS 值；白字压在上面） */
export function dayToneDeep(n) {
  const i = dayToneIndex(n);
  return i === NEUTRAL_DAY_TONE ? 'var(--color-cat-8)' : `var(--color-day-${i}-deep)`;
}
