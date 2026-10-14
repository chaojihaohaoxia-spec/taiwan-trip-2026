// =====================================================================
// sheets/photo/gestures.js：看大图的几何和手势判定（纯函数，Node 里能直接测）。
//
// 坐标约定（都是视口坐标，px）：
//   V = { width, height }                       视口
//   F = { left, top, width, height }            “照片框”：照片等比放进屏幕（contain）后的位置和大小，放大 / 拖动都以它为基准
//   z = { s, x, y }                             放大层的变换：translate(x, y) scale(s)，transform-origin 0 0（相对照片框）
//                                               → 照片此刻在屏幕上的矩形 = (F.left + x, F.top + y, F.width·s, F.height·s)
//   fly = { x, y, s, ix, iy, r }                照片框自己的变换（打开 / 关闭的 FLIP、往下拉关闭），和 motion/flip.js 的 crop 模式同一套数值：
//                                               translate(x, y) scale(s)、clip-path: inset(iy ix iy ix round r/s)，transform-origin 0 0
// =====================================================================

import { clamp } from '../../motion/physics.js';

/** 最大放大倍数、双击放大到多少 */
export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
/** 两张照片之间的空隙（px，左右滑时看得到一条缝） */
export const SLIDE_GAP = 20;
/** 判定开始拖动的距离（px） */
export const DRAG_SLOP = 8;
/** 双击：两次点按的最长间隔（ms）和最远距离（px） */
export const DOUBLE_TAP_MS = 280;
export const DOUBLE_TAP_DIST = 32;
/** 往下拉关闭：距离 / 速度阈值 */
export const DISMISS_DISTANCE = 110;
export const DISMISS_VELOCITY = 650;
/** 左右滑换张：距离（占屏宽的比例）/ 速度阈值 */
export const SWIPE_RATIO = 0.22;
export const SWIPE_VELOCITY = 380;

/**
 * 照片等比放进一块区域（contain），居中。
 * @param {number} ratio 宽 / 高
 * @param {{ width: number, height: number }} V
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [pad] 四周留白（安全区）
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function containRect(ratio, V, pad = {}) {
  const t = pad.top || 0;
  const r = pad.right || 0;
  const b = pad.bottom || 0;
  const l = pad.left || 0;
  const aw = Math.max(1, V.width - l - r);
  const ah = Math.max(1, V.height - t - b);
  const k = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  let width = aw;
  let height = aw / k;
  if (height > ah) {
    height = ah;
    width = ah * k;
  }
  return { left: l + (aw - width) / 2, top: t + (ah - height) / 2, width, height };
}

/**
 * 放大后能平移的范围：照片比屏幕窄时居中不能动；比屏幕宽时左右边不能离开屏幕边。
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number }}
 */
export function panBounds(F, s, V) {
  const w = F.width * s;
  const h = F.height * s;
  const bx = w <= V.width ? [(V.width - w) / 2 - F.left, (V.width - w) / 2 - F.left] : [V.width - w - F.left, -F.left];
  const by = h <= V.height ? [(V.height - h) / 2 - F.top, (V.height - h) / 2 - F.top] : [V.height - h - F.top, -F.top];
  return { minX: bx[0], maxX: bx[1], minY: by[0], maxY: by[1] };
}

/** 把平移夹回范围里（缩放不变） */
export function clampPan(z, F, V) {
  const b = panBounds(F, z.s, V);
  return { s: z.s, x: clamp(z.x, b.minX, b.maxX), y: clamp(z.y, b.minY, b.maxY) };
}

/**
 * 以屏幕上某一点为中心缩放：那一点下面的照片内容缩放前后不动。
 * @param {{ s, x, y }} z
 * @param {number} s1 新的倍数
 * @param {{ x: number, y: number }} point 视口坐标
 */
export function zoomAround(z, s1, point, F) {
  const ux = (point.x - F.left - z.x) / z.s;
  const uy = (point.y - F.top - z.y) / z.s;
  return { s: s1, x: point.x - F.left - ux * s1, y: point.y - F.top - uy * s1 };
}

/**
 * 双指缩放过界时的阻尼：小于 1 倍、大于最大倍数时越捏越费劲（松手后弹回范围里）。
 */
export function rubberZoom(s, min = 1, max = MAX_ZOOM) {
  if (s < min) return min - (1 - 1 / ((min - s) * 1.6 + 1)) * min * 0.45;
  if (s > max) return max + (1 - 1 / ((s - max) / max + 1)) * max * 0.35;
  return s;
}

/** 双击：没放大就以点按的位置放大到 DOUBLE_TAP_ZOOM 倍（夹在范围里）；已经放大就回到 1 倍 */
export function doubleTapZoom(z, point, F, V, target = DOUBLE_TAP_ZOOM) {
  if (z.s > 1.01) return { s: 1, x: 0, y: 0 };
  return clampPan(zoomAround(z, target, point, F), F, V);
}

/** 松手后的缩放落点：小于 1 回到 1（居中）；大于最大值回到最大值（以手指中点为中心）；再把平移夹回范围 */
export function settleZoom(z, point, F, V, max = MAX_ZOOM) {
  if (z.s <= 1.001) return { s: 1, x: 0, y: 0 };
  const s = Math.min(z.s, max);
  const scaled = s === z.s ? z : zoomAround(z, s, point, F);
  return clampPan(scaled, F, V);
}

/**
 * 一次拖动是什么手势（第一次移动超过 DRAG_SLOP 时判定一次）。
 *   没放大：横着为主 → 'swipe'（换张）；竖着往下为主 → 'dismiss'（往下拉关闭）；竖着往上 → 'swipe'（当成没用的拖动，不做事）
 *   放大了：一般是 'pan'；照片左边已经贴着屏幕左边、还往右拉（或右边贴边往左拉），而且横着为主 → 'swipe'（接着换张，和 iOS 照片一样）
 * @returns {'swipe'|'dismiss'|'pan'|null} null = 还没到判定距离
 */
export function classifyDrag({ dx, dy, zoomed = false, atMinX = false, atMaxX = false }) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < DRAG_SLOP) return null;
  const horizontal = ax >= ay;
  if (zoomed) {
    if (horizontal && ((dx > 0 && atMaxX) || (dx < 0 && atMinX))) return 'swipe';
    return 'pan';
  }
  if (horizontal) return 'swipe';
  return dy > 0 ? 'dismiss' : 'swipe';
}

/**
 * 左右滑松手后停在哪一张。
 * @param {{ index: number, count: number, dx: number, vx: number, width: number }} o
 */
export function swipeTarget({ index, count, dx, vx, width }) {
  let next = index;
  const far = Math.abs(dx) > width * SWIPE_RATIO;
  const fast = Math.abs(vx) > SWIPE_VELOCITY && Math.sign(vx) === Math.sign(dx);
  if (far || fast) next = dx < 0 ? index + 1 : index - 1;
  // 反方向甩：留在原地
  if (Math.abs(vx) > SWIPE_VELOCITY && Math.sign(vx) !== Math.sign(dx) && dx !== 0) next = index;
  return clamp(next, 0, Math.max(0, count - 1));
}

/** 往下拉松手：关掉还是弹回 */
export function shouldDismiss({ dy, vy }) {
  if (vy < -300) return false;
  return dy > DISMISS_DISTANCE || (vy > DISMISS_VELOCITY && dy > 24);
}

/**
 * 往下拉的跟手效果：照片跟着手指走、越往下越小（最多缩到 0.72），背景越来越透明。
 * @param {number} dx 手指横向位移
 * @param {number} dy 手指纵向位移（往上拉有阻尼）
 * @param {{ x: number, y: number }} grab 按下的点相对照片框左上角的位置（缩小时这一点留在手指下面）
 * @param {number} height 视口高度
 * @returns {{ fly: { x, y, s, ix, iy, r }, progress: number }}
 */
export function dismissFollow(dx, dy, grab, height) {
  const down = Math.max(0, dy);
  const up = Math.min(0, dy);
  const progress = clamp(down / (height * 0.55), 0, 1);
  const s = 1 - 0.28 * progress;
  const ty = down + (up ? -(1 - 1 / (-up / 160 + 1)) * 60 : 0);
  return {
    fly: { x: dx + grab.x * (1 - s), y: ty + grab.y * (1 - s), s, ix: 0, iy: 0, r: 0 },
    progress,
  };
}

/** 往下拉时背景的透明度（拉得越远越透，露出下面的页面） */
export function backdropOpacity(progress) {
  return clamp(1 - progress * 1.15, 0, 1);
}

/**
 * 照片此刻在屏幕上的矩形 → 照片框的 fly 数值（不裁切）。关闭时从“现在看到的样子”出发缩回缩略图。
 */
export function flyFromRect(rect, F) {
  const s = F.width > 0 ? rect.width / F.width : 1;
  return { x: rect.left - F.left, y: rect.top - F.top, s, ix: 0, iy: 0, r: 0 };
}

/** 放大层 z 和照片框 fly 合起来，照片此刻在屏幕上的矩形 */
export function visualRect(F, z = { s: 1, x: 0, y: 0 }, fly = { x: 0, y: 0, s: 1 }) {
  const w = F.width * z.s * fly.s;
  const h = F.height * z.s * fly.s;
  return { left: F.left + fly.x + z.x * fly.s, top: F.top + fly.y + z.y * fly.s, width: w, height: h };
}

/** 矩形和视口有没有交集（缩略图滚出屏幕时不缩回去，改成淡出） */
export function rectVisible(r, V, margin = 0) {
  return Boolean(r) && r.width > 1 && r.height > 1 && r.left < V.width - margin && r.top < V.height - margin
    && r.left + r.width > margin && r.top + r.height > margin;
}
