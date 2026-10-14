// =====================================================================
// kit/kinds.js：各种“种类”的中文名和图标（纯数据 + 纯函数，Node 里能直接测）。
//
//   kindLabel('item', 'night_market')   → '夜市'
//   kindGlyph('booking', 'insurance')   → 'shield'（kit/glyphs.js 里的图形名）
//   kindGlyph('expense', '餐饮')        → 'bowl'
//
// type：item（条目 items.kind）/ place（places.kind）/ booking（bookings.kind）/ contact（contacts.category）/
//       expense（expenses.category）/ transport（交通方式 transportMode）/ todo（清单 todos.list）/ tip（tips.kind）。
// 取值和 data/schema.js 的 ENUMS 一致（单元测试逐个核对：每个枚举都有中文名和图标）。
// 不认识的 kind 退回这一类的“其他”。
// =====================================================================

export const KIND_LABELS = Object.freeze({
  item: Object.freeze({
    flight: '航班', transport: '交通', hotel: '住宿', food: '吃饭', cafe: '咖啡', sight: '景点', beach: '海滩',
    activity: '活动', spa: '按摩', shopping: '购物', night_market: '夜市', sunset: '日落', walk_route: '散步路线',
    free: '自由活动', other: '其他',
  }),
  place: Object.freeze({
    sight: '景点', food: '餐厅', cafe: '咖啡馆', bar: '酒吧', hotel: '住宿', hub: '交通站点', shop: '商店',
    market: '市场', beach: '海滩', activity: '活动', other: '其他',
  }),
  booking: Object.freeze({
    flight: '机票', hotel: '酒店', activity: '活动', transfer: '接送', restaurant: '餐厅', ticket: '门票',
    car_rental: '租车', insurance: '保险', other: '其他',
  }),
  contact: Object.freeze({
    hotel: '酒店', transport: '交通', activity: '活动', restaurant: '餐厅', airline: '航空公司', platform: '预订平台',
    guide: '向导', emergency: '紧急', other: '其他',
  }),
  expense: Object.freeze({ 餐饮: '餐饮', 交通: '交通', 住宿: '住宿', 购物: '购物', 门票: '门票', 活动: '活动', 其他: '其他' }),
  transport: Object.freeze({
    walk: '步行', metro: '地铁', bus: '巴士', taxi: '出租车', grab: 'Grab', scooter: '摩托', bicycle: '自行车',
    ferry: '渡轮', train: '火车', hsr: '高铁', flight: '飞机', car: '自驾', cable_car: '缆车', other: '其他',
  }),
  todo: Object.freeze({ confirm: '待确认', packing: '打包', todo: '待办', buy: '要买' }),
  tip: Object.freeze({ warning: '防坑', tip: '小贴士', template: '消息模板', phrase: '常用语', info: '实用信息' }),
});

/** 种类 → 图形名（kit/glyphs.js）。线条风格照样稿 04-body.html 的 <symbol>，缺的在 glyphs.js 里按同样的笔法补画 */
export const KIND_GLYPHS = Object.freeze({
  item: Object.freeze({
    flight: 'plane', transport: 'car', hotel: 'bed', food: 'bowl', cafe: 'cup', sight: 'landmark', beach: 'wave',
    activity: 'flag', spa: 'spa', shopping: 'bag', night_market: 'lantern', sunset: 'sunset', walk_route: 'route',
    free: 'sparkle', other: 'pin',
  }),
  place: Object.freeze({
    sight: 'landmark', food: 'bowl', cafe: 'cup', bar: 'glass', hotel: 'bed', hub: 'train', shop: 'bag',
    market: 'stall', beach: 'wave', activity: 'flag', other: 'pin',
  }),
  booking: Object.freeze({
    flight: 'plane', hotel: 'bed', activity: 'flag', transfer: 'car', restaurant: 'bowl', ticket: 'ticket',
    car_rental: 'car', insurance: 'shield', other: 'ledger',
  }),
  contact: Object.freeze({
    hotel: 'bed', transport: 'car', activity: 'flag', restaurant: 'bowl', airline: 'plane', platform: 'phone',
    guide: 'user', emergency: 'siren', other: 'user',
  }),
  expense: Object.freeze({ 餐饮: 'bowl', 交通: 'car', 住宿: 'bed', 购物: 'bag', 门票: 'ticket', 活动: 'flag', 其他: 'wallet' }),
  transport: Object.freeze({
    walk: 'walk', metro: 'train', bus: 'bus', taxi: 'car', grab: 'car', scooter: 'scooter', bicycle: 'bike',
    ferry: 'boat', train: 'train', hsr: 'train', flight: 'plane', car: 'car', cable_car: 'cable', other: 'route',
  }),
  todo: Object.freeze({ confirm: 'check-circle', packing: 'suitcase', todo: 'checklist', buy: 'bag' }),
  tip: Object.freeze({ warning: 'alert', tip: 'bulb', template: 'message', phrase: 'languages', info: 'info' }),
});

/** 每一类不认识的 kind 退回哪个 */
const FALLBACK = Object.freeze({
  item: 'other', place: 'other', booking: 'other', contact: 'other', expense: '其他', transport: 'other', todo: 'todo', tip: 'tip',
});

export const KIND_TYPES = Object.freeze(Object.keys(KIND_LABELS));

/** 规范 kind：不认识的退回这一类的“其他” */
export function normalizeKind(type, kind) {
  const table = KIND_LABELS[type];
  if (!table) return null;
  return Object.hasOwn(table, kind) ? kind : FALLBACK[type];
}

/** 种类的中文名：kindLabel('place', 'hub') → '交通站点' */
export function kindLabel(type, kind) {
  const k = normalizeKind(type, kind);
  return k ? KIND_LABELS[type][k] : '';
}

/** 种类的图形名：kindGlyph('item', 'cafe') → 'cup'；type 不认识返回 'pin' */
export function kindGlyph(type, kind) {
  const k = normalizeKind(type, kind);
  return k ? KIND_GLYPHS[type][k] : 'pin';
}
