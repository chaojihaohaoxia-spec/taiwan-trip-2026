// =====================================================================
// rules/geo.js：坐标小工具（规则包的一部分，网页和小程序共用，小程序那份由 esbuild 生成，别处不要改）。
//
//   coordOf(place)            能用的坐标 { lat, lng }；没有、(0,0)、越界、coord_precision = 'city' → null
//   rawCoordOf(place)         只看坐标本身合不合法（不管精度）
//   haversineKm(a, b)         两点直线距离（公里）；a、b 是 { lat, lng } 或 [lat, lng] 或地点
//   samePlace(a, b, meters?)  同一个地方：同一个 id，或两边坐标都能用、相距不到 80 米
//   inBox(pt, box)            box = [南, 西, 北, 东]
//   boxOf(points)             一组点的包围盒 [南, 西, 北, 东]；没有合法点 → null
//   inPolygon(pt, poly)       poly = [[lat, lng], …]（射线法）
//   inMainland(lat, lng)      在内地（要用 GCJ-02 的范围：不含港澳台）
//   wgs84ToGcj02 / gcj02ToWgs84  内地坐标转换；内地以外原样返回
//
// 写法：普通 ESM、纯函数、零依赖；不碰 DOM / wx / 网络 / Intl；不改传入的对象。
// =====================================================================

/** 「同一个地方」的距离（米），和小程序以前的 sameSpot 一样 */
export const SAME_PLACE_M = 80;

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** 只看坐标合不合法（不管 coord_precision）：{ lat, lng } | null */
export function rawCoordOf(p) {
  if (!p) return null;
  let lat;
  let lng;
  if (Array.isArray(p)) {
    lat = num(p[0]);
    lng = num(p[1]);
  } else {
    lat = num(p.lat);
    lng = num(p.lng);
  }
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** 能用的坐标：合法、不是 (0,0)、精度不是「只到城市」 */
export function coordOf(p) {
  if (!p) return null;
  if (!Array.isArray(p) && p.coord_precision === 'city') return null;
  return rawCoordOf(p);
}

/** 两点直线距离（公里）；任何一边没有合法坐标 → null。只看坐标，不看精度（要看精度先用 coordOf） */
export function haversineKm(a, b) {
  const p = rawCoordOf(a);
  const q = rawCoordOf(b);
  if (!p || !q) return null;
  const R = 6371.0088;
  const rad = Math.PI / 180;
  const dLat = (q.lat - p.lat) * rad;
  const dLng = (q.lng - p.lng) * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 同一个地方：同一个地点 id；或两边坐标都能用（只到城市的不算）、相距不到 meters 米 */
export function samePlace(a, b, meters) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const p = coordOf(a);
  const q = coordOf(b);
  if (!p || !q) return false;
  const km = haversineKm(p, q);
  return km !== null && km * 1000 < (meters || SAME_PLACE_M);
}

/** 点在不在包围盒里；box = [南, 西, 北, 东]（不处理跨 180 度经线） */
export function inBox(pt, box) {
  const c = rawCoordOf(pt);
  if (!c || !box || box.length !== 4) return false;
  return c.lat >= box[0] && c.lat <= box[2] && c.lng >= box[1] && c.lng <= box[3];
}

/** 一组点的包围盒 [南, 西, 北, 东]；没有合法点 → null */
export function boxOf(points) {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  let count = 0;
  const list = points || [];
  for (let i = 0; i < list.length; i++) {
    const c = rawCoordOf(list[i]);
    if (!c) continue;
    count += 1;
    if (c.lat < s) s = c.lat;
    if (c.lat > n) n = c.lat;
    if (c.lng < w) w = c.lng;
    if (c.lng > e) e = c.lng;
  }
  return count ? [s, w, n, e] : null;
}

/** 点在多边形里（射线法）；poly = [[lat, lng], …]，首尾不用重复 */
export function inPolygon(pt, poly) {
  const c = rawCoordOf(pt);
  if (!c || !poly || poly.length < 3) return false;
  const x = c.lng;
  const y = c.lat;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0];
    const xi = poly[i][1];
    const yj = poly[j][0];
    const xj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------
// 港澳的大致轮廓（地区判断、内地坐标转换都要排除它们）。只求「香港机场、九龙市区算香港，深圳福田、蛇口不算」，不是精确边界
// ---------------------------------------------------------------------

/** 香港（含大屿山、南面离岛和水域）：北边沿深圳河、深圳湾中线，东边到大鹏半岛以西 */
export const HK_SHAPE = Object.freeze([
  [22.13, 113.82], [22.40, 113.82], [22.46, 113.90], [22.495, 113.96], [22.515, 114.03], [22.52, 114.08],
  [22.535, 114.11], [22.555, 114.16], [22.548, 114.22], [22.57, 114.27], [22.56, 114.44], [22.45, 114.45], [22.13, 114.45],
]);
/** 澳门（半岛、氹仔、路环、路氹）：西边让开横琴 */
export const MO_SHAPE = Object.freeze([
  [22.218, 113.528], [22.218, 113.56], [22.2, 113.58], [22.16, 113.6], [22.105, 113.6], [22.105, 113.548], [22.15, 113.545], [22.18, 113.53],
]);
/** 台湾本岛和澎湖、金门、马祖的大致范围（内地坐标转换要排除） */
const TW_BOXES = [[21.8, 119.3, 25.4, 122.1], [24.3, 118.1, 24.55, 118.5], [25.9, 119.85, 26.4, 120.6]];
/**
 * 内地的粗轮廓（含海南，把越南、老挝、缅甸、朝韩、蒙古、俄远东挡在外面）。常见实现只用一个经纬度方框，
 * 会把整个东南亚都算进去（越南的坐标也被偏移），所以这里用轮廓。边境附近几公里不准，不影响用途：
 * 只有内地行程（档案 coord = gcj02）打开地图 App 前才转换
 */
export const CN_SHAPE = Object.freeze([
  [53.56, 123.0], [53.3, 125.5], [48.4, 135.1], [45.0, 133.1], [42.4, 130.6], [41.0, 124.3], [39.8, 124.1], [38.9, 121.6],
  [37.4, 122.7], [35.0, 119.5], [31.0, 122.2], [27.0, 120.6], [23.5, 117.2], [22.4, 114.6], [21.5, 111.0], [18.1, 109.5],
  [21.5, 108.0], [22.9, 106.7], [22.8, 105.3], [22.5, 103.5], [21.2, 101.7], [22.0, 99.2], [24.1, 97.6], [27.8, 98.6],
  [28.3, 97.3], [27.9, 91.6], [28.1, 86.9], [30.4, 81.1], [35.6, 78.0], [37.0, 74.8], [39.5, 73.5], [42.6, 80.2],
  [45.0, 82.5], [47.3, 83.0], [49.2, 87.3], [45.3, 90.7], [42.6, 96.4], [42.7, 101.8], [41.6, 105.0], [43.65, 111.97],
  [45.3, 115.0], [46.7, 119.9], [49.7, 117.8], [53.3, 121.4],
]);

/** 在内地（要用 GCJ-02 的范围）：在内地粗轮廓里，又不在港澳台 */
export function inMainland(lat, lng) {
  const pt = { lat, lng };
  if (!inPolygon(pt, CN_SHAPE)) return false;
  if (inPolygon(pt, HK_SHAPE) || inPolygon(pt, MO_SHAPE)) return false;
  for (let i = 0; i < TW_BOXES.length; i++) if (inBox(pt, TW_BOXES[i])) return false;
  return true;
}

// ---------------------------------------------------------------------
// WGS-84 ⇄ GCJ-02（内地地图 App 用的坐标）。库里一律存 WGS-84，只在打开高德、wx.openLocation 前转
// ---------------------------------------------------------------------

const A = 6378245.0;
const EE = 0.00669342162296594323;

function tLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}
function tLng(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
}
function delta(lat, lng) {
  let dLat = tLat(lng - 105.0, lat - 35.0);
  let dLng = tLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: dLat, lng: dLng };
}
function round7(v) {
  return Math.round(v * 1e7) / 1e7;
}

/** WGS-84 → GCJ-02；内地以外（含港澳台）原样返回。返回 { lat, lng }，没有合法坐标 → null */
export function wgs84ToGcj02(lat, lng) {
  const c = rawCoordOf({ lat, lng });
  if (!c) return null;
  if (!inMainland(c.lat, c.lng)) return { lat: c.lat, lng: c.lng };
  const d = delta(c.lat, c.lng);
  return { lat: round7(c.lat + d.lat), lng: round7(c.lng + d.lng) };
}

/** GCJ-02 → WGS-84（迭代逼近，误差 < 1 米）；内地以外原样返回 */
export function gcj02ToWgs84(lat, lng) {
  const c = rawCoordOf({ lat, lng });
  if (!c) return null;
  if (!inMainland(c.lat, c.lng)) return { lat: c.lat, lng: c.lng };
  let wLat = c.lat;
  let wLng = c.lng;
  for (let i = 0; i < 6; i++) {
    const d = delta(wLat, wLng);
    const gLat = wLat + d.lat;
    const gLng = wLng + d.lng;
    wLat -= gLat - c.lat;
    wLng -= gLng - c.lng;
  }
  return { lat: round7(wLat), lng: round7(wLng) };
}
