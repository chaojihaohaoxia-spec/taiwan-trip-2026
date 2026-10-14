// =====================================================================
// ui/Pressable.jsx：所有“能按”的东西的基件——按下即缩、松手弹簧回弹、手指滑出取消、键盘也有按下态。
//
//   <Pressable class="my-card" onClick={open}>…</Pressable>                 默认 <button type="button">
//   <Pressable as="a" href="#/t/demo-island" feedback="highlight">…</Pressable>   列表行：高亮不缩放
//   <Pressable as="div" role="button" tabIndex={0} …>                        非按钮元素（要自己处理回车）
//
// 属性：
//   as          渲染成什么元素，默认 'button'
//   feedback    'scale'（默认）| 'highlight' | 'both' | 'none'（见 motion/press.js）
//   scale       按下的缩放，默认 'auto'（按元素大小，大卡片缩得少）
//   disabled    禁用（按钮用原生 disabled；其他元素用 aria-disabled，并拦截点击）
//   elRef       拿到 DOM 元素（Preact 函数组件不转发 ref，统一用 elRef）
// 其余属性原样传给元素（class、onClick、aria-*…）。
// =====================================================================

import '../motion/press.css';
import { useRef, useCallback } from 'preact/hooks';
import { usePress } from '../motion/hooks.js';
import { setRef } from './util.js';

export function Pressable({ as = 'button', feedback = 'scale', scale = 'auto', disabled = false, elRef, type, onClick, children, ...rest }) {
  const ref = useRef(null);
  const Tag = as;
  usePress(ref, { feedback, scale, disabled });
  const attach = useCallback((el) => {
    ref.current = el;
    setRef(elRef, el);
  }, [elRef]);
  const isButton = Tag === 'button';
  const handleClick = (e) => {
    if (disabled && !isButton) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <Tag
      ref={attach}
      data-press={feedback}
      type={isButton ? type || 'button' : type}
      disabled={isButton ? disabled : undefined}
      aria-disabled={!isButton && disabled ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </Tag>
  );
}
