// =====================================================================
// motion/liquid.js：液态玻璃（iOS 26 Liquid Glass）的两个动效原语——底栏的选中块就是用它们做的（shell/TabBar.jsx）。
//
//   1. stretchSpring(el, { channel, current, to, velocity, spring, stretch, render })
//      带“拉伸”的弹簧位移：位置照常走弹簧（可打断、速度接力），每一帧再按此刻的速度把形状沿运动方向拉长、
//      竖向略压扁、整体往后拖一点（像一滴液体被拖着走）；停下时弹簧的一点过冲就是“回弹”。
//      拉伸是派生通道（animate.js 的 derive）：跟着采样进 WAAPI 关键帧，在合成线程跑，只动 transform。
//        stretchSpring(thumb, {
//          channel: 'thumb', current: () => 0, to: 3,            // 单位随便（底栏用“第几格”）
//          spring: { duration: 0.48, bounce: 0.24 },
//          stretch: { max: 0.22, vRef: 6 },                       // vRef 和位置同一个单位（格/秒）
//          render: ({ x, sx, sy, shift }) => ({ transform: `translateX(${(x + shift) * 100}%) scale(${sx}, ${sy})` }),
//        });
//
//      还能再加别的派生通道（extra / extraScale，例如按位置淡一点：底栏选中块从 ＋ 后面穿过时变淡），同样进关键帧。
//
//   2. trackSlideSelect(pointerdownEvent, { centers, selectable, bounds, onFrame, onHover, onEnd … })
//      横向“按住拖动选择”：按下时量好各格的中心和可拖区域（之后不再读布局），每一帧（rAF）把手指位置换算成
//      “第几格”（小数）交给 onFrame；高亮的那一格变了调 onHover（配 haptic）——换格有迟滞（越过两格中线 bias 格才换），
//      手指停在中线上抖也不会来回跳；手指滑出区域（上下左右各留一点余量）算“出去了”，在外面松手 = 取消。
//      松手的落点从高亮的那一格出发、按松手速度往前推一点（project 秒）再用同样的迟滞判断：停着松手就是高亮的那格，甩一下能甩过去。
//      轻点（没超过阈值）也会走到 onEnd（dragging: false），由调用方决定怎么切（底栏在松手时直接切，不等原生 click——
//      iOS 长按以后不发 click）。
//
//   纯函数（Node 里能测）：liquidStretch（速度 → 拉伸）、followSpring（每帧追手指的弹簧积分）、
//   slotPosition（手指 x → 第几格）、nearestSelectable（带迟滞的最近可选格）、rubberClamp（可选范围外的橡皮筋）。
//
// 减弱动态效果：stretchSpring 走 animateSpring 的短补间（速度为 0，所以也不拉伸）；
//   拖动选择本身不是动画，照常可用，选中块怎么跟（跳格 + 淡入）由调用方按 prefersReducedMotion 决定。
// =====================================================================

import { animateSpring } from './animate.js';
import { rubberBand, VelocityTracker } from './physics.js';

/** 拉伸的默认参数：最多拉长 22%、竖向按拉长量的 45% 压扁、往后拖拉长量的 30%；vRef 是“拉到 63% 那么长”的速度 */
export const LIQUID_STRETCH = Object.freeze({ max: 0.22, vRef: 6, squash: 0.45, lag: 0.3 });

/**
 * 速度 → 形状（纯函数）。拉长量随速度平滑饱和：s = max·(1 − e^(−|v|/vRef))。
 * @param {number} v 速度（和位置同一单位 / 秒）
 * @param {{ max?: number, vRef?: number, squash?: number, lag?: number }} [o]
 * @returns {{ sx: number, sy: number, shift: number }} shift：往运动的反方向挪多少（位置单位），拖在后面的那头更长
 */
export function liquidStretch(v, o = {}) {
  const { max, vRef, squash, lag } = { ...LIQUID_STRETCH, ...o };
  const speed = Math.abs(Number(v) || 0);
  const s = max * (1 - Math.exp(-speed / Math.max(vRef, 1e-6)));
  return { sx: 1 + s, sy: 1 - s * squash, shift: s === 0 ? 0 : -Math.sign(v) * s * lag };
}

/**
 * 带拉伸的弹簧位移（见文件头 1）。位置是一个数 x；render 收到 { x, sx, sy, shift, ...extra(x) }。
 * 同一 channel 上的新动画从当前位置、当前速度接着走（拖动松手时把手指 / 跟随的速度传进 velocity）。
 * extra(x) 返回别的派生通道（只依赖位置，例如 { o: 透明度 }），extraScale 是它们的幅度（关键帧折线简化按它归一）。
 * @param {Element} el
 * @param {{ channel?: string, from?: number, current?: () => number, to: number, velocity?: number,
 *           spring?: any, stretch?: object, render: (v: { x: number, sx: number, sy: number, shift: number }) => object,
 *           extra?: (x: number) => Record<string, number>, extraScale?: Record<string, number>,
 *           commit?: 'final'|'clear'|'none', reduced?: 'tween'|'instant'|'ignore' }} o
 */
export function stretchSpring(el, o) {
  const k = { ...LIQUID_STRETCH, ...o.stretch };
  return animateSpring(el, {
    channel: o.channel,
    from: o.from === undefined ? undefined : { x: o.from },
    current: o.current ? () => ({ x: o.current() }) : undefined,
    to: { x: o.to },
    velocity: o.velocity === undefined ? undefined : { x: o.velocity },
    spring: o.spring ?? 'bouncy',
    commit: o.commit ?? 'final',
    reduced: o.reduced,
    derive: (values, velocities) => ({ ...liquidStretch(velocities.x || 0, k), ...(o.extra ? o.extra(values.x) : null) }),
    deriveScale: { sx: k.max, sy: k.max * k.squash, shift: k.max * k.lag, ...o.extraScale },
    render: o.render,
  });
}

/**
 * 追手指的弹簧（每帧积分一次，纯函数，就地修改 state）。拖动时选中块不直接贴着手指，而是被一根很短的弹簧拽着走：
 * 手指一甩，选中块先跟不上、被拉长，再追上——速度就是拉伸的来源。
 * @param {{ x: number, v: number }} state
 * @param {number} target
 * @param {number} dt 秒（夹在 0–0.05：切到后台回来那一帧不会飞出去）
 * @param {{ duration?: number, damping?: number }} [o] 感知时长（秒）、阻尼比
 */
export function followSpring(state, target, dt, { duration = 0.2, damping = 0.86 } = {}) {
  const w = (2 * Math.PI) / duration;
  let left = Math.min(Math.max(dt, 0), 0.05);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    const a = w * w * (target - state.x) - 2 * damping * w * state.v;
    state.v += a * h;
    state.x += state.v * h;
    left -= h;
  }
  return state;
}

/** 手指 x → 第几格（小数；格子等宽、centers 是各格中心的 x） */
export function slotPosition(x, centers) {
  if (!centers.length) return 0;
  if (centers.length === 1) return 0;
  const pitch = (centers[centers.length - 1] - centers[0]) / (centers.length - 1);
  return pitch ? (x - centers[0]) / pitch : 0;
}

/**
 * 离 u 最近的可选格，带迟滞（防抖）：当前高亮的是 prev 时，别的格子要比它近出 2·bias 格才换过去——
 * 相邻两格就是“越过中线 bias 格才换”，在中线附近来回抖不会一直换格（高亮、触感不闪）；
 * 隔着 ＋（不能选）的两格，在 ＋ 正中两侧 bias 以内都停在原来那格。距离相同时也留在 prev。没有可选格返回 -1。
 * @param {number} u 手指在第几格（小数）
 * @param {number} count
 * @param {(i: number) => boolean} selectable
 * @param {number} [prev=-1] 当前高亮的格（没有给 -1：直接取最近的）
 * @param {number} [bias=0.12]
 */
export function nearestSelectable(u, count, selectable, prev = -1, bias = 0.12) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    if (!selectable(i)) continue;
    const d = Math.abs(u - i);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && i === prev)) {
      best = i;
      bestD = d;
    }
  }
  if (best < 0 || prev < 0 || prev >= count || best === prev || !selectable(prev)) return best;
  return Math.abs(u - prev) - bestD > 2 * bias ? best : prev;
}

/** 可选范围 [min, max] 以外按橡皮筋收住（最多再出去 reach 格） */
export function rubberClamp(u, min, max, reach = 0.5) {
  return rubberBand(u, min, max, reach);
}

/**
 * 横向按住拖动选择（见文件头 2）。按下时调用；返回 { cancel() }。
 * @param {PointerEvent} start
 * @param {{
 *   centers: number[],                      各格中心（视口 x，按下时量好）
 *   selectable?: (i: number) => boolean,    哪些格能选（默认都能）
 *   bounds: { left: number, right: number, top: number, bottom: number },  可拖区域（视口坐标）
 *   slop?: { x?: number, y?: number },      滑出多远算“出去了”，默认 { x: 24, y: 28 }
 *   threshold?: number,                     超过多少 px 算拖动（默认 6）
 *   bias?: number,                          换格的迟滞（格，默认 0.12；见 nearestSelectable）
 *   project?: number,                       松手落点按速度往前推多少秒（默认 0.08）
 *   onFrame?: (f: { u: number, nearest: number, inside: boolean, dragging: boolean, dt: number }) => void,
 *   onDragStart?: () => void,
 *   onHover?: (nearest: number, prev: number) => void,   高亮的格变了（出去了是 -1）
 *   onEnd?: (e: { u: number, nearest: number, inside: boolean, dragging: boolean, cancelled: boolean, vu: number }) => void,
 *                                           nearest 是松手的落点（高亮的格 + 按速度外推，同样的迟滞）
 * }} o
 */
export function trackSlideSelect(start, o) {
  const centers = o.centers;
  const count = centers.length;
  const selectable = o.selectable || (() => true);
  const slop = { x: 24, y: 28, ...o.slop };
  const threshold = o.threshold ?? 6;
  const bias = o.bias ?? 0.12;
  const project = o.project ?? 0.08;
  const b = o.bounds;
  const id = start.pointerId;
  const x0 = start.clientX;
  const tracker = new VelocityTracker();
  let x = start.clientX;
  let y = start.clientY;
  tracker.add(x, start.timeStamp);
  let dragging = false;
  let finished = false;
  let raf = 0;
  let last = 0;

  const insideAt = (px, py) => px >= b.left - slop.x && px <= b.right + slop.x && py >= b.top - slop.y && py <= b.bottom + slop.y;
  /** 手指此刻：第几格、在不在里面、该高亮哪一格（从当前高亮 prev 出发，带迟滞） */
  const state = (prev) => {
    const u = slotPosition(x, centers);
    const inside = insideAt(x, y);
    return { u, inside, nearest: inside ? nearestSelectable(u, count, selectable, prev, bias) : -1 };
  };
  let hover = state(-1).nearest;

  function frame(now) {
    if (finished) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const s = state(hover);
    if (s.nearest !== hover) {
      const prev = hover;
      hover = s.nearest;
      o.onHover?.(hover, prev);
    }
    o.onFrame?.({ ...s, dragging, dt });
    raf = requestAnimationFrame(frame);
  }

  function onMove(e) {
    if (e.pointerId !== id || finished) return;
    x = e.clientX;
    y = e.clientY;
    tracker.add(x, e.timeStamp);
    if (!dragging && Math.abs(x - x0) > threshold) {
      dragging = true;
      o.onDragStart?.();
    }
  }

  function end(e, cancelled) {
    if (e && e.pointerId !== id) return;
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    if (e && !cancelled) {
      x = e.clientX;
      y = e.clientY;
      tracker.add(x, e.timeStamp);
    }
    const s = state(hover);
    const pitch = count > 1 ? (centers[count - 1] - centers[0]) / (count - 1) : 1;
    const vu = e && !cancelled ? tracker.velocity(e.timeStamp) / (pitch || 1) : 0;
    // 落点：从高亮的那格出发，按松手的速度往前推一点（停着松手 = 高亮的那格；甩一下能甩过去）
    const land = s.inside ? nearestSelectable(s.u + vu * project, count, selectable, s.nearest, bias) : -1;
    o.onEnd?.({ ...s, nearest: land, inside: s.inside && !cancelled, dragging, cancelled, vu });
  }
  const onUp = (e) => end(e, false);
  const onCancel = (e) => end(e, true);

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  raf = requestAnimationFrame(frame);

  return {
    cancel() {
      end(null, true);
    },
    get dragging() {
      return dragging;
    },
  };
}
