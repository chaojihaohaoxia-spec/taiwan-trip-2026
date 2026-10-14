// 动效评审（#/dev/primitives、#/dev/overlays，390×844）里每个问题的回归测试：
//   #1 列表 ↔ 网格连点两下标题永久消失      #2 底部面板甩不走 / 接力滚动      #3 手风琴卡片从手指下跑开
//   #5 搜索展开的几处跳变、减弱动态效果       #6 加号面板：阴影、颜色、按压交接   #7 步进器的空胶囊
//   #8 分段控件按住没有即时反馈              #10 高度变矮时底边先跳            #13 标签页按下的灰底
//   #15 全屏菜单的遮罩和错落                  #16 弹层开关时整页跳              #17 浮层按钮 touch-action
// （#4 / #9 / #11 / #12 / #14 / #18 在 interactions.e2e.mjs 和单元测试里）
// 半路截图在 test/e2e/__shots__/motion/review-*.png。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './lib/harness.mjs';
import { waitForAnimationsDone } from './lib/animation.mjs';
import { captureAt, release, shot, center, between, parseInset } from './lib/motion-shots.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { shapeProgress, morphTintAt, morphContentAt } from '../../src/motion/morph-shape.js';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

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

const tid = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  let i = 0;
  const f = () => (++i >= k ? r() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);

async function open(hash, options = {}) {
  const app = await openApp({ browser, server, hash, ...options });
  await app.page.waitForSelector(hash.includes('overlays') ? '#demo-overlay-sheet' : '[data-testid="primitives-page"]');
  await app.idle();
  return app;
}

// ---------------------------------------------------------------------
// #1 列表 ↔ 网格连点两下
// ---------------------------------------------------------------------
test('#1 列表 ↔ 网格连点两下（间隔 60 / 120 / 200 / 400ms）：标题不会消失，元素上不残留内联 opacity；打断那一帧不闪', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, '#demo-view-switch');
    for (const gap of [60, 120, 200, 400]) {
      await page.evaluate(() => {
        window.__op = [];
        window.__sampling = true;
        const el = document.querySelector('[data-testid="view-card-p1"] .vs-card__text');
        const f = () => {
          if (!window.__sampling) return;
          window.__op.push(Number(getComputedStyle(el).opacity));
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      await page.$eval(tid('view-toggle'), (b) => b.click());
      await sleep(gap);
      await page.$eval(tid('view-toggle'), (b) => b.click());
      await waitForAnimationsDone(page, 6000);
      await raf(page);
      const ops = await page.evaluate(() => {
        window.__sampling = false;
        return window.__op;
      });
      const texts = await page.$$eval('[data-testid="view-switch"] .vs-card__text', (els) => els.map((e) => ({ o: Number(getComputedStyle(e).opacity), inline: e.style.opacity })));
      for (const t of texts) {
        assert.equal(t.o, 1, `间隔 ${gap}ms：播完标题完全不透明`);
        assert.equal(t.inline, '', `间隔 ${gap}ms：没有残留的内联 opacity`);
      }
      // 打断那一帧不会从接近 0 一下子跳回 1
      let jump = 0;
      for (let i = 1; i < ops.length; i++) if (ops[i] - ops[i - 1] > jump) jump = ops[i] - ops[i - 1];
      assert.ok(jump < 0.6, `间隔 ${gap}ms：单帧不透明度跳升 ${jump.toFixed(2)}（不闪）`);
    }
    await shot(app, 'review-01-view-rapid', '#demo-view-switch');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#1 附带：FLIP 列表连点（新增、新增、打乱，间隔 40 / 120ms）——播完元素上不残留内联的 transform / opacity / transform-origin', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, '#demo-flip-list');
    for (const gap of [40, 120]) {
      await page.$eval(tid('flip-add'), (b) => b.click());
      await sleep(gap);
      await page.$eval(tid('flip-add'), (b) => b.click());
      await sleep(gap);
      await page.$eval(tid('flip-shuffle'), (b) => b.click());
      await sleep(200);
      await waitForAnimationsDone(page, 6000);
      await raf(page);
      const residue = await page.$$eval('[data-testid="flip-list"] li', (els) => els
        .map((e) => ({ op: Number(getComputedStyle(e).opacity), inline: e.getAttribute('style') || '' }))
        .filter((x) => x.op !== 1 || /opacity|transform|clip/.test(x.inline)));
      assert.deepEqual(residue, [], `间隔 ${gap}ms：残留 ${JSON.stringify(residue)}`);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #2 底部面板甩一下就走、档位甩得过去、内容接力滚动
// ---------------------------------------------------------------------
/** 在面板把手区按住，按每帧位移往下（负数往上）移动若干帧后松手（页面里按 rAF 派发，速度准确） */
const flick = (page, sel, plan) => page.evaluate(async (s, p) => {
  const top = document.querySelector(`${s} .ov-sheet__top`);
  const r = top.getBoundingClientRect();
  const x = r.left + r.width / 2;
  let y = r.top + 8;
  const fire = (type) => top.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  }));
  const frame = () => new Promise((res) => requestAnimationFrame(res));
  fire('pointerdown');
  for (const [frames, step] of p) {
    for (let i = 0; i < frames; i++) {
      await frame();
      y += step;
      fire('pointermove');
    }
  }
  await frame();
  fire('pointerup');
}, sel, plan);

test('#2 底部面板：拖 60px 后 500 / 800 / 1200 px/s 甩就关；停在 55% 关、40% 弹回；半屏档往上甩升大档、往下甩关', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    const isOpen = (id) => page.evaluate((x) => location.hash.includes(`sheet=${x}`), id);
    const openSheet = async (btn, id) => {
      for (let i = 0; i < 5 && /sheet=/.test(await page.evaluate(() => location.hash)); i++) {
        await page.keyboard.press('Escape');
        await sleep(400);
      }
      // 等上一个面板的退场动画播完、卸载（半路重新打开会接着用上一次的档位）
      await page.waitForFunction(() => !document.querySelector('[data-overlay-layer]'), { timeout: 5000 });
      await page.$eval(tid(btn), (el) => el.click());
      await page.waitForFunction((x) => location.hash.includes(`sheet=${x}`), {}, id);
      await waitForAnimationsDone(page, 4000);
      await page.evaluate(() => document.activeElement?.blur());
    };
    const sheetH = async () => page.$eval(tid('sheet-expense'), (el) => el.getBoundingClientRect().height);
    // 以 60fps 计：每帧 8.3px ≈ 500 px/s
    for (const [label, plan, closes] of [
      ['拖 60px 后 500 px/s 甩', [[6, 4], [6, 8.3]], true],
      ['拖 60px 后 800 px/s 甩', [[6, 4], [6, 13.3]], true],
      ['拖 60px 后 1200 px/s 甩', [[6, 4], [6, 20]], true],
    ]) {
      await openSheet('open-expense', 'demo-expense');
      await flick(page, tid('sheet-expense'), plan);
      await sleep(900);
      assert.equal(!(await isOpen('demo-expense')), closes, label);
    }
    await openSheet('open-expense', 'demo-expense');
    let h = await sheetH();
    await flick(page, tid('sheet-expense'), [[30, (h * 0.55) / 30], [8, 0]]);
    await sleep(900);
    assert.equal(await isOpen('demo-expense'), false, '拖到 55% 停住松手：关');
    await openSheet('open-expense', 'demo-expense');
    h = await sheetH();
    await flick(page, tid('sheet-expense'), [[30, (h * 0.4) / 30], [8, 0]]);
    await sleep(900);
    assert.equal(await isOpen('demo-expense'), true, '拖到 40% 停住松手：弹回');
    // 半屏 / 大档
    await openSheet('open-place', 'demo-place');
    assert.equal(await page.$eval(tid('sheet-place'), (el) => el.dataset.detent), 'medium');
    await flick(page, tid('sheet-place'), [[5, -12]]);
    await sleep(900);
    assert.equal(await page.$eval(tid('sheet-place'), (el) => el.dataset.detent), 'large', '半屏往上 800 px/s 甩 60px：大档');
    await openSheet('open-place', 'demo-place');
    await flick(page, tid('sheet-place'), [[5, 12]]);
    await sleep(900);
    assert.equal(await isOpen('demo-place'), false, '半屏往下 800 px/s 甩：关');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#2 底部面板：半屏档在内容区一口气往上滑——先把面板拉到大档，同一个手势接着滚内容，松手后惯性接着滚', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await page.$eval(tid('open-place'), (el) => el.click());
    await page.waitForFunction(() => location.hash.includes('sheet=demo-place'));
    await waitForAnimationsDone(page, 4000);
    const result = await page.evaluate(async () => {
      const sheet = document.querySelector('[data-testid="sheet-place"]');
      const body = sheet.querySelector('.ov-sheet__body');
      const row = body.querySelector('[data-testid="place-list"] li');
      const r = row.getBoundingClientRect();
      const x = r.left + 30;
      let y = Math.min(r.top + 10, innerHeight - 30);
      const mk = (type) => {
        const t = new Touch({ identifier: 3, target: row, clientX: x, clientY: y });
        return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
      };
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const start = body.scrollTop;
      row.dispatchEvent(mk('touchstart'));
      // 一口气往上滑 700px：前 420px 左右把面板从半屏拉到大档，剩下的交给内容滚动
      for (let i = 0; i < 50; i++) {
        await frame();
        y -= 14;
        row.dispatchEvent(mk('touchmove'));
      }
      const atRelease = body.scrollTop;
      row.dispatchEvent(mk('touchend'));
      for (let i = 0; i < 30; i++) await frame();
      return { detent: sheet.dataset.detent, start, atRelease, after: body.scrollTop, max: body.scrollHeight - body.clientHeight };
    });
    assert.equal(result.detent, 'large', '面板拉到了大档');
    if (result.max > 20) {
      assert.ok(result.atRelease > result.start + 20, `到顶后同一个手势接着滚内容：${result.start} → ${result.atRelease}`);
      assert.ok(result.after >= result.atRelease, `松手后惯性接着滚：${result.atRelease} → ${result.after}`);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #3 手风琴：被点的卡片待在手指下面
// ---------------------------------------------------------------------
test('#3 一次只开一张：上面那张收起时，被点的“跨海缆车”标题行一直待在原地（偏差 ≤ 2px）', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, tid('xcard-cable'));
    const before = await page.$eval(`${tid('xcard-cable')} .xcard__header`, (el) => el.getBoundingClientRect().top);
    // 每帧绘制之后读位置（rAF 里再 setTimeout 0：这一帧的所有 rAF 回调——包括锚定的修正——都执行完了）
    await page.evaluate(() => {
      window.__tops = [];
      window.__sampling = true;
      const el = document.querySelector('[data-testid="xcard-cable"] .xcard__header');
      const f = () => {
        if (!window.__sampling) return;
        setTimeout(() => window.__tops.push(el.getBoundingClientRect().top), 0);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await page.$eval(`${tid('xcard-cable')} .xcard__header`, (el) => el.click());
    await waitForAnimationsDone(page, 4000);
    await sleep(300);
    const tops = await page.evaluate(() => {
      window.__sampling = false;
      return window.__tops;
    });
    const drift = Math.max(...tops.map((t) => Math.abs(t - before)));
    assert.ok(drift <= 2, `标题行最大偏移 ${drift.toFixed(1)}px（评审时是 142px）`);
    assert.ok(Math.abs(tops[tops.length - 1] - before) <= 0.5, `停稳后回到原位：${tops[tops.length - 1]} vs ${before}`);
    assert.equal(await page.$eval(tid('xcard-cable'), (el) => el.hasAttribute('data-open')), true);
    assert.equal(await page.$eval(tid('xcard-breakfast'), (el) => el.hasAttribute('data-open')), false);
    await shot(app, 'review-03-accordion-after', tid('xcard-list'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #5 搜索展开
// ---------------------------------------------------------------------
test('#5 搜索：第 0 帧输入框那一层和按钮完全重合（同样大的放大镜、同样的颜色）；前段文字和光标透明；收起最后一帧才换回按钮', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, tid('search'));
    // 颜色换成 RGB 再比（动画插值出来的颜色可能写成 oklab(…)，和 rgb(…) 是同一个颜色）
    const rgbOf = (c) => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    await page.evaluate(`window.__rgbOf = ${rgbOf.toString()}`);
    const trigger = await page.$eval(`${tid('search')} .search-x__trigger svg`, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, color: window.__rgbOf(getComputedStyle(el).color) };
    });
    const read = () => {
      const root = document.querySelector('[data-testid="search"]');
      const icon = root.querySelector('.search-x__icon svg');
      const r = icon.getBoundingClientRect();
      const input = root.querySelector('.search-x__input');
      return {
        x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, color: window.__rgbOf(getComputedStyle(icon).color),
        inputOpacity: Number(getComputedStyle(input).opacity), phase: root.dataset.phase,
        triggerOpacity: Number(getComputedStyle(root.querySelector('.search-x__trigger')).opacity),
      };
    };
    const c0 = await captureAt(app, () => page.click(`${tid('search')} .search-x__trigger`), { selector: '.search-x__field', progress: 0, evaluate: read });
    await shot(app, 'review-05-search-frame0', tid('search'));
    await release(c0);
    const f0 = c0.state;
    assert.ok(Math.abs(f0.x - trigger.x) < 0.6 && Math.abs(f0.y - trigger.y) < 0.6, `第 0 帧放大镜和按钮里的重合：(${f0.x}, ${f0.y}) vs (${trigger.x}, ${trigger.y})`);
    assert.ok(Math.abs(f0.w - trigger.w) < 0.5, `同样大：${f0.w} vs ${trigger.w}`);
    assert.ok(f0.color.every((v, i) => Math.abs(v - trigger.color[i]) <= 2), `同样的颜色：${f0.color} vs ${trigger.color}`);
    assert.equal(f0.inputOpacity, 0, '第 0 帧文字和光标透明（不会从圆的右缘露出一条竖线）');
    assert.equal(f0.phase, 'moving');
    await waitForAnimationsDone(page, 4000);
    // 收起：最后一帧之前按钮一直让位；播完同一帧换回按钮
    const c1 = await captureAt(app, () => page.click(`${tid('search')} .search-x__cancel`), { selector: '.search-x__field', progress: 0.9, evaluate: read });
    assert.equal(c1.state.phase, 'moving', '收起途中还是输入框那一层');
    assert.equal(c1.state.triggerOpacity, 0);
    await release(c1);
    await waitForAnimationsDone(page, 4000);
    await raf(page);
    const end = await page.evaluate(read);
    assert.equal(end.phase, 'closed');
    assert.equal(end.triggerOpacity, 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#5 搜索（减弱动态效果）：放大镜不横移，只在按钮和展开的输入框之间交叉淡化', async () => {
  const app = await open('#/dev/primitives', { reducedMotion: true });
  try {
    const { page } = app;
    await center(app, tid('search'));
    const read = () => {
      const root = document.querySelector('[data-testid="search"]');
      const icon = root.querySelector('.search-x__icon').getBoundingClientRect();
      return { iconX: icon.left - root.getBoundingClientRect().left, field: Number(getComputedStyle(root.querySelector('.search-x__field')).opacity) };
    };
    const mid = await captureAt(app, () => page.click(`${tid('search')} .search-x__trigger`), { selector: '.search-x__field', progress: 0.15, evaluate: read });
    await release(mid);
    await waitForAnimationsDone(page, 3000);
    const end = await page.evaluate(read);
    assert.ok(Math.abs(mid.state.iconX - end.iconX) < 1, `半路放大镜已经在展开后的位置（不横移）：${mid.state.iconX} vs ${end.iconX}`);
    assert.ok(between(mid.state.field, 0, 1, 0.05), `输入框在淡入：${mid.state.field}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #6 加号长成面板：阴影跟着形状、颜色从按钮过渡、按压交接
// ---------------------------------------------------------------------
test('#6 加号面板：长出来的过冲只体现在平移上（裁切不为负）；阴影层和裁出来的形状逐帧一致；一开始是按钮的颜色', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('fab'));
    const read = () => {
      const panel = document.querySelector('[data-testid="panel-fab"]');
      const layer = panel.closest('.ov-layer');
      const shadow = layer.querySelector('.ov-panel-shadow');
      const tint = layer.querySelector('.ov-panel-tint');
      const cs = getComputedStyle(panel);
      const pr = panel.getBoundingClientRect();
      const m = /inset\(([^)]*)\)/.exec(cs.clipPath);
      const nums = m ? m[1].split(/\sround\s/)[0].trim().split(/\s+/).map(parseFloat) : [0, 0, 0, 0];
      const [t, r = t, b = t, l = r] = nums;
      const sr = shadow.getBoundingClientRect();
      return {
        insets: [t, r, b, l],
        visible: { left: pr.left + l, top: pr.top + t, right: pr.right - r, bottom: pr.bottom - b },
        shadow: { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom },
        tint: Number(getComputedStyle(tint).opacity),
        tintColor: getComputedStyle(tint).backgroundColor,
        fabColor: getComputedStyle(document.querySelector('[data-testid="fab"]')).backgroundColor,
      };
    };
    for (const progress of [0, 0.15, 0.3, 0.5]) {
      const c = await captureAt(app, () => page.click(tid('fab')), { selector: '[data-testid="panel-fab"]', progress, evaluate: read });
      await shot(app, `review-06-panel-open-${String(Math.round(progress * 100)).padStart(3, '0')}`);
      await release(c);
      const s = c.state;
      for (const v of s.insets) assert.ok(v >= -0.01, `进度 ${progress}：裁切框不超出面板（${s.insets}）`);
      for (const k of ['left', 'top', 'right', 'bottom']) {
        assert.ok(Math.abs(s.visible[k] - s.shadow[k]) < 1.5, `进度 ${progress}：阴影层的 ${k} 和裁出来的形状一致（${s.visible[k]} vs ${s.shadow[k]}）`);
      }
      if (progress === 0) {
        assert.ok(s.tint > 0.95, '第 0 帧是按钮的颜色');
        assert.equal(s.tintColor, s.fabColor);
      }
      await waitForAnimationsDone(page, 4000);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[data-testid="panel-fab"]'), { timeout: 5000 });
      await waitForAnimationsDone(page, 4000);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

/** 读面板此刻的形状进度（0 = 按钮大小，1 = 整块）、色层和内容的不透明度 */
const readPanelTint = () => {
  const panel = document.querySelector('[data-testid="panel-fab"]');
  const layer = panel.closest('.ov-layer');
  const fab = document.querySelector('[data-testid="fab"]').getBoundingClientRect();
  const m = /inset\(([^)]*)\)/.exec(getComputedStyle(panel).clipPath);
  const nums = m ? m[1].split(/\sround\s/)[0].trim().split(/\s+/).map(parseFloat) : [0, 0, 0, 0];
  const [t, r = t, b = t, l = r] = nums;
  return {
    v: { t, r, b, l },
    size: { width: panel.offsetWidth, height: panel.offsetHeight },
    anchor: { width: fab.width, height: fab.height },
    tint: Number(getComputedStyle(layer.querySelector('.ov-panel-tint')).opacity),
    content: Number(getComputedStyle(panel.querySelector('.ov-panel__body')).opacity),
  };
};

test('#6 加号面板：收回时颜色和内容跟着形状走——内容先淡出，缩到一半左右盖上按钮的颜色，落地时就是按钮的颜色（不是一块白色缩回去）', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('fab'));
    await page.click(tid('fab'));
    await page.waitForSelector(tid('panel-fab'));
    await waitForAnimationsDone(page, 4000);
    const samples = [];
    for (const progress of [0.05, 0.15, 0.25, 0.4, 0.6, 0.95]) {
      const c = await captureAt(app, () => page.click(`${tid('panel-fab-anchor')}`), { selector: '[data-testid="panel-fab"]', progress, evaluate: readPanelTint });
      await shot(app, `review-06-panel-close-${String(Math.round(progress * 100)).padStart(3, '0')}`);
      const f = shapeProgress('clip', c.state.size, c.state.anchor)(c.state.v);
      samples.push({ progress, f, ...c.state });
      // 回到打开状态，下一轮
      await release(c);
      await waitForAnimationsDone(page, 4000);
      await page.waitForFunction(() => !document.querySelector('[data-testid="panel-fab"]'), { timeout: 5000 });
      await page.click(tid('fab'));
      await page.waitForSelector(tid('panel-fab'));
      await waitForAnimationsDone(page, 4000);
    }
    const desc = samples.map((x) => `${x.progress}: 形状 ${x.f.toFixed(2)} 色层 ${x.tint.toFixed(2)} 内容 ${x.content.toFixed(2)}`).join('；');
    for (const x of samples) {
      assert.ok(Math.abs(x.tint - morphTintAt(x.f)) < 0.03, `色层是形状的函数（${desc}）`);
      assert.ok(Math.abs(x.content - morphContentAt(x.f)) < 0.03, `内容是形状的函数（${desc}）`);
      // 没有“又白又空、还挺大”的一块：形状还大于一半时，不会内容和色层都几乎看不见
      if (x.f > 0.5) assert.ok(x.content > 0.1 || x.tint > 0.1, `形状 ${x.f.toFixed(2)} 时不是空白块（${desc}）`);
    }
    assert.ok(samples[0].content > 0.5 && samples[0].tint < 0.05, `刚开始收：内容还在、没盖色层（${desc}）`);
    assert.ok(samples.at(-1).tint > 0.95, `落地时是按钮的颜色（${desc}）`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#6 加号面板：收到一半又点开——形状、色层、内容都从此刻接着走（不跳）', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('fab'));
    await page.click(tid('fab'));
    await page.waitForSelector(tid('panel-fab'));
    await waitForAnimationsDone(page, 4000);
    const c = await captureAt(app, () => page.click(`${tid('panel-fab-anchor')}`), { selector: '[data-testid="panel-fab"]', progress: 0.3, evaluate: readPanelTint });
    // 动画仍停着：再点一下（重新打开），新动画的第 0 帧
    await page.click(`${tid('panel-fab-anchor')}`);
    await raf(page);
    const after = await page.evaluate(readPanelTint);
    await shot(app, 'review-06-panel-reopen-000');
    await release(c);
    await waitForAnimationsDone(page, 4000);
    const fBefore = shapeProgress('clip', c.state.size, c.state.anchor)(c.state.v);
    const fAfter = shapeProgress('clip', after.size, after.anchor)(after.v);
    assert.ok(Math.abs(fBefore - fAfter) < 0.03, `形状接着走：${fBefore.toFixed(3)} → ${fAfter.toFixed(3)}`);
    assert.ok(Math.abs(c.state.tint - after.tint) < 0.03, `色层接着走：${c.state.tint} → ${after.tint}`);
    assert.ok(Math.abs(c.state.content - after.content) < 0.03, `内容接着走：${c.state.content} → ${after.content}`);
    const end = await page.evaluate(readPanelTint);
    assert.equal(end.tint, 0, '重新打开后色层褪干净');
    assert.equal(end.content, 1, '内容完全不透明');
    assert.match(await page.evaluate(() => location.hash), /sheet=demo-fab/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#6 / #19 替身按钮接着真按钮的按压回弹继续弹（不会从 0.96 跳到 1）', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('fab'));
    const box = await page.$eval(tid('fab'), (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const cdp = await page.createCDPSession();
    await cdp.send('Animation.enable');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await sleep(150); // 按下缩到 0.96
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    await page.mouse.up(); // 松手 → 点击 → 面板出现、替身接手
    await page.waitForSelector(tid('panel-fab-anchor'));
    await raf(page);
    const proxyScale = await page.$eval(tid('panel-fab-anchor'), (el) => parseFloat(getComputedStyle(el).scale) || 1);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    assert.ok(proxyScale < 0.99, `替身出现时还是按下的大小，接着弹回（scale ${proxyScale}）`);
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval(tid('panel-fab-anchor'), (el) => getComputedStyle(el).scale), 'none', '弹回 1 之后不留内联样式');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #7 步进器归零：没有空的深色胶囊
// ---------------------------------------------------------------------
test('#7 步进器归零：收回的每个时刻，要么“− 数字 +”还看得见，要么「添加」已经出来了（没有一段空胶囊）', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    const sel = tid('stepper-dress');
    await center(app, sel);
    await page.click(`${sel} .stepper__add`);
    await waitForAnimationsDone(page, 4000);
    const read = new Function(`
      const root = document.querySelector('${sel}');
      const o = (q) => Number(getComputedStyle(root.querySelector(q)).opacity);
      const vis = (q) => getComputedStyle(root.querySelector(q)).visibility;
      return { plus: vis('.stepper__btn--plus') === 'hidden' ? 0 : o('.stepper__btn--plus'), add: vis('.stepper__add') === 'hidden' ? 0 : o('.stepper__add') };
    `);
    for (const progress of [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8]) {
      const c = await captureAt(app, () => page.click(`${sel} .stepper__btn--minus`), { selector: '.stepper__bg', progress, evaluate: read });
      await shot(app, `review-07-stepper-close-${String(Math.round(progress * 100)).padStart(3, '0')}`, sel);
      await release(c);
      const s = c.state;
      assert.ok(Math.max(s.plus, s.add) > 0.3, `进度 ${progress}：+ ${s.plus.toFixed(2)} /「添加」${s.add.toFixed(2)}，总有一个看得见`);
      await waitForAnimationsDone(page, 4000);
      await page.click(`${sel} .stepper__add`);
      await waitForAnimationsDone(page, 4000);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #8 分段控件：按住选中块即时反馈
// ---------------------------------------------------------------------
test('#8 分段控件：按在选中的那一段上，不用拖，选中块马上缩一下；松手弹回', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, tid('seg-main'));
    const box = await page.$eval(`${tid('seg-main')} [aria-checked="true"]`, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await sleep(200);
    const pressed = await page.$eval(`${tid('seg-main')} .seg__thumb`, (el) => ({ scale: parseFloat(getComputedStyle(el).scale), attr: el.hasAttribute('data-pressed') }));
    await page.mouse.up();
    await waitForAnimationsDone(page, 3000);
    await sleep(800);
    const released = await page.$eval(`${tid('seg-main')} .seg__thumb`, (el) => ({ scale: getComputedStyle(el).scale, attr: el.hasAttribute('data-pressed') }));
    assert.equal(pressed.attr, true);
    assert.ok(Math.abs(pressed.scale - 0.96) < 0.005, `按住 200ms 已经缩到 0.96：${pressed.scale}`);
    assert.equal(released.attr, false);
    assert.ok(released.scale === 'none' || Math.abs(parseFloat(released.scale) - 1) < 0.002, `松手弹回：${released.scale}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #10 高度变矮：卡片底边和后面的内容同一条弹簧
// ---------------------------------------------------------------------
test('#10 FLIP 高度变矮：旧内容的影子从底边卷上去，和后面的内容严丝合缝（中间不露出一截页面底色）', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, tid('height-card'));
    await page.click(tid('height-toggle'));
    await waitForAnimationsDone(page, 4000);
    const read = () => {
      const card = document.querySelector('[data-testid="height-card"]');
      const ghost = card.parentElement.querySelector('[data-flip-ghost]');
      const after = document.querySelector('[data-testid="height-after"]').getBoundingClientRect();
      let bottom = card.getBoundingClientRect().bottom;
      if (ghost) {
        const g = ghost.getBoundingClientRect();
        const m = /inset\(\s*[-\d.]+px\s+[-\d.]+px\s+([-\d.]+)px/.exec(getComputedStyle(ghost).clipPath);
        bottom = Math.max(bottom, g.bottom - (m ? parseFloat(m[1]) : 0));
      }
      const cardMargin = parseFloat(getComputedStyle(document.querySelector('[data-testid="height-after"]')).marginTop) || 0;
      return { ghost: Boolean(ghost), gap: after.top - bottom - cardMargin, afterTop: after.top };
    };
    const samples = [];
    for (const progress of [0, 0.25, 0.5, 0.75]) {
      const c = await captureAt(app, () => page.click(tid('height-toggle')), { selector: '[data-testid="height-after"]', progress, evaluate: read });
      await shot(app, `review-10-height-close-${String(Math.round(progress * 100)).padStart(3, '0')}`, '#demo-flip-height');
      samples.push(c.state);
      await release(c);
      await waitForAnimationsDone(page, 4000);
      await page.click(tid('height-toggle'));
      await waitForAnimationsDone(page, 4000);
    }
    const restGap = samples[0].gap;
    for (const s of samples) {
      assert.ok(s.ghost, '变矮时有旧内容的影子');
      assert.ok(Math.abs(s.gap - restGap) < 2, `卡片（含影子）底边和后面内容的间距保持不变：${s.gap.toFixed(1)} vs ${restGap.toFixed(1)}`);
    }
    assert.equal(await page.$('[data-flip-ghost]'), null, '播完影子删掉');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #13 标签页按下：文字变淡，不出灰底
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// #11 搜索、步进器改成弹簧驱动：半路反向时速度连续（不会先停住再重新加速）
// ---------------------------------------------------------------------
/**
 * 0.1 倍速下：start() 开始动画，过 waitMs 后 reverse() 反向，逐帧记 read() 的位置。
 * 返回反向前最后两帧、反向后头两帧的每帧位移（px/帧）。
 */
async function reversalSpeeds(app, { start, reverse, read, waitMs }) {
  const { page } = app;
  const cdp = await page.createCDPSession();
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
  try {
    await page.evaluate(`window.__read = ${read}; window.__pos = []; window.__mark = -1; window.__on = true;
      (function tick() { if (!window.__on) return; window.__pos.push(window.__read()); requestAnimationFrame(tick); })();`);
    await page.evaluate(start);
    await sleep(waitMs);
    await page.evaluate(`window.__mark = window.__pos.length; (${reverse})()`);
    await sleep(1500);
    const { pos, mark } = await page.evaluate(() => {
      window.__on = false;
      return { pos: window.__pos, mark: window.__mark };
    });
    const d = pos.slice(1).map((v, i) => v - pos[i]);
    // 反向那一刻之前、之后的位移（mark - 1 是点下去之后的第一帧：新动画接手的那一帧）
    return { before: d.slice(mark - 3, mark - 1), after: d.slice(mark - 1, mark + 2), all: d.slice(mark - 4, mark + 4) };
  } finally {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await cdp.detach().catch(() => {});
  }
}

test('#11 搜索框、步进器半路反向：速度连续（反向后头几帧还顺着原方向减速，不会一下子停住再重新加速）', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    const cases = [
      {
        name: '搜索框（放大镜的横向位置）',
        section: tid('search'),
        start: () => document.querySelector('[data-testid="search"] .search-x__trigger').click(),
        reverse: () => document.querySelector('[data-testid="search"] .search-x__cancel').click(),
        read: () => document.querySelector('[data-testid="search"] .search-x__icon').getBoundingClientRect().left,
      },
      {
        name: '步进器（底色左边的裁切）',
        section: tid('stepper-umbrella'),
        start: () => document.querySelector('[data-testid="stepper-umbrella"] .stepper__add').click(),
        reverse: () => document.querySelector('[data-testid="stepper-umbrella"] .stepper__btn--minus').click(),
        read: () => {
          const m = /inset\(([^)]*)\)/.exec(getComputedStyle(document.querySelector('[data-testid="stepper-umbrella"] .stepper__bg')).clipPath);
          const n = m ? m[1].split(/\sround\s/)[0].trim().split(/\s+/).map(parseFloat) : [0];
          return n[3] ?? n[1] ?? n[0];
        },
      },
    ];
    for (const c of cases) {
      await center(app, c.section);
      await waitForAnimationsDone(page, 3000);
      const r = await reversalSpeeds(app, { start: c.start, reverse: c.reverse, read: c.read, waitMs: 700 });
      const v0 = r.before.at(-1);
      const v1 = r.after[1];
      const desc = `${c.name}：反向前后每帧位移 ${r.all.map((x) => x.toFixed(2)).join(' ')}`;
      assert.ok(Math.abs(v0) > 0.2, `反向时还在快速移动（测得到速度）——${desc}`);
      // 接手的那一帧也不停顿（新动画从这一帧起算，不会原地停一帧）、之后顺着原方向减速
      for (const v of r.after.slice(0, 2)) {
        assert.ok(Math.sign(v) === Math.sign(v0) && Math.abs(v) > Math.abs(v0) * 0.5, `反向后头两帧还顺着原方向走，不停顿（速度连续）——${desc}`);
      }
      void v1;
      await page.evaluate(() => new Promise((res) => setTimeout(res, 50)));
      await waitForAnimationsDone(page, 6000);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#13 标签页：按下时文字变淡（0.6），不出现“文件夹页签”形状的灰底', async () => {
  const app = await open('#/dev/primitives');
  try {
    const { page } = app;
    await center(app, tid('tabs-main'));
    const tab = `${tid('tabs-main')} [role="tab"]:nth-of-type(2)`;
    const box = await page.$eval(tab, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, bg: getComputedStyle(el).backgroundColor };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await sleep(160);
    const st = await page.$eval(tab, (el) => ({ bg: getComputedStyle(el).backgroundColor, o: Number(getComputedStyle(el).opacity) }));
    await page.mouse.up();
    assert.equal(st.bg, box.bg, '按下不换底色');
    assert.ok(Math.abs(st.o - 0.6) < 0.05, `按下文字变淡：${st.o}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #15 全屏菜单：遮罩随圆变深、错落更紧凑
// ---------------------------------------------------------------------
test('#15 全屏菜单：圆后面的遮罩随圆一起变深（浅色下也看得出扩散）；菜单项错落间隔 20ms、最多错开 6 项', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('menu-button'));
    const read = () => {
      const scrim = document.querySelector('.ov-layer--menu .ov-fsmenu-scrim');
      return { scrim: scrim ? Number(getComputedStyle(scrim).opacity) : -1 };
    };
    const c = await captureAt(app, () => page.click(tid('menu-button')), { selector: '.ov-fsmenu', progress: 0.3, evaluate: read });
    await shot(app, 'review-15-menu-open-030');
    const delays = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.effect?.target?.matches?.('[data-ov-stagger]'))
      .map((a) => a.effect.getTiming().delay)
      .sort((x, y) => x - y));
    await release(c);
    assert.ok(between(c.state.scrim, 0, 1, 0.05), `遮罩在变深：${c.state.scrim}`);
    const steps = delays.slice(1).map((d, i) => Math.round(d - delays[i]));
    assert.ok(steps.every((s) => s === 0 || s === 20), `错落间隔 20ms：${steps}`);
    assert.ok(delays[delays.length - 1] - delays[0] <= 6 * 20 + 1, `最多错开 6 项：${delays}`);
    await waitForAnimationsDone(page, 4000);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('#15 全屏菜单（按钮在页面中间、没有替身）：从一个点扩散；收回的最后一段圆跟着半径变透明，按钮从下面透出来（不被白色圆片压着）', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    await center(app, tid('menu-button'));
    const read = () => {
      const menu = document.querySelector('.ov-fsmenu');
      const m = /circle\(([\d.]+)px/.exec(getComputedStyle(menu).clipPath);
      const b = document.querySelector('[data-testid="menu-button"]').getBoundingClientRect();
      const btn = document.querySelector('[data-testid="menu-button"]');
      return { r: m ? parseFloat(m[1]) : -1, opacity: Number(getComputedStyle(menu).opacity), rb: Math.min(b.width, b.height) / 2, btn: Number(getComputedStyle(btn).opacity), hidden: btn.hasAttribute('data-overlay-anchor-hidden') };
    };
    const first = await captureAt(app, () => page.click(tid('menu-button')), { selector: '.ov-fsmenu', progress: 0, evaluate: read });
    await release(first);
    assert.ok(first.state.r < 1, `第 0 帧圆是一个点：${first.state.r}`);
    assert.ok(first.state.opacity < 0.05, `第 0 帧不会有白色圆片盖住按钮：${first.state.opacity}`);
    assert.ok(!first.state.hidden && first.state.btn === 1, '没有替身时真按钮不会被变透明（第 0 帧图标不消失）');
    await waitForAnimationsDone(page, 4000);
    assert.equal(await page.$eval('.ov-fsmenu', (el) => getComputedStyle(el).opacity), '1', '展开后完全不透明（内联值清掉）');
    const samples = [];
    for (const progress of [0.2, 0.45, 0.6, 0.8]) {
      const c = await captureAt(app, () => page.keyboard.press('Escape'), { selector: '.ov-fsmenu', progress, evaluate: read });
      if (progress === 0.6) await shot(app, 'review-15-menu-close-060');
      samples.push(c.state);
      await release(c);
      await waitForAnimationsDone(page, 4000);
      await page.waitForFunction(() => !document.querySelector('.ov-fsmenu'), { timeout: 5000 });
      await page.click(tid('menu-button'));
      await page.waitForSelector('.ov-fsmenu');
      await waitForAnimationsDone(page, 4000);
    }
    const desc = samples.map((x) => `r=${x.r.toFixed(1)} 不透明度 ${x.opacity.toFixed(2)}`).join('；');
    for (const x of samples) {
      if (x.r >= x.rb * 2.5) assert.equal(x.opacity, 1, `圆还大的时候不透明（${desc}）`);
      if (x.r <= x.rb) assert.ok(x.opacity < 0.5, `圆缩到按钮那么大时已经淡了一大半（${desc}）`);
      assert.ok(!x.hidden && x.btn === 1, `收回途中真按钮一直在（被菜单盖着，圆变透明时透出来）（${desc}）`);
    }
    assert.ok(samples.some((x) => x.r < x.rb * 2.5), `取样里有圆已经小到按钮附近的帧（${desc}）`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ov-fsmenu'), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #16 弹层开关时背后页面不跳
// ---------------------------------------------------------------------
test('#16 #/dev/overlays：打开 / 关闭面板、菜单、确认框，背后页面的 scrollY 不变（不跳）', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    for (const [btn, closeSel] of [['fab', null], ['menu-button', null], ['open-place', null], ['confirm-normal', null]]) {
      await center(app, tid(btn));
      const y0 = await page.evaluate(() => window.scrollY);
      await page.click(tid(btn));
      await page.waitForFunction(() => /sheet=/.test(location.hash));
      await waitForAnimationsDone(page, 4000);
      const y1 = await page.evaluate(() => window.scrollY);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !/sheet=/.test(location.hash), { timeout: 5000 });
      await waitForAnimationsDone(page, 4000);
      const y2 = await page.evaluate(() => window.scrollY);
      assert.equal(y1, y0, `${btn}：打开后 scrollY 不变`);
      assert.equal(y2, y0, `${btn}：关闭后 scrollY 不变`);
      void closeSel;
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// #17 浮层按钮：触屏上能滑出再滑回
// ---------------------------------------------------------------------
test('#17 浮层按钮（悬浮加号、顶栏、替身）写 data-press-float：touch-action 是 none，触屏上滑出再滑回松手照样触发（只一次）；普通按钮仍然能从它开始滚动页面', async () => {
  const app = await open('#/dev/overlays');
  try {
    const { page } = app;
    assert.equal(await page.$eval(tid('fab'), (el) => getComputedStyle(el).touchAction), 'none');
    assert.notEqual(await page.$eval(tid('open-expense'), (el) => getComputedStyle(el).touchAction), 'none');
    await page.click(tid('fab'));
    await page.waitForSelector(tid('panel-fab-anchor'));
    assert.equal(await page.$eval(tid('panel-fab-anchor'), (el) => getComputedStyle(el).touchAction), 'none');
    await waitForAnimationsDone(page, 4000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/sheet=/.test(location.hash));
    await waitForAnimationsDone(page, 4000);

    // 触屏：在悬浮加号上按住 → 往左滑出 96px（按下态取消）→ 滑回来 → 松手：照样触发、只触发一次（面板打开）
    const cdp = await page.createCDPSession();
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const slideOutAndBack = async (id) => {
      await center(app, tid(id));
      const r = await page.$eval(tid(id), (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.evaluate((sel) => {
        window.__clicks = 0;
        window.__cancel = 0;
        const el = document.querySelector(sel);
        el.addEventListener('click', () => { window.__clicks += 1; });
        el.addEventListener('pointercancel', () => { window.__cancel += 1; });
      }, tid(id));
      const states = [];
      await touch('touchStart', r.x, r.y);
      for (const dx of [12, 24, 36, 48, 60, 72, 84, 96, 84, 72, 60, 48, 36, 24, 12, 0]) {
        await touch('touchMove', r.x - dx, r.y);
        await raf(page, 1);
        states.push(await page.$eval(tid(id), (el) => el.hasAttribute('data-pressed')));
      }
      await touch('touchEnd', r.x, r.y);
      await sleep(400);
      return { states, clicks: await page.evaluate(() => window.__clicks), cancel: await page.evaluate(() => window.__cancel) };
    };
    const fab = await slideOutAndBack('fab');
    assert.equal(fab.cancel, 0, '浮层按钮上滑动不会被浏览器取消');
    assert.ok(fab.states.includes(false) && fab.states.at(-1) === true, `滑出时按下态取消、滑回又按下：${fab.states}`);
    assert.equal(fab.clicks, 1, '滑回来松手：触发且只触发一次');
    await page.waitForFunction(() => /sheet=demo-fab/.test(location.hash), { timeout: 3000 });
    await waitForAnimationsDone(page, 4000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/sheet=/.test(location.hash));
    await waitForAnimationsDone(page, 4000);
    // 普通按钮：横着一滑浏览器就接管（pointercancel），不触发
    const plain = await slideOutAndBack('open-expense');
    assert.equal(plain.clicks, 0, '普通按钮滑动后不触发');
    assert.ok(!/sheet=/.test(await page.evaluate(() => location.hash)));
    app.assertClean();
  } finally {
    await app.close();
  }
});
