// =====================================================================
// motion/hooks.js：动效原语的 Preact hooks（给 ui/、overlay/、页面用）。
//
//   usePress(ref, { feedback, disabled })   给元素加按压反馈（motion/press.js）
//   useFlip(rootRef, options)               返回 capture()：改状态前调用，渲染完自动 FLIP
//   useHeightFlip(ref, options)             返回 capture()：内容变高 / 变矮时平滑过渡，后面的内容跟着滑
//   useReducedMotion()                      当前是否“减弱动态效果”（会订阅变化）
//   usePrevious(value)                      上一次渲染时的值
//   useResizeObserver(ref, callback)        元素尺寸变化
//   useLatest(value)                        总是最新值的 ref（事件回调里读 props 用）
// =====================================================================

import { useLayoutEffect, useEffect, useRef, useCallback } from 'preact/hooks';
import { attachPress } from './press.js';
import { captureLayout, playFlip, captureHeight, playHeight } from './flip.js';
import { prefersReducedMotion } from './reduced-motion.js';

/** 总是最新值的 ref */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * 按压反馈。组件渲染时最好自己写上 data-press="scale"（首帧就有正确样式），这里只管行为。
 * @param {{ current: HTMLElement|null }} ref
 * @param {{ feedback?: 'scale'|'highlight'|'both'|'none', scale?: 'auto'|number, disabled?: boolean,
 *           onPressChange?: (pressed: boolean) => void, onPressEnd?: (inside: boolean) => void }} [options]
 */
export function usePress(ref, options = {}) {
  const latest = useLatest(options);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return attachPress(el, {
      feedback: latest.current.feedback || 'scale',
      scale: latest.current.scale ?? 'auto',
      disabled: () => Boolean(latest.current.disabled),
      onPressChange: (v) => latest.current.onPressChange?.(v),
      onPressEnd: (inside, e) => latest.current.onPressEnd?.(inside, e),
    });
  }, [ref]);
}

/** 当前是否“减弱动态效果”（组件里调用会订阅，系统设置一变就重新渲染） */
export function useReducedMotion() {
  return prefersReducedMotion.value;
}

/** 上一次渲染时的值 */
export function usePrevious(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

/** 元素尺寸变化时回调（ResizeObserver；回调拿到 contentRect） */
export function useResizeObserver(ref, callback) {
  const latest = useLatest(callback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) latest.current(entry.contentRect, entry);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

/**
 * 命令式 FLIP：
 *   const capture = useFlip(listRef, { spring: 'smooth' });
 *   onClick={() => { capture(); setItems(shuffle(items)); }}
 * capture() 记下当前位置；下一次渲染提交后（绘制之前）自动播放。
 * 属性驱动的场景（列表 ↔ 网格、排序）用 ui/FlipGroup.jsx 更省事。
 */
export function useFlip(rootRef, options = {}) {
  const pending = useRef(null);
  const latest = useLatest(options);
  useLayoutEffect(() => {
    const snap = pending.current;
    if (!snap || !rootRef.current) return;
    pending.current = null;
    playFlip(snap, rootRef.current, latest.current);
  });
  return useCallback(() => {
    if (rootRef.current) pending.current = captureLayout(rootRef.current, latest.current);
  }, [rootRef]);
}

/**
 * 高度变化的 FLIP：
 *   const capture = useHeightFlip(cardRef);
 *   onClick={() => { capture(); setExpanded(!expanded); }}
 * 下一次渲染提交后，元素从旧高度过渡到新高度，后面的内容跟着滑（见 motion/flip.js 的 playHeight）。
 */
export function useHeightFlip(ref, options = {}) {
  const pending = useRef(null);
  const latest = useLatest(options);
  useLayoutEffect(() => {
    const snap = pending.current;
    if (!snap) return;
    pending.current = null;
    playHeight(snap, latest.current);
  });
  return useCallback(() => {
    if (ref.current) pending.current = captureHeight(ref.current, latest.current);
  }, [ref]);
}
