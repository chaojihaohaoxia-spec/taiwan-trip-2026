// =====================================================================
// ui/Stepper.jsx：按钮变步进器（交互 6）。数量为 0 时是一个「＋ 添加」按钮；点一下原地展开成
// 「− 1 ＋」，数字滚动；减到 0 收回成按钮（归零还原）。给打包清单数量（todos.qty）、分摊份数等用。
//
//   <Stepper value={qty} onChange={setQty} unit="件" label="上衣数量" />
//   <Stepper value={n} onChange={setN} min={1} max={9} addLabel="加入" />   min 以下（含）显示成按钮
//
// 动效（一个进度 p：0 = 按钮，1 = 步进器；motion/animate.js 的 animateSpringGroup）：
//   - 展开（--spring-snappy）：底色从按钮那么大的胶囊沿着“按钮所在的一侧”伸展成整条（clip-path，圆角始终是胶囊），
//     底色从强调色过渡到强调色浅底；「添加」很快淡出，+、数字、− 依次淡入、往里收；
//   - 收回（--spring-smooth，不回弹）原路返回：−、数字、+ 依次淡出的同时「添加」已经开始淡入，
//     底色的颜色和形状走同一条弹簧——中间不会出现一段“空的深色胶囊”；
//   - 底色、颜色、三格、「添加」全部由同一个 p 驱动：展开到一半马上减回 0，从当前形状、当前速度收回（速度连续）；
//   - 数字：RollingNumber（只滚变了的位）；按住 + / − 连续加减，越按越快；
//   - 减弱动态效果：不伸展、不位移，直接换状态，文字淡入淡出（CSS）。
// 无障碍：展开后是 role="group"，数字是 spinbutton（上下方向键加减），− / + 有中文 aria-label；
//   键盘点「添加」后焦点移到 +，减到收回时焦点回到「添加」；禁用时（只读成员）键盘也改不了数量。
// align：'end'（默认，右对齐——列表行右侧）| 'start'。按钮在哪一侧，就从哪一侧伸展。
// =====================================================================

import './Stepper.css';
import { useLayoutEffect, useRef, useEffect } from 'preact/hooks';
import { useResizeObserver } from '../motion/hooks.js';
import { animateSpringGroup, stopAnimation } from '../motion/animate.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { clamp, num, stage } from '../motion/physics.js';
import { Pressable } from './Pressable.jsx';
import { RollingNumber } from './RollingNumber.jsx';
import { IconMinus, IconPlus } from './icons.js';
import { cx } from './util.js';

const CHANNEL = 'stepper';
/** 浏览器支持 color-mix 才对底色做插值（不支持就在结束时换色，形状照常连续） */
const canMix = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)');

/** 按住连加：第一次 420ms 后开始，之后越来越快（最快 60ms 一次） */
function useAutoRepeat(step) {
  const timer = useRef(0);
  const fired = useRef(false);
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);
  return {
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fired.current = false;
      let delay = 420;
      const tick = () => {
        if (!step()) return stop();
        fired.current = true;
        delay = Math.max(60, delay * 0.78);
        timer.current = setTimeout(tick, delay);
      };
      stop();
      timer.current = setTimeout(tick, delay);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    /** 按住连加过了，松手时的那次 click 不再加 */
    consumeClick() {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}

/**
 * @param {{ value: number, onChange: (v: number) => void, min?: number, max?: number, step?: number,
 *           addLabel?: string, unit?: string, label?: string, align?: 'end'|'start', disabled?: boolean,
 *           size?: 'md'|'sm', class?: string }} props
 */
export function Stepper({
  value = 0, onChange, min = 0, max = 99, step = 1, addLabel = '添加', unit, label = '数量',
  align = 'end', disabled = false, size = 'md', class: className, ...rest
}) {
  const open = value > min;
  const rootRef = useRef(null);
  const bgRef = useRef(null);
  const addRef = useRef(null);
  const minusRef = useRef(null);
  const valueRef = useRef(null);
  const plusRef = useRef(null);
  const shown = useRef(open);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const clampV = (v) => Math.min(max, Math.max(min, v));
  const change = (delta) => {
    if (disabled) return false;
    const cur = latest.current.value;
    const next = clampV(cur + delta);
    if (next === cur) return false;
    latest.current.onChange?.(next);
    // 立刻记下来：按住连加时下一次 tick 在重新渲染之前也能拿到新值
    latest.current.value = next;
    return true;
  };

  const plusRepeat = useAutoRepeat(() => change(step));
  const minusRepeat = useAutoRepeat(() => latest.current.value - step > min && change(-step));

  // 「添加」按钮的宽度 → CSS 变量（收起时底色就是这么宽的胶囊）
  useResizeObserver(addRef, () => {
    const el = addRef.current;
    if (el) rootRef.current?.style.setProperty('--stepper-add-w', `${el.offsetWidth}px`);
  });

  // 焦点跟着走：在「添加」上按回车 / 点击展开 → 焦点移到 +；在 − 上减到收回 → 焦点回到「添加」。
  // 要在状态变化“之前”记下焦点在哪：变化后原来的按钮会被设成 inert，浏览器已经把焦点丢到 body 上了。
  const focusNext = useRef(null);
  const rememberFocus = (target) => {
    const active = document.activeElement;
    if (active && rootRef.current?.contains(active)) focusNext.current = target;
  };
  useLayoutEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'plus' && open) plusRef.current?.focus({ preventScroll: true });
    if (target === 'add' && !open) addRef.current?.focus({ preventScroll: true });
  }, [open]);

  // 按钮 ↔ 步进器（见文件头“动效”）
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (shown.current === open) {
      root.removeAttribute('data-phase');
      return;
    }
    shown.current = open;
    const parts = [bgRef, addRef, minusRef, valueRef, plusRef].map((r) => r.current);
    if (prefersReducedMotion.peek()) {
      for (const el of parts) stopAnimation(el, CHANNEL, { commit: false });
      root.removeAttribute('data-phase');
      return;
    }
    const W = root.offsetWidth;
    const addW = addRef.current.offsetWidth;
    const span = Math.max(0, W - addW);
    const cs = getComputedStyle(root);
    const closedColor = cs.getPropertyValue('--stepper-bg-closed').trim();
    const openColor = cs.getPropertyValue('--stepper-bg-open').trim();
    const end = align !== 'start';
    const inward = end ? 14 : -14;
    // 动画期间三格和「添加」都看得见（静止时收起的那一方 visibility: hidden）
    root.setAttribute('data-phase', 'moving');
    // 往按钮那一侧收一点；贴着边的那一格（右对齐时的 +）不平移——平移会伸出步进器的边界，撑出横向滚动
    const fade = (a, b, move = true) => ({ p }) => ({
      opacity: num(stage(p, a, b)),
      translate: move ? `${num(inward * (1 - clamp(p, 0, 1.2)))}px 0` : '0px 0',
    });
    const anim = animateSpringGroup([
      [bgRef.current, ({ p }) => {
        const inset = num(span * (1 - clamp(p, 0, 1)));
        const out = { clipPath: end ? `inset(0 0 0 ${inset}px round 999px)` : `inset(0 ${inset}px 0 0 round 999px)` };
        if (canMix && closedColor && openColor) out.backgroundColor = `color-mix(in srgb, ${openColor} ${num(stage(p, 0.1, 0.6) * 100, 1)}%, ${closedColor})`;
        return out;
      }],
      // 「添加」：展开时很快淡出；收回时 + 还没淡完它就已经出来了（交叉，不留空白）
      [addRef.current, ({ p }) => ({ opacity: num(1 - stage(p, 0.1, 0.45)) })],
      // 离按钮近的先出来（右对齐时 + 最先、− 最后）
      [plusRef.current, end ? fade(0.15, 0.55, false) : fade(0.35, 0.75)],
      [valueRef.current, fade(0.25, 0.65)],
      [minusRef.current, end ? fade(0.35, 0.75) : fade(0.15, 0.55, false)],
    ], {
      channel: CHANNEL,
      current: () => ({ p: open ? 0 : 1 }),
      to: { p: open ? 1 : 0 },
      spring: open ? 'snappy' : 'smooth',
      commit: 'clear',
    });
    anim.finished.then((done) => {
      if (done) rootRef.current?.removeAttribute('data-phase');
    });
  }, [open]);

  function onValueKey(e) {
    if (disabled) return;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step };
    if (e.key in map) {
      e.preventDefault();
      change(map[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange?.(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange?.(max);
    }
  }

  return (
    <div
      ref={rootRef}
      class={cx('stepper', `stepper--${size}`, className)}
      data-state={open ? 'open' : 'closed'}
      data-align={align}
      aria-disabled={disabled ? 'true' : undefined}
      {...rest}
    >
      <span ref={bgRef} class="stepper__bg" aria-hidden="true" />
      <Pressable
        elRef={addRef}
        class="stepper__add"
        disabled={disabled}
        inert={open}
        aria-hidden={open ? 'true' : undefined}
        tabIndex={open ? -1 : 0}
        onClick={() => {
          rememberFocus('plus');
          change(step);
        }}
      >
        <IconPlus size={18} aria-hidden="true" />
        <span>{addLabel}</span>
      </Pressable>
      <div class="stepper__controls" role="group" aria-label={label} inert={!open} aria-hidden={open ? undefined : 'true'}>
        <Pressable
          elRef={minusRef}
          class="stepper__btn stepper__btn--minus"
          aria-label="减少"
          disabled={disabled}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            if (minusRepeat.consumeClick()) return;
            if (latest.current.value - step <= min) rememberFocus('add');
            change(-step);
          }}
          onPointerDown={minusRepeat.onPointerDown}
          onPointerUp={minusRepeat.onPointerUp}
          onPointerCancel={minusRepeat.onPointerCancel}
          onPointerLeave={minusRepeat.onPointerLeave}
        >
          <IconMinus size={18} aria-hidden="true" />
        </Pressable>
        <span
          ref={valueRef}
          class="stepper__value"
          role="spinbutton"
          tabIndex={open ? 0 : -1}
          aria-label={label}
          aria-disabled={disabled ? 'true' : undefined}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={unit ? `${value} ${unit}` : String(value)}
          onKeyDown={onValueKey}
        >
          <RollingNumber value={Math.max(value, min + step)} class="stepper__num" />
          {unit && <span class="stepper__unit">{unit}</span>}
        </span>
        <Pressable
          elRef={plusRef}
          class="stepper__btn stepper__btn--plus"
          aria-label="增加"
          disabled={disabled || value >= max}
          tabIndex={open ? 0 : -1}
          onClick={() => !plusRepeat.consumeClick() && change(step)}
          onPointerDown={plusRepeat.onPointerDown}
          onPointerUp={plusRepeat.onPointerUp}
          onPointerCancel={plusRepeat.onPointerCancel}
          onPointerLeave={plusRepeat.onPointerLeave}
        >
          <IconPlus size={18} aria-hidden="true" />
        </Pressable>
      </div>
    </div>
  );
}
