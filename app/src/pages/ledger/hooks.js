// =====================================================================
// pages/ledger/hooks.js：账本页用的几个小 hook（和 DOM / 数据层打交道的部分，纯逻辑在 model.js）。
//
//   usePendingExpenseIds(tripId)      还没同步到服务器的记账 id（写队列里有它的改动）→ 行上标「待同步」
//   useLongPress(onLongPress)         长按（650ms 不动，150ms 起有渐进的危险色反馈）→ 删除；返回要铺到元素上的事件属性
//   useFreshExpense(tripId)           刚保存的一笔（sheets/expense/saved.js）：返回 { id, mode } 并在高亮时长后自动清掉
//   useStuck(ref)                     吸顶的日期头此刻“吸住了”没有（IntersectionObserver）→ 吸住时换成玻璃、带投影
// =====================================================================

import { useEffect, useRef, useState } from 'preact/hooks';
import { data } from '../../data/index.js';
import { suppressNextClick } from '../../motion/press.js';
import { haptic } from '../../lib/native.js';
import { lastSavedExpense, FRESH_SAVE_MS } from '../../sheets/expense/saved.js';
import { FRESH_HIGHLIGHT_MS } from './model.js';

/**
 * 写队列里还有改动没发出去的记账 id（新记的、改过的、正在删的）。
 * 订阅 outbox.state（每条改动进队 / 发出去都会变），所以联网同步完会自动去掉「待同步」。
 * @returns {Set<string>}
 */
export function usePendingExpenseIds(tripId) {
  // 读 .value 才会订阅；ops 本身从 opsForTrip 拿
  data.outbox?.state?.value;
  const out = new Set();
  if (!tripId || !data.outbox?.opsForTrip) return out;
  for (const op of data.outbox.opsForTrip(tripId)) if (op.table === 'expenses' && op.key) out.add(String(op.key));
  return out;
}

/** 按住多久开始显示“正在长按”（危险色从左往右铺满） */
export const HOLD_HINT_MS = 150;

/**
 * 长按：按住 delay 毫秒、手指没挪动超过 slop 像素 → 触发（轻震一下、作废紧接着的那次点击）。
 * 竖着滑（滚页面）、横着滑（左滑删除）都会取消。
 * 按住 HOLD_HINT_MS 以后元素上加 data-holding（CSS 在剩下的时间里让行微缩、危险色从左往右铺满），
 * 看得出“再按下去就删了”，松手就停（交互评审 P2-6：以前按住期间和普通点按一样，走路时拇指搭着就误删）。
 * @param {(e: PointerEvent) => void} onLongPress
 * @param {{ delay?: number, slop?: number, enabled?: boolean }} [o]
 */
export function useLongPress(onLongPress, { delay = 650, slop = 10, enabled = true } = {}) {
  const st = useRef({ timer: 0, hint: 0, x: 0, y: 0, el: null });
  const latest = useRef(onLongPress);
  latest.current = onLongPress;

  const clear = () => {
    if (st.current.timer) clearTimeout(st.current.timer);
    if (st.current.hint) clearTimeout(st.current.hint);
    st.current.timer = 0;
    st.current.hint = 0;
    st.current.el?.removeAttribute('data-holding');
  };
  useEffect(() => clear, []);

  if (!enabled) return {};
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clear();
      st.current.x = e.clientX;
      st.current.y = e.clientY;
      st.current.el = e.currentTarget;
      const el = e.currentTarget;
      el.style.setProperty('--lg-hold-ms', `${Math.max(0, delay - HOLD_HINT_MS)}ms`);
      st.current.hint = setTimeout(() => {
        st.current.hint = 0;
        el.setAttribute('data-holding', '');
      }, HOLD_HINT_MS);
      st.current.timer = setTimeout(() => {
        st.current.timer = 0;
        el.removeAttribute('data-holding');
        haptic('medium');
        suppressNextClick(el);
        latest.current?.(e);
      }, delay);
    },
    onPointerMove: (e) => {
      if (!st.current.timer) return;
      if (Math.abs(e.clientX - st.current.x) > slop || Math.abs(e.clientY - st.current.y) > slop) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // 触屏长按会弹系统菜单（复制 / 查找……）：这一行上不要
    onContextMenu: (e) => {
      if (e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents) e.preventDefault();
    },
  };
}

/**
 * 刚保存的一笔：{ id, mode } 或 null。只认这趟行程、FRESH_SAVE_MS 以内的；高亮时长过了自动清掉（也清掉信号，免得再进来又闪）。
 * active = false 时先不开始（记一笔面板还开着：等它收回了，新的一笔再带着入场动画出现并高亮）。
 */
export function useFreshExpense(tripId, { active = true } = {}) {
  const saved = lastSavedExpense.value;
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    if (!active || !saved || saved.tripId !== tripId || Date.now() - saved.at > FRESH_SAVE_MS) return undefined;
    setFresh({ id: saved.id, mode: saved.mode, at: saved.at });
    const t = setTimeout(() => {
      setFresh(null);
      if (lastSavedExpense.peek() === saved) lastSavedExpense.value = null;
    }, FRESH_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [saved, tripId, active]);
  return fresh;
}

/**
 * 记一笔面板还开着时要先“扣住”的那一笔（刚新建的）：面板收回以后它才进列表（带入场动画），不然动画播在面板后面没人看见。
 * @returns {string|null}
 */
export function heldExpenseId(tripId, sheetOpen) {
  const saved = lastSavedExpense.value;
  if (!sheetOpen || !saved || saved.tripId !== tripId || saved.mode !== 'new') return null;
  if (Date.now() - saved.at > FRESH_SAVE_MS) return null;
  return saved.id;
}

/**
 * position: sticky 的元素此刻是不是“吸住了”（上边碰到了 top 的位置）。
 * 做法：观察它自己，根的上边缘往下缩 (top + 1)px；吸住时它的上沿正好在 top，不再完整可见 → ratio < 1。
 * 滚回去以后又完整可见 → ratio = 1。不支持 IntersectionObserver 的环境一直是 false（样式退回普通卡片材质）。
 * 阈值要同时有 0 和 1：甩一下、scrollIntoView 这种一帧跳过去的滚动，日期头可能从“在屏幕外”直接变成“吸住”
 * （比例 0 → 0.97），中间没有“完整可见”的那一帧，只盯 1 这个阈值就永远收不到回调。
 * @param {{ current: HTMLElement|null }} ref
 * @returns {boolean}
 */
export function useStuck(ref) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const top = parseFloat(getComputedStyle(el).top) || 0;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      // 吸住：不再完整可见，而且是从上面被挡（不是从屏幕底下进来）
      const on = entry.intersectionRatio < 1 && entry.boundingClientRect.top <= top + 1;
      setStuck(on);
    }, { threshold: [0, 1], rootMargin: `-${Math.ceil(top) + 1}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return stuck;
}
