// =====================================================================
// kit/rating.js：评级五档（纯函数，Node 里能直接测）。地点页、地点详情、写评级、行程概览「评级最高」都用这一套。
//
//   RATING_TIERS / ratingName(5) → '夯'      五档：5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了（reviews.rating 1–5，docs/数据结构.md B4.13）
//   isRating(v)                              1–5 的整数才算评了级（rating 可以是 null：只写了评语）
//   ratingSummary(reviews)                   几个人评了、平均分、落在哪一档、最高分
//   reviewHasContent(r)                      这条评级有没有东西（档位、评语、吃了什么、买了什么、照片）
//
// 颜色：--color-rating-1…5（白字 --color-on-rating），胶囊见 kit/RatingChips.jsx。
// =====================================================================

/** 五档，从高到低（显示顺序）；hint 是选中后下面那行小字 */
export const RATING_TIERS = Object.freeze([
  Object.freeze({ value: 5, label: '夯', hint: '好到离谱，必须再来' }),
  Object.freeze({ value: 4, label: '顶级', hint: '很好，值得推荐' }),
  Object.freeze({ value: 3, label: '人上人', hint: '还不错，比一般好' }),
  Object.freeze({ value: 2, label: 'NPC', hint: '普普通通，没什么记忆点' }),
  Object.freeze({ value: 1, label: '拉完了', hint: '踩雷了，别再来' }),
]);

const NAMES = Object.freeze(Object.fromEntries(RATING_TIERS.map((t) => [t.value, t.label])));

/** 1–5 的整数才算评了级（reviews.rating 可以是 null：只写了评语） */
export function isRating(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** 5 → '夯'；不是 1–5 → null */
export function ratingName(value) {
  return isRating(value) ? NAMES[value] : null;
}

/**
 * 一个地点的评级概况。tier = 平均分四舍五入（4.5 → 5：两个人一个夯一个顶级，算夯）。
 * @param {object[]} reviews 这个地点的评级
 * @returns {{ count: number, avg: number|null, tier: number|null, best: number|null }}
 */
export function ratingSummary(reviews = []) {
  const rated = reviews.filter((r) => r && isRating(r.rating));
  if (!rated.length) return { count: 0, avg: null, tier: null, best: null };
  const sum = rated.reduce((s, r) => s + r.rating, 0);
  const avg = sum / rated.length;
  return { count: rated.length, avg, tier: Math.min(5, Math.max(1, Math.round(avg))), best: Math.max(...rated.map((r) => r.rating)) };
}

/** 这条评级有没有写东西（档位、评语、吃了什么、买了什么、照片——什么都没有的不显示） */
export function reviewHasContent(r) {
  if (!r) return false;
  return isRating(r.rating) || Boolean(String(r.notes || '').trim()) || (r.food_log || []).length > 0 || (r.shop_log || []).length > 0 || (r.photos || []).length > 0;
}
