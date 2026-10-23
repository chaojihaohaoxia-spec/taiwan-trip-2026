// =====================================================================
// data/backend-demo.js：演示模式的“后台”（只在本机 + ?demo=1 时加载，线上永远不会用到）。
//
// 和 backend-supabase.js 是同一套接口，数据层其余部分完全不知道自己连的是演示后台。
// 数据来自 app/demo/demo-db.json（虚构），保存在内存 + IndexedDB（库 rs7885-demo 的 demo:server）：
//   - 刷新页面、开发服务器热重载后，演示里做的改动还在；
//   - demo-db.json 重新生成过（内容指纹变了）会自动重置；开发页“重置演示数据”也能手动重置。
//
// 为了在演示模式里就能发现页面的问题，这里尽量按数据库的规则办事：
//   - 权限（RLS）：只有成员能读；owner/editor 才能改共享内容；日记、评级只能改自己的；只读成员什么都不能改；
//   - 约束：NOT NULL / CHECK / 枚举（复用 tables.js 的校验）、主键和唯一约束（23505）、
//     同一行程内的外键（23503）、删除时的级联（置空 / 连带删除）；
//   - 触发器：created_at / updated_at / created_by / updated_by、清单勾选时记录 done_at / done_by、
//     记账的 currency_iso 生成列；
//   - RPC：create_trip / create_invite / peek_invite / redeem_invite / revoke_invite（邀请码同样只存 sha256）；
//     平台化批 A 的 create_trip_v2 / set_trip_dates / set_trip_dest / add_household_to_trip（「我们俩」= 演示的两个账号）；
//   - 文件：路径规则（第一级行程 id、第二级自己的 user id），文件存 IndexedDB，签名链接用 blob: 网址；
//   - 实时：写入后推送给订阅者（DELETE 只带主键）；多个标签页之间用 BroadcastChannel 同步，
//     开两个标签页（?demo=1&demouser=cathy）就能看到“对方”改动实时出现；
//   - 网络：demoNetwork 信号可以模拟断网 / 网络很差 / 延迟（开发页上有开关），用来测写队列和转圈状态。
//     浏览器本身断网（navigator.onLine = false）也当作断网。
//
// 演示账号：jeremy@example.com、cathy@example.com，密码 demo1234；邮箱验证码一律 123456。
// =====================================================================

import { signal } from '@preact/signals';
import { TABLES, defaultsFor } from './schema.js';
import { BUNDLE_TABLES, REFERENCES, UNIQUE, keyColumns, rowKey, validateRow, isValidTimeZone } from './tables.js';
import { DataError } from './errors.js';
import { newId, toTimestamptz, clone, fnv1a, sleep, emailHandle, isEmail, tsMs, isValidDate, addDays, stableStringify } from './util.js';
import { normalizeCurrency } from './fx.js';
import { ALLOWED_MIME, MAX_FILE_BYTES } from './config.js';
import { now as clockNow } from '../lib/clock.js';
import { searchParam } from '../lib/env.js';
import { destOk, segDestOk, regionSlug } from '../rules/dest.js';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_OTP = '123456';
const SERVER_KEY = 'demo:server';
const AUTH_KEY = 'demo:auth';
const FILE_PREFIX = 'demo:file:';
const STATE_VERSION = 1;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRIP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

function initialNetwork() {
  const mode = searchParam('demonet');
  const latency = Number(searchParam('demolatency'));
  return {
    mode: mode === 'offline' || mode === 'flaky' ? mode : 'online',
    latency: Number.isFinite(latency) && latency >= 0 ? Math.min(latency, 10_000) : 120,
  };
}

/** 演示网络：mode 'online' | 'offline' | 'flaky'（三成请求失败）；latency 每个请求的延迟（毫秒） */
export const demoNetwork = signal(typeof window === 'undefined' ? { mode: 'online', latency: 0 } : initialNetwork());

export function setDemoNetwork(patch) {
  demoNetwork.value = { ...demoNetwork.value, ...patch };
}

const pgError = (code, message, detail) => new DataError(message, { kind: code === '42501' ? 'permission' : code === '23505' ? 'conflict' : code === 'PGRST116' ? 'not-found' : 'validation', code, cause: { code, message: detail || message } });

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => INVITE_ALPHABET[x % 32]).join('');
}

/** 演示数据的指纹（demo-db.json 重新生成过就会变） */
export function demoFingerprint(db) {
  return fnv1a(JSON.stringify(db.tables)) + fnv1a(JSON.stringify(db.users));
}

/**
 * @param {Object} o
 * @param {{ users: object[], currentUser: object, tables: Record<string, object[]>, photoUrls: Record<string,string> }} o.db  loadDemoDb() 的结果
 * @param {object} o.kv            createKv('rs7885-demo')
 * @param {import('@preact/signals').Signal} [o.network]   默认 demoNetwork
 * @param {string|null} [o.userRef]   ?demouser=cathy
 * @param {{ postMessage: Function, addEventListener: Function } | null} [o.channel]  跨标签页同步
 * @param {() => Date} [o.now]
 * @param {() => number} [o.random]
 * @param {boolean} [o.persist=true]
 */
export async function createDemoBackend(o) {
  const db = o.db;
  const kv = o.kv;
  const network = o.network || demoNetwork;
  const now = o.now || clockNow;
  const random = o.random || Math.random;
  const persistEnabled = o.persist !== false;
  const fingerprint = demoFingerprint(db);

  // ------------------------------------------------------------------
  // 状态：从 IndexedDB 恢复，或者用演示数据初始化
  // ------------------------------------------------------------------
  let state = null;
  try {
    const saved = await kv.get(SERVER_KEY);
    if (saved && saved.v === STATE_VERSION && saved.fingerprint === fingerprint) state = saved;
  } catch {
    state = null;
  }
  if (!state) state = freshState();

  function freshState() {
    const tables = {};
    for (const t of Object.keys(TABLES)) tables[t] = clone(db.tables[t] || []);
    return {
      v: STATE_VERSION, fingerprint,
      users: db.users.map((u) => ({ id: u.id, email: u.email, ref: u.ref, display_name: u.display_name, confirmed: true })),
      tables,
      files: {},
    };
  }

  let currentUserId = null;
  {
    const ref = o.userRef ?? searchParam('demouser');
    const byRef = ref ? state.users.find((u) => u.ref === ref) : null;
    let saved;
    try {
      saved = await kv.get(AUTH_KEY);
    } catch {
      saved = undefined;
    }
    if (byRef) currentUserId = byRef.id;
    else if (saved && 'userId' in saved) currentUserId = saved.userId;
    else currentUserId = db.currentUser?.id || state.users[0]?.id || null;
  }

  // 每次写入后立刻保存（串行：正在写时再有改动，写完再写一次最新的），刷新页面不会丢演示里的改动
  let writing = null;
  let dirty = false;
  function persist() {
    if (!persistEnabled) return;
    dirty = true;
    if (writing) return;
    writing = (async () => {
      while (dirty) {
        dirty = false;
        try {
          await kv.set(SERVER_KEY, state);
        } catch {
          /* 存不进去就只在内存里 */
        }
      }
      writing = null;
    })();
  }
  async function persistNow() {
    persist();
    await writing;
  }
  const saveAuth = () => kv.set(AUTH_KEY, { userId: currentUserId }).catch(() => {});

  // ------------------------------------------------------------------
  // 网络模拟
  // ------------------------------------------------------------------
  const offline = () => network.value.mode === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
  async function net() {
    const ms = network.value.latency || 0;
    if (ms > 0) await sleep(ms);
    if (offline()) throw new DataError('网络连接失败，联网后会自动重试', { kind: 'network', status: 0 });
    if (network.value.mode === 'flaky' && random() < 0.3) throw new DataError('网络不稳定，请求没发出去', { kind: 'network', status: 0 });
  }

  // ------------------------------------------------------------------
  // 权限（RLS 的同款判断）
  // ------------------------------------------------------------------
  const T = (t) => state.tables[t] || (state.tables[t] = []);
  const tripRow = (tripId) => T('trips').find((t) => t.id === tripId);
  const memberRow = (tripId, uid) => T('trip_members').find((m) => m.trip_id === tripId && m.user_id === uid);
  const isMember = (tripId, uid) => Boolean(uid && memberRow(tripId, uid));
  const isOwner = (tripId, uid) => Boolean(uid && memberRow(tripId, uid) && (memberRow(tripId, uid).role === 'owner' || tripRow(tripId)?.owner_id === uid));
  const isEditor = (tripId, uid) => Boolean(uid && memberRow(tripId, uid) && (['owner', 'editor'].includes(memberRow(tripId, uid).role) || tripRow(tripId)?.owner_id === uid));
  const tripOf = (table, row) => (table === 'trips' ? row.id : row.trip_id);
  const userOf = (uid) => state.users.find((u) => u.id === uid) || null;
  const toUser = (u) => (u ? { id: u.id, email: u.email, displayName: u.display_name || null } : null);

  function requireUser(uid) {
    if (!uid) throw new DataError('请先登录', { kind: 'unauthenticated', status: 401 });
    return uid;
  }

  const SHARED = new Set(['segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'expenses']);
  const PERSONAL = new Set(['journal_entries', 'reviews']);
  const deny = (msg = 'new row violates row-level security policy') => pgError('42501', '没有权限做这个操作', msg);

  function findIndex(table, match) {
    const cols = Object.keys(match);
    return T(table).findIndex((r) => cols.every((c) => r[c] === match[c]));
  }

  // ------------------------------------------------------------------
  // 约束（主键 / 唯一 / 外键 / CHECK）和触发器
  // ------------------------------------------------------------------
  function checkConstraints(table, row, selfKey) {
    const p = validateRow(table, row);
    if (p) throw pgError('23514', p.message, `new row for relation "${table}" violates check constraint`);
    const k = rowKey(table, row);
    if (k !== selfKey && T(table).some((r) => rowKey(table, r) === k)) {
      throw pgError('23505', '和已有的内容重复了', `duplicate key value violates unique constraint "${table}_pkey"`);
    }
    for (const cols of UNIQUE[table] || []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = T(table).find((r) => rowKey(table, r) !== selfKey && rowKey(table, r) !== k && cols.every((c) => r[c] === row[c]));
      if (clash) throw pgError('23505', '和已有的内容重复了', `duplicate key value violates unique constraint "${table}_${cols.join('_')}_key"`);
    }
    for (const [col, [target]] of Object.entries(REFERENCES[table] || {})) {
      const v = row[col];
      if (v === null || v === undefined) continue;
      if (!T(target).some((r) => r.id === v && r.trip_id === row.trip_id)) {
        throw pgError('23503', '关联的内容不存在或已经被删除了', `insert or update on table "${table}" violates foreign key constraint "${table}_${col}_fk"`);
      }
    }
  }

  /** 现在（数据库的 now()）；同一行的 updated_at 单调递增由 touchUpdate 保证 */
  function stamp() {
    return toTimestamptz(now());
  }

  function touchInsert(table, row, uid) {
    const cols = TABLES[table].columns;
    const ts = stamp();
    if ('created_at' in cols && !row.created_at) row.created_at = ts;
    if ('updated_at' in cols) row.updated_at = ts;
    if ('created_by' in cols && uid) row.created_by = uid;
    if ('updated_by' in cols && uid) row.updated_by = uid;
    applyRowTriggers(table, row, null, uid);
  }

  function touchUpdate(table, row, prev, uid) {
    const cols = TABLES[table].columns;
    if ('updated_at' in cols) {
      let ts = stamp();
      if (prev.updated_at && tsMs(ts) <= tsMs(prev.updated_at)) ts = toTimestamptz(tsMs(prev.updated_at) + 1);
      row.updated_at = ts;
    }
    if ('created_at' in cols) row.created_at = prev.created_at;
    if ('created_by' in cols) row.created_by = prev.created_by;
    if ('updated_by' in cols && uid) row.updated_by = uid;
    applyRowTriggers(table, row, prev, uid);
  }

  function applyRowTriggers(table, row, prev, uid) {
    if (table === 'todos') {
      if (row.done) {
        if (!prev || !prev.done) {
          row.done_at = row.done_at || stamp();
          row.done_by = row.done_by || uid || null;
        }
      } else {
        row.done_at = null;
        row.done_by = null;
      }
    }
    if (table === 'expenses') row.currency_iso = row.currency ? normalizeCurrency(row.currency) : null;
  }

  /** 补齐全部列（按数据库顺序），和 PostgREST 返回的行一致 */
  function fullRow(table, values) {
    const out = {};
    for (const c of Object.keys(TABLES[table].columns)) out[c] = values[c] === undefined ? null : values[c];
    return out;
  }

  // ------------------------------------------------------------------
  // 实时推送（本标签页的订阅者 + 跨标签页广播）
  // ------------------------------------------------------------------
  const subscribers = new Set();

  function deliver(changes) {
    if (!changes.length) return;
    const delay = Math.max(10, Math.round((network.value.latency || 0) / 2));
    setTimeout(() => {
      for (const sub of subscribers) {
        if (sub.status !== 'live') continue; // 断线期间的推送收不到（和真的一样，重连后由数据层补拉）
        for (const ch of changes) {
          if (ch.type !== 'DELETE') {
            if (tripOf(ch.table, ch.row) !== sub.tripId) continue;
            if (!isMember(sub.tripId, currentUserId)) continue;
          }
          try {
            sub.onChange(clone(ch));
          } catch (error) {
            console.error('[演示后台] 推送出错', error);
          }
        }
      }
    }, delay);
  }

  function emit(changes) {
    deliver(changes);
    try {
      o.channel?.postMessage({ type: 'demo-changes', changes });
    } catch {
      /* 忽略 */
    }
  }

  // 别的标签页写了：同步到自己的内存，再推送给自己的订阅者
  o.channel?.addEventListener?.('message', (event) => {
    const msg = event?.data;
    if (!msg || msg.type !== 'demo-changes') return;
    for (const ch of msg.changes) {
      const list = T(ch.table);
      if (ch.type === 'DELETE') {
        const i = list.findIndex((r) => keyColumns(ch.table).every((c) => r[c] === ch.old[c]));
        if (i !== -1) list.splice(i, 1);
      } else {
        const k = rowKey(ch.table, ch.row);
        const i = list.findIndex((r) => rowKey(ch.table, r) === k);
        if (i === -1) list.push(clone(ch.row));
        else list[i] = clone(ch.row);
      }
    }
    deliver(msg.changes);
  });

  function setLinkStatus() {
    const s = offline() ? 'error' : 'live';
    for (const sub of subscribers) {
      if (sub.status !== s) {
        sub.status = s;
        sub.onStatus(s);
      }
    }
  }
  network.subscribe?.(() => setTimeout(setLinkStatus, 0));
  if (typeof window !== 'undefined') {
    window.addEventListener?.('online', () => setTimeout(setLinkStatus, 0));
    window.addEventListener?.('offline', () => setTimeout(setLinkStatus, 0));
  }

  // ------------------------------------------------------------------
  // 写入（同步函数，uid 显式传入：开发页“模拟对方改动”用别人的身份调用）
  // ------------------------------------------------------------------
  function doInsert(uid, table, values) {
    requireUser(uid);
    if (table === 'trips' || table === 'trip_members' || table === 'trip_invites') throw deny('permission denied for table');
    const row = fullRow(table, { ...defaultsFor(table), ...clone(values) });
    if (!row.id && 'id' in TABLES[table].columns) row.id = newId();
    if (PERSONAL.has(table) && !row.user_id) row.user_id = uid;
    if (SHARED.has(table) && !isEditor(row.trip_id, uid)) throw deny();
    if (PERSONAL.has(table) && (row.user_id !== uid || !isMember(row.trip_id, uid))) throw deny();
    touchInsert(table, row, uid);
    checkConstraints(table, row, null);
    T(table).push(row);
    persist();
    emit([{ table, type: 'INSERT', row: clone(row), old: {} }]);
    return clone(row);
  }

  function doUpdate(uid, table, match, patch) {
    requireUser(uid);
    const i = findIndex(table, match);
    if (i === -1) return null;
    const prev = T(table)[i];
    const tripId = tripOf(table, prev);
    if (!isMember(tripId, uid)) return null; // 看不见的行：0 行
    if (table === 'trip_invites') throw deny('permission denied for table trip_invites');
    if (table === 'trips') {
      if (!isEditor(tripId, uid)) throw deny();
      if ('id' in patch && patch.id !== prev.id) throw pgError('42501', '行程 id 不能修改');
      if ('owner_id' in patch && patch.owner_id !== prev.owner_id && !isOwner(tripId, uid)) throw pgError('42501', '只有 owner 可以转让行程');
    } else if (table === 'trip_members') {
      if (prev.user_id !== uid && !isOwner(tripId, uid)) throw deny();
      if (('trip_id' in patch && patch.trip_id !== prev.trip_id) || ('user_id' in patch && patch.user_id !== prev.user_id)) throw pgError('42501', '不能修改成员所属的行程或用户');
      if ('role' in patch && patch.role !== prev.role && !isOwner(tripId, uid)) throw pgError('42501', '只有 owner 可以修改成员角色');
    } else if (SHARED.has(table)) {
      if (!isEditor(tripId, uid)) throw deny();
    } else if (PERSONAL.has(table)) {
      if (prev.user_id !== uid) throw deny();
      if ('user_id' in patch && patch.user_id !== uid) throw deny();
    }
    const row = { ...prev, ...clone(patch) };
    touchUpdate(table, row, prev, uid);
    checkConstraints(table, row, rowKey(table, prev));
    T(table)[i] = row;
    persist();
    emit([{ table, type: 'UPDATE', row: clone(row), old: pkOf(table, prev) }]);
    return clone(row);
  }

  const pkOf = (table, row) => Object.fromEntries(keyColumns(table).map((c) => [c, row[c]]));

  /** 删除一行 + 按外键级联；返回推送 */
  function deleteCascade(table, row, changes) {
    const list = T(table);
    const k = rowKey(table, row);
    const i = list.findIndex((r) => rowKey(table, r) === k);
    if (i === -1) return;
    list.splice(i, 1);
    changes.push({ table, type: 'DELETE', row: null, old: pkOf(table, row) });
    if (table === 'trips') {
      // 行程删掉：所有内容表、成员、邀请连带删除
      for (const t of [...BUNDLE_TABLES.filter((x) => x !== 'trips'), 'trip_invites', 'trip_user_state', 'checkins']) {
        for (const r of [...T(t)]) if (r.trip_id === row.id) deleteCascade(t, r, changes);
      }
      return;
    }
    for (const [depTable, cols] of Object.entries(REFERENCES)) {
      for (const [col, [target, action]] of Object.entries(cols)) {
        if (target !== table) continue;
        for (const r of [...T(depTable)]) {
          if (r[col] !== row.id || r.trip_id !== row.trip_id) continue;
          if (action === 'cascade') deleteCascade(depTable, r, changes);
          else {
            const j = T(depTable).indexOf(r);
            const next = { ...r, [col]: null };
            touchUpdate(depTable, next, r, null);
            T(depTable)[j] = next;
            changes.push({ table: depTable, type: 'UPDATE', row: clone(next), old: pkOf(depTable, r) });
          }
        }
      }
    }
  }

  function doRemove(uid, table, match) {
    requireUser(uid);
    const i = findIndex(table, match);
    if (i === -1) return false;
    const row = T(table)[i];
    const tripId = tripOf(table, row);
    if (!isMember(tripId, uid)) return false;
    if (table === 'trips' && !isOwner(tripId, uid)) throw deny();
    if (table === 'trip_members' && row.user_id !== uid && !isOwner(tripId, uid)) throw deny();
    if (table === 'trip_invites') throw deny();
    if (SHARED.has(table) && !isEditor(tripId, uid)) throw deny();
    if (PERSONAL.has(table) && row.user_id !== uid) throw deny();
    const changes = [];
    deleteCascade(table, row, changes);
    persist();
    emit(changes);
    return true;
  }

  // ------------------------------------------------------------------
  // 平台化 · 批 A 的 RPC（supabase/migrations/20261022090000_platform_a.sql 的同款：
  // create_trip_v2 / set_trip_dates / set_trip_dest / add_household_to_trip，规则、报错、返回值一样）
  // ------------------------------------------------------------------
  /** 演示里的「我们俩」= demo-db.json 里的那两个人（private.household） */
  const HOUSEHOLD = db.users.map((u) => u.id);

  /** 服务器那边以 SECURITY DEFINER 写入：不看 RLS，照样记 created_by、查约束；改动攒进 changes 一起推送 */
  function sysInsert(uid, table, values, changes) {
    const row = fullRow(table, { ...defaultsFor(table), ...clone(values) });
    if (!row.id && 'id' in TABLES[table].columns) row.id = newId();
    touchInsert(table, row, uid);
    checkConstraints(table, row, null);
    T(table).push(row);
    changes.push({ table, type: 'INSERT', row: clone(row), old: {} });
    return row;
  }
  function sysUpdate(uid, table, row, patch, changes) {
    const list = T(table);
    const i = list.indexOf(row);
    const next = { ...row, ...clone(patch) };
    touchUpdate(table, next, row, uid);
    checkConstraints(table, next, rowKey(table, row));
    list[i] = next;
    changes.push({ table, type: 'UPDATE', row: clone(next), old: pkOf(table, row) });
    return next;
  }
  const commit = (changes) => {
    persist();
    emit(changes);
  };
  const raise = (code, message, extra = {}) => new DataError(message, {
    kind: code === '42501' ? 'permission' : code === '23505' ? 'conflict' : 'validation', code,
    cause: { code, message, hint: extra.hint ?? null, details: extra.details ?? null },
  });
  const zhMd = (d) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  const isObjV = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const blank = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const numOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const journalHasContent = (j) => blank(j.body) !== '' || (Array.isArray(j.photos) && j.photos.length > 0) || (j.mood !== null && j.mood !== undefined);
  const lastLook = (userId, exceptTrip) => T('trip_members')
    .filter((m) => m.user_id === userId && m.trip_id !== exceptTrip)
    .sort((a, b) => tsMs(b.joined_at) - tsMs(a.joined_at) || String(a.trip_id).localeCompare(String(b.trip_id)))[0] || null;
  const membersOf = (tripId) => T('trip_members').filter((m) => m.trip_id === tripId);

  /** 某一天落在哪一段（private.trip_seg_for）：覆盖它的段里开始最晚的；都不覆盖取最近的 */
  function segFor(tripId, date) {
    const segs = T('segments').filter((s) => s.trip_id === tripId && s.start_date && s.end_date);
    if (!segs.length) return null;
    const covers = (s) => s.start_date <= date && date <= s.end_date;
    const key = (s) => (covers(s) ? dayDiff(s.start_date, date) : Math.min(Math.abs(dayDiff(s.start_date, date)), Math.abs(dayDiff(s.end_date, date))));
    return [...segs].sort((a, b) => (covers(b) - covers(a)) || key(a) - key(b) || (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)))[0].id;
  }

  /** private.starter_todos */
  function starterTodos(region, home, local) {
    const r = region || '';
    return [
      ['买流量卡或 eSIM', r !== 'HK'],
      ['换点当地现金', Boolean(local) && local !== (home || 'HKD')],
      ['网上值机', !['HK', 'MO', 'CN'].includes(r)],
      ['查入境要求（按你们的护照）', !['HK', 'CN'].includes(r)],
    ].filter(([, keep]) => keep).map(([title]) => ({ list: 'todo', title }));
  }

  /** private.add_household：自己在「我们俩」里才拉得动 */
  function addHousehold(tripId, uid, changes) {
    if (!HOUSEHOLD.includes(uid)) return { added: [], in_household: false };
    const added = [];
    for (const other of HOUSEHOLD) {
      if (other === uid || memberRow(tripId, other)) continue;
      const user = userOf(other);
      const look = lastLook(other, tripId);
      const member = fullRow('trip_members', { trip_id: tripId, user_id: other, email: user?.email || null, role: 'editor', joined_at: stamp(), display_name: look?.display_name ?? null, color: look?.color ?? null });
      T('trip_members').push(member);
      changes.push({ table: 'trip_members', type: 'INSERT', row: clone(member), old: {} });
      added.push(other);
    }
    return { added, in_household: true };
  }

  function createTripV2(uid, p) {
    if (!uid) throw raise('42501', '需要先登录');
    if (!isObjV(p)) throw raise('22023', '新建行程的格式不对');
    const token = blank(p.token);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw raise('22023', '缺少新建凭据（token），刷新一下再试');
    state.createTokens = state.createTokens || {};
    const prev = state.createTokens[`${uid}:${token}`];
    if (prev && tripRow(prev.trip_id)) return { ...clone(prev), replay: true };

    const title = blank(p.title);
    if (!title) throw raise('22023', '行程名字不能为空');
    if (title.length > 100) throw raise('22023', '行程名字太长了');
    const start = p.start_date || null;
    const end = p.end_date || null;
    if (!start || !end) throw raise('22023', '要选出发和回来的日期');
    if (!isValidDate(start) || !isValidDate(end)) throw raise('22007', '日期或时间的格式不对');
    if (end < start) throw raise('22023', '回来的日期不能早于出发');
    if (dayDiff(start, end) > 59) throw raise('22023', '一趟最多 60 天');
    let segs = p.segments === null || p.segments === undefined ? [] : p.segments;
    if (!Array.isArray(segs) || segs.length > 5) throw raise('22023', '一趟最多 5 个城市');
    const tz = blank(p.timezone) || blank(segs[0]?.timezone) || 'Asia/Hong_Kong';
    if (!isValidTimeZone(tz)) throw raise('22023', '时区不对（例如 Asia/Ho_Chi_Minh）');
    const home = (blank(p.home_currency) || 'HKD').toUpperCase();
    const local = blank(p.local_currency) ? blank(p.local_currency).toUpperCase() : null;
    if (!/^[A-Z]{3}$/.test(home) || (local && !/^[A-Z]{3}$/.test(local))) throw raise('22023', '币种要写三位代码（如 HKD、VND）');
    let dest = p.dest === undefined || p.dest === null ? null : p.dest;
    if (!destOk(dest)) throw raise('22023', '目的地的写法不对');
    if (dest && !('v' in dest)) dest = { v: 1, ...dest };
    const short = blank(p.short_name) || null;
    if (short && short.length > 20) throw raise('22023', '简称最多 20 个字');
    const cover = isObjV(p.cover) ? p.cover : {};
    if (blank(p.subtitle).length > 200) throw raise('22023', '副标题太长了');
    const sorted = segs.map((s, i) => ({ s, i, start: (isObjV(s) && s.start_date) || start }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.i - b.i)).map((x) => x.s);
    let prevEnd = null;
    for (const s of sorted) {
      if (!isObjV(s) || !blank(s.name)) throw raise('22023', '每个城市都要有名字');
      const name = blank(s.name);
      if (String(s.name).length > 80) throw raise('22023', '城市名字太长了');
      const ss = s.start_date || start;
      const se = s.end_date || end;
      if (ss < start || se > end || se < ss) throw raise('22023', `「${name}」的日期不在这趟的日期里`);
      if (prevEnd && ss < prevEnd) throw raise('22023', '几个城市的日期重叠了');
      prevEnd = se;
      if (blank(s.timezone) && !isValidTimeZone(blank(s.timezone))) throw raise('22023', `「${name}」的时区不对`);
      const lat = numOf(s.center_lat);
      const lng = numOf(s.center_lng);
      if ((lat === null) !== (lng === null) || (lat !== null && Math.abs(lat) > 90) || (lng !== null && Math.abs(lng) > 180)) throw raise('22023', `「${name}」的位置不对`);
      if (!segDestOk(s.dest ?? null)) throw raise('22023', `「${name}」的目的地写法不对`);
    }
    const todos = 'todos' in p && p.todos !== null ? p.todos : starterTodos(dest?.region, home, local);
    if (!Array.isArray(todos) || todos.length > 12) throw raise('22023', '待办的格式不对');
    for (const t of todos) {
      if (!isObjV(t) || !blank(t.title) || !['confirm', 'packing', 'todo', 'buy'].includes(blank(t.list) || 'todo')) throw raise('22023', '待办的格式不对');
    }
    const copy = blank(p.copy_from) || null;
    if (copy && !isMember(copy, uid)) throw raise('42501', '没法从那一趟带清单过来');

    let base = blank(p.id) || null;
    if (base && !TRIP_ID_RE.test(base)) throw raise('22023', '行程 id 只能用小写字母、数字、- 和 _，2 到 40 位');
    // 和 SQL 一样：第一个内置城市 id；只选了国家按国家英文名（thailand-2027）
    if (!base) base = `${typeof dest?.cities?.[0] === 'string' ? dest.cities[0].slice(0, 34) : regionSlug(dest?.region)}-${start.slice(0, 4)}`;
    let id = base;
    for (let n = 2; tripRow(id); n++) {
      if (n > 50) throw raise('23505', `行程 id ${base} 已存在`);
      id = `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    }

    const changes = [];
    const extra = {};
    if (dest) extra.dest = dest;
    if (short) extra.short_name = short;
    const trip = fullRow('trips', {
      ...defaultsFor('trips'), id, title, subtitle: blank(p.subtitle) || null, description: null, start_date: start, end_date: end, timezone: tz,
      home_currency: home, local_currency: local, cover, cover_emoji: blank(cover.emoji) || '✈️', status: 'planning', sort: 0, owner_id: uid, extra,
    });
    touchInsert('trips', trip, uid);
    checkConstraints('trips', trip, null);
    T('trips').push(trip);
    changes.push({ table: 'trips', type: 'INSERT', row: clone(trip), old: {} });
    const me = userOf(uid);
    const look = lastLook(uid, id);
    const owner = fullRow('trip_members', { trip_id: id, user_id: uid, email: me?.email || null, role: 'owner', joined_at: stamp(), display_name: look?.display_name ?? null, color: look?.color ?? null });
    T('trip_members').push(owner);
    changes.push({ table: 'trip_members', type: 'INSERT', row: clone(owner), old: {} });
    const partner = p.with_partner === false || p.with_partner === 'false' ? { added: [], in_household: false } : addHousehold(id, uid, changes);
    trip.extra = { ...trip.extra, party_size: membersOf(id).length };

    if (!sorted.length) {
      const sd = dest ? { region: dest.region } : null;
      if (sd && Array.isArray(dest.cities) && dest.cities.length === 1) sd.city = dest.cities[0];
      sorted.push({ name: short || title, ...(sd ? { dest: sd } : {}) });
    }
    sorted.forEach((s, i) => {
      const segTz = blank(s.timezone) || null;
      sysInsert(uid, 'segments', {
        id: blank(s.id) || newId(), trip_id: id, sort: (i + 1) * 10, name: blank(s.name), name_en: blank(s.name_en) || null,
        start_date: s.start_date || start, end_date: s.end_date || end, center_lat: numOf(s.center_lat), center_lng: numOf(s.center_lng),
        timezone: segTz && segTz !== tz ? segTz : null, icon: blank(s.icon).slice(0, 8) || null,
        extra: isObjV(s.dest) ? { dest: clone(s.dest) } : {},
      }, changes);
    });
    let days = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      sysInsert(uid, 'days', { trip_id: id, date: d, segment_id: segFor(id, d), title: '', planning_status: 'tbd' }, changes);
      days += 1;
    }
    let packing = 0;
    if (copy) {
      const src = T('todos').filter((t) => t.trip_id === copy && t.list === 'packing')
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || tsMs(a.created_at) - tsMs(b.created_at) || String(a.id).localeCompare(String(b.id)));
      for (const t of src) {
        sysInsert(uid, 'todos', { trip_id: id, list: 'packing', title: t.title, category: t.category ?? null, note: t.note ?? null, qty: t.qty ?? null, sort: t.sort ?? 0, done: false }, changes);
        packing += 1;
      }
    }
    for (const t of todos) {
      const list = blank(t.list) || 'todo';
      const sort = T('todos').filter((x) => x.trip_id === id && x.list === list).reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 10;
      sysInsert(uid, 'todos', { trip_id: id, list, title: blank(t.title).slice(0, 200), note: blank(t.note).slice(0, 5000) || null, sort, done: false }, changes);
    }
    const res = { trip_id: id, days, segments: sorted.length, packing, todos: todos.length, ...partner, replay: false };
    state.createTokens[`${uid}:${token}`] = clone(res);
    // trips 行最后的样子（party_size 补上了）再推一次，和数据库里事务结束时看到的一样
    changes[0] = { table: 'trips', type: 'INSERT', row: clone(trip), old: {} };
    commit(changes);
    return res;
  }

  function setTripDates(uid, tripId, startDate, endDate, moveToPool) {
    if (!uid) throw raise('42501', '需要先登录');
    const trip = tripRow(tripId);
    if (!trip || !isEditor(tripId, uid)) throw raise('42501', '只有能编辑这个行程的人才能改日期');
    if (!startDate || !endDate) throw raise('22023', '要选出发和回来的日期');
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw raise('22007', '日期或时间的格式不对');
    if (endDate < startDate) throw raise('22023', '回来的日期不能早于出发');
    if (dayDiff(startDate, endDate) > 59) throw raise('22023', '一趟最多 60 天');

    const outDays = T('days').filter((d) => d.trip_id === tripId && (d.date < startDate || d.date > endDate)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const outIds = new Set(outDays.map((d) => d.id));
    const wrote = outDays.find((d) => T('journal_entries').some((j) => j.trip_id === tripId && j.day_id === d.id && journalHasContent(j)));
    if (wrote) throw raise('22023', `${zhMd(wrote.date)} 写了日记，先挪走再改`, { hint: 'journal' });
    const detail = [];
    for (const d of outDays) {
      const items = T('items').filter((i) => i.trip_id === tripId && i.day_id === d.id && !i.deleted_at).length;
      const todos = T('todos').filter((x) => x.trip_id === tripId && x.day_id === d.id).length;
      const tips = T('tips').filter((x) => x.trip_id === tripId && x.day_id === d.id).length;
      const stay = Boolean(d.stay_booking_id);
      if (items + todos + tips > 0 || stay) detail.push({ date: d.date, items, todos, tips, stay });
    }
    if (detail.length && !moveToPool) {
      const f = detail[0];
      const parts = [];
      if (f.items) parts.push(`${f.items} 项`);
      if (f.todos) parts.push(`${f.todos} 条待办`);
      if (f.tips) parts.push(`${f.tips} 条贴士`);
      if (f.stay) parts.push('住处');
      const more = detail.length > 1 ? `（还有 ${detail.length - 1} 天也有）` : '';
      throw raise('22023', `${zhMd(f.date)} 还有 ${parts.join('、')}，先挪走再改${more}`, { hint: 'need_move', details: JSON.stringify(detail) });
    }

    const changes = [];
    let moved = 0, unTodos = 0, unTips = 0, stays = 0, removed = 0, added = 0;
    if (outIds.size) {
      for (const i of T('items').filter((x) => x.trip_id === tripId && outIds.has(x.day_id) && !x.deleted_at)) { sysUpdate(uid, 'items', i, { day_id: null }, changes); moved += 1; }
      for (const x of T('todos').filter((r) => r.trip_id === tripId && outIds.has(r.day_id))) { sysUpdate(uid, 'todos', x, { day_id: null }, changes); unTodos += 1; }
      for (const x of T('tips').filter((r) => r.trip_id === tripId && outIds.has(r.day_id))) { sysUpdate(uid, 'tips', x, { day_id: null }, changes); unTips += 1; }
      stays = outDays.filter((d) => d.stay_booking_id).length;
      for (const d of outDays) { deleteCascade('days', d, changes); removed += 1; }   // 空日记、软删的条目按外键规则处理
    }

    const dated = () => T('segments').filter((s) => s.trip_id === tripId && s.start_date && s.end_date);
    if (!dated().some((s) => s.start_date <= endDate && s.end_date >= startDate) && trip.start_date) {
      const delta = dayDiff(trip.start_date, startDate);
      for (const s of dated()) sysUpdate(uid, 'segments', s, { start_date: addDays(s.start_date, delta), end_date: addDays(s.end_date, delta) }, changes);
    }
    for (const s of dated()) if (s.end_date < startDate || s.start_date > endDate) sysUpdate(uid, 'segments', s, { start_date: null, end_date: null }, changes);
    for (const s of dated()) {
      if (s.start_date < startDate || s.end_date > endDate) {
        sysUpdate(uid, 'segments', s, { start_date: s.start_date < startDate ? startDate : s.start_date, end_date: s.end_date > endDate ? endDate : s.end_date }, changes);
      }
    }
    const segs = () => T('segments').filter((s) => s.trip_id === tripId);
    const first = segs().filter((s) => s.start_date).sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id))))[0];
    if (first && first.start_date !== startDate) sysUpdate(uid, 'segments', first, { start_date: startDate }, changes);
    const last = segs().filter((s) => s.end_date).sort((a, b) => (a.end_date > b.end_date ? -1 : a.end_date < b.end_date ? 1 : (b.sort ?? 0) - (a.sort ?? 0) || String(b.id).localeCompare(String(a.id))))[0];
    if (last && last.end_date !== endDate) sysUpdate(uid, 'segments', last, { end_date: endDate }, changes);

    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      if (T('days').some((x) => x.trip_id === tripId && x.date === d)) continue;
      sysInsert(uid, 'days', { trip_id: tripId, date: d, segment_id: segFor(tripId, d), title: '', planning_status: 'tbd' }, changes);
      added += 1;
    }
    const cur = tripRow(tripId);
    if (cur.start_date !== startDate || cur.end_date !== endDate) sysUpdate(uid, 'trips', cur, { start_date: startDate, end_date: endDate }, changes);
    commit(changes);
    return { trip_id: tripId, start_date: startDate, end_date: endDate, added, removed, moved_items: moved, unlinked_todos: unTodos, unlinked_tips: unTips, dropped_stays: stays };
  }

  function setTripDest(uid, tripId, patch, segmentId) {
    if (!uid) throw raise('42501', '需要先登录');
    if (!tripId || !tripRow(tripId) || !isEditor(tripId, uid)) throw raise('42501', '只有能编辑这个行程的人才能改');
    if (patch !== null && patch !== undefined && !isObjV(patch)) throw raise('22023', '目的地的写法不对');
    const table = segmentId ? 'segments' : 'trips';
    const row = segmentId ? T('segments').find((s) => s.trip_id === tripId && s.id === segmentId) : tripRow(tripId);
    if (!row) throw raise('22023', '这一段不在这个行程里');
    let next = null;
    if (patch !== null && patch !== undefined) {
      next = isObjV(row.extra?.dest) ? clone(row.extra.dest) : {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = clone(v);
      }
      if (!segmentId && !('v' in next)) next = { v: 1, ...next };
      if (segmentId ? !segDestOk(next) : !destOk(next)) throw raise('22023', '目的地的写法不对');
    }
    const cur = row.extra?.dest ?? null;
    if (stableStringify(cur) === stableStringify(next)) return clone(row);   // 没变化：不写
    const extra = { ...(row.extra || {}) };
    if (next === null) delete extra.dest;
    else extra.dest = next;
    const changes = [];
    const out = sysUpdate(uid, table, row, { extra }, changes);
    commit(changes);
    return clone(out);
  }

  function addPartner(uid, tripId) {
    if (!uid) throw raise('42501', '需要先登录');
    if (!tripId || !tripRow(tripId) || !isEditor(tripId, uid)) throw raise('42501', '只有能编辑这个行程的人才能拉人进来');
    const changes = [];
    const res = addHousehold(tripId, uid, changes);
    const trip = tripRow(tripId);
    if (res.added.length && (trip.extra?.party_size === undefined || typeof trip.extra?.party_size === 'number')) {
      sysUpdate(uid, 'trips', trip, { extra: { ...trip.extra, party_size: membersOf(tripId).filter((m) => ['owner', 'editor'].includes(m.role)).length } }, changes);
    }
    commit(changes);
    const members = membersOf(tripId).sort((a, b) => tsMs(a.joined_at) - tsMs(b.joined_at) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((m) => ({ user_id: m.user_id, role: m.role, display_name: m.display_name ?? null, color: m.color ?? null }));
    return { ...res, trip_id: tripId, members };
  }

  // ------------------------------------------------------------------
  // RPC（和 SQL 里的函数同样的规则和中文报错）
  // ------------------------------------------------------------------
  async function doRpc(uid, name, p = {}) {
    switch (name) {
      case 'ping': return 'ok';
      case 'is_trip_member': return isMember(p.check_trip_id, uid);
      case 'is_trip_editor': return isEditor(p.check_trip_id, uid);
      case 'is_trip_owner': return isOwner(p.check_trip_id, uid);
      case 'create_trip': {
        if (!uid) throw pgError('42501', '需要先登录');
        if (!p.p_id || !TRIP_ID_RE.test(p.p_id)) throw pgError('22023', '行程 id 只能用小写字母、数字、- 和 _，2 到 40 位');
        if (!String(p.p_title || '').trim()) throw pgError('22023', '行程标题不能为空');
        if (tripRow(p.p_id)) throw pgError('23505', `行程 id ${p.p_id} 已存在`);
        const ts = stamp();
        const cover = p.p_cover || {};
        const trip = fullRow('trips', {
          id: p.p_id, title: String(p.p_title).trim(), description: null, cover_emoji: cover.emoji || '✈️',
          start_date: p.p_start_date || null, end_date: p.p_end_date || null, owner_id: uid, created_at: ts,
          subtitle: p.p_subtitle || null, timezone: p.p_timezone || 'Asia/Hong_Kong', home_currency: String(p.p_home_currency || 'HKD').toUpperCase(),
          local_currency: p.p_local_currency ? String(p.p_local_currency).toUpperCase() : null, cover, status: 'planning', sort: 0,
          updated_at: ts, updated_by: null, extra: {},
        });
        const problem = validateRow('trips', trip);
        if (problem) throw pgError('23514', problem.message);
        T('trips').push(trip);
        const me = userOf(uid);
        const member = fullRow('trip_members', { trip_id: trip.id, user_id: uid, email: me?.email || null, role: 'owner', joined_at: ts, display_name: me?.display_name || null, color: null });
        T('trip_members').push(member);
        persist();
        emit([{ table: 'trips', type: 'INSERT', row: clone(trip), old: {} }, { table: 'trip_members', type: 'INSERT', row: clone(member), old: {} }]);
        return trip.id;
      }
      case 'create_invite': {
        if (!uid) throw pgError('42501', '需要先登录');
        if (!isEditor(p.p_trip_id, uid)) throw pgError('42501', '只有行程的 owner 或 editor 可以生成邀请码');
        const role = p.p_role ?? 'editor';
        const hours = p.p_valid_hours ?? 168;
        const maxUses = p.p_max_uses ?? 1;
        if (!['editor', 'viewer'].includes(role)) throw pgError('22023', '邀请角色只能是 editor 或 viewer');
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw pgError('22023', '有效期必须在 1 到 720 小时之间');
        if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) throw pgError('22023', '可用次数必须在 1 到 20 之间');
        const raw = randomCode();
        const ts = stamp();
        T('trip_invites').push(fullRow('trip_invites', {
          id: newId(), trip_id: p.p_trip_id, invite_code: null, created_by: uid, role, created_at: ts,
          expires_at: toTimestamptz(now().getTime() + hours * 3_600_000), code_hash: await sha256Hex(raw), max_uses: maxUses, used_count: 0, revoked_at: null, last_used_at: null,
        }));
        persist();
        return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      }
      case 'redeem_invite': {
        if (!uid) throw pgError('42501', '需要先登录');
        const norm = String(p.p_code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (norm.length !== 12) throw pgError('22023', '邀请码无效或已过期');
        const hash = await sha256Hex(norm);
        const inv = T('trip_invites').find((x) => x.code_hash === hash);
        if (inv && isMember(inv.trip_id, uid)) return inv.trip_id;
        if (!inv || inv.revoked_at || !inv.expires_at || tsMs(inv.expires_at) <= now().getTime() || inv.used_count >= inv.max_uses) {
          throw pgError('22023', '邀请码无效或已过期');
        }
        const me = userOf(uid);
        const ts = stamp();
        const member = fullRow('trip_members', { trip_id: inv.trip_id, user_id: uid, email: me?.email || null, role: inv.role || 'viewer', joined_at: ts, display_name: me?.display_name || null, color: null });
        T('trip_members').push(member);
        inv.used_count += 1;
        inv.last_used_at = ts;
        persist();
        emit([{ table: 'trip_members', type: 'INSERT', row: clone(member), old: {} }]);
        return inv.trip_id;
      }
      case 'peek_invite': {
        // 和 supabase/migrations/20261013200000_peek_invite.sql 同样的校验：只看不入会、不消耗次数
        if (!uid) throw pgError('42501', '需要先登录');
        const norm = String(p.p_code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (norm.length !== 12) throw pgError('22023', '邀请码无效或已过期');
        const hash = await sha256Hex(norm);
        const inv = T('trip_invites').find((x) => x.code_hash === hash);
        if (!inv) throw pgError('22023', '邀请码无效或已过期');
        const member = isMember(inv.trip_id, uid);
        if (!member && (inv.revoked_at || !inv.expires_at || tsMs(inv.expires_at) <= now().getTime() || inv.used_count >= inv.max_uses)) {
          throw pgError('22023', '邀请码无效或已过期');
        }
        const trip = T('trips').find((t) => t.id === inv.trip_id);
        const inviter = T('trip_members').find((m) => m.trip_id === inv.trip_id && m.user_id === inv.created_by);
        // 和 supabase/migrations/…_peek_invite.sql 一样：没写显示名时不回邮箱的任何部分
        const inviterName = inviter ? inviter.display_name || (inviter.user_id === trip?.owner_id ? '行程创建者' : '行程成员') : null;
        return { trip_title: trip?.title || null, inviter_name: inviterName || null, role: inv.role || 'viewer', expires_at: inv.expires_at, already_member: member };
      }
      case 'create_trip_v2': return createTripV2(uid, p.p);
      case 'set_trip_dates': return setTripDates(uid, p.p_trip_id, p.p_start_date, p.p_end_date, Boolean(p.p_move_to_pool));
      case 'set_trip_dest': return setTripDest(uid, p.p_trip_id, p.p_patch ?? null, p.p_segment_id ?? null);
      case 'add_household_to_trip': return addPartner(uid, p.p_trip_id);
      case 'revoke_invite': {
        const inv = T('trip_invites').find((x) => x.id === p.p_invite_id);
        if (!inv || !isEditor(inv.trip_id, uid)) throw pgError('42501', '邀请不存在或没有权限');
        inv.revoked_at = inv.revoked_at || stamp();
        persist();
        return null;
      }
      default:
        throw new DataError(`后台没有这个函数：${name}`, { kind: 'server', code: 'PGRST202' });
    }
  }

  // ------------------------------------------------------------------
  // 文件
  // ------------------------------------------------------------------
  const objectUrls = new Map();

  function checkPath(uid, path, write) {
    const parts = String(path).split('/');
    if (parts.length < 3 || !isMember(parts[0], uid) || (write && parts[1] !== uid)) {
      throw new DataError(write ? '只能上传到自己的目录' : '没有权限读取这个文件', { kind: 'permission', status: 403 });
    }
  }

  // ------------------------------------------------------------------
  // 对外接口
  // ------------------------------------------------------------------
  let authListener = null;
  const emitAuth = (event) => authListener?.(event, toUser(userOf(currentUserId)));

  const auth = {
    async init(onChange) {
      authListener = onChange;
      return { user: toUser(userOf(currentUserId)), offline: false };
    },
    async signInWithPassword(email, password) {
      await net();
      const u = state.users.find((x) => x.email.toLowerCase() === String(email || '').trim().toLowerCase());
      if (!u || password !== DEMO_PASSWORD) throw new DataError('邮箱或密码不对', { kind: 'validation', code: 'invalid_credentials' });
      if (!u.confirmed) throw new DataError('邮箱还没验证：请输入邮件里的验证码，或者用验证码登录', { kind: 'validation', code: 'email_not_confirmed' });
      currentUserId = u.id;
      saveAuth();
      emitAuth('SIGNED_IN');
      return { user: toUser(u) };
    },
    async signUp(email, password) {
      await net();
      const e = String(email || '').trim().toLowerCase();
      if (!isEmail(e)) throw new DataError('邮箱格式不对', { kind: 'validation' });
      if (String(password || '').length < 6) throw new DataError('密码太简单了：至少 6 位', { kind: 'validation' });
      if (state.users.some((x) => x.email.toLowerCase() === e)) throw new DataError('这个邮箱已经注册过了，直接登录就好', { kind: 'conflict' });
      const u = { id: newId(), email: e, ref: emailHandle(e), display_name: emailHandle(e), confirmed: false };
      state.users.push(u);
      persist();
      return { user: toUser(u), needsVerification: true };
    },
    async sendOtp(email, { createUser = false } = {}) {
      await net();
      const e = String(email || '').trim().toLowerCase();
      if (!isEmail(e)) throw new DataError('邮箱格式不对', { kind: 'validation' });
      if (!state.users.some((x) => x.email.toLowerCase() === e)) {
        if (!createUser) throw new DataError('这个邮箱还没注册，请先注册', { kind: 'not-found' });
        state.users.push({ id: newId(), email: e, ref: emailHandle(e), display_name: emailHandle(e), confirmed: false });
        persist();
      }
    },
    async verifyOtp(email, token) {
      await net();
      const u = state.users.find((x) => x.email.toLowerCase() === String(email || '').trim().toLowerCase());
      if (!u || String(token || '').trim() !== DEMO_OTP) throw new DataError('验证码不对或已过期', { kind: 'validation', code: 'otp_expired' });
      u.confirmed = true;
      currentUserId = u.id;
      persist();
      saveAuth();
      emitAuth('SIGNED_IN');
      return { user: toUser(u) };
    },
    async resendSignup() {
      await net();
    },
    async updatePassword(password) {
      await net();
      if (String(password || '').length < 6) throw new DataError('密码太简单了：至少 6 位', { kind: 'validation' });
      return { user: toUser(userOf(currentUserId)) };
    },
    async signOut() {
      currentUserId = null;
      saveAuth();
      emitAuth('SIGNED_OUT');
    },
    async refresh() {
      await net();
    },
    async setSessionFromUrl() {
      throw new DataError('演示模式不支持登录链接', { kind: 'validation' });
    },
    /** 给翻译接口用的 token：演示模式是个假的（演示翻译不连网；e2e 用它测真接口的请求格式） */
    async accessToken() {
      return currentUserId ? `demo.${currentUserId}` : null;
    },
  };

  const visibleRows = (table, tripId) => T(table).filter((r) => tripOf(table, r) === tripId).map(clone);

  const backend = {
    kind: 'demo',
    auth,

    async fetchTripBundle(tripId) {
      await net();
      requireUser(currentUserId);
      const out = {};
      const member = isMember(tripId, currentUserId);
      for (const t of BUNDLE_TABLES) out[t] = member ? visibleRows(t, tripId) : [];
      return out;
    },

    async fetchMyTrips(userId) {
      await net();
      requireUser(currentUserId);
      const memberships = T('trip_members').filter((m) => m.user_id === userId).map(clone);
      const ids = new Set(memberships.map((m) => m.trip_id));
      return { trips: T('trips').filter((t) => ids.has(t.id)).map(clone), memberships };
    },

    async fetchInvites(tripId) {
      await net();
      if (!isEditor(tripId, currentUserId)) return [];
      return T('trip_invites').filter((i) => i.trip_id === tripId)
        .sort((a, b) => tsMs(b.created_at) - tsMs(a.created_at))
        .map(({ code_hash, invite_code, ...rest }) => clone(rest));
    },

    async fetchRow(table, match) {
      await net();
      const i = findIndex(table, match);
      if (i === -1) return null;
      const row = T(table)[i];
      return isMember(tripOf(table, row), currentUserId) ? clone(row) : null;
    },

    async insert(table, row) {
      await net();
      return doInsert(currentUserId, table, row);
    },

    async update(table, match, patch) {
      await net();
      return doUpdate(currentUserId, table, match, patch);
    },

    async remove(table, match) {
      await net();
      doRemove(currentUserId, table, match);
    },

    async rpc(name, params) {
      await net();
      return doRpc(currentUserId, name, params);
    },

    async upload(path, blob, contentType) {
      await net();
      requireUser(currentUserId);
      checkPath(currentUserId, path, true);
      if (!ALLOWED_MIME.includes(contentType)) throw new DataError('不支持这种文件类型', { kind: 'validation', status: 415 });
      if ((blob?.size || 0) > MAX_FILE_BYTES) throw new DataError('文件太大了（最大 20 MB）', { kind: 'validation', status: 413 });
      if (state.files[path]) return; // 已经传过（重试）
      await kv.set(FILE_PREFIX + path, blob);
      state.files[path] = { contentType, size: blob?.size || 0, owner: currentUserId, at: stamp() };
      persist();
    },

    async signedUrls(paths) {
      await net();
      const out = new Map();
      for (const p of paths) {
        try {
          checkPath(currentUserId, p, false);
        } catch {
          out.set(p, null);
          continue;
        }
        const seeded = db.photoUrls[String(p).split('/').pop()];
        if (seeded) {
          out.set(p, seeded);
          continue;
        }
        if (objectUrls.has(p)) {
          out.set(p, objectUrls.get(p));
          continue;
        }
        const blob = state.files[p] ? await kv.get(FILE_PREFIX + p) : null;
        if (blob && typeof URL !== 'undefined' && URL.createObjectURL) {
          const url = URL.createObjectURL(blob);
          objectUrls.set(p, url);
          out.set(p, url);
        } else {
          out.set(p, null);
        }
      }
      return out;
    },

    async removeFiles(paths) {
      await net();
      for (const p of paths) {
        checkPath(currentUserId, p, true);
        delete state.files[p];
        await kv.del(FILE_PREFIX + p);
        const url = objectUrls.get(p);
        if (url) URL.revokeObjectURL?.(url);
        objectUrls.delete(p);
      }
      persist();
    },

    subscribeTrip(tripId, { onChange, onStatus }) {
      const sub = { tripId, onChange, onStatus, status: 'connecting' };
      subscribers.add(sub);
      setTimeout(() => {
        if (!subscribers.has(sub)) return;
        sub.status = offline() ? 'error' : 'live';
        onStatus(sub.status);
      }, Math.max(10, Math.round((network.value.latency || 0) / 2)));
      return () => {
        subscribers.delete(sub);
      };
    },

    /** 演示专用：开发页、e2e 用 */
    demo: {
      DEMO_PASSWORD,
      DEMO_OTP,
      network,
      setNetwork: (patch) => {
        network.value = { ...network.value, ...patch };
      },
      users: () => state.users.map((u) => ({ ...u })),
      currentUserId: () => currentUserId,
      /** 以别人的身份改数据（模拟“对方在另一台手机上改了”），会推送实时变化 */
      as(userId) {
        return {
          insert: (table, row) => doInsert(userId, table, row),
          update: (table, match, patch) => doUpdate(userId, table, match, patch),
          remove: (table, match) => doRemove(userId, table, match),
          rpc: (name, params) => doRpc(userId, name, params),
        };
      },
      /** 恢复成 demo-db.json 的原样（文件也清掉） */
      async reset() {
        for (const p of Object.keys(state.files)) await kv.del(FILE_PREFIX + p);
        state = freshState();
        await persistNow();
      },
      persistNow,
      stats: () => Object.fromEntries(Object.keys(TABLES).map((t) => [t, T(t).length])),
      fileCount: () => Object.keys(state.files).length,
    },
  };
  return backend;
}
