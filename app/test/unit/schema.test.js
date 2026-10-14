// data/schema.js 必须和 supabase/migrations 里的 SQL 一致（列名、类型）。SQL 改了这里会失败。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES, ENUMS, columnsOf, defaultsFor, REALTIME_TABLES, CONTENT_TABLES } from '../../src/data/schema.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SQL_FILES = [
  'supabase/migrations/20260513012000_taiwan_trip_schema.sql',
  'supabase/migrations/20261011120000_v2_multi_trip.sql',
].map((f) => readFileSync(path.join(REPO, f), 'utf8').replace(/--[^\n]*/g, ''));

const TYPE_WORDS = ['double precision', 'timestamptz', 'smallint', 'integer', 'numeric', 'boolean', 'jsonb', 'text', 'uuid', 'date', 'time'];

function normType(raw) {
  const t = raw.trim().toLowerCase();
  for (const w of TYPE_WORDS) {
    if (t.startsWith(w)) return t.slice(w.length).trimStart().startsWith('[]') ? `${w}[]` : w;
  }
  return t.split(/\s/)[0];
}

/** 从两份 SQL 里收集每张表的列：{ 表名: Map(列名 → 类型) } */
function sqlColumns() {
  const out = {};
  const add = (table, col, type) => {
    out[table] ||= new Map();
    if (!out[table].has(col)) out[table].set(col, type);
  };
  for (const sql of SQL_FILES) {
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      for (const line of m[2].split('\n')) {
        const c = /^\s{2}([a-z_][a-z0-9_]*)\s+(.+?),?$/.exec(line);
        if (c) add(m[1], c[1], normType(c[2]));
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE public\.(\w+)([\s\S]*?);/g)) {
      for (const c of m[2].matchAll(/ADD COLUMN IF NOT EXISTS (\w+) ([^,\n]+)/g)) add(m[1], c[1], normType(c[2]));
    }
  }
  return out;
}

const fromSql = sqlColumns();

test('SQL 里的每张表都登记了，列名和顺序一致', () => {
  const sqlTables = Object.keys(fromSql).sort();
  assert.deepEqual(sqlTables, Object.keys(TABLES).sort());
  for (const table of sqlTables) {
    assert.deepEqual(columnsOf(table), [...fromSql[table].keys()], `${table} 的列`);
  }
});

test('列类型一致', () => {
  for (const [table, cols] of Object.entries(fromSql)) {
    for (const [col, type] of cols) {
      assert.equal(TABLES[table].columns[col].type, type, `${table}.${col}`);
    }
  }
});

test('枚举和 SQL 的 CHECK 约束一致', () => {
  const v2 = SQL_FILES[1];
  const checks = [
    ['trips.status', /status IN \(([^)]*)\)\)\$c\$\);\nSELECT pg_temp\.ensure_constraint\('public\.trips', 'trips_cover_object'/],
    ['places.kind', /places_kind_check CHECK \(kind IN \(([^)]*)\)\)/],
    ['bookings.kind', /bookings_kind_check CHECK \(kind IN \(([^)]*)\)\)/],
    ['bookings.status', /bookings_status_check CHECK \(status IN \(([^)]*)\)\)/],
    ['bookings.payment_status', /bookings_payment_status_check CHECK \(payment_status IN \(([^)]*)\)\)/],
    ['items.kind', /items_kind_check CHECK \(kind IN \(([^)]*)\)\)/],
    ['items.status', /items_status_check CHECK \(status IN \(([^)]*)\)\)/],
    ['items.variant', /items_variant_check CHECK \(variant IN \(([^)]*)\)\)/],
    ['contacts.category', /contacts_category_check CHECK \(category IN \(([^)]*)\)\)/],
    ['todos.list', /todos_list_check CHECK \(list IN \(([^)]*)\)\)/],
    ['tips.kind', /tips_kind_check CHECK \(kind IN \(([^)]*)\)\)/],
    ['days.planning_status', /days_planning_status_check CHECK \(planning_status IN \(([^)]*)\)\)/],
    ['places.coord_precision', /places_coord_precision_check CHECK \(coord_precision IN \(([^)]*)\)\)/],
  ];
  for (const [key, re] of checks) {
    const m = re.exec(v2);
    assert.ok(m, `SQL 里找不到 ${key} 的约束`);
    const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual(ENUMS[key], values, key);
  }
});

test('实时表清单和 SQL 一致', () => {
  const v2 = SQL_FILES[1];
  const from = v2.indexOf("pubname = 'supabase_realtime'");
  const block = /FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]/.exec(v2.slice(from));
  assert.ok(block, 'SQL 里找不到实时表清单');
  const list = [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...REALTIME_TABLES].sort(), [...list].sort());
});

test('defaultsFor：数据库生成的值不填、生成列不填、返回新拷贝', () => {
  const d = defaultsFor('items');
  assert.equal(d.kind, 'other');
  assert.equal(d.variant, 'primary');
  assert.deepEqual(d.links, []);
  assert.ok(!('id' in d) && !('created_at' in d) && !('created_by' in d));
  d.links.push(1);
  assert.deepEqual(defaultsFor('items').links, []);
  assert.ok(!('currency_iso' in defaultsFor('expenses')));
  for (const t of CONTENT_TABLES) assert.ok(columnsOf(t).includes('trip_id'));
});
