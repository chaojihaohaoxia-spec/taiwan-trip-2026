// =====================================================================
// pages/trips/model.js：行程列表页的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//
//   groupTrips(entries, at)        按阶段分组：进行中 → 接下来（未开始、日期未定）→ 回顾（已结束）→ 已归档；
//                                  组内顺序沿用数据层的 sortTripsForList（trips.sort → 阶段 → 日期）
//   tripCardInfo(entry, at)        一张行程卡片要显示的东西：名称、日期、几天几晚、阶段芯片、封面、只读……
//   todayTarget(entry, at)         进行中的行程「打开今天」去哪（今天的 day 页）
//   normalizeView(v)               列表 / 网格（本机记住的偏好，不认识的值退回列表）
//   tripsSummary(entries, at)      列表上方的一句话：「3 趟旅行 · 1 趟进行中」
// 用的格式和外壳的行程切换面板同一套（shell/format.js），两边写法一致。
// =====================================================================

import { tripPhase } from '../../lib/datetime.js';
import { sortTripsForList } from '../../data/trips.js';
import { phaseChip, dateRangeLabel, nightsOf, parseYmd } from '../../shell/format.js';

/** 分组：顺序固定，空组不出现 */
export const TRIP_GROUPS = Object.freeze([
  { key: 'ongoing', title: '进行中' },
  { key: 'upcoming', title: '接下来' },
  { key: 'ended', title: '回顾' },
  { key: 'archived', title: '已归档' },
]);

const GROUP_OF_PHASE = Object.freeze({ ongoing: 'ongoing', upcoming: 'upcoming', undated: 'upcoming', ended: 'ended' });

/**
 * 按阶段分组（每组内保持 sortTripsForList 的顺序）。
 * @param {Array<{ id: string, trip: object, role: string }>} entries
 * @param {Date} at
 * @returns {Array<{ key: string, title: string, entries: object[] }>}
 */
export function groupTrips(entries, at = new Date()) {
  const sorted = sortTripsForList((entries || []).filter((e) => e && e.trip), at);
  const buckets = new Map(TRIP_GROUPS.map((g) => [g.key, []]));
  for (const e of sorted) {
    const key = e.trip.status === 'archived' ? 'archived' : GROUP_OF_PHASE[tripPhase(e.trip, at).phase] || 'upcoming';
    buckets.get(key).push(e);
  }
  // 「接下来」里有日期的按出发先后，日期未定的排在最后
  const upcoming = buckets.get('upcoming');
  upcoming.sort((a, b) => {
    const da = a.trip.start_date || '9999';
    const db = b.trip.start_date || '9999';
    return da === db ? 0 : da < db ? -1 : 1;
  });
  return TRIP_GROUPS.filter((g) => buckets.get(g.key).length).map((g) => ({ ...g, entries: buckets.get(g.key) }));
}

/** 角色的中文（只读成员在卡片上标出来；创建者、可编辑不用标） */
export const ROLE_LABELS = Object.freeze({ owner: '创建者', editor: '可编辑', viewer: '只读' });

/** 几天几晚：'4 天 3 晚' / '1 天'；没日期返回 '' */
export function lengthLabel(trip) {
  const n = nightsOf(trip);
  if (n === null) return '';
  return n ? `${n + 1} 天 ${n} 晚` : '1 天';
}

/**
 * 一张行程卡片的显示信息。
 * @param {{ id: string, trip: object, role?: string }} entry
 * @param {Date} at
 */
export function tripCardInfo(entry, at = new Date()) {
  const trip = entry?.trip || {};
  const phase = tripPhase(trip, at);
  const archived = trip.status === 'archived';
  const chip = archived ? { tone: 'neutral', text: '已归档' } : phaseChip(phase);
  const thisYear = parseYmd(phase.today)?.y ?? null;
  const dates = trip.start_date ? dateRangeLabel(trip.start_date, trip.end_date || trip.start_date, { thisYear }) : '日期未定';
  const length = lengthLabel(trip);
  const cover = trip.cover && typeof trip.cover === 'object' ? trip.cover : {};
  const title = String(trip.title || '').trim() || '未命名行程';
  const readOnly = entry?.role === 'viewer';
  const label = [title, dates, length, chip.text, readOnly ? '只读' : ''].filter(Boolean).join('，');
  return {
    id: entry?.id || trip.id,
    title,
    subtitle: String(trip.subtitle || '').trim(),
    dates,
    length,
    phase: archived ? 'archived' : phase.phase,
    chip,
    emoji: cover.emoji || trip.cover_emoji || '',
    imagePath: cover.image_path || null,
    role: entry?.role || null,
    readOnly,
    label,
  };
}

/** 进行中的行程：今天的 day 页；不是进行中返回 null */
export function todayTarget(entry, at = new Date()) {
  if (!entry?.trip) return null;
  const p = tripPhase(entry.trip, at);
  if (p.phase !== 'ongoing') return null;
  return { name: 'day', params: { tripId: entry.id, date: p.today } };
}

/**
 * 列表最上面的「今天」入口：有进行中的行程（几趟同时进行取最晚开始的那趟，和启动页一致）→
 * { to, title, phrase: '第 2 天 · 共 4 天' }；没有返回 null。
 */
export function todayInfo(entries, at = new Date()) {
  const live = (entries || []).filter((e) => e?.trip && e.trip.status !== 'archived')
    .map((e) => ({ e, p: tripPhase(e.trip, at) }))
    .filter((x) => x.p.phase === 'ongoing')
    .sort((a, b) => String(b.e.trip.start_date).localeCompare(String(a.e.trip.start_date)));
  if (!live.length) return null;
  const { e, p } = live[0];
  const last = p.totalDays > 1 && p.dayNumber === p.totalDays;
  return {
    to: todayTarget(e, at),
    tripId: e.id,
    title: String(e.trip.title || '').trim() || '未命名行程',
    phrase: last ? `最后一天 · 共 ${p.totalDays} 天` : `第 ${p.dayNumber} 天 · 共 ${p.totalDays} 天`,
  };
}

/** 列表 / 网格：本机记住的偏好 */
export const VIEW_KEY = 'trips:view';
export function normalizeView(v) {
  return v === 'grid' ? 'grid' : 'list';
}

/** 列表上方的一句话：「3 趟旅行 · 1 趟进行中」/「2 趟旅行 · 下一趟 5 天后出发」 */
export function tripsSummary(entries, at = new Date()) {
  const live = (entries || []).filter((e) => e?.trip && e.trip.status !== 'archived');
  const total = (entries || []).filter((e) => e?.trip).length;
  if (!total) return '';
  const phases = live.map((e) => tripPhase(e.trip, at));
  const ongoing = phases.filter((p) => p.phase === 'ongoing').length;
  const parts = [`${total} 趟旅行`];
  if (ongoing) parts.push(`${ongoing} 趟进行中`);
  else {
    const next = phases.filter((p) => p.phase === 'upcoming').sort((a, b) => a.daysUntilStart - b.daysUntilStart)[0];
    if (next) parts.push(next.daysUntilStart === 1 ? '下一趟明天出发' : `下一趟 ${next.daysUntilStart} 天后出发`);
  }
  return parts.join(' · ');
}

/** 旧版快捷方式 ?go= 的中文名 */
export const GO_LABELS = Object.freeze({ today: '今日行程', ledger: '账本' });
