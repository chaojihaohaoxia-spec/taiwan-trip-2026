// =====================================================================
// kit/Glyph.jsx：画 kit/glyphs.js 里的线条图形（样稿那套笔法：24×24、线宽 1.8、圆头圆角、currentColor）。
//
//   <Glyph name="car" />                     22px，装饰（aria-hidden）
//   <Glyph name="nav" size={20} />
//   <Glyph name="chev-r" size={18} stroke={2.2} />   箭头这类小图标线宽 2.2（样稿 .chev-chip）
//   <Glyph name="call" title="打电话" />      单独表达意思时给 title（读屏读它）
//
// 颜色跟着文字色走（currentColor）。不认识的名字画成定位针。
// =====================================================================

import { h } from 'preact';
import { GLYPHS } from './glyphs.js';

/**
 * @param {{ name: string, size?: number, stroke?: number, title?: string, class?: string }} props
 */
export function Glyph({ name, size = 22, stroke = 1.8, title, class: className, ...rest }) {
  const parts = GLYPHS[name] || GLYPHS.pin;
  return (
    <svg
      class={className ? `glyph ${className}` : 'glyph'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      data-glyph={name}
      {...rest}
    >
      {parts.map(([tag, attrs], i) => h(tag, { key: i, ...attrs }))}
    </svg>
  );
}
