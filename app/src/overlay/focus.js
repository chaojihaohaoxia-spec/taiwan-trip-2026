// =====================================================================
// overlay/focus.js：弹层的焦点管理工具。
//
//   tabbables(container)     容器里能用 Tab 走到的元素（按 DOM 顺序，跳过隐藏、禁用、inert 的）
//   focusElement(el)         聚焦但不滚动页面（preventScroll），返回是否成功
//   trapTab(event, container) Tab / Shift+Tab 只在容器里循环
//   primeKeyboard()          iOS：先让隐藏输入框接住焦点把键盘叫出来（必须在点击回调里同步调用），
//                            弹层里的输入框挂上后再把焦点移过去，键盘不会收起再弹出
// =====================================================================

import { coarsePointer } from '../lib/media.js';
import { overlayRoot } from './dom.js';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  'summary',
  '[tabindex]',
].join(',');

function isVisible(el) {
  if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** 容器里能 Tab 到的元素 */
export function tabbables(container) {
  if (!container) return [];
  const list = [];
  for (const el of container.querySelectorAll(FOCUSABLE)) {
    if (el.tabIndex < 0 || el.closest('[inert]') || !isVisible(el)) continue;
    // 同名单选框只算选中的那个（和浏览器 Tab 行为一致）
    if (el.type === 'radio' && el.name && !el.checked) {
      const group = container.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      if ([...group].some((r) => r.checked)) continue;
    }
    list.push(el);
  }
  return list;
}

/** 打开页面以后用户有没有按过键盘、点过屏幕（从网址直接恢复的弹层：还没有） */
let userInput = false;
if (typeof document !== 'undefined') {
  const mark = () => {
    userInput = true;
  };
  document.addEventListener('keydown', mark, { capture: true, passive: true });
  document.addEventListener('pointerdown', mark, { capture: true, passive: true });
}

/**
 * 用户有没有操作过（键盘或指针）。没有时（刷新、从网址直接打开弹层）弹层把焦点放在容器上，
 * 不放在第一个按钮上——浏览器会把这种没有任何操作的程序聚焦当成键盘聚焦，画出焦点框。
 */
export function hadUserInput() {
  return userInput;
}

/** 聚焦（不滚动页面）。返回是否真的聚焦上了 */
export function focusElement(el) {
  if (!el || !el.isConnected || typeof el.focus !== 'function') return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    return false;
  }
  return document.activeElement === el;
}

/** Tab / Shift+Tab 在容器里循环 */
export function trapTab(event, container) {
  const list = tabbables(container);
  if (!list.length) {
    event.preventDefault();
    focusElement(container);
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = container.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first || active === container) {
      event.preventDefault();
      focusElement(last);
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    focusElement(first);
  }
}

let proxy = null;

/**
 * iOS 只有在用户点击的回调里“同步”调用 focus() 才会弹出键盘；弹层要等下一次渲染才挂上，来不及。
 * 解决：点击回调里先聚焦一个看不见的输入框（键盘弹起），弹层里 data-autofocus 的输入框挂上后
 * 把焦点移过去（iOS 在两个输入框之间移动焦点时键盘不会收起）。桌面（精细指针）什么都不做。
 * openOverlay(id, { keyboard: true }) 会替你调用。
 */
export function primeKeyboard() {
  if (typeof document === 'undefined' || !coarsePointer.peek()) return;
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.className = 'ov-keyboard-proxy';
    proxy.setAttribute('aria-hidden', 'true');
    proxy.tabIndex = -1;
    proxy.addEventListener('blur', () => proxy?.remove());
  }
  overlayRoot().appendChild(proxy);
  focusElement(proxy);
  // 保险：1.5 秒后还没有输入框接过焦点（比如弹层没打开），就放掉它，键盘收起
  const mine = proxy;
  setTimeout(() => {
    if (document.activeElement === mine) mine.blur();
  }, 1500);
}

/** 焦点还停在“叫键盘用的隐藏输入框”上吗 */
export function isKeyboardProxy(el) {
  return Boolean(proxy) && el === proxy;
}
