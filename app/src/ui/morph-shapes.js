// =====================================================================
// ui/morph-shapes.js：可变形图标的几何定义和插值（纯函数，单元测试直接 import）。
//
// 每个图标由若干“形状”组成，两端（状态 0 / 状态 1）的形状数量一样、一一对应：
//   { cx, cy, a, pts, fill, op }
//     cx, cy  旋转中心（24×24 画布坐标）
//     a       旋转角度（度，顺时针为正）
//     pts     4 个点（相对旋转中心的局部坐标）。线段 = 退化的四边形（两对点重合），描边后就是圆头线
//     fill    填充不透明度 0–1（0 = 只描边，1 = 实心）
//     op      整体不透明度 0–1
// 插值：所有数值线性插值，角度也是（端点直线滑过去的话中途线会变短）。弹簧有过冲时 p 会略超出 0–1，
// 图形会多转一点再回来，这正是想要的“回弹感”（填充和不透明度会夹在 0–1）。
// 分段（phases）：中间形态不能像别的图标（动效评审 #14）——
//   三横线 → ×：前 45% 三条线向中间收拢（不转），后 55% 再旋转成 ×；只有一起做的话 12% 左右会像“>”；
//   向下箭头 → 向上：整组绕中心旋转 180°（turn），不压扁——中途是一个朝左 / 朝右的箭头，而不是一条横线。
//
// 坐标参照 lucide 图标（线宽 2、圆头圆角），和全站静态图标风格一致。
// =====================================================================

import { num } from '../motion/physics.js';

const line = (cx, cy, a, half, extra = {}) => ({
  cx, cy, a, pts: [[-half, 0], [half, 0], [half, 0], [-half, 0]], fill: 0, op: 1, ...extra,
});
const quad = (pts, extra = {}) => ({ cx: 0, cy: 0, a: 0, pts, fill: 0, op: 1, ...extra });
const rect = (x, y, w, h, extra = {}) => quad([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], extra);
const hline = (x0, x1, y) => quad([[x0, y], [x1, y], [x1, y], [x0, y]]);

/**
 * 图标表。label：两个状态的默认中文名（给按钮的 aria-label 参考）；spring：默认弹簧。
 * 'check' 是特殊的一类：圆圈常在，对勾按进度“描”出来（stroke-dashoffset）。
 */
export const MORPHS = Object.freeze({
  /** 三横线 ↔ ×（菜单）：先收拢再旋转（phases：位置和淡出在前 45%，旋转和长度在后 55%） */
  menu: {
    label: ['打开菜单', '关闭菜单'],
    spring: 'bouncy',
    phases: { cx: [0, 0.45], cy: [0, 0.45], op: [0, 0.45], fill: [0, 0.45], pts: [0.45, 1], a: [0.45, 1] },
    a: [line(12, 6, 0, 8), line(12, 12, 0, 8), line(12, 18, 0, 8)],
    b: [line(12, 12, 45, 8.5), line(12, 12, 0, 0, { op: 0 }), line(12, 12, -45, 8.5)],
  },
  /** 加号 ↔ ×（悬浮加号） */
  plus: {
    label: ['展开', '收起'],
    spring: 'bouncy',
    a: [line(12, 12, 0, 7), line(12, 12, 90, 7)],
    b: [line(12, 12, 45, 7.5), line(12, 12, 135, 7.5)],
  },
  /** 播放 ↔ 暂停：三角形从 x=13 切成两半，左半块 ↔ 左竖条，右半块（右端两点重合）↔ 右竖条 */
  play: {
    label: ['播放', '暂停'],
    spring: 'snappy',
    a: [
      // 上边 (6,3.5)→(19.5,12) 在 x=13 处 y≈7.91，下边对称 y≈16.09
      quad([[6, 3.5], [13, 7.91], [13, 16.09], [6, 20.5]], { fill: 1 }),
      quad([[13, 7.91], [19.5, 12], [19.5, 12], [13, 16.09]], { fill: 1 }),
    ],
    b: [rect(6, 4, 4, 16, { fill: 1 }), rect(14, 4, 4, 16, { fill: 1 })],
  },
  /** 列表 ↔ 网格：两行“缩略图 + 两行字”；字行长成右边的方块，缩略图就是左边的方块 */
  view: {
    label: ['切换为网格', '切换为列表'],
    spring: 'smooth',
    a: [rect(3, 3, 7, 7), rect(3, 14, 7, 7), hline(14, 21, 4), hline(14, 21, 9), hline(14, 21, 15), hline(14, 21, 20)],
    b: [rect(3, 3, 7, 7), rect(3, 14, 7, 7), rect(14, 3, 7, 7), rect(14, 3, 7, 7), rect(14, 14, 7, 7), rect(14, 14, 7, 7)],
  },
  /** 向下 ↔ 向上的箭头（展开 / 收起：行程切换器、折叠区）。整组绕 (12, 12) 旋转 180°，形状不变、不压扁 */
  chevron: {
    label: ['展开', '收起'],
    spring: 'bouncy',
    turn: { cx: 12, cy: 12, from: 0, to: 180 },
    // lucide chevron-down：m6 9 6 6 6-6；两段各长 √72 ≈ 8.49，中心 (9, 12) 和 (15, 12)
    a: [line(9, 12, 45, 4.243), line(15, 12, -45, 4.243)],
    // 转过 180° 之后的样子（就是 lucide chevron-up；两段互换了位置）
    b: [line(15, 12, 225, 4.243), line(9, 12, 135, 4.243)],
  },
  /** 圆圈 ↔ 圆圈里描出对勾（完成） */
  check: {
    label: ['标为完成', '取消完成'],
    spring: 'smooth',
    special: 'check',
  },
});

export const MORPH_KINDS = Object.freeze(Object.keys(MORPHS));

/** 对勾的路径（pathLength=1 方便用 dashoffset 描线） */
export const CHECK_PATH = 'M7.5 12.4 L10.6 15.4 L16.5 9.1';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * 分段的进度：整体进度 p 换算成这一段 [s, e] 里的进度。段内线性；整段之前 / 之后夹住，
 * 但从 0 开始的段允许 p < 0、到 1 结束的段允许 p > 1（弹簧过冲时多走一点再回来，回弹感保留）。
 */
export function phaseProgress(p, [s, e] = [0, 1]) {
  const t = (p - s) / Math.max(1e-6, e - s);
  if (p < s) return s <= 0 ? t : 0;
  if (p > e) return e >= 1 ? t : 1;
  return t;
}

/** 两个形状按进度 p 插值（phases：每个属性各自在哪一段进度里变，见文件头） */
export function interpolateShape(A, B, p, phases = null) {
  const at = (key) => (phases?.[key] ? phaseProgress(p, phases[key]) : p);
  const tp = at('pts');
  return {
    cx: lerp(A.cx, B.cx, at('cx')),
    cy: lerp(A.cy, B.cy, at('cy')),
    a: lerp(A.a, B.a, at('a')),
    pts: A.pts.map(([x, y], i) => [lerp(x, B.pts[i][0], tp), lerp(y, B.pts[i][1], tp)]),
    fill: clamp01(lerp(A.fill, B.fill, at('fill'))),
    op: clamp01(lerp(A.op, B.op, at('op'))),
  };
}

/** 形状绕 (cx, cy) 整体旋转 deg 度（中心跟着转，自身角度加上 deg） */
export function rotateShape(s, cx, cy, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const n = Math.sin(rad);
  const dx = s.cx - cx;
  const dy = s.cy - cy;
  return { ...s, cx: cx + dx * c - dy * n, cy: cy + dx * n + dy * c, a: s.a + deg };
}

/** 形状 → SVG 路径（局部点绕中心旋转后平移到画布） */
export function shapePath(s) {
  const rad = (s.a * Math.PI) / 180;
  const c = Math.cos(rad);
  const n = Math.sin(rad);
  const pts = s.pts.map(([x, y]) => [s.cx + x * c - y * n, s.cy + x * n + y * c]);
  return `M${pts.map(([x, y]) => `${num(x, 2)} ${num(y, 2)}`).join(' L')} Z`;
}

/**
 * 某个图标在进度 p 时的样子。
 * @param {string} kind
 * @param {number} p 0 = 状态 0，1 = 状态 1（弹簧过冲时可以略超出）
 * @returns {Array<{ d: string, fillOpacity: number, opacity: number }> | { circle: true, draw: number }}
 */
export function morphFrame(kind, p) {
  const def = MORPHS[kind];
  if (!def) throw new Error(`MorphIcon 没有 ${kind}，可选：${MORPH_KINDS.join(' / ')}`);
  if (def.special === 'check') return { circle: true, draw: clamp01(p) };
  if (def.turn) {
    // 整组旋转：形状不变，绕中心转（过冲时多转一点再回来）
    const deg = lerp(def.turn.from, def.turn.to, p);
    return def.a.map((A) => {
      const s = rotateShape(A, def.turn.cx, def.turn.cy, deg);
      return { d: shapePath(s), fillOpacity: s.fill, opacity: s.op };
    });
  }
  return def.a.map((A, i) => {
    const s = interpolateShape(A, def.b[i], p, def.phases);
    return { d: shapePath(s), fillOpacity: s.fill, opacity: s.op };
  });
}
