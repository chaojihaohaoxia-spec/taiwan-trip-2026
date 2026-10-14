// =====================================================================
// test/unit/helpers/tokens.js：解析 tokens.css，算出浅色 / 深色下每个颜色变量的实际颜色。
//
// 支持：#rgb/#rrggbb、rgb()/rgba()、transparent、var(--x, 后备)、
//       color-mix(in srgb, A p%, B)（按 CSS 规范：带透明度时先预乘再混合）。
// 失效值：变量是 initial（没设，例如 --trip-accent）时，引用它又没给后备的表达式整个失效（CSS 的 guaranteed-invalid），
//        返回 null，一路传到外层带后备的 var(--x, 后备) 那里落到后备值——和浏览器一样。
// 足够覆盖 tokens.css 的写法；遇到不认识的写法直接抛错（测试失败），提醒补支持。
// =====================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKENS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/styles/tokens.css');

/** 读一个选择器块里的全部变量声明（按出现顺序） */
export function readBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`找不到块 ${selector}`);
  let depth = 0;
  let i = css.indexOf('{', start);
  const from = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = css.slice(from, i).replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

export function loadTokens(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const light = readBlock(css, ':root');
  const derived = readBlock(css, ':root,\n.accent-scope');
  const darkForced = readBlock(css, ':root[data-theme="dark"]');
  // @media (prefers-color-scheme: dark) 里那一块
  const mediaStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const darkMedia = readBlock(css.slice(mediaStart), '  :root:not([data-theme="light"])');
  return { light, derived, darkForced, darkMedia, css };
}

/** 某个主题下的全部变量（后者覆盖前者） */
export function themeVars(tokens, theme) {
  const base = { ...tokens.light, ...tokens.derived };
  return theme === 'dark' ? { ...base, ...tokens.darkForced } : base;
}

function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 把一个颜色表达式算成 [r, g, b, a]（0–255 / 0–1） */
export function resolveColor(expr, vars, depth = 0) {
  if (depth > 20) throw new Error(`变量引用太深：${expr}`);
  const s = String(expr).trim();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'initial') return null;
  let m = /^var\((--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(s);
  if (m) {
    const v = vars[m[1]];
    if (v === undefined && m[2] === undefined) throw new Error(`变量 ${m[1]} 没有定义`);
    const value = v === undefined || v === 'initial' ? null : resolveColor(v, vars, depth + 1);
    if (value) return value;
    if (m[2] !== undefined) return resolveColor(m[2], vars, depth + 1);
    return null; // 引用了没设的变量：整个表达式失效
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color-mix\(in srgb,\s*([\s\S]+)\)$/.exec(s);
  if (m) {
    const [a, b] = splitArgs(m[1]);
    const pa = /^(.*?)\s+(\d+(?:\.\d+)?%|var\(--[a-z0-9-]+\))$/.exec(a);
    const colorA = resolveColor(pa ? pa[1] : a, vars, depth + 1);
    let pct = pa ? pa[2] : '50%';
    pct = pct.startsWith('var(') ? resolvePercent(pct, vars) : pct.slice(0, -1);
    const wa = Number(pct) / 100;
    const colorB = resolveColor(b, vars, depth + 1);
    if (!colorA || !colorB) return null;
    const wb = 1 - wa;
    const alpha = colorA[3] * wa + colorB[3] * wb;
    if (alpha === 0) return [0, 0, 0, 0];
    const rgb = [0, 1, 2].map((i) => (colorA[i] * colorA[3] * wa + colorB[i] * colorB[3] * wb) / alpha);
    return [...rgb, alpha];
  }
  if (/^oklch\(from\s/i.test(s)) return resolveRelativeOklch(s, vars);
  throw new Error(`不认识的颜色写法：${s}`);
}

function resolvePercent(expr, vars) {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(expr);
  const v = m ? vars[m[1]] : null;
  if (!v || !v.endsWith('%')) throw new Error(`百分比变量解析失败：${expr}`);
  return v.slice(0, -1);
}

/** 半透明前景叠在不透明背景上 */
export function over(fg, bg) {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
}

function lum([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 对比度 */
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------------------------------------------------------------------
// OKLCH（光场用相对颜色语法提亮主题色：oklch(from var(--color-accent) 0.76 calc(c * 1.25) h / 0.78)）
// ---------------------------------------------------------------------

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** [r, g, b]（0–255）→ [L, C, h°] */
export function rgbToOklch([r, g, b]) {
  const [R, G, B] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return [L, C, h];
}

function oklchToLinear([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** [L, C, h°] → [r, g, b]（0–255）；超出 sRGB 时像浏览器一样保持亮度和色相、减小彩度直到放得下 */
export function oklchToRgb([L, C, h]) {
  const inGamut = (c) => oklchToLinear([L, c, h]).every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  let c = C;
  if (!inGamut(c)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return oklchToLinear([Math.min(1, Math.max(0, L)), c, h]).map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v)))));
}

/**
 * 算 oklch(from <色> L C H / A) 里的一个分量：数字、l / c / h，或者 calc(c * 1.25)、calc(h + 40)、calc(h - 12)
 * @param {string} expr
 * @param {{ l: number, c: number, h: number }} ch
 */
function relComponent(expr, ch) {
  const s = expr.trim();
  if (/^-?[\d.]+$/.test(s)) return Number(s);
  if (s in ch) return ch[s];
  let m = /^calc\(\s*([lch])\s*([*+-])\s*([\d.]+)\s*\)$/.exec(s);
  if (m) {
    const base = ch[m[1]];
    const n = Number(m[3]);
    return m[2] === '*' ? base * n : m[2] === '+' ? base + n : base - n;
  }
  m = /^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(s);
  if (m) {
    const [lo, v, hi] = [m[1], m[2], m[3]].map((x) => relComponent(x, ch));
    return Math.min(hi, Math.max(lo, v));
  }
  throw new Error(`不认识的相对颜色分量：${expr}`);
}

/**
 * 解析并计算 oklch(from var(--x) L C H / A)，源色先用 resolveColor 算出来
 * @returns {number[]|null} [r, g, b, a]
 */
export function resolveRelativeOklch(expr, vars) {
  const m = /^oklch\(from\s+(var\([^)]*\)|#[0-9a-f]+)\s+([\s\S]+?)\)$/i.exec(expr.trim());
  if (!m) throw new Error(`不认识的相对颜色：${expr}`);
  const src = resolveColor(m[1], vars);
  if (!src) return null;
  // 分量里的 var(--x) 先换成值（例如 var(--accent-solid-lmax) → 0.55）
  const rest = m[2].replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => {
    if (vars[name] === undefined) throw new Error(`变量 ${name} 没有定义`);
    return vars[name];
  });
  const [body, alpha] = rest.split('/').map((x) => x.trim());
  const parts = body.match(/(?:calc|clamp)\([^)]*\)|\S+/g);
  const [L, C, H] = rgbToOklch(src);
  const ch = { l: L, c: C, h: H };
  const rgb = oklchToRgb([relComponent(parts[0], ch), relComponent(parts[1], ch), relComponent(parts[2], ch)]);
  return [...rgb, alpha === undefined ? 1 : Number(alpha)];
}

/** tokens.css 里 @supports (color: oklch(from red l c h)) 那一块（光场的鲜亮版本）的变量 */
export function readRelativeBlock(css) {
  const start = css.indexOf('@supports (color: oklch(from red l c h))');
  if (start === -1) return {};
  return readBlock(css.slice(start), '  :root,\n  .accent-scope');
}
