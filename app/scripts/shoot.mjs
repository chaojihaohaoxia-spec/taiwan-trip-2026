#!/usr/bin/env node
// =====================================================================
// scripts/shoot.mjs：截图工具（写页面时核对真实渲染用）。node scripts/shoot.mjs --help 看用法。
//
// 每张图都是全新的浏览器上下文（没有缓存、存储），截之前等：第一页渲染完（启动画面消失）→ 字体加载完
// （document.fonts.ready）→ 网络空闲（开发服务器的自动刷新长连接不算）→ 动画播完。文件名 <名字>-<宽度>-<主题>.png。
// 外网请求一律拦下（演示模式本来就不该连外网），控制台报错、页面异常、被拦的外网请求会在最后列出来。
// =====================================================================

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, REPO_ROOT, OUT_DIR, OUTPUTS, isInsideReal } from './lib/paths.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { startStaticServer } from './lib/static-server.mjs';
import { fullPageShots } from '../test/e2e/lib/harness.mjs';

export const HELP = `截图工具：在真实浏览器（本机 Chrome）里按几种宽度、浅色 / 深色截页面。

用法：
  node scripts/shoot.mjs [目标] --routes '<名字>=#/路由,…' [选项]

目标（三选一，默认自动起一个临时的开发服务器，截完关掉）：
  --base <网址>        用已经开着的服务器，例如 --base http://localhost:5173/
  --dist <目录>        用构建产物（自己起静态服务器，挂在 /taiwan-trip-2026/ 下），例如 --dist "$RS_OUT_DIR"
                       不写目录值时用当前的构建输出目录（RS_OUT_DIR，没设就是仓库根目录）

选项：
  --routes <列表>      要截的页面，逗号分隔的 名字=#/路由，例如
                       'home=#/t/demo-island,d1=#/t/demo-island/day/2027-01-10,fab=#/t/demo-island?sheet=fab'
                       （路由里的弹层栈 sheet=a,b 带逗号也没关系）。默认 'trips=#/trips'
  --widths <列表>      宽度，默认 390。高度：390→844、375→667、1280→800，其他宽度手机按 19.5:9、
                       768 以上按 4:3 / 桌面 800；也可以直接写 390x700
  --themes <列表>      light,dark（模拟系统的浅色 / 深色），默认 light
  --now <时间>         把应用里的“现在”拨到这个时刻（必须带时区），如 2027-01-11T10:00:00+07:00
  --real               本机真实数据预览（网址加 real=1；要么不写目标让工具自己起 npm run dev -- --real，
                       要么 --base 指向用 --real 启动的开发服务器）。--out 必须在仓库外，否则直接报错退出
  --no-demo            不加 ?demo=1（默认加：演示数据、不连后台）
  --full               截整页（太长自动分段：<文件名>-1.png、-2.png……）；默认只截一屏
  --out <目录>         截图放哪里，默认 系统临时目录/rs7885-shots/<时间>
  --scale <倍数>       设备像素比，默认 2
  --reduced            模拟“减弱动态效果”
  --wait <毫秒>        都安定以后再多等一会儿（默认 0）
  --wait-for <选择器>  等这个元素出现再截（比如数据加载完才有的元素）
  --type <名字>=<文字> 截这个名字的页面前，往获得焦点的输入框里打这些字（例如搜索有结果：
                       --routes 'search=#/t/demo-island?sheet=search' --type 'search=pho'）；可以写几次
  --scroll <名字>=<位置> 截这个名字的页面前先滚到某处；可以写几次。位置：像素（600）、bottom（滚到底）、
                       或 CSS 选择器（把这个元素滚到底栏后面：元素中心对准底栏中心，没有底栏就对准屏幕底边），
                       例如看底栏后面是深色照片：--scroll "photo=img[src*='demo-photo-03']"
  --scroll-back <像素> 滚到位置以后再往回（往上）滚这么多，像手指往回带一下：底栏从收小的样子弹回完整（默认 0）
  --sheet              另外生成一张拼图总览 sheet.png（每个页面一行，各宽度、主题并排，带标注）
  --help               显示这段说明

例子：
  node scripts/shoot.mjs --routes 'home=#/t/demo-island' --widths 390,375,1280 --themes light,dark --sheet \\
    --out /private/tmp/…/shots/me
  node scripts/shoot.mjs --base http://localhost:5173/ --routes 'fab=#/t/demo-island?sheet=fab' --now 2027-01-11T10:00:00+07:00
  node scripts/shoot.mjs --real --routes 'pq=#/t/phuquoc2026' --out /private/tmp/…/shots/real
`;

/** 已知宽度的视口高度 */
const HEIGHTS = { 320: 568, 375: 667, 390: 844, 393: 852, 414: 896, 428: 926, 430: 932, 768: 1024, 1024: 768, 1280: 800, 1440: 900 };
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const THEME_LABEL = { light: '浅色', dark: '深色' };

/** '390' → { width: 390, height: 844 }；'390x700' → { 390, 700 } */
export function parseViewport(text) {
  const m = /^(\d{3,4})(?:x(\d{3,4}))?$/i.exec(String(text).trim());
  if (!m) throw new Error(`宽度写法不对：${text}（例：390 或 390x700）`);
  const width = Number(m[1]);
  const height = m[2] ? Number(m[2]) : HEIGHTS[width] ?? (width < 768 ? Math.round(width * 19.5 / 9) : width < 1024 ? Math.round(width * 4 / 3) : 800);
  return { width, height, label: m[2] ? `${width}x${height}` : String(width) };
}

/**
 * 'home=#/t/x,fab=#/t/x?sheet=a,b:1' → [{ name: 'home', hash: '#/t/x' }, { name: 'fab', hash: '#/t/x?sheet=a,b:1' }]
 * 只在“逗号后面紧跟 名字=#”的地方切开，路由里的逗号保留。没写名字的用路由生成一个。
 */
export function parseRoutes(text) {
  const parts = String(text || '').split(/,(?=\s*[A-Za-z0-9_\u4e00-\u9fff-]+=#|\s*#)/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  return parts.map((part) => {
    const eq = part.indexOf('=');
    let name;
    let hash;
    if (eq > 0 && part.slice(eq + 1).startsWith('#')) {
      name = part.slice(0, eq).trim();
      hash = part.slice(eq + 1).trim();
    } else if (part.startsWith('#')) {
      hash = part;
      name = part.replace(/^#\/?/, '').replace(/[?].*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'root';
    } else {
      throw new Error(`路由写法不对：${part}（例：home=#/t/demo-island）`);
    }
    if (!/^[A-Za-z0-9_\u4e00-\u9fff-]+$/.test(name)) throw new Error(`名字只能用字母、数字、中文、- 和 _：${name}`);
    if (seen.has(name)) throw new Error(`名字重复：${name}`);
    seen.add(name);
    return { name, hash };
  });
}

/** 解析命令行 */
export function parseArgs(argv) {
  const o = {
    base: null, dist: null, routes: 'trips=#/trips', widths: '390', themes: 'light', now: null, real: false, demo: true,
    full: false, out: null, scale: 2, reduced: false, wait: 0, waitFor: null, sheet: false, help: false, types: {},
    scrolls: {}, scrollBack: 0,
  };
  const take = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} 后面要跟一个值`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.includes('=') && a.startsWith('--') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const v = take(i, flag);
      i += 1;
      return v;
    };
    switch (flag) {
      case '--help': case '-h': o.help = true; break;
      case '--base': o.base = value(); break;
      case '--dist': {
        const next = argv[i + 1];
        if (inline !== undefined) o.dist = inline;
        else if (next && !next.startsWith('--')) { o.dist = next; i += 1; } else o.dist = OUT_DIR;
        break;
      }
      case '--routes': o.routes = value(); break;
      case '--widths': o.widths = value(); break;
      case '--themes': o.themes = value(); break;
      case '--now': o.now = value(); break;
      case '--real': o.real = true; break;
      case '--no-demo': o.demo = false; break;
      case '--full': o.full = true; break;
      case '--out': o.out = value(); break;
      case '--scale': o.scale = Number(value()); break;
      case '--reduced': o.reduced = true; break;
      case '--wait': o.wait = Number(value()); break;
      case '--wait-for': o.waitFor = value(); break;
      case '--type': {
        const v = value();
        const at = v.indexOf('=');
        if (at <= 0) throw new Error(`--type 要写成 名字=文字：${v}`);
        o.types[v.slice(0, at)] = v.slice(at + 1);
        break;
      }
      case '--scroll': {
        const v = value();
        const at = v.indexOf('=');
        if (at <= 0 || at === v.length - 1) throw new Error(`--scroll 要写成 名字=位置（像素、bottom 或选择器）：${v}`);
        o.scrolls[v.slice(0, at)] = v.slice(at + 1);
        break;
      }
      case '--scroll-back': o.scrollBack = Number(value()); break;
      case '--sheet': o.sheet = true; break;
      default: throw new Error(`不认识的参数：${a}（--help 看用法）`);
    }
  }
  if (o.help) return o;
  if (o.base && o.dist) throw new Error('--base 和 --dist 只能二选一');
  if (o.real && o.dist) throw new Error('--real 只能配开发服务器（构建产物里没有真实数据预览）：去掉 --dist');
  if (o.real && !o.demo) throw new Error('--real 是演示模式的一种，不能和 --no-demo 一起用');
  if (!Number.isFinite(o.scale) || o.scale < 1 || o.scale > 4) throw new Error('--scale 要在 1 到 4 之间');
  if (!Number.isFinite(o.wait) || o.wait < 0) throw new Error('--wait 要是不小于 0 的毫秒数');
  if (!Number.isFinite(o.scrollBack) || o.scrollBack < 0) throw new Error('--scroll-back 要是不小于 0 的像素数');
  if (o.now && (Number.isNaN(Date.parse(o.now)) || !/(Z|[+-]\d{2}:\d{2})$/.test(o.now))) {
    throw new Error(`--now 要写带时区的 ISO 时间，如 2027-01-11T10:00:00+07:00（现在是 ${o.now}）`);
  }
  o.routeList = parseRoutes(o.routes);
  o.viewports = String(o.widths).split(',').map((w) => w.trim()).filter(Boolean).map(parseViewport);
  o.themeList = String(o.themes).split(',').map((t) => t.trim()).filter(Boolean);
  for (const t of o.themeList) if (!THEME_LABEL[t]) throw new Error(`主题只能是 light / dark：${t}`);
  if (!o.routeList.length || !o.viewports.length || !o.themeList.length) throw new Error('--routes / --widths / --themes 都不能是空的');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  o.outDir = path.resolve(o.out || path.join(os.tmpdir(), 'rs7885-shots', stamp));
  if (o.real && isInside(o.outDir, REPO_ROOT)) {
    throw new Error(`--real 截到的是真实数据，--out 必须在仓库外（这是公开仓库）：${o.outDir}`);
  }
  return o;
}

/** 在不在 dir 里（按真实位置：仓库外一个指向仓库里的软链接也算在仓库里） */
function isInside(p, dir) {
  return isInsideReal(p, dir);
}

/** 起一个临时的开发服务器（npm run dev [-- --real]），等它打印出网址 */
async function startDevServer({ real }) {
  const args = [path.join(APP_DIR, 'scripts', 'dev.mjs')];
  if (real) args.push('--real');
  const child = spawn(process.execPath, args, { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let log = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`开发服务器 30 秒没起来：\n${log}`)), 30_000);
    const onData = (buf) => {
      log += buf.toString();
      const m = /正常模式\s+(http:\/\/\S+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (buf) => { log += buf.toString(); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`开发服务器退出了（${code}）：\n${log}`));
    });
  });
  if (real && /\[真实数据\][^\n]*失败|真实数据生成失败|没找到真实行程文件/.test(log)) {
    child.kill('SIGTERM');
    throw new Error(`真实数据没生成出来：\n${log}`);
  }
  return {
    url,
    log: () => log,
    close: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
    }),
  };
}

/** 目标网址：基础网址 + ?demo=1&nosw=1[&real=1][&now=…] + 路由 */
export function targetUrl(base, hash, { demo = true, real = false, now = null } = {}) {
  const u = new URL(base);
  u.hash = '';
  if (demo) u.searchParams.set('demo', '1');
  if (real) u.searchParams.set('real', '1');
  u.searchParams.set('nosw', '1');
  if (now) u.searchParams.set('now', now);
  return `${u.toString()}${hash}`;
}

/**
 * 网络空闲：除了开发服务器的自动刷新长连接（text/event-stream）以外，没有进行中的请求持续 idleMs。
 * 按网址记：同一个字体文件 Chrome 有时会发两次 request 事件、只结束一次（第二次走内存缓存），
 * 同一网址任何一次结束就算这个网址结束了。
 */
function trackNetwork(page) {
  const inflight = new Set();
  let lastChange = Date.now();
  const skip = (req) => /\/__dev\/events$/.test(req.url());
  page.on('request', (req) => { if (!skip(req)) { inflight.add(req.url()); lastChange = Date.now(); } });
  const done = (req) => { if (inflight.delete(req.url())) lastChange = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.on('requestservedfromcache', done);
  /** 返回 null = 安静了；否则是还没结束的请求网址 */
  return async function waitIdle({ idleMs = 400, timeout = 15_000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (inflight.size === 0 && Date.now() - lastChange >= idleMs) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [...inflight];
  };
}

/** 截一张 */
async function shootOne(browser, { url, origin, viewport, theme, o, file, name }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const problems = [];
  const external = [];
  try {
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`控制台报错：${msg.text()}`); });
    page.on('pageerror', (err) => problems.push(`页面异常：${err.message}`));
    // 控制台的 “Failed to load resource” 不带网址：同源请求失败（4xx / 5xx）单独记下是哪个文件
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith(origin)) problems.push(`请求失败 HTTP ${res.status()}：${res.url().slice(origin.length)}`);
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) req.continue();
      else {
        external.push(u);
        req.abort('blockedbyclient');
      }
    });
    const waitIdle = trackNetwork(page);
    const mobile = viewport.width < 768;
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: o.scale, isMobile: mobile, hasTouch: mobile });
    if (mobile) await page.setUserAgent(MOBILE_UA);
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: o.reduced ? 'reduce' : 'no-preference' },
    ]);
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => !document.getElementById('boot') && document.querySelector('#main > *'), { timeout: 20_000 }).catch((error) => {
      // 第一页 20 秒都没出来：把收集到的报错一起说出来（多半是打包出错或页面异常）
      const devError = problems.length ? `\n  ${[...new Set(problems)].slice(0, 8).join('\n  ')}` : '';
      throw new Error(`第一页 20 秒没渲染出来（${url}）${devError || `：${error.message}`}`);
    });
    if (o.waitFor) await page.waitForSelector(o.waitFor, { timeout: 15_000 });
    // --type：往获得焦点的输入框里打字（等输入框出来、拿到焦点；没有就点一下页面上第一个可见的输入框）
    const typing = name ? o.types?.[name] : null;
    if (typing) {
      await page.waitForFunction(() => document.activeElement?.matches?.('input, textarea') || document.querySelector('input:not([type="hidden"])'), { timeout: 10_000 });
      await page.evaluate(() => {
        if (document.activeElement?.matches?.('input, textarea')) return;
        [...document.querySelectorAll('input:not([type="hidden"]), textarea')].find((el) => el.getClientRects().length)?.focus();
      });
      await page.keyboard.type(typing, { delay: 20 });
      await new Promise((r) => setTimeout(r, 400));
    }
    // --scroll：滚到某处（再按 --scroll-back 往回带一下），两步之间隔两帧，页面的滚动处理（顶栏、底栏）都看得到
    const scrollTo = name ? o.scrolls?.[name] : null;
    if (scrollTo) {
      const twoFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const at = await page.evaluate((where) => {
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (where === 'bottom') return { y: max, max };
        if (/^\d+$/.test(where)) return { y: Math.min(max, Number(where)), max };
        const el = document.querySelector(where);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const bar = document.querySelector('[data-testid="shell-tabbar"]')?.getBoundingClientRect();
        const anchor = bar && bar.height ? (bar.top + bar.bottom) / 2 : window.innerHeight;
        return { y: Math.max(0, Math.min(max, Math.round(window.scrollY + (r.top + r.bottom) / 2 - anchor))), max };
      }, scrollTo);
      if (!at) problems.push(`--scroll 的选择器没找到元素：${scrollTo}`);
      else {
        // 往回带：先滚过头一点（到底了就停在底），再往上回 scrollBack
        const first = Math.min(at.max, at.y + (o.scrollBack || 0));
        await page.evaluate((v) => window.scrollTo(0, v), first);
        await twoFrames();
        if (o.scrollBack) {
          await page.evaluate((v) => window.scrollTo(0, v), Math.max(0, first - o.scrollBack));
          await twoFrames();
        }
      }
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pending = await waitIdle();
    if (pending) problems.push(`网络 15 秒没有安静下来（照样截了），还在等：${pending.map((u) => u.replace(origin, '')).join('、').slice(0, 300)}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
      { timeout: 8_000 },
    ).catch(() => problems.push('有动画 8 秒还没播完（照样截了）'));
    if (o.wait) await new Promise((r) => setTimeout(r, o.wait));
    let files;
    if (o.full) files = await fullPageShots(page, file);
    else {
      await page.screenshot({ path: file, captureBeyondViewport: false });
      files = [file];
    }
    return { files, problems, external };
  } finally {
    await context.close().catch(() => {});
  }
}

/** 拼图总览：每个页面一行，各宽度 × 主题并排，下面写标注 */
async function makeSheet(browser, results, o) {
  const rows = new Map();
  for (const r of results) {
    if (!rows.has(r.name)) rows.set(r.name, []);
    rows.get(r.name).push(r);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cell = (r) => {
    const img = readFileSync(r.files[0]).toString('base64');
    const css = o.full ? `width:${r.viewport.width < 768 ? 300 : 640}px` : `height:${r.viewport.width < 768 ? 640 : 480}px`;
    const more = r.files.length > 1 ? `（整页共 ${r.files.length} 段，这里是第 1 段）` : '';
    return `<figure><img src="data:image/png;base64,${img}" style="${css}"><figcaption>${esc(r.viewport.label)} · ${THEME_LABEL[r.theme]}${more}</figcaption></figure>`;
  };
  const body = [...rows.entries()].map(([name, list]) => `<section><h2>${esc(name)} <small>${esc(list[0].hash)}</small></h2><div class="row">${list.map(cell).join('')}</div></section>`).join('');
  const meta = [o.real ? '真实数据预览（只能放在仓库外）' : o.demo ? '演示数据' : '非演示', o.now ? `现在 = ${o.now}` : null, o.full ? '整页' : '一屏', `${o.scale}x`].filter(Boolean).join(' · ');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#e9e9ee;font:14px/1.4 -apple-system,"PingFang SC",sans-serif;color:#1c1c1e}
    h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:#5a5a60}
    section{margin:0 0 28px}h2{font-size:16px;margin:0 0 10px}h2 small{font-weight:400;color:#5a5a60;margin-left:8px}
    .row{display:flex;gap:16px;align-items:flex-start;flex-wrap:nowrap}
    figure{margin:0;display:flex;flex-direction:column;gap:6px}
    img{display:block;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.12),0 6px 20px rgba(0,0,0,.10);background:#fff}
    figcaption{font-size:12px;color:#3a3a3f;text-align:center}
  </style><h1>热爱生活7885 截图总览</h1><p>${esc(meta)}</p>${body}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    const width = await page.evaluate(() => Math.ceil(document.documentElement.scrollWidth));
    await page.setViewport({ width: Math.max(800, width), height: 600, deviceScaleFactor: 1 });
    const file = path.join(o.outDir, 'sheet.png');
    return await fullPageShots(page, file);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) {
    console.log(HELP);
    return 0;
  }
  const cleanups = [];
  const cleanup = async () => {
    while (cleanups.length) await cleanups.pop()().catch(() => {});
  };
  const onSignal = () => cleanup().finally(() => process.exit(130));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    let base = o.base;
    if (o.dist) {
      const dist = path.resolve(o.dist);
      if (!existsSync(path.join(dist, OUTPUTS.html))) throw new Error(`${dist} 里没有构建产物（${OUTPUTS.html}），先 npm run build（或 RS_OUT_DIR=… npm run build）`);
      const server = await startStaticServer({ root: dist });
      cleanups.push(() => server.close());
      base = server.url;
      console.log(`静态服务器：${base}（${dist}）`);
    } else if (!base) {
      console.log(`起临时开发服务器${o.real ? '（--real，真实数据只在内存里）' : ''}……`);
      const dev = await startDevServer({ real: o.real });
      cleanups.push(() => dev.close());
      base = dev.url;
      console.log(`开发服务器：${base}`);
    }
    const origin = new URL(base).origin;
    if (o.real) {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname)) throw new Error('--real 只能对本机（localhost）的开发服务器用');
      // 先问一下开发服务器有没有开真实数据预览（--base 指到没开 --real 的服务器时，早点说清楚）
      const res = await fetch(new URL('/__dev/real-db.json', origin), { method: 'GET' }).catch(() => null);
      if (!res || !res.ok) {
        let reason = res ? `HTTP ${res.status}` : '连不上';
        try { reason = (await res.json()).error || reason; } catch { /* 不是 JSON */ }
        throw new Error(`开发服务器没有提供真实数据（${reason}）。去掉 --base 让工具自己起，或者用 npm run dev -- --real 启动`);
      }
      await res.arrayBuffer(); // 内容只在内存里过一下，不落盘
    }

    const browser = await launchChrome();
    cleanups.push(() => browser.close());
    mkdirSync(o.outDir, { recursive: true }); // 服务器、浏览器都准备好了才建目录（前面出错不留空目录）
    const results = [];
    for (const route of o.routeList) {
      for (const viewport of o.viewports) {
        for (const theme of o.themeList) {
          const url = targetUrl(base, route.hash, o);
          const file = path.join(o.outDir, `${route.name}-${viewport.label}-${theme}.png`);
          let r;
          try {
            r = await shootOne(browser, { url, origin, viewport, theme, o, file, name: route.name });
          } catch (error) {
            // 一张失败不影响其他的：记下原因，最后退出码 1
            r = { files: [], problems: [`没截成：${error.message}`], external: [], failed: true };
          }
          results.push({ ...route, viewport, theme, ...r });
          if (r.failed) {
            console.log(`  ✗ ${route.name}-${viewport.label}-${theme}：${r.problems[0].split('\n')[0]}`);
            continue;
          }
          const note = [r.problems.length ? `${r.problems.length} 个问题` : null, r.external.length ? `拦下 ${r.external.length} 个外网请求` : null].filter(Boolean).join('，');
          console.log(`  ${path.basename(r.files[0])}${r.files.length > 1 ? ` 等 ${r.files.length} 段` : ''}${note ? `  ⚠️ ${note}` : ''}`);
        }
      }
    }
    if (o.sheet && results.some((r) => r.files.length)) {
      const sheet = await makeSheet(browser, results.filter((r) => r.files.length), o);
      console.log(`拼图总览：${sheet.join('、')}`);
    }
    const issues = results.filter((r) => r.problems.length || r.external.length);
    if (issues.length) {
      console.log('\n需要留意：');
      for (const r of issues) {
        for (const p of [...new Set(r.problems)]) console.log(`  ${r.name}-${r.viewport.label}-${r.theme}：${p.slice(0, 300)}`);
        for (const u of [...new Set(r.external)]) console.log(`  ${r.name}-${r.viewport.label}-${r.theme}：拦下外网请求 ${u.slice(0, 160)}`);
      }
    }
    writeFileSync(path.join(o.outDir, 'shots.json'), `${JSON.stringify(results.map((r) => ({
      name: r.name, hash: r.hash, width: r.viewport.width, height: r.viewport.height, theme: r.theme,
      files: r.files.map((f) => path.basename(f)), problems: r.problems, external: r.external,
    })), null, 2)}\n`);
    const failed = results.filter((r) => r.failed).length;
    console.log(`\n共 ${results.length - failed} 张${failed ? `，${failed} 张没截成` : ''}，在 ${o.outDir}`);
    return failed ? 1 : 0;
  } finally {
    await cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`截图失败：${error.message}`);
    process.exit(1);
  });
}
