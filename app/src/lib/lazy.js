// =====================================================================
// lib/lazy.js：按需加载的页面组件（代码分包）。
//
//   export const pages = { ledger: lazyPage(() => import('./ledger/LedgerPage.jsx')) };
//
// - 路由器换页前会调用 .preload()，所以真正渲染时代码通常已经到了，不会闪白；
// - 发版后旧页面去加载已被删除的分包会 404：自动刷新一次拿新版（30 秒内不重复刷新），
//   还不行就抛给 ErrorBoundary 显示“加载失败，重试”；
// - 失败只抛一次：错误边界点「重试」后页面重新挂上，这次会重新下载（之前的失败记录已经交出去了），
//   联网后点「重试」就能打开，不用刷新整页。
// =====================================================================

import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { session } from './storage.js';

const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_COOLDOWN = 30_000;

/** 是不是“分包下载失败”（断网、发版后旧分包被删；也包括分包的按需样式表，见 lib/chunk-css.js） */
export function isChunkError(error) {
  if (error?.code === 'chunk-css') return true;
  const msg = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Load failed/i.test(msg);
}

/** 分包加载失败时，必要的话刷新页面拿新版本。返回 true 表示已经在刷新。 */
export function recoverFromChunkError(error) {
  if (!isChunkError(error) || typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const last = Number(session.get(RELOAD_KEY, '0')) || 0;
  if (Date.now() - last < RELOAD_COOLDOWN) return false;
  session.set(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/**
 * @template P
 * @param {() => Promise<{ default: import('preact').ComponentType<P> }>} loader
 * @returns {import('preact').FunctionComponent<P> & { preload: () => Promise<any> }}
 */
export function lazyPage(loader) {
  let mod = null;
  let promise = null;
  let failure = null;

  function preload() {
    if (mod) return Promise.resolve(mod);
    if (!promise) {
      promise = loader().then(
        (m) => {
          mod = m;
          failure = null;
          return m;
        },
        (error) => {
          promise = null; // 允许重试
          failure = error;
          if (recoverFromChunkError(error)) return new Promise(() => {}); // 正在刷新，别渲染错误
          throw error;
        },
      );
    }
    return promise;
  }

  function LazyPage(props) {
    const [, force] = useState(0);
    useEffect(() => {
      if (!mod) preload().then(() => force((n) => n + 1), () => force((n) => n + 1));
    }, []);
    if (failure && !mod) {
      // 交给错误边界显示“加载失败”；记录清掉，点「重试」重新挂上时会再下载一次
      const error = failure;
      failure = null;
      throw error;
    }
    if (!mod) return null;
    return h(mod.default, props);
  }
  LazyPage.preload = preload;
  return LazyPage;
}
