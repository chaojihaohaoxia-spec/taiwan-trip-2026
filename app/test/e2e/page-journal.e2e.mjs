// 日记相册页（pages/journal）+ 写日记 / 拍照打卡面板（sheets/journal）+ 看大图（sheets/photo）。演示数据，不连外网。
// 按天视图（进行中 / 出发前 / 已结束 / 空行程）、相册（按天分组、列表 ↔ 网格 FLIP 半路、按人筛选）、
// 看大图（从缩略图放大的半路、键盘换张、鼠标左右滑、往下拉关闭的跟手和落点、Esc、缩回缩略图的半路、减弱动态效果）、
// 写日记（心情、正文、草稿恢复、保存后出现在页面上、删除）、拍照打卡（上传、离线排队、保存后进相册）。
// 手机 390 / 375、桌面 1280、深色各截一张；都检查无报错、不横向滚动、触控区 ≥44。
// 截图：<截图根目录>/__screenshots__/page-journal/，半路图：__shots__/page-journal/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release, parseInset } from './lib/motion-shots.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));
const JEREMY = DB.users.find((u) => u.ref === 'jeremy').id;
const island = (table) => DB.tables[table].filter((r) => r.trip_id === 'demo-island');
const DAYS = island('days').sort((a, b) => (a.date < b.date ? -1 : 1));
const ENTRIES = island('journal_entries');
const MY_D1 = ENTRIES.find((e) => e.user_id === JEREMY && e.day_id === DAYS[0].id);
const ISLAND_PHOTOS = ENTRIES.reduce((n, e) => n + (e.photos || []).length, 0);
const NOW = { before: '2027-01-08T09:00:00+07:00', during: '2027-01-11T10:00:00+07:00', after: '2027-01-20T10:00:00+07:00' };
const JOURNAL = '#/t/demo-island/journal';
const SHOTS = shotsDir('page-journal');
const T = (id) => `[data-testid="${id}"]`;
const PHOTO = path.join(APP, 'demo', 'photos', 'demo-photo-03.jpg');
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

async function openJournal(o = {}) {
  const app = await openApp({ browser, server, hash: JOURNAL, now: NOW.during, ...o });
  await app.page.waitForSelector(`${T('page-journal')}:not([aria-busy="true"])`, { timeout: 15000 });
  await app.idle();
  return app;
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const count = (page, sel) => page.$$eval(sel, (els) => els.length);
const hash = (page) => page.evaluate(() => location.hash);
const shot = async (app, name, frame) => {
  const file = path.join(SHOTS, `${name}.png`);
  if (frame) {
    const clip = await app.page.$eval(frame, (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) };
    });
    await app.page.screenshot({ path: file, clip });
  } else {
    await app.page.screenshot({ path: file });
  }
  return file;
};

/** 鼠标拖动（Pointer Events：看大图的手势用鼠标也能触发） */
async function drag(page, from, to, { steps = 12, holdMs = 0 } = {}) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  if (holdMs) await sleep(holdMs);
  await page.mouse.up();
}

async function waitViewerClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="photo-viewer"]') && !location.hash.includes('sheet=photo'), { timeout: 8000 });
}

/** 看大图开好了：弹层在、已经定下第几张、出场动画播完 */
async function waitViewerReady(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="photo-viewer"]');
    return v && Number(v.dataset.index) >= 0 && document.querySelector('[data-testid="photo-title"]')?.textContent.trim();
  }, { timeout: 8000 });
  await waitForAnimationsDone(page, 8000);
}

async function openViewerFromAlbum(app) {
  const { page } = app;
  await app.go(`${JOURNAL}?view=album`);
  await page.waitForSelector(T('album-photo'));
  await page.click(`${T('album-photo')}`);
  await page.waitForSelector(T('photo-viewer'));
  await waitViewerReady(page);
}

/** 看大图的代码是按需加载的：截“打开的半路”之前先开一次再关掉，不然半路截到的是在下载模块 */
async function warmViewer(app, trigger) {
  const { page } = app;
  await page.click(trigger);
  await page.waitForSelector(T('photo-viewer'));
  await waitViewerReady(page);
  await page.keyboard.press('Escape');
  await waitViewerClosed(page);
  await app.idle();
}

// ---------------------------------------------------------------------
// 按天视图
// ---------------------------------------------------------------------
for (const [label, o] of [['手机浅色', {}], ['手机深色', { colorScheme: 'dark' }], ['小屏 375', { device: 'small' }], ['桌面 1280', { device: 'desktop' }]]) {
  test(`按天视图（进行中，${label}）：每天一节、今天标出来、我的一格在前、对方「还没写」；无报错、不横向滚动、触控区 ≥44`, async () => {
    const app = await openJournal(o);
    const { page } = app;
    try {
      assert.equal(await count(page, '[data-testid^="journal-day-"]'), DAYS.length, '四天四节');
      assert.ok(await page.$(`${T(`journal-day-${DAYS[1].date}`)}[data-today]`), 'D2 是今天');
      assert.match(await text(page, T('journal-stats')), /3 篇日记 · 4 张照片/);
      // 第一天：我（Jeremy）的那篇在前面，是我的
      const first = await page.$$eval(`${T(`journal-day-${DAYS[0].date}`)} ${T('journal-entry')}`, (els) => els.map((e) => e.dataset.user));
      assert.equal(first[0], JEREMY);
      assert.match(await text(page, `${T(`journal-day-${DAYS[0].date}`)} ${T('journal-entry-time')}`), /^写于 \d\d:\d\d$/, '同一天写的只写钟点');
      // 第二天我没写：有「拍照打卡」「写日记」入口；Cathy 写了
      const d2 = T(`journal-day-${DAYS[1].date}`);
      assert.ok(await page.$(`${d2} ${T('journal-entry-empty')}[data-mine="true"]`));
      assert.ok(await page.$(`${d2} ${T('journal-empty-camera')}`));
      assert.ok(await page.$(`${d2} ${T('journal-empty-write')}`));
      // 第三天：两个人都没写，对方的那格只说一句
      assert.match(await text(page, `${T(`journal-day-${DAYS[2].date}`)} ${T('journal-entry-empty')}[data-mine="false"]`), /Cathy 还没写/);
      // 顶上的入口记到今天
      assert.match(await text(page, T('journal-actions')), /记到 D2 · 今天/);
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      await app.shot(`days${o.colorScheme === 'dark' ? '-dark' : ''}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('按天视图：进行中打开页面先滚到今天（?day= 指定的天优先；最后一天滚到底）；短正文没有「展开全文」', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    const y = await page.evaluate(() => window.scrollY);
    const top = await page.$eval(T(`journal-day-${DAYS[1].date}`), (el) => el.getBoundingClientRect().top);
    assert.ok(y > 0 && top >= 0 && top < 160, `打开就在今天那一节附近（scrollY ${y}，D2 top ${top}）`);
    // 演示里的正文都不到 6 行：没有一篇有「展开全文」（量错了会多出一个没用的按钮）
    assert.equal(await count(page, '.jn-text__more'), 0);
    app.assertClean();
    await app.close();
    // ?day= 指定的那天滚到顶栏下面；靠后的天下面内容不够时能滚多远滚多远（滚到底）
    for (const date of [DAYS[0].date, DAYS[2].date, DAYS[3].date]) {
      const app2 = await openJournal({ search: {}, hash: `${JOURNAL}?day=${date}` });
      try {
        const r = await app2.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return { top: el.getBoundingClientRect().top, y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - window.innerHeight) };
        }, T(`journal-day-${date}`));
        assert.ok((r.top >= 0 && r.top < 160) || (r.y > 0 && r.y >= r.max - 2), `?day=${date}：top ${r.top}（scrollY ${r.y} / ${r.max}）`);
        app2.assertClean();
      } finally {
        await app2.close();
      }
    }
  } finally {
    await app.close().catch(() => {});
  }
});

test('加载中：骨架（aria-busy）→ 数据到了交叉淡入成真内容（ui/Reveal），不是整页跳一下', async () => {
  // 演示网络慢 1.5 秒：先看到骨架
  const app = await openApp({ browser, server, hash: JOURNAL, now: NOW.during, search: { demolatency: '1500' }, waitForApp: false });
  const { page } = app;
  try {
    await page.waitForSelector(`${T('page-journal')}[aria-busy="true"] .reveal[data-loading] ${T('journal-loading')}`, { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 10000 });
    await app.shot('loading', { fullPage: false });
    await page.waitForSelector(`${T('page-journal')}:not([aria-busy="true"])`, { timeout: 15000 });
    await page.waitForSelector(T('journal-days-view'));
    // 真内容在同一格里淡入（骨架还在 DOM 里但透明），不横向滚动
    assert.ok(await page.$(`${T('page-journal')} .reveal:not([data-loading]) ${T('journal-days-view')}`));
    await app.idle();
    assert.equal(await page.$eval(`${T('page-journal')} .reveal__skeleton`, (el) => getComputedStyle(el).opacity), '0');
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('出发前：入口记到第一天；已结束（三城 9 天）：统计和每天一节；空行程（山雾镇）：两天都「还没写」、相册是空状态', async () => {
  const before = await openJournal({ now: NOW.before });
  try {
    assert.match(await text(before.page, T('journal-actions')), /记到 D1/);
    assert.equal(await before.page.$(`${T('page-journal')} [data-today]`), null, '出发前没有“今天”');
    before.assertClean();
  } finally {
    await before.close();
  }
  const ended = await openApp({ browser, server, hash: '#/t/demo-cities/journal', now: NOW.after });
  try {
    await ended.page.waitForSelector(`${T('page-journal')}:not([aria-busy="true"])`);
    await ended.idle();
    assert.equal(await count(ended.page, '[data-testid^="journal-day-"]'), 9);
    assert.match(await text(ended.page, T('journal-stats')), /6 篇日记/);
    await assertNoHorizontalOverflow(ended.page);
    await ended.shot('cities-days');
    await ended.go('#/t/demo-cities/journal?view=album');
    await ended.page.waitForSelector(T('album-photo'));
    await assertNoHorizontalOverflow(ended.page);
    await ended.shot('cities-album');
    ended.assertClean();
  } finally {
    await ended.close();
  }
  const empty = await openApp({ browser, server, hash: '#/t/demo-empty/journal' });
  try {
    await empty.page.waitForSelector(`${T('page-journal')}:not([aria-busy="true"])`);
    await empty.idle();
    assert.equal(await count(empty.page, '[data-testid^="journal-day-"]'), 2);
    // 一篇都没有：空状态只说一次（不再每天重复「还没写 / Cathy 还没写」），下面一行一天的目录，点了写那天
    assert.match(await text(empty.page, T('journal-blank')), /这趟还没有日记/);
    assert.equal(await count(empty.page, T('journal-entry-empty')), 0);
    assert.equal(await count(empty.page, '.jn-index__btn'), 2);
    assert.equal(await empty.page.$(T('journal-stats')), null, '统计那行不再重复「还没有日记」');
    await empty.shot('empty-days');
    await empty.go('#/t/demo-empty/journal?view=album');
    await empty.page.waitForSelector(T('journal-empty-photos'));
    assert.match(await text(empty.page, T('journal-empty-photos')), /还没有照片/);
    await assertTapTargets(empty.page);
    await empty.shot('empty-album');
    empty.assertClean();
  } finally {
    await empty.close();
  }
});

// ---------------------------------------------------------------------
// 相册
// ---------------------------------------------------------------------
test('相册：按天分组、按人筛选；列表 ↔ 网格切换是 FLIP（半路图片在两端之间、播完不留内联样式）', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    await page.click(`${T('journal-view')} [role="radio"][data-index="1"]`);
    await page.waitForSelector(T('journal-album-view'));
    await app.idle();
    assert.match(await hash(page), /view=album/);
    assert.equal(await count(page, '[data-testid^="album-day-"]'), 2, '只有有照片的两天');
    assert.equal(await count(page, T('album-photo')), ISLAND_PHOTOS);
    await app.shot('album-grid');
    // 按人筛选
    await page.click(T(`journal-who-${JEREMY}`));
    await app.idle();
    assert.equal(await count(page, T('album-photo')), ENTRIES.filter((e) => e.user_id === JEREMY).reduce((n, e) => n + e.photos.length, 0));
    assert.match(await hash(page), /who=/);
    await page.click(T('journal-who-all'));
    await app.idle();
    assert.equal(await count(page, T('album-photo')), ISLAND_PHOTOS);
    // 列表 ↔ 网格：图片用 crop 模式 FLIP（半路有 transform），播完清掉
    const media = `${T('album-photo')} .jn-pc__media`;
    const read = () => {
      const el = document.querySelector('[data-testid="album-photo"] .jn-pc__media');
      const r = el.getBoundingClientRect();
      return { w: r.width, transform: getComputedStyle(el).transform, inline: el.getAttribute('style') || '' };
    };
    const start = await page.evaluate(read);
    // 弹簧的后半段几乎看不出在动：拨到 30% 才是肉眼意义上的“半路”（其他页面的 FLIP 半路图同样取 0.22–0.35）
    const mid = await captureAt(app, () => page.click(T('journal-layout')), { selector: media, progress: 0.3, evaluate: read });
    try {
      await shot(app, 'album-flip-mid');
      assert.notEqual(mid.state.transform, 'none', '半路图片在变换中');
    } finally {
      await release(mid);
    }
    await waitForAnimationsDone(page, 8000);
    await app.idle();
    const end = await page.evaluate(read);
    assert.match(await hash(page), /layout=list/);
    assert.equal(end.transform, 'none', '播完没有变换');
    assert.ok(!/transform|clip-path/.test(end.inline), '播完不留内联样式');
    assert.notEqual(Math.round(start.w), Math.round(end.w), '列表里的图比网格里的小');
    await assertNoHorizontalOverflow(page);
    await assertTapTargets(page);
    await app.shot('album-list');
    // 行程概览页的「相册」链接写的是 ?tab=photos：也认；切回「按天」时把它清掉
    await app.go(`${JOURNAL}?tab=photos`);
    await page.waitForSelector(T('journal-album-view'));
    await page.click(`${T('journal-view')} [role="radio"][data-index="0"]`);
    await page.waitForSelector(T('journal-days-view'));
    await app.idle();
    assert.doesNotMatch(await hash(page), /tab=|view=/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 看大图
// ---------------------------------------------------------------------
test('看大图：从缩略图放大出来（半路裁切和缩放都在两端之间）→ 显示谁哪天拍的和关联的日记；键盘换张；点 × 缩回缩略图（半路）', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    await app.go(`${JOURNAL}?view=album`);
    await page.waitForSelector(T('album-photo'));
    const readFrame = () => {
      const f = document.querySelector('.pv__slide[data-current] .pv__frame');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      return { w: r.width, h: r.height, clip: cs.clipPath, transform: cs.transform, backdrop: getComputedStyle(document.querySelector('.pv__backdrop')).opacity };
    };
    await warmViewer(app, T('album-photo'));
    const thumbRect = await page.$eval(`${T('album-photo')} .jn-pc__media`, (el) => el.getBoundingClientRect().toJSON());
    const mid = await captureAt(app, () => page.click(T('album-photo')), { selector: '.pv__frame', progress: 0.3, evaluate: readFrame });
    try {
      await shot(app, 'viewer-open-mid');
      assert.ok(mid.state, '半路已经有照片框');
      assert.notEqual(mid.state.clip, 'none', '半路还在裁切（从缩略图的形状长出来）');
      assert.notEqual(mid.state.transform, 'none');
      // 背景比照片先到位（--dur-base 的淡入，照片是 smooth 弹簧）：半路时已经在淡入或已经不透明
      assert.ok(Number(mid.state.backdrop) > 0, `背景已经开始淡入（${mid.state.backdrop}）`);
    } finally {
      await release(mid);
    }
    await waitViewerReady(page);
    await app.idle();
    const end = await page.evaluate(readFrame);
    assert.equal(end.transform, 'none');
    assert.ok(end.w > thumbRect.width * 1.5, '打开后比缩略图大得多');
    assert.match(await hash(page), /sheet=photo:e\./);
    assert.match(await text(page, T('photo-title')), /Cathy · 第 1 天/);
    assert.match(await text(page, T('photo-counter')), /^1 \/ 4$/);
    assert.match(await text(page, T('photo-journal')), /夜市的烤扇贝/);
    assert.ok(await page.$(T('photo-open-journal')));
    assert.equal(await page.$(T('photo-edit-journal')), null, '别人的照片没有「编辑」');
    await assertTapTargets(page);
    await app.shot('viewer', { fullPage: false });
    // 键盘换张
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-counter"]')?.textContent.trim() === '2 / 4', { timeout: 10000 });
    assert.match(await text(page, T('photo-title')), /Jeremy · 第 1 天/);
    assert.ok(await page.$(T('photo-edit-journal')), '自己的照片有「编辑」');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-counter"]')?.textContent.trim() === '4 / 4', { timeout: 5000 });
    await page.keyboard.press('ArrowRight');
    await waitForAnimationsDone(page, 5000);
    assert.equal(await text(page, T('photo-counter')), '4 / 4', '最后一张再往右：弹回');
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-counter"]')?.textContent.trim() === '1 / 4', { timeout: 5000 });
    // 点 ×：缩回缩略图（半路还在裁切）
    const close = await captureAt(app, () => page.click(T('photo-close')), { selector: '.pv__frame', evaluate: readFrame });
    try {
      await shot(app, 'viewer-close-mid');
      assert.ok(close.state && close.state.clip !== 'none', '收回半路在裁切');
    } finally {
      await release(close);
    }
    await waitViewerClosed(page);
    assert.doesNotMatch(await hash(page), /sheet=/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('看大图：鼠标左右拖换张（松手吸附）；往下拉跟手（照片变小、背景变淡）不够就弹回、够了就关掉；Esc 关闭；单击藏起文字', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    await openViewerFromAlbum(app);
    const W = await page.evaluate(() => innerWidth);
    const H = await page.evaluate(() => innerHeight);
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    // 左右拖：拖过屏宽的 1/3 → 下一张
    await drag(page, [cx + 100, cy], [cx - 60, cy], { steps: 10 });
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-counter"]')?.textContent.trim() === '2 / 4', { timeout: 10000 });
    // 往下拉一点：跟手（照片缩小、背景变淡），没过阈值松手弹回
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 70, { steps: 8 });
    const during = await page.evaluate(() => {
      const f = document.querySelector('.pv__slide[data-current] .pv__frame');
      return { transform: getComputedStyle(f).transform, backdrop: Number(getComputedStyle(document.querySelector('.pv__backdrop')).opacity) };
    });
    await shot(app, 'viewer-drag-mid');
    assert.notEqual(during.transform, 'none', '拉的时候照片跟着走');
    assert.ok(during.backdrop < 1, `背景变淡（${during.backdrop}）`);
    await page.mouse.up();
    await waitForAnimationsDone(page, 5000);
    assert.ok(await page.$(T('photo-viewer')), '没过阈值：还开着');
    const back = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.pv__backdrop')).opacity));
    assert.equal(back, 1, '背景回到不透明');
    // 单击：藏起顶部 / 底部的字；再点回来
    await page.mouse.click(cx, cy);
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-viewer"]')?.dataset.chrome === 'off', { timeout: 3000 });
    await sleep(350);
    await shot(app, 'viewer-immersive');
    await page.mouse.click(cx, cy);
    await page.waitForFunction(() => document.querySelector('[data-testid="photo-viewer"]')?.dataset.chrome === 'on', { timeout: 3000 });
    // 双击：以点的位置放大 2.5 倍（文字不切换）；再双击还原
    const zoomScale = () => {
      const el = document.querySelector('.pv__slide[data-current] .pv__zoom');
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return m.a;
    };
    // 两次独立的点按（clickCount: 2 只是一次按下带 detail=2，弹层数的是两次 pointerup）
    const doubleTap = async (x, y) => {
      await page.mouse.click(x, y);
      await page.mouse.click(x, y);
    };
    await doubleTap(cx + 40, cy - 30);
    await page.waitForFunction(() => {
      const el = document.querySelector('.pv__slide[data-current] .pv__zoom');
      return new DOMMatrixReadOnly(getComputedStyle(el).transform).a > 2.3;
    }, { timeout: 5000 });
    await waitForAnimationsDone(page, 5000);
    assert.ok(Math.abs((await page.evaluate(zoomScale)) - 2.5) < 0.05, '双击放大到 2.5 倍');
    assert.equal(await page.$eval(T('photo-viewer'), (el) => el.dataset.chrome), 'on', '双击不切换文字');
    await shot(app, 'viewer-zoomed');
    await doubleTap(cx, cy);
    await page.waitForFunction(() => {
      const el = document.querySelector('.pv__slide[data-current] .pv__zoom');
      return Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).a - 1) < 0.01;
    }, { timeout: 5000 });
    await waitForAnimationsDone(page, 5000);
    // 往下拉过阈值：关掉，网址里的弹层没了
    await drag(page, [cx, cy], [cx, cy + 260], { steps: 12 });
    await waitViewerClosed(page);
    // 再开一次，Esc 关
    await page.click(T('album-photo'));
    await page.waitForSelector(T('photo-viewer'));
    await waitForAnimationsDone(page, 8000);
    await page.keyboard.press('Escape');
    await waitViewerClosed(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('看大图：从日记里的缩略图打开（起点是那篇的第几张）；「打开那天的日记」回到按天视图并滚到那一天；减弱动态效果下能开能关；直接打开网址找不到的照片有说明', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    const d1 = T(`journal-day-${DAYS[0].date}`);
    // Cathy 第一天的第二张
    const thumbs = await page.$$(`${d1} ${T('journal-entry')}:not([data-mine]) ${T('journal-thumb')}`);
    assert.equal(thumbs.length, 2);
    await thumbs[1].click();
    await page.waitForSelector(T('photo-viewer'));
    await waitViewerReady(page);
    assert.match(await hash(page), /sheet=photo:e\.[0-9a-f-]+~n\.1/);
    assert.match(await text(page, T('photo-title')), /Cathy · 第 1 天/);
    await page.click(T('photo-open-journal'));
    await waitViewerClosed(page);
    await page.waitForSelector(T('journal-days-view'));
    await app.idle();
    assert.match(await hash(page), new RegExp(`day=${DAYS[0].date}`));
    app.assertClean();
  } finally {
    await app.close();
  }
  const reduced = await openJournal({ reducedMotion: true, hash: `${JOURNAL}?view=album` });
  try {
    await reduced.page.waitForSelector(T('album-photo'));
    await reduced.page.click(T('album-photo'));
    await reduced.page.waitForSelector(T('photo-viewer'));
    await waitViewerReady(reduced.page);
    assert.equal(await reduced.page.$eval('.pv__slide[data-current] .pv__frame', (el) => getComputedStyle(el).transform), 'none');
    await reduced.shot('viewer-reduced', { fullPage: false });
    await reduced.page.keyboard.press('Escape');
    await waitViewerClosed(reduced.page);
    reduced.assertClean();
  } finally {
    await reduced.close();
  }
  const missing = await openApp({ browser, server, hash: `${JOURNAL}?sheet=photo:e.00000000-0000-4000-8000-000000000000~n.0`, now: NOW.during });
  try {
    await missing.page.waitForSelector(T('photo-viewer'));
    await waitViewerReady(missing.page);
    // 找不到那篇日记：退回整趟相册的第一张（有照片就看照片；整趟没有照片才说找不到）
    assert.match(await text(missing.page, T('photo-counter')), /1 \/ 4/);
    missing.assertClean();
  } finally {
    await missing.close();
  }
  const none = await openApp({ browser, server, hash: '#/t/demo-empty/journal?sheet=photo:n.0' });
  try {
    await none.page.waitForSelector(T('photo-empty'));
    assert.match(await text(none.page, T('photo-empty')), /找不到/);
    await none.page.click(T('photo-close'));
    await waitViewerClosed(none.page);
    none.assertClean();
  } finally {
    await none.close();
  }
});

// ---------------------------------------------------------------------
// 写日记
// ---------------------------------------------------------------------
test('写日记：选心情、写正文，关掉再打开草稿还在（提示「已恢复」）；保存按钮转圈 → 对勾 → 面板收回，日记出现在今天那一节；再打开是编辑', async () => {
  const app = await openJournal();
  const { page } = app;
  try {
    await page.click(T('journal-action-write'));
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    assert.equal(await page.$eval(`${T(`journal-day-${DAYS[1].date}`)}[role="radio"]`, (el) => el.getAttribute('aria-checked')), 'true', '默认写今天（D2）');
    assert.equal(await page.$eval(T('journal-save'), (el) => el.getAttribute('aria-disabled') === 'true' || el.disabled), true, '空表单不能保存');
    await page.click(T('journal-mood-🤩'));
    assert.equal(await page.$eval(T('journal-mood-🤩'), (el) => el.getAttribute('aria-checked')), 'true');
    const LONG = ['第一次看到这么多鱼。', '晚上在西岸看了日落。', '回程的船有点晃，', '但船上的风很舒服。', '晚饭吃了烤鱿鱼，', '价钱比想象中便宜。', '回酒店路上下了一阵雨。', '明天早起看日出。'].join('\n');
    await page.type(T('journal-body'), LONG);
    // 正文框跟着内容长高（没有滚动条）
    const ta = await page.$eval(T('journal-body'), (el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight }));
    assert.ok(ta.h >= ta.sh - 1, `正文框和内容一样高（${ta.h} / ${ta.sh}）`);
    await app.shot('sheet-filled', { fullPage: false });
    // 马上关掉（Esc，不等 400ms 的草稿防抖）：面板卸载时把最后打的字落盘，草稿留在本机；页面上我的那格变成「继续写」
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet=journal'), { timeout: 8000 });
    await waitForAnimationsDone(page, 8000);
    const d2 = T(`journal-day-${DAYS[1].date}`);
    assert.match(await text(page, `${d2} ${T('journal-entry-empty')}[data-mine="true"]`), /写了一半/);
    await page.click(`${d2} ${T('journal-empty-write')}`);
    await page.waitForSelector(T('journal-restored'));
    await waitForAnimationsDone(page, 8000);
    assert.equal(await page.$eval(T('journal-body'), (el) => el.value), LONG);
    assert.equal(await page.$eval(T('journal-mood-🤩'), (el) => el.getAttribute('aria-checked')), 'true');
    const ta2 = await page.$eval(T('journal-body'), (el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight }));
    assert.ok(ta2.h >= ta2.sh - 1, `恢复草稿时正文框也量过高度（${ta2.h} / ${ta2.sh}）`);
    // 保存：转圈 → 对勾 → 收回
    await page.click(T('journal-save'));
    await page.waitForFunction(() => ['loading', 'success'].includes(document.querySelector('[data-testid="journal-save"]')?.dataset.state), { timeout: 5000 });
    await page.waitForFunction(() => !location.hash.includes('sheet=journal'), { timeout: 10000 });
    await waitForAnimationsDone(page, 8000);
    await app.idle();
    const mine = `${d2} ${T('journal-entry')}[data-mine]`;
    await page.waitForSelector(mine, { timeout: 5000 });
    assert.match(await text(page, mine), /第一次看到这么多鱼/);
    assert.match(await text(page, `${mine} .jn-entry__mood`), /🤩/);
    assert.equal(await page.$(`${mine} ${T('journal-entry-draft')}`), null, '保存后草稿清掉');
    assert.match(await text(page, T('journal-stats')), /4 篇日记/);
    await app.shot('days-after-save');
    // 八行的正文先只显示 6 行，「展开全文」原地长高（高度 FLIP：半路高度在两端之间），下面的内容跟着滑
    // （motion/flip.js 的 playHeight：变高时元素先到新高度、用 clip-path 从旧高度卷开，下面的内容用 translate 跟着滑）
    const more = `${mine} .jn-text__more`;
    assert.match(await text(page, more), /展开全文/);
    const readH = () => {
      const el = document.querySelector('[data-today] [data-testid="journal-entry"][data-mine] .jn-text__body');
      const r = el.getBoundingClientRect();
      return { h: r.height, w: r.width, clip: getComputedStyle(el).clipPath };
    };
    const h0 = (await page.evaluate(readH)).h;
    const below0 = await page.$eval(`${d2} ${T('journal-entry-empty')}, ${d2} ${T('journal-entry')}:not([data-mine])`, (el) => el.getBoundingClientRect().top);
    const midH = await captureAt(app, () => page.click(more), { selector: '.jn-text__body', progress: 0.3, evaluate: readH });
    try {
      await shot(app, 'expand-text-mid');
    } finally {
      await release(midH);
    }
    await waitForAnimationsDone(page, 8000);
    const end = await page.evaluate(readH);
    const below1 = await page.$eval(`${d2} ${T('journal-entry-empty')}, ${d2} ${T('journal-entry')}:not([data-mine])`, (el) => el.getBoundingClientRect().top);
    assert.ok(end.h > h0 + 20, `展开后更高（${h0} → ${end.h}）`);
    const inset = parseInset(midH.state.clip, midH.state.w, midH.state.h);
    assert.ok(inset && inset.b > 2 && inset.b < end.h - h0 - 2, `半路还裁着一截（下边裁 ${inset?.b}px，介于 0 和 ${end.h - h0} 之间）`);
    assert.equal(end.clip, 'none', '播完裁切撤掉');
    assert.ok(below1 > below0 + 20, `下面那一格跟着往下挪（${below0} → ${below1}）`);
    assert.match(await text(page, more), /收起/);
    // 再打开：是编辑，正文还在
    await page.click(`${mine} ${T('journal-entry-edit')}`);
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    assert.match(await text(page, T('journal-sheet')), /编辑日记/);
    assert.equal(await page.$eval(T('journal-body'), (el) => el.value), LONG);
    assert.ok(await page.$(T('journal-delete')));
    await assertTapTargets(page);
    await assertNoHorizontalOverflow(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('写日记：删除这篇（确认后收回面板，有「撤销」提示）；只读成员也能写自己的日记', async () => {
  const app = await openJournal({ hash: `${JOURNAL}?sheet=journal:m.text~d.${DAYS[0].date}` });
  const { page } = app;
  try {
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    assert.equal(await page.$eval(T('journal-body'), (el) => el.value), MY_D1.body, '第一天已有我的日记：进来就是编辑');
    await page.click(T('journal-delete'));
    await page.waitForSelector('[role="alertdialog"] button[data-role="destructive"]', { timeout: 5000 });
    await page.click('[role="alertdialog"] button[data-role="destructive"]');
    await page.waitForFunction(() => !location.hash.includes('sheet='), { timeout: 8000 });
    await waitForAnimationsDone(page, 8000);
    await app.idle();
    const d1 = T(`journal-day-${DAYS[0].date}`);
    assert.equal(await page.$(`${d1} ${T('journal-entry')}[data-mine]`), null, '我的第一天日记没了');
    assert.ok(await page.$(`${d1} ${T('journal-entry-empty')}[data-mine="true"]`));
    await page.waitForFunction(() => /已删除.*撤销/s.test(document.querySelector('.ov-toasts__list')?.textContent || ''), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 拍照打卡
// ---------------------------------------------------------------------
test('拍照打卡：选照片 → 处理中 → 已上传（缩略图、拍摄时间）→ 保存打卡 → 那天多了一篇带照片的日记、相册多一张', async () => {
  const app = await openJournal({ hash: `${JOURNAL}?sheet=journal:m.photo~d.${DAYS[2].date}` });
  const { page } = app;
  try {
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    assert.match(await text(page, T('journal-sheet')), /拍照打卡/);
    assert.equal(await page.$eval(T('journal-form'), (el) => el.dataset.mode), 'photo');
    const input = await page.$(T('journal-camera'));
    assert.ok(input, '「拍照」是一个真正的 file input（capture）');
    assert.equal(await input.evaluate((el) => el.getAttribute('capture')), 'environment');
    await input.uploadFile(PHOTO);
    await page.waitForSelector(T('journal-photo'), { timeout: 10000 });
    await page.waitForFunction(() => {
      const li = document.querySelector('[data-testid="journal-photo"]');
      const img = li?.querySelector('img');
      return li && li.dataset.state !== 'processing' && img && img.complete && img.naturalWidth > 0;
    }, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="journal-photo"]')?.dataset.state === 'done', { timeout: 15000 });
    await app.shot('sheet-photo-uploaded', { fullPage: false });
    await page.type(T('journal-body'), '南岬的落日');
    await page.click(T('journal-save'));
    await page.waitForFunction(() => !location.hash.includes('sheet=journal'), { timeout: 10000 });
    await waitForAnimationsDone(page, 8000);
    await app.idle();
    const d3 = T(`journal-day-${DAYS[2].date}`);
    const mine = `${d3} ${T('journal-entry')}[data-mine]`;
    await page.waitForSelector(`${mine} ${T('journal-thumb')}`, { timeout: 5000 });
    assert.equal(await count(page, `${mine} ${T('journal-thumb')}`), 1);
    assert.match(await text(page, mine), /南岬的落日/);
    await app.go(`${JOURNAL}?view=album`);
    await page.waitForSelector(T('album-photo'));
    assert.equal(await count(page, T('album-photo')), ISLAND_PHOTOS + 1);
    assert.equal(await count(page, '[data-testid^="album-day-"]'), 3);
    // 新照片能看大图
    await page.click(`${T(`album-day-${DAYS[2].date}`)} ${T('album-photo')}`);
    await page.waitForSelector(T('photo-viewer'));
    await waitViewerReady(page);
    await page.waitForFunction(() => document.querySelector('.pv__slide[data-current] img[data-loaded]'), { timeout: 10000 });
    assert.match(await text(page, T('photo-title')), /Jeremy · 第 3 天/);
    await page.keyboard.press('Escape');
    await waitViewerClosed(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('拍照打卡（离线）：先有网打开过，断网后照片进写队列、标「联网后上传」，照样能保存；联网后自动传完；没有缓存冷启动是「现在没有网络」', async () => {
  // 1. 有网时打开过页面和面板（代码分包、行程数据都在了），再断网——两个人在岛上就是这样：进过一次，之后信号时好时坏
  const app = await openJournal({ hash: `${JOURNAL}?sheet=journal:m.photo~d.${DAYS[3].date}` });
  const { page } = app;
  try {
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet=journal'), { timeout: 8000 });
    await app.idle();
    await page.setOfflineMode(true);
    await page.waitForFunction(() => document.querySelector('[data-testid="sync-bar"]')?.dataset.state === 'offline', { timeout: 8000 });
    await app.go(`${JOURNAL}?sheet=journal:m.photo~d.${DAYS[3].date}`);
    await page.waitForSelector(T('journal-form'));
    await waitForAnimationsDone(page, 8000);
    const input = await page.$(T('journal-pick'));
    await input.uploadFile(PHOTO);
    await page.waitForFunction(() => document.querySelector('[data-testid="journal-photo"]')?.dataset.state === 'offline', { timeout: 15000 });
    assert.match(await text(page, T('journal-upload-note')), /联网后自动上传/);
    await app.shot('sheet-photo-offline', { fullPage: false });
    await page.click(T('journal-save'));
    await page.waitForFunction(() => !location.hash.includes('sheet=journal'), { timeout: 10000 });
    await waitForAnimationsDone(page, 8000);
    await app.idle();
    const d4 = T(`journal-day-${DAYS[3].date}`);
    await page.waitForSelector(`${d4} ${T('journal-entry')}[data-mine] ${T('journal-thumb')}`, { timeout: 5000 });
    assert.equal(await page.$eval(T('sync-bar'), (el) => el.dataset.state), 'offline', '同步条显示离线（改动在写队列里）');
    await app.shot('days-offline-saved');
    // 2. 联网：写队列自动发出去（照片 + 日记），同步条回到「已同步」
    await page.setOfflineMode(false);
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="sync-bar"]')?.dataset.state;
      return !s || s === 'synced';
    }, { timeout: 20000 });
    await app.idle();
    assert.ok(await page.$(`${d4} ${T('journal-entry')}[data-mine] ${T('journal-thumb')}`), '联网后日记还在');
    app.assertClean();
  } finally {
    await app.close();
  }
  // 3. 这台设备从没打开过这趟行程、一开始就没网：页面是「现在没有网络」+ 重试，面板显示正在读取（不是报错、不是找不到）
  const cold = await openApp({ browser, server, hash: `${JOURNAL}?sheet=journal:m.photo~d.${DAYS[3].date}`, now: NOW.during, search: { demonet: 'offline' } });
  try {
    await cold.page.waitForSelector(T('journal-error'), { timeout: 15000 });
    assert.match(await text(cold.page, T('journal-error')), /没有网络/);
    assert.match(await text(cold.page, T('journal-sheet')), /正在读取/);
    await cold.shot('cold-offline', { fullPage: false });
    cold.assertClean();
  } finally {
    await cold.close();
  }
});
