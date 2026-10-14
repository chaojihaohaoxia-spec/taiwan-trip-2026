// =====================================================================
// scripts/lib/bundle.mjs：esbuild 打包（构建和开发服务器共用）。
//
// 两步：
//   1. JS：从 src/main.jsx 打包，ESM + 代码分包（页面、演示数据、supabase-js、leaflet 各自成包），
//      文件名带内容哈希（main-XXXXXXXX.js / chunk-XXXXXXXX.js）。
//      JS 里 import 的 .css 不交给 esbuild 的“按入口拆 CSS”，而是记下来（见 cssCollector），
//   2. CSS：把记下来的 CSS 按目录放进固定顺序的级联层：
//        reset, tokens, base, vendor, motion, ui, overlay, shell, kit, pages, dev
//      生产构建（split）合成三类文件：
//        app-XXXXXXXX.css    首屏样式表（index.html 直接引用）：styles/、motion/、shell/ 全部，加上外壳（首屏入口、
//                            外壳框架 FrameUI、外壳弹层）用到的 ui/、overlay/ 组件样式——启动画面等外壳框架到了才淡出，
//                            这些放首屏不闪、不多一次请求；
//        style-XXXXXXXX.css  按需样式表：页面、kit/、sheets/、地图（lib/map + leaflet）、只有页面用的 ui/ overlay/ 组件
//                            （步进器、展开卡片、底部面板……）的 CSS，按“被哪几个 JS 分包引用”分组，一组一个文件。
//                            打开页面 / 弹层时和它的 JS 一起下载（见下面的 chunkCssPlugin），首屏不用为还没打开的页面付钱。
//                            组件的 CSS 由组件自己 import（ui/Button.jsx 引 Button.css……），所以“谁用谁带上”；
//        dev-XXXXXXXX.css    只给开发页 / 演示用的 CSS（dev 层：src/dev/、demo/）。线上用户不下载、不进
//                            Service Worker 预缓存；index.html 用 <meta name="rs7885-dev-css"> 告诉页面它在哪，
//                            打开 #/dev 时由 lib/dev-styles.js 先加载好再渲染（不闪）。
//      开发服务器（不 split）：除开发页以外的 CSS 全部合成 app-*.css（热替换简单），dev-*.css 同上。
//      层的先后由目录决定，和 import 顺序、样式表加载先后都无关；后面的层天然盖过前面的层
//      （页面 > kit > 外壳 > 组件 > 第三方库），不用比拼选择器优先级。每个样式表开头都声明同一份层顺序，谁先加载都一样。
//
// 按需样式表怎么跟着 JS 走（chunkCssPlugin）：src/ 里每个 `import('./相对路径')` 在打包时改写成
//   importWithCss(() => import('./相对路径'), 'src/…/目标文件')       （src/lib/chunk-css.js）
// 构建算出“这个分包入口连同它静态引用的分包，要哪些按需样式表”，写进 index.html 的
// <meta name="rs7885-css-map">；运行时 import 和样式表同时下载，都到了才 resolve——页面、弹层第一帧就是对的样子。
//
// 图片、PDF、字体等资源用 file loader：复制到 assets/ 并带哈希。
//   JS 里 `import url from './x.jpg'` 得到的是完整网址（见 assetUrlPlugin：
//   new URL('./x-HASH.jpg', import.meta.url).href），在哪个分包里用都对，不受页面路径影响；
//   CSS 里的 url() 相对于 CSS 文件，esbuild 自己处理。
// =====================================================================

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { APP_DIR, ENTRY, BROWSER_TARGETS } from './paths.mjs';

/** 级联层顺序（从低到高） */
export const CSS_LAYERS = ['reset', 'tokens', 'base', 'vendor', 'motion', 'ui', 'overlay', 'shell', 'kit', 'pages', 'dev'];

const COLLECTED_NS = 'collected-css';

/** 资源文件的 loader */
const ASSET_LOADERS = {
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.webp': 'file',
  '.gif': 'file',
  '.svg': 'file',
  '.pdf': 'file',
  '.woff': 'file',
  '.woff2': 'file',
};

/** 按文件位置决定 CSS 进哪一层 */
export function layerFor(absPath) {
  const rel = path.relative(APP_DIR, absPath).split(path.sep).join('/');
  if (rel.startsWith('node_modules/')) return 'vendor';
  if (rel === 'src/styles/reset.css') return 'reset';
  if (rel === 'src/styles/tokens.css' || rel.startsWith('src/styles/skins/')) return 'tokens';
  if (rel.startsWith('src/styles/')) return 'base';
  if (rel.startsWith('src/motion/')) return 'motion';
  if (rel.startsWith('src/ui/')) return 'ui';
  if (rel.startsWith('src/overlay/')) return 'overlay';
  if (rel.startsWith('src/shell/') || rel.startsWith('src/app')) return 'shell';
  // kit/（页面共用的展示组件）比外壳高、比页面低：页面可以覆盖 kit，和样式表加载的先后无关
  if (rel.startsWith('src/kit/')) return 'kit';
  if (rel.startsWith('src/dev/') || rel.startsWith('demo/')) return 'dev';
  // lib/ 里带样式的组件（地图 TripMap）和 ui/ 同一级：页面可以覆盖它们
  if (rel.startsWith('src/lib/')) return 'ui';
  return 'pages';
}

/** 只给开发页 / 演示用的 CSS（dev 层）：单独成一个文件，线上不下载、不预缓存 */
export function isDevCss(absPath) {
  return layerFor(absPath) === 'dev';
}

/** 一定进首屏样式表的层（变量、基础样式、按压、外壳框架） */
const ALWAYS_FIRST_LAYERS = new Set(['reset', 'tokens', 'base', 'motion', 'shell']);
/** 外壳用到才进首屏的层（ui/、overlay/ 的组件：外壳框架、外壳弹层用到的进首屏，只有页面用的跟着页面按需加载） */
const SHELL_FIRST_LAYERS = new Set(['ui', 'overlay']);
/** 算“外壳用到”的分包入口：首屏入口之外，外壳按需加载的框架和弹层（启动画面等它们到了才淡出 / 空闲时就预先下载） */
export const SHELL_ROOTS = /^src\/shell\//;

/**
 * 这个 CSS 文件进首屏样式表（app-*.css）吗。
 * @param {string} absPath
 * @param {boolean} usedByShell 引用它的模块在不在首屏入口、外壳框架、外壳弹层的静态闭包里
 */
export function isFirstScreenCss(absPath, usedByShell = true) {
  const rel = path.relative(APP_DIR, absPath).split(path.sep).join('/');
  if (rel.startsWith('src/lib/')) return false; // lib/ 里带样式的组件（地图）跟着用它的页面
  const layer = layerFor(absPath);
  if (ALWAYS_FIRST_LAYERS.has(layer)) return true;
  return SHELL_FIRST_LAYERS.has(layer) && usedByShell;
}

/** 运行时读按需样式表清单的 <meta> 名字（src/lib/chunk-css.js 的 CSS_MAP_META 同名，单元测试核对） */
export const CSS_MAP_META = 'rs7885-css-map';
const CHUNK_CSS_HELPER = path.join(APP_DIR, 'src', 'lib', 'chunk-css.js');
/** src/ 里的相对路径动态 import：import('./x.jsx') / import("../y.js") */
const DYNAMIC_IMPORT_RE = /\bimport\(\s*(['"])(\.{1,2}\/[^'"\n]+)\1\s*\)/g;

/** 动态 import 的“键”：目标文件相对 app/ 的路径（和 metafile 里分包入口的 entryPoint 一致） */
export function chunkKey(importer, spec) {
  return path.relative(APP_DIR, path.resolve(path.dirname(importer), spec)).split(path.sep).join('/');
}

/**
 * 把一段源码里的相对路径动态 import 改写成 importWithCss(() => import(…), '键')，并在开头引入帮手。
 * 没有动态 import 时返回 null（交给 esbuild 默认处理）。
 */
export function rewriteDynamicImports(source, importer, helper = CHUNK_CSS_HELPER) {
  let n = 0;
  const out = source.replace(DYNAMIC_IMPORT_RE, (m, q, spec) => {
    n += 1;
    // 键去掉开头的 src/（和 index.html 清单里的写法一样，首屏包里少几个字）
    return `__rsImportWithCss(() => import(${q}${spec}${q}), ${JSON.stringify(chunkKey(importer, spec).replace(/^src\//, ''))})`;
  });
  if (!n) return null;
  return `import { importWithCss as __rsImportWithCss } from ${JSON.stringify(helper)};\n${out}`;
}

/** 见文件开头「按需样式表怎么跟着 JS 走」 */
function chunkCssPlugin() {
  const srcDir = `${path.join(APP_DIR, 'src')}${path.sep}`;
  return {
    name: 'chunk-css',
    setup(build) {
      build.onLoad({ filter: /\.(js|jsx)$/ }, async (args) => {
        if (!args.path.startsWith(srcDir) || args.path === CHUNK_CSS_HELPER) return undefined;
        const source = await readFile(args.path, 'utf8');
        if (!source.includes('import(')) return undefined;
        const contents = rewriteDynamicImports(source, args.path);
        if (contents === null) return undefined;
        return { contents, loader: args.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}

const ASSET_NS = 'asset-url';
const RAW_SUFFIX = '?asset-file';

/**
 * JS 里 import 资源文件 → 导出完整网址。
 * esbuild 的 file loader 导出的是“相对于输出 JS 文件”的路径（./x-HASH.jpg），直接当 <img src> 会按页面地址解析而出错；
 * 这里包一层：export default new URL('./x-HASH.jpg', import.meta.url).href。
 */
function assetUrlPlugin() {
  const exts = Object.keys(ASSET_LOADERS).map((e) => e.slice(1)).join('|');
  const filter = new RegExp(`\\.(${exts})$`, 'i');
  return {
    name: 'asset-url',
    setup(build) {
      build.onResolve({ filter }, async (args) => {
        if (args.pluginData?.skipAssetUrl || args.namespace === ASSET_NS || args.kind === 'url-token' || args.kind === 'import-rule') return undefined;
        const result = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { skipAssetUrl: true },
        });
        if (result.errors.length) return { errors: result.errors };
        return { path: result.path, namespace: ASSET_NS };
      });
      build.onLoad({ filter: /.*/, namespace: ASSET_NS }, (args) => ({
        contents: `import rel from ${JSON.stringify(args.path + RAW_SUFFIX)};\nexport default new URL(rel, import.meta.url).href;\n`,
        loader: 'js',
        resolveDir: path.dirname(args.path),
      }));
      build.onResolve({ filter: /\?asset-file$/ }, (args) => ({ path: args.path.slice(0, -RAW_SUFFIX.length) }));
    },
  };
}

/**
 * lucide 图标一个文件一个文件地引：'lucide-preact/icons/x' → node_modules/lucide-preact/dist/esm/icons/x.mjs。
 * 为什么：lucide-preact 只开放了总入口（一个列出全部 1600 多个图标的 barrel 文件）。经过总入口引图标时，
 * esbuild 按“模块”分包，所有被用到的图标（包括只有开发页用的）都挂在总入口下面，一起被算进首屏包（实测多出约 8KB gzip）。
 * 每个图标单独引，图标就跟着真正用它的页面分包——首屏只带外壳和弹层用的那几个（ui/icons-core.js）。
 */
export function lucideIconsPlugin() {
  const dir = path.join(APP_DIR, 'node_modules', 'lucide-preact', 'dist', 'esm', 'icons');
  return {
    name: 'lucide-icons',
    setup(build) {
      build.onResolve({ filter: /^lucide-preact\/icons\/[a-z0-9-]+$/ }, (args) => {
        const name = args.path.slice('lucide-preact/icons/'.length);
        const file = path.join(dir, `${name}.mjs`);
        if (!existsSync(file)) {
          return { errors: [{ text: `lucide 没有叫「${name}」的图标文件（文件名见 node_modules/lucide-preact/dist/esm/icons/）` }] };
        }
        return { path: file };
      });
    },
  };
}

/** JS 里 import 的 CSS：在 JS 包里变成空模块，路径交给第二步 */
function cssCollectorPlugin() {
  return {
    name: 'css-collector',
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, async (args) => {
        if (args.pluginData?.skipCollector) return undefined;
        if (args.kind !== 'import-statement' && args.kind !== 'dynamic-import' && args.kind !== 'require-call') return undefined;
        const result = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { skipCollector: true },
        });
        if (result.errors.length) return { errors: result.errors };
        return { path: result.path, namespace: COLLECTED_NS };
      });
      build.onLoad({ filter: /.*/, namespace: COLLECTED_NS }, (args) => ({
        contents: '',
        loader: 'js',
        watchFiles: [args.path],
      }));
    },
  };
}

/** 从 metafile 读出被 JS 引用的 CSS 文件（绝对路径） */
function collectedCss(metafile) {
  const prefix = `${COLLECTED_NS}:`;
  return Object.keys(metafile.inputs)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/** 生成合并 CSS 的入口：先声明层顺序，再按“层 → 路径”排序 @import */
export function cssEntry(files) {
  const sorted = [...new Set(files)].sort((a, b) => {
    const la = CSS_LAYERS.indexOf(layerFor(a));
    const lb = CSS_LAYERS.indexOf(layerFor(b));
    return la - lb || a.localeCompare(b);
  });
  const lines = [`@layer ${CSS_LAYERS.join(', ')};`];
  for (const f of sorted) lines.push(`@import ${JSON.stringify(f)} layer(${layerFor(f)});`);
  return { contents: `${lines.join('\n')}\n`, files: sorted };
}

/** esbuild 风格的 8 位内容哈希（Base32，大写） */
export function contentHash(buf) {
  const h = createHash('sha256').update(buf).digest();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of h) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 8) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * JS 构建选项
 * @param {{ dev: boolean, outdir: string }} p
 */
export function jsOptions({ dev, outdir }) {
  return {
    entryPoints: { main: ENTRY },
    absWorkingDir: APP_DIR,
    outdir,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: BROWSER_TARGETS,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: ASSET_LOADERS,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    minify: !dev,
    sourcemap: dev ? 'linked' : false,
    legalComments: dev ? 'none' : 'eof',
    metafile: true,
    write: false,
    charset: 'utf8',
    logLevel: 'silent',
    define: {
      __DEV__: dev ? 'true' : 'false',
      'process.env.NODE_ENV': dev ? '"development"' : '"production"',
    },
    plugins: [cssCollectorPlugin(), assetUrlPlugin(), lucideIconsPlugin(), chunkCssPlugin()],
  };
}

/** 把一组 CSS 文件合成一个样式表（返回 esbuild 的输出：CSS 内容 + url() 引用的资源文件） */
async function bundleCssFiles({ dev, outdir, files }) {
  const entry = cssEntry(files);
  const result = await esbuild.build({
    stdin: { contents: entry.contents, resolveDir: APP_DIR, sourcefile: 'app.css', loader: 'css' },
    absWorkingDir: APP_DIR,
    outdir,
    bundle: true,
    target: BROWSER_TARGETS,
    loader: ASSET_LOADERS,
    assetNames: '[name]-[hash]',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: dev ? 'none' : 'eof',
    metafile: true,
    write: false,
    charset: 'utf8',
    logLevel: 'silent',
  });
  return { entry, result };
}

/**
 * 按需样式表的分组：每个（非首屏、非开发页）CSS 文件按“引用它的模块落在哪几个 JS 分包”分组，同一组的合成一个文件。
 * 再算每个分包入口（动态 import 的目标）要哪些组：入口分包连同它静态引用的分包里，只要有一个分包引用了这组 CSS 就要。
 * @param {import('esbuild').Metafile} metafile
 * @param {string[]} files 被 JS 引用的全部 CSS（绝对路径）
 * @returns {{ groups: Array<{ chunks: string[], files: string[] }>, entries: Record<string, number[]>, devOnlyChunks: Set<string> }}
 */
export function planChunkCss(metafile, files) {
  const outputs = metafile.outputs;
  /** 源文件（相对 app/）→ 它所在的输出分包 */
  const chunkOf = new Map();
  for (const [file, info] of Object.entries(outputs)) {
    if (!file.endsWith('.js')) continue;
    for (const input of Object.keys(info.inputs)) chunkOf.set(input, file);
  }
  /** CSS（绝对路径）→ 引用它的模块所在的分包集合 */
  const cssChunks = new Map();
  const prefix = `${COLLECTED_NS}:`;
  for (const [input, info] of Object.entries(metafile.inputs)) {
    for (const imp of info.imports) {
      if (!imp.path.startsWith(prefix)) continue;
      const css = imp.path.slice(prefix.length);
      const chunk = chunkOf.get(input);
      if (!chunk) continue;
      if (!cssChunks.has(css)) cssChunks.set(css, new Set());
      cssChunks.get(css).add(chunk);
    }
  }
  // 首屏入口、外壳框架和外壳弹层（SHELL_ROOTS）的静态闭包：这些分包里的组件样式进首屏
  const closure = (file) => {
    const seen = new Set([file]);
    const stack = [file];
    while (stack.length) {
      const f = stack.pop();
      for (const imp of outputs[f]?.imports || []) {
        if (imp.kind !== 'import-statement' || imp.external || seen.has(imp.path)) continue;
        seen.add(imp.path);
        stack.push(imp.path);
      }
    }
    return seen;
  };
  const shellChunks = new Set();
  for (const [file, info] of Object.entries(outputs)) {
    if (!file.endsWith('.js') || !info.entryPoint) continue;
    if (info.entryPoint === 'src/main.jsx' || SHELL_ROOTS.test(info.entryPoint)) for (const c of closure(file)) shellChunks.add(c);
  }
  const usedByShell = (f) => [...(cssChunks.get(f) || [])].some((c) => shellChunks.has(c));
  const lazy = [...new Set(files)].filter((f) => !isDevCss(f) && cssChunks.has(f) && !isFirstScreenCss(f, usedByShell(f)));
  const byKey = new Map();
  for (const f of lazy) {
    const chunks = [...cssChunks.get(f)].sort();
    const key = chunks.join('|');
    if (!byKey.has(key)) byKey.set(key, { chunks, files: [] });
    byKey.get(key).files.push(f);
  }
  // 组的顺序：按层、再按第一个文件的路径（运行时按这个顺序插 <link>，DOM 里的先后固定）
  const rank = (g) => {
    const first = cssEntry(g.files).files[0];
    return [CSS_LAYERS.indexOf(layerFor(first)), first];
  };
  const groups = [...byKey.values()].sort((a, b) => {
    const [la, fa] = rank(a);
    const [lb, fb] = rank(b);
    return la - lb || fa.localeCompare(fb);
  });

  // 每个分包入口（动态 import 的目标）要哪些组
  const entries = {};
  for (const [file, info] of Object.entries(outputs)) {
    if (!info.entryPoint || !file.endsWith('.js') || info.entryPoint === 'src/main.jsx') continue;
    const reach = closure(file);
    const need = [];
    groups.forEach((g, i) => {
      if (g.chunks.some((c) => reach.has(c))) need.push(i);
    });
    if (need.length) entries[info.entryPoint] = need;
  }
  return { groups, entries };
}

/**
 * 构建样式表。
 *   app-HASH.css（首屏）+ dev-HASH.css（只给开发页，没有开发页 CSS 时不生成）
 *   + split 时：style-HASH.css（按需，见 planChunkCss），以及给 index.html 的清单 chunkCss = { files, map }
 * @param {{ dev: boolean, outdir: string, files: string[], metafile?: import('esbuild').Metafile, split?: boolean }} p
 * @returns {Promise<{ files: Array<{ path: string, contents: Uint8Array, kind: 'css'|'asset' }>, cssName: string,
 *   devCssName: string|null, layers: Array<{ file: string, layer: string, group: string }>, warnings: object[],
 *   chunkCss: { files: string[], map: Record<string, number[]>, groups: Array<{ name: string, chunks: string[], files: string[] }> } }>}
 */
export async function buildCss({ dev, outdir, files, metafile = null, split = false }) {
  const unique = [...new Set(files)];
  const plan = split && metafile ? planChunkCss(metafile, unique) : { groups: [], entries: {} };
  const lazySet = new Set(plan.groups.flatMap((g) => g.files));
  const groups = [
    { prefix: 'app', files: unique.filter((f) => !isDevCss(f) && !lazySet.has(f)) },
    { prefix: 'dev', files: unique.filter((f) => isDevCss(f)) },
    ...plan.groups.map((g, i) => ({ prefix: 'style', index: i, files: g.files, chunks: g.chunks })),
  ];
  const out = [];
  const names = {};
  const styleNames = [];
  const layers = [];
  const warnings = [];
  const seenAssets = new Set();
  for (const g of groups) {
    if (!g.files.length && g.prefix === 'dev') continue;
    const { entry, result } = await bundleCssFiles({ dev, outdir, files: g.files });
    warnings.push(...result.warnings);
    for (const f of result.outputFiles) {
      if (f.path.endsWith('.css')) {
        const name = `${g.prefix}-${contentHash(f.contents)}.css`;
        if (g.prefix === 'style') styleNames[g.index] = name;
        else names[g.prefix] = name;
        layers.push(...entry.files.map((file) => ({ file: path.relative(APP_DIR, file), layer: layerFor(file), group: name })));
        out.push({ path: path.join(outdir, name), contents: f.contents, kind: 'css' });
      } else if (!seenAssets.has(f.path)) {
        seenAssets.add(f.path);
        out.push({ path: f.path, contents: f.contents, kind: 'asset' });
      }
    }
  }
  const map = {};
  for (const [key, list] of Object.entries(plan.entries).sort(([a], [b]) => a.localeCompare(b))) map[key] = list;
  return {
    files: out,
    cssName: names.app,
    devCssName: names.dev || null,
    layers,
    warnings,
    chunkCss: {
      files: styleNames,
      map,
      groups: plan.groups.map((g, i) => ({ name: styleNames[i], chunks: g.chunks, files: g.files.map((f) => path.relative(APP_DIR, f)) })),
    },
  };
}

/** src/dev/、demo/ 以外，只在开发 / 演示时才会被动态加载的模块（不进 Service Worker 预缓存） */
export const DEV_ONLY_MODULES = Object.freeze(['src/data/backend-demo.js']);

/**
 * 分析 JS 构建结果：
 *   entry    入口文件（相对 outdir）
 *   preload  入口静态 import 的分包（递归）→ <link rel="modulepreload">
 *   firstScreenInputs  首屏包（入口 + 预加载）里的源文件（相对 app/）；单元测试据此守住首屏不混进按需加载的模块
 *   devOnly  只有开发页、演示模式才会加载的输出（从入口出发，不经过 src/dev/、demo/、DEV_ONLY_MODULES 的动态 import
 *            就到不了）
 *            → 不进 Service Worker 预缓存，线上用户不会下载
 * @param {import('esbuild').Metafile} metafile
 * @param {string} outdir
 */
export function analyzeJs(metafile, outdir) {
  const rel = (p) => path.relative(outdir, path.resolve(APP_DIR, p)).split(path.sep).join('/');
  const outputs = metafile.outputs;
  let entry = null;
  for (const [file, info] of Object.entries(outputs)) {
    if (info.entryPoint === 'src/main.jsx' && file.endsWith('.js')) entry = file;
  }
  if (!entry) throw new Error('没找到入口输出文件');

  const preload = [];
  const seenStatic = new Set();
  const walkStatic = (file) => {
    for (const imp of outputs[file]?.imports || []) {
      if (imp.kind !== 'import-statement' || imp.external || seenStatic.has(imp.path)) continue;
      seenStatic.add(imp.path);
      preload.push(rel(imp.path));
      walkStatic(imp.path);
    }
  };
  walkStatic(entry);

  // 开发页、演示数据、演示后台（data/backend-demo.js 只在本机 ?demo=1 时按需加载）
  const isDevEntry = (ep) => typeof ep === 'string'
    && (ep.startsWith('src/dev/') || ep.startsWith('demo/') || DEV_ONLY_MODULES.includes(ep));
  const reachable = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    for (const imp of outputs[file]?.imports || []) {
      if (imp.external || reachable.has(imp.path) || !outputs[imp.path]) continue;
      if (imp.kind === 'dynamic-import' && isDevEntry(outputs[imp.path].entryPoint)) continue;
      reachable.add(imp.path);
      stack.push(imp.path);
    }
  }
  const devOnly = new Set(Object.keys(outputs).filter((f) => !reachable.has(f) && !f.endsWith('.map')).map(rel));

  // 首屏包里有哪些源文件（esbuild 按文件分包：一个文件只要被首屏引到，整个文件都进首屏）
  const firstScreenInputs = new Set();
  for (const file of [entry, ...seenStatic]) {
    for (const input of Object.keys(outputs[file]?.inputs || {})) firstScreenInputs.add(input);
  }
  return { entry: rel(entry), preload, devOnly, firstScreenInputs: [...firstScreenInputs].sort() };
}

export { collectedCss, esbuild };
