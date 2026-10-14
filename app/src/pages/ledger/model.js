// =====================================================================
// pages/ledger/model.js：账本页的纯逻辑（不碰 DOM，Node 里能直接测：test/unit/page-ledger.test.js）。
//
//   流水：    groupByDate(expenses, { timeZone, at, homeOf })      按消费日期分组（新 → 旧），每组带标题、笔数、折合港币小计
//             filterExpenses(expenses, { category, payer })         分类 / 付款人筛选
//             categoryCounts(expenses)                               每个分类几笔（筛选芯片上的数字）
//             splitLabel(e, names)                                   「平摊 · 每人 …」「个人」「按金额」
//   结算：    （扣掉已结清的转账、结清记录的读写在数据层 data/selectors.js：store.view.ledger.settlement）
//             settlementLines(transfers, names)                      「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」的结构
//   统计：    categoryBars(ledger) / dayBars(ledger) / peopleStats(ledger)
//
// 结算为什么存“转账”而不是“截止时间”：已结清 = 两个人之间真的付过一笔钱，所以记成
// { from, to, currency, amount }，算未结时从各人的净额里扣掉；以后再改旧账、补记旧账，差额自然体现为新的未结，
// 不会因为 created_at 的先后而算错（服务器时间和手机时间不一致也没关系）。
// =====================================================================

import { currencyMinorUnits, normalizeCurrency, roundMoney } from '../../lib/money.js';
import { formatDate, formatDayHeading, formatRelativeTime, tripDayNumber } from '../../lib/datetime.js';
import { fxStatus, formatRate } from '../../lib/services/fx.js';
import { now } from '../../lib/clock.js';
import { formatAmount } from '../../lib/money.js';

/** 记账分类（和数据库 CHECK 一致；顺序 = 筛选芯片的顺序） */
export const CATEGORIES = Object.freeze(['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他']);

/** 分类 → 分类色（tokens 的 --color-cat-N） */
export const CATEGORY_COLOR = Object.freeze({ 餐饮: 1, 交通: 2, 住宿: 3, 购物: 4, 门票: 5, 活动: 6, 其他: 7 });


/** 最近保存的一笔高亮多久（毫秒） */
export const FRESH_HIGHLIGHT_MS = 2600;

const SPLIT_NAMES = Object.freeze({ equal: '平摊', personal: '个人', amounts: '按金额' });

const toMinor = (amount, cur) => Math.round(Number(amount || 0) * 10 ** currencyMinorUnits(cur));
const fromMinor = (minor, cur) => roundMoney(minor / 10 ** currencyMinorUnits(cur), cur);
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------
// 流水
// ---------------------------------------------------------------------

/**
 * 按消费日期分组（新 → 旧；没有日期的归到最后一组「没写日期」）。组内保持传入顺序（store.view.expenses 已是新 → 旧）。
 * @param {object[]} expenses 未删除的记账
 * @param {{ timeZone?: string, startDate?: string, homeOf?: (e: object) => number|null, at?: Date }} o
 *   homeOf：一笔折合 home 币种多少（页面传 selectors.expenseHomeAmount 的 value）；at：“现在”（决定「今天 / 昨天」）
 * @returns {Array<{ key: string, date: string|null, primary: string, secondary: string|null, dayNo: number|null, items: object[], count: number, homeTotal: number|null }>}
 */
export function groupByDate(expenses, { timeZone, startDate, homeOf, at } = {}) {
  const groups = new Map();
  for (const e of expenses || []) {
    const key = e.date || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return byStr(b, a);
  });
  return keys.map((date) => {
    const items = groups.get(date);
    let homeTotal = 0;
    let complete = true;
    for (const e of items) {
      const v = homeOf ? homeOf(e) : null;
      if (v === null || v === undefined || !Number.isFinite(v)) complete = false;
      else homeTotal += v;
    }
    let primary = '没写日期';
    let secondary = null;
    let dayNo = null;
    if (date) {
      const h = formatDayHeading(date, { timeZone, at });
      primary = h.primary;
      secondary = h.secondary;
      dayNo = startDate ? tripDayNumber(date, startDate) : null;
      if (dayNo !== null && !(dayNo >= 1)) dayNo = null;
    }
    return { key: date || 'undated', date: date || null, primary, secondary, dayNo, items, count: items.length, homeTotal: complete ? homeTotal : null };
  });
}

/**
 * 筛选：category（中文分类，null = 全部）、payer（user_id，null = 全部）。
 */
export function filterExpenses(expenses, { category = null, payer = null } = {}) {
  return (expenses || []).filter((e) => {
    if (category && (CATEGORIES.includes(e.category) ? e.category : '其他') !== category) return false;
    if (payer && e.paid_by_user_id !== payer) return false;
    return true;
  });
}

/** 每个分类几笔（不认识的分类算「其他」） */
export function categoryCounts(expenses) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const e of expenses || []) out[CATEGORIES.includes(e.category) ? e.category : '其他'] += 1;
  return out;
}

/** 每个付款人几笔：{ user_id: n }（没记付款人的不算） */
export function payerCounts(expenses) {
  const out = {};
  for (const e of expenses || []) {
    if (!e.paid_by_user_id) continue;
    out[e.paid_by_user_id] = (out[e.paid_by_user_id] || 0) + 1;
  }
  return out;
}

/**
 * 怎么分的一句话。
 *   平摊（两人）→ { mode: 'equal', text: '平摊', detail: '每人 260,000₫' }（detail 由页面用 MoneyText 画，这里只给数字）
 *   个人      → { mode: 'personal', text: '个人', forId }（forId = 算谁的：付款人，或 amounts 里唯一那个人）
 *   按金额    → { mode: 'amounts', text: '按金额', shares: [{ id, amount }] }
 * @param {object} e 记账行
 * @param {string} currency 原币
 */
export function splitInfo(e, currency) {
  const split = e?.split && typeof e.split === 'object' ? e.split : {};
  const cur = normalizeCurrency(currency || e?.currency_iso || e?.currency);
  const amount = Number(e?.amount) || 0;
  if (split.mode === 'equal' && Array.isArray(split.user_ids) && split.user_ids.length) {
    const n = split.user_ids.length;
    return { mode: 'equal', text: SPLIT_NAMES.equal, ids: split.user_ids, perPerson: fromMinor(Math.round(toMinor(amount, cur) / n), cur), n };
  }
  if (split.mode === 'amounts' && Array.isArray(split.shares)) {
    const shares = split.shares.filter((s) => Number(s.amount)).map((s) => ({ id: s.user_id, amount: Number(s.amount) }));
    if (shares.length === 1 && toMinor(shares[0].amount, cur) === toMinor(amount, cur)) {
      return { mode: 'personal', text: SPLIT_NAMES.personal, forId: shares[0].id, forOther: shares[0].id !== e.paid_by_user_id };
    }
    return { mode: 'amounts', text: SPLIT_NAMES.amounts, shares };
  }
  if (split.mode === 'personal') return { mode: 'personal', text: SPLIT_NAMES.personal, forId: e?.paid_by_user_id || null, forOther: false };
  // 旧数据 / 空对象：看旧列 split_with
  if (Array.isArray(e?.split_with) && e.split_with.length > 1) return { mode: 'equal', text: SPLIT_NAMES.equal, ids: e.split_with, perPerson: fromMinor(Math.round(toMinor(amount, cur) / e.split_with.length), cur), n: e.split_with.length, legacy: true };
  return { mode: 'personal', text: SPLIT_NAMES.personal, forId: e?.paid_by_user_id || null, forOther: false, legacy: true };
}

// ---------------------------------------------------------------------
// 结算
// ---------------------------------------------------------------------

// 结清记录的读写、扣掉已结清的转账、生成一条记录：整合后都在数据层 data/selectors.js
// （readSettlements / withSettlements / applySettlements / settlementRecord / LEDGER_SETTLEMENTS_KEY）。
// 页面直接用 store.view.ledger.settlement、store.settleLedger() / undoSettlement()；行程概览的回顾看的是同一份。

/**
 * 「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」：同一对人（from → to）的几种币种并成一行。
 * @param {Array<{ currency, transfers }>} outstanding
 * @param {(id: string) => string} nameOf
 * @returns {Array<{ from: string, to: string, fromName: string, toName: string, amounts: Array<{ currency: string, amount: number }> }>}
 */
export function settlementLines(outstanding, nameOf = (id) => id) {
  const lines = new Map();
  for (const c of outstanding || []) {
    for (const t of c.transfers) {
      const key = `${t.from}→${t.to}`;
      if (!lines.has(key)) lines.set(key, { from: t.from, to: t.to, fromName: nameOf(t.from), toName: nameOf(t.to), amounts: [] });
      lines.get(key).amounts.push({ currency: c.currency, amount: t.amount });
    }
  }
  return [...lines.values()];
}

/**
 * 一条结清记录（或一组还没结的转账）说成一句话：「Cathy 给 Jeremy ¥2,625.63 + HK$418.66」（按币种分别列、不换汇）。
 * 确认框里说「要记下哪几笔」、「上次结清」那一行说「当时结了多少」都用它（10-14 现场走查 P2-9）。
 * @param {Array<{ from, to, currency, amount }>} transfers 平铺的转账（结清记录的 transfers）
 * @param {(id: string) => string} nameOf
 * @param {{ verb?: string }} [o] verb：「给」/「给了」
 */
export function transfersText(transfers, nameOf = (id) => id, { verb = '给' } = {}) {
  const lines = new Map();
  for (const t of transfers || []) {
    if (!t || !(Number(t.amount) > 0)) continue;
    const key = `${t.from}→${t.to}`;
    if (!lines.has(key)) lines.set(key, { from: t.from, to: t.to, parts: [] });
    lines.get(key).parts.push(formatAmount(Number(t.amount), t.currency));
  }
  return [...lines.values()].map((l) => `${nameOf(l.from)} ${verb} ${nameOf(l.to)} ${l.parts.join(' + ')}`).join('；');
}

/** 还没结的（按币种分组的 outstanding）→ 平铺的转账 */
export function flattenOutstanding(outstanding) {
  const out = [];
  for (const c of outstanding || []) for (const t of c.transfers || []) out.push({ from: t.from, to: t.to, currency: c.currency, amount: t.amount });
  return out;
}

// ---------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------

/**
 * 分类横条：按折合 home 币种的金额从大到小，ratio = 占最大一项的比例（横条长度）、share = 占总额的比例。
 * @param {{ byCategory: Array<{ category, total, count }>, home: { total } }} ledger
 */
export function categoryBars(ledger) {
  const rows = (ledger?.byCategory || []).filter((x) => x.count > 0);
  const max = rows.reduce((m, x) => Math.max(m, x.total), 0);
  const sum = rows.reduce((m, x) => m + x.total, 0);
  return rows.map((x) => ({
    category: x.category,
    total: x.total,
    count: x.count,
    ratio: max > 0 ? x.total / max : 0,
    share: sum > 0 ? x.total / sum : 0,
    color: CATEGORY_COLOR[x.category] || CATEGORY_COLOR.其他,
  }));
}

/**
 * 按天横条（旧 → 新，没日期的放最后）。
 * @param {{ byDate: Array<{ date, total, count }> }} ledger
 * @param {{ timeZone?: string, startDate?: string, at?: Date }} [o] at：“现在”（决定「今天 / 昨天」）
 */
export function dayBars(ledger, { timeZone, startDate, at } = {}) {
  const rows = [...(ledger?.byDate || [])].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return byStr(a.date, b.date);
  });
  const max = rows.reduce((m, x) => Math.max(m, x.total), 0);
  return rows.map((x) => {
    const dayNo = x.date && startDate ? tripDayNumber(x.date, startDate) : null;
    return {
      date: x.date,
      label: x.date ? formatDate(x.date, { timeZone, at, weekday: true, relative: true }) : '没写日期',
      dayNo: dayNo !== null && dayNo >= 1 ? dayNo : null,
      total: x.total,
      count: x.count,
      ratio: max > 0 ? x.total / max : 0,
    };
  });
}

/**
 * 按人：每个人付了多少、该承担多少（各币种分开 + 折合 home）。
 * @param {{ currencies: Array, home: { currency, paid, share, net }, people: Array<{ id, name, color, member }> }} ledger
 * @returns {Array<{ id, name, color, member, paidHome, shareHome, netHome, byCurrency: Array<{ currency, paid, share, net }> }>}
 */
export function peopleStats(ledger) {
  const people = (ledger?.people || []).filter((p) => p.member || Object.keys(ledger?.home?.paid || {}).includes(p.id));
  const maxHome = Math.max(0, ...people.map((p) => Math.max(ledger?.home?.paid?.[p.id] || 0, ledger?.home?.share?.[p.id] || 0)));
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color || null,
    member: Boolean(p.member),
    paidHome: ledger?.home?.paid?.[p.id] || 0,
    shareHome: ledger?.home?.share?.[p.id] || 0,
    netHome: ledger?.home?.net?.[p.id] || 0,
    paidRatio: maxHome > 0 ? (ledger?.home?.paid?.[p.id] || 0) / maxHome : 0,
    shareRatio: maxHome > 0 ? (ledger?.home?.share?.[p.id] || 0) / maxHome : 0,
    byCurrency: (ledger?.currencies || [])
      .map((c) => ({ currency: c.currency, paid: c.paid?.[p.id] || 0, share: c.share?.[p.id] || 0, net: c.net?.[p.id] || 0 }))
      .filter((x) => x.paid || x.share),
  }));
}

/**
 * 总花费卡片里汇率那一行小字：{ text, tone } 或 null（没有外币就不用说汇率）。
 *   离线（设备断网，或汇率服务只拿到旧数据 / 内置参考值）→ 「离线 · 按最近一次汇率折算（5 小时前更新）」，tone 'offline'
 *   过期（超过 24 小时）→ 「汇率 2 天前更新，可能已过期」，tone 'warning'
 *   正常 → 「汇率 · 3 小时前更新 · 1 港币 ≈ 3,294 越南盾」（演示模式写「演示汇率」）
 * 汇率服务 24 小时内不会重新请求，自己不知道设备断了网，所以要把 data 的 online 传进来。
 * @param {{ snapshot: object|null, isOnline: boolean, foreign: string|null, approxCount?: number, at?: Date }} o
 *   foreign：第一种外币（汇率那一句写它）；approxCount：有几笔没记当时的汇率、按参考汇率估算
 */
export function fxNote({ snapshot: snap, isOnline, foreign, approxCount = 0, at = now() }) {
  if (!foreign) return null;
  const st = fxStatus(snap, { now: at });
  const when = snap?.providerUpdatedAt || snap?.fetchedAt;
  const updated = when ? `${formatRelativeTime(when, { now: at })}更新` : null;
  let text;
  let tone;
  if (snap?.source === 'fallback' || (!isOnline && !snap)) {
    text = '离线 · 暂时按内置参考汇率折算';
    tone = 'offline';
  } else if (!isOnline || snap?.offline) {
    text = `离线 · 按最近一次汇率折算${updated ? `（${updated}）` : ''}`;
    tone = 'offline';
  } else if (snap?.stale) {
    text = `汇率 ${updated || '很久以前更新'}，可能已过期`;
    tone = 'warning';
  } else if (snap) {
    const rate = formatRate(snap, foreign);
    text = `${st.text}${rate ? ` · ${rate}` : ''}`;
  } else text = st.text;
  if (approxCount > 0 && tone !== 'warning') text += ` · ${approxCount} 笔按参考汇率估算`;
  return { text, tone };
}

/**
 * 「结清之后新记的」有几笔（只用于显示）。结清记录里存了当时一共几笔（count）就按笔数差算（手机和服务器的时钟不一致、
 * 演示数据的 created_at 是编出来的都不受影响）；没有 count 的旧记录按 created_at 粗略比较。
 * @param {object[]} expenses 现在未删除的记账
 * @param {{ at?: string, count?: number }|null} last 最近一次结清记录
 */
export function countSince(expenses, last) {
  if (!last) return 0;
  const list = expenses || [];
  if (Number.isFinite(Number(last.count)) && last.count !== null && last.count !== undefined) return Math.max(0, list.length - Number(last.count));
  const t = Date.parse(last.at || '');
  if (!Number.isFinite(t)) return 0;
  return list.filter((e) => e.created_at && Date.parse(e.created_at) > t).length;
}
