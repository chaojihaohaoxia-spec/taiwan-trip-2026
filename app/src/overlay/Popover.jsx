// =====================================================================
// overlay/Popover.jsx：小菜单 / 气泡（行尾的“更多”、选币种之类）。
//
//   const more = useOverlayTrigger('row-more', { arg: item.id, haspopup: 'menu' });
//   <button {...more.props} class="chip">更多</button>
//   <Popover sheetId="row-more" label="更多操作">
//     {({ arg }) => (
//       <MenuList>
//         <MenuItem label="编辑" onSelect={() => openOverlay('item', { arg })} />
//         <MenuItem tone="danger" label="删除" onSelect={…} />
//       </MenuList>
//     )}
//   </Popover>
//
// - 贴着触发按钮出现（默认下方、右对齐；放不下自动翻到上方，左右夹在屏幕内）；
// - 从按钮那一侧弹出：缩放 0.85 → 1（--spring-bouncy）+ 淡入；关闭时淡出并轻微缩小
//   （motion/animate.js 的弹簧通道，可打断；减弱动态效果时只淡入淡出）；
// - 透明遮罩：点外面任何地方关闭（这一下不会误点到背后的东西）；Esc、返回手势也能关；
// - role="menu"（默认）时里面的 MenuList 自动变成菜单语义，↑↓ 移动焦点，打开时焦点在第一项；
// - 层级 --z-popover：能盖住底部面板（面板里再弹小菜单）。
// =====================================================================

import './overlay.css';
import './Popover.css';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Portal } from './Portal.jsx';
import { OverlayContext, useLayer, useOverlayRoute } from './binding.js';
import { findTrigger } from './manager.js';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { CH, fadeTo, prepareHidden } from './transitions.js';
import { placeAnchored } from './geometry.js';
import { layoutRect, uid, viewportInfo } from './dom.js';
import { tabbables, hadUserInput } from './focus.js';
import { MenuModeContext } from './Menu.jsx';

const renderScale = ({ s }) => ({ transform: `scale(${num(s, 4)})` });
/** 离场时的轻微缩小：很快、不回弹的弹簧 */
const SHRINK = Object.freeze({ duration: 0.2, bounce: 0 });

/**
 * @param {Object} props
 * @param {string} props.sheetId
 * @param {string|null} [props.arg]
 * @param {{ current: HTMLElement|null }} [props.anchorRef]
 * @param {'below'|'above'|'auto'} [props.placement='below']
 * @param {'start'|'center'|'end'} [props.align='end']
 * @param {number} [props.width=240]
 * @param {'menu'|'dialog'} [props.role='menu']   menu：里面放 MenuList；dialog：任意内容（例如小表单）
 * @param {string} [props.label]                  给读屏软件的名字
 * @param {any} [props.title]                     小标题（可选）
 * @param {any} props.children                    内容；或函数 ({ arg, close }) => 内容
 * @param {boolean} [props.closeOnScrim=true]
 * @param {boolean} [props.closeOnEsc=true]
 * @param {string} [props.testId]
 * @param {() => void} [props.onClosed]
 */
export function Popover(props) {
  const ov = useOverlayRoute(props.sheetId, { kind: 'popover', arg: props.arg });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <PopoverLayer {...props} ov={ov} />
    </Portal>
  );
}

function PopoverLayer(props) {
  const {
    ov, anchorRef, placement = 'below', align = 'end', width = 240, role = 'menu', label, title, children,
    closeOnScrim = true, closeOnEsc = true, testId, onClosed,
  } = props;
  const layerRef = useRef(null);
  const scrimRef = useRef(null);
  const popRef = useRef(null);
  const motion = useRef({ token: 0 });
  const titleId = useMemo(() => uid('ov-popover-title'), []);

  const layout = () => {
    const pop = popRef.current;
    const vp = viewportInfo();
    const el = anchorRef?.current || findTrigger(ov.sheetId, ov.arg);
    const a = el && el.isConnected ? layoutRect(el) : { left: vp.width / 2, top: vp.height / 3, width: 0, height: 0 };
    const w = Math.min(width, vp.width - 16);
    pop.style.width = `${w}px`;
    pop.style.maxHeight = 'none';
    const natural = pop.scrollHeight;
    const pos = placeAnchored({ anchor: a, size: { width: w, height: natural }, viewport: vp, placement, align, gap: 6, margin: 8 });
    Object.assign(pop.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      width: `${pos.width}px`,
      maxHeight: `${pos.height}px`,
      transformOrigin: `${pos.originX}px ${pos.originY}px`,
    });
    pop.dataset.side = pos.side;
  };

  /** 小菜单的缩放（弹簧通道：被打断时从当前大小、当前速度接着走） */
  const scaleTo = (s, { from, spring = 'bouncy' } = {}) => animateSpring(popRef.current, {
    channel: CH.scale,
    current: () => ({ s: from ?? 1 }),
    to: { s },
    spring,
    commit: 'clear',
    render: renderScale,
  });

  // 挂上的第一帧：透明（出场动画从这里开始）
  useLayoutEffect(() => prepareHidden(popRef.current), []);

  const enter = () => {
    layout();
    motion.current.token += 1;
    const pop = popRef.current;
    if (prefersReducedMotion.peek()) {
      fadeTo(pop, 1, 'reduced');
      return;
    }
    scaleTo(1, { from: 0.85 });
    fadeTo(pop, 1, 'in');
  };

  const exit = () => {
    motion.current.token += 1;
    const token = motion.current.token;
    const pop = popRef.current;
    const reduced = prefersReducedMotion.peek();
    const jobs = [fadeTo(pop, 0, reduced ? 'reduced' : 'out')];
    if (!reduced) jobs.push(scaleTo(0.94, { spring: SHRINK }));
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

  // 视口尺寸变化：重新贴到按钮旁边
  useEffect(() => {
    if (!ov.open) return undefined;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => popRef.current && layout());
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [ov.open]);

  useLayer(ov, {
    layerRef,
    focusRef: popRef,
    closeOnEsc,
    initialFocus: () => (!hadUserInput() ? popRef.current : null) || popRef.current?.querySelector('[data-autofocus]') || tabbables(popRef.current)[0] || popRef.current,
  });

  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close }), [ov.sheetId, ov.arg]);
  const content = typeof children === 'function' ? children({ arg: ov.arg, close }) : children;
  const isDialog = role === 'dialog';
  const menuMode = useMemo(() => ({ mode: isDialog ? 'list' : 'menu', label }), [isDialog, label]);

  return (
    <OverlayContext.Provider value={ctx}>
      <MenuModeContext.Provider value={menuMode}>
        <div
          ref={layerRef}
          class="ov-layer ov-layer--popover"
          data-overlay-layer=""
          data-kind="popover"
          data-sheet-id={ov.sheetId}
          data-state={ov.open ? 'open' : 'closing'}
          style={{ zIndex: ov.z }}
        >
          <div
            ref={scrimRef}
            class="ov-scrim ov-scrim--clear"
            onClick={(e) => {
              if (e.target === e.currentTarget && closeOnScrim) ov.requestClose('scrim');
            }}
          />
          <div
            ref={popRef}
            class="ov-popover"
            role={isDialog ? 'dialog' : undefined}
            aria-modal={isDialog ? 'true' : undefined}
            aria-labelledby={isDialog && title ? titleId : undefined}
            aria-label={isDialog && !title ? label : undefined}
            tabIndex={-1}
            data-testid={testId}
          >
            {title && <p id={titleId} class="ov-popover__title">{title}</p>}
            {content}
          </div>
        </div>
      </MenuModeContext.Provider>
    </OverlayContext.Provider>
  );
}
