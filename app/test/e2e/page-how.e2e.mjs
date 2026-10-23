// 批 A · 按「这一项怎么去」给按钮、目的地档案（A4），演示数据（虚构的椰影岛 = 越南档案、三城 = 台湾档案）：
//   每天页：打车的条目「叫 Grab」做主按钮 + 给司机看；走路、自己骑的只有导航；和上一项同一个地方只留一行灰字 +「⋯」；
//   「⋯」点开临时用其余动作（不写库）；没写怎么去时那行灰字 +「改」→ 点「打车」立刻换成叫车 + 给司机看，刷新后还在；
//   改一项面板的「怎么去」（导入过的不给「自动」）→ 选「有人接」→ 给司机看 + 打电话；
//   台湾那趟：没有「叫 Grab」，叫车是「叫 Uber」，给司机看直接写中文；
//   概览「当地」小卡、贴士页「当地须知」按档案（越南 113 / 115 / 114，台湾 110 / 119）；给司机看补当地名字。
// 截图：<截图根目录>/__shots__/page-how/（另抄一份到 RS_A4_SHOTS 指定的目录，390 宽）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, shotsDir } from './lib/harness.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const rows = (table, trip) => DB.tables[table].filter((r) => r.trip_id === trip);
const itemOf = (trip, title) => rows('items', trip).find((i) => i.title === title);
const dayOf = (trip, id) => rows('days', trip).find((d) => d.id === id)?.date;

const RIDE = itemOf('demo-island', '回酒店冲澡、换衣服');       // 写了打车
const HERE = itemOf('demo-island', '取电动车，出发西线');       // 和上一项（酒店）同一个地方
const SELF = itemOf('demo-island', '胡椒园');                   // 自己骑电动车
const AUTO = itemOf('demo-island', '收拾行李、网上值机');       // 没写怎么去：按距离算（走路）
const SHUTTLE = itemOf('demo-island', '接驳车去南岬');          // 导入过的（写了开车），挂着接驳车预订
const TW = itemOf('demo-cities', '北门夜市');                   // 台湾：没写怎么去，按距离算（坐车或打车）
const D2 = dayOf('demo-island', RIDE.day_id);
const D3 = dayOf('demo-island', AUTO.day_id);
const ONGOING = '2027-01-11T10:00:00+07:00';
const UPCOMING = '2027-01-08T09:00:00+07:00';
const SHOTS = shotsDir('page-how');
const OUT = process.env.RS_A4_SHOTS || null;
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
  if (OUT) mkdirSync(OUT, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function shot(page, name) {
  await waitForAnimationsDone(page, 3000);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
  if (OUT) await page.screenshot({ path: path.join(OUT, `${name}.png`), captureBeyondViewport: false });
}

async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(60);
  await page.click(selector);
}

const header = (id) => `${T(`item-${id}`)} .xcard__header`;
async function expand(app, id) {
  await app.page.$eval(header(id), (el) => el.scrollIntoView({ block: 'center' }));
  await app.page.click(header(id));
  await app.page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', {}, header(id));
  await waitForAnimationsDone(app.page, 6000);
}

/** 展开后动作行的样子：按钮（不含「⋯」）、主按钮、有没有「⋯」、灰字 */
async function actsOf(page, id) {
  return page.$eval(T(`item-actions-${id}`), (el) => ({
    acts: [...el.querySelectorAll('.k-acts__row:not(.k-acts__more) .k-act:not(.k-act--more)')].map((a) => a.textContent.trim()),
    keys: [...el.querySelectorAll('.k-acts__row:not(.k-acts__more) .k-act[data-action]')].map((a) => a.dataset.action),
    quietKeys: [...el.querySelectorAll('.k-acts__quiet .k-act[data-action]')].map((a) => a.dataset.action),
    primary: el.querySelector('.k-act--primary')?.dataset.action || null,
    more: Boolean(el.querySelector('.k-act--more')),
    quiet: el.querySelector('.k-acts__quiet-text')?.textContent || null,
    how: el.dataset.how || null,
  }));
}

async function openDay(trip, date, now = ONGOING) {
  const app = await openApp({ browser, server, hash: `#/t/${trip}/day/${date}`, now });
  await app.page.waitForSelector(`${T('page-day')} ${T('day-head')}`, { timeout: 15000 });
  await app.idle();
  return app;
}

test('每天页：打车 → 叫 Grab 做主按钮 + 给司机看；自己骑 → 只有导航；同一个地方 → 一行灰字 +「⋯」；「⋯」临时用其余动作', async () => {
  const app = await openDay('demo-island', D2);
  const { page } = app;
  try {
    await expand(app, RIDE.id);
    const ride = await actsOf(page, RIDE.id);
    assert.deepEqual(ride.keys, ['ride', 'driver', 'expense']);
    assert.deepEqual(ride.acts, ['叫 Grab', '给司机看', '记一笔']);
    assert.equal(ride.primary, 'ride');
    assert.equal(ride.more, true);
    await shot(page, '01-day-ride');
    // 「⋯」：导航、复制地址这一次临时用
    await tap(page, T(`item-actions-${RIDE.id}-more`));
    await page.waitForSelector(T(`item-actions-${RIDE.id}-more-row`));
    const extra = await page.$$eval(`${T(`item-actions-${RIDE.id}-more-row`)} .k-act`, (els) => els.map((a) => [a.dataset.action, a.textContent.trim(), Boolean(a.getAttribute('href'))]));
    assert.deepEqual(extra.map((x) => x[0]), ['nav', 'copy']);
    assert.ok(extra[0][2], '导航是链接');
    await shot(page, '02-day-more-open');

    await expand(app, SELF.id);
    const self = await actsOf(page, SELF.id);
    assert.deepEqual(self.keys, ['nav', 'expense'], '自己骑：只给导航（开车方式）');
    const nav = await page.$eval(`${T(`item-actions-${SELF.id}`)} [data-action="nav"]`, (a) => a.getAttribute('href'));
    assert.equal(new URL(nav).searchParams.get('travelmode'), 'driving');

    await expand(app, HERE.id);
    const here = await actsOf(page, HERE.id);
    assert.equal(here.how, 'here');
    assert.deepEqual(here.keys, []);
    assert.equal(here.quiet, '和上一项在同一个地方');
    assert.deepEqual(here.quietKeys, ['expense'], '灰字那一行右边照样能记一笔');
    assert.equal(here.more, true);
    await shot(page, '03-day-here');
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('没写怎么去：一行灰字说为什么 +「改」→ 选「打车」马上换成叫 Grab + 给司机看，刷新后还在', async () => {
  const app = await openDay('demo-island', D3);
  const { page } = app;
  try {
    await expand(app, AUTO.id);
    const line = await page.$eval(T(`tl-how-${AUTO.id}`), (el) => ({ text: el.textContent, how: el.dataset.how }));
    assert.equal(line.how, 'walk');
    assert.match(line.text, /离上一站 1\.4 公里，走过去/);
    assert.deepEqual((await actsOf(page, AUTO.id)).keys, ['nav', 'expense']);
    await shot(page, '04-day-howline');
    await tap(page, T(`tl-how-${AUTO.id}-edit`));
    await page.waitForSelector(T(`tl-how-${AUTO.id}-chips`));
    const chips = await page.$$eval(`${T(`tl-how-${AUTO.id}-chips`)} [data-chip]`, (els) => els.map((e) => [e.dataset.chip, e.getAttribute('aria-checked')]));
    assert.deepEqual(chips.map((c) => c[0]), ['auto', 'walk', 'ride', 'transit', 'self_drive', 'bike', 'transfer', 'more']);
    assert.equal(chips[0][1], 'true', '现在是「自动」');
    await shot(page, '05-day-howline-chips');
    await tap(page, `${T(`tl-how-${AUTO.id}-chips`)} [data-chip="ride"]`);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="item-actions-${id}"]`)?.dataset.how === 'ride', {}, AUTO.id);
    const after1 = await actsOf(page, AUTO.id);
    assert.deepEqual(after1.keys, ['ride', 'driver', 'expense']);
    assert.equal(after1.primary, 'ride');
    assert.equal(await page.$(T(`tl-how-${AUTO.id}`)), null, '写了怎么去以后，灰字那行换成「怎么过去」');
    assert.match(await page.$eval(`${T(`item-${AUTO.id}`)} [data-testid="tl-transport"]`, (el) => el.textContent), /出租车/);
    await shot(page, '06-day-set-ride');
    // 刷新：还在（写进了 transport_in）
    await page.reload();
    await page.waitForSelector(T('day-head'));
    await app.idle();
    await expand(app, AUTO.id);
    assert.deepEqual((await actsOf(page, AUTO.id)).keys, ['ride', 'driver', 'expense']);
    // 在面板里看：打车选中
    await tap(page, T(`tl-edit-${AUTO.id}`));
    await page.waitForSelector(T('item-how'));
    assert.equal(await page.$eval(T('item-how'), (el) => el.dataset.current), 'ride');
    assert.match(await page.$eval(T('item-how-hint'), (el) => el.textContent), /会给：叫 Grab · 给司机看/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('改一项的「怎么去」：导入过的不给「自动」；选「有人接」→ 给司机看 + 打电话（接驳车司机），不给叫车', async () => {
  const app = await openDay('demo-island', dayOf('demo-island', SHUTTLE.day_id));
  const { page } = app;
  try {
    await app.go(`#/t/demo-island/day/${dayOf('demo-island', SHUTTLE.day_id)}?sheet=item:${SHUTTLE.id}`);
    await page.waitForSelector(T('item-how'));
    await waitForAnimationsDone(page, 4000);
    const chips = await page.$$eval(`${T('item-how')} [data-chip]`, (els) => els.map((e) => e.dataset.chip));
    assert.ok(!chips.includes('auto'), '导入过的条目不给「自动」');
    assert.match(await page.$eval(T('item-how'), (el) => el.textContent), /原来写的说明都留着/);
    await page.$eval(`${T('item-how')} [data-chip="transfer"]`, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${T('item-how')} [data-chip="transfer"]`);
    await page.waitForFunction(() => /会给：给司机看 · 打电话/.test(document.querySelector('[data-testid="item-how-hint"]')?.textContent || ''));
    await shot(page, '07-item-sheet-how');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    await expand(app, SHUTTLE.id);
    const a = await actsOf(page, SHUTTLE.id);
    assert.equal(a.how, 'transfer');
    assert.deepEqual(a.keys, ['driver', 'call', 'expense']);
    assert.match(await page.$eval(`${T(`item-actions-${SHUTTLE.id}`)} [data-action="call"]`, (el) => el.getAttribute('href')), /^tel:\+0+/);
    assert.match(await page.$eval(`${T(`item-${SHUTTLE.id}`)} [data-testid="tl-transport"]`, (el) => el.textContent), /有人接/);
    await shot(page, '08-day-transfer');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('台湾那趟（三城，已结束）：没有「叫 Grab」；做完了的条目动作行收起，「⋯」里叫车是「叫 Uber」；给司机看直接写中文', async () => {
  const app = await openDay('demo-cities', dayOf('demo-cities', TW.day_id), '2026-03-15T12:00:00+08:00');
  const { page } = app;
  try {
    await expand(app, TW.id);
    const a = await actsOf(page, TW.id);
    assert.deepEqual(a.keys, [], '做完了：动作行收起');
    assert.deepEqual(a.quietKeys, ['expense']);
    assert.equal(a.more, true);
    assert.ok(!/叫 Grab/.test(await page.evaluate(() => document.body.textContent)), '台湾那趟一个「叫 Grab」都没有');
    await tap(page, T(`item-actions-${TW.id}-more`));
    await page.waitForSelector(T(`item-actions-${TW.id}-more-row`));
    const more = await page.$$eval(`${T(`item-actions-${TW.id}-more-row`)} .k-act`, (els) => els.map((x) => [x.dataset.action, x.textContent.trim(), x.getAttribute('href')]));
    assert.deepEqual(more.map((x) => x[0]), ['nav', 'ride', 'driver', 'copy']);
    assert.equal(more[1][1], '叫 Uber');
    assert.ok(more[1][2].startsWith('https://m.uber.com/ul/'), more[1][2]);
    assert.ok(!/叫 Grab/.test(await page.evaluate(() => document.body.textContent)));
    await shot(page, '09-day-tw-uber');
    // 给司机看：大字是中文名
    await page.click(`${T(`item-actions-${TW.id}-more-row`)} [data-action="driver"]`);
    await page.waitForSelector(T('driver-primary'));
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), '北门夜市');
    assert.equal(await page.$(T('driver-fill')), null, '台湾不用当地文字，不提示补名字');
    await shot(page, '10-driver-tw');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('给司机看：越南的新地点还没有越南语名字 → 「补一下」就地填，存好大字就是它', async () => {
  const app = await openDay('demo-island', D2);
  const { page } = app;
  try {
    await tap(page, T('tl-add'));
    await page.waitForSelector(T('item-title'));
    await waitForAnimationsDone(page, 4000);
    await page.type(T('item-title'), '去小巷里的面馆');
    await page.click(T('item-place-toggle'));
    await page.waitForSelector(T('item-place-search'));
    await page.type(T('item-place-search'), '巷口面馆');
    await page.waitForSelector(T('item-place-new'));
    await page.click(T('item-place-new'));
    await page.waitForSelector(T('item-field-how'));
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    const id = await page.$$eval('[data-item-id]', (els) => els.find((e) => e.textContent.includes('去小巷里的面馆'))?.dataset.itemId);
    assert.ok(id);
    await expand(app, id);
    const a = await actsOf(page, id);
    assert.ok(a.keys.includes('driver') || a.more, '给司机看在这一排或「⋯」里');
    const sel = a.keys.includes('driver') ? `${T(`item-actions-${id}`)} .k-acts__row [data-action="driver"]` : null;
    if (sel) await tap(page, sel);
    else {
      await tap(page, T(`item-actions-${id}-more`));
      await tap(page, `${T(`item-actions-${id}-more-row`)} [data-action="driver"]`);
    }
    await page.waitForSelector(T('driver-fill'));
    await waitForAnimationsDone(page, 4000);
    assert.match(await page.$eval(T('driver-fill'), (el) => el.textContent), /还没有越南语名字/);
    await page.click(T('driver-fill-open'));
    await page.waitForSelector(T('driver-fill-input'));
    assert.ok(await page.$(T('driver-fill-ai')), '越南语测过了：有「让 AI 翻一下」');
    await page.type(T('driver-fill-input'), 'Quán Mì Đầu Hẻm');
    await shot(page, '11-driver-fill');
    await page.click(T('driver-fill-save'));
    await page.waitForFunction(() => document.querySelector('[data-testid="driver-primary"]')?.textContent === 'Quán Mì Đầu Hẻm');
    assert.equal(await page.$(T('driver-fill')), null, '补好了提示就没了');
    assert.equal(await page.$eval(T('driver-secondary'), (el) => el.textContent), '巷口面馆');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('概览「当地」小卡、贴士页「当地须知」按档案：越南 113 / 115 / 114，台湾 110 / 119；台湾没有翻译入口', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island', now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T('ov-local'), { timeout: 15000 });
    await app.idle();
    const card = await page.$eval(T('ov-local'), (el) => ({
      eyebrow: el.querySelector('.k-card__eyebrow, [class*="eyebrow"]')?.textContent || el.textContent,
      tels: [...el.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')),
      line: el.querySelector('[data-testid="ov-local-line"]')?.textContent,
    }));
    assert.deepEqual(card.tels, ['tel:113', 'tel:115', 'tel:114']);
    assert.equal(card.line, 'A/B/C 插座，带转换头 · 小费不强制');
    assert.match(card.eyebrow, /当地 · 越南/);
    await page.$eval(T('ov-local'), (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '12-overview-local');
    await tap(page, T('ov-local-more'));
    await page.waitForSelector(T('tips-local'));
    await app.idle();
    const tips = await page.$eval(T('tips-local'), (el) => ({
      nums: [...el.querySelectorAll('.tp-sos__num')].map((n) => n.textContent),
      rows: [...el.querySelectorAll('.tp-facts__row')].map((r) => r.dataset.key),
    }));
    assert.deepEqual(tips.nums, ['113', '115', '114']);
    assert.deepEqual(tips.rows, ['plug', 'tip', 'ride', 'money']);
    // 置顶里手写的紧急电话：号码已经在「当地须知」里的不再拆一遍
    assert.equal(await page.$(T('tips-sos')), null);
    await page.$eval(T('page-tips'), (el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, '13-tips-local');
    await app.go('#/t/demo-cities/tips');
    await page.waitForSelector(T('tips-local'));
    const tw = await page.$eval(T('tips-local'), (el) => [...el.querySelectorAll('.tp-sos__num')].map((n) => n.textContent));
    assert.deepEqual(tw, ['110', '119']);
    assert.match(await page.$eval(T('tips-local'), (el) => el.textContent), /110V，吹风机注意/);
    assert.match(await page.$eval(T('tips-search'), (el) => el.querySelector('input')?.placeholder || el.placeholder || ''), /^搜贴士、常用语$/, '台湾不提越南语声调');
    await shot(page, '14-tips-local-tw');
    app.assertClean();
  } finally {
    await app.close();
  }
});
