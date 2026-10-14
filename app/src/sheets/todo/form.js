// =====================================================================
// sheets/todo/form.js：待办弹层的表单逻辑（纯函数，test/unit/page-lists.test.js 覆盖）。
//
//   initialForm(row, prefill, ctx)   → 表单初值（编辑：这一行；新建：网址里预填的清单 / 条目 / 预订 / 哪天）
//   validateForm(form)               → 中文的出错原因，没问题 null
//   formToValues(form, ctx)          → 写进 todos 的字段（新建 insert、编辑 update 都用它；数据层只提交真正改了的）
//   isDirty(form, initial)           → 有没有改过（关面板前问“放弃未保存的内容？”）
//   linkSummaryText(form, ctx)       → 「关联」收起时的一行摘要（「D2 · 预订「椰影湾酒店」」）
//
// 表单里的值：list、title、note、qty（数字或 null = 不计数量）、category、assignee（'' = 共用 / 不指定）、
// dueDate / dueTime（行程时区里的日期和钟点，'' = 没有截止时间）、day / booking / item（'' = 不关联）、done。
// =====================================================================

import { LISTS, normalizeList, inferCategory, nextSort, dueParts, dueFromParts } from '../../pages/lists/model.js';
import { formatDate } from '../../lib/datetime.js';

/** 标题最长多少字（和快速添加一样） */
export const TITLE_MAX = 200;
/** 备注最长 */
export const NOTE_MAX = 1000;
/** 自定义分类最长 */
export const CATEGORY_MAX = 8;

/**
 * 表单初值。
 * @param {object|null} row  编辑的那一行（新建时 null）
 * @param {{ list?: string, item?: string, booking?: string, day?: string }} [prefill]  新建时网址里预填的（长名字）
 * @param {{ timeZone: string, items?: Map, bookings?: Map, days?: Map }} ctx
 */
export function initialForm(row, prefill = {}, { timeZone, items, bookings, days } = {}) {
  if (row) {
    const due = dueParts(row.due_at, timeZone);
    return {
      list: normalizeList(row.list) || 'todo',
      title: row.title || '',
      note: row.note || '',
      qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
      category: row.category || '',
      assignee: row.assignee_user_id || '',
      dueDate: due.date,
      dueTime: due.time,
      day: row.day_id || '',
      booking: row.booking_id || '',
      item: row.item_id || '',
      done: Boolean(row.done),
    };
  }
  const has = (map, id) => Boolean(id && (!map || map.has(id)));
  const item = has(items, prefill.item) ? prefill.item : '';
  const booking = has(bookings, prefill.booking) ? prefill.booking : '';
  let day = has(days, prefill.day) ? prefill.day : '';
  // 只给了条目：天从条目推（帮手的参数太长时会丢掉 day，见 sheets/README.md）
  if (!day && item) day = items?.get(item)?.day_id || '';
  // 从预订打开、没说放哪个清单：多半是「去确认」
  const list = normalizeList(prefill.list) || (booking && !item ? 'confirm' : 'todo');
  return {
    list,
    title: '',
    note: '',
    qty: list === 'packing' ? 1 : null,
    category: '',
    assignee: '',
    dueDate: '',
    dueTime: '',
    day,
    booking,
    item,
    done: false,
  };
}

/** 中文出错原因；没问题 null */
export function validateForm(form) {
  const title = String(form.title || '').trim();
  if (!title) return '先写一下是什么';
  if (title.length > TITLE_MAX) return `标题太长了（最多 ${TITLE_MAX} 个字）`;
  if (String(form.note || '').length > NOTE_MAX) return `备注太长了（最多 ${NOTE_MAX} 个字）`;
  if (form.qty !== null && form.qty !== undefined && (!Number.isInteger(form.qty) || form.qty < 0 || form.qty > 999)) return '数量只能是 0–999 的整数';
  if (form.dueTime && !form.dueDate) return '截止时间要先选日期';
  if (String(form.category || '').trim().length > CATEGORY_MAX) return `分类名最多 ${CATEGORY_MAX} 个字`;
  return null;
}

/**
 * 表单 → todos 的字段。
 *   - 打包清单的分类：选了用选的，没选按标题猜，猜不出「其他」；别的清单保留原来的分类（换清单时不丢）
 *   - 换了清单（或新建）：排到那个清单最后（sort 比现有都大）
 * @param {object} form
 * @param {{ timeZone: string, row?: object|null, listRows?: object[] }} ctx  row：编辑的那一行；listRows：目标清单现有的行
 */
export function formToValues(form, { timeZone, row = null, listRows = [] } = {}) {
  const title = String(form.title || '').trim();
  const note = String(form.note || '').trim();
  const category = String(form.category || '').trim();
  const v = {
    list: form.list,
    title,
    note: note || null,
    qty: form.qty === null || form.qty === undefined ? null : Number(form.qty),
    assignee_user_id: form.assignee || null,
    due_at: dueFromParts(form.dueDate, form.dueTime, timeZone),
    day_id: form.day || null,
    booking_id: form.booking || null,
    item_id: form.item || null,
  };
  if (form.list === 'packing') v.category = category || inferCategory(title) || '其他';
  else if (category || row?.category) v.category = category || null;
  if (row) v.done = Boolean(form.done);
  if (!row || row.list !== form.list) v.sort = nextSort(listRows.filter((r) => r.id !== row?.id));
  return v;
}

/**
 * 编辑时真正要提交的字段：和“打开面板那一刻”的表单（initial）算出来的值比，只留改了的——
 * 不和现在的行比：面板开着时另一台手机勾上了这一项 / 改了数量，这边只改标题保存，不会把对方的改动改回去（代码评审 P1-1）。
 * @param {object} form 现在的表单
 * @param {object} initial 打开时的表单
 * @param {{ timeZone: string, row: object, listRows?: object[] }} o row：打开时的那一行
 * @returns {Record<string, any>}
 */
export function formPatch(form, initial, { timeZone, row, listRows = [] } = {}) {
  const next = formToValues(form, { timeZone, row, listRows });
  const before = formToValues(initial, { timeZone, row, listRows });
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => !same(v, before[k])));
}

const SAME_KEYS = ['list', 'title', 'note', 'qty', 'category', 'assignee', 'dueDate', 'dueTime', 'day', 'booking', 'item', 'done'];

/** 改过没有（标题、备注前后空白不算） */
export function isDirty(form, initial) {
  if (!form || !initial) return false;
  return SAME_KEYS.some((k) => {
    const a = form[k];
    const b = initial[k];
    if (typeof a === 'string' || typeof b === 'string') return String(a ?? '').trim() !== String(b ?? '').trim();
    return a !== b;
  });
}

/** 弹层标题：新建「加一项待办」/ 编辑「编辑待办」（跟着表单里选的清单变） */
export function sheetTitle(list, mode) {
  const meta = LISTS[list] || LISTS.todo;
  return mode === 'edit' ? meta.editTitle : meta.newTitle;
}

/** 摘要里的名字太长就截断（整行还要放得下别的） */
const clip = (t, n = 12) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * 「关联」收起时的一行摘要：哪天 · 预订 · 条目；一个都没有 →「不关联（可以关联哪天、预订或条目）」。
 *   linkSummaryText({ day: 'd2', booking: 'b1' }, …) → 'D2 · 预订「椰影湾酒店」'
 * 找不到的（被删掉了）不说。
 * @param {{ day?: string, booking?: string, item?: string }} form
 * @param {{ days?: Map, bookings?: Map, items?: Map, dayNumber?: (date: string) => number|null }} ctx
 */
export function linkSummaryText(form, { days, bookings, items, dayNumber } = {}) {
  const parts = [];
  const day = form.day ? days?.get(form.day) : null;
  if (day?.date) {
    const n = dayNumber?.(day.date);
    parts.push(n ? `D${n}` : formatDate(day.date, { weekday: false }));
  }
  const b = form.booking ? bookings?.get(form.booking) : null;
  if (b) parts.push(`预订「${clip(b.title || '预订')}」`);
  const it = form.item ? items?.get(form.item) : null;
  if (it && !it.deleted_at) parts.push(`条目「${clip(it.title || '条目')}」`);
  return parts.length ? parts.join(' · ') : '不关联（可以关联哪天、预订或条目）';
}
