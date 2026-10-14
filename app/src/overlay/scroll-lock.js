// =====================================================================
// overlay/scroll-lock.js：弹层打开时锁住背后页面的滚动（引用计数，多层弹层只锁一次）。
//
// 约定（router/README.md）：锁滚动时**不能改变 window.scrollY**——路由靠它记忆滚动位置。
// 所以不用 body { position: fixed; top: -scrollY } 那种写法，而是：
//   1. <html data-ov-scroll-lock> → CSS 里 overflow: hidden（文档不能再滚，位置原样保留）；
//      页面原来有经典滚动条（Windows 桌面）时再加 scrollbar-gutter: stable，内容不会左右跳；
//   2. iOS：再挂一个 touchmove 守卫——手指在弹层里“能滚的区域”之外滑动就 preventDefault，
//      防止橡皮筋效果带着整页晃（滚动穿透）。弹层里能滚的区域照常滚，到头了靠
//      CSS overscroll-behavior: contain 不把滚动传给页面。双指缩放不拦。
//   3. 解锁时如果 iOS 因为键盘之类的原因动过文档位置，滚回锁定时的位置；
//   4. 浏览器的滚动锚定全站关着（styles/base.css 的 overflow-anchor: none）：弹层开关时背后页面的内容变高变矮，
//      Chrome 不会悄悄改 scrollY（否则这里记下的位置就是被改过的，关掉后整页跳一下；iOS Safari 没有这个功能）。
// =====================================================================

const LOCK_ATTR = 'data-ov-scroll-lock';
const GUTTER_ATTR = 'data-ov-scroll-gutter';

let count = 0;
let saved = null;
/** 返回当前最上面那层弹层的元素（manager 注入），touchmove 守卫只放行它里面的滚动 */
let resolveTopLayer = () => null;

/** manager 注入“当前最上层”的查询函数 */
export function setScrollLockLayerResolver(fn) {
  resolveTopLayer = typeof fn === 'function' ? fn : () => null;
}

/** 从 target 往上找到 boundary 为止，有没有能滚动的祖先（或明确放行触摸的元素） */
function scrollableWithin(target, boundary) {
  let el = target && target.nodeType === 1 ? target : target?.parentElement;
  while (el) {
    if (el.hasAttribute('data-ov-allow-touch')) return true;
    if (el.tagName === 'INPUT' && el.type === 'range') return true;
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return true;
    if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
    if (el === boundary) break;
    el = el.parentElement;
  }
  return false;
}

function onTouchMove(event) {
  if (event.touches && event.touches.length > 1) return; // 双指缩放
  if (!event.cancelable) return;
  const layer = resolveTopLayer();
  const target = event.target;
  if (layer && target && layer.contains(target) && scrollableWithin(target, layer)) return;
  event.preventDefault();
}

function engage() {
  const html = document.documentElement;
  saved = { x: window.scrollX, y: window.scrollY };
  if (window.innerWidth - html.clientWidth > 0) html.setAttribute(GUTTER_ATTR, '');
  html.setAttribute(LOCK_ATTR, '');
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
}

function disengage() {
  const html = document.documentElement;
  html.removeAttribute(LOCK_ATTR);
  html.removeAttribute(GUTTER_ATTR);
  document.removeEventListener('touchmove', onTouchMove, { capture: true });
  if (saved && (Math.abs(window.scrollY - saved.y) > 1 || Math.abs(window.scrollX - saved.x) > 1)) {
    window.scrollTo({ top: saved.y, left: saved.x, behavior: 'instant' });
  }
  saved = null;
}

/**
 * 锁住页面滚动。返回解锁函数（重复调用无害）。
 * @returns {() => void}
 */
export function lockScroll() {
  if (typeof document === 'undefined') return () => {};
  count += 1;
  if (count === 1) engage();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) disengage();
  };
}

/** 现在是不是锁着（开发页、测试用） */
export function isScrollLocked() {
  return count > 0;
}
