// =====================================================================
// shell/tabbar-motion.js：底栏（TabBar.jsx）的动效参数和纯函数（Node 里能直接测，单元测试 test/unit/tabbar.test.js）。
//
// 手感照 iOS 26 Apple Music 的 Liquid Glass 底栏：
//   - 选中块是一块更亮、更透的玻璃药丸：切 tab 时弹簧滑过去，移动中按速度沿运动方向拉长、竖向略压扁、往后拖一点
//     （motion/liquid.js 的 stretchSpring），停下时回弹一点点；
//   - 按下：选中块像透镜一样等比浮起放大 1.15（两头还是正圆，上下各超出底栏约 2px），透镜下面的图标、字跟着放大（最多 1.12），
//     松手弹簧回弹；
//   - 按下别的格（还没拖）：选中块用同一条弹簧（stretchSpring，合成线程）滑到手指下，不追手指——轻点不会甩出去；
//   - 按住左右拖：选中块被一根很短的弹簧拽着跟手（拉伸来自跟随的速度），经过的格子高亮（换格有迟滞，抖不闪）；
//     松手停在高亮的那格（按松手速度外推一点），交接速度限制在 ±6 格/秒；
//   - 选中块不出底栏：两头按橡皮筋收住（lensEdge）；从 ＋ 后面穿过时变淡（plusFade，不在 ＋ 周围露出一圈白边）；
//   - 往下滚：整条底栏等比缩到 0.8（玻璃两头还是正圆）、标签淡出、图标反向放大到原来的 0.94 并挪到正中，＋ 跟着缩小；
//     往上滚一点 / 回到顶部弹回（规则在 scroll-state.js 的 createTabbarIntent）。
// =====================================================================

import { TABBAR_SLOTS } from './rules.js';

export const TABBAR_MOTION = Object.freeze({
  /** 选中块换格：感知 0.48s、回弹 0.24（过冲 2.5%，停稳 0.68s）；跨得远时回弹按距离减小，过冲最多 maxOvershoot 格（约 3.5px，lensSpring）；
      拉伸：最多 22%，vRef 6 格/秒（切一格峰值 13.5%、跨两格 18.7%、跨三格 20.7%） */
  lens: Object.freeze({
    spring: Object.freeze({ duration: 0.48, bounce: 0.24 }),
    maxOvershoot: 0.05,
    stretch: Object.freeze({ max: 0.22, vRef: 6, squash: 0.45, lag: 0.3 }),
    /** 拖动松手交给弹簧的速度上限（格/秒）：甩得再快也不会冲出去很远 */
    handoffMax: 6,
    /** 两头：选中块的边最多再出去 give 格（约 4px，按橡皮筋越来越难），离底栏的边还有约 4px */
    edge: Object.freeze({ min: -0.5, max: 4.5, give: 0.06 }),
    /** 从 ＋ 后面穿过：中心离第 2 格（＋）不到 reach 格时变淡，正中最淡到 min（1.4–2.6 格之间） */
    plus: Object.freeze({ at: 2, reach: 0.6, min: 0.5 }),
  }),
  /** 按下浮起：等比 1.15（选中块离上下边 --tabbar-lens-inset 3px，64px 高 × 1.15 = 73.6px，上下各超出 70px 的底栏约 1.8px）；
      按下用 0.26s 几乎不回弹，松手 0.42s 回弹 0.32 */
  lift: Object.freeze({
    scaleX: 1.15,
    scaleY: 1.15,
    press: Object.freeze({ duration: 0.26, bounce: 0.12 }),
    release: Object.freeze({ duration: 0.42, bounce: 0.32 }),
  }),
  /** 透镜下的图标放大：正下方 1.12，离透镜中心 0.75 格以外不放大（中间平滑过渡） */
  magnify: Object.freeze({ max: 0.12, reach: 0.75 }),
  /** 拖动时选中块追手指的弹簧（感知 0.2s、阻尼比 0.86：甩一下先被拉长再追上，几乎不过冲） */
  follow: Object.freeze({ duration: 0.2, damping: 0.86 }),
  /** 滚动收小：整条等比 0.8、图标反向放大 1.18（净 0.94）、标签在前 60% 淡出；弹簧 0.46s、回弹 0.12；
      收小时打开 ＋ 面板 / 更多菜单：展开快一点（0.3s、回弹 0.06），面板长出来的同时底栏已经差不多到位 */
  compact: Object.freeze({
    scale: 0.8,
    icon: 1.18,
    labelOut: 0.6,
    spring: Object.freeze({ duration: 0.46, bounce: 0.12 }),
    open: Object.freeze({ duration: 0.3, bounce: 0.06 }),
  }),
  /** 拖动：超过 6px 算拖；手指离开底栏左右 24px、上下 28px 以外算“滑出去了”（松手取消）；
      换格迟滞 0.12 格（越过两格中线 0.12 格才换）；松手落点按速度外推 0.08 秒 */
  drag: Object.freeze({ threshold: 6, slop: Object.freeze({ x: 24, y: 28 }), reach: 0.5, bias: 0.12, project: 0.08 }),
});

/** 格子的序号（行程 0 / 地图 1 / ＋ 2 / 账本 3 / 更多 4） */
export const SLOTS = TABBAR_SLOTS;

/**
 * 这一格能不能被“拖动选择”选中：行程、地图、账本能；＋ 永远不能（它是按钮）；
 * 「更多」只在它就是当前那一格（二级页面）时能（平时它是打开菜单的按钮，不是一页）。
 * @param {number} i
 * @param {string|null} active 当前亮的那一格
 */
export function isSelectable(i, active) {
  const name = SLOTS[i];
  if (name === 'trip' || name === 'map' || name === 'ledger') return true;
  return name === 'more' && active === 'more';
}

/** 能选的格子里最左、最右的序号（拖到范围外按橡皮筋收住） */
export function selectableRange(active) {
  const list = SLOTS.map((_, i) => i).filter((i) => isSelectable(i, active));
  return { min: list[0] ?? 0, max: list[list.length - 1] ?? 0 };
}

/**
 * 透镜下的放大倍数：透镜中心在 lensX（格），这一格是 i，浮起程度 lift（0–1）。
 * @returns {number} 1–1.12
 */
export function magnifyAt(lensX, i, lift, { max, reach } = TABBAR_MOTION.magnify) {
  const d = Math.abs(lensX - i);
  const t = Math.min(1, Math.max(0, 1 - d / reach));
  const smooth = t * t * (3 - 2 * t);
  return 1 + max * smooth * Math.min(1, Math.max(0, lift));
}

/**
 * 选中块换格的弹簧：平时回弹 0.24（过冲 2.5%）；跨得远时按距离把回弹调小，过冲（静止出发时）不超过 maxOvershoot 格——
 * 跨三格不会冲出去 5px 多。欠阻尼弹簧的过冲比例 r = e^(−πζ/√(1−ζ²))，反过来 ζ = −ln r / √(π² + ln² r)，bounce = 1 − ζ。
 * @param {number} distance 要走多少格
 * @returns {{ duration: number, bounce: number }}
 */
export function lensSpring(distance, { spring, maxOvershoot } = TABBAR_MOTION.lens) {
  const d = Math.abs(Number(distance) || 0);
  if (d <= 1e-6) return spring;
  const r = Math.min(0.5, maxOvershoot / d);
  const ln = Math.log(r);
  const zeta = -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
  const bounce = Math.min(spring.bounce, Math.max(0, 1 - zeta));
  return bounce === spring.bounce ? spring : { duration: spring.duration, bounce: Math.round(bounce * 1000) / 1000 };
}

/**
 * 选中块从 ＋ 后面穿过时的不透明度（中心在第 2 格正中最淡；离开 reach 格以外不变淡，中间平滑过渡）。
 * 选中块比 ＋ 大一圈，不淡的话 ＋ 周围会露出一圈白边。
 * @param {number} x 选中块中心在第几格
 * @returns {number} min–1
 */
export function plusFade(x, { at, reach, min } = TABBAR_MOTION.lens.plus) {
  const t = Math.min(1, Math.max(0, 1 - Math.abs(x - at) / reach));
  const smooth = t * t * (3 - 2 * t);
  return 1 - (1 - min) * smooth;
}

/**
 * 选中块不出底栏：算上拉伸（sx、shift）以后选中块的左右边（格；一格宽、以中心为准）超出 [min, max] 时，
 * 超出的部分按橡皮筋压成最多 give 格，整体往回挪。弹簧回弹、拖到头、甩出去都一样收得住。
 * @param {{ x: number, sx?: number, shift?: number }} v
 * @returns {number} 挪过以后的中心（格，含 shift）
 */
export function lensEdge({ x, sx = 1, shift = 0 }, { min, max, give } = TABBAR_MOTION.lens.edge) {
  const c = x + shift;
  const half = sx / 2;
  const squeeze = (over) => give * (1 - Math.exp(-over / give));
  const left = c - half;
  if (left < min) return min - squeeze(min - left) + half;
  const right = c + half;
  if (right > max) return max + squeeze(right - max) - half;
  return c;
}
