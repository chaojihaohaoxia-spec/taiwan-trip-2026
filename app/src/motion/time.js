// =====================================================================
// motion/time.js：动效的“时间倍率”（只给开发页的「慢动作」用）+ 读设计变量里的时长和缓动。
//
//   setTimeScale(5)   全站动效慢 5 倍：JS 弹簧（animate.js）按倍率拉长；
//                     CSS 里的 --dur-*、--press-duration、--spring-*-duration 也在 <html> 上临时覆盖成 5 倍；
//   setTimeScale(1)   恢复（去掉覆盖）。
//
// 线上不会调用 setTimeScale，倍率恒为 1，没有任何开销。
// cssDuration / cssEasing：把 tokens.css 里的 --dur-fast、--ease-out 读成 WAAPI 能用的数字和字符串
// （WAAPI 的 easing 不认 var()），减弱动态效果打开/关闭后自动重新读取。读变量用 lib/theme.js 的 cssVar。
// =====================================================================

import { signal } from '@preact/signals';
import { cssVar } from '../lib/theme.js';
import { prefersReducedMotion } from './reduced-motion.js';

/** 当前时间倍率（信号，开发页显示用）。1 = 正常 */
export const timeScale = signal(1);

/** JS 动画用：当前倍率 */
export function getTimeScale() {
  return timeScale.value;
}

/** tokens.css 里和时长有关、慢动作时要一起拉长的变量 */
const DURATION_TOKENS = [
  '--dur-instant', '--dur-fast', '--dur-base', '--dur-slow', '--dur-slower', '--press-duration',
  '--spring-snappy-duration', '--spring-bouncy-duration', '--spring-smooth-duration',
];

function root() {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

/** 读 :root 上某个变量的计算值（字符串）；读不到返回 '' */
const readRootVar = (name) => (typeof getComputedStyle === 'function' ? cssVar(name) : '');

function parseMs(text) {
  const m = /^(-?[\d.]+)(ms|s)?$/.exec(String(text).trim());
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

let baseDurations = null;

/**
 * 设置时间倍率（开发页“慢动作”）。
 * @param {number} k 1 = 正常；5 = 慢 5 倍
 */
export function setTimeScale(k) {
  const scale = Number.isFinite(k) && k > 0 ? k : 1;
  const el = root();
  if (el) {
    if (!baseDurations) {
      // 先去掉旧覆盖再读“原始值”
      for (const name of DURATION_TOKENS) el.style.removeProperty(name);
      baseDurations = Object.fromEntries(DURATION_TOKENS.map((n) => [n, parseMs(readRootVar(n))]));
    }
    for (const name of DURATION_TOKENS) {
      const base = baseDurations[name];
      if (scale === 1 || !Number.isFinite(base)) el.style.removeProperty(name);
      else el.style.setProperty(name, `${Math.round(base * scale)}ms`);
    }
    if (scale === 1) baseDurations = null;
  }
  timeScale.value = scale;
  clearCaches();
}

// ---------------------------------------------------------------------
// 读设计变量（带缓存；减弱动态效果切换时作废）
// ---------------------------------------------------------------------

const FALLBACK_DURATIONS = { instant: 90, fast: 160, base: 240, slow: 360, slower: 520 };
const FALLBACK_EASINGS = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'cubic-bezier(0.55, 0, 0.75, 0.2)',
  'in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
};

let durationCache = new Map();
let easingCache = new Map();
function clearCaches() {
  durationCache = new Map();
  easingCache = new Map();
}
prefersReducedMotion.subscribe(() => clearCaches());

/**
 * 设计变量里的普通时长（毫秒，已含慢动作倍率）。
 * @param {'instant'|'fast'|'base'|'slow'|'slower'|number} name 也可以直接给毫秒数（会乘倍率）
 */
export function cssDuration(name) {
  if (typeof name === 'number') return name * getTimeScale();
  if (!durationCache.has(name)) {
    const v = parseMs(readRootVar(`--dur-${name}`));
    // 慢动作时 :root 上已经是放大后的值，这里不再乘
    durationCache.set(name, Number.isFinite(v) ? v : (FALLBACK_DURATIONS[name] ?? 240) * getTimeScale());
  }
  return durationCache.get(name);
}

/**
 * 设计变量里的普通缓动（WAAPI 用的字符串）。
 * @param {'standard'|'out'|'in'|'in-out'|string} name 不是名字就原样返回（例如 'linear'、'cubic-bezier(…)'）
 */
export function cssEasing(name) {
  if (!(name in FALLBACK_EASINGS)) return name;
  if (!easingCache.has(name)) {
    const v = readRootVar(`--ease-${name}`);
    easingCache.set(name, v || FALLBACK_EASINGS[name]);
  }
  return easingCache.get(name);
}
