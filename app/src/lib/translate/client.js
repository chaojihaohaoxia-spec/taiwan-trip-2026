// =====================================================================
// lib/translate/client.js：调翻译接口（云开发 HTTP 访问服务上的 translate-web，和小程序同一份提示词、同一个 hy3）。
//
//   const c = createTranslateClient({ url, fetch, getToken, online, now, setTimeout, clearTimeout })
//   c.translate(text, { trip, auto, signal, lang }) → Promise<结果 { dir, input, vi, en, zh, back, demo }>（lang 只是通路，见 translate()）
//       失败 reject 一个 Error：message 是给人看的中文（一句话），code 见 MSG；限频时 e.wait = 还要等几毫秒
//   c.warm({ trip })      预热（拉起实例、认人，不调模型、不算次数）：打开翻译、回到前台、点输入框时调；4 分钟内只发一次
//   c.runner()            边打边翻用的「以最后一次为准」：新的一发出去，旧的作废（AbortController），旧的 reject code 'stale'
//   c.ready               有没有接口地址（没有 = 翻译还没接上：页面照样能看收藏和最近翻过）
//
// 请求（接口说明见仓库外 scratchpad/web-v2/translate-web-api.md）：
//   POST url，Content-Type: text/plain;charset=UTF-8（「简单请求」，浏览器不发 CORS 预检，省一个来回），
//   body = JSON { text, token, trip, lang? } / { warm: true, token, trip }。token 是 Supabase 的 access token（getToken() 给）。
//   返回 200 { ok: true, src, vi, en, back, zh } / { ok: false, code, error }；401 no_token / bad_token；403 not_member；429 rate；503 auth_down。
// 规则：
//   - 客户端超时 10 秒（长句多给一点）；网络断了一下（fetch 抛错、不是我们自己停的）再试一次；
//   - 401 bad_token：getToken({ refresh: true }) 换新 token 再悄悄试一次，还不行才说「登录过期了」；
//   - 手机上也限频（和小程序一样：10 秒 8 次、一分钟 30 次；边打边翻自动发的只能用 6 / 24 次，剩下的留给手动的）；
//   - 没网（online() = false）不发；地址没配 / 404 = 还没接上（not_ready）；连不上（CORS、DNS、服务挂了）= unreachable。
// 不碰 DOM，Node 里能测（fetch、时钟、定时器都能注入）。
// =====================================================================

import { MAX_CHARS, len, text, shape } from './text.js';

export const MSG = Object.freeze({
  empty: '先写一句',
  too_long: '太长了，分两句翻',
  offline: '没连上网。翻过的句子在上面，没网也能看',
  timeout: '网有点慢，再点一次',
  not_ready: '翻译还没接上，收藏和翻过的句子照样能看',
  unreachable: '翻译暂时连不上，晚点再试',
  no_token: '先登录再翻译',
  bad_token: '登录过期了，重新登录一下',
  not_member: '只有行程里的人能用翻译',
  rate: '刚才翻得有点多，过几秒再点',
  quota: '翻译暂时用不了，晚点再试',
  busy: '翻译暂时用不了，晚点再试',
  auth_down: '网有点慢，再点一次',
  bad_output: '没翻好，再点一次',
  bad_request: '没翻成，再点一次',
  origin: '这个网址用不了翻译',
  error: '没翻成，再点一次',
  stale: '',
});

export const LIMITS = Object.freeze({ s10: 8, min: 30, autoKeep: { s10: 2, min: 6 } });
export const CLIENT_TIMEOUT = 10_000;
export const WARM_GAP = 4 * 60 * 1000;
const RETRY_GAP = 300;
/** 服务端说限频（429）了：先停 3 秒再补发 */
const RATE_WAIT = 3000;

export function fail(code, extra) {
  const known = Object.prototype.hasOwnProperty.call(MSG, code);
  const e = new Error(known ? MSG[code] : MSG.error);
  e.code = known ? code : 'error';
  if (extra) Object.assign(e, extra);
  return e;
}

/** 一次最多等多久：10 秒，长句多给一点（模型写三份要 2–3 秒，冷启动再加 2 秒） */
export function waitFor(input) {
  return CLIENT_TIMEOUT + Math.min(4000, Math.max(0, len(input) - 40) * 25);
}

/** 手机上的限频（纯逻辑，测试直接用） */
export function createLimiter(now = () => Date.now()) {
  const recent = [];
  const caps = (kind) => (kind === 'auto'
    ? { s10: LIMITS.s10 - LIMITS.autoKeep.s10, min: LIMITS.min - LIMITS.autoKeep.min }
    : { s10: LIMITS.s10, min: LIMITS.min });
  /** 还要等多久（毫秒）；0 = 现在就能发 */
  function waitMs(kind, at = now()) {
    while (recent.length && at - recent[0] >= 60_000) recent.shift();
    const c = caps(kind);
    const burst = recent.filter((x) => at - x < 10_000);
    let w = 0;
    if (burst.length >= c.s10) w = Math.max(w, burst[burst.length - c.s10] + 10_000 - at);
    if (recent.length >= c.min) w = Math.max(w, recent[recent.length - c.min] + 60_000 - at);
    return w > 0 ? w + 30 : 0;
  }
  function take(kind, at = now()) {
    if (waitMs(kind, at) !== 0) return false;
    recent.push(at);
    return true;
  }
  return { waitMs, take, reset: () => { recent.length = 0; } };
}

/** HTTP 状态 + 返回体 → 我们的 code（ok 的返回 null） */
export function codeOfResponse(status, body) {
  if (status === 200 && body && body.ok) return null;
  const c = body && typeof body.code === 'string' ? body.code : '';
  if (c && Object.prototype.hasOwnProperty.call(MSG, c)) return c;
  if (status === 401) return 'bad_token';
  if (status === 403) return 'not_member';
  if (status === 404) return 'not_ready';
  if (status === 429) return 'rate';
  if (status === 503) return 'auth_down';
  if (status >= 500) return 'busy';
  return 'error';
}

/**
 * @param {{
 *   url?: string|null,
 *   fetch?: (url: string, init: object) => Promise<{ status: number, json: () => Promise<any> }>,
 *   getToken?: (o?: { refresh?: boolean }) => Promise<string|null>,
 *   online?: () => boolean,
 *   now?: () => number,
 *   setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout,
 * }} deps
 */
export function createTranslateClient(deps = {}) {
  const url = deps.url || null;
  const doFetch = deps.fetch || ((u, init) => globalThis.fetch(u, init));
  const getToken = deps.getToken || (async () => null);
  const online = deps.online || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const now = deps.now || (() => Date.now());
  const st = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const ct = deps.clearTimeout || ((t) => clearTimeout(t));
  const limiter = createLimiter(now);
  let warmAt = -Infinity;

  /** 发一次：返回 { status, body }；网络错误 / 超时 / 作废 reject（code offline / timeout / stale / unreachable） */
  async function post(payload, { signal, timeout }) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = st(() => { timedOut = true; ctl?.abort(); }, timeout);
    const onAbort = () => ctl?.abort();
    if (signal) {
      if (signal.aborted) { ct(timer); throw fail('stale'); }
      signal.addEventListener?.('abort', onAbort, { once: true });
    }
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
        signal: ctl?.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch (e) {
      if (signal?.aborted) throw fail('stale');
      if (timedOut) throw fail('timeout');
      throw fail(online() ? 'unreachable' : 'offline', { net: true });
    } finally {
      ct(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  /** 发一次，带上 token；bad_token 换新 token 再试一次；网络断了一下再试一次 */
  async function call(payload, { signal, timeout }) {
    let token = await getToken({ refresh: false }).catch(() => null);
    if (!token) throw fail('no_token');
    let refreshed = false;
    let retried = false;
    for (;;) {
      if (signal?.aborted) throw fail('stale');
      let r;
      try {
        // eslint-disable-next-line no-await-in-loop
        r = await post({ ...payload, token }, { signal, timeout });
      } catch (e) {
        if (e.net && !retried && online()) {
          retried = true;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => st(res, RETRY_GAP));
          continue;
        }
        throw e;
      }
      const code = codeOfResponse(r.status, r.body);
      if (!code) return r.body;
      if (code === 'bad_token' && !refreshed) {
        refreshed = true;
        // eslint-disable-next-line no-await-in-loop
        const next = await getToken({ refresh: true }).catch(() => null);
        if (next) { token = next; continue; }
      }
      if (code === 'auth_down' && !retried) {
        retried = true;
        continue;
      }
      throw fail(code, code === 'rate' ? { wait: RATE_WAIT } : undefined);
    }
  }

  /** 翻一句。opts.auto：边打边翻自动发的（限频少用几个名额）；opts.trip：行程 id（只认这趟行程的成员） */
  async function translate(raw, opts = {}) {
    const input = text(raw);
    if (!input) throw fail('empty');
    if (len(input) > MAX_CHARS) throw fail('too_long');
    if (opts.signal?.aborted) throw fail('stale');
    if (!url) throw fail('not_ready');
    const kind = opts.auto ? 'auto' : 'manual';
    if (!limiter.take(kind)) throw fail('rate', { wait: limiter.waitMs(kind) });
    if (!online()) throw fail('offline');
    // opts.lang：要翻成哪种当地语言（目的地档案的 tr，现在只有 vi）。多语言只留通路：云函数现在不认这个字段、照旧按越南语翻
    const body = await call({ text: input, ...(opts.trip ? { trip: opts.trip } : {}), ...(opts.lang ? { lang: String(opts.lang) } : {}) }, { signal: opts.signal, timeout: waitFor(input) });
    warmAt = now();
    return shape(body, input);
  }

  /** 预热：不等结果、失败不管；4 分钟内发过（或刚翻成过）就不发 */
  function warm(opts = {}) {
    if (!url || now() - warmAt < WARM_GAP || !online()) return false;
    warmAt = now();
    call({ warm: true, ...(opts.trip ? { trip: opts.trip } : {}) }, { timeout: CLIENT_TIMEOUT }).catch(() => {
      // 没认成（没登录、不在行程里……）：下次打开再试
      warmAt = -Infinity;
    });
    return true;
  }

  /** 以最后一次为准：每次 run 都让之前那次作废 */
  function runner() {
    let ctl = null;
    let seq = 0;
    return {
      run(input, opts = {}) {
        const my = ++seq;
        ctl?.abort();
        const c = typeof AbortController === 'function' ? new AbortController() : null;
        ctl = c;
        return translate(input, { ...opts, signal: c?.signal }).then((r) => {
          if (my !== seq) throw fail('stale');
          return r;
        }, (e) => {
          throw my !== seq ? fail('stale') : e;
        });
      },
      cancel() {
        seq += 1;
        ctl?.abort();
        ctl = null;
      },
    };
  }

  return {
    ready: Boolean(url),
    translate,
    warm,
    runner,
    /** 测试用 */
    _limiter: limiter,
    _resetWarm() { warmAt = -Infinity; },
  };
}
