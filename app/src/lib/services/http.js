// =====================================================================
// lib/services/http.js：请求外部接口（天气、汇率）的统一入口。
//
//   const json = await fetchJson(url, { timeout: 8000 });
//   失败时抛 FetchError，error.kind 是下面之一，调用方据此决定显示什么：
//     'offline'  设备离线（根本没发请求）
//     'timeout'  超时
//     'aborted'  调用方取消（换页了）
//     'network'  网络错误、跨域被拦（CSP / CORS）
//     'http'     服务器返回非 2xx（error.status、error.body 有详情）
//     'parse'    返回的不是 JSON
//
// 约定：只请求公开、无需登录的接口；不带 cookie（credentials: 'omit'）、不带来源页（no-referrer）。
// 新接的域名要加进 scripts/lib/csp.mjs 的 CSP_SOURCES.connect，否则浏览器会拦。
// =====================================================================

export class FetchError extends Error {
  /**
   * @param {'offline'|'timeout'|'aborted'|'network'|'http'|'parse'} kind
   * @param {string} message
   * @param {{ status?: number, body?: any, cause?: any }} [extra]
   */
  constructor(kind, message, { status, body, cause } = {}) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (body !== undefined) this.body = body;
    if (cause !== undefined) this.cause = cause;
  }
}

/** 设备是否离线（navigator.onLine === false 才算；拿不到就当在线） */
export function isOffline(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  return nav?.onLine === false;
}

/**
 * GET 一个 JSON 接口。
 * @param {string} url
 * @param {object} [o]
 * @param {typeof fetch} [o.fetch]      注入（测试用）；默认全局 fetch
 * @param {number} [o.timeout=8000]     毫秒
 * @param {AbortSignal} [o.signal]      外部取消
 * @param {object} [o.navigator]        注入（测试用）：判断离线
 */
export async function fetchJson(url, { fetch: doFetch = globalThis.fetch, timeout = 8000, signal, navigator: nav } = {}) {
  if (isOffline(nav ?? (typeof navigator !== 'undefined' ? navigator : undefined))) {
    throw new FetchError('offline', '设备离线');
  }
  if (typeof doFetch !== 'function') throw new FetchError('network', '当前环境不能发请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, timeout);
  const onAbort = () => controller?.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });

  let res;
  try {
    res = await doFetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
    if (timedOut) throw new FetchError('timeout', `请求超时（${Math.round(timeout / 1000)} 秒）`, { cause: error });
    if (signal?.aborted) throw new FetchError('aborted', '请求已取消', { cause: error });
    throw new FetchError('network', '网络错误', { cause: error });
  }

  let text;
  try {
    text = await res.text();
  } catch (error) {
    throw new FetchError(timedOut ? 'timeout' : 'network', '读取响应失败', { cause: error, status: res.status });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }

  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    if (!res.ok) throw new FetchError('http', `服务器返回 ${res.status}`, { status: res.status, body: text });
    throw new FetchError('parse', '返回的数据不是 JSON', { cause: error, status: res.status });
  }
  if (!res.ok) {
    const reason = body && typeof body === 'object' ? body.reason || body.message || body['error-type'] : null;
    throw new FetchError('http', reason ? String(reason) : `服务器返回 ${res.status}`, { status: res.status, body });
  }
  return body;
}
