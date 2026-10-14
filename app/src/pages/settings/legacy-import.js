// =====================================================================
// pages/settings/legacy-import.js：旧版（台湾那趟的单页网站 legacy/index.html）本机记录导入新版（SPEC §5.12 末尾）。
// 纯函数（Node 里能直接测：test/unit/page-account.test.js，用虚构的旧数据样本）。
//
// 旧版和新版同一个网址（同源），旧版把一些东西只存在浏览器的 localStorage 里（现状报告 3.3 / 8.4）：
//   taiwanTrip2026State     整个 appState（JSON）：completedItems（条目完成）、confirmStatus（待确认 / 提醒的勾）、
//                           spotReviews（评级、评语、吃了什么、买了什么）、checkedItems（已去）、dayDiaries（日记，只在本机）、
//                           dayNotes（每天的备注）、packingList（打包，只在本机）、personalLedger（个人记账）……
//   taiwanTrip2026Expenses  共同账本的本机副本（正常情况下都已经在云端 expenses 表里；只导入云端没有的）
//   taiwanTrip_anthropicKey 旧版明文存的 AI 接口密钥（安全问题 SEC-8）：**只看键名在不在，绝不读值**，提示一键删除
//
//   legacyKeysPresent(storage)          哪些旧键在（只枚举键名，不读任何值）
//   readLegacyData(storage)             读 taiwanTrip2026State / taiwanTrip2026Expenses 两个键（解析失败记下来，不抛错）
//   pickLegacyTarget(entries)           导入到哪一趟：taiwan2026 → 名字里有「台湾」→ 台北时区、已结束的 → 第一趟能编辑的
//   planLegacyImport(legacy, bundle, o) 预览：每一类能导入几条、几条已经有了、几条对不上（原因）
//   applyLegacyImport(store, plan, o)   照预览写进新版（全部走数据层：乐观更新 + 写队列，离线也行；可以重复导入，不会重复写）
//
// 对应规则（新版台湾行程由 docs/数据结构.md B 部分的 JSON 导入，旧 id 都留了线索）：
//   条目    旧 id 'd3-1500' → items.legacy_id；没有 legacy_id 时按「第 3 天 15:00 的主方案」找唯一的一条
//   天      'd3' → days.extra.legacy_id；没有就按日期排第 3 天
//   待确认  'confirm-<文字>' / 'rem-<天>-<序号>' → todos.extra.legacy_confirm_key；没有就按待确认清单里同名的一项
//   评级    'spot-<城市>-<名字>' → reviews.extra.legacy_spot_key 的地点；没有就按地点名字 / 别名 / 英文名
//           评级五档 夯 5 / 顶级 4 / 人上人 3 / NPC 2 / 拉完了 1；吃了什么 / 买了什么 → food_log / shop_log（旧照片是公开链接，记在 extra 里）
//   日记    dayDiaries[天] + dayNotes[天] → 自己那天的 journal_entries（已经有就接在后面；同样的字已经在里面就跳过）
//   打包    packingList[分类][名字] → packing 清单里同名的一项（勾上）；新版没有的自定义项新建
//   个人记账 personalLedger（支出）→ expenses：谁记的（邮箱 → 成员）、谁付（me / partner）、给谁（me / shared / partner）
//           → 付款人 + 分摊（平摊 / 个人 / 按金额）；收入不导入；默认只导入行程日期内的，其余的可以勾选一起导入
//   共同账本 taiwanTrip2026Expenses 里云端没有的（按 id）
// 新建的行用确定的 id（uuidv5(<行程>:<种类>:legacy-<旧 id>)，和导入脚本同一个命名空间）：重复导入只会显示「已经导入过」。
// =====================================================================

import { uuidv5 } from '../../lib/ride-links.js';
import { normalizeCurrency, roundMoney } from '../../lib/money.js';
import { tripPhase } from '../../lib/datetime.js';

/** 旧版 localStorage 的键 */
export const LEGACY_KEYS = Object.freeze({
  state: 'taiwanTrip2026State',
  expenses: 'taiwanTrip2026Expenses',
  apiKey: 'taiwanTrip_anthropicKey',
});
/** 导入完以后可以清掉的键（旧版的登录会话 taiwanTrip2026Auth 不在这里：旧页面 legacy/ 还要用，新版也从来不读不写它） */
export const CLEARABLE_KEYS = Object.freeze([LEGACY_KEYS.state, LEGACY_KEYS.expenses]);
/** 台湾行程的 id */
export const LEGACY_TRIP_ID = 'taiwan2026';
/** 本机记一下“导入过了”（lib/storage.js 的 local，自动带 rs7885: 前缀） */
export const IMPORTED_MARK = 'legacy:imported';

/** 评级五档（旧版的字 → 新版 reviews.rating） */
export const RATING_FROM_LEGACY = Object.freeze({ 夯: 5, 顶级: 4, 人上人: 3, NPC: 2, 拉完了: 1 });
/** 旧版日记的心情 → emoji */
export const MOOD_FROM_LEGACY = Object.freeze({ great: '🌟', good: '😊', okay: '😌', tired: '😴', bad: '🌧' });
const EXPENSE_CATEGORIES = new Set(['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他']);

/** 预览里各类的顺序和中文名 */
export const SECTIONS = Object.freeze([
  { key: 'items', label: '完成状态', unit: '个条目' },
  { key: 'confirm', label: '确认状态', unit: '项' },
  { key: 'reviews', label: '评级', unit: '个地点' },
  { key: 'journal', label: '日记', unit: '天' },
  { key: 'packing', label: '打包', unit: '件' },
  { key: 'ledger', label: '个人记账', unit: '笔' },
  { key: 'expenses', label: '共同账本', unit: '笔' },
]);

// ---------------------------------------------------------------------
// 读本机
// ---------------------------------------------------------------------

/**
 * 哪些旧键在：只枚举键名（storage.key(i)），一个值都不读——尤其是 taiwanTrip_anthropicKey。
 * @param {Storage|null} storage  window.localStorage（读不了时传 null）
 */
export function legacyKeysPresent(storage) {
  const names = new Set();
  try {
    const n = storage?.length || 0;
    for (let i = 0; i < n; i++) {
      const k = storage.key(i);
      if (k) names.add(k);
    }
  } catch {
    /* 隐私模式 / 被禁用：当作没有 */
  }
  return {
    state: names.has(LEGACY_KEYS.state),
    expenses: names.has(LEGACY_KEYS.expenses),
    apiKey: names.has(LEGACY_KEYS.apiKey),
    any: names.has(LEGACY_KEYS.state) || names.has(LEGACY_KEYS.expenses),
  };
}

function parseJSON(raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: null };
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * 读两个旧键（只读这两个）。
 * @returns {{ state: object|null, expenses: object[], problems: string[] }}
 */
export function readLegacyData(storage) {
  const problems = [];
  let rawState = null;
  let rawExpenses = null;
  try {
    rawState = storage?.getItem(LEGACY_KEYS.state) ?? null;
    rawExpenses = storage?.getItem(LEGACY_KEYS.expenses) ?? null;
  } catch {
    problems.push('这台设备的本机存储读不了');
  }
  const s = parseJSON(rawState);
  const e = parseJSON(rawExpenses);
  if (!s.ok) problems.push('旧版的状态记录（taiwanTrip2026State）坏了，读不出来');
  if (!e.ok) problems.push('旧版的账本副本（taiwanTrip2026Expenses）坏了，读不出来');
  return { state: normalizeLegacyState(s.value), expenses: normalizeLegacyExpenses(e.value), problems };
}

/** 旧 appState → 只留导入要用的几块，类型不对的当空 */
export function normalizeLegacyState(raw) {
  if (!isObj(raw)) return null;
  const obj = (k) => (isObj(raw[k]) ? raw[k] : {});
  const checked = isObj(raw.checklistStatus) && Object.keys(raw.checklistStatus).length ? raw.checklistStatus : obj('checkedItems');
  return {
    completedItems: obj('completedItems'),
    confirmStatus: obj('confirmStatus'),
    spotReviews: obj('spotReviews'),
    checkedItems: checked,
    dayDiaries: obj('dayDiaries'),
    dayNotes: obj('dayNotes'),
    packingList: obj('packingList'),
    personalLedger: Array.isArray(raw.personalLedger) ? raw.personalLedger.filter(isObj) : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses.filter(isObj) : [],
  };
}

/** 旧账本副本：数组，或旧旧版的 { 天: [...] } */
export function normalizeLegacyExpenses(raw) {
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (isObj(raw)) return Object.entries(raw).flatMap(([dayId, list]) => (Array.isArray(list) ? list.filter(isObj).map((x) => ({ day_id: dayId, ...x })) : []));
  return [];
}

// ---------------------------------------------------------------------
// 导入到哪一趟
// ---------------------------------------------------------------------

/**
 * @param {Array<{ id: string, trip: object, role: string }>} entries  全部行程
 * @returns {{ id: string, title: string, sure: boolean } | null}  sure：就是台湾行程（不是猜的）
 */
export function pickLegacyTarget(entries, at = new Date()) {
  const editable = (entries || []).filter((e) => e?.trip && (e.role === 'owner' || e.role === 'editor'));
  const exact = editable.find((e) => e.id === LEGACY_TRIP_ID);
  if (exact) return { id: exact.id, title: exact.trip.title, sure: true };
  const named = editable.find((e) => /台湾|臺灣|taiwan/i.test(String(e.trip.title || '')));
  if (named) return { id: named.id, title: named.trip.title, sure: false };
  const taipei = editable.filter((e) => e.trip.timezone === 'Asia/Taipei')
    .sort((a, b) => (tripPhase(a.trip, at).phase === 'ended' ? 0 : 1) - (tripPhase(b.trip, at).phase === 'ended' ? 0 : 1));
  if (taipei[0]) return { id: taipei[0].id, title: taipei[0].trip.title, sure: false };
  return editable[0] ? { id: editable[0].id, title: editable[0].trip.title, sure: false } : null;
}

// ---------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------

const fold = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const text = (s) => (typeof s === 'string' ? s.trim() : '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 新建行的确定 id（和导入脚本同一个命名空间：<行程>:<key>） */
export function legacyRowId(tripId, kind, legacyId) {
  return uuidv5(`${tripId}:${kind}:legacy-${String(legacyId)}`);
}

/** 天：'d3' → day 行 */
function dayMapper(days) {
  const sorted = [...days].filter((d) => d && DATE_RE.test(d.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  const byLegacy = new Map();
  for (const d of sorted) if (d.extra?.legacy_id) byLegacy.set(String(d.extra.legacy_id), d);
  return (legacyDayId) => {
    const key = String(legacyDayId || '');
    if (byLegacy.has(key)) return byLegacy.get(key);
    const m = /^d(\d{1,2})$/.exec(key);
    return m ? sorted[Number(m[1]) - 1] || null : null;
  };
}

/** 旧条目 id 'd3-1500'（-b 之类的后缀也认）→ 新条目；返回 { item } 或 { reason } */
function itemMapper(items, dayOf) {
  const live = items.filter((i) => i && !i.deleted_at);
  const byLegacy = new Map(live.filter((i) => i.legacy_id).map((i) => [String(i.legacy_id), i]));
  return (legacyId) => {
    const id = String(legacyId);
    if (byLegacy.has(id)) return { item: byLegacy.get(id) };
    const m = /^(d\d{1,2})-(\d{2})(\d{2})(?:-[a-z0-9]+)?$/.exec(id);
    if (!m) return { reason: '新版里找不到这个条目' };
    const day = dayOf(m[1]);
    if (!day) return { reason: '新版里没有这一天' };
    const hhmm = `${m[2]}:${m[3]}`;
    const hits = live.filter((i) => i.day_id === day.id && (i.variant || 'primary') === 'primary' && String(i.start_time || '').slice(0, 5) === hhmm);
    if (hits.length === 1) return { item: hits[0] };
    return { reason: hits.length ? '同一时间有好几个条目，没法确定是哪一个' : '新版里找不到这个条目' };
  };
}

function placeMatcher(places, reviews) {
  const byKey = new Map();
  for (const r of reviews) if (r?.extra?.legacy_spot_key) byKey.set(String(r.extra.legacy_spot_key), r.place_id);
  const byName = new Map();
  for (const p of places) {
    for (const n of [p.name, p.name_local, p.name_en, ...(Array.isArray(p.aliases) ? p.aliases : [])]) {
      const f = fold(n);
      if (f && !byName.has(f)) byName.set(f, p);
    }
  }
  const byId = new Map(places.map((p) => [p.id, p]));
  return (spotKey) => {
    if (byKey.has(spotKey)) return byId.get(byKey.get(spotKey)) || null;
    const name = String(spotKey).replace(/^spot-/, '').replace(/^[^-]*-/, '');
    return byName.get(fold(name)) || byName.get(fold(String(spotKey).replace(/^spot-/, ''))) || null;
  };
}

/** 旧评级里的一条「吃了什么 / 买了什么」→ LogEntry（第一行当名字，其余放备注）；照片是旧的公开链接，单独收集 */
function logEntry(x) {
  const t = text(x?.text) || text(x?.name);
  if (!t) return null;
  const [first, ...rest] = t.split(/\n+/);
  const name = first.length > 40 ? `${first.slice(0, 39)}…` : first;
  const note = [first.length > 40 ? first : '', ...rest].filter(Boolean).join('\n');
  return note ? { name, note } : { name };
}

function photoUrls(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    for (const p of Array.isArray(x?.photos) ? x.photos : []) {
      const u = typeof p === 'string' ? p : p?.url;
      if (typeof u === 'string' && /^https:\/\//.test(u)) out.push(u);
    }
  }
  return out;
}

/** 合并日记正文：已经包含就不再加 */
export function mergeBody(existing, addition) {
  const a = text(existing);
  const b = text(addition);
  if (!b) return a;
  if (!a) return b;
  if (fold(a).includes(fold(b))) return a;
  return `${a}\n\n${b}`;
}

/** 成员解析：邮箱 / 显示名 / 邮箱前缀 / 「我」→ user_id */
function memberResolver(members, userId) {
  const list = (members || []).filter((m) => m?.user_id);
  return (handle) => {
    const h = fold(handle);
    if (!h) return null;
    if (h === '我' || h === 'me') return userId;
    const hit = list.find((m) => fold(m.email) === h || fold(m.display_name) === h || fold(String(m.email || '').split('@')[0]) === h);
    return hit?.user_id || null;
  };
}

function otherMember(members, uid) {
  return (members || []).filter((m) => m?.user_id && m.user_id !== uid && (m.role === 'owner' || m.role === 'editor'))[0]?.user_id
    || (members || []).find((m) => m?.user_id && m.user_id !== uid)?.user_id || null;
}

/** 金额：旧版可能存成字符串 */
function amountOf(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 个人记账一条 → expenses 的值（不能导入时返回 { reason }）。
 * forWhom 和 paidBy 都是相对“记的人”说的（旧版 iPaidAbsolute / myBenefitAbsolute）。
 */
export function ledgerEntryToExpense(e, { tripId, home = 'HKD', userId, members, rate }) {
  if (e.type === 'income') return { reason: '收入不导入（新版账本只记支出）' };
  const amount = amountOf(e.amount);
  if (!(amount > 0)) return { reason: '金额不对' };
  if (!DATE_RE.test(String(e.date || ''))) return { reason: '没有日期' };
  const currency = normalizeCurrency(e.currency || 'HKD');
  const resolve = memberResolver(members, userId);
  const adder = resolve(e.addedBy) || userId;
  const partner = otherMember(members, adder);
  const payer = e.paidBy === 'partner' ? partner || adder : adder;
  const forWhom = e.forWhom || 'me';
  let split;
  if (forWhom === 'shared') split = partner ? { mode: 'equal', user_ids: [adder, partner] } : { mode: 'personal' };
  else {
    const beneficiary = forWhom === 'partner' ? partner || adder : adder;
    split = beneficiary === payer ? { mode: 'personal' } : { mode: 'amounts', shares: [{ user_id: beneficiary, amount }] };
  }
  const fx = currency === home ? 1 : rate?.(currency, home) ?? null;
  return {
    values: {
      id: legacyRowId(tripId, 'expense', `pl-${e.id}`),
      amount,
      currency,
      date: e.date,
      category: EXPENSE_CATEGORIES.has(e.category) ? e.category : '其他',
      description: text(e.note) || null,
      home_currency: home,
      fx_rate: fx,
      amount_home: fx === null ? null : roundMoney(amount * fx, home),
      paid_by_user_id: payer,
      split,
      extra: { legacy_source: 'personalLedger', legacy_id: String(e.id) },
    },
  };
}

/** 共同账本的一条（旧 expenses 行）→ expenses 的值 */
export function sharedExpenseToExpense(x, { tripId, home = 'HKD', userId, members, rate, dateOfDay }) {
  const amount = amountOf(x.amount);
  if (!(amount > 0)) return { reason: '金额不对' };
  const date = DATE_RE.test(String(x.date || '')) ? x.date : dateOfDay?.(x.day_id) || null;
  const currency = normalizeCurrency(x.currency || 'HKD');
  const resolve = memberResolver(members, userId);
  const paidRaw = x.paid_by ?? x.paidBy;
  const payer = resolve(paidRaw) || userId;
  const splitWith = (Array.isArray(x.split_with) ? x.split_with : Array.isArray(x.splitWith) ? x.splitWith : []).map(resolve).filter(Boolean);
  const people = [...new Set(splitWith)];
  let split;
  if (people.length >= 2) split = { mode: 'equal', user_ids: people };
  else if (people.length === 1 && people[0] !== payer) split = { mode: 'amounts', shares: [{ user_id: people[0], amount }] };
  else if (people.length === 1) split = { mode: 'personal' };
  else {
    const other = otherMember(members, payer);
    split = other ? { mode: 'equal', user_ids: [payer, other] } : { mode: 'personal' };
  }
  const hkd = amountOf(x.amount_hkd);
  const fx = currency === home ? 1 : home === 'HKD' && hkd > 0 ? Math.round((hkd / amount) * 1e8) / 1e8 : rate?.(currency, home) ?? null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x.id || '')) ? String(x.id).toLowerCase() : legacyRowId(tripId, 'expense', `shared-${x.id}`);
  const extra = { legacy_source: 'taiwanTrip2026Expenses', legacy_id: String(x.id ?? '') };
  if (paidRaw && !resolve(paidRaw)) extra.legacy_paid_by = String(paidRaw);
  return {
    values: {
      id: uuid,
      amount,
      currency,
      date,
      category: EXPENSE_CATEGORIES.has(x.category) ? x.category : '其他',
      description: text(x.description) || text(x.label) || null,
      home_currency: home,
      fx_rate: fx,
      amount_home: fx === null ? null : home === 'HKD' && hkd > 0 && currency !== home ? roundMoney(hkd, home) : roundMoney(amount * fx, home),
      paid_by_user_id: payer,
      split,
      extra,
    },
  };
}

/**
 * 预览：旧数据 → 每一类要做的事。
 * @param {{ state: object|null, expenses: object[] }} legacy  readLegacyData() 的结果
 * @param {{ trip: object, days: object[], items: object[], todos: object[], places: object[], reviews: object[],
 *           journal: object[], expenses: object[], members: object[] }} bundle  目标行程（数组；含软删除的账目）
 * @param {{ userId: string, rate?: (from: string, to: string) => number|null }} o
 * @returns {{ tripId: string, sections: Record<string, { key, label, unit, ops: object[], already: number, skipped: Array<{ name, reason }>, outside?: object[] }>, total: number }}
 */
export function planLegacyImport(legacy, bundle, { userId, rate } = {}) {
  const st = legacy?.state || normalizeLegacyState({});
  const trip = bundle.trip || {};
  const tripId = trip.id;
  const home = normalizeCurrency(trip.home_currency || 'HKD');
  const days = bundle.days || [];
  const items = bundle.items || [];
  const todos = (bundle.todos || []).filter(Boolean);
  const places = bundle.places || [];
  const reviews = bundle.reviews || [];
  const journal = bundle.journal || [];
  const expenses = bundle.expenses || [];
  const members = bundle.members || [];
  const dayOf = dayMapper(days);
  const itemOf = itemMapper(items, dayOf);
  const placeOf = placeMatcher(places, reviews);
  const sec = Object.fromEntries(SECTIONS.map((s) => [s.key, { ...s, ops: [], already: 0, skipped: [] }]));

  // 完成状态
  for (const [legacyId, on] of Object.entries(st.completedItems)) {
    if (on !== true) continue;
    const hit = itemOf(legacyId);
    if (!hit.item) sec.items.skipped.push({ name: legacyId, reason: hit.reason });
    else if (hit.item.status === 'done') sec.items.already += 1;
    else if (hit.item.status === 'skipped') sec.items.skipped.push({ name: hit.item.title, reason: '新版里标了「跳过」，不改' });
    else sec.items.ops.push({ kind: 'item-done', id: hit.item.id, title: hit.item.title });
  }

  // 确认状态
  const byConfirmKey = new Map(todos.filter((t) => t.extra?.legacy_confirm_key).map((t) => [String(t.extra.legacy_confirm_key), t]));
  const confirmByTitle = new Map(todos.filter((t) => t.list === 'confirm').map((t) => [fold(t.title), t]));
  for (const [key, on] of Object.entries(st.confirmStatus)) {
    if (on !== true) continue;
    const todo = byConfirmKey.get(key) || (key.startsWith('confirm-') ? confirmByTitle.get(fold(key.slice(8))) : null);
    const name = key.replace(/^confirm-/, '').replace(/^rem-/, '提醒 ');
    if (!todo) sec.confirm.skipped.push({ name, reason: key.startsWith('rem-') ? '旧版每天的小提醒，新版没有对应的待办' : '新版的待确认清单里没有这一项' });
    else if (todo.done) sec.confirm.already += 1;
    else sec.confirm.ops.push({ kind: 'todo-done', id: todo.id, title: todo.title });
  }

  // 评级
  const mineByPlace = new Map(reviews.filter((r) => r.user_id === userId).map((r) => [r.place_id, r]));
  const doneReviewKeys = new Set(reviews.filter((r) => r.user_id === userId && r.extra?.legacy_spot_key).map((r) => String(r.extra.legacy_spot_key)));
  for (const [key, r] of Object.entries(st.spotReviews)) {
    if (!isObj(r)) continue;
    const rating = RATING_FROM_LEGACY[r.rating] ?? null;
    const food = (Array.isArray(r.foodLog) ? r.foodLog : []).map(logEntry).filter(Boolean);
    const shop = (Array.isArray(r.shopLog) ? r.shopLog : []).map(logEntry).filter(Boolean);
    const notes = text(r.notes);
    const spotName = String(key).replace(/^spot-/, '').replace(/^[^-]*-/, '');
    if (!rating && !food.length && !shop.length && !notes) continue;
    const place = placeOf(key);
    if (!place) {
      sec.reviews.skipped.push({ name: spotName, reason: '新版的地点里没有同名的' });
      continue;
    }
    if (mineByPlace.has(place.id) || doneReviewKeys.has(key)) {
      sec.reviews.already += 1;
      continue;
    }
    const photos = [...photoUrls(r.foodLog), ...photoUrls(r.shopLog)];
    const extra = { legacy_spot_key: key };
    if (r.rating) extra.legacy_rating = String(r.rating);
    if (photos.length) extra.legacy_photo_urls = photos;
    const visited = typeof r.ratedAt === 'string' && !Number.isNaN(Date.parse(r.ratedAt)) ? r.ratedAt : null;
    sec.reviews.ops.push({
      kind: 'review', placeId: place.id, title: place.name, rating,
      values: { rating, notes: notes || null, food_log: food, shop_log: shop, visited_at: visited, extra },
    });
  }

  // 日记（日记 + 每天的备注）
  const dayKeys = [...new Set([...Object.keys(st.dayDiaries), ...Object.keys(st.dayNotes)])];
  for (const dk of dayKeys) {
    const diary = isObj(st.dayDiaries[dk]) ? st.dayDiaries[dk] : {};
    const note = text(st.dayNotes[dk]);
    const body = mergeBody(text(diary.text), note);
    const mood = MOOD_FROM_LEGACY[diary.mood] || null;
    if (!body && !mood) continue;
    const day = dayOf(dk);
    if (!day) {
      sec.journal.skipped.push({ name: dk, reason: '新版里没有这一天' });
      continue;
    }
    const mine = journal.find((j) => j.day_id === day.id && j.user_id === userId);
    if (mine) {
      const merged = mergeBody(mine.body, body);
      const moodChange = mood && !mine.mood;
      if (merged === text(mine.body) && !moodChange) {
        sec.journal.already += 1;
        continue;
      }
      const values = {};
      if (merged !== text(mine.body)) values.body = merged;
      if (moodChange) values.mood = mood;
      sec.journal.ops.push({ kind: 'journal', dayId: day.id, date: day.date, mode: 'append', title: day.date, values });
    } else {
      sec.journal.ops.push({ kind: 'journal', dayId: day.id, date: day.date, mode: 'new', title: day.date, values: { body, ...(mood ? { mood } : {}) } });
    }
  }

  // 打包
  const packing = todos.filter((t) => t.list === 'packing');
  const packByKey = new Map(packing.filter((t) => t.extra?.legacy_packing_key).map((t) => [String(t.extra.legacy_packing_key), t]));
  for (const [cat, entries] of Object.entries(st.packingList)) {
    if (!isObj(entries)) continue;
    for (const [name, on] of Object.entries(entries)) {
      const title = text(name);
      if (!title) continue;
      const legacyKey = `${cat}/${title}`;
      const todo = packByKey.get(legacyKey)
        || packing.find((t) => fold(t.title) === fold(title) && fold(t.category) === fold(cat))
        || packing.find((t) => fold(t.title) === fold(title));
      if (todo) {
        if (on !== true || todo.done) sec.packing.already += 1;
        else sec.packing.ops.push({ kind: 'todo-done', id: todo.id, title: todo.title });
      } else {
        sec.packing.ops.push({
          kind: 'todo-new', title,
          values: { id: legacyRowId(tripId, 'todo', `packing-${legacyKey}`), list: 'packing', category: text(cat) || '其他', title, done: on === true, extra: { legacy_packing_key: legacyKey } },
        });
      }
    }
  }

  // 个人记账（行程日期内的默认导入；其余的放 outside，用户勾选才导入）
  const expenseIds = new Set(expenses.map((x) => x.id));
  sec.ledger.outside = [];
  const start = trip.start_date;
  const end = trip.end_date || trip.start_date;
  for (const e of st.personalLedger) {
    const res = ledgerEntryToExpense(e, { tripId, home, userId, members, rate });
    if (!res.values) {
      sec.ledger.skipped.push({ name: text(e.note) || text(e.category) || '一笔', reason: res.reason });
      continue;
    }
    if (expenseIds.has(res.values.id)) {
      sec.ledger.already += 1;
      continue;
    }
    const op = { kind: 'expense', title: res.values.description || res.values.category, date: res.values.date, amount: res.values.amount, currency: res.values.currency, values: res.values };
    if (start && (res.values.date < start || res.values.date > end)) sec.ledger.outside.push(op);
    else sec.ledger.ops.push(op);
  }

  // 共同账本：云端没有的
  const dateOfDay = (dk) => dayOf(dk)?.date || null;
  const shared = [...(legacy?.expenses || []), ...(st.expenses || [])];
  const seenShared = new Set();
  for (const x of shared) {
    const res = sharedExpenseToExpense(x, { tripId, home, userId, members, rate, dateOfDay });
    if (!res.values) {
      sec.expenses.skipped.push({ name: text(x.description) || '一笔', reason: res.reason });
      continue;
    }
    if (seenShared.has(res.values.id)) continue;
    seenShared.add(res.values.id);
    if (expenseIds.has(res.values.id)) {
      sec.expenses.already += 1;
      continue;
    }
    sec.expenses.ops.push({ kind: 'expense', title: res.values.description || res.values.category, date: res.values.date, amount: res.values.amount, currency: res.values.currency, values: res.values });
  }

  const total = Object.values(sec).reduce((n, s) => n + s.ops.length, 0);
  return { tripId, sections: sec, total };
}

/** 每一类导入时用的动词 */
const VERBS = Object.freeze({ items: '标成完成', confirm: '勾上', reviews: '导入', journal: '写进', packing: '导入', ledger: '导入', expenses: '补上' });

/** 预览里一类的一句话：「标成完成 12 个条目 · 3 个条目已经有了 · 2 个条目对不上」 */
export function sectionSummary(s) {
  const parts = [];
  if (s.ops.length) parts.push(`${VERBS[s.key] || '导入'} ${s.ops.length} ${s.unit}`);
  if (s.outside?.length) parts.push(`行程日期以外还有 ${s.outside.length} 笔`);
  if (s.already) parts.push(`${s.already} ${s.unit}已经有了`);
  if (s.skipped.length) parts.push(`${s.skipped.length} ${s.unit}对不上`);
  return parts.join(' · ') || '没有要导入的';
}

/**
 * 照预览写进新版（全部同步发起，返回每一笔写入的结果；调用方 await 它们的 saved）。
 * @param {object} store  data/ 的 TripStore（目标行程）
 * @param {ReturnType<typeof planLegacyImport>} plan
 * @param {{ include?: string[], includeOutside?: boolean }} [o]  要导入哪几类（默认全部）、个人记账要不要带上行程日期以外的
 * @returns {{ counts: Record<string, number>, failed: Array<{ key: string, title: string, message: string }>, results: object[] }}
 */
export function applyLegacyImport(store, plan, { include, includeOutside = false } = {}) {
  const keys = include ? new Set(include) : new Set(Object.keys(plan.sections));
  const counts = {};
  const failed = [];
  const results = [];
  for (const s of SECTIONS) {
    const sec = plan.sections[s.key];
    if (!sec || !keys.has(s.key)) continue;
    const ops = s.key === 'ledger' && includeOutside ? [...sec.ops, ...(sec.outside || [])] : sec.ops;
    counts[s.key] = 0;
    for (const op of ops) {
      try {
        let r;
        if (op.kind === 'item-done') r = store.setItemStatus(op.id, 'done');
        else if (op.kind === 'todo-done') r = store.toggleTodo(op.id, true);
        else if (op.kind === 'todo-new') r = store.insert('todos', op.values, { label: `导入「${op.title}」` });
        else if (op.kind === 'review') r = store.saveReview(op.placeId, op.values);
        else if (op.kind === 'journal') r = store.saveJournal(op.dayId, op.values);
        else if (op.kind === 'expense') r = store.insert('expenses', op.values, { label: `导入「${op.title}」` });
        if (r) results.push(r);
        counts[s.key] += 1;
      } catch (error) {
        failed.push({ key: s.key, title: op.title || '', message: error?.message || '没有写进去' });
      }
    }
  }
  return { counts, failed, results };
}
