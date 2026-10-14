// =====================================================================
// motion/animate.js：Web Animations（element.animate）封装——所有 JS 动画都从这里走。
//
// 三种动画，接口一致（values() / velocities() / stop() / finished）：
//
//   1. animateSpring(el, { from, to, velocity, spring, render, channel })
//      物理弹簧 → 采样成关键帧交给 WAAPI 播放（在合成线程跑，主线程忙也不掉帧）。
//      from/to 是“抽象数值”（例如 { x: 0, y: 12, sx: 1 }），render 把一组数值变成样式对象
//      （{ transform: `translate(${x}px, …)` }）。速度单位：数值单位/秒。
//
//   2. springValue(el, { from, to, velocity, spring, onUpdate, channel })
//      同样的弹簧，但每帧调用 onUpdate(values) 由你自己改 DOM（例如 SVG 的 d 属性，Safari 不支持用
//      CSS 动画 d）。时间来源是一个挂在 el 上的“空关键帧”WAAPI 动画（时钟），所以开发者工具的
//      动画面板、e2e 的“截动画半路”（CDP 拨动画进度）对它同样有效。
//
//   3. animateTween(el, keyframes, { duration, easing, channel })
//      普通补间（淡入淡出、颜色），时长和缓动可以直接写设计变量的名字：'fast'、'out'。
//
// 打断与接力（交互要求“动画可被打断”）：
//   给动画起一个 channel（通道名，例如 'thumb'、'flip'）。同一元素同一通道上开始新动画时，
//   旧动画会被停在当前帧，新动画默认从旧动画的当前值、当前速度出发——方向反转时不会跳，
//   速度连续（手感像真实物体）。不用 setTimeout 排顺序：await anim.finished（true = 播完，false = 被打断）。
//
// 减弱动态效果：弹簧自动换成 --dur-fast 的 --ease-out 短补间（不回弹、忽略初速度）；
//   reduced: 'instant' 直接跳到终点；reduced: 'ignore' 照常弹簧（只用于很小的位移，比如按压）。
//   大位移的动画请组件自己改成淡入淡出（读 prefersReducedMotion）。
//
// 结束后的样式：commit: 'final'（默认，把终点样式写进 el.style 后移除动画）、
//   'clear'（移除动画并清掉这些内联样式，回到 CSS 的值——FLIP 这类终点就是“无变换”的用它）、
//   'none'（什么都不写，动画移除后就是 CSS 的值）。
//
// 补间的接力（animateTween 同一通道的新动画）：旧动画**不**用 commitStyles() 写进内联样式
// （写进去的半路值会永久留在元素上——列表 ↔ 网格连点两下标题消失就是这么来的）：
//   新动画自己写了起点（两个以上关键帧）→ 直接撤掉旧的；
//   只写了终点 → 先读旧动画此刻“看起来”的值（getComputedStyle 含动画效果）当起点，再撤掉旧的。
// 接力的新动画（弹簧、补间都一样）从“这一帧”的时刻起算（startTime = document.timeline.currentTime），
//   不等下一帧才开始——否则反向那一刻会原地停一帧（见 startNow）。
// =====================================================================

import { springGroup, sampleFrames, parseCubicBezier } from './physics.js';
import { prefersReducedMotion } from './reduced-motion.js';
import { getTimeScale, cssDuration, cssEasing } from './time.js';

/** el → Map(通道名 → 动画) */
const registry = new WeakMap();

function channelMap(el) {
  let m = registry.get(el);
  if (!m) {
    m = new Map();
    registry.set(el, m);
  }
  return m;
}

/** 某元素某通道上正在播的动画（没有返回 null） */
export function getAnimation(el, channel) {
  return (el && registry.get(el)?.get(channel)) || null;
}

/** 停掉某元素某通道上的动画。返回 { values, velocities }（没有动画返回 null） */
export function stopAnimation(el, channel, opts) {
  const a = getAnimation(el, channel);
  return a ? a.stop(opts) : null;
}

/** 停掉某元素上所有通道的动画 */
export function stopAll(el, opts) {
  const m = el && registry.get(el);
  if (!m) return;
  for (const a of [...m.values()]) a.stop(opts);
}

function register(el, channel, anim) {
  if (!channel) return;
  channelMap(el).set(channel, anim);
}

function unregister(el, channel, anim) {
  if (!channel) return;
  const m = registry.get(el);
  if (m && m.get(channel) === anim) m.delete(channel);
}

const toKebab = (k) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

/**
 * 把样式对象写进 el.style（支持 camelCase 和 --自定义属性；值为 null/undefined/'' 时删除该属性）。
 * WAAPI 关键帧里的 offset、easing、composite 会被忽略。
 */
export function applyStyle(el, styles) {
  if (!el || !styles) return;
  for (const [k, v] of Object.entries(styles)) {
    if (k === 'offset' || k === 'easing' || k === 'composite') continue;
    if (v === null || v === undefined || v === '') el.style.removeProperty(toKebab(k));
    else el.style.setProperty(toKebab(k), String(v));
  }
}

/** 删除若干内联样式（camelCase 或 kebab 都行） */
export function clearStyle(el, keys) {
  if (!el) return;
  for (const k of keys) {
    if (k === 'offset' || k === 'easing' || k === 'composite') continue;
    el.style.removeProperty(toKebab(k));
  }
}

const canAnimate = (el) => !!el && typeof el.animate === 'function';

/**
 * 接力的新动画从“这一帧”的时刻算起，不等下一帧：WAAPI 新建的动画要到下一帧才真正开始（第一帧停在起点），
 * 而起点是旧动画在这一帧的值——不处理的话，反向那一刻会原地停一帧（速度瞬间归零，看得出一顿）。
 * 旧动画的 values() 读的就是时间线此刻（document.timeline.currentTime）对应的值，所以从同一时刻起算正好接上。
 */
function startNow(animation) {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  if (!animation || typeof t !== 'number') return;
  try {
    animation.startTime = t;
  } catch {
    /* 个别环境不允许改 startTime：保持默认（下一帧开始） */
  }
}

/** 当前是否按“减弱动态效果”处理；返回 null（正常）或 'tween' / 'instant' */
function reducedMode(option) {
  if (option === 'ignore') return null;
  if (!prefersReducedMotion.value) return null;
  return option === 'instant' ? 'instant' : 'tween';
}

const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/**
 * 弹簧动画的公共部分（WAAPI 关键帧版和 rAF 版共用）：算弹簧、计时、取值、取速度、打断。
 */
class SpringBase {
  constructor(el, o) {
    if (!o || !o.to) throw new Error('动画需要 to（终点数值）');
    this.el = el;
    this.channel = o.channel || null;
    this.state = 'running';
    this.k = getTimeScale();
    this.reduced = reducedMode(o.reduced);
    this.group = springGroup(o.spring ?? 'smooth', o.from || o.to, o.to, this.reduced ? {} : o.velocity, o.precision);
    this.delay = Math.max(0, o.delay || 0) * this.k;
    this.ease = null;
    this.duration = 0;
    if (this.reduced === 'tween') {
      this.ease = parseCubicBezier(cssEasing('out'));
      this.duration = cssDuration('fast');
    } else if (this.reduced !== 'instant') {
      this.duration = this.group.duration * 1000 * this.k;
    }
    this.finished = new Promise((resolve) => {
      this._resolve = resolve;
    });
    /** 底层 WAAPI 动画（关键帧版是真动画，rAF 版是时钟） */
    this.animation = null;
  }

  /** 已经播了多久：弹簧版返回物理时间（秒），补间版返回 0–1 的时间进度 */
  _t() {
    const ct = this.animation?.currentTime;
    if (ct === null || ct === undefined) return 0;
    const local = Math.max(0, Number(ct) - this.delay);
    if (this.ease) return Math.min(1, this.duration > 0 ? local / this.duration : 1);
    return local / 1000 / this.k;
  }

  /** 当前各通道的值（被打断时新动画从这里接着走） */
  values() {
    const g = this.group;
    if (this.state === 'finished') return { ...g.to };
    if (this.ease) {
      const p = this.ease(this._t());
      const out = {};
      for (const key of g.keys) out[key] = g.from[key] + (g.to[key] - g.from[key]) * p;
      return out;
    }
    return g.at(this._t());
  }

  /** 当前各通道的速度（单位/秒，按物理时间；补间版为 0） */
  velocities() {
    if (this.state !== 'running' || this.ease) return zeros(this.group.keys);
    return this.group.velocityAt(this._t());
  }

  /** 是否还在播 */
  get running() {
    return this.state === 'running';
  }
}

/**
 * WAAPI 关键帧版弹簧动画（见文件头说明 1）。
 */
export class SpringAnimation extends SpringBase {
  constructor(el, o) {
    super(el, o);
    if (typeof o.render !== 'function') throw new Error('animateSpring 需要 render(values) → 样式对象');
    this.render = o.render;
    this.commit = o.commit ?? 'final';
    if (this.reduced === 'instant' || !canAnimate(el) || this.duration <= 0) {
      this._complete();
      return;
    }
    let keyframes;
    let easing = 'linear';
    if (this.ease) {
      keyframes = [this.render(this.group.from), this.render(this.group.to)];
      easing = cssEasing('out');
    } else {
      keyframes = sampleFrames(this.group).map((f) => ({ offset: f.offset, ...this.render(f.values) }));
    }
    this.animation = el.animate(keyframes, {
      duration: this.duration,
      delay: this.delay,
      easing,
      fill: 'both',
      id: o.id || this.channel || undefined,
    });
    if (o.continued) startNow(this.animation);
    this.animation.onfinish = () => this._complete();
  }

  /**
   * 停在当前帧。commit = true 时把当前样式写进 el.style（元素停在半路），false 时直接移除动画
   * （紧接着开始新动画的时候用，同一帧里不会闪）。
   */
  stop({ commit = true } = {}) {
    const snap = { values: this.values(), velocities: this.velocities() };
    if (this.state !== 'running') return snap;
    this.state = 'stopped';
    if (commit) applyStyle(this.el, this.render(snap.values));
    this.animation?.cancel();
    unregister(this.el, this.channel, this);
    this._resolve(false);
    return snap;
  }

  _complete() {
    if (this.state !== 'running') return;
    this.state = 'finished';
    const final = this.render(this.group.to);
    if (this.commit === 'final') applyStyle(this.el, final);
    else if (this.commit === 'clear') clearStyle(this.el, Object.keys(final));
    this.animation?.cancel();
    unregister(this.el, this.channel, this);
    this._resolve(true);
  }
}

/**
 * rAF 版弹簧（见文件头说明 2）：每帧调用 onUpdate(values)。
 */
export class SpringDriver extends SpringBase {
  constructor(el, o) {
    super(el, o);
    if (typeof o.onUpdate !== 'function') throw new Error('springValue 需要 onUpdate(values)');
    this.onUpdate = o.onUpdate;
    this._raf = 0;
    this._tick = this._tick.bind(this);
    if (this.reduced === 'instant' || !canAnimate(el) || this.duration <= 0) {
      this._complete();
      return;
    }
    // 时钟：空关键帧的 WAAPI 动画。读它的 currentTime 算弹簧位置，所以暂停、拨进度、慢放都对它有效
    this.animation = el.animate([], { duration: this.duration, delay: this.delay, id: o.id || this.channel || 'motion-clock' });
    if (o.continued) startNow(this.animation);
    this.animation.onfinish = () => this._complete();
    this.onUpdate(this.values());
    this._raf = requestAnimationFrame(this._tick);
  }

  _tick() {
    if (this.state !== 'running') return;
    this.onUpdate(this.values());
    this._raf = requestAnimationFrame(this._tick);
  }

  stop({ commit = true } = {}) {
    const snap = { values: this.values(), velocities: this.velocities() };
    if (this.state !== 'running') return snap;
    this.state = 'stopped';
    cancelAnimationFrame(this._raf);
    if (commit) this.onUpdate(snap.values);
    this.animation?.cancel();
    unregister(this.el, this.channel, this);
    this._resolve(false);
    return snap;
  }

  _complete() {
    if (this.state !== 'running') return;
    this.state = 'finished';
    cancelAnimationFrame(this._raf);
    this.onUpdate({ ...this.group.to });
    this.animation?.cancel();
    unregister(this.el, this.channel, this);
    this._resolve(true);
  }
}

/** 打断同通道的旧动画，算出新动画的起点和初速度 */
function handoff(el, o) {
  let { from, velocity } = o;
  if (o.channel) {
    const prev = getAnimation(el, o.channel);
    if (prev) {
      const wasRunning = prev.running;
      const snap = prev.stop({ commit: false });
      if (from === undefined) from = snap.values;
      if (velocity === undefined && o.inheritVelocity !== false) velocity = snap.velocities;
      // 接着正在播的旧动画走：新动画从这一帧起算（见 startNow）
      if (wasRunning) return { ...o, from: from ?? o.to, velocity, continued: true };
    }
  }
  if (from === undefined) from = typeof o.current === 'function' ? o.current() : undefined;
  return { ...o, from: from ?? o.to, velocity };
}

/**
 * 弹簧动画（WAAPI 关键帧）。
 * @param {Element} el
 * @param {{
 *   to: Record<string, number>,
 *   from?: Record<string, number>,          不给：同通道正在播的动画的当前值 → current() → 直接等于 to（不动）
 *   velocity?: Record<string, number>,      初速度（单位/秒）；不给：同通道旧动画的当前速度
 *   spring?: 'snappy'|'bouncy'|'smooth'|{duration,bounce}|Record<string, any>,  可按通道分别指定
 *   render: (values) => object,             数值 → 样式对象（WAAPI 关键帧写法：transform、opacity、clipPath…）
 *   channel?: string,                       通道名：同元素同通道的新动画会打断并接力旧动画
 *   commit?: 'final'|'clear'|'none',
 *   reduced?: 'tween'|'instant'|'ignore',
 *   delay?: number,                         毫秒
 *   current?: () => Record<string, number>, 没有正在播的动画时，读当前值
 *   inheritVelocity?: boolean,              默认 true
 *   id?: string,
 * }} options
 * @returns {SpringAnimation}
 */
export function animateSpring(el, options) {
  const anim = new SpringAnimation(el, handoff(el, options));
  if (anim.running) register(el, options.channel, anim);
  return anim;
}

/**
 * 一组元素用同一条弹簧、同一组数值一起动（每个元素有自己的 render）。
 * 例如顶栏收成胶囊：玻璃底的形状、阴影、标题、两侧按钮都由同一个进度 p 驱动——
 * 打断时所有元素从**同一个**当前值、当前速度接力（读第一个元素同通道的旧动画），不会各走各的。
 *   const anim = animateSpringGroup([[glass, renderGlass], [title, renderTitle]], {
 *     channel: 'ch', current: () => ({ p: 0 }), to: { p: 1 }, spring: 'smooth', commit: 'clear' });
 * @param {Array<[Element|null, (values: object) => object]>} entries
 * @param {Omit<Parameters<typeof animateSpring>[1], 'render'>} options
 * @returns {{ animations: SpringAnimation[], finished: Promise<boolean>, values: () => object, velocities: () => object, stop: (o?: object) => void, duration: number }}
 */
export function animateSpringGroup(entries, options) {
  const list = entries.filter(([el]) => el);
  if (!list.length) {
    return { animations: [], finished: Promise.resolve(true), values: () => ({ ...options.to }), velocities: () => ({}), stop() {}, duration: 0 };
  }
  let { from, velocity } = options;
  const prev = options.channel ? getAnimation(list[0][0], options.channel) : null;
  if (prev) {
    if (from === undefined) from = prev.values();
    if (velocity === undefined && options.inheritVelocity !== false) velocity = prev.velocities();
  }
  if (from === undefined) from = typeof options.current === 'function' ? options.current() : options.to;
  // 接着正在播的一组走：组里每个元素（包括这次才加进来的）都从这一帧起算，保持同一帧对齐（见 startNow）
  const continued = Boolean(prev?.running);
  const animations = list.map(([el, render]) => animateSpring(el, { ...options, from, velocity, render, current: undefined, continued }));
  return {
    animations,
    finished: Promise.all(animations.map((a) => a.finished)).then((r) => r.every(Boolean)),
    values: () => animations[0].values(),
    velocities: () => animations[0].velocities(),
    stop: (o) => animations.forEach((a) => a.stop(o)),
    duration: animations[0].duration,
  };
}

/**
 * 弹簧数值（rAF 驱动，每帧 onUpdate(values)）。参数同 animateSpring，只是把 render 换成 onUpdate。
 * @returns {SpringDriver}
 */
export function springValue(el, options) {
  const anim = new SpringDriver(el, handoff(el, options));
  if (anim.running) register(el, options.channel, anim);
  return anim;
}

/**
 * 普通补间（WAAPI）。
 * @param {Element} el
 * @param {Keyframe[]|PropertyIndexedKeyframes} keyframes 只写终点（如 [{ opacity: 0 }]）就从当前值出发
 * @param {{ duration?: 'instant'|'fast'|'base'|'slow'|'slower'|number, easing?: 'standard'|'out'|'in'|'in-out'|string,
 *           delay?: number, fill?: FillMode, commit?: 'final'|'none', channel?: string, reduced?: 'keep'|'instant', id?: string }} [o]
 */
export function animateTween(el, keyframes, o = {}) {
  const channel = o.channel || null;
  let frames = Array.isArray(keyframes) ? keyframes : [keyframes];
  let continued = false;
  if (channel) {
    const prev = getAnimation(el, channel);
    if (prev) {
      continued = prev.running;
      if (frames.length === 1 && canAnimate(el)) frames = [currentFrame(el, frames[0]), frames[0]];
      prev.stop({ commit: false });
    }
  }
  const duration = cssDuration(o.duration ?? 'base');
  const instant = !canAnimate(el) || duration <= 0 || (o.reduced === 'instant' && prefersReducedMotion.value);
  const last = frames[frames.length - 1] || {};
  let resolve;
  const finished = new Promise((r) => {
    resolve = r;
  });
  const anim = {
    el,
    channel,
    state: 'running',
    animation: null,
    finished,
    get running() {
      return anim.state === 'running';
    },
    values: () => ({}),
    velocities: () => ({}),
    stop({ commit = true } = {}) {
      if (anim.state !== 'running') return { values: {}, velocities: {} };
      anim.state = 'stopped';
      if (commit && anim.animation && typeof anim.animation.commitStyles === 'function') {
        try {
          anim.animation.commitStyles();
        } catch {
          /* 元素已不在页面上：忽略 */
        }
      }
      anim.animation?.cancel();
      unregister(el, channel, anim);
      resolve(false);
      return { values: {}, velocities: {} };
    },
  };
  const complete = () => {
    if (anim.state !== 'running') return;
    anim.state = 'finished';
    if ((o.commit ?? 'none') === 'final') applyStyle(el, last);
    if ((o.fill ?? 'none') === 'none' || o.commit === 'final') anim.animation?.cancel();
    unregister(el, channel, anim);
    resolve(true);
  };
  if (instant) {
    complete();
    return anim;
  }
  anim.animation = el.animate(frames, {
    duration,
    delay: (o.delay || 0) * getTimeScale(),
    easing: cssEasing(o.easing ?? 'out'),
    fill: o.fill ?? (o.commit === 'final' ? 'both' : 'backwards'),
    id: o.id || channel || undefined,
  });
  if (continued) startNow(anim.animation);
  anim.animation.onfinish = complete;
  register(el, channel, anim);
  return anim;
}

/** 某个关键帧里那些属性此刻“看起来”的值（含正在播的动画），用作接力动画的起点 */
function currentFrame(el, frame) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const k of Object.keys(frame)) {
    if (k === 'offset' || k === 'easing' || k === 'composite') continue;
    const v = k.startsWith('--') ? cs.getPropertyValue(k) : cs[k] ?? cs.getPropertyValue(toKebab(k));
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** 等下一帧（布局已经更新、还没绘制时做测量用） */
export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
