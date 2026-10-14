// =====================================================================
// overlay/AnchoredPanel.jsx：从触发按钮的位置和形状“长出来”的面板（交互 2：悬浮加号面板、行程切换器）。
//
//   const fab = useOverlayTrigger('fab');
//   <button {...fab.props} class="fab" aria-label="添加"><MorphIcon kind="plus" state={fab.isOpen} /></button>
//   <AnchoredPanel sheetId="fab" placement="above" title="快速添加"
//                  anchorProxy={{ class: 'fab', render: ({ open }) => <MorphIcon kind="plus" state={open} /> }}>
//     <MenuList>…</MenuList>
//   </AnchoredPanel>
//
// 动画（共享元素形变，用 motion/morph.js 的 morphFrom / morphTo——和 #/dev/primitives 的“原语”演示同一套代码）：
//   - 面板先排好最终位置（placeAnchored：放不下自动翻面、夹在屏幕内），然后从按钮的矩形和圆角长出来：
//     clip-path: inset(… round 圆角) 从“按钮那么大的一块”展开到整块面板，同时整体从按钮的位置平移到最终位置
//     （--spring-bouncy；过冲只体现在平移上，裁切框不超出面板）；文字不缩放，标题和内容随后淡入；
//   - 阴影是面板下面单独一层（.ov-panel-shadow），形状和裁切出来的形状同一条弹簧、逐帧一致（morph.js 的
//     follow + clipFollower）：形变全程都有跟着圆角走的软阴影，不会先没有、再“啪”地出现，也不会露出硬边；
//   - 颜色和内容跟着**形状此刻有多大**走（不跟时间走）：面板上面盖一层和按钮同色的色层（.ov-panel-tint，形状同样
//     逐帧跟着面板），和按钮一样大时完全是按钮的颜色，长到 6%–55% 之间褪成面板的颜色；标题和正文在 40%–90% 之间出现。
//     收回时反过来：内容先淡出，形状缩到一半左右色层盖上来，落地时正好是按钮的颜色——看起来是“按钮变成面板、
//     面板变回按钮”，不是一块白色从按钮后面长出来再缩回去。两者都是形状的函数（motion/morph.js 的 tint、
//     contentFade: 'shape'，规则在 motion/morph-shape.js），和形状同一条弹簧、同一组关键帧：半路打断、反向、终点改了
//     都一起连续变化。按钮是透明底时不加色层，收尾整块淡掉和真按钮交接；
//   - 关闭：重新量按钮“此刻”的位置（中途滚动、布局变了也对），原路收回（--spring-smooth）；
//   - 打开期间在按钮原位放一个“替身按钮”（anchorProxy），浮在遮罩上面，图标同步变形（加号转 ×），点它关闭；
//     替身接着真按钮此刻的按压回弹继续弹（motion/press-handoff.js，不会从 0.96 跳到 1）；
//     真按钮这期间透明，退场动画播完替身消失、真按钮同一帧出现；
//   - 动画可被打断：半路再开 / 再关都从当前形状、当前速度折返；减弱动态效果时只淡入淡出。
// =====================================================================

import './overlay.css';
import './AnchoredPanel.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { morphFrom, morphTo, clipFollower } from '../motion/morph.js';
import { stopAnimation, clearStyle } from '../motion/animate.js';
import { pressScaleOf } from '../motion/press-handoff.js';
import { spring } from '../motion/springs.js';
import { prefersReducedMotion } from '../lib/media.js';
import { Portal } from './Portal.jsx';
import { OverlayContext, useLayer, useOpenedGate, useOverlayRoute } from './binding.js';
import { findTrigger } from './manager.js';
import { placeAnchored } from './geometry.js';
import { anchorRect, uid, viewportInfo } from './dom.js';
import { tabbables, hadUserInput } from './focus.js';
import { AnchorProxy } from './parts.jsx';
import { fadeTo, prepareHidden, scrimTo } from './transitions.js';

/** 随形变淡入淡出的内容 */
const CONTENT = '.ov-panel__title, .ov-panel__body';
/** 收回时最后一段整块淡掉（和真按钮交接；按钮是透明底、没有色层时用）的动画通道 */
const CH_HANDOFF = 'ov-panel-handoff';

/** 按钮的底色能不能当色层（不透明到看得出来）；返回颜色或 null */
function solidColorOf(el) {
  if (!el) return null;
  const c = getComputedStyle(el).backgroundColor;
  if (!c || c === 'transparent') return null;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (!(a > 0.6)) return null;
  }
  return c;
}

/** 找不到触发按钮时（例如从分享链接直接打开）：假装从底部正中的一个 56px 圆形按钮长出来 */
function fallbackAnchor(vp) {
  return { left: vp.width / 2 - 28, top: vp.height - vp.insets.bottom - 88, width: 56, height: 56, radius: 28 };
}

/**
 * @param {Object} props
 * @param {string} props.sheetId
 * @param {string|null} [props.arg]
 * @param {{ current: HTMLElement|null }} [props.anchorRef]   触发按钮（不给就找带 data-overlay-trigger 的按钮）
 * @param {'auto'|'above'|'below'} [props.placement='auto']
 * @param {'start'|'center'|'end'} [props.align='center']
 * @param {number} [props.width=360]     面板宽度（px，手机上不超过屏幕宽减两边留白）
 * @param {number} [props.gap=10]        面板和按钮的间距
 * @param {any} [props.title]
 * @param {string} [props.label]          没有标题时给读屏软件的名字
 * @param {any} props.children            内容；或函数 ({ arg, close }) => 内容
 * @param {import('./parts.jsx').AnchorProxyOptions} [props.anchorProxy]  替身按钮（见 parts.jsx）
 * @param {boolean} [props.closeOnScrim=true]
 * @param {boolean} [props.closeOnEsc=true]
 * @param {boolean} [props.tintOnExit=true]  收回时形状染回按钮色；false = 不染、最后一段淡掉（按钮在更高的层上、形状会从它后面露出来时）
 * @param {'solid'|'glass'} [props.material='solid']
 * @param {string} [props.class]
 * @param {string} [props.testId]
 * @param {() => void} [props.onClosed]
 * @param {() => void} [props.onOpened]   长出来的动画播完（重活等这时再做；内容里也可以 await useOverlay().whenOpened()）
 */
export function AnchoredPanel(props) {
  const ov = useOverlayRoute(props.sheetId, { kind: 'panel', arg: props.arg });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <PanelLayer {...props} ov={ov} />
    </Portal>
  );
}

function PanelLayer(props) {
  const {
    ov, anchorRef, placement = 'auto', align = 'center', width = 360, gap = 10, title, label, children,
    anchorProxy, closeOnScrim = true, closeOnEsc = true, material = 'solid', class: cls = '', testId, onClosed, onOpened,
    tintOnExit = true,
  } = props;
  const gate = useOpenedGate(onOpened);
  const layerRef = useRef(null);
  const scrimRef = useRef(null);
  const shadowRef = useRef(null);
  const tintRef = useRef(null);
  const panelRef = useRef(null);
  const titleRef = useRef(null);
  const anchorEl = useRef(null);
  const geo = useRef(null);
  const motion = useRef({ token: 0 });
  const titleId = useMemo(() => uid('ov-panel-title'), []);
  const [proxyRect, setProxyRect] = useState(null);
  /** 打开那一刻真按钮的按压缩放（替身接着弹；要在藏起真按钮之前读） */
  const startScale = useRef(1);

  const resolveAnchor = () => {
    const el = anchorRef?.current || findTrigger(ov.sheetId, ov.arg);
    anchorEl.current = el && el.isConnected ? el : null;
    return anchorEl.current;
  };

  /** 按钮现在的形状（排版矩形 + 圆角；按钮被按下缩着也按原尺寸算） */
  const anchorShape = (vp = viewportInfo()) => {
    const el = resolveAnchor();
    return el ? anchorRect(el) : fallbackAnchor(vp);
  };

  /** 量好面板的最终位置，写进样式；返回几何信息 */
  const layout = () => {
    const panel = panelRef.current;
    const vp = viewportInfo();
    const a = anchorShape(vp);
    const margin = 16;
    const w = Math.min(width, vp.width - vp.insets.left - vp.insets.right - margin * 2);
    // 先按目标宽度、不限高量出内容的自然高度（形变的 transform / clip-path 不影响排版）
    panel.style.width = `${w}px`;
    panel.style.maxHeight = 'none';
    const natural = panel.scrollHeight;
    const pos = placeAnchored({ anchor: a, size: { width: w, height: natural }, viewport: vp, placement, align, gap, margin });
    Object.assign(panel.style, {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      width: `${pos.width}px`,
      maxHeight: `${pos.height}px`,
    });
    panel.dataset.side = pos.side;
    // 阴影层、色层和面板同一个位置、同样大小（尺寸写成变量：形变结束清掉内联的 width / height 后回到它）；
    // 形变时由 clipFollower 逐帧改成裁出来的形状
    const size = { width: panel.offsetWidth, height: panel.offsetHeight };
    for (const el of [shadowRef.current, tintRef.current]) {
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      el.style.setProperty('--ov-panel-w', `${size.width}px`);
      el.style.setProperty('--ov-panel-h', `${size.height}px`);
    }
    geo.current = { anchor: a, pos, size };
    return geo.current;
  };

  /** 阴影层：形状和裁出来的面板逐帧一致（色层、内容由 morph.js 的 tint / contentFade: 'shape' 管） */
  const followers = () => [[shadowRef.current, clipFollower(geo.current.size)]];

  /** 形变参数：色层跟着形状褪色 / 盖上（按钮透明底、减弱动态效果时没有），内容跟着形状出现 / 淡出 */
  const shapeOptions = (color) => ({ content: CONTENT, contentFade: 'shape', tint: color ? tintRef.current : null, follow: followers() });

  /** 色层：有颜色就涂上（不透明度由形变逐帧给）；没有（透明底按钮、减弱动态效果）就停掉、藏好 */
  const prepareTint = (color) => {
    const tint = tintRef.current;
    if (color) {
      tint.style.backgroundColor = color;
      return;
    }
    stopAnimation(tint, 'morph', { commit: false });
    clearStyle(tint, ['transform', 'width', 'height', 'borderRadius', 'opacity']);
    tint.style.opacity = '0';
  };

  // 挂上的第一帧：遮罩透明（面板本身由 morphFrom 在同一帧裁成按钮的形状）
  useLayoutEffect(() => prepareHidden(scrimRef.current), []);

  const enter = () => {
    const g = layout();
    motion.current.token += 1;
    startScale.current = pressScaleOf(anchorEl.current);
    setProxyRect(anchorEl.current ? { left: g.anchor.left, top: g.anchor.top, width: g.anchor.width, height: g.anchor.height } : null);
    const panel = panelRef.current;
    // 收回的最后一段淡出（交接）要是正在播，先撤掉
    stopAnimation(panel, CH_HANDOFF, { commit: false });
    clearStyle(panel, ['opacity']);
    const reduced = prefersReducedMotion.peek();
    const color = reduced ? null : solidColorOf(anchorEl.current);
    // 色层、内容的不透明度由形变逐帧给（收回到一半又打开：从此刻的形状、此刻的浓淡接着走）
    prepareTint(color);
    gate.reset();
    const anim = morphFrom(panel, g.anchor, { mode: 'clip', spring: 'bouncy', fadeShadow: false, ...shapeOptions(color) });
    anim.finished.then((done) => done && gate.open());
    motion.current.shown = true;
    if (reduced) fadeTo(scrimRef.current, 1, 'reduced');
    else scrimTo(scrimRef.current, 1);
  };

  const exit = () => {
    motion.current.token += 1;
    const token = motion.current.token;
    const panel = panelRef.current;
    const prev = geo.current;
    const dest = anchorShape();
    // 按钮挪了位置（布局变了、页面滚过）：替身跟过去，形状收回到按钮现在的位置
    if (anchorEl.current && prev && (Math.abs(dest.left - prev.anchor.left) > 1 || Math.abs(dest.top - prev.anchor.top) > 1)) {
      setProxyRect({ left: dest.left, top: dest.top, width: dest.width, height: dest.height });
    }
    const reduced = prefersReducedMotion.peek();
    // tintOnExit: false：收回时不盖按钮色，按透明底按钮的方式在最后一段淡掉（按钮在别的层上面、形状会从它后面露出一截时用，
    // 例如底栏浮在 ＋ 面板上面：染成按钮色的形状从底栏上沿冒出一块）
    const color = reduced || !tintOnExit ? null : solidColorOf(anchorEl.current);
    prepareTint(color);
    // 色层、内容跟着形状走（见文件头）：内容先淡出，缩到一半左右色层盖上来，落地时正好是按钮的颜色
    const shrink = (to) => morphTo(panel, to, { mode: 'clip', ...shapeOptions(color) });
    motion.current.shape = shrink(dest);
    const others = [];
    if (reduced) {
      others.push(fadeTo(scrimRef.current, 0, 'reduced'));
    } else if (color) {
      others.push(scrimTo(scrimRef.current, 0));
    } else {
      // 按钮是透明底：收到最后约 45% 时整块淡掉，和真按钮（替身）交接（时长取 smooth 弹簧的停稳时间，不含慢动作倍率——补间会自己乘）
      others.push(fadeTo(panel, 0, 'out', { delay: spring('smooth').duration * 0.55, channel: CH_HANDOFF }));
      others.push(scrimTo(scrimRef.current, 0));
    }
    // 收回播完才卸载。收回的终点中途被改过（见下面）：等最新的那一段播完
    (async () => {
      const rest = await Promise.all(others.map((a) => a.finished));
      for (;;) {
        const cur = motion.current.shape;
        const done = await cur.finished;
        if (token !== motion.current.token) return;
        if (done) break;
        if (motion.current.shape === cur) return; // 被别的原因打断（重新打开）
      }
      if (!rest.every(Boolean)) return;
      motion.current.shown = false;
      ov.onExited();
      onClosed?.();
    })();
    // 关闭的同一刻页面可能还在重新排版（网址变了、背后的内容变高变矮）：下一帧再量一次按钮，
    // 挪了位置就把收回的终点改过去（从当前形状、当前速度接着走，不跳）
    if (!reduced) {
      requestAnimationFrame(() => {
        if (token !== motion.current.token || !panelRef.current) return;
        const now = anchorShape();
        if (Math.abs(now.left - dest.left) <= 1 && Math.abs(now.top - dest.top) <= 1) return;
        if (anchorEl.current) setProxyRect({ left: now.left, top: now.top, width: now.width, height: now.height });
        motion.current.shape = shrink(now);
      });
    }
  };

  useLayoutEffect(() => {
    if (ov.open) enter();
    else exit();
  }, [ov.open]);

  // 打开期间真按钮透明（替身代替它）；卸载时恢复
  useLayoutEffect(() => {
    const el = anchorEl.current;
    if (!el || !anchorProxy || proxyRect === null) return undefined;
    el.setAttribute('data-overlay-anchor-hidden', '');
    return () => el.removeAttribute('data-overlay-anchor-hidden');
  }, [proxyRect !== null]);

  // 视口尺寸变化：重新排版，形状直接到位
  useEffect(() => {
    if (!ov.open) return undefined;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        stopAnimation(panel, 'morph', { commit: false });
        clearStyle(panel, ['transform', 'clipPath', 'transformOrigin']);
        // 跟着形变的层（阴影、色层、内容）一起回到静止样式：色层透明、内容不透明
        for (const el of [shadowRef.current, tintRef.current, ...panel.querySelectorAll(CONTENT)]) {
          stopAnimation(el, 'morph', { commit: false });
          clearStyle(el, ['transform', 'width', 'height', 'borderRadius', 'opacity']);
        }
        const g = layout();
        setProxyRect(anchorEl.current ? { left: g.anchor.left, top: g.anchor.top, width: g.anchor.width, height: g.anchor.height } : null);
        // 长出来的动画被这里掐掉了（不会再报“播完”）：形状已经直接到位，算打开好了
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
    focusRef: panelRef,
    closeOnEsc,
    initialFocus: () => {
      const panel = panelRef.current;
      // 从网址直接恢复（用户还没操作过）：焦点放在面板上，不在第一个按钮上画焦点框
      if (!hadUserInput()) return panel;
      return panel?.querySelector('[data-autofocus]') || tabbables(panel?.querySelector('.ov-panel__body'))[0] || titleRef.current || panel;
    },
  });

  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);
  const content = typeof children === 'function' ? children({ arg: ov.arg, close }) : children;

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer ov-layer--panel"
        data-overlay-layer=""
        data-kind="panel"
        data-sheet-id={ov.sheetId}
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <div
          ref={scrimRef}
          class="ov-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && closeOnScrim) ov.requestClose('scrim');
          }}
        />
        <div ref={shadowRef} class="ov-panel-shadow" aria-hidden="true" />
        <section
          ref={panelRef}
          class={`ov-panel ${cls}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : label}
          tabIndex={-1}
          data-material={material}
          data-testid={testId}
        >
          {title && <h2 ref={titleRef} id={titleId} class="ov-panel__title" tabIndex={-1}>{title}</h2>}
          <div class="ov-panel__body">{content}</div>
        </section>
        <div ref={tintRef} class="ov-panel-tint" aria-hidden="true" />
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
