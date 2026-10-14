#!/usr/bin/env node
// =====================================================================
// scripts/dev.mjs：本地开发服务器（npm run dev）。
//
//   http://localhost:5173/                 正常模式
//   http://localhost:5173/?demo=1#/trips   演示模式（虚构数据，不连后台）
//   http://localhost:5173/#/dev            开发工具页
//
// - 改 JS/JSX/CSS 自动重新打包：CSS 变化热替换样式表（不刷新、不丢状态），其他变化整页刷新；
// - 打包出错时页面上出现红色错误条，修好自动消失；
// - 改 demo/source/*.json 自动重新生成演示数据库；
// - 不注册 Service Worker（还会注销以前装过的），开发时永远拿到最新代码；
// - 默认只监听本机 127.0.0.1；加 --host 监听局域网（手机真机调试；注意演示模式只认 localhost）；
// - 加 --real（npm run dev -- --real）：本机真实数据预览。启动时从仓库外读真实行程 JSON，在内存里展开成
//   演示数据库，只经 /__dev/real-db.json 给本机提供；打开 http://localhost:<端口>/?demo=1&real=1#/trips 看。
//   真实 JSON 改了会重新生成、开着的预览页自动刷新。详见 scripts/lib/real-preview.mjs。
// 产物只在内存里，不会写仓库根目录。
// =====================================================================

import http from 'node:http';
import { readFileSync, existsSync, watch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_DIR, STATIC_DIR, DEMO_DIR, SRC_DIR, DEV_PORT, REPO_ROOT } from './lib/paths.mjs';
import { esbuild, jsOptions, buildCss, analyzeJs, collectedCss } from './lib/bundle.mjs';
import { renderHtml, renderManifest } from './lib/html.mjs';
import { MIME } from './lib/static-server.mjs';
import { ensureDemoDb } from './demo.mjs';
import { tokensInSync } from './tokens.mjs';
import { REAL_DB_PATH, buildRealDb, handleRealDbRequest, realDataDir } from './lib/real-preview.mjs';

const HOST = process.argv.includes('--host') ? '0.0.0.0' : '127.0.0.1';
/** 本机真实数据预览：只在内存里（见 scripts/lib/real-preview.mjs） */
const REAL = process.argv.includes('--real');
const real = { enabled: REAL, text: null, error: null, files: [] };
const outdir = path.join(APP_DIR, '.dev-out', 'assets'); // 只用来算相对路径，不写盘

/** 内存里的产物：'/assets/xxx' → { body, type } */
let files = new Map();
let html = '';
let lastError = null;
let buildCount = 0;
const clients = new Set();

const LIVERELOAD_JS = `// 开发服务器的自动刷新客户端（只在 npm run dev 时注入）
const es = new EventSource('/__dev/events');
let bar = null;
function showError(text) {
  if (!bar) {
    bar = document.createElement('pre');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:12px 14px;max-height:45vh;overflow:auto;border-radius:12px;background:var(--color-danger);color:var(--color-on-danger);font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;box-shadow:var(--shadow-4)';
    document.body.appendChild(bar);
  }
  bar.textContent = '打包出错（修好后自动刷新）\\n\\n' + text;
}
es.addEventListener('reload', () => location.reload());
es.addEventListener('css', (e) => {
  // 样式热替换：首屏样式表（app-*.css）和开发页样式表（dev-*.css，开着开发页时才在页面上）各换各的
  const { href, devHref } = JSON.parse(e.data);
  const swap = (link, next) => {
    if (!link || !next || link.getAttribute('href') === next) return;
    const fresh = link.cloneNode();
    fresh.href = next;
    fresh.onload = () => link.remove();
    link.after(fresh);
  };
  const app = document.querySelector('link[rel="stylesheet"][href*="assets/app-"]');
  if (!app) return location.reload();
  swap(app, href);
  const meta = document.querySelector('meta[name="rs7885-dev-css"]');
  if (meta && devHref) meta.content = devHref;
  swap(document.querySelector('link[data-dev-css]'), devHref);
});
es.addEventListener('build-error', (e) => showError(JSON.parse(e.data).message));
// 真实行程 JSON 改了：正在看真实数据预览（?real=1）的页面刷新
es.addEventListener('real-db', () => { if (new URLSearchParams(location.search).get('real') === '1') location.reload(); });
es.addEventListener('build-ok', () => { bar?.remove(); bar = null; });
`;

const SW_KILL = `// 开发服务器不用 Service Worker：如果以前在这个地址装过，自己注销
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
`;

function send(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function formatErrors(error) {
  const list = error?.errors?.length ? error.errors : [{ text: String(error?.message || error) }];
  return list.map((e) => (e.location ? `${e.location.file}:${e.location.line}:${e.location.column}  ${e.text}\n    ${e.location.lineText}` : e.text)).join('\n\n');
}

async function afterJsBuild(result) {
  const prevCss = [...files.keys()].filter((k) => /^\/assets\/(app|dev)-.*\.css$/.test(k)).sort().join('|');
  const css = await buildCss({ dev: true, outdir, files: collectedCss(result.metafile) });
  const analysis = analyzeJs(result.metafile, outdir);
  const next = new Map();
  for (const f of [...result.outputFiles, ...css.files]) {
    const rel = `/assets/${path.relative(outdir, f.path).split(path.sep).join('/')}`;
    next.set(rel, { body: Buffer.from(f.contents), type: MIME[path.extname(rel)] || 'application/octet-stream' });
  }
  const cssHref = `assets/${css.cssName}`;
  const devCssHref = css.devCssName ? `assets/${css.devCssName}` : null;
  const jsChanged = [...next.keys()].some((k) => k.endsWith('.js') && (!files.has(k) || !files.get(k).body.equals(next.get(k).body)))
    || [...files.keys()].some((k) => k.endsWith('.js') && !next.has(k));
  files = next;
  html = renderHtml({
    cssHref,
    devCssHref,
    jsHref: `assets/${analysis.entry}`,
    preload: analysis.preload.map((p) => `assets/${p}`),
    version: 'dev',
    dev: true,
    extraScripts: ['__dev/livereload.js'],
  });
  buildCount += 1;
  const hadError = lastError;
  lastError = null;
  if (buildCount === 1) return;
  if (hadError) send('build-ok');
  const nextCss = [...files.keys()].filter((k) => /^\/assets\/(app|dev)-.*\.css$/.test(k)).sort().join('|');
  if (jsChanged) send('reload');
  else if (nextCss !== prevCss) send('css', { href: cssHref, devHref: devCssHref });
}

let firstBuildDone;
const firstBuild = new Promise((resolve) => {
  firstBuildDone = resolve;
});

const devPlugin = {
  name: 'dev-reload',
  setup(build) {
    build.onEnd(async (result) => {
      const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (result.errors.length) {
        lastError = { message: formatErrors({ errors: result.errors }) };
        console.error(`\n[${stamp}] 打包出错\n${lastError.message}\n`);
        send('build-error', lastError);
      } else {
        try {
          await afterJsBuild(result);
          if (buildCount > 1) console.log(`[${stamp}] 已重新打包`);
        } catch (error) {
          lastError = { message: formatErrors(error) };
          console.error(`\n[${stamp}] CSS 打包出错\n${lastError.message}\n`);
          send('build-error', lastError);
        }
      }
      firstBuildDone();
    });
  },
};

function serve(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (p === '/__dev/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    if (lastError) res.write(`event: build-error\ndata: ${JSON.stringify(lastError)}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === REAL_DB_PATH) {
    handleRealDbRequest(req, res, { enabled: real.enabled, getText: () => real.text, error: () => real.error });
    return;
  }
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.html'] }).end(html);
    return;
  }
  if (p === '/__dev/livereload.js') {
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'] }).end(LIVERELOAD_JS);
    return;
  }
  if (p === '/sw.js') {
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'] }).end(SW_KILL);
    return;
  }
  if (p === '/manifest.webmanifest') {
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.webmanifest'] }).end(renderManifest());
    return;
  }
  if (files.has(p)) {
    const f = files.get(p);
    res.writeHead(200, { ...headers, 'Content-Type': f.type }).end(f.body);
    return;
  }
  if (p.startsWith('/icons/')) {
    const file = path.join(STATIC_DIR, 'icons', path.basename(p));
    if (existsSync(file)) {
      res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
      return;
    }
  }
  res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

/** 读真实行程 JSON、在内存里生成演示数据库（失败时保留上一次成功的结果，并记下原因给网页看） */
function loadReal() {
  try {
    const out = buildRealDb({ dir: realDataDir() });
    real.text = out.text;
    real.error = null;
    real.files = out.files;
    console.log(`[真实数据] 已在内存里生成：${out.summary}`);
    if (out.missingChars?.length) {
      console.warn(`[字体] 真实行程里有 ${out.missingChars.length} 个字不在思源宋体的子集里（会显示成系统字体）：${out.missingChars.join('')}\n`
        + '       用 --extra-text 重跑 scripts/fonts/build-fonts.py（见 static/fonts/README.md「重新生成」）');
    }
    return true;
  } catch (error) {
    real.error = `真实数据生成失败：${error.message}`;
    console.error(`[真实数据] ${error.message}`);
    return false;
  }
}

function watchReal() {
  let timer = null;
  for (const file of real.files) {
    watch(file, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (loadReal()) send('real-db');
      }, 120);
    });
  }
}

async function main() {
  if (!tokensInSync()) console.warn('提醒：tokens.css 的弹簧曲线和 springs.js 不一致，运行 npm run tokens。');
  ensureDemoDb();
  if (REAL) {
    loadReal();
    watchReal();
  }

  const options = jsOptions({ dev: true, outdir });
  const ctx = await esbuild.context({ ...options, plugins: [...options.plugins, devPlugin] });
  // watch() 会先完整打包一次；第一次就出错也照样起服务，页面上显示错误条
  await ctx.watch();
  await firstBuild;
  if (!html) {
    html = renderHtml({ cssHref: 'assets/app-missing.css', jsHref: 'assets/main-missing.js', version: 'dev', dev: true, extraScripts: ['__dev/livereload.js'] });
  }

  // CSS 里 @import 的文件、以及 esbuild 没登记到的 CSS 变化：再保险监听一次 src/
  let timer = null;
  watch(SRC_DIR, { recursive: true }, (_event, file) => {
    if (!file || !String(file).endsWith('.css')) return;
    clearTimeout(timer);
    timer = setTimeout(() => ctx.rebuild().catch(() => {}), 60);
  });
  // 演示数据源变化 → 重新生成 demo-db.json（esbuild 会接着自动重新打包）
  watch(path.join(DEMO_DIR, 'source'), () => {
    try {
      ensureDemoDb();
    } catch (error) {
      console.error(`[演示数据] ${error.message}`);
    }
  });

  const server = http.createServer(serve);
  let port = DEV_PORT;
  for (; port < DEV_PORT + 30; port++) {
    try {
      await listen(server, port);
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  const local = `http://localhost:${port}/`;
  console.log(`\n热爱生活7885 开发服务器已启动（源码 ${path.relative(REPO_ROOT, SRC_DIR)}）`);
  console.log(`  正常模式  ${local}`);
  console.log(`  演示模式  ${local}?demo=1#/trips`);
  console.log(`  开发工具  ${local}#/dev`);
  if (REAL) console.log(`  真实数据  ${local}?demo=1&real=1#/trips（只在本机；数据只在内存里，不写盘）`);
  if (HOST === '0.0.0.0') {
    const lan = lanAddress();
    if (lan) console.log(`  局域网    http://${lan}:${port}/（手机上看；演示模式需要 localhost，这里不生效${REAL ? '；真实数据接口只回应本机' : ''}）`);
  }
  console.log('改代码会自动重新打包、刷新。按 Ctrl+C 停止。\n');

  const shutdown = async () => {
    for (const res of clients) res.end();
    server.close();
    await ctx.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`开发服务器启动失败：${error.message}`);
  process.exit(1);
});
