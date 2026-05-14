// 旅行手帐 Service Worker
// 缓存策略：App Shell 优先缓存，Supabase / CDN 走网络
const CACHE = "th-v1";
const SHELL = [
  "/taiwan-trip-2026/",
  "/taiwan-trip-2026/index.html",
  "/taiwan-trip-2026/manifest.json",
  "/taiwan-trip-2026/icon-192.svg"
];

// 安装：预缓存 App Shell
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// 激活：清除旧版本缓存
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 拦截请求
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Supabase、CDN、外部 API — 永远走网络，不缓存
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("unpkg.com") ||
    url.hostname.includes("jsdelivr.net") ||
    url.hostname.includes("nominatim.openstreetmap.org")
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response("", { status: 503 })));
    return;
  }

  // App Shell — 缓存优先，网络降级
  if (e.request.method === "GET") {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
