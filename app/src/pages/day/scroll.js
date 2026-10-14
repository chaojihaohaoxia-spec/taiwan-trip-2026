// =====================================================================
// pages/day/scroll.js：每天页自己滚动页面的几件事（只滚文档，不做内部滚动容器）。
//
//   topInset()                         顶栏挡住多高（安全区 + 顶栏）：滚到某个元素时让它停在顶栏下面
//   scrollIntoComfort(el, { ratio })   把元素滚到屏幕上方 ratio 处（已经在舒服的位置就不动）；用户一碰屏幕就不抢
//   stripScroll()                      换天以后页面该停在哪（和分段条一样：滚过了分段条就让它停在顶栏下面，否则不动）
//   onceForEntry(key, kind)            同一条历史记录里某件事只做一次（返回 / 刷新回来时路由恢复了滚动位置，不再自动滚）
// =====================================================================

import { session } from '../../lib/storage.js';
import { prefersReducedMotion } from '../../lib/media.js';

const KEY = 'day-scrolled';
const MAX = 60;

/** 同一条历史记录（route.key）里 kind 这件事做过没有；没做过返回 true 并记下 */
export function onceForEntry(entryKey, kind) {
  if (!entryKey) return true;
  const id = `${entryKey}:${kind}`;
  const list = session.getJSON(KEY, []);
  const arr = Array.isArray(list) ? list : [];
  if (arr.includes(id)) return false;
  arr.push(id);
  session.setJSON(KEY, arr.slice(-MAX));
  return true;
}

/** 顶栏占掉的高度（px）：安全区 + --topbar-h */
export function topInset() {
  if (typeof document === 'undefined') return 0;
  const cs = getComputedStyle(document.documentElement);
  const bar = parseFloat(cs.getPropertyValue('--topbar-h')) || 70;
  const probe = document.querySelector('.tb__probe');
  const fromProbe = probe ? probe.getBoundingClientRect().bottom : 0;
  return Math.max(bar, fromProbe);
}

/**
 * 把元素滚到屏幕上方（顶栏下面 + 可视高度 × ratio）。元素已经在 [顶栏下面, 屏幕 70%] 之间就不动。
 * 用户在动画前碰了屏幕（滚动、按下、按键）就放弃。
 * @param {Element} el
 * @param {{ ratio?: number, force?: boolean, smooth?: boolean }} [o]
 * @returns {boolean} 有没有滚
 */
export function scrollIntoComfort(el, { ratio = 0.22, force = false, smooth = true } = {}) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const top = topInset();
  const vh = window.innerHeight;
  if (!force && r.top >= top + 8 && r.top <= vh * 0.7) return false;
  const target = Math.max(0, Math.round(window.scrollY + r.top - top - (vh - top) * ratio));
  if (Math.abs(target - window.scrollY) < 4) return false;
  window.scrollTo({ top: target, left: 0, behavior: smooth && !prefersReducedMotion.peek() ? 'smooth' : 'auto' });
  return true;
}

/**
 * 换天后页面停在哪（和 shell/DayStrip 点格子时一样）：往下滚过了分段条 → 让分段条刚好停在顶栏下面；否则不动（'keep'）。
 * @returns {number|'keep'}
 */
export function stripScroll() {
  const strip = document.querySelector('[data-testid="day-strip"]');
  if (!strip) return 'keep';
  const probe = document.querySelector('.tb__probe');
  const below = probe ? probe.getBoundingClientRect().bottom + 8 : 80;
  const top = strip.getBoundingClientRect().top;
  return top < below ? Math.max(0, Math.round(window.scrollY + top - below)) : 'keep';
}

/**
 * 等用户别碰屏幕：返回 { touched, dispose }。touched() 为真表示从调用起用户滚过 / 按过 / 敲过键。
 */
export function watchUserInput() {
  let touched = false;
  const mark = () => {
    touched = true;
  };
  const types = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  for (const t of types) window.addEventListener(t, mark, { capture: true, passive: true });
  return {
    touched: () => touched,
    dispose: () => {
      for (const t of types) window.removeEventListener(t, mark, { capture: true });
    },
  };
}
