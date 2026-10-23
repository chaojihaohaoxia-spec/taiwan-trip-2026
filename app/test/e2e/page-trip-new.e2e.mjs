// 新建行程（?sheet=trip-new，批 A · 三）、空白的一天（快速添加）、设置里每趟行程的「这趟」几项（改日期、这趟怎么走、叫车用、拉对方）。
// 演示数据（demo/demo-db.json，全部虚构）；城市是规则包内置表里的公开城市名。
// 截图：<截图根目录>/__shots__/page-trip-new/（验收用的几张，名字带序号）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, shotsDir } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const userId = (email) => DB.users.find((u) => u.email === email).id;
const CATHY = userId('cathy@example.com');
const PACKING = DB.tables.todos.filter((t) => t.trip_id === 'demo-island' && t.list === 'packing').length;

const SHOTS = shotsDir('page-trip-new');
const T = (id) => `[data-testid="${id}"]`;
/** 演示里的「现在」：椰影岛出发前两天（香港 1 月 8 日） */
const NOW = '2027-01-08T09:00:00+07:00';
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

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
const waitHash = (page, re, timeout = 10000) => page.waitForFunction((src) => new RegExp(src).test(location.hash), { timeout }, re.source);
const text = (page, id) => page.$eval(T(id), (el) => el.textContent.replace(/\s+/g, ' ').trim());
const scrollTo = (page, id) => page.$eval(T(id), (el) => el.scrollIntoView({ block: 'center' }));

/** 弹层里的可点元素 ≥44px（算上 ::after 扩出的热区） */
async function assertTapTargetsIn(page, root, min = 44) {
  const small = await page.evaluate((rootSel, minSize) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], input:not([type="hidden"]):not([type="checkbox"]), select, textarea';
    for (const el of document.querySelectorAll(`${rootSel} :is(${sel})`)) {
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      let w = r.width;
      let h = r.height;
      for (const pseudo of ['::after', '::before']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const n = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
        w = Math.max(w, r.width - n(ps.left) - n(ps.right));
        h = Math.max(h, r.height - n(ps.top) - n(ps.bottom));
      }
      if (w < minSize - 0.5 || h < minSize - 0.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}」${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  }, root, min);
  assert.deepEqual(small, [], `可点区域小于 ${min}px：\n${small.join('\n')}`);
}

/** 设置页：展开某一趟（已经展开的不再点，点了会收起） */
async function expand(page, id) {
  const head = `${T(`settings-trip-${id}`)} .xcard__header`;
  await page.waitForSelector(head, { timeout: 8000 });
  if (await page.$eval(head, (el) => el.getAttribute('aria-expanded')) !== 'true') await page.click(head);
}

async function openNew(o = {}) {
  const app = await openApp({ browser, server, hash: '#/trips', now: NOW, ...o });
  await app.page.waitForSelector(T('trips-list'), { timeout: 10000 });
  await app.idle();
  await app.page.click(T('trips-new'));
  await app.page.waitForSelector(T('trip-new-form'));
  await app.idle();
  return app;
}

// =====================================================================
// 新建行程
// =====================================================================

test('新建「京都」：没选就点建好 → 说先选去哪（不转圈）；搜城市 → 档案预览；日历点出发（默认 4 天）再点回来（3 天）；名字自动起；和 Cathy 一起、带上一趟的行李清单 → 建好进第一天', async () => {
  const app = await openNew();
  const { page } = app;
  try {
    // 搜城市自动聚焦；没打字时有一排「常用」
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'trip-new-city-search');
    assert.ok(await page.$(T('trip-new-quick')));
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('sheet-trip-new'));
    await shot(page, '01-new-empty');
    // 什么都没选：不转圈，「去哪」说原因
    await page.click(T('trip-new-submit'));
    await page.waitForFunction(() => /先选去哪/.test(document.querySelector('[data-testid="trip-new-preview"]')?.textContent || ''));
    assert.notEqual(await page.$eval(T('trip-new-submit'), (el) => el.dataset.state), 'loading');

    await page.type(T('trip-new-city-search'), 'kyo');
    await page.waitForSelector(T('trip-new-city-kyoto'));
    await shot(page, '02-new-search');
    await page.click(T('trip-new-city-kyoto'));
    await page.waitForFunction(() => /日元 · 比香港快 1 小时/.test(document.querySelector('[data-testid="trip-new-preview"]')?.textContent || ''));
    assert.match(await text(page, 'trip-new-cities'), /京都.*日本/);
    // 这趟怎么走：京都按日本默认「公交为主」
    assert.equal(await page.$eval(T('trip-new-move-transit'), (el) => el.getAttribute('aria-pressed')), 'true');

    // 日历：翻到 3 月，点 28 号 → 默认 4 天（虚的）；再点 30 号 → 3 天
    await page.click(T('trip-new-cal-next'));
    await page.click(T('trip-new-cal-next'));
    assert.equal(await text(page, 'trip-new-cal-month'), '3 月');
    await page.click(T('trip-new-cal-2027-03-28'));
    await page.waitForFunction(() => /4 天 3 晚 · 79 天后出发/.test(document.querySelector('[data-testid="trip-new-length"]').textContent));
    assert.equal(await page.$eval(T('trip-new-cal'), (el) => el.hasAttribute('data-auto')), true);
    await scrollTo(page, 'trip-new-length');
    await shot(page, '03-new-start-only');
    await page.click(T('trip-new-cal-2027-03-30'));
    await page.waitForFunction(() => /3月28日 周日 → 3月30日 周二.*3 天 2 晚/.test(document.querySelector('[data-testid="trip-new-length"]').textContent));
    // 名字按城市和月份自动起
    assert.equal(await page.$eval(T('trip-new-title'), (el) => el.value), '京都 · 3 月');
    // 和 Cathy 一起、带上一趟（椰影岛）的行李清单，都默认勾
    await page.waitForSelector(T('trip-new-packing'), { timeout: 8000 });
    assert.match(await text(page, 'trip-new-partner'), /和 Cathy 一起/);
    assert.match(await text(page, 'trip-new-packing'), new RegExp(`行李清单（${PACKING} 项）.*椰影岛`));
    assert.equal(await page.$eval(`${T('trip-new-partner')} input`, (el) => el.checked), true);
    assert.equal(await page.$eval(`${T('trip-new-packing')} input`, (el) => el.checked), true);
    assert.match(await text(page, 'trip-new-starter'), /4 条出发前待办/);
    await scrollTo(page, 'trip-new-partner');
    await shot(page, '04-new-filled');
    await assertNoHorizontalOverflow(page);

    // 建好 → 转圈 → 对勾 → 直接进第一天（空白的一天）
    await page.click(T('trip-new-submit'));
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-new-submit"]')?.dataset.state === 'loading', { timeout: 3000 });
    await waitHash(page, /^#\/t\/kyoto-2027\/day\/2027-03-28$/);
    await page.waitForSelector(T('day-empty'), { timeout: 8000 });
    assert.match(await text(page, 'day-empty'), /还空着/);
    // 分段条：概览 + 3 天，每天点进去都是空白的一天（不是「不在行程里」）
    const cells = await page.$$eval('[data-testid^="day-strip-"]', (els) => els.map((e) => e.dataset.testid));
    assert.equal(cells.length, 4, cells.join());
    await app.idle();
    await shot(page, '05-day-blank');
    for (const d of ['2027-03-29', '2027-03-30']) {
      await app.go(`#/t/kyoto-2027/day/${d}`);
      await page.waitForSelector(T('day-empty'), { timeout: 6000 });
      assert.equal(await page.$(T('day-not-in-trip')), null);
    }
    // 返回：回到行程列表（弹层的历史已经清掉），新行程在列表里
    await app.go('#/trips');
    await page.waitForSelector(T('trip-kyoto-2027'), { timeout: 8000 });
    // 成员：两个人（Cathy 可编辑）；行李清单带过来了、勾都清掉
    await app.go('#/settings');
    await expand(page, 'kyoto-2027');
    await page.waitForSelector(T('settings-members-kyoto-2027'), { timeout: 8000 });
    await page.waitForSelector(`${T('settings-members-kyoto-2027')} ${T(`settings-member-${CATHY}`)}`, { timeout: 8000 });
    assert.equal(await page.$$eval(`${T('settings-members-kyoto-2027')} .set-member`, (els) => els.length), 2);
    assert.equal(await page.$(T('settings-partner-kyoto-2027')), null, '两个人都在：没有「把 Cathy 加进来」');
    await app.go('#/t/kyoto-2027/lists');
    await page.waitForFunction((n) => document.body.textContent.includes(`${n}`), { timeout: 8000 }, PACKING);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空白的一天：快速添加（回车就加、打头的钟点拆出来按时间排）→ 时间轴出来，输入框留在原位接着写；「详细加一项」打开条目面板', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-empty/day/2027-04-03', now: NOW });
  const { page } = app;
  try {
    await page.waitForSelector(T('day-empty'));
    await app.idle();
    await assertNoHorizontalOverflow(page);
    await page.click(T('day-quick-add-input'));
    await page.keyboard.type('15:00 咖啡');
    await page.keyboard.press('Enter');
    await page.waitForSelector(T('day-quick'), { timeout: 4000 });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'day-quick-add-input', '换成时间轴时输入框没重建，焦点还在');
    await page.keyboard.type('9点半 早市');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[id^="item-"]').length === 2, { timeout: 4000 });
    const titles = await page.$$eval('[id^="item-"]', (els) => els.map((e) => e.textContent));
    assert.match(titles[0], /09:30.*早市/, '按钟点排：早市在前');
    assert.match(titles[1], /15:00.*咖啡/);
    await shot(page, '06-day-quick-added');
    // 换一天：快速添加收起，那天还是空白
    await app.go('#/t/demo-empty/day/2027-04-04');
    await page.waitForSelector(T('day-empty'));
    await page.click(T('day-empty-add'));
    await page.waitForFunction(() => location.hash.includes('sheet=item:d.2027-04-04'));
    await page.waitForSelector(T('item-form'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('新建两个城市（东京 + 巴厘岛）：每个城市住几晚加减一晚；不和对方一起、不带行李清单；离线时按钮禁用说明；建好后设置里「把 Cathy 加进来」', async () => {
  const app = await openNew();
  const { page } = app;
  try {
    await page.type(T('trip-new-city-search'), '东京');
    await page.keyboard.press('Enter');
    await page.click(T('trip-new-add-city'));
    await page.type(T('trip-new-city-search'), '巴厘');
    await page.waitForSelector(T('trip-new-city-bali'));
    await page.click(T('trip-new-city-bali'));
    await page.click(T('trip-new-cal-next'));
    await page.click(T('trip-new-cal-2027-02-10'));
    await page.click(T('trip-new-cal-2027-02-15'));
    await page.waitForSelector(T('trip-new-nights'));
    assert.deepEqual(await page.$$eval('[data-testid^="trip-new-night-"]:not(button)', (els) => els.map((e) => e.textContent)), ['3 晚', '2 晚']);
    await page.click(T('trip-new-night-plus-1'));
    assert.deepEqual(await page.$$eval('[data-testid^="trip-new-night-"]:not(button)', (els) => els.map((e) => e.textContent)), ['2 晚', '3 晚'], '总晚数不变');
    assert.match(await text(page, 'trip-new-nights'), /东京 ?2月10日 周三 – 2月11日.*巴厘岛 ?2月12日 周五 – 2月15日/);
    assert.equal(await page.$eval(T('trip-new-title'), (el) => el.value), '东京、巴厘岛 · 2 月');
    await page.click(T('trip-new-move-ride'));
    assert.match(await text(page, 'trip-new-move-hint'), /单独一项还能改/);
    await page.click(`${T('trip-new-partner')} input`);
    await page.waitForSelector(T('trip-new-packing'), { timeout: 8000 });
    await page.click(`${T('trip-new-packing')} input`);
    await scrollTo(page, 'trip-new-nights');
    await shot(page, '07-new-two-cities');
    // 离线：按钮禁用、说明一句；填的东西留着
    await page.setOfflineMode(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector(T('trip-new-offline'), { timeout: 4000 });
    assert.equal(await page.$eval(T('trip-new-submit'), (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'), true);
    await page.setOfflineMode(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('[data-testid="trip-new-offline"]'), { timeout: 4000 });
    assert.equal(await page.$eval(T('trip-new-title'), (el) => el.value), '东京、巴厘岛 · 2 月');
    await page.click(T('trip-new-submit'));
    await waitHash(page, /^#\/t\/tokyo-2027\/day\/2027-02-10$/);
    await page.waitForSelector(T('day-empty'), { timeout: 8000 });
    // 只有自己：设置里「把 Cathy 加进来」
    await app.go('#/settings');
    await expand(page, 'tokyo-2027');
    await page.waitForSelector(T('settings-partner-tokyo-2027'), { timeout: 8000 });
    assert.match(await text(page, 'settings-partner-tokyo-2027'), /把 Cathy 加进来/);
    assert.equal(await page.$eval(T('settings-move-tokyo-2027-ride'), (el) => el.getAttribute('aria-pressed')), 'true', '新建时点的「打车为主」写进了档案');
    await page.click(T('settings-partner-tokyo-2027'));
    await page.waitForSelector(`${T('settings-members-tokyo-2027')} ${T(`settings-member-${CATHY}`)}`, { timeout: 8000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="settings-partner-tokyo-2027"]'), { timeout: 6000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('超长行程名（含越南语声调）：卡片标题最多两行、不撑宽；375 不横向滚动', async () => {
  const app = await openNew({ device: 'small' });
  const { page } = app;
  try {
    const long = 'Đảo Ngọc Phú Quốc · 重阳三晚和朋友一起去看日落吃海鲜还要坐全世界最长的跨海缆车去香岛';
    await page.click(T('trip-new-quick-phu-quoc'));
    await page.click(T('trip-new-cal-2027-01-20'));
    await page.$eval(T('trip-new-title'), (el) => el.select());
    await page.type(T('trip-new-title'), long);
    await assertNoHorizontalOverflow(page);
    await page.click(T('trip-new-submit'));
    await waitHash(page, /^#\/t\/phu-quoc-2027\/day\/2027-01-20$/);
    await app.go('#/trips');
    const card = T('trip-phu-quoc-2027');
    await page.waitForSelector(card, { timeout: 8000 });
    await app.idle();
    const m = await page.$eval(`${card} .tcard__title`, (el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight), sw: el.scrollWidth, cw: el.clientWidth }));
    assert.ok(m.h <= m.lh * 2 + 1, `最多两行：${m.h} / 行高 ${m.lh}`);
    assert.ok(m.sw <= m.cw + 1, '不撑宽');
    assert.match(await page.$eval(card, (el) => el.getAttribute('aria-label')), /Đảo Ngọc Phú Quốc/);
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('城市表里没有：按国家建（「清莱」→ 泰国），id 用国家英文名', async () => {
  const app = await openNew();
  const { page } = app;
  try {
    await page.type(T('trip-new-city-search'), '清莱');
    await page.waitForSelector(T('trip-new-region-TH'));
    await shot(page, '08-new-region-fallback');
    await page.click(T('trip-new-region-TH'));
    assert.match(await text(page, 'trip-new-cities'), /清莱.*泰国 · 按国家建/);
    await page.waitForFunction(() => /泰铢/.test(document.querySelector('[data-testid="trip-new-preview"]')?.textContent || ''));
    await page.click(T('trip-new-cal-2027-01-25'));
    await page.click(T('trip-new-submit'));
    await waitHash(page, /^#\/t\/thailand-2027\/day\/2027-01-25$/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('填了一半关掉 → 存草稿、不问；再打开接着填，「重新填」清空；两个城市（台北 + 垦丁）建好 → 设置里「这趟怎么走」亮「按城市」，点打车再点回来，刷新后还在；删掉这一趟（先确认、说清楚删什么）', async () => {
  const app = await openNew();
  const { page } = app;
  const fill = async () => {
    await page.type(T('trip-new-city-search'), '台北');
    await page.waitForSelector(T('trip-new-city-taipei'));
    await page.click(T('trip-new-city-taipei'));
    await page.click(T('trip-new-add-city'));
    await page.type(T('trip-new-city-search'), '垦丁');
    await page.waitForSelector(T('trip-new-city-kenting'));
    await page.click(T('trip-new-city-kenting'));
    await page.click(T('trip-new-cal-2027-01-20'));
    await page.click(T('trip-new-cal-2027-01-24'));
  };
  const close = async () => {
    await app.idle();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="trip-new-form"]'), { timeout: 6000 });
    await app.idle();
  };
  try {
    await fill();
    assert.match(await text(page, 'trip-new-move-hint'), /没改就按城市：台北公交为主、垦丁骑车/);
    await close();
    assert.equal(await page.$(T('dialog-confirm')), null, '草稿存上了：关掉不用问');
    await page.click(T('trips-new'));
    await page.waitForSelector(T('trip-new-draft'), { timeout: 6000 });
    assert.match(await text(page, 'trip-new-cities'), /台北.*垦丁/, '接着上次的城市');
    assert.match(await text(page, 'trip-new-length'), /1月20日 周三 → 1月24日 周日/, '接着上次的日期');
    await assertTapTargetsIn(page, T('sheet-trip-new'));
    await shot(page, '13-new-draft');
    await page.click(T('trip-new-draft-clear'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="trip-new-draft"]'));
    assert.equal(await page.$(T('trip-new-city-x-0')), null, '城市清空了');
    await close();
    await page.click(T('trips-new'));
    await page.waitForSelector(T('trip-new-form'));
    await app.idle();
    assert.equal(await page.$(T('trip-new-draft')), null, '重新填以后没有草稿了');

    await fill();
    await page.click(T('trip-new-submit'));
    await waitHash(page, /^#\/t\/taipei-2027\/day\/2027-01-20$/);
    await page.waitForSelector(T('day-empty'), { timeout: 8000 });

    await app.go('#/settings');
    await expand(page, 'taipei-2027');
    await page.waitForSelector(T('settings-move-taipei-2027-city'), { timeout: 8000 });
    assert.equal(await page.$eval(T('settings-move-taipei-2027-city'), (el) => el.getAttribute('aria-pressed')), 'true', '没点过：按城市');
    assert.match(await text(page, 'settings-move-hint-taipei-2027'), /按城市：台北公交为主、垦丁骑车/);
    await page.click(T('settings-move-taipei-2027-ride'));
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-move-taipei-2027-ride"]')?.getAttribute('aria-pressed') === 'true', { timeout: 6000 });
    await sleep(300);
    await page.click(T('settings-move-taipei-2027-city'));
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-move-taipei-2027-city"]')?.getAttribute('aria-pressed') === 'true', { timeout: 6000 });
    await sleep(400);
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await expand(page, 'taipei-2027');
    await page.waitForSelector(T('settings-move-taipei-2027-city'), { timeout: 10000 });
    assert.equal(await page.$eval(T('settings-move-taipei-2027-city'), (el) => el.getAttribute('aria-pressed')), 'true', '回到按城市：刷新后还在');

    // 删掉这一趟：先确认，说清楚一起删掉什么；确认以后从列表里消失
    await page.$eval(T('settings-delete-taipei-2027'), (el) => el.scrollIntoView({ block: 'center' }));
    await assertTapTargetsIn(page, T('settings-members-taipei-2027'));
    await shot(page, '14-settings-delete');
    await page.click(T('settings-delete-taipei-2027'));
    await page.waitForSelector(T('dialog-confirm'), { timeout: 6000 });
    assert.match(await page.$eval('.ov-dialog', (el) => el.textContent), /删掉「台北、垦丁 · 1 月」？.*条待办和清单会一起删掉.*删了找不回来/);
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="settings-trip-taipei-2027"]'), { timeout: 8000 });
    await app.go('#/trips');
    await page.waitForSelector(T('trips-list'), { timeout: 8000 });
    assert.equal(await page.$(T('trip-taipei-2027')), null, '行程列表里也没有了');
    assert.ok(await page.$(T('trip-demo-island')), '别的行程还在');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 设置：每趟行程的「这趟」
// =====================================================================

test('设置：这趟怎么走、叫车用（合并写档案，刷新后还在）；改日期多一天只点一下 → 新的一天是空白的；缩短碰到有安排的天 → 问「挪进备选池」→ 挪了再改', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW });
  const { page } = app;
  try {
    await page.waitForSelector(T('settings-prefs-demo-island'), { timeout: 10000 });
    await app.idle();
    assert.equal(await text(page, 'settings-dates-demo-island'), '1月10日 周日 → 1月13日 周三 · 4 天');
    assert.equal(await page.$eval(T('settings-move-demo-island-ride'), (el) => el.getAttribute('aria-pressed')), 'true', '越南按地区默认打车为主');
    await page.click(T('settings-move-demo-island-transit'));
    await page.click(T('settings-ride-demo-island-xanhsm'));
    await page.waitForFunction(() => document.querySelector('[data-testid="settings-ride-demo-island-xanhsm"]')?.getAttribute('aria-pressed') === 'true', { timeout: 6000 });
    await sleep(400);
    await page.$eval(T('settings-members'), (el) => el.scrollIntoView());
    await shot(page, '09-settings-prefs');
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await page.waitForSelector(T('settings-prefs-demo-island'), { timeout: 10000 });
    assert.equal(await page.$eval(T('settings-move-demo-island-transit'), (el) => el.getAttribute('aria-pressed')), 'true', '刷新后还在');
    assert.equal(await page.$eval(T('settings-ride-demo-island-xanhsm'), (el) => el.getAttribute('aria-pressed')), 'true', '叫车用 Xanh SM 排第一');

    // 山雾镇（4/3–4/4）多一天：只点 4/5
    await expand(page, 'demo-empty');
    await page.waitForSelector(T('settings-dates-edit-demo-empty'), { timeout: 8000 });
    await app.idle();
    await page.click(T('settings-dates-edit-demo-empty'));
    await page.waitForSelector(T('trip-dates-form'));
    await app.idle();
    assert.equal(await text(page, 'trip-dates-cal-month'), '4 月', '日历翻到出发那个月');
    await page.click(T('trip-dates-cal-2027-04-05'));
    assert.match(await text(page, 'trip-dates-line'), /4月3日 周六 → 4月5日 周一.*多 1 天/);
    await assertTapTargetsIn(page, T('sheet-trip-dates'));
    await shot(page, '10-dates-extend');
    await page.click(T('trip-dates-submit'));
    await page.waitForFunction(() => /4月5日 周一 · 3 天/.test(document.querySelector('[data-testid="settings-dates-demo-empty"]')?.textContent || ''), { timeout: 8000 });
    await app.go('#/t/demo-empty/day/2027-04-05');
    await page.waitForSelector(T('day-empty'), { timeout: 8000 });

    // 椰影岛缩短到 1/12：1/13 还有安排 → 问 → 挪进备选池
    await app.go('#/settings');
    await expand(page, 'demo-island');
    await page.waitForSelector(T('settings-dates-edit-demo-island'), { timeout: 8000 });
    await app.idle();
    await page.click(T('settings-dates-edit-demo-island'));
    await page.waitForSelector(T('trip-dates-form'));
    await app.idle();
    await page.click(T('trip-dates-cal-2027-01-12'));
    assert.match(await text(page, 'trip-dates-line'), /少 1 天/);
    await page.click(T('trip-dates-submit'));
    await page.waitForSelector(T('dialog-confirm'), { timeout: 6000 });
    assert.match(await page.$eval('.ov-dialog', (el) => el.textContent), /1月13日：\d+ 项.*挪进备选池再改/);
    await shot(page, '11-dates-need-move');
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => /1月12日 周二 · 3 天/.test(document.querySelector('[data-testid="settings-dates-demo-island"]')?.textContent || ''), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('新建行程、改日期：375 / 1280 / 深色都不横向滚动，可点的 ≥44', async () => {
  for (const o of [{ device: 'small' }, { device: 'desktop' }, { colorScheme: 'dark' }]) {
    const app = await openNew(o);
    const { page } = app;
    try {
      await page.click(T('trip-new-quick-tokyo'));
      await page.click(T('trip-new-cal-2027-01-20'));
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, T('sheet-trip-new'));
      await shot(page, `12-new-${o.device || o.colorScheme}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
