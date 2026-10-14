// =====================================================================
// ui/Badge.jsx：角标与状态标签（只展示，不可点）。
//
//   <Badge tone="success">已确认</Badge>                    状态：neutral / accent / success / warning / danger / info
//   <Badge tone="warning" variant="solid">待付款</Badge>     实心（更醒目）
//   <Badge tone="accent" icon={IconPlane}>航班</Badge>       带图标
//   <CountBadge count={3} />                                红色数字角标；数字变化时弹一下、数字滚动；0 时缩掉
//   <DotBadge tone="danger" />                              小圆点（“有新东西”）
//   <RatingBadge rating={5} />                              评级五档：5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了
//
// 颜色只用设计变量（soft 浅底 + text 字色；solid 实心底 + on- 字色），对比度由 tokens 测试保证。
// =====================================================================

import './Badge.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { RollingNumber } from './RollingNumber.jsx';
import { cx, renderIcon } from './util.js';

/**
 * @param {{ tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info', variant?: 'soft'|'solid'|'outline',
 *           icon?: any, size?: 'sm'|'md', class?: string, children?: any }} props
 */
export function Badge({ tone = 'neutral', variant = 'soft', icon, size = 'md', class: className, children, ...rest }) {
  return (
    <span class={cx('badge', `badge--${tone}`, `badge--${variant}`, `badge--${size}`, className)} {...rest}>
      {icon && <span class="badge__icon">{renderIcon(icon, size === 'sm' ? 12 : 14)}</span>}
      {children}
    </span>
  );
}

/**
 * 数字角标。count ≤ 0 时缩成看不见（仍在 DOM 里，出现 / 消失都有动画）。
 * @param {{ count: number, max?: number, label?: string, class?: string }} props
 *   label：读屏文字，例如 `${count} 条未读`；不给就读数字
 */
export function CountBadge({ count = 0, max = 99, label, class: className, ...rest }) {
  const ref = useRef(null);
  const prev = useRef(count);
  const shown = count > max ? `${max}+` : String(Math.max(0, count));
  useLayoutEffect(() => {
    const el = ref.current;
    const was = prev.current;
    prev.current = count;
    if (!el || was === count || count <= 0 || was <= 0) return;
    // 数字变了：弹一下
    animateSpring(el, {
      channel: 'badge-pop',
      from: { s: 1.28 },
      to: { s: 1 },
      spring: 'bouncy',
      commit: 'clear',
      render: ({ s }) => ({ transform: `scale(${num(s, 4)})` }),
    });
  }, [count]);
  return (
    <span
      ref={ref}
      class={cx('count-badge', count <= 0 && 'count-badge--empty', className)}
      aria-label={count > 0 ? label || shown : undefined}
      aria-hidden={count > 0 ? undefined : 'true'}
      role={count > 0 ? 'status' : undefined}
      {...rest}
    >
      {count > max ? shown : <RollingNumber value={Math.max(1, count)} />}
    </span>
  );
}

/** 小圆点 */
export function DotBadge({ tone = 'danger', class: className, ...rest }) {
  return <span class={cx('dot-badge', `dot-badge--${tone}`, className)} aria-hidden="true" {...rest} />;
}

const RATING_NAMES = { 5: '夯', 4: '顶级', 3: '人上人', 2: 'NPC', 1: '拉完了' };

/** 评级五档（reviews.rating 1–5），实心底白字 */
export function RatingBadge({ rating, class: className, ...rest }) {
  const r = Math.min(5, Math.max(1, Math.round(rating)));
  return (
    <span class={cx('rating-badge', `rating-badge--${r}`, className)} {...rest}>
      {RATING_NAMES[r]}
    </span>
  );
}
