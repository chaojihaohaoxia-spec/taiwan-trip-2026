// 贴士与常用语（pages/tips）、联系人（pages/contacts）：演示数据（椰影岛进行中第 2 天，另有三城、空行程）。
// 贴士：置顶卡在最上面、五组顺序、类型芯片（网址 ?kind=）、长的原地展开一次只开一张（半路图）、本页搜索（越南语去声调、高亮、?q=、
//   没找到）、常用语卡片网格（两列、场景芯片 ?scene= 的 FLIP 半路图）、复制原文（剪贴板里是原文）、「给对方看」从按钮长出来的
//   全屏大字（半路图、显示原文）、模板直接 WhatsApp（预填原文的 wa.me）、「相关」打开预订详情、全局搜索结果 ?tip= 进来展开并闪一下、
//   紧急类贴士去联系人页的紧急一组；
// 联系人：紧急在最上面、快捷圆钮（tel: / wa.me / zalo.me）、点 WhatsApp 同一个窗口打开、展开（号码点了复制、带字的大按钮、备注、关联）、
//   类别 / 「今天」芯片、按号码数字搜索、?contact= 进来展开、只读成员照样能用全部动作；
// 两页：375 / 1280 / 深色不横向滚动、触控区 ≥44、空行程、断网又没缓存的出错页、慢网先骨架。
// 截图：<截图根目录>/__screenshots__/page-tips/，半路图：__shots__/page-tips/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, SCREENSHOT_DIR, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const TIP = (title) => island('tips').find((t) => t.title === title);
const CONTACT = (name) => island('contacts').find((c) => c.name === name);
const TAXI = TIP('打车先确认计价');          // 置顶防坑，正文有列表（长的：原地展开）
const MONEY = TIP('汇率和付款');             // 实用信息，长的
const SCOOTER = TIP('骑电动车');             // 小贴士，列表（长的）
const NO_ICE = TIP('不要冰');                // 常用语 Không đá
const DINNER = TIP('订海边的位子');          // 模板：同一个预订的联系人有 WhatsApp
const EMERGENCY_TIP = TIP('紧急情况（演示）');
const DESK = CONTACT('椰影湾酒店前台');      // 电话 + WhatsApp + 邮箱，关联酒店预订和地点
const POLICE = CONTACT('报警（演示）');
const GRILL = CONTACT('落日烧烤屋');         // 只有 WhatsApp
const GUIDE = CONTACT('岛上向导 小林');       // 微信、LINE
const DURING = '2027-01-11T10:00:00+07:00';
const SHOTS = path.join(SCREENSHOT_DIR, 'page-tips');
const MID = shotsDir('page-tips');
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (page) => page.evaluate(() => location.hash);

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(MID, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** 打开贴士页（默认椰影岛进行中第 2 天），等内容出来 */
async function openTips(o = {}) {
  const { hash: h = '#/t/demo-island/tips', ...rest } = o;
  const app = await openApp({ browser, server, hash: h, now: DURING, ...rest });
  await app.page.waitForSelector(T('page-tips'), { timeout: 10000 });
  await app.page.waitForFunction(() => document.querySelector('.tp__stack') || document.querySelector('[data-testid="tips-empty"]'), { timeout: 10000 });
  await app.idle();
  return app;
}

async function openContacts(o = {}) {
  const { hash: h = '#/t/demo-island/contacts', ...rest } = o;
  const app = await openApp({ browser, server, hash: h, now: DURING, ...rest });
  await app.page.waitForSelector(T('page-contacts'), { timeout: 10000 });
  await app.page.waitForFunction(() => document.querySelector('.ct__stack') || document.querySelector('[data-testid="contacts-empty"]'), { timeout: 10000 });
  await app.idle();
  return app;
}

/** 只检查某一块里可点的东西（演示角标、底栏是外壳的） */
async function assertTapTargetsIn(page, root) {
  const small = await page.evaluate((sel) => {
    const out = [];
    const scope = document.querySelector(sel);
    if (!scope) return ['（找不到）'];
    for (const el of scope.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea')) {
      if (el.closest('[inert]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let w = r.width;
      let h = r.height;
      for (const pseudo of ['::after', '::before']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const n = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
        w = Math.max(w, r.width - n(ps.left) - n(ps.right));
        h = Math.max(h, r.height - n(ps.top) - n(ps.bottom));
      }
      if (w < 43.5 || h < 43.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}」${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  }, root);
  assert.deepEqual(small, [], `这些可点元素小于 44px：\n${small.join('\n')}`);
}

/** 外链（wa.me / zalo.me / mailto 之外）回 204：浏览器留在原页，记下打开过的网址；其他外网拦掉 */
async function catchExternal(app) {
  const opened = [];
  await app.page.setRequestInterception(true);
  app.page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(server.origin) || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
    if (/^https:\/\/(wa\.me|zalo\.me)\//.test(url)) {
      opened.push(url);
      return req.respond({ status: 204, body: '' });
    }
    return req.abort('blockedbyclient');
  });
  return opened;
}

const headerOf = (id) => `${T(`tip-${id}`)} > .xcard__heading > .xcard__header`;

/** 先滚到屏幕中间再点（puppeteer 自己滚只滚到边上，会被底栏盖住） */
async function tap(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.click(sel);
}

/** 只外链（wa.me / zalo.me）出过站，没有别的外网请求；然后清空，好让 assertClean 通过 */
function assertOnlyChatLinks(app) {
  const external = app.external.filter((u) => !/^https:\/\/(wa\.me|zalo\.me)\//.test(u));
  assert.deepEqual(external, []);
  app.external.length = 0;
}

/**
 * 把 Cathy 改成只读成员：演示后台只在有写入后才把数据存进 IndexedDB，所以先在 #/dev/data 记一笔（让它存一次），
 * 再改 trip_members 里 Cathy 的角色，最后以 Cathy 打开 hashTo。
 */
async function asCathyViewer(app, hashTo) {
  const { page } = app;
  await app.go('#/dev/data?trip=demo-island');
  await page.waitForSelector(T('exp-amount'), { timeout: 10000 });
  await page.type(T('exp-amount'), '88');
  await page.click(T('exp-add'));
  // 等这一笔发完、演示后台存完（之后不会再存一次把下面的改动盖掉）
  await page.waitForFunction(() => document.querySelector('[data-testid="sync-pill"]')?.dataset.state === 'synced', { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  const ok = await page.waitForFunction(async () => {
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
    if (!v) {
      db.close();
      return false;
    }
    v.tables.trip_members = v.tables.trip_members.map((m) => (m.trip_id === 'demo-island' && m.role === 'editor' ? { ...m, role: 'viewer' } : m));
    st.put(v, 'demo:server');
    await new Promise((r) => {
      tx.oncomplete = r;
    });
    db.close();
    return true;
  }, { timeout: 8000, polling: 200 });
  assert.ok(await ok.jsonValue(), '演示后台的数据已经存进 IndexedDB');
  const url = new URL(page.url());
  url.searchParams.set('demouser', 'cathy');
  url.hash = hashTo;
  await page.goto(url.href);
}

// =====================================================================
// 贴士
// =====================================================================

test('贴士页（行程中 390）：置顶提醒在最上面，其余按 防坑 → 小贴士 → 实用信息 → 消息模板 → 常用语 分组；芯片带数量；不横向滚动、触控区 ≥44', async () => {
  const app = await openTips();
  const { page } = app;
  try {
    const order = await page.$$eval('.tp__stack > section', (els) => els.map((e) => e.dataset.testid));
    // 批 A：最上面多了按目的地档案现算的「当地须知」
    assert.deepEqual(order, ['tips-local', 'tips-pinned', 'tips-group-warning', 'tips-group-tip', 'tips-group-info', 'tips-group-template', 'tips-group-phrase']);
    const pinned = await page.$$eval(`${T('tips-pinned')} [data-tip-id]`, (els) => els.map((e) => e.dataset.tipId));
    assert.deepEqual(pinned, island('tips').filter((t) => t.pinned).map((t) => t.id));
    const chips = await page.$$eval(`${T('tips-kinds')} .chip`, (els) => els.map((e) => [e.dataset.value, e.querySelector('.chip__count')?.textContent]));
    assert.deepEqual(chips[0], ['all', String(island('tips').length)]);
    assert.ok(chips.some(([v, n]) => v === 'phrase' && n === '9'), JSON.stringify(chips));
    assert.match(await page.$eval(T('tips-summary'), (el) => el.textContent), /29 条 · 置顶 2 条/);
    // 置顶是普通的一组（纸本：没有暖色底、没有图钉圆）
    const bg = await page.$eval(T('tips-pinned'), (el) => getComputedStyle(el).backgroundImage);
    assert.equal(bg, 'none');
    assert.equal(await page.$(`${T('tips-pinned')} .tp-pinned__icon`), null);
    // 「今天」：D2 的贴士带小标
    assert.ok(await page.$(`${T(`tip-${TIP('浮潜前一晚别喝太多').id}`)} ${T('tip-today')}`), '今天（D2）的贴士带「今天」');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-tips'));
    await app.shot('tips-390', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('长的贴士原地展开：一次只开一张，标题行不跑；半路高度在两端之间；正文是 Markdown（列表、加粗）', async () => {
  const app = await openTips({ hash: '#/t/demo-island/tips?kind=info' });
  const { page } = app;
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    const bodyH = () => document.querySelector('[data-tip-id="ID"] > .xcard__body'.replace('ID', window.__tipId)).getBoundingClientRect().height;
    await page.evaluate((id) => { window.__tipId = id; }, MONEY.id);
    const top0 = await page.$eval(headerOf(MONEY.id), (el) => el.getBoundingClientRect().top);
    const cap = await captureAt(app, () => page.click(headerOf(MONEY.id)), { selector: '.xcard__body', progress: 0.4, evaluate: bodyH });
    try {
      await page.screenshot({ path: path.join(MID, 'tip-expand-40.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    await waitForAnimationsDone(page, 6000);
    const open = await page.evaluate(bodyH);
    assert.ok(open > 60, `展开后有高度：${open}`);
    assert.ok(cap.state > 2 && cap.state < open - 2, `半路高度 ${cap.state} 在 0 和 ${open} 之间`);
    const top1 = await page.$eval(headerOf(MONEY.id), (el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top1 - top0) < 2, `标题行没跑：${top0} → ${top1}`);
    const md = await page.$eval(`${T(`tip-${MONEY.id}`)} .tp-md`, (el) => ({ li: el.querySelectorAll('li').length, strong: el.querySelectorAll('strong').length }));
    assert.ok(md.li >= 3 && md.strong >= 1, JSON.stringify(md));
    await page.screenshot({ path: path.join(SHOTS, 'tip-expanded.png'), captureBeyondViewport: false });
    // 开另一张：前一张收起
    const other = TIP('紧急情况（演示）');
    await tap(page, headerOf(other.id));
    await waitForAnimationsDone(page, 6000);
    const states = await page.$$eval(`${T('tips-group-info')} .xcard__header`, (els) => els.map((e) => e.getAttribute('aria-expanded')));
    assert.equal(states.filter((s) => s === 'true').length, 1, '一次只开一张');
    // 紧急类：去联系人页的紧急一组
    await tap(page, T('tip-to-contacts'));
    await page.waitForSelector(T('page-contacts'));
    assert.match(await hash(page), /\/contacts\?cat=emergency/);
    await page.waitForSelector(T('contacts-group-emergency'));
    assert.equal(await page.$$eval('.ct-group', (els) => els.length), 1, '只看紧急');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('类型芯片：点「常用语」只剩常用语（网址 ?kind=phrase），卡片网格两列；场景芯片筛「吃饭」（?scene=food），卡片 FLIP（半路图）', async () => {
  const app = await openTips();
  const { page } = app;
  try {
    await page.click(`${T('tips-kinds')} [data-value="phrase"]`);
    await page.waitForFunction(() => /[?&]kind=phrase/.test(location.hash));
    await page.waitForSelector(T('tips-phrases'));
    await app.idle();
    assert.deepEqual(await page.$$eval('.tp__stack > section', (els) => els.map((e) => e.dataset.testid)), ['tips-group-phrase']);
    const lefts = await page.$$eval('.tp-phrase:not([data-wide])', (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    assert.equal(lefts, 2, '手机上两列');
    // 大字原文、给对方看的按钮不被截断
    const card = await page.$eval(T(`tip-${NO_ICE.id}`), (el) => ({
      local: el.querySelector('.tp-phrase__local').textContent,
      size: parseFloat(getComputedStyle(el.querySelector('.tp-phrase__local')).fontSize),
      lang: el.querySelector('.tp-phrase__local').getAttribute('lang'),
      show: (() => { const s = el.querySelector('.tp-btn--show span'); return s.scrollWidth <= s.clientWidth + 1; })(),
    }));
    assert.equal(card.local, NO_ICE.local_text);
    assert.ok(card.size >= 22, `原文是最大的字：${card.size}`);
    assert.equal(card.lang, 'vi');
    assert.ok(card.show, '「给对方看」四个字完整显示');
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    const pos = () => {
      const el = document.querySelector('.tp-phrase[data-scene="food"]');
      return el ? el.getBoundingClientRect().top : null;
    };
    const before = await page.evaluate(pos);
    const cap = await captureAt(app, async () => {
      await page.click(`${T('tips-scenes')} [data-value="food"]`);
      await page.waitForFunction(() => /[?&]scene=food/.test(location.hash));
    }, { selector: '.tp-phrase', progress: 0.45, evaluate: pos });
    try {
      await page.screenshot({ path: path.join(MID, 'phrase-scene-45.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    await waitForAnimationsDone(page, 6000);
    const afterTop = await page.evaluate(pos);
    assert.ok(afterTop < before - 4, `吃饭的卡片往上挪了：${before} → ${afterTop}`);
    assert.ok(cap.state < before - 1 && cap.state > afterTop + 1, `半路位置 ${cap.state} 在 ${before} 和 ${afterTop} 之间`);
    const scenes = await page.$$eval('.tp-phrase', (els) => [...new Set(els.map((e) => e.dataset.scene))]);
    assert.deepEqual(scenes, ['food']);
    const inline = await page.$$eval('.tp-phrase', (els) => els.filter((e) => e.style.transform).length);
    assert.equal(inline, 0, 'FLIP 播完不留内联样式');
    await app.shot('phrases-food', { fullPage: false });
    // 场景点回「全部」：回到全部常用语
    await tap(page, `${T('tips-scenes')} [data-value="all"]`);
    await page.waitForFunction(() => !/scene=/.test(location.hash));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$$eval('.tp-phrase', (els) => els.length), island('tips').filter((t) => t.kind === 'phrase').length);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('本页搜索：越南语不带声调找到「不要冰」并高亮，网址带 ?q=；搜不到给空状态和「清除搜索」', async () => {
  const app = await openTips();
  const { page } = app;
  try {
    await page.click(T('tips-search'));
    await page.keyboard.type('khong da');
    await page.waitForFunction(() => /[?&]q=khong/.test(location.hash), { timeout: 4000 });
    await app.idle();
    const ids = await page.$$eval('[data-tip-id]', (els) => els.map((e) => e.dataset.tipId));
    assert.ok(ids.includes(NO_ICE.id), ids.join());
    assert.match(await page.$eval(`${T(`tip-${NO_ICE.id}`)} mark`, (el) => el.textContent), /Không|đá/);
    assert.match(await page.$eval(T('tips-summary'), (el) => el.textContent), /找到 \d+ 条/);
    // 芯片数量跟着搜索走
    assert.equal(await page.$eval(`${T('tips-kinds')} [data-value="all"] .chip__count`, (el) => el.textContent), String(ids.length));
    await app.shot('search', { fullPage: false });
    await page.click(`${T('tips-search')}`, { clickCount: 3 });
    await page.keyboard.type('没有这种东西');
    await page.waitForSelector(T('tips-none'), { timeout: 4000 });
    await page.click(`${T('tips-none')} button`);
    await page.waitForFunction(() => !/[?&]q=/.test(location.hash), { timeout: 4000 });
    assert.equal(await page.$eval(T('tips-search'), (el) => el.value), '');
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('复制原文：剪贴板里是当地语原文、按钮变「已复制」；「给对方看」从按钮长出来（半路图），全屏大字是原文，Esc 关掉回到原页', async () => {
  const app = await openTips({ hash: '#/t/demo-island/tips?kind=template' });
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    const copy = T(`tip-copy-${DINNER.id}`);
    await tap(page, copy);
    await sleep(300);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), DINNER.local_text);
    assert.match(await page.$eval(copy, (el) => el.textContent), /已复制/);
    const toast = await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__message')].map((e) => e.textContent).find((t) => /已复制原文/.test(t)), { timeout: 3000 });
    assert.ok(await toast.jsonValue());

    const show = T(`tip-show-${DINNER.id}`);
    // 先打开、关掉一次（弹层的代码按需下载：第一次点的时候还没到，动画要等它到了才开始）
    await tap(page, show);
    await page.waitForSelector(T('driver-card'));
    await waitForAnimationsDone(page, 6000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]') && !location.hash.includes('sheet=driver'), { timeout: 8000 });
    await app.idle();
    const btn = await page.$eval(show, (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    await app.idle();
    const read = () => {
      const card = document.querySelector('.drv');
      const cs = getComputedStyle(card);
      const m = /inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px/.exec(cs.clipPath);
      return { w: m ? innerWidth - Number(m[2]) - Number(m[4]) : innerWidth, op: Number(cs.opacity) };
    };
    const mid = await captureAt(app, () => page.click(show), { selector: '.drv', progress: 0.3, evaluate: read });
    try {
      await page.screenshot({ path: path.join(MID, 'show-local-30.png'), captureBeyondViewport: false });
    } finally {
      await release(mid);
    }
    assert.ok(mid.state.w > btn.w && mid.state.w <= 390.5, `半路比按钮大、不超过屏幕：${JSON.stringify(mid.state)} / ${btn.w}`);
    await waitForAnimationsDone(page, 6000);
    assert.match(await hash(page), new RegExp(`sheet=driver:${DINNER.id}`));
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), DINNER.local_text);
    assert.equal(await page.$eval(T('driver-secondary'), (el) => el.textContent), DINNER.title);
    await page.screenshot({ path: path.join(SHOTS, 'show-local.png'), captureBeyondViewport: false });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]') && !location.hash.includes('sheet=driver'), { timeout: 8000 });
    assert.match(await hash(page), /\/tips\?kind=template$/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('消息模板：直接 WhatsApp 发给关联预订的联系人（wa.me 预填原文，同一个窗口打开）；「相关」打开预订详情', async () => {
  const app = await openTips({ hash: '#/t/demo-island/tips?kind=template', intercept: false });
  const { page } = app;
  try {
    const opened = await catchExternal(app);
    const send = `${T(`tip-send-${DINNER.id}`)} [data-send="whatsapp"]`;
    const href = await page.$eval(send, (el) => el.getAttribute('href'));
    const url = new URL(href);
    assert.equal(url.host, 'wa.me');
    assert.equal(url.searchParams.get('text'), DINNER.local_text);
    assert.match(await page.$eval(send, (el) => el.textContent), /发给 落日烧烤屋/);
    await tap(page, send);
    await sleep(400);
    assert.equal(opened.at(-1), url.href, '同一个窗口打开 WhatsApp');
    assert.match(await hash(page), /\/tips/, '还在原页（204）');
    // 「相关」：预订
    await tap(page, `${T(`tip-${DINNER.id}`)} [data-related="booking"]`);
    await page.waitForFunction((id) => location.hash.includes(`sheet=booking:${id}`), {}, DINNER.booking_id);
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    assertOnlyChatLinks(app);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('全局搜索的结果 ?tip=<id> 进来：那一条展开、滚到屏幕里、闪一下；被筛选藏起来时清掉筛选', async () => {
  const app = await openTips({ hash: `#/t/demo-island/tips?kind=phrase&tip=${SCOOTER.id}` });
  const { page } = app;
  try {
    await page.waitForFunction(() => !/kind=phrase/.test(location.hash), { timeout: 4000 });
    await page.waitForSelector(`${T(`tip-${SCOOTER.id}`)}[data-open]`, { timeout: 4000 });
    await sleep(900);
    const r = await page.$eval(T(`tip-${SCOOTER.id}`), (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, flash: el.hasAttribute('data-pg-flash') }; });
    assert.ok(r.top >= 0 && r.top < 844 * 0.8, `在屏幕里：${JSON.stringify(r)}`);
    assert.ok(r.flash, '闪一下');
    await page.screenshot({ path: path.join(SHOTS, 'focus-tip.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 联系人
// =====================================================================

test('联系人页（行程中 390）：紧急在最上面；收起时名字、身份 · 关联、等宽号码、备注一行；快捷圆钮是真链接（tel: / wa.me）且读屏有名字', async () => {
  const app = await openContacts();
  const { page } = app;
  try {
    const groups = await page.$$eval('.ct-group', (els) => els.map((e) => e.dataset.cat));
    assert.equal(groups[0], 'emergency');
    assert.deepEqual(await page.$$eval(`${T('contacts-group-emergency')} [data-contact-id]`, (els) => els.length), island('contacts').filter((c) => c.category === 'emergency').length);
    const desk = await page.$eval(T(`contact-${DESK.id}`), (el) => ({
      name: el.querySelector('.ct-x__name').textContent,
      sub: el.querySelector('.ct-sub__line')?.textContent,
      num: el.querySelector('[data-testid="contact-number"]').textContent,
      font: getComputedStyle(el.querySelector('[data-testid="contact-number"]')).fontFamily,
      nums: getComputedStyle(el.querySelector('[data-testid="contact-number"]')).fontVariantNumeric,
      quick: [...el.querySelectorAll('.ct-quick a')].map((a) => [a.dataset.contactAction, a.getAttribute('href'), a.getAttribute('aria-label')]),
      today: Boolean(el.querySelector('[data-testid="contact-today"]')),
    }));
    assert.equal(desk.name, DESK.name);
    assert.match(desk.sub, /前台 · /);
    assert.equal(desk.num, DESK.phone);
    // 号码用系统字体的等宽数字（tabular-nums），不用系统等宽粗体（视觉评审 P2-18）；Geist 已经去掉
    assert.doesNotMatch(desk.font, /Geist|monospace/, '号码用系统字体，不用 Geist、不用等宽字体');
    assert.match(desk.nums, /tabular-nums/, '号码等宽数字');
    assert.deepEqual(desk.quick.map((q) => q[0]), ['call', 'whatsapp']);
    assert.equal(desk.quick[0][1], `tel:${DESK.phone.startsWith('+') ? '+' : ''}${DESK.phone.replace(/\D/g, '')}`);
    assert.equal(desk.quick[1][1], `https://wa.me/${DESK.whatsapp.replace(/\D/g, '')}`);
    assert.equal(desk.quick[0][2], `打电话给${DESK.name}`);
    assert.ok(desk.today, '今天住的酒店：带「今天」');
    // 紧急的打电话有自己的类（纸本：外观和别的组一样是细线框，只有组标题是砖红）
    const police = await page.$eval(`${T(`contact-quick-${POLICE.id}`)} a`, (el) => ({ cls: el.className, bg: getComputedStyle(el).backgroundColor }));
    assert.match(police.cls, /ct-qbtn--danger/);
    // 名字没有被快捷圆钮压住
    const overlap = await page.$$eval('.ct-card', (cards) => cards.filter((c) => {
      const q = c.querySelector('.ct-quick');
      const n = c.querySelector('.ct-x__name');
      if (!q || !n) return false;
      const a = q.getBoundingClientRect();
      return [...n.getClientRects()].some((b) => b.right > a.left + 1 && b.left < a.right && b.bottom > a.top && b.top < a.bottom);
    }).map((c) => c.dataset.contactId));
    assert.deepEqual(overlap, [], '名字绕开右上角的圆钮');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, T('page-contacts'));
    await app.shot('contacts-390', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('联系人展开：号码点了复制、带字的大按钮（打电话 / WhatsApp / 邮件）、邮箱、备注、关联的预订和地点；一次只开一张（半路图）', async () => {
  const app = await openContacts({ hash: '#/t/demo-island/contacts?cat=hotel' });
  const { page } = app;
  try {
    await app.context.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.idle();
    const header = `${T(`contact-${DESK.id}`)} .xcard__header`;
    const height = (id) => document.querySelector(`[data-contact-id="${id}"] .xcard__body`).getBoundingClientRect().height;
    const cap = await captureAt(app, () => page.click(header), { selector: '.xcard__body', progress: 0.4, evaluate: `(${height})(${JSON.stringify(DESK.id)})` });
    try {
      await page.screenshot({ path: path.join(MID, 'contact-expand-40.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    await waitForAnimationsDone(page, 6000);
    const open = await page.evaluate(height, DESK.id);
    assert.ok(cap.state > 2 && cap.state < open - 2, `半路高度 ${cap.state} 在 0 和 ${open} 之间`);
    const body = await page.$eval(T(`contact-body-${DESK.id}`), (el) => ({
      acts: [...el.querySelectorAll('.ct-act')].map((a) => [a.dataset.contactAction, a.textContent.trim(), a.getAttribute('href')]),
      nums: [...el.querySelectorAll('.ct-num')].map((n) => n.textContent),
      note: el.querySelector('.ct-note')?.textContent,
      links: [...el.querySelectorAll('[data-related]')].map((l) => l.dataset.related),
    }));
    assert.deepEqual(body.acts.map((a) => a[1]), ['打电话', 'WhatsApp', '邮件']);
    assert.equal(body.acts[2][2], `mailto:${DESK.email}`);
    assert.ok(body.nums[0].includes('电话 · WhatsApp'), body.nums.join('|'));
    assert.equal(body.note, DESK.note);
    assert.deepEqual(body.links, ['booking', 'place']);
    // 号码点了复制
    await tap(page, `${T(`contact-body-${DESK.id}`)} ${T('contact-copy-phone')}`);
    await sleep(300);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), DESK.phone);
    await page.screenshot({ path: path.join(SHOTS, 'contact-expanded.png'), captureBeyondViewport: false });
    // 开另一张：前一张收起
    const other = island('contacts').find((c) => c.category === 'hotel' && c.id !== DESK.id);
    await tap(page, `${T(`contact-${other.id}`)} .xcard__header`);
    await waitForAnimationsDone(page, 6000);
    const expanded = await page.$$eval('.ct-card .xcard__header', (els) => els.filter((e) => e.getAttribute('aria-expanded') === 'true').length);
    assert.equal(expanded, 1);
    // 越南手机号没写 Zalo：展开后也有「Zalo」（按手机号找）并说明
    // （演示数据的号码都是 +00，这里只检查有 Zalo 号的阿兰那一张的 Zalo 是 zalo.me）
    const zalo = await page.$eval(T(`contact-body-${other.id}`), (el) => el.querySelector('[data-contact-action="zalo"]')?.getAttribute('href'));
    assert.match(zalo, /^https:\/\/zalo\.me\/\d+$/);
    // 关联的地点：打开地点详情
    await tap(page, `${T(`contact-links-${other.id}`)} [data-related="place"]`);
    await page.waitForFunction((id) => location.hash.includes(`sheet=place:${id}`), {}, other.place_id);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('联系人芯片和搜索：「今天」只剩今天用得上的；按号码后几位找到；没找到给空状态；?contact= 进来展开并闪一下', async () => {
  const app = await openContacts();
  const { page } = app;
  try {
    await page.click(`${T('contacts-cats')} [data-value="today"]`);
    await page.waitForFunction(() => /[?&]cat=today/.test(location.hash));
    await app.idle();
    const today = await page.$$eval('[data-contact-id]', (els) => els.map((e) => [e.dataset.contactId, Boolean(e.querySelector('[data-testid="contact-today"]'))]));
    assert.ok(today.length >= 2 && today.every(([, t]) => t), JSON.stringify(today));
    await page.click(`${T('contacts-cats')} [data-value="all"]`);
    await page.waitForFunction(() => !/cat=/.test(location.hash));
    const digits = GRILL.whatsapp.replace(/\D/g, '').slice(-4);
    await page.click(T('contacts-search'));
    await page.keyboard.type(digits);
    await page.waitForFunction(() => /[?&]q=/.test(location.hash), { timeout: 4000 });
    await app.idle();
    const ids = await page.$$eval('[data-contact-id]', (els) => els.map((e) => e.dataset.contactId));
    assert.deepEqual(ids, [GRILL.id], `按号码后四位 ${digits}`);
    assert.deepEqual(await page.$$eval(`${T(`contact-quick-${GRILL.id}`)} a`, (els) => els.map((a) => a.dataset.contactAction)), ['whatsapp'], '只有 WhatsApp：快捷就是 WhatsApp');
    await page.click(T('contacts-search'), { clickCount: 3 });
    await page.keyboard.type('zzzz');
    await page.waitForSelector(T('contacts-none'), { timeout: 4000 });
    await app.shot('contacts-none', { fullPage: false });
    await app.go(`#/t/demo-island/contacts?contact=${GUIDE.id}`);
    await page.waitForSelector(`${T(`contact-${GUIDE.id}`)} .xcard[data-open]`, { timeout: 4000 });
    await sleep(900);
    const g = await page.$eval(T(`contact-${GUIDE.id}`), (el) => ({ top: el.getBoundingClientRect().top, flash: el.hasAttribute('data-pg-flash'), ids: el.querySelector('.ct-ids')?.textContent }));
    assert.ok(g.top >= 0 && g.top < 700, JSON.stringify(g));
    assert.ok(g.flash);
    assert.match(g.ids, /微信/);
    assert.match(g.ids, /LINE/);
    await page.screenshot({ path: path.join(SHOTS, 'focus-contact.png'), captureBeyondViewport: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('联系人：点 WhatsApp 圆钮同一个窗口打开 wa.me；只读成员照样能用全部动作（没有编辑入口，按钮都可点）', async () => {
  const app = await openContacts({ intercept: false });
  const { page } = app;
  try {
    const opened = await catchExternal(app);
    const wa = `${T(`contact-quick-${GRILL.id}`)} [data-contact-action="whatsapp"]`;
    await tap(page, wa);
    await sleep(400);
    assert.equal(opened.at(-1), `https://wa.me/${GRILL.whatsapp.replace(/\D/g, '')}`);
    assert.match(await hash(page), /\/contacts/);
    assertOnlyChatLinks(app);
    // 只读成员（Cathy 改成 viewer）
    await asCathyViewer(app, `#/t/demo-island/contacts?contact=${DESK.id}`);
    await page.waitForSelector(`${T(`contact-${DESK.id}`)} .xcard[data-open]`, { timeout: 10000 });
    await app.idle();
    const acts = await page.$$eval(`${T(`contact-body-${DESK.id}`)} .ct-act`, (els) => els.map((a) => [a.dataset.contactAction, a.hasAttribute('disabled') || a.getAttribute('aria-disabled') === 'true']));
    assert.deepEqual(acts.map((a) => a[0]), ['call', 'whatsapp', 'email']);
    assert.ok(acts.every(([, d]) => !d), '只读成员：动作都能用');
    assert.equal(await page.$(T(`contact-edit-${DESK.id}`)), null, '只读成员：没有「编辑」');
    assert.equal(await page.$(T('contacts-add')), null, '只读成员：没有「添加联系人」');
    assert.match(await page.$eval(T('contacts-readonly'), (el) => el.textContent), /只读成员/);
    await page.screenshot({ path: path.join(SHOTS, 'readonly-contact.png'), captureBeyondViewport: false });
    // 只读成员的贴士页：复制、给对方看照样能用
    await app.go(`#/t/demo-island/tips?kind=phrase`);
    await page.waitForSelector(T(`tip-show-${NO_ICE.id}`));
    await tap(page, T(`tip-show-${NO_ICE.id}`));
    await page.waitForSelector(T('driver-card'));
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), NO_ICE.local_text);
    assertOnlyChatLinks(app);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('添加联系人：名字没填那一栏摇一下、说原因、不转圈；填好（「同电话」一键填 WhatsApp）→ 转圈 → 对勾 → 面板收回，新的一个在列表里展开、闪一下；刷新还在', async () => {
  const app = await openContacts({ hash: '#/t/demo-island/contacts?cat=transport' });
  const { page } = app;
  try {
    await tap(page, T('contacts-add'));
    await page.waitForSelector(T('sheet-contact'));
    await waitForAnimationsDone(page, 6000);
    assert.match(await hash(page), /sheet=contact-edit:new-transport/, '从「交通」点的：预选交通');
    assert.equal(await page.$eval(`${T('contact-form-cats')} [data-value="transport"]`, (el) => el.getAttribute('aria-pressed')), 'true');
    // 名字没填：摇一下（半路图）、说原因、按钮不转圈
    const box = () => {
      const el = document.querySelector('[data-field="name"]');
      return el ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 : 0;
    };
    const cap = await captureAt(app, () => page.click(T('contact-form-submit')), { selector: '[data-field="name"]', progress: 0.12, evaluate: box });
    try {
      await page.screenshot({ path: path.join(MID, 'contact-form-shake.png'), captureBeyondViewport: false });
    } finally {
      await release(cap);
    }
    assert.ok(Math.abs(cap.state) > 0.5, `摇头半路有位移：${cap.state}`);
    await waitForAnimationsDone(page, 6000);
    assert.match(await page.$eval(T('contact-form-error-name'), (el) => el.textContent), /写个名字/);
    assert.equal(await page.$eval(T('contact-form-submit'), (el) => el.dataset.state), 'idle', '检查没过：不转圈');
    // 填好
    await page.type(T('contact-form-name'), '码头摩的 阿海');
    await page.type(T('contact-form-role'), '摩的司机');
    await page.type(T('contact-form-phone'), '+00 000 0000 0077');
    await tap(page, T('contact-form-same-whatsapp'));
    assert.equal(await page.$eval(T('contact-form-whatsapp'), (el) => el.value), '+00 000 0000 0077');
    await page.type(T('contact-form-note'), '在码头等，招手就来。');
    await page.screenshot({ path: path.join(SHOTS, 'contact-form.png'), captureBeyondViewport: false });
    await tap(page, T('contact-form-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet=contact-edit'), { timeout: 8000 });
    await page.waitForFunction(() => /[?&]contact=/.test(location.hash), { timeout: 4000 });
    const id = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('contact'));
    await page.waitForSelector(`${T(`contact-${id}`)} .xcard[data-open]`, { timeout: 4000 });
    const card = await page.$eval(T(`contact-${id}`), (el) => ({
      name: el.querySelector('.ct-x__name').textContent,
      quick: [...el.querySelectorAll('.ct-quick a')].map((a) => a.dataset.contactAction),
      flash: el.hasAttribute('data-pg-flash'),
      group: el.closest('.ct-group')?.dataset.cat,
    }));
    assert.deepEqual(card, { name: '码头摩的 阿海', quick: ['call', 'whatsapp'], flash: true, group: 'transport' });
    await waitForAnimationsDone(page, 6000);
    await sleep(600);
    const top = await page.$eval(T(`contact-${id}`), (el) => el.getBoundingClientRect().top);
    assert.ok(top > 0 && top < 700, `滚到了新的一个：${top}`);
    await page.screenshot({ path: path.join(SHOTS, 'contact-added.png'), captureBeyondViewport: false });
    // 刷新还在（演示后台存进了 IndexedDB）
    await page.reload();
    await page.waitForSelector(T(`contact-${id}`), { timeout: 10000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('编辑联系人：改身份保存后卡片跟着变；删除弹「已删除 · 撤销」，撤销回来；改了一半关面板先问', async () => {
  const app = await openContacts({ hash: `#/t/demo-island/contacts?contact=${GUIDE.id}` });
  const { page } = app;
  try {
    await page.waitForSelector(`${T(`contact-${GUIDE.id}`)} .xcard[data-open]`, { timeout: 4000 });
    await tap(page, T(`contact-edit-${GUIDE.id}`));
    await page.waitForSelector(T('sheet-contact'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(T('contact-form-name'), (el) => el.value), GUIDE.name);
    await page.click(T('contact-form-role'), { clickCount: 3 });
    await page.keyboard.type('中文向导（包车）');
    await tap(page, T('contact-form-submit'));
    await page.waitForFunction(() => !location.hash.includes('sheet=contact-edit'), { timeout: 8000 });
    await page.waitForFunction((id) => document.querySelector(`[data-contact-id="${id}"] .ct-sub__line`)?.textContent.includes('包车'), { timeout: 4000 }, GUIDE.id);
    // 改了一半关面板：先问（第二次打开同一个：按钮回到「保存」，不停在上次的对勾上）
    await tap(page, T(`contact-edit-${GUIDE.id}`));
    await page.waitForSelector(T('sheet-contact'));
    await waitForAnimationsDone(page, 6000);
    assert.equal(await page.$eval(T('contact-form-submit'), (el) => el.dataset.state), 'idle');
    await page.type(T('contact-form-note'), '多写一句');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="alertdialog"], .ov-dialog', { timeout: 4000 });
    await page.screenshot({ path: path.join(SHOTS, 'contact-form-confirm.png'), captureBeyondViewport: false });
    await page.keyboard.press('Escape');
    await sleep(500);
    assert.ok(await page.$(T('sheet-contact')), '取消：面板还在');
    // 删除 → 撤销
    await tap(page, T('contact-form-delete'));
    await page.waitForFunction(() => !location.hash.includes('sheet=contact-edit'), { timeout: 8000 });
    await page.waitForFunction((id) => !document.querySelector(`[data-contact-id="${id}"]`), { timeout: 4000 }, GUIDE.id);
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-toast__action')].some((b) => b.textContent.includes('撤销')), { timeout: 4000 });
    await page.evaluate(() => [...document.querySelectorAll('.ov-toast__action')].find((b) => b.textContent.includes('撤销')).click());
    await page.waitForSelector(T(`contact-${GUIDE.id}`), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 两页：各种宽度、深色、空、出错、加载中
// =====================================================================

for (const [name, hashOf] of [['tips', '#/t/demo-island/tips'], ['contacts', '#/t/demo-island/contacts']]) {
  for (const o of [{ device: 'small' }, { device: 'desktop' }, { colorScheme: 'dark' }]) {
    const label = o.device === 'small' ? '375' : o.device === 'desktop' ? '1280' : '深色';
    test(`${name === 'tips' ? '贴士' : '联系人'}页（${label}）：不横向滚动、触控区 ≥44、展开以后也是`, async () => {
      const app = name === 'tips' ? await openTips({ hash: hashOf, ...o }) : await openContacts({ hash: hashOf, ...o });
      const { page } = app;
      try {
        await assertNoHorizontalOverflow(page);
        await assertTapTargetsIn(page, T(`page-${name}`));
        // 展开第一张能展开的
        const first = name === 'tips' ? `${T('tips-pinned')} .xcard__header` : '.ct-card .xcard__header';
        await page.click(first);
        await waitForAnimationsDone(page, 6000);
        await assertNoHorizontalOverflow(page);
        await assertTapTargetsIn(page, T(`page-${name}`));
        await app.shot(`${name}-${label}`, { fullPage: false });
        app.assertClean();
      } finally {
        await app.close();
      }
    });
  }
}

test('空行程：贴士、联系人都显示插图和说明（没有搜索框、芯片）', async () => {
  let app = await openTips({ hash: '#/t/demo-empty/tips' });
  try {
    await app.page.waitForSelector(T('tips-empty'));
    assert.equal(await app.page.$(T('tips-search')), null);
    await assertNoHorizontalOverflow(app.page);
    await app.shot('tips-empty', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
  app = await openContacts({ hash: '#/t/demo-empty/contacts' });
  try {
    await app.page.waitForSelector(T('contacts-empty'));
    assert.equal(await app.page.$(T('contacts-search')), null);
    await app.shot('contacts-empty', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('三城（已结束、台北时区）：贴士、联系人照常；没有「今天」芯片', async () => {
  const app = await openContacts({ hash: '#/t/demo-cities/contacts' });
  try {
    assert.equal(await app.page.$(`${T('contacts-cats')} [data-value="today"]`), null);
    await app.go('#/t/demo-cities/tips');
    await app.page.waitForSelector('.tp__stack');
    assert.ok(await app.page.$(T('tips-pinned')));
    await assertNoHorizontalOverflow(app.page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出错 / 加载中：断网又没缓存说中文原因 + 重试；慢网先骨架再淡入', async () => {
  let app = await openApp({ browser, server, hash: '#/t/demo-island/tips', now: DURING, search: { demonet: 'offline' } });
  try {
    await app.page.waitForSelector(T('tips-error'), { timeout: 15000 });
    assert.match(await app.page.$eval(T('tips-error'), (el) => el.textContent), /[一-鿿]/);
    assert.ok(await app.page.$(`${T('tips-error')} button`), '有重试按钮');
    await app.shot('tips-offline-error', { fullPage: false });
    app.assertClean({ allowErrors: [/离线|offline|Failed to fetch|ERR_INTERNET_DISCONNECTED|网络/i] });
  } finally {
    await app.close();
  }
  app = await openApp({ browser, server, hash: '#/t/demo-island/contacts', now: DURING, search: { demolatency: '1500' } });
  try {
    await app.page.waitForSelector('.ct-skel', { timeout: 8000 });
    await app.page.screenshot({ path: path.join(SHOTS, 'contacts-loading.png'), captureBeyondViewport: false });
    await app.page.waitForSelector('.ct__stack', { timeout: 15000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});
