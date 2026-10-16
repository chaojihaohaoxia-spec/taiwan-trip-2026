// kit/ 和 sheets/（#/dev/kit 和各页面占位）：展示页没有报错、不横向滚动、触控区 ≥44；给司机看能开能关（点空白、下拉、Esc、返回），
// 打开的半路没有闪；动作行的导航 / Grab 链接正确，Grab 没切走时有提示；点一下复制；左滑行（鼠标、触屏、键盘）；
// 行内添加；搜索（越南语去声调、键盘选择）；全站弹层（正式版）能从网址直接打开、返回能关；全部页面都能打开。
// 截图：<截图根目录>/__screenshots__/kit/，半路图：__shots__/kit/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { grabBookingUrl, addressForCopy, driverCardFields } from '../../src/lib/ride-links.js';
import { googleMapsNavigateUrl } from '../../src/lib/maps-links.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const HOTEL = island('places').find((p) => p.name === '椰影湾酒店');
const LONG = island('places').find((p) => (p.address || '').length > 100);
const PHRASE = island('tips').find((t) => t.kind === 'phrase' && t.local_text);
const SHOTS = shotsDir('kit');
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

/** 打开 #/dev/kit 并等演示数据到了（动作行、给司机看的入口都靠它） */
async function openKit(o = {}) {
  const app = await openApp({ browser, server, hash: '#/dev/kit', ...o });
  await app.page.waitForSelector(T('kit-driver-hotel'), { timeout: 10000 });
  await app.page.waitForFunction(() => location.hash.includes('trip=demo-island'));
  await app.idle();
  return app;
}

const hash = (page) => page.evaluate(() => location.hash);

/** 把输入框换成这段字（先全选再打字：手机模拟下三击不一定全选） */
async function retype(page, sel, text) {
  await page.$eval(sel, (el) => {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.select();
  });
  await page.keyboard.type(text);
}

/** 只检查某一块里的可点元素 ≥44px（页面占位：外壳的顶栏、底栏由外壳自己的测试管） */
async function assertTapTargetsIn(page, root, min = 44) {
  const small = await page.evaluate((rootSel, minSize) => {
    const out = [];
    const sel = 'a[href], button, [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea';
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
      if (w < minSize - 0.5 || h < minSize - 0.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}」${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  }, root, min);
  assert.deepEqual(small, [], `这些可点元素小于 ${min}px：\n${small.join('\n')}`);
}
const driverOpen = (page) => page.$(T('driver-card'));

async function waitDriverClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]') && !location.hash.includes('sheet=driver'), { timeout: 8000 });
}

async function openDriver(app, kase) {
  const sel = T(`kit-driver-${kase}`);
  await app.page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await app.page.click(sel);
  await app.page.waitForSelector(T('driver-card'));
  await waitForAnimationsDone(app.page, 6000);
}

for (const [label, o] of [['手机浅色', {}], ['手机深色', { colorScheme: 'dark' }], ['小屏 375', { device: 'small' }], ['桌面 1280', { device: 'desktop' }]]) {
  test(`#/dev/kit（${label}）：没有报错、不连外网、不横向滚动、可点的东西 ≥44px`, async () => {
    const app = await openKit(o);
    try {
      await assertNoHorizontalOverflow(app.page);
      await assertTapTargets(app.page);
      await app.shot(`kit-page${o.colorScheme === 'dark' ? '-dark' : ''}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('给司机看：从按钮长出来（第 0 帧和按钮一样大、整张卡透明、内容还没出来，没有一块白色闪一下）→ 全屏大字；名字 ≥32px、地址 ≥28px；白底黑字', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    // 预热：弹层模块按需下载好
    await openDriver(app, 'hotel');
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    await app.idle();

    const btn = await page.$eval(T('kit-driver-hotel'), (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const read = () => {
      const card = document.querySelector('.drv');
      const cs = getComputedStyle(card);
      const m = /inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px/.exec(cs.clipPath);
      const main = getComputedStyle(document.querySelector('.drv__main'));
      return { clip: cs.clipPath, w: m ? innerWidth - Number(m[2]) - Number(m[4]) : innerWidth, h: m ? innerHeight - Number(m[1]) - Number(m[3]) : innerHeight, content: Number(main.opacity), op: Number(cs.opacity) };
    };
    const at0 = await captureAt(app, () => page.click(T('kit-driver-hotel')), { selector: '.drv', progress: 0, evaluate: read });
    await page.screenshot({ path: path.join(SHOTS, 'driver-open-00.png'), captureBeyondViewport: false });
    await release(at0);
    assert.ok(Math.abs(at0.state.w - btn.w) < 3 && Math.abs(at0.state.h - btn.h) < 3, `第 0 帧和按钮一样大：${JSON.stringify(at0.state)} / ${JSON.stringify(btn)}`);
    assert.equal(at0.state.content, 0, '第 0 帧内容还没出来');
    assert.ok(at0.state.op < 0.05, '第 0 帧整张卡还是透明的：按钮原样看得见，不会先变成一块白');
    await waitForAnimationsDone(page, 6000);
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    await app.idle();

    const mid = await captureAt(app, () => page.click(T('kit-driver-hotel')), { selector: '.drv', progress: 0.3, evaluate: read });
    await page.screenshot({ path: path.join(SHOTS, 'driver-open-30.png'), captureBeyondViewport: false });
    await release(mid);
    assert.ok(mid.state.w > btn.w && mid.state.w <= 390 + 0.5, `半路比按钮大、不超过屏幕：${JSON.stringify(mid.state)}`);
    assert.ok(mid.state.op > 0.5, `半路已经浮现出来：${mid.state.op}`);
    await waitForAnimationsDone(page, 6000);
    await page.screenshot({ path: path.join(SHOTS, 'driver-open-end.png'), captureBeyondViewport: false });

    assert.match(await hash(page), new RegExp(`sheet=driver:${HOTEL.id}$`));
    const f = driverCardFields(HOTEL);
    const info = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        primary: document.querySelector('[data-testid="driver-primary"]').textContent,
        address: document.querySelector('[data-testid="driver-address"]').textContent,
        secondary: document.querySelector('[data-testid="driver-secondary"]')?.textContent,
        nameSize: parseFloat(cs('.drv__primary').fontSize),
        addrSize: parseFloat(cs('.drv__address').fontSize),
        bg: cs('.drv').backgroundColor,
        fg: cs('.drv').color,
        call: document.querySelector('[data-testid="driver-call"]')?.getAttribute('href'),
        clip: cs('.drv').clipPath,
      };
    });
    assert.equal(info.primary, f.primary);
    assert.equal(info.address, f.address);
    assert.equal(info.secondary, f.secondary);
    assert.ok(info.nameSize >= 32 && info.addrSize >= 28, JSON.stringify(info));
    assert.equal(info.bg, 'rgb(255, 255, 255)');
    assert.equal(info.fg, 'rgb(29, 28, 26)');
    assert.equal(info.call, 'tel:+0000000000001');
    assert.equal(info.clip, 'none', '长完以后不再裁切');
    await assertTapTargets(page);

    // 收回的半路：缩回按钮那边
    const back = await captureAt(app, () => page.mouse.click(195, 470), { selector: '.drv', progress: 0.5, evaluate: read });
    await page.screenshot({ path: path.join(SHOTS, 'driver-close-50.png'), captureBeyondViewport: false });
    await release(back);
    assert.ok(back.state.w < 390 && back.state.w > btn.w - 1, `收回半路：${JSON.stringify(back.state)}`);
    await waitDriverClosed(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('给司机看：点空白处、Esc、返回键、往下拉都能关；按钮上点不会关；关了以后网址回到原样、焦点回到按钮', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    const before = await hash(page);
    // 点空白处
    await openDriver(app, 'hotel');
    await page.mouse.click(200, 500);
    await waitDriverClosed(page);
    assert.equal(await hash(page), before);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'kit-driver-hotel', '焦点回到按钮');
    // 点复制按钮不关
    await openDriver(app, 'hotel');
    await page.click(T('driver-copy'));
    await sleep(300);
    assert.ok(await driverOpen(page), '点按钮不会关');
    // Esc
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    // 返回键
    await openDriver(app, 'phrase');
    assert.match(await page.$eval('.drv__badge', (el) => el.textContent), /给对方看/);
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), PHRASE.local_text);
    await page.goBack();
    await waitDriverClosed(page);
    assert.equal(await hash(page), before);
    // 往下拉：拉过 110px 松手就关（鼠标拖）
    await openDriver(app, 'hotel');
    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let y = 300; y <= 480; y += 20) {
      await page.mouse.move(200, y);
      await sleep(16);
    }
    const mid = await page.$eval('.drv', (el) => getComputedStyle(el).translate);
    assert.match(mid, /^0px 1\d\dpx$/, `跟着手指往下走：${mid}`);
    await page.mouse.up();
    await waitDriverClosed(page);
    // 拉得不够：弹回来，不关
    await openDriver(app, 'hotel');
    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let y = 300; y <= 360; y += 10) {
      await page.mouse.move(200, y);
      await sleep(40);
    }
    await sleep(200);
    await page.mouse.up();
    await waitForAnimationsDone(page, 6000);
    assert.ok(await driverOpen(page), '拉得不够不关');
    assert.equal(await page.$eval('.drv', (el) => getComputedStyle(el).translate), 'none', '弹回原位');
    // 关闭按钮
    await page.click(T('driver-close'));
    await waitDriverClosed(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('给司机看：超长越南语地址自动缩小（地址不小于 28px）；小屏放不下就能滚；横屏也能用；直接打开网址（刷新）也能显示、找不到的 id 说明原因', async () => {
  const app = await openKit({ device: 'small' });
  const { page } = app;
  try {
    await openDriver(app, 'long');
    const s = await page.evaluate(() => ({
      name: parseFloat(getComputedStyle(document.querySelector('.drv__primary')).fontSize),
      addr: parseFloat(getComputedStyle(document.querySelector('.drv__address')).fontSize),
      scrollable: document.querySelector('.drv').hasAttribute('data-scrollable'),
      fits: (() => { const m = document.querySelector('.drv__main'); return m.scrollHeight <= m.clientHeight + 1; })(),
    }));
    assert.ok(s.name < 72 && s.name >= 32, `长名字缩小了：${JSON.stringify(s)}`);
    assert.ok(s.addr >= 28);
    assert.ok(s.fits || s.scrollable, '要么放得下，要么能滚');
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'driver-long-375.png'), captureBeyondViewport: false });

    // 横屏：重新排字，放不下就能滚
    await page.setViewport({ width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
    await sleep(400);
    await waitForAnimationsDone(page, 6000);
    const land = await page.evaluate(() => {
      const m = document.querySelector('.drv__main');
      return { fits: m.scrollHeight <= m.clientHeight + 1, scrollable: document.querySelector('.drv').hasAttribute('data-scrollable'), overflowY: getComputedStyle(m).overflowY,
        addr: parseFloat(getComputedStyle(document.querySelector('.drv__address')).fontSize), bottom: document.querySelector('[data-testid="driver-copy"]').getBoundingClientRect().bottom };
    });
    assert.ok(land.fits || (land.scrollable && land.overflowY === 'auto'), JSON.stringify(land));
    assert.ok(land.addr >= 28);
    assert.ok(land.bottom <= 375, '按钮在屏幕里');
    await page.screenshot({ path: path.join(SHOTS, 'driver-long-landscape.png'), captureBeyondViewport: false });
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);

    // 直接打开网址（相当于刷新、分享链接）
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await app.go(`#/dev/kit?trip=demo-island&sheet=driver:${LONG.id}`);
    await page.waitForSelector(T('driver-primary'), { timeout: 8000 });
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), driverCardFields(LONG).primary);
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    // 找不到的 id
    await page.$eval(T('kit-driver-missing'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('kit-driver-missing'));
    await page.waitForSelector('.drv__empty');
    assert.equal(await page.$eval('.drv__empty', (el) => el.textContent), '找不到要显示的地点');
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('动作行：导航、Grab 的链接和 lib/ 生成的一致；点导航同一个窗口跳 Google 地图；点 Grab 先复制地址再跳，1.5 秒没切走就提示并给「打开 Grab」', async () => {
  const app = await openKit({ intercept: false });
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    // 外链：Google 地图、Grab 回 204（浏览器留在原页，相当于“跳过去了但没切走”），记下网址；其他外网一律拦掉
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

    const hrefs = await page.$$eval(`${T('kit-pa-hotel')} [data-action]`, (els) => Object.fromEntries(els.map((e) => [e.dataset.action, e.getAttribute('href')])));
    const nav = googleMapsNavigateUrl(HOTEL, { mode: 'driving' });
    assert.equal(hrefs.nav, nav);
    assert.equal(new URL(nav).searchParams.get('destination'), `${HOTEL.lat},${HOTEL.lng}`);
    assert.equal(new URL(nav).searchParams.get('travelmode'), 'driving');
    assert.equal(hrefs.grab, grabBookingUrl(HOTEL));
    assert.equal(hrefs.call, 'tel:+0000000000001');
    // 没坐标的：导航按名字 + 地址
    const noCoordsNav = await page.$eval(`${T('kit-pa-address-only')} [data-action="nav"]`, (el) => el.getAttribute('href'));
    assert.match(new URL(noCoordsNav).searchParams.get('destination'), /^Quán Nhỏ 9 Đường Hoa Sứ/);
    // 什么都没有：按钮禁用，说明原因
    const dis = await page.$$eval(`${T('kit-pa-nothing')} [data-action]`, (els) => els.map((e) => [e.dataset.action, e.disabled]));
    assert.ok(dis.every(([, d]) => d), JSON.stringify(dis));
    assert.match(await page.$eval(T('kit-pa-nothing-note'), (el) => el.textContent), /没有名字、地址和坐标/);

    // 点导航
    await page.$eval(T('kit-pa-hotel'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(`${T('kit-pa-hotel')} [data-action="nav"]`);
    await sleep(300);
    assert.equal(opened.at(-1), nav, '同一个窗口打开了 Google 地图导航');
    assert.match(await hash(page), /^#\/dev\/kit/, '还在原页（204）');

    // 点 Grab：剪贴板先有「当地语名 + 地址」，1.5 秒后提示
    await page.click(`${T('kit-pa-hotel')} [data-action="grab"]`);
    await sleep(300);
    assert.equal(opened.at(-1), grabBookingUrl(HOTEL));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), addressForCopy(HOTEL));
    const toast = await page.waitForFunction(() => [...document.querySelectorAll('[data-overlay-toasts] *')].map((e) => e.textContent).find((t) => /没打开 Grab/.test(t)), { timeout: 4000 });
    assert.match(await toast.jsonValue(), /没打开 Grab？地址已复制，可以在 Grab 里粘贴/);
    await page.screenshot({ path: path.join(SHOTS, 'grab-fallback-toast.png'), captureBeyondViewport: false });
    // 「打开 Grab」：只打开 App，不带目的地
    const action = await page.evaluateHandle(() => [...document.querySelectorAll('[data-overlay-toasts] button')].find((b) => b.textContent.includes('打开 Grab')));
    await action.asElement().click();
    await sleep(300);
    assert.equal(opened.at(-1), 'https://grab.onelink.me/2695613898');

    // 给司机看从动作行打开（从这个按钮长出来）
    await page.click(`${T('kit-pa-hotel')} [data-action="driver"]`);
    await page.waitForSelector(T('driver-card'));
    await waitForAnimationsDone(page, 6000);
    assert.match(await hash(page), new RegExp(`sheet=driver:${HOTEL.id}`));
    await page.keyboard.press('Escape');
    await waitDriverClosed(page);
    // 记一笔：预填地点和日期（记一笔面板是正式版：金额框、日期是那一天、住宿类地点自动选「住宿」）
    await page.click(`${T('kit-pa-hotel')} [data-action="expense"]`);
    await page.waitForSelector(`${T('sheet-expense')} ${T('xf-amount-input')}`, { timeout: 8000 });
    assert.match(await hash(page), new RegExp(`sheet=expense:p\\.${HOTEL.id}~d\\.2027-01-11`));
    assert.equal(await page.$eval(T('xf-date'), (el) => el.value), '2027-01-11');
    assert.equal(await page.$eval(T('xf-cat-住宿'), (el) => el.getAttribute('aria-pressed') || el.querySelector('[aria-pressed]')?.getAttribute('aria-pressed')), 'true');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));

    // 只有外链（Google 地图、Grab）出过站，没有别的外网请求
    const external = app.external.filter((u) => !/^https:\/\/(www\.google\.com\/maps|grab\.onelink\.me)\//.test(u));
    assert.deepEqual(external, []);
    app.external.length = 0;
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('点一下复制：订单号进剪贴板，提示「已复制订单号」，图标变成对勾', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.$eval(T('kit-copy-code'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('kit-copy-code'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-overlay-toasts] *')].some((e) => e.textContent === '已复制订单号'), { timeout: 4000 });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'DEMO-FL01');
    assert.equal(await page.$eval(`${T('kit-copy-code')} .glyph`, (el) => el.dataset.glyph), 'check');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('左滑行：鼠标往左拖露出按钮（跟手、松手弹到打开）、点内容只收回不触发；触屏一直拉到底直接删；键盘 Tab 到按钮自动滑开', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    const row = (id) => T(`kit-swipe-${id}`);
    await page.$eval(row('s1'), (el) => el.scrollIntoView({ block: 'center' }));
    const box = await page.$eval(row('s1'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const y = box.y + box.h / 2;
    // 鼠标拖 100px：半路跟手
    await page.mouse.move(box.x + box.w - 40, y);
    await page.mouse.down();
    for (let dx = 0; dx <= 100; dx += 10) {
      await page.mouse.move(box.x + box.w - 40 - dx, y);
      await sleep(16);
    }
    const midX = await page.$eval(`${row('s1')} .k-swipe__content`, (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    assert.ok(midX < -60 && midX > -140, `跟着手指：${midX}`);
    const sy = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: path.join(SHOTS, 'swipe-drag.png'), clip: { x: 0, y: sy + box.y - 10, width: 390, height: box.h + 20 }, captureBeyondViewport: false });
    await page.mouse.up();
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(row('s1'), (el) => el.hasAttribute('data-open')), true);
    const openX = await page.$eval(`${row('s1')} .k-swipe__content`, (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    assert.ok(Math.abs(openX + 152) < 1, `两个按钮的宽度：${openX}`);
    // 点内容：只收回，不算点了这一行
    await page.mouse.click(box.x + 60, y);
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(row('s1'), (el) => el.hasAttribute('data-open')), false);
    assert.equal(await page.$eval(T('kit-swipe-log'), (el) => el.textContent), '还没有操作');
    // 再拖开，点「完成」
    await page.mouse.move(box.x + box.w - 40, y);
    await page.mouse.down();
    for (let dx = 0; dx <= 120; dx += 20) {
      await page.mouse.move(box.x + box.w - 40 - dx, y);
      await sleep(16);
    }
    await page.mouse.up();
    await waitForAnimationsDone(page, 4000);
    await page.click(`${row('s1')} [data-key="done"]`);
    await page.waitForFunction(() => document.querySelector('[data-testid="kit-swipe-log"]').textContent === '「夜市烤海鲜」完成');

    // 触屏：一直拉到底（过整行的 55%）松手直接删
    await page.$eval(row('s2'), (el) => el.scrollIntoView({ block: 'center' }));
    const b2 = await page.$eval(row('s2'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
    await page.touchscreen.touchStart(b2.x + b2.w - 20, b2.y);
    for (let dx = 0; dx <= b2.w * 0.8; dx += 20) {
      await page.touchscreen.touchMove(b2.x + b2.w - 20 - dx, b2.y);
      await sleep(16);
    }
    assert.equal(await page.$eval(row('s2'), (el) => el.hasAttribute('data-armed')), true, '拉到底：删除按钮吃满整行');
    const sy2 = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: path.join(SHOTS, 'swipe-armed.png'), clip: { x: 0, y: sy2 + b2.y - 40, width: 390, height: 80 }, captureBeyondViewport: false });
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => !document.querySelector('[data-testid="kit-swipe-s2"]'), { timeout: 4000 });
    assert.equal(await page.$eval(T('kit-swipe-log'), (el) => el.textContent), '删除了「电动车租半天」');

    // 竖着滑是滚动页面，不会拉开
    const s3 = await page.$eval(row('s3'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.touchStart(s3.x, s3.y);
    for (let dy = 0; dy <= 60; dy += 10) await page.touchscreen.touchMove(s3.x - dy / 6, s3.y - dy);
    await page.touchscreen.touchEnd();
    assert.equal(await page.$eval(row('s3'), (el) => el.hasAttribute('data-open')), false);

    // 键盘：Tab 到第三行的「完成」，这一行自动滑开；读屏名字带上这一行是什么
    await page.focus(`${row('s3')} .k-row`);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => ({ label: document.activeElement.getAttribute('aria-label'), key: document.activeElement.dataset.key }));
    assert.deepEqual(focused, { label: '完成「椰子冰 × 2」', key: 'done' });
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(row('s3'), (el) => el.hasAttribute('data-open')), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '删除「椰子冰 × 2」');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-testid="kit-swipe-s3"]'), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('行内添加：回车连续加、焦点留着；输入法拼字时的回车不算；出错时字留着、下面说原因；一次粘贴几行加几条', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    const input = `${T('kit-add-input')}`;
    await page.$eval(input, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(input);
    await page.keyboard.type('拖鞋');
    await page.keyboard.press('Enter');
    await page.keyboard.type('帽子');
    await page.keyboard.press('Enter');
    const list = await page.$$eval(`${T('kit-add-list')} li`, (els) => els.map((e) => e.textContent));
    assert.deepEqual(list.slice(-2), ['拖鞋', '帽子']);
    assert.equal(await page.$eval(input, (el) => [el.value, document.activeElement === el].join('|')), '|true');
    // 输入法拼字时的回车
    await page.$eval(input, (el) => {
      el.value = 'pin';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    });
    await sleep(100);
    assert.equal(await page.$eval(input, (el) => el.value), 'pin', '拼字时回车不提交');
    // 出错
    await page.$eval(input, (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.keyboard.type('写错了');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${T('kit-add')} [role="alert"]`);
    assert.match(await page.$eval(`${T('kit-add')} [role="alert"]`, (el) => el.textContent), /加不上/);
    assert.equal(await page.$eval(input, (el) => el.value), '写错了');
    // 粘贴几行
    await page.$eval(input, (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const dt = new DataTransfer();
      dt.setData('text/plain', '雨伞\n  \n防蚊液\n充电宝');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="kit-add-list"] li')].map((e) => e.textContent).slice(-3).join() === '雨伞,防蚊液,充电宝');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('搜索：越南语不带声调也能搜到、关键字高亮；↓ 选择（aria-activedescendant）；点结果跳到对应页面并打开详情', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    const input = T('kit-search-input');
    await retype(page, input, 'pho');
    await page.waitForFunction(() => [...document.querySelectorAll('#kit-search-list mark')].some((m) => m.textContent.normalize('NFC') === 'phở'));
    const groups = await page.$$eval('#kit-search-list [data-group]', (els) => els.map((e) => e.dataset.group));
    assert.ok(groups.includes('places') && groups.includes('items'), groups.join());
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval(input, (el) => el.getAttribute('aria-activedescendant')), 'kit-search-opt-0');
    assert.equal(await page.$eval('#kit-search-opt-0', (el) => el.getAttribute('aria-selected')), 'true');
    await page.screenshot({ path: path.join(SHOTS, 'search-pho.png'), captureBeyondViewport: false });
    // 没结果
    await retype(page, input, 'zzqxw');
    await page.waitForSelector(`${T('kit-search-card')} [data-preset="search"]`);
    // 点地点结果：去地点页并打开地点详情
    await retype(page, input, 'ben tau');
    await page.waitForSelector('#kit-search-opt-0');
    await page.click('#kit-search-opt-0');
    await page.waitForFunction(() => /^#\/t\/demo-island\/places\?sheet=place:/.test(location.hash), { timeout: 8000 });
    await page.waitForSelector(T('sheet-place'), { timeout: 8000 });
    await page.waitForFunction(() => /椰影码头/.test(document.querySelector('[data-testid="sheet-place"] .ov-sheet__title')?.textContent || ''), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// 每个弹层正式版的根元素（页面阶段换掉了外壳阶段的占位 sheet-<id>-placeholder）
const SHEET_ROOT = {
  expense: 'sheet-expense', item: 'sheet-item', place: 'sheet-place', review: 'sheet-review', booking: 'sheet-booking', todo: 'sheet-todo',
  journal: 'journal-sheet', photo: 'photo-viewer', 'trip-new': 'sheet-trip-new', invite: 'sheet-invite',
};

test('全站弹层：每个 id 都能从开发页打开（正式版，带上预填的参数），返回键能关；直接打开带 ?sheet= 的网址也认得', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    for (const [id, root] of Object.entries(SHEET_ROOT)) {
      await page.$eval(T(`kit-sheet-${id}`), (el) => el.scrollIntoView({ block: 'center' }));
      await page.click(T(`kit-sheet-${id}`));
      await page.waitForSelector(T(root), { timeout: 8000 });
      await waitForAnimationsDone(page, 6000);
      assert.match(await hash(page), new RegExp(`sheet=${id}`));
      if (id === 'expense') {
        // 预填：分类餐饮、关联的条目；参数太长时丢日期（sheets/README 的优先级），日期从条目推（那一条所在的天）
        await page.waitForSelector(T('xf-amount-input'));
        const itemId = /sheet=expense:i\.([0-9a-f-]{36})/.exec(await hash(page))?.[1];
        const itemDay = island('days').find((d) => d.id === island('items').find((x) => x.id === itemId)?.day_id)?.date;
        assert.ok(itemDay, '参数里带着条目');
        assert.equal(await page.$eval(T('xf-date'), (el) => el.value), itemDay);
        assert.equal(await page.$eval(T('xf-cat-餐饮'), (el) => el.getAttribute('aria-pressed') || el.querySelector('[aria-pressed]')?.getAttribute('aria-pressed')), 'true');
        assert.match(await hash(page), /sheet=expense:i\./);
        await page.screenshot({ path: path.join(SHOTS, 'sheet-expense.png'), captureBeyondViewport: false });
      }
      await page.goBack();
      await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 6000 });
      await page.waitForFunction((tid) => !document.querySelector(`[data-testid="${tid}"]`), { timeout: 6000 }, root);
    }
    // 直接打开（刷新、分享链接）：弹层登记表启动时就在了，不会被当成不认识的 id 清掉
    await app.go('#/t/demo-island/ledger?sheet=expense:d.2027-01-12~c.food');
    await page.waitForSelector(`${T('sheet-expense')} ${T('xf-amount-input')}`, { timeout: 8000 });
    await sleep(1800);
    assert.ok(await page.$(T('sheet-expense')), '宽限期过了还在');
    assert.equal(await page.$eval(T('xf-date'), (el) => el.value), '2027-01-12');
    assert.equal(await page.$eval(T('xf-cat-餐饮'), (el) => el.getAttribute('aria-pressed') || el.querySelector('[aria-pressed]')?.getAttribute('aria-pressed')), 'true');
    await page.goBack();
    app.assertClean();
  } finally {
    await app.close();
  }
});

const PAGES = [
  ['trips', '#/trips', 'page-trips'], ['trip', '#/t/demo-island', 'page-trip'], ['day', '#/t/demo-island/day/2027-01-11', 'page-day'],
  ['map', '#/t/demo-island/map', 'page-map'], ['ledger', '#/t/demo-island/ledger', 'page-ledger'], ['bookings', '#/t/demo-island/bookings', 'page-bookings'],
  ['lists', '#/t/demo-island/lists', 'page-lists'], ['journal', '#/t/demo-island/journal', 'page-journal'], ['places', '#/t/demo-island/places', 'page-places'],
  ['tips', '#/t/demo-island/tips', 'page-tips'], ['contacts', '#/t/demo-island/contacts', 'page-contacts'], ['settings', '#/settings', 'page-settings'],
  ['join', '#/join/38S7-72Q9-FTCZ', 'page-join'], ['empty', '#/t/demo-empty', 'page-trip'], ['empty-ledger', '#/t/demo-empty/ledger', 'page-ledger'],
];

test('全部页面（正式版）：每一页都能打开、读到数据、没有报错、不横向滚动、可点的 ≥44px（手机 390）', async () => {
  const app = await openApp({ browser, server, hash: '#/trips', now: '2027-01-08T10:00:00+07:00' });
  const { page } = app;
  try {
    for (const [name, h, tid] of PAGES) {
      await app.go(h);
      await page.waitForSelector(T(tid), { timeout: 10000 });
      await page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"][aria-busy="true"], [data-testid="${t}"] [aria-busy="true"]`), { timeout: 10000 }, tid);
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, `[data-testid="${tid}"]`);
      await page.screenshot({ path: path.join(SHOTS, `page-${name}.png`) });
    }
    // 行程列表：三趟演示行程，点进概览
    await app.go('#/trips');
    await page.waitForSelector(T('trip-demo-island'));
    assert.equal((await page.$$('[data-testid^="trip-demo-"]')).length, 3);
    // 每天页带 ?item=：那一条原地展开，下面有它的动作行（叫 Grab）
    const it = island('items').find((x) => x.place_id && x.day_id && x.variant === 'primary');
    const day = island('days').find((d) => d.id === it.day_id);
    await app.go(`#/t/demo-island/day/${day.date}?item=${it.id}`);
    await page.waitForSelector(`${T(`item-${it.id}`)} .xcard__header[aria-expanded="true"]`, { timeout: 10000 });
    await page.waitForSelector(`${T(`item-actions-${it.id}`)} [data-action="grab"]`, { timeout: 10000 });
    // 旧版快捷方式 ?go=ledger：替换到当前行程的账本
    await page.evaluate(() => { location.hash = '#/trips?go=ledger'; });
    await page.waitForFunction(() => /^#\/t\/demo-island\/ledger/.test(location.hash), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('页面（深色、桌面 1280）：没有报错、不横向滚动、内容居中有最大宽度', async () => {
  for (const o of [{ colorScheme: 'dark' }, { device: 'desktop' }]) {
    const app = await openApp({ browser, server, hash: '#/t/demo-island/ledger', ...o });
    try {
      await app.page.waitForSelector(T('page-ledger'), { timeout: 10000 });
      await app.page.waitForFunction(() => !document.querySelector('[data-testid="page-ledger"] [aria-busy="true"]'), { timeout: 10000 });
      await app.idle();
      await assertNoHorizontalOverflow(app.page);
      if (o.device === 'desktop') {
        const box = await app.page.$eval(T('page-ledger'), (el) => el.getBoundingClientRect().toJSON());
        assert.ok(box.width <= 1100, `内容有最大宽度（${box.width}）`);
        assert.ok(Math.abs(box.left + box.width / 2 - 640) < 24, '居中');
      }
      await app.page.screenshot({ path: path.join(SHOTS, `page-ledger-${o.device || o.colorScheme}.png`) });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
