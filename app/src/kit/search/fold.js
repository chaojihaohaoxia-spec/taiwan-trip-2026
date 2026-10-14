// =====================================================================
// kit/search/fold.js：搜索用的“折叠”文字（纯函数，Node 里能直接测）。
//
//   foldText('Phở Hòa')            → 'pho hoa'       越南语去声调、去帽子（ơ ư â ê ô ă）、đ → d
//   foldText('ＧＲＡＢ 夜市')        → 'grab 夜市'     全角转半角、不分大小写；中文原样
//   foldWithMap('Phở')             → { text: 'pho', starts: [0,1,2], ends: [1,2,3] }
//   findRanges('Bánh mì Bến Tàu', ['ben'])   → [[8, 11]]   原文里的位置（高亮用）
//
// 规则和 data/selectors.js 的 normalizeSearchText 一致（NFKC + 小写），再多做一步：去掉所有组合附加符号
// （声调、帽子、日文浊点……）和越南语的 đ / Đ → d，所以搜「pho」能找到「Phở」、搜「ben tau」能找到「Bến Tàu」。
// 逐字折叠并记下每个折叠后的字符来自原文的哪一段（starts / ends，UTF-16 下标），高亮时换算回原文位置，
// 原文是“预组合”还是“字母 + 组合符号”两种写法都对得上。
// =====================================================================

/** 组合附加符号（Unicode 类别 M：声调、帽子、浊点……） */
const MARKS = /\p{M}/gu;
/** 不会被分解掉、要单独换成拉丁字母的字（越南语的 đ，以及几个常见的北欧字母） */
const SPECIAL = Object.freeze({ đ: 'd', Đ: 'd', ð: 'd', Ð: 'd', ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe' });
/** 空白（含全角空格、不换行空格）一律当成一个普通空格 */
const SPACE = /\s/u;

/** 一个字（码位）折叠后的样子；组合符号本身折叠成 '' */
function foldChar(ch) {
  if (SPECIAL[ch]) return SPECIAL[ch];
  if (SPACE.test(ch)) return ' ';
  // NFKD：先拆开（预组合的 ở → o + 两个符号；全角 Ａ → A；ﬁ → fi），去掉符号，再小写
  const out = ch.normalize('NFKD').replace(MARKS, '').toLowerCase();
  // 小写以后又可能冒出组合符号（İ → i̇），再去一次
  return out.replace(MARKS, '');
}

/**
 * 折叠并记下位置对照。
 * @param {string} input
 * @returns {{ text: string, starts: number[], ends: number[] }}
 *   text：折叠后的文字；starts[k] / ends[k]：折叠后第 k 个字符对应原文的 [starts[k], ends[k])（UTF-16 下标）
 */
export function foldWithMap(input) {
  const src = String(input ?? '');
  let text = '';
  const starts = [];
  const ends = [];
  let i = 0;
  for (const ch of src) {
    const start = i;
    i += ch.length;
    const f = foldChar(ch);
    if (!f) {
      // 组合符号：并进前一个字（高亮时连着它一起标）
      if (ends.length) ends[ends.length - 1] = i;
      continue;
    }
    for (let k = 0; k < f.length; k++) {
      text += f[k];
      starts.push(start);
      ends.push(i);
    }
  }
  return { text, starts, ends };
}

/** 只要折叠后的文字 */
export function foldText(input) {
  return foldWithMap(input).text;
}

/**
 * 查询词 → [{ folded: 折叠后的词, raw: 原样（NFC、小写）}]：按空白分开、去重；只有标点 / 符号的词不算
 * （搜「·」「（」不该把所有带这个符号的东西都列出来）。raw 用来给“连声调都一样”的结果加一点分。
 * @param {string} query
 * @returns {Array<{ folded: string, raw: string }>}
 */
export function queryTokenPairs(query) {
  const out = [];
  const seen = new Set();
  for (const word of String(query ?? '').normalize('NFKC').toLowerCase().split(/\s+/u)) {
    if (!/[\p{L}\p{N}]/u.test(word)) continue;
    const folded = foldText(word);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    out.push({ folded, raw: word.normalize('NFC') });
  }
  return out;
}

/**
 * 查询词 → 折叠后的词组（按空白分开，去掉空的、去重；只有标点 / 符号的词不算）。
 * @param {string} query
 * @returns {string[]}
 */
export function queryTokens(query) {
  return queryTokenPairs(query).map((p) => p.folded);
}

/** 合并重叠 / 相邻的区间（按开始位置排序） */
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * 原文里所有词出现的位置（高亮用）：每个词的每一处都标出来，重叠的合并。
 * @param {string} text   原文（显示出来的那段字）
 * @param {string[]} tokens 折叠后的词（queryTokens 的结果）
 * @returns {Array<[number, number]>} 原文的 [开始, 结束)（UTF-16 下标）
 */
export function findRanges(text, tokens) {
  if (!text || !tokens?.length) return [];
  const { text: folded, starts, ends } = foldWithMap(text);
  const out = [];
  for (const tok of tokens) {
    if (!tok) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(tok, from);
      if (at === -1) break;
      out.push([starts[at], ends[at + tok.length - 1]]);
      from = at + Math.max(1, tok.length);
    }
  }
  return mergeRanges(out);
}

/**
 * 按区间把文字切成几段（高亮组件用）：[{ text, hit }]。
 * @param {string} text
 * @param {Array<[number, number]>} ranges
 */
export function splitByRanges(text, ranges) {
  const s = String(text ?? '');
  if (!ranges?.length) return s ? [{ text: s, hit: false }] : [];
  const parts = [];
  let at = 0;
  for (const [a, b] of mergeRanges(ranges)) {
    const from = Math.max(at, Math.min(a, s.length));
    const to = Math.min(b, s.length);
    if (from > at) parts.push({ text: s.slice(at, from), hit: false });
    if (to > from) parts.push({ text: s.slice(from, to), hit: true });
    at = Math.max(at, to);
  }
  if (at < s.length) parts.push({ text: s.slice(at), hit: false });
  return parts;
}
