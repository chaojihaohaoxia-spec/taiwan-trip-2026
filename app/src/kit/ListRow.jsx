// =====================================================================
// kit/ListRow.jsx：列表行、信息行、分隔线。
//
//   ListRow（可点或只看的一行；样稿账本流水、地点列表）：
//     <ListRow leading={<KindIcon type="expense" kind="餐饮" tile />} title="夜市烤海鲜" subtitle="1月10日 · Jeremy 付"
//              value={<MoneyText amount={520000} currency="VND" align="end" />} to={{ name: 'ledger', params }} />
//     <ListRow title="联系人" subtitle="17 位" glyph="user" onClick={…} />        glyph：左边自动放一个图标（「杂志纸本」不显示前导图标，见 ListRow.css）
//     <ListRow title="已跳过的条目" dim />                                           完成 / 跳过的淡化
//   有 to / href / onClick 时整行可点：右边带箭头（chevron={false} 可去掉）、按下换底色；没有就是只看的一行。
//   行与行之间有 1px 分隔线；最少 44 高，有副标题 56 高；行尾的箭头是灰色小箭头。
//
//   InfoRow（只看的信息；样稿时间轴展开后的「Google 5.0」「约 45 万越南盾/人」「开到 23:00」「地址」）：
//     <InfoRow glyph="clock">开到 23:00</InfoRow>                    图标 + 一段字（灰色小图标，13px 字）
//     <InfoRow label="订单号" pair><CopyText text="DEMO-FL01" mono /></InfoRow>   左标签、右值（设置页、预订详情）
//
//   Divider：<Divider />、<Divider inset />（从文字处开始）、<Divider label="备选方案" />（中间带字）
// =====================================================================

import './ListRow.css';
import { kitTone } from './tones.js';
import { href as hrefOf } from '../router/index.js';
import { Glyph } from './Glyph.jsx';

/**
 * @param {Object} props
 * @param {any} props.title
 * @param {any} [props.subtitle]
 * @param {any} [props.leading]      左边的东西（KindIcon tile、Avatar……）
 * @param {string} [props.glyph]     没给 leading 时：左边放这个图形的方块
 * @param {any} [props.value]        右边的值（金额、计数、状态）
 * @param {boolean} [props.chevron]  右边的箭头（可点时默认有）
 * @param {object|string} [props.to] 站内链接（路由目标）
 * @param {string} [props.href]
 * @param {(e: Event) => void} [props.onClick]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.dim]      淡化（完成 / 跳过 / 已取消）
 * @param {'neutral'|'accent'|'danger'} [props.tone]  标题颜色（'default' = 'neutral'）
 * @param {boolean} [props.wrap]     标题可以折行（默认最多两行）
 * @param {string} [props.class]
 * @param {string} [props.testId]
 */
export function ListRow({
  title, subtitle, leading, glyph, value, chevron, to, href, onClick, disabled = false, dim = false, tone: rawTone,
  wrap = false, class: className, testId, children, ...rest
}) {
  const tone = kitTone(rawTone);
  const link = !disabled && to ? hrefOf(to) : href;
  const interactive = Boolean((link || onClick) && !disabled);
  const showChevron = chevron ?? interactive;
  const lead = leading || (glyph ? <span class="k-row__glyph"><Glyph name={glyph} size={20} /></span> : null);
  const cls = [
    'k-row',
    lead && 'k-row--lead',
    subtitle && 'k-row--two',
    interactive && 'k-row--link',
    dim && 'k-row--dim',
    tone !== 'neutral' && `k-row--${tone}`,
    wrap && 'k-row--wrap',
    className,
  ].filter(Boolean).join(' ');
  const inner = (
    <>
      {lead && <span class="k-row__lead">{lead}</span>}
      <span class="k-row__text">
        <span class="k-row__title">{title}</span>
        {subtitle && <span class="k-row__sub">{subtitle}</span>}
        {children}
      </span>
      {value !== undefined && value !== null && value !== false && <span class="k-row__value">{value}</span>}
      {showChevron && <span class="k-row__chev" aria-hidden="true"><Glyph name="chev-r" size={15} stroke={2.2} /></span>}
    </>
  );
  if (link && !disabled) {
    return <a class={cls} href={link} data-press="highlight" data-testid={testId} {...rest}>{inner}</a>;
  }
  if (onClick) {
    return (
      <button type="button" class={cls} onClick={onClick} disabled={disabled} data-press="highlight" data-testid={testId} {...rest}>
        {inner}
      </button>
    );
  }
  return <div class={cls} data-testid={testId} {...rest}>{inner}</div>;
}

/**
 * @param {{ glyph?: string, label?: any, pair?: boolean, tone?: 'neutral'|'warning'|'danger'|'muted', class?: string, children?: any }} props
 *   tone：'neutral'（默认；旧写法 'default'）/ 'warning' / 'danger' / 'muted'（次要色）
 */
export function InfoRow({ glyph, label, pair = false, tone: rawTone, class: className, children, ...rest }) {
  const tone = kitTone(rawTone);
  const cls = ['k-info', pair && 'k-info--pair', tone !== 'neutral' && `k-info--${tone}`, className].filter(Boolean).join(' ');
  return (
    <div class={cls} {...rest}>
      {glyph && <span class="k-info__glyph" aria-hidden="true"><Glyph name={glyph} size={16} /></span>}
      {label && <span class="k-info__label">{label}</span>}
      <span class="k-info__value">{children}</span>
    </div>
  );
}

/**
 * @param {{ inset?: boolean, label?: any, class?: string }} props
 */
export function Divider({ inset = false, label, class: className, ...rest }) {
  const cls = ['k-div', inset && 'k-div--inset', label && 'k-div--label', className].filter(Boolean).join(' ');
  if (label) {
    return (
      <div class={cls} role="separator" {...rest}>
        <span>{label}</span>
      </div>
    );
  }
  return <hr class={cls} {...rest} />;
}
