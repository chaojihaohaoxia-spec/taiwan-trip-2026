// =====================================================================
// ui/CollapsingHeader.jsx：顶栏随滚动收成小胶囊（交互 9），上滑恢复。
//
//   <CollapsingHeader title="椰影岛 · 第 2 天" compactTitle="第 2 天"
//     leading={<IconButton icon={IconArrowLeft} label="返回" onClick={() => back()} />}
//     trailing={<IconButton icon={IconSearch} label="搜索" />} />
//
// 样子（A 液态玻璃）：整条状态是离屏幕两边 16px、浮在页面上的玻璃条（圆角 = 半高，带投影和高光细边）；
//   胶囊是顶部正中 44px 高的小玻璃胶囊。两种状态的几何都由 CSS 变量决定（CollapsingHeader.css 的 --ch-*），
//   JS 量一个看不见的探针元素（.ch__probe，和整条状态的玻璃同样的位置、圆角）拿到像素值，动画按这两组数字插值。
//
// 行为：
//   - 在页面顶部：顶栏透明（和大标题融为一体）；一滚动就出现玻璃底；
//   - 往下滚（读 window 的滚动；页面滚动的是文档本身）→ 整条顶栏连续地“收拢”成屏幕顶部正中的小胶囊；
//   - 往上滑一点 → 原样展开；点胶囊 → 展开；键盘焦点进入顶栏 → 展开；在展开状态点标题 → 回到页面顶部；
//   - 带安全区（刘海）：padding-top = --safe-top；传 safeArea={false} 不留（嵌在框里演示时用）。
//
// 动效（一个进度 p：0 = 整条，1 = 胶囊；--spring-smooth，收起和展开都不回弹）：
//   - **只有一层玻璃**：它的实际形状（top / left / right / bottom / 圆角）从整条连续变成胶囊——
//     不用 scale（会把胶囊两端拉成椭圆、把高光和阴影一起拉变形），也不用 clip-path（会把胶囊的阴影裁掉）；
//     这一层是空的绝对定位元素，改形状只重排它自己，代价很小；
//   - 阴影是玻璃下面单独一层（透明底 + 外阴影，只露出形状外面的阴影），形状和玻璃同一条弹簧；
//     悬浮的玻璃条和胶囊都有投影（在页面最顶上、玻璃透明时没有，透明度从那里淡入）；
//     不能用外层 filter: drop-shadow——那会让里面玻璃的 backdrop-filter 看不到页面（backdrop root），磨砂失效；
//   - 高光描边单独一层，和阴影一样显隐；
//   - 标题：缩小一号进胶囊（transform 跟着 p 走）；完整标题在 0–35% 淡出，短标题在 25–75% 淡入（错开，不重影）；
//   - 两侧按钮在 0–45% 淡出并缩小；
//   - 全部由 motion/animate.js 的 animateSpringGroup 驱动：滚到一半反向，从当前形状、当前速度接着走（速度连续）；
//   - 减弱动态效果：不做形变，直接换状态，文字和按钮只淡入淡出（CSS）。
// 滚动判断见 ui/scroll-intent.js（有防抖动的累计阈值，到底部的回弹不算往上滚）。
// scrollRef：可选，滚动发生在某个容器里时传它（只给开发页的“手机框”演示用；正式页面滚动的是 window）。
// position：默认 sticky（占位置、吸顶）；传 'fixed' 时浮在内容上（页面自己留出顶部空间）。
// =====================================================================

import './CollapsingHeader.css';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useResizeObserver } from '../motion/hooks.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { animateSpringGroup, stopAnimation } from '../motion/animate.js';
import { clamp, lerp, num, stage } from '../motion/physics.js';
import { createScrollIntent } from './scroll-intent.js';
import { Pressable } from './Pressable.jsx';
import { cx } from './util.js';

const CHANNEL = 'ch-morph';
/** 胶囊高度的后备值（px）：正常从 CSS 的 --ch-pill-h 读 */
const PILL_H = 44;

/** 浏览器支持 color-mix 才对玻璃底色做插值（不支持就直接换色，形状照常连续） */
const canMix = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)');

/**
 * @param {{ title: any, compactTitle?: any, leading?: any, trailing?: any, scrollRef?: { current: HTMLElement|null },
 *           threshold?: number, safeArea?: boolean, position?: 'sticky'|'fixed', label?: string,
 *           onStateChange?: (state: 'bar'|'pill') => void, class?: string }} props
 */
export function CollapsingHeader({
  title, compactTitle, leading, trailing, scrollRef, threshold = 56, safeArea = true, position = 'sticky',
  label = '页面顶栏', onStateChange, class: className, ...rest
}) {
  const [state, setState] = useState('bar');
  const [atTop, setAtTop] = useState(true);
  const rootRef = useRef(null);
  const glassRef = useRef(null);
  const edgeRef = useRef(null);
  const shadowRef = useRef(null);
  const probeRef = useRef(null);
  const titleRef = useRef(null);
  const fullRef = useRef(null);
  const compactRef = useRef(null);
  const leadingRef = useRef(null);
  const trailingRef = useRef(null);
  /** 几何（相对顶栏）：胶囊 { t, r, b, l, rad }，整条 bar: { t, r, b, l, rad } */
  const geo = useRef(null);
  const intent = useRef(null);
  if (!intent.current) intent.current = createScrollIntent({ threshold });
  const onChange = useRef(onStateChange);
  onChange.current = onStateChange;
  const shownState = useRef(state);

  // 读滚动（rAF 节流，一帧最多处理一次）
  useLayoutEffect(() => {
    const box = scrollRef?.current || null;
    const target = box || window;
    const getY = () => (box ? box.scrollTop : window.scrollY);
    const getMax = () => (box
      ? box.scrollHeight - box.clientHeight
      : document.documentElement.scrollHeight - window.innerHeight);
    let raf = 0;
    const read = () => {
      raf = 0;
      const y = getY();
      const next = intent.current.update(y, getMax());
      setAtTop(y <= 2);
      setState((prev) => {
        if (prev !== next) onChange.current?.(next);
        return next;
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scrollRef?.current]);

  // 量尺寸 → 胶囊几何（CSS 变量给静止状态用；动画按同一组数字插值，开始和结束都和 CSS 严丝合缝）
  const measure = () => {
    const root = rootRef.current;
    if (!root) return;
    const W = root.offsetWidth;
    const H = root.offsetHeight;
    const pillH = parseFloat(getComputedStyle(root).getPropertyValue('--ch-pill-h')) || PILL_H;
    // 整条状态的玻璃：量探针（和 .ch__glass 的静止样式同一组 CSS 变量）
    const ps = probeRef.current ? getComputedStyle(probeRef.current) : null;
    const px = (v) => parseFloat(v) || 0;
    const bar = ps
      ? { t: px(ps.top), r: px(ps.right), b: px(ps.bottom), l: px(ps.left), rad: px(ps.borderTopLeftRadius) }
      : { t: 0, r: 0, b: 0, l: 0, rad: 0 };
    const barH = Math.max(pillH, H - bar.t - bar.b);
    const titleW = fullRef.current?.offsetWidth || 0;
    const compactW = compactRef.current?.offsetWidth || titleW;
    const pillW = Math.min(W - 32, Math.max(compactW + 36, 120));
    // 胶囊在玻璃条里竖直居中
    const t = bar.t + (barH - pillH) / 2;
    const l = (W - pillW) / 2;
    geo.current = { t, l, r: l, b: H - t - pillH, rad: pillH / 2, bar };
    root.style.setProperty('--ch-pill-w', `${pillW}px`);
    root.style.setProperty('--ch-pill-top', `${t}px`);
    root.style.setProperty('--ch-pill-bottom', `${H - t - pillH}px`);
  };
  useResizeObserver(rootRef, measure);
  useResizeObserver(compactRef, measure);
  useLayoutEffect(measure, []);

  // 状态变了：整条 ↔ 胶囊（同一个进度 p 驱动所有部件；打断时从当前形状、当前速度接着走）
  useLayoutEffect(() => {
    if (shownState.current === state) return;
    shownState.current = state;
    const g = geo.current;
    const root = rootRef.current;
    if (!g || !root) return;
    const parts = [glassRef, edgeRef, shadowRef, titleRef, fullRef, compactRef, leadingRef, trailingRef];
    if (prefersReducedMotion.peek()) {
      // 减弱动态效果：不做形变，直接换状态（CSS 里文字和按钮只淡入淡出）
      for (const r of parts) stopAnimation(r.current, CHANNEL, { commit: false });
      return;
    }
    const cs = getComputedStyle(root);
    const barColor = cs.getPropertyValue('--ch-bar-bg').trim();
    const pillColor = cs.getPropertyValue('--ch-pill-bg').trim();
    const bar = g.bar;
    // 整条状态有没有投影和高光：在页面最顶上（玻璃透明）没有，其他时候有（胶囊一直有）
    const barLift = root.hasAttribute('data-top') ? 0 : 1;
    const lift = ({ p }) => ({ opacity: num(lerp(barLift, 1, clamp(p, 0, 1))) });
    const shape = ({ p }) => {
      const q = Math.max(0, p);
      return {
        top: `${num(lerp(bar.t, g.t, q))}px`,
        right: `${num(lerp(bar.r, g.r, q))}px`,
        bottom: `${num(lerp(bar.b, g.b, q))}px`,
        left: `${num(lerp(bar.l, g.l, q))}px`,
        borderRadius: `${num(lerp(bar.rad, g.rad, clamp(q, 0, 1)))}px`,
      };
    };
    const glass = ({ p }) => {
      const out = shape({ p });
      if (canMix && barColor && pillColor) {
        out.backgroundColor = `color-mix(in srgb, ${pillColor} ${num(clamp(p, 0, 1) * 100, 1)}%, ${barColor})`;
      }
      return out;
    };
    const target = state === 'pill' ? 1 : 0;
    animateSpringGroup([
      [glassRef.current, glass],
      [edgeRef.current, lift],
      [shadowRef.current, ({ p }) => ({ ...shape({ p }), ...lift({ p }) })],
      [titleRef.current, ({ p }) => ({ transform: `scale(${num(1 - 0.12 * p, 4)})` })],
      [fullRef.current, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.35)) })],
      [compactRef.current, ({ p }) => ({ opacity: num(stage(p, 0.25, 0.75)) })],
      [leadingRef.current, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.45)), scale: num(1 - 0.3 * clamp(p, 0, 1), 4) })],
      [trailingRef.current, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.45)), scale: num(1 - 0.3 * clamp(p, 0, 1), 4) })],
    ], {
      channel: CHANNEL,
      current: () => ({ p: 1 - target }),
      to: { p: target },
      spring: 'smooth',
      // 播完回到 CSS 的静止样式（和动画终点一模一样），窗口变宽也不会错位
      commit: 'clear',
    });
  }, [state]);

  function expand() {
    intent.current.forceBar();
    setState('bar');
    onChange.current?.('bar');
  }

  function onTitleClick() {
    if (state === 'pill') {
      expand();
      return;
    }
    const box = scrollRef?.current;
    const behavior = prefersReducedMotion.value ? 'auto' : 'smooth';
    if (box) box.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  }

  const pill = state === 'pill';
  return (
    <header
      ref={rootRef}
      class={cx('ch', position === 'fixed' && 'ch--fixed', !safeArea && 'ch--no-safe', className)}
      data-state={state}
      data-top={atTop ? '' : undefined}
      aria-label={label}
      onFocusIn={() => pill && expand()}
      {...rest}
    >
      <span ref={probeRef} class="ch__probe" aria-hidden="true" />
      <span ref={shadowRef} class="ch__shadow" aria-hidden="true" />
      <span ref={glassRef} class="ch__glass" aria-hidden="true">
        <span ref={edgeRef} class="ch__edge" />
      </span>
      <span class="ch__hairline" aria-hidden="true" />
      <div class="ch__row">
        <div ref={leadingRef} class="ch__side ch__side--leading" inert={pill}>{leading}</div>
        <Pressable
          elRef={titleRef}
          class="ch__title"
          data-press-float=""
          onClick={onTitleClick}
          aria-label={pill ? `展开顶栏：${typeof title === 'string' ? title : ''}` : undefined}
          title={pill ? '展开顶栏' : '回到顶部'}
        >
          <span ref={fullRef} class="ch__title-full">{title}</span>
          <span ref={compactRef} class="ch__title-compact" aria-hidden="true">{compactTitle ?? title}</span>
        </Pressable>
        <div ref={trailingRef} class="ch__side ch__side--trailing" inert={pill}>{trailing}</div>
      </div>
    </header>
  );
}
