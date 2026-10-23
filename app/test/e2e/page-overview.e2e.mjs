// 行程概览页（pages/trip，#/t/:tripId）：出发前 / 进行中 / 结束后三种版式、空行程、加载中骨架 → 入场、出错重试；
// 勾待办原地收起（截半路）、每天安排列表 ↔ 网格（FLIP 半路）、备选池挪到地点页（概览上没有，「排进」在地点页）；
// 进行中（「杂志纸本」：一屏一个主角）的「现在 / 接下来」动作行、「完成」转圈打勾后换到下一项、傍晚住哪提前、最后一天回程航班；回顾的照片点开大图；
// 375 / 1280 / 深色 / 减弱动态效果下不横向滚动、触控区 ≥44。截图在 __screenshots__/page-overview/，半路图在 __shots__/page-overview/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const SHOTS = shotsDir('page-overview');
const T = (id) => `[data-testid="${id}"]`;
const BEFORE = '2027-01-08T09:00:00+07:00';
const DURING = '2027-01-11T10:00:00+07:00';
const EVENING = '2027-01-11T19:30:00+07:00';
const LAST_DAY = '2027-01-13T09:00:00+07:00';
const AFTER = '2027-01-20T10:00:00+07:00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const open = (o = {}) => openApp({ browser, server, hash: '#/t/demo-island', now: BEFORE, ...o });

/** 等概览页的数据到了、动画安定 */
async function ready(app) {
  await app.page.waitForSelector(`${T('page-trip')}[data-state="ready"]`, { timeout: 15000 });
  await app.idle();
}

/** 页面根元素的直接子元素的 testid（卡片顺序） */
const order = (page) => page.$$eval(`${T('page-trip')} > *`, (els) => els.map((el) => el.dataset.testid || el.className.split(' ')[0]));

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
/** RollingNumber：看得见的数字 aria-hidden，另有一份读屏读的完整文字（textContent 会是两份） */
const rolled = (page, sel) => page.$eval(sel, (el) => el.querySelector('.visually-hidden').textContent.trim());

async function midShot(app, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await app.page.screenshot({ path: file, captureBeyondViewport: false });
  return file;
}

// ---------------------------------------------------------------------
// 出发前
// ---------------------------------------------------------------------

test('出发前（01-08 09:00）：倒计时数到起飞（1 天 22 小时）、登机牌式航班（起降各按时区、时差提示、机票已出票）、急的免费取消紧跟其后、待办、打包、天气、四天安排；备选池不在概览上（在地点页）；不横向滚动、触控区 ≥44', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(T('page-trip'), (el) => el.dataset.phase), 'upcoming');
    // 倒计时：2027-01-08 09:00 +07 → 起飞 01-10 08:05 +08 = 1 天 22 小时 5 分
    assert.equal(await rolled(page, T('ov-countdown-big')), '1');
    assert.equal(await text(page, T('ov-countdown-unit')), '天');
    assert.match(await text(page, T('ov-countdown-hm')), /^22 小时 [0-5] 分$/);
    assert.equal(await page.$eval(T('ov-countdown'), (el) => el.dataset.kind), 'flight');
    assert.match(await page.$eval(T('ov-countdown'), (el) => el.getAttribute('aria-label')), /^距离起飞还有 1 天 22 小时/);
    // 航班：起飞按香港时间、落地按越南时间
    assert.equal(await text(page, T('ov-flight-dep')), '08:05');
    assert.equal(await text(page, T('ov-flight-arr')), '10:20');
    const flight = await text(page, T('ov-flight'));
    assert.match(flight, /DM801 · 飞 3 小时 15 分/);
    assert.match(flight, /落地按越南时间（慢 1 小时）/);
    assert.match(flight, /HKG → VCS · 1月10日 周日/);
    assert.equal(await text(page, T('ov-flight-status')), '机票已出票');
    // 卡片顺序：演示岛 01-08 23:59 有一个不到 1 天就截止的免费取消 → 紧跟倒计时
    const ids = await order(page);
    assert.deepEqual(ids.slice(0, 3), ['ov-hero', 'ov-deadlines', 'ov-todos']);
    assert.ok(await page.$(`${T('ov-deadlines')}[data-urgent]`), '免费取消卡是警示色');
    assert.ok(ids.indexOf('ov-packing') > ids.indexOf('ov-todos'));
    assert.ok(ids.includes('ov-weather') && ids.includes('ov-days'), ids.join());
    assert.ok(!ids.includes('ov-pool'), '备选池不在概览上（挪到地点页）');
    // 待办：最多 5 条、最急的在前、每条有截止 / 备注小字
    const todos = await page.$$eval(T('ov-todo'), (els) => els.map((el) => ({ title: el.querySelector('.check__label').textContent, due: el.querySelector('.ov-due')?.textContent, state: el.querySelector('.ov-due')?.dataset.state })));
    assert.ok(todos.length >= 3 && todos.length <= 5);
    assert.equal(todos[0].state, 'urgent');
    assert.match(todos[0].due, /还剩/);
    assert.match(await text(page, `${T('ov-todos')} .k-card__meta`), /^还剩 \d+ 项$/);
    assert.match(await text(page, T('ov-todos-all')), /^查看全部待办/);
    // 打包：进度条 + 还剩几件
    assert.equal(await page.$eval(T('ov-packing'), (el) => el.dataset.left), '23');
    assert.equal(await rolled(page, T('ov-packing-left')), '23');
    assert.equal(await page.$eval(`${T('ov-packing')} [role="progressbar"]`, (el) => el.getAttribute('aria-valuenow')), '3');
    // 天气：每天一行（演示天气）
    const wx = await page.$$eval(T('ov-wx-row'), (els) => els.map((el) => el.dataset.status));
    assert.equal(wx.length, 4);
    assert.ok(wx.every((s) => s === 'ok'), `天气行状态 ${wx.join(',')}`);
    // 四天安排：列表，D1–D4，住哪 / 回程
    const days = await page.$$eval(T('ov-day'), (els) => els.map((el) => [el.querySelector('.ov-day__badge b').textContent, el.dataset.view, el.getAttribute('href')]));
    assert.deepEqual(days.map((d) => d[0]), ['D1', 'D2', 'D3', 'D4']);
    assert.ok(days.every((d) => d[1] === 'list'));
    assert.match(days[0][2], /#\/t\/demo-island\/day\/2027-01-10$/);
    assert.match(await text(page, T('ov-days')), /四天安排/);
    // 备选池：概览上没有（「排进」在地点页）
    assert.equal((await page.$$(`${T('ov-pool-row')}, ${T('ov-pool-schedule')}`)).length, 0);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('upcoming');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('勾待办：打勾后先划线停一下，再原地收起（半路截图：高度介于中间），收完从列表消失、「还剩 N 项」少 1', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const before = await page.$$eval(T('ov-todo'), (els) => els.map((el) => el.dataset.todoId));
    const meta0 = Number((await text(page, `${T('ov-todos')} .k-card__meta`)).match(/\d+/)[0]);
    const first = before[0];
    const sel = `${T('ov-todo')}[data-todo-id="${first}"]`;
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    const fullHeight = await page.$eval(sel, (el) => el.getBoundingClientRect().height);
    // 点勾选框：先划线（data-done），650ms 后开始收起（data-collapsing + grid-template-rows 过渡）
    const cap = await captureAt(app, async () => {
      await page.click(`${sel} .check__box`);
      await page.waitForSelector(`${sel}[data-done]`);
      await page.waitForSelector(`${sel}[data-collapsing]`, { timeout: 3000 });
    }, {
      selector: '.ov-todo',
      progress: 0.5,
      evaluate: () => {
        const el = document.querySelector('.ov-todo[data-collapsing]');
        return { height: el.getBoundingClientRect().height, opacity: Number(getComputedStyle(el).opacity) };
      },
    });
    try {
      assert.ok(cap.state.height > 2 && cap.state.height < fullHeight - 2, `半路高度 ${cap.state.height}（整行 ${fullHeight}）`);
      assert.ok(cap.state.opacity < 1, '半路在变淡');
      await midShot(app, 'todo-collapse-mid');
    } finally {
      await release(cap);
    }
    // 收起的过渡播完（transitionend）那一行才从 DOM 里拿掉；只等这一件事，不等页面上别的动画
    await page.waitForFunction((s) => !document.querySelector(s), { timeout: 6000 }, sel);
    await app.idle();
    const after = await page.$$eval(T('ov-todo'), (els) => els.map((el) => el.dataset.todoId));
    assert.ok(!after.includes(first), '勾掉的那条不在列表里了');
    const meta1 = Number((await text(page, `${T('ov-todos')} .k-card__meta`)).match(/\d+/)[0]);
    assert.equal(meta1, meta0 - 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('四天安排：列表 ↔ 网格切换是 FLIP（半路底板在动），切换后记住（刷新还是网格）', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const toggle = `${T('ov-days')} .icon-btn, ${T('ov-days')} button[aria-label="切换为网格"]`;
    await page.$eval(T('ov-days'), (el) => el.scrollIntoView({ block: 'start' }));
    await app.idle();
    const cap = await captureAt(app, () => page.click('button[aria-label="切换为网格"]'), {
      selector: '.ov-day__bg',
      progress: 0.5,
      evaluate: () => [...document.querySelectorAll('.ov-day__bg')].slice(0, 2).map((el) => getComputedStyle(el).transform),
    });
    try {
      assert.ok(cap.state.some((t) => t && t !== 'none'), `半路底板有 transform：${cap.state.join(' | ')}`);
      await midShot(app, 'days-grid-mid');
    } finally {
      await release(cap);
    }
    await waitForAnimationsDone(page, 8000);
    assert.equal(await page.$eval(T('ov-days'), (el) => el.dataset.view), 'grid');
    assert.ok(await page.$('button[aria-label="切换为列表"]'));
    const transforms = await page.$$eval('.ov-day__bg', (els) => els.map((el) => el.style.transform || ''));
    assert.ok(transforms.every((t) => !t), '播完不留内联 transform');
    assert.ok(await page.$(`${T('ov-day')}[data-view="grid"]`));
    void toggle;
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('upcoming-days-grid', { fullPage: false });
    // 刷新还是网格（本机偏好）
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await ready(app);
    assert.equal(await page.$eval(T('ov-days'), (el) => el.dataset.view), 'grid');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('备选池（「杂志纸本」挪到地点页）：概览上没有备选池；地点页按天看时备选池展开，点「D2」排进那天、条目从备选池消失并提示；旧的 ?item=<备选池条目> 链接打开概览不出错', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$(T('ov-pool')), null, '概览上没有备选池');
    // 地点页按天看：备选池默认展开
    await app.go('#/t/demo-island/places?by=day');
    await page.waitForSelector(`${T('places-pool')}[data-open]`, { timeout: 10000 });
    await app.idle();
    const poolIds = () => page.$$eval('.plp-pool__row', (els) => els.map((el) => el.dataset.testid.replace(/^pool-/, '')));
    const rows0 = await poolIds();
    assert.ok(rows0.length >= 3, `备选池 ${rows0.length} 条`);
    const target = rows0[0];
    await page.$eval(T(`pool-${target}`), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    // 出发前：D1–D4 都能排；点第二个（D2）
    const days = await page.$$eval(`${T(`pool-days-${target}`)} [data-day]`, (els) => els.map((e) => e.dataset.day));
    assert.equal(days.length, 4, `能排进的天：${days.length}`);
    await page.click(`${T(`pool-days-${target}`)} [data-day="${days[1]}"]`);
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="pool-${id}"]`), { timeout: 5000 }, target);
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => /排进了 D2/.test(el.textContent)), { timeout: 5000 });
    assert.equal((await poolIds()).length, rows0.length - 1);
    // 以前搜索结果里备选池的条目会带着 ?item= 打开概览：现在那个链接照样能打开、不报错
    await app.go(`#/t/demo-island?item=${rows0[1]}`);
    await ready(app);
    assert.equal(await page.$(T('ov-pool')), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 进行中
// ---------------------------------------------------------------------

test('进行中（01-11 10:00）：「现在」是半日浮潜（导航 / 叫 Grab / 给司机看 / 记一笔 + 完成 / 跳过 + 接下来），然后今晚住哪、天气和日落一行、待办、截止、明天（「杂志纸本」：没有时间轴缩略、今天花了、备选池、每天安排）', async () => {
  const app = await open({ now: DURING });
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(T('page-trip'), (el) => el.dataset.phase), 'ongoing');
    const ids = await order(page);
    // 批 A：最后多一张「当地」小卡（紧急电话一直在，按目的地档案）
    assert.deepEqual(ids, ['ov-now', 'ov-stay', 'ov-today-weather', 'ov-todos', 'ov-deadlines', 'ov-tomorrow', 'ov-local']);
    for (const gone of ['ov-timeline', 'ov-spend', 'ov-pool', 'ov-days']) assert.equal(await page.$(T(gone)), null, `${gone} 不在概览上`);
    // 现在
    assert.equal(await page.$eval(T('ov-now'), (el) => el.dataset.mode), 'current');
    assert.match(await text(page, `${T('ov-now')} .k-card__eyebrow`), /^现在$/);
    assert.match(await text(page, T('ov-now-title')), /半日浮潜/);
    assert.match(await page.$eval(T('ov-now-title'), (el) => el.getAttribute('href')), /\/day\/2027-01-11\?item=/);
    const actions = await page.$$eval(`${T('ov-now-actions')} [data-action]`, (els) => els.map((el) => [el.dataset.action, el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true']));
    // 批 A：按「这一项怎么去」——浮潜写了步行过去，只给导航 + 记一笔；叫车、给司机看在最后的「⋯」里
    assert.deepEqual(actions.map((a) => a[0]), ['nav', 'expense']);
    assert.ok(actions.every((a) => !a[1]), '动作都能点');
    assert.match(await page.$eval(`${T('ov-now-actions')} [data-action="nav"]`, (el) => el.getAttribute('href')), /google\.com\/maps\/dir/);
    await page.click(T('ov-now-actions-more'));
    await page.waitForSelector(`${T('ov-now-actions-more-row')} [data-action="ride"]`);
    assert.match(await page.$eval(`${T('ov-now-actions-more-row')} [data-action="ride"]`, (el) => el.getAttribute('href')), /grab\.onelink\.me/);
    assert.ok(await page.$(T('ov-now-done')));
    assert.ok(await page.$(T('ov-now-skip')));
    assert.match(await text(page, T('ov-now-next')), /接下来.*老码头海鲜午餐.*还有 3 小时/);
    // 时间轴和今天花了不在概览上：「现在」的标题点进那一天（时间轴在那里），「记一笔」在动作行里
    assert.equal(await page.$(T('ov-tl-row')), null);
    assert.equal(await page.$(T('ov-spend-hkd')), null);
    // 天气和日落
    assert.equal(await text(page, T('ov-sunset')), '17:42');
    assert.match(await text(page, T('ov-sunset-left')), /^离日落还有 7 小时 4\d 分$/);
    // 今晚住哪：三个动作 + 打电话、预订详情
    assert.match(await text(page, `${T('ov-stay')} .k-card__title`), /椰影湾酒店/);
    const stayActions = await page.$$eval(`${T('ov-stay-actions')} [data-action]`, (els) => els.map((el) => el.dataset.action));
    // 批 A：动作键 grab 改名 ride（叫哪家按目的地档案，越南还是「叫 Grab」）
    assert.deepEqual(stayActions, ['nav', 'ride', 'driver', 'call']);
    assert.match(await text(page, T('ov-stay-booking')), /预订详情/);
    assert.match(await text(page, T('ov-stay')), /明天 12:00 前退房/);
    assert.ok(await page.$(T('ov-tomorrow')));
    assert.match(await text(page, T('ov-tomorrow')), /换酒店 · 南岬落日/);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('ongoing');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('进行中：点「完成」转圈打勾，这一条标记完成，大卡换成「接下来 · 老码头海鲜午餐」，那一天的时间轴上它打了勾', async () => {
  const app = await open({ now: DURING });
  try {
    await ready(app);
    const { page } = app;
    const itemId = await page.$eval(T('ov-now'), (el) => el.dataset.itemId);
    await page.$eval(T('ov-now-done'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('ov-now-done'));
    // 提交按钮：文字 → 转圈（至少转 minLoading 毫秒）→ 对勾；期间大卡按住这一条不换（data-finishing），两个中间态各截一张
    await page.waitForSelector(`${T('ov-now-done')}[data-state="loading"]`, { timeout: 3000 });
    assert.equal(await page.$eval(T('ov-now-done'), (el) => el.getAttribute('aria-busy')), 'true');
    assert.equal(await page.$eval(T('ov-now'), (el) => el.dataset.itemId), itemId, '转圈期间大卡还是这一条');
    assert.ok(await page.$(`${T('ov-now')}[data-finishing]`));
    await midShot(app, 'done-loading');
    await page.waitForSelector(`${T('ov-now-done')}[data-state="success"]`, { timeout: 5000 });
    assert.equal(await page.$eval(T('ov-now'), (el) => el.dataset.itemId), itemId, '打勾时大卡还是这一条');
    await midShot(app, 'done-success');
    await page.waitForFunction((id) => {
      const card = document.querySelector('[data-testid="ov-now"]');
      return card && card.dataset.itemId !== id;
    }, { timeout: 8000 }, itemId);
    await app.idle();
    assert.equal(await page.$eval(T('ov-now'), (el) => el.dataset.mode), 'next');
    assert.match(await text(page, `${T('ov-now')} .k-card__eyebrow`), /^接下来 · 还有 3 小时$/);
    assert.match(await text(page, T('ov-now-title')), /老码头海鲜午餐/);
    await app.shot('ongoing-after-done', { fullPage: false });
    // 概览上不再有时间轴缩略：到那一天的页面看，这一条打了勾
    await app.go(`#/t/demo-island/day/2027-01-11?item=${itemId}`);
    await page.waitForSelector(`li[data-item-id="${itemId}"]`, { timeout: 10000 });
    await app.idle();
    assert.equal(await page.$eval(`li[data-item-id="${itemId}"]`, (el) => el.dataset.status), 'done', '那一天的时间轴上它打了勾（标记完成）');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('进行中：傍晚（19:30）今晚住哪提到第二张、叫 Grab 是主要按钮；最后一天回程航班紧跟其后', async () => {
  const app = await open({ now: EVENING });
  try {
    await ready(app);
    const { page } = app;
    const ids = await order(page);
    assert.deepEqual(ids.slice(0, 2), ['ov-now', 'ov-stay']);
    assert.ok(await page.$(`${T('ov-stay-actions')} [data-action="ride"].k-act--primary`), '叫 Grab 是主要按钮（批 A：动作键改名 ride）');
    await app.shot('ongoing-evening', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
  const last = await open({ now: LAST_DAY });
  try {
    await ready(last);
    const ids = await order(last.page);
    assert.deepEqual(ids.slice(0, 2), ['ov-now', 'ov-return-flight']);
    assert.equal(await text(last.page, `${T('ov-return-flight')} ${T('ov-flight-dep')}`), '16:40');
    assert.equal(await text(last.page, `${T('ov-return-flight')} ${T('ov-flight-arr')}`), '20:35');
    assert.match(await text(last.page, T('ov-return-flight')), /落地按香港时间（快 1 小时）/);
    assert.ok(!(await last.page.$(T('ov-stay'))), '最后一天没有「今晚住哪」');
    await last.shot('ongoing-last-day', { fullPage: false });
    last.assertClean();
  } finally {
    await last.close();
  }
});

// ---------------------------------------------------------------------
// 结束后、空行程、状态
// ---------------------------------------------------------------------

test('结束后（三城，01-20）：回顾大卡（9 天 8 晚、路线、四个数字）、总花费、结算（按币种分别）、每天一张照片（点开大图）、评级最高、日记摘录、每天回顾', async () => {
  const app = await open({ hash: '#/t/demo-cities', now: AFTER });
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(T('page-trip'), (el) => el.dataset.phase), 'ended');
    const ids = await order(page);
    // 有封面照片：最上面一张左右出血的大图；有照片了不再出现「补照片」
    assert.deepEqual(ids, ['ov-cover', 'ov-recap', 'ov-total', 'ov-settle', 'ov-photos', 'ov-top-places', 'ov-journal', 'ov-days']);
    assert.equal(await text(page, T('ov-recap-days')), '9');
    assert.match(await text(page, T('ov-recap')), /8 晚/);
    // 路线是一行字「雾港 —— 茶山 —— 南湾」（路线速写 10-20 拿掉了：画出来是几笔小划痕）
    assert.equal(await page.$(T('ov-recap-sketch')), null);
    assert.match(await page.$eval(T('ov-recap-route'), (el) => el.getAttribute('aria-label')), /雾港，茶山，南湾/);
    assert.equal((await page.$$(`${T('ov-recap-stats')} .ov-stat`)).length, 4);
    assert.match(await text(page, T('ov-total-home')), /^HK\$[\d,]+/);
    assert.match(await text(page, T('ov-settle-amounts')), /NT\$[\d,]+\s*\+\s*HK\$[\d,]+/);
    assert.ok((await page.$$(T('ov-photo'))).length >= 5);
    assert.ok((await page.$$(T('ov-photo-empty'))).length >= 1);
    assert.ok((await page.$$(T('ov-top-place'))).length >= 2);
    assert.equal((await page.$$(T('ov-day'))).length, 9);
    assert.match(await text(page, T('ov-days')), /每天回顾/);
    // 点一张照片：打开看大图弹层
    await page.$eval(T('ov-photo'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('ov-photo'));
    await page.waitForFunction(() => /sheet=photo:/.test(location.hash));
    await page.waitForSelector(T('photo-viewer'), { timeout: 8000 });
    await app.idle();
    await page.goBack();
    // 等看大图弹层真的收完（退场动画播完、从 DOM 里拿掉），截图里才不会还盖着一张照片
    await page.waitForFunction(() => !document.querySelector('[data-testid="photo-viewer"]') && !/sheet=/.test(location.hash), { timeout: 8000 });
    await app.idle();
    await assertNoHorizontalOverflow(page);
    await app.shot('ended');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空行程（山雾镇）：倒计时数到出发日零点、待办空状态能「加一项」、两天安排、天气提示填坐标；没有打包 / 截止 / 备选池', async () => {
  const app = await open({ hash: '#/t/demo-empty' });
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(T('ov-countdown'), (el) => el.dataset.kind), 'trip');
    assert.ok(await page.$(T('ov-flight-none')));
    assert.ok(await page.$(T('ov-todos-empty')));
    assert.equal((await page.$$(T('ov-day'))).length, 2);
    assert.match(await text(page, T('ov-day')), /第 1 天/);
    assert.match(await text(page, T('ov-weather')), /填上坐标/);
    for (const id of ['ov-packing', 'ov-deadlines', 'ov-pool']) assert.equal(await page.$(T(id)), null, `${id} 不该出现`);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('empty');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('加载中先是骨架，数据到了卡片错落入场；离线打不开行程显示中文原因和「重试」', async () => {
  const app = await open({ search: { demolatency: '900' } });
  try {
    const { page } = app;
    const state = await page.$eval(T('page-trip'), (el) => el.dataset.state);
    assert.equal(state, 'loading');
    assert.ok(await page.$('.ov-skel'));
    await page.waitForSelector(`${T('page-trip')}[data-state="ready"][data-entering]`, { timeout: 15000 });
    const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'ov-rise').length);
    assert.ok(anims >= 3, `入场动画 ${anims} 个`);
    await app.idle();
    await page.waitForFunction(() => !document.querySelector('[data-testid="page-trip"]').hasAttribute('data-entering'), { timeout: 3000 });
    app.assertClean();
  } finally {
    await app.close();
  }
  const off = await open({ search: { demonet: 'offline' } });
  try {
    await off.page.waitForSelector(T('ov-error'), { timeout: 15000 });
    const msg = await text(off.page, T('ov-error'));
    assert.match(msg, /[一-鿿]/, '中文原因');
    assert.ok(await off.page.$(`${T('ov-error')} button`), '有重试按钮');
    off.assertClean();
  } finally {
    await off.close();
  }
});

test('375 小屏、1280 桌面、深色、减弱动态效果：不横向滚动、触控区 ≥44', async () => {
  for (const [name, o] of [
    ['small', { device: 'small', now: BEFORE }],
    ['desktop', { device: 'desktop', now: DURING }],
    ['dark', { colorScheme: 'dark', now: DURING }],
    ['dark-ended', { colorScheme: 'dark', hash: '#/t/demo-cities', now: AFTER }],
    ['reduced', { reducedMotion: true, now: BEFORE }],
  ]) {
    const app = await open(o);
    try {
      await ready(app);
      await assertNoHorizontalOverflow(app.page);
      await assertTapTargets(app.page);
      await app.shot(name, { fullPage: name !== 'desktop' });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
