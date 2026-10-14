// PWA：Service Worker 安装与预缓存、断网也能打开、发新版后的「有新版本，点此刷新」、
// 从旧版（th-* 缓存）平滑接管、manifest 和图标、绝不缓存外部接口。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openApp } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { OUT_DIR, PAGES_BASE } from '../../scripts/lib/paths.mjs';

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const SW_PATH = `${PAGES_BASE}sw.js`;

/** 等 Service Worker 接管页面 */
async function waitForController(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 }).catch(async () => {
    // 首次安装后第一次加载不受控制：刷新一次
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  });
}

test('Service Worker：安装、预缓存全部线上资源、版本号和页面一致', async () => {
  const app = await openApp({ browser, server, sw: true, demo: false });
  try {
    const { page } = app;
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);
    const info = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.startsWith('rs7885-shell-'));
      const cache = await caches.open(shell);
      const urls = (await cache.keys()).map((r) => new URL(r.url).pathname);
      const version = document.querySelector('meta[name="app-version"]').content;
      const swVersion = await new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data.version);
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      });
      return { keys, shell, urls, version, swVersion, scope: (await navigator.serviceWorker.ready).scope };
    });
    // 外壳缓存只有一个；字体用到时另存进不带版本号的 rs7885-fonts（A 皮肤的网页字体，见 src/sw/README.md）
    assert.deepEqual(info.keys.filter((k) => k !== 'rs7885-fonts'), [info.shell], `只有一个外壳缓存：${info.keys}`);
    assert.equal(info.shell, `rs7885-shell-${info.version}`);
    assert.equal(info.swVersion, info.version);
    assert.equal(new URL(info.scope).pathname, PAGES_BASE, 'scope 是仓库子路径（相对注册，没有写死）');
    const sw = readFileSync(path.join(OUT_DIR, 'sw.js'), 'utf8');
    const precache = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1]);
    // 字体不在安装时预缓存（思源宋体切成几十片，一屏只用几片），其他清单里的文件全部预缓存
    const installList = precache.filter((p) => !/\.woff2$/.test(p));
    assert.ok(precache.length > installList.length, '清单里有字体（构建产物里有 .woff2）');
    assert.equal(info.urls.length, installList.length);
    for (const p of installList) assert.ok(info.urls.includes(new URL(p, `http://x${PAGES_BASE}`).pathname), `预缓存了 ${p}`);
    assert.ok(!info.urls.some((u) => /\.woff2$/.test(u)), '字体不进外壳缓存');
    assert.ok(!info.urls.some((u) => /demo-photo|\.pdf$/.test(u)), '演示素材不进预缓存');
    // 没登录 → 登录页；页脚显示“离线可用”（lib/pwa.js 的 swControlled）
    await page.waitForFunction(() => /离线可用/.test(document.querySelector('[data-testid="login-foot"]')?.textContent || ''), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('断网后刷新：入口页和全部代码从缓存打开，照常渲染', async () => {
  const app = await openApp({ browser, server, sw: true, demo: false });
  try {
    const { page } = app;
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    // 没登录 → 登录页：入口、外壳、数据层、supabase-js、登录页代码都从缓存来
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === '登录', { timeout: 8000 });
    // 换到另一个按需加载的页面（不用登录的“加入行程”占位页）：它的分包也在缓存里
    await app.go('#/join/ABCD-1234');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === '加入行程');
    await page.setOfflineMode(false);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('M2 网络“假通”（入口页请求一直挂着）：页面从缓存秒开，不卡在启动画面', async () => {
  const app = await openApp({ browser, server, sw: true, demo: false });
  try {
    const { page } = app;
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);
    // 酒店 Wi-Fi 认证页 / 漫游弱信号：显示在线，但入口页的请求一直不返回
    server.stall(PAGES_BASE);
    server.stall(`${PAGES_BASE}index.html`);
    try {
      const t0 = Date.now();
      await page.reload({ waitUntil: 'load', timeout: 10000 });
      await app.ready();
      const ms = Date.now() - t0;
      assert.ok(ms < 3000, `从缓存打开应该很快，实际 ${ms}ms`);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === '登录', { timeout: 8000 });
    } finally {
      server.stall(PAGES_BASE, false);
      server.stall(`${PAGES_BASE}index.html`, false);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('M1 页面版本永远和控制它的 SW 一致：服务器上已经是新版入口页，打开的仍是 SW 那一版（新版只通过「点此刷新」切换）', async () => {
  const app = await openApp({ browser, server, sw: true, demo: false });
  try {
    const { page } = app;
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);
    const version = await page.$eval('meta[name="app-version"]', (m) => m.content);
    // 模拟发版：服务器上的入口页换成新版本号（sw.js 不变 = 新 SW 还没装好的那一刻）
    const html = readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
    const next = html.replace(/(<meta name="app-version" content=")([^"]+)(")/, '$1$2-next$3');
    assert.notEqual(next, html);
    server.override(PAGES_BASE, next, 'text/html; charset=utf-8');
    server.override(`${PAGES_BASE}index.html`, next, 'text/html; charset=utf-8');
    try {
      await page.reload({ waitUntil: 'load' });
      await app.ready();
      const shown = await page.$eval('meta[name="app-version"]', (m) => m.content);
      const swVersion = await page.evaluate(() => new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data.version);
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }));
      assert.equal(shown, version, '页面还是 SW 那一版');
      assert.equal(swVersion, shown, '页面版本 = 控制它的 SW 的版本（按需加载的分包都在同一版缓存里）');
      // 断网后去一个还没打开过的按需加载页面：分包在同一版缓存里，照样打开
      await page.setOfflineMode(true);
      await app.go('#/join/ABCD-1234');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === '加入行程', { timeout: 8000 });
      await page.setOfflineMode(false);
    } finally {
      server.override(PAGES_BASE, null);
      server.override(`${PAGES_BASE}index.html`, null);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('发了新版本：底部出现「有新版本，点此刷新」，点了切到新版本', async () => {
  const app = await openApp({ browser, server, sw: true, demo: false });
  try {
    const { page } = app;
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);
    const oldVersion = await page.$eval('meta[name="app-version"]', (m) => m.content);
    // 模拟发版：服务器上的 sw.js 换了一个版本号
    const original = readFileSync(path.join(OUT_DIR, 'sw.js'), 'utf8');
    const next = original.replace(/const VERSION = "([^"]+)";/, 'const VERSION = "$1-next";');
    assert.notEqual(next, original);
    server.override(SW_PATH, next);
    try {
      await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
      const prompt = await page.waitForSelector('.update-prompt__button', { visible: true, timeout: 15000 });
      await app.idle(); // 等浮出动画播完再量尺寸
      assert.equal(await prompt.evaluate((el) => el.textContent.trim()), '有新版本，点此刷新');
      const box = await prompt.boundingBox();
      assert.ok(box.height >= 44, '按钮够大');
      await app.shot('update-prompt', { fullPage: false });
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), prompt.click()]);
      await app.ready();
      const swVersion = await page.evaluate(() => new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data.version);
        navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }));
      assert.equal(swVersion, `${oldVersion}-next`);
      const keys = await page.evaluate(() => caches.keys());
      // 旧版本的外壳缓存清掉了；字体缓存不带版本号、发新版也留着（文件名带内容哈希，同名就是同一个文件）
      assert.deepEqual(keys.filter((k) => k !== 'rs7885-fonts'), [`rs7885-shell-${oldVersion}-next`], '旧版本的缓存清掉了');
      assert.equal(await page.$('.update-prompt'), null);
    } finally {
      server.override(SW_PATH, null);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('从旧网站升级：旧页面注册 sw.js 后，新 SW 发现旧版缓存 th-* 就直接接管、删掉旧缓存、刷新页面', async () => {
  // 模拟还开着的旧版页面：没有新 SW，有旧版的缓存 th-v4；旧版页面自己会 register("sw.js")
  const app = await openApp({ browser, server, sw: false, demo: false, intercept: false });
  try {
    const { page } = app;
    await page.evaluate(async () => {
      const c = await caches.open('th-v4');
      await c.put(new Request('legacy-index.html'), new Response('<p>old</p>'));
    });
    const reloaded = page.waitForNavigation({ waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => navigator.serviceWorker.register('sw.js', { scope: './' }));
    await reloaded; // 新 SW 激活后让旧页面刷新了一次
    await app.ready();
    const state = await page.evaluate(async () => ({
      keys: await caches.keys(),
      controlled: navigator.serviceWorker.controller !== null,
    }));
    assert.ok(!state.keys.includes('th-v4'), `旧缓存删掉了：${state.keys}`);
    assert.ok(state.keys.some((k) => k.startsWith('rs7885-shell-')));
    assert.ok(state.controlled, '新 SW 已接管（没有等用户关掉所有标签页）');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === '登录', { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('manifest 和图标：能取到、类型正确、相对路径解析到仓库子路径下', async () => {
  const app = await openApp({ browser, server, demo: false });
  try {
    const { page } = app;
    const result = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const res = await fetch(link.href);
      const manifest = await res.json();
      const icons = await Promise.all(manifest.icons.map(async (i) => {
        const r = await fetch(new URL(i.src, link.href));
        return { src: new URL(i.src, link.href).pathname, status: r.status, type: r.headers.get('content-type') };
      }));
      const apple = await fetch(document.querySelector('link[rel="apple-touch-icon"]').href);
      return { type: res.headers.get('content-type'), start: new URL(manifest.start_url, link.href).pathname, icons, apple: apple.status };
    });
    assert.match(result.type, /application\/manifest\+json/);
    assert.equal(result.start, PAGES_BASE);
    for (const i of result.icons) {
      assert.equal(i.status, 200, i.src);
      assert.ok(i.src.startsWith(`${PAGES_BASE}icons/`), i.src);
    }
    assert.equal(result.apple, 200);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('Service Worker 不拦截外部接口：跨域请求不进缓存', async () => {
  const sw = readFileSync(path.join(OUT_DIR, 'sw.js'), 'utf8');
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.doesNotMatch(sw, /supabase\.co|open-meteo|tile\.openstreetmap/, 'sw.js 里不应出现任何外部接口的域名');
});
