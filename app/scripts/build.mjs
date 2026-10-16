#!/usr/bin/env node
// =====================================================================
// scripts/build.mjs：生产构建（npm run build）。产物写到仓库根目录，GitHub Pages 直接发布。
// 设了环境变量 RS_OUT_DIR 就写到那个目录（并行构建用，见 scripts/README.md），仓库根目录一个字节都不动。
//
// 步骤：
//   0. 检查：tokens.css 的弹簧曲线已同步；演示数据库是最新的（不是就重新生成）
//   1. JS 打包（代码分包、内容哈希）→ assets/main-XXXX.js、assets/chunk-XXXX.js、资源文件
//   2. CSS 合并（按目录分层）→ assets/app-XXXX.css（首屏）+ assets/style-XXXX.css（按需：页面、kit、弹层、地图，
//      跟着 JS 分包一起加载）+ assets/dev-XXXX.css（只给开发页，不预缓存）；见 lib/bundle.mjs
//   3. index.html（相对路径、CSP、深浅色 theme-color、modulepreload、按需样式表清单）
//   4. manifest.webmanifest + icons/ + fonts/（字体授权文件 static/fonts/licenses/ 和字体说明，随站部署、不预缓存）
//   5. sw.js（预缓存清单 + 版本号；演示/开发专用的分包、样式表不进预缓存）
//   6. 清掉上一次的产物，写入新产物（只动下面 OUTPUTS 里列的路径）
//   7. 自检：index.html 引用的文件都在、按需样式表都在、字体授权文件都在、sw.js 清单里的文件都在；打印体积
//   8. 体积预算：首屏 JS 60KB、首屏 CSS 25KB（gzip）。超了构建失败（退出码 1；产物照样写好，方便看是哪里大了）
//
// 构建是确定的：源码不变，产物一个字节都不变（不写时间戳），git diff 干净。
// =====================================================================

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { REPO_ROOT, APP_DIR, OUTPUTS, STATIC_DIR, SW_TEMPLATE, OUT_DIR, CUSTOM_OUT_DIR, OUT_MARKER } from './lib/paths.mjs';
import { esbuild, jsOptions, buildCss, analyzeJs, collectedCss } from './lib/bundle.mjs';
import { renderHtml, renderManifest, cssMapContent, ICON_FILES, DEV_CSS_META, CSS_MAP_META } from './lib/html.mjs';
import { tokensInSync } from './tokens.mjs';
import { ensureDemoDb } from './demo.mjs';

const pkg = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));

/** 体积预算（gzip 后）：超了构建失败（npm run check 跟着失败）。css 只算首屏样式表（按需的 style-*.css、开发页的 dev-*.css 不算） */
export const BUDGET = { initialJs: 60 * 1024, css: 25 * 1024 };

/** 随站部署的字体授权文件（static/fonts/ → 产物 fonts/licenses/；设置页「字体授权说明」链接到这里；不预缓存） */
export const FONT_LICENSE_FILES = Object.freeze({
  'fonts/licenses/Noto-Serif-SC-OFL.txt': 'fonts/licenses/Noto-Serif-SC-OFL.txt',
  'fonts/licenses/Instrument-Serif-OFL.txt': 'fonts/licenses/Instrument-Serif-OFL.txt',
  'fonts/licenses/README.md': 'fonts/README.md',
});

const posix = (p) => p.split(path.sep).join('/');

function assertOutDir() {
  if (CUSTOM_OUT_DIR) {
    // RS_OUT_DIR：paths.mjs 已经检查过（不在仓库里、空目录或以前的构建输出）；建目录并打上标记
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, OUT_MARKER), '热爱生活7885 的构建输出目录（RS_OUT_DIR）。npm run build 只会删改 index.html、assets/、sw.js、manifest.webmanifest、icons/、.nojekyll。\n');
    return;
  }
  // 防呆：确认要写的目录真的是这个仓库的根目录
  if (!existsSync(path.join(REPO_ROOT, '.git')) || !existsSync(path.join(REPO_ROOT, 'app', 'package.json'))) {
    throw new Error(`输出目录看起来不是仓库根目录：${REPO_ROOT}`);
  }
}

/** 渲染 sw.js：替换版本号和预缓存清单 */
export function renderServiceWorker(template, { version, precache }) {
  const V = "const VERSION = '__SW_VERSION__';";
  const P = 'const PRECACHE = __SW_PRECACHE__;';
  if (template.split(V).length !== 2 || template.split(P).length !== 2) {
    throw new Error('sw.js 模板里的占位行不对：要各有且只有一行 const VERSION = \'__SW_VERSION__\'; 和 const PRECACHE = __SW_PRECACHE__;');
  }
  return template
    .replace(V, `const VERSION = ${JSON.stringify(version)};`)
    .replace(P, `const PRECACHE = ${JSON.stringify(precache, null, 2)};`);
}

/**
 * 构建，返回所有要写的文件（相对输出目录的路径 → 内容）以及统计信息。不写磁盘。
 * 输出目录只影响 esbuild 算相对路径；产物内容和输出到哪里无关（RS_OUT_DIR 下构建结果一字节不差）。
 */
export async function buildApp() {
  const outdir = path.join(OUT_DIR, OUTPUTS.assetsDir);

  // 1. JS
  const js = await esbuild.build(jsOptions({ dev: false, outdir }));
  for (const w of js.warnings) console.warn(`[esbuild 警告] ${w.text}`);
  const analysis = analyzeJs(js.metafile, outdir);

  // 2. CSS（首屏 + 按需 + 开发页）
  const css = await buildCss({ dev: false, outdir, files: collectedCss(js.metafile), metafile: js.metafile, split: true });
  for (const w of css.warnings) console.warn(`[esbuild CSS 警告] ${w.text}`);

  /** 相对输出目录 → Buffer */
  const files = new Map();
  for (const f of [...js.outputFiles, ...css.files]) {
    files.set(posix(path.relative(OUT_DIR, f.path)), Buffer.from(f.contents));
  }

  // 4. manifest + 图标 + 字体授权文件
  files.set(OUTPUTS.manifest, Buffer.from(renderManifest()));
  for (const [to, from] of Object.entries(FONT_LICENSE_FILES)) {
    const src = path.join(STATIC_DIR, from);
    if (!existsSync(src)) throw new Error(`缺少字体授权文件 ${posix(path.relative(APP_DIR, src))}`);
    files.set(to, readFileSync(src));
  }
  for (const icon of ICON_FILES) {
    const src = path.join(STATIC_DIR, 'icons', icon);
    if (!existsSync(src)) throw new Error(`缺少图标 ${posix(path.relative(APP_DIR, src))}，先运行 npm run images`);
    files.set(`${OUTPUTS.iconsDir}/${icon}`, readFileSync(src));
  }

  // 3. index.html（版本号先用占位，算完总哈希再填）
  const cssHref = `${OUTPUTS.assetsDir}/${css.cssName}`;
  const devCssHref = css.devCssName ? `${OUTPUTS.assetsDir}/${css.devCssName}` : null;
  const jsHref = `${OUTPUTS.assetsDir}/${analysis.entry}`;
  const preload = analysis.preload.map((p) => `${OUTPUTS.assetsDir}/${p}`);
  const cssMap = cssMapContent(css.chunkCss);

  // 5. 预缓存清单：入口页 + manifest + 图标 + 线上会用到的 assets（排除开发/演示专用）
  const devOnly = new Set([...analysis.devOnly].map((p) => `${OUTPUTS.assetsDir}/${p}`));
  if (devCssHref) devOnly.add(devCssHref);
  // 按需样式表：只被开发 / 演示专用分包引用的那几组也不预缓存
  for (const g of css.chunkCss.groups) {
    if (g.chunks.every((c) => analysis.devOnly.has(posix(path.relative(outdir, path.resolve(APP_DIR, c)))))) devOnly.add(`${OUTPUTS.assetsDir}/${g.name}`);
  }
  const assetList = [...files.keys()].filter((p) => p.startsWith(`${OUTPUTS.assetsDir}/`)).sort();
  const precache = [
    './',
    OUTPUTS.manifest,
    ...ICON_FILES.map((i) => `${OUTPUTS.iconsDir}/${i}`),
    ...assetList.filter((p) => !devOnly.has(p)),
  ];

  // 版本号 = 所有预缓存内容 + sw 模板的哈希（内容不变 → 版本不变 → 不会无谓提示更新）
  const template = readFileSync(SW_TEMPLATE, 'utf8');
  const versionHash = createHash('sha256');
  versionHash.update(template);
  for (const p of precache.slice(1)) versionHash.update(p).update(files.get(p));
  const draftHtml = renderHtml({ cssHref, devCssHref, jsHref, preload, cssMap, version: 'VERSION' });
  versionHash.update(draftHtml);
  const version = `${pkg.version}+${versionHash.digest('hex').slice(0, 10)}`;

  files.set(OUTPUTS.html, Buffer.from(renderHtml({ cssHref, devCssHref, jsHref, preload, cssMap, version })));
  files.set(OUTPUTS.sw, Buffer.from(renderServiceWorker(template, { version, precache })));
  files.set(OUTPUTS.nojekyll, Buffer.from(''));

  return {
    files, version, precache, devOnly: [...devOnly].sort(), analysis, cssLayers: css.layers, entry: jsHref, cssHref, devCssHref, preload,
    chunkCss: css.chunkCss, cssMap,
  };
}

/** 删掉上一次构建的产物（只删构建拥有的路径） */
function cleanOutputs(root = OUT_DIR) {
  for (const p of [OUTPUTS.html, OUTPUTS.sw, OUTPUTS.manifest, OUTPUTS.nojekyll]) rmSync(path.join(root, p), { force: true });
  for (const d of [OUTPUTS.assetsDir, OUTPUTS.iconsDir, OUTPUTS.fontsDir]) rmSync(path.join(root, d), { recursive: true, force: true });
}

function writeOutputs(files, root = OUT_DIR) {
  for (const [rel, buf] of files) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
  }
}

/** 自检：index.html / sw.js 引用的文件都存在 */
export function verifyOutputs(root = OUT_DIR) {
  const problems = [];
  const html = readFileSync(path.join(root, OUTPUTS.html), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
    if (!existsSync(path.join(root, m[1]))) problems.push(`index.html 引用的 ${m[1]} 不存在`);
  }
  const devCss = new RegExp(`<meta name="${DEV_CSS_META}" content="([^"]+)">`).exec(html)?.[1];
  if (devCss && !existsSync(path.join(root, devCss))) problems.push(`index.html 里登记的开发页样式表 ${devCss} 不存在`);
  const rawMap = new RegExp(`<meta name="${CSS_MAP_META}" content="([^"]+)">`).exec(html)?.[1];
  if (rawMap) {
    const map = JSON.parse(rawMap.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    for (const f of map.f) if (!existsSync(path.join(root, f))) problems.push(`按需样式表 ${f} 不存在`);
    for (const [key, list] of Object.entries(map.m)) {
      if (!list.every((i) => Number.isInteger(i) && map.f[i])) problems.push(`按需样式表清单里 ${key} 的下标不对`);
    }
  }
  for (const f of Object.keys(FONT_LICENSE_FILES)) {
    if (!existsSync(path.join(root, f))) problems.push(`字体授权文件 ${f} 不存在`);
  }
  const sw = readFileSync(path.join(root, OUTPUTS.sw), 'utf8');
  const list = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)?.[1] || '[]');
  if (!list.length) problems.push('sw.js 的预缓存清单是空的');
  for (const p of list) {
    if (p === './') continue;
    if (!existsSync(path.join(root, p))) problems.push(`sw.js 预缓存的 ${p} 不存在`);
  }
  const manifest = JSON.parse(readFileSync(path.join(root, OUTPUTS.manifest), 'utf8'));
  for (const icon of manifest.icons) {
    if (!existsSync(path.join(root, icon.src))) problems.push(`manifest 图标 ${icon.src} 不存在`);
  }
  return problems;
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

function report(result) {
  const rows = [];
  let initialGzip = 0;
  let cssGzip = 0;
  let lazyCssGzip = 0;
  const lazyCss = new Set((result.chunkCss?.files || []).map((f) => `${OUTPUTS.assetsDir}/${f}`));
  const initial = new Set([result.entry, ...result.preload]);
  for (const [rel, buf] of [...result.files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/\.(js|css|html|webmanifest)$/.test(rel) && rel !== OUTPUTS.sw) continue;
    const gz = gzipSync(buf, { level: 9 }).length;
    const br = brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    if (initial.has(rel)) initialGzip += gz;
    if (rel === result.cssHref) cssGzip += gz;
    if (lazyCss.has(rel)) lazyCssGzip += gz;
    const tags = [];
    if (rel === result.entry) tags.push('入口');
    else if (rel === result.cssHref) tags.push('首屏样式');
    else if (lazyCss.has(rel)) tags.push('按需样式');
    else if (initial.has(rel)) tags.push('首屏预加载');
    if (result.devOnly.includes(rel)) tags.push('仅开发/演示，不预缓存');
    rows.push(`  ${rel.padEnd(36)} ${kb(buf.length).padStart(10)}  gzip ${kb(gz).padStart(9)}  br ${kb(br).padStart(9)}  ${tags.join('、')}`);
  }
  console.log(rows.join('\n'));
  const others = [...result.files.keys()].filter((r) => !/\.(js|css|html|webmanifest)$/.test(r) && r !== OUTPUTS.sw);
  console.log(`  另有资源文件 ${others.length} 个（图标、图片、PDF）`);
  const over = [];
  if (initialGzip > BUDGET.initialJs) over.push(`首屏 JS ${kb(initialGzip)} > ${kb(BUDGET.initialJs)}`);
  if (cssGzip > BUDGET.css) over.push(`首屏 CSS ${kb(cssGzip)} > ${kb(BUDGET.css)}`);
  console.log(`\n首屏 JS（入口 + 预加载）gzip 合计 ${kb(initialGzip)}，预算 ${kb(BUDGET.initialJs)}${initialGzip > BUDGET.initialJs ? '  ⚠️ 超预算' : ''}`);
  console.log(`首屏 CSS gzip ${kb(cssGzip)}，预算 ${kb(BUDGET.css)}${cssGzip > BUDGET.css ? '  ⚠️ 超预算' : ''}（按需样式表 ${lazyCss.size} 个、合计 ${kb(lazyCssGzip)}，跟着页面加载；开发页样式另成 ${result.devCssHref || '—'}，线上不下载）`);
  console.log(`Service Worker 预缓存 ${result.precache.length} 个文件；版本 ${result.version}`);
  return { over };
}

async function main() {
  const t0 = Date.now();
  assertOutDir();
  if (!tokensInSync()) throw new Error('tokens.css 的弹簧曲线和 src/motion/springs.js 不一致，先运行 npm run tokens');
  ensureDemoDb();
  const result = await buildApp();
  cleanOutputs();
  writeOutputs(result.files);
  const problems = verifyOutputs();
  if (problems.length) throw new Error(`构建产物自检没通过：\n  ${problems.join('\n  ')}`);
  const where = CUSTOM_OUT_DIR ? `RS_OUT_DIR（${OUT_DIR}）` : '仓库根目录';
  console.log(`构建完成（${Date.now() - t0} ms），产物在${where}：index.html、assets/、sw.js、manifest.webmanifest、icons/、.nojekyll\n`);
  const { over } = report(result);
  console.log('\nCSS 分层（[按需] = 跟着页面加载的 style-*.css）：');
  const lazyNames = new Set(result.chunkCss.files);
  const byLayer = {};
  for (const { file, layer, group } of result.cssLayers) (byLayer[layer] ||= []).push(lazyNames.has(group) ? `${file} [按需]` : file);
  for (const [layer, list] of Object.entries(byLayer)) console.log(`  ${layer.padEnd(8)} ${list.join('、')}`);
  if (over.length) {
    console.error(`\n构建失败：超出体积预算（${over.join('；')}）。页面级的样式放在页面、kit/、sheets/ 目录里会自动按需加载；首屏只放全站共用的底层。`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`构建失败：${error.message}`);
    if (error.errors) for (const e of error.errors) console.error(`  ${e.location?.file ?? ''}:${e.location?.line ?? ''} ${e.text}`);
    process.exit(1);
  });
}

export { cleanOutputs, writeOutputs, readdirSync, statSync };
