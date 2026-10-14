// =====================================================================
// kit/SectionHeader.jsx：页面里的段标题（样稿「四天安排」「备选和提醒」）。
//
//   <SectionHeader title="四天安排" count={4} />
//   <SectionHeader title="备选池" meta="还没排进哪天的条目" action={{ label: '全部地点', to: { name: 'places', params } }} />
//   <SectionHeader title="打包" action={<ViewToggle … />} />          右边放任意组件
//
// 宋体 title-2（21px，字距 .04em），计数跟在标题后面（标签字体、次要色）；meta 是标题下面一行小字说明。
// action：{ label, to | href | onClick, glyph? } 渲染成强调色文字按钮（右边带小箭头，可点区域 ≥44px）；也可以直接给组件。
// 上下留白照样稿：上 26、下 12（第一个段标题上面不留白）。
// =====================================================================

import './SectionHeader.css';
import { href as hrefOf } from '../router/index.js';
import { Glyph } from './Glyph.jsx';

function ActionLink({ label, to, href, onClick, glyph = 'chev-r', testId }) {
  const link = to ? hrefOf(to) : href;
  const inner = (
    <>
      <span>{label}</span>
      <Glyph name={glyph} size={16} stroke={2.2} />
    </>
  );
  if (link) return <a class="k-sec__action" href={link} data-press="scale" data-testid={testId}>{inner}</a>;
  return <button type="button" class="k-sec__action" onClick={onClick} data-press="scale" data-testid={testId}>{inner}</button>;
}

/**
 * @param {{ title: any, count?: number|string, meta?: any, action?: any, level?: 2|3|4, id?: string, class?: string }} props
 */
export function SectionHeader({ title, count, meta, action, level = 2, id, class: className, ...rest }) {
  const Heading = `h${level}`;
  const actionNode = action && typeof action === 'object' && 'label' in action && !('type' in action) ? <ActionLink {...action} /> : action;
  return (
    <header class={className ? `k-sec ${className}` : 'k-sec'} {...rest}>
      <div class="k-sec__titles">
        <Heading class="k-sec__title" id={id}>
          {title}
          {count !== undefined && count !== null && <span class="k-sec__count">{count}</span>}
        </Heading>
        {meta && <p class="k-sec__meta">{meta}</p>}
      </div>
      {actionNode}
    </header>
  );
}
