// =====================================================================
// ui/Tabs.jsx：标签页（下划线指示条弹簧跟随；交互 5 的标签版）。
//
//   <Tabs label="当天" idPrefix="day" value={tab} onChange={setTab}
//     tabs={[{ id: 'timeline', label: '时间轴' }, { id: 'map', label: '地图' }, { id: 'notes', label: '备注', badge: 2 }]} />
//   <div role="tabpanel" id={tabPanelId('day', tab)} aria-labelledby={tabId('day', tab)}>…</div>
//
// 指示条：
//   - 由三段拼成：左圆头、中间一段、右圆头。左右两条边各自弹过去（前沿 { 0.28 秒, 0.1 }、后沿 { 0.36 秒, 不回弹 }），
//     于是指示条先被“拉长”再收拢（Linear 那种橡皮筋手感），整段约半秒停稳；
//   - 只动 transform（圆头平移、中间一段平移 + 横向缩放）：在合成线程跑，主线程忙（渲染新内容、加载数据）也不掉帧；
//     圆头是单独的小圆点，不会因为横向缩放被压扁；
//   - position（可选，小数下标）：由外部连续驱动，例如下面的内容区横向滑动时传 scrollLeft / 宽度，
//     指示条跟着手指在两个标签之间连续移动（“可拖动”）；不传就按 value 弹簧跟随；
//   - 标签多到放不下时横向滚动，选中的标签自动滚到中间。
// 键盘：左右方向键 / Home / End 切换并聚焦（自动激活），role="tablist" / "tab"。
// =====================================================================

import './Tabs.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { animateSpringGroup, stopAnimation } from '../motion/animate.js';
import { useResizeObserver } from '../motion/hooks.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { num, clamp, lerp } from '../motion/physics.js';
import { Pressable } from './Pressable.jsx';
import { cx } from './util.js';

const CHANNEL = 'tabs-ink';
/** 指示条前沿 / 后沿的弹簧（前沿快、略带回弹；后沿慢一点、不回弹 → 先拉长再收拢，整段约半秒停稳） */
export const INK_LEADING = Object.freeze({ duration: 0.28, bounce: 0.1 });
export const INK_TRAILING = Object.freeze({ duration: 0.36, bounce: 0 });
/** 指示条的粗细（px，和 CSS 的 --tabs-ink-h 一致）：圆头的直径 */
const INK_H = 3;
/** 中间那一段的基准宽度（px）：横向缩放到实际长度 */
const BAR_BASE = 100;

/** 标签按钮的 id */
export const tabId = (prefix, id) => `${prefix}-tab-${id}`;
/** 对应内容面板的 id */
export const tabPanelId = (prefix, id) => `${prefix}-panel-${id}`;

/** 三段的渲染：a / b 是指示条左右两端（相对标签列表左边的 px） */
const renderCapL = ({ a }) => ({ transform: `translateX(${num(a)}px)` });
const renderCapR = ({ b }) => ({ transform: `translateX(${num(b - INK_H)}px)` });
const renderBar = ({ a, b }) => ({ transform: `translateX(${num(a + INK_H / 2)}px) scaleX(${num(Math.max(0, b - a - INK_H) / BAR_BASE, 4)})` });
const RENDERS = [renderCapL, renderBar, renderCapR];

/**
 * @param {{ tabs: Array<{ id: string, label: any, badge?: any, disabled?: boolean }>, value: string,
 *           onChange?: (id: string) => void, label?: string, idPrefix?: string, position?: number|null,
 *           size?: 'md'|'lg', class?: string }} props
 */
export function Tabs({ tabs, value, onChange, label, idPrefix = 'tabs', position = null, size = 'md', class: className, ...rest }) {
  const index = Math.max(0, tabs.findIndex((t) => t.id === value));
  const scrollerRef = useRef(null);
  const listRef = useRef(null);
  const inkRef = useRef(null);
  /** 指示条现在停在哪（{ a, b }：左右两端，相对列表左边） */
  const ink = useRef(null);
  const shownIndex = useRef(index);

  /** 第 i 个标签的指示条位置（只盖住文字那一段）：{ a, b } 左右两端 */
  function edgesFor(i) {
    const list = listRef.current;
    const labelEl = list?.querySelectorAll('.tabs__label')[i];
    if (!list || !labelEl) return null;
    const lr = list.getBoundingClientRect();
    const r = labelEl.getBoundingClientRect();
    return { a: r.left - lr.left, b: r.right - lr.left };
  }

  /** 指示条的三段（左圆头、中间、右圆头） */
  const inkParts = () => [...(inkRef.current?.children || [])];

  /** 小数下标 → 两个标签之间插值 */
  function edgesAt(pos) {
    const lo = clamp(Math.floor(pos), 0, tabs.length - 1);
    const hi = clamp(lo + 1, 0, tabs.length - 1);
    const a = edgesFor(lo);
    const b = edgesFor(hi);
    if (!a || !b) return a || b;
    const t = clamp(pos - lo, 0, 1);
    return { a: lerp(a.a, b.a, t), b: lerp(a.b, b.b, t) };
  }

  function place(e) {
    const parts = inkParts();
    if (!parts.length || !e) return;
    parts.forEach((el, k) => {
      stopAnimation(el, CHANNEL, { commit: false });
      Object.assign(el.style, RENDERS[k](e));
    });
    ink.current = e;
    inkRef.current.setAttribute('data-placed', '');
  }

  function springTo(i) {
    const parts = inkParts();
    const to = edgesFor(i);
    if (!parts.length || !to) return;
    const from = ink.current || to;
    const dir = Math.sign(i - shownIndex.current);
    shownIndex.current = i;
    ink.current = to;
    animateSpringGroup(parts.map((el, k) => [el, RENDERS[k]]), {
      channel: CHANNEL,
      current: () => from,
      to,
      // 往右走：右端（前沿）快、左端（后沿）慢，指示条先拉长再收拢；往左反过来
      spring: dir >= 0 ? { b: INK_LEADING, a: INK_TRAILING } : { a: INK_LEADING, b: INK_TRAILING },
      commit: 'final',
    });
  }

  /** 选中的标签滚到可见区中间 */
  function reveal(i) {
    const sc = scrollerRef.current;
    const tab = listRef.current?.children[i];
    if (!sc || !tab || sc.scrollWidth <= sc.clientWidth + 1) return;
    const left = tab.offsetLeft - (sc.clientWidth - tab.offsetWidth) / 2;
    sc.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion.value ? 'auto' : 'smooth' });
  }

  // 首帧：直接放好（绘制之前）
  useLayoutEffect(() => {
    if (position === null || position === undefined) place(edgesFor(index));
    else place(edgesAt(position));
  }, []);

  // 选中项变化 → 弹簧跟随（外部在连续驱动 position 时不弹）
  useLayoutEffect(() => {
    if (position !== null && position !== undefined) return;
    if (shownIndex.current !== index) springTo(index);
    reveal(index);
  }, [index]);

  // 外部连续驱动
  useLayoutEffect(() => {
    if (position === null || position === undefined) return;
    shownIndex.current = Math.round(position);
    place(edgesAt(position));
  }, [position]);

  // 尺寸变化（字体加载完、旋转屏幕）→ 重新量，不做动画
  useResizeObserver(listRef, () => {
    if (position === null || position === undefined) place(edgesFor(shownIndex.current));
    else place(edgesAt(position));
  });

  function select(i) {
    const t = tabs[i];
    if (!t || t.disabled) return;
    if (t.id !== value) onChange?.(t.id);
  }

  function onKeyDown(e) {
    const n = tabs.length;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      next = index;
      for (let k = 0; k < n; k++) {
        next = (next + step + n) % n;
        if (!tabs[next].disabled) break;
      }
    } else if (e.key === 'Home') next = tabs.findIndex((t) => !t.disabled);
    else if (e.key === 'End') next = n - 1 - [...tabs].reverse().findIndex((t) => !t.disabled);
    if (next === null || next < 0) return;
    e.preventDefault();
    select(next);
    listRef.current?.children[next]?.focus();
  }

  return (
    <div ref={scrollerRef} class={cx('tabs', `tabs--${size}`, className)} {...rest}>
      <div ref={listRef} class="tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <Pressable
            key={t.id}
            class="tabs__tab"
            feedback="none"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={i === index ? 'true' : 'false'}
            aria-controls={tabPanelId(idPrefix, t.id)}
            tabIndex={i === index ? 0 : -1}
            disabled={t.disabled}
            onClick={() => select(i)}
          >
            <span class="tabs__label">{t.label}</span>
            {t.badge !== undefined && t.badge !== null && t.badge !== 0 && <span class="tabs__badge">{t.badge}</span>}
          </Pressable>
        ))}
        <span ref={inkRef} class="tabs__ink" aria-hidden="true">
          <i class="tabs__ink-cap" />
          <i class="tabs__ink-bar" />
          <i class="tabs__ink-cap" />
        </span>
      </div>
    </div>
  );
}
