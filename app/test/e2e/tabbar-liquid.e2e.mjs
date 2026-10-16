// 底栏（src/shell/TabBar.jsx + tabbar.css + tabbar-motion.js，手感照 iOS 26 Apple Music；外观是「杂志纸本」的纸片，SPEC §11）：
// 不透明的纸片（不用玻璃、底栏里没有 backdrop-filter）、选中块弹簧滑过去时沿运动方向拉长（半路截图 20% / 50% / 80%）、从 ＋ 后面穿过时变淡、
// 真人轻点（按 40 / 90ms）不过冲、不出底栏、按下透镜浮起放大、长按松手照样切（iOS 长按后不发 click）、tab 不能被拖走、
// 按住拖动选择（跟手、高亮、换格迟滞不抖、松手切过去、滑出取消、不停在 ＋ 上）、新页面代码慢时颜色不先回旧格、
// 键盘 ← → / Home / End、滚动收小再展开（和顶栏、键盘弹起兼容；收小时打开 ＋ 面板从展开后的按钮长出来）、
// 减弱动态效果、触控区、无横向溢出、文字对比度实测（最亮 / 最暗 / 最花的背景垫在滚动边缘层下面和上面、平时和按住，浅色 / 深色）、4 倍降速帧间隔。
// 演示数据（demo-island / demo-cities / demo-empty），不连外网。
//
// 截图：<截图根目录>/__shots__/tabbar-liquid/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, shotsDir } from './lib/harness.mjs';
import { captureAt, release } from './lib/motion-shots.mjs';
import { measureTextContrast, backdropUnderTabbar } from './lib/contrast.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const SHOTS = shotsDir('tabbar-liquid');
mkdirSync(SHOTS, { recursive: true });
const T = (id) => `[data-testid="${id}"]`;
const BAR = T('shell-tabbar');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function ready(app) {
  await app.page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"][data-shown]') && document.querySelector('.shell-head__name, .shell-head__title')?.textContent, { timeout: 15000 });
  await app.page.evaluate(() => document.fonts.ready);
  await app.idle();
}

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  let i = 0;
  const f = () => (++i >= k ? r() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);

/** 底栏这一块（视口坐标，上下多留一点给浮起的透镜） */
async function barClip(page, pad = 14) {
  return page.$eval('[data-testid="shell-tabbar"]', (el, p) => {
    const r = el.getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.top - p), width: document.documentElement.clientWidth, height: Math.min(innerHeight - Math.max(0, r.top - p), r.height + p * 2) };
  }, pad);
}

/** 截底栏（不动滚动位置） */
async function shotBar(page, name) {
  const clip = await barClip(page, 22);
  const y = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: { ...clip, y: clip.y + y }, captureBeyondViewport: false });
}

/** 选中块此刻在第几格（小数）、它的拉伸、按下的放大 */
function lensState(page) {
  return page.evaluate(() => {
    const slots = [...document.querySelectorAll('.tabbar__row [data-slot]')].map((el) => {
      const r = el.getBoundingClientRect();
      return (r.left + r.right) / 2;
    });
    const ind = document.querySelector('.tabbar__ind');
    const lens = document.querySelector('.tabbar__lens');
    const r = ind.getBoundingClientRect();
    const pitch = (slots[4] - slots[0]) / 4;
    const m = new DOMMatrixReadOnly(getComputedStyle(ind).transform === 'none' ? undefined : getComputedStyle(ind).transform);
    const sc = getComputedStyle(lens).scale;
    const [lx, ly = lx] = sc === 'none' ? [1, 1] : sc.split(' ').map(Number);
    const lr = lens.getBoundingClientRect();
    const bar = document.querySelector('[data-testid="shell-tabbar"]').getBoundingClientRect();
    return {
      lensLeft: lr.left,
      lensRight: lr.right,
      barLeft: bar.left,
      barRight: bar.right,
      slot: ((r.left + r.right) / 2 - slots[0]) / pitch,
      sx: Math.hypot(m.a, m.b),
      sy: Math.hypot(m.c, m.d),
      liftX: lx,
      liftY: ly,
      lensTop: lr.top,
      lensBottom: lr.bottom,
      barTop: bar.top,
      barBottom: bar.bottom,
      opacity: Number(getComputedStyle(ind).opacity),
      up: document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-lens-up'),
      dragging: document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-dragging'),
      hover: [...document.querySelectorAll('.tabbar__tab[data-hover]')].map((t) => t.dataset.tab),
      mags: Object.fromEntries([...document.querySelectorAll('.tabbar__tab')].map((t) => [t.dataset.tab, getComputedStyle(t.firstElementChild).scale])),
    };
  });
}

/** 各格中心（视口坐标） */
function slotCenters(page) {
  return page.$$eval('.tabbar__row [data-slot]', (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  }));
}

/** 记下触感（haptic 在网页上走 navigator.vibrate） */
async function recordHaptics(page) {
  await page.evaluate(() => {
    window.__haptics = 0;
    navigator.vibrate = () => {
      window.__haptics += 1;
      return true;
    };
  });
}

/** 手指从 a 平滑移到 b（每步之间等一帧） */
async function slide(page, a, b, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await frames(page, 1);
  }
}

test('纸片（「杂志纸本」，SPEC §11）：不透明的纸 + 细线框 + 很浅的悬浮阴影，不用玻璃（没有模糊、折射边）；底栏里一层 backdrop-filter 都没有，同屏总数 ≤8；深色对应一套', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await open({ colorScheme });
    try {
      await ready(app);
      const { page } = app;
      const g = await page.$eval('.tabbar__glass', (el) => {
        const s = getComputedStyle(el);
        const rim = getComputedStyle(el, '::before');
        const canvas = getComputedStyle(document.documentElement).backgroundColor;
        return { filter: s.backdropFilter || s.webkitBackdropFilter || 'none', bg: s.backgroundImage, edge: s.boxShadow, rim: rim.content === 'none' ? 'none' : rim.backgroundImage, canvas, shadow: getComputedStyle(el.parentElement.querySelector('.tabbar__shadow')).boxShadow };
      });
      assert.equal(g.filter, 'none', '不用玻璃：没有背景模糊');
      const paper = /^linear-gradient\((rgba?\([^)]*\)), (rgba?\([^)]*\))\)$/.exec(g.bg);
      assert.ok(paper && paper[1] === paper[2], `纸是纯色（两端同色、没有渐变）：${g.bg}`);
      assert.ok(!/rgba\([^)]*, 0?\.\d+\)/.test(paper[1]), `纸是不透明的：${paper[1]}`);
      assert.notEqual(paper[1], g.canvas, '纸片比页面的纸亮一点（分得出来）');
      assert.match(g.edge, /inset/, '一根细线框');
      assert.equal(g.rim, 'none', '没有折射边');
      assert.notEqual(g.shadow, 'none', '很浅的悬浮阴影');
      // 底栏里一层 backdrop-filter 都没有（纸、选中块、＋）
      const inBar = await page.$$eval(`${BAR} *`, (els) => els.filter((el) => {
        const s = getComputedStyle(el);
        const f = s.backdropFilter || s.webkitBackdropFilter;
        return f && f !== 'none';
      }).map((el) => el.className));
      assert.deepEqual(inBar, []);
      const all = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
        const s = getComputedStyle(el);
        const f = s.backdropFilter || s.webkitBackdropFilter;
        if (!f || f === 'none' || Number(s.opacity) === 0 || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight;
      }).length);
      assert.ok(all <= 8, `同屏真玻璃 ${all} 个`);
      await page.screenshot({ path: path.join(SHOTS, `screen-${colorScheme}.png`) });
      await shotBar(page, `bar-${colorScheme}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('轻点切换：选中块弹簧滑过去，半路沿运动方向拉长、竖向略扁（20% / 50% / 80% 截图），停下前过冲回弹一点，最后正好停在账本上', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    assert.ok(Math.abs((await lensState(page)).slot) < 0.02);
    const cap = await captureAt(app, () => page.click(T('tab-ledger')), { selector: '.tabbar__ind', progress: 0.2, evaluate: () => null });
    const seek = async (p) => {
      const main = cap.animations.reduce((x, y) => (y.duration + y.delay > x.duration + x.delay ? y : x));
      await cap.cdp.send('Animation.seekAnimations', { animations: cap.animations.map((a) => a.id), currentTime: main.delay + main.duration * p });
      await frames(page, 2);
      return lensState(page);
    };
    const samples = {};
    try {
      for (const p of [0.2, 0.5, 0.8]) {
        samples[p] = await seek(p);
        await shotBar(page, `switch-${Math.round(p * 100)}`);
      }
      // 找过冲：后半段任一时刻越过账本那一格
      let peak = 0;
      for (const p of [0.25, 0.3, 0.35, 0.4, 0.45, 0.55, 0.6, 0.7]) peak = Math.max(peak, (await seek(p)).slot);
      samples.peak = peak;
      // 从 ＋ 后面穿过：最靠近第 2 格的那一刻变淡（不在 ＋ 周围露出一圈白边）
      let nearPlus = null;
      for (let p = 0.02; p <= 0.3; p += 0.02) {
        const st = await seek(p);
        if (!nearPlus || Math.abs(st.slot - 2) < Math.abs(nearPlus.slot - 2)) nearPlus = st;
      }
      samples.nearPlus = nearPlus;
    } finally {
      await release(cap);
    }
    console.log(`切 tab 半路：${[0.2, 0.5, 0.8].map((p) => `${p * 100}% 第 ${samples[p].slot.toFixed(2)} 格 拉长 ${samples[p].sx.toFixed(3)} 压扁 ${samples[p].sy.toFixed(3)}`).join('；')}；最远 ${samples.peak.toFixed(3)} 格`);
    assert.ok(samples[0.2].slot > 0.3 && samples[0.2].slot < 3, `20% 时在半路：${samples[0.2].slot}`);
    assert.ok(samples[0.2].sx > 1.08, `移动中拉长：${samples[0.2].sx}`);
    assert.ok(samples[0.2].sy < 0.98, `竖向略扁：${samples[0.2].sy}`);
    assert.ok(samples[0.5].slot > samples[0.2].slot, '一直往前走');
    assert.ok(samples.peak > 3.02 && samples.peak < 3.06, `停下前过冲一点点（跨三格回弹调小，最多 0.05 格）：${samples.peak}`);
    assert.ok(Math.abs(samples.nearPlus.slot - 2) < 0.15 && samples.nearPlus.opacity < 0.65, `从 ＋ 后面穿过时变淡：第 ${samples.nearPlus.slot.toFixed(2)} 格不透明度 ${samples.nearPlus.opacity}`);
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await app.idle();
    const end = await lensState(page);
    assert.ok(Math.abs(end.slot - 3) < 0.01, `停在账本：${end.slot}`);
    assert.ok(Math.abs(end.sx - 1) < 0.001 && Math.abs(end.sy - 1) < 0.001, '停下后不再拉伸');
    assert.equal(end.opacity, 1, '停下后不透明');
    assert.equal(await page.$eval(T('tab-ledger'), (el) => el.getAttribute('aria-current')), 'page');
    await shotBar(page, 'switch-end');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('按下：选中块像透镜一样等比浮起放大 1.15（上下超出底栏一点），手指下的图标放大；松手回弹；轻点仍是普通切换', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await open({ colorScheme });
    try {
      await ready(app);
      const { page } = app;
      await recordHaptics(page);
      const c = await slotCenters(page);
      await page.touchscreen.touchStart(c[1].x, c[1].y);
      await wait(450);
      const held = await lensState(page);
      await shotBar(page, `press-${colorScheme}`);
      assert.equal(held.up, true, '透镜浮起');
      assert.ok(Math.abs(held.liftX - 1.15) < 0.01 && Math.abs(held.liftY - 1.15) < 0.01, `放大 ${held.liftX} × ${held.liftY}`);
      assert.ok(held.lensTop < held.barTop && held.lensBottom > held.barBottom, `竖向超出底栏：透镜 ${held.lensTop}–${held.lensBottom}，底栏 ${held.barTop}–${held.barBottom}`);
      assert.ok(Math.abs(held.slot - 1) < 0.05, `透镜到了手指下（地图）：${held.slot}`);
      assert.ok(Number(held.mags.map) > 1.1, `透镜下的图标放大：${held.mags.map}`);
      assert.deepEqual(held.hover, ['map'], '手指下那格高亮');
      await page.touchscreen.touchEnd();
      await page.waitForFunction(() => location.hash === '#/t/demo-island/map');
      await app.idle();
      const end = await lensState(page);
      assert.equal(end.up, false);
      assert.ok(end.liftX === 1 && end.liftY === 1, '松手回到原大');
      assert.ok(Math.abs(end.slot - 1) < 0.01);
      assert.equal(end.mags.map, 'none', '图标回到原大（不留内联样式）');
      assert.ok(await page.evaluate(() => window.__haptics) >= 1, '切过去有触感');
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('真人轻点（按住 0 / 40 / 90ms 再松）：选中块按下就出发、松手不重启，过冲和点 0ms 一样小（≤ 0.06 格）；任何一帧都不出底栏左右两边', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    // 先把三个页面都走一遍（代码下载好了，量的是选中块本身）
    for (const h of ['/map', '/ledger', '']) await app.go(`#/t/demo-island${h}`);
    const rows = [];
    for (const hold of [0, 40, 90]) {
      for (const [from, to] of [[0, 1], [0, 3], [3, 0]]) {
        await app.go(`#/t/demo-island${['', '/map', '', '/ledger'][from]}`);
        await app.idle();
        const c = await slotCenters(page);
        await page.evaluate(() => {
          window.__lt = [];
          window.__ltOn = true;
          const slots = [...document.querySelectorAll('.tabbar__row [data-slot]')].map((el) => {
            const r = el.getBoundingClientRect();
            return (r.left + r.right) / 2;
          });
          const pitch = (slots[4] - slots[0]) / 4;
          const tick = () => {
            if (!window.__ltOn) return;
            const ind = document.querySelector('.tabbar__ind').getBoundingClientRect();
            const lens = document.querySelector('.tabbar__lens').getBoundingClientRect();
            const bar = document.querySelector('[data-testid="shell-tabbar"]').getBoundingClientRect();
            window.__lt.push({ slot: ((ind.left + ind.right) / 2 - slots[0]) / pitch, out: Math.max(bar.left - lens.left, lens.right - bar.right) });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await page.touchscreen.touchStart(c[to].x, c[to].y);
        if (hold) await wait(hold);
        await page.touchscreen.touchEnd();
        await wait(1000);
        const tr = await page.evaluate(() => {
          window.__ltOn = false;
          return window.__lt;
        });
        const dir = Math.sign(to - from);
        const over = Math.max(...tr.map((f) => (f.slot - to) * dir));
        const out = Math.max(...tr.map((f) => f.out));
        rows.push({ hold, from, to, over, out });
        await app.idle();
        assert.equal(await page.evaluate(() => document.querySelector('.tabbar__tab[aria-current="page"]')?.dataset.tab), ['trip', 'map', 'fab', 'ledger'][to], '切过去了');
      }
    }
    console.log(`轻点过冲：${rows.map((r) => `按 ${r.hold}ms ${r.from}→${r.to} 过冲 ${r.over.toFixed(3)} 格、离底栏边 ${(-r.out).toFixed(1)}px`).join('；')}`);
    for (const r of rows) {
      assert.ok(r.over < 0.06, `按 ${r.hold}ms ${r.from}→${r.to}：过冲 ${r.over.toFixed(3)} 格`);
      assert.ok(r.out <= 0, `按 ${r.hold}ms ${r.from}→${r.to}：选中块出了底栏 ${r.out.toFixed(1)}px`);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('长按松手照样切（iOS 长按以后不发 click：这里把浏览器自己的 click 全拦掉来模拟）；tab 不能被拖走（draggable=false、-webkit-user-drag: none、dragstart 被取消）', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const drag = await page.$$eval('.tabbar__tab', (els) => els.map((el) => ({
      tab: el.dataset.tab,
      tag: el.tagName,
      draggable: el.draggable,
      userDrag: getComputedStyle(el).webkitUserDrag,
    })));
    for (const d of drag) {
      assert.equal(d.userDrag, 'none', `${d.tab}：-webkit-user-drag`);
      if (d.tag === 'A') assert.equal(d.draggable, false, `${d.tab}：draggable`);
    }
    const prevented = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="tab-map"]');
      const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, true, 'dragstart 被取消');
    // 浏览器自己发的 click（isTrusted）全拦掉：切页只能靠松手那一刻
    await page.evaluate(() => {
      window.__trustedClicks = 0;
      window.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        window.__trustedClicks += 1;
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
    });
    const c = await slotCenters(page);
    await page.touchscreen.touchStart(c[1].x, c[1].y);
    await wait(1000);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/map', { timeout: 3000 });
    await app.idle();
    // 按 750ms 再拖到账本、松手
    const c2 = await slotCenters(page);
    await page.touchscreen.touchStart(c2[1].x, c2[1].y);
    await wait(750);
    await slide(page, c2[1], c2[3], 10);
    await wait(150);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger', { timeout: 3000 });
    await app.idle();
    // 键盘回车、读屏激活派发的 click 仍走 go（这里用 element.click()，它不是 isTrusted，不会被上面的拦截挡掉）
    const before = await page.evaluate(() => history.length);
    await page.evaluate(() => document.querySelector('[data-testid="tab-trip"]').click());
    await page.waitForFunction(() => location.hash === '#/t/demo-island');
    assert.ok(await page.evaluate(() => history.length) > before);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('一次轻点只切一次：松手直接切以后，浏览器随后的原生 click 被拦下（历史只多一条）；点当前那格回到顶部', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const len0 = await page.evaluate(() => history.length);
    // 点当前那格（行程）：回到顶部，不切页、不加历史
    await page.evaluate(() => window.scrollTo(0, 500));
    await frames(page, 3);
    let c = await slotCenters(page);
    await page.touchscreen.touchStart(c[0].x, c[0].y);
    await wait(50);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => window.scrollY === 0, { timeout: 3000 });
    assert.equal(await page.evaluate(() => history.length), len0, '点当前那格不加历史');
    // 触屏轻点账本
    await app.idle();
    c = await slotCenters(page);
    await page.touchscreen.touchStart(c[3].x, c[3].y);
    await wait(60);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await wait(400);
    await app.idle();
    assert.equal(await page.evaluate(() => history.length) - len0, 1, '历史只多一条');
    // 鼠标点（桌面）也一样
    await page.click(T('tab-map'));
    await page.waitForFunction(() => location.hash === '#/t/demo-island/map');
    await wait(400);
    await app.idle();
    assert.equal(await page.evaluate(() => history.length) - len0, 2, '鼠标点也只切一次');
    // 返回：回到账本（只有一条账本记录）
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/t/demo-island');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('拖到两格中线停住、手指 ±0.6px 抖 30 帧：高亮最多换一次、触感最多一次（换格有迟滞）', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    await recordHaptics(page);
    await page.evaluate(() => {
      window.__flips = 0;
      new MutationObserver((ms) => {
        for (const m of ms) if (m.target.hasAttribute('data-hover')) window.__flips += 1;
      }).observe(document.querySelector('.tabbar__row'), { subtree: true, attributes: true, attributeFilter: ['data-hover'] });
    });
    const c = await slotCenters(page);
    const pitch = (c[4].x - c[0].x) / 4;
    for (const frac of [0.5, 0.42, 0.58]) {
      const x = c[0].x + pitch * frac;
      await page.touchscreen.touchStart(c[0].x, c[0].y);
      await slide(page, c[0], { x, y: c[0].y }, 8);
      await wait(150);
      await page.evaluate(() => {
        window.__flips = 0;
        window.__haptics = 0;
      });
      for (let k = 0; k < 30; k++) {
        await page.touchscreen.touchMove(x + (k % 2 ? 0.6 : -0.6), c[0].y);
        await frames(page, 1);
      }
      const r = await page.evaluate(() => ({ flips: window.__flips, haptics: window.__haptics }));
      assert.ok(r.flips <= 1, `停在 ${frac} 格处抖：高亮换了 ${r.flips} 次`);
      assert.ok(r.haptics <= 1, `停在 ${frac} 格处抖：触感 ${r.haptics} 次`);
      await page.touchscreen.touchMove(x, c[0].y - 200);
      await wait(80);
      await page.touchscreen.touchEnd();
      await wait(500);
      await app.idle();
    }
    assert.equal(await page.evaluate(() => location.hash), '#/t/demo-island', '滑出去松手：没切页');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('新页面的代码还在下载（网络慢 400ms）：松手后颜色跟着选中块到新那格，旧那格不会再亮回来', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.evaluate(() => {
        const nav = document.querySelector('[data-testid="shell-tabbar"]');
        const p = document.createElement('span');
        p.style.color = 'var(--color-tabbar-accent)';
        nav.append(p);
        const accent = getComputedStyle(p).color;
        p.remove();
        window.__acc = [];
        window.__accOn = true;
        const tick = () => {
          if (!window.__accOn) return;
          const lit = [...document.querySelectorAll('.tabbar__tab')].filter((t) => getComputedStyle(t).color === accent).map((t) => t.dataset.tab).join(',');
          const cur = document.querySelector('.tabbar__tab[aria-current="page"]')?.dataset.tab || '';
          const last = window.__acc[window.__acc.length - 1];
          if (!last || last.lit !== lit || last.cur !== cur) window.__acc.push({ t: Math.round(performance.now()), lit, cur });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const c = await slotCenters(page);
      await page.touchscreen.touchStart(c[3].x, c[3].y);
      await wait(70);
      await page.touchscreen.touchEnd();
      const mid = await page.evaluate(() => ({ pending: document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-pending'), cur: document.querySelector('.tabbar__tab[aria-current="page"]')?.dataset.tab }));
      await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger' && document.querySelector('.tabbar__tab[aria-current="page"]')?.dataset.tab === 'ledger', { timeout: 8000 });
      await app.idle();
      const seq = await page.evaluate(() => {
        window.__accOn = false;
        return window.__acc;
      });
      console.log(`网络慢时颜色的变化：${seq.map((x) => `[亮 ${x.lit || '无'} / 当前 ${x.cur}]`).join(' → ')}`);
      assert.equal(mid.cur, 'trip', '松手那一刻新页面还没到（不然这个测试没意义）');
      assert.equal(mid.pending, true, '等待中');
      const firstLedger = seq.findIndex((x) => x.lit === 'ledger');
      assert.ok(firstLedger > 0, '账本亮了');
      assert.ok(seq.slice(firstLedger).every((x) => x.lit === 'ledger'), `账本亮了以后不再变：${JSON.stringify(seq.slice(firstLedger))}`);
      assert.ok(seq.every((x) => x.lit.split(',').filter(Boolean).length <= 1), '任何时候最多亮一格');
      assert.equal(await page.$eval(BAR, (el) => el.hasAttribute('data-pending')), false, '到了以后撤掉等待');
      assert.equal(await page.$$eval('[data-pending-tab]', (els) => els.length), 0);
    } finally {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('按住拖动：选中块跟着手指走（半路截图）、经过的格子高亮并轻触感；松手停在最近的格子并切过去；松在 ＋ 上不停在 ＋', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    await recordHaptics(page);
    let c = await slotCenters(page);
    await page.touchscreen.touchStart(c[0].x, c[0].y);
    await slide(page, c[0], { x: (c[1].x + c[2].x) / 2 - 6, y: c[0].y }, 8);
    await wait(60);
    const mid = await lensState(page);
    await shotBar(page, 'drag-mid');
    assert.equal(mid.dragging, true, '在拖');
    assert.ok(mid.slot > 0.8 && mid.slot < 1.6, `跟着手指：${mid.slot}`);
    assert.deepEqual(mid.hover, ['map'], '经过的格子高亮');
    await slide(page, { x: (c[1].x + c[2].x) / 2 - 6, y: c[0].y }, c[3], 8);
    await wait(250);
    const over = await lensState(page);
    assert.deepEqual(over.hover, ['ledger']);
    assert.ok(Math.abs(over.slot - 3) < 0.08, `停在手指下：${over.slot}`);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await app.idle();
    const end = await lensState(page);
    assert.ok(Math.abs(end.slot - 3) < 0.01);
    assert.equal(end.dragging, false);
    assert.deepEqual(end.hover, []);
    assert.ok(await page.evaluate(() => window.__haptics) >= 3, `换格和松手都有触感：${await page.evaluate(() => window.__haptics)}`);
    // 往左拖、停在 ＋ 正中松手：＋ 不参与拖动选择，高亮还在账本（没过 ＋ 正中 0.12 格）→ 松手回到账本、不切页
    c = await slotCenters(page);
    await page.touchscreen.touchStart(c[3].x, c[3].y);
    await slide(page, c[3], c[2], 8);
    await wait(120);
    assert.deepEqual((await lensState(page)).hover, ['ledger'], '停在 ＋ 正中：高亮的还是账本');
    await page.touchscreen.touchEnd();
    await wait(700);
    await app.idle();
    assert.equal(await page.evaluate(() => location.hash), '#/t/demo-island/ledger', '松手停在高亮的那格（账本）');
    assert.ok(Math.abs((await lensState(page)).slot - 3) < 0.01, '选中块回到账本');
    // 再往左过了 ＋ 正中一点（0.2 格）松手：停在「地图」
    await page.touchscreen.touchStart(c[3].x, c[3].y);
    const pitch = (c[4].x - c[0].x) / 4;
    await slide(page, c[3], { x: c[2].x - pitch * 0.2, y: c[3].y }, 8);
    await wait(120);
    assert.deepEqual((await lensState(page)).hover, ['map']);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/map');
    await app.idle();
    assert.ok(Math.abs((await lensState(page)).slot - 1) < 0.01, '停在地图');
    // 拖到最右（「更多」不是一页）：橡皮筋收住，松手停在账本
    c = await slotCenters(page);
    await page.touchscreen.touchStart(c[1].x, c[1].y);
    await slide(page, c[1], { x: c[4].x + 10, y: c[4].y }, 10);
    await wait(250);
    const rubber = await lensState(page);
    assert.ok(rubber.slot > 3 && rubber.slot < 3.5, `过了账本被橡皮筋收住：${rubber.slot}`);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await app.idle();
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-sheet-id="menu"]'))), false, '没有打开「更多」菜单');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('滑出取消：拖到账本后手指滑出底栏外松手 → 不切页、选中块回到原来那格；按下后直接往上滑走也不算点击', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const before = await page.evaluate(() => location.hash);
    const c = await slotCenters(page);
    await page.touchscreen.touchStart(c[0].x, c[0].y);
    await slide(page, c[0], c[3], 10);
    await wait(150);
    await slide(page, c[3], { x: c[3].x, y: c[3].y - 160 }, 6);
    await wait(400);
    const out = await lensState(page);
    await shotBar(page, 'drag-out');
    assert.equal(out.up, false, '滑出去透镜落下');
    assert.deepEqual(out.hover, [], '滑出去不高亮');
    assert.ok(Math.abs(out.slot) < 0.1, `滑出去选中块回到原来那格：${out.slot}`);
    await page.touchscreen.touchEnd();
    await wait(300);
    await app.idle();
    assert.equal(await page.evaluate(() => location.hash), before, '没有切页');
    assert.ok(Math.abs((await lensState(page)).slot) < 0.01);
    // 按在地图上、直接往上滑出去松手：不切页
    await page.touchscreen.touchStart(c[1].x, c[1].y);
    await wait(80);
    await slide(page, c[1], { x: c[1].x, y: c[1].y - 140 }, 6);
    await page.touchscreen.touchEnd();
    await wait(400);
    await app.idle();
    assert.equal(await page.evaluate(() => location.hash), before);
    assert.ok(Math.abs((await lensState(page)).slot) < 0.01, '回到行程');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('键盘：Tab 进底栏后 ← → 在五个按钮间移动焦点、Home / End、回车切换；焦点环、aria-current、主导航都在；焦点在底栏里时收小的底栏展开', async () => {
  const app = await open({ device: 'desktop' });
  try {
    await ready(app);
    const { page } = app;
    assert.equal(await page.$eval(BAR, (el) => el.tagName + el.getAttribute('aria-label')), 'NAV主导航');
    await page.focus(T('tab-trip'));
    const active = () => page.evaluate(() => document.activeElement?.dataset?.testid);
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'tab-map');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', '键盘焦点有焦点环');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'shell-fab');
    await page.keyboard.press('End');
    assert.equal(await active(), 'tab-more');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'tab-more', '到头不绕回');
    await page.keyboard.press('Home');
    assert.equal(await active(), 'tab-trip');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'tab-ledger');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/t/demo-island/ledger');
    await app.idle();
    assert.equal(await page.$eval(T('tab-ledger'), (el) => el.getAttribute('aria-current')), 'page');
    assert.ok(Math.abs((await lensState(page)).slot - 3) < 0.01, '选中块跟着键盘切换走');
    app.assertClean();
  } finally {
    await app.close();
  }
  // 收小以后键盘 Tab 进来：展开（标签看得见）
  const m = await open();
  try {
    await ready(m);
    const { page } = m;
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
    await m.idle();
    await page.focus(T('tab-map'));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
    m.assertClean();
  } finally {
    await m.close();
  }
});

test('滚动收小：往下滚收成更矮更窄的胶囊（半路截图形状在两者之间）、标签淡出只留图标、＋ 跟着缩小；往上滚一点弹回、回到顶部完整；和顶栏收起、键盘弹起藏底栏兼容', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const app = await open({ colorScheme });
    try {
      await ready(app);
      const { page } = app;
      const read = () => page.evaluate(() => {
        const bar = document.querySelector('[data-testid="shell-tabbar"]');
        const r = bar.getBoundingClientRect();
        const fab = document.querySelector('[data-testid="shell-fab"]').getBoundingClientRect();
        return {
          compact: bar.hasAttribute('data-compact'),
          w: r.width,
          h: r.height,
          bottom: r.bottom,
          fab: fab.width,
          label: Number(getComputedStyle(document.querySelector('.tabbar__label')).opacity),
          topbar: document.querySelector('[data-testid="shell-topbar"]').dataset.state,
        };
      });
      const full = await read();
      const cap = await captureAt(app, () => page.evaluate(() => window.scrollTo(0, 620)), { selector: '.tabbar', progress: 0.35, evaluate: () => null });
      let mid;
      try {
        mid = await read();
        await shotBar(page, `compact-mid-${colorScheme}`);
      } finally {
        await release(cap);
      }
      await app.idle();
      const small = await read();
      await shotBar(page, `compact-${colorScheme}`);
      if (colorScheme === 'light') await page.screenshot({ path: path.join(SHOTS, 'compact-screen-light.png') });
      console.log(`收小（${colorScheme}）：完整 ${full.w.toFixed(0)}×${full.h.toFixed(0)}，半路 ${mid.w.toFixed(1)}×${mid.h.toFixed(1)}，收小 ${small.w.toFixed(1)}×${small.h.toFixed(1)}，＋ ${full.fab}→${small.fab.toFixed(1)}`);
      assert.equal(small.compact, true);
      assert.ok(mid.w < full.w - 2 && mid.w > small.w + 2, `半路宽度在两者之间：${mid.w}`);
      assert.ok(Math.abs(small.w / full.w - 0.8) < 0.01 && Math.abs(small.h / full.h - 0.8) < 0.01, '等比收到 0.8（玻璃两头还是正圆）');
      assert.ok(Math.abs(small.bottom - full.bottom) < 0.5, '贴着底边收');
      assert.ok(small.fab < full.fab - 8, '＋ 跟着缩小');
      assert.equal(small.label, 0, '标签淡出');
      assert.equal(small.topbar, 'pill', '顶栏照常收成胶囊');
      await assertTapTargets(page);
      await assertNoHorizontalOverflow(page);
      // 往上滚一点（累计 > 12px）：弹回完整
      for (const y of [614, 608, 602]) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await frames(page, 2);
      }
      await page.waitForFunction(() => !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      await app.idle();
      const back = await read();
      assert.ok(Math.abs(back.w - full.w) < 0.5 && back.label === 1, '往上一点就弹回完整');
      assert.equal(await page.$eval(BAR, (el) => el.style.scale), '', '展开后不留内联样式');
      // 再往下：收小；回到顶部：完整
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      // 键盘弹起（手机上输入框聚焦）：底栏照样沉下去；收起键盘回来还是收小的样子
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = '__kb';
        input.style.cssText = 'position:fixed;top:120px;left:20px;z-index:1';
        document.body.append(input);
        input.focus();
      });
      await page.waitForFunction(() => !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-shown'));
      await page.evaluate(() => {
        document.getElementById('__kb').blur();
        document.getElementById('__kb').remove();
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-shown'));
      assert.equal((await read()).compact, true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      await app.idle();
      assert.equal((await read()).topbar, 'top');
      // 换页：一律从完整开始
      await page.evaluate(() => window.scrollTo(0, 800));
      await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      await app.idle();
      await page.click(T('tab-ledger'));
      await page.waitForFunction(() => location.hash.endsWith('/ledger') && !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('＋：按下放大（--tabbar-fab-press-grow，纸本 1.05）、松手回弹，不参与拖动选择；＋ 面板开着时底栏一直是完整的；收小时打开 ＋ 面板 / 更多菜单从按钮展开后的位置长出来', async () => {
  const app = await open();
  try {
    await ready(app);
    const { page } = app;
    const c = await slotCenters(page);
    await page.touchscreen.touchStart(c[2].x, c[2].y);
    await wait(250);
    const s = await page.$eval(T('shell-fab'), (el) => ({ scale: getComputedStyle(el).scale, pressed: el.hasAttribute('data-pressed'), grow: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-fab-press-grow')) }));
    await shotBar(page, 'fab-press');
    assert.equal(s.pressed, true);
    assert.ok(s.grow > 1 && Math.abs(Number(s.scale) - s.grow) < 0.01, `＋ 按下放大到 ${s.grow}：${s.scale}`);
    assert.equal((await lensState(page)).up, false, '按 ＋ 不动选中块');
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
    await app.idle();
    assert.equal(await page.$eval(T('shell-fab'), (el) => getComputedStyle(el).scale), 'none', '松手弹回原大');
    // 收小时打开 ＋ 面板 / 更多菜单：底栏展开（「关闭」这些字要看得见）；面板 / 圆形扩散从按钮**展开以后**的位置长出来
    // （底栏一边展开、面板一边长，起点和按钮不错开）；关掉以后底栏保持完整（面板收回到按钮时按钮就在原位）
    const centerOf = (sel) => page.$eval(sel, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    // ＋ 面板：拨到第 0 帧读形状（阴影层，从按钮的样子出发）；更多菜单：圆心整个过程都不动（clip-path circle 的 at），打开时读一次
    const fabOrigin = async () => {
      const cap = await captureAt(app, () => page.click(T('shell-fab')), { selector: '.ov-panel', progress: 0, evaluate: () => null });
      try {
        // 阴影层逐帧跟着裁出来的形状（纸本的 ＋ 面板长出来时不盖按钮色，色层不动，读阴影层）
        return await centerOf('.ov-panel-shadow');
      } finally {
        await release(cap);
      }
    };
    const menuOrigin = async () => {
      await page.click(T('tab-more'));
      await page.waitForFunction(() => /circle\(/.test(getComputedStyle(document.querySelector('.ov-fsmenu') || document.body).clipPath));
      return page.$eval('.ov-fsmenu', (el) => {
        const m = /at ([\d.]+)px ([\d.]+)px/.exec(getComputedStyle(el).clipPath);
        return { x: Number(m[1]), y: Number(m[2]) };
      });
    };
    for (const [trigger, sheet, openAndRead] of [['shell-fab', 'fab', fabOrigin], ['tab-more', 'menu', menuOrigin]]) {
      await page.goBack();
      await page.waitForFunction(() => !location.hash.includes('sheet='));
      await app.idle();
      await page.evaluate(() => window.scrollTo(0, 0));
      await frames(page, 2);
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
      await app.idle();
      const compactAt = await centerOf(T(trigger));
      const origin = await openAndRead();
      await page.waitForFunction((id) => location.hash.endsWith(`?sheet=${id}`) && !document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'), {}, sheet);
      await app.idle();
      const finalAt = await centerOf(T(trigger));
      console.log(`收小时打开 ${sheet}：按钮收小时在 (${compactAt.x.toFixed(1)}, ${compactAt.y.toFixed(1)})，展开后 (${finalAt.x.toFixed(1)}, ${finalAt.y.toFixed(1)})，面板起点 (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)})`);
      assert.ok(Math.hypot(compactAt.x - finalAt.x, compactAt.y - finalAt.y) > 4, '按钮确实挪了位置（不然这个检查没意义）');
      assert.ok(Math.hypot(origin.x - finalAt.x, origin.y - finalAt.y) < 1.5, `${sheet} 从按钮展开以后的位置长出来`);
    }
    // 关掉菜单：底栏保持完整（再往下滚才收）
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('sheet='));
    await app.idle();
    assert.equal(await page.$eval(BAR, (el) => el.hasAttribute('data-compact')), false, '关掉以后还是完整的');
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减弱动态效果：切 tab 选中块不滑不拉伸（直接到新格子淡入）、按下不放大（只换颜色）、滚动不收小、＋ 按下不放大', async () => {
  const app = await open({ reducedMotion: true });
  try {
    await ready(app);
    const { page } = app;
    const cap = await captureAt(app, () => page.click(T('tab-ledger')), { selector: '.tabbar__ind', progress: 0.5, evaluate: () => null });
    let mid;
    try {
      mid = await lensState(page);
      await shotBar(page, 'reduced-switch-50');
    } finally {
      await release(cap);
    }
    assert.ok(Math.abs(mid.slot - 3) < 0.01, `不滑：一开始就在新格子 ${mid.slot}`);
    assert.ok(mid.sx === 1 && mid.sy === 1, '不拉伸');
    assert.ok(mid.opacity > 0 && mid.opacity < 1, `淡入：${mid.opacity}`);
    await page.waitForFunction(() => location.hash.endsWith('/ledger'));
    await app.idle();
    const c = await slotCenters(page);
    await page.touchscreen.touchStart(c[1].x, c[1].y);
    await wait(300);
    const held = await lensState(page);
    const colors = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tabbar__tab')].map((t) => [t.dataset.tab, getComputedStyle(t).color])));
    const accent = await page.evaluate(() => {
      const p = document.createElement('span');
      p.style.color = 'var(--color-tabbar-accent)';
      document.querySelector('[data-testid="shell-tabbar"]').append(p);
      const v = getComputedStyle(p).color;
      p.remove();
      return v;
    });
    assert.equal(held.up, false, '按住别的格：选中块（还在账本）不亮亮边——亮边和颜色不会分在两格');
    assert.deepEqual(held.hover, ['map'], '只给手指下那格换颜色');
    assert.equal(colors.map, accent, '手指下那格是强调色');
    assert.notEqual(colors.ledger, accent, '原来那格回到普通颜色');
    assert.ok(held.liftX === 1 && held.liftY === 1, '透镜不放大');
    assert.equal(held.mags.map, 'none', '图标不放大');
    assert.ok(Math.abs(held.slot - 3) < 0.01, '按下时选中块不漂过去');
    await shotBar(page, 'reduced-press');
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash.endsWith('/map'));
    await app.idle();
    assert.ok(Math.abs((await lensState(page)).slot - 1) < 0.01);
    // 按住当前那格：亮边亮起（只换颜色，不放大）
    const c1 = await slotCenters(page);
    await page.touchscreen.touchStart(c1[1].x, c1[1].y);
    await wait(200);
    const same = await lensState(page);
    assert.equal(same.up, true, '按住当前那格：亮边亮起');
    assert.ok(same.liftX === 1 && same.liftY === 1);
    await page.touchscreen.touchMove(c1[1].x, c1[1].y - 200);
    await wait(60);
    await page.touchscreen.touchEnd();
    await wait(200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await app.go('#/t/demo-island');
    await page.evaluate(() => window.scrollTo(0, 800));
    await frames(page, 4);
    await app.idle();
    assert.equal(await page.$eval(BAR, (el) => el.hasAttribute('data-compact') || getComputedStyle(el).scale !== 'none'), false, '不收小');
    const c2 = await slotCenters(page);
    await page.touchscreen.touchStart(c2[2].x, c2[2].y);
    await wait(200);
    assert.equal(await page.$eval(T('shell-fab'), (el) => getComputedStyle(el).scale), 'none', '＋ 按下不放大');
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => location.hash.endsWith('?sheet=fab'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('触控区 ≥44、无横向溢出：完整、按住透镜浮起（最右一格）、375 小屏收小时', async () => {
  const app = await open({ hash: '#/t/demo-island/bookings' });
  try {
    await ready(app);
    const { page } = app;
    await assertTapTargets(page);
    await assertNoHorizontalOverflow(page);
    // 二级页面：选中块在「更多」上，这时「更多」能按住拖
    const c = await slotCenters(page);
    await page.touchscreen.touchStart(c[4].x, c[4].y);
    await wait(400);
    const held = await lensState(page);
    assert.equal(held.up, true, '二级页面时「更多」就是当前那格，按住透镜浮起');
    await assertNoHorizontalOverflow(page);
    await page.touchscreen.touchEnd();
    await wait(300);
    await app.idle();
    app.assertClean();
  } finally {
    await app.close();
  }
  const small = await open({ device: 'small' });
  try {
    await ready(small);
    await small.page.evaluate(() => window.scrollTo(0, 700));
    await small.page.waitForFunction(() => document.querySelector('[data-testid="shell-tabbar"]').hasAttribute('data-compact'));
    await small.idle();
    await assertTapTargets(small.page);
    await assertNoHorizontalOverflow(small.page);
    small.assertClean();
  } finally {
    await small.close();
  }
});

test('文字对比度实测（真实渲染：玻璃 + 模糊 + 活力晕）：底栏的字在最亮、最暗、最花的背景（垫在滚动边缘层下面和上面）、真实页面上，平时和按住，浅色 / 深色都 ≥4.5:1，图标 ≥3:1', async () => {
  const BACKDROPS = {
    最亮白: '#ffffff',
    最暗黑: '#000000',
    彩色条纹: 'repeating-linear-gradient(90deg,#ff2d55 0 9px,#ffcc00 9px 18px,#34c759 18px 27px,#007aff 27px 36px,#000 36px 45px,#fff 45px 54px)',
    黑白格: 'repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0/12px 12px',
  };
  const SCENES = [
    { name: '白卡片', hash: '#/t/demo-island' },
    { name: '深色照片', hash: '#/t/demo-cities/journal?view=album' },
    { name: '彩色光场', hash: '#/t/demo-empty', bottom: true },
  ];
  const rows = [];
  const fails = [];
  const check = (theme, scene, r, min) => {
    for (const x of r) {
      rows.push(`${theme} ${scene} ${x.name}：最低 ${x.min.toFixed(2)}，5% ${x.p5.toFixed(2)}，中位 ${x.median.toFixed(2)}`);
      if (!(x.pixels > 50)) fails.push(`${theme} ${scene} ${x.name}：没量到字形（${x.pixels}）`);
      else if (x.min < min) fails.push(`${theme} ${scene} ${x.name}：${x.min.toFixed(2)} < ${min}`);
    }
  };
  for (const colorScheme of ['light', 'dark']) {
    const theme = colorScheme === 'light' ? '浅色' : '深色';
    for (const scene of SCENES) {
      const app = await open({ colorScheme, hash: scene.hash });
      try {
        await ready(app);
        const { page } = app;
        if (scene.bottom) {
          // 滚到底再往回带一点：底栏后面是光场、底栏是完整的
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await frames(page, 2);
          await page.evaluate(() => window.scrollTo(0, window.scrollY - 30));
          await frames(page, 2);
          await app.idle();
        }
        const clip = await barClip(page, 10);
        const labels = await measureTextContrast(app, { targets: '.tabbar__label', hide: '.tabbar__label, .tabbar__label *', clip });
        check(theme, scene.name, labels, 4.5);
        const icons = await measureTextContrast(app, { targets: '.tabbar__tab .tabbar__icon', hide: '.tabbar__tab .tabbar__icon', clip });
        check(theme, `${scene.name}（图标）`, icons, 3);
        await page.screenshot({ path: path.join(SHOTS, `contrast-${scene.name}-${colorScheme}.png`) });
        if (scene.name === '白卡片') {
          for (const over of [false, true]) {
            for (const [name, bg] of Object.entries(BACKDROPS)) {
              const label = `${name}${over ? '（边缘层上面）' : ''}`;
              await backdropUnderTabbar(page, bg, { over });
              await wait(80);
              const r = await measureTextContrast(app, { targets: '.tabbar__label', hide: '.tabbar__label, .tabbar__label *', clip });
              check(theme, label, r, 4.5);
              const ri = await measureTextContrast(app, { targets: '.tabbar__tab .tabbar__icon', hide: '.tabbar__tab .tabbar__icon', clip });
              check(theme, `${label}（图标）`, ri, 3);
              await shotBar(page, `contrast-${name}${over ? '-over' : ''}-${colorScheme}`);
            }
          }
          // 按住地图（透镜浮起、底色变淡）：最暗、最亮的背景垫在边缘层上面
          const c = await slotCenters(page);
          for (const [name, bg] of [['最暗黑', BACKDROPS.最暗黑], ['最亮白', BACKDROPS.最亮白]]) {
            await backdropUnderTabbar(page, bg, { over: true });
            await page.touchscreen.touchStart(c[1].x, c[1].y);
            await wait(500);
            const pclip = await barClip(page, 10);
            const r = await measureTextContrast(app, { targets: '.tabbar__label', hide: '.tabbar__label, .tabbar__label *', clip: pclip });
            check(theme, `按住地图·${name}`, r, 4.5);
            const ri = await measureTextContrast(app, { targets: '.tabbar__tab .tabbar__icon', hide: '.tabbar__tab .tabbar__icon', clip: pclip });
            check(theme, `按住地图·${name}（图标）`, ri, 3);
            if (name === '最暗黑') await shotBar(page, `contrast-press-${colorScheme}`);
            await page.touchscreen.touchMove(c[1].x, c[1].y - 200);
            await wait(60);
            await page.touchscreen.touchEnd();
            await wait(500);
          }
          await backdropUnderTabbar(page, null);
        }
        app.assertClean();
      } finally {
        await app.close();
      }
    }
  }
  console.log(`底栏对比度：\n  ${rows.join('\n  ')}`);
  assert.deepEqual(fails, []);
});

test('性能：4 倍 CPU 降速时按住拖动、切 tab、滚动收小 / 展开的帧间隔 p95 ≤ 16.7ms；拖动时不重新布局', async () => {
  const app = await open({ now: '2027-01-11T10:00:00+07:00' });
  try {
    await ready(app);
    const { page } = app;
    const cdp = await page.createCDPSession();
    const startMeter = () => page.evaluate(() => {
      window.__ft = [];
      window.__ftOn = true;
      let last = 0;
      const tick = (t) => {
        if (!window.__ftOn) return;
        if (last) window.__ft.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const stopMeter = () => page.evaluate(() => {
      window.__ftOn = false;
      const s = [...window.__ft].sort((a, b) => a - b);
      return { n: s.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
    });
    // 拖动时有没有布局：盯着 layout-shift 以外的办法——数一下拖动期间 ResizeObserver / 强制布局不好量，
    // 这里用 Performance 的 LayoutCount（CDP Performance.getMetrics）在拖动前后的差
    await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount').value;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const results = {};
    try {
      // 1. 按住拖动来回两趟，滑出去取消（不换页）
      const c = await slotCenters(page);
      // 页面自己每秒也会布局（倒计时这类）：拖完再量同样长的时间里不动底栏时布局几次，当基线
      await startMeter();
      await page.touchscreen.touchStart(c[0].x, c[0].y);
      await wait(120);
      const l0 = await layouts();
      const d0 = Date.now();
      await slide(page, c[0], c[3], 14);
      await slide(page, c[3], c[0], 14);
      await slide(page, c[0], c[3], 10);
      const l1 = await layouts();
      const dragMs = Date.now() - d0;
      await slide(page, c[3], { x: c[3].x, y: c[3].y - 160 }, 4);
      await page.touchscreen.touchEnd();
      await wait(700);
      results.drag = await stopMeter();
      results.dragLayouts = l1 - l0;
      await app.idle();
      const b0 = await layouts();
      await wait(dragMs);
      results.baseLayouts = (await layouts()) - b0;
      results.dragMs = dragMs;
      // 2. 切 tab（换页 + 选中块拉伸滑过去）
      await app.idle();
      await startMeter();
      await page.click(T('tab-ledger'));
      await wait(900);
      results.switch = await stopMeter();
      // 3. 滚动收小 / 展开
      await app.go('#/t/demo-island');
      await app.idle();
      await startMeter();
      await page.evaluate(async () => {
        for (let y = 0; y <= 700; y += 35) {
          window.scrollTo(0, y);
          await new Promise((r) => requestAnimationFrame(r));
        }
        await new Promise((r) => setTimeout(r, 600));
        for (let y = 700; y >= 640; y -= 6) {
          window.scrollTo(0, y);
          await new Promise((r) => requestAnimationFrame(r));
        }
        await new Promise((r) => setTimeout(r, 600));
      });
      results.compact = await stopMeter();
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    for (const [k, v] of Object.entries(results)) if (v && typeof v === 'object') console.log(`4x 降速 ${k}：${v.n} 帧，p95 ${v.p95.toFixed(2)}ms，最长 ${v.max.toFixed(2)}ms`);
    console.log(`拖动 ${results.dragMs}ms（${results.drag.n} 帧）期间布局 ${results.dragLayouts} 次；同样长的时间不动底栏，页面自己布局 ${results.baseLayouts} 次`);
    for (const k of ['drag', 'switch', 'compact']) assert.ok(results[k].p95 <= 16.7 + 0.5, `${k} p95 ${results[k].p95}ms`);
    assert.ok(results.dragLayouts - results.baseLayouts <= 1, `拖动时每帧不重新布局（拖动期间 ${results.dragLayouts} 次，基线 ${results.baseLayouts} 次）`);
    app.assertClean();
  } finally {
    await app.close();
  }
});
