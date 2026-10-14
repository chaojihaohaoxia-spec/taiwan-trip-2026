// 账本页（pages/ledger）和记一笔弹层（sheets/expense）：总花费 / 结算 / 按天分组的流水；分类筛选；一笔原地展开（半路截图）；
// ＋ → 记一笔 → 350 →「千」→ 记下这笔（转圈 → 对勾 → 面板收回 → 新的一笔带入场动画出现并高亮）；按金额对不上不能提交；
// 编辑；左滑 / 长按删除 + 撤销；离线记一笔标「待同步」；一键「已结清」+ 撤销；?expense= 定位；统计视图；
// 390 / 375 / 1280、浅色 / 深色截图，无横向溢出、触控区 ≥44。截图：<截图根目录>/__screenshots__/page-ledger/，半路图 __shots__/page-ledger/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone, withPlaybackRate } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const LIVE = island('expenses').filter((e) => !e.deleted_at);
const JEREMY = DB.users.find((u) => u.ref === 'jeremy').id;
const CATHY = DB.users.find((u) => u.ref === 'cathy').id;
const D2 = LIVE.filter((e) => e.date === '2027-01-11');
const FOOD = LIVE.filter((e) => e.category === '餐饮');
const SPA = LIVE.find((e) => e.split?.mode === 'amounts');
const NOW = '2027-01-11T10:00:00+07:00';
const SHOTS = shotsDir('page-ledger');
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

async function openLedger(o = {}) {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/ledger', now: NOW, ...o });
  await app.page.waitForSelector(T('ledger-total'), { timeout: 15000 });
  await app.idle();
  return app;
}

const hash = (page) => page.evaluate(() => location.hash);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const count = (page, sel) => page.$$eval(sel, (els) => els.length);
const hasEl = (page, sel) => page.$(sel).then((el) => Boolean(el));

/** 点分段控件里写着 label 的那一段 */
async function clickSeg(page, rootSel, label) {
  const ok = await page.$$eval(`${rootSel} .seg__item`, (els, want) => {
    const el = els.find((x) => x.textContent.trim() === want);
    if (!el) return false;
    el.click();
    return true;
  }, label);
  assert.ok(ok, `分段里有「${label}」`);
}

/** 把输入框换成这段字（先清空再打字） */
async function retype(page, sel, value) {
  await page.$eval(sel, (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value);
}

async function clipShot(page, sel, file, pad = 10) {
  const r = await page.$eval(sel, (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  const sy = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: file, clip: { x: Math.max(0, r.x - pad), y: sy + r.y - pad, width: Math.min(390, r.w + 2 * pad), height: r.h + 2 * pad }, captureBeyondViewport: false });
}

// ---------------------------------------------------------------------

test('账本页（进行中）：总花费按币种分开、外币带折合港币；两人各付了多少；结算按币种分别结；流水按天分组、日期头吸顶；三种宽度和深色', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const totals = await page.$$eval(`${T('ledger-totals')} .lg-total`, (els) => els.map((el) => ({ cur: el.dataset.currency, text: el.textContent })));
    assert.deepEqual(totals.map((t) => t.cur), ['VND', 'CNY', 'HKD'], '按笔数多到少排');
    assert.match(totals[0].text, /5,360,000₫/);
    assert.match(totals[0].text, /约 HK\$/, '外币带折合港币');
    assert.ok(!/约 HK\$/.test(totals[2].text), '港币本身不标');
    assert.match(await text(page, T('ledger-total')), /15 笔/);
    assert.ok(await hasEl(page, T(`ledger-person-${JEREMY}`)));
    assert.ok(await hasEl(page, T(`ledger-person-${CATHY}`)));
    assert.match(await text(page, T('ledger-fx')), /汇率/);
    // 结算：按币种分开，不换汇（同一对人的几种币种并在一行；两个方向各一行）
    const lines = await page.$$eval(T('ledger-settle-line'), (els) => els.map((el) => el.textContent));
    assert.ok(lines.length >= 1 && lines.length <= 2, `结算 ${lines.length} 行`);
    assert.ok(lines.every((l) => /应给/.test(l)));
    assert.ok(await hasEl(page, T('ledger-settle-btn')), '有「记为已结清」');
    // 流水：按天分组（新 → 旧），每笔有分类图标、说明、金额 + 折合、谁付、怎么分
    const groups = await page.$$eval('.lg-group', (els) => els.map((el) => el.dataset.testid));
    assert.equal(groups[0], 'ledger-group-2027-01-11');
    assert.equal(groups[1], 'ledger-group-2027-01-10');
    assert.equal(await count(page, `${T('ledger-group-2027-01-11')} .lg-item`), D2.length);
    assert.match(await text(page, `${T('ledger-group-2027-01-11')} .lg-date`), /今天/);
    const first = await text(page, `${T(`ledger-expense-${D2[0].id}`)} .xcard__header`);
    assert.ok(/付/.test(first) && /平摊|个人|按金额/.test(first) && /约 HK\$|HK\$/.test(first), first);
    assert.equal(await count(page, '.lg-item'), LIVE.length, '软删除的不显示');
    await app.shot('ledger-ongoing');
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    // 日期头吸顶：滚到第一组中间，日期头还在顶栏下面
    await page.$eval(T(`ledger-expense-${D2[D2.length - 1].id}`), (el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => document.querySelector('[data-testid="ledger-group-2027-01-11"] .lg-date')?.hasAttribute('data-stuck'), { timeout: 3000 });
    await app.idle();
    const head = await page.$eval(`${T('ledger-group-2027-01-11')} .lg-date`, (el) => el.getBoundingClientRect().top);
    assert.ok(head > 40 && head < 160, `日期头吸在顶栏下面：${head}`);
    // 吸住时整条日期头是一块真玻璃（流水的字不会从两个胶囊之间露出来），两个胶囊自己没有底色
    const stuck = await page.$eval(`${T('ledger-group-2027-01-11')} .lg-date`, (el) => {
      const bar = getComputedStyle(el, '::before');
      const pill = getComputedStyle(el.querySelector('.lg-date__pill'), '::before');
      return { filter: bar.backdropFilter || bar.webkitBackdropFilter, bar: bar.opacity, bg: bar.backgroundImage, pill: pill.opacity };
    });
    assert.notEqual(stuck.filter, 'none', `吸住的日期头有背景模糊：${JSON.stringify(stuck)}`);
    assert.equal(stuck.bar, '1', '吸住的整条玻璃底显示出来');
    assert.notEqual(stuck.bg, 'none', '玻璃底有材质');
    assert.equal(stuck.pill, '0', '胶囊自己的底色撤掉');
    await app.shot('ledger-sticky', { fullPage: false });
    // 滚回最上面：玻璃底淡掉、胶囊的底色回来、模糊关掉
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector('[data-testid="ledger-group-2027-01-11"] .lg-date')?.hasAttribute('data-stuck'), { timeout: 3000 });
    await app.idle();
    const loose = await page.$eval(`${T('ledger-group-2027-01-11')} .lg-date`, (el) => {
      const bar = getComputedStyle(el, '::before');
      return { filter: bar.backdropFilter || bar.webkitBackdropFilter, bar: bar.opacity, pill: getComputedStyle(el.querySelector('.lg-date__pill'), '::before').opacity };
    });
    assert.deepEqual(loose, { filter: 'none', bar: '0', pill: '1' }, `没吸住时看不见的玻璃关掉模糊：${JSON.stringify(loose)}`);
    app.assertClean();
  } finally {
    await app.close();
  }

  for (const [name, o] of [['dark', { colorScheme: 'dark' }], ['small', { device: 'small' }], ['desktop', { device: 'desktop' }]]) {
    const a = await openLedger(o);
    try {
      await a.shot(`ledger-${name}`);
      await assertNoHorizontalOverflow(a.page);
      await assertTapTargets(a.page);
      a.assertClean();
    } finally {
      await a.close();
    }
  }
});

test('空状态、已结束的行程（台北、新台币）、分类筛选、统计视图', async () => {
  const empty = await openApp({ browser, server, hash: '#/t/demo-empty/ledger', now: NOW });
  try {
    await empty.page.waitForSelector(T('ledger-empty'), { timeout: 15000 });
    assert.ok(await hasEl(empty.page, T('ledger-add')), '空状态里有「记一笔」');
    await empty.shot('ledger-empty', { fullPage: false });
    await assertNoHorizontalOverflow(empty.page);
    empty.assertClean();
  } finally {
    await empty.close();
  }

  const cities = await openApp({ browser, server, hash: '#/t/demo-cities/ledger', now: NOW });
  try {
    await cities.page.waitForSelector(T('ledger-total'), { timeout: 15000 });
    assert.match(await text(cities.page, T('ledger-totals')), /NT\$/);
    assert.ok(await hasEl(cities.page, T('ledger-group-2026-03-22')));
    await cities.shot('ledger-cities');
    cities.assertClean();
  } finally {
    await cities.close();
  }

  const app = await openLedger();
  const { page } = app;
  try {
    await page.click(T('ledger-filter-餐饮'));
    await page.waitForFunction(() => location.hash.includes('cat=food'));
    await app.idle();
    assert.equal(await count(page, '.lg-item'), FOOD.length);
    assert.ok(await page.$$eval('.lg-item', (els) => els.every((el) => el.dataset.category === '餐饮')));
    await app.shot('ledger-filter-food', { fullPage: false });
    await page.click(T('ledger-filter-all'));
    await page.waitForFunction(() => !location.hash.includes('cat='));
    await app.idle();
    assert.equal(await count(page, '.lg-item'), LIVE.length);

    // 谁付：「Cathy 付」→ 只剩 Cathy 付的；和分类叠加（餐饮 × Cathy 付）；没有结果时有「清除筛选」
    const byCathy = LIVE.filter((e) => e.paid_by_user_id === CATHY);
    await page.click(T(`ledger-filter-payer-${CATHY}`));
    await page.waitForFunction((id) => location.hash.includes(`who=${id}`), {}, CATHY);
    await app.idle();
    assert.equal(await count(page, '.lg-item'), byCathy.length, 'Cathy 付的');
    assert.ok(await page.$$eval('.lg-item', (els) => els.every((el) => /Cathy/.test(el.querySelector('.lg-row__sub').textContent))));
    assert.match(await text(page, T('ledger-filter-all')), new RegExp(`${byCathy.length}`), '「全部」的数字按谁付筛过');
    await page.click(T('ledger-filter-餐饮'));
    await page.waitForFunction(() => location.hash.includes('cat=food'));
    await app.idle();
    assert.equal(await count(page, '.lg-item'), byCathy.filter((e) => e.category === '餐饮').length, '餐饮 × Cathy 付');
    await app.shot('ledger-filter-cathy-food', { fullPage: false });
    // 住宿只有 Cathy 付过：换成「Jeremy 付」→ 空 → 清除筛选
    const stayByJeremy = LIVE.filter((e) => e.category === '住宿' && e.paid_by_user_id === JEREMY).length;
    if (stayByJeremy === 0) {
      await page.click(T('ledger-filter-住宿'));
      await page.waitForFunction(() => location.hash.includes('cat=stay'));
      await page.click(T(`ledger-filter-payer-${JEREMY}`));
      await page.waitForFunction((id) => location.hash.includes(`who=${id}`), {}, JEREMY);
      await page.waitForSelector(T('ledger-filter-empty'), { timeout: 4000 });
      await app.idle();
      await app.shot('ledger-filter-empty', { fullPage: false });
      await page.$eval(T('ledger-filter-clear'), (el) => el.click());
      await page.waitForFunction(() => !location.hash.includes('cat=') && !location.hash.includes('who='), { timeout: 6000 });
      await app.idle();
      assert.equal(await count(page, '.lg-item'), LIVE.length);
    } else {
      await page.click(T('ledger-filter-all'));
      await page.click(T(`ledger-filter-payer-${CATHY}`));
      await page.waitForFunction(() => !location.hash.includes('cat=') && !location.hash.includes('who='));
      await app.idle();
    }

    // 统计：分类横条、按人、按天；点一个分类 → 流水并筛选
    await clickSeg(page, T('ledger-view'), '统计');
    await page.waitForSelector(T('ledger-stats'));
    await app.idle();
    assert.match(await hash(page), /view=stats/);
    const bars = await page.$$eval(`${T('ledger-by-category')} .lg-bar`, (els) => els.map((el) => ({ w: el.style.getPropertyValue('--lg-bar-w'), t: el.textContent })));
    assert.ok(bars.length >= 5, `分类横条 ${bars.length} 条`);
    assert.equal(bars[0].w, '100%', '最大的一条满格');
    assert.ok(bars.every((b) => /HK\$/.test(b.t) && /\d+ 笔/.test(b.t) && /%/.test(b.t)));
    assert.ok(await hasEl(page, T(`ledger-who-${JEREMY}`)) && await hasEl(page, T(`ledger-who-${CATHY}`)));
    assert.ok((await count(page, `${T('ledger-by-day')} .lg-bar`)) >= 4);
    await app.shot('ledger-stats');
    await assertNoHorizontalOverflow(page);
    // 触控区只查这一页的东西：回到页面最上面（顶栏是 top 状态，只剩两边的圆按钮），不量顶栏收成胶囊 / 整条时的形变半路
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    await assertTapTargets(page);
    await page.click(T('ledger-bar-交通'));
    await page.waitForFunction(() => location.hash.includes('cat=transport') && !location.hash.includes('view=stats'));
    await app.idle();
    assert.ok(await page.$$eval('.lg-item', (els) => els.length > 0 && els.every((el) => el.dataset.category === '交通')));
    // 统计里点一个人 → 流水只看他付的（和分类筛选叠加着）
    await clickSeg(page, T('ledger-view'), '统计');
    await page.waitForSelector(T('ledger-stats'));
    await app.idle();
    await page.click(T(`ledger-who-${CATHY}`));
    await page.waitForFunction((id) => location.hash.includes(`who=${id}`) && !location.hash.includes('view=stats'), {}, CATHY);
    await app.idle();
    assert.equal(await count(page, '.lg-item'), LIVE.filter((e) => e.category === '交通' && e.paid_by_user_id === CATHY).length, '交通 × Cathy 付');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('点一笔原地展开详情（一次只开一张，半路截图）；详情里有谁付、怎么分、折合、关联、编辑 / 删除', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const a = D2[0];
    const b = D2[1];
    const row = (id) => T(`ledger-expense-${id}`);
    await page.$eval(row(a.id), (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(60);
    const cap = await captureAt(app, () => page.click(`${row(a.id)} .xcard__header`), {
      selector: `${row(a.id)} .xcard__body`,
      progress: 0.5,
      evaluate: () => {
        const body = document.querySelector('[data-open] > .xcard__body');
        return body ? getComputedStyle(body).gridTemplateRows : null;
      },
    });
    const sy = await page.evaluate(() => window.scrollY);
    const r = await page.$eval(row(a.id), (el) => { const b = el.getBoundingClientRect(); return { top: b.top, height: b.height }; });
    await page.screenshot({ path: path.join(SHOTS, 'expand-50.png'), clip: { x: 0, y: Math.max(0, sy + r.top - 10), width: 390, height: r.height + 120 }, captureBeyondViewport: false });
    await release(cap);
    await waitForAnimationsDone(page, 4000);
    const mid = parseFloat(cap.state);
    const full = parseFloat(await page.$eval(`${row(a.id)} .xcard__body`, (el) => getComputedStyle(el).gridTemplateRows));
    assert.ok(mid > 0 && mid < full, `半路高度 ${mid} 在 0 和 ${full} 之间`);
    const detail = await text(page, T(`ledger-detail-${a.id}`));
    assert.match(detail, /谁付/);
    assert.match(detail, /怎么分/);
    assert.match(detail, /折合港币|时间/);
    assert.ok(await hasEl(page, T(`ledger-edit-${a.id}`)) && await hasEl(page, T(`ledger-delete-${a.id}`)));
    await clipShot(page, row(a.id), path.join(SHOTS, 'expand-open.png'));
    // 再点另一张：上一张收起
    await page.click(`${row(b.id)} .xcard__header`);
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(row(a.id), (el) => Boolean(el.querySelector('.xcard[data-open]'))), false);
    assert.equal(await page.$eval(row(b.id), (el) => Boolean(el.querySelector('.xcard[data-open]'))), true);
    // 按金额分摊的那笔：详情里列各人份额
    if (SPA) {
      await page.$eval(row(SPA.id), (el) => el.scrollIntoView({ block: 'center' }));
      await page.click(`${row(SPA.id)} .xcard__header`);
      await waitForAnimationsDone(page, 4000);
      const d = await text(page, T(`ledger-detail-${SPA.id}`));
      assert.match(d, /Jeremy/);
      assert.match(d, /Cathy/);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('记一笔：＋ → 记一笔（金额框自动聚焦）→ 350 →「千」→ 记下这笔：转圈 → 对勾 → 面板收回 → 新的一笔带入场动画出现、高亮', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const before = await count(page, '.lg-item');
    await page.click(T('shell-fab'));
    await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
    await page.waitForSelector(T('fab-expense'), { timeout: 8000 });
    await app.idle();
    await page.click(T('fab-expense'));
    await page.waitForFunction(() => /sheet=expense/.test(location.hash), { timeout: 8000 });
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    assert.match(await hash(page), /sheet=expense:d\.2027-01-11/, '进行中预填今天');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.testid), 'xf-amount-input', '金额框自动聚焦');
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.getAttribute('inputmode')), 'numeric', '越南盾：纯数字键盘');
    assert.match(await text(page, T('xf-when-label')), /D2/);
    await page.keyboard.type('350');
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), '350');
    assert.ok(await hasEl(page, T('xf-amount-small')), '不到 1,000 提醒忘了按「千」');
    await page.click(T('xf-quick-k'));
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), '350,000');
    const conv = await text(page, T('xf-amount-conv'));
    assert.match(conv, /HK\$/, '实时折合港币');
    assert.match(conv, /每人/, '平摊每人');
    assert.equal(await hasEl(page, T('xf-amount-small')), false);
    await retype(page, T('xf-desc'), '椰子冰沙');
    await page.screenshot({ path: path.join(SHOTS, 'sheet-filled.png'), captureBeyondViewport: false });
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    // 提交：转圈 → 对勾
    await page.click(T('xf-submit'));
    await page.waitForSelector(`${T('xf-submit')}[data-state="loading"]`, { timeout: 3000 });
    await page.screenshot({ path: path.join(SHOTS, 'submit-loading.png'), captureBeyondViewport: false });
    await page.waitForSelector(`${T('xf-submit')}[data-state="success"]`, { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'submit-success.png'), captureBeyondViewport: false });
    // 对勾描完 → 面板收回 → 面板卸载的那一刻新的一笔才进列表（入场 = 淡入 + 0.92 → 1 的弹簧）。
    // 面板收回的时机由对勾动画决定，没法用 captureAt 卡住再触发，所以把全页动画放慢 5 倍，
    // 新的一笔一出现就读它的样子：这时淡入和弹簧都刚开始
    let mid = null;
    await withPlaybackRate(page, 0.2, async () => {
      await page.waitForSelector('.lg-item[data-fresh]', { timeout: 20000 });
      mid = await page.$eval('.lg-item[data-fresh]', (el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform }));
      await page.screenshot({ path: path.join(SHOTS, 'enter-mid.png'), captureBeyondViewport: false });
    });
    const scale = /matrix\(([\d.]+)/.exec(mid?.transform || '')?.[1];
    assert.ok(mid && ((parseFloat(mid.opacity) < 1) || (scale && parseFloat(scale) < 0.999)), `入场半路（还没停稳）：${JSON.stringify(mid)}`);
    assert.ok(!/sheet=expense/.test(await hash(page)), '面板已经收回');
    // 高亮 2.6 秒内读它（data-fresh 过了就撤）。同一天里按记录时间新 → 旧（data/selectors 的 liveExpenses）：
    // 演示数据里今天几笔的 created_at 是编的、比“现在”还晚，所以这里只断言在今天这一组里、在屏幕上
    const fresh = await page.$eval('.lg-item[data-fresh]', (el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, group: el.closest('.lg-group').dataset.testid, top: r.top, bottom: r.bottom, h: window.innerHeight };
    });
    assert.match(fresh.text, /椰子冰沙/);
    assert.match(fresh.text, /350,000₫/);
    assert.match(fresh.text, /Jeremy/, '默认我付');
    assert.equal(fresh.group, 'ledger-group-2027-01-11', '记在今天');
    // 不在屏幕上时页面会平滑滚过去（LedgerPage 的 scrollIntoView）：等它滚到
    await page.waitForFunction(() => {
      const el = document.querySelector('.lg-item[data-fresh]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }, { timeout: 4000 }).catch(() => {
      throw new Error(`新的一笔没有滚到屏幕上：${fresh.top}–${fresh.bottom} / ${fresh.h}`);
    });
    await page.screenshot({ path: path.join(SHOTS, 'fresh-row.png'), captureBeyondViewport: false });
    await waitForAnimationsDone(page, 8000);
    assert.equal(await count(page, '.lg-item'), before + 1);
    assert.match(await text(page, T('ledger-total')), /16 笔/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('记一笔的校验：面板从底部滑上来（半路截图）；没金额不转圈、金额块摇一下；按金额分摊对不上不能提交、说明差多少；关面板问「放弃未保存的内容？」', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    await page.$eval(T('ledger-add'), (el) => el.scrollIntoView({ block: 'center' }));
    // 先开一次把按需加载的面板代码拿到手（第一次打开要等下载，动画不在点击后两帧内开始），关掉再截半路
    await page.click(T('ledger-add'));
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="sheet-expense"]'), { timeout: 8000 });
    await app.idle();
    // 面板从底部滑上来（位移动画在 .ov-sheet 本身，overlay/Sheet.jsx 的 panelRef）：拨到一半时面板还在往上走
    const frameY = () => {
      const el = document.querySelector('[data-testid="sheet-expense"]');
      if (!el) return null;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { y: m.m42, top: el.getBoundingClientRect().top, h: window.innerHeight };
    };
    const open = await captureAt(app, async () => {
      await page.click(T('ledger-add'));
      await page.waitForSelector(T('sheet-expense'), { timeout: 8000 });
    }, { selector: '[data-testid="sheet-expense"]', progress: 0.5, evaluate: frameY });
    await page.screenshot({ path: path.join(SHOTS, 'sheet-open-50.png'), captureBeyondViewport: false });
    assert.ok(open.state && open.state.y > 8, `面板半路还在屏幕下面：${JSON.stringify(open.state)}`);
    await release(open);
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await waitForAnimationsDone(page, 6000);
    const settled = await page.evaluate(frameY);
    assert.ok(settled && Math.abs(settled.y) < 1, `停稳后面板在原位：${JSON.stringify(settled)}`);
    await app.idle();
    // 没金额
    await page.click(T('xf-submit'));
    await sleep(120);
    assert.equal(await page.$eval(T('xf-submit'), (el) => el.dataset.state), 'idle', '不转圈');
    assert.match(await text(page, T('xf-error')), /先输入金额/);
    assert.equal(await page.$eval(T('xf-amount'), (el) => el.hasAttribute('data-invalid')), true);
    // 按金额：500,000 + 300,000 ≠ 700,000
    await retype(page, T('xf-amount-input'), '700000');
    await clickSeg(page, T('xf-split'), '按金额');
    await page.waitForSelector(T('xf-shares'));
    await retype(page, T(`xf-share-${JEREMY}`), '500000');
    assert.equal(await page.$eval(T(`xf-share-${CATHY}`), (el) => el.value), '200,000', '没动过的人自动补上剩下的');
    await retype(page, T(`xf-share-${CATHY}`), '300000');
    await page.waitForSelector(T('xf-split-mismatch'));
    assert.match(await text(page, T('xf-split-mismatch')), /多了 100,000₫/);
    await page.screenshot({ path: path.join(SHOTS, 'split-mismatch.png'), captureBeyondViewport: false });
    await page.click(T('xf-submit'));
    await sleep(150);
    assert.equal(await page.$eval(T('xf-submit'), (el) => el.dataset.state), 'idle', '对不上不能提交');
    assert.match(await hash(page), /sheet=expense/, '面板还开着');
    await retype(page, T(`xf-share-${CATHY}`), '200000');
    await page.waitForSelector(T('xf-split-ok'));
    // 个人：算 Cathy 的
    await clickSeg(page, T('xf-split'), '个人');
    await page.click(T(`xf-for-${CATHY}`));
    assert.match(await text(page, T('xf-amount-conv')), /只算 Cathy 的/);
    // 关面板：表单动过 → 问一句；「继续编辑」留下
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="alertdialog"], .ov-dialog', { timeout: 4000 });
    const dlg = await page.evaluate(() => document.querySelector('[role="alertdialog"], .ov-dialog')?.textContent || '');
    assert.match(dlg, /放弃未保存的内容/);
    await page.$$eval('[role="alertdialog"] button, .ov-dialog button', (els) => els.find((b) => /继续编辑/.test(b.textContent))?.click());
    await app.idle();
    assert.match(await hash(page), /sheet=expense/);
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), '700,000', '内容还在');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('编辑一笔：详情 → 编辑 → 面板标题「编辑这一笔」、照原样填好 → 改说明保存 → 行更新并高亮；币种换成港币金额照旧', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const e = D2[0];
    const row = T(`ledger-expense-${e.id}`);
    await page.$eval(row, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${row} .xcard__header`);
    await waitForAnimationsDone(page, 4000);
    await page.click(T(`ledger-edit-${e.id}`));
    await page.waitForSelector(T('xf-form'), { timeout: 8000 });
    await app.idle();
    assert.match(await hash(page), new RegExp(`sheet=expense:${e.id}`));
    assert.match(await text(page, '.ov-sheet__title'), /编辑这一笔/);
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), Number(e.amount).toLocaleString('en-US'));
    assert.equal(await page.$eval(T('xf-desc'), (el) => el.value), e.description);
    assert.ok(await hasEl(page, T('xf-delete')), '编辑时有删除');
    await page.screenshot({ path: path.join(SHOTS, 'sheet-edit.png'), captureBeyondViewport: false });
    await retype(page, T('xf-desc'), `${e.description}（改过）`);
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await app.idle();
    await waitForAnimationsDone(page, 4000);
    assert.match(await text(page, `${row} .xcard__header`), /（改过）/);
    assert.equal(await count(page, '.lg-item'), LIVE.length, '笔数不变');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('删除：左滑拉到底直接删、详情里的删除、长按删除——都能撤销', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const [a, b, c] = D2;
    const row = (id) => T(`ledger-expense-${id}`);
    const swipe = (id) => T(`ledger-swipe-${id}`);
    // 触屏一直拉到底
    await page.$eval(row(a.id), (el) => el.scrollIntoView({ block: 'center' }));
    const r1 = await page.$eval(swipe(a.id), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
    await page.touchscreen.touchStart(r1.x + r1.w - 20, r1.y);
    for (let dx = 0; dx <= r1.w * 0.8; dx += 20) {
      await page.touchscreen.touchMove(r1.x + r1.w - 20 - dx, r1.y);
      await sleep(16);
    }
    assert.equal(await page.$eval(swipe(a.id), (el) => el.hasAttribute('data-armed')), true);
    const sy = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: path.join(SHOTS, 'swipe-armed.png'), clip: { x: 0, y: sy + r1.y - 40, width: 390, height: 80 }, captureBeyondViewport: false });
    await page.touchscreen.touchEnd();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 6000 }, row(a.id));
    await page.waitForSelector(T('toast-action'), { timeout: 4000 });
    assert.match(await text(page, T('toast')), /已删除/);
    await page.click(T('toast-action'));
    await page.waitForSelector(row(a.id), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    // 详情里的删除
    await page.$eval(row(b.id), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${row(b.id)} .xcard__header`);
    await waitForAnimationsDone(page, 4000);
    await page.click(T(`ledger-delete-${b.id}`));
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 6000 }, row(b.id));
    await page.waitForSelector(T('toast-action'), { timeout: 4000 });
    await page.click(T('toast-action'));
    await page.waitForSelector(row(b.id), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    // 长按
    await page.$eval(row(c.id), (el) => el.scrollIntoView({ block: 'center' }));
    const r3 = await page.$eval(row(c.id), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 120, y: r.top + r.height / 2 }; });
    await page.mouse.move(r3.x, r3.y);
    await page.mouse.down();
    // 按住期间有渐进反馈（data-holding：危险色从左往右铺满、行微缩），还没删
    await sleep(400);
    assert.ok(await page.$eval(row(c.id), (el) => el.hasAttribute('data-holding')), '按住 400ms：正在长按的反馈');
    await page.screenshot({ path: path.join(SHOTS, 'longpress-400.png'), captureBeyondViewport: false });
    await sleep(500);
    await page.mouse.up();
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 6000 }, row(c.id));
    assert.equal(await count(page, '.lg-item'), LIVE.length - 1);
    await page.waitForSelector(T('toast-action'), { timeout: 4000 });
    await page.click(T('toast-action'));
    await page.waitForSelector(row(c.id), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    assert.equal(await count(page, '.lg-item'), LIVE.length);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('离线也能记：记的那一笔标「待同步」，面板底部说明离线；联网后「待同步」消失', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    // 先在线打开一次面板（把按需加载的代码拿到手），再断网
    await page.$eval(T('ledger-add'), (el) => el.click());
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await app.idle();
    await page.setOfflineMode(true);
    await page.waitForSelector(`${T('sync-bar')}[data-state="offline"]`, { timeout: 8000 });
    await page.$eval(T('ledger-add'), (el) => el.click());
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    assert.match(await text(page, T('xf-foot-note')), /离线/);
    await page.focus(T('xf-amount-input'));
    await page.keyboard.type('120000');
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await page.waitForSelector('.lg-item[data-fresh]', { timeout: 8000 });
    const id = await page.$eval('.lg-item[data-fresh]', (el) => el.dataset.testid.replace('ledger-expense-', ''));
    await waitForAnimationsDone(page, 6000);
    await page.waitForSelector(T(`ledger-pending-${id}`), { timeout: 4000 });
    assert.match(await text(page, T(`ledger-pending-${id}`)), /待同步/);
    assert.match(await text(page, T('ledger-fx')), /离线/, '汇率说明标离线');
    await page.screenshot({ path: path.join(SHOTS, 'offline-pending.png'), captureBeyondViewport: false });
    // 联网：自动同步，「待同步」消失
    await page.setOfflineMode(false);
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 15000 }, T(`ledger-pending-${id}`));
    app.assertClean({ allowErrors: [/net::ERR_INTERNET_DISCONNECTED|请求失败/] });
  } finally {
    await app.close();
  }
});

test('一键「记为已结清」：结算变成已结清、记录谁什么时候；撤销后回来；结清后新记的账从零算', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    const linesBefore = await count(page, T('ledger-settle-line'));
    assert.ok(linesBefore > 0);
    // 「已记为结清」的提示在 r.saved 之后才弹：看到它 = 改动已经写进本机队列
    const settledToast = () => page.waitForFunction(() => /已记为结清/.test(document.querySelector('[data-testid="toast"]')?.textContent || ''), { timeout: 8000 });
    await page.click(T('ledger-settle-btn'));
    // 先问一句：确认框里列出要记下的金额（按币种分别列）；点「还没给」什么都不变
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 8000 });
    const ask = await page.$eval('[role="alertdialog"], [role="dialog"]', (el) => el.textContent);
    assert.match(ask, /记为已结清/);
    assert.match(ask, /给 .*(₫|HK\$|¥)/, ask);
    await page.click(T('dialog-cancel'));
    await sleep(600);
    assert.equal(await count(page, T('ledger-settle-line')), linesBefore, '取消以后照旧');
    await page.click(T('ledger-settle-btn'));
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 8000 });
    await page.click(T('dialog-confirm'));
    await page.waitForSelector(T('ledger-settle-even'), { timeout: 8000 });
    await settledToast();
    await waitForAnimationsDone(page, 4000);
    assert.match(await text(page, T('ledger-settle-even')), /已结清/);
    const last = await text(page, T('ledger-settle-last'));
    assert.match(last, /上次结清/);
    assert.match(last, /Jeremy 记录/);
    assert.match(last, /给了 .*(₫|HK\$|¥)/, '上次结清那一行写当时结了多少');
    assert.equal(await count(page, T('ledger-settle-line')), 0);
    await page.screenshot({ path: path.join(SHOTS, 'settled.png'), captureBeyondViewport: false });
    // 之后新记一笔（Jeremy 付 200,000₫ 平摊）→ Cathy 应给 Jeremy 100,000₫
    await page.$eval(T('ledger-add'), (el) => el.click());
    await page.waitForFunction(() => /sheet=expense/.test(location.hash), { timeout: 8000 });
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    await page.focus(T('xf-amount-input'));
    await page.keyboard.type('200000');
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await page.waitForSelector(T('ledger-settle-line'), { timeout: 8000 });
    const line = await text(page, T('ledger-settle-line'));
    assert.match(line, /Cathy 应给 Jeremy/);
    assert.match(line, /100,000₫/);
    assert.match(await text(page, T('ledger-settle-last')), /之后又记了 1 笔/);
    // 撤销上次的结清：回到原来的样子（多了那笔）
    await page.$eval(T('ledger-settle-undo'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('ledger-settle-undo'));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="ledger-settle-line"]').length === n && !document.querySelector('[data-testid="ledger-settle-last"]'), { timeout: 6000 }, linesBefore);
    // 刷新后结清记录还在（存在行程里，演示模式的 IndexedDB；等提示弹出来 = 已经写进本机队列再刷新）
    await page.click(T('ledger-settle-btn'));
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 8000 });
    await page.click(T('dialog-confirm'));
    await page.waitForSelector(T('ledger-settle-even'), { timeout: 8000 });
    await settledToast();
    await sleep(300);
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    await page.waitForSelector(T('ledger-settle-last'), { timeout: 15000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('?expense=<id>（搜索结果、「已记一笔 · 查看」）：定位到那一笔、展开并高亮，参数随后从网址去掉；从别的页面记一笔会提示「查看」', async () => {
  const e = LIVE.find((x) => x.date === '2027-01-10');
  const app = await openApp({ browser, server, hash: `#/t/demo-island/ledger?expense=${e.id}`, now: NOW });
  const { page } = app;
  try {
    await page.waitForSelector(`${T(`ledger-expense-${e.id}`)} .xcard[data-open]`, { timeout: 15000 });
    await page.waitForFunction(() => !location.hash.includes('expense='));
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(T(`ledger-expense-${e.id}`), (el) => el.hasAttribute('data-focus')), true);
    const r = await page.$eval(T(`ledger-expense-${e.id}`), (el) => ({ top: el.getBoundingClientRect().top }));
    assert.ok(r.top >= 0 && r.top < 700, `滚到了那一笔：${r.top}`);
    app.assertClean();
  } finally {
    await app.close();
  }

  // 从每天页打开记一笔（预填条目）→ 保存 → 提示「已记一笔 · 查看」→ 去账本并定位
  const item = island('items').find((it) => it.day_id && it.place_id && it.variant === 'primary' && it.kind === 'food');
  const day = island('days').find((d) => d.id === item.day_id);
  const app2 = await openApp({ browser, server, hash: `#/t/demo-island/day/${day.date}?sheet=expense:i.${item.id}`, now: NOW });
  const p2 = app2.page;
  try {
    await p2.waitForSelector(T('xf-form'), { timeout: 15000 });
    await app2.idle();
    assert.equal(await p2.$eval(T('xf-desc'), (el) => el.value), item.title, '条目标题预填成说明');
    assert.equal(await p2.$eval(T('xf-date'), (el) => el.value), day.date, '条目的那天');
    assert.equal(await p2.$eval(T('xf-item'), (el) => el.value), item.id, '关联了条目');
    assert.ok(await p2.$$eval(`${T('xf-cats')} .chip`, (els) => els.some((c) => c.getAttribute('aria-pressed') === 'true' && c.textContent.includes('餐饮'))), '按条目类型选了分类');
    await p2.focus(T('xf-amount-input'));
    await p2.keyboard.type('88000');
    await p2.click(T('xf-submit'));
    await p2.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await p2.waitForSelector(T('toast-action'), { timeout: 4000 });
    assert.match(await text(p2, T('toast')), /已记一笔/);
    await p2.click(T('toast-action'));
    await p2.waitForFunction(() => location.hash.includes('/ledger'), { timeout: 8000 });
    await p2.waitForSelector('.lg-item[data-focus] .xcard[data-open]', { timeout: 15000 });
    assert.match(await text(p2, '.lg-item[data-focus]'), /88,000₫/);
    app2.assertClean();
  } finally {
    await app2.close();
  }
});

test('记一笔面板：深色、桌面 1280、减弱动态效果下无报错、不横向滚动、触控区 ≥44；币种「其他」出下拉', async () => {
  for (const [name, o] of [['dark', { colorScheme: 'dark' }], ['desktop', { device: 'desktop' }], ['reduced', { reducedMotion: true }]]) {
    const app = await openApp({ browser, server, hash: '#/t/demo-island/ledger?sheet=expense', now: NOW, ...o });
    const { page } = app;
    try {
      await page.waitForSelector(T('xf-form'), { timeout: 15000 });
      await app.idle();
      if (name === 'dark') {
        await clickSeg(page, T('xf-amount'), '其他');
        await page.waitForSelector(T('xf-currency-other'));
        assert.match(await text(page, T('xf-amount-unit')), /美元/);
        await page.select(T('xf-currency-other'), 'JPY');
        assert.match(await text(page, T('xf-amount-unit')), /日元/);
        await clickSeg(page, T('xf-amount'), '港币');
        assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.getAttribute('inputmode')), 'decimal');
        assert.equal(await hasEl(page, T('xf-quick-k')), false, '港币没有「千 / 万」');
      }
      await page.screenshot({ path: path.join(SHOTS, `sheet-${name}.png`), captureBeyondViewport: false });
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

/**
 * 把演示后台里 Cathy 改成只读成员（先做一次会写回的改动，让演示后台把整库存进 IndexedDB），再以 Cathy 打开 hash。
 * 和清单页、预订页的只读测试同一个做法：走真实的权限（store.view.canEdit），不靠页面里的开关。
 * 这里的“改动”是删一笔再撤销：数据回到原样，但演示后台已经落盘。
 */
async function reopenAsViewer(app, hash) {
  const { page } = app;
  const e = D2[0];
  const row = T(`ledger-expense-${e.id}`);
  await page.$eval(row, (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(`${row} .xcard__header`);
  await waitForAnimationsDone(page, 4000);
  await page.click(T(`ledger-delete-${e.id}`));
  await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 6000 }, row);
  await page.waitForSelector(T('toast-action'), { timeout: 4000 });
  await page.click(T('toast-action'));
  await page.waitForSelector(row, { timeout: 6000 });
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
  url.hash = hash;
  await page.goto(url.href);
  await page.waitForSelector(T('ledger-total'), { timeout: 10000 });
  await app.idle();
}

test('只读成员（演示后台里把 Cathy 改成只读）：看得到总花费和结算、没有记一笔 / 记为已结清 / 编辑 / 删除，左滑和长按都不删；记一笔面板全部禁用并说明', async () => {
  const app = await openLedger();
  const { page } = app;
  try {
    await reopenAsViewer(app, '#/t/demo-island/ledger');
    assert.ok(await hasEl(page, T('ledger-total')) && await hasEl(page, T('ledger-settle')), '总花费和结算照常看');
    assert.equal(await hasEl(page, T('ledger-settle-btn')), false, '没有「记为已结清」');
    assert.equal(await hasEl(page, T('ledger-add')), false, '没有「记一笔」');
    assert.match(await text(page, '.lg-ro'), /只读成员/);
    assert.equal(await page.$('.k-swipe'), null, '左滑不动');
    const e = D2[0];
    const row = T(`ledger-expense-${e.id}`);
    await page.$eval(row, (el) => el.scrollIntoView({ block: 'center' }));
    // 长按不删
    const r = await page.$eval(row, (el) => { const b = el.getBoundingClientRect(); return { x: b.left + 120, y: b.top + 22 }; });
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await sleep(900);
    await page.mouse.up();
    await sleep(200);
    assert.ok(await hasEl(page, row), '长按不删');
    assert.equal(await count(page, '.lg-item'), LIVE.length);
    // 详情能看，没有编辑 / 删除
    await page.click(`${row} .xcard__header`);
    await waitForAnimationsDone(page, 4000);
    assert.match(await text(page, T(`ledger-detail-${e.id}`)), /只读成员不能修改/);
    assert.equal(await hasEl(page, T(`ledger-edit-${e.id}`)), false);
    assert.equal(await hasEl(page, T(`ledger-delete-${e.id}`)), false);
    await page.screenshot({ path: path.join(SHOTS, 'readonly.png'), captureBeyondViewport: false });
    await assertTapTargets(page);
    // 直接打开记一笔面板（网址 / ＋ 面板都可能打开）：全部禁用、底部说明只读、提交按钮禁用
    await app.go('#/t/demo-island/ledger?sheet=expense');
    await page.waitForSelector(T('xf-form'), { timeout: 8000 });
    await app.idle();
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.disabled), true, '金额框禁用');
    assert.equal(await page.$eval(T('xf-desc'), (el) => el.disabled), true);
    assert.match(await text(page, T('xf-foot-note')), /只读成员/);
    assert.equal(await page.$eval(T('xf-submit'), (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'), true, '提交按钮禁用');
    await page.screenshot({ path: path.join(SHOTS, 'readonly-sheet.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('加载中骨架（演示网络慢 1.5 秒）→ 交叉淡入；第一次打开就断网（没有缓存）→ 中文原因 + 重试', async () => {
  const slow = await openApp({ browser, server, hash: '#/t/demo-island/ledger', now: NOW, search: { demolatency: '1500' }, waitForApp: false });
  try {
    await slow.page.waitForSelector(`${T('page-ledger')} .reveal[data-loading] ${T('ledger-loading')}`, { timeout: 10000 });
    await slow.page.waitForFunction(() => !document.getElementById('boot'), { timeout: 10000 });
    await slow.page.screenshot({ path: path.join(SHOTS, 'loading.png'), captureBeyondViewport: false });
    await slow.page.waitForSelector(`${T('page-ledger')} .reveal:not([data-loading]) ${T('ledger-total')}`, { timeout: 15000 });
    slow.assertClean();
  } finally {
    await slow.close();
  }
  const off = await openApp({ browser, server, hash: '#/t/demo-island/ledger', now: NOW, search: { demonet: 'offline' }, waitForApp: false });
  try {
    await off.page.waitForSelector(T('ledger-error'), { timeout: 30000 });
    assert.match(await text(off.page, T('ledger-error')), /网络|重试/);
    await off.page.waitForFunction(() => !document.getElementById('boot'), { timeout: 10000 });
    await waitForAnimationsDone(off.page, 4000);
    await off.page.screenshot({ path: path.join(SHOTS, 'error-offline.png'), captureBeyondViewport: false });
    off.assertClean({ allowErrors: [/./] });
  } finally {
    await off.close();
  }
});

test('出发前 / 结束后记一笔：日期默认“今天”（行程时区）、不在行程里不标 D 几；新台币没有「千 / 万」；出发前从 ＋ 面板打开也是今天', async () => {
  // 结束后（三城，台北时区）：今天 = NOW 在台北的日期 2027-01-11，早就不在行程里
  const cities = await openApp({ browser, server, hash: '#/t/demo-cities/ledger?sheet=expense', now: NOW });
  try {
    await cities.page.waitForSelector(T('xf-form'), { timeout: 15000 });
    await cities.idle();
    assert.equal(await cities.page.$eval(T('xf-date'), (el) => el.value), '2027-01-11');
    assert.ok(!/D\d/.test(await text(cities.page, T('xf-when-label'))), '不在行程里不标 D 几');
    assert.match(await text(cities.page, T('xf-amount-unit')), /新台币/);
    assert.equal(await hasEl(cities.page, T('xf-quick-k')), false, '新台币没有「千 / 万」');
    await cities.page.screenshot({ path: path.join(SHOTS, 'sheet-ended.png'), captureBeyondViewport: false });
    cities.assertClean();
  } finally {
    await cities.close();
  }
  // 出发前（海岛，1 月 8 日）：＋ 面板 → 记一笔 → 日期是今天（越南时间 1 月 8 日），不是行程第一天
  const up = await openApp({ browser, server, hash: '#/t/demo-island/ledger', now: '2027-01-08T09:00:00+07:00' });
  try {
    await up.page.waitForSelector(T('ledger-total'), { timeout: 15000 });
    await up.idle();
    await up.page.click(T('shell-fab'));
    await up.page.waitForSelector(T('fab-expense'), { timeout: 8000 });
    await up.idle();
    await up.page.click(T('fab-expense'));
    await up.page.waitForSelector(T('xf-form'), { timeout: 8000 });
    await up.idle();
    assert.equal(await up.page.$eval(T('xf-date'), (el) => el.value), '2027-01-08');
    assert.equal(await up.page.evaluate(() => document.activeElement?.dataset?.testid), 'xf-amount-input', '金额框自动聚焦');
    await up.page.screenshot({ path: path.join(SHOTS, 'sheet-upcoming.png'), captureBeyondViewport: false });
    up.assertClean();
  } finally {
    await up.close();
  }
});

test('超长说明（带越南语）和 10 位的金额：面板里不撑破、流水里折行、金额列不挤；375 宽不横向滚动', async () => {
  const app = await openLedger({ device: 'small' });
  const { page } = app;
  try {
    const long = 'Quán Bún Quậy Kiến Xây – bún quậy hải sản hai tô, thêm chả mực, trà đá, gửi xe máy 5k, tiền boa cho anh phục vụ';
    await page.$eval(T('ledger-add'), (el) => el.click());
    await page.waitForSelector(T('xf-amount-input'), { timeout: 8000 });
    await app.idle();
    await page.focus(T('xf-amount-input'));
    await page.keyboard.type('1234567890');
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), '1,234,567,890');
    assert.equal(await page.$eval(T('xf-amount'), (el) => el.hasAttribute('data-long')), true, '位数多时缩一号');
    await retype(page, T('xf-desc'), long);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'sheet-long-375.png'), captureBeyondViewport: false });
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 8000 });
    await page.waitForFunction((t) => [...document.querySelectorAll('.lg-item')].some((el) => el.textContent.includes(t)), { timeout: 8000 }, 'Bún Quậy');
    await waitForAnimationsDone(page, 6000);
    const row = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.lg-item')].find((x) => x.textContent.includes(t));
      const r = el.getBoundingClientRect();
      const v = el.querySelector('.lg-row__value').getBoundingClientRect();
      return { text: el.textContent, left: r.left, right: r.right, valueW: v.width, w: window.innerWidth };
    }, 'Bún Quậy');
    assert.match(row.text, /1,234,567,890₫/);
    assert.ok(row.right <= row.w + 1 && row.left >= -1, `行没有撑出屏幕：${row.left}–${row.right}`);
    assert.ok(row.valueW <= row.w * 0.5, `金额列不超过一半：${row.valueW}`);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'long-desc-375.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('从条目打开：费用预估「用预估」一键填入（每人 × 人数）；小票照片：拍 / 选一张 → 缩略图 → 保存后详情里能看、点一下放大', async () => {
  const item = island('items').find((it) => it.variant === 'primary' && !it.deleted_at && it.cost_estimate?.per === 'person' && it.cost_estimate?.amount);
  assert.ok(item, '演示数据里有按人预估费用的条目');
  const day = island('days').find((d) => d.id === item.day_id);
  const app = await openApp({ browser, server, hash: `#/t/demo-island/day/${day.date}?sheet=expense:i.${item.id}`, now: NOW });
  const { page } = app;
  try {
    await page.waitForSelector(T('xf-form'), { timeout: 15000 });
    await app.idle();
    const hint = await text(page, T('xf-hint'));
    assert.match(hint, /预估/);
    assert.match(hint, /\/ 人/, '按人的预估写明每人');
    await page.$$eval(`${T('xf-hint')} button`, (els) => els[0]?.click());
    const members = island('trip_members').filter((m) => m.role === 'owner' || m.role === 'editor').length;
    const expect = (Number(item.cost_estimate.amount) * members).toLocaleString('en-US');
    assert.equal(await page.$eval(T('xf-amount-input'), (el) => el.value), expect, '每人预估 × 可分摊的人数');
    // 小票：透明的 file input 叠在按钮上
    const input = await page.$(T('xf-receipt-input'));
    await input.uploadFile(path.join(fileURLToPath(new URL('../../demo/photos/', import.meta.url)), 'demo-photo-02.jpg'));
    await page.waitForSelector(`${T('xf-receipt-thumb')} img`, { timeout: 15000 });
    await page.screenshot({ path: path.join(SHOTS, 'sheet-receipt.png'), captureBeyondViewport: false });
    await page.click(T('xf-submit'));
    await page.waitForFunction(() => !/sheet=expense/.test(location.hash), { timeout: 10000 });
    await page.waitForSelector(T('toast-action'), { timeout: 4000 });
    await page.click(T('toast-action'));
    await page.waitForFunction(() => location.hash.includes('/ledger'), { timeout: 8000 });
    await page.waitForSelector('.lg-item[data-focus] .xcard[data-open]', { timeout: 15000 });
    await waitForAnimationsDone(page, 4000);
    const id = await page.$eval('.lg-item[data-focus]', (el) => el.dataset.testid.replace('ledger-expense-', ''));
    await page.waitForSelector(`${T(`ledger-detail-${id}`)} .lg-detail__receipt img`, { timeout: 15000 });
    const small = await page.$eval(`${T(`ledger-detail-${id}`)} .lg-detail__receipt`, (el) => el.getBoundingClientRect().width);
    await page.click(`${T(`ledger-detail-${id}`)} .lg-detail__receipt`);
    await page.waitForFunction((sel, w) => (document.querySelector(sel)?.getBoundingClientRect().width || 0) > w * 2, { timeout: 4000 }, `${T(`ledger-detail-${id}`)} .lg-detail__receipt`, small);
    await waitForAnimationsDone(page, 4000);
    await page.screenshot({ path: path.join(SHOTS, 'detail-receipt.png'), captureBeyondViewport: false });
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});
