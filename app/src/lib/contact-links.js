// =====================================================================
// lib/contact-links.js：电话、WhatsApp、Zalo、邮件的链接（纯函数，Node 里能直接测）。
// 联系人页、预订详情的联系人、地点动作行的「打电话」、给司机看卡片的「打电话」都用这一套——同一个号码在哪里点都去同一个地方。
//
//   phoneDigits('+84 90 000 0000')  → '84900000000'     只留数字；不带 + 而用 00 开头的国际冠码去掉
//   telHref('+84 90 000 0000')      → 'tel:+84900000000' 00 开头的国际冠码换成 +；不到 3 位 → null（急救 115 这种三位号码要能打）
//   waHref(phone)                   → 'https://wa.me/84900000000'
//   zaloHref(phone)                 → 'https://zalo.me/0900000000'   越南号码 +84 换成本地写法 0…
//   mailHref(email)                 → 'mailto:…'
//   isVnMobile(phone)               越南手机号（84 + 3/5/7/8/9 开头的 9 位，或本地 0 + 9 位）：没单独写 Zalo 号时也给「Zalo」
//   samePhone(a, b)                 两个号码是不是同一个（一个带国家码一个不带时比后 9 位）
//   phoneSpans(text)                一段文字里的电话号码拆出来做成能点的 tel: 链接（备注、贴士正文）
//
// 链接一律交给 lib/native.js 的 openExternal（以后 iOS 外壳接管）。
// =====================================================================

const str = (v) => String(v ?? '').trim();

/** 号码只留数字（去掉 +、空格、括号；不带 + 而用 00 开头的国际冠码去掉） */
export function phoneDigits(phone) {
  const raw = str(phone);
  const d = raw.replace(/\D/g, '');
  return !raw.startsWith('+') && d.startsWith('00') ? d.slice(2) : d;
}

/**
 * 越南手机号：国际写法 84 + 9 位（3 / 5 / 7 / 8 / 9 开头），或本地写法 0 + 9 位。
 * 座机（84 2xx…）、短号（113、1900 xxxx）不算。
 */
export function isVnMobile(phone) {
  const raw = str(phone);
  const d = phoneDigits(raw);
  if (/^84[35789]\d{8}$/.test(d)) return true;
  // 本地写法只认不带 + 的（+0… 不是合法号码）
  return !raw.startsWith('+') && /^0[35789]\d{8}$/.test(d);
}

/** tel: 链接（只留数字和开头的 +；00 开头、够长（≥10 位）的国际冠码换成 +）；不到 3 位返回 null */
export function telHref(phone) {
  const raw = str(phone);
  const all = raw.replace(/\D/g, '');
  if (all.length < 3) return null;
  if (raw.startsWith('+')) return `tel:+${all}`;
  if (all.startsWith('00') && all.length >= 10) return `tel:+${all.slice(2)}`;
  return `tel:${all}`;
}

/** WhatsApp：https://wa.me/<国际格式的数字>（不带 + 和空格）；号码太短返回 null */
export function waHref(phone) {
  const d = phoneDigits(phone);
  return d.length >= 7 ? `https://wa.me/${d}` : null;
}

/** Zalo：https://zalo.me/<号码>（越南号码 +84 换成本地写法 0…）；号码太短返回 null */
export function zaloHref(phone) {
  let d = phoneDigits(phone);
  if (d.length < 7) return null;
  if (d.startsWith('84') && d.length >= 10) d = `0${d.slice(2)}`;
  return `https://zalo.me/${d}`;
}

/** mailto:（不像邮箱返回 null） */
export function mailHref(email) {
  const a = str(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? `mailto:${a}` : null;
}

/** 两个号码是不是同一个（只比数字；一个带国家码一个不带时比后 9 位） */
export function samePhone(a, b) {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(x.length, y.length, 9);
  return n >= 7 && x.slice(-n) === y.slice(-n);
}

/**
 * 一段文字里的电话号码拆出来：[{ text, tel? }]（tel 是 tel: 链接；其他段原样）。
 * 认：+ 开头的国际号码、6–15 位数字（中间可以有空格、连字符）；不认：日期（2026-10-16）、只有 3–5 位的数字（时间、分机、价格的一部分）。
 * 数字前后紧挨着字母或数字的不算（「Room1203」「A-123456」这种编号不当成电话）。
 * @param {string} text
 * @returns {Array<{ text: string, tel?: string }>}
 */
/** 数字后面跟着这些就是价格 / 数量，不是电话 */
const PRICE_AFTER = /^(?:đ|₫|vnd|越南盾|盾|元|块|港币|港元|人民币|rmb|hkd|k(?![a-z])|千|万|百万|\/晚|\/人|每)/i;
/** 数字前面紧挨着币种符号 */
const PRICE_BEFORE = /(?:HK\$|NT\$|US\$|\$|¥|￥|₫|VND)\s*$/i;

export function phoneSpans(text) {
  const src = String(text ?? '');
  const out = [];
  let at = 0;
  const re = /\+?\d[\d -]{4,18}\d/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    const before = src[m.index - 1] || '';
    const after = src[m.index + raw.length] || '';
    const isDate = /^\d{4}-\d{1,2}-\d{1,2}$/.test(raw);
    // 「A-123456」「No.123456」这种编号：前面隔一个连字符 / 点还是字母数字的也不算
    const glued = /[A-Za-z0-9][-.#/]$/.test(src.slice(Math.max(0, m.index - 2), m.index));
    if (digits.length < 6 || digits.length > 15 || isDate || glued || /[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
    // 价格不是电话（代码评审 P2-6：「门票 150000 越南盾」「约 350000đ」「1500000₫/晚」都被认成了 tel:）：
    //   后面紧跟币种 / 单位（đ ₫ VND 越南盾 盾 元 块 k 千 万 港币 …），前面紧挨着币种符号（HK$ $ ¥ ₫ …），
    //   或者是不带 +、不以 0 开头、中间没有空格连字符的 7 位以内纯数字（电话：越南 0 开头 10 位、香港 8 位、国际 + 开头）
    const tail = src.slice(m.index + raw.length).replace(/^\s+/, '');
    const head = src.slice(Math.max(0, m.index - 4), m.index);
    if (PRICE_AFTER.test(tail) || PRICE_BEFORE.test(head)) continue;
    if (!raw.startsWith('+') && !raw.startsWith('0') && /^\d+$/.test(raw) && digits.length <= 7) continue;
    const tel = telHref(raw);
    if (!tel) continue;
    if (m.index > at) out.push({ text: src.slice(at, m.index) });
    out.push({ text: raw, tel });
    at = m.index + raw.length;
  }
  if (at < src.length) out.push({ text: src.slice(at) });
  return out;
}
