// =====================================================================
// overlay/toast.js：Toast（轻提示、撤销条）的调用入口和状态。显示在 Toast.jsx（OverlayHost 里挂着）。
//
//   toast('已保存');
//   toast.success('已记一笔：400,000₫（约 HK$121）');
//   toast.error('网络不稳定，没保存上');
//   const t = toast({ message: '已删除「晚餐」', action: { label: '撤销', onClick: undo } });   // 6 秒内可撤销
//   t.dismiss();
//   toast({ message: '正在同步…', duration: Infinity, key: 'sync' });   // 同 key 的提示会被替换，不会堆一串
//
// Toast 不进历史记录、不锁滚动、不抢焦点；读屏软件会朗读（aria-live）；出错的用 role="alert" 立即朗读。
// 同时最多显示 3 条（堆叠），再来新的，最旧的先走。鼠标悬停 / 键盘焦点在上面 / 页面切到后台时暂停倒计时。
// =====================================================================

import { signal } from '@preact/signals';
import { normalizeToast, insertToast, TOAST_MAX_VISIBLE } from './toast-model.js';

let seq = 0;

/**
 * 全部提示（下标 0 = 最新）。每条：normalizeToast 的结果 + state: 'open' | 'closing'。
 * 'closing' 的还在播退场动画，播完由 Toast.jsx 调 removeToast 移除。
 */
export const toasts = signal([]);

/**
 * 显示一条提示。
 * @param {string | { message: string, tone?: 'neutral'|'success'|'warning'|'danger'|'info', action?: { label: string, onClick: () => any },
 *          duration?: number, key?: string, pausable?: boolean }} input
 *        pausable: false = 悬停 / 聚焦 / 切到后台也不暂停倒计时（撤销条：到时间删除就真的发出去了）
 * @param {object} [options] 第一个参数是字符串时的其他选项
 * @returns {{ id: string, dismiss: () => void }}
 */
export function toast(input, options) {
  const merged = typeof input === 'string' ? { ...(options || {}), message: input } : input;
  seq += 1;
  const item = { ...normalizeToast(merged, `t${seq}`), state: 'open' };
  const { list } = insertToast(toasts.peek(), item);
  let open = 0;
  toasts.value = list.map((t) => {
    if (t.state === 'closing') return t;
    open += 1;
    return open > TOAST_MAX_VISIBLE ? { ...t, state: 'closing' } : t;
  });
  return { id: item.id, dismiss: () => dismissToast(item.id) };
}

/** 成功（带对勾） */
toast.success = (message, options) => toast({ ...(options || {}), message, tone: 'success' });
/** 出错（读屏软件立即朗读） */
toast.error = (message, options) => toast({ ...(options || {}), message, tone: 'danger' });
/** 说明 */
toast.info = (message, options) => toast({ ...(options || {}), message, tone: 'info' });
/** 提醒（没出错，但要注意：例如“离线，联网后自动同步”） */
toast.warning = (message, options) => toast({ ...(options || {}), message, tone: 'warning' });

/** 让一条提示离场（播退场动画） */
export function dismissToast(id) {
  toasts.value = toasts.peek().map((t) => (t.id === id && t.state !== 'closing' ? { ...t, state: 'closing' } : t));
}

/** 某个 key 的提示离场（例如打开「改一项」面板时收起上一条「已加 · 撤销」，不盖在面板上） */
export function dismissToastKey(key) {
  if (!key) return;
  toasts.value = toasts.peek().map((t) => (t.key === key && t.state !== 'closing' ? { ...t, state: 'closing' } : t));
}

/** 全部离场 */
export function dismissAllToasts() {
  toasts.value = toasts.peek().map((t) => (t.state === 'closing' ? t : { ...t, state: 'closing' }));
}

/** 退场动画播完：移除（Toast.jsx 调用） */
export function removeToast(id) {
  toasts.value = toasts.peek().filter((t) => t.id !== id);
}
