// 「页面不单调」那一批（10-19 富国岛回来以后的反馈）：
//   - 每天页：大号日期 + 当天路线速写、那天的照片（点开看大图）、日记的第一句；
//   - 补照片：从相册挑一批 → 按拍摄日期分到每天（没有拍摄时间的单独说）→ 放进我那天的日记 → 相册里多出来；
//   - 封面和颜色：换主题色、去掉封面照片 → 整页的主题色跟着变；行程列表的卡片画出这趟的路线速写；
//   - 结束了、什么记录都没有：回顾只有「补照片」一个下一步（不再一排 0、不再另放「还没留下记录」）；
//   - 深色模式下这几样都看得清（截图）。
// 截图在 __screenshots__/page-visual/。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, assertNoHorizontalOverflow, assertTapTargets } from './lib/harness.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { buildTiff, insertJpegExif } from '../../src/dev/pages/lib/exif-fixture.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));
const T = (id) => `[data-testid="${id}"]`;
const AFTER_CITIES = '2026-04-01T10:00:00+08:00';
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const count = (page, sel) => page.$$eval(sel, (els) => els.length);

const cityPhotos = (date) => {
  const day = DB.tables.days.find((d) => d.trip_id === 'demo-cities' && d.date === date);
  return DB.tables.journal_entries.filter((e) => e.day_id === day.id).reduce((n, e) => n + (e.photos || []).length, 0);
};

let browser;
let server;
let tmp;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  tmp = mkdtempSync(path.join(os.tmpdir(), 'rs7885-visual-'));
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('每天页：大号日期 + 当天路线速写、那天的照片（点开看大图）、日记的第一句；读屏仍然读完整的「D2 · 3月15日 周日」', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await openApp({ browser, server, hash: '#/t/demo-cities/day/2026-03-15', now: AFTER_CITIES, colorScheme });
    const { page } = app;
    try {
      await page.waitForSelector(T('day-mast'), { timeout: 15000 });
      await app.idle();
      assert.equal(await text(page, '.day-mast__num'), '15');
      assert.match(await text(page, '.day-mast__side'), /3月 · 周日\s*第 2 天/);
      assert.match(await page.$eval('.day-head__eyebrow', (el) => el.textContent), /^D2 · 3月15日 周日$/);
      // 这天只有三个地方：连起来像一个 V，不够格就不画（宁缺毋滥）
      assert.equal(await page.$(T('day-sketch')), null, '三个点的一天不画速写');
      assert.equal(await count(page, T('day-photo')), Math.min(3, cityPhotos('2026-03-15')));
      assert.match(await text(page, T('day-quote')), /夜市人好多！\s*— Cathy/);
      await page.waitForFunction(() => [...document.querySelectorAll('.day-photos__img img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
      await assertNoHorizontalOverflow(page);
      await app.shot(`day-${colorScheme}`, { fullPage: false });
      if (colorScheme === 'light') {
        await assertTapTargets(page);
        await page.click(T('day-photo'));
        await page.waitForSelector(T('photo-viewer'), { timeout: 10000 });
        await waitForAnimationsDone(page, 8000);
        await app.shot('day-photo-viewer', { fullPage: false });
      }
      // 没有日记、没有照片的那天：不硬凑
      await app.go('#/t/demo-cities/day/2026-03-16');
      await page.waitForFunction(() => document.querySelector('.day-mast__num')?.textContent === '16', { timeout: 10000 });
      assert.equal(await page.$(T('day-photos')), null);
      assert.equal(await page.$(T('day-quote')), null);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('补照片：挑两张（一张有拍摄时间、一张没有）→ 按日期分到那天 → 放进日记 → 相册多一张；没有拍摄时间的可以挑一天放', async () => {
  // 一张带 EXIF 拍摄时间的 JPEG（3 月 21 日下午，台北时间）+ 一张没有 EXIF 的
  const plain = readFileSync(path.join(APP, 'demo', 'photos', 'demo-photo-02.jpg'));
  const withTime = insertJpegExif(new Uint8Array(plain), buildTiff({ dateTimeOriginal: '2026:03:21 15:20:00', offsetTimeOriginal: '+08:00' }));
  const a = path.join(tmp, 'IMG_0321.jpg');
  const b = path.join(tmp, 'screenshot.jpg');
  writeFileSync(a, withTime);
  writeFileSync(b, readFileSync(path.join(APP, 'demo', 'photos', 'demo-photo-05.jpg')));
  const before21 = cityPhotos('2026-03-21');

  const app = await openApp({ browser, server, hash: '#/t/demo-cities/journal', now: AFTER_CITIES });
  const { page } = app;
  try {
    await page.waitForSelector(`${T('page-journal')}:not([aria-busy="true"])`, { timeout: 15000 });
    await app.idle();
    // 结束以后「拍照打卡」换成「补照片」
    assert.equal(await page.$(T('journal-action-camera')), null);
    const input = await page.$(`input${T('journal-action-import')}`);
    assert.ok(input, '「补照片」是一个真正的多选 file input');
    assert.equal(await input.evaluate((el) => el.multiple), true);
    await input.uploadFile(a, b);
    await page.waitForSelector(T('photo-import-plan'), { timeout: 15000 });
    await waitForAnimationsDone(page, 8000);
    assert.match(await text(page, T('photo-import-day-2026-03-21')), /D8.*3月21日.*15:20.*1 张/s);
    assert.match(await text(page, T('photo-import-summary')), /1 张放进 1 天的日记 · 1 张没有拍摄时间/);
    assert.match(await text(page, T('photo-import-unknown')), /1 张没有拍摄时间/);
    assert.match(await text(page, T('photo-import-submit')), /放进日记 · 1 张/);
    await app.shot('import-plan', { fullPage: false });
    // 没有拍摄时间的那张挑 D8：两张都放进 3 月 21 日
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="photo-import-unknown"] button')].find((x) => x.textContent.trim() === 'D8').click());
    await page.waitForFunction(() => /2 张/.test(document.querySelector('[data-testid="photo-import-day-2026-03-21"]')?.textContent || ''));
    await page.click(T('photo-import-submit'));
    await page.waitForSelector(T('photo-import-open-album'), { timeout: 20000 });
    assert.match(await text(page, T('photo-import-summary')), /放好了：2 张照片放进 1 天的日记/);
    assert.match(await text(page, T('photo-import-day-2026-03-21')), /2 张/, '放完以后还是放进去时的分法');
    await app.shot('import-done', { fullPage: false });
    await page.click(T('photo-import-open-album'));
    await page.waitForFunction(() => location.hash.includes('view=album') && !location.hash.includes('sheet='), { timeout: 10000 });
    await page.waitForSelector(`${T('album-day-2026-03-21')} ${T('album-photo')}`, { timeout: 10000 });
    assert.equal(await count(page, `${T('album-day-2026-03-21')} ${T('album-photo')}`), before21 + 2);
    // 再补一次同一张：已经在日记里了，不重复
    await app.go('#/t/demo-cities/journal');
    const again = await page.$(`input${T('journal-action-import')}`);
    await again.uploadFile(a);
    await page.waitForSelector(T('photo-import-plan'), { timeout: 15000 });
    assert.match(await text(page, T('photo-import-summary')), /1 张已经在日记里了/);
    assert.equal(await page.$eval(T('photo-import-submit'), (el) => el.getAttribute('aria-disabled') === 'true' || el.disabled), true);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('封面和颜色：换成「暖金橙红」、去掉封面照片 → 整页主题色跟着变；行程列表的卡片画出这趟的路线速写', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island?sheet=cover', now: '2027-01-11T10:00:00+07:00' });
  const { page } = app;
  try {
    await page.waitForSelector(T('cover-form'), { timeout: 15000 });
    await waitForAnimationsDone(page, 8000);
    // 现在用的是预设「海岛青绿」、有封面照片
    assert.equal(await page.$eval(T('cover-color-island'), (el) => el.getAttribute('aria-checked')), 'true');
    assert.ok(await page.$(`${T('cover-preview')} img`));
    await app.shot('cover-sheet', { fullPage: false });
    await page.click(T('cover-color-sunset'));
    await page.click(T('cover-clear'));
    // 不用照片：预览和行程卡片一样是主题色 + 宋体首字（不画路线速写）
    await page.waitForSelector(`${T('cover-preview')} .cvs-preview__initial`, { timeout: 5000 });
    assert.equal(await page.$(`${T('cover-preview')} .rsk`), null);
    await app.shot('cover-sheet-changed', { fullPage: false });
    await page.click(T('cover-save'));
    await page.waitForFunction(() => !location.hash.includes('sheet=cover'), { timeout: 10000 });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--trip-accent').trim().toUpperCase() === '#C8642A', { timeout: 5000 });
    await app.idle();
    await app.go('#/trips');
    // 行程卡片不画路线速写（两趟都是一根歪线，分不出来）：主题色 + 首字
    await page.waitForSelector(`${T('trip-demo-island')} .tcard__dot`, { timeout: 10000 });
    assert.equal(await page.$(`${T('trip-demo-island')} .rsk`), null);
    assert.equal(await page.$(`${T('trip-demo-island')} .tcard__photo`), null, '去掉照片以后不再显示');
    await app.shot('trips-sketch', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('结束了、什么记录都没有（山雾镇）：回顾不再一排 0，下一步只有「补照片」', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-empty', now: '2027-04-10T10:00:00+08:00' });
  const { page } = app;
  try {
    await page.waitForSelector(`${T('page-trip')}[data-phase="ended"]`, { timeout: 15000 });
    await app.idle();
    const ids = await page.$$eval(`${T('page-trip')} > *`, (els) => els.map((el) => el.dataset.testid || el.className.split(' ')[0]));
    assert.deepEqual(ids.filter((x) => x !== 'ov-days'), ['ov-recap', 'ov-photo-nudge']);
    assert.equal(await page.$(T('ov-recap-stats')), null, '全是 0 的数字不显示');
    assert.ok(await page.$(`input${T('ov-photo-import')}[multiple]`));
    assert.ok(await page.$(T('ov-cover-open')), '能编辑：顺手换封面和主题色');
    await assertNoHorizontalOverflow(page);
    await app.shot('ended-empty', { fullPage: false });
    app.assertClean();
  } finally {
    await app.close();
  }
});
