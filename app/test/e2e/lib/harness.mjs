// =====================================================================
// test/e2e/lib/harness.mjs：端到端测试的公用工具（各模块写 e2e 时直接用）。
//
//   import { openApp } from './lib/harness.mjs';
//   const app = await openApp({ hash: '#/dev/primitives', device: 'mobile', colorScheme: 'dark' });
//   await app.page.click('[data-testid="springs-toggle"]');
//   await app.shot('springs-dark');          // → test/e2e/__screenshots__/<测试文件名>/springs-dark.png
//   app.assertClean();                       // 没有控制台报错、页面异常、外网请求
//   await app.close();
//
// 做了这些事：
//   - 起一个模拟 GitHub Pages 的本地服务器（构建输出目录挂在 /taiwan-trip-2026/ 下，用的是 npm run build 的产物；
//     默认是仓库根目录，设了 RS_OUT_DIR 就是那个目录；端口由系统分配空闲的）；
//   - 用本机 Chrome（puppeteer-core）打开，默认 iPhone 尺寸 390×844、3 倍屏、触摸；
//   - 默认演示模式（?demo=1）、不注册 Service Worker（?nosw=1，测 PWA 时传 sw: true）；
//   - 拦截所有发往外网的请求（Supabase、地图瓦片……）并记下来：演示模式绝不能连真实后台；
//   - 收集控制台 error、页面异常、同源请求失败（含 CSP 拦截）；
//   - 等启动画面消失（第一页渲染完）再把控制权交给测试。
// =====================================================================

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchChrome } from '../../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../../scripts/lib/static-server.mjs';
import { E2E_SHOTS_ROOT } from '../../../scripts/lib/paths.mjs';

/** test/e2e/ 目录 */
export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 截图根目录：默认 test/e2e/；设了 RS_OUT_DIR 时是 <RS_OUT_DIR>/_e2e/（并行跑的 e2e 截图不互相覆盖），
 * RS_E2E_SHOTS 可单独指定。下面分 __screenshots__/（整页验收图）和 __shots__/（动效半路图、弹层图）。
 */
export const SHOTS_ROOT = E2E_SHOTS_ROOT;
export const SCREENSHOT_DIR = path.join(SHOTS_ROOT, '__screenshots__');
/** 动效 / 弹层截图：__shots__/<子目录> */
export const shotsDir = (sub) => path.join(SHOTS_ROOT, '__shots__', sub);

export const DEVICES = {
  /** iPhone 15 / 16 一类：390×844，3 倍屏 */
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  /** 小屏手机：iPhone SE */
  small: { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  /** 桌面浏览器 */
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

/** 调用者测试文件的名字（截图分目录用） */
function callerName() {
  const stack = new Error().stack.split('\n');
  for (const line of stack) {
    const m = /(\/[^\s()]+\.e2e\.mjs)/.exec(line);
    if (m) return path.basename(m[1], '.e2e.mjs');
  }
  return 'misc';
}

/**
 * 打开应用。
 * @param {Object} [o]
 * @param {string} [o.hash='#/trips']          要打开的路由
 * @param {boolean} [o.demo=true]              演示模式
 * @param {boolean} [o.sw=false]               注册 Service Worker（默认不注册，测试互不干扰）
 * @param {'mobile'|'small'|'desktop'} [o.device='mobile']
 * @param {'light'|'dark'} [o.colorScheme='light']
 * @param {boolean} [o.reducedMotion=false]    模拟“减弱动态效果”
 * @param {string} [o.now]                     把应用里的“现在”拨到这个时刻（lib/clock.js），如 '2027-01-11T10:00:00+07:00'
 * @param {Record<string,string>} [o.search]   其他 ?参数
 * @param {object} [o.server]                  复用已有的服务器（startStaticServer 的返回值）
 * @param {object} [o.browser]                 复用已有的浏览器
 * @param {boolean} [o.waitForApp=true]
 * @param {boolean} [o.intercept=true]          拦截并阻断外网请求；false = 只记录不阻断
 *                                            （测 Service Worker 用 clients.navigate() 刷新页面时要关掉，否则导航会卡住）
 */
export async function openApp(o = {}) {
  const {
    hash = '#/trips', demo = true, sw = false, device = 'mobile', colorScheme = 'light', reducedMotion = false,
    now, search = {}, waitForApp = true, intercept = true,
  } = o;
  const ownServer = !o.server;
  const server = o.server || await startStaticServer();
  const ownBrowser = !o.browser;
  const browser = o.browser || await launchChrome();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const testName = callerName();

  const errors = [];
  const external = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`页面异常: ${err.message}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith(server.origin) && !/net::ERR_ABORTED/.test(req.failure()?.errorText || '')) {
      errors.push(`请求失败: ${url} ${req.failure()?.errorText}`);
    }
  });
  const isLocal = (url) => url.startsWith(server.origin) || url.startsWith('data:') || url.startsWith('blob:');
  if (intercept) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (isLocal(url)) {
        req.continue();
      } else {
        external.push(url);
        req.abort('blockedbyclient');
      }
    });
  } else {
    // 不拦截（Service Worker 用 clients.navigate() 发起的导航和请求拦截一起用会卡住），只记录
    page.on('request', (req) => {
      if (!isLocal(req.url())) external.push(req.url());
    });
  }

  await page.setViewport(DEVICES[device]);
  if (DEVICES[device].isMobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  }
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: colorScheme },
    { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
  ]);

  const params = new URLSearchParams();
  if (demo) params.set('demo', '1');
  if (!sw) params.set('nosw', '1');
  if (now) params.set('now', now);
  for (const [k, v] of Object.entries(search)) params.set(k, v);
  const qs = params.toString();
  const url = `${server.url}${qs ? `?${qs}` : ''}${hash}`;

  const app = {
    browser, context, page, server, url, errors, external, testName, device,
    /** 等第一页渲染完（启动画面移除） */
    async ready() {
      await page.waitForFunction(() => !document.getElementById('boot') && document.querySelector('#main > *'), { timeout: 15000 });
    },
    /** 跳到另一个路由（改 hash，和用户点链接一样走路由器） */
    async go(nextHash) {
      await page.evaluate((h) => { window.location.hash = h; }, nextHash);
      await page.waitForFunction((h) => window.location.hash === h || window.location.hash.startsWith(`${h}?`), {}, nextHash);
      await app.idle();
    },
    /** 等路由切换和渲染安定（两帧 + 没有正在跑的动画） */
    async idle(timeout = 5000) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), { timeout }).catch(() => {});
    },
    /**
     * 截图：<截图根目录>/__screenshots__/<测试文件>/<名字>[-desktop].png（默认根目录 test/e2e/）；fullPage 默认 true。
     * 页面太长时自动分段（<名字>-1.png、-2.png……，见 fullPageShots），返回第一张。
     */
    async shot(name, { fullPage = true, clip } = {}) {
      const dir = path.join(SCREENSHOT_DIR, testName);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}${device === 'mobile' ? '' : `-${device}`}.png`);
      if (fullPage && !clip) return (await fullPageShots(page, file))[0];
      await page.screenshot({ path: file, fullPage: false, clip });
      return file;
    },
    /** 断言：没有报错、没有外网请求 */
    assertClean({ allowErrors = [] } = {}) {
      const errs = errors.filter((e) => !allowErrors.some((re) => re.test(e)));
      assert.deepEqual(errs, [], `页面有报错：\n${errs.join('\n')}`);
      assert.deepEqual(external, [], `页面向外网发了请求：\n${external.join('\n')}`);
    },
    async close() {
      await context.close().catch(() => {});
      if (ownBrowser) await browser.close().catch(() => {});
      if (ownServer) await server.close();
    },
  };

  await page.goto(url, { waitUntil: 'load' });
  if (waitForApp) await app.ready();
  return app;
}

/**
 * 整页截图前把 loading="lazy" 的图片都加载好（不滚动页面就不会加载，整页截图里会是空白占位）。
 * @param {import('puppeteer-core').Page} page
 */
export async function loadLazyImages(page) {
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img[loading="lazy"]')];
    for (const img of imgs) img.loading = 'eager';
    await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
      setTimeout(r, 3000);
    }))));
    await Promise.all(imgs.map((img) => img.decode?.().catch(() => {})));
  });
}

/** 一张截图最多多高（设备像素）：Chrome 截图的纹理上限约 16384px，超过以后下面的画面会重复上面的内容 */
const MAX_SHOT_PX = 15000;

/**
 * 截整页。页面 × 设备像素比超过 MAX_SHOT_PX 时分段截成 <文件名>-1.png、-2.png……（每段完整、首尾相接，
 * 按顺序拼起来就是整页）；不超过就是一张 <文件名>.png。会删掉同名的旧截图（单张 / 分段），免得新旧混在一起。
 * @param {import('puppeteer-core').Page} page
 * @param {string} file 目标文件（.png）
 * @returns {Promise<string[]>} 写出的文件
 */
export async function fullPageShots(page, file) {
  await loadLazyImages(page);
  const dir = path.dirname(file);
  const base = path.basename(file, '.png');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    const segment = f.startsWith(`${base}-`) && /^\d+\.png$/.test(f.slice(base.length + 1));
    if (f === `${base}.png` || segment) rmSync(path.join(dir, f), { force: true });
  }
  const { height, width, dpr } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.clientWidth,
    dpr: window.devicePixelRatio || 1,
  }));
  const seg = Math.floor(MAX_SHOT_PX / dpr);
  if (height <= seg) {
    await page.screenshot({ path: file, fullPage: true, captureBeyondViewport: true });
    return [file];
  }
  const files = [];
  for (let i = 0, y = 0; y < height; i += 1, y += seg) {
    const f = path.join(dir, `${base}-${i + 1}.png`);
    await page.screenshot({ path: f, clip: { x: 0, y, width, height: Math.min(seg, height - y) }, captureBeyondViewport: true });
    files.push(f);
  }
  return files;
}

/** 断言页面没有横向滚动（手机上左右晃是大忌） */
export async function assertNoHorizontalOverflow(page) {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1)) {
        // 自身在横向滚动容器里的不算（例如可横滑的胶囊导航）
        let p = el.parentElement;
        let scrollable = false;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { scrollable = true; break; }
          p = p.parentElement;
        }
        if (!scrollable) list.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: vw, offenders: list.slice(0, 10) };
  });
  assert.ok(scrollWidth <= clientWidth, `页面有横向滚动：scrollWidth ${scrollWidth} > ${clientWidth}`);
  assert.deepEqual(offenders, [], `这些元素超出了屏幕：${offenders.join(', ')}`);
}

/**
 * 断言可点的东西触控区 ≥ min（默认 44px）。会把 ::after / ::before 扩出去的热区算进去；inert 的元素不算（不能点）。
 * @param {import('puppeteer-core').Page} page
 * @param {{ min?: number, exclude?: string }} [o] exclude：不检查的选择器（如第三方地图控件）
 */
export async function assertTapTargets(page, { min = 44, exclude = '' } = {}) {
  const small = await page.evaluate((minSize, excludeSel) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), select, textarea, summary';
    for (const el of document.querySelectorAll(sel)) {
      if (excludeSel && el.closest(excludeSel)) continue;
      // inert 的元素（静止展示的样品、弹层背后的页面）不能点，不算
      if (el.closest('[inert]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let w = r.width;
      let h = r.height;
      for (const pseudo of ['::after', '::before']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const n = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
        w = Math.max(w, r.width - n(ps.left) - n(ps.right));
        h = Math.max(h, r.height - n(ps.top) - n(ps.bottom));
      }
      if (w < minSize - 0.5 || h < minSize - 0.5) {
        out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}」${Math.round(w)}×${Math.round(h)}`);
      }
    }
    return out;
  }, min, exclude);
  assert.deepEqual(small, [], `这些可点元素小于 ${min}px：\n${small.join('\n')}`);
}
