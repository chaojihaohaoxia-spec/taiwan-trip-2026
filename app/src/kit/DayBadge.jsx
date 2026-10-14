// =====================================================================
// kit/DayBadge.jsx：「D1」徽章（第几天）。全站同一种画法、同一套颜色（kit/day-tone.js，视觉评审 P1-2 / P2-8）：
//   <DayBadge n={2} />                 小（22 高，标签字体，账本日期头、列表里）
//   <DayBadge n={2} size="lg" today /> 大（48 见方，宋体，日记每天的头）；today：外面一圈强调色描边
// 颜色：--color-day-N-deep（两种主题都一样的深色调）+ 白字（--color-on-tile ≥ 4.5:1）；n 不合法时灰色。
// 纯展示（aria-hidden 交给调用方：旁边一般已经写了「第 2 天」）。
// =====================================================================

import './DayBadge.css';
import { dayToneDeep } from './day-tone.js';

/**
 * @param {{ n: number, size?: 'sm'|'md'|'lg', today?: boolean, label?: string, class?: string }} props
 *   label：写在 D 后面的字（默认就是 n）
 */
export function DayBadge({ n, size = 'sm', today = false, label, class: className, ...rest }) {
  const cls = ['k-dayb', `k-dayb--${size}`, today && 'k-dayb--today', className].filter(Boolean).join(' ');
  return (
    <span class={cls} style={{ '--k-day': dayToneDeep(n) }} aria-hidden="true" {...rest}>
      D{label ?? n}
    </span>
  );
}
