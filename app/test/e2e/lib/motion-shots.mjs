// =====================================================================
// test/e2e/lib/motion-shots.mjs：交互组件 e2e 的公用工具——每个交互截「开始 / 动画半路 / 结束」三张图，
// 并读出三个时刻的状态，用来断言“动画确实在播、半路的值介于两端之间”。
//
//   const r = await threeShots(app, {
//     name: 'search-open',                       // → test/e2e/__shots__/motion/search-open-{start,mid,end}.png
//     frame: '#demo-search',                     // 截哪一块（元素截图，三张取景一致）
//     trigger: () => page.click('[data-testid="search"] .search-x__trigger'),
//     selector: '.search-x__field',              // 只拨这个元素上的动画（按钮自己的按压动画不算）
//     read: () => …,                             // 在页面里读状态（三个时刻都会读）
//   });
//   r.start / r.mid / r.end：三个时刻 read() 的结果；r.animations：拨到半路的那些动画
//
// 截图目录 test/e2e/__shots__/motion/（不进 git；设了 RS_OUT_DIR 时在 <RS_OUT_DIR>/_e2e/__shots__/motion/）。
// 手机截图文件名不带后缀，其他设备加 -desktop 等。
// =====================================================================

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { waitForAnimationsDone } from './animation.mjs';
import { shotsDir } from './harness.mjs';

export const SHOTS_DIR = shotsDir('motion');

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * 截一个元素（或整屏）到 __shots__/motion/。
 * 不用 ElementHandle.screenshot：它会临时放大视口来截图，截完页面的滚动位置会变（开始 / 半路 / 结束三张
 * 取景对不上，读到的坐标也乱了）。这里只截当前视口里这个元素可见的部分，不动滚动位置、不改视口。
 */
export async function shot(app, name, frame) {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const suffix = app.device && app.device !== 'mobile' ? `-${app.device}` : '';
  const file = path.join(SHOTS_DIR, `${name}${suffix}.png`);
  if (!frame) {
    await app.page.screenshot({ path: file, captureBeyondViewport: false });
    return file;
  }
  const clip = await app.page.evaluate((sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : null;
    if (!el) return null;
    let r = el.getBoundingClientRect();
    // 完全不在屏幕上：先滚到中间（只在需要时滚，平时不动滚动位置）
    if (r.bottom <= 0 || r.top >= window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      r = el.getBoundingClientRect();
    }
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const x = Math.max(0, r.left - 8);
    const y = Math.max(0, r.top - 8);
    const w = Math.min(vw, r.right + 8) - x;
    const h = Math.min(vh, r.bottom + 8) - y;
    return w > 1 && h > 1 ? { x: x + window.scrollX, y: y + window.scrollY, width: w, height: h } : null;
  }, frame);
  if (!clip) throw new Error(`截图区域不存在或不在屏幕上：${frame}`);
  await app.page.screenshot({ path: file, clip, captureBeyondViewport: false });
  return file;
}

/** 把元素滚到屏幕中间（截图、点击前用；只滚页面，不触发动画） */
export async function center(app, selector) {
  await app.page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await twoFrames(app.page);
}

/**
 * 截“同一时刻”的半路画面：和 lib/animation.mjs 的 captureMidAnimation 一样用 CDP 把全页动画停在第 0 帧、
 * 触发交互；不同的是——以 selector 匹配的“主动画”的进度 progress 算出一个绝对时刻 T，
 * 把触发之后新开始的**所有**动画都拨到同一个 T（各自的延迟、时长照算），
 * 于是半路截图里每个部件（底色、文字、图标、旁边的元素）都是同一瞬间的样子，和真实播放时看到的一致。
 * @returns {Promise<{ state: any, animations: object[], time: number, cdp: any }>} 结束后保持暂停，调用方 release
 */
export async function captureAt(app, trigger, { selector = null, filter = () => true, progress = 0.5, evaluate } = {}) {
  const page = app.page;
  const cdp = await page.createCDPSession();
  const started = [];
  cdp.on('Animation.animationStarted', ({ animation }) => started.push(animation));
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await twoFrames(page);
  const preexisting = new Set(started.map((a) => a.id));
  started.length = 0;
  await trigger();
  await twoFrames(page);
  const fresh = started.filter((a) => !preexisting.has(a.id));
  let main = fresh.filter(filter);
  if (selector) {
    await cdp.send('DOM.getDocument', { depth: 0 });
    const keep = [];
    for (const a of main) {
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
    main = keep;
  }
  if (!main.length) {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    throw new Error('触发后没有捕获到匹配的动画（选择器没点中，或者被“减弱动态效果”关掉了？）');
  }
  // 主动画里最长的那个决定“半路”是哪一刻
  const longest = main.reduce((x, y) => ((y.source?.duration ?? 0) + (y.source?.delay ?? 0) > (x.source?.duration ?? 0) + (x.source?.delay ?? 0) ? y : x));
  const time = (longest.source?.delay ?? 0) + (longest.source?.duration ?? 0) * progress;
  if (fresh.length) await cdp.send('Animation.seekAnimations', { animations: fresh.map((a) => a.id), currentTime: time });
  await twoFrames(page);
  const state = evaluate ? await page.evaluate(evaluate) : null;
  return {
    state,
    time,
    cdp,
    animations: main.map((a) => ({ id: a.id, name: a.name, type: a.type, duration: a.source?.duration ?? 0, delay: a.source?.delay ?? 0 })),
  };
}

/** 放开 captureAt 停住的动画 */
export async function release(capture) {
  await capture.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await capture.cdp.send('Animation.disable').catch(() => {});
}

/**
 * 开始 → 触发 → 拨到半路（截图、读状态）→ 放开播完 → 结束（截图、读状态）。
 * @param {object} app openApp() 的返回值
 * @param {{ name: string, frame?: string, trigger: () => Promise<any>, selector?: string, filter?: (a: object) => boolean,
 *           progress?: number, read?: () => any, settle?: () => Promise<void> }} o
 */
export async function threeShots(app, o) {
  const { page } = app;
  const read = o.read || (() => null);
  if (o.frame) await center(app, o.frame);
  const start = await page.evaluate(read);
  const files = { start: await shot(app, `${o.name}-start`, o.frame) };
  const mid = await captureAt(app, o.trigger, { progress: o.progress ?? 0.5, selector: o.selector, filter: o.filter, evaluate: read });
  try {
    files.mid = await shot(app, `${o.name}-mid`, o.frame);
  } finally {
    await release(mid);
  }
  await waitForAnimationsDone(page, 8000);
  if (o.settle) await o.settle();
  await twoFrames(page);
  const end = await page.evaluate(read);
  files.end = await shot(app, `${o.name}-end`, o.frame);
  return { start, mid: mid.state, end, animations: mid.animations, time: mid.time, files };
}

/** a 在 lo 和 hi 之间（不含两端，允许给一点余量 eps 表示“必须离两端至少这么远”） */
export function between(value, a, b, eps = 0.5) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return value > lo + eps && value < hi - eps;
}

/**
 * 解析一个长度：12px、-3.5px、40%、calc(100% - 44px)、calc(51.2% + -20.4px)。percentOf：百分比的参照长度。
 */
export function resolveLength(text, percentOf = 0) {
  let t = String(text).trim();
  const calc = /^calc\((.*)\)$/.exec(t);
  if (calc) t = calc[1];
  // 拆成带符号的项：a% 、 bpx
  let total = 0;
  const re = /([+-]?)\s*(-?[\d.]+(?:e-?\d+)?)(px|%)?/gi;
  let m;
  let sign = 1;
  let rest = t;
  while ((m = re.exec(rest))) {
    const before = rest.slice(0, m.index).trim();
    if (before.endsWith('-')) sign = -1;
    else if (before.endsWith('+')) sign = 1;
    const v = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    total += sign * (m[3] === '%' ? (v / 100) * percentOf : v);
    rest = rest.slice(m.index + m[0].length);
    re.lastIndex = 0;
    sign = 1;
  }
  return total;
}

/** 按顶层空格切开（不切 calc() 里面的空格） */
function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 解析 clip-path: inset(t r b l round …) → { t, r, b, l }（px）。
 * 计算值里可能带 calc() 和百分比：传元素的宽高（w, h）换算。
 */
export function parseInset(text, w = 0, h = 0) {
  const s = String(text);
  const i = s.indexOf('inset(');
  if (i === -1) return null;
  let depth = 0;
  let j = i + 6;
  for (; j < s.length; j++) {
    if (s[j] === '(') depth++;
    if (s[j] === ')') {
      if (depth === 0) break;
      depth--;
    }
  }
  const body = s.slice(i + 6, j).split(/\sround\s/)[0];
  const parts = splitTop(body.trim());
  const [t, r = t, b = t, l = r] = parts;
  return { t: resolveLength(t, h), r: resolveLength(r, w), b: resolveLength(b, h), l: resolveLength(l, w) };
}

/** 解析 clip-path: circle(R at x y) → { r, x, y } */
export function parseCircle(text) {
  const m = /circle\(\s*([-\d.]+)px\s+at\s+([-\d.]+)px\s+([-\d.]+)px\s*\)/.exec(String(text));
  return m ? { r: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}
