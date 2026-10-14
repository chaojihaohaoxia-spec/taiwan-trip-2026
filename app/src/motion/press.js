// =====================================================================
// motion/press.js：按压反馈的行为（Pointer Events），给所有可点元素用。
//
//   const detach = attachPress(buttonEl, { feedback: 'scale' });   // 不用了记得 detach()
//   Preact 里用 motion/hooks.js 的 usePress(ref, options)，或直接用 ui/Pressable、ui/Button。
//
//   全局委托（main.jsx 启动时装一次 delegatePress(document)）：任何写了 data-press 属性、
//   又没有自己 attachPress 的元素（弹层里的按钮、外壳的按钮、页面里的简单按钮）都自动有同样的按压行为——
//   <button data-press="scale">…</button> 就够了，不用写任何 JS。行为和 attachPress 完全一样（同一套代码）。
//
// 行为（和 iOS 原生按钮一致）：
//   - 按下立刻反馈：元素上加 data-pressed，CSS（motion/press.css）用 --press-duration 的缓出缩到
//     --press-scale-auto（大元素缩得少：缩小量不超过约 12px，小按钮就是 --press-scale 0.96）；
//   - 松手：去掉 data-pressed，CSS 用 --spring-bouncy 弹回；点击照常由浏览器触发；
//   - 手指滑出取消：手指移出元素（触屏多给 24px 的“保留区”，鼠标出界即算）→ 回弹；滑回来 → 又按下；
//     在外面松手 → 不触发点击（万一浏览器还是派发了 click，也会被拦下）；滑回来在里面松手 → 触发点击
//     （触屏上浏览器把这种手势当拖动、不派发 click，这里补一次，保证只触发一次）；
//     页面开始滚动（浏览器发 pointercancel）→ 回弹、不触发点击。
//     注意：触屏上手指只要往能滚动的方向一动，浏览器就开始滚动并发 pointercancel——普通按钮“滑出再滑回重新按下”
//     只对鼠标有效；浮在内容上的按钮（悬浮加号、顶栏、替身按钮）写 data-press-float（touch-action: none），
//     手指才能滑出、滑回（见 press.css）；
//   - 键盘：空格 / 回车按住时显示按下态；
//   - 嵌套：卡片里的按钮被按下时，卡片本身不显示按下态；
//   - 禁用（disabled / aria-disabled="true" / options.disabled()）时没有反馈。
//
// 反馈样式（data-press 的值，CSS 在 motion/press.css）：
//   'scale'（默认）缩放；'highlight' 不缩放，只换底色（列表行）；'both' 都要；'none' 只要行为（自己写样式）。
// 悬停效果由组件自己写在 @media (hover: hover) 里（手机点过不会卡在悬停态）。
// =====================================================================

import { cssVar } from '../lib/theme.js';

const SUPPRESS = 'data-press-suppress';
let guardInstalled = false;

/**
 * 全局拦截：被标记“这次点击作废”的元素上的 click（捕获阶段，比组件自己的 onClick 先执行）。
 * 新的一次按下（pointerdown）开始时清掉所有标记：作废只针对“刚才那次按压”产生的 click，
 * 紧接着的正常点击不受影响。
 */
function installClickGuard() {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;
  window.addEventListener('click', (e) => {
    const el = e.target?.closest?.(`[${SUPPRESS}]`);
    if (!el) return;
    el.removeAttribute(SUPPRESS);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointerdown', () => {
    for (const el of document.querySelectorAll(`[${SUPPRESS}]`)) el.removeAttribute(SUPPRESS);
  }, true);
}

/** 让元素上的下一次 click 作废（到下一次按下或 350ms 后自动解除，不会误伤之后的正常点击） */
export function suppressNextClick(el, ms = 350) {
  installClickGuard();
  el.setAttribute(SUPPRESS, '');
  setTimeout(() => el.removeAttribute(SUPPRESS), ms);
}

let baseScale = null;
/** 读设计变量 --press-scale（0.96） */
function pressScale() {
  if (baseScale === null) {
    const v = typeof getComputedStyle === 'function' ? parseFloat(cssVar('--press-scale')) : NaN;
    baseScale = Number.isFinite(v) && v > 0 && v < 1 ? v : 0.96;
  }
  return baseScale;
}

/**
 * 纯函数：按元素大小算按下时的缩放。小元素用 base（0.96）；大元素缩小量不超过 maxShrink 像素。
 * @param {number} width
 * @param {number} height
 * @param {number} [base=0.96]
 * @param {number} [maxShrink=12]
 */
export function autoPressScale(width, height, base = 0.96, maxShrink = 12) {
  const size = Math.max(width, height, 1);
  return Math.round(Math.max(base, 1 - maxShrink / size) * 1000) / 1000;
}

/** 事件落在哪个可按元素上（最里层的 [data-press]） */
function innermost(e) {
  return e.target?.closest?.('[data-press]') || null;
}

/**
 * 一个元素的按压控制器（attachPress 和全局委托共用：同一套行为只写一份）。
 * @param {HTMLElement} el
 * @param {object} o 选项（见 attachPress）
 */
function createPressController(el, o) {
  let active = null;

  const isDisabled = () => Boolean(o.disabled?.()) || el.matches?.(':disabled') || el.getAttribute('aria-disabled') === 'true';

  function setPressed(on) {
    const was = el.hasAttribute('data-pressed');
    if (on === was) return;
    if (on) el.setAttribute('data-pressed', '');
    else el.removeAttribute('data-pressed');
    o.onPressChange?.(on);
  }

  function setScale(rect) {
    const s = o.scale === 'auto' ? autoPressScale(rect.width, rect.height, pressScale()) : Number(o.scale);
    el.style.setProperty('--press-scale-auto', String(s));
  }

  function within(e) {
    const r = active.rect;
    const m = active.margin;
    return e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m;
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 嵌套：只有离手指最近的那个可按元素（最里层的 [data-press]）响应，外层卡片不显示按下态
    if (e.isPrimary === false || e.__pressClaimed || innermost(e) !== el || isDisabled()) return;
    e.__pressClaimed = true;
    const rect = el.getBoundingClientRect();
    active = { id: e.pointerId, type: e.pointerType, rect, margin: e.pointerType === 'mouse' ? 0 : o.retention, inside: true, left: false };
    setScale(rect);
    setPressed(true);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    o.onPressStart?.(e);
  }

  function onMove(e) {
    if (!active || e.pointerId !== active.id) return;
    const inside = within(e);
    if (inside !== active.inside) {
      active.inside = inside;
      if (!inside) active.left = true;
      setPressed(inside);
    }
  }

  function finish(e, cancelled) {
    if (!active || e.pointerId !== active.id) return;
    const inside = !cancelled && active.inside && within(e);
    // 触屏 / 触控笔滑出去又滑回来松手：浏览器把这次当成“拖动”，不会派发 click（手指移动超过了点击的容差）；
    // iOS 原生按钮这时照样触发——这里补一次 click，再把浏览器万一还派发的那次拦下（不会触发两次）
    const synthesize = inside && active.left && active.type !== 'mouse';
    stopTracking();
    setPressed(false);
    if (!inside) suppressNextClick(el);
    o.onPressEnd?.(inside, e);
    if (synthesize) {
      el.click();
      suppressNextClick(el);
    }
  }

  const onUp = (e) => finish(e, false);
  const onCancel = (e) => finish(e, true);

  function stopTracking() {
    active = null;
    window.removeEventListener('pointermove', onMove, { passive: true });
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  }

  function onKeyDown(e) {
    if (e.target !== el || e.repeat || isDisabled()) return;
    if (e.key === ' ' || e.key === 'Enter') {
      setScale(el.getBoundingClientRect());
      setPressed(true);
    }
  }
  function onKeyUp(e) {
    if (e.key === ' ' || e.key === 'Enter') setPressed(false);
  }
  function onBlur() {
    if (!active) setPressed(false);
  }
  // 长按不弹出系统菜单（iOS 的放大镜 / 拷贝气泡）
  function onContextMenu(e) {
    if (active && e.pointerType !== 'mouse') e.preventDefault();
  }

  function reset() {
    stopTracking();
    setPressed(false);
  }

  return { onDown, onKeyDown, onKeyUp, onBlur, onContextMenu, reset };
}

const DEFAULTS = Object.freeze({ feedback: 'scale', scale: 'auto', retention: 24 });

/**
 * 给元素加上按压行为。
 * @param {HTMLElement} el
 * @param {{
 *   feedback?: 'scale'|'highlight'|'both'|'none',
 *   scale?: 'auto'|number,                 按下的缩放，默认 'auto'
 *   disabled?: () => boolean,
 *   retention?: number,                    触屏的保留区（px），默认 24
 *   onPressChange?: (pressed: boolean) => void,
 *   onPressStart?: (event: PointerEvent) => void,
 *   onPressEnd?: (inside: boolean, event: PointerEvent) => void,   inside=false 表示滑出取消了
 * }} [options]
 * @returns {() => void} detach
 */
export function attachPress(el, options = {}) {
  if (!el) return () => {};
  const o = { ...DEFAULTS, ...options };
  if (!el.hasAttribute('data-press')) el.setAttribute('data-press', o.feedback);
  const c = createPressController(el, o);
  el.addEventListener('pointerdown', c.onDown);
  el.addEventListener('keydown', c.onKeyDown);
  el.addEventListener('keyup', c.onKeyUp);
  el.addEventListener('blur', c.onBlur);
  el.addEventListener('contextmenu', c.onContextMenu);
  installClickGuard();

  return () => {
    c.reset();
    el.removeEventListener('pointerdown', c.onDown);
    el.removeEventListener('keydown', c.onKeyDown);
    el.removeEventListener('keyup', c.onKeyUp);
    el.removeEventListener('blur', c.onBlur);
    el.removeEventListener('contextmenu', c.onContextMenu);
  };
}

/** 全局委托用的控制器（元素 → 控制器；元素被移除后自动回收） */
const delegated = new WeakMap();
const delegatedRoots = new WeakSet();

function controllerFor(el) {
  let c = delegated.get(el);
  if (!c) {
    c = createPressController(el, { ...DEFAULTS });
    delegated.set(el, c);
  }
  return c;
}

/**
 * 全局委托：root（默认 document）里所有带 data-press 属性、没有自己 attachPress 的元素，都按同样的规则响应按压。
 * main.jsx 启动时调用一次；重复调用无害。缩放、高亮的样式照样由 data-press 的值决定（motion/press.css）。
 * 自己 attachPress 的元素（ui/Pressable 等）先处理并“认领”这次按压，委托就不再管它。
 * @param {Document|HTMLElement} [root=document]
 * @returns {() => void} 卸下
 */
export function delegatePress(root = typeof document !== 'undefined' ? document : null) {
  if (!root || delegatedRoots.has(root)) return () => {};
  delegatedRoots.add(root);
  const target = (e) => {
    const el = innermost(e);
    return el && (root === document || root.contains(el)) ? el : null;
  };
  const onDown = (e) => {
    if (e.__pressClaimed) return;
    const el = target(e);
    if (el) controllerFor(el).onDown(e);
  };
  const onKey = (type) => (e) => {
    const el = target(e);
    if (el && el === e.target) controllerFor(el)[type](e);
  };
  const onKeyDown = onKey('onKeyDown');
  const onKeyUp = onKey('onKeyUp');
  const onFocusOut = (e) => {
    const el = e.target?.closest?.('[data-press]');
    if (el) delegated.get(el)?.onBlur();
  };
  const onContextMenu = (e) => {
    const el = target(e);
    if (el) delegated.get(el)?.onContextMenu(e);
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('contextmenu', onContextMenu);
  installClickGuard();
  return () => {
    delegatedRoots.delete(root);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('keyup', onKeyUp);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('contextmenu', onContextMenu);
  };
}
