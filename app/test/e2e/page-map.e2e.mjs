// 地图页（#/t/:tripId/map，src/pages/map/）：进行中默认今天的路线（编号、连线）、按天筛选（网址 ?day=、滑块半路图、9 天横向滑）、
// 点图钉 → 放大（半路图）+ 底部小卡（导航 / 叫 Grab / 给司机看 + 详情开 place 弹层）、点列表行 → 地图选中、一根手指拖地图页面不滚、
// 显示全部、我的位置（成功 / 被拒的说明）、底图加载不了 / 离线提示、空状态、离开销毁地图、深色 / 375 / 1280 / 减弱动态效果下无报错、
// 不横向滚动、触控区 ≥44。截图：<截图根目录>/__screenshots__/page-map/，半路图：__shots__/page-map/。
// 期望的数字从演示数据库算（demo/demo-db.json，全部虚构）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release, between } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { ALL, buildMapModel } from '../../src/pages/map/model.js';
import { dayRoute as routeOfItems } from '../../src/lib/map/geo.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const SHOTS = shotsDir('page-map');
const T = (id) => `[data-testid="${id}"]`;
const PAGE = T('page-map');
const MARKER = `${T('map-canvas')} .mp-marker`;
const NOW_ONGOING = '2027-01-11T10:00:00+07:00';
const NOW_UPCOMING = '2027-01-08T09:00:00+07:00';
const NOW_ENDED = '2027-01-20T10:00:00+07:00';

/** 一趟演示行程的地图模型（和页面同一份 model.js） */
function modelFor(tripId, filter = ALL) {
  const rows = (t) => DB.tables[t].filter((r) => r.trip_id === tripId);
  const trip = DB.tables.trips.find((t) => t.id === tripId);
  const days = rows('days').sort((a, b) => a.date.localeCompare(b.date));
  const places = rows('places');
  const placeById = new Map(places.map((p) => [p.id, p]));
  const itemsByDay = new Map();
  for (const it of rows('items')) {
    if (it.deleted_at) continue;
    const k = it.day_id ?? null;
    if (!itemsByDay.has(k)) itemsByDay.set(k, []);
    itemsByDay.get(k).push(it);
  }
  for (const list of itemsByDay.values()) list.sort((a, b) => (a.sort_key - b.sort_key) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  const routeOf = (dayId) => ({ ...routeOfItems(itemsByDay.get(dayId) || [], placeById), missing: [] });
  const dayId = filter === ALL ? ALL : days.find((d) => d.date === filter)?.id;
  return { days, places, model: buildMapModel({ filter: dayId, days, places, itemsByDay, routeOf, tripStart: trip.start_date }) };
}

const ISLAND = modelFor('demo-island');
const D1 = ISLAND.days[0].date;
const D2 = ISLAND.days[1].date;
const ISLAND_D2 = modelFor('demo-island', D2).model;
const ISLAND_D1 = modelFor('demo-island', D1).model;

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** 打开地图页，等地图建好、标记落下 */
async function openMap({ hash = '#/t/demo-island/map', now = NOW_ONGOING, markers = true, ...o } = {}) {
  const app = await openApp({ browser, server, hash, now, ...o });
  await app.page.waitForSelector(`${PAGE}[data-map-ready]`, { timeout: 15000 });
  if (markers) await app.page.waitForSelector(MARKER, { timeout: 10000 });
  await app.idle();
  return app;
}

const markerCount = (page) => page.$$eval(MARKER, (els) => els.length);
const hashOf = (page) => page.evaluate(() => location.hash);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());

/** 截一块（地图卡片）到 __shots__/page-map/ */
async function clip(app, name, sel = T('map-frame')) {
  const box = await app.page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(r.height, window.innerHeight - Math.max(0, r.top)) };
  });
  const suffix = app.device && app.device !== 'mobile' ? `-${app.device}` : '';
  const file = path.join(SHOTS, `${name}${suffix}.png`);
  await app.page.screenshot({ path: file, clip: { ...box, x: box.x + 0, y: box.y + 0 } });
  return file;
}

// ---------------------------------------------------------------------
// 布局、状态
// ---------------------------------------------------------------------

for (const [label, o] of [['手机 390 浅色', {}], ['手机 390 深色', { colorScheme: 'dark' }], ['小屏 375', { device: 'small' }], ['桌面 1280', { device: 'desktop' }], ['减弱动态效果', { reducedMotion: true }]]) {
  test(`地图页（${label}）：没有报错、不连外网、不横向滚动、可点的东西 ≥44px；地图贴合视口、下面露出列表`, async () => {
    const app = await openMap(o);
    const { page } = app;
    try {
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      const frame = await page.$eval(T('map-frame'), (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, vh: window.innerHeight, vw: window.innerWidth };
      });
      assert.ok(frame.height >= 300, `地图至少 300 高：${frame.height}`);
      if (o.device !== 'desktop') {
        // 顶栏胶囊（约 80）下面开始，底栏（约 84 + 安全区）和一截列表留在下面
        assert.ok(frame.top > 60 && frame.top < 180, `地图顶边在胶囊下面：${frame.top}`);
        assert.ok(frame.bottom < frame.vh - 84 - 40, `地图底边在底栏上面并留出一截列表：${frame.bottom} / ${frame.vh}`);
        const list = await page.$eval(T(`map-group-${ISLAND.days[1].id}`), (el) => el.getBoundingClientRect().top).catch(() => null);
        if (list !== null) assert.ok(list < frame.vh, '列表的标题在首屏能看到一截');
      } else {
        // 桌面：地图在左、列表在右
        const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width }; };
        const list = await page.$eval('.mp__list', rect);
        const map = await page.$eval('.mp__map', rect);
        assert.ok(list.left >= map.right - 1, `列表在地图右边：地图 ${JSON.stringify(map)} 列表 ${JSON.stringify(list)}`);
      }
      await app.shot(`map-ongoing${o.colorScheme === 'dark' ? '-dark' : ''}${o.reducedMotion ? '-reduced' : ''}`, { fullPage: false });
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('行程进行中：默认筛到今天（D2），网址不写 ?day=，路线点按顺序编号、有连线、今天那格写「今天」；左上角写「D2 · 日期 · N 处」', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    assert.equal(await page.$eval(PAGE, (el) => el.dataset.filter), ISLAND.days[1].id);
    assert.doesNotMatch(await hashOf(page), /day=/);
    assert.equal(await page.$eval(T(`map-filter-${D2}`), (el) => el.getAttribute('aria-checked')), 'true');
    assert.equal(await text(page, `${T(`map-filter-${D2}`)} .mp-strip__top`), '今天');
    assert.equal(await markerCount(page), ISLAND_D2.markers.length, '标记数 = 当天路线点（去重）+ 备选');
    const badges = await page.$$eval(`${MARKER} .mp-pin[data-badge] .mp-pin__badge`, (els) => els.map((e) => e.textContent));
    const expected = ISLAND_D2.markers.filter((m) => m.orders.length).map((m) => m.orders.length > 2 ? `${m.orders[0]}·${m.orders[1]}…` : m.orders.join('·'));
    assert.deepEqual(badges.sort(), expected.sort());
    assert.ok(await page.$(`${T('map-canvas')} path.mp-route`), '有路线折线');
    assert.ok(await page.$(`${T('map-canvas')} path.mp-route-casing`), '路线有白色衬底');
    assert.ok(!(await page.$(`${T('map-canvas')} path.mp-route--muted`)), '某一天的路线不是淡的');
    assert.match(await text(page, T('map-summary')), /^D2 · 1月11日 周一 · \d+ 处/);
    // 图钉颜色 = 这一天的分类色（D2 → 第 2 个）
    const tones = await page.$$eval(`${MARKER} .mp-pin`, (els) => [...new Set(els.map((e) => e.dataset.tone))]);
    assert.deepEqual(tones, ['2']);
    // 全部图钉都在地图可视区域内（取景生效）
    const inside = await page.evaluate((sel) => {
      const frame = document.querySelector(sel).getBoundingClientRect();
      return [...document.querySelectorAll(`${sel} .mp-pin__head`)].every((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
      });
    }, T('map-frame'));
    assert.ok(inside, '所有图钉都在地图里');
    // 列表：当天路线按顺序，和地图上的编号一致
    const rows = await page.$$eval(`${T(`map-group-${ISLAND.days[1].id}`)} .k-row`, (els) => els.length);
    assert.equal(rows, ISLAND_D2.groups[0].rows.length);
    await app.shot('map-ongoing-full');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出发前：默认看全部（每天的路线都画但淡、图钉不编号、按天上色）；结束后也是全部；没坐标的地点列在最下面并能开地点详情', async () => {
  const app = await openMap({ now: NOW_UPCOMING });
  const { page } = app;
  try {
    assert.equal(await page.$eval(PAGE, (el) => el.dataset.filter), ALL);
    assert.equal(await markerCount(page), ISLAND.model.markers.length);
    assert.equal(await page.$$eval(`${MARKER} .mp-pin[data-badge]`, (els) => els.length), 0, '看全部时不编号');
    assert.ok(await page.$(`${T('map-canvas')} path.mp-route--muted`), '每天的路线都画、淡的');
    const tones = await page.$$eval(`${MARKER} .mp-pin`, (els) => new Set(els.map((e) => e.dataset.tone)).size);
    assert.ok(tones >= 3, `按天上色：${tones} 种颜色`);
    assert.match(await text(page, T('map-summary')), /^全部 · \d+ 处/);
    // 没坐标的
    const missing = ISLAND.model.missing;
    assert.equal(await page.$$eval(`${T('map-missing')} .k-row`, (els) => els.length), missing.length);
    assert.equal(await text(page, T('map-summary-warn')), `${missing.length} 处没坐标`);
    await page.click(T('map-summary-warn'));
    await page.waitForFunction(() => {
      const r = document.getElementById('map-missing')?.getBoundingClientRect();
      return r && r.top >= 0 && r.top < window.innerHeight;
    });
    await page.click(T(`map-missing-${missing[0].placeId}`));
    await page.waitForFunction((id) => location.hash.includes(`sheet=place:${id}`), {}, missing[0].placeId);
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    app.assertClean();
  } finally {
    await app.close();
  }
  const ended = await openMap({ now: NOW_ENDED });
  try {
    assert.equal(await ended.page.$eval(PAGE, (el) => el.dataset.filter), ALL);
    assert.equal(await ended.page.$eval(`${T(`map-filter-${D2}`)} .mp-strip__top`, (el) => el.textContent.trim()), '11 周一', '结束后没有「今天」');
    ended.assertClean();
  } finally {
    await ended.close();
  }
});

// ---------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------

test('按天筛选：点 D1 → 网址 ?day=日期、滑块弹簧跟过去（半路在两格之间）、标记和路线换成 D1、取景换到 D1；点「全部」→ ?day=all；刷新后还在；←→ 键也能切', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    const thumbX = () => page.$eval('.mp-strip__thumb', (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    const x0 = await thumbX();
    const mid = await captureAt(app, () => page.click(T(`map-filter-${D1}`)), { selector: '.mp-strip__thumb', progress: 0.3, evaluate: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.mp-strip__thumb')).transform).m41 });
    try {
      await clip(app, 'filter-mid', '.mp-strip');
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 6000);
    const x1 = await thumbX();
    assert.ok(x1 < x0, `滑块往左到 D1：${x0} → ${x1}`);
    assert.ok(between(mid.state, x0, x1), `半路在两格之间：${x0} / ${mid.state} / ${x1}`);
    await page.waitForFunction((d) => location.hash.includes(`day=${d}`), {}, D1);
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="map-canvas"] .mp-marker').length === n, { timeout: 8000 }, ISLAND_D1.markers.length);
    assert.equal(await page.$eval(T(`map-filter-${D1}`), (el) => el.getAttribute('aria-checked')), 'true');
    assert.match(await text(page, T('map-summary')), /^D1 · /);
    const tones = await page.$$eval(`${MARKER} .mp-pin`, (els) => [...new Set(els.map((e) => e.dataset.tone))]);
    assert.deepEqual(tones, ['1']);
    await app.idle();
    // 全部
    await page.click(T('map-filter-all'));
    await page.waitForFunction(() => location.hash.includes('day=all'));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="map-canvas"] .mp-marker').length === n, { timeout: 8000 }, ISLAND.model.markers.length);
    // 刷新还在
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await page.waitForSelector(`${PAGE}[data-map-ready]`, { timeout: 15000 });
    await page.waitForSelector(MARKER);
    assert.equal(await page.$eval(PAGE, (el) => el.dataset.filter), ALL);
    // 键盘：焦点在选中的格上，→ 到 D1
    await page.focus(T('map-filter-all'));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((d) => location.hash.includes(`day=${d}`), {}, D1);
    await app.idle();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), `map-filter-${D1}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('九天的行程（三城）：10 格放不下就横向滑、选中格滚到中间，D9 点得到；已结束默认看全部', async () => {
  const app = await openMap({ hash: '#/t/demo-cities/map', now: NOW_ENDED });
  const { page } = app;
  try {
    assert.equal(await page.$$eval('.mp-strip__cell', (els) => els.length), 10);
    assert.ok(await page.$('.mp-strip[data-scrolls]'), '可以横向滑');
    const cities = modelFor('demo-cities');
    const d9 = cities.days[8].date;
    await page.$eval(T(`map-filter-${d9}`), (el) => el.scrollIntoView({ inline: 'center', behavior: 'instant' }));
    await page.click(T(`map-filter-${d9}`));
    await page.waitForFunction((d) => location.hash.includes(`day=${d}`), {}, d9);
    await page.waitForFunction(() => document.querySelector('[data-testid="map-filter-2026-03-22"]')?.getAttribute('aria-checked') === 'true');
    const cell = await page.$eval(T(`map-filter-${d9}`), (el) => {
      const r = el.getBoundingClientRect();
      const box = el.closest('.mp-strip__scroll').getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right;
    });
    assert.ok(cell, 'D9 在可视范围内');
    await assertNoHorizontalOverflow(page);
    await app.shot('map-cities-d9', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 选中、小卡、列表
// ---------------------------------------------------------------------

test('点图钉：图钉弹簧放大（半路介于 1 和 1.18）并显示名字，底部浮出小卡（名字、第几站、导航 / 叫 Grab / 给司机看 的链接和 lib 一致）；点小卡开地点详情；× 收起；点地图空白处也收起', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    // 挑一个屏幕上没被别的图钉压住的（演示数据里镇中心的点挤在一起，点中间会点到上面那颗）
    const firstId = await page.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)].filter((el) => el.querySelector('.mp-pin[data-badge]'));
      const pts = els.map((el) => { const r = el.getBoundingClientRect(); return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const lonely = pts.find((a) => pts.every((b) => a === b || Math.hypot(a.x - b.x, a.y - b.y) > 48));
      return (lonely || pts[0]).el.dataset.markerId;
    }, MARKER);
    const first = ISLAND_D2.markers.find((m) => m.id === firstId);
    assert.ok(first?.placeId, '选中的是一个地点');
    const sel = `${MARKER}[data-marker-id="${first.id}"]`;
    const mid = await captureAt(app, () => page.click(sel), {
      selector: '.mp-pin',
      progress: 0.12,
      evaluate: () => {
        const pin = document.querySelector('.mp-pin.is-selected');
        return pin ? new DOMMatrixReadOnly(getComputedStyle(pin).transform).a : null;
      },
    });
    try {
      await clip(app, 'pin-select-mid');
    } finally {
      await release(mid);
    }
    assert.ok(mid.state !== null && between(mid.state, 1, 1.18, 0.02), `半路缩放介于 1 和 1.18：${mid.state}`);
    await waitForAnimationsDone(page, 6000);
    await page.waitForSelector(T('map-card'));
    await app.idle();
    const pin = await page.$eval('.mp-pin.is-selected', (el) => ({
      scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
      name: el.querySelector('.mp-pin__name').textContent,
      nameOpacity: getComputedStyle(el.querySelector('.mp-pin__name')).opacity,
      pressed: el.closest('.mp-marker').getAttribute('aria-pressed'),
    }));
    assert.ok(pin.scale > 1.15, `选中放大：${pin.scale}`);
    assert.equal(pin.name, first.title);
    assert.equal(pin.nameOpacity, '1');
    assert.equal(pin.pressed, 'true');
    assert.equal(await page.$$eval('.mp-pin.is-selected', (els) => els.length), 1, '同时只选中一个');
    assert.match(await hashOf(page), new RegExp(`place=${first.placeId}`));
    // 小卡
    assert.equal(await text(page, '.mp-card__title'), first.title);
    assert.match(await text(page, T('map-card-sub')), new RegExp(`^第 ${first.orders.join('、')} 站`));
    const place = ISLAND.places.find((p) => p.id === first.placeId);
    const links = await page.$$eval(`${T('map-card-actions')} a[href]`, (els) => els.map((a) => [a.getAttribute('aria-label') || a.textContent.trim(), a.href]));
    const nav = links.find(([, href]) => /google\.com\/maps/.test(href));
    assert.ok(nav, '有导航链接');
    assert.match(nav[1], new RegExp(`destination=${Number(place.lat)}`));
    assert.ok(links.some(([, href]) => /grab\.onelink\.me/.test(href)), '有叫 Grab 的链接');
    assert.ok(await page.$(`${T('map-card-actions')} [data-testid="place-actions-driver"], ${T('map-card-actions')} button`), '有给司机看');
    // 小卡里图钉不被挡住：图钉头在卡片上面
    const clear = await page.evaluate(() => {
      const pin = document.querySelector('.mp-pin.is-selected .mp-pin__head').getBoundingClientRect();
      const card = document.querySelector('[data-testid="map-card"]').getBoundingClientRect();
      return pin.bottom <= card.top;
    });
    assert.ok(clear, '选中的图钉没被小卡挡住');
    await clip(app, 'pin-selected');
    // 详情
    await page.click(T('map-card-open'));
    await page.waitForFunction((id) => location.hash.includes(`sheet=place:${id}`), {}, first.placeId);
    assert.ok(await page.$('.mp-pin.is-selected'), '弹层开着时地图上仍高亮');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.idle();
    assert.ok(await page.$(T('map-card')), '关掉弹层小卡还在');
    // × 收起
    await page.click(T('map-card-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="map-card"]'));
    assert.equal(await page.$('.mp-pin.is-selected'), null);
    assert.doesNotMatch(await hashOf(page), /place=/);
    // 再选中，点空白处收起
    await page.click(sel);
    await page.waitForSelector(T('map-card'));
    const frame = await page.$eval(T('map-frame'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, height: r.height }; });
    await page.mouse.click(frame.x + 24, frame.y + frame.height * 0.45);
    await page.waitForFunction(() => !document.querySelector('[data-testid="map-card"]'), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('点列表行：地图上选中那个图钉、平移到它、小卡出现、行高亮；换天后选中清掉', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    const row = ISLAND_D2.groups[0].rows[2];
    const rowSel = T(`map-row-${row.markerId}`);
    await page.$eval(rowSel, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.click(rowSel);
    await page.waitForSelector(`${MARKER}[data-marker-id="${row.markerId}"] .mp-pin.is-selected`);
    await page.waitForSelector(T('map-card'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(rowSel, (el) => el.getAttribute('aria-current')), 'true');
    assert.equal(await text(page, '.mp-card__title'), row.title);
    // 图钉在地图可视区域里
    const visible = await page.evaluate((sel) => {
      const frame = document.querySelector('[data-testid="map-frame"]').getBoundingClientRect();
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
    }, `${MARKER}[data-marker-id="${row.markerId}"]`);
    assert.ok(visible, '选中的图钉平移进了可视区域');
    // 换天：选中清掉（先回到顶部，筛选条不在顶栏胶囊下面）
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    await page.click(T(`map-filter-${D1}`));
    await page.waitForFunction(() => !document.querySelector('[data-testid="map-card"]'), { timeout: 6000 });
    assert.equal(await page.$('.mp-pin.is-selected'), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 手势、按钮
// ---------------------------------------------------------------------

test('手机：一根手指在地图上拖 = 地图动、页面不滚；「显示全部」拉回来；两根手指缩放照常（Leaflet touch-action: none）', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    const canvas = await page.$(T('map-canvas'));
    const box = await canvas.boundingBox();
    const pane = () => page.$eval(`${T('map-canvas')} .leaflet-map-pane`, (el) => el.style.transform);
    const pane0 = await pane();
    const y0 = await page.evaluate(() => window.scrollY);
    assert.equal(await page.$eval(T('map-canvas'), (el) => getComputedStyle(el).touchAction), 'none');
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;
    await page.touchscreen.touchStart(x, y);
    for (let i = 1; i <= 8; i += 1) await page.touchscreen.touchMove(x - i * 12, y - i * 18);
    await page.touchscreen.touchEnd();
    await page.waitForFunction((t) => document.querySelector('[data-testid="map-canvas"] .leaflet-map-pane').style.transform !== t, { timeout: 4000 }, pane0);
    assert.equal(await page.evaluate(() => window.scrollY), y0, '页面没跟着滚');
    await app.idle();
    // 显示全部：全部图钉回到可视区域
    await page.click(T('map-fit'));
    await waitForAnimationsDone(page, 6000);
    await page.waitForFunction((sel) => {
      const frame = document.querySelector(sel).getBoundingClientRect();
      return [...document.querySelectorAll(`${sel} .mp-pin__head`)].every((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
      });
    }, { timeout: 6000 }, T('map-frame'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('我的位置：允许定位 → 蓝点出现、按钮变蓝、小卡里写「离你 N 公里」；离行程地点很远（在香港）→ 提示停在行程范围；被拒 → 说明怎么在 iPhone 设置里打开', async () => {
  // 允许：人在岛上
  const app = await openMap();
  const { page, context } = app;
  try {
    const near = ISLAND_D2.markers[0];
    await context.overridePermissions(server.origin, ['geolocation']);
    await page.setGeolocation({ latitude: near.lat + 0.004, longitude: near.lng, accuracy: 30 });
    await page.click(T('map-locate'));
    await page.waitForSelector('.mp-me__dot', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="map-locate"]')?.dataset.state === 'on');
    assert.ok(await page.$('.mp-accuracy'), '精度圈');
    await waitForAnimationsDone(page, 6000);
    await page.click(`${MARKER}[data-marker-id="${near.id}"]`);
    await page.waitForSelector(T('map-card'));
    assert.match(await text(page, T('map-card-sub')), /离你 \d+ 米|离你 [\d.]+ 公里|就在附近/);
    await clip(app, 'me-located');
    app.assertClean();
  } finally {
    await app.close();
  }
  // 人还在香港：地图不跑过去
  const far = await openMap();
  try {
    await far.context.overridePermissions(server.origin, ['geolocation']);
    await far.page.setGeolocation({ latitude: 22.3193, longitude: 114.1694, accuracy: 50 });
    const pane0 = await far.page.$eval(`${T('map-canvas')} .leaflet-map-pane`, (el) => el.style.transform);
    await far.page.click(T('map-locate'));
    await far.page.waitForSelector('.mp-me__dot', { timeout: 8000 });
    await far.page.waitForFunction(() => /地图停在行程范围/.test(document.body.textContent), { timeout: 6000 });
    await far.idle();
    assert.equal(await far.page.$eval(`${T('map-canvas')} .leaflet-map-pane`, (el) => el.style.transform), pane0, '地图没跑去香港');
    far.assertClean();
  } finally {
    await far.close();
  }
  // 被拒
  const denied = await openMap();
  try {
    await denied.page.click(T('map-locate'));
    await denied.page.waitForSelector(T('map-location-help'), { timeout: 8000 });
    assert.equal(await denied.page.$eval(T('map-locate'), (el) => el.dataset.state), 'error');
    const help = await denied.page.$eval(T('map-location-help'), (el) => el.textContent);
    assert.match(help, /没有定位权限/);
    assert.match(help, /定位服务/);
    assert.match(help, /Safari/);
    assert.equal(await denied.page.$('.mp-me__dot'), null);
    await denied.shot('map-location-denied');
    denied.assertClean();
  } finally {
    await denied.close();
  }
});

test('底图：演示模式不加载（方格纸 + 角标、不连外网）；强制加载时瓦片请求被拦下 → 「地图底图加载不了」，断网 → 「离线中，地图底图加载不了」；标记和列表照常能用', async () => {
  const app = await openMap({ search: { tiles: '1' } });
  const { page } = app;
  try {
    await page.waitForSelector(T('map-banner'), { timeout: 10000 });
    assert.match(await text(page, `${T('map-banner')} b`), /地图底图加载不了/);
    assert.ok(await page.$(T('map-attribution')), '有署名');
    assert.match(await text(page, T('map-attribution')), /OpenStreetMap/);
    assert.ok(app.external.length > 0 && app.external.every((u) => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(u)), `只请求了 OSM 瓦片：${app.external[0]}`);
    await page.setOfflineMode(true);
    await page.waitForFunction(() => /离线中/.test(document.querySelector('[data-testid="map-banner"]')?.textContent || ''), { timeout: 6000 });
    assert.equal(await text(page, `${T('map-banner')} b`), '离线中，地图底图加载不了');
    assert.equal(await markerCount(page), ISLAND_D2.markers.length, '标记还在');
    const first = ISLAND_D2.markers.find((m) => m.placeId);
    await page.click(`${MARKER}[data-marker-id="${first.id}"]`);
    await page.waitForSelector(T('map-card'));
    await clip(app, 'offline-banner');
    await page.setOfflineMode(false);
    const errs = app.errors.filter((e) => !/ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
    assert.deepEqual(errs, [], `除了被拦下的瓦片没有别的报错：${errs.join('\n')}`);
  } finally {
    await app.close();
  }
  const demo = await openMap();
  try {
    assert.ok(await demo.page.$(T('map-notiles')), '演示模式角标');
    assert.equal(await demo.page.$(T('map-banner')), null);
    assert.equal(await demo.page.$eval(T('map-frame'), (el) => el.dataset.tiles), 'off');
    demo.assertClean();
  } finally {
    await demo.close();
  }
});

test('深色模式：底图层用压暗滤镜的类名（强制加载时），图钉、小卡照常', async () => {
  const app = await openMap({ colorScheme: 'dark', search: { tiles: '1' } });
  try {
    await app.page.waitForSelector(`${T('map-canvas')} .mp-tiles--dark-filter`, { timeout: 8000 });
    assert.equal(await app.page.$eval(T('map-frame'), (el) => el.dataset.scheme), 'dark');
    await clip(app, 'dark-tiles');
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 空状态、生命周期
// ---------------------------------------------------------------------

test('空行程：地图上浮出「还没有地点」+ 去地点页；筛选条只有全部 + 两天', async () => {
  const app = await openMap({ hash: '#/t/demo-empty/map', now: NOW_UPCOMING, markers: false });
  const { page } = app;
  try {
    await page.waitForSelector(T('map-empty'));
    assert.match(await text(page, T('map-empty')), /还没有地点/);
    assert.equal(await markerCount(page), 0);
    assert.equal(await page.$$eval('.mp-strip__cell', (els) => els.length), 3);
    assert.match(await page.$eval(`${T('map-empty')} a[href]`, (a) => a.getAttribute('href')), /#\/t\/demo-empty\/places$/);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('map-empty', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空行程筛到某一天：仍然是「还没有地点」（一个地点都没有比“这一天没有”更要紧）；找不到的行程显示空状态', async () => {
  const app = await openMap({ hash: '#/t/demo-empty/map?day=2027-04-03', now: NOW_UPCOMING, markers: false });
  try {
    await app.page.waitForSelector(T('map-empty'));
    assert.match(await text(app.page, T('map-empty')), /还没有地点/);
    assert.equal(await app.page.$eval(PAGE, (el) => el.dataset.filter), '2027-04-03'.length ? await app.page.$eval(T('map-filter-2027-04-03'), (el) => el.getAttribute('aria-checked') === 'true' ? document.querySelector('[data-testid="page-map"]').dataset.filter : 'x') : 'x');
    app.assertClean();
  } finally {
    await app.close();
  }
  const missing = await openApp({ browser, server, hash: '#/t/no-such-trip/map' });
  try {
    await missing.page.waitForFunction(() => /找不到这趟行程/.test(document.querySelector('[data-testid="page-map"]')?.textContent || ''), { timeout: 10000 });
    missing.assertClean();
  } finally {
    await missing.close();
  }
});

test('离开地图页销毁地图，回来重新建；地图等页面进场动画播完才建（进场期间 DOM 里还没有 Leaflet）', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/ledger', now: NOW_ONGOING });
  const { page } = app;
  try {
    await page.evaluate(() => { window.location.hash = '#/t/demo-island/map'; });
    // 刚换页：页面已经在 DOM 里、地图还没建（进场动画在播）
    await page.waitForSelector(PAGE, { timeout: 10000 });
    const early = await page.$(`${PAGE}[data-map-ready]`);
    assert.equal(early, null, '进场动画期间还没建地图');
    await page.waitForSelector(`${PAGE}[data-map-ready]`, { timeout: 15000 });
    await page.waitForSelector(MARKER);
    assert.equal(await page.$$eval('.leaflet-container', (els) => els.length), 1);
    await app.go('#/t/demo-island/ledger');
    await page.waitForFunction(() => !document.querySelector('.leaflet-container'), { timeout: 6000 });
    await app.go('#/t/demo-island/map');
    await page.waitForSelector(`${PAGE}[data-map-ready]`, { timeout: 15000 });
    await page.waitForSelector(MARKER);
    assert.equal(await page.$$eval('.leaflet-container', (els) => els.length), 1, '回来只有一个地图');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 小卡的说明行、网址里的地点、转屏重新取景
// ---------------------------------------------------------------------

test('小卡：有下车点的地点显示下车提示；开车到不了的「叫 Grab」改叫「去缆车站」并说明；进行中“现在”那条带「现在」胶囊、副标题带时间', async () => {
  const places = DB.tables.places.filter((p) => p.trip_id === 'demo-island');
  const viaPlace = places.find((p) => p.extra?.ride_via && !p.extra.no_road);
  const noRoad = places.find((p) => p.extra?.no_road);
  assert.ok(viaPlace && noRoad, '演示数据里有下车点和开车到不了的例子');
  const app = await openMap({ hash: '#/t/demo-island/map?day=all' });
  const { page } = app;
  try {
    // 从列表点（看全部时镇中心的图钉挤在一起，点图钉可能点到别的）
    const pick = async (id) => {
      const sel = T(`map-row-${id}`);
      await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.click(sel);
      await page.waitForFunction((pid) => document.querySelector('[data-testid="map-card"]') && location.hash.includes(`place=${pid}`), {}, id);
      await waitForAnimationsDone(page, 6000);
    };
    await pick(viaPlace.id);
    assert.equal(await text(page, '.mp-card__title'), viaPlace.name);
    assert.match(await text(page, T('map-card-actions-note')), new RegExp(viaPlace.extra.ride_note));
    await clip(app, 'card-ride-note');
    await pick(noRoad.id);
    // 批 A：动作键 grab 改名 ride（点名 'grab' 照样认，DOM 上写 ride）
    const grab = await page.$eval(`${T('map-card-actions')} [data-action="ride"]`, (el) => el.getAttribute('aria-label') || el.textContent);
    assert.match(grab, /去缆车站/);
    const note = await text(page, T('map-card-actions-note'));
    assert.match(note, /开车到不了/);
    assert.match(note, /缆车/);
    assert.match(await text(page, T('map-card-sub')), /大概位置/);
    app.assertClean();
  } finally {
    await app.close();
  }
  // 进行中：今天“现在”这一条
  const now = await openMap();
  try {
    const nowId = await now.page.$eval(`${MARKER} .mp-pin[data-now]`, (el) => el.closest('.mp-marker').dataset.markerId);
    assert.ok(nowId, '今天有“现在”这一条的地点');
    const sel = T(`map-row-${nowId}`);
    await now.page.$eval(sel, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await now.page.click(sel);
    await now.page.waitForSelector(T('map-card-now'));
    await waitForAnimationsDone(now.page, 6000);
    assert.equal(await text(now.page, T('map-card-now')), '现在');
    assert.match(await text(now.page, T('map-card-sub')), /^第 \d+(、\d+)* 站 · \d{1,2}:\d{2}/, '第几站后面接时间');
    await clip(now, 'card-now');
    now.assertClean();
  } finally {
    await now.close();
  }
});

test('网址里带 ?place=：不在今天的筛选里 → 改看全部并选中它；换天 → 选中和网址里的 place 一起清掉', async () => {
  const other = ISLAND_D1.markers.find((m) => m.placeId && !ISLAND_D2.markers.some((x) => x.id === m.id));
  assert.ok(other, 'D1 有不在 D2 里的地点');
  const app = await openMap({ hash: `#/t/demo-island/map?place=${other.placeId}` });
  const { page } = app;
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid="page-map"]')?.dataset.filter === 'all', { timeout: 8000 });
    await page.waitForSelector(`${MARKER}[data-marker-id="${other.id}"] .mp-pin.is-selected`, { timeout: 8000 });
    await page.waitForSelector(T('map-card'));
    assert.match(await hashOf(page), /day=all/);
    assert.equal(await text(page, '.mp-card__title'), other.title);
    await app.idle();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click(T(`map-filter-${D2}`));
    await page.waitForFunction(() => !document.querySelector('[data-testid="map-card"]') && !/place=/.test(location.hash), { timeout: 8000 });
    assert.equal(await page.$('.mp-pin.is-selected'), null);
    app.assertClean();
  } finally {
    await app.close();
  }
  // 在筛选里的：直接选中，不换筛选
  const inToday = ISLAND_D2.markers.find((m) => m.placeId);
  const same = await openMap({ hash: `#/t/demo-island/map?place=${inToday.placeId}` });
  try {
    await same.page.waitForSelector(`${MARKER}[data-marker-id="${inToday.id}"] .mp-pin.is-selected`, { timeout: 8000 });
    assert.equal(await same.page.$eval(PAGE, (el) => el.dataset.filter), ISLAND.days[1].id);
    assert.doesNotMatch(await hashOf(same.page), /day=/);
    same.assertClean();
  } finally {
    await same.close();
  }
});

test('容器尺寸变了（转屏 / 换成桌面布局）：没自己动过地图就按新尺寸重新取景，全部图钉仍在地图里', async () => {
  const app = await openMap();
  const { page } = app;
  try {
    const allInside = () => page.evaluate((sel) => {
      const frame = document.querySelector(sel).getBoundingClientRect();
      return [...document.querySelectorAll(`${sel} .mp-pin__head`)].every((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
      });
    }, T('map-frame'));
    assert.ok(await allInside(), '一开始都在');
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.waitForFunction(() => document.querySelector('.mp__list').getBoundingClientRect().left > 600, { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    await page.waitForFunction((sel) => {
      const frame = document.querySelector(sel).getBoundingClientRect();
      return [...document.querySelectorAll(`${sel} .mp-pin__head`)].every((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
      });
    }, { timeout: 8000 }, T('map-frame'));
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});
