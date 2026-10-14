// =====================================================================
// data/index.js：数据层对外的唯一入口（页面、组件只从这里 import）。
//
//   import { data, initData, useTrip, useMyTrips, useSignedUrl, authState, syncStatus } from '../data/index.js';
//
// 启动（main.jsx，一次）：
//   initData({ router });        恢复登录状态、装路由守卫、监听联网 / 回到前台
//
// 读：
//   authState.value              { status: 'unknown'|'signed-in'|'signed-out', user, offline }
//   useMyTrips()                 { status, entries: [{ id, trip, role, member }], error }
//   const store = useTrip(id)    TripStore：store.status / store.trip / store.view.* / store.tables.*
//   syncStatus.value             { state: 'synced'|'syncing'|'offline'|'retrying'|'error'|'stale', message, pending, … }
//   undoable.value               { label, undo(), expiresAt } | null   （“已删除 · 撤销”）
//
// 写：store.insert / update / remove / softDelete / restore / move / addExpense / toggleTodo / saveJournal …
//     data.rpc.createTrip / createInvite / redeemInvite / revokeInvite / loadInvites
//     data.files.upload(tripId, 'journal', file)
//     data.auth.signInWithPassword / sendEmailCode / verifyEmailCode / signUp / signOut
//
// 演示模式（本机 + ?demo=1）：同一套接口，后台换成 backend-demo.js（虚构数据，内存 + IndexedDB），
// 线上永远不会进入。数据库名也分开（rs7885-demo），本机开发不会和真实缓存串。
// 本机真实数据预览（npm run dev -- --real，网址 ?demo=1&real=1）：同样是演示后台，数据换成开发服务器在内存里
// 展开的真实行程（见 demo.js）；存储只用内存（rs7885-real），真实数据不写进浏览器的 IndexedDB。
// =====================================================================

/* global __DEV__ */

import { effect } from '@preact/signals';
import { isDemoMode } from '../lib/env.js';
import { fx as fxService, hkdRatesOf } from '../lib/services/fx.js';
import { keepFxFresh } from './fx-refresh.js';
import { createKv, createMemoryKv } from './kv.js';
import { setFxRates } from './fx.js';
import { createLeader } from './outbox.js';
import { createLazyBackend } from './backend-lazy.js';
import { createDataLayer } from './layer.js';
import { createHooks } from './hooks.js';
import { installAuthGuard } from './guard.js';
import { loadDemoDb, isRealPreview } from './demo.js';
import { readStoredUser } from './session.js';

const demo = isDemoMode();
let NAME = demo ? 'rs7885-demo' : 'rs7885';
let real = false;
// 本机真实数据预览只在开发构建里：npm run build 里条件是字面量 false，这一支在打包时整段删掉
if (typeof __DEV__ !== 'undefined' && __DEV__ && demo && isRealPreview()) {
  real = true;
  NAME = 'rs7885-real';
}

function makeChannel(name) {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
  } catch {
    return null;
  }
}

const kv = real ? createMemoryKv(NAME) : createKv(NAME);

const backend = demo
  ? createLazyBackend(async () => {
    const [{ createDemoBackend }, db] = await Promise.all([import('./backend-demo.js'), loadDemoDb()]);
    return createDemoBackend({ db, kv, channel: makeChannel(`${NAME}-server`) });
  }, 'demo')
  : createLazyBackend(async () => {
    const { createSupabaseBackend } = await import('./backend-supabase.js');
    return createSupabaseBackend();
  }, 'supabase');

let layerRef = null;
// 写队列的“发送者”锁和广播按账号分开：演示模式两个标签页用不同的人（?demouser=cathy）时，每个人的队列各自有人发
// （以前全站一把锁，后开那个人的改动永远“正在同步”，代码评审 P2-7）。线上一个浏览器同时只登录一个账号，不受影响。
const OUTBOX = demo ? `${NAME}-outbox${demoUserSuffix()}` : `${NAME}-outbox`;
const leader = createLeader(OUTBOX, () => layerRef?.outbox.flush());

/** 演示模式的 ?demouser=（换账号演示协作）→ 锁名后缀 */
function demoUserSuffix() {
  try {
    const u = new URLSearchParams(globalThis.location?.search || '').get('demouser');
    return u && /^[a-z0-9_-]{1,32}$/i.test(u) ? `-${u.toLowerCase()}` : '';
  } catch {
    return '';
  }
}

/** 数据层实例（单例） */
export const data = createDataLayer({
  backend, kv, demo, channel: makeChannel(OUTBOX), leader,
  // 后台代码下载失败时，按本机保存的会话先当“离线已登录”（演示模式没有真实会话）
  storedUser: demo ? null : () => readStoredUser(),
});
layerRef = data;

// 汇率：lib/services/fx.js 拿到实时汇率（或缓存 / 演示汇率）后，预算、记账汇总、新记一笔的 fx_rate 都改用它；
// 没拿到时用 lib/money.js 的参考汇率（1 港币≈3,300 越南盾、1 人民币≈1.17 港币、1 港币≈4.07 新台币）。
effect(() => {
  const s = fxService.state.value.snapshot;
  if (!s) return;
  const source = s.source === 'fallback' ? 'approx' : s.offline ? 'cached' : s.source;
  const at = s.providerUpdatedAt || s.fetchedAt;
  setFxRates(hkdRatesOf(s), { source, at: at ? new Date(at).toISOString() : null });
});

let started = null;
let detachEnv = null;
let offGuard = null;

/**
 * 启动数据层（可重复调用）：恢复登录状态、监听环境；传了 router 就装登录守卫。
 * @param {{ router?: object }} [o]
 * @returns {Promise<object>} 登录状态
 */
export function initData({ router } = {}) {
  if (router && !offGuard) offGuard = installAuthGuard(router, data);
  if (!started) {
    detachEnv = data.attachEnvironment();
    started = data.auth.init();
    // 汇率（24 小时缓存；演示模式不联网）：登录以后才要用（预算、记账折合港币），登录页不发这个请求。
    // App 常驻不关时每次时钟刷新都检查一次有没有过期（见 fx-refresh.js）
    keepFxFresh({ authState: data.auth.state, clockTick: data.clockTick, ensure: () => fxService.ensure() });
  }
  return started;
}

/** 测试 / 热重载用：卸下监听 */
export function stopData() {
  detachEnv?.();
  offGuard?.();
  detachEnv = null;
  offGuard = null;
}

/**
 * 加载一个行程的数据包（缓存 → 网络 → 实时），加载完成后返回它的 TripStore。
 * 页面里一般用 useTrip(tripId)；这里给非组件代码用（例如路由守卫、预加载）。
 * @param {string} tripId
 */
export async function loadTrip(tripId) {
  initData();
  const store = data.openTrip(tripId);
  await store.open();
  return store;
}

// 常用信号直接导出（组件里读 .value 自动订阅）
export const authState = data.auth.state;
export const authNotice = data.auth.notice;
export const syncStatus = data.syncStatus;
export const undoable = data.undoable;
export const activeStore = data.activeStore;
export const online = data.online;

export const { useTrip, useMyTrips, useSignedUrl } = createHooks(data, () => initData());

// 纯函数和常量（页面可以直接用来做格式化、排序、表单校验）
export * as selectors from './selectors.js';
export { DataError, isDataError } from './errors.js';
export { normalizeInviteCode, suggestTripId } from './rpc.js';
export { nextAfterLogin, installAuthGuard } from './guard.js';
export { sortTripsForList, pickCurrentTrip, resolveGo } from './trips.js';
export { fxRates, setFxRates, resetFxRates, normalizeCurrency, currencyDecimals, roundMoney } from './fx.js';
/** 本机真实数据预览（npm run dev -- --real，网址 ?demo=1&real=1）：外壳可以据此把“演示模式”角标换成“真实数据预览” */
export { isRealPreview } from './demo.js';
export { FILE_PURPOSES } from './files.js';
export { ENUMS } from './schema.js';
export { isDemoMode };
