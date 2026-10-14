// =====================================================================
// lib/services/fx.js：汇率服务（open.er-api.com，以港币为基准）。
//
//   import { fx, useFx, fxStatus, formatRate } from '../lib/services/fx.js';
//
//   // 组件里：挂载时确保有汇率（最多请求一次），返回 { status, snapshot, error }，汇率变了自动重新渲染
//   const { snapshot } = useFx();
//   formatMoney(400000, 'VND', { fx: snapshot })       // 用实时汇率标“约 HK$…”
//   convertAmount(400000, 'VND', 'HKD', snapshot)       // 换算
//   fxStatus(snapshot).text                             // '汇率 · 3 小时前更新' / '离线汇率 · 内置参考值'
//   formatRate(snapshot, 'VND')                         // '1 港币 ≈ 3,294 越南盾'
//
// 规则：
//   - 接口：GET https://open.er-api.com/v6/latest/HKD（免费、无需 key、每天更新一次；支持 VND、TWD、CNY）；
//   - 缓存：IndexedDB 24 小时。24 小时内一律用缓存，**不会因为渲染、换页、多个组件同时要而重复请求**
//     （内存里有新鲜的直接返回；正在请求时共用同一个 Promise）；
//   - 失败：用缓存（哪怕过期）或内置兜底汇率（用户定的 1 港币≈3,300 越南盾、1 人民币≈1.17 港币、1 港币≈4.07 新台币），
//     并标注「离线汇率」；失败后 10 分钟内不再重试，设备重新联网（online 事件）时立刻重试一次；
//   - 演示模式（本机 + ?demo=1）不连网，用内置的假数据（标注「演示汇率」），e2e 也不会打真实接口。
//
// 汇率的用途只是“看一眼大概多少港币”和换算参考。记账时请把当时用的汇率写进 expenses.fx_rate。
// =====================================================================

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { isDemoMode } from '../env.js';
import { now as clockNow } from '../clock.js';
import { APPROX_HKD_PER_UNIT, currencyName, normalizeCurrency } from '../money.js';
import { formatNumber } from '../number.js';
import { formatUpdatedAt } from '../datetime.js';
import { fetchJson } from './http.js';
import { getServiceCache } from './cache.js';

export const FX_URL = 'https://open.er-api.com/v6/latest/HKD';
export const FX_TTL_MS = 24 * 60 * 60 * 1000;
export const FX_RETRY_MS = 10 * 60 * 1000;
export const FX_CACHE_KEY = 'fx:HKD:v1';
/** 接口必须带的币种（缺了就当这次数据坏了） */
export const FX_REQUIRED = Object.freeze(['VND', 'TWD', 'CNY']);

/** 内置兜底汇率：1 港币 = 多少单位外币（由用户定的固定汇率换算；美元按联系汇率 7.8） */
export const FALLBACK_PER_HKD = Object.freeze({
  ...Object.fromEntries(Object.entries(APPROX_HKD_PER_UNIT).map(([c, hkd]) => [c, Number((1 / hkd).toPrecision(6))])),
  USD: Number((1 / 7.8).toPrecision(6)),
});

/** 演示模式的假数据（数量级和真实一致，便于截图） */
const DEMO_PER_HKD = Object.freeze({ HKD: 1, VND: 3294.38, TWD: 4.0698, CNY: 0.85475, USD: 0.127417, JPY: 20.166, THB: 4.2776, EUR: 0.113762 });

/**
 * 汇率快照：
 * @typedef {object} FxSnapshot
 * @property {'HKD'} base
 * @property {Record<string, number>} perHKD     1 港币 = 多少单位该币种
 * @property {number|null} fetchedAt             我们拿到数据的时刻（毫秒）
 * @property {number|null} providerUpdatedAt     接口那边汇率的更新时刻（毫秒）
 * @property {'network'|'cache'|'fallback'|'demo'} source
 * @property {boolean} offline                   这次没拿到新数据（离线汇率）
 * @property {boolean} stale                     数据超过 24 小时
 */

/** 校验并整理接口返回。数据不对抛错。 */
export function parseFxResponse(json, fetchedAt) {
  if (!json || json.result !== 'success' || String(json.base_code).toUpperCase() !== 'HKD' || typeof json.rates !== 'object' || !json.rates) {
    throw new Error('汇率接口返回的数据格式不对');
  }
  const perHKD = {};
  for (const [k, v] of Object.entries(json.rates)) {
    const n = Number(v);
    if (/^[A-Z]{3}$/.test(k) && Number.isFinite(n) && n > 0) perHKD[k] = n;
  }
  perHKD.HKD = 1;
  const missing = FX_REQUIRED.filter((c) => !perHKD[c]);
  if (missing.length) throw new Error(`汇率接口缺少币种：${missing.join('、')}`);
  const sec = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) * 1000 : null);
  return {
    base: 'HKD',
    perHKD,
    fetchedAt,
    providerUpdatedAt: sec(json.time_last_update_unix),
    providerNextUpdateAt: sec(json.time_next_update_unix),
    source: 'network',
    offline: false,
    stale: false,
  };
}

/** 内置兜底快照（离线、从没成功拿到过） */
export function fallbackSnapshot() {
  return { base: 'HKD', perHKD: { ...FALLBACK_PER_HKD }, fetchedAt: null, providerUpdatedAt: null, providerNextUpdateAt: null, source: 'fallback', offline: true, stale: true };
}

/** 演示快照：2 小时前拿到、5 小时前更新的“缓存” */
export function demoSnapshot(at = clockNow()) {
  const t = at.getTime();
  return { base: 'HKD', perHKD: { ...DEMO_PER_HKD }, fetchedAt: t - 2 * 3600_000, providerUpdatedAt: t - 5 * 3600_000, providerNextUpdateAt: t + 19 * 3600_000, source: 'demo', offline: false, stale: false };
}

function validSnapshot(s) {
  return s && typeof s === 'object' && s.perHKD && FX_REQUIRED.every((c) => Number(s.perHKD[c]) > 0);
}

/**
 * 创建一个汇率服务（全站用默认实例 fx；测试、开发页演示时自己建一个，注入假的 fetch / 缓存 / 时钟）。
 * @param {object} [o]
 * @param {typeof fetch} [o.fetch]
 * @param {{ get: Function, set: Function }} [o.cache]
 * @param {() => Date} [o.now]
 * @param {boolean} [o.demo]            演示模式：不连网
 * @param {number} [o.ttl]
 * @param {number} [o.retryAfter]
 * @param {number} [o.timeout]
 * @param {string} [o.url]
 * @param {EventTarget|null} [o.onlineTarget]  监听 'online' 事件（默认 window）
 */
export function createFxService({
  fetch: doFetch, cache, now = clockNow, demo = false, ttl = FX_TTL_MS, retryAfter = FX_RETRY_MS, timeout = 8000,
  url = FX_URL, onlineTarget = typeof window !== 'undefined' ? window : null,
} = {}) {
  const getCache = () => cache || getServiceCache();
  /** { status: 'idle'|'loading'|'ready', snapshot: FxSnapshot|null, error: { kind, message }|null } */
  const state = signal({ status: 'idle', snapshot: null, error: null });
  let inflight = null;
  let lastFailureAt = 0;
  let requests = 0;

  const t = () => now().getTime();
  const fresh = (s) => s && s.fetchedAt && !s.offline && (s.source === 'network' || s.source === 'cache' || s.source === 'demo') && t() - s.fetchedAt < ttl;

  async function readCache() {
    try {
      const rec = await getCache().get(FX_CACHE_KEY);
      return validSnapshot(rec?.data) ? rec.data : null;
    } catch {
      return null;
    }
  }

  function offlineFrom(cached) {
    if (cached) return { ...cached, source: 'cache', offline: true, stale: !cached.fetchedAt || t() - cached.fetchedAt >= ttl };
    return fallbackSnapshot();
  }

  function set(patch) {
    state.value = { ...state.value, ...patch };
  }

  async function run(force) {
    if (demo) {
      const snap = demoSnapshot(now());
      set({ status: 'ready', snapshot: snap, error: null });
      return snap;
    }
    const cached = await readCache();
    if (!force && cached && cached.fetchedAt && t() - cached.fetchedAt < ttl) {
      const snap = { ...cached, source: 'cache', offline: false, stale: false };
      set({ status: 'ready', snapshot: snap, error: null });
      return snap;
    }
    if (!force && lastFailureAt && t() - lastFailureAt < retryAfter) {
      const snap = offlineFrom(cached);
      set({ status: 'ready', snapshot: snap });
      return snap;
    }
    try {
      requests += 1;
      const json = await fetchJson(url, { fetch: doFetch, timeout });
      const snap = parseFxResponse(json, t());
      lastFailureAt = 0;
      try {
        await getCache().set(FX_CACHE_KEY, { savedAt: t(), data: snap });
      } catch {
        /* 缓存写不进去不影响这次使用 */
      }
      set({ status: 'ready', snapshot: snap, error: null });
      return snap;
    } catch (error) {
      lastFailureAt = t();
      const snap = offlineFrom(cached);
      set({ status: 'ready', snapshot: snap, error: { kind: error?.kind || 'invalid', message: String(error?.message || error) } });
      return snap;
    }
  }

  /**
   * 拿汇率：内存里有新鲜的直接返回；正在请求就等同一个；否则读缓存 / 请求。永远不抛错。
   * @param {{ force?: boolean }} [o] force：跳过缓存和退避，立刻请求（“刷新”按钮）
   * @returns {Promise<FxSnapshot>}
   */
  function load({ force = false } = {}) {
    if (!force && fresh(state.value.snapshot)) return Promise.resolve(state.value.snapshot);
    if (inflight) return inflight;
    if (state.value.status !== 'ready') set({ status: 'loading' });
    inflight = run(force).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const onOnline = () => {
    lastFailureAt = 0;
    if (state.value.snapshot?.offline) load();
  };
  onlineTarget?.addEventListener?.('online', onOnline);

  return {
    state,
    /** 确保有汇率（组件挂载时调；重复调用不会重复请求） */
    ensure: () => load(),
    /** 强制刷新（用户点“刷新”） */
    refresh: () => load({ force: true }),
    /** 当前快照（不触发请求） */
    peek: () => state.value.snapshot,
    /** 实际发出的网络请求次数（测试、开发页用） */
    get requestCount() {
      return requests;
    },
    /** 清掉内存状态和退避（不清缓存）；测试用 */
    reset() {
      lastFailureAt = 0;
      state.value = { status: 'idle', snapshot: null, error: null };
    },
    /** 不再监听 online 事件 */
    dispose() {
      onlineTarget?.removeEventListener?.('online', onOnline);
    },
  };
}

/** 全站默认的汇率服务（演示模式下不连网） */
export const fx = createFxService({ demo: isDemoMode() });

/**
 * 组件里用：返回当前状态（信号，会自动重新渲染）。
 * ensure（默认 true）：挂载时 ensure 一次。行程里的页面和弹层传 { ensure: false }——登录以后数据层（data/fx-refresh.js）
 * 已经在保持汇率新鲜；页面在“还没确定有没有登录”时就会先渲染（之后才改道登录页），那时去请求汇率接口就是没登录也连外网。
 * @param {ReturnType<typeof createFxService>} [service]
 * @param {{ ensure?: boolean }} [o]
 * @returns {{ status: string, snapshot: FxSnapshot|null, error: object|null }}
 */
export function useFx(service = fx, { ensure = true } = {}) {
  useEffect(() => {
    if (ensure) service.ensure();
  }, [service, ensure]);
  return service.state.value;
}

/**
 * 汇率状态的说明文字和语气：
 *   { text: '汇率 · 3 小时前更新', tone: 'live' }
 *   { text: '离线汇率 · 2 天前更新', tone: 'offline' }
 *   { text: '离线汇率 · 内置参考值', tone: 'offline' }
 *   { text: '演示汇率 · 5 小时前更新', tone: 'demo' }
 *   { text: '正在获取汇率…', tone: 'loading' }
 */
export function fxStatus(snapshot, { now: at = clockNow() } = {}) {
  if (!snapshot) return { text: '正在获取汇率…', tone: 'loading' };
  const when = snapshot.providerUpdatedAt || snapshot.fetchedAt;
  const updated = when ? formatUpdatedAt(when, { now: at }) : '';
  if (snapshot.source === 'demo') return { text: `演示汇率${updated ? ` · ${updated}` : ''}`, tone: 'demo' };
  if (snapshot.source === 'fallback') return { text: '离线汇率 · 内置参考值', tone: 'offline' };
  if (snapshot.offline) return { text: `离线汇率${updated ? ` · ${updated}` : ''}`, tone: 'offline' };
  return { text: `汇率${updated ? ` · ${updated}` : ''}`, tone: 'live' };
}

/**
 * 快照换成“1 单位某币种 ≈ 多少港币”的写法（data/fx.js 的 setFxRates 用的就是这种）：
 *   effect(() => { const s = fx.state.value.snapshot; if (s) setFxRates(hkdRatesOf(s), { source: s.offline ? 'approx' : 'live', at: … }); });
 * @returns {Record<string, number>}
 */
export function hkdRatesOf(snapshot) {
  const out = {};
  for (const [c, per] of Object.entries(snapshot?.perHKD || {})) {
    if (Number.isFinite(per) && per > 0) out[c] = c === 'HKD' ? 1 : Number((1 / per).toPrecision(10));
  }
  return out;
}

/**
 * 一句话汇率：比港币“小”的币种写成 1 港币 ≈ N，比港币“大”的写成 1 X ≈ N 港币（和用户定的说法一致）。
 *   formatRate(s, 'VND') → '1 港币 ≈ 3,294 越南盾'
 *   formatRate(s, 'TWD') → '1 港币 ≈ 4.07 新台币'
 *   formatRate(s, 'CNY') → '1 人民币 ≈ 1.17 港币'
 */
export function formatRate(snapshot, currency) {
  const c = normalizeCurrency(currency);
  const per = Number(snapshot?.perHKD?.[c]);
  if (c === 'HKD' || !Number.isFinite(per) || per <= 0) return '';
  if (per >= 1) return `1 港币 ≈ ${formatNumber(per, { maxDecimals: per >= 100 ? 0 : 2 })} ${currencyName(c)}`;
  return `1 ${currencyName(c)} ≈ ${formatNumber(1 / per, { maxDecimals: 2 })} 港币`;
}
