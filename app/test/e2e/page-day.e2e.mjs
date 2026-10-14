// 每天页（pages/day）和条目弹层（sheets/item），演示数据：
//   四种条件（手机浅色 / 深色、375、1280）没有报错、不连外网、不横向滚动、触控区 ≥44；
//   出发前：页头的节奏 / 日落 / 住哪、路线卡的链接、已完成 / 跳过淡化、取舍说明能展开；
//   行程中：当前条目高亮、「现在」标记、进来自动滚到当前条目附近、每分钟的钟点；
//   原地展开（一次只开一张、标题行不跑、半路截图）、动作行（导航 / Grab 链接和 lib/ 一致、记一笔带预填）；
//   ?item= 展开并滚到那一条（含挂在主方案下的雨天方案）、步行路线的多点链接；
//   备选切换 → 换成主方案 → 撤销；标记完成（实际时间、实际情况）→ 恢复；
//   左右滑动换天（跟手提示、边缘不接、竖着滑不换）；空状态、已结束的行程；
//   条目弹层：新建（按钟点插进时间轴、选地点）、编辑、删除 → 撤销。
// 截图：<截图根目录>/__screenshots__/page-day/，半路图：__shots__/page-day/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { grabBookingUrl } from '../../src/lib/ride-links.js';
import { googleMapsNavigateUrl, googleMapsRouteUrls } from '../../src/lib/maps-links.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const ITEMS = island('items');
const PLACES = island('places');
const DAYS = island('days');
const itemByTitle = (t) => ITEMS.find((i) => i.title === t);
const placeById = (id) => PLACES.find((p) => p.id === id);
const dayDate = (id) => DAYS.find((d) => d.id === id)?.date;

const BREAKFAST = itemByTitle('早餐：椰子咖啡');
const DIVE = itemByTitle('半日浮潜');
const SCOOTER = itemByTitle('取电动车，出发西线');
const SCOOTER_ALT = itemByTitle('风大就去按摩');
const WALK = itemByTitle('老街步行：海神庙 → 老街 → 夜市');
const RAIN = itemByTitle('下雨改在海景屋餐厅');
const FISH = itemByTitle('鱼露作坊买手信');   // 地点有超长的越南语地址
const POOL_ALT = itemByTitle('太累就整个下午泡在酒店泳池');   // D2 当天通用的备选（没钟点）
const D2 = '2027-01-11';
const ONGOING = '2027-01-11T10:00:00+07:00';
const UPCOMING = '2027-01-08T09:00:00+07:00';
const ENDED = '2027-01-20T10:00:00+07:00';
const SHOTS = shotsDir('page-day');
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (page) => page.evaluate(() => location.hash);

/**
 * 关掉最上面的面板：等它挂好（出场动画期间按 Esc 不一定收得到），按 Esc；填过东西会问“放弃未保存的内容？”，答「放弃」
 * （确认框晚一点才出来，等它）；没反应就再按一次。
 */
async function closeSheet(page) {
  await page.waitForSelector('.ov-layer--sheet:not([inert])', { timeout: 5000 }).catch(() => {});
  await waitForAnimationsDone(page, 4000);
  const t0 = Date.now();
  let lastEsc = 0;
  while (Date.now() - t0 < 12000) {
    if (!(await page.evaluate(() => location.hash.includes('sheet=')))) return;
    if (await page.$('.ov-dialog:not([inert]) .ov-dialog__action')) {
      await clickButton(page, '.ov-dialog__action', '放弃');
      await sleep(200);
      continue;
    }
    if (Date.now() - lastEsc > 1500) {
      await page.keyboard.press('Escape');
      lastEsc = Date.now();
    }
    await sleep(100);
  }
  await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
}

/**
 * 等提示条消失（鼠标停在提示条上它的倒计时会暂停：puppeteer 点完按钮鼠标就停在那里，提示条正好盖住面板底部的按钮）：
 * 先把鼠标挪开，再等它走掉。
 */
async function clearToasts(page) {
  await page.mouse.move(4, 300);
  await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 9000 }).catch(() => {});
}

/** 先把元素滚到屏幕中间再点（页面底部的按钮会被固定的底栏 / 面板底部的提交按钮盖住，puppeteer 的 click 会点到盖着的东西） */
async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(60);
  await page.click(selector);
}

/** 点第一个文字是 text 的按钮；返回有没有点到 */
async function clickButton(page, selector, text) {
  for (const b of await page.$$(selector)) {
    if ((await b.evaluate((e) => e.textContent.trim())) === text) {
      await b.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await sleep(60);
      await b.click();
      return true;
    }
  }
  return false;
}

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

async function openDay(date, o = {}) {
  const app = await openApp({ browser, server, hash: `#/t/demo-island/day/${date}`, now: ONGOING, ...o });
  await app.page.waitForSelector(`${T('page-day')} ${T('day-head')}`, { timeout: 15000 });
  await app.idle();
  return app;
}

const header = (id) => `${T(`item-${id}`)} .xcard__header`;
const rect = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; });

async function expand(app, id) {
  await app.page.$eval(header(id), (el) => el.scrollIntoView({ block: 'center' }));
  await app.page.click(header(id));
  await app.page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', {}, header(id));
  await waitForAnimationsDone(app.page, 6000);
}

/** 用触屏横着滑（从 x1 到 x2，y 不变），每步 16ms */
async function swipe(page, x1, x2, y, { steps = 12, hold = 0 } = {}) {
  await page.touchscreen.touchStart(x1, y);
  for (let i = 1; i <= steps; i += 1) {
    await page.touchscreen.touchMove(x1 + ((x2 - x1) * i) / steps, y);
    await sleep(16);
  }
  if (hold) await sleep(hold);
  await page.touchscreen.touchEnd();
}

// ---------------------------------------------------------------------
// 四种条件
// ---------------------------------------------------------------------

for (const [label, o] of [['手机浅色', {}], ['手机深色', { colorScheme: 'dark' }], ['小屏 375', { device: 'small' }], ['桌面 1280', { device: 'desktop' }]]) {
  test(`每天页（${label}，行程中的今天）：没有报错、不连外网、不横向滚动、可点的东西 ≥44px`, async () => {
    const app = await openDay(D2, o);
    try {
      await assertNoHorizontalOverflow(app.page);
      await assertTapTargets(app.page);
      // 展开一张以后同样检查
      await expand(app, DIVE.id);
      await assertNoHorizontalOverflow(app.page);
      await assertTapTargets(app.page);
      await app.shot(`day-ongoing${o.colorScheme === 'dark' ? '-dark' : ''}`);
      // 超长的越南语地址（144 个字）：展开后照样不横向溢出，地址整段显示
      await expand(app, FISH.id);
      await assertNoHorizontalOverflow(app.page);
      const addr = await app.page.$eval(`${T(`item-${FISH.id}`)} [data-testid="tl-address"]`, (el) => el.textContent.trim());
      assert.equal(addr, placeById(FISH.place_id).address);
      // 收起时的标签在副标题那一行里（标题占满整行，长标题不会被挤成一个字一行）
      const layout = await app.page.$eval(T(`item-${DIVE.id}`), (el) => {
        const title = el.querySelector('.xcard__title').getBoundingClientRect();
        const text = el.querySelector('.xcard__text').getBoundingClientRect();
        const meta = el.querySelector('.xcard__meta')?.getBoundingClientRect();
        return { titleW: title.width, textW: text.width, metaBelowTitle: meta ? meta.top >= title.bottom - 1 : true };
      });
      assert.ok(layout.titleW >= layout.textW - 1, `标题占满文字列：${layout.titleW} / ${layout.textW}`);
      assert.equal(layout.metaBelowTitle, true, '标签不和标题抢宽度');
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('出发前的 D1：页头有节奏 / 日落 / 当晚住哪、天气提示；路线卡「打开路线」是数据里的链接；已完成 / 已跳过淡化并带标签；没有「现在」；取舍说明收着、点了展开', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/day/2027-01-10', now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T('day-head'));
    await app.idle();
    const head = await page.$eval(T('day-head'), (el) => ({
      eyebrow: el.querySelector('.day-head__eyebrow').textContent,
      title: el.querySelector('.day-head__title').textContent,
      chips: [...el.querySelectorAll('.day-chip')].map((c) => c.textContent.trim()),
      note: el.querySelector('[data-testid="day-weather-note"]')?.textContent,
    }));
    assert.match(head.eyebrow, /^D1 · 1月10日 周日$/);
    assert.ok(head.title.includes('落地'), head.title);
    assert.ok(head.chips.some((c) => c.startsWith('节奏')), JSON.stringify(head.chips));
    assert.ok(head.chips.some((c) => c.startsWith('日落')), JSON.stringify(head.chips));
    assert.ok(head.chips.some((c) => c.startsWith('住 ')), JSON.stringify(head.chips));
    assert.ok(head.note, '天气提示');
    const day1 = DAYS.find((d) => d.date === '2027-01-10');
    const link = await page.$eval(T('day-route-link-0'), (el) => el.getAttribute('href'));
    assert.equal(link, day1.route_plan.maps_url);
    assert.equal(await page.$(T('tl-now')), null, '出发前没有「现在」');
    const statuses = await page.$$eval('.tl__item', (els) => els.map((e) => [e.dataset.status, e.classList.contains('tl__item--dim'), e.querySelector('.xcard__meta')?.textContent || '']));
    assert.ok(statuses.some(([s, dim, meta]) => s === 'done' && dim && meta === '已完成'), JSON.stringify(statuses));
    assert.ok(statuses.some(([s, dim, meta]) => s === 'skipped' && dim && meta === '已跳过'), JSON.stringify(statuses));
    // 取舍说明
    assert.equal(await page.$eval(`${T('day-decisions')} .xcard__header`, (el) => el.getAttribute('aria-expanded')), 'false');
    await page.$eval(`${T('day-decisions')} .xcard__header`, (el) => el.scrollIntoView({ block: 'center' }));
    await tap(page, `${T('day-decisions')} .xcard__header`);
    await waitForAnimationsDone(page, 6000);
    const q = await page.$$eval(`${T('day-decisions')} .day-decision__q`, (els) => els.map((e) => e.textContent));
    assert.deepEqual(q, day1.decisions.map((d) => d.question));
    // 当天提醒：这一天的待办能勾
    const todo = await page.$(`${T('day-reminders')} .check__input`);
    assert.ok(todo, '当天提醒里有待办');
    await app.shot('day-upcoming-d1');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程中的今天 10:00：「半日浮潜」是当前条目（高亮、进行中标签、进度条），「现在」标在它旁边写 10:00；进来自动滚到它附近', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    const cur = await page.$eval(T(`item-${DIVE.id}`), (el) => ({
      current: el.hasAttribute('data-current'),
      meta: el.querySelector('.xcard__meta')?.textContent,
      progress: el.querySelector('.tl__progress')?.style.getPropertyValue('--tl-progress'),
      now: el.querySelector('[data-testid="tl-now"]')?.textContent,
    }));
    assert.equal(cur.current, true);
    assert.equal(cur.meta, '进行中');
    assert.ok(Number(cur.progress) > 0.4 && Number(cur.progress) < 0.5, `08:15–12:00 在 10:00 走了 ${cur.progress}`);
    assert.equal(cur.now, '10:00');
    assert.equal(await page.$$eval(T('tl-now'), (els) => els.length), 1, '只有一个「现在」');
    // 「现在」的钟点在开始 / 结束钟点下面，不压住它们（收起的卡片很矮时也一样）
    const stack = await page.$eval(T(`item-${DIVE.id}`), (el) => {
      const end = el.querySelector('.tl__time-end').getBoundingClientRect();
      const now = el.querySelector('[data-testid="tl-now"] b').getBoundingClientRect();
      const dot = getComputedStyle(el.querySelector('[data-testid="tl-now"]'), '::after');
      return { endBottom: end.bottom, nowTop: now.top, dotW: dot.width };
    });
    assert.ok(stack.nowTop >= stack.endBottom - 1, `「现在」在结束钟点下面：${stack.endBottom} → ${stack.nowTop}`);
    assert.equal(stack.dotW, '14px', '竖线上有圆点');
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 200, `自动滚到了当前条目附近：scrollY = ${y}`);
    const r = await rect(page, T(`item-${DIVE.id}`));
    assert.ok(r.top > 60 && r.top < 844 * 0.6, `当前条目在屏幕上方：top = ${r.top}`);
    await page.screenshot({ path: path.join(SHOTS, 'now-marker.png'), captureBeyondViewport: false });
    // 刷新回来（同一条历史）不再抢滚动：先滚到顶再刷新
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await page.waitForSelector(T('day-head'));
    await app.idle();
    await sleep(300);
    assert.ok((await page.evaluate(() => window.scrollY)) < 10, '刷新回来不再自动滚（路由恢复位置）');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程中的明天 / 昨天：没有「现在」；回到今天页头写「今天」', async () => {
  const app = await openDay('2027-01-12');
  try {
    assert.equal(await app.page.$(T('tl-now')), null);
    assert.match(await app.page.$eval('.day-head__eyebrow', (el) => el.textContent), /明天$/);
    await app.go(`#/t/demo-island/day/${D2}`);
    await app.page.waitForFunction(() => document.querySelector('.day-head__eyebrow')?.textContent.endsWith('今天'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('原地展开：点一张展开、再点另一张时前一张收起（一次只开一张）、被点的标题行不跑；半路截图里详情区正在长高', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    // 先展开早餐
    await page.$eval(header(BREAKFAST.id), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    const before = await rect(page, header(BREAKFAST.id));
    const mid = await captureAt(app, () => page.click(header(BREAKFAST.id)), {
      selector: '.xcard__body',
      progress: 0.25,
      evaluate: () => {
        const li = document.querySelector('.tl__item .xcard__header[aria-expanded="true"]')?.closest('.tl__item');
        const body = li?.querySelector('.xcard__body');
        const content = li?.querySelector('.xcard__content');
        return body ? { rows: getComputedStyle(body).gridTemplateRows, full: content?.offsetHeight ?? 0 } : null;
      },
    });
    await page.screenshot({ path: path.join(SHOTS, 'expand-25.png'), captureBeyondViewport: false });
    await release(mid);
    assert.ok(mid.state, '半路读到了详情区');
    const rows = parseFloat(mid.state.rows);
    assert.ok(rows > 0 && rows < mid.state.full - 4, `半路详情区正在长高（介于 0 和 ${mid.state.full} 之间）：${mid.state.rows}`);
    await waitForAnimationsDone(page, 6000);
    const after = await rect(page, header(BREAKFAST.id));
    assert.ok(Math.abs(after.top - before.top) < 2, `标题行不跑：${before.top} → ${after.top}`);
    assert.equal(await page.$eval(header(BREAKFAST.id), (el) => el.getAttribute('aria-expanded')), 'true');
    await page.screenshot({ path: path.join(SHOTS, 'expand-end.png'), captureBeyondViewport: false });

    // 再点浮潜：早餐收起、浮潜展开
    await expand(app, DIVE.id);
    assert.equal(await page.$eval(header(BREAKFAST.id), (el) => el.getAttribute('aria-expanded')), 'false');
    const open = await page.$$eval('.tl__item .xcard__header[aria-expanded="true"]', (els) => els.length);
    assert.equal(open, 1);
    // 展开后的内容：说明、怎么过去、费用、动作行
    const body = await page.$eval(T(`item-${DIVE.id}`), (el) => ({
      transport: Boolean(el.querySelector('[data-testid="tl-transport"]')),
      cost: el.querySelector('[data-testid="tl-cost"]')?.textContent || '',
      acts: [...el.querySelectorAll('.k-act')].map((a) => a.textContent.trim()),
      more: [...el.querySelectorAll('.tl-act')].map((a) => a.textContent.trim()),
      booking: Boolean(el.querySelector('[data-testid="tl-booking"]')),
      done: Boolean(el.querySelector(`[data-testid="tl-done-${el.dataset.itemId}"]`)),
    }));
    assert.equal(body.transport, true);
    assert.ok(body.booking, '浮潜有关联预订（价格看预订，费用估算不重复写）');
    // 动作行一排四个（样稿 04）；「复制地址」挪到地址那一行（点地址就复制），「评级」在下面一排（视觉评审 P2-13、现场走查 P2-10）
    assert.deepEqual(body.acts, ['导航', '叫 Grab', '给司机看', '记一笔']);
    assert.deepEqual(body.more, ['打卡', '写日记', '评级', '编辑']);
    const actRows = await page.$eval(T(`item-${DIVE.id}`), (el) => new Set([...el.querySelectorAll('.k-act')].map((a) => Math.round(a.getBoundingClientRect().top))).size);
    assert.equal(actRows, 1, '动作行一排放下');
    assert.equal(body.done, true);
    await assertTapTargets(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('动作行：导航 / 叫 Grab 的链接和 lib/ 一致（步行到的条目导航按步行）；「记一笔」打开记一笔面板并预填这一条', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await expand(app, DIVE.id);
    const place = placeById(DIVE.place_id);
    const links = await page.$eval(T(`item-actions-${DIVE.id}`), (el) => Object.fromEntries([...el.querySelectorAll('.k-act')].map((a) => [a.dataset.action, a.getAttribute('href')])));
    assert.equal(links.nav, googleMapsNavigateUrl(place, { mode: 'walk' }), '步行过去 → 导航按步行');
    assert.equal(links.grab, grabBookingUrl(place, { getPlace: placeById }));
    await tap(page, `${T(`item-actions-${DIVE.id}`)} [data-action="expense"]`);
    await page.waitForFunction((id) => location.hash.includes(`sheet=expense:i.${id}`), {}, DIVE.id);
    assert.match(await hash(page), /sheet=expense:i\.[0-9a-f-]+/);
    await closeSheet(page);
    await app.idle();
    // 编辑：打开条目弹层
    await tap(page, T(`tl-edit-${DIVE.id}`));
    await page.waitForFunction((id) => location.hash.endsWith(`sheet=item:${id}`), {}, DIVE.id);
    await page.waitForSelector(T('item-form'));
    assert.equal(await page.$eval(T('item-title'), (el) => el.value), DIVE.title);
    assert.equal(await page.$eval(`${T('sheet-item')} .ov-sheet__title`, (el) => el.textContent), '编辑条目');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('?item=：从搜索结果跳进来时滚到并展开那一条；步行路线有多点 Google 地图链接；挂在主方案下的雨天方案 → 展开主方案并切到它', async () => {
  const app = await openApp({ browser, server, hash: `#/t/demo-island/day/${dayDate(WALK.day_id)}?item=${WALK.id}`, now: ONGOING });
  const { page } = app;
  try {
    await page.waitForSelector(T('day-head'));
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', {}, header(WALK.id));
    await waitForAnimationsDone(page, 6000);
    await sleep(400);
    const r = await rect(page, T(`item-${WALK.id}`));
    assert.ok(r.top >= 40 && r.top < 844 * 0.5, `滚到了那一条：top = ${r.top}`);
    const stops = WALK.stops.map((s) => placeById(s.place_id) || s.name);
    const expected = googleMapsRouteUrls(stops, { mode: 'walk' });
    const got = await page.$$eval(`${T(`item-${WALK.id}`)} [data-testid^="tl-walk-link-"]`, (els) => els.map((a) => a.getAttribute('href')));
    assert.deepEqual(got, expected.map((u) => u.url));
    assert.equal(await page.$$eval(`${T(`item-${WALK.id}`)} .tl-stop`, (els) => els.length), WALK.stops.length);
    await app.shot('item-focus-walk');

    // 雨天方案
    await app.go(`#/t/demo-island/day/${dayDate(RAIN.day_id)}?item=${RAIN.id}`);
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', {}, header(RAIN.parent_item_id));
    await page.waitForSelector(T(`tl-alt-${RAIN.id}`));
    await waitForAnimationsDone(page, 6000);
    const alt = await page.$eval(T(`tl-alt-${RAIN.id}`), (el) => el.querySelector('.tl-alt__h').textContent);
    assert.ok(alt.includes(RAIN.title) && alt.includes('雨天方案'), alt);
    await app.shot('item-focus-rain');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('备选切换：「取电动车」下有备选 → 小切换显示备选内容 → 换成主方案（进时间轴、原来的变成它的备选）→ Toast 撤销换回去', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await expand(app, SCOOTER.id);
    const seg = `${T(`tl-alts-${SCOOTER.id}`)} .seg__item`;
    const labels = await page.$$eval(seg, (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels, ['主方案', '备选']);
    await clickButton(page, seg, '备选');
    await page.waitForSelector(T(`tl-alt-${SCOOTER_ALT.id}`));
    await waitForAnimationsDone(page, 6000);
    await page.screenshot({ path: path.join(SHOTS, 'alt-switch.png'), captureBeyondViewport: false });
    const before = await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => e.dataset.itemId));
    assert.ok(!before.includes(SCOOTER_ALT.id));
    await tap(page, T(`tl-promote-${SCOOTER_ALT.id}`));
    await page.waitForSelector(`.tl:not(.tl--general) ${T(`item-${SCOOTER_ALT.id}`)}`, { timeout: 5000 });
    await waitForAnimationsDone(page, 6000);
    const after = await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => e.dataset.itemId));
    assert.equal(after.indexOf(SCOOTER_ALT.id), before.indexOf(SCOOTER.id), '备选接替了主方案的位置');
    assert.ok(!after.includes(SCOOTER.id), '原来的主方案不在时间轴里了');
    const time = await page.$eval(`${T(`item-${SCOOTER_ALT.id}`)} .tl__time-main`, (el) => el.textContent);
    assert.equal(time, '14:45', '没写钟点的备选接过主方案的钟点');
    // 新的主方案展开着、它下面有「备选」= 原来的主方案
    assert.equal(await page.$eval(header(SCOOTER_ALT.id), (el) => el.getAttribute('aria-expanded')), 'true');
    const labels2 = await page.$$eval(`${T(`tl-alts-${SCOOTER_ALT.id}`)} .seg__item`, (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels2, ['主方案', '备选']);
    // 撤销
    await page.waitForSelector('.ov-toast__action', { timeout: 5000 });
    const undoText = await page.$$eval('.ov-toast__action', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(undoText.includes('撤销'), JSON.stringify(undoText));
    await clickButton(page, '.ov-toast__action', '撤销');
    await page.waitForSelector(`.tl:not(.tl--general) ${T(`item-${SCOOTER.id}`)}`, { timeout: 5000 });
    const restored = await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => e.dataset.itemId));
    assert.deepEqual(restored, before, '撤销后顺序和原来一样');
    // 当天通用的备选（时间轴后面那一组）：展开 → 换成主方案 → 没钟点就排到时间轴最后 → 撤销回到备选组
    // （先等刚才的「撤销」提示条走掉：这一组在页面最底下，按钮没法滚到屏幕中间，提示条会盖住它）
    await clearToasts(page);
    assert.ok(await page.$(`.tl--general ${T(`item-${POOL_ALT.id}`)}`), '通用备选在「当天备选」那一组里');
    await expand(app, POOL_ALT.id);
    await tap(page, T(`tl-promote-${POOL_ALT.id}`));
    await page.waitForSelector(`.tl:not(.tl--general) ${T(`item-${POOL_ALT.id}`)}`, { timeout: 5000 });
    const promoted = await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => e.dataset.itemId));
    assert.equal(promoted[promoted.length - 1], POOL_ALT.id, '没钟点的通用备选排到最后');
    assert.equal(await page.$(`.tl--general ${T(`item-${POOL_ALT.id}`)}`), null);
    await page.waitForSelector('.ov-toast__action', { timeout: 5000 });
    await clickButton(page, '.ov-toast__action', '撤销');
    await page.waitForSelector(`.tl--general ${T(`item-${POOL_ALT.id}`)}`, { timeout: 5000 });
    assert.deepEqual(await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => e.dataset.itemId)), before);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('标记完成（行程中）：点「完成」出小表单，实际时间默认是现在 10:00，填实际情况 → 对勾 → 标签变「已完成」、淡化、记下实际情况；「恢复为计划中」改回来', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await expand(app, BREAKFAST.id);
    await tap(page, T(`tl-done-${BREAKFAST.id}`));
    await page.waitForSelector(T('tl-status-form'));
    assert.equal(await page.$eval(T('tl-status-time'), (el) => el.value), '10:00');
    await page.type(T('tl-status-note'), '咖啡很香');
    await page.screenshot({ path: path.join(SHOTS, 'status-form.png'), captureBeyondViewport: false });
    await tap(page, T('tl-status-submit'));
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.status === 'done', {}, T(`item-${BREAKFAST.id}`));
    await waitForAnimationsDone(page, 6000);
    const st = await page.$eval(T(`item-${BREAKFAST.id}`), (el) => ({
      dim: el.classList.contains('tl__item--dim'),
      meta: el.querySelector('.xcard__meta')?.textContent,
      actual: el.querySelector('[data-testid="tl-actual"]')?.textContent,
      form: Boolean(el.querySelector('[data-testid="tl-status-form"]')),
    }));
    assert.equal(st.dim, true);
    assert.equal(st.meta, '已完成');
    assert.equal(st.actual, '实际 10:00 开始 · 咖啡很香');
    assert.equal(st.form, false, '对勾描完表单收起');
    await tap(page, T(`tl-revert-${BREAKFAST.id}`));
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.status === 'planned', {}, T(`item-${BREAKFAST.id}`));
    assert.equal(await page.$(`${T(`item-${BREAKFAST.id}`)} [data-testid="tl-actual"]`), null);
    // 跳过：只填原因
    await tap(page, T(`tl-skip-${BREAKFAST.id}`));
    await page.waitForSelector(T('tl-status-form'));
    assert.equal(await page.$(T('tl-status-time')), null, '跳过不用填时间');
    await tap(page, T('tl-status-submit'));
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.status === 'skipped', {}, T(`item-${BREAKFAST.id}`));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('左右滑动换天：往左滑到 D3（半路有提示）、往右滑回 D2；从屏幕边缘开始的不接；竖着滑是滚动不换天；第一天往右滑回概览', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    // 半路：提示出现、内容跟手
    await page.touchscreen.touchStart(300, 500);
    for (let i = 1; i <= 8; i += 1) {
      await page.touchscreen.touchMove(300 - i * 20, 500);
      await sleep(16);
    }
    await page.waitForSelector(T('day-swipe-hint'));
    const hint = await page.$eval(T('day-swipe-hint'), (el) => ({ text: el.textContent, armed: el.hasAttribute('data-armed'), dir: el.className }));
    assert.ok(hint.text.startsWith('D3'), hint.text);
    assert.ok(hint.dir.includes('--next'));
    assert.equal(hint.armed, true, '拖过 96px 提示变成强调色');
    const tx = await page.$eval(T('page-day'), (el) => el.style.transform);
    assert.match(tx, /translate3d\(-\d/, `内容跟手：${tx}`);
    await page.screenshot({ path: path.join(SHOTS, 'swipe-mid.png'), captureBeyondViewport: false });
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-12', { timeout: 5000 });
    await page.waitForSelector(T('day-head'));
    await app.idle();
    assert.equal(await page.$eval(T('day-strip-2027-01-12'), (el) => el.getAttribute('aria-current')), 'page', '分段条跟着换');
    // 往右滑回 D2
    await swipe(page, 80, 300, 500);
    await page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-11', { timeout: 5000 });
    await app.idle();
    // 边缘开始：不接
    await swipe(page, 10, 250, 500);
    await sleep(400);
    assert.equal(await hash(page), '#/t/demo-island/day/2027-01-11');
    // 竖着滑：滚动
    const y0 = await page.evaluate(() => window.scrollY);
    await page.touchscreen.touchStart(200, 600);
    for (let i = 1; i <= 10; i += 1) {
      await page.touchscreen.touchMove(200 - i * 2, 600 - i * 30);
      await sleep(16);
    }
    await page.touchscreen.touchEnd();
    await sleep(400);
    assert.equal(await hash(page), '#/t/demo-island/day/2027-01-11');
    assert.ok((await page.evaluate(() => window.scrollY)) > y0, '竖着滑页面滚了');
    assert.equal(await page.$(T('day-swipe-hint')), null);
    // 小一点的位移：弹回、不换
    await swipe(page, 300, 260, 500);
    await app.idle();
    await sleep(300);
    assert.equal(await hash(page), '#/t/demo-island/day/2027-01-11');
    assert.equal(await page.$eval(T('page-day'), (el) => el.style.transform || ''), '', '弹回后没有残留的内联样式');
    // 第一天往右 → 概览
    await app.go('#/t/demo-island/day/2027-01-10');
    await page.waitForSelector(T('day-head'));
    await app.idle();
    await swipe(page, 80, 320, 500);
    await page.waitForFunction(() => location.hash === '#/t/demo-island', { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减弱动态效果：页面照常、滑动照样能换天（只有提示、内容不跟手）', async () => {
  const app = await openDay(D2, { reducedMotion: true });
  const { page } = app;
  try {
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await swipe(page, 300, 100, 500);
    await page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-12', { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空状态：山雾镇的一天没有条目 → 空状态和「加第一条」；已结束的三城某一天：没有「现在」、完成的条目淡化；不在行程里的日期', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-empty/day/2027-04-03', now: ONGOING });
  const { page } = app;
  try {
    await page.waitForSelector(T('day-empty'));
    assert.ok(await page.$(T('day-empty-add')));
    await assertTapTargets(page);
    await app.shot('day-empty');
    await tap(page, T('day-empty-add'));
    await page.waitForFunction(() => location.hash.includes('sheet=item:d.2027-04-03'));
    await page.waitForSelector(T('item-form'));
    assert.equal(await page.$eval(T('item-day'), (el) => el.selectedOptions[0].textContent), 'D1 · 4月3日 周六');
    await closeSheet(page);

    await app.go('#/t/demo-cities/day/2026-03-15');
    await page.waitForSelector(T('day-head'));
    await app.idle();
    assert.equal(await page.$eval(T('page-day'), (el) => el.dataset.phase), 'ended');
    assert.equal(await page.$(T('tl-now')), null);
    assert.ok((await page.$$('.tl__item--dim')).length > 0, '已结束：完成的条目淡化');
    await assertNoHorizontalOverflow(page);
    await app.shot('day-ended-cities');

    await app.go('#/t/demo-island/day/2027-02-01');
    await page.waitForSelector(T('day-not-in-trip'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('条目弹层：加一条（标题、钟点、种类、选地点）→ 提交转圈打勾 → 按钟点插进时间轴；编辑标题；删除 → 撤销回来', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await tap(page, T('day-add'));
    await page.waitForFunction(() => location.hash.includes('sheet=item:'));
    await page.waitForSelector(T('item-form'));
    assert.equal(await page.$eval(`${T('sheet-item')} .ov-sheet__title`, (el) => el.textContent), '加条目');
    assert.equal(await page.$eval(T('item-day'), (el) => el.selectedOptions[0].textContent), 'D2 · 1月11日 周一 · 浮潜 + 西线环岛');
    await page.type(T('item-title'), '码头看渔船');
    await page.$eval(T('item-start'), (el) => { el.value = '09:40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await tap(page, `${T('item-kinds')} [data-kind="sight"]`);
    // 选地点：搜不带声调的越南语也行
    await tap(page, T('item-place-toggle'));
    await page.waitForSelector(T('item-place-search'));
    await page.type(T('item-place-search'), '码头');
    const first = await page.waitForSelector(`${T('item-place-panel')} [data-testid^="item-place-opt-"]`);
    const pickedName = await first.evaluate((el) => el.querySelector('b').textContent);
    await first.click();
    assert.equal(await page.$eval('.item-place__name', (el) => el.textContent), pickedName);
    // 换成新建一个只有名字的地点（保存时一起写进 places）
    await tap(page, T('item-place-toggle'));
    await page.waitForSelector(T('item-place-search'));
    await page.type(T('item-place-search'), '码头边的椰子摊');
    await page.waitForSelector(T('item-place-new'));
    await tap(page, T('item-place-new'));
    assert.equal(await page.$eval('.item-place__name', (el) => el.textContent), '码头边的椰子摊（新地点）');
    await page.screenshot({ path: path.join(SHOTS, 'item-form.png'), captureBeyondViewport: false });
    await page.click(T('item-submit'));
    await sleep(160);
    assert.equal(await page.$eval(T('item-submit'), (el) => el.dataset.state), 'loading', '提交中转圈');
    await page.screenshot({ path: path.join(SHOTS, 'item-submit-loading.png'), captureBeyondViewport: false });
    await page.waitForFunction(() => document.querySelector('[data-testid="item-submit"]')?.dataset.state === 'success', { timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, 'item-submit-done.png'), captureBeyondViewport: false });
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    const order = await page.$$eval('.tl:not(.tl--general) .tl__item', (els) => els.map((e) => [e.querySelector('.tl__time-main')?.textContent, e.querySelector('.xcard__title').textContent.replace(/^.*?，/, '')]));
    const idx = order.findIndex(([, t]) => t === '码头看渔船');
    assert.ok(idx > 0, JSON.stringify(order));
    assert.equal(order[idx][0], '09:40');
    assert.equal(order[idx - 1][1], DIVE.title, '插在 08:15 的浮潜后面');
    assert.equal(order[idx + 1][0], '13:00');
    const sub = await page.$$eval('.tl:not(.tl--general) .tl__item', (els, title) => els.find((e) => e.querySelector('.xcard__title').textContent.includes(title))?.querySelector('.xcard__subtitle').textContent, '码头看渔船');
    assert.ok(sub.includes('码头边的椰子摊'), `新建的地点写进了 places、副标题里显示：${sub}`);
    const newId = await page.$$eval('.tl:not(.tl--general) .tl__item', (els, title) => els.find((e) => e.querySelector('.xcard__title').textContent.includes(title))?.dataset.itemId, '码头看渔船');
    assert.ok(newId);
    // 编辑
    await app.go(`#/t/demo-island/day/${D2}?sheet=item:${newId}`);
    await page.waitForSelector(T('item-form'));
    await page.waitForFunction(() => document.querySelector('[data-testid="item-title"]')?.value === '码头看渔船');
    await page.$eval(T('item-title'), (el) => { el.focus(); el.select(); });
    await page.type(T('item-title'), '码头看渔船靠岸');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await page.waitForFunction((id) => document.querySelector(`[data-testid="item-${id}"] .xcard__title`)?.textContent.includes('码头看渔船靠岸'), {}, newId);
    // 填了一半关掉要确认
    await app.go(`#/t/demo-island/day/${D2}?sheet=item:${newId}`);
    await page.waitForSelector(T('item-form'));
    await page.waitForFunction(() => document.querySelector('[data-testid="item-title"]')?.value.includes('靠岸'));
    await page.type(T('item-title'), '，拍照');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov-dialog', { timeout: 4000 });
    await page.screenshot({ path: path.join(SHOTS, 'item-discard.png'), captureBeyondViewport: false });
    assert.equal(await page.$eval('.ov-dialog__title', (el) => el.textContent), '放弃未保存的内容？');
    await clickButton(page, '.ov-dialog__action', '放弃');
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    // 删除 → 撤销（先等「已保存」的提示条走掉：它浮在面板上面，正好盖住底部的删除按钮）
    await app.go(`#/t/demo-island/day/${D2}?sheet=item:${newId}`);
    await page.waitForSelector(T('item-delete'));
    await clearToasts(page);
    await tap(page, T('item-delete'));
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="item-${id}"]`) && !location.hash.includes('sheet='), {}, newId);
    await page.waitForSelector('.ov-toast__action', { timeout: 5000 });
    assert.ok(await clickButton(page, '.ov-toast__action', '撤销'), '有「撤销」');
    await page.waitForSelector(T(`item-${newId}`), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('条目弹层：备选挂到某条主方案下、放进备选池；只填结束时间会提示', async () => {
  const app = await openDay(D2);
  const { page } = app;
  try {
    await app.go(`#/t/demo-island/day/${D2}?sheet=item:d.${D2}~r.${DIVE.id}~v.rain`);
    await page.waitForSelector(T('item-form'));
    assert.equal(await page.$eval(`${T('item-field-variant')} .seg__item[aria-checked="true"]`, (el) => el.textContent.trim()), '雨天方案');
    assert.equal(await page.$eval(T('item-parent'), (el) => el.value), DIVE.id);
    await page.type(T('item-title'), '下雨就去泡温泉');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await expand(app, DIVE.id);
    const labels = await page.$$eval(`${T(`tl-alts-${DIVE.id}`)} .seg__item`, (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels, ['主方案', '备选', '雨天方案']);
    // 备选池 + 校验
    await app.go(`#/t/demo-island/day/${D2}?sheet=item`);
    await page.waitForSelector(T('item-form'));
    await page.select(T('item-day'), 'pool');
    await page.$eval(T('item-start'), (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click(T('item-submit'));
    await page.waitForSelector(T('item-error'));
    assert.equal(await page.$eval(T('item-error'), (el) => el.textContent), '请写一个标题');
    await page.type(T('item-title'), '以后再说的事');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.go('#/t/demo-island');
    await page.waitForFunction(() => location.hash === '#/t/demo-island');
    app.assertClean();
  } finally {
    await app.close();
  }
});
