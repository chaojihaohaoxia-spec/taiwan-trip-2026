// =====================================================================
// data/fx.js：币种和换算（预算汇总、记账汇总、新记一笔时的 fx_rate）。
//
// 汇率来源：
//   - 默认用 lib/money.js 的参考汇率（1 港币≈3,300 越南盾、1 人民币≈1.17 港币、1 港币≈4.07 新台币）。
//     这是“看一眼大概多少”的汇率，所以汇总结果会标 source: 'approx'。
//   - 以后接了实时汇率，调用 setFxRates({ HKD: 1, VND: 1/3290, … }, { source: 'live', at })，
//     所有依赖汇率的汇总（signals 的 computed）会自动重算。
//   - 记账结算优先用每一笔记账当时写下的 expenses.fx_rate，不用这里的汇率（见 selectors.js）。
//
// 金额计算一律换成“最小单位”的整数（港币分、越南盾元）再加减分摊，避免 0.1 + 0.2 这类误差，
// 分摊除不尽时余数按顺序分给前几个人，保证各人份额加起来正好等于总额。
// =====================================================================

import { signal } from '@preact/signals';
import {
  APPROX_HKD_PER_UNIT, normalizeCurrency as normalizeCode, currencyMinorUnits, roundMoney,
} from '../lib/money.js';

// 币种规范、小数位、按币种四舍五入只在 lib/money.js 定义一份（显示、解析、算账用同一张表）：
//   NTD → TWD、RMB → CNY；越南盾、新台币、日元、韩元、印尼盾… 0 位，其余 2 位。

/** 币种写法统一成 ISO 4217 大写（NTD → TWD，RMB → CNY）；空 → null（数据层用 null 表示“没写币种”） */
export function normalizeCurrency(cur) {
  return normalizeCode(cur) || null;
}

/** 这个币种算账用几位小数 */
export function currencyDecimals(cur) {
  return currencyMinorUnits(cur);
}

/** 金额 → 最小单位整数（四舍五入） */
export function toMinor(amount, cur) {
  const f = 10 ** currencyDecimals(cur);
  return Math.round(Number(amount) * f + (Number(amount) >= 0 ? 1e-9 : -1e-9));
}

/** 最小单位整数 → 金额 */
export function fromMinor(minor, cur) {
  const d = currencyDecimals(cur);
  return d === 0 ? minor : Math.round(minor) / 10 ** d;
}

/** 按币种的小数位四舍五入（lib/money.js 的同一个函数） */
export { roundMoney };

/**
 * 换算器。rates = 1 单位某币种 ≈ 多少港币。
 * @param {Record<string, number>} [ratesToHKD]
 * @param {{ source?: 'approx'|'live'|'custom', at?: string|null }} [meta]
 */
export function createFx(ratesToHKD = APPROX_HKD_PER_UNIT, meta = {}) {
  const rates = {};
  for (const [k, v] of Object.entries(ratesToHKD || {})) {
    const c = normalizeCurrency(k);
    if (c && Number.isFinite(v) && v > 0) rates[c] = v;
  }
  if (!rates.HKD) rates.HKD = 1;
  const fx = {
    source: meta.source || 'approx',
    at: meta.at ?? null,
    rates: Object.freeze(rates),
    /** 支不支持这个币种 */
    knows(cur) {
      return Boolean(rates[normalizeCurrency(cur)]);
    },
    /** 1 单位 from = 多少 to；不知道返回 null */
    rate(from, to) {
      const f = normalizeCurrency(from);
      const t = normalizeCurrency(to);
      if (!f || !t) return null;
      if (f === t) return 1;
      if (!rates[f] || !rates[t]) return null;
      return rates[f] / rates[t];
    },
    /** 换算（不取整）；不知道返回 null */
    convert(amount, from, to) {
      const r = fx.rate(from, to);
      const n = Number(amount);
      return r === null || !Number.isFinite(n) ? null : n * r;
    },
  };
  return Object.freeze(fx);
}

/** 当前使用的换算器（信号）。汇总类的 computed 会读它，换了汇率自动重算。 */
export const fxRates = signal(createFx());

/** 换一套汇率（例如实时汇率模块拿到新汇率后调用） */
export function setFxRates(ratesToHKD, meta = { source: 'custom' }) {
  fxRates.value = createFx(ratesToHKD, meta);
}

/** 恢复参考汇率 */
export function resetFxRates() {
  fxRates.value = createFx();
}

/**
 * 按权重把 total（最小单位整数）分成若干份，份额之和严格等于 total（最大余数法）。
 * @param {number} total 最小单位整数，可以是负数（退款）
 * @param {number[]} weights 非负权重
 * @returns {number[]}
 */
export function allocate(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(total));
  if (sum <= 0) {
    const out = new Array(n).fill(0);
    out[0] = sign * abs;
    return out;
  }
  const raw = weights.map((w) => (Math.max(0, w) / sum) * abs);
  const floors = raw.map(Math.floor);
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floors[order[k][1]] += 1;
  return floors.map((v) => sign * v);
}

/**
 * 按“带正负号”的份额把 total 分下去（最小单位整数，结果之和严格等于 total）。
 * 用在“原币份额 → 折合港币”这种场景：份额里可能有负数（例如分摊加起来比总额多时，付款人那份是负的），
 * 不能按绝对值分（正负号会反过来）。份额之和为 0 时没法按比例，退回按绝对值分。
 * @param {number} total 最小单位整数
 * @param {number[]} weights 带正负号的份额
 * @returns {number[]}
 */
export function allocateSigned(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const T = Math.round(total);
  const S = weights.reduce((a, b) => a + b, 0);
  if (!S) return allocate(T, weights.map(Math.abs));
  const raw = weights.map((w) => (w / S) * T);
  const floors = raw.map(Math.floor);
  let rest = T - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floors[order[k][1]] += 1;
  return floors;
}
