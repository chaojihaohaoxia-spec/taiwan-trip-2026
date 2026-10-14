// 地点与评级（pages/places）、地点详情（sheets/place）、写评级（sheets/review）：演示数据（椰影岛进行中第 2 天）。
// 搜索（越南语去声调、高亮、写进网址）、种类芯片、四种看法、列表 ↔ 网格（FLIP 半路图）、去过还没评、备选池一键排进某天（可撤销）；
// 地点详情（名字三种、动作行和 lib/ 的链接一致、评级、在行程里、信息、贴士、下车点 / 开车到不了 / 大概位置、想去）；
// 写评级（五档弹一下的半路图、评语、吃了什么 + 价格解析、保存转圈打勾、回到地点详情、刷新还在、编辑 + 删除 + 撤销、
// 改了没保存先问、离线也能存）；只读成员；空行程；375 / 1280 / 深色 / 超长越南语地址：不横向滚动、触控区 ≥44。
// 截图：<截图根目录>/__screenshots__/page-places/，半路图：__shots__/page-places/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, SCREENSHOT_DIR, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { googleMapsNavigateUrl } from '../../src/lib/maps-links.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const PLACE = (name) => island('places').find((p) => p.name === name);
const SEAFOOD = PLACE('老码头海鲜');      // 有电话、链接、Cathy 评了「顶级」、Jeremy 没评、今天（D2）的条目
const MARKET = PLACE('椰影夜市');         // 两人都评了（Jeremy 夯，吃了两样、一张照片），有防坑贴士
const GARDEN = PLACE('园中厨房');         // 下车点 ride_via + ride_note
const CLOUD = PLACE('云屿');              // 开车到不了：叫 Grab 改成「去缆车站」
const LONG = island('places').find((p) => (p.address || '').length > 100);
const POOL = island('items').find((i) => !i.day_id && !i.deleted_at && i.place_id);
const D1 = island('days').find((d) => d.date === '2027-01-10');
const D2 = island('days').find((d) => d.date === '2027-01-11');
const D3 = island('days').find((d) => d.date === '2027-01-12');
const DURING = '2027-01-11T10:00:00+07:00';
const BEFORE = '2027-01-08T09:00:00+07:00';
const SHOTS = path.join(SCREENSHOT_DIR, 'page-places');
const MID = shotsDir('page-places');
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (page) => page.evaluate(() => location.hash);

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(MID, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** 打开地点页（默认椰影岛进行中第 2 天），等卡片出来 */
async function openPlaces(o = {}) {
  const { hash: h = '#/t/demo-island/places', ...rest } = o;
  const app = await openApp({ browser, server, hash: h, now: DURING, ...rest });
  await app.page.waitForSelector(T('page-places'), { timeout: 10000 });
  await app.page.waitForFunction(() => !document.querySelector('[data-testid="page-places"] [aria-busy="true"]') && (document.querySelector('.plc') || document.querySelector('[data-testid="places-empty"]')), { timeout: 10000 });
  await app.idle();
  return app;
}

/** 等地点详情打开到这个地点（出场动画播完） */
async function waitPlaceSheet(page, id) {
  await page.waitForSelector(`${T('place-sheet')}[data-place="${id}"]`, { timeout: 8000 });
  await waitForAnimationsDone(page, 6000);
}

/** 面板拉到大档（点把手） */
async function largeSheet(page, sheet = 'sheet-place') {
  const detent = await page.$eval(T(sheet), (el) => el.dataset.detent);
  if (detent === 'large') return;
  await page.click(`${T(sheet)} .ov-sheet__grabber`);
  await page.waitForFunction((s) => document.querySelector(`[data-testid="${s}"]`)?.dataset.detent === 'large', {}, sheet);
  await waitForAnimationsDone(page, 6000);
}

/** 面板里的东西滚进可见区 */
async function sheetScrollTo(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(250);
}

/** 只检查某一块里可点的东西（演示角标、底栏是外壳的） */
async function assertTapTargetsIn(page, root) {
  const small = await page.evaluate((sel) => {
    const out = [];
    const scope = document.querySelector(sel);
    if (!scope) return ['（找不到）'];
    for (const el of scope.querySelectorAll('a[href], button, [role="button"], [role="radio"], input:not([type="hidden"]):not(.visually-hidden), select, textarea, label')) {
      if (el.tagName === 'LABEL' && !el.querySelector('input.visually-hidden')) continue;
      if (el.closest('[inert]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let w = r.width;
      let h = r.height;
      for (const pseudo of ['::after', '::before']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const n = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
        w = Math.max(w, r.width - n(ps.left) - n(ps.right));
        h = Math.max(h, r.height - n(ps.top) - n(ps.bottom));
      }
      if (w < 43.5 || h < 43.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}」${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  }, root);
  assert.deepEqual(small, [], `这些可点元素小于 44px：\n${small.join('\n')}`);
}

const cardIds = (page) => page.$$eval('.plc', (els) => els.map((el) => el.dataset.testid.replace('place-', '')));

// ---------------------------------------------------------------------
// 地点页
// ---------------------------------------------------------------------

test('地点页（行程中 390）：卡片有种类图标、中文名、当地语名、在哪天、两人的评级胶囊；不横向滚动、触控区 ≥44', async () => {
  const app = await openPlaces();
  const { page } = app;
  try {
    assert.equal((await cardIds(page)).length, island('places').length, '按类型：每个地点一张卡片');
    const card = await page.$eval(T(`place-${MARKET.id}`), (el) => ({
      title: el.querySelector('.plc__title').textContent,
      local: el.querySelector('.plc__local').textContent,
      days: [...el.querySelectorAll('.pl-day')].map((d) => d.textContent),
      rates: [...el.querySelectorAll('.pl-rate')].map((d) => [d.dataset.rating, d.getAttribute('aria-label')]),
      bg: getComputedStyle(el.querySelector('.pl-rate')).backgroundColor,
    }));
    assert.equal(card.title, MARKET.name);
    assert.equal(card.local, MARKET.name_local);
    assert.ok(card.days.includes('D1'), card.days.join());
    assert.deepEqual(card.rates.map((r) => r[0]), ['5', '4'], '两个人的评级，按成员顺序');
    assert.match(card.rates[0][1], /Jeremy：夯/);
    const tier5 = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.background = 'var(--color-rating-5)';
      document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    assert.equal(card.bg, tier5, '夯是 --color-rating-5');
    // 有评级照片的卡片：照片左下角仍然有种类小图标
    await page.waitForSelector(`${T(`place-${MARKET.id}`)} .pl-thumb[data-photo] .pl-thumb__kind`, { timeout: 6000 });
    assert.match(await page.$eval(T('places-summary'), (el) => el.textContent), /^40 个地点 · 评过 \d+ 个 · 想去 3 个$/);
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-places'));
    await app.shot('list-390', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('搜索：越南语不带声调也能搜（pho → phở），命中的字高亮，写进网址；刷新还原；Esc / × 清除', async () => {
  const app = await openPlaces();
  const { page } = app;
  try {
    await page.click(T('places-search'));
    await page.keyboard.type('pho');
    await page.waitForFunction(() => /[?&]q=pho/.test(location.hash), { timeout: 4000 });
    const ids = await cardIds(page);
    assert.ok(ids.includes(PLACE('清晨粉店').id), '清晨粉店（Quán phở Sáng）');
    assert.ok(ids.length < 10, `只剩命中的（${ids.length}）`);
    const marks = await page.$$eval(`${T(`place-${PLACE('清晨粉店').id}`)} mark`, (els) => els.map((m) => m.textContent));
    assert.deepEqual(marks, ['phở']);
    assert.match(await page.$eval(T('places-summary'), (el) => el.textContent), /^显示 \d+ 个（共 40 个地点）$/);
    // 芯片的数量跟着搜索走
    assert.match(await page.$eval('[data-kind="food"]', (el) => el.textContent), /餐厅\s*1/);
    await app.shot('search-pho', { fullPage: false });
    // 刷新：网址里的 q 还原到搜索框
    await page.reload();
    await page.waitForSelector('.plc');
    assert.equal(await page.$eval(T('places-search'), (el) => el.value), 'pho');
    assert.ok((await cardIds(page)).length < 10);
    // 没结果
    await page.$eval(T('places-search'), (el) => el.select());
    await page.keyboard.type('zzqx');
    await page.waitForSelector(T('places-none'));
    assert.match(await page.$eval(T('places-none'), (el) => el.textContent), /没有找到「zzqx」/);
    // Esc 清除
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.plc').length === 40);
    await page.waitForFunction(() => !/[?&]q=/.test(location.hash), { timeout: 4000 });
    // × 清除
    await page.keyboard.type('夜市');
    await page.waitForSelector(T('places-search-clear'));
    await page.click(T('places-search-clear'));
    await page.waitForFunction(() => document.querySelectorAll('.plc').length === 40);
    // 搜到备选池里的条目：折着的备选池自动展开（命中的不藏在一行里）；清掉搜索又收回去
    assert.equal(await page.$(`${T('places-pool')}[data-open]`), null, '没在搜索时备选池折着');
    await page.keyboard.type(POOL.title.slice(0, 3));
    await page.waitForSelector(`${T('places-pool')}[data-open] ${T(`pool-${POOL.id}`)}`, { timeout: 4000 });
    await page.click(T('places-search-clear'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="places-pool"][data-open]'), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('种类芯片和四种看法：按类型 / 按天（今天那组标出来）/ 想去 / 评级（五档从高到低），都写进网址', async () => {
  const app = await openPlaces();
  const { page } = app;
  try {
    await page.$eval('[data-kind="food"]', (el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
    await page.click('[data-kind="food"]');
    await page.waitForFunction(() => /[?&]kind=food/.test(location.hash));
    const groups = await page.$$eval('[data-group]', (els) => els.map((e) => e.dataset.group));
    assert.deepEqual(groups, ['kind:food']);
    assert.equal(await page.$eval('[data-kind="food"]', (el) => el.getAttribute('aria-pressed')), 'true');
    // 再点一下回到全部
    await page.click('[data-kind="food"]');
    await page.waitForFunction(() => !/[?&]kind=/.test(location.hash));

    const mode = async (label, key) => {
      await page.evaluate((l) => [...document.querySelectorAll(`[data-testid="places-mode"] [role="radio"]`)].find((b) => b.textContent.trim() === l).click(), label);
      await page.waitForFunction((k) => new RegExp(`[?&]by=${k}`).test(location.hash), {}, key);
      await app.idle();
      return page.$$eval('[data-group]', (els) => els.map((e) => e.dataset.group));
    };
    const byDay = await mode('按天', 'day');
    assert.deepEqual(byDay.filter((g) => g.startsWith('day:')).length, 4, byDay.join());
    assert.equal(byDay.at(-1), 'loose');
    const today = await page.$$eval('.plp-gt__today', (els) => els.length);
    assert.equal(today, 1, '今天那组标「今天」');
    assert.ok(await page.$(`${T('places-pool')}[data-open]`), '按天看时备选池默认展开');
    // 行程中点「按天」：滚到今天那一组（组标题停在顶栏下面、屏幕上半截）
    await page.waitForFunction((id) => {
      const r = document.querySelector(`[data-group="day:${id}"]`).getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight * 0.4;
    }, { timeout: 4000 }, D2.id);
    assert.match(await page.$eval(`[data-group="day:${D2.id}"] h2`, (el) => el.textContent), /^D2 · 1月11日 周一/);
    // 按天时备选池排在各天后面、「没排进哪天」前面；「去过还没评」不出现
    const order = await page.$$eval('.plp__groups > section', (els) => els.map((e) => e.dataset.group || e.dataset.testid));
    assert.deepEqual(order.slice(-2), ['places-pool-group', 'loose'], order.join());
    assert.equal(await page.$(T('places-nudge')), null, '按天时不显示「去过还没评」');
    await app.shot('by-day', { fullPage: false });
    assert.deepEqual(await mode('想去', 'want'), ['wish']);
    assert.equal((await cardIds(page)).length, island('places').filter((p) => p.wishlist).length);
    const rated = await mode('评级', 'rating');
    assert.equal(rated[0], 'tier:5');
    assert.equal(rated.at(-1), 'unrated');
    await app.shot('by-rating', { fullPage: false });
    // 记住看法：不带 by 重新打开，还是「评级」
    await app.go('#/t/demo-island/places');
    await page.waitForSelector('[data-group]');
    assert.equal((await page.$$eval('[data-group]', (els) => els.map((e) => e.dataset.group)))[0], 'tier:5', '这台设备记住了上次的看法');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('列表 ↔ 网格：卡片底板 FLIP 到新位置（半路宽度在两端之间），网址带 view=grid，网格两列', async () => {
  const app = await openPlaces({ hash: '#/t/demo-island/places?kind=food' });
  const { page } = app;
  try {
    // 停在页面最上面（滚下去顶栏会收成胶囊盖住按钮；动画停住时它会一直停在半路）
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    const width = () => document.querySelector('[data-testid="place-' + document.querySelector('.plc').dataset.testid.slice(6) + '"] .plc__bg').getBoundingClientRect().width;
    const before = await page.evaluate(width);
    const toggle = async () => {
      await page.click(T('places-view'));
      await page.waitForSelector('.plp-list.vs--grid');
    };
    const cap = await captureAt(app, toggle, { selector: '.plc__bg', progress: 0.45, evaluate: width });
    try {
      await page.screenshot({ path: path.join(MID, 'grid-mid.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    await waitForAnimationsDone(page, 6000);
    const after = await page.evaluate(width);
    assert.ok(after < before * 0.6, `网格时卡片窄一半（${before} → ${after}）`);
    assert.ok(cap.state < before - 4 && cap.state > after + 4, `半路的宽度 ${cap.state} 在 ${before} 和 ${after} 之间`);
    assert.match(await hash(page), /[?&]view=grid/);
    const cols = await page.$$eval('.plc', (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    assert.equal(cols, 2, '手机上两列');
    const inline = await page.$$eval('.plc__bg, .plc__media, .plc__text', (els) => els.filter((e) => e.style.transform || e.style.width).length);
    assert.equal(inline, 0, 'FLIP 播完不留内联样式');
    await assertNoHorizontalOverflow(page);
    await app.shot('grid', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('去过还没评：第一天去过的地点（机场不算）在最上面，点一下直接写评级、关联那一次的条目', async () => {
  const app = await openPlaces();
  const { page } = app;
  try {
    const rows = await page.$$eval(`${T('places-nudge')} [data-testid^="nudge-"]`, (els) => els.map((e) => e.dataset.testid.slice(6)));
    assert.ok(rows.length >= 2, rows.join());
    const hubs = island('places').filter((p) => p.kind === 'hub').map((p) => p.id);
    assert.ok(rows.every((id) => !hubs.includes(id)), '机场、码头不提醒');
    await page.click(T(`nudge-${rows[0]}`));
    await page.waitForSelector(T('review-form'));
    assert.match(await hash(page), new RegExp(`sheet=review:p\\.${rows[0]}~i\\.`), '带上了条目');
    assert.match(await page.$eval('.ov-sheet__description', (el) => el.textContent), /D1 · /);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('备选池：按天看时展开，点「D3」排进那天的最后（卡片里的条目移走、提示里能撤销）', async () => {
  const app = await openPlaces({ hash: '#/t/demo-island/places?by=day' });
  const { page } = app;
  try {
    await page.waitForSelector(T(`pool-${POOL.id}`));
    await page.$eval(T(`pool-${POOL.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    // 行程中：已经过去的 D1 不列，今天写「今天」
    const days = await page.$$eval(`${T(`pool-days-${POOL.id}`)} [data-day]`, (els) => els.map((e) => [e.dataset.day, e.textContent.trim()]));
    assert.deepEqual(days.map((d) => d[0]), [D2.id, D3.id, island('days').find((d) => d.date === '2027-01-13').id]);
    assert.equal(days[0][1], '今天');
    assert.ok(!days.some((d) => d[0] === D1.id), '过去的 D1 不列');
    await page.click(`${T(`pool-days-${POOL.id}`)} [data-day="${D3.id}"]`);
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="pool-${id}"]`), {}, POOL.id);
    await page.waitForSelector('.ov-toast__action');
    assert.match(await page.$eval('.ov-toast__message', (el) => el.textContent), /排进了 D3/);
    // 地点卡片出现在 D3 那一组
    await page.waitForFunction((pid, did) => [...document.querySelectorAll(`[data-group="day:${did}"] .plc`)].some((c) => c.dataset.testid === `place-${pid}`), {}, POOL.place_id, D3.id);
    await app.shot('pool-scheduled', { fullPage: false });
    await page.click('.ov-toast__action');
    await page.waitForSelector(T(`pool-${POOL.id}`), { timeout: 6000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 地点详情
// ---------------------------------------------------------------------

test('地点详情：从底部升起（关掉后焦点回到卡片）；名字三种、营业时间、完整动作行（导航和 lib 一致、有电话就能打）、两人的评级、在行程里、信息、链接', async () => {
  const app = await openPlaces();
  const { page } = app;
  try {
    await page.$eval(T(`place-${SEAFOOD.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    const open = async () => {
      await page.click(T(`place-${SEAFOOD.id}`));
      await page.waitForSelector(`${T('place-sheet')}[data-place="${SEAFOOD.id}"]`);
    };
    const cap = await captureAt(app, open, {
      selector: '.ov-sheet', progress: 0.3, evaluate: () => new DOMMatrix(getComputedStyle(document.querySelector('.ov-sheet')).transform).m42,
    });
    try {
      await page.screenshot({ path: path.join(MID, 'place-open-30.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    assert.ok(cap.state > 10, `出场半路面板还在往上走（${cap.state}px）`);
    await waitPlaceSheet(page, SEAFOOD.id);
    assert.equal(await hash(page), `#/t/demo-island/places?sheet=place:${SEAFOOD.id}`);
    assert.equal(await page.$eval(T('sheet-place'), (el) => el.dataset.detent), 'medium', '先停在半屏');
    assert.equal(await page.$eval(T('place-sheet-title'), (el) => el.textContent), SEAFOOD.name);
    assert.equal(await page.$eval(T('place-sheet-local'), (el) => el.textContent), SEAFOOD.name_local);
    const actions = await page.$$eval(`${T('place-sheet-actions')} [data-action]`, (els) => els.map((e) => e.dataset.action));
    assert.deepEqual(actions, ['nav', 'grab', 'driver', 'copy', 'call', 'expense']);
    assert.equal(await page.$eval(`${T('place-sheet-actions')} [data-action="nav"]`, (el) => el.getAttribute('href')), googleMapsNavigateUrl(SEAFOOD, { mode: 'driving' }));
    await page.screenshot({ path: path.join(SHOTS, 'place-medium.png'), captureBeyondViewport: false });
    await largeSheet(page);
    const reviews = await page.$$eval(`${T('place-sheet-reviews')} [data-testid^="place-review-"]`, (els) => els.map((e) => e.textContent));
    assert.equal(reviews.length, 1);
    assert.match(reviews[0], /Cathy.*顶级/);
    assert.equal(await page.$(T('place-sheet-waiting')), null, '对方评了、我没评：不说「还没评」，直接给按钮');
    assert.ok(await page.$(T('place-sheet-write')), '我没评：有「给它评个级」');
    const visit = island('items').find((i) => i.place_id === SEAFOOD.id && i.day_id);
    const day = island('days').find((d) => d.id === visit.day_id);
    assert.equal(await page.$eval(T(`place-visit-${visit.id}`), (el) => el.getAttribute('href')), `#/t/demo-island/day/${day.date}?item=${visit.id}`);
    assert.match(await page.$eval(T('place-sheet-address'), (el) => el.textContent), /虚构地址/);
    assert.ok((await page.$$('.pls-link')).length >= 1, '有链接');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('sheet-place'));
    await page.screenshot({ path: path.join(SHOTS, 'place-large.png'), captureBeyondViewport: false });
    // 点「在行程里」的条目：去那一天并展开那一条，面板的历史被替换掉
    await sheetScrollTo(page, T(`place-visit-${visit.id}`));
    await page.click(T(`place-visit-${visit.id}`));
    await page.waitForFunction((d, id) => location.hash === `#/t/demo-island/day/${d}?item=${id}`, { timeout: 8000 }, day.date, visit.id);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地点详情：相关贴士（点了去贴士页）、两个人的评级（吃了什么带价格、照片点开大图）、平均档位', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${MARKET.id}` });
  const { page } = app;
  try {
    await waitPlaceSheet(page, MARKET.id);
    await largeSheet(page);
    assert.match(await page.$eval(`${T('place-sheet-reviews')} .pls-sec__meta`, (el) => el.textContent), /平均 夯/);
    const mine = await page.$eval(T('place-review-me'), (el) => el.textContent);
    assert.match(mine, /Jeremy（我）夯/);
    assert.match(mine, /约 HK\$/, '价格带折合港币');
    assert.ok(await page.$(T('place-sheet-edit-review')), '我评过：有「修改」');
    const tip = island('tips').find((t) => t.place_id === MARKET.id);
    await sheetScrollTo(page, T(`place-tip-${tip.id}`));
    assert.equal(await page.$eval(T(`place-tip-${tip.id}`), (el) => el.getAttribute('href')), `#/t/demo-island/tips?tip=${tip.id}`);
    await page.screenshot({ path: path.join(SHOTS, 'place-reviews.png'), captureBeyondViewport: false });
    // 照片：点开大图浏览（photo 弹层，带评级 id）
    await sheetScrollTo(page, `${T('place-review-me')} .pls-photo`);
    await page.click(`${T('place-review-me')} .pls-photo`);
    await page.waitForFunction(() => /sheet=.*photo:w\./.test(location.hash), { timeout: 6000 });
    app.assertClean({ allowErrors: [/photo/i] });
  } finally {
    await app.close();
  }
});

test('下车点：园中厨房的叫车提示、下车点能点过去；云屿开车到不了：「去缆车站」、大概位置', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${GARDEN.id}` });
  const { page } = app;
  try {
    await waitPlaceSheet(page, GARDEN.id);
    assert.match(await page.$eval(T('place-sheet-actions-note'), (el) => el.textContent), new RegExp(GARDEN.extra.ride_note.slice(0, 6)));
    await largeSheet(page);
    await sheetScrollTo(page, T('place-sheet-via'));
    const via = await page.$eval(T('place-sheet-via'), (el) => el.textContent);
    await page.click(T('place-sheet-via'));
    await page.waitForFunction((n) => document.querySelector('[data-testid="place-sheet-title"]')?.textContent === n, { timeout: 6000 }, via);
    // 云屿
    await app.go(`#/t/demo-island/places?sheet=place:${CLOUD.id}`);
    await waitPlaceSheet(page, CLOUD.id);
    assert.equal(await page.$eval(`${T('place-sheet-actions')} [data-action="grab"] .k-act__label`, (el) => el.textContent), '去缆车站');
    assert.ok(await page.$(T('place-sheet-approx')), '大概位置');
    await largeSheet(page);
    assert.match(await page.$eval(T('place-sheet-facts'), (el) => el.textContent), /开车到不了/);
    await page.screenshot({ path: path.join(SHOTS, 'place-noroad.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出发前的地点详情：还没去过，「给它评个级」是次要的浅色按钮（不抢动作行的风头）', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${SEAFOOD.id}`, now: BEFORE });
  const { page } = app;
  try {
    await waitPlaceSheet(page, SEAFOOD.id);
    await largeSheet(page);
    const cls = await page.$eval(T('place-sheet-write'), (el) => el.className);
    assert.match(cls, /btn--tinted/, cls);
    await page.screenshot({ path: path.join(SHOTS, 'place-upcoming.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('想去：地点详情里点一下收进想去清单（提示能撤销），想去清单里多了它', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${SEAFOOD.id}` });
  const { page } = app;
  try {
    await waitPlaceSheet(page, SEAFOOD.id);
    assert.equal(await page.$eval(T('place-sheet-wish'), (el) => el.getAttribute('aria-pressed')), 'false');
    await page.click(T('place-sheet-wish'));
    await page.waitForFunction(() => document.querySelector('[data-testid="place-sheet-wish"]').getAttribute('aria-pressed') === 'true');
    assert.match(await page.$eval('.ov-toast__message', (el) => el.textContent), /收进了想去清单/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.go('#/t/demo-island/places?by=want');
    await page.waitForSelector('[data-group="wish"]');
    assert.ok((await cardIds(page)).includes(SEAFOOD.id));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 写评级
// ---------------------------------------------------------------------

test('写评级：地点详情 →「给它评个级」→ 选「夯」（弹一下）、评语、吃了什么（45 →「千」→ 45,000₫）→ 保存转圈打勾 → 回到地点详情；刷新还在', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${SEAFOOD.id}` });
  const { page } = app;
  try {
    await waitPlaceSheet(page, SEAFOOD.id);
    await largeSheet(page);
    await sheetScrollTo(page, T('place-sheet-write'));
    await page.click(T('place-sheet-write'));
    await page.waitForSelector(T('review-form'));
    await waitForAnimationsDone(page, 6000);
    assert.match(await hash(page), new RegExp(`sheet=review:p\\.${SEAFOOD.id}`));
    assert.equal(await page.$eval('[data-testid="sheet-review"] .ov-sheet__title', (el) => el.textContent), SEAFOOD.name);
    assert.equal(await page.$eval(T('review-save'), (el) => el.disabled), true, '什么都没写不能保存');
    // 五档：选中弹一下（半路的缩放不是 1）
    const scale = () => {
      const t = getComputedStyle(document.querySelector('[data-testid="tier-5"] .rv-tier__face')).transform;
      return t === 'none' ? 1 : new DOMMatrix(t).a;
    };
    const cap = await captureAt(app, () => page.click(T('tier-5')), { selector: '.rv-tier__face', progress: 0.2, evaluate: scale });
    try {
      await page.screenshot({ path: path.join(MID, 'tier-pop-20.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    assert.ok(Math.abs(cap.state - 1) > 0.01, `选中的档位弹一下（半路缩放 ${cap.state}）`);
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.evaluate(scale), 1);
    assert.equal(await page.$eval(T('tier-5'), (el) => el.getAttribute('aria-checked')), 'true');
    assert.match(await page.$eval(T('review-tier-hint'), (el) => el.textContent), /好到离谱/);
    await page.click(T('review-notes'));
    await page.keyboard.type('石斑很鲜，价格合理。');
    const add = `${T('review-food-add')} input`;
    await page.$eval(add, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(add);
    await page.keyboard.type('清蒸石斑');
    await page.keyboard.press('Enter');
    await page.keyboard.type('椰子');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="review-food-entry"]').length === 2);
    const price = `${T('review-food-entry')} .rv-price__input`;
    await page.click(price);
    // 越南盾：数字键盘（打不出 k），45 → 提醒「太少了？」→ 点「千」→ 45,000（焦点还在输入框，键盘不收起）
    assert.equal(await page.$eval(price, (el) => el.inputMode), 'numeric');
    assert.equal(await page.$eval(T('review-price-k'), (el) => el.disabled), true, '还没填价格时「千」不能点');
    await page.keyboard.type('45');
    await sleep(200);
    assert.equal(await page.$(T('review-price-forgot')), null, '还在打字时不提醒「太少了」（不一闪一闪）');
    await page.click(T('review-price-k'));
    await page.waitForFunction(() => /45,000₫/.test(document.querySelector('.rv-price__preview')?.textContent || ''));
    assert.equal(await page.$eval(price, (el) => el.value), '45,000');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('rv-price__input')), true, '点「千」不抢输入框的焦点');
    // 第二样只打了 30 就离开输入框：提醒「30₫ 太少了？」，点一下改成 30,000
    const price2 = `${T('review-food-entry')}:nth-child(2) .rv-price__input`;
    await page.click(price2);
    await page.keyboard.type('30');
    await page.click(T('review-tier-hint'));
    await page.waitForSelector(`${T('review-food-entry')}:nth-child(2) ${T('review-price-forgot')}`);
    assert.match(await page.$eval(T('review-price-forgot'), (el) => el.textContent), /30₫.*太少了.*30,000₫/);
    await page.click(T('review-price-forgot'));
    await page.waitForFunction((sel) => document.querySelector(sel)?.value === '30,000', {}, price2);
    assert.equal(await page.$(T('review-price-forgot')), null, '改好以后提醒消失');
    await page.click(`${T('review-food-entry')} .rv-mini__tier--r4`);
    await waitForAnimationsDone(page, 4000);
    await page.screenshot({ path: path.join(SHOTS, 'review-filled.png'), captureBeyondViewport: false });
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('sheet-review'));
    // 保存：转圈 → 对勾 → 换回地点详情
    await page.click(T('review-save'));
    await page.waitForFunction(() => document.querySelector('[data-testid="review-save"]')?.dataset.state === 'success' || /sheet=place:/.test(location.hash), { timeout: 8000 });
    await page.waitForFunction((id) => location.hash.endsWith(`sheet=place:${id}`), { timeout: 8000 }, SEAFOOD.id);
    await waitPlaceSheet(page, SEAFOOD.id);
    await largeSheet(page);
    const me = await page.$eval(T('place-review-me'), (el) => el.textContent);
    assert.match(me, /夯/);
    assert.match(me, /石斑很鲜/);
    assert.match(me, /清蒸石斑.*45,000₫/);
    await page.screenshot({ path: path.join(SHOTS, 'review-saved-place.png'), captureBeyondViewport: false });
    // 刷新：评级还在（演示后台存在本机）；卡片上多了我的胶囊
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await page.reload();
    await page.waitForSelector(T(`place-${SEAFOOD.id}`));
    const rates = await page.$eval(T(`place-${SEAFOOD.id}`), (el) => [...el.querySelectorAll('.pl-rate')].map((r) => r.dataset.rating));
    assert.deepEqual(rates, ['5', '4']);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('写评级：已评过的打开就是我那条（档位、吃了什么填好）；改了没保存就关先问；删除我的评级（确认、可撤销）', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=review:p.${MARKET.id}` });
  const { page } = app;
  try {
    await page.waitForSelector(T('review-form'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(T('review-tiers'), (el) => el.dataset.value), '5');
    const mine = island('reviews').find((r) => r.place_id === MARKET.id && r.user_id === DB.users.find((u) => u.ref === 'jeremy').id);
    assert.equal((await page.$$(T('review-food-entry'))).length, mine.food_log.length);
    assert.equal((await page.$$(T('review-photo'))).length, mine.photos.length);
    assert.match(await page.$eval(T('review-save'), (el) => el.textContent), /保存修改/);
    // 改了：关的时候先问
    await page.click(T('tier-4'));
    await page.keyboard.press('Escape');
    await page.waitForSelector(T('dialog'));
    assert.match(await page.$eval(T('dialog'), (el) => el.textContent), /放弃/);
    await page.click(T('dialog-cancel'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="dialog"]'));
    assert.match(await hash(page), /sheet=review:/, '取消：面板还开着');
    // 删除
    await sheetScrollTo(page, T('review-delete'));
    await page.click(T('review-delete'));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !location.hash.includes('sheet=review'), { timeout: 8000 });
    await page.waitForFunction((id) => [...document.querySelectorAll(`[data-testid="place-${id}"] .pl-rate`)].length === 1, { timeout: 8000 }, MARKET.id);
    // 撤销（外壳接好的“已删除 · 撤销”）
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__action')].some((b) => b.textContent.includes('撤销')));
    await page.evaluate(() => [...document.querySelectorAll('.ov-toast__action')].find((b) => b.textContent.includes('撤销')).click());
    await page.waitForFunction((id) => [...document.querySelectorAll(`[data-testid="place-${id}"] .pl-rate`)].length === 2, { timeout: 8000 }, MARKET.id);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('写评级：离线也能保存（说明「联网后自动同步」），价格看不懂时标红不让存', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=review:p.${GARDEN.id}` });
  const { page } = app;
  try {
    await page.waitForSelector(T('review-form'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$(T('review-offline')), null);
    await page.setOfflineMode(true);
    await page.waitForSelector(T('review-offline'), { timeout: 5000 });
    await page.click(T('tier-3'));
    const add = `${T('review-food-add')} input`;
    await page.$eval(add, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(add);
    await page.keyboard.type('炒粉');
    await page.keyboard.press('Enter');
    await page.click(`${T('review-food-entry')} .rv-price__input`);
    await page.keyboard.type('好贵');
    await page.waitForSelector('.rv-log__error');
    await page.click(T('review-save'));
    await page.waitForSelector(T('review-error'));
    assert.match(await page.$eval(T('review-error'), (el) => el.textContent), /炒粉.*看不懂/);
    // 改对了再存
    await page.$eval(`${T('review-food-entry')} .rv-price__input`, (el) => el.select());
    await page.keyboard.type('60000');
    await sleep(2800);
    await page.click(T('review-save'));
    await page.waitForFunction(() => !location.hash.includes('sheet=review'), { timeout: 8000 });
    await page.waitForFunction((id) => [...document.querySelectorAll(`[data-testid="place-${id}"] .pl-rate`)].some((r) => r.dataset.rating === '3'), { timeout: 8000 }, GARDEN.id);
    await page.setOfflineMode(false);
    app.assertClean({ allowErrors: [/离线|offline|Failed to fetch|ERR_INTERNET_DISCONNECTED/i] });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 只读成员、空行程、尺寸、深色
// ---------------------------------------------------------------------

test('只读成员：想去、排进某天禁用并说明；评级照样能写（每人自己的）', async () => {
  const app = await openPlaces({ hash: '#/t/demo-island/places?by=day' });
  const { page } = app;
  try {
    // 先做一次改动，让演示后台把数据存进 IndexedDB；再把 Cathy 改成只读成员，以 Cathy 重新打开
    await page.$eval(T(`pool-${POOL.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${T(`pool-days-${POOL.id}`)} [data-day="${D3.id}"]`);
    await page.waitForSelector('.ov-toast__action');
    await page.click('.ov-toast__action');
    await sleep(1500);
    const ok = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('rs7885-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('kv', 'readwrite');
      const st = tx.objectStore('kv');
      const v = await new Promise((res) => {
        const r = st.get('demo:server');
        r.onsuccess = () => res(r.result);
      });
      if (!v) return false;
      v.tables.trip_members = v.tables.trip_members.map((m) => (m.trip_id === 'demo-island' && m.role === 'editor' ? { ...m, role: 'viewer' } : m));
      st.put(v, 'demo:server');
      await new Promise((r) => {
        tx.oncomplete = r;
      });
      db.close();
      return true;
    });
    assert.ok(ok, '演示后台的数据已经存进 IndexedDB');
    const url = new URL(page.url());
    url.searchParams.set('demouser', 'cathy');
    url.hash = '#/t/demo-island/places?by=day';
    await page.goto(url.href);
    await page.waitForSelector(T(`pool-${POOL.id}`), { timeout: 10000 });
    await app.idle();
    const disabled = await page.$$eval(`${T(`pool-days-${POOL.id}`)} button`, (els) => els.every((b) => b.disabled));
    assert.ok(disabled, '排进某天禁用');
    assert.match(await page.$eval(`${T(`pool-days-${POOL.id}`)} .pl-sched__note`, (el) => el.textContent), /只读成员/);
    await app.go(`#/t/demo-island/places?sheet=place:${SEAFOOD.id}`);
    await waitPlaceSheet(page, SEAFOOD.id);
    assert.equal(await page.$eval(T('place-sheet-wish'), (el) => el.getAttribute('aria-disabled')), 'true', '想去禁用');
    // 手机上没有悬停提示：点一下说明为什么不能改，数据不变
    await page.click(T('place-sheet-wish'));
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast')].some((t) => /只读成员不能改想去清单/.test(t.textContent)), { timeout: 4000 });
    assert.equal(await page.$eval(T('place-sheet-wish'), (el) => el.getAttribute('aria-pressed')), 'false', '想去没有被改');
    assert.equal(await page.$eval(`${T('place-sheet-actions')} [data-action="expense"]`, (el) => el.disabled), true, '记一笔禁用');
    await largeSheet(page);
    assert.ok(await page.$(T('place-sheet-edit-review')), 'Cathy 评过：能改自己的评级');
    await page.screenshot({ path: path.join(SHOTS, 'readonly.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空行程：没有地点时显示插图和「加行程条目」，不显示搜索和筛选', async () => {
  const app = await openPlaces({ hash: '#/t/demo-empty/places' });
  const { page } = app;
  try {
    await page.waitForSelector(T('places-empty'));
    assert.equal(await page.$(T('places-search')), null);
    assert.equal(await page.$('.plc'), null);
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-places'));
    await app.shot('empty', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出错 / 加载中 / 找不到 / 减弱动态效果：没网又没缓存说中文原因 + 重试；慢网先骨架；地点 id 不对时面板说找不到', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/places', now: DURING, search: { demonet: 'offline' } });
  try {
    await app.page.waitForSelector(T('places-error'), { timeout: 15000 });
    assert.match(await app.page.$eval(T('places-error'), (el) => el.textContent), /[一-鿿]/);
    assert.ok(await app.page.$(`${T('places-error')} button`), '有重试按钮');
    await app.shot('offline-error', { fullPage: false });
    app.assertClean({ allowErrors: [/离线|offline|Failed to fetch|ERR_INTERNET_DISCONNECTED|网络/i] });
  } finally {
    await app.close();
  }
  const slow = await openApp({ browser, server, hash: '#/t/demo-island/places', now: DURING, search: { demolatency: '1500' } });
  try {
    await slow.page.waitForSelector('[data-testid="page-places"] .reveal[data-loading] .plp-skel', { timeout: 8000 });
    await slow.shot('loading-skeleton', { fullPage: false });
    await slow.page.waitForSelector('.plc', { timeout: 15000 });
    slow.assertClean();
  } finally {
    await slow.close();
  }
  const bad = await openPlaces({ hash: '#/t/demo-island/places?sheet=place:00000000-0000-4000-8000-000000000000' });
  try {
    await bad.page.waitForSelector(T('place-sheet-missing'), { timeout: 8000 });
    assert.match(await bad.page.$eval(T('place-sheet-missing'), (el) => el.textContent), /找不到这个地点/);
    bad.assertClean();
  } finally {
    await bad.close();
  }
  // 减弱动态效果：换看法、列表 ↔ 网格照常能用（不做 FLIP，直接换）
  const rm = await openPlaces({ reducedMotion: true });
  try {
    await rm.page.click(T('places-view'));
    await rm.page.waitForSelector('.plp-list.vs--grid');
    await rm.page.evaluate(() => [...document.querySelectorAll('[data-testid="places-mode"] [role="radio"]')].find((b) => b.textContent.trim() === '评级').click());
    await rm.page.waitForFunction(() => /[?&]by=rating/.test(location.hash));
    await rm.page.waitForSelector('[data-group="tier:5"]');
    rm.assertClean();
  } finally {
    await rm.close();
  }
});

test('375 小屏、1280 桌面、深色、出发前、已结束的三城：不横向滚动、可点的 ≥44px；结束后的行程默认看评级', async () => {
  const cases = [
    { name: 'small', device: 'small' },
    { name: 'desktop', device: 'desktop', hash: '#/t/demo-island/places?view=grid' },
    { name: 'dark', colorScheme: 'dark' },
    { name: 'dark-grid', colorScheme: 'dark', hash: '#/t/demo-island/places?view=grid&by=day' },
    { name: 'upcoming', now: BEFORE },
    { name: 'cities', hash: '#/t/demo-cities/places', now: '2027-01-20T10:00:00+07:00' },
  ];
  for (const c of cases) {
    const { name, ...o } = c;
    const app = await openPlaces(o);
    const { page } = app;
    try {
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, T('page-places'));
      if (o.device === 'desktop') {
        const w = await page.$eval('.plp', (el) => el.getBoundingClientRect().width);
        assert.ok(w <= 720 + 1, `内容最大宽度 720（${w}）`);
      }
      if (name === 'upcoming') assert.equal(await page.$(T('places-nudge')), null, '出发前没有「去过还没评」');
      if (name === 'cities') assert.equal((await page.$$eval('[data-group]', (els) => els.map((e) => e.dataset.group)))[0], 'tier:5', '已结束：默认按评级');
      await app.shot(`page-${name}`, { fullPage: false });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('超长越南语地址、深色：地点详情不横向滚动，地址能整段复制', async () => {
  const app = await openPlaces({ hash: `#/t/demo-island/places?sheet=place:${LONG.id}`, colorScheme: 'dark' });
  const { page } = app;
  try {
    await waitPlaceSheet(page, LONG.id);
    await largeSheet(page);
    await sheetScrollTo(page, T('place-sheet-address'));
    await assertNoHorizontalOverflow(page);
    const box = await page.$eval(T('place-sheet-address'), (el) => {
      const r = el.getBoundingClientRect();
      const s = el.closest('.ov-sheet').getBoundingClientRect();
      return { right: r.right, sheet: s.right };
    });
    assert.ok(box.right <= box.sheet, '地址没有超出面板');
    await page.screenshot({ path: path.join(SHOTS, 'place-long-dark.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});
