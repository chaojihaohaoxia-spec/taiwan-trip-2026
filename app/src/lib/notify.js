// =====================================================================
// lib/notify.js：轻量的“提示”总线（复制成功、离线汇率、操作失败……）。
//
// lib/ 在依赖链最底层，不能直接 import 界面组件；所以 lib 里的工具只“发”提示，
// 由 overlay/ 的 Toast 宿主“收”并显示。字段和 overlay/toast-model.js 的 toast() 一致，
// 宿主只要挂一行就接上了：
//
//   // 收（Toast 宿主挂一次）
//   import { onNotify } from '../lib/notify.js';
//   useEffect(() => onNotify((notice) => toast(notice)), []);     // 返回值是取消订阅
//
//   // 发（任何地方）
//   import { notify } from '../lib/notify.js';
//   notify('已复制当天行程', { tone: 'success', key: 'copy' });
//   语气 tone：'neutral'（默认）| 'success' | 'warning' | 'danger' | 'info'——和 ui/ 的 Badge、EmptyState 同一套词，
//   对应 tokens.css 的 --color-success / warning / danger / info；旧写法 'default' 等于 'neutral'。
//   notify({ message: '复制失败，请长按文字手动复制', tone: 'danger' });
//   notify({ message: '已删除', action: { label: '撤销', onClick: undo } });
//
// 还没有人订阅时提示不会丢：最后一条留在 lastNotice 信号里，Toast 宿主挂上后可以补显示。
// 读屏朗读（aria-live）、排队、同 key 替换、显示时长的默认值都由 Toast 宿主负责，这里只传数据。
// =====================================================================

import { signal } from '@preact/signals';

/** 语气（全站统一的一套词：提示、Toast、角标、空状态都用它；overlay/toast-model.js 的 TOAST_TONES 就是它） */
export const NOTICE_TONES = Object.freeze(['neutral', 'success', 'warning', 'danger', 'info']);

/** 语气规范化：认识的原样返回；'default'（旧写法）和不认识的都当 'neutral' */
export function normalizeTone(tone) {
  return NOTICE_TONES.includes(tone) ? tone : 'neutral';
}

const listeners = new Set();
let seq = 0;

/**
 * 最后一条提示（信号）：{ id, message, tone, duration?, action?, key?, at }
 * Toast 宿主可以直接读它（effect 里订阅），也可以用 onNotify。
 */
export const lastNotice = signal(null);

/**
 * 发一条提示。
 * @param {string | { message: string, tone?: 'neutral'|'success'|'warning'|'danger'|'info', duration?: number,
 *                    action?: { label: string, onClick: () => void }, key?: string }} input
 * @param {object} [extra] 和 input 合并：notify('已删除', { action: { label: '撤销', onClick } })
 * @returns {object} 发出去的提示
 */
export function notify(input, extra = {}) {
  const base = typeof input === 'string' ? { message: input } : { ...(input || {}) };
  const merged = { ...base, ...extra };
  const notice = {
    id: (seq += 1),
    message: String(merged.message ?? '').trim(),
    tone: normalizeTone(merged.tone),
    at: Date.now(),
  };
  if (!notice.message) return null;
  if (Number.isFinite(merged.duration) || merged.duration === Infinity) notice.duration = merged.duration;
  if (merged.key !== undefined && merged.key !== null) notice.key = String(merged.key);
  if (merged.action && typeof merged.action.label === 'string' && typeof merged.action.onClick === 'function') {
    notice.action = { label: merged.action.label, onClick: merged.action.onClick };
  }
  lastNotice.value = notice;
  for (const fn of [...listeners]) {
    try {
      fn(notice);
    } catch (error) {
      console.error('[notify] 提示订阅者出错', error);
    }
  }
  return notice;
}

/** 订阅提示，返回取消订阅函数 */
export function onNotify(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 现在有没有人在显示提示（没有的话，调用方可以只在按钮上显示“已复制”） */
export function hasNotifyListeners() {
  return listeners.size > 0;
}
