// 动效：“截动画半路”工具自检、弹簧曲线真的生效、动画可被打断、减弱动态效果、按压反馈。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './lib/harness.mjs';
import { captureMidAnimation, waitForAnimationsDone, readTransform, withPlaybackRate } from './lib/animation.mjs';
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

const DOT = (name) => `[data-testid="spring-dot-${name}"]`;
const TOGGLE = '[data-testid="springs-toggle"]';

async function openSprings(options = {}) {
  const app = await openApp({ browser, server, hash: '#/dev/primitives', ...options });
  await app.page.waitForSelector(DOT('smooth'));
  return app;
}

/** 圆点走完全程的距离（轨道宽 − 44） */
const travel = (page) => page.$eval('.dev-spring__track', (el) => el.getBoundingClientRect().width - 44);

test('截动画半路：拨到 50% 时间，三个圆点都停在半路，截图；放开后走完全程', async () => {
  const app = await openSprings();
  try {
    const { page } = app;
    const end = await travel(page);
    const result = await captureMidAnimation(app, () => page.click(TOGGLE), {
      progress: 0.5,
      name: 'springs-50',
      selector: '.dev-spring__dot',
      evaluate: () => Object.fromEntries(['snappy', 'bouncy', 'smooth'].map((n) => {
        const el = document.querySelector(`[data-testid="spring-dot-${n}"]`);
        return [n, new DOMMatrixReadOnly(getComputedStyle(el).transform).m41];
      })),
    });
    assert.equal(result.animations.length, 3, '三个圆点各一个 transition');
    assert.ok(result.file.endsWith('springs-50.png'));
    for (const [name, x] of Object.entries(result.state)) {
      assert.ok(x > end * 0.3 && x < end * 1.06, `${name} 半路位置 ${x.toFixed(1)}（全程 ${end.toFixed(1)}）`);
    }
    // 弹簧特征：50% 时间时，snappy 和 bouncy 已经走了九成以上，smooth 稍慢一些
    assert.ok(result.state.bouncy > end * 0.9, `bouncy 50% 时间已接近终点：${result.state.bouncy}`);
    assert.ok(result.state.smooth < result.state.bouncy, 'smooth 比 bouncy 慢');
    // 时长来自设计变量
    assert.deepEqual(result.animations.map((a) => a.duration).sort((a, b) => a - b), [460, 620, 740]);
    await waitForAnimationsDone(page);
    const final = await readTransform(page, DOT('bouncy'));
    assert.ok(Math.abs(final.x - end) < 0.5, `走完全程：${final.x} ≈ ${end}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('动画可被打断：半路反向，从当前位置折返，不跳回起点', async () => {
  const app = await openSprings();
  try {
    const { page } = app;
    const mid = await captureMidAnimation(app, () => page.click(TOGGLE), {
      progress: 0.3,
      selector: '.dev-spring__dot',
      evaluate: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="spring-dot-smooth"]')).transform).m41,
      keepPaused: true,
    });
    // 在半路再点一次（反向），立刻读位置：应当还在半路附近，而不是 0 或终点
    const back = await captureMidAnimation(app, () => page.click(TOGGLE), {
      progress: 0,
      selector: '.dev-spring__dot',
      evaluate: () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="spring-dot-smooth"]')).transform).m41,
    });
    await mid.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    assert.ok(mid.state > 10, `先走了一段：${mid.state}`);
    assert.ok(Math.abs(back.state - mid.state) < 2, `折返起点 ${back.state} 应等于打断时的位置 ${mid.state}`);
    await waitForAnimationsDone(page);
    assert.ok(Math.abs((await readTransform(page, DOT('smooth'))).x) < 0.5, '最后回到起点');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减弱动态效果：弹簧换成短缓出（--dur-fast = 160ms），不回弹', async () => {
  const app = await openSprings({ reducedMotion: true });
  try {
    const { page } = app;
    const info = await page.$eval(DOT('bouncy'), (el) => {
      const s = getComputedStyle(el);
      return { duration: s.transitionDuration, easing: s.transitionTimingFunction };
    });
    assert.equal(info.duration, '0.16s');
    assert.doesNotMatch(info.easing, /linear/);
    assert.ok(await page.$('.dev-springs .dev-section__note, .dev-springs .dev-buttons .dev-section__note'), '页面提示减弱动态效果已开启');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('按压反馈（只写 data-press 的按钮，全局委托）：按下缩到 --press-scale（「杂志纸本」0.98），松手弹回 1', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/primitives', device: 'desktop' });
  try {
    const { page } = app;
    const btn = await page.waitForSelector('#demo-press .dev-btn--primary');
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await btn.boundingBox();
    const target = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--press-scale')));
    assert.ok(target > 0.9 && target < 1, `--press-scale ${target}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 缩放用独立的 scale 属性（motion/press.css），不占 transform
    const scaleOf = (el) => {
      const v = getComputedStyle(el).scale;
      return v === 'none' ? 1 : Number(v.split(' ')[0]);
    };
    await page.waitForFunction((el, t) => {
      const v = getComputedStyle(el).scale;
      return v !== 'none' && Number(v.split(' ')[0]) < t + 0.001;
    }, { timeout: 2000 }, btn, target);
    await waitForAnimationsDone(page);
    const pressed = await btn.evaluate(scaleOf);
    assert.ok(Math.abs(pressed - target) < 0.002, `按下缩放 ${pressed}（--press-scale ${target}）`);
    await withPlaybackRate(page, 1, async () => {
      await page.mouse.up();
    });
    await waitForAnimationsDone(page);
    const released = await btn.evaluate(scaleOf);
    assert.ok(Math.abs(released - 1) < 0.001, `松手后 ${released}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});
