// =====================================================================
// rules/currency.js：币种资料和金额写法（规则包；不用 Intl，小程序没有）。
//
//   CURRENCIES[code]                 { zh, pre, suf, minor, dec, wan }
//   currencyInfo(code)               上面那行；不认识的币种 → null
//   currencyName(code)               'KRW' → '韩元'；不认识的原样返回代码
//   minorUnits(code)                 存储 / 计算保留几位小数（VND、JPY、KRW 0；港币 2；不认识的 2）
//   formatCurrency(amount, code, o)  'JP¥1,200'、'฿350'、'HK$88.50'、'400,000₫'；o.readable：大面额用「万」→ '1.5 万韩元'
//   groupDigits(value, decimals)     '1,234.50'（千分位，不用 Intl）
//   formatWan(value)                 '45 万'、'1.23 亿'（和 lib/money.js 一样的规则）
//
// 和 lib/money.js 的关系：港币、人民币、新台币、越南盾、美元的写法和它一字不差（测试核对）；
// 其他币种以前写成 'JPY 1,000'，规则包补上了符号。lib/money.js 以后改读这里（A4）。
// =====================================================================

/**
 * pre / suf：紧凑写法的前缀 / 后缀；minor：存储时的小数位；dec：显示的小数位（null = 整数不显示小数、有小数显示两位）；
 * wan：易读写法用「万 / 亿」（越南盾、韩元、印尼盾、瑞尔这种大面额）
 */
export const CURRENCIES = Object.freeze({
  HKD: { zh: '港币', pre: 'HK$', minor: 2, dec: null },
  CNY: { zh: '人民币', pre: '¥', minor: 2, dec: null },
  TWD: { zh: '新台币', pre: 'NT$', minor: 0, dec: 0 },
  MOP: { zh: '澳门元', pre: 'MOP$', minor: 2, dec: null },
  VND: { zh: '越南盾', suf: '₫', minor: 0, dec: 0, wan: true },
  USD: { zh: '美元', pre: 'US$', minor: 2, dec: null },
  // 日元写 JP¥：两人平时用 ¥ 记人民币，日本行程里要分得清
  JPY: { zh: '日元', pre: 'JP¥', minor: 0, dec: 0 },
  KRW: { zh: '韩元', pre: '₩', minor: 0, dec: 0, wan: true },
  THB: { zh: '泰铢', pre: '฿', minor: 2, dec: null },
  SGD: { zh: '新加坡元', pre: 'S$', minor: 2, dec: null },
  MYR: { zh: '马来西亚林吉特', pre: 'RM', minor: 2, dec: null },
  IDR: { zh: '印尼盾', pre: 'Rp', minor: 0, dec: 0, wan: true },
  PHP: { zh: '菲律宾比索', pre: '₱', minor: 2, dec: null },
  KHR: { zh: '柬埔寨瑞尔', suf: '៛', minor: 0, dec: 0, wan: true },
  GBP: { zh: '英镑', pre: '£', minor: 2, dec: null },
  EUR: { zh: '欧元', pre: '€', minor: 2, dec: null },
  CHF: { zh: '瑞士法郎', pre: 'CHF ', minor: 2, dec: null },
  CAD: { zh: '加元', pre: 'C$', minor: 2, dec: null },
  AUD: { zh: '澳元', pre: 'A$', minor: 2, dec: null },
  NZD: { zh: '新西兰元', pre: 'NZ$', minor: 2, dec: null },
});

const LEGACY = { NTD: 'TWD', RMB: 'CNY' };

/** 'ntd' → 'TWD'、'rmb' → 'CNY'、' vnd ' → 'VND' */
export function normalizeCode(code) {
  const c = String(code == null ? '' : code).trim().toUpperCase();
  return LEGACY[c] || c;
}

export function currencyInfo(code) {
  return CURRENCIES[normalizeCode(code)] || null;
}

export function currencyName(code) {
  const c = normalizeCode(code);
  return CURRENCIES[c] ? CURRENCIES[c].zh : c;
}

export function minorUnits(code) {
  const info = currencyInfo(code);
  return info ? info.minor : 2;
}

/** 四舍五入到 d 位小数（用科学计数法移位，避开 1.005 这种浮点问题） */
export function roundTo(value, d) {
  const n = Number(value);
  if (!isFinite(n)) return NaN;
  const k = Math.max(0, Math.min(10, Math.floor(d || 0)));
  if (/e/i.test(String(n))) return Number(n.toFixed(k));
  const shifted = Math.round(Number(Math.abs(n) + 'e' + k));
  const back = Number(shifted + 'e-' + k);
  return n < 0 ? -back : back;
}

/** 非负数加千分位，固定 decimals 位小数（group = false 不加千分位） */
export function groupDigits(value, decimals, group) {
  const d = decimals || 0;
  const fixed = roundTo(Math.abs(Number(value)), d).toFixed(d);
  const dot = fixed.indexOf('.');
  const int = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot);
  if (group === false) return int + frac;
  let out = '';
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += ',';
    out += int.charAt(i);
  }
  return out + frac;
}

/**
 * 「万 / 亿」写法：约 4 位有效数字，去掉末尾的 0；不到 1 万写带千分位的整数。
 *   450000 → '45 万'；455000 → '45.5 万'；12345 → '1.23 万'；123456789 → '1.23 亿'
 */
export function formatWan(value) {
  const n = Number(value);
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  let unit;
  let v;
  if (abs >= 1e8) {
    unit = ' 亿';
    v = abs / 1e8;
  } else if (abs >= 1e4) {
    unit = ' 万';
    v = abs / 1e4;
  } else {
    return sign + groupDigits(Math.round(abs), 0);
  }
  const digits = Math.min(2, Math.max(0, 3 - Math.floor(Math.log10(v))));
  let r = roundTo(v, digits);
  if (unit === ' 万' && r >= 10000) return formatWan(n < 0 ? -1e8 : 1e8);
  r = Number(r.toFixed(digits));
  // 去掉末尾的 0：'45.50' → '45.5'，'45.00' → '45'
  let body = r.toFixed(digits);
  if (body.indexOf('.') >= 0) body = body.replace(/0+$/, '').replace(/\.$/, '');
  return sign + body + unit;
}

/**
 * 金额写法（不标折合港币，那是 lib/money.js 的事）。
 * @param {number} amount
 * @param {string} code ISO 4217
 * @param {{ readable?: boolean }} [o] readable：大面额币种写「1.5 万韩元」
 */
export function formatCurrency(amount, code, o) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !isFinite(n)) return '—';
  const c = normalizeCode(code);
  const info = CURRENCIES[c];
  if (o && o.readable && info && info.wan) {
    const body = formatWan(n);
    return body + (/[万亿]$/.test(body) ? '' : ' ') + info.zh;
  }
  const abs = Math.abs(n);
  let dec = info ? info.dec : null;
  if (dec === null || dec === undefined) dec = Math.round(abs * 100) % 100 === 0 ? 0 : 2;
  const body = groupDigits(abs, dec);
  const sign = n < 0 && /[1-9]/.test(body) ? '−' : '';
  if (!info) return sign + c + ' ' + body;
  return sign + (info.pre || '') + body + (info.suf || '');
}
