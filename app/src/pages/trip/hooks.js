// =====================================================================
// pages/trip/hooks.js：概览页自己的几个 hook。
//
//   useOverviewTrip(route)   行程数据 + 页面状态（'loading' | 'ready' | 'error' | 'missing'）
//   useEnterStagger(state)   从“加载中”变成“有数据”的那一下，卡片错落淡入（只在这一次；已有缓存直接显示时不播，换页动效会负责）
//   useJustDone(store)       勾掉的待办先留在原地（打勾、划线），再原地收起；撤销后回来
//   usePref(key, initial)    本机记住的小偏好（每天安排是列表还是网格）
// =====================================================================

import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { local } from '../../lib/storage.js';

/**
 * 行程数据 + 页面状态。有缓存时直接 ready（先显示缓存，网络回来自动更新）。
 * useTrip 自己会等确定登录了才打开行程（恢复登录期间返回 null，这里显示加载中）。
 */
export function useOverviewTrip(route) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  let state = 'loading';
  if (trip && (status === 'ready' || status === 'loading' || store.source.value === 'cache' || status === 'error')) state = 'ready';
  if (status === 'error' && !trip) state = 'error';
  if (status === 'missing' || status === 'removed') state = 'missing';
  return { tripId, store, trip, state };
}

/**
 * 加载完的那一下卡片错落淡入：页面先显示骨架，数据到了以后返回 true 一小会儿（CSS 按 nth-child 错开延迟），
 * 播完（或 1.2 秒后）变回 false，不留无限动画。一打开就有数据（缓存）时一直是 false。
 */
export function useEnterStagger(state) {
  const wasLoading = useRef(state === 'loading');
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    if (state === 'loading') {
      wasLoading.current = true;
      return undefined;
    }
    if (state === 'ready' && wasLoading.current) {
      wasLoading.current = false;
      setEntering(true);
      const t = setTimeout(() => setEntering(false), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state]);
  return entering;
}

/**
 * 勾掉的待办先留在原地：done 变 true 以后还显示 HOLD_MS（看得见打勾、划线），然后进入“收起”（CSS 高度收成 0、淡出）；
 * 收起的过渡播完（行上的 transitionend → release(id)）真正拿掉，COLLAPSE_FALLBACK_MS 后兜底拿掉（减弱动态效果、标签页在后台时过渡事件可能不来）。
 * 返回 { held: Map<id, 行>, collapsing: Set<id>, hold(row), release(id) }。
 */
export const HOLD_MS = 650;
export const COLLAPSE_FALLBACK_MS = 1500;

export function useHeldRows() {
  const [held, setHeld] = useState(() => new Map());
  const [collapsing, setCollapsing] = useState(() => new Set());
  const timers = useRef(new Map());

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t);
  }, []);

  const release = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setHeld((m) => {
      if (!m.has(id)) return m;
      const n = new Map(m);
      n.delete(id);
      return n;
    });
    setCollapsing((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  const hold = useCallback((row) => {
    setHeld((m) => new Map(m).set(row.id, row));
    const old = timers.current.get(row.id);
    if (old) clearTimeout(old);
    timers.current.set(row.id, setTimeout(() => {
      setCollapsing((s) => new Set(s).add(row.id));
      timers.current.set(row.id, setTimeout(() => release(row.id), COLLAPSE_FALLBACK_MS));
    }, HOLD_MS));
  }, [release]);

  return { held, collapsing, hold, release };
}

/** 本机记住的小偏好（localStorage，读写失败也照常工作） */
export function usePref(key, initial) {
  const [v, setV] = useState(() => {
    const got = local.get(key, null);
    return got === null ? initial : got;
  });
  const set = useCallback((next) => {
    setV(next);
    local.set(key, next);
  }, [key]);
  return [v, set];
}
