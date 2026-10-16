// 冒烟测试：打开首页，没有报错、不连外网、不横向滚动、触控区够大；手机浅色 / 深色、桌面各截一张。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, assertNoHorizontalOverflow, assertTapTargets } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

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

test('首页（演示模式、手机、浅色）：行程列表（外壳的大标题「全部行程」）', async () => {
  const app = await openApp({ browser, server });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="shell-head"] h1');
    assert.equal(await page.$eval('[data-testid="shell-head"] h1', (el) => el.textContent), '全部行程');
    assert.equal(await page.title(), '全部行程 · 热爱生活7885');
    assert.match(await page.$eval('meta[name="app-version"]', (m) => m.content), /^2\.0\.0\+[0-9a-f]{10}$/);
    // 演示模式直接进（数据层自带已登录的演示账号），行程列表来自数据层：三趟演示行程（海岛、三城、几乎空的）
    await page.waitForSelector('[data-testid="trip-demo-island"]');
    const trips = await page.$$eval('[data-testid^="trip-demo-"]', (els) => els.map((e) => e.textContent));
    assert.equal(trips.length, 3);
    assert.match(trips[0], /椰影岛/, '按 trips.sort 排序：海岛在前');
    assert.match(await page.$eval('[data-testid="account-name"]', (el) => el.textContent), /Jeremy/);
    assert.ok(await page.waitForSelector('.demo-badge', { timeout: 5000 }), '演示模式角标（按需加载的小分包）');
    // 背景色来自设计变量：底色在 <html> 上（--color-canvas，米白的纸），body 透明（纸和纸纹铺在它下面才露得出来）
    const bg = await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
    assert.deepEqual(bg, ['rgb(244, 241, 234)', 'rgba(0, 0, 0, 0)']);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('home');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('首页（深色）：深色变量生效，截图', async () => {
  const app = await openApp({ browser, server, colorScheme: 'dark' });
  try {
    const bg = await app.page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    assert.equal(bg, 'rgb(20, 20, 19)', '深墨色的纸');
    const color = await app.page.$eval('h1', (el) => getComputedStyle(el).color);
    assert.equal(color, 'rgb(236, 232, 225)');
    await app.page.waitForSelector('[data-testid="trip-demo-island"]');
    await app.shot('home-dark');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('首页（桌面 1280 宽）：内容居中、有最大宽度', async () => {
  const app = await openApp({ browser, server, device: 'desktop' });
  try {
    // 外壳的大标题区和页面内容同一条内容列（最宽 --content-max 720、居中）
    await app.page.waitForSelector('[data-testid="shell-head"]');
    const box = await app.page.$eval('[data-testid="shell-head"]', (el) => el.getBoundingClientRect().toJSON());
    assert.ok(box.width <= 720 + 1, `内容最大宽度 720，实际 ${box.width}`);
    assert.ok(Math.abs(box.left - (1280 - box.width) / 2) < 2, '水平居中');
    await assertNoHorizontalOverflow(app.page);
    await app.page.waitForSelector('[data-testid="trip-demo-island"]');
    await app.shot('home');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('非演示模式、没登录：被带到登录页（next 记着原来要去的页面），不向任何后台发请求', async () => {
  const app = await openApp({ browser, server, demo: false });
  try {
    const { page } = app;
    await page.waitForFunction(() => window.location.hash.startsWith('#/login'), { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.location.hash), '#/login?next=%23%2Ftrips');
    await page.waitForSelector('[data-testid="login-password-form"]');
    assert.equal(await page.$('.demo-badge'), null);
    assert.equal(await page.$('[data-testid="login-demo-hint"]'), null, '线上不显示演示账号');
    assert.equal(await page.title(), '登录 · 热爱生活7885');
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('login');
    // 没有会话：supabase-js 不发请求，汇率也等登录以后才拿
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('开发页全部能打开：设计变量、基础组件、弹层、路由、第三方库（含 Leaflet 和 supabase-js 模块）、工具、数据层', async () => {
  const app = await openApp({ browser, server, hash: '#/dev' });
  try {
    for (const id of ['tokens', 'primitives', 'overlays', 'router', 'vendors', 'lib', 'data']) {
      await app.go(`#/dev/${id}`);
      await app.page.waitForFunction(() => document.querySelector('.dev-section'));
      await assertNoHorizontalOverflow(app.page);
    }
    // 设计变量页：所有对比度都达标
    await app.go('#/dev/tokens');
    await app.page.waitForSelector('.dev-pass');
    assert.equal(await app.page.$$eval('.dev-fail', (els) => els.length), 0, '设计变量页有对比度不达标的颜色');
    // 第三方库：Leaflet 画出了地图（没有加载瓦片），supabase-js 模块能加载且不发请求
    await app.go('#/dev/vendors');
    await app.page.waitForFunction(() => /已渲染 \d+ 个点/.test(document.querySelector('[data-testid="leaflet-status"]')?.textContent || ''));
    assert.ok(await app.page.$('.leaflet-container .leaflet-interactive'), '地图上有矢量标记');
    await app.page.click('[data-testid="supabase-load"]');
    await app.page.waitForFunction(() => /模块正常/.test(document.querySelector('[data-testid="supabase-status"]').textContent));
    await assertTapTargets(app.page, { exclude: '.leaflet-container' });
    await app.shot('dev-vendors');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('未登记的开发页显示“没有这个开发页”，并能从导航回到别的开发页', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/nope' });
  try {
    const h1 = await app.page.$eval('h1', (el) => el.textContent);
    assert.equal(h1, '没有这个开发页');
    await app.page.click('.dev-nav a[href="#/dev/tokens"]');
    await app.page.waitForFunction(() => document.querySelector('h1')?.textContent === '设计变量');
    app.assertClean();
  } finally {
    await app.close();
  }
});
