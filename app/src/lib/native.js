// =====================================================================
// lib/native.js：网页和“外壳”之间的桥——打开外部链接、触感反馈、系统分享。
//
//   import { openExternal, haptic, share, isNativeShell } from '../lib/native.js';
//
//   openExternal(googleMapsNavigateUrl(place));          // 同一个窗口跳转（iOS 才能唤起 Google 地图 / Grab App）
//   openExternal('https://example.com/manage', { newTab: true });   // 新标签页（只对 http(s) 生效）
//   haptic('success');                                   // 'light' | 'medium' | 'success' | 'warning' | 'selection'
//   await share({ title, text, url });                   // 系统分享；不支持就复制链接 + 提示
//   isNativeShell();                                     // 是不是在 iOS App 外壳（WKWebView）里
//
// 页面和组件**不要**直接写 window.open / location.href = 外链 / navigator.vibrate / navigator.share，
// 一律走这里：以后 iOS 测试版 App 用 WKWebView 包住网页，这几件事交给原生做（外链用系统打开、
// 触感用 UIFeedbackGenerator、分享用 UIActivityViewController），页面代码一行都不用改。
//
// ── 和 iOS 外壳的约定（桥）──────────────────────────────────────────────
// 外壳注册一个脚本消息处理器，名字 rs7885：
//   window.webkit.messageHandlers.rs7885.postMessage(message)
// 检测到它（isNativeShell() 为 true）就把事情交给外壳，网页自己不再做。消息都是纯 JSON 对象，带版本号 v：
//   { v: 1, type: 'open',   url: 'https://…' | 'tel:…' | 'grab://…', newTab: false }
//   { v: 1, type: 'haptic', kind: 'light' | 'medium' | 'success' | 'warning' | 'selection' }
//   { v: 1, type: 'share',  title?: string, text?: string, url?: string }
// 外壳收到 open：http(s) 用 SFSafariViewController 或系统浏览器，其余协议交给 UIApplication.open；
// 收到 haptic：light / medium → UIImpactFeedbackGenerator，success / warning → UINotificationFeedbackGenerator，
// selection → UISelectionFeedbackGenerator；收到 share：弹系统分享面板。网页不等外壳回复（单向消息）。
// 网址在网页这边已经过白名单检查（见 ALLOWED_PROTOCOLS），外壳最好再查一遍。
// =====================================================================

import { copyText, joinLines } from './clipboard.js';
import { notify } from './notify.js';

/** 外壳的消息处理器名字（window.webkit.messageHandlers.<名字>） */
export const NATIVE_HANDLER = 'rs7885';
/** 桥的消息版本号 */
export const NATIVE_BRIDGE_VERSION = 1;

/**
 * 外链放行的协议。javascript:、data:、file:、blob: 这类一律拒绝。
 * 要加新的 App 协议（比如别的打车软件）就加在这里，并在 lib/README.md 记一笔。
 */
export const ALLOWED_PROTOCOLS = Object.freeze([
  'http:', 'https:',
  'tel:', 'mailto:', 'sms:',
  // App 深链接：Grab、Google 地图 App、WhatsApp（网页版链接 https://wa.me/… 也行）
  'grab:', 'comgooglemaps:', 'whatsapp:',
]);

/** 触感种类 → 网页 navigator.vibrate 的震动模式（毫秒）。iOS Safari 没有 vibrate，什么都不做 */
export const HAPTIC_PATTERNS = Object.freeze({
  selection: 6,
  light: 10,
  medium: 18,
  success: [12, 60, 12],
  warning: [24, 70, 24],
});
export const HAPTIC_KINDS = Object.freeze(Object.keys(HAPTIC_PATTERNS));

function defaultEnv() {
  return {
    window: typeof window !== 'undefined' ? window : undefined,
    navigator: typeof navigator !== 'undefined' ? navigator : undefined,
    document: typeof document !== 'undefined' ? document : undefined,
  };
}

/** 外壳的消息处理器（没有就 null） */
function nativeHandler(env) {
  const h = env.window?.webkit?.messageHandlers?.[NATIVE_HANDLER];
  return h && typeof h.postMessage === 'function' ? h : null;
}

function post(env, message) {
  const h = nativeHandler(env);
  if (!h) return false;
  try {
    h.postMessage({ v: NATIVE_BRIDGE_VERSION, ...message });
    return true;
  } catch {
    return false;
  }
}

/** 是不是在 iOS App 外壳里（外壳注册了 rs7885 消息处理器） */
export function isNativeShell({ env = defaultEnv() } = {}) {
  return nativeHandler(env) !== null;
}

/**
 * 检查外链：协议在白名单里、没有控制字符，返回规范后的网址；不合格返回 null。
 * 不接受相对网址（站内跳转用路由，不走这里）。
 * @param {string|URL} url
 * @returns {string|null}
 */
export function safeExternalUrl(url) {
  const raw = String(url ?? '').trim();
  // 控制字符（含换行、制表）可以用来绕过协议检查，一律拒绝
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!ALLOWED_PROTOCOLS.includes(protocol)) return null;
  if ((protocol === 'http:' || protocol === 'https:') && !parsed.hostname) return null;
  // http(s) 用规范化后的写法；tel: / grab: 等保持原样（URL 会把 grab://open?a=b 的大小写、编码改掉）
  return protocol === 'http:' || protocol === 'https:' ? parsed.href : raw;
}

/**
 * 打开外部链接。
 *   - 在 App 外壳里：交给外壳（{ type: 'open', url, newTab }）；
 *   - 网页：默认 location.href（同一个窗口——iOS 上只有这样 Google 地图 / Grab 的通用链接才会唤起 App，
 *     新标签页会先开一个空白页）；newTab: true 且是 http(s) 时用 window.open 新标签页（打开后切断 opener），
 *     被浏览器拦了就退回同窗口；tel: / mailto: / grab: 这类永远同窗口（新标签页只会留下一个空白页）。
 * @param {string} url
 * @param {{ newTab?: boolean, env?: object }} [o]
 * @returns {boolean} 有没有打开（网址不合格返回 false，并在控制台警告）
 */
export function openExternal(url, { newTab = false, env = defaultEnv() } = {}) {
  const safe = safeExternalUrl(url);
  if (!safe) {
    console.warn('[native] 拒绝打开不安全或无效的链接', String(url ?? '').slice(0, 80));
    return false;
  }
  if (post(env, { type: 'open', url: safe, newTab: Boolean(newTab) })) return true;
  const win = env.window;
  if (!win) return false;
  const web = /^https?:/i.test(safe);
  if (newTab && web && typeof win.open === 'function') {
    let opened = null;
    try {
      opened = win.open(safe, '_blank');
    } catch {
      opened = null;
    }
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        /* 跨域窗口可能不让改，没关系 */
      }
      return true;
    }
  }
  win.location.href = safe;
  return true;
}

/**
 * 触感反馈。在 App 外壳里交给外壳；网页用 navigator.vibrate（Android Chrome 有，iOS Safari 没有 → 什么都不做）。
 * 用户还没点过页面时浏览器会拦 vibrate 并在控制台报警，所以那种情况直接跳过。
 * @param {'light'|'medium'|'success'|'warning'|'selection'} [kind='light']  不认识的按 'light'
 * @returns {boolean} 有没有真的发出去
 */
export function haptic(kind = 'light', { env = defaultEnv() } = {}) {
  const k = HAPTIC_KINDS.includes(kind) ? kind : 'light';
  if (post(env, { type: 'haptic', kind: k })) return true;
  const nav = env.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return false;
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return false;
  try {
    return Boolean(nav.vibrate(HAPTIC_PATTERNS[k]));
  } catch {
    return false;
  }
}

/**
 * 系统分享。
 *   - App 外壳：交给外壳 → { ok: true, method: 'native' }；
 *   - 浏览器支持 navigator.share：弹系统分享 → { ok: true, method: 'share' }；用户取消 → { ok: false, cancelled: true }；
 *   - 不支持（桌面浏览器、旧系统）或分享出错：复制链接（没有链接就复制标题 + 文字），并用 notify 提示
 *     「链接已复制，可以粘贴给对方」→ { ok, method: 'copy' }；复制也失败时提示手动复制。
 * 分享文件（files：照片本身）：只走 navigator.share（能分享文件才分享）；不能分享 / 出错 → { ok: false, method: null, unsupported: true }，
 *   不退回复制链接（照片的签名链接谁拿到都能看、刚拍的 blob: 链接对方打不开），由调用方提示「长按图片存到相册」。
 *   App 外壳里暂时也这样（文件传不过消息通道），外壳接管分享文件以后再在这里接上。
 * 要在点击回调里同步调用（Safari 只认用户手势）。
 * @param {{ title?: string, text?: string, url?: string, files?: File[] }} data
 * @returns {Promise<{ ok: boolean, method: 'native'|'share'|'copy'|null, cancelled?: boolean, unsupported?: boolean }>}
 */
export async function share({ title, text, url, files } = {}, { env = defaultEnv() } = {}) {
  if (Array.isArray(files) && files.length) {
    const nav = env.navigator;
    const payload = { files, ...(title ? { title: String(title) } : {}) };
    let can = false;
    try {
      can = Boolean(nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare(payload));
    } catch {
      can = false;
    }
    if (!can || isNativeShell({ env })) return { ok: false, method: null, unsupported: true };
    try {
      await nav.share(payload);
      return { ok: true, method: 'share' };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok: false, method: 'share', cancelled: true };
      return { ok: false, method: null, unsupported: true };
    }
  }
  const data = {};
  if (title) data.title = String(title);
  if (text) data.text = String(text);
  if (url) data.url = String(url);
  if (!data.title && !data.text && !data.url) return { ok: false, method: null };
  if (post(env, { type: 'share', ...data })) return { ok: true, method: 'native' };
  const nav = env.navigator;
  if (nav && typeof nav.share === 'function') {
    let can = true;
    try {
      if (typeof nav.canShare === 'function') can = nav.canShare(data);
    } catch {
      can = false;
    }
    if (can) {
      try {
        await nav.share(data);
        return { ok: true, method: 'share' };
      } catch (error) {
        if (error?.name === 'AbortError') return { ok: false, method: 'share', cancelled: true };
        // 其他错误（没有用户手势、权限）：退回复制
      }
    }
  }
  const content = data.url || joinLines([data.title, data.text]);
  const copied = await copyText(content, { silent: true, env: { navigator: nav, document: env.document } });
  // key 和 copyText 的提示一样：连点几次只留一条
  if (copied.ok) notify({ message: data.url ? '链接已复制，可以粘贴给对方' : '已复制，可以粘贴给对方', tone: 'success', key: 'clipboard' });
  else notify({ message: '这台设备不能直接分享，请长按链接手动复制', tone: 'warning', key: 'clipboard' });
  return { ok: copied.ok, method: 'copy' };
}

/**
 * 跳去别的 App（Grab、Google 地图）之后，看页面有没有真的被切到后台。
 * timeout 毫秒内页面变成隐藏（visibilitychange → hidden）或触发 pagehide / blur，就认为 App 打开了 → true；
 * 否则 → false（多半是没装 App 或通用链接没生效：调用方显示「没打开 Grab？地址已复制……」）。
 * 在 App 外壳里交给外壳打开，网页判断不了，直接当作打开了。
 * @param {{ timeout?: number, env?: object }} [o]
 * @returns {Promise<boolean>}
 */
export function watchAppSwitch({ timeout = 1500, env = defaultEnv() } = {}) {
  if (isNativeShell({ env })) return Promise.resolve(true);
  const doc = env.document;
  const win = env.window;
  if (!doc || !win) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      doc.removeEventListener?.('visibilitychange', onVisibility);
      win.removeEventListener?.('pagehide', onLeave);
      win.removeEventListener?.('blur', onLeave);
      resolve(value);
    };
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') finish(true);
    };
    const onLeave = () => finish(true);
    doc.addEventListener?.('visibilitychange', onVisibility);
    win.addEventListener?.('pagehide', onLeave);
    win.addEventListener?.('blur', onLeave);
    const timer = setTimeout(() => finish(false), timeout);
  });
}
