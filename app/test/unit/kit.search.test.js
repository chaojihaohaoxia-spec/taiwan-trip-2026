// kit/search：折叠（越南语去声调、全角、大小写）、高亮位置、全局搜索的分组 / 打分 / 跳转目标。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldText, foldWithMap, queryTokens, findRanges, splitByRanges, mergeRanges } from '../../src/kit/search/fold.js';
import { searchTrip, flattenResults, moveActive, snippet, targetFor, SEARCH_GROUPS, SCORES } from '../../src/kit/search/engine.js';
import { bundleFromRows, normalizeSearchText } from '../../src/data/selectors.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));

/** 演示数据里一趟行程的数据包（只取这一趟的行） */
function demoBundle(tripId = 'demo-island') {
  const rows = {};
  for (const [t, list] of Object.entries(DB.tables)) rows[t] = list.filter((r) => (t === 'trips' ? r.id : r.trip_id) === tripId);
  return bundleFromRows(tripId, rows);
}

/** 小数据包：只放这次要比的几行 */
function miniBundle({ items = [], places = [], tips = [], expenses = [], bookings = [], contacts = [], todos = [] } = {}) {
  const trip = { id: 't1', title: '测试', start_date: '2027-01-10', end_date: '2027-01-11', timezone: 'Asia/Ho_Chi_Minh' };
  const days = [{ id: 'd1', trip_id: 't1', date: '2027-01-10' }, { id: 'd2', trip_id: 't1', date: '2027-01-11' }];
  const base = (r, i) => ({ trip_id: 't1', created_at: `2026-12-0${(i % 9) + 1}T00:00:00+00:00`, deleted_at: null, ...r });
  return bundleFromRows('t1', {
    trips: [trip], days, items: items.map(base), places: places.map(base), tips: tips.map(base), expenses: expenses.map(base),
    bookings: bookings.map(base), contacts: contacts.map(base), todos: todos.map(base),
  });
}

const item = (id, title, extra = {}) => ({ id, title, day_id: 'd1', kind: 'food', variant: 'primary', sort_key: 0, start_time: null, tags: [], ...extra });

test('折叠：越南语去声调和帽子（ơ ư â ê ô ă）、đ → d、不分大小写、全角转半角；中文原样', () => {
  assert.equal(foldText('Phở Hòa'), 'pho hoa');
  assert.equal(foldText('Bến tàu Dừa'), 'ben tau dua');
  assert.equal(foldText('Đường Hoa Sứ'), 'duong hoa su');
  assert.equal(foldText('ＧＲＡＢ　夜市'), 'grab 夜市');
  assert.equal(foldText('Nhà Thùng Nước Mắm'), 'nha thung nuoc mam');
  // 和数据层的规范化是同一个方向（NFKC + 小写），只是多去掉了声调
  assert.equal(foldText('Grab'), normalizeSearchText('Grab'));
});

test('折叠后的位置能换算回原文：原文是“字母 + 组合符号”（NFD）写法时，高亮也落在整字上', () => {
  const nfd = 'Quán phở Sáng'.normalize('NFD');
  const ranges = findRanges(nfd, ['pho']);
  assert.equal(ranges.length, 1);
  assert.equal(nfd.slice(ranges[0][0], ranges[0][1]).normalize('NFC'), 'phở');
  // 预组合写法
  const nfc = 'Quán phở Sáng';
  const [r] = findRanges(nfc, ['pho']);
  assert.equal(nfc.slice(r[0], r[1]), 'phở');
  // 每个折叠后的字符都有原文位置
  const m = foldWithMap(nfd);
  assert.equal(m.starts.length, m.text.length);
  assert.equal(m.ends.length, m.text.length);
});

test('高亮：同一个词出现几次都标出来，重叠的合并；切段后拼回来等于原文', () => {
  const text = '码头法棍 + 夜市烤串（码头）';
  const ranges = findRanges(text, ['码头', '头法']);
  assert.deepEqual(ranges, [[0, 3], [12, 14]]);
  const parts = splitByRanges(text, ranges);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['码头法', '码头']);
  assert.deepEqual(mergeRanges([[5, 8], [0, 2], [1, 3], [8, 9]]), [[0, 3], [5, 9]]);
  assert.deepEqual(splitByRanges('', []), []);
});

test('查询词：按空白（含全角空格）分开、去重、折叠', () => {
  assert.deepEqual(queryTokens('  Ben　TAU  ben '), ['ben', 'tau']);
  assert.deepEqual(queryTokens('   '), []);
});

test('空查询、只有空白：返回 []；没有命中：返回 []', () => {
  const b = demoBundle();
  assert.deepEqual(searchTrip(b, ''), []);
  assert.deepEqual(searchTrip(b, '   '), []);
  assert.deepEqual(searchTrip(b, 'zzqxw不存在的词'), []);
  assert.deepEqual(searchTrip(null, '夜市'), []);
});

test('中文子串：搜「夜市」找到地点、条目、账目、贴士；每一条的高亮位置正好是「夜市」', () => {
  const groups = searchTrip(demoBundle(), '夜市', { limit: 50 });
  const by = Object.fromEntries(groups.map((g) => [g.group, g]));
  for (const g of ['places', 'items', 'expenses', 'tips']) assert.ok(by[g], `有 ${g} 组`);
  assert.ok(by.places.results.some((r) => r.title === '椰影夜市'));
  for (const r of flattenResults(groups)) {
    for (const [s, e] of r.matches.title) assert.equal(r.title.slice(s, e), '夜市');
    for (const [s, e] of r.matches.subtitle) assert.equal(foldText(r.subtitle.slice(s, e)), '夜市');
    assert.ok(r.matches.title.length || r.matches.subtitle.length || r.score <= SCORES.body.sub, `「${r.title}」看得见命中的地方`);
  }
});

test('越南语去声调：搜 pho 找到「清晨粉店」（Quán phở Sáng）；ben tau 两个词都要命中，标题不含时副标题显示当地语名并高亮', () => {
  const b = demoBundle();
  const pho = searchTrip(b, 'pho').find((g) => g.group === 'places');
  const shop = pho.results.find((r) => r.title === '清晨粉店');
  assert.ok(shop);
  assert.match(shop.subtitle, /Quán phở Sáng/);
  assert.equal(foldText(shop.subtitle.slice(...shop.matches.subtitle[0])), 'pho');

  const bt = searchTrip(b, 'ben tau').find((g) => g.group === 'places');
  assert.equal(bt.results[0].title, '椰影码头', '当地语名完全一样（Bến tàu Dừa 以 Bến tàu 开头）排第一');
  for (const r of bt.results) assert.ok(/ben/.test(foldText(r.subtitle)) && /tau/.test(foldText(r.subtitle)));
  // 只命中一个词不算
  assert.equal(searchTrip(b, 'ben zzqx').length, 0);
});

test('英文不分大小写：GRAB、grab、Grab 结果一样', () => {
  const b = demoBundle();
  const a = JSON.stringify(searchTrip(b, 'GRAB'));
  assert.ok(a.length > 2);
  assert.equal(JSON.stringify(searchTrip(b, 'grab')), a);
  assert.equal(JSON.stringify(searchTrip(b, 'Grab')), a);
});

test('排序：标题完全一样 > 标题开头 > 标题中间 > 别的名字 / 次要字段 > 说明里', () => {
  const b = miniBundle({
    items: [
      item('i-body', '早饭', { description: '顺路买椰子' }),
      item('i-sub', '海边喝椰子'),
      item('i-prefix', '椰子冰'),
      item('i-exact', '椰子'),
      item('i-tag', '午饭', { tags: ['椰子'] }),
    ],
  });
  const [g] = searchTrip(b, '椰子', { limit: 10 });
  assert.equal(g.group, 'items');
  assert.deepEqual(g.results.map((r) => r.id), ['i-exact', 'i-prefix', 'i-sub', 'i-tag', 'i-body']);
  const s = Object.fromEntries(g.results.map((r) => [r.id, r.score]));
  assert.ok(s['i-exact'] > s['i-prefix'] && s['i-prefix'] > s['i-sub'] && s['i-sub'] > s['i-tag'] && s['i-tag'] > s['i-body']);
  // 命中在说明里：副标题换成说明的片段，并标出位置
  const body = g.results.find((r) => r.id === 'i-body');
  assert.match(body.subtitle, /^说明：顺路买椰子/);
  assert.equal(body.subtitle.slice(...body.matches.subtitle[0]), '椰子');
});

test('排序：英文按词开头算（“Coco Bay” 里的 bay 比 “ebay” 里的 bay 靠前）；几个词连着出现在标题里加分', () => {
  const b = miniBundle({
    places: [
      { id: 'p1', name: 'Shop ebay', kind: 'shop', aliases: [] },
      { id: 'p2', name: 'Coco Bay', kind: 'hotel', aliases: [] },
      { id: 'p3', name: 'Bay Coco Hotel', kind: 'hotel', aliases: [] },
    ],
  });
  const [g] = searchTrip(b, 'bay');
  assert.deepEqual(g.results.map((r) => r.id), ['p3', 'p2', 'p1']);
  const [h] = searchTrip(b, 'coco bay');
  assert.equal(h.results[0].id, 'p2', '连在一起完全一样的排第一');
});

test('每组最多 limit 条，total 是一共命中多少；组按第一名的分数排', () => {
  const b = demoBundle();
  const groups = searchTrip(b, 'coco', { limit: 2 });
  const items = groups.find((g) => g.group === 'items');
  assert.equal(items.results.length, 2);
  assert.ok(items.total > 2);
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i - 1].results[0].score >= groups[i].results[0].score);
  // 只搜某几组
  assert.deepEqual(searchTrip(b, 'coco', { groups: ['places'] }).map((g) => g.group), ['places']);
  assert.deepEqual(SEARCH_GROUPS, ['items', 'places', 'bookings', 'contacts', 'tips', 'todos', 'expenses']);
});

test('跳转目标：条目 → 那一天并带 ?item=；备选池的条目 → 行程概览；地点 / 预订 → 页面 + 详情弹层；其余 → 页面 + 查询参数', () => {
  const b = miniBundle({
    items: [item('i1', '椰子'), item('i2', '椰子水', { day_id: null })],
    places: [{ id: 'p1', name: '椰子园', kind: 'sight', aliases: [] }],
    bookings: [{ id: 'b1', title: '椰子园门票', kind: 'ticket' }],
    contacts: [{ id: 'c1', name: '椰子园前台', category: 'activity' }],
    tips: [{ id: 'tp1', title: '椰子别喝冰的', kind: 'tip', body: '' }],
    todos: [{ id: 'td1', title: '买椰子糖', list: 'buy' }],
    expenses: [{ id: 'e1', description: '椰子', amount: 30000, currency: 'VND', category: '餐饮', date: '2027-01-10' }],
  });
  const all = flattenResults(searchTrip(b, '椰子', { limit: 10 }));
  const t = Object.fromEntries(all.map((r) => [r.id, r.target]));
  assert.deepEqual(t.i1, { name: 'day', params: { tripId: 't1', date: '2027-01-10' }, query: { item: 'i1' } });
  assert.deepEqual(t.i2, { name: 'places', params: { tripId: 't1' }, query: { by: 'day' } }, '备选池的条目到地点页按天看（概览上不再有备选池）');
  assert.deepEqual(t.p1, { name: 'places', params: { tripId: 't1' }, query: {}, sheets: [{ id: 'place', arg: 'p1' }] });
  assert.deepEqual(t.b1, { name: 'bookings', params: { tripId: 't1' }, query: {}, sheets: [{ id: 'booking', arg: 'b1' }] });
  assert.deepEqual(t.c1, { name: 'contacts', params: { tripId: 't1' }, query: { contact: 'c1' } });
  assert.deepEqual(t.tp1, { name: 'tips', params: { tripId: 't1' }, query: { tip: 'tp1' } });
  assert.deepEqual(t.td1, { name: 'lists', params: { tripId: 't1' }, query: { list: 'buy', todo: 'td1' } });
  assert.deepEqual(t.e1, { name: 'ledger', params: { tripId: 't1' }, query: { expense: 'e1' } });
  // 图标描述交给 KindIcon
  assert.deepEqual(all.find((r) => r.id === 'e1').icon, { type: 'expense', kind: '餐饮' });
  assert.deepEqual(targetFor('nope', { id: 'x' }, b), { name: 'trip', params: { tripId: 't1' }, query: {} });
});

test('软删除的条目和账目搜不到；订单号、航班号、电话也能搜', () => {
  const b = miniBundle({
    items: [item('i1', '椰子', { deleted_at: '2027-01-01T00:00:00+00:00' })],
    expenses: [{ id: 'e1', description: '椰子', amount: 1, currency: 'HKD', deleted_at: '2027-01-01T00:00:00+00:00' }],
    bookings: [{ id: 'b1', title: '去程', kind: 'flight', confirmation_code: 'DEMO-AB12', details: { flight_no: 'DM801' } }],
    contacts: [{ id: 'c1', name: '前台', category: 'hotel', phone: '+00 000 1234' }],
  });
  assert.deepEqual(searchTrip(b, '椰子'), []);
  const code = flattenResults(searchTrip(b, 'demo-ab12'));
  assert.equal(code[0].id, 'b1');
  assert.match(code[0].subtitle, /订单号 DEMO-AB12/);
  assert.equal(flattenResults(searchTrip(b, 'dm801'))[0].id, 'b1');
  assert.equal(flattenResults(searchTrip(b, '1234'))[0].id, 'c1');
});

test('片段：长说明只取命中附近一段，前后加省略号，不从英文单词中间切开', () => {
  const long = `${'前面很长很长的一段说明文字，'.repeat(4)}Quán phở Sáng 的牛肉粉${'，后面还有很多很多字'.repeat(4)}`;
  const at = long.indexOf('phở');
  const s = snippet(long, at, 3);
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.includes('phở'));
  assert.ok(Array.from(s).length <= 46);
  assert.equal(snippet('短的', 0), '短的');
});

test('键盘上下选择：到头循环，没选时 ↓ 选第一个、↑ 选最后一个，没有结果是 -1', () => {
  assert.equal(moveActive(3, -1, 1), 0);
  assert.equal(moveActive(3, -1, -1), 2);
  assert.equal(moveActive(3, 2, 1), 0);
  assert.equal(moveActive(3, 0, -1), 2);
  assert.equal(moveActive(0, -1, 1), -1);
});

test('真实密度的演示行程里搜一次足够快（< 50ms）', () => {
  const b = demoBundle();
  searchTrip(b, 'a');
  const t0 = performance.now();
  for (const q of ['夜市', 'pho', 'ben tau', 'coco', 'demo']) searchTrip(b, q);
  assert.ok((performance.now() - t0) / 5 < 50);
});
