// 清单页（#/t/:tripId/lists，src/pages/lists/）和待办弹层（?sheet=todo，src/sheets/todo/）：
// 四个标签带进度、?list= 记住标签、标签贴顶变玻璃胶囊；勾选（圆圈 + 划线半路图）→ 先留在原位 → FLIP 沉到下面（半路图）→
// 「已完成 · 撤销」；左滑删除 + 撤销；快速添加（回车连续加、打包按名字猜分类、带上筛选的人）；打包按分类分组、谁的东西筛选（?who=）、
// 步进器改数量、隐藏已装好；全部勾完的小小庆祝（半路图）；搜索跳过来（?todo=）滚过去闪一下；
// 待办弹层：点行编辑（改标题、设截止时间、保存）、直接打开网址新建、删除、找不到的 id、「关联」收起成摘要 / 原地展开（半路图）；行程结束以后不催；
// 备注：没勾的显示全文，里面的电话 / 网址在下面给「打电话」「打开网页」小胶囊（点了不打开编辑）；
// 状态：空行程（「用常用清单开始」）、找不到行程、只读成员（演示后台里把 Cathy 改成只读）、深色 / 375 / 1280、减弱动态效果下无报错、不横向滚动、触控区 ≥44；
// 时区：人在香港（设备时区和行程不一样）时卡片头说一次「截止时间按越南时间」、行里不重复，弹层里换算成香港时间；人在越南时都不说。
// 截图：<截图根目录>/__screenshots__/page-lists/，半路图：__shots__/page-lists/。期望的数字从演示数据库算（demo/demo-db.json，全部虚构）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, shotsDir, SCREENSHOT_DIR, fullPageShots } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const todosOf = (tripId) => DB.tables.todos.filter((t) => t.trip_id === tripId);
const ISLAND = todosOf('demo-island');
const byTitle = (title) => ISLAND.find((t) => t.title === title);
const listOf = (list) => ISLAND.filter((t) => t.list === list).sort((a, b) => a.sort - b.sort);
const CATHY = DB.tables.trip_members.find((m) => m.trip_id === 'demo-island' && m.display_name === 'Cathy');

const SHOTS = shotsDir('page-lists');
const PAGE_SHOTS = path.join(SCREENSHOT_DIR, 'page-lists');
const T = (id) => `[data-testid="${id}"]`;
const PAGE = T('page-lists');
const NOW_UPCOMING = '2027-01-08T09:00:00+07:00';
const NOW_ONGOING = '2027-01-11T10:00:00+07:00';
const NOW_ENDED = '2027-01-20T10:00:00+07:00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(PAGE_SHOTS, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** 打开清单页，等数据到了（卡片头或空状态出现） */
async function openLists(hash = '#/t/demo-island/lists', o = {}) {
  const app = await openApp({ browser, server, hash, now: NOW_UPCOMING, ...o });
  await app.page.waitForSelector(`${PAGE} .lists__body`, { timeout: 10000 });
  await app.idle();
  return app;
}

/** 某个清单卡片里一行一行的 id（按屏幕顺序），done：只看勾完的 / 没勾的 */
const rowIds = (page, scope = PAGE) => page.$$eval(`${scope} .litem .lrow`, (els) => els.map((el) => ({ id: el.dataset.testid.slice(5), done: el.hasAttribute('data-done') })));

/** 一行的上边（视口坐标） */
const rowTop = (page, id) => page.$eval(T(`todo-${id}`), (el) => el.getBoundingClientRect().top);

/** 只检查页面内容里的可点元素 ≥44px（外壳的顶栏、底栏由外壳自己的测试管）；算上 ::after 扩出的热区 */
async function assertTapTargetsIn(page, root = PAGE, min = 44) {
  const small = await page.evaluate((rootSel, minSize) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], [role="tab"], [role="radio"], input:not([type="hidden"]), select, textarea';
    for (const el of document.querySelectorAll(`${rootSel} :is(${sel})`)) {
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      // 被裁掉的（左滑行收着的托盘）不算
      if (el.closest('.k-swipe__tray')) continue;
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

/** 截一张当前屏（不滚动） */
const screen = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });

test('四个标签带进度「3/7」、?list= 记住标签、换标签内容从那一侧滑进来（半路图），手机 390 无报错、不横向滚动、触控区 ≥44', async () => {
  const app = await openLists();
  const { page } = app;
  try {
    // 标签：名字和进度都和演示数据一致
    const tabs = await page.$$eval(`${T('lists-tabs')} [role="tab"]`, (els) => els.map((el) => el.textContent.replace(/\s+/g, '')));
    const expect = [['confirm', '待确认'], ['todo', '待办'], ['packing', '打包'], ['buy', '要买']].map(([l, name]) => {
      const rows = ISLAND.filter((t) => t.list === l);
      return `${name}${rows.filter((t) => t.done).length}/${rows.length}`;
    });
    assert.deepEqual(tabs, expect);
    // 出发前、没指定标签：待确认（还有没勾的）
    assert.equal(await page.$eval(`${T('lists-tabs')} [aria-selected="true"]`, (el) => el.textContent.replace(/[\d/\s]/g, '')), '待确认');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page);
    await fullPageShots(page, path.join(PAGE_SHOTS, 'confirm-390.png'));

    // 换到「打包」：网址 replace 成 ?list=packing，内容从右边滑进来
    const histBefore = await page.evaluate(() => history.length);
    const mid = await captureAt(app, () => page.click('#lists-tab-packing'), { selector: '.lists__panel', progress: 0.3, evaluate: () => {
      const el = document.querySelector('.lists__panel');
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { x: m.m41, o: Number(getComputedStyle(el).opacity) };
    } });
    try {
      await screen(page, 'tab-switch-30');
      assert.ok(mid.state.x > 1 && mid.state.x < 28, `从右边滑进来，半路 x=${mid.state.x}`);
      assert.ok(mid.state.o > 0 && mid.state.o < 1, `半路半透明 o=${mid.state.o}`);
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 4000);
    assert.match(await page.evaluate(() => location.hash), /list=packing/);
    assert.equal(await page.evaluate(() => history.length), histBefore, '换标签不压历史');
    assert.ok(await page.$(T('lists-panel-packing')));
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page);
    await fullPageShots(page, path.join(PAGE_SHOTS, 'packing-390.png'));

    // 刷新：还在打包
    await page.reload();
    await page.waitForSelector(T('lists-panel-packing'), { timeout: 10000 });
    for (const l of ['todo', 'buy']) {
      await page.click(`#lists-tab-${l}`);
      await page.waitForSelector(T(`lists-panel-${l}`));
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page);
      await fullPageShots(page, path.join(PAGE_SHOTS, `${l}-390.png`));
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('往下滚：标签栏贴在顶栏下面，变成玻璃胶囊；能直接换标签', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing');
  const { page } = app;
  try {
    assert.equal(await page.$eval('.lists__bar', (el) => el.hasAttribute('data-stuck')), false);
    await page.evaluate(() => window.scrollTo(0, 1400));
    await page.waitForFunction(() => document.querySelector('.lists__bar')?.hasAttribute('data-stuck'), { timeout: 4000 });
    await app.idle();
    const top = await page.$eval('.lists__bar', (el) => el.getBoundingClientRect().top);
    assert.ok(top > 60 && top < 100, `贴在顶栏下面：${top}`);
    const bf = await page.$eval('.lists__bar', (el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter);
    assert.match(bf, /blur/);
    await screen(page, 'tabs-stuck');
    await page.click('#lists-tab-buy');
    await page.waitForSelector(T('lists-panel-buy'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('勾选：圆圈弹出 + 划线（半路图）→ 先留在原位 → 0.9 秒后 FLIP 沉到「已完成」最上面（半路图）→「已完成「…」· 撤销」，撤销回到原位', async () => {
  const app = await openLists('#/t/demo-island/lists?list=todo');
  const { page } = app;
  try {
    const before = await rowIds(page);
    const first = before.find((r) => !r.done);
    const second = before.filter((r) => !r.done)[1];
    const y0 = await rowTop(page, first.id);
    // 勾选的半路（底色是 bouncy 弹簧，740ms 停稳但前 300ms 就长满了，所以取 22% 那一刻）：圆圈底色正在从中心弹出、划线刚开始画
    // 同一刻读：这一行的位置（刚勾的先留在手指下面）——截图在机器忙时可能要好几百毫秒，0.9 秒的计时器不等动画，所以位置要在这里读
    const mid = await captureAt(app, () => page.click(`${T(`todo-${first.id}`)} .check__input`), { selector: '.check__fill', progress: 0.22, evaluate: () => {
      const fill = document.querySelector('.lrow[data-done] .check__fill');
      const tt = document.querySelector('.lrow[data-done] .lrow__tt');
      const row = document.querySelector('.lrow[data-done]');
      return {
        scale: fill ? parseFloat(getComputedStyle(fill).scale) : null,
        strike: tt ? parseFloat(getComputedStyle(tt).backgroundSize) : null,
        id: row?.dataset.testid || null,
        top: row ? row.getBoundingClientRect().top : null,
      };
    } });
    try {
      // 刚勾：还在原位（没跳走），数据已经是勾上的
      assert.equal(mid.state.id, `todo-${first.id}`);
      assert.equal(Math.round(mid.state.top), Math.round(y0), '刚勾的先留在手指下面');
      assert.ok(mid.state.scale > 0.2 && mid.state.scale < 1, `底色正在弹出：scale=${mid.state.scale}`);
      assert.ok(mid.state.strike >= 0 && mid.state.strike < 100, `划线还没画完：${mid.state.strike}%`);
      await page.evaluate((id) => document.querySelector(`[data-testid="todo-${id}"]`).scrollIntoView({ block: 'center' }), first.id);
      await screen(page, 'check-22');
    } finally {
      await release(mid);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    // 等它沉下去：最后一次勾选 0.9 秒后
    await page.waitForFunction((id) => {
      const rows = [...document.querySelectorAll('.litem .lrow')];
      const done = rows.findIndex((el) => el.dataset.testid === `todo-${id}`);
      const divider = document.querySelector('[data-testid="lists-done-toggle"]');
      return divider && done >= 0 && (rows[done].compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_PRECEDING);
    }, { timeout: 4000 }, first.id);
    await waitForAnimationsDone(page, 4000);
    const after = await rowIds(page);
    const doneIdx = after.findIndex((r) => r.id === first.id);
    const firstDone = after.findIndex((r) => r.done);
    assert.equal(doneIdx, firstDone, '沉到「已完成」最上面');
    assert.equal(after.find((r) => !r.done).id, second.id, '下一项顶上来');
    // 提示：已完成「…」· 撤销
    const toast = await page.waitForFunction(() => [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].find((el) => /已完成「/.test(el.textContent || '')), { timeout: 3000 });
    assert.ok(toast);
    await screen(page, 'check-sunk');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '撤销');
      btn.click();
    });
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="todo-${id}"]`)?.hasAttribute('data-done'), { timeout: 3000 }, first.id);
    await waitForAnimationsDone(page, 4000);
    assert.equal((await rowIds(page)).find((r) => !r.done).id, first.id, '撤销后回到原来的位置');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('连着勾几项：都先留在原位，最后一次勾选之后一起沉（FLIP 半路图），提示「已买到 2 样」', async () => {
  const app = await openLists('#/t/demo-island/lists?list=buy');
  const { page } = app;
  try {
    const open = (await rowIds(page)).filter((r) => !r.done);
    await page.click(`${T(`todo-${open[0].id}`)} .check__input`);
    await sleep(350);
    const y1 = await rowTop(page, open[1].id);
    // 第二项勾下去的同时等计时器到点：拨到 FLIP 的半路
    const mid = await captureAt(app, async () => {
      await page.click(`${T(`todo-${open[1].id}`)} .check__input`);
      await sleep(1100);
    }, { selector: '.litem', progress: 0.35, evaluate: (id) => null });
    try {
      await screen(page, 'sink-flip-35');
      const yMid = await rowTop(page, open[1].id);
      assert.ok(yMid > y1 + 2, `正在往下沉：${y1} → ${yMid}`);
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 4000);
    const yEnd = await rowTop(page, open[1].id);
    assert.ok(yEnd > y1 + 40, `沉到了下面：${yEnd}`);
    await page.waitForFunction(() => [...document.querySelectorAll('button, div, p, span')].some((el) => el.textContent?.trim().startsWith('已买到 2 样')), { timeout: 3000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('全部勾完：卡片头换成小小的庆祝（圆环画满、对勾描出、光点散开；半路图），刷新后是静止的样子', async () => {
  const app = await openLists('#/t/demo-island/lists?list=buy');
  const { page } = app;
  try {
    const open = (await rowIds(page)).filter((r) => !r.done);
    for (const r of open.slice(0, -1)) {
      await page.click(`${T(`todo-${r.id}`)} .check__input`);
      await sleep(120);
    }
    const last = open[open.length - 1];
    const mid = await captureAt(app, async () => {
      await page.click(`${T(`todo-${last.id}`)} .check__input`);
      await page.waitForSelector(`${T('lists-celebrate')}[data-play]`, { timeout: 4000 });
    }, { selector: '.lcele__ring', progress: 0.5, evaluate: () => ({ play: Boolean(document.querySelector('[data-testid="lists-celebrate"][data-play]')) }) });
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      await screen(page, 'celebrate-50');
      assert.equal(mid.state.play, true);
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'celebrate-end');
    assert.match(await page.$eval(T('lists-celebrate'), (el) => el.textContent), /都买齐了/);
    await page.reload();
    await page.waitForSelector(T('lists-celebrate'), { timeout: 10000 });
    assert.equal(await page.$eval(T('lists-celebrate'), (el) => el.hasAttribute('data-play')), false, '打开时就勾完了：不播');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('左滑删除（鼠标拖、拉到底直接删）→ 外壳弹「已删除 · 撤销」，撤销回来', async () => {
  const app = await openLists('#/t/demo-island/lists?list=todo');
  const { page } = app;
  try {
    const target = (await rowIds(page)).find((r) => !r.done);
    const sel = T(`todo-swipe-${target.id}`);
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    const box = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const y = box.y + Math.min(30, box.h / 2);
    await page.mouse.move(box.x + box.w - 30, y);
    await page.mouse.down();
    for (let dx = 0; dx <= 120; dx += 15) {
      await page.mouse.move(box.x + box.w - 30 - dx, y);
      await sleep(16);
    }
    await screen(page, 'swipe-open');
    await page.mouse.up();
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(sel, (el) => el.hasAttribute('data-open')), true);
    await page.click(`${sel} .k-swipe__act[data-key="delete"]`);
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="todo-${id}"]`), { timeout: 4000 }, target.id);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '撤销'), { timeout: 3000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '撤销').click());
    await page.waitForSelector(T(`todo-${target.id}`), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('快速添加：回车连续加两条（输入框留着焦点），新的一项从输入框上面弹出来；出错时说原因', async () => {
  const app = await openLists('#/t/demo-island/lists?list=confirm');
  const { page } = app;
  try {
    const input = `${T('lists-add-confirm-input')}`;
    await page.$eval(input, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(input);
    await page.keyboard.type('和民宿确认能不能寄存行李');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.lrow__tt')].some((el) => el.textContent === '和民宿确认能不能寄存行李'), { timeout: 4000 });
    await page.keyboard.type('确认接驳车车牌');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.lrow__tt')].some((el) => el.textContent === '确认接驳车车牌'), { timeout: 4000 });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'lists-add-confirm-input', '焦点留在输入框');
    // 新加的排在没勾的最后（输入框正上方）
    const open = (await rowIds(page)).filter((r) => !r.done);
    const titles = await page.$$eval('.litem .lrow:not([data-done]) .lrow__tt', (els) => els.map((el) => el.textContent));
    assert.deepEqual(titles.slice(-2), ['和民宿确认能不能寄存行李', '确认接驳车车牌']);
    assert.equal(open.length, titles.length);
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'inline-add');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('打包：按分类分组（出现顺序）、谁的东西筛选（?who=，组的先后不变）、步进器改数量、隐藏已装好、快速添加按名字猜分类并带上筛选的人', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing');
  const { page } = app;
  try {
    const packing = listOf('packing');
    const order = [];
    for (const t of packing) if (!order.includes(t.category || '其他')) order.push(t.category || '其他');
    const groups = await page.$$eval('[data-testid^="pack-group-"]', (els) => els.map((el) => el.dataset.testid.slice(11)));
    assert.deepEqual(groups, order);
    // 每组进度
    const head = await page.$eval(T('pack-group-证件'), (el) => el.querySelector('.lgroup__count').textContent.replace(/\s/g, ''));
    const docs = packing.filter((t) => t.category === '证件');
    assert.equal(head, `${docs.filter((t) => t.done).length}/${docs.length}`);

    // 筛选 Cathy：只剩 Cathy 的，网址 ?who=<id>
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="pack-who"] [role="radio"]')].find((b) => b.textContent.includes('Cathy')).click());
    await page.waitForFunction((id) => location.hash.includes(`who=${id}`), { timeout: 4000 }, CATHY.user_id);
    await app.idle();
    const shown = (await rowIds(page)).map((r) => r.id);
    const cathys = packing.filter((t) => t.assignee_user_id === CATHY.user_id).map((t) => t.id);
    assert.deepEqual([...shown].sort(), [...cathys].sort());
    assert.match(await page.$eval(T('lists-remaining'), (el) => el.textContent), /Cathy 还有/);
    await screen(page, 'packing-cathy');

    // 回到全部；步进器 + 一下
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="pack-who"] [role="radio"]')].find((b) => b.textContent.includes('全部')).click());
    await page.waitForFunction(() => !location.hash.includes('who='), { timeout: 4000 });
    const passport = byTitle('护照');
    const plus = `${T(`todo-${passport.id}`)} button[aria-label="增加"]`;
    await page.$eval(T(`todo-${passport.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    const before = await page.$eval(`${T(`todo-${passport.id}`)} [role="spinbutton"]`, (el) => el.getAttribute('aria-valuenow'));
    await page.click(plus);
    await page.waitForFunction((id, v) => document.querySelector(`[data-testid="todo-${id}"] [role="spinbutton"]`)?.getAttribute('aria-valuenow') === String(v), { timeout: 3000 }, passport.id, Number(before) + 1);

    // 隐藏已装好：勾完的不见了；再点回来
    const doneCount = packing.filter((t) => t.done).length;
    await page.$eval(T('pack-hide-done'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('pack-hide-done'));
    await page.waitForFunction(() => !document.querySelector('.lrow[data-done]'), { timeout: 4000 });
    await waitForAnimationsDone(page, 4000);
    assert.equal((await rowIds(page)).length, packing.length - doneCount);
    await page.click(T('pack-hide-done'));
    await page.waitForFunction((n) => document.querySelectorAll('.lrow[data-done]').length === n, { timeout: 4000 }, doneCount);

    // 快速添加：筛选 Cathy + 「充电器」→ 电子组，记为 Cathy 的
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="pack-who"] [role="radio"]')].find((b) => b.textContent.includes('Cathy')).click());
    await page.waitForFunction(() => location.hash.includes('who='), { timeout: 4000 });
    await page.$eval(T('lists-add-packing-input'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('lists-add-packing-input'));
    await page.keyboard.type('卷发棒充电器');
    await page.keyboard.press('Enter');
    await page.waitForSelector(T('pack-added'), { timeout: 4000 });
    assert.match(await page.$eval(T('pack-added'), (el) => el.textContent), /加到了电子/);
    const added = await page.$eval(T('pack-group-电子'), (el) => [...el.querySelectorAll('.lrow__tt')].map((x) => x.textContent));
    assert.ok(added.includes('卷发棒充电器'), '在电子组里（筛选 Cathy 时也看得见：记成了 Cathy 的）');
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'packing-added');
    // 「改」打开待办弹层
    await page.click(`${T('pack-added')} button`);
    await page.waitForSelector(T('todo-form'), { timeout: 6000 });
    assert.equal(await page.$eval(T('todo-title'), (el) => el.value), '卷发棒充电器');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('待办弹层：点一行打开编辑（预填）→ 改标题、设截止时间（快捷「明晚 21:00」）→ 保存（转圈打勾）→ 行里更新、截止提醒出现；再打开删除', async () => {
  const app = await openLists('#/t/demo-island/lists?list=todo');
  const { page } = app;
  try {
    const t = byTitle('两家酒店的越南语地址截图');
    await page.$eval(T(`todo-open-${t.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`todo-open-${t.id}`));
    await page.waitForSelector(T('todo-form'), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    assert.match(await page.evaluate(() => location.hash), new RegExp(`sheet=todo:${t.id}`));
    assert.equal(await page.$eval(T('todo-title'), (el) => el.value), t.title);
    await screen(page, 'sheet-edit');
    // 改标题
    await page.click(T('todo-title'), { clickCount: 3 });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="todo-title"]');
      el.select();
    });
    await page.keyboard.type('两家酒店的越南语地址截图（存相册）');
    // 截止时间：明晚 21:00
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="todo-due"] button')].find((b) => b.textContent.includes('明晚')).click());
    await page.waitForSelector(T('todo-due-date'));
    assert.match(await page.$eval(T('todo-due-hint'), (el) => el.textContent), /还剩|前/);
    await screen(page, 'sheet-edit-filled');
    await page.click(T('todo-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 8000 });
    await page.waitForFunction((id) => document.querySelector(`[data-testid="todo-${id}"] .lrow__tt`)?.textContent === '两家酒店的越南语地址截图（存相册）', { timeout: 4000 }, t.id);
    assert.ok(await page.$(T(`todo-due-${t.id}`)), '有截止提醒');
    // 再打开：删除 → 外壳的撤销提示
    await page.click(T(`todo-open-${t.id}`));
    await page.waitForSelector(T('todo-delete'), { timeout: 6000 });
    await page.$eval(T('todo-delete'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('todo-delete'));
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="todo-${id}"]`), { timeout: 4000 }, t.id);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '撤销'), { timeout: 3000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('待办弹层：直接打开网址新建（预填清单），回车添加；关联预订打开时默认放进「待确认」；不认识的 id 说清楚', async () => {
  const app = await openLists('#/t/demo-island/lists?list=buy&sheet=todo:l.buy');
  const { page } = app;
  try {
    await page.waitForSelector(T('todo-form'), { timeout: 8000 });
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(`${T('todo-list')} [aria-checked="true"]`, (el) => el.textContent.trim()), '要买');
    await screen(page, 'sheet-new');
    // 空标题提交：说原因、不关
    await page.click(T('todo-submit'));
    await page.waitForSelector('#todo-title-error');
    await page.click(T('todo-title'));
    await page.keyboard.type('滴漏咖啡滤纸');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 8000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.lrow__tt')].some((el) => el.textContent === '滴漏咖啡滤纸'), { timeout: 4000 });
    // 从预订来：默认待确认
    const booking = DB.tables.bookings.find((b) => b.trip_id === 'demo-island');
    await app.go(`#/t/demo-island/lists?sheet=todo:b.${booking.id}`);
    await page.waitForSelector(T('todo-form'), { timeout: 8000 });
    assert.equal(await page.$eval(`${T('todo-list')} [aria-checked="true"]`, (el) => el.textContent.trim()), '待确认');
    assert.equal(await page.$eval(T('todo-booking'), (el) => el.value), booking.id);
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 6000 });
    // 不认识的 id
    await app.go('#/t/demo-island/lists?sheet=todo:00000000-0000-4000-8000-000000000000');
    await page.waitForSelector(T('todo-sheet-missing'), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('待办弹层「关联」：平时收起成一行摘要，点开原地展开（半路图）→ 改哪天、关联预订 → 保存后行里出现对应的小链接', async () => {
  const app = await openLists('#/t/demo-island/lists?list=todo');
  const { page } = app;
  try {
    const t = byTitle('换一点越南盾现金');
    const booking = DB.tables.bookings.find((b) => b.trip_id === 'demo-island' && b.kind === 'hotel');
    await page.$eval(T(`todo-open-${t.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`todo-open-${t.id}`));
    await page.waitForSelector(T('todo-form'), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    // 收着：摘要里有 D1，详情区是 inert
    assert.equal(await page.$eval(T('todo-links'), (el) => el.hasAttribute('data-open')), false);
    assert.match(await page.$eval(`${T('todo-links')} .xcard__subtitle`, (el) => el.textContent), /^D1/);
    assert.equal(await page.$eval(`${T('todo-links')} .xcard__body`, (el) => el.inert), true);
    const h0 = await page.$eval(`${T('todo-links')} .xcard__body`, (el) => el.getBoundingClientRect().height);
    // 点开：半路高度在两头之间
    const mid = await captureAt(app, () => page.click(`${T('todo-links')} .xcard__header`), { selector: '.tdf-links .xcard__body', progress: 0.35, evaluate: () => document.querySelector('.tdf-links .xcard__body').getBoundingClientRect().height });
    try {
      await screen(page, 'links-open-35');
      assert.ok(mid.state > h0 + 4, `正在展开：${mid.state}`);
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 4000);
    const h1 = await page.$eval(`${T('todo-links')} .xcard__body`, (el) => el.getBoundingClientRect().height);
    assert.ok(h1 > mid.state + 4, `展开到底：${mid.state} → ${h1}`);
    // 改到 D2，关联酒店
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="todo-links"] .chip')].find((c) => c.textContent.startsWith('D2')).click());
    await page.select(T('todo-booking'), booking.id);
    await waitForAnimationsDone(page, 4000);
    assert.match(await page.$eval(`${T('todo-links')} .xcard__subtitle`, (el) => el.textContent), /^D2 · 预订「/);
    await screen(page, 'links-open');
    await page.click(T('todo-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 8000 });
    await page.waitForFunction((id) => {
      const links = [...document.querySelectorAll(`[data-testid="todo-${id}"] .lchip`)].map((el) => el.textContent);
      return links.some((x) => x.startsWith('D2')) && links.length === 2;
    }, { timeout: 4000 }, t.id);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('备注：没勾的显示全文；里面的电话 / 网址在下面给「打电话」「打开网页」小胶囊（点了不打开编辑，网址开新标签页；弹层里也有），勾完的收成一行、没有胶囊', async () => {
  const app = await openLists('#/t/demo-island/lists?list=todo');
  const { page } = app;
  try {
    const t = byTitle('两家酒店的越南语地址截图');
    // 写一段带电话、网址的长备注（号码、网址都是编的）
    await page.$eval(T(`todo-open-${t.id}`), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T(`todo-open-${t.id}`));
    await page.waitForSelector(T('todo-note'), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    const note = '给司机看。前台电话 +84 123 456 789，官网 example.vn/stay 。到了先在大堂问电动车接驳几点开始、几点结束，行李能不能先寄存，晚上回来太晚要不要提前说一声。';
    await page.$eval(T('todo-note'), (el) => { el.focus(); el.select(); });
    await page.keyboard.type(note);
    await page.click(T('todo-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 8000 });
    const row = T(`todo-${t.id}`);
    await page.waitForSelector(`${row} ${T('note-action-tel')}`, { timeout: 4000 });
    await waitForAnimationsDone(page, 4000);
    // 胶囊：tel: 只留数字；裸域名补 https；排在关联的小链接前面
    const acts = await page.$$eval(`${row} .lrow__links :is(.lact, .lchip)`, (els) => els.map((a) => [a.dataset.testid || 'link', a.textContent, a.getAttribute('href')]));
    assert.deepEqual(acts.slice(0, 2), [
      ['note-action-tel', '+84 123 456 789', 'tel:+84123456789'],
      ['note-action-url', 'example.vn/stay', 'https://example.vn/stay'],
    ]);
    // 备注文字原样、全文显示（不截断）
    const n = await page.$eval(`${row} .lrow__note`, (el) => ({ text: el.textContent, clamp: getComputedStyle(el).webkitLineClamp, sh: el.scrollHeight, ch: el.clientHeight }));
    assert.equal(n.text, note);
    assert.equal(n.clamp, 'none');
    assert.ok(n.sh <= n.ch + 1, `全文都显示：${n.sh} / ${n.ch}`);
    await page.$eval(row, (el) => el.scrollIntoView({ block: 'center' }));
    await screen(page, 'note-actions');
    await assertTapTargetsIn(page);
    // 点「打开网页」：开新标签页（这里接住 window.open），不打开编辑弹层
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return {}; }; });
    await page.click(`${row} ${T('note-action-url')}`);
    await sleep(400);
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://example.vn/stay']);
    assert.ok(!(await page.evaluate(() => location.hash)).includes('sheet=todo'), '点胶囊不打开编辑');
    // 点备注文字：照样打开编辑（文字不是链接）
    const box = await page.$eval(`${row} .lrow__note`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => location.hash.includes('sheet=todo'), { timeout: 4000 });
    // 弹层里备注下面也有同样的胶囊（从别的页面打开这个面板看详情时一样能直接打）
    await page.waitForSelector(`${T('todo-note-actions')} ${T('note-action-tel')}`, { timeout: 6000 });
    assert.deepEqual(await page.$$eval(`${T('todo-note-actions')} .lact`, (els) => els.map((a) => a.getAttribute('href'))), ['tel:+84123456789', 'https://example.vn/stay']);
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'note-actions-sheet');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet=todo'), { timeout: 6000 });
    await waitForAnimationsDone(page, 4000);
    // 勾完的：备注只留一行，没有「打电话」胶囊了——等这一行沉下去的时候才收（勾上那一下行高不变，交互评审 P1-3）
    await page.click(`${row} .check__input`);
    await page.waitForFunction((sel) => document.querySelector(sel)?.hasAttribute('data-done'), { timeout: 3000 }, row);
    assert.equal(await page.$eval(`${row} .lrow__note`, (el) => getComputedStyle(el).webkitLineClamp), 'none', '刚勾上：版式还按勾之前');
    await page.waitForFunction((sel) => document.querySelector(sel)?.hasAttribute('data-layout-done'), { timeout: 4000 }, row);
    assert.equal(await page.$eval(`${row} .lrow__note`, (el) => getComputedStyle(el).webkitLineClamp), '1');
    assert.equal(await page.$(`${row} ${T('note-action-tel')}`), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('时区：截止时间按那一刻人在哪写（出发前人在香港 → 香港钟点），行里一个「香港时间 / 越南时间」小标签，卡片头不再说；弹层里换算成这台设备的时间', async () => {
  const app = await openLists('#/t/demo-island/lists?list=confirm');
  const { page } = app;
  try {
    await page.emulateTimezone('Asia/Hong_Kong');
    await page.reload();
    await page.waitForSelector(`${PAGE} .lists__body`, { timeout: 10000 });
    await app.idle();
    // 10-14 现场走查 P1-1：以前按越南钟点写、卡片头说一次；现在每行按那一刻人在的时区写、自带标签（store.presenceZone）
    assert.equal(await page.$(T('lists-zone-note')), null, '卡片头不再说「截止时间按越南时间」');
    const tags = await page.$$eval('.lrow__zone', (els) => els.map((el) => el.textContent));
    assert.ok(tags.length >= 3 && tags.every((x) => /^(香港|越南)时间$/.test(x)), `行里的时区小标签：${tags.join(' | ')}`);
    assert.ok(tags.includes('香港时间'), '出发前到期的写香港时间');
    // 读屏的那一句带时区
    assert.ok(await page.$$eval('.lrow__due .visually-hidden', (els) => els.every((el) => /（(香港|越南)时间）/.test(el.textContent))));
    await screen(page, 'zone-hk');
    // 弹层：「按越南时间填（香港时间 …）」
    const t = byTitle('等南岬海景屋确认订单');
    await page.click(T(`todo-open-${t.id}`));
    await page.waitForSelector(T('todo-due-zone'), { timeout: 6000 });
    assert.match(await page.$eval(T('todo-due-zone'), (el) => el.textContent), /^按越南时间填（香港时间 .+）$/);
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'zone-hk-sheet');
    // 人在越南
    await page.emulateTimezone('Asia/Ho_Chi_Minh');
    await page.reload();
    await page.waitForSelector(T('todo-form'), { timeout: 10000 });
    assert.equal(await page.$(T('todo-due-zone')), null);
    assert.equal(await page.$(T('lists-zone-note')), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('搜索跳过来（?todo=）：切到那个清单、放开「隐藏已装好」、滚过去闪一下，网址里的 todo 用完就去掉', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing');
  const { page } = app;
  try {
    await page.click(T('pack-hide-done'));
    await page.waitForFunction(() => !document.querySelector('.lrow[data-done]'), { timeout: 4000 });
    await page.click('#lists-tab-todo');
    await page.waitForSelector(T('lists-panel-todo'));
    const target = byTitle('牙刷');
    // 不用 app.go：页面马上把网址里的 todo 去掉，等不到“网址等于这一条”
    await page.evaluate((h) => { location.hash = h; }, `#/t/demo-island/lists?list=packing&todo=${target.id}`);
    await page.waitForSelector(`${T(`todo-${target.id}`)}[data-focus]`, { timeout: 6000 });
    await page.waitForFunction(() => !location.hash.includes('todo='), { timeout: 4000 });
    await sleep(600);
    const r = await page.$eval(T(`todo-${target.id}`), (el) => el.getBoundingClientRect().toJSON());
    assert.ok(r.top > 0 && r.bottom < 844, `滚到了屏幕里：${r.top}`);
    await screen(page, 'search-focus');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('空行程：每个清单都有说明；打包「用常用清单开始」一键加进十几样', async () => {
  const app = await openLists('#/t/demo-empty/lists');
  const { page } = app;
  try {
    await page.waitForSelector(T('lists-empty'));
    assert.equal(await page.$eval(`${T('lists-tabs')} [aria-selected="true"]`, (el) => el.textContent.trim()), '待办');
    await screen(page, 'empty-todo');
    await page.click('#lists-tab-packing');
    await page.waitForSelector(T('pack-starter'));
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'empty-packing');
    await page.click(T('pack-starter'));
    await page.waitForSelector('[data-testid^="pack-group-"]', { timeout: 6000 });
    const n = await page.$$eval('.litem .lrow', (els) => els.length);
    assert.ok(n >= 10, `加了 ${n} 样`);
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

/**
 * 把演示后台里 Cathy 改成只读成员（先做一次改动，让演示后台把数据存进 IndexedDB），再以 Cathy 打开 hash。
 * 和预订页的只读测试同一个做法：走真实的权限（store.view.canEdit），不靠页面里的开关。
 */
async function reopenAsViewer(app, hash) {
  const { page } = app;
  const first = (await rowIds(page)).find((r) => !r.done);
  await page.click(`${T(`todo-${first.id}`)} .check__input`);
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
  await page.waitForSelector(`${PAGE} .lists__body`, { timeout: 10000 });
  await app.idle();
}

test('只读成员（演示后台里把 Cathy 改成只读）：说明、勾选框和步进器禁用、没有快速添加和左滑；点行能看详情（只读，关联能展开看）', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing');
  const { page } = app;
  try {
    await reopenAsViewer(app, '#/t/demo-island/lists?list=packing');
    await page.waitForSelector(T('lists-readonly'));
    assert.equal(await page.$$eval('.lrow .check__input', (els) => els.length > 0 && els.every((el) => el.disabled)), true);
    assert.equal(await page.$(T('lists-add-packing')), null);
    assert.equal(await page.$(T('pack-add')), null);
    assert.equal(await page.$('.k-swipe'), null);
    assert.equal(await page.$$eval('.lrow .stepper button', (els) => els.every((el) => el.disabled || el.getAttribute('aria-disabled') === 'true')), true, '步进器改不了');
    await screen(page, 'readonly');
    // 勾选框点了也不变
    const first = (await rowIds(page)).find((r) => !r.done);
    await page.click(`${T(`todo-${first.id}`)} .check__input`).catch(() => {});
    await sleep(200);
    assert.equal(await page.$eval(T(`todo-${first.id}`), (el) => el.hasAttribute('data-done')), false);
    // 待确认：也是只读
    await page.click('#lists-tab-confirm');
    await page.waitForSelector(T('lists-panel-confirm'));
    assert.equal(await page.$(T('lists-add-confirm')), null);
    const c = (await rowIds(page))[0];
    await page.click(T(`todo-open-${c.id}`));
    await page.waitForSelector(T('todo-readonly'), { timeout: 6000 });
    assert.equal(await page.$(T('todo-submit')), null);
    assert.equal(await page.$(T('todo-delete')), null);
    assert.equal(await page.$eval(T('todo-title'), (el) => el.matches(':disabled')), true);
    // 关联能展开看（看预订照常能点），只是改不了
    await page.click(`${T('todo-links')} .xcard__header`);
    await page.waitForFunction(() => document.querySelector('[data-testid="todo-links"]')?.hasAttribute('data-open'), { timeout: 3000 });
    assert.equal(await page.$eval(T('todo-booking'), (el) => el.disabled), true);
    await waitForAnimationsDone(page, 4000);
    await screen(page, 'readonly-sheet');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('加载中骨架（演示网络慢 1.5 秒）→ 交叉淡入；第一次打开就断网（没有缓存）→ 中文原因 + 重试', async () => {
  const slow = await openApp({ browser, server, hash: '#/t/demo-island/lists', now: NOW_UPCOMING, search: { demolatency: '1500' }, waitForApp: false });
  try {
    await slow.page.waitForSelector(`${PAGE} .reveal[data-loading]`, { timeout: 10000 });
    await slow.page.waitForFunction(() => !document.getElementById('boot'), { timeout: 10000 });
    await screen(slow.page, 'loading');
    await slow.page.waitForSelector(`${PAGE} .reveal:not([data-loading]) .lists__body`, { timeout: 15000 });
    slow.assertClean();
  } finally {
    await slow.close();
  }
  const off = await openApp({ browser, server, hash: '#/t/demo-island/lists', now: NOW_UPCOMING, search: { demonet: 'offline' }, waitForApp: false });
  try {
    await off.page.waitForSelector(T('lists-error'), { timeout: 30000 });
    assert.match(await off.page.$eval(T('lists-error'), (el) => el.textContent), /网络|重试/);
    await off.page.waitForFunction(() => !document.getElementById('boot'), { timeout: 10000 });
    await waitForAnimationsDone(off.page, 4000);
    await screen(off.page, 'error-offline');
    off.assertClean({ allowErrors: [/./] });
  } finally {
    await off.close();
  }
});

test('离线照常勾选、添加（进写队列）；同步条出现时贴顶的标签栏往下让开，不被挡住', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing');
  const { page } = app;
  try {
    await page.setOfflineMode(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const first = (await rowIds(page)).find((r) => !r.done);
    await page.click(`${T(`todo-${first.id}`)} .check__input`);
    await page.waitForFunction((id) => document.querySelector(`[data-testid="todo-${id}"]`)?.hasAttribute('data-done'), {}, first.id);
    await page.waitForSelector(`${T('sync-bar')}[data-state="offline"]`, { timeout: 6000 });
    await page.$eval(T('lists-add-packing-input'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('lists-add-packing-input'));
    await page.keyboard.type('离线加的防蚊手环');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.lrow__tt')].some((el) => el.textContent === '离线加的防蚊手环'), { timeout: 4000 });
    // 标签栏贴顶：在同步条下面
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForFunction(() => document.querySelector('.lists__bar')?.hasAttribute('data-stuck'), { timeout: 4000 });
    await app.idle();
    const bar = await page.$eval('.lists__bar', (el) => el.getBoundingClientRect().toJSON());
    const sync = await page.$eval(T('sync-bar'), (el) => el.getBoundingClientRect().toJSON());
    assert.ok(bar.top >= sync.bottom - 1, `标签栏 ${bar.top} 在同步条 ${sync.bottom} 下面`);
    await screen(page, 'offline-stuck');
    await page.setOfflineMode(false);
    app.assertClean({ allowErrors: [/ERR_INTERNET_DISCONNECTED|net::/] });
  } finally {
    await app.close();
  }
});

test('超长标题（60 个字）和备注：折行不撑破、和步进器不重叠；375 宽不横向滚动', async () => {
  const app = await openLists('#/t/demo-island/lists?list=packing', { device: 'small' });
  const { page } = app;
  try {
    const long = '超长的一项：给司机看的越南语地址卡片打印两份分别放在两个人的随身包和行李箱夹层里以防手机没电时还能拿出来给别人看';
    await page.$eval(T('lists-add-packing-input'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('lists-add-packing-input'));
    await page.keyboard.type(long);
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => [...document.querySelectorAll('.lrow__tt')].some((el) => el.textContent === t), { timeout: 4000 }, long);
    await waitForAnimationsDone(page, 4000);
    const ids = await page.$$eval('.lrow', (els) => els.filter((el) => el.querySelector('.lrow__tt')?.textContent.startsWith('超长的一项')).map((el) => el.dataset.testid));
    const sel = `[data-testid="${ids[0]}"]`;
    const t = await page.$eval(`${sel} .lrow__title`, (el) => el.getBoundingClientRect().toJSON());
    const q = await page.$eval(`${sel} .stepper`, (el) => el.getBoundingClientRect().toJSON());
    assert.ok(t.right <= q.left + 1, `标题 ${t.right} 不压到步进器 ${q.left}`);
    await assertNoHorizontalOverflow(page);
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    await screen(page, 'long-title-375');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程结束以后不催：没勾的截止时间平平地写、不标红，卡片头不提醒；进行中照常提醒', async () => {
  const ended = await openLists('#/t/demo-island/lists?list=confirm', { now: NOW_ENDED });
  try {
    const { page } = ended;
    assert.ok((await page.$$('.lrow__due')).length > 0, '截止时间照样写');
    assert.equal(await page.$('.lrow__due--danger, .lrow__due--warning'), null, '不标红');
    assert.equal(await page.$(T('lists-due-summary')), null, '卡片头不提醒');
    assert.equal(await page.$$eval('.lrow__duet', (els) => els.some((el) => el.textContent.includes('已过期'))), false);
    ended.assertClean();
  } finally {
    await ended.close();
  }
  const ongoing = await openLists('#/t/demo-island/lists?list=confirm', { now: NOW_ONGOING });
  try {
    assert.ok(await ongoing.page.$(T('lists-due-summary')), '进行中照常提醒');
    ongoing.assertClean();
  } finally {
    await ongoing.close();
  }
});

test('找不到行程：说清楚并能回到行程列表', async () => {
  const app = await openApp({ browser, server, hash: '#/t/no-such-trip/lists', now: NOW_UPCOMING });
  try {
    await app.page.waitForSelector(T('lists-missing'), { timeout: 10000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('深色、小屏 375、桌面 1280、减弱动态效果、行程中 / 结束后 / 三城：无报错、不横向滚动、触控区 ≥44', async () => {
  const cases = [
    { name: 'dark', colorScheme: 'dark', hash: '#/t/demo-island/lists?list=packing' },
    { name: 'dark-todo', colorScheme: 'dark', hash: '#/t/demo-island/lists?list=todo' },
    { name: 'small', device: 'small', hash: '#/t/demo-island/lists?list=packing' },
    { name: 'small-todo', device: 'small', hash: '#/t/demo-island/lists?list=todo' },
    { name: 'desktop', device: 'desktop', hash: '#/t/demo-island/lists?list=todo' },
    { name: 'reduced', reducedMotion: true, hash: '#/t/demo-island/lists?list=buy' },
    { name: 'ongoing', now: NOW_ONGOING, hash: '#/t/demo-island/lists' },
    { name: 'ended', now: NOW_ENDED, hash: '#/t/demo-island/lists' },
    { name: 'cities', hash: '#/t/demo-cities/lists' },
  ];
  for (const c of cases) {
    const { name, hash, ...o } = c;
    const app = await openLists(hash, o);
    try {
      await assertNoHorizontalOverflow(app.page);
      await assertTapTargetsIn(app.page);
      if (c.device === 'desktop') {
        const w = await app.page.$eval(PAGE, (el) => el.getBoundingClientRect().width);
        assert.ok(w <= 760, `桌面内容有最大宽度：${w}`);
      }
      await fullPageShots(app.page, path.join(PAGE_SHOTS, `${name}.png`));
      if (c.reducedMotion) {
        // 减弱动态效果：勾选照样能用
        const open = (await rowIds(app.page)).find((r) => !r.done);
        await app.page.click(`${T(`todo-${open.id}`)} .check__input`);
        await app.page.waitForFunction((id) => document.querySelector(`[data-testid="todo-${id}"]`)?.hasAttribute('data-done'), {}, open.id);
      }
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
