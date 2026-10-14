// =====================================================================
// ui/Skeleton.jsx：加载占位（骨架屏）。形状尽量和真实内容一致，加载完内容淡入替换，不跳版。
//
//   <Skeleton variant="text" lines={3} />                  几行字（最后一行短一点）
//   <Skeleton variant="circle" size={40} />                头像
//   <Skeleton variant="rect" height={120} radius="lg" />   图片、卡片
//   <SkeletonCard />                                       常用组合：缩略图 + 两行字
//   <Reveal loading={isLoading} skeleton={<SkeletonCard />}>…真实内容…</Reveal>   加载完交叉淡入
//
// 微光（一道亮光扫过）只在加载时出现；减弱动态效果时不扫，静态占位。整个骨架 aria-hidden，
// 加载状态请由外层用 aria-busy 告诉读屏。
// =====================================================================

import './Skeleton.css';
import { cx } from './util.js';

const px = (v) => (typeof v === 'number' ? `${v}px` : v);

/**
 * @param {{ variant?: 'text'|'rect'|'circle', lines?: number, width?: number|string, height?: number|string,
 *           size?: number, radius?: 'xs'|'sm'|'md'|'lg'|'xl'|'pill', class?: string }} props
 */
export function Skeleton({ variant = 'text', lines = 1, width, height, size, radius, class: className, ...rest }) {
  if (variant === 'text') {
    return (
      <span class={cx('skel-lines', className)} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            class="skel skel--text"
            style={{ width: i === lines - 1 && lines > 1 ? '62%' : px(width) || '100%' }}
          />
        ))}
      </span>
    );
  }
  const style = variant === 'circle'
    ? { width: px(size ?? 40), height: px(size ?? 40) }
    : { width: px(width) || '100%', height: px(height ?? 96), ...(radius ? { borderRadius: `var(--radius-${radius})` } : {}) };
  return <span class={cx('skel', `skel--${variant}`, className)} style={style} aria-hidden="true" {...rest} />;
}

/** 常用组合：左边缩略图 + 右边两行字 */
export function SkeletonCard({ class: className, ...rest }) {
  return (
    <div class={cx('skel-card', className)} aria-hidden="true" {...rest}>
      <Skeleton variant="rect" width={56} height={56} radius="md" />
      <div class="skel-card__text">
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="45%" />
      </div>
    </div>
  );
}

/**
 * 加载中显示骨架，加载完交叉淡入真实内容（叠在同一格里，高度取两者较大的，不跳版）。
 * @param {{ loading: boolean, skeleton: any, children?: any, class?: string }} props
 */
export function Reveal({ loading, skeleton, children, class: className, ...rest }) {
  return (
    <div class={cx('reveal', className)} data-loading={loading ? '' : undefined} aria-busy={loading ? 'true' : 'false'} {...rest}>
      <div class="reveal__skeleton" aria-hidden="true">{skeleton}</div>
      <div class="reveal__content" inert={loading}>{children}</div>
    </div>
  );
}
