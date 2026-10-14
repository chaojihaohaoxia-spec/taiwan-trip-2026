// =====================================================================
// lib/theme.js：深浅色偏好 + 行程主题色。
//
// 深浅色：'system'（默认，跟随系统）/ 'light' / 'dark'。
//   - 写 <html data-theme="light|dark">（system 时去掉这个属性），tokens.css 据此切换；
//   - 同步改 <meta name="theme-color">（iOS 状态栏、Safari 标签栏的颜色）；
//   - 偏好存 localStorage（键 rs7885:theme）。index.html 里有一小段内联脚本在首帧前
//     读这个键，避免强制深色的人先看到一闪白。
//
// 实际生效的深浅色：effectiveScheme（信号，'light' | 'dark'）= 用户强制的优先，否则跟随系统。
//   地图底图、图表这类要用 JS 换颜色 / 换图的地方读它（纯 CSS 的地方直接用 tokens 就行）。
//
// 行程主题色：setTripAccent('#0EA5A4', '#F2A65A') 写到 <html> 的 --trip-accent / --trip-accent-2，
//   --color-accent、光场整页跟着变；离开行程时 setTripAccent(null, null) 恢复默认。
//   外壳（shell/trip-state.js）按当前行程统一设置（切换行程时在两个颜色之间平滑过渡），页面不用自己调。
// =====================================================================

import { signal, computed } from '@preact/signals';
import { local } from './storage.js';
import { prefersDarkScheme } from './media.js';

export const THEME_KEY = 'theme';
const VALID = new Set(['system', 'light', 'dark']);

function readPreference() {
  const v = local.get(THEME_KEY, 'system');
  return VALID.has(v) ? v : 'system';
}

/** 当前偏好（信号） */
export const themePreference = signal(typeof window === 'undefined' ? 'system' : readPreference());

/** <html data-theme> 现在强制的深浅色（tokens.css 认的就是这个属性；index.html 的内联脚本、applyTheme 都写它） */
function readForced() {
  if (typeof document === 'undefined') return null;
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : null;
}
const forcedScheme = signal(readForced());
if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  new MutationObserver(() => {
    forcedScheme.value = readForced();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** 实际生效的深浅色（信号）：'light' | 'dark'。<html data-theme> 强制的优先，否则跟随系统 */
export const effectiveScheme = computed(() => forcedScheme.value || (prefersDarkScheme.value ? 'dark' : 'light'));

/** 读某个设计变量当前的计算值，例如 cssVar('--color-canvas') */
export function cssVar(name, el) {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
}

/** 按当前实际生效的主题，把 theme-color 改成页面底色 */
export function syncThemeColorMeta() {
  if (typeof document === 'undefined') return;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) return;
  const pref = themePreference.value;
  if (pref === 'system') {
    // 恢复构建时写好的两条（带 media），各管各的
    metas.forEach((m) => {
      if (m.dataset.default) m.setAttribute('content', m.dataset.default);
    });
    return;
  }
  const color = cssVar('--color-canvas');
  if (!color) return;
  metas.forEach((m) => {
    if (!m.dataset.default) m.dataset.default = m.getAttribute('content') || '';
    m.setAttribute('content', color);
  });
}

/** 应用偏好到 <html> 和 meta（启动时、偏好变化时调用） */
export function applyTheme(pref = themePreference.value) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
  forcedScheme.value = readForced();
  syncThemeColorMeta();
}

/** 设置偏好：'system' | 'light' | 'dark' */
export function setThemePreference(pref) {
  if (!VALID.has(pref)) throw new Error(`未知的主题偏好：${pref}`);
  themePreference.value = pref;
  local.set(THEME_KEY, pref);
  applyTheme(pref);
}

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/** 写 / 删 <html> 上的一个主题色变量（不是 #RRGGBB 就删掉，回到默认色） */
function writeAccent(root, name, hex) {
  if (hex && HEX6.test(hex)) root.style.setProperty(name, hex);
  else root.style.removeProperty(name);
}

/**
 * 整页换行程主题色；传 null 恢复默认。
 *   setTripAccent('#0E8A8A')             只换第一主题色（第二主题色不动）
 *   setTripAccent('#0E8A8A', '#F2A65A')  两个一起换（trips.cover.accent / accent_2；光场下半部分的暖色跟着变）
 *   setTripAccent(null, null)            两个都恢复默认（离开行程）
 * 外壳（shell/trip-state.js）按当前行程统一调用，页面不用自己调。
 * @param {string|null} hex
 * @param {string|null} [hex2]
 */
export function setTripAccent(hex, hex2) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  writeAccent(root, '--trip-accent', hex);
  if (arguments.length > 1) writeAccent(root, '--trip-accent-2', hex2);
}
