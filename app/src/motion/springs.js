// =====================================================================
// motion/springs.js：弹簧曲线的唯一来源。
//
// 职责：
//   1. 定义三条具名弹簧 snappy / bouncy / smooth 的物理参数（SPRINGS）；
//   2. 把弹簧解析解采样成 CSS `linear()` 缓动 + 停稳时长（springToLinear）；
//      styles/tokens.css 里 --spring-* 那一段就是用它生成的（npm run tokens），
//      单元测试会核对两边一字不差，防止改了参数忘了重新生成；
//   3. 给 JS 动画（WAAPI、手势松手）用的解析解 solveSpring：支持初速度，
//      所以拖动松手时可以把手指速度接进弹簧，动画可被打断、接力。
//
// 参数含义（和 SwiftUI 的 Spring(duration:bounce:) 一致）：
//   duration：感知时长（秒）——大致“看起来到位”的时间，不是停稳时间；
//   bounce：  弹性，0 = 不回弹（临界阻尼），0.15 = 轻微，0.3 = 明显。
//   换算：ω0 = 2π / duration，阻尼比 ζ = 1 − bounce，质量 = 1。
//
// 这个文件不依赖 DOM，Node 里也能跑（构建脚本、单元测试会 import）。
// =====================================================================

/** 三条具名弹簧。改这里之后运行 `npm run tokens` 重新生成 tokens.css 里的曲线。 */
export const SPRINGS = Object.freeze({
  /** 干脆：按钮回弹、指示条跟随、步进器数字。轻微回弹。 */
  snappy: Object.freeze({ duration: 0.32, bounce: 0.15 }),
  /** 弹跳：从按钮长出来的面板、加号转 ×、松手回弹。明显但不夸张的回弹。 */
  bouncy: Object.freeze({ duration: 0.45, bounce: 0.3 }),
  /** 顺滑：列表展开、布局重排（FLIP）、顶栏收起。不回弹。 */
  smooth: Object.freeze({ duration: 0.42, bounce: 0 }),
});

/** 名字列表，顺序固定（生成 tokens.css 时用）。 */
export const SPRING_NAMES = Object.freeze(Object.keys(SPRINGS));

/** “停稳”的判定：离终点不到 0.1%，且速度足够小。 */
const SETTLE_EPSILON = 0.001;

/**
 * 弹簧解析解。位置从 0 走到 1。
 * @param {{duration:number, bounce:number}} spec
 * @param {number} [velocity=0] 初速度，单位“全程/秒”（例如手指以 2 倍全程每秒的速度松手 = 2）
 * @returns {{ position:(t:number)=>number, velocity:(t:number)=>number, settleTime:number,
 *             omega:number, zeta:number }}  t 的单位是秒
 */
export function solveSpring(spec, velocity = 0) {
  const { duration, bounce } = spec;
  if (!(duration > 0)) throw new RangeError('spring duration 必须大于 0');
  if (!(bounce >= 0 && bounce < 1)) throw new RangeError('spring bounce 取值范围是 [0, 1)');
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  const v0 = velocity;

  // 以“离终点的位移” y = x − 1 求解：y(0) = −1，y'(0) = v0。
  let y;
  let dy;
  if (zeta < 1) {
    const a = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const A = -1;
    const B = (v0 + a * A) / wd;
    y = (t) => Math.exp(-a * t) * (A * Math.cos(wd * t) + B * Math.sin(wd * t));
    dy = (t) => Math.exp(-a * t) * ((-a * A + B * wd) * Math.cos(wd * t) + (-a * B - A * wd) * Math.sin(wd * t));
  } else {
    const A = -1;
    const B = v0 + omega * A;
    y = (t) => Math.exp(-omega * t) * (A + B * t);
    dy = (t) => Math.exp(-omega * t) * (B - omega * (A + B * t));
  }

  const position = (t) => (t <= 0 ? 0 : 1 + y(t));
  const vel = (t) => (t <= 0 ? v0 : dy(t));

  // 数值找停稳时间：从后往前找最后一个“还没停稳”的时刻（1ms 步长，最多 10 秒）。
  const STEP = 0.001;
  const LIMIT = 10;
  let last = 0;
  for (let t = 0; t <= LIMIT; t += STEP) {
    if (Math.abs(y(t)) >= SETTLE_EPSILON || Math.abs(dy(t)) * 0.05 >= SETTLE_EPSILON) last = t;
  }
  const settleTime = Math.min(LIMIT, last + STEP);

  return { position, velocity: vel, settleTime, omega, zeta };
}

/** 四舍五入到 n 位小数，并去掉多余的 0（-0 也归一成 0）。 */
function round(value, digits) {
  const p = 10 ** digits;
  const r = Math.round(value * p) / p;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Ramer–Douglas–Peucker 折线简化：在误差 tolerance 内去掉多余的采样点，
 * 让 linear() 用尽量少的点逼近曲线。
 */
function simplify(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [x0, y0] = points[i0];
    const [x1, y1] = points[i1];
    let maxDist = 0;
    let index = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const [x, yv] = points[i];
      // 竖直方向的误差（缓动曲线关心的是同一时刻的位置差）
      const yOnLine = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      const dist = Math.abs(yv - yOnLine);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([i0, index], [index, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * 把弹簧采样成 CSS linear() 缓动。
 * @param {{duration:number, bounce:number}} spec
 * @param {{ tolerance?: number, samples?: number }} [options]
 * @returns {{ easing: string, durationMs: number, points: Array<[number, number]>, overshoot: number }}
 *   easing：形如 `linear(0, 0.2 5.1%, …, 1)`；durationMs：CSS 里配套的时长（停稳时间，取整到 10ms）
 */
export function springToLinear(spec, { tolerance = 0.002, samples = 600 } = {}) {
  const solved = solveSpring(spec);
  const durationMs = Math.ceil((solved.settleTime * 1000) / 10) * 10;
  const T = durationMs / 1000;
  const dense = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    dense.push([p, solved.position(p * T)]);
  }
  dense[dense.length - 1] = [1, 1];
  const pts = simplify(dense, tolerance);
  let overshoot = 0;
  for (const [, v] of dense) overshoot = Math.max(overshoot, v - 1);

  const parts = pts.map(([p, v], i) => {
    const value = round(v, 4);
    if (i === 0 || i === pts.length - 1) return String(i === 0 ? 0 : 1);
    return `${value} ${round(p * 100, 2)}%`;
  });
  return { easing: `linear(${parts.join(', ')})`, durationMs, points: pts, overshoot: round(overshoot, 4) };
}

/**
 * 生成 tokens.css 里的弹簧变量块（纯文本）。npm run tokens 写入，单元测试核对。
 * 每条弹簧两个变量：--spring-<名字>（缓动）和 --spring-<名字>-duration（时长）。
 */
export function renderSpringTokens() {
  const lines = [];
  for (const name of SPRING_NAMES) {
    const spec = SPRINGS[name];
    const { easing, durationMs, overshoot } = springToLinear(spec);
    lines.push(`  /* ${name}：感知 ${spec.duration * 1000}ms，bounce ${spec.bounce}，停稳 ${durationMs}ms，最大过冲 ${round(overshoot * 100, 1)}% */`);
    lines.push(`  --spring-${name}: ${easing};`);
    lines.push(`  --spring-${name}-duration: ${durationMs}ms;`);
  }
  return lines.join('\n');
}

/**
 * 不支持 linear() 的浏览器（iOS 17.2 以前）用的近似三次贝塞尔。
 * 按各自的弹簧曲线（时长 = 停稳时间，和 CSS 里配套的 --spring-*-duration 一致）数值拟合出来：
 * 均方误差约 1.3–2.9%，最大过冲和真实弹簧差不到 0.3 个百分点（bouncy 4.3% vs 4.6%，snappy 0.7% vs 0.6%，smooth 不过冲）。
 * 单元测试（motion.test.js）核对拟合精度和 tokens.css 里的写法；改了 SPRINGS 要重新拟合。
 */
export const SPRING_FALLBACKS = Object.freeze({
  snappy: 'cubic-bezier(0.32, 0.59, 0.01, 1.07)',
  bouncy: 'cubic-bezier(0.48, 1.61, 0.07, 0.83)',
  smooth: 'cubic-bezier(0.28, 0.47, 0.03, 1.01)',
});

let linearSupported;
/** 当前浏览器是否支持 CSS linear() 缓动（结果缓存）。Node 里返回 false。 */
export function supportsLinearEasing() {
  if (linearSupported === undefined) {
    linearSupported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      && CSS.supports('transition-timing-function', 'linear(0, 1)');
  }
  return linearSupported;
}

const easingCache = new Map();
/**
 * 给 WAAPI（element.animate）用：返回 { easing, duration }，和 CSS 变量同一条曲线。
 * 浏览器不支持 linear() 时自动换成近似贝塞尔。
 * @param {'snappy'|'bouncy'|'smooth'} name
 */
export function spring(name) {
  const spec = SPRINGS[name];
  if (!spec) throw new Error(`没有名为 ${name} 的弹簧，可选：${SPRING_NAMES.join(' / ')}`);
  if (!easingCache.has(name)) easingCache.set(name, springToLinear(spec));
  const { easing, durationMs } = easingCache.get(name);
  return { easing: supportsLinearEasing() ? easing : SPRING_FALLBACKS[name], duration: durationMs };
}
