// =====================================================================
// pages/bookings/view.js：预订页自己的纯逻辑（Node 里能直接测；和弹层共用的在 sheets/booking/model.js）。
//
//   resolveGroupBy(query.by, 本机记住的, 行程阶段)   → 'kind' | 'date'
//   resolveFilter(query.only)                        → 'idea' | 'pending' | 'property' | null
//   pageState(store)                                 → 'loading' | 'ready' | 'error' | 'missing'
//   flatList(groups)                                 → 一维的 [{ type: 'head', group } | { type: 'card', booking, group } | { type: 'stay', stay, group }]
//                                                       （段标题和卡片放在同一层，筛选时卡片能 FLIP 到新位置；stay：按日期时酒店的退房 / 续住那一行）
//   tileSub(list)                                    → 汇总格子下面那行小字：「海边晚餐订位」「南岬海景屋 等 2 个」（多个时用短名）
// =====================================================================

import { FILTERS, GROUP_MODES, defaultGroupBy } from '../../sheets/booking/model.js';

/** 本机记住分组方式的键（lib/storage.js 的 local 会加 rs7885: 前缀） */
export const groupByKey = (tripId) => `bookings-by:${tripId}`;

/** 分组方式：网址 ?by= 优先 → 本机记住的 → 按阶段（进行中按日期，其他按类型） */
export function resolveGroupBy(fromQuery, saved, phase) {
  if (fromQuery && Object.hasOwn(GROUP_MODES, fromQuery)) return fromQuery;
  if (saved && Object.hasOwn(GROUP_MODES, saved)) return saved;
  return defaultGroupBy(phase);
}

/** 筛选：网址 ?only=（不认识的当没有） */
export function resolveFilter(only) {
  return only && Object.hasOwn(FILTERS, only) ? only : null;
}

/**
 * 页面的加载状态（和外壳的占位页同一个口径）：有缓存时直接 ready（先显示缓存，网络回来自动更新）。
 * @param {object|null} store TripStore（useTrip 的返回值；还没确定登录时是 null）
 */
export function pageState(store) {
  if (!store) return 'loading';
  const status = store.status.value || 'idle';
  const trip = store.trip.value || null;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (trip) return 'ready';
  if (status === 'error') return 'error';
  return 'loading';
}

/**
 * 分组 → 一维列表（段标题 + 卡片同一层）。按日期分组时组里有 entries（卡片和酒店的退房 / 续住那一行按时间排好），
 * 酒店那一行是 { type: 'stay', key: 'stay:<预订 id>:<日期>', stay }。
 */
export function flatList(groups) {
  const out = [];
  for (const g of groups) {
    out.push({ type: 'head', key: `h:${g.key}`, group: g });
    const entries = g.entries || g.items.map((b) => ({ type: 'card', booking: b }));
    for (const e of entries) {
      if (e.type === 'stay') out.push({ type: 'stay', key: `stay:${e.stay.booking.id}:${e.stay.date}`, stay: e.stay, group: g });
      else out.push({ type: 'card', key: e.booking.id, booking: e.booking, group: g });
    }
  }
  return out;
}

/** 名字的短叫法：「 · 」前面那一段（「Cielo 屋顶 · 海洋交响曲烧烤套餐」→「Cielo 屋顶」） */
export function shortTitle(title) {
  const t = String(title ?? '').trim();
  return t.split(' · ')[0].trim() || t;
}

/**
 * 汇总格子下面那行小字：一个就写全名，多个写「第一个的短名 等 N 个」（格子很窄，全名会把「等 N 个」挤成省略号），没有返回 null
 */
export function tileSub(list) {
  if (!list?.length) return null;
  const first = String(list[0].title || '').trim() || '（没写名字）';
  return list.length === 1 ? first : `${shortTitle(first)} 等 ${list.length} 个`;
}

/** 本页顶部那一句数量：「13 个预订」「13 个预订 · 1 个已取消」 */
export function countLine(summary) {
  if (!summary?.total) return '还没有预订';
  return [`${summary.live} 个预订`, summary.cancelled ? `${summary.cancelled} 个已取消` : null].filter(Boolean).join(' · ');
}
