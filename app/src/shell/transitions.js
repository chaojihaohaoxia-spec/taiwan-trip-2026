// =====================================================================
// shell/transitions.js：页面切换的动效（router.setTransitionDriver 的驱动；外壳启动时装上）。
//
//   transitionPlan(from, to, { direction }) → { type, dir }   哪两种页面之间用哪种过渡（纯函数，单元测试覆盖）
//   installPageTransitions(router)                            装上驱动；返回卸下的函数
//
// 过渡种类（样稿 07-ui.js 的 Views.show / selectDay / 切换行程，用 motion/ 的原语重做）：
//   day   天与天之间（概览 ↔ D1 ↔ D2 …，同一趟）：大标题、天数分段条不动（指示条自己弹过去），只有下面的内容
//         按方向左右滑入（新内容从 ±28px 处滑到原位并淡入、按块错开 35ms；旧内容同时往反方向退出并淡出）
//   tab   底栏 tab 之间（行程 ↔ 地图 ↔ 账本）、二级页面之间：大标题不动，下面交叉淡入（旧的 160ms 淡出，
//         新的从下面 14px 浮上来、按块错开）
//   push  进二级页面（行程 → 预订、行程列表 → 行程、→ 设置）从右滑入，返回反向：新内容从 30% 宽处滑进来并淡入，
//         旧内容往另一边退 12% 并淡出
//   trip  换行程（样稿 17-帧条、08-overlays.js Trip.switchTo）：旧内容很快淡出、微微上移（180ms），新的大标题 70ms 后
//         原地淡入、其余内容 110ms 后依次浮上来（错开 45ms）——旧的走了新的才来，不叠成重影；
//         光场、外壳部件的主题色由 Field / trip-state 同步过渡，旧内容的幽灵冻结在旧的主题色上
//   fade  进出登录页、启动页、开发页等：交叉淡化
//   none  只改查询参数 / 弹层、第一次渲染
// 减弱动态效果：一律只淡入淡出（不位移、不错开）。
//
// 做法：换页前把旧内容克隆一份（“幽灵”，fixed 定在它当时在屏幕上的位置，不可交互、读屏读不到），
// 新页面渲染出来、滚动恢复以后，幽灵退出、新内容入场，播完删掉幽灵、清掉内联样式。
// 驱动不等动画播完就返回（navigate() 照常在新页面进 DOM 后 resolve）；新的导航开始时上一次的动画立刻收尾——
// 先把正在入场的内容停在此刻的样子（半透明、还在半路）再克隆成幽灵，幽灵从这个样子退出，不会先闪回完整不透明
// （连点分段条时——外壳评审）。
// 透明度只加在“玻璃本身”或“里面没有玻璃”的元素上（祖先半透明会让子元素的 backdrop-filter 失效）：
// 入场按块分别做（大标题、分段条、页面的每一块），不给整个容器设透明度。
// =====================================================================

import { prefersReducedMotion } from '../lib/media.js';
import { animateSpring, animateTween, stopAnimation, clearStyle } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { transitionPlan } from './rules.js';

export { transitionPlan };

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------

const q = (sel) => (typeof document === 'undefined' ? null : document.querySelector(sel));

/** 页面内容按块拆开（入场错开、透明度分别加在每一块上） */
function pageBlocks() {
  const page = q('[data-shell-page]');
  const root = page?.firstElementChild;
  if (!root) return [];
  const kids = [...root.children].filter((el) => el.getClientRects().length);
  return kids.length > 1 ? kids : [root];
}

/** 大标题区的“身份”（文字）：tab 之间切换时标题没变就不动它 */
const headText = () => q('[data-shell-head]')?.textContent || '';

/** 这次过渡涉及哪些块：old() 要做幽灵的旧元素；enter(headSame) 新内容的块 */
function regions(type) {
  const blocks = pageBlocks;
  if (type === 'day') return { old: () => [q('[data-shell-page]')], enter: () => blocks() };
  const all = (withHead) => [withHead ? q('[data-shell-head]') : null, q('[data-shell-strip]'), ...blocks()];
  if (type === 'tab') {
    return {
      old: () => [q('[data-shell-head]'), q('[data-shell-strip]'), q('[data-shell-page]')],
      enter: (headSame) => all(!headSame),
      keepHead: true,
    };
  }
  return { old: () => [q('[data-shell-head]'), q('[data-shell-strip]'), q('[data-shell-page]')], enter: () => all(true) };
}

/** <html> 上此刻的行程主题色（幽灵冻结在这个颜色上：换行程时 <html> 一下子换成新颜色，旧内容不跟着变） */
function rootAccent() {
  const st = document.documentElement.style;
  return { a: st.getPropertyValue('--trip-accent').trim(), b: st.getPropertyValue('--trip-accent-2').trim() };
}

/** 克隆一块旧内容，fixed 定在它此刻的位置（只留屏幕里看得见的那一段；不可交互、读屏读不到） */
function makeGhost(el, accent) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.height < 1 || r.bottom < 0 || r.top > vh) return null;
  const clone = el.cloneNode(true);
  for (const n of [clone, ...clone.querySelectorAll('[id], [data-testid], [data-shell-page], [data-shell-head], [data-shell-strip]')]) {
    n.removeAttribute('id');
    n.removeAttribute('data-testid');
    n.removeAttribute('data-shell-page');
    n.removeAttribute('data-shell-head');
    n.removeAttribute('data-shell-strip');
  }
  const top = Math.max(0, r.top);
  const box = document.createElement('div');
  box.className = 'shell-ghost';
  if (accent?.a) {
    box.classList.add('accent-scope');
    box.style.setProperty('--trip-accent', accent.a);
    if (accent.b) box.style.setProperty('--trip-accent-2', accent.b);
  }
  box.setAttribute('aria-hidden', 'true');
  box.inert = true;
  Object.assign(box.style, { top: `${top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${Math.min(vh, r.bottom) - top}px` });
  Object.assign(clone.style, { position: 'absolute', top: `${r.top - top}px`, left: '0', width: '100%', margin: '0' });
  box.appendChild(clone);
  el.parentNode.insertBefore(box, el);
  return box;
}

// ---------------------------------------------------------------------
// 驱动
// ---------------------------------------------------------------------

let current = null;

/** 上一次的过渡立刻收尾：删幽灵、停动画、清内联样式 */
function finishCurrent() {
  if (!current) return;
  current.stopLate?.();
  for (const g of current.ghosts) g.remove();
  for (const el of current.entered) {
    stopAnimation(el, 'page-enter', { commit: false });
    clearStyle(el, ['transform', 'opacity']);
  }
  current = null;
}

/**
 * 新的导航来了、上一次的入场还没播完：把正在入场的内容停在此刻的样子（写成内联样式），删掉上一次的幽灵。
 * 接着克隆出来的幽灵就是此刻看到的样子；克隆完再 clearFrozen() 清掉真内容上的内联样式。
 * @returns {Element[]} 停住的元素
 */
function freezeCurrent() {
  if (!current) return [];
  current.stopLate?.();
  for (const g of current.ghosts) g.remove();
  const frozen = current.entered.filter((el) => el.isConnected);
  for (const el of current.entered) stopAnimation(el, 'page-enter', { commit: true });
  current = null;
  return frozen;
}

function clearFrozen(list) {
  for (const el of list) clearStyle(el, ['transform', 'opacity']);
}

const STAGGER = 35;
const MAX_STAGGER = 7;
/** 换行程：新的大标题等旧内容淡出一半再原地淡入；其余内容再晚一点、依次浮上来（样稿 Trip.switchTo 的 70 / 110 / 45） */
const TRIP_HEAD_DELAY = 70;
const TRIP_BODY_DELAY = 110;
const TRIP_STAGGER = 45;

/**
 * 第 i 块新内容从哪里来、晚多久（纯函数，单元测试覆盖）。
 * headFirst：第 0 块是大标题（换行程时大标题原地淡入，不位移）。
 * @returns {{ x: number, y: number, xp?: number, delay: number, fade: number }} fade：透明度跟进度的倍数（>1 先到不透明）
 */
export function enterValues(type, dir, reduced, i = 0, { headFirst = false } = {}) {
  if (reduced) return { x: 0, y: 0, delay: 0, fade: 1.6 };
  const stagger = Math.min(i, MAX_STAGGER) * STAGGER;
  if (type === 'day') return { x: 28 * dir, y: 0, delay: stagger, fade: 1.6 };
  if (type === 'push') return { x: 0, y: 0, xp: 30 * dir, delay: 0, fade: 1.6 };
  if (type === 'trip') {
    // 不乘倍数：透明度和位移一起慢慢到，旧内容这时已经走了，不会两份叠在一起
    if (headFirst && i === 0) return { x: 0, y: 0, delay: TRIP_HEAD_DELAY, fade: 1 };
    const k = headFirst ? i - 1 : i;
    return { x: 0, y: 18, delay: TRIP_BODY_DELAY + Math.min(k, MAX_STAGGER) * TRIP_STAGGER, fade: 1 };
  }
  if (type === 'tab') return { x: 0, y: 14, delay: stagger, fade: 1.6 };
  return { x: 0, y: 0, delay: 0, fade: 1.6 };
}

function animateIn(els, type, dir, reduced, { headFirst = false } = {}) {
  const width = window.innerWidth;
  return els.map((el, i) => {
    const start = enterValues(type, dir, reduced, i, { headFirst });
    const fromX = start.xp ? (start.xp / 100) * width : start.x;
    return animateSpring(el, {
      channel: 'page-enter',
      from: { x: fromX, y: start.y, o: 0 },
      to: { x: 0, y: 0, o: 1 },
      spring: 'smooth',
      delay: start.delay,
      commit: 'clear',
      render: ({ x, y, o }) => ({
        transform: x || y ? `translate(${num(x)}px, ${num(y)}px)` : 'none',
        opacity: num(Math.min(1, Math.max(0, o * start.fade))),
      }),
    });
  });
}

/** 换行程时旧内容淡出多久（样稿 leave()：180ms 缓出淡出 + 上移 10px） */
const TRIP_LEAVE_MS = 180;

function animateOut(ghost, type, dir, reduced) {
  const width = window.innerWidth;
  let to = 'none';
  if (!reduced && type === 'push') to = `translateX(${num(-0.12 * width * dir)}px)`;
  else if (!reduced && type === 'day') to = `translateX(${num(-20 * dir)}px)`;
  else if (!reduced && type === 'trip') to = 'translateY(-10px)';
  const frames = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }];
  // 换行程：旧的大标题、分段条、页面内容都很快让开（新的在同一个位置出来，慢慢交叉会糊成重影）；
  // 进出二级页面跟着位移走；其余很快让开
  const duration = type === 'trip' ? TRIP_LEAVE_MS : type === 'push' ? 'base' : 'fast';
  return animateTween(ghost, frames, { duration, easing: 'out', fill: 'forwards' });
}

/** 换行程时，新行程的数据晚一点才到、分段条那时才挂上：多等这么久（毫秒） */
const LATE_WINDOW_MS = 900;

/**
 * 换行程：新行程的数据还在读的时候，大标题区先是骨架、分段条还没有；数据到了分段条才挂上——这时它也要淡入浮上来
 * （不然它会在别的内容还在入场时一下子冒出来）。盯着主内容区，晚到的分段条按入场的节奏补一段动画。
 * @returns {() => void} 停止盯
 */
function animateLate(job, type, dir, reduced, startedAt) {
  const main = q('#main');
  if (!main || typeof MutationObserver === 'undefined') return () => {};
  const seen = new Set(job.entered);
  const run = () => {
    const el = q('[data-shell-strip]');
    if (!el || seen.has(el)) return;
    seen.add(el);
    job.entered.push(el);
    const elapsed = performance.now() - startedAt;
    const start = enterValues(type, dir, reduced, 1, { headFirst: true });
    animateSpring(el, {
      channel: 'page-enter',
      from: { x: 0, y: start.y, o: 0 },
      to: { x: 0, y: 0, o: 1 },
      spring: 'smooth',
      delay: Math.max(0, start.delay - elapsed),
      commit: 'clear',
      render: ({ y, o }) => ({ transform: y ? `translate(0px, ${num(y)}px)` : 'none', opacity: num(Math.min(1, Math.max(0, o * start.fade))) }),
    });
  };
  const mo = new MutationObserver(run);
  mo.observe(main, { childList: true, subtree: true });
  const timer = setTimeout(() => mo.disconnect(), LATE_WINDOW_MS);
  return () => {
    clearTimeout(timer);
    mo.disconnect();
  };
}

/**
 * 装上页面切换的驱动。
 * @param {{ setTransitionDriver: Function }} router
 */
export function installPageTransitions(router) {
  const prev = router.setTransitionDriver(async (ctx) => {
    const plan = transitionPlan(ctx.from, ctx.to, { direction: ctx.direction, kind: ctx.kind });
    // 只改查询参数 / 弹层：上一次换页的动画（如果还在播）照常播完，不打断
    if (plan.type === 'none' || typeof document === 'undefined') return ctx.commit();
    // 上一次还在入场：停在此刻的样子，幽灵从这个样子退出（不闪回完整不透明）
    const frozen = freezeCurrent();
    const reduced = prefersReducedMotion.peek();
    const type = reduced ? 'fade' : plan.type;
    const region = regions(plan.type);
    const oldHead = headText();
    const oldEls = region.old();
    const accent = rootAccent();
    const ghosts = oldEls.map((el) => {
      const g = makeGhost(el, accent);
      if (g) g.dataset.ghost = el.hasAttribute('data-shell-page') ? 'page' : 'chrome';
      return g;
    });
    clearFrozen(frozen);
    const job = { ghosts: ghosts.filter(Boolean), entered: [] };
    current = job;
    await ctx.commit();
    if (current !== job) {
      for (const g of job.ghosts) g.remove();
      return undefined;
    }
    if (ctx.signal?.aborted) {
      finishCurrent();
      return undefined;
    }
    // tab 之间：大标题没变（同一趟行程）就不动它——它的幽灵直接拿掉
    const headSame = Boolean(region.keepHead) && headText() === oldHead && Boolean(oldHead);
    if (headSame && ghosts[0]) {
      ghosts[0].remove();
      job.ghosts = job.ghosts.filter((g) => g !== ghosts[0]);
    }
    const els = region.enter(headSame).filter(Boolean);
    job.entered = els;
    const headFirst = Boolean(els[0]?.hasAttribute?.('data-shell-head'));
    const ins = animateIn(els, type, plan.dir, reduced, { headFirst });
    if (type === 'trip') job.stopLate = animateLate(job, type, plan.dir, reduced, performance.now());
    const outs = job.ghosts.map((g) => animateOut(g, type, plan.dir, reduced));
    // 这次导航之后又来了新的导航（连点分段条）：不在这里收尾——新的导航进驱动时会先把这次的入场停在此刻的样子
    // 再克隆成幽灵（freezeCurrent）；只改查询参数的导航不打断它
    Promise.all(outs.map((a) => a.finished)).then(() => {
      for (const g of job.ghosts) g.remove();
    });
    Promise.all([...ins, ...outs].map((a) => a.finished)).then(() => {
      if (current === job) current = null;
    });
    return undefined;
  });
  return () => router.setTransitionDriver(prev);
}
