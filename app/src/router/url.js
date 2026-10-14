// =====================================================================
// router/url.js：hash 网址的解析与拼装（纯函数，不碰 window，单元测试直接测）。
//
// 网址格式：  #/<路径>?<查询参数>
//   例：      #/t/demo-island/ledger?tab=list&sheet=expense
//
// 查询参数里 `sheet` 是保留字，表示“弹层栈”（底 → 顶，逗号分隔）：
//   sheet=expense                    一个弹层
//   sheet=item:3f2a9c,confirm-del   两层：底下 item（参数 3f2a9c），上面 confirm-del
// 弹层 id：小写字母、数字、连字符；参数（冒号后面）：字母数字和 _ . ~ -，最长 80 位
// （够放 uuid、日期、短名）。更复杂的数据别塞进网址，放到状态里。
// =====================================================================

export const SHEET_PARAM = 'sheet';
export const SHEET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const SHEET_ARG_RE = /^[A-Za-z0-9_.~-]{1,80}$/;

/** Supabase 登录回调会把这些参数放进 hash（不以 #/ 开头）。 */
const AUTH_CALLBACK_RE = /(^|&)(access_token|refresh_token|provider_token|error|error_code|error_description)=/;

/**
 * 解析 location.hash。
 * @param {string} hash 例如 '#/t/x/ledger?sheet=a'
 * @returns {{ kind: 'route', path: string, query: Record<string,string>, sheets: Array<{id:string,arg:string|null}> }
 *          | { kind: 'empty' } | { kind: 'auth-callback', raw: string } | { kind: 'invalid', raw: string }}
 */
export function parseHash(hash) {
  const raw = String(hash ?? '');
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  if (body === '' || body === '/') return { kind: 'empty' };
  if (!body.startsWith('/')) {
    if (AUTH_CALLBACK_RE.test(body)) return { kind: 'auth-callback', raw: body };
    return { kind: 'invalid', raw: body };
  }
  const q = body.indexOf('?');
  const rawPath = q === -1 ? body : body.slice(0, q);
  const search = q === -1 ? '' : body.slice(q + 1);
  const { query, sheets } = parseQuery(search);
  return { kind: 'route', path: normalizePath(rawPath), query, sheets };
}

/** 路径规范化：合并重复的 /，去掉结尾的 /（根路径除外）。不解码。 */
export function normalizePath(path) {
  let p = String(path || '/').replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * 解析查询串。重复的键取最后一个；空键忽略；`sheet` 单独解析成弹层栈。
 * @param {string} search 不带 ?
 */
export function parseQuery(search) {
  const query = {};
  let sheets = [];
  if (search) {
    const params = new URLSearchParams(search);
    for (const [key, value] of params) {
      if (!key) continue;
      if (key === SHEET_PARAM) sheets = parseSheets(value);
      else query[key] = value;
    }
  }
  return { query, sheets };
}

/** 'a,b:arg' → [{id:'a',arg:null},{id:'b',arg:'arg'}]；不合规则的项丢掉。 */
export function parseSheets(value) {
  const out = [];
  for (const part of String(value || '').split(',')) {
    const item = part.trim();
    if (!item) continue;
    const c = item.indexOf(':');
    const id = c === -1 ? item : item.slice(0, c);
    const arg = c === -1 ? null : item.slice(c + 1);
    if (!SHEET_ID_RE.test(id)) continue;
    if (arg !== null && !SHEET_ARG_RE.test(arg)) continue;
    out.push({ id, arg });
  }
  return out;
}

/** 弹层栈 → 'a,b:arg'。不合规则直接抛错（这是代码写错了，不是用户输入）。 */
export function stringifySheets(sheets) {
  return (sheets || []).map((s) => {
    const sheet = typeof s === 'string' ? { id: s, arg: null } : s;
    assertSheet(sheet.id, sheet.arg ?? null);
    return sheet.arg == null ? sheet.id : `${sheet.id}:${sheet.arg}`;
  }).join(',');
}

export function assertSheet(id, arg) {
  if (!SHEET_ID_RE.test(String(id))) {
    throw new Error(`弹层 id「${id}」不合规则：只能用小写字母、数字、连字符，以字母或数字开头，最长 40 位`);
  }
  if (arg != null && !SHEET_ARG_RE.test(String(arg))) {
    throw new Error(`弹层参数「${arg}」不合规则：只能用字母、数字和 _ . ~ -，最长 80 位`);
  }
}

/**
 * 查询对象 → 查询串（不带 ?）。值为 null / undefined / '' 的键省略；
 * 键按字母排序（同一状态永远得到同一个网址），sheet 永远放最后。
 */
export function stringifyQuery(query, sheets) {
  const params = new URLSearchParams();
  for (const key of Object.keys(query || {}).sort()) {
    if (key === SHEET_PARAM) throw new Error('查询参数里不能直接写 sheet，用 openSheet() / sheets');
    const value = query[key];
    if (value === null || value === undefined || value === '') continue;
    params.append(key, String(value));
  }
  const s = sheets && sheets.length ? stringifySheets(sheets) : '';
  let out = params.toString();
  if (s) out += `${out ? '&' : ''}${SHEET_PARAM}=${encodeSheetValue(s)}`;
  return out;
}

/** 弹层值里的逗号、冒号保留原样（可读），其余照常编码。 */
function encodeSheetValue(value) {
  return encodeURIComponent(value).replace(/%2C/gi, ',').replace(/%3A/gi, ':');
}

/**
 * 拼 hash。
 * @param {{ path: string, query?: Record<string, any>, sheets?: Array }} parts
 * @returns {string} 例如 '#/t/x/ledger?sheet=a'
 */
export function buildHash({ path, query, sheets }) {
  const qs = stringifyQuery(query, sheets);
  return `#${normalizePath(path)}${qs ? `?${qs}` : ''}`;
}

/** 两个查询对象是否相同（只比较非空值）。 */
export function sameQuery(a, b) {
  const clean = (o) => Object.keys(o || {}).filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== '').sort();
  const ka = clean(a);
  const kb = clean(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[k]));
}

/** 两个弹层栈是否相同。 */
export function sameSheets(a, b) {
  if ((a?.length || 0) !== (b?.length || 0)) return false;
  return (a || []).every((s, i) => s.id === b[i].id && (s.arg ?? null) === (b[i].arg ?? null));
}
