// =====================================================================
// ui/SubmitButton.jsx：提交按钮（交互 3）：同一个位置 文字 → 转圈 → 对勾，宽度不跳。
//
// 不受控（最常用）：传一个返回 Promise 的 action，按钮自己管状态
//   <SubmitButton label="保存" action={() => saveExpense(form)} onSuccess={() => closeSheet()} block />
//   - 点击 → 转圈（真的在转）；期间再点无效（aria-disabled，不会重复提交）；
//   - action 成功 → 底色变成功色、对勾一笔描出来 → 描完调用 onSuccess（例如关掉面板）
//     → resetAfter 毫秒后回到文字（传 false 就停在对勾，交给调用方处理）；
//   - action 失败（抛错 / reject）→ 按钮左右摇头（弹簧冲量，自然衰减：约 8 / 4 / 2 / 1px，三次看得见的摆动，
//     0.45 秒左右停稳）、底色变危险色、文字变「重试」，
//     读屏播报 errorMessage；errorReset 毫秒后回到原文字；失败时可以直接再点重试。
//   - 太快的请求也至少转 minLoading 毫秒，不会一闪而过。
//
// 受控：传 state='idle'|'loading'|'success'|'error'，点击走 onClick，状态完全由调用方决定。
//
// 三种内容叠在同一个网格单元里，按钮宽度 = 最宽的那一层，切换时不跳。
// 默认 primary / lg；variant、size、block 同 Button。
// =====================================================================

import './Button.css';
import './SubmitButton.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring } from '../motion/animate.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { num } from '../motion/physics.js';
import { Pressable } from './Pressable.jsx';
import { Spinner } from './Spinner.jsx';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from './shake.js';
import { cx } from './util.js';

/** 摇头（参数见 ui/shake.js） */
function shake(el) {
  if (!el || prefersReducedMotion.value) return;
  animateSpring(el, {
    channel: 'submit-shake',
    from: { x: 0 },
    to: { x: 0 },
    velocity: { x: SHAKE_VELOCITY },
    spring: SHAKE_SPRING,
    precision: { x: SHAKE_PRECISION },
    commit: 'clear',
    reduced: 'instant',
    render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ action?: () => Promise<any>, state?: 'idle'|'loading'|'success'|'error', label?: any,
 *           loadingLabel?: string, successLabel?: any, errorLabel?: any, errorMessage?: string,
 *           onSuccess?: () => void, onError?: (e: any) => void, onClick?: (e: Event) => void,
 *           resetAfter?: number|false, errorReset?: number, minLoading?: number,
 *           variant?: string, size?: 'sm'|'md'|'lg', block?: boolean, disabled?: boolean, type?: string, class?: string }} props
 */
export function SubmitButton({
  action, state: controlled, label = '提交', loadingLabel = '正在提交', successLabel = null, errorLabel = '重试',
  errorMessage = '没有成功，请重试', onSuccess, onError, onClick, resetAfter = 1400, errorReset = 2600, minLoading = 420,
  variant = 'primary', size = 'lg', block = false, disabled = false, class: className, ...rest
}) {
  const [own, setOwn] = useState('idle');
  const state = controlled ?? own;
  const btnRef = useRef(null);
  const alive = useRef(true);
  const latest = useRef({ onSuccess, onError });
  latest.current = { onSuccess, onError };
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const busy = state === 'loading' || state === 'success';

  async function handleClick(e) {
    if (busy || disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
    if (controlled !== undefined || !action || e.defaultPrevented) return;
    setOwn('loading');
    const t0 = performance.now();
    try {
      await action();
      const left = minLoading - (performance.now() - t0);
      if (left > 0) await wait(left);
      if (alive.current) setOwn('success');
    } catch (error) {
      const left = minLoading - (performance.now() - t0);
      if (left > 0) await wait(left);
      if (!alive.current) return;
      setOwn('error');
      latest.current.onError?.(error);
    }
  }

  // 进入失败：抖一下；不受控时过一会儿回到原文字
  useLayoutEffect(() => {
    if (state !== 'error') return undefined;
    shake(btnRef.current);
    if (controlled !== undefined) return undefined;
    const t = setTimeout(() => alive.current && setOwn((s) => (s === 'error' ? 'idle' : s)), errorReset);
    return () => clearTimeout(t);
  }, [state]);

  // 进入成功：等对勾描完（transitionend）再交给调用方；之后按 resetAfter 回到文字
  useEffect(() => {
    if (state !== 'success') return undefined;
    const path = btnRef.current?.querySelector('.submit-btn__check-path');
    let done = false;
    let resetTimer = 0;
    const finish = () => {
      if (done || !alive.current) return;
      done = true;
      latest.current.onSuccess?.();
      if (controlled === undefined && resetAfter !== false) {
        resetTimer = setTimeout(() => alive.current && setOwn((s) => (s === 'success' ? 'idle' : s)), resetAfter);
      }
    };
    const onEnd = (ev) => {
      if (ev.propertyName === 'stroke-dashoffset') finish();
    };
    path?.addEventListener('transitionend', onEnd);
    // 兜底：过渡被系统跳过（标签页在后台等）也要往下走
    const fallback = setTimeout(finish, 900);
    return () => {
      path?.removeEventListener('transitionend', onEnd);
      clearTimeout(fallback);
      clearTimeout(resetTimer);
    };
  }, [state]);

  const announce = state === 'loading' ? loadingLabel : state === 'success' ? (typeof successLabel === 'string' ? successLabel : '已完成') : state === 'error' ? errorMessage : '';

  return (
    <Pressable
      elRef={btnRef}
      class={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', 'submit-btn', className)}
      data-state={state}
      disabled={disabled}
      aria-disabled={busy ? 'true' : undefined}
      aria-busy={state === 'loading' ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      <span class="submit-btn__stack">
        <span class="submit-btn__layer submit-btn__label">{label}</span>
        <span class="submit-btn__layer submit-btn__error" aria-hidden="true">{errorLabel}</span>
        <span class="submit-btn__layer submit-btn__spinner" aria-hidden="true">
          {/* 只在转圈（和它淡出的那一小段）时渲染，不常驻无限动画 */}
          {(state === 'loading' || state === 'success') && <Spinner size={size === 'sm' ? 18 : 22} />}
        </span>
        <span class="submit-btn__layer submit-btn__done" aria-hidden="true">
          <svg class="submit-btn__check" viewBox="0 0 24 24" focusable="false">
            <path class="submit-btn__check-path" d="M5.5 12.5 L10 17 L18.5 7.5" pathLength="1" />
          </svg>
          {successLabel && <span>{successLabel}</span>}
        </span>
      </span>
      <span class="visually-hidden" aria-live="polite">{announce}</span>
    </Pressable>
  );
}
