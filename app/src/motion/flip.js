// =====================================================================
// motion/flip.js：FLIP（First → Last → Invert → Play）布局动画。
//
// 用法（不依赖任何框架）：
//   const snap = captureLayout(listEl);        // 1. 改 DOM 之前：记下每个 [data-flip-key] 元素的位置（含正在播的动画）
//   …改 DOM（排序、增删、列表 ↔ 网格）…        // 2. Preact 里：在 getSnapshotBeforeUpdate 记录、componentDidUpdate 播放
//   await playFlip(snap, listEl);              // 3. 量新位置、反算变换、用弹簧播回 0
// Preact 组件里直接用 ui/FlipGroup.jsx（属性 trigger 一变就自动 FLIP），或 motion/hooks.js 的 useFlip。
//
// 元素标记：
//   data-flip-key="唯一键"            参与 FLIP（同一个键前后对应同一个东西）
//   data-flip="auto"（默认）          尺寸没变 → 只平移；尺寸变了 → 平移 + 缩放（圆角按缩放反向修正）
//   data-flip="position"             只平移（文字：缩放会把字压扁）
//   data-flip="text"                 文字块：尺寸没变 → 只平移；尺寸变了（换行方式变了，例如列表 ↔ 网格）→ 平移的同时
//                                    “淡出—再淡入”，中途不和旁边正在长大的图片叠在一起（照片 App 的做法）
//   data-flip="box"                  平移 + 非等比缩放（纯色背景层、卡片底板）
//   data-flip="crop"                 等比缩放 + clip-path 裁切（图片：从方形缩略图变成 4:3 大图不变形）
//   data-flip="none"                 不动
//
// 进场 / 离场：
//   新出现的元素：从 enterFrom[key] 给的位置飞进来（例如“新记录从面板的位置落进列表”），
//                 没给就原地淡入 + 从 0.92 放大；
//   消失的元素：克隆一个“幽灵”放回原位，淡出 + 缩小后删掉（Preact 已经把真元素卸载了，不影响状态）。
//
// 规则：
//   - 参与 FLIP 的元素不要互相嵌套（父元素缩放时子元素的反算会错）。复合卡片请拆成几个“部件”
//     各自标 data-flip-key（例如 card:12:bg、card:12:media、card:12:text），卡片本身不变换。
//   - 动画中途再次 FLIP（快速连点切换）：起点按“当前看到的位置”量，速度从正在播的动画接过来，不会跳；
//     文字的“淡出—再淡入”也从当前的不透明度接着走（不闪回 1），播完不在元素上留下任何内联 opacity。
//   - 减弱动态效果：不做位移，新位置直接出现并做一次很短的淡入。
// =====================================================================

import { animateSpring, animateSpringGroup, animateTween, getAnimation, stopAnimation, clearStyle } from './animate.js';
import { prefersReducedMotion } from './reduced-motion.js';
import { num, stage } from './physics.js';

const CHANNEL = 'flip';

/** 读元素左上角的圆角（px） */
function radiusOf(el) {
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(v) ? v : 0;
}

/** DOMRect → 普通对象（可序列化、可比较） */
export function plainRect(r) {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function query(root, selector) {
  if (!root) return [];
  if (Array.isArray(root)) return root.filter(Boolean);
  const list = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) list.unshift(root);
  return list;
}

/**
 * 1. 记录起点。
 * @param {Element|Element[]} root 容器（查找里面的 [data-flip-key]）或元素数组
 * @param {{ selector?: string }} [o]
 * @returns {Map<string, { el: Element, rect: object, radius: number, velocity: {x:number,y:number} }>}
 */
export function captureLayout(root, { selector = '[data-flip-key]' } = {}) {
  const snap = new Map();
  for (const el of query(root, selector)) {
    const key = el.getAttribute('data-flip-key');
    if (!key || snap.has(key)) continue;
    const running = getAnimation(el, CHANNEL);
    const v = running?.velocities?.() || {};
    // 正在播 box / crop 动画时，样式里的圆角是“反向修正过的”，要用动画里记录的“看起来的圆角”
    const r = running?.values?.().r;
    snap.set(key, {
      el,
      rect: plainRect(el.getBoundingClientRect()),
      radius: Number.isFinite(r) ? r : radiusOf(el),
      velocity: { x: v.x || 0, y: v.y || 0 },
    });
  }
  return snap;
}

/**
 * 纯函数：算“反向变换”的起点（First 相对 Last）。单元测试覆盖。
 * @param {'auto'|'position'|'box'|'crop'} mode
 * @param {{left,top,width,height}} first
 * @param {{left,top,width,height}} last
 * @param {{ firstRadius?: number, lastRadius?: number }} [radii] 前后的圆角：box / crop 模式会从旧圆角过渡到新圆角
 * @returns {{ mode: 'position'|'box'|'crop', from: Record<string, number>, to: Record<string, number> } | null}
 *   null = 位置尺寸都没变，不用动
 */
export function invertFor(mode, first, last, { firstRadius = 0, lastRadius = 0 } = {}) {
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = last.width > 0 ? first.width / last.width : 1;
  const sy = last.height > 0 ? first.height / last.height : 1;
  const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
  const resized = Math.abs(first.width - last.width) > 0.5 || Math.abs(first.height - last.height) > 0.5;
  if (!moved && !resized) return null;
  let m = mode === 'auto' ? (resized ? 'box' : 'position') : mode;
  if (m === 'text') m = 'position';
  if (m === 'crop' && !resized) m = 'position';
  if (m === 'position') {
    // 只平移：对齐左上角（尺寸变化时文字从旧位置滑到新位置）
    return { mode: 'position', from: { x: dx, y: dy }, to: { x: 0, y: 0 } };
  }
  if (m === 'box') {
    return { mode: 'box', from: { x: dx, y: dy, sx, sy, r: firstRadius }, to: { x: 0, y: 0, sx: 1, sy: 1, r: lastRadius } };
  }
  // crop：等比缩放到“盖住”旧框，再用 clip-path 只露出旧框那么大的区域（居中裁切）
  const s = Math.max(sx, sy);
  const ix = (last.width - first.width / s) / 2;
  const iy = (last.height - first.height / s) / 2;
  return {
    mode: 'crop',
    from: { x: dx - s * ix, y: dy - s * iy, s, ix, iy, r: firstRadius },
    to: { x: 0, y: 0, s: 1, ix: 0, iy: 0, r: lastRadius },
  };
}

/** 各模式的“数值 → 样式”。r 是“看起来的圆角”，按缩放比例反向修正后写进样式，缩放时圆角不会被压扁 */
export function flipRenderer(mode, withRadius = true) {
  if (mode === 'position') {
    return ({ x, y }) => ({ transform: `translate(${num(x)}px, ${num(y)}px)` });
  }
  if (mode === 'box') {
    return ({ x, y, sx, sy, r = 0 }) => ({
      transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(sx, 4)}, ${num(sy, 4)})`,
      ...(withRadius ? { borderRadius: `${num(Math.max(0, r) / Math.max(sx, 0.01))}px / ${num(Math.max(0, r) / Math.max(sy, 0.01))}px` } : {}),
    });
  }
  return ({ x, y, s, ix, iy, r = 0 }) => ({
    transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(s, 4)})`,
    clipPath: `inset(${num(Math.max(0, iy))}px ${num(Math.max(0, ix))}px ${num(Math.max(0, iy))}px ${num(Math.max(0, ix))}px round ${num(Math.max(0, r) / Math.max(s, 0.01))}px)`,
  });
}

/**
 * 要不要逐帧修正圆角（border-radius 不能在合成线程动画，修正会让这个元素的动画回到主线程）：
 * 不修正时圆角看起来是“新圆角 × 缩放”，和应该的样子差不到 1px 就不修正（只动 transform，留在合成线程）。
 * 纯函数，单元测试覆盖。
 */
export function needsRadiusCorrection(inv, firstRadius, lastRadius) {
  if (!(firstRadius > 0 || lastRadius > 0)) return false;
  if (inv.mode === 'position') return false;
  const sx = inv.mode === 'crop' ? inv.from.s : inv.from.sx;
  const sy = inv.mode === 'crop' ? inv.from.s : inv.from.sy;
  const off = (scale) => Math.abs(lastRadius * scale - firstRadius);
  return inv.mode === 'crop' || off(sx) >= 1 || off(sy) >= 1;
}

/** 元素原本的内联 transform-origin（被打断的动画不会还原，要记住最早的那个） */
const originalOrigin = new WeakMap();

/** 动画期间临时改 transform-origin，结束后还原成最初的值 */
function withOrigin(el, origin) {
  if (!originalOrigin.has(el)) originalOrigin.set(el, el.style.transformOrigin);
  el.style.transformOrigin = origin;
  return () => releaseOrigin(el);
}

/**
 * 还原 withOrigin 临时改的 transform-origin。被下一轮 FLIP 打断的动画不会走到自己的还原；下一轮开始时统一先还原，
 * 要接着动的元素再重新设——否则连点几下后某些元素会留着内联的 transform-origin: 0 0
 * （之后按压缩放就从左上角缩，而不是从中心）。
 */
function releaseOrigin(el) {
  if (!originalOrigin.has(el)) return;
  el.style.transformOrigin = originalOrigin.get(el) ?? '';
  originalOrigin.delete(el);
}

/** 把一个已卸载的元素克隆成“幽灵”，放回它原来的位置（相对容器绝对定位） */
function makeGhost(entry, container) {
  const ghost = entry.el.cloneNode(true);
  ghost.removeAttribute('data-flip-key');
  ghost.removeAttribute('id');
  for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  const cr = container.getBoundingClientRect();
  const left = entry.rect.left - cr.left - (parseFloat(cs.borderLeftWidth) || 0) + container.scrollLeft;
  const top = entry.rect.top - cr.top - (parseFloat(cs.borderTopWidth) || 0) + container.scrollTop;
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${entry.rect.width}px`,
    height: `${entry.rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    transform: 'none',
    zIndex: '0',
    gridArea: 'auto',
  });
  ghost.setAttribute('data-flip-ghost', '');
  container.appendChild(ghost);
  return ghost;
}

/**
 * 3. 播放。
 * @param {ReturnType<typeof captureLayout>} snapshot
 * @param {Element|Element[]} root 改完 DOM 后的容器（或元素数组）
 * @param {{
 *   selector?: string,
 *   spring?: 'snappy'|'bouncy'|'smooth'|object,   默认 smooth（不回弹，重排最稳）
 *   stagger?: number,                              每个元素依次延后的毫秒数（按文档顺序），默认 0
 *   enter?: 'pop'|'fade'|'none',                   新元素的进场，默认 pop
 *   exit?: 'ghost'|'none',                         消失元素的离场，默认 ghost
 *   enterFrom?: Map<string, {left,top,width,height}> | Record<string, …>,   新元素从哪里飞进来
 *   container?: Element,                           幽灵放进哪个容器（默认 root）
 * }} [o]
 * @returns {Promise<void>} 全部动画结束（或被下一次 FLIP 打断）后 resolve
 */
export function playFlip(snapshot, root, o = {}) {
  const selector = o.selector || '[data-flip-key]';
  const spring = o.spring || 'smooth';
  const stagger = o.stagger || 0;
  const reduced = prefersReducedMotion.value;
  const enterFrom = o.enterFrom instanceof Map ? o.enterFrom : new Map(Object.entries(o.enterFrom || {}));
  const els = query(root, selector);

  // 第一遍：停掉这些元素上正在播的 FLIP（不写样式）、还原它们临时改的 transform-origin，让下面量到的是真正的新布局
  for (const el of els) {
    stopAnimation(el, CHANNEL, { commit: false });
    releaseOrigin(el);
  }
  // 第二遍：只读（量新位置），避免读写交错引起反复重排
  const plans = els.map((el) => {
    const key = el.getAttribute('data-flip-key');
    const mode = el.getAttribute('data-flip') || 'auto';
    return {
      el,
      key,
      mode,
      last: plainRect(el.getBoundingClientRect()),
      radius: radiusOf(el),
      first: snapshot.get(key) || null,
      // 文字块此刻看到的不透明度（含还在播的淡出淡入）：新的淡出淡入从这里接着走
      opacity: mode === 'text' ? Number(getComputedStyle(el).opacity) : 1,
    };
  });
  // 第三遍：写（开始动画）
  const jobs = [];
  plans.forEach((p, i) => {
    if (p.mode === 'none') return;
    const delay = stagger * i;
    const firstRect = p.first?.rect || enterFrom.get(p.key) || null;
    if (!firstRect) {
      // 新元素：原地进场
      if (o.enter === 'none') return;
      if (reduced || o.enter === 'fade') {
        jobs.push(animateTween(p.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'fast', easing: 'out', delay, channel: 'flip-fade' }).finished);
        return;
      }
      const restore = withOrigin(p.el, 'center');
      jobs.push(animateTween(p.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', easing: 'out', delay, channel: 'flip-fade' }).finished);
      jobs.push(animateSpring(p.el, {
        channel: CHANNEL,
        from: { s: 0.92 },
        to: { s: 1 },
        spring,
        delay,
        commit: 'clear',
        render: ({ s }) => ({ transform: `scale(${num(s, 4)})` }),
      }).finished.then((done) => {
        if (done) restore();
        return done;
      }));
      return;
    }
    const firstRadius = p.first ? p.first.radius : p.radius;
    const inv = invertFor(p.mode, firstRect, p.last, { firstRadius, lastRadius: p.radius });
    if (!inv) return;
    if (reduced) {
      // 减弱动态效果：不位移，新位置短暂淡入
      jobs.push(animateTween(p.el, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 'fast', easing: 'out', channel: 'flip-fade' }).finished);
      return;
    }
    // 文字块换了行宽：边走边“淡出—再淡入”，到快停下的时候才出现在新位置。
    // 起点是此刻看到的不透明度（上一次 FLIP 的淡出淡入还在播时不会先闪回 1）；播完回到 CSS 的值，不留内联样式
    if (p.mode === 'text' && (Math.abs(firstRect.width - p.last.width) > 1 || Math.abs(firstRect.height - p.last.height) > 1)) {
      const o0 = p.opacity;
      const fade = animateTween(p.el, [
        { opacity: o0 }, { opacity: 0, offset: 0.18 }, { opacity: 0, offset: 0.42 }, { opacity: 1 },
      ], { duration: 'slower', easing: 'linear', delay, channel: 'flip-fade' });
      jobs.push(fade.finished.then((done) => {
        if (done) clearStyle(p.el, ['opacity']);
        return done;
      }));
    }
    const restore = withOrigin(p.el, '0 0');
    const velocity = p.first ? { x: p.first.velocity.x, y: p.first.velocity.y } : {};
    const anim = animateSpring(p.el, {
      channel: CHANNEL,
      from: inv.from,
      to: inv.to,
      velocity,
      spring,
      delay,
      commit: 'clear',
      render: flipRenderer(inv.mode, needsRadiusCorrection(inv, firstRadius, p.radius)),
    });
    jobs.push(anim.finished.then((done) => {
      if (done) {
        restore();
        if (inv.mode !== 'position') clearStyle(p.el, ['borderRadius', 'clipPath']);
      }
      return done;
    }));
  });

  // 离场：快照里有、新 DOM 里没有的元素
  if (o.exit !== 'none') {
    const present = new Set(plans.map((p) => p.key));
    const container = o.container || (Array.isArray(root) ? null : root);
    if (container) {
      for (const [key, entry] of snapshot) {
        if (present.has(key) || entry.el.isConnected) continue;
        const ghost = makeGhost(entry, container);
        // commit: 'final'：淡出播完停在 0（缩小那条弹簧更长，不能让幽灵先“闪回”不透明）
        const fade = animateTween(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 'fast' : 'base', easing: 'out', commit: 'final' });
        const shrink = reduced ? null : animateSpring(ghost, {
          from: { s: 1 },
          to: { s: 0.9 },
          spring,
          commit: 'final',
          render: ({ s }) => ({ transform: `scale(${num(s, 4)})` }),
        });
        jobs.push(Promise.all([fade.finished, shrink?.finished]).then(() => ghost.remove()));
      }
    }
  }
  return Promise.all(jobs).then(() => undefined);
}

/**
 * 一步到位的写法（同步改 DOM 的场景）：flip(root, () => { 改 DOM }, 选项)。
 * Preact 的状态更新是异步渲染的，不要用这个，用 FlipGroup / useFlip。
 */
export function flip(root, mutate, o) {
  const snap = captureLayout(root, o);
  mutate();
  return playFlip(snap, root, o);
}

// =====================================================================
// 高度变化的 FLIP（“高度展开”）：元素的内容变了（展开全文、换一段内容、加载出更多）以后，
// 从旧高度平滑过渡到新高度——不动 height 属性：
//   变高：元素先用 clip-path 裁到旧高度，再“卷”开到新高度；
//   变矮：新内容（矮的）马上就位，上面盖一份**旧内容的影子**（改之前克隆的），影子从底边往上“卷”起来、同时淡出——
//         带底色的卡片底边和后面的内容走同一条弹簧，不会先跳上去、再看着内容慢慢滑过来（中间露出一截页面底色）；
//   后面的内容（同一父元素里的后续兄弟、父元素的后续兄弟……一直到 boundary）用独立的 translate
//   属性从旧位置滑到新位置（和元素底边同一条弹簧，严丝合缝）。
//   全部由同一个进度 p 驱动（animateSpringGroup）：展开到一半又收起，从当前位置、当前速度接着走。
//
//   const snap = captureHeight(cardEl);   // 改内容之前
//   …改内容…
//   playHeight(snap);                      // Preact 里用 motion/hooks.js 的 useHeightFlip(ref)
//
// 列表项原地展开详情请优先用 ui/ExpandableCard（grid-template-rows，天然可嵌套、可打断）；
// 这个工具给“内容整体换掉、没法用 0fr→1fr 包起来”的场景。
// =====================================================================

const HEIGHT = 'flip-height';

/** 会被 el 的高度变化推动的元素：el 的后续兄弟、父元素的后续兄弟……一直到 boundary（不含）为止 */
function followersOf(el, boundary) {
  const out = [];
  let node = el;
  const stop = boundary || (typeof document !== 'undefined' ? document.body : null);
  while (node && node !== stop && node.parentElement) {
    for (let s = node.nextElementSibling; s; s = s.nextElementSibling) {
      const pos = getComputedStyle(s).position;
      if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky' || s.hasAttribute('data-flip-ghost')) continue;
      out.push(s);
    }
    node = node.parentElement;
  }
  return out;
}

/** 正在播的高度动画此刻的进度信息（被打断时新动画从这里接着走） */
const heightState = new WeakMap();

/**
 * 记下元素现在“看得见的”高度（正在播高度动画时按动画此刻的样子），并克隆一份当前内容（变矮时当影子用）。
 * @param {Element} el
 * @param {{ boundary?: Element }} [o] 后面的内容推到哪一层为止（默认一直到 body）
 */
export function captureHeight(el, { boundary } = {}) {
  const st = heightState.get(el);
  let height = el.getBoundingClientRect().height;
  if (st?.anim) {
    // 动画途中：看得见的高度 = 新高度 − delta × (1 − p)
    // （变高时还裁着的那一截不算；变矮时影子还盖着的那一截要算上）
    const p = st.anim.values().p;
    height = st.to - st.delta * (1 - p);
  }
  return { el, boundary, height, rect: plainRect(el.getBoundingClientRect()), clone: el.cloneNode(true) };
}

/** 把改之前克隆的旧内容放回原位当影子（相对父元素绝对定位，盖在新内容上面） */
function placeShadowCopy(snapshot) {
  const { el } = snapshot;
  const container = el.parentElement;
  if (!container) return null;
  const ghost = snapshot.clone;
  ghost.removeAttribute('id');
  for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('data-flip-ghost', '');
  ghost.inert = true;
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  const cr = container.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${snapshot.rect.left - cr.left - (parseFloat(cs.borderLeftWidth) || 0) + container.scrollLeft}px`,
    top: `${snapshot.rect.top - cr.top - (parseFloat(cs.borderTopWidth) || 0) + container.scrollTop}px`,
    width: `${snapshot.rect.width}px`,
    height: `${snapshot.height}px`,
    margin: '0',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: '1',
    transform: 'none',
    translate: 'none',
  });
  el.after(ghost);
  return ghost;
}

/**
 * 播放高度过渡。
 * @param {ReturnType<typeof captureHeight>} snap
 * @param {{ spring?: any }} [o]
 * @returns {Promise<void>}
 */
export function playHeight(snap, { spring = 'smooth' } = {}) {
  const { el } = snap;
  const old = heightState.get(el);
  old?.anim?.stop({ commit: false });
  old?.ghost?.remove();
  heightState.delete(el);
  stopAnimation(el, HEIGHT, { commit: false });
  clearStyle(el, ['clipPath']);
  const followers = followersOf(el, snap.boundary);
  for (const f of followers) {
    stopAnimation(f, HEIGHT, { commit: false });
    clearStyle(f, ['translate']);
  }
  const to = el.getBoundingClientRect().height;
  const delta = to - snap.height;
  if (Math.abs(delta) < 0.5) return Promise.resolve();
  if (prefersReducedMotion.value) {
    // 减弱动态效果：不滑动，新内容短暂淡入
    return animateTween(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 'fast', channel: 'flip-fade' }).finished.then(() => undefined);
  }
  const radius = radiusOf(el);
  const entries = [];
  let ghost = null;
  if (delta > 0) {
    // 变高：元素裁到旧高度，再卷开
    entries.push([el, ({ p }) => ({ clipPath: `inset(0 0 ${num(Math.max(0, delta * (1 - p)))}px 0 round ${num(radius)}px)` })]);
  } else {
    // 变矮：旧内容的影子盖在上面，从底边往上卷起、同时淡出（新内容在下面已经就位）
    ghost = placeShadowCopy(snap);
    const D = -delta;
    if (ghost) {
      entries.push([ghost, ({ p }) => ({
        clipPath: `inset(0 0 ${num(Math.max(0, D * p))}px 0 round ${num(radius)}px)`,
        opacity: num(1 - stage(p, 0.2, 0.85)),
      })]);
    }
  }
  for (const f of followers) entries.push([f, ({ p }) => ({ translate: `0 ${num(-delta * (1 - p))}px` })]);
  // 被打断后重新开始的这一段从“此刻看得见的高度”出发（captureHeight 已经按动画进度量好），不会跳
  const anim = animateSpringGroup(entries, {
    channel: HEIGHT,
    from: { p: 0 },
    to: { p: 1 },
    spring,
    commit: 'clear',
  });
  heightState.set(el, { delta, to, ghost, anim });
  return anim.finished.then((done) => {
    if (heightState.get(el)?.ghost === ghost) {
      ghost?.remove();
      if (done) heightState.delete(el);
    }
  });
}
