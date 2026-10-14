// =====================================================================
// overlay/keyboard.js：软键盘高度（visualViewport）。
//
// 手机上键盘弹起时，fixed 定位的底部面板还贴着“布局视口”底部，会被键盘挡住。
// visualViewport 是真正看得见的那块区域：被挡住的高度 = innerHeight − (vv.height + vv.offsetTop)。
// 底部面板打开期间订阅（引用计数），把它写进 CSS 变量，面板整体上移、最大高度变小，
// 提交按钮永远在键盘上面。
// =====================================================================

import { signal } from '@preact/signals';
import { keyboardInset } from './geometry.js';

/** { inset: 被键盘挡住的高度 px, height: 可见区域高度 px } */
export const keyboardState = signal({ inset: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight });

let users = 0;
let frame = 0;

function measure() {
  frame = 0;
  const vv = window.visualViewport;
  const height = Math.round(vv ? vv.height : window.innerHeight);
  const inset = vv
    ? keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop, scale: vv.scale })
    : 0;
  const prev = keyboardState.peek();
  if (prev.inset !== inset || prev.height !== height) keyboardState.value = { inset, height };
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}

/**
 * 开始跟踪键盘（引用计数）。返回停止函数。
 * @returns {() => void}
 */
export function watchKeyboard() {
  if (typeof window === 'undefined') return () => {};
  users += 1;
  if (users === 1) {
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    measure();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      const vv = window.visualViewport;
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      keyboardState.value = { inset: 0, height: window.innerHeight };
    }
  };
}
