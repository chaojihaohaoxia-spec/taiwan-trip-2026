// =====================================================================
// data/layer.js：把数据层的各部分接起来（createDataLayer）。
//
//   后台（backend-supabase / backend-demo，同一套接口）
//     ├─ auth.js        登录状态、登录注册、退出前确认未同步数据
//     ├─ trips.js       全部行程列表（缓存 + 刷新）
//     ├─ trip-store.js  每个行程一个 TripStore（缓存 → 网络 → 实时；乐观更新叠加写队列）
//     ├─ outbox.js      持久化写队列（断网排队、按顺序重放、指数退避、失败可见可重试）
//     ├─ files.js       上传（压缩 + 进写队列）、签名链接缓存
//     └─ rpc.js         建行程、邀请、加入
//
// 这里负责：
//   - 写队列里每种 op 怎么发给后台（sendOp），包括冲突处理：
//       insert 撞主键（上次其实写成功了、只是没收到回复）→ 改成 update，内容以这次为准；
//       日记 / 评级撞“每人每天 / 每人每地点一条”（两台设备离线各写了一篇）→ 和已有的那一行**合并**
//         （正文拼接、照片 / 清单合并去重、评分等单值以这次为准），id 换成已有那一行的，提示一句“已合并”；
//       update 发现行已经被删了 → 本地也删掉，不算失败；
//       401 登录过期 → 先刷新令牌再重试；
//       上传时本机存储读不了 → 暂时性错误（存储恢复后重试）；照片数据确实不在了 → 标失败（看得见、可以放弃），不当成功；
//   - 服务器确认后把行交给对应的 TripStore（行程没打开就直接改缓存）；
//   - 被移出行程 / 自己退出 / 行程被删：这个行程排队中的改动注定发不出去，丢弃并提示（不堵住别的行程的同步）；
//   - 换账号：清空内存里的行程、重载这个人的写队列、刷新行程列表；
//   - 同步状态（syncStatus）、撤销提示（undoable）、时钟（clockTick，每 30 秒，回到前台立即）；
//   - 行程的打开 / 关闭（retainTrip）：页面用到就打开（订阅实时）；最后一个用它的页面离开 15 秒后退订；
//     同一个行程里换页面不会重新拉整包（实时在线、刚同步过时只确认订阅，见 trip-store.js 的 open）；
//   - 联网 / 回到前台：写队列立即重试，打开的行程补拉一次（断开期间的实时推送收不到）。
//
// 测试时直接用 createDataLayer({ backend: 假后台, kv: createMemoryKv() … })，不需要浏览器。
// =====================================================================

import { signal, computed } from '@preact/signals';
import { now as clockNow } from '../lib/clock.js';
import { notify } from '../lib/notify.js';
import { createOutbox } from './outbox.js';
import { createTripStore } from './trip-store.js';
import { createTripsList } from './trips.js';
import { createAuth } from './auth.js';
import { createFiles } from './files.js';
import { createRpc } from './rpc.js';
import { patchTripCache, clearTripCaches } from './cache.js';
import { DataError, toDataError } from './errors.js';
import { keyColumns, normalizeIncomingRow } from './tables.js';
import { fxRates as defaultFx } from './fx.js';
import { newId, deepEqual } from './util.js';
import { local } from '../lib/storage.js';

/** 退出登录时一起清掉的本机内容（翻译页翻过的、收藏的句子、称呼：可能有酒店地址这类内容，共用设备时不留，代码评审 P3） */
const LOCAL_ON_SIGN_OUT = Object.freeze(['translate:recent', 'translate:star', 'translate:honor']);

/** 撞了这些唯一约束时，改写到已有的那一行（每人每天一篇日记、每人每个地点一条评级） */
const REBASE_UNIQUE = Object.freeze({
  journal_entries: ['day_id', 'user_id'],
  reviews: ['place_id', 'user_id'],
});

const MAX_STORES = 4;
const STALE_AFTER_HIDDEN_MS = 30_000;
/** 最后一个用到某行程的页面离开后，多久退订它的实时（换页面时不会断开重连） */
export const TRIP_RELEASE_GRACE_MS = 15_000;

/** 两段文字合并：一样 / 一段包含另一段 → 取长的；否则按“已有\n\n这次”拼起来 */
function mergeText(a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x) return b ?? a ?? '';
  if (!y || x === y || x.includes(y)) return a;
  if (y.includes(x)) return b;
  return `${a}\n\n${b}`;
}

/** 两个数组合并去重（照片按 path；其他按值），已有的在前 */
function mergeList(a, b) {
  const out = Array.isArray(a) ? [...a] : [];
  const keyOf = (v) => (v && typeof v === 'object' && v.path ? `path:${v.path}` : JSON.stringify(v));
  const seen = new Set(out.map(keyOf));
  for (const v of Array.isArray(b) ? b : []) {
    const k = keyOf(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/**
 * 日记 / 评级撞了“每人一条”：把这次要写的内容和已有那一行合并成要提交的改动（纯函数，单元测试覆盖）。
 * 正文 / 备注拼接，照片 / 吃了什么 / 买了什么合并去重；心情、评分、关联条目、到访时间这类单值以这次为准（这次没填就保留已有的）。
 * @returns {object} 只含要改的列（没有 id / trip_id / 唯一键列）
 */
export function mergeUniqueRow(table, existing, mine) {
  const out = {};
  const set = (k, v) => {
    if (!deepEqual(existing?.[k], v)) out[k] = v;
  };
  if (table === 'journal_entries') {
    set('body', mergeText(existing?.body, mine.body));
    set('photos', mergeList(existing?.photos, mine.photos));
    if (mine.mood !== undefined && mine.mood !== null) set('mood', mine.mood);
    return out;
  }
  if (table === 'reviews') {
    set('notes', mergeText(existing?.notes, mine.notes));
    for (const k of ['photos', 'food_log', 'shop_log']) set(k, mergeList(existing?.[k], mine[k]));
    for (const k of ['rating', 'item_id', 'visited_at']) if (mine[k] !== undefined && mine[k] !== null) set(k, mine[k]);
    return out;
  }
  return out;
}

function isPkeyConflict(err) {
  const text = `${err?.cause?.message || ''} ${err?.cause?.details || ''} ${err?.message || ''}`;
  return err?.kind === 'conflict' && /_pkey\b/.test(text);
}

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k]]));

/**
 * @param {Object} o
 * @param {object} o.backend
 * @param {object} o.kv
 * @param {boolean} [o.demo]
 * @param {() => Date} [o.now]                 现在（默认 lib/clock.js，支持 ?now= 拨时间）
 * @param {{ setTimeout: Function, clearTimeout: Function, setInterval?: Function, clearInterval?: Function }} [o.timers]
 * @param {() => boolean} [o.isOnline]
 * @param {object|null} [o.channel]            BroadcastChannel（多标签页）
 * @param {object|null} [o.leader]             createLeader(...)
 * @param {() => number} [o.random]
 * @param {import('@preact/signals').Signal} [o.fxRates]
 * @param {() => object|null} [o.storedUser]       本机保存的会话里的用户（session.js；恢复会话失败时先按离线已登录）
 */
export function createDataLayer(o) {
  const backend = o.backend;
  const kv = o.kv;
  const nowDate = o.now || clockNow;
  const timers = o.timers || {
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (...a) => setInterval(...a),
    clearInterval: (t) => clearInterval(t),
  };
  const isOnline = o.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const fxRates = o.fxRates || defaultFx;

  const userId = signal(null);
  const getUserId = () => userId.value;
  const online = signal(isOnline());
  const clockTick = signal(0);
  /** 最近一次可撤销的删除：{ id, label, undo, expiresAt }（页面显示“已删除 · 撤销”） */
  const undoable = signal(null);
  const activeStore = signal(null);
  const stores = new Map();
  let undoTimer = null;

  const trips = createTripsList({ backend, kv, getUserId });

  // ------------------------------------------------------------------
  // 写队列 → 后台
  // ------------------------------------------------------------------
  async function sendRaw(op) {
    switch (op.kind) {
      case 'insert': {
        try {
          return { row: await backend.insert(op.table, op.row) };
        } catch (e) {
          const err = toDataError(e);
          if (err.kind !== 'conflict') throw err;
          if (isPkeyConflict(err)) {
            // 上一次其实已经写进去了：改成 update，内容以这次为准
            const row = await backend.update(op.table, op.match, omit(op.row, [...keyColumns(op.table), 'trip_id', 'user_id']));
            if (row) return { row };
            throw err;
          }
          const uniq = REBASE_UNIQUE[op.table];
          if (uniq) {
            const existing = await backend.fetchRow(op.table, { trip_id: op.tripId, ...pick(op.row, uniq) });
            if (existing) {
              const tempKey = op.key;
              // 两台设备各写了一篇：合并，不整条覆盖另一台写的内容
              const patch = mergeUniqueRow(op.table, existing, op.row);
              const row = Object.keys(patch).length ? await backend.update(op.table, { id: existing.id }, patch) : existing;
              if (row) {
                // 后面排队的同一行改动改写到已有那一行；本地的临时行在这条发完后消失
                await outbox.remap(op.tripId, op.table, tempKey, row.id, { id: row.id });
                notify(op.table === 'journal_entries' ? '这一天的日记在另一台设备上也写过，已经合并在一起' : '这个地点在另一台设备上也评过，已经合并在一起', { tone: 'info', key: `merge:${row.id}` });
                return { row, remapFrom: tempKey };
              }
            }
          }
          throw err;
        }
      }
      case 'update': {
        const row = await backend.update(op.table, op.match, op.patch);
        return row ? { row } : { gone: true };
      }
      case 'delete':
        await backend.remove(op.table, op.match);
        return { deleted: true };
      case 'upload': {
        let blob;
        try {
          blob = await kv.get(op.file.blobKey);
        } catch (e) {
          // 读不了 ≠ 没有：存储恢复后再传（kind 'storage' 可重试）
          throw new DataError('这台设备的存储暂时不可用，照片稍后再上传', { kind: 'storage', cause: e });
        }
        if (!blob) {
          // 照片数据真的不在了（被系统清理）：标失败，界面看得见、可以放弃；不能当成上传成功
          throw new DataError('这张照片在这台设备上找不到了（可能被系统清理了），请放弃这条改动后重新选择照片', { kind: 'validation', code: 'blob-missing' });
        }
        await backend.upload(op.file.path, blob, op.file.contentType);
        // 照片数据和这条改动一起删（outbox 的 unpersist）：中途关掉页面，重放时数据还在
        return { uploaded: op.file.path };
      }
      case 'remove-files':
        await backend.removeFiles(op.paths || []);
        return { removed: op.paths || [] };
      default:
        throw toDataError(new Error(`未知的改动类型：${op.kind}`));
    }
  }

  async function sendOp(op) {
    try {
      return await sendRaw(op);
    } catch (e) {
      const err = toDataError(e);
      if (err.kind === 'auth') await auth.refresh();
      throw err;
    }
  }

  /** 服务器确认了一条改动：交给打开的 TripStore，没打开就改缓存 */
  function applyResult(op, result) {
    if (op.kind === 'upload') {
      files.onUploaded?.(op.file?.path);
      return;
    }
    if (op.kind === 'remove-files') return;
    const store = stores.get(op.tripId);
    const uid = getUserId();
    if (result.row) {
      if (store) store.applyServerRow(op.table, result.row);
      else if (uid) patchTripCache(kv, op.tripId, uid, op.table, { row: normalizeIncomingRow(op.table, result.row) });
      if (op.table === 'trips') trips.upsertTrip(normalizeIncomingRow('trips', result.row));
    }
    if (result.remapFrom && store) store.removeServerRow(op.table, result.remapFrom);
    if (result.gone || op.kind === 'delete') {
      if (store) store.removeServerRow(op.table, op.key);
      else if (uid) patchTripCache(kv, op.tripId, uid, op.table, { deleteKey: op.key });
      if (op.table === 'trips') {
        trips.removeTrip(op.key);
        dropTripChanges(op.key);
      }
      if (op.table === 'trip_members' && op.key === `${op.tripId}|${uid}`) {
        trips.removeTrip(op.tripId);
        dropTripChanges(op.tripId);
      }
    }
  }

  /** 不在这个行程里了：丢掉它排队中的改动（注定发不出去），并提示 */
  async function dropTripChanges(tripId) {
    const n = await outbox.discardTrip(tripId);
    if (n > 0) notify(`你已经不在这个行程里了，${n} 条没同步的改动已丢弃`, { tone: 'warning', key: `removed:${tripId}` });
  }

  const outbox = createOutbox({
    kv,
    send: sendOp,
    getUserId,
    timers,
    random: o.random,
    isOnline: () => online.value && isOnline(),
    channel: o.channel || null,
    leader: o.leader || null,
    onApplied: ({ op, result }) => applyResult(op, result),
    onRemoteApplied: (msg) => applyResult(msg.op, msg.result || {}),
  });

  const files = createFiles({ backend, kv, outbox, getUserId });

  // ------------------------------------------------------------------
  // 登录状态
  // ------------------------------------------------------------------
  async function onUserChange(prevId, nextId) {
    userId.value = nextId;
    for (const s of stores.values()) s.dispose();
    stores.clear();
    activeStore.value = null;
    trips.reset();
    files.reset();
    undoable.value = null;
    await outbox.load(nextId);
    if (nextId) trips.load();
  }

  async function clearLocal() {
    await clearTripCaches(kv);
    for (const k of LOCAL_ON_SIGN_OUT) local.remove(k);
  }

  const auth = createAuth({ backend, outbox, onUserChange, clearLocal, storedUser: o.storedUser || null, timers });
  const rpc = createRpc({ backend, getUserId, trips, isOnline: () => online.value && isOnline() });

  // ------------------------------------------------------------------
  // 行程
  // ------------------------------------------------------------------
  function offerUndo(u) {
    const id = newId();
    undoable.value = { id, ...u };
    if (undoTimer) timers.clearTimeout(undoTimer);
    undoTimer = timers.setTimeout(() => {
      if (undoable.value?.id === id) undoable.value = null;
    }, Math.max(0, u.expiresAt - Date.now()));
  }

  /** 拿到某个行程的 TripStore（不加载；第一次会创建） */
  function getStore(tripId) {
    let s = stores.get(tripId);
    if (s) {
      stores.delete(tripId);
      stores.set(tripId, s); // LRU：最近用的放最后
      return s;
    }
    s = createTripStore({
      tripId, backend, kv, outbox, files, getUserId, userIdSignal: userId, clockTick, fxRates,
      now: nowDate,
      ready: () => auth.init(),
      onTripRow: (row) => trips.upsertTrip(row),
      onUndoable: offerUndo,
      onRemoved: (id) => dropTripChanges(id),
    });
    stores.set(tripId, s);
    // 内存里最多留几个行程；最久没用的销毁（数据还在 IndexedDB 缓存里）
    while (stores.size > MAX_STORES) {
      const [oldId, old] = stores.entries().next().value;
      if (old === activeStore.value) break;
      old.dispose();
      stores.delete(oldId);
    }
    return s;
  }

  /** 进入一个行程：退订上一个行程的实时，订阅这个；先显示缓存，后台刷新（刚同步过、实时在线时不重拉） */
  function openTrip(tripId) {
    const prev = activeStore.value;
    if (prev && prev.tripId !== tripId) prev.close();
    const s = getStore(tripId);
    activeStore.value = s;
    s.open().catch((e) => console.error('[数据] 打开行程失败', e));
    return s;
  }

  /** 离开行程页（例如回到行程列表）：退订实时。tripId 给了就只在当前打开的正是它时才关 */
  function closeTrip(tripId) {
    const s = activeStore.value;
    if (!s || (tripId && s.tripId !== tripId)) return;
    s.close();
    activeStore.value = null;
  }

  /** 行程 → 正在用它的页面数；最后一个离开后的延迟退订 */
  const holds = new Map();
  const releaseTimers = new Map();

  /**
   * 页面用到一个行程（hooks.js 的 useTrip 调用）：打开它；返回 release()，页面离开时调用。
   * 最后一个用它的页面离开 TRIP_RELEASE_GRACE_MS 后才退订（换页面时不会断开重连、不会重拉整包）。
   */
  function retainTrip(tripId) {
    holds.set(tripId, (holds.get(tripId) || 0) + 1);
    const t = releaseTimers.get(tripId);
    if (t) {
      timers.clearTimeout(t);
      releaseTimers.delete(tripId);
    }
    openTrip(tripId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = Math.max(0, (holds.get(tripId) || 0) - 1);
      if (n > 0) {
        holds.set(tripId, n);
        return;
      }
      holds.delete(tripId);
      releaseTimers.set(tripId, timers.setTimeout(() => {
        releaseTimers.delete(tripId);
        if (!holds.get(tripId)) closeTrip(tripId);
      }, TRIP_RELEASE_GRACE_MS));
    };
  }

  // ------------------------------------------------------------------
  // 同步状态（给顶栏 / 设置页显示）
  // ------------------------------------------------------------------
  const syncStatus = computed(() => {
    const ob = outbox.state.value;
    const on = online.value;
    const store = activeStore.value;
    const active = Math.max(0, ob.pending - ob.held);
    // 本机存储：'memory' = 有改动只在内存里（关掉页面会丢）；'unavailable' = 暂时读不了，发送暂停
    const storage = ob.storage || 'ok';
    const storageWarning = storage === 'memory' && ob.pending
      ? '这台设备的存储暂时不可用：改动只在内存里，同步完成前请不要关掉页面'
      : storage === 'unavailable' ? '这台设备的存储暂时读不了，稍后自动重试' : null;
    const extra = { storage, storageWarning };
    if (ob.failed) {
      return { state: 'error', pending: ob.pending, message: `有改动没保存成功：${ob.failed.error.message}`, failed: ob.failed, canRetry: true, canDiscard: true, ...extra };
    }
    if (!on || ob.offline) {
      return { state: 'offline', pending: ob.pending, message: ob.pending ? `离线 · ${ob.pending} 条改动联网后自动同步` : '离线 · 显示的是上次同步的内容', canRetry: ob.pending > 0, ...extra };
    }
    if (active > 0 && ob.lastError && ob.nextAttemptAt) {
      return { state: 'retrying', pending: ob.pending, message: `${active} 条改动暂时没同步上，稍后自动重试`, error: ob.lastError, canRetry: true, ...extra };
    }
    if (active > 0) return { state: 'syncing', pending: ob.pending, message: `正在同步 ${active} 条改动…`, ...extra };
    if (store && store.status.value === 'error') return { state: 'stale', pending: 0, message: store.error.value?.message || '行程没有加载成功', canRetry: true, ...extra };
    return { state: 'synced', pending: 0, message: '已同步', ...extra };
  });

  /** 重试：写队列里失败 / 等待中的立即再发；打开的行程加载失败的话也重新加载 */
  function retrySync() {
    const s = activeStore.value;
    if (s && (s.status.value === 'error' || s.error.value)) s.refresh();
    return outbox.retry();
  }

  /** 放弃失败的那条改动（界面回到服务器上的样子） */
  function discardFailed() {
    const f = outbox.state.value.failed;
    return f ? outbox.discard(f.id) : Promise.resolve(false);
  }

  // ------------------------------------------------------------------
  // 浏览器环境：联网 / 断网、回到前台、时钟
  // ------------------------------------------------------------------
  let hiddenAt = 0;
  function attachEnvironment(win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null) {
    if (!win) return () => {};
    const onOnline = () => {
      online.value = true;
      auth.retryInit();
      outbox.wake();
      activeStore.value?.refresh();
    };
    const onOffline = () => {
      online.value = false;
      outbox.wake();
    };
    const onVisible = () => {
      if (!doc) return;
      if (doc.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      clockTick.value += 1;
      auth.retryInit();
      outbox.wake();
      const s = activeStore.value;
      if (s && hiddenAt && (Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS || s.realtime.value !== 'live')) s.refresh();
      hiddenAt = 0;
    };
    win.addEventListener('online', onOnline);
    win.addEventListener('offline', onOffline);
    doc?.addEventListener('visibilitychange', onVisible);
    win.addEventListener('pageshow', onVisible);
    const tick = timers.setInterval?.(() => {
      if (!doc || doc.visibilityState !== 'hidden') clockTick.value += 1;
    }, 30_000);
    return () => {
      win.removeEventListener('online', onOnline);
      win.removeEventListener('offline', onOffline);
      doc?.removeEventListener('visibilitychange', onVisible);
      win.removeEventListener('pageshow', onVisible);
      if (tick) timers.clearInterval?.(tick);
    };
  }

  return {
    demo: Boolean(o.demo),
    backend,
    kv,
    auth,
    userId,
    online,
    clockTick,
    trips,
    outbox,
    files,
    rpc,
    undoable,
    activeStore,
    syncStatus,
    fxRates,
    getStore,
    openTrip,
    closeTrip,
    retainTrip,
    retrySync,
    discardFailed,
    attachEnvironment,
    /** 测试 / 开发页：清掉所有本机缓存（不动写队列） */
    clearCaches: () => clearTripCaches(kv),
    dispose() {
      for (const s of stores.values()) s.dispose();
      stores.clear();
      outbox.dispose();
      if (undoTimer) timers.clearTimeout(undoTimer);
      undoTimer = null;
      auth.dispose();
      for (const t of releaseTimers.values()) timers.clearTimeout(t);
      releaseTimers.clear();
    },
  };
}
