// 地图页的纯逻辑（src/pages/map/model.js）：筛选和网址、按天的颜色、地点在哪几天、地图模型（全部 / 某一天：标记、编号、连线、
// 备选淡化、没坐标的列表、空状态）、左上角概况、距离、远看缩成小圆点、底图配置和离线提示、定位失败的说明。
// 数据从演示数据库算（demo/demo-db.json，全部虚构），不写死数字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL, DAY_TONE_COUNT, FAR_AWAY_KM, GEO_ERRORS, NEUTRAL_TONE, OUTLIER_KM, buildMapModel, cardParts, dayNumberOf, dayShort, dayTone, declutter, distanceFrom, firstVisit,
  filterOptions, filterQuery, fitPoints, formatDistance, locationErrorInfo, markerAriaLabel, nearestDistance, ordersBadge, ordersLabel, placeLatLng,
  placeSubtitle, placeVisits, precisionNote, precisionOf, resolveFilter, routeLines, summaryLine, tileBanner, tileLayerSpec, tileStatusReducer,
} from '../../src/pages/map/model.js';
import { dayRoute as routeOfItems } from '../../src/lib/map/geo.js';
import { CSP_SOURCES } from '../../scripts/lib/csp.mjs';
import { glyphParts } from '../../src/kit/glyph-dom.js';
import { GLYPHS } from '../../src/kit/glyphs.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));

/** 一趟演示行程：排好序的天、地点、按天的条目、当天路线（和数据层 selectors.dayRoute 同一份连线计算） */
function bundle(tripId) {
  const rows = (t) => DB.tables[t].filter((r) => r.trip_id === tripId);
  const trip = DB.tables.trips.find((t) => t.id === tripId);
  const days = rows('days').sort((a, b) => a.date.localeCompare(b.date));
  const places = rows('places');
  const placeById = new Map(places.map((p) => [p.id, p]));
  const itemsByDay = new Map();
  for (const it of rows('items')) {
    if (it.deleted_at) continue;
    const k = it.day_id ?? null;
    if (!itemsByDay.has(k)) itemsByDay.set(k, []);
    itemsByDay.get(k).push(it);
  }
  for (const list of itemsByDay.values()) list.sort((a, b) => (a.sort_key - b.sort_key) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  const routeOf = (dayId) => {
    const items = itemsByDay.get(dayId) || [];
    const { points, legs } = routeOfItems(items, placeById);
    const missing = items.filter((it) => it.variant === 'primary' && it.place_id && placeById.get(it.place_id)?.lat == null).map((it) => ({ itemId: it.id, placeId: it.place_id }));
    return { points, legs, missing };
  };
  return { trip, days, places, placeById, itemsByDay, routeOf, tripStart: trip.start_date };
}

const island = bundle('demo-island');
const island0 = () => island;
const cities = bundle('demo-cities');
const empty = bundle('demo-empty');

// ---------------------------------------------------------------------
// 筛选、天的颜色
// ---------------------------------------------------------------------

test('筛选：行程进行中默认今天，否则全部；?day= 写日期或 day id 都认，写错退回默认', () => {
  const { days } = island;
  const today = days[1].date;
  assert.deepEqual(resolveFilter({ query: {}, days, todayDate: today, phase: 'ongoing' }), { value: days[1].id, defaultValue: days[1].id, explicit: false });
  assert.deepEqual(resolveFilter({ query: {}, days, todayDate: today, phase: 'upcoming' }), { value: ALL, defaultValue: ALL, explicit: false });
  assert.equal(resolveFilter({ query: { day: days[2].date }, days, phase: 'upcoming' }).value, days[2].id);
  assert.equal(resolveFilter({ query: { day: days[2].id }, days, phase: 'upcoming' }).value, days[2].id);
  assert.equal(resolveFilter({ query: { day: ALL }, days, todayDate: today, phase: 'ongoing' }).value, ALL);
  assert.equal(resolveFilter({ query: { day: '2099-01-01' }, days, todayDate: today, phase: 'ongoing' }).value, days[1].id);
  assert.equal(resolveFilter({ query: { day: 'nope' }, days, phase: 'ended' }).value, ALL);
});

test('网址 ?day=：等于默认值就不写，某一天写日期，全部写 all', () => {
  const { days } = island;
  assert.equal(filterQuery(ALL, { defaultValue: ALL, days }), null);
  assert.equal(filterQuery(days[0].id, { defaultValue: ALL, days }), days[0].date);
  assert.equal(filterQuery(ALL, { defaultValue: days[1].id, days }), ALL);
  assert.equal(filterQuery(days[1].id, { defaultValue: days[1].id, days }), null);
  assert.equal(filterQuery('nope', { defaultValue: ALL, days }), null);
});

test('天的颜色：D1–D7 轮流用七个分类色，第 8 天又从头来；没排进哪天的用第 8 个（灰）', () => {
  assert.equal(DAY_TONE_COUNT, 7);
  assert.equal(NEUTRAL_TONE, 8);
  assert.deepEqual([1, 2, 7, 8, 9].map(dayTone), [1, 2, 7, 1, 2]);
  assert.equal(dayTone(0), NEUTRAL_TONE);
  assert.equal(dayTone(null), NEUTRAL_TONE);
  assert.equal(dayShort(3), 'D3');
  assert.equal(dayShort(null), '');
  assert.equal(dayNumberOf('2027-01-12', '2027-01-10'), 3);
  assert.equal(dayNumberOf(null, '2027-01-10'), null);
});

test('筛选条的选项：全部（地点数）+ 每一天（D1…、日期 + 周几、今天、那一天的颜色和地点数）', () => {
  const { days, tripStart } = island;
  const model = buildMapModel({ filter: ALL, ...island });
  const opts = filterOptions({ days, tripStart, todayDate: days[1].date, phase: 'ongoing', counts: model.counts, total: model.total });
  assert.equal(opts.length, days.length + 1);
  assert.equal(opts[0].value, ALL);
  assert.equal(opts[0].big, '全部');
  assert.match(opts[0].top, /\d+ 处/);
  assert.equal(opts[1].big, 'D1');
  assert.equal(opts[1].tone, 1);
  assert.equal(opts[2].today, true);
  assert.equal(opts[2].top, '今天');
  assert.match(opts[2].label, /今天/);
  assert.ok(opts[1].count > 0, '每天都有地点数');
  // 九天的行程：D9 用回第 2 个颜色
  const c = filterOptions({ days: cities.days, tripStart: cities.tripStart, phase: 'ended', counts: new Map(), total: 0 });
  assert.equal(c.length, 10);
  assert.equal(c[9].big, 'D9');
  assert.equal(c[9].tone, dayTone(9));
  assert.equal(c[0].top, '地点');
});

// ---------------------------------------------------------------------
// 地点和地图模型
// ---------------------------------------------------------------------

test('地点在哪几天：主方案、备选、雨天都算，同一条条目里同一个地点只记一次；步行路线里写了 place_id 的点也算', () => {
  const visits = placeVisits({ days: island.days, itemsByDay: island.itemsByDay, tripStart: island.tripStart });
  assert.ok(visits.size > 0);
  for (const [placeId, vs] of visits) {
    assert.ok(island.placeById.has(placeId), '只记认识的地点');
    const keys = vs.map((v) => `${v.dayId}|${v.itemId}`);
    assert.equal(new Set(keys).size, keys.length, '同一条条目不重复');
    for (const v of vs) assert.ok(v.n >= 1 && v.n <= island.days.length);
  }
  const variants = new Set([...visits.values()].flat().map((v) => v.variant));
  assert.ok(variants.has('primary') && (variants.has('backup') || variants.has('rain')), '备选 / 雨天也记了');
  const stops = [...visits.values()].flat().filter((v) => v.stop);
  assert.ok(stops.length > 0, '步行路线的点');
});

test('坐标和精度：只认地点自己的坐标（没有不退回分段中心）；approximate / city 标出来', () => {
  const p = island.places.find((x) => x.lat != null);
  assert.deepEqual(placeLatLng(p), { lat: Number(p.lat), lng: Number(p.lng) });
  assert.equal(placeLatLng(island.places.find((x) => x.lat == null)), null);
  assert.equal(placeLatLng({ lat: 0, lng: 200 }), null);
  assert.equal(precisionOf({ coord_precision: 'approximate' }), 'approximate');
  assert.equal(precisionOf({ coord_precision: 'city' }), 'city');
  assert.equal(precisionOf({}), 'exact');
  assert.equal(precisionNote('approximate'), '大概位置');
  assert.equal(precisionNote('exact'), '');
  assert.match(placeSubtitle({ name: '海边餐厅', name_local: 'Nha hang', kind: 'food' }), /^Nha hang · 餐厅$/);
  assert.equal(placeSubtitle({ name: '同名', name_local: '同名', kind: 'hub' }), '交通站点');
});

test('全部：每个有坐标的地点一个标记（颜色 = 第一次出现在主方案的那一天；只在备选里 = 淡化；没排进哪天 = 灰），每天的路线都画但淡；没坐标的在 missing', () => {
  const m = buildMapModel({ filter: ALL, ...island });
  const withCoords = island.places.filter((p) => p.lat != null);
  assert.equal(m.filter, ALL);
  assert.equal(m.day, null);
  assert.equal(m.markers.length, withCoords.length);
  assert.equal(m.missing.length, island.places.length - withCoords.length);
  assert.equal(m.total, island.places.length);
  assert.equal(m.empty, null);
  assert.ok(m.markers.every((x) => x.orders.length === 0), '看全部时不编号');
  assert.ok(m.markers.every((x) => x.tone >= 1 && x.tone <= 8));
  assert.ok(m.routes.length > 0 && m.routes.every((r) => r.muted), '每天的路线都画、都是淡的');
  assert.ok(m.bounds, '有取景范围');
  // 列表按天分组 + 没排进哪天
  assert.ok(m.groups.length >= island.days.length);
  assert.ok(m.groups.every((g) => g.rows.length > 0));
  const unscheduled = m.markers.filter((x) => x.unscheduled);
  const loose = m.groups.find((g) => g.key === 'unscheduled');
  if (unscheduled.length) {
    assert.ok(loose, '没排进哪天的那一组');
    assert.equal(loose.rows.length, unscheduled.length);
    assert.ok(unscheduled.every((x) => x.tone === NEUTRAL_TONE));
  }
  for (const d of island.days) assert.ok(m.counts.get(d.id) > 0, '每天的地点数');
  const miss = m.missing[0];
  assert.equal(miss.hasCoords, false);
  assert.match(miss.subtitle, /有地址|没有地址/);
});

test('某一天：主方案路线点按顺序编号、同一地点去两次写「1·9」、备选淡化不编号、按交通方式分实线 / 点线、颜色 = 这一天的', () => {
  const day = island.days[1];
  const m = buildMapModel({ filter: day.id, ...island });
  const route = island.routeOf(day.id);
  assert.equal(m.day.id, day.id);
  assert.equal(m.n, 2);
  assert.equal(m.tone, dayTone(2));
  assert.equal(m.stops, route.points.length);
  const numbered = m.markers.filter((x) => x.orders.length);
  const totalOrders = numbered.reduce((acc, x) => acc + x.orders.length, 0);
  assert.equal(totalOrders, route.points.length, '每个路线点都有一个序号');
  for (const x of numbered) assert.ok(x.orders.every((o) => o >= 1 && o <= route.points.length));
  assert.ok(numbered.every((x) => x.tone === m.tone && !x.muted));
  const alts = m.markers.filter((x) => x.alternative);
  assert.ok(alts.every((x) => x.muted && x.orders.length === 0), '备选 / 雨天淡化不编号');
  assert.ok(m.routes.length > 0 && m.routes.every((r) => !r.muted && r.tone === m.tone));
  const styles = new Set(m.routes.map((r) => r.style));
  assert.ok(styles.has('solid'), '有实线');
  // 列表：当天路线一组（按顺序），备选一组（淡）
  assert.equal(m.groups[0].title, '当天路线');
  assert.deepEqual(m.groups[0].rows.map((r) => r.orders[0]), m.groups[0].rows.map((r) => r.orders[0]).slice().sort((a, b) => a - b));
  const altGroup = m.groups.find((g) => g.muted);
  if (alts.length) {
    assert.ok(altGroup);
    assert.ok(altGroup.rows.every((r) => r.muted && /备选|雨天/.test(r.subtitle)));
  }
  // 步行路线：有点线、有不是地点的路线点
  const walkDay = island.days.find((d) => (island.itemsByDay.get(d.id) || []).some((it) => it.kind === 'walk_route' && it.variant === 'primary'));
  if (walkDay) {
    const w = buildMapModel({ filter: walkDay.id, ...island });
    assert.ok(w.routes.some((r) => r.style === 'dotted'), '步行是点线');
  }
});

test('同一个地点去两次：标记上写「1·9」，列表一行', () => {
  const place = island.places.find((p) => p.lat != null);
  const days = [island.days[0]];
  const items = [1, 2, 3].map((i) => ({ id: `it${i}`, day_id: days[0].id, sort_key: i * 10, variant: 'primary', kind: 'food', place_id: i === 2 ? island.places.find((p) => p.lat != null && p.id !== place.id).id : place.id, start_time: `0${i + 8}:00:00` }));
  const itemsByDay = new Map([[days[0].id, items]]);
  const routeOf = (id) => ({ ...routeOfItems(itemsByDay.get(id), island.placeById), missing: [] });
  const m = buildMapModel({ filter: days[0].id, days, places: island.places, itemsByDay, routeOf, tripStart: island.tripStart });
  const twice = m.markers.find((x) => x.placeId === place.id);
  assert.deepEqual(twice.orders, [1, 3]);
  assert.equal(ordersBadge(twice.orders), '1·3');
  assert.equal(ordersLabel(twice.orders), '第 1、3 站');
  assert.equal(ordersBadge([4, 5, 6]), '4·5…');
  assert.equal(m.groups[0].rows.length, 2);
  assert.match(markerAriaLabel(twice), /^第 1、3 站 /);
});

test('“现在”这一条的地点：标记和列表行标出来', () => {
  const day = island.days[0];
  const route = island.routeOf(day.id);
  const nowPlaceId = route.points.find((p) => p.placeId)?.placeId;
  const m = buildMapModel({ filter: day.id, ...island, nowPlaceId });
  assert.ok(m.markers.find((x) => x.placeId === nowPlaceId)?.now);
  assert.ok(m.groups[0].rows.find((r) => r.placeId === nowPlaceId)?.now);
  assert.ok(m.markers.filter((x) => x.now).length === 1);
});

test('空状态：没有地点 / 地点都没坐标 / 这一天没有带坐标的地点；已结束的 9 天行程照常', () => {
  const e = buildMapModel({ filter: ALL, ...empty });
  assert.equal(e.empty, 'no-places');
  assert.equal(e.markers.length, 0);
  assert.equal(e.bounds, null);
  const noCoords = { ...island, places: island.places.map((p) => ({ ...p, lat: null, lng: null })) };
  noCoords.placeById = new Map(noCoords.places.map((p) => [p.id, p]));
  noCoords.routeOf = () => ({ points: [], legs: [], missing: [] });
  const n = buildMapModel({ filter: ALL, ...noCoords });
  assert.equal(n.empty, 'no-coords');
  assert.equal(n.missing.length, island.places.length);
  const d = buildMapModel({ filter: island.days[0].id, ...noCoords });
  assert.equal(d.empty, 'day-empty');
  const c = buildMapModel({ filter: ALL, ...cities });
  assert.equal(c.empty, null);
  assert.equal(c.markers.length, cities.places.filter((p) => p.lat != null).length);
  assert.equal(c.counts.size, 9);
});

test('路线折线：相邻同样式的段合成一条；只有一个点画不出线', () => {
  const route = { points: [{ lat: 10, lng: 103 }, { lat: 10.01, lng: 103 }, { lat: 10.02, lng: 103 }, { lat: 10.03, lng: 103 }], legs: [{ from: 0, to: 1, mode: 'grab' }, { from: 1, to: 2, mode: 'taxi' }, { from: 2, to: 3, mode: 'walk' }] };
  const lines = routeLines('d1', route, 3, false);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].style, 'solid');
  assert.equal(lines[0].points.length, 3);
  assert.equal(lines[1].style, 'dotted');
  assert.deepEqual(routeLines('d1', { points: [{ lat: 1, lng: 1 }], legs: [] }, 1, true), []);
});

test('左上角概况：某一天「D2 · 日期 周几 · N 处」，全部「全部 · N 处」；没坐标的另说', () => {
  const all = summaryLine(buildMapModel({ filter: ALL, ...island }));
  assert.match(all.text, /^全部 · \d+ 处$/);
  assert.match(all.warn, /^\d+ 处没坐标$/);
  const d = summaryLine(buildMapModel({ filter: island.days[1].id, ...island }));
  assert.match(d.text, /^D2 · 1月11日 周一 · \d+ 处$/);
  const e = summaryLine(buildMapModel({ filter: ALL, ...empty }));
  assert.equal(e.text, '全部 · 0 处');
  assert.equal(e.warn, null);
});

// ---------------------------------------------------------------------
// 距离、小圆点
// ---------------------------------------------------------------------

test('距离：「就在附近」/ 米 / 公里；我和最近的地点多远；离行程地点超过 60 公里算“人还没到”', () => {
  assert.equal(formatDistance(0.02), '就在附近');
  assert.equal(formatDistance(0.35), '350 米');
  assert.equal(formatDistance(1.24), '1.2 公里');
  assert.equal(formatDistance(1.0), '1 公里');
  assert.equal(formatDistance(18.4), '18 公里');
  assert.equal(formatDistance(1480), '1,480 公里');
  assert.equal(formatDistance(null), '');
  assert.equal(formatDistance(-1), '');
  const a = { lat: 10.2, lng: 103.96 };
  const b = { lat: 10.21, lng: 103.96 };
  const d = distanceFrom(a, b);
  assert.ok(d > 1.05 && d < 1.2, `纬度差 0.01 度约 1.1 公里：${d}`);
  assert.equal(distanceFrom(null, b), null);
  assert.equal(nearestDistance(a, [b, { lat: 10.3, lng: 103.96 }]), d);
  assert.equal(nearestDistance(a, []), null);
  assert.equal(FAR_AWAY_KM, 60);
});

test('取景的点：出发地的机场（离行程区域 1,000 多公里）不算进取景但仍然计数；有分段中心按中心算，没有就取最大的一群；两个点时留目的地那个', () => {
  const island = [[10.2, 103.96], [10.22, 103.97], [10.1, 104.0], [10.3, 103.9]];
  const hk = [22.31, 113.92];
  const withCenters = fitPoints([hk, ...island], { centers: [{ lat: 10.2, lng: 103.95 }] });
  assert.equal(withCenters.far, 1);
  assert.deepEqual(withCenters.points, island);
  const noCenters = fitPoints([hk, ...island]);
  assert.equal(noCenters.far, 1);
  assert.deepEqual(noCenters.points, island);
  // 出发日只有两个点：香港机场 → 目的地机场，留后面的目的地
  assert.deepEqual(fitPoints([hk, island[0]]), { points: [island[0]], far: 1 });
  // 都在一起：一个都不排除；一个点、没有点
  assert.equal(fitPoints(island).far, 0);
  assert.deepEqual(fitPoints([hk]), { points: [hk], far: 0 });
  assert.deepEqual(fitPoints([]), { points: [], far: 0 });
  // 分段中心离所有点都很远（数据填错）：退回最大的一群
  assert.equal(fitPoints([hk, ...island], { centers: [{ lat: 0, lng: 0 }] }).far, 1);
  assert.equal(OUTLIER_KM, 300);
  // 模型：演示岛的点都在一起 → far 0，取景点 = 全部
  const m = buildMapModel({ filter: ALL, ...island0() });
  assert.equal(m.far, 0);
  assert.equal(m.fitPoints.length, m.markers.length + m.routes.filter((r) => !r.muted).reduce((acc, r) => acc + r.points.length, 0));
  assert.equal(summaryLine(m).far, null);
  // 加一个很远的地点：取景不算它、概况里写「另有 1 处很远」
  const farPlace = { ...island0().places[0], id: 'far', name: '出发机场', lat: 22.31, lng: 113.92, kind: 'hub' };
  const withFar = { ...island0(), places: [...island0().places, farPlace] };
  const mf = buildMapModel({ filter: ALL, ...withFar, centers: [{ lat: island0().places[1].lat, lng: island0().places[1].lng }] });
  assert.equal(mf.far, 1);
  assert.equal(mf.markers.length, m.markers.length + 1, '很远的点仍然画');
  assert.equal(summaryLine(mf).far, '另有 1 处很远');
});

test('远看挤在一起的标记：普通的缩成小圆点（34px 内有别的）；编了号的只和别的路线点比、挤了缩成只剩序号的小圆（28px）；选中的、“现在”的不缩', () => {
  const pts = [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: 200, y: 200 }, { id: 'd', x: 205, y: 190, keep: true },
    { id: 'e', x: 400, y: 400, keep: true }, { id: 'f', x: 410, y: 405, keep: true }, { id: 'g', x: 600, y: 600, keep: true, pinned: true }, { id: 'h', x: 605, y: 605, keep: true },
  ];
  const shapes = declutter(pts);
  assert.deepEqual([...shapes].sort(), [['a', 'dot'], ['b', 'dot'], ['c', 'dot'], ['e', 'mini'], ['f', 'mini'], ['h', 'mini']]);
  assert.equal(shapes.get('d'), undefined, '路线点旁边只有普通标记：不缩');
  assert.equal(shapes.get('g'), undefined, '选中 / 现在：不缩');
  assert.equal(declutter(pts, 34, { minPxKeep: 4 }).get('e'), undefined, '阈值可调');
  assert.equal(declutter([], 34).size, 0);
  assert.equal(declutter([{ id: 'x', x: 0, y: 0 }]).size, 0);
});

// ---------------------------------------------------------------------
// 底图、离线、定位
// ---------------------------------------------------------------------

test('底图：没有 CARTO key 用 OpenStreetMap（深色加滤镜类），有 key 用 CARTO voyager / dark；署名是结构化列表；域名都在 CSP 里', () => {
  const light = tileLayerSpec({ scheme: 'light' });
  assert.equal(light.provider, 'osm');
  assert.match(light.url, /^https:\/\/tile\.openstreetmap\.org\//);
  assert.doesNotMatch(light.className, /dark-filter/);
  assert.deepEqual(light.attribution.map((a) => a.text), ['© OpenStreetMap 贡献者']);
  assert.ok(light.attribution.every((a) => /^https:\/\//.test(a.href)));
  const dark = tileLayerSpec({ scheme: 'dark' });
  assert.match(dark.className, /mp-tiles--dark-filter/);
  const carto = tileLayerSpec({ scheme: 'dark', cartoKey: 'k' });
  assert.equal(carto.provider, 'carto');
  assert.match(carto.url, /dark_all.*\?key=k$/);
  assert.match(tileLayerSpec({ scheme: 'light', cartoKey: 'k' }).url, /rastertiles\/voyager/);
  assert.equal(carto.attribution.length, 2);
  // 瓦片域名已经在 CSP 的 img-src 里（外壳阶段加的）：换底图要改 scripts/lib/csp.mjs
  const hosts = CSP_SOURCES.img;
  assert.ok(hosts.includes('https://tile.openstreetmap.org'));
  assert.ok(hosts.includes('https://*.basemaps.cartocdn.com'));
});

test('底图状态：断网且有瓦片失败 → 「离线中，地图底图加载不了」；联网时一块都没成功或失败明显多于成功才提示；偶尔一两块不打扰', () => {
  let s = tileStatusReducer(null, { type: 'reset' });
  assert.equal(tileBanner(s), null);
  s = tileStatusReducer(s, { type: 'error' });
  assert.match(tileBanner(s).title, /加载不了/);
  assert.equal(tileBanner(s).offline, false);
  s = tileStatusReducer(s, { type: 'load' });
  s = tileStatusReducer(s, { type: 'load' });
  assert.equal(tileBanner(s), null, '加载成功的比失败的多：不提示');
  for (let i = 0; i < 4; i += 1) s = tileStatusReducer(s, { type: 'error' });
  assert.ok(tileBanner(s), '失败 5 块、成功 2 块：提示');
  s = tileStatusReducer(s, { type: 'offline' });
  const off = tileBanner(s);
  assert.equal(off.offline, true);
  assert.equal(off.title, '离线中，地图底图加载不了');
  assert.match(off.detail, /照常能用/);
  s = tileStatusReducer(s, { type: 'online' });
  assert.equal(tileBanner(s), null, '联网重新起算');
  assert.equal(tileBanner(null), null);
  // 断网但缓存里的瓦片都显示出来了（没有失败）：不提示
  let cached = tileStatusReducer(null, { type: 'offline' });
  cached = tileStatusReducer(cached, { type: 'load' });
  assert.equal(tileBanner(cached), null);
});

test('定位失败的说明：被拒时说清楚 iPhone 上在哪里打开（设置 → 隐私 → 定位服务 / Safari）；超时、定不到、不支持各有一句话', () => {
  const denied = locationErrorInfo(GEO_ERRORS.DENIED);
  assert.equal(denied.title, '没有定位权限');
  assert.ok(denied.steps.length >= 3);
  assert.ok(denied.steps.some((s) => /定位服务/.test(s)) && denied.steps.some((s) => /Safari/.test(s)));
  assert.equal(locationErrorInfo(GEO_ERRORS.TIMEOUT).title, '定位超时');
  assert.equal(locationErrorInfo(GEO_ERRORS.UNAVAILABLE).steps.length, 0);
  assert.equal(locationErrorInfo(GEO_ERRORS.UNSUPPORTED).tone, 'danger');
  assert.equal(locationErrorInfo(99).code, GEO_ERRORS.UNSUPPORTED);
  for (const code of [0, 1, 2, 3]) {
    const info = locationErrorInfo(code);
    assert.match(info.title, /[一-鿿]/);
    assert.match(info.message, /[一-鿿]/);
  }
});

test('地图页的图形（整合后在 kit/glyphs.js）：定位 / 显示全部 / 图层 / 离线都在，和 kit 同一种笔法；DOM 画图形找不到的退回定位针', () => {
  for (const name of ['locate', 'fit', 'layers', 'offline']) {
    assert.ok(GLYPHS[name], `${name} 在 kit/glyphs.js 里`);
    for (const [tag, attrs] of GLYPHS[name]) {
      assert.ok(['path', 'circle'].includes(tag), `${name} 用了 ${tag}`);
      if (tag === 'circle') assert.ok(attrs.cx >= 0 && attrs.cx <= 24 && attrs.cy >= 0 && attrs.cy <= 24);
    }
  }
  assert.equal(glyphParts('locate'), GLYPHS.locate);
  assert.equal(glyphParts('plus'), GLYPHS.plus);
  assert.equal(glyphParts('nope'), GLYPHS.pin);
});

test('小卡副标题：某一天「第 N 站 · 时间 · 当地语名 · 种类」；全部「D2 时间」、去了好几天「D1 · D3」；备选 / 没排进哪天各有说法；大概位置、离你多远接在后面', () => {
  const day = island.days[1];
  const m = buildMapModel({ filter: day.id, ...island });
  const numbered = m.markers.find((x) => x.orders.length && x.placeId && firstVisit(x)?.time);
  assert.ok(numbered, '有带时间的路线点');
  const parts = cardParts(numbered);
  assert.equal(parts[0], ordersLabel(numbered.orders));
  assert.equal(parts[1], firstVisit(numbered).time);
  assert.ok(parts.includes(numbered.subtitle));
  assert.ok(!parts.some((p) => /离你/.test(p)), '没定位就不写距离');
  // 全部：第一次出现的那一天 + 时间；去了好几天只写天
  const all = buildMapModel({ filter: ALL, ...island });
  const once = all.markers.find((x) => x.days.length === 1 && !x.muted && !x.unscheduled && firstVisit(x)?.time);
  assert.match(cardParts(once)[0], /^D\d+ \d{1,2}:\d{2}/);
  const twice = all.markers.find((x) => x.days.length > 1);
  if (twice) assert.match(cardParts(twice)[0], /^D\d+ · D\d+/);
  // 合成的几种
  const base = { subtitle: 'Nha hang · 餐厅', precision: 'exact', orders: [], days: [{ n: 2, tone: 2 }], visits: [{ n: 2, time: '12:00', variant: 'backup' }] };
  assert.deepEqual(cardParts({ ...base, muted: true, alternative: true }), ['备选 / 雨天', '12:00', 'Nha hang · 餐厅']);
  assert.deepEqual(cardParts({ ...base, muted: true }), ['只在备选里', '12:00', 'Nha hang · 餐厅']);
  assert.deepEqual(cardParts({ ...base, unscheduled: true, days: [], visits: [] }), ['没排进哪天', 'Nha hang · 餐厅']);
  assert.deepEqual(cardParts({ ...base, precision: 'approximate' }, { distance: 1.24 }), ['D2 12:00', 'Nha hang · 餐厅', '大概位置', '离你 1.2 公里']);
  assert.deepEqual(cardParts({ ...base, orders: [1, 9], visits: [{ n: 2, time: '', variant: 'primary' }] }), ['第 1、9 站', 'Nha hang · 餐厅']);
  assert.deepEqual(cardParts({ title: '路线点', subtitle: '步行路线上的点', orders: [4], stop: true }), ['第 4 站', '步行路线上的点']);
  assert.equal(firstVisit({}), null);
});
