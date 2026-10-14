// =====================================================================
// sheets/item/saved.js：「加条目」刚保存的是哪一条（一个小信号，每天页可以直接静态引入）。
//
//   lastSavedItem.value = { id, mode: 'new'|'edit', at: 毫秒, tripId, dayId }
//
// 每天页读它（交互评审 P2-2，和账本的 sheets/expense/saved.js 同一个做法）：面板还开着时新的一条先不进时间轴，
// 面板开始收回就放进来——下面的条目平滑下移（FLIP），新的一条淡入、短暂高亮，不在屏幕上就滚过去。
// =====================================================================

import { signal } from '@preact/signals';

/** @type {import('@preact/signals').Signal<{ id: string, mode: 'new'|'edit', at: number, tripId: string, dayId: string|null } | null>} */
export const lastSavedItem = signal(null);

/** 多久以内算“刚保存” */
export const FRESH_ITEM_MS = 8000;
/** 高亮多久 */
export const FRESH_ITEM_HIGHLIGHT_MS = 2600;
