// =====================================================================
// data/outbox.js：持久化写队列（乐观更新的“待发送改动”）。
//
// 每一次增 / 改 / 删 / 上传文件都先变成一条 op 进队列：
//   1. 立刻进内存 → TripStore 把它叠加在服务器数据上显示（乐观更新，界面马上变）；
//   2. 写进 IndexedDB（一条一个键 op:<序号>:<id>）→ 断网、关页面、手机杀后台都不会丢；
//   3. 按进队顺序一条一条发给后台（严格顺序：后面的改动可能依赖前面的，比如先建条目再改它）；
//   4. 成功：删掉这条，把服务器返回的行交给 TripStore（onApplied）；
//      暂时性失败（断网、超时、5xx、登录过期）：指数退避后重试（1s、2s、4s…最多 60s，带抖动），
//        联网（online 事件）、回到前台、用户点“重试”时立即再试；
//      永久性失败（没权限、不符合规则）：这条标成 failed、队列停在这里，界面显示原因，
//        用户选“重试”或“放弃这条改动”（放弃 = 撤回乐观更新，显示回服务器上的样子）。
//
// 省流量 / 减少冲突：
//   - update 只带真正改变的字段（diff 在 TripStore 里算好）；
//   - 和队尾那条是同一行时合并（insert+update → 一条 insert；update+update → 一条 update；
//     从没发出去过的 insert + delete → 两条都不用发）。只和队尾合并，保证顺序语义不变。
//
// 撤销：硬删除可以带 notBefore（例如 5 秒后才发），在这之前 cancel() 就等于没删过。
//
// 多个标签页：用 Web Locks 选出一个“发送者”，只有它发；其他标签页只把 op 写进 IndexedDB 并广播，
// 发送者收到后重新读队列。发送前再确认这条 op 还在库里（防止别的标签页已经发过、重复发送旧改动）。
// 发送者发完广播 applied（带 op id），放弃 / 撤销广播 dropped：发起这条改动的标签页据此兑现自己的
// synced（按钮的“转圈 → 对勾”不会一直转）。
//
// 本机存储出问题（kv.js：IndexedDB 读写失败）时：
//   - saved 兑现为 { durable: false }（改动只在内存里，关掉页面会丢），state.storage = 'memory'，界面可以提示；
//   - 发送前“确认还在库里”读不了：**暂停发送、稍后再试，不删除**（读失败 ≠ 没有）；
//     连续读不了 STORAGE_RETRY_LIMIT 次后照常发送（只有一个发送者，重复发送的后果有限：insert 撞主键转 update），
//     免得存储一直坏着时什么都同步不了；
//   - 读队列失败：保留内存里已有的队列，稍后重读，不清空。
//
// 未知错误（kind 'unknown'，例如后台返回了没见过的格式）：先按退避重试 UNKNOWN_RETRY_LIMIT 次，再标成失败。
// =====================================================================

import { signal } from '@preact/signals';
import { newId } from './util.js';
import { DataError, toDataError } from './errors.js';

export const OP_PREFIX = 'op:';
export const BLOB_PREFIX = 'blob:';
const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 60_000;
/** 未知错误先重试几次再标失败 */
export const UNKNOWN_RETRY_LIMIT = 2;
/** 发送前确认“还在库里”连续读不了几次后，照常发送 */
export const STORAGE_RETRY_LIMIT = 4;
/** 读队列失败后多久重读（毫秒） */
const RELOAD_RETRY_MS = 3000;

/** 第 n 次失败后等多久（毫秒）：1s、2s、4s…封顶 60s，乘 0.8–1.2 的抖动 */
export function backoffDelay(attempts, random = Math.random) {
  const base = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

const rowId = (tripId, table, key) => `${tripId}|${table}|${key}`;
/** 改数据行的 op；其余（upload / remove-files）不影响任何行的显示 */
const ROW_KINDS = new Set(['insert', 'update', 'delete']);

/**
 * @param {Object} o
 * @param {ReturnType<import('./kv.js').createKv>} o.kv
 * @param {(op: object) => Promise<object>} o.send            真正发给后台（layer 提供；抛 DataError）
 * @param {() => string|null} o.getUserId
 * @param {(e: { op: object, result: object }) => void} [o.onApplied]   服务器确认后
 * @param {(e: { op: object, reason: string }) => void} [o.onDropped]   放弃 / 取消后
 * @param {() => number} [o.now]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [o.timers]
 * @param {() => number} [o.random]
 * @param {() => boolean} [o.isOnline]
 * @param {{ postMessage: Function, addEventListener: Function, close?: Function } | null} [o.channel]  BroadcastChannel
 * @param {{ isLeader: () => boolean } | null} [o.leader]
 */
export function createOutbox(o) {
  const kv = o.kv;
  const now = o.now || (() => Date.now());
  const timers = o.timers || { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) };
  const random = o.random || Math.random;
  const isOnline = o.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const isLeader = () => (o.leader ? o.leader.isLeader() : true);
  const tabId = newId();

  /** 当前用户的 op（按 seq 排序） */
  let ops = [];
  /** rowId → op[]（同一行的改动，按顺序） */
  let byRow = new Map();
  let userId = null;
  let sendingId = null;
  let flushing = null;
  let again = false;
  let timer = null;
  let counter = 0;
  const waiters = new Map();
  const listeners = new Set();
  /** 这次会话里没能写进本机存储的 op id（存储恢复后补写成功会移出） */
  const volatile = new Set();
  /** 发送前确认“还在库里”连续读不了的次数 */
  let storageMisses = 0;
  /** 本机存储现在读不了（发送暂停中 / 读队列失败） */
  let storageDown = false;
  let reloadTimer = null;

  const state = signal({
    pending: 0, failed: null, sending: false, offline: false, nextAttemptAt: null, lastError: null, lastSyncedAt: null, held: 0,
    storage: 'ok',
  });

  // 存储恢复（kv.js 把内存里的待写入都补写进去了）：这些改动也落盘了
  kv.status?.subscribe?.((s) => {
    if (s === 'ok' && volatile.size) {
      volatile.clear();
      publish();
    }
  });

  function reindex() {
    byRow = new Map();
    for (const op of ops) {
      if (!ROW_KINDS.has(op.kind)) continue;
      const k = rowId(op.tripId, op.table, op.key);
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(op);
    }
  }

  function publish(patch = {}) {
    const failed = ops.find((x) => x.status === 'failed') || null;
    const head = ops[0];
    state.value = {
      ...state.value,
      pending: ops.length,
      held: ops.filter((x) => x.notBefore && x.notBefore > now()).length,
      failed: failed ? { id: failed.id, label: failed.label || '一条改动', error: DataError.from(failed.error) } : null,
      sending: sendingId !== null,
      nextAttemptAt: head && head.nextAttemptAt > now() ? head.nextAttemptAt : null,
      storage: ops.some((x) => volatile.has(x.id)) || kv.persistent === false ? 'memory' : storageDown ? 'unavailable' : 'ok',
      ...patch,
    };
  }

  function notify(rows) {
    const list = rows.filter(Boolean);
    for (const fn of listeners) {
      try {
        fn({ type: 'changed', rows: list });
      } catch (error) {
        console.error('[写队列] 监听者出错', error);
      }
    }
  }

  const rowsOf = (op) => (op && ROW_KINDS.has(op.kind) ? [{ tripId: op.tripId, table: op.table, key: op.key }] : []);

  function resolveWaiters(id, result) {
    const list = waiters.get(id);
    if (!list) return;
    waiters.delete(id);
    for (const fn of list) fn(result);
  }

  function makeSeq() {
    counter = (counter + 1) % 1000;
    return now() * 1000 + counter;
  }

  const kvKey = (op) => `${OP_PREFIX}${String(op.seq).padStart(17, '0')}:${op.id}`;

  /** 写进本机存储；返回 { durable }（false = 只在内存里） */
  async function persist(op) {
    let ok;
    try {
      ok = await kv.set(kvKey(op), op);
    } catch {
      ok = false;
    }
    const durable = ok !== false;
    if (durable) volatile.delete(op.id);
    else volatile.add(op.id);
    publish();
    return { durable };
  }

  /** 从本机存储删掉（失败不抛：kv.js 会在存储恢复后补删） */
  async function unpersist(op) {
    volatile.delete(op.id);
    try {
      await kv.del(kvKey(op));
    } catch {
      /* 忽略 */
    }
    if (op.kind === 'upload' && op.file?.blobKey) {
      try {
        await kv.del(op.file.blobKey);
      } catch {
        /* 忽略 */
      }
    }
  }

  function broadcast(msg) {
    try {
      o.channel?.postMessage({ ...msg, from: tabId });
    } catch {
      /* 忽略 */
    }
  }

  function schedule(ms) {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      flush();
    }, Math.max(0, ms));
  }

  /**
   * 进队。返回 { op, merged, synced }：
   *   synced：Promise，服务器确认后 resolve { ok: true, row }；永久失败 resolve { ok: false, error }；
   *           被取消 / 放弃 resolve { ok: false, cancelled|discarded: true }。从不 reject。
   * @param {object} input { tripId, table, kind, key, match, row?, patch?, local?, label?, notBefore?, file? }
   */
  function enqueue(input) {
    if (!userId) throw new DataError('请先登录', { kind: 'unauthenticated' });
    const op = {
      id: newId(), seq: makeSeq(), userId, createdAt: now(), attempts: 0, nextAttemptAt: 0, status: 'pending', error: null,
      notBefore: null, local: {}, label: null, ...input,
    };
    const synced = new Promise((resolve) => {
      if (!waiters.has(op.id)) waiters.set(op.id, []);
      waiters.get(op.id).push(resolve);
    });

    const tail = ops[ops.length - 1];
    const sameRow = tail && ROW_KINDS.has(op.kind) && ROW_KINDS.has(tail.kind) && tail.tripId === op.tripId && tail.table === op.table && tail.key === op.key;
    const mergeable = sameRow && isLeader() && tail.id !== sendingId && tail.status === 'pending' && !tail.notBefore && !op.notBefore;
    if (mergeable && op.kind === 'update' && (tail.kind === 'insert' || tail.kind === 'update')) {
      if (tail.kind === 'insert') tail.row = { ...tail.row, ...op.patch };
      else tail.patch = { ...tail.patch, ...op.patch };
      tail.local = { ...tail.local, ...op.local };
      if (op.label) tail.label = tail.kind === 'insert' ? tail.label : op.label;
      waiters.set(tail.id, [...(waiters.get(tail.id) || []), ...(waiters.get(op.id) || [])]);
      waiters.delete(op.id);
      const saved = persist(tail).then((r) => {
        broadcast({ type: 'ops' });
        return r;
      });
      notify(rowsOf(tail));
      publish();
      schedule(0);
      return { op: tail, merged: true, saved, synced };
    }
    if (mergeable && op.kind === 'delete' && tail.kind === 'insert' && tail.attempts === 0) {
      // 新建后还没发出去就删了：两条都不用发
      ops.pop();
      reindex();
      const saved = unpersist(tail).then(() => {
        broadcast({ type: 'ops' });
        return { durable: true };
      });
      resolveWaiters(tail.id, { ok: false, cancelled: true });
      notify(rowsOf(tail));
      publish();
      waiters.delete(op.id);
      return { op: null, merged: true, cancelled: true, saved, synced: Promise.resolve({ ok: true, cancelled: true }) };
    }

    ops.push(op);
    reindex();
    const saved = persist(op).then((r) => {
      broadcast({ type: 'ops' });
      return r;
    });
    notify(rowsOf(op));
    publish();
    if (op.notBefore) schedule(Math.max(0, op.notBefore - now()));
    else schedule(0);
    return { op, merged: false, saved, synced };
  }

  /** 撤销一条还没发出去的 op（撤销删除用）。正在发送的不能撤。返回是否撤成功 */
  async function cancel(opId) {
    const i = ops.findIndex((x) => x.id === opId);
    if (i === -1 || ops[i].id === sendingId) return false;
    const [op] = ops.splice(i, 1);
    reindex();
    notify(rowsOf(op));
    publish();
    resolveWaiters(op.id, { ok: false, cancelled: true });
    o.onDropped?.({ op, reason: 'cancelled' });
    await unpersist(op);
    broadcast({ type: 'dropped', id: op.id, reason: 'cancelled' });
    broadcast({ type: 'ops' });
    return true;
  }

  /** 放弃一条（一般是失败的那条）：撤回它的乐观更新 */
  async function discard(opId) {
    const i = ops.findIndex((x) => x.id === opId);
    if (i === -1 || ops[i].id === sendingId) return false;
    const [op] = ops.splice(i, 1);
    reindex();
    notify(rowsOf(op));
    resolveWaiters(op.id, { ok: false, discarded: true, error: op.error ? DataError.from(op.error) : null });
    o.onDropped?.({ op, reason: 'discarded' });
    await unpersist(op);
    broadcast({ type: 'dropped', id: op.id, reason: 'discarded' });
    broadcast({ type: 'ops' });
    publish({ lastError: null });
    schedule(0);
    return true;
  }

  /**
   * 放弃某个行程排队中的全部改动（被移出行程 / 行程被删：这些改动注定发不出去，留着会堵住别的行程）。
   * 正在发送的那条不动（发完会按结果处理）。返回放弃了几条。
   */
  async function discardTrip(tripId) {
    const drop = ops.filter((x) => x.tripId === tripId && x.id !== sendingId);
    if (!drop.length) return 0;
    const ids = new Set(drop.map((x) => x.id));
    ops = ops.filter((x) => !ids.has(x.id));
    reindex();
    for (const op of drop) {
      resolveWaiters(op.id, { ok: false, discarded: true, reason: 'removed' });
      o.onDropped?.({ op, reason: 'removed' });
    }
    notify(drop.flatMap(rowsOf));
    publish({ lastError: null });
    for (const op of drop) {
      await unpersist(op);
      broadcast({ type: 'dropped', id: op.id, reason: 'removed' });
    }
    broadcast({ type: 'ops' });
    schedule(0);
    return drop.length;
  }

  /** 重试：失败的那条恢复成待发，等待退避的立即再试 */
  async function retry(opId = null) {
    for (const op of ops) {
      if (opId && op.id !== opId) continue;
      if (op.status === 'failed' || op.nextAttemptAt > now()) {
        if (op.status === 'failed') {
          op.attempts = 0;
          op.error = null;
        }
        op.status = 'pending';
        op.nextAttemptAt = 0;
        await persist(op);
      }
    }
    publish({ offline: false });
    return flush();
  }

  /** 立即发送（不再等 notBefore；退出登录前用） */
  async function releaseHolds() {
    for (const op of ops) {
      if (op.notBefore) {
        op.notBefore = null;
        await persist(op);
      }
    }
    publish();
  }

  /** 一条一条发，直到队列空、遇到失败、需要等待（退避 / notBefore / 离线）为止 */
  function flush() {
    if (flushing) {
      again = true;
      return flushing;
    }
    if (!isLeader() || !userId) return Promise.resolve();
    flushing = (async () => {
      // 先让出一次：保证 flushing 赋值在循环体执行之前完成（否则同步跑完的循环会把 flushing 留成已结束的 Promise）
      await null;
      try {
        for (;;) {
          const op = ops[0];
          if (!op) break;
          if (op.status === 'failed') break;
          const t = now();
          if (op.notBefore && op.notBefore > t) {
            schedule(op.notBefore - t);
            break;
          }
          if (op.nextAttemptAt > t) {
            schedule(op.nextAttemptAt - t);
            break;
          }
          if (!isOnline()) {
            publish({ offline: true });
            break;
          }
          // 别的标签页可能已经发过这条（并从库里删掉了）：不要重复发送旧改动。
          // 读不了存储 ≠ 没有：暂停、稍后再试（连续读不了几次后照常发送，见文件头）
          let stored;
          try {
            stored = await kv.get(kvKey(op));
            storageMisses = 0;
            storageDown = false;
          } catch {
            storageMisses += 1;
            storageDown = true;
            if (storageMisses <= STORAGE_RETRY_LIMIT) {
              const wait = backoffDelay(storageMisses, random);
              publish({ nextAttemptAt: now() + wait });
              schedule(wait);
              break;
            }
            stored = op; // 一直读不了：当作还在（只有发送者会发）
          }
          if (!stored && !volatile.has(op.id)) {
            ops = ops.filter((x) => x.id !== op.id);
            reindex();
            notify(rowsOf(op));
            publish();
            continue;
          }
          sendingId = op.id;
          publish();
          let result;
          try {
            result = await o.send(op);
          } catch (e) {
            sendingId = null;
            const err = toDataError(e);
            op.error = err.toJSON();
            if (err.retryable || (err.kind === 'unknown' && op.attempts < UNKNOWN_RETRY_LIMIT)) {
              op.attempts += 1;
              op.nextAttemptAt = now() + backoffDelay(op.attempts, random);
              await persist(op);
              publish({ offline: err.kind === 'network', lastError: err });
              schedule(op.nextAttemptAt - now());
            } else {
              op.status = 'failed';
              await persist(op);
              publish({ lastError: err });
              resolveWaiters(op.id, { ok: false, error: err });
              notify(rowsOf(op));
            }
            break;
          }
          sendingId = null;
          ops = ops.filter((x) => x.id !== op.id);
          reindex();
          await unpersist(op);
          try {
            o.onApplied?.({ op, result: result || {} });
          } catch (error) {
            console.error('[写队列] 应用服务器结果出错', error);
          }
          broadcast({ type: 'applied', op: { id: op.id, tripId: op.tripId, table: op.table, key: op.key, kind: op.kind }, result: result || {} });
          broadcast({ type: 'ops' });
          notify(rowsOf(op));
          publish({ offline: false, lastError: null, lastSyncedAt: now() });
          resolveWaiters(op.id, { ok: true, row: result?.row ?? null, result: result || {} });
        }
      } finally {
        sendingId = null;
        flushing = null;
        publish();
        if (again) {
          again = false;
          schedule(0);
        }
      }
    })();
    return flushing;
  }

  /** 从 IndexedDB 读当前用户的队列（启动、换用户、别的标签页改了队列时） */
  async function load(uid = userId) {
    const sameUser = uid === userId;
    userId = uid;
    if (reloadTimer) timers.clearTimeout(reloadTimer);
    reloadTimer = null;
    const before = new Set(ops.filter((x) => ROW_KINDS.has(x.kind)).map((x) => rowId(x.tripId, x.table, x.key)));
    let entries;
    try {
      entries = uid ? await kv.entries(OP_PREFIX) : [];
    } catch {
      // 读不了存储：保留内存里已有的队列（同一个人时），过一会儿再读；不清空
      if (!sameUser) {
        ops = [];
        reindex();
      }
      reloadTimer = timers.setTimeout(() => {
        reloadTimer = null;
        load(userId);
      }, RELOAD_RETRY_MS);
      storageDown = true;
      publish();
      return ops.length;
    }
    storageDown = false;
    const previous = ops;
    const loaded = entries.map(([, v]) => v).filter((v) => v && v.userId === uid);
    // 这次会话里只在内存里的改动（存储没写进去）：库里读不到，但不能丢
    const loadedIds = new Set(loaded.map((x) => x.id));
    const keep = sameUser ? previous.filter((x) => volatile.has(x.id) && !loadedIds.has(x.id)) : [];
    ops = [...loaded, ...keep].sort((a, b) => a.seq - b.seq);
    // 别的标签页发掉 / 放弃了的改动：本标签页还有人在等（synced）的话，兑现掉（一般已经收到 applied / dropped 广播）
    const nowIds = new Set(ops.map((x) => x.id));
    for (const old of previous) {
      if (!nowIds.has(old.id) && waiters.has(old.id)) resolveWaiters(old.id, { ok: true, row: null, assumed: true });
    }
    for (const op of ops) {
      // 上一次发送到一半页面就关了：保持 pending，重新发（insert 重发撞主键会转成 update，见 layer.sendOp）
      if (op.status !== 'failed') op.status = 'pending';
    }
    reindex();
    const after = new Set(ops.filter((x) => ROW_KINDS.has(x.kind)).map((x) => rowId(x.tripId, x.table, x.key)));
    const changed = [...new Set([...before, ...after])].map((k) => {
      const [tripId, table, ...rest] = k.split('|');
      return { tripId, table, key: rest.join('|') };
    });
    notify(changed);
    publish();
    schedule(0);
    return ops.length;
  }

  /** 改了 id（日记 / 评级撞了唯一约束，改写到已有那一行时）：后面排队的同一行改动跟着改 */
  async function remap(tripId, table, oldKey, newKey, newMatch) {
    for (const op of ops) {
      // 正在发送的那条（就是撞了约束、被改写的那条）保持原来的键：发完后按原键通知，本地的临时行才会消失
      if (op.id === sendingId) continue;
      if (op.tripId === tripId && op.table === table && op.key === oldKey) {
        op.key = newKey;
        op.match = newMatch;
        if (op.row && op.row.id === oldKey) op.row = { ...op.row, id: newMatch.id };
        await persist(op);
      }
    }
    reindex();
  }

  /** 清空当前用户的队列（退出登录并确认放弃未同步改动时） */
  async function clear() {
    const list = ops;
    ops = [];
    reindex();
    for (const op of list) {
      resolveWaiters(op.id, { ok: false, discarded: true });
      await unpersist(op);
      broadcast({ type: 'dropped', id: op.id, reason: 'discarded' });
    }
    notify(list.flatMap(rowsOf));
    publish({ lastError: null, offline: false });
    broadcast({ type: 'ops' });
  }

  /** 等队列发完（或卡在失败 / 离线 / 超时）；返回剩下几条 */
  async function drain({ timeoutMs = 8000 } = {}) {
    const deadline = now() + timeoutMs;
    for (;;) {
      const before = ops[0]?.id;
      await flush();
      const head = ops[0];
      if (!head || head.status === 'failed' || !isOnline()) return ops.length;
      // 不是发送者的标签页发不了，交给发送者
      if (!isLeader()) return ops.length;
      const wait = Math.max(0, Math.max(head.nextAttemptAt || 0, head.notBefore || 0) - now());
      if (now() + wait > deadline) return ops.length;
      if (wait > 0) await new Promise((r) => timers.setTimeout(r, wait));
      else if (head.id === before) await new Promise((r) => timers.setTimeout(r, 50)); // 没有进展：稍等再看，避免空转
    }
  }

  // 别的标签页改了队列 / 发送成功
  o.channel?.addEventListener?.('message', (event) => {
    const msg = event?.data;
    if (!msg || msg.from === tabId) return;
    if (msg.type === 'ops') load(userId);
    else if (msg.type === 'applied') {
      try {
        o.onRemoteApplied?.(msg);
      } catch (error) {
        console.error('[写队列] 应用其他标签页的结果出错', error);
      }
      // 这条改动是本标签页发起的（别的标签页替我们发了）：兑现等待中的 synced
      const id = msg.op?.id;
      if (id && waiters.has(id)) resolveWaiters(id, { ok: true, row: msg.result?.row ?? null, result: msg.result || {}, remote: true });
    } else if (msg.type === 'dropped') {
      if (msg.id && waiters.has(msg.id)) {
        const reason = msg.reason === 'cancelled' ? { cancelled: true } : { discarded: true };
        resolveWaiters(msg.id, { ok: false, ...reason, remote: true });
      }
    }
  });

  return {
    state,
    get userId() { return userId; },
    get ops() { return ops; },
    get tabId() { return tabId; },
    enqueue,
    cancel,
    discard,
    discardTrip,
    retry,
    releaseHolds,
    flush,
    drain,
    load,
    remap,
    clear,
    /** 某一行排队中的改动（按顺序） */
    opsForRow(tripId, table, key) {
      return byRow.get(rowId(tripId, table, key)) || [];
    },
    /** 某个行程排队中的改动 */
    opsForTrip(tripId) {
      return ops.filter((x) => x.tripId === tripId);
    },
    /** 还没同步的改动数 */
    pendingCount() {
      return ops.length;
    },
    /** 订阅“哪些行的乐观状态变了” */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** 联网了 / 回到前台：等待中的立即再试 */
    wake() {
      let touched = false;
      for (const op of ops) {
        if (op.status === 'pending' && op.nextAttemptAt > now()) {
          op.nextAttemptAt = 0;
          touched = true;
        }
      }
      publish({ offline: !isOnline() });
      if (touched || ops.length) schedule(0);
    },
    dispose() {
      if (timer) timers.clearTimeout(timer);
      if (reloadTimer) timers.clearTimeout(reloadTimer);
      timer = null;
      reloadTimer = null;
      listeners.clear();
    },
  };
}

/**
 * 多个标签页里选一个“发送者”（Web Locks）。没有 Web Locks 的环境当自己是发送者。
 * @param {string} name
 * @param {() => void} [onBecomeLeader]
 */
export function createLeader(name, onBecomeLeader) {
  let leader = false;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    leader = true;
    return { isLeader: () => true, release() {} };
  }
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  locks.request(name, { mode: 'exclusive' }, () => {
    leader = true;
    onBecomeLeader?.();
    return held;
  }).catch(() => {
    leader = true;
  });
  return { isLeader: () => leader, release: () => release?.() };
}
