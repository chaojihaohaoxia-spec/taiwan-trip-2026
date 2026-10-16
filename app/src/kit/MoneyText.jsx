// =====================================================================
// kit/MoneyText.jsx：金额的显示版（lib/money.js 的 formatMoney / moneyParts 套上样式）。
//
//   <MoneyText amount={400000} currency="VND" />                    400,000₫（约 HK$121）   正文大小，括号部分次要色小字
//   <MoneyText amount={2625.63} currency="CNY" size="2xl" />        结算大字（系统字体等宽数字），「约 HK$…」换到下一行
//   <MoneyText amount={5251.25} currency="CNY" size="2xl" serif />  主数字（账本总额）：Instrument Serif
//   <MoneyText amount={450000} currency="VND" readable />           45 万越南盾（约 HK$136）
//   <MoneyText amount={-120} currency="HKD" signed />               −HK$120（负数红、正数绿；signed 时正数前面加 +）
//   <MoneyText amount={…} currency="VND" hkd="none" />              不标港币
//   <MoneyText amount={…} currency="VND" fx={snapshot} />           用实时汇率估算港币
//
// size：'sm' 13 · 'md' 15（默认，列表右边的金额）· 'lg' 22 · 'xl' 27 · '2xl' 40 · '3xl' 48（后四档是大号数字，
//       账本的结算金额、记一笔的金额）。serif：用 Instrument Serif（全站只有账本总额这类主数字用）。
// hkd：'auto'（默认：sm / md 跟在后面、大号换到下一行）· 'inline' · 'below' · 'none'。港币本身、0、不支持的币种自动不标。
// tone：'auto'（默认：signed 时正绿负红，否则正文色）· 'none' / 'neutral' · 'positive' / 'success' · 'negative' / 'danger' · 'muted'。
// 文字和 formatMoney 一字不差（inline 时「400,000₫（约 HK$121）」），读屏、复制都是同一串；换行显示时括号去掉。
// =====================================================================

import './MoneyText.css';
import { moneyView } from './money-view.js';

/**
 * @param {Object} props
 * @param {number} props.amount
 * @param {string} props.currency
 * @param {'sm'|'md'|'lg'|'xl'|'2xl'|'3xl'} [props.size]
 * @param {'auto'|'inline'|'below'|'none'} [props.hkd]
 * @param {boolean} [props.readable]   越南盾用“万”
 * @param {object} [props.fx]          汇率快照（lib/services/fx.js）
 * @param {number} [props.hkdValue]    已经算好的折合港币（记账时记下的 amount_home；给了就不再按汇率估）
 * @param {boolean} [props.signed]     正数前面加 +
 * @param {'auto'|'none'|'neutral'|'positive'|'success'|'negative'|'danger'|'muted'} [props.tone]
 * @param {'start'|'end'} [props.align] 两行时左对齐还是右对齐（列表右边的金额用 end）
 * @param {boolean} [props.serif]       主数字用 Instrument Serif（账本总额）
 * @param {string} [props.class]
 */
export function MoneyText({
  amount, currency, size = 'md', hkd = 'auto', readable = false, fx = null, signed = false, tone = 'auto', align = 'start', hkdValue = null,
  serif = false, class: className, ...rest
}) {
  const v = moneyView(amount, currency, { size, hkd, readable, fx, signed, tone, hkdValue });
  const n = Number(amount);
  const cls = [
    'k-money',
    `k-money--${size}`,
    v.figure && 'k-money--figure',
    v.figure && serif && 'k-money--serif',
    v.hkdWhere === 'below' && 'k-money--stack',
    align === 'end' && 'k-money--end',
    v.tone && `k-money--${v.tone}`,
    className,
  ].filter(Boolean).join(' ');
  return (
    <span class={cls} data-amount={Number.isFinite(n) ? n : undefined} data-currency={currency} {...rest}>
      <span class="k-money__main">
        {v.number}
        {v.unit && <span class="k-money__unit">{v.unit}</span>}
      </span>
      {v.hkd && <span class="k-money__hkd">{v.hkdWhere === 'inline' ? `（${v.hkd}）` : v.hkd}</span>}
    </span>
  );
}
