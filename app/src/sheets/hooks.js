// =====================================================================
// sheets/hooks.js：弹层里常用的几个 hook / 小函数。
//
//   const { mode, id, fields } = useSheetArgs();   // 网址参数解析好（sheets/args.js）：新建 / 编辑哪一条 / 预填了什么
//   const { tripId, store, pending } = useSheetTrip();   // 弹层属于哪个行程：网址路径里的 :tripId，没有就看 ?trip=<id>；
//                                                  // 确定登录了才打开（store 在那之前是 null），pending = 还在恢复登录 / 行程还在读
//   findRow(store, id)                             // 在行程的各张表里找这个 id → { table, row } | null
//
// 弹层是全站共用的、可以从任何页面打开：行程内页面（#/t/<id>/…）直接用路径里的行程；
// 行程以外的页面（设置、开发页）要打开属于某个行程的弹层时，网址带上 ?trip=<id>。
// =====================================================================

import { route } from '../router/index.js';
import { useOverlay } from '../overlay/index.js';
import { useTrip, authState } from '../data/index.js';
import { parseSheetArg } from './args.js';

/** 当前弹层的参数（解析好的） */
export function useSheetArgs() {
  const ov = useOverlay();
  return parseSheetArg(ov?.arg ?? null);
}

/** 弹层属于哪个行程（路径参数 → ?trip=）；store 是 data/ 的 TripStore（没有行程、还没确定登录时 null） */
export function useSheetTrip() {
  const r = route.value;
  const tripId = r?.params?.tripId || r?.query?.trip || null;
  // useTrip 自己会等确定登录了才打开行程（恢复登录期间不去后台取，没登录的人马上会被带去登录页）
  const status = authState.value.status;
  const store = useTrip(tripId);
  // pending：还在恢复登录，或者行程还在读（弹层先显示“正在读取”，不要说“找不到”）
  const pending = Boolean(tripId) && (status === 'unknown' || (store && (store.status.value === 'idle' || store.status.value === 'loading')));
  return { tripId, store, pending };
}

/** 查 id 的顺序：地点、贴士、预订、条目、联系人、待办、账目、日记、评级、天 */
export const ROW_TABLES = Object.freeze(['places', 'tips', 'bookings', 'items', 'contacts', 'todos', 'expenses', 'journal_entries', 'reviews', 'days']);

/**
 * 在行程的各张表里找这个 id（组件里调用会订阅那几张表的变化）。
 * @returns {{ table: string, row: object } | null}
 */
export function findRow(store, id) {
  if (!store || !id) return null;
  for (const table of ROW_TABLES) {
    const row = store.tables?.[table]?.value?.get(id);
    if (row) return { table, row };
  }
  return null;
}
