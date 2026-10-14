// =====================================================================
// sheets/args.js：弹层参数（网址 ?sheet=<id>:<参数> 里冒号后面那段）的统一写法（纯函数，Node 里能直接测）。
//
// 网址里的参数只能用字母、数字和 _ . ~ -，最长 80 位（router/url.js 的 SHEET_ARG_RE）。约定三种写法：
//
//   1. 没有参数           → 新建（空白表单）                     ?sheet=expense
//   2. 一个 id            → 打开 / 编辑这一条                     ?sheet=expense:8e0843e1-12a3-…
//   3. 键.值~键.值        → 新建，并预填这些字段                  ?sheet=expense:i.5c0710f0-…~d.2027-01-11
//      写了 id 键（id.<uuid>~n.3）时是“打开这一条 + 附加参数”（mode 'edit'）；
//      看大图 ?sheet=photo:e.<日记 id>~n.3 不是这种：e 是 entry 键，解析出来是 mode 'new'、fields { entry, index }，弹层按 fields 读
//
// 键用一个字母（两个 uuid 加起来就 72 位，长名字放不下），对照见 ARG_KEYS；代码里一律用长名字，
// encodeSheetArg / parseSheetArg 负责换算。值里不能有 ~（id、日期、清单名、数字都没问题）。
// 太长时按 priority 从后往前丢掉低优先级的字段（例如给了条目就不再写地点和日期——它们能从条目推出来）；
// 丢了哪些交给 onDrop（默认：开发构建里 console.warn，免得悄悄丢掉没人发现）。一个参数里最多放得下两个 uuid。
//
//   encodeSheetArg({ item: id, date: '2027-01-11' }, ['item', 'booking', 'place', 'date'])   → 'i.<id>~d.2027-01-11'
//   parseSheetArg('i.<id>~d.2027-01-11') → { mode: 'new', id: null, fields: { item: '<id>', date: '2027-01-11' } }
//   parseSheetArg('<id>')                → { mode: 'edit', id: '<id>', fields: {} }
//   parseSheetArg(null)                  → { mode: 'new', id: null, fields: {} }
// =====================================================================

import { IS_DEV } from '../lib/env.js';

/** 和 router/url.js 的 SHEET_ARG_RE 一致 */
export const SHEET_ARG_RE = /^[A-Za-z0-9_.~-]{1,80}$/;
export const SHEET_ARG_MAX = 80;

/** 长名字 → 网址里的键 */
export const ARG_KEYS = Object.freeze({
  id: 'id',
  item: 'i',
  place: 'p',
  booking: 'b',
  date: 'd',
  day: 'y',
  category: 'c',
  list: 'l',
  kind: 'k',
  after: 'a',
  parent: 'r',
  variant: 'v',
  mode: 'm',
  entry: 'e',
  review: 'w',
  index: 'n',
  tab: 't',
  role: 'o',
  currency: 'u',
});

const LONG = Object.freeze(Object.fromEntries(Object.entries(ARG_KEYS).map(([k, v]) => [v, k])));

/** 记账分类（中文）在网址里的写法（网址参数不能有中文） */
export const EXPENSE_CATEGORY_CODES = Object.freeze({
  餐饮: 'food', 交通: 'transport', 住宿: 'stay', 购物: 'shop', 门票: 'ticket', 活动: 'activity', 其他: 'other',
});
const CATEGORY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(EXPENSE_CATEGORY_CODES).map(([k, v]) => [v, k])));

/** 记账分类 ↔ 网址写法 */
export const categoryToCode = (c) => EXPENSE_CATEGORY_CODES[c] || null;
export const categoryFromCode = (code) => CATEGORY_BY_CODE[code] || null;

const VALUE_RE = /^[A-Za-z0-9_.-]+$/;

/** 开发构建里丢字段时提醒（单元测试、线上不提醒） */
function warnDropped(dropped, fields) {
  if (IS_DEV) console.warn(`[弹层参数] 太长（超过 ${SHEET_ARG_MAX} 位），丢掉了 ${dropped.join('、')}；弹层要自己从别的字段推出来`, fields);
}

/**
 * 字段 → 参数字符串。值为 null / undefined / '' 的字段跳过；全都空返回 null（= 新建，不带参数）。
 * @param {Record<string, string|number|null|undefined>} fields  长名字（item / place / date …）
 * @param {string[]} [priority] 字段的先后（也是太长时保留的优先级）；不在里面的字段排在后面
 * @param {{ onDrop?: (dropped: string[], fields: object) => void }} [o] 太长丢了字段时调用（长名字）；默认开发构建里 console.warn
 * @returns {string|null}
 */
export function encodeSheetArg(fields, priority = [], { onDrop = warnDropped } = {}) {
  const keys = Object.keys(fields || {}).filter((k) => fields[k] !== null && fields[k] !== undefined && fields[k] !== '');
  keys.sort((a, b) => rank(priority, a) - rank(priority, b));
  const pairs = keys.map((k) => {
    const short = ARG_KEYS[k];
    if (!short) throw new Error(`弹层参数：不认识的字段「${k}」（在 sheets/args.js 的 ARG_KEYS 里登记）`);
    const v = String(fields[k]);
    if (!VALUE_RE.test(v)) throw new Error(`弹层参数「${k}」的值「${v}」不合规则：只能用字母、数字和 _ . -`);
    return `${short}.${v}`;
  });
  const dropped = [];
  while (pairs.length && pairs.join('~').length > SHEET_ARG_MAX) {
    pairs.pop();
    dropped.unshift(keys[pairs.length]);
  }
  if (dropped.length) onDrop?.(dropped, fields);
  return pairs.length ? pairs.join('~') : null;
}

function rank(priority, k) {
  const i = priority.indexOf(k);
  return i === -1 ? priority.length : i;
}

/**
 * 参数字符串 → { mode, id, fields }。
 *   mode：'new'（新建，可能带预填 fields）/ 'edit'（打开 / 编辑 id 那一条；fields 里可能还有附加参数）
 * 不合规则的参数当成没有参数（新建）。
 * @param {string|null|undefined} arg
 * @returns {{ mode: 'new'|'edit', id: string|null, fields: Record<string, string> }}
 */
export function parseSheetArg(arg) {
  if (arg === null || arg === undefined || arg === '' || !SHEET_ARG_RE.test(String(arg))) return { mode: 'new', id: null, fields: {} };
  const s = String(arg);
  if (!s.includes('.')) return { mode: 'edit', id: s, fields: {} };
  const fields = {};
  for (const part of s.split('~')) {
    const dot = part.indexOf('.');
    if (dot <= 0) continue;
    const key = LONG[part.slice(0, dot)];
    const value = part.slice(dot + 1);
    if (key && value) fields[key] = value;
  }
  const id = fields.id || null;
  delete fields.id;
  return { mode: id ? 'edit' : 'new', id, fields };
}
