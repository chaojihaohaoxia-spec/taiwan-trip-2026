// =====================================================================
// lib/money.js：金额显示（全站统一格式）+ 折合港币的估算 + 金额输入解析。
//
// 规则（用户定的）：外币金额后面用括号标折合港币，按固定的大致汇率：
//   1 港币 ≈ 3,300 越南盾；1 人民币 ≈ 1.17 港币；1 港币 ≈ 4.07 新台币。
// 这里的汇率只用于“看一眼大概多少港币”。记账结算用 expenses.fx_rate（记账当时的汇率），
// 不要用这里的常量算账。想用实时汇率标注时，把汇率服务（lib/services/fx.js）的快照传进来：
//   formatMoney(400000, 'VND', { fx: snapshot })
//
//   formatMoney(400000, 'VND')                     → '400,000₫（约 HK$121）'
//   formatMoney(450000, 'VND', { readable: true }) → '45 万越南盾（约 HK$136）'   （越南盾用“万”更好读）
//   formatMoney(300, 'CNY')                        → '¥300（约 HK$351）'
//   formatMoney(88.5, 'HKD')                       → 'HK$88.50'
//   moneyParts(400000, 'VND')                      → { main: '400,000₫', hkd: '约 HK$121' }（括号部分做成次要色时用）
//   parseAmount('450k') → 450000；parseAmount('45万') → 450000；parseAmount('450.000', { currency: 'VND' }) → 450000
//
// 金额一律按原币存数字（不带千分位）；越南盾没有小数，港币、人民币最多两位小数（docs/数据结构.md A2）。
// =====================================================================

import { formatNumber, roundTo, numberSlots } from './number.js';

/** 1 单位外币 ≈ 多少港币（用户定的固定汇率）。没有列出的币种不标折合港币。 */
export const APPROX_HKD_PER_UNIT = Object.freeze({
  HKD: 1,
  CNY: 1.17,
  TWD: 1 / 4.07,
  VND: 1 / 3300,
});

/**
 * 币种资料：
 *   name      中文名
 *   prefix/suffix  紧凑写法的符号（HK$88、400,000₫）
 *   decimals  显示的小数位：null = 整数不显示小数、有小数显示两位；数字 = 固定位数
 *   minor     存储/计算时保留的小数位（越南盾、新台币 0，港币 2…；data/fx.js 的 currencyDecimals 直接用这里的）
 *   wan       易读写法用“万 / 亿”（越南盾动辄几十万）
 * 不在表里的币种写成 'JPY 1,000'，不标折合港币。
 */
export const CURRENCIES = Object.freeze({
  HKD: Object.freeze({ name: '港币', prefix: 'HK$', decimals: null, minor: 2 }),
  CNY: Object.freeze({ name: '人民币', prefix: '¥', decimals: null, minor: 2 }),
  TWD: Object.freeze({ name: '新台币', prefix: 'NT$', decimals: 0, minor: 0 }),
  VND: Object.freeze({ name: '越南盾', suffix: '₫', decimals: 0, minor: 0, wan: true }),
  USD: Object.freeze({ name: '美元', prefix: 'US$', decimals: null, minor: 2 }),
});

/** 其他币种只认中文名和小数位（写法退回 'JPY 1,000'，也不标折合港币） */
const OTHER_CURRENCIES = Object.freeze({
  JPY: { name: '日元', minor: 0 },
  KRW: { name: '韩元', minor: 0 },
  IDR: { name: '印尼盾', minor: 0 },
  CLP: { name: '智利比索', minor: 0 },
  ISK: { name: '冰岛克朗', minor: 0 },
  UGX: { name: '乌干达先令', minor: 0 },
  PYG: { name: '巴拉圭瓜拉尼', minor: 0 },
  THB: { name: '泰铢', minor: 2 },
  MOP: { name: '澳门元', minor: 2 },
  SGD: { name: '新加坡元', minor: 2 },
  MYR: { name: '马来西亚林吉特', minor: 2 },
  EUR: { name: '欧元', minor: 2 },
  GBP: { name: '英镑', minor: 2 },
});

const code = (currency) => String(currency || '').trim().toUpperCase();

/** 旧数据里的非 ISO 写法（旧版 expenses.currency） */
const LEGACY_CODES = Object.freeze({ NTD: 'TWD', RMB: 'CNY' });

/** 统一成 ISO 代码：'ntd' → 'TWD'，'rmb' → 'CNY'，'vnd' → 'VND' */
export function normalizeCurrency(currency) {
  const c = code(currency);
  return LEGACY_CODES[c] || c;
}

/** 币种中文名：'VND' → '越南盾'；不认识的原样返回代码 */
export function currencyName(currency) {
  const c = normalizeCurrency(currency);
  return CURRENCIES[c]?.name || OTHER_CURRENCIES[c]?.name || c;
}

/** 存储/计算保留几位小数：VND 0、HKD 2；不认识的币种按 2 */
export function currencyMinorUnits(currency) {
  const c = normalizeCurrency(currency);
  return CURRENCIES[c]?.minor ?? OTHER_CURRENCIES[c]?.minor ?? 2;
}

/** 按币种的小数位四舍五入（存库前、算分摊时用） */
export function roundMoney(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return Number.NaN;
  return roundTo(n, currencyMinorUnits(currency));
}

function styleOf(c) {
  return CURRENCIES[c] || { prefix: `${c} `, decimals: null };
}

/**
 * 只格式化金额本身（不标港币）。
 * @param {number} amount
 * @param {string} currency ISO 4217，如 'VND'
 */
export function formatAmount(amount, currency) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—';
  const c = normalizeCurrency(currency);
  const style = styleOf(c);
  const abs = Math.abs(n);
  const decimals = style.decimals ?? (Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2);
  const body = formatNumber(abs, { decimals });
  const sign = n < 0 && body.replace(/[0.,]/g, '') !== '' ? '−' : '';
  return `${sign}${style.prefix || ''}${body}${style.suffix || ''}`;
}

/**
 * “万 / 亿”写法的数字部分：约 4 位有效数字，去掉末尾的 0。
 *   450000 → '45 万'；455000 → '45.5 万'；12345 → '1.23 万'；1234567 → '123.5 万'；123456789 → '1.23 亿'
 * 不到 1 万返回带千分位的整数。
 */
export function formatWan(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  let unit = '';
  let v = abs;
  if (abs >= 1e8) {
    unit = ' 亿';
    v = abs / 1e8;
  } else if (abs >= 1e4) {
    unit = ' 万';
    v = abs / 1e4;
  } else {
    return `${sign}${formatNumber(Math.round(abs), { decimals: 0 })}`;
  }
  const digits = Math.min(2, Math.max(0, 3 - Math.floor(Math.log10(v))));
  let rounded = roundTo(v, digits);
  // 9999.6 万 四舍五入成 10000 万：进位到亿
  if (unit === ' 万' && rounded >= 10000) return formatWan(n < 0 ? -1e8 : 1e8);
  rounded = Number(rounded.toFixed(digits));
  // “万”前面的数字不加千分位：'1235 万'（中文习惯），不写 '1,235 万'
  return `${sign}${formatNumber(rounded, { maxDecimals: digits, group: false })}${unit}`;
}

/**
 * 易读写法：越南盾用“万 / 亿”加中文币种名，其他币种同 formatAmount。
 *   (450000, 'VND') → '45 万越南盾'；(5000, 'VND') → '5,000 越南盾'；(0, 'VND') → '0 越南盾'
 */
export function formatAmountReadable(amount, currency) {
  const n = Number(amount);
  const c = normalizeCurrency(currency);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—';
  if (!CURRENCIES[c]?.wan) return formatAmount(n, c);
  const body = formatWan(n);
  return `${body}${/[万亿]$/.test(body) ? '' : ' '}${CURRENCIES[c].name}`;
}

/**
 * 1 单位 currency ≈ 多少港币。
 * @param {string} currency
 * @param {{ perHKD?: Record<string, number> } | null} [fx] 汇率服务的快照；不给就用固定汇率
 * @returns {number|null}
 */
export function hkdPerUnit(currency, fx) {
  const c = normalizeCurrency(currency);
  if (c === 'HKD') return 1;
  const live = fx?.perHKD?.[c];
  if (Number.isFinite(live) && live > 0) return 1 / live;
  return APPROX_HKD_PER_UNIT[c] ?? null;
}

/** 折合港币的估算值；不支持的币种返回 null */
export function approxHKD(amount, currency, fx) {
  const rate = hkdPerUnit(currency, fx);
  const n = Number(amount);
  if (!rate || !Number.isFinite(n)) return null;
  return Number((n * rate).toPrecision(12));
}

/**
 * 币种换算（经港币中转）。from/to 都支持时返回数字，否则 null。不做四舍五入。
 * @param {{ perHKD?: Record<string, number> } | null} [fx]
 */
export function convertAmount(amount, from, to, fx) {
  const n = Number(amount);
  const a = hkdPerUnit(from, fx);
  const b = hkdPerUnit(to, fx);
  if (!Number.isFinite(n) || !a || !b) return null;
  // 去掉浮点尾巴：100 港币 → 407.00000000000006 新台币
  return Number(((n * a) / b).toPrecision(12));
}

/** 折合港币不到 0.05 时的说法（moneyParts） */
export const TINY_HKD = '不到 HK$0.1';

/** 港币估算值的写法：≥10 取整，<10 保留一位小数 */
function formatApproxHKD(value) {
  const abs = Math.abs(value);
  const rounded = abs >= 10 ? Math.round(abs) : Math.round(abs * 10) / 10;
  const sign = value < 0 && rounded !== 0 ? '−' : '';
  return `${sign}HK$${formatNumber(rounded, { decimals: Number.isInteger(rounded) ? 0 : 1 })}`;
}

/**
 * 金额 + 折合港币（拆开的两部分）。港币本身或不支持的币种，hkd 为 null。
 * @param {number} amount
 * @param {string} currency
 * @param {{ readable?: boolean, fx?: object|null }} [o] readable：越南盾用“万”写法；fx：用实时汇率估算
 * @returns {{ main: string, hkd: string | null }}  港币估算的数值用 approxHKD() 拿
 */
export function moneyParts(amount, currency, { readable = false, fx = null, hkdValue = null } = {}) {
  const c = normalizeCurrency(currency);
  const main = readable ? formatAmountReadable(amount, c) : formatAmount(amount, c);
  // 港币本身、无效金额、0（括号里写“约 HK$0”没有意义）都不标
  if (c === 'HKD' || main === '—' || Number(amount) === 0) return { main, hkd: null };
  // hkdValue：已经算好的折合港币（记账时记下的 amount_home）——同一屏的合计、小计、每一行都用同一份数，
  // 不再一处按记账时的汇率、一处按今天的参考汇率（10-14 现场走查 P2-4：两套汇率混用，数字对不上）
  const given = hkdValue === null || hkdValue === undefined || hkdValue === '' ? NaN : Number(hkdValue);
  const v = Number.isFinite(given) ? given : approxHKD(amount, c, fx);
  if (v === null) return { main, hkd: null };
  // 折合下来连 0.1 港币都不到（45₫）：写「约 HK$0」像是算错了，改说「不到 HK$0.1」
  if (Math.abs(v) < 0.05) return { main, hkd: TINY_HKD };
  return { main, hkd: `约 ${formatApproxHKD(v)}` };
}

/** 数字滚动用的分位格子（见 lib/number.js 的 numberSlots）：moneySlots(1234.5, 'HKD') */
export function moneySlots(amount, currency, { readable = false } = {}) {
  return numberSlots(readable ? formatAmountReadable(amount, currency) : formatAmount(amount, currency));
}

/** 金额 + 括号里的折合港币（全角括号），例如 '400,000₫（约 HK$121）' */
export function formatMoney(amount, currency, opts) {
  const { main, hkd } = moneyParts(amount, currency, opts);
  return hkd ? `${main}（${hkd}）` : main;
}

/**
 * 区间金额（费用估算 cost_estimate 的 amount ~ amount_max）：
 *   formatMoneyRange(200000, 300000, 'VND') → '200,000–300,000₫（约 HK$61–91）'
 */
export function formatMoneyRange(min, max, currency, opts = {}) {
  if (max === null || max === undefined || Number(max) === Number(min)) return formatMoney(min, currency, opts);
  const c = normalizeCurrency(currency);
  const lo = moneyParts(min, c, opts);
  const hi = moneyParts(max, c, opts);
  const style = styleOf(c);
  // 共用符号：'NT$200–300'、'200,000–300,000₫'；“万”写法时 '20 万–30 万越南盾'
  let main;
  if (opts.readable && CURRENCIES[c]?.wan) {
    main = `${formatWan(min)}–${formatAmountReadable(max, c)}`;
  } else {
    const strip = (s) => s.replace(style.prefix || '\u0000', '').replace(style.suffix || '\u0000', '');
    main = `${lo.main}–${strip(hi.main)}`;
    if (style.suffix) main = `${strip(lo.main)}–${hi.main}`;
  }
  if (!lo.hkd || !hi.hkd) return main;
  if (hi.hkd === TINY_HKD) return `${main}（${TINY_HKD}）`;
  const loText = lo.hkd === TINY_HKD ? '约 HK$0' : lo.hkd;
  return `${main}（${loText}–${hi.hkd.replace(/^约 HK\$/, '')}）`;
}

// ---------------------------------------------------------------------
// 手机上输金额（记一笔、写评级的价格）：iOS 的数字键盘打不出「k」「万」，
// 大面额币种（一碗粉几万越南盾）给「千 / 万」快捷键；两个弹层用同一套判断，叫法一致
// ---------------------------------------------------------------------

/** 面额大的币种：输入框旁边给「千」（记一笔还有「万」），不到 1,000 时提醒是不是忘了按「千」 */
export const BIG_UNIT_CURRENCIES = Object.freeze(new Set(['VND', 'IDR', 'KRW', 'UGX', 'PYG']));

/** 「千 / 万」快捷键 */
export const QUICK_UNITS = Object.freeze([
  Object.freeze({ key: 'k', label: '千', factor: 1e3 }),
  Object.freeze({ key: 'w', label: '万', factor: 1e4 }),
]);

/** 这个币种要不要「千 / 万」快捷键 */
export function wantsQuickUnits(currency) {
  return BIG_UNIT_CURRENCIES.has(normalizeCurrency(currency));
}

/** 这个币种的金额能不能有小数 */
export function allowsDecimals(currency) {
  return currencyMinorUnits(currency) > 0;
}

/** 金额输入框的键盘：没有小数的币种用纯数字键盘（numeric），有小数的用带小数点的（decimal） */
export function amountInputMode(currency) {
  return allowsDecimals(currency) ? 'decimal' : 'numeric';
}

// ---------------------------------------------------------------------
// 金额输入解析（记账、填价格时用户怎么顺手怎么输）
// ---------------------------------------------------------------------

const FULL_WIDTH = /[０-９．，－＋]/g;
/** 币种符号和中文名（长的写在前面，HK$ 先于 $） */
const CURRENCY_NOISE = /HK\$|NT\$|US\$|JP¥|MOP\$|S\$|đồng|[$¥￥₫€£฿₩]|đ|元|块|圆|港币|港元|人民币|新台币|台币|越南盾|日元|美元|泰铢/gi;
/** 三个字母的币种代码（只认已知的，免得把 'k' 'tr' 这类单位当成代码删掉） */
const ISO_CODES = new RegExp(`(^|[^A-Za-z])(${[...Object.keys(CURRENCIES), ...Object.keys(OTHER_CURRENCIES), ...Object.keys(LEGACY_CODES)].join('|')})(?![A-Za-z])`, 'gi');
const UNIT_MULTIPLIERS = [
  [/^(亿)$/, 1e8],
  [/^(万|w|W)$/, 1e4],
  [/^(千|k|K)$/, 1e3],
  [/^(m|M|tr|triệu|百万)$/i, 1e6],
];

/**
 * 把用户输入的金额变成数字。认得：
 *   千分位          '1,234.5'、'1 234'、'1，234'
 *   全角            '１２３．５'
 *   符号和币种       'HK$88'、'¥300'、'400,000₫'、'300 元'、'450k đ'、'VND 450000'
 *   单位            '45万'、'45w'、'450k'、'1.2m'、'2tr'、'1tr2'（越南口语：1,200,000）、'1.5亿'
 *   越南写法         '450.000'（currency 是没有小数的币种时，点号当千分位）
 *   负数            '-50'、'−50'
 * 认不出返回 null。给了 currency 时按该币种的小数位四舍五入。
 * @param {string|number} input
 * @param {{ currency?: string }} [o]
 */
export function parseAmount(input, { currency } = {}) {
  if (typeof input === 'number') return Number.isFinite(input) ? (currency ? roundMoney(input, currency) : input) : null;
  let s = String(input ?? '').trim();
  if (!s) return null;
  s = s.replace(FULL_WIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[−–—]/g, '-');
  // 去掉币种符号、中文币种名、ISO 代码（HKD / VND / RMB…）
  s = s.replace(CURRENCY_NOISE, ' ').replace(ISO_CODES, (m, before) => `${before} `);
  s = s.replace(/\s+/g, '').replace(/[,，'_]/g, '');
  if (!s) return null;

  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  // 越南口语 '1tr2' = 1.2 百万、'1tr25' = 1.25 百万
  const tr = /^(\d+)tr(\d{1,3})$/i.exec(s);
  if (tr) return finish(sign * (Number(tr[1]) + Number(`0.${tr[2]}`)) * 1e6, currency);

  const m = /^(\d+(?:\.\d+)*)(?:\.)?([^\d.]*)$/.exec(s);
  if (!m) return null;
  let numText = m[1];
  const unit = m[2];
  // '450.000' / '1.250.000'：没有小数的币种，点号是千分位
  const noDecimals = currency && currencyMinorUnits(currency) === 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(numText) && (noDecimals || (numText.match(/\./g) || []).length > 1)) {
    numText = numText.replace(/\./g, '');
  }
  if ((numText.match(/\./g) || []).length > 1) return null;
  let value = Number(numText);
  if (!Number.isFinite(value)) return null;
  if (unit) {
    const hit = UNIT_MULTIPLIERS.find(([re]) => re.test(unit));
    if (!hit) return null;
    value *= hit[1];
  }
  return finish(sign * value, currency);
}

function finish(value, currency) {
  if (!Number.isFinite(value)) return null;
  // 浮点误差：1.2 * 1e6 = 1199999.9999999998
  const cleaned = Number(value.toPrecision(12));
  return currency ? roundMoney(cleaned, currency) : cleaned;
}
