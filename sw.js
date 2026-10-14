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

const VERSION = "2.0.0+47bd55de2c";
const PRECACHE = [
  "./",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon.svg",
  "assets/app-IFTKUY47.css",
  "assets/chunk-27FQA7UZ.js",
  "assets/chunk-2AIP75CL.js",
  "assets/chunk-2BZGE4FQ.js",
  "assets/chunk-2EKDOBZJ.js",
  "assets/chunk-2GSOGIAP.js",
  "assets/chunk-2KYYQUAM.js",
  "assets/chunk-2MO2T3N4.js",
  "assets/chunk-2QKI2IJM.js",
  "assets/chunk-2RBWFYBH.js",
  "assets/chunk-37FY6BDE.js",
  "assets/chunk-3CDMB7A5.js",
  "assets/chunk-3U7JTTSV.js",
  "assets/chunk-4FV5QJ3Z.js",
  "assets/chunk-55NCAWOD.js",
  "assets/chunk-5EQH6PN7.js",
  "assets/chunk-5KBJRDCT.js",
  "assets/chunk-5WOUQCNT.js",
  "assets/chunk-6TLBRP6F.js",
  "assets/chunk-74MTOFSK.js",
  "assets/chunk-74S5YQRW.js",
  "assets/chunk-7VH3CII5.js",
  "assets/chunk-7ZYAXGUZ.js",
  "assets/chunk-A5RKKP45.js",
  "assets/chunk-AQN6BR5N.js",
  "assets/chunk-B3VVAK4B.js",
  "assets/chunk-B5HAMHPU.js",
  "assets/chunk-BQSFN2YX.js",
  "assets/chunk-BSTOFCFX.js",
  "assets/chunk-BVUSC3S7.js",
  "assets/chunk-BXPDTY3D.js",
  "assets/chunk-BYLUMZH3.js",
  "assets/chunk-CBV2J3LB.js",
  "assets/chunk-CIZWND67.js",
  "assets/chunk-CS2KLJMF.js",
  "assets/chunk-CUQG2VW5.js",
  "assets/chunk-CWR5BOGF.js",
  "assets/chunk-D3N57PWJ.js",
  "assets/chunk-DGDGDSA4.js",
  "assets/chunk-DJGYYJTS.js",
  "assets/chunk-DNPC7VJO.js",
  "assets/chunk-DOPBRO4A.js",
  "assets/chunk-DPZ446HO.js",
  "assets/chunk-DZN2RD2Z.js",
  "assets/chunk-EBC54HEJ.js",
  "assets/chunk-EBSM6SSI.js",
  "assets/chunk-EJ76X5WV.js",
  "assets/chunk-EQFNCSH7.js",
  "assets/chunk-ESK5VRFV.js",
  "assets/chunk-F4GQKRO2.js",
  "assets/chunk-FKUKLNJI.js",
  "assets/chunk-FNEJFHCW.js",
  "assets/chunk-FYMNQG5Y.js",
  "assets/chunk-GB3EWSKT.js",
  "assets/chunk-GB5XWW7S.js",
  "assets/chunk-GBVVRPCY.js",
  "assets/chunk-GQHWLXHO.js",
  "assets/chunk-GTH5GSUR.js",
  "assets/chunk-GXAD642M.js",
  "assets/chunk-H24RFL6R.js",
  "assets/chunk-HRDSSMUP.js",
  "assets/chunk-II4FA5JA.js",
  "assets/chunk-IMT7HUPV.js",
  "assets/chunk-IP5FPPUI.js",
  "assets/chunk-J32VLUUX.js",
  "assets/chunk-J5ED5DA4.js",
  "assets/chunk-JMYAITYB.js",
  "assets/chunk-JTYKCE3R.js",
  "assets/chunk-JWD774JV.js",
  "assets/chunk-JXKNZ2WA.js",
  "assets/chunk-K4D5ZB2G.js",
  "assets/chunk-KT7QPIVG.js",
  "assets/chunk-KUHX5RLK.js",
  "assets/chunk-KZVQ7IWT.js",
  "assets/chunk-L3S4BNDC.js",
  "assets/chunk-L5G44BKX.js",
  "assets/chunk-LCQ6EQZ4.js",
  "assets/chunk-LDJ3SG6X.js",
  "assets/chunk-LEF3K7KE.js",
  "assets/chunk-LQMP4TLW.js",
  "assets/chunk-LQR7TPFH.js",
  "assets/chunk-LU75GMZT.js",
  "assets/chunk-MGROB3QV.js",
  "assets/chunk-MLJJNGMK.js",
  "assets/chunk-MXXVDYPH.js",
  "assets/chunk-MY2XFXJZ.js",
  "assets/chunk-N5WCHOVX.js",
  "assets/chunk-NC5NSJSA.js",
  "assets/chunk-NE2MBOHY.js",
  "assets/chunk-NEEICSTK.js",
  "assets/chunk-NNQCHJ4V.js",
  "assets/chunk-NQZM2NQT.js",
  "assets/chunk-NYJICFTI.js",
  "assets/chunk-ON2WDPUD.js",
  "assets/chunk-OOJM4CTU.js",
  "assets/chunk-OPQQ7DFN.js",
  "assets/chunk-P2BKNZHO.js",
  "assets/chunk-P6W3J6UL.js",
  "assets/chunk-PGH5GHYJ.js",
  "assets/chunk-PKCDWHIM.js",
  "assets/chunk-PLHAYIAZ.js",
  "assets/chunk-PWD2XT5T.js",
  "assets/chunk-PZ2UWDPI.js",
  "assets/chunk-Q663D2RG.js",
  "assets/chunk-QB2KTV2Q.js",
  "assets/chunk-QLBUOK2L.js",
  "assets/chunk-QNBFXCU7.js",
  "assets/chunk-QXB2GAJS.js",
  "assets/chunk-QYJ5O7R5.js",
  "assets/chunk-QZLUV4CE.js",
  "assets/chunk-R6KDVYSQ.js",
  "assets/chunk-RL7ZHSHX.js",
  "assets/chunk-RLOILQMF.js",
  "assets/chunk-RT7Y5SFV.js",
  "assets/chunk-S2AZYICU.js",
  "assets/chunk-S4OJ7CLV.js",
  "assets/chunk-SBANGYV5.js",
  "assets/chunk-SG4NVZCQ.js",
  "assets/chunk-SI2ITK4V.js",
  "assets/chunk-SK6QRSBW.js",
  "assets/chunk-SMPJTU7Z.js",
  "assets/chunk-SP2NQKD5.js",
  "assets/chunk-T5GL3O2N.js",
  "assets/chunk-TEY6ZDIB.js",
  "assets/chunk-TGNU4XYO.js",
  "assets/chunk-TUY2WYYM.js",
  "assets/chunk-TVCMDHEF.js",
  "assets/chunk-UG6M365W.js",
  "assets/chunk-URVBPGWG.js",
  "assets/chunk-USXYM3YL.js",
  "assets/chunk-V564LPIU.js",
  "assets/chunk-VBMLPGXX.js",
  "assets/chunk-VGKW4C3M.js",
  "assets/chunk-VJ2EFK3O.js",
  "assets/chunk-VKYNF4SX.js",
  "assets/chunk-VM7JBGZI.js",
  "assets/chunk-VSDE3Z7F.js",
  "assets/chunk-VY2XNNPS.js",
  "assets/chunk-WDRGG6PH.js",
  "assets/chunk-WS77GXI7.js",
  "assets/chunk-WVD425UZ.js",
  "assets/chunk-XF3FWKKF.js",
  "assets/chunk-XHEICONK.js",
  "assets/chunk-XZPKXCUO.js",
  "assets/chunk-Y2P6QW5G.js",
  "assets/chunk-Y2X75YMB.js",
  "assets/chunk-Y7MIHKU2.js",
  "assets/chunk-YAJDSLEY.js",
  "assets/chunk-YJLAILZP.js",
  "assets/chunk-YRIMJ36N.js",
  "assets/chunk-Z5Z5STUI.js",
  "assets/chunk-ZGX6HKYD.js",
  "assets/chunk-ZLSPYD7H.js",
  "assets/chunk-ZOBUJ2TQ.js",
  "assets/chunk-ZRGTUMIP.js",
  "assets/chunk-ZTZPH445.js",
  "assets/geist-OYP4H642.woff2",
  "assets/instrument-serif-400-RB6AC2F2.woff2",
  "assets/instrument-serif-400-italic-QLQCVKSE.woff2",
  "assets/layers-2x-TBM42ERR.png",
  "assets/layers-55W3Q4RM.png",
  "assets/main-5TCQGCPH.js",
  "assets/marker-icon-2V3QKKVC.png",
  "assets/noto-serif-sc-600-b01-2HB7PWHM.woff2",
  "assets/noto-serif-sc-600-b02-4QHOPPLR.woff2",
  "assets/noto-serif-sc-600-b03-KMVGWRKJ.woff2",
  "assets/noto-serif-sc-600-b04-Y6MGWBZS.woff2",
  "assets/noto-serif-sc-600-b05-JHZKZBAC.woff2",
  "assets/noto-serif-sc-600-b06-CUACTZJX.woff2",
  "assets/noto-serif-sc-600-b07-4P5GA3J5.woff2",
  "assets/noto-serif-sc-600-b08-54AIGV3T.woff2",
  "assets/noto-serif-sc-600-b09-JSTVIVJV.woff2",
  "assets/noto-serif-sc-600-b10-T2JMVFVM.woff2",
  "assets/noto-serif-sc-600-b11-7XBPPLSM.woff2",
  "assets/noto-serif-sc-600-b12-DJCRGYTD.woff2",
  "assets/noto-serif-sc-600-b13-7OS3APVK.woff2",
  "assets/noto-serif-sc-600-b14-NVHGS4XG.woff2",
  "assets/noto-serif-sc-600-b15-KBV7HBZU.woff2",
  "assets/noto-serif-sc-600-b16-LLR6RINF.woff2",
  "assets/noto-serif-sc-600-b17-532ERP4O.woff2",
  "assets/noto-serif-sc-600-b18-22KACJB2.woff2",
  "assets/noto-serif-sc-600-b19-TXXUEJ27.woff2",
  "assets/noto-serif-sc-600-b20-ZPXSZ5XP.woff2",
  "assets/noto-serif-sc-600-b21-5BBVANGR.woff2",
  "assets/noto-serif-sc-600-b22-2LH3JASL.woff2",
  "assets/noto-serif-sc-600-b23-HMVYI47Q.woff2",
  "assets/noto-serif-sc-600-b24-FZJUIWRV.woff2",
  "assets/noto-serif-sc-600-b25-RH5MQRG2.woff2",
  "assets/noto-serif-sc-600-b26-WHZL23JY.woff2",
  "assets/noto-serif-sc-600-b27-C3SYT2NO.woff2",
  "assets/noto-serif-sc-600-b28-7HVAG6UC.woff2",
  "assets/noto-serif-sc-600-b29-3COZFSNN.woff2",
  "assets/noto-serif-sc-600-b30-AC6HWDPR.woff2",
  "assets/noto-serif-sc-600-b31-7OA44D6U.woff2",
  "assets/noto-serif-sc-600-b32-VJCBL7SL.woff2",
  "assets/noto-serif-sc-600-b33-TDZMMSFI.woff2",
  "assets/noto-serif-sc-600-b34-FEJREPUO.woff2",
  "assets/noto-serif-sc-600-ext-WDUBKZ5S.woff2",
  "assets/noto-serif-sc-600-latin-ZW5GJPFA.woff2",
  "assets/noto-serif-sc-600-t113a-4QXEW2PG.woff2",
  "assets/noto-serif-sc-600-t113b-4TGSXLCG.woff2",
  "assets/noto-serif-sc-600-t113c-KD4ENNXJ.woff2",
  "assets/noto-serif-sc-600-t114a-XTBGW7UG.woff2",
  "assets/noto-serif-sc-600-t114b-WPYZWEHZ.woff2",
  "assets/noto-serif-sc-600-t114c-YXBYM35M.woff2",
  "assets/noto-serif-sc-600-t115a-FU35DJPJ.woff2",
  "assets/noto-serif-sc-600-t115b-KF3SIGCJ.woff2",
  "assets/noto-serif-sc-600-t115c-TIQI5HOF.woff2",
  "assets/noto-serif-sc-600-t116a-UQJM6ZDO.woff2",
  "assets/noto-serif-sc-600-t116b-EAA7N5SL.woff2",
  "assets/noto-serif-sc-600-t116c-UD23Q2CS.woff2",
  "assets/noto-serif-sc-600-t117a-5NFD32YK.woff2",
  "assets/noto-serif-sc-600-t117b-XYQHPJPL.woff2",
  "assets/noto-serif-sc-600-t117c-UP2NWIRC.woff2",
  "assets/noto-serif-sc-600-t119-118a-SXGIJMKA.woff2",
  "assets/noto-serif-sc-600-t119-118b-TKR4XXVY.woff2",
  "assets/noto-serif-sc-600-t119-118c-R6K2BTTX.woff2",
  "assets/p2-figure-one-JW32YCFS.woff2",
  "assets/p2-figure-one-italic-TLQIMN4Y.woff2",
  "assets/style-2SACZFVQ.css",
  "assets/style-2W5FZGKK.css",
  "assets/style-2ZXH26UU.css",
  "assets/style-37KWE3H6.css",
  "assets/style-3XJRYVRZ.css",
  "assets/style-43CRCUJB.css",
  "assets/style-5CDHYXWW.css",
  "assets/style-5DUN4QTB.css",
  "assets/style-66HUHIS7.css",
  "assets/style-6ZFEWYPC.css",
  "assets/style-7HICZAQO.css",
  "assets/style-7MGHE3IT.css",
  "assets/style-A26O6IN3.css",
  "assets/style-ALFVH2HD.css",
  "assets/style-AXVQ3A7T.css",
  "assets/style-BYCIQIED.css",
  "assets/style-CPU7KAVW.css",
  "assets/style-CSRVMH6M.css",
  "assets/style-DLCZTVAI.css",
  "assets/style-DO2DCXDR.css",
  "assets/style-DWSBC45S.css",
  "assets/style-E6DGNUJJ.css",
  "assets/style-FHLUGSBV.css",
  "assets/style-G64AJBWT.css",
  "assets/style-G7FF7TB5.css",
  "assets/style-GWUCDDWJ.css",
  "assets/style-H4FY3I2F.css",
  "assets/style-H4LJSFLA.css",
  "assets/style-HEEP2664.css",
  "assets/style-HKGVPYPJ.css",
  "assets/style-IBVANMEI.css",
  "assets/style-JFYYUVOO.css",
  "assets/style-KJM2GF3F.css",
  "assets/style-KRIDXDWF.css",
  "assets/style-KUVSDPIO.css",
  "assets/style-LHACFMVW.css",
  "assets/style-LHW3332L.css",
  "assets/style-LUIUULKX.css",
  "assets/style-LYWFNUCI.css",
  "assets/style-N64VV4OP.css",
  "assets/style-NHHGQEFH.css",
  "assets/style-NHVYOWTH.css",
  "assets/style-OPK2LXH3.css",
  "assets/style-OXRUGLVH.css",
  "assets/style-PQ34HDW3.css",
  "assets/style-PZTEZ3WR.css",
  "assets/style-QAOTKXJ3.css",
  "assets/style-RR6NWXYX.css",
  "assets/style-S24W2IJX.css",
  "assets/style-UQAIRCXD.css",
  "assets/style-V5ECOBUM.css",
  "assets/style-VBOLBMNN.css",
  "assets/style-WBY3I6VR.css",
  "assets/style-XIHP2TAU.css",
  "assets/style-YWPKO5CN.css",
  "assets/style-Z2ALGMKI.css",
  "assets/style-ZDTTRCRX.css"
];

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
