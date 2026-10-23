// =====================================================================
// supabase/tests/seed-trip.test.mjs：导入脚本 tools/seed-trip.mjs 在 PGlite 里跑（只用虚构数据「椰影岛」）。
//
//   PGLITE_DIST=<…/@electric-sql/pglite/dist> node --test supabase/tests/seed-trip.test.mjs
//
// 平台化批 A 起（critique S5）：
//   · 默认只新增：重跑导入，App 里改过的（「怎么去」、目的地档案、extra.ledger_*…）一样都不动；
//   · --update / --only-keys 才覆盖已有的行，而且 extra 合并写（JSON 里的键覆盖，App 写进去的键保留）；
//   · extra.dest 的写法按规则包检查；「怎么去」认 transfer。
// =====================================================================

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, migrationFiles, one, rows } from './helpers.mjs';
import { buildPlan, buildSql, parseArgs, uuidv5 } from '../../tools/seed-trip.mjs';

const J = '11111111-1111-4111-8111-111111111111';
const TRIP = 'demo-seed';
const doc = (over = {}) => ({
  trip: {
    id: TRIP, title: '椰影岛 · 导入测试', start_date: '2027-01-10', end_date: '2027-01-11', timezone: 'Asia/Ho_Chi_Minh',
    local_currency: 'VND', owner_id: '@jeremy',
    extra: { party_size: 2, dest: { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' } },
    ...over.trip,
  },
  members: [{ ref: 'jeremy', email: 'jeremy@example.com', role: 'owner', display_name: 'Jeremy' }],
  segments: [{ id: 'segment:isle', name: '椰影岛', start_date: '2027-01-10', end_date: '2027-01-11', extra: { dest: { region: 'VN', city: 'phu-quoc' } } }],
  places: [{ id: 'place:pier', name: '椰影岛码头', lat: 8.68, lng: 106.6 }],
  days: [{ id: 'day:d1', date: '2027-01-10', segment_id: 'segment:isle' }, { id: 'day:d2', date: '2027-01-11', segment_id: 'segment:isle' }],
  items: [{
    id: 'item:pickup', day_id: 'day:d1', kind: 'transport', title: '酒店来接', place_id: 'place:pier',
    transport_in: { options: [{ mode: 'transfer', recommended: true }] }, ...over.item,
  }],
});
const ITEM = uuidv5(`${TRIP}:item:pickup`);

let db;
before(async () => {
  db = await freshDb(migrationFiles());
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${J}', 'jeremy@example.com')`);
});

const seed = async (d, opts) => {
  const plan = buildPlan(d);
  assert.deepEqual(plan.p.errors, []);
  const res = await db.query(buildSql(plan, opts));
  return Object.fromEntries(res.rows[0].report.tables.map((t) => [t.table, `+${t.inserted}/~${t.updated}`]));
};

test('参数：默认只新增；--update、--only-keys 才覆盖；--update 和 --only-new 不能一起用', () => {
  assert.equal(parseArgs(['x.json']).onlyNew, true);
  assert.equal(parseArgs(['x.json', '--only-new']).onlyNew, true);
  assert.equal(parseArgs(['x.json', '--update']).onlyNew, false);
  assert.equal(parseArgs(['x.json', '--only-keys', 'item:a']).onlyNew, false, '点名要改的那几行照常覆盖');
  assert.equal(parseArgs(['x.json', '--only-keys', 'item:a', '--only-new']).onlyNew, true);
  assert.throws(() => parseArgs(['x.json', '--update', '--only-new']), /不能一起用/);
});

test('校验：extra.dest 按规则包检查；「怎么去」认 transfer，不认识的给提醒', () => {
  const bad = buildPlan(doc({ trip: { extra: { dest: { region: 'vn' } } } }));
  assert.ok(bad.p.errors.some((e) => /extra\.dest 写法不对/.test(e)), bad.p.errors.join('\n'));
  const badSeg = doc();
  badSeg.segments[0].extra.dest = { region: 'VN', move: 'boat' };
  assert.ok(buildPlan(badSeg).p.errors.some((e) => /segments.*extra\.dest 写法不对/.test(e)));
  assert.deepEqual(buildPlan(doc()).p.warnings.filter((w) => /transport_in/.test(w)), []);
  const rocket = buildPlan(doc({ item: { transport_in: { options: [{ mode: 'rocket' }] } } }));
  assert.ok(rocket.p.warnings.some((w) => /transport_in\.options\[0\]\.mode/.test(w)));
});

test('默认只新增：重跑导入，App 里改过的（目的地档案、extra 别的键、「怎么去」、标题）都不动', async () => {
  assert.deepEqual((await seed(doc(), { onlyNew: true })).items, '+1/~0');
  // App 里改了：档案改叫车、记账镜像关掉、「怎么去」改成打车、标题
  await db.exec(`
    UPDATE public.trips SET extra = extra || '{"ledger_mirror": false}'::jsonb || jsonb_build_object('dest', (extra -> 'dest') || '{"ride": "xanhsm"}'::jsonb) WHERE id = '${TRIP}';
    UPDATE public.items SET transport_in = '{"options":[{"mode":"taxi","recommended":true,"source":"app"}]}', title = '自己打车去' WHERE id = '${ITEM}';`);
  const rep = await seed(doc({ trip: { title: 'JSON 里改了名字' } }), { onlyNew: true });
  assert.ok(Object.values(rep).every((x) => /~0$/.test(x)), JSON.stringify(rep));
  const t = (await rows(db, 'SELECT title, extra FROM public.trips WHERE id = $1', [TRIP]))[0];
  assert.equal(t.title, '椰影岛 · 导入测试');
  assert.equal(t.extra.ledger_mirror, false);
  assert.equal(t.extra.dest.ride, 'xanhsm');
  const i = (await rows(db, 'SELECT title, transport_in FROM public.items WHERE id = $1', [ITEM]))[0];
  assert.equal(i.title, '自己打车去');
  assert.equal(i.transport_in.options[0].mode, 'taxi');
});

test('--update：JSON 里写了的覆盖，extra 合并写（App 写进去的 ledger_mirror 还在）；没变的行不更新', async () => {
  const rep = await seed(doc({ trip: { title: 'JSON 里改了名字' } }), { onlyNew: false });
  assert.equal(rep.trips, '+0/~1');
  const t = (await rows(db, 'SELECT title, extra FROM public.trips WHERE id = $1', [TRIP]))[0];
  assert.equal(t.title, 'JSON 里改了名字');
  assert.equal(t.extra.ledger_mirror, false, 'App 写进去的键保留');
  assert.deepEqual(t.extra.dest, { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride' }, 'JSON 里写了 dest：整键按 JSON');
  assert.equal(await one(db, 'SELECT transport_in -> \'options\' -> 0 ->> \'mode\' FROM public.items WHERE id = $1', [ITEM]), 'transfer', '--update 会覆盖 App 改过的字段（所以默认不这样）');
  const again = await seed(doc({ trip: { title: 'JSON 里改了名字' } }), { onlyNew: false });
  assert.ok(Object.values(again).every((x) => /~0$/.test(x)), `合并后没变化就不写：${JSON.stringify(again)}`);
  assert.deepEqual((await rows(db, "SELECT extra FROM public.segments WHERE trip_id = $1", [TRIP]))[0].extra, { dest: { region: 'VN', city: 'phu-quoc' } });
});
