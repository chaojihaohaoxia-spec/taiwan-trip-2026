// =====================================================================
// ui/MorphIcon.jsx：平滑变形的图标（交互 4）。不是“换一张图”，而是 SVG 路径逐帧插值。
//
//   <IconButton label={open ? '关闭菜单' : '打开菜单'} expanded={open} onClick={toggle}>
//     <MorphIcon kind="menu" state={open} />
//   </IconButton>
//
// kind：'menu' 三横线↔× | 'plus' 加号↔× | 'play' 播放↔暂停 | 'view' 列表↔网格 | 'chevron' 向下↔向上 | 'check' 圆圈↔对勾描线
// 弹层的触发按钮（悬浮加号、菜单按钮、行程切换器）和它们的替身按钮也用它：
//   anchorProxy={{ class: 'fab', render: ({ open }) => <MorphIcon kind="plus" state={open} /> }}
// state：false/0 = 第一个样子，true/1 = 第二个样子
// spring：默认按图标定（加号、菜单用 bouncy 多转一点再回来；播放用 snappy；网格、对勾用 smooth）
//
// 实现：进度 p 用 motion/animate.js 的 springValue 驱动（时钟是挂在 <svg> 上的 WAAPI 动画，
// 所以 e2e 能拨到半路截图）；每帧直接改 path 的 d 属性，不触发 Preact 重新渲染。
// Safari 不支持用 CSS 动画 d 属性，所以必须 JS 插值。
// 动画中途改 state：从当前形状、当前速度折返（可打断）。减弱动态效果：160ms 的短补间，不回弹。
// 图标本身 aria-hidden；按钮的 aria-label / aria-expanded 由外层负责。
// =====================================================================

import './MorphIcon.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { springValue, stopAnimation } from '../motion/animate.js';
import { MORPHS, morphFrame, CHECK_PATH } from './morph-shapes.js';
import { cx } from './util.js';

const toP = (state) => (state === true ? 1 : state === false || state === undefined || state === null ? 0 : Number(state) || 0);

/** 把第 p 帧写进 DOM */
function draw(svg, kind, p) {
  if (!svg) return;
  const frame = morphFrame(kind, p);
  if (frame.circle) {
    const check = svg.querySelector('.morph-icon__check');
    if (check) {
      check.style.strokeDashoffset = String(1 - frame.draw);
      check.style.opacity = frame.draw > 0.001 ? '1' : '0';
    }
    svg.style.setProperty('--morph-p', String(frame.draw));
    return;
  }
  const paths = svg.querySelectorAll('.morph-icon__shape');
  frame.forEach((f, i) => {
    const el = paths[i];
    if (!el) return;
    el.setAttribute('d', f.d);
    el.setAttribute('fill-opacity', String(Math.round(f.fillOpacity * 1000) / 1000));
    el.setAttribute('opacity', String(Math.round(f.opacity * 1000) / 1000));
  });
}

function Shapes({ kind, p }) {
  const frame = morphFrame(kind, p);
  if (frame.circle) {
    return (
      <>
        <circle class="morph-icon__ring" cx="12" cy="12" r="9.25" />
        <path class="morph-icon__check" d={CHECK_PATH} pathLength="1" style={{ strokeDashoffset: String(1 - frame.draw), opacity: frame.draw > 0.001 ? '1' : '0' }} />
      </>
    );
  }
  return frame.map((f, i) => (
    <path key={i} class="morph-icon__shape" d={f.d} fill-opacity={f.fillOpacity} opacity={f.opacity} />
  ));
}

/**
 * @param {{ kind?: 'menu'|'plus'|'play'|'view'|'chevron'|'check', state?: boolean|number, size?: number,
 *           spring?: any, strokeWidth?: number, label?: string, class?: string }} props
 */
export function MorphIcon({ kind = 'menu', state = false, size = 24, spring, strokeWidth = 2, label, class: className, ...rest }) {
  const target = toP(state);
  const svgRef = useRef(null);
  // 首次渲染时的进度：JSX 只用它（之后永远不变），动画期间 Preact 不会去改 d 属性
  const initial = useRef({ kind, p: target });
  const shown = useRef(target);
  const drawnKind = useRef(null);
  if (initial.current.kind !== kind) initial.current = { kind, p: target };

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (drawnKind.current !== kind) {
      // 第一次渲染，或换了一种图标（<svg> 按 kind 重建过）：直接停在目标状态，不做动画
      drawnKind.current = kind;
      shown.current = target;
      return;
    }
    springValue(svg, {
      channel: 'morph-icon',
      // 正在变形时从旧动画的当前进度、当前速度接着走；否则从当前显示的进度出发
      current: () => ({ p: shown.current }),
      to: { p: target },
      spring: spring || MORPHS[kind]?.spring || 'bouncy',
      onUpdate: ({ p }) => {
        shown.current = p;
        draw(svg, kind, p);
      },
    });
  }, [target, kind]);

  // 卸载时停掉动画
  useLayoutEffect(() => {
    const svg = svgRef.current;
    return () => stopAnimation(svg, 'morph-icon', { commit: false });
  }, [kind]);

  return (
    <svg
      key={kind}
      ref={svgRef}
      class={cx('morph-icon', `morph-icon--${kind}`, className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke-width={strokeWidth}
      data-kind={kind}
      data-state={target}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      <Shapes kind={initial.current.kind} p={initial.current.p} />
    </svg>
  );
}
