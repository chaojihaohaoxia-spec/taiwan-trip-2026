// =====================================================================
// kit/place-actions.js：动作行（导航 / 叫车 / 给司机看 / 复制地址 / 记一笔 / 打电话 / 值机 / 登机牌 / 航班动态）
// 该显示什么、链接是什么、哪个用不了、为什么（纯函数，Node 里能直接测；界面在 kit/PlaceActions.jsx）。
//
//   placeActionModel(place, { how })                     按规则包算好的一排（rules/how.js 的 howToGet / placeActions；
//                                                        data/dest.js 的 itemHow / placeHow 接好了数据）——每天页、概览「接下来」用
//   placeActionModel(place, { profile })                 没有条目上下文：按目的地档案给一排（placeActions）+ 复制地址
//   placeActionModel(place, { actions: ['nav', 'ride'] }) 点名要哪几个（旧写法；'grab' 是 'ride' 的旧名，照样认）
//   → { actions: [{ key, label, sub, glyph, href, disabled, reason, weak, extra }], more: [同上], primary, note, hint, coords, ride, app }
//     extra：页面加在后面的「打电话」「记一笔」（不是规则给的）
//
// 「⋯」：more 是这一次临时能用的其余动作（下雨了、累了想打车）：只用这一次、不写库。做完了 / 标了没去的条目，
//        动作行收起（actions 空，全部进 more）。
// 叫车（ride）按档案：Grab、Uber 能带目的地跳过去（lib/ride-links.js 的 rideUrl）；别的 App（GO、滴滴、Xanh SM……）
//        网页没有能带目的地的链接：按钮写「叫 GO」、下面小字「复制地址」，点了先复制再提示自己打开 App。
// 导航按档案选地图（lib/maps-links.js 的 navigateUrl：内地高德、韩国 Naver、其余 Google）；出行方式按 how.navMode。
// 下车点（SPEC §10，extra.ride_via / ride_note / no_road / access_note，见 lib/ride-links.js）：叫车、给司机看、复制
// 用下车点；「导航」仍然导到地点本身（步行认路）；开车到不了（no_road）时「叫车」改叫「去缆车站」这类；
// 说明行先放 ride_note（和 access_note），再说缺什么。传 { getPlace } 才解析得到下车点（kit/PlaceActions 自动从数据层拿）。
// =====================================================================

import { navigateUrl, isSafeHttpUrl } from '../lib/maps-links.js';
import { grabBookingUrl, rideUrl, driverCardFields, addressForCopy, rideCoords, rideTarget } from '../lib/ride-links.js';
import { RIDE_APPS } from '../rules/dest-data.js';
import { TEXT as HOW_TEXT, noRoadLabel as ruleNoRoadLabel, placeActions as rulePlaceActions } from '../rules/how.js';

/** 没传 how / profile 时（没有行程上下文的临时地点、旧调用）默认显示的动作 */
export const DEFAULT_ACTIONS = Object.freeze(['nav', 'ride', 'driver', 'copy']);
const ORDER = ['checkin', 'pass', 'status', 'nav', 'ride', 'driver', 'copy', 'call', 'expense'];

export const ACTION_LABELS = Object.freeze({
  nav: '导航', ride: '叫车', driver: '给司机看', copy: '复制地址', call: '打电话', expense: '记一笔',
  checkin: '值机', pass: '登机牌', status: '航班动态',
});
export const ACTION_GLYPHS = Object.freeze({
  nav: 'nav', ride: 'car', driver: 'show', copy: 'copy', call: 'call', expense: 'wallet', checkin: 'plane', pass: 'ticket', status: 'clock',
});

// tel: 链接的规则在 lib/contact-links.js（联系人页、预订详情同一套）；kit 以前就导出 telHref，保持
export { telHref } from '../lib/contact-links.js';
import { telHref } from '../lib/contact-links.js';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
/** 旧动作键 → 新的（grab 改名 ride） */
const keyOf = (k) => (k === 'grab' ? 'ride' : k);
const uniq = (list) => list.filter((k, i) => list.indexOf(k) === i);

/** 没有档案时的叫车 App：Grab（这个项目一开始就是越南行程；有档案时一律按档案） */
const LEGACY_APP = Object.freeze({ id: 'grab', name: 'Grab', label: '叫 Grab', link: 'grab', mini: RIDE_APPS.grab?.mini || null });

/**
 * 旧接口：交通方式 → 主按钮、导航出行方式。新代码用 rules/how.js 的 howToGet（data/dest.js 的 itemHow）。
 * 留着给还没改的调用方（pages/day/model.js 的 rideHint）；主按钮的键已经是新名字 ride。
 * @returns {{ primary: 'nav'|'ride'|null, navMode: string|null }}
 */
export function rideHintOfMode(mode) {
  if (!mode) return { primary: null, navMode: null };
  if (mode === 'walk') return { primary: 'nav', navMode: 'walk' };
  if (mode === 'grab' || mode === 'taxi') return { primary: 'ride', navMode: 'driving' };
  if (mode === 'bicycle') return { primary: 'nav', navMode: 'bicycle' };
  if (mode === 'scooter' || mode === 'car') return { primary: 'nav', navMode: 'driving' };
  if (['metro', 'subway', 'bus', 'train', 'hsr', 'ferry'].includes(mode)) return { primary: 'nav', navMode: mode };
  return { primary: null, navMode: null };
}

/** 旧接口：条目的 transport_in → rideHintOfMode（推荐的那种走法，没有推荐取第一种） */
export function rideHintFor(transportIn) {
  const options = Array.isArray(transportIn?.options) ? transportIn.options : [];
  const o = options.find((x) => x && x.recommended) || options[0] || null;
  return rideHintOfMode(o?.mode || null);
}

/**
 * 开车到不了（no_road）时「叫车」叫什么：下车点是缆车站 → 「去缆车站」，码头 → 「去码头」，其他 →「去下车点」。
 * 规则在 rules/how.js（两端同一套），这里转一手保持旧的导出。
 */
export function noRoadLabel(target) {
  return ruleNoRoadLabel(target);
}

/** 叫车 App（how.ride / 档案的第一个）→ 按钮上的字 */
function rideLabel(app, ride) {
  if (ride.noRoad && ride.via) return noRoadLabel(ride.via);
  if (app.label) return app.label;
  return HOW_TEXT.ride_label(app.name);
}

/** 航班号（预订 details.flight_no，没有用标题） */
function flightText(booking) {
  const no = booking?.details?.flight_no;
  return has(no) ? String(no).replace(/\s+/g, '').toUpperCase() : String(booking?.title || '').trim();
}

/** 网上值机的链接：预订里写了（details.checkin_url / links 里 kind=checkin）就用它；否则搜「航班号 online check-in」 */
export function checkinUrl(booking) {
  if (!booking) return null;
  const d = booking.details || {};
  if (isSafeHttpUrl(d.checkin_url)) return d.checkin_url;
  const link = (Array.isArray(booking.links) ? booking.links : []).find((l) => l && l.kind === 'checkin' && isSafeHttpUrl(l.url));
  if (link) return link.url;
  const airline = has(d.airline) ? String(d.airline).trim() : '';
  const q = [airline || flightText(booking), 'online check-in'].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** 航班动态：搜航班号（Google 直接给起降、登机口、延误） */
export function flightStatusUrl(booking) {
  const no = flightText(booking);
  return no ? `https://www.google.com/search?q=${encodeURIComponent(`${no} flight status`)}` : null;
}

/**
 * @param {object|null} place places 行（或同样字段的对象）
 * @param {{ how?: object, profile?: object, actions?: string[], call?: boolean, expense?: boolean, readOnly?: boolean,
 *           mode?: string, getPlace?: (id: string) => object|null, booking?: object|null, prefer?: 'ride', copy?: boolean }} [o]
 *   how：rules/how.js 的 howToGet / placeActions 结果（给了就按它画：主按钮在第一个、「⋯」是 how.more）；
 *   profile：目的地档案（没有 how 时按 placeActions 给一排，叫车 App、地图按它）；
 *   actions：点名要哪几个（旧写法；不给 how / profile / actions 时是 DEFAULT_ACTIONS，叫车按 Grab）；
 *   call / expense：在后面加「打电话」「记一笔」；readOnly：只读成员（记一笔禁用）；
 *   mode：导航的交通方式（不给按 how.navMode，再不给是开车，SPEC §5.3）；
 *   getPlace：按 id 找同一趟行程的地点（解析下车点 extra.ride_via）；booking：航班（值机、登机牌、航班动态用）；
 *   prefer：'ride' 叫车放第一个、做主按钮（住处卡第一晚）；copy：false 时按档案的那一排不加「复制地址」（放进「⋯」）
 * @returns {{ actions: Array<{ key: string, label: string, sub: string|null, glyph: string, href: string|null, disabled: boolean,
 *             reason: string|null, weak: boolean, extra: boolean }>, more: Array<同上>, primary: string|null, note: string|null, hint: string|null,
 *             coords: boolean, ride: ReturnType<typeof rideTarget>, app: object|null, how: object|null }}
 */
export function placeActionModel(place, {
  how = null, profile = null, actions, call = false, expense = false, readOnly = false, mode, getPlace, booking = null, prefer, copy = true,
} = {}) {
  const p = place || {};
  const prof = how?.profile || profile || null;
  // 航班：data/dest.js 的 itemHow 会把关联的预订一起带回来
  booking = booking || how?.booking || null;
  let keys;
  let moreKeys = [];
  let h = how;
  if (actions) {
    keys = uniq(actions.map(keyOf));
  } else if (h) {
    keys = h.collapsed ? [] : h.actions.slice();
    moreKeys = h.collapsed ? uniq(h.actions.concat(h.more || [])) : (h.more || []).slice();
  } else if (prof) {
    // 没有条目上下文（地点页、预订卡）：按档案的一排 + 复制地址（以前就在这一排）
    h = null;
    keys = null;
  } else {
    keys = DEFAULT_ACTIONS.slice();
  }
  const ride = rideTarget(place, { getPlace });
  if (!keys) {
    h = rulePlaceActions(place, { profile: prof, via: ride.via, prefer });
    keys = h.actions.concat(h.actions.includes('copy') || !copy ? [] : ['copy']);
    moreKeys = (h.more || []).filter((k) => k !== 'copy' || !copy);
  }

  // 叫车 App：how 给的 → 档案的第一个 → 没档案时 Grab（旧行为）
  let app = h?.ride || null;
  if (!app && prof && prof.ride && prof.ride.length) app = { ...prof.ride[0], label: HOW_TEXT.ride_label(prof.ride[0].name) };
  if (!app && !prof && !how) app = LEGACY_APP;
  if (!app) {
    // 这里叫不到车：叫车不画（点名要的也不画），「⋯」里也不给
    keys = keys.filter((k) => k !== 'ride');
    moreKeys = moreKeys.filter((k) => k !== 'ride');
  }
  // 打电话、记一笔是页面加在后面的（不是规则给的）：规则说这一项不用按钮时，它们照样在（灰字那一行的右边）
  const extras = new Set();
  if (call && !keys.includes('call')) { keys.push('call'); extras.add('call'); }
  if (expense && !keys.includes('expense')) { keys.push('expense'); extras.add('expense'); }

  const navMode = mode || h?.navMode || 'driving';
  const byName = Boolean(h?.navByName) || p.coord_precision === 'city';
  const map = prof?.map || 'google';
  const coord = prof?.coord || 'wgs84';
  const o = { getPlace, text: prof?.driverText || 'local' };
  const coords = Boolean(rideCoords(p));
  const hasAddress = has(p.address);
  const hasName = has(p.name) || has(p.name_local) || has(p.name_en);
  const phone = h?.phone || null;
  const weak = Boolean(h?.disabled);

  const build = (key) => {
    const a = {
      key, label: ACTION_LABELS[key] || key, sub: null, glyph: ACTION_GLYPHS[key] || 'more', href: null, disabled: false, reason: null,
      weak: weak && !extras.has(key), extra: extras.has(key),
    };
    switch (key) {
      case 'nav':
        a.href = place ? navigateUrl(p, { map, coord, mode: navMode, byName }) : null;
        if (!a.href) {
          a.disabled = true;
          a.reason = '没有坐标和地址，没法导航';
        }
        break;
      case 'ride':
        a.label = rideLabel(app, ride);
        a.href = place ? rideUrl(app, p, o) : null;
        a.app = app.id;
        if (!a.href) {
          if (place && !app.link && addressForCopy(p, o)) {
            // 网页没法带目的地打开这个 App：先复制地址，再自己打开（按钮下面一行小字说明）
            a.sub = '复制地址';
            a.copyRide = true;
          } else {
            a.disabled = true;
            a.reason = '没有坐标和地址，没法叫车';
          }
        }
        break;
      case 'driver': {
        const f = driverCardFields(p, o);
        if (!has(p.id) || !f.primary) {
          a.disabled = true;
          a.reason = !f.primary ? '没有名字和地址可以给司机看' : '这个地点还没保存，不能全屏显示';
        }
        break;
      }
      case 'copy':
        if (!has(ride.place?.address)) a.label = '复制名字';
        if (!addressForCopy(p, o)) {
          a.disabled = true;
          a.reason = '没有地址可以复制';
        }
        break;
      case 'call':
        // 「有人接」：司机 / 预订联系人的电话；其余是地点的电话
        a.href = telHref(phone || p.phone);
        // 没电话就不显示（打电话本来就是可选的）
        if (!a.href) return null;
        break;
      case 'expense':
        if (readOnly) {
          a.disabled = true;
          a.reason = '只读成员不能记账';
        }
        break;
      case 'checkin':
        a.href = checkinUrl(booking);
        if (!a.href) return null;
        break;
      case 'pass':
        // 登机牌 / 行程单：打开预订（附件在那里）
        if (!booking?.id) return null;
        break;
      case 'status':
        a.href = flightStatusUrl(booking);
        if (!a.href) return null;
        break;
      default:
        break;
    }
    return a;
  };

  // 规则给的顺序（主按钮在第一个）；点名 / 默认的按固定顺序
  const ordered = how || h ? keys : ORDER.filter((k) => keys.includes(k));
  const out = ordered.map(build).filter(Boolean);
  const more = moreKeys.filter((k) => !keys.includes(k)).map(build).filter(Boolean);
  const wanted = new Set(keys.concat(moreKeys));

  // 一句说明（显示在动作行下面）：先说下车提示（ride_note；开车到不了时怎么过去），再说地点本身缺什么
  // （缺什么决定了哪几个按钮用不了），再补上别的原因
  const parts = [];
  if (ride.note) parts.push(ride.note);
  if (ride.noRoad) {
    parts.push(ride.access || '开车到不了');
    if (ride.via && wanted.has('ride')) parts.push(`叫车去「${ride.via.name}」`);
  } else if (ride.via && !ride.note && wanted.has('ride')) {
    parts.push(`叫车、给司机看都去「${ride.via.name}」`);
  }
  const placeKeys = ['nav', 'ride', 'driver', 'copy'];
  const usesPlace = out.some((a) => placeKeys.includes(a.key));
  const routed = keys.includes('nav') || keys.includes('ride');
  if (place !== null || usesPlace) {
    if (!coords && !hasAddress && !hasName) {
      if (usesPlace) parts.push('这个地点没有名字、地址和坐标：导航、叫车、给司机看、复制都用不了，先在地点页补上');
    } else if (!coords && !hasAddress) {
      if (usesPlace) parts.push(routed ? '只有名字：导航和叫车只能按名字搜，可能找错，最好补上地址' : '只有名字，没有地址');
    } else if (!coords && routed) {
      parts.push(p.coord_precision === 'city' ? '坐标只精确到城市：导航和叫车按名字和地址找' : '没有坐标：导航和叫车按名字和地址找');
    }
  }
  for (const a of out) {
    if (!a.disabled || !a.reason) continue;
    // 地点缺东西导致的禁用上面已经说过了
    if (['nav', 'ride', 'copy'].includes(a.key) || (a.key === 'driver' && !driverCardFields(p, o).primary)) continue;
    parts.push(a.reason);
  }
  const note = parts.length ? uniq(parts).join('；') : null;
  return {
    actions: out,
    more,
    // 主按钮：规则按条目算的（how）才有；地点页这种没有条目的，只有 prefer（住处卡第一晚叫车）时才强调
    // 只从规则给的按钮里挑：规则说不用按钮时（同一个地方、做完了），页面加的「记一笔」「打电话」不加粗
    primary: how || (h && prefer) ? out.find((a) => !a.extra)?.key || null : null,
    note,
    hint: h?.hint || null,
    coords,
    ride,
    app,
    how: h || null,
  };
}

/** 旧代码里直接拼 Grab 链接的地方（测试）还在用 */
export { grabBookingUrl };
