// Service Worker 的字体策略（src/sw/sw.js）：用假的 self / caches / fetch 把模板跑起来。
//   - 安装时不预缓存字体（思源宋体切成了几十片，一屏只用几片）；
//   - 第一次用到时缓存优先，存进不带版本号的 rs7885-fonts；第二次不走网络（离线也有）；
//   - 发新版（激活）不删字体缓存，只删掉新版清单里已经没有的旧字体文件；本应用的其他旧缓存照常删。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderServiceWorker } from '../../scripts/build.mjs';

const TEMPLATE = readFileSync(new URL('../../src/sw/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://example.test/app/';

function fakeEnv(precache) {
  const handlers = {};
  const store = new Map(); // 缓存名 → Map(url → 响应)
  const fetched = [];
  const key = (r) => (typeof r === 'string' ? r : r.url).split('?')[0];
  const makeCache = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async addAll(reqs) { for (const r of reqs) m.set(key(r), { ok: true, status: 200, type: 'basic', url: key(r) }); },
      async put(r, res) { m.set(key(r), res); },
      async match(r) { return m.get(key(r)); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
      async delete(r) { return m.delete(key(r)); },
    };
  };
  const caches = {
    async open(name) { return makeCache(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async match(r) {
      for (const name of store.keys()) {
        const hit = store.get(name).get(key(r));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const self = {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
  };
  const fetch = async (r) => {
    fetched.push(key(r));
    return { ok: true, status: 200, type: 'basic', url: key(r), clone() { return this; } };
  };
  class Request { constructor(url, opts = {}) { this.url = url; this.mode = opts.mode || 'cors'; this.method = 'GET'; } }
  class Response { constructor(body, init) { this.body = body; this.status = init?.status; } }
  const code = renderServiceWorker(TEMPLATE, { version: '9.9.9+test', precache });
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Request', 'Response', code)(self, caches, fetch, Request, Response);
  const run = async (type, event = {}) => {
    let waited;
    let responded;
    await handlers[type]({ ...event, waitUntil: (p) => { waited = p; }, respondWith: (p) => { responded = p; } });
    if (waited) await waited;
    return responded ? await responded : undefined;
  };
  const get = (url, mode = 'cors') => ({ request: { url, method: 'GET', mode } });
  return { store, fetched, run, get };
}

const PRECACHE = ['./', 'manifest.webmanifest', 'assets/main-AAAA1111.js', 'assets/app-BBBB2222.css', 'assets/geist-CCCC3333.woff2', 'assets/noto-serif-sc-600-t118a-DDDD4444.woff2'];

test('安装时不预缓存字体，其他文件照常预缓存', async () => {
  const env = fakeEnv(PRECACHE);
  await env.run('install');
  const shell = [...env.store.keys()].find((k) => k.startsWith('rs7885-shell-'));
  const cached = [...env.store.get(shell).keys()];
  assert.ok(cached.includes(`${SCOPE}assets/main-AAAA1111.js`));
  assert.ok(cached.includes(`${SCOPE}assets/app-BBBB2222.css`));
  assert.ok(!cached.some((u) => u.endsWith('.woff2')), `字体不应在安装时下载：${cached.join(', ')}`);
});

test('字体第一次用到时走网络并存进 rs7885-fonts，第二次直接用缓存（缓存优先）', async () => {
  const env = fakeEnv(PRECACHE);
  await env.run('install');
  const url = `${SCOPE}assets/noto-serif-sc-600-t118a-DDDD4444.woff2`;
  const first = await env.run('fetch', env.get(url));
  assert.equal(first.url, url);
  assert.deepEqual(env.fetched, [url]);
  assert.ok(env.store.get('rs7885-fonts').has(url), '存进字体缓存');
  const second = await env.run('fetch', env.get(url));
  assert.equal(second.url, url);
  assert.deepEqual(env.fetched, [url], '第二次没有走网络');
  // 同源 fonts/ 目录下的字体同样处理
  await env.run('fetch', env.get(`${SCOPE}fonts/x.woff2`));
  assert.ok(env.store.get('rs7885-fonts').has(`${SCOPE}fonts/x.woff2`));
});

test('发新版：字体缓存留着（只删新版清单里已经没有的旧字体），旧的本应用缓存照常删', async () => {
  const env = fakeEnv(PRECACHE);
  // 上一版留下的：旧的外壳缓存、字体缓存里一个还在用的、一个已经不用的、一个 fonts/ 下的
  env.store.set('rs7885-shell-1.0.0+old', new Map([['x', {}]]));
  env.store.set('rs7885-fonts', new Map([
    [`${SCOPE}assets/geist-CCCC3333.woff2`, { ok: true }],
    [`${SCOPE}assets/geist-OLDOLD00.woff2`, { ok: true }],
    [`${SCOPE}fonts/keep.woff2`, { ok: true }],
  ]));
  await env.run('install');
  await env.run('activate');
  assert.ok(!env.store.has('rs7885-shell-1.0.0+old'), '旧外壳缓存删掉');
  const fonts = [...env.store.get('rs7885-fonts').keys()];
  assert.deepEqual(fonts.sort(), [`${SCOPE}assets/geist-CCCC3333.woff2`, `${SCOPE}fonts/keep.woff2`].sort());
});
