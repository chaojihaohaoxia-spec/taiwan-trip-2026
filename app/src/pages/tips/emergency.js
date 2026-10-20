// =====================================================================
// pages/tips/emergency.js：紧急电话贴士里的「报警 113，急救 115，火警 114」拆成几个大号数字（test/unit/page-visual.test.js）。
//
//   emergencyNumbers(text) → [{ label: '报警', number: '113' }, …]（最多 3 个；只认 2–4 个汉字的名字后面跟 3 位短号）
//   emergencyRest(text)    → 去掉已经拆成大号数字的那一行（那一行除了号码没别的话时），贴士正文不再重复一遍
// 只看正文第一行（第一行一般就是这几个号码）；长号码（医院、公安的座机）不拆，照样在正文里能点。
// =====================================================================

const RE = /([一-龥]{2,4})\s*[:：]?\s*\*{0,2}(\d{3})\*{0,2}(?!\d)/g;

export function emergencyNumbers(text) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const out = [];
  const seen = new Set();
  for (const m of first.matchAll(RE)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ label: m[1].replace(/^(和|或|及)/, ''), number: m[2] });
    if (out.length === 3) break;
  }
  return out.length >= 2 ? out : [];
}

/** 贴士正文去掉已经拆成大号数字的第一行（那一行除了这几个号码、连接词和标点没别的内容才去掉）；拆不出号码原样返回 */
export function emergencyRest(text) {
  const src = String(text || '');
  if (!emergencyNumbers(src).length) return src;
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.trim());
  const left = lines[i].replace(RE, '').replace(/[\s,，、;；。.:：*|/和或及\-–—()（）]/g, '');
  if (left.length > 2) return src;
  return lines.slice(i + 1).join('\n').replace(/^\s*\n/, '');
}
