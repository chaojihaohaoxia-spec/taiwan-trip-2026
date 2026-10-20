// =====================================================================
// kit/RouteSketch.jsx：路线速写（「杂志纸本」：像在手帐上用铅笔描的路线，没有底图）。
//
//   <RouteSketch sketch={buildSketch(…)} label="这趟的路线：…" />            概览回顾（带地名、第一次出现时一笔一笔画出来）
//   <RouteSketch sketch={…} compact />                                       每天页页头右上角（当天的线）
//
// 每天一条线，颜色是第几天的大地色（--color-day-N，和地图同一套）再往墨色压一点；只有线（圆角拐弯、圆头），
// 不画端点圈和站点（细线 + 圆圈端点像技术图，10-19 评审）。
// 地名是 HTML（不是 SVG 里的字）：字体、字号走 tokens，宽度变了也不跟着缩放。
// 数据在 kit/route-sketch.js（纯函数）。没有能画的线（少于两个点）时什么都不渲染。
// =====================================================================

import './RouteSketch.css';
import { dayTone } from './day-tone.js';

/**
 * @param {{ sketch: ReturnType<import('./route-sketch.js').buildSketch>|null, label?: string, animate?: boolean,
 *           compact?: boolean, class?: string, testId?: string }} props
 */
export function RouteSketch({ sketch, label, animate = false, compact = false, class: className, testId }) {
  if (!sketch?.lines?.some((l) => l.d)) return null;
  const { width: w, height: h } = sketch;
  const cls = ['rsk', compact && 'rsk--compact', className].filter(Boolean).join(' ');
  let order = 0;
  return (
    <figure
      class={cls}
      style={{ aspectRatio: `${w} / ${h}` }}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      data-animate={animate ? '' : undefined}
      data-testid={testId}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        {sketch.lines.map((l) => {
          const i = l.focus && l.d ? order++ : 0;
          return (
            <g key={l.n} class="rsk__day" data-dim={l.focus ? undefined : ''} style={{ '--rsk-c': dayTone(l.n), '--rsk-i': i }}>
              {l.d && <path d={l.d} pathLength={animate ? 1 : undefined} />}
            </g>
          );
        })}
      </svg>
      {sketch.labels.map((a) => (
        <span
          key={a.name}
          class="rsk__label"
          data-side={a.side}
          style={{ left: `${(a.x / w) * 100}%`, top: `${(a.y / h) * 100}%` }}
          aria-hidden="true"
        >
          {a.name}
        </span>
      ))}
    </figure>
  );
}
