// =====================================================================
// pages/places/model.js：地点页的筛选、搜索、分组（纯函数，Node 里能直接测：test/unit/page-places.test.js）。
//
//   const entries = buildEntries({ places, visits, reviewsByPlace, members, userId, todayId });
//   const shown   = filterEntries(entries, { kind: 'food', query: 'pho' });     // [{ entry, hit: { name, local } }]
//   const groups  = groupEntries(shown, 'day', { days, startDate, todayId });   // 按类型 / 按天 / 想去 / 按评级
//   const pool    = filterPool(store.view.pool.value, { query, kind, placesById });
//   const nudges  = reviewNudges(entries);                                      // 去过、我还没评的
//
// 搜索和全站搜索同一个“折叠”规则（kit/search/fold.js）：不分大小写、全角半角一样、越南语不带声调也能搜
// （pho → Phở、ben tau → Bến tàu）；几个词用空格分开，每个词都要命中。
// =====================================================================

import { foldText, queryTokens, findRanges } from '../../kit/search/fold.js';
import { kindLabel } from '../../kit/kinds.js';
import {
  PLACE_KIND_ORDER, RATING_TIERS, placeKind, dayTags, firstVisitKey, reviewsByUser, firstPhotoPath, needsReview, latestDoneItem,
  dayLabel, compareVisits, ratingSummary,
} from '../../sheets/place/model.js';
import { tripDayNumber, formatDate } from '../../lib/datetime.js';

/** 四种看法（分段控件） */
export const MODES = Object.freeze(['kind', 'day', 'want', 'rating']);
export const MODE_LABELS = Object.freeze({ kind: '按类型', day: '按天', want: '想去', rating: '评级' });

/** 网址 / 本机记住的值 → 合法的值 */
export const normalizeMode = (v, fallback = 'kind') => (MODES.includes(v) ? v : MODES.includes(fallback) ? fallback : 'kind');
export const normalizeView = (v) => (v === 'grid' ? 'grid' : 'list');
export const normalizeKind = (v) => (PLACE_KIND_ORDER.includes(v) ? v : 'all');

/**
 * 没在网址里指定、本机也没记住时默认用哪种看法：行程结束了看「评级」（回顾评得最高的），其他时候「按类型」。
 * @param {'upcoming'|'ongoing'|'ended'|'undated'|string} phase
 */
export const defaultMode = (phase) => (phase === 'ended' ? 'rating' : 'kind');

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('zh-Hans-CN') : null;
const byName = (a, b) => (collator ? collator.compare(String(a || ''), String(b || '')) : String(a || '').localeCompare(String(b || '')));

/** 一个地点能被搜到的文字（名字、当地语名、英文名、别名、地址、标签、介绍），折叠好的 */
export function placeHaystack(p) {
  return foldText([p.name, p.name_local, p.name_en, ...(p.aliases || []), p.address, ...(p.tags || []), p.description].filter(Boolean).join(' \u0001 '));
}

/**
 * 每个地点一项：它的种类、在行程里的位置、两个人的评级、缩略图、要不要提醒“去评级”。
 * @param {{ places: object[], visits: Map, reviewsByPlace?: Map, members?: object[], userId?: string|null, todayId?: string|null }} src
 *   visits：sheets/place/model.js 的 placeVisits() 结果
 */
export function buildEntries({ places = [], visits = new Map(), reviewsByPlace = new Map(), members = [], userId = null, todayId = null }) {
  return places.map((place) => {
    const where = visits.get(place.id) || { visits: [], pool: [] };
    const reviews = reviewsByUser(reviewsByPlace.get(place.id) || [], members);
    const nudge = needsReview(where, reviews, userId);
    return {
      id: place.id,
      place,
      kind: placeKind(place),
      visits: where.visits,
      pool: where.pool,
      tags: dayTags(where.visits, { todayId }),
      reviews,
      rating: ratingSummary(reviews),
      mine: userId ? reviews.find((r) => r.user_id === userId) || null : null,
      photo: firstPhotoPath(reviews),
      needsReview: nudge,
      done: nudge ? latestDoneItem(where) : null,
      firstKey: firstVisitKey(where.visits),
      hay: placeHaystack(place),
    };
  });
}

/**
 * 一项是不是命中了查询：每个词都要出现在能搜的文字里；返回名字、当地语名里要高亮的位置。
 * @returns {null | { name: Array<[number, number]>, local: Array<[number, number]> }}
 */
export function matchEntry(entry, tokens) {
  if (!tokens.length) return { name: [], local: [] };
  for (const t of tokens) if (!entry.hay.includes(t)) return null;
  return { name: findRanges(entry.place.name, tokens), local: findRanges(entry.place.name_local, tokens) };
}

/**
 * 按种类、查询筛选。
 * @param {object[]} entries buildEntries 的结果
 * @param {{ kind?: string, query?: string }} [o] kind：'all' 或地点种类
 * @returns {Array<{ entry: object, hit: { name: Array, local: Array } }>}
 */
export function filterEntries(entries, { kind = 'all', query = '' } = {}) {
  const tokens = queryTokens(query);
  const out = [];
  for (const entry of entries) {
    if (kind !== 'all' && entry.kind !== kind) continue;
    const hit = matchEntry(entry, tokens);
    if (hit) out.push({ entry, hit });
  }
  return out;
}

/** 每种有几个（种类芯片用；只列有的种类，按 PLACE_KIND_ORDER） */
export function kindCounts(entries) {
  const n = new Map();
  for (const e of entries) n.set(e.kind, (n.get(e.kind) || 0) + 1);
  return PLACE_KIND_ORDER.filter((k) => n.get(k)).map((k) => ({ kind: k, label: kindLabel('place', k), count: n.get(k) }));
}

/** 先按第一次出现在行程里的位置，没排进行程的按名字 */
function compareEntries(a, b) {
  const ka = a.entry.firstKey;
  const kb = b.entry.firstKey;
  if (ka && kb) return ka[0].localeCompare(kb[0]) || ka[1] - kb[1] || byName(a.entry.place.name, b.entry.place.name);
  if (ka) return -1;
  if (kb) return 1;
  return byName(a.entry.place.name, b.entry.place.name);
}

/** 按评级：平均分高的在前，同分时评的人多的在前，再按行程里的先后 */
function compareRated(a, b) {
  return (b.entry.rating.avg ?? 0) - (a.entry.rating.avg ?? 0) || b.entry.rating.count - a.entry.rating.count || compareEntries(a, b);
}

/**
 * 分组。
 * @param {Array<{ entry, hit }>} list filterEntries 的结果
 * @param {'kind'|'day'|'want'|'rating'} mode
 * @param {{ days?: object[], startDate?: string, todayId?: string|null }} [o]
 * @returns {Array<{ key: string, title: string, meta?: string, kind?: string, tier?: number, day?: object, n?: number,
 *                   today?: boolean, rows: Array<{ entry, hit, visit?: object }> }>}
 *   按天时每一行带 visit（那天第一次用到它的条目：时间、条目名）；一个地点可以出现在好几天里；
 *   组标题是「D1 · 1月10日 周日」，那天的标题放在 meta
 */
export function groupEntries(list, mode, { days = [], startDate, todayId = null } = {}) {
  if (mode === 'day') {
    const groups = [];
    for (const day of days) {
      const rowsOfDay = [];
      for (const r of list) {
        const visit = r.entry.visits.find((v) => v.day.id === day.id && !v.alt) || r.entry.visits.find((v) => v.day.id === day.id);
        if (visit) rowsOfDay.push({ ...r, visit });
      }
      if (!rowsOfDay.length) continue;
      rowsOfDay.sort((a, b) => compareVisits(a.visit, b.visit));
      const n = tripDayNumber(day.date, startDate);
      // 标题短（「D1 · 1月10日 周日」，宋体一行放得下）；当天的标题（常常很长）放在下面的小字里
      const when = formatDate(day.date, { weekday: true, year: 'never' });
      groups.push({
        key: `day:${day.id}`, title: Number.isInteger(n) && n > 0 ? `${dayLabel(n, day.date)} · ${when}` : when, day, n, today: day.id === todayId,
        meta: String(day.title || '').trim() || null, rows: rowsOfDay,
      });
    }
    const loose = list.filter((r) => !r.entry.visits.length).sort(compareEntries);
    if (loose.length) groups.push({ key: 'loose', title: '没排进哪天', meta: '还没有哪一天的条目用到这些地点', rows: loose });
    return groups;
  }
  if (mode === 'want') {
    const wish = list.filter((r) => r.entry.place.wishlist).sort(compareEntries);
    return wish.length ? [{ key: 'wish', title: '想去清单', meta: '收进想去的地方，有空就去', rows: wish }] : [];
  }
  if (mode === 'rating') {
    const groups = [];
    for (const t of RATING_TIERS) {
      const rowsOfTier = list.filter((r) => r.entry.rating.tier === t.value).sort(compareRated);
      if (rowsOfTier.length) groups.push({ key: `tier:${t.value}`, title: t.label, tier: t.value, meta: t.hint, rows: rowsOfTier });
    }
    const unrated = list.filter((r) => r.entry.rating.tier === null);
    const noted = unrated.filter((r) => r.entry.reviews.length).sort(compareEntries);
    if (noted.length) groups.push({ key: 'noted', title: '只写了评语', meta: '还没选档位', rows: noted });
    // 还没评：机场、车站这类路过的地方排在最后（一般不会去评它们）
    const passBy = (r) => (NO_NUDGE_KINDS.includes(r.entry.kind) ? 1 : 0);
    const rest = unrated.filter((r) => !r.entry.reviews.length).sort((a, b) => passBy(a) - passBy(b) || compareEntries(a, b));
    if (rest.length) groups.push({ key: 'unrated', title: '还没评', meta: '去过以后给它评个级', rows: rest });
    return groups;
  }
  const groups = [];
  for (const k of PLACE_KIND_ORDER) {
    const rowsOfKind = list.filter((r) => r.entry.kind === k).sort(compareEntries);
    if (rowsOfKind.length) groups.push({ key: `kind:${k}`, title: kindLabel('place', k), kind: k, rows: rowsOfKind });
  }
  return groups;
}

/** 不提醒去评级的地点种类：机场、车站、码头（路过而已） */
export const NO_NUDGE_KINDS = Object.freeze(['hub']);

/**
 * 「去过，还没评级」：条目标了完成、我还没评的地点（交通站点不算），最近去的在前。
 * @param {object[]} entries buildEntries 的结果
 * @returns {object[]} entries 的子集（每项的 done = { item, day, n }）
 */
export function reviewNudges(entries) {
  const key = (e) => {
    const d = e.done;
    if (!d) return ['', 0];
    return [String(d.day?.date || ''), Number(d.item.sort_key) || 0];
  };
  return entries.filter((e) => e.needsReview && !NO_NUDGE_KINDS.includes(e.kind)).sort((a, b) => {
    const [da, sa] = key(a);
    const [db, sb] = key(b);
    return db.localeCompare(da) || sb - sa || byName(a.place.name, b.place.name);
  });
}

/** 条目能被搜到的文字（标题、说明、地点的名字） */
function itemHaystack(item, place) {
  return foldText([item.title, item.description, item.time_label, ...(item.tags || []), place?.name, place?.name_local, place?.name_en].filter(Boolean).join(' \u0001 '));
}

/**
 * 备选池（没排进哪天的条目）按查询、种类筛选。
 * @param {object[]} pool  store.view.pool（已经排好序、去掉了软删除）
 * @param {{ query?: string, kind?: string, placesById?: Map }} [o]
 *   kind 不是 'all' 时：只留下地点是这个种类的条目（没有地点的条目不算）
 * @returns {Array<{ item: object, place: object|null, hit: Array<[number, number]> }>}
 */
export function filterPool(pool = [], { query = '', kind = 'all', placesById = new Map() } = {}) {
  const tokens = queryTokens(query);
  const out = [];
  for (const item of pool) {
    const place = item.place_id ? placesById.get(item.place_id) || null : null;
    if (kind !== 'all' && (!place || placeKind(place) !== kind)) continue;
    if (tokens.length) {
      const hay = itemHaystack(item, place);
      if (!tokens.every((t) => hay.includes(t))) continue;
    }
    out.push({ item, place, hit: findRanges(item.title, tokens) });
  }
  return out;
}

/**
 * 页面顶上的一句话：「38 个地点 · 评过 6 个 · 想去 3 个」；筛选时「显示 6 个（共 38 个地点）」。
 * @param {{ total: number, shown: number, rated: number, wish: number, filtered: boolean }} n
 */
export function summaryLine({ total, shown, rated, wish, filtered }) {
  if (!total) return '';
  if (filtered) return `显示 ${shown} 个（共 ${total} 个地点）`;
  const parts = [`${total} 个地点`];
  if (rated) parts.push(`评过 ${rated} 个`);
  if (wish) parts.push(`想去 ${wish} 个`);
  return parts.join(' · ');
}

/** 「想去」看法下没有结果时的说明（区分：根本没有想去的地方 / 筛选后没有） */
export function emptyText({ mode, query, kind, total, wish }) {
  if (!total) return null;
  const filtered = Boolean(String(query || '').trim()) || kind !== 'all';
  if (mode === 'want' && !wish) {
    return { title: '想去清单还是空的', description: '在地点详情里点「想去」，就会收进这里。', filtered: false };
  }
  if (filtered) {
    const q = String(query || '').trim();
    return { title: q ? `没有找到「${q}」` : '这一类还没有地点', description: '换个关键词，或者清除筛选看全部。', filtered: true };
  }
  return { title: '没有地点', description: '', filtered: false };
}
