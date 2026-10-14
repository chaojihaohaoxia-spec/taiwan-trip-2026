// =====================================================================
// overlay/transitions.js：弹层共用的几段“淡入淡出”编排（遮罩、内容、离场）。
//
// 只是把 motion/animate.js 的原语按弹层的约定组合起来，不另写动画引擎：
//   scrimTo(el, 1)            遮罩淡入 / 淡出：弹簧 smooth（和面板位移同一条曲线），打断时从当前透明度接着走
//   fadeTo(el, 0, 'out')      普通淡入淡出：'in' --dur-base 缓出 / 'out' --dur-fast 缓入 / 'out-slow' / 'reduced'，可打断
//   prepareHidden(el)         挂上的第一帧先透明（出场动画从 0 开始；之后的淡入都只写终点，被打断时从当前值走）
//
// 所有函数返回 motion 的动画对象（.finished：true = 播完，false = 被打断）。
// =====================================================================

import { animateSpring, animateTween } from '../motion/animate.js';
import { clamp, num } from '../motion/physics.js';

/** 动画通道名（同一元素同一通道的新动画会接管旧的） */
export const CH = Object.freeze({ scrim: 'ov-scrim', fade: 'ov-fade', scale: 'ov-scale' });

const renderOpacity = ({ o }) => ({ opacity: num(clamp(o, 0, 1)) });
const opacityOf = (el) => {
  const v = Number(getComputedStyle(el).opacity);
  return Number.isFinite(v) ? v : 1;
};

/** 挂上的第一帧先透明（在 useLayoutEffect 里调用，早于第一次绘制） */
export function prepareHidden(...els) {
  for (const el of els) if (el) el.style.opacity = '0';
}

/** 遮罩淡到某个透明度（弹簧 smooth） */
export function scrimTo(el, o) {
  return animateSpring(el, {
    channel: CH.scrim,
    current: () => ({ o: opacityOf(el) }),
    to: { o },
    spring: 'smooth',
    commit: 'final',
    render: renderOpacity,
  });
}

/** 淡入淡出的几种节奏（时长、缓动都取设计变量） */
const FADES = Object.freeze({
  /** 出场：--dur-base 缓出 */
  in: { duration: 'base', easing: 'out' },
  /** 离场：--dur-fast 缓入（走得干脆） */
  out: { duration: 'fast', easing: 'in' },
  /** 慢一点的离场（遮罩、跟在内容后面走的东西）：--dur-base 缓入 */
  'out-slow': { duration: 'base', easing: 'in' },
  /** 减弱动态效果时的统一淡入淡出：--dur-fast 缓出 */
  reduced: { duration: 'fast', easing: 'out' },
});

/**
 * 淡入 / 淡出（只写终点：从当前透明度出发，可打断）。
 * @param {Element} el
 * @param {number} opacity 目标透明度
 * @param {'in'|'out'|'out-slow'|'reduced'} [kind='in']
 * @param {{ delay?: number, channel?: string }} [o]
 */
export function fadeTo(el, opacity, kind = 'in', { delay = 0, channel = CH.fade } = {}) {
  const preset = FADES[kind] || FADES.in;
  return animateTween(el, [{ opacity }], { ...preset, delay, channel, commit: 'final' });
}
