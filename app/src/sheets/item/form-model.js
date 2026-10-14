// =====================================================================
// sheets/item/form-model.js：「加条目 / 编辑条目」表单的纯逻辑（Node 里能直接测：test/unit/page-day.test.js）。
//
//   initialForm({ mode, item, fields, defaultDate, days })   网址参数 / 要编辑的那一行 → 表单初始值
//   validateForm(form)                                       中文问题或 null
//   formPatch(initial, form)                                 只留真正改了的字段（编辑时提交用）
//   toRow(form)                                              表单 → items 行的字段（新建时提交用）
//   resolveSortKey({ form, item, primary, afterId })         新条目 / 改了钟点以后排在哪（items.sort_key）
//   dayOptions(days, { timeZone, at }) / parentOptions(primary, excludeId)   下拉选项
//   filterPlaces(places, query, limit)                       选地点：按名字 / 当地语名 / 英文名 / 地址搜
//   TIME_LABEL_PRESETS、KIND_OPTIONS、VARIANT_OPTIONS
// 排序值的算法（sortKeyForTime / sortKeyAfter / inTimeOrder）和每天页共用：pages/day/model.js。
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

/** 模糊时间的快捷选项（items.time_label） */
export const TIME_LABEL_PRESETS = Object.freeze(['上午', '中午', '午饭后', '下午', '傍晚', '日落前', '晚上', '全天']);

const str = (v) => (v === null || v === undefined ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s ? s : null;
};

/**
 * 表单初始值。
 * @param {{ mode: 'new'|'edit', item?: object|null, fields?: Record<string, string>, defaultDate?: string|null, days?: object[] }} o
 *   fields：网址参数（date / after / parent / variant / kind）；defaultDate：没给日期时用当前页面的那一天
 */
export function initialForm({ mode, item = null, fields = {}, defaultDate = null, days = [] } = {}) {
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
    };
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const date = fields.date || defaultDate;
  const day = date && byDate.has(date) ? byDate.get(date).id : POOL;
  const variant = ['primary', 'backup', 'rain'].includes(fields.variant) ? fields.variant : (fields.parent ? 'backup' : 'primary');
  return {
    title: '',
    kind: fields.kind && KIND_LABELS.item[fields.kind] ? fields.kind : 'other',
    start_time: '',
    end_time: '',
    time_label: '',
    place_id: null,
    newPlace: '',
    description: '',
    variant,
    parent_item_id: variant === 'primary' ? null : fields.parent || null,
    day,
  };
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
  };
}

/** 编辑：只留真正改了的字段（和原来那一行比；钟点按 'HH:MM' 比） */
export function formPatch(initial, form) {
  const a = toRow(initial);
  const b = toRow(form);
  const patch = {};
  for (const k of Object.keys(b)) {
    if ((a[k] ?? null) !== (b[k] ?? null)) patch[k] = b[k];
  }
  return patch;
}

/**
 * 新条目 / 改了钟点的条目排在哪（items.sort_key）。
 *   新建：有开始钟点 → 按钟点插进主方案；没钟点但网址带 after → 插在那条后面；都没有 → 排到最后。
 *   编辑：换了天、或钟点变了而且现在的位置不对 → 按钟点重排（没钟点放最后）；否则不改（返回 undefined）。
 * 备选 / 雨天方案（挂在主方案下的）跟着主方案走，排序值不重要：新建时给 10、编辑时不改。
 * @param {{ form: object, item?: object|null, primary: object[], afterId?: string|null }} o primary：目标那一天的主方案（已排序）
 * @returns {number|undefined}
 */
export function resolveSortKey({ form, item = null, primary = [], afterId = null }) {
  const row = toRow(form);
  if (row.variant !== 'primary' && row.parent_item_id) return item ? undefined : 10;
  if (!item) {
    if (row.start_time) return sortKeyForTime(primary, row.start_time) ?? sortKeyBetween(lastKey(primary), null);
    if (afterId) return sortKeyAfter(primary, afterId);
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
 * 选地点：按名字 / 当地语名 / 英文名 / 别名 / 地址搜（越南语不带声调也能搜）；空查询按名字排。
 * @returns {Array<{ place: object, score: number }>}
 */
export function filterPlaces(places, query, limit = 8) {
  const q = fold(query).trim();
  const list = [...(places || [])];
  if (!q) {
    return list.sort((a, b) => str(a.name).localeCompare(str(b.name), 'zh-Hans-CN')).slice(0, limit).map((place) => ({ place, score: 0 }));
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

/** 两个表单是不是一样（判断“有没有改动”） */
export function sameForm(a, b) {
  const x = { ...toRow(a), newPlace: str(a.newPlace).trim() };
  const y = { ...toRow(b), newPlace: str(b.newPlace).trim() };
  return Object.keys(x).every((k) => (x[k] ?? null) === (y[k] ?? null));
}
