// 路由在真实浏览器里的行为：点链接换页、返回键、滚动恢复、弹层进历史、刷新保持、旧网址兼容、找不到页面。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './lib/harness.mjs';
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

const hash = (page) => page.evaluate(() => window.location.hash);
const h1 = (page) => page.$eval('h1', (el) => el.textContent);
const historyLength = (page) => page.evaluate(() => window.history.length);
/** 等文档标题（路由按 meta.title 写：「账本 · 热爱生活7885」）——页面里的大标题由外壳画（行程 tab 是行程名），用文档标题判断到了哪一页 */
const waitTitle = (page, title) => page.waitForFunction((t) => document.title === `${t} · 热爱生活7885`, { timeout: 8000 }, title);

test('点行程列表里的卡片换页，浏览器返回回到行程列表，标题跟着变；顶栏的返回等同浏览器返回', async () => {
  const app = await openApp({ browser, server });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="trip-demo-island"]');
    await page.click('[data-testid="trip-demo-island"]');
    // 行程概览的文档标题是行程名（「椰影岛 · 冬日海岛 · 热爱生活7885」）
    await page.waitForFunction(() => document.title === '椰影岛 · 冬日海岛 · 热爱生活7885', { timeout: 8000 });
    assert.equal(await hash(page), '#/t/demo-island');
    await page.waitForSelector('[data-testid="page-trip"]');
    // 换页后焦点在主内容区（读屏从新页面开头读）
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
    await page.goBack();
    await waitTitle(page, '全部行程');
    assert.equal(await hash(page), '#/trips');
    // 顶栏的“返回”按钮（外壳）：有历史就等同浏览器返回
    await page.click('[data-testid="shell-settings"]');
    await waitTitle(page, '设置');
    await page.waitForSelector('[data-testid="shell-back"]');
    await page.click('[data-testid="shell-back"]');
    await waitTitle(page, '全部行程');
    assert.equal(await hash(page), '#/trips');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('从分享链接直接打开深层页面，“返回”去上一级而不是离开网站', async () => {
  // 行程里的二级页面（贴士）左上有返回（外壳的顶栏）；没有历史可退时去路由表的上一级（行程概览）
  const app = await openApp({ browser, server, hash: '#/t/demo-island/tips' });
  try {
    const { page } = app;
    const before = await historyLength(page);
    await page.waitForSelector('[data-testid="shell-back"]');
    await page.click('[data-testid="shell-back"]');
    await waitTitle(page, '行程');
    assert.equal(await hash(page), '#/t/demo-island');
    assert.equal(await historyLength(page), before, '用 replace，不增加历史');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('滚动恢复：长列表滚到下面，点进别的页面再返回，回到原来的位置', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/router' });
  try {
    const { page } = app;
    await page.waitForSelector('[data-row="60"]');
    await page.$eval('[data-row="60"]', (el) => el.scrollIntoView({ block: 'center' }));
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 1500, `应当滚下去了（${y}）`);
    await page.click('[data-row="60"] a');
    await waitTitle(page, '当天');
    assert.equal(await page.evaluate(() => window.scrollY), 0, '新页面从顶部开始');
    assert.match(await hash(page), /from=60/);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[data-row="60"]'));
    await page.waitForFunction((target) => Math.abs(window.scrollY - target) <= 2, { timeout: 3000 }, y);
    // 刷新页面也能回到同一位置
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await page.waitForFunction((target) => Math.abs(window.scrollY - target) <= 2, { timeout: 3000 }, y);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('弹层参数：打开写进网址和历史，浏览器返回逐层关闭', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/overlays' });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="open-sheet-a"]');
    const base = await historyLength(page);
    await page.click('[data-testid="open-sheet-a"]');
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays?sheet=demo-a');
    await page.click('[data-testid="open-sheet-b"]');
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays?sheet=demo-a,demo-b:42');
    assert.equal(await historyLength(page), base + 2);
    assert.equal(await page.$$eval('.dev-sheet-card', (els) => els.length), 2);
    await page.goBack();
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays?sheet=demo-a');
    assert.equal(await page.$$eval('.dev-sheet-card', (els) => els.length), 1);
    await page.click('[data-testid="close-sheet"]');
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays');
    assert.equal(await page.$$eval('.dev-sheet-card', (els) => els.length), 0);
    // 弹层开关不换页：页面实例和滚动位置都不动
    assert.equal(await h1(page), '弹层');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('直接打开带弹层的网址：关闭用替换，历史不变；全部关闭', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/overlays?sheet=demo-a,demo-b:42' });
  try {
    const { page } = app;
    await page.waitForSelector('.dev-sheet-card');
    assert.equal(await page.$$eval('.dev-sheet-card', (els) => els.length), 2);
    const before = await historyLength(page);
    await page.click('[data-testid="close-all"]');
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays');
    assert.equal(await historyLength(page), before);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('查询参数切换（setQuery）不增加历史、不换页实例', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/router' });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="toggle-view"]');
    const before = await historyLength(page);
    await page.evaluate(() => { document.querySelector('[data-testid="route-json"]').dataset.marker = 'same-instance'; });
    await page.click('[data-testid="toggle-view"]');
    await page.waitForFunction(() => window.location.hash === '#/dev/router?view=grid');
    assert.equal(await historyLength(page), before);
    assert.equal(await page.$eval('[data-testid="route-json"]', (el) => el.dataset.marker), 'same-instance');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('打开网站（没有 hash，和从主屏启动一样）/ #/：先进启动页 launch，再替换到该去的地方（演示数据：最近要出发的海岛概览）；不留历史；旧快捷方式 ?go= 照旧', async () => {
  // 对照：直接打开 #/trips 时浏览器里有几条历史（新标签页自带的空白页算不算一条，各版本 Chrome 不一样）
  const base = await openApp({ browser, server, hash: '#/trips' });
  const baseline = await historyLength(base.page);
  await base.close();
  // 启动规则（shell/launch.js）：进行中 → 今天；否则最近要出发的 → 概览；……（演示数据里海岛 2027-01 还没出发）
  for (const [label, h, expect] of [['没有 hash', '', '#/t/demo-island'], ['#/', '#/', '#/t/demo-island'], ['#/?go=ledger', '#/?go=ledger', '#/t/demo-island/ledger']]) {
    const app = await openApp({ browser, server, hash: h });
    try {
      const { page } = app;
      await page.waitForFunction((x) => window.location.hash === x, { timeout: 8000 }, expect);
      await page.waitForFunction(() => document.querySelector('h1'));
      assert.equal(await page.evaluate(() => window.history.state?.__rs?.idx), 0, `${label}：启动页被替换掉了（还是本应用的第 0 条）`);
      assert.equal(await historyLength(page), baseline, `${label}：和直接打开 #/trips 一样多的历史，返回键不会回到启动页`);
      assert.equal(await page.$('[data-testid="launch-page"]'), null, `${label}：启动页已经离开`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('旧版网址兼容：?invite=码 → 加入行程页；?shortcut=today|expenses → 首页带 go= → 跳到当前行程的今天 / 账本', async () => {
  const a = await openApp({ browser, server, hash: '', search: { invite: '38S7-72Q9-FTCZ' } });
  try {
    assert.equal(await hash(a.page), '#/join/38S7-72Q9-FTCZ');
    assert.equal(await h1(a.page), '加入行程');
    assert.doesNotMatch(await a.page.evaluate(() => window.location.search), /invite/);
    a.assertClean();
  } finally {
    await a.close();
  }
  // 行程还没开始：?go=today 去当前行程（最近要出发的海岛）的概览；替换掉 #/trips?go=today 那一条
  const b = await openApp({ browser, server, hash: '', search: { shortcut: 'today' } });
  try {
    await b.page.waitForFunction(() => window.location.hash === '#/t/demo-island', { timeout: 8000 });
    // 行程概览的文档标题是行程名
    await b.page.waitForFunction(() => document.title.startsWith('椰影岛'), { timeout: 8000 });
    assert.equal(await b.page.evaluate(() => window.history.state?.__rs?.idx), 0, '中间那条 #/trips?go=today 被替换掉了（还是本应用的第 0 条）');
    b.assertClean();
  } finally {
    await b.close();
  }
  // 行程进行中（把“现在”拨到海岛第 2 天）：?go=today 直接到今天；?shortcut=expenses → 账本
  const c = await openApp({ browser, server, hash: '', search: { shortcut: 'today' }, now: '2027-01-11T10:00:00+07:00' });
  try {
    await c.page.waitForFunction(() => window.location.hash === '#/t/demo-island/day/2027-01-11', { timeout: 8000 });
    c.assertClean();
  } finally {
    await c.close();
  }
  const d = await openApp({ browser, server, hash: '', search: { shortcut: 'expenses' } });
  try {
    await d.page.waitForFunction(() => window.location.hash === '#/t/demo-island/ledger', { timeout: 8000 });
    await waitTitle(d.page, '账本');
    d.assertClean();
  } finally {
    await d.close();
  }
});

test('找不到的页面：显示“找不到这个页面”，按钮回到首页', async () => {
  const app = await openApp({ browser, server, hash: '#/no/such/page' });
  try {
    const { page } = app;
    assert.equal(await h1(page), '找不到这个页面');
    assert.equal(await page.title(), '找不到页面 · 热爱生活7885');
    await page.click('.shell-error a');
    await waitTitle(page, '全部行程');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('手动改地址栏的 hash 也能正确换页', async () => {
  const app = await openApp({ browser, server });
  try {
    await app.go('#/t/demo-cities/day/2026-03-15');
    await waitTitle(app.page, '当天');
    await app.page.waitForSelector('[data-testid="page-day"]');
    await app.page.waitForFunction(() => /3月15日/.test(document.querySelector('[data-testid="page-day"]')?.textContent || ''), { timeout: 8000 });
    await app.page.goBack();
    await waitTitle(app.page, '全部行程');
    app.assertClean();
  } finally {
    await app.close();
  }
});
