// 页面阶段四份评审修改后的回归（演示数据，虚构）：
//   时区：出发当天人还在香港——概览有去程航班卡、「现在」小标签写香港时间（现场走查 P0-1 / P1-3）；
//   误触：每天页误双击不会打开 Grab、标题行不跑（交互 P1-1）；列表页误双击面板不会被关掉（交互 P1-2）；
//         清单连着勾下一行不会被挤开（交互 P1-3）；
//   撤销：概览勾掉待办、点「完成」都能撤销（现场走查 P1-5 / P2-8）；
//   两台手机同时改：面板开着时对方勾上的「已完成」保存后还在（代码 P1-1）；
//   只读成员：＋ 面板的记一笔 / 加条目 / 加待办变淡、写原因（视觉 P1-4 / 代码 P2-2）；
//   每天页加条目：新的一条在面板收回以后淡入、高亮（半路图，交互 P2-2）；左右滑的提示贴着视口边缘（交互 P2-4）。
// 截图：<截图根目录>/__shots__/page-fix-pages/。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, shotsDir } from './lib/harness.mjs';
import { waitForAnimationsDone, withPlaybackRate } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const ITEMS = island('items');
const DAYS = island('days');
const TODOS = island('todos');
const PLACES = island('places');
const CATHY = DB.users.find((u) => u.ref === 'cathy').id;
const D2 = DAYS.find((d) => d.date === '2027-01-11');
const D2_PRIMARY = ITEMS.filter((i) => i.day_id === D2.id && i.variant === 'primary' && !i.deleted_at)
  .sort((a, b) => String(a.sort_key).localeCompare(String(b.sort_key), 'en', { numeric: true }));
const DIVE = ITEMS.find((i) => i.title === '半日浮潜');

const ONGOING = '2027-01-11T10:00:00+07:00';
const UPCOMING = '2027-01-08T09:00:00+07:00';
// 出发当天、去程（香港 08:05 起飞）还没起飞：香港 07:00
const DEPARTURE_MORNING = '2027-01-10T07:00:00+08:00';
const SHOTS = shotsDir('page-fix-pages');
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let server;
before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = await startStaticServer();
  browser = await launchChrome();
});
after(async () => {
  await browser?.close().catch(() => {});
  await server?.close();
});

const open = (hash, o = {}) => openApp({ browser, server, hash, ...o });
const screen = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
const top = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().top);

// ---------------------------------------------------------------------
// 时区：出发当天人还在香港
// ---------------------------------------------------------------------

test('出发当天（香港 07:00，去程还没起飞）：概览有去程航班卡「距离起飞还有」；每天页「现在」写香港时间', async () => {
  const app = await open('#/t/demo-island', { now: DEPARTURE_MORNING });
  const { page } = app;
  try {
    await page.waitForSelector(T('ov-now'), { timeout: 15000 });
    await page.waitForSelector(T('ov-out-flight'), { timeout: 8000 });
    const order = await page.$$eval('.ov > [data-testid]', (els) => els.map((e) => e.dataset.testid));
    assert.ok(order.indexOf('ov-out-flight') === order.indexOf('ov-now') + 1, `去程航班卡紧跟「现在」：${order.join(', ')}`);
    assert.match(await page.$eval(T('ov-flight-left'), (el) => el.textContent), /距离起飞还有 1 小时 5 分/);
    assert.match(await page.$eval(T('ov-out-flight'), (el) => el.textContent), /08:05/, '起飞按起飞地（香港）的钟点');
    await screen(page, 'departure-overview');
    await assertNoHorizontalOverflow(page);

    await app.go('#/t/demo-island/day/2027-01-10');
    await page.waitForSelector(T('tl-now-zone'), { timeout: 8000 });
    assert.match(await page.$eval(T('tl-now-zone'), (el) => el.textContent), /香港时间/);
    assert.match(await page.$eval('.tl__now .tl__time--now', (el) => el.textContent), /^07:00$/, '「现在」按人此刻所在的香港钟点');
    await screen(page, 'departure-day-now');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 误触
// ---------------------------------------------------------------------

test('每天页：上一张开着时快速点两下下一张——不会点进刚展开的动作行（不打开 Grab），标题行不跑', async () => {
  const app = await open(`#/t/demo-island/day/${D2.date}`, { now: ONGOING });
  const { page } = app;
  try {
    const i = D2_PRIMARY.findIndex((x) => x.id === DIVE.id);
    const next = D2_PRIMARY[i + 1];
    assert.ok(next, '浮潜后面还有一条');
    const head = (id) => `${T(`item-${id}`)} .xcard__header`;
    await page.waitForSelector(head(DIVE.id), { timeout: 15000 });
    await page.$eval(head(DIVE.id), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(head(DIVE.id));
    await waitForAnimationsDone(page, 6000);
    await page.$eval(head(next.id), (el) => el.scrollIntoView({ block: 'center' }));
    await waitForAnimationsDone(page, 2000);
    const before = await top(page, head(next.id));
    const box = await page.$eval(head(next.id), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 24 }; });
    await page.touchscreen.tap(box.x, box.y);
    await sleep(85);
    await page.touchscreen.tap(box.x, box.y);
    await sleep(120);
    const mid = await top(page, head(next.id));
    await waitForAnimationsDone(page, 6000);
    await sleep(200);
    const end = await top(page, head(next.id));
    assert.ok(Math.abs(mid - before) <= 2 && Math.abs(end - before) <= 2, `标题行待在手指下面：${before} → ${mid} → ${end}`);
    assert.ok(!app.external.some((u) => /grab|google/i.test(u)), `没有跳去 Grab / 地图：${app.external.join(', ')}`);
    assert.match(await page.evaluate(() => location.hash), /\/day\//, '还在每天页');
    await screen(page, 'day-double-tap');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('地点页：误双击卡片，刚升起的面板不会被第二下关掉', async () => {
  const app = await open('#/t/demo-island/places', { now: UPCOMING });
  const { page } = app;
  try {
    const place = PLACES.find((p) => !p.deleted_at && p.lat);
    const card = T(`place-${place.id}`);
    await page.waitForSelector(card, { timeout: 15000 });
    await page.$eval(card, (el) => el.scrollIntoView({ block: 'center' }));
    await waitForAnimationsDone(page, 2000);
    const box = await page.$eval(card, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(box.x, box.y);
    await sleep(180);
    await page.touchscreen.tap(box.x, box.y);
    await sleep(900);
    assert.match(await page.evaluate(() => location.hash), /sheet=place/, '面板还开着');
    await screen(page, 'places-double-tap');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('清单：勾上的那一下行高不变；300ms 后点下一行的圆圈，勾的是下一行（不会点开编辑面板）', async () => {
  const app = await open('#/t/demo-island/lists?list=buy', { now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector('.lrow', { timeout: 15000 });
    const open = TODOS.filter((t) => t.list === 'buy' && !t.done && !t.deleted_at).map((t) => t.id);
    const ids = await page.$$eval('.lrow:not([data-done])', (els) => els.map((e) => e.dataset.testid.replace(/^todo-/, '')));
    const [a, b] = ids.filter((id) => open.includes(id));
    assert.ok(a && b);
    const h0 = await page.$eval(T(`todo-${a}`), (el) => el.getBoundingClientRect().height);
    const yb0 = await top(page, T(`todo-${b}`));
    await page.click(`${T(`todo-${a}`)} .check__input`);
    await sleep(60);
    const h1 = await page.$eval(T(`todo-${a}`), (el) => el.getBoundingClientRect().height);
    const yb1 = await top(page, T(`todo-${b}`));
    assert.ok(Math.abs(h1 - h0) < 1, `勾上那一下行高不变：${h0} → ${h1}`);
    assert.ok(Math.abs(yb1 - yb0) < 1, `下一行没被挤下去：${yb0} → ${yb1}`);
    await sleep(240);
    await page.click(`${T(`todo-${b}`)} .check__input`);
    await sleep(200);
    assert.doesNotMatch(await page.evaluate(() => location.hash), /sheet=todo/, '没有打开编辑面板');
    assert.ok(await page.$eval(`${T(`todo-${b}`)} .check__input`, (el) => el.checked), '下一行勾上了');
    await waitForAnimationsDone(page, 4000);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 撤销
// ---------------------------------------------------------------------

test('概览：勾掉待办有「撤销」；点「完成」以后也有「撤销」，撤销后回到计划中', async () => {
  const app = await open('#/t/demo-island', { now: ONGOING });
  const { page } = app;
  try {
    await page.waitForSelector(T('ov-todo'), { timeout: 15000 });
    const id = await page.$eval(T('ov-todo'), (el) => el.dataset.todoId);
    await page.$eval(`${T('ov-todo')} .check__input`, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${T('ov-todo')} .check__input`);
    await page.waitForFunction(() => /已勾掉/.test(document.querySelector('[data-testid="toast"]')?.textContent || ''), { timeout: 4000 });
    await page.click(T('toast-action'));
    await sleep(600);
    assert.ok(await page.$(`[data-todo-id="${id}"]`), '撤销后这一项还在');

    await page.$eval(T('ov-now'), (el) => el.scrollIntoView({ block: 'center' }));
    const itemId = await page.$eval(T('ov-now'), (el) => el.dataset.itemId);
    // 换成下一项：新内容淡入、卡片高度平滑过渡（慢放 5 倍，截半路图）
    await withPlaybackRate(page, 0.2, async () => {
      await page.click(T('ov-now-done'));
      await page.waitForSelector('.ov-now__swap[data-swap]', { timeout: 15000 });
      await sleep(250);
      await screen(page, 'ov-done-swap-mid');
      const o = await page.$eval('.ov-now__swap[data-swap]', (el) => Number(getComputedStyle(el).opacity));
      assert.ok(o > 0.02 && o < 0.99, `新内容淡入到一半：${o}`);
    });
    await page.waitForFunction(() => /已完成「/.test(document.querySelector('[data-testid="toast"]')?.textContent || ''), { timeout: 6000 });
    await screen(page, 'ov-done-toast');
    await page.click(T('toast-action'));
    await page.waitForFunction((iid) => document.querySelector('[data-testid="ov-now"]')?.dataset.itemId === iid, { timeout: 6000 }, itemId);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 两台手机同时改（同一个人的两个标签页）
// ---------------------------------------------------------------------

test('待办编辑面板开着时另一台勾上了它：这边只改标题保存，「已完成」还在（只提交改了的字段）', async () => {
  const A = await open('#/t/demo-island/lists?list=todo', { now: UPCOMING });
  let B = null;
  try {
    const todo = TODOS.find((t) => t.list === 'todo' && !t.done && !t.deleted_at);
    await A.page.waitForSelector(T(`todo-${todo.id}`), { timeout: 15000 });
    await A.go(`#/t/demo-island/lists?list=todo&sheet=todo:${todo.id}`);
    await A.page.waitForSelector(T('todo-title'), { timeout: 8000 });
    await A.idle();

    // 另一台（同一个账号的第二个标签页）：A 的面板准备好以后再开（新开的标签页会到前面，后台标签页不跑 requestAnimationFrame）
    B = await A.context.newPage();
    await B.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await B.goto(`${server.url}?demo=1&nosw=1&now=${encodeURIComponent(UPCOMING)}#/t/demo-island/lists?list=todo`, { waitUntil: 'load' });
    await B.waitForSelector(T(`todo-check-${todo.id}`), { timeout: 15000 });
    await B.click(`${T(`todo-${todo.id}`)} .check__input`);
    // A 收到推送：列表里这一项也勾上了（面板还开着）
    // （后台标签页不跑 requestAnimationFrame：等待一律按时间轮询）
    await A.page.waitForFunction((id) => document.querySelector(`[data-testid="todo-${id}"]`)?.hasAttribute('data-done'), { timeout: 15000, polling: 200 }, todo.id);
    await sleep(600);

    await A.page.bringToFront();
    await A.page.$eval(T('todo-title'), (el) => el.focus());
    await A.page.keyboard.press('End');
    await A.page.keyboard.type('（改）');
    await A.page.click(T('todo-submit'));
    await A.page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000, polling: 200 });
    await sleep(2500);
    // 第三次打开（从“服务器”重新读）：标题改了、「已完成」还在
    await B.bringToFront();
    await B.reload({ waitUntil: 'load' });
    await B.waitForSelector(T(`todo-${todo.id}`), { timeout: 15000 });
    await B.waitForFunction((id) => /（改）/.test(document.querySelector(`[data-testid="todo-${id}"]`)?.textContent || ''), { timeout: 15000, polling: 200 }, todo.id);
    assert.ok(await B.$eval(T(`todo-${todo.id}`), (el) => el.hasAttribute('data-done')), '对方勾上的「已完成」没被改回去');
    await A.page.bringToFront();
    assert.ok(await A.page.$eval(T(`todo-${todo.id}`), (el) => el.hasAttribute('data-done')), '自己这边也还是已完成');
  } finally {
    await B?.close().catch(() => {});
    await A.close();
  }
});

// ---------------------------------------------------------------------
// 只读成员
// ---------------------------------------------------------------------

test('只读成员：＋ 面板的记一笔 / 加条目 / 加待办变淡、写原因、点不了；拍照打卡、写日记照常', async () => {
  const owner = await open('#/settings', { now: ONGOING });
  try {
    await owner.page.waitForSelector(T(`settings-member-menu-${CATHY}`), { timeout: 15000 });
    await owner.page.click(T(`settings-member-menu-${CATHY}`));
    await owner.page.waitForSelector(T('member-role-viewer'), { timeout: 5000 });
    await owner.page.click(T('member-role-viewer'));
    await owner.page.waitForFunction((id) => /只读/.test(document.querySelector(`[data-testid="settings-member-${id}"]`)?.textContent || ''), { timeout: 6000 }, CATHY);
    await sleep(1200);
    const c = await owner.context.newPage();
    try {
      await c.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await c.goto(`${server.url}?demo=1&nosw=1&demouser=cathy&now=${encodeURIComponent(ONGOING)}#/t/demo-island`, { waitUntil: 'load' });
      await c.waitForSelector(T('shell-fab'), { timeout: 15000 });
      await c.waitForSelector(T('ov-now'), { timeout: 15000 });
      await sleep(400);
      await c.click(T('shell-fab'));
      await c.waitForSelector(T('fab-expense'), { visible: true, timeout: 6000 });
      await sleep(700);
      const tiles = await c.$$eval('.fab-tile', (els) => els.map((e) => ({ id: e.dataset.testid, disabled: e.disabled === true, text: e.textContent })));
      const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
      for (const id of ['fab-expense', 'fab-item', 'fab-todo']) assert.equal(by[id].disabled, true, `${id} 不能点`);
      assert.match(by['fab-expense'].text, /只读成员不能记账/);
      assert.equal(by['fab-journal'].disabled, false);
      assert.equal(tiles[0].id, 'fab-photo', '能用的排前面');
      await c.screenshot({ path: path.join(SHOTS, 'viewer-fab.png') });
    } finally {
      await c.close();
    }
  } finally {
    await owner.close();
  }
});

// ---------------------------------------------------------------------
// 动效：每天页加条目、左右滑的提示
// ---------------------------------------------------------------------

test('每天页加条目：面板收回以后新的一条才进时间轴，淡入、高亮（半路图）', async () => {
  const app = await open(`#/t/demo-island/day/${D2.date}`, { now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T('day-add'), { timeout: 15000 });
    await page.$eval(T('day-add'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('day-add'));
    await page.waitForSelector(T('item-title'), { timeout: 8000 });
    await app.idle();
    await page.$eval(T('item-title'), (el) => el.focus());
    await page.keyboard.type('码头看渔船');
    const countBefore = await page.$$eval('.tl > .tl__item', (els) => els.length);
    // 慢放 10 倍：新的一条在面板开始收回时放进来、淡入到一半（量透明度）
    await withPlaybackRate(page, 0.1, async () => {
      await page.click(T('item-submit'));
      await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 30000 });
      await page.waitForSelector('.tl__item[data-fresh]', { timeout: 8000 });
      assert.match(await page.$eval('.tl__item[data-fresh] > .tl__card', (el) => el.textContent), /码头看渔船/);
      // 淡入稍微晚一点开始（等面板让开），慢放下轮询到「淡入到一半」那一刻
      const mid = await page.waitForFunction(() => {
        const o = Number(getComputedStyle(document.querySelector('.tl__item[data-fresh] > .tl__card')).opacity);
        return o > 0.05 && o < 0.95 ? o : false;
      }, { timeout: 10000, polling: 50 }).then((h) => h.jsonValue());
      assert.ok(mid > 0.05 && mid < 0.95, `淡入到一半：${mid}`);
    });
    // 面板走了以后：新的一条在屏幕上、强调色描边正在退（高亮的半路图）
    await page.waitForFunction(() => !document.querySelector('.ov-layer--sheet'), { timeout: 8000 }).catch(() => {});
    await sleep(300);
    const fresh = await page.$eval('.tl__item[data-fresh]', (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, shadow: getComputedStyle(el.querySelector('.tl__card')).boxShadow }; });
    assert.ok(fresh.top >= 0 && fresh.bottom <= 844, `新的一条滚进了屏幕：${Math.round(fresh.top)}–${Math.round(fresh.bottom)}`);
    await screen(page, 'day-add-fresh-glow');
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$$eval('.tl > .tl__item', (els) => els.length), countBefore + 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('左右滑换天：提示贴着视口边缘、只在页面让开的空隙里，不压在卡片上', async () => {
  const app = await open(`#/t/demo-island/day/${D2.date}`, { now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector('.tl__item', { timeout: 15000 });
    await app.idle();
    const cdp = await page.createCDPSession();
    const y = 420;
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 120);
    for (let x = 130; x <= 260; x += 10) {
      await touch('touchMove', x);
      await sleep(16);
    }
    await page.waitForSelector(T('day-swipe-hint'), { timeout: 3000 });
    const r = await page.$eval(T('day-swipe-hint'), (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; });
    const content = await page.$eval('.day', (el) => el.getBoundingClientRect().left);
    await screen(page, 'swipe-hint-130');
    assert.ok(r.right <= content + 1 && r.right > 24, `提示在左边让开的空隙里、看得见（提示 ${Math.round(r.left)}–${Math.round(r.right)}，页面左边 ${Math.round(content)}）`);
    await touch('touchMove', 140);
    await touch('touchEnd', 140);
    await waitForAnimationsDone(page, 4000);
    app.assertClean();
  } finally {
    await app.close();
  }
});
