// =====================================================================
// pages/settings/model.js：设置页的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//   formatBytes(n)        本机占用：'3.2 MB'
//   storageLabel(s)       syncStatus.storage → { text, tone }
//   syncTone(state)       syncStatus.state → InfoRow 的语气
//   versionParts(v)       '2.0.0+0a1b2c3d4e' → { version: '2.0.0', build: '0a1b2c3d4e' }
//   tripDatesLine(trip)   每趟行程卡里的日期：'1月10日 周日 → 1月13日 周三 · 4 天'
//   moveDaysText(days)    改日期碰到范围外有东西（set_trip_dates 的 need_move）：'1月13日：3 项、住处；1月14日：1 条待办'
//   rangeChange(trip, r)  改日期的说明：'整趟往后挪 2 天' / '多 1 天' / '少 2 天'
//   FONT_LICENSES         两种字体（思源宋体、Instrument Serif）的授权文件（构建时复制到产物的 fonts/licenses/，scripts/build.mjs 的 FONT_LICENSE_FILES）
//   segmentMoves / tripMoveModel   每趟行程卡「这趟怎么走」（几个城市默认不一样时多一个「按城市」）
//   tripContentCounts / deleteTripMessage   删掉这一趟前说清楚会一起删掉什么
// =====================================================================

import { MOVES, MOVE_CHOICES, moveDefault, cityInfo } from '../../rules/dest.js';
import { MOVE_HINT } from '../../sheets/trip-new/moves.js';

/** 字节数 → 'KB / MB / GB'（一位小数，整数不带小数） */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const t = x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString();
  return `${t} ${units[i]}`;
}

/** 本机存储状态（syncStatus.storage：ok / memory / unavailable） */
export function storageLabel(state) {
  if (state === 'memory') return { text: '暂时只存在内存里', tone: 'warning' };
  if (state === 'unavailable') return { text: '暂时读不了，稍后自动重试', tone: 'warning' };
  return { text: '正常', tone: 'neutral' };
}

/** 同步状态的语气 */
export function syncTone(state) {
  if (state === 'error' || state === 'stale') return 'danger';
  if (state === 'offline' || state === 'retrying') return 'warning';
  return 'neutral';
}

/** 版本号拆成「版本 · 构建号」 */
export function versionParts(v) {
  const s = String(v || '').trim();
  if (!s) return { version: '—', build: '' };
  const [version, build = ''] = s.split('+');
  return { version: version || s, build };
}

/** 字体授权文件（相对网站根目录） */
export const FONT_LICENSES = Object.freeze([
  { key: 'noto', name: '思源宋体 Noto Serif SC', use: '标题、栏目名、行程名', file: 'fonts/licenses/Noto-Serif-SC-OFL.txt' },
  { key: 'instrument', name: 'Instrument Serif', use: '几个主数字（倒计时、航班、账本总额）', file: 'fonts/licenses/Instrument-Serif-OFL.txt' },
]);

const zhMd = (d) => `${Number(String(d).slice(5, 7))}月${Number(String(d).slice(8, 10))}日`;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const zhDayW = (d) => `${zhMd(d)} ${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]}`;
const isYmd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 每趟行程卡里的日期一行；没有日期 → '还没定日期' */
export function tripDatesLine(trip) {
  if (!isYmd(trip?.start_date)) return '还没定日期';
  const end = isYmd(trip.end_date) ? trip.end_date : trip.start_date;
  const n = dayDiff(trip.start_date, end) + 1;
  return end === trip.start_date ? `${zhDayW(trip.start_date)} · 1 天` : `${zhDayW(trip.start_date)} → ${zhDayW(end)} · ${n} 天`;
}

/**
 * 改日期时范围外还有东西（rpc.setTripDates 抛的 DataError.days）→ 一句话。
 * @param {Array<{ date: string, items: number, todos: number, tips: number, stay: boolean }>} days
 */
export function moveDaysText(days = []) {
  return days.map((d) => {
    const parts = [];
    if (d.items) parts.push(`${d.items} 项`);
    if (d.todos) parts.push(`${d.todos} 条待办`);
    if (d.tips) parts.push(`${d.tips} 条贴士`);
    if (d.stay) parts.push('住处');
    return `${zhMd(d.date)}：${parts.join('、')}`;
  }).join('；');
}

/** 改日期的说明（日历下面那行）：没变 → ''；整趟挪 → '整趟往后挪 2 天'；长短变了 → '多 1 天' / '少 2 天'（可能同时挪） */
export function rangeChange(trip, range) {
  if (!isYmd(trip?.start_date) || !isYmd(range?.start) || !isYmd(range?.end)) return '';
  const oldEnd = isYmd(trip.end_date) ? trip.end_date : trip.start_date;
  if (range.start === trip.start_date && range.end === oldEnd) return '';
  const delta = dayDiff(oldEnd, range.end) - dayDiff(trip.start_date, range.start);
  const shift = dayDiff(trip.start_date, range.start);
  if (!delta) return `整趟往${shift > 0 ? '后' : '前'}挪 ${Math.abs(shift)} 天`;
  return delta > 0 ? `多 ${delta} 天` : `少 ${-delta} 天`;
}

// ---------------------------------------------------------------------
// 每趟行程卡：这趟怎么走（TripPrefs.jsx）、删掉这一趟
// ---------------------------------------------------------------------

const MOVE_NAMES = Object.fromEntries(MOVE_CHOICES.map((m) => [m.id, m.label]));

/**
 * 每一段默认怎么走（这一段自己写的 → 城市的习惯 → 地区的习惯；不看这趟的 move）。
 * @param {object} trip
 * @param {Iterable<object>} segments segments 行
 * @returns {Array<{ name: string, move: string }>}
 */
export function segmentMoves(trip, segments = []) {
  const dest = trip?.extra?.dest || null;
  const segs = [...segments].filter((s) => s && !s.deleted_at)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.start_date || '').localeCompare(String(b.start_date || '')));
  const out = [];
  for (const s of segs) {
    const sd = s.extra?.dest || {};
    const region = sd.region || dest?.region || null;
    const city = typeof sd.city === 'string' ? sd.city : null;
    if (!region) continue;
    out.push({ name: s.name || cityInfo(city)?.zh || '', move: MOVES.includes(sd.move) ? sd.move : moveDefault(region, city) });
  }
  if (!out.length && dest?.region && Array.isArray(dest.cities)) {
    for (const c of dest.cities) if (typeof c === 'string' && cityInfo(c)) out.push({ name: cityInfo(c).zh, move: moveDefault(dest.region, c) });
  }
  return out;
}

/**
 * 「这趟怎么走」那一排：几个城市默认不一样（台北公交、垦丁骑车）时多一个「按城市」（写 move: null，回到每段按城市）。
 * @param {object} trip
 * @param {Iterable<object>} segments
 * @param {{ pending?: string|null, fallback?: string|null }} [o] pending：点了还没存好的值（undefined = 没有）；fallback：只有一种默认时亮哪个
 * @returns {{ chips: Array<{ id: string|null, label: string }>, current: string|null, byCity: boolean, hint: string }}
 */
export function tripMoveModel(trip, segments = [], { pending, fallback = null } = {}) {
  const segs = segmentMoves(trip, segments);
  const byCity = new Set(segs.map((x) => x.move)).size > 1;
  const saved = MOVES.includes(trip?.extra?.dest?.move) ? trip.extra.dest.move : null;
  const current = pending !== undefined ? pending : saved || (byCity ? null : segs[0]?.move || fallback);
  const chips = (byCity ? [{ id: null, label: '按城市' }] : []).concat(MOVE_CHOICES.map((m) => ({ id: m.id, label: m.label })));
  const hint = current
    ? `${MOVE_HINT[current] || '每天的按钮按这个给'}，单独一项还能改`
    : `按城市：${segs.map((x) => `${x.name}${MOVE_NAMES[x.move] || ''}`).join('、')}`;
  return { chips, current, byCity, hint };
}

/**
 * 删掉这一趟之前要说清楚会一起删掉什么。
 * @param {object} tables store.tables 里的 Map（items / expenses / journal_entries / todos）
 * @returns {{ items: number, expenses: number, journal: number, todos: number }}
 */
export function tripContentCounts(tables = {}) {
  const vals = (k) => {
    const t = tables[k];
    const m = t && typeof t === 'object' && 'value' in t ? t.value : t;
    return m ? [...m.values()] : [];
  };
  const live = (r) => r && !r.deleted_at;
  return {
    items: vals('items').filter((r) => live(r) && (!r.variant || r.variant === 'primary')).length,
    expenses: vals('expenses').filter(live).length,
    journal: vals('journal_entries').filter((j) => String(j.body || '').trim() || (Array.isArray(j.photos) && j.photos.length) || j.mood).length,
    todos: vals('todos').length,
  };
}

/** 确认框里那句话：「12 项安排、8 笔账、3 天日记会一起删掉，两个人那边都会消失，删了找不回来。」 */
export function deleteTripMessage(c = {}) {
  const parts = [];
  if (c.items) parts.push(`${c.items} 项安排`);
  if (c.expenses) parts.push(`${c.expenses} 笔账`);
  if (c.journal) parts.push(`${c.journal} 天日记`);
  if (c.todos) parts.push(`${c.todos} 条待办和清单`);
  const what = parts.length ? `${parts.join('、')}会一起删掉，` : '';
  return `${what}所有成员那边都会消失，删了找不回来。`;
}
