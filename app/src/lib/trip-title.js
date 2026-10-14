// =====================================================================
// lib/trip-title.js：行程名的拆法（外壳的大标题 / 副标题、行程概览的回顾大卡、行程列表都用这一个）。
//
//   splitTripTitle('富国岛 · 重阳 3 晚')  → { short: '富国岛', rest: '重阳 3 晚' }
//   splitTripTitle('台湾')               → { short: '台湾', rest: '' }
// 分隔符：「·」「•」「｜」「|」（前后可以有空格）；开头就是分隔符的不拆。
// =====================================================================

/** @returns {{ short: string, rest: string }} */
export function splitTripTitle(title) {
  const t = String(title || '').trim();
  if (!t) return { short: '', rest: '' };
  const m = /\s*[·•｜|]\s*/.exec(t);
  if (!m || m.index === 0) return { short: t, rest: '' };
  return { short: t.slice(0, m.index).trim(), rest: t.slice(m.index + m[0].length).trim() };
}

/** 「·」后面那一段（没有就是空字符串） */
export function tripTitleRest(title) {
  return splitTripTitle(title).rest;
}
