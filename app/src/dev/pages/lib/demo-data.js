// =====================================================================
// dev/pages/lib/demo-data.js：#/dev/lib 展示页用的演示数据整理（只给开发页用）。
//
// 从演示数据库（data/demo.js，全部虚构）里取「椰影岛 · 冬日海岛」，整理成：
//   - 地图要的标记 / 路线（按 docs/数据结构.md 的规则：当天 primary 条目按顺序连地点）；
//   - 天气要的查询（每天用当晚住处的坐标，没有就用分段中心）；
//   - 复制演示用的“当天行程”文字。
// 正式页面的数据由 data/ 层提供，这里的整理方式可以参考，但不要被正式页面 import。
// =====================================================================

import { loadDemoDb } from '../../../data/demo.js';
import { dayRoute, placePoint, routeStyleFor, sortDayItems } from '../../../lib/map/geo.js';
import { formatDate, formatItemTime } from '../../../lib/datetime.js';
import { joinLines } from '../../../lib/clipboard.js';

export const DEMO_TRIP_ID = 'demo-island';

/** 地点类型的中文名 */
export const PLACE_KIND_NAMES = Object.freeze({
  sight: '景点', food: '餐厅', cafe: '咖啡甜品', bar: '酒吧', hotel: '住宿', hub: '交通枢纽',
  shop: '商店', market: '市场', beach: '海滩', activity: '活动', other: '其他',
});

/** 地点类型 → 标记颜色（tokens.css 的分类色 cat-1…8） */
const KIND_TONE = Object.freeze({
  hotel: 1, food: 2, cafe: 2, bar: 2, activity: 3, sight: 4, market: 5, shop: 5, beach: 6, other: 7, hub: 8,
});

/** 读演示行程，按 id 建好索引 */
export async function loadIslandTrip() {
  const db = await loadDemoDb();
  const T = DEMO_TRIP_ID;
  const pick = (name) => db.tables[name].filter((r) => r.trip_id === T);
  const trip = db.tables.trips.find((t) => t.id === T);
  const segments = pick('segments');
  const places = pick('places');
  const bookings = pick('bookings');
  const days = pick('days').sort((a, b) => (a.date < b.date ? -1 : 1));
  const items = pick('items');
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  return {
    trip,
    segments,
    segmentById: byId(segments),
    places,
    placeById: byId(places),
    bookings,
    bookingById: byId(bookings),
    days,
    items,
    itemsByDay: new Map(days.map((d) => [d.id, items.filter((i) => i.day_id === d.id)])),
    tips: pick('tips'),
  };
}

/** 天气查询：每天用当晚住处的坐标，没有住处（最后一天）用分段中心 */
export function weatherQueryFor(bundle) {
  return {
    timeZone: bundle.trip.timezone,
    days: bundle.days.map((d) => {
      const stay = d.stay_booking_id ? bundle.bookingById.get(d.stay_booking_id) : null;
      const place = stay?.place_id ? bundle.placeById.get(stay.place_id) : null;
      const segment = d.segment_id ? bundle.segmentById.get(d.segment_id) : null;
      const pt = placePoint(place, segment);
      return { date: d.date, lat: pt?.lat ?? null, lng: pt?.lng ?? null, place: place?.name || (segment ? `${segment.name}（分段中心）` : null) };
    }),
  };
}

/**
 * 地图数据。
 * @param {object} bundle loadIslandTrip() 的结果
 * @param {string|null} dayId null = 全部地点（按类型着色，不连线）；否则当天路线（按顺序编号）
 * @returns {{ markers: Array, routes: Array, list: Array, points: Array }}
 */
export function mapDataFor(bundle, dayId) {
  if (!dayId) {
    const markers = [];
    for (const p of bundle.places) {
      const pt = placePoint(p, bundle.segmentById.get(p.segment_id));
      if (!pt) continue;
      markers.push({ id: p.id, lat: pt.lat, lng: pt.lng, title: p.name, tone: KIND_TONE[p.kind] || 7, precision: pt.precision, kind: p.kind, place: p });
    }
    return { markers, routes: [], list: markers, points: markers };
  }
  const { points, legs } = dayRoute(bundle.itemsByDay.get(dayId) || [], bundle.placeById);
  const markers = points.map((pt, i) => ({
    id: `${dayId}:${i}`,
    lat: pt.lat,
    lng: pt.lng,
    title: pt.name,
    label: String(i + 1),
    tone: 'accent',
    precision: pt.precision,
    kind: pt.kind,
    place: pt.placeId ? bundle.placeById.get(pt.placeId) : { name: pt.name, lat: pt.lat, lng: pt.lng },
  }));
  // 相邻同样式的路段合成一条折线（少几个 SVG 元素）
  const routes = [];
  for (const leg of legs) {
    const style = routeStyleFor(leg.mode);
    const last = routes[routes.length - 1];
    const a = [points[leg.from].lat, points[leg.from].lng];
    const b = [points[leg.to].lat, points[leg.to].lng];
    if (last && last.style === style && last.to === leg.from) {
      last.points.push(b);
      last.to = leg.to;
    } else {
      routes.push({ id: `${dayId}:leg${leg.from}`, style, points: [a, b], to: leg.to, mode: leg.mode });
    }
  }
  return { markers, routes, list: markers, points };
}

/** “复制当天行程”的文字：标题行 + 每个条目一行；雨天 / 备选方案单独列在后面 */
export function dayPlanText(bundle, day) {
  const items = sortDayItems(bundle.itemsByDay.get(day.id) || []).filter((i) => !i.deleted_at);
  const primary = items.filter((i) => (i.variant || 'primary') === 'primary');
  const others = items.filter((i) => i.variant && i.variant !== 'primary');
  const segment = bundle.segmentById.get(day.segment_id);
  const line = (i) => {
    const t = formatItemTime(i);
    return [t.main, i.title].filter(Boolean).join(' ');
  };
  return joinLines([
    // 标题里已经写了地名就不再重复分段名
    `${formatDate(day.date, { timeZone: bundle.trip.timezone, year: 'never' })} · ${day.title}${segment && !day.title.includes(segment.name) ? ` · ${segment.name}` : ''}`,
    ...primary.map(line),
    others.length ? '' : null,
    others.map((i) => `${i.variant === 'rain' ? '（雨天）' : '（备选）'}${line(i)}`),
  ]);
}
