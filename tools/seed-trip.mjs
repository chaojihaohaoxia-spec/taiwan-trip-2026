#!/usr/bin/env node
// =====================================================================
// seed-trip.mjs：把一个行程 JSON 文件导入（upsert）到 Supabase。
//
// 用法：
//   node tools/seed-trip.mjs <行程.json> [选项]
//
// 选项：
//   --dry-run           只校验并打印将要写入的表和行数，不读钥匙串、不连网
//   --ids               和 --dry-run 一起用：再打印每个 key 对应的 uuid
//   --print-sql         打印将要执行的 SQL（含行程内容，注意别贴到公开的地方），不连网
//   --only-new          只新增，不更新已存在的行（保护在 App 里改过的内容）
//   --only-keys <k,k>   只写入这几个 key 的行（整份文件照常校验，行程本身和成员不写）
//   --yes               不再询问确认，直接写入
//   --project-ref <ref> 目标项目，默认 vzybjxghnoyubzdhvmsl
//
// 文件格式、ID 规则见 docs/数据结构.md「B. 行程 JSON 文件格式」。
//
// 写入方式：Supabase Management API
//   POST https://api.supabase.com/v1/projects/{ref}/database/query
// 整个导入是一条 SQL 语句（多个 INSERT ... ON CONFLICT 组成的 WITH），
// 在一个事务里完成：要么全部写入，要么一行都不写。外键在语句结束时统一检查。
//
// 访问令牌：运行时从 macOS 钥匙串读取（supabase login 存进去的那一条），
// 只放在内存里，不打印、不写文件。
//
// 字段语义：
//   * JSON 里写了的字段才会写入/覆盖；没写的字段，新建时用数据库默认值，
//     更新时保持数据库里现有的值（包括别人在 App 里改过的）。
//   * 写成 null 表示清空该字段。
//   * 内容完全没变的行不会被更新（不会触发 updated_at 和实时推送）。
//   * 脚本只增改，不删除任何行。
// =====================================================================

import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------

const DEFAULT_PROJECT_REF = 'vzybjxghnoyubzdhvmsl';

// 内容数据 uuid 的命名空间。改了它，所有导入过的行都会变成新 id，绝对不要改。
// uuid = uuidv5(ID_NAMESPACE, `${trip_id}:${key}`)，例如 'demo2026:item:d1-0930'
export const ID_NAMESPACE = '957721cc-f32b-40b9-9d10-9094b1778228';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PREFIXES = ['segment', 'place', 'day', 'item', 'booking', 'contact', 'todo', 'tip', 'journal', 'review', 'expense'];
const KEY_RE = new RegExp(`^(${KEY_PREFIXES.join('|')}):[a-z0-9][a-z0-9._-]{0,79}$`);
const USER_REF_RE = /^@([a-z0-9][a-z0-9_-]{0,31})$/;
const TRIP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const TSTZ_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const CUR_RE = /^[A-Z]{3}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------
// 表结构登记：JSON 能写哪些字段、类型、必填、枚举。
//   类型：id（本表 key 或 uuid）、fk:<前缀>（引用别的表的 key 或 uuid）、
//         user（uuid 或 "@ref"）、text、int、num、bool、date、time、tstz、
//         tz（IANA 时区）、cur（ISO 币种）、hex（#RRGGBB）、text[]、
//         obj（JSON 对象）、arr（JSON 数组）、objnull（对象或 null）
//   末尾带 ! 表示数据库里 NOT NULL（可以不写，写了就不能是 null）
// ---------------------------------------------------------------------

const ENUMS = {
  'trips.status': ['planning', 'ready', 'done', 'archived'],
  'members.role': ['owner', 'editor', 'viewer'],
  'places.kind': ['sight', 'food', 'cafe', 'bar', 'hotel', 'hub', 'shop', 'market', 'beach', 'activity', 'other'],
  'places.coord_precision': ['exact', 'approximate', 'city'],
  'bookings.kind': ['flight', 'hotel', 'activity', 'transfer', 'restaurant', 'ticket', 'car_rental', 'insurance', 'other'],
  'bookings.status': ['idea', 'pending', 'booked', 'cancelled'],
  'bookings.payment_status': ['unpaid', 'paid', 'partial', 'pay_at_property', 'free', 'refunded'],
  'days.pace': ['relaxed', 'medium', 'packed'],
  'days.planning_status': ['planned', 'partial', 'tbd'],
  'items.kind': ['flight', 'transport', 'hotel', 'food', 'cafe', 'sight', 'beach', 'activity', 'spa',
    'shopping', 'night_market', 'sunset', 'walk_route', 'free', 'other'],
  'items.status': ['planned', 'done', 'skipped'],
  'items.variant': ['primary', 'backup', 'rain'],
  'contacts.category': ['hotel', 'transport', 'activity', 'restaurant', 'airline', 'platform', 'guide', 'emergency', 'other'],
  'todos.list': ['confirm', 'packing', 'todo', 'buy'],
  'tips.kind': ['warning', 'tip', 'template', 'phrase', 'info'],
  'expenses.category': ['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他'],
};

const COMMON = { extra: 'obj!', created_by: 'user' };

// 顺序就是外键顺序（被引用的在前）
const TABLES = {
  segments: {
    prefix: 'segment', sort: { col: 'sort' }, required: ['id', 'name'],
    cols: {
      id: 'id', sort: 'int!', name: 'text!', name_en: 'text', start_date: 'date', end_date: 'date',
      center_lat: 'num', center_lng: 'num', timezone: 'tz', intro: 'text', tags: 'text[]!', accent: 'hex',
      icon: 'text', ...COMMON,
    },
  },
  places: {
    prefix: 'place', required: ['id', 'name'],
    cols: {
      id: 'id', segment_id: 'fk:segment', name: 'text!', name_local: 'text', name_en: 'text',
      aliases: 'text[]!', kind: 'enum!', lat: 'num', lng: 'num', coord_precision: 'enum!',
      address: 'text', phone: 'text', maps_url: 'text', google_place_id: 'text', opening_hours: 'text',
      description: 'text', links: 'arr!', tags: 'text[]!', wishlist: 'bool!', ...COMMON,
    },
  },
  bookings: {
    prefix: 'booking', sort: { col: 'sort' }, required: ['id', 'kind', 'title'],
    cols: {
      id: 'id', kind: 'enum!', title: 'text!', provider: 'text', confirmation_code: 'text', status: 'enum!',
      start_at: 'tstz', end_at: 'tstz', start_tz: 'tz', end_tz: 'tz', place_id: 'fk:place',
      price_amount: 'num', price_currency: 'cur', payment_status: 'enum!', paid_amount: 'num',
      paid_by_user_id: 'user', payment_method: 'text', free_cancel_until: 'tstz', attachments: 'arr!',
      links: 'arr!', details: 'obj!', notes: 'text', sort: 'int!', ...COMMON,
    },
  },
  days: {
    prefix: 'day', required: ['id', 'date'],
    cols: {
      id: 'id', date: 'date!', segment_id: 'fk:segment', title: 'text!', summary: 'text', pace: 'enum',
      planning_status: 'enum!', stay_booking_id: 'fk:booking', route_plan: 'objnull', decisions: 'arr!',
      icon: 'text', ...COMMON,
    },
  },
  items: {
    prefix: 'item', sort: { col: 'sort_key', groupBy: 'day_id' }, required: ['id', 'title'],
    cols: {
      id: 'id', day_id: 'fk:day', sort_key: 'num!', start_time: 'time', end_time: 'time', time_label: 'text',
      kind: 'enum!', title: 'text!', description: 'text', place_id: 'fk:place', transport_in: 'objnull',
      booking_id: 'fk:booking', cost_estimate: 'objnull', links: 'arr!', tags: 'text[]!', status: 'enum!',
      actual_time: 'time', actual_note: 'text', variant: 'enum!', parent_item_id: 'fk:item', stops: 'arr!',
      deleted_at: 'tstz', legacy_id: 'text', ...COMMON,
    },
  },
  contacts: {
    prefix: 'contact', sort: { col: 'sort' }, required: ['id', 'name'],
    cols: {
      id: 'id', name: 'text!', category: 'enum!', role: 'text', phone: 'text', whatsapp: 'text', zalo: 'text',
      line: 'text', wechat: 'text', email: 'text', booking_id: 'fk:booking', place_id: 'fk:place',
      note: 'text', sort: 'int!', ...COMMON,
    },
  },
  todos: {
    prefix: 'todo', sort: { col: 'sort', groupBy: 'list' }, required: ['id', 'list', 'title'],
    cols: {
      id: 'id', list: 'enum!', title: 'text!', category: 'text', note: 'text', qty: 'int', done: 'bool!',
      done_by: 'user', done_at: 'tstz', due_at: 'tstz', day_id: 'fk:day', booking_id: 'fk:booking',
      item_id: 'fk:item', assignee_user_id: 'user', sort: 'int!', ...COMMON,
    },
  },
  tips: {
    prefix: 'tip', sort: { col: 'sort' }, required: ['id', 'title'],
    cols: {
      id: 'id', kind: 'enum!', title: 'text!', body: 'text!', local_text: 'text', local_lang: 'text',
      segment_id: 'fk:segment', day_id: 'fk:day', place_id: 'fk:place', booking_id: 'fk:booking',
      pinned: 'bool!', tags: 'text[]!', sort: 'int!', ...COMMON,
    },
  },
  journal_entries: {
    prefix: 'journal', required: ['id', 'day_id', 'user_id'],
    cols: {
      id: 'id', day_id: 'fk:day', user_id: 'user', mood: 'text', body: 'text!', photos: 'arr!', extra: 'obj!',
    },
  },
  reviews: {
    prefix: 'review', required: ['id', 'place_id', 'user_id'],
    cols: {
      id: 'id', place_id: 'fk:place', item_id: 'fk:item', user_id: 'user', rating: 'int', notes: 'text',
      food_log: 'arr!', shop_log: 'arr!', photos: 'arr!', visited_at: 'tstz', extra: 'obj!',
    },
  },
  expenses: {
    prefix: 'expense', required: ['id', 'amount', 'currency'],
    cols: {
      id: 'id', date: 'date', category: 'enum', description: 'text', amount: 'num', currency: 'cur',
      amount_home: 'num', home_currency: 'cur', fx_rate: 'num', paid_by_user_id: 'user', split: 'obj!',
      item_id: 'fk:item', booking_id: 'fk:booking', receipt_path: 'text', deleted_at: 'tstz', ...COMMON,
    },
  },
};

const TRIP_COLS = {
  id: 'tripid', title: 'text!', subtitle: 'text', description: 'text', cover_emoji: 'text',
  start_date: 'date', end_date: 'date', timezone: 'tz!', home_currency: 'cur!', local_currency: 'cur',
  cover: 'obj!', status: 'enum!', sort: 'int!', owner_id: 'user', extra: 'obj!',
};

const MEMBER_COLS = { ref: 'text!', email: 'text', user_id: 'uuid', role: 'enum!', display_name: 'text', color: 'hex' };

const TOP_KEYS = ['trip', 'members', ...Object.keys(TABLES)];

// ---------------------------------------------------------------------
// uuid v5（RFC 4122，SHA-1）
// ---------------------------------------------------------------------

export function uuidv5(name, namespace = ID_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------
// 校验与转换
// ---------------------------------------------------------------------

class Problems {
  constructor() { this.errors = []; this.warnings = []; }
  error(where, msg) { this.errors.push(`${where}：${msg}`); }
  warn(where, msg) { this.warnings.push(`${where}：${msg}`); }
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidTimezone(tz) {
  if (!/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// 去掉以 _ 开头的注释字段
function stripComments(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

function checkValue(p, where, col, type, value, enumKey, members) {
  const base = type.replace(/!$/, '');
  const notNull = type.endsWith('!');
  if (value === null) {
    if (notNull) p.error(where, `${col} 不能是 null（不想写就整个字段省略）`);
    return;
  }
  const fail = expect => p.error(where, `${col} 应为 ${expect}，实际是 ${JSON.stringify(value).slice(0, 80)}`);
  switch (base) {
    case 'text': if (typeof value !== 'string') fail('字符串'); break;
    case 'int': if (!Number.isInteger(value)) fail('整数'); break;
    case 'num': if (typeof value !== 'number' || !Number.isFinite(value)) fail('数字（不要加引号）'); break;
    case 'bool': if (typeof value !== 'boolean') fail('true / false'); break;
    case 'date': if (typeof value !== 'string' || !isValidDate(value)) fail('日期 YYYY-MM-DD'); break;
    case 'time': if (typeof value !== 'string' || !TIME_RE.test(value)) fail('时间 HH:MM（24 小时制）'); break;
    case 'tstz': if (typeof value !== 'string' || !TSTZ_RE.test(value)) fail('带时区偏移的时间，如 2027-01-10T10:35:00+07:00'); break;
    case 'tz': if (typeof value !== 'string' || !isValidTimezone(value)) fail('IANA 时区名，如 Asia/Ho_Chi_Minh'); break;
    case 'cur':
      if (typeof value !== 'string' || !CUR_RE.test(value)) fail('ISO 币种代码，如 HKD / VND / CNY');
      else if (value === 'NTD' || value === 'RMB') p.error(where, `${col} 用 ISO 代码：NTD 写 TWD，RMB 写 CNY`);
      break;
    case 'hex': if (typeof value !== 'string' || !HEX_RE.test(value)) fail('颜色 #RRGGBB'); break;
    case 'uuid': if (typeof value !== 'string' || !UUID_RE.test(value)) fail('uuid'); break;
    case 'text[]': if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) fail('字符串数组'); break;
    case 'obj': if (!isPlainObject(value)) fail('JSON 对象 {...}'); break;
    case 'objnull': if (!isPlainObject(value)) fail('JSON 对象 {...} 或 null'); break;
    case 'arr': if (!Array.isArray(value)) fail('JSON 数组 [...]'); break;
    case 'enum': {
      const allowed = ENUMS[enumKey];
      if (!allowed.includes(value)) p.error(where, `${col} 只能是 ${allowed.join(' / ')}，实际是 ${JSON.stringify(value)}`);
      break;
    }
    case 'user': {
      if (typeof value !== 'string') { fail('用户 uuid 或 "@成员ref"'); break; }
      const m = USER_REF_RE.exec(value);
      if (m) { if (!members.has(m[1])) p.error(where, `${col} 引用的成员 @${m[1]} 没有在 members 里定义`); }
      else if (!UUID_RE.test(value)) fail('用户 uuid 或 "@成员ref"');
      break;
    }
    default: break; // id / fk 另行处理
  }
}

// 把 key 或 uuid 转成 uuid
function toUuid(tripId, value) {
  return UUID_RE.test(value) ? value.toLowerCase() : uuidv5(`${tripId}:${value}`);
}

// 在 JSON 字段内部，把名字以 _id 结尾（不含 user_id）且值是 key 的属性换成 uuid
function resolveNestedKeys(p, where, tripId, node, definedKeys, members, trail) {
  if (Array.isArray(node)) {
    return node.map((v, i) => resolveNestedKeys(p, where, tripId, v, definedKeys, members, `${trail}[${i}]`));
  }
  if (isPlainObject(node)) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const here = `${trail}.${k}`;
      if (typeof v === 'string' && k.endsWith('_id') && !k.endsWith('user_id') && KEY_RE.test(v)) {
        if (!definedKeys.has(v)) p.error(where, `${here} 引用的 ${v} 在文件里不存在`);
        out[k] = uuidv5(`${tripId}:${v}`);
      } else {
        if (typeof v === 'string') {
          const m = USER_REF_RE.exec(v);
          if (m && !members.has(m[1])) p.warn(where, `${here} 的 "@${m[1]}" 不是已定义的成员，会原样保留为文字`);
        }
        out[k] = resolveNestedKeys(p, where, tripId, v, definedKeys, members, here);
      }
    }
    return out;
  }
  return node;
}

// 对常用 JSON 结构做轻量检查（只给警告，不阻止导入）
function lintNested(p, where, table, row) {
  const money = (v, at) => {
    if (v == null) return;
    if (!isPlainObject(v) || typeof v.amount !== 'number' || typeof v.currency !== 'string' || !CUR_RE.test(v.currency)) {
      p.warn(where, `${at} 应为 {"amount": 数字, "currency": "ISO"}`);
    }
  };
  const links = (v, at) => {
    if (!Array.isArray(v)) return;
    v.forEach((l, i) => {
      if (!isPlainObject(l) || typeof l.url !== 'string' || typeof l.label !== 'string') p.warn(where, `${at}[${i}] 应为 {"label": "...", "url": "..."}`);
    });
  };
  if ('links' in row) links(row.links, 'links');
  if (table === 'items') {
    const t = row.transport_in;
    if (isPlainObject(t)) {
      if ('options' in t && !Array.isArray(t.options)) p.warn(where, 'transport_in.options 应为数组');
      (Array.isArray(t.options) ? t.options : []).forEach((o, i) => {
        const modes = ['walk', 'metro', 'bus', 'taxi', 'grab', 'scooter', 'bicycle', 'ferry', 'train', 'hsr', 'flight', 'car', 'cable_car', 'other'];
        if (!isPlainObject(o) || !modes.includes(o.mode)) p.warn(where, `transport_in.options[${i}].mode 应为 ${modes.join(' / ')}`);
        else if (o.cost) money(o.cost, `transport_in.options[${i}].cost`);
      });
    }
    const c = row.cost_estimate;
    if (isPlainObject(c)) {
      money({ amount: c.amount, currency: c.currency }, 'cost_estimate');
      if (c.per != null && !['person', 'total'].includes(c.per)) p.warn(where, 'cost_estimate.per 应为 person / total');
    }
    if (row.parent_item_id && (row.variant ?? 'primary') === 'primary') p.error(where, '有 parent_item_id 的条目，variant 必须是 backup 或 rain');
  }
  if (table === 'bookings' && isPlainObject(row.details)) {
    const d = row.details;
    if (row.kind === 'flight') {
      for (const f of ['flight_no', 'from_iata', 'to_iata']) if (!d[f]) p.warn(where, `航班 details 建议写 ${f}`);
    }
    if (row.kind === 'hotel' && d.nights != null && !Number.isInteger(d.nights)) p.warn(where, 'details.nights 应为整数');
  }
  if (table === 'places' && ('lat' in row || 'lng' in row) && ((row.lat == null) !== (row.lng == null))) {
    p.error(where, 'lat 和 lng 要么都写，要么都不写');
  }
  if (table === 'bookings' && row.price_amount != null && !row.price_currency) p.error(where, '写了 price_amount 就要写 price_currency');
}

function buildPlan(doc) {
  const p = new Problems();
  if (!isPlainObject(doc)) { p.error('文件', '顶层必须是 JSON 对象'); return { p }; }
  doc = stripComments(doc);
  for (const k of Object.keys(doc)) if (!TOP_KEYS.includes(k)) p.error('文件', `不认识的顶层字段 "${k}"（允许：${TOP_KEYS.join(', ')}；以 _ 开头的字段会被忽略）`);

  // ---- trip
  if (!isPlainObject(doc.trip)) { p.error('trip', '缺少 trip 对象'); return { p }; }
  const trip = stripComments(doc.trip);
  const tripId = trip.id;
  if (typeof tripId !== 'string' || !TRIP_ID_RE.test(tripId)) {
    p.error('trip', 'id 必须是 2–40 位小写字母、数字、- 或 _，例如 demo2026');
    return { p };
  }

  // ---- members
  const members = new Map();
  const memberRows = [];
  if (doc.members != null) {
    if (!Array.isArray(doc.members)) p.error('members', '应为数组');
    else doc.members.forEach((raw, i) => {
      const where = `members[${i}]`;
      if (!isPlainObject(raw)) { p.error(where, '应为对象'); return; }
      const m = stripComments(raw);
      for (const k of Object.keys(m)) if (!(k in MEMBER_COLS)) p.error(where, `不认识的字段 "${k}"`);
      for (const [col, type] of Object.entries(MEMBER_COLS)) {
        if (col in m) checkValue(p, where, col, type, m[col], `members.${col}`, members);
      }
      if (typeof m.ref !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(m.ref)) p.error(where, 'ref 必填，小写字母数字，例如 "jeremy"');
      else if (members.has(m.ref)) p.error(where, `ref "${m.ref}" 重复`);
      if (!m.role) p.error(where, 'role 必填');
      if (!m.email && !m.user_id) p.error(where, 'email 和 user_id 至少写一个');
      if (typeof m.ref === 'string') members.set(m.ref, true);
      memberRows.push({
        ref: m.ref, email: m.email ?? null, user_id: m.user_id ?? null, role: m.role,
        display_name: m.display_name ?? null, color: m.color ?? null,
      });
    });
  }

  for (const k of Object.keys(trip)) if (!(k in TRIP_COLS)) p.error('trip', `不认识的字段 "${k}"`);
  for (const [col, type] of Object.entries(TRIP_COLS)) {
    if (col in trip && col !== 'id') checkValue(p, 'trip', col, type, trip[col], `trips.${col}`, members);
  }
  if (typeof trip.title !== 'string' || !trip.title.trim()) p.error('trip', 'title 必填');
  if (trip.start_date && trip.end_date && trip.end_date < trip.start_date) p.error('trip', 'end_date 早于 start_date');

  // ---- 先收集所有已定义的 key
  const definedKeys = new Set();
  for (const [table, def] of Object.entries(TABLES)) {
    const rows = doc[table];
    if (rows == null) continue;
    if (!Array.isArray(rows)) { p.error(table, '应为数组'); continue; }
    rows.forEach((r, i) => {
      if (!isPlainObject(r)) return;
      const id = r.id;
      if (typeof id === 'string' && KEY_RE.test(id)) {
        if (!id.startsWith(`${def.prefix}:`)) p.error(`${table}[${i}]`, `id "${id}" 的前缀应为 ${def.prefix}:`);
        if (definedKeys.has(id)) p.error(`${table}[${i}]`, `id "${id}" 重复`);
        definedKeys.add(id);
      }
    });
  }

  // ---- 各表行
  const tables = {};
  for (const [table, def] of Object.entries(TABLES)) {
    const rows = doc[table];
    if (!Array.isArray(rows)) continue;
    const out = [];
    const seen = new Set();
    rows.forEach((raw, i) => {
      const where = `${table}[${i}]${raw && raw.id ? `（${raw.id}）` : ''}`;
      if (!isPlainObject(raw)) { p.error(where, '应为对象'); return; }
      const r = stripComments(raw);
      if ('trip_id' in r) {
        if (r.trip_id !== tripId) p.error(where, `trip_id 和 trip.id 不一致`);
        delete r.trip_id;
      }
      for (const k of Object.keys(r)) {
        if (!(k in def.cols)) p.error(where, `不认识的字段 "${k}"（拼写？导入时不能写的字段：created_at、updated_at、updated_by、currency_iso）`);
      }
      for (const col of def.required) if (r[col] == null) p.error(where, `${col} 必填`);
      const row = {};
      for (const [col, type] of Object.entries(def.cols)) {
        if (!(col in r)) continue;
        const v = r[col];
        if (type === 'id') {
          if (typeof v !== 'string' || !(KEY_RE.test(v) || UUID_RE.test(v))) {
            p.error(where, `id 应为 "${def.prefix}:名字"（小写字母、数字、. _ -）或 uuid`);
            continue;
          }
          row.id = toUuid(tripId, v);
          if (seen.has(row.id)) p.error(where, 'id 重复');
          seen.add(row.id);
        } else if (type.startsWith('fk:')) {
          if (v === null) { row[col] = null; continue; }
          const prefix = type.slice(3);
          if (typeof v !== 'string' || !(KEY_RE.test(v) || UUID_RE.test(v))) {
            p.error(where, `${col} 应为 "${prefix}:名字" 或 uuid`);
            continue;
          }
          if (KEY_RE.test(v)) {
            if (!v.startsWith(`${prefix}:`)) p.error(where, `${col} 应引用 ${prefix}:…，实际是 ${v}`);
            else if (!definedKeys.has(v)) p.error(where, `${col} 引用的 ${v} 在文件里不存在`);
          }
          row[col] = toUuid(tripId, v);
        } else {
          checkValue(p, where, col, type, v, `${table}.${col}`, members);
          row[col] = ['obj', 'obj!', 'objnull', 'arr', 'arr!'].includes(type)
            ? resolveNestedKeys(p, where, tripId, v, definedKeys, members, col)
            : v;
        }
      }
      lintNested(p, where, table, r);
      out.push(row);
    });

    // 没写排序字段的行，按 JSON 里的顺序自动编号（10、20、30…；分组表按组内顺序）
    if (def.sort) {
      const counters = new Map();
      for (const row of out) {
        const g = def.sort.groupBy ? String(row[def.sort.groupBy] ?? '') : '';
        const n = (counters.get(g) ?? 0) + 1;
        counters.set(g, n);
        if (!(def.sort.col in row)) row[def.sort.col] = n * 10;
      }
    }
    if (table === 'days') {
      const dates = new Map();
      out.forEach(row => {
        if (dates.has(row.date)) p.error('days', `日期 ${row.date} 出现了两次`);
        dates.set(row.date, true);
      });
    }
    tables[table] = out;
  }

  const tripRow = {};
  for (const col of Object.keys(TRIP_COLS)) if (col in trip) tripRow[col] = trip[col];
  if (tripRow.cover) tripRow.cover = resolveNestedKeys(p, 'trip', tripId, tripRow.cover, definedKeys, members, 'cover');

  if (!memberRows.length) p.warn('members', '没有写成员。新行程没有成员的话，登录后谁都看不到它（已有行程不受影响）');

  return { p, tripId, tripRow, memberRows, tables, definedKeys };
}

// ---------------------------------------------------------------------
// 生成 SQL
// ---------------------------------------------------------------------

function buildSql(plan, { onlyNew }) {
  const tag = `$seed_${randomBytes(6).toString('hex')}$`;
  const lit = s => {
    if (s.includes(tag)) throw new Error('数据里碰巧出现了引号标记，请重试');
    return `${tag}${s}${tag}`;
  };
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const ident = s => {
    if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`非法列名 ${s}`);
    return s;
  };

  const payload = {};
  const ctes = [];
  const report = []; // { table, rows, ctes: [] }

  // 成员：按邮箱匹配已注册用户
  ctes.push(`mem AS (
  SELECT m.ref, m.role, m.display_name, m.color,
         coalesce(m.user_id, u.id) AS user_id,
         coalesce(m.email, u.email) AS email
  FROM jsonb_to_recordset(${lit(JSON.stringify(plan.memberRows))}::jsonb)
       AS m(ref text, email text, user_id uuid, role text, display_name text, color text)
  LEFT JOIN auth.users u ON m.user_id IS NULL AND lower(u.email) = lower(m.email)
)`);

  // 一张表的一组行（这组行写了完全相同的一批字段）
  let n = 0;
  const groupCte = (table, cols, rows) => {
    const name = `w${n++}`;
    const key = `${table}#${name}`;
    payload[key] = rows;
    const colList = cols.map(ident).join(', ');
    const updatable = cols.filter(c => !['id', 'trip_id', 'created_by'].includes(c));
    let conflict;
    if (onlyNew || !updatable.length) {
      conflict = 'ON CONFLICT (id) DO NOTHING';
    } else {
      conflict = `ON CONFLICT (id) DO UPDATE SET ${updatable.map(c => `${c} = EXCLUDED.${c}`).join(', ')}
  WHERE ROW(${updatable.map(c => `t.${c}`).join(', ')}) IS DISTINCT FROM ROW(${updatable.map(c => `EXCLUDED.${c}`).join(', ')})`;
    }
    ctes.push(`${name} AS (
  INSERT INTO public.${ident(table)} AS t (${colList})
  SELECT ${colList} FROM jsonb_populate_recordset(NULL::public.${ident(table)}, (SELECT doc -> ${q(key)} FROM src))
  ${conflict}
  RETURNING (xmax = 0) AS inserted
)`);
    return name;
  };

  const tripLit = q(plan.tripId);
  // --only-keys：行程本身和成员都不写
  if (!plan.onlyKeys) {
    // trips
    const tripRow = { ...plan.tripRow };
    const tripCols = Object.keys(tripRow);
    report.push({ table: 'trips', rows: 1, ctes: [groupCte('trips', tripCols, [tripRow])] });

    // trip_members
    const memName = `w${n++}`;
    ctes.push(`${memName} AS (
  INSERT INTO public.trip_members AS t (trip_id, user_id, email, role, display_name, color)
  SELECT ${tripLit}, user_id, email, role, display_name, color FROM mem WHERE user_id IS NOT NULL
  ${onlyNew ? 'ON CONFLICT (trip_id, user_id) DO NOTHING' : `ON CONFLICT (trip_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        display_name = coalesce(EXCLUDED.display_name, t.display_name),
        color = coalesce(EXCLUDED.color, t.color),
        email = coalesce(t.email, EXCLUDED.email)
  WHERE ROW(t.role, t.display_name, t.color, t.email)
        IS DISTINCT FROM ROW(EXCLUDED.role, coalesce(EXCLUDED.display_name, t.display_name),
                             coalesce(EXCLUDED.color, t.color), coalesce(t.email, EXCLUDED.email))`}
  RETURNING (xmax = 0) AS inserted
)`);
    report.push({ table: 'trip_members', rows: plan.memberRows.length, ctes: [memName], members: true });
  }

  // 内容表：按外键顺序；同一张表按“写了哪些字段”分组
  for (const table of Object.keys(TABLES)) {
    const rows = plan.tables[table];
    if (!rows || !rows.length) continue;
    const groups = new Map();
    for (const r of rows) {
      const row = { trip_id: plan.tripId, ...r };
      const cols = Object.keys(row).sort();
      const sig = cols.join(',');
      if (!groups.has(sig)) groups.set(sig, { cols, rows: [] });
      groups.get(sig).rows.push(row);
    }
    const names = [...groups.values()].map(g => groupCte(table, g.cols, g.rows));
    report.push({ table, rows: rows.length, ctes: names });
  }

  // 把 "@ref" 换成成员的 user_id（没注册的换成 null）
  let docExpr = lit(JSON.stringify(payload));
  for (const m of plan.memberRows) {
    if (!m.ref) continue;
    docExpr = `replace(${docExpr}, ${q(`"@${m.ref}"`)}, coalesce((SELECT '"' || user_id::text || '"' FROM mem WHERE ref = ${q(m.ref)}), 'null'))`;
  }
  ctes.splice(1, 0, `src AS (
  SELECT (${docExpr})::jsonb AS doc
)`);

  const count = (names, cond) => names.map(c => `(SELECT count(*) FROM ${c} WHERE ${cond})`).join(' + ');
  const tablesJson = report.map(r => `jsonb_build_object('table', ${q(r.table)}, 'rows', ${r.rows}, 'inserted', ${count(r.ctes, 'inserted')}, 'updated', ${count(r.ctes, 'NOT inserted')})`);

  return `-- seed-trip.mjs 生成：行程 ${plan.tripId}${onlyNew ? '（只新增）' : ''}
WITH
${ctes.join(',\n')}
SELECT jsonb_build_object(
  'trip_id', ${tripLit},
  'tables', jsonb_build_array(
    ${tablesJson.join(',\n    ')}
  ),
  'unresolved_members', (SELECT coalesce(jsonb_agg(ref ORDER BY ref), '[]'::jsonb) FROM mem WHERE user_id IS NULL)
) AS report;
`;
}

// ---------------------------------------------------------------------
// 访问令牌（钥匙串）与 Management API
// ---------------------------------------------------------------------

function readAccessToken() {
  let raw;
  try {
    raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('从钥匙串读取 Supabase 访问令牌失败。先在终端运行 supabase login，再重试。');
  }
  const PREFIX = 'go-keyring-base64:';
  if (raw.startsWith(PREFIX)) raw = Buffer.from(raw.slice(PREFIX.length), 'base64').toString('utf8').trim();
  if (!/^sbp_[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error('钥匙串里那一条看起来不是 Supabase 访问令牌（应以 sbp_ 开头）。重新运行 supabase login。');
  }
  return raw;
}

async function runQuery(projectRef, sql) {
  const token = readAccessToken();
  let res;
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
  } catch (e) {
    throw new Error(`连不上 Supabase Management API：${e.message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message ?? text; } catch { /* 原样输出 */ }
    if (res.status === 401) msg = '访问令牌无效或已过期，重新运行 supabase login。';
    throw new Error(`导入失败（HTTP ${res.status}），数据库没有任何改动：\n${String(msg).slice(0, 2000)}`);
  }
  const rows = JSON.parse(text);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.report) throw new Error(`返回结果看不懂：${text.slice(0, 500)}`);
  return row.report;
}

// ---------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { file: null, dryRun: false, ids: false, printSql: false, onlyNew: false, yes: false, projectRef: DEFAULT_PROJECT_REF };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--ids') opts.ids = true;
    else if (a === '--print-sql') opts.printSql = true;
    else if (a === '--only-new') opts.onlyNew = true;
    else if (a === '--only-keys') opts.onlyKeys = String(argv[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--project-ref') opts.projectRef = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) throw new Error(`不认识的选项 ${a}`);
    else if (!opts.file) opts.file = a;
    else throw new Error(`多余的参数 ${a}`);
  }
  return opts;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// --only-keys：整份文件校验完以后，只留下这几个 key 的行
function restrictPlan(plan, keys) {
  const bad = keys.filter(k => !plan.definedKeys.has(k));
  if (bad.length) throw new Error(`--only-keys 里这些 key 在文件里不存在：${bad.join(' ')}`);
  const ids = new Set(keys.map(k => toUuid(plan.tripId, k)));
  for (const t of Object.keys(plan.tables)) plan.tables[t] = plan.tables[t].filter(r => ids.has(r.id));
  plan.onlyKeys = keys;
}

function printSummary(plan, opts) {
  const rows = plan.onlyKeys ? [] : [['trips', 1], ['trip_members', plan.memberRows.length]];
  for (const t of Object.keys(TABLES)) if (plan.tables[t]?.length) rows.push([t, plan.tables[t].length]);
  console.log(`行程 ${plan.tripId}（${plan.tripRow.title ?? ''}）将写入：`);
  for (const [t, c] of rows) console.log(`  ${t.padEnd(16)} ${String(c).padStart(4)} 行`);
  if (plan.onlyKeys) console.log(`  只写这些 key：${plan.onlyKeys.join(' ')}（行程本身和成员不动）`);
  else if (plan.memberRows.length) console.log(`  成员按邮箱匹配已注册用户：${plan.memberRows.map(m => '@' + m.ref).join(' ')}（没注册的会跳过，"@ref" 写成 null）`);
  if (opts.ids) {
    console.log('\nkey → uuid：');
    for (const k of [...plan.definedKeys].sort()) console.log(`  ${k.padEnd(40)} ${uuidv5(`${plan.tripId}:${k}`)}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.file) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 17).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opts.help ? 0 : 1);
  }
  if (!/^[a-z]{20}$/.test(opts.projectRef || '')) throw new Error('--project-ref 应为 20 位小写字母');

  const file = path.resolve(opts.file);
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`读不了 JSON 文件 ${file}：${e.message}`); }
  if (JSON.stringify(doc).includes('\\u0000')) throw new Error('数据里有 \\u0000 字符，Postgres 不接受');

  const inRepo = isInside(realpathSync(file), realpathSync(REPO_ROOT));

  const plan = buildPlan(doc);
  for (const w of plan.p.warnings) console.warn(`提醒  ${w}`);
  if (plan.p.errors.length) {
    for (const e of plan.p.errors) console.error(`错误  ${e}`);
    console.error(`\n共 ${plan.p.errors.length} 处错误，没有写入任何数据。`);
    process.exit(1);
  }
  if (opts.onlyKeys) restrictPlan(plan, opts.onlyKeys);

  if (opts.printSql) {
    process.stdout.write(buildSql(plan, opts));
    return;
  }

  printSummary(plan, opts);
  if (inRepo) console.warn('\n注意：这个 JSON 文件在仓库里面。仓库是公开的，行程数据只能放在仓库外（例如 ../行程数据/）。');
  if (opts.dryRun) {
    console.log('\n（dry-run：没有读钥匙串，也没有连网）');
    return;
  }
  if (inRepo) throw new Error('拒绝从仓库内的文件导入。把它移到仓库外再运行。');

  const sql = buildSql(plan, opts);
  if (!opts.yes) {
    if (!process.stdin.isTTY) throw new Error('非交互环境请加 --yes 确认写入');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n写入项目 ${opts.projectRef}${opts.onlyNew ? '（只新增）' : ''}？输入 yes 继续：`);
    rl.close();
    if (answer.trim() !== 'yes') { console.log('已取消，没有写入。'); return; }
  }

  const report = await runQuery(opts.projectRef, sql);
  console.log(`\n导入完成（一个事务）：行程 ${report.trip_id}`);
  for (const t of report.tables) {
    const unchanged = t.rows - t.inserted - t.updated;
    console.log(`  ${t.table.padEnd(16)} 新增 ${String(t.inserted).padStart(4)}  更新 ${String(t.updated).padStart(4)}  未变 ${String(unchanged).padStart(4)}`);
  }
  if (report.unresolved_members?.length) {
    console.warn(`\n这些成员的邮箱还没注册，已跳过（引用他们的 "@ref" 写成了 null）：${report.unresolved_members.map(r => '@' + r).join(' ')}`);
    console.warn('等对方注册后再运行一次，或者让对方用邀请码加入。');
  }
}

// 被 import 时（测试）不执行
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(e => {
    console.error(`错误：${e.message}`);
    process.exit(1);
  });
}

export { buildPlan, buildSql };
