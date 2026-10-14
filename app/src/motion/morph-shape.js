// =====================================================================
// motion/morph-shape.js：共享元素形变里“跟着形状走”的那部分（纯函数，不碰 DOM，单元测试直接测；
// e2e 也直接引用来核对页面上的数值）。
//
// 按钮长成面板（motion/morph.js 的 morphFrom / morphTo）时，颜色和内容不跟时间走，跟**形状此刻有多大**走：
//   - 形状进度 f：0 = 和起点（按钮）一样大，1 = 目标完整大小；
//   - 色层（起点按钮的颜色，盖在面板上面）：f ≤ 6% 时完全是按钮的颜色，到 55% 褪干净；
//   - 内容（标题、正文）：f ≤ 40% 时完全透明，到 90% 完全出现。
// 两段有重叠：收回时内容淡到快没有的时候色层已经盖上来，中间没有“又白又空的一大块”；
// 而且它们是形状的函数、和形状同一组关键帧——半路打断、反向、终点改了都一起连续变化。
// =====================================================================

import { clamp, stage } from './physics.js';

/** 色层在形状进度的这一段里褪掉：≤ 前一个数时完全是起点按钮的颜色，≥ 后一个数时完全看不见 */
export const MORPH_TINT_RANGE = Object.freeze([0.06, 0.55]);
/** 内容在形状进度的这一段里出现：≤ 前一个数时完全透明，≥ 后一个数时完全不透明 */
export const MORPH_CONTENT_RANGE = Object.freeze([0.4, 0.9]);

/** 一个方向上的比例：full = 目标完整长度，now = 此刻露出的长度，small = 起点的长度 */
function part(full, now, small) {
  const span = full - small;
  if (!(span > 1)) return 1; // 这个方向几乎没变大小：不算（也不会除以 0）
  return clamp((now - small) / span, 0, 1);
}

/**
 * 形状进度函数：把 morph 的弹簧数值（clip 方式的 t / r / b / l，或 transform 方式的 sx / sy）换成 0–1。
 * 宽、高各算一个比例取平均，夹在 0–1（弹簧过冲不超过 1）。
 * @param {'clip'|'transform'} mode
 * @param {{ width:number, height:number }} size  目标的完整尺寸
 * @param {{ width:number, height:number }} small 起点（按钮）的尺寸
 * @returns {(values: Record<string, number>) => number}
 */
export function shapeProgress(mode, size, small) {
  const W = size.width;
  const H = size.height;
  // clip 方式起点露出的那块不会比目标大（见 morph.js 的 clipMorphStart）
  const w = Math.min(small.width, W);
  const h = Math.min(small.height, H);
  if (mode === 'transform') {
    return (v) => (part(W, (v.sx ?? 1) * W, small.width) + part(H, (v.sy ?? 1) * H, small.height)) / 2;
  }
  return (v) => {
    const cutX = Math.max(0, v.l || 0) + Math.max(0, v.r || 0);
    const cutY = Math.max(0, v.t || 0) + Math.max(0, v.b || 0);
    return (part(W, W - cutX, w) + part(H, H - cutY, h)) / 2;
  };
}

/** 形状进度 f 时色层的不透明度（1 = 完全是起点按钮的颜色） */
export function morphTintAt(f) {
  return 1 - stage(f, MORPH_TINT_RANGE[0], MORPH_TINT_RANGE[1]);
}

/** 形状进度 f 时内容的不透明度 */
export function morphContentAt(f) {
  return stage(f, MORPH_CONTENT_RANGE[0], MORPH_CONTENT_RANGE[1]);
}
