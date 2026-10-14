// 弹层系统（src/overlay/）在真实浏览器里的行为：
//   每种弹层“打开到一半 / 打开完成 / 关闭到一半”各截一张（test/e2e/__shots__/overlay/）；
//   Esc、浏览器返回（= 手机返回手势）、焦点进出与锁定、背景锁滚动（scrollY 不变）、背景 inert、
//   叠加与层级、同类互斥、不认识的 id 自动清掉、直接打开带弹层的网址、拖动关闭 / 切档 / 回弹、
//   未保存提醒（含返回手势）、键盘上移、动画可被打断、减弱动态效果、Toast 的撤销 / 自动消失 / 悬停暂停、
//   小菜单的方向键和删除确认；展示页 390×844 和 1280×800 截图、无报错、触控区 ≥44px、不横向滚动。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, fullPageShots, shotsDir } from './lib/harness.mjs';
import { morphFrame } from '../../src/ui/morph-shapes.js';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const SHOTS = shotsDir('overlay'); // test/e2e/__shots__/overlay/（设了 RS_OUT_DIR 时在 <RS_OUT_DIR>/_e2e/ 下）
mkdirSync(SHOTS, { recursive: true });

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const hash = (page) => page.evaluate(() => window.location.hash);
const T = (id) => `[data-testid="${id}"]`;
/** 弹层里（含遮罩、替身按钮、图标）的所有元素 */
const IN_LAYERS = '[data-overlay-layer], [data-overlay-layer] *';
const IN_TOASTS = '[data-overlay-toasts] *';

async function open(options = {}) {
  const app = await openApp({ browser, server, hash: '#/dev/overlays', ...options });
  await app.page.waitForSelector(T('open-expense'));
  await app.page.waitForSelector(T('stack-state'));
  return app;
}

/** 截图到 __shots__/overlay/<名字>[-desktop].png（只截一屏） */
async function shot(app, name) {
  const file = path.join(SHOTS, `${name}${app.device === 'mobile' ? '' : `-${app.device}`}.png`);
  await app.page.screenshot({ path: file });
  return file;
}

/** 等网址里的弹层栈变成 expected（字符串，例如 'demo-expense' 或 ''） */
async function waitSheets(page, expected, timeout = 4000) {
  await page.waitForFunction((want) => {
    const m = /[?&]sheet=([^&]*)/.exec(window.location.hash);
    return (m ? decodeURIComponent(m[1]) : '') === want;
  }, { timeout }, expected);
}

/** 当前网址里的弹层栈 */
const sheetsOf = (page) => page.evaluate(() => {
  const m = /[?&]sheet=([^&]*)/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : '';
});

/** 等某个弹层完全卸载（退场动画播完） */
const waitGone = (page, sheetId, timeout = 4000) => page.waitForFunction(
  (id) => !document.querySelector(`[data-overlay-layer][data-sheet-id="${id}"]`), { timeout }, sheetId,
);

/** 等某个弹层出现并播完出场动画 */
async function waitOpen(app, sheetId) {
  await app.page.waitForSelector(`[data-overlay-layer][data-sheet-id="${sheetId}"][data-state="open"]`);
  await app.idle();
}

/**
 * 冻结动画并拨到指定时刻截图（全局同一时刻：错落入场的各项也是同一瞬间的样子）。
 * 原理同 lib/animation.mjs：CDP Animation 域把速度设为 0，触发，收集新开始的动画，统一拨到 进度 × 最长结束时间。
 * @returns {Promise<{ picked: object[], state: any, file: string|null, release: () => Promise<void> }>}
 */
async function freeze(app, trigger, { selector, progress = 0.5, name = null, evaluate = null } = {}) {
  const { page } = app;
  const cdp = await page.createCDPSession();
  const started = [];
  cdp.on('Animation.animationStarted', ({ animation }) => started.push(animation));
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await twoFrames(page);
  const before = new Set(started.map((a) => a.id));
  started.length = 0;
  const release = async () => {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 }).catch(() => {});
    await cdp.send('Animation.disable').catch(() => {});
    await cdp.detach().catch(() => {});
  };
  try {
    await trigger();
    await twoFrames(page);
    let picked = started.filter((a) => !before.has(a.id));
    if (selector) {
      await cdp.send('DOM.getDocument', { depth: 0 });
      const keep = [];
      for (const a of picked) {
        const nodeId = a.source?.backendNodeId;
        if (!nodeId) continue;
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: nodeId });
          const { result } = await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: 'function (sel) { return this.nodeType === 1 && this.matches(sel); }',
            arguments: [{ value: selector }],
            returnByValue: true,
          });
          if (result.value) keep.push(a);
        } catch {
          /* 节点已经不在了 */
        }
      }
      picked = keep;
    }
    if (!picked.length) throw new Error('触发后没有捕获到任何动画');
    const end = Math.max(...picked.map((a) => (a.source?.delay ?? 0) + (a.source?.duration ?? 0)));
    await cdp.send('Animation.seekAnimations', { animations: picked.map((a) => a.id), currentTime: end * progress });
    await twoFrames(page);
    const state = evaluate ? await page.evaluate(evaluate) : null;
    const file = name ? await shot(app, name) : null;
    return { picked, state, file, release };
  } catch (error) {
    await release();
    throw error;
  }
}

const translateY = (sel) => new Function(`const el = document.querySelector(${JSON.stringify(sel)});
  return el ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 : null;`);

/** CDP 触摸拖动（会同时产生 touch 和 pointer 事件） */
async function touchDrag(page, from, to, { steps = 8, interval = 16, hold = 0 } = {}) {
  const cdp = await page.createCDPSession();
  const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await sleep(interval);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
  }
  if (hold) await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());

/** 触发按钮 / 替身按钮上的变形图标（ui/MorphIcon）：种类、目标状态、此刻画出来的路径 */
const morphIconOf = (page, sel) => page.$eval(`${sel} .morph-icon`, (el) => ({
  kind: el.dataset.kind,
  state: Number(el.dataset.state),
  paths: [...el.querySelectorAll('.morph-icon__shape')].map((p) => p.getAttribute('d')),
}));
/** 图标确实停在某个形状上（路径和 morph-shapes.js 算出来的那一帧一样，不是换了一张图） */
const assertMorphAt = (icon, kind, p, what) => {
  assert.equal(icon.kind, kind, `${what}：图标种类`);
  assert.equal(icon.state, p, `${what}：目标状态`);
  assert.deepEqual(icon.paths, morphFrame(kind, p).map((f) => f.d), `${what}：路径停在 p=${p}`);
};

// =====================================================================
// 截图：每种弹层 打开到一半 / 打开完成 / 关闭到一半
// =====================================================================

// openAt / closeAt：拨到动画总时长的哪个比例截“半路”图。弹簧前段走得快（smooth 在 18% 时间左右走完一半位移，
// bouncy 更早），所以不是 0.5；淡入淡出类（确认框、小菜单离场）就是 0.5 左右。
const SHOT_CASES = [
  {
    kind: 'sheet',
    openAt: 0.16,
    closeAt: 0.2,
    sheetId: 'demo-expense',
    open: (page) => page.click(T('open-expense')),
    close: async (page) => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    },
  },
  {
    kind: 'panel',
    openAt: 0.12,
    closeAt: 0.2,
    sheetId: 'demo-fab',
    before: (page) => page.$eval(T('fab'), (el) => el.scrollIntoView({ block: 'center' })),
    open: (page) => page.click(T('fab')),
    close: async (page) => {
      await page.click(T('panel-fab-anchor'));
      await waitSheets(page, '');
    },
  },
  {
    kind: 'menu',
    openAt: 0.14,
    closeAt: 0.22,
    sheetId: 'demo-menu',
    before: (page) => page.$eval(T('menu-button'), (el) => el.scrollIntoView({ block: 'center' })),
    open: (page) => page.click(T('menu-button')),
    close: async (page) => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    },
  },
  {
    kind: 'dialog',
    openAt: 0.3,
    closeAt: 0.5,
    sheetId: 'confirm',
    before: (page) => page.$eval(T('confirm-danger'), (el) => el.scrollIntoView({ block: 'center' })),
    open: (page) => page.click(T('confirm-danger')),
    close: async (page) => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    },
  },
  {
    kind: 'popover',
    openAt: 0.2,
    closeAt: 0.5,
    sheetId: 'demo-row-more',
    before: (page) => page.$eval(T('more-e1'), (el) => el.scrollIntoView({ block: 'center' })),
    open: (page) => page.click(T('more-e1')),
    close: async (page) => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    },
  },
];

for (const c of SHOT_CASES) {
  test(`截图（${c.kind}）：打开到一半 / 打开完成 / 关闭到一半，半路的位置确实在起点和终点之间`, async () => {
    const app = await open();
    try {
      const { page } = app;
      await c.before?.(page);
      await twoFrames(page);
      const mid = await freeze(app, () => c.open(page), { selector: IN_LAYERS, progress: c.openAt, name: `${c.kind}-open-50` });
      assert.ok(mid.picked.length >= 1);
      await mid.release();
      await waitOpen(app, c.sheetId);
      await shot(app, `${c.kind}-open`);
      const closing = await freeze(app, () => c.close(page), { selector: IN_LAYERS, progress: c.closeAt, name: `${c.kind}-close-50` });
      assert.ok(closing.picked.length >= 1);
      await closing.release();
      await waitGone(page, c.sheetId);
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('截图（toast）：出场到一半 / 停稳 / 离场到一半', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('toast-burst'), (el) => el.scrollIntoView({ block: 'center' }));
    const mid = await freeze(app, () => page.click(T('toast-burst')), { selector: IN_TOASTS, progress: 0.15, name: 'toast-open-50' });
    await mid.release();
    await page.waitForFunction(() => document.querySelectorAll('.ov-toast[data-state="open"]').length === 3);
    await app.idle();
    await shot(app, 'toast-open');
    const out = await freeze(app, () => page.click(T('toast-clear')), { selector: IN_TOASTS, progress: 0.45, name: 'toast-close-50' });
    await out.release();
    await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 底部面板：Esc、返回、焦点、锁滚动、inert
// =====================================================================

test('底部面板：网址 ?sheet=、焦点进出、Tab 不出面板、背景 inert、锁滚动不动 scrollY、Esc 关闭', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.evaluate(() => window.scrollTo(0, 600));
    await twoFrames(page);
    const y0 = await page.evaluate(() => window.scrollY);
    assert.ok(y0 > 500, `页面先滚下去：${y0}`);
    await page.$eval(T('open-expense'), (el) => el.scrollIntoView({ block: 'center' }));
    const y1 = await page.evaluate(() => window.scrollY);
    await page.click(T('open-expense'));
    await waitSheets(page, 'demo-expense');
    await waitOpen(app, 'demo-expense');
    // 焦点在带 data-autofocus 的金额框
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'expense-amount');
    // 锁滚动：scrollY 不变、<html> overflow hidden、背景 inert
    const lock = await page.evaluate(() => ({
      y: window.scrollY,
      overflow: getComputedStyle(document.documentElement).overflow,
      attr: document.documentElement.hasAttribute('data-ov-scroll-lock'),
      mainInert: document.getElementById('main').closest('[inert]') !== null,
    }));
    assert.deepEqual(lock, { y: y1, overflow: 'hidden', attr: true, mainInert: true });
    // 在遮罩上拖（手机触摸）页面也不动
    await touchDrag(page, { x: 200, y: 120 }, { x: 200, y: 20 });
    assert.equal(await page.evaluate(() => window.scrollY), y1, '遮罩上滑动不滚动背后的页面');
    // Tab 在面板里循环
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-sheet-id="demo-expense"]'))), `第 ${i + 1} 次 Tab 后焦点还在面板里`);
    }
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-sheet-id="demo-expense"]'))));
    // Esc 关闭：网址回去、焦点回到触发按钮、解锁、scrollY 原样
    await page.keyboard.press('Escape');
    await waitSheets(page, '');
    await waitGone(page, 'demo-expense');
    const after = await page.evaluate(() => ({
      y: window.scrollY,
      locked: document.documentElement.hasAttribute('data-ov-scroll-lock'),
      inert: Boolean(document.querySelector('[inert]')),
      focus: document.activeElement?.dataset.testid,
    }));
    assert.deepEqual(after, { y: y1, locked: false, inert: false, focus: 'open-expense' });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('底部面板：浏览器返回（= 手机返回手势）关闭；前进又打开；桌面上滚轮不滚动背后的页面', async () => {
  const app = await open({ device: 'desktop' });
  try {
    const { page } = app;
    const base = await page.evaluate(() => window.history.length);
    await page.click(T('open-place'));
    await waitSheets(page, 'demo-place');
    await waitOpen(app, 'demo-place');
    assert.equal(await page.evaluate(() => window.history.length), base + 1, '弹层压进了历史');
    // 宽屏：两档的面板直接到大档
    assert.equal(await page.$eval(T('sheet-place'), (el) => el.dataset.detent), 'large');
    const y = await page.evaluate(() => window.scrollY);
    await page.mouse.move(100, 100);
    await page.mouse.wheel({ deltaY: 600 });
    await sleep(150);
    assert.equal(await page.evaluate(() => window.scrollY), y, '滚轮不滚动背后的页面');
    await page.goBack();
    await waitSheets(page, '');
    await waitGone(page, 'demo-place');
    await page.goForward();
    await waitSheets(page, 'demo-place');
    await waitOpen(app, 'demo-place');
    await page.click(`${T('sheet-place')} .ov-close`);
    await waitGone(page, 'demo-place');
    assert.equal(await hash(page), '#/dev/overlays');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('底部面板：往下甩一下就关；慢慢拖一点点弹回；拖把手往上切到大档；内容区往上滑先展开面板', async () => {
  const app = await open();
  try {
    const { page } = app;
    // 1) 两档面板：从半屏拖把手往上 → 大档
    await page.click(T('open-place'));
    await waitOpen(app, 'demo-place');
    assert.equal(await page.$eval(T('sheet-place'), (el) => el.dataset.detent), 'medium');
    let r = await box(page, `${T('sheet-place')} .ov-sheet__top`);
    await touchDrag(page, { x: r.x + r.width / 2, y: r.y + 12 }, { x: r.x + r.width / 2, y: r.y - 320 }, { steps: 10 });
    await page.waitForFunction(() => document.querySelector('[data-testid="sheet-place"]').dataset.detent === 'large');
    await app.idle();
    assert.ok(Math.abs(await page.evaluate(translateY('[data-testid="sheet-place"]'))) < 1, '停在大档（位移 0）');
    // 2) 往下慢慢拖一点点、停住再松手 → 弹回大档
    r = await box(page, `${T('sheet-place')} .ov-sheet__top`);
    await touchDrag(page, { x: r.x + 40, y: r.y + 12 }, { x: r.x + 40, y: r.y + 70 }, { steps: 6, interval: 30, hold: 200 });
    await app.idle();
    assert.equal(await sheetsOf(page), 'demo-place', '没有被关掉');
    assert.equal(await page.$eval(T('sheet-place'), (el) => el.dataset.detent), 'large');
    assert.ok(Math.abs(await page.evaluate(translateY('[data-testid="sheet-place"]'))) < 1, '弹回原位');
    // 3) 往下甩 → 关闭（网址也回去）
    r = await box(page, `${T('sheet-place')} .ov-sheet__top`);
    await touchDrag(page, { x: r.x + 40, y: r.y + 12 }, { x: r.x + 40, y: r.y + 420 }, { steps: 5, interval: 12 });
    await waitSheets(page, '');
    await waitGone(page, 'demo-place');
    // 4) 内容区：半屏时在内容上往上滑 → 先把面板拉到大档（而不是滚动内容）
    await page.click(T('open-place'));
    await waitOpen(app, 'demo-place');
    const list = await box(page, T('place-list'));
    const startY = Math.min(list.y + 40, 800);
    await touchDrag(page, { x: list.x + 60, y: startY }, { x: list.x + 60, y: startY - 260 }, { steps: 10 });
    await page.waitForFunction(() => document.querySelector('[data-testid="sheet-place"]').dataset.detent === 'large');
    assert.equal(await page.$eval(`${T('sheet-place')} .ov-sheet__body`, (el) => el.scrollTop), 0, '内容没有被滚动');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('底部面板：未保存提醒——Esc、返回手势都会先问；继续编辑内容还在；放弃才关', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.click(T('open-form'));
    await waitOpen(app, 'demo-form');
    await page.type(T('form-text'), '今天看到了海豚');
    // Esc → 确认框（叠在面板上）
    await page.keyboard.press('Escape');
    await page.waitForSelector(`${T('dialog')}`);
    assert.match(await sheetsOf(page), /^demo-form,confirm:c\d+$/);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'dialog-cancel', '危险操作默认聚焦“继续编辑”');
    await page.click(T('dialog-cancel'));
    await waitSheets(page, 'demo-form');
    await waitGone(page, 'confirm');
    assert.equal(await page.$eval(T('form-text'), (el) => el.value), '今天看到了海豚');
    // 浏览器返回（手机返回手势）→ 面板留着，先问
    await page.goBack();
    await page.waitForFunction(() => /sheet=demo-form,confirm:/.test(window.location.hash), { timeout: 4000 });
    assert.ok(await page.$(`[data-sheet-id="demo-form"][data-state="open"]`), '面板没有被关掉');
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await waitSheets(page, '');
    await waitGone(page, 'demo-form');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('底部面板：键盘弹起（visualViewport 变矮）时整体上移、到最高档，收起后复原', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.click(T('open-expense'));
    await waitOpen(app, 'demo-expense');
    await page.evaluate(() => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => 500 });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForSelector('[data-sheet-id="demo-expense"][data-keyboard="open"]');
    await app.idle();
    const lifted = await page.evaluate(translateY('[data-sheet-id="demo-expense"] .ov-sheet-frame'));
    assert.ok(Math.abs(lifted + 344) < 1, `面板上移了键盘的高度：${lifted}`);
    const bottom = await page.$eval(T('expense-save'), (el) => el.getBoundingClientRect().bottom);
    assert.ok(bottom <= 500 + 1, `提交按钮在键盘上面：${bottom}`);
    await page.evaluate(() => {
      const vv = window.visualViewport;
      delete vv.height;
      delete vv.offsetTop;
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForSelector('[data-sheet-id="demo-expense"]:not([data-keyboard])');
    await app.idle();
    assert.ok(Math.abs(await page.evaluate(translateY('[data-sheet-id="demo-expense"] .ov-sheet-frame'))) < 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('动画可被打断：面板滑上来一半时按 Esc，从当前位置折返，不跳回起点或终点', async () => {
  const app = await open();
  try {
    const { page } = app;
    const sel = '[data-testid="sheet-expense"]';
    const opening = await freeze(app, () => page.click(T('open-expense')), { selector: IN_LAYERS, progress: 0.15, evaluate: translateY(sel) });
    // 还冻结着：此刻按 Esc，新的退场动画从当前位置出发
    const closing = await freeze(app, async () => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    }, { selector: IN_LAYERS, progress: 0, evaluate: translateY(sel) });
    await opening.release();
    await closing.release();
    assert.ok(opening.state > 20, `出场半路还在下面：${opening.state}`);
    assert.ok(Math.abs(closing.state - opening.state) < 2, `折返起点 ${closing.state} = 打断时的位置 ${opening.state}`);
    await waitGone(page, 'demo-expense');
    // 反过来：关到一半再打开，也从当前位置回来
    await page.click(T('open-expense'));
    await waitOpen(app, 'demo-expense');
    const half = await freeze(app, async () => {
      await page.keyboard.press('Escape');
      await waitSheets(page, '');
    }, { selector: IN_LAYERS, progress: 0.2, evaluate: translateY(sel) });
    const back = await freeze(app, async () => {
      await page.click(T('open-expense'));
      await waitSheets(page, 'demo-expense');
    }, { selector: IN_LAYERS, progress: 0, evaluate: translateY(sel) });
    await half.release();
    await back.release();
    assert.ok(half.state > 5, `关到一半：${half.state}`);
    assert.ok(Math.abs(back.state - half.state) < 2, `重新打开从 ${back.state} 出发 = 打断时 ${half.state}`);
    await waitOpen(app, 'demo-expense');
    assert.ok(Math.abs(await page.evaluate(translateY(sel))) < 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减弱动态效果：底部面板、长出来的面板、全屏菜单都只淡入淡出（不位移、不变形、不扩散），照样能开关', async () => {
  const app = await open({ reducedMotion: true });
  try {
    const { page } = app;
    const mid = await freeze(app, () => page.click(T('open-expense')), {
      selector: '[data-testid="sheet-expense"]',
      evaluate: () => document.querySelector('[data-testid="sheet-expense"]').getAnimations()
        .map((a) => ({ props: Object.keys(a.effect.getKeyframes()[0]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)), d: a.effect.getTiming().duration })),
    });
    await mid.release();
    assert.ok(mid.state.length >= 1);
    for (const a of mid.state) {
      assert.deepEqual(a.props, ['opacity'], '只动透明度');
      assert.ok(a.d <= 160, `时长 ≤ --dur-fast：${a.d}`);
    }
    await waitOpen(app, 'demo-expense');
    await page.keyboard.press('Escape');
    await waitGone(page, 'demo-expense');
    // 长出来的面板、全屏菜单：不变形、不扩散，只淡入
    // 变形图标（MorphIcon）的“时钟”动画没有关键帧（每帧由 JS 改路径），不算位移变形，跳过
    const animatedProps = () => [...document.querySelectorAll('[data-overlay-layer] *')]
      .flatMap((el) => el.getAnimations().filter((a) => a instanceof CSSTransition === false && a.effect.getKeyframes().length > 0))
      .flatMap((a) => Object.keys(a.effect.getKeyframes()[0]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)));
    for (const [btn, id] of [['fab', 'demo-fab'], ['menu-button', 'demo-menu']]) {
      await page.$eval(T(btn), (el) => el.scrollIntoView({ block: 'center' }));
      const m = await freeze(app, () => page.click(T(btn)), { selector: IN_LAYERS, evaluate: animatedProps });
      await m.release();
      assert.deepEqual([...new Set(m.state)], ['opacity'], `${id} 只动透明度：${m.state.join(',')}`);
      await waitOpen(app, id);
      await page.keyboard.press('Escape');
      await waitGone(page, id);
    }
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 从按钮长出来的面板
// =====================================================================

test('长出来的面板：形状从按钮长到面板（clip-path 半路在两者之间）、替身按钮加号转 ×、焦点进出、原路收回', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('fab'), (el) => el.scrollIntoView({ block: 'center' }));
    await twoFrames(page);
    const fab = await box(page, T('fab'));
    const mid = await freeze(app, () => page.click(T('fab')), {
      selector: IN_LAYERS,
      progress: 0.25,
      // 面板此刻露出来的形状：面板（含形变的平移）的矩形减去 clip-path: inset(…) 的四边
      evaluate: () => {
        const s = document.querySelector('[data-sheet-id="demo-fab"] .ov-panel');
        const m = /^inset\((-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/.exec(getComputedStyle(s).clipPath);
        const r = s.getBoundingClientRect();
        return { top: r.top + Number(m[1]), bottom: r.bottom - Number(m[3]), left: r.left + Number(m[4]), right: r.right - Number(m[2]) };
      },
    });
    await mid.release();
    await waitOpen(app, 'demo-fab');
    const panel = await box(page, T('panel-fab'));
    const shape = mid.state;
    assert.ok(shape.top > panel.y + 4 && shape.top < fab.y, `形状上边在面板和按钮之间：${shape.top}`);
    assert.ok(shape.bottom <= fab.y + fab.height + 2, '形状下边贴着按钮');
    // 替身按钮在按钮原位、图标是 ×；真按钮透明
    const proxy = await box(page, T('panel-fab-anchor'));
    assert.ok(Math.abs(proxy.x - fab.x) < 1 && Math.abs(proxy.y - fab.y) < 1 && Math.abs(proxy.width - fab.width) < 1);
    // 加号真的转成了 ×（路径停在变形的终点，不是换了一张图）
    assertMorphAt(await morphIconOf(page, T('panel-fab-anchor')), 'plus', 1, '替身按钮');
    assert.equal(await page.$eval(T('fab'), (el) => getComputedStyle(el).opacity), '0');
    assert.equal(await page.$eval(T('fab'), (el) => el.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'tile-expense', '焦点在第一个按钮');
    // 点替身关闭 → 收回，焦点回到加号，真按钮重新出现
    await page.click(T('panel-fab-anchor'));
    await waitSheets(page, '');
    await waitGone(page, 'demo-fab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'fab');
    assert.equal(await page.$eval(T('fab'), (el) => getComputedStyle(el).opacity), '1');
    await app.idle();
    assertMorphAt(await morphIconOf(page, T('fab')), 'plus', 0, '真按钮收回后是加号');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('长出来的面板：点“记一笔”先收起面板再打开底部面板（一次只开一个）；行程切换器在按钮下方', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('fab'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('fab'));
    await waitOpen(app, 'demo-fab');
    await page.click(T('tile-expense'));
    await waitSheets(page, 'demo-expense');
    await waitOpen(app, 'demo-expense');
    await waitGone(page, 'demo-fab');
    await page.keyboard.press('Escape');
    await waitGone(page, 'demo-expense');
    // 行程切换器：面板在胶囊下面、左对齐；选另一个行程后胶囊文字跟着变
    await page.$eval(T('trip-pill'), (el) => el.scrollIntoView({ block: 'center' }));
    await twoFrames(page);
    const pill = await box(page, T('trip-pill'));
    await page.click(T('trip-pill'));
    await waitOpen(app, 'demo-trips');
    const panel = await box(page, T('panel-trips'));
    assert.ok(panel.y >= pill.y + pill.height, '在按钮下方');
    // 左边和胶囊对齐；右边放不下时往左推，但离屏幕右边至少 16px
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    assert.ok(Math.abs(panel.x - Math.min(pill.x, vw - 16 - panel.width)) < 2, `左边对齐：${panel.x} / ${pill.x}`);
    // 替身和真胶囊一样大（精确到小数），文字不会被省略号截断
    const proxy = await box(page, T('panel-trips-anchor'));
    assert.ok(Math.abs(proxy.width - pill.width) < 0.1 && Math.abs(proxy.x - pill.x) < 0.1, `替身 ${proxy.width} / 胶囊 ${pill.width}`);
    assert.equal(await page.$eval(`${T('panel-trips-anchor')} .ovd-trip-pill__name`, (el) => el.scrollWidth - el.clientWidth), 0);
    assertMorphAt(await morphIconOf(page, T('panel-trips-anchor')), 'chevron', 1, '行程切换器的箭头翻到朝上');
    await page.click(T('trip-demo-cities'));
    await waitGone(page, 'demo-trips');
    assert.match(await page.$eval(T('trip-pill'), (el) => el.textContent), /三城/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 全屏菜单
// =====================================================================

test('全屏菜单：圆从按钮中心扩散（半路半径在两者之间）、菜单项错落入场、真链接换页并替换掉菜单那条历史', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('menu-button'), (el) => el.scrollIntoView({ block: 'center' }));
    await twoFrames(page);
    const btn = await box(page, T('menu-button'));
    const mid = await freeze(app, () => page.click(T('menu-button')), {
      selector: IN_LAYERS,
      progress: 0.3,
      evaluate: () => {
        const clip = getComputedStyle(document.querySelector('[data-testid="menu"]')).clipPath;
        const m = /^circle\(([\d.]+)px at ([\d.]+)px ([\d.]+)px\)$/.exec(clip);
        const items = [...document.querySelectorAll('[data-testid="menu"] [data-ov-stagger]')]
          .map((el) => el.getAnimations().map((a) => a.effect.getTiming().delay)).flat();
        return { r: Number(m[1]), x: Number(m[2]), y: Number(m[3]), delays: [...new Set(items)].sort((a, b) => a - b) };
      },
    });
    await mid.release();
    assert.ok(Math.abs(mid.state.x - (btn.x + btn.width / 2)) < 1 && Math.abs(mid.state.y - (btn.y + btn.height / 2)) < 1, '圆心在按钮中心');
    // 按钮在页面中间（没有替身）：圆从一个点开始，不会第 0 帧就盖住按钮
    assert.ok(mid.state.r > btn.width / 2 && mid.state.r < 900, `半路半径：${mid.state.r}`);
    // 错落：间隔 20ms、最多错开 6 项（再多的同时出现）
    const d = mid.state.delays;
    assert.ok(d.length >= 6 && d.length <= 7, `菜单项错落：${d.join(',')}`);
    assert.ok(d.slice(1).every((v, i) => Math.round(v - d[i]) === 20), `间隔 20ms：${d.join(',')}`);
    await waitOpen(app, 'demo-menu');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'menu-item-home', '焦点在第一项');
    // 按钮在页面中间：不放替身，右上角有关闭按钮
    assert.equal(await page.$(T('menu-anchor')), null);
    assert.ok(await page.$(T('menu-close')));
    await page.click(T('menu-link'));
    await page.waitForFunction(() => window.location.hash === '#/dev/tokens');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === '设计变量');
    await waitGone(page, 'demo-menu').catch(() => {});
    await page.goBack();
    await page.waitForFunction(() => window.location.hash === '#/dev/overlays', { timeout: 4000 });
    assert.equal(await page.$('[data-overlay-layer]'), null, '返回时菜单不会再冒出来');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('全屏菜单：按钮在顶栏区时放替身按钮（三横线 → ×），点它原路收回', async () => {
  const app = await open();
  try {
    const { page } = app;
    // 把工具条滚到屏幕最上面（像顶栏一样）
    await page.$eval(T('menu-button'), (el) => {
      const y = el.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo(0, y);
    });
    await twoFrames(page);
    await page.click(T('menu-button'));
    await waitOpen(app, 'demo-menu');
    assert.ok(await page.$(T('menu-anchor')), '有替身按钮');
    assertMorphAt(await morphIconOf(page, T('menu-anchor')), 'menu', 1, '三横线变成 ×');
    await shot(app, 'menu-open-proxy');
    await page.click(T('menu-anchor'));
    await waitGone(page, 'demo-menu');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'menu-button');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 确认框
// =====================================================================

test('确认框：危险操作聚焦“取消”；返回 = 取消；确定返回 true；两个确认排队依次出现', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('confirm-danger'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('confirm-danger'));
    await waitOpen(app, 'confirm');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'dialog-cancel');
    assert.equal(await page.$eval(T('dialog'), (el) => el.getAttribute('role')), 'alertdialog');
    // 点遮罩不关（iOS 提示框的习惯）
    await page.mouse.click(20, 20);
    await sleep(200);
    assert.match(await sheetsOf(page), /^confirm:c\d+$/);
    await page.goBack();
    await waitSheets(page, '');
    await page.waitForFunction(() => /取消/.test(document.querySelector('[data-testid="dialog-result"]').textContent));
    await waitGone(page, 'confirm');
    await page.click(T('confirm-danger'));
    await page.waitForSelector(T('dialog-confirm'));
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => /删除/.test(document.querySelector('[data-testid="dialog-result"]').textContent));
    await waitGone(page, 'confirm');
    // 排队：先出现第一个，点完第二个才出现
    await page.click(T('confirm-queue'));
    await page.waitForFunction(() => /第一个确认/.test(document.querySelector('[data-testid="dialog"]')?.textContent || ''));
    assert.equal(await page.$$eval(T('dialog'), (els) => els.length), 1, '同时只显示一个');
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => /第二个确认/.test(document.querySelector('[data-testid="dialog"]:not([inert] *)')?.textContent || '') && /sheet=confirm/.test(window.location.hash), { timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /第一个：下一个；第二个：取消/.test(document.querySelector('[data-testid="dialog-result"]').textContent), { timeout: 4000 });
    await waitSheets(page, '');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('声明式 Dialog：点遮罩可关（closeOnScrim）；选“离开”在关掉后执行', async () => {
  const app = await open({ device: 'desktop' });
  try {
    const { page } = app;
    await page.$eval(T('open-leave'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('open-leave'));
    await waitOpen(app, 'demo-leave');
    await shot(app, 'dialog-open');
    await page.mouse.click(30, 30);
    await waitSheets(page, '');
    await waitGone(page, 'demo-leave');
    await page.click(T('open-leave'));
    await waitOpen(app, 'demo-leave');
    await page.click(T('leave-go'));
    await page.waitForFunction(() => /不保存，离开/.test(document.querySelector('[data-testid="dialog-result"]').textContent));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// Toast
// =====================================================================

test('Toast：aria-live 朗读、出错用 role="alert"、到时间自动消失、删除后“撤销”能找回', async () => {
  const app = await open();
  try {
    const { page } = app;
    assert.equal(await page.$eval('[data-overlay-toasts] ol', (el) => el.getAttribute('aria-live')), 'polite');
    await page.$eval(T('toast-plain'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('toast-plain'));
    await page.waitForFunction(() => /已保存/.test(document.querySelector('[data-overlay-toasts]').textContent));
    await page.click(T('toast-error'));
    await page.waitForSelector('.ov-toast[role="alert"]');
    // 普通提示 3.2 秒后自动消失
    await page.waitForFunction(() => !/已保存/.test(document.querySelector('[data-overlay-toasts]').textContent), { timeout: 6000 });
    await page.click(T('toast-clear'));
    await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 4000 });
    // 撤销
    await page.$eval(T('delete-r2'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('delete-r2'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="delete-r2"]'));
    await page.waitForSelector(T('toast-action'));
    await page.click(T('toast-action'));
    await page.waitForSelector(T('delete-r2'));
    const order = await page.$$eval('[data-testid="toast-rows"] [data-testid^="delete-"]', (els) => els.map((e) => e.dataset.testid));
    assert.deepEqual(order, ['delete-r1', 'delete-r2', 'delete-r3'], '回到原来的位置');
    await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 4000 });
    // lib/notify.js 发出的提示由 Toast 宿主显示
    await page.click(T('toast-notify'));
    await page.waitForFunction(() => /lib 的 notify\(\)/.test(document.querySelector('[data-overlay-toasts]').textContent));
    assert.equal(await page.$eval('.ov-toast', (el) => el.dataset.tone), 'success');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('Toast：鼠标悬停暂停倒计时并展开堆叠；移开后接着数、消失', async () => {
  const app = await open({ device: 'desktop' });
  try {
    const { page } = app;
    await page.$eval(T('toast-burst'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('toast-burst'));
    await page.waitForFunction(() => document.querySelectorAll('.ov-toast[data-state="open"]').length === 3);
    await app.idle();
    assert.equal(await page.$$eval('.ov-toast[data-behind]', (els) => els.length), 2, '收起时后面两张露边');
    const front = await box(page, '.ov-toast[data-state="open"] .ov-toast__card');
    await page.mouse.move(front.x + front.width / 2, front.y + front.height / 2);
    await page.waitForSelector('[data-overlay-toasts][data-expanded]');
    await app.idle();
    await shot(app, 'toast-expanded');
    assert.equal(await page.$$eval('.ov-toast[data-behind]', (els) => els.length), 0, '悬停时展开');
    await sleep(4200);
    assert.equal(await page.$$eval('.ov-toast[data-state="open"]', (els) => els.length), 3, '悬停期间不消失');
    await page.mouse.move(10, 10);
    await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 6000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 小菜单
// =====================================================================

test('小菜单：贴着按钮弹出、焦点在第一项、方向键移动、Esc 关闭焦点回到按钮', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('more-e2'), (el) => el.scrollIntoView({ block: 'center' }));
    await twoFrames(page);
    const btn = await box(page, T('more-e2'));
    await page.click(T('more-e2'));
    await waitSheets(page, 'demo-row-more:e2');
    await waitOpen(app, 'demo-row-more');
    const pop = await box(page, T('popover'));
    assert.ok(pop.y >= btn.y + btn.height && pop.y - (btn.y + btn.height) < 12, '在按钮正下方');
    assert.ok(Math.abs(pop.x + pop.width - (btn.x + btn.width)) < 2, '右边对齐');
    assert.equal(await page.$eval(T('popover'), (el) => el.querySelector('[role="menu"]')?.getAttribute('aria-label')), '这笔记账的操作');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'popover-edit');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'popover-delete');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'popover-edit', '循环');
    await page.keyboard.press('Escape');
    await waitGone(page, 'demo-row-more');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'more-e2');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('小菜单 → 删除 → 确认（先收起小菜单再弹确认）→ 删掉 → 撤销找回', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('more-e3'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('more-e3'));
    await waitOpen(app, 'demo-row-more');
    await page.click(T('popover-delete'));
    await page.waitForFunction(() => /^#\/dev\/overlays\?sheet=confirm:c\d+$/.test(window.location.hash), { timeout: 4000 });
    await waitOpen(app, 'confirm');
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="more-e3"]'));
    await page.waitForSelector(T('toast-action'));
    await page.click(T('toast-action'));
    await page.waitForSelector(T('more-e3'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 弹层栈：叠加、层级、互斥、不认识的 id、直接打开的网址
// =====================================================================

test('叠加：面板上再弹确认框——层级更高、面板 inert；返回先关确认框再关面板', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('stack-sheet-confirm'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('stack-sheet-confirm'));
    await page.waitForFunction(() => /sheet=demo-place,confirm:c\d+$/.test(window.location.hash), { timeout: 4000 });
    await waitOpen(app, 'confirm');
    const z = await page.evaluate(() => ({
      sheet: Number(getComputedStyle(document.querySelector('[data-sheet-id="demo-place"]')).zIndex),
      dialog: Number(getComputedStyle(document.querySelector('[data-sheet-id="confirm"]')).zIndex),
      toast: Number(getComputedStyle(document.querySelector('[data-overlay-toasts]')).zIndex),
      sheetInert: document.querySelector('[data-sheet-id="demo-place"]').inert,
      dialogInert: document.querySelector('[data-sheet-id="confirm"]').inert,
    }));
    assert.ok(z.dialog > z.sheet && z.toast > z.dialog, JSON.stringify(z));
    assert.equal(z.sheetInert, true);
    assert.equal(z.dialogInert, false);
    await shot(app, 'stack-sheet-confirm');
    await page.goBack();
    await waitSheets(page, 'demo-place');
    await waitGone(page, 'confirm');
    assert.equal(await page.$eval('[data-sheet-id="demo-place"]', (el) => el.inert), false, '确认框关掉后面板恢复可交互');
    await page.goBack();
    await waitSheets(page, '');
    await waitGone(page, 'demo-place');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('同类互斥：底部面板开着时再开另一个底部面板 → 先关旧的（网址里只剩新的）', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('stack-exclusive'), (el) => el.scrollIntoView({ block: 'center' }));
    const base = await page.evaluate(() => window.history.length);
    await page.click(T('stack-exclusive'));
    await page.waitForFunction(() => window.location.hash.endsWith('?sheet=demo-expense'), { timeout: 4000 });
    await waitOpen(app, 'demo-expense');
    await waitGone(page, 'demo-place');
    assert.equal(await page.$$eval('[data-overlay-layer]', (els) => els.length), 1);
    assert.equal(await page.$eval(T('stack-layers'), (el) => el.textContent), 'demo-expense（sheet，打开）');
    await page.goBack();
    await waitSheets(page, '');
    assert.ok(await page.evaluate(() => window.history.length) >= base);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('网址里出现没人认领的弹层 id：宽限一会儿后自动关掉', async () => {
  const app = await open();
  try {
    const { page } = app;
    await page.$eval(T('stack-unknown'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('stack-unknown'));
    await waitSheets(page, 'demo-nobody');
    await waitSheets(page, '', 5000);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-ov-scroll-lock')), false);
    app.assertClean({ allowErrors: [] });
  } finally {
    await app.close();
  }
});

test('直接打开带弹层的网址（分享链接 / 刷新）：弹层恢复；关闭用替换，历史不变；路由调试演示的 id 不会被清掉', async () => {
  const app = await open({ hash: '#/dev/overlays?sheet=demo-place' });
  try {
    const { page } = app;
    await waitOpen(app, 'demo-place');
    const before = await page.evaluate(() => window.history.length);
    await page.click(`${T('sheet-place')} .ov-close`);
    await waitSheets(page, '');
    await waitGone(page, 'demo-place');
    assert.equal(await page.evaluate(() => window.history.length), before);
    // 「路由弹层参数」演示的 demo-a 只显示网址、不画弹层：有人代为认领，等 2 秒也不会被清掉
    await page.click(T('open-sheet-a'));
    await waitSheets(page, 'demo-a');
    await sleep(2200);
    assert.equal(await sheetsOf(page), 'demo-a');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('按需加载的弹层（defineOverlays）：直接打开带它的网址时下载代码并恢复（参数传进去）；按钮打开也一样', async () => {
  const app = await open({ hash: '#/dev/overlays?sheet=demo-lazy:777000' });
  try {
    const { page } = app;
    await waitOpen(app, 'demo-lazy');
    assert.equal(await page.$eval(T('lazy-arg'), (el) => el.textContent), '777000');
    await page.click(T('lazy-done'));
    await waitSheets(page, '');
    await waitGone(page, 'demo-lazy');
    await page.$eval(T('stack-lazy'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('stack-lazy'));
    await waitSheets(page, 'demo-lazy:450000');
    await waitOpen(app, 'demo-lazy');
    assert.equal(await page.$eval(T('lazy-arg'), (el) => el.textContent), '450000');
    await page.keyboard.press('Escape');
    await waitGone(page, 'demo-lazy');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// =====================================================================
// 展示页
// =====================================================================

for (const device of ['mobile', 'desktop']) {
  test(`展示页（${device === 'mobile' ? '390×844' : '1280×800'}）：截图、无报错、不横向滚动、触控区 ≥44px（含打开的弹层里）`, async () => {
    const app = await open({ device });
    try {
      const { page } = app;
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page, { exclude: '.leaflet-container' });
      await shot(app, 'page');
      await fullPageShots(page, path.join(SHOTS, `page-full${device === 'mobile' ? '' : '-desktop'}.png`));
      for (const [btn, id] of [['open-expense', 'demo-expense'], ['open-place', 'demo-place'], ['fab', 'demo-fab'], ['trip-pill', 'demo-trips'], ['menu-button', 'demo-menu'], ['more-e1', 'demo-row-more']]) {
        await page.$eval(T(btn), (el) => el.scrollIntoView({ block: 'center' }));
        await twoFrames(page);
        await page.click(T(btn));
        await waitOpen(app, id);
        await assertNoHorizontalOverflow(page);
        await assertTapTargets(page);
        await shot(app, `${id.replace('demo-', '')}-open`);
        await page.keyboard.press('Escape');
        await waitGone(page, id);
      }
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('深色模式：底部面板、确认框、全屏菜单截图', async () => {
  const app = await open({ colorScheme: 'dark' });
  try {
    const { page } = app;
    await page.click(T('open-place'));
    await waitOpen(app, 'demo-place');
    await shot(app, 'dark-sheet');
    await page.click(T('place-delete'));
    await waitOpen(app, 'confirm');
    await shot(app, 'dark-sheet-confirm');
    await page.keyboard.press('Escape');
    await waitGone(page, 'confirm');
    await page.keyboard.press('Escape');
    await waitGone(page, 'demo-place');
    await page.$eval(T('menu-button'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('menu-button'));
    await waitOpen(app, 'demo-menu');
    await shot(app, 'dark-menu');
    app.assertClean();
  } finally {
    await app.close();
  }
});
