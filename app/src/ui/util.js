// =====================================================================
// ui/util.js：组件共用的小工具（纯 JS，不含 JSX）。
//
//   cx('btn', primary && 'btn--primary', { 'is-on': on })   拼 class
//   setRef(ref, el)                                         同时支持函数 ref 和对象 ref
//   renderIcon(IconPlus, 20)                                图标组件或现成的元素 → 元素（统一 aria-hidden）
//   useId('seg')                                            组件实例唯一 id（aria-controls、aria-labelledby 用）
// =====================================================================

import { h } from 'preact';
import { useRef } from 'preact/hooks';

/** 拼 class：字符串、false/null/undefined（忽略）、{ 类名: 布尔 } */
export function cx(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else if (typeof p === 'object') for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.join(' ');
}

/** 把元素交给外部 ref（函数或 { current }） */
export function setRef(ref, value) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
}

/**
 * 图标：传组件（IconPlus）就渲染成 <IconPlus size aria-hidden>；传现成的元素原样返回；null 返回 null。
 * @param {any} icon
 * @param {number} size
 */
export function renderIcon(icon, size = 20) {
  if (!icon) return null;
  if (typeof icon === 'function') return h(icon, { size, 'aria-hidden': 'true', focusable: 'false' });
  return icon;
}

let seq = 0;
/** 组件实例唯一 id（同一个实例多次渲染不变） */
export function useId(prefix = 'ui') {
  const ref = useRef(null);
  if (ref.current === null) {
    seq += 1;
    ref.current = `${prefix}-${seq.toString(36)}`;
  }
  return ref.current;
}
