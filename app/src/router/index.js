// =====================================================================
// router/index.js：应用里用的路由器单例 + 便捷导出。
//
//   import { router, route, navigate, back, openSheet, closeSheet, href } from '../router/index.js';
//
// 单例在第一次 import 时创建，但要等 main.jsx 调用 router.start() 才接管网址。
// 页面代码预加载由 pages/index.js 通过 setPagePreloader() 注册（避免循环引用）。
// =====================================================================

import { createRouter } from './router.js';
import { routes } from './routes.js';
import { session } from '../lib/storage.js';
import { isDevToolsEnabled, APP_NAME } from '../lib/env.js';

let pagePreloader = null;

/** pages/index.js 注册：换页前预加载页面代码 */
export function setPagePreloader(fn) {
  pagePreloader = fn;
}

export const router = createRouter({
  window,
  routes,
  devEnabled: isDevToolsEnabled(),
  storage: session,
  appTitle: APP_NAME,
  preload: (r) => pagePreloader?.(r),
});

/** 当前路由信号（组件里读 route.value） */
export const route = router.route;
/** 是否正在换页（加载页面代码中） */
export const isNavigating = router.isNavigating;

export const navigate = router.navigate;
export const replace = router.replace;
export const back = router.back;
export const openSheet = router.openSheet;
export const closeSheet = router.closeSheet;
export const setQuery = router.setQuery;
export const href = router.href;

export { routes, DEFAULT_PATH, PARAM_PATTERNS } from './routes.js';
