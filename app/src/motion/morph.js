// =====================================================================
// motion/morph.js：共享元素形变——“从一个元素的位置和圆角长成另一个元素，再原路收回”。
//
// 给 overlay/（悬浮加号长成面板、全屏菜单圆形扩散）、ui/（卡片展开成详情）用：
//
//   const anim = morphFrom(panel, fabButton);           // 面板（已在最终布局）从按钮的位置、圆角长出来
//   …
//   await morphTo(panel, fabButton).finished;           // 原路收回到按钮“现在”的位置（中途滚动过也对），然后再卸载面板
//
//   revealCircle(menu, button);                         // 从按钮中心用 clip-path: circle() 扩散铺满
//   await revealCircle(menu, button, { reverse: true }).finished;   // 原路收回
//
// 两种形变方式（mode）：
//   'clip'（默认）：目标内容不缩放，只是用 clip-path: inset(… round 圆角) 从“按钮那么大的一块”
//      逐渐露出全部，同时整体从按钮的位置平移到最终位置。文字不会被压扁，最适合面板、菜单。
//   'transform'：平移 + 非等比缩放（圆角按比例反向修正），像“卡片放大成详情页”；内容会跟着缩放，
//      适合图片或配合 content 淡入。
//
// 打断：开到一半点关闭（或反过来），从当前的形状、当前的速度接着走，不会跳回起点。
// 减弱动态效果：不做几何形变，改成 --dur-fast 的淡入淡出。
// 阴影：clip-path 会把目标自己的阴影一起裁掉。两种做法：
//      - follow（推荐）：阴影放在目标下面单独一层（透明底 + 外阴影），用 follow 让它的实际形状和裁切出来的形状
//        同一条弹簧、逐帧一致（clipFollower 生成渲染函数）——形变全程都有阴影，而且是跟着圆角走的软阴影；
//      - 目标自己带阴影：形变过程中没有外阴影，长出来以后阴影用 --dur-base 淡入（fadeShadow: false 关掉）。
//      裁切框永远不超出目标自己的边框（弹簧过冲只体现在平移上）：负的 inset 会露出一条被裁成硬边的阴影带。
//      shadowMargin（px）：终点裁切框向外多留一圈，一般不要用。
// 颜色和内容跟着形状走（contentFade: 'shape'、tint，规则在 morph-shape.js）：按钮长成面板时，面板上盖一层按钮颜色的
//      色层，和按钮一样大时完全是按钮的颜色、长大了褪掉；内容在形状长到一定大小后才出现。收回时反过来，落地时正好是
//      按钮的颜色——看起来是“按钮变成面板”，不是一块白色从按钮后面长出来、再缩回去。它们和形状同一组关键帧，
//      打断、反向都一起连续变化。#/dev/primitives 的演示和 overlay/AnchoredPanel.jsx 用的同一套。
// follow：渲染函数拿到的是同一组弹簧数值（x / y / t / r / b / l / rad），返回什么样式就逐帧写什么。
//      follow 里的元素开始前会清掉 transform / width / height / border-radius / opacity 的内联值；
//      减弱动态效果时 follow 里的元素统一淡入淡出（不需要的层别传）。
// =====================================================================

import { animateSpring, animateSpringGroup, animateTween, stopAnimation, clearStyle } from './animate.js';
import { prefersReducedMotion } from './reduced-motion.js';
import { num, clamp, resolveRadius, stage } from './physics.js';
import { shapeProgress, morphTintAt, morphContentAt } from './morph-shape.js';

const CHANNEL = 'morph';
const REVEAL = 'reveal';

/** 某个元素左上角的实际圆角 */
function cornerRadius(el, rect) {
  return resolveRadius(getComputedStyle(el).borderTopLeftRadius, rect);
}

/**
 * 量一个元素的位置和圆角；传入普通对象就原样补全。
 * @param {Element|{left:number,top:number,width:number,height:number,radius?:number}} source
 * @returns {{left:number,top:number,width:number,height:number,radius:number}}
 */
export function measure(source) {
  if (source && typeof source.getBoundingClientRect === 'function') {
    const r = source.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, radius: cornerRadius(source, r) };
  }
  if (!source) throw new Error('measure() 需要一个元素或矩形');
  return { left: source.left, top: source.top, width: source.width, height: source.height, radius: source.radius ?? 0 };
}

/**
 * 纯函数：clip 方式的“起点状态”。目标 T（最终布局）里露出一块和 S 一样大的区域，
 * 这块区域选在 T 里离 S 最近的位置（例如面板在按钮上方，就从面板底边靠近按钮的那一角露出），
 * 再整体平移，让这块区域正好盖在 S 上。
 * @returns {{ x:number, y:number, t:number, r:number, b:number, l:number, rad:number }}
 */
export function clipMorphStart(T, S) {
  const rw = Math.min(S.width, T.width);
  const rh = Math.min(S.height, T.height);
  const scx = S.left + S.width / 2 - T.left;
  const scy = S.top + S.height / 2 - T.top;
  const cx = clamp(scx, rw / 2, T.width - rw / 2);
  const cy = clamp(scy, rh / 2, T.height - rh / 2);
  const left = cx - rw / 2;
  const top = cy - rh / 2;
  return {
    x: scx - cx,
    y: scy - cy,
    t: top,
    l: left,
    r: T.width - left - rw,
    b: T.height - top - rh,
    rad: Math.min(S.radius ?? 0, rw / 2, rh / 2),
  };
}

/** clip 方式的“终点状态”（完全展开）。shadowMargin > 0 时裁切框向外多留，阴影不被裁 */
export function clipMorphEnd(T, shadowMargin = 0) {
  const m = -Math.max(0, shadowMargin);
  return { x: 0, y: 0, t: m, r: m, b: m, l: m, rad: (T.radius ?? 0) + Math.max(0, shadowMargin) };
}

/** 纯函数：transform 方式的起点（平移 + 缩放把 T 盖到 S 上，原点左上角）。rad 是“看起来的圆角” */
export function transformMorphStart(T, S) {
  return {
    x: S.left - T.left,
    y: S.top - T.top,
    sx: T.width > 0 ? S.width / T.width : 1,
    sy: T.height > 0 ? S.height / T.height : 1,
    rad: S.radius ?? 0,
  };
}

/** 从 (x, y) 到矩形最远角的距离（圆形扩散要铺满，半径至少这么大） */
export function coverRadius(x, y, width, height) {
  const dx = Math.max(x, width - x);
  const dy = Math.max(y, height - y);
  return Math.hypot(dx, dy);
}

/** 裁切框夹在目标自己的边框以内（≥ 0）：弹簧过冲时不露出被裁成硬边的阴影带，过冲只体现在平移上 */
function renderClip({ x, y, t, r, b, l, rad }) {
  return {
    transform: `translate(${num(x)}px, ${num(y)}px)`,
    clipPath: `inset(${num(Math.max(0, t))}px ${num(Math.max(0, r))}px ${num(Math.max(0, b))}px ${num(Math.max(0, l))}px round ${num(Math.max(0, rad))}px)`,
  };
}

/**
 * 给 follow 用的渲染函数：让另一层（放在目标同一位置、同样大小的绝对定位元素，比如阴影层）的**实际形状**
 * 和 clip 方式裁出来的形状逐帧一致（位置、宽高、圆角）。width / height 是目标的尺寸。
 * @param {{ width: number, height: number }} size
 */
export function clipFollower(size) {
  return ({ x, y, t, r, b, l, rad }) => {
    const T = Math.max(0, t);
    const R = Math.max(0, r);
    const B = Math.max(0, b);
    const L = Math.max(0, l);
    return {
      transform: `translate(${num(x + L)}px, ${num(y + T)}px)`,
      width: `${num(Math.max(0, size.width - L - R))}px`,
      height: `${num(Math.max(0, size.height - T - B))}px`,
      borderRadius: `${num(Math.max(0, rad))}px`,
    };
  };
}

function renderTransform({ x, y, sx, sy, rad }) {
  const r = Math.max(0, rad);
  return {
    transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(sx, 4)}, ${num(sy, 4)})`,
    borderRadius: `${num(r / Math.max(sx, 0.01))}px / ${num(r / Math.max(sy, 0.01))}px`,
  };
}

/** 找出要淡入淡出的内容元素 */
function contentOf(target, content) {
  if (!content) return [];
  if (typeof content === 'string') return [...target.querySelectorAll(content)];
  if (Array.isArray(content)) return content;
  return [content];
}

/** 停掉正在播的形变（连同跟着动的层），量出目标的真实布局位置（不含形变的 transform） */
function settle(target, follow = []) {
  const snap = stopAnimation(target, CHANNEL, { commit: false });
  stopAnimation(target, 'morph-fade', { commit: false });
  clearStyle(target, ['transform', 'clipPath', 'borderRadius', 'transformOrigin', 'opacity']);
  for (const [el] of follow || []) {
    stopAnimation(el, CHANNEL, { commit: false });
    stopAnimation(el, 'morph-fade', { commit: false });
    clearStyle(el, ['transform', 'width', 'height', 'borderRadius', 'opacity']);
  }
  return { snap, T: measure(target) };
}

const sameKeys = (a, b) => a && Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((k) => k in a);

/** 要跟着形状走的元素（色层、contentFade: 'shape' 时的内容）：开始前和 follow 一起停掉、清掉内联值 */
function linkedEls(o, kids) {
  return [...(o.tint ? [o.tint] : []), ...(o.contentFade === 'shape' ? kids : [])];
}

/**
 * 跟着形状走的层的渲染函数（见 morph-shape.js）：不透明度 = 形状进度的函数。
 * 色层在目标外面（和目标同一个位置、同样大小的兄弟元素）时还要跟着形状变：clip 方式用 clipFollower，
 * transform 方式用同样的平移 + 缩放（它的 transform-origin 要是 0 0）；在目标里面时只改不透明度（裁切 / 缩放自然带着它）。
 */
function shapeLinked(target, mode, T, S, kids, o) {
  const progress = shapeProgress(mode, T, S);
  const list = [];
  if (o.tint) {
    const geom = target.contains(o.tint) ? null : mode === 'clip' ? clipFollower(T) : renderTransform;
    list.push([o.tint, (v) => ({ ...(geom ? geom(v) : {}), opacity: num(morphTintAt(progress(v))) })]);
  }
  if (o.contentFade === 'shape') {
    for (const k of kids) {
      stopAnimation(k, 'morph-content', { commit: false });
      list.push([k, (v) => ({ opacity: num(morphContentAt(progress(v))) })]);
    }
  }
  return list;
}

/**
 * 从 source 的位置和圆角长成 target。target 必须已经在 DOM 里、处于最终布局。
 * @param {Element} target
 * @param {Element|{left,top,width,height,radius?}} source
 * @param {{ mode?: 'clip'|'transform', spring?: any, content?: string|Element|Element[], shadowMargin?: number,
 *           contentDelay?: number, contentFade?: 'time'|'shape', tint?: Element|null, fadeShadow?: boolean,
 *           follow?: Array<[Element, (values: object) => object]> }} [o]
 *   content：目标里随形变淡入的内容（选择器或元素）；默认不单独淡入
 *   contentFade：'time'（默认）延迟 contentDelay 后用 --dur-base 淡入；'shape' 不透明度跟着形状此刻有多大走
 *     （morph-shape.js 的 morphContentAt：形状长到 40%–90% 之间出现；收回时反过来）
 *   tint：色层元素（底色由调用方设成起点按钮的颜色，CSS 默认透明）：和按钮一样大时完全不透明，长到 6%–55% 之间褪掉
 *     （morphTintAt）——看起来是“按钮变成面板”。可以放在目标里面（只改不透明度），也可以是目标外面同位置同大小的兄弟元素
 *   follow：和目标同一条弹簧、同一组数值一起动的其他层（例如阴影层：[[shadowEl, clipFollower(size)]]）
 *   减弱动态效果时：整块淡入，tint 不出现，content 用 --dur-fast 淡入
 * @returns {{ finished: Promise<boolean>, duration: number, values: () => object, stop: Function }}
 */
export function morphFrom(target, source, o = {}) {
  const mode = o.mode || 'clip';
  const kids = contentOf(target, o.content);
  const { snap, T } = settle(target, [...(o.follow || []), ...linkedEls(o, kids).map((el) => [el])]);
  const S = measure(source);
  if (prefersReducedMotion.value) {
    for (const k of kids) {
      animateTween(k, [{ opacity: 1 }], { duration: 'fast', channel: 'morph-content', commit: 'final' })
        .finished.then((done) => done && clearStyle(k, ['opacity']));
    }
    for (const [el] of o.follow || []) animateTween(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'fast', easing: 'out', channel: 'morph-fade', commit: 'final' });
    return animateTween(target, [{ opacity: 0 }, { opacity: 1 }], { duration: 'fast', easing: 'out', channel: 'morph-fade', commit: 'final' });
  }
  const start = mode === 'clip' ? clipMorphStart(T, S) : transformMorphStart(T, S);
  const end = mode === 'clip' ? clipMorphEnd(T, o.shadowMargin) : { x: 0, y: 0, sx: 1, sy: 1, rad: T.radius };
  const resume = sameKeys(snap?.values, start);
  if (mode === 'transform') target.style.transformOrigin = '0 0';
  if (o.contentFade !== 'shape') {
    for (const k of kids) {
      // 播完回到 CSS 的值（不留内联的 opacity: 1）
      animateTween(k, resume ? [{ opacity: 1 }] : [{ opacity: 0 }, { opacity: 1 }], {
        duration: 'base', easing: 'out', delay: resume ? 0 : (o.contentDelay ?? 50), channel: 'morph-content', commit: 'final',
      }).finished.then((done) => done && clearStyle(k, ['opacity']));
    }
  }
  const entries = [[target, mode === 'clip' ? renderClip : renderTransform], ...(o.follow || []), ...shapeLinked(target, mode, T, S, kids, o)];
  const anim = animateSpringGroup(entries, {
    channel: CHANNEL,
    from: resume ? snap.values : start,
    velocity: resume ? snap.velocities : undefined,
    to: end,
    spring: o.spring || 'bouncy',
    commit: 'clear',
  });
  anim.finished.then((done) => {
    if (!done) return;
    clearStyle(target, ['transformOrigin']);
    // 裁切刚去掉：阴影淡入（这时还没绘制，不会先闪一下完整阴影）
    if (o.fadeShadow !== false && !(o.shadowMargin > 0)) {
      const shadow = getComputedStyle(target).boxShadow;
      if (shadow && shadow !== 'none') {
        animateTween(target, [{ boxShadow: 'none' }, { boxShadow: shadow }], { duration: 'base', easing: 'out', channel: 'morph-shadow' });
      }
    }
  });
  return anim;
}

/**
 * 原路收回到 dest（重新量 dest 现在的位置）。动画结束后 target 停在收回的形状上，调用方再把它卸载。
 * @param {Element} target
 * @param {Element|{left,top,width,height,radius?}} dest
 * @param {{ mode?: 'clip'|'transform', spring?: any, content?: string|Element|Element[], contentFade?: 'time'|'shape',
 *           tint?: Element|null, follow?: Array<[Element, (values: object) => object]> }} [o]
 *   content / contentFade / tint：同 morphFrom（'time' 时内容用 --dur-fast 淡出；'shape' 时内容先淡出、
 *     形状缩到一半左右色层盖上来，落地时正好是按钮的颜色）
 */
export function morphTo(target, dest, o = {}) {
  const mode = o.mode || 'clip';
  const kids = contentOf(target, o.content);
  const { snap, T } = settle(target, [...(o.follow || []), ...linkedEls(o, kids).map((el) => [el])]);
  const S = measure(dest);
  if (prefersReducedMotion.value) {
    for (const [el] of o.follow || []) animateTween(el, [{ opacity: 0 }], { duration: 'fast', easing: 'out', channel: 'morph-fade', commit: 'final' });
    return animateTween(target, [{ opacity: 0 }], { duration: 'fast', easing: 'out', channel: 'morph-fade', commit: 'final' });
  }
  stopAnimation(target, 'morph-shadow', { commit: false });
  const identity = mode === 'clip' ? clipMorphEnd(T, o.shadowMargin) : { x: 0, y: 0, sx: 1, sy: 1, rad: T.radius };
  const end = mode === 'clip' ? clipMorphStart(T, S) : transformMorphStart(T, S);
  const resume = sameKeys(snap?.values, end);
  if (mode === 'transform') target.style.transformOrigin = '0 0';
  const entries = [[target, mode === 'clip' ? renderClip : renderTransform], ...(o.follow || []), ...shapeLinked(target, mode, T, S, kids, o)];
  const anim = animateSpringGroup(entries, {
    channel: CHANNEL,
    from: resume ? snap.values : identity,
    velocity: resume ? snap.velocities : undefined,
    to: end,
    // 收回用不回弹的 smooth：回弹会让面板在按钮处“鼓”一下
    spring: o.spring || 'smooth',
    commit: 'final',
  });
  if (o.contentFade !== 'shape') {
    for (const k of kids) {
      animateTween(k, [{ opacity: 0 }], { duration: 'fast', easing: 'out', channel: 'morph-content', commit: 'final' });
    }
  }
  return anim;
}

/**
 * 圆形扩散（clip-path: circle()）：从 origin 的中心扩散到铺满 target，或反向收回。
 * @param {Element} target 铺满的那一层（通常是全屏菜单）
 * @param {Element|{x:number,y:number}} origin 按钮元素（从它的中心、以它的半径为起点），或视口坐标点
 * @param {{ reverse?: boolean, spring?: any, fromRadius?: number, fadeRadius?: [number, number] }} [o]
 *   fadeRadius：[a, b] 半径小于 b 时整层跟着半径变淡，到 a 完全透明（不透明度 = 半径的函数，和圆同一组关键帧）。
 *     从一个点扩散、收回到一个点时用：圆在按钮上方时不会是一块白色圆片盖住按钮——收回的最后一段圆逐渐透明、
 *     按钮从下面透出来；展开的头几帧同理。半路打断也连续（同一个半径对应同一个不透明度）。
 */
export function revealCircle(target, origin, o = {}) {
  const T = measure(target);
  let cx;
  let cy;
  let r0 = o.fromRadius ?? 0;
  if (origin && typeof origin.getBoundingClientRect === 'function') {
    const b = origin.getBoundingClientRect();
    cx = b.left + b.width / 2 - T.left;
    cy = b.top + b.height / 2 - T.top;
    if (o.fromRadius === undefined) r0 = Math.min(b.width, b.height) / 2;
  } else {
    cx = (origin?.x ?? T.left + T.width / 2) - T.left;
    cy = (origin?.y ?? T.top + T.height / 2) - T.top;
  }
  const R = coverRadius(cx, cy, T.width, T.height) + 2;
  if (prefersReducedMotion.value) {
    stopAnimation(target, REVEAL, { commit: false });
    clearStyle(target, ['clipPath']);
    return animateTween(target, o.reverse ? [{ opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], {
      duration: 'fast', easing: 'out', channel: 'reveal-fade', commit: o.reverse ? 'final' : 'none',
    });
  }
  const fade = o.fadeRadius;
  const render = ({ rr }) => {
    const style = { clipPath: `circle(${num(Math.max(0, rr))}px at ${num(cx)}px ${num(cy)}px)` };
    if (fade) style.opacity = num(stage(rr, fade[0], fade[1]));
    return style;
  };
  return animateSpring(target, {
    channel: REVEAL,
    // 没有正在播的扩散时：展开从按钮大小开始，收回从铺满开始
    current: () => ({ rr: o.reverse ? R : r0 }),
    to: { rr: o.reverse ? r0 : R },
    spring: o.spring || 'smooth',
    commit: o.reverse ? 'final' : 'clear',
    render,
  });
}
