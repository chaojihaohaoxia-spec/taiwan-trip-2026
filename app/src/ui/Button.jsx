// =====================================================================
// ui/Button.jsx：文字按钮。
//
//   <Button onClick={save}>保存</Button>                                   主要（强调色实心）
//   <Button variant="secondary" leading={IconPlus}>添加</Button>            次要（中性填充）
//   <Button variant="tinted">加入行程</Button>                              强调色浅底
//   <Button variant="outline">查看全部</Button>                             强调色描边
//   <Button variant="text">取消</Button>                                    文字（强调色字，不加底；按下有底色）
//   <Button variant="danger">删除</Button> / variant="danger-soft"           危险
//   <Button size="sm|md|lg" block href="#/t/x">…</Button>                   尺寸、撑满一行、做成链接
//
// 视觉高度 sm 36 / md 44 / lg 52；sm 用 ::after 把可点区域扩到 44。
// 能点的东西一眼看得出能点：每种样式都有底色、描边或强调色文字。
// 提交类按钮（要转圈、对勾）用 ui/SubmitButton.jsx。
// =====================================================================

import './Button.css';
import { Pressable } from './Pressable.jsx';
import { cx, renderIcon } from './util.js';

const ICON_SIZE = { sm: 18, md: 20, lg: 22 };

/**
 * @param {{ variant?: 'primary'|'secondary'|'tinted'|'outline'|'text'|'danger'|'danger-soft', size?: 'sm'|'md'|'lg',
 *           block?: boolean, leading?: any, trailing?: any, href?: string, disabled?: boolean, class?: string,
 *           elRef?: any, [key: string]: any }} props
 */
export function Button({ variant = 'primary', size = 'md', block = false, leading, trailing, href, class: className, children, ...rest }) {
  return (
    <Pressable
      as={href ? 'a' : 'button'}
      href={href}
      class={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className)}
      {...rest}
    >
      {leading && <span class="btn__icon">{renderIcon(leading, ICON_SIZE[size])}</span>}
      {children !== undefined && children !== null && <span class="btn__label">{children}</span>}
      {trailing && <span class="btn__icon">{renderIcon(trailing, ICON_SIZE[size])}</span>}
    </Pressable>
  );
}
