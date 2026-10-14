// 外壳阶段三份评审（视觉还原、交互动效、工程）的回归测试：每条修过的问题一条（或几条）断言，免得以后改回去。
// 全部演示模式（虚构数据 demo-island / demo-cities / demo-empty），不连外网。
//
// 截图：<截图根目录>/__shots__/shell-review/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const SHOTS = shotsDir('shell-review');
mkdirSync(SHOTS, { recursive: true });
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

/** 等外壳和行程数据都到了：大标题有字 */
async function ready(app, title = '椰影岛') {
  await app.page.waitForFunction((t) => document.querySelector('.shell-head__name, .shell-head__title')?.textContent.includes(t), { timeout: 10000 }, title);
  await app.page.evaluate(() => document.fonts.ready);
  await app.idle();
}

const rect = (page, sel) => page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

// ---------------------------------------------------------------------
// P0 天数分段条：天多（10 格）时滑块的宽度和位置
// ---------------------------------------------------------------------

test('分段条 10 格（三城 9 天）：滑块正好盖住选中的那一格（概览、D6、D9；390 和 375；点格子换天以后也是）', async () => {
  for (const device of ['mobile', 'small']) {
    for (const [hash, label] of [['#/t/demo-cities', '概览'], ['#/t/demo-cities/day/2026-03-19', 'D6'], ['#/t/demo-cities/day/2026-03-22', 'D9']]) {
      const app = await open({ hash, device, now: '2026-03-19T10:00:00+08:00' });
      try {
        await ready(app, '三城');
        const { page } = app;
        const cell = await page.$eval(`${T('day-strip')} .ds__cell[aria-current="page"]`, (el) => el.querySelector('.ds__big').textContent);
        assert.equal(cell, label);
        const thumb = await rect(page, `${T('day-strip')} .ds__thumb > span`);
        const sel = await rect(page, `${T('day-strip')} .ds__cell[aria-current="page"]`);
        for (const k of ['x', 'w']) assert.ok(Math.abs(thumb[k] - sel[k]) <= 1, `${device} ${label}：滑块 ${k}=${thumb[k]}，选中格 ${k}=${sel[k]}`);
        const cells = await page.$$eval(`${T('day-strip')} .ds__cell`, (els) => els.map((e) => e.getBoundingClientRect().width));
        assert.equal(cells.length, 10);
        for (const w of cells) assert.ok(w >= 63.5, `每格至少 64px（${w}）`);
        app.assertClean();
      } finally {
        await app.close();
      }
    }
  }
  // 点格子换天：弹簧播完以后滑块停在新的一格上
  const app = await open({ hash: '#/t/demo-cities/day/2026-03-19', now: '2026-03-19T10:00:00+08:00' });
  try {
    await ready(app, '三城');
    const { page } = app;
    await page.$eval(T('day-strip-2026-03-22'), (el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
    await app.idle();
    await page.click(T('day-strip-2026-03-22'));
    await page.waitForFunction(() => location.hash.includes('2026-03-22'));
    await app.idle();
    await new Promise((r) => setTimeout(r, 400));
    await app.idle();
    const thumb = await rect(page, `${T('day-strip')} .ds__thumb > span`);
    const sel = await rect(page, T('day-strip-2026-03-22'));
    assert.ok(Math.abs(thumb.x - sel.x) <= 1 && Math.abs(thumb.w - sel.w) <= 1, `点 D9 后滑块 ${JSON.stringify(thumb)} 选中格 ${JSON.stringify(sel)}`);
    await page.screenshot({ path: path.join(SHOTS, 'daystrip-10-d9.png'), clip: { x: 0, y: 80, width: 390, height: 120 } });
    // Home / End：焦点跳到第一格 / 最后一格
    await page.focus(T('day-strip-2026-03-22'));
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.index), '0');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.index), '9');
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 工程 P1-2：首屏 CSS 拆分，页面级样式跟着页面加载（不闪无样式的内容）
// ---------------------------------------------------------------------

test('按需样式表：页面第一帧就有样式（kit 卡片出现时它的样式表已经加载好）；同一个样式表只加载一次', async () => {
  const app = await open({ hash: '#/trips', waitForApp: false });
  try {
    const { page } = app;
    // 记下 .k-card 第一次出现那一刻它有没有样式（圆角不是 0 = kit 的样式已经生效）
    await page.evaluate(() => {
      window.__firstCard = null;
      const check = () => {
        const el = document.querySelector('.k-card');
        if (el && !window.__firstCard) {
          const s = getComputedStyle(el);
          window.__firstCard = { radius: s.borderTopLeftRadius, links: document.querySelectorAll('link[data-chunk-css]').length };
        }
      };
      new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
      check();
    });
    await app.ready();
    await page.waitForSelector('.k-card');
    await app.idle();
    const first = await page.evaluate(() => window.__firstCard);
    assert.ok(first, '看到了 kit 卡片');
    assert.notEqual(first.radius, '0px', `卡片第一次出现时已经有圆角（kit 样式已经生效）：${JSON.stringify(first)}`);
    assert.ok(first.links >= 1, '按需样式表是 <link> 加进来的');
    // 首屏样式表里没有页面级样式；进别的页面再加载它自己的；同一个 href 只有一个 <link>
    await app.go('#/t/demo-island/ledger');
    await page.waitForSelector('.k-money');
    await app.go('#/t/demo-island');
    await app.idle();
    const hrefs = await page.$$eval('link[data-chunk-css]', (els) => els.map((e) => e.getAttribute('href')));
    assert.equal(new Set(hrefs).size, hrefs.length, `没有重复的样式表：${hrefs.join(', ')}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 视觉 P1-1：['content', 'large'] 的底部面板按内容高度升起；有底部按钮时按钮在露出来那一截的底边
// ---------------------------------------------------------------------

test('底部面板 [content, large]：打开时按内容高度升起（不是全屏）；底部按钮在露出来那一截的底边，切到大档后贴着面板底', async () => {
  // 「加待办」（正式版，['content', 'large']）：内容不多，面板只露出标题区 + 内容 + 底部保存按钮
  const app = await open({ hash: '#/t/demo-island?sheet=todo:l.todo' });
  try {
    const { page } = app;
    await page.waitForSelector(`${T('sheet-todo')}[data-detent="content"]`);
    await page.waitForSelector(`${T('sheet-todo')} .ov-sheet__footer`);
    await app.idle();
    await new Promise((r) => setTimeout(r, 300));
    await app.idle();
    const vh = await page.evaluate(() => innerHeight);
    const panel = await rect(page, T('sheet-todo'));
    const last = await page.$eval(`${T('sheet-todo')} .ov-sheet__body`, (body) => {
      const kids = [...body.children];
      return Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
    });
    assert.ok(panel.y > 120, `面板没有一打开就到顶（上边 ${panel.y}）`);
    // 有底部按钮时：内容最后一行紧挨着按钮区的上沿，按钮区在露出来那一截的底边、看得见
    const foot = await rect(page, `${T('sheet-todo')} .ov-sheet__footer`);
    assert.ok(Math.abs(foot.y - last) < 48, `内容最后一行离底部按钮区不远（内容底 ${last}，按钮区上沿 ${foot.y}）`);
    assert.ok(foot.y + foot.h <= vh + 1, `底部按钮区在屏幕里（下沿 ${foot.y + foot.h}，屏幕 ${vh}）`);
    // 标题拿到焦点但不画焦点框（从网址直接打开）
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { cls: el.className, outline: s.outlineStyle === 'none' || s.outlineWidth === '0px' };
    });
    assert.ok(ring.outline, `焦点所在的元素（${ring.cls}）没有焦点框`);
    await page.screenshot({ path: path.join(SHOTS, 'sheet-content-detent.png') });
    app.assertClean();
  } finally {
    await app.close();
  }

  const dev = await open({ hash: '#/dev/overlays' });
  try {
    const { page } = dev;
    await page.click(T('open-short'));
    await page.waitForSelector(`${T('sheet-short')}[data-detent="content"]`);
    await dev.idle();
    await new Promise((r) => setTimeout(r, 300));
    await dev.idle();
    const vh = await page.evaluate(() => innerHeight);
    const panel = await rect(page, T('sheet-short'));
    const body = await rect(page, T('short-body'));
    const save = await rect(page, T('short-save'));
    assert.ok(panel.y > vh * 0.4, `内容很短：面板只升起一截（上边 ${panel.y}）`);
    assert.ok(save.y >= body.y + body.h - 1, '按钮在内容下面');
    assert.ok(save.y + save.h <= vh - 8, `按钮在屏幕里（底 ${save.y + save.h}）`);
    assert.ok(vh - (save.y + save.h) < 40, `按钮贴着露出来那一截的底边（离屏幕底 ${vh - (save.y + save.h)}）`);
    await page.screenshot({ path: path.join(SHOTS, 'sheet-footer-content.png') });
    // 切到大档：面板到顶，按钮跟着落到面板底
    await page.click(`${T('sheet-short')} .ov-sheet__grabber`);
    await page.waitForSelector(`${T('sheet-short')}[data-detent="large"]`);
    await dev.idle();
    await new Promise((r) => setTimeout(r, 300));
    await dev.idle();
    const big = await rect(page, T('sheet-short'));
    const save2 = await rect(page, T('short-save'));
    assert.ok(big.y < 80, `大档到顶（${big.y}）`);
    assert.ok(Math.abs(big.y + big.h - (save2.y + save2.h)) < 40, '大档：按钮在面板底部');
    await page.screenshot({ path: path.join(SHOTS, 'sheet-footer-large.png') });
    dev.assertClean();
  } finally {
    await dev.close();
  }
});

test('从网址直接打开 ＋ 面板 / 更多菜单：焦点放在面板上，不在第一块瓷砖上画焦点框；点开时焦点照常进第一块', async () => {
  for (const [sheet, testId, tile] of [['fab', 'fab-panel', '.fab-tile'], ['menu', 'more-menu', '.more-tile']]) {
    const app = await open({ hash: `#/t/demo-island?sheet=${sheet}` });
    try {
      const { page } = app;
      await page.waitForSelector(tile);
      await app.idle();
      await new Promise((r) => setTimeout(r, 200));
      const focus = await page.evaluate((sel) => {
        const el = document.activeElement;
        return { onTile: Boolean(el?.closest(sel)), visible: el?.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none' };
      }, tile);
      assert.equal(focus.onTile, false, `${sheet}：焦点不在瓷砖上`);
      assert.equal(focus.visible, false, `${sheet}：没有焦点框`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

// ---------------------------------------------------------------------
// 动效：换行程（动效 P1-2 重影、P1-3 掉帧；视觉 P2-3 / 动效 P2-10 光场和主题色）
// ---------------------------------------------------------------------

/** 页面里逐帧记录（真实时间）：fn 每帧调用一次，返回值存进 window.__frames；stopAfter 毫秒后停 */
async function recordFrames(page, fn, stopAfter) {
  await page.evaluate((src, ms) => {
    window.__frames = [];
    const f = new Function(`return (${src})`)();
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      try {
        window.__frames.push({ t, ...f() });
      } catch (e) {
        window.__frames.push({ t, error: String(e) });
      }
      if (t < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, fn.toString(), stopAfter);
}

test('换行程：旧内容很快淡出、新内容随后浮上来，没有两份叠在一起；<html> 上的主题色只写一次；光场新层在不透明的旧层上淡入；底栏跟着补间、播完撤掉', async () => {
  const app = await open({ hash: '#/t/demo-island' });
  try {
    await ready(app);
    const { page } = app;
    // 数 <html> 上 --trip-accent 被写了几次
    await page.evaluate(() => {
      window.__accentWrites = 0;
      const style = document.documentElement.style;
      const set = style.setProperty.bind(style);
      style.setProperty = (name, ...rest) => {
        if (name === '--trip-accent') window.__accentWrites += 1;
        return set(name, ...rest);
      };
    });
    // 打开网站头 1.5 秒内换色不做过渡（Field.jsx 的 BOOT_GRACE_MS）：等过了再换
    await page.waitForFunction(() => performance.now() > 2200, { timeout: 5000 });
    await page.click(T('shell-title'));
    await page.waitForSelector(T('switcher-trip-demo-cities'));
    await app.idle();
    await recordFrames(page, () => {
      const op = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
      const ghost = document.querySelector('.shell-ghost[data-ghost="page"]');
      const fresh = document.querySelector('[data-shell-page] > * > *');
      const layers = [...document.querySelectorAll('.shell-field .light-field__layer')].map((l) => ({ state: l.dataset.state, o: Number(getComputedStyle(l).opacity) }));
      const tab = document.querySelector('[data-testid="shell-tabbar"]');
      return { ghost: op(ghost), fresh: op(fresh), layers, scoped: tab?.classList.contains('accent-scope') || false };
    }, 1600);
    await page.click(T('switcher-trip-demo-cities'));
    await page.waitForFunction(() => location.hash.startsWith('#/t/demo-cities'));
    await new Promise((r) => setTimeout(r, 1700));
    const frames = await page.evaluate(() => window.__frames);
    const writes = await page.evaluate(() => window.__accentWrites);
    assert.ok(writes <= 2, `<html> 上的主题色写了 ${writes} 次（应该只写终值一次）`);
    // 重影：旧内容的幽灵和新内容同时都看得清的帧
    const overlap = frames.filter((f) => f.ghost !== null && f.fresh !== null && f.ghost + f.fresh > 1.15);
    assert.deepEqual(overlap.map((f) => `${Math.round(f.t)}ms 幽灵 ${f.ghost.toFixed(2)} + 新 ${f.fresh.toFixed(2)}`), [], '旧内容和新内容叠在一起');
    // 光场：两层同时在的帧里，下面的旧层一直不透明（不透出底色发灰）
    const both = frames.filter((f) => f.layers?.length >= 2);
    assert.ok(both.length > 3, '有交叉的帧');
    for (const f of both) assert.ok(f.layers[0].o > 0.99, `${Math.round(f.t)}ms 旧层透明度 ${f.layers[0].o}`);
    assert.ok(both.some((f) => f.layers[f.layers.length - 1].o > 0.1 && f.layers[f.layers.length - 1].o < 0.9), '新层是慢慢淡入的');
    // 底栏补间：中途带 accent-scope，播完撤掉
    assert.ok(frames.some((f) => f.scoped), '换色时底栏在自己身上补间主题色');
    assert.equal(await page.$eval(T('shell-tabbar'), (el) => el.classList.contains('accent-scope') || el.style.getPropertyValue('--trip-accent') !== ''), false, '播完撤掉，回到跟随 <html>');
    assert.equal(await page.$$eval('.shell-field .light-field__layer', (els) => els.length), 1, '旧层删掉了');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减弱动态效果：光场五个光斑都不漂（第 2、4 个以前还在漂）', async () => {
  const app = await open({ reducedMotion: true });
  try {
    await ready(app);
    const running = await app.page.evaluate(() => [...document.querySelectorAll('.light-field__blob')]
      .flatMap((b) => b.getAnimations()).filter((a) => a.playState === 'running').length);
    assert.equal(running, 0);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('连点分段条（间隔很短）：被打断的入场停在半路的样子变成幽灵退出，不会先闪回完整不透明', async () => {
  const app = await open({ hash: '#/t/demo-island/day/2027-01-10' });
  try {
    await ready(app);
    const { page } = app;
    const cdp = await page.createCDPSession();
    await cdp.send('Animation.enable');
    // 动画放慢 10 倍：第二下点的时候，第一次换天的新内容还在很早的半路（几乎透明）
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    await page.click(T('day-strip-2027-01-11'));
    // 等第一次换天的新内容真的开始入场（还在很早的半路），再点第二下
    await page.waitForFunction(() => location.hash.includes('2027-01-11')
      && [...document.querySelectorAll('[data-shell-page] > * > *')].some((el) => el.getAnimations().length > 0), { timeout: 5000 });
    await page.click(T('day-strip-2027-01-12'));
    const ghost = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const g = document.querySelector('.shell-ghost');
      const kids = g ? [...g.querySelectorAll('[data-shell-page] > *, .shell-ghost > * > * > *')] : [];
      const first = g?.firstElementChild?.firstElementChild?.firstElementChild;
      resolve({ has: Boolean(g), childOpacity: first ? Number(getComputedStyle(first).opacity) : null, kids: kids.length });
    })));
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    assert.ok(ghost.has, '有幽灵');
    assert.ok(ghost.childOpacity !== null && ghost.childOpacity < 0.6, `幽灵里的内容是被打断时的样子（透明度 ${ghost.childOpacity}），不是完整不透明`);
    await page.waitForFunction(() => location.hash.includes('2027-01-12'));
    await app.idle();
    assert.equal(await page.$$eval('.shell-ghost', (els) => els.length), 0, '播完幽灵删掉');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 给司机看（动效 P1-4 收回时的空白块、P2-14 误双击；视觉 P2-7 桌面对齐）
// ---------------------------------------------------------------------

async function openKit(o = {}) {
  const app = await open({ hash: '#/dev/kit', search: { trip: 'demo-island' }, ...o });
  await app.page.waitForSelector(T('kit-driver-hotel'), { timeout: 10000 });
  await app.idle();
  return app;
}

test('给司机看收回：每个时刻卡片都跟着内容一起变淡（没有“内容没了、卡片还是一块实心白”的帧）；打开过程中点空白处不关', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await openKit({ colorScheme });
    const { page } = app;
    try {
      await page.$eval(T('kit-driver-hotel'), (el) => el.scrollIntoView({ block: 'center' }));
      await page.click(T('kit-driver-hotel'));
      await page.waitForSelector(T('driver-card'));
      await app.idle(6000);
      const read = () => ({
        card: Number(getComputedStyle(document.querySelector('.drv')).opacity),
        content: Number(getComputedStyle(document.querySelector('.drv__main')).opacity),
      });
      const bad = [];
      for (const progress of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
        if (!(await page.$(T('driver-card')))) {
          await page.click(T('kit-driver-hotel'));
          await page.waitForSelector(T('driver-card'));
          await app.idle(6000);
        }
        const cap = await captureAt(app, () => page.click(T('driver-close')), { selector: '.drv', progress, evaluate: read });
        if (cap.state.card > 0.6 && cap.state.content < 0.2) bad.push(`${progress}: 卡片 ${cap.state.card.toFixed(2)} 内容 ${cap.state.content.toFixed(2)}`);
        if (progress === 0.45) await page.screenshot({ path: path.join(SHOTS, `driver-close-45-${colorScheme}.png`) });
        await release(cap);
        await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 8000 });
        await app.idle();
      }
      assert.deepEqual(bad, [], `${colorScheme}：收回中途有空白的实心卡片`);
      // 误双击：打开后马上再点一下空白处，不关
      await page.click(T('kit-driver-hotel'));
      await page.waitForSelector(T('driver-card'));
      await page.mouse.click(195, 470);
      await new Promise((r) => setTimeout(r, 600));
      assert.ok(await page.$(T('driver-card')), '出场动画没播完时点空白处不关');
      await app.idle(6000);
      await page.mouse.click(195, 470);
      await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 8000 });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('给司机看（桌面 1280）：大字、按钮在同一条居中的栏里，左边对齐', async () => {
  const app = await openKit({ device: 'desktop' });
  const { page } = app;
  try {
    await page.$eval(T('kit-driver-long'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('kit-driver-long'));
    await page.waitForSelector(T('driver-card'));
    await app.idle(6000);
    const r = await page.evaluate(() => {
      const b = (sel) => {
        const x = document.querySelector(sel).getBoundingClientRect();
        return { left: x.left, width: x.width };
      };
      return { text: b('.drv__main'), btns: b('.drv__actions'), close: b('.drv__close') };
    });
    assert.ok(Math.abs(r.text.left - r.btns.left) <= 1, `文字左边 ${r.text.left}、按钮左边 ${r.btns.left}`);
    assert.ok(Math.abs(r.text.width - r.btns.width) <= 1, `一样宽：${r.text.width} / ${r.btns.width}`);
    assert.ok(Math.abs(r.close.left - r.text.left) <= 1, '关闭按钮和文字左边对齐');
    await page.screenshot({ path: path.join(SHOTS, 'driver-desktop.png') });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 下车点（工程 P1-1，SPEC §10）：动作行、给司机看、地点详情占位
// ---------------------------------------------------------------------

test('下车点：园区里的餐厅叫 Grab 去大堂、导航仍到餐厅、说明行先写下车提示；只能坐缆车的岛「叫 Grab」变「去缆车站」；给司机看显示下车点和提示；地点详情标「大概位置」', async () => {
  const app = await openKit();
  const { page } = app;
  try {
    await page.$eval(T('kit-pa-via'), (el) => el.scrollIntoView({ block: 'center' }));
    const via = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="kit-pa-via"]');
      const href = (k) => root.querySelector(`[data-action="${k}"]`)?.getAttribute('href') || '';
      return { grab: decodeURIComponent(decodeURIComponent(href('grab'))), nav: decodeURIComponent(href('nav')), note: root.querySelector('.k-acts__note')?.textContent || '' };
    });
    assert.match(via.grab, /dropOffLatitude=8\.6902/, `叫车去大堂：${via.grab}`);
    assert.match(via.nav, /8\.6921,106\.6003/, '导航到餐厅本身');
    assert.match(via.note, /^在度假村大堂下车，园区里坐免费电瓶车过去/);
    const noroad = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="kit-pa-noroad"]');
      return { label: root.querySelector('[data-action="grab"]').textContent.trim(), note: root.querySelector('.k-acts__note')?.textContent || '' };
    });
    assert.equal(noroad.label, '去缆车站');
    assert.match(noroad.note, /开车到不了：在日出缆车站坐缆车过海/);
    await page.screenshot({ path: path.join(SHOTS, 'ride-via-actions.png'), clip: await page.$eval(T('kit-actions-via'), (el) => { const r = el.getBoundingClientRect(); return { x: 0, y: r.y - 8, width: 390, height: Math.min(560, r.height * 2 + 40) }; }) });
    // 给司机看：下车点的名字 + 提示
    await page.$eval(T('kit-driver-via'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('kit-driver-via'));
    await page.waitForSelector(T('driver-card'));
    await app.idle(6000);
    assert.equal(await page.$eval(T('driver-primary'), (el) => el.textContent), 'Sảnh Khu nghỉ dưỡng Rừng Dừa');
    assert.equal(await page.$eval(T('driver-note'), (el) => el.textContent), '在度假村大堂下车，园区里坐免费电瓶车过去');
    await page.screenshot({ path: path.join(SHOTS, 'ride-via-driver.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 搜索（动效 P1-6 收起第一帧、P1-7 Tab 进底栏 / Esc）
// ---------------------------------------------------------------------

test('搜索：开着时底栏不可交互（Tab 不会跳进被盖住的底栏）、焦点在结果层里按 Esc 也能收起；收起的第一帧顶栏还浮在遮罩上面', async () => {
  const app = await open({ device: 'desktop' });
  try {
    await ready(app);
    const { page } = app;
    await page.click(`${T('shell-search')} button`);
    await page.waitForFunction(() => location.hash.includes('sheet=search'));
    await page.waitForSelector(T('search-layer'));
    await app.idle();
    assert.equal(await page.$eval(T('shell-tabbar'), (el) => el.inert), true, '搜索开着时底栏 inert');
    await page.keyboard.type('海');
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="shell-tabbar"]'))), false, 'Tab 没进底栏');
    // 焦点放到结果层里（不在输入框里）再按 Esc
    await page.evaluate(() => document.querySelector('.search-layer__panel button, .search-layer__panel [tabindex]')?.focus());
    const lifted = await page.evaluate(() => new Promise((resolve) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      requestAnimationFrame(() => resolve(document.querySelector('[data-testid="shell-topbar"]').hasAttribute('data-lifted')));
    }));
    await page.waitForFunction(() => !location.hash.includes('sheet=search'), { timeout: 4000 });
    assert.equal(lifted, true, '收起的第一帧顶栏还浮在遮罩上面');
    await app.idle();
    await page.waitForFunction(() => !document.querySelector('[data-testid="shell-topbar"]').hasAttribute('data-lifted'), { timeout: 4000 });
    assert.equal(await page.$eval(T('shell-tabbar'), (el) => el.inert), false, '收起后底栏恢复');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 底栏（视觉 P2-2 ＋ 收回、动效 P2-8 衔接记一笔、P2-11「更多」换字、P2-13 键盘）
// ---------------------------------------------------------------------

test('＋ 面板：收回时不染回按钮的青绿（不会从底栏上沿冒出一块）；换成「记一笔」时底栏先在上层淡出再沉下去', async () => {
  const app = await open({ now: '2027-01-11T10:00:00+07:00' });
  try {
    await ready(app);
    const { page } = app;
    await page.click(T('shell-fab'));
    await page.waitForSelector(T('fab-panel'));
    await app.idle();
    // 收回半路：色层（按钮色）一直是透明的
    const mid = await captureAt(app, () => page.click(T('shell-fab')), {
      selector: '.fab-panel', progress: 0.6, evaluate: () => Number(getComputedStyle(document.querySelector('.ov-panel-tint')).opacity),
    });
    await page.screenshot({ path: path.join(SHOTS, 'fab-close-60.png'), clip: { x: 0, y: 500, width: 390, height: 344 } });
    await release(mid);
    assert.ok(mid.state < 0.05, `收回半路色层透明度 ${mid.state}`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="fab-panel"]'), { timeout: 6000 });
    await app.idle();
    // ＋ →「记一笔」：底栏先淡出（还在上层）
    await page.click(T('shell-fab'));
    await page.waitForSelector(T('fab-expense'));
    await app.idle();
    // 盯着底栏的属性：「记一笔」挂上那一刻底栏开始淡出（data-sinking），这时还在上层（data-lifted）
    await page.evaluate(() => {
      window.__sink = [];
      const bar = document.querySelector('[data-testid="shell-tabbar"]');
      new MutationObserver(() => window.__sink.push({ sinking: bar.hasAttribute('data-sinking'), lifted: bar.hasAttribute('data-lifted'), expense: Boolean(document.querySelector('[data-sheet-id="expense"]')) }))
        .observe(bar, { attributes: true, attributeFilter: ['data-sinking', 'data-lifted'] });
    });
    await page.click(T('fab-expense'));
    await page.waitForSelector(T('sheet-expense'));
    await app.idle();
    await page.waitForFunction(() => {
      const bar = document.querySelector('[data-testid="shell-tabbar"]');
      return !bar.hasAttribute('data-sinking') && !bar.hasAttribute('data-lifted');
    }, { timeout: 3000 });
    const log = await page.evaluate(() => window.__sink);
    const first = log.find((x) => x.sinking);
    assert.ok(first, `底栏有淡出那一段：${JSON.stringify(log)}`);
    assert.equal(first.lifted, true, '淡出时还在上层（不是一下子沉到遮罩下面变虚）');
    assert.equal(log[log.length - 1].sinking, false);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「更多」按钮的字跟着图标换：刚点下时「关闭」还没出来；＋ 按钮是 dialog 类型；切换面板打开时焦点在当前那趟，↑↓ 移动', async () => {
  const app = await open({ device: 'desktop' });
  try {
    await ready(app);
    const { page } = app;
    const at0 = await page.evaluate(() => new Promise((resolve) => {
      document.querySelector('[data-testid="tab-more"]').click();
      requestAnimationFrame(() => {
        const [more, close] = document.querySelectorAll('.tabbar__swap > i');
        resolve({ more: Number(getComputedStyle(more).opacity), close: Number(getComputedStyle(close).opacity) });
      });
    }));
    assert.ok(at0.close < 0.3, `刚点下「关闭」还没出来（${at0.close}）`);
    await page.waitForSelector(T('more-menu'));
    await app.idle();
    const end = await page.$$eval('.tabbar__swap > i', (els) => els.map((e) => Number(getComputedStyle(e).opacity)));
    assert.deepEqual(end, [0, 1]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.idle();
    assert.equal(await page.$eval(T('shell-fab'), (el) => el.getAttribute('aria-haspopup')), 'dialog');
    // 切换面板：键盘打开 → 焦点在当前行程；↓ 到下一趟
    await page.focus(T('shell-title'));
    await page.keyboard.press('Enter');
    await page.waitForSelector(T('switcher-panel'));
    await app.idle();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'switcher-trip-demo-island');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(() => document.activeElement?.dataset.testid), 'switcher-trip-demo-island');
    assert.match(await page.evaluate(() => document.activeElement?.dataset.testid || ''), /^switcher-trip-/);
    await page.keyboard.press('Escape');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 「更多」一屏放下（视觉 P1-6）、演示角标不挡东西（三份评审）、深色强调色（视觉 P1-3）
// ---------------------------------------------------------------------

test('「更多」菜单（390×844）：四行瓷砖、外观和签名一屏放下，签名在底栏上面', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await open({ hash: '#/t/demo-island?sheet=menu', colorScheme });
    try {
      const { page } = app;
      await page.waitForSelector('.more-sign');
      await app.idle();
      const r = await page.evaluate(() => {
        const b = (el) => el.getBoundingClientRect();
        const tiles = [...document.querySelectorAll('.more-tile')].map(b);
        return {
          sign: b(document.querySelector('.more-sign')).bottom,
          theme: b(document.querySelector('.more-theme')).bottom,
          tabbar: b(document.querySelector('[data-testid="shell-tabbar"]')).top,
          rows: new Set(tiles.map((t) => Math.round(t.top))).size,
          tiles: tiles.length,
          scroll: document.querySelector('.ov-fsmenu__scroll').scrollTop,
        };
      });
      assert.equal(r.tiles, 8);
      assert.equal(r.rows, 4, '两列四行');
      assert.ok(r.sign <= r.tabbar - 8, `签名底边 ${r.sign} 在底栏上沿 ${r.tabbar} 上面`);
      assert.equal(r.scroll, 0);
      await page.screenshot({ path: path.join(SHOTS, `menu-${colorScheme}.png`) });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('演示角标：页面最上面才显示；往下滚、打开弹层、同步条出现时藏起来（不压分段条、不抢点击）', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const hidden = () => page.$eval(T('demo-badge'), (el) => el.hasAttribute('data-hidden'));
    assert.equal(await hidden(), false, '最上面显示');
    await page.evaluate(() => window.scrollTo(0, 60));
    await page.waitForFunction(() => document.querySelector('[data-testid="demo-badge"]').hasAttribute('data-hidden'), { timeout: 3000 });
    // 点分段条 D4 的中心：拿到的是 D4，不是角标
    const hit = await page.$eval(T('day-strip-2027-01-13'), (el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid]')?.dataset.testid;
    });
    assert.equal(hit, 'day-strip-2027-01-13');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector('[data-testid="demo-badge"]').hasAttribute('data-hidden'), { timeout: 3000 });
    await page.click(T('shell-fab'));
    await page.waitForSelector(T('fab-panel'));
    assert.equal(await hidden(), true, '弹层开着时藏起来');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('演示角标：没有副标题的页面（行程列表、设置）挪到大标题那一行、右上按钮左边，不压第一张卡片；有副标题的页面还在副标题右端', async () => {
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [hash, title, button] of [['#/trips', '全部行程', T('shell-settings')], ['#/settings', '设置', null], ['#/t/demo-island', '椰影岛', null]]) {
    const app = await open({ hash });
    try {
      const { page } = app;
      await ready(app, title);
      await page.waitForFunction(() => document.querySelector('[data-testid="demo-badge"]')?.getBoundingClientRect().width > 0);
      await app.idle();
      const badge = await rect(page, T('demo-badge'));
      assert.equal(await page.$eval(T('demo-badge'), (el) => el.hasAttribute('data-hidden')), false, `${hash} 角标显示`);
      const first = await page.$eval('[data-shell-page] .k-card, [data-shell-page] section, [data-shell-strip]', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      assert.ok(!overlaps(badge, first), `${hash} 角标不压页面内容 / 分段条：${JSON.stringify({ badge, first })}`);
      const titleBox = await page.$eval('[data-shell-head] .shell-head__h1', (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      assert.ok(!overlaps(badge, titleBox), `${hash} 角标不压大标题`);
      if (button) assert.ok(!overlaps(badge, await rect(page, button)), `${hash} 角标不压右上按钮`);
      const slot = await page.$eval(T('demo-badge'), (el) => el.dataset.slot || 'sub');
      assert.equal(slot, hash.startsWith('#/t/') ? 'sub' : 'title-row', `${hash} 放的位置`);
      await page.screenshot({ path: path.join(SHOTS, `demo-badge-${hash.replace(/[#/]+/g, '-').replace(/^-|-$/g, '')}.png`) });
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('键盘 Tab 顺序：顶栏（搜索）在页面内容前面，底栏在页面内容后面', async () => {
  const app = await open({ device: 'desktop' });
  try {
    await ready(app);
    const { page } = app;
    const order = await page.evaluate(() => {
      const main = document.getElementById('main');
      const pos = (sel) => main.compareDocumentPosition(document.querySelector(sel));
      return { top: Boolean(pos('[data-testid="shell-topbar"]') & Node.DOCUMENT_POSITION_PRECEDING), bottom: Boolean(pos('[data-testid="shell-tabbar"]') & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    assert.deepEqual(order, { top: true, bottom: true });
    // 从页面开头按 Tab：先到顶栏里的按钮，再进页面内容
    await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body';
        if (el.closest('[data-testid="shell-topbar"]')) return 'topbar';
        if (el.closest('#main')) return 'main';
        if (el.closest('[data-testid="shell-tabbar"]')) return 'tabbar';
        return 'other';
      }));
    }
    const firstTop = seen.indexOf('topbar');
    const firstMain = seen.indexOf('main');
    assert.ok(firstTop >= 0 && (firstMain === -1 || firstTop < firstMain), `顶栏先于页面内容：${seen.join(' → ')}`);
    assert.ok(!seen.slice(0, Math.max(firstMain, 0)).includes('tabbar'), `底栏不在页面内容前面：${seen.join(' → ')}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('看不见的玻璃不开背景模糊：页面最上面、＋ 面板开着、搜索开着时，透明度 0 却还在画的 backdrop-filter 层一个都没有', async () => {
  for (const hash of ['#/t/demo-island', '#/t/demo-island?sheet=fab', '#/t/demo-island?sheet=search']) {
    const app = await open({ hash });
    try {
      const { page } = app;
      await ready(app);
      await app.idle();
      const r = await page.evaluate(() => {
        // 透明度连乘到祖先；visibility: hidden / display: none 的本来就不画，不算
        const shown = (el) => {
          if (getComputedStyle(el).visibility === 'hidden') return null;
          let o = 1;
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none') return null;
            o *= Number(cs.opacity);
          }
          return o;
        };
        const glass = [...document.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el);
          return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
        });
        const wasted = glass.filter((el) => { const o = shown(el); return o !== null && o < 0.01; });
        return { total: glass.length, wasted: wasted.map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`) };
      });
      assert.deepEqual(r.wasted, [], `${hash}：${JSON.stringify(r)}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
