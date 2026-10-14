// =====================================================================
// overlay/parts.jsx：几种弹层共用的小部件。
//
//   CloseButton    圆形 × 按钮（视觉 30px，触控区用 ::after 扩到 44px），aria-label「关闭」
//   AnchorProxy    “替身按钮”：从按钮长出来的面板 / 全屏菜单打开时，在触发按钮原来的位置
//                  画一个一模一样的按钮（用同样的 class），浮在遮罩上面，里面的图标同步变形
//                  （加号转 ×、三横线转 ×）；点它关闭。真按钮这期间透明（不重复显示）。
//                  替身出现时接着真按钮此刻的按压回弹继续弹（startScale：弹层在藏起真按钮之前读好的缩放；
//                  motion/press-handoff.js），不会从 0.96 一下子跳到 1。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { continuePressFrom } from '../motion/press-handoff.js';
import { IconX } from '../ui/icons-core.js';

/**
 * @param {{ onClick: (e: Event) => void, label?: string, class?: string, testId?: string }} props
 */
export function CloseButton({ onClick, label = '关闭', class: cls = '', testId }) {
  return (
    <button type="button" class={`ov-close ${cls}`} data-press="scale" aria-label={label} onClick={onClick} data-testid={testId}>
      <IconX size={18} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

/**
 * @typedef {Object} AnchorProxyOptions
 * @property {string} [class]   和真按钮相同的 class（替身靠它长得一模一样；样式别依赖父元素）
 * @property {(state: { open: boolean }) => any} [render]  按钮里的内容（例如 <MorphIcon kind="plus" state={open} />）
 * @property {string} [label]   打开时替身的 aria-label（默认「关闭」）
 */

/**
 * @param {{ rect: {left:number,top:number,width:number,height:number}|null, options: AnchorProxyOptions,
 *           open: boolean, onClick: () => void, proxyRef?: any, startScale?: number, testId?: string }} props
 *   startScale：真按钮此刻的按压缩放（motion/press-handoff.js 的 pressScaleOf，在藏起真按钮之前读）
 */
export function AnchorProxy({ rect, options, open, onClick, proxyRef, startScale = 1, testId }) {
  if (!rect || !options) return null;
  return <AnchorProxyButton rect={rect} options={options} open={open} onClick={onClick} proxyRef={proxyRef} startScale={startScale} testId={testId} />;
}

function AnchorProxyButton({ rect, options, open, onClick, proxyRef, startScale, testId }) {
  // 替身刚出现时和真按钮长得一模一样（关着的样子），下一次样式计算之后再切到“开着”，
  // 这样里面的图标会真的从加号转成 ×（直接以 × 出现就没有变形了）
  const [shown, setShown] = useState(false);
  const own = useRef(null);
  useLayoutEffect(() => {
    if (shown === open) return;
    document.body.getBoundingClientRect(); // 强制算一次样式：让 CSS 过渡有“变化前”的状态
    setShown(open);
  }, [open, shown]);
  // 刚出现：接着真按钮的按压回弹继续弹（真按钮这时正从 0.96 弹回 1）
  useLayoutEffect(() => {
    continuePressFrom(own.current, startScale);
  }, []);
  const setRef = (el) => {
    own.current = el;
    if (typeof proxyRef === 'function') proxyRef(el);
    else if (proxyRef) proxyRef.current = el;
  };
  const style = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    // 真按钮可能用 transform / translate 定位（例如居中）；替身已经按实际矩形放好，清掉它们。
    // 按压反馈用独立的 scale 属性，不受这里影响。
    transform: 'none',
    translate: 'none',
    rotate: 'none',
    boxSizing: 'border-box',
  };
  return (
    <button
      ref={setRef}
      type="button"
      class={`ov-anchor-proxy ${options.class || ''}`}
      data-press="scale"
      data-press-float=""
      style={style}
      aria-label={options.label || '关闭'}
      aria-expanded={open ? 'true' : 'false'}
      data-testid={testId}
      onClick={onClick}
    >
      {options.render ? options.render({ open: shown }) : null}
    </button>
  );
}
