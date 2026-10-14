// =====================================================================
// kit/money-view.js：金额显示的拆分规则（kit/MoneyText.jsx 用；纯函数，Node 里能直接测）。
//
//   moneyView(400000, 'VND')                        → { main: '400,000₫', number: '400,000₫', unit: null, hkd: '约 HK$121', hkdWhere: 'inline', tone: null, figure: false }
//   moneyView(12360000, 'VND', { readable: true, size: '3xl' }) → { number: '1236', unit: '万越南盾', hkdWhere: 'below', … }
//   moneyView(-120, 'HKD', { signed: true })         → { main: '−HK$120', tone: 'negative', … }
//
// 规则：文字和 lib/money.js 的 formatMoney 一字不差（hkd 跟在后面时括号是全角）；
// 大号数字（lg / xl / 2xl / 3xl）时「约 HK$…」换到下一行，中文单位（「万越南盾」）单独拆出来用小一号的宋体；
// signed：正数前面加 +，语气正绿负红（tone 'auto' 时）；0、港币本身、不支持的币种不标港币。
// =====================================================================

import { moneyParts } from '../lib/money.js';

export const MONEY_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl', '2xl', '3xl']);
export const FIGURE_SIZES = Object.freeze(['lg', 'xl', '2xl', '3xl']);

/** 「1236 万越南盾」→ ['1236', '万越南盾']；没有中文单位返回 null */
const UNIT = /^([^一-鿿]*?)\s*([一-鿿].*)$/;

/**
 * @param {number} amount
 * @param {string} currency
 * @param {{ size?: string, hkd?: 'auto'|'inline'|'below'|'none', readable?: boolean, fx?: object|null, signed?: boolean,
 *           tone?: 'auto'|'none'|'positive'|'negative'|'muted'|'success'|'danger'|'neutral' }} [o]
 * @returns {{ main: string, number: string, unit: string|null, hkd: string|null, hkdWhere: 'inline'|'below'|'none',
 *             tone: string|null, figure: boolean, text: string }}
 *   text：读出来 / 复制出来的完整文字（inline 时就是 formatMoney 的结果）
 */
export function moneyView(amount, currency, { size = 'md', hkd = 'auto', readable = false, fx = null, signed = false, tone = 'auto', hkdValue = null } = {}) {
  const n = Number(amount);
  const parts = moneyParts(amount, currency, { readable, fx, hkdValue });
  const figure = FIGURE_SIZES.includes(size);
  const plus = signed && n > 0 ? '+' : '';
  const main = `${plus}${parts.main}`;
  const where = !parts.hkd || hkd === 'none' ? 'none' : hkd === 'auto' ? (figure ? 'below' : 'inline') : hkd;
  const m = figure ? UNIT.exec(main) : null;
  // 全站语气词也认：'success' = 'positive'（正数绿）、'danger' = 'negative'（负数红）
  const given = { success: 'positive', danger: 'negative', neutral: 'none' }[tone] || tone;
  const t = given === 'auto' ? (signed && n > 0 ? 'positive' : signed && n < 0 ? 'negative' : null) : given === 'none' ? null : given;
  return {
    main,
    number: m && m[1] ? m[1] : main,
    unit: m && m[1] ? m[2] : null,
    hkd: where === 'none' ? null : parts.hkd,
    hkdWhere: where,
    tone: t,
    figure,
    text: where === 'inline' ? `${main}（${parts.hkd}）` : where === 'below' ? `${main} ${parts.hkd}` : main,
  };
}
