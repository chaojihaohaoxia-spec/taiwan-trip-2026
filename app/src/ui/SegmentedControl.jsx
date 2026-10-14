// =====================================================================
// ui/SegmentedControl.jsx：分段控件（交互 5：指示块弹簧跟随，可拖动）。
//
//   <SegmentedControl label="账本视图" value={tab} onChange={setTab}
//     options={[{ value: 'list', label: '明细' }, { value: 'stats', label: '分析' }, { value: 'settle', label: '结算' }]} />
//
// 行为：
//   - 点别的段：选中块用 --spring-snappy 滑过去；滑到一半再点别处，从当前位置、当前速度折返；
//   - 按在选中块上：立刻轻轻一缩（0.96，按下即反馈，不等拖动），松手或取消弹回；
//   - 拖动：按住选中块左右拖，块跟手（拖出两端有橡皮筋阻尼），块下面的文字跟着变成选中色；
//     松手按“当前位置 + 惯性投射”吸附到最近的段，手指的速度接进弹簧（甩一下能甩到更远的段）；
//   - 键盘：方向键 / Home / End 切换（role="radiogroup"，选中项 tabindex=0，其余 -1）；
//   - 首帧不需要 JS：选中块的位置由 CSS 变量 --seg-index 算出来，动画结束后也回到 CSS（窗口变宽不会错位）。
//
// 属性：options [{ value, label, icon?, disabled?, ariaLabel? }]、value、onChange(value)、label（读屏用的组名）、
//      size 'sm'|'md'|'lg'、block（撑满一行，默认 true）、disabled。
// 当成标签页用（切换下面的内容面板）时请用 ui/Tabs.jsx，语义是 tablist。
// =====================================================================

import './SegmentedControl.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { animateSpring, stopAnimation, clearStyle } from '../motion/animate.js';
import { trackDrag } from '../motion/gesture.js';
import { rubberBand, projectMomentum, clamp, num } from '../motion/physics.js';
import { Pressable } from './Pressable.jsx';
import { cx, renderIcon } from './util.js';

const CHANNEL = 'seg-thumb';

/** 读元素当前的 translateX（含正在播的动画） */
function currentX(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  return new DOMMatrixReadOnly(t).m41;
}

/**
 * @param {{ options: Array<{value:any,label?:any,icon?:any,disabled?:boolean,ariaLabel?:string}>, value: any,
 *           onChange?: (v: any) => void, label?: string, size?: 'sm'|'md'|'lg', block?: boolean,
 *           disabled?: boolean, class?: string }} props
 */
export function SegmentedControl({ options, value, onChange, label, size = 'md', block = true, disabled = false, class: className, ...rest }) {
  const n = options.length;
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const rootRef = useRef(null);
  const thumbRef = useRef(null);
  /** 选中块“正在去 / 已经停在”第几段 */
  const shownIndex = useRef(index);
  /** 正在拖动 */
  const dragging = useRef(false);
  const latest = useRef({ options, onChange, index });
  latest.current = { options, onChange, index };

  // 段宽：取布局宽度的小数值（offsetWidth 会取整，和 CSS 的 calc(--seg-index × 100%) 差零点几像素，动画结束时会跳一下；
  // getBoundingClientRect 又会把拖动时的 scale 算进去）
  const segWidth = () => {
    const el = thumbRef.current;
    return el ? parseFloat(getComputedStyle(el).width) || el.offsetWidth : 0;
  };

  /**
   * 把选中块弹到第 i 段。
   * @param {number} i
   * @param {{ from?: number, velocity?: number }} [o] from：起点 px（拖动松手时传手指位置）；velocity：px/s
   */
  function springTo(i, o = {}) {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const w = segWidth();
    const restIndex = shownIndex.current;
    shownIndex.current = i;
    animateSpring(thumb, {
      channel: CHANNEL,
      from: o.from === undefined ? undefined : { x: o.from },
      // 没有动画在播时：从“上一次停的位置”出发（此刻 CSS 变量已经指向新的段了，不能读计算值）
      current: () => ({ x: restIndex * w }),
      to: { x: i * w },
      velocity: o.velocity === undefined ? undefined : { x: o.velocity },
      spring: 'snappy',
      // 结束后去掉内联样式，回到 CSS 的 calc(--seg-index × 100%)，窗口尺寸变了也不会错位
      commit: 'clear',
      render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
    });
  }

  // 选中项变化（点击、键盘、外部改 value）→ 弹过去；动画中途再变，从当前位置和速度接力
  useLayoutEffect(() => {
    if (dragging.current) return;
    if (shownIndex.current !== index) springTo(index);
  }, [index]);

  function setUnder(i) {
    const items = rootRef.current?.querySelectorAll('.seg__item');
    items?.forEach((el, k) => el.toggleAttribute('data-under', k === i));
  }

  function endDragVisuals() {
    dragging.current = false;
    rootRef.current?.removeAttribute('data-dragging');
    thumbRef.current?.removeAttribute('data-pressed');
    clearStyle(thumbRef.current, ['transform']);
    setUnder(-1);
  }

  function onPointerDown(e) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = e.target.closest?.('.seg__item');
    const i = item ? Number(item.dataset.index) : -1;
    // 和 iOS 一样：只有按在“当前选中的那一段”上才能拖；按在别的段上就是普通点击
    if (i !== latest.current.index) return;
    const thumb = thumbRef.current;
    // 按下即反馈：选中块立刻缩一下（不等拖起来）；没拖起来就松手 / 被取消 → 弹回
    thumb.setAttribute('data-pressed', '');
    const release = () => {
      if (!dragging.current) thumb.removeAttribute('data-pressed');
    };
    const w = Math.max(segWidth(), 1);
    const max = (n - 1) * w;
    let startX = 0;
    let x = 0;
    trackDrag(e, {
      axis: 'x',
      threshold: 4,
      element: rootRef.current,
      onStart: () => {
        dragging.current = true;
        // 正在弹的话停在当前位置，从这里开始跟手
        const snap = stopAnimation(thumb, CHANNEL, { commit: false });
        startX = snap ? snap.values.x : currentX(thumb);
        x = startX;
        thumb.style.transform = `translateX(${num(x)}px)`;
        rootRef.current.setAttribute('data-dragging', '');
        thumb.setAttribute('data-pressed', '');
      },
      onMove: ({ dx }) => {
        x = rubberBand(startX + dx, 0, max, w);
        thumb.style.transform = `translateX(${num(x)}px)`;
        setUnder(clamp(Math.round(x / w), 0, n - 1));
      },
      onEnd: ({ vx }) => {
        endDragVisuals();
        // 松手：当前位置 + 惯性投射，吸附到最近的段；手指速度接进弹簧
        let target = clamp(Math.round((x + projectMomentum(vx, 0.99)) / w), 0, n - 1);
        if (latest.current.options[target]?.disabled) target = nearestEnabled(target);
        springTo(target, { from: x, velocity: vx });
        if (target !== latest.current.index) latest.current.onChange?.(latest.current.options[target].value);
      },
      onCancel: () => {
        if (!dragging.current) return;
        endDragVisuals();
        springTo(latest.current.index, { from: x });
      },
      // 没拖起来就松手、被取消（页面开始滚动）、往竖的方向走了：选中块弹回
      onFinish: release,
    });
  }

  function nearestEnabled(i) {
    const opts = latest.current.options;
    for (let d = 1; d < n; d++) {
      if (opts[i - d] && !opts[i - d].disabled) return i - d;
      if (opts[i + d] && !opts[i + d].disabled) return i + d;
    }
    return latest.current.index;
  }

  function select(i) {
    if (disabled || options[i]?.disabled || i === index) return;
    onChange?.(options[i].value);
  }

  function onKeyDown(e) {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next = null;
    if (e.key in keys) {
      next = index;
      for (let k = 0; k < n; k++) {
        next = (next + keys[e.key] + n) % n;
        if (!options[next].disabled) break;
      }
    } else if (e.key === 'Home') next = options.findIndex((o) => !o.disabled);
    else if (e.key === 'End') next = n - 1 - [...options].reverse().findIndex((o) => !o.disabled);
    if (next === null || next < 0) return;
    e.preventDefault();
    select(next);
    rootRef.current?.querySelectorAll('.seg__item')[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      class={cx('seg', `seg--${size}`, block && 'seg--block', className)}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      style={{ '--seg-n': n, '--seg-index': index }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      {...rest}
    >
      <span ref={thumbRef} class="seg__thumb" aria-hidden="true" />
      {options.map((o, i) => (
        <Pressable
          key={String(o.value)}
          class="seg__item"
          feedback="none"
          role="radio"
          aria-checked={i === index ? 'true' : 'false'}
          aria-label={o.ariaLabel}
          tabIndex={i === index ? 0 : -1}
          disabled={disabled || o.disabled}
          data-index={i}
          onClick={() => select(i)}
        >
          {o.icon && <span class="seg__icon">{renderIcon(o.icon, size === 'sm' ? 16 : 18)}</span>}
          {o.label !== undefined && <span class="seg__label">{o.label}</span>}
        </Pressable>
      ))}
    </div>
  );
}
