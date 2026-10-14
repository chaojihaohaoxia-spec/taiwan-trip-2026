// =====================================================================
// kit/place-actions.js：动作行（导航 / 叫 Grab / 给司机看 / 复制地址 / 记一笔 / 打电话）该显示什么、链接是什么、
// 哪个用不了、为什么（纯函数，Node 里能直接测；界面在 kit/PlaceActions.jsx）。
//
//   placeActionModel(place, { actions: ['nav', 'grab', 'driver', 'copy'], call: true, expense: true })
//   → { actions: [{ key, label, glyph, href, disabled, reason }], note }
//
// 链接全部来自 lib/：导航 lib/maps-links.js 的 googleMapsNavigateUrl（有坐标用坐标，没有用名字 + 地址），
// 叫 Grab lib/ride-links.js 的 grabBookingUrl（没坐标只带地址和名字），给司机看的内容 driverCardFields，复制的文字 addressForCopy。
// 下车点（SPEC §10，extra.ride_via / ride_note / no_road / access_note，见 lib/ride-links.js）：叫 Grab、给司机看、复制
// 用下车点；「导航」仍然导到地点本身（步行认路）；开车到不了（no_road）时「叫 Grab」改叫「去缆车站」这类；
// 说明行先放 ride_note（和 access_note），再说缺什么。传 { getPlace } 才解析得到下车点（kit/PlaceActions 自动从数据层拿）。
// =====================================================================

import { googleMapsNavigateUrl } from '../lib/maps-links.js';
import { grabBookingUrl, driverCardFields, addressForCopy, rideCoords, rideTarget } from '../lib/ride-links.js';

/** 默认显示的动作（顺序就是显示顺序；记一笔、打电话是可选的，接在后面） */
export const DEFAULT_ACTIONS = Object.freeze(['nav', 'grab', 'driver', 'copy']);
const ORDER = ['nav', 'grab', 'driver', 'copy', 'call', 'expense'];

export const ACTION_LABELS = Object.freeze({
  nav: '导航', grab: '叫 Grab', driver: '给司机看', copy: '复制地址', call: '打电话', expense: '记一笔',
});
export const ACTION_GLYPHS = Object.freeze({
  nav: 'nav', grab: 'car', driver: 'show', copy: 'copy', call: 'call', expense: 'wallet',
});

// tel: 链接的规则在 lib/contact-links.js（联系人页、预订详情同一套）；kit 以前就导出 telHref，保持
export { telHref } from '../lib/contact-links.js';
import { telHref } from '../lib/contact-links.js';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/**
 * 交通方式 → 动作行里哪个做主按钮、导航用什么出行方式（每天页的条目、概览的「接下来」同一套）：
 *   走路 / 骑车 / 自己开车、坐公交地铁 → 主按钮「导航」；打车（grab / taxi）→ 主按钮「叫 Grab」；不知道 → 没有主按钮。
 * @param {string|null} mode transport_in 推荐方案的 mode
 * @returns {{ primary: 'nav'|'grab'|null, navMode: string|null }}
 */
export function rideHintOfMode(mode) {
  if (!mode) return { primary: null, navMode: null };
  if (mode === 'walk') return { primary: 'nav', navMode: 'walk' };
  if (mode === 'grab' || mode === 'taxi') return { primary: 'grab', navMode: 'driving' };
  if (mode === 'bicycle') return { primary: 'nav', navMode: 'bicycle' };
  if (mode === 'scooter' || mode === 'car') return { primary: 'nav', navMode: 'driving' };
  if (['metro', 'bus', 'train', 'hsr', 'ferry'].includes(mode)) return { primary: 'nav', navMode: mode };
  return { primary: null, navMode: null };
}

/** 条目的 transport_in（docs B5.5）→ rideHintOfMode（推荐的那种走法，没有推荐取第一种） */
export function rideHintFor(transportIn) {
  const options = Array.isArray(transportIn?.options) ? transportIn.options : [];
  const o = options.find((x) => x && x.recommended) || options[0] || null;
  return rideHintOfMode(o?.mode || null);
}

/**
 * 开车到不了（no_road）时「叫 Grab」叫什么：目的地（下车点）是缆车站 → 「去缆车站」，码头 → 「去码头」，其他 →「去下车点」。
 * 按钮窄（手机上一排四个），所以不写下车点的全名；全名在说明行和给司机看的卡片上。
 */
export function noRoadLabel(target) {
  const name = `${target?.name || ''} ${target?.name_en || ''}`;
  if (/缆车|索道|cable/i.test(name)) return '去缆车站';
  if (/码头|渡口|港|pier|port|ferry/i.test(name)) return '去码头';
  return '去下车点';
}

/**
 * @param {object|null} place places 行（或同样字段的对象）
 * @param {{ actions?: string[], call?: boolean, expense?: boolean, readOnly?: boolean, mode?: string,
 *           getPlace?: (id: string) => object|null }} [o]
 *   actions：要显示哪些（默认 DEFAULT_ACTIONS）；call / expense：在后面加「打电话」「记一笔」；
 *   readOnly：只读成员（记一笔禁用）；mode：导航的交通方式（默认 driving，SPEC §5.3；walk / grab / …，见 lib/maps-links.js 的 travelModeFor）；
 *   getPlace：按 id 找同一趟行程的地点（解析下车点 extra.ride_via）
 * @returns {{ actions: Array<{ key: string, label: string, glyph: string, href: string|null, disabled: boolean, reason: string|null }>,
 *             note: string|null, coords: boolean, ride: ReturnType<typeof rideTarget> }}
 */
export function placeActionModel(place, {
  actions = DEFAULT_ACTIONS, call = false, expense = false, readOnly = false, mode = 'driving', getPlace,
} = {}) {
  const wanted = new Set(actions);
  if (call) wanted.add('call');
  if (expense) wanted.add('expense');
  const p = place || {};
  const ride = rideTarget(place, { getPlace });
  const o = { getPlace };
  const coords = Boolean(rideCoords(p));
  const hasAddress = has(p.address);
  const hasName = has(p.name) || has(p.name_local) || has(p.name_en);
  const out = [];

  for (const key of ORDER) {
    if (!wanted.has(key)) continue;
    const a = { key, label: ACTION_LABELS[key], glyph: ACTION_GLYPHS[key], href: null, disabled: false, reason: null };
    switch (key) {
      case 'nav':
        // 只精确到城市的坐标会把人带到市中心：和叫 Grab 一样不用它，改按名字 + 地址找
        a.href = place ? googleMapsNavigateUrl(p.coord_precision === 'city' ? { ...p, lat: null, lng: null } : p, { mode }) : null;
        if (!a.href) {
          a.disabled = true;
          a.reason = '没有坐标和地址，没法导航';
        }
        break;
      case 'grab':
        a.href = place ? grabBookingUrl(p, o) : null;
        // 开车到不了（只能坐缆车 / 船）：叫车去下车点，按钮直接说去哪
        if (ride.noRoad && ride.via) a.label = noRoadLabel(ride.via);
        if (!a.href) {
          a.disabled = true;
          a.reason = '没有坐标和地址，没法叫车';
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
        a.href = telHref(p.phone);
        // 没电话就不显示（打电话本来就是可选的）
        if (!a.href) continue;
        break;
      case 'expense':
        if (readOnly) {
          a.disabled = true;
          a.reason = '只读成员不能记账';
        }
        break;
      default:
        break;
    }
    out.push(a);
  }

  // 一句说明（显示在动作行下面）：先说下车提示（ride_note；开车到不了时怎么过去），再说地点本身缺什么
  // （缺什么决定了哪几个按钮用不了），再补上别的原因
  const parts = [];
  if (ride.note) parts.push(ride.note);
  if (ride.noRoad) {
    parts.push(ride.access || '开车到不了');
    if (ride.via && wanted.has('grab')) parts.push(`叫车去「${ride.via.name}」`);
  } else if (ride.via && !ride.note && wanted.has('grab')) {
    parts.push(`叫车、给司机看都去「${ride.via.name}」`);
  }
  const routed = wanted.has('nav') || wanted.has('grab');
  if (!coords && !hasAddress && !hasName) parts.push('这个地点没有名字、地址和坐标：导航、叫车、给司机看、复制都用不了，先在地点页补上');
  else if (!coords && !hasAddress) parts.push(routed ? '只有名字：导航和叫车只能按名字搜，可能找错，最好补上地址' : '只有名字，没有地址');
  else if (!coords && routed) parts.push(p.coord_precision === 'city' ? '坐标只精确到城市：导航和叫车按名字和地址找' : '没有坐标：导航和叫车按名字和地址找');
  for (const a of out) {
    if (!a.disabled || !a.reason) continue;
    // 地点缺东西导致的禁用上面已经说过了
    if (['nav', 'grab', 'copy'].includes(a.key) || (a.key === 'driver' && !driverCardFields(p, o).primary)) continue;
    parts.push(a.reason);
  }
  const note = parts.length ? parts.join('；') : null;
  return { actions: out, note, coords, ride };
}
