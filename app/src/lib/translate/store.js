// =====================================================================
// lib/translate/store.js：翻过的句子存在这台手机里（localStorage，没网也能看、能再拿出来给对方看）。
//
//   const s = createPhraseStore({ storage })      storage = lib/storage.js 的 local（测试传内存版）
//   s.list() / s.save(input, res) / s.remove(id) / s.find(input)        最近翻过的（30 条，新的在前）
//   s.stars() / s.star(res) / s.unstar(idOrInput) / s.starred(input)    收藏（50 条，整条结果都存）
//   s.get(id)                                                           按 id 找（最近翻过、收藏都找；「给对方看」用）
//   s.remember(input, res) / s.peek(input)                              这次打开期间翻过的（同一句不重发、不进历史）
//   s.honor() / s.setHonor(id)                                          对方称呼（记住上次选的）
//   s.version                                                           信号：列表变了就 +1（页面据此重画）
// 键：rs7885:translate:recent / :star / :honor（storage 自己加 rs7885: 前缀）。不分行程：常用的话换一趟越南行程也能用。
// 退出登录时这三个键由数据层清掉（data/layer.js 的 clearLocal）。
// =====================================================================

import { signal } from '@preact/signals';
import { keyOf, text, honorOf } from './text.js';

export const RECENT_KEEP = 30;
export const STAR_KEEP = 50;
const K_RECENT = 'translate:recent';
const K_STAR = 'translate:star';
const K_HONOR = 'translate:honor';

function clean(row) {
  return {
    id: String(row.id),
    dir: row.dir === 'in' ? 'in' : 'out',
    input: text(row.input),
    vi: text(row.vi),
    en: text(row.en),
    zh: text(row.zh),
    back: text(row.back),
    demo: Boolean(row.demo) || undefined,
    at: Number(row.at) || 0,
  };
}

function valid(x) {
  return x && typeof x === 'object' && x.id && typeof x.input === 'string' && x.input.trim();
}

export function createPhraseStore({ storage, now = () => Date.now() } = {}) {
  const version = signal(0);
  const memo = new Map();
  let seq = 0;
  const bump = () => { version.value += 1; };
  const read = (k) => {
    const v = storage?.getJSON(k, []);
    return Array.isArray(v) ? v.filter(valid) : [];
  };
  const newId = (p) => `${p}${now().toString(36)}${(seq++).toString(36)}`;

  function list() { return read(K_RECENT); }
  function stars() { return read(K_STAR); }
  function find(input) {
    const k = keyOf(input);
    return k ? list().find((x) => keyOf(x.input) === k) || null : null;
  }
  function starred(input) {
    const k = keyOf(input);
    return k ? stars().find((x) => keyOf(x.input) === k) || null : null;
  }
  /** 存一条（同一句只留最新的一条，排到最前）；返回存好的那条 */
  function save(input, res) {
    const k = keyOf(input);
    if (!k || !res) return null;
    const row = clean({ ...res, id: newId('t'), input, at: now() });
    storage?.setJSON(K_RECENT, [row, ...list().filter((x) => keyOf(x.input) !== k)].slice(0, RECENT_KEEP));
    bump();
    return row;
  }
  function remove(id) {
    const rows = list();
    const next = rows.filter((x) => x.id !== id);
    if (next.length !== rows.length) {
      storage?.setJSON(K_RECENT, next);
      bump();
    }
    return next;
  }
  /** 收藏一条（同一句只留一条，排到最前）。返回 { row, dropped }：收藏满了挤掉最早那条时 dropped = true */
  function star(res) {
    if (!res || !text(res.input)) return { row: null, dropped: false };
    const k = keyOf(res.input);
    const row = clean({ ...res, id: newId('s'), at: now() });
    const rest = stars().filter((x) => keyOf(x.input) !== k);
    const all = [row, ...rest];
    storage?.setJSON(K_STAR, all.slice(0, STAR_KEEP));
    bump();
    return { row, dropped: all.length > STAR_KEEP };
  }
  /** 取消收藏：按 id，或者按原句 */
  function unstar(idOrInput) {
    const rows = stars();
    const k = keyOf(idOrInput);
    const next = rows.filter((x) => x.id !== idOrInput && keyOf(x.input) !== k);
    if (next.length !== rows.length) {
      storage?.setJSON(K_STAR, next);
      bump();
    }
    return next;
  }
  function get(id) {
    if (!id) return null;
    return list().find((x) => x.id === id) || stars().find((x) => x.id === id) || null;
  }
  function remember(input, res) {
    const k = keyOf(input);
    if (!k || !res) return;
    memo.delete(k);
    memo.set(k, res);
    while (memo.size > 60) memo.delete(memo.keys().next().value);
  }
  /** 翻过的同一句：收藏的 → 最近翻过的（这两种带 id，界面上标「之前翻过」）→ 这次打开记着的；都没有 = null */
  function peek(input) {
    const k = keyOf(input);
    if (!k) return null;
    return starred(input) || find(input) || memo.get(k) || null;
  }
  function honor() {
    return honorOf(storage?.get(K_HONOR, '') || '').id;
  }
  function setHonor(id) {
    const h = honorOf(id);
    storage?.set(K_HONOR, h.id);
    return h.id;
  }
  return { version, list, stars, find, starred, save, remove, star, unstar, get, remember, peek, honor, setHonor, _memo: memo };
}
