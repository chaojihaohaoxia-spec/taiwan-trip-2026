// =====================================================================
// kit/KindIcon.jsx：种类图标——条目 / 地点 / 预订 / 联系人 / 记账分类 / 交通方式 / 清单 / 贴士 → 线条图标。
//
//   <KindIcon type="item" kind="food" />                       只有图标（22px，装饰）
//   <KindIcon type="expense" kind="餐饮" tile />               放在 40px 的浅色圆角方块里（样稿账本、打包清单的图标格）
//   <KindIcon type="place" kind="hub" tile="sm" labelled />    34px 方块；labelled = 读屏读出种类名「交通站点」
//   <KindIcon {...result.icon} tile />                          搜索结果（kit/search 的 icon: { type, kind }）
//
// 种类 → 图形、中文名在 kit/kinds.js（不认识的 kind 退回这一类的“其他”）；图形是 kit/glyphs.js 那套样稿笔法。
// tile：true / 'md' 40px（图标 20）、'sm' 34px（18）、'xs' 30px（16）、'lg' 48px（24）；圆角 --radius-tile（和样稿 13px 一致）。
// tone：'accent'（默认：浅灰底 + 强调色图标）、'soft'（强调色浅底）、'solid'（强调色实心底 + 白图标）、'neutral'（浅灰底 + 次要色图标）。
// =====================================================================

import './KindIcon.css';
import { Glyph } from './Glyph.jsx';
import { kindGlyph, kindLabel } from './kinds.js';

const TILE = { xs: [30, 16], sm: [34, 18], md: [40, 20], lg: [48, 24] };

/**
 * @param {{ type: string, kind?: string, size?: number, tile?: boolean|'xs'|'sm'|'md'|'lg',
 *           tone?: 'accent'|'soft'|'solid'|'neutral', labelled?: boolean, class?: string }} props
 */
export function KindIcon({ type, kind, size, tile = false, tone = 'accent', labelled = false, class: className, ...rest }) {
  const name = kindGlyph(type, kind);
  const label = labelled ? kindLabel(type, kind) : undefined;
  if (!tile) {
    return <Glyph name={name} size={size || 22} title={label} class={className} data-kind={kind} {...rest} />;
  }
  const [box, icon] = TILE[tile === true ? 'md' : tile] || TILE.md;
  return (
    <span
      class={`k-tile k-tile--${tone}${className ? ` ${className}` : ''}`}
      style={{ '--k-tile': `${box}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      data-kind={kind}
      {...rest}
    >
      <Glyph name={name} size={size || icon} />
    </span>
  );
}
