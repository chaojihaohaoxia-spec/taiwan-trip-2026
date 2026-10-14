// =====================================================================
// data/trips.js：“全部行程”列表（我是成员的行程）+ 行程列表相关的纯函数。
//
//   list.state.value   { status: 'idle'|'loading'|'ready'|'error', entries, error, source, syncedAt }
//   entries[i]         { id, trip（trips 行）, role（owner/editor/viewer，trips.owner_id 也算 owner）, member（我的成员行） }
//   list.load()        先显示 IndexedDB 缓存，再后台刷新
//
// 纯函数（Node 里能测）：
//   sortTripsForList(entries, at)   归档的在最后；再按 trips.sort；同 sort 时进行中 → 未开始（近的在前）→ 已结束（近的在前）
//   pickCurrentTrip(entries, at)    “当前行程”：进行中的 → 最近要出发的 → 最近结束的（旧版快捷方式 ?go=today 用）
//   resolveGo(go, entries, at)      ?go=today | ledger → 要去的路由目标
// =====================================================================

import { signal } from '@preact/signals';
import { readTripsCache, writeTripsCache } from './cache.js';
import { toDataError } from './errors.js';
import { normalizeIncomingRow } from './tables.js';
import { tripPhase, tripToday } from './selectors.js';
import { daysBetween } from '../lib/clock.js';

/** 行程行 + 我的成员行 → 列表项 */
export function toEntries(trips, memberships, userId) {
  const mine = new Map(memberships.filter((m) => m.user_id === userId).map((m) => [m.trip_id, m]));
  return trips
    .filter((t) => mine.has(t.id))
    .map((t) => {
      const member = mine.get(t.id);
      const role = t.owner_id === userId ? 'owner' : member.role;
      return { id: t.id, trip: t, role, member };
    });
}

const PHASE_RANK = { ongoing: 0, upcoming: 1, undated: 2, ended: 3 };

/** 列表排序（见文件头） */
export function sortTripsForList(entries, at = new Date()) {
  return [...entries]
    .map((e) => ({ e, p: tripPhase(e.trip, at).phase }))
    .sort((a, b) => {
      const archA = a.e.trip.status === 'archived' ? 1 : 0;
      const archB = b.e.trip.status === 'archived' ? 1 : 0;
      if (archA !== archB) return archA - archB;
      const s = (a.e.trip.sort ?? 0) - (b.e.trip.sort ?? 0);
      if (s) return s;
      const r = PHASE_RANK[a.p] - PHASE_RANK[b.p];
      if (r) return r;
      if (a.p === 'upcoming' || a.p === 'ongoing') return String(a.e.trip.start_date).localeCompare(String(b.e.trip.start_date));
      if (a.p === 'ended') return String(b.e.trip.end_date || b.e.trip.start_date).localeCompare(String(a.e.trip.end_date || a.e.trip.start_date));
      return String(a.e.trip.title).localeCompare(String(b.e.trip.title), 'zh-Hans-CN');
    })
    .map((x) => x.e);
}

/** 当前行程：进行中的 → 最近要出发的 → 最近结束的；没有返回 null（不含归档） */
export function pickCurrentTrip(entries, at = new Date()) {
  const live = entries.filter((e) => e.trip.status !== 'archived' && e.trip.start_date);
  const withPhase = live.map((e) => ({ e, ph: tripPhase(e.trip, at) }));
  const ongoing = withPhase.filter((x) => x.ph.phase === 'ongoing');
  if (ongoing.length) return ongoing.sort((a, b) => String(b.e.trip.start_date).localeCompare(String(a.e.trip.start_date)))[0].e;
  const upcoming = withPhase.filter((x) => x.ph.phase === 'upcoming')
    .sort((a, b) => daysBetween(tripToday(a.e.trip, at), a.e.trip.start_date) - daysBetween(tripToday(b.e.trip, at), b.e.trip.start_date));
  if (upcoming.length) return upcoming[0].e;
  const finished = withPhase.filter((x) => x.ph.phase === 'ended')
    .sort((a, b) => String(b.e.trip.end_date || b.e.trip.start_date).localeCompare(String(a.e.trip.end_date || a.e.trip.start_date)));
  return finished[0]?.e || null;
}

/**
 * 旧版快捷方式：?go=today → 当前行程的今天（行程进行中）或行程概览；?go=ledger → 当前行程的账本。
 * @returns {{ name: string, params: object } | null}
 */
export function resolveGo(go, entries, at = new Date()) {
  const cur = pickCurrentTrip(entries, at);
  if (!cur) return null;
  if (go === 'ledger') return { name: 'ledger', params: { tripId: cur.id } };
  if (go === 'today') {
    const ph = tripPhase(cur.trip, at);
    if (ph.phase === 'ongoing') return { name: 'day', params: { tripId: cur.id, date: ph.today } };
    return { name: 'trip', params: { tripId: cur.id } };
  }
  return null;
}

/**
 * @param {{ backend: object, kv: object, getUserId: () => string|null }} deps
 */
export function createTripsList(deps) {
  const state = signal({ status: 'idle', entries: [], error: null, source: null, syncedAt: null });
  let promise = null;
  let raw = { trips: [], memberships: [] };
  let generation = 0;
  let loadSeq = 0;

  function publish(patch) {
    state.value = { ...state.value, ...patch };
  }

  function rebuild() {
    publish({ entries: toEntries(raw.trips, raw.memberships, deps.getUserId()) });
  }

  /**
   * 加载（先缓存后网络）。返回最新的 entries。
   * 同时有多次加载时，以最后发起的那次为准（先发起、后返回的旧结果直接丢掉）。
   * @param {{ fresh?: boolean }} [o] fresh：刚建了 / 加入了行程，不复用正在进行的加载，马上重新拉
   */
  function load({ fresh = false } = {}) {
    const uid = deps.getUserId();
    if (!uid) {
      publish({ status: 'idle', entries: [], error: null, source: null });
      return Promise.resolve([]);
    }
    if (promise && !fresh) return promise;
    const gen = generation;
    const my = ++loadSeq;
    const current = () => gen === generation && my === loadSeq;
    const p = (async () => {
      if (state.value.status === 'idle') {
        publish({ status: 'loading' });
        const cached = await readTripsCache(deps.kv, uid);
        if (cached && current()) {
          raw = { trips: cached.trips, memberships: cached.memberships };
          rebuild();
          publish({ status: 'ready', source: 'cache', syncedAt: cached.savedAt });
        }
      }
      try {
        const res = await deps.backend.fetchMyTrips(uid);
        if (!current()) return state.value.entries;
        raw = {
          trips: res.trips.map((t) => normalizeIncomingRow('trips', t)),
          memberships: res.memberships.map((m) => normalizeIncomingRow('trip_members', m)),
        };
        rebuild();
        publish({ status: 'ready', source: 'network', error: null, syncedAt: Date.now() });
        await writeTripsCache(deps.kv, uid, raw);
      } catch (e) {
        if (!current()) return state.value.entries;
        const err = toDataError(e, { context: '加载行程列表' });
        publish({ error: err, status: state.value.status === 'ready' ? 'ready' : 'error' });
      }
      return state.value.entries;
    })().finally(() => {
      if (promise === p) promise = null;
    });
    promise = p;
    return p;
  }

  /** 打开的行程那一行变了（实时 / 自己改的）→ 同步到列表 */
  function upsertTrip(row) {
    if (!row) return;
    const i = raw.trips.findIndex((t) => t.id === row.id);
    if (i === -1) return;
    if (raw.trips[i] === row) return;
    raw = { ...raw, trips: raw.trips.map((t, j) => (j === i ? row : t)) };
    rebuild();
  }

  function removeTrip(id) {
    raw = { trips: raw.trips.filter((t) => t.id !== id), memberships: raw.memberships.filter((m) => m.trip_id !== id) };
    rebuild();
  }

  function reset() {
    generation += 1;
    raw = { trips: [], memberships: [] };
    promise = null;
    state.value = { status: 'idle', entries: [], error: null, source: null, syncedAt: null };
  }

  return { state, load, upsertTrip, removeTrip, reset };
}
