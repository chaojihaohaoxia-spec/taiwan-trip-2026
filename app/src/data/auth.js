// =====================================================================
// data/auth.js：登录状态和登录、注册、验证码、退出。
//
//   auth.state.value   { status: 'unknown'|'signed-in'|'signed-out', user: { id, email, displayName } | null, offline }
//                      unknown = 正在从本机恢复会话（很快，不联网也能恢复）
//   await auth.init()                              启动时调用一次
//   await auth.signInWithPassword(email, password)
//   await auth.sendEmailCode(email)  → await auth.verifyEmailCode(email, code)     邮箱验证码登录
//   await auth.signUp(email, password) → { needsVerification }  → verifyEmailCode(email, code) 完成注册
//   await auth.signOut()             → { ok: true } | { ok: false, reason: 'unsynced', pending }
//                                      还有没同步的改动时先不退出，页面问一句“放弃这些改动吗？”，
//                                      确认后 signOut({ discardUnsynced: true })
//
// 会话监听的规则（解决旧版“切回前台就被拉回首页”）：
//   supabase-js 每次页面回到前台都会再发一次 SIGNED_IN，令牌刷新发 TOKEN_REFRESHED ——
//   只要还是同一个人，就只更新用户资料，不重新加载数据、不跳页面。只有换了人或者真的登出了才处理。
//
// 恢复会话失败（init）：
//   - 后台代码分包没下载下来（第一次打开时网络抖、缓存被系统清掉、发版后旧分包被删）或网络不通：
//     本机存着会话（deps.storedUser()）就先认作“离线已登录”（offline: true）——不会被守卫赶到登录页，
//     缓存的行程照常能看、改动进写队列；本机没有会话才是“已退出”；
//   - 分包失败先走 lib/lazy.js 的 recoverFromChunkError（联网、30 秒内没刷新过时刷新一次拿新版）；
//   - 失败后 initPromise 清掉：联网、回到前台（layer.js 调 retryInit）、以及 3 / 10 / 30 / 60 秒的定时重试
//     都会重新恢复；恢复成功是同一个人 → 只把 offline 去掉，不跳页；会话其实已失效 → 已退出（守卫改道登录页）。
// =====================================================================

import { signal } from '@preact/signals';
import { recoverFromChunkError, isChunkError } from '../lib/lazy.js';
import { DataError, toAuthError } from './errors.js';
import { isEmail } from './util.js';

/** 恢复会话失败后的重试间隔（毫秒），用完了停在最后一个 */
export const INIT_RETRY_DELAYS = Object.freeze([3000, 10_000, 30_000, 60_000]);

/** 输入检查（提前给出具体的中文提示） */
export function checkEmail(email) {
  const e = String(email ?? '').trim();
  if (!e) throw new DataError('请填写邮箱', { kind: 'validation', field: 'email' });
  if (!isEmail(e)) throw new DataError('邮箱格式不对', { kind: 'validation', field: 'email' });
  return e.toLowerCase();
}

export function checkPassword(password) {
  const p = String(password ?? '');
  if (!p) throw new DataError('请填写密码', { kind: 'validation', field: 'password' });
  if (p.length < 6) throw new DataError('密码至少 6 位', { kind: 'validation', field: 'password' });
  return p;
}

export function checkCode(code) {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(c)) throw new DataError('验证码是邮件里的 6 位数字', { kind: 'validation', field: 'code' });
  return c;
}

/**
 * @param {Object} deps
 * @param {object} deps.backend
 * @param {(prevId: string|null, nextId: string|null) => Promise<void>|void} deps.onUserChange  换人了：重载写队列、清空内存数据
 * @param {object} deps.outbox
 * @param {(o: { discard: boolean }) => Promise<void>} deps.clearLocal  退出后清掉本机缓存
 * @param {() => ({ id: string, email?: string, displayName?: string } | null)} [deps.storedUser]
 *        本机保存的会话里的用户（session.js 的 readStoredUser；演示模式不传）
 * @param {{ setTimeout: Function, clearTimeout: Function }} [deps.timers]
 */
export function createAuth(deps) {
  const state = signal({ status: 'unknown', user: null, offline: false });
  /** 给登录页看的提示（例如登录链接过期） */
  const notice = signal(null);
  const timers = deps.timers || { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) };
  let currentId = null;
  let initPromise = null;
  let initialized = false;
  /** 恢复会话失败了、还没成功过：要重试 */
  let needsRetry = false;
  let retryCount = 0;
  let retryTimer = null;

  /** 我们自己改登录状态（登录、退出、恢复会话）的次数：用来识别“过时的”后台事件 */
  let explicitSeq = 0;

  async function setUser(user, { offline = false } = {}) {
    explicitSeq += 1;
    const prevId = currentId;
    currentId = user?.id ?? null;
    state.value = { status: user ? 'signed-in' : 'signed-out', user: user || null, offline };
    if (prevId !== currentId) await deps.onUserChange?.(prevId, currentId);
  }

  /** 处理后台的一条登录事件（已经推迟到 supabase 的锁外执行） */
  function processEvent(event, user) {
    if (event === 'SIGNED_OUT') {
      if (state.value.status !== 'signed-out') {
        const prevId = currentId;
        currentId = null;
        state.value = { status: 'signed-out', user: null, offline: false };
        deps.onUserChange?.(prevId, null);
      }
      return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      notice.value = '请设置一个新密码';
    }
    if (!user) return;
    if (user.id === currentId) {
      // 同一个人（切回前台、刷新令牌、改了资料）：只更新资料，不重载、不跳页
      const prev = state.value.user || {};
      const same = prev.email === user.email && prev.displayName === user.displayName;
      if (!same || state.value.offline) state.value = { ...state.value, user: { ...prev, ...user }, offline: false };
      return;
    }
    const prevId = currentId;
    currentId = user.id;
    state.value = { status: 'signed-in', user, offline: false };
    deps.onUserChange?.(prevId, user.id);
  }

  /**
   * 后台的登录事件（supabase onAuthStateChange / 演示后台）。同步收到，推迟一拍处理：
   *   - 不在 supabase 的锁里调用别的 auth 方法（会互相等死）；
   *   - 收到之后、处理之前，我们自己又登录 / 退出过（比如退出后马上换账号登录），这条事件就过时了，丢掉。
   * 初始化（init）完成前的事件也丢掉，以 init() 的结果为准。
   */
  function handleEvent(event, user) {
    if (!initialized) return;
    const seq = explicitSeq;
    setTimeout(() => {
      if (seq !== explicitSeq) return;
      processEvent(event, user);
    }, 0);
  }

  function scheduleRetry() {
    if (retryTimer) timers.clearTimeout(retryTimer);
    const delay = INIT_RETRY_DELAYS[Math.min(retryCount, INIT_RETRY_DELAYS.length - 1)];
    retryCount += 1;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      retryInit();
    }, delay);
  }

  /**
   * 启动时恢复会话（可重复调用：成功后一直返回同一个结果；失败后下一次调用会重新试）。
   * @returns {Promise<{ status, user, offline }>}
   */
  function init() {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const res = await deps.backend.auth.init(handleEvent);
          initialized = true;
          needsRetry = false;
          retryCount = 0;
          if (retryTimer) timers.clearTimeout(retryTimer);
          retryTimer = null;
          if (state.value.offline && notice.value) notice.value = null;
          await setUser(res.user || null, { offline: Boolean(res.offline) });
        } catch (e) {
          initialized = true;
          const err = toAuthError(e);
          const chunk = isChunkError(e);
          // 发版后旧分包被删：刷新一次拿新版（离线 / 30 秒内刷新过时不刷，接着往下走）
          if (chunk) recoverFromChunkError(e);
          const stored = (err.kind === 'network' || chunk) ? deps.storedUser?.() || null : null;
          if (stored) {
            // 本机有会话：先当“离线已登录”，联网后再确认
            await setUser(stored, { offline: true });
          } else {
            notice.value = err.message;
            await setUser(null);
          }
          // 允许重试：下一次 init()（页面 hooks、联网、回到前台、定时）重新恢复
          initPromise = null;
          needsRetry = true;
          scheduleRetry();
        }
        return state.value;
      })();
    }
    return initPromise;
  }

  /** 恢复会话失败过的话再试一次（联网、回到前台时 layer.js 调用；没失败过什么都不做） */
  function retryInit() {
    if (!needsRetry || initPromise) return initPromise || Promise.resolve(state.value);
    return init();
  }

  async function run(fn) {
    try {
      return await fn();
    } catch (e) {
      throw e instanceof DataError ? e : toAuthError(e);
    }
  }

  /** 邮箱 + 密码登录 */
  async function signInWithPassword(email, password) {
    const e = checkEmail(email);
    const p = checkPassword(password);
    const res = await run(() => deps.backend.auth.signInWithPassword(e, p));
    notice.value = null;
    if (res.user) await setUser(res.user);
    return res.user;
  }

  /** 发邮箱验证码（默认只给已注册的邮箱发，createUser: true 时顺便注册） */
  async function sendEmailCode(email, { createUser = false } = {}) {
    const e = checkEmail(email);
    await run(() => deps.backend.auth.sendOtp(e, { createUser }));
    return e;
  }

  /** 输入验证码完成登录（也用于注册后的邮箱验证） */
  async function verifyEmailCode(email, code) {
    const e = checkEmail(email);
    const c = checkCode(code);
    const res = await run(() => deps.backend.auth.verifyOtp(e, c, 'email'));
    notice.value = null;
    if (res.user) await setUser(res.user);
    return res.user;
  }

  /** 注册：开了邮箱验证时返回 needsVerification（之后用 verifyEmailCode 完成） */
  async function signUp(email, password) {
    const e = checkEmail(email);
    const p = checkPassword(password);
    const res = await run(() => deps.backend.auth.signUp(e, p));
    if (!res.needsVerification && res.user) await setUser(res.user);
    return { needsVerification: Boolean(res.needsVerification), email: e };
  }

  /** 再发一次注册验证邮件 */
  async function resendSignupCode(email) {
    const e = checkEmail(email);
    await run(() => deps.backend.auth.resendSignup(e));
  }

  /** 登录后设置 / 修改密码（用验证码登录的人可以顺手设一个密码） */
  async function updatePassword(password) {
    const p = checkPassword(password);
    if (!currentId) throw new DataError('请先登录', { kind: 'unauthenticated' });
    await run(() => deps.backend.auth.updatePassword(p));
  }

  /**
   * 退出登录。先把写队列发完（等待撤销期的删除立即发送）；还有发不出去的改动时不退出，
   * 返回 { ok: false, reason: 'unsynced', pending, failed }，由页面确认后再 signOut({ discardUnsynced: true })。
   */
  async function signOut({ discardUnsynced = false, timeoutMs = 6000 } = {}) {
    if (!currentId) return { ok: true };
    await deps.outbox.releaseHolds();
    const pending = await deps.outbox.drain({ timeoutMs });
    if (pending > 0 && !discardUnsynced) {
      return { ok: false, reason: 'unsynced', pending, failed: deps.outbox.state.value.failed };
    }
    if (pending > 0) await deps.outbox.clear();
    await deps.backend.auth.signOut();
    await deps.clearLocal?.({ discard: true });
    await setUser(null);
    notice.value = null;
    return { ok: true };
  }

  /** 登录回调网址里的令牌 → 会话（旧式邮件链接） */
  async function setSessionFromUrl(tokens) {
    const res = await run(() => deps.backend.auth.setSessionFromUrl(tokens));
    if (res.user) await setUser(res.user);
    return res.user;
  }

  /** 登录过期时（写队列收到 401）刷新一次令牌 */
  async function refresh() {
    try {
      await deps.backend.auth.refresh();
      return true;
    } catch {
      return false;
    }
  }

  return {
    state, notice, init, retryInit, signInWithPassword, sendEmailCode, verifyEmailCode, signUp, resendSignupCode, updatePassword, signOut, refresh, setSessionFromUrl,
    get userId() { return currentId; },
    /** 恢复会话失败过、还在等重试 */
    get needsRetry() { return needsRetry; },
    dispose() {
      if (retryTimer) timers.clearTimeout(retryTimer);
      retryTimer = null;
    },
    /** 测试用：模拟后台事件 */
    _handleEvent: handleEvent,
  };
}
