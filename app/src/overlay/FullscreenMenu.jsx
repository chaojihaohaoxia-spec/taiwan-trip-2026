// =====================================================================
// overlay/FullscreenMenu.jsx：从按钮位置圆形扩散铺满全屏的菜单（交互 10）。
//
//   const menu = useOverlayTrigger('menu');
//   <button {...menu.props} class="icon-btn" aria-label="菜单"><MorphIcon kind="menu" state={menu.isOpen} /></button>
//   <FullscreenMenu sheetId="menu" title="菜单"
//                   anchorProxy={{ class: 'icon-btn', render: ({ open }) => <MorphIcon kind="menu" state={open} /> }}>
//     <MenuList>
//       <MenuItem href="#/t/x/ledger" icon={<IconWallet size={18} />} label="账本" detail="12 笔 · 合计 HK$3,210" chevron />
//     </MenuList>
//   </FullscreenMenu>
//
// 动画（motion/ 的原语）：
//   - 菜单整层 clip-path: circle(r at x y)：motion/morph.js 的 revealCircle，圆心在按钮中心，
//     扩散到盖住屏幕最远的角（--spring-smooth）。有替身按钮时从按钮那么大开始（替身浮在上面，看得见按钮
//     变成菜单）；没有替身（按钮在页面中间）时从一个点开始——否则第 0 帧一块和按钮一样大的白色圆片会把按钮盖住；
//     这时圆在按钮附近（半径小于按钮的 2.5 倍）的那一段整层跟着半径淡入淡出（revealCircle 的 fadeRadius）：
//     收回的最后一段圆逐渐透明、按钮从下面透出来，不会有一块白色圆片压着按钮、最后才“啪”地消失；
//   - 圆的后面有一层遮罩随圆一起变深（--color-scrim）：浅色模式下白色菜单盖在浅灰页面上也看得出圆在扩散；
//   - 菜单项（带 data-ov-stagger 的元素，MenuItem 自带）随后逐个错落入场：淡入 + 上移 16px，间隔 20ms、
//     最多错开 6 项（再多的同时出现，整个入场不拖沓）
//     （animateSpring 的 'ov-stagger' 通道，被打断时从当前位置、当前透明度接着走）；
//   - 关闭：菜单项一起淡出，圆形原路收回到按钮“此刻”的中心；动画可被打断（半路反向从当前半径、当前速度折返）；
//   - 按钮在顶栏 / 底栏里时，原位放替身（三横线变 ×），点它关闭；按钮在页面中间、或没给替身时，
//     右上角有关闭按钮（替身会压住菜单内容）；
//   - 减弱动态效果：整层淡入淡出，不扩散、不错落。
// 菜单里的链接直接 <a href="#/…">（或 MenuItem href）：路由换页时会替换掉菜单那条历史，菜单自己收回。
// =====================================================================

import './overlay.css';
import './FullscreenMenu.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Portal } from './Portal.jsx';
import { OverlayContext, useLayer, useOpenedGate, useOverlayRoute } from './binding.js';
import { findTrigger } from './manager.js';
import { revealCircle } from '../motion/morph.js';
import { animateSpring, getAnimation, stopAnimation, clearStyle } from '../motion/animate.js';
import { pressScaleOf } from '../motion/press-handoff.js';
import { clamp, num } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { layoutRect, uid, viewportInfo } from './dom.js';
import { tabbables, hadUserInput } from './focus.js';
import { AnchorProxy, CloseButton } from './parts.jsx';
import { fadeTo, prepareHidden, scrimTo } from './transitions.js';

/** 按钮中心离屏幕上 / 下边缘多近算“在顶栏 / 底栏里”（px，不含安全区） */
const PROXY_ZONE = 96;

/** 错落入场：每项间隔多少毫秒、最多错开几项（再多的同时出现） */
export const STAGGER_STEP = 20;
export const STAGGER_MAX = 6;
/** 第一项在圆扩散开始后多久出场（毫秒） */
const STAGGER_START = 70;
/** 菜单项的动画通道 */
const CH_ITEM = 'ov-stagger';
/** 菜单项离场：很快的、不回弹的弹簧（淡出，不位移） */
const ITEM_OUT = Object.freeze({ duration: 0.2, bounce: 0 });
const renderItem = ({ y, o }) => ({ transform: `translateY(${num(y)}px)`, opacity: num(clamp(o, 0, 1)) });

/**
 * @param {Object} props
 * @param {string} props.sheetId
 * @param {string|null} [props.arg]
 * @param {{ current: HTMLElement|null }} [props.anchorRef]
 * @param {any} [props.title='菜单']
 * @param {any} [props.subtitle]
 * @param {any} props.children           内容；或函数 ({ arg, close }) => 内容
 * @param {any} [props.footer]           底部（例如深浅色切换）
 * @param {import('./parts.jsx').AnchorProxyOptions} [props.anchorProxy]
 * @param {boolean} [props.closeOnEsc=true]
 * @param {string} [props.class]
 * @param {string} [props.testId]
 * @param {() => void} [props.onClosed]
 * @param {() => void} [props.onOpened]   扩散动画播完（重活等这时再做；内容里也可以 await useOverlay().whenOpened()）
 */
export function FullscreenMenu(props) {
  const ov = useOverlayRoute(props.sheetId, { kind: 'menu', arg: props.arg });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <MenuLayer {...props} ov={ov} />
    </Portal>
  );
}

function MenuLayer(props) {
  const { ov, anchorRef, title = '菜单', subtitle, children, footer, anchorProxy, closeOnEsc = true, class: cls = '', testId, onClosed, onOpened } = props;
  const gate = useOpenedGate(onOpened);
  const layerRef = useRef(null);
  const scrimRef = useRef(null);
  const menuRef = useRef(null);
  const titleRef = useRef(null);
  const anchorEl = useRef(null);
  const geo = useRef(null);
  const motion = useRef({ token: 0 });
  const titleId = useMemo(() => uid('ov-menu-title'), []);
  const [proxyRect, setProxyRect] = useState(null);
  /** 打开那一刻真按钮的按压缩放（替身接着弹；要在藏起真按钮之前读） */
  const startScale = useRef(1);
  const [zone, setZone] = useState(null);

  /** 圆心（按钮中心）、起始半径（按钮那么大）；铺满的半径由 revealCircle 按视口算 */
  const measure = () => {
    const vp = viewportInfo();
    const el = anchorRef?.current || findTrigger(ov.sheetId, ov.arg);
    anchorEl.current = el && el.isConnected ? el : null;
    const a = anchorEl.current ? layoutRect(anchorEl.current) : { left: vp.width - 44 - 16, top: vp.insets.top + 6, width: 44, height: 44 };
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;
    // 替身按钮只在按钮位于“顶栏区”或“底栏区”时出现（正好当关闭按钮用）；
    // 按钮在页面中间时替身会压住菜单内容，改用右上角的关闭按钮（圆仍然从按钮扩散、收回到按钮）
    let zone = null;
    if (anchorEl.current) {
      if (cy < vp.insets.top + PROXY_ZONE) zone = 'top';
      else if (cy > vp.height - vp.insets.bottom - PROXY_ZONE) zone = 'bottom';
    }
    // 有替身（顶栏 / 底栏区）：圆从按钮那么大开始，替身浮在上面；没有替身：从一个点开始，不盖住按钮
    const rb = Math.min(a.width, a.height) / 2;
    const r0 = zone && anchorProxy ? rb : 0;
    // 从一个点开始时：圆还没比按钮大多少的那一段整层跟着半径淡入淡出（收回的最后一段按钮从下面透出来，不被白色圆片盖住）
    const fadeRadius = r0 ? undefined : [rb * 0.5, rb * 2.5];
    geo.current = { anchor: a, zone, cx, cy, r0, fadeRadius };
    return geo.current;
  };

  // 挂上的第一帧：遮罩透明
  useLayoutEffect(() => prepareHidden(scrimRef.current), []);

  const staggerItems = () => [...(menuRef.current?.querySelectorAll('[data-ov-stagger]') || [])];
  /** 菜单项此刻的位移和透明度（动画中读动画的当前值） */
  const itemNow = (item) => getAnimation(item, CH_ITEM)?.values() || { y: 0, o: Number(getComputedStyle(item).opacity) || 0 };

  const enter = () => {
    const g = measure();
    motion.current.token += 1;
    startScale.current = pressScaleOf(anchorEl.current);
    setProxyRect(g.zone ? g.anchor : null);
    setZone(g.zone);
    const menu = menuRef.current;
    const items = staggerItems();
    if (prefersReducedMotion.peek()) {
      // 不扩散、不错落：整层淡入
      for (const item of items) {
        stopAnimation(item, CH_ITEM, { commit: false });
        clearStyle(item, ['transform', 'opacity']);
      }
      gate.reset();
      revealCircle(menu, { x: g.cx, y: g.cy }, { fromRadius: g.r0 }).finished.then((done) => done && gate.open());
      fadeTo(scrimRef.current, 1, 'reduced');
      return;
    }
    // 半路被重新打开（关闭动画还在播）：菜单项从当前状态直接回来，不再错落、不再往下跳
    const reopening = Boolean(getAnimation(menu, 'reveal'));
    gate.reset();
    revealCircle(menu, { x: g.cx, y: g.cy }, { fromRadius: g.r0, fadeRadius: g.fadeRadius, spring: 'smooth' }).finished.then((done) => done && gate.open());
    scrimTo(scrimRef.current, 1);
    items.forEach((item, i) => {
      animateSpring(item, {
        channel: CH_ITEM,
        current: () => (reopening ? itemNow(item) : { y: 16, o: 0 }),
        to: { y: 0, o: 1 },
        spring: 'smooth',
        delay: reopening ? 0 : STAGGER_START + Math.min(i, STAGGER_MAX) * STAGGER_STEP,
        commit: 'clear',
        render: renderItem,
      });
    });
  };

  const exit = () => {
    motion.current.token += 1;
    const token = motion.current.token;
    const menu = menuRef.current;
    const prev = geo.current || measure();
    const g = measure(); // 按钮此刻的位置（可能挪过）
    if (g.anchor.left !== prev.anchor.left || g.anchor.top !== prev.anchor.top) setProxyRect(g.zone && prev.zone ? g.anchor : null);
    const jobs = [revealCircle(menu, { x: g.cx, y: g.cy }, { reverse: true, fromRadius: g.r0, fadeRadius: g.fadeRadius, spring: 'smooth' })];
    jobs.push(prefersReducedMotion.peek() ? fadeTo(scrimRef.current, 0, 'reduced') : scrimTo(scrimRef.current, 0));
    if (!prefersReducedMotion.peek()) {
      for (const item of staggerItems()) {
        const now = itemNow(item);
        jobs.push(animateSpring(item, {
          channel: CH_ITEM, from: now, to: { y: now.y, o: 0 }, spring: ITEM_OUT, commit: 'final', render: renderItem,
        }));
      }
    }
    Promise.all(jobs.map((a) => a.finished)).then((done) => {
      if (token !== motion.current.token || !done.every(Boolean)) return;
      ov.onExited();
      onClosed?.();
    });
  };

  useLayoutEffect(() => {
    if (ov.open) enter();
    else exit();
  }, [ov.open]);

  // 替身真的放出来了（按钮在顶栏 / 底栏区）才把真按钮变透明；按钮在页面中间时没有替身，真按钮一直看得见
  // （菜单盖住它；收回的最后一段圆变透明时它从下面透出来）
  useLayoutEffect(() => {
    const el = anchorEl.current;
    if (!el || !anchorProxy || proxyRect === null) return undefined;
    el.setAttribute('data-overlay-anchor-hidden', '');
    return () => el.removeAttribute('data-overlay-anchor-hidden');
  }, [proxyRect !== null]);

  // 视口尺寸变化：圆直接铺满新的视口，替身按钮跟着按钮走
  useEffect(() => {
    if (!ov.open) return undefined;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const menu = menuRef.current;
        if (!menu) return;
        // 圆直接铺满新的视口（扩散动画停掉、去掉裁切和跟着半径的淡入）
        stopAnimation(menu, 'reveal', { commit: false });
        clearStyle(menu, ['clipPath', 'opacity']);
        const g = measure();
        setProxyRect(g.zone ? g.anchor : null);
        setZone(g.zone);
        // 扩散动画被这里掐掉了（不会再报“播完”）：菜单已经铺满，算打开好了
        gate.open();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [ov.open]);

  useLayer(ov, {
    layerRef,
    focusRef: menuRef,
    closeOnEsc,
    // 从网址直接恢复（用户还没操作过）：焦点放在菜单上，不在第一个瓷砖上画焦点框
    initialFocus: () => (!hadUserInput() ? menuRef.current : null) || menuRef.current?.querySelector('[data-autofocus]')
      || tabbables(menuRef.current?.querySelector('.ov-fsmenu__body'))[0] || titleRef.current,
  });

  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);
  const render = (slot) => (typeof slot === 'function' ? slot({ arg: ov.arg, close }) : slot);

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer ov-layer--menu"
        data-overlay-layer=""
        data-kind="menu"
        data-sheet-id={ov.sheetId}
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <div ref={scrimRef} class="ov-scrim ov-fsmenu-scrim" aria-hidden="true" />
        <div
          ref={menuRef}
          class={`ov-fsmenu ${cls}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid={testId}
          data-proxy-zone={anchorProxy && proxyRect ? zone : undefined}
        >
          <div class="ov-fsmenu__scroll">
            <div class="ov-fsmenu__inner">
              <header class="ov-fsmenu__header" data-ov-stagger="">
                <h2 ref={titleRef} id={titleId} class="ov-fsmenu__title" tabIndex={-1}>{title}</h2>
                {subtitle && <p class="ov-fsmenu__subtitle">{subtitle}</p>}
              </header>
              <div class="ov-fsmenu__body">{render(children)}</div>
              {footer && <div class="ov-fsmenu__footer" data-ov-stagger="">{render(footer)}</div>}
            </div>
          </div>
          {!(anchorProxy && proxyRect) && (
            <div class="ov-fsmenu__close">
              <CloseButton onClick={() => ov.requestClose('button')} testId={testId ? `${testId}-close` : undefined} />
            </div>
          )}
        </div>
        <AnchorProxy
          rect={proxyRect}
          options={anchorProxy}
          open={ov.open}
          startScale={startScale.current}
          onClick={() => ov.requestClose('anchor')}
          testId={testId ? `${testId}-anchor` : undefined}
        />
      </div>
    </OverlayContext.Provider>
  );
}
