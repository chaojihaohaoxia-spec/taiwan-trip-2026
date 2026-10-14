// =====================================================================
// lib/map/geo.js：地图用的纯函数（不依赖 Leaflet、不碰 DOM，Node 里能测）。
//
//   底图：tileLayerConfig({ scheme, cartoKey }) —— 有 key 用 CARTO light_all / dark_all，没有用 OSM（深色压暗）
//   坐标：isValidLatLng、toLatLng、boundsOf、haversineKm、pathDistanceKm
//   留白：normalizePadding(32) → { top: 32, right: 32, bottom: 32, left: 32 }；addPadding(a, b)
//   数据：placePoint(place, segment)  地点坐标（没有就退回分段中心，标“位置未知”）
//         dayRoute(items, placesById) 当天路线（docs/数据结构.md：当天 primary、未删除的条目按排序连地点）
// =====================================================================

/**
 * CARTO 底图的 key。
 * 2026 年起 basemaps.cartocdn.com 不带 key 只返回“API KEY REQUIRED”水印图（实测：所有样式都是水印），
 * key 要在 https://carto.com/basemaps/apikey 免费申请（非商用每月 500 万次以内免费），需要注册账号——由用户自己办。
 * key 本来就会出现在每个瓦片网址里（和 Supabase 的可公开 key 一样），在 CARTO 后台把它限定到本站域名即可。
 * 留空：用 OpenStreetMap 官方底图（浅色原样、深色用滤镜压暗），地图照常能用。
 */
export const CARTO_BASEMAPS_KEY = '';

/** CARTO 底图（需要 key、需署名；{r} 在高清屏上会换成 @2x） */
export const CARTO_TILES = Object.freeze({
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
});
/** OpenStreetMap 官方底图（没有 CARTO key 时用；免费、需署名，只给两个人用的量完全没问题） */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_SUBDOMAINS = 'abcd';
export const TILE_MAX_ZOOM = 20;
const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
/** 署名（地图右下角，按 OSM 和 CARTO 的要求必须显示） */
export const TILE_ATTRIBUTION = `© ${OSM_LINK} · © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`;
export const OSM_ATTRIBUTION = `© ${OSM_LINK}`;

/** 'light' | 'dark' → CARTO 底图网址模板（不含 key） */
export function tileUrlFor(scheme) {
  return scheme === 'dark' ? CARTO_TILES.dark : CARTO_TILES.light;
}

/**
 * 底图图层的配置（给 L.tileLayer 用）。
 *   有 CARTO key：CARTO light_all / dark_all，按深浅色切换；
 *   没有：OpenStreetMap，深色时加 tm-tiles--filter-dark（CSS 滤镜把浅色底图压成深色）。
 * @param {{ scheme?: 'light'|'dark', cartoKey?: string }} [o]
 * @returns {{ provider: 'carto'|'osm', url: string, options: object }}
 */
export function tileLayerConfig({ scheme = 'light', cartoKey = CARTO_BASEMAPS_KEY } = {}) {
  const dark = scheme === 'dark';
  if (cartoKey) {
    return {
      provider: 'carto',
      url: `${tileUrlFor(scheme)}?key=${encodeURIComponent(cartoKey)}`,
      options: { subdomains: TILE_SUBDOMAINS, maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION, className: `tm-tiles tm-tiles--${dark ? 'dark' : 'light'}` },
    };
  }
  return {
    provider: 'osm',
    url: OSM_TILES,
    options: {
      maxZoom: TILE_MAX_ZOOM,
      maxNativeZoom: 19, // OSM 只到 19 级，再放大就拉伸 19 级的图
      attribution: OSM_ATTRIBUTION,
      className: `tm-tiles tm-tiles--${dark ? 'dark' : 'light'} tm-tiles--osm${dark ? ' tm-tiles--filter-dark' : ''}`,
    },
  };
}

/** 合法的 WGS84 坐标（null、空串、越界都不算） */
export function isValidLatLng(lat, lng) {
  if (lat === null || lng === null || lat === undefined || lng === undefined || lat === '' || lng === '') return false;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

/** {lat,lng} / [lat,lng] → [lat, lng]；不合法返回 null */
export function toLatLng(p) {
  if (!p) return null;
  const [lat, lng] = Array.isArray(p) ? p : [p.lat, p.lng];
  return isValidLatLng(lat, lng) ? [Number(lat), Number(lng)] : null;
}

/** 一组点的外接矩形 [[南, 西], [北, 东]]；没有合法点返回 null */
export function boundsOf(points) {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  let count = 0;
  for (const p of points || []) {
    const ll = toLatLng(p);
    if (!ll) continue;
    count += 1;
    s = Math.min(s, ll[0]);
    n = Math.max(n, ll[0]);
    w = Math.min(w, ll[1]);
    e = Math.max(e, ll[1]);
  }
  return count ? [[s, w], [n, e]] : null;
}

/** 留白统一成四个方向：数字 → 四边相同；{ top, right, bottom, left } → 缺的补 0；[x, y] → 上下 y、左右 x */
export function normalizePadding(p) {
  if (Array.isArray(p)) return { top: +p[1] || 0, right: +p[0] || 0, bottom: +p[1] || 0, left: +p[0] || 0 };
  if (p && typeof p === 'object') return { top: +p.top || 0, right: +p.right || 0, bottom: +p.bottom || 0, left: +p.left || 0 };
  const n = Number(p) || 0;
  return { top: n, right: n, bottom: n, left: n };
}

/** 两组留白相加 */
export function addPadding(a, b) {
  const x = normalizePadding(a);
  const y = normalizePadding(b);
  return { top: x.top + y.top, right: x.right + y.right, bottom: x.bottom + y.bottom, left: x.left + y.left };
}

/** 两点之间的大圆距离（公里） */
export function haversineKm(a, b) {
  const p = toLatLng(a);
  const q = toLatLng(b);
  if (!p || !q) return null;
  const rad = Math.PI / 180;
  const dLat = (q[0] - p[0]) * rad;
  const dLng = (q[1] - p[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 折线总长（公里），跳过不合法的点 */
export function pathDistanceKm(points) {
  const pts = (points || []).map(toLatLng).filter(Boolean);
  let sum = 0;
  for (let i = 1; i < pts.length; i += 1) sum += haversineKm(pts[i - 1], pts[i]);
  return sum;
}

/**
 * 地点的坐标和精度。地点没坐标时退回分段中心（精度 'unknown'，界面标“位置未知”）。
 * @returns {{ lat: number, lng: number, precision: 'exact'|'approximate'|'city'|'unknown' } | null}
 */
export function placePoint(place, segment) {
  if (place && isValidLatLng(place.lat, place.lng)) {
    const precision = ['exact', 'approximate', 'city'].includes(place.coord_precision) ? place.coord_precision : 'exact';
    return { lat: Number(place.lat), lng: Number(place.lng), precision };
  }
  if (segment && isValidLatLng(segment.center_lat, segment.center_lng)) {
    return { lat: Number(segment.center_lat), lng: Number(segment.center_lng), precision: 'unknown' };
  }
  return null;
}

const tsOf = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * 同一天条目的先后（docs/数据结构.md A2）：sort_key，再按 start_time（空的在后），再按 created_at，最后按 id。
 * 全站只有这一份：数据层（data/selectors.js 的 compareItems、itemsByDay）和地图路线都用它。
 */
export function compareDayItems(a, b) {
  const k = (Number(a.sort_key) || 0) - (Number(b.sort_key) || 0);
  if (k) return k;
  const ta = a.start_time || null;
  const tb = b.start_time || null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta < tb ? -1 : 1;
  }
  const c = tsOf(a.created_at) - tsOf(b.created_at);
  if (c) return c;
  const ia = String(a.id ?? '');
  const ib = String(b.id ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** 同一天条目排好序（不修改原数组） */
export function sortDayItems(items) {
  return [...(items || [])].sort(compareDayItems);
}

/** 条目 transport_in 里推荐的交通方式（没有推荐就取第一个） */
export function arrivalMode(item) {
  const options = item?.transport_in?.options;
  if (!Array.isArray(options) || !options.length) return null;
  return (options.find((o) => o.recommended) || options[0]).mode || null;
}

/**
 * 当天的路线：当天 variant='primary'、没被删除的条目，按顺序取地点坐标连起来；
 * 步行路线（walk_route）的 stops 展开成多个点。相邻的同一个点只留一个。
 * @param {Array<object>} items 当天的条目（可以混着备选，函数自己筛）
 * @param {Map<string, object>|Record<string, object>} places 地点：id → 行
 * @param {{ includeStops?: boolean }} [o]
 * @returns {{ points: Array<{ lat, lng, itemId, placeId, name, kind, precision }>, legs: Array<{ from: number, to: number, mode: string|null }> }}
 */
export function dayRoute(items, places, { includeStops = true } = {}) {
  const getPlace = (id) => (id ? (places instanceof Map ? places.get(id) : places?.[id]) : null);
  const points = [];
  const legs = [];
  let pendingMode = null;
  const push = (pt, mode) => {
    const last = points[points.length - 1];
    if (last && Math.abs(last.lat - pt.lat) < 1e-6 && Math.abs(last.lng - pt.lng) < 1e-6) return;
    if (points.length) legs.push({ from: points.length - 1, to: points.length, mode: mode ?? null });
    points.push(pt);
  };
  for (const item of sortDayItems(items)) {
    if (item.deleted_at || (item.variant && item.variant !== 'primary')) continue;
    const mode = arrivalMode(item);
    if (includeStops && item.kind === 'walk_route' && Array.isArray(item.stops) && item.stops.length) {
      item.stops.forEach((stop, i) => {
        const place = getPlace(stop.place_id);
        const p = place ? placePoint(place) : (isValidLatLng(stop.lat, stop.lng) ? { lat: Number(stop.lat), lng: Number(stop.lng), precision: 'exact' } : null);
        if (!p) return;
        push({ ...p, itemId: item.id, placeId: place?.id ?? null, name: stop.name || place?.name || '', kind: 'stop' }, i === 0 ? (mode ?? pendingMode) : 'walk');
      });
      pendingMode = null;
      continue;
    }
    const place = getPlace(item.place_id);
    const p = place ? placePoint(place) : null;
    if (!p) {
      // 这一条没有位置：交通方式留给下一个有位置的点
      pendingMode = mode ?? pendingMode;
      continue;
    }
    push({ ...p, itemId: item.id, placeId: place.id, name: place.name || item.title || '', kind: item.kind || 'other' }, mode ?? pendingMode);
    pendingMode = null;
  }
  return { points, legs };
}

/** 两组 [lat, lng] 是否完全相同（决定要不要更新折线） */
export function sameLatLngs(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

/** 交通方式 → 折线样式：步行点线、轮渡/飞机虚线、其他实线 */
export function routeStyleFor(mode) {
  if (mode === 'walk') return 'dotted';
  if (mode === 'ferry' || mode === 'flight' || mode === 'cable_car') return 'dashed';
  return 'solid';
}
