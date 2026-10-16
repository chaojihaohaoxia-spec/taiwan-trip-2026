// 行程列表（#/trips）、新建行程（?sheet=trip-new）、设置（#/settings，含旧版本机记录导入）、邀请成员（?sheet=invite）、
// 加入行程（#/join/:code）、登录页新视觉（#/login）——页面 agent「account」的 e2e。
// 演示数据（demo/demo-db.json，全部虚构）；旧版本机记录用现场编的样本（虚构）。
// 截图：<截图根目录>/__screenshots__/page-account/，半路图：__shots__/page-account/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir, SCREENSHOT_DIR, fullPageShots } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const userId = (email) => DB.users.find((u) => u.email === email).id;
const JEREMY = userId('jeremy@example.com');
const CATHY = userId('cathy@example.com');

const SHOTS = shotsDir('page-account');
const PAGE_SHOTS = path.join(SCREENSHOT_DIR, 'page-account');
const T = (id) => `[data-testid="${id}"]`;
const NOW_UPCOMING = '2027-01-08T09:00:00+07:00';
const NOW_ONGOING = '2027-01-11T10:00:00+07:00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 虚构的旧版本机记录（对着演示的「三城 · 春日环岛」编的：天、条目时间、待确认、地点名字都对得上） */
const LEGACY_STATE = {
  completedItems: { 'd3-2030': true, 'd2-1000': true, 'd9-9999': true },
  confirmStatus: { 'confirm-确认采茶集合时间': true, 'rem-d2-0': true },
  spotReviews: {
    'spot-南湾-灯笼老街': { rating: '顶级', notes: '晚上灯笼都亮了', foodLog: [{ text: '糖葫芦', photos: [] }], ratedAt: '2026-03-21T12:00:00Z' },
    'spot-雾港-旧城博物馆': { rating: '夯' },
    'spot-雾港-不存在的店': { rating: 'NPC' },
  },
  dayDiaries: { d3: { mood: 'great', text: '缆车上山看到云海。' } },
  dayNotes: { d4: '高铁很准时。' },
  packingList: { 电子: { 充电宝: true, 转换插头: false }, 其他: { 折叠伞: true } },
  personalLedger: [
    { id: 'pl-1', type: 'expense', amount: 120, currency: 'NTD', category: '餐饮', note: '夜市小吃', date: '2026-03-15', addedBy: 'jeremy@example.com', paidBy: 'me', forWhom: 'shared' },
    { id: 'pl-2', type: 'income', amount: 500, currency: 'HKD', category: '其他', note: '退款', date: '2026-03-16', addedBy: 'jeremy@example.com' },
    { id: 'pl-3', type: 'expense', amount: 88, currency: 'HKD', category: '购物', note: '超市', date: '2026-04-02', addedBy: 'cathy@example.com', paidBy: 'me', forWhom: 'me' },
  ],
};
/** 假的 AI 密钥（只看键名，值是编的、不像任何真实密钥的格式） */
const FAKE_KEY = 'demo-not-a-real-key';

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

const waitHash = (page, re, timeout = 8000) => page.waitForFunction((src) => new RegExp(src).test(location.hash), { timeout }, re.source);
const screen = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: false });
const full = (page, name) => fullPageShots(page, path.join(PAGE_SHOTS, `${name}.png`));

/** 页面内容里的可点元素 ≥44px（算上 ::after 扩出的热区；外壳的顶栏由外壳自己的测试管） */
async function assertTapTargetsIn(page, root, min = 44) {
  const small = await page.evaluate((rootSel, minSize) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], [role="radio"], input:not([type="hidden"]), select, textarea, label.check';
    for (const el of document.querySelectorAll(`${rootSel} :is(${sel})`)) {
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
      if (el.matches('input[type="checkbox"]')) continue;
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

async function openTrips(o = {}) {
  const app = await openApp({ browser, server, hash: '#/trips', now: NOW_UPCOMING, ...o });
  await app.page.waitForSelector(T('trips-list'), { timeout: 10000 });
  await app.idle();
  return app;
}

/** 在页面里写本机存储，然后刷新（旧版记录、待加入的邀请都是这么放进去的） */
async function seedStorage(app, values) {
  await app.page.evaluate((v) => { for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x); }, values);
  await app.page.reload({ waitUntil: 'load' });
  await app.ready();
}

// =====================================================================
// 行程列表
// =====================================================================

test('行程列表（出发前，390）：三趟按阶段排、卡片信息全、一句话总览、不横向滚动、触控区 ≥44；列表 → 网格 FLIP 半路图，刷新后还是网格', async () => {
  const app = await openTrips();
  const { page } = app;
  try {
    const cards = await page.$$eval('[data-testid^="trip-demo-"]', (els) => els.map((e) => ({ id: e.dataset.testid, phase: e.dataset.phase, text: e.textContent })));
    assert.deepEqual(cards.map((c) => c.id), ['trip-demo-island', 'trip-demo-empty', 'trip-demo-cities'], '接下来（近的在前）→ 回顾');
    assert.match(cards[0].text, /椰影岛 · 冬日海岛.*01-10 周日 – 01-13 周三.*2 天后出发.*4 天 3 晚/);
    assert.match(cards[2].text, /2026-03-14 周六 – 03-22 周日.*已结束 · 回顾.*9 天 8 晚/);
    assert.equal(await page.$eval(T('trips-summary'), (el) => el.textContent), '3 趟旅行 · 下一趟 2 天后出发');
    assert.equal(await page.$(T('trips-today')), null, '没有进行中的行程就没有「今天」入口');
    assert.match(await page.$eval(T('account-name'), (el) => el.textContent), /Jeremy/);
    // 封面照片（私有桶签名链接；演示里是本机图片）
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-demo-cities"] .tcard__photo')?.complete, { timeout: 8000 });
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await full(page, 'trips-list-390');

    // 列表 → 网格：底板、封面、文字各自 FLIP；半路时第一张卡的底板宽度介于两头之间
    const w0 = await page.$eval(`${T('trip-demo-island')} .tcard__bg`, (el) => el.getBoundingClientRect().width);
    const mid = await captureAt(app, () => page.click(T('trips-view')), {
      selector: '.tcard__bg',
      progress: 0.35,
      evaluate: () => {
        const r = document.querySelector('[data-testid="trip-demo-island"] .tcard__bg').getBoundingClientRect();
        return { w: r.width, inline: document.querySelector('[data-testid="trip-demo-island"] .tcard__bg').getAnimations().length };
      },
    });
    try {
      await screen(page, 'trips-view-flip-35');
      assert.ok(mid.state.inline > 0, '底板在 FLIP');
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 4000);
    const w1 = await page.$eval(`${T('trip-demo-island')} .tcard__bg`, (el) => el.getBoundingClientRect().width);
    assert.ok(w1 < w0 * 0.6, `网格两列：卡片变窄 ${w0} → ${w1}`);
    assert.ok(mid.state.w < w0 - 1 && mid.state.w > w1 + 1, `半路宽度 ${mid.state.w} 介于 ${w0} 和 ${w1} 之间`);
    const xs = await page.$$eval('[data-testid^="trip-demo-"]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert.equal(new Set(xs).size, 2, '网格两列');
    assert.equal(await page.$eval(T('trips-view'), (el) => el.getAttribute('aria-label')), '切换为列表');
    assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'finished' && a.effect?.target?.closest?.('.tcard')).length), 0, 'FLIP 播完不留东西');
    await assertNoHorizontalOverflow(page);
    await full(page, 'trips-grid-390');
    // 刷新：还是网格（本机记住）
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(`${T('trips-list')}[data-view="grid"]`, { timeout: 10000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程列表（行程中）：最上面「今天：椰影岛 · 第 2 天」一键到今天的安排；进行中的卡片有强调色边；点卡片进概览', async () => {
  const app = await openTrips({ now: NOW_ONGOING });
  const { page } = app;
  try {
    assert.match(await page.$eval(T('trips-today'), (el) => el.textContent), /今天：椰影岛 · 冬日海岛.*第 2 天 · 共 4 天/);
    assert.equal(await page.$eval(T('trip-demo-island'), (el) => el.dataset.phase), 'ongoing');
    assert.equal(await page.$eval(T('trips-summary'), (el) => el.textContent), '3 趟旅行 · 1 趟进行中');
    await screen(page, 'trips-ongoing');
    await page.click(T('trips-today'));
    await waitHash(page, /^#\/t\/demo-island\/day\/2027-01-11/);
    await page.goBack();
    await page.waitForSelector(T('trip-demo-cities'));
    await app.idle();
    await page.click(T('trip-demo-cities'));
    await waitHash(page, /^#\/t\/demo-cities$/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程列表：本机记着一个还没加入的邀请 →「还有一个邀请没加入」，点了去加入页', async () => {
  const app = await openTrips();
  const { page } = app;
  try {
    // 存的时间用应用里的“现在”（?now= 拨过的）：一小时前
    await seedStorage(app, { 'rs7885:join:pending': JSON.stringify({ code: '38S7-72Q9-FTCZ', savedAt: new Date(Date.parse(NOW_UPCOMING) - 3600_000).toISOString() }) });
    await page.waitForSelector(T('trips-invite'), { timeout: 10000 });
    assert.match(await page.$eval(T('trips-invite'), (el) => el.textContent), /还有一个邀请没加入.*38S7-72Q9-FTCZ/);
    await page.click(T('trips-invite'));
    await waitHash(page, /^#\/join\/38S7-72Q9-FTCZ$/);
    await page.waitForSelector(T('join-ready'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('不是创建者（Cathy）：设置里说明只有创建者能邀请；退出全部三趟 → 行程列表的空状态（新建 / 粘贴邀请码）；本机记着邀请 →「等你加入」', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW_UPCOMING, search: { demouser: 'cathy' } });
  const { page } = app;
  try {
    await page.waitForSelector(T('settings-leave-demo-island'), { timeout: 10000 });
    assert.match(await page.$eval(T('settings-members-demo-island'), (el) => el.textContent), /只有创建者可以邀请新成员/);
    assert.equal(await page.$(T('settings-invite-demo-island')), null, '不是创建者没有「邀请成员」');
    assert.equal(await page.$(`[data-testid^="settings-member-menu-"]`), null, '也不能改别人的权限');
    await screen(page, 'settings-not-owner');
    for (const id of ['demo-island', 'demo-cities', 'demo-empty']) {
      if (id !== 'demo-island') {
        await page.waitForSelector(T(`settings-trip-${id}`), { timeout: 8000 });
        await page.click(`${T(`settings-trip-${id}`)} .xcard__header`);
      }
      await page.waitForSelector(T(`settings-leave-${id}`), { timeout: 8000 });
      await page.$eval(T(`settings-leave-${id}`), (el) => el.scrollIntoView({ block: 'center' }));
      await app.idle();
      await page.click(T(`settings-leave-${id}`));
      await page.waitForSelector(T('dialog-confirm'));
      await page.click(T('dialog-confirm'));
      await page.waitForFunction((x) => !document.querySelector(`[data-testid="settings-trip-${x}"]`), { timeout: 8000 }, id);
    }
    await page.waitForSelector(T('settings-members-empty'), { timeout: 8000 });
    await app.go('#/trips');
    await page.waitForSelector(T('trips-empty'), { timeout: 10000 });
    await app.idle();
    assert.equal((await page.$$('[data-testid^="trip-demo-"]')).length, 0);
    assert.ok(await page.$(T('trips-new')));
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-trips'));
    await full(page, 'trips-empty-390');
    // 粘贴邀请码：认不出摇一下说原因；认得出去加入页
    await page.type(T('trips-join-input'), '12345');
    await page.click(T('trips-join-go'));
    await page.waitForFunction(() => /认不出这个邀请码/.test(document.querySelector('[data-testid="trips-join"]')?.textContent || ''));
    // 本机记着一个没加入的邀请 →「等你加入」
    await seedStorage(app, { 'rs7885:join:pending': JSON.stringify({ code: '38S7-72Q9-FTCZ', savedAt: new Date(Date.parse(NOW_UPCOMING) - 60_000).toISOString() }) });
    await page.waitForSelector(T('trips-invited'), { timeout: 10000 });
    assert.match(await page.$eval(T('trips-invited'), (el) => el.textContent), /等你加入.*38S7-72Q9-FTCZ/);
    await full(page, 'trips-invited-390');
    await page.click(T('trips-invite-forget'));
    await page.waitForSelector(T('trips-empty'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 新建行程
// =====================================================================

test('新建行程：空名字摇一下说原因（不转圈）→ 填名字、日期（默认 4 天 3 晚）、选日本（币种自动换日元）、深海蓝 → 转圈 → 对勾 → 进新行程；列表里有它', async () => {
  const app = await openTrips();
  const { page } = app;
  try {
    await page.click(T('trips-new'));
    await page.waitForSelector(T('trip-new-form'));
    await app.idle();
    // 名字自动聚焦
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'trip-new-title');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('sheet-trip-new'));
    await screen(page, 'trip-new-empty');
    // 空名字：不转圈，名字那一栏标红、说原因
    await page.click(T('trip-new-submit'));
    await page.waitForFunction(() => /给这趟旅行起个名字/.test(document.querySelector('#tnf-title-hint')?.textContent || ''));
    assert.notEqual(await page.$eval(T('trip-new-submit'), (el) => el.dataset.state), 'loading');
    assert.equal(await page.$eval('#tnf-title', (el) => el.getAttribute('aria-invalid')), 'true');

    await page.type(T('trip-new-title'), '大阪 · 樱花五日');
    await page.$eval(T('trip-new-start'), (el) => {
      el.value = '2027-03-28';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-new-end"]').value === '2027-03-31');
    assert.match(await page.$eval(T('trip-new-length'), (el) => el.textContent), /4 天 3 晚 · 79 天后出发/);
    await page.click(T('trip-new-zone-Tokyo'));
    await page.waitForFunction(() => /日本 · UTC\+9 · 比香港快 1 小时/.test(document.querySelector('[data-testid="trip-new-zone-summary"]').textContent));
    assert.equal(await page.$eval(T('trip-new-cur-JPY'), (el) => el.getAttribute('aria-pressed')), 'true', '时区换成日本，币种跟着变日元');
    // 搜时区
    await page.click(T('trip-new-zone-other'));
    await page.type(T('trip-new-zone-search'), '富国岛');
    await page.waitForSelector(`${T('trip-new-zone-results')} button`);
    assert.match(await page.$eval(`${T('trip-new-zone-results')} button`, (el) => el.textContent), /越南.*UTC\+7/);
    await page.click(T('trip-new-zone-Tokyo'));
    await page.click(T('trip-new-color-ocean'));
    assert.match(await page.$eval(T('trip-new-preview'), (el) => el.textContent), /大阪 · 樱花五日.*03-28.*4 天 3 晚/);
    await screen(page, 'trip-new-filled');

    await page.click(T('trip-new-submit'));
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-new-submit"]')?.dataset.state === 'loading', { timeout: 3000 });
    await screen(page, 'trip-new-loading');
    await page.waitForFunction(() => document.querySelector('[data-testid="trip-new-submit"]')?.dataset.state === 'success', { timeout: 6000 });
    await waitHash(page, /^#\/t\/trip-2027$/, 10000);
    await page.waitForFunction(() => /大阪/.test(document.querySelector('[data-testid="shell-head"]')?.textContent || ''), { timeout: 8000 });
    // 主题色是选的深海蓝
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--trip-accent').toUpperCase() === '#2F6FDE', { timeout: 6000 });
    // 返回：回到行程列表（弹层的历史已经清掉），新行程在「接下来」里
    await page.goBack();
    await page.waitForSelector(T('trip-trip-2027'), { timeout: 8000 });
    assert.equal(await page.evaluate(() => location.hash), '#/trips');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('超长行程名（含越南语声调）：卡片标题最多两行、不撑宽；375 不横向滚动；网格里最多三行', async () => {
  const app = await openTrips({ device: 'small' });
  const { page } = app;
  try {
    const long = 'Đảo Ngọc Phú Quốc · 重阳三晚和朋友一起去看日落吃海鲜还要坐全世界最长的跨海缆车去香岛';
    await page.click(T('trips-new'));
    await page.waitForSelector(T('trip-new-title'));
    await app.idle();
    await page.type(T('trip-new-title'), long);
    await page.click(T('trip-new-submit'));
    await waitHash(page, /^#\/t\/dao-ngoc-phu-quoc$/, 10000);
    await app.go('#/trips');
    const card = T('trip-dao-ngoc-phu-quoc');
    await page.waitForSelector(card, { timeout: 8000 });
    await app.idle();
    const m = await page.$eval(`${card} .tcard__title`, (el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight), sw: el.scrollWidth, cw: el.clientWidth }));
    assert.ok(m.h <= m.lh * 2 + 1, `最多两行：${m.h} / 行高 ${m.lh}`);
    assert.ok(m.sw <= m.cw + 1, '不撑宽');
    assert.match(await page.$eval(card, (el) => el.getAttribute('aria-label')), /Đảo Ngọc Phú Quốc/, '读屏读得到全名');
    await assertNoHorizontalOverflow(page);
    await full(page, 'trips-long-title-375');
    await page.click(T('trips-view'));
    await waitForAnimationsDone(page, 4000);
    const g = await page.$eval(`${card} .tcard__title`, (el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
    assert.ok(g.h <= g.lh * 3 + 1, `网格最多三行：${g.h}`);
    await assertNoHorizontalOverflow(page);
    await full(page, 'trips-long-title-grid-375');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 设置
// =====================================================================

test('设置（390）：账号、成员和邀请（当前行程默认展开，一次只开一张）、外观切深色、这台设备、关于（版本、检查更新、字体授权文件在）', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW_UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T('settings-members'), { timeout: 10000 });
    await app.idle();
    assert.match(await page.$eval(T('settings-account'), (el) => el.textContent), /Jeremy.*jeremy@example\.com/);
    // 默认展开第一趟（没打开过行程时）：两位成员，Jeremy 是创建者，Cathy 可编辑
    await page.waitForSelector(T('settings-members-demo-island'), { timeout: 8000 });
    const rows = await page.$$eval(`${T('settings-members-demo-island')} .set-member`, (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /Jeremy我.*创建者/);
    assert.match(rows[1], /Cathy.*可编辑/);
    assert.ok(await page.$(T('settings-invite-demo-island')));
    // 展开另一趟：前一张收起
    await page.click(`${T('settings-trip-demo-cities')} .xcard__header`);
    await page.waitForSelector(T('settings-members-demo-cities'), { timeout: 8000 });
    await app.idle();
    assert.equal(await page.$(T('settings-members-demo-island')).then((h) => h && h.evaluate((el) => !el.closest('[inert]'))), false, '一次只开一张');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-settings'));
    assert.equal(await page.$eval(T('settings-sync'), (el) => el.textContent.trim()), '已同步');
    assert.match(await page.$eval(T('settings-version'), (el) => el.textContent), /^2\.0\.0/);
    assert.equal(await page.$eval(T('settings-sign'), (el) => el.textContent), '热爱生活7885 · Jeremy & Cathy');
    // 字体授权文件随站部署：两个链接都能打开（Geist 已经去掉，不再随站）
    for (const f of ['Noto-Serif-SC-OFL.txt', 'Instrument-Serif-OFL.txt']) {
      const status = await page.evaluate(async (name) => (await fetch(new URL(`fonts/licenses/${name}`, document.baseURI))).status, f);
      assert.equal(status, 200, f);
    }
    const licenses = await page.$$eval('[data-testid^="settings-font-"]', (els) => els.map((el) => el.dataset.testid));
    assert.deepEqual(licenses, ['settings-font-noto', 'settings-font-instrument'], '关于里只列两套字体（没有 Geist）');
    // 检查更新：没有 SW（e2e 不注册）→ 说明刷新就是最新版
    await page.click(T('settings-check-update'));
    await page.waitForFunction(() => /刷新就是最新版/.test(document.body.textContent), { timeout: 4000 });
    await full(page, 'settings-390');
    // 外观：切深色（<html data-theme="dark">，刷新后还在）
    await page.click(`${T('settings-theme')} .seg__item:nth-of-type(3)`);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await app.idle();
    await full(page, 'settings-390-dark');
    await page.reload({ waitUntil: 'load' });
    await app.ready();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.click(`${T('settings-theme')} .seg__item:nth-of-type(1)`);
    await page.waitForFunction(() => !document.documentElement.dataset.theme);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('设置：创建者改成员权限（可编辑 → 只读）、邀请成员（生成 → 大号邀请码和链接 → 复制 → 已发出的列表 → 撤销）', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW_UPCOMING });
  const { page } = app;
  try {
    await page.waitForSelector(T(`settings-member-menu-${CATHY}`), { timeout: 10000 });
    await page.click(T(`settings-member-menu-${CATHY}`));
    await page.waitForSelector(T('member-role-viewer'));
    await screen(page, 'member-menu');
    await page.click(T('member-role-viewer'));
    await page.waitForFunction((id) => /只读/.test(document.querySelector(`[data-testid="settings-member-${id}"]`)?.textContent || ''), { timeout: 5000 }, CATHY);

    // 邀请：网址带 ?trip=，弹层从底部升起
    await page.click(T('settings-invite-demo-island'));
    await page.waitForSelector(T('invite-form'), { timeout: 8000 });
    assert.match(await page.evaluate(() => location.hash), /trip=demo-island.*sheet=invite|sheet=invite.*trip=demo-island/);
    await app.idle();
    await page.waitForFunction(() => /还没有发过邀请/.test(document.querySelector('[data-testid="invite-list"]')?.textContent || ''), { timeout: 6000 });
    await assertTapTargetsIn(page, T('sheet-invite'));
    await screen(page, 'invite-form');
    await page.click(`${T('invite-role')} .seg__item:nth-of-type(2)`);
    await page.click(`${T('invite-valid')} .seg__item:nth-of-type(1)`);
    await page.click(T('invite-generate'));
    await page.waitForSelector(T('invite-result'), { timeout: 8000 });
    const code = await page.$eval(T('invite-code'), (el) => el.textContent);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.match(await page.$eval(T('invite-link'), (el) => el.textContent), new RegExp(`#/join/${code}$`));
    assert.match(await page.$eval(T('invite-result'), (el) => el.textContent), /只读 · 1 天内有效（到 .*） · 能用 1 次/);
    await screen(page, 'invite-result');
    // 复制链接：按钮变「已复制链接」+ Toast
    const ctx = page.browserContext();
    await ctx.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
    await page.click(T('invite-copy'));
    await page.waitForFunction(() => /已复制链接/.test(document.querySelector('[data-testid="invite-copy"]')?.textContent || ''), { timeout: 4000 });
    // 已发出的列表：刚生成的一条（有效、只读、已用 0/1 次）
    await page.waitForSelector('[data-testid^="invite-row-"]', { timeout: 6000 });
    const row = await page.$eval('[data-testid^="invite-row-"]', (el) => ({ id: el.dataset.testid.slice(11), state: el.dataset.state, text: el.textContent }));
    assert.equal(row.state, 'active');
    assert.match(row.text, /有效.*只读 · 已用 0\/1 次/);
    await page.click(T(`invite-revoke-${row.id}`));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction((id) => document.querySelector(`[data-testid="invite-row-${id}"]`)?.dataset.state === 'revoked', { timeout: 6000 }, row.id);
    assert.ok(!(await page.$(T(`invite-revoke-${row.id}`))), '撤销以后没有「撤销」按钮');
    await screen(page, 'invite-revoked');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('加入行程：Jeremy 把 Cathy 移出「山雾镇」再发邀请 → Cathy 打开链接确认加入 → 看到行程名、邀请人、权限 → 进入行程；再打开同一个链接：本来就在行程里', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW_UPCOMING });
  const { page } = app;
  try {
    // 展开「山雾镇」，把 Cathy 移出
    await page.waitForSelector(T('settings-trip-demo-empty'), { timeout: 10000 });
    await page.click(`${T('settings-trip-demo-empty')} .xcard__header`);
    const menu = `${T('settings-members-demo-empty')} ${T(`settings-member-menu-${CATHY}`)}`;
    await page.waitForSelector(menu, { timeout: 8000 });
    await app.idle();
    await page.click(menu);
    await page.waitForSelector(T('member-remove'));
    await page.click(T('member-remove'));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="settings-members-demo-empty"] [data-testid="settings-member-${id}"]`), { timeout: 6000 }, CATHY);
    // 发一个可编辑的邀请（「已移出」的提示在屏幕底部：先把按钮滚到中间，别点到提示上）
    await page.$eval(T('settings-invite-demo-empty'), (el) => el.scrollIntoView({ block: 'center' }));
    await app.idle();
    await page.click(T('settings-invite-demo-empty'));
    await page.waitForSelector(T('invite-generate'), { timeout: 8000 });
    await app.idle();
    await page.click(T('invite-generate'));
    await page.waitForSelector(T('invite-code'), { timeout: 8000 });
    const code = await page.$eval(T('invite-code'), (el) => el.textContent);
    await sleep(300);

    // 换成 Cathy（演示后台的数据存在这台设备上，刷新后还在）打开邀请链接
    await page.goto(`${server.url}?demo=1&nosw=1&demouser=cathy&now=${encodeURIComponent(NOW_UPCOMING)}#/join/${code.toLowerCase()}`, { waitUntil: 'load' });
    await page.waitForSelector(T('join-ready'), { timeout: 10000 });
    assert.equal(await page.$eval(T('join-code'), (el) => el.textContent), code, '小写的码也认，显示成规范写法');
    assert.equal(await page.$eval(T('join-as'), (el) => el.textContent), 'cathy@example.com');
    // 加入前先看一眼邀请（peekInvite）：行程名、邀请人、加入后的权限
    await page.waitForSelector(T('join-peek'), { timeout: 8000 });
    assert.match(await page.$eval(T('join-peek'), (el) => el.textContent), /山雾镇 · 周末.*邀请人：Jeremy.*加入后可以一起编辑/);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await full(page, 'join-ready-390');
    await page.click(T('join-submit'));
    await page.waitForSelector(T('join-done'), { timeout: 10000 });
    assert.equal(await page.$eval(T('join-trip-title'), (el) => el.textContent), '山雾镇 · 周末');
    assert.match(await page.$eval(T('join-done'), (el) => el.textContent), /已加入/);
    assert.equal(await page.$eval(T('join-inviter'), (el) => el.textContent), '邀请人：Jeremy（创建者） · 你的权限：可编辑');
    await full(page, 'join-done-390');
    await page.click(T('join-open'));
    await waitHash(page, /^#\/t\/demo-empty$/);
    // 同一个链接再打开：码已经用完，但本来就是成员 → 直接告诉你
    await page.evaluate((c) => { location.hash = `#/join/${c}`; }, code);
    await page.waitForSelector(T('join-submit'), { timeout: 8000 });
    await page.click(T('join-submit'));
    await page.waitForSelector(T('join-done'), { timeout: 10000 });
    assert.match(await page.$eval(T('join-done'), (el) => el.textContent), /你本来就在这趟行程里/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('加入行程：邀请码无效（中文原因 + 可能的原因 + 换一个码）、链接里的码不完整、没登录（登录后加入，本机记下邀请码）', async () => {
  const app = await openApp({ browser, server, hash: '#/join/38S7-72Q9-FTCZ' });
  const { page } = app;
  try {
    // 加入前先看一眼邀请（data.rpc.peekInvite，整合时接上）：码无效时一打开就说清楚，不用先点「加入」
    await page.waitForSelector(T('join-error'), { timeout: 10000 });
    assert.equal(await page.$eval(T('join-error'), (el) => el.dataset.kind), 'invalid');
    assert.match(await page.$eval(T('join-error'), (el) => el.textContent), /这个邀请用不了.*过期.*用过.*撤销/);
    await full(page, 'join-invalid-390');
    // 换一个码：粘贴整条链接也认
    await page.type(T('join-retype-input'), 'https://example.com/#/join/abcd efgh jkmn');
    await page.click(T('join-retype-go'));
    await waitHash(page, /^#\/join\/ABCD-EFGH-JKMN$/);
    // 不完整的码
    await app.go('#/join/12ab');
    await page.waitForSelector(T('join-bad'), { timeout: 8000 });
    await page.type(T('join-retype-input'), 'nope');
    await page.click(T('join-retype-go'));
    await page.waitForFunction(() => /认不出这个邀请码/.test(document.querySelector('[data-testid="join-bad"]')?.textContent || ''));
    app.assertClean();
  } finally {
    await app.close();
  }
  // 没登录（非演示）：不发请求；「登录后加入」带着 next；本机记下邀请码
  const out = await openApp({ browser, server, demo: false, hash: '#/join/38S7-72Q9-FTCZ' });
  try {
    const { page } = out;
    await page.waitForSelector(T('join-signed-out'), { timeout: 10000 });
    assert.equal(await page.$eval(T('join-login'), (el) => el.getAttribute('href')), '#/login?next=%23%2Fjoin%2F38S7-72Q9-FTCZ');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rs7885:join:pending')));
    assert.equal(saved.code, '38S7-72Q9-FTCZ');
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await full(page, 'join-signed-out-390');
    await page.click(T('join-login'));
    await waitHash(page, /^#\/login\?next=/);
    await page.waitForSelector(T('login-joining'));
    out.assertClean();
  } finally {
    await out.close();
  }
});

// =====================================================================
// 旧版本机记录
// =====================================================================

test('旧版本机记录：明文 AI 密钥一键删除（不读值）；预览 → 确认 → 导入到台湾行程（演示里是三城）→ 数据真的进去了 → 清掉旧键', async () => {
  const app = await openApp({ browser, server, hash: '#/settings', now: NOW_UPCOMING });
  const { page } = app;
  try {
    await seedStorage(app, { taiwanTrip2026State: JSON.stringify(LEGACY_STATE), taiwanTrip_anthropicKey: FAKE_KEY });
    await page.waitForSelector(T('settings-legacy-key'), { timeout: 10000 });
    assert.ok(!(await page.$eval(T('page-settings'), (el, k) => el.textContent.includes(k), FAKE_KEY)), '密钥的值不显示');
    await full(page, 'legacy-cards-390');
    await page.click(T('settings-legacy-key-delete'));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="settings-legacy-key"]'), { timeout: 4000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('taiwanTrip_anthropicKey')), null);

    // 预览
    await page.click(T('settings-legacy-open'));
    await page.waitForSelector(T('legacy-sections'), { timeout: 10000 });
    await app.idle();
    assert.ok(await page.$(T('legacy-target-demo-cities')), '没有 taiwan2026：让人挑一趟，默认台北时区、已结束的三城');
    assert.equal(await page.$eval(T('legacy-target-demo-cities'), (el) => el.getAttribute('aria-pressed')), 'true');
    const summary = await page.$$eval('[data-testid^="legacy-section-"]', (els) => Object.fromEntries(els.map((e) => [e.dataset.testid.slice(15), e.querySelector('.check__desc')?.textContent])));
    assert.equal(summary.items, '1 个条目已经有了 · 2 个条目对不上');
    assert.equal(summary.confirm, '1 项已经有了 · 1 项对不上');
    assert.equal(summary.reviews, '导入 1 个地点 · 1 个地点已经有了 · 1 个地点对不上');
    assert.equal(summary.journal, '写进 2 天');
    assert.equal(summary.packing, '导入 2 件 · 1 件已经有了');
    assert.equal(summary.ledger, '导入 1 笔 · 行程日期以外还有 1 笔 · 1 笔对不上');
    await page.click(T('legacy-more-reviews'));
    await page.waitForFunction(() => /不存在的店.*没有同名/.test(document.querySelector('[data-testid="legacy-section-reviews"]')?.textContent || ''));
    await assertTapTargetsIn(page, T('sheet-legacy-import'));
    await screen(page, 'legacy-preview');
    assert.match(await page.$eval(T('legacy-import-submit'), (el) => el.textContent), /导入 6 条/);
    // 不导入打包
    await page.click(`${T('legacy-section-packing')} label.check`);
    await page.waitForFunction(() => /导入 4 条/.test(document.querySelector('[data-testid="legacy-import-submit"]').textContent));
    await page.click(`${T('legacy-section-packing')} label.check`);
    await page.click(T('legacy-import-submit'));
    await page.waitForSelector(T('dialog-confirm'));
    assert.match(await page.$eval(T('dialog'), (el) => el.textContent), /导入 6 条到「三城 · 春日环岛」/);
    await page.click(T('dialog-confirm'));
    await page.waitForSelector(T('legacy-result'), { timeout: 10000 });
    assert.match(await page.$eval(T('legacy-result'), (el) => el.textContent), /导入了 6 条.*评级 1 · 日记 2 · 打包 2 · 个人记账 1/);
    await page.waitForFunction(() => /已经同步到云端/.test(document.querySelector('[data-testid="legacy-sync"]')?.textContent || ''), { timeout: 8000 });
    await screen(page, 'legacy-result');
    await page.click(T('legacy-done'));
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await page.waitForSelector(T('settings-legacy-mark'));

    // 数据真的进去了：打包清单里多了「转换插头」「充电宝」
    await app.go('#/t/demo-cities/lists?list=packing');
    await page.waitForFunction(() => /转换插头/.test(document.querySelector('[data-testid="page-lists"]')?.textContent || '') && /充电宝/.test(document.querySelector('[data-testid="page-lists"]')?.textContent || ''), { timeout: 10000 });

    // 再预览一次：都「已经有了」（可以重复导入，不会重复记）
    await app.go('#/settings');
    await page.waitForSelector(T('settings-legacy-open'), { timeout: 8000 });
    await page.click(T('settings-legacy-open'));
    await page.waitForSelector(T('legacy-import-submit'), { timeout: 10000 });
    await page.waitForFunction(() => /没有要导入的/.test(document.querySelector('[data-testid="legacy-import-submit"]').textContent), { timeout: 8000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    // 清掉旧键
    await page.click(T('settings-legacy-clear'));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="settings-legacy"]'), { timeout: 4000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('taiwanTrip2026State')), null);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 登录
// =====================================================================

test('登录页新视觉：非演示 390 浅色 / 深色、1280；「忘了密码？」换到验证码带着邮箱；验证码登录成功后这台设备记住用验证码', async () => {
  for (const [device, colorScheme] of [['mobile', 'light'], ['mobile', 'dark'], ['desktop', 'light'], ['small', 'light']]) {
    const app = await openApp({ browser, server, demo: false, device, colorScheme, hash: '#/login' });
    try {
      const { page } = app;
      await page.waitForSelector(T('login-password-form'));
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      await full(page, `login-${device}-${colorScheme}`);
      if (device === 'mobile' && colorScheme === 'light') {
        await page.type(T('login-email'), 'someone@example.com');
        await page.click(T('login-to-code'));
        await page.waitForSelector(T('login-code-form'));
        assert.equal(await page.$eval(T('login-email'), (el) => el.value), 'someone@example.com');
        assert.equal(await page.$eval(`${T('login-mode')} [aria-checked="true"]`, (el) => el.textContent.trim()), '邮箱验证码');
      }
      app.assertClean();
    } finally {
      await app.close();
    }
  }
  // 演示：退出 → 验证码登录 → 再退出 → 登录页默认就是验证码
  const app = await openTrips();
  try {
    const { page } = app;
    await page.click(T('sign-out'));
    await page.waitForSelector(T('login-mode'));
    await page.click(`${T('login-mode')} .seg__item:nth-of-type(2)`);
    await page.type(T('login-email'), 'jeremy@example.com');
    await page.click(T('login-send-code'));
    await page.waitForSelector(T('login-code'), { timeout: 6000 });
    await screen(page, 'login-code-sent');
    await page.type(T('login-code'), '123456');
    await page.click(T('login-verify'));
    await waitHash(page, /^#\/trips$/);
    await page.waitForSelector(T('sign-out'), { timeout: 8000 });
    await page.click(T('sign-out'));
    await page.waitForSelector(T('login-code-form'), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 宽度 / 深色
// =====================================================================

test('行程列表、设置、新建行程、邀请、加入：375 / 1280 / 深色都不横向滚动、内容居中有最大宽度、可点的 ≥44', async () => {
  const pages = [
    ['trips', '#/trips', 'page-trips'],
    ['settings', '#/settings', 'page-settings'],
    ['trip-new', '#/trips?sheet=trip-new', 'sheet-trip-new'],
    ['invite', '#/settings?trip=demo-island&sheet=invite', 'sheet-invite'],
    ['join', '#/join/38S7-72Q9-FTCZ', 'page-join'],
  ];
  for (const o of [{ device: 'small' }, { device: 'desktop' }, { colorScheme: 'dark' }]) {
    const app = await openApp({ browser, server, hash: '#/trips', now: NOW_ONGOING, ...o });
    try {
      const { page } = app;
      for (const [name, h, tid] of pages) {
        await app.go(h);
        await page.waitForSelector(T(tid), { timeout: 10000 });
        await sleep(250);
        await app.idle();
        await assertNoHorizontalOverflow(page);
        await assertTapTargetsIn(page, T(tid));
        if (o.device === 'desktop' && tid.startsWith('page-')) {
          const box = await page.$eval(T(tid), (el) => el.getBoundingClientRect().toJSON());
          assert.ok(box.width <= 720 + 1, `${name}：内容最大宽度 720，实际 ${box.width}`);
        }
        await page.screenshot({ path: path.join(PAGE_SHOTS, `${name}-${o.device || o.colorScheme}.png`) });
        if (h.includes('sheet=')) {
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 4000 }).catch(() => {});
        }
      }
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
