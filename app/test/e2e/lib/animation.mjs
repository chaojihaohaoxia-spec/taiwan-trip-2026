// =====================================================================
// test/e2e/lib/animation.mjs：截“动画半路”的画面、控制动画速度。
//
// 原理：Chrome 开发者协议（CDP）的 Animation 域。
//   1. Animation.setPlaybackRate(0)：之后新开始的动画（CSS transition、@keyframes、element.animate）
//      全部停在第 0 帧；
//   2. 触发交互（点击等），收集这期间开始的动画；
//   3. Animation.seekAnimations 把每个动画拨到 delay + duration × progress；
//   4. 截图、读取状态；
//   5. 恢复正常速度（动画从拨到的地方继续播完）。
// 结果是确定的，不受机器快慢影响。
//
//   const { animations, file } = await captureMidAnimation(app, async () => {
//     await app.page.click('[data-testid="springs-toggle"]');
//   }, { progress: 0.5, name: 'springs-50', selector: '.dev-spring__dot' });
//
// 只处理触发之后新开始的动画（之前就在跑的不动，也不会被“复活”）；selector 只拨目标元素匹配的动画
// （点击按钮时按钮自己的按压动画不会被算进来）。
//
// 也可以只放慢：await withPlaybackRate(app.page, 0.1, async () => { … });
// =====================================================================

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SCREENSHOT_DIR } from './harness.mjs';

async function cdpFor(page) {
  return page.createCDPSession();
}

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * @param {{ page: import('puppeteer-core').Page, testName?: string, device?: string }} app  openApp() 的返回值（或至少有 page）
 * @param {() => Promise<void>} trigger  触发动画的操作
 * @param {{ progress?: number, name?: string, selector?: string, filter?: (a: object) => boolean, evaluate?: () => any,
 *           fullPage?: boolean, keepPaused?: boolean }} [options]
 *   progress   0–1，拨到动画的哪个位置（按时间，不是按位移；弹簧曲线 50% 时间时位移会超过一半）
 *   name       截图名（不给就不截图）
 *   selector   只拨目标元素匹配这个 CSS 选择器的动画
 *   filter     只拨符合条件的动画（参数是 CDP 的 Animation 对象：name、type、source.duration…）
 *   evaluate   截图前在页面里执行，返回值放进结果的 state（比如读元素的 transform）
 *   keepPaused true = 结束后不恢复播放（自己再调 releaseAnimations）
 * @returns {Promise<{ animations: Array<{id:string,name:string,type:string,duration:number,delay:number}>, file: string|null, state: any, cdp: any }>}
 */
export async function captureMidAnimation(app, trigger, options = {}) {
  const { progress = 0.5, name = null, selector = null, filter = () => true, evaluate, fullPage = false, keepPaused = false } = options;
  const page = app.page;
  const cdp = await cdpFor(page);
  const started = [];
  cdp.on('Animation.animationStarted', ({ animation }) => started.push(animation));
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  // enable 时 Chrome 会把已经在跑的动画也报一遍：记下来排除掉，只要触发之后新开始的
  await twoFrames(page);
  const preexisting = new Set(started.map((a) => a.id));
  started.length = 0;
  try {
    await trigger();
    await twoFrames(page);
    const fresh = started.filter((a) => !preexisting.has(a.id));
    let picked = fresh.filter(filter);
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
    if (!picked.length) throw new Error('触发后没有捕获到任何动画（是不是被“减弱动态效果”关掉了，或者选择器没点中？）');
    for (const a of picked) {
      const duration = a.source?.duration ?? 0;
      const delay = a.source?.delay ?? 0;
      await cdp.send('Animation.seekAnimations', { animations: [a.id], currentTime: delay + duration * progress });
    }
    await twoFrames(page);
    const state = evaluate ? await page.evaluate(evaluate) : null;
    let file = null;
    if (name) {
      const dir = path.join(SCREENSHOT_DIR, app.testName || 'misc');
      mkdirSync(dir, { recursive: true });
      file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file, fullPage });
    }
    return {
      animations: picked.map((a) => ({ id: a.id, name: a.name, type: a.type, duration: a.source?.duration ?? 0, delay: a.source?.delay ?? 0 })),
      file,
      state,
      cdp,
    };
  } finally {
    if (!keepPaused) {
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
      await cdp.send('Animation.disable').catch(() => {});
    }
  }
}

/** 在一段操作期间把全页动画速度改成 rate（例如 0.1 = 慢 10 倍），结束后恢复 */
export async function withPlaybackRate(page, rate, fn) {
  const cdp = await cdpFor(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
  try {
    return await fn();
  } finally {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await cdp.send('Animation.disable').catch(() => {});
  }
}

/** 等页面上所有有限次的动画播完 */
export async function waitForAnimationsDone(page, timeout = 5000) {
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle' || a.effect?.getComputedTiming().iterations === Infinity),
    { timeout },
  );
}

/** 读元素当前的位移（matrix 的 tx, ty）和缩放 */
export function readTransform(page, selector) {
  return page.$eval(selector, (el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42, scaleX: m.a, scaleY: m.d };
  });
}
