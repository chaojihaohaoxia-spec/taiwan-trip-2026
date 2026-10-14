// =====================================================================
// sheets/review/form-model.js：写评级表单的纯逻辑（Node 里能直接测：test/unit/page-places.test.js）。
//
//   const f = initialForm(review, { currency: 'VND' })        已有评级 → 表单；没有 → 空表单
//   f.food / f.shop：吃了什么 / 买了什么（B5.10 LogEntry 的编辑版：价格是输入框里的文字，key 给列表用）
//   parsePrice('45k', 'VND') → { value: 45000, error: null }
//   logFromEntry(entry) → LogEntry | null                     名字为空的不要；价格认不出时不写价格
//   buildPatch(form, { photos, itemId, visitedAt, existing })  → saveReview 的 patch（只放这几个字段）
//   formKey(form) / isEmptyForm(form)                          判断改没改过（关面板前问不问）、能不能保存
//   currencyChoices(trip, extra)                               价格能选的币种：当地币、本币（+ 已有记录里的）
//
// 评级：rating 1–5 或 null（只写评语也行）；同一个人同一个地点一条（data 的 saveReview：有就改、没有就建）。
// =====================================================================

import { parseAmount, normalizeCurrency, formatAmount, wantsQuickUnits, amountInputMode } from '../../lib/money.js';
import { isRating } from '../place/model.js';

/** 吃了什么 / 买了什么最多几条、照片最多几张（再多就该分开评了） */
export const MAX_LOG_ENTRIES = 30;
export const MAX_PHOTOS = 12;
/** 评语、名字的长度上限（数据库没有限制，界面上防止误粘贴一大段） */
export const MAX_NOTES = 2000;
export const MAX_NAME = 80;

let seq = 0;
/** 列表项的本地 key（不进数据库） */
export function nextKey(prefix = 'e') {
  seq += 1;
  return `${prefix}${seq.toString(36)}`;
}

/**
 * 价格输入框的文字 → 数字。空 = 没填（不是错）；认不出、负数、0 → 错。
 * 认得千分位、全角、币种符号、「45k」「4.5万」「1tr2」（越南口语 1,200,000）、越南写法「450.000」。
 * @returns {{ value: number|null, error: string|null }}
 */
export function parsePrice(text, currency) {
  const raw = String(text ?? '').trim();
  if (!raw) return { value: null, error: null };
  const v = parseAmount(raw, { currency });
  if (v === null) return { value: null, error: '看不懂这个价格，只写数字就行' };
  if (v <= 0) return { value: null, error: '价格要大于 0' };
  return { value: v, error: null };
}

// ---------------------------------------------------------------------
// 手机上输价格：iOS 的数字键盘打不出「k」「万」，所以大面额币种给一个「千」按钮（和记一笔面板一样的叫法）
// ---------------------------------------------------------------------

/** 这个币种要不要「千」按钮（lib/money.js 的 wantsQuickUnits，和记一笔面板同一套） */
export const wantsThousands = wantsQuickUnits;

/** 价格输入框的键盘（lib/money.js 的 amountInputMode） */
export const priceInputMode = amountInputMode;

/**
 * 点「千」：现在的价格 × 1000，返回输入框里该显示的文字（千分位）；还没填、看不懂时返回 null（按钮不做事）。
 * 45 → '45,000'；1.2 → '1,200'（越南盾按整数）；超过一万亿的不再乘（防止连点出天文数字）。
 */
export function timesThousand(text, currency) {
  const p = parsePrice(text, currency);
  if (p.value === null) return null;
  const v = p.value * 1000;
  if (v > 1e12) return null;
  return formatAmount(v, currency).replace(/[^\d.,]/g, '');
}

/**
 * 越南盾这类大面额币种，价格不到 1,000 多半是忘了按「千」：返回提醒用的“改成多少”，不用提醒时 null。
 * @returns {null | { value: number, text: string }} text：改成以后输入框里的文字
 */
export function forgotThousands(text, currency) {
  if (!wantsThousands(currency)) return null;
  const p = parsePrice(text, currency);
  if (p.value === null || p.value >= 1000) return null;
  const t = timesThousand(text, currency);
  return t ? { value: p.value * 1000, text: t } : null;
}

/** 一条 LogEntry → 表单里的一项 */
export function entryFromLog(log, defaultCurrency) {
  const price = log?.price && Number.isFinite(Number(log.price.amount)) ? log.price : null;
  const currency = normalizeCurrency(price?.currency || defaultCurrency) || defaultCurrency || 'HKD';
  return {
    key: nextKey('l'),
    name: String(log?.name || ''),
    amount: price ? formatAmount(Number(price.amount), currency).replace(/[^\d.,]/g, '') : '',
    currency,
    rating: isRating(log?.rating) ? log.rating : null,
    // 界面上不编辑、但要原样保留的字段
    qty: Number.isFinite(Number(log?.qty)) && Number(log.qty) > 0 ? Number(log.qty) : null,
    note: log?.note ? String(log.note) : null,
    photo_path: log?.photo_path ? String(log.photo_path) : null,
  };
}

/** 新加一项（只有名字） */
export function newEntry(name, currency) {
  return { key: nextKey('l'), name: String(name || '').trim().slice(0, MAX_NAME), amount: '', currency, rating: null, qty: null, note: null, photo_path: null };
}

/**
 * 表单里的一项 → LogEntry（docs/数据结构.md B5.10）。名字是空的返回 null（不保存）；价格认不出就不写价格。
 * @returns {null | { name: string, price?: { amount: number, currency: string }, qty?: number, rating?: number, note?: string, photo_path?: string }}
 */
export function logFromEntry(entry) {
  const name = String(entry?.name || '').trim().slice(0, MAX_NAME);
  if (!name) return null;
  const out = { name };
  const p = parsePrice(entry.amount, entry.currency);
  if (p.value !== null) out.price = { amount: p.value, currency: normalizeCurrency(entry.currency) };
  if (entry.qty) out.qty = entry.qty;
  if (isRating(entry.rating)) out.rating = entry.rating;
  if (entry.note) out.note = entry.note;
  if (entry.photo_path) out.photo_path = entry.photo_path;
  return out;
}

/** 已有照片（Photo，B5.1）→ 表单里的一张 */
export function photoFromRow(p) {
  return { key: nextKey('p'), path: p.path, width: p.width ?? null, height: p.height ?? null, taken_at: p.taken_at ?? null, caption: p.caption ?? null, file: null, preview: null };
}

/**
 * 已有评级 → 表单（没有就是空表单）。
 * @param {object|null} review
 * @param {{ currency: string }} o 新加的价格默认用哪种币（行程的当地币）
 */
export function initialForm(review, { currency }) {
  return {
    rating: isRating(review?.rating) ? review.rating : null,
    notes: String(review?.notes || ''),
    food: (review?.food_log || []).filter((l) => l && l.name).map((l) => entryFromLog(l, currency)),
    shop: (review?.shop_log || []).filter((l) => l && l.name).map((l) => entryFromLog(l, currency)),
    photos: (review?.photos || []).filter((p) => p && typeof p.path === 'string' && p.path).map(photoFromRow),
  };
}

/** 判断改没改过用的指纹（顺序、内容都算；只看会保存的东西） */
export function formKey(form) {
  return JSON.stringify([
    form.rating ?? null,
    String(form.notes || '').trim(),
    form.food.map(logFromEntry).filter(Boolean),
    form.shop.map(logFromEntry).filter(Boolean),
    form.photos.map((p) => p.path || p.key),
  ]);
}

/** 什么都没写（不能保存一条空评级） */
export function isEmptyForm(form) {
  return !isRating(form.rating) && !String(form.notes || '').trim()
    && !form.food.some((e) => String(e.name || '').trim()) && !form.shop.some((e) => String(e.name || '').trim())
    && !form.photos.length;
}

/** 价格输入有错的项（保存前提示） */
export function priceErrors(form) {
  return [...form.food, ...form.shop].filter((e) => String(e.name || '').trim() && parsePrice(e.amount, e.currency).error);
}

/**
 * saveReview 的 patch。
 * @param {object} form
 * @param {{ photos: object[], itemId?: string|null, visitedAt?: string|null, existing?: object|null }} o
 *   photos：最终的照片（新照片已经上传、换成 path）；itemId：从条目打开时关联那条（已有的不覆盖）；
 *   visitedAt：去的时间（已有的不覆盖）
 */
export function buildPatch(form, { photos, itemId = null, visitedAt = null, existing = null }) {
  const notes = String(form.notes || '').trim().slice(0, MAX_NOTES);
  const patch = {
    rating: isRating(form.rating) ? form.rating : null,
    notes: notes || null,
    food_log: form.food.map(logFromEntry).filter(Boolean),
    shop_log: form.shop.map(logFromEntry).filter(Boolean),
    photos: photos.map((p) => {
      const out = { path: p.path };
      if (p.caption) out.caption = p.caption;
      if (p.taken_at) out.taken_at = p.taken_at;
      if (Number.isFinite(p.width) && p.width > 0) out.width = p.width;
      if (Number.isFinite(p.height) && p.height > 0) out.height = p.height;
      return out;
    }),
  };
  if (itemId && !existing?.item_id) patch.item_id = itemId;
  if (visitedAt && !existing?.visited_at) patch.visited_at = visitedAt;
  return patch;
}

/**
 * 价格能选的币种：当地币、本币，再加上已有记录里出现过的（不丢）。顺序：当地币在前。
 * @param {{ local_currency?: string, home_currency?: string }} trip
 * @param {string[]} [extra]
 */
export function currencyChoices(trip, extra = []) {
  const out = [];
  for (const c of [trip?.local_currency, trip?.home_currency, ...extra]) {
    const n = normalizeCurrency(c);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.length ? out : ['HKD'];
}

/**
 * 去的时间（reviews.visited_at）：从条目打开 → 那天、条目的实际 / 计划时间；行程进行中 → 现在；其他 → 不写。
 * @param {{ item?: object|null, day?: object|null, timeZone: string, ongoing: boolean, now: Date, toInstant: Function }} o
 *   toInstant：lib/datetime.js 的 zonedToInstant（传进来，方便测试）
 */
export function visitedAtFor({ item = null, day = null, timeZone, ongoing, now, toInstant }) {
  if (item && day?.date) {
    const at = toInstant(day.date, item.actual_time || item.start_time || '12:00', timeZone);
    if (at && !Number.isNaN(at.getTime())) return at.toISOString();
  }
  return ongoing ? now.toISOString() : null;
}
