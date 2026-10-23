// =====================================================================
// sheets/expense/form-model.js：「记一笔」表单的纯逻辑（不碰 DOM，Node 里能直接测：test/unit/page-ledger.test.js）。
//
//   金额输入：formatAmountInput(raw, currency) → { text, value }    边打边加千位分隔（越南盾不要小数，港币 / 人民币最多两位）
//             caretAfter(raw, caret, text, currency)                  重排以后光标放回“同一个数字后面”
//             multiplyAmount(text, factor, currency)                 「千 / 万」快捷：350 →（千）→ 350,000
//             trailingUnit(raw)                                       电脑上直接打 350k / 35万 / 1.2m 也认
//   币种：    currencyChoices(trip)                                  分段：当地币 / 港币 / 人民币 / 其他
//   分类：    categoryForItem / categoryForPlace / categoryForBooking  从条目 / 地点 / 预订打开时自动选
//   分摊：    buildSplit(state, ctx) / splitStateFromExpense(e, ctx) / autoShares(...)
//   预填：    initialState({ mode, id, fields }, ctx)                新建（带预填）/ 编辑；从条目、地点打开时币种按那个地方
//                                                                 （ctx.currencyAt，data/dest.js：香港出发前那几条是港币）
//   校验：    validateState(state, ctx) → { ok, field, message, mismatch }
//   提交：    toInsert(state, ctx) / toPatch(state, expense, ctx)
//
// ctx（由弹层从 TripStore 拼出来）：
//   { trip, timeZone, myId, sharers: [{ user_id, name }], today, nowTime, away（人此刻不在行程时区：默认币种用本币）,
//     legacyShares(e) → { payer, ids }（旧记账：数据层 selectors.expenseShares 认出来的付款人和分摊人）,
//     getItem(id), getPlace(id), getBooking(id), getDay(id), getExpense(id), dayOfDate(date) }
// =====================================================================

import { CURRENCIES, currencyMinorUnits, currencyName, normalizeCurrency, roundMoney, QUICK_UNITS, wantsQuickUnits, allowsDecimals } from '../../lib/money.js';
import { formatNumber } from '../../lib/number.js';

/** 记账分类（和数据库 CHECK 一致；顺序 = 芯片顺序） */
export const CATEGORIES = Object.freeze(['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他']);

/** 金额整数部分最多几位（防止误触把数字拉成天文数字） */
export const MAX_INT_DIGITS = 12;

/** 「千 / 万」快捷：只给面额很大的币种（越南盾、印尼盾、韩元……） */
// 「千 / 万」快捷键、能不能有小数：lib/money.js 一处（写评级的价格框也用）
export { QUICK_UNITS, wantsQuickUnits, allowsDecimals };

const FULL_WIDTH = /[０-９．，]/g;
const toHalf = (s) => s.replace(FULL_WIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

/**
 * 把输入框里的字留下“有意义”的部分：数字和（能有小数的币种）第一个小数点。
 * 越南盾这类没有小数的币种：点号、逗号都当千位分隔丢掉（越南写法 450.000）。
 */
function coreOf(raw, currency) {
  const s = toHalf(String(raw ?? ''));
  if (!allowsDecimals(currency)) return s.replace(/[^\d]/g, '');
  let out = '';
  let dot = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (ch === '.' && !dot) {
      out += '.';
      dot = true;
    }
  }
  return out;
}

/** 整数部分加千位分隔（不经过 Number，十几位数字也不丢精度） */
function groupDigits(int) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 边打边格式化：'160000' → '160,000'；'12.5' → '12.5'（港币）；'12.' → '12.'（刚打了小数点）；'007' → '7'。
 * @param {string} raw 输入框里的原文（可能带着上一次加的逗号）
 * @param {string} currency
 * @returns {{ text: string, value: number|null }} value：现在代表的金额（空 / 只有小数点时 null）
 */
export function formatAmountInput(raw, currency) {
  let core = coreOf(raw, currency);
  if (!core) return { text: '', value: null };
  let [int, frac] = core.split('.');
  const hasDot = core.includes('.');
  int = int.replace(/^0+(?=\d)/, '');
  if (int.length > MAX_INT_DIGITS) int = int.slice(0, MAX_INT_DIGITS);
  if (hasDot) {
    if (!int) int = '0';
    frac = (frac || '').slice(0, currencyMinorUnits(currency));
  }
  const text = `${groupDigits(int)}${hasDot ? `.${frac}` : ''}`;
  const value = Number(`${int || '0'}${hasDot && frac ? `.${frac}` : ''}`);
  return { text, value: Number.isFinite(value) && (int || frac) ? value : null };
}

/**
 * 重新格式化以后光标放哪：原文光标前面有几个“有意义”的字符（数字、小数点），新文字里就数到同样多个后面。
 * @param {string} raw 用户刚改完的原文
 * @param {number} caret 原文里的光标位置
 * @param {string} text 格式化以后的文字
 * @param {string} currency
 */
export function caretAfter(raw, caret, text, currency) {
  const before = coreOf(String(raw ?? '').slice(0, Math.max(0, caret)), currency);
  // 前导 0 被去掉的情况：最多数到新文字里有的那么多
  let need = before.replace(/^0+(?=\d)/, '').length;
  if (need <= 0) return 0;
  for (let i = 0; i < text.length; i++) {
    if (/[\d.]/.test(text[i])) need -= 1;
    if (need === 0) return i + 1;
  }
  return text.length;
}

/** 金额 → 输入框里的写法（千位分隔；整数不带小数，有小数的币种最多两位） */
export function amountToInput(value, currency) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
  const minor = currencyMinorUnits(currency);
  const rounded = roundMoney(Math.abs(n), currency);
  return formatNumber(rounded, { minDecimals: 0, maxDecimals: minor });
}

/**
 * 「千 / 万」快捷：当前金额 × factor。空的时候不动（返回 null）。
 * multiplyAmount('350', 1000, 'VND') → '350,000'；multiplyAmount('1.2', 10000, 'VND') → '12,000'
 */
export function multiplyAmount(text, factor, currency) {
  const { value } = formatAmountInput(text, currency);
  if (value === null || value === 0) return null;
  const next = roundMoney(value * factor, currency);
  if (String(Math.trunc(next)).length > MAX_INT_DIGITS) return null;
  return amountToInput(next, currency);
}

const UNIT_RE = /^(.*?)(k|K|千|w|W|万|m|M|tr|百万)$/;
const UNIT_FACTORS = { k: 1e3, K: 1e3, 千: 1e3, w: 1e4, W: 1e4, 万: 1e4, m: 1e6, M: 1e6, tr: 1e6, 百万: 1e6 };

/**
 * 电脑键盘上直接打单位（手机数字键盘没有这些字，用快捷键按钮）：'350k' → { rest: '350', factor: 1000 }。
 * 没有单位返回 null。
 */
export function trailingUnit(raw) {
  const m = UNIT_RE.exec(String(raw ?? '').trim());
  if (!m || !/\d/.test(m[1])) return null;
  return { rest: m[1], factor: UNIT_FACTORS[m[2]] };
}

// ---------------------------------------------------------------------
// 币种
// ---------------------------------------------------------------------

/** 「其他」里可以选的币种（常用的在前） */
export const OTHER_CURRENCY_CODES = Object.freeze(['USD', 'TWD', 'JPY', 'THB', 'KRW', 'SGD', 'MYR', 'MOP', 'EUR', 'GBP', 'IDR', 'VND', 'HKD', 'CNY']);

/**
 * 分段控件的几段：当地币（不是港币、人民币时）/ 港币 / 人民币 / 其他。
 * @returns {Array<{ value: string, label: string }>}
 */
export function currencyChoices(trip) {
  const local = normalizeCurrency(trip?.local_currency || '');
  const list = [];
  for (const c of [local, 'HKD', 'CNY']) if (c && !list.includes(c)) list.push(c);
  return [...list.map((c) => ({ value: c, label: currencyName(c) })), { value: 'other', label: '其他' }];
}

/** 「其他」下拉里的选项（去掉分段里已经有的） */
export function otherCurrencyOptions(trip) {
  const shown = new Set(currencyChoices(trip).map((o) => o.value));
  return OTHER_CURRENCY_CODES.filter((c) => !shown.has(c)).map((c) => ({ value: c, label: `${currencyName(c)} ${c}` }));
}

/** 这个币种在分段里是哪一段（不在分段里的算「其他」） */
export function segmentForCurrency(trip, currency) {
  const c = normalizeCurrency(currency);
  return currencyChoices(trip).some((o) => o.value === c) ? c : 'other';
}

/** 币种的单位名（金额框右边的小字）：越南盾 / 港币 / 人民币 / 美元 USD */
export function currencyUnitLabel(currency) {
  const c = normalizeCurrency(currency);
  return CURRENCIES[c] ? currencyName(c) : `${currencyName(c)}${currencyName(c) === c ? '' : ` ${c}`}`;
}

// ---------------------------------------------------------------------
// 分类：从条目 / 地点 / 预订打开时自动选
// ---------------------------------------------------------------------

const ITEM_KIND_CATEGORY = Object.freeze({
  flight: '交通', transport: '交通', hotel: '住宿', food: '餐饮', cafe: '餐饮', night_market: '餐饮',
  sight: '门票', beach: '活动', activity: '活动', spa: '活动', sunset: '活动', shopping: '购物',
  walk_route: '其他', free: '其他', other: '其他',
});
const PLACE_KIND_CATEGORY = Object.freeze({
  sight: '门票', food: '餐饮', cafe: '餐饮', bar: '餐饮', market: '餐饮', hotel: '住宿', hub: '交通',
  shop: '购物', beach: '活动', activity: '活动', other: '其他',
});
const BOOKING_KIND_CATEGORY = Object.freeze({
  flight: '交通', hotel: '住宿', activity: '活动', transfer: '交通', restaurant: '餐饮', ticket: '门票',
  car_rental: '交通', insurance: '其他', other: '其他',
});

export const categoryForItem = (item) => (item ? ITEM_KIND_CATEGORY[item.kind] || null : null);
export const categoryForPlace = (place) => (place ? PLACE_KIND_CATEGORY[place.kind] || null : null);
export const categoryForBooking = (b) => (b ? BOOKING_KIND_CATEGORY[b.kind] || null : null);

// ---------------------------------------------------------------------
// 分摊
// ---------------------------------------------------------------------

/** 金额文字 → 最小单位整数（越南盾 1、港币 0.01）；空 → 0 */
function minorOf(text, currency) {
  const { value } = formatAmountInput(text, currency);
  const k = 10 ** currencyMinorUnits(currency);
  return value === null ? 0 : Math.round(value * k);
}

function fromMinorText(minor, currency) {
  const k = 10 ** currencyMinorUnits(currency);
  return amountToInput(minor / k, currency);
}

/**
 * 按金额分摊时，没动过的人自动补上“剩下的”（两个人时：填了一个，另一个自动 = 总额 − 它）。
 * 剩下的是负数（填多了）时，没动过的人记 0，交给对账提示。
 * @param {Record<string, string>} shares  user_id → 输入框文字
 * @param {Record<string, boolean>} touched 用户亲手改过的
 * @param {number|null} total
 * @param {string[]} ids 参与分摊的人（顺序）
 * @returns {Record<string, string>}
 */
export function autoShares(shares, touched, total, ids, currency) {
  const out = { ...shares };
  const free = ids.filter((id) => !touched[id]);
  if (!free.length) return out;
  const k = 10 ** currencyMinorUnits(currency);
  const totalMinor = total === null || total === undefined ? 0 : Math.round(Number(total) * k);
  const used = ids.filter((id) => touched[id]).reduce((acc, id) => acc + minorOf(shares[id], currency), 0);
  const rest = Math.max(0, totalMinor - used);
  const base = Math.floor(rest / free.length);
  let extra = rest - base * free.length;
  for (const id of free) {
    const v = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    out[id] = totalMinor ? fromMinorText(v, currency) : '';
  }
  return out;
}

/**
 * 表单状态 → expenses.split。
 *   平摊 → { mode: 'equal', user_ids }
 *   个人 → 算付款人自己的：{ mode: 'personal' }；算别人的（Jeremy 帮 Cathy 买）：{ mode: 'amounts', shares: [{ 那个人: 总额 }] }
 *   按金额 → { mode: 'amounts', shares }
 */
export function buildSplit(state, { sharers = [] } = {}) {
  const ids = sharers.map((s) => s.user_id);
  const amount = formatAmountInput(state.amountText, state.currency).value;
  if (state.splitMode === 'personal') {
    const who = state.personalFor || state.payer;
    if (!who || who === state.payer) return { mode: 'personal' };
    return { mode: 'amounts', shares: [{ user_id: who, amount: roundMoney(amount ?? 0, state.currency) }] };
  }
  if (state.splitMode === 'amounts') {
    const filled = autoShares(state.shares || {}, state.touched || {}, amount, ids, state.currency);
    return {
      mode: 'amounts',
      shares: ids.map((id) => ({ user_id: id, amount: roundMoney(formatAmountInput(filled[id], state.currency).value ?? 0, state.currency) }))
        .filter((s) => s.amount !== 0),
    };
  }
  const people = ids.length ? ids : [state.payer].filter(Boolean);
  return people.length > 1 ? { mode: 'equal', user_ids: people } : { mode: 'personal' };
}

/**
 * 已有的一笔 → 表单里分摊的样子。
 *   amounts 只有一个人、正好是总额 → 显示成「个人」，算那个人的
 */
export function splitStateFromExpense(e, { sharers = [] } = {}) {
  const split = e?.split && typeof e.split === 'object' ? e.split : {};
  const currency = normalizeCurrency(e?.currency_iso || e?.currency);
  if (split.mode === 'personal') return { splitMode: 'personal', personalFor: e.paid_by_user_id || null, shares: {}, touched: {} };
  if (split.mode === 'amounts' && Array.isArray(split.shares)) {
    const nonzero = split.shares.filter((s) => Number(s.amount));
    if (nonzero.length === 1 && roundMoney(Number(nonzero[0].amount), currency) === roundMoney(Number(e.amount), currency)) {
      return { splitMode: 'personal', personalFor: nonzero[0].user_id, shares: {}, touched: {} };
    }
    const shares = {};
    const touched = {};
    for (const s of split.shares) {
      shares[s.user_id] = amountToInput(Number(s.amount), currency);
      touched[s.user_id] = true;
    }
    for (const s of sharers) if (!(s.user_id in shares)) {
      shares[s.user_id] = '';
      touched[s.user_id] = true;
    }
    return { splitMode: 'amounts', personalFor: null, shares, touched };
  }
  return { splitMode: 'equal', personalFor: null, shares: {}, touched: {} };
}

/** 平摊时每人多少（原币，给“每人 …”那行字用）；不是平摊 / 没金额返回 null */
export function perPerson(state, { sharers = [] } = {}) {
  const v = formatAmountInput(state.amountText, state.currency).value;
  if (!v || state.splitMode !== 'equal' || sharers.length < 2) return null;
  return roundMoney(v / sharers.length, state.currency);
}

// ---------------------------------------------------------------------
// 预填 / 初始状态
// ---------------------------------------------------------------------

const TIME_RE = /^(\d{1,2}):(\d{2})/;
const hhmm = (t) => {
  const m = TIME_RE.exec(String(t || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

/** 一个空白表单 */
export function blankState(ctx = {}) {
  // 人还没到 / 已经回到家（ctx.away：去程落地前、回程落地后，store.presenceZone ≠ 行程时区）：默认记本币（港币），
  // 机场里买的东西多半是港币（10-14 现场走查 P2-6）；其余时候默认当地币
  const home = ctx.trip?.home_currency ? normalizeCurrency(ctx.trip.home_currency) : null;
  const local = ctx.away && home ? home : normalizeCurrency(ctx.trip?.local_currency || ctx.trip?.home_currency || 'HKD');
  const me = ctx.myId || null;
  const payer = ctx.sharers?.some((s) => s.user_id === me) ? me : ctx.sharers?.[0]?.user_id || me;
  return {
    amountText: '',
    currency: local,
    category: null,
    description: '',
    payer,
    splitMode: 'equal',
    personalFor: null,
    shares: {},
    touched: {},
    date: ctx.today || '',
    time: ctx.nowTime || '',
    itemId: null,
    bookingId: null,
    placeId: null,
    receiptPath: null,
    splitDirty: false,
  };
}

/**
 * 打开弹层时的表单状态。
 *   编辑：照那一笔填好；
 *   新建：预填（条目 → 日期、分类、说明、关联预订、开始时间；地点 → 分类、说明；预订 → 金额、币种、分类、说明；
 *         日期 → 那天；分类 → 那个分类）。
 * @param {{ mode: 'new'|'edit', id: string|null, fields: Record<string, string> }} args
 * @returns {{ state: object, hint: object|null, missing: boolean }}  hint：条目的费用估算（「用预估」）；missing：要编辑的那一笔找不到
 */
export function initialState(args, ctx) {
  const base = blankState(ctx);
  if (args.mode === 'edit') {
    const e = args.id ? ctx.getExpense?.(args.id) : null;
    if (!e || e.deleted_at) return { state: base, hint: null, missing: true };
    const currency = normalizeCurrency(e.currency_iso || e.currency || base.currency);
    let split = splitStateFromExpense(e, ctx);
    // 台湾那趟的旧记账（paid_by 是名字、split 是 {}、分摊人在 split_with）：付款人和分摊按数据层认出来的人填，
    // 不要变成“当前用户付、平摊”（代码评审 P1-2）。认不出来的人（legacy: / unknown）不填。
    const legacy = !e.paid_by_user_id || !(e.split && typeof e.split === 'object' && e.split.mode) ? ctx.legacyShares?.(e) || null : null;
    const known = (uid) => Boolean(uid) && !String(uid).startsWith('legacy:') && uid !== 'unknown';
    const payer = e.paid_by_user_id || (known(legacy?.payer) ? legacy.payer : null) || base.payer;
    if (legacy && !(e.split && typeof e.split === 'object' && e.split.mode)) {
      const ids = (legacy.ids || []).filter(known);
      if (ids.length >= 2) split = { splitMode: 'equal', personalFor: null, shares: {}, touched: {} };
      else if (ids.length === 1) split = { splitMode: 'personal', personalFor: ids[0], shares: {}, touched: {} };
    }
    return {
      state: {
        ...base,
        amountText: amountToInput(Number(e.amount), currency),
        currency,
        category: CATEGORIES.includes(e.category) ? e.category : '其他',
        description: e.description || '',
        payer,
        ...split,
        personalFor: split.personalFor || payer || null,
        date: e.date || '',
        time: hhmm(e.extra?.time),
        itemId: e.item_id || null,
        bookingId: e.booking_id || null,
        placeId: e.extra?.place_id || null,
        receiptPath: e.receipt_path || null,
      },
      hint: null,
      missing: false,
    };
  }

  const f = args.fields || {};
  const state = { ...base };
  let hint = null;
  const item = f.item ? ctx.getItem?.(f.item) : null;
  const booking = f.booking ? ctx.getBooking?.(f.booking) : item?.booking_id ? ctx.getBooking?.(item.booking_id) : null;
  const place = f.place ? ctx.getPlace?.(f.place) : item?.place_id ? ctx.getPlace?.(item.place_id) : null;

  if (item) {
    state.itemId = item.id;
    state.description = item.title || '';
    state.category = categoryForItem(item);
    const day = item.day_id ? ctx.getDay?.(item.day_id) : null;
    if (day?.date) state.date = day.date;
    const t = hhmm(item.start_time);
    if (t) state.time = t;
    else if (state.date !== ctx.today) state.time = '';
    const ce = item.cost_estimate;
    if (ce && Number.isFinite(Number(ce.amount)) && ce.currency) {
      hint = { amount: Number(ce.amount), amountMax: ce.amount_max ?? null, currency: normalizeCurrency(ce.currency), per: ce.per === 'person' ? 'person' : 'total' };
    }
  }
  if (place) {
    state.placeId = place.id;
    if (!state.description) state.description = place.name || '';
    if (!state.category) state.category = categoryForPlace(place);
  }
  if (booking) {
    state.bookingId = booking.id;
    if (!state.category) state.category = categoryForBooking(booking);
    if (!state.description) state.description = booking.title || '';
    // 明确从预订打开（「付了，记一笔」）：金额、币种按还没付的那部分填好
    if (f.booking && booking.price_amount !== null && booking.price_amount !== undefined && booking.price_currency) {
      const cur = normalizeCurrency(booking.price_currency);
      const total = Number(booking.price_amount);
      const paid = booking.payment_status === 'partial' ? Number(booking.paid_amount || 0) : 0;
      const due = booking.payment_status === 'paid' ? total : Math.max(0, total - paid);
      if (due > 0) {
        state.currency = cur;
        state.amountText = amountToInput(due, cur);
      }
    } else if (!hint && booking.price_amount && booking.price_currency) {
      hint = { amount: Number(booking.price_amount), amountMax: null, currency: normalizeCurrency(booking.price_currency), per: 'total', booking: true };
    }
  }
  if (f.date && (!item || !state.date)) {
    state.date = f.date;
    if (f.date !== ctx.today && !item) state.time = '';
  }
  if (f.category && CATEGORIES.includes(f.category)) state.category = f.category;
  // 从条目 / 地点打开：默认币种是那个地方的（目的地档案：香港出发前那几条、回程在香港机场的是港币）；
  // 预订按金额填好的、网址点名币种的不改
  if (!f.currency && (item || place) && !(f.booking && state.amountText) && ctx.currencyAt) {
    const cur = ctx.currencyAt({ item, place });
    if (cur) state.currency = normalizeCurrency(cur);
  }
  if (f.currency) state.currency = normalizeCurrency(f.currency);
  // 地点：那天有一条用这个地点的条目，顺手关联上
  if (!state.itemId && state.placeId && state.date && ctx.itemsOnDate) {
    const match = ctx.itemsOnDate(state.date).find((it) => it.place_id === state.placeId);
    if (match) {
      state.itemId = match.id;
      const t = hhmm(match.start_time);
      if (t && state.date !== ctx.today) state.time = t;
    }
  }
  if (!state.category) state.category = null;
  return { state, hint, missing: false };
}

// ---------------------------------------------------------------------
// 校验、提交
// ---------------------------------------------------------------------

/**
 * @returns {{ ok: boolean, field?: 'amount'|'split'|'date'|'time', message?: string, mismatch?: number }}
 *   mismatch：按金额分摊时总额减去各人之和（最小单位，正 = 少了、负 = 多了）
 */
export function validateState(state, ctx = {}, { splitMismatch } = {}) {
  const { value } = formatAmountInput(state.amountText, state.currency);
  if (!value) return { ok: false, field: 'amount', message: '先输入金额' };
  if (state.date && !/^\d{4}-\d{2}-\d{2}$/.test(state.date)) return { ok: false, field: 'date', message: '日期不对' };
  if (state.time && !/^\d{2}:\d{2}$/.test(state.time)) return { ok: false, field: 'time', message: '时间不对' };
  if (state.splitMode === 'amounts' && splitMismatch) {
    const split = buildSplit(state, ctx);
    const diff = splitMismatch(split, value, state.currency);
    if (diff) return { ok: false, field: 'split', message: diff > 0 ? '各人的金额加起来比总额少' : '各人的金额加起来比总额多', mismatch: diff };
  }
  return { ok: true };
}

/** 新的一笔：交给 store.addExpense 的参数 */
export function toInsert(state, ctx = {}) {
  const amount = roundMoney(formatAmountInput(state.amountText, state.currency).value, state.currency);
  const extra = {};
  if (state.time) extra.time = state.time;
  if (state.placeId) extra.place_id = state.placeId;
  return {
    amount,
    currency: state.currency,
    date: state.date || null,
    category: state.category || '其他',
    description: state.description.trim() || null,
    paid_by_user_id: state.payer || undefined,
    split: buildSplit(state, ctx),
    item_id: state.itemId || null,
    booking_id: state.bookingId || null,
    receipt_path: state.receiptPath || null,
    extra,
  };
}

/** 按值比较（键的顺序不算差别） */
function sameValue(a, b) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}

/**
 * 改一笔：只放真正改了的字段（store.updateExpense 自己也会再比一次）。
 * 分摊：用户没碰过谁付 / 怎么分、金额也没变时不重写（旧数据的分摊原样保留）。
 */
export function toPatch(state, e, ctx = {}) {
  const next = toInsert(state, ctx);
  const cur = normalizeCurrency(e.currency_iso || e.currency);
  const patch = {};
  if (roundMoney(Number(e.amount), cur) !== next.amount) patch.amount = next.amount;
  if (cur !== next.currency) patch.currency = next.currency;
  if ((e.date || null) !== next.date) patch.date = next.date;
  if ((e.category || '其他') !== next.category) patch.category = next.category;
  if ((e.description || null) !== next.description) patch.description = next.description;
  // 谁付、怎么分：只有用户亲手改过（splitDirty），或者改了金额 / 币种时才写——
  // 旧记账只改说明时不能把付款人改成“当前用户”、把分摊改成平摊（代码评审 P1-2）
  const moneyChanged = 'amount' in patch || 'currency' in patch;
  if (next.paid_by_user_id && e.paid_by_user_id !== next.paid_by_user_id && (state.splitDirty || moneyChanged)) patch.paid_by_user_id = next.paid_by_user_id;
  if ((e.item_id || null) !== next.item_id) patch.item_id = next.item_id;
  if ((e.booking_id || null) !== next.booking_id) patch.booking_id = next.booking_id;
  if ((e.receipt_path || null) !== next.receipt_path) patch.receipt_path = next.receipt_path;
  if (state.splitDirty || 'amount' in patch || 'currency' in patch || 'paid_by_user_id' in patch) {
    if (!sameValue(e.split || {}, next.split)) patch.split = next.split;
  }
  const extra = { ...(e.extra || {}) };
  delete extra.time;
  delete extra.place_id;
  Object.assign(extra, next.extra);
  if (!sameValue(e.extra || {}, extra)) patch.extra = extra;
  return patch;
}

/** 表单有没有被动过（关面板前问“放弃未保存的内容？”） */
export function isDirty(state, initial) {
  if (!state || !initial) return false;
  const keys = ['amountText', 'currency', 'category', 'description', 'payer', 'splitMode', 'personalFor', 'date', 'time', 'itemId', 'bookingId', 'receiptPath'];
  if (keys.some((k) => (state[k] ?? '') !== (initial[k] ?? ''))) return true;
  return !sameValue(state.shares || {}, initial.shares || {});
}

/**
 * 越南盾这类大面额币种，金额不到 1,000 多半是忘了按「千」：返回建议的金额（×1000），否则 null。
 */
export function smallAmountSuggestion(state) {
  if (!wantsQuickUnits(state.currency)) return null;
  const { value } = formatAmountInput(state.amountText, state.currency);
  if (!value || value >= 1000) return null;
  return value * 1000;
}
