// =====================================================================
// overlay/toast-model.js：Toast 的数据规则（纯函数，单元测试直接测）。
//
//   - normalizeToast：把 toast('已保存') / toast({ message, tone, action, duration, key, pausable }) 规范成一条记录；
//     pausable: false = 倒计时不因悬停 / 聚焦 / 切到后台而暂停（“已删除 · 撤销”：提示条的时长必须和真正发出删除的时间一致）；
//   - insertToast：新的放最前（下标 0 = 最新），同 key 的旧提示被新的替换（连点“保存”不会堆一串）；
//   - createCountdown：可暂停的倒计时（悬停 / 聚焦 / 页面切到后台时暂停，回来接着数）；
//   - stackLayout：堆叠布局。收起时只露出后面两张的边（像一叠卡片），展开时排成一列。
// 显示和动画在 Toast.jsx，调用入口在 toast.js。
// =====================================================================

import { normalizeTone } from '../lib/notify.js';

/** 普通提示显示多久（毫秒） */
export const TOAST_DURATION = 3200;
/** 带“撤销”等按钮的提示显示多久（要留够反应时间） */
export const TOAST_ACTION_DURATION = 6000;
/** 同时最多显示几条，再多的最旧的先走 */
export const TOAST_MAX_VISIBLE = 3;
/** 语气：普通 / 成功 / 提醒 / 出错 / 说明（全站同一套词，定义在 lib/notify.js） */
export { NOTICE_TONES as TOAST_TONES } from '../lib/notify.js';

/**
 * @param {string | { message: string, tone?: string, action?: { label: string, onClick: Function }, duration?: number, key?: string, pausable?: boolean }} input
 * @param {number|string} id
 */
export function normalizeToast(input, id) {
  const opts = typeof input === 'string' ? { message: input } : { ...(input || {}) };
  const message = String(opts.message ?? '').trim();
  if (!message) throw new Error('toast 需要一段文字');
  const tone = normalizeTone(opts.tone);
  const action = opts.action && typeof opts.action.label === 'string' && typeof opts.action.onClick === 'function'
    ? { label: opts.action.label, onClick: opts.action.onClick }
    : null;
  let duration;
  if (opts.duration === Infinity) duration = Infinity;
  else if (Number.isFinite(opts.duration) && opts.duration > 0) duration = opts.duration;
  else duration = action ? TOAST_ACTION_DURATION : TOAST_DURATION;
  return { id, message, tone, action, duration, key: opts.key ?? null, pausable: opts.pausable !== false };
}

/** 新提示放最前；同 key 的旧提示被替换掉。返回 { list, replaced: 被替换掉的旧记录[] } */
export function insertToast(list, toast) {
  const replaced = toast.key ? list.filter((t) => t.key === toast.key) : [];
  const rest = replaced.length ? list.filter((t) => t.key !== toast.key) : list;
  return { list: [toast, ...rest], replaced };
}

/**
 * 可暂停的倒计时。时间由调用方传入（单元测试可以用假时间）。
 * @param {number} duration 毫秒；Infinity = 不自动消失
 * @param {number} now
 */
export function createCountdown(duration, now) {
  let remaining = duration;
  let startedAt = now;
  let running = true;
  return {
    get running() {
      return running;
    },
    /** 还剩多少毫秒 */
    remaining(t) {
      return running ? Math.max(0, remaining - (t - startedAt)) : remaining;
    },
    pause(t) {
      if (!running) return;
      remaining = Math.max(0, remaining - (t - startedAt));
      running = false;
    },
    resume(t) {
      if (running) return;
      startedAt = t;
      running = true;
    },
  };
}

/**
 * 堆叠布局（下标 0 = 最新、在最前面、贴着底部）。
 * @param {number[]} heights 每条提示卡片的自然高度（px）
 * @param {{ expanded?: boolean, gap?: number, peek?: number, maxVisible?: number, shrink?: number }} [o]
 *   peek：收起时后面每张露出多高；shrink：后面每张缩小多少
 * @returns {Array<{ y:number, scale:number, visible:boolean, clampHeight:number|null }>}
 *   y：向上的位移（负数）；clampHeight：收起时后面的卡片统一压成最前面那张的高度（露边整齐）
 */
export function stackLayout(heights, { expanded = false, gap = 8, peek = 10, maxVisible = TOAST_MAX_VISIBLE, shrink = 0.05 } = {}) {
  const out = [];
  let acc = 0;
  const front = heights[0] || 0;
  for (let i = 0; i < heights.length; i++) {
    const visible = i < maxVisible;
    const depth = Math.min(i, maxVisible - 1);
    if (expanded) {
      out.push({ y: -acc, scale: 1, visible, clampHeight: null });
      acc += heights[i] + gap;
    } else {
      out.push({ y: -peek * depth, scale: 1 - shrink * depth, visible, clampHeight: i === 0 ? null : front });
    }
  }
  return out;
}
