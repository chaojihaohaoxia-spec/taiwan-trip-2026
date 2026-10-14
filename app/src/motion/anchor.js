// =====================================================================
// motion/anchor.js：布局变化期间，让某个元素在屏幕上的位置保持不动（自己做的“滚动锚定”）。
//
//   holdPosition(headerEl);          // 点了某张卡片：上面的卡片收起、下面的展开，这张的标题行一直待在手指下面
//
// 为什么要自己做：浏览器的 overflow-anchor（滚动锚定）iOS Safari 不支持；而且它只在“布局突变”时修正，
// 对 grid-template-rows 这种逐帧变化的展开 / 收起，标题行还是会跟着跑。
// 做法：记下元素此刻离视口顶部多远；之后每一帧（rAF）量一次，跑了多少就把页面（或指定的滚动容器）
// 往同一方向滚多少——和展开动画用的是同一帧，所以严丝合缝，看起来元素没动、是别的内容在它上下伸缩。
// 停止：至少盯到 minMs（调用方传动画时长：动画尾巴每帧只动不到半像素，光看“连续几帧没动”会提前停、最后差 1px），
// 之后位置连续几帧不再变化就停；到了最长时间、或者用户自己开始滚动（滚轮、手指拖动、翻页键）也停。
// 别的代码滚了页面（scrollIntoView）也停：上一帧补完后的位置这一帧变了，就不再抢。
// 单纯按下（点按）不算“自己滚”：快速连点两下时，第二下按下去如果就停了，上面那张还在收、下一帧整列上移，
// 第二下就点进了刚展开的动作行（交互评审 P1-1：误双击打开了 Grab）。同一时间只盯一个元素：新的一次接管旧的。
// 页面已经在最顶上、没法再往上滚时，能补多少补多少。减弱动态效果时展开没有过程，同样有效（一帧修正到位）。
// =====================================================================

import { getTimeScale } from './time.js';

/** 位置连续多少帧不变就算稳定 */
const STABLE_FRAMES = 6;
/** 至少盯多久（毫秒）：动画开始前的头几帧位置也可能还没变 */
const MIN_MS = 120;
/** 最多盯多久（毫秒，乘慢动作倍率） */
const MAX_MS = 1600;

/**
 * @param {Element|null} el 要保持不动的元素
 * @param {{ scroller?: Element|Window, minMs?: number, maxMs?: number }} [o]
 *   scroller：在哪个容器里滚（默认整个页面）；minMs：至少盯多久（毫秒，已含慢动作倍率，通常传动画时长）
 * @returns {() => void} 立即停止
 */
export function holdPosition(el, o = {}) {
  if (!el || typeof window === 'undefined' || typeof el.getBoundingClientRect !== 'function') return () => {};
  const scroller = o.scroller || window;
  const k = Math.max(1, getTimeScale());
  const minMs = Math.max(MIN_MS, o.minMs ?? 0);
  const maxMs = Math.max((o.maxMs ?? MAX_MS) * k, minMs + 200);
  const startTop = el.getBoundingClientRect().top;
  let raf = 0;
  let t0 = 0;
  let stable = 0;
  let stopped = false;
  let lastDrift = 0;

  const scrollBy = (dy) => {
    if (scroller === window) window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
    else scroller.scrollTop += dy;
  };
  const scrollPos = () => (scroller === window ? window.scrollY : scroller.scrollTop);
  const maxPos = () => (scroller === window
    ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    : Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  /** 上一帧补完以后滚动位置应该在哪：这一帧不一样（又不是内容变矮被浏览器夹到底）= 别人在滚（scrollIntoView、用户），不抢 */
  let expected = scrollPos();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    for (const type of USER_INPUT) window.removeEventListener(type, stop, true);
    window.removeEventListener('keydown', onKey, true);
    if (active === stop) active = null;
  };
  // 翻页 / 方向键：用户自己在滚
  const onKey = (e) => {
    if (SCROLL_KEYS.has(e.key)) stop();
  };

  const tick = (now) => {
    if (stopped) return;
    if (!t0) t0 = now;
    if (!el.isConnected) {
      stop();
      return;
    }
    const pos = scrollPos();
    if (Math.abs(pos - expected) > 1 && !(pos < expected && pos >= maxPos() - 1)) {
      stop();
      return;
    }
    const drift = el.getBoundingClientRect().top - startTop;
    if (Math.abs(drift) > 0.25) {
      scrollBy(drift);
      const after = scrollPos();
      // 补不动了（已经在页面最顶上 / 最底下）而且元素也不再动：和“稳定了”一样算（能补多少补多少，不一直占着滚动）
      const clamped = Math.abs(after - pos) < 0.5;
      stable = clamped && Math.abs(drift - lastDrift) < 0.25 ? stable + 1 : 0;
      expected = after;
    } else {
      stable += 1;
      expected = pos;
    }
    lastDrift = drift;
    const elapsed = now - t0;
    if ((stable >= STABLE_FRAMES && elapsed > minMs) || elapsed > maxMs) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  // 两次补偿同时跑会补两遍（来回抖）：新的一次接管
  active?.();
  active = stop;
  // 用户自己开始滚：不抢
  for (const type of USER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
  window.addEventListener('keydown', onKey, { capture: true, passive: true });
  raf = requestAnimationFrame(tick);
  return stop;
}

/** 正在盯着的那一次（的 stop） */
let active = null;
/** 算“用户自己在滚”的输入：滚轮、手指拖动（单纯按下不算） */
const USER_INPUT = ['wheel', 'touchmove'];
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
