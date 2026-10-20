// =====================================================================
// data/backend-lazy.js：按需加载的后台（数据层一创建就能用，真正的后台代码第一次用到时才下载）。
//
// 真实后台要下载 supabase-js（一个单独的分包），演示后台要下载演示数据；
// 首屏不等它们。所有方法都是 async 的，自然地等后台加载好再执行；
// subscribeTrip 同步返回退订函数（后台加载好之后才真正订阅；加载前就退订则不会订阅）。
// =====================================================================

const METHODS = ['fetchTripBundle', 'fetchMyTrips', 'fetchInvites', 'fetchRow', 'insert', 'update', 'remove', 'rpc', 'upload', 'signedUrls', 'removeFiles'];
const AUTH_METHODS = ['init', 'signInWithPassword', 'signUp', 'sendOtp', 'verifyOtp', 'resendSignup', 'updatePassword', 'signOut', 'refresh', 'setSessionFromUrl', 'accessToken'];

/**
 * @param {() => Promise<object>} load  返回真正的后台
 * @param {string} kind  'supabase' | 'demo'
 */
export function createLazyBackend(load, kind) {
  let promise = null;
  let resolved = null;
  const get = () => {
    if (!promise) {
      promise = load().then((b) => {
        resolved = b;
        return b;
      }, (error) => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };

  const out = {
    kind,
    /** 后台加载好（演示模式下拿 demo 控制台用） */
    ready: get,
    get loaded() { return resolved; },
    get demo() { return resolved?.demo ?? null; },
    auth: {},
    subscribeTrip(tripId, handlers) {
      let off = null;
      let closed = false;
      get().then((b) => {
        if (!closed) off = b.subscribeTrip(tripId, handlers);
      }, () => {
        if (!closed) handlers.onStatus?.('error');
      });
      return () => {
        closed = true;
        off?.();
      };
    },
  };
  for (const m of METHODS) out[m] = async (...args) => (await get())[m](...args);
  for (const m of AUTH_METHODS) out.auth[m] = async (...args) => (await get()).auth[m](...args);
  return out;
}
