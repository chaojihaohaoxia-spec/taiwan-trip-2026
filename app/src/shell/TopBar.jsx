// =====================================================================
// shell/TopBar.jsx：常驻顶栏（fixed，盖在页面上面；样稿 02-style.html 的 .topbar 和 07-ui.js 的 TopBar）。
//
// 三种状态（state，由 Frame 按滚动算好传进来，规则见 scroll-state.js）：
//   top   页面最上面：玻璃透明，只剩两边的圆按钮（返回、页面自己的按钮、搜索）；大标题在内容里（shell/PageHead.jsx）
//   pill  往下滚：顶部正中一颗小胶囊（行程里 = 封面点 + 行程名 · 阶段短语（「椰影岛 · 5 天后出发」）+ 圆形箭头，
//         点了打开行程切换面板；其他页 = 页面名，点了回到顶部）
//   bar   在中途往上滑：胶囊展开成整条玻璃顶栏（封面点 + 行程名 + 日期 + 箭头 / 页面名 + 副标题）
//
// 动效（和 ui/CollapsingHeader 同一种做法，用 motion/ 的原语，可打断、速度连续）：
//   - pill ↔ bar：只有一层玻璃（.tb__glass），它的真实形状（top / left / right / bottom / 圆角）连续变化，
//     阴影层（.tb__shadow）和玻璃同一条弹簧、同一组数；整条的内容在 0–35% 淡出、胶囊的字在 25–75% 淡入（错开，不叠字）；
//     一个进度 p 驱动全部（motion/animate.js 的 animateSpringGroup，--spring-smooth），半路反向从当前形状、当前速度接着走；
//   - top → pill / bar：玻璃在原位由 0.9 倍长到 1 倍、同时淡入（样稿「胶囊在原位由小变大浮出来」），字随后出来；
//   - pill / bar → top：玻璃和字淡出（大标题这时已经回到眼前）；
//   - 减弱动态效果：不变形，只淡入淡出（CSS）。
// 搜索框 / 切换面板盖在顶栏上时（covered），顶栏里的字先淡掉，免得透过玻璃叠字（样稿 TopBar.cover）。
// 两边的按钮只是一个图标（IconButton variant="glass"、SearchExpand 的 search-x--glass：纸上没有圆底），任何状态都在原位。
// 整条顶栏不吃点击，只有看得见的按钮吃：顶栏透明时下面的大标题照样能点。
// 看不见的部分（不是当前状态的胶囊 / 整条、被盖住时两边的按钮）用 visibility: hidden 藏好（点不到、Tab 不到、读屏读不到），
// 不用常驻的 inert 属性（弹层系统关掉以后页面上不应该还有 inert 的元素）。
// =====================================================================

import './topbar.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { animateSpringGroup, animateSpring, animateTween, stopAnimation, clearStyle } from '../motion/animate.js';
import { prefersReducedMotion } from '../lib/media.js';
import { clamp, lerp, num, stage } from '../motion/physics.js';
import { useResizeObserver } from '../motion/hooks.js';
import { IconButton } from '../ui/IconButton.jsx';
import { MorphIcon } from '../ui/MorphIcon.jsx';
import { BackGlyph } from './glyphs.jsx';
import { CoverDot } from './CoverDot.jsx';
import { pillPhrase } from './format.js';

const CH = 'tb-morph';
const CH_FADE = 'tb-fade';
/** 胶囊高度（px，和 CSS 的 --tb-pill-h 一致） */
const PILL_H = 44;

/**
 * @param {{ chrome: object, state: 'top'|'pill'|'bar', covered: boolean, info: object|null,
 *           switcherProps: object|null, switcherOpen: boolean, onBack: () => void, onTitle: () => void,
 *           search: any, lifted: boolean }} props
 */
export function TopBar({ chrome, state, covered, info, switcherProps, switcherOpen, onBack, onTitle, search, lifted }) {
  const rootRef = useRef(null);
  const probeRef = useRef(null);
  const glassRef = useRef(null);
  const shadowRef = useRef(null);
  const rowRef = useRef(null);
  const pillRef = useRef(null);
  const trailRef = useRef(null);
  const shown = useRef(state);
  const kind = chrome.kind;
  const isTrip = Boolean(chrome.switcher);

  // 胶囊宽度、右边按钮区宽度 → CSS 变量（静止样式和动画终点用同一组数）
  const measure = () => {
    const root = rootRef.current;
    if (!root) return;
    const pill = pillRef.current;
    if (pill) root.style.setProperty('--tb-pill-w', `${Math.ceil(pill.offsetWidth)}px`);
    // 右边按钮区的宽度写在外层（.shell）：顶栏的胶囊 / 整条、页面大标题都要让出这么多
    const trail = trailRef.current;
    if (trail) {
      const w = trail.offsetWidth ? `${Math.ceil(trail.offsetWidth) + 8}px` : '0px';
      root.style.setProperty('--tb-trail-w', w);
      root.parentElement?.style.setProperty('--tb-trail-w', w);
    }
  };
  useResizeObserver(pillRef, measure);
  useResizeObserver(trailRef, measure);
  useLayoutEffect(measure);

  /** 两种形状（相对顶栏）：bar 量探针（和整条玻璃同一组 CSS），pill 按胶囊宽度算 */
  const shapes = () => {
    const root = rootRef.current;
    const probe = probeRef.current;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const bar = { t: probe.offsetTop, l: probe.offsetLeft, r: W - probe.offsetLeft - probe.offsetWidth, b: H - probe.offsetTop - probe.offsetHeight };
    bar.rad = probe.offsetHeight / 2;
    const pw = pillRef.current?.offsetWidth || 160;
    const t = bar.t + (probe.offsetHeight - PILL_H) / 2;
    const l = (W - pw) / 2;
    const pill = { t, l, r: l, b: H - t - PILL_H, rad: PILL_H / 2 };
    return { bar, pill };
  };

  useLayoutEffect(() => {
    const prev = shown.current;
    if (prev === state) return;
    shown.current = state;
    const glass = glassRef.current;
    const shadow = shadowRef.current;
    const row = rowRef.current;
    const pill = pillRef.current;
    const parts = [glass, shadow, row, pill];
    if (!glass || prefersReducedMotion.peek()) {
      for (const el of parts) {
        stopAnimation(el, CH, { commit: false });
        stopAnimation(el, CH_FADE, { commit: false });
      }
      return;
    }
    if (prev !== 'top' && state !== 'top') {
      // pill ↔ bar：连续形变
      for (const el of parts) stopAnimation(el, CH_FADE, { commit: false });
      const { bar, pill: pl } = shapes();
      const shape = ({ p }) => {
        const q = clamp(p, 0, 1);
        return {
          top: `${num(lerp(bar.t, pl.t, q))}px`,
          right: `${num(lerp(bar.r, pl.r, q))}px`,
          bottom: `${num(lerp(bar.b, pl.b, q))}px`,
          left: `${num(lerp(bar.l, pl.l, q))}px`,
          borderRadius: `${num(lerp(bar.rad, pl.rad, q))}px`,
        };
      };
      const target = state === 'pill' ? 1 : 0;
      animateSpringGroup([
        [glass, shape],
        [shadow, shape],
        [row, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.35)), transform: `scale(${num(1 - 0.04 * clamp(p, 0, 1), 4)})`, visibility: 'visible' })],
        [pill, ({ p }) => ({ opacity: num(stage(p, 0.25, 0.75)), transform: `translateX(-50%) scale(${num(0.94 + 0.06 * clamp(p, 0, 1), 4)})`, visibility: 'visible' })],
      ], {
        channel: CH,
        current: () => ({ p: 1 - target }),
        to: { p: target },
        spring: 'smooth',
        commit: 'clear',
      });
      return;
    }
    for (const el of parts) stopAnimation(el, CH, { commit: false });
    if (state === 'top') {
      // 回到页面最上面：玻璃、阴影、字淡出（visibility 在动画期间保持可见，播完回到 CSS 的 hidden）
      const out = [{ opacity: 1, visibility: 'visible' }, { opacity: 0, visibility: 'visible' }];
      animateTween(glass, out, { duration: 'base', easing: 'out', channel: CH_FADE });
      animateTween(shadow, out, { duration: 'base', easing: 'out', channel: CH_FADE });
      const content = prev === 'pill' ? pill : row;
      const base = prev === 'pill' ? 'translateX(-50%) ' : '';
      animateTween(content, [{ opacity: 1, visibility: 'visible', transform: `${base}scale(1)` }, { opacity: 0, visibility: 'visible', transform: `${base}scale(0.96)` }], { duration: 'fast', easing: 'in', channel: CH_FADE });
      return;
    }
    // 从页面最上面滚下来：玻璃在原位由小变大浮出来，字随后出现（先出后进，不叠字）
    const grow = ({ s, o }) => ({ opacity: num(clamp(o, 0, 1)), transform: `scale(${num(s, 4)})`, visibility: 'visible' });
    animateSpring(glass, { channel: CH_FADE, from: { s: 0.9, o: 0 }, to: { s: 1, o: 1 }, spring: 'smooth', commit: 'clear', render: grow });
    animateSpring(shadow, { channel: CH_FADE, from: { s: 0.9, o: 0 }, to: { s: 1, o: 1 }, spring: 'smooth', commit: 'clear', render: grow });
    const content = state === 'pill' ? pill : row;
    const base = state === 'pill' ? 'translateX(-50%) ' : '';
    animateSpring(content, {
      channel: CH_FADE,
      from: { s: 0.94, o: 0 },
      to: { s: 1, o: 1 },
      spring: 'snappy',
      delay: 60,
      commit: 'clear',
      render: ({ s, o }) => ({ opacity: num(clamp(o, 0, 1)), transform: `${base}scale(${num(s, 4)})`, visibility: 'visible' }),
    });
  }, [state]);

  const title = chrome.loading ? '' : chrome.title;
  const back = Boolean(chrome.back);
  // 行程 tab 的胶囊：行程名后面接阶段短语（样稿「富国岛 · 5 天后出发」）；页面自己改了标题时不接
  const phrase = isTrip && kind === 'tab' && info?.ready && title === info.short ? pillPhrase(info.phase) : null;
  const pillLabel = chrome.loading ? '正在读取行程' : isTrip ? `切换行程：${title}${phrase ? `，${phrase}` : ''}` : `回到顶部：${typeof title === 'string' ? title : ''}`;
  const titleProps = isTrip && switcherProps ? switcherProps : { onClick: onTitle };

  return (
    <header
      ref={rootRef}
      class="tb"
      data-state={state}
      data-kind={kind}
      data-covered={covered ? '' : undefined}
      data-back={back ? '' : undefined}
      data-lifted={lifted ? '' : undefined}
      data-accent-follow=""
      data-testid="shell-topbar"
    >
      <span ref={probeRef} class="tb__probe" aria-hidden="true" />
      <span ref={shadowRef} class="tb__shadow" aria-hidden="true" />
      <span ref={glassRef} class="tb__glass" aria-hidden="true"><span class="tb__edge" /></span>

      <div ref={rowRef} class="tb__row">
        <button type="button" class="tb__switch" data-press="scale" data-press-float="" {...titleProps} aria-label={isTrip ? undefined : `回到顶部：${typeof title === 'string' ? title : ''}`}>
          {isTrip && <CoverDot info={info} />}
          <span class="tb__text">
            {chrome.loading ? <span class="tb__skel" aria-hidden="true" /> : <b>{title}</b>}
            {chrome.subtitle && <i>{chrome.subtitle}</i>}
          </span>
          {isTrip && <span class="chev-chip" aria-hidden="true"><MorphIcon kind="chevron" state={switcherOpen} size={16} /></span>}
        </button>
      </div>

      <button
        ref={pillRef}
        type="button"
        class="tb__pill"
        data-press="scale"
        data-press-float=""
        aria-label={pillLabel}
        data-testid="shell-pill"
        {...titleProps}
      >
        {isTrip && <CoverDot info={info} small />}
        {chrome.loading ? <span class="tb__skel" aria-hidden="true" /> : (
          <span class="tb__pill-text">
            {title}
            {phrase && <span class="tb__pill-phrase">{` · ${phrase}`}</span>}
          </span>
        )}
        {isTrip && !chrome.loading && <span class="chev-chip chev-chip--sm" aria-hidden="true"><MorphIcon kind="chevron" state={switcherOpen} size={14} /></span>}
      </button>

      {/* 返回按钮一直挂着：进出二级页面时淡入淡出（换页动效期间不会一下子消失） */}
      <div class="tb__lead" data-hidden={back ? undefined : ''}>
        <IconButton icon={BackGlyph} label="返回" variant="glass" class="tb__btn" data-press-float="" onClick={onBack} data-testid={back ? 'shell-back' : undefined} />
      </div>
      <div ref={trailRef} class="tb__trail">
        {chrome.actions}
      </div>
      {search}
    </header>
  );
}
