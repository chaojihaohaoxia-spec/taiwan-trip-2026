// 加一项（10-19 加条目改版，sheets/item + pages/day 的入口 + ＋ 面板），演示数据（椰影岛 D2，现在 12:45：浮潜 12:30 结束、13:00 午餐之前）：
//   ＋ 面板进行中「记一笔」「加一项」并排 → 一下到「加一项」：默认今天、现在、做完了；回车加进去 → 按钟点插在「现在」、已完成、淡入高亮；
//   提示条「撤销」→ 这一条没了；「现在」线上的 ＋：清掉钟点 → 做完了跟着关、插在「现在」前面那一条后面；
//   时间轴末尾「＋ 加一项」；换到明天 → 钟点空着、计划中、提示写「已加到 D3」；
//   选地点：这一天用到的地点排在前面、类型跟着地点；改一项：已完成的能改时间、状态（改回计划中）、地点；
//   出发前：＋ 面板不并排、没给日期默认第一天、不填钟点；四种条件（浅色 / 深色、375、只读）无报错、触控区 ≥44、不横向滚动。
// 截图：<截图根目录>/__screenshots__/page-additem/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const ITEMS = island('items');
const DAYS = island('days');
const PLACES = island('places');
const D2 = DAYS.find((d) => d.date === '2027-01-11');
const D3 = DAYS.find((d) => d.date === '2027-01-12');
const DIVE = ITEMS.find((i) => i.title === '半日浮潜');
const LUNCH = ITEMS.find((i) => i.title === '老码头海鲜午餐');
const D2_PLACE_IDS = new Set(ITEMS.filter((i) => i.day_id === D2.id && i.place_id && !i.deleted_at).map((i) => i.place_id));
const NOW = '2027-01-11T12:45:00+07:00';
const UPCOMING = '2027-01-08T09:00:00+07:00';
const SHOTS = shotsDir('page-additem');
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

async function openDay(date = D2.date, o = {}) {
  const app = await openApp({ browser, server, hash: `#/t/demo-island/day/${date}`, now: NOW, ...o });
  await app.page.waitForSelector(`${T('page-day')} ${T('day-head')}`, { timeout: 15000 });
  await app.idle();
  return app;
}

async function shot(page, name) {
  await waitForAnimationsDone(page, 4000).catch(() => {});
  await sleep(150);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
}

/** 先滚到屏幕中间再点（底栏、面板底部的按钮会盖住） */
async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(60);
  await page.click(selector);
}

async function waitSheet(page) {
  await page.waitForSelector(T('item-form'), { timeout: 8000 });
  await waitForAnimationsDone(page, 4000).catch(() => {});
}

/** 面板里的默认值 */
const formState = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(`[data-testid="${s}"]`);
  return {
    title: document.querySelector('.ov-sheet__title')?.textContent,
    day: q('item-day')?.querySelector('[aria-checked="true"]')?.textContent,
    start: q('item-start')?.value,
    done: q('item-done')?.querySelector('input')?.checked,
    more: Boolean(q('item-more-body')),
    focused: document.activeElement?.dataset?.testid || null,
  };
});

/** 主方案时间轴：[id, 钟点, 标题, 状态] */
const timeline = (page) => page.$$eval('.tl:not(.tl--general) > .tl__item', (els) => els.map((e) => [
  e.dataset.itemId, e.querySelector('.tl__time-main')?.textContent || '', e.querySelector('.xcard__title').textContent.replace(/^.*?，/, ''), e.dataset.status,
]));

test('＋ 面板一下到「加一项」：默认今天、现在、做完了；回车加进去 → 插在「现在」、已完成、高亮；提示条「撤销」', async () => {
  const app = await openDay();
  const { page } = app;
  try {
    const before = await timeline(page);
    await page.click(T('shell-fab'));
    await page.waitForSelector(T('fab-item'));
    await app.idle();
    const pair = await page.$$eval('.fab-pair > .fab-tile', (els) => els.map((e) => [e.dataset.testid, e.querySelector('b').textContent]));
    assert.deepEqual(pair, [['fab-expense', '记一笔'], ['fab-item', '加一项']], '进行中：记一笔、加一项并排在第一行');
    const box = await page.$eval(T('fab-item'), (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, bottom: r.bottom }; });
    assert.ok(box.h >= 88 && box.w >= 140, `并排的格子够大：${Math.round(box.w)}×${Math.round(box.h)}`);
    await assertTapTargets(page);
    await shot(page, '01-fab-pair');

    await page.click(T('fab-item'));                                   // 第 1 下
    await waitSheet(page);
    const f = await formState(page);
    assert.equal(f.title, '加一项');
    assert.equal(f.day, '今天');
    assert.equal(f.start, '12:45', '今天：几点默认现在');
    assert.equal(f.done, true, '今天、现在：做完了默认打开');
    assert.equal(f.more, false, '更多设置收着');
    assert.equal(f.focused, 'item-title', '一打开就能打字');
    // 面板不是全屏：上面一层一屏放得下，加进去在拇指区
    const sheet = await page.$eval(T('sheet-item'), (el) => el.getBoundingClientRect().top + Number((el.style.transform.match(/-?[\d.]+/) || [0])[0]));
    assert.ok(sheet > 160, `面板停在内容高度（顶边 ${Math.round(sheet)}px），不是几乎全屏`);
    const submit = await page.$eval(T('item-submit'), (el) => el.getBoundingClientRect().bottom);
    assert.ok(submit < 844, '「加进去」在屏幕里');
    await assertTapTargets(page);
    await assertNoHorizontalOverflow(page);
    await shot(page, '02-sheet-defaults');

    await page.keyboard.type('取了五百块');
    await shot(page, '03-typed');
    await page.keyboard.press('Enter');                                // 回车 = 加进去（第 2 下）
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await page.waitForSelector('.tl__item[data-fresh]', { timeout: 8000 });
    const after1 = await timeline(page);
    assert.equal(after1.length, before.length + 1);
    const i = after1.findIndex((r) => r[2] === '取了五百块');
    assert.ok(i > 0, JSON.stringify(after1));
    assert.deepEqual(after1[i].slice(1), ['12:45', '取了五百块', 'done'], '按现在的钟点、已完成');
    assert.equal(after1[i - 1][0], DIVE.id, '在浮潜后面');
    assert.equal(after1[i + 1][0], LUNCH.id, '在 13:00 午餐前面');
    assert.equal(await page.$eval('.tl__item[data-fresh]', (el) => el.querySelector('.xcard__title').textContent.includes('取了五百块')), true, '新的一条亮一下');
    const msg = await page.$eval('.ov-toast__message', (el) => el.textContent);
    assert.equal(msg, '已加「取了五百块」· 12:45');
    await shot(page, '04-added-in-place');
    // 没地点、种类是「其他」：展开后不再提醒「没有关联地点」
    const newId = after1[i][0];
    await page.$eval(`${T(`item-${newId}`)} .xcard__header`, (el) => el.scrollIntoView({ block: 'center' }));
    // 撤销
    const undo = await page.waitForSelector('.ov-toast__action');
    assert.equal(await undo.evaluate((el) => el.textContent.trim()), '撤销');
    await undo.click();
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="item-${id}"]`), { timeout: 5000 }, newId);
    assert.deepEqual((await timeline(page)).map((r) => r[0]), before.map((r) => r[0]), '撤销以后时间轴回到原样');
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].some((el) => el.textContent === '已撤销'), { timeout: 4000 });
    await shot(page, '05-undone');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「现在」线上的 ＋：清掉钟点 → 做完了跟着关、插在「现在」前面那一条后面；没地点的「其他」不提醒补地点', async () => {
  const app = await openDay();
  const { page } = app;
  try {
    await page.waitForSelector(T('tl-now-add'));
    const r = await page.$eval(T('tl-now-add'), (el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, top: b.top }; });
    assert.ok(r.w >= 44 && r.h >= 44, '点按区 44×44');
    assert.ok(r.top > 0 && r.top < 844, `打开每天页就在屏幕里（自动滚到「现在」）：${Math.round(r.top)}`);
    await shot(page, '06-now-plus');
    await page.click(T('tl-now-add'));
    await waitSheet(page);
    assert.equal((await formState(page)).start, '12:45');
    await page.click(T('item-time-clear'));
    const f = await formState(page);
    assert.equal(f.start, '');
    assert.equal(f.done, false, '没写钟点：做完了跟着关');
    await page.type(T('item-title'), '买水');
    await shot(page, '07-now-plus-no-time');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    const rows = await timeline(page);
    const i = rows.findIndex((x) => x[2] === '买水');
    assert.equal(rows[i - 1][0], DIVE.id, '插在「现在」前面那一条（浮潜）后面');
    assert.equal(rows[i + 1][0], LUNCH.id);
    assert.equal(rows[i][3], 'planned');
    // 展开：没地点的「其他」不提醒补地点
    const id = rows[i][0];
    await page.$eval(`${T(`item-${id}`)} .xcard__header`, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${T(`item-${id}`)} .xcard__header`);
    await page.waitForSelector(T(`tl-edit-${id}`), { timeout: 5000 });
    assert.equal(await page.$(T('tl-no-place')), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('时间轴末尾「＋ 加一项」；换到明天：钟点空着、计划中，提示写「已加到 D3」', async () => {
  const app = await openDay();
  const { page } = app;
  try {
    await tap(page, T('tl-add'));
    await shot(page, '08-end-add-row-tapped');
    await waitSheet(page);
    await page.click(T(`item-day-${D3.id}`));
    const f = await formState(page);
    assert.equal(f.day, '12日');
    assert.equal(f.start, '', '别的天：几点空着（写「不定」）');
    assert.equal(f.done, false);
    assert.equal(await page.$eval(`${T('item-field-time')} .item-time__face`, (el) => el.textContent), '不定');
    await page.type(T('item-title'), '早起看日出');
    await page.$eval(T('item-start'), (el) => { el.value = '05:50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal((await formState(page)).done, false, '明天的事：写了钟点也不算做完');
    assert.equal(await page.$eval(`${T('item-field-time')} .item-time__face`, (el) => el.textContent), '05:50', '自己写的 24 小时制');
    await shot(page, '09-tomorrow');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    const msg = await page.waitForSelector('.ov-toast__message').then((h) => h.evaluate((el) => el.textContent));
    assert.equal(msg, '已加到 D3 05:50：「早起看日出」');
    await app.go(`#/t/demo-island/day/${D3.date}`);
    await page.waitForSelector(T('day-head'));
    await app.idle();
    const rows = await timeline(page);
    assert.deepEqual(rows[0].slice(1), ['05:50', '早起看日出', 'planned'], '按钟点排到 D3 最前面');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('选地点：这一天用到的地点排在前面、类型跟着地点；改一项：已完成的能改时间、状态、地点', async () => {
  const app = await openDay();
  const { page } = app;
  try {
    await tap(page, T('tl-add'));
    await waitSheet(page);
    await page.type(T('item-title'), '再去买一杯椰子咖啡');
    await page.click(T('item-place-toggle'));
    await page.waitForSelector(T('item-place-panel'));
    const opts = await page.$$eval(`${T('item-place-panel')} [data-testid^="item-place-opt-"]`, (els) => els.map((e) => [e.dataset.testid.replace('item-place-opt-', ''), e.hasAttribute('data-near')]));
    const nearCount = opts.filter((o) => o[1]).length;
    assert.ok(nearCount >= 4, `这一天用到的地点在前：${nearCount}`);
    assert.ok(opts.slice(0, nearCount).every(([id]) => D2_PLACE_IDS.has(id) || PLACES.find((p) => p.id === id)), '前面的都是这一天的');
    assert.ok(opts.slice(0, nearCount).every((o) => o[1]) && opts.slice(nearCount).every((o) => !o[1]), '先这一天的，再其余');
    await shot(page, '10-place-near-first');
    const cafe = PLACES.find((p) => p.kind === 'cafe' && D2_PLACE_IDS.has(p.id)) || PLACES.find((p) => p.kind === 'cafe');
    await page.type(T('item-place-search'), cafe.name);
    await page.waitForSelector(T(`item-place-opt-${cafe.id}`));
    await page.click(T(`item-place-opt-${cafe.id}`));
    assert.equal(await page.$eval('.item-place__name', (el) => el.textContent), cafe.name);
    assert.equal(await page.$eval('.item-more__sum', (el) => el.textContent), '咖啡', '类型按地点给（收起时的摘要）');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    const rows = await timeline(page);
    const row = rows.find((x) => x[2] === '再去买一杯椰子咖啡');
    assert.equal(row[3], 'done');
    const id = row[0];
    assert.equal(await page.$eval(`${T(`item-${id}`)} .xcard__leading .glyph`, (el) => el.dataset.kind), 'cafe');

    // 改一项：已完成的也能改；状态改回计划中、钟点改到 14:30、换地点
    await app.go(`#/t/demo-island/day/${D2.date}?sheet=item:${id}`);
    await waitSheet(page);
    assert.equal(await page.$eval('.ov-sheet__title', (el) => el.textContent), '改一项');
    assert.equal(await page.$eval(`${T('item-status')} [aria-checked="true"]`, (el) => el.textContent.trim()), '做完了');
    assert.equal(await page.$(T('item-more-body')), null, '改的时候也先收着更多设置');
    await shot(page, '11-edit-done-item');
    await page.$eval(T('item-start'), (el) => { el.value = '14:30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$$eval(`${T('item-status')} .seg__item`, (els) => els.find((e) => e.textContent.trim() === '计划中').click());
    await page.type(T('item-desc'), '这家冰的更好喝');
    await page.click(T('item-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await app.idle();
    const rows2 = await timeline(page);
    const k = rows2.findIndex((x) => x[0] === id);
    assert.deepEqual(rows2[k].slice(1), ['14:30', '再去买一杯椰子咖啡', 'planned']);
    assert.equal(rows2[k - 1][1], '14:15', '改了钟点按钟点重排');
    await shot(page, '12-edited');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出发前：＋ 面板一个一行、加一项在第一行；没给日期默认第一天、不填钟点、计划中', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island', now: UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T('shell-fab'), { timeout: 15000 });
    await app.idle();
    await page.click(T('shell-fab'));
    await page.waitForSelector(T('fab-item'));
    await app.idle();
    assert.equal(await page.$('.fab-pair'), null);
    assert.equal(await page.$eval('.fab-tile', (el) => el.dataset.testid), 'fab-item');
    await page.click(T('fab-item'));
    await waitSheet(page);
    const f = await formState(page);
    assert.equal(f.day, '10日');
    assert.equal(f.start, '');
    assert.equal(f.done, false);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('深色、375×667：面板和「现在」线的 ＋ 不横向滚动、触控区够大', async () => {
  const app = await openDay(D2.date, { colorScheme: 'dark' });
  const { page } = app;
  try {
    await page.click(T('tl-now-add'));
    await waitSheet(page);
    await page.type(T('item-title'), '海边坐一会儿');
    await page.click(T('item-more'));
    await page.waitForSelector(T('item-more-body'));
    await assertTapTargets(page);
    await assertNoHorizontalOverflow(page);
    await shot(page, '13-dark-sheet-more');
    app.assertClean();
  } finally {
    await app.close();
  }
  const narrow = await openDay(D2.date, { device: 'small' });
  try {
    await tap(narrow.page, T('tl-now-add'));
    await waitSheet(narrow.page);
    await assertNoHorizontalOverflow(narrow.page);
    await assertTapTargets(narrow.page);
    const bottom = await narrow.page.$eval(T('item-submit'), (el) => el.getBoundingClientRect().bottom);
    assert.ok(bottom <= 667, '375×667 上「加进去」也在屏幕里');
    await shot(narrow.page, '14-375-sheet');
    narrow.assertClean();
  } finally {
    await narrow.close();
  }
});
