// =====================================================================
// dev/demos/SpringsDemo.jsx：三条弹簧的实际效果 + 曲线图。
// 点“播放”小圆点从左滑到右（CSS transition 用 --spring-*），再点滑回来；动画进行中再点会
// 从当前位置折返（CSS transition 天然可打断）。e2e 的“截动画半路”工具用这里做自检。
// =====================================================================

import { useState } from 'preact/hooks';
import { SPRINGS, SPRING_NAMES, springToLinear } from '../../motion/springs.js';
import { prefersReducedMotion } from '../../motion/reduced-motion.js';

const LABELS = { snappy: '干脆 snappy', bouncy: '弹跳 bouncy', smooth: '顺滑 smooth' };

function Curve({ name }) {
  const { points, durationMs } = springToLinear(SPRINGS[name]);
  const W = 120;
  const H = 64;
  const pad = 8;
  const maxY = Math.max(1, ...points.map(([, y]) => y));
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${(pad + x * (W - pad * 2)).toFixed(1)} ${(H - pad - (y / maxY) * (H - pad * 2)).toFixed(1)}`).join(' ');
  const oneY = H - pad - (1 / maxY) * (H - pad * 2);
  return (
    <svg class="dev-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} 曲线，时长 ${durationMs} 毫秒`}>
      <line x1={pad} x2={W - pad} y1={oneY} y2={oneY} class="dev-curve__guide" />
      <path d={d} class="dev-curve__line" />
    </svg>
  );
}

export default function SpringsDemo() {
  const [on, setOn] = useState(false);
  return (
    <div class="dev-springs" data-on={on ? 'true' : 'false'}>
      <div class="dev-buttons">
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" data-testid="springs-toggle" aria-pressed={on} onClick={() => setOn(!on)}>
          {on ? '滑回去' : '播放'}
        </button>
        {prefersReducedMotion.value && <span class="dev-section__note">系统开了“减弱动态效果”：弹簧换成短缓出。</span>}
      </div>
      {SPRING_NAMES.map((name) => (
        <div key={name} class="dev-spring">
          <div class="dev-spring__meta">
            <b>{LABELS[name]}</b>
            <code>--spring-{name}</code>
          </div>
          <Curve name={name} />
          <div class="dev-spring__track">
            <span class={`dev-spring__dot dev-spring__dot--${name}`} data-testid={`spring-dot-${name}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
