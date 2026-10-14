// =====================================================================
// data/cache.js：行程数据的 IndexedDB 缓存（先显示缓存，再后台刷新）。
//
//   trip:<行程id>  → { v, userId, savedAt, rows: { trips: [...], trip_members: [...], ... } }
//   trips          → { v, userId, savedAt, trips: [...], memberships: [...] }
//
// 只缓存“服务器确认过的行”（还没同步的改动在写队列里单独存），所以缓存永远是某个时刻服务器的真实样子。
// 缓存里记着是谁的：换了账号登录，别人的缓存不会显示出来（读到 userId 不一致当作没有缓存）。
// CACHE_VERSION：数据格式变了就加一，旧缓存自动作废。
// =====================================================================

import { BUNDLE_TABLES, rowKey } from './tables.js';

export const CACHE_VERSION = 1;
export const TRIPS_KEY = 'trips';
export const tripKey = (tripId) => `trip:${tripId}`;

/** 读行程缓存；没有、格式过期、不是这个用户的 → null */
export async function readTripCache(kv, tripId, userId) {
  try {
    const v = await kv.get(tripKey(tripId));
    if (!v || v.v !== CACHE_VERSION || v.userId !== userId || !v.rows) return null;
    return v;
  } catch {
    return null;
  }
}

/** 写行程缓存（rows：表名 → 行数组） */
export async function writeTripCache(kv, tripId, userId, rows) {
  const clean = {};
  for (const t of BUNDLE_TABLES) clean[t] = rows[t] || [];
  try {
    await kv.set(tripKey(tripId), { v: CACHE_VERSION, userId, savedAt: Date.now(), rows: clean });
  } catch {
    /* 缓存写不进去不影响使用 */
  }
}

/**
 * 改缓存里的一行（行程没打开时写队列确认了改动，直接改缓存，下次打开就是新的）。
 * @param {{ row?: object, deleteKey?: string }} change
 */
export async function patchTripCache(kv, tripId, userId, table, change) {
  const cached = await readTripCache(kv, tripId, userId);
  if (!cached) return;
  const rows = cached.rows[table] || [];
  let next;
  if (change.row) {
    const k = rowKey(table, change.row);
    const i = rows.findIndex((r) => rowKey(table, r) === k);
    next = i === -1 ? [...rows, change.row] : rows.map((r, j) => (j === i ? change.row : r));
  } else if (change.deleteKey) {
    next = rows.filter((r) => rowKey(table, r) !== change.deleteKey);
  } else {
    return;
  }
  await writeTripCache(kv, tripId, userId, { ...cached.rows, [table]: next });
}

export async function deleteTripCache(kv, tripId) {
  try {
    await kv.del(tripKey(tripId));
  } catch {
    /* 忽略 */
  }
}

/** 读“全部行程”列表缓存 */
export async function readTripsCache(kv, userId) {
  try {
    const v = await kv.get(TRIPS_KEY);
    if (!v || v.v !== CACHE_VERSION || v.userId !== userId) return null;
    return v;
  } catch {
    return null;
  }
}

export async function writeTripsCache(kv, userId, data) {
  try {
    await kv.set(TRIPS_KEY, { v: CACHE_VERSION, userId, savedAt: Date.now(), trips: data.trips || [], memberships: data.memberships || [] });
  } catch {
    /* 忽略 */
  }
}

/** 清掉所有行程缓存（退出登录时） */
export async function clearTripCaches(kv) {
  try {
    await kv.clear('trip:');
    await kv.del(TRIPS_KEY);
  } catch {
    /* 忽略 */
  }
}
