// =====================================================================
// data/fx-refresh.js：登录以后让汇率保持新鲜（代码评审 L10）。
//
// iOS 主屏 App 很少冷启动：只在启动时拿一次汇率的话，几天不关 App，新记一笔写进去的 fx_rate 一直是第一次拿到的
// （或离线时的参考汇率）。这里在“已登录”时，每次时钟刷新（data.clockTick，30 秒一次；回到前台也会刷新）都
// 调一次 ensure()——汇率服务自己判断新不新鲜：新鲜时直接返回、不发请求；过期（24 小时）才重新拿，
// 失败 10 分钟内不重试（lib/services/fx.js）。登录页、没登录时不请求。
// =====================================================================

import { effect } from '@preact/signals';

/**
 * @param {{ authState: { value: { status: string } }, clockTick: { value: number }, ensure: () => unknown }} o
 * @returns {() => void} 停止
 */
export function keepFxFresh({ authState, clockTick, ensure }) {
  return effect(() => {
    if (authState.value.status !== 'signed-in') return;
    void clockTick.value;
    ensure();
  });
}
