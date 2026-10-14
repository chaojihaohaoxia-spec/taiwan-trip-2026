// =====================================================================
// sheets/place/model.js：地点页（pages/places）、地点详情（sheets/place）、写评级（sheets/review）共用的纯函数
// （Node 里能直接测：test/unit/page-places.test.js）。
//
//   RATING_TIERS / ratingName(5) → '夯'               评级五档（reviews.rating 1–5，docs/数据结构.md B4.13）
//   ratingSummary(reviews)                             几个人评了、平均落在哪一档（地点页「按评级」分组）
//   placeVisits({ items, days, startDate })            每个地点被哪些条目用到：排进哪天的（visits）、备选池里的（pool）
//   dayTags(visits, { todayId })                       「D1」「D2 备选」「今天」这种小标签（同一天只出一个）
//   reviewsByUser(reviews, members)                    评级按成员顺序排好、每人一条
//   placeTips(tips, placeId)                           这个地点的贴士（置顶 / 防坑在前）
//   scheduleTargets(days, { startDate, todayId, hidePast })  排进某天的按钮（D1…；行程中可以不列已经过去的天）
//   localName(place) / englishName(place)              要显示的当地语名、英文名（和中文名一样的不重复显示）
//   itemKindForPlace(place)                            把地点加进某天时新条目的种类（餐厅 → 吃饭、市场 → 夜市 / 购物…）
//   placeLinks(place)                                  地点的外链（links + maps_url，去重，只留 http(s)）
//   visitWhen(visit) / itemTimeText(item)              「D2 · 09:30–10:30」/「09:30–10:30」
//   firstPhotoPath(reviews)                            地点的第一张评级照片（列表 / 网格的缩略图）
//   needsReview(...) / latestDoneItem(...)             去过（条目已完成）但我还没评；最近一次去的那条（评级关联 item_id）
// =====================================================================

import { tripDayNumber, formatDate, formatItemTime } from '../../lib/datetime.js';
import { compareDayItems } from '../../lib/map/geo.js';
import { foldText } from '../../kit/search/fold.js';

// ---------------------------------------------------------------------
// 评级五档
// ---------------------------------------------------------------------

// 五档、isRating、ratingName、ratingSummary、reviewHasContent 在 kit/rating.js（行程概览「评级最高」也用），这里转出去保持原来的引用方式
export { RATING_TIERS, isRating, ratingName, ratingSummary, reviewHasContent } from '../../kit/rating.js';
import { isRating, reviewHasContent } from '../../kit/rating.js';

// ---------------------------------------------------------------------
// 名字
// ---------------------------------------------------------------------

const same = (a, b) => Boolean(a && b) && foldText(String(a)).trim() === foldText(String(b)).trim();

/**
 * 要显示的当地语名：没写、或者和中文名写得一样（「The Home Pizza」两栏都是英文）时不显示，免得同一行字出现两遍。
 * 比较时不分大小写、不看声调。
 */
export function localName(place) {
  const v = String(place?.name_local || '').trim();
  return v && !same(v, place?.name) ? v : null;
}

/** 要显示的英文名：和中文名、当地语名都不一样时才显示 */
export function englishName(place) {
  const v = String(place?.name_en || '').trim();
  return v && !same(v, place?.name) && !same(v, place?.name_local) ? v : null;
}

// ---------------------------------------------------------------------
// 地点种类的顺序
// ---------------------------------------------------------------------

/** 地点页按类型分组的顺序：吃喝在前（最常评级、最常找），交通站点、其他在后 */
export const PLACE_KIND_ORDER = Object.freeze(['food', 'cafe', 'bar', 'market', 'sight', 'beach', 'activity', 'shop', 'hotel', 'hub', 'other']);

/** 不认识的种类当成 other */
export function placeKind(place) {
  const k = place?.kind;
  return PLACE_KIND_ORDER.includes(k) ? k : 'other';
}

/** 吃喝类的地点：写评级时「吃了什么」排在「买了什么」前面 */
export const EATING_KINDS = Object.freeze(['food', 'cafe', 'bar', 'market']);

/**
 * 把一个地点加进某天时，新条目的种类（items.kind 的取值，docs/数据结构.md B4.7）。
 * 市场：名字里有「夜市」/ night 的算夜市，其他算购物。
 */
export function itemKindForPlace(place) {
  const k = placeKind(place);
  switch (k) {
    case 'food': return 'food';
    case 'cafe': return 'cafe';
    case 'sight': return 'sight';
    case 'beach': return 'beach';
    case 'activity': return 'activity';
    case 'hotel': return 'hotel';
    case 'hub': return 'transport';
    case 'shop': return 'shopping';
    case 'market': return /夜市|night/i.test(`${place?.name || ''} ${place?.name_en || ''}`) ? 'night_market' : 'shopping';
    default: return 'other';
  }
}

// ---------------------------------------------------------------------
// 地点在行程里的位置
// ---------------------------------------------------------------------

const rows = (x) => (!x ? [] : x instanceof Map ? [...x.values()] : Array.isArray(x) ? x : Object.values(x));

/**
 * 每个地点被哪些条目用到（软删除的条目不算）。
 * @param {{ items: Map|Array, days: Map|Array, startDate?: string }} src
 * @returns {Map<string, { visits: Array<{ item: object, day: object, n: number|null, alt: boolean }>, pool: object[] }>}
 *   visits：排进了某一天的条目（按天、再按当天的先后）；alt = 备选 / 雨天方案（variant 不是 primary）
 *   pool：备选池里（没排进哪天）的条目
 */
export function placeVisits({ items, days, startDate }) {
  const dayById = new Map(rows(days).map((d) => [d.id, d]));
  const out = new Map();
  const slot = (id) => {
    let s = out.get(id);
    if (!s) {
      s = { visits: [], pool: [] };
      out.set(id, s);
    }
    return s;
  };
  for (const it of rows(items)) {
    if (!it || it.deleted_at || !it.place_id) continue;
    if (!it.day_id) {
      slot(it.place_id).pool.push(it);
      continue;
    }
    const day = dayById.get(it.day_id);
    if (!day) continue;
    slot(it.place_id).visits.push({ item: it, day, n: tripDayNumber(day.date, startDate), alt: Boolean(it.variant && it.variant !== 'primary') });
  }
  for (const s of out.values()) {
    s.visits.sort(compareVisits);
    s.pool.sort(compareDayItems);
  }
  return out;
}

/** 按天（日期）再按当天的先后 */
export function compareVisits(a, b) {
  const d = String(a.day.date).localeCompare(String(b.day.date));
  return d || compareDayItems(a.item, b.item);
}

/** 'D1'（第几天算不出来时用日期） */
export function dayLabel(n, date) {
  return Number.isInteger(n) && n > 0 ? `D${n}` : formatDate(date, { weekday: false, year: 'never' });
}

/**
 * 地点卡片上的「在哪天」：同一天只出一个标签（主方案优先），按天排；今天那天标出来。
 * @param {Array<{ day: object, n: number|null, alt: boolean }>} visits
 * @param {{ todayId?: string|null }} [o]
 * @returns {Array<{ id: string, n: number|null, label: string, alt: boolean, today: boolean, date: string }>}
 */
export function dayTags(visits = [], { todayId = null } = {}) {
  const byDay = new Map();
  for (const v of visits) {
    const prev = byDay.get(v.day.id);
    if (!prev) byDay.set(v.day.id, { id: v.day.id, n: v.n, label: dayLabel(v.n, v.day.date), alt: v.alt, today: v.day.id === todayId, date: v.day.date });
    else if (prev.alt && !v.alt) prev.alt = false;
  }
  return [...byDay.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** 地点第一次出现在行程里的位置（排序用）：[日期, 当天顺序]；没排进哪天 → null */
export function firstVisitKey(visits = []) {
  const v = visits.find((x) => !x.alt) || visits[0];
  return v ? [String(v.day.date), Number(v.item.sort_key) || 0] : null;
}

/** 条目的钟点说明：「09:30–10:30」「09:30（午饭后）」「午饭后」；都没有是 '' */
export function itemTimeText(item) {
  const t = formatItemTime(item);
  return t.main ? (t.sub ? `${t.main}（${t.sub}）` : t.main) : '';
}

/**
 * 一次“去”的时间说明：「D2 · 09:30–10:30」「D3 · 午饭后」「D1」。
 * @param {{ item: object, day: object, n: number|null }} visit
 */
export function visitWhen(visit) {
  return [dayLabel(visit.n, visit.day.date), itemTimeText(visit.item)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------
// 评级
// ---------------------------------------------------------------------

/**
 * 一个地点的评级按成员顺序排好（成员名单里没有的人排在最后），每人一条（万一有重复，留最新的）。
 * @param {object[]} reviews  这个地点的评级
 * @param {Array<{ user_id: string }>} members  data 的 view.members（owner 在前）
 */
export function reviewsByUser(reviews = [], members = []) {
  const order = new Map(members.map((m, i) => [m.user_id, i]));
  const latest = new Map();
  for (const r of reviews) {
    if (!r?.user_id) continue;
    const prev = latest.get(r.user_id);
    if (!prev || String(r.updated_at || r.created_at || '') > String(prev.updated_at || prev.created_at || '')) latest.set(r.user_id, r);
  }
  return [...latest.values()].sort((a, b) => (order.get(a.user_id) ?? 99) - (order.get(b.user_id) ?? 99));
}


/** 评级照片里的第一张路径（列表缩略图用）；按成员顺序找 */
export function firstPhotoPath(reviews = []) {
  for (const r of reviews) {
    const p = (r.photos || []).find((x) => x && typeof x.path === 'string' && x.path);
    if (p) return p.path;
  }
  return null;
}

/**
 * 去过但我还没评：有条目已经标了「完成」，而我没有评级（只写了评语也算评过）。
 * @param {{ visits: object[], pool?: object[] }} where  placeVisits 的一项
 * @param {object[]} reviews 这个地点的评级
 * @param {string|null} userId
 */
export function needsReview(where, reviews = [], userId = null) {
  if (!userId || !where) return false;
  if (!latestDoneItem(where)) return false;
  return !reviews.some((r) => r.user_id === userId && reviewHasContent(r));
}

/**
 * 最近一次去（标了完成）的那条条目：写评级时关联它（reviews.item_id），地点页的「去过还没评」按它排先后。
 * @param {{ visits: object[], pool?: object[] }} where
 * @returns {{ item: object, day: object|null, n: number|null } | null}
 */
export function latestDoneItem(where) {
  if (!where) return null;
  const done = (where.visits || []).filter((v) => v.item.status === 'done');
  if (done.length) return done[done.length - 1];
  const loose = (where.pool || []).find((it) => it.status === 'done');
  return loose ? { item: loose, day: null, n: null } : null;
}

// ---------------------------------------------------------------------
// 贴士、链接
// ---------------------------------------------------------------------

const TIP_ORDER = Object.freeze({ warning: 0, template: 1, phrase: 2, tip: 3, info: 4 });

/** 这个地点的贴士：置顶在前，再按种类（防坑、模板、常用语、小贴士、实用信息），再按原来的顺序 */
export function placeTips(tips = [], placeId) {
  return rows(tips)
    .map((t, i) => [t, i])
    .filter(([t]) => t && t.place_id === placeId)
    .sort(([a, ia], [b, ib]) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (TIP_ORDER[a.kind] ?? 9) - (TIP_ORDER[b.kind] ?? 9) || ia - ib)
    .map(([t]) => t);
}

const WEB = /^https?:\/\/[^\s/]+/i;

/**
 * 地点的外链：links（B5.1 的 Link[]）+ maps_url（「Google 地图」），只留 http(s)，同一个网址只出一次。
 * @returns {Array<{ label: string, url: string, kind: string }>}
 */
export function placeLinks(place) {
  const out = [];
  const seen = new Set();
  const add = (label, url, kind) => {
    const u = String(url || '').trim();
    if (!WEB.test(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ label: String(label || '').trim() || '链接', url: u, kind: kind || 'other' });
  };
  for (const l of Array.isArray(place?.links) ? place.links : []) add(l?.label, l?.url, l?.kind);
  if (place?.maps_url) add('Google 地图', place.maps_url, 'maps');
  return out;
}

// ---------------------------------------------------------------------
// 备选池 → 排进某天
// ---------------------------------------------------------------------

/**
 * 「排进哪天」的按钮：每一天一个（D1…），今天标出来。
 * @param {object[]} days  按日期排好的 days
 * @param {{ startDate?: string, todayId?: string|null, hidePast?: boolean }} [o]
 *   hidePast：行程进行中（给了 todayId）时不列今天以前的天——排进已经过去的一天没有意义，按钮少了也好点
 * @returns {Array<{ id: string, date: string, n: number|null, label: string, title: string, today: boolean }>}
 */
export function scheduleTargets(days = [], { startDate, todayId = null, hidePast = false } = {}) {
  const list = rows(days);
  const todayDate = hidePast && todayId ? list.find((d) => d.id === todayId)?.date : null;
  return list.filter((d) => !todayDate || String(d.date) >= String(todayDate)).map((d) => {
    const n = tripDayNumber(d.date, startDate);
    const label = dayLabel(n, d.date);
    const when = formatDate(d.date, { weekday: true, year: 'never' });
    return { id: d.id, date: d.date, n, label, title: [when, String(d.title || '').trim()].filter(Boolean).join(' · '), today: d.id === todayId };
  });
}
