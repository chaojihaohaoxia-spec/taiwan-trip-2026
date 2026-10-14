// =====================================================================
// shell/trip-state.js：外壳眼里的“当前行程”。
//
// 数据层（data/）单独成包、按需下载；外壳是首屏代码，不能直接 import 它。这里用动态 import 拿到数据层，
// 然后用信号把外壳需要的东西准备好（组件读 .value 自动订阅）：
//
//   dataApi        数据层模块（data/index.js；没下载完是 null）
//   tripStore      当前行程的 TripStore（网址里有 :tripId 时；外壳自己 retainTrip，换行程 / 离开行程时释放）
//   tripInfo       当前行程的摘要：{ id, status, ready, trip, short, rest, subtitle, dates, phase, today, accent, accent2, emoji }
//   tripsState     「全部行程」列表的状态（data.trips.state；切换面板、菜单、启动页用，ensureTripsLoaded() 触发加载）
//   lastTripId()   上次打开的行程（本机存；真实数据预览时只记在内存里，不写进浏览器）
//   lastTripTab(id) 这趟行程在「行程」tab 里上次停在哪（概览还是哪一天；底栏「行程」按钮回到那里）
//
// 另外负责整页的行程主题色：当前行程的 cover.accent / accent_2 写到 <html>（lib/theme.js 的 setTripAccent，换行程时只写一次），
// 外壳部件跟着光场同步补间（见文件后面「行程主题色」），离开行程恢复默认。页面不用自己调 setTripAccent。
// =====================================================================

import { signal, computed, effect } from '@preact/signals';
import { route } from '../router/index.js';
import { local } from '../lib/storage.js';
import { setTripAccent } from '../lib/theme.js';
import { IS_DEV, isLocalhost, searchParam } from '../lib/env.js';
import { parseCubicBezier } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { splitTripTitle, tripSubtitle } from './format.js';
import { mixHexOklch } from './view-rules.js';

/** 数据层模块（data/index.js），下载完之前是 null */
export const dataApi = signal(null);

let loading = null;
/** 下载数据层（和 main.jsx 里的是同一个分包，下载一次） */
export function loadData() {
  if (!loading) {
    loading = import('../data/index.js').then((m) => {
      dataApi.value = m;
      return m;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** 真实数据预览（npm run dev -- --real）：界面偏好也不写进浏览器（和数据层同一个口径） */
const realPreview = IS_DEV && isLocalhost() && searchParam('demo') === '1' && searchParam('real') === '1';
const memory = new Map();
/** 外壳的本机小偏好（上次的行程、最近搜索）：localStorage（键自动加 rs7885: 前缀）；真实数据预览时只在内存里 */
export const uiStore = {
  get: (k) => (realPreview ? memory.get(k) ?? null : local.get(k)),
  set: (k, v) => (realPreview ? memory.set(k, v) : local.set(k, v)),
  remove: (k) => (realPreview ? memory.delete(k) : local.remove(k)),
};
const store = uiStore;

export const LAST_TRIP_KEY = 'last-trip';
/** 上次打开的行程 id（启动页用） */
export function lastTripId() {
  return store.get(LAST_TRIP_KEY);
}

/** 网址里的行程 id（不在行程里是 null） */
export const currentTripId = computed(() => route.value?.params?.tripId || null);

/** 当前行程的 TripStore */
export const tripStore = signal(null);

effect(() => {
  const api = dataApi.value;
  const id = currentTripId.value;
  // 确定登录了才打开（没登录的人打开深层链接会被守卫带去登录页，不要先去拉行程、不发任何请求）
  const uid = api?.data.userId.value;
  if (!api || !id || !uid) {
    tripStore.value = null;
    return undefined;
  }
  const s = api.data.getStore(id);
  const release = api.data.retainTrip(id);
  tripStore.value = s;
  return release;
});

/** 当前行程的摘要（见文件头） */
export const tripInfo = computed(() => {
  const s = tripStore.value;
  if (!s) return null;
  const status = s.status.value;
  const trip = s.trip.value;
  if (!trip) return { id: s.tripId, status, ready: false, trip: null };
  const phase = s.view.phase.value;
  const thisYear = phase?.today ? Number(String(phase.today).slice(0, 4)) : new Date().getFullYear();
  const { short, rest } = splitTripTitle(trip.title);
  return {
    id: s.tripId,
    status,
    ready: true,
    trip,
    short: short || trip.title,
    rest,
    subtitle: tripSubtitle(trip, { thisYear }),
    dates: s.view.dates.value,
    phase,
    today: phase?.today || null,
    accent: trip.cover?.accent || null,
    accent2: trip.cover?.accent_2 || null,
    emoji: trip.cover?.emoji || null,
  };
});

/** 「全部行程」列表状态（数据层没下载完是 null） */
export const tripsState = computed(() => dataApi.value?.data.trips.state.value || null);

/** 需要行程列表的地方（切换面板、菜单、启动页）调用：数据层下载好后加载一次（先缓存后网络） */
export function ensureTripsLoaded() {
  return loadData().then(async (m) => {
    // 等恢复登录状态（演示模式是自带的演示账号）再拉；没登录就不拉（守卫会带去登录页）
    await m.initData();
    if (m.data.userId.peek()) m.data.trips.load();
    return m;
  });
}

// ---------------------------------------------------------------------
// 记住：上次打开的行程、「行程」tab 上次停在哪
// ---------------------------------------------------------------------

const tabMemory = new Map();
/** 这趟行程在「行程」tab 里上次停的页面（概览 / 某一天），没有就是概览 */
export function lastTripTab(tripId) {
  return tabMemory.get(tripId) || { name: 'trip', params: { tripId } };
}

effect(() => {
  const r = route.value;
  const id = r?.params?.tripId;
  if (!id) return;
  if (r.name === 'trip' || r.name === 'day') tabMemory.set(id, { name: r.name, params: { ...r.params } });
});

effect(() => {
  const info = tripInfo.value;
  if (info?.ready && info.id && store.get(LAST_TRIP_KEY) !== info.id) store.set(LAST_TRIP_KEY, info.id);
});

// ---------------------------------------------------------------------
// 行程主题色：<html> 上的 --trip-accent / --trip-accent-2
// ---------------------------------------------------------------------
//
// 换行程时 <html> 上的主题色**只写一次**（终值）：逐帧改 <html> 上的变量会让整页每一帧都重算样式（4 倍降速时
// 换行程掉到 30fps——外壳评审）。看得见的“过渡”分两块：
//   - 光场（Field.jsx）：新的一层在上面淡入（--dur-field、--ease-field）；
//   - 一直在屏幕上的外壳部件（底栏的 ＋ 和选中的 tab、顶栏、同步条、正在收回的切换面板……，带 data-accent-follow）：
//     各自加 accent-scope、在自己身上写补间中的主题色（只重算这几小块），和光场同样长、同一条曲线，
//     颜色在 OKLCH 里按短的色相路径走（中途不发灰），播完撤掉，回到跟随 <html>。
//   换页的新内容本来就在淡入（新的颜色），旧内容的幽灵（transitions.js）冻结在旧颜色上淡出。
// 补间的时钟是一个空关键帧的 Web Animation（和光场的 CSS 过渡同时开始）：开发者工具、e2e 的“拨到同一时刻”对它同样有效。

const HEX = /^#[0-9A-Fa-f]{6}$/;
/** 此刻 <html> 上的主题色 */
let shown = { a: null, b: null };
/** 外壳部件上正在播的补间：{ els, clock, raf, from, to, current } */
let follow = null;
/** 跟着主题色补间的外壳部件 */
export const ACCENT_FOLLOW = '[data-accent-follow]';

function readMs(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return /ms$/.test(v) ? n : n * 1000;
}

/** 撤掉外壳部件上的补间（回到跟随 <html>） */
function releaseFollowers() {
  if (!follow) return;
  cancelAnimationFrame(follow.raf);
  follow.clock?.cancel();
  for (const el of follow.els) {
    el.style.removeProperty('--trip-accent');
    el.style.removeProperty('--trip-accent-2');
    el.classList.remove('accent-scope');
  }
  follow = null;
}

/**
 * 外壳部件的主题色从 from 补间到 to（OKLCH 短色相路径，--dur-field、--ease-field）。
 * 半路再换（连着切两趟）：从此刻显示的颜色接着走。
 */
function tweenFollowers(from, to) {
  const start = follow?.current || from;
  releaseFollowers();
  const els = [...document.querySelectorAll(ACCENT_FOLLOW)];
  if (!els.length) return;
  const duration = readMs('--dur-field', 1100);
  const ease = parseCubicBezier(getComputedStyle(document.documentElement).getPropertyValue('--ease-field'));
  const job = { els, clock: null, raf: 0, current: start };
  const paint = (t) => {
    const k = ease(Math.min(1, Math.max(0, t)));
    const a = mixHexOklch(start.a, to.a, k);
    const b = HEX.test(start.b || '') && HEX.test(to.b || '') ? mixHexOklch(start.b, to.b, k) : (k < 0.5 ? start.b : to.b);
    job.current = { a, b };
    for (const el of els) {
      if (HEX.test(a || '')) el.style.setProperty('--trip-accent', a);
      if (HEX.test(b || '')) el.style.setProperty('--trip-accent-2', b);
    }
  };
  for (const el of els) el.classList.add('accent-scope');
  paint(0);
  // 时钟：空关键帧的 Web Animation（挂在 <html> 上），读它的 currentTime
  job.clock = document.documentElement.animate([], { duration, id: 'shell-trip-accent' });
  const tick = () => {
    if (follow !== job) return;
    const t = (job.clock.currentTime ?? duration) / duration;
    paint(t);
    if (t < 1 && job.clock.playState !== 'finished') job.raf = requestAnimationFrame(tick);
    else releaseFollowers();
  };
  job.clock.onfinish = () => {
    if (follow === job) releaseFollowers();
  };
  follow = job;
  job.raf = requestAnimationFrame(tick);
}

/** 目标主题色：在行程里用行程的；行程还没加载完保持当前的（不先闪回默认）；不在行程里恢复默认 */
const accentTarget = computed(() => {
  const id = currentTripId.value;
  const info = tripInfo.value;
  if (!id) return { a: null, b: null };
  if (!info?.ready) return null;
  return { a: info.accent, b: info.accent2 };
});

effect(() => {
  const target = accentTarget.value;
  if (!target || typeof document === 'undefined') return;
  const from = { ...shown };
  if (from.a === target.a && from.b === target.b) return;
  // <html> 上一次写好终值
  shown = { a: target.a, b: target.b };
  setTripAccent(target.a, target.b);
  const canBlend = HEX.test(from.a || '') && HEX.test(target.a || '') && !prefersReducedMotion.peek();
  if (canBlend) tweenFollowers(from, target);
  else releaseFollowers();
});
