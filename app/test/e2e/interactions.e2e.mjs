// 动效与交互组件库（ui/ + motion/）的端到端测试：#/dev/primitives 展示页。
//
// 每个交互截「开始 / 动画半路 / 结束」三张图（test/e2e/__shots__/motion/），并断言：
//   - 半路时的几何量（位移、裁切、缩放、路径）确实介于两端之间——动画真的在播，不是瞬间跳过去；
//   - 结束状态正确（aria 状态、焦点、网址、布局）；
//   - 没有控制台报错、没有外网请求。
// 另外：手机 390×844 / 桌面 1280×800 整页截图 + 不横向滚动 + 触控区 ≥44；减弱动态效果下改成淡入淡出。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, fullPageShots } from './lib/harness.mjs';
import { captureMidAnimation, waitForAnimationsDone } from './lib/animation.mjs';
import { threeShots, shot, center, between, parseInset, parseCircle } from './lib/motion-shots.mjs';
import { morphFrame } from '../../src/ui/morph-shapes.js';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
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

const HASH = '#/dev/primitives';

async function open(options = {}) {
  const app = await openApp({ browser, server, hash: HASH, ...options });
  await app.page.waitForSelector('[data-testid="primitives-page"]');
  await app.idle();
  return app;
}

const tid = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// 交互 1：搜索原位展开
// ---------------------------------------------------------------------
test('交互 1 搜索：按钮原位长成输入框（裁切框半路介于两端）、自动聚焦、进历史；Esc 原路收回、焦点回按钮', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const field = document.querySelector('[data-testid="search"] .search-x__field');
      const icon = document.querySelector('[data-testid="search"] .search-x__icon');
      return {
        clip: getComputedStyle(field).clipPath,
        iconX: icon.getBoundingClientRect().left - field.getBoundingClientRect().left,
        state: document.querySelector('[data-testid="search"]').dataset.state,
        focused: document.activeElement?.classList.contains('search-x__input') || false,
        hash: location.hash,
        width: field.getBoundingClientRect().width,
      };
    };
    const r = await threeShots(app, {
      name: 'search-open',
      frame: '#demo-search',
      trigger: () => page.click(`${tid('search')} .search-x__trigger`),
      selector: '.search-x__field, .search-x__icon, .search-x__input, .search-x__cancel, .search-x__content',
      read,
    });
    const W = r.start.width;
    const s = parseInset(r.start.clip, W, 44);
    const m = parseInset(r.mid.clip, W, 44);
    const e = parseInset(r.end.clip, W, 44);
    assert.equal(r.start.state, 'closed');
    assert.ok(Math.abs(s.l - (r.start.width - 44)) < 1, `收起时只露出按钮那么大：${r.start.clip}`);
    assert.ok(between(m.l, s.l, e.l, 4), `半路左裁切 ${m.l} 介于 ${s.l} 和 ${e.l} 之间`);
    assert.ok(Math.abs(e.l) < 0.5 && e.r > 30, `展开后给「取消」留位置：${r.end.clip}`);
    assert.ok(between(r.mid.iconX, r.end.iconX, r.start.iconX, 4), `放大镜从按钮的位置滑向左边：${r.start.iconX} → ${r.mid.iconX} → ${r.end.iconX}`);
    assert.equal(r.end.state, 'open');
    assert.ok(r.end.focused, '展开后光标自动在输入框里');
    assert.match(r.end.hash, /sheet=search/, '展开状态进了网址历史');

    // 输入过滤
    await page.keyboard.type('咖啡');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="search-results"] li').length === 1);

    // Esc 原路收回（三张图）
    const c = await threeShots(app, {
      name: 'search-close',
      frame: '#demo-search',
      trigger: () => page.keyboard.press('Escape'),
      selector: '.search-x__field, .search-x__icon, .search-x__input, .search-x__cancel, .search-x__content',
      read,
    });
    const cm = parseInset(c.mid.clip, W, 44);
    const ce = parseInset(c.end.clip, W, 44);
    assert.ok(between(cm.l, 0, ce.l, 4), `收回半路左裁切 ${cm.l}（终点 ${ce.l}）`);
    assert.equal(c.end.state, 'closed');
    assert.doesNotMatch(c.end.hash, /sheet=search/, '收起后网址里没有弹层');
    const backOnTrigger = await page.evaluate(() => document.activeElement?.classList.contains('search-x__trigger'));
    assert.ok(backOnTrigger, '焦点回到放大镜按钮');
    assert.equal(await page.$eval(`${tid('search')} .search-x__input`, (el) => el.value), '', 'Esc 清空了输入');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 1 搜索：手机返回（history.back）收起搜索框', async () => {
  const app = await open();
  try {
    const { page } = app;
    await center(app, '#demo-search');
    await page.tap(`${tid('search')} .search-x__trigger`);
    await page.waitForFunction(() => location.hash.includes('sheet=search'));
    await app.idle();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[data-testid="search"]').dataset.state === 'closed');
    assert.doesNotMatch(await page.evaluate(() => location.hash), /sheet=/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 4：图标变形
// ---------------------------------------------------------------------
/** 在 [-0.3, 1.3] 里找和画面最接近的进度 p（证明半路画面就是变形路径上的一帧） */
function bestProgress(kind, ds) {
  const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const target = ds.map(nums);
  let best = { p: NaN, err: Infinity };
  // 0.001 一步：分段的图标（三横线先收拢再旋转）在每一段里变得更快，粗步长会把“在路径上”的误差放大
  for (let i = -300; i <= 1300; i++) {
    const p = i / 1000;
    const frame = morphFrame(kind, p);
    let err = 0;
    frame.forEach((f, k) => {
      const a = nums(f.d);
      a.forEach((v, j) => {
        err = Math.max(err, Math.abs(v - (target[k]?.[j] ?? NaN)));
      });
    });
    if (err < best.err) best = { p, err };
  }
  return best;
}

for (const kind of ['menu', 'plus', 'play', 'view']) {
  test(`交互 4 图标变形（${kind}）：路径逐帧插值，半路是变形路径上的中间一帧`, async () => {
    const app = await open();
    try {
      const { page } = app;
      const sel = `${tid(`morph-${kind}`)}`;
      const read = new Function(`
        const svg = document.querySelector('${sel} svg.morph-icon');
        return { ds: [...svg.querySelectorAll('.morph-icon__shape')].map((p) => p.getAttribute('d')), state: svg.dataset.state };
      `);
      const r = await threeShots(app, {
        name: `morph-icon-${kind}`,
        frame: sel,
        trigger: () => page.click(`${sel} button`),
        selector: 'svg.morph-icon',
        // 弹簧前段变化最大：拨到 18% 的时间，中间那一帧最有代表性
        progress: 0.18,
        read,
      });
      const start = bestProgress(kind, r.start.ds);
      const mid = bestProgress(kind, r.mid.ds);
      const end = bestProgress(kind, r.end.ds);
      assert.ok(Math.abs(start.p) < 0.011 && start.err < 0.02, `开始是状态 0：${JSON.stringify(start)}`);
      assert.ok(Math.abs(end.p - 1) < 0.011 && end.err < 0.02, `结束是状态 1：${JSON.stringify(end)}`);
      assert.ok(mid.err < 0.05, `半路画面在变形路径上：误差 ${mid.err}`);
      assert.ok(mid.p > 0.1 && mid.p < 0.95, `半路进度 ${mid.p}`);
      assert.equal(r.end.state, '1');
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}

test('交互 4 图标变形（check）：圆圈里对勾一笔描出来；动画中途反向从当前进度折返', async () => {
  const app = await open();
  try {
    const { page } = app;
    const sel = tid('morph-check');
    const read = () => {
      const p = document.querySelector('[data-testid="morph-check"] .morph-icon__check');
      return Number(getComputedStyle(p).strokeDashoffset.replace('px', ''));
    };
    const r = await threeShots(app, { name: 'morph-icon-check', frame: sel, trigger: () => page.click(`${sel} button`), selector: 'svg.morph-icon', progress: 0.2, read });
    assert.ok(Math.abs(r.start - 1) < 0.001, `开始没有对勾：${r.start}`);
    assert.ok(between(r.mid, 0, 1, 0.05), `半路描了一部分：${r.mid}`);
    assert.ok(Math.abs(r.end) < 0.001, `结束对勾完整：${r.end}`);

    // 打断：变回去到一半再点，进度从当前值接着走（不跳回 0 或 1）
    const first = await captureMidAnimation(app, () => page.click(`${sel} button`), { progress: 0.35, selector: 'svg.morph-icon', evaluate: read, keepPaused: true });
    const second = await captureMidAnimation(app, () => page.click(`${sel} button`), { progress: 0, selector: 'svg.morph-icon', evaluate: read });
    await first.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    assert.ok(between(first.state, 0, 1, 0.05), `先退到一半：${first.state}`);
    assert.ok(Math.abs(second.state - first.state) < 0.02, `折返起点 ${second.state} ≈ 打断时 ${first.state}`);
    await waitForAnimationsDone(page);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 2（原语）：悬浮加号长成面板
// ---------------------------------------------------------------------
test('交互 2 悬浮加号：面板从加号的位置长出来（平移、裁切都在半路），加号转成 ×；关闭原路收回后卸载', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const panel = document.querySelector('[data-testid="fab-panel"]');
      const fab = document.querySelector('[data-testid="fab"]');
      if (!panel) return { exists: false, expanded: fab.getAttribute('aria-expanded') };
      const cs = getComputedStyle(panel);
      const m = new DOMMatrixReadOnly(cs.transform);
      const r = panel.getBoundingClientRect();
      return { exists: true, x: m.m41, y: m.m42, clip: cs.clipPath, w: r.width, h: r.height, expanded: fab.getAttribute('aria-expanded') };
    };
    const open1 = await threeShots(app, {
      name: 'fab-open',
      frame: '#demo-fab-morph .pv-stage',
      trigger: () => page.click(tid('fab')),
      selector: '[data-testid="fab-panel"]',
      progress: 0.1,
      read,
    });
    assert.equal(open1.start.exists, false);
    const mid = open1.mid;
    const midInset = parseInset(mid.clip, mid.w, mid.h);
    assert.ok(mid.y > 20, `半路还在往上长（下移 ${mid.y}px）`);
    assert.ok(midInset.t > 10 && midInset.l > 10, `半路只露出一部分：${mid.clip}`);
    assert.equal(open1.end.expanded, 'true');
    assert.ok(Math.abs(open1.end.x) < 0.5 && Math.abs(open1.end.y) < 0.5, '结束停在最终位置');
    assert.ok(open1.end.clip === 'none' || !open1.end.clip.includes('inset(1'), `结束不再裁切：${open1.end.clip}`);

    const close = await threeShots(app, {
      name: 'fab-close',
      frame: '#demo-fab-morph .pv-stage',
      trigger: () => page.click(tid('fab')),
      selector: '[data-testid="fab-panel"]',
      progress: 0.2,
      read,
    });
    assert.ok(close.mid.exists && close.mid.y > 5, `收回半路往加号方向走：${close.mid.y}`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="fab-panel"]'));
    assert.equal(await page.$eval(tid('fab'), (el) => el.getAttribute('aria-expanded')), 'false');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 3：提交按钮
// ---------------------------------------------------------------------
test('交互 3 提交按钮：文字 → 转圈（真的在转）→ 对勾描线；宽度不跳、转圈期间连点只提交一次', async () => {
  const app = await open();
  try {
    const { page } = app;
    const btn = tid('submit-ok');
    const read = () => {
      const b = document.querySelector('[data-testid="submit-ok"]');
      const layer = (c) => Number(getComputedStyle(b.querySelector(c)).opacity);
      const path = b.querySelector('.submit-btn__check-path');
      const svg = b.querySelector('.spinner__svg');
      return {
        state: b.dataset.state,
        width: b.getBoundingClientRect().width,
        label: layer('.submit-btn__label'),
        spinner: layer('.submit-btn__spinner'),
        done: layer('.submit-btn__done'),
        dash: Number(getComputedStyle(path).strokeDashoffset.replace('px', '')),
        spinning: svg ? svg.getAnimations().some((a) => a.playState === 'running' || a.playState === 'paused') : false,
      };
    };
    const load = await threeShots(app, {
      name: 'submit-loading',
      frame: '#demo-submit .pv-group',
      trigger: () => page.click(btn),
      selector: '.submit-btn__layer',
      progress: 0.08,
      read,
      settle: () => sleep(10),
    });
    assert.equal(load.start.state, 'idle');
    assert.equal(load.mid.state, 'loading');
    assert.ok(between(load.mid.spinner, 0, 1, 0.05), `转圈那一层正在淡入：${load.mid.spinner}`);
    assert.ok(between(load.mid.label, 0, 1, 0.05) || load.mid.label < 0.6, `文字正在淡出：${load.mid.label}`);
    assert.ok(Math.abs(load.mid.width - load.start.width) < 0.5, '宽度不跳');
    // 转圈期间连点：不重复提交
    await page.click(btn);
    await page.click(btn);
    const s = await page.evaluate(read);
    assert.equal(s.state, 'loading');
    assert.ok(s.spinning, '转圈图标真的在转（有正在播的旋转动画）');
    // 成功：对勾描线（半路）
    const ok = await threeShots(app, {
      name: 'submit-success',
      frame: '#demo-submit .pv-group',
      trigger: () => page.waitForSelector('[data-testid="submit-ok"][data-state="success"]', { timeout: 5000 }),
      selector: '.submit-btn__check-path',
      progress: 0.3,
      read,
    });
    assert.ok(between(ok.mid.dash, 0, 1, 0.05), `对勾描到一半：${ok.mid.dash}`);
    assert.ok(Math.abs(ok.end.dash) < 0.01, '对勾描完');
    assert.ok(Math.abs(ok.end.width - load.start.width) < 0.5, '成功时宽度也不变');
    assert.equal(await page.$eval(tid('submit-calls'), (el) => el.textContent), '1', '只提交了一次');
    // 回到文字
    await page.waitForSelector('[data-testid="submit-ok"][data-state="idle"]', { timeout: 4000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 3 提交按钮：失败时左右抖一下（弹簧冲量）、变成「重试」，之后恢复', async () => {
  const app = await open();
  try {
    const { page } = app;
    const btn = tid('submit-fail');
    await center(app, btn);
    await page.click(btn);
    await page.waitForSelector('[data-testid="submit-fail"][data-state="loading"]');
    const r = await threeShots(app, {
      name: 'submit-error',
      frame: '#demo-submit .pv-group:nth-of-type(2)',
      trigger: () => page.waitForSelector('[data-testid="submit-fail"][data-state="error"]', { timeout: 5000 }),
      filter: (a) => a.name === 'submit-shake',
      progress: 0.15,
      read: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="submit-fail"]')).transform).m41,
    });
    assert.ok(Math.abs(r.mid) > 1, `抖动中有横向位移：${r.mid}`);
    const x = await page.$eval(btn, (el) => getComputedStyle(el).transform);
    assert.ok(x === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(x), `抖完回到原位：${x}`);
    assert.equal(await page.$eval(`${btn} .submit-btn__error`, (el) => getComputedStyle(el).opacity), '1', '显示「重试」');
    await page.waitForSelector('[data-testid="submit-fail"][data-state="idle"]', { timeout: 5000 });
    app.assertClean({ allowErrors: [] });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 5：分段控件、标签页
// ---------------------------------------------------------------------
const thumbX = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="seg-main"] .seg__thumb')).transform).m41;

test('交互 5 分段控件：点第三段，选中块弹簧滑过去（半路介于两端）；方向键切换', async () => {
  const app = await open();
  try {
    const { page } = app;
    const w = await page.$eval(`${tid('seg-main')} .seg__thumb`, (el) => el.getBoundingClientRect().width);
    const r = await threeShots(app, {
      name: 'segmented-tap',
      frame: '#demo-segmented .pv-group',
      trigger: () => page.click(`${tid('seg-main')} .seg__item:nth-of-type(3)`),
      selector: '.seg__thumb',
      progress: 0.2,
      read: thumbX,
    });
    assert.ok(Math.abs(r.start) < 0.5);
    assert.ok(between(r.mid, 0, 2 * w, 5), `半路 ${r.mid}（终点 ${2 * w}）`);
    assert.ok(Math.abs(r.end - 2 * w) < 0.6, `停在第三段：${r.end}`);
    assert.equal(await page.$eval(tid('seg-value'), (el) => el.textContent), 'settle');
    const inline = await page.$eval(`${tid('seg-main')} .seg__thumb`, (el) => el.style.transform);
    assert.equal(inline, '', '动画结束后回到 CSS 变量定位（窗口变化不会错位）');
    // 键盘
    await page.focus(`${tid('seg-main')} .seg__item[aria-checked="true"]`);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[data-testid="seg-value"]').textContent === 'stats');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true', '焦点跟着到新选中的段');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 5 分段控件：按住选中块拖动，块跟手；松手按速度吸附到最近的段', async () => {
  const app = await open({ device: 'desktop' });
  try {
    const { page } = app;
    await center(app, tid('seg-main'));
    const w = await page.$eval(`${tid('seg-main')} .seg__thumb`, (el) => el.getBoundingClientRect().width);
    const box = await (await page.$(`${tid('seg-main')} .seg__item:nth-of-type(1)`)).boundingBox();
    const y = box.y + box.height / 2;
    const x0 = box.x + box.width / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x0 + (w * 0.6 * i) / 12, y);
      await sleep(16);
    }
    const following = await page.evaluate(thumbX);
    assert.ok(Math.abs(following - w * 0.6) < 3, `拖动时选中块跟手：${following} ≈ ${w * 0.6}`);
    assert.ok(await page.$eval(`${tid('seg-main')} .seg__item:nth-of-type(2)`, (el) => el.hasAttribute('data-under')), '块下面那一段的文字变成选中色');
    await shot(app, 'segmented-drag-mid', '#demo-segmented .pv-group');
    await sleep(120); // 手指停住再松手：没有惯性，吸附到最近的第二段
    await page.mouse.up();
    await waitForAnimationsDone(page);
    await shot(app, 'segmented-drag-end', '#demo-segmented .pv-group');
    assert.equal(await page.$eval(tid('seg-value'), (el) => el.textContent), 'stats');
    // 快速一甩：从第二段甩到第三段
    const box2 = await (await page.$(`${tid('seg-main')} .seg__item:nth-of-type(2)`)).boundingBox();
    const x1 = box2.x + box2.width / 2;
    await page.mouse.move(x1, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(x1 + (w * 0.3 * i) / 4, y);
      await sleep(8);
    }
    await page.mouse.up();
    await waitForAnimationsDone(page);
    assert.equal(await page.$eval(tid('seg-value'), (el) => el.textContent), 'settle', '速度够快：惯性把它带到了第三段');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 5 标签页：指示条弹簧跟随，前沿快后沿慢（半路被拉长）；只动 transform；内容区横向滑动时指示条连续跟随', async () => {
  const app = await open();
  try {
    const { page } = app;
    // 指示条三段（左圆头、中间、右圆头）：量左圆头的左边、右圆头的右边
    const inkSpan = (sel) => {
      const caps = document.querySelectorAll(`${sel} .tabs__ink-cap`);
      const bar = document.querySelector(`${sel} .tabs__ink-bar`);
      const a = caps[0].getBoundingClientRect();
      const b = caps[1].getBoundingClientRect();
      const props = new Set(document.getAnimations().filter((x) => x.effect?.target?.closest?.(`${sel} .tabs__ink`))
        .flatMap((x) => x.effect.getKeyframes().flatMap((k) => Object.keys(k))));
      return { l: a.left, r: b.right, width: b.right - a.left, barH: bar.getBoundingClientRect().height, capW: a.width, capH: a.height, props: [...props] };
    };
    const read = new Function(`return (${inkSpan.toString()})('[data-testid="tabs-main"]');`);
    const r = await threeShots(app, {
      name: 'tabs-ink',
      frame: '#demo-tabs .pv-group',
      trigger: () => page.click(`${tid('tabs-main')} [role="tab"]:nth-of-type(3)`),
      selector: '.tabs__ink-cap, .tabs__ink-bar',
      progress: 0.18,
      read,
    });
    const s = r.start;
    const m = r.mid;
    const e = r.end;
    assert.ok(between(m.l, s.l, e.l, 2), `左边（后沿）半路 ${m.l}`);
    assert.ok(m.width > Math.max(s.width, e.width) + 8, `半路被拉长：${m.width} > ${s.width} / ${e.width}`);
    assert.ok(Math.abs(m.capW - m.capH) < 0.5, '圆头始终是圆的（不被拉扁）');
    const extra = m.props.filter((k) => !['transform', 'offset', 'easing', 'composite', 'computedOffset'].includes(k));
    assert.deepEqual(extra, [], `指示条只动 transform（合成线程），没有动 ${extra.join('、')}`);
    assert.equal(await page.$eval(`${tid('tabs-main')} [role="tab"]:nth-of-type(3)`, (el) => el.getAttribute('aria-selected')), 'true');

    // 内容区横向滑动 → 指示条连续跟随（不是等停下才跳）
    const pager = '#demo-tabs .pv-group:nth-of-type(3)';
    const capLeft = (sel) => document.querySelector(`${sel} .tabs__ink-cap`).getBoundingClientRect().left;
    await center(app, tid('tabs-pager'));
    const before = await page.evaluate(capLeft, pager);
    // 模拟手指拖到一半（先关掉吸附，否则浏览器会立刻吸回整页）
    await page.$eval(tid('tabs-pager'), (el) => {
      el.style.scrollSnapType = 'none';
      el.scrollLeft = el.clientWidth * 0.5;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction((sel, b) => document.querySelector(`${sel} .tabs__ink-cap`).getBoundingClientRect().left !== b, {}, pager, before);
    await shot(app, 'tabs-pager-half', pager);
    const half = await page.evaluate(capLeft, pager);
    assert.ok(half > before + 10, `内容滑到一半，指示条也走了一半：${before} → ${half}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 6：步进器
// ---------------------------------------------------------------------
test('交互 6 步进器：「添加」原地展开成「− 1 +」（底色裁切半路）；+ 数字滚动；减到 0 收回成按钮', async () => {
  const app = await open();
  try {
    const { page } = app;
    const sel = tid('stepper-dress');
    const read = new Function(`
      const root = document.querySelector('${sel}');
      const bg = root.querySelector('.stepper__bg');
      const r = bg.getBoundingClientRect();
      return { clip: getComputedStyle(bg).clipPath, w: r.width, h: r.height, state: root.dataset.state,
        value: root.querySelector('.stepper__value').getAttribute('aria-valuenow'),
        plusOpacity: Number(getComputedStyle(root.querySelector('.stepper__btn--plus')).opacity) };
    `);
    const r = await threeShots(app, {
      name: 'stepper-expand',
      frame: '#demo-stepper .pv-list',
      trigger: () => page.click(`${sel} .stepper__add`),
      selector: '.stepper__bg',
      progress: 0.2,
      read,
    });
    const s = parseInset(r.start.clip, r.start.w, r.start.h);
    const m = parseInset(r.mid.clip, r.mid.w, r.mid.h);
    const e = parseInset(r.end.clip, r.end.w, r.end.h);
    assert.equal(r.start.state, 'closed');
    assert.ok(s.l > 20, `收起时只有按钮那一段有底色：${r.start.clip}`);
    assert.ok(between(m.l, e.l, s.l, 2), `底色半路 ${m.l}（${s.l} → ${e.l}）`);
    assert.equal(r.end.state, 'open');
    assert.equal(r.end.value, '1');
    assert.equal(r.end.plusOpacity, 1);

    // + 一下：数字滚动（旧数字往上滚出去、新数字从下面滚进来）
    const roll = await threeShots(app, {
      name: 'stepper-roll',
      frame: sel,
      trigger: () => page.click(`${sel} .stepper__btn--plus`),
      selector: '.roll__char',
      progress: 0.3,
      read: new Function(`
        const chars = [...document.querySelectorAll('${sel} .roll__char')];
        return chars.map((c) => ({ t: c.textContent, y: new DOMMatrixReadOnly(getComputedStyle(c).transform).m42, out: c.classList.contains('roll__char--out') }));
      `),
    });
    const incoming = roll.mid.find((c) => c.t === '2' && !c.out);
    const outgoing = roll.mid.find((c) => c.t === '1' && c.out);
    assert.ok(incoming && incoming.y > 1, `新数字从下面滚进来：${JSON.stringify(roll.mid)}`);
    assert.ok(outgoing && outgoing.y < -1, '旧数字往上滚出去');
    assert.deepEqual(roll.end.map((c) => c.t), ['2'], '滚完只剩新数字');

    // 减到 0：收回
    await page.click(`${sel} .stepper__btn--minus`);
    await waitForAnimationsDone(page);
    const back = await threeShots(app, {
      name: 'stepper-collapse',
      frame: '#demo-stepper .pv-list',
      trigger: () => page.click(`${sel} .stepper__btn--minus`),
      selector: '.stepper__bg',
      progress: 0.25,
      read,
    });
    const bm = parseInset(back.mid.clip, back.mid.w, back.mid.h);
    const be = parseInset(back.end.clip, back.end.w, back.end.h);
    assert.ok(between(bm.l, 0, be.l, 2), `收回半路 ${bm.l}`);
    assert.equal(back.end.state, 'closed');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 6 步进器（代码评审 L6）：禁用时键盘也改不了数量（方向键、Home、End 都不调 onChange），数字是 aria-disabled', async () => {
  const app = await open();
  try {
    const { page } = app;
    await center(app, tid('stepper-disabled'));
    const spin = `${tid('stepper-disabled')} [role="spinbutton"]`;
    assert.equal(await page.$eval(tid('stepper-disabled'), (el) => el.getAttribute('aria-disabled')), 'true');
    assert.equal(await page.$eval(spin, (el) => el.getAttribute('aria-disabled')), 'true');
    await page.$eval(spin, (el) => el.focus());
    for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End']) {
      await page.keyboard.press(key);
    }
    // 点 + / −（禁用的按钮）也不行
    await page.$$eval(`${tid('stepper-disabled')} .stepper__btn`, (els) => els.forEach((b) => b.click()));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(await page.$eval(tid('stepper-disabled'), (el) => el.dataset.changeCount), '0', '禁用的步进器一次都没被改动');
    assert.equal(await page.$eval(spin, (el) => el.getAttribute('aria-valuenow')), '2');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 7：原地展开
// ---------------------------------------------------------------------
test('交互 7 原地展开：详情高度半路介于 0 和全高，下面的卡片平滑下移；收起时 inert', async () => {
  const app = await open();
  try {
    const { page } = app;
    // 先把默认展开的那张收起
    await center(app, tid('xcard-list'));
    await page.click(`${tid('xcard-breakfast')} .xcard__header`);
    await waitForAnimationsDone(page);
    const read = () => {
      const body = document.querySelector('[data-testid="xcard-cable"] .xcard__body');
      const below = document.querySelector('[data-testid="xcard-beach"]');
      const after = document.querySelector('[data-testid="xcard-after"]');
      const top0 = document.querySelector('[data-testid="xcard-list"]').getBoundingClientRect().top;
      return {
        h: body.getBoundingClientRect().height,
        belowTop: below.getBoundingClientRect().top - top0,
        afterTop: after.getBoundingClientRect().top - top0,
        expanded: document.querySelector('[data-testid="xcard-cable"] .xcard__header').getAttribute('aria-expanded'),
        inert: body.inert,
      };
    };
    const r = await threeShots(app, {
      name: 'expandable-open',
      frame: '#demo-expandable .pv-group',
      trigger: () => page.click(`${tid('xcard-cable')} .xcard__header`),
      selector: '.xcard__body, .xcard__content, .xcard__chevron',
      progress: 0.25,
      read,
    });
    assert.ok(r.start.h < 1 && r.start.inert, '收起时高度 0，详情 inert');
    assert.ok(between(r.mid.h, 0, r.end.h, 4), `半路高度 ${r.mid.h}（全高 ${r.end.h}）`);
    assert.ok(between(r.mid.belowTop, r.start.belowTop, r.end.belowTop, 2), '下面的卡片半路');
    assert.ok(between(r.mid.afterTop, r.start.afterTop, r.end.afterTop, 2), '更下面的内容也跟着平滑移动');
    assert.equal(r.end.expanded, 'true');
    assert.equal(r.end.inert, false);
    // 嵌套
    await center(app, tid('xcard-nested'));
    await page.click(`${tid('xcard-nested')} > .xcard__heading .xcard__header`);
    await waitForAnimationsDone(page);
    await page.click(`${tid('xcard-nested')} .xcard .xcard__header`);
    await waitForAnimationsDone(page);
    const nestedOpen = await page.$$eval(`${tid('xcard-nested')} [aria-expanded="true"]`, (els) => els.length);
    assert.equal(nestedOpen, 2, '外层和里面的一张都展开了');
    await shot(app, 'expandable-nested', '#demo-expandable');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 8：列表 ↔ 网格、FLIP 重排
// ---------------------------------------------------------------------
test('交互 8 列表 ↔ 网格：每张卡片的部件从旧位置 FLIP 到新位置（图片等比裁切），结束后变成两列', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const media = document.querySelector('[data-testid="view-card-p2"] .vs-card__media');
      const bg = document.querySelector('[data-testid="view-card-p2"] .vs-card__bg');
      const cards = [...document.querySelectorAll('[data-testid="view-switch"] .vs-card')].map((c) => c.getBoundingClientRect());
      const mr = media.getBoundingClientRect();
      const box = document.querySelector('[data-testid="view-switch"]').getBoundingClientRect();
      return {
        view: document.querySelector('[data-testid="view-switch"]').dataset.view,
        mediaLeft: mr.left - box.left,
        mediaTop: mr.top - box.top,
        mediaW: mr.width,
        bgW: bg.getBoundingClientRect().width,
        mediaTransform: getComputedStyle(media).transform,
        sameRow: Math.abs(cards[0].top - cards[1].top) < 1,
      };
    };
    const r = await threeShots(app, {
      name: 'view-switch-grid',
      frame: '#demo-view-switch',
      trigger: () => page.click(tid('view-toggle')),
      selector: '.vs-card__bg, .vs-card__media, .vs-card__text, .vs-card__meta',
      progress: 0.25,
      read,
    });
    assert.equal(r.start.view, 'list');
    assert.equal(r.end.view, 'grid');
    assert.ok(r.end.sameRow, '网格：前两张在同一行');
    assert.ok(between(r.mid.mediaLeft, r.start.mediaLeft, r.end.mediaLeft, 2), `图片半路横向位置 ${r.mid.mediaLeft}`);
    assert.ok(between(r.mid.mediaTop, r.start.mediaTop, r.end.mediaTop, 2), `图片半路纵向位置 ${r.mid.mediaTop}`);
    assert.ok(between(r.mid.bgW, r.start.bgW, r.end.bgW, 2), `卡片底板宽度半路 ${r.mid.bgW}`);
    assert.equal(r.end.mediaTransform, 'none', '结束后没有残留的变换');
    // 切回列表（再截三张）
    const back = await threeShots(app, {
      name: 'view-switch-list',
      frame: '#demo-view-switch',
      trigger: () => page.click(tid('view-toggle')),
      selector: '.vs-card__bg, .vs-card__media, .vs-card__text, .vs-card__meta',
      progress: 0.25,
      read,
    });
    assert.equal(back.end.view, 'list');
    assert.ok(between(back.mid.mediaW, back.start.mediaW, back.end.mediaW, 2) || between(back.mid.mediaLeft, back.start.mediaLeft, back.end.mediaLeft, 2));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 8 FLIP 重排：打乱后元素从旧位置平滑挪到新位置；新加的浮出来；删掉的淡出', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const top0 = document.querySelector('[data-testid="flip-list"]').getBoundingClientRect().top;
      return [...document.querySelectorAll('[data-testid="flip-list"] > li:not([data-flip-ghost])')]
        .map((li) => ({ k: li.dataset.flipKey, top: li.getBoundingClientRect().top - top0 }));
    };
    const r = await threeShots(app, {
      name: 'flip-shuffle',
      frame: '#demo-flip-list',
      trigger: () => page.click(tid('flip-shuffle')),
      selector: '[data-flip-key]',
      progress: 0.25,
      read,
    });
    const startTop = Object.fromEntries(r.start.map((x) => [x.k, x.top]));
    const endTop = Object.fromEntries(r.end.map((x) => [x.k, x.top]));
    const moved = r.mid.filter((x) => Math.abs(startTop[x.k] - endTop[x.k]) > 10);
    assert.ok(moved.length >= 2, '至少有两个元素换了位置');
    for (const x of moved) assert.ok(between(x.top, startTop[x.k], endTop[x.k], 1), `${x.k} 半路 ${x.top}（${startTop[x.k]} → ${endTop[x.k]}）`);
    // 删除：幽灵淡出
    await center(app, tid('flip-list'));
    const del = await captureMidAnimation(app, () => page.click(`${tid('flip-list')} > li:first-child button`), {
      progress: 0.4,
      selector: '[data-flip-ghost]',
      evaluate: () => {
        const g = document.querySelector('[data-flip-ghost]');
        return g ? Number(getComputedStyle(g).opacity) : null;
      },
      keepPaused: true,
    });
    await shot(app, 'flip-remove-mid', '#demo-flip-list');
    await del.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    assert.ok(del.state !== null && between(del.state, 0, 1, 0.05), `删掉的元素正在淡出：${del.state}`);
    await waitForAnimationsDone(page);
    assert.equal(await page.$('[data-flip-ghost]'), null, '幽灵播完就删掉');
    assert.equal(await page.$$eval(`${tid('flip-list')} > li`, (els) => els.length), 4);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 9：顶栏收成胶囊
// ---------------------------------------------------------------------
/** 顶栏玻璃底此刻的形状：只有一层玻璃，宽度 / 圆角连续变化，没有缩放（不会把胶囊拉成椭圆） */
const CH_PARTS = '.ch__glass, .ch__shadow, .ch__edge, .ch__title, .ch__title-full, .ch__title-compact, .ch__side';
function readHeader(sel) {
  const h = document.querySelector(sel);
  const glass = h.querySelector('.ch__glass');
  const cs = getComputedStyle(glass);
  const r = glass.getBoundingClientRect();
  return {
    state: h.dataset.state,
    w: r.width,
    hh: r.height,
    full: h.getBoundingClientRect().width,
    radius: parseFloat(cs.borderTopLeftRadius) || 0,
    transform: cs.transform,
    layers: h.querySelectorAll('.ch__glass, .ch__bar, .ch__pill').length,
    shadow: Number(getComputedStyle(h.querySelector('.ch__shadow')).opacity),
    top: h.getBoundingClientRect().top,
  };
}

test('交互 9 顶栏：往下滚，悬浮的玻璃条连续收拢成胶囊（只有一层玻璃，宽度和圆角半路介于两端、不缩放变形），往上滑恢复；点胶囊展开', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = new Function(`return (${readHeader.toString()})('[data-testid="ch"]');`);
    await center(app, tid('ch-frame'));
    // 先往下滚一点（离开顶部，玻璃底出现）
    await page.$eval(tid('ch-frame'), (el) => el.scrollTo(0, 30));
    await sleep(100);
    const scrollDown = async () => {
      for (let y = 40; y <= 260; y += 20) {
        await page.$eval(tid('ch-frame'), (el, v) => el.scrollTo(0, v), y);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      }
      await page.waitForSelector('[data-testid="ch"][data-state="pill"]');
    };
    const r = await threeShots(app, { name: 'header-collapse', frame: tid('ch-frame'), trigger: scrollDown, selector: CH_PARTS, progress: 0.3, read });
    assert.equal(r.start.state, 'bar');
    assert.equal(r.mid.layers, 1, '只有一层玻璃（不是两层交叉淡入淡出）');
    // A 皮肤：整条状态是离屏幕两边 16px 的悬浮玻璃条，圆角 = 半高
    assert.ok(Math.abs(r.start.w - (r.start.full - 32)) < 1 && Math.abs(r.start.radius - r.start.hh / 2) < 0.5,
      `展开时是悬浮的玻璃条：${r.start.w}/${r.start.full}，${r.start.hh} 高、圆角 ${r.start.radius}`);
    assert.ok(between(r.mid.w, r.end.w, r.start.w, 2) && r.mid.w < r.start.w - 2 && r.mid.w > r.end.w + 2, `半路宽度介于胶囊和整条之间：${r.mid.w}`);
    // 胶囊的圆角写的是 999px（实际按半高画），按实际画出来的半高比
    const pillRadius = Math.min(r.end.radius, r.end.hh / 2);
    assert.ok(between(r.mid.radius, pillRadius, r.start.radius, 0.5) && r.mid.hh < r.start.hh - 0.5, `半路高度、圆角在变：${r.mid.hh} 高，圆角 ${r.mid.radius}`);
    assert.equal(r.mid.transform, 'none', '玻璃底不靠缩放变形（胶囊两端不会被拉成椭圆）');
    assert.equal(r.mid.shadow, 1, '悬浮的玻璃条和胶囊都有投影（离开页面顶部以后一直在）');
    assert.equal(r.end.state, 'pill');
    assert.ok(r.end.w < r.start.w / 1.5 && r.end.radius >= r.end.hh / 2 - 0.5, `结束是胶囊：${r.end.w}×${r.end.hh}，圆角 ${r.end.radius}`);
    assert.equal(await page.$eval(tid('ch-state'), (el) => el.textContent), '胶囊');
    // 往上滑一点：恢复（同样连续）
    const scrollUp = async () => {
      for (let y = 250; y >= 190; y -= 10) {
        await page.$eval(tid('ch-frame'), (el, v) => el.scrollTo(0, v), y);
        await page.evaluate(() => new Promise((rr) => requestAnimationFrame(rr)));
      }
      await page.waitForSelector('[data-testid="ch"][data-state="bar"]');
    };
    const up = await threeShots(app, { name: 'header-expand', frame: tid('ch-frame'), trigger: scrollUp, selector: CH_PARTS, progress: 0.3, read });
    assert.ok(between(up.mid.w, up.start.w, up.end.w, 2), `恢复半路：${up.mid.w}`);
    assert.equal(up.mid.transform, 'none');
    assert.equal(up.end.state, 'bar');
    assert.ok(Math.abs(up.end.w - (up.end.full - 32)) < 1, `恢复成悬浮的玻璃条：${up.end.w}/${up.end.full}`);
    // 再收起，点胶囊展开
    await scrollDown();
    await app.idle();
    await page.click(`${tid('ch')} .ch__title`);
    await page.waitForSelector('[data-testid="ch"][data-state="bar"]');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 9 顶栏：收到一半反向，从当前形状、当前速度接着走（不跳、不停顿）', async () => {
  const app = await open();
  try {
    const { page } = app;
    await center(app, tid('ch-frame'));
    await page.$eval(tid('ch-frame'), (el) => el.scrollTo(0, 30));
    await sleep(120);
    const cdp = await page.createCDPSession();
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    // 每帧记玻璃底的宽度
    await page.evaluate(() => {
      window.__w = [];
      const glass = document.querySelector('[data-testid="ch"] .ch__glass');
      const tick = () => {
        window.__w.push(glass.getBoundingClientRect().width);
        if (window.__w.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (let y = 40; y <= 200; y += 20) {
      await page.$eval(tid('ch-frame'), (el, v) => el.scrollTo(0, v), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    await page.waitForSelector('[data-testid="ch"][data-state="pill"]');
    await sleep(500); // 0.1 倍速下收了一小段
    for (let y = 190; y >= 140; y -= 10) {
      await page.$eval(tid('ch-frame'), (el, v) => el.scrollTo(0, v), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    await page.waitForSelector('[data-testid="ch"][data-state="bar"]');
    await sleep(600);
    const w = await page.evaluate(() => window.__w);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    const steps = w.slice(1).map((v, i) => v - w[i]);
    const maxJump = Math.max(...steps.map(Math.abs));
    assert.ok(maxJump < 12, `0.1 倍速下每帧宽度变化很小，没有跳变（最大 ${maxJump.toFixed(2)}px）`);
    const minW = Math.min(...w);
    assert.ok(minW < w[0] - 3, '确实收了一段');
    assert.ok(w[w.length - 1] > minW + 3, '然后折返变宽');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('交互 9 顶栏（整页，读 window 滚动）：往下滚收成胶囊、往上滑恢复；带安全区的固定顶栏', async () => {
  const app = await open();
  try {
    const { page } = app;
    await center(app, tid('ch-page-toggle'));
    await page.click(tid('ch-page-toggle'));
    await page.waitForSelector(tid('ch-page'));
    const read = new Function(`return (${readHeader.toString()})('[data-testid="ch-page"]');`);
    const down = async () => {
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollBy(0, 24));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      }
      await page.waitForSelector('[data-testid="ch-page"][data-state="pill"]');
    };
    const r = await threeShots(app, { name: 'header-page-collapse', trigger: down, selector: CH_PARTS, progress: 0.3, read });
    assert.equal(r.start.state, 'bar');
    assert.equal(r.start.top, 0, '固定在屏幕顶部');
    assert.ok(between(r.mid.w, r.end.w, r.start.w, 2), `胶囊半路 ${r.mid.w}`);
    assert.equal(r.end.state, 'pill');
    assert.equal(await page.$eval(tid('ch-page-state'), (el) => el.textContent), '胶囊');
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, -12));
      await page.evaluate(() => new Promise((rr) => requestAnimationFrame(rr)));
    }
    await page.waitForSelector('[data-testid="ch-page"][data-state="bar"]');
    await app.idle();
    await shot(app, 'header-page-restored');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 交互 10（原语）：圆形扩散
// ---------------------------------------------------------------------
test('交互 10 圆形扩散：菜单从按钮中心扩散铺满（半径半路介于按钮和铺满之间），原路收回后卸载', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const layer = document.querySelector('[data-testid="reveal-layer"]');
      return layer ? { clip: getComputedStyle(layer).clipPath, exists: true } : { exists: false };
    };
    const r = await threeShots(app, {
      name: 'circle-reveal-open',
      frame: tid('reveal-stage'),
      trigger: () => page.click(tid('reveal-toggle')),
      selector: '[data-testid="reveal-layer"]',
      progress: 0.2,
      read,
    });
    const c = parseCircle(r.mid.clip);
    const btn = await page.$eval(tid('reveal-toggle'), (el) => el.getBoundingClientRect().width / 2);
    assert.ok(c && c.r > btn + 5, `半路半径 ${c?.r} 已经比按钮大`);
    const stage = await page.$eval(tid('reveal-stage'), (el) => Math.hypot(el.clientWidth, el.clientHeight));
    assert.ok(c.r < stage - 20, `还没铺满（${c.r} < ${stage}）`);
    assert.equal(r.end.clip, 'none', '铺满后去掉裁切');
    const close = await threeShots(app, {
      name: 'circle-reveal-close',
      frame: tid('reveal-stage'),
      trigger: () => page.click(tid('reveal-toggle')),
      selector: '[data-testid="reveal-layer"]',
      progress: 0.3,
      read,
    });
    const cc = parseCircle(close.mid.clip);
    assert.ok(cc && between(cc.r, btn, stage, 5), `收回半路半径 ${cc?.r}`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="reveal-layer"]'));
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 按压、勾选、胶囊、角标、轻提示
// ---------------------------------------------------------------------
const scaleOf = (sel) => `(() => { const s = getComputedStyle(document.querySelector('${sel}')).scale; return s === 'none' ? 1 : Number(s.split(' ')[0]); })()`;

test('按压：按下即缩、滑出取消（不算点击）、滑回再按下、松手弹簧回弹；嵌套只缩里面的按钮', async () => {
  const app = await open({ device: 'desktop' });
  try {
    const { page } = app;
    const card = tid('press-card');
    await center(app, card);
    const box = await (await page.$(card)).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForFunction(`${scaleOf(card)} < 0.99`);
    await waitForAnimationsDone(page);
    const pressed = await page.evaluate(scaleOf(card));
    assert.ok(pressed < 0.99 && pressed >= 0.96, `按下缩小（大卡片缩得少）：${pressed}`);
    await shot(app, 'press-down', '#demo-pressable .pv-group');
    // 滑出去
    await page.mouse.move(cx, box.y + box.height + 60, { steps: 6 });
    await waitForAnimationsDone(page);
    assert.ok(Math.abs((await page.evaluate(scaleOf(card))) - 1) < 0.002, '滑出回弹');
    // 在外面松手：不算点击
    await page.mouse.up();
    await sleep(50);
    assert.equal(await page.$eval(tid('press-count'), (el) => el.textContent), '0', '滑出去松手不触发点击');
    // 正常点击：按住（开始）→ 松手（弹簧回弹的半路）→ 弹回 1（结束），三张图
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForFunction(`${scaleOf(card)} < 0.99`);
    await waitForAnimationsDone(page);
    const rel = await threeShots(app, {
      name: 'press-release',
      frame: '#demo-pressable .pv-group',
      trigger: () => page.mouse.up(),
      selector: '[data-testid="press-card"]',
      progress: 0.12,
      read: new Function(`return ${scaleOf(card)};`),
    });
    assert.ok(rel.start < 0.99, `按住时缩着：${rel.start}`);
    assert.ok(between(rel.mid, rel.start, 1.02, 0.002), `松手回弹的半路：${rel.mid}`);
    assert.ok(Math.abs(rel.end - 1) < 0.002, '弹回 1');
    assert.equal(await page.$eval(tid('press-count'), (el) => el.textContent), '1');
    // 嵌套
    const inner = tid('press-inner');
    await center(app, inner);
    const ib = await (await page.$(inner)).boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.mouse.down();
    await page.waitForFunction(`${scaleOf(inner)} < 0.99`);
    assert.equal(await page.$eval(tid('press-outer'), (el) => el.hasAttribute('data-pressed')), false, '外层卡片没有按下态');
    await page.mouse.up();
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('按压（触屏）：手指按下即缩；滑出卡片回弹且不算点击；轻点算一次点击', async () => {
  const app = await open();
  try {
    const { page } = app;
    const card = tid('press-card');
    await center(app, card);
    const box = await (await page.$(card)).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.touchscreen.touchStart(cx, cy);
    await page.waitForFunction(`${scaleOf(card)} < 0.99`);
    await waitForAnimationsDone(page);
    await shot(app, 'press-touch-down', '#demo-pressable .pv-group');
    // 手指滑出去（超出 24px 的保留区；浏览器开始滚动页面时会发 pointercancel，同样算取消）
    await page.touchscreen.touchMove(cx, box.y + box.height + 80);
    await page.waitForFunction((sel) => !document.querySelector(sel).hasAttribute('data-pressed'), { timeout: 3000 }, card);
    await page.touchscreen.touchEnd();
    await waitForAnimationsDone(page);
    assert.ok((await page.evaluate(scaleOf(card))) > 0.999, '滑出后弹回');
    assert.equal(await page.$eval(tid('press-count'), (el) => el.textContent), '0', '滑出去松手不触发点击');
    // 轻点（刚才手指拖动可能把页面滚走了，重新量位置）
    await center(app, card);
    const b2 = await (await page.$(card)).boundingBox();
    await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.waitForFunction(() => document.querySelector('[data-testid="press-count"]').textContent === '1');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('FLIP 高度：内容变高时元素“卷”开（裁切半路）、后面的内容同一条弹簧滑下去；变矮时滑回来', async () => {
  const app = await open();
  try {
    const { page } = app;
    const read = () => {
      const card = document.querySelector('[data-testid="height-card"]');
      const after = document.querySelector('[data-testid="height-after"]');
      const r = card.getBoundingClientRect();
      const clip = getComputedStyle(card).clipPath;
      const m = /inset\(0px 0px ([\d.]+)px/.exec(clip);
      return { h: r.height, cut: m ? Number(m[1]) : 0, afterGap: after.getBoundingClientRect().top - r.top };
    };
    const grow = await threeShots(app, {
      name: 'height-grow',
      frame: '#demo-flip-height',
      trigger: () => page.click(tid('height-toggle')),
      selector: '[data-testid="height-card"]',
      progress: 0.2,
      read,
    });
    const delta = grow.end.h - grow.start.h;
    assert.ok(delta > 40, `内容变高了 ${delta}px`);
    assert.ok(between(grow.mid.cut, 0, delta, 2), `半路还裁着 ${grow.mid.cut}px（共 ${delta}px）`);
    // 后面那块的位置 = 卡片看得见的底边：半路介于两端之间
    assert.ok(between(grow.mid.afterGap, grow.start.afterGap, grow.end.afterGap, 2), `后面的内容半路 ${grow.mid.afterGap}`);
    assert.equal(grow.end.cut, 0);
    const shrink = await threeShots(app, {
      name: 'height-shrink',
      frame: '#demo-flip-height',
      trigger: () => page.click(tid('height-toggle')),
      selector: '[data-testid="height-after"]',
      progress: 0.2,
      read,
    });
    assert.ok(between(shrink.mid.afterGap, shrink.end.afterGap, shrink.start.afterGap, 2), `变矮时后面的内容滑回来：${shrink.mid.afterGap}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('勾选框：底色从中心弹出、对勾描线；划掉的线从左往右画过去', async () => {
  const app = await open();
  try {
    const { page } = app;
    const sel = tid('check-esim');
    const read = new Function(`
      const root = document.querySelector('${sel}');
      const fill = getComputedStyle(root.querySelector('.check__fill')).scale;
      return { fill: fill === 'none' ? 1 : Number(fill.split(' ')[0]), dash: Number(getComputedStyle(root.querySelector('.check__tick')).strokeDashoffset.replace('px', '')),
        checked: root.querySelector('input').checked };
    `);
    const r = await threeShots(app, { name: 'checkbox', frame: '#demo-checkbox .pv-list', trigger: () => page.click(sel), selector: '.check__fill, .check__tick, .check__label', progress: 0.12, read });
    assert.ok(between(r.mid.fill, 0.2, 1.05, 0.03), `底色半路 ${r.mid.fill}`);
    assert.ok(r.mid.dash > 0.02, `对勾还没描完：${r.mid.dash}`);
    assert.ok(r.end.checked && Math.abs(r.end.dash) < 0.01 && Math.abs(r.end.fill - 1) < 0.01);
    // 半选（全部）
    assert.equal(await page.$eval('[data-testid="check-list"] .check:first-child', (el) => el.dataset.state), 'mixed');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('小胶囊：选中时对勾的宽度展开、文字被平滑推开', async () => {
  const app = await open();
  try {
    const { page } = app;
    const sel = tid('chip-1');
    const read = new Function(`return document.querySelector('${sel} .chip__check').getBoundingClientRect().width;`);
    const r = await threeShots(app, { name: 'chip-select', frame: '#demo-chips .pv-group', trigger: () => page.click(sel), selector: '.chip__check', progress: 0.2, read });
    assert.ok(r.start < 0.5 && r.end > 10, `对勾宽度 ${r.start} → ${r.end}`);
    assert.ok(between(r.mid, r.start, r.end, 1), `半路 ${r.mid}`);
    assert.equal(await page.$eval(sel, (el) => el.getAttribute('aria-pressed')), 'true');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('轻提示（全站唯一的 overlay/ toast()）：从下面弹上来；往下拖甩掉后卸载；数字角标变化时弹一下', async () => {
  const app = await open();
  try {
    const { page } = app;
    await center(app, '#demo-toast');
    const card = '.ov-toast[data-state="open"] .ov-toast__card';
    const r = await threeShots(app, {
      name: 'toast-in',
      trigger: () => page.click(tid('toast-success')),
      selector: '.ov-toast__card',
      progress: 0.12,
      read: () => {
        const t = document.querySelector('.ov-toast[data-state="open"] .ov-toast__card');
        return t ? new DOMMatrixReadOnly(getComputedStyle(t).transform).m42 : null;
      },
    });
    assert.equal(r.start, null);
    assert.ok(between(r.mid, 0, 28, 1), `半路还在往上走：${r.mid}`);
    assert.ok(Math.abs(r.end) < 0.5);
    assert.equal(await page.$eval('.ov-toast', (el) => el.dataset.tone), 'success');
    assert.match(await page.$eval(card, (el) => el.textContent), /已记一笔.*撤销/);
    // 往下甩
    const box = await (await page.$(card)).boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(box.x + 20, box.y + box.height / 2 + i * 14);
      await sleep(10);
    }
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.ov-toast'), { timeout: 4000 });
    // 数字角标
    await center(app, tid('count-badge'));
    const pop = await captureMidAnimation(app, () => page.click(tid('count-inc')), {
      progress: 0.2,
      filter: (a) => a.name === 'badge-pop',
      evaluate: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="count-badge"]')).transform).a,
    });
    assert.ok(pop.state > 1.02, `角标弹了一下：scale ${pop.state}`);
    await waitForAnimationsDone(page);
    assert.match(await page.$eval(tid('count-badge'), (el) => el.getAttribute('aria-label')), /4/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 减弱动态效果
// ---------------------------------------------------------------------
test('减弱动态效果：列表 ↔ 网格不做位移，只做短淡入；弹簧变成 160ms 短补间', async () => {
  const app = await open({ reducedMotion: true });
  try {
    const { page } = app;
    await center(app, '#demo-view-switch');
    const r = await captureMidAnimation(app, () => page.click(tid('view-toggle')), {
      progress: 0.5,
      selector: '.vs-card__bg, .vs-card__media, .vs-card__text',
      evaluate: () => ({
        transform: getComputedStyle(document.querySelector('[data-testid="view-card-p2"] .vs-card__media')).transform,
        opacity: Number(getComputedStyle(document.querySelector('[data-testid="view-card-p2"] .vs-card__media')).opacity),
      }),
    });
    assert.equal(r.state.transform, 'none', '没有位移');
    assert.ok(r.state.opacity < 1, '短淡入');
    assert.ok(r.animations.every((a) => a.duration <= 200), `都是短动画：${r.animations.map((a) => a.duration)}`);
    await waitForAnimationsDone(page);
    // 分段控件：短补间（不回弹）
    const seg = await captureMidAnimation(app, () => page.click(`${tid('seg-main')} .seg__item:nth-of-type(2)`), { progress: 0.5, selector: '.seg__thumb' });
    assert.ok(seg.animations.every((a) => a.duration <= 200), `分段控件动画时长 ${seg.animations.map((a) => a.duration)}`);
    await waitForAnimationsDone(page);
    await shot(app, 'reduced-motion-grid', '#demo-view-switch');
    app.assertClean();
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------
// 整页：手机 / 桌面 / 深色
// ---------------------------------------------------------------------
for (const [device, scheme] of [['mobile', 'light'], ['desktop', 'light'], ['mobile', 'dark']]) {
  test(`展示页（${device === 'mobile' ? '手机 390×844' : '桌面 1280×800'}，${scheme === 'dark' ? '深色' : '浅色'}）：无报错、不横向滚动、触控区 ≥44、整页截图`, async () => {
    const app = await open({ device, colorScheme: scheme });
    try {
      const { page } = app;
      await assertNoHorizontalOverflow(page);
      // 只检查本页自己的组件（其他模块登记的演示由它们自己的测试负责）
      await assertTapTargets(page, { exclude: '.dev-section:not(.pv-section), .demo-badge, .pv-static' });
      const count = await page.$$eval('.pv-section', (els) => els.length);
      assert.ok(count >= 20, `区块数 ${count}`);
      await shot(app, `page-${scheme}`);
      await fullPageShots(page, (await shot(app, `page-full-${scheme}`)));
      app.assertClean();
    } finally {
      await app.close();
    }
  });
}
