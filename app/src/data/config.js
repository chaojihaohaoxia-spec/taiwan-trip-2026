// =====================================================================
// data/config.js：后台连接配置（scripts/lib/csp.mjs 也读这里，所以只能放纯常量）。
//
// SUPABASE_ANON_KEY 是 Supabase 的“可公开密钥”（publishable key），设计上就是放在前端的；
// 数据安全靠数据库的 RLS 权限规则（只有行程成员登录后才能读写），不靠藏这个 key。
// 绝对不要把 service_role / secret key 放进前端或仓库。
//
// AUTH_STORAGE_KEY：v2 用新的键 'rs7885:auth'，不和旧版的 'taiwanTrip2026Auth' 共用。
//   原因：旧版页面（legacy/）和新版同源，共用一个会话会互相轮换 refresh token、把对方踢下线；
//   而且 github.io 下同一账号的所有网站共用 localStorage，键名要有自己的前缀。
//   代价：升级到 v2 后要重新登录一次（旧键原样保留，不删除）。
// =====================================================================

export const SUPABASE_URL = 'https://vzybjxghnoyubzdhvmsl.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_dfEGPYFxKz9FQS_sNYgXPA_7ncxovbK';
export const AUTH_STORAGE_KEY = 'rs7885:auth';
/** 旧版的会话键（只用来提示“旧版登录过”，不读不写其内容） */
export const LEGACY_AUTH_STORAGE_KEY = 'taiwanTrip2026Auth';

/** 私有文件桶（照片、确认单、小票），路径规则见 docs/数据结构.md A5 */
export const FILES_BUCKET = 'trip-files';
/** 签名链接有效期（秒） */
export const SIGNED_URL_TTL = 3600;
/** 单个文件上限（和存储桶设置一致） */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 存储桶允许的类型（和 SQL 一致） */
export const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']);
/** 普通请求、上传的超时（毫秒）：海岛上网络时有时无，请求挂住不如尽快失败、交给写队列重试 */
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 90_000;
