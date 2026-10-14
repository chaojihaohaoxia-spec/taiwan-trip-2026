// =====================================================================
// overlay/Sheet.jsx：底部面板（记一笔、编辑条目、地点详情……）。
//
//   <Sheet sheetId="expense" title="记一笔" confirmClose={dirty}
//          footer={<SubmitButton …/>}>
//     {({ arg, close }) => <ExpenseForm onDone={() => closeOverlay('expense', { force: true })} />}
//   </Sheet>
//   <button onClick={() => openOverlay('expense', { keyboard: true })}>记一笔</button>
//
// 行为：
//   - 开关以网址为准（?sheet=expense）。手机返回手势、浏览器返回、Esc、点遮罩、右上角 ×、往下拖走都能关；
//   - 从屏幕底部滑上来（--spring-smooth），关闭时原路滑下去，等动画播完才卸载；动画可被打断；
//   - 档位 detents：'content'（内容多高就多高）、'medium'（半屏）、'large'（几乎全屏），可以组合，
//     例如 ['medium', 'large']：拖动把手在两档之间切换，在内容区往上滑先把面板拉到大档再滚动内容；
//   - 拖动：跟手；超出上下边界有橡皮筋阻尼；松手按速度和位置选落点（geometry.js 的 releaseTarget：
//     甩一下就关 / 换档，慢慢拖过 45% 才关），并把手指速度接进弹簧；
//   - 内容区在顶部时往下拉 = 拖面板；不在顶部时正常滚动内容（同一次手势只判定一次，不抢滚动）；
//   - 没到最高档时在内容区往上滑：先把面板拉高，到了最高档同一个手势接着滚内容（多出来的位移交给内容），
//     松手时带着手指的速度继续惯性滚动（iOS 的接力滚动）；手指往回滑先把内容滚回去，再拖面板；
//   - 键盘弹起时整个面板上移（visualViewport），最大高度跟着变小，有档位时自动到大档，底部按钮不被挡住；
//   - confirmClose：填了一半的表单被关时先问“放弃未保存的内容？”（返回手势也会拦下来问）；
//   - 宽屏（≥768px）变成底部居中的浮动卡片；减弱动态效果时只淡入淡出。
//   - 'content' 档的高度 = 标题区 + 内容实际占的高度 + 底部操作区（内容区本身被撑满整个面板，所以量的是里面
//     最后一个元素的底边，不是 scrollHeight）；有底部操作区（footer）又有更高的档时，footer 一直停在面板
//     露出来的那一截的底边（和面板同一条弹簧反向位移），在 'content' 档也看得见、点得到。
//
// 动画全部用 motion/ 的原语（和全站同一套物理）：
//   面板位移 = animateSpring 的 'sheet' 通道（--spring-smooth），打断时从当前位置、当前速度接着走；
//   拖动松手把手指速度（px/秒）原样接进弹簧；橡皮筋、手指速度、惯性投射用 motion/physics.js；
//   把手拖动用 motion/gesture.js 的 trackDrag（拖过之后那次点击作废）。
// =====================================================================

import './overlay.css';
import './Sheet.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { animateSpringGroup, getAnimation, stopAnimation } from '../motion/animate.js';
import { trackDrag } from '../motion/gesture.js';
import { suppressNextClick } from '../motion/press.js';
import { VelocityTracker, rubberBand, clamp, num } from '../motion/physics.js';
import { momentumScroll } from '../motion/gesture.js';
import { prefersReducedMotion, wideViewport } from '../lib/media.js';
import { Portal } from './Portal.jsx';
import { OverlayContext, useLayer, useOpenedGate, useOverlayRoute } from './binding.js';
import { releaseTarget, footerOffset } from './geometry.js';
import { CH, fadeTo, prepareHidden, scrimTo } from './transitions.js';

/** 入场开始后多久之内点遮罩不关（毫秒） */
export const SCRIM_GUARD_MS = 450;
import { keyboardState, watchKeyboard } from './keyboard.js';
import { uid, translateYOf } from './dom.js';
import { CloseButton } from './parts.jsx';

const DETENTS = ['content', 'medium', 'large'];
/** 半屏档最矮多高（px） */
const MEDIUM_MIN = 280;
/** 半屏档占可见高度的比例 */
const MEDIUM_RATIO = 0.5;
/** 判定开始拖动的最小位移（px） */
const DRAG_SLOP = 4;
/** 面板位移的动画通道 */
const CH_Y = 'sheet';
const renderY = ({ y }) => ({ transform: `translateY(${num(y)}px)` });

// ---------------------------------------------------------------------
// 提示条（Toast）让开面板底部的按钮：开着的底部面板有 footer（保存、删除）时，把 footer 顶边离屏幕底多高
// 写到 <html> 的 --ov-toast-sheet，Toast.css 取 max(平时的位置, 这个高度 + 间距)——「已保存」不会盖住「删除这条」。
// 几层面板叠着时取最高的那个；面板开始退场就撤掉。
// ---------------------------------------------------------------------
const sheetFooterLifts = new Map();
function syncToastLift() {
  const root = document.documentElement;
  const v = Math.max(0, ...sheetFooterLifts.values());
  if (v > 0) root.style.setProperty('--ov-toast-sheet', `${Math.ceil(v)}px`);
  else root.style.removeProperty('--ov-toast-sheet');
}

/**
 * 内容区里的内容实际有多高（内容区被 flex 撑满时 scrollHeight 等于它自己的高度，量不出来）：
 * 最后一个子元素的底边（含下外边距）+ 内容区的下内边距。内容区要是定位元素（Sheet.css 写了 position: relative）。
 */
export function contentHeightOf(body) {
  let bottom = 0;
  for (const el of body.children) {
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
    bottom = Math.max(bottom, el.offsetTop + el.offsetHeight + (parseFloat(cs.marginBottom) || 0));
  }
  if (!body.children.length && body.textContent.trim()) {
    const range = document.createRange();
    range.selectNodeContents(body);
    bottom = range.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
  }
  return Math.ceil(bottom + (parseFloat(getComputedStyle(body).paddingBottom) || 0));
}

function normalizeDetents(list) {
  const valid = (Array.isArray(list) ? list : [list]).filter((d) => DETENTS.includes(d));
  return valid.length ? [...new Set(valid)] : ['content'];
}

/**
 * 底部面板。
 * @param {Object} props
 * @param {string} props.sheetId                  弹层 id（网址里 ?sheet= 的值）
 * @param {string|null} [props.arg]               只在参数等于它时打开（不给 = 任何参数，内容按 arg 渲染）
 * @param {any} [props.title]                     标题
 * @param {any} [props.description]               标题下一行说明
 * @param {any} props.children                    内容；或函数 ({ arg, close, detent }) => 内容
 * @param {any} [props.footer]                    固定在底部的操作区（不随内容滚动）；或函数
 * @param {Array<'content'|'medium'|'large'>|string} [props.detents=['content']] 档位
 * @param {'content'|'medium'|'large'} [props.initialDetent] 打开时停在哪一档（默认第一个；宽屏上有大档时默认大档）
 * @param {boolean} [props.dismissible=true]      false = 不能往下拖走、点遮罩不关（只能用按钮关）
 * @param {boolean} [props.closeOnScrim=true]
 * @param {boolean} [props.closeOnEsc]           默认跟 dismissible 一样
 * @param {any} [props.confirmClose]              关闭前确认：true / { title, message, confirmText, cancelText } / (reason) => boolean|Promise
 * @param {boolean} [props.hideClose=false]       不显示右上角的关闭按钮
 * @param {any} [props.leading]                   标题左边（例如“取消”）
 * @param {any} [props.trailing]                  标题右边（例如“完成”），给了就不显示关闭按钮
 * @param {'solid'|'glass'} [props.material='solid']
 * @param {string} [props.label]                  没有标题时给读屏软件的名字
 * @param {string} [props.class]
 * @param {string} [props.testId]
 * @param {(detent: string) => void} [props.onDetentChange]
 * @param {() => void} [props.onClosed]           退场动画播完
 * @param {() => void} [props.onOpened]           出场动画播完（重活等这时再做：内容里也可以 await useOverlay().whenOpened()）
 */
export function Sheet(props) {
  const ov = useOverlayRoute(props.sheetId, { kind: 'sheet', arg: props.arg, confirmClose: props.confirmClose || null });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <SheetLayer {...props} ov={ov} />
    </Portal>
  );
}

function SheetLayer(props) {
  const {
    ov, title, description, children, footer, initialDetent, dismissible = true, closeOnScrim = true, closeOnEsc = dismissible,
    hideClose = false, leading, trailing, material = 'solid', label, class: cls = '', testId, onDetentChange, onClosed, onOpened,
  } = props;
  const gate = useOpenedGate(onOpened);
  const detents = useMemo(() => normalizeDetents(props.detents), [String(props.detents)]);
  const sized = detents.some((d) => d !== 'content') ? 'full' : 'content';

  const layerRef = useRef(null);
  const scrimRef = useRef(null);
  /** 这一次入场是什么时候开始的：入场的头 SCRIM_GUARD_MS 里点遮罩不关（误双击的第二下落在遮罩上，交互评审 P1-2） */
  const enterStartedAt = useRef(0);
  const panelRef = useRef(null);
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const footerRef = useRef(null);
  const titleRef = useRef(null);
  const ids = useMemo(() => ({ title: uid('ov-sheet-title'), desc: uid('ov-sheet-desc') }), []);

  // 默认停在第一档；宽屏（平板、桌面）上面板是浮动卡片，有大档就直接到大档（半屏会被屏幕底边切掉）
  const [detent, setDetentState] = useState(() => {
    if (detents.includes(initialDetent)) return initialDetent;
    if (wideViewport.peek() && detents.includes('large')) return 'large';
    return detents[0];
  });
  const detentRef = useRef(detent);
  const setDetent = (d) => {
    if (detentRef.current === d) return;
    detentRef.current = d;
    setDetentState(d);
    onDetentChange?.(d);
  };

  /** 几何：{ boxH, snaps: { 档位: 位移 }, closed: 完全移出屏幕的位移 } */
  const geo = useRef(null);
  const motion = useRef({ token: 0, exiting: false, shown: false });
  const drag = useRef(null);

  // 键盘
  useEffect(() => watchKeyboard(), []);
  const kb = keyboardState.value;

  const measure = () => {
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (!panel || !body) return geo.current;
    const boxH = panel.offsetHeight;
    const visible = kb.height || window.innerHeight;
    const natural = Math.min(boxH, panel.offsetHeight - body.clientHeight + contentHeightOf(body));
    const snaps = {};
    for (const d of detents) {
      if (d === 'large') snaps.large = 0;
      else if (d === 'medium') snaps.medium = Math.max(0, boxH - Math.round(Math.max(MEDIUM_MIN, visible * MEDIUM_RATIO)));
      else snaps.content = sized === 'content' ? 0 : Math.max(0, boxH - natural);
    }
    const frameBottom = parseFloat(getComputedStyle(panel.parentElement).bottom) || 0;
    // footer 最多反向移多少：最低一档的位移（只有一档、面板就是内容高度时是 0，footer 不用动）
    const pin = footerRef.current ? Math.max(0, ...Object.values(snaps)) : 0;
    geo.current = { boxH, snaps, closed: boxH + frameBottom + 64, pin };
    return geo.current;
  };

  const renderFooter = ({ y }) => ({ transform: `translateY(${num(footerOffset(y, geo.current?.pin))}px)` });

  /** 面板（和 footer）直接放到某个位移（不动画） */
  const placeY = (y) => {
    panelRef.current.style.transform = `translateY(${num(y)}px)`;
    if (footerRef.current) footerRef.current.style.transform = `translateY(${num(footerOffset(y, geo.current?.pin))}px)`;
  };

  /** 停掉面板（和 footer）的位移动画；返回面板的 { values, velocities } */
  const stopY = (opts) => {
    if (footerRef.current) stopAnimation(footerRef.current, CH_Y, opts);
    return stopAnimation(panelRef.current, CH_Y, opts);
  };

  const snapOf = (d) => geo.current?.snaps[d] ?? 0;
  const ordered = () => detents.map((d) => ({ d, y: snapOf(d) })).sort((a, b) => a.y - b.y);

  // ------------------------------------------------------------------
  // 出场 / 退场
  // ------------------------------------------------------------------

  /** 面板此刻的位移（动画中读动画的当前值，静止时读样式） */
  const currentY = () => getAnimation(panelRef.current, CH_Y)?.values().y ?? translateYOf(panelRef.current);

  /** 面板滑到某个位移（可带手指速度 px/秒）；footer 用同一条弹簧反向走；返回动画 */
  const slideTo = (y, { velocity, from } = {}) => animateSpringGroup([[panelRef.current, renderY], [footerRef.current, renderFooter]], {
    channel: CH_Y,
    from: from === undefined ? undefined : { y: from },
    current: () => ({ y: currentY() }),
    to: { y },
    velocity: velocity === undefined ? undefined : { y: velocity },
    spring: 'smooth',
    commit: 'final',
  });

  // 挂上的第一帧：遮罩透明、面板在屏幕外（出场动画从这里开始；减弱动态效果时面板在原位、透明）
  useLayoutEffect(() => {
    prepareHidden(scrimRef.current);
    if (prefersReducedMotion.peek()) prepareHidden(panelRef.current);
  }, []);

  const enter = () => {
    const g = measure();
    if (!g) return;
    enterStartedAt.current = performance.now();
    motion.current.token += 1;
    motion.current.exiting = false;
    const panel = panelRef.current;
    const y = snapOf(detentRef.current);
    gate.reset();
    if (prefersReducedMotion.peek()) {
      stopY({ commit: false });
      placeY(y);
      fadeTo(panel, 1, 'reduced').finished.then((done) => done && gate.open());
      fadeTo(scrimRef.current, 1, 'reduced');
      return;
    }
    // 第一次打开从屏幕外滑上来；退场半路被重新打开：从当前位置、当前速度折返
    if (!getAnimation(panel, CH_Y) && !motion.current.shown) placeY(g.closed);
    motion.current.shown = true;
    panel.style.opacity = '';
    slideTo(y).finished.then((done) => done && gate.open());
    scrimTo(scrimRef.current, 1);
  };

  /** 退场；velocity 是拖走时手指的速度（px/秒，向下为正） */
  const exit = (velocity) => {
    const panel = panelRef.current;
    const g = geo.current || measure();
    motion.current.token += 1;
    motion.current.exiting = true;
    const token = motion.current.token;
    const jobs = prefersReducedMotion.peek()
      ? [fadeTo(panel, 0, 'reduced'), fadeTo(scrimRef.current, 0, 'reduced')]
      : [slideTo(g.closed, { velocity }), scrimTo(scrimRef.current, 0)];
    Promise.all(jobs.map((a) => a.finished)).then((done) => {
      if (token !== motion.current.token || !done.every(Boolean)) return;
      ov.onExited();
      onClosed?.();
    });
  };

  useLayoutEffect(() => {
    if (ov.open) enter();
    else if (!motion.current.exiting) exit();
  }, [ov.open]);

  /** 停到某一档；animate: false = 直接到位（尺寸变了时） */
  const settleTo = (d, { animate = true } = {}) => {
    measure();
    const y = snapOf(d);
    // 出场动画半路被换了目标（内容长高、键盘、转屏）：原来那条动画的 finished 是 false，「出场播完」改由这里接着报
    // （不然 whenOpened 永远不兑现：弹层里等出场播完才做的事——拍照打卡开始传照片、签名链接、地图——都不会发生）
    const opened = () => {
      if (ov.open && !motion.current.exiting) gate.open();
    };
    if (animate && !prefersReducedMotion.peek()) slideTo(y).finished.then((done) => done && opened());
    else {
      stopY({ commit: false });
      placeY(y);
      if (motion.current.shown) opened();
    }
  };

  // 键盘弹起：有大档就到大档；尺寸变了重新对齐（挂载时不算变化）
  const prevKb = useRef(kb);
  useLayoutEffect(() => {
    const before = prevKb.current;
    prevKb.current = kb;
    if (before.inset === kb.inset && before.height === kb.height) return;
    if (!ov.open || motion.current.exiting || !geo.current) return;
    if (kb.inset > 0 && detents.includes('large')) setDetent('large');
    settleTo(kb.inset > 0 && detents.includes('large') ? 'large' : detentRef.current);
    // 焦点所在的输入框滚进可见区域
    const active = document.activeElement;
    if (kb.inset > 0 && active && bodyRef.current?.contains(active)) {
      requestAnimationFrame(() => active.scrollIntoView?.({ block: 'nearest' }));
    }
  }, [kb.inset, kb.height]);

  // 窗口尺寸变化（旋转屏幕、桌面拖窗口）：重新量，停在原来那一档
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (ov.open && !motion.current.exiting && !drag.current?.active) settleTo(detentRef.current, { animate: false });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [ov.open]);

  // 提示条让开 footer（见 syncToastLift）
  useEffect(() => {
    const footerEl = footerRef.current;
    if (!ov.open || !footerEl) return undefined;
    const key = ids.title;
    const update = () => {
      const frameBottom = parseFloat(getComputedStyle(panelRef.current?.parentElement || footerEl).bottom) || 0;
      sheetFooterLifts.set(key, footerEl.offsetHeight + frameBottom);
      syncToastLift();
    };
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(footerEl);
    return () => {
      ro?.disconnect();
      sheetFooterLifts.delete(key);
      syncToastLift();
    };
  }, [ov.open, Boolean(footer)]);

  // 内容高度变了（骨架换成表单、多了一行提示、照片加了一排）：停在「内容多高就多高」那一档时跟着长高 / 变矮。
  // 以前弹层要自己 dispatch 一个 resize 事件来提醒（记一笔、写日记），现在面板自己盯着内容区的子元素。
  useEffect(() => {
    const body = bodyRef.current;
    if (!ov.open || !body || sized !== 'full' || !detents.includes('content') || typeof ResizeObserver !== 'function') return undefined;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!ov.open || motion.current.exiting || drag.current?.active || !geo.current) return;
        if (detentRef.current !== 'content' || kb.inset > 0) return;
        const before = geo.current.snaps.content;
        const after = measure()?.snaps.content;
        if (after === undefined || Math.abs(after - before) < 2) return;
        settleTo('content');
      });
    };
    const ro = new ResizeObserver(check);
    const watchChildren = () => {
      ro.disconnect();
      for (const el of body.children) ro.observe(el);
    };
    watchChildren();
    const mo = new MutationObserver(() => {
      watchChildren();
      check();
    });
    mo.observe(body, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ov.open, sized, String(detents), kb.inset]);

  // ------------------------------------------------------------------
  // 拖动
  // ------------------------------------------------------------------

  const canDismiss = dismissible !== false;

  const applyDrag = (pos) => {
    const g = geo.current;
    placeY(pos);
    // 拉到最低一档以下时遮罩跟着变淡
    const lowest = ordered().pop()?.y ?? 0;
    const fade = pos > lowest ? clamp((pos - lowest) / Math.max(1, g.closed - lowest), 0, 1) : 0;
    scrimRef.current.style.opacity = String(1 - fade);
  };

  /**
   * 开始拖面板。handoff：内容区里往上滑把面板拉高时传滚动容器——到了最高档，多出来的位移交给它滚动（接力滚动）
   */
  const beginDrag = (y, handoff = null) => {
    const g = measure();
    // 正在播的动画停在当前帧，从这里接着跟手（不跳）
    const snap = stopY({ commit: true });
    stopAnimation(scrimRef.current, CH.scrim, { commit: true });
    const start = snap ? snap.values.y : translateYOf(panelRef.current);
    const tracker = new VelocityTracker();
    tracker.add(start, performance.now());
    drag.current = {
      active: true, startY: y, startOffset: start, pos: start, tracker, moved: 0, g,
      scroller: handoff, scrollStart: handoff ? handoff.scrollTop : 0, scrolled: false,
    };
  };

  const moveDrag = (y) => {
    const d = drag.current;
    if (!d?.active) return;
    const list = ordered();
    const min = list[0]?.y ?? 0;
    const max = canDismiss ? d.g.closed : (list[list.length - 1]?.y ?? 0);
    const raw = d.startOffset + (y - d.startY);
    if (d.scroller && raw < min) {
      // 已经到最高档：面板停住，多出来的位移交给内容滚动；手指往回滑先把内容滚回去
      d.pos = min;
      d.scroller.scrollTop = d.scrollStart + (min - raw);
      d.scrolled = true;
    } else {
      if (d.scroller && d.scrolled) d.scroller.scrollTop = d.scrollStart;
      // 超出最高档 / 最低档时有橡皮筋阻尼（越拉越沉）
      d.pos = rubberBand(raw, min, max, d.g.boxH);
    }
    d.moved = Math.max(d.moved, Math.abs(y - d.startY));
    // 手指的速度（不是面板的）：接力滚动时面板停住了，惯性要按手指算
    d.tracker.add(raw, performance.now());
    applyDrag(d.pos);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d?.active) return;
    d.active = false;
    const velocity = d.tracker.velocity(performance.now());
    const list = ordered();
    const hasGuard = Boolean(props.confirmClose);
    if (d.scroller && d.scrolled && d.scroller.scrollTop > d.scrollStart + 0.5) {
      // 接力滚动中松手：面板留在最高档，内容带着手指的速度继续惯性滚动
      const top = list[0];
      setDetent(top.d);
      slideTo(top.y, { from: d.pos });
      scrimTo(scrimRef.current, 1);
      if (d.moved > 6) suppressNextClick(panelRef.current);
      if (!prefersReducedMotion.peek()) momentumScroll(d.scroller, -velocity);
      return;
    }
    const { target, close } = releaseTarget({
      offset: d.pos, velocity, snaps: list.map((s) => s.y), closed: d.g.closed, dismissible: canDismiss, height: d.g.boxH,
    });
    if (d.moved > 6) suppressNextClick(panelRef.current);
    if (close) {
      if (hasGuard) {
        // 要先确认：面板弹回最低一档，再问
        const lowest = list[list.length - 1];
        setDetent(lowest.d);
        slideTo(lowest.y, { from: d.pos, velocity });
        scrimTo(scrimRef.current, 1);
        ov.requestClose('drag');
        return;
      }
      if (prefersReducedMotion.peek()) exit();
      else {
        // 带着手指的速度滑出去（exit 里的 slideTo 从当前拖到的位置出发）
        placeY(d.pos);
        exit(velocity);
      }
      ov.requestClose('drag');
      return;
    }
    const hit = list.find((s) => s.y === target) || list[0];
    setDetent(hit.d);
    slideTo(hit.y, { from: d.pos, velocity });
    scrimTo(scrimRef.current, 1);
  };

  // 把手和标题栏：Pointer Events（鼠标、手指、触控笔都能拖），竖着拖才算（motion/gesture.js）
  const onTopPointerDown = (event) => {
    if (!ov.open || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // （内容区的触摸由下面的 touch 逻辑负责：要和原生滚动配合，只在第一次移动时判定）
    const startY = event.clientY;
    trackDrag(event, {
      axis: 'y',
      threshold: DRAG_SLOP,
      element: topRef.current,
      onStart: () => beginDrag(startY),
      onMove: ({ y }) => moveDrag(y),
      onEnd: () => endDrag(),
      onCancel: () => endDrag(),
    });
  };

  // 内容区：触摸手势和原生滚动配合（只在手指第一次移动时判定一次）
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    let touch = null;
    const onStart = (e) => {
      // 新的触摸：停掉上一次松手留下的惯性滚动（手指按住内容就停，和原生一样）
      stopMomentum(body);
      if (e.touches.length !== 1 || !ov.open) {
        touch = null;
        return;
      }
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, mode: null };
    };
    const onMove = (e) => {
      if (!touch) return;
      const t = e.touches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (!touch.mode) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        const list = ordered();
        const top = list[0]?.y ?? 0;
        const notExpanded = currentY() > top + 1;
        const scroller = findScroller(e.target, body);
        const atTop = !scroller || scroller.scrollTop <= 0;
        if (Math.abs(dx) > Math.abs(dy)) touch.mode = 'native';
        else if ((dy < 0 && notExpanded) || (dy > 0 && atTop)) {
          touch.mode = 'sheet';
          // 往上滑把面板拉高：到最高档后同一个手势接着滚内容（接力）
          beginDrag(touch.y, dy < 0 ? scroller : null);
        } else touch.mode = 'native';
      }
      if (touch.mode === 'sheet') {
        if (e.cancelable) e.preventDefault();
        moveDrag(t.clientY);
      }
    };
    const onEnd = () => {
      if (touch?.mode === 'sheet') endDrag();
      touch = null;
    };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
    };
  }, [ov.open, detents]);

  /** 点把手：在档位之间切换（键盘、读屏软件也能用） */
  const cycleDetent = () => {
    if (drag.current?.moved > 6) return;
    const i = detents.indexOf(detentRef.current);
    const next = detents[(i + 1) % detents.length];
    setDetent(next);
    settleTo(next);
  };

  // ------------------------------------------------------------------
  // 登记到管理器、渲染
  // ------------------------------------------------------------------

  useLayer(ov, {
    layerRef,
    focusRef: panelRef,
    closeOnEsc,
    initialFocus: () => panelRef.current?.querySelector('[data-autofocus]') || titleRef.current || panelRef.current,
  });

  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);
  const renderSlot = (slot) => (typeof slot === 'function' ? slot({ arg: ov.arg, close, detent }) : slot);
  const multi = detents.length > 1;
  const showGrabber = multi || canDismiss;
  const largeNow = detent === detents[detents.length - 1] && detents.length > 1;

  const layerStyle = { zIndex: ov.z };
  if (kb.inset > 0) {
    layerStyle['--ov-kb'] = `${kb.inset}px`;
    layerStyle['--ov-vvh'] = `${kb.height}px`;
  }

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer ov-layer--sheet"
        data-overlay-layer=""
        data-kind="sheet"
        data-sheet-id={ov.sheetId}
        data-state={ov.open ? 'open' : 'closing'}
        data-keyboard={kb.inset > 0 ? 'open' : undefined}
        style={layerStyle}
      >
        <div
          ref={scrimRef}
          class="ov-scrim"
          data-testid={testId ? `${testId}-scrim` : undefined}
          onClick={(e) => {
            if (e.target !== e.currentTarget || !closeOnScrim || !canDismiss) return;
            // 刚升起来：第一下点开、第二下（误双击 / 第一次加载分包慢、以为没点上）落在遮罩上，不当成“关掉”
            if (!gate.opened && performance.now() - enterStartedAt.current < SCRIM_GUARD_MS) return;
            ov.requestClose('scrim');
          }}
        />
        <div class="ov-sheet-frame">
          <section
            ref={panelRef}
            class={`ov-sheet ${cls}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? ids.title : undefined}
            aria-label={title ? undefined : label}
            aria-describedby={description ? ids.desc : undefined}
            tabIndex={-1}
            data-sized={sized}
            data-detent={detent}
            data-material={material}
            data-testid={testId}
          >
            <div
              ref={topRef}
              class="ov-sheet__top"
              data-draggable={showGrabber ? 'true' : undefined}
              onPointerDown={showGrabber ? onTopPointerDown : undefined}
            >
              {showGrabber && (multi ? (
                <button
                  type="button"
                  class="ov-sheet__grabber"
                  aria-label={largeNow ? '收起面板' : '展开面板'}
                  onClick={cycleDetent}
                >
                  <span class="ov-sheet__grabber-bar" aria-hidden="true" />
                </button>
              ) : (
                <span class="ov-sheet__grabber" aria-hidden="true">
                  <span class="ov-sheet__grabber-bar" />
                </span>
              ))}
              {(title || leading || trailing || !hideClose) && (
                <header class="ov-sheet__header">
                  <div class="ov-sheet__side ov-sheet__side--leading">{renderSlot(leading)}</div>
                  <div class="ov-sheet__titles">
                    {title && <h2 ref={titleRef} id={ids.title} class="ov-sheet__title" tabIndex={-1}>{title}</h2>}
                    {description && <p id={ids.desc} class="ov-sheet__description">{description}</p>}
                  </div>
                  <div class="ov-sheet__side ov-sheet__side--trailing">
                    {trailing ? renderSlot(trailing) : !hideClose && <CloseButton onClick={() => ov.requestClose('button')} />}
                  </div>
                </header>
              )}
            </div>
            <div ref={bodyRef} class="ov-sheet__body" data-has-footer={footer ? 'true' : undefined}>
              {renderSlot(children)}
            </div>
            {footer && <div ref={footerRef} class="ov-sheet__footer">{renderSlot(footer)}</div>}
          </section>
        </div>
      </div>
    </OverlayContext.Provider>
  );
}

/** 停掉 root 里正在播的接力惯性滚动 */
function stopMomentum(root) {
  for (const el of root.querySelectorAll('[data-momentum]')) el.dispatchEvent(new Event('momentumstop'));
  if (root.hasAttribute?.('data-momentum')) root.dispatchEvent(new Event('momentumstop'));
}

/** 从 target 往上（到 boundary 为止）找第一个能竖向滚动的元素 */
function findScroller(target, boundary) {
  let el = target && target.nodeType === 1 ? target : target?.parentElement;
  while (el && el !== boundary.parentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
    if (el === boundary) break;
    el = el.parentElement;
  }
  return null;
}
