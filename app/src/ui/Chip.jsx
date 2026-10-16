// =====================================================================
// ui/Chip.jsx：小胶囊（筛选、标签）。
//
//   <Chip selected={on} onToggle={setOn}>美食</Chip>              筛选：点了切换，选中是墨色细线框（aria-pressed）
//   <Chip icon={IconMapPin}>3 个地点</Chip>                       只展示（不可点，不加按压）
//   <Chip onRemove={() => remove(tag)}>海边</Chip>                 可删除：右侧 × 按钮（独立的可点区域，中文 label）
//   <Chip onClick={…} count={12}>全部</Chip>                       可点 + 数字
//
// 视觉 44px（sm 32px，可点的用 ::after 把热区扩到 44px）。「杂志纸本」：细线框的纸片；选中是墨色字 + 墨色细线框（没有实心色块、没有对勾）。
// 图标少用（只在比字更快认出时用）。
// =====================================================================

import './Chip.css';
import { Pressable } from './Pressable.jsx';
import { IconX } from './icons.js';
import { cx, renderIcon } from './util.js';

/**
 * @param {{ selected?: boolean, onToggle?: (selected: boolean) => void, onClick?: (e: Event) => void,
 *           onRemove?: () => void, removeLabel?: string, icon?: any, count?: number, disabled?: boolean,
 *           size?: 'sm'|'md', class?: string, children?: any }} props
 */
export function Chip({ selected, onToggle, onClick, onRemove, removeLabel, icon, count, disabled = false, size = 'md', class: className, children, ...rest }) {
  const toggle = onToggle !== undefined || selected !== undefined;
  const interactive = toggle || Boolean(onClick);
  const body = (
    <>
      {icon && <span class="chip__icon">{renderIcon(icon, 15)}</span>}
      <span class="chip__label">{children}</span>
      {count !== undefined && count !== null && <span class="chip__count">{count}</span>}
    </>
  );
  const classes = cx('chip', `chip--${size}`, selected && 'chip--selected', onRemove && 'chip--removable', className);

  if (onRemove) {
    return (
      <span class={classes} {...rest}>
        {interactive ? (
          <Pressable class="chip__main" aria-pressed={toggle ? String(Boolean(selected)) : undefined} disabled={disabled}
            onClick={(e) => { onClick?.(e); if (toggle) onToggle?.(!selected); }}>
            {body}
          </Pressable>
        ) : <span class="chip__main">{body}</span>}
        <Pressable class="chip__remove" aria-label={removeLabel || `删除${typeof children === 'string' ? `「${children}」` : ''}`} disabled={disabled} onClick={onRemove}>
          <IconX size={14} aria-hidden="true" strokeWidth={2.5} />
        </Pressable>
      </span>
    );
  }
  if (!interactive) return <span class={classes} {...rest}>{body}</span>;
  return (
    <Pressable
      class={classes}
      aria-pressed={toggle ? String(Boolean(selected)) : undefined}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (toggle) onToggle?.(!selected);
      }}
      {...rest}
    >
      {body}
    </Pressable>
  );
}
