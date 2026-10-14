// =====================================================================
// ui/IconButton.jsx：圆形图标按钮（必须有中文 label，读屏读它）。
//
//   <IconButton icon={IconSearch} label="搜索" onClick={…} />                   默认：中性填充底
//   <IconButton icon={IconShare} label="分享" variant="tinted" />               强调色浅底 + 强调色图标
//   <IconButton icon={IconPlus} label="记一笔" variant="filled" size="lg" />    强调色实心
//   <IconButton label="菜单" variant="glass"><MorphIcon kind="menu" state={open} /></IconButton>   自定义内容
//
// variant：'fill'（默认）| 'tinted' | 'filled' | 'glass'（悬浮在内容上的玻璃）| 'plain'（透明底，只在
//          周围已经明显是工具栏时用，图标用强调色）。
// size：'sm' 36（热区扩到 44）| 'md' 44 | 'lg' 56。
// 开关型按钮传 pressed（aria-pressed）；展开型传 expanded（aria-expanded）。
// =====================================================================

import './IconButton.css';
import { Pressable } from './Pressable.jsx';
import { cx, renderIcon } from './util.js';

const ICON_SIZE = { sm: 18, md: 22, lg: 24 };

/**
 * @param {{ icon?: any, label: string, variant?: 'fill'|'tinted'|'filled'|'glass'|'plain', size?: 'sm'|'md'|'lg',
 *           pressed?: boolean, expanded?: boolean, badge?: any, class?: string, [key: string]: any }} props
 */
export function IconButton({ icon, label, variant = 'fill', size = 'md', pressed, expanded, badge, class: className, children, ...rest }) {
  if (!label && typeof console !== 'undefined') console.warn('[IconButton] 缺少 label（读屏需要中文名称）');
  return (
    <Pressable
      class={cx('icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : String(Boolean(pressed))}
      aria-expanded={expanded === undefined ? undefined : String(Boolean(expanded))}
      {...rest}
    >
      {children ?? renderIcon(icon, ICON_SIZE[size])}
      {badge}
    </Pressable>
  );
}
