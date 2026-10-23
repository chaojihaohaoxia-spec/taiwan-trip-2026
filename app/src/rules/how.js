// =====================================================================
// rules/how.js：「这一项怎么去」→ 动作行给哪些按钮（规则包；网页、小程序同一套，cases/how.json 是金标准）。
//
//   prevStop(dayItems, itemId, { getPlace, stayLastNight })   上一站 → { place, from: 'item'|'stay', itemId, unknown } | null
//   howToGet(item, ctx)                                       这一项的按钮（返回结构见 howToGet 的注释）
//   placeActions(place, { profile, prefer, via })             没有条目上下文时（地点页、地图小卡、预订卡、住处卡）的一排
//   transportOf(item)                                         读 transport_in：{ mode, modes, auto, imported, rideAlt }
//   transportChoices(item)                                    「怎么去」那排芯片：{ chips, current, sub, autoAllowed }
//   transportPatch(item, choice)                              选了一个芯片后 transport_in 该写成什么（不改传入的对象）
//   checkinWindow(depMs, o)                                   网上值机开放 / 关闭 / 待办截止的时刻
//   transferPhone(booking, { getContact, contacts })          「有人接」打给谁（司机 → 预订里写的电话 → 挂在预订上的联系人）
//
// 动作键：nav 导航、ride 叫车（文字按档案：叫 Grab / 叫 Uber / 叫滴滴）、driver 给司机看、copy 复制地址、
//         checkin 值机、pass 登机牌 / 行程单、status 航班动态、call 打电话（只有「有人接」时规则里给）。
// 「⋯」：more 是这一次临时能用的其余动作（不写库）；复制地址、记一笔这些页面照旧加在后面。
//
// 写法：普通 ESM、纯函数、零依赖、不用 Intl；不改传入的对象。用户看得到的字都在 TEXT 里。
// =====================================================================

import { coordOf, rawCoordOf, haversineKm, samePlace, inBox } from './geo.js';
import { TZ_STD } from './dest-data.js';

export const TEXT = Object.freeze({
  here: '和上一项在同一个地方',
  depart: '从这里出发，不用过去',
  walk: (km) => '离上一站 ' + km + ' 公里，走过去',
  ride: (km) => '离上一站 ' + km + ' 公里，按打车算',
  transit: (km) => '离上一站 ' + km + ' 公里，坐车或打车',
  self_drive: (km) => '离上一站 ' + km + ' 公里，开车过去',
  scooter: (km) => '离上一站 ' + km + ' 公里，骑车过去',
  far: (km) => '有 ' + km + ' 公里，先看看怎么去',
  unknown: '算不出离上一站多远',
  transfer: '有人接，不用叫车',
  nameOnly: '这个地点只有名字，先补个地址或位置',
  ride_label: (name) => (/^[\u4e00-\u9fff]/.test(name) ? '叫' : '叫 ') + name,
  ride_generic: '叫车',
  needLocal: '还没有当地文字名字',
});

/** transport_in 的 mode（docs/数据结构.md B5.5；transfer = 包车、接送、跟团、酒店接驳，「有人接」） */
export const MODES = Object.freeze(['walk', 'metro', 'subway', 'bus', 'taxi', 'grab', 'scooter', 'bicycle', 'ferry', 'train', 'hsr', 'flight', 'car', 'cable_car', 'transfer', 'other']);
export const TRANSIT_MODES = Object.freeze(['metro', 'subway', 'bus', 'train', 'hsr', 'ferry', 'cable_car']);
export const RIDE_MODES = Object.freeze(['taxi', 'grab']);
/** 没写怎么去、离上一站超过这么远：叫车不做主按钮，先导航看看怎么去 */
export const FAR_KM = 30;
/** 「走路为主」的行程：这么远以内都算走路 */
export const WALK_MOVE_KM = 3;
/** 网上值机：起飞前 opens_h 小时开放、closes_h 小时关闭；待办截止 due_h（I5；航司表在批 B 的 airports.js） */
export const CHECKIN = Object.freeze({ opens_h: 48, closes_h: 1, due_h: 3 });

const PLACE_KEYS = ['nav', 'ride', 'driver', 'copy'];
const NAV_MODE = { walk: 'walking', transit: 'transit', drive: 'driving', bike: 'bicycling' };
const DEFAULT_PROFILE = { far: 'transit', move: null, walkKm: 1.5, ride: [], driverText: 'en', zones: [] };

const str = (v) => (v === null || v === undefined ? '' : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (v) => str(v).trim() !== '';
const inList = (list, v) => list.indexOf(v) >= 0;

/** 公里数写法：10 公里以内一位小数，以上取整 */
export function kmText(km) {
  if (km === null || km === undefined || !isFinite(km)) return '';
  return km < 10 ? (Math.round(km * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.round(km));
}

// ---------------------------------------------------------------------
// 读 transport_in
// ---------------------------------------------------------------------

/**
 * @returns {{ mode: string|null, modes: string[], auto: boolean, imported: boolean, rideAlt: boolean, appSet: boolean, options: object[] }}
 *   mode：推荐的那种（没有推荐取第一种）；auto: true 时当没写（mode = null）
 *   imported：导入时写的（有一条不是 App 写的，或有一句 summary）→ 不给「自动」，导入的说明一个字都不丢
 *   rideAlt：写的几种里有打车（推荐的以外也算）
 *   appSet：是在 App 里点芯片定的（只有 App 写的那条；或导入的条目上点过，transport_in.picked = true）
 *           → 自己定的走法比「和上一项同一个地方」「从住处出发」优先（导入时写成出发地的交通条目，点一下就能改对）
 */
export function transportOf(item) {
  const tr = item && isObj(item.transport_in) ? item.transport_in : null;
  if (!tr) return { mode: null, modes: [], auto: false, imported: false, rideAlt: false, options: [] };
  const options = Array.isArray(tr.options) ? tr.options.filter((o) => isObj(o) && has(o.mode)) : [];
  const modes = (has(tr.mode) ? [str(tr.mode)] : []).concat(options.map((o) => str(o.mode)));
  let rec = null;
  for (let i = 0; i < options.length; i++) if (options[i].recommended) { rec = options[i]; break; }
  if (!rec) rec = options[0] || null;
  const auto = tr.auto === true;
  const mode = auto ? null : (has(tr.mode) ? str(tr.mode) : rec ? str(rec.mode) : null);
  const imported = options.some((o) => o.source !== 'app') || has(tr.summary);
  const rideAlt = modes.some((m) => inList(RIDE_MODES, m));
  // App 里点芯片选的（只有 App 写的那条，或导入的条目上点过：picked）：比「和上一项同一个地方」优先
  const appSet = Boolean(mode) && (tr.picked === true || (!imported && Boolean(rec) && rec.source === 'app'));
  return { mode, modes, auto, imported, rideAlt, appSet, options };
}

// ---------------------------------------------------------------------
// 标题里的交通词
// ---------------------------------------------------------------------

const WALK_START = /^\s*(走路|步行|走回|走到|走去|走过去|走\s*\d)/;
const RIDE_START = /^\s*(打车|打的|叫车|坐车去|搭车|坐的士|搭的士|坐出租|叫\s*(grab|uber|xanh|bolt|滴滴|的士|出租车|计程车))/i;
const TRANSIT_START = /^\s*(坐|搭|乘)\s*(地铁|捷运|轻轨|电车|公交|巴士|大巴|客运|机场快线|快线|火车|台铁|高铁|动车|轮渡|渡轮|渡船|船|缆车|mrt|bts)/i;
// kind = transport 的条目在标题任意位置找；谁先出现算谁（「叫 Grab 去码头坐船」算打车）
const ANY_WORDS = [
  { re: /走路|步行|走回|走过去/, key: 'walk', mode: 'walk' },
  { re: /打车|打的|叫车|的士|出租车|计程车|grab|uber|xanh\s?sm|bolt|滴滴/i, key: 'ride', mode: 'taxi' },
  { re: /机场快线|快线|客运|大巴|巴士|公交/, key: 'transit', mode: 'bus' },
  { re: /地铁|捷运|轻轨|电车|mrt|bts/i, key: 'transit', mode: 'metro' },
  { re: /高铁|动车/, key: 'transit', mode: 'hsr' },
  { re: /火车|台铁/, key: 'transit', mode: 'train' },
  { re: /渡轮|轮渡|渡船|坐船|搭船/, key: 'transit', mode: 'ferry' },
  { re: /缆车/, key: 'transit', mode: 'cable_car' },
];
const START_MODE = {
  地铁: 'metro', 捷运: 'metro', 轻轨: 'metro', 电车: 'metro', mrt: 'metro', bts: 'metro',
  公交: 'bus', 巴士: 'bus', 大巴: 'bus', 客运: 'bus', 快线: 'bus', 机场快线: 'train', 火车: 'train', 台铁: 'train',
  高铁: 'hsr', 动车: 'hsr', 轮渡: 'ferry', 渡轮: 'ferry', 渡船: 'ferry', 船: 'ferry', 缆车: 'cable_car',
};
const DEPART_TITLE = /^\s*(从.{1,30}?出发|起床|退房|出门)/;
// 航班条目里的「抵达 / 落地」：只给航班动态（值机是起飞那条的事）
const ARRIVE_TITLE = /^\s*(抵达|到达|落地|降落|飞抵|入境|回到)/;

/** 机场快线（香港是铁路）单独认成 train；其余照表 */
function wordMode(title, w) {
  if (w.mode === 'bus' && /机场快线/.test(title) && !/客运|巴士/.test(title)) return 'train';
  return w.mode;
}

/** 标题 → { key, mode } | null。anywhere：在任意位置找（kind = transport） */
export function titleHow(title, anywhere) {
  const t = str(title);
  if (!t) return null;
  if (anywhere) {
    let best = null;
    let at = Infinity;
    for (let i = 0; i < ANY_WORDS.length; i++) {
      const m = ANY_WORDS[i].re.exec(t);
      if (m && m.index < at) {
        at = m.index;
        best = { key: ANY_WORDS[i].key, mode: wordMode(t, ANY_WORDS[i]) };
      }
    }
    return best;
  }
  if (WALK_START.test(t)) return { key: 'walk', mode: 'walk' };
  if (RIDE_START.test(t)) return { key: 'ride', mode: 'taxi' };
  const m = TRANSIT_START.exec(t);
  if (m) return { key: 'transit', mode: START_MODE[m[2].toLowerCase()] || null };
  return null;
}

// ---------------------------------------------------------------------
// 上一站
// ---------------------------------------------------------------------

const isPrimary = (it) => !it.variant || it.variant === 'primary';
const isGone = (it) => Boolean(it.deleted_at) || it.status === 'skipped' || it.status === 'cancelled';

/**
 * 上一站：同一天主方案里排在它前面、有地点、没标「没去」的最近一项；当天第一项看昨晚住的地方；都没有 → null。
 *   - 那一项有地点但坐标不能用（没有 / 只到城市）：直接返回它，unknown: true（「上一站不明」，不越过它拿两站前的坐标）
 *   - 备选、雨天方案：用它所替代的主方案那一项的上一站；当天通用备选（没挂主方案）→ null
 * @param {Array<object>} dayItems 这一天的条目（各种方案都可以，已按 sort_key 排好）
 * @param {string} itemId
 * @param {{ getPlace: (id: string) => object|null, stayLastNight?: object|null }} o
 */
export function prevStop(dayItems, itemId, o) {
  const opt = o || {};
  const getPlace = typeof opt.getPlace === 'function' ? opt.getPlace : () => null;
  const list = (dayItems || []).filter((it) => it && !it.deleted_at);
  let target = null;
  for (let i = 0; i < list.length; i++) if (list[i].id === itemId) { target = list[i]; break; }
  if (!target) return null;
  if (!isPrimary(target)) {
    if (!target.parent_item_id) return null;
    let parent = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === target.parent_item_id) { parent = list[i]; break; }
    if (!parent) return null;
    target = parent;
  }
  const primary = list.filter(isPrimary);
  const idx = primary.indexOf(target);
  for (let k = idx - 1; k >= 0; k--) {
    const it = primary[k];
    if (!it.place_id || isGone(it)) continue;
    const place = getPlace(it.place_id);
    if (!place) continue;
    return { place, from: 'item', itemId: it.id, unknown: !coordOf(place) };
  }
  if (opt.stayLastNight) return { place: opt.stayLastNight, from: 'stay', itemId: null, unknown: !coordOf(opt.stayLastNight) };
  return null;
}

// ---------------------------------------------------------------------
// 航班
// ---------------------------------------------------------------------

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) return isFinite(v.getTime()) ? v.getTime() : null;
  const t = Date.parse(String(v));
  return isFinite(t) ? t : null;
}

/** ISO 串里写的偏移（'+07:00' → 420；'Z' → 0；没写 → null） */
function isoOffset(s) {
  const m = /(?:([+-])(\d{2}):?(\d{2})|Z)$/.exec(str(s).trim());
  if (!m) return null;
  if (!m[1]) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** 网上值机的几个时刻：{ opensAt, closesAt, dueAt }；o 可以给 opens_h / closes_h / due_h（航司表以后给） */
export function checkinWindow(depMs, o) {
  const dep = toMs(depMs);
  if (dep === null) return null;
  const c = Object.assign({}, CHECKIN, o || {});
  const H = 3600 * 1000;
  return { opensAt: dep - c.opens_h * H, closesAt: dep - c.closes_h * H, dueAt: dep - c.due_h * H };
}

function localDate(ms, offMin) {
  const d = new Date(ms + offMin * 60000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function flightPlan(booking, c) {
  const dep = booking ? toMs(booking.start_at) : null;
  const arr = booking ? toMs(booking.end_at) : null;
  let off = typeof c.depOffsetMin === 'number' ? c.depOffsetMin : null;
  if (off === null && booking && TZ_STD[booking.start_tz]) off = TZ_STD[booking.start_tz][0];
  if (off === null && booking) off = isoOffset(booking.start_at);
  const now = toMs(c.now);
  const win = dep !== null ? checkinWindow(dep, c.checkin) : null;
  const actions = [];
  if (win && (now === null || (now >= win.opensAt && now <= win.closesAt))) actions.push('checkin');
  if (booking && ((Array.isArray(booking.attachments) && booking.attachments.length) || c.hasPass)) actions.push('pass');
  if (dep !== null) {
    let today;
    if (now === null) today = true;
    else if (off !== null) today = localDate(now, off) === localDate(dep, off) || (now >= dep && now <= (arr !== null ? arr : dep + 12 * 3600 * 1000));
    else today = now >= dep - 24 * 3600 * 1000 && now <= (arr !== null ? arr : dep + 12 * 3600 * 1000);
    if (today) actions.push('status');
  }
  return { actions, info: win ? { dep, opensAt: win.opensAt, closesAt: win.closesAt, dueAt: win.dueAt } : null };
}

/**
 * 条目是不是这班飞机本身（不是「去机场值机」「柜台托运」）：
 *   'number' 标题里有航班号；'time' 开始时间就是起飞时间；'notime' 没写时间（只在和上一站不同时算）；null 不是
 */
function flightLegOf(item, booking, c) {
  if (item.kind !== 'flight' || !booking || booking.kind !== 'flight') return null;
  const no = isObj(booking.details) ? str(booking.details.flight_no).replace(/\s+/g, '').toUpperCase() : '';
  const title = str(item.title).replace(/\s+/g, '').toUpperCase();
  if (no && title.indexOf(no) >= 0) return 'number';
  if (!has(item.start_time)) return 'notime';
  const dep = toMs(booking.start_at);
  let off = typeof c.depOffsetMin === 'number' ? c.depOffsetMin : null;
  if (off === null && TZ_STD[booking.start_tz]) off = TZ_STD[booking.start_tz][0];
  if (dep === null || off === null) return null;
  const d = new Date(dep + off * 60000);
  const hm = String(100 + d.getUTCHours()).slice(1) + ':' + String(100 + d.getUTCMinutes()).slice(1);
  return str(item.start_time).slice(0, 5) === hm ? 'time' : null;
}

/** 到达的那条：标题打头是「抵达 / 落地…」，或开始时间就是降落时间（end_at，按 end_tz） */
function isArrival(item, booking, c) {
  if (ARRIVE_TITLE.test(str(item.title))) return true;
  if (!booking || !has(item.start_time)) return false;
  const arr = toMs(booking.end_at);
  let off = TZ_STD[booking.end_tz] ? TZ_STD[booking.end_tz][0] : null;
  if (off === null) off = isoOffset(booking.end_at);
  if (arr === null || off === null) return false;
  const d = new Date(arr + off * 60000);
  const hm = String(100 + d.getUTCHours()).slice(1) + ':' + String(100 + d.getUTCMinutes()).slice(1);
  const dep = toMs(booking.start_at);
  return str(item.start_time).slice(0, 5) === hm && (dep === null || dep !== arr);
}

// ---------------------------------------------------------------------
// 按钮
// ---------------------------------------------------------------------

/** 开车到不了（no_road）时「叫车」叫什么（和 kit/place-actions.js 的 noRoadLabel 一样） */
export function noRoadLabel(via) {
  const name = str(via && via.name) + ' ' + str(via && via.name_en);
  if (/缆车|索道|cable/i.test(name)) return '去缆车站';
  if (/码头|渡口|港|pier|port|ferry/i.test(name)) return '去码头';
  return '去下车点';
}

function moveActions(eff) {
  if (eff === 'ride') return { key: 'ride', actions: ['ride', 'driver'], nav: 'drive' };
  if (eff === 'self_drive' || eff === 'scooter') return { key: 'self', actions: ['nav'], nav: 'drive' };
  return { key: 'transit', actions: ['nav', 'ride'], nav: 'transit' };
}

function blank() {
  return {
    key: 'none', mode: null, source: 'none', km: null, actions: [], primary: null, navMode: null, more: [],
    ride: null, hint: null, collapsed: false, disabled: false, reason: null, navByName: false, driverNeedsLocal: false,
    zone: null, phone: null, flight: null,
  };
}

/**
 * 这一项怎么去 → 按钮。
 * @param {object} item 条目（items 行）
 * @param {{ place?: object|null, prev?: ReturnType<typeof prevStop>, profile?: object, booking?: object|null,
 *           stays?: object[], via?: object|null, phone?: string|null, now?: number|Date|null, depOffsetMin?: number|null,
 *           checkin?: { opens_h?: number, closes_h?: number }, hasPass?: boolean }} ctx
 *   place：这一项的地点；prev：prevStop 的结果；profile：dest.profileOf 的结果；booking：关联的预订；
 *   stays：昨晚、今晚住的地点（「从酒店出发」「退房」判断用）；via：地点 extra.ride_via 解析出来的下车点；
 *   phone：「有人接」时司机 / 预订联系人的电话；now：航班按钮的时间窗（不给 = 不按时间筛）；depOffsetMin：起飞地 UTC 偏移
 * @returns {{
 *   key: 'none'|'here'|'fly'|'walk'|'transit'|'self'|'ride'|'transfer'|'unknown',
 *   mode: string|null, source: 'none'|'set'|'booking'|'title'|'distance'|'same'|'depart'|'move'|'default',
 *   km: number|null, actions: string[], primary: string|null, navMode: 'walking'|'transit'|'driving'|'bicycling'|null,
 *   more: string[], ride: { id, name, label, link, mini }|null, hint: string|null, collapsed: boolean,
 *   disabled: boolean, reason: string|null, navByName: boolean, driverNeedsLocal: boolean, zone: string|null,
 *   phone: string|null, flight: { dep, opensAt, closesAt, dueAt }|null }}
 */
export function howToGet(item, ctx) {
  const c = ctx || {};
  const it = item || {};
  const out = blank();
  out.collapsed = it.status === 'done' || it.status === 'skipped';
  const place = c.place || null;
  if (!place) return out;

  const prof = c.profile || DEFAULT_PROFILE;
  const tr = transportOf(it);
  const prev = c.prev || null;
  const prevPlace = prev ? prev.place : null;
  const same = Boolean(prevPlace) && samePlace(prevPlace, place);
  const here = coordOf(place);
  const there = prevPlace && !prev.unknown ? coordOf(prevPlace) : null;
  const rawKm = here && there ? haversineKm(there, here) : null;
  out.km = rawKm === null ? null : Math.round(rawKm * 100) / 100;
  const km = kmText(rawKm);
  const booking = c.booking || null;
  const bkind = booking ? booking.kind : null;
  const walkKm = isFinite(prof.walkKm) ? prof.walkKm : 1.5;
  const eff = prof.move || prof.far || 'transit';

  let key;
  let mode = tr.mode;
  let source = 'set';
  let actions = [];
  let nav = null;
  let hint = null;

  const leg = tr.mode ? null : flightLegOf(it, booking, c);
  if (tr.mode === 'flight' || leg === 'number' || leg === 'time' || (leg === 'notime' && !same)) {
    // R2 坐飞机去：值机（开放→关闭）、登机牌（有文件时）、航班动态（当天）
    const f = flightPlan(booking, c);
    key = 'fly';
    mode = 'flight';
    source = tr.mode ? 'set' : 'booking';
    // 「抵达香港机场 T1」这种到达的那条：没有值机、登机牌，只留航班动态
    actions = isArrival(it, booking, c) ? f.actions.filter((a) => a === 'status') : f.actions;
    out.flight = f.info;
  } else if (same && !tr.appSet) {
    // R3 和上一站同一个地方（导入时写了 mode 也一样：在高铁站等快线；App 里自己点的走法除外）
    key = 'here';
    source = 'same';
    hint = TEXT.here;
  } else if (!tr.appSet && DEPART_TITLE.test(str(it.title)) && (c.stays || []).some((s) => samePlace(s, place))) {
    // 「从酒店出发」「起床」「退房」而且地点就是住的地方：人已经在那儿了
    key = 'here';
    source = 'depart';
    hint = TEXT.depart;
  } else if (tr.mode && tr.mode !== 'other') {
    const m = tr.mode;
    if (m === 'walk') {
      // R4 / R5 走路（也写了打车：「走 13 分钟，或打车 4 分钟」）
      key = 'walk';
      actions = tr.rideAlt ? ['nav', 'ride', 'driver'] : ['nav'];
      nav = 'walk';
    } else if (inList(TRANSIT_MODES, m)) {
      // R6 地铁公交船缆车（也写了打车就把叫车放第二个）
      key = 'transit';
      actions = tr.rideAlt ? ['nav', 'ride'] : ['nav'];
      nav = 'transit';
    } else if (m === 'bicycle') {
      key = 'self';
      actions = ['nav'];
      nav = 'bike';
    } else if (m === 'scooter') {
      key = 'self';
      actions = ['nav'];
      nav = 'drive';
    } else if (m === 'car') {
      key = 'self';
      actions = ['nav', 'driver'];
      nav = 'drive';
    } else if (m === 'transfer') {
      key = 'transfer';
      actions = ['driver'];
      hint = TEXT.transfer;
    } else if (inList(RIDE_MODES, m)) {
      key = 'ride';
      actions = ['ride', 'driver'];
      nav = 'drive';
    } else {
      key = null; // 不认识的 mode：当没写
    }
  }

  if (!key && !tr.mode && bkind === 'transfer') {
    // 挂着接送预订：有人接
    key = 'transfer';
    mode = 'transfer';
    source = 'booking';
    actions = ['driver'];
    hint = TEXT.transfer;
  }

  if (!key) {
    // 没写怎么去（或写了 other）：先看标题，再按距离
    mode = null;
    const t = it.kind === 'walk' || it.kind === 'walk_route' ? { key: 'walk', mode: 'walk' } : titleHow(it.title, it.kind === 'transport');
    if (t) {
      source = 'title';
      key = t.key;
      mode = t.mode;
      if (t.key === 'walk') {
        actions = ['nav'];
        nav = 'walk';
      } else if (t.key === 'ride') {
        actions = ['ride', 'driver'];
        nav = 'drive';
      } else {
        actions = ['nav'];
        nav = 'transit';
      }
    } else if (rawKm !== null) {
      source = 'distance';
      const limit = eff === 'walk' ? Math.max(walkKm, WALK_MOVE_KM) : walkKm;
      if (rawKm < limit) {
        // R15 近：走路
        key = 'walk';
        mode = 'walk';
        actions = ['nav'];
        nav = 'walk';
        hint = TEXT.walk(km);
      } else {
        // R16 远：按这段 / 这趟怎么走，没写按城市、地区的习惯
        const e = eff === 'walk' ? 'transit' : eff;
        const ma = moveActions(e);
        key = ma.key;
        actions = ma.actions.slice();
        nav = ma.nav;
        mode = e === 'ride' ? 'taxi' : e === 'self_drive' ? 'car' : e === 'scooter' ? 'scooter' : null;
        hint = TEXT[e](km);
        if (rawKm >= FAR_KM) {
          // 30 公里以上：叫车不做主按钮，先导航看看怎么去
          key = 'unknown';
          actions = ['nav'].concat(actions.filter((a) => a !== 'nav'));
          hint = TEXT.far(km);
        }
      }
    } else {
      // R17 算不出距离（当天第一项又没住处、上一站或这里没坐标）
      source = 'default';
      key = 'unknown';
      const e = eff === 'walk' ? 'transit' : eff;
      if (e === 'ride') {
        actions = ['nav', 'ride', 'driver'];
        nav = 'drive';
      } else if (e === 'self_drive' || e === 'scooter') {
        actions = ['nav'];
        nav = 'drive';
      } else {
        actions = ['nav', 'ride'];
        nav = 'transit';
      }
      hint = prevPlace || !here ? TEXT.unknown : null;
    }
  }

  out.key = key;
  out.mode = mode || null;
  out.source = source;
  out.hint = hint;
  out.navMode = nav ? NAV_MODE[nav] : null;
  if (key === 'transfer' && has(c.phone)) {
    actions = actions.concat(['call']);
    out.phone = str(c.phone);
  }
  return finish(out, actions, place, prof, c);
}

/** 叫车 App：区域（zone）有自己的就用区域的；没有就档案的第一个 */
function rideOf(apps, place, via) {
  const app = apps && apps.length ? apps[0] : null;
  if (!app) return null;
  const extra = isObj(place.extra) ? place.extra : {};
  const label = extra.no_road && via ? noRoadLabel(via) : TEXT.ride_label(app.name);
  return { id: app.id, name: app.name, label, link: app.link || null, mini: app.mini || null };
}

/** 筛子（区域、F1、F3、F4、F5）+ 主按钮 + ⋯ */
function finish(out, list, place, prof, c) {
  let actions = list.slice();
  let apps = prof.ride || [];
  const pass = out.key === 'here' || out.key === 'none' || out.key === 'fly';
  let noCar = false;

  // 岛上、园区里叫不到车（城市的 zones）
  const zones = prof.zones || [];
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z && z.box && inBox(place, z.box)) {
      out.zone = z.id || null;
      apps = Array.isArray(z.ride) ? z.ride : apps;
      if (!apps.length) {
        // 岛上、园区里根本没有车：叫车、给司机看都去掉（「⋯」里也不给）
        noCar = true;
        actions = actions.filter((a) => a !== 'ride' && a !== 'driver');
        if (!pass && z.note) out.hint = z.note;
      }
      break;
    }
  }
  // F1 这里没有能叫的车
  if (!apps.length) actions = actions.filter((a) => a !== 'ride');
  // F3 坐标只到城市：不叫车、不给司机看；导航按名字搜
  if (place.coord_precision === 'city' && rawCoordOf(place)) {
    actions = actions.filter((a) => a !== 'ride' && a !== 'driver');
    out.navByName = true;
  }
  // 叫车被筛掉了（或筛空了）：导航补到最前面
  const rideCut = list.indexOf('ride') >= 0 && actions.indexOf('ride') < 0;
  if (!pass && actions.indexOf('nav') < 0 && (rideCut || !actions.length)) actions = ['nav'].concat(actions);
  if (actions.indexOf('nav') >= 0 && !out.navMode) out.navMode = 'driving';

  // F4 只有名字（没坐标、没地址）：按钮照画但灰掉
  if (!rawCoordOf(place) && !has(place.address)) {
    out.disabled = true;
    out.reason = TEXT.nameOnly;
  }

  out.actions = actions;
  out.primary = actions.length ? actions[0] : null;
  out.ride = rideOf(apps, place, c.via || null);
  out.more = out.key === 'none' ? [] : PLACE_KEYS.filter((k) => actions.indexOf(k) < 0 && (k !== 'ride' || Boolean(out.ride)) && (k !== 'driver' || !noCar));
  // F5 给司机看要当地文字，地点还没有当地名
  const wantsDriver = actions.indexOf('driver') >= 0 || out.more.indexOf('driver') >= 0;
  out.driverNeedsLocal = wantsDriver && prof.driverText === 'local' && !has(place.name_local);
  return out;
}

/**
 * 没有条目上下文时的一排（地点页、地图小卡、预订卡、住处卡）：按这趟怎么走 / 城市、地区的习惯。
 *   打车为主：导航、叫车、给司机看；公交、走路为主：导航、叫车；自驾、骑车：导航
 * @param {object} place
 * @param {{ profile?: object, prefer?: 'ride', via?: object|null }} [o] prefer: 'ride' 把叫车放第一个（住处卡第一晚）
 */
export function placeActions(place, o) {
  const opt = o || {};
  const out = blank();
  if (!place) return out;
  const prof = opt.profile || DEFAULT_PROFILE;
  const eff = prof.move || prof.far || 'transit';
  let actions;
  let nav;
  if (eff === 'ride') {
    actions = ['nav', 'ride', 'driver'];
    nav = 'drive';
  } else if (eff === 'self_drive' || eff === 'scooter') {
    actions = ['nav'];
    nav = 'drive';
  } else {
    actions = ['nav', 'ride'];
    nav = eff === 'walk' ? 'walk' : 'transit';
  }
  if (opt.prefer === 'ride' && actions.indexOf('ride') > 0) actions = ['ride'].concat(actions.filter((a) => a !== 'ride'));
  out.key = 'place';
  out.source = 'move';
  out.navMode = NAV_MODE[nav];
  return finish(out, actions, place, prof, opt);
}

// ---------------------------------------------------------------------
// 「怎么去」芯片和写法
// ---------------------------------------------------------------------

/** 「怎么去」那排芯片（改一项 / 加一项里，选了地点才出现） */
export const TRANSPORT_CHIPS = Object.freeze([
  { id: 'auto', label: '自动' },
  { id: 'walk', label: '走路', mode: 'walk' },
  { id: 'ride', label: '打车', mode: 'taxi', modes: ['taxi', 'grab'] },
  { id: 'transit', label: '地铁公交', mode: 'metro', sub: [['metro', '地铁'], ['bus', '公交'], ['train', '火车'], ['hsr', '高铁'], ['ferry', '船'], ['cable_car', '缆车']] },
  { id: 'self_drive', label: '自驾', mode: 'car' },
  { id: 'bike', label: '骑车', mode: 'scooter', sub: [['scooter', '摩托'], ['bicycle', '自行车']] },
  { id: 'transfer', label: '有人接', mode: 'transfer' },
  { id: 'more', label: '更多', sub: [['flight', '飞机'], ['other', '其他']] },
]);

/** mode → 芯片 id */
export function chipOfMode(mode) {
  const m = str(mode);
  if (!m) return 'auto';
  if (m === 'subway') return 'transit';
  for (let i = 0; i < TRANSPORT_CHIPS.length; i++) {
    const ch = TRANSPORT_CHIPS[i];
    if (ch.mode === m || (ch.modes && inList(ch.modes, m))) return ch.id;
    if (ch.sub) for (let k = 0; k < ch.sub.length; k++) if (ch.sub[k][0] === m) return ch.id;
  }
  return 'more';
}

/**
 * 这一项的芯片：导入过的条目不给「自动」（I1：只能在已有的方案里改推荐的那条，或加一种）。
 * @returns {{ chips: Array<{ id, label, mode?, sub? }>, current: string, sub: string|null, autoAllowed: boolean }}
 */
export function transportChoices(item) {
  const tr = transportOf(item);
  const autoAllowed = !tr.imported;
  const chips = TRANSPORT_CHIPS.filter((c) => autoAllowed || c.id !== 'auto');
  const current = tr.mode ? chipOfMode(tr.mode) : autoAllowed ? 'auto' : chipOfMode(tr.modes[0]);
  return { chips, current, sub: tr.mode || null, autoAllowed };
}

/**
 * 选了一个以后 transport_in 写成什么（返回新对象，不改传入的）。
 *   choice：'auto' 或一个 mode（'walk'、'taxi'、'metro'、'transfer'…）
 *   - 原来没有，或只有 App 写的：'auto' → null；其他 → { options: [{ mode, recommended: true, source: 'app' }] }
 *   - 导入过的（有费用、时长、说明）：已有同 mode 的那条设推荐、别的去掉推荐；没有就在最前面加一条；
 *     'auto' 不允许（芯片里也不给），原样返回
 */
export function transportPatch(item, choice) {
  const tr = transportOf(item);
  const cur = item && isObj(item.transport_in) ? item.transport_in : null;
  if (choice !== 'auto' && !inList(MODES, choice)) throw new Error('不认识的交通方式：' + choice);
  if (!tr.imported) {
    if (choice === 'auto') return null;
    return { options: [{ mode: choice, recommended: true, source: 'app' }] };
  }
  if (choice === 'auto') return cur;
  const options = (Array.isArray(cur.options) ? cur.options : []).map((o) => (isObj(o) ? Object.assign({}, o) : o));
  let hit = -1;
  for (let i = 0; i < options.length; i++) if (isObj(options[i]) && options[i].mode === choice) { hit = i; break; }
  for (let i = 0; i < options.length; i++) if (isObj(options[i])) delete options[i].recommended;
  if (hit >= 0) options[hit].recommended = true;
  else options.unshift({ mode: choice, recommended: true, source: 'app' });
  // picked：是在 App 里点过的（比「和上一项同一个地方」优先，见 transportOf 的 appSet）
  const next = Object.assign({}, cur, { options, picked: true });
  delete next.auto;
  return next;
}

/**
 * 「有人接」打给谁（两端同一个顺序）：预订指定的司机（details.driver_contact_id 的联系人）→ 预订里写的司机电话
 * （details.driver_phone）→ 预订里写的电话（details.phone）→ 挂在这个预订上的联系人（contacts.booking_id）。
 * 不退到预订地点的电话（那多半是酒店、机场，不是司机）。不是接送预订 → null。
 * @param {object|null} booking
 * @param {{ getContact?: (id: string) => object|null, contacts?: Iterable<object> }} [o]
 */
export function transferPhone(booking, o) {
  if (!booking || booking.kind !== 'transfer') return null;
  const opt = o || {};
  const d = isObj(booking.details) ? booking.details : {};
  const list = [];
  if (opt.contacts) for (const x of opt.contacts) list.push(x);
  const live = (x) => isObj(x) && !x.deleted_at;
  const byId = (id) => {
    if (!has(id)) return null;
    const hit = typeof opt.getContact === 'function' ? opt.getContact(str(id)) : null;
    if (hit) return hit;
    for (let i = 0; i < list.length; i++) if (live(list[i]) && list[i].id === id) return list[i];
    return null;
  };
  const driver = byId(d.driver_contact_id);
  if (live(driver) && has(driver.phone)) return str(driver.phone).trim();
  if (has(d.driver_phone)) return str(d.driver_phone).trim();
  if (has(d.phone)) return str(d.phone).trim();
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (live(x) && x.booking_id === booking.id && has(x.phone)) return str(x.phone).trim();
  }
  return null;
}
