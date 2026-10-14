// =====================================================================
// motion/press-handoff.js：按压回弹的“交接”。
//
// 场景：点了悬浮加号，按钮还在松手回弹的途中（scale 约 0.96 → 1），这时在它原位换上一个替身按钮
// （弹层的 anchorProxy）或者长出来的输入框——新元素要是直接以 scale 1 出现，56px 的按钮会“跳”2px。
//   const s = pressScaleOf(realButton);                          // 先读（藏起真按钮之前）
//   continuePressFrom(proxyButton, s);                           // 替身从这个缩放接着弹回 1
//   inheritPressScale(trigger, field, { origin: '…px 50%' });   // 两个都还看得见时一步到位
// 用的是和按压同一条松手弹簧（--spring-bouncy），减弱动态效果时按压的轻微缩放照常保留（和 press.css 一致）。
// =====================================================================

import { animateSpring } from './animate.js';
import { num } from './physics.js';

const CHANNEL = 'press-handoff';

/**
 * 元素此刻的按压缩放（含正在播的回弹；没有缩放返回 1）。
 * 要在把原来的元素藏起来**之前**读（藏起来的样式会掐掉它的过渡，读到的就是 1 了）。
 * @param {Element|null} el
 */
export function pressScaleOf(el) {
  if (!el || typeof getComputedStyle !== 'function') return 1;
  const raw = getComputedStyle(el).scale;
  const s = raw && raw !== 'none' ? parseFloat(raw) : 1;
  return Number.isFinite(s) ? s : 1;
}

/**
 * 让 to 从缩放 s 接着弹回 1（和按压松手同一条弹簧）。
 * @param {Element|null} to
 * @param {number} s 起始缩放（pressScaleOf 读到的）
 * @param {{ origin?: string }} [o] origin：to 的 transform-origin（缩放的中心，默认中心）
 * @returns {object|null} 动画（没有要接的缩放时 null）
 */
export function continuePressFrom(to, s, { origin } = {}) {
  if (!to || !Number.isFinite(s) || Math.abs(1 - s) < 0.002) return null;
  const prevOrigin = to.style.transformOrigin;
  if (origin) to.style.transformOrigin = origin;
  const anim = animateSpring(to, {
    channel: CHANNEL,
    from: { s },
    to: { s: 1 },
    spring: 'bouncy',
    reduced: 'ignore',
    commit: 'clear',
    render: ({ s: v }) => ({ scale: num(v, 4) }),
  });
  anim.finished.then((done) => {
    if (done && origin) to.style.transformOrigin = prevOrigin;
  });
  return anim;
}

/**
 * from 此刻的按压缩放交给 to 接着弹（两个元素都还看得见时用；要先藏 from 的话先 pressScaleOf 再 continuePressFrom）。
 * @param {Element|null} from
 * @param {Element|null} to
 * @param {{ origin?: string }} [o]
 */
export function inheritPressScale(from, to, o = {}) {
  return continuePressFrom(to, pressScaleOf(from), o);
}
