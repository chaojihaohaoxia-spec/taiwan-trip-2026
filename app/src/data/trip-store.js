// =====================================================================
// data/trip-store.js：一个行程的数据（TripStore）。
//
// 三层：
//   base     服务器确认过的行（来自：IndexedDB 缓存 → 网络整包加载 → 实时推送 → 写队列确认）
//   写队列   还没同步的改动（outbox.js，持久化在 IndexedDB）
//   visible  = base + 写队列里这个行程的改动依次叠加 → 页面看到的就是它（乐观更新）
// 服务器的新行到了只替换 base，visible 重新叠加一次，所以：
//   - 自己的改动没同步完时，对方的推送不会把它“冲掉”；
//   - 放弃一条失败的改动 = 删掉那条 op，visible 自动回到服务器的样子（不用另外回滚）。
//
// 对外（signals，组件里读 .value 自动订阅）：
//   store.status      'idle' | 'loading' | 'ready' | 'error' | 'missing'（不存在 / 不是成员）| 'removed'（被移出 / 行程被删）
//   store.source      'cache' | 'network'   store.refreshing   store.syncedAt   store.error   store.realtime
//   store.tables.<表>  Map<键, 行>（trip_members 的键是 'trip_id|user_id'，其余是 id；含软删除的行）
//   store.trip        行程这一行
//   store.view.*      派生数据（computed，见下面 buildView；只依赖真正读到的表）
// 写（都会先校验、检查权限，然后乐观更新 + 进写队列；返回 { row, saved, synced, undo? }）：
//   insert / update / remove / softDelete / restore / move，以及 addExpense、toggleTodo、saveJournal… 便捷方法
//
// 一致性细节：
//   - 实时推送按 updated_at 防乱序：比手上的旧就忽略；
//   - 整包刷新期间收到的推送 / 写入确认不会被刷新结果覆盖（touched 记录每行最后一次变动的序号）；
//   - 删除的级联（删一天 → 当天条目进备选池、当天日记删掉）在本地按 SQL 的外键规则同样执行，
//     乐观删除还没发出去时也一样（删一天后条目立刻出现在备选池）；
//   - 时间戳按“时刻”比较，不按字符串（Postgres 返回时去掉小数末尾的 0：'…00.12+00:00' 和本地的 '…00.120+00:00' 是同一刻）；
//   - 被移出行程 / 行程被删（status 'removed'）之后不再写本机缓存，排队中的改动交给 layer 丢弃并提示。
//
// 打开（open）：
//   - 第一次：等登录状态 → 先显示缓存 → 订阅实时 → 后台整包刷新；
//   - 已经打开着、实时在线、FRESH_MS 内刷新过：只确认订阅，不重拉（同一个行程里换页面不会每次都拉 13 张表）；
//     刷新交给联网、回到前台、断线重连（layer.js / subscribe 里）；
//   - 打开到一半被关掉（close）：作废这次打开，不会在关掉之后又订阅上。
// =====================================================================

import { signal, computed, batch } from '@preact/signals';
import { TABLES, defaultsFor, SOFT_DELETE_TABLES } from './schema.js';
import {
  BUNDLE_TABLES, SHARED_TABLES, PERSONAL_TABLES, REFERENCES, rowKey, matchOf, writableColumns, readonlyOnUpdate,
  assertValidRow, normalizeValues, normalizeIncomingRow, FIELD_LABELS,
} from './tables.js';
import { DataError, toDataError } from './errors.js';
import { newId, toTimestamptz, diffPatch, tsMs } from './util.js';
import { normalizeCurrency, roundMoney, fromMinor } from './fx.js';
import { formatMoney } from '../lib/money.js';
import { readTripCache, writeTripCache, deleteTripCache } from './cache.js';
import { planMove, nextSortValue } from './ordering.js';
import * as S from './selectors.js';

/** 反向引用：被引用的表 → [{ table, col, action }] */
const DEPENDENTS = (() => {
  const out = new Map();
  for (const [table, cols] of Object.entries(REFERENCES)) {
    for (const [col, [target, action]] of Object.entries(cols)) {
      if (!out.has(target)) out.set(target, []);
      out.get(target).push({ table, col, action });
    }
  }
  return out;
})();

const VIEWER_MESSAGE = '你是只读成员，不能修改行程内容';
/** 刷新过多久以内、实时又在线时，再次 open() 不重拉整包 */
export const FRESH_MS = 5 * 60 * 1000;
const LABELS = {
  segments: '分段', places: '地点', bookings: '预订', days: '日期', items: '行程条目', contacts: '联系人', todos: '清单项',
  tips: '贴士', journal_entries: '日记', reviews: '评级', expenses: '记账', trips: '行程', trip_members: '成员',
};

/**
 * @param {Object} deps
 * @param {string} deps.tripId
 * @param {object} deps.backend
 * @param {object} deps.kv
 * @param {object} deps.outbox
 * @param {() => string|null} deps.getUserId
 * @param {import('@preact/signals').Signal} deps.clockTick   每 30 秒变一次（时间相关的派生数据靠它刷新）
 * @param {import('@preact/signals').Signal} deps.fxRates
 * @param {() => Date} deps.now
 * @param {(row: object|null) => void} [deps.onTripRow]      行程这一行变了（同步到“全部行程”列表）
 * @param {(u: object) => void} [deps.onUndoable]             删除后登记“撤销”
 * @param {() => Promise<any>} [deps.ready]                   打开前等登录状态恢复
 * @param {import('@preact/signals').Signal} [deps.userIdSignal]  当前用户 id（换账号时 myRole 重算）
 * @param {object} [deps.files]                               files.js（store.upload 用）
 */
export function createTripStore(deps) {
  const { tripId, outbox, kv } = deps;
  const getUserId = deps.getUserId;
  const nowDate = deps.now || (() => new Date());

  const base = new Map(BUNDLE_TABLES.map((t) => [t, new Map()]));
  const working = new Map(BUNDLE_TABLES.map((t) => [t, new Map()]));
  const tables = Object.fromEntries(BUNDLE_TABLES.map((t) => [t, signal(new Map())]));
  const touched = new Map();
  let touchSeq = 0;

  const status = signal('idle');
  const source = signal(null);
  const error = signal(null);
  const refreshing = signal(false);
  const syncedAt = signal(null);
  const realtime = signal('off');

  let openPromise = null;
  let unsubscribeRealtime = null;
  let refreshPromise = null;
  let persistTimer = null;
  let disposed = false;
  let everLive = false;
  /** 每次 close() 加一：打开到一半被关掉时，这次打开作废（不会在关掉之后又订阅上） */
  let openSeq = 0;
  /** 最近一次整包刷新成功的时刻（毫秒） */
  let lastRefreshAt = 0;
  /** 不在这个行程里了 / 行程不存在：不再写本机缓存 */
  let gone = false;

  const touch = (table, key) => touched.set(`${table}|${key}`, ++touchSeq);
  const touchedAfter = (table, key, seq) => (touched.get(`${table}|${key}`) || 0) > seq;

  // -------------------------------------------------------------------
  // 叠加：visible = base + 写队列
  // -------------------------------------------------------------------

  function applyOp(row, op) {
    if (op.kind === 'insert') return { ...(row || {}), ...op.row, ...op.local };
    if (op.kind === 'update') return row ? { ...row, ...op.patch, ...op.local } : null;
    if (op.kind === 'delete') return null;
    return row;
  }

  /** 引用的行正在被删除（写队列里这一行的最后一条改动是 delete，乐观） */
  function pendingDeleted(table, id) {
    const ops = outbox.opsForRow(tripId, table, id);
    return ops.length > 0 && ops[ops.length - 1].kind === 'delete';
  }

  function computeRow(table, key) {
    let row = base.get(table).get(key) || null;
    for (const op of outbox.opsForRow(tripId, table, key)) row = applyOp(row, op);
    if (!row) return null;
    const refs = REFERENCES[table];
    if (refs) {
      for (const [col, [target, action]] of Object.entries(refs)) {
        const v = row[col];
        if (v && pendingDeleted(target, v)) {
          if (action === 'cascade') return null;
          row = { ...row, [col]: null };
        }
      }
    }
    return Object.isFrozen(row) ? row : Object.freeze(row);
  }

  /**
   * 重算若干行并发布。presence 变了（出现 / 消失）的行，把引用它的行也重算一遍（级联显示）。
   * @param {Array<[string, string]>} pairs [table, key]
   */
  function recompute(pairs) {
    const dirty = new Set();
    const queue = [...pairs];
    // 同一行最多算 3 次（引用它的行出现 / 消失时要重算；限次防止自引用的环）
    const visits = new Map();
    while (queue.length) {
      const [table, key] = queue.shift();
      const id = `${table}|${key}`;
      const n = visits.get(id) || 0;
      if (n >= 3) continue;
      visits.set(id, n + 1);
      const w = working.get(table);
      const before = w.get(key) || null;
      const after = computeRow(table, key);
      if (before === after) continue;
      if (after) w.set(key, after);
      else w.delete(key);
      dirty.add(table);
      if (Boolean(before) !== Boolean(after)) {
        for (const dep of DEPENDENTS.get(table) || []) {
          for (const [k, r] of base.get(dep.table)) if (r[dep.col] === key) queue.push([dep.table, k]);
          for (const op of outbox.opsForTrip(tripId)) {
            if (op.table === dep.table && (op.row?.[dep.col] === key || op.patch?.[dep.col] === key)) queue.push([dep.table, op.key]);
          }
        }
      }
    }
    if (!dirty.size) return;
    batch(() => {
      for (const t of dirty) tables[t].value = new Map(working.get(t));
    });
    if (dirty.has('trips')) deps.onTripRow?.(working.get('trips').get(tripId) || null);
  }

  function recomputeTable(table) {
    const keys = new Set([...base.get(table).keys(), ...working.get(table).keys()]);
    for (const op of outbox.opsForTrip(tripId)) if (op.table === table) keys.add(op.key);
    recompute([...keys].map((k) => [table, k]));
  }

  // 写队列的改动 → 重算相关行
  const offOutbox = outbox.subscribe((e) => {
    if (disposed) return;
    const pairs = e.rows.filter((r) => r.tripId === tripId).map((r) => [r.table, r.key]);
    if (pairs.length) recompute(pairs);
  });

  // -------------------------------------------------------------------
  // 服务器的行进 base
  // -------------------------------------------------------------------

  function belongs(table, row) {
    if (table === 'trips') return row.id === tripId;
    return row.trip_id === tripId;
  }

  function isOlder(next, prev) {
    const a = tsMs(next.updated_at);
    const b = tsMs(prev.updated_at);
    return Number.isFinite(a) && Number.isFinite(b) && a < b;
  }

  /** 服务器的一行（推送 / 写入确认 / 别的标签页广播）→ base */
  function applyServerRow(table, raw, { force = false } = {}) {
    if (!BUNDLE_TABLES.includes(table) || !raw) return;
    const row = normalizeIncomingRow(table, raw);
    if (!belongs(table, row)) return;
    const key = rowKey(table, row);
    const prev = base.get(table).get(key);
    if (prev && !force && isOlder(row, prev)) return;
    base.get(table).set(key, row);
    touch(table, key);
    if (table === 'trip_members' && row.user_id === getUserId() && status.value === 'removed') {
      status.value = 'ready';
      gone = false;
    }
    recompute([[table, key]]);
    schedulePersist();
  }

  /** 按 SQL 的外键规则在 base 里级联（置空 / 删除），返回变了的 [table, key] */
  function cascadeBase(table, key, out = []) {
    for (const dep of DEPENDENTS.get(table) || []) {
      for (const [k, r] of [...base.get(dep.table)]) {
        if (r[dep.col] !== key) continue;
        if (dep.action === 'cascade') {
          base.get(dep.table).delete(k);
          touch(dep.table, k);
          out.push([dep.table, k]);
          cascadeBase(dep.table, k, out);
        } else {
          base.get(dep.table).set(k, Object.freeze({ ...r, [dep.col]: null }));
          touch(dep.table, k);
          out.push([dep.table, k]);
        }
      }
    }
    return out;
  }

  /** 服务器上删掉了一行 → base（含级联） */
  function removeServerRow(table, key) {
    if (!BUNDLE_TABLES.includes(table)) return;
    const had = base.get(table).delete(key);
    touch(table, key);
    const changed = had ? cascadeBase(table, key) : [];
    const lostAccess = (table === 'trips' && key === tripId) || (table === 'trip_members' && key === `${tripId}|${getUserId()}`);
    if (lostAccess) markGone('removed');
    recompute([[table, key], ...changed]);
    schedulePersist();
  }

  /** 不在这个行程里了（被移出、自己退出、行程被删）或行程不存在：删缓存、以后不再写；通知 layer 丢弃排队中的改动 */
  function markGone(nextStatus) {
    const first = !gone;
    gone = true;
    status.value = nextStatus;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    deleteTripCache(kv, tripId);
    if (first && nextStatus === 'removed') deps.onRemoved?.(tripId);
  }

  /** 整包设置 base（缓存 / 网络结果）。startSeq 之后有过变动的行保持不动。 */
  function mergeRows(rows, startSeq = -1) {
    for (const table of BUNDLE_TABLES) {
      const fetched = new Map();
      for (const raw of rows[table] || []) {
        const row = normalizeIncomingRow(table, raw);
        if (belongs(table, row)) fetched.set(rowKey(table, row), row);
      }
      const b = base.get(table);
      for (const [k, row] of fetched) {
        if (startSeq >= 0 && touchedAfter(table, k, startSeq)) continue;
        b.set(k, row);
      }
      for (const k of [...b.keys()]) {
        if (fetched.has(k)) continue;
        if (startSeq >= 0 && touchedAfter(table, k, startSeq)) continue;
        b.delete(k);
      }
    }
    batch(() => {
      for (const table of BUNDLE_TABLES) recomputeTable(table);
    });
  }

  function baseRows() {
    const out = {};
    for (const t of BUNDLE_TABLES) out[t] = [...base.get(t).values()];
    return out;
  }

  function schedulePersist() {
    if (persistTimer || disposed || gone) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const uid = getUserId();
      if (uid && !gone && base.get('trips').size) writeTripCache(kv, tripId, uid, baseRows());
    }, 400);
  }

  // -------------------------------------------------------------------
  // 加载、刷新、实时
  // -------------------------------------------------------------------

  /** 已经打开着、实时在线、刚刷新过：再次 open() 不用重拉 */
  function fresh() {
    return Boolean(unsubscribeRealtime) && realtime.value === 'live' && status.value === 'ready' && !error.value
      && lastRefreshAt > 0 && Date.now() - lastRefreshAt < FRESH_MS;
  }

  /**
   * 打开行程：等登录状态 → 先显示缓存 → 订阅实时 → 后台整包刷新（见文件头“打开”）。
   * 同时调用多次（页面 effect + 手动）共用同一个过程；已经打开着且新鲜时直接返回；
   * 关闭后再打开会重新订阅、再刷新一次。force：不管新不新鲜都重拉。
   * @param {{ force?: boolean }} [o]
   */
  function open({ force = false } = {}) {
    if (disposed) return Promise.reject(new Error('TripStore 已销毁'));
    if (openPromise) return openPromise;
    if (!force && fresh()) return Promise.resolve();
    const seq = openSeq;
    const stale = () => disposed || seq !== openSeq;
    const p = (async () => {
      await null;
      // 先等登录状态恢复（很快，本机读取），否则不知道该读谁的缓存
      if (deps.ready) await deps.ready();
      if (stale()) return;
      if (!base.get('trips').size) {
        if (status.value === 'idle') status.value = 'loading';
        const cached = await readTripCache(kv, tripId, getUserId());
        if (cached && !base.get('trips').size && !stale()) {
          mergeRows(cached.rows);
          source.value = 'cache';
          syncedAt.value = cached.savedAt || null;
          status.value = 'ready';
        }
      }
      if (stale()) return;
      subscribe();
      await refresh();
    })().finally(() => {
      if (openPromise === p) openPromise = null;
    });
    openPromise = p;
    return p;
  }

  /** 整包重新拉取（后台进行，失败不清空已有数据） */
  function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshing.value = true;
    const startSeq = touchSeq;
    refreshPromise = (async () => {
      try {
        const rows = await deps.backend.fetchTripBundle(tripId);
        if (disposed) return;
        if (!rows.trips?.length) {
          const had = base.get('trips').size > 0;
          error.value = new DataError(had ? '你已经不在这个行程里了，或者行程被删除了' : '找不到这个行程，或者你还不是它的成员', { kind: 'not-found' });
          markGone(had ? 'removed' : 'missing');
          return;
        }
        mergeRows(rows, startSeq);
        gone = false;
        source.value = 'network';
        syncedAt.value = Date.now();
        lastRefreshAt = Date.now();
        error.value = null;
        status.value = 'ready';
        const uid = getUserId();
        if (uid) await writeTripCache(kv, tripId, uid, baseRows());
      } catch (e) {
        const err = toDataError(e, { context: '加载行程' });
        error.value = err;
        if (status.value !== 'ready') status.value = 'error';
      } finally {
        refreshing.value = false;
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function subscribe() {
    if (unsubscribeRealtime || disposed || typeof deps.backend.subscribeTrip !== 'function') return;
    realtime.value = 'connecting';
    unsubscribeRealtime = deps.backend.subscribeTrip(tripId, {
      onChange(change) {
        if (disposed) return;
        const { table, type } = change;
        if (!BUNDLE_TABLES.includes(table)) return;
        if (type === 'DELETE') {
          const old = change.old || {};
          // DELETE 只带主键（文档 A6）；trip_members 的主键是 (trip_id, user_id)
          if (table === 'trip_members') {
            if (old.trip_id === tripId && old.user_id) removeServerRow(table, `${tripId}|${old.user_id}`);
          } else if (old.id !== undefined && old.id !== null) {
            removeServerRow(table, String(old.id));
          }
          return;
        }
        if (change.row) applyServerRow(table, change.row);
      },
      onStatus(s) {
        if (disposed) return;
        const prev = realtime.value;
        realtime.value = s;
        if (s === 'live') {
          // 断线重连后补拉一次：断开期间的变化推送收不到
          if (everLive && prev !== 'live') refresh();
          everLive = true;
        }
      },
    });
  }

  /** 离开行程：退订实时（数据留在内存，回来马上能显示）。打开到一半的过程作废 */
  function close() {
    openSeq += 1;
    openPromise = null;
    if (unsubscribeRealtime) {
      try {
        unsubscribeRealtime();
      } catch {
        /* 忽略 */
      }
    }
    unsubscribeRealtime = null;
    realtime.value = 'off';
    everLive = false;
  }

  function dispose() {
    close();
    disposed = true;
    offOutbox();
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
  }

  // -------------------------------------------------------------------
  // 派生数据（computed）
  // -------------------------------------------------------------------

  const trip = computed(() => tables.trips.value.get(tripId) || null);
  const membersByUser = computed(() => new Map([...tables.trip_members.value.values()].map((m) => [m.user_id, m])));

  /** 只在真正读到时才订阅对应表的“数据包”（selectors 读哪张表就只依赖哪张表） */
  const lazy = {
    tripId,
    get trip() { return trip.value; },
    get members() { return membersByUser.value; },
    get segments() { return tables.segments.value; },
    get places() { return tables.places.value; },
    get bookings() { return tables.bookings.value; },
    get days() { return tables.days.value; },
    get items() { return tables.items.value; },
    get contacts() { return tables.contacts.value; },
    get todos() { return tables.todos.value; },
    get tips() { return tables.tips.value; },
    get journal_entries() { return tables.journal_entries.value; },
    get reviews() { return tables.reviews.value; },
    get expenses() { return tables.expenses.value; },
  };

  const atNow = () => {
    deps.clockTick?.value;
    return nowDate();
  };

  const itemsByDayC = computed(() => S.itemsByDay(tables.items.value));
  const plans = computed(() => new Map([...itemsByDayC.value].filter(([k]) => k !== null).map(([k, list]) => [k, S.dayPlan(list)])));
  const myRole = computed(() => S.effectiveRole(lazy, getUserIdTracked()));

  // userId 也做成可追踪的（换账号时 myRole 重算）
  function getUserIdTracked() {
    deps.userIdSignal?.value;
    return getUserId();
  }

  const view = {
    trip,
    members: computed(() => S.memberList(lazy)),
    membersByUser,
    myRole,
    canEdit: computed(() => myRole.value === 'owner' || myRole.value === 'editor'),
    isOwner: computed(() => myRole.value === 'owner'),
    partySize: computed(() => S.partySize(lazy)),
    segments: computed(() => S.sortedSegments(tables.segments.value)),
    days: computed(() => S.sortedDays(tables.days.value)),
    dayByDate: computed(() => S.dayByDate(tables.days.value)),
    dates: computed(() => S.tripDates(trip.value)),
    itemsByDay: itemsByDayC,
    plans,
    pool: computed(() => itemsByDayC.value.get(null) || []),
    bookings: computed(() => S.sortedBookings(tables.bookings.value)),
    contacts: computed(() => S.sortedContacts(tables.contacts.value)),
    tips: computed(() => S.sortedTips(tables.tips.value)),
    todosByList: computed(() => S.todosByList(tables.todos.value)),
    todosByDay: computed(() => S.todosByDay(tables.todos.value)),
    todosByBooking: computed(() => S.todosByBooking(tables.todos.value)),
    packing: computed(() => S.packingGroups(tables.todos.value)),
    todoProgress: computed(() => S.todoProgress(tables.todos.value)),
    journalByDay: computed(() => S.journalByDay(lazy)),
    reviewsByPlace: computed(() => S.reviewsByPlace(lazy)),
    places: computed(() => [...tables.places.value.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))),
    wishlist: computed(() => [...tables.places.value.values()].filter((p) => p.wishlist).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))),
    expenses: computed(() => S.liveExpenses(tables.expenses.value)),
    budget: computed(() => S.budgetSummary(lazy, { fx: deps.fxRates?.value })),
    ledger: computed(() => S.ledgerSummary(lazy, { fx: deps.fxRates?.value })),
    tripRoute: computed(() => S.tripRoute(lazy)),
    // 和“现在”有关的（clockTick 每分钟刷新一次）
    phase: computed(() => S.tripPhase(trip.value, atNow())),
    countdown: computed(() => S.countdown(trip.value, atNow())),
    today: computed(() => S.todaySummary(lazy, plans.value, atNow())),
    deadlines: computed(() => S.upcomingDeadlines(lazy, atNow())),
  };

  /** 当前所有可见行（数组），调试 / 开发页用 */
  function snapshot() {
    const out = {};
    for (const t of BUNDLE_TABLES) out[t] = [...tables[t].value.values()];
    return out;
  }

  // -------------------------------------------------------------------
  // 写：权限、校验、乐观更新、进写队列
  // -------------------------------------------------------------------

  function requireUser() {
    const uid = getUserId();
    if (!uid) throw new DataError('请先登录', { kind: 'unauthenticated' });
    return uid;
  }

  function role() {
    return S.effectiveRole(lazy, getUserId());
  }

  /** 权限检查（和 RLS 一致，提前给出中文提示，不让注定失败的改动进队列） */
  function assertCan(table, action, row, changes = null) {
    const uid = requireUser();
    const r = role();
    if (!r) throw new DataError('你不是这个行程的成员', { kind: 'permission' });
    const editor = r === 'owner' || r === 'editor';
    if (table === 'trips') {
      if (action === 'insert') throw new DataError('新建行程请用 createTrip()', { kind: 'validation' });
      if (action === 'delete' && r !== 'owner') throw new DataError('只有创建者可以删除行程', { kind: 'permission' });
      if (!editor) throw new DataError(VIEWER_MESSAGE, { kind: 'permission' });
      if (changes && 'owner_id' in changes && r !== 'owner') throw new DataError('只有创建者可以转让行程', { kind: 'permission' });
      return;
    }
    if (table === 'trip_members') {
      if (action === 'insert') throw new DataError('加入行程请用邀请码', { kind: 'validation' });
      const own = row.user_id === uid;
      if (action === 'delete' && !own && r !== 'owner') throw new DataError('只有创建者可以移除成员', { kind: 'permission' });
      if (action === 'update') {
        if (changes && 'role' in changes && r !== 'owner') throw new DataError('只有创建者可以修改成员角色', { kind: 'permission' });
        if (!own && r !== 'owner') throw new DataError('只能修改自己的显示名和颜色', { kind: 'permission' });
      }
      return;
    }
    if (SHARED_TABLES.includes(table)) {
      if (!editor) throw new DataError(VIEWER_MESSAGE, { kind: 'permission' });
      return;
    }
    if (PERSONAL_TABLES.includes(table)) {
      if (row.user_id !== uid) throw new DataError(table === 'journal_entries' ? '只能修改自己的日记' : '只能修改自己的评级', { kind: 'permission' });
      return;
    }
    throw new DataError(`不能写这张表：${table}`, { kind: 'validation' });
  }

  /** 引用的行必须在这个行程里（组合外键） */
  function assertRefs(table, values) {
    const refs = REFERENCES[table] || {};
    for (const [col, [target]] of Object.entries(refs)) {
      const v = values[col];
      if (v === null || v === undefined) continue;
      if (!working.get(target).has(v)) {
        throw new DataError(`${FIELD_LABELS[col] || col}：关联的${LABELS[target] || target}不存在或已经被删除了`, { kind: 'validation', field: col });
      }
    }
  }

  /** 除主键外的唯一约束（提前发现重复） */
  function assertUnique(table, row) {
    const same = (cols) => [...working.get(table).values()].find((r) => r.id !== row.id && cols.every((c) => r[c] === row[c]));
    if (table === 'days' && same(['date'])) throw new DataError(`${row.date} 这一天已经有了`, { kind: 'conflict', field: 'date' });
    if (table === 'journal_entries' && same(['day_id', 'user_id'])) throw new DataError('这一天你已经写过日记了', { kind: 'conflict' });
    if (table === 'reviews' && same(['place_id', 'user_id'])) throw new DataError('这个地点你已经评过了', { kind: 'conflict' });
    if (table === 'items' && row.legacy_id && same(['legacy_id'])) throw new DataError('旧数据 id 重复了', { kind: 'conflict' });
  }

  /** 只在本地显示、不发给后台的字段（系统列、生成列、触发器会写的列） */
  function localFields(table, row, changes, isInsert) {
    const ts = toTimestamptz(nowDate());
    const uid = getUserId();
    const out = isInsert ? { created_at: ts, updated_at: ts, created_by: uid, updated_by: uid } : { updated_at: ts, updated_by: uid };
    if (table === 'trip_members') {
      delete out.created_at;
      delete out.updated_at;
      delete out.created_by;
      delete out.updated_by;
    }
    if (table === 'todos' && 'done' in changes) {
      if (changes.done) {
        out.done_at = row.done_at || ts;
        out.done_by = row.done_by || uid;
      } else {
        out.done_at = null;
        out.done_by = null;
      }
    }
    if (table === 'expenses' && 'currency' in changes) out.currency_iso = normalizeCurrency(changes.currency);
    return out;
  }

  const pickWritable = (table, row) => {
    const cols = writableColumns(table);
    const out = {};
    for (const c of cols) if (row[c] !== undefined) out[c] = row[c];
    return out;
  };

  function result(table, key, res, extra = {}) {
    return {
      row: working.get(table).get(key) || null,
      op: res.op,
      saved: res.saved || Promise.resolve(),
      synced: res.synced || Promise.resolve({ ok: true }),
      ...extra,
    };
  }

  /**
   * 新建一行（乐观）。id 不传就生成 uuid；trip_id 自动填；个人表的 user_id 自动是自己。
   * @param {string} table
   * @param {object} values
   * @param {{ label?: string }} [opts]
   */
  function insert(table, values, opts = {}) {
    if (table === 'trips' || table === 'trip_members') assertCan(table, 'insert', values);
    const uid = requireUser();
    const given = normalizeValues(table, values || {});
    for (const k of Object.keys(given)) {
      if (!(k in TABLES[table].columns)) throw new DataError(`未知字段：${k}`, { kind: 'validation', field: k });
    }
    const row = { ...defaultsFor(table), ...given, id: given.id || newId(), trip_id: tripId };
    if (PERSONAL_TABLES.includes(table)) {
      if (given.user_id && given.user_id !== uid) throw new DataError('只能替自己写', { kind: 'permission' });
      row.user_id = uid;
    }
    for (const c of ['created_at', 'updated_at', 'created_by', 'updated_by', 'currency_iso']) delete row[c];
    for (const c of Object.keys(row)) {
      if (!writableColumns(table).includes(c)) {
        if (given[c] !== undefined && given[c] !== null) throw new DataError(`${c} 是旧版字段，新数据不要写`, { kind: 'validation', field: c });
        delete row[c];
      }
    }
    assertValidRow(table, row);
    assertCan(table, 'insert', row);
    assertRefs(table, row);
    assertUnique(table, row);
    const local = localFields(table, row, row, true);
    if (table === 'expenses') local.currency_iso = normalizeCurrency(row.currency);
    const res = outbox.enqueue({
      tripId, table, kind: 'insert', key: rowKey(table, row), match: matchOf(table, row), row: pickWritable(table, row), local,
      label: opts.label || `新建${LABELS[table] || ''}${row.title || row.name ? `「${row.title || row.name}」` : ''}`,
    });
    return result(table, rowKey(table, row), res);
  }

  /**
   * 修改一行：只提交真正改变的字段。什么都没变返回 { unchanged: true }。
   * @param {string} table
   * @param {string} key  id（trip_members 用 'trip_id|user_id'，或直接传 user_id）
   * @param {object} patch
   */
  function update(table, key, patch, opts = {}) {
    const k = table === 'trip_members' && !String(key).includes('|') ? `${tripId}|${key}` : String(key);
    const current = working.get(table).get(k);
    if (!current) throw new DataError('这条内容已经不存在了（可能刚被删除）', { kind: 'not-found' });
    const normalized = normalizeValues(table, patch || {});
    const ro = readonlyOnUpdate(table);
    for (const c of Object.keys(normalized)) {
      if (normalized[c] === undefined) continue;
      if (ro.has(c) && normalized[c] !== current[c]) throw new DataError(`不能修改${FIELD_LABELS[c] || c}`, { kind: 'validation', field: c });
      if (!(c in TABLES[table].columns)) throw new DataError(`未知字段：${c}`, { kind: 'validation', field: c });
    }
    const changes = diffPatch(current, Object.fromEntries(Object.entries(normalized).filter(([c]) => !ro.has(c))));
    if (!Object.keys(changes).length) {
      return { row: current, op: null, unchanged: true, saved: Promise.resolve(), synced: Promise.resolve({ ok: true, row: current }) };
    }
    const merged = { ...current, ...changes };
    assertValidRow(table, merged);
    assertCan(table, 'update', merged, changes);
    assertRefs(table, changes);
    if (table === 'days' || table === 'items') assertUnique(table, merged);
    const local = localFields(table, merged, changes, false);
    const res = outbox.enqueue({
      tripId, table, kind: 'update', key: k, match: matchOf(table, current), patch: changes, local,
      label: opts.label || `修改${LABELS[table] || ''}${current.title || current.name ? `「${current.title || current.name}」` : ''}`,
    });
    return result(table, k, res);
  }

  /** 撤销登记（页面显示“已删除 · 撤销”） */
  function offerUndo(label, undo, ms) {
    deps.onUndoable?.({ label, undo, expiresAt: Date.now() + ms });
  }

  /**
   * 删除一行。items / expenses 走软删除（随时能恢复）；其他表硬删除，
   * undoMs > 0 时先在本地隐藏，undoMs 毫秒后才真正发给后台，在这之前 undo() 等于没删。
   * @returns {{ row, saved, synced, undo: () => Promise<boolean> }}
   */
  function remove(table, key, { undoMs = 5000, label } = {}) {
    if (SOFT_DELETE_TABLES.includes(table)) return softDelete(table, key, { label });
    const k = table === 'trip_members' && !String(key).includes('|') ? `${tripId}|${key}` : String(key);
    const current = working.get(table).get(k);
    if (!current) return { row: null, op: null, saved: Promise.resolve(), synced: Promise.resolve({ ok: true }), undo: async () => false };
    assertCan(table, 'delete', current);
    const name = current.title || current.name || '';
    const text = label || `删除${LABELS[table] || ''}${name ? `「${name}」` : ''}`;
    const res = outbox.enqueue({
      tripId, table, kind: 'delete', key: k, match: matchOf(table, current), label: text,
      notBefore: undoMs > 0 ? Date.now() + undoMs : null,
    });
    const undo = async () => (res.op ? outbox.cancel(res.op.id) : false);
    if (undoMs > 0 && res.op) offerUndo(`已删除${name ? `「${name}」` : ''}`, undo, undoMs);
    return { row: current, op: res.op, saved: res.saved, synced: res.synced, undo };
  }

  /**
   * 软删除（items / expenses）：写 deleted_at，随时能 undo()。
   * 删条目时，挂在它下面的备选 / 雨天方案一起删（恢复时一起恢复）。
   */
  function softDelete(table, key, { label, undoMs = 6000 } = {}) {
    if (!SOFT_DELETE_TABLES.includes(table)) throw new DataError(`${table} 不支持软删除`, { kind: 'validation' });
    const current = working.get(table).get(String(key));
    if (!current || current.deleted_at) return { row: current || null, op: null, saved: Promise.resolve(), synced: Promise.resolve({ ok: true }), undo: async () => false };
    const ts = toTimestamptz(nowDate());
    const ids = [String(key)];
    if (table === 'items') {
      for (const r of working.get('items').values()) if (r.parent_item_id === key && !r.deleted_at && r.variant !== 'primary') ids.push(r.id);
    }
    const results = ids.map((id) => update(table, id, { deleted_at: ts }, { label: label || `删除${LABELS[table]}「${working.get(table).get(id)?.title || working.get(table).get(id)?.description || ''}」` }));
    const at = tsMs(ts);
    // 撤销：只恢复“这次删的”（deleted_at 是同一时刻；按时刻比较，服务器返回的写法可能不同）。
    // 一条都没恢复（例如别人已经先恢复了、或者又被删了一次）→ 返回 false，页面据此提示
    const undo = async () => {
      let restored = 0;
      for (const id of ids) {
        const r = working.get(table).get(id);
        if (r && r.deleted_at && tsMs(r.deleted_at) === at) {
          update(table, id, { deleted_at: null }, { label: `恢复${LABELS[table]}` });
          restored += 1;
        }
      }
      return restored > 0;
    };
    const name = current.title || current.description || '';
    offerUndo(`已删除${name ? `「${name}」` : ''}`, undo, undoMs);
    return { row: results[0].row, op: results[0].op, saved: Promise.all(results.map((r) => r.saved)), synced: results[0].synced, undo, ids };
  }

  /** 恢复软删除的行 */
  function restore(table, key) {
    return update(table, key, { deleted_at: null }, { label: `恢复${LABELS[table] || ''}` });
  }

  /**
   * 拖拽排序：把 key 移到 list 里的 toIndex（list 是页面上看到的、已排序的同组列表）。
   * items 改 sort_key（可以有小数，一般只改一行）；其他表改 sort（整数，没空隙时整列重新编号）。
   */
  function move(table, key, toIndex, list) {
    const field = table === 'items' ? 'sort_key' : 'sort';
    const plan = planMove(list, String(key), toIndex, { field, integer: field === 'sort' });
    return plan.map(({ id, value }) => update(table, id, { [field]: value }, { label: `调整${LABELS[table] || ''}顺序` }));
  }

  /** 新建时排在同组最后的排序值 */
  function nextSort(table, filterFn = () => true) {
    const field = table === 'items' ? 'sort_key' : 'sort';
    return nextSortValue([...working.get(table).values()].filter(filterFn), field);
  }

  // ---------------- 便捷方法（常用操作，规则写在一处） ----------------

  /**
   * 记一笔。默认：币种 = 当地币种、日期 = 行程时区的今天（在行程期间时）、付款人 = 自己、
   * 同行的人（创建者和可编辑成员，和预算的“同行人数”同一个口径；只读成员不算）平摊；
   * home_currency / fx_rate / amount_home 按当前汇率自动算好（也可以传 fx_rate 覆盖）。
   */
  function addExpense(input) {
    const t = trip.value;
    if (!t) throw new DataError('行程还没加载好', { kind: 'not-found' });
    const uid = requireUser();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount === 0) throw new DataError('金额：请输入一个不为 0 的数字', { kind: 'validation', field: 'amount' });
    const currency = normalizeCurrency(input.currency || t.local_currency || t.home_currency);
    const home = normalizeCurrency(t.home_currency || 'HKD');
    const rate = input.fx_rate !== undefined && input.fx_rate !== null ? Number(input.fx_rate) : deps.fxRates?.value?.rate(currency, home) ?? null;
    const phase = S.tripPhase(t, nowDate());
    const date = input.date !== undefined ? input.date : phase.phase === 'ongoing' ? phase.today : null;
    const memberIds = S.memberList(lazy).filter((m) => m.role === 'owner' || m.role === 'editor').map((m) => m.user_id);
    if (!memberIds.includes(uid)) memberIds.unshift(uid);
    const split = input.split || (memberIds.length > 1 ? { mode: 'equal', user_ids: memberIds } : { mode: 'personal' });
    assertSplit(split, amount, currency);
    const extra = { ...(input.extra || {}) };
    if (rate !== null && (input.fx_rate === undefined || input.fx_rate === null) && currency !== home) extra.fx_source = deps.fxRates?.value?.source || 'approx';
    return insert('expenses', {
      amount,
      currency,
      date,
      category: input.category || '其他',
      description: input.description ?? null,
      home_currency: home,
      fx_rate: rate,
      amount_home: rate === null ? null : roundMoney(amount * rate, home),
      paid_by_user_id: input.paid_by_user_id === undefined ? uid : input.paid_by_user_id,
      split,
      item_id: input.item_id ?? null,
      booking_id: input.booking_id ?? null,
      receipt_path: input.receipt_path ?? null,
      extra,
    }, { label: `记一笔「${input.description || input.category || '其他'}」` });
  }

  /** 按金额分摊时，份额加起来必须等于总额（新数据不出现对不上的分摊；旧数据只在汇总里标出来） */
  function assertSplit(split, amount, currency) {
    const diff = S.splitMismatch(split, amount, currency);
    if (!diff) return;
    const cur = normalizeCurrency(currency);
    const text = formatMoney(fromMinor(Math.abs(diff), cur), cur);
    throw new DataError(`分摊：各人的金额加起来比总额${diff > 0 ? '少' : '多'}了 ${text}，请调整后再保存`, { kind: 'validation', field: 'split' });
  }

  /** 改一笔记账；改了金额 / 币种会重算 amount_home（汇率沿用这笔原来的） */
  function updateExpense(id, patch) {
    const cur = working.get('expenses').get(id);
    if (!cur) throw new DataError('这笔记账已经不存在了', { kind: 'not-found' });
    const next = { ...patch };
    if ('currency' in next) next.currency = normalizeCurrency(next.currency);
    const currency = next.currency ?? cur.currency;
    if ('split' in next || 'amount' in next || 'currency' in next) assertSplit(next.split ?? cur.split, next.amount ?? cur.amount, currency);
    const home = normalizeCurrency(cur.home_currency || trip.value?.home_currency || 'HKD');
    if ('amount' in next || 'currency' in next || 'fx_rate' in next) {
      const switched = 'currency' in next && next.currency !== cur.currency;
      let rate = 'fx_rate' in next ? next.fx_rate : (switched ? deps.fxRates?.value?.rate(currency, home) ?? null : cur.fx_rate);
      // 台湾那趟的旧记账没有 fx_rate，只有当时的 amount_hkd：改金额时按它反推汇率（旧版导入 sharedExpenseToExpense 同一个算法），
      // 还不行就用现在的参考汇率——不然 amount_home 写成空、折合港币退回旧的 amount_hkd，金额改了折合不变（代码评审 P1-2）
      if ((rate === null || rate === undefined) && !('fx_rate' in next) && !switched) {
        const oldAmount = Number(cur.amount);
        const oldHkd = Number(cur.amount_hkd);
        if (home === 'HKD' && oldAmount > 0 && oldHkd > 0) rate = oldHkd / oldAmount;
        else rate = deps.fxRates?.value?.rate(currency, home) ?? null;
      }
      next.fx_rate = rate;
      next.home_currency = home;
      next.amount_home = rate === null || rate === undefined ? null : roundMoney(Number(next.amount ?? cur.amount) * rate, home);
    }
    return update('expenses', id, next);
  }

  /** 勾选 / 取消勾选清单项 */
  function toggleTodo(id, done) {
    const cur = working.get('todos').get(id);
    if (!cur) throw new DataError('这一项已经不存在了', { kind: 'not-found' });
    return update('todos', id, { done: done === undefined ? !cur.done : Boolean(done) }, { label: `${(done ?? !cur.done) ? '勾选' : '取消勾选'}「${cur.title}」` });
  }

  /** 步进器改数量（null = 不显示步进器） */
  function setTodoQty(id, qty) {
    if (qty !== null && (!Number.isInteger(qty) || qty < 0)) throw new DataError('数量：只能是不小于 0 的整数', { kind: 'validation', field: 'qty' });
    return update('todos', id, { qty }, { label: '修改数量' });
  }

  /** 条目状态：planned / done / skipped（可同时写实际时间、实际情况） */
  function setItemStatus(id, statusValue, extra = {}) {
    return update('items', id, { status: statusValue, ...extra }, { label: statusValue === 'done' ? '标记完成' : statusValue === 'skipped' ? '标记跳过' : '标记计划中' });
  }

  /** 写自己当天的日记（没有就新建，有就改） */
  function saveJournal(dayId, patch) {
    const uid = requireUser();
    const mine = [...working.get('journal_entries').values()].find((j) => j.day_id === dayId && j.user_id === uid);
    if (mine) return update('journal_entries', mine.id, patch, { label: '修改日记' });
    return insert('journal_entries', { day_id: dayId, ...patch }, { label: '写日记' });
  }

  /** 评自己的地点评级（没有就新建，有就改） */
  function saveReview(placeId, patch) {
    const uid = requireUser();
    const mine = [...working.get('reviews').values()].find((r) => r.place_id === placeId && r.user_id === uid);
    if (mine) return update('reviews', mine.id, patch, { label: '修改评级' });
    return insert('reviews', { place_id: placeId, ...patch }, { label: '评级' });
  }

  /** 改行程本身（标题、日期、封面、状态…） */
  function updateTrip(patch) {
    return update('trips', tripId, patch, { label: '修改行程信息' });
  }

  /**
   * 账本「记为已结清」：把此刻还没结的转账（view.ledger.settlement.outstanding）记成一条结清记录，
   * 存进 trips.extra.ledger_settlements（别的键原样保留；owner / editor 都能写）。之后新记的账从零算。
   * @param {{ by?: string, at?: Date }} [o]
   * @returns {{ saved: Promise, record: object }} record.id 给 undoSettlement 用
   */
  function settleLedger({ by = getUserId(), at } = {}) {
    const ledger = view.ledger.value;
    const record = S.settlementRecord(ledger.settlement.outstanding, { by, count: ledger.count, ...(at ? { at } : {}) });
    const list = [...S.readSettlements(trip.value), record];
    const res = updateTrip({ extra: S.withSettlements(trip.value?.extra, list) });
    return Object.assign(res, { record });
  }

  /** 撤销一条结清记录（「已记为结清 · 撤销」、账本页卡片里的「撤销」） */
  function undoSettlement(id) {
    const list = S.readSettlements(trip.value).filter((x) => x.id !== id);
    return updateTrip({ extra: S.withSettlements(trip.value?.extra, list) });
  }

  /** 改自己在这个行程里的显示名 / 颜色 */
  function updateMyMember(patch) {
    const uid = requireUser();
    const allowed = {};
    for (const k of ['display_name', 'color']) if (k in patch) allowed[k] = patch[k];
    return update('trip_members', `${tripId}|${uid}`, allowed, { label: '修改显示名' });
  }

  /** owner 改成员角色 */
  function setMemberRole(userId, roleValue) {
    return update('trip_members', `${tripId}|${userId}`, { role: roleValue }, { label: '修改成员角色' });
  }

  /** owner 移除成员 / 自己退出（userId 传自己） */
  function removeMember(userId) {
    return remove('trip_members', `${tripId}|${userId}`, { undoMs: 0, label: userId === getUserId() ? '退出行程' : '移除成员' });
  }

  /**
   * 上传照片 / 文件（进写队列，离线也行）：用途 journal / reviews / bookings / receipts / covers。
   * 拍摄时间按行程时区读；返回 { path, takenAt, width, height, … }，把 path 写进日记 photos、记账 receipt_path 等。
   */
  function upload(purpose, file, o = {}) {
    if (!deps.files) throw new DataError('文件模块没有接上', { kind: 'unknown' });
    return deps.files.upload(tripId, purpose, file, { timeZone: trip.value?.timezone, ...o });
  }

  // 便于调试：控制台里看得到
  const api = {
    tripId,
    status, source, error, refreshing, syncedAt, realtime,
    tables, trip, view, bundle: lazy,
    open, refresh, close, dispose, snapshot,
    applyServerRow, removeServerRow, mergeRows,
    /** 当前变动序号（mergeRows 的 startSeq；测试和调试用） */
    markSeq: () => touchSeq,
    insert, update, remove, softDelete, restore, move, nextSort,
    addExpense, updateExpense, toggleTodo, setTodoQty, setItemStatus, saveJournal, saveReview,
    updateTrip, settleLedger, undoSettlement, updateMyMember, setMemberRole, removeMember, upload,
    /** 某个视图的便捷读取（带参数的派生数据） */
    dayRoute: (dayId) => S.dayRoute(lazy, dayId),
    stayForDay: (day) => S.stayForDay(lazy, day),
    weatherPoint: (day) => S.weatherPoint(lazy, day),
    dayTimezone: (day) => S.dayTimezone(lazy, day),
    /** 那一刻人在哪个时区（去程落地前 / 回程落地后是香港，其余是行程时区）：显示「现在」、截止时间、记一笔默认值用 */
    presenceZone: (at) => S.presenceZone(lazy, at),
    placeCoords: (placeOrId) => S.placeCoords(lazy, placeOrId),
    placeRating: (placeId) => S.placeRating(lazy, placeId, getUserId()),
    memberName: (userId) => S.memberName(lazy, userId),
    dayNumber: (date) => S.dayNumber(trip.value, date),
    search: (q, o) => S.searchTrip(lazy, q, o),
    stopsRoute: (item) => S.stopsRoute(lazy, item),
  };
  return api;
}
