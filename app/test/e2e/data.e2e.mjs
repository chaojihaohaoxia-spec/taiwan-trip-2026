// 数据层（#/dev/data，演示模式）在真实浏览器里：加载、离线写入后联网重放、刷新后还在（IndexedDB）、
// 软删除 + 撤销、模拟对方改动的实时推送、照片压缩上传和预览、退出前确认未同步、密码登录、拨时间看“今天”。
// 每个用例都断言没有控制台报错、没有外网请求；手机 390×844 和桌面 1280×800 各截图。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HASH = '#/dev/data?trip=demo-island';
/** 演示数据库（行数从这里算，演示数据加厚、改动后断言不用跟着改数字） */
const DEMO_DB = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));
const islandRows = (table) => DEMO_DB.tables[table].filter((r) => r.trip_id === 'demo-island').length;

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

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const count = (page, table) => page.$eval(`[data-testid="ov-counts"] [data-table="${table}"] .dd-stat__n`, (el) => Number(el.textContent));
const syncState = (page) => page.$eval('[data-testid="sync-pill"]', (el) => el.dataset.state);

async function ready(app) {
  await app.page.waitForFunction(() => document.querySelector('[data-testid="ov-status"] [data-state="ready"]'), { timeout: 10000 });
  await app.page.waitForFunction(() => document.querySelector('[data-testid="ov-realtime"]')?.dataset.state === 'live', { timeout: 10000 });
  await app.idle();
}

test('数据层展示页（手机）：三趟演示行程、数据包各表行数、预算和记账、无横向滚动、触控区 ≥44px、截图', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    assert.equal(await text(page, '[data-testid="data-user"]'), 'Jeremy');
    assert.ok(await page.$('[data-testid="trip-chip-demo-island"]'));
    assert.ok(await page.$('[data-testid="trip-chip-demo-cities"]'));
    assert.ok(await page.$('[data-testid="trip-chip-demo-empty"]'), '几乎空的演示行程（给空状态用）');
    assert.equal(await count(page, 'days'), 4);
    assert.equal(await count(page, 'items'), islandRows('items'));
    assert.ok(islandRows('items') >= 40, '海岛行程的条目已经加厚');
    assert.equal(await syncState(page), 'synced');
    assert.match(await text(page, '[data-testid="budget-total"]'), /HK\$/);
    assert.match(await text(page, '[data-testid="day-route"]'), /1\. .+ → 2\./);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('data');
    // 切到已结束的三城行程：记账有新台币的结算建议
    await page.click('[data-testid="trip-chip-demo-cities"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="ov-title"]')?.textContent.includes('三城'));
    await page.waitForSelector('[data-testid="ledger-TWD"]');
    assert.match(await text(page, '[data-testid="ledger-TWD"]'), /结算建议/);
    await app.idle();
    await assertNoHorizontalOverflow(page);
    await app.shot('data-cities');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('数据层展示页（桌面 1280×800）：截图', async () => {
  const app = await openApp({ browser, server, hash: HASH, device: 'desktop' });
  try {
    await ready(app);
    await assertNoHorizontalOverflow(app.page);
    await app.shot('data', { fullPage: false });
    await app.shot('data-full');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('离线写入：断网时记一笔照常显示、状态“离线”；联网后自动重放；刷新页面后还在（IndexedDB）', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    const before = await count(page, 'expenses');
    await page.click('[data-testid="net-offline"]');
    await page.type('[data-testid="exp-amount"]', '150000');
    await page.type('[data-testid="exp-desc"]', '离线打车');
    await page.click('[data-testid="exp-add"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-pill"]')?.dataset.state === 'offline');
    assert.match(await text(page, '[data-testid="sync-pill"]'), /离线 · 1 条改动联网后自动同步/);
    assert.equal(await count(page, 'expenses'), before + 1, '乐观显示');
    assert.ok(await page.$('[data-testid="outbox-list"]'), '写队列里有一条');
    await app.shot('data-offline', { fullPage: false });
    await page.click('[data-testid="net-online"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-pill"]')?.dataset.state === 'synced', { timeout: 10000 });
    await page.waitForSelector('[data-testid="outbox-empty"]');
    // 刷新页面：演示后台和缓存都在 IndexedDB 里
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await ready(app);
    assert.equal(await count(page, 'expenses'), before + 1, '刷新后还在');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('软删除 + 撤销；撤销窗口里的删除；模拟对方修改通过实时推送出现', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    const firstTitle = await page.$eval('[data-testid="day-items"] .dd-item__title', (el) => el.textContent);
    await page.click('[data-testid="item-delete"]');
    await page.waitForSelector('[data-testid="undo-bar"]');
    assert.notEqual(await page.$eval('[data-testid="day-items"] .dd-item__title', (el) => el.textContent), firstTitle, '马上从列表消失');
    await page.click('[data-testid="undo"]');
    await page.waitForFunction((t) => document.querySelector('[data-testid="day-items"] .dd-item__title')?.textContent === t, {}, firstTitle);
    // 等撤销条收起、页面安定再点下一个按钮：标题先恢复、撤销条随后才消失（整页往上移一截），
    // 机器忙的时候（几套 e2e 同时跑）按钮位置刚量完就变了，点击会落空
    await page.waitForFunction(() => !document.querySelector('[data-testid="undo-bar"]'));
    await app.idle();
    // 清单项删除：5 秒撤销窗口
    const todos = await count(page, 'todos');
    await page.click('[data-testid="todo-delete"]');
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid="ov-counts"] [data-table="todos"] .dd-stat__n').textContent) === n - 1, {}, todos);
    await page.click('[data-testid="undo"]');
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid="ov-counts"] [data-table="todos"] .dd-stat__n').textContent) === n, {}, todos);
    // 对方改了第一条：实时推送
    await page.click('[data-testid="remote-edit"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="day-items"] .dd-item__title')?.textContent.endsWith('（对方改过）'), { timeout: 5000 });
    await page.click('[data-testid="remote-expense"]');
    await page.waitForFunction(() => /HK\$386 · 3 笔/.test(document.querySelector('[data-testid="ledger-HKD"]')?.textContent || ''), { timeout: 5000 });
    await app.idle();
    await app.shot('data-realtime', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('照片上传：浏览器里压缩成长边 2048 的 JPEG、显示预览、进写队列后传完', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    const input = await page.$('[data-testid="file-input"]');
    await input.uploadFile(path.join(APP, 'demo', 'photos', 'demo-photo-01.jpg'));
    await page.waitForSelector('[data-testid="file-result"]', { timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="file-preview"]');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 10000 });
    assert.match(await text(page, '[data-testid="file-result"]'), /demo-island\/[0-9a-f-]{36}\/journal\/[0-9a-f-]{36}\.jpg/);
    // 演示照片 1200×900、没有 EXIF、已经很小：直接用原图（不重新编码反而变大）
    assert.match(await text(page, '[data-testid="file-compress"]'), /原图已经够小.*1200×900/);
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-pill"]')?.dataset.state === 'synced', { timeout: 10000 });
    await page.$eval('[data-testid="data-files"]', (el) => el.scrollIntoView());
    await app.idle();
    await app.shot('data-upload', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('退出前确认未同步数据；放弃后退出；用演示账号密码登录成 Cathy', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    await page.click('[data-testid="net-offline"]');
    await page.type('[data-testid="exp-amount"]', '88');
    await page.click('[data-testid="exp-add"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-pill"]')?.dataset.state === 'offline');
    await page.click('[data-testid="signout"]');
    await page.waitForSelector('[data-testid="signout-confirm"]', { timeout: 8000 });
    assert.match(await text(page, '[data-testid="signout-confirm"]'), /还有 1 条改动没同步/);
    await app.shot('data-signout-confirm', { fullPage: false });
    await page.click('[data-testid="signout-discard"]');
    await page.waitForSelector('[data-testid="data-login"]');
    await page.click('[data-testid="net-online"]').catch(() => {});
    await page.evaluate(() => { document.querySelector('[data-testid="login-password"]').value = ''; });
    await page.type('[data-testid="login-password"]', 'demo1234');
    await page.click('[data-testid="login-submit"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="data-user"]')?.textContent === 'Cathy', { timeout: 8000 });
    await ready(app);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('把“现在”拨到行程第 1 天：显示第几天、进行中 / 下一项（按行程时区）', async () => {
  const app = await openApp({ browser, server, hash: HASH });
  try {
    const { page } = app;
    await ready(app);
    assert.match(await text(page, '[data-testid="time-countdown"]'), /还有 \d+ 天出发/);
    await page.click('[data-testid="time-day-1"]');
    await page.waitForSelector('[data-testid="time-today"]');
    assert.match(await text(page, '[data-testid="time-today"]'), /第 1 天/);
    assert.match(await text(page, '[data-testid="time-countdown"]'), /第 1 天 · 共 4 天/);
    assert.match(await text(page, '[data-testid="time-now"]'), /2027-01-10 11:00/);
    await page.click('[data-testid="time-real"]');
    await page.waitForFunction(() => /还有 \d+ 天出发/.test(document.querySelector('[data-testid="time-countdown"]').textContent));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('深色模式也正常（截图）', async () => {
  const app = await openApp({ browser, server, hash: HASH, colorScheme: 'dark' });
  try {
    await ready(app);
    await app.shot('data-dark', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});
