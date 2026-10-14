// =====================================================================
// scripts/lib/demo-expand.mjs：把演示行程 JSON（docs B 格式）展开成“数据库里的行”。
//
// 输入：app/demo/source/*.json（和真实行程 JSON 同一种格式，用 key 写 id、"@ref" 写人）
// 输出：每张表一个数组，行的字段 = 数据库的全部列（data/schema.js），格式 = PostgREST 返回的 JSON：
//   - id：和导入脚本完全相同的 uuidv5(命名空间, "<trip_id>:<key>")；
//   - "@jeremy" 这类成员引用 → 演示用户的固定 uuid；
//   - time → 'HH:MM:SS'；timestamptz → UTC 的 '…+00:00'；
//   - 没写的列按数据库默认值补齐；created_at / updated_at 按固定规则生成（结果可重复）；
//   - 文件路径 "<trip>/@ref/<用途>/<文件名>" → "<trip>/<用户uuid>/<用途>/<uuid>.<扩展名>"，
//     并记下 uuid 文件名 → 演示文件名 的对照（演示模式据此找到本地图片）。
//
// 校验直接复用 tools/seed-trip.mjs 的 buildPlan（和正式导入同一套规则），有错误或提醒都算失败。
// =====================================================================

import { buildPlan, uuidv5 } from '../../../tools/seed-trip.mjs';
import { TABLES, columnsOf, defaultsFor } from '../../src/data/schema.js';

const USER_REF_RE = /^@([a-z0-9][a-z0-9_-]{0,31})$/;
const FILE_PURPOSES = ['journal', 'reviews', 'bookings', 'receipts', 'covers'];

/** 演示用户的固定 uuid */
export function demoUserId(ref) {
  return uuidv5(`demo-user:${ref}`);
}

/** 演示文件的固定 uuid 文件名 */
export function demoFileName(original) {
  const ext = original.includes('.') ? original.slice(original.lastIndexOf('.') + 1).toLowerCase() : 'bin';
  return `${uuidv5(`demo-file:${original}`)}.${ext}`;
}

/** 'HH:MM' → 'HH:MM:SS' */
function normTime(v) {
  if (v == null) return v;
  return /^\d{2}:\d{2}$/.test(v) ? `${v}:00` : v;
}

/** 任意带偏移的时间 → PostgREST 的 UTC 写法 '2027-01-10T03:35:00+00:00' */
export function normTimestamp(v) {
  if (v == null) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`无法解析的时间：${v}`);
  const iso = d.toISOString(); // 2027-01-10T03:35:00.000Z
  const [main, frac] = iso.slice(0, -1).split('.');
  return `${main}${frac && frac !== '000' ? `.${frac}` : ''}+00:00`;
}

function addMinutes(ts, minutes) {
  return normTimestamp(new Date(new Date(ts).getTime() + minutes * 60_000).toISOString());
}

/**
 * @param {Array<{ file: string, doc: object }>} sources
 * @param {{ currentUserRef?: string, allowWarnings?: boolean }} [options]
 *   allowWarnings：buildPlan 的“提醒”不算失败（本机真实数据预览用；演示数据必须 0 提醒）。错误永远算失败。
 */
export function expandDemo(sources, { currentUserRef = 'jeremy', allowWarnings = false } = {}) {
  const users = new Map(); // ref → user
  const files = {};
  const tables = {};
  for (const t of Object.keys(TABLES)) tables[t] = [];
  const problems = [];

  for (const { file, doc } of sources) {
    const plan = buildPlan(doc);
    for (const e of plan.p.errors) problems.push(`${file} 错误：${e}`);
    if (!allowWarnings) for (const w of plan.p.warnings) problems.push(`${file} 提醒：${w}`);
    if (plan.p.errors.length) continue;
    const tripId = plan.tripId;

    // ---- 成员 → 演示用户
    for (const m of plan.memberRows) {
      if (!users.has(m.ref)) {
        users.set(m.ref, { id: demoUserId(m.ref), ref: m.ref, email: m.email, display_name: m.display_name, color: m.color });
      }
    }
    const uid = (ref) => {
      const u = users.get(ref);
      if (!u) throw new Error(`${file}：成员 @${ref} 没有在 members 里定义`);
      return u.id;
    };

    const pathRe = new RegExp(`^${tripId.replace(/[-]/g, '\\-')}/@([a-z0-9][a-z0-9_-]{0,31})/(${FILE_PURPOSES.join('|')})/([A-Za-z0-9._-]+)$`);
    /** 深度替换："@ref" → uuid；演示文件路径 → 真实格式 */
    const resolve = (value) => {
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = resolve(v);
        return out;
      }
      if (typeof value === 'string') {
        const m = USER_REF_RE.exec(value);
        if (m) return uid(m[1]);
        const p = pathRe.exec(value);
        if (p) {
          const stored = demoFileName(p[3]);
          files[stored] = p[3];
          return `${tripId}/${uid(p[1])}/${p[2]}/${stored}`;
        }
      }
      return value;
    };

    const baseCreated = normTimestamp(doc.trip.start_date
      ? `${addDays(doc.trip.start_date, -60)}T08:00:00Z`
      : '2026-01-01T08:00:00Z');
    let tick = 0;
    const nextStamp = () => addMinutes(baseCreated, tick++);

    // ---- trips
    const tripRow = { ...defaultsFor('trips'), ...resolve(plan.tripRow) };
    tripRow.created_at = nextStamp();
    tripRow.updated_at = tripRow.created_at;
    tripRow.updated_by = null;
    tables.trips.push(orderColumns('trips', normalizeRow('trips', tripRow)));

    // ---- trip_members
    for (const m of plan.memberRows) {
      tables.trip_members.push(orderColumns('trip_members', {
        trip_id: tripId,
        user_id: uid(m.ref),
        email: m.email,
        role: m.role,
        joined_at: nextStamp(),
        display_name: m.display_name,
        color: m.color,
      }));
    }

    // ---- 内容表
    const dayDates = new Map((plan.tables.days || []).map((d) => [d.id, d.date]));
    for (const table of ['segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips',
      'journal_entries', 'reviews', 'expenses']) {
      for (const raw of plan.tables[table] || []) {
        const row = { ...defaultsFor(table), ...resolve(raw), trip_id: tripId };
        // 时间戳：行程中产生的数据用“当时”的时间，其余用行程创建后的固定递增时间
        let created;
        if (table === 'expenses' && row.date) created = normTimestamp(`${row.date}T12:00:00Z`);
        else if (table === 'journal_entries') created = normTimestamp(`${dayDates.get(row.day_id)}T14:00:00Z`);
        else if (table === 'reviews' && row.visited_at) created = addMinutes(row.visited_at, 90);
        else created = nextStamp();
        row.created_at = created;
        row.updated_at = created;
        if (table === 'todos' && row.done_at && new Date(row.done_at) > new Date(created)) row.updated_at = normTimestamp(row.done_at);
        // 作者：日记、评级是本人写的；记账是付款人记的；其余视作导入脚本写入（created_by 为空）
        const author = table === 'journal_entries' || table === 'reviews' ? row.user_id
          : table === 'expenses' ? row.paid_by_user_id ?? null
            : null;
        row.created_by = author;
        row.updated_by = author;
        if (table === 'expenses') {
          row.currency_iso = row.currency ? String(row.currency).toUpperCase() : null;
        }
        tables[table].push(orderColumns(table, normalizeRow(table, row)));
      }
    }
  }

  if (problems.length) {
    const err = new Error(`演示数据校验没通过：\n  ${problems.join('\n  ')}`);
    err.problems = problems;
    throw err;
  }

  const current = users.get(currentUserRef);
  if (!current) throw new Error(`当前演示用户 @${currentUserRef} 不存在`);

  // 文件对照按键排序，输出稳定
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { users: [...users.values()], currentUserId: current.id, files: sortedFiles, tables };
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 按列类型规范化值的写法 */
function normalizeRow(table, row) {
  const cols = TABLES[table].columns;
  for (const [name, def] of Object.entries(cols)) {
    if (!(name in row)) continue;
    if (def.type === 'time') row[name] = normTime(row[name]);
    else if (def.type === 'timestamptz') row[name] = normTimestamp(row[name]);
  }
  return row;
}

/** 按数据库列顺序输出，并检查没有多余/缺少的列 */
function orderColumns(table, row) {
  const cols = columnsOf(table);
  const extra = Object.keys(row).filter((k) => !cols.includes(k));
  if (extra.length) throw new Error(`${table} 出现了数据库里没有的列：${extra.join(', ')}`);
  const out = {};
  for (const c of cols) out[c] = row[c] === undefined ? null : row[c];
  return out;
}
