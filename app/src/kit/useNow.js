// =====================================================================
// kit/useNow.js：会自己往前走的“现在”（倒计时、免费取消还剩多久、“3 分钟前”）。
//
//   const at = useNow();            // 默认每 30 秒刷新一次；页面回到前台时立刻刷新
//   const at = useNow(1000);        // 每秒（只在最后一分钟这种需要时用）
//
// 时间来源是 lib/clock.js 的 now()（本机 ?now= 拨过的时间也会照常往前走）。页面在后台时不刷新。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { now } from '../lib/clock.js';

/** @param {number} [interval] 毫秒；0 = 不自动刷新 */
export function useNow(interval = 30_000) {
  const [at, setAt] = useState(() => now());
  useEffect(() => {
    if (!interval) return undefined;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') setAt(now());
    };
    const timer = setInterval(tick, interval);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [interval]);
  return at;
}
