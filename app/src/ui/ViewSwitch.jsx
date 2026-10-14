// =====================================================================
// ui/ViewSwitch.jsx：列表 ↔ 网格切换（交互 8）。每个元素从旧位置平滑移到新位置（FLIP），
// 卡片底板拉伸、图片等比裁切放大、文字平移（换行宽时边走边淡出再淡入）——不会被压扁、不会叠在图片上。
//
//   const [view, setView] = useState('list');               // 页面里建议写进查询参数：setQuery({ view })
//   <ViewToggle value={view} onChange={setView} />          // 图标按钮：列表 ↔ 网格图标本身也会变形
//   <ViewSwitch view={view} items={photos} label="相册"
//     renderItem={(p, view) => <ViewCard flipKey={p.id} title={p.title} subtitle={p.date} image={p.url} onClick={…} />} />
//
// ViewSwitch 也会在 items 的顺序 / 增删变化时 FLIP（排序、筛选、新增），离开的元素淡出缩小。
// 自定义卡片：只要把要动的部件标上 data-flip-key（全局唯一）和 data-flip（box / crop / position），
//   不要把整张卡片标成 FLIP（卡片本身不变换，部件各自变换，嵌套才不会出错）。
//   文字用 data-flip="text"：只是挪位置时跟着平移，换了行宽（列表 ↔ 网格）时淡出再淡入。
// 网格列数：手机 2 列，≥768px 3 列，≥1024px 4 列（可用 CSS 变量 --vs-cols 覆盖）。
// =====================================================================

import './ViewSwitch.css';
import { FlipGroup } from './FlipGroup.jsx';
import { IconButton } from './IconButton.jsx';
import { MorphIcon } from './MorphIcon.jsx';
import { Pressable } from './Pressable.jsx';
import { cx } from './util.js';

/**
 * 列表 / 网格切换按钮（图标在两者之间变形）。
 * @param {{ value: 'list'|'grid', onChange: (v: 'list'|'grid') => void, size?: 'sm'|'md'|'lg', variant?: string }} props
 */
export function ViewToggle({ value, onChange, size = 'md', variant = 'fill', ...rest }) {
  const grid = value === 'grid';
  return (
    <IconButton
      label={grid ? '切换为列表' : '切换为网格'}
      variant={variant}
      size={size}
      onClick={() => onChange?.(grid ? 'list' : 'grid')}
      {...rest}
    >
      <MorphIcon kind="view" state={grid} size={size === 'sm' ? 18 : 22} />
    </IconButton>
  );
}

/**
 * 列表 / 网格容器。
 * @param {{ view: 'list'|'grid', items: any[], getKey?: (item: any) => string, renderItem: (item: any, view: string, index: number) => any,
 *           label?: string, options?: object, class?: string }} props
 */
export function ViewSwitch({ view = 'list', items, getKey = (it) => it.id, renderItem, label, options, class: className, ...rest }) {
  const keys = items.map((it) => String(getKey(it)));
  return (
    <FlipGroup
      as="ul"
      class={cx('vs', `vs--${view}`, className)}
      data-view={view}
      aria-label={label}
      trigger={`${view}|${keys.join(',')}`}
      options={{ spring: 'smooth', ...options }}
      {...rest}
    >
      {items.map((it, i) => (
        <li key={keys[i]} class="vs__item">
          {renderItem(it, view, i)}
        </li>
      ))}
    </FlipGroup>
  );
}

/**
 * 标准卡片：缩略图 + 标题 + 说明 + 角标。列表时横排，网格时竖排；三个部件各自 FLIP。
 * @param {{ flipKey: string, title: any, subtitle?: any, meta?: any, image?: string, imageAlt?: string,
 *           placeholder?: any, href?: string, onClick?: (e: Event) => void, class?: string }} props
 */
export function ViewCard({ flipKey, title, subtitle, meta, image, imageAlt = '', placeholder, href, onClick, class: className, ...rest }) {
  return (
    <Pressable as={href ? 'a' : 'button'} href={href} class={cx('vs-card', className)} onClick={onClick} {...rest}>
      <span class="vs-card__bg" data-flip-key={`${flipKey}:bg`} data-flip="box" aria-hidden="true" />
      <span class="vs-card__media" data-flip-key={`${flipKey}:media`} data-flip="crop">
        {image ? <img src={image} alt={imageAlt} loading="lazy" decoding="async" draggable={false} /> : <span class="vs-card__ph" aria-hidden="true">{placeholder}</span>}
      </span>
      <span class="vs-card__text" data-flip-key={`${flipKey}:text`} data-flip="text">
        <span class="vs-card__title">{title}</span>
        {subtitle && <span class="vs-card__subtitle">{subtitle}</span>}
      </span>
      {meta && <span class="vs-card__meta" data-flip-key={`${flipKey}:meta`} data-flip="text">{meta}</span>}
    </Pressable>
  );
}
