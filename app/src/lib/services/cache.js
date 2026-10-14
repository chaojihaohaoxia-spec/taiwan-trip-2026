// =====================================================================
// lib/services/cache.js：外部服务的离线缓存（IndexedDB，坏了自动退回内存）。
//
//   const cache = getServiceCache();
//   await cache.set('fx:HKD', { savedAt: Date.now(), data });
//   const rec = await cache.get('fx:HKD');      // 没有 → null
//
// - 用独立的数据库 'rs7885-services'（对象仓库 'kv'），不和数据层的缓存混用，互不影响版本升级；
// - 读写失败（无痕模式、存储已满、iOS 清理、Safari 偶尔断开连接）时不抛错：get 返回 null，set 静默失败，
//   并且从那以后改用内存缓存（本次打开期间照样能用）；
// - 只放“丢了也能重新拿”的东西：汇率、天气。业务数据不放这里。
// =====================================================================

import { createStore, get as idbGet, set as idbSet, del as idbDel, clear as idbClear } from 'idb-keyval';

export const SERVICE_DB_NAME = 'rs7885-services';
export const SERVICE_STORE_NAME = 'kv';

/** 内存缓存（测试、或 IndexedDB 不可用时） */
export function createMemoryCache() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) {
      return map.has(key) ? structuredCloneSafe(map.get(key)) : null;
    },
    async set(key, value) {
      map.set(key, structuredCloneSafe(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}

function structuredCloneSafe(v) {
  if (v === undefined || v === null) return v ?? null;
  try {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/**
 * IndexedDB 缓存；任何一次失败后自动切到内存缓存。
 * @param {{ dbName?: string, storeName?: string, indexedDB?: any }} [o]
 */
export function createIdbCache({ dbName = SERVICE_DB_NAME, storeName = SERVICE_STORE_NAME, indexedDB: idb } = {}) {
  const memory = createMemoryCache();
  const available = Boolean(idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : null));
  let store = null;
  let broken = !available;
  let warned = false;

  const getStore = () => {
    if (!store) store = createStore(dbName, storeName);
    return store;
  };
  const fail = (error) => {
    broken = true;
    if (!warned) {
      warned = true;
      console.warn('[缓存] IndexedDB 不可用，改用内存缓存（不影响使用，关掉页面后缓存会丢）', error?.name || error);
    }
  };

  return {
    get kind() {
      return broken ? 'memory' : 'indexeddb';
    },
    async get(key) {
      if (broken) return memory.get(key);
      try {
        const v = await idbGet(key, getStore());
        return v === undefined ? null : v;
      } catch (error) {
        fail(error);
        return memory.get(key);
      }
    },
    async set(key, value) {
      await memory.set(key, value);
      if (broken) return;
      try {
        await idbSet(key, value, getStore());
      } catch (error) {
        fail(error);
      }
    },
    async delete(key) {
      await memory.delete(key);
      if (broken) return;
      try {
        await idbDel(key, getStore());
      } catch (error) {
        fail(error);
      }
    },
    async clear() {
      await memory.clear();
      if (broken) return;
      try {
        await idbClear(getStore());
      } catch (error) {
        fail(error);
      }
    },
  };
}

let shared = null;

/** 全站共用的服务缓存（第一次用时才打开数据库） */
export function getServiceCache() {
  if (!shared) shared = createIdbCache();
  return shared;
}
