// lib/maps-links.js（Google 地图链接）和 lib/map/geo.js（地图纯函数：底图、边界、留白、距离、当天路线）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  travelModeFor, isSafeHttpUrl, coordText, placeQuery, googleMapsPlaceUrl, googleMapsSearchUrl, googleMapsNavigateUrl,
  googleMapsRouteUrls, googleMapsRouteUrl,
} from '../../src/lib/maps-links.js';
import {
  tileUrlFor, tileLayerConfig, CARTO_TILES, OSM_TILES, CARTO_BASEMAPS_KEY, isValidLatLng, toLatLng, boundsOf, normalizePadding, addPadding, haversineKm, pathDistanceKm,
  placePoint, sortDayItems, arrivalMode, dayRoute, sameLatLngs, routeStyleFor,
} from '../../src/lib/map/geo.js';
import { CSP_SOURCES } from '../../scripts/lib/csp.mjs';

const qs = (url) => Object.fromEntries(new URL(url).searchParams);

test('交通方式 → Google 出行方式', () => {
  assert.equal(travelModeFor('walk'), 'walking');
  assert.equal(travelModeFor('grab'), 'driving');
  assert.equal(travelModeFor('scooter'), 'driving');
  assert.equal(travelModeFor('metro'), 'transit');
  assert.equal(travelModeFor('ferry'), 'transit');
  assert.equal(travelModeFor('bicycle'), 'bicycling');
  assert.equal(travelModeFor('transit'), 'transit', '已经是 Google 写法');
  assert.equal(travelModeFor('flight'), null);
  assert.equal(travelModeFor(null), null);
});

test('地点链接：有坐标用坐标（带 place_id），没坐标用当地名 + 地址，maps_url 优先，危险链接不用', () => {
  const hotel = { name: '椰影湾酒店', name_local: 'Khách sạn Vịnh Dừa', lat: 8.68, lng: 106.606, google_place_id: 'ChIJ_demo' };
  const u = googleMapsPlaceUrl(hotel);
  assert.ok(u.startsWith('https://www.google.com/maps/search/?api=1&'));
  assert.deepEqual(qs(u), { api: '1', query: '8.68,106.606', query_place_id: 'ChIJ_demo' });
  assert.ok(u.includes('query=8.68,106.606'), '逗号保持可读');
  assert.deepEqual(qs(googleMapsPlaceUrl({ name: '清晨粉店', name_local: 'Quán phở Sáng', address: '（虚构地址）' })), { api: '1', query: 'Quán phở Sáng （虚构地址）' });
  assert.deepEqual(qs(googleMapsPlaceUrl({ name: '只有中文名' })), { api: '1', query: '只有中文名' });
  assert.equal(googleMapsPlaceUrl({ ...hotel, maps_url: 'https://maps.example.com/x' }), 'https://maps.example.com/x');
  assert.ok(googleMapsPlaceUrl({ ...hotel, maps_url: 'javascript:alert(1)' }).startsWith('https://www.google.com/maps/search/'));
  assert.equal(googleMapsPlaceUrl({}), null);
  assert.equal(googleMapsPlaceUrl(null), null);
  assert.deepEqual(qs(googleMapsPlaceUrl('椰影夜市')), { api: '1', query: '椰影夜市' });
  assert.deepEqual(qs(googleMapsSearchUrl('药房 near 椰影镇')), { api: '1', query: '药房 near 椰影镇' });
  assert.equal(googleMapsSearchUrl('  '), null);
  // 坐标为 null / 越界：不当坐标用
  assert.equal(placeQuery({ name: 'x', lat: null, lng: null }).query, 'x');
  assert.equal(placeQuery({ name: 'x', lat: 95, lng: 10 }).query, 'x');
  assert.equal(coordText(8.680000001, 106.6), '8.68,106.6');
  assert.ok(isSafeHttpUrl('https://example.com'));
  assert.ok(!isSafeHttpUrl('ftp://example.com'));
  assert.ok(!isSafeHttpUrl('not a url'));
});

test('导航链接：终点、出行方式、手机直接进入导航；可指定起点', () => {
  const dest = { name: '北滩', lat: 8.71, lng: 106.625, google_place_id: 'P1' };
  assert.deepEqual(qs(googleMapsNavigateUrl(dest, { mode: 'walk' })), {
    api: '1', destination: '8.71,106.625', destination_place_id: 'P1', travelmode: 'walking', dir_action: 'navigate',
  });
  assert.deepEqual(qs(googleMapsNavigateUrl(dest, { mode: 'flight', navigate: false, origin: { lat: 8.68, lng: 106.606 } })), {
    api: '1', origin: '8.68,106.606', destination: '8.71,106.625', destination_place_id: 'P1',
  });
  assert.equal(googleMapsNavigateUrl({}), null);
});

test('多点路线：途经点超过上限自动分段，段与段首尾相接；place_id 要么全带要么不带', () => {
  const pts = Array.from({ length: 9 }, (_, i) => ({ lat: 8.6 + i / 100, lng: 106.6, google_place_id: `P${i}` }));
  const parts = googleMapsRouteUrls(pts, { mode: 'scooter' });
  assert.equal(parts.length, 2, '手机上限 3 个途经点：每段 5 个点，9 个点分两段');
  assert.deepEqual(parts.map((p) => [p.from, p.to, p.label]), [[0, 4, '第 1 段（1–5）'], [4, 8, '第 2 段（5–9）']]);
  const first = qs(parts[0].url);
  assert.equal(first.origin, '8.6,106.6');
  assert.equal(first.destination, '8.64,106.6');
  assert.equal(first.waypoints, '8.61,106.6|8.62,106.6|8.63,106.6');
  assert.equal(first.waypoint_place_ids, 'P1|P2|P3');
  assert.equal(first.travelmode, 'driving');
  assert.equal(qs(parts[1].url).origin, '8.64,106.6', '第 2 段从第 1 段的终点出发');
  assert.ok(parts[0].url.includes('waypoints=8.61,106.6|8.62,106.6|8.63,106.6'), '竖线保持可读');

  const desktop = googleMapsRouteUrls(pts, { maxWaypoints: 9 });
  assert.equal(desktop.length, 1);
  assert.equal(desktop[0].label, '全程');
  assert.equal(qs(desktop[0].url).waypoints.split('|').length, 7);

  const mixed = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2, google_place_id: 'A' }, { lat: 3, lng: 3 }, { lat: 4, lng: 4 }];
  assert.equal(qs(googleMapsRouteUrl(mixed)).waypoint_place_ids, undefined, '有途经点缺 place_id：都不带');
  // 没法定位的点被跳过，下标对应原数组
  const withGaps = [{ lat: 1, lng: 1 }, {}, null, { name: '终点名' }];
  const r = googleMapsRouteUrls(withGaps);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].from, r[0].to], [0, 3]);
  assert.equal(qs(r[0].url).destination, '终点名');
  assert.deepEqual(googleMapsRouteUrls([{ lat: 1, lng: 1 }]), [], '少于两个点没有路线');
  assert.deepEqual(googleMapsRouteUrls(null), []);
  // 刚好 5 个点（3 个途经点）不分段
  assert.equal(googleMapsRouteUrls(pts.slice(0, 5)).length, 1);
  assert.equal(googleMapsRouteUrls(pts.slice(0, 6)).length, 2);
  assert.equal(googleMapsRouteUrls(pts.slice(0, 3), { maxWaypoints: 0 }).length, 2, '上限 0：每段两个点');
});

test('底图：有 CARTO key 用 light_all / dark_all（带 key）；没有 key 用 OSM，深色加压暗滤镜；域名都在 CSP 里放行', () => {
  assert.equal(tileUrlFor('light'), CARTO_TILES.light);
  assert.equal(tileUrlFor('dark'), CARTO_TILES.dark);
  assert.equal(tileUrlFor('whatever'), CARTO_TILES.light);
  assert.match(CARTO_TILES.dark, /^https:\/\/\{s\}\.basemaps\.cartocdn\.com\/dark_all\/\{z\}\/\{x\}\/\{y\}\{r\}\.png$/);

  const carto = tileLayerConfig({ scheme: 'dark', cartoKey: 'k&1' });
  assert.equal(carto.provider, 'carto');
  assert.equal(carto.url, `${CARTO_TILES.dark}?key=k%261`, 'key 转义后拼在网址后面');
  assert.equal(carto.options.subdomains, 'abcd');
  assert.match(carto.options.attribution, /OpenStreetMap.*CARTO/);
  assert.equal(carto.options.className, 'tm-tiles tm-tiles--dark');
  assert.equal(tileLayerConfig({ scheme: 'light', cartoKey: 'k' }).url, `${CARTO_TILES.light}?key=k`);

  const osmLight = tileLayerConfig({ scheme: 'light', cartoKey: '' });
  assert.equal(osmLight.provider, 'osm');
  assert.equal(osmLight.url, OSM_TILES);
  assert.equal(osmLight.options.maxNativeZoom, 19);
  assert.doesNotMatch(osmLight.options.className, /filter-dark/);
  assert.doesNotMatch(osmLight.options.attribution, /CARTO/);
  assert.match(tileLayerConfig({ scheme: 'dark', cartoKey: '' }).options.className, /tm-tiles--filter-dark/);
  assert.equal(tileLayerConfig().provider, CARTO_BASEMAPS_KEY ? 'carto' : 'osm', '默认跟着 CARTO_BASEMAPS_KEY 走');

  for (const host of ['https://*.basemaps.cartocdn.com', 'https://basemaps.cartocdn.com', 'https://tile.openstreetmap.org']) {
    assert.ok(CSP_SOURCES.img.includes(host), host);
  }
  assert.ok(CSP_SOURCES.connect.includes('https://open.er-api.com'));
  assert.ok(CSP_SOURCES.connect.includes('https://api.open-meteo.com'));
});

test('坐标、边界、留白、距离', () => {
  assert.ok(isValidLatLng(0, 0));
  assert.ok(isValidLatLng('8.68', '106.6'));
  for (const [a, b] of [[null, 1], [1, null], ['', 1], [91, 0], [0, 181], [NaN, 0], [undefined, 0]]) assert.ok(!isValidLatLng(a, b), `${a},${b}`);
  assert.deepEqual(toLatLng({ lat: '8.5', lng: 106 }), [8.5, 106]);
  assert.deepEqual(toLatLng([1, 2]), [1, 2]);
  assert.equal(toLatLng({ lat: null, lng: 1 }), null);
  assert.deepEqual(boundsOf([[8.68, 106.6], { lat: 8.71, lng: 106.62 }, null, { lat: null, lng: null }, [8.65, 106.56]]), [[8.65, 106.56], [8.71, 106.62]]);
  assert.equal(boundsOf([]), null);
  assert.equal(boundsOf([{}]), null);
  assert.deepEqual(normalizePadding(16), { top: 16, right: 16, bottom: 16, left: 16 });
  assert.deepEqual(normalizePadding({ top: 72, bottom: 120 }), { top: 72, right: 0, bottom: 120, left: 0 });
  assert.deepEqual(normalizePadding([10, 20]), { top: 20, right: 10, bottom: 20, left: 10 });
  assert.deepEqual(normalizePadding(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(addPadding(8, { top: 40 }), { top: 48, right: 8, bottom: 8, left: 8 });
  // 香港 → 台北 约 810 公里
  const km = haversineKm({ lat: 22.3193, lng: 114.1694 }, { lat: 25.033, lng: 121.5654 });
  assert.ok(km > 790 && km < 830, String(km));
  assert.equal(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
  assert.equal(haversineKm(null, { lat: 1, lng: 1 }), null);
  assert.ok(Math.abs(pathDistanceKm([[0, 0], [0, 1], null, [0, 2]]) - 222.39) < 0.1);
  assert.ok(sameLatLngs([[1, 2], [3, 4]], [[1, 2], [3, 4]]));
  assert.ok(!sameLatLngs([[1, 2]], [[1, 2], [3, 4]]));
  assert.ok(!sameLatLngs([[1, 2]], [[1, 2.0001]]));
  assert.equal(routeStyleFor('walk'), 'dotted');
  assert.equal(routeStyleFor('ferry'), 'dashed');
  assert.equal(routeStyleFor('grab'), 'solid');
  assert.equal(routeStyleFor(null), 'solid');
});

test('地点坐标：精度照抄；没坐标退回分段中心并标“位置未知”', () => {
  assert.deepEqual(placePoint({ lat: 8.68, lng: 106.606, coord_precision: 'approximate' }), { lat: 8.68, lng: 106.606, precision: 'approximate' });
  assert.deepEqual(placePoint({ lat: 8.68, lng: 106.606, coord_precision: 'weird' }), { lat: 8.68, lng: 106.606, precision: 'exact' });
  assert.deepEqual(placePoint({ lat: null, lng: null }, { center_lat: 8.6833, center_lng: 106.6085 }), { lat: 8.6833, lng: 106.6085, precision: 'unknown' });
  assert.equal(placePoint({ lat: null, lng: null }, { center_lat: null, center_lng: null }), null);
  assert.equal(placePoint(null, null), null);
});

test('当天路线：只连 primary、未删除的条目，按 sort_key / 钟点排序，展开步行路线点，交通方式接到下一个有位置的点', () => {
  const places = new Map([
    ['A', { id: 'A', name: '机场', lat: 1, lng: 1 }],
    ['B', { id: 'B', name: '酒店', lat: 2, lng: 2, coord_precision: 'approximate' }],
    ['C', { id: 'C', name: '没坐标的粉店', lat: null, lng: null }],
    ['D', { id: 'D', name: '海滩', lat: 3, lng: 3 }],
    ['E', { id: 'E', name: '望海岭', lat: 4, lng: 4 }],
  ]);
  const items = [
    { id: 'i5', sort_key: 50, kind: 'beach', place_id: 'D', transport_in: { options: [{ mode: 'scooter' }, { mode: 'grab', recommended: true }] } },
    { id: 'i1', sort_key: 10, kind: 'flight', place_id: 'A' },
    { id: 'i2', sort_key: 20, kind: 'transport', place_id: 'B', transport_in: { options: [{ mode: 'car' }] } },
    { id: 'i2b', sort_key: 20, start_time: null, kind: 'hotel', place_id: 'B', created_at: '2027-01-01T00:00:01Z' },
    { id: 'i3', sort_key: 30, kind: 'food', place_id: 'C', transport_in: { options: [{ mode: 'walk', recommended: true }] } },
    { id: 'rain', sort_key: 35, kind: 'food', place_id: 'E', variant: 'rain' },
    { id: 'gone', sort_key: 36, kind: 'food', place_id: 'E', deleted_at: '2027-01-02T00:00:00Z' },
    { id: 'i6', sort_key: 60, kind: 'walk_route', stops: [{ name: '海滩', place_id: 'D' }, { name: '半路', lat: 3.5, lng: 3.5 }, { name: '望海岭', place_id: 'E' }, { name: '无效点' }] },
  ];
  const { points, legs } = dayRoute(items, places);
  assert.deepEqual(points.map((p) => p.name), ['机场', '酒店', '海滩', '半路', '望海岭']);
  assert.equal(points[1].precision, 'approximate');
  assert.deepEqual(legs.map((l) => [l.from, l.to, l.mode]), [[0, 1, 'car'], [1, 2, 'grab'], [2, 3, 'walk'], [3, 4, 'walk']],
    '酒店入住和接机是同一点只留一个；步行路线第一站和上一条是同一点也合并');
  assert.equal(arrivalMode({ transport_in: { options: [] } }), null);
  assert.equal(arrivalMode({}), null);
  // 普通对象当地点表也行
  assert.equal(dayRoute([{ id: 'x', sort_key: 1, place_id: 'A' }], { A: places.get('A') }).points.length, 1);
  // 排序：sort_key 相同 → 有钟点的在前 → created_at
  const sorted = sortDayItems([
    { id: 'n', sort_key: 10, start_time: null, created_at: '1' },
    { id: 'b', sort_key: 10, start_time: '10:00:00', created_at: '2' },
    { id: 'a', sort_key: 10, start_time: '09:00:00', created_at: '3' },
    { id: 'z', sort_key: 5 },
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ['z', 'a', 'b', 'n']);
});

test('地图组件约定：TripMap 只在 lib/map 里 import leaflet；组件样式只用设计变量（tokens 测试兜底）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../../src/lib/map/TripMap.jsx'), 'utf8');
  assert.match(src, /import L from 'leaflet'/);
  assert.match(src, /L\.divIcon\(/, '用自定义 HTML 图标，不用默认图片图钉（带哈希的文件名下找不到）');
  assert.doesNotMatch(src, /innerHTML/, '不拼 HTML');
  const css = readFileSync(path.join(here, '../../src/lib/map/TripMap.css'), 'utf8');
  assert.match(css, /isolation: isolate/, 'Leaflet 的层级关进容器');
});
