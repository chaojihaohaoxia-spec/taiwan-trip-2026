// =====================================================================
// data/errors.js：数据层统一的错误类型 DataError + 把各种来源的错误翻译成中文。
//
// 页面只需要看三样东西：
//   error.message    给人看的中文（可以直接显示在提示里）
//   error.kind       类别，决定怎么处理（见下表）
//   error.retryable  能不能自动重试（写队列据此决定“等一会儿再发”还是“停下来提示”）
//
//   kind          含义                                  retryable
//   network       断网、超时、请求被中断                  是
//   server        后台 5xx / 429 太频繁                   是
//   auth          登录过期（401 / JWT expired）           是（先刷新登录再重试）
//   storage       本机存储（IndexedDB）暂时不可用          是（存储恢复后再试）
//   unauthenticated 没登录                               否
//   permission    没有权限（RLS 42501、只读成员）          否
//   validation    内容不符合规则（CHECK、外键、格式）       否
//   conflict      和已有数据重复（唯一约束 23505）          否
//   not-found     找不到（行程不存在或不是成员）            否
//   unknown       其他                                    否（写队列会先有限次重试，见 outbox.js）
//
// Supabase 的三类错误都会经过这里：PostgREST（{ code, message, details, hint } + HTTP 状态）、
// Auth（AuthApiError / AuthRetryableFetchError，带 code / status）、Storage（StorageApiError）。
// 我们自己的 RPC 抛的就是中文（如“邀请码无效或已过期”），直接沿用。
//
// 网络错误的判定只看错误的“名字”和固定的英文写法，不看文字是不是中文：
//   - 请求超时：supabase.js 用 DOMException(…, 'TimeoutError') 中止请求；postgrest-js 把它包成
//     { message: 'TimeoutError: …', code: '' }、状态 0（它只是把 name 拼在 message 前面）——按前缀认出来；
//   - 请求被中止：AbortError（同样可能被包成 'AbortError: …'）；
//   - 断网：TypeError('Failed to fetch' / 'Load failed' / 'NetworkError…')，同样可能被包成 'TypeError: …'。
// =====================================================================

export class DataError extends Error {
  /**
   * @param {string} message 中文说明
   * @param {{ kind?: string, code?: string|null, status?: number|null, retryable?: boolean, cause?: any, field?: string|null }} [o]
   */
  constructor(message, o = {}) {
    super(message);
    this.name = 'DataError';
    this.kind = o.kind || 'unknown';
    this.code = o.code ?? null;
    this.status = o.status ?? null;
    this.retryable = o.retryable ?? RETRYABLE_KINDS.has(this.kind);
    this.field = o.field ?? null;
    if (o.cause !== undefined) this.cause = o.cause;
  }

  /** 存进写队列（IndexedDB）用的纯对象 */
  toJSON() {
    return { message: this.message, kind: this.kind, code: this.code, status: this.status, retryable: this.retryable, field: this.field };
  }

  /** 从 toJSON() 的结果还原 */
  static from(obj) {
    if (obj instanceof DataError) return obj;
    return new DataError(obj?.message || '出了点问题', obj || {});
  }
}

export const RETRYABLE_KINDS = new Set(['network', 'server', 'auth', 'storage']);

export function isDataError(e) {
  return e instanceof DataError;
}

const CJK = /[㐀-鿿]/;

/** Postgres / PostgREST 错误码 → [kind, 中文说明] */
const PG_CODES = {
  42501: ['permission', '没有权限做这个操作'],
  23505: ['conflict', '和已有的内容重复了'],
  23503: ['validation', '关联的内容不存在或已经被删除了'],
  23514: ['validation', '内容不符合规则'],
  23502: ['validation', '缺少必填的内容'],
  '22P02': ['validation', '格式不对'],
  22007: ['validation', '日期或时间格式不对'],
  22008: ['validation', '日期或时间超出范围'],
  22023: ['validation', '参数不对'],
  22001: ['validation', '内容太长了'],
  '42P01': ['server', '后台的表还没建好'],
  42883: ['server', '后台的函数还没建好'],
  PGRST116: ['not-found', '找不到这条内容'],
  PGRST301: ['auth', '登录已过期，正在重新连接'],
  PGRST303: ['auth', '登录已过期，正在重新连接'],
  PGRST302: ['unauthenticated', '请先登录'],
  PGRST204: ['validation', '后台没有这个字段（数据结构可能还没更新）'],
  PGRST202: ['server', '后台没有这个函数（数据结构可能还没更新）'],
};

const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network|econn|etimedout|enotfound|timeout|timed out|aborted|the internet connection appears to be offline|offline/i;
/** 中止类错误的名字（fetch 被 AbortController 中止） */
const ABORT_NAMES = new Set(['AbortError', 'TimeoutError']);
/** postgrest-js / storage-js 把原始错误包成 `${name}: ${message}` 放进 message：按前缀认出原来是哪一类 */
const WRAPPED_ABORT_RE = /^\s*(AbortError|TimeoutError)\b/;
const WRAPPED_FETCH_RE = /^\s*TypeError:\s*(failed to fetch|load failed|networkerror|network request failed|fetch failed)/i;

/** 是不是“请求超时”（我们自己的 20 秒 / 90 秒超时，或者浏览器的超时） */
export function isTimeoutError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError') return true;
  return /^\s*TimeoutError\b/.test(String(err.message || ''));
}

/** 是不是“网络不通”一类的错误（断网、超时、中止） */
export function looksLikeNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError' || err.name === 'StorageUnknownError') return true;
  if (ABORT_NAMES.has(err.name)) return true;
  const msg = String(err.message || '');
  if (WRAPPED_ABORT_RE.test(msg) || WRAPPED_FETCH_RE.test(msg)) return true;
  if (err.name === 'TypeError' && /fetch|load failed|network/i.test(msg)) return true;
  // 其他英文写法（Node 的 ECONNRESET、各浏览器的措辞）。中文的说明是我们自己写的提示，不按关键字猜
  return NETWORK_RE.test(msg) && !CJK.test(msg);
}

/**
 * 任何错误 → DataError。
 * @param {any} err
 * @param {{ status?: number, context?: string }} [o] status：HTTP 状态（supabase-js 把它放在结果上而不是 error 上）
 */
export function toDataError(err, o = {}) {
  if (err instanceof DataError) return err;
  const status = Number(o.status ?? err?.status ?? err?.statusCode ?? 0) || 0;
  const code = err?.code !== undefined && err?.code !== null && err?.code !== '' ? String(err.code) : null;
  const raw = String(err?.message || err?.error_description || err?.error || err || '');
  const prefix = o.context ? `${o.context}：` : '';

  if (err?.name === 'StorageUnavailableError') {
    return new DataError(`${prefix}这台设备的存储暂时不可用，稍后会自动重试`, { kind: 'storage', code, status, cause: err });
  }
  if (isTimeoutError(err) && (status === 0 || !code)) {
    return new DataError(`${prefix}网络太慢，请求超时了，稍后会自动重试`, { kind: 'network', code, status, cause: err });
  }
  if (status === 0 && looksLikeNetworkError(err)) {
    return new DataError(`${prefix}网络连接失败，联网后会自动重试`, { kind: 'network', code, status, cause: err });
  }
  if (looksLikeNetworkError(err) && !code) {
    return new DataError(`${prefix}网络连接失败，联网后会自动重试`, { kind: 'network', code, status, cause: err });
  }
  if (code && PG_CODES[code]) {
    const [kind, msg] = PG_CODES[code];
    // 我们自己的 RPC / 触发器抛的是中文，直接用
    const message = CJK.test(raw) ? raw : msg;
    return new DataError(`${prefix}${message}`, { kind, code, status, cause: err });
  }
  if (status === 401 || /jwt expired|invalid jwt|jwt/i.test(raw)) {
    return new DataError(`${prefix}登录已过期，正在重新连接`, { kind: 'auth', code, status, cause: err });
  }
  if (status === 403) {
    return new DataError(`${prefix}${CJK.test(raw) ? raw : '没有权限做这个操作'}`, { kind: 'permission', code, status, cause: err });
  }
  if (status === 404) {
    return new DataError(`${prefix}找不到这条内容`, { kind: 'not-found', code, status, cause: err });
  }
  if (status === 409 || /duplicate|already exists/i.test(raw)) {
    return new DataError(`${prefix}和已有的内容重复了`, { kind: 'conflict', code, status, cause: err });
  }
  if (status === 413 || /payload too large|exceeded the maximum allowed size|too large/i.test(raw)) {
    return new DataError(`${prefix}文件太大了（最大 20 MB）`, { kind: 'validation', code, status, cause: err });
  }
  if (status === 415 || /mime type .* is not supported|invalid mime/i.test(raw)) {
    return new DataError(`${prefix}不支持这种文件类型`, { kind: 'validation', code, status, cause: err });
  }
  if (status === 429) {
    return new DataError(`${prefix}操作太频繁，稍后会自动重试`, { kind: 'server', code, status, cause: err });
  }
  if (status === 408 || status >= 500) {
    return new DataError(`${prefix}后台暂时不可用，稍后会自动重试`, { kind: 'server', code, status, cause: err });
  }
  if (CJK.test(raw)) return new DataError(`${prefix}${raw}`, { kind: 'unknown', code, status, cause: err });
  return new DataError(`${prefix}出了点问题${raw ? `（${raw.slice(0, 120)}）` : ''}`, { kind: 'unknown', code, status, cause: err });
}

/** 登录、注册、验证码的错误 → 中文 DataError */
export function toAuthError(err) {
  if (err instanceof DataError) return err;
  const code = String(err?.code || '');
  const raw = String(err?.message || '');
  const status = Number(err?.status || 0) || 0;
  const make = (message, kind = 'validation') => new DataError(message, { kind, code: code || null, status, cause: err });

  if (err?.name === 'AuthRetryableFetchError' || looksLikeNetworkError(err)) {
    return new DataError('网络连接失败，请检查网络后再试', { kind: 'network', code: code || null, status, cause: err });
  }
  const wait = /after (\d+) seconds?/i.exec(raw);
  if (wait) return make(`操作太频繁，请 ${wait[1]} 秒后再试`, 'server');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) return make('邮箱或密码不对');
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) return make('邮箱还没验证：请输入邮件里的验证码，或者用验证码登录');
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered|already exists/i.test(raw)) return make('这个邮箱已经注册过了，直接登录就好', 'conflict');
  if (code === 'weak_password' || /password should be|password is too weak|weak password/i.test(raw)) {
    const n = /at least (\d+)/i.exec(raw);
    return make(`密码太简单了：至少 ${n ? n[1] : 6} 位`);
  }
  if (code === 'same_password' || /should be different from the old/i.test(raw)) return make('新密码不能和旧密码一样');
  if (code === 'otp_expired' || /token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(raw)) return make('验证码不对或已过期');
  if (code === 'otp_disabled' || /signups not allowed for otp/i.test(raw)) return make('这个邮箱还没注册，请先注册', 'not-found');
  if (code === 'signup_disabled' || /signups? (are )?not allowed|signup is disabled/i.test(raw)) return make('现在不开放注册，请让行程创建者邀请你', 'permission');
  if (code === 'email_address_invalid' || /unable to validate email|invalid format|email address .* is invalid/i.test(raw)) return make('邮箱格式不对');
  if (code === 'email_address_not_authorized') return make('这个邮箱不能用来登录', 'permission');
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(raw)) return make('发送邮件太频繁了，请过一会儿再试', 'server');
  if (code === 'over_request_rate_limit' || status === 429) return make('操作太频繁，请稍后再试', 'server');
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'session_expired' || /refresh token/i.test(raw)) {
    return make('登录已失效，请重新登录', 'unauthenticated');
  }
  if (code === 'user_not_found' || /user not found/i.test(raw)) return make('这个邮箱还没注册，请先注册', 'not-found');
  if (status >= 500) return make('登录服务暂时不可用，请稍后再试', 'server');
  if (CJK.test(raw)) return make(raw, 'unknown');
  return make(`登录出了点问题${raw ? `（${raw.slice(0, 120)}）` : ''}`, 'unknown');
}
