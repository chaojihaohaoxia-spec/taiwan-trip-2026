// 四个展示页的验收截图：#/dev/skin（皮肤样张、字体、材质、光场）、#/dev/primitives（动效与交互组件）、#/dev/overlays（弹层）、#/dev/lib（工具与服务），
// 各在四种条件下截整页：手机 390×844 浅色、桌面 1280×800 浅色、手机深色、手机“减弱动态效果”。
// 每张都检查：没有控制台报错、不连外网、不横向滚动、所有可点元素 ≥44px（地图的 Leaflet 控件除外）。
// 截图在 __screenshots__/showcase/<页面>-<条件>.png（不进 git）；页面太长时分段：<页面>-<条件>-1.png、-2.png……
// （Chrome 一张截图最高约 16384 设备像素，超过以后画面会重复，见 lib/harness.mjs 的 fullPageShots）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, assertTapTargets, fullPageShots, SCREENSHOT_DIR } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

const DIR = path.join(SCREENSHOT_DIR, 'showcase');
mkdirSync(DIR, { recursive: true });

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

/** 页面：路由、标题、“内容都到了”的判断 */
const PAGES = [
  {
    id: 'skin',
    title: '皮肤',
    ready: async (page) => {
      await page.waitForSelector('[data-testid="skin-sample"]');
      // 网页字体都到了：宋体分片、Instrument Serif、P2 Figure One 都在用（字体报告出来了）；Geist 已经去掉，标签用系统字体
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => /思源宋体 \d+ 片/.test(document.querySelector('[data-testid="skin-font-report"]')?.textContent || ''), { timeout: 8000 });
      const ok = await page.evaluate(() => {
        // 思源宋体按 unicode-range 分片，b 片写的是一整段连续区间，会和 t 片（常用字逐字列出）重叠：
        // 浏览器按声明的倒序找第一个覆盖这个字的面、只下载那一片（字形就在那片里，见 fonts.test 的“第一个覆盖的面”），
        // 而 document.fonts.check() 要求所有覆盖到的面都加载了才算——会把没必要下载的那片也算进去。这里按浏览器的规则查。
        const covers = (face, cp) => face.unicodeRange.split(',').some((r) => {
          const [lo, hi = lo] = r.trim().replace(/^U\+/i, '').split('-');
          return cp >= parseInt(lo.replace(/\?/g, '0'), 16) && cp <= parseInt(hi.replace(/\?/g, 'F'), 16);
        });
        const serifReady = (weight, text) => {
          const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Noto Serif SC' && String(f.weight) === weight).reverse();
          return faces.length > 0 && [...text].every((ch) => faces.find((f) => covers(f, ch.codePointAt(0)))?.status === 'loaded');
        };
        return [
          serifReady('600', '椰影岛'),
          document.fonts.check('400 27px "Instrument Serif"', '16:45'),
          document.fonts.check('italic 400 84px "Instrument Serif"', '5'),
          ![...document.fonts].some((f) => /Geist/.test(f.family)),
          document.fonts.check('400 27px "P2 Figure One"', '1'),
        ];
      });
      assert.deepEqual(ok, [true, true, true, true, true], '宋体 / Instrument Serif 正斜体 / P2 Figure One 都加载好了，没有 Geist');
    },
  },
  {
    id: 'primitives',
    title: '基础组件',
    ready: async (page) => {
      await page.waitForSelector('[data-testid="primitives-page"]');
      // 页尾其他模块登记的演示（按需加载）也到了
      await page.waitForFunction(() => document.querySelectorAll('.dev-section .dev-checklist__item').length === 10);
    },
  },
  {
    id: 'overlays',
    title: '弹层',
    ready: async (page) => {
      await page.waitForSelector('[data-testid="stack-state"]');
      await page.waitForSelector('[data-testid="open-expense"]');
    },
  },
  {
    id: 'lib',
    title: '工具与服务',
    ready: async (page) => {
      await page.waitForSelector('[data-testid="trip-map"] .tm-marker');
      await page.waitForSelector('[data-testid="wx-card"] .lp-wx__day');
      await page.waitForFunction(() => /抵达/.test(document.querySelector('[data-testid="copy-preview"]')?.textContent || ''));
    },
  },
];

const CONDITIONS = [
  { id: 'mobile', label: '手机 390×844 浅色', device: 'mobile' },
  { id: 'desktop', label: '桌面 1280×800 浅色', device: 'desktop' },
  { id: 'dark', label: '手机深色', device: 'mobile', colorScheme: 'dark' },
  { id: 'reduced', label: '手机“减弱动态效果”', device: 'mobile', reducedMotion: true },
];

for (const p of PAGES) {
  for (const c of CONDITIONS) {
    test(`#/dev/${p.id}（${c.label}）：整页截图；无报错、不连外网、不横向滚动、触控区 ≥44px`, async () => {
      const app = await openApp({
        browser, server, hash: `#/dev/${p.id}`, device: c.device, colorScheme: c.colorScheme || 'light', reducedMotion: Boolean(c.reducedMotion),
      });
      try {
        const { page } = app;
        await p.ready(page);
        await app.idle();
        assert.equal(await page.$eval('h1', (el) => el.textContent), p.title);
        // 条件真的生效了
        const env = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          bg: getComputedStyle(document.documentElement).backgroundColor,
        }));
        assert.equal(env.width, c.device === 'desktop' ? 1280 : 390);
        assert.equal(env.dark, c.colorScheme === 'dark');
        assert.equal(env.reduced, Boolean(c.reducedMotion));
        // 页面底色（纸本：<html> 上的 --color-canvas；body 透明，纸和纸纹在它下面）
        assert.equal(env.bg, c.colorScheme === 'dark' ? 'rgb(20, 20, 19)' : 'rgb(244, 241, 234)');
        await assertNoHorizontalOverflow(page);
        await assertTapTargets(page, { exclude: '.leaflet-container' });
        const files = await fullPageShots(page, path.join(DIR, `${p.id}-${c.id}.png`));
        assert.ok(files.length >= 1);
        app.assertClean();
      } finally {
        await app.close();
      }
    });
  }
}
