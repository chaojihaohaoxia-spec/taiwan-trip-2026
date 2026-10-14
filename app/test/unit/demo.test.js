// 演示数据（app/demo）：是最新的、每行列齐全、格式和数据库一致、引用都在同一行程里、没有真实敏感信息。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDemoDb, DEMO_DB_FILE } from '../../scripts/demo.mjs';
import { TABLES, ENUMS, columnsOf } from '../../src/data/schema.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = JSON.parse(readFileSync(DEMO_DB_FILE, 'utf8'));
const T = db.tables;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TSTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/;

test('demo-db.json 是最新的（改了 demo/source 要运行 npm run demo）', () => {
  assert.equal(readFileSync(DEMO_DB_FILE, 'utf8'), renderDemoDb());
});

test('三趟演示行程：海岛 4 天（未开始）、三城 9 天（已结束）、几乎空的 2 天（规划中）', () => {
  const trips = Object.fromEntries(T.trips.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(trips).sort(), ['demo-cities', 'demo-empty', 'demo-island']);
  const days = (id) => T.days.filter((d) => d.trip_id === id).length;
  assert.equal(days('demo-island'), 4);
  assert.equal(days('demo-cities'), 9);
  assert.equal(days('demo-empty'), 2);
  assert.equal(trips['demo-island'].timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(trips['demo-island'].local_currency, 'VND');
  assert.deepEqual([trips['demo-island'].start_date, trips['demo-island'].end_date], ['2027-01-10', '2027-01-13']);
  assert.equal(trips['demo-cities'].local_currency, 'TWD');
  assert.equal(trips['demo-cities'].status, 'done');
  assert.equal(trips['demo-empty'].status, 'planning');
});

test('空行程 demo-empty：只有行程、成员和两天，其余一行都没有（给空状态用）', () => {
  for (const [table, rows] of Object.entries(T)) {
    const n = rows.filter((r) => (table === 'trips' ? r.id : r.trip_id) === 'demo-empty').length;
    const expect = { trips: 1, trip_members: 2, days: 2 }[table] ?? 0;
    assert.equal(n, expect, `demo-empty 的 ${table}`);
  }
});

test('海岛行程照真实行程的密度：每个整天 10–15 条主方案，大多带交通和费用；备选 / 雨天（挂在条目下的、当天通用的）每天都有', () => {
  const isl = (rows) => rows.filter((r) => r.trip_id === 'demo-island');
  const days = isl(T.days).sort((a, b) => a.date.localeCompare(b.date));
  const items = isl(T.items).filter((i) => !i.deleted_at);
  for (const d of days) {
    const primary = items.filter((i) => i.day_id === d.id && i.variant === 'primary');
    assert.ok(primary.length >= 10 && primary.length <= 15, `${d.date} 有 ${primary.length} 条主方案`);
    const alts = items.filter((i) => i.day_id === d.id && i.variant !== 'primary');
    assert.ok(alts.length >= 1, `${d.date} 有备选或雨天方案`);
    assert.ok(d.route_plan && d.route_plan.stops?.length >= 2, `${d.date} 有路线规划卡`);
    assert.ok(d.decisions.length >= 1, `${d.date} 有取舍说明`);
    assert.ok(d.extra.sun?.sunset, `${d.date} 有日落时间`);
  }
  const fullDays = days.slice(1, -1).map((d) => d.id);
  const full = items.filter((i) => fullDays.includes(i.day_id) && i.variant === 'primary');
  assert.ok(full.filter((i) => i.transport_in).length / full.length >= 0.6, '整天的条目大多写了怎么过去');
  assert.ok(full.filter((i) => i.cost_estimate || i.booking_id).length / full.length >= 0.6, '整天的条目大多有费用估算或关联预订');
  const alts = items.filter((i) => i.variant !== 'primary');
  for (const v of ['backup', 'rain']) {
    assert.ok(alts.some((i) => i.variant === v && i.parent_item_id), `挂在条目下的 ${v}`);
    assert.ok(alts.some((i) => i.variant === v && !i.parent_item_id), `当天通用的 ${v}`);
  }
  assert.ok(items.some((i) => i.kind === 'walk_route' && i.stops.length >= 3), '步行路线');
  assert.ok(items.some((i) => i.day_id === null), '备选池');
  assert.ok(items.some((i) => i.status === 'done') && items.some((i) => i.status === 'skipped' && i.actual_note), '完成 / 跳过（带实际情况）');
});

test('海岛行程：预订覆盖各种状态和付款，免费取消截止相对 2027-01-08 和 2027-01-11 都有已过 / 快到 / 还早', () => {
  const b = T.bookings.filter((r) => r.trip_id === 'demo-island');
  for (const s of ['idea', 'pending', 'booked', 'cancelled']) assert.ok(b.some((r) => r.status === s), `状态 ${s}`);
  for (const s of ['unpaid', 'paid', 'partial', 'pay_at_property', 'free', 'refunded']) assert.ok(b.some((r) => r.payment_status === s), `付款 ${s}`);
  const deadlines = b.filter((r) => r.free_cancel_until && r.status !== 'cancelled').map((r) => new Date(r.free_cancel_until).getTime());
  for (const now of ['2027-01-08T10:00:00+07:00', '2027-01-11T10:00:00+07:00']) {
    const t = new Date(now).getTime();
    const h = (ms) => ms / 3_600_000;
    assert.ok(deadlines.some((d) => d < t), `${now}：有已经过了的`);
    assert.ok(deadlines.some((d) => d > t && h(d - t) <= 36), `${now}：有 36 小时内到期的`);
    if (now.startsWith('2027-01-08')) assert.ok(deadlines.some((d) => h(d - t) > 72), `${now}：有 3 天以后才到期的`);
    else assert.ok(deadlines.some((d) => h(d - t) > 24), `${now}：有一天以后才到期的`);
  }
});

test('海岛行程：清单、贴士、联系人、记账、日记、评级、地点都有足够的量和各种情况', () => {
  const isl = (rows) => rows.filter((r) => r.trip_id === 'demo-island');
  const todos = isl(T.todos);
  for (const l of ['confirm', 'packing', 'todo', 'buy']) assert.ok(todos.filter((t) => t.list === l).length >= 5, `清单 ${l}`);
  const packing = todos.filter((t) => t.list === 'packing');
  assert.ok(packing.length >= 20 && packing.every((t) => t.qty !== null && t.category), '打包都带数量和分类');
  assert.ok(packing.some((t) => t.assignee_user_id) && packing.some((t) => !t.assignee_user_id), '打包有个人的也有共用的');
  const tips = isl(T.tips);
  for (const k of ['warning', 'tip', 'template', 'phrase', 'info']) assert.ok(tips.some((t) => t.kind === k), `贴士 ${k}`);
  assert.ok(tips.some((t) => t.pinned && t.kind === 'warning'), '置顶的防坑');
  const phrases = tips.filter((t) => t.kind === 'phrase' && t.local_lang === 'vi');
  assert.ok(phrases.length >= 5 && phrases.some((t) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t.local_text)), '越南语常用语带声调');
  const contacts = isl(T.contacts);
  assert.ok(contacts.length >= 10);
  assert.ok(contacts.filter((c) => c.category === 'emergency').length >= 2, '紧急联系人');
  const expenses = isl(T.expenses).filter((e) => !e.deleted_at);
  assert.ok(expenses.length >= 10);
  for (const c of ['VND', 'HKD', 'CNY']) assert.ok(expenses.some((e) => e.currency === c), `记账币种 ${c}`);
  for (const m of ['equal', 'amounts', 'personal']) assert.ok(expenses.some((e) => e.split.mode === m), `分摊 ${m}`);
  assert.equal(new Set(expenses.map((e) => e.paid_by_user_id)).size, 2, '两个人都付过钱');
  assert.ok(isl(T.journal_entries).length >= 3);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(isl(T.reviews).some((r) => r.rating === n), `评级 ${n}`);
  const places = isl(T.places);
  assert.ok(places.length >= 28 && places.filter((p) => p.lat !== null).length >= 27, '地点 30 个左右，大多带坐标');
  assert.equal(new Set(places.map((p) => p.kind)).size, ENUMS['places.kind'].length, '每种地点类型都有');
  assert.ok(isl(T.items).some((i) => [...i.title].length >= 40), '超长标题');
  assert.ok(places.some((p) => p.address && [...p.address].length >= 100 && /[ăâđêôơư]/i.test(p.address)), '超长越南语地址');
});

test('每一行的列 = 数据库的全部列（顺序也一致），类型写法和 PostgREST 返回的一致', () => {
  for (const [table, rows] of Object.entries(T)) {
    const cols = columnsOf(table);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row), cols, `${table} 的列`);
      for (const [name, def] of Object.entries(TABLES[table].columns)) {
        const v = row[name];
        if (def.notNull && !def.generated) assert.notEqual(v, null, `${table}.${name} 不能为空`);
        if (v === null) continue;
        const where = `${table}.${name}=${JSON.stringify(v)}`;
        switch (def.type) {
          case 'uuid': assert.match(v, UUID, where); break;
          case 'timestamptz': assert.match(v, TSTZ, where); break;
          case 'date': assert.match(v, /^\d{4}-\d{2}-\d{2}$/, where); break;
          case 'time': assert.match(v, /^\d{2}:\d{2}:\d{2}$/, where); break;
          case 'integer': case 'smallint': assert.ok(Number.isInteger(v), where); break;
          case 'numeric': case 'double precision': assert.equal(typeof v, 'number', where); break;
          case 'boolean': assert.equal(typeof v, 'boolean', where); break;
          case 'text[]': assert.ok(Array.isArray(v) && v.every((x) => typeof x === 'string'), where); break;
          case 'jsonb': assert.equal(typeof v, 'object', where); break;
          case 'text': assert.equal(typeof v, 'string', where); break;
          default: assert.fail(`未知类型 ${def.type}`);
        }
      }
    }
  }
});

test('枚举取值合法', () => {
  for (const [key, values] of Object.entries(ENUMS)) {
    const [table, col] = key.split('.');
    if (!col || !T[table]) continue;
    for (const row of T[table]) {
      if (row[col] !== null) assert.ok(values.includes(row[col]), `${key}=${row[col]}`);
    }
  }
});

test('引用都指向同一个行程里存在的行（组合外键）', () => {
  const ids = {};
  for (const [table, rows] of Object.entries(T)) ids[table] = new Map(rows.map((r) => [r.id, r.trip_id]));
  const refs = {
    places: { segment_id: 'segments' },
    bookings: { place_id: 'places' },
    days: { segment_id: 'segments', stay_booking_id: 'bookings' },
    items: { day_id: 'days', place_id: 'places', booking_id: 'bookings', parent_item_id: 'items' },
    contacts: { booking_id: 'bookings', place_id: 'places' },
    todos: { day_id: 'days', booking_id: 'bookings', item_id: 'items' },
    tips: { segment_id: 'segments', day_id: 'days', place_id: 'places', booking_id: 'bookings' },
    journal_entries: { day_id: 'days' },
    reviews: { place_id: 'places', item_id: 'items' },
    expenses: { item_id: 'items', booking_id: 'bookings' },
  };
  for (const [table, map] of Object.entries(refs)) {
    for (const row of T[table]) {
      for (const [col, target] of Object.entries(map)) {
        if (row[col] === null) continue;
        assert.equal(ids[target].get(row[col]), row.trip_id, `${table}.${col} → ${target}`);
      }
    }
  }
  const users = new Set(db.users.map((u) => u.id));
  for (const m of T.trip_members) assert.ok(users.has(m.user_id));
  for (const t of T.trips) assert.ok(users.has(t.owner_id));
});

test('数据库约束：坐标成对、主方案没有父条目、日期不重复、价格有币种、每人每天一篇日记', () => {
  for (const p of T.places) assert.equal(p.lat === null, p.lng === null, p.name);
  for (const i of T.items) if (i.parent_item_id) assert.notEqual(i.variant, 'primary', i.title);
  const dayKeys = T.days.map((d) => `${d.trip_id}:${d.date}`);
  assert.equal(new Set(dayKeys).size, dayKeys.length);
  for (const b of T.bookings) {
    if (b.price_amount !== null || b.paid_amount !== null) assert.ok(b.price_currency, b.title);
    if (b.start_at && b.end_at) assert.ok(new Date(b.end_at) >= new Date(b.start_at), b.title);
  }
  const journalKeys = T.journal_entries.map((j) => `${j.day_id}:${j.user_id}`);
  assert.equal(new Set(journalKeys).size, journalKeys.length);
  const reviewKeys = T.reviews.map((r) => `${r.place_id}:${r.user_id}`);
  assert.equal(new Set(reviewKeys).size, reviewKeys.length);
  for (const r of T.reviews) if (r.rating !== null) assert.ok(r.rating >= 1 && r.rating <= 5);
});

test('记账：amount_home = amount × fx_rate（两位小数）；按金额分摊的合计等于总额', () => {
  for (const e of T.expenses) {
    assert.equal(e.currency_iso, e.currency);
    assert.equal(e.amount_home, Math.round(e.amount * e.fx_rate * 100) / 100, e.description);
    if (e.split.mode === 'amounts') {
      assert.equal(e.split.shares.reduce((s, x) => s + x.amount, 0), e.amount, e.description);
    }
    for (const legacy of ['day_id', 'amount_hkd', 'paid_by', 'split_with', 'receipt_url']) assert.equal(e[legacy], null);
  }
  assert.ok(T.expenses.some((e) => e.deleted_at), '有一条软删除的记账（测过滤用）');
});

test('覆盖各种状态，方便各模块测试界面', () => {
  const has = (table, col, value) => T[table].some((r) => r[col] === value);
  for (const s of ['idea', 'pending', 'booked', 'cancelled']) assert.ok(has('bookings', 'status', s), `预订状态 ${s}`);
  for (const s of ['unpaid', 'paid', 'partial', 'pay_at_property', 'refunded']) assert.ok(has('bookings', 'payment_status', s), `付款状态 ${s}`);
  for (const s of ['planned', 'done', 'skipped']) assert.ok(has('items', 'status', s));
  for (const v of ['primary', 'backup', 'rain']) assert.ok(has('items', 'variant', v));
  for (const l of ['confirm', 'packing', 'todo', 'buy']) assert.ok(has('todos', 'list', l));
  for (const k of ['warning', 'tip', 'template', 'phrase', 'info']) assert.ok(has('tips', 'kind', k));
  for (const n of [1, 2, 3, 4, 5]) assert.ok(has('reviews', 'rating', n), `评级 ${n}`);
  assert.ok(T.items.some((i) => i.day_id === null), '备选池条目');
  assert.ok(T.items.some((i) => i.kind === 'walk_route' && i.stops.length), '步行路线');
  assert.ok(T.days.some((d) => d.route_plan), '路线规划卡');
  assert.ok(T.places.some((p) => p.lat === null), '没有坐标的地点');
  assert.ok(T.places.some((p) => p.wishlist), '想去清单');
  assert.ok(T.todos.some((t) => t.qty === 0), '数量为 0（步进器归零）');
  for (const mode of ['equal', 'amounts', 'personal']) assert.ok(T.expenses.some((e) => e.split.mode === mode), `分摊 ${mode}`);
});

test('没有真实敏感信息：订单号都是 DEMO-、电话都是 +00 000、邮箱都是 example.com、没有证件号', () => {
  for (const b of T.bookings) if (b.confirmation_code) assert.match(b.confirmation_code, /^DEMO-[A-Z0-9]+$/);
  const phones = [...T.contacts.flatMap((c) => [c.phone, c.whatsapp, c.zalo]), ...T.places.map((p) => p.phone)].filter(Boolean);
  for (const p of phones) assert.match(p, /^\+00 000 \d{4} \d{4}$/);
  const emails = [...T.contacts.map((c) => c.email), ...T.trip_members.map((m) => m.email), ...db.users.map((u) => u.email)].filter(Boolean);
  for (const e of emails) assert.match(e, /@example\.com$/);
  for (const p of T.places) if (p.address) assert.match(p.address, /虚构地址/);
  const text = JSON.stringify(db);
  assert.doesNotMatch(text, /护照号|passport_no|身份证号|\b[A-Z]\d{8}\b/);
  // 链接只能指向 example.com
  for (const m of text.matchAll(/https?:\/\/[^"\s]+/g)) assert.match(m[0], /^https:\/\/example\.com\//, m[0]);
});

test('演示文件都存在，路径格式和真实的存储路径一致', () => {
  for (const [stored, original] of Object.entries(db.files)) {
    assert.match(stored, /^[0-9a-f-]{36}\.(jpg|pdf)$/);
    const dir = original.endsWith('.pdf') ? 'files' : 'photos';
    assert.ok(existsSync(path.join(APP, 'demo', dir, original)), original);
  }
  const paths = JSON.stringify(T).match(/"demo-(island|cities)\/[^"]+"/g) || [];
  assert.ok(paths.length > 10);
  for (const p of paths) assert.match(p, /^"demo-(island|cities)\/[0-9a-f-]{36}\/(journal|reviews|bookings|receipts|covers)\/[0-9a-f-]{36}\.(jpg|pdf)"$/);
  const index = readFileSync(path.join(APP, 'demo', 'index.js'), 'utf8');
  for (const f of readdirSync(path.join(APP, 'demo', 'photos'))) assert.ok(index.includes(f), `demo/index.js 要 import ${f}`);
});
