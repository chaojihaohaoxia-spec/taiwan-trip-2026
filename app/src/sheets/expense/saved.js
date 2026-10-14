// =====================================================================
// sheets/expense/saved.js：「记一笔」刚保存的是哪一笔（只有一个信号，很小，账本页可以直接静态引入）。
//
//   lastSavedExpense.value = { id, mode: 'new'|'edit', at: 毫秒, tripId }
//
// 账本页读它：新的一笔带入场动画出现、短暂高亮，不在屏幕上就滚过去；改过的那一笔也闪一下。
// 弹层从别的页面打开时（每天页、地点面板），保存后弹「已记一笔」提示，点「查看」去账本并定位到这一笔。
// =====================================================================

import { signal } from '@preact/signals';

/** @type {import('@preact/signals').Signal<{ id: string, mode: 'new'|'edit', at: number, tripId: string } | null>} */
export const lastSavedExpense = signal(null);

/** 多久以内算“刚保存”（账本页据此决定要不要滚过去、高亮） */
export const FRESH_SAVE_MS = 8000;
