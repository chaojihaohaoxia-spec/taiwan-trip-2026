// =====================================================================
// data/util.js：数据层共用的小工具（纯函数，Node 里能直接测）。
//
//   newId()              新行的 uuid（crypto.randomUUID，旧浏览器退回 getRandomValues）
//   toTimestamptz(d)     Date → 数据库返回的写法 '2027-01-10T03:35:00.000+00:00'（UTC）
//   normalizeTimestamptz 各种来源（PostgREST、实时推送、用户输入）的时间戳 → 统一写法
//   normalizeTime        '9:30' / '09:30' / '09:30:00.123' → '09:30:00'（数据库 time 的返回写法）
//   isValidDate          'YYYY-MM-DD' 且真实存在
//   stableStringify      键排序后的 JSON（jsonb 会重排键，比较前要规范化）
//   deepEqual            按值比较（含 jsonb 对象/数组）；带时区的时间戳按“时刻”比较
//   diffPatch            只留下真正改变的字段（“只提交改动字段”）
//   shallowFreeze        行对象浅冻结（防止页面直接改数据层里的行）
// =====================================================================

import { isValidDate as isRealDate, addDays } from '../lib/datetime.js';

/** 新行的 uuid（v4） */
export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const TSTZ_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Date（或毫秒数）→ '2027-01-10T03:35:00.000+00:00'（和数据库返回的一样是 UTC、带 +00:00） */
export function toTimestamptz(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError(`无效的时间：${date}`);
  return d.toISOString().replace('Z', '+00:00');
}

/**
 * 时间戳统一写法。数据库（PostgREST）返回 '2027-01-10T03:35:00+00:00'，实时推送偶尔是
 * '2027-01-10 03:35:00+00'，用户输入可能是 '…+07:00' 或 'Z'。这里只修正写法（T、偏移带冒号），
 * 不改时区（显示时按行里的 *_tz 或行程时区换算）。解析不了的原样返回。
 */
export function normalizeTimestamptz(value) {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  const m = TSTZ_RE.exec(s);
  if (!m) return s;
  let [, date, time, off] = m;
  if (time.length === 5) time += ':00';
  if (/^z$/i.test(off)) off = '+00:00';
  else if (/^[+-]\d{2}$/.test(off)) off += ':00';
  else if (/^[+-]\d{4}$/.test(off)) off = `${off.slice(0, 3)}:${off.slice(3)}`;
  return `${date}T${time}${off}`;
}

/** 时间戳 → 毫秒；空值或解析不了返回 NaN */
export function tsMs(value) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  return Date.parse(normalizeTimestamptz(value));
}

/** 带时区偏移、能解析的时间戳 */
export function isValidTimestamptz(value) {
  return typeof value === 'string' && TSTZ_RE.test(value.trim()) && Number.isFinite(tsMs(value));
}

/**
 * 钟点统一成 'HH:MM:SS'（数据库 time 列返回的写法）。null/undefined/'' → null。
 * 不合法的抛 TypeError（调用方转成中文提示）。
 */
export function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const m = TIME_RE.exec(String(value).trim());
  if (!m) throw new TypeError(`钟点格式不对：${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  const ok = (h < 24 && min < 60 && sec < 60) || (h === 24 && min === 0 && sec === 0);
  if (!ok) throw new TypeError(`钟点超出范围：${value}`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 'HH:MM:SS' → 当天第几分钟；null → null */
export function timeToMinutes(value) {
  if (!value) return null;
  const m = TIME_RE.exec(String(value));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
}

/**
 * 'YYYY-MM-DD' 且是真实存在的日期。日期运算只在 lib/datetime.js 做一份；
 * 这里另外要求原样就是这个格式（不能带空格：要写进数据库的值不做修剪）。
 */
export function isValidDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && isRealDate(value);
}

/** 'YYYY-MM-DD' 加减天数（lib/datetime.js 的同一个函数） */
export { addDays };

/** 键排序后的 JSON（undefined 字段忽略，和 JSON.stringify 一致） */
export function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = sortKeysDeep(v[k]);
    }
    return out;
  }
  return v;
}

/**
 * 按值比较（jsonb 对象键序不同也算相等；数字 1 和 1.0 相等）。
 * 两边都是带时区的时间戳时按“时刻”比较：Postgres 返回时去掉小数末尾的 0（'…00.12+00:00'、整秒时连小数点都没有），
 * 和本地写的 '…00.120+00:00' 是同一刻——不能当成“改了”（否则编辑表单保存时会提交没改的字段，覆盖对方同时改的内容）。
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'string' && typeof b === 'string') {
    if (TSTZ_RE.test(a) && TSTZ_RE.test(b)) {
      const x = tsMs(a);
      return Number.isFinite(x) && x === tsMs(b);
    }
    return false;
  }
  if (typeof a !== 'object' || typeof b !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  return stableStringify(a) === stableStringify(b);
}

/**
 * 只留下真正改变的字段。patch 里值为 undefined 的键忽略。
 * @returns {object} 可能是空对象（表示什么都没改）
 */
export function diffPatch(current, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (!current || !deepEqual(current[k], v)) out[k] = v;
  }
  return out;
}

/** 浅冻结一行（开发时能马上发现“直接改了数据层的行”这类错误） */
export function shallowFreeze(row) {
  return row && typeof row === 'object' ? Object.freeze(row) : row;
}

/** 深拷贝（行数据都是 JSON 能表达的东西） */
export function clone(value) {
  if (value === null || value === undefined) return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

/** 有限的数字 */
export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 32 位 FNV-1a 哈希（演示数据指纹、缓存键用；不做安全用途） */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 等 ms 毫秒（可被 AbortSignal 打断） */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

/** 邮箱格式（宽松：有 @、有点、没有空格） */
export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** 邮箱 @ 前面那段（没有显示名时用来称呼） */
export function emailHandle(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s;
}
