// =====================================================================
// lib/number.js：数字的格式化，以及“数字滚动”动画要用的分位拆分。
//
//   formatNumber(1234.5)                     → '1,234.5'
//   formatNumber(1234.5, { decimals: 2 })    → '1,234.50'
//   roundTo(1.005, 2)                        → 1.01（避开 1.005 * 100 = 100.49999… 的坑）
//
// 数字滚动（账本合计、步进器数字变化时每一位上下滚动）：
//   numberSlots('HK$1,234.50') → [
//     { key: 'p0', char: 'H', type: 'affix' }, …,
//     { key: 'i3', char: '1', type: 'digit', digit: 1 },
//     { key: 'g3', char: ',', type: 'group' },
//     { key: 'i2', char: '2', type: 'digit', digit: 2 }, …,
//     { key: 'dp', char: '.', type: 'decimal' },
//     { key: 'f1', char: '5', type: 'digit', digit: 5 }, { key: 'f2', … },
//   ]
//   key 按“分位”取：个位永远是 i0、十位 i1、千分位逗号 g3……
//   所以 999 → 1,000 时，i0/i1/i2 原地滚动，i3 和 g3 是新出现的一列（做进场动画）；
//   用 key 做 Preact 的 key，列不会错位。
// =====================================================================

/** 按小数位四舍五入，处理浮点误差（1.005 → 1.01） */
export function roundTo(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.NaN;
  const d = Math.max(0, Math.min(10, Math.floor(decimals)));
  // 本身就是科学计数法写法的数（极大 / 极小）：toFixed 足够，也不会有 1.005 那种问题
  if (/e/i.test(String(n))) return Number(n.toFixed(d));
  // 用科学计数法移位，比乘 10^d 更准
  const shifted = Math.round(Number(`${Math.abs(n)}e${d}`));
  const back = Number(`${shifted}e-${d}`);
  return n < 0 ? -back : back;
}

const formatters = new Map();
function formatterFor(min, max, group) {
  const k = `${min}|${max}|${group}`;
  let f = formatters.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: group });
    formatters.set(k, f);
  }
  return f;
}

/**
 * 千分位格式化（英文逗号、小数点，和金额显示一致）。
 * @param {number} value
 * @param {{ decimals?: number, minDecimals?: number, maxDecimals?: number, group?: boolean }} [o]
 *   decimals：固定小数位；否则 minDecimals（默认 0）~ maxDecimals（默认 2）
 * @returns {string} 无效返回 '—'。负数用真正的减号 '−'。
 */
export function formatNumber(value, { decimals, minDecimals = 0, maxDecimals = 2, group = true } = {}) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '—';
  const min = decimals ?? minDecimals;
  const max = decimals ?? Math.max(min, maxDecimals);
  const rounded = roundTo(n, max);
  const text = formatterFor(min, max, group).format(Math.abs(rounded));
  return rounded < 0 && /[1-9]/.test(text) ? `−${text}` : text;
}

/**
 * 把格式化好的数字串拆成“分位格子”，给数字滚动动画用。
 * 只认第一段数字（金额符号、单位都算前后缀）。
 * @param {string} text 例如 'HK$1,234.50'、'−400,000₫'、'45 万越南盾'
 * @returns {Array<{ key: string, char: string, type: 'digit'|'group'|'decimal'|'sign'|'affix', digit?: number }>}
 */
export function numberSlots(text) {
  const s = String(text ?? '');
  const m = /\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return [...s].map((char, i) => ({ key: `p${i}`, char, type: 'affix' }));
  const before = s.slice(0, m.index);
  const core = m[0];
  const after = s.slice(m.index + core.length);
  const out = [];

  let p = 0;
  for (const char of before) {
    if (char === '−' || char === '-' || char === '+') out.push({ key: 'sign', char, type: 'sign' });
    else out.push({ key: `p${p++}`, char, type: 'affix' });
  }

  const [intPart, fracPart = null] = core.split('.');
  const intDigits = intPart.replace(/,/g, '');
  let place = intDigits.length - 1;
  for (const char of intPart) {
    if (char === ',') {
      // 逗号的 key 取它左边那一位的分位（'1,234' 里的逗号在千位后面 → g3）
      out.push({ key: `g${place + 1}`, char, type: 'group' });
    } else {
      out.push({ key: `i${place}`, char, type: 'digit', digit: Number(char) });
      place -= 1;
    }
  }
  if (fracPart !== null) {
    out.push({ key: 'dp', char: '.', type: 'decimal' });
    [...fracPart].forEach((char, i) => out.push({ key: `f${i + 1}`, char, type: 'digit', digit: Number(char) }));
  }
  [...after].forEach((char, i) => out.push({ key: `s${i}`, char, type: 'affix' }));
  return out;
}
