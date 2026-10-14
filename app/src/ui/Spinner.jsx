// =====================================================================
// ui/Spinner.jsx：加载转圈（真的在转：整体匀速旋转 + 弧长一呼一吸）。
//
//   <Spinner />                          20px，颜色跟随文字（currentColor）
//   <Spinner size={28} label="正在加载" />  有 label 时 role="status"，读屏会读出来；没有就是纯装饰
//
// 只在加载时渲染（不要常驻页面）；减弱动态效果时只保留慢速旋转，不做弧长变化。
// =====================================================================

import './Spinner.css';
import { cx } from './util.js';

export function Spinner({ size = 20, label, class: className, ...rest }) {
  return (
    <span
      class={cx('spinner', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      style={{ '--spinner-size': `${size}px` }}
      {...rest}
    >
      <svg viewBox="0 0 24 24" class="spinner__svg" aria-hidden="true" focusable="false">
        <circle class="spinner__track" cx="12" cy="12" r="9" />
        <circle class="spinner__arc" cx="12" cy="12" r="9" pathLength="100" />
      </svg>
    </span>
  );
}
