// =====================================================================
// ui/Avatar.jsx：头像。有图用图，没图用名字首字 + 按名字固定的颜色（同一个人永远同一个色）。
//
//   <Avatar name="Jeremy" />                         首字母 J
//   <Avatar name="Cathy" src={url} size="lg" />      图片（加载失败自动退回首字）
//   <Avatar name="Jeremy" status="online" />         右下角状态点（online / busy）
//   <AvatarGroup names={['Jeremy', 'Cathy']} max={3} />   叠在一起，超出显示 +N
//
// size：'xs' 24 | 'sm' 32 | 'md' 40（默认）| 'lg' 56 | 'xl' 80。
// 颜色用分类色 --color-cat-*（跳过对白字不友好的 cat-2），文字用 --color-text-inverse（浅色模式白字、深色模式深字）；
// 传了 color（成员数据里的颜色 #hex，或 CSS 值）就用它——同一个人在头像、成员芯片、评级里同一个颜色（视觉评审 P2-5）。
// =====================================================================

import './Avatar.css';
import { useState } from 'preact/hooks';
import { cx } from './util.js';

const PALETTE = [1, 3, 4, 5, 6, 7, 8];

/** 名字 → 分类色编号（稳定的简单哈希） */
export function avatarColorIndex(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 名字 → 显示的首字（中文取第一个字，英文取首字母大写） */
export function initialsOf(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const first = [...s][0];
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

/**
 * @param {{ name: string, src?: string, size?: 'xs'|'sm'|'md'|'lg'|'xl', status?: 'online'|'busy', ring?: boolean,
 *           decorative?: boolean, color?: string, class?: string }} props
 *   decorative：旁边已经写了名字时设 true（读屏不重复读）；color：成员的颜色（没有就按名字取一个分类色）
 */
export function Avatar({ name, src, size = 'md', status, ring = false, decorative = false, color, class: className, ...rest }) {
  const [failed, setFailed] = useState(false);
  const showImg = src && !failed;
  return (
    <span
      class={cx('avatar', `avatar--${size}`, ring && 'avatar--ring', className)}
      style={{ '--avatar-color': color || `var(--color-cat-${avatarColorIndex(name)})` }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? 'true' : undefined}
      {...rest}
    >
      {showImg ? (
        <img class="avatar__img" src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span class="avatar__initials" aria-hidden="true">{initialsOf(name)}</span>
      )}
      {status && <span class={cx('avatar__status', `avatar__status--${status}`)} aria-hidden="true" />}
    </span>
  );
}

/**
 * 头像叠放。
 * @param {{ names: string[], srcs?: Record<string, string>, max?: number, size?: 'xs'|'sm'|'md'|'lg', label?: string }} props
 */
export function AvatarGroup({ names, srcs = {}, max = 3, size = 'sm', label, class: className, ...rest }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span class={cx('avatar-group', `avatar-group--${size}`, className)} role="group" aria-label={label || names.join('、')} {...rest}>
      {shown.map((n) => <Avatar key={n} name={n} src={srcs[n]} size={size} ring decorative />)}
      {extra > 0 && <span class={cx('avatar', `avatar--${size}`, 'avatar--ring', 'avatar--more')} aria-hidden="true">+{extra}</span>}
    </span>
  );
}
