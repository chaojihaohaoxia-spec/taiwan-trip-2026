// =====================================================================
// kit/glyph-dom.js：不经过 Preact、直接用 DOM 画 kit/glyphs.js 的线条图形。
//
// 给不能写 JSX 的地方用（Leaflet 的图钉、地图控件）：不能拼 HTML 字符串——CSP 不允许内联 style，也防注入。
// 笔法和 <Glyph>（kit/Glyph.jsx）完全一样：24×24、只描边、圆头圆角、currentColor。
//
//   const svg = createGlyphSvg('bowl', { size: 18, stroke: 2 });
// =====================================================================

import { GLYPHS } from './glyphs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 图形的组成；不认识的名字画成定位针（和 <Glyph> 一样） */
export function glyphParts(name) {
  return GLYPHS[name] || GLYPHS.pin;
}

/**
 * @param {string} name
 * @param {{ size?: number, stroke?: number, className?: string }} [o]
 * @returns {SVGSVGElement}
 */
export function createGlyphSvg(name, { size = 18, stroke = 2, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  svg.dataset.glyph = name;
  for (const [tag, attrs] of glyphParts(name)) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  return svg;
}
