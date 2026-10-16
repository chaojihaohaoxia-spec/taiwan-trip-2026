// #/dev/lib：工具与外部服务的展示页（汇率卡、天气卡、地图组件、日期金额格式、复制、Markdown、图片）。
// 一律演示模式 + 假接口：不连任何外网（地图底图的请求被拦下，只用来核对深浅色选的是哪套底图）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, SCREENSHOT_DIR } from './lib/harness.mjs';
import { captureMidAnimation } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { dayRoute } from '../../src/lib/map/geo.js';

// 地图的期望值从演示数据库算（演示数据加厚、改动后不用跟着改数字）：海岛行程的全部地点、第 1 天的路线点
const DEMO_DB = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../demo/demo-db.json'), 'utf8'));
const islandOf = (table) => DEMO_DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const ISLAND_PLACES = islandOf('places');
const ISLAND_D1 = islandOf('days').find((d) => d.date === '2027-01-10');
const D1_ROUTE = dayRoute(islandOf('items').filter((i) => i.day_id === ISLAND_D1.id), new Map(ISLAND_PLACES.map((p) => [p.id, p]))).points;

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

const open = (o = {}) => openApp({ browser, server, hash: '#/dev/lib', ...o });
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const waitText = (page, sel, re, timeout = 5000) => page.waitForFunction(
  (s, src) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), { timeout }, sel, re.source,
);

/** 清空输入框再输入（手机模拟下三击不一定能全选） */
async function fill(page, sel, value) {
  await page.$eval(sel, (el) => {
    el.focus();
    el.select();
  });
  await page.type(sel, value);
}

/** 只截某个区块（整页太长：手机 3 倍屏超过 16384 像素会被浏览器截断） */
async function shotEl(app, selector, name) {
  const dir = path.join(SCREENSHOT_DIR, 'lib');
  mkdirSync(dir, { recursive: true });
  const el = await app.page.$(selector);
  await el.scrollIntoView();
  await app.idle();
  const file = path.join(dir, `${name}${app.device === 'mobile' ? '' : `-${app.device}`}.png`);
  await el.screenshot({ path: file });
  return file;
}

async function ready(app) {
  await app.page.waitForSelector('[data-testid="trip-map"] .tm-marker');
  await app.page.waitForSelector('[data-testid="wx-card"] .lp-wx__day');
  await app.page.waitForSelector('[data-testid="copy-preview"]');
  await waitText(app.page, '[data-testid="copy-preview"]', /抵达/);
  await app.idle();
}

test('手机 390×844（浅色）：整页无报错、不连外网、不横向滚动、触控区 ≥44px；各区块截图', async () => {
  const app = await open();
  try {
    await ready(app);
    assert.equal(await app.page.$eval('h1', (el) => el.textContent), '工具与服务');
    await assertNoHorizontalOverflow(app.page);
    await assertTapTargets(app.page, { exclude: '.leaflet-container' });
    for (const id of ['lib-fx', 'lib-weather', 'lib-map', 'lib-date', 'lib-money', 'lib-copy', 'lib-links', 'lib-md', 'lib-image']) {
      await shotEl(app, `#${id}`, id);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('桌面 1280×800 和手机深色：布局、截图、无报错', async () => {
  const desk = await open({ device: 'desktop' });
  try {
    await ready(desk);
    await assertNoHorizontalOverflow(desk.page);
    await assertTapTargets(desk.page, { exclude: '.leaflet-container' });
    // 桌面：地图和地点列表左右并排
    const [mapBox, listBox] = await desk.page.$$eval(['.lp-map__map', '.lp-places'].join(','), (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    assert.ok(listBox.left >= mapBox.right - 1, '列表在地图右边');
    await desk.shot('lib', { fullPage: true });
    for (const id of ['lib-fx', 'lib-weather', 'lib-map']) await shotEl(desk, `#${id}`, id);
    desk.assertClean();
  } finally {
    await desk.close();
  }
  const dark = await open({ colorScheme: 'dark' });
  try {
    await ready(dark);
    assert.equal(await dark.page.$eval('[data-testid="trip-map"]', (el) => el.dataset.scheme), 'dark');
    for (const id of ['lib-fx', 'lib-weather', 'lib-map']) await shotEl(dark, `#${id}`, `${id}-dark`);
    dark.assertClean();
  } finally {
    await dark.close();
  }
});

test('汇率卡：演示数据 / 接口正常 / 断网有旧缓存 / 断网没缓存；反复渲染不会多请求；金额换算', async () => {
  const app = await open();
  const { page } = app;
  try {
    await ready(app);
    await waitText(page, '[data-testid="fx-status"]', /演示汇率/);
    assert.match(await text(page, '[data-testid="fx-card"]'), /1 港币 ≈ 3,294 越南盾.*1 港币 ≈ 4\.07 新台币.*1 人民币 ≈ 1\.17 港币/);
    // 输入 '450k' 越南盾 → 约 HK$136.60
    assert.equal(await text(page, '[data-testid="fx-converted"] .visually-hidden'), '≈ HK$136.60');
    await fill(page, '[data-testid="fx-amount"]', '1tr2');
    await waitText(page, '[data-testid="fx-converted"] .visually-hidden', /^≈ HK\$364\.26$/);

    await page.click('[data-testid="fx-scenario-ok"]');
    await waitText(page, '[data-testid="fx-status"]', /^汇率 · /);
    assert.equal(await page.$eval('[data-testid="fx-card"]', (el) => el.dataset.tone), 'live');
    assert.match(await text(page, '[data-testid="fx-requests"]'), /网络请求 1 次/);
    await page.click('[data-testid="fx-rerender"]');
    await waitText(page, '[data-testid="fx-requests"]', /已重新渲染 30 次/);
    assert.match(await text(page, '[data-testid="fx-requests"]'), /网络请求 1 次/, '30 次重新渲染 + 30 次 ensure，一次请求都没多');
    // 缓存真的写进了 IndexedDB（开发页“接口正常”情景用的库）
    assert.match(await text(page, '[data-testid="fx-requests"]'), /缓存：IndexedDB/);
    const cachedVnd = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('rs7885-dev-fx');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('fx:HKD:v1');
        get.onsuccess = () => resolve(get.result?.data?.perHKD?.VND ?? null);
        get.onerror = () => reject(get.error);
      };
    }));
    assert.equal(cachedVnd, 3301.25);
    await page.click('[data-testid="fx-refresh"]');
    await waitText(page, '[data-testid="fx-requests"]', /网络请求 2 次/);

    await page.click('[data-testid="fx-scenario-offline-cache"]');
    await waitText(page, '[data-testid="fx-status"]', /离线汇率 · 2 天前更新/);
    assert.equal(await page.$eval('[data-testid="fx-status"]', (el) => el.dataset.tone), 'offline');
    await shotEl(app, '[data-testid="fx-card"]', 'fx-offline-cache');

    await page.click('[data-testid="fx-scenario-offline-none"]');
    await waitText(page, '[data-testid="fx-status"]', /离线汇率 · 内置参考值/);
    assert.match(await text(page, '[data-testid="fx-card"]'), /1 港币 ≈ 3,300 越南盾/, '内置兜底就是用户定的汇率');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('天气卡：超出 16 天显示「出发前一周可看」；出发前 5 天全部有预报（含日出日落、降雨、紫外线）；行程中前一天已过去；断网', async () => {
  const app = await open();
  const { page } = app;
  const statuses = () => page.$$eval('[data-testid="wx-card"] .lp-wx__day', (els) => els.map((e) => e.dataset.status));
  try {
    await ready(app);
    assert.deepEqual(await statuses(), ['too-far', 'too-far', 'too-far', 'too-far']);
    assert.match(await text(page, '[data-testid="wx-too-far"]'), /出发前一周可看：12月26日 起/);

    await page.click('[data-testid="wx-scenario-before5"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="wx-card"] .lp-wx__day')].every((e) => e.dataset.status === 'ok'));
    const day1 = await text(page, '[data-testid="wx-day-2027-01-10"]');
    assert.match(day1, /1月10日 周日/);
    assert.match(day1, /降雨概率 \d+%/);
    assert.match(day1, /UV \d+/);
    assert.match(day1, /0[56]:\d\d.*1[78]:\d\d/, '日出日落');
    assert.match(await text(page, '[data-testid="wx-day-2027-01-13"]'), /仅供参考/, '第 8 天的预报');
    assert.match(await text(page, '[data-testid="wx-status"]'), /演示天气 · 40 分钟前更新/);
    await shotEl(app, '[data-testid="wx-card"]', 'weather-before5');

    await page.click('[data-testid="wx-scenario-before14"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="wx-day-2027-01-12"]')?.dataset.status === 'too-far');
    assert.deepEqual(await statuses(), ['ok', 'ok', 'too-far', 'too-far']);

    await page.click('[data-testid="wx-scenario-day2"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="wx-day-2027-01-10"]')?.dataset.status === 'past');
    assert.match(await text(page, '[data-testid="wx-day-2027-01-11"]'), /今天/);

    await page.click('[data-testid="wx-scenario-offline"]');
    await waitText(page, '[data-testid="wx-status"]', /天气暂时不可用/);
    assert.deepEqual(await statuses(), ['error', 'error', 'error', 'error']);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地图：换天不重建实例、标记原地增删；点列表 → 图钉弹簧放大并平移进视野；点图钉 → 列表高亮', async () => {
  const app = await open({ device: 'desktop' });
  const { page } = app;
  try {
    await ready(app);
    const instance = await page.$eval('[data-testid="trip-map"]', (el) => el.dataset.mapInstance);
    assert.ok(instance);
    assert.equal(await page.$$eval('[data-testid="trip-map"] .tm-marker', (els) => els.length), ISLAND_PLACES.length);
    assert.match(await text(page, '[data-testid="map-meta"]'), new RegExp(`${ISLAND_PLACES.length} 个点`));
    assert.ok(ISLAND_PLACES.length >= 28 && D1_ROUTE.length >= 5, '演示数据的地点和第 1 天路线够多');
    // 全部图钉都在地图可视区域内（取景生效，没有停在默认视野）
    const inside = await page.$eval('[data-testid="trip-map"]', (map) => {
      const box = map.getBoundingClientRect();
      return [...map.querySelectorAll('.tm-pin__body')].every((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      });
    });
    assert.ok(inside, '取景后所有图钉都在可视区域内');

    await page.click('[data-testid="map-day-1"]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="trip-map"] .tm-marker').length === n, {}, D1_ROUTE.length);
    await app.idle();
    assert.equal(await page.$eval('[data-testid="trip-map"]', (el) => el.dataset.mapInstance), instance, '同一个地图实例');
    assert.ok(await page.$('[data-testid="trip-map"] path.tm-route'), '有路线折线');
    assert.ok(await page.$('[data-testid="trip-map"] path.tm-route-casing'), '路线有描边衬底');
    assert.deepEqual(await page.$$eval('[data-testid="trip-map"] .tm-pin__label', (els) => els.map((e) => e.textContent)), D1_ROUTE.map((_, i) => String(i + 1)));

    // 点列表第 3 行：截弹簧半路，再看结束状态
    const row = '[data-testid="map-list"] li:nth-child(3) .lp-place__main';
    const mid = await captureMidAnimation(app, async () => {
      await page.click(row);
      await page.waitForSelector('.tm-pin.is-selected');
    }, {
      progress: 0.4, selector: '.tm-pin', name: 'map-select-40-desktop',
      evaluate: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.tm-pin.is-selected')).transform).a,
    });
    assert.ok(mid.state > 1 && mid.state < 1.3, `半路在放大中：scale=${mid.state}`);
    await app.idle();
    const sel = await page.$eval('.tm-pin.is-selected', (el) => ({
      label: el.querySelector('.tm-pin__label').textContent,
      name: el.querySelector('.tm-pin__name').textContent,
      scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
      nameOpacity: getComputedStyle(el.querySelector('.tm-pin__name')).opacity,
    }));
    assert.equal(sel.label, '3');
    assert.equal(sel.name, D1_ROUTE[2].name);
    assert.ok(Math.abs(sel.scale - 1.18) < 0.01, `选中放大到 1.18：${sel.scale}`);
    assert.equal(sel.nameOpacity, '1');
    assert.equal(await page.$eval('[data-testid="map-list"] li:nth-child(3)', (el) => el.getAttribute('aria-current')), 'true');

    // 点地图上的第 1 号图钉 → 列表第 1 行高亮
    await page.click('[data-testid="trip-map"] .tm-marker[data-marker-id$=":0"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="map-list"] li:nth-child(1)')?.getAttribute('aria-current') === 'true');
    assert.equal(await page.$eval('[data-testid="map-list"] li:nth-child(3)', (el) => el.getAttribute('aria-current')), null);
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-map"] .tm-marker[data-marker-id$=":0"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.$$eval('[data-testid="trip-map"] .tm-pin.is-selected', (els) => els.length), 1, '同时只有一个选中');
    await shotEl(app, '#lib-map', 'map-day1-selected');

    // Google 地图链接：当天路线、每行的打开 / 导航
    const route = await page.$eval('[data-testid="route-link"]', (a) => a.href);
    assert.match(route, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
    const nav = await page.$eval('[data-testid="map-list"] li:nth-child(2) a[aria-label^="导航"]', (a) => a.href);
    assert.match(nav, /destination=8\.68,106\.606&travelmode=driving&dir_action=navigate/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地图手势（桌面）：普通滚轮照常滚页面并提示按住 ⌘/Ctrl；按住 Ctrl 才缩放；拖动后出现「看全部」', async () => {
  const app = await open({ device: 'desktop' });
  const { page } = app;
  try {
    await ready(app);
    const map = await page.$('[data-testid="trip-map"] .tm-map__canvas');
    await map.scrollIntoView();
    await app.idle();
    const box = await map.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const zoom0 = await page.$eval('[data-testid="trip-map"]', (el) => el.querySelector('.leaflet-map-pane').style.transform);
    const scroll0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel({ deltaY: 200 });
    await page.waitForFunction(() => document.querySelector('.tm-map__hint')?.dataset.show === 'true');
    assert.match(await text(page, '.tm-map__hint'), /按住 (⌘|Ctrl) 再滚动/);
    await page.waitForFunction((y) => window.scrollY > y, {}, scroll0);
    const zoomAfterWheel = await page.$eval('[data-testid="trip-map"]', (el) => el.querySelector('.leaflet-map-pane').style.transform);
    assert.equal(zoomAfterWheel, zoom0, '普通滚轮不缩放地图');

    // 拖动地图 → 出现「看全部」，点它回到全部地点
    const box2 = await map.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 120, box2.y + box2.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('.tm-map__fit');
    await page.click('.tm-map__fit');
    await page.waitForFunction(() => !document.querySelector('.tm-map__fit'));

    // 按住 Ctrl 滚轮（等同触控板捏合）：缩放
    const scaleOf = () => page.$eval('[data-testid="trip-map"] .tm-marker:last-child', (el) => el.style.transform);
    const before = await scaleOf();
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -300 });
    await page.keyboard.up('Control');
    await page.waitForFunction((t) => document.querySelector('[data-testid="trip-map"] .tm-marker:last-child')?.style.transform !== t, { timeout: 3000 }, before);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地图手势（手机）：一根手指在地图上划 = 滚页面（地图不动），并提示“用两根手指移动地图”', async () => {
  const app = await open();
  const { page } = app;
  try {
    await ready(app);
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, '模拟的是触屏手机');
    assert.equal(await page.$eval('.tm-map .leaflet-control-zoom', (el) => getComputedStyle(el).display), 'none', '手机上不显示缩放按钮');
    const map = await page.$('[data-testid="trip-map"] .tm-map__canvas');
    await map.scrollIntoView();
    await app.idle();
    const box = await map.boundingBox();
    const pane0 = await page.$eval('[data-testid="trip-map"] .leaflet-map-pane', (el) => el.style.transform);
    const y0 = await page.evaluate(() => window.scrollY);
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.7;
    await page.touchscreen.touchStart(x, y);
    for (let i = 1; i <= 8; i += 1) await page.touchscreen.touchMove(x, y - i * 20);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => document.querySelector('.tm-map__hint')?.dataset.show === 'true');
    assert.equal(await text(page, '.tm-map__hint'), '用两根手指移动地图');
    await page.waitForFunction((v) => window.scrollY > v, { timeout: 3000 }, y0);
    assert.equal(await page.$eval('[data-testid="trip-map"] .leaflet-map-pane', (el) => el.style.transform), pane0, '地图没被拖走');
    assert.equal(await page.$('.tm-map__fit'), null, '没有“看全部”（用户没动地图）');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地图底图：跟着深浅色切换——有 CARTO key 用 light_all / dark_all，没有 key 用 OSM 并在深色时压暗（请求都被拦下，不真的连网）', async () => {
  const blocked = [/ERR_BLOCKED_BY_CLIENT/, /basemaps\.cartocdn\.com|tile\.openstreetmap\.org/];
  for (const scheme of ['light', 'dark']) {
    const other = scheme === 'dark' ? 'light' : 'dark';
    // 1. 有 key（开发页可以用 ?cartoKey= 临时传）：CARTO
    const app = await open({ colorScheme: scheme, search: { cartoKey: 'e2e-test-key' } });
    try {
      await ready(app);
      await app.page.click('[data-testid="map-tiles-toggle"]');
      await app.page.waitForFunction(() => document.querySelector('[data-testid="trip-map"] .tm-tiles img'));
      await new Promise((r) => setTimeout(r, 300));
      const tiles = app.external.filter((u) => u.includes('basemaps.cartocdn.com'));
      assert.ok(tiles.length > 0, '请求了底图');
      assert.ok(tiles.every((u) => u.includes(scheme === 'dark' ? '/dark_all/' : '/light_all/') && u.endsWith('?key=e2e-test-key')), `${scheme}：${tiles[0]}`);
      // 用户强制切换深浅色：底图跟着换
      const n = app.external.length;
      await app.page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), other);
      await app.page.waitForFunction((t) => document.querySelector(`[data-testid="trip-map"] .tm-tiles--${t}`), {}, other);
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(app.external.slice(n).some((u) => u.includes(other === 'dark' ? '/dark_all/' : '/light_all/')));
      assert.deepEqual(app.external.filter((u) => !u.includes('basemaps.cartocdn.com')), [], '除了底图没有别的外网请求');
      app.external.length = 0;
      // 被拦下的底图会在控制台报“Failed to load resource: net::ERR_BLOCKED_BY_CLIENT”，这是测试自己拦的，放过
      app.assertClean({ allowErrors: blocked });
    } finally {
      await app.close();
    }
    // 2. 没有 key（现状）：OSM；深色时底图图层带压暗滤镜，浅色时降饱和
    const osm = await open({ colorScheme: scheme });
    try {
      await ready(osm);
      await osm.page.click('[data-testid="map-tiles-toggle"]');
      await osm.page.waitForFunction(() => document.querySelector('[data-testid="trip-map"] .tm-tiles img'));
      await new Promise((r) => setTimeout(r, 300));
      const tiles = osm.external.filter((u) => u.includes('tile.openstreetmap.org'));
      assert.ok(tiles.length > 0);
      assert.ok(tiles.every((u) => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(u)), tiles[0]);
      const filter = await osm.page.$eval('[data-testid="trip-map"] .tm-tiles', (el) => getComputedStyle(el).filter);
      if (scheme === 'dark') assert.match(filter, /invert\(1\)/);
      else assert.match(filter, /saturate\(0\.3\)/, '浅色底图降饱和（纸本：OSM 原色太花）');
      assert.match(await text(osm.page, '[data-testid="trip-map"] .leaflet-control-attribution'), /© OpenStreetMap/);
      assert.deepEqual(osm.external.filter((u) => !u.includes('tile.openstreetmap.org')), []);
      osm.external.length = 0;
      osm.assertClean({ allowErrors: blocked });
    } finally {
      await osm.close();
    }
  }
});

test('减弱动态效果：选中图钉不缩放、不弹跳（只换样式），页面照常可用', async () => {
  const app = await open({ reducedMotion: true, device: 'desktop' });
  const { page } = app;
  try {
    await ready(app);
    await page.click('[data-testid="map-list"] li:nth-child(2) .lp-place__main');
    await page.waitForSelector('.tm-pin.is-selected');
    await app.idle();
    assert.equal(await page.$eval('.tm-pin.is-selected', (el) => getComputedStyle(el).transform), 'none');
    assert.equal(await page.$eval('.tm-pin.is-selected .tm-pin__name', (el) => getComputedStyle(el).opacity), '1');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('日期与金额：时区切换实时重算；数字滚动按分位滚（截半路）；金额输入解析', async () => {
  const app = await open();
  const { page } = app;
  try {
    await ready(app);
    const rows = await text(page, '[data-testid="date-rows"]');
    assert.match(rows, /2026年12月30日–2027年1月2日/);
    assert.match(rows, /22:00–次日 01:30/);
    assert.match(rows, /00:30 次日/);
    assert.match(rows, /1 天 1 小时/);
    assert.match(rows, /−30 分钟/);
    const vn = await text(page, '#lib-date .lp-card__sub');
    assert.match(vn, /UTC\+7 · 比香港慢 1 小时/);
    await page.click('[data-testid="tz-Asia/Kathmandu"]');
    await waitText(page, '#lib-date .lp-card__sub', /UTC\+5:45 · 比香港慢 2 小时 15 分钟/);
    await page.click('[data-testid="tz-Asia/Taipei"]');
    await waitText(page, '#lib-date .lp-card__sub', /和香港时间相同/);

    const money = await text(page, '[data-testid="money-rows"]');
    assert.match(money, /400,000₫（约 HK\$121）/);
    assert.match(money, /45 万越南盾（约 HK\$136）/);
    assert.match(money, /1235 万越南盾/);
    assert.match(money, /1\.5 亿越南盾/);
    assert.match(money, /−45,000₫（约 −HK\$14）/);
    assert.match(money, /JPY 1,000/);

    // 数字滚动（ui/RollingNumber，分位由 numberSlots 认定）：1,234,000 + 45,000 = 1,279,000：千位和万位滚动，截 40% 处
    await page.$eval('[data-testid="roll-total"]', (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    const mid = await captureMidAnimation(app, () => page.click('[data-testid="roll-add-45000"]'), {
      progress: 0.4, selector: '[data-testid="roll-total"] .roll__char', name: 'roll-40',
      evaluate: () => [...document.querySelectorAll('[data-testid="roll-total"] .roll__slot:not(.roll__slot--sym)')].map((c) => c.dataset.slot),
    });
    // 变了的两位：旧数字滚出去、新数字滚进来，各一条动画
    assert.ok(mid.animations.length >= 4, `两位在滚动（滚出 + 滚进）：${mid.animations.length}`);
    assert.deepEqual(mid.state, ['i6', 'i5', 'i4', 'i3', 'i2', 'i1', 'i0'], '每一位的分位 key');
    await app.idle();
    assert.equal(await text(page, '[data-testid="roll-total"] .visually-hidden'), '1,279,000₫');

    await fill(page, '[data-testid="parse-input"]', '450.000đ');
    await waitText(page, '[data-testid="parse-output"]', /450,000₫ 45 万越南盾（约 HK\$136）/);
    await fill(page, '[data-testid="parse-input"]', '不是金额');
    await waitText(page, '[data-testid="parse-output"]', /认不出这个金额/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('复制当天行程：剪贴板里是真换行；按钮变“已复制”，提示总线发出“已复制当天行程”（外壳的 Toast 显示）', async () => {
  const app = await open();
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await ready(app);
    const preview = await page.$eval('[data-testid="copy-preview"]', (el) => el.textContent);
    assert.match(preview, /^1月10日 周日 · 落地 · 椰影镇\n10:20 抵达椰影岛\n10:45–11:10 接机去酒店/);
    // 备选 / 雨天方案空一行列在后面（挂在条目下的和当天通用的都在）
    assert.match(preview, /\n\n（(备选|雨天)）/);
    assert.match(preview, /\n（雨天）晚上 下雨就在酒店餐厅吃\n/);
    assert.match(preview.split('\n').at(-1), /^（(备选|雨天)）/);
    await page.bringToFront();
    await page.click('[data-testid="copy-day"]');
    await waitText(page, '[data-testid="copy-day"]', /已复制/);
    // lib/notify.js 发出的提示由外壳里的弹层宿主显示成 Toast（成功语气）
    await waitText(page, '[data-overlay-toasts]', /已复制当天行程/);
    assert.equal(await page.$eval('.ov-toast', (el) => el.dataset.tone), 'success');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip, preview);
    assert.ok(clip.includes('\n') && !clip.includes('\\n'), '真换行，不是字面的 \\n');
    assert.match(await text(page, '[data-testid="copy-result"]'), new RegExp(`navigator\\.clipboard · ${preview.split('\n').length} 行`));
    await shotEl(app, '#lib-copy', 'copy-done');
    // 1.6 秒后按钮恢复
    await waitText(page, '[data-testid="copy-day"]', /复制当天行程/, 4000);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('Markdown：渲染段落 / 列表 / 加粗 / 链接；<script> 和 javascript: 链接不生效', async () => {
  const app = await open();
  const { page } = app;
  try {
    await ready(app);
    const out = '[data-testid="md-output"]';
    const info = await page.$eval(out, (el) => ({
      scripts: el.querySelectorAll('script, img, iframe').length,
      strong: el.querySelector('strong')?.textContent,
      lis: el.querySelectorAll('ul li').length,
      ols: el.querySelectorAll('ol li').length,
      links: [...el.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })),
      text: el.textContent,
    }));
    assert.equal(info.scripts, 0, '没有被注入的元素');
    assert.equal(info.strong, '打表');
    assert.equal(info.lis, 4);
    assert.equal(info.ols, 2);
    assert.deepEqual(info.links.map((l) => l.href), ['https://www.grab.com', 'https://example.com/guide_(island)', '#/dev/lib']);
    assert.ok(info.links.filter((l) => l.href.startsWith('https')).every((l) => l.target === '_blank' && l.rel === 'noopener noreferrer'));
    assert.match(info.text, /<script>alert\('注入'\)<\/script>/, '脚本原样显示成文字');
    assert.ok(!info.links.some((l) => /javascript/i.test(l.href)));
    // 现场输入
    await page.$eval('[data-testid="md-input"]', (el) => { el.value = ''; });
    await page.type('[data-testid="md-input"]', '**新的** [坏](javascript:alert(2)) 和 [好](https://example.com)');
    await page.waitForFunction((s) => document.querySelector(s).textContent.startsWith('新的'), {}, out);
    assert.deepEqual(await page.$$eval(`${out} a`, (as) => as.map((a) => a.getAttribute('href'))), ['https://example.com']);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('图片：生成 3000×2000 带 EXIF 的测试照片 → 压缩成 2048 宽的 JPEG，读出拍摄时间和时区；演示照片没有拍摄时间', async () => {
  const app = await open();
  const { page } = app;
  try {
    await ready(app);
    await page.click('[data-testid="img-fixture"]');
    await page.waitForSelector('[data-testid="img-card"][data-status="done"]', { timeout: 15000 });
    assert.equal(await text(page, '[data-testid="img-size"]'), '3000×2000 → 2048×1365');
    assert.equal(await text(page, '[data-testid="img-taken"]'), '2027-01-10 17:42（+07:00，照片自带时区）');
    assert.match(await text(page, '[data-testid="img-result"]'), /image\/jpeg/);
    assert.match(await text(page, '[data-testid="img-result"]'), /Demo Fixture Camera/);
    // 压缩后的预览图解码正常
    const natural = await page.$eval('.lp-img__preview', (img) => img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
    assert.deepEqual(natural, [2048, 1365]);
    await shotEl(app, '[data-testid="img-card"]', 'image-fixture');

    await page.click('[data-testid="img-demo"]');
    await page.waitForFunction(() => /演示照片/.test(document.querySelector('[data-testid="img-result"]')?.textContent || ''), { timeout: 15000 });
    assert.equal(await text(page, '[data-testid="img-taken"]'), '照片里没有拍摄时间');
    app.assertClean();
  } finally {
    await app.close();
  }
});
