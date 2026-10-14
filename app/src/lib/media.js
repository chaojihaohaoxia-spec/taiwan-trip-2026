// =====================================================================
// lib/media.js：设备和系统设置的响应式信号（媒体查询）+ 安全区的实际像素。全站只在这里调用 matchMedia。
//
//   import { prefersReducedMotion, prefersDarkScheme, coarsePointer, wideViewport, safeAreaInsets } from '../lib/media.js';
//   if (prefersReducedMotion.value) { 改成淡入淡出 }          // 组件里读 .value 自动订阅，系统设置一变就重画
//   prefersDarkScheme.value                                  // 系统是不是深色（实际生效的深浅色看 lib/theme.js 的 effectiveScheme）
//   coarsePointer.value                                      // 主要靠触摸操作（手机、平板）
//   wideViewport.value                                       // ≥768px（平板、桌面）：底部面板变浮动卡片等
//   safeAreaInsets()                                         // { top, right, bottom, left } 刘海、Home 指示条的实际 px
//
// 断点和 tokens.css 的约定一致：手机优先；min-width 768px 平板；min-width 1024px 桌面。
// Node 里（单元测试、构建脚本）没有 matchMedia：信号恒为 false，安全区全是 0。
// motion/reduced-motion.js 转出这里的 prefersReducedMotion（动效模块的老入口，照常可用）。
// =====================================================================

import { signal } from '@preact/signals';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * 某个媒体查询的信号（创建一次，跟着系统变化）。
 * @param {string} query 例如 '(prefers-reduced-motion: reduce)'
 * @returns {import('@preact/signals').Signal<boolean>} 只读，别赋值
 */
export function mediaSignal(query) {
  const mql = hasMatchMedia() ? window.matchMedia(query) : null;
  const s = signal(Boolean(mql?.matches));
  if (mql) {
    const onChange = (event) => {
      s.value = event.matches;
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
  }
  return s;
}

/** 系统开了“减弱动态效果” */
export const prefersReducedMotion = mediaSignal('(prefers-reduced-motion: reduce)');
/** 系统是深色（用户在设置里强制的深浅色见 lib/theme.js） */
export const prefersDarkScheme = mediaSignal('(prefers-color-scheme: dark)');
/** 主要靠触摸操作（手机、平板） */
export const coarsePointer = mediaSignal('(pointer: coarse)');
/** 宽屏：≥768px（平板、桌面） */
export const wideViewport = mediaSignal('(min-width: 768px)');

let probe = null;

/**
 * 安全区的实际 px。env(safe-area-inset-*) 只能在 CSS 里取值，这里用一个看不见的探针元素读出来
 * （padding 写成 tokens.css 的 --safe-*；用 CSSOM 写样式，CSP 允许）。
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function safeAreaInsets() {
  if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.setAttribute('data-safe-area-probe', '');
    Object.assign(probe.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      paddingTop: 'var(--safe-top)',
      paddingRight: 'var(--safe-right)',
      paddingBottom: 'var(--safe-bottom)',
      paddingLeft: 'var(--safe-left)',
    });
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}
