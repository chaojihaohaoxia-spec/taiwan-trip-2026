// =====================================================================
// lib/ride-links.js：叫车链接和“给司机看”的内容。叫哪家按目的地档案（rules/dest.js 的 profile.ride）：
// Grab、Uber 能带目的地跳过去；其他（GO、滴滴、Xanh SM……）网页没有能带目的地的链接，先复制地址再自己打开 App。
//
//   import { grabBookingUrl, GRAB_OPEN_URL, driverCardFields, addressForCopy } from '../lib/ride-links.js';
//
//   grabBookingUrl(place, o)   → 打开 Grab 叫车页、目的地预填好的链接（不设上车点，Grab 用当前位置）；什么都没有 → null
//   GRAB_OPEN_URL              → 只打开 Grab（不带目的地），「没打开 Grab？」提示里的按钮用
//   uberRideUrl(place, o)      → 打开 Uber、目的地预填好的链接（写法 UBER_STYLE，真机试后定）；UBER_OPEN_URL 只打开 Uber
//   rideUrl(app, place, o)     → 按叫车 App 的 link（'grab' / 'uber'）给链接；别的 App → null（只能复制地址）
//   driverCardFields(place, o) → 「给司机看」全屏卡：{ primary, address, secondary, phone, note }（o.text：'zh' / 'local' / 'en'）
//   addressForCopy(place, o)   → 复制给司机 / 粘贴进 Grab 的文字：当地语名 + 换行 + 地址
//   rideTarget(place, o)       → 叫车 / 给司机看真正的目的地（见下面「下车点」）：{ place, via, note, noRoad, access, approximate }
//   placeRideInfo(place)       → 地点 extra 里的叫车提示（不解析下车点）：{ via, note, noRoad, access, approximate }
//
// 下车点（SPEC §10，places.extra）：
//   ride_via    叫车、给司机看用另一个地点当目的地（园区里的餐厅 → 园区大堂；香岛 → 缆车站）；「导航」仍然导到地点本身
//   ride_note   一句话（「在大堂下车，园区里坐免费电瓶车过去」），显示在动作行下面和给司机看的卡片上
//   no_road     开车到不了（只能坐缆车 / 船）：「叫 Grab」改成「去缆车站」这类（目的地是 ride_via），并显示 access_note
//   access_note 怎么过去（no_road 时显示）
//   坐标 coord_precision: 'approximate' 的地点：地点详情里标「大概位置」（approximate: true）
// 第二个参数 o = { getPlace }：getPlace(id) 按 id 找同一趟行程的地点（kit/PlaceActions 自动从数据层拿；纯函数测试时传进来）。
// ride_via 写的是地点的 uuid，或者导入时的 key（"place:…"，tools/seed-trip.mjs 不转换 extra 里不以 _id 结尾的键）：
// key 按导入脚本同样的规则（uuid v5，命名空间 SEED_ID_NAMESPACE，名字 `${trip_id}:${key}`）换成 uuid 再找。
//
// 叫 Grab 的完整流程（SPEC §6，由 kit 的 PlaceActions 统一实现）：
//   1. 先 copyText(addressForCopy(place), { silent: true })（失败也不影响）；
//   2. openExternal(grabBookingUrl(place))（lib/native.js，同一个窗口跳转，iOS 才会唤起 App）；
//   3. watchAppSwitch({ timeout: 1500 })（lib/native.js）为 false：提示「没打开 Grab？地址已复制，可以在 Grab 里粘贴」
//      和「打开 Grab」按钮（openExternal(GRAB_OPEN_URL)）。
//
// Grab 没有公开文档，链接格式用的是别人在越南 Grab 上验证过的写法（AppsFlyer OneLink 包一层 grab:// 深链接）：
//   https://grab.onelink.me/2695613898?pid=organic_web&af_force_deeplink=true&af_dp=<encodeURIComponent(深链接)>
//   深链接 grab://open?screenType=BOOKING&dropOffLatitude=…&dropOffLongitude=…&dropOffAddress=…&dropOffKeywords=…
// 等用户在手机上实测；要改格式只改这个文件（GRAB_ONELINK、GRAB_ONELINK_PARAMS、grabDeepLink）。
//
// 地点参数接受数据库的 places 行（name / name_local / name_en / address / phone / lat / lng / coord_precision），
// 也接受同样字段的普通对象（例如酒店预订里拼出来的地点）。
// =====================================================================

import { coordText } from './maps-links.js';

// ---------------------------------------------------------------------
// 下车点：ride_via（地点 uuid 或导入时的 key）→ 地点
// ---------------------------------------------------------------------

/** 导入脚本（tools/seed-trip.mjs 的 ID_NAMESPACE）的 uuid v5 命名空间；单元测试核对两边一致 */
export const SEED_ID_NAMESPACE = '957721cc-f32b-40b9-9d10-9094b1778228';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_KEY_RE = /^place:[a-z0-9][a-z0-9._-]{0,79}$/;

/** SHA-1（同步，只给 uuid v5 用；输入字节数组，输出 20 字节） */
function sha1(bytes) {
  const ml = bytes.length;
  const withPad = ((ml + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(withPad);
  msg.set(bytes);
  msg[ml] = 0x80;
  const bits = ml * 8;
  const view = new DataView(msg.buffer);
  view.setUint32(withPad - 4, bits >>> 0);
  view.setUint32(withPad - 8, Math.floor(bits / 2 ** 32));
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (i < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (i < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30) >>> 0, a, t];
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

/** uuid v5（RFC 4122），和 tools/seed-trip.mjs 的 uuidv5 一致 */
export function uuidv5(name, namespace = SEED_ID_NAMESPACE) {
  const ns = namespace.replace(/-/g, '').match(/../g).map((x) => parseInt(x, 16));
  const nameBytes = new TextEncoder().encode(name);
  const hash = sha1(Uint8Array.from([...ns, ...nameBytes])).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** extra 里的一个文字字段（不是字符串、空白都算没有） */
function extraText(extra, key) {
  const v = extra?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** 地点 extra 里的叫车提示（不解析 ride_via 指向谁） */
export function placeRideInfo(place) {
  const extra = place?.extra && typeof place.extra === 'object' ? place.extra : {};
  return {
    via: extraText(extra, 'ride_via'),
    note: extraText(extra, 'ride_note'),
    noRoad: extra.no_road === true,
    access: extraText(extra, 'access_note'),
    approximate: place?.coord_precision === 'approximate',
  };
}

/** ride_via 的值（uuid 或 "place:…"）→ 地点 uuid（同一趟行程；key 按导入规则换算） */
export function rideViaId(place, via = placeRideInfo(place).via) {
  if (!via) return null;
  if (UUID_RE.test(via)) return via.toLowerCase();
  if (PLACE_KEY_RE.test(via) && place?.trip_id) return uuidv5(`${place.trip_id}:${via}`);
  return null;
}

/**
 * 叫车 / 给司机看 / 复制地址真正用哪个地点（有 ride_via 而且找得到那个地点时用它，否则用地点本身）。
 * @param {object|null} place
 * @param {{ getPlace?: (id: string) => object|null|undefined }} [o]
 * @returns {{ place: object|null, via: object|null, note: string|null, noRoad: boolean, access: string|null, approximate: boolean }}
 *   via：下车点那个地点（没有 / 找不到是 null）；note：ride_note
 */
export function rideTarget(place, { getPlace } = {}) {
  const info = placeRideInfo(place);
  const id = rideViaId(place, info.via);
  const found = id && typeof getPlace === 'function' ? getPlace(id) : null;
  const via = found && found.id !== place?.id ? found : null;
  return { place: via || place || null, via, note: info.note, noRoad: info.noRoad, access: info.access, approximate: info.approximate };
}

/** AppsFlyer OneLink 地址（Grab 官方的跳转域名） */
export const GRAB_ONELINK = 'https://grab.onelink.me/2695613898';
/** OneLink 的固定参数：网页来源、强制走深链接（装了 App 直接打开叫车页） */
export const GRAB_ONELINK_PARAMS = Object.freeze({ pid: 'organic_web', af_force_deeplink: 'true' });
/** 只打开 Grab，不带目的地 */
export const GRAB_OPEN_URL = GRAB_ONELINK;

/** 地址、关键词的长度上限（太长的链接有的系统会截断） */
const MAX_TEXT = 200;

/** 去掉首尾空白；多行合成一行（逗号隔开）；连续空白合成一个空格；超长截断 */
export function oneLine(value, max = MAX_TEXT) {
  const text = String(value ?? '')
    .normalize('NFC') // 越南语的声调有“预组合”和“字母 + 组合符号”两种写法，统一成前者
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\s\u00a0]+/g, ' ').trim().replace(/[,，]$/, ''))
    .filter(Boolean)
    .join(', ');
  const chars = Array.from(text); // 按字符截，不切坏 emoji
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text;
}

/** 多行文字：统一换行、去掉每行首尾空白和空行（给司机看的地址保留原来的分行） */
function multiLine(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function clean(value) {
  const s = multiLine(value);
  return s || null;
}

/**
 * 能不能拿坐标叫车：经纬度都是有限数字、在范围内、不是 (0, 0)；
 * coord_precision 为 'city'（只精确到城市）的坐标会把司机带到市中心，不用。
 */
export function rideCoords(place) {
  if (!place || place.lat == null || place.lng == null || place.lat === '' || place.lng === '') return null;
  if (place.coord_precision === 'city') return null;
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** 当地语名字（司机看得懂的）：name_local > name > name_en */
export function localName(place) {
  return clean(place?.name_local) || clean(place?.name) || clean(place?.name_en);
}

/** 叫车搜索用的关键词：当地语名 > 英文名 > 中文名（Grab 搜中文基本搜不到） */
function rideKeywords(place) {
  return oneLine(place?.name_local) || oneLine(place?.name_en) || oneLine(place?.name);
}

/**
 * grab:// 深链接（没包 OneLink 的那一层）。有坐标带坐标 + 地址 + 关键词；没坐标只带地址和关键词；
 * 每个参数各自 encodeURIComponent（地址里的 & # 空格 中文 换行都不会把链接弄断）；空的参数不写。
 * @returns {string|null}
 */
export function grabDeepLink(place) {
  if (!place) return null;
  const coords = rideCoords(place);
  const address = oneLine(place.address);
  const keywords = rideKeywords(place);
  if (!coords && !address && !keywords) return null;
  const params = [['screenType', 'BOOKING']];
  if (coords) {
    const [lat, lng] = coordText(coords.lat, coords.lng).split(',');
    params.push(['dropOffLatitude', lat], ['dropOffLongitude', lng]);
  }
  if (address) params.push(['dropOffAddress', address]);
  if (keywords) params.push(['dropOffKeywords', keywords]);
  return `grab://open?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * 打开 Grab 叫车页、目的地预填好的链接（OneLink 包一层：没装 App 时落到 Grab 的下载页）。
 * 地点有下车点（extra.ride_via）时目的地是下车点（o.getPlace 找得到它的话）。
 * @param {object|null} place
 * @param {{ getPlace?: (id: string) => object|null }} [o]
 * @returns {string|null} 地点什么信息都没有（没坐标、没地址、没名字）返回 null
 */
export function grabBookingUrl(place, o) {
  const deep = grabDeepLink(rideTarget(place, o).place);
  if (!deep) return null;
  const query = Object.entries(GRAB_ONELINK_PARAMS).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  query.push(`af_dp=${encodeURIComponent(deep)}`);
  return `${GRAB_ONELINK}?${query.join('&')}`;
}

// ---------------------------------------------------------------------
// Uber（香港、澳门、台湾、日本、欧美……档案里叫车写 uber 的地方）
// ---------------------------------------------------------------------

/**
 * Uber 带目的地的写法（两种都是 Uber 官方的通用链接：装了 App 直接打开，没装落到网页版）：
 *   'ul'       https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=…&dropoff[longitude]=…&dropoff[nickname]=…&dropoff[formatted_address]=…
 *   'looking'  https://m.uber.com/looking?drop[0]={"latitude":…,"longitude":…,"addressLine1":…,"addressLine2":…}（新版网页叫车页）
 * 等用户在手机上实测哪种能直接进叫车页，要改只改这一个常量。
 */
export const UBER_STYLE = 'ul';
/** 只打开 Uber，不带目的地（「没打开 Uber？」提示里的按钮） */
export const UBER_OPEN_URL = 'https://m.uber.com/ul/';

/**
 * 打开 Uber、目的地预填好的链接（有下车点时目的地是下车点）。没坐标只带名字和地址（Uber 自己搜）；什么都没有 → null。
 * Uber 搜中文地名基本搜得到（港澳台、内地以外按当地名 > 英文名 > 中文名）。
 * @param {object|null} place
 * @param {{ getPlace?: (id: string) => object|null, style?: 'ul'|'looking' }} [o]
 */
export function uberRideUrl(place, o = {}) {
  const p = rideTarget(place, o).place;
  if (!p) return null;
  const coords = rideCoords(p);
  const name = rideKeywords(p) || '';
  const address = oneLine(p.address);
  if (!coords && !address && !name) return null;
  const style = o.style || UBER_STYLE;
  if (style === 'looking') {
    const drop = {};
    if (coords) {
      const [lat, lng] = coordText(coords.lat, coords.lng).split(',');
      drop.latitude = Number(lat);
      drop.longitude = Number(lng);
    }
    drop.addressLine1 = name || address;
    if (address && address !== drop.addressLine1) drop.addressLine2 = address;
    return `https://m.uber.com/looking?drop%5B0%5D=${encodeURIComponent(JSON.stringify(drop))}`;
  }
  const params = [['action', 'setPickup'], ['pickup', 'my_location']];
  if (coords) {
    const [lat, lng] = coordText(coords.lat, coords.lng).split(',');
    params.push(['dropoff[latitude]', lat], ['dropoff[longitude]', lng]);
  }
  if (name) params.push(['dropoff[nickname]', name]);
  if (address || !coords) params.push(['dropoff[formatted_address]', address || name]);
  return `${UBER_OPEN_URL}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * 叫车 App（rules 的 profile.ride[0] / how.ride）→ 带目的地的链接：link 'grab' → Grab、'uber' → Uber；
 * 别的 App（GO、滴滴、Xanh SM……）没有能带目的地的网页链接 → null（界面先复制地址，再提示自己打开 App）。
 * @param {{ link?: string|null }|null} app
 */
export function rideUrl(app, place, o) {
  if (!app || !place) return null;
  if (app.link === 'grab') return grabBookingUrl(place, o);
  if (app.link === 'uber') return uberRideUrl(place, o);
  return null;
}

/** 「没打开 XX？」提示里「打开 XX」用的链接（只打开 App，不带目的地）；没有 → null */
export function rideOpenUrl(app) {
  if (!app) return null;
  if (app.link === 'grab') return GRAB_OPEN_URL;
  if (app.link === 'uber') return UBER_OPEN_URL;
  return null;
}

/**
 * 「给司机看」全屏卡的内容（有下车点时显示下车点那个地点）：
 *   primary    最大号：按 o.text（目的地档案的 driverText）——'local' 当地语名字（name_local，没有就用 name）；
 *              'zh' 中文名（港澳台内地的司机直接看中文）；'en' 英文名
 *   address    地址（保留分行）
 *   secondary  小字：中文名（name）；大字已经是中文名时写当地名；和 primary 一样时为 null
 *   phone      电话（有才显示「打电话」；下车点自己的电话）
 *   note       下车提示（ride_note；开车到不了时接上 access_note）
 * 都没有的字段是 null。
 * @param {object|null} place
 * @param {{ getPlace?: (id: string) => object|null, text?: 'local'|'zh'|'en' }} [o]
 * @returns {{ primary: string|null, address: string|null, secondary: string|null, phone: string|null, note: string|null }}
 */
const HAN = /[\u3400-\u9fff]/;

export function driverCardFields(place, o) {
  const t = rideTarget(place, o);
  const p = t.place;
  const local = clean(p?.name_local);
  const zh = clean(p?.name);
  const en = clean(p?.name_en);
  // 司机看得懂什么字（目的地档案的 driverText），和小程序 pages/trip/view.js 的 driverFields 一套：
  //   'zh'    港澳台内地：当地名是汉字就用当地名（「雾港车站」，不用自己写的「雾港车站（集合）」），否则中文名
  //   'en'    英文名在前
  //   'local' 当地文字在前；地点还没有当地名时先给英文名（越南司机看英文比看中文强）
  //   不传    旧写法：当地名 → 中文名 → 英文名（小程序 trip-core 的 driverCardFields 逐字比对这一支）
  const text = o?.text || null;
  let primary;
  if (text === 'zh') primary = (local && HAN.test(local) ? local : '') || zh || local || en;
  else if (text === 'en') primary = en || local || zh;
  else if (text === 'local') primary = local || en || zh;
  else primary = local || zh || en;
  const note = [t.note, t.noRoad ? t.access : null].filter(Boolean).join('；') || null;
  // 小字：大字不是中文名时写中文名（自己认得是哪儿）；大字已经是中文名时写当地名、英文名（有的话）
  const secondary = text
    ? [zh, local, en].find((x) => x && x !== primary) || null
    : primary && primary !== zh ? zh : local && local !== primary ? local : null;
  return {
    primary,
    address: clean(p?.address),
    secondary,
    phone: clean(p?.phone),
    note,
  };
}

/**
 * 复制用的文字：当地语名字 + 换行 + 地址（没地址就只有名字；都没有是空字符串）；有下车点时是下车点的。
 * 粘贴进 Grab 的搜索框、发给司机都合适。
 * @param {object|null} place
 * @param {{ getPlace?: (id: string) => object|null }} [o]
 */
export function addressForCopy(place, o) {
  const p = rideTarget(place, o).place;
  return [localName(p), clean(p?.address)].filter(Boolean).join('\n');
}
