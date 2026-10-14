// 外壳 · 常驻框架（src/shell/）：光场、顶栏（大标题 / 胶囊 / 整条）、天数分段条、底栏、＋ 面板、更多菜单、行程切换、
// 搜索、同步状态条、换页、启动跳转。全部演示模式（虚构数据 demo-island / demo-cities / demo-empty），不连外网。
//
// 截图：<截图根目录>/__screenshots__/shell-frame/；半路截图：__shots__/shell-frame/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const SHOTS = shotsDir('shell-frame');
mkdirSync(SHOTS, { recursive: true });
const ONGOING = '2027-01-11T10:00:00+07:00';
const T = (id) => `[data-testid="${id}"]`;

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const open = (o = {}) => openApp({ browser, server, hash: '#/t/demo-island', ...o });

/** 等外壳的框架（按需加载的分包）和行程数据都到了：大标题有字 */
async function ready(app, title = '椰影岛') {
  await app.page.waitForFunction((t) => document.querySelector('[data-testid="shell-title"] .shell-head__name, .shell-head__title')?.textContent.includes(t), { timeout: 10000 }, title);
  await app.page.evaluate(() => document.fonts.ready);
  await app.idle();
}

const hash = (page) => page.evaluate(() => location.hash);
const historyLength = (page) => page.evaluate(() => history.length);

/** 同屏看得见的真玻璃（backdrop-filter）有几个 */
function countGlass(page) {
  return page.evaluate(() => {
    let n = 0;
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      const f = s.backdropFilter || s.webkitBackdropFilter;
      if (!f || f === 'none') continue;
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
      let p = el.parentElement;
      let hidden = false;
      while (p) {
        const ps = getComputedStyle(p);
        if (Number(ps.opacity) === 0 || ps.visibility === 'hidden') { hidden = true; break; }
        p = p.parentElement;
      }
      if (hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      n += 1;
      list.push(String(el.className).split(' ')[0]);
    }
    return { n, list };
  });
}

test('行程概览（手机 390 浅色）：大标题 = 行程名 + 箭头、副标题是日期、分段条「概览 · D1…D4」、底栏亮「行程」；不横向滚动、触控区 ≥44、同屏玻璃 ≤8', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(T('shell-title'), (el) => el.querySelector('.shell-head__name').textContent), '椰影岛');
    assert.match(await page.$eval('.shell-head__sub', (el) => el.textContent), /^冬日海岛 · 2027-01-10 周日 – 01-13 周三$/);
    const cells = await page.$$eval(`${T('day-strip')} .ds__cell`, (els) => els.map((e) => [e.querySelector('.ds__top').textContent, e.querySelector('.ds__big').textContent, e.getAttribute('aria-current')]));
    assert.deepEqual(cells.map((c) => c[1]), ['概览', 'D1', 'D2', 'D3', 'D4']);
    assert.equal(cells[0][0], '出发前');
    assert.equal(cells[0][2], 'page');
    assert.equal(await page.$eval(T('tab-trip'), (el) => el.getAttribute('aria-current')), 'page');
    assert.equal(await page.$eval(T('shell-topbar'), (el) => el.dataset.state), 'top');
    // 光场按这趟行程的主题色
    assert.notEqual(await page.$eval(T('shell-field'), (el) => el.dataset.palette), 'default');
    assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue('--trip-accent')), /^#0E8A8A$/i);
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    const glass = await countGlass(page);
    assert.ok(glass.n <= 8, `同屏真玻璃 ${glass.n} 个：${glass.list.join(', ')}`);
    await app.shot('trip', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('切 tab：账本 → 地图 → 行程，网址、指示块、大标题跟着走；行程外（行程列表）没有底栏，设置有返回', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    await page.click(T('tab-ledger'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await app.idle();
    assert.equal(await page.$eval(T('tab-ledger'), (el) => el.getAttribute('aria-current')), 'page');
    assert.equal(await page.$(T('day-strip')), null, '账本页没有天数分段条');
    assert.equal(await page.$eval(T('shell-title'), (el) => el.textContent.includes('椰影岛')), true);
    await page.click(T('tab-map'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island/map');
    await page.click(T('tab-trip'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island');
    await app.idle();
    assert.ok(await page.$(T('day-strip')));
    // 行程列表：底栏沉下去、右上是设置
    await app.go('#/trips');
    await page.waitForFunction(() => !document.querySelector('[data-testid="shell-tabbar"]')?.hasAttribute('data-shown'));
    assert.equal(await page.$eval('.shell-head__title', (el) => el.textContent), '全部行程');
    await page.click(T('shell-settings'));
    await page.waitForFunction(() => location.hash === '#/settings');
    await app.idle();
    assert.ok(await page.$(T('shell-back')), '设置页有返回');
    await page.click(T('shell-back'));
    await page.waitForFunction(() => location.hash === '#/trips');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('切天：点 D2 换到那天（replace，不压历史）、滑块和内容按方向滑（截半路）；进行中时概览写「进行中」、今天那格写「今天」', async () => {
  const app = await open({ now: ONGOING });
  try {
    await ready(app);
    const { page } = app;
    const cells = await page.$$eval(`${T('day-strip')} .ds__top`, (els) => els.map((e) => e.textContent));
    assert.deepEqual(cells, ['进行中', '10 周日', '今天', '12 周二', '13 周三']);
    const len = await historyLength(page);
    const cap = await captureAt(app, async () => {
      await page.click(T('day-strip-2027-01-11'));
      await page.waitForSelector('.shell-ghost');
    }, {
      // 以旧内容退场（最短的那段，fast）的一半为准：这一刻幽灵还在、新内容正从右边滑进来、滑块在半路
      selector: '.shell-ghost',
      progress: 0.5,
      evaluate: () => {
        const ghost = document.querySelector('.shell-ghost');
        const g = ghost ? getComputedStyle(ghost) : null;
        return {
          thumb: getComputedStyle(document.querySelector('.ds__thumb')).transform,
          ghosts: document.querySelectorAll('.shell-ghost').length,
          ghostOpacity: g ? Number(g.opacity) : null,
          ghostTransform: g ? g.transform : null,
        };
      },
    });
    try {
      await page.screenshot({ path: path.join(SHOTS, 'day-slide-mid.png') });
    } finally {
      await release(cap);
    }
    assert.ok(cap.state.ghosts >= 1, '旧内容的幽灵在退场');
    assert.ok(cap.state.ghostOpacity > 0 && cap.state.ghostOpacity < 1, `幽灵半透明（${cap.state.ghostOpacity}）`);
    // 往后一天：旧内容往左让（translateX 为负）
    const gm = /matrix\(([^)]+)\)/.exec(cap.state.ghostTransform || '');
    assert.ok(gm && Number(gm[1].split(',')[4]) < 0, `旧内容往左让：${cap.state.ghostTransform}`);
    const m = /matrix\(([^)]+)\)/.exec(cap.state.thumb);
    assert.ok(m, cap.state.thumb);
    await page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-11');
    await app.idle();
    assert.equal(await historyLength(page), len, '分段切换不压历史');
    assert.equal(await page.$eval(T('day-strip-2027-01-11'), (el) => el.getAttribute('aria-current')), 'page');
    assert.equal(await page.$$eval('.shell-ghost', (els) => els.length), 0, '播完幽灵删掉');
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('＋ 面板：从 ＋ 长出来（半路截图）、底栏浮在面板上面还能点；进行中「记一笔」最前最大；返回手势关面板；点「记一笔」换成记一笔面板', async () => {
  const app = await open({ now: ONGOING });
  try {
    await ready(app);
    const { page } = app;
    const cap = await captureAt(app, async () => {
      await page.click(T('shell-fab'));
      await page.waitForSelector('.ov-panel');
    }, { selector: '.ov-panel', progress: 0.3, evaluate: () => getComputedStyle(document.querySelector('.ov-panel')).clipPath });
    try {
      await page.screenshot({ path: path.join(SHOTS, 'fab-open-mid.png') });
    } finally {
      await release(cap);
    }
    assert.match(cap.state, /inset/);
    await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
    await app.idle();
    const order = await page.$$eval('.fab-tile', (els) => els.map((e) => [e.dataset.testid, e.hasAttribute('data-hero')]));
    assert.deepEqual(order.map((o) => o[0]), ['fab-expense', 'fab-photo', 'fab-journal', 'fab-item', 'fab-todo']);
    assert.equal(order[0][1], true);
    // 底栏浮在面板上面、不是 inert，加号变成 ×（aria-expanded）
    const bar = await page.$eval(T('shell-tabbar'), (el) => ({ lifted: el.hasAttribute('data-lifted'), inert: el.inert, z: Number(getComputedStyle(el).zIndex) }));
    const layerZ = await page.$eval('.ov-layer--panel', (el) => Number(getComputedStyle(el).zIndex));
    assert.equal(bar.lifted, true);
    assert.equal(bar.inert, false);
    assert.ok(bar.z > layerZ, `底栏 ${bar.z} 要在面板层 ${layerZ} 上面`);
    assert.equal(await page.$eval(T('shell-fab'), (el) => el.getAttribute('aria-expanded')), 'true');
    await app.shot('fab', { fullPage: false });
    // 返回手势（history.back）关面板
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet=') && !document.querySelector('.ov-layer--panel'));
    // 再开，点「记一笔」：面板收回、记一笔面板打开，历史里只留记一笔那一层
    await page.click(T('shell-fab'));
    await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
    await app.idle();
    await page.click(T('fab-expense'));
    await page.waitForFunction(() => /\?sheet=expense(:|$)/.test(location.hash), { timeout: 8000 });
    await app.idle();
    assert.equal(await page.$('.ov-layer--panel'), null, '＋ 面板收掉了');
    assert.match(await hash(page), /sheet=expense:d\.2027-01-11/, '进行中预填今天');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「更多」菜单：圆形扩散（半路截图）、瓷砖有实时状态、外观分段能切深色、点「预订」进二级页（左上返回、副标题是行程名、底栏亮「更多」），返回回到行程', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const cap = await captureAt(app, async () => {
      await page.click(T('tab-more'));
      await page.waitForSelector('.ov-fsmenu');
    }, { selector: '.ov-fsmenu', progress: 0.35, evaluate: () => getComputedStyle(document.querySelector('.ov-fsmenu')).clipPath });
    try {
      await page.screenshot({ path: path.join(SHOTS, 'menu-open-mid.png') });
    } finally {
      await release(cap);
    }
    assert.match(cap.state, /circle/);
    await page.waitForFunction(() => location.hash.endsWith('?sheet=menu'));
    await app.idle();
    const tiles = await page.$$eval('.more-tile', (els) => els.map((e) => [e.dataset.testid, e.querySelector('i').textContent]));
    assert.deepEqual(tiles.map((t) => t[0]), ['more-bookings', 'more-lists', 'more-journal', 'more-places', 'more-tips', 'more-contacts', 'more-trips', 'more-settings']);
    assert.match(tiles[0][1], /个待确认|个还没订|都已订好/);
    assert.match(tiles[1][1], /打包 \d+\/\d+/);
    assert.match(tiles[5][1], /位/);
    assert.equal(await page.$eval('.more-sign', (el) => el.textContent), '热爱生活7885 · Jeremy & Cathy');
    assert.equal(await page.$eval(T('tab-more'), (el) => el.getAttribute('aria-label')), '关闭菜单');
    await app.shot('menu', { fullPage: false });
    // 外观：深色
    await page.click('.more-theme__seg [role="radio"]:nth-of-type(3)');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.click('.more-theme__seg [role="radio"]:nth-of-type(1)');
    await page.waitForFunction(() => !document.documentElement.dataset.theme);
    // 进预订
    await page.click(T('more-bookings'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island/bookings');
    await app.idle();
    assert.equal(await page.$eval('.shell-head__title', (el) => el.textContent), '预订');
    assert.equal(await page.$eval('.shell-head__sub', (el) => el.textContent), '椰影岛 · 冬日海岛');
    assert.equal(await page.$eval(T('tab-more'), (el) => el.getAttribute('aria-current')), 'page');
    await page.click(T('shell-back'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island');
    await app.idle();
    assert.equal(await page.$('.ov-layer--menu'), null, '菜单没有再冒出来');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行程切换：从大标题长出来、三趟行程、当前打勾；换到三城留在同一种页面（账本 → 账本），光场和主题色跟着换；Esc 关', async () => {
  const app = await open({ hash: '#/t/demo-island/ledger' });
  try {
    await ready(app);
    const { page } = app;
    await page.click(T('shell-title'));
    await page.waitForFunction(() => location.hash.endsWith('?sheet=switcher'));
    await page.waitForSelector(T('switcher-panel'));
    await app.idle();
    const trips = await page.$$eval('.sw__trip', (els) => els.map((e) => [e.dataset.testid, e.getAttribute('aria-current'), e.querySelector('.sw__chip').textContent]));
    assert.equal(trips.length, 3);
    assert.deepEqual(trips.find((t) => t[1] === 'true')[0], 'switcher-trip-demo-island');
    assert.equal(trips.find((t) => t[0] === 'switcher-trip-demo-cities')[2], '已结束 · 回顾');
    await app.shot('switcher', { fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.idle();
    await page.click(T('shell-title'));
    await page.waitForSelector(T('switcher-trip-demo-cities'));
    await app.idle();
    await page.click(T('switcher-trip-demo-cities'));
    await page.waitForFunction(() => location.hash === '#/t/demo-cities/ledger');
    await ready(app, '三城');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--trip-accent').toUpperCase() === '#C2255C', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('.light-field__layer').length === 1, { timeout: 5000 });
    assert.match(await page.$eval(T('shell-field'), (el) => el.dataset.palette), /#C2255C/i);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('搜索：放大镜原位展开（半路截图）、空的时候给提示、输入「pho」出分组结果、↓ 选择、回车跳到地点并打开详情；最近搜索记下来、能清除；Esc 收起', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const cap = await captureAt(app, async () => {
      await page.click(`${T('shell-search')} .search-x__trigger`);
      await page.waitForFunction(() => document.querySelector('[data-testid="shell-search"]')?.dataset.state === 'open');
    }, { selector: '.search-x__field', progress: 0.4 });
    try {
      await page.screenshot({ path: path.join(SHOTS, 'search-open-mid.png') });
    } finally {
      await release(cap);
    }
    await page.waitForFunction(() => location.hash.endsWith('?sheet=search'));
    await page.waitForSelector(T('search-layer'));
    await app.idle();
    assert.ok(await page.$('.search-hint'));
    await page.keyboard.type('pho');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="search-layer"] mark')].length > 0);
    const groups = await page.$$eval('[data-testid="search-layer"] [data-group]', (els) => els.map((e) => e.dataset.group));
    assert.ok(groups.includes('places'), groups.join());
    await page.keyboard.press('ArrowDown');
    const input = `${T('shell-search')} input`;
    assert.equal(await page.$eval(input, (el) => el.getAttribute('aria-activedescendant')), 'shell-search-opt-0');
    assert.equal(await page.$eval(input, (el) => el.getAttribute('role')), 'combobox');
    await app.shot('search', { fullPage: false });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^#\/t\/demo-island\/places\?sheet=place:/.test(location.hash), { timeout: 8000 });
    await app.idle();
    // 地点详情是底部面板（模态）：先关掉它，再点顶栏的搜索
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.idle();
    // 最近搜索
    await page.click(`${T('shell-search')} .search-x__trigger`);
    await page.waitForSelector('.search-recent__chip');
    await page.waitForFunction(() => location.hash.endsWith('?sheet=search'));
    await app.idle();
    assert.equal(await page.$eval('.search-recent__chip', (el) => el.textContent), 'pho');
    await page.click(T('search-recent-clear'));
    await page.waitForSelector('.search-hint');
    // 清除是搜索的一部分：搜索不收起、光标还在搜索框里
    assert.ok((await hash(page)).endsWith('?sheet=search'), await hash(page));
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('search-x__input')), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet=search'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('顶栏：往下滚收成胶囊（半路截图形状在两者之间）、中途往上滑展开成整条、回到顶部恢复；4 倍降速滚动时帧间隔 p95 ≤ 16.7ms', async () => {
  const app = await open({ hash: '#/t/demo-island/day/2027-01-11' });
  try {
    await ready(app);
    const { page } = app;
    const state = () => page.$eval(T('shell-topbar'), (el) => el.dataset.state);
    const cap = await captureAt(app, () => page.evaluate(() => window.scrollTo(0, 400)), {
      selector: '.tb__glass',
      progress: 0.5,
      evaluate: () => ({ op: Number(getComputedStyle(document.querySelector('.tb__glass')).opacity) }),
    });
    try {
      await page.screenshot({ path: path.join(SHOTS, 'topbar-collapse-mid.png') });
    } finally {
      await release(cap);
    }
    assert.ok(cap.state.op > 0 && cap.state.op < 1, `胶囊浮出来半路透明度 ${cap.state.op}`);
    await app.idle();
    assert.equal(await state(), 'pill');
    // 中途往上滑：分几步（像手指一样），累计超过 28px
    for (const y of [390, 380, 370, 360]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.waitForFunction(() => document.querySelector('[data-testid="shell-topbar"]').dataset.state === 'bar');
    const mid = await captureAt(app, () => page.evaluate(() => window.scrollTo(0, 420)), {
      selector: '.tb__glass',
      progress: 0.4,
      evaluate: () => {
        const g = document.querySelector('.tb__glass').getBoundingClientRect();
        return { w: g.width };
      },
    });
    await release(mid);
    assert.ok(mid.state.w > 120 && mid.state.w < 358, `整条 → 胶囊半路宽度 ${mid.state.w}`);
    await app.idle();
    assert.equal(await state(), 'pill');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('[data-testid="shell-topbar"]').dataset.state === 'top');
    // 帧率（CPU 4 倍降速）：来回滚动，顶栏几次形变
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const fps = await page.evaluate(async () => {
      const d = [];
      let last = 0;
      let on = true;
      const tick = (t) => {
        if (!on) return;
        if (last) d.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y <= 600; y += 30) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await wait(500);
      for (let y = 600; y >= 450; y -= 15) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await wait(700);
      on = false;
      const s = [...d].sort((a, b) => a - b);
      return { n: d.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(`顶栏滚动 4x 降速：${fps.n} 帧，p95 ${fps.p95.toFixed(2)}ms，最长 ${fps.max.toFixed(2)}ms`);
    assert.ok(fps.p95 <= 16.7 + 0.5, `p95 ${fps.p95}ms`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('启动：打开网站（#/）→ 进行中的行程今天的 day 页（replace，不留历史）；出发前 → 最近那趟的概览；?go=ledger → 账本；都结束了 → 上次打开的行程', async () => {
  {
    const app = await open({ hash: '#/', now: ONGOING });
    try {
      await app.page.waitForFunction(() => location.hash === '#/t/demo-island/day/2027-01-11', { timeout: 10000 });
      // 新标签页先有 about:blank 一条，网站自己只有一条：启动页被 replace 掉了，没留历史
      assert.equal(await historyLength(app.page), 2, 'replace 离开启动页');
      app.assertClean();
    } finally {
      await app.close();
    }
  }
  {
    const app = await open({ hash: '#/', now: '2026-10-11T12:00:00+08:00' });
    try {
      await app.page.waitForFunction(() => location.hash === '#/t/demo-island', { timeout: 10000 });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
  {
    const app = await open({ hash: '#/?go=ledger', now: ONGOING });
    try {
      await app.page.waitForFunction(() => location.hash === '#/t/demo-island/ledger', { timeout: 10000 });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
  {
    // 2027-06：三趟都结束了。先打开过三城，再从主屏打开 → 回到三城
    const app = await open({ hash: '#/t/demo-cities', now: '2027-06-01T12:00:00+08:00' });
    try {
      await ready(app, '三城');
      await app.page.evaluate(() => { location.hash = '#/'; });
      await app.page.waitForFunction(() => location.hash === '#/t/demo-cities', { timeout: 10000 });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('启动画面：数据没到时是品牌画面（「热爱生活7885」），不是空白', async () => {
  const app = await open({ hash: '#/', search: { demolatency: '1500' }, waitForApp: false });
  try {
    const { page } = app;
    await page.waitForSelector(T('launch-page'), { timeout: 10000 });
    assert.equal(await page.$eval('.launch__name', (el) => el.textContent), '热爱生活7885');
    await page.waitForFunction(() => location.hash.startsWith('#/t/'), { timeout: 15000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('同步状态条：离线时在顶栏下方显示「离线 …」，大标题下面让出位置（不挡标题）', async () => {
  const app = await open({ search: { demonet: 'offline' } });
  try {
    const { page } = app;
    await page.waitForSelector(T('sync-bar'), { timeout: 10000 });
    await app.idle();
    const bar = await page.$eval(T('sync-bar'), (el) => ({ text: el.textContent, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
    assert.match(bar.text, /离线|网络/);
    const band = await page.$eval('.shell-head__band', (el) => el.getBoundingClientRect().bottom);
    assert.ok(bar.top >= band - 1, `状态条（${bar.top}）在大标题那一行（${band}）下面`);
    const sub = await page.$('.shell-head__sub');
    if (sub) {
      const subTop = await page.$eval('.shell-head__sub', (el) => el.firstChild ? el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop) : 0);
      assert.ok(subTop >= bar.bottom - 1, '副标题被挪到状态条下面');
    }
    await app.shot('offline', { fullPage: false });
    await assertTapTargets(page);
    app.assertClean({ allowErrors: [/网络|offline|Failed to fetch|ERR_INTERNET_DISCONNECTED/i] });
  } finally {
    await app.close();
  }
});

test('小屏 375 / 桌面 1280 / 深色 / 减弱动态效果：不横向滚动、触控区 ≥44；减弱动态效果时面板照常能开关', async () => {
  for (const o of [{ device: 'small' }, { device: 'desktop' }, { colorScheme: 'dark' }, { reducedMotion: true }]) {
    const app = await open({ ...o, now: ONGOING, hash: '#/t/demo-island/day/2027-01-11' });
    try {
      await ready(app);
      const { page } = app;
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      const name = o.device || (o.colorScheme ? 'dark' : 'reduced');
      await app.shot(`day-${name}`, { fullPage: false });
      if (o.reducedMotion) {
        await page.click(T('shell-fab'));
        await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
        await app.idle();
        assert.ok(await page.$('.fab-tile'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !location.hash.includes('sheet='));
      }
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
