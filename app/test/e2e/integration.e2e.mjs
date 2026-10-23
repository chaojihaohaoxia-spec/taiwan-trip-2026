// =====================================================================
// test/e2e/integration.e2e.mjs：整合以后从用户角度把一整天走一遍，以及页面之间的跳转（SPEC §4、§5、§6、§10）。
//
//   一整天（演示椰影岛，行程中 2027-01-11 10:00 越南时间）：
//     早上打开 → 直接到今天的每天页（现在那条高亮）→ 展开它、叫 Grab（先复制地址、1.5 秒没切走给提示）→
//     ＋ → 记一笔（350 →「千」→ 记下这笔 → 「已记一笔 · 查看」去账本、那一笔高亮）→ 清单里勾一个待办（可撤销）→
//     ＋ → 拍照打卡（瓷砖上就是相机，拍完写日记面板带着照片打开）→ 写两句、保存 → 日记相册里有了 →
//     晚上账本「记为已结清」→ 行程结束后的回顾也显示已结清（和账本同一份数据）。
//   跳转：概览 → 天 → 条目展开；搜索 → 条目；地图 → 地点弹层；＋ 面板 → 各弹层；更多菜单 → 各页；预订 ↔ 条目 ↔ 地点 ↔ 账目。
//   SPEC §10：度假村里的餐厅、海上的桥、只能坐缆车的岛——地点弹层、给司机看、动作行的按钮和说明。
//
// 截图：<截图根目录>/__shots__/integration/（每一步一张）。
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, shotsDir } from './lib/harness.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { grabBookingUrl, addressForCopy, uuidv5 } from '../../src/lib/ride-links.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const PHOTO = path.join(APP, 'demo', 'photos', 'demo-photo-05.jpg');
const SHOTS = shotsDir('integration');
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = '2027-01-11T10:00:00+07:00';
const DAY2 = island('days').find((d) => d.date === '2027-01-11');
const DIVE = island('items').find((i) => i.day_id === DAY2.id && i.title === '半日浮潜');
const placeOf = (id) => island('places').find((p) => p.id === id);
const pid = (key) => uuidv5(`demo-island:${key}`);

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

const hash = (page) => page.evaluate(() => location.hash);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
const toastText = (page, re) => page.waitForFunction((src) => {
  const t = [...document.querySelectorAll('[data-overlay-toasts] *')].map((e) => e.textContent).find((x) => new RegExp(src).test(x));
  return t || null;
}, { timeout: 6000 }, re.source);
async function clickToastAction(page, label) {
  const btn = await page.waitForFunction((l) => [...document.querySelectorAll('[data-overlay-toasts] button')].find((b) => b.textContent.includes(l)) || null, { timeout: 6000 }, label);
  await btn.asElement().click();
}
async function openFab(page) {
  await page.click(T('shell-fab'));
  await page.waitForFunction(() => location.hash.endsWith('?sheet=fab') || location.hash.includes('sheet=fab'));
  await waitForAnimationsDone(page, 6000);
}

test('一整天（演示、行程中）：早上打开到今天 → 叫 Grab 去这一站 → 记一笔 → 勾待办 → 拍照写日记 → 晚上结清；结束后的回顾也是已结清', async () => {
  const app = await openApp({ browser, server, hash: '', now: NOW, intercept: false });
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    // 外链（Google 地图、Grab）回 204：浏览器留在原页（相当于“跳过去了但没切走”），记下网址；其他外网一律拦掉
    const opened = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith(server.origin) || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
      if (/^https:\/\/(www\.google\.com\/maps|grab\.onelink\.me)\//.test(url)) {
        opened.push(url);
        return req.respond({ status: 204, body: '' });
      }
      return req.abort('blockedbyclient');
    });

    // 1. 早上打开：行程进行中 → 直接到今天的每天页，现在那条（半日浮潜）高亮、标「进行中」
    await page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-11', { timeout: 10000 });
    await page.waitForSelector(`${T(`item-${DIVE.id}`)}[data-current]`, { timeout: 10000 });
    await app.idle();
    await shot(page, '01-morning-today');

    // 2. 展开现在这一条 → 动作行 → 叫 Grab：先复制「当地语名 + 地址」，再跳 Grab；1.5 秒没切走 → 提示 +「打开 Grab」
    //    批 A：浮潜写了步行过去，动作行只给导航；叫车在最后的「⋯」里临时用（动作键 grab 改名 ride）
    const header = `${T(`item-${DIVE.id}`)} .xcard__header`;
    if (await page.$eval(header, (el) => el.getAttribute('aria-expanded')) !== 'true') await page.click(header);
    await page.waitForSelector(T(`item-actions-${DIVE.id}-more`), { visible: true });
    await waitForAnimationsDone(page, 6000);
    await page.$eval(T(`item-actions-${DIVE.id}-more`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`item-actions-${DIVE.id}-more`));
    const grabSel = `${T(`item-actions-${DIVE.id}-more-row`)} [data-action="ride"]`;
    await page.waitForSelector(grabSel, { visible: true });
    await waitForAnimationsDone(page, 6000);
    const dive = placeOf(DIVE.place_id);
    assert.equal(await page.$eval(grabSel, (el) => el.getAttribute('href')), grabBookingUrl(dive));
    await page.$eval(grabSel, (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '02-item-actions');
    await page.click(grabSel);
    await sleep(300);
    assert.equal(opened.at(-1), grabBookingUrl(dive), '跳了 Grab（目的地预填）');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), addressForCopy(dive), '地址先复制好了');
    await toastText(page, /没打开 Grab？地址已复制/);
    await shot(page, '03-grab-fallback');

    // 3. ＋ → 记一笔：金额框直接有焦点；350 →「千」→ 350,000；记下 → 转圈 → 对勾 → 面板收回 →「已记一笔 · 查看」
    await openFab(page);
    await shot(page, '04-fab');
    await page.click(T('fab-expense'));
    await page.waitForSelector(`${T('sheet-expense')} ${T('xf-amount-input')}`);
    await waitForAnimationsDone(page, 6000);
    await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'xf-amount-input', { timeout: 4000 });
    await page.keyboard.type('350');
    await page.click(T('xf-quick-k'));
    await page.waitForFunction(() => /350,000/.test(document.querySelector('[data-testid="xf-amount-input"]')?.value || ''));
    assert.equal(await page.$eval(T('xf-date'), (el) => el.value), '2027-01-11', '日期默认今天（行程时区）');
    await shot(page, '05-expense-350k');
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="sheet-expense"]'), { timeout: 8000 });
    await toastText(page, /已记一笔/);
    await clickToastAction(page, '查看');
    await page.waitForFunction(() => location.hash.startsWith('#/t/demo-island/ledger'), { timeout: 8000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="ledger-expense-"]')].some((el) => /350,000/.test(el.textContent)), { timeout: 8000 });
    await app.idle();
    await shot(page, '06-ledger-new');

    // 4. 清单：勾一个待办 → 圆圈打勾、沉到下面；提示能撤销
    await app.go('#/t/demo-island/lists?list=todo');
    await page.waitForSelector('[data-testid^="todo-check-"]');
    const todoId = await page.$$eval('[data-testid^="todo-check-"]', (els) => {
      const el = els.find((x) => x.dataset.state === 'off');
      return el ? el.dataset.testid.slice('todo-check-'.length) : null;
    });
    assert.ok(todoId, '有没勾的待办');
    await page.$eval(T(`todo-check-${todoId}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`todo-check-${todoId}`));
    await page.waitForFunction((tid) => document.querySelector(`[data-testid="${tid}"]`)?.dataset.state === 'on', { timeout: 4000 }, `todo-check-${todoId}`);
    await toastText(page, /撤销/);
    await shot(page, '07-todo-checked');

    // 5. ＋ → 拍照打卡：瓷砖上就是相机（file input），拍完写日记面板带着照片打开；写两句、保存
    await openFab(page);
    const input = await page.$(T('fab-photo-input'));
    assert.ok(input, '拍照打卡的瓷砖上叠着 file input');
    assert.equal(await page.$eval(T('fab-photo-input'), (el) => el.getAttribute('capture')), 'environment', '手机上直接开后置相机');
    await input.uploadFile(PHOTO);
    await page.waitForSelector(T('journal-sheet'), { timeout: 8000 });
    await page.waitForSelector(T('journal-photo'), { timeout: 10000 });
    assert.match(await hash(page), /sheet=journal:/);
    await waitForAnimationsDone(page, 6000);
    await page.click(T('journal-body'));
    await page.keyboard.type('浮潜看到了海龟，傍晚骑车去西岸看日落。');
    await shot(page, '08-journal-photo');
    await page.click(T('journal-save'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="journal-sheet"]'), { timeout: 10000 });
    await app.go('#/t/demo-island/journal');
    await page.waitForFunction(() => /浮潜看到了海龟/.test(document.querySelector('[data-testid="page-journal"]')?.textContent || ''), { timeout: 8000 });
    await app.idle();
    await shot(page, '09-journal-page');

    // 6. 晚上看账本：按币种分别结 → 记为已结清 → 扯平
    await app.go('#/t/demo-island/ledger');
    await page.waitForSelector(T('ledger-settle-btn'));
    await page.$eval(T('ledger-settle'), (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '10-ledger-settle');
    await page.click(T('ledger-settle-btn'));
    // 先问一句，列出要记下的金额（10-14 现场走查 P2-9）
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 8000 });
    assert.match(await page.$eval('[role="alertdialog"], [role="dialog"]', (el) => el.textContent), /应给|给 /);
    await page.click(T('dialog-confirm'));
    await page.waitForSelector(T('ledger-settle-last'), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    await shot(page, '11-ledger-settled');

    // 7. 行程结束以后（同一台设备，“现在”拨到 01-20）：概览的回顾显示已结清（和账本同一份数据），不再说谁欠谁
    await page.goto(`${server.url}?demo=1&nosw=1&now=2027-01-20T10:00:00%2B07:00#/t/demo-island`, { waitUntil: 'load' });
    await page.waitForSelector(T('ov-settle'), { timeout: 10000 });
    assert.equal(await page.$eval(T('ov-settle'), (el) => el.dataset.lines), '0');
    assert.match(await page.$eval(T('ov-settle'), (el) => el.textContent), /已结清，两人扯平了/);
    await page.$eval(T('ov-settle'), (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '12-recap-settled');
    await assertNoHorizontalOverflow(page);
  } finally {
    await app.close();
  }
});

test('页面之间的跳转：概览 → 天 → 条目展开；搜索 → 条目；地图 → 地点弹层；更多菜单 → 各页；预订 → 条目 / 地点；地点 → 那一天', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island', now: NOW });
  const { page } = app;
  try {
    // 概览「现在」大卡的标题行 → 那一天并展开那一条
    await page.waitForSelector(T('page-trip'));
    await page.waitForFunction(() => location.hash.startsWith('#/t/demo-island'), { timeout: 8000 });
    // 概览上不再有今天的时间轴缩略（「杂志纸本」：和那一天的页面重复），从「现在」大卡的标题行点进去
    const timelineRow = await page.waitForSelector('[data-testid="ov-now-title"][href*="item="]', { timeout: 8000 });
    const target = await timelineRow.evaluate((el) => el.getAttribute('href'));
    const itemId = new URLSearchParams(target.split('?')[1]).get('item');
    await timelineRow.click();
    await page.waitForFunction(() => location.hash.startsWith('#/t/demo-island/day/2027-01-11'), { timeout: 8000 });
    await page.waitForSelector(`${T(`item-${itemId}`)} .xcard__header[aria-expanded="true"]`, { timeout: 8000 });
    await shot(page, '20-overview-to-day');

    // 搜索 → 条目（越南语不带声调）：去那一天并展开
    await page.click(`${T('shell-search')} .search-x__trigger`);
    await page.waitForFunction(() => document.querySelector('[data-testid="shell-search"]')?.dataset.state === 'open');
    await page.focus(`${T('shell-search')} input`);
    await page.keyboard.type('pho');
    // 等结果出齐（命中的「phở」高亮出来、列表不再变）再点，免得点在正在重排的行上
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="search-layer"] mark')].some((m) => m.textContent.normalize('NFC').toLowerCase() === 'phở'), { timeout: 8000 });
    await app.idle();
    await sleep(400);
    const res = await page.waitForSelector('[role="option"][href*="/day/"]', { timeout: 8000 });
    await res.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const resHref = await res.evaluate((el) => el.getAttribute('href'));
    const resItem = new URLSearchParams(resHref.split('?')[1]).get('item');
    await res.click();
    await page.waitForFunction((h) => location.hash.startsWith(h.split('?')[0]), { timeout: 8000 }, resHref);
    await page.waitForSelector(`${T(`item-${resItem}`)} .xcard__header[aria-expanded="true"]`, { timeout: 8000 });
    await shot(page, '21-search-to-item');

    // 地图 → 选中地点（?place=）→ 小卡 → 地点详情弹层
    const kitchen = pid('place:garden-kitchen');
    await app.go(`#/t/demo-island/map?day=all&place=${kitchen}`);
    await page.waitForSelector(T('map-card'), { timeout: 10000 });
    assert.match(await page.$eval(T('map-card'), (el) => el.textContent), /在度假村大堂下车/, '地图小卡也说下车提示（SPEC §10）');
    await shot(page, '22-map-card');
    await page.click(T('map-card-open'));
    await page.waitForSelector(T('sheet-place'), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    assert.match(await page.$eval(`${T('sheet-place')} .ov-sheet__title`, (el) => el.textContent), /园中厨房/);
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));

    // 更多菜单 → 每一页（返回回到原页）
    for (const name of ['bookings', 'lists', 'journal', 'places', 'tips', 'contacts']) {
      await app.go('#/t/demo-island');
      await page.click(T('tab-more'));
      await page.waitForSelector(T(`more-${name}`), { timeout: 8000 });
      await waitForAnimationsDone(page, 6000);
      await page.click(T(`more-${name}`));
      await page.waitForSelector(T(`page-${name}`), { timeout: 10000 });
      assert.match(await hash(page), new RegExp(`^#/t/demo-island/${name}`));
    }

    // 预订详情 → 「行程里的安排」去那一天、展开那一条；地点详情 →「在行程里」去那一天
    const booking = island('bookings').find((b) => island('items').some((i) => i.booking_id === b.id && i.day_id));
    const linkedItem = island('items').find((i) => i.booking_id === booking.id && i.day_id);
    await app.go(`#/t/demo-island/bookings?sheet=booking:${booking.id}`);
    await page.waitForSelector(T('sheet-booking'), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    await page.waitForSelector(`${T('sheet-booking')} ${T('booking-item')}`, { timeout: 8000 });
    const idx = await page.$$eval(`${T('sheet-booking')} ${T('booking-item')}`, (els, title) => els.findIndex((e) => e.textContent.includes(title)), linkedItem.title);
    assert.ok(idx >= 0, '预订详情里列出了关联的条目');
    const toItem = (await page.$$(`${T('sheet-booking')} ${T('booking-item')}`))[idx];
    await toItem.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await toItem.click();
    await page.waitForFunction((id) => location.hash.includes('/day/') && !location.hash.includes('sheet='), { timeout: 8000 }, linkedItem.id);
    await page.waitForSelector(`${T(`item-${linkedItem.id}`)} .xcard__header[aria-expanded="true"]`, { timeout: 8000 });
    await shot(page, '23-booking-to-item');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('SPEC §10 地点叫车提示：海上的桥 → 岸上看台（叫 Grab、给司机看），导航仍到桥；只能坐缆车的岛 →「去缆车站」+ 说明 + 大概位置', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/places', now: NOW });
  const { page } = app;
  try {
    const bridge = placeOf(pid('place:love-bridge'));
    const deck = placeOf(pid('place:bridge-deck'));
    await app.go(`#/t/demo-island/places?sheet=place:${bridge.id}`);
    await page.waitForSelector(T('sheet-place'), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    const acts = await page.$$eval(`${T('sheet-place')} [data-action]`, (els) => Object.fromEntries(els.map((e) => [e.dataset.action, { href: e.getAttribute('href'), text: e.textContent.trim() }])));
    const navDest = new URL(acts.nav.href).searchParams.get('destination');
    assert.equal(navDest, `${bridge.lat},${bridge.lng}`, '导航到桥本身（步行认路）');
    // 批 A：动作键 grab 改名 ride（地点页按目的地档案：越南叫 Grab）
    const dp = decodeURIComponent(new URL(acts.ride.href).searchParams.get('af_dp'));
    assert.match(dp, new RegExp(`dropOffLatitude=${deck.lat}`), '叫 Grab 去岸上的看台');
    assert.match(await page.$eval(T('sheet-place'), (el) => el.textContent), /在南岸看台下车/);
    await shot(page, '30-bridge-place');
    await page.click(`${T('sheet-place')} [data-action="driver"]`);
    await page.waitForSelector(T('driver-card'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), deck.name_local, '给司机看的是看台');
    assert.match(await page.$eval(T('driver-card'), (el) => el.textContent), /在南岸看台下车/);
    await shot(page, '31-bridge-driver');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 8000 });

    const isle = placeOf(pid('place:cloud-isle'));
    await app.go(`#/t/demo-island/places?sheet=place:${isle.id}`);
    await page.waitForFunction(() => /云屿/.test(document.querySelector('[data-testid="sheet-place"] .ov-sheet__title')?.textContent || ''), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(`${T('sheet-place')} [data-action="ride"]`, (el) => el.textContent.trim()), '去缆车站');
    const text = await page.$eval(T('sheet-place'), (el) => el.textContent);
    assert.match(text, /开车到不了/);
    assert.match(text, /大概位置/);
    await shot(page, '32-isle-place');
    app.assertClean();
  } finally {
    await app.close();
  }
});
