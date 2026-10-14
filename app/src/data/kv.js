// =====================================================================
// data/kv.js：IndexedDB 键值存储（idb-keyval），出错时重连重试；内存只做“写穿缓存”。
//
//   const kv = createKv('rs7885');      // 正式数据
//   const kv = createKv('rs7885-demo'); // 演示模式（和正式数据分开，本机开发不会串）
//   await kv.set('trip:demo-island', {...}); await kv.get('trip:demo-island');
//   await kv.entries('op:')            // 按前缀列出
//
// 存的东西：
//   trip:<行程id>     行程数据包缓存（服务器确认过的行，见 cache.js）
//   trips             全部行程列表缓存
//   op:<序号>:<id>    写队列里的每一条改动（一条一个键，多个标签页同时写也不会互相覆盖，见 outbox.js）
//   blob:<id>         等待上传的文件（离线拍的照片，联网后上传）
//   demo:*            演示模式的“服务器”（只在 rs7885-demo 库里）
//
// 浏览器存储随时可能出问题（iOS 主屏 App 切后台久了回来 “Connection to Indexed Database server lost”、
// 存储满 QuotaExceeded、无痕模式），处理规则：
//   1. 任何一次读写出错：重新建连接（createStore 重开）再试一次；大多数“连接断了”这样就好了；
//   2. 还是不行：
//      - 写（set / del）：内容先记在内存的“待写入”里（写穿缓存），返回 false（= 没有存到本机）；
//        之后任何一次读写成功（存储恢复了），按原来的顺序把待写入的补写进去；
//      - 读（get / keys / entries）：抛 StorageUnavailableError——**读失败不能当成“没有”**
//        （否则写队列会以为“这条已经被别的标签页发过了”而丢掉改动）。只有这次会话里自己写过、
//        还在待写入里的键，读的时候直接返回内存里的值；
//   3. 不会因为一次失败就永久换成空的内存库（旧实现的问题）。
// 状态：kv.status 是信号 'ok' | 'degraded'（有改动只在内存里），界面可以据此提示“没能保存到本机”。
// Node 里（单元测试）没有 indexedDB，用 createMemoryKv；测试存储故障时给 createKv 传 { idb: 假的 idb-keyval }。
// =====================================================================

import { signal } from '@preact/signals';
import * as idbKeyval from 'idb-keyval';

/** 读本机存储失败（不是“没有这个键”，而是“现在读不了”） */
export class StorageUnavailableError extends Error {
  constructor(message = '这台设备的存储暂时不可用', options) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

const copy = (v) => (v === undefined ? undefined : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));
const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * 内存版（测试、浏览器没有 IndexedDB 时用）。值做结构化拷贝，行为和 IndexedDB 一致（存进去的是副本）。
 * persistent = false：关掉页面就没了（界面可以据此提示）。
 */
export function createMemoryKv(name = 'memory') {
  const map = new Map();
  return {
    name,
    kind: 'memory',
    persistent: false,
    status: signal('ok'),
    async get(k) { return copy(map.get(k)); },
    async set(k, v) { map.set(k, copy(v)); return true; },
    async del(k) { map.delete(k); return true; },
    async getMany(ks) { return ks.map((k) => copy(map.get(k))); },
    async setMany(pairs) { for (const [k, v] of pairs) map.set(k, copy(v)); return true; },
    async delMany(ks) { for (const k of ks) map.delete(k); return true; },
    async keys(prefix = '') { return [...map.keys()].filter((k) => String(k).startsWith(prefix)).sort(); },
    async entries(prefix = '') {
      return [...map.entries()].filter(([k]) => String(k).startsWith(prefix)).sort(byKey).map(([k, v]) => [k, copy(v)]);
    },
    async clear(prefix = '') {
      for (const k of [...map.keys()]) if (String(k).startsWith(prefix)) map.delete(k);
      return true;
    },
  };
}

function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * IndexedDB 版（库名 = name，表名 kv）。
 * @param {string} name
 * @param {{ idb?: typeof idbKeyval, force?: boolean, onStatus?: (status: 'ok'|'degraded', error?: any) => void }} [o]
 *   idb：替换 idb-keyval（单元测试模拟存储故障）；force：没有 indexedDB 时也用 idb（配合假的 idb）
 */
export function createKv(name, o = {}) {
  const idb = o.idb || idbKeyval;
  if (!o.idb && !hasIndexedDb()) return createMemoryKv(name);
  let store;
  try {
    store = idb.createStore(name, 'kv');
  } catch (error) {
    console.warn('[数据] IndexedDB 打不开，改用内存（关掉页面后不保留）', error);
    return createMemoryKv(name);
  }

  const status = signal('ok');
  /** 没写进 IndexedDB 的改动（按发生顺序）：key → { value } | { deleted: true } */
  const pending = new Map();
  let flushing = null;

  function setStatus(next, error) {
    if (status.peek() === next) return;
    status.value = next;
    if (next === 'degraded') console.warn('[数据] IndexedDB 读写失败：改动先留在内存里，存储恢复后自动补写', error);
    o.onStatus?.(next, error);
  }

  const reopen = () => {
    try {
      store = idb.createStore(name, 'kv');
    } catch {
      /* 重开也失败：下次再试 */
    }
  };

  /** 跑一次 IndexedDB 操作：失败就重开连接再试一次；还失败抛出原始错误 */
  async function attempt(fn) {
    try {
      return await fn(store);
    } catch {
      reopen();
      return fn(store);
    }
  }

  /** 存储恢复后：按顺序补写待写入的内容 */
  function flushPending() {
    if (flushing || !pending.size) return flushing;
    flushing = (async () => {
      try {
        for (const [k, p] of [...pending]) {
          if (p.deleted) await idb.del(k, store);
          else await idb.set(k, p.value, store);
          // 补写期间又有新的改动覆盖了这一条：留着下次补
          if (pending.get(k) === p) pending.delete(k);
        }
        if (!pending.size) setStatus('ok');
      } catch {
        /* 还是写不进去：留着下次 */
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  /** 成功的读写之后：状态恢复，顺手补写 */
  function onSuccess() {
    if (pending.size) flushPending();
    else setStatus('ok');
  }

  /** 读 */
  async function read(fn) {
    try {
      const r = await attempt(fn);
      onSuccess();
      return r;
    } catch (error) {
      setStatus('degraded', error);
      throw new StorageUnavailableError(undefined, { cause: error });
    }
  }

  /** 写：成功 true；写不进去记进 pending，返回 false */
  async function write(pairs, fn) {
    // 先登记成待写入：写的过程中别的读拿到的是新值
    const marks = pairs.map(([k, p]) => {
      pending.delete(k); // 重新排到最后（保持发生顺序）
      pending.set(k, p);
      return [k, p];
    });
    try {
      await attempt(fn);
      for (const [k, p] of marks) if (pending.get(k) === p) pending.delete(k);
      onSuccess();
      return true;
    } catch (error) {
      setStatus('degraded', error);
      return false;
    }
  }

  /** IndexedDB 里读到的键 + 待写入的键（新增的加上、删掉的去掉） */
  function mergeKeys(list, prefix) {
    const set = new Set(list.map(String).filter((k) => k.startsWith(prefix)));
    for (const [k, p] of pending) {
      if (!k.startsWith(prefix)) continue;
      if (p.deleted) set.delete(k);
      else set.add(k);
    }
    return [...set].sort();
  }

  async function get(k) {
    const p = pending.get(k);
    if (p) return p.deleted ? undefined : copy(p.value);
    return read((s) => idb.get(k, s));
  }

  async function getMany(ks) {
    const missing = ks.filter((k) => !pending.has(k));
    const got = missing.length ? await read((s) => idb.getMany(missing, s)) : [];
    const fromDb = new Map(missing.map((k, i) => [k, got[i]]));
    return ks.map((k) => {
      const p = pending.get(k);
      if (p) return p.deleted ? undefined : copy(p.value);
      return fromDb.get(k);
    });
  }

  const delMany = (ks) => write(ks.map((k) => [k, { deleted: true }]), (s) => idb.delMany(ks, s));

  async function keys(prefix = '') {
    const list = await read((s) => idb.keys(s));
    return mergeKeys(list, prefix);
  }

  return {
    name,
    kind: 'idb',
    persistent: true,
    status,
    /** 还有多少改动只在内存里（测试、开发页看） */
    get pendingCount() {
      return pending.size;
    },
    get,
    getMany,
    set: (k, v) => write([[k, { value: copy(v) }]], (s) => idb.set(k, v, s)),
    setMany: (pairs) => write(pairs.map(([k, v]) => [k, { value: copy(v) }]), (s) => idb.setMany(pairs, s)),
    del: (k) => write([[k, { deleted: true }]], (s) => idb.del(k, s)),
    delMany,
    keys,
    // 先只读键、按前缀筛，再按需读值（库里还有缓存的行程和待上传的照片，不能全部读出来）
    async entries(prefix = '') {
      const ks = await keys(prefix);
      const vs = ks.length ? await getMany(ks) : [];
      return ks.map((k, i) => [k, vs[i]]);
    },
    async clear(prefix = '') {
      if (!prefix) {
        for (const k of [...pending.keys()]) pending.set(k, { deleted: true });
        const ok = await write([], (s) => idb.clear(s));
        if (ok) pending.clear();
        return ok;
      }
      let ks;
      try {
        ks = await keys(prefix);
      } catch {
        ks = [...pending.keys()].filter((k) => k.startsWith(prefix));
      }
      return ks.length ? delMany(ks) : true;
    },
    /** 立刻试着把待写入的补写进去（测试、开发页用；平时成功的读写之后自动补） */
    flush: () => flushPending() || Promise.resolve(),
  };
}
