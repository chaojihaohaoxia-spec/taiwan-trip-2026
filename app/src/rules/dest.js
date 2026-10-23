// =====================================================================
// rules/dest.js：读目的地档案（规则包；纯函数，不用 Intl）。
//
//   profileOf(trip, { segment, item, place, home })   这一趟 / 这一段 / 这一项所在地的档案（见下面的返回结构）
//   regionInfo(code)                                   内置地区一行（没有 → null）
//   regionAt(lat, lng)                                 坐标在香港、澳门 → 'HK' / 'MO'，否则 null（只认这两处，见 I1）
//   regionOfTz(tz) / currencyOfTz(tz)                  时区 → 地区 / 当地币种（替掉两端的 ZONE_CURRENCY、TZ_CURRENCY）
//   cityInfo(id)                                       城市的规则部分（CITY_CORE 一行）
//   moveDefault(region, cityId)                        新建页「这趟怎么走」默认选哪个
//   tzStd(tz) / diffText(tz, homeTz?)                  标准偏移；「比香港快 1 小时」「和香港一样」「比香港慢 1 小时（夏令时会变）」
//   cityCenter(trip, { segment })                      天气、地点搜索的中心点 { lat, lng } | null
//   translateLang(profile)                             翻译入口用哪种语言；null = 不显示翻译入口
//   plugNote(profile) / localFacts(profile)            当地卡的几行字（没核过的地区返回空）
//   previewLine(profile, { home })                     新建页那行灰字「越南盾 · 比香港慢 1 小时 · 叫车用 Grab · 插座要转换头」
//   destOk(dest) / segDestOk(dest)                     trips.extra.dest / segments.extra.dest 的写法对不对（和服务器 private.dest_ok 同一套）
//
// 存法（trips.extra.dest，只存选择和改动；档案内容从内置表现算）：
//   { v: 1, region: 'VN', cities: ['phu-quoc'], move: 'ride', ride: 'xanhsm', walk_km: 1.2 }
//   cities 里也可以是自己加的城市 { zh, lat, lng }；一趟去两个国家：segments.extra.dest = { region, city, move }
// =====================================================================

import { REGIONS, RIDE_APPS, CITY_CORE, ZONE_REGION, TZ_STD } from './dest-data.js';
import { CURRENCIES } from './currency.js';
import { inPolygon, HK_SHAPE, MO_SHAPE, coordOf, rawCoordOf, haversineKm } from './geo.js';

/** 翻译测试集过了的语言（过一种加一种；没过的不显示翻译入口） */
export const TR_READY = Object.freeze(['vi']);

/** 「这趟怎么走」的取值 */
export const MOVES = Object.freeze(['ride', 'transit', 'self_drive', 'scooter', 'walk']);

/** 新建页 / 设置里「这趟怎么走」的芯片 */
export const MOVE_CHOICES = Object.freeze([
  { id: 'ride', label: '打车为主' },
  { id: 'transit', label: '公交为主' },
  { id: 'self_drive', label: '自驾' },
  { id: 'scooter', label: '骑车' },
  { id: 'walk', label: '走路为主' },
]);

export const HOME_TZ = 'Asia/Hong_Kong';
export const HOME_REGION = 'HK';

/** 哪儿都对不上时的中性档案：叫不到车（不画叫车按钮）、按公交算、不翻译、不显示紧急电话 */
export const NEUTRAL = Object.freeze({
  region: null, zh: '', en: '', cur: null, tz: null, lang: null, tr: null, driverText: 'en', far: 'transit', walkKm: 1.5,
  ride: [], map: 'google', coord: 'wgs84', sos: null, plug: null, volt: null, tip: null, rideNote: null, curNote: null, mapNote: null, checked: null,
});

const CITY_BY_ID = {};
for (let i = 0; i < CITY_CORE.length; i++) CITY_BY_ID[CITY_CORE[i].id] = CITY_CORE[i];

/** 币种 → 地区（只收一种币种只对一个地区的；欧元这种对多个的不收） */
const CUR_REGION = {};
(function () {
  const seen = {};
  const codes = Object.keys(REGIONS);
  for (let i = 0; i < codes.length; i++) {
    const cur = REGIONS[codes[i]].cur;
    seen[cur] = (seen[cur] || 0) + 1;
    CUR_REGION[cur] = codes[i];
  }
  const curs = Object.keys(seen);
  for (let i = 0; i < curs.length; i++) if (seen[curs[i]] > 1) delete CUR_REGION[curs[i]];
})();

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

export function regionInfo(code) {
  return REGIONS[str(code).toUpperCase()] || null;
}

/** 只选了国家时行程 id 的前半截：英文名小写（'TH' → 'thailand'）；不认识 → 'trip'。和 SQL private.region_slug 一致（PGlite 测试核对） */
export function regionSlug(code) {
  const r = regionInfo(code);
  const s = r ? str(r.en).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
  return s || 'trip';
}

export function cityInfo(id) {
  return CITY_BY_ID[str(id)] || null;
}

export function regionAt(lat, lng) {
  const pt = { lat, lng };
  if (!rawCoordOf(pt)) return null;
  if (inPolygon(pt, HK_SHAPE)) return 'HK';
  if (inPolygon(pt, MO_SHAPE)) return 'MO';
  return null;
}

export function regionOfTz(tz) {
  return ZONE_REGION[str(tz)] || null;
}

export function currencyOfTz(tz) {
  const r = regionOfTz(tz);
  return r ? REGIONS[r].cur : '';
}

/** 自己加的城市 { zh, lat, lng } 或内置城市 id → 城市对象（没有 → null） */
function cityOf(c) {
  if (typeof c === 'string') return cityInfo(c);
  if (isObj(c) && (str(c.zh) || str(c.name))) {
    return { id: str(c.id) || null, zh: str(c.zh) || str(c.name), lat: Number(c.lat), lng: Number(c.lng), custom: true };
  }
  return null;
}

/** 行程有几个城市时挑一个：有地点坐标就挑最近的（80 公里内），否则第一个 */
function pickCity(list, place) {
  const cities = [];
  for (let i = 0; i < list.length; i++) {
    const c = cityOf(list[i]);
    if (c) cities.push(c);
  }
  if (!cities.length) return null;
  if (cities.length === 1) return cities[0];
  const pt = coordOf(place);
  if (pt) {
    let best = null;
    let bestKm = Infinity;
    for (let i = 0; i < cities.length; i++) {
      const km = haversineKm(pt, cities[i]);
      if (km !== null && km < bestKm) {
        best = cities[i];
        bestKm = km;
      }
    }
    if (best && bestKm <= 80) return best;
  }
  return cities[0];
}

function rideApps(ids) {
  const out = [];
  for (let i = 0; i < (ids || []).length; i++) {
    const id = ids[i];
    if (RIDE_APPS[id] && out.every((a) => a.id !== id)) out.push({ id, name: RIDE_APPS[id].name, link: RIDE_APPS[id].link, mini: RIDE_APPS[id].mini });
  }
  return out;
}

const destOf = (row) => (row && isObj(row.extra) && isObj(row.extra.dest) ? row.extra.dest : null);

/**
 * 这一趟（这一段、这一项）的档案。
 * 地区取值顺序（第一个对上就用）：
 *   1) item.extra.local_time.tz → 地区（香港出发前那几条 → HK）
 *   2) 地点坐标在香港、澳门（App 里新建的条目没有 local_time，去机场、回家那几条靠这一步）
 *   3) segment.extra.dest.region   4) trip.extra.dest.region
 *   5) trip.timezone → 地区；trip.local_currency → 地区（老行程没补档案时）
 *   6) 中性档案 NEUTRAL
 * 1)、2) 得到的地区和行程目的地不同时，不带行程的城市、「这趟怎么走」、叫车改动（在香港就按香港算）。
 * 「怎么走」：这一段 move → 这趟 move（profile.move）；没写时按城市 far → 地区 far（profile.far）。
 * o.regions：换一张地区表（测试用，比如造一个没核过的地区）。
 * @returns {{ region, zh, en, cur, tz, lang, tr, trReady, driverText, far, move, walkKm, ride: Array<{id,name,link,mini}>,
 *   map, coord, sos, plug, volt, tip, rideNote, curNote, mapNote, checked, city: { id, zh } | null, zones: Array, src: string }}
 */
export function profileOf(trip, o) {
  const opt = o || {};
  const item = opt.item || null;
  const seg = opt.segment || null;
  const place = opt.place || null;
  const tDest = destOf(trip);
  const sDest = destOf(seg);

  // 行程本身的目的地（不看条目）
  let tripRegion = null;
  let tripSrc = null;
  const known = (code) => Boolean((opt.regions || REGIONS)[str(code).toUpperCase()]);
  if (sDest && known(sDest.region)) {
    tripRegion = str(sDest.region).toUpperCase();
    tripSrc = 'segment';
  } else if (tDest && known(tDest.region)) {
    tripRegion = str(tDest.region).toUpperCase();
    tripSrc = 'trip';
  } else if (trip && regionOfTz(trip.timezone)) {
    tripRegion = regionOfTz(trip.timezone);
    tripSrc = 'tz';
  } else if (trip && CUR_REGION[str(trip.local_currency).toUpperCase()]) {
    tripRegion = CUR_REGION[str(trip.local_currency).toUpperCase()];
    tripSrc = 'currency';
  }

  // 这一项在别的地方（香港出发前、回程到家）
  let region = tripRegion;
  let src = tripSrc;
  const lt = item && isObj(item.extra) && isObj(item.extra.local_time) ? item.extra.local_time : null;
  if (lt && regionOfTz(lt.tz)) {
    region = regionOfTz(lt.tz);
    src = 'item-tz';
  } else if (place) {
    const c = coordOf(place);
    const at = c ? regionAt(c.lat, c.lng) : null;
    if (at) {
      region = at;
      src = 'place';
    }
  }

  const table = opt.regions || REGIONS;
  const base = region ? table[region] || null : null;
  if (!base) return Object.assign({}, NEUTRAL, { trReady: false, move: null, city: null, zones: [], src: 'none' });
  const atDest = region === tripRegion;

  // 城市：这一段 → 这趟（几个城市挑离地点最近的）
  let city = null;
  if (atDest) {
    if (sDest && sDest.city) city = cityOf(sDest.city);
    if (!city && tDest && Array.isArray(tDest.cities) && (!sDest || !sDest.region || str(sDest.region).toUpperCase() === str(tDest.region).toUpperCase())) {
      city = pickCity(tDest.cities, place);
    }
    if (city && city.r && city.r !== region) city = null;
  } else if (region === HOME_REGION || region === 'MO') {
    city = cityInfo(region === 'HK' ? 'hong-kong' : 'macau');
  }

  // 这趟的改动只用在这趟的目的地（香港出发前、回程到家那几项不套）。
  //   「这趟怎么走」是整趟的：一趟两国时另一国的分段也套（新建时只写在行程上；网页评审 16）；
  //   叫车 App、多远算走路跟着地区走：只用在行程档案写的那个地区（另一国叫车 App 不一样）
  const tripMatch = atDest && Boolean(tDest) && str(tDest.region).toUpperCase() === region;
  let move = null;
  if (atDest) {
    if (sDest && MOVES.indexOf(sDest.move) >= 0) move = sDest.move;
    else if (tDest && MOVES.indexOf(tDest.move) >= 0) move = tDest.move;
  }
  const far = city && MOVES.indexOf(city.far) >= 0 ? city.far : base.far;

  let rideIds = city && Array.isArray(city.ride) ? city.ride : base.ride;
  if (tripMatch && str(tDest.ride) && RIDE_APPS[tDest.ride] && rideIds.length) {
    rideIds = [tDest.ride].concat(rideIds.filter((x) => x !== tDest.ride));
  }
  let walkKm = base.walkKm;
  if (tripMatch && isFinite(Number(tDest.walk_km)) && Number(tDest.walk_km) >= 0.3 && Number(tDest.walk_km) <= 5) walkKm = Number(tDest.walk_km);

  const checked = base.checked || null;
  return {
    region,
    zh: base.zh,
    en: base.en,
    cur: base.cur,
    tz: (city && city.tz) || base.tz,
    lang: base.lang,
    tr: base.tr,
    trReady: Boolean(base.tr) && TR_READY.indexOf(base.tr) >= 0,
    driverText: base.driverText,
    far,
    move,
    walkKm,
    ride: rideApps(rideIds),
    map: base.map,
    coord: base.coord,
    // 没核过的地区：紧急电话、插座、小费都不给（I9）
    sos: checked ? base.sos : null,
    plug: checked ? base.plug : null,
    volt: checked ? base.volt : null,
    tip: checked ? base.tip : null,
    rideNote: (city && city.note) || base.rideNote || null,
    curNote: base.curNote || null,
    mapNote: base.mapNote || null,
    checked,
    city: city ? { id: city.id || null, zh: city.zh } : null,
    zones: city && Array.isArray(city.zones) ? city.zones : [],
    src,
  };
}

/** 新建页「这趟怎么走」默认：城市的 far，没有就地区的 far */
export function moveDefault(region, cityId) {
  const c = cityInfo(cityId);
  if (c && MOVES.indexOf(c.far) >= 0) return c.far;
  const r = regionInfo(region);
  return r ? r.far : 'transit';
}

/** 标准偏移（分钟）和有没有夏令时：{ min, dst } | null */
export function tzStd(tz) {
  const v = TZ_STD[str(tz)];
  return v ? { min: v[0], dst: Boolean(v[1]) } : null;
}

function hoursText(min) {
  const h = Math.abs(min) / 60;
  return (Math.round(h * 100) / 100).toString().replace(/\.0+$/, '');
}

/**
 * 时差文字。tz、homeTz 可以是时区名或分钟数（已经算好的偏移）。
 *   diffText('Asia/Tokyo') → '比香港快 1 小时'；diffText('Asia/Ho_Chi_Minh') → '比香港慢 1 小时'；
 *   diffText('Europe/Paris') → '比香港慢 7 小时（夏令时会变）'；查不到 → ''
 */
export function diffText(tz, homeTz) {
  const home = homeTz === undefined || homeTz === null ? HOME_TZ : homeTz;
  const a = typeof tz === 'number' ? { min: tz, dst: false } : tzStd(tz);
  const b = typeof home === 'number' ? { min: home, dst: false } : tzStd(home);
  if (!a || !b) return '';
  let homeName;
  if (typeof home === 'number') homeName = home === 480 ? '香港' : '家里';
  else homeName = home === HOME_TZ ? '香港' : (regionInfo(regionOfTz(home)) || { zh: '家里' }).zh;
  const d = a.min - b.min;
  const dst = a.dst || b.dst ? '（夏令时会变）' : '';
  if (d === 0) return '和' + homeName + '一样' + dst;
  return '比' + homeName + (d > 0 ? '快 ' : '慢 ') + hoursText(d) + ' 小时' + dst;
}

/** 天气、地点搜索的中心点：分段中心 → 这一段的城市 → 行程第一个城市 → null */
export function cityCenter(trip, o) {
  const seg = (o && o.segment) || null;
  if (seg) {
    const c = rawCoordOf({ lat: seg.center_lat, lng: seg.center_lng });
    if (c) return c;
    const sd = destOf(seg);
    const sc = sd ? cityOf(sd.city) : null;
    if (sc && rawCoordOf(sc)) return { lat: sc.lat, lng: sc.lng };
  }
  const td = destOf(trip);
  const list = td && Array.isArray(td.cities) ? td.cities : [];
  for (let i = 0; i < list.length; i++) {
    const c = cityOf(list[i]);
    if (c && rawCoordOf(c)) return { lat: c.lat, lng: c.lng };
  }
  return null;
}

/** 翻译入口：港澳台内地不需要；语言包没过测试也不显示 */
export function translateLang(profile) {
  return profile && profile.trReady ? profile.tr : null;
}

/** 插座一句话（相对香港说）：没核过 → '' */
export function plugNote(profile) {
  if (!profile || !profile.plug) return '';
  const types = String(profile.plug).split('·');
  let s;
  if (types.length === 1 && types[0] === 'G') s = '插座和香港一样';
  else if (types.indexOf('G') >= 0) s = '有的插座和香港一样，最好带转换头';
  else s = '香港的三脚插头插不上，带转换头';
  if (profile.volt && profile.volt < 200) s += '；电压 ' + profile.volt + 'V，吹风机注意';
  return s;
}

/**
 * 当地卡的几行（概览「当地」小卡、贴士页顶部）。没核过的地区只有币种和叫车。
 * @returns {{ sos: Array<{ label, number }>, plug: string, tip: string, ride: string, cur: string }}
 */
export function localFacts(profile) {
  const p = profile || NEUTRAL;
  const sos = [];
  for (let i = 0; i < (p.sos || []).length; i++) sos.push({ label: p.sos[i][0], number: p.sos[i][1] });
  return {
    sos,
    // 电压低的地区 plugNote 自己会说「电压 110V」，前面就不再写一遍
    plug: p.plug ? p.plug.replace(/·/g, '/') + ' 插座' + (p.volt && p.volt >= 200 ? ' · ' + p.volt + 'V' : '') + '，' + plugNote(p).replace(/^插座/, '') : '',
    tip: p.tip || '',
    ride: p.ride && p.ride.length ? '叫车用 ' + p.ride[0].name : '',
    cur: p.cur ? (CURRENCIES[p.cur] ? CURRENCIES[p.cur].zh : p.cur) : '',
  };
}

/** 新建页灰字预览：'越南盾 · 比香港慢 1 小时 · 叫车用 Grab · 插座要转换头' */
export function previewLine(profile, o) {
  const p = profile || NEUTRAL;
  const home = (o && o.home) || HOME_TZ;
  const parts = [];
  if (p.cur) parts.push(CURRENCIES[p.cur] ? CURRENCIES[p.cur].zh : p.cur);
  const d = p.tz ? diffText(p.tz, home) : '';
  if (d) parts.push(d);
  if (p.ride && p.ride.length) parts.push('叫车用 ' + p.ride[0].name);
  if (p.plug) {
    const types = String(p.plug).split('·');
    if (!(types.length === 1 && types[0] === 'G')) parts.push(types.indexOf('G') >= 0 ? '插座可能要转换头' : '插座要转换头');
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------
// 写法检查（和迁移里的 private.dest_ok 同一套；客户端先挡一遍，服务器再挡一遍）
// ---------------------------------------------------------------------

function cityOk(c) {
  if (typeof c === 'string') return /^[a-z0-9][a-z0-9-]{1,39}$/.test(c);
  if (!isObj(c)) return false;
  const zh = str(c.zh);
  return zh.length > 0 && zh.length <= 40 && rawCoordOf(c) !== null;
}

/** trips.extra.dest 对不对：{ v?, region, cities?, move?, ride?, walk_km? } */
export function destOk(d) {
  if (d === null || d === undefined) return true;
  if (!isObj(d)) return false;
  if (!/^[A-Z]{2}$/.test(str(d.region))) return false;
  if (d.cities !== undefined && d.cities !== null) {
    if (!Array.isArray(d.cities) || d.cities.length > 5) return false;
    for (let i = 0; i < d.cities.length; i++) if (!cityOk(d.cities[i])) return false;
  }
  if (d.move !== undefined && d.move !== null && MOVES.indexOf(d.move) < 0) return false;
  if (d.ride !== undefined && d.ride !== null && !/^[a-z0-9]{2,16}$/.test(str(d.ride))) return false;
  if (d.walk_km !== undefined && d.walk_km !== null) {
    const w = Number(d.walk_km);
    if (typeof d.walk_km !== 'number' || !isFinite(w) || w < 0.3 || w > 5) return false;
  }
  return JSON.stringify(d).length <= 2048;
}

/** segments.extra.dest 对不对：{ region, city?, move? } */
export function segDestOk(d) {
  if (d === null || d === undefined) return true;
  if (!isObj(d)) return false;
  if (!/^[A-Z]{2}$/.test(str(d.region))) return false;
  if (d.city !== undefined && d.city !== null && !cityOk(d.city)) return false;
  if (d.move !== undefined && d.move !== null && MOVES.indexOf(d.move) < 0) return false;
  return JSON.stringify(d).length <= 1024;
}
