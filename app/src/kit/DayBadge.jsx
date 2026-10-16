// =====================================================================
// kit/DayBadge.jsx：「D1」徽章（第几天）。全站同一种画法（「杂志纸本」：墨色的字，不是色块；今天用海色）：
//   <DayBadge n={2} />                 小（22 高，系统字体，账本日期头、列表里）
//   <DayBadge n={2} size="lg" today /> 大（宋体，日记每天的头）；today：海色字
// 第几天的颜色（kit/day-tone.js 的 --color-day-N）只留给地图，这里不上色。
// 纯展示（aria-hidden 交给调用方：旁边一般已经写了「第 2 天」）。
// =====================================================================

import './DayBadge.css';

/**
 * @param {{ n: number, size?: 'sm'|'md'|'lg', today?: boolean, label?: string, class?: string }} props
 *   label：写在 D 后面的字（默认就是 n）
 */
export function DayBadge({ n, size = 'sm', today = false, label, class: className, ...rest }) {
  const cls = ['k-dayb', `k-dayb--${size}`, today && 'k-dayb--today', className].filter(Boolean).join(' ');
  return (
    <span class={cls} aria-hidden="true" {...rest}>
      D{label ?? n}
    </span>
  );
}
