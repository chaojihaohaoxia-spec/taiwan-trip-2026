// =====================================================================
// lib/maps-links.js：生成 Google 地图链接（地点、导航、多点路线）。
//
// 用的是 Google 官方的 “Maps URLs”（https://www.google.com/maps/…?api=1），
// 手机上装了 Google 地图 App 会直接用 App 打开，没装就开网页；不需要 API key。
//
//   googleMapsPlaceUrl(place)                       → 打开一个地点（有 maps_url 优先用它）
//   googleMapsNavigateUrl(place, { mode: 'walk' })  → 从“我的位置”导航过去
//   googleMapsRouteUrls(points, { mode })           → 多点路线；超过途经点上限自动分成几段
//   travelModeFor('grab')                           → 'driving'（数据里的交通方式 → Google 的出行方式）
//
// 地点参数接受数据库的 places 行（name / name_local / lat / lng / google_place_id / address / maps_url），
// 也接受 { lat, lng } 或一个字符串（当搜索词）。
// 有坐标优先用坐标（不会搜错同名地点）；有 google_place_id 一起带上（Google 显示正确的店名）。
// =====================================================================

const BASE = 'https://www.google.com/maps';

/**
 * Maps URLs 的途经点上限：手机浏览器最多 3 个，其他 9 个。
 * 默认按 3 个分段，保证在手机上打开也完整（多出来的分成“第 2 段”）。
 */
export const MAX_WAYPOINTS_MOBILE = 3;
export const MAX_WAYPOINTS = 9;

/**
 * 数据里的交通方式（docs/数据结构.md B5.5 TransportMode）→ Google 的 travelmode。
 * 摩托车（scooter）Google 链接不支持两轮模式，按开车算；飞机没有对应，返回 null（不带 travelmode）。
 */
const MODE_MAP = Object.freeze({
  walk: 'walking',
  bicycle: 'bicycling',
  metro: 'transit',
  bus: 'transit',
  train: 'transit',
  hsr: 'transit',
  ferry: 'transit',
  cable_car: 'transit',
  taxi: 'driving',
  grab: 'driving',
  car: 'driving',
  scooter: 'driving',
  flight: null,
  other: null,
});

/** 'walk' → 'walking'；已经是 Google 写法（walking/driving/transit/bicycling）的原样返回；不认识返回 null */
export function travelModeFor(mode) {
  if (!mode) return null;
  const m = String(mode).toLowerCase();
  if (['walking', 'driving', 'transit', 'bicycling'].includes(m)) return m;
  return MODE_MAP[m] ?? null;
}

/** 只放行 http(s) 链接（数据库里的 maps_url 也过一遍，防止 javascript: 之类） */
export function isSafeHttpUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** 坐标写法：去掉多余的 0，最多 6 位小数（约 0.1 米）。(8.68, 106.606) → '8.68,106.606' */
export function coordText(lat, lng, digits = 6) {
  const f = (v) => String(Number(Number(v).toFixed(digits)));
  return `${f(lat)},${f(lng)}`;
}

function hasCoords(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
    && p.lat !== null && p.lng !== null && p.lat !== '' && p.lng !== ''
    && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180;
}

/**
 * 地点 → { query, placeId }。
 * 有坐标：query 是 'lat,lng'；没有：用名字（当地名 > 中文名 > 英文名）+ 地址当搜索词。
 */
export function placeQuery(place) {
  if (place === null || place === undefined) return null;
  if (typeof place === 'string') return place.trim() ? { query: place.trim(), placeId: null } : null;
  const placeId = place.google_place_id || place.placeId || null;
  if (hasCoords(place)) return { query: coordText(place.lat, place.lng), placeId };
  const name = place.name_local || place.name || place.name_en || '';
  const text = [name, place.address].filter(Boolean).join(' ').trim();
  return text ? { query: text, placeId } : null;
}

function buildUrl(path, params) {
  const sp = new URLSearchParams();
  sp.set('api', '1');
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v));
  // URLSearchParams 把空格写成 '+'，Google 认；逗号和竖线保持可读
  return `${BASE}/${path}/?${sp.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`;
}

/**
 * 打开一个地点。places.maps_url 是安全的 http(s) 链接时直接用它（用户手动贴的、最准）。
 * @returns {string|null}
 */
export function googleMapsPlaceUrl(place) {
  if (place && typeof place === 'object' && place.maps_url && isSafeHttpUrl(place.maps_url)) return place.maps_url;
  const q = placeQuery(place);
  if (!q) return null;
  return buildUrl('search', { query: q.query, query_place_id: q.placeId });
}

/** 搜索任意文字（例如“附近的药房”） */
export function googleMapsSearchUrl(text) {
  const q = String(text || '').trim();
  return q ? buildUrl('search', { query: q }) : null;
}

/**
 * 导航到某个地点（起点默认是“我的位置”）。
 * @param {object|string} destination
 * @param {{ mode?: string, origin?: object|string, navigate?: boolean }} [o]
 *   navigate：默认 true，手机上直接进入导航（dir_action=navigate）
 */
export function googleMapsNavigateUrl(destination, { mode, origin, navigate = true } = {}) {
  const d = placeQuery(destination);
  if (!d) return null;
  const o = origin ? placeQuery(origin) : null;
  return buildUrl('dir', {
    origin: o?.query,
    origin_place_id: o?.placeId,
    destination: d.query,
    destination_place_id: d.placeId,
    travelmode: travelModeFor(mode),
    dir_action: navigate ? 'navigate' : null,
  });
}

/**
 * 多点路线 → 一个或几个 Google 路线链接。
 * 途经点超过上限时自动分段，段与段首尾相接（第 1 段的终点是第 2 段的起点）。
 * 没法定位的点（没坐标也没名字）会被跳过。
 * @param {Array<object|string>} points 按顺序
 * @param {{ mode?: string, maxWaypoints?: number }} [o] maxWaypoints 默认 3（手机浏览器的上限）
 * @returns {Array<{ url: string, part: number, parts: number, from: number, to: number, label: string }>}
 *   from / to：这一段在 points 里的起止下标；label：'全程' 或 '第 1 段（1–5）'
 */
export function googleMapsRouteUrls(points, { mode, maxWaypoints = MAX_WAYPOINTS_MOBILE } = {}) {
  const usable = (points || []).map((p, index) => ({ q: placeQuery(p), index })).filter((x) => x.q);
  if (usable.length < 2) return [];
  const per = Math.max(0, Math.min(MAX_WAYPOINTS, Math.floor(maxWaypoints)));
  const step = per + 1; // 每段多走几个点（起点 + 途经点 + 终点 = per + 2 个点）
  const segments = [];
  for (let start = 0; start < usable.length - 1; start += step) {
    const end = Math.min(start + step, usable.length - 1);
    segments.push(usable.slice(start, end + 1));
  }
  const travelmode = travelModeFor(mode);
  return segments.map((seg, i) => {
    const first = seg[0];
    const last = seg[seg.length - 1];
    const mids = seg.slice(1, -1);
    const allIds = mids.every((m) => m.q.placeId);
    const url = buildUrl('dir', {
      origin: first.q.query,
      origin_place_id: first.q.placeId,
      destination: last.q.query,
      destination_place_id: last.q.placeId,
      waypoints: mids.length ? mids.map((m) => m.q.query).join('|') : null,
      // 途经点的 place_id 必须和途经点一一对应，缺一个就都不带
      waypoint_place_ids: mids.length && allIds ? mids.map((m) => m.q.placeId).join('|') : null,
      travelmode,
    });
    const parts = segments.length;
    return {
      url,
      part: i + 1,
      parts,
      from: first.index,
      to: last.index,
      label: parts === 1 ? '全程' : `第 ${i + 1} 段（${first.index + 1}–${last.index + 1}）`,
    };
  });
}

/** 只要一个链接时用：分段时返回第一段 */
export function googleMapsRouteUrl(points, opts) {
  return googleMapsRouteUrls(points, opts)[0]?.url ?? null;
}
