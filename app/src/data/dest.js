// =====================================================================
// data/dest.js：把规则包（rules/dest.js、rules/how.js）接到一趟行程的数据上（纯函数，Node 里能测）。
//
//   tripProfile(store, { item, place, day })   这一趟 / 这一项所在地的目的地档案（profileOf；香港出发前那几条是香港档案）
//   profileForPlace(store, place)              没有条目上下文时（地点页、预订卡、地图小卡）：按地点坐标 + 行程目的地
//   itemHow(store, item, { now, transportIn, placeId })  这一项怎么去 → 动作行（prevStop + howToGet）；见 rules/README.md
//   placeHow(store, place, { prefer })         没有条目上下文时的一排（placeActions）
//   tripTranslateLang(trip)                    翻译入口用哪种语言（null = 不显示入口）
//   currencyAt(store, { item, place })         这一项所在地的币种（记一笔的默认币种：香港出发前那几条是港币）
//   localSummary(profile)                      「当地」小卡、贴士页「当地须知」的几行（紧急电话、插座、小费、叫车、钱）
//
// store 是 data/trip-store.js 的行程 store（或同样形状的对象：trip / tables / view / stayForDay），也接受普通 bundle
// （{ trip, places: Map, bookings: Map, segments: Map, days: Map, items: Map, contacts: Map }）。
// 规则本身不在这里写——这里只负责「上一站是谁、昨晚住哪、关联的预订和电话」这些要查表的东西。
// =====================================================================

import { profileOf, translateLang, localFacts, plugNote, NEUTRAL } from '../rules/dest.js';
import { prevStop, howToGet, placeActions, transferPhone } from '../rules/how.js';
import { rideTarget } from '../lib/ride-links.js';
import { sortDayItems } from '../lib/map/geo.js';

const valueOf = (x) => (x && typeof x === 'object' && 'value' in x && !(x instanceof Map) ? x.value : x);

/** store / bundle → 统一的几张表 */
function tablesOf(store) {
  if (!store) return { trip: null, places: new Map(), bookings: new Map(), segments: new Map(), days: new Map(), items: new Map(), contacts: new Map() };
  const t = store.tables || store;
  const get = (k) => valueOf(t[k]) || new Map();
  return {
    trip: valueOf(store.trip) || null,
    places: get('places'),
    bookings: get('bookings'),
    segments: get('segments'),
    days: get('days'),
    items: get('items'),
    contacts: get('contacts'),
  };
}

const live = (r) => r && !r.deleted_at;

/** 这一天所在的分段（days.segment_id；没写按日期落在哪段） */
function segmentOf(t, day) {
  if (!day) return null;
  if (day.segment_id && t.segments.get(day.segment_id)) return t.segments.get(day.segment_id);
  for (const s of t.segments.values()) {
    if (live(s) && s.start_date && s.start_date <= day.date && (!s.end_date || day.date <= s.end_date)) return s;
  }
  return null;
}

/** 按日期排好的天 */
function sortedDays(t) {
  return [...t.days.values()].filter(live).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** 当晚住处的地点（days.stay_booking_id → 预订 → 地点） */
function stayPlace(t, day) {
  const b = day?.stay_booking_id ? t.bookings.get(day.stay_booking_id) : null;
  return b && b.place_id ? t.places.get(b.place_id) || null : null;
}

/** 这一天的条目（没删的，各种方案都有），排序和每天页一样（lib/map/geo.js 的 sortDayItems） */
function dayItems(t, dayId) {
  return sortDayItems([...t.items.values()].filter((it) => live(it) && it.day_id === dayId));
}

/**
 * 档案。item / place / day 都可以不给。
 * @param {object} store
 * @param {{ item?: object|null, place?: object|null, day?: object|null }} [o]
 */
export function tripProfile(store, { item = null, place = null, day = null } = {}) {
  const t = tablesOf(store);
  if (!t.trip) return { ...NEUTRAL, trReady: false, move: null, city: null, zones: [], src: 'none' };
  const d = day || (item?.day_id ? t.days.get(item.day_id) || null : null);
  return profileOf(t.trip, { segment: segmentOf(t, d), item, place });
}

/** 地点页、预订卡这种没有条目的：按地点坐标（在香港、澳门就是港澳档案）+ 行程目的地 */
export function profileForPlace(store, place) {
  return tripProfile(store, { place });
}

/** 「有人接」的电话：规则包 transferPhone（两端同一个顺序：司机 → 预订里写的电话 → 挂在预订上的联系人） */
function phoneFor(t, booking) {
  return transferPhone(booking, { getContact: (id) => t.contacts.get(id) || null, contacts: t.contacts.values() });
}

/**
 * 这一项怎么去 → 动作行（rules/how.js 的 howToGet；返回结构见 rules/README.md）。
 * @param {object} store
 * @param {object} item
 * @param {{ now?: number|Date|null, transportIn?: object|null, placeId?: string|null }} [o]
 *   now：航班按钮的时间窗（不给 = 不按时间筛）；transportIn / placeId：改一项面板里还没保存的值（预览那行灰字用）
 * @returns {ReturnType<typeof howToGet> & { profile: object }}
 */
export function itemHow(store, item, { now = null, transportIn, placeId } = {}) {
  const t = tablesOf(store);
  const it = transportIn !== undefined || placeId !== undefined
    ? { ...item, ...(transportIn !== undefined ? { transport_in: transportIn } : {}), ...(placeId !== undefined ? { place_id: placeId } : {}) }
    : item;
  const place = it?.place_id ? t.places.get(it.place_id) || null : null;
  const day = it?.day_id ? t.days.get(it.day_id) || null : null;
  const getPlace = (id) => t.places.get(id) || null;
  let prev = null;
  let stays = [];
  if (day) {
    const days = sortedDays(t);
    const i = days.findIndex((d) => d.id === day.id);
    const lastNight = i > 0 ? stayPlace(t, days[i - 1]) : null;
    const tonight = stayPlace(t, day);
    let list = dayItems(t, day.id).map((x) => (x.id === it.id ? it : x));
    // 还没存的新条目（加一项面板里预览）：按钟点插进去，没钟点放最后
    if (!list.some((x) => x.id === it.id)) {
      const at = it.start_time ? list.findIndex((x) => x.start_time && String(x.start_time) > String(it.start_time) && (!x.variant || x.variant === 'primary')) : -1;
      list = at >= 0 ? [...list.slice(0, at), it, ...list.slice(at)] : [...list, it];
    }
    prev = prevStop(list, it.id, { getPlace, stayLastNight: lastNight });
    stays = [lastNight, tonight].filter(Boolean);
  }
  const booking = it?.booking_id ? t.bookings.get(it.booking_id) || null : null;
  const profile = profileOf(t.trip, { segment: segmentOf(t, day), item: it, place });
  const via = place ? rideTarget(place, { getPlace }).via : null;
  const how = howToGet(it, {
    place, prev, profile, booking, stays, via, phone: phoneFor(t, booking), now,
  });
  return { ...how, profile, booking };
}

/**
 * 没有条目上下文时的一排（地点页、地图小卡、预订卡、住处卡）。prefer: 'ride' 把叫车放第一个（住处卡第一晚）。
 * @returns {ReturnType<typeof placeActions> & { profile: object }}
 */
export function placeHow(store, place, { prefer } = {}) {
  const t = tablesOf(store);
  const profile = profileOf(t.trip, { place });
  const via = place ? rideTarget(place, { getPlace: (id) => t.places.get(id) || null }).via : null;
  return { ...placeActions(place, { profile, prefer, via }), profile };
}

/** 翻译入口：这趟行程的档案要翻译、语言包过了测试才有（港澳台内地、没过测试的语言 → null） */
export function tripTranslateLang(trip) {
  if (!trip) return null;
  return translateLang(profileOf(trip, {}));
}

/** 这一项（地点）所在地的币种；查不到 → null */
export function currencyAt(store, { item = null, place = null } = {}) {
  const t = tablesOf(store);
  if (!t.trip) return null;
  const p = place || (item?.place_id ? t.places.get(item.place_id) || null : null);
  const prof = tripProfile(store, { item, place: p });
  return prof.cur || null;
}

/**
 * 「当地」的几行（概览小卡、贴士页顶部「当地须知」）。没核过的地区只有钱和叫车（紧急电话、插座、小费不写，I9）。
 * @param {object} profile tripProfile 的结果
 * @returns {null | { region: string, name: string, sos: Array<{ label: string, number: string }>, plugShort: string, plug: string,
 *   tipShort: string, tip: string, ride: string, rideNote: string, money: string, mapNote: string, checked: string|null }}
 *   null = 认不出是哪儿（中性档案）
 */
export function localSummary(profile) {
  if (!profile || !profile.region) return null;
  const f = localFacts(profile);
  const types = profile.plug ? String(profile.plug).split('·') : [];
  const sameAsHome = types.length === 1 && types[0] === 'G';
  const plugShort = types.length
    ? `${types.join('/')} 插座，${sameAsHome ? '和香港一样' : types.includes('G') ? '最好带转换头' : '带转换头'}${profile.volt && profile.volt < 200 ? ` · ${profile.volt}V` : ''}`
    : '';
  const tipFirst = profile.tip ? String(profile.tip).split(/[；;，,]/)[0].trim() : '';
  const tipShort = tipFirst ? (tipFirst.includes('小费') ? tipFirst : `小费${/^不/.test(tipFirst) ? '' : '：'}${tipFirst}`) : '';
  return {
    region: profile.region,
    name: profile.zh || '',
    sos: f.sos,
    plugShort,
    plug: profile.plug ? `${types.join('/')} 插座${profile.volt ? ` · ${profile.volt}V` : ''}：${plugNote(profile)}` : '',
    tipShort,
    tip: profile.tip || '',
    ride: f.ride,
    rideNote: profile.rideNote || '',
    money: [f.cur, profile.curNote].filter(Boolean).join('：'),
    mapNote: profile.mapNote || '',
    checked: profile.checked || null,
  };
}
