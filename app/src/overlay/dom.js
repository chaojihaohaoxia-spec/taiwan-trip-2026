// =====================================================================
// overlay/dom.js：弹层共用的 DOM 小工具。
//
//   overlayRoot()     所有弹层的挂载点 <div id="overlay-root">（body 的直接子元素，和 #app 平级；
//                     自己不建层叠上下文，每一层用自己的 z-index 和外壳的顶栏、底栏比高低）
//   viewportInfo()    视口宽高 + 安全区（刘海、Home 指示条）的实际 px（安全区由 lib/media.js 量）
//   layoutRect()      元素“排版上”的矩形（不受按压缩放影响）——“从按钮长出来”的起点、替身按钮的位置
//   anchorRect()      layoutRect + 实际圆角：交给 motion/morph.js 的 morphFrom / morphTo 当源形状
//   anchorRadius()    触发按钮的实际圆角
//   translateYOf()    元素此刻（含动画中）的 translateY
//   uid()             页面内唯一的 id（aria-labelledby 用；不用 useId，弹层在独立的渲染根里）
//
// 触屏 / 宽屏的判断直接用 lib/media.js 的 coarsePointer、wideViewport 信号。
// =====================================================================

import { safeAreaInsets } from '../lib/media.js';
import { resolveRadius, toRect } from './geometry.js';

export const OVERLAY_ROOT_ID = 'overlay-root';

/** 弹层挂载点（第一次用时创建，放在 body 最后） */
export function overlayRoot() {
  let el = document.getElementById(OVERLAY_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ROOT_ID;
    el.setAttribute('data-overlay-root', '');
    document.body.appendChild(el);
  }
  return el;
}

/** 视口（fixed 元素的参照）：宽度不含滚动条；高度是布局视口高度 */
export function viewportInfo() {
  const doc = document.documentElement;
  return {
    width: doc.clientWidth || window.innerWidth,
    height: window.innerHeight,
    insets: safeAreaInsets(),
  };
}

/** 元素在视口里的矩形 */
export function rectOf(el) {
  return toRect(el.getBoundingClientRect());
}

/**
 * 元素“排版上”的矩形：尺寸不算 transform（按钮正被按下缩到 0.96 时量出来也是原尺寸），
 * 位置按视觉中心算（缩放围绕中心，中心不变）。“从按钮长出来”的起点、替身按钮的位置都用它。
 * 按钮所在的容器写了 data-anchor-unscale（底栏）：容器的 scale 也不算（按容器原大时按钮的位置）。
 */
export function layoutRect(el) {
  const r = el.getBoundingClientRect();
  // 计算样式里的宽高是不含 transform 的精确值（带小数；offsetWidth 会四舍五入成整数，
  // 替身按钮小了零点几像素，里面的文字就会被省略号截断）
  const cs = getComputedStyle(el);
  const exact = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  let w = exact(cs.width, el.offsetWidth || r.width);
  let h = exact(cs.height, el.offsetHeight || r.height);
  if (cs.boxSizing !== 'border-box') {
    const extra = (a, b) => (parseFloat(cs[a]) || 0) + (parseFloat(cs[b]) || 0);
    w += extra('paddingLeft', 'paddingRight') + extra('borderLeftWidth', 'borderRightWidth');
    h += extra('paddingTop', 'paddingBottom') + extra('borderTopWidth', 'borderBottomWidth');
  }
  let cx = r.left + r.width / 2;
  let cy = r.top + r.height / 2;
  // 按钮在一个正在缩放回原大的容器里（底栏收小时打开 ＋ 面板 / 更多菜单：底栏同时在展开，data-anchor-unscale）：
  // 按容器不缩放的样子量——面板从按钮展开以后的位置长出来，不会起点和按钮错开。容器的 transform-origin 是 50% 100%（底边中点不动）
  const host = el.closest?.('[data-anchor-unscale]');
  if (host) {
    const s = parseFloat(getComputedStyle(host).scale);
    if (Number.isFinite(s) && s > 0 && Math.abs(s - 1) > 1e-3) {
      const hr = host.getBoundingClientRect();
      const ox = hr.left + hr.width / 2;
      const oy = hr.bottom;
      cx = ox + (cx - ox) / s;
      cy = oy + (cy - oy) / s;
    }
  }
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
}

/** 触发按钮的实际圆角（px，不超过短边的一半） */
export function anchorRadius(el, rect = rectOf(el)) {
  return resolveRadius(getComputedStyle(el).borderTopLeftRadius, rect);
}

/** 按钮的排版矩形 + 圆角：{ left, top, width, height, radius }（motion/morph.js 的源形状写法） */
export function anchorRect(el) {
  const rect = layoutRect(el);
  return { ...rect, radius: anchorRadius(el, rect) };
}

/** 元素此刻（含动画中）的 translateY（px） */
export function translateYOf(el) {
  if (!el) return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(t).m42;
  } catch {
    return 0;
  }
}

let seq = 0;
/** 页面内唯一的 id */
export function uid(prefix = 'ov') {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

/** 元素还在文档里、看得见（有尺寸） */
export function isShown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/** 有几个不透明的全屏层正盖着整页（大图浏览、给司机看） */
let covering = 0;

/**
 * 不透明的全屏层盖住整页的那段时间：<html data-covered>，外壳据此关掉底下看不见的毛玻璃
 * （顶栏、底栏、分段条、滚动边缘；iPhone 上每层 backdrop-filter 每帧都要算，交互评审 P2-9）。
 * 入场动画播完调 setPageCovered(true)，开始退场 / 卸载时调 setPageCovered(false)（成对调用，计数）。
 * @param {boolean} on
 */
export function setPageCovered(on) {
  if (typeof document === 'undefined') return;
  covering = Math.max(0, covering + (on ? 1 : -1));
  document.documentElement.toggleAttribute('data-covered', covering > 0);
}
