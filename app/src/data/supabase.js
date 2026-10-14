// =====================================================================
// data/supabase.js：Supabase 客户端（懒加载、单例）。
//
//   const supabase = await getSupabase();
//
// - supabase-js 单独打成一个分包，第一次调用时才下载（首屏不等它）；
// - 演示模式（本机 ?demo=1）直接报错：演示模式绝不连真实后台，数据走 backend-demo.js；
// - 会话持久保存在 localStorage 的 'rs7885:auth'（见 config.js 为什么换了新键），自动刷新令牌；
// - flowType 'pkce'：注册确认邮件的回调参数在 ?code= 里，不和 hash 路由抢 #；
// - 所有请求加超时（普通 20 秒、上传 90 秒）：网络半通不通时请求不会一直挂着，交给写队列重试。
//
// 页面和组件不要直接用它，一律通过 data/index.js。
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_STORAGE_KEY, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './config.js';
import { isDemoMode } from '../lib/env.js';

let clientPromise = null;

/**
 * 给 fetch 加超时（调用方自己传了 signal 就合并：任一个触发都中止）。
 * @param {typeof fetch} baseFetch
 */
export function fetchWithTimeout(baseFetch = (...a) => fetch(...a)) {
  return (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const ms = /\/storage\/v1\/object\//.test(url) && /^(POST|PUT)$/i.test(init.method || 'GET') ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('请求超时', 'TimeoutError')), ms);
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort(outer.reason);
      else outer.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
    }
    return baseFetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };
}

/** @returns {Promise<import('@supabase/supabase-js').SupabaseClient>} */
export function getSupabase() {
  if (isDemoMode()) {
    return Promise.reject(new Error('演示模式不连接后台：数据走 data/backend-demo.js'));
  }
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      global: { fetch: fetchWithTimeout() },
      realtime: { params: { eventsPerSecond: 10 } },
    })).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
