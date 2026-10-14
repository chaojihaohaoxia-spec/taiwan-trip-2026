// =====================================================================
// overlay/geometry.js：弹层特有的几何计算（纯函数，不碰 DOM，单元测试直接测）。
//
// 职责：
//   - 矩形小工具；圆角换算转出 motion/physics.js 的 resolveRadius（形变和量按钮用同一个）；
//   - 定位：从按钮长出来的面板、小菜单放在锚点的上方还是下方、左右夹在屏幕内（翻面 + 平移）；
//   - 底部面板松手：按位置和速度选落点（某一档或关闭）；
//   - 键盘高度（visualViewport 推算出被键盘挡住的高度）。
//
// 通用的物理和手势工具不在这里，统一用 motion/physics.js：
//   橡皮筋 rubberBand、惯性投射 projectMomentum、手指速度 VelocityTracker、clamp。
//   形状变形（按钮长成面板、圆形扩散）用 motion/morph.js。
//
// 坐标一律是视口坐标（getBoundingClientRect 的坐标系），单位 px。
// 矩形写法：{ left, top, width, height }（right / bottom 现算）。
// =====================================================================

import { clamp, projectMomentum } from '../motion/physics.js';

/** 圆角换算（'50%'、'999px' → 实际 px）：和形变（motion/morph.js）用同一个 */
export { resolveRadius } from '../motion/physics.js';

/** 把 DOMRect 或类似对象规范成 { left, top, width, height } */
export function toRect(r) {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export const rectRight = (r) => r.left + r.width;
export const rectBottom = (r) => r.top + r.height;
export const rectCenterX = (r) => r.left + r.width / 2;
export const rectCenterY = (r) => r.top + r.height / 2;

/**
 * 从锚点（触发按钮）旁边放一个面板：优先放在指定的一侧，放不下就翻到另一侧；左右夹在屏幕内。
 *
 * @param {Object} p
 * @param {{left:number,top:number,width:number,height:number}} p.anchor  锚点矩形
 * @param {{width:number,height:number}} p.size     面板想要的尺寸（自然尺寸）
 * @param {{width:number,height:number,insets?:{top:number,right:number,bottom:number,left:number}}} p.viewport
 *        视口尺寸和安全区
 * @param {'auto'|'above'|'below'} [p.placement='auto']  放在锚点上方 / 下方 / 哪边地方大放哪边
 * @param {'start'|'center'|'end'} [p.align='center']    水平对齐：左边对齐 / 居中 / 右边对齐
 * @param {number} [p.gap=8]       面板和锚点的间距
 * @param {number} [p.margin=16]   面板离屏幕边缘的最小距离
 * @returns {{ left:number, top:number, width:number, height:number, side:'top'|'bottom', originX:number, originY:number }}
 *   side：面板在锚点的哪一侧；height：实际可用高度（内容更高时面板内部滚动）；
 *   originX/originY：锚点中心相对面板左上角的位置（缩放动画的 transform-origin）
 */
export function placeAnchored({ anchor, size, viewport, placement = 'auto', align = 'center', gap = 8, margin = 16 }) {
  const insets = viewport.insets || { top: 0, right: 0, bottom: 0, left: 0 };
  const minX = insets.left + margin;
  const maxX = viewport.width - insets.right - margin;
  const minY = insets.top + margin;
  const maxY = viewport.height - insets.bottom - margin;
  const width = Math.max(0, Math.min(size.width, maxX - minX));

  const spaceBelow = maxY - (rectBottom(anchor) + gap);
  const spaceAbove = anchor.top - gap - minY;
  let side;
  if (placement === 'below') side = size.height <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  else if (placement === 'above') side = size.height <= spaceAbove || spaceAbove >= spaceBelow ? 'top' : 'bottom';
  else if (size.height <= spaceBelow) side = 'bottom';
  else if (size.height <= spaceAbove) side = 'top';
  else side = spaceBelow >= spaceAbove ? 'bottom' : 'top';

  const available = Math.max(0, side === 'bottom' ? spaceBelow : spaceAbove);
  const height = Math.min(size.height, available);
  const top = side === 'bottom' ? rectBottom(anchor) + gap : anchor.top - gap - height;

  let left;
  if (align === 'start') left = anchor.left;
  else if (align === 'end') left = rectRight(anchor) - width;
  else left = rectCenterX(anchor) - width / 2;
  // 屏幕比留白还窄时（max < min）贴左边
  left = clamp(left, minX, Math.max(minX, maxX - width));

  return {
    left,
    top,
    width,
    height,
    side,
    originX: clamp(rectCenterX(anchor) - left, 0, width),
    originY: side === 'bottom' ? 0 : height,
  };
}

// ---------------------------------------------------------------------
// 底部面板松手
// ---------------------------------------------------------------------

/**
 * 底部面板的“惯性”：松手后按速度推算任它滑会停在哪（motion/physics.js 的 projectMomentum 的保留率）。
 * 0.998 / 毫秒 = iOS 滚动的 normal 减速：大约甩出 0.5 秒的距离（以前的 0.9938 只算 0.16 秒，甩一下几乎走不动）。
 */
export const SHEET_DECELERATION = 0.998;
/** 超过这个速度（px/秒）算“甩”：往下至少降一档（在最低一档时直接关闭），往上至少升一档 */
export const SHEET_FLICK_VELOCITY = 500;
/** 从高于最低一档的位置往下甩：速度不到这么快只降一档；更快且推算落点过了关闭线才直接关闭 */
export const SHEET_HARD_FLICK_VELOCITY = 2500;
/** 慢慢拖：拖过最低一档时可见高度的这个比例，松手就关闭 */
export const SHEET_DISMISS_RATIO = 0.45;
/** 甩的时候离下一档不到这么远（px）就当已经到了那一档，往再下一档（或关闭）走 */
export const SHEET_FLICK_SLACK = 24;

/**
 * 底部面板松手：根据当前位置和速度，选一个落点（档位或关闭）。规则（iOS 的手感）：
 *   1. 甩（|速度| ≥ SHEET_FLICK_VELOCITY）：往下 → 在最低一档（或更低）时关闭，否则降到下面那一档
 *      （特别用力、推算落点又过了关闭线才直接关闭）；往上 → 升到上面那一档；
 *   2. 慢慢松手：推算落点过了关闭线（最低一档 + 可见高度 × SHEET_DISMISS_RATIO）就关闭，否则停到离推算落点最近的一档。
 * 位置是面板向下的位移：0 = 完全展开，越大越往下；closed = 完全移出屏幕（只用来兜底）。
 * @param {{ offset:number, velocity:number, snaps:number[], closed:number, dismissible?:boolean, height?:number }} p
 *   velocity：px/秒，正数 = 向下；height：面板高度（算关闭线用；不给按 closed）
 * @returns {{ target:number, close:boolean }}
 */
export function releaseTarget({ offset, velocity = 0, snaps, closed, dismissible = true, height }) {
  const list = [...new Set(snaps)].sort((a, b) => a - b);
  const lowest = list[list.length - 1] ?? 0;
  const visible = Math.max(1, (height ?? closed) - lowest);
  const projected = offset + projectMomentum(velocity || 0, SHEET_DECELERATION);
  const dismissLine = lowest + visible * SHEET_DISMISS_RATIO;
  const flickDown = velocity >= SHEET_FLICK_VELOCITY;
  const flickUp = velocity <= -SHEET_FLICK_VELOCITY;
  const nearest = (cands) => cands.reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a));
  const close = { target: closed, close: true };

  if (flickDown) {
    // 下面还有哪几档（已经拖到某一档附近的，算已经到了那一档）
    const below = list.filter((s) => s > offset + SHEET_FLICK_SLACK);
    if (dismissible && (!below.length || (velocity >= SHEET_HARD_FLICK_VELOCITY && projected >= dismissLine))) return close;
    return { target: below.length ? below[0] : lowest, close: false };
  }
  if (flickUp) {
    const above = list.filter((s) => s < offset - SHEET_FLICK_SLACK);
    return { target: above.length ? above[above.length - 1] : list[0], close: false };
  }
  if (dismissible && projected >= dismissLine) return close;
  return { target: nearest(list), close: false };
}

/**
 * 被软键盘挡住的高度：fixed 元素贴着布局视口底部，键盘弹起后可见区域（visualViewport）变矮，
 * 底部面板要往上挪 innerHeight − (vv.height + vv.offsetTop)。
 * 小于 threshold 的差值当作浏览器工具条伸缩，不算键盘；双指放大时（scale > 1）不处理。
 */
export function keyboardInset({ innerHeight, height, offsetTop = 0, scale = 1 }, threshold = 80) {
  if (!(height > 0) || !(innerHeight > 0) || scale > 1.01) return 0;
  const inset = innerHeight - (height + offsetTop);
  return inset > threshold ? Math.round(inset) : 0;
}

/**
 * 底部面板的底部操作区（footer）的反向位移：面板往下移 y 时 footer 往上移同样多（停在面板露出来那一截的底边，
 * 'content' 档也看得见），最多移 pin（最低一档的位移）；再往下拖（要关掉面板）footer 跟着面板一起走。
 * @param {number} y 面板此刻的位移（px，向下为正）
 * @param {number} pin 最低一档的位移
 */
export function footerOffset(y, pin) {
  return -Math.min(Math.max(0, y), Math.max(0, pin || 0));
}
