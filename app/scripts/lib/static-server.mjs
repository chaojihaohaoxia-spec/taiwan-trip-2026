// =====================================================================
// scripts/lib/static-server.mjs：模拟 GitHub Pages 的本地静态服务器（npm run preview、e2e 共用）。
//
// - 把构建输出目录（默认仓库根目录；设了 RS_OUT_DIR 就是那个目录）挂在子路径 /taiwan-trip-2026/ 下
//   （和线上一样），检验产物里没有写死仓库名、
//   相对路径都对；访问 / 会跳到 /taiwan-trip-2026/；
// - 响应头模仿 GitHub Pages：Cache-Control: max-age=600（检验 Service Worker 绕过 HTTP 缓存的逻辑）；
// - 只读，不允许 .. 跳出根目录；不列目录；
// - overrides：测试可以临时替换某个路径的响应（比如换一个新版本的 sw.js，测“有新版本”提示）；
// - stall：测试可以让某个路径的请求一直挂着不回（模拟酒店 Wi-Fi 认证页、漫游弱信号：显示在线、请求不返回）。
// =====================================================================

import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR, PAGES_BASE } from './paths.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * @param {{ root?: string, base?: string, port?: number, host?: string, cacheControl?: string, log?: boolean }} [options]
 * @returns {Promise<{ url: string, origin: string, port: number, close: () => Promise<void>,
 *   override: (pathname: string, body: string|Buffer|null, type?: string) => void, requests: string[] }>}
 */
export function startStaticServer({ root = OUT_DIR, base = PAGES_BASE, port = 0, host = '127.0.0.1', cacheControl = 'max-age=600', log = false } = {}) {
  const overrides = new Map();
  const stalled = new Set();
  const hanging = new Set();
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (log) console.log(`${req.method} ${url.pathname}`);
    if (stalled.has(url.pathname)) {
      hanging.add(res);
      res.on('close', () => hanging.delete(res));
      return; // 不回
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/' || url.pathname === base.slice(0, -1)) {
      res.writeHead(302, { Location: base + url.search }).end();
      return;
    }
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 不在站点路径下');
      return;
    }
    const override = overrides.get(url.pathname);
    if (override) {
      res.writeHead(200, { 'Content-Type': override.type, 'Cache-Control': cacheControl });
      res.end(req.method === 'HEAD' ? undefined : override.body);
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice(base.length));
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const st = statSync(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': cacheControl,
      'Last-Modified': st.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      const origin = `http://${host === '127.0.0.1' ? 'localhost' : host}:${actual}`;
      resolve({
        url: `${origin}${base}`,
        origin,
        port: actual,
        requests,
        override(pathname, body, type = 'text/javascript; charset=utf-8') {
          if (body === null) overrides.delete(pathname);
          else overrides.set(pathname, { body, type });
        },
        /** 让某个路径的请求一直挂着（on = false 恢复，并结束已经挂着的请求） */
        stall(pathname, on = true) {
          if (on) stalled.add(pathname);
          else {
            stalled.delete(pathname);
            for (const r of hanging) r.destroy();
            hanging.clear();
          }
        },
        close: () => new Promise((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
      });
    });
  });
}
