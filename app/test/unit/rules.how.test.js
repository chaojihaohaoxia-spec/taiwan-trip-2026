// 规则包「怎么去」（src/rules/how.js）在用例之外的几条底线，以及整个规则包的写法约束：
//   不改传入的对象、乱七八糟的输入不报错、动作键只有那几个、主按钮就是第一个、台湾 / 香港永远不出 Grab；
//   源文件只 import 规则包自己的文件、不碰 Intl / DOM / wx / 网络 / 随机数 / 当前时间、esbuild 能降到 es2015；
//   用例里没有真实行程的数据（公开仓库）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DEFAULT_REAL_DATA_DIR, REAL_DATA_FILES } from '../../scripts/lib/real-preview.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import * as rules from '../../src/rules/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(here, '../../src/rules');
const howCases = JSON.parse(readFileSync(path.join(RULES_DIR, 'cases/how.json'), 'utf8'));
const P = howCases.places;
const KEYS = ['nav', 'ride', 'driver', 'copy', 'checkin', 'pass', 'status', 'call'];
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

const profiles = Object.fromEntries(Object.keys(rules.REGIONS).map((r) => [r, rules.profileOf({ extra: { dest: { region: r } } })]));
profiles.none = rules.profileOf(null);

const items = [
  {}, { id: 'x', title: '打车去' }, { id: 'x', kind: 'transport', title: '坐机场快线' }, { id: 'x', kind: 'walk_route' },
  { id: 'x', transport_in: { options: [{ mode: 'grab' }] } }, { id: 'x', transport_in: { options: [{ mode: 'walk' }, { mode: 'taxi' }] } },
  { id: 'x', transport_in: { options: [{ mode: 'flight' }] } }, { id: 'x', transport_in: { options: [{ mode: 'transfer' }] } },
  { id: 'x', transport_in: { options: [{ mode: 'scooter' }] } }, { id: 'x', transport_in: { options: [{ mode: 'car' }] } },
  { id: 'x', transport_in: { auto: true, options: [{ mode: 'grab', recommended: true }] } }, { id: 'x', status: 'done' },
  { id: 'x', transport_in: 'garbage' }, { id: 'x', transport_in: { options: 'nope' } }, { id: 'x', title: 123 },
];
const places = Object.values(P).concat([null, {}, { lat: 'abc', lng: null }, { id: 'odd', lat: 91, lng: 200 }]);
const prevs = [null, { place: P['p-hotel'], from: 'stay' }, { place: P['p-noodle'], from: 'item', unknown: true }, { place: P['f-station'], from: 'item' }];

test('怎么去：各种组合都不报错，动作键合法，主按钮就是第一个，⋯ 里不重复', () => {
  let n = 0;
  for (const prof of Object.values(profiles)) {
    for (const item of items) {
      for (const place of places) {
        for (const prev of prevs) {
          const h = rules.howToGet(item, { place, prev, profile: prof });
          n += 1;
          for (const a of h.actions) assert.ok(KEYS.includes(a), a);
          assert.equal(new Set(h.actions).size, h.actions.length);
          assert.equal(h.primary, h.actions[0] || null);
          for (const a of h.more) assert.ok(!h.actions.includes(a), `${a} 既在一排里又在 ⋯ 里`);
          if (h.actions.includes('ride') || h.more.includes('ride')) assert.ok(h.ride && h.ride.label, '有叫车就要有 App');
          if (!place) assert.equal(h.key, 'none');
        }
      }
    }
  }
  assert.ok(n > 1000);
});

test('怎么去：台湾、香港、澳门、内地、日本、韩国永远不出 Grab', () => {
  for (const r of ['TW', 'HK', 'MO', 'CN', 'JP', 'KR']) {
    for (const item of items) {
      for (const place of places) {
        const h = rules.howToGet(item, { place, prev: prevs[1], profile: profiles[r] });
        assert.ok(!h.ride || h.ride.id !== 'grab', `${r}`);
      }
      const pa = rules.placeActions(P['p-hotel'], { profile: profiles[r] });
      assert.ok(!pa.ride || pa.ride.id !== 'grab', r);
    }
  }
});

test('怎么去：不改传入的对象（条目、地点、上一站、档案、预订都冻住再跑）', () => {
  const item = deepFreeze({ id: 'i', kind: 'flight', title: 'XX123', start_time: '09:45', transport_in: { options: [{ mode: 'walk', recommended: true }, { mode: 'grab' }] }, extra: { local_time: { tz: 'Asia/Hong_Kong' } } });
  const ctx = deepFreeze({
    place: P['p-cloud'], prev: { place: P['p-market'], from: 'item' }, profile: profiles.VN, via: P['p-cable'],
    booking: { kind: 'flight', start_at: '2026-12-10T09:45:00+07:00', start_tz: 'Asia/Ho_Chi_Minh', details: { flight_no: 'XX123' }, attachments: [{}] },
    stays: [P['p-hotel']], now: Date.parse('2026-12-10T05:00:00+07:00'),
  });
  assert.doesNotThrow(() => rules.howToGet(item, ctx));
  assert.doesNotThrow(() => rules.placeActions(P['p-hotel'], { profile: profiles.VN }));
  assert.doesNotThrow(() => rules.transportPatch(item, 'taxi'));
  assert.doesNotThrow(() => rules.transportPatch(item, 'grab'));
  assert.doesNotThrow(() => rules.profileOf(deepFreeze({ timezone: 'Asia/Taipei', extra: { dest: { region: 'TW', cities: ['taipei', { zh: '椰影岛', lat: 8.68, lng: 106.6 }] } } }), { item, place: P['p-home'] }));
  const day = deepFreeze([{ id: 'a', place_id: 'p-cafe' }, { id: 'b', place_id: 'p-market' }]);
  assert.doesNotThrow(() => rules.prevStop(day, 'b', { getPlace: (id) => P[id] }));
});

test('怎么去：每个地区的档案都能直接拿来算（越南打车、台湾公交、自驾只给导航）', () => {
  const far = rules.howToGet({ id: 'x' }, { place: P['p-north'], prev: { place: P['p-hotel'], from: 'stay' }, profile: profiles.VN });
  assert.deepEqual(far.actions, ['ride', 'driver']);
  const tw = rules.howToGet({ id: 'x' }, { place: P['p-north'], prev: { place: P['p-hotel'], from: 'stay' }, profile: profiles.TW });
  assert.deepEqual(tw.actions, ['nav', 'ride']);
  assert.equal(tw.ride.label, '叫 Uber');
  const none = rules.howToGet({ id: 'x' }, { place: P['p-north'], prev: { place: P['p-hotel'], from: 'stay' } });
  assert.deepEqual(none.actions, ['nav'], '没给档案：中性，叫不到车');
});

test('「怎么去」芯片：每种 mode 都有芯片；写回去再读出来是同一种', () => {
  for (const m of rules.MODES) {
    const chip = rules.chipOfMode(m);
    assert.ok(rules.TRANSPORT_CHIPS.some((c) => c.id === chip), m);
    const patched = rules.transportPatch({}, m);
    assert.equal(rules.transportOf({ transport_in: patched }).mode, m);
  }
  assert.equal(rules.transportChoices({}).chips[0].id, 'auto');
  assert.ok(rules.TRANSPORT_CHIPS.some((c) => c.label === '有人接'));
  assert.ok(!rules.TRANSPORT_CHIPS.some((c) => /自己骑开|飞机/.test(c.label)), '「自己骑开」改叫「自驾 / 骑车」，飞机收进「更多」');
});

// ---------------------------------------------------------------------
// 写法约束
// ---------------------------------------------------------------------

const srcFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith('.js'));

test('规则包源文件：只 import 自己目录的文件，不碰 Intl / DOM / wx / 网络 / 随机数 / 当前时间', () => {
  assert.deepEqual(srcFiles.sort(), ['currency.js', 'dest-cities.js', 'dest-data.js', 'dest-sources.js', 'dest.js', 'geo.js', 'how.js', 'index.js']);
  for (const f of srcFiles) {
    const code = readFileSync(path.join(RULES_DIR, f), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${f} import ${m[1]}`);
    for (const bad of [/\bIntl\b/, /\bwindow\b/, /\bdocument\b/, /\bwx\./, /\bfetch\(/, /Math\.random/, /Date\.now/, /new Date\(\)/, /\brequire\(/, /\.normalize\(/, /localStorage/]) {
      assert.ok(!bad.test(code), `${f} 用了 ${bad}`);
    }
    // 小程序那份是 es2015：不用更新的内置方法（esbuild 只降语法，不补方法）
    for (const bad of [/\.includes\(/, /\.padStart\(/, /\.padEnd\(/, /Object\.values\(/, /Object\.entries\(/, /Object\.fromEntries\(/, /\.flat\(/, /\.flatMap\(/, /\.at\(/, /\.matchAll\(/, /\.replaceAll\(/]) {
      assert.ok(!bad.test(code), `${f} 用了 ${bad}`);
    }
  }
});

test('规则包源文件：esbuild 能降到 es2015（CommonJS），正则不用后行断言等新写法', () => {
  for (const f of srcFiles) {
    const src = readFileSync(path.join(RULES_DIR, f), 'utf8');
    assert.doesNotThrow(() => transformSync(src, { format: 'cjs', target: 'es2015', loader: 'js' }), f);
    assert.ok(!/\(\?<[=!]/.test(src), `${f} 用了后行断言`);
    assert.ok(!/\\p\{/.test(src), `${f} 用了 \\p{}`);
  }
});

test('公开仓库：用例和规则包里没有真实行程的数据', () => {
  const dir = path.join(RULES_DIR, 'cases');
  const texts = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .concat(srcFiles.map((f) => readFileSync(path.join(RULES_DIR, f), 'utf8')));
  // 真实行程里的地点、预订（酒店、航班）、行程 id：本机有真实 JSON 时从那里读，只在内存里比、不打印具体值
  // （以前这里直接写了一串真实名字，等于把它们放进了公开仓库）
  const deny = new Set();
  const present = REAL_DATA_FILES.filter((f) => existsSync(path.join(DEFAULT_REAL_DATA_DIR, f)));
  for (const f of present) {
    const j = JSON.parse(readFileSync(path.join(DEFAULT_REAL_DATA_DIR, f), 'utf8'));
    if (j.trip?.id) deny.add(j.trip.id);
    for (const p of j.places || []) for (const n of [p.name, p.name_local, p.name_en]) if (typeof n === 'string' && n.trim().length >= 4) deny.add(n.trim());
    for (const b of j.bookings || []) {
      if (typeof b.title === 'string' && b.title.trim().length >= 6) deny.add(b.title.trim());
      for (const m of String(b.title || '').matchAll(/\b[A-Z0-9]{2}\d{2,4}\b/g)) deny.add(m[0]);   // 航班号
    }
  }
  deny.delete('南湾沙滩');   // 演示用的虚构地名「南湾」（雾港 / 茶山 / 南湾）碰巧和真实地名重名，是很普通的叫法，不算
  for (const t of texts) {
    let hits = 0;
    for (const d of deny) if (t.includes(d)) hits += 1;
    assert.equal(hits, 0, `出现了 ${hits} 个真实行程里的名字（不打印具体值）`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(t), '出现了 uuid');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(t), '出现了邮箱');
    // 电话按国际格式（+区号 号码），演示用的 +84 000 000 000 除外
    assert.ok(!/\+\d{1,3}[ -]?\d{2,4}[ -]?\d{3,4}/.test(t.replace(/\+84 000 000 000/g, '')), '出现了像电话的号码');
  }
});

test('「有人接」打给谁：司机 → 预订里写的司机电话 → 预订电话 → 挂在预订上的联系人；不退到地点电话（两端同一个顺序）', () => {
  const contacts = [
    { id: 'c-desk', booking_id: 'b1', phone: '+00 100' },
    { id: 'c-driver', phone: '+00 200' },
    { id: 'c-gone', booking_id: 'b1', phone: '+00 300', deleted_at: '2026-01-01T00:00:00Z' },
  ];
  const b = (details) => ({ id: 'b1', kind: 'transfer', place_id: 'p-hotel', details });
  assert.equal(rules.transferPhone(b({ driver_contact_id: 'c-driver', driver_phone: '+00 900', phone: '+00 800' }), { contacts }), '+00 200');
  assert.equal(rules.transferPhone(b({ driver_contact_id: 'c-driver' }), { getContact: (id) => contacts.find((c) => c.id === id) || null }), '+00 200');
  assert.equal(rules.transferPhone(b({ driver_phone: ' +00 900 ', phone: '+00 800' }), { contacts }), '+00 900');
  assert.equal(rules.transferPhone(b({ phone: '+00 800' }), { contacts }), '+00 800');
  assert.equal(rules.transferPhone(b({}), { contacts }), '+00 100');
  assert.equal(rules.transferPhone(b({}), { contacts: contacts.filter((c) => c.id !== 'c-desk') }), null, '删掉的联系人不算，也不退到地点电话');
  assert.equal(rules.transferPhone({ id: 'b2', kind: 'hotel', details: { phone: '+00 1' } }, { contacts }), null, '不是接送预订');
  assert.equal(rules.transferPhone(b({}), { contacts: new Map(contacts.map((c) => [c.id, c])).values() }), '+00 100', 'Map 的 values() 也行');
});
