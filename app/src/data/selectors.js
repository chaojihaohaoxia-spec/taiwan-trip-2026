// =====================================================================
// data/selectors.js：从行程数据推出来的东西（纯函数，不入库，Node 里能直接测）。
//
// 输入是“数据包” Bundle（见 bundleFromRows）：
//   { tripId, trip, members: Map<user_id,row>, segments/places/bookings/days/items/contacts/
//     todos/tips/journal_entries/reviews/expenses: Map<id,row> }
// 和上下文 ctx：{ at: Date（现在，来自 lib/clock.js）, fx（data/fx.js 的换算器）, userId }。
//
// 规则全部来自 docs/数据结构.md：
//   A2 排序、软删除、“前端从数据推出来的东西”（第几天、行程阶段、当天地图路线、总路线、预算、天气点）
//   B5.6 预算汇总（per person × 人数，区间分别汇总，换算成 home_currency）
//   B5.9 记账分摊（equal / amounts / personal / 旧数据 {} 看 split_with）
//
// 页面一般不直接调这里，而是用 TripStore 上包好的 computed（store.view.*），数据一变自动重算。
// =====================================================================

import { todayIn, daysBetween, now as clockNow } from '../lib/clock.js';
import { tripPhase as libTripPhase, formatTripPhase } from '../lib/datetime.js';
import { compareDayItems, dayRoute as routeOfItems, placePoint } from '../lib/map/geo.js';
import { approxHKD } from '../lib/money.js';
import { normalizeCurrency, toMinor, fromMinor, allocate, allocateSigned, currencyDecimals, createFx } from './fx.js';
import { nowInZone, zonedStartOfDay } from './zoned.js';
import { tsMs, timeToMinutes, addDays, emailHandle } from './util.js';
import { BUNDLE_TABLES } from './tables.js';

// ---------------------------------------------------------------------
// 数据包
// ---------------------------------------------------------------------

/**
 * 各表的行（数组）→ 数据包。trip_members 按 user_id 做键，其余按 id。
 * @param {string} tripId
 * @param {Record<string, object[]>} rows
 */
export function bundleFromRows(tripId, rows = {}) {
  const b = { tripId, trip: null, members: new Map() };
  for (const t of BUNDLE_TABLES) {
    if (t === 'trips' || t === 'trip_members') continue;
    b[t] = new Map((rows[t] || []).map((r) => [r.id, r]));
  }
  for (const m of rows.trip_members || []) if (m.trip_id === tripId) b.members.set(m.user_id, m);
  b.trip = (rows.trips || []).find((t) => t.id === tripId) || null;
  return b;
}

const values = (m) => (m ? [...m.values()] : []);
const byNum = (a, b) => (a ?? 0) - (b ?? 0);
const byStr = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));
const byTs = (a, b) => (tsMs(a) || 0) - (tsMs(b) || 0);

/** 没被软删除 */
export function isLive(row) {
  return Boolean(row) && !row.deleted_at;
}

// ---------------------------------------------------------------------
// 时间：今天、阶段、第几天、倒计时
// ---------------------------------------------------------------------

/** 行程阶段的名字（和 lib/datetime.js 的 tripPhase 同一套：upcoming / ongoing / ended / undated） */
export const PHASE_LABELS = Object.freeze({ upcoming: '未开始', ongoing: '进行中', ended: '已结束', undated: '日期未定' });

/** 行程时区（没写按香港） */
export function tripTimezone(trip) {
  return trip?.timezone || 'Asia/Hong_Kong';
}

/** 行程时区里的今天 'YYYY-MM-DD' */
export function tripToday(trip, at = clockNow()) {
  return todayIn(tripTimezone(trip), at);
}

/**
 * 行程阶段（按行程时区的今天对比起止日期；trips.status 是手动状态，和阶段无关）。
 * 计算只在 lib/datetime.js 的 tripPhase 做一份，这里加上中文名 label。
 * @returns {{ phase: 'upcoming'|'ongoing'|'ended'|'undated', label: string, today: string, totalDays, dayNumber, daysUntilStart, daysSinceEnd }}
 */
export function tripPhase(trip, at = clockNow()) {
  if (!trip?.start_date) return { phase: 'undated', label: PHASE_LABELS.undated };
  const p = libTripPhase(trip, at);
  return { ...p, label: PHASE_LABELS[p.phase] };
}

/** 第几天 = date − start_date + 1（不在行程里也照算，可能 ≤0 或超过天数） */
export function dayNumber(trip, date) {
  if (!trip?.start_date || !date) return null;
  return daysBetween(trip.start_date, date) + 1;
}

/** 行程一共几天 */
export function tripLength(trip) {
  if (!trip?.start_date) return null;
  return daysBetween(trip.start_date, trip.end_date || trip.start_date) + 1;
}

/** 行程期间的每一个日期（days 表里还没建的天也列出来） */
export function tripDates(trip) {
  const n = tripLength(trip);
  if (!n || n < 1 || n > 400) return [];
  return Array.from({ length: n }, (_, i) => addDays(trip.start_date, i));
}

/**
 * 倒计时 / 进度。
 * @returns {{ phase, label, today, daysUntilStart?, msUntilStart?, dayNumber?, totalDays?, isLastDay?, daysSinceEnd? }}
 */
export function countdown(trip, at = clockNow()) {
  const p = tripPhase(trip, at);
  if (p.phase === 'undated') return { phase: 'undated', label: PHASE_LABELS.undated, today: null };
  // 一句话的说法和 lib/datetime.js 的 formatTripPhase 一致（'还有 3 天出发' / '第 2 天 · 共 4 天' / '最后一天 · 共 4 天' / '昨天结束'）
  const label = formatTripPhase(trip, at);
  const { phase, today, totalDays } = p;
  if (phase === 'upcoming') {
    const msUntilStart = Math.max(0, zonedStartOfDay(trip.start_date, tripTimezone(trip)) - at.getTime());
    return { phase, label, today, daysUntilStart: p.daysUntilStart, msUntilStart, totalDays };
  }
  if (phase === 'ongoing') {
    return { phase, label, today, dayNumber: p.dayNumber, totalDays, isLastDay: p.dayNumber === totalDays };
  }
  return { phase, label, today, daysSinceEnd: p.daysSinceEnd, totalDays };
}

// ---------------------------------------------------------------------
// 排序（文档 A2）
// ---------------------------------------------------------------------

/** segments：sort，再按 start_date */
export function sortedSegments(map) {
  return values(map).sort((a, b) => byNum(a.sort, b.sort) || byStr(a.start_date || '9999', b.start_date || '9999') || byStr(a.id, b.id));
}

/** days：date */
export function sortedDays(map) {
  return values(map).sort((a, b) => byStr(a.date, b.date));
}

/** items 同一天内：sort_key → start_time（空值在后）→ created_at → id（规则只在 lib/map/geo.js 的 compareDayItems 写一份） */
export function compareItems(a, b) {
  return compareDayItems(a, b);
}

/** bookings：start_at（空值在后）→ sort → created_at */
export function compareBookings(a, b) {
  const sa = tsMs(a.start_at);
  const sb = tsMs(b.start_at);
  const na = Number.isNaN(sa);
  const nb = Number.isNaN(sb);
  if (na !== nb) return na ? 1 : -1;
  if (!na && sa !== sb) return sa - sb;
  return byNum(a.sort, b.sort) || byTs(a.created_at, b.created_at) || byStr(a.id, b.id);
}

export function sortedBookings(map) {
  return values(map).sort(compareBookings);
}

/** contacts：sort → created_at */
export function sortedContacts(map) {
  return values(map).sort((a, b) => byNum(a.sort, b.sort) || byTs(a.created_at, b.created_at) || byStr(a.id, b.id));
}

/** tips：置顶在前 → sort → created_at */
export function sortedTips(map) {
  return values(map).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || byNum(a.sort, b.sort) || byTs(a.created_at, b.created_at) || byStr(a.id, b.id));
}

export const TODO_LISTS = Object.freeze(['confirm', 'packing', 'todo', 'buy']);
export const TODO_LIST_LABELS = Object.freeze({ confirm: '待确认', packing: '打包', todo: '待办', buy: '要买' });

/** todos 同一清单内：sort → created_at */
export function compareTodos(a, b) {
  return byNum(a.sort, b.sort) || byTs(a.created_at, b.created_at) || byStr(a.id, b.id);
}

/** todos 按清单分开（固定顺序：待确认、打包、待办、要买） */
export function todosByList(map) {
  const out = new Map(TODO_LISTS.map((l) => [l, []]));
  for (const t of values(map)) {
    if (!out.has(t.list)) out.set(t.list, []);
    out.get(t.list).push(t);
  }
  for (const list of out.values()) list.sort(compareTodos);
  return out;
}

/** 关联到某一天的待办（day_id → 待办，清单顺序 + 清单内顺序） */
export function todosByDay(map) {
  return groupSorted(map, (t) => t.day_id, (a, b) => TODO_LISTS.indexOf(a.list) - TODO_LISTS.indexOf(b.list) || compareTodos(a, b));
}

/** 关联到某个预订的待办 */
export function todosByBooking(map) {
  return groupSorted(map, (t) => t.booking_id, (a, b) => TODO_LISTS.indexOf(a.list) - TODO_LISTS.indexOf(b.list) || compareTodos(a, b));
}

/** 打包清单按 category 分组，组的顺序 = 排序后第一次出现的顺序（文档 B4.9） */
export function packingGroups(map) {
  const list = values(map).filter((t) => t.list === 'packing').sort(compareTodos);
  const groups = new Map();
  for (const t of list) {
    const k = t.category || '其他';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups].map(([category, items]) => ({ category, items, done: items.filter((x) => x.done).length }));
}

function groupSorted(map, keyFn, cmp) {
  const out = new Map();
  for (const row of values(map)) {
    const k = keyFn(row);
    if (k === null || k === undefined) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  for (const list of out.values()) list.sort(cmp);
  return out;
}

// ---------------------------------------------------------------------
// 天、条目
// ---------------------------------------------------------------------

/** date → day 行 */
export function dayByDate(map) {
  const out = new Map();
  for (const d of values(map)) out.set(d.date, d);
  return out;
}

/** 这一天的时区：所属分段的 timezone，没写按行程时区 */
export function dayTimezone(bundle, day) {
  const seg = day?.segment_id ? bundle.segments?.get(day.segment_id) : null;
  return seg?.timezone || tripTimezone(bundle.trip);
}

/** “今天”对应的 day 行（按每一天自己的时区校正过，见 resolveToday；不在行程里返回 null） */
export function todayDay(bundle, at = clockNow()) {
  return resolveToday(bundle, at)?.day || null;
}

/** 某个日期落在哪个分段（按排序取第一个包含它的；跨城日两段重叠时取前一段） */
export function segmentForDate(bundle, date) {
  for (const s of sortedSegments(bundle.segments)) {
    if (s.start_date && s.start_date <= date && (!s.end_date || date <= s.end_date)) return s;
  }
  return null;
}

/** 条目按天分组（未删除；day_id 为空的在 null 键下 = 备选池），每组已排好序（含所有方案） */
export function itemsByDay(map) {
  const out = new Map();
  for (const it of values(map)) {
    if (!isLive(it)) continue;
    const k = it.day_id ?? null;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(it);
  }
  for (const list of out.values()) list.sort(compareItems);
  return out;
}

/**
 * 一天的条目拆成主方案和备选（文档 B4.7 variant / parent_item_id）。
 * @param {object[]} dayItems 这一天的条目（已排序、未删除）
 * @returns {{ primary: object[], alternatives: Map<string, object[]>, general: object[], all: object[] }}
 *   alternatives：主方案 id → 挂在它下面的 backup / rain；general：没挂在任何主方案下的通用备选
 */
export function dayPlan(dayItems = []) {
  const primary = [];
  const alternatives = new Map();
  const general = [];
  const primaryIds = new Set(dayItems.filter((i) => i.variant === 'primary').map((i) => i.id));
  for (const it of dayItems) {
    if (it.variant === 'primary') {
      primary.push(it);
    } else if (it.parent_item_id && primaryIds.has(it.parent_item_id)) {
      if (!alternatives.has(it.parent_item_id)) alternatives.set(it.parent_item_id, []);
      alternatives.get(it.parent_item_id).push(it);
    } else {
      general.push(it);
    }
  }
  return { primary, alternatives, general, all: dayItems };
}

/** 备选池：还没排进哪天的条目（未删除、已排序） */
export function poolItems(map) {
  return itemsByDay(map).get(null) || [];
}

/** 条目的开始 / 结束（当天第几分钟）；结束比开始早表示跨过午夜（+24h） */
export function itemSpan(item) {
  const start = timeToMinutes(item.start_time);
  if (start === null) return null;
  let end = timeToMinutes(item.end_time);
  if (end !== null && end < start) end += 24 * 60;
  return { start, end };
}

/**
 * 当前进行中的条目和下一项（只看主方案里状态还是“计划中”、有开始时间的条目）。
 * 没写结束时间的条目，进行到下一条开始（最多 2 小时）。
 * @param {object[]} primary 当天主方案（已排序）
 * @param {number} nowMinutes 当地现在是当天第几分钟（zoned.nowInZone(...).minutes）
 * @param {{ carry?: object[] }} [o] carry：前一天主方案里跨过午夜的条目（例如 22:00–01:30），过了 0 点仍算进行中
 */
export function currentAndNext(primary, nowMinutes, { carry = [] } = {}) {
  const timed = primary
    .filter((i) => i.status === 'planned' && i.start_time)
    .map((i) => ({ item: i, span: itemSpan(i) }))
    .sort((a, b) => a.span.start - b.span.start);
  let current = null;
  let next = null;
  // 前一天跨午夜、还没结束的条目：换算到“今天”的分钟（开始是负数）
  for (const i of carry) {
    if (i.status !== 'planned' || !i.start_time) continue;
    const span = itemSpan(i);
    if (span?.end === null || span?.end === undefined || span.end <= 24 * 60) continue;
    if (nowMinutes < span.end - 24 * 60) {
      current = i;
      break;
    }
  }
  for (let k = 0; k < timed.length; k++) {
    const { item, span } = timed[k];
    const following = timed[k + 1]?.span.start;
    const end = span.end ?? Math.min(span.start + 120, following ?? span.start + 120);
    if (span.start <= nowMinutes && nowMinutes < end && !current) current = item;
    if (span.start > nowMinutes && !next) next = item;
  }
  const minutesUntilNext = next ? Math.round(itemSpan(next).start - nowMinutes) : null;
  return { current, next, minutesUntilNext };
}

/**
 * “今天”是行程里的哪一天，以及那一天当地的现在。
 * 先按行程时区找候选的天，再用每一天自己（所属分段）的时区校正：某一段在别的时区时
 * （例如行程按香港时间、这一段在越南），越南当地 23:00–24:00 之间香港已经是第二天，但当地还是这一天。
 * 候选：行程时区的今天、前一天、后一天里，“当地日期正好是它自己”的那一天（优先行程时区的今天）。
 * @returns {{ day: object, local: { date, time, minutes } } | null}
 */
export function resolveToday(bundle, at = clockNow()) {
  if (!bundle.trip) return null;
  const byDate = dayByDate(bundle.days);
  const base = tripToday(bundle.trip, at);
  let fallback = null;
  for (const date of [base, addDays(base, -1), addDays(base, 1)]) {
    const d = byDate.get(date);
    if (!d) continue;
    const local = nowInZone(at, dayTimezone(bundle, d));
    if (local.date === d.date) return { day: d, local };
    if (date === base) fallback = { day: d, local };
  }
  // 这几天都对不上（日期有空缺）：按行程时区的今天
  return fallback;
}

/**
 * 去程 / 回程航班（没取消、有起飞时刻）：去程 = 起飞地日期 ≤ 行程第一天的第一班；回程 = 起飞地日期 ≥ 最后一天的最后一班。
 * 和 pages/trip/model.js 的 outboundFlight / returnFlight 同一套规则（数据层不引页面的代码）。
 * @returns {{ outbound: object|null, back: object|null }}
 */
export function tripFlights(bundle) {
  const trip = bundle?.trip;
  if (!trip) return { outbound: null, back: null };
  const tz = tripTimezone(trip);
  const list = values(bundle.bookings)
    .filter((b) => isLive(b) && b.kind === 'flight' && b.status !== 'cancelled' && Number.isFinite(tsMs(b.start_at)))
    .sort((a, b) => tsMs(a.start_at) - tsMs(b.start_at));
  const dateOf = (f) => nowInZone(new Date(tsMs(f.start_at)), f.start_tz || tz).date;
  const outbound = trip.start_date ? list.find((f) => dateOf(f) <= trip.start_date) || null : null;
  let back = null;
  if (trip.end_date) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (dateOf(list[i]) >= trip.end_date) { back = list[i]; break; }
    }
  }
  return { outbound, back: back && back !== outbound ? back : null };
}

/**
 * 那一刻人在哪个时区（10-14 现场走查 P0-1 / P1-1）：显示「现在」的钟点、截止时间、记一笔的默认时间和币种用。
 *   - 去程航班落地（end_at，没写按起飞）之前：去程起飞地的时区（人还在香港）；
 *   - 回程航班落地之后：回程到达地的时区（回到香港了）；
 *   - 其余时间：行程时区。
 * 没有航班、或者航班两头都是行程时区：永远是行程时区。
 * @param {object} bundle
 * @param {Date|number|string} [at] 那一刻（默认现在）；可以传截止时间等任意时刻
 * @returns {string} IANA 时区
 */
export function presenceZone(bundle, at = clockNow()) {
  const tz = tripTimezone(bundle?.trip);
  const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : tsMs(at);
  if (!Number.isFinite(t)) return tz;
  const { outbound, back } = tripFlights(bundle);
  const landed = (f) => (Number.isFinite(tsMs(f.end_at)) ? tsMs(f.end_at) : tsMs(f.start_at));
  if (outbound && outbound.start_tz && outbound.start_tz !== tz && t < landed(outbound)) return outbound.start_tz;
  if (back && back.end_tz && back.end_tz !== tz && t >= landed(back)) return back.end_tz;
  return tz;
}

/**
 * 今天的概况：today 行、当地时间、当前 / 下一项（行程进行中才有）。
 * 当前项也会看前一天主方案里跨午夜还没结束的条目（22:00–01:30 过了 0 点仍是“进行中”）。
 */
export function todaySummary(bundle, plans, at = clockNow()) {
  const hit = resolveToday(bundle, at);
  if (!hit) return { day: null, local: null, current: null, next: null, minutesUntilNext: null };
  const { day, local } = hit;
  const planOf = (d) => plans?.get?.(d.id) || dayPlan(itemsByDay(bundle.items).get(d.id) || []);
  const plan = planOf(day);
  const prev = dayByDate(bundle.days).get(addDays(day.date, -1));
  const carry = prev ? planOf(prev).primary : [];
  return { day, local, ...currentAndNext(plan.primary, local.minutes, { carry }) };
}

/**
 * 按金额分摊（split.mode = 'amounts'）时，各人的份额加起来和总额对不上多少（原币最小单位）。
 * 0 = 对得上；其他模式永远是 0。记一笔 / 改一笔前检查，不让新数据出现对不上的分摊。
 */
export function splitMismatch(split, amount, currency) {
  if (!split || split.mode !== 'amounts' || !Array.isArray(split.shares)) return 0;
  const cur = normalizeCurrency(currency);
  const total = toMinor(Number(amount) || 0, cur);
  const sum = split.shares.reduce((acc, x) => acc + toMinor(Number(x.amount) || 0, cur), 0);
  return total - sum;
}

// ---------------------------------------------------------------------
// 地点、地图路线、住处、天气点
// ---------------------------------------------------------------------

/**
 * 地点坐标。没有坐标时退回所属分段中心，并标明“位置未知”（文档 A2 坐标）。
 * @returns {{ lat, lng, precision, approximate: boolean, unknown: boolean } | null}
 */
export function placeCoords(bundle, placeOrId) {
  const p = typeof placeOrId === 'string' ? bundle.places?.get(placeOrId) : placeOrId;
  if (!p) return null;
  // 坐标和“退回分段中心”的规则只在 lib/map/geo.js 的 placePoint 写一份；这里换成数据层的写法
  const seg = p.segment_id ? bundle.segments?.get(p.segment_id) : null;
  const pt = placePoint(p, seg);
  if (!pt) return null;
  const unknown = pt.precision === 'unknown';
  return { lat: pt.lat, lng: pt.lng, precision: unknown ? 'city' : pt.precision, approximate: pt.precision !== 'exact', unknown };
}

/**
 * 当天地图路线：当天主方案、未删除的条目按排序取地点坐标连线；步行路线（walk_route）的 stops 展开成多个点；
 * 连续同一地点只算一个点；legs[i].mode 是到这一站的推荐交通方式（lib/map/geo.js 的 dayRoute）。
 * 没有坐标的地点不连线，列在 missing 里（页面可以提示“N 个地点位置未知”）。
 * @returns {{ points: Array<{ itemId, placeId, name, kind, lat, lng, precision, approximate, order }>,
 *             legs: Array<{ from: number, to: number, mode: string|null }>, missing: Array<{ itemId, placeId, name }> }}
 */
export function dayRoute(bundle, dayId) {
  const items = itemsByDay(bundle.items).get(dayId) || [];
  // 连线本身（排序、步行路线展开成多个点、相邻同一点合并、每一段的交通方式）只在 lib/map/geo.js 算一份，地图组件用的是同一个
  const { points, legs } = routeOfItems(items, bundle.places || new Map());
  const missing = [];
  for (const it of items) {
    if (it.variant !== 'primary' || !it.place_id) continue;
    const place = bundle.places?.get(it.place_id);
    if (place && (place.lat === null || place.lat === undefined)) missing.push({ itemId: it.id, placeId: place.id, name: place.name });
  }
  return {
    points: points.map((p, i) => ({ ...p, approximate: p.precision !== 'exact', order: i + 1 })),
    legs,
    missing,
  };
}

/** 步行路线条目（kind = walk_route）的路线点：有 place_id 读地点坐标，没有用自带的 lat/lng */
export function stopsRoute(bundle, item) {
  return (item?.stops || []).map((s, i) => {
    const c = s.place_id ? placeCoords(bundle, s.place_id) : (s.lat !== undefined && s.lat !== null ? { lat: s.lat, lng: s.lng, approximate: false, unknown: false } : null);
    return { index: i, name: s.name, subtitle: s.subtitle ?? null, note: s.note ?? null, placeId: s.place_id ?? null, lat: c?.lat ?? null, lng: c?.lng ?? null, unknown: !c || c.unknown };
  });
}

/** 总路线：各分段按排序取中心点 */
export function tripRoute(bundle) {
  return sortedSegments(bundle.segments)
    .filter((s) => s.center_lat !== null && s.center_lat !== undefined)
    .map((s, i) => ({ segmentId: s.id, name: s.name, lat: s.center_lat, lng: s.center_lng, order: i + 1 }));
}

/** 当晚住处：days.stay_booking_id → 预订（+ 地点） */
export function stayForDay(bundle, day) {
  const booking = day?.stay_booking_id ? bundle.bookings?.get(day.stay_booking_id) : null;
  if (!booking) return null;
  return { booking, place: booking.place_id ? bundle.places?.get(booking.place_id) || null : null };
}

/** 天气查询点：当晚住处坐标 → 当天分段中心 → 第一个有中心的分段（文档 A2） */
export function weatherPoint(bundle, day) {
  const tz = day ? dayTimezone(bundle, day) : tripTimezone(bundle.trip);
  const stay = stayForDay(bundle, day);
  if (stay?.place && stay.place.lat !== null && stay.place.lat !== undefined) {
    return { lat: stay.place.lat, lng: stay.place.lng, timezone: tz, source: 'stay', name: stay.place.name };
  }
  const seg = day?.segment_id ? bundle.segments?.get(day.segment_id) : null;
  if (seg && seg.center_lat !== null && seg.center_lat !== undefined) return { lat: seg.center_lat, lng: seg.center_lng, timezone: tz, source: 'segment', name: seg.name };
  const first = tripRoute(bundle)[0];
  return first ? { lat: first.lat, lng: first.lng, timezone: tz, source: 'trip', name: first.name } : null;
}

// ---------------------------------------------------------------------
// 成员
// ---------------------------------------------------------------------

const ROLE_ORDER = { owner: 0, editor: 1, viewer: 2 };
export const ROLE_LABELS = Object.freeze({ owner: '创建者', editor: '可编辑', viewer: '只读' });

/** 实际角色：trips.owner_id 指向的成员也算 owner（文档 A3） */
export function effectiveRole(bundle, userId) {
  if (!userId) return null;
  const m = bundle.members?.get(userId);
  if (!m) return null;
  if (bundle.trip?.owner_id === userId) return 'owner';
  return m.role;
}

/** 能不能改共享内容（owner / editor） */
export function canEditTrip(bundle, userId) {
  const r = effectiveRole(bundle, userId);
  return r === 'owner' || r === 'editor';
}

/** 成员列表：owner → editor → viewer，再按加入时间 */
export function memberList(bundle) {
  return values(bundle.members)
    .map((m) => ({ ...m, role: effectiveRole(bundle, m.user_id) || m.role }))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byTs(a.joined_at, b.joined_at) || byStr(a.user_id, b.user_id));
}

/** 成员显示名：display_name → 邮箱 @ 前面 → “成员” */
export function memberName(bundle, userId) {
  const m = bundle.members?.get(userId);
  if (!m) return userId ? '已退出的成员' : '未记录';
  return m.display_name || emailHandle(m.email) || '成员';
}

/** 同行人数：trip.extra.party_size，没有则按 owner/editor 成员数（文档 B4.1），至少 1 */
export function partySize(bundle) {
  const n = Number(bundle.trip?.extra?.party_size);
  if (Number.isInteger(n) && n > 0) return n;
  const editors = values(bundle.members).filter((m) => {
    const r = effectiveRole(bundle, m.user_id);
    return r === 'owner' || r === 'editor';
  }).length;
  return Math.max(1, editors);
}

// ---------------------------------------------------------------------
// 预算（文档 A2 预算、B5.6）
// ---------------------------------------------------------------------

/**
 * 预订计入预算的金额（原币）：
 *   booked / pending → price_amount；idea（候选）→ 只在被已排期的主方案条目引用时按估算算；
 *   cancelled → 一般不算，但付了钱又没退（paid / partial）算已花掉的 paid_amount（没写按 price_amount）；
 *   payment_status = free / refunded → 0。
 * @returns {{ amount: number, currency: string, kind: 'booked'|'idea'|'sunk' } | null}
 */
export function bookingCost(b) {
  if (!b || b.price_amount === null || b.price_amount === undefined || !b.price_currency) return null;
  const currency = normalizeCurrency(b.price_currency);
  if (b.payment_status === 'free' || b.payment_status === 'refunded') return { amount: 0, currency, kind: b.status === 'idea' ? 'idea' : 'booked' };
  if (b.status === 'cancelled') {
    if (b.payment_status === 'paid' || b.payment_status === 'partial') return { amount: Number(b.paid_amount ?? b.price_amount), currency, kind: 'sunk' };
    return null;
  }
  return { amount: Number(b.price_amount), currency, kind: b.status === 'idea' ? 'idea' : 'booked' };
}

/** 预订的付款情况（原币）：已付、待付、到店付 */
export function bookingPayment(b) {
  const cost = bookingCost(b);
  if (!cost || cost.kind === 'idea') return null;
  const total = cost.amount;
  let paid = 0;
  if (b.payment_status === 'paid') paid = total;
  else if (b.payment_status === 'partial') paid = Math.min(total, Number(b.paid_amount ?? 0));
  else if (cost.kind === 'sunk') paid = total;
  const due = Math.max(0, total - paid);
  return { currency: cost.currency, total, paid, due, atProperty: b.payment_status === 'pay_at_property' ? due : 0 };
}

/**
 * 预算汇总。
 *   - 条目：已排进某天、主方案、未删除、有 cost_estimate；per: 'person' 乘同行人数；有 amount_max 时上下限分别汇总；
 *   - 条目关联了预订且预订有价格：用预订价（一个预订只算一次），条目的估算不重复算；
 *   - 预订：booked / pending 全部算（航班、酒店、保险…不一定有条目）；idea 只在被已排期的主方案条目引用时算；
 *   - 换算成 home_currency 后相加；换算不了的币种列在 unconverted。
 * @param {object} bundle
 * @param {{ fx?: object, home?: string }} [ctx]
 */
export function budgetSummary(bundle, ctx = {}) {
  const fx = ctx.fx || createFx();
  const home = normalizeCurrency(ctx.home || bundle.trip?.home_currency || 'HKD');
  const size = partySize(bundle);
  const lines = [];
  const countedBookings = new Set();

  const scheduledPrimary = [];
  for (const [dayId, list] of itemsByDay(bundle.items)) {
    if (dayId === null) continue;
    for (const it of list) if (it.variant === 'primary') scheduledPrimary.push(it);
  }

  // 1. 条目
  for (const it of scheduledPrimary) {
    const booking = it.booking_id ? bundle.bookings?.get(it.booking_id) : null;
    const cost = booking ? bookingCost(booking) : null;
    if (booking && cost) {
      if (countedBookings.has(booking.id)) continue;
      countedBookings.add(booking.id);
      lines.push({ source: 'booking', id: booking.id, itemId: it.id, dayId: it.day_id, title: booking.title, currency: cost.currency, min: cost.amount, max: cost.amount, per: 'total', estimate: cost.kind === 'idea', status: booking.status });
      continue;
    }
    const ce = it.cost_estimate;
    if (!ce || !Number.isFinite(Number(ce.amount)) || !ce.currency) continue;
    const mult = ce.per === 'person' ? size : 1;
    const lo = Number(ce.amount);
    const hi = Number.isFinite(Number(ce.amount_max)) && ce.amount_max !== null && ce.amount_max !== undefined ? Number(ce.amount_max) : lo;
    lines.push({ source: 'item', id: it.id, itemId: it.id, dayId: it.day_id, title: it.title, currency: normalizeCurrency(ce.currency), min: lo * mult, max: hi * mult, per: ce.per === 'person' ? 'person' : 'total', unit: { min: lo, max: hi }, estimate: true, note: ce.note ?? null });
  }

  // 2. 其余已订 / 待确认的预订（不一定有条目）
  for (const b of sortedBookings(bundle.bookings)) {
    if (countedBookings.has(b.id)) continue;
    const cost = bookingCost(b);
    if (!cost || cost.kind === 'idea') continue;
    countedBookings.add(b.id);
    lines.push({ source: 'booking', id: b.id, itemId: null, dayId: null, title: b.title, currency: cost.currency, min: cost.amount, max: cost.amount, per: 'total', estimate: false, status: b.status });
  }

  // 3. 汇总
  const byCurrency = new Map();
  const byDay = new Map();
  const total = { min: 0, max: 0 };
  const booked = { min: 0, max: 0 };
  const estimated = { min: 0, max: 0 };
  for (const l of lines) {
    const r = fx.rate(l.currency, home);
    l.homeMin = r === null ? null : l.min * r;
    l.homeMax = r === null ? null : l.max * r;
    if (!byCurrency.has(l.currency)) byCurrency.set(l.currency, { currency: l.currency, min: 0, max: 0, homeMin: 0, homeMax: 0, convertible: r !== null, count: 0 });
    const c = byCurrency.get(l.currency);
    c.min += l.min;
    c.max += l.max;
    c.count += 1;
    if (r === null) continue;
    c.homeMin += l.homeMin;
    c.homeMax += l.homeMax;
    total.min += l.homeMin;
    total.max += l.homeMax;
    const bucket = l.estimate ? estimated : booked;
    bucket.min += l.homeMin;
    bucket.max += l.homeMax;
    if (l.dayId) {
      if (!byDay.has(l.dayId)) byDay.set(l.dayId, { min: 0, max: 0 });
      byDay.get(l.dayId).min += l.homeMin;
      byDay.get(l.dayId).max += l.homeMax;
    }
  }
  const round = (o) => ({ min: Math.round(o.min * 100) / 100, max: Math.round(o.max * 100) / 100 });

  // 4. 付款情况（已订的预订）
  const payments = { paid: 0, due: 0, atProperty: 0, byCurrency: new Map() };
  for (const b of sortedBookings(bundle.bookings)) {
    const p = bookingPayment(b);
    if (!p) continue;
    if (!payments.byCurrency.has(p.currency)) payments.byCurrency.set(p.currency, { currency: p.currency, paid: 0, due: 0, atProperty: 0 });
    const c = payments.byCurrency.get(p.currency);
    c.paid += p.paid;
    c.due += p.due;
    c.atProperty += p.atProperty;
    const r = fx.rate(p.currency, home);
    if (r === null) continue;
    payments.paid += p.paid * r;
    payments.due += p.due * r;
    payments.atProperty += p.atProperty * r;
  }

  return {
    home,
    partySize: size,
    fxSource: fx.source,
    total: round(total),
    booked: round(booked),
    estimated: round(estimated),
    byCurrency: [...byCurrency.values()].map((c) => ({ ...c, homeMin: c.convertible ? Math.round(c.homeMin * 100) / 100 : null, homeMax: c.convertible ? Math.round(c.homeMax * 100) / 100 : null })),
    byDay,
    unconverted: [...byCurrency.values()].filter((c) => !c.convertible).map((c) => ({ currency: c.currency, min: c.min, max: c.max })),
    payments: {
      paid: Math.round(payments.paid * 100) / 100,
      due: Math.round(payments.due * 100) / 100,
      atProperty: Math.round(payments.atProperty * 100) / 100,
      byCurrency: [...payments.byCurrency.values()],
    },
    lines,
  };
}

// ---------------------------------------------------------------------
// 记账（文档 B4.11、B5.9）
// ---------------------------------------------------------------------

export const EXPENSE_CATEGORIES = Object.freeze(['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他']);
const UNKNOWN_PAYER = 'unknown';

/** 记账的币种（ISO）：生成列 currency_iso 优先，旧数据的 NTD/RMB 自动换算 */
export function expenseCurrency(e) {
  return normalizeCurrency(e.currency_iso || e.currency);
}

/** 未删除的记账，按日期新→旧、再按记录时间新→旧 */
export function liveExpenses(map) {
  return values(map).filter(isLive).sort((a, b) => byStr(b.date || '', a.date || '') || byTs(b.created_at, a.created_at) || byStr(a.id, b.id));
}

/** 旧数据的付款人 / 分摊人是名字（display_name 或邮箱 @ 前面），这里尽量对应到成员 */
function legacyResolver(bundle) {
  const map = new Map();
  for (const m of values(bundle.members)) {
    for (const k of [m.display_name, m.email, emailHandle(m.email)]) {
      if (k) map.set(String(k).trim().toLowerCase(), m.user_id);
    }
  }
  return (name) => {
    const k = String(name ?? '').trim();
    if (!k) return null;
    return map.get(k.toLowerCase()) || `legacy:${k}`;
  };
}

/**
 * 一笔记账的付款人和各人承担的份额（原币最小单位整数，份额之和 = 总额）。
 * @returns {{ payer: string, shares: Map<string, number>, total: number, currency: string, mode: string, issues: string[] }}
 */
export function expenseShares(e, bundle, resolve = legacyResolver(bundle)) {
  const currency = expenseCurrency(e);
  const total = toMinor(Number(e.amount) || 0, currency);
  const payer = e.paid_by_user_id || resolve(e.paid_by) || UNKNOWN_PAYER;
  const shares = new Map();
  const issues = [];
  const add = (id, v) => shares.set(id, (shares.get(id) || 0) + v);
  const split = e.split && typeof e.split === 'object' ? e.split : {};
  let mode = split.mode || 'legacy';

  if (split.mode === 'equal' && Array.isArray(split.user_ids) && split.user_ids.length) {
    const ids = [...new Set(split.user_ids.filter(Boolean))];
    allocate(total, ids.map(() => 1)).forEach((v, i) => add(ids[i], v));
  } else if (split.mode === 'amounts' && Array.isArray(split.shares) && split.shares.length) {
    let sum = 0;
    for (const s of split.shares) {
      const v = toMinor(Number(s.amount) || 0, currency);
      sum += v;
      add(s.user_id, v);
    }
    if (sum !== total) {
      issues.push('split-mismatch');
      add(payer, total - sum); // 没分完（或分多了）的差额算付款人的
    }
  } else if (split.mode === 'personal') {
    add(payer, total);
  } else {
    mode = 'legacy';
    const names = Array.isArray(e.split_with) ? e.split_with : [];
    const ids = [...new Set(names.map(resolve).filter(Boolean))];
    if (!ids.length) add(payer, total);
    else allocate(total, ids.map(() => 1)).forEach((v, i) => add(ids[i], v));
  }
  if (payer === UNKNOWN_PAYER) issues.push('unknown-payer');
  return { payer, shares, total, currency, mode, issues };
}

/**
 * 一笔记账折合 home 币种：记账时写下的 amount_home / fx_rate 优先（home_currency 一致时），
 * 同币种直接用，旧数据 amount_hkd，最后才用参考汇率。
 * @returns {{ value: number, source: 'recorded'|'same'|'legacy'|string } | null}
 */
export function expenseHomeAmount(e, home, fx = createFx()) {
  const cur = expenseCurrency(e);
  const amount = Number(e.amount);
  if (!Number.isFinite(amount)) return null;
  if (e.home_currency && normalizeCurrency(e.home_currency) === home) {
    if (Number.isFinite(Number(e.amount_home)) && e.amount_home !== null) return { value: Number(e.amount_home), source: 'recorded' };
    if (Number.isFinite(Number(e.fx_rate)) && e.fx_rate !== null) return { value: amount * Number(e.fx_rate), source: 'recorded' };
  }
  if (cur === home) return { value: amount, source: 'same' };
  if (home === 'HKD' && e.amount_hkd !== null && e.amount_hkd !== undefined && Number.isFinite(Number(e.amount_hkd))) return { value: Number(e.amount_hkd), source: 'legacy' };
  const v = fx.convert(amount, cur, home);
  return v === null ? null : { value: v, source: fx.source };
}

/**
 * 结算建议：正数 = 别人欠他，负数 = 他欠别人。贪心：最大的债主和最大的欠债人先配对，转账笔数最少（人少时就是最优）。
 * @param {Map<string, number>} net 最小单位整数
 * @returns {Array<{ from: string, to: string, minor: number }>}
 */
export function settle(net) {
  const creditors = [];
  const debtors = [];
  for (const [id, v] of net) {
    if (v > 0) creditors.push([id, v]);
    else if (v < 0) debtors.push([id, -v]);
  }
  creditors.sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]));
  debtors.sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]));
  const out = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const t = Math.min(creditors[i][1], debtors[j][1]);
    if (t > 0) out.push({ from: debtors[j][0], to: creditors[i][0], minor: t });
    creditors[i][1] -= t;
    debtors[j][1] -= t;
    if (creditors[i][1] === 0) i++;
    if (debtors[j][1] === 0) j++;
  }
  return out;
}

const toAmounts = (map, cur) => Object.fromEntries([...map].map(([k, v]) => [k, fromMinor(v, cur)]));

/**
 * 记账汇总。
 *   currencies：按币种分开（不换汇率）——总额、谁付了多少、各自承担多少、净额、同币种内的结算建议；
 *   home：全部折合成 home_currency（每笔用记账时的 fx_rate，没有才用参考汇率）——同样的几项；
 *   hkd：折合港币的估算（参考汇率）；
 *   byCategory / byDate：分类、日期汇总（home 币种）；
 *   people：出现过的人（成员在前；旧数据里对不上成员的名字以 legacy:名字 出现；没记付款人的是 unknown）。
 * @param {object} bundle
 * @param {{ fx?: object, home?: string }} [ctx]
 */
export function ledgerSummary(bundle, ctx = {}) {
  const fx = ctx.fx || createFx();
  const home = normalizeCurrency(ctx.home || bundle.trip?.home_currency || 'HKD');
  const resolve = legacyResolver(bundle);
  const list = liveExpenses(bundle.expenses);
  const people = new Map();
  for (const m of memberList(bundle)) people.set(m.user_id, { id: m.user_id, name: memberName(bundle, m.user_id), color: m.color || null, member: true });
  const touch = (id) => {
    if (people.has(id)) return;
    if (id === UNKNOWN_PAYER) people.set(id, { id, name: '未记录付款人', color: null, member: false });
    else if (String(id).startsWith('legacy:')) people.set(id, { id, name: id.slice(7), color: null, member: false });
    else people.set(id, { id, name: memberName(bundle, id), color: null, member: false });
  };

  const cur = new Map();
  const homeAgg = { paid: new Map(), share: new Map(), total: 0, count: 0, missing: new Set(), approx: 0 };
  const byCategory = new Map();
  const byDate = new Map();
  const issues = [];
  let hkdTotal = 0;
  let hkdComplete = true;

  for (const e of list) {
    const s = expenseShares(e, bundle, resolve);
    touch(s.payer);
    for (const id of s.shares.keys()) touch(id);
    for (const kind of s.issues) issues.push({ expenseId: e.id, kind });

    if (!cur.has(s.currency)) cur.set(s.currency, { currency: s.currency, decimals: currencyDecimals(s.currency), totalMinor: 0, count: 0, paid: new Map(), share: new Map(), homeMinor: 0, homeComplete: true });
    const c = cur.get(s.currency);
    c.totalMinor += s.total;
    c.count += 1;
    c.paid.set(s.payer, (c.paid.get(s.payer) || 0) + s.total);
    for (const [id, v] of s.shares) c.share.set(id, (c.share.get(id) || 0) + v);

    const h = expenseHomeAmount(e, home, fx);
    const hk = home === 'HKD' && h ? h.value : (approxHKD(Number(e.amount), s.currency) ?? (s.currency === 'HKD' ? Number(e.amount) : null));
    if (hk === null) hkdComplete = false;
    else hkdTotal += hk;
    if (!h) {
      c.homeComplete = false;
      homeAgg.missing.add(s.currency);
      issues.push({ expenseId: e.id, kind: 'no-fx' });
      continue;
    }
    c.homeMinor += toMinor(h.value, home);
    if (h.source !== 'recorded' && h.source !== 'same' && h.source !== 'legacy') homeAgg.approx += 1;
    const homeMinor = toMinor(h.value, home);
    homeAgg.total += homeMinor;
    homeAgg.count += 1;
    homeAgg.paid.set(s.payer, (homeAgg.paid.get(s.payer) || 0) + homeMinor);
    // 折合后的份额按原币份额（带正负号）的比例分：分摊加起来比总额多时付款人那份是负的，不能按绝对值分
    const ids = [...s.shares.keys()];
    allocateSigned(homeMinor, ids.map((id) => s.shares.get(id))).forEach((v, i) => {
      homeAgg.share.set(ids[i], (homeAgg.share.get(ids[i]) || 0) + v);
    });
    const cat = EXPENSE_CATEGORIES.includes(e.category) ? e.category : '其他';
    if (!byCategory.has(cat)) byCategory.set(cat, { category: cat, minor: 0, count: 0 });
    byCategory.get(cat).minor += homeMinor;
    byCategory.get(cat).count += 1;
    const d = e.date || null;
    if (!byDate.has(d)) byDate.set(d, { date: d, minor: 0, count: 0, ids: [] });
    const bd = byDate.get(d);
    bd.minor += homeMinor;
    bd.count += 1;
    bd.ids.push(e.id);
  }

  const finish = (paid, share, currency) => {
    const net = new Map();
    for (const id of new Set([...paid.keys(), ...share.keys()])) net.set(id, (paid.get(id) || 0) - (share.get(id) || 0));
    const settleable = new Map([...net].filter(([id]) => id !== UNKNOWN_PAYER));
    return {
      paid: toAmounts(paid, currency),
      share: toAmounts(share, currency),
      net: toAmounts(net, currency),
      transfers: settle(settleable).map((t) => ({ from: t.from, to: t.to, amount: fromMinor(t.minor, currency) })),
    };
  };

  const currencies = [...cur.values()]
    .sort((a, b) => b.count - a.count || byStr(a.currency, b.currency))
    .map((c) => ({
      currency: c.currency,
      decimals: c.decimals,
      total: fromMinor(c.totalMinor, c.currency),
      count: c.count,
      approxHKD: c.currency === 'HKD' ? fromMinor(c.totalMinor, c.currency) : approxHKD(fromMinor(c.totalMinor, c.currency), c.currency),
      // 这个币种折合本币的合计（每一笔按记账时记下的汇率，和 home.total 同一套数；有一笔没有汇率时 null）
      home: c.homeComplete ? fromMinor(c.homeMinor, home) : null,
      ...finish(c.paid, c.share, c.currency),
    }));

  return {
    count: list.length,
    home: {
      currency: home,
      total: fromMinor(homeAgg.total, home),
      count: homeAgg.count,
      approxCount: homeAgg.approx,
      missing: [...homeAgg.missing],
      ...finish(homeAgg.paid, homeAgg.share, home),
    },
    hkd: { total: Math.round(hkdTotal), complete: hkdComplete },
    currencies,
    people: [...people.values()],
    byCategory: [...byCategory.values()].sort((a, b) => b.minor - a.minor).map((x) => ({ category: x.category, total: fromMinor(x.minor, home), count: x.count })),
    byDate: [...byDate.values()].sort((a, b) => byStr(b.date || '', a.date || '')).map((x) => ({ date: x.date, total: fromMinor(x.minor, home), count: x.count, ids: x.ids })),
    issues,
    fxSource: fx.source,
    // 扣掉「已结清」记录以后还没结的（账本页、行程概览的回顾都看这个，说法一致）
    settlement: applySettlements({ currencies }, readSettlements(bundle.trip)),
  };
}

// ---------------------------------------------------------------------
// 结清记录（trips.extra.ledger_settlements；账本页「记为已结清」写，概览回顾、账本页读）
// ---------------------------------------------------------------------
//
// 一条记录 = 点「记为已结清」那一刻还没结的转账原样记下来：{ id, at, by, count, transfers: [{ from, to, currency, amount }] }。
// 存的是“转账”而不是时间点：之后改旧账、补记旧账，差额自然变成新的未结，不受两台手机时钟不同的影响。
// 以后独立成表时只换 readSettlements / withSettlements。

export const LEDGER_SETTLEMENTS_KEY = 'ledger_settlements';

/** trips.extra 里的结清记录（按 at 从早到晚排好；坏数据丢掉） */
export function readSettlements(trip) {
  const list = trip?.extra?.[LEDGER_SETTLEMENTS_KEY];
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object' && Array.isArray(x.transfers))
    .map((x) => ({ ...x, transfers: x.transfers.filter((t) => t && t.from && t.to && t.currency && Number(t.amount) > 0) }))
    .sort((a, b) => (String(a.at || '') < String(b.at || '') ? -1 : String(a.at || '') > String(b.at || '') ? 1 : 0));
}

/** 写回 trips.extra：别的键原样保留；空列表删掉这个键 */
export function withSettlements(extra, list) {
  const next = { ...(extra && typeof extra === 'object' ? extra : {}) };
  if (list && list.length) next[LEDGER_SETTLEMENTS_KEY] = list;
  else delete next[LEDGER_SETTLEMENTS_KEY];
  return next;
}

/**
 * 从记账汇总里扣掉已经结清的转账，得到“还没结”的（按币种、不换汇）。
 * 已结清的一笔转账 from → to（from 真的把钱给了 to）：from 的净额加回这笔，to 的净额减去这笔，再用 settle() 同样的贪心配对。
 * @param {{ currencies: Array<{ currency: string, net: Record<string, number> }> }} ledger ledgerSummary() 的结果（至少要 currencies）
 * @param {Array<{ at: string, by: string, transfers: Array<{ from, to, currency, amount }> }>} settlements readSettlements()
 * @returns {{ outstanding: Array<{ currency: string, transfers: Array<{ from: string, to: string, amount: number }> }>,
 *             balanced: boolean, settledCount: number, last: object|null }}
 *   outstanding 只含有转账的币种；balanced = 没有任何未结。
 */
export function applySettlements(ledger, settlements = []) {
  const list = Array.isArray(settlements) ? settlements : [];
  const out = [];
  const seen = new Set();
  const settledByCurrency = new Map();
  for (const x of list) {
    for (const t of x.transfers || []) {
      const cur = normalizeCurrency(t.currency);
      if (!settledByCurrency.has(cur)) settledByCurrency.set(cur, []);
      settledByCurrency.get(cur).push(t);
    }
  }
  const compute = (currency, netAmounts) => {
    const net = new Map();
    for (const [id, v] of Object.entries(netAmounts || {})) net.set(id, toMinor(v, currency));
    for (const t of settledByCurrency.get(currency) || []) {
      const m = toMinor(Number(t.amount), currency);
      net.set(t.from, (net.get(t.from) || 0) + m);
      net.set(t.to, (net.get(t.to) || 0) - m);
    }
    net.delete(UNKNOWN_PAYER);
    return settle(net).map((t) => ({ from: t.from, to: t.to, amount: fromMinor(t.minor, currency) }));
  };
  for (const c of ledger?.currencies || []) {
    seen.add(c.currency);
    const transfers = compute(c.currency, c.net);
    if (transfers.length) out.push({ currency: c.currency, transfers });
  }
  // 结清记录里有、现在的账里已经没有的币种（那些账被删了）：结清的钱变成反向的未结
  for (const cur of settledByCurrency.keys()) {
    if (seen.has(cur)) continue;
    const transfers = compute(cur, {});
    if (transfers.length) out.push({ currency: cur, transfers });
  }
  return { outstanding: out, balanced: out.length === 0, settledCount: list.length, last: list.length ? list[list.length - 1] : null };
}

/**
 * 「记为已结清」要存的一条记录：把此刻还没结的转账原样记下来。
 * @param {Array<{ currency, transfers }>} outstanding applySettlements().outstanding
 * @param {{ by: string, at?: string|Date, count?: number|null, id?: string }} o by：谁点的；count：当时一共几笔账
 */
export function settlementRecord(outstanding, { by, at = clockNow(), count = null, id } = {}) {
  const transfers = [];
  for (const c of outstanding || []) {
    for (const t of c.transfers) transfers.push({ from: t.from, to: t.to, currency: c.currency, amount: fromMinor(toMinor(t.amount, c.currency), c.currency) });
  }
  const when = at instanceof Date ? at : new Date(at);
  return {
    id: id || `s_${when.getTime().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: when.toISOString(),
    by: by || null,
    count: count === null ? undefined : count,
    transfers,
  };
}

// ---------------------------------------------------------------------
// 清单进度、截止提醒
// ---------------------------------------------------------------------

/**
 * 待办进度。
 * @param {Map|object[]} todos
 * @param {{ list?: string, assignee?: string|null }} [filter]
 */
export function todoProgress(todos, filter = {}) {
  let list = Array.isArray(todos) ? todos : values(todos);
  if (filter.list) list = list.filter((t) => t.list === filter.list);
  if (filter.assignee !== undefined) list = list.filter((t) => (t.assignee_user_id ?? null) === filter.assignee);
  const done = list.filter((t) => t.done).length;
  const byList = {};
  for (const l of TODO_LISTS) byList[l] = { total: 0, done: 0 };
  for (const t of list) {
    if (!byList[t.list]) byList[t.list] = { total: 0, done: 0 };
    byList[t.list].total += 1;
    if (t.done) byList[t.list].done += 1;
  }
  return { total: list.length, done, remaining: list.length - done, ratio: list.length ? done / list.length : 0, byList };
}

/**
 * 即将到期：未完成待办的 due_at、预订的免费取消截止（free_cancel_until），按时间排序。
 * @param {number} [horizonDays=7] 往后看几天（已过期的也列出，标 overdue）
 */
export function upcomingDeadlines(bundle, at = clockNow(), horizonDays = 7) {
  const nowMs = at.getTime();
  const limit = nowMs + horizonDays * 86_400_000;
  const out = [];
  for (const t of values(bundle.todos)) {
    if (t.done || !t.due_at) continue;
    const ms = tsMs(t.due_at);
    if (ms <= limit) out.push({ type: 'todo', id: t.id, title: t.title, at: t.due_at, ms, overdue: ms < nowMs });
  }
  for (const b of values(bundle.bookings)) {
    if (!b.free_cancel_until || b.status === 'cancelled') continue;
    const ms = tsMs(b.free_cancel_until);
    if (ms >= nowMs && ms <= limit) out.push({ type: 'free-cancel', id: b.id, title: `${b.title} 免费取消截止`, at: b.free_cancel_until, ms, overdue: false });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// ---------------------------------------------------------------------
// 日记、评级
// ---------------------------------------------------------------------

export const RATING_LABELS = Object.freeze({ 5: '夯', 4: '顶级', 3: '人上人', 2: 'NPC', 1: '拉完了' });

/** day_id → 日记（按成员顺序） */
export function journalByDay(bundle) {
  const order = new Map(memberList(bundle).map((m, i) => [m.user_id, i]));
  return groupSorted(bundle.journal_entries, (j) => j.day_id, (a, b) => (order.get(a.user_id) ?? 99) - (order.get(b.user_id) ?? 99) || byTs(a.created_at, b.created_at));
}

/** place_id → 评级（按成员顺序） */
export function reviewsByPlace(bundle) {
  const order = new Map(memberList(bundle).map((m, i) => [m.user_id, i]));
  return groupSorted(bundle.reviews, (r) => r.place_id, (a, b) => (order.get(a.user_id) ?? 99) - (order.get(b.user_id) ?? 99) || byTs(a.created_at, b.created_at));
}

/** 某个地点的评级概况 */
export function placeRating(bundle, placeId, userId = null) {
  const list = values(bundle.reviews).filter((r) => r.place_id === placeId);
  const rated = list.filter((r) => Number.isInteger(r.rating));
  const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
  return { count: rated.length, avg, label: avg === null ? null : RATING_LABELS[Math.round(avg)], mine: userId ? list.find((r) => r.user_id === userId) || null : null, all: list };
}

// ---------------------------------------------------------------------
// 搜索（交互 1：顶栏放大镜原位展开后，跨条目、地点、记账、评级……在本地过滤）
// ---------------------------------------------------------------------

/** 搜索用的规范化：NFKC、小写、去掉首尾空白 */
export function normalizeSearchText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().trim();
}

const SEARCH_TYPES = Object.freeze({
  item: '行程', place: '地点', booking: '预订', expense: '记账', review: '评级', tip: '贴士', contact: '联系人', todo: '清单', journal: '日记',
});
export { SEARCH_TYPES };

/**
 * 在行程里搜索。多个词（空格分开）都要命中；标题开头命中 > 标题包含 > 其他字段包含。
 * @returns {Array<{ type, typeLabel, id, title, detail, score, dayId?, placeId? }>}
 */
export function searchTrip(bundle, query, { limit = 50 } = {}) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  const consider = (type, row, title, fields, extra = {}) => {
    const t = normalizeSearchText(title);
    const hay = normalizeSearchText([title, ...fields.flat()].filter((x) => x !== null && x !== undefined).join(' \u0001 '));
    let score = 0;
    for (const tok of tokens) {
      if (!hay.includes(tok)) return;
      score += t.startsWith(tok) ? 30 : t.includes(tok) ? 20 : 5;
    }
    out.push({ type, typeLabel: SEARCH_TYPES[type], id: row.id, title, score, ...extra });
  };
  const placeName = (id) => (id ? bundle.places?.get(id)?.name : null) || null;

  for (const it of values(bundle.items)) {
    if (!isLive(it)) continue;
    consider('item', it, it.title, [it.description, it.tags, it.time_label, it.actual_note, placeName(it.place_id)], { dayId: it.day_id, placeId: it.place_id, detail: placeName(it.place_id) });
  }
  for (const p of values(bundle.places)) consider('place', p, p.name, [p.name_local, p.name_en, p.aliases, p.tags, p.description, p.address], { placeId: p.id, detail: p.name_local || p.name_en || null });
  for (const b of values(bundle.bookings)) consider('booking', b, b.title, [b.provider, b.notes, b.confirmation_code, b.details?.flight_no], { detail: b.provider || null });
  for (const e of values(bundle.expenses)) {
    if (!isLive(e)) continue;
    consider('expense', e, e.description || e.category || '记账', [e.category], { detail: e.date || null });
  }
  for (const r of values(bundle.reviews)) {
    consider('review', r, placeName(r.place_id) || '评级', [r.notes, (r.food_log || []).map((x) => x.name), (r.shop_log || []).map((x) => x.name)], { placeId: r.place_id, detail: RATING_LABELS[r.rating] || null });
  }
  for (const t of values(bundle.tips)) consider('tip', t, t.title, [t.body, t.local_text, t.tags], { detail: null });
  for (const c of values(bundle.contacts)) consider('contact', c, c.name, [c.role, c.note], { detail: c.role || null });
  for (const t of values(bundle.todos)) consider('todo', t, t.title, [t.note, t.category], { detail: TODO_LIST_LABELS[t.list] || null });
  for (const j of values(bundle.journal_entries)) consider('journal', j, (j.body || '').slice(0, 30) || '日记', [j.body], { dayId: j.day_id, detail: null });

  return out.sort((a, b) => b.score - a.score || byStr(a.title, b.title)).slice(0, limit);
}
