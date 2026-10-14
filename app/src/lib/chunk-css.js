// =====================================================================
// lib/chunk-css.js：按需样式表（页面、kit/、sheets/、地图的 CSS）跟着 JS 分包一起加载。
//
// 构建（scripts/lib/bundle.mjs）把 CSS 分成首屏样式表 app-*.css（index.html 直接引用）和按需样式表 style-*.css，
// 并把 src/ 里每个相对路径的动态 import 改写成：
//
//   importWithCss(() => import('./trip/TripPage.jsx'), 'pages/trip/TripPage.jsx')     （键 = 目标文件相对 src/ 的路径）
//
// 这个分包入口要哪些按需样式表写在 index.html 的 <meta name="rs7885-css-map" content='{"f":[…],"m":{…}}'>：
//   f  样式表网址（assets/style-XXXX.css），已按层排好序
//   m  入口（去掉开头的 src/）→ f 里的下标
// importWithCss 让 JS 和样式表同时下载，两个都到了才 resolve：页面、弹层第一帧就是对的样子（不闪无样式的内容）。
// 没有这个 <meta>（开发服务器把 CSS 都放在首屏、单元测试）就只是 import()。
//
// - 同一个样式表只加载一次；<link> 按 f 的顺序插在首屏样式表后面（层已经决定了谁盖谁，顺序固定只是为了可预期）；
// - 加载失败：删掉那个 <link>、下次再试，并把错误交出去（code: 'chunk-css'，lib/lazy.js 的 isChunkError 认得：
//   发版后旧样式表被删 → 自动刷新拿新版；断网 → 错误边界显示「重试」）；
// - 等太久（TIMEOUT_MS）先放行：样式到了自然生效，不让页面一直空着。
// =====================================================================

export const CSS_MAP_META = 'rs7885-css-map';

/** 等样式表最多多久（毫秒） */
const TIMEOUT_MS = 12000;

/** @type {{ f: string[], m: Record<string, number[]> } | null | undefined} */
let parsed;

function readMap() {
  if (parsed !== undefined) return parsed;
  parsed = null;
  if (typeof document === 'undefined') return parsed;
  try {
    const raw = document.querySelector(`meta[name="${CSS_MAP_META}"]`)?.getAttribute('content');
    if (raw) parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[样式] 按需样式表清单读不出来', error);
  }
  return parsed;
}

/**
 * 这个分包入口要哪些按需样式表（网址，按层排好序）。
 * @param {string} key 目标文件相对 app/src/ 的路径，如 'pages/trip/TripPage.jsx'（写成 'src/pages/…' 也认）
 */
export function cssFor(key) {
  const map = readMap();
  if (!map) return [];
  const list = map.m?.[key.replace(/^src\//, '')] || [];
  return list.map((i) => map.f[i]).filter(Boolean);
}

/** 网址 → 加载中 / 已加载的 Promise */
const loading = new Map();

function orderOf(href) {
  return readMap()?.f.indexOf(href) ?? -1;
}

/** 按清单顺序插 <link>：插在第一个顺序比它大的按需样式表前面，没有就放在最后一个按需样式表（或首屏样式表）后面 */
function insert(link, href) {
  const mine = orderOf(href);
  const others = [...document.querySelectorAll('link[data-chunk-css]')];
  const after = others.find((l) => orderOf(l.getAttribute('href')) > mine);
  if (after) {
    after.before(link);
    return;
  }
  const anchor = others[others.length - 1] || document.querySelector('link[rel="stylesheet"][href*="assets/app-"]');
  if (anchor) anchor.after(link);
  else document.head.appendChild(link);
}

/**
 * 加载一个样式表（同一个只加载一次）。
 * @param {string} href
 * @returns {Promise<void>}
 */
export function loadStylesheet(href) {
  if (typeof document === 'undefined') return Promise.resolve();
  const known = loading.get(href);
  if (known) return known;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-chunk-css', '');
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, TIMEOUT_MS);
    link.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    link.onerror = () => {
      clearTimeout(timer);
      loading.delete(href);
      link.remove();
      const error = new Error(`样式表 ${href} 加载失败`);
      error.code = 'chunk-css';
      reject(error);
    };
  });
  loading.set(href, promise);
  insert(link, href);
  return promise;
}

/**
 * 这个分包入口的按需样式表都加载好。
 * @param {string} key
 */
export function ensureChunkCss(key) {
  const hrefs = cssFor(key);
  if (!hrefs.length) return Promise.resolve();
  return Promise.all(hrefs.map(loadStylesheet)).then(() => undefined);
}

/**
 * 动态 import + 它的按需样式表（构建自动改写，代码里不用手写）。
 * @template T
 * @param {() => Promise<T>} load
 * @param {string} key
 * @returns {Promise<T>}
 */
export function importWithCss(load, key) {
  const css = ensureChunkCss(key);
  return Promise.all([load(), css]).then(([m]) => m);
}
