// =====================================================================
// pages/map/model.js：地图页的数据整理（纯函数，不碰 DOM、不碰 Leaflet，Node 里能测：test/unit/page-map.test.js）。
//
//   resolveFilter({ query, days, todayDate, phase })   网址 ?day= → 'all' 或某一天的 id（进行中默认今天）
//   filterQuery(value, { defaultValue, days })          选了筛选以后网址该写什么（默认值不写，网址干净）
//   placeVisits({ days, itemsByDay, tripStart })        每个地点在哪几天、哪几条条目里出现
//   buildMapModel({ … })                                当前筛选下的标记、路线、列表、没坐标的地点、空状态
//   dayTone(n)                                          第 n 天的颜色编号（--color-day-1…7 轮流，kit/day-tone.js；8 = 没排进哪天）
//   formatDistance(km)                                  「350 米」「1.2 公里」「1,480 公里」
//   fitPoints(points, { centers, maxKm })              取景用的点：离行程区域很远的（出发地的香港机场）不算进取景，仍然画、仍然列
//   declutter(points, minPx)                            屏幕上挤在一起的标记（远看时缩成小圆点）
//   tileLayerSpec({ scheme, cartoKey })                 底图（有 CARTO key 用 voyager / dark_matter，没有用 OSM）
//   tileStatusReducer / tileBanner                      底图加载失败、离线时地图上显示什么
//   locationErrorInfo(code)                             定位失败的中文说明（被拒时说清楚 iPhone 上在哪里打开）
//
// 数据规则见 docs/数据结构.md：坐标只来自 places（WGS84，lat / lng 同时有）；当天路线 = 当天主方案、未删除的条目
// 按排序连地点（data/selectors.js 的 dayRoute，和 lib/map/geo.js 同一份连线计算）；没有坐标的地点不上地图，
// 在页面底部列出「这些地方还没有坐标」（不退回分段中心——地图上一个假位置比没有更误导）。
// =====================================================================

import { CARTO_BASEMAPS_KEY, OSM_TILES, TILE_MAX_ZOOM, TILE_SUBDOMAINS, boundsOf, haversineKm, isValidLatLng, routeStyleFor } from '../../lib/map/geo.js';
import { daysBetween, formatItemTime, formatMonthDay, weekdayName } from '../../lib/datetime.js';
import { kindLabel } from '../../kit/kinds.js';
import { dayToneIndex, DAY_TONE_COUNT as DAY_TONES, NEUTRAL_DAY_TONE } from '../../kit/day-tone.js';

/** 筛选「全部」 */
export const ALL = 'all';

/** 天的颜色：全站一套（kit/day-tone.js，tokens --color-day-1…7，7 天一轮；8 = 灰，没排进哪天） */
export const DAY_TONE_COUNT = DAY_TONES;
/** 没排进哪天的地点用的颜色（--color-cat-8，灰） */
export const NEUTRAL_TONE = NEUTRAL_DAY_TONE;

/** 第 n 天（从 1 起）的颜色编号 1–7（--color-day-N，和概览的 D 徽章同色）；n 不合法时灰色 */
export function dayTone(n) {
  return dayToneIndex(n);
}

/** 'D1'…（第几天的短名，宋体自带的拉丁字母显示） */
export const dayShort = (n) => (Number.isInteger(n) && n > 0 ? `D${n}` : '');

// ---------------------------------------------------------------------
// 筛选（网址 ?day=）
// ---------------------------------------------------------------------

/**
 * 当前筛选。网址 ?day=all → 全部；?day=<日期> 或 ?day=<day id> → 那一天；没写或写错 → 默认值：
 * 行程进行中、今天在行程里 → 今天（在街上打开地图最常看今天）；否则全部。
 * @param {{ query?: object, days: object[], todayDate?: string|null, phase?: string }} o
 * @returns {{ value: string, defaultValue: string, explicit: boolean }} value 是 'all' 或 day.id
 */
export function resolveFilter({ query = {}, days = [], todayDate = null, phase = null }) {
  const today = phase === 'ongoing' && todayDate ? days.find((d) => d.date === todayDate) : null;
  const defaultValue = today ? today.id : ALL;
  const raw = typeof query.day === 'string' ? query.day.trim() : '';
  if (raw === ALL) return { value: ALL, defaultValue, explicit: true };
  if (raw) {
    const hit = days.find((d) => d.date === raw || d.id === raw);
    if (hit) return { value: hit.id, defaultValue, explicit: true };
  }
  return { value: defaultValue, defaultValue, explicit: false };
}

/**
 * 选了某个筛选以后网址里 ?day= 写什么：等于默认值就不写（null = 删掉这个参数），
 * 某一天写日期（比 day id 好读、分享出去也认得），全部写 'all'。
 */
export function filterQuery(value, { defaultValue = ALL, days = [] } = {}) {
  if (value === defaultValue) return null;
  if (value === ALL) return ALL;
  return days.find((d) => d.id === value)?.date || null;
}

/**
 * 筛选的选项：全部 + 每一天（D1…）。
 * @returns {Array<{ value: string, n: number|null, date: string|null, tone: number|null, top: string, big: string, label: string, today: boolean, count: number }>}
 */
export function filterOptions({ days = [], tripStart = null, todayDate = null, phase = null, counts = new Map(), total = 0 }) {
  const out = [{
    value: ALL, n: null, date: null, tone: null, today: false, count: total,
    top: total ? `${total} 处` : '地点', big: '全部', label: `全部地点${total ? `（${total} 处）` : ''}`,
  }];
  for (const d of days) {
    const n = dayNumberOf(d.date, tripStart);
    const isToday = phase === 'ongoing' && d.date === todayDate;
    const md = formatMonthDay(d.date);
    const wd = weekdayName(d.date);
    const count = counts.get(d.id) || 0;
    out.push({
      value: d.id,
      n,
      date: d.date,
      tone: dayTone(n),
      today: isToday,
      count,
      top: isToday ? '今天' : `${dayOfMonth(d.date)} ${wd}`,
      big: dayShort(n) || md,
      label: `第 ${n} 天 · ${md} ${wd}${isToday ? '（今天）' : ''} · ${count} 处`,
    });
  }
  return out;
}

const dayOfMonth = (date) => String(Number(String(date || '').slice(8, 10)) || '');

/** 第几天：date − 行程开始 + 1；没有开始日期时按 days 的顺序算不了，返回 null */
export function dayNumberOf(date, tripStart) {
  if (!date || !tripStart) return null;
  const d = daysBetween(tripStart, date);
  return d === null ? null : d + 1;
}

// ---------------------------------------------------------------------
// 地点在哪几天出现
// ---------------------------------------------------------------------

/**
 * 每个地点出现在哪几天的哪几条条目里（主方案、备选、雨天都算；步行路线里写了 place_id 的点也算）。
 * @param {{ days: object[], itemsByDay: Map<string|null, object[]>, tripStart?: string }} o
 * @returns {Map<string, Array<{ dayId, date, n, itemId, title, time, variant, status, stop: boolean }>>} 按天、按条目顺序
 */
export function placeVisits({ days = [], itemsByDay = new Map(), tripStart = null }) {
  const out = new Map();
  const add = (placeId, v) => {
    if (!placeId) return;
    if (!out.has(placeId)) out.set(placeId, []);
    const list = out.get(placeId);
    // 同一条条目里同一个地点只记一次（步行路线的起点 = 条目地点时）
    if (!list.some((x) => x.itemId === v.itemId && x.dayId === v.dayId)) list.push(v);
  };
  for (const d of days) {
    const n = dayNumberOf(d.date, tripStart);
    for (const it of itemsByDay.get(d.id) || []) {
      if (it.deleted_at) continue;
      const base = {
        dayId: d.id, date: d.date, n, itemId: it.id, title: it.title || '', time: formatItemTime(it).main,
        variant: it.variant || 'primary', status: it.status || 'planned',
      };
      add(it.place_id, { ...base, stop: false });
      if (it.kind === 'walk_route' && Array.isArray(it.stops)) {
        for (const s of it.stops) add(s?.place_id, { ...base, stop: true });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// 地图模型
// ---------------------------------------------------------------------

/** 地点的坐标（只认地点自己的坐标；“只精确到城市”的也画，但标出来） */
export function placeLatLng(place) {
  if (!place || !isValidLatLng(place.lat, place.lng)) return null;
  return { lat: Number(place.lat), lng: Number(place.lng) };
}

/** 'exact' | 'approximate' | 'city'（没写 = 准确） */
export function precisionOf(place) {
  return ['approximate', 'city'].includes(place?.coord_precision) ? place.coord_precision : 'exact';
}

/** 精度的中文说明（地图卡片、读屏） */
export function precisionNote(precision) {
  return { approximate: '大概位置', city: '只精确到城市' }[precision] || '';
}

const toMap = (places) => (places instanceof Map ? places : new Map((places || []).map((p) => [p.id, p])));

/** 地点副标题：当地语名（和中文名不一样时）· 种类 */
export function placeSubtitle(place) {
  const parts = [];
  const local = String(place?.name_local || '').trim();
  if (local && local !== place?.name) parts.push(local);
  parts.push(kindLabel('place', place?.kind));
  return parts.filter(Boolean).join(' · ');
}

/**
 * 当前筛选下的地图内容。
 *
 * 全部：每个有坐标的地点一个标记，颜色 = 它第一次出现在主方案里的那一天（只在备选 / 雨天里出现 = 那天的颜色 + 淡化；
 *       没排进哪天 = 灰色）；每天的路线都画，但淡一点（看得出每天大概走哪儿）。
 * 某一天：当天主方案的路线点（按顺序编号，同一地点去两次写「1 · 9」），当天备选 / 雨天的地点淡化、不编号；
 *       路线按每一段的交通方式分实线 / 虚线 / 点线，颜色 = 这一天的颜色。步行路线里没有地点的点也画（小圆点，不能打开详情）。
 *
 * @param {object} o
 * @param {string} o.filter                    'all' 或 day.id
 * @param {object[]} o.days                    已排序的天
 * @param {Map|object[]} o.places              地点（id → 行）
 * @param {Map<string|null, object[]>} o.itemsByDay  条目按天（未删除、已排序）
 * @param {(dayId: string) => { points, legs, missing }} o.routeOf  当天路线（data/selectors.js 的 dayRoute）
 * @param {string} [o.tripStart]               行程开始日期（算第几天）
 * @param {string|null} [o.nowPlaceId]         行程进行中“现在”这一条的地点（标记带 now: true，列表行标「现在」）
 * @param {Array<{lat,lng}>} [o.centers]       各分段的中心（segments.center_lat/lng）：取景只框住离它们 300 公里内的点
 * @returns {object} 见下面 return
 */
export function buildMapModel({ filter = ALL, days = [], places, itemsByDay = new Map(), routeOf, tripStart = null, nowPlaceId = null, centers = [] }) {
  const byId = toMap(places);
  const visits = placeVisits({ days, itemsByDay, tripStart });
  const dayById = new Map(days.map((d) => [d.id, d]));
  const day = filter !== ALL ? dayById.get(filter) || null : null;
  const routes = new Map(days.map((d) => [d.id, routeOf ? routeOf(d.id) : { points: [], legs: [], missing: [] }]));
  const nOf = (d) => dayNumberOf(d?.date, tripStart);

  // 每一天的地点数（筛选分段上的小字）：主方案路线里不同的地点 + 当天备选的地点
  const counts = new Map();
  for (const d of days) counts.set(d.id, dayPlaceIds(d.id, routes.get(d.id), visits, byId).size);

  const markers = [];
  const lines = [];
  const missing = [];
  const groups = [];

  if (!day) {
    // ---------- 全部 ----------
    const sorted = [...byId.values()].sort(comparePlaces);
    for (const p of sorted) {
      const ll = placeLatLng(p);
      const vs = visits.get(p.id) || [];
      const primary = vs.find((v) => v.variant === 'primary');
      const first = primary || vs[0] || null;
      const dayNs = uniq(vs.filter((v) => v.n).map((v) => v.n));
      if (!ll) {
        missing.push(missingRow(p, vs));
        continue;
      }
      markers.push({
        id: p.id,
        placeId: p.id,
        lat: ll.lat,
        lng: ll.lng,
        title: p.name || '未命名地点',
        subtitle: placeSubtitle(p),
        kind: p.kind || 'other',
        tone: first ? dayTone(first.n) : NEUTRAL_TONE,
        muted: !primary && Boolean(first),
        unscheduled: !first,
        precision: precisionOf(p),
        orders: [],
        days: dayNs.map((n) => ({ n, tone: dayTone(n) })),
        visits: vs,
      });
    }
    // 每天的路线（淡）
    for (const d of days) {
      const n = nOf(d);
      lines.push(...routeLines(d.id, routes.get(d.id), dayTone(n), true));
    }
    // 列表：按天分组（主方案路线的顺序），再是没排进哪天的
    for (const d of days) {
      const n = nOf(d);
      const rows = routeRows(d.id, routes.get(d.id), byId, visits, n);
      if (rows.length) groups.push({ key: d.id, n, tone: dayTone(n), title: dayGroupTitle(d, n), subtitle: daySubtitle(d), rows });
    }
    const loose = markers.filter((m) => m.unscheduled).map((m) => listRow(m, { tone: NEUTRAL_TONE }));
    if (loose.length) groups.push({ key: 'unscheduled', n: null, tone: NEUTRAL_TONE, title: '没排进哪天', subtitle: '想去清单、备选池里的地点', rows: loose });
  } else {
    // ---------- 某一天 ----------
    const n = nOf(day);
    const tone = dayTone(n);
    const route = routes.get(day.id) || { points: [], legs: [], missing: [] };
    const seen = new Map(); // placeId / stop key → marker
    route.points.forEach((pt, i) => {
      const key = pt.placeId || `stop:${pt.itemId}:${i}`;
      const existing = seen.get(key);
      if (existing) {
        existing.orders.push(i + 1);
        return;
      }
      const p = pt.placeId ? byId.get(pt.placeId) : null;
      const m = {
        id: key,
        placeId: pt.placeId || null,
        lat: pt.lat,
        lng: pt.lng,
        title: p?.name || pt.name || '路线点',
        subtitle: p ? placeSubtitle(p) : '步行路线上的点',
        kind: p?.kind || (pt.kind === 'stop' ? 'stop' : 'other'),
        tone,
        muted: false,
        unscheduled: false,
        precision: p ? precisionOf(p) : 'exact',
        orders: [i + 1],
        days: [{ n, tone }],
        visits: p ? (visits.get(p.id) || []).filter((v) => v.dayId === day.id) : [],
        stop: !p,
      };
      seen.set(key, m);
      markers.push(m);
    });
    // 当天的备选 / 雨天（不在主方案路线里的地点）：淡化、不编号
    const extras = [];
    for (const [placeId, vs] of visits) {
      const here = vs.filter((v) => v.dayId === day.id);
      if (!here.length || seen.has(placeId)) continue;
      const p = byId.get(placeId);
      if (!p) continue;
      const ll = placeLatLng(p);
      const primaryHere = here.some((v) => v.variant === 'primary');
      if (!ll) {
        missing.push(missingRow(p, here));
        continue;
      }
      // 主方案里有、但不在路线点里（例如步行路线里写了 place_id 的点已经作为 stop 画了）——照常画
      const m = {
        id: placeId,
        placeId,
        lat: ll.lat,
        lng: ll.lng,
        title: p.name || '未命名地点',
        subtitle: placeSubtitle(p),
        kind: p.kind || 'other',
        tone,
        muted: !primaryHere,
        unscheduled: false,
        alternative: !primaryHere,
        precision: precisionOf(p),
        orders: [],
        days: [{ n, tone }],
        visits: here,
      };
      markers.push(m);
      extras.push(m);
    }
    // 当天主方案里没坐标的地点
    for (const mm of route.missing || []) {
      const p = byId.get(mm.placeId);
      if (p && !missing.some((x) => x.placeId === p.id)) missing.push(missingRow(p, (visits.get(p.id) || []).filter((v) => v.dayId === day.id)));
    }
    lines.push(...routeLines(day.id, route, tone, false));
    const rows = routeRows(day.id, route, byId, visits, n);
    if (rows.length) groups.push({ key: day.id, n, tone, title: '当天路线', subtitle: '按行程顺序', rows });
    const alt = extras.filter((m) => m.alternative).map((m) => listRow(m, { tone, note: altNote(m.visits) }));
    if (alt.length) groups.push({ key: `${day.id}:alt`, n, tone, title: '备选和雨天方案', subtitle: '不在主路线上，淡色显示', rows: alt, muted: true });
    const more = extras.filter((m) => !m.alternative).map((m) => listRow(m, { tone }));
    if (more.length) groups[0] ? groups[0].rows.push(...more) : groups.push({ key: day.id, n, tone, title: '当天的地点', subtitle: '', rows: more });
  }

  // “现在”这一条的地点
  if (nowPlaceId) {
    for (const m of markers) if (m.placeId === nowPlaceId) m.now = true;
    for (const g of groups) for (const r of g.rows) if (r.placeId === nowPlaceId) r.now = true;
  }

  const pts = markers.map((m) => [m.lat, m.lng]);
  for (const l of lines) if (!l.muted) pts.push(...l.points);
  const bounds = boundsOf(pts);
  // 取景：出发地（香港机场）这种离行程区域很远的点不算进去，不然整张图缩到南海看不出什么；它仍然画在地图上、列在列表里
  const fit = fitPoints(pts, { centers });
  const total = [...byId.values()].length;
  let empty = null;
  if (!total) empty = 'no-places';
  else if (!day && !markers.length) empty = 'no-coords';
  else if (day && !markers.length) empty = 'day-empty';

  return {
    filter: day ? day.id : ALL,
    day,
    n: day ? nOf(day) : null,
    tone: day ? dayTone(nOf(day)) : null,
    markers,
    routes: lines,
    missing,
    groups,
    counts,
    total,
    bounds,
    fitPoints: fit.points,
    far: fit.far,
    empty,
    stops: day ? (routes.get(day.id)?.points.length || 0) : 0,
  };
}

/** 同一个地点：中文名排序（和数据层 view.places 一致） */
function comparePlaces(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN') || String(a.id).localeCompare(String(b.id));
}

const uniq = (arr) => [...new Set(arr)];

/** 当天出现的地点 id（主方案路线 + 当天所有条目，包括没坐标的） */
function dayPlaceIds(dayId, route, visits, byId) {
  const ids = new Set();
  for (const pt of route?.points || []) if (pt.placeId) ids.add(pt.placeId);
  for (const [placeId, vs] of visits) if (byId.has(placeId) && vs.some((v) => v.dayId === dayId)) ids.add(placeId);
  return ids;
}

/** 路线 → 折线：相邻同样式的段合成一条（少几个 SVG 元素）；只有一个点画不出线 */
export function routeLines(dayId, route, tone, muted) {
  const out = [];
  const pts = route?.points || [];
  for (const leg of route?.legs || []) {
    const a = pts[leg.from];
    const b = pts[leg.to];
    if (!a || !b) continue;
    const style = routeStyleFor(leg.mode);
    const last = out[out.length - 1];
    if (last && last.style === style && last.to === leg.from) {
      last.points.push([b.lat, b.lng]);
      last.to = leg.to;
    } else {
      out.push({ id: `${dayId}:${leg.from}:${style}`, dayId, style, tone, muted, mode: leg.mode || null, points: [[a.lat, a.lng], [b.lat, b.lng]], from: leg.from, to: leg.to });
    }
  }
  return out;
}

/** 列表行（按路线顺序，同一地点合并成一行写「1 · 9」） */
function routeRows(dayId, route, byId, visits, n) {
  const rows = [];
  const seen = new Map();
  (route?.points || []).forEach((pt, i) => {
    const key = pt.placeId || `stop:${pt.itemId}:${i}`;
    if (seen.has(key)) {
      seen.get(key).orders.push(i + 1);
      return;
    }
    const p = pt.placeId ? byId.get(pt.placeId) : null;
    const vs = p ? (visits.get(p.id) || []).filter((v) => v.dayId === dayId) : [];
    const first = vs.find((v) => v.variant === 'primary' && v.itemId === pt.itemId) || vs[0];
    const row = {
      key: `${dayId}:${key}`,
      markerId: key,
      placeId: p?.id || null,
      title: p?.name || pt.name || '路线点',
      subtitle: [first?.time, p ? placeSubtitle(p) : '步行路线上的点'].filter(Boolean).join(' · '),
      kind: p?.kind || 'stop',
      tone: dayTone(n),
      orders: [i + 1],
      lat: pt.lat,
      lng: pt.lng,
      hasCoords: true,
      stop: !p,
    };
    seen.set(key, row);
    rows.push(row);
  });
  return rows;
}

function listRow(m, { tone, note } = {}) {
  return {
    key: `row:${m.id}`,
    markerId: m.id,
    placeId: m.placeId,
    title: m.title,
    subtitle: [note, m.subtitle].filter(Boolean).join(' · '),
    kind: m.kind,
    tone: tone ?? m.tone,
    orders: m.orders || [],
    lat: m.lat,
    lng: m.lng,
    hasCoords: true,
    muted: Boolean(m.muted),
  };
}

function missingRow(p, vs) {
  const ns = uniq((vs || []).filter((v) => v.n).map((v) => v.n));
  const where = ns.length ? ns.map(dayShort).join(' · ') : '';
  return {
    key: `missing:${p.id}`,
    placeId: p.id,
    markerId: null,
    title: p.name || '未命名地点',
    subtitle: [where, placeSubtitle(p), p.address ? '有地址' : '没有地址'].filter(Boolean).join(' · '),
    kind: p.kind || 'other',
    tone: ns.length ? dayTone(ns[0]) : NEUTRAL_TONE,
    hasCoords: false,
    hasAddress: Boolean(String(p.address || '').trim()),
  };
}

/** 备选 / 雨天的说明 */
function altNote(vs) {
  const kinds = uniq((vs || []).map((v) => v.variant));
  if (kinds.includes('rain') && kinds.includes('backup')) return '备选 · 雨天';
  if (kinds.includes('rain')) return '雨天方案';
  return '备选';
}

function dayGroupTitle(d, n) {
  const t = String(d.title || '').trim();
  return t ? `${dayShort(n)} · ${t}` : `${dayShort(n)} · ${formatMonthDay(d.date)}`;
}

function daySubtitle(d) {
  return `${formatMonthDay(d.date)} ${weekdayName(d.date)}`;
}

// ---------------------------------------------------------------------
// 地图上的说明
// ---------------------------------------------------------------------

/**
 * 地图左上角那一行：「D2 · 1月11日 周一 · 9 站」「全部 · 34 处 · 1 处没坐标」。
 * @returns {{ text: string, warn: string|null }}
 */
export function summaryLine(model) {
  const far = model.far ? `另有 ${model.far} 处很远` : null;
  if (model.day) {
    const d = model.day;
    const parts = [`${dayShort(model.n)} · ${formatMonthDay(d.date)} ${weekdayName(d.date)}`];
    parts.push(model.markers.length ? `${model.markers.filter((m) => !m.muted).length} 处` : '没有地点');
    return { text: parts.join(' · '), warn: model.missing.length ? `${model.missing.length} 处没坐标` : null, far };
  }
  return {
    text: `全部 · ${model.markers.length} 处`,
    warn: model.missing.length ? `${model.missing.length} 处没坐标` : null,
    far,
  };
}

/** 第几站：[1] → '第 1 站'；[1, 9] → '第 1、9 站' */
export function ordersLabel(orders) {
  if (!orders?.length) return '';
  return `第 ${orders.join('、')} 站`;
}

/** 图钉上的小数字：[1] → '1'；[1, 9] → '1·9'（太多写前两个 + …） */
export function ordersBadge(orders) {
  if (!orders?.length) return '';
  if (orders.length <= 2) return orders.join('·');
  return `${orders[0]}·${orders[1]}…`;
}

/** 这个标记第一次在主方案里出现的那一次（没有主方案就取第一次）；没有就 null */
export function firstVisit(m) {
  const vs = m?.visits || [];
  return vs.find((v) => v.variant === 'primary') || vs[0] || null;
}

/**
 * 选中后小卡副标题的几段（纯函数，parts.jsx 的 SelectedCard 用 ' · ' 连起来）：
 *   某一天：「第 3 站 · 09:30 · 当地语名 · 种类 · 大概位置 · 离你 1.2 公里」
 *   全部：  「D2 09:30 · 当地语名 · 种类」；去了好几天写「D1 · D3」（时间就不写了，免得误导）
 *   备选 / 雨天：「备选 / 雨天 · 09:30 · …」；没排进哪天：「没排进哪天 · …」
 * @param {object} m 标记（buildMapModel 的 markers[i]）
 * @param {{ distance?: number|null }} [o] 我和它的直线距离（公里）
 * @returns {string[]}
 */
export function cardParts(m, { distance = null } = {}) {
  const parts = [];
  const first = firstVisit(m);
  const time = first?.time || '';
  if (m.orders?.length) {
    parts.push(ordersLabel(m.orders));
    if (time) parts.push(time);
  } else if (m.muted) {
    parts.push(m.alternative ? '备选 / 雨天' : '只在备选里');
    if (time) parts.push(time);
  } else if (m.unscheduled) {
    parts.push('没排进哪天');
  } else if (m.days?.length > 1) {
    parts.push(m.days.map((d) => dayShort(d.n)).filter(Boolean).join(' · '));
  } else if (first?.n) {
    parts.push([dayShort(first.n), time].filter(Boolean).join(' '));
  } else if (time) {
    parts.push(time);
  }
  if (m.subtitle) parts.push(m.subtitle);
  const pn = precisionNote(m.precision);
  if (pn) parts.push(pn);
  if (distance !== null && distance !== undefined && Number.isFinite(distance)) parts.push(`离你 ${formatDistance(distance)}`);
  return parts;
}

/** 读屏用的标记名字：「第 3 站 码头法棍摊，餐厅（大概位置）」 */
export function markerAriaLabel(m) {
  const head = m.orders?.length ? `${ordersLabel(m.orders)} ` : '';
  const kind = m.stop ? '路线点' : kindLabel('place', m.kind);
  const tail = [m.muted ? (m.alternative ? '备选' : '只在备选里') : '', precisionNote(m.precision)].filter(Boolean).join('，');
  return `${head}${m.title}，${kind}${tail ? `（${tail}）` : ''}`;
}

// ---------------------------------------------------------------------
// 距离
// ---------------------------------------------------------------------

/** 直线距离（公里）→「350 米」「1.2 公里」「18 公里」「1,480 公里」 */
export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return '';
  if (km < 0.05) return '就在附近';
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10} 米`;
  if (km < 10) return `${(Math.round(km * 10) / 10).toFixed(1).replace(/\.0$/, '')} 公里`;
  return `${Math.round(km).toLocaleString('en-US')} 公里`;
}

/** 我和某个点的直线距离（公里）；任一方没坐标返回 null */
export function distanceFrom(me, point) {
  if (!me || !point) return null;
  return haversineKm([me.lat, me.lng], [point.lat, point.lng]);
}

/** 我离这一组点最近的一个有多远（公里）：判断“人还没到”（例如在香港看富国岛） */
export function nearestDistance(me, points) {
  let best = null;
  for (const p of points || []) {
    const d = distanceFrom(me, p);
    if (d !== null && (best === null || d < best)) best = d;
  }
  return best;
}

/** 离行程地点超过这么远（公里）算“人还没到” */
export const FAR_AWAY_KM = 60;

/** 离行程区域超过这么远（公里）的点不算进取景（出发地的机场、转机城市） */
export const OUTLIER_KM = 300;

const asLatLng = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);

/**
 * 取景用的点。有分段中心（segments.center_lat/lng）时：离任一中心 maxKm 以内的点；没有时：互相在 maxKm 以内的最大一群
 * （邻居最多的点当种子；邻居数一样时取后面的那个——出发日先香港机场、后目的地机场）。
 * 一个都留不下（理论上不会）就全部用上。
 * @param {Array<[number, number]|{lat:number,lng:number}>} points
 * @param {{ centers?: Array<{lat:number,lng:number}>, maxKm?: number }} [o]
 * @returns {{ points: Array<[number, number]>, far: number }} far = 被排除的点数
 */
export function fitPoints(points, { centers = [], maxKm = OUTLIER_KM } = {}) {
  const valid = (points || []).map(asLatLng).filter((p) => p && isValidLatLng(p.lat, p.lng)).map((p) => [Number(p.lat), Number(p.lng)]);
  if (valid.length < 2) return { points: valid, far: 0 };
  const anchors = (centers || []).map(asLatLng).filter((c) => c && isValidLatLng(c.lat, c.lng));
  let kept = [];
  if (anchors.length) {
    kept = valid.filter((p) => anchors.some((c) => haversineKm(p, c) <= maxKm));
  }
  if (!kept.length) {
    let best = -1;
    let seed = null;
    valid.forEach((a) => {
      const n = valid.reduce((acc, b) => acc + (haversineKm(a, b) <= maxKm ? 1 : 0), 0);
      if (n >= best) {
        best = n;
        seed = a;
      }
    });
    kept = valid.filter((p) => haversineKm(p, seed) <= maxKm);
  }
  if (!kept.length) kept = valid;
  return { points: kept, far: valid.length - kept.length };
}

// ---------------------------------------------------------------------
// 远看时挤在一起的标记缩成小圆点
// ---------------------------------------------------------------------

/**
 * 屏幕坐标里挤在一起的标记该缩成什么：
 *   普通标记：minPx 内有别的标记 → 'dot'（小圆点，图标、序号都藏起来）；
 *   编了号的路线点（keep）：只和别的路线点比，minPxKeep 内有 → 'mini'（只剩序号的小圆：一天 12 站挤在一个镇里时号码仍然读得出来，
 *     不会五六个方块叠成一摞）；
 *   选中的、“现在”的（pinned）永远完整。
 * 简单的 O(n²)（几十个点，缩放结束时算一次）。
 * @param {Array<{ id: string, x: number, y: number, keep?: boolean, pinned?: boolean }>} points
 * @param {number} [minPx=34]
 * @param {{ minPxKeep?: number }} [o]
 * @returns {Map<string, 'dot'|'mini'>} 要缩的 id → 形状（不在里面的 = 完整）
 */
export function declutter(points, minPx = 34, { minPxKeep = 28 } = {}) {
  const out = new Map();
  const list = points || [];
  const near = (a, b, d) => Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.pinned) continue;
    for (let j = 0; j < list.length; j += 1) {
      if (i === j) continue;
      const b = list[j];
      if (a.keep) {
        if ((b.keep || b.pinned) && near(a, b, minPxKeep)) {
          out.set(a.id, 'mini');
          break;
        }
      } else if (near(a, b, minPx)) {
        out.set(a.id, 'dot');
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// 底图
// ---------------------------------------------------------------------

/** CARTO 底图（要 key）：浅色 voyager、深色 dark_matter（dark_all）；{r} 高清屏换成 @2x */
export const CARTO_STYLE_TILES = Object.freeze({
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
});

const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const CARTO_ATTRIBUTIONS = 'https://carto.com/attributions';

/**
 * 底图配置（不需要 key 的光栅底图）。
 *   有 CARTO key（lib/map/geo.js 的 CARTO_BASEMAPS_KEY）：CARTO voyager / dark_matter；
 *   没有（现状：2026 年起 CARTO 不带 key 只回“API KEY REQUIRED”水印图，实测 voyager、dark_all、light_all 都是）：
 *     OpenStreetMap 官方底图，深色模式用滤镜压暗（tiles 类名带 mp-tiles--dark-filter）。
 * 署名（OSM、CARTO 的使用条款要求必须显示）：attribution 是 [{ text, href }] 的列表，页面自己画（不用 innerHTML）。
 * @param {{ scheme?: 'light'|'dark', cartoKey?: string }} [o]
 * @returns {{ provider: 'carto'|'osm', url: string, subdomains: string, maxZoom: number, maxNativeZoom: number, className: string, attribution: Array<{ text: string, href: string }> }}
 */
export function tileLayerSpec({ scheme = 'light', cartoKey = CARTO_BASEMAPS_KEY } = {}) {
  const dark = scheme === 'dark';
  const osm = { text: '© OpenStreetMap 贡献者', href: OSM_COPYRIGHT };
  if (cartoKey) {
    return {
      provider: 'carto',
      url: `${dark ? CARTO_STYLE_TILES.dark : CARTO_STYLE_TILES.light}?key=${encodeURIComponent(cartoKey)}`,
      subdomains: TILE_SUBDOMAINS,
      maxZoom: TILE_MAX_ZOOM,
      maxNativeZoom: TILE_MAX_ZOOM,
      className: `mp-tiles mp-tiles--carto mp-tiles--${dark ? 'dark' : 'light'}`,
      attribution: [osm, { text: '© CARTO', href: CARTO_ATTRIBUTIONS }],
    };
  }
  return {
    provider: 'osm',
    url: OSM_TILES,
    subdomains: '',
    maxZoom: TILE_MAX_ZOOM,
    maxNativeZoom: 19,
    className: `mp-tiles mp-tiles--osm mp-tiles--${dark ? 'dark mp-tiles--dark-filter' : 'light'}`,
    attribution: [osm],
  };
}

/**
 * 底图有没有加载成：数瓦片的成功 / 失败（Leaflet 的 tileload / tileerror），联网 / 断网时重新起算。
 * @typedef {{ loaded: number, failed: number, online: boolean, since: number }} TileState
 * @param {TileState} state
 * @param {{ type: 'load'|'error'|'online'|'offline'|'reset' }} ev
 * @returns {TileState}
 */
export function tileStatusReducer(state, ev) {
  const s = state || { loaded: 0, failed: 0, online: true, since: 0 };
  switch (ev?.type) {
    case 'load': return { ...s, loaded: s.loaded + 1 };
    case 'error': return { ...s, failed: s.failed + 1 };
    case 'offline': return { ...s, online: false };
    case 'online': return { loaded: 0, failed: 0, online: true, since: s.since + 1 };
    case 'reset': return { loaded: 0, failed: 0, online: s.online, since: s.since + 1 };
    default: return s;
  }
}

/**
 * 地图上要不要提示“底图加载不了”：
 *   断网 → 有瓦片失败就提示（浏览器缓存里的瓦片照样显示，所以全都成功时不提示）；
 *   联网 → 失败的瓦片比成功的多、且至少 3 块（偶尔一两块超时不打扰），或者一块都没成功。
 * @returns {null | { offline: boolean, title: string, detail: string }}
 */
export function tileBanner(state) {
  if (!state) return null;
  const { loaded, failed, online } = state;
  if (!failed) return null;
  const bad = loaded === 0 || (failed >= 3 && failed > loaded);
  if (!online && (loaded === 0 || failed > loaded)) {
    return { offline: true, title: '离线中，地图底图加载不了', detail: '地点、路线和下面的列表照常能用；联网后自动补上' };
  }
  if (online && bad) {
    return { offline: false, title: '地图底图加载不了', detail: '网络不太好。地点和路线照常能用' };
  }
  return null;
}

// ---------------------------------------------------------------------
// 定位
// ---------------------------------------------------------------------

/** GeolocationPositionError 的 code（1 被拒、2 定不到、3 超时）+ 我们自己的 0 = 不支持 */
export const GEO_ERRORS = Object.freeze({ UNSUPPORTED: 0, DENIED: 1, UNAVAILABLE: 2, TIMEOUT: 3 });

/**
 * 定位失败时给人看的说明。
 * @param {number} code
 * @returns {{ code: number, title: string, message: string, steps: string[], tone: 'warning'|'danger' }}
 */
export function locationErrorInfo(code) {
  if (code === GEO_ERRORS.DENIED) {
    return {
      code,
      title: '没有定位权限',
      message: '要看「我的位置」，需要允许这个网站使用定位。在 iPhone 上这样打开：',
      steps: [
        '「设置」→「隐私与安全性」→「定位服务」：打开，往下找到「Safari 浏览器网站」，选「使用 App 期间」',
        '「设置」→「App」→「Safari 浏览器」→「位置」：选「询问」或「允许」',
        '在 Safari 里打开时，也可以点地址栏左边的「大小」图标 →「网站设置」→「位置」→「允许」',
        '改好以后回到这里，再点一次「我的位置」',
      ],
      tone: 'warning',
    };
  }
  if (code === GEO_ERRORS.TIMEOUT) {
    return { code, title: '定位超时', message: '这次没定到位置（信号弱、在室内或刚开机）。到开阔一点的地方再点一次「我的位置」。', steps: [], tone: 'warning' };
  }
  if (code === GEO_ERRORS.UNAVAILABLE) {
    return { code, title: '暂时定不到位置', message: '手机暂时拿不到位置。看看「定位服务」有没有打开，或者到开阔的地方再试一次。', steps: [], tone: 'warning' };
  }
  return { code: GEO_ERRORS.UNSUPPORTED, title: '这个浏览器不能定位', message: '这里拿不到位置。换 Safari 打开，或者从主屏幕上的图标打开再试。', steps: [], tone: 'danger' };
}
