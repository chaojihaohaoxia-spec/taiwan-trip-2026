// =====================================================================
// pages/day/swipe.js：左右滑动换到前一天 / 后一天（和天数分段条同一个顺序：概览、D1、D2…）。
//
//   const hint = useDaySwipe(rootRef, slideRef, { tripId, dates, date, enabled });
//   <div ref={rootRef}><div ref={slideRef}>…页面内容…</div><SwipeHint hint={hint} /></div>
//
// 手感：
//   - 只接手指 / 触控笔（鼠标在桌面上用分段条和键盘就够了，拖动还会和选字冲突）；
//   - 从屏幕两边 24px 以内开始的不接（iOS Safari 的边缘返回 / 前进手势）；从输入框、左滑行、分段控件、能横向滚动的东西、
//     地图上开始的也不接（它们自己要横向手势）；
//   - 方向锁定交给 motion/gesture.js 的 trackDrag（一开始明显竖着走就放弃，页面照常竖着滚；页面写了 touch-action: pan-y）；
//   - 内容跟手（那一边有下一天时 1:1 跟到屏幕宽 35%，再往外有阻尼；没有下一天只有一点橡皮筋），边上浮出「D3 · 1/12 周二 ›」提示，
//     拖够了提示变成强调色并轻震一下（松手就会换）；
//   - 松手：拖过 96px（或屏幕宽 22%）或者往那边甩（> 520px/秒）→ 换天（replace，和点分段条一样不压历史；
//     旧内容由外壳的换页动效从此刻的位置接着退出去，新的一天从对面滑进来、分段条的滑块弹过去）；不够就带着手指速度弹回原位。
//   - 减弱动态效果：内容不跟手，只显示提示；松手照样能换。
// =====================================================================

import { useEffect, useRef, useState } from 'preact/hooks';
import { trackDrag } from '../../motion/gesture.js';
import { animateSpring, stopAnimation, clearStyle } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { haptic } from '../../lib/native.js';
import { replace, route } from '../../router/index.js';
import { canStartSwipe, neighborDays, swipeDecision, swipeOffset, SWIPE_COMMIT } from './model.js';
import { stripScroll } from './scroll.js';

const CH = 'day-swipe';

/** 从这里开始的手势不接（它们自己要横向手势、或者是输入） */
const BLOCK = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .k-swipe, .seg, .tabs, .stepper, .leaflet-container, [data-ov-allow-touch], [data-no-day-swipe]';

function blocked(target, root) {
  if (!(target instanceof Element)) return true;
  if (target.closest(BLOCK)) return true;
  // 能横向滚动的容器（还没滚到头的那一边）
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

function render(slide, off, width, reduced) {
  if (!slide) return;
  if (reduced) return;
  const fade = Math.min(0.42, (Math.abs(off) / width) * 0.7);
  slide.style.transform = off ? `translate3d(${num(off)}px, 0, 0)` : '';
  slide.style.opacity = fade ? String(num(1 - fade, 3)) : '';
}

/**
 * @param {{ current: HTMLElement|null }} rootRef  接手势的元素（页面根）
 * @param {{ current: HTMLElement|null }} slideRef 跟手移动的元素（页面内容，不含提示）
 * @param {{ tripId: string, dates: string[], date: string, labels?: Record<string, string>, enabled: boolean }} o
 *   labels：日期 → 那一天的标题（提示里显示）
 * @returns {null | { dir: 'prev'|'next', label: string, title: string, armed: boolean, progress: number }}
 */
export function useDaySwipe(rootRef, slideRef, { tripId, dates, date, labels = {}, enabled }) {
  const [hint, setHint] = useState(null);
  const latest = useRef({ tripId, dates, date, labels });
  latest.current = { tripId, dates, date, labels };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return undefined;
    let drag = null;

    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary || drag) return;
      const width = window.innerWidth;
      if (!canStartSwipe(e.clientX, width)) return;
      if (route.value?.sheets?.length) return;
      if (blocked(e.target, root)) return;
      const { dates: ds, date: d, tripId: tid, labels: titles } = latest.current;
      const nb = neighborDays(ds, d);
      if (!nb.prev && !nb.next) return;
      const reduced = prefersReducedMotion.peek();
      const slide = slideRef.current;
      let armed = false;
      let off = 0;
      const finish = () => {
        drag = null;
        root.removeAttribute('data-swiping');
      };
      const springBack = (vx = 0) => {
        setHint(null);
        if (!slide || reduced) {
          clearStyle(slide, ['transform', 'opacity']);
          return;
        }
        animateSpring(slide, {
          channel: CH,
          from: { x: off },
          to: { x: 0 },
          velocity: { x: vx },
          spring: 'smooth',
          commit: 'clear',
          render: ({ x }) => {
            const fade = Math.min(0.42, (Math.abs(x) / width) * 0.7);
            return { transform: `translate3d(${num(x)}px, 0, 0)`, opacity: num(1 - fade, 3) };
          },
        });
      };
      drag = trackDrag(e, {
        axis: 'x',
        threshold: 10,
        element: root,
        onStart: () => {
          stopAnimation(slide, CH, { commit: true });
          root.setAttribute('data-swiping', '');
        },
        onMove: ({ dx }) => {
          off = swipeOffset(dx, { width, hasPrev: Boolean(nb.prev), hasNext: Boolean(nb.next) });
          render(slide, off, width, reduced);
          const dir = dx < 0 ? 'next' : 'prev';
          const target = nb[dir];
          if (!target) {
            setHint(null);
            return;
          }
          const progress = Math.min(1, Math.abs(dx) / Math.min(SWIPE_COMMIT, width * 0.22));
          const nowArmed = progress >= 1;
          if (nowArmed && !armed) haptic('selection');
          armed = nowArmed;
          setHint({
            dir,
            label: target.label,
            title: target.name === 'trip' ? '行程概览' : titles[target.date] || '',
            armed,
            progress,
            // 页面此刻实际平移了多少（露出来的空隙宽度）：提示只放在空隙里，不压在卡片上
            // 减弱动态效果时内容不跟手（没有空隙）：按手指拖了多远算，提示照样滑进来
            gap: reduced ? Math.abs(dx) : Math.abs(off),
          });
        },
        onFinish: finish,
        onEnd: ({ dx, vx }) => {
          const decision = swipeDecision({ dx, vx, width, hasPrev: Boolean(nb.prev), hasNext: Boolean(nb.next) });
          if (!decision) {
            springBack(vx);
            return;
          }
          const target = nb[decision];
          haptic('selection');
          const to = target.name === 'trip' ? { name: 'trip', params: { tripId: tid } } : { name: 'day', params: { tripId: tid, date: target.date } };
          // 提示留着，跟着旧内容一起被换页动效带走（新的一页不会有它）
          replace(to, { scroll: stripScroll() }).finally(() => {
            // 换页没成（被别的导航抢先）：回到原位
            if (slide?.isConnected) springBack(0);
          });
        },
        onCancel: () => springBack(0),
      });
    };

    root.addEventListener('pointerdown', onDown);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      drag?.cancel();
    };
  }, [enabled]);

  return hint;
}
