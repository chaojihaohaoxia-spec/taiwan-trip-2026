// =====================================================================
// shell/overlays.js：外壳负责的弹层（SPEC §9.2）登记成按需加载（overlay/ 的 defineOverlays）。
//
//   switcher  行程切换（从标题长出来，AnchoredPanel）      overlays/SwitcherPanel.jsx
//   fab       ＋ 快速添加（从加号长出来，AnchoredPanel）    overlays/FabPanel.jsx
//   menu      更多（从按钮圆形扩散铺满，FullscreenMenu）     overlays/MoreMenu.jsx
//   search    搜索结果层（顶栏的 SearchExpand 借 ?sheet=search 记历史；结果层由 Frame 按需加载 overlays/SearchLayer.jsx）
//
// 这几个模块（连同 overlay/AnchoredPanel、FullscreenMenu、kit/ 的图形、数据层）都不进首屏包：
// 网址里出现 id 时 OverlayHost 才下载；首屏出来后浏览器空闲时先悄悄下载好（preloadShellOverlays），点的时候不用等。
// =====================================================================

import { defineOverlays } from '../overlay/manager.js';

const loaders = {
  switcher: () => import('./overlays/SwitcherPanel.jsx'),
  fab: () => import('./overlays/FabPanel.jsx'),
  menu: () => import('./overlays/MoreMenu.jsx'),
};

/** 搜索结果层（不是 overlay/ 的弹层，Frame 自己挂） */
export const loadSearchLayer = () => import('./overlays/SearchLayer.jsx');

let registered = false;
/** 登记（app 启动时调用一次） */
export function registerShellOverlays() {
  if (registered) return;
  registered = true;
  defineOverlays({
    switcher: { kind: 'panel', load: loaders.switcher },
    fab: { kind: 'panel', load: loaders.fab },
    menu: { kind: 'menu', load: loaders.menu },
  });
}

let preloaded = false;
/** 首屏出来后、浏览器空闲时预先下载这几个弹层的代码（失败无所谓，用到时会再下载） */
export function preloadShellOverlays() {
  if (preloaded || typeof window === 'undefined') return;
  preloaded = true;
  const run = () => {
    for (const load of [...Object.values(loaders), loadSearchLayer]) load().catch(() => {});
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2500 });
  else setTimeout(run, 1200);
}
