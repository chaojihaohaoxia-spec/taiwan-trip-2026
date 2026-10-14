// 地点页（pages/places）、地点详情（sheets/place）、写评级（sheets/review）的纯逻辑：评级五档和概况、地点在行程里的位置、
// 在哪天的小标签、成员顺序、去过还没评、贴士和链接、排进 / 加进某天；地点页的筛选、越南语去声调搜索、四种分组、
// 备选池筛选、概况一句话；写评级表单（价格解析、LogEntry 来回、改没改过、patch）；「写评级 → 回到地点详情」的衔接。
// 最后用演示数据（demo-island）整体跑一遍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENUMS } from '../../src/data/schema.js';
import { zonedToInstant } from '../../src/lib/datetime.js';
import {
  RATING_TIERS, ratingName, isRating, ratingSummary, PLACE_KIND_ORDER, placeKind, itemKindForPlace, EATING_KINDS, placeVisits,
  compareVisits, dayLabel, dayTags, firstVisitKey, visitWhen, itemTimeText, reviewsByUser, reviewHasContent, firstPhotoPath,
  needsReview, latestDoneItem, placeTips, placeLinks, scheduleTargets, localName, englishName,
} from '../../src/sheets/place/model.js';
import { markReturnToPlace, takeReturnToPlace, RETURN_TTL_MS } from '../../src/sheets/place/flow.js';
import {
  MODES, MODE_LABELS, normalizeMode, normalizeView, normalizeKind, defaultMode, placeHaystack, buildEntries, matchEntry, filterEntries,
  kindCounts, groupEntries, reviewNudges, filterPool, summaryLine, emptyText,
} from '../../src/pages/places/model.js';
import {
  parsePrice, entryFromLog, newEntry, logFromEntry, initialForm, formKey, isEmptyForm, priceErrors, buildPatch, currencyChoices,
  visitedAtFor, photoFromRow, MAX_NAME, wantsThousands, priceInputMode, timesThousand, forgotThousands,
} from '../../src/sheets/review/form-model.js';
import { queryTokens } from '../../src/kit/search/fold.js';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(APP, 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

// ---------------------------------------------------------------------
// 小工具：拼几行测试数据
// ---------------------------------------------------------------------

const D1 = { id: 'd1', date: '2027-01-10', title: '落地' };
const D2 = { id: 'd2', date: '2027-01-11', title: '海岛一日' };
const D3 = { id: 'd3', date: '2027-01-12', title: '' };
const DAYS = [D1, D2, D3];
const START = '2027-01-10';
const J = { user_id: 'uj', display_name: 'Jeremy', role: 'owner', color: '#2F6FDE' };
const C = { user_id: 'uc', display_name: 'Cathy', role: 'editor' };
const item = (o) => ({ id: o.id, title: o.title || o.id, kind: 'food', variant: 'primary', status: 'planned', sort_key: 10, deleted_at: null, ...o });
const place = (o) => ({ id: o.id, name: o.name || o.id, name_local: null, name_en: null, aliases: [], kind: 'food', tags: [], links: [], wishlist: false, ...o });
const review = (o) => ({ id: o.id, place_id: o.place_id, user_id: o.user_id, rating: null, notes: null, food_log: [], shop_log: [], photos: [], updated_at: '2027-01-11T00:00:00Z', ...o });

// ---------------------------------------------------------------------
// 评级五档
// ---------------------------------------------------------------------

test('评级五档：从高到低 夯 / 顶级 / 人上人 / NPC / 拉完了，和数据库的 1–5 对应；不是 1–5 的整数都不算', () => {
  assert.deepEqual(RATING_TIERS.map((t) => [t.value, t.label]), [[5, '夯'], [4, '顶级'], [3, '人上人'], [2, 'NPC'], [1, '拉完了']]);
  for (const t of RATING_TIERS) assert.match(t.hint, /\S/);
  assert.equal(ratingName(5), '夯');
  assert.equal(ratingName(1), '拉完了');
  for (const bad of [0, 6, 2.5, null, undefined, '5', NaN]) {
    assert.equal(isRating(bad), false, String(bad));
    assert.equal(ratingName(bad), null);
  }
});

test('评级概况：没人评 / 一个人 / 两个人取平均四舍五入（夯 + 顶级 = 夯）；只写评语的不算档位', () => {
  assert.deepEqual(ratingSummary([]), { count: 0, avg: null, tier: null, best: null });
  assert.deepEqual(ratingSummary([{ rating: 3 }]), { count: 1, avg: 3, tier: 3, best: 3 });
  const two = ratingSummary([{ rating: 5 }, { rating: 4 }]);
  assert.equal(two.tier, 5);
  assert.equal(two.avg, 4.5);
  assert.equal(two.best, 5);
  assert.equal(ratingSummary([{ rating: 5 }, { rating: 1 }]).tier, 3);
  assert.equal(ratingSummary([{ rating: null, notes: '只写了评语' }, { rating: 2 }]).count, 1);
});

// ---------------------------------------------------------------------
// 种类
// ---------------------------------------------------------------------

test('地点种类：顺序覆盖数据库的每个取值（吃喝在前）；不认识的当「其他」', () => {
  assert.deepEqual([...PLACE_KIND_ORDER].sort(), [...ENUMS['places.kind']].sort());
  assert.equal(PLACE_KIND_ORDER[0], 'food');
  assert.equal(placeKind({ kind: 'spaceship' }), 'other');
  assert.equal(placeKind(null), 'other');
  for (const k of EATING_KINDS) assert.ok(PLACE_KIND_ORDER.includes(k));
});

test('加进某天的新条目种类：每种地点都映射到 items.kind 的合法取值；市场看名字分夜市 / 购物', () => {
  for (const k of ENUMS['places.kind']) {
    assert.ok(ENUMS['items.kind'].includes(itemKindForPlace({ kind: k, name: 'x' })), k);
  }
  assert.equal(itemKindForPlace({ kind: 'food' }), 'food');
  assert.equal(itemKindForPlace({ kind: 'hub' }), 'transport');
  assert.equal(itemKindForPlace({ kind: 'shop' }), 'shopping');
  assert.equal(itemKindForPlace({ kind: 'market', name: '椰影夜市' }), 'night_market');
  assert.equal(itemKindForPlace({ kind: 'market', name: 'x', name_en: 'Night Market' }), 'night_market');
  assert.equal(itemKindForPlace({ kind: 'market', name: '早市' }), 'shopping');
  assert.equal(itemKindForPlace({ kind: 'bar' }), 'other');
});

// ---------------------------------------------------------------------
// 地点在行程里的位置
// ---------------------------------------------------------------------

function sampleItems() {
  return [
    item({ id: 'a', place_id: 'P1', day_id: 'd2', sort_key: 20, start_time: '12:00:00' }),
    item({ id: 'b', place_id: 'P1', day_id: 'd1', sort_key: 30, start_time: '19:00:00', status: 'done' }),
    item({ id: 'c', place_id: 'P1', day_id: 'd2', sort_key: 5, variant: 'backup', parent_item_id: 'a' }),
    item({ id: 'd', place_id: 'P1', day_id: null, sort_key: 10 }),
    item({ id: 'e', place_id: 'P2', day_id: 'd3', sort_key: 10, deleted_at: '2027-01-01T00:00:00Z' }),
    item({ id: 'f', place_id: 'P2', day_id: 'gone', sort_key: 10 }),
    item({ id: 'g', place_id: null, day_id: 'd1' }),
    item({ id: 'h', place_id: 'P3', day_id: null, sort_key: 20, status: 'done' }),
  ];
}

test('地点被哪些条目用到：按天、再按当天先后；备选标出来；没排进哪天的进备选池；软删除、找不到那天、没地点的都不算', () => {
  const v = placeVisits({ items: new Map(sampleItems().map((i) => [i.id, i])), days: DAYS, startDate: START });
  const p1 = v.get('P1');
  assert.deepEqual(p1.visits.map((x) => [x.item.id, x.n, x.alt]), [['b', 1, false], ['c', 2, true], ['a', 2, false]]);
  assert.deepEqual(p1.pool.map((x) => x.id), ['d']);
  assert.equal(v.has('P2'), false, '软删除和找不到那天的都不算');
  assert.deepEqual(v.get('P3').pool.map((x) => x.id), ['h']);
  assert.ok(compareVisits(p1.visits[0], p1.visits[1]) < 0);
  assert.deepEqual(firstVisitKey(p1.visits), ['2027-01-10', 30]);
  assert.equal(firstVisitKey([]), null);
});

test('在哪天的小标签：同一天只出一个（有主方案就不算备选），按日期排，今天标出来；算不出第几天用日期', () => {
  const v = placeVisits({ items: sampleItems(), days: DAYS, startDate: START }).get('P1');
  assert.deepEqual(dayTags(v.visits, { todayId: 'd2' }).map((t) => [t.label, t.alt, t.today]), [['D1', false, false], ['D2', false, true]]);
  const onlyAlt = dayTags([{ day: D3, n: 3, alt: true }]);
  assert.deepEqual(onlyAlt.map((t) => [t.label, t.alt]), [['D3', true]]);
  assert.equal(dayLabel(null, '2027-01-12'), '1月12日');
  assert.equal(dayLabel(0, '2027-01-12'), '1月12日');
});

test('去的时间：「D1 · 19:00」；有模糊时间的写在括号里；没时间只写第几天', () => {
  assert.equal(visitWhen({ item: { start_time: '19:00:00' }, day: D1, n: 1 }), 'D1 · 19:00');
  assert.equal(visitWhen({ item: { start_time: '09:30', end_time: '10:15', time_label: '早饭' }, day: D2, n: 2 }), 'D2 · 09:30–10:15（早饭）');
  assert.equal(visitWhen({ item: { time_label: '午饭后' }, day: D2, n: 2 }), 'D2 · 午饭后');
  assert.equal(visitWhen({ item: {}, day: D3, n: 3 }), 'D3');
  assert.equal(itemTimeText({}), '');
});

// ---------------------------------------------------------------------
// 评级：成员顺序、有没有内容、照片、去过还没评
// ---------------------------------------------------------------------

test('评级按成员顺序排、每人一条（重复的留最新）；不在成员名单里的排最后', () => {
  const list = [
    review({ id: 'r1', place_id: 'P', user_id: 'uc', rating: 4 }),
    review({ id: 'r2', place_id: 'P', user_id: 'uj', rating: 2, updated_at: '2027-01-10T00:00:00Z' }),
    review({ id: 'r3', place_id: 'P', user_id: 'uj', rating: 5, updated_at: '2027-01-12T00:00:00Z' }),
    review({ id: 'r4', place_id: 'P', user_id: 'gone', rating: 1 }),
  ];
  assert.deepEqual(reviewsByUser(list, [J, C]).map((r) => r.id), ['r3', 'r1', 'r4']);
});

test('评级有没有写东西：档位、评语、吃了什么、买了什么、照片任一样都算；空白评语不算', () => {
  assert.equal(reviewHasContent(null), false);
  assert.equal(reviewHasContent(review({ id: 'x', notes: '   ' })), false);
  assert.equal(reviewHasContent(review({ id: 'x', rating: 3 })), true);
  assert.equal(reviewHasContent(review({ id: 'x', notes: '好吃' })), true);
  assert.equal(reviewHasContent(review({ id: 'x', food_log: [{ name: '粉' }] })), true);
  assert.equal(reviewHasContent(review({ id: 'x', photos: [{ path: 'a.jpg' }] })), true);
  assert.equal(firstPhotoPath([review({ id: 'a' }), review({ id: 'b', photos: [{ path: '' }, { path: 't/u/reviews/1.jpg' }] })]), 't/u/reviews/1.jpg');
  assert.equal(firstPhotoPath([]), null);
});

test('去过还没评：有条目标了完成、我还没评（只写评语也算评过）；最近一次去的是最后一条完成的', () => {
  const where = placeVisits({ items: sampleItems(), days: DAYS, startDate: START }).get('P1');
  assert.equal(needsReview(where, [], 'uj'), true);
  assert.equal(needsReview(where, [review({ id: 'r', user_id: 'uj', notes: '还行' })], 'uj'), false);
  assert.equal(needsReview(where, [review({ id: 'r', user_id: 'uc', rating: 5 })], 'uj'), true, '对方评了不算我评了');
  assert.equal(needsReview(where, [], null), false, '没登录不提醒');
  assert.equal(latestDoneItem(where).item.id, 'b');
  const planned = { visits: [{ item: item({ id: 'z' }), day: D1, n: 1 }], pool: [] };
  assert.equal(needsReview(planned, [], 'uj'), false, '没去过不提醒');
  const pooled = placeVisits({ items: sampleItems(), days: DAYS, startDate: START }).get('P3');
  assert.equal(latestDoneItem(pooled).item.id, 'h');
  assert.equal(latestDoneItem(pooled).day, null);
  assert.equal(latestDoneItem(null), null);
});

// ---------------------------------------------------------------------
// 贴士、链接、排进哪天
// ---------------------------------------------------------------------

test('地点的贴士：只要这个地点的；置顶在前，再按防坑、模板、常用语、小贴士、实用信息', () => {
  const tips = [
    { id: 't1', place_id: 'P', kind: 'info' },
    { id: 't2', place_id: 'P', kind: 'tip' },
    { id: 't3', place_id: 'Q', kind: 'warning' },
    { id: 't4', place_id: 'P', kind: 'warning' },
    { id: 't5', place_id: 'P', kind: 'info', pinned: true },
  ];
  assert.deepEqual(placeTips(tips, 'P').map((t) => t.id), ['t5', 't4', 't2', 't1']);
  assert.deepEqual(placeTips(new Map(tips.map((t) => [t.id, t])), 'Q').map((t) => t.id), ['t3']);
});

test('地点的外链：links + maps_url（「Google 地图」），只留 http(s)，同一个网址只出一次，没写名字的叫「链接」', () => {
  const p = place({
    id: 'P',
    links: [{ label: '菜单', url: 'https://example.com/menu', kind: 'menu' }, { label: '坏', url: 'javascript:alert(1)' }, { url: 'https://example.com/x' }, { label: '重复', url: 'https://example.com/menu' }],
    maps_url: 'https://maps.example.com/p',
  });
  assert.deepEqual(placeLinks(p), [
    { label: '菜单', url: 'https://example.com/menu', kind: 'menu' },
    { label: '链接', url: 'https://example.com/x', kind: 'other' },
    { label: 'Google 地图', url: 'https://maps.example.com/p', kind: 'maps' },
  ]);
  assert.deepEqual(placeLinks(place({ id: 'Q', links: null })), []);
});

test('排进哪天的按钮：每天一个「D1」，带日期和标题；今天标出来', () => {
  const t = scheduleTargets(DAYS, { startDate: START, todayId: 'd2' });
  assert.deepEqual(t.map((x) => [x.label, x.today]), [['D1', false], ['D2', true], ['D3', false]]);
  assert.match(t[0].title, /^1月10日 周日 · 落地$/);
  assert.match(t[2].title, /^1月12日 周二$/, '标题空着时只写日期');
  // 行程进行中：今天以前的天不列（排进已经过去的一天没有意义）；没给今天（出发前 / 结束后）照常全列
  assert.deepEqual(scheduleTargets(DAYS, { startDate: START, todayId: 'd2', hidePast: true }).map((x) => x.label), ['D2', 'D3']);
  assert.deepEqual(scheduleTargets(DAYS, { startDate: START, hidePast: true }).map((x) => x.label), ['D1', 'D2', 'D3']);
});

test('名字：当地语名、英文名和中文名写得一样（不分大小写、不看声调）就不重复显示', () => {
  assert.equal(localName({ name: '清晨粉店', name_local: 'Quán phở Sáng' }), 'Quán phở Sáng');
  assert.equal(localName({ name: 'The Home Pizza', name_local: 'the home pizza ' }), null);
  assert.equal(localName({ name: 'Pho Hoa', name_local: 'Phở Hòa' }), null, '只差声调也算一样');
  assert.equal(localName({ name: '某店', name_local: '  ' }), null);
  assert.equal(englishName({ name: '清晨粉店', name_local: 'Quán phở Sáng', name_en: 'Morning Pho' }), 'Morning Pho');
  assert.equal(englishName({ name: '清晨粉店', name_local: 'Quan Pho Sang', name_en: 'Quán phở Sáng' }), null);
  assert.equal(englishName({ name: 'Mare', name_en: 'mare' }), null);
  assert.equal(englishName({ name: '某店' }), null);
});

// ---------------------------------------------------------------------
// 地点页：看法、筛选、分组
// ---------------------------------------------------------------------

test('看法的参数：四种看法、列表 / 网格、种类；不认识的退回默认；结束后的行程默认看评级', () => {
  assert.deepEqual(MODES, ['kind', 'day', 'want', 'rating']);
  for (const m of MODES) assert.match(MODE_LABELS[m], /\S/);
  assert.equal(normalizeMode('day'), 'day');
  assert.equal(normalizeMode('nope'), 'kind');
  assert.equal(normalizeMode(undefined, 'rating'), 'rating');
  assert.equal(normalizeMode('bad', 'also-bad'), 'kind');
  assert.equal(normalizeView('grid'), 'grid');
  assert.equal(normalizeView('x'), 'list');
  assert.equal(normalizeKind('food'), 'food');
  assert.equal(normalizeKind('x'), 'all');
  assert.equal(defaultMode('ended'), 'rating');
  assert.equal(defaultMode('upcoming'), 'kind');
  assert.equal(defaultMode('ongoing'), 'kind');
});

function samplePage() {
  const places = [
    place({ id: 'P1', name: '清晨粉店', name_local: 'Quán phở Sáng', kind: 'food', address: '1 Đường Bến Tàu（虚构地址）' }),
    place({ id: 'P2', name: '椰影夜市', name_local: 'Chợ đêm Dừa', kind: 'market', wishlist: true }),
    place({ id: 'P3', name: '白灯塔', kind: 'sight', aliases: ['lighthouse'] }),
    place({ id: 'P4', name: '没去过的咖啡', kind: 'cafe', wishlist: true }),
  ];
  const items = [
    item({ id: 'i1', place_id: 'P1', day_id: 'd2', sort_key: 10, status: 'done', start_time: '08:00:00' }),
    item({ id: 'i2', place_id: 'P2', day_id: 'd1', sort_key: 50, status: 'done', start_time: '19:00:00' }),
    item({ id: 'i3', place_id: 'P2', day_id: 'd3', sort_key: 30, variant: 'rain' }),
    item({ id: 'i4', place_id: 'P3', day_id: null, title: '白灯塔徒步' }),
  ];
  const reviews = [
    review({ id: 'r1', place_id: 'P2', user_id: 'uj', rating: 5 }),
    review({ id: 'r2', place_id: 'P2', user_id: 'uc', rating: 4 }),
    review({ id: 'r3', place_id: 'P3', user_id: 'uc', notes: '风大' }),
  ];
  const reviewsByPlace = new Map();
  for (const r of reviews) reviewsByPlace.set(r.place_id, [...(reviewsByPlace.get(r.place_id) || []), r]);
  const visits = placeVisits({ items, days: DAYS, startDate: START });
  const entries = buildEntries({ places, visits, reviewsByPlace, members: [J, C], userId: 'uj', todayId: 'd2' });
  return { places, items, reviews, visits, entries };
}

test('每个地点一项：种类、在哪天、两人的评级、评级概况、我的那条、去过还没评、最近一次去', () => {
  const { entries } = samplePage();
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.deepEqual(by.P1.tags.map((t) => [t.label, t.today]), [['D2', true]]);
  assert.equal(by.P1.needsReview, true);
  assert.equal(by.P1.done.item.id, 'i1');
  assert.equal(by.P2.needsReview, false, '我评过了');
  assert.equal(by.P2.rating.tier, 5);
  assert.deepEqual(by.P2.reviews.map((r) => r.user_id), ['uj', 'uc']);
  assert.equal(by.P2.mine.id, 'r1');
  assert.equal(by.P3.rating.tier, null);
  assert.equal(by.P3.pool.length, 1);
  assert.equal(by.P4.firstKey, null);
});

test('搜索：中文子串、越南语不带声调（pho → phở、ben tau → Bến Tàu）、别名、每个词都要命中；高亮名字和当地语名', () => {
  const { entries } = samplePage();
  const ids = (q) => filterEntries(entries, { query: q }).map((r) => r.entry.id);
  assert.deepEqual(ids('粉店'), ['P1']);
  assert.deepEqual(ids('pho'), ['P1']);
  assert.deepEqual(ids('PHO sang'), ['P1']);
  assert.deepEqual(ids('ben tau'), ['P1'], '地址也能搜');
  assert.deepEqual(ids('lighthouse'), ['P3']);
  assert.deepEqual(ids('pho 夜市'), [], '每个词都要命中');
  assert.equal(ids('').length, 4);
  const hit = filterEntries(entries, { query: 'pho' })[0].hit;
  assert.deepEqual(hit.local, [[5, 8]], '「phở」在原文里的位置');
  assert.equal(matchEntry(entries[0], queryTokens('zzz')), null);
  assert.match(placeHaystack(entries[0].place), /quan pho sang/);
  assert.deepEqual(filterEntries(entries, { kind: 'market' }).map((r) => r.entry.id), ['P2']);
});

test('种类芯片：只列有的种类，按固定顺序，带数量', () => {
  const { entries } = samplePage();
  assert.deepEqual(kindCounts(entries).map((c) => [c.kind, c.label, c.count]), [['food', '餐厅', 1], ['cafe', '咖啡馆', 1], ['market', '市场', 1], ['sight', '景点', 1]]);
});

test('按类型分组：按固定顺序，组里按第一次在行程里出现的先后，没进行程的按名字排在后面', () => {
  const { entries } = samplePage();
  const groups = groupEntries(filterEntries(entries), 'kind');
  assert.deepEqual(groups.map((g) => [g.key, g.title, g.rows.length]), [['kind:food', '餐厅', 1], ['kind:cafe', '咖啡馆', 1], ['kind:market', '市场', 1], ['kind:sight', '景点', 1]]);
});

test('按天分组：每天一组（带「今天」、日期），一个地点可以在好几天里，组里按当天的先后；没排进哪天的单独一组', () => {
  const { entries } = samplePage();
  const groups = groupEntries(filterEntries(entries), 'day', { days: DAYS, startDate: START, todayId: 'd2' });
  assert.deepEqual(groups.map((g) => [g.key, g.title, g.meta, g.today || false, g.rows.map((r) => r.entry.id)]), [
    ['day:d1', 'D1 · 1月10日 周日', '落地', false, ['P2']],
    ['day:d2', 'D2 · 1月11日 周一', '海岛一日', true, ['P1']],
    ['day:d3', 'D3 · 1月12日 周二', null, false, ['P2']],
    ['loose', '没排进哪天', '还没有哪一天的条目用到这些地点', false, ['P3', 'P4']],
  ]);
  assert.equal(groups[2].rows[0].visit.alt, true, '雨天方案也带上 visit（卡片上写「备选」）');
  // 算不出第几天（没有开始日期）：标题只写日期，不写两遍
  const noStart = groupEntries(filterEntries(entries), 'day', { days: DAYS, todayId: null });
  assert.equal(noStart[0].title, '1月10日 周日');
});

test('想去：只列想去清单里的；按评级：五档从高到低，再「只写了评语」「还没评」', () => {
  const { entries } = samplePage();
  const all = filterEntries(entries);
  assert.deepEqual(groupEntries(all, 'want').map((g) => g.rows.map((r) => r.entry.id)), [['P2', 'P4']]);
  assert.deepEqual(groupEntries(filterEntries(entries, { kind: 'food' }), 'want'), []);
  const rated = groupEntries(all, 'rating');
  assert.deepEqual(rated.map((g) => [g.key, g.rows.map((r) => r.entry.id)]), [['tier:5', ['P2']], ['noted', ['P3']], ['unrated', ['P1', 'P4']]]);
  assert.equal(rated[0].title, '夯');
  // 还没评：机场、车站排在最后
  const hub = buildEntries({ places: [place({ id: 'H', kind: 'hub', name: '机场' }), place({ id: 'F', kind: 'food', name: '粉店' })], visits: placeVisits({ items: [item({ id: 'h1', place_id: 'H', day_id: 'd1', sort_key: 10 }), item({ id: 'f1', place_id: 'F', day_id: 'd2', sort_key: 10 })], days: DAYS, startDate: START }) });
  assert.deepEqual(groupEntries(filterEntries(hub), 'rating').map((g) => g.rows.map((r) => r.entry.id)), [['F', 'H']]);
});

test('去过还没评的提醒：最近去的在前', () => {
  const places = [place({ id: 'A' }), place({ id: 'B' }), place({ id: 'C' })];
  const items = [
    item({ id: '1', place_id: 'A', day_id: 'd1', status: 'done', sort_key: 10 }),
    item({ id: '2', place_id: 'B', day_id: 'd2', status: 'done', sort_key: 10 }),
    item({ id: '3', place_id: 'C', day_id: 'd2', status: 'done', sort_key: 40 }),
  ];
  const entries = buildEntries({ places, visits: placeVisits({ items, days: DAYS, startDate: START }), userId: 'uj' });
  assert.deepEqual(reviewNudges(entries).map((e) => e.id), ['C', 'B', 'A']);
  // 机场、车站、码头路过而已，不提醒
  const hub = buildEntries({ places: [place({ id: 'H', kind: 'hub' })], visits: placeVisits({ items: [item({ id: '9', place_id: 'H', day_id: 'd1', status: 'done' })], days: DAYS, startDate: START }), userId: 'uj' });
  assert.equal(hub[0].needsReview, true);
  assert.deepEqual(reviewNudges(hub), []);
});

test('备选池筛选：按条目标题、说明、地点名（越南语去声调）搜；选了种类只留那种地点的条目', () => {
  const { places, items } = samplePage();
  const placesById = new Map(places.map((p) => [p.id, p]));
  const pool = [...items.filter((i) => !i.day_id), item({ id: 'x', title: '皮划艇', place_id: null, day_id: null, description: 'kayak' })];
  assert.deepEqual(filterPool(pool, { placesById }).map((r) => r.item.id), ['i4', 'x']);
  assert.deepEqual(filterPool(pool, { query: 'kayak', placesById }).map((r) => r.item.id), ['x']);
  assert.deepEqual(filterPool(pool, { query: '灯塔', placesById })[0].hit, [[1, 3]]);
  assert.deepEqual(filterPool(pool, { kind: 'sight', placesById }).map((r) => r.item.id), ['i4']);
  assert.deepEqual(filterPool(pool, { kind: 'food', placesById }), []);
});

test('页面上的一句话和没结果时的说明', () => {
  assert.equal(summaryLine({ total: 0 }), '');
  assert.equal(summaryLine({ total: 38, shown: 38, rated: 6, wish: 3, filtered: false }), '38 个地点 · 评过 6 个 · 想去 3 个');
  assert.equal(summaryLine({ total: 2, shown: 2, rated: 0, wish: 0, filtered: false }), '2 个地点');
  assert.equal(summaryLine({ total: 38, shown: 6, filtered: true }), '显示 6 个（共 38 个地点）');
  assert.equal(emptyText({ mode: 'kind', query: '', kind: 'all', total: 0, wish: 0 }), null);
  assert.deepEqual(emptyText({ mode: 'want', query: '', kind: 'all', total: 5, wish: 0 }).title, '想去清单还是空的');
  const q = emptyText({ mode: 'kind', query: ' pho ', kind: 'all', total: 5, wish: 1 });
  assert.equal(q.title, '没有找到「pho」');
  assert.equal(q.filtered, true);
  assert.equal(emptyText({ mode: 'want', query: '', kind: 'bar', total: 5, wish: 2 }).title, '这一类还没有地点');
});

// ---------------------------------------------------------------------
// 写评级表单
// ---------------------------------------------------------------------

test('价格：空 = 没填；认得千分位、k、万、越南写法、币种符号；看不懂、0、负数给中文原因', () => {
  assert.deepEqual(parsePrice('', 'VND'), { value: null, error: null });
  assert.deepEqual(parsePrice('  ', 'VND'), { value: null, error: null });
  assert.equal(parsePrice('45k', 'VND').value, 45000);
  assert.equal(parsePrice('4.5万', 'VND').value, 45000);
  assert.equal(parsePrice('450.000', 'VND').value, 450000);
  assert.equal(parsePrice('1tr2', 'VND').value, 1200000);
  assert.equal(parsePrice('HK$88.5', 'HKD').value, 88.5);
  assert.equal(parsePrice('１２０', 'CNY').value, 120);
  assert.match(parsePrice('好贵', 'VND').error, /看不懂/);
  assert.match(parsePrice('0', 'VND').error, /大于 0/);
  assert.match(parsePrice('-5', 'VND').error, /大于 0/);
});

test('手机上输价格：越南盾用纯数字键盘 +「千」按钮（45 → 45,000），不到 1,000 提醒是不是忘了按；港币有小数点', () => {
  assert.equal(wantsThousands('VND'), true);
  assert.equal(wantsThousands('vnd'), true);
  assert.equal(wantsThousands('HKD'), false);
  assert.equal(wantsThousands('CNY'), false);
  assert.equal(priceInputMode('VND'), 'numeric');
  assert.equal(priceInputMode('HKD'), 'decimal');
  assert.equal(timesThousand('45', 'VND'), '45,000');
  assert.equal(timesThousand('1,200', 'VND'), '1,200,000');
  assert.equal(timesThousand('', 'VND'), null, '还没填：按钮不做事');
  assert.equal(timesThousand('好贵', 'VND'), null, '看不懂：按钮不做事');
  assert.equal(timesThousand('2000000000', 'VND'), null, '再乘就超过一万亿：不乘');
  assert.deepEqual(forgotThousands('45', 'VND'), { value: 45000, text: '45,000' });
  assert.equal(forgotThousands('45,000', 'VND'), null);
  assert.equal(forgotThousands('', 'VND'), null);
  assert.equal(forgotThousands('45', 'HKD'), null, '港币 45 很正常');
  assert.equal(parsePrice('45,000', 'VND').value, 45000, '点完「千」的文字能存');
});

test('吃了什么：LogEntry → 表单项 → LogEntry 来回不丢（数量、备注、照片原样保留）；名字为空不保存；价格看不懂不写价格', () => {
  const log = { name: '烤海鲜拼盘', price: { amount: 450000, currency: 'VND' }, qty: 2, rating: 5, note: '要先问价', photo_path: 't/u/reviews/a.jpg' };
  const e = entryFromLog(log, 'VND');
  assert.equal(e.amount, '450,000');
  assert.equal(e.currency, 'VND');
  assert.deepEqual(logFromEntry(e), log);
  assert.deepEqual(logFromEntry(entryFromLog({ name: '椰子', price: { amount: 88.5, currency: 'hkd' } }, 'VND')), { name: '椰子', price: { amount: 88.5, currency: 'HKD' } });
  assert.equal(logFromEntry(newEntry('   ', 'VND')), null);
  assert.deepEqual(logFromEntry({ ...newEntry('粉', 'VND'), amount: '很便宜' }), { name: '粉' });
  assert.equal(newEntry('x'.repeat(200), 'VND').name.length, MAX_NAME);
  assert.notEqual(newEntry('a', 'VND').key, newEntry('a', 'VND').key, '每项的 key 不一样');
});

test('表单：已有评级填好（坏数据跳过）；改没改过只看会保存的内容；什么都没写算空；价格有错的挑出来', () => {
  const existing = review({
    id: 'r', rating: 4, notes: '不错', food_log: [{ name: '粉', price: { amount: 45000, currency: 'VND' } }, null, { price: { amount: 1 } }],
    shop_log: [], photos: [{ path: 't/u/reviews/1.jpg', width: 1200, height: 900 }, { path: '' }],
  });
  const f = initialForm(existing, { currency: 'VND' });
  assert.equal(f.rating, 4);
  assert.equal(f.food.length, 1);
  assert.equal(f.photos.length, 1);
  const k = formKey(f);
  assert.equal(formKey({ ...f, notes: '不错  ' }), k, '前后空白不算改动');
  assert.notEqual(formKey({ ...f, rating: 5 }), k);
  assert.notEqual(formKey({ ...f, food: [...f.food, newEntry('椰子', 'VND')] }), k);
  assert.equal(formKey({ ...f, food: [...f.food, newEntry('', 'VND')] }), k, '空名字的一行不算改动');
  const blank = initialForm(null, { currency: 'VND' });
  assert.deepEqual(blank, { rating: null, notes: '', food: [], shop: [], photos: [] });
  assert.equal(isEmptyForm(blank), true);
  assert.equal(isEmptyForm({ ...blank, notes: '  ' }), true);
  assert.equal(isEmptyForm({ ...blank, rating: 1 }), false);
  assert.equal(isEmptyForm({ ...blank, shop: [newEntry('胡椒', 'VND')] }), false);
  assert.equal(isEmptyForm({ ...blank, photos: [photoFromRow({ path: 'a.jpg' })] }), false);
  const bad = { ...blank, food: [{ ...newEntry('粉', 'VND'), amount: '好贵' }, { ...newEntry('', 'VND'), amount: '好贵' }] };
  assert.deepEqual(priceErrors(bad).map((e) => e.name), ['粉'], '名字是空的那行不管');
});

test('保存的 patch：只放评级的几个字段；评语去空白；照片只留 path 等；关联条目、去的时间只在原来没有时写', () => {
  const form = {
    rating: 5, notes: '  必须再来  ',
    food: [{ ...newEntry('粉', 'VND'), amount: '45k', rating: 4 }, newEntry('', 'VND')],
    shop: [],
    photos: [],
  };
  const photos = [{ path: 't/u/reviews/1.jpg', width: 1200, height: 900, taken_at: null, caption: null, key: 'p1', file: null }];
  const p = buildPatch(form, { photos, itemId: 'i1', visitedAt: '2027-01-11T01:00:00.000Z' });
  assert.deepEqual(p, {
    rating: 5,
    notes: '必须再来',
    food_log: [{ name: '粉', price: { amount: 45000, currency: 'VND' }, rating: 4 }],
    shop_log: [],
    photos: [{ path: 't/u/reviews/1.jpg', width: 1200, height: 900 }],
    item_id: 'i1',
    visited_at: '2027-01-11T01:00:00.000Z',
  });
  const again = buildPatch({ ...form, rating: null, notes: '' }, { photos: [], itemId: 'i2', visitedAt: 'x', existing: { item_id: 'i1', visited_at: 'y' } });
  assert.equal(again.rating, null);
  assert.equal(again.notes, null);
  assert.equal('item_id' in again, false);
  assert.equal('visited_at' in again, false);
});

test('价格能选的币种：当地币在前、本币，再加已有记录里的；去的时间：条目那天的实际 / 计划时间，进行中用现在', () => {
  assert.deepEqual(currencyChoices({ local_currency: 'VND', home_currency: 'HKD' }), ['VND', 'HKD']);
  assert.deepEqual(currencyChoices({ local_currency: 'TWD', home_currency: 'HKD' }, ['twd', 'CNY', null]), ['TWD', 'HKD', 'CNY']);
  assert.deepEqual(currencyChoices({}), ['HKD']);
  const at = visitedAtFor({ item: { start_time: '19:30:00' }, day: { date: '2027-01-10' }, timeZone: 'Asia/Ho_Chi_Minh', ongoing: false, now: new Date(), toInstant: zonedToInstant });
  assert.equal(at, '2027-01-10T12:30:00.000Z');
  const actual = visitedAtFor({ item: { start_time: '19:30', actual_time: '20:10' }, day: { date: '2027-01-10' }, timeZone: 'Asia/Ho_Chi_Minh', ongoing: false, now: new Date(), toInstant: zonedToInstant });
  assert.equal(actual, '2027-01-10T13:10:00.000Z');
  const now = new Date('2027-01-11T03:00:00Z');
  assert.equal(visitedAtFor({ timeZone: 'Asia/Ho_Chi_Minh', ongoing: true, now, toInstant: zonedToInstant }), now.toISOString());
  assert.equal(visitedAtFor({ timeZone: 'Asia/Ho_Chi_Minh', ongoing: false, now, toInstant: zonedToInstant }), null);
});

// ---------------------------------------------------------------------
// 地点详情 → 写评级 → 回到地点详情
// ---------------------------------------------------------------------

test('写评级关掉后回到地点详情：只认同一个地点、30 分钟内、取一次就清掉', () => {
  markReturnToPlace('P1', 1000);
  assert.equal(takeReturnToPlace('P2', 1500), false, '别的地点不算');
  assert.equal(takeReturnToPlace('P1', 1600), false, '取过一次（哪怕没对上）就清掉');
  markReturnToPlace('P1', 1000);
  assert.equal(takeReturnToPlace('P1', 1000 + RETURN_TTL_MS - 1), true);
  markReturnToPlace('P1', 1000);
  assert.equal(takeReturnToPlace('P1', 1000 + RETURN_TTL_MS), false, '太久以前的不算');
  markReturnToPlace(null);
  assert.equal(takeReturnToPlace('P1'), false);
});

// ---------------------------------------------------------------------
// 演示数据整体跑一遍
// ---------------------------------------------------------------------

test('演示数据（demo-island，进行中第 2 天）：每个地点都有一项、按类型 / 按评级每个地点只出现一次、按天覆盖所有排进行程的地点、Jeremy 有去过还没评的地点', () => {
  const db = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));
  const T = db.tables;
  const isl = (t) => T[t].filter((r) => r.trip_id === 'demo-island');
  const trip = T.trips.find((t) => t.id === 'demo-island');
  const days = isl('days').sort((a, b) => a.date.localeCompare(b.date));
  const members = T.trip_members.filter((m) => m.trip_id === 'demo-island').map((m) => ({ ...m, display_name: db.users.find((u) => u.id === m.user_id)?.display_name }));
  const jeremy = db.users.find((u) => u.ref === 'jeremy').id;
  const reviewsByPlace = new Map();
  for (const r of isl('reviews')) reviewsByPlace.set(r.place_id, [...(reviewsByPlace.get(r.place_id) || []), r]);
  const places = isl('places');
  const visits = placeVisits({ items: isl('items'), days, startDate: trip.start_date });
  const today = days.find((d) => d.date === '2027-01-11');
  const entries = buildEntries({ places, visits, reviewsByPlace, members, userId: jeremy, todayId: today.id });
  assert.equal(entries.length, places.length);
  const all = filterEntries(entries);
  for (const mode of ['kind', 'rating']) {
    const ids = groupEntries(all, mode).flatMap((g) => g.rows.map((r) => r.entry.id));
    assert.equal(ids.length, places.length, mode);
    assert.equal(new Set(ids).size, places.length, `${mode}：不重复`);
  }
  const dayGroups = groupEntries(all, 'day', { days, startDate: trip.start_date, todayId: today.id });
  const covered = new Set(dayGroups.flatMap((g) => g.rows.map((r) => r.entry.id)));
  assert.equal(covered.size, places.length, '按天：排进行程的 + 没排进哪天的 = 全部');
  assert.ok(dayGroups.some((g) => g.today), '今天那组标出来');
  const nudges = reviewNudges(entries);
  assert.ok(nudges.length >= 3, `第一天去过的地点里 Jeremy 还没评的（${nudges.length} 个）`);
  for (const n of nudges) assert.equal(n.done.item.status, 'done');
  assert.ok(groupEntries(all, 'want').length === 1);
  assert.ok(groupEntries(all, 'rating')[0].tier === 5);
  // 越南语去声调能搜到
  assert.ok(filterEntries(entries, { query: 'pho' }).length >= 1);
  // 备选池里的条目都能筛出来
  const placesById = new Map(places.map((p) => [p.id, p]));
  const pool = isl('items').filter((i) => !i.day_id && !i.deleted_at);
  assert.equal(filterPool(pool, { placesById }).length, pool.length);
});

// ---------------------------------------------------------------------
// 源码规则
// ---------------------------------------------------------------------

test('地点页 / 地点详情 / 写评级：外链和触感走 lib/native.js；不直接调 supabase；文字是中文', () => {
  const files = [
    'pages/places/PlacesPage.jsx', 'pages/places/model.js', 'sheets/place/PlaceSheet.jsx', 'sheets/place/parts.jsx', 'sheets/place/model.js',
    'sheets/place/flow.js', 'sheets/review/ReviewSheet.jsx', 'sheets/review/form-model.js',
  ];
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /window\.open\(|navigator\.vibrate|location\.href\s*=/, `${f} 不直接开外链 / 震动`);
    assert.doesNotMatch(text, /supabase/i, `${f} 不直接调 supabase`);
    for (const m of text.matchAll(/(?:from|import) ['"](\.{1,2}\/[^'"]+)['"]/g)) assert.match(m[1], /\.(js|jsx|css)$/, `${f}：${m[1]} 写完整扩展名`);
  }
});
