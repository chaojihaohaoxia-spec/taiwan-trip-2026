// =====================================================================
// shell/TabBar.jsx：底栏（悬浮的液态玻璃胶囊：行程 / 地图 / ＋ / 账本 / 更多；样稿 .tabbar，手感照 iOS 26 Apple Music）。
//
// - 玻璃：更通透（--material-tabbar + --tabbar-glass-filter：模糊 + 提饱和度 + 提亮 / 压暗），上沿亮、下沿暗的折射边，
//   内侧极淡的光泽，柔和的悬浮阴影；字和图标后面有一层贴着字形的“活力”晕（--color-tabbar-halo：字是 text-shadow，
//   图标是叠在下面的同一个图形 .tabbar__halo，描得粗一点再虚化），后面再黑、再白、再花都清楚；
// - 选中块：一块更亮、更透的玻璃药丸。切 tab 时 stretchSpring（motion/liquid.js）弹簧滑过去，移动中沿运动方向拉长、
//   停下回弹一点点（两头按橡皮筋收住，不出底栏；从 ＋ 后面穿过时变淡）；二级页面（预订、清单……）停在「更多」上；
// - 按下（行程 / 地图 / 账本，或二级页面时的「更多」）：选中块像透镜一样浮起放大（竖向能超出底栏一点），按的是别的格就用
//   同一条弹簧滑到手指下（合成线程跑，不追手指——轻点不会甩出去），透镜下的图标、字放大一点；
//   按住左右拖，选中块跟着手指走（trackSlideSelect + followSpring），经过的格子高亮、换格轻触感（换格有迟滞，手指抖不会来回闪）；
//   松手停在高亮的那格并切过去；滑出底栏外松手 = 取消，回到原来那格。
// - 轻点在**松手那一刻**就切（tabEl.click() 走 go，再拦掉浏览器随后的原生 click）：iOS 上按住超过约 0.7 秒再松手不会发 click，
//   链接还会被系统的“拖拽链接”接管——所以 tab 关掉了拖拽（draggable=false、-webkit-user-drag: none、dragstart 取消），
//   切换也不依赖原生 click。原生 click 只留给键盘（回车 / 空格）和读屏；
// - 切过去以后新页面的代码还在下载：颜色先跟着选中块到新那格（data-pending），不会先回旧格再到新格；
// - ＋：实心主题色圆钮（ui/IconButton variant="filled"，56px），按下放大、松手回弹；不参与拖动选择；从它长出 ＋ 面板，加号转 ×；
// - 更多：三横线 ↔ ×（MorphIcon kind="menu"），标签「更多」↔「关闭」，打开全屏菜单（sheet id menu，从按钮圆形扩散）；
// - 往下滚：整条等比收小、标签淡出只留图标、＋ 跟着缩小；往上滚一点 / 回到顶部弹回（compact，FrameUI 的滚动处理算）。
//   ＋ 面板、更多菜单开着、键盘焦点在底栏里、减弱动态效果时一直是完整的；
// - ＋ 面板、更多菜单开着时底栏浮在它们上面（lifted：z-index 抬到弹层之上、不被设成 inert）；
//   别的弹层（底部面板、确认框）开着时底栏照常在遮罩下面、不可交互；
// - 切 tab：触感 selection；点当前这一格：回到页面顶部（「行程」在某一天时回到概览）；
// - 键盘：Tab 进来，← → 在五个按钮之间移动焦点，Home / End 到第一个 / 最后一个，回车 / 空格切换；
// - 安全区：离底 = --safe-bottom + --tabbar-inset；软键盘弹起时底栏沉下去藏起来；
// - 减弱动态效果：只淡入淡出和换颜色——选中块不滑、不拉伸，跳到新格子淡入；按下不放大（按在当前格：亮边亮起；
//   按在别的格：只给手指下那格换颜色）；不收小。
// 动画只动 transform / scale / opacity；拖动时按下那一刻量好各格位置，之后每帧只写 transform（不读布局）；
// 同屏 backdrop-filter 还是只有 .tabbar__glass 一层。参数在 tabbar-motion.js。
// =====================================================================

import './tabbar.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring, animateSpringGroup, animateTween, getAnimation } from '../motion/animate.js';
import { num, lerp, stage } from '../motion/physics.js';
import { stretchSpring, liquidStretch, followSpring, trackSlideSelect, rubberClamp } from '../motion/liquid.js';
import { suppressNextClick } from '../motion/press.js';
import { prefersReducedMotion } from '../lib/media.js';
import { navigate, router, isNavigating } from '../router/index.js';
import { haptic } from '../lib/native.js';
import { useOverlayTrigger } from '../overlay/binding.js';
import { IconButton } from '../ui/IconButton.jsx';
import { MorphIcon } from '../ui/MorphIcon.jsx';
import { ShellGlyph } from './glyphs.jsx';
import { tabIndex } from './chrome.js';
import { lastTripTab } from './trip-state.js';
import { useKeyboardOpen } from './keyboard.js';
import { TABBAR_MOTION as M, SLOTS, isSelectable, selectableRange, magnifyAt, plusFade, lensEdge, lensSpring } from './tabbar-motion.js';

const CH = 'tabbar-ind';
const CH_LIFT = 'tabbar-lift';
const CH_COMPACT = 'tabbar-compact';
/** 从 ＋ 面板 / 更多菜单上面沉下去之前，先在上层淡出多久（和 CSS 的 --dur-fast 一致） */
const SINK_MS = 160;
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** 选中块的样子：第几格（x，小数）+ 拉伸；两头按橡皮筋收在底栏里（lensEdge）；o 是从 ＋ 后面穿过时的透明度（不给按位置算） */
function lensStyle({ x, sx = 1, sy = 1, shift = 0, o }) {
  const c = lensEdge({ x, sx, shift });
  return {
    transform: `translateX(${num(c * 100, 3)}%) scale(${num(sx, 4)}, ${num(sy, 4)})`,
    opacity: num(o ?? plusFade(x), 3),
  };
}
/** 选中块弹簧的派生通道：从 ＋ 后面穿过时变淡（跟着进关键帧，折线简化按幅度 1 − min 归一） */
const LENS_EXTRA = (x) => ({ o: plusFade(x) });
const LENS_EXTRA_SCALE = { o: 1 - M.lens.plus.min };
const clampV = (v) => Math.max(-M.lens.handoffMax, Math.min(M.lens.handoffMax, Number(v) || 0));

/**
 * @param {{ tripId: string|null, active: string|null, shown: boolean, lifted: boolean, inert: boolean, routeName: string, compact?: boolean }} props
 */
export function TabBar({ tripId, active, shown, lifted, inert, routeName, compact = false }) {
  // ＋ 面板是一组按钮（不是方向键导航的菜单）：haspopup 写 dialog，读屏不会以为能用方向键
  const fab = useOverlayTrigger('fab', { haspopup: 'dialog' });
  const menu = useOverlayTrigger('menu', { haspopup: 'dialog' });
  const navRef = useRef(null);
  const rowRef = useRef(null);
  const indRef = useRef(null);
  const lensRef = useRef(null);
  const index = tabIndex(active);
  const reduced = prefersReducedMotion.value;
  const keyboard = useKeyboardOpen();
  const [ready, setReady] = useState(false);
  const [kbFocus, setKbFocus] = useState(false);
  /** 选中块（逻辑上）在第几格：动画的终点 / 拖动松手的落点 */
  const pos = useRef(index);
  /** 正在按着的这一次（透镜浮起、可能在拖） */
  const press = useRef(null);
  /** 事件处理里读最新的 props（不靠闭包） */
  const latest = useRef(null);

  // ＋ 面板 / 更多菜单直接换成别的弹层（＋ →「记一笔」）：底栏要从“浮在上面”沉到遮罩下面。直接沉下去第一帧会从清楚
  // 跳成虚化（新弹层的遮罩在模糊它）：先在上层淡出（SINK_MS），再沉下去，在遮罩下面淡回来
  const [sinking, setSinking] = useState(false);
  const wasLifted = useRef(lifted);
  useLayoutEffect(() => {
    const before = wasLifted.current;
    wasLifted.current = lifted;
    if (!before || lifted || !inert || prefersReducedMotion.peek()) {
      if (lifted) setSinking(false);
      return undefined;
    }
    setSinking(true);
    const t = setTimeout(() => setSinking(false), SINK_MS);
    return () => clearTimeout(t);
  }, [lifted]);
  const liftedNow = lifted || sinking;

  // 第一次真正渲染出来（路由到了）的样子不做过渡：打开网站时底栏直接就在那里（不从下面滑上来——
  // 那会让刚打开、从 ＋ 长出来的面板量到一个还在半路的按钮）；之后进出行程才滑上 / 滑下
  const routed = Boolean(routeName);
  useEffect(() => {
    if (!routed || ready) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [routed]);

  const targets = tripId
    ? {
      trip: routeName === 'day' || routeName === 'trip' ? { name: 'trip', params: { tripId } } : lastTripTab(tripId),
      map: { name: 'map', params: { tripId } },
      ledger: { name: 'ledger', params: { tripId } },
    }
    : null;
  latest.current = { index, active, targets };

  // ---------- 选中块 ----------

  /** 选中块去第 to 格。from / velocity 不给：从正在播的动画（同一通道）接着走，没有就从 pos */
  function moveLens(to, o = {}) {
    const ind = indRef.current;
    if (!ind || to < 0) return;
    const start = pos.current;
    pos.current = to;
    if (prefersReducedMotion.peek()) {
      // 减弱动态效果：不滑、不拉伸——直接放到新格子，淡入
      getAnimation(ind, CH)?.stop({ commit: false });
      Object.assign(ind.style, lensStyle({ x: to }));
      if (start !== to) animateTween(ind, [{ opacity: 0 }, { opacity: 1 }], { duration: 'fast', easing: 'out', channel: 'tabbar-fade' });
      return;
    }
    const from = o.from ?? lensX(start);
    const anim = stretchSpring(ind, {
      channel: CH,
      from: o.from,
      current: () => start,
      to,
      velocity: o.velocity,
      spring: lensSpring(to - from),
      stretch: M.lens.stretch,
      extra: LENS_EXTRA,
      extraScale: LENS_EXTRA_SCALE,
      render: lensStyle,
      commit: 'final',
    });
    anim.finished.then((done) => {
      // 松手停到某一格、却没换成那一页（导航没发生、点了同一格……）：回到当前页那一格。
      // 新页面的代码还在下载（isNavigating）时先等着：路由到了 index 自然就对上了，没到再由下面的 effect 收尾
      const now = latest.current.index;
      if (done && !press.current && !isNavigating.peek() && now >= 0 && now !== pos.current) moveLens(now);
    });
  }

  // 一次导航结束（到了、被新的导航顶掉、或者没走成）：选中块不在当前页那一格就回去
  const navigating = isNavigating.value;
  useEffect(() => {
    const ind = indRef.current;
    if (navigating || press.current || !ind || index < 0 || pos.current === index || getAnimation(ind, CH)?.running) return;
    moveLens(index);
  }, [navigating]);

  useLayoutEffect(() => {
    const ind = indRef.current;
    if (!ind) return;
    if (index < 0) {
      pos.current = -1;
      return;
    }
    if (pos.current < 0) {
      // 刚出现（进了行程）：直接放好，不从别处滑过来
      getAnimation(ind, CH)?.stop({ commit: false });
      Object.assign(ind.style, lensStyle({ x: index }));
      pos.current = index;
      return;
    }
    // 按着的时候不动它（松手时 onEnd 按当前页收尾）
    if (press.current || pos.current === index) return;
    moveLens(index);
  }, [index]);

  // ---------- 等待中的那一格（新页面的代码还在下载） ----------
  // 松手 / 点了以后到路由真正换过去之前：颜色先跟选中块到新那格（<nav data-pending>，那一格 data-pending-tab），
  // 不会先回到旧格、等页面到了再跳过去。index 变了（到了）或者这次导航结束（到了、被顶掉、没走成）就撤掉
  const pendingSeq = useRef(0);
  function clearPending() {
    pendingSeq.current += 1;
    const nav = navRef.current;
    if (!nav) return;
    nav.removeAttribute('data-pending');
    for (const el of nav.querySelectorAll('[data-pending-tab]')) el.removeAttribute('data-pending-tab');
  }
  function markPending(name, done) {
    const nav = navRef.current;
    if (!nav) return;
    const token = ++pendingSeq.current;
    nav.setAttribute('data-pending', '');
    for (const el of nav.querySelectorAll('.tabbar__tab')) el.toggleAttribute('data-pending-tab', el.dataset.tab === name);
    Promise.resolve(done).catch(() => {}).finally(() => {
      if (pendingSeq.current === token) clearPending();
    });
  }
  useLayoutEffect(() => clearPending(), [index]);

  /** 透镜浮起 / 落下（减弱动态效果时只换颜色，见 CSS 的 data-lens-up；什么时候亮由 syncReducedLens 决定） */
  function lift(on) {
    const nav = navRef.current;
    const lens = lensRef.current;
    if (!nav || !lens) return;
    nav.toggleAttribute('data-lens-up', on);
    if (prefersReducedMotion.peek()) return;
    const m = M.lift;
    animateSpring(lens, {
      channel: CH_LIFT,
      current: () => ({ s: on ? 0 : 1 }),
      to: { s: on ? 1 : 0 },
      spring: on ? m.press : m.release,
      commit: on ? 'final' : 'clear',
      render: ({ s }) => ({ scale: `${num(lerp(1, m.scaleX, s), 4)} ${num(lerp(1, m.scaleY, s), 4)}` }),
    });
  }
  const liftLevel = () => {
    const a = getAnimation(lensRef.current, CH_LIFT);
    if (a) return a.values().s;
    return navRef.current?.hasAttribute('data-lens-up') ? 1 : 0;
  };

  function setHover(session, i) {
    session.hover = i;
    for (const t of session.tabs) t.el.toggleAttribute('data-hover', t.slot === i);
  }

  /** 减弱动态效果：选中块不跟手指走，只有它就在手指下那格时才亮起亮边；别的时候只给手指下那格换颜色 */
  function syncReducedLens(session) {
    navRef.current?.toggleAttribute('data-lens-up', session.inside && session.hover >= 0 && session.hover === pos.current);
  }

  /** 选中块此刻在第几格（正在滑就读弹簧此刻的值，不读布局；没在滑就是 rest，默认 pos） */
  function lensX(rest = pos.current) {
    const a = getAnimation(indRef.current, CH);
    return a ? a.values().x : rest;
  }

  /** 拖动松手：切到那一页（和点一下一样的规则） */
  function activate(name) {
    const L = latest.current;
    if (!L.targets?.[name]) return;
    haptic('selection');
    markPending(name, navigate(L.targets[name], { scroll: 'restore' }));
  }

  function onPointerDown(e) {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const nav = navRef.current;
    const row = rowRef.current;
    const ind = indRef.current;
    const L = latest.current;
    if (!nav || !row || !ind || nav.inert || !nav.hasAttribute('data-shown') || L.index < 0 || press.current) return;
    const tabEl = e.target.closest?.('.tabbar__tab');
    if (!tabEl || !row.contains(tabEl)) return;
    const slot = SLOTS.indexOf(tabEl.dataset.tab);
    // 「更多」不是当前页时只是个按钮（打开菜单）：交给全站的按压反馈
    if (!isSelectable(slot, L.active)) return;
    // 底栏自己做按压反馈（选中块浮起、图标放大），全站 data-press 的缩小不管这一次
    e.__pressClaimed = true;
    const slotEls = [...row.querySelectorAll('[data-slot]')];
    const centers = slotEls.map((el) => {
      const r = el.getBoundingClientRect();
      return (r.left + r.right) / 2;
    });
    const tabs = [...row.querySelectorAll('.tabbar__tab')].map((el) => ({ el, slot: SLOTS.indexOf(el.dataset.tab), mag: el.firstElementChild, k: 1 }));
    const range = selectableRange(L.active);
    const reduced = prefersReducedMotion.peek();
    // f：拖起来以后跟手的弹簧状态（拖之前选中块由 stretchSpring 驱动，f 是 null）
    const session = { slot, origin: L.index, f: null, tabs, tabEl, hover: -1, dragging: false, inside: true, reduced };
    press.current = session;
    setHover(session, slot);
    nav.setAttribute('data-tracking', '');
    if (reduced) {
      syncReducedLens(session);
    } else {
      for (const t of tabs) t.mag.style.scale = '1';
      lift(true);
      // 按的是别的格：选中块用同一条弹簧滑到手指下（合成线程跑；不追手指，轻点不会甩出去）
      if (pos.current !== slot) moveLens(slot);
    }

    session.tracker = trackSlideSelect(e, {
      centers,
      selectable: (i) => isSelectable(i, L.active),
      bounds: nav.getBoundingClientRect(),
      slop: M.drag.slop,
      threshold: M.drag.threshold,
      bias: M.drag.bias,
      project: M.drag.project,
      onDragStart() {
        if (press.current !== session) return;
        session.dragging = true;
        nav.setAttribute('data-dragging', '');
        if (session.reduced) return;
        // 从弹簧此刻的位置、速度接过来，改成跟手（之后每帧写 transform）
        const running = getAnimation(ind, CH);
        const snap = running ? running.stop({ commit: true }) : null;
        session.f = snap ? { x: snap.values.x, v: snap.velocities.x || 0 } : { x: pos.current, v: 0 };
      },
      onHover(i) {
        if (press.current !== session) return;
        setHover(session, i);
        if (i >= 0 && session.dragging) {
          haptic('selection');
          if (session.reduced) moveLens(i);
        }
        if (session.reduced) syncReducedLens(session);
      },
      onFrame({ u, inside, dt }) {
        if (press.current !== session) return;
        if (inside !== session.inside) {
          // 滑出底栏：透镜落下、回到原来那格（这时松手就是取消）；滑回来再浮起
          session.inside = inside;
          nav.toggleAttribute('data-tracking', inside);
          if (session.reduced) {
            if (!inside && session.dragging && pos.current !== session.origin) moveLens(session.origin);
            syncReducedLens(session);
          } else {
            lift(inside);
            if (!session.f) {
              const to = inside ? session.slot : session.origin;
              if (pos.current !== to) moveLens(to);
            }
          }
        }
        if (session.reduced) return;
        let x;
        const f = session.f;
        if (f) {
          const target = inside ? rubberClamp(u, range.min, range.max, M.drag.reach) : session.origin;
          followSpring(f, target, dt, M.follow);
          Object.assign(ind.style, lensStyle({ x: f.x, ...liquidStretch(f.v, M.lens.stretch) }));
          x = f.x;
        } else {
          x = lensX();
        }
        // 透镜下的图标、字放大（只写 scale，不读布局；按住期间一直写着数值、不在“有 / 没有 scale”之间来回切——
        // 那样每切一次浏览器都要重新布局一次）
        const level = liftLevel();
        for (const t of tabs) {
          const k = magnifyAt(x, t.slot, level);
          if (Math.abs(k - t.k) < 0.001) continue;
          t.k = k;
          t.mag.style.scale = num(k, 4);
        }
      },
      onEnd({ nearest, inside, dragging, cancelled }) {
        if (press.current !== session) return;
        press.current = null;
        nav.removeAttribute('data-dragging');
        nav.removeAttribute('data-tracking');
        setHover(session, -1);
        if (session.reduced) nav.removeAttribute('data-lens-up');
        else {
          for (const t of tabs) t.mag.style.scale = '';
          lift(false);
        }
        const now = latest.current;
        let to = now.index;
        let tap = false;
        if (dragging) {
          // 拖过了：松手那一下不再当成点击
          suppressNextClick(row);
          if (inside && !cancelled && nearest >= 0) {
            to = nearest;
            if (nearest !== now.index) activate(SLOTS[nearest]);
          }
        } else if (inside && !cancelled) {
          // 轻点：选中块已经在去这一格的路上（按下时就出发了），松手直接切（见文件头：不等原生 click）
          to = session.slot;
          tap = true;
        } else {
          // 按下以后滑出去松手：不算点击
          suppressNextClick(session.tabEl);
        }
        if (session.f) {
          // 从跟手交回弹簧：速度限制在 ±handoffMax 格/秒，甩得再快也不冲出去
          moveLens(to, { from: session.f.x, velocity: clampV(session.f.v) });
        } else if (pos.current !== to) {
          moveLens(to);
        }
        if (tap) {
          // 和点一下完全一样（go：切页 / 点当前格回到顶部；「更多」打开菜单），再拦掉浏览器随后可能还发的那次原生 click
          session.tabEl.click();
          suppressNextClick(session.tabEl);
        }
      },
    });
  }

  useEffect(() => () => press.current?.tracker?.cancel(), []);

  // 按住拖动时长按不弹系统菜单（安卓长按链接的菜单；iOS 的预览由 -webkit-touch-callout: none 关掉）
  const onContextMenu = (e) => {
    if (press.current) e.preventDefault();
  };
  // 链接不能被拖走（iOS 长按链接会启动系统的“拖拽链接”，接管手指、松手也不切页）
  const onDragStart = (e) => e.preventDefault();

  // ---------- 滚动收小 ----------
  const compactNow = Boolean(compact && shown && !liftedNow && !reduced && !kbFocus);
  const compactShown = useRef(false);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || compactShown.current === compactNow) return;
    compactShown.current = compactNow;
    const icons = [...nav.querySelectorAll('.tabbar__icon')];
    const labels = [...nav.querySelectorAll('.tabbar__label')];
    // 图标挪到格子正中：标签走了以后，图标中心到格子中心的距离（offset* 不受 transform 影响）
    const mag = nav.querySelector('.tabbar__mag');
    const icon = icons[0];
    const dy = mag && icon ? mag.offsetHeight / 2 - (icon.offsetTop + icon.offsetHeight / 2) : 0;
    const c = M.compact;
    // ＋ 面板 / 更多菜单从收小的底栏上打开：展开得快一点（面板从按钮展开后的位置长出来，见 overlay/dom.js 的 layoutRect）
    const spring = !compactNow && liftedNow ? c.open : c.spring;
    animateSpringGroup([
      [nav, ({ p }) => ({ scale: num(lerp(1, c.scale, p), 4) })],
      ...icons.map((el) => [el, ({ p }) => ({ transform: `translateY(${num(dy * p, 2)}px) scale(${num(lerp(1, c.icon, p), 4)})` })]),
      ...labels.map((el) => [el, ({ p }) => ({ opacity: num(1 - stage(p, 0, c.labelOut), 3), transform: `translateY(${num(4 * p, 2)}px) scale(${num(lerp(1, 0.86, p), 4)})` })]),
    ], {
      channel: CH_COMPACT,
      current: () => ({ p: compactNow ? 0 : 1 }),
      to: { p: compactNow ? 1 : 0 },
      spring,
      commit: compactNow ? 'final' : 'clear',
    });
  }, [compactNow]);

  // 键盘焦点在底栏里：展开（标签看得见）
  const onFocusIn = (e) => {
    if (e.target?.matches?.(':focus-visible')) setKbFocus(true);
  };
  const onFocusOut = (e) => {
    if (!navRef.current?.contains(e.relatedTarget)) setKbFocus(false);
  };

  // ← → / Home / End：在五个按钮之间移动焦点（和天数分段条一样，不绕回）
  function onKeyDown(e) {
    if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...rowRef.current.querySelectorAll('.tabbar__tab, .tabbar__fab')];
    const at = items.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : at + (e.key === 'ArrowRight' ? 1 : -1);
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  }

  function go(e, tab) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!targets) return;
    haptic('selection');
    const to = targets[tab];
    const here = router.route.peek();
    if (active === tab && here && router.href(to) === router.href({ name: here.name, params: here.params })) {
      // 点当前这一格：回到顶部
      window.scrollTo({ top: 0, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
      return;
    }
    const done = navigate(to, { scroll: 'restore' });
    if (tab !== active) markPending(tab, done);
  }

  const tab = (name, label, glyph) => (
    <a
      href={targets ? router.href(targets[name]) : '#/trips'}
      class="tabbar__tab"
      data-tab={name}
      data-slot={SLOTS.indexOf(name)}
      data-press="scale"
      data-press-float=""
      draggable={false}
      aria-current={active === name ? 'page' : undefined}
      onClick={(e) => go(e, name)}
      data-testid={`tab-${name}`}
    >
      <span class="tabbar__mag">
        <span class="tabbar__icon">
          <span class="tabbar__halo" aria-hidden="true"><ShellGlyph name={glyph} size={23} /></span>
          <ShellGlyph name={glyph} size={23} />
        </span>
        <span class="tabbar__label">{label}</span>
      </span>
    </a>
  );

  const fabClick = (e) => {
    haptic('selection');
    if (menu.isOpen) {
      e.preventDefault();
      menu.hide().then(() => fab.show());
      return;
    }
    fab.props.onClick(e);
  };
  const menuClick = (e) => {
    haptic('selection');
    if (fab.isOpen) {
      // ＋ 面板开着时点「更多」：先收回面板，再扩散菜单（两种弹层不叠在一起）
      fab.hide().then(() => menu.show());
      return;
    }
    menu.props.onClick(e);
  };

  return (
    <nav
      ref={navRef}
      class="tabbar"
      aria-label="主导航"
      data-shown={shown && !keyboard ? '' : undefined}
      data-lifted={liftedNow ? '' : undefined}
      data-sinking={sinking ? '' : undefined}
      data-ready={ready ? '' : undefined}
      data-compact={compactNow ? '' : undefined}
      data-overlay-exempt=""
      data-accent-follow=""
      data-anchor-unscale=""
      inert={shown && (inert || sinking) ? true : undefined}
      onFocusIn={onFocusIn}
      onFocusOut={onFocusOut}
      data-testid="shell-tabbar"
    >
      <span class="tabbar__shadow" aria-hidden="true" />
      <span class="tabbar__glass" aria-hidden="true" />
      <div ref={rowRef} class="tabbar__row" onPointerDown={onPointerDown} onKeyDown={onKeyDown} onContextMenu={onContextMenu} onDragStart={onDragStart}>
        <span ref={indRef} class="tabbar__ind" style={{ '--tab-index': Math.max(index, 0) }} data-hidden={index < 0 ? '' : undefined} aria-hidden="true">
          <span ref={lensRef} class="tabbar__lens" />
        </span>
        {tab('trip', '行程', 'route')}
        {tab('map', '地图', 'map')}
        <div class="tabbar__fab-slot" data-slot={SLOTS.indexOf('fab')}>
          <IconButton
            {...fab.props}
            onClick={fabClick}
            variant="filled"
            size="lg"
            class="tabbar__fab"
            data-press-float=""
            label={fab.isOpen ? '收起快速添加' : '快速添加'}
            data-testid="shell-fab"
          >
            <MorphIcon kind="plus" state={fab.isOpen} size={26} />
          </IconButton>
        </div>
        {tab('ledger', '账本', 'ledger')}
        <button
          type="button"
          class="tabbar__tab tabbar__more"
          data-tab="more"
          data-slot={SLOTS.indexOf('more')}
          data-press="scale"
          data-press-float=""
          aria-current={active === 'more' ? 'page' : undefined}
          aria-label={menu.isOpen ? '关闭菜单' : '更多'}
          data-testid="tab-more"
          {...menu.props}
          onClick={menuClick}
        >
          <span class="tabbar__mag">
            <span class="tabbar__icon">
              <span class="tabbar__halo" aria-hidden="true"><MorphIcon kind="menu" state={menu.isOpen} size={23} /></span>
              <MorphIcon kind="menu" state={menu.isOpen} size={23} />
            </span>
            {/* 「更多」↔「关闭」两个字叠在一起交叉淡化，跟着图标变形的中点换（不在图标还是 ≡ 时就写「关闭」） */}
            <span class="tabbar__label tabbar__swap" aria-hidden="true">
              <i data-on={menu.isOpen ? undefined : ''}>更多</i>
              <i data-on={menu.isOpen ? '' : undefined}>关闭</i>
            </span>
          </span>
        </button>
      </div>
    </nav>
  );
}
