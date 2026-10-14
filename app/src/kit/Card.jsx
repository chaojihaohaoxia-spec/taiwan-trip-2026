// =====================================================================
// kit/Card.jsx：内容卡片（样稿概览页的「出发前待办」「天气」「打包清单」那种卡）。
//
//   <Card title="出发前待办" meta="还剩 5 项" footer={<Button variant="secondary" block>查看全部待办</Button>}>…</Card>
//   <Card eyebrow="距离出发还有" action={<Badge tone="success">机票已出票</Badge>}>…</Card>
//   <Card to={{ name: 'ledger', params: { tripId } }} title="今天花了" glyph="wallet">…</Card>   整张可点（链接）
//   <Card onClick={open} title="…">…</Card>                                                 整张可点（按钮）
//
// 外观：卡片材质（--material-card，不开 backdrop-filter）+ 折射描边、圆角 26、内边距 18（样稿 .card）。
// 标题区：眉标（小字大字距）/ 宋体标题（title-3，18px）、右边计数（标签字体）或一个动作；可点的卡片右上角有
//         凸起的白圆箭头（一眼看得出能点），整张卡按下轻轻一缩（data-press）。
// 可点的卡片里不要再放按钮、链接（整张卡已经是一个链接 / 按钮，里面再嵌就是嵌套的可点元素）；要放动作用不可点的卡片 + action / footer。
// onClick 的卡片：外层还是 <section>（标题语义不丢），上面铺一个透明按钮接点击（读屏读 label，没给就读标题）。
// tone：'neutral'（默认；旧写法 'default'）| 'accent'（强调色浅底，给“现在 / 接下来”这类要突出的卡）| 'warning'（警示色描边，给快到期的提醒）。
// =====================================================================

import './Card.css';
import { kitTone } from './tones.js';
import { href as hrefOf } from '../router/index.js';
import { Glyph } from './Glyph.jsx';

/**
 * @param {Object} props
 * @param {any} [props.title]          标题（宋体）
 * @param {any} [props.eyebrow]        标题上方的眉标（或没有标题时单独用）
 * @param {any} [props.meta]           标题区右边的说明（计数、日期）
 * @param {any} [props.action]         标题区右边的一个动作（不可点的卡片才用）
 * @param {string} [props.glyph]       标题前的小图标（kit/glyphs.js 的名字）
 * @param {any} [props.footer]         卡片底部（整行按钮等）
 * @param {object|string} [props.to]   整张卡是站内链接（路由目标）
 * @param {string} [props.href]        整张卡是链接（已经拼好的 #/…）
 * @param {(e: Event) => void} [props.onClick] 整张卡是按钮
 * @param {string} [props.label]       可点的卡片的读屏名字（默认用标题）
 * @param {'neutral'|'accent'|'warning'} [props.tone]  （'default' = 'neutral'）
 * @param {'md'|'sm'|'none'} [props.padding]
 * @param {'section'|'article'|'div'} [props.as]
 * @param {2|3|4} [props.level]        标题的级别（h2 默认）
 * @param {string} [props.class]
 * @param {string} [props.testId]
 */
export function Card({
  title, eyebrow, meta, action, glyph, footer, children, to, href, onClick, label, tone: rawTone, padding = 'md',
  as = 'section', level = 2, class: className, testId, ...rest
}) {
  const tone = kitTone(rawTone);
  const link = to ? hrefOf(to) : href;
  const clickable = Boolean(link || onClick);
  const Heading = `h${level}`;
  const hasHead = title || eyebrow || meta || action || glyph || clickable;
  const cls = [
    'k-card',
    'material-card',
    tone !== 'neutral' && `k-card--${tone}`,
    padding !== 'md' && `k-card--pad-${padding}`,
    clickable && 'k-card--link',
    className,
  ].filter(Boolean).join(' ');

  const head = hasHead && (
    <div class="k-card__head">
      {glyph && <span class="k-card__glyph"><Glyph name={glyph} size={18} /></span>}
      <div class="k-card__titles">
        {eyebrow && <p class="k-card__eyebrow">{eyebrow}</p>}
        {title && <Heading class="k-card__title">{title}</Heading>}
      </div>
      {meta !== undefined && meta !== null && meta !== false && <span class="k-card__meta">{meta}</span>}
      {!clickable && action}
      {clickable && <span class="k-card__chev" aria-hidden="true"><Glyph name="chev-r" size={18} stroke={2.2} /></span>}
    </div>
  );

  const body = (
    <>
      {head}
      {children !== undefined && children !== null && children !== false && <div class="k-card__body">{children}</div>}
      {footer && <div class="k-card__footer">{footer}</div>}
    </>
  );

  if (link) {
    return (
      <a class={cls} href={link} data-press="scale" aria-label={label} data-testid={testId} {...rest}>
        {body}
      </a>
    );
  }
  if (onClick) {
    // 按钮里不能放标题这类块级内容：整张卡放一个铺满的透明按钮（读屏读 label / 标题），按下时整张卡跟着缩
    const name = label || (typeof title === 'string' ? title : typeof eyebrow === 'string' ? eyebrow : undefined);
    const Tag = as;
    return (
      <Tag class={`${cls} k-card--button`} data-testid={testId} {...rest}>
        {body}
        <button type="button" class="k-card__hit" onClick={onClick} data-press="none" aria-label={name} />
      </Tag>
    );
  }
  const Tag = as;
  return (
    <Tag class={cls} data-testid={testId} {...rest}>
      {body}
    </Tag>
  );
}
