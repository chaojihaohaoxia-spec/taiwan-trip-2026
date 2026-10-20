// =====================================================================
// sheets/item/form-model.js：「加一项 / 改一项」表单的纯逻辑（Node 里能直接测：test/unit/page-day.test.js）。
//
//   initialForm({ mode, item, fields, defaultDate, days, ctx })   网址参数 / 要编辑的那一行 → 表单初始值
//   validateForm(form)                                       中文问题或 null
//   formPatch(initial, form)                                 只留真正改了的字段（编辑时提交用）
//   toRow(form)                                              表单 → items 行的字段（新建时提交用）
//   resolveSortKey({ form, item, primary, afterId })         新条目 / 改了钟点以后排在哪（items.sort_key）
//   dayOptions(days, { timeZone, at }) / parentOptions(primary, excludeId)   下拉选项
//   dayChips(days, todayId)                                  「哪天」一排字签：今天写「今天」，其余「11日」，最后是备选池
//   filterPlaces(places, query, limit, { first })            选地点：按名字 / 当地语名 / 英文名 / 地址搜；空着时 first 里的（这一天用到的、当晚住的）在前
//   defaultDayId / autoDone / nowAnchor / kindForPlace / needsPlace / moreSummary   「加一项」的默认值（和小程序 components/item-edit/form.js 同一套规则）
//   TIME_LABEL_PRESETS、KIND_OPTIONS、VARIANT_OPTIONS、STATUS_OPTIONS、ITEM_KIND_OF_PLACE
// 排序值的算法（sortKeyForTime / sortKeyAfter / inTimeOrder）和每天页共用：pages/day/model.js。
//
// 「加一项」的默认值（ctx = { todayId, nowTime }：行程里的今天是哪一天、那一天当地现在几点）：
//   哪天：网址给的 / 当前页面那一天；都没有 → 行程里的今天；还没出发 → 第一天；已经回来 → 最后一天
//   几点：今天 → 现在；别的天 → 空着
//   做完了：今天、几点不晚于「现在 + 5 分钟」→ 默认打开（记一件刚做完的事，比如取钱）；人自己拨过就不再跟着变
//   排在哪：有钟点按钟点插；今天又没写钟点 → 插在「现在」那一条后面（nowAnchor）；都没有 → 排到最后
//   类型：选了行程里的地点就按地点给（ITEM_KIND_OF_PLACE，和小程序同表），其余「其他」；人在「更多设置」里选过就不改
// =====================================================================

import { formatDate, formatTime, parseTime } from '../../lib/datetime.js';
import { KIND_LABELS } from '../../kit/kinds.js';
import { sortKeyForTime, sortKeyAfter, sortKeyBetween, inTimeOrder } from '../../pages/day/model.js';

/** 备选池（没排进哪天）在「哪天」下拉里的值 */
export const POOL = 'pool';

/** 条目种类（和 data/schema.js 的 ENUMS['items.kind'] 一致；kit/kinds.js 已按它登记中文名） */
export const KIND_OPTIONS = Object.freeze(Object.keys(KIND_LABELS.item).map((value) => ({ value, label: KIND_LABELS.item[value] })));

export const VARIANT_OPTIONS = Object.freeze([
  { value: 'primary', label: '主方案' },
  { value: 'backup', label: '备选' },
  { value: 'rain', label: '雨天方案' },
]);

/** 改一项时的状态（items.status） */
export const STATUS_OPTIONS = Object.freeze([
  { value: 'planned', label: '计划中' },
  { value: 'done', label: '做完了' },
  { value: 'skipped', label: '跳过了' },
]);

/** 地点的种类 → 条目的种类（和小程序 utils/trip-core.js 的 ITEM_KIND_OF_PLACE 同一张表） */
export const ITEM_KIND_OF_PLACE = Object.freeze({
  sight: 'sight', food: 'food', cafe: 'cafe', bar: 'food', hotel: 'hotel', hub: 'transport', shop: 'shopping', market: 'shopping',
  beach: 'beach', activity: 'activity', other: 'other',
});

/** 几点不晚于「现在 + 5 分钟」算刚做完的事 */
export const SOON_MIN = 5;

/** 本来就该有个地点的种类（没关联地点时才提醒去补；取钱、买水这种「其他」不提醒） */
const PLACE_KINDS = new Set(['transport', 'hotel', 'food', 'cafe', 'sight', 'beach', 'activity', 'spa', 'shopping', 'night_market', 'sunset', 'walk_route']);

/** 模糊时间的快捷选项（items.time_label） */
export const TIME_LABEL_PRESETS = Object.freeze(['上午', '中午', '午饭后', '下午', '傍晚', '日落前', '晚上', '全天']);

const str = (v) => (v === null || v === undefined ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s ? s : null;
};

/**
 * 表单初始值。
 * @param {{ mode: 'new'|'edit', item?: object|null, fields?: Record<string, string>, defaultDate?: string|null, days?: object[],
 *           ctx?: { todayId?: string|null, nowTime?: string|null, today?: string|null } }} o
 *   fields：网址参数（date / after / parent / variant / kind）；defaultDate：没给日期时用当前页面的那一天；
 *   ctx：行程里的今天（todayId）、那一天当地的现在（nowTime 'HH:MM'）、今天的日期（today，判断出发前 / 回来后）
 */
export function initialForm({ mode, item = null, fields = {}, defaultDate = null, days = [], ctx = {} } = {}) {
  if (mode === 'edit' && item) {
    return {
      title: str(item.title),
      kind: item.kind || 'other',
      start_time: formatTime(item.start_time),
      end_time: formatTime(item.end_time),
      time_label: str(item.time_label),
      place_id: item.place_id || null,
      newPlace: '',
      description: str(item.description),
      variant: item.variant || 'primary',
      parent_item_id: item.parent_item_id || null,
      day: item.day_id || POOL,
      status: item.status || 'planned',
    };
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const date = fields.date || defaultDate;
  const day = date ? (byDate.has(date) ? byDate.get(date).id : POOL) : defaultDayId(days, ctx);
  const variant = ['primary', 'backup', 'rain'].includes(fields.variant) ? fields.variant : (fields.parent ? 'backup' : 'primary');
  const start = day !== POOL && day === ctx.todayId && variant === 'primary' ? str(ctx.nowTime) : '';
  const form = {
    title: '',
    kind: fields.kind && KIND_LABELS.item[fields.kind] ? fields.kind : 'other',
    start_time: start,
    end_time: '',
    time_label: '',
    place_id: null,
    newPlace: '',
    description: '',
    variant,
    parent_item_id: variant === 'primary' ? null : fields.parent || null,
    day,
    status: 'planned',
  };
  form.status = autoDone(form, ctx) ? 'done' : 'planned';
  return form;
}

/** 加的时候默认哪天：行程里的今天；还没出发 → 第一天；已经回来 → 最后一天；没有天 → 备选池 */
export function defaultDayId(days = [], { todayId = null, today = null } = {}) {
  if (!days.length) return POOL;
  if (todayId && days.some((d) => d.id === todayId)) return todayId;
  if (today && days[0].date && today < days[0].date) return days[0].id;
  if (today) return days[days.length - 1].id;
  return days[0].id;
}

/** 「做完了」该不该默认打开：今天、主方案、几点不晚于现在 + 5 分钟 */
export function autoDone(form, { todayId = null, nowTime = null } = {}) {
  if (!form || !todayId || form.day !== todayId || (form.variant && form.variant !== 'primary') || !form.start_time) return false;
  const s = parseTime(form.start_time);
  const n = parseTime(nowTime);
  return s !== null && n !== null && s <= n + SOON_MIN;
}

/**
 * 今天、没写钟点时插在哪一条后面：进行中的那一条；没有就是「现在」那条线前面的那一条；线在最前面 → null（排到最前，见 resolveSortKey 的 atStart）。
 * @param {object[]} primary 当天主方案（页面显示的顺序）
 * @param {{ visible: boolean, currentId: string|null, lineBefore: number|null }} info pages/day/model.js 的 nowOnTimeline
 * @returns {{ afterId: string|null, atStart: boolean } | null} null = 不在这一天（照常排到最后）
 */
export function nowAnchor(primary, info) {
  if (!info?.visible) return null;
  if (info.currentId) return { afterId: info.currentId, atStart: false };
  const i = info.lineBefore;
  if (i === null || i === undefined) return null;
  if (i <= 0) return { afterId: null, atStart: primary.length > 0 };
  return { afterId: primary[Math.min(i, primary.length) - 1]?.id || null, atStart: false };
}

/** 选了地点以后条目的种类（地点种类没登记 → null，不改） */
export function kindForPlace(place) {
  return place && ITEM_KIND_OF_PLACE[place.kind] ? ITEM_KIND_OF_PLACE[place.kind] : null;
}

/** 这种条目本来就该有地点吗（没有地点时提不提醒去补） */
export function needsPlace(kind) {
  return PLACE_KINDS.has(kind);
}

/** 「更多设置」收起时那一行的摘要：类型 · 模糊时间 · 方案（默认值不写） */
export function moreSummary(form) {
  const parts = [];
  if (form.kind && form.kind !== 'other') parts.push(KIND_LABELS.item[form.kind] || form.kind);
  if (str(form.time_label).trim()) parts.push(str(form.time_label).trim());
  if (form.variant && form.variant !== 'primary') parts.push(VARIANT_OPTIONS.find((v) => v.value === form.variant)?.label || form.variant);
  return parts.join(' · ');
}

/** 表单有什么问题（中文）；没问题返回 null */
export function validateForm(form) {
  if (!str(form.title).trim()) return '请写一个标题';
  if (str(form.title).trim().length > 200) return '标题太长了（最多 200 字）';
  if (form.start_time && parseTime(form.start_time) === null) return '开始时间不对';
  if (form.end_time && parseTime(form.end_time) === null) return '结束时间不对';
  if (form.end_time && !form.start_time) return '只填了结束时间：先填开始时间';
  if (form.variant === 'primary' && form.parent_item_id) return '主方案不能挂在别的条目下面';
  if (form.variant !== 'primary' && form.parent_item_id && form.day === POOL) return '备选池里的条目不能挂在哪条主方案下';
  return null;
}

/** 表单 → items 行的字段（新建） */
export function toRow(form) {
  return {
    title: str(form.title).trim(),
    kind: form.kind || 'other',
    start_time: trimOrNull(form.start_time),
    end_time: form.start_time ? trimOrNull(form.end_time) : null,
    time_label: trimOrNull(form.time_label),
    place_id: form.place_id || null,
    description: trimOrNull(form.description),
    variant: form.variant || 'primary',
    parent_item_id: form.variant === 'primary' ? null : form.parent_item_id || null,
    day_id: form.day === POOL ? null : form.day || null,
    status: ['planned', 'done', 'skipped'].includes(form.status) ? form.status : 'planned',
  };
}

/**
 * 「做完了」的实际时间（和时间轴上的「完成」一样写 actual_time）：写了几点就用几点，否则用那一天当地的现在（不在那一天就 null）。
 * @param {{ start_time?: string|null }} row toRow 的结果
 * @param {string} [fallback] defaultActualTime(...) 的结果（'HH:MM' 或 ''）
 */
export function actualTimeFor(row, fallback = '') {
  return row?.start_time || fallback || null;
}

/** 提示条里的标题：超过 max 个字截短加「…」（提示条一行放得下） */
export function shortTitle(title, max) {
  const a = Array.from(String(title || ''));
  return a.length > max ? `${a.slice(0, max - 1).join('')}…` : a.join('');
}

/** 编辑：只留真正改了的字段（和原来那一行比；钟点按 'HH:MM' 比） */
export function formPatch(initial, form) {
  const a = toRow(initial);
  const b = toRow(form);
  const patch = {};
  for (const k of Object.keys(b)) {
    if ((a[k] ?? null) !== (b[k] ?? null)) patch[k] = b[k];
  }
  // 改回「计划中」：实际时间、实际情况一起清掉（和时间轴上的「恢复为计划中」一样）
  if (patch.status === 'planned') {
    patch.actual_time = null;
    patch.actual_note = null;
  }
  return patch;
}

/**
 * 新条目 / 改了钟点的条目排在哪（items.sort_key）。
 *   新建：有开始钟点 → 按钟点插进主方案；没钟点但有 after（网址带的，或今天「现在」那一条）→ 插在那条后面；
 *         atStart（今天、「现在」在第一条前面）→ 排到最前；都没有 → 排到最后。
 *   编辑：换了天、或钟点变了而且现在的位置不对 → 按钟点重排（没钟点放最后）；否则不改（返回 undefined）。
 * 备选 / 雨天方案（挂在主方案下的）跟着主方案走，排序值不重要：新建时给 10、编辑时不改。
 * @param {{ form: object, item?: object|null, primary: object[], afterId?: string|null, atStart?: boolean }} o primary：目标那一天的主方案（已排序）
 * @returns {number|undefined}
 */
export function resolveSortKey({ form, item = null, primary = [], afterId = null, atStart = false }) {
  const row = toRow(form);
  if (row.variant !== 'primary' && row.parent_item_id) return item ? undefined : 10;
  if (!item) {
    if (row.start_time) return sortKeyForTime(primary, row.start_time) ?? sortKeyBetween(lastKey(primary), null);
    if (afterId) return sortKeyAfter(primary, afterId);
    if (atStart && primary.length) return sortKeyBetween(null, Number(primary[0].sort_key) || 0);
    return sortKeyBetween(lastKey(primary), null);
  }
  const movedDay = (item.day_id || null) !== row.day_id;
  const timeChanged = formatTime(item.start_time) !== (row.start_time || '');
  if (!movedDay && !timeChanged) return undefined;
  if (!movedDay && !row.start_time) return undefined;
  if (!movedDay && inTimeOrder(primary, { ...item, start_time: row.start_time })) return undefined;
  if (row.start_time) return sortKeyForTime(primary, row.start_time, item.id) ?? sortKeyBetween(lastKey(primary.filter((x) => x.id !== item.id)), null);
  return sortKeyBetween(lastKey(primary.filter((x) => x.id !== item.id)), null);
}

function lastKey(list) {
  const last = list[list.length - 1];
  return last && Number.isFinite(Number(last.sort_key)) ? Number(last.sort_key) : null;
}

/**
 * 「哪天」的选项：D1 · 1月10日 周日 · 落地 … + 备选池。
 * @param {object[]} days 已排序
 */
export function dayOptions(days, { timeZone, at } = {}) {
  const out = days.map((d, i) => ({
    value: d.id,
    label: [`D${i + 1}`, formatDate(d.date, { timeZone, at, year: 'never' }), (d.title || '').trim() || null].filter(Boolean).join(' · '),
  }));
  out.push({ value: POOL, label: '备选池（还没排进哪天）' });
  return out;
}

/**
 * 「哪天」一排字签：今天写「今天」，其余写「11日」（读屏读完整的「D2 · 1月11日 周一」），最后是备选池。
 * @param {object[]} days 已排序
 * @param {string|null} todayId 行程里的今天
 */
export function dayChips(days, todayId = null, { timeZone, at } = {}) {
  const out = days.map((d, i) => {
    const today = d.id === todayId;
    const dd = Number(String(d.date || '').slice(8, 10));
    return {
      value: d.id,
      label: today ? '今天' : Number.isFinite(dd) && dd > 0 ? `${dd}日` : `D${i + 1}`,
      aria: [`D${i + 1}`, formatDate(d.date, { timeZone, at, year: 'never' }), today ? '今天' : null].filter(Boolean).join(' · '),
      today,
    };
  });
  out.push({ value: POOL, label: '备选池', aria: '备选池（还没排进哪天）', today: false });
  return out;
}

/** 「挂在哪条主方案下」的选项：当天通用 + 当天的主方案（不含自己） */
export function parentOptions(primary, excludeId = null) {
  return [
    { value: '', label: '当天通用（不挂在哪条下面）' },
    ...primary.filter((p) => p.id !== excludeId).map((p) => ({
      value: p.id,
      label: [formatTime(p.start_time) || p.time_label || null, p.title].filter(Boolean).join(' '),
    })),
  ];
}

const fold = (s) => str(s).normalize('NFKC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

/**
 * 选地点：按名字 / 当地语名 / 英文名 / 别名 / 地址搜（越南语不带声调也能搜）；
 * 空查询：first 里的地点（这一天用到的、当晚住的，按给的顺序）在前，其余按名字排。
 * @param {{ first?: string[] }} [o]
 * @returns {Array<{ place: object, score: number }>}
 */
export function filterPlaces(places, query, limit = 8, { first = [] } = {}) {
  const q = fold(query).trim();
  const list = [...(places || [])];
  if (!q) {
    const rank = new Map(first.map((id, i) => [id, i]));
    const r = (p) => (rank.has(p.id) ? rank.get(p.id) : Infinity);
    return list
      .sort((a, b) => r(a) - r(b) || str(a.name).localeCompare(str(b.name), 'zh-Hans-CN'))
      .slice(0, limit)
      .map((place) => ({ place, score: 0, first: rank.has(place.id) }));
  }
  const scored = [];
  for (const p of list) {
    const names = [p.name, p.name_local, p.name_en, ...(Array.isArray(p.aliases) ? p.aliases : [])].map(fold).filter(Boolean);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q)) score = Math.max(score, 80);
      else if (n.includes(q)) score = Math.max(score, 60);
    }
    if (!score && fold(p.address).includes(q)) score = 30;
    if (score) scored.push({ place: p, score });
  }
  return scored.sort((a, b) => b.score - a.score || str(a.place.name).localeCompare(str(b.place.name), 'zh-Hans-CN')).slice(0, limit);
}

/**
 * 这一天「先给你看」的地点：当天条目用到的（按时间轴顺序）、当晚住的。
 * @param {object[]} dayItems 这一天的条目（主方案在前，按页面顺序）
 * @param {string|null} stayPlaceId 当晚住处的地点
 */
export function dayPlaceIds(dayItems = [], stayPlaceId = null) {
  const out = [];
  for (const it of dayItems) if (it?.place_id && !out.includes(it.place_id)) out.push(it.place_id);
  if (stayPlaceId && !out.includes(stayPlaceId)) out.push(stayPlaceId);
  return out;
}

/** 两个表单是不是一样（判断“有没有改动”） */
export function sameForm(a, b) {
  const x = { ...toRow(a), newPlace: str(a.newPlace).trim() };
  const y = { ...toRow(b), newPlace: str(b.newPlace).trim() };
  return Object.keys(x).every((k) => (x[k] ?? null) === (y[k] ?? null));
}
