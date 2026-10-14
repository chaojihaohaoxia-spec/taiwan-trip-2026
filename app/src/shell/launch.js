// =====================================================================
// shell/launch.js：打开网站时去哪（SPEC §4 末尾；纯函数，Node 里能直接测）。pages/launch/LaunchPage.jsx 用它。
//
//   launchTarget({ entries, lastTripId, at })  → 路由目标 { name, params }
//
// 规则（按顺序，第一条成立的为准）：
//   1. 有进行中的行程（不含归档）→ 那一趟“今天”的 day 页（按行程时区的今天；几趟同时进行取最晚开始的）；
//   2. 有还没开始的行程（不含归档）→ 最近要出发的那一趟的概览；
//   3. 上次打开过的行程还在列表里 → 它的概览；
//   4. 都没有 → 行程列表。
// 旧版快捷方式 ?go=today|ledger 在这之前由 LaunchPage 交给数据层的 resolveGo() 处理。
// 显式打开 #/trips 永远是行程列表，不经过这里。
// =====================================================================

import { tripPhase } from '../lib/datetime.js';

/**
 * @param {{ entries: Array<{ id: string, trip: object }>, lastTripId?: string|null, at?: Date }} o
 * @returns {{ name: string, params?: object }}
 */
export function launchTarget({ entries = [], lastTripId = null, at = new Date() }) {
  const live = entries.filter((e) => e?.trip && e.trip.status !== 'archived');
  const withPhase = live.map((e) => ({ e, ph: tripPhase(e.trip, at) }));

  const ongoing = withPhase
    .filter((x) => x.ph.phase === 'ongoing')
    .sort((a, b) => String(b.e.trip.start_date).localeCompare(String(a.e.trip.start_date)));
  if (ongoing.length) {
    const { e, ph } = ongoing[0];
    return { name: 'day', params: { tripId: e.id, date: ph.today } };
  }

  const upcoming = withPhase
    .filter((x) => x.ph.phase === 'upcoming')
    .sort((a, b) => a.ph.daysUntilStart - b.ph.daysUntilStart || String(a.e.trip.title).localeCompare(String(b.e.trip.title), 'zh-Hans-CN'));
  if (upcoming.length) return { name: 'trip', params: { tripId: upcoming[0].e.id } };

  if (lastTripId && entries.some((e) => e?.id === lastTripId)) return { name: 'trip', params: { tripId: lastTripId } };

  return { name: 'trips' };
}
