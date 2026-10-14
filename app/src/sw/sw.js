/* =====================================================================
   sw.js：Service Worker 模板。构建脚本把下面两个占位换成真实值，输出到仓库根目录的 sw.js：
     __SW_VERSION__   版本号（内容哈希，内容不变版本就不变，不会无谓地触发“有新版本”）
     __SW_PRECACHE__  预缓存清单（相对 SW 所在目录的路径：'./'、'assets/main-XXXX.js'、图标、manifest…）

   缓存策略：
     - 页面（导航请求，且是应用入口 ./ 或 ./index.html）：**缓存优先**——用这个 SW 自己那一版预缓存的入口页，
       页面版本永远和控制它的 SW 一致（页面按需加载的分包一定在同一版的缓存里，离线照样能打开）；
       打开就是秒开，不等网络（酒店 Wi-Fi 认证页、漫游弱信号那种“显示在线、请求一直挂着”也不卡在启动画面）。
       新版本只通过「有新版本，点此刷新」切换（lib/pwa.js 每次启动、回到前台都会检查更新）；
       缓存里没有入口页时（极少见：缓存被系统清掉）才走网络，最多等 NAV_TIMEOUT_MS，超时 / 失败用任一版本缓存的入口页；
     - 网页字体（.woff2：构建后在 assets/<名>-<内容哈希>.woff2，也认同源 fonts/ 下的）：**不在安装时预缓存**
       （思源宋体切成了几十片，一屏只用到其中几片），第一次用到时缓存优先，存进单独的、不带版本号的字体缓存
       rs7885-fonts——发新版不会清掉它（文件名带内容哈希，名字一样就是同一个文件）；激活新版时只删掉新版清单里
       已经没有的旧字体文件，缓存不会越积越多；
     - 预缓存清单里的同源静态资源（带内容哈希的 js/css/图片、图标、manifest）：缓存优先；
       同源、不在本版清单里的资源：先查所有本应用的缓存（例如新版 SW 已经装好、正在 waiting 时它的缓存），
       都没有再走网络——不会因为“不在旧清单里”就离线失败；
     - 其他请求一律不拦截：跨域的 Supabase、天气、汇率、地图瓦片等接口绝不缓存；
       同源的其他页面（guides/、legacy/ 旧页面等）照常走网络。

   更新：新版装好后进入 waiting，页面显示「有新版本，点此刷新」，点了发 SKIP_WAITING 再接管。
   旧版交接：如果发现旧版（th-*）的缓存，说明是从旧网站升级过来的，旧页面不认识更新提示，
            就直接接管、删掉旧缓存，并让打开着的旧页面刷新一次。
   ===================================================================== */

/* eslint-env serviceworker */

const VERSION = '__SW_VERSION__';
const PRECACHE = __SW_PRECACHE__;

const PREFIX = 'rs7885-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
/** 字体缓存：不带版本号，发新版也留着 */
const FONT_CACHE = `${PREFIX}fonts`;
const LEGACY_PREFIXES = ['th-'];
/** 缓存里没有入口页、只能走网络时，最多等多久（毫秒） */
const NAV_TIMEOUT_MS = 4000;

const scope = self.registration.scope;
const toUrl = (p) => new URL(p, scope).href;
const PRECACHE_URLS = new Set(PRECACHE.map(toUrl));
const SHELL_URL = toUrl('./');
const INDEX_URL = toUrl('./index.html');
/** 本应用带哈希的资源目录（js / css / 图片分包） */
const ASSETS_PATH = new URL('assets/', scope).pathname;
/** 同源的字体目录（以后字体如果不经过打包、直接放在 fonts/ 下也认） */
const FONTS_PATH = new URL('fonts/', scope).pathname;

const isLegacyCache = (key) => LEGACY_PREFIXES.some((p) => key.startsWith(p));
/** 是不是本应用的网页字体（只看路径） */
const isFontPath = (pathname) => /\.woff2?$/.test(pathname) && (pathname.startsWith(ASSETS_PATH) || pathname.startsWith(FONTS_PATH));
/** 安装时预缓存的文件：清单里除了字体的全部 */
const INSTALL_LIST = PRECACHE.filter((p) => !isFontPath(new URL(toUrl(p)).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: 'reload'：跳过 HTTP 缓存（GitHub Pages 默认缓存 10 分钟），保证拿到的是这一版的文件。
    // 字体不在这里下载（INSTALL_LIST 去掉了 .woff2）：第一次用到时再缓存
    await cache.addAll(INSTALL_LIST.map((p) => new Request(toUrl(p), { cache: 'reload' })));
    const keys = await caches.keys();
    if (keys.some(isLegacyCache)) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadLegacy = keys.some(isLegacyCache);
    await Promise.all(keys
      .filter((k) => isLegacyCache(k) || (k.startsWith(PREFIX) && k !== SHELL_CACHE && k !== FONT_CACHE))
      .map((k) => caches.delete(k)));
    await pruneFonts();
    await self.clients.claim();
    if (hadLegacy) {
      const windows = await self.clients.matchAll({ type: 'window' });
      // 注意：不能 await navigate()。导航请求要等这个 SW 激活完才会派发到 fetch，
      // 而激活又在等 waitUntil 里的 Promise —— await 就会互相等死，页面卡住。
      for (const client of windows) client.navigate(client.url).catch(() => undefined);
    }
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ version: VERSION });
    else if (event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/** 字体缓存里删掉新版清单里已经没有的旧字体（assets/ 下带哈希的；fonts/ 下的不知道新旧，留着） */
async function pruneFonts() {
  try {
    const cache = await caches.open(FONT_CACHE);
    for (const req of await cache.keys()) {
      const url = new URL(req.url);
      if (url.pathname.startsWith(ASSETS_PATH) && !PRECACHE_URLS.has(`${url.origin}${url.pathname}`)) await cache.delete(req);
    }
  } catch {
    // 清理失败不影响激活
  }
}

/** 字体：缓存优先；没有就走网络，成功了存进字体缓存（下次离线也有） */
async function fontFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && (response.type === 'basic' || response.type === 'cors')) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

/** 本版缓存的入口页 */
async function shellFromCache() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(SHELL_URL)) || (await cache.match(INDEX_URL));
}

/** 任一版本缓存的入口页（本版没有时的兜底） */
async function anyShell() {
  return (await caches.match(SHELL_URL)) || (await caches.match(INDEX_URL));
}

const offlinePage = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title><p style="font:16px -apple-system,sans-serif;padding:24px">现在没有网络，也没有可用的离线版本。连上网络后再试。</p>', {
  status: 503,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

/** 网络请求和定时器赛跑：超时返回 null（请求本身不取消，下次就到 HTTP 缓存了） */
function fetchWithin(url, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    fetch(url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' }).then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function shellFirstPage(request) {
  const cached = await shellFromCache();
  if (cached) return cached;
  const response = await fetchWithin(request.url, NAV_TIMEOUT_MS);
  if (response && response.status < 500) return response;
  return (await anyShell()) || response || offlinePage();
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

/** 不在本版清单里的同源资源：任一本应用缓存里有就用（新版已装好时），没有走网络 */
async function anyCacheThenNetwork(request) {
  const keys = await caches.keys();
  for (const key of keys) {
    if (!key.startsWith(PREFIX)) continue;
    const hit = await (await caches.open(key)).match(request);
    if (hit) return hit;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 跨域（Supabase、天气、汇率、地图瓦片……）一律不拦截、不缓存
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scope)) return;

  if (request.mode === 'navigate') {
    const page = `${url.origin}${url.pathname}`;
    if (page === SHELL_URL || page === INDEX_URL) event.respondWith(shellFirstPage(request));
    return; // guides/、legacy/ 等其他页面照常走网络
  }

  // 字体：单独的字体缓存，缓存优先（不经过本版的预缓存）
  if (isFontPath(url.pathname)) {
    event.respondWith(fontFirst(request));
    return;
  }

  const clean = `${url.origin}${url.pathname}`;
  if (PRECACHE_URLS.has(clean) && !url.search) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // 本应用的带哈希资源（assets/）不在本版清单里：可能是新版的分包（新版 SW 已装好、页面还是旧的不会走到这里；
  // 但防万一，例如旧网站升级过来的那一刻）——先查所有本应用缓存
  if (url.pathname.startsWith(ASSETS_PATH)) event.respondWith(anyCacheThenNetwork(request));
});
