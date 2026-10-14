// 路由的网址解析与拼装（router/url.js、router/match.js）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, parseQuery, parseSheets, stringifySheets, stringifyQuery, buildHash, normalizePath, sameQuery, sameSheets } from '../../src/router/url.js';
import { compileRoutes, matchPath, buildPath, isRealDate, isValidParam } from '../../src/router/match.js';
import { routes, DEFAULT_PATH, LAUNCH_PATH } from '../../src/router/routes.js';

const table = compileRoutes(routes);

test('parseHash：空、根、普通路径、查询参数、弹层栈', () => {
  assert.deepEqual(parseHash(''), { kind: 'empty' });
  assert.deepEqual(parseHash('#'), { kind: 'empty' });
  assert.deepEqual(parseHash('#/'), { kind: 'empty' });
  assert.deepEqual(parseHash('#/trips'), { kind: 'route', path: '/trips', query: {}, sheets: [] });
  assert.deepEqual(parseHash('#/t/demo-island/ledger?tab=list&sheet=add-expense'), {
    kind: 'route', path: '/t/demo-island/ledger', query: { tab: 'list' }, sheets: [{ id: 'add-expense', arg: null }],
  });
  assert.deepEqual(parseHash('#/t/x//day/2027-01-10/?a=1&a=2').path, '/t/x/day/2027-01-10');
  assert.deepEqual(parseHash('#/t/x?a=1&a=2').query, { a: '2' }, '重复的键取最后一个');
});

test('parseHash：登录回调和乱写的 hash', () => {
  assert.equal(parseHash('#access_token=abc&refresh_token=def&type=magiclink').kind, 'auth-callback');
  assert.equal(parseHash('#error=access_denied&error_description=xx').kind, 'auth-callback');
  assert.equal(parseHash('#section-2').kind, 'invalid');
  assert.equal(parseHash('#foo=bar').kind, 'invalid');
});

test('弹层栈：解析、丢弃不合规则的项、拼回去', () => {
  assert.deepEqual(parseSheets('a,b:42,c:3f2a-9c'), [
    { id: 'a', arg: null }, { id: 'b', arg: '42' }, { id: 'c', arg: '3f2a-9c' },
  ]);
  assert.deepEqual(parseSheets('Bad,ok,,x:有中文,y:'), [{ id: 'ok', arg: null }], '大写 id、非法参数、空参数都丢掉');
  assert.equal(stringifySheets([{ id: 'edit-item', arg: '3f2a' }, 'confirm']), 'edit-item:3f2a,confirm');
  assert.throws(() => stringifySheets([{ id: 'Edit' }]), /不合规则/);
  assert.throws(() => stringifySheets([{ id: 'edit', arg: 'a b' }]), /不合规则/);
});

test('查询串：排序稳定、空值省略、sheet 永远在最后且逗号冒号不转义', () => {
  assert.equal(stringifyQuery({ b: '2', a: '1', empty: '', nil: null }), 'a=1&b=2');
  assert.equal(stringifyQuery({ q: '海鲜 夜市' }), 'q=%E6%B5%B7%E9%B2%9C+%E5%A4%9C%E5%B8%82');
  assert.equal(stringifyQuery({ z: '1' }, [{ id: 'a', arg: null }, { id: 'b', arg: '42' }]), 'z=1&sheet=a,b:42');
  assert.throws(() => stringifyQuery({ sheet: 'x' }), /不能直接写 sheet/);
  assert.deepEqual(parseQuery('q=%E6%B5%B7%E9%B2%9C+%E5%A4%9C%E5%B8%82').query, { q: '海鲜 夜市' });
});

test('buildHash 和 parseHash 互逆', () => {
  const cases = [
    { path: '/trips', query: {}, sheets: [] },
    { path: '/t/demo-island/ledger', query: { tab: 'stats', from: '2027-01-10' }, sheets: [{ id: 'add-expense', arg: null }] },
    { path: '/t/demo-cities/day/2026-03-15', query: { q: '牛肉面 & 夜市' }, sheets: [{ id: 'edit-item', arg: 'a9a478d9-7e2e-5cd3-8dec-d5f438c16904' }, { id: 'confirm', arg: null }] },
  ];
  for (const c of cases) {
    const hash = buildHash(c);
    const back = parseHash(hash);
    assert.equal(back.kind, 'route');
    assert.equal(back.path, c.path);
    assert.deepEqual(back.query, c.query);
    assert.deepEqual(back.sheets, c.sheets);
    assert.equal(buildHash(back), hash);
  }
});

test('normalizePath / sameQuery / sameSheets', () => {
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('trips/'), '/trips');
  assert.ok(sameQuery({ a: '1', b: '' }, { a: '1' }));
  assert.ok(!sameQuery({ a: '1' }, { a: '2' }));
  assert.ok(sameSheets([{ id: 'a', arg: null }], [{ id: 'a', arg: null }]));
  assert.ok(!sameSheets([{ id: 'a', arg: null }], [{ id: 'a', arg: '1' }]));
});

test('路由表：每条路由都能匹配，参数正确解码', () => {
  const expect = {
    '/trips': ['trips', {}],
    '/t/demo-island': ['trip', { tripId: 'demo-island' }],
    '/t/demo-island/day/2027-01-10': ['day', { tripId: 'demo-island', date: '2027-01-10' }],
    '/t/taiwan2026/map': ['map', { tripId: 'taiwan2026' }],
    '/t/demo_1/ledger': ['ledger', { tripId: 'demo_1' }],
    '/t/demo-island/bookings': ['bookings', { tripId: 'demo-island' }],
    '/t/demo-island/lists': ['lists', { tripId: 'demo-island' }],
    '/t/demo-island/journal': ['journal', { tripId: 'demo-island' }],
    '/t/demo-island/places': ['places', { tripId: 'demo-island' }],
    '/t/demo-island/tips': ['tips', { tripId: 'demo-island' }],
    '/settings': ['settings', {}],
    '/join/38S7-72Q9-FTCZ': ['join', { code: '38S7-72Q9-FTCZ' }],
    '/join/38S7%2072Q9': ['join', { code: '38S7 72Q9' }],
    '/login': ['login', {}],
    '/': ['launch', {}],
    '/t/demo-island/contacts': ['contacts', { tripId: 'demo-island' }],
  };
  for (const [p, [name, params]] of Object.entries(expect)) {
    const m = matchPath(table, p);
    assert.ok(m, `${p} 应当匹配`);
    assert.equal(m.def.name, name, p);
    assert.deepEqual(m.params, params, p);
  }
  assert.equal(DEFAULT_PATH, '/trips');
});

test('路由表：不合规则的参数匹配不上', () => {
  for (const p of ['/t/Demo/map', '/t/a/map', '/t/demo-island/day/2027-02-30', '/t/demo-island/day/20270110',
    '/t/demo-island/nope', '/trips/extra', '/t/%E0%A4%A/map', '/join/ab']) {
    assert.equal(matchPath(table, p), null, `${p} 不应匹配`);
  }
});

test('开发页只在本机开放', () => {
  assert.equal(matchPath(table, '/dev'), null);
  assert.equal(matchPath(table, '/dev/tokens'), null);
  assert.equal(matchPath(table, '/dev', { devEnabled: true }).def.name, 'dev');
  assert.deepEqual(matchPath(table, '/dev/tokens', { devEnabled: true }).params, { page: 'tokens' });
});

test('buildPath：编码、缺参数和坏参数报错', () => {
  assert.equal(buildPath(table, 'day', { tripId: 'demo-island', date: '2027-01-10' }), '/t/demo-island/day/2027-01-10');
  assert.equal(buildPath(table, 'join', { code: 'AB CD-EF' }), '/join/AB%20CD-EF');
  assert.throws(() => buildPath(table, 'day', { tripId: 'demo-island' }), /缺少参数 date/);
  assert.throws(() => buildPath(table, 'day', { tripId: 'demo-island', date: '2027-13-01' }), /不合规则/);
  assert.throws(() => buildPath(table, 'nope', {}), /没有名为/);
});

test('日期与参数校验', () => {
  assert.ok(isRealDate('2028-02-29'));
  assert.ok(!isRealDate('2027-02-29'));
  assert.ok(isValidParam('tripId', 'taiwan2026'));
  assert.ok(!isValidParam('tripId', '-bad'));
  assert.ok(!isValidParam('tripId', ''));
});

test('路由名不重复，每条路由都有中文标题（启动页 launch 除外：停留一瞬间，document.title 就是应用名）', () => {
  const names = routes.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
  for (const r of routes) {
    if (r.name === 'launch') assert.equal(r.meta.title, undefined);
    else assert.ok(/[一-龥]/.test(r.meta.title), `${r.name} 缺中文标题`);
  }
});

test('启动路由 launch 是 /（空 hash、#/）；联系人路由 contacts 在行程里、上一级是概览', () => {
  const launch = routes.find((x) => x.name === 'launch');
  assert.equal(launch.path, LAUNCH_PATH);
  assert.equal(LAUNCH_PATH, '/');
  assert.equal(launch.meta.auth, true, '启动页要知道有哪些行程：没登录先去登录，登录后回到 #/ 再决定');
  assert.equal(matchPath(table, '/').def.name, 'launch');
  assert.equal(buildPath(table, 'launch'), '/');
  const contacts = routes.find((x) => x.name === 'contacts');
  assert.equal(contacts.path, '/t/:tripId/contacts');
  assert.equal(contacts.meta.title, '联系人');
  assert.equal(contacts.meta.auth, true);
  assert.equal(contacts.meta.section, 'trip');
  assert.deepEqual(contacts.meta.parent({ tripId: 'demo-island' }), { name: 'trip', params: { tripId: 'demo-island' } });
  assert.equal(buildPath(table, 'contacts', { tripId: 'demo-island' }), '/t/demo-island/contacts');
});
