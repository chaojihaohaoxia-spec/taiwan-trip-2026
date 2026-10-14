// =====================================================================
// lib/pwa.js：注册 Service Worker、发现新版本、点一下切到新版本。
//
// 流程：
//   1. 只有构建产物（npm run build）才注册 sw.js；npm run dev 时反而注销已有的，免得缓存干扰开发。
//      网址带 ?nosw=1 也不注册（排查问题用）。
//   2. 新版 sw.js 装好、进入 waiting → updateReady 变 true → 外壳显示「有新版本，点此刷新」。
//   3. 点了 → 给 waiting 的 SW 发 SKIP_WAITING → 它接管（controllerchange）→ 页面刷新一次。
//   4. 页面由 SW 缓存优先打开（src/sw/sw.js：页面版本永远和 SW 一致、秒开），所以发现新版本全靠这里检查：
//      每次启动检查一次；回到前台时（iOS 主屏 App 很少冷启动）最多每 15 分钟一次；前台常驻时每小时一次。
//
// 旧版（缓存名 th-*）的 SW 由新 sw.js 自己处理：发现旧缓存就直接接管并刷新页面，见 src/sw/sw.js。
// =====================================================================

import { signal } from '@preact/signals';
import { IS_DEV, searchParam } from './env.js';

/** 有新版本等着切换 */
export const updateReady = signal(false);
/** 用户点了“刷新”，正在切换 */
export const updating = signal(false);
/** 当前页面是否已由 Service Worker 控制（= 离线可用） */
export const swControlled = signal(typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller));

const CHECK_INTERVAL_VISIBLE = 15 * 60 * 1000;
const CHECK_INTERVAL_FOREGROUND = 60 * 60 * 1000;

let registration = null;
let userRequestedReload = false;

function watchInstalling(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady.value = true;
  });
}

/** main.jsx 启动时调用一次 */
export async function initServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const sw = navigator.serviceWorker;

  if (IS_DEV || searchParam('nosw') === '1') {
    // 开发服务器：清掉同源下以前装过的 SW，保证看到的总是最新代码
    try {
      const regs = await sw.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      /* 忽略 */
    }
    return null;
  }

  const hadController = Boolean(sw.controller);
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    swControlled.value = Boolean(sw.controller);
    // 首次安装（之前没有 SW 控制页面）时也会触发，那时不刷新
    if (reloading || (!hadController && !userRequestedReload)) return;
    reloading = true;
    window.location.reload();
  });

  try {
    registration = await sw.register('./sw.js', { scope: './', updateViaCache: 'none' });
  } catch (error) {
    console.warn('[pwa] Service Worker 注册失败（不影响使用，只是没有离线缓存）', error);
    return null;
  }

  if (registration.waiting && sw.controller) updateReady.value = true;
  watchInstalling(registration.installing);
  registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
  // 启动时检查一次（页面是缓存优先打开的，不检查就要等下次回到前台才知道有新版本）
  if (sw.controller) registration.update().catch(() => {});

  let lastCheck = Date.now();
  const check = () => {
    if (!registration || Date.now() - lastCheck < 5_000) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_INTERVAL_VISIBLE) check();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') check();
  }, CHECK_INTERVAL_FOREGROUND);

  return registration;
}

/** 立刻检查一次更新（设置页“检查更新”按钮用） */
export async function checkForUpdate() {
  if (!registration) return false;
  try {
    await registration.update();
  } catch {
    return false;
  }
  if (registration.waiting && navigator.serviceWorker.controller) updateReady.value = true;
  return updateReady.value;
}

/** 切到新版本（用户点了“有新版本，点此刷新”） */
export function applyUpdate() {
  updating.value = true;
  userRequestedReload = true;
  const waiting = registration?.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // 保险：3 秒内没有接管就直接刷新
    window.setTimeout(() => window.location.reload(), 3000);
  } else {
    window.location.reload();
  }
}

/** 问 SW 它的版本号（开发页显示用）；没有 SW 返回 null */
export function getServiceWorkerVersion() {
  const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.version ?? null);
    };
    controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}
