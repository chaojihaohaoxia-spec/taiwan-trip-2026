// =====================================================================
// sheets/driver/translation.js：「给对方看」一句翻译（driver 弹层的参数是 tr.<id>）。
//
// 翻译页的句子不在行程数据里，存在这台手机的 localStorage（lib/translate/store.js：最近翻过、收藏）——
// 所以刷新、没网也能打开。版式：当地语（现在只有越南语）最大，下面英语（副标题那一行），最下面小字是自己写的中文。
// =====================================================================

import { local } from '../../lib/storage.js';
import { createPhraseStore } from '../../lib/translate/store.js';
import { langName } from '../../lib/translate/text.js';

const PREFIX = 'tr.';
let store = null;

/** 参数是不是一句翻译 */
export function isTranslationArg(arg) {
  return typeof arg === 'string' && arg.startsWith(PREFIX) && arg.length > PREFIX.length;
}

/**
 * tr.<id> → driver 卡片的内容（不是这种参数返回 null）。
 * @param {string|null} arg
 * @param {{ get: (id: string) => object|null }} [phrases]  测试时传内存版
 */
export function translationCard(arg, phrases) {
  if (!isTranslationArg(arg)) return null;
  const s = phrases || (store ||= createPhraseStore({ storage: local }));
  const row = s.get(arg.slice(PREFIX.length));
  if (!row || !row.vi) {
    return { kind: 'tip', primary: '这句找不到了', address: null, secondary: '可能已经删掉了，回翻译页再翻一次', phone: null, copy: '', badge: '给对方看' };
  }
  return {
    kind: 'tip',
    primary: row.vi,
    address: null,
    secondary: row.en || null,
    note: row.input,
    phone: null,
    copy: row.vi,
    copyLabel: langName(row.lang || 'vi'),
    badge: '给对方看',
    lang: row.lang || 'vi',
  };
}
