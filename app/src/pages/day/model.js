// =====================================================================
// pages/day/model.js：每天页的纯逻辑（Node 里能直接测，单元测试 test/unit/page-day.test.js）。
//
// 页面组件只管“画”，这里管“算”：时间显示（含别的时区的当地时间）、“现在”在时间轴的哪里、
// 怎么过去 / 费用估算 / 路线卡 / 步行路线的显示数据、条目关联的贴士和待办、备选换成主方案要改哪些行、
// 新条目的排序值、左右滑动换天的判定。
// 只依赖 lib/（日期、金额、地图链接）和 kit/kinds.js（种类的中文名和图标），不碰 DOM。
// =====================================================================

import { parseTime, formatTime, minutesToTime, formatDuration, zonedToInstant, formatDate, weekdayName, formatInstant, timeZoneLabel } from '../../lib/datetime.js';
import { formatMoney, formatMoneyRange, normalizeCurrency } from '../../lib/money.js';
import { googleMapsRouteUrls, isSafeHttpUrl } from '../../lib/maps-links.js';
import { markdownToText } from '../../lib/markdown.js';
import { kindLabel, kindGlyph } from '../../kit/kinds.js';
import { rideHintOfMode } from '../../kit/place-actions.js';

// ---------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------

/** days.pace */
export const PACE_LABELS = Object.freeze({ relaxed: '轻松', medium: '适中', packed: '紧凑' });
/** days.planning_status（已规划不显示） */
export const PLANNING_LABELS = Object.freeze({ partial: '部分规划', tbd: '待规划' });
/** items.variant */
export const VARIANT_LABELS = Object.freeze({ primary: '主方案', backup: '备选', rain: '雨天方案' });
/** 日出日落（days.extra.sun 的键 → 中文名），按一天里的先后 */
export const SUN_LABELS = Object.freeze([['sunrise', '日出', 'sun'], ['golden_hour', '金色时刻', 'sparkle'], ['sunset', '日落', 'sunset'], ['blue_hour', '蓝调', 'sparkle']]);

/** 条目种类 → 记一笔的分类（预填） */
const EXPENSE_CATEGORY_OF_KIND = Object.freeze({
  food: '餐饮', cafe: '餐饮', night_market: '餐饮',
  flight: '交通', transport: '交通',
  hotel: '住宿',
  shopping: '购物',
  sight: '门票',
  activity: '活动', spa: '活动', beach: '活动', sunset: '活动', walk_route: '活动', free: '活动',
});

/** 条目种类 → 记一笔的分类（中文，sheets/args.js 的 categoryToCode 认得）；不认识返回 null */
export function expenseCategoryFor(kind) {
  return EXPENSE_CATEGORY_OF_KIND[kind] || null;
}

// ---------------------------------------------------------------------
// 时间
// ---------------------------------------------------------------------

/**
 * 一段 Markdown 正文的第一行纯文字（收起时的一行摘要）：先去掉 **、链接语法、列表符号，再取第一行非空的
 * （「标准：\*\*评价里有…」「- 机场快线末几班…」这种直接截第一行会露出源码，10-14 现场走查 P2-1）。
 */
export function firstLine(text) {
  if (!text) return '';
  const plain = markdownToText(String(text));
  const line = plain.split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.replace(/^(?:•|\d+\.)\s+/, '');
}

/**
 * 当天提醒里待办的那行小字：截止时间（按人那一刻所在的时区，和行程时区不同注明）+ 备注第一行。
 *   「今天 16:45 前截止（香港时间） · 在官网填」
 * @param {object} todo
 * @param {{ at: Date, timeZone: string, displayZone?: string, hereZone?: string }} o
 */
export function todoHint(todo, { at, timeZone, displayZone, hereZone } = {}) {
  const parts = [];
  if (todo?.due_at && Number.isFinite(Date.parse(todo.due_at))) {
    const zone = displayZone || timeZone;
    const when = formatInstant(todo.due_at, { timeZone: zone, relative: true, year: 'never', at });
    const tag = displayZone && (displayZone !== timeZone || (hereZone && hereZone !== displayZone)) ? `（${timeZoneLabel(displayZone)}时间）` : '';
    const over = at && Date.parse(todo.due_at) <= at.getTime();
    parts.push(over && !todo.done ? `${when} 截止${tag} · 已过期` : `${when} 前截止${tag}`);
  }
  const note = firstLine(todo?.note || todo?.notes || '');
  if (note) parts.push(note);
  return parts.join(' · ') || null;
}

/** 'HH:MM(:SS)' → 'HH:MM'；空 / 无效 → '' */
export const hhmm = (t) => formatTime(t);

/**
 * 条目左边那一栏的时间：挪到了 kit/item-clock.js（概览的「现在 / 接下来」、时间轴缩略也用同一份，10-14 现场走查 P0-1）。
 * 这里转出去，页面和单元测试照旧从 model.js 引。航班条目要传 booking（起飞按起飞地、落地按到达地显示）。
 */
export { itemClock, itemTimeText, flightLeg } from '../../kit/item-clock.js';

/**
 * 条目的开始 / 结束（这一天当地零点起第几分钟）；结束比开始早表示跨午夜（+24 小时）。没有开始钟点返回 null。
 * 和 data/selectors.js 的 itemSpan 一样（页面不直接引数据层的内部函数）。
 */
export function itemSpan(item) {
  const start = parseTime(item?.start_time);
  if (start === null) return null;
  let end = parseTime(item?.end_time);
  if (end !== null && end < start) end += 24 * 60;
  return { start, end };
}

/**
 * 某一天（当地日期 + 时区）此刻是当天零点之后第几分钟（可以是负数 / 超过 1440：还没到这一天 / 已经过了）。
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} timeZone
 * @param {Date} at
 */
export function minutesIntoDay(date, timeZone, at) {
  const start = zonedToInstant(date, '00:00', timeZone);
  if (!start || !at) return null;
  return (at.getTime() - start.getTime()) / 60000;
}

/**
 * “现在”在时间轴的哪里（只看主方案）。
 *   current：正在进行的条目（计划中、有开始钟点、现在落在它的时段里；没写结束时间的进行到下一条开始，最多 2 小时）；
 *   progress：current 走了多少（0–1）；
 *   lineBefore：没有进行中的条目时，“现在”指示线画在 primary[lineBefore] 前面（= primary.length 时画在最后）；
 *   next：下一条（开始钟点在现在之后的第一条计划中条目）、minutesUntilNext。
 * 不在这一天里（minutes < 0 或已经过了这一天的最后一条很久）时 visible = false。
 * @param {object[]} primary 当天主方案（页面显示的顺序）
 * @param {number|null} minutes minutesIntoDay 的结果
 */
export function nowOnTimeline(primary, minutes) {
  const none = { visible: false, currentId: null, progress: 0, lineBefore: null, nextId: null, minutesUntilNext: null };
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return none;
  const timed = primary
    .map((item, index) => ({ item, index, span: itemSpan(item) }))
    .filter((x) => x.span);
  if (!timed.length) return none;
  const byStart = [...timed].sort((a, b) => a.span.start - b.span.start);
  const lastEnd = Math.max(...byStart.map((x, k) => x.span.end ?? Math.min(x.span.start + 120, byStart[k + 1]?.span.start ?? x.span.start + 120)));
  // 过了这一天（当地 24 点以后，而且最后一条也结束了）：不画
  if (minutes >= 24 * 60 && minutes >= lastEnd) return none;

  let current = null;
  let progress = 0;
  for (let k = 0; k < byStart.length; k++) {
    const { item, span } = byStart[k];
    if (item.status !== 'planned') continue;
    const following = byStart[k + 1]?.span.start;
    const end = span.end ?? Math.min(span.start + 120, following ?? span.start + 120);
    if (span.start <= minutes && minutes < end) {
      current = item;
      progress = end > span.start ? (minutes - span.start) / (end - span.start) : 0;
      break;
    }
  }
  const nextHit = byStart.find((x) => x.span.start > minutes && x.item.status === 'planned') || null;
  // 指示线：按页面上的顺序，第一个开始钟点在现在之后的条目前面
  let lineBefore = null;
  if (!current) {
    const after = timed.find((x) => x.span.start > minutes);
    lineBefore = after ? after.index : primary.length;
  }
  return {
    visible: true,
    currentId: current?.id ?? null,
    progress: Math.min(1, Math.max(0, progress)),
    lineBefore,
    nextId: nextHit?.item.id ?? null,
    minutesUntilNext: nextHit ? Math.round(nextHit.span.start - minutes) : null,
  };
}

/**
 * 「现在」指示线画在时间轴的第几条前面（= primary.length 时画在最后）；有进行中的条目时画在它前面。不画返回 -1。
 * @param {object[]} primary
 * @param {ReturnType<typeof nowOnTimeline>} info
 */
export function nowLineIndex(primary, info) {
  if (!info?.visible) return -1;
  if (info.currentId) {
    const i = primary.findIndex((x) => x.id === info.currentId);
    return i === -1 ? -1 : i;
  }
  return info.lineBefore ?? -1;
}

/**
 * 收起时标题下面那一行小字：怎么过去的一句话 + 地点名；都没有就写备注第一行；连备注也没有就空着
 * （以前写种类「其他」「吃饭」——左边已经有种类图标，再写一遍是噪音，加条目评审 6）。
 * @param {object} item
 * @param {object|null} place
 * @param {{ summary?: string }|null} transport transportView 的结果
 */
export function collapsedSubtitle(item, place, transport, fuzzy = null) {
  const parts = [];
  // 时间栏放不下的模糊时间（「取完行李后」）写在副标题最前面
  if (fuzzy) parts.push(fuzzy);
  if (transport?.summary) parts.push(transport.summary);
  const name = place?.name || null;
  if (name) parts.push(name);
  if (parts.length === (fuzzy ? 1 : 0) && item?.time_label && item?.start_time) parts.push(item.time_label);
  if (parts.length === (fuzzy ? 1 : 0)) {
    const note = firstLine(item?.description);
    if (note) parts.push(note.length > 40 ? `${note.slice(0, 39)}…` : note);
  }
  return parts.join(' · ');
}

/**
 * 收起时右边只放一个标签（位置有限）：进行中 > 已完成 / 已跳过 > 预订待确认 > 有备选。
 * @returns {null | { kind: 'current'|'status'|'booking'|'alts', label: string, tone: string }}
 */
export function collapsedMeta(item, { current = false, booking = null, altCount = 0 } = {}) {
  if (current) return { kind: 'current', label: '进行中', tone: 'accent' };
  if (item?.status === 'done') return { kind: 'status', label: '已完成', tone: 'success' };
  if (item?.status === 'skipped') return { kind: 'status', label: '已跳过', tone: 'neutral' };
  if (booking && (booking.status === 'pending' || booking.status === 'idea')) {
    return { kind: 'booking', label: booking.status === 'pending' ? '待确认' : '还没订', tone: booking.status === 'pending' ? 'warning' : 'neutral' };
  }
  if (altCount > 0) return { kind: 'alts', label: altCount > 1 ? `${altCount} 个备选` : '有备选', tone: 'info' };
  return null;
}

/** 标记完成 / 跳过时「实际时间」的默认值：这一天的时区里现在几点（不在这一天就留空） */
export function defaultActualTime(date, timeZone, at) {
  const m = minutesIntoDay(date, timeZone, at);
  if (m === null || m < 0 || m >= 24 * 60) return '';
  return minutesToTime(m);
}

/** “下一条 35 分钟后” / “下一条 1 小时 20 分后”；没有下一条返回 null */
export function untilNextText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  if (minutes < 1) return '下一条马上开始';
  return `下一条 ${formatDuration(minutes, { style: 'short' })}后`;
}

/** 当前条目还剩多久：“还剩 25 分钟”；结束时间不明（推算的）也照算 */
export function remainingText(item, minutes, nextStart = null) {
  const span = itemSpan(item);
  if (!span || minutes === null) return null;
  const end = span.end ?? Math.min(span.start + 120, nextStart ?? span.start + 120);
  const left = Math.round(end - minutes);
  if (left <= 0) return null;
  return `还剩 ${formatDuration(left, { style: 'short' })}`;
}

/**
 * 眉标：「D2 · 1月11日 周一」（+「· 今天 / 明天 / 昨天」）
 * @param {{ dayNumber: number|null, date: string, timeZone?: string, at?: Date }} o
 */
export function dayEyebrow({ dayNumber, date, timeZone, at }) {
  const d = formatDate(date, { timeZone, at, year: 'auto' });
  const rel = formatDate(date, { timeZone, at, relative: true });
  const relWord = ['今天', '明天', '昨天'].includes(rel) ? rel : null;
  return [dayNumber ? `D${dayNumber}` : null, d, relWord].filter(Boolean).join(' · ');
}

/** 「1月11日 周一」→ 短一点的「1/11 周一」（滑动提示用） */
export function shortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return '';
  return `${Number(m[2])}/${Number(m[3])} ${weekdayName(date)}`;
}

// ---------------------------------------------------------------------
// 怎么过去（transport_in，docs B5.5）、费用估算（cost_estimate，B5.6）
// ---------------------------------------------------------------------

function moneyOf(cost, opts = {}) {
  if (!cost || !Number.isFinite(Number(cost.amount)) || !cost.currency) return null;
  const cur = normalizeCurrency(cost.currency);
  const readable = cur === 'VND';
  if (Number(cost.amount) === 0 && (cost.amount_max === null || cost.amount_max === undefined || Number(cost.amount_max) === 0)) return '免费';
  return formatMoneyRange(Number(cost.amount), cost.amount_max ?? null, cur, { readable, ...opts });
}

/**
 * 怎么过去：一句话总结 + 每种走法。
 * @returns {null | { summary: string, mode: string, glyph: string, options: Array<{ key, mode, modeLabel, glyph, label, duration, distance, cost, recommended, note, mapsUrl }>, primary: object }}
 */
export function transportView(t) {
  const options = Array.isArray(t?.options) ? t.options : [];
  if (!options.length && !t?.summary) return null;
  const list = options.map((o, i) => {
    const per = o.cost?.per === 'person' ? '每人 ' : '';
    const cost = o.cost ? moneyOf(o.cost) : null;
    return {
      key: `${o.mode}-${i}`,
      mode: o.mode,
      modeLabel: kindLabel('transport', o.mode),
      glyph: kindGlyph('transport', o.mode),
      label: o.label || null,
      duration: Number.isFinite(Number(o.duration_min)) && o.duration_min !== null ? `约 ${formatDuration(Number(o.duration_min), { style: 'short' })}` : null,
      distance: Number.isFinite(Number(o.distance_km)) && o.distance_km !== null ? `${Number(o.distance_km) < 1 ? `${Math.round(Number(o.distance_km) * 1000)} 米` : `${Number(Number(o.distance_km).toFixed(1))} km`}` : null,
      cost: cost ? `${per}${cost}` : null,
      recommended: Boolean(o.recommended),
      note: o.note || null,
      mapsUrl: o.maps_url && isSafeHttpUrl(o.maps_url) ? o.maps_url : null,
    };
  });
  const primary = list.find((o) => o.recommended) || list[0] || null;
  const summary = t?.summary || (primary ? [primary.modeLabel, primary.duration].filter(Boolean).join(' ') : '');
  return { summary, mode: primary?.mode || null, glyph: primary?.glyph || 'route', options: list, primary };
}

/** 交通方式 → 动作行里哪个做主按钮、导航用什么出行方式（规则在 kit/place-actions.js 的 rideHintOfMode，概览也用它） */
export function rideHint(transport) {
  return rideHintOfMode(transport?.primary?.mode || null);
}

/**
 * 费用估算：「每人 45 万越南盾（约 HK$136）」+（每人时）「2 人约 90 万越南盾（约 HK$273）」+ 备注。
 * @param {object} cost items.cost_estimate
 * @param {number} [partySize]
 * @returns {null | { text: string, total: string|null, note: string|null, free: boolean }}
 */
export function costView(cost, partySize = 2) {
  const text = moneyOf(cost);
  if (!text) return null;
  const per = cost.per === 'person';
  const free = text === '免费';
  let total = null;
  if (per && !free && partySize > 1) {
    total = `${partySize} 人约 ${moneyOf({ ...cost, amount: Number(cost.amount) * partySize, amount_max: cost.amount_max === null || cost.amount_max === undefined ? null : Number(cost.amount_max) * partySize })}`;
  }
  return { text: per && !free ? `每人 ${text}` : text, total, note: cost.note || null, free };
}

/** 一条金额（单个数字，比如预订价格）：formatMoney 的薄包装，越南盾用“万” */
export function moneyText(amount, currency) {
  if (amount === null || amount === undefined || !currency) return null;
  const cur = normalizeCurrency(currency);
  return formatMoney(Number(amount), cur, { readable: cur === 'VND' });
}

// ---------------------------------------------------------------------
// 路线卡（days.route_plan，B5.3）、步行路线（items.stops，B5.8）
// ---------------------------------------------------------------------

/** 一个路线点 → 地图链接用的点（有地点用地点，没有用自带坐标，再没有用名字） */
function stopPoint(stop, getPlace) {
  const place = stop.place_id ? getPlace?.(stop.place_id) : null;
  if (place) return place;
  if (Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)) && stop.lat !== null && stop.lng !== null) return { lat: stop.lat, lng: stop.lng, name: stop.name };
  return stop.name || null;
}

/** 路线卡的指标最多显示几个；值的宽度（textWidthUnits）不超过 METRIC_TILE_MAX_CHARS 个汉字宽、而且不多于 4 个时才做成大数字的格子 */
export const METRIC_MAX = 6;
export const METRIC_TILE_MAX_CHARS = 7;

/** 一段字大约几个汉字宽：中日韩和全角字符算 1，拉丁字母、数字、空格、标点算 0.5（「约 1.5 小时」= 5.5，「约 2 小时 50 分」= 7.5） */
export function textWidthUnits(text) {
  let n = 0;
  for (const ch of String(text ?? '')) {
    n += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 1 : 0.5;
  }
  return n;
}

/**
 * 路线卡的指标怎么摆：'tiles'（每个一格、Instrument Serif 大数字：「31 km」「约 1.5 小时」「4 个」）
 * 还是 'rows'（一行一个、左标签右值：真实行程里的「约 2 小时 50 分」「12–20 万越南盾（约 HK$85–106）」这种长值，
 * 塞进格子里会折成三四行）。
 * @param {Array<{ label: string, value: string }>} metrics
 */
export function metricsLayout(metrics) {
  if (!metrics.length) return 'tiles';
  if (metrics.length > 4) return 'rows';
  return metrics.every((m) => textWidthUnits(m.value) <= METRIC_TILE_MAX_CHARS) ? 'tiles' : 'rows';
}

/**
 * 路线卡要显示什么。
 * @param {object} plan days.route_plan
 * @param {(id: string) => object|undefined} getPlace
 * @returns {null | { title, subtitle, mode, modeLabel, glyph, metrics, metricsLayout: 'tiles'|'rows', stops: Array<{ key, name, note, place }>, links: Array<{ url, label }> }}
 */
export function routePlanView(plan, getPlace) {
  if (!plan || typeof plan !== 'object' || !plan.title) return null;
  const stops = (Array.isArray(plan.stops) ? plan.stops : []).map((s, i) => ({
    key: `${i}-${s.name}`,
    name: s.name || getPlace?.(s.place_id)?.name || `第 ${i + 1} 站`,
    note: s.note || null,
    place: s.place_id ? getPlace?.(s.place_id) || null : null,
  }));
  let links = [];
  if (plan.maps_url && isSafeHttpUrl(plan.maps_url)) {
    links = [{ url: plan.maps_url, label: plan.button_label || '打开路线' }];
  } else {
    const points = (plan.stops || []).map((s) => stopPoint(s, getPlace));
    links = googleMapsRouteUrls(points, { mode: plan.mode || undefined }).map((u) => ({
      url: u.url,
      label: u.parts > 1 ? `${plan.button_label || '打开路线'} · ${u.label}` : plan.button_label || '打开路线',
    }));
  }
  const metrics = (Array.isArray(plan.metrics) ? plan.metrics : [])
    .filter((m) => m && m.label && m.value !== undefined && m.value !== null && m.value !== '')
    .slice(0, METRIC_MAX)
    .map((m) => ({ label: String(m.label), value: String(m.value) }));
  return {
    title: plan.title,
    subtitle: plan.subtitle || null,
    mode: plan.mode || null,
    modeLabel: plan.mode ? kindLabel('transport', plan.mode) : null,
    glyph: plan.mode ? kindGlyph('transport', plan.mode) : 'route',
    metrics,
    metricsLayout: metricsLayout(metrics),
    stops,
    links,
  };
}

/**
 * 步行路线：每一站 + Google 地图多点路线（手机上途经点最多 3 个，超过自动分成几段）。
 * @returns {null | { stops: Array<{ key, name, subtitle, note, place }>, links: Array<{ url, label }> }}
 */
export function walkRouteView(item, getPlace) {
  const raw = Array.isArray(item?.stops) ? item.stops : [];
  if (!raw.length) return null;
  const stops = raw.map((s, i) => ({
    key: `${i}-${s.name}`,
    name: s.name || getPlace?.(s.place_id)?.name || `第 ${i + 1} 站`,
    subtitle: s.subtitle || null,
    note: s.note || null,
    place: s.place_id ? getPlace?.(s.place_id) || null : null,
  }));
  const links = googleMapsRouteUrls(raw.map((s) => stopPoint(s, getPlace)), { mode: 'walk' }).map((u) => ({
    url: u.url,
    label: u.parts > 1 ? `第 ${u.part} 段（第 ${u.from + 1}–${u.to + 1} 站）` : '用 Google 地图走这条路线',
  }));
  return { stops, links };
}

// ---------------------------------------------------------------------
// 当天的说明（days.extra）
// ---------------------------------------------------------------------

/**
 * 日出、金色时刻、日落、蓝调：days.extra.sun 优先；没有就用天气预报的日出日落。
 * @returns {Array<{ key, label, glyph, time }>}
 */
export function sunTimes(day, weather = null) {
  const sun = day?.extra?.sun && typeof day.extra.sun === 'object' ? day.extra.sun : {};
  const out = [];
  for (const [key, label, glyph] of SUN_LABELS) {
    const raw = sun[key] ?? (key === 'sunrise' ? weather?.sunrise : key === 'sunset' ? weather?.sunset : null);
    // '17:41' / '17:41:00' → '17:41'；区间（'17:58–18:07'）这类原样
    const time = typeof raw === 'string' && raw.trim() ? formatTime(raw) || raw.trim() : null;
    if (time) out.push({ key, label, glyph, time });
  }
  return out;
}

/**
 * 当天的文字说明：天气提示（extra.weather_note，或 weather_ 开头的键，例如某天出的预报）、提醒（note）、节假日（holiday）。
 * @returns {{ weather: string|null, notes: Array<{ key, label, text }> }}
 */
export function dayNotes(day) {
  const extra = day?.extra && typeof day.extra === 'object' ? day.extra : {};
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  let weather = str(extra.weather_note);
  if (!weather) {
    const k = Object.keys(extra).filter((key) => /^weather_/.test(key) && str(extra[key])).sort().pop();
    weather = k ? str(extra[k]) : null;
  }
  const notes = [];
  if (str(extra.holiday)) notes.push({ key: 'holiday', label: '节假日', text: str(extra.holiday) });
  if (str(extra.note)) notes.push({ key: 'note', label: '提醒', text: str(extra.note) });
  return { weather, notes };
}

/** lib/services/weather.js 的图标名 → kit/glyphs.js 的图形（九种天气 kit 都有，和概览页同一套） */
export const WEATHER_GLYPHS = Object.freeze({
  sun: 'sun', 'cloud-sun': 'cloud-sun', cloud: 'cloud', fog: 'fog', drizzle: 'drizzle', rain: 'rain', showers: 'showers', snow: 'snow', storm: 'storm',
});

// ---------------------------------------------------------------------
// 关联的贴士、待办、预订
// ---------------------------------------------------------------------

const TIP_ORDER = { warning: 0, tip: 1, info: 2, template: 3, phrase: 4 };
const tipSort = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (TIP_ORDER[a.kind] ?? 9) - (TIP_ORDER[b.kind] ?? 9) || (a.sort ?? 0) - (b.sort ?? 0);

/** 和这一条有关的贴士：同一个地点或同一个预订 */
export function tipsForItem(tips, item) {
  if (!item) return [];
  return (tips || [])
    .filter((t) => (item.place_id && t.place_id === item.place_id) || (item.booking_id && t.booking_id === item.booking_id))
    .sort(tipSort);
}

/** 这一天自己的贴士（day_id 是这一天，而且没被当天哪一条的地点 / 预订认领走） */
export function tipsForDay(tips, day, items) {
  if (!day) return [];
  const places = new Set(items.map((i) => i.place_id).filter(Boolean));
  const bookings = new Set(items.map((i) => i.booking_id).filter(Boolean));
  return (tips || [])
    .filter((t) => t.day_id === day.id && !(t.place_id && places.has(t.place_id)) && !(t.booking_id && bookings.has(t.booking_id)))
    .sort(tipSort);
}

const todoSort = (a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.sort ?? 0) - (b.sort ?? 0);

/** 和这一条有关的待办：item_id 是它；或者没写 item_id、预订是它的预订 */
export function todosForItem(todos, item) {
  if (!item) return [];
  return (todos || [])
    .filter((t) => t.item_id === item.id || (!t.item_id && item.booking_id && t.booking_id === item.booking_id))
    .sort(todoSort);
}

/** 这一天自己的待办（day_id 是这一天，而且不属于当天的哪一条） */
export function todosForDay(todos, day, items) {
  if (!day) return [];
  const ids = new Set(items.map((i) => i.id));
  const bookings = new Set(items.map((i) => i.booking_id).filter(Boolean));
  return (todos || [])
    .filter((t) => t.day_id === day.id && !(t.item_id && ids.has(t.item_id)) && !(!t.item_id && t.booking_id && bookings.has(t.booking_id)))
    .sort(todoSort);
}

/** 链接：条目自己的 + 地点的（去重；只放行 http(s)） */
export function linksFor(item, place) {
  const seen = new Set();
  const out = [];
  for (const l of [...(item?.links || []), ...(place?.links || [])]) {
    if (!l || !l.url || !isSafeHttpUrl(l.url) || seen.has(l.url)) continue;
    seen.add(l.url);
    out.push({ url: l.url, label: l.label || '链接', kind: l.kind || 'other' });
  }
  return out;
}

// ---------------------------------------------------------------------
// 排序值（items.sort_key：同一天内先按它、再按开始钟点）
// ---------------------------------------------------------------------

const sk = (it) => (Number.isFinite(Number(it?.sort_key)) ? Number(it.sort_key) : null);

/** a、b 之间的排序值（任一边没有时往外推 10） */
export function sortKeyBetween(a, b) {
  const x = a === null || a === undefined ? null : Number(a);
  const y = b === null || b === undefined ? null : Number(b);
  if (x === null && y === null) return 10;
  if (x === null) return y - 10;
  if (y === null) return x + 10;
  if (x === y) return x; // 一样时让开始钟点决定先后（compareItems 第二关键字）
  return x + (y - x) / 2;
}

/**
 * 有开始钟点的新条目（或改了钟点的条目）排在哪：按钟点插到当天主方案里（前后都有钟点的条目之间），
 * 返回新的 sort_key；没有钟点返回 null（调用方另外决定，例如排到最后）。
 * @param {object[]} primary 当天主方案（已排序）
 * @param {string} startTime
 * @param {string|null} [excludeId] 正在编辑的那一条自己
 */
export function sortKeyForTime(primary, startTime, excludeId = null) {
  const m = parseTime(startTime);
  if (m === null) return null;
  const list = primary.filter((x) => x.id !== excludeId);
  if (!list.length) return 10;
  // 第一条开始钟点比它晚的条目前面
  const at = list.findIndex((x) => {
    const s = parseTime(x.start_time);
    return s !== null && s > m;
  });
  if (at === -1) return sortKeyBetween(sk(list[list.length - 1]), null);
  return sortKeyBetween(at === 0 ? null : sk(list[at - 1]), sk(list[at]));
}

/** 插在 afterId 那一条后面的排序值（找不到就排到最后） */
export function sortKeyAfter(list, afterId) {
  const i = list.findIndex((x) => x.id === afterId);
  if (i === -1) return sortKeyBetween(sk(list[list.length - 1]), null);
  return sortKeyBetween(sk(list[i]), sk(list[i + 1]) ?? null);
}

/** 改了钟点以后，这一条现在的位置还对不对（前后有钟点的邻居都不比它晚 / 早） */
export function inTimeOrder(primary, item) {
  const m = parseTime(item?.start_time);
  if (m === null) return true;
  const i = primary.findIndex((x) => x.id === item.id);
  if (i === -1) return false;
  for (let k = i - 1; k >= 0; k--) {
    const s = parseTime(primary[k].start_time);
    if (s !== null) {
      if (s > m) return false;
      break;
    }
  }
  for (let k = i + 1; k < primary.length; k++) {
    const s = parseTime(primary[k].start_time);
    if (s !== null) return s >= m;
  }
  return true;
}

// ---------------------------------------------------------------------
// 备选 → 主方案
// ---------------------------------------------------------------------

/**
 * 把一条备选 / 雨天方案换成主方案，要改哪些行（按这个顺序 update），以及撤销时怎么改回去。
 *   挂在主方案下的：它接替那条主方案的位置（排序值；自己没写钟点时接过主方案的钟点），
 *     原来的主方案变成它下面的备选（同样的方案种类），原来的其他备选也挂到它下面；
 *   当天通用的：直接变成主方案，按自己的钟点插进时间轴（没钟点排到最后）。
 * @param {object} alt 要换上来的条目
 * @param {{ primary: object[], alternatives: Map<string, object[]> }} plan 当天的 dayPlan
 * @returns {{ updates: Array<{ id, patch }>, undo: Array<{ id, patch }>, replaced: object|null }}
 */
export function promotePlan(alt, plan) {
  const parent = alt.parent_item_id ? plan.primary.find((p) => p.id === alt.parent_item_id) || null : null;
  if (parent) {
    const siblings = (plan.alternatives.get(parent.id) || []).filter((x) => x.id !== alt.id);
    const takeTime = !alt.start_time && parent.start_time;
    const altPatch = { variant: 'primary', parent_item_id: null, sort_key: parent.sort_key };
    if (takeTime) Object.assign(altPatch, { start_time: parent.start_time, end_time: parent.end_time ?? null });
    const updates = [
      { id: parent.id, patch: { variant: alt.variant === 'rain' ? 'rain' : 'backup', parent_item_id: alt.id } },
      { id: alt.id, patch: altPatch },
      ...siblings.map((s) => ({ id: s.id, patch: { parent_item_id: alt.id } })),
    ];
    const altUndo = { variant: alt.variant, parent_item_id: parent.id, sort_key: alt.sort_key };
    if (takeTime) Object.assign(altUndo, { start_time: alt.start_time ?? null, end_time: alt.end_time ?? null });
    const undo = [
      { id: parent.id, patch: { variant: 'primary', parent_item_id: null } },
      { id: alt.id, patch: altUndo },
      ...siblings.map((s) => ({ id: s.id, patch: { parent_item_id: parent.id } })),
    ];
    return { updates, undo, replaced: parent };
  }
  const key = sortKeyForTime(plan.primary, alt.start_time) ?? sortKeyBetween(sk(plan.primary[plan.primary.length - 1]), null);
  return {
    updates: [{ id: alt.id, patch: { variant: 'primary', parent_item_id: null, sort_key: key } }],
    undo: [{ id: alt.id, patch: { variant: alt.variant, parent_item_id: alt.parent_item_id ?? null, sort_key: alt.sort_key } }],
    replaced: null,
  };
}

/** 备选切换上的名字：「备选」「备选 2」「雨天方案」「雨天方案 2」 */
export function altLabels(alts) {
  const count = { backup: 0, rain: 0 };
  const total = { backup: alts.filter((a) => a.variant !== 'rain').length, rain: alts.filter((a) => a.variant === 'rain').length };
  return alts.map((a) => {
    const v = a.variant === 'rain' ? 'rain' : 'backup';
    count[v] += 1;
    const base = VARIANT_LABELS[v];
    return total[v] > 1 ? `${base} ${count[v]}` : base;
  });
}

// ---------------------------------------------------------------------
// 左右滑动换天
// ---------------------------------------------------------------------

/**
 * 前一天 / 后一天（分段条的顺序：概览、D1、D2…）。
 * @param {string[]} dates 行程的日期
 * @param {string} date 当前这一天
 * @returns {{ prev: null | { name: 'trip'|'day', date?: string, label: string }, next: … }}
 */
export function neighborDays(dates, date) {
  const i = dates.indexOf(date);
  if (i === -1) return { prev: null, next: null };
  const prev = i === 0 ? { name: 'trip', label: '概览' } : { name: 'day', date: dates[i - 1], label: `D${i}` };
  const next = i < dates.length - 1 ? { name: 'day', date: dates[i + 1], label: `D${i + 2}` } : null;
  return { prev, next };
}

/** 屏幕边缘多宽以内开始的手势不接（iOS Safari 的边缘返回 / 前进手势） */
export const SWIPE_EDGE = 24;
/** 松手时拖过多远算换天（px，和屏幕宽的 22% 取小） */
export const SWIPE_COMMIT = 96;
/** 甩得多快算换天（px/s） */
export const SWIPE_FLICK = 520;

/** 手指从这里按下，能不能开始换天手势 */
export function canStartSwipe(x, width, edge = SWIPE_EDGE) {
  return Number.isFinite(x) && x > edge && x < width - edge;
}

/**
 * 跟手的位移：那个方向有下一天时 1:1 跟到屏幕宽的 35%，再往外有阻尼；没有下一天时只给一点橡皮筋。
 * @param {number} dx 手指横向位移（往左为负 = 去后一天）
 */
export function swipeOffset(dx, { width, hasPrev, hasNext }) {
  const can = dx < 0 ? hasNext : hasPrev;
  const sign = Math.sign(dx);
  const d = Math.abs(dx);
  if (!can) return sign * (28 * (1 - 1 / (d / 120 + 1)));
  const free = width * 0.35;
  if (d <= free) return dx;
  const over = d - free;
  return sign * (free + (over * 0.4) / (1 + over / width));
}

/**
 * 松手：去哪一天。'next'（往左滑）/ 'prev'（往右滑）/ null（弹回）。
 * @param {{ dx: number, vx: number, width: number, hasPrev: boolean, hasNext: boolean }} o
 */
export function swipeDecision({ dx, vx = 0, width, hasPrev, hasNext }) {
  const dir = dx < 0 ? 'next' : 'prev';
  if ((dir === 'next' && !hasNext) || (dir === 'prev' && !hasPrev) || dx === 0) return null;
  const far = Math.abs(dx) >= Math.min(SWIPE_COMMIT, width * 0.22);
  const flick = Math.abs(vx) >= SWIPE_FLICK && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) >= 24;
  // 往回甩（速度方向和位移相反）：取消
  const back = Math.abs(vx) >= SWIPE_FLICK && Math.sign(vx) !== Math.sign(dx);
  if (back) return null;
  return far || flick ? dir : null;
}
