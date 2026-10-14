// =====================================================================
// scripts/lib/html.mjs：生成 index.html 和 manifest.webmanifest（构建、开发服务器共用）。
//
// 主题色：从 src/styles/tokens.css 读 --color-canvas 的浅色值（:root）和深色值
// （:root[data-theme="dark"]），写进 manifest 和两条带 media 的 <meta name="theme-color">。
// 所有网址都是相对路径（assets/…、icons/…、manifest.webmanifest），不写死仓库名。
// 字体：首屏用到的几个拉丁字体（Instrument Serif 正体 / 斜体、Geist、P2 Figure One）<link rel="preload" as="font">，
// 文件名由 scripts/fonts/preload.mjs 算（和 esbuild 打包出来的 assets/<名>-<哈希>.woff2 一致）；思源宋体的分片不预加载。
// =====================================================================

import { readFileSync } from 'node:fs';
import { TOKENS_CSS, APP_NAME, APP_DESCRIPTION, OUTPUTS } from './paths.mjs';
import { buildCsp } from './csp.mjs';
import { CSS_MAP_META } from './bundle.mjs';
import { fontPreloadHrefs } from '../fonts/preload.mjs';

/** 读 tokens.css 里某个选择器块中某个变量的值 */
export function readToken(css, selector, name) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css 里找不到 ${selector} {`);
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end);
  const m = new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`tokens.css 的 ${selector} 里没有 ${name}`);
  return m[1].trim();
}

/** 浅色 / 深色页面底色（manifest、theme-color 用） */
export function themeColors() {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  return {
    light: readToken(css, ':root', '--color-canvas'),
    dark: readToken(css, ':root[data-theme="dark"]', '--color-canvas'),
  };
}

/** 首帧前应用用户强制的深浅色（键和 lib/theme.js 一致：rs7885:theme） */
export const THEME_BOOT_SCRIPT = "try{var t=localStorage.getItem('rs7885:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

/** 不支持 ES 模块的旧浏览器：在启动画面上说明原因 */
export const NOMODULE_SCRIPT = "var b=document.getElementById('boot');if(b)b.innerHTML='<p>这个浏览器版本太旧，打不开热爱生活7885。请把 iOS / Safari / Chrome 升级到最新版本。</p>';";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** 开发页样式表的位置写在这个 <meta> 里（lib/dev-styles.js 读它；线上用户不会去加载） */
export const DEV_CSS_META = 'rs7885-dev-css';

export { CSS_MAP_META };

/**
 * 按需样式表清单（scripts/lib/bundle.mjs 的 buildCss 算的 chunkCss）→ <meta name="rs7885-css-map"> 的内容：
 * { f: [网址…], m: { 入口（去掉 src/）: [f 的下标…] } }。没有按需样式表时返回 null（不写 <meta>）。
 * @param {{ files: string[], map: Record<string, number[]> }|null} chunkCss
 * @param {string} assetsDir
 */
export function cssMapContent(chunkCss, assetsDir = OUTPUTS.assetsDir) {
  if (!chunkCss || !chunkCss.files.length) return null;
  const m = {};
  for (const [key, list] of Object.entries(chunkCss.map)) m[key.replace(/^src\//, '')] = list;
  return JSON.stringify({ f: chunkCss.files.map((f) => `${assetsDir}/${f}`), m });
}

/**
 * @param {{ cssHref: string, devCssHref?: string|null, jsHref: string, preload?: string[], version: string, dev?: boolean,
 *           extraScripts?: string[], cssMap?: string|null }} p
 */
export function renderHtml({ cssHref, devCssHref = null, jsHref, preload = [], version, dev = false, extraScripts = [], cssMap = null }) {
  const colors = themeColors();
  const csp = buildCsp({ inlineScripts: [THEME_BOOT_SCRIPT, NOMODULE_SCRIPT] });
  const lines = [
    '<!doctype html>',
    '<html lang="zh-CN" dir="ltr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`,
    `<title>${esc(APP_NAME)}</title>`,
    `<meta name="description" content="${esc(APP_DESCRIPTION)}">`,
    `<meta name="app-version" content="${esc(version)}">`,
    '<meta name="generator" content="rs7885-build">',
    '<meta name="color-scheme" content="light dark">',
    `<meta name="theme-color" content="${esc(colors.light)}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${esc(colors.dark)}" media="(prefers-color-scheme: dark)">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    `<meta name="apple-mobile-web-app-title" content="${esc(APP_NAME)}">`,
    // default：状态栏不透明、跟随 theme-color，浅色深色都看得清（black-translucent 在浅色页面上会看不见时间和电量）
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="format-detection" content="telephone=no">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">',
    '<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    `<script>${THEME_BOOT_SCRIPT}</script>`,
    // 字体预加载：crossorigin 必须写（字体总是按 CORS 方式请求，不写会下载两次）
    ...fontPreloadHrefs(OUTPUTS.assetsDir).map((p) => `<link rel="preload" href="${esc(p)}" as="font" type="font/woff2" crossorigin>`),
    `<link rel="stylesheet" href="${esc(cssHref)}">`,
    ...(devCssHref ? [`<meta name="${DEV_CSS_META}" content="${esc(devCssHref)}">`] : []),
    // 按需样式表清单（页面、弹层打开时和 JS 一起下载，src/lib/chunk-css.js 读）
    ...(cssMap ? [`<meta name="${CSS_MAP_META}" content="${esc(cssMap)}">`] : []),
    ...preload.map((p) => `<link rel="modulepreload" href="${esc(p)}">`),
    `<script type="module" src="${esc(jsHref)}"></script>`,
    ...extraScripts.map((s) => `<script type="module" src="${esc(s)}"></script>`),
    '</head>',
    '<body>',
    '<div id="app"></div>',
    '<div id="boot" class="boot" role="status">',
    `<div><p class="boot__name">${esc(APP_NAME)}</p><p>正在打开…</p></div>`,
    '</div>',
    '<noscript><p class="boot">需要开启 JavaScript 才能使用热爱生活7885。</p></noscript>',
    `<script nomodule>${NOMODULE_SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ];
  if (dev) lines.splice(lines.indexOf('<meta name="generator" content="rs7885-build">'), 1, '<meta name="generator" content="rs7885-dev">');
  return lines.join('\n');
}

/** manifest.webmanifest 的内容 */
export function renderManifest() {
  const colors = themeColors();
  const manifest = {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: 'zh-CN',
    dir: 'ltr',
    // 相对路径：按 manifest 所在目录解析，不写死仓库名。
    // 不写 id：默认等于解析后的 start_url（含仓库路径，唯一）；写相对 id 会按域名根解析，
    // 和同一个 github.io 账号下的其他网站撞 id。
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: colors.light,
    theme_color: colors.light,
    categories: ['travel', 'lifestyle'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 构建要复制的图标（static/icons → 根目录 icons/） */
export const ICON_FILES = [
  'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png',
  'apple-touch-icon.png', 'favicon-32.png', 'favicon.svg',
];
