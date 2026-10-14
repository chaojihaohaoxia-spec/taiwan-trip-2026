// =====================================================================
// pages/journal/model.js：日记相册页的纯逻辑（Node 里能直接测）。
//
//   VIEWS / parseView(view, tab) / parseLayout(q)  两个视图（按天 / 相册）和相册的列表 ↔ 网格，都记在查询参数里
//                                                 （?view=album；概览页链接过来的 ?tab=photos 也认）
//   tripState(store)                              行程数据到了没：'loading' | 'ready' | 'error' | 'missing'
//   daySections({ days, byDay, members, me, todayDate, drafts })
//                                                 按天视图：每天一节，每个成员一格（有日记 / 还没写），我的在前
//   journalStats(sections)                        「3 篇日记 · 8 张照片」
//   albumGroups({ list, days, author })           相册：按作者筛选后按天分组
//   authorOptions({ members, list, me })          相册顶上的「全部 / Jeremy / Cathy」筛选（带张数）
//   scrollTarget({ query, phase, todayDate, sections })   打开页面先滚到哪一天（?day= 或进行中的今天）
//   entryTime(entry, timeZone, dayDate)           一篇日记的「写于 18:12」（隔天补写的带日子：「写于 昨天 09:10」）
// =====================================================================

import { formatInstant, instantTimeParts } from '../../lib/datetime.js';
import { entryPhotos, groupByDay, filterByAuthor, countByAuthor } from '../../sheets/photo/model.js';
import { tripReady } from '../../sheets/journal/form.js';

/** 两个视图 */
export const VIEWS = Object.freeze([
  { value: 'days', label: '按天' },
  { value: 'album', label: '相册' },
]);

/**
 * 查询参数 → 'days' | 'album'（不认识的当 days）。
 * 正式写法是 ?view=album；行程概览页的「相册」「N 张照片」链接写的是 ?tab=photos（页面阶段各自定的），这里也认
 * （只在没有 ?view= 时看 ?tab=）。
 */
export function parseView(view, tab) {
  if (view === 'album' || view === 'photos') return 'album';
  if (!view && (tab === 'photos' || tab === 'album')) return 'album';
  return 'days';
}

/** 查询参数 ?layout= → 'grid' | 'list'（相册默认网格） */
export function parseLayout(q) {
  return q === 'list' ? 'list' : 'grid';
}

/**
 * 行程数据到了没（和占位页同一套规则：有缓存就先显示缓存，网络回来自动更新）。
 * @param {{ status: { value: string }, trip: { value: object|null }, source: { value: string|null } } | null} store
 */
export function tripState(store) {
  if (!store) return 'loading';
  const status = store.status.value;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (tripReady(store)) return 'ready';
  if (status === 'error' && !store.trip.value) return 'error';
  return 'loading';
}

/**
 * 按天视图的数据：每天一节，每个成员一格。我的那格永远排第一（写的入口最顺手）。
 * @param {{ days: object[], byDay?: Map<string, object[]>, members: object[], me?: string|null, todayDate?: string|null,
 *           drafts?: Set<string> }} o  drafts：本机有草稿的 day id
 * @returns {Array<{ day: object, number: number, isToday: boolean, photoCount: number,
 *                   entries: Array<{ member: object|null, userId: string, entry: object|null, mine: boolean, draft: boolean }> }>}
 */
export function daySections({ days = [], byDay = new Map(), members = [], me = null, todayDate = null, drafts = new Set() } = {}) {
  const people = [...members].sort((a, b) => Number(b.user_id === me) - Number(a.user_id === me));
  return days.map((day, i) => {
    const list = byDay?.get?.(day.id) || [];
    const byUser = new Map(list.map((e) => [e.user_id, e]));
    const entries = people.map((m) => ({
      member: m,
      userId: m.user_id,
      entry: byUser.get(m.user_id) || null,
      mine: m.user_id === me,
      draft: m.user_id === me && drafts.has(day.id),
    }));
    // 已经退出的成员写过的日记也不丢（放在最后）
    for (const e of list) {
      if (!byUser.has(e.user_id) || people.some((m) => m.user_id === e.user_id)) continue;
      entries.push({ member: null, userId: e.user_id, entry: e, mine: e.user_id === me, draft: false });
    }
    // 我还不是成员（理论上不会）：也给我一格，不然没有写的入口
    if (me && !people.some((m) => m.user_id === me)) entries.unshift({ member: null, userId: me, entry: byUser.get(me) || null, mine: true, draft: drafts.has(day.id) });
    const photoCount = list.reduce((n, e) => n + entryPhotos(e, day).length, 0);
    return { day, number: i + 1, isToday: Boolean(todayDate) && day.date === todayDate, photoCount, entries };
  });
}

/** 「3 篇日记 · 8 张照片 · 写了 2 天」 */
export function journalStats(sections) {
  let entries = 0;
  let photos = 0;
  let writtenDays = 0;
  for (const s of sections) {
    const n = s.entries.filter((e) => e.entry).length;
    entries += n;
    photos += s.photoCount;
    if (n) writtenDays += 1;
  }
  return { entries, photos, writtenDays, days: sections.length };
}

/**
 * 相册：按作者筛选后按天分组（只有有照片的天）。
 * @param {{ list: object[], days: object[], author?: string|null }} o
 */
export function albumGroups({ list = [], days = [], author = null } = {}) {
  return groupByDay(filterByAuthor(list, author || null), days);
}

/**
 * 相册顶上的筛选：全部（N）/ 每个成员（各几张）。只有一个人拍过照时也列出来（看得出谁没拍）。
 * @returns {Array<{ value: string, label: string, count: number, member: object|null }>}
 */
export function authorOptions({ members = [], list = [], me = null } = {}) {
  const counts = countByAuthor(list);
  const people = [...members].sort((a, b) => Number(b.user_id === me) - Number(a.user_id === me));
  return [
    { value: '', label: '全部', count: list.length, member: null },
    ...people.map((m) => ({ value: m.user_id, label: m.display_name || '成员', count: counts.get(m.user_id) || 0, member: m })),
  ];
}

/**
 * 打开页面先滚到哪一天：?day=<日期> 指定的那天；否则行程进行中滚到今天；其他情况从头看。
 * 返回 day 的日期（没有就 null）。
 */
export function scrollTarget({ query = {}, phase = null, todayDate = null, sections = [] } = {}) {
  const has = (date) => sections.some((s) => s.day.date === date);
  if (query.day && has(query.day)) return query.day;
  if (phase === 'ongoing' && todayDate && has(todayDate)) return todayDate;
  return null;
}

/**
 * 一篇日记最后改动的时间（按行程时区）：和这一天是同一天就只写钟点 '18:12'；
 * 隔天补写的带上日子 '昨天 09:10' / '1月11日 09:10'（给了 dayDate 才比较）；没有时间戳返回 ''。
 */
export function entryTime(entry, timeZone, dayDate = null) {
  const at = entry?.updated_at || entry?.created_at;
  if (!at) return '';
  if (!dayDate) return formatInstant(at, { timeZone, date: false });
  const parts = instantTimeParts(at, timeZone, dayDate);
  // 年份不写：这一节的日期已经说明了是哪一年
  return parts.shift === 0 ? parts.time : formatInstant(at, { timeZone, relative: true, year: 'never' });
}

/**
 * 写日记 / 拍照打卡的入口默认写哪一天（页面顶上的两个按钮）：进行中 → 今天；
 * 已结束 → 最后一个我还没写的；出发前 → 第一天。返回 days 行（没有分天返回 null）。
 */
export function actionDay({ days = [], phase, todayDate, mine = new Set() } = {}) {
  if (!days.length) return null;
  if (phase === 'ongoing' && todayDate) {
    const today = days.find((d) => d.date === todayDate);
    if (today) return today;
    const past = days.filter((d) => d.date <= todayDate);
    return past[past.length - 1] || days[0];
  }
  if (phase === 'ended') return [...days].reverse().find((d) => !mine.has(d.id)) || days[days.length - 1];
  return days[0];
}
