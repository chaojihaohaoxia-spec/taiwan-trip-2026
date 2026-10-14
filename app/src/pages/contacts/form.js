// =====================================================================
// pages/contacts/form.js：添加 / 编辑联系人面板（ContactSheet.jsx）的纯逻辑（test/unit/page-tips.test.js 的「联系人表单」一节）。
//
//   CONTACT_SHEET / newArg / parseArg     面板 id 和网址参数：'new'、'new-<类别>'（预选类别）、或联系人 id（编辑）
//   FIELDS                                联系方式的几栏（电话、WhatsApp、Zalo、邮箱、微信、LINE）：标签、输入法、提示
//   initialForm / isDirty                 表单初值（编辑时从这一行来）、改没改过
//   validateForm                          名字必填；号码至少 3 位、WhatsApp / Zalo 至少 7 位；邮箱格式 → { 字段: 中文原因 }
//   formToValues / changedValues          表单 → 要写进数据库的列（去空格、空的写 null）；编辑时只留改了的
//   nextSort                              新联系人排在最后
// =====================================================================

import { CATEGORY_ORDER, CATEGORY_TITLES, phoneDigits } from './model.js';

export const CONTACT_SHEET = 'contact-edit';

/** 新建的网址参数：'new' 或 'new-hotel'（从「酒店」那一类点的添加：预选类别） */
export function newArg(category) {
  return category && Object.hasOwn(CATEGORY_TITLES, category) ? `new-${category}` : 'new';
}

/**
 * 网址参数 → { mode: 'new', category } | { mode: 'edit', id }；没有参数也算新建。
 * @param {string|null|undefined} arg
 */
export function parseArg(arg) {
  const a = String(arg ?? '').trim();
  if (!a || a === 'new') return { mode: 'new', category: 'other' };
  const m = /^new-([a-z_]+)$/.exec(a);
  if (m) return { mode: 'new', category: Object.hasOwn(CATEGORY_TITLES, m[1]) ? m[1] : 'other' };
  return { mode: 'edit', id: a };
}

/** 类别的选项（紧急在最前，和页面分组同一个顺序） */
export const CATEGORY_OPTIONS = Object.freeze(CATEGORY_ORDER.map((k) => ({ value: k, label: CATEGORY_TITLES[k] })));

/** 联系方式的几栏 */
export const FIELDS = Object.freeze([
  { key: 'phone', label: '电话', type: 'tel', inputMode: 'tel', placeholder: '+84 …（带国家码）', autoComplete: 'tel' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'tel', inputMode: 'tel', placeholder: '带国家码', autoComplete: 'off', samePhone: true },
  { key: 'zalo', label: 'Zalo', type: 'tel', inputMode: 'tel', placeholder: '越南号码', autoComplete: 'off', samePhone: true },
  { key: 'email', label: '邮箱', type: 'email', inputMode: 'email', placeholder: 'name@example.com', autoComplete: 'email' },
  { key: 'wechat', label: '微信', type: 'text', inputMode: 'text', placeholder: '微信号', autoComplete: 'off' },
  { key: 'line', label: 'LINE', type: 'text', inputMode: 'text', placeholder: 'LINE ID', autoComplete: 'off' },
]);

const TEXT_KEYS = Object.freeze(['name', 'role', 'phone', 'whatsapp', 'zalo', 'email', 'wechat', 'line', 'note']);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * 表单初值。
 * @param {object|null} contact 编辑时的那一行
 * @param {{ category?: string }} [o] 新建时预选的类别
 */
export function initialForm(contact, { category = 'other' } = {}) {
  const f = { category: contact ? (Object.hasOwn(CATEGORY_TITLES, contact.category) ? contact.category : 'other') : category };
  for (const k of TEXT_KEYS) f[k] = str(contact?.[k]);
  return f;
}

/** 改没改过（只看去掉首尾空格以后的字） */
export function isDirty(form, initial) {
  if (!form || !initial) return false;
  if (form.category !== initial.category) return true;
  return TEXT_KEYS.some((k) => str(form[k]).trim() !== str(initial[k]).trim());
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 检查：名字必填；电话至少 3 位数字（113 这种急救号也要能存）；WhatsApp / Zalo 至少 7 位（要带国家码才发得出去）；邮箱格式。
 * @returns {Record<string, string>} 有问题的字段 → 中文原因（空对象 = 没问题）
 */
export function validateForm(form) {
  const errors = {};
  if (!str(form?.name).trim()) errors.name = '写个名字，比如「酒店前台」「接机司机」';
  const phone = str(form?.phone).trim();
  if (phone && phoneDigits(phone).length < 3) errors.phone = '号码太短了';
  for (const k of ['whatsapp', 'zalo']) {
    const v = str(form?.[k]).trim();
    if (v && phoneDigits(v).length < 7) errors[k] = '至少 7 位数字（WhatsApp / Zalo 要带国家码）';
  }
  const email = str(form?.email).trim();
  if (email && !EMAIL.test(email)) errors.email = '邮箱格式不对';
  return errors;
}

/** 表单 → 数据库的列：去掉首尾空格，空的写 null；名字必有；备注保留中间的换行 */
export function formToValues(form) {
  const out = { category: Object.hasOwn(CATEGORY_TITLES, form?.category) ? form.category : 'other' };
  for (const k of TEXT_KEYS) {
    const v = str(form?.[k]).trim();
    out[k] = v || null;
  }
  out.name = out.name || '';
  return out;
}

/** 编辑：只留和原来不一样的列（原来是 null、现在空着也算没变） */
export function changedValues(values, row) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const before = row?.[k] === undefined ? null : row[k];
    if ((before ?? null) !== (v ?? null)) out[k] = v;
  }
  return out;
}

/** 新联系人的 sort：排在最后（现有最大值 + 1；没有就是 0） */
export function nextSort(contacts) {
  let max = -1;
  for (const c of contacts || []) if (Number.isFinite(c?.sort) && c.sort > max) max = c.sort;
  return max + 1;
}
