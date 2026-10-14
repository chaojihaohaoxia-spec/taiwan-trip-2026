// =====================================================================
// ui/Checkbox.jsx：勾选框（打包清单、待办）。勾上时底色从中心弹出来、对勾一笔描出来；
// 取消时对勾先收回、底色缩掉。整行都能点（label 包着原生 checkbox，读屏和键盘都是原生的）。
//
//   <Checkbox checked={done} onChange={setDone} label="护照" description="放随身包" strike />
//   <Checkbox shape="square" indeterminate label="全选" … />
//
// 属性：checked、onChange(checked)、label、description、shape 'circle'（默认，像提醒事项）| 'square'、
//      strike（勾上后文字划掉、变次要色：线从左往右画过去）、indeterminate（半选：一条横线）、disabled、
//      variant 'row'（整行高亮式按压，默认）| 'inline'（只有框和文字，不占整行）。
// =====================================================================

import './Checkbox.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { usePress } from '../motion/hooks.js';
import { cx, useId } from './util.js';
import '../motion/press.css';

/**
 * @param {{ checked: boolean, onChange?: (checked: boolean) => void, label?: any, description?: any,
 *           shape?: 'circle'|'square', strike?: boolean, indeterminate?: boolean, disabled?: boolean,
 *           variant?: 'row'|'inline', class?: string, name?: string, value?: string }} props
 */
export function Checkbox({
  checked = false, onChange, label, description, shape = 'circle', strike = false, indeterminate = false,
  disabled = false, variant = 'row', class: className, name, value, ...rest
}) {
  const rowRef = useRef(null);
  const inputRef = useRef(null);
  const descId = useId('check-desc');
  usePress(rowRef, { feedback: variant === 'row' ? 'highlight' : 'none', disabled });

  // indeterminate 只能用属性设
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  const state = indeterminate ? 'mixed' : checked ? 'on' : 'off';
  return (
    <label
      ref={rowRef}
      class={cx('check', `check--${shape}`, `check--${variant}`, strike && 'check--strike', disabled && 'check--disabled', className)}
      data-press={variant === 'row' ? 'highlight' : 'none'}
      data-state={state}
      {...rest}
    >
      <input
        ref={inputRef}
        class="check__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        aria-describedby={description ? descId : undefined}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
      />
      <span class="check__box" aria-hidden="true">
        <span class="check__fill" />
        <svg class="check__mark" viewBox="0 0 24 24" focusable="false">
          <path class="check__tick" d="M6.5 12.6 L10.4 16.4 L17.6 8.4" pathLength="1" />
          <path class="check__dash" d="M7 12 L17 12" pathLength="1" />
        </svg>
      </span>
      {(label || description) && (
        <span class="check__text">
          {label && <span class="check__label">{label}</span>}
          {description && <span class="check__desc" id={descId}>{description}</span>}
        </span>
      )}
    </label>
  );
}
