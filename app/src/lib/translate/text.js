// =====================================================================
// lib/translate/text.js：翻译用的纯函数（和小程序 1.4.5 的 utils/translate.js 同一套规则，Node 里能直接测）。
//
//   keyOf(s)                 比较用的「同一句」：去首尾空白、合并空白、句末的 。！，… 不算（问号算）、不分大小写
//   dirOf(s)                 'out' 中文（翻成越南语 + 英语）/ 'in' 外文（翻成中文）—— 和云函数 prompt.js 的 directionOf 一样
//   composing(s, cursor, dir) 还在打拼音（汉字后面跟着小写字母）：这时不边打边翻
//   finished(s)              看着写完了（句末有标点）：边打边翻停够了才记进「最近翻过」
//   HONORS / honorOf / withHonor   对方称呼：选了「大哥」就把「大哥，」拼在中文原文前面再翻
//   foreign(s)               一句外文（粘贴时提示「粘贴并翻译」用）
//   shape(r, input)          云函数的返回 → 界面用的结果 { dir, input, vi, en, zh, back, demo }
//   translateLang(trip)      这趟行程要不要翻译：按目的地档案（rules/dest.js 的 translateLang）——档案要翻译、语言包过了测试
//                            才有（现在只有越南语 'vi'）；港澳台内地、没过测试的语言 → null（不显示翻译入口）
//   langName(lang)           'vi' → '越南语'（「中文 ⇄ 越南语」、「还没有越南语名字」）；不认识 → '当地语言'
//   translateDetail(lang)    「更多」菜单翻译那一格的小字：'中文 ⇄ 越南语，带英语'
// =====================================================================

import { profileOf, translateLang as profileTranslateLang } from '../../rules/dest.js';

/** 一句最多几个字（和云函数一样：中文翻出去要写三份） */
export const MAX_CHARS = 300;

export function text(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** 按字算长度（越南语的组合字符、emoji 不算两个） */
export function len(s) {
  return Array.from(String(s || '')).length;
}

/**
 * 比较用：「请问 夜市怎么走」和「请问夜市怎么走 」算同一句；句末的句号、感叹号、逗号、省略号不算
 * （「不要香菜」和「不要香菜。」是同一句，补个句号不用再翻）。问号算：「可以」和「可以？」意思不一样。
 */
export function keyOf(s) {
  return text(s).replace(/\s+/g, ' ').replace(/[\s。．.！!~～…，,、]+$/, '').toLowerCase();
}

/** 越南语特有的字母（带声调、ơ ư đ …） */
export const VI_MARKS = /[ăâđêôơưạ-ỹ]/i;

function hanCount(s) {
  return (String(s || '').match(/[㐀-鿿豈-﫿]/g) || []).length;
}
function letterCount(s) {
  return (String(s || '').match(/[A-Za-zÀ-ɏḀ-ỿ]/g) || []).length;
}

/** 'out'：中文（翻成越南语 + 英语）；'in'：越南语、英语……（翻成中文） */
export function dirOf(s) {
  const t = String(s || '');
  const h = hanCount(t);
  if (!h) return 'in';
  if (h >= 2 && !VI_MARKS.test(t)) return 'out';
  return h * 3 >= letterCount(t) / 2 ? 'out' : 'in';
}

/** 是不是中文（拼称呼用，和小程序 isZh 一样） */
export function isZh(s) {
  const h = hanCount(s);
  if (h >= 2 && !VI_MARKS.test(String(s || ''))) return true;
  return h > 0 && h * 3 >= letterCount(s) / 2;
}

/**
 * 还在打拼音（输入法拼写中，字还没上屏）：光标前面是汉字或中文标点跟着小写字母（「请问夜市zen」「好的，xie」，
 * iOS 拼写中可能带空格、撇号，最多 8 节），或者整句只有几个小写字母、没空格（「qing」）。
 * 英文名一般有大写（「去 JW Marriott」），不算。dir 是语言栏的方向（'in' 时几个小写字母多半是没打声调的越南语，照翻）。
 */
export function composing(s, cursor, dir) {
  const t = String(s || '');
  const c = typeof cursor === 'number' && cursor >= 0 && cursor <= t.length ? cursor : t.length;
  const before = t.slice(0, c);
  if (/[㐀-鿿　-〿＀-￯] ?[a-z']+(?: [a-z']+){0,7}$/.test(before)) return true;
  return dir !== 'in' && /^[a-z']{1,12}$/.test(before.trim()) && !VI_MARKS.test(before);
}

/** 看着写完了（句末有标点） */
export function finished(s) {
  return /[。！？!?.…~～」）)]\s*$/.test(String(s || ''));
}

/** 对方称呼（模型按规则翻成 Anh ơi / Chị ơi / Em ơi / Cô ơi / Chú ơi） */
export const HONORS = Object.freeze([
  { id: '', label: '不称呼', zh: '', vi: '' },
  { id: 'ge', label: '大哥', zh: '大哥', vi: 'Anh' },
  { id: 'jie', label: '大姐', zh: '大姐', vi: 'Chị' },
  { id: 'em', label: '小妹、小哥', zh: '小妹', vi: 'Em' },
  { id: 'co', label: '阿姨', zh: '阿姨', vi: 'Cô' },
  { id: 'chu', label: '叔叔', zh: '叔叔', vi: 'Chú' },
]);
/** 原文开头已经有称呼（师傅、老板、姐……）就不再加 */
const HAS_TITLE = /^\s*(师傅|老板|大哥|大姐|姐|哥|小妹|妹妹|小哥|小弟|阿姨|叔叔|大叔|先生|小姐|美女|帅哥|司机|服务员)/;

export function honorOf(id) {
  return HONORS.find((h) => h.id === id) || HONORS[0];
}

/** 真正拿去翻的那句：选了称呼、是中文、开头没有称呼 → 「大哥，」+ 原文 */
export function withHonor(raw, id) {
  const s = text(raw);
  const h = honorOf(id);
  if (!s || !h.zh || !isZh(s) || HAS_TITLE.test(s)) return s;
  return `${h.zh}，${s}`;
}

/** 值得提示「粘贴并翻译」的：一句外文（有越南语字母，或者是几个英文词），不太长、不是网址 */
export function foreign(s) {
  const t = text(s);
  if (!t || len(t) > MAX_CHARS || /^https?:\/\//i.test(t)) return false;
  if (/[㐀-鿿]/.test(t)) return false;
  return VI_MARKS.test(t) || /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t);
}

/** 云函数（或演示）的返回 → 界面用的结果 */
export function shape(r, input) {
  const out = r.src === 'zh' || (!r.zh && Boolean(r.vi));
  return {
    dir: out ? 'out' : 'in',
    input: text(input),
    vi: out ? text(r.vi) : '',
    en: out ? text(r.en) : '',
    zh: out ? '' : text(r.zh),
    back: out ? text(r.back) : '',
    demo: Boolean(r.demo),
  };
}

/** 一行显示（列表里） */
export function oneLine(s) {
  return String(s || '').replace(/\s*\n+\s*/g, ' ');
}

/** 一条结果的「译文」（列表第二行、复制） */
export function outputOf(row) {
  if (!row) return '';
  return row.dir === 'in' ? row.zh || '' : row.vi || '';
}

/**
 * 这趟行程要不要翻译（翻译入口、贴士页「去翻译」）：看目的地档案（trips.extra.dest，没补档案的老行程按时区、当地币反查）。
 * 档案的语言要翻译、而且那种语言的提示词过了测试集（rules/dest.js 的 TR_READY，现在只有越南语）才给入口；
 * 台湾、香港、内地这类说中文的 → null；日本、泰国这些等语言包测过了再开（半成品不如不给）。
 * @param {object|null} trip trips 行
 * @returns {string|null} 'vi' / null
 */
export function translateLang(trip) {
  if (!trip) return null;
  return profileTranslateLang(profileOf(trip, {}));
}

/** 语言代码 → 中文叫法 */
export const LANG_NAMES = Object.freeze({
  vi: '越南语', en: '英语', ja: '日语', ko: '韩语', th: '泰语', fr: '法语', de: '德语', es: '西班牙语', it: '意大利语',
  ms: '马来语', id: '印尼语', km: '高棉语', 'zh-Hant': '繁体中文', 'zh-Hans': '中文',
});

export function langName(lang) {
  return LANG_NAMES[lang] || '当地语言';
}

/** 「更多」菜单翻译那一格的小字（越南语的提示词同时给英语） */
export function translateDetail(lang) {
  if (!lang) return '';
  return lang === 'en' ? '中文 ⇄ 英语' : `中文 ⇄ ${langName(lang)}，带英语`;
}
