// =====================================================================
// shell/search-state.js：顶栏搜索的状态（输入的文字、最近搜索）。首屏代码，只放状态，不放搜索引擎。
//
//   searchQuery          输入框里的文字（信号；顶栏的 SearchExpand 写，结果层读）
//   recentSearches(id)   这趟行程最近搜过的词（新的在前，最多 8 个；本机存，真实数据预览时只在内存）
//   rememberSearch(id, q) / clearRecentSearches(id)
//   searchExiting        结果层正在收起（顶栏在这段时间仍然浮在遮罩上面）
// =====================================================================

import { signal } from '@preact/signals';
import { uiStore } from './trip-state.js';

export const searchQuery = signal('');
/** 最近搜索变了（结果层订阅它重画） */
export const recentVersion = signal(0);

export const RECENT_MAX = 8;
const key = (tripId) => `recent-search:${tripId}`;

/** 这趟行程最近搜过的词 */
export function recentSearches(tripId) {
  recentVersion.value;
  if (!tripId) return [];
  try {
    const list = JSON.parse(uiStore.get(key(tripId)) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** 记下一次搜索（去掉首尾空白；同一个词挪到最前面） */
export function rememberSearch(tripId, q) {
  const text = String(q || '').trim().slice(0, 40);
  if (!tripId || !text) return;
  const next = [text, ...recentSearches(tripId).filter((x) => x !== text)].slice(0, RECENT_MAX);
  uiStore.set(key(tripId), JSON.stringify(next));
  recentVersion.value += 1;
}

/** 清除这趟行程的最近搜索 */
export function clearRecentSearches(tripId) {
  if (!tripId) return;
  uiStore.remove(key(tripId));
  recentVersion.value += 1;
}

/**
 * 搜索结果层正在收起（网址里已经没有 ?sheet=search，遮罩还在淡出）：顶栏这段时间仍然浮在遮罩上面，
 * 不然收起的第一帧搜索框就被压到虚化的遮罩下面（外壳评审）。SearchLayer 写、FrameUI 读。
 */
export const searchExiting = signal(false);

