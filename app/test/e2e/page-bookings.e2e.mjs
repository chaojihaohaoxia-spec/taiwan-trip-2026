// 预订页（#/t/:tripId/bookings）和预订详情弹层（?sheet=booking:<id>）：
//   出发前的汇总四格（还没订 / 待确认 / 到店付 / 最近的免费取消）和数字对得上、点格子筛选（?only=，FLIP 半路图）、按类型 ↔ 按日期（?by=，本机记住）；
//   卡片：登机牌、入住退房、订单号点一下复制、动作行、司机一键打电话；
//   详情弹层：从卡片打开（半路图）、正在看的卡描边、全部内容（付款、附件签名链接、管理链接、联系人 wa.me、待办能勾、行程里的安排能跳）、
//            一键「商家确认了」+ 撤销、编辑（订金没填摇头 → 填好保存转圈 → 对勾 → 回到看的样子）、改了一半关面板先问；
//   网址直接打开详情 / 编辑 / 找不到；行程进行中默认按日期并滚到今天、「进行中」芯片；已结束的回顾；空行程；只读成员；
//   手机 390 / 375、桌面 1280、深色：没有报错、不横向滚动、可点的 ≥44px。
// 截图：<截图根目录>/__shots__/page-bookings/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir, fullPageShots } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone, withPlaybackRate } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const B = island('bookings');
const byTitle = (re) => B.find((b) => re.test(b.title));
const FLIGHT = B.find((b) => b.kind === 'flight' && b.attachments?.length);
const HOTEL_A = B.find((b) => b.kind === 'hotel' && b.payment_status === 'pay_at_property');
const HOTEL_B = B.find((b) => b.kind === 'hotel' && b.status === 'pending');
const SNORKEL = byTitle(/浮潜/);
const PICKUP = B.find((b) => b.kind === 'transfer' && b.details?.driver_contact_id);
const CANCELLED = B.find((b) => b.status === 'cancelled');
const PRE = '2027-01-08T09:00:00+07:00';
const DURING = '2027-01-11T10:00:00+07:00';
const SHOTS = shotsDir('page-bookings');
const T = (id) => `[data-testid="${id}"]`;
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

/** 打开预订页并等数据到了 */
async function openBookings(o = {}) {
  const { trip = 'demo-island', query = '', ...rest } = o;
  const app = await openApp({ browser, server, hash: `#/t/${trip}/bookings${query}`, now: PRE, ...rest });
  await app.page.waitForSelector(T('page-bookings'), { timeout: 10000 });
  await app.page.waitForFunction(() => !document.querySelector('[data-testid="page-bookings"] .reveal[data-loading]'), { timeout: 10000 });
  await app.idle();
  return app;
}

const hash = (page) => page.evaluate(() => location.hash);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const visibleCards = (page) => page.$$eval('[data-testid="bookings-list"] .bk-card', (els) => els.map((el) => el.dataset.testid.replace('booking-', '')));

/** 等预订详情弹层打开、出场动画播完 */
async function waitSheet(page, id) {
  await page.waitForSelector(`${T('booking-detail')}[data-booking="${id}"], ${T('booking-form')}`, { timeout: 10000 });
  await waitForAnimationsDone(page, 10000);
}

async function closeSheet(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !location.hash.includes('sheet=booking'), { timeout: 6000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="sheet-booking"]'), { timeout: 6000 });
}

/** 弹层内容区滚到某个元素（弹层自己滚，不是整页） */
async function sheetScrollTo(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(120);
}

/** 只检查某一块里的可点元素 ≥44px（外壳的顶栏、底栏由外壳自己的测试管） */
async function assertTapTargetsIn(page, root, min = 44) {
  const small = await page.evaluate((rootSel, minSize) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], [role="tab"], [role="radio"], input:not([type="hidden"]), select, textarea';
    for (const el of document.querySelectorAll(`${rootSel} :is(${sel})`)) {
      if (el.closest('[inert]')) continue;
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
      if (w < minSize - 0.5 || h < minSize - 0.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}」${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  }, root, min);
  assert.deepEqual(small, [], `触控区不到 ${min}px：\n${small.join('\n')}`);
}

// ---------------------------------------------------------------------
// 出发前：汇总、卡片、筛选、分组方式
// ---------------------------------------------------------------------

test('出发前：汇总一行字的数字和数据对得上（是 0 的那类不写）；卡片按类型分组、组内按时间；登机牌、入住退房、订单号、价格都在；不横向滚动、可点的 ≥44px', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    const live = B.filter((b) => b.status !== 'cancelled');
    // 「杂志纸本」：汇总是一行字「2 还没订 · 2 待确认 · 1 到店付」，是 0 的那类不写
    const num = async (key) => Number(await page.$eval(T(`tile-${key}`), (el) => el.querySelector('.bkp-sum__n').textContent).catch(() => 0));
    assert.equal(await num('idea'), live.filter((b) => b.status === 'idea').length);
    assert.equal(await num('pending'), live.filter((b) => b.status === 'pending').length);
    assert.equal(await num('property'), live.filter((b) => b.status !== 'idea' && b.payment_status === 'pay_at_property').length);
    // 到店付：一行里只写折合港币（原币金额在卡片和详情里）
    assert.match(await text(page, T('tile-property-sum')), /约 HK\$/);
    assert.equal(await page.$$eval('[data-testid="bookings-summary"] .bkp-tile, [data-testid="bookings-summary"] .bkp-sum__grid', (els) => els.length), 0, '不再是格子');
    // 最近的免费取消：南岬海景屋（还剩不到一天：红色）
    assert.equal(await page.$eval(T('tile-deadline'), (el) => el.dataset.deadline), 'urgent');
    assert.match(await text(page, T('tile-deadline')), new RegExp(HOTEL_B.title.split(' · ')[0]));
    // 卡片：已取消的不在列表里（收在最下面）
    const cards = await visibleCards(page);
    assert.equal(cards.length, live.length);
    assert.ok(!cards.includes(CANCELLED.id));
    // 段标题的顺序
    const heads = await page.$$eval('[data-testid="bookings-list"] .bkp-head', (els) => els.map((el) => el.dataset.group));
    assert.deepEqual(heads, ['flight', 'hotel', 'activity', 'transfer', 'restaurant', 'other']);
    // 登机牌：三字码、起降时间（各自时区）
    assert.match(await text(page, `${T(`booking-${FLIGHT.id}`)} .bk-pass`), new RegExp(`${FLIGHT.details.from_iata}.*08:05.*${FLIGHT.details.to_iata}.*10:20`));
    assert.match(await text(page, `${T(`booking-${FLIGHT.id}`)} .bk-pass`), /落地按越南时间（比香港慢 1 小时）/);
    // 酒店：入住 / 退房、地址、动作行（导航是 Google 地图链接）
    assert.match(await text(page, T(`stay-${HOTEL_A.id}`)), /入住\s*14:00.*退房\s*12:00/);
    const nav = await page.$eval(`${T(`acts-${HOTEL_A.id}`)} [data-action="nav"]`, (el) => el.getAttribute('href'));
    assert.match(nav, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
    // 订单号、价格
    assert.equal(await text(page, T(`code-${HOTEL_A.id}-text`)), HOTEL_A.confirmation_code);
    assert.match(await text(page, T(`price-${HOTEL_A.id}`)), /2,400,000₫.*约 HK\$/);
    // 免费取消：≤48 小时的是警示色（浮潜 47.5 小时）、过了的「已不可免费取消」
    assert.equal(await page.$eval(`${T(`chips-${SNORKEL.id}`)} [data-deadline]`, (el) => el.dataset.deadline), 'soon');
    assert.match(await text(page, T(`chips-${HOTEL_A.id}`)), /已不可免费取消/);
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-bookings'));
    await fullPageShots(page, path.join(SHOTS, 'upcoming-390.png'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('卡片：订单号点一下复制（提示「已复制订单号」）、长按能选中；点卡片里的复制不会打开详情；接送卡上的司机能一键打电话', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    await page.$eval(T(`code-${HOTEL_A.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    await page.click(`${T(`code-${HOTEL_A.id}`)} .bk-code__btn`);
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent.includes('已复制订单号')), { timeout: 4000 });
    await sleep(300);
    assert.ok(!(await hash(page)).includes('sheet='), '复制不会顺便打开详情');
    assert.equal(await page.$eval(T(`code-${HOTEL_A.id}`), (el) => el.classList.contains('bk-code--done')), true, '图标变成对勾');
    // 长按选中：文字可以整串选中
    assert.equal(await page.$eval(T(`code-${HOTEL_A.id}-text`), (el) => getComputedStyle(el).userSelect), 'all');
    // 司机：打电话是 tel:，Zalo 是 zalo.me
    const driverId = PICKUP.details.driver_contact_id;
    const driver = island('contacts').find((c) => c.id === driverId);
    const acts = await page.$$eval(`${T(`booking-${PICKUP.id}`)} [data-contact-action]`, (els) => els.map((el) => [el.dataset.contactAction, el.getAttribute('href')]));
    assert.equal(acts[0][0], 'call');
    assert.equal(acts[0][1], `tel:${driver.phone.startsWith('+') ? '+' : ''}${driver.phone.replace(/\D/g, '')}`);
    if (driver.zalo) assert.ok(acts.some(([k, h]) => k === 'zalo' && h.startsWith('https://zalo.me/')));
    // 酒店卡：前台能一键打电话 / WhatsApp
    assert.ok(await page.$(`${T(`contact-${HOTEL_A.id}`)} [data-contact-action="call"]`));
    // 管理链接：新标签页打开（走 openExternal）；确认单：打开详情并滚到「附件」
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => {
        window.__opened.push(String(url));
        return {};
      };
    });
    await page.$eval(T(`link-${HOTEL_A.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`link-${HOTEL_A.id}`));
    assert.match((await page.evaluate(() => window.__opened))[0], /^https:\/\/example\.com\//);
    assert.ok(!(await hash(page)).includes('sheet='), '点链接不会打开详情');
    await page.$eval(T(`files-${FLIGHT.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`files-${FLIGHT.id}`));
    await page.waitForFunction((id) => location.hash.includes(`sheet=booking:id.${id}~t.files`), { timeout: 6000 }, FLIGHT.id);
    await waitSheet(page, FLIGHT.id);
    await sleep(700);
    const box = await page.$eval(T('booking-files'), (el) => el.getBoundingClientRect().toJSON());
    assert.ok(box.top >= 0 && box.top < 700, `滚到了「附件」：${box.top}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('点汇总的「待确认」只看待确认的（?only=pending，卡片 FLIP 半路图），再点一下 / 点筛选芯片的 × 回到全部；按日期分组（?by=date）本机记住', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    const all = await visibleCards(page);
    const pending = B.filter((b) => b.status === 'pending').map((b) => b.id);
    const mid = await captureAt(app, () => page.click(T('tile-pending')), {
      selector: '.bk-card',
      progress: 0.4,
      evaluate: () => document.querySelectorAll('[data-testid="bookings-list"] .bk-card').length,
    });
    await page.screenshot({ path: path.join(SHOTS, 'filter-pending-40.png'), captureBeyondViewport: false });
    await release(mid);
    await waitForAnimationsDone(page, 10000);
    assert.match(await hash(page), /only=pending/);
    assert.deepEqual((await visibleCards(page)).sort(), [...pending].sort());
    assert.equal(await page.$eval(T('tile-pending'), (el) => el.getAttribute('aria-pressed')), 'true');
    assert.match(await text(page, T('bookings-filter')), /只看待确认/);
    await page.screenshot({ path: path.join(SHOTS, 'filter-pending-end.png'), captureBeyondViewport: false });
    // 再点一下取消
    await page.click(T('tile-pending'));
    await page.waitForFunction(() => !location.hash.includes('only='));
    await waitForAnimationsDone(page, 10000);
    assert.equal((await visibleCards(page)).length, all.length);
    // 「到店付」→ 芯片的 × 回到全部
    await page.click(T('tile-property'));
    await page.waitForFunction(() => location.hash.includes('only=property'));
    await page.click(`${T('bookings-filter')} .chip__remove`);
    await page.waitForFunction(() => !location.hash.includes('only='));
    // 等格子的阴影过渡、卡片 FLIP 播完再截下一段半路图（截图工具把全页动画速度拨成 0 时，正在播的过渡会被卡住）
    await waitForAnimationsDone(page, 10000);
    // 0 个的格子不能点
    // （出发前「还没订」有 1 个，可以点；找一个确实是 0 的场景在“已经确认完”的用例里测）
    // 按日期：段标题变成日期，新列表淡入上浮（不是卡片跨组乱飞、叠在一起）
    const swap = await captureAt(app, () => page.click(`${T('bookings-mode')} [data-index="1"]`), {
      selector: '.bkp-list',
      progress: 0.5,
      evaluate: () => ({ op: Number(getComputedStyle(document.querySelector('.bkp-list')).opacity), cards: document.querySelectorAll('.bk-card').length }),
    });
    await page.screenshot({ path: path.join(SHOTS, 'mode-date-50.png'), captureBeyondViewport: false });
    await release(swap);
    assert.ok(swap.state.op > 0.05 && swap.state.op < 0.99, `半路是半透明的：${swap.state.op}`);
    assert.equal(swap.state.cards, all.length, '半路没有新旧两份卡片叠在一起');
    await waitForAnimationsDone(page, 10000);
    assert.match(await hash(page), /by=date/);
    assert.equal(await page.$eval(T('page-bookings'), (el) => el.dataset.by), 'date');
    const heads = await page.$$eval('[data-testid="bookings-list"] .bkp-head', (els) => els.map((el) => el.dataset.group));
    assert.deepEqual(heads, ['2027-01-10', '2027-01-11', '2027-01-12', '2027-01-13']);
    assert.match(await text(page, '.bkp-head[data-group="2027-01-10"]'), /1月10日 周日.*后天 · D1/);
    // 本机记住：去掉 ?by= 再打开还是按日期
    await app.go('#/t/demo-island/bookings');
    await page.waitForSelector(T('bookings-list'));
    assert.equal(await page.$eval(T('page-bookings'), (el) => el.dataset.by), 'date');
    await fullPageShots(page, path.join(SHOTS, 'upcoming-by-date-390.png'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 详情弹层
// ---------------------------------------------------------------------

test('详情：点卡片从底部升起（半路图），网址 ?sheet=booking:<id>，正在看的卡描边；登机牌、订单号、付款（谁付、加购）、附件（签名链接）、管理链接、待办、行程里的安排都在；Esc 关掉焦点回到卡片', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    // 先开关一次（第一次要下载弹层的代码），半路图拍第二次
    await page.click(T(`booking-open-${FLIGHT.id}`));
    await waitSheet(page, FLIGHT.id);
    await closeSheet(page);
    await app.idle();
    const mid = await captureAt(app, () => page.click(T(`booking-open-${FLIGHT.id}`)), {
      selector: '.ov-sheet',
      progress: 0.35,
      evaluate: () => {
        const r = document.querySelector('[data-testid="sheet-booking"]').getBoundingClientRect();
        return { top: r.top, vh: window.innerHeight };
      },
    });
    await page.screenshot({ path: path.join(SHOTS, 'sheet-open-35.png'), captureBeyondViewport: false });
    await release(mid);
    assert.ok(mid.state.top > 80 && mid.state.top < mid.state.vh, `半路还在往上升：${JSON.stringify(mid.state)}`);
    await waitSheet(page, FLIGHT.id);
    await page.screenshot({ path: path.join(SHOTS, 'sheet-flight.png'), captureBeyondViewport: false });
    assert.match(await hash(page), new RegExp(`sheet=booking:${FLIGHT.id}`));
    assert.notEqual(await page.$eval(T(`booking-${FLIGHT.id}`), (el) => el.getAttribute('data-current')), null, '正在看的卡描一圈');
    assert.equal(await text(page, '[data-testid="sheet-booking"] .ov-sheet__title'), FLIGHT.title);
    assert.equal(await text(page, T('booking-code-text')), FLIGHT.confirmation_code);
    assert.match(await text(page, T('booking-payment')), /总价.*¥1,460.*已付.*Jeremy 付的 · 微信.*加购：托运 20kg × 1/);
    // 附件：签名链接拿到以后才能点；点了走 openExternal（新标签页）
    await sheetScrollTo(page, T('booking-file'));
    await page.waitForSelector(`${T('booking-file')}[data-ready="true"]`, { timeout: 8000 });
    const pdf = await page.$eval(T('booking-file'), (el) => el.href);
    assert.match(pdf, /\.pdf$/);
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => {
        window.__opened.push(String(url));
        return {};
      };
    });
    await page.click(T('booking-file'));
    await page.click(T('booking-link'));
    const opened = await page.evaluate(() => window.__opened);
    assert.equal(opened[0], pdf);
    assert.match(opened[1], /^https:\/\/example\.com\/manage\//);
    // 待办、行程里的安排
    assert.ok(await page.$(T('booking-todos')));
    assert.ok((await page.$$(T('booking-item'))).length >= 1);
    await sheetScrollTo(page, T('booking-items'));
    await page.screenshot({ path: path.join(SHOTS, 'sheet-flight-bottom.png'), captureBeyondViewport: false });
    await assertTapTargetsIn(page, T('sheet-booking'));
    // Esc：关掉，焦点回到这张卡
    await closeSheet(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.testid), `booking-open-${FLIGHT.id}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('详情（酒店）：入住退房、免费取消已过、地址 + 导航 / 叫 Grab / 给司机看 / 复制地址、到店付金额、押金、联系人（WhatsApp 是 https://wa.me/<号码>）、备注', async () => {
  const app = await openBookings({ query: `?sheet=booking:${HOTEL_A.id}` });
  const { page } = app;
  try {
    await waitSheet(page, HOTEL_A.id);
    // 网址直接打开：那张卡滚进屏幕、描边
    assert.notEqual(await page.$eval(T(`booking-${HOTEL_A.id}`), (el) => el.getAttribute('data-current')), null);
    assert.match(await text(page, T(`stay-${HOTEL_A.id}`)), /入住\s*14:00.*2 晚.*退房\s*12:00/);
    assert.equal(await page.$eval(T('booking-cancel'), (el) => el.dataset.deadline), 'passed');
    assert.match(await text(page, T('booking-cancel')), /已不可免费取消.*1月5日 23:59（越南时间）/);
    const acts = await page.$$eval(`${T('booking-actions')} [data-action]`, (els) => els.map((el) => el.dataset.action));
    // 批 A：动作键 grab 改名 ride（叫哪家按目的地档案，越南还是「叫 Grab」）
    assert.deepEqual(acts, ['nav', 'ride', 'driver', 'copy']);
    assert.match(await text(page, T('booking-payment')), /到店付.*2,400,000₫.*押金.*500,000₫/);
    const wa = await page.$$eval(`${T('booking-contacts')} [data-contact-action="whatsapp"]`, (els) => els.map((el) => el.getAttribute('href')));
    assert.ok(wa.length >= 1 && wa.every((h) => /^https:\/\/wa\.me\/\d{7,}$/.test(h)), `WhatsApp 链接：${wa}`);
    assert.match(await text(page, T('booking-notes')), /押金/);
    await page.screenshot({ path: path.join(SHOTS, 'sheet-hotel.png'), captureBeyondViewport: false });
    await sheetScrollTo(page, T('booking-contacts'));
    await page.screenshot({ path: path.join(SHOTS, 'sheet-hotel-contacts.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('一键改状态：待确认的酒店点「商家确认了」→ 芯片变成已订、汇总少一个；Toast 的「撤销」改回去；待办在弹层里能直接勾', async () => {
  const app = await openBookings({ query: `?sheet=booking:${HOTEL_B.id}` });
  const { page } = app;
  try {
    await waitSheet(page, HOTEL_B.id);
    const pendingN = () => page.$eval(T('tile-pending'), (el) => Number(el.querySelector('.bkp-sum__n').textContent)).catch(() => 0);
    const before = await pendingN();
    await page.click(T('quick-confirm'));
    await page.waitForFunction(() => document.querySelector('[data-testid="booking-detail"] [data-status]')?.dataset.status === 'booked', { timeout: 6000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent.includes('已改成「已订」')), { timeout: 4000 });
    assert.equal(await pendingN(), before - 1);
    await page.screenshot({ path: path.join(SHOTS, 'quick-confirm.png'), captureBeyondViewport: false });
    await page.click('.ov-toast__action');
    await page.waitForFunction(() => document.querySelector('[data-testid="booking-detail"] [data-status]')?.dataset.status === 'pending', { timeout: 6000 });
    // 待办：勾上
    const todo = island('todos').find((t) => t.booking_id === HOTEL_B.id && !t.done);
    await sheetScrollTo(page, T(`booking-todo-${todo.id}`));
    await page.click(`${T(`booking-todo-${todo.id}`)} .check__box`);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="booking-todo-${id}"]`)?.dataset.state === 'on', { timeout: 4000 }, todo.id);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('编辑：订金没填就保存 → 摇头 + 原因；填「50万」保存 → 转圈（半路图）→ 对勾 → 回到看的样子，付款写着已付订金；改了一半关面板先问「放弃未保存的内容？」', async () => {
  const app = await openBookings({ query: `?sheet=booking:${HOTEL_A.id}` });
  const { page } = app;
  try {
    await waitSheet(page, HOTEL_A.id);
    await page.click(T('booking-edit'));
    await page.waitForSelector(T('booking-form'));
    await waitForAnimationsDone(page, 8000);
    await page.screenshot({ path: path.join(SHOTS, 'edit-form.png'), captureBeyondViewport: false });
    // 付了订金，不填金额 → 出错
    await page.click(`${T('form-payment')} [data-value="partial"]`);
    await page.waitForSelector(T('form-paid-amount'));
    await page.click(T('booking-save'));
    await page.waitForSelector('.bks-field__error', { timeout: 4000 });
    assert.match(await text(page, '.bks-field__error'), /填一下已经付了多少/);
    assert.equal(await page.$eval(T('form-paid-amount'), (el) => el.getAttribute('aria-invalid')), 'true');
    await waitForAnimationsDone(page, 8000);
    await page.screenshot({ path: path.join(SHOTS, 'edit-error.png'), captureBeyondViewport: false });
    // 填好：50万（越南盾口语写法）
    await page.click(T('form-paid-amount'));
    await page.keyboard.type('50万');
    // 边打边换算：= 500,000₫（约 HK$…） · 总价 2,400,000₫
    await page.waitForSelector(T('form-paid-preview'), { timeout: 4000 });
    assert.match(await text(page, T('form-paid-preview')), /^= 500,000₫（约 HK\$\d+） · 总价 2,400,000₫/);
    await page.$eval(T('form-code'), (el) => {
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.select();
    });
    await page.keyboard.type('DEMO-HT09');
    await sleep(2700); // 等「重试」的字退回「保存」
    // 保存：文字 → 转圈 → 对勾（动画放慢截对勾描到一半）→ 回到看的样子
    await page.click(T('booking-save'));
    await page.waitForSelector(`${T('booking-save')}[data-state="loading"]`, { timeout: 4000 });
    await page.screenshot({ path: path.join(SHOTS, 'edit-saving.png'), captureBeyondViewport: false });
    await withPlaybackRate(page, 0.15, async () => {
      await page.waitForSelector(`${T('booking-save')}[data-state="success"]`, { timeout: 6000 });
      await sleep(150);
      await page.screenshot({ path: path.join(SHOTS, 'edit-saved-check.png'), captureBeyondViewport: false });
    });
    await page.waitForSelector(T('booking-detail'), { timeout: 8000 });
    await waitForAnimationsDone(page, 8000);
    assert.match(await text(page, T('booking-payment')), /已付订金.*500,000₫.*还要付.*1,900,000₫/);
    assert.equal(await text(page, T('booking-code-text')), 'DEMO-HT09');
    assert.match(await text(page, T(`price-${HOTEL_A.id}`)), /已付订金 500,000₫/);
    await page.screenshot({ path: path.join(SHOTS, 'edit-saved.png'), captureBeyondViewport: false });
    // 改了一半关面板：先问
    await page.click(T('booking-edit'));
    await page.waitForSelector(T('form-notes'));
    await page.click(T('form-notes'));
    await page.keyboard.type('加一句');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov-dialog', { timeout: 4000 });
    assert.match(await text(page, '.ov-dialog__title'), /放弃/);
    await page.screenshot({ path: path.join(SHOTS, 'edit-confirm-close.png'), captureBeyondViewport: false });
    // 取消：面板和改动都还在
    await page.evaluate(() => [...document.querySelectorAll('.ov-dialog__action')].find((el) => el.textContent.includes('继续编辑')).click());
    await page.waitForFunction(() => !document.querySelector('.ov-dialog'), { timeout: 4000 });
    assert.match(await page.$eval(T('form-notes'), (el) => el.value), /加一句$/);
    // 底部「取消」：回到看的样子，改动不保存
    await page.click(T('booking-cancel-edit'));
    await page.waitForSelector(T('booking-detail'));
    assert.doesNotMatch(await text(page, T('booking-notes')), /加一句/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('网址直接打开：~m.edit 直接进编辑；找不到的预订说清楚、能关；行程里的安排点了跳到那一天并展开那一条', async () => {
  const app = await openBookings({ query: `?sheet=booking:id.${HOTEL_B.id}~m.edit` });
  const { page } = app;
  try {
    await page.waitForSelector(T('booking-form'), { timeout: 10000 });
    await page.click(T('booking-cancel-edit'));
    await page.waitForSelector(T('booking-detail'));
    // 行程里的安排 → 每天页 ?item=
    await sheetScrollTo(page, T('booking-item'));
    await page.click(T('booking-item'));
    await page.waitForFunction(() => /^#\/t\/demo-island\/day\/2027-01-\d\d\?item=/.test(location.hash), { timeout: 8000 });
    assert.ok(!(await hash(page)).includes('sheet='), '换页时弹层的历史清掉');
    // 找不到
    await app.go('#/t/demo-island/bookings?sheet=booking:00000000-0000-4000-8000-000000000000');
    await page.waitForSelector(T('booking-missing'), { timeout: 10000 });
    assert.match(await text(page, T('booking-missing')), /找不到这个预订/);
    await waitForAnimationsDone(page, 8000);
    await page.click(`${T('booking-missing')} button`);
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 6000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 行程进行中、已结束、空
// ---------------------------------------------------------------------

test('行程进行中：默认按日期、自动滚到今天那组（段标题停在顶栏下面）；正在进行的标「进行中」；今晚住的酒店「入住中」', async () => {
  const app = await openBookings({ now: DURING });
  const { page } = app;
  try {
    assert.equal(await page.$eval(T('page-bookings'), (el) => el.dataset.by), 'date');
    await page.waitForFunction(() => window.scrollY > 100, { timeout: 4000 });
    await waitForAnimationsDone(page, 8000);
    const top = await page.$eval('[data-group-today]', (el) => el.getBoundingClientRect().top);
    assert.ok(top > 40 && top < 200, `今天那组在屏幕上面：${top}`);
    assert.match(await text(page, '[data-group-today]'), /今天 · D2/);
    assert.ok(await page.$(`${T(`chips-${SNORKEL.id}`)} [data-now]`), '浮潜 08:30–12:30：进行中');
    assert.match(await text(page, `${T(`chips-${HOTEL_A.id}`)} [data-now]`), /入住中/);
    // 按日期：酒店在今天（入住第二天）有一行「续住 · 第 2 晚」、退房那天有一行「退房 12:00 前」，都在各自那一组里
    const groupOf = (sel) => page.$eval(sel, (el) => {
      let n = el.previousElementSibling;
      while (n && !n.matches('.bkp-head')) n = n.previousElementSibling;
      return n?.dataset.group || null;
    });
    assert.equal(await groupOf(T(`stay-night-${HOTEL_A.id}`)), '2027-01-11');
    assert.match(await text(page, T(`stay-night-${HOTEL_A.id}`)), /续住\s*第 2 晚（共 2 晚）/);
    assert.equal(await groupOf(T(`stay-out-${HOTEL_A.id}`)), '2027-01-12');
    assert.match(await text(page, T(`stay-out-${HOTEL_A.id}`)), /退房\s*12:00 前/);
    await assertTapTargetsIn(page, T('page-bookings'));
    await page.screenshot({ path: path.join(SHOTS, 'ongoing-390.png'), captureBeyondViewport: false });
    // 点「续住」那一行：打开这家酒店的详情
    await page.$eval(T(`stay-night-${HOTEL_A.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    await page.click(T(`stay-night-${HOTEL_A.id}`));
    await waitSheet(page, HOTEL_A.id);
    assert.match(await hash(page), new RegExp(`sheet=booking:${HOTEL_A.id}`));
    await page.screenshot({ path: path.join(SHOTS, 'ongoing-stay-sheet.png'), captureBeyondViewport: false });
    await closeSheet(page);
    await page.waitForFunction((sel) => document.activeElement?.matches(sel), { timeout: 4000 }, T(`stay-night-${HOTEL_A.id}`));
    // 按类型时：顶部有「今天」那一小张
    await page.click(`${T('bookings-mode')} [data-index="0"]`);
    await page.waitForSelector(T('bookings-today'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    assert.ok(await page.$(T(`today-${HOTEL_A.id}`)), '今晚住的酒店');
    assert.ok(await page.$(T(`today-${SNORKEL.id}`)), '今天的浮潜');
    await page.screenshot({ path: path.join(SHOTS, 'ongoing-by-kind-390.png'), captureBeyondViewport: false });
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('已结束的行程：顶部是回顾（几个预订、一共花了多少、取消了几个），卡片不再标「已结束」；空行程：「还没有预订」', async () => {
  const app = await openBookings({ trip: 'demo-cities', now: undefined });
  const { page } = app;
  try {
    await page.waitForSelector(T('bookings-recap'));
    const cities = DB.tables.bookings.filter((b) => b.trip_id === 'demo-cities');
    assert.match(await text(page, T('bookings-recap')), new RegExp(`^这趟的预订\\s*${cities.filter((b) => b.status !== 'cancelled').length}\\s*个`));
    assert.match(await text(page, T('bookings-recap')), /一共花了.*合计约 HK\$/);
    assert.equal(await page.$('.bk-chips [data-past]'), null, '整趟结束了，卡片不再一张张标「已结束」');
    await fullPageShots(page, path.join(SHOTS, 'ended-cities-390.png'));
    await assertNoHorizontalOverflow(page);
    await app.go('#/t/demo-empty/bookings');
    await page.waitForSelector(T('bookings-empty'), { timeout: 10000 });
    assert.match(await text(page, T('bookings-empty')), /还没有预订/);
    await page.screenshot({ path: path.join(SHOTS, 'empty-390.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出错：没有网络又没有缓存时说「现在没有网络」+ 重试（中文原因）；加载中是骨架', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/bookings', now: PRE, search: { demonet: 'offline' } });
  const { page } = app;
  try {
    await page.waitForSelector(T('bookings-error'), { timeout: 15000 });
    assert.match(await text(page, T('bookings-error')), /[一-鿿]/);
    assert.ok(await page.$(`${T('bookings-error')} button`), '有重试按钮');
    await page.screenshot({ path: path.join(SHOTS, 'offline-error.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
  // 慢网：先是骨架（四格 + 两张卡），数据到了交叉淡入
  const slow = await openApp({ browser, server, hash: '#/t/demo-island/bookings', now: PRE, search: { demolatency: '1500' } });
  try {
    await slow.page.waitForSelector('[data-testid="page-bookings"] .reveal[data-loading] .bkp-skel', { timeout: 8000 });
    await slow.page.screenshot({ path: path.join(SHOTS, 'loading-skeleton.png'), captureBeyondViewport: false });
    await slow.page.waitForSelector(T('bookings-list'), { timeout: 15000 });
    slow.assertClean();
  } finally {
    await slow.close();
  }
  // 减弱动态效果：照常能用，切分组方式只淡入
  const rm = await openBookings({ reducedMotion: true });
  try {
    await rm.page.click(`${T('bookings-mode')} [data-index="1"]`);
    await rm.page.waitForFunction(() => location.hash.includes('by=date'));
    await waitForAnimationsDone(rm.page, 8000);
    assert.equal(await rm.page.$eval('.bkp-list', (el) => getComputedStyle(el).translate), 'none');
    rm.assertClean();
  } finally {
    await rm.close();
  }
});

// ---------------------------------------------------------------------
// 只读成员
// ---------------------------------------------------------------------

test('只读成员：详情里没有「修改」、没有一键改状态，待办勾不了，写着为什么；复制、导航照常', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    // 先让演示后台把数据存进 IndexedDB（做一次改动），再把 Cathy 改成只读成员，以 Cathy 重新打开
    await page.click(T(`booking-open-${HOTEL_B.id}`));
    await waitSheet(page, HOTEL_B.id);
    await page.click(T('quick-confirm'));
    await sleep(1500);
    await closeSheet(page);
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
    url.hash = `#/t/demo-island/bookings?sheet=booking:${HOTEL_A.id}`;
    await page.goto(url.href);
    await waitSheet(page, HOTEL_A.id);
    await page.waitForSelector(T('booking-readonly'), { timeout: 8000 });
    assert.equal(await page.$(T('booking-edit')), null, '没有「修改」');
    assert.equal(await page.$('[data-testid^="quick-"]'), null, '没有一键改状态');
    assert.equal(await page.$(T('booking-expense')), null, '记一笔不给只读成员');
    const disabled = await page.$$eval(`${T('booking-todos')} input[type="checkbox"]`, (els) => els.every((el) => el.disabled));
    assert.ok(disabled, '待办勾不了');
    assert.ok(await page.$(`${T('booking-actions')} [data-action="nav"]`), '导航照常');
    await sheetScrollTo(page, T('booking-readonly'));
    await page.screenshot({ path: path.join(SHOTS, 'readonly.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 尺寸、深色
// ---------------------------------------------------------------------

test('375 小屏、桌面 1280、深色：没有报错、不横向滚动、内容居中有最大宽度、可点的 ≥44px；弹层在桌面居中', async () => {
  for (const o of [{ device: 'small' }, { device: 'desktop' }, { colorScheme: 'dark' }, { colorScheme: 'dark', now: DURING }]) {
    const app = await openBookings(o);
    const { page } = app;
    try {
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, T('page-bookings'));
      const name = `${o.device || o.colorScheme}${o.now ? '-ongoing' : ''}`;
      if (o.device === 'desktop') {
        const box = await page.$eval(T('page-bookings'), (el) => el.getBoundingClientRect().toJSON());
        assert.ok(box.width <= 720 + 1, `最大宽度：${box.width}`);
        assert.equal(await page.$$eval('.bkp-sum__line > *', (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size), 1, '桌面上汇总是一行字');
      }
      await page.screenshot({ path: path.join(SHOTS, `page-${name}.png`), captureBeyondViewport: false });
      await page.click(T(`booking-open-${HOTEL_B.id}`));
      await waitSheet(page, HOTEL_B.id);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(SHOTS, `sheet-${name}.png`), captureBeyondViewport: false });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

// ---------------------------------------------------------------------
// 第二轮：订单号点文字也复制、长按选中；附件上传 / 移除；长备注收起展开（半路图）；联系人一排按钮；
//         行程里的「还没订」：今天的放进「今天」、过去的标「时间已过」且不算进汇总
// ---------------------------------------------------------------------

test('订单号：点文字本身也复制（不留选中的蓝底）；按住不放（长按）只选中整串、不复制', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    const sel = T(`code-${HOTEL_A.id}-text`);
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    await page.tap(sel);
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent.includes('已复制订单号')), { timeout: 4000 });
    assert.equal(await page.evaluate(() => String(window.getSelection())), '', '点一下复制完不留选中');
    assert.ok(!(await hash(page)).includes('sheet='), '点订单号不会打开详情');
    await page.evaluate(() => document.querySelectorAll('.ov-toast').forEach((el) => el.remove()));
    // 长按：鼠标按住 0.6 秒再松开
    const box = await page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(600);
    await page.mouse.up();
    await sleep(400);
    assert.equal(await page.evaluate(() => String(window.getSelection())), HOTEL_A.confirmation_code, '长按选中整串');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('附件：编辑成员「添加确认单」（选 PDF，离线也能排队）→ 多一行、卡片上出现「确认单」；移除先确认、Toast 能撤销', async () => {
  const app = await openBookings({ query: `?sheet=booking:${HOTEL_B.id}` });
  const { page } = app;
  try {
    await waitSheet(page, HOTEL_B.id);
    await sheetScrollTo(page, T('booking-files'));
    assert.match(await text(page, T('booking-files')), /还没有确认单/);
    const input = await page.$(T('booking-file-input'));
    await input.uploadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo', 'files', 'demo-confirmation.pdf'));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="booking-file"]').length === 1, { timeout: 8000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent.includes('已添加确认单')), { timeout: 6000 });
    assert.match(await text(page, T('booking-file')), /demo-confirmation\.pdf.*PDF/);
    assert.match(await text(page, T('booking-file-add')), /再加一个/);
    await page.waitForSelector(`${T('booking-file')}[data-ready="true"]`, { timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, 'file-added.png'), captureBeyondViewport: false });
    assert.ok(await page.$(T(`files-${HOTEL_B.id}`)), '卡片上出现「确认单」');
    // 移除：先确认，再撤销
    await page.click(T('booking-file-remove'));
    await page.waitForSelector('.ov-dialog', { timeout: 4000 });
    assert.match(await text(page, '.ov-dialog__title'), /移除「demo-confirmation\.pdf」/);
    await page.evaluate(() => [...document.querySelectorAll('.ov-dialog__action')].find((el) => el.textContent.includes('移除')).click());
    await page.waitForFunction(() => !document.querySelector('[data-testid="booking-file"]'), { timeout: 6000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent.includes('已移除附件')), { timeout: 4000 });
    await page.evaluate(() => [...document.querySelectorAll('.ov-toast__action')].find((el) => el.textContent.includes('撤销')).click());
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="booking-file"]').length === 1, { timeout: 6000 });
    await assertTapTargetsIn(page, T('sheet-booking'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('长备注：超过 6 行先收起（末尾渐隐）+「展开全部」，原地展开下面的内容跟着下移（半路图），再点收起', async () => {
  const app = await openBookings({ query: `?sheet=booking:id.${HOTEL_A.id}~m.edit` });
  const { page } = app;
  try {
    await page.waitForSelector(T('form-notes'), { timeout: 10000 });
    const long = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行：到了前台先报订单号，再出示登机证。`).join('\n');
    await page.$eval(T('form-notes'), (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, long);
    await page.click(T('booking-save'));
    await page.waitForSelector(T('booking-detail'), { timeout: 8000 });
    await waitForAnimationsDone(page, 8000);
    await sheetScrollTo(page, T('booking-notes'));
    assert.ok(await page.$('.bks__notes-text--clamp'), '先收起');
    const closedH = await page.$eval('.bks__notes', (el) => el.getBoundingClientRect().height);
    const nextTop = await page.$eval(T('booking-files'), (el) => el.getBoundingClientRect().top);
    await page.screenshot({ path: path.join(SHOTS, 'notes-clamped.png'), captureBeyondViewport: false });
    const mid = await captureAt(app, () => page.click(T('booking-notes-more')), {
      progress: 0.4,
      evaluate: () => ({ files: document.querySelector('[data-testid="booking-files"]').getBoundingClientRect().top }),
    });
    await page.screenshot({ path: path.join(SHOTS, 'notes-expand-40.png'), captureBeyondViewport: false });
    await release(mid);
    await waitForAnimationsDone(page, 8000);
    const openH = await page.$eval('.bks__notes', (el) => el.getBoundingClientRect().height);
    const nextTop2 = await page.$eval(T('booking-files'), (el) => el.getBoundingClientRect().top);
    assert.ok(openH > closedH + 60, `展开后变高：${closedH} → ${openH}`);
    assert.ok(mid.state.files > nextTop + 4 && mid.state.files < nextTop2 - 4, `半路：下面的「附件」在两个位置之间（${nextTop} → ${mid.state.files} → ${nextTop2}）`);
    assert.equal(await page.$eval(T('booking-notes-more'), (el) => el.getAttribute('aria-expanded')), 'true');
    assert.match(await text(page, T('booking-notes-text')), /第 12 行/);
    await page.click(T('booking-notes-more'));
    await waitForAnimationsDone(page, 8000);
    assert.ok(await page.$('.bks__notes-text--clamp'), '再点收起');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程里：今天的「还没订」放进「今天」并标出来；时间已过的「还没订」标「时间已过」、不算进汇总，也不再放动作行和一键联系', async () => {
  const DINNER = B.find((b) => b.kind === 'restaurant' && b.status === 'idea');
  const day3 = await openBookings({ now: '2027-01-12T10:00:00+07:00', query: '?by=kind' });
  try {
    await day3.page.waitForSelector(T(`today-${DINNER.id}`), { timeout: 6000 });
    assert.match(await text(day3.page, T(`today-${DINNER.id}`)), /18:30.*还没订/);
    await day3.page.screenshot({ path: path.join(SHOTS, 'ongoing-today-idea.png'), captureBeyondViewport: false });
    day3.assertClean();
  } finally {
    await day3.close();
  }
  const day4 = await openBookings({ now: '2027-01-13T10:00:00+07:00', query: '?by=kind' });
  const { page } = day4;
  try {
    assert.equal(await page.$(T('tile-idea')), null, '0 个「还没订」：汇总里不写这一类');
    assert.ok(await page.$(`${T(`chips-${DINNER.id}`)} [data-stale]`), '时间已过');
    assert.equal(await page.$(T(`acts-${DINNER.id}`)), null, '过去了不放动作行');
    assert.equal(await page.$(T(`contact-${DINNER.id}`)), null, '过去了不放一键联系');
    day4.assertClean();
  } finally {
    await day4.close();
  }
});

test('联系人：按钮一排放在名字和备注下面（左对齐），WhatsApp 是 https://wa.me/<号码>、邮箱是一行能复制的胶囊；深色也看一眼', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await openBookings({ colorScheme, query: `?sheet=booking:${HOTEL_A.id}` });
    const { page } = app;
    try {
      await waitSheet(page, HOTEL_A.id);
      await sheetScrollTo(page, T('booking-contacts'));
      const rows = await page.$$eval(`${T('booking-contacts')} ${T('booking-contact')}`, (els) => els.map((el) => {
        const title = el.querySelector('.bks-row__title').getBoundingClientRect();
        const acts = el.querySelector('.bks-contact__acts')?.getBoundingClientRect();
        return { left: Math.round(title.left), actsLeft: acts ? Math.round(acts.left) : null, below: acts ? acts.top >= title.bottom : null };
      }));
      assert.ok(rows.length >= 1);
      for (const r of rows) if (r.actsLeft !== null) {
        assert.equal(r.actsLeft, r.left, '按钮和名字左对齐');
        assert.ok(r.below, '按钮在名字下面');
      }
      const copy = await page.$(`${T('booking-contacts')} .bks-copy`);
      if (copy) assert.equal(await copy.evaluate((el) => getComputedStyle(el.querySelector('.k-copy__text')).whiteSpace), 'nowrap');
      await page.screenshot({ path: path.join(SHOTS, `contacts-${colorScheme}.png`), captureBeyondViewport: false });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('离线（有缓存）：预订照常显示；「到店付好了」照常能点（进写队列、记成我付的），同步条说联网后自动同步', async () => {
  const app = await openBookings();
  const { page } = app;
  try {
    await sleep(800); // 等这趟行程写进本机缓存
    const url = new URL(page.url());
    url.searchParams.set('demonet', 'offline');
    url.hash = `#/t/demo-island/bookings?sheet=booking:${HOTEL_A.id}`;
    await page.goto(url.href);
    await waitSheet(page, HOTEL_A.id);
    assert.ok(await page.$(`${T('page-bookings')} .bk-card`), '缓存里的预订照常显示');
    await page.click(T('quick-paid'));
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => /已付清 · 记成 \S+ 付的/.test(el.textContent)), { timeout: 6000 });
    await page.waitForFunction(() => /已付/.test(document.querySelector('[data-testid="booking-payment"]')?.textContent || ''), { timeout: 6000 });
    await closeSheet(page);
    await page.waitForFunction(() => /联网后/.test(document.body.innerText), { timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, 'offline-cached.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

/**
 * 让演示后台把整库存进 IndexedDB（做一次会写回的改动：待确认的酒店点「商家确认了」），再按 patch 改几行（只改这台浏览器里的演示数据）。
 * @param {{ bookings?: Record<string, object>, places?: Record<string, object> }} patch
 */
async function persistAndPatch(page, patch) {
  await page.click(T(`booking-open-${HOTEL_B.id}`));
  await waitSheet(page, HOTEL_B.id);
  await page.click(T('quick-confirm'));
  await sleep(1500);
  await closeSheet(page);
  const ok = await page.evaluate(async (p) => {
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
    for (const table of Object.keys(p)) {
      v.tables[table] = v.tables[table].map((row) => (p[table][row.id] ? { ...row, ...p[table][row.id] } : row));
    }
    st.put(v, 'demo:server');
    await new Promise((r) => {
      tx.oncomplete = r;
    });
    db.close();
    return true;
  }, patch);
  assert.ok(ok, '演示后台的数据已经存进 IndexedDB');
}

test('超长内容（375 小屏）：60 多个字的标题（带越南语）、超长平台名、40 位订单号、10 位越南盾金额、160 个字的越南语地址——卡片和详情都不撑破、不横向滚动，订单号能整串复制', async () => {
  const app = await openBookings({ device: 'small' });
  const { page } = app;
  try {
    const LONG_TITLE = '超长标题测试：Tour lặn ngắm san hô nửa ngày ở quần đảo An Thới kèm bữa trưa hải sản · 两人含酒店接送和全套装备';
    const LONG_CODE = 'KLK-2027-0111-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
    const LONG_ADDR = 'Số 123/45/6 Đường Nguyễn Trung Trực, Khu phố 7, Phường Dương Đông, Thành phố Phú Quốc, Tỉnh Kiên Giang, Việt Nam（虚构地址，测试用：后面再接一段很长很长的中文说明）';
    await persistAndPatch(page, {
      bookings: {
        [SNORKEL.id]: { title: LONG_TITLE, provider: '某某平台的超长合作商名字（第三方代理 · 越南当地旅行社）', confirmation_code: LONG_CODE, price_amount: 1234567890 },
        [HOTEL_A.id]: { title: `${LONG_TITLE} · 酒店`, confirmation_code: LONG_CODE },
      },
      places: {
        [SNORKEL.place_id]: { address: LONG_ADDR },
        [HOTEL_A.place_id]: { address: LONG_ADDR },
      },
    });
    await page.reload();
    await page.waitForSelector(T(`booking-${SNORKEL.id}`), { timeout: 10000 });
    await app.idle();
    assert.match(await text(page, `${T(`booking-${SNORKEL.id}`)} .bk-card__title`), /超长标题测试/);
    await assertNoHorizontalOverflow(page);
    // 卡片里的每一块都在卡片里面
    for (const id of [SNORKEL.id, HOTEL_A.id]) {
      const out = await page.$eval(T(`booking-${id}`), (card) => {
        const c = card.getBoundingClientRect();
        return [...card.querySelectorAll('*')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && (r.right > c.right + 1 || r.left < c.left - 1);
        }).map((el) => `${el.className}`.slice(0, 40));
      });
      assert.deepEqual(out, [], `卡片里没有东西伸出去：${out.join('、')}`);
    }
    assert.match(await text(page, T(`price-${SNORKEL.id}`)), /1,234,567,890₫/);
    await page.$eval(T(`booking-${SNORKEL.id}`), (el) => el.scrollIntoView({ block: 'start' }));
    await app.idle();
    await page.screenshot({ path: path.join(SHOTS, 'long-card-375.png'), captureBeyondViewport: false });
    await page.$eval(T(`booking-${HOTEL_A.id}`), (el) => el.scrollIntoView({ block: 'start' }));
    await app.idle();
    await page.screenshot({ path: path.join(SHOTS, 'long-hotel-375.png'), captureBeyondViewport: false });
    // 详情：标题、订单号、地址都不撑破
    await page.click(T(`booking-open-${HOTEL_A.id}`));
    await waitSheet(page, HOTEL_A.id);
    await assertNoHorizontalOverflow(page);
    const sheetOut = await page.$eval(T('booking-detail'), (d) => {
      const c = d.getBoundingClientRect();
      return [...d.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && (r.right > c.right + 1 || r.left < c.left - 1);
      }).map((el) => `${el.className}`.slice(0, 40));
    });
    assert.deepEqual(sheetOut, [], `详情里没有东西伸出去：${sheetOut.join('、')}`);
    assert.equal(await text(page, T('booking-code-text')), LONG_CODE);
    await page.screenshot({ path: path.join(SHOTS, 'long-sheet-375.png'), captureBeyondViewport: false });
    await sheetScrollTo(page, T('booking-place'));
    await page.screenshot({ path: path.join(SHOTS, 'long-sheet-place-375.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('付款：付了钱、账本里还没记这笔 → 提醒一句；「记一笔」打开记账面板并带上这个预订（网址 sheet=expense:b.<预订 id>…）；记过的不提醒', async () => {
  const RETURN = B.find((b) => b.kind === 'flight' && b.payment_status === 'paid' && !DB.tables.expenses.some((e) => e.booking_id === b.id));
  const LOGGED = B.find((b) => b.payment_status === 'paid' && DB.tables.expenses.some((e) => e.booking_id === b.id && !e.deleted_at));
  assert.ok(RETURN && LOGGED, '演示数据里有一个付了没记账的、一个记过账的');
  const app = await openBookings({ query: `?sheet=booking:${LOGGED.id}` });
  const { page } = app;
  try {
    await waitSheet(page, LOGGED.id);
    assert.equal(await page.$(T('booking-ledger-hint')), null, '记过账的不提醒');
    await app.go(`#/t/demo-island/bookings?sheet=booking:${RETURN.id}`);
    await waitSheet(page, RETURN.id);
    await page.waitForSelector(T('booking-ledger-hint'), { timeout: 6000 });
    assert.match(await text(page, T('booking-ledger-hint')), /账本里还没记这笔/);
    await sheetScrollTo(page, T('booking-expense'));
    await page.screenshot({ path: path.join(SHOTS, 'ledger-hint.png'), captureBeyondViewport: false });
    await page.click(T('booking-expense'));
    await page.waitForFunction((id) => decodeURIComponent(location.hash).includes(`sheet=expense:`) && decodeURIComponent(location.hash).includes(`b.${id}`), { timeout: 6000 }, RETURN.id);
    app.assertClean();
  } finally {
    await app.close();
  }
});
