// =====================================================================
// sheets/journal/draft.js：日记草稿（本机自动保存）。
//
// 写日记的面板每改一下就（防抖后）存一份草稿到这台设备：不小心往下拉关掉面板、切到别的 App 被系统杀掉、
// 没网保存不了，下次打开同一天都能接着写。保存成功后草稿删掉。
//   键：rs7885:journal-drafts:<行程 id>:<用户 id> → { [day id]: { mood, body, photos, at } }（一个人一趟行程一个键）
//   本机真实数据预览（--real）时只放内存，真实的日记内容不写进浏览器存储（和数据层同一个规矩）。
//
//   readDraft(tripId, userId, dayId) / writeDraft(tripId, userId, dayId, form | null)
//   draftDays(tripId, userId)   有草稿的天（Set<day id>）；在组件里调用会订阅变化（draftVersion）
// =====================================================================

import { signal } from '@preact/signals';
import { local } from '../../lib/storage.js';
// 直接引 data/demo.js（纯函数，Node 里也能跑）：经过 data/index.js 会把整个数据层拖进单元测试
import { isRealPreview } from '../../data/demo.js';

/** 草稿变了就加一（页面上「草稿」小标记据此刷新） */
export const draftVersion = signal(0);

const memory = new Map();
const keyOf = (tripId, userId) => `journal-drafts:${tripId}:${userId}`;

function readAll(tripId, userId) {
  if (!tripId || !userId) return {};
  const key = keyOf(tripId, userId);
  if (isRealPreview()) return { ...(memory.get(key) || {}) };
  const v = local.getJSON(key, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function writeAll(tripId, userId, all) {
  const key = keyOf(tripId, userId);
  const empty = !Object.keys(all).length;
  if (isRealPreview()) {
    if (empty) memory.delete(key);
    else memory.set(key, all);
  } else if (empty) {
    local.remove(key);
  } else {
    local.setJSON(key, all);
  }
  draftVersion.value += 1;
}

/** 某一天的草稿（没有返回 null） */
export function readDraft(tripId, userId, dayId) {
  const d = readAll(tripId, userId)[dayId];
  return d && typeof d === 'object' ? d : null;
}

/**
 * 写 / 删一天的草稿。form 为 null 时删掉。
 * @param {{ mood: string, body: string, photos: object[] } | null} form
 */
export function writeDraft(tripId, userId, dayId, form) {
  if (!tripId || !userId || !dayId) return;
  const all = readAll(tripId, userId);
  if (form) all[dayId] = { mood: form.mood || '', body: form.body || '', photos: form.photos || [], at: new Date().toISOString() };
  else if (dayId in all) delete all[dayId];
  else return;
  writeAll(tripId, userId, all);
}

/** 有草稿的天（组件里调用会随草稿变化重画） */
export function draftDays(tripId, userId) {
  draftVersion.value;
  return new Set(Object.keys(readAll(tripId, userId)));
}
