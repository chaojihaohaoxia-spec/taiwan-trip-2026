// =====================================================================
// lib/dev-styles.js：开发页专用样式表（assets/dev-XXXX.css）的按需加载。
//
// 构建时开发页（src/dev/、demo/）的 CSS 单独打成 dev-XXXX.css：线上用户不下载、不进 Service Worker 预缓存，
// 首屏样式表也不被开发页的样式撑大。index.html 用 <meta name="rs7885-dev-css" content="assets/dev-XXXX.css">
// 告诉页面它在哪（scripts/lib/html.mjs 写入）。
//
//   pages/index.js：dev: lazyPage(() => Promise.all([import('../dev/DevPage.jsx'), loadDevStyles()]).then(([m]) => m))
//
// 路由器换页前会先 preload 页面代码，样式表也在那时加载好，开发页第一帧就是对的样子（不闪）。
// 没有这个 <meta>（例如单元测试、旧的构建）就什么都不做；加载失败只在控制台提示，不挡住页面。
// =====================================================================

export const DEV_CSS_META = 'rs7885-dev-css';

/** 等样式表最多多久（超时就先渲染，样式到了自然生效） */
const TIMEOUT_MS = 4000;

let ready = null;

/**
 * 加载开发页样式表（只加载一次；重复调用返回同一个 Promise）。
 * @returns {Promise<void>} 样式表加载完成（或失败 / 超时）后 resolve，从不 reject
 */
export function loadDevStyles() {
  if (typeof document === 'undefined') return Promise.resolve();
  if (ready) return ready;
  const href = document.querySelector(`meta[name="${DEV_CSS_META}"]`)?.getAttribute('content');
  if (!href) return Promise.resolve();
  const existing = document.querySelector('link[data-dev-css]');
  if (existing) {
    ready = Promise.resolve();
    return ready;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-dev-css', '');
  ready = new Promise((resolve) => {
    const timer = setTimeout(resolve, TIMEOUT_MS);
    link.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    link.onerror = () => {
      clearTimeout(timer);
      console.error(`[开发页] 样式表 ${href} 加载失败`);
      ready = null; // 下次进开发页再试
      link.remove();
      resolve();
    };
  });
  document.head.appendChild(link);
  return ready;
}
