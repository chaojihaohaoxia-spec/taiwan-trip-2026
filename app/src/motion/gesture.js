// =====================================================================
// motion/gesture.js：拖动手势的跟踪（指示块拖动、Toast 下滑关闭、以后的左滑删除都用它）。
//
//   el.addEventListener('pointerdown', (e) => {
//     trackDrag(e, {
//       axis: 'x',                         // 只认横向：一开始就明显竖着走的，放弃（让页面正常滚动）
//       onStart: (d) => { … },             // 超过阈值、确认是拖动时
//       onMove: (d) => { … d.dx … },       // 跟手
//       onEnd: (d) => { … d.vx … },        // 松手：带速度（px/s），交给 animateSpring 的 velocity 接力
//       onCancel: () => { … },             // 被系统打断（来电、滚动接管……）
//     });
//   });
//
// 记得给可拖的元素写 CSS：横向拖用 touch-action: pan-y（竖向滚动照常交给浏览器），竖向拖用 pan-x。
// 拖动过后紧跟着的那次 click 会被作废（不会松手时误点到下面的按钮）。
// =====================================================================

import { VelocityTracker } from './physics.js';
import { suppressNextClick } from './press.js';

/**
 * @param {PointerEvent} start pointerdown 事件
 * @param {{
 *   axis?: 'x'|'y'|'both',
 *   threshold?: number,                     判定开始拖动的距离（px），默认 6
 *   element?: Element,                      捕获指针的元素（默认 start.currentTarget）
 *   onStart?: (d: DragInfo) => void,
 *   onMove?: (d: DragInfo) => void,
 *   onEnd?: (d: DragInfo) => void,
 *   onCancel?: () => void,
 *   onTap?: () => void,                     没拖起来就松手（轻点）
 *   onFinish?: () => void,                  这次按压结束了（不管拖没拖起来、松手还是被取消），收尾用
 * }} o
 * @typedef {{ dx:number, dy:number, x:number, y:number, vx:number, vy:number, event: PointerEvent }} DragInfo
 * @returns {{ cancel: () => void, readonly dragging: boolean }}
 */
export function trackDrag(start, o = {}) {
  const axis = o.axis || 'both';
  const threshold = o.threshold ?? 6;
  const el = o.element || start.currentTarget;
  const id = start.pointerId;
  const x0 = start.clientX;
  const y0 = start.clientY;
  const tx = new VelocityTracker();
  const ty = new VelocityTracker();
  tx.add(x0, start.timeStamp);
  ty.add(y0, start.timeStamp);
  let dragging = false;
  let finished = false;

  const info = (ev, withVelocity = false) => ({
    dx: ev.clientX - x0,
    dy: ev.clientY - y0,
    x: ev.clientX,
    y: ev.clientY,
    vx: withVelocity ? tx.velocity(ev.timeStamp) : 0,
    vy: withVelocity ? ty.velocity(ev.timeStamp) : 0,
    event: ev,
  });

  function onMove(ev) {
    if (ev.pointerId !== id || finished) return;
    tx.add(ev.clientX, ev.timeStamp);
    ty.add(ev.clientY, ev.timeStamp);
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!dragging) {
      const dist = axis === 'x' ? Math.abs(dx) : axis === 'y' ? Math.abs(dy) : Math.hypot(dx, dy);
      const off = axis === 'x' ? Math.abs(dy) : axis === 'y' ? Math.abs(dx) : 0;
      if (off > threshold && off > dist) {
        // 明显在往另一个方向走：不是我们的手势
        stop();
        o.onCancel?.();
        o.onFinish?.();
        return;
      }
      if (dist < threshold) return;
      dragging = true;
      try {
        el?.setPointerCapture?.(id);
      } catch {
        /* 有的浏览器在指针已经抬起时会抛错，忽略 */
      }
      o.onStart?.(info(ev));
    }
    o.onMove?.(info(ev, true));
  }

  function onUp(ev) {
    if (ev.pointerId !== id || finished) return;
    tx.add(ev.clientX, ev.timeStamp);
    ty.add(ev.clientY, ev.timeStamp);
    const wasDragging = dragging;
    stop();
    if (wasDragging) {
      if (el) suppressNextClick(el);
      o.onEnd?.(info(ev, true));
    } else {
      o.onTap?.();
    }
    o.onFinish?.();
  }

  function onCancel(ev) {
    if (ev.pointerId !== id || finished) return;
    const wasDragging = dragging;
    stop();
    if (wasDragging) o.onCancel?.();
    o.onFinish?.();
  }

  function stop() {
    finished = true;
    dragging = false;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    try {
      if (el?.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    } catch {
      /* 忽略 */
    }
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);

  return {
    cancel() {
      if (!finished) {
        const was = dragging;
        stop();
        if (was) o.onCancel?.();
        o.onFinish?.();
      }
    },
    get dragging() {
      return dragging;
    },
  };
}

/** 惯性滚动的减速（每毫秒保留率）：和 iOS 滚动的 normal 一致，也和底部面板的松手推算一致 */
export const MOMENTUM_DECELERATION = 0.998;

/**
 * 惯性滚动（接力用）：手势被我们接管（preventDefault）之后浏览器不会再自己惯性滚，
 * 松手时用这个按手指的速度接着滚（例如底部面板拉到最高档后同一个手势接着滚内容）。
 *   momentumScroll(scroller, 1200)   // px/s，正数 = scrollTop 增大（内容往上走）
 * 停止：速度降到很小、滚到头、手指再次按住（元素上派发 'momentumstop' 事件，或 touchstart / wheel）。
 * @param {HTMLElement} scroller
 * @param {number} velocity px/s
 * @returns {() => void} 立即停止
 */
export function momentumScroll(scroller, velocity) {
  if (!scroller || !Number.isFinite(velocity) || Math.abs(velocity) < 40) return () => {};
  const lnR = Math.log(MOMENTUM_DECELERATION);
  const start = scroller.scrollTop;
  const v0 = velocity / 1000; // px/ms
  let t0 = 0;
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    scroller.removeAttribute('data-momentum');
    scroller.removeEventListener('momentumstop', stop);
    scroller.removeEventListener('touchstart', stop);
    scroller.removeEventListener('wheel', stop);
  };
  const tick = (now) => {
    if (stopped) return;
    if (!t0) t0 = now;
    const t = now - t0;
    const v = v0 * MOMENTUM_DECELERATION ** t;
    const target = start + (v0 * (MOMENTUM_DECELERATION ** t - 1)) / lnR;
    const before = scroller.scrollTop;
    scroller.scrollTop = target;
    // 滚到头（位置没变）或速度很小了：停
    if (Math.abs(v) < 0.02 || (t > 32 && Math.abs(scroller.scrollTop - before) < 0.1)) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  scroller.setAttribute('data-momentum', '');
  scroller.addEventListener('momentumstop', stop);
  scroller.addEventListener('touchstart', stop, { passive: true });
  scroller.addEventListener('wheel', stop, { passive: true });
  raf = requestAnimationFrame(tick);
  return stop;
}
