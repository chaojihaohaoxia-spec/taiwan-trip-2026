// =====================================================================
// motion/physics.js：动效的“物理”——纯函数，不碰 DOM，Node 里也能跑（单元测试直接 import）。
//
// 职责：
//   1. 一维弹簧的通解（任意起点、终点、初速度，单位随便：px、倍数、度……）：springMotion；
//      多个通道一起动（例如 x、y、scaleX、scaleY）：springGroup；
//   2. 把弹簧采样成关键帧（给 WAAPI 用），并用折线简化去掉多余的帧：sampleFrames；
//   3. 手势用的小工具：橡皮筋阻尼 rubberBand、惯性投射 projectMomentum、
//      手指速度估计 VelocityTracker；
//   4. 三次贝塞尔求值 cubicBezier（减弱动态效果时的短补间被打断，要算出当前位置）；
//   5. 圆角换算 resolveRadius（形变的源形状、弹层量按钮圆角都用它）。
//
// 弹簧参数和 springs.js 一致：{ duration（感知时长，秒）, bounce（0 不回弹 ~ 0.3 明显回弹） }，
// 也可以直接写名字 'snappy' | 'bouncy' | 'smooth'。
// 推导：ω0 = 2π / duration，阻尼比 ζ = 1 − bounce，质量 1。设 y = x − to（离终点的位移）：
//   欠阻尼（ζ<1）：y = e^(−ζω0 t)·(A·cos ωd t + B·sin ωd t)，A = y0，B = (v0 + ζω0·y0)/ωd，ωd = ω0·√(1−ζ²)
//   临界阻尼（ζ=1）：y = e^(−ω0 t)·(A + B·t)，A = y0，B = v0 + ω0·y0
// 和 springs.js 的 solveSpring 是同一个解（那边固定 0→1、单位“全程”），单元测试会核对两者一致。
// =====================================================================

import { SPRINGS } from './springs.js';

/**
 * 把弹簧名字或参数统一成 { duration, bounce }。
 * @param {'snappy'|'bouncy'|'smooth'|{duration:number,bounce:number}} spring
 */
export function resolveSpring(spring = 'smooth') {
  if (typeof spring === 'string') {
    const spec = SPRINGS[spring];
    if (!spec) throw new Error(`没有名为 ${spring} 的弹簧，可选：${Object.keys(SPRINGS).join(' / ')}`);
    return spec;
  }
  if (spring && spring.duration > 0 && spring.bounce >= 0 && spring.bounce < 1) return spring;
  throw new RangeError('弹簧参数应为 { duration > 0, bounce ∈ [0, 1) } 或名字 snappy / bouncy / smooth');
}

/** 停稳搜索的上限（秒）：再慢的弹簧也不让一个动画拖过 4 秒 */
const MAX_SETTLE = 4;
/** 停稳搜索的步长（秒） */
const SETTLE_STEP = 1 / 240;

/**
 * 一维弹簧：从 from 动到 to，带初速度。
 * @param {'snappy'|'bouncy'|'smooth'|{duration:number,bounce:number}} spring
 * @param {{ from: number, to: number, velocity?: number, precision?: number }} o
 *   velocity：初速度（单位/秒，单位和 from/to 相同；例如手指松手时 1200 px/s）
 *   precision：判定“停稳”的位移误差（默认：运动幅度的 0.1%）
 * @returns {{ position:(t:number)=>number, velocity:(t:number)=>number, settle:number,
 *             from:number, to:number, v0:number, omega:number, zeta:number, scale:number }}
 *   t 的单位是秒；settle 是停稳时间（秒），没有运动时为 0
 */
export function springMotion(spring, { from, to, velocity = 0, precision }) {
  const { duration, bounce } = resolveSpring(spring);
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  const y0 = from - to;
  const v0 = Number.isFinite(velocity) ? velocity : 0;

  let disp;
  let speed;
  /** 包络：|位移|、|速度| 的上界（单调递减的部分用来提前结束停稳搜索） */
  let envelope;
  /** 包络开始单调递减的时刻 */
  let envelopePeak = 0;
  if (zeta < 1) {
    const a = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const A = y0;
    const B = (v0 + a * A) / wd;
    const cy = Math.hypot(A, B);
    const cv = Math.hypot(B * wd - a * A, a * B + A * wd);
    disp = (t) => Math.exp(-a * t) * (A * Math.cos(wd * t) + B * Math.sin(wd * t));
    speed = (t) => Math.exp(-a * t) * ((B * wd - a * A) * Math.cos(wd * t) - (a * B + A * wd) * Math.sin(wd * t));
    envelope = (t) => [Math.exp(-a * t) * cy, Math.exp(-a * t) * cv];
  } else {
    const A = y0;
    const B = v0 + omega * A;
    disp = (t) => Math.exp(-omega * t) * (A + B * t);
    speed = (t) => Math.exp(-omega * t) * (B - omega * (A + B * t));
    envelope = (t) => {
      const e = Math.exp(-omega * t);
      return [e * (Math.abs(A) + Math.abs(B) * t), e * (Math.abs(B) + omega * (Math.abs(A) + Math.abs(B) * t))];
    };
    envelopePeak = 1 / omega;
  }

  // 运动幅度：位移和“速度能冲出去多远”取大的，用来定停稳的误差
  const scale = Math.max(Math.abs(y0), Math.abs(v0) / omega);
  const eps = precision ?? scale * 1e-3;
  let settle = 0;
  if (scale > 0 && eps > 0) {
    // 从前往后找最后一个“还没停稳”的时刻；包络已经低于误差（之后只会更小）就提前结束
    let last = 0;
    for (let t = 0; t <= MAX_SETTLE; t += SETTLE_STEP) {
      if (Math.abs(disp(t)) > eps || Math.abs(speed(t)) > eps * omega) last = t;
      if (t > envelopePeak) {
        const [ey, ev] = envelope(t);
        if (ey <= eps && ev <= eps * omega) break;
      }
    }
    settle = Math.min(MAX_SETTLE, last + SETTLE_STEP);
  }

  return {
    position: (t) => (t <= 0 ? from : t >= settle ? to : to + disp(t)),
    velocity: (t) => (t <= 0 ? v0 : t >= settle ? 0 : speed(t)),
    settle,
    from,
    to,
    v0,
    omega,
    zeta,
    scale,
  };
}

/**
 * 多个通道一起动（每个通道可以用不同的弹簧，例如指示条的前沿用 snappy、后沿用 smooth 做出“拉伸”）。
 * @param {string|object|Record<string, string|object>} spring  一条弹簧，或 { 通道名: 弹簧 }（没写的通道用 default 或 smooth）
 * @param {Record<string, number>} from
 * @param {Record<string, number>} to
 * @param {Record<string, number>} [velocity]
 * @param {Record<string, number>} [precision]
 */
export function springGroup(spring, from, to, velocity = {}, precision = {}) {
  const keys = Object.keys(to);
  const perKey = spring && typeof spring === 'object' && !('duration' in spring);
  const motions = {};
  let duration = 0;
  for (const k of keys) {
    const spec = perKey ? (spring[k] ?? spring.default ?? 'smooth') : spring;
    const f = Number.isFinite(from?.[k]) ? from[k] : to[k];
    const m = springMotion(spec, { from: f, to: to[k], velocity: velocity?.[k] ?? 0, precision: precision?.[k] });
    motions[k] = m;
    duration = Math.max(duration, m.settle);
  }
  return {
    keys,
    motions,
    /** 停稳时间（秒）：所有通道里最长的 */
    duration,
    from: Object.fromEntries(keys.map((k) => [k, motions[k].from])),
    to: Object.fromEntries(keys.map((k) => [k, motions[k].to])),
    /** t 秒时各通道的值 */
    at(t) {
      const out = {};
      for (const k of keys) out[k] = motions[k].position(t);
      return out;
    },
    /** t 秒时各通道的速度（单位/秒） */
    velocityAt(t) {
      const out = {};
      for (const k of keys) out[k] = motions[k].velocity(t);
      return out;
    },
  };
}

/**
 * 在一组弹簧上加“派生通道”：每一时刻由弹簧的值和速度算出来的量（例如液态玻璃的选中块按速度拉长：motion/liquid.js）。
 * 派生通道跟着采样成关键帧、交给 render，但不参与接力：values() 照样带着它们，下一段动画只认 to 里的通道。
 * @param {ReturnType<typeof springGroup>} group
 * @param {(values: Record<string, number>, velocities: Record<string, number>) => Record<string, number>} derive
 * @param {Record<string, number>} [scales] 派生通道的“幅度”（折线简化按它归一；默认 1）
 */
export function deriveGroup(group, derive, scales = {}) {
  const rest = Object.fromEntries(group.keys.map((k) => [k, 0]));
  const extraOf = (values, velocities) => derive(values, velocities) || {};
  const extraKeys = Object.keys(extraOf(group.to, rest));
  const motions = { ...group.motions };
  for (const k of extraKeys) motions[k] = { scale: Math.max(scales[k] ?? 1, 1e-9) };
  return {
    ...group,
    keys: [...group.keys, ...extraKeys],
    motions,
    from: { ...group.from, ...extraOf(group.from, group.velocityAt(0)) },
    to: { ...group.to, ...extraOf(group.to, rest) },
    at(t) {
      const v = group.at(t);
      return { ...v, ...extraOf(v, group.velocityAt(t)) };
    },
    velocityAt(t) {
      const out = group.velocityAt(t);
      for (const k of extraKeys) out[k] = 0;
      return out;
    },
  };
}

/**
 * 采样成关键帧序列，并在误差内去掉多余的帧（Ramer–Douglas–Peucker，按各通道的幅度归一后取最大偏差）。
 * @param {ReturnType<typeof springGroup>} group
 * @param {{ fps?: number, tolerance?: number, maxFrames?: number }} [o]
 *   fps：先按这个密度采样（120 = 每 8ms 一个点，弹簧起步那段曲率最大，密一点线性插值才贴得住）
 *   tolerance：相对误差（相对于各通道的运动幅度），默认 0.0015（300px 的位移误差 < 0.5px）
 * @returns {Array<{ t:number, offset:number, values:Record<string,number> }>}
 */
export function sampleFrames(group, { fps = 120, tolerance = 0.0015, maxFrames = 480 } = {}) {
  const T = group.duration;
  if (!(T > 0)) return [{ t: 0, offset: 0, values: group.to }, { t: 0, offset: 1, values: group.to }];
  const n = Math.max(2, Math.min(maxFrames, Math.ceil(T * fps)));
  const dense = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * T;
    dense.push({ t, offset: i / n, values: i === n ? { ...group.to } : group.at(t) });
  }
  const scales = {};
  for (const k of group.keys) scales[k] = Math.max(group.motions[k].scale, 1e-9);

  const keep = new Uint8Array(dense.length);
  keep[0] = 1;
  keep[dense.length - 1] = 1;
  const stack = [[0, dense.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = dense[i0];
    const b = dense[i1];
    let worst = 0;
    let index = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = dense[i];
      const f = (p.offset - a.offset) / (b.offset - a.offset);
      let dev = 0;
      for (const k of group.keys) {
        const lin = a.values[k] + (b.values[k] - a.values[k]) * f;
        dev = Math.max(dev, Math.abs(p.values[k] - lin) / scales[k]);
      }
      if (dev > worst) {
        worst = dev;
        index = i;
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1;
      stack.push([i0, index], [index, i1]);
    }
  }
  return dense.filter((_, i) => keep[i]);
}

/**
 * 橡皮筋阻尼（iOS 的写法）：超出 [min, max] 的部分越拉越费劲。
 * @param {number} value 手指位置
 * @param {number} min
 * @param {number} max
 * @param {number} dimension 参考尺寸（一般是容器宽度），越大越“松”
 * @param {number} [c=0.55] 阻尼系数
 */
export function rubberBand(value, min, max, dimension, c = 0.55) {
  const band = (d) => (1 - 1 / ((d * c) / Math.max(dimension, 1) + 1)) * dimension;
  if (value < min) return min - band(min - value);
  if (value > max) return max + band(value - max);
  return value;
}

/**
 * 惯性投射：按当前速度“甩出去”大概会停在多远（WWDC 2018 Designing Fluid Interfaces 的公式）。
 * 松手吸附时用：target = 最近的吸附点(position + projectMomentum(velocity))。
 * @param {number} velocity 单位/秒
 * @param {number} [rate=0.99] 每毫秒保留的速度比例；0.99 偏“短”（适合分段控件），0.998 是系统滚动的“长”
 */
export function projectMomentum(velocity, rate = 0.99) {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/**
 * 手指速度估计：记录最近 100ms 的位置，用最小二乘求斜率。
 * 手指停下超过 60ms 再松手，速度算 0（不会因为最后那一下“甩”被放大）。
 */
export class VelocityTracker {
  constructor({ window = 100, idle = 60 } = {}) {
    this.window = window;
    this.idle = idle;
    this.samples = [];
  }

  /** @param {number} value 位置 @param {number} time 毫秒（event.timeStamp 或 performance.now()） */
  add(value, time) {
    this.samples.push([time, value]);
    const cut = time - this.window;
    while (this.samples.length > 2 && this.samples[0][0] < cut) this.samples.shift();
  }

  reset() {
    this.samples.length = 0;
  }

  /** 速度（单位/秒）。now：松手时刻（毫秒），用来判断手指是否已经停住 */
  velocity(now) {
    const s = this.samples;
    if (s.length < 2) return 0;
    const lastT = s[s.length - 1][0];
    if (now !== undefined && now - lastT > this.idle) return 0;
    let n = 0;
    let st = 0;
    let sv = 0;
    let stt = 0;
    let stv = 0;
    for (const [t, v] of s) {
      const x = t - lastT;
      n++;
      st += x;
      sv += v;
      stt += x * x;
      stv += x * v;
    }
    const den = n * stt - st * st;
    if (Math.abs(den) < 1e-9) return 0;
    return ((n * stv - st * sv) / den) * 1000;
  }
}

/**
 * 三次贝塞尔缓动求值（同 CSS cubic-bezier(x1, y1, x2, y2)）。
 * @returns {(t:number)=>number} 输入时间进度 0–1，输出缓动后的进度
 */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // 牛顿迭代，失败再二分
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const v = sx(u);
      if (Math.abs(v - t) < 1e-6) break;
      if (v < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** 解析 'cubic-bezier(a, b, c, d)' 字符串；不认识的写法返回线性 */
export function parseCubicBezier(text) {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(String(text || ''));
  if (!m) return (t) => Math.min(1, Math.max(0, t));
  return cubicBezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
}

/** 线性插值 */
export const lerp = (a, b, t) => a + (b - a) * t;

/** 夹在 [min, max] 之间 */
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * 进度 p 在 [a, b] 这一段里走了多少（0–1，两端平滑：smoothstep）。
 * 用来把同一个弹簧进度拆成先后几段：例如“旧标题 0–35% 淡出、新标题 25–75% 淡入”。
 */
export function stage(p, a, b) {
  const t = clamp((p - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 数字转紧凑字符串（关键帧里用，3 位小数，去掉 -0） */
export function num(v, digits = 3) {
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * 圆角换算：把 border-radius 的计算值换成实际 px。可能是 '50%'、'999px'、'12px 8px'（取第一个值）；
 * 结果不超过短边的一半（和浏览器渲染一致）。motion/morph.js 量源形状、overlay/ 量按钮圆角都用它。
 * 放在这里（而不是 morph.js）是因为首屏的弹层工具也要用，morph.js 整个文件不必进首屏。
 * @param {string} raw getComputedStyle(el).borderTopLeftRadius
 * @param {{ width: number, height: number }} rect
 */
export function resolveRadius(raw, rect) {
  const first = String(raw || '0').trim().split(/\s+/)[0];
  const half = Math.min(rect.width, rect.height) / 2;
  const v = parseFloat(first);
  if (!Number.isFinite(v)) return 0;
  const px = first.endsWith('%') ? (v / 100) * Math.min(rect.width, rect.height) : v;
  return Math.min(Math.max(0, px), half);
}
