// =====================================================================
// data/session.js：读本机保存的登录会话里的用户（不依赖 supabase-js，数据层主包里就有）。
//
// 用途：
//   - backend-supabase.js：离线、access token 过期又刷新不了时，靠它认出“还是这个人”；
//   - auth.js：后台代码分包（backend-supabase.js / supabase-js）下载失败时（第一次打开时网络抖、
//     发版后旧分包被删），也能先按“离线已登录”进入，看缓存、记账进写队列，联网后再恢复真正的会话。
// 只读不写；会话键见 config.js（'rs7885:auth'）。
// =====================================================================

import { AUTH_STORAGE_KEY } from './config.js';

/** supabase 的 user → 我们用的用户对象 */
export function toUser(u) {
  if (!u || !u.id) return null;
  const meta = u.user_metadata || {};
  return { id: u.id, email: u.email || null, displayName: meta.display_name || meta.name || null };
}

/**
 * 本机保存的会话里的用户；没有、格式不对、存储读不了 → null。
 * @param {Storage|null} [storage] 默认 localStorage（测试传假的）
 */
export function readStoredUser(storage = globalThis.localStorage ?? null) {
  try {
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return toUser(s?.user || s?.currentSession?.user);
  } catch {
    return null;
  }
}
