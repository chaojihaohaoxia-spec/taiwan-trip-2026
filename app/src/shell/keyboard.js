// =====================================================================
// shell/keyboard.js：手机软键盘是不是弹起来了（底栏据此沉下去，不顶在键盘上挡内容）。
//
// 两个信号一起看：
//   1. 焦点在可输入的地方（input / textarea / contenteditable，不算复选框、按钮这类）且是触屏（pointer: coarse）；
//   2. visualViewport 比布局视口矮了一截（overlay/keyboard.js 的 keyboardState，键盘真的弹起来了）。
// 任意一个成立就算“键盘开着”：iOS 聚焦后 visualViewport 要过一会儿才变，第 1 条让底栏先走，不会被键盘顶起来再落下。
// 桌面（鼠标）不算：没有软键盘，底栏不用让。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { coarsePointer } from '../lib/media.js';
import { keyboardState, watchKeyboard } from '../overlay/keyboard.js';

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** 这个元素聚焦时会弹出软键盘吗 */
export function isTextEntry(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NOT_TEXT.has(String(el.type || 'text').toLowerCase());
  return false;
}

/** 软键盘开着吗（hook） */
export function useKeyboardOpen() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const stop = watchKeyboard();
    const update = () => setFocused(isTextEntry(document.activeElement));
    let timer = 0;
    const onOut = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 0);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onOut);
    return () => {
      stop();
      clearTimeout(timer);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  const inset = keyboardState.value.inset;
  return coarsePointer.value && (focused || inset > 80);
}
