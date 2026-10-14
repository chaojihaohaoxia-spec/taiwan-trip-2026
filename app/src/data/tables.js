// =====================================================================
// data/tables.js：写入相关的表元数据 + 写入前的校验（和数据库的约束一致）。
//
// schema.js 登记“有哪些列”；这里登记“怎么写”：
//   BUNDLE_TABLES       进一个行程数据包的 13 张表（= 文档 A6 的实时表）
//   keyColumns(table)   主键列（trip_members 是 trip_id + user_id，其余是 id）
//   rowKey(table, row)  本地 Map 用的键（字符串）
//   REFERENCES          表内引用（列 → 被引用的表、删除时置空还是连带删除），和 SQL 的组合外键一致
//   UNIQUE              除主键外的唯一约束
//   writableColumns     前端可以写的列（去掉系统列、生成列、旧版专用列）
//   validateRow(table, row)  按 SQL 的 NOT NULL / CHECK / 枚举 / JSON 结构校验，返回中文问题或 null
//
// 校验在写入前做（乐观更新之前），这样不合规的改动不会进写队列、也不会卡住后面的改动。
// =====================================================================

import { TABLES, ENUMS } from './schema.js';
import { DataError } from './errors.js';
import { UUID_RE, isValidDate, isValidTimestamptz, normalizeTime, normalizeTimestamptz, isFiniteNumber } from './util.js';
import { isValidTimeZone as intlKnowsZone } from '../lib/datetime.js';

/** 一个行程数据包里的表（顺序 = 加载、缓存的顺序） */
export const BUNDLE_TABLES = Object.freeze([
  'trips', 'trip_members', 'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos',
  'tips', 'journal_entries', 'reviews', 'expenses',
]);

/** owner / editor 可以增删改的共享内容表（文档 A4） */
export const SHARED_TABLES = Object.freeze(['segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'expenses']);
/** 每个成员只能写自己那行的表 */
export const PERSONAL_TABLES = Object.freeze(['journal_entries', 'reviews']);
/** 由触发器维护、前端不写的系统列 */
export const SYSTEM_COLUMNS = Object.freeze(['created_at', 'updated_at', 'created_by', 'updated_by']);

/** 主键列 */
export function keyColumns(table) {
  const def = TABLES[table];
  if (!def) throw new Error(`未登记的表：${table}`);
  return def.pk;
}

/** 本地 Map 的键：单列主键就是值本身，组合主键用 | 连起来 */
export function rowKey(table, row) {
  const pk = keyColumns(table);
  if (pk.length === 1) return String(row[pk[0]]);
  return pk.map((c) => String(row[c])).join('|');
}

/** 一行的主键条件（update/delete 用），如 { id } 或 { trip_id, user_id } */
export function matchOf(table, row) {
  const out = {};
  for (const c of keyColumns(table)) out[c] = row[c];
  return out;
}

/** 表内引用：列 → [被引用的表, 'set-null' | 'cascade']（和 SQL 一致；trip_id → trips 是 cascade，不列） */
export const REFERENCES = Object.freeze({
  places: { segment_id: ['segments', 'set-null'] },
  bookings: { place_id: ['places', 'set-null'] },
  days: { segment_id: ['segments', 'set-null'], stay_booking_id: ['bookings', 'set-null'] },
  items: {
    day_id: ['days', 'set-null'], place_id: ['places', 'set-null'], booking_id: ['bookings', 'set-null'], parent_item_id: ['items', 'cascade'],
  },
  contacts: { booking_id: ['bookings', 'set-null'], place_id: ['places', 'set-null'] },
  todos: { day_id: ['days', 'set-null'], booking_id: ['bookings', 'set-null'], item_id: ['items', 'set-null'] },
  tips: { segment_id: ['segments', 'set-null'], day_id: ['days', 'set-null'], place_id: ['places', 'set-null'], booking_id: ['bookings', 'set-null'] },
  journal_entries: { day_id: ['days', 'cascade'] },
  reviews: { place_id: ['places', 'cascade'], item_id: ['items', 'set-null'] },
  expenses: { item_id: ['items', 'set-null'], booking_id: ['bookings', 'set-null'] },
});

/** 除主键外的唯一约束（列组合）。items.legacy_id 只在不为空时唯一。 */
export const UNIQUE = Object.freeze({
  days: [['trip_id', 'date']],
  journal_entries: [['day_id', 'user_id']],
  reviews: [['place_id', 'user_id']],
  items: [['trip_id', 'legacy_id']],
});

/** 前端可以写的列（去掉系统列、生成列、旧版专用列） */
export function writableColumns(table) {
  const def = TABLES[table];
  if (!def) throw new Error(`未登记的表：${table}`);
  return Object.entries(def.columns)
    .filter(([name, c]) => !c.generated && !c.legacy && !SYSTEM_COLUMNS.includes(name))
    .map(([name]) => name);
}

/** 更新时不能改的列：主键、trip_id、系统列、生成列、旧版专用列 */
export function readonlyOnUpdate(table) {
  const def = TABLES[table];
  const set = new Set([...keyColumns(table), 'trip_id', ...SYSTEM_COLUMNS]);
  for (const [name, c] of Object.entries(def.columns)) if (c.generated || c.legacy) set.add(name);
  if (table === 'journal_entries' || table === 'reviews') set.add('user_id');
  return set;
}

/** 字段的中文名（校验提示用；没列出的用列名） */
export const FIELD_LABELS = Object.freeze({
  title: '标题', name: '名称', date: '日期', kind: '类型', list: '清单', amount: '金额', currency: '币种',
  day_id: '日期', place_id: '地点', user_id: '成员', body: '正文', rating: '评级', qty: '数量',
  start_date: '开始日期', end_date: '结束日期', timezone: '时区', home_currency: '汇总币种', local_currency: '当地币种',
  start_time: '开始时间', end_time: '结束时间', start_at: '开始时间', end_at: '结束时间', price_currency: '价格币种',
  lat: '纬度', lng: '经度', center_lat: '中心纬度', center_lng: '中心经度', mood: '心情', color: '颜色', accent: '主题色',
  role: '角色', status: '状态', payment_status: '付款状态', variant: '方案', parent_item_id: '主方案', category: '分类',
  split: '分摊', cost_estimate: '费用估算', fx_rate: '汇率', sort_key: '排序', sort: '排序',
});

const label = (field) => FIELD_LABELS[field] || field;

const ISO_CUR = /^[A-Z]{3}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * 列值里的 IANA 时区名是否有效（和数据库 is_valid_timezone 一致：空值放行，先看格式，再让 Intl 认一认——
 * “Intl 认不认”只在 lib/datetime.js 判断一份，带缓存）
 */
export function isValidTimeZone(tz) {
  if (tz === null || tz === undefined) return true;
  if (typeof tz !== 'string' || !/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  return intlKnowsZone(tz);
}

function typeProblem(type, v) {
  switch (type) {
    case 'uuid': return typeof v === 'string' && UUID_RE.test(v) ? null : '不是有效的 id';
    case 'text': return typeof v === 'string' ? null : '应该是文字';
    case 'date': return isValidDate(v) ? null : '日期格式不对（YYYY-MM-DD）';
    case 'time':
      try {
        normalizeTime(v);
        return null;
      } catch {
        return '钟点格式不对（HH:MM）';
      }
    case 'timestamptz': return isValidTimestamptz(v) ? null : '时间格式不对（要带时区）';
    case 'integer': case 'smallint': return Number.isInteger(v) ? null : '应该是整数';
    case 'numeric': case 'double precision': return isFiniteNumber(v) ? null : '应该是数字';
    case 'boolean': return typeof v === 'boolean' ? null : '应该是是/否';
    case 'text[]': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : '应该是文字列表';
    case 'jsonb': return v !== null && typeof v === 'object' ? null : '格式不对';
    default: return null;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON 字段内部结构（文档 B5）的基本检查；返回问题或 null */
function jsonProblem(table, field, v) {
  if (v === null) return null;
  const arrOf = (pred, what) => (Array.isArray(v) ? (v.every(pred) ? null : `${what}的格式不对`) : '应该是列表');
  switch (`${table}.${field}`) {
    case 'trips.cover': case 'trips.extra': case 'bookings.details': case 'expenses.split':
      if (!isObj(v)) return '应该是对象';
      break;
    case 'days.route_plan': case 'items.transport_in': case 'items.cost_estimate':
      if (!isObj(v)) return '应该是对象';
      break;
    case 'places.links': case 'bookings.links': case 'items.links':
      return arrOf((l) => isObj(l) && typeof l.url === 'string' && typeof l.label === 'string', '链接');
    case 'bookings.attachments':
      return arrOf((a) => isObj(a) && typeof a.path === 'string' && typeof a.name === 'string', '附件');
    case 'journal_entries.photos': case 'reviews.photos':
      return arrOf((p) => isObj(p) && typeof p.path === 'string', '照片');
    case 'reviews.food_log': case 'reviews.shop_log':
      return arrOf((e) => isObj(e) && typeof e.name === 'string', '记录');
    case 'items.stops':
      return arrOf((s) => isObj(s) && typeof s.name === 'string', '路线点');
    case 'days.decisions':
      return arrOf((d) => isObj(d) && typeof d.question === 'string' && typeof d.answer === 'string', '取舍说明');
    default:
      if (field === 'extra' && !isObj(v)) return '应该是对象';
  }
  if (`${table}.${field}` === 'items.cost_estimate') {
    if (!isFiniteNumber(v.amount) || v.amount < 0) return '估算金额应该是不小于 0 的数字';
    if (v.amount_max !== undefined && v.amount_max !== null && (!isFiniteNumber(v.amount_max) || v.amount_max < v.amount)) return '估算上限不能小于下限';
    if (!ISO_CUR.test(String(v.currency || ''))) return '估算币种要写 ISO 代码（如 VND）';
    if (v.per !== undefined && v.per !== null && v.per !== 'person' && v.per !== 'total') return '估算的 per 只能是 person 或 total';
  }
  if (`${table}.${field}` === 'items.transport_in') {
    if (!Array.isArray(v.options)) return '交通方式列表（options）应该是数组';
    for (const o of v.options) {
      if (!isObj(o) || !ENUMS.transportMode.includes(o.mode)) return '交通方式不认识';
    }
  }
  if (`${table}.${field}` === 'expenses.split') {
    if (Object.keys(v).length === 0) return null; // 旧数据：空对象
    if (v.mode === 'equal') {
      if (!Array.isArray(v.user_ids) || !v.user_ids.length || !v.user_ids.every((u) => typeof u === 'string' && UUID_RE.test(u))) return '平摊要选至少一个人';
    } else if (v.mode === 'amounts') {
      if (!Array.isArray(v.shares) || !v.shares.length) return '按金额分摊要写每个人的金额';
      for (const s of v.shares) {
        if (!isObj(s) || !UUID_RE.test(String(s.user_id || '')) || !isFiniteNumber(s.amount)) return '分摊金额的格式不对';
      }
    } else if (v.mode !== 'personal') {
      return '分摊方式只能是平摊、按金额或个人';
    }
  }
  return null;
}

/**
 * 校验一整行（新建时是补齐默认值后的行；更新时是“当前行 + 改动”合并后的行）。
 * @returns {{ field: string|null, message: string } | null}
 */
export function validateRow(table, row) {
  const def = TABLES[table];
  if (!def) return { field: null, message: `未登记的表：${table}` };
  const fail = (field, message) => ({ field, message: field ? `${label(field)}：${message}` : message });

  for (const [name, c] of Object.entries(def.columns)) {
    if (c.generated || c.legacy || SYSTEM_COLUMNS.includes(name)) continue;
    const v = row[name];
    if (v === null || v === undefined) {
      const dbFills = c.default && typeof c.default === 'object' && 'sql' in c.default;
      if (c.notNull && !dbFills) return fail(name, '不能为空');
      continue;
    }
    const p = typeProblem(c.type, v);
    if (p) return fail(name, p);
    const allowed = ENUMS[`${table}.${name}`];
    if (allowed && !allowed.includes(v)) return fail(name, `取值不对（${v}）`);
    if (c.type === 'jsonb') {
      const jp = jsonProblem(table, name, v);
      if (jp) return fail(name, jp);
    }
  }

  // 表级 CHECK 约束（和 SQL 一致）
  const pair = (a, b) => (row[a] === null || row[a] === undefined) === (row[b] === null || row[b] === undefined);
  const nonEmpty = (f) => typeof row[f] === 'string' && row[f].trim() !== '';
  switch (table) {
    case 'trips':
      if (!nonEmpty('title')) return fail('title', '不能为空');
      if (row.start_date && row.end_date && row.end_date < row.start_date) return fail('end_date', '不能早于开始日期');
      if (!isValidTimeZone(row.timezone)) return fail('timezone', '不是有效的时区');
      if (row.home_currency && !ISO_CUR.test(row.home_currency)) return fail('home_currency', '要写 ISO 代码（如 HKD）');
      if (row.local_currency && !ISO_CUR.test(row.local_currency)) return fail('local_currency', '要写 ISO 代码（如 VND）');
      break;
    case 'trip_members':
      if (row.color && !HEX.test(row.color)) return fail('color', '要写 #RRGGBB');
      break;
    case 'segments':
      if (!nonEmpty('name')) return fail('name', '不能为空');
      if (row.start_date && row.end_date && row.end_date < row.start_date) return fail('end_date', '不能早于开始日期');
      if (!pair('center_lat', 'center_lng')) return fail('center_lng', '经纬度要一起写');
      if (row.center_lat !== null && row.center_lat !== undefined && (Math.abs(row.center_lat) > 90 || Math.abs(row.center_lng) > 180)) return fail('center_lat', '经纬度超出范围');
      if (!isValidTimeZone(row.timezone)) return fail('timezone', '不是有效的时区');
      if (row.accent && !HEX.test(row.accent)) return fail('accent', '要写 #RRGGBB');
      break;
    case 'places':
      if (!nonEmpty('name')) return fail('name', '不能为空');
      if (!pair('lat', 'lng')) return fail('lng', '经纬度要一起写');
      if (row.lat !== null && row.lat !== undefined && (Math.abs(row.lat) > 90 || Math.abs(row.lng) > 180)) return fail('lat', '经纬度超出范围');
      break;
    case 'bookings':
      if (!nonEmpty('title')) return fail('title', '不能为空');
      if (row.start_at && row.end_at && Date.parse(row.end_at) < Date.parse(row.start_at)) return fail('end_at', '不能早于开始时间');
      if (!isValidTimeZone(row.start_tz)) return fail('start_tz', '不是有效的时区');
      if (!isValidTimeZone(row.end_tz)) return fail('end_tz', '不是有效的时区');
      if (row.price_currency && !ISO_CUR.test(row.price_currency)) return fail('price_currency', '要写 ISO 代码');
      if ((row.price_amount !== null && row.price_amount !== undefined) || (row.paid_amount !== null && row.paid_amount !== undefined)) {
        if (!row.price_currency) return fail('price_currency', '写了价格就要写币种');
      }
      break;
    case 'days':
      break;
    case 'items':
      if (!nonEmpty('title')) return fail('title', '不能为空');
      if (row.parent_item_id && row.parent_item_id === row.id) return fail('parent_item_id', '不能挂在自己下面');
      if (row.parent_item_id && row.variant === 'primary') return fail('parent_item_id', '主方案不能挂在别的条目下面');
      break;
    case 'todos':
      if (!nonEmpty('title')) return fail('title', '不能为空');
      if (row.qty !== null && row.qty !== undefined && row.qty < 0) return fail('qty', '不能小于 0');
      break;
    case 'contacts':
      if (!nonEmpty('name')) return fail('name', '不能为空');
      break;
    case 'tips':
      if (!nonEmpty('title')) return fail('title', '不能为空');
      break;
    case 'journal_entries':
      if (row.mood && [...row.mood].length > 16) return fail('mood', '最多 16 个字符');
      break;
    case 'reviews':
      if (row.rating !== null && row.rating !== undefined && (row.rating < 1 || row.rating > 5)) return fail('rating', '只能是 1–5');
      break;
    case 'expenses':
      if (row.currency && !ISO_CUR.test(row.currency)) return fail('currency', '要写 ISO 代码（如 VND）');
      if (row.home_currency && !ISO_CUR.test(row.home_currency)) return fail('home_currency', '要写 ISO 代码');
      if (row.amount === null || row.amount === undefined) return fail('amount', '不能为空');
      if (!row.currency) return fail('currency', '不能为空');
      break;
    default:
      break;
  }
  return null;
}

/** validateRow 的抛错版本 */
export function assertValidRow(table, row) {
  const p = validateRow(table, row);
  if (p) throw new DataError(p.message, { kind: 'validation', field: p.field });
}

/**
 * 从后台来的行（查询结果、实时推送、写入返回）统一写法后冻结：
 * 时间戳统一成 'YYYY-MM-DDTHH:MM:SS+00:00' 这类写法，time 统一成 'HH:MM:SS'，numeric 是数字。
 * 实时推送和 PostgREST 的写法偶有差别，统一后页面和比较逻辑只需要认一种。
 */
export function normalizeIncomingRow(table, row) {
  const def = TABLES[table];
  if (!def || !row || typeof row !== 'object') return row;
  let out = null;
  for (const [name, c] of Object.entries(def.columns)) {
    const v = row[name];
    if (v === null || v === undefined) continue;
    let nv = v;
    if (c.type === 'timestamptz' && typeof v === 'string') nv = normalizeTimestamptz(v);
    else if (c.type === 'time' && typeof v === 'string') {
      try {
        nv = normalizeTime(v);
      } catch {
        nv = v;
      }
    } else if ((c.type === 'numeric' || c.type === 'double precision' || c.type === 'integer' || c.type === 'smallint') && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      nv = Number(v);
    }
    if (nv !== v) {
      if (!out) out = { ...row };
      out[name] = nv;
    }
  }
  return Object.freeze(out || { ...row });
}

/**
 * 写入前的值规范化：time → 'HH:MM:SS'；币种转大写；时间戳统一写法。
 * 返回新对象，不改入参。
 */
export function normalizeValues(table, values) {
  const def = TABLES[table];
  const out = { ...values };
  for (const [name, v] of Object.entries(out)) {
    const c = def.columns[name];
    if (!c || v === null || v === undefined) continue;
    if (c.type === 'time') {
      try {
        out[name] = normalizeTime(v);
      } catch {
        /* 留给校验报错 */
      }
    } else if (c.type === 'timestamptz' && typeof v === 'string') {
      out[name] = v.trim();
    } else if (/currency$/.test(name) && typeof v === 'string') {
      out[name] = v.trim().toUpperCase();
    } else if ((c.type === 'numeric' || c.type === 'double precision') && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      out[name] = Number(v);
    }
  }
  return out;
}
