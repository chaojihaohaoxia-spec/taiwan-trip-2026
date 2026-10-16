// 构建脚本和工程约定：CSS 分层、内容哈希、index.html / manifest / sw.js 的生成、
// 构建确定性、页面登记表覆盖全部路由、每个目录都有 README、依赖锁定精确版本。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  layerFor, cssEntry, contentHash, CSS_LAYERS, isDevCss, DEV_ONLY_MODULES, isFirstScreenCss, rewriteDynamicImports, chunkKey, CSS_MAP_META,
} from '../../scripts/lib/bundle.mjs';
import { CSS_MAP_META as RUNTIME_CSS_MAP_META } from '../../src/lib/chunk-css.js';
import {
  renderHtml, renderManifest, themeColors, THEME_BOOT_SCRIPT, NOMODULE_SCRIPT, ICON_FILES, DEV_CSS_META,
} from '../../scripts/lib/html.mjs';
import { DEV_CSS_META as RUNTIME_DEV_CSS_META } from '../../src/lib/dev-styles.js';
import { scriptHash } from '../../scripts/lib/csp.mjs';
import { renderServiceWorker, buildApp, BUDGET, FONT_LICENSE_FILES } from '../../scripts/build.mjs';
import { gzipSync } from 'node:zlib';
import { routes, SPECIAL_ROUTES } from '../../src/router/routes.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const abs = (p) => path.join(APP, p);

test('CSS 按目录进固定的级联层', () => {
  assert.deepEqual(CSS_LAYERS, ['reset', 'tokens', 'base', 'vendor', 'motion', 'ui', 'overlay', 'shell', 'kit', 'pages', 'dev']);
  const cases = {
    'src/styles/tokens.css': 'tokens',
    'src/styles/skins/glass.css': 'tokens',
    'src/styles/base.css': 'base',
    'src/styles/reset.css': 'reset',
    'node_modules/leaflet/dist/leaflet.css': 'vendor',
    'src/motion/press.css': 'motion',
    'src/ui/Button.css': 'ui',
    'src/overlay/Sheet.css': 'overlay',
    'src/shell/shell.css': 'shell',
    'src/kit/Card.css': 'kit',
    'src/pages/ledger/ledger.css': 'pages',
    'src/sheets/driver/driver.css': 'pages',
    'src/lib/map/TripMap.css': 'ui',
    'src/dev/dev.css': 'dev',
    'demo/demo.css': 'dev',
  };
  for (const [p, layer] of Object.entries(cases)) assert.equal(layerFor(abs(p)), layer, p);
});

test('开发页的 CSS 单独成 dev-*.css：只有 dev 层算；index.html 用 <meta> 登记它的位置（前端读同一个名字）', () => {
  assert.equal(isDevCss(abs('src/dev/pages/lib/lib-page.css')), true);
  assert.equal(isDevCss(abs('demo/x.css')), true);
  for (const p of ['src/ui/Button.css', 'src/overlay/Sheet.css', 'src/pages/skeleton.css', 'src/lib/map/TripMap.css', 'src/styles/tokens.css']) {
    assert.equal(isDevCss(abs(p)), false, p);
  }
  assert.equal(DEV_CSS_META, RUNTIME_DEV_CSS_META, '构建和前端用同一个 <meta> 名字');
  const html = renderHtml({ cssHref: 'assets/app-X.css', devCssHref: 'assets/dev-Y.css', jsHref: 'assets/main-X.js', version: 't' });
  assert.ok(html.includes(`<meta name="${DEV_CSS_META}" content="assets/dev-Y.css">`));
  assert.doesNotMatch(html, /<link rel="stylesheet" href="assets\/dev-/, '开发页样式表不在首屏加载');
  const plain = renderHtml({ cssHref: 'assets/app-X.css', jsHref: 'assets/main-X.js', version: 't' });
  assert.ok(!plain.includes(DEV_CSS_META), '没有开发页样式时不写 <meta>');
  assert.deepEqual([...DEV_ONLY_MODULES], ['src/data/backend-demo.js']);
});

test('合并 CSS 的入口：先声明层顺序，再按层、按路径排序 @import，去重', () => {
  const files = ['src/pages/a.css', 'src/styles/tokens.css', 'src/ui/b.css', 'node_modules/x/x.css', 'src/ui/a.css', 'src/ui/a.css'].map(abs);
  const { contents, files: sorted } = cssEntry(files);
  const lines = contents.trim().split('\n');
  assert.equal(lines[0], `@layer ${CSS_LAYERS.join(', ')};`);
  assert.deepEqual(sorted.map((f) => path.relative(APP, f)), ['src/styles/tokens.css', 'node_modules/x/x.css', 'src/ui/a.css', 'src/ui/b.css', 'src/pages/a.css']);
  assert.match(lines[1], /tokens\.css" layer\(tokens\);$/);
});

test('内容哈希：8 位、只和内容有关', () => {
  const h = contentHash(Buffer.from('a'));
  assert.match(h, /^[A-Z2-7]{8}$/);
  assert.equal(contentHash(Buffer.from('a')), h);
  assert.notEqual(contentHash(Buffer.from('b')), h);
});

test('sw.js 模板：两个占位各替换一次，缺了就报错', () => {
  const template = readFileSync(abs('src/sw/sw.js'), 'utf8');
  const out = renderServiceWorker(template, { version: '9.9.9+abc', precache: ['./', 'assets/main-AAAA.js'] });
  assert.match(out, /const VERSION = "9\.9\.9\+abc";/);
  assert.match(out, /const PRECACHE = \[\n {2}"\.\/",\n {2}"assets\/main-AAAA\.js"\n\];/);
  assert.ok(!out.includes("'__SW_VERSION__';") && !out.includes('= __SW_PRECACHE__;'));
  assert.throws(() => renderServiceWorker('nothing', { version: 'x', precache: [] }), /占位/);
  assert.ok(!template.includes('taiwan-trip-2026'), 'sw.js 不写死仓库名');
});

test('index.html：viewport-fit=cover、深浅两条 theme-color、相对路径、CSP 放行内联脚本', () => {
  const html = renderHtml({ cssHref: 'assets/app-X.css', jsHref: 'assets/main-X.js', preload: ['assets/chunk-X.js'], version: '2.0.0+test' });
  const colors = themeColors();
  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.ok(html.includes(`<meta name="theme-color" content="${colors.light}" media="(prefers-color-scheme: light)">`));
  assert.ok(html.includes(`<meta name="theme-color" content="${colors.dark}" media="(prefers-color-scheme: dark)">`));
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="modulepreload" href="assets\/chunk-X\.js">/);
  assert.match(html, /<meta name="app-version" content="2\.0\.0\+test">/);
  assert.doesNotMatch(html, /(href|src)="\//, '不能用以 / 开头的绝对路径（会丢掉仓库子路径）');
  assert.doesNotMatch(html, /fonts\.googleapis|unpkg|jsdelivr|cdnjs/, '不用任何 CDN');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1].replace(/&#39;|&quot;/g, "'");
  assert.ok(csp.includes(scriptHash(THEME_BOOT_SCRIPT)));
  assert.ok(csp.includes(scriptHash(NOMODULE_SCRIPT)));
  assert.ok(html.includes(`<script>${THEME_BOOT_SCRIPT}</script>`));
  assert.match(csp, /object-src 'none'/);
  assert.equal(colors.light, '#f4f1ea', '「杂志纸本」：米白的纸');
  assert.equal(colors.dark, '#141413', '深色：深墨色的纸');
});

test('manifest：相对 start_url / scope、不写 id、简体中文、图标齐全', () => {
  const m = JSON.parse(renderManifest());
  assert.equal(m.name, '热爱生活7885');
  assert.equal(m.lang, 'zh-CN');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(!('id' in m));
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, themeColors().light);
  const purposes = m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  for (const p of ['192x192/any', '512x512/any', '192x192/maskable', '512x512/maskable']) assert.ok(purposes.includes(p), p);
  for (const icon of m.icons) assert.ok(ICON_FILES.includes(path.basename(icon.src)), icon.src);
  for (const f of ICON_FILES) assert.ok(existsSync(abs(`static/icons/${f}`)), `缺少 static/icons/${f}（npm run images）`);
});

test('PNG 图标的像素尺寸正确', () => {
  const expect = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-192.png': 192, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
  for (const [file, size] of Object.entries(expect)) {
    const buf = readFileSync(abs(`static/icons/${file}`));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    assert.equal(buf.readUInt32BE(16), size, `${file} 宽`);
    assert.equal(buf.readUInt32BE(20), size, `${file} 高`);
  }
});

test('构建是确定的：同样的源码两次构建，产物一字节不差', async () => {
  const a = await buildApp();
  const b = await buildApp();
  assert.deepEqual([...a.files.keys()].sort(), [...b.files.keys()].sort());
  for (const [k, v] of a.files) assert.ok(v.equals(b.files.get(k)), k);
  assert.equal(a.version, b.version);
  assert.ok(a.precache.includes('./'));
  assert.ok(a.precache.some((p) => /^assets\/main-[A-Z2-7]{8}\.js$/.test(p)));
  assert.ok(!a.precache.some((p) => p.includes('demo-photo')), '演示照片不进预缓存');
  for (const p of a.devOnly) assert.ok(!a.precache.includes(p));
  // 首屏样式表进预缓存；开发页样式表单独成文件、不进预缓存，也不含首屏样式
  assert.ok(a.precache.includes(a.cssHref));
  assert.match(a.devCssHref, /^assets\/dev-[A-Z2-7]{8}\.css$/);
  assert.ok(a.devOnly.includes(a.devCssHref) && !a.precache.includes(a.devCssHref));
  const appCss = a.files.get(a.cssHref).toString('utf8');
  const devCss = a.files.get(a.devCssHref).toString('utf8');
  assert.doesNotMatch(appCss, /\.(pv|lp|ovd|dp)-[a-z]|\.dev-section/, '首屏样式表里没有开发页的样式');
  assert.match(devCss, /\.dev-section/);
  assert.match(devCss, /^@layer reset,tokens,base,vendor,motion,ui,overlay,shell,kit,pages,dev;/, '两个样式表声明同一份层顺序');
  assert.match(appCss, /^@layer reset,tokens,base,vendor,motion,ui,overlay,shell,kit,pages,dev;/);
  // 演示后台（data/backend-demo.js）只在本机演示模式下加载：不进预缓存
  const demoChunk = [...a.files.keys()].find((k) => k.endsWith('.js') && a.files.get(k).toString('utf8').includes('demo:server'));
  assert.ok(demoChunk, '找到演示后台的分包');
  assert.ok(a.devOnly.includes(demoChunk), `${demoChunk} 应该只在演示时下载`);
  const main = a.files.get(a.entry).toString('utf8');
  assert.doesNotMatch(main, /preact\/debug|__DEV__/, '生产包里没有开发代码');
  for (const [k, v] of a.files) {
    if (!k.endsWith('.js')) continue;
    const text = v.toString('utf8');
    assert.doesNotMatch(text, /from"assets\/|import\("assets\//, `${k} 的分包引用必须是相对路径`);
  }
});

test('首屏包只有首屏要用的模块：页面、开发页、数据层、形变、底部面板等按需加载的不混进来', async () => {
  const { analysis } = await buildApp();
  const inputs = analysis.firstScreenInputs;
  assert.ok(inputs.includes('src/main.jsx') && inputs.includes('src/overlay/Toast.jsx'), '首屏包含入口和 Toast');
  const lazy = [
    /^src\/dev\//, /^src\/data\//, /^src\/pages\/(?!index\.js$|NotFoundPage\.jsx$)/, /^src\/lib\/map\//, /^src\/lib\/services\//,
    /^src\/motion\/(morph|flip|hooks)\.js$/,
    /^src\/overlay\/(Sheet|AnchoredPanel|FullscreenMenu|Popover)\.jsx$/,
    /^node_modules\/(leaflet|@supabase)\//, /^node_modules\/lucide-preact\/dist\/esm\/lucide-preact\.mjs$/,
  ];
  for (const f of inputs) {
    for (const re of lazy) assert.doesNotMatch(f, re, `${f} 应该按需加载，不要进首屏包`);
  }
});

test('页面登记表覆盖路由表里的每个路由名', () => {
  const text = readFileSync(abs('src/pages/index.js'), 'utf8');
  const block = /export const pages = \{([\s\S]*?)\n\};/.exec(text)[1];
  const keys = [...block.matchAll(/^\s+'?([a-z-]+)'?:/gm)].map((m) => m[1]);
  const names = [...routes.map((r) => r.name), SPECIAL_ROUTES.notFound.name, SPECIAL_ROUTES.authCallback.name];
  assert.deepEqual([...keys].sort(), [...names].sort());
});

test('每个约定目录都有 README.md', () => {
  const dirs = ['.', 'src', 'src/router', 'src/styles', 'src/motion', 'src/overlay', 'src/ui', 'src/data', 'src/lib',
    'src/pages', 'src/dev', 'src/shell', 'src/sw', 'demo', 'test/unit', 'test/e2e', 'scripts', 'static'];
  for (const d of dirs) assert.ok(existsSync(abs(path.join(d, 'README.md'))), `${d}/README.md`);
});

test('依赖锁定精确版本（不用 ^ ~ *），preact 是 10.x', () => {
  const pkg = JSON.parse(readFileSync(abs('package.json'), 'utf8'));
  for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name}@${v}`);
  }
  assert.match(pkg.dependencies.preact, /^10\./);
  assert.equal(pkg.dependencies.leaflet, '1.9.4');
  assert.match(pkg.dependencies['@supabase/supabase-js'], /^2\./);
  assert.ok(existsSync(abs('package-lock.json')));
});

test('源码（js/jsx/css）不写死仓库名、不引用 CDN', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(abs('src')).filter((f) => /\.(js|jsx|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\/taiwan-trip-2026\//, path.relative(APP, file));
    assert.doesNotMatch(text, /https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com)/, path.relative(APP, file));
  }
});

test('图标：一个图标一个文件地引（文件都在）；首屏代码只从 ui/icons-core.js 引；icons.js 转出 icons-core 的全部', () => {
  const read = (p) => readFileSync(abs(p), 'utf8');
  const specs = (text) => [...text.matchAll(/^export \{[^}]*\} from '(lucide-preact[^']*)';$/gm)].map((m) => m[1]);
  const all = read('src/ui/icons.js');
  const core = read('src/ui/icons-core.js');
  for (const spec of [...specs(all), ...specs(core)]) {
    assert.match(spec, /^lucide-preact\/icons\/[a-z0-9-]+$/, `${spec}：要按单个图标文件引（不经过 lucide 的总入口）`);
    assert.ok(existsSync(abs(`node_modules/lucide-preact/dist/esm/icons/${spec.split('/').pop()}.mjs`)), `${spec} 对应的文件不存在`);
  }
  assert.match(all, /export \* from '\.\/icons-core\.js';/, 'icons.js 转出 icons-core 的全部');
  const names = (text) => [...text.matchAll(/default as (Icon\w+)/g)].map((m) => m[1]);
  const dup = names(all).filter((n) => names(core).includes(n));
  assert.deepEqual(dup, [], '同一个图标只在一个文件里登记');
  // 首屏代码（入口、外壳、弹层）不能引 ui/icons.js（会把全站的图标拖进首屏包）
  const walk = (dir) => readdirSync(abs(dir)).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(abs(p)).isDirectory() ? walk(p) : [p];
  });
  const firstScreen = ['src/main.jsx', 'src/app.jsx', ...walk('src/shell'), ...walk('src/overlay')].filter((f) => /\.(js|jsx)$/.test(f));
  for (const f of firstScreen) {
    assert.doesNotMatch(read(f), /ui\/icons\.js'/, `${f} 是首屏代码，图标请从 ui/icons-core.js 引`);
    assert.doesNotMatch(read(f), /^import .* from 'lucide-preact/m, `${f} 不要直接引 lucide-preact`);
  }
  // 其他地方也不直接引 lucide-preact（统一从图标登记处引）
  for (const f of walk('src').filter((x) => /\.(js|jsx)$/.test(x) && !/src\/ui\/icons(-core)?\.js$/.test(x))) {
    assert.doesNotMatch(read(f), /^(import|export) .* from 'lucide-preact/m, `${f} 请从 ui/icons.js 引图标`);
  }
});

// ---------------------------------------------------------------------
// 首屏样式表 / 按需样式表（外壳评审：首屏 CSS 超预算 → 页面级的样式跟着页面加载）
// ---------------------------------------------------------------------

test('哪些 CSS 进首屏：styles/ motion/ shell/ 一定进；ui/ overlay/ 外壳用到才进；页面、kit、sheets、地图、第三方库按需', () => {
  for (const p of ['src/styles/tokens.css', 'src/styles/fonts.css', 'src/motion/press.css', 'src/shell/topbar.css']) {
    assert.equal(isFirstScreenCss(abs(p), false), true, p);
  }
  assert.equal(isFirstScreenCss(abs('src/ui/Button.css'), true), true);
  assert.equal(isFirstScreenCss(abs('src/ui/Stepper.css'), false), false);
  assert.equal(isFirstScreenCss(abs('src/overlay/Sheet.css'), false), false);
  for (const p of ['src/kit/Card.css', 'src/pages/trip/trip.css', 'src/sheets/driver/driver.css', 'src/lib/map/TripMap.css', 'node_modules/leaflet/dist/leaflet.css']) {
    assert.equal(isFirstScreenCss(abs(p), true), false, p);
  }
  assert.equal(CSS_MAP_META, RUNTIME_CSS_MAP_META, '构建和前端用同一个 <meta> 名字');
});

test('动态 import 改写成 importWithCss(…, 目标文件)：只改相对路径，键是目标相对 app/src/ 的路径', () => {
  const file = abs('src/pages/index.js');
  const out = rewriteDynamicImports("const a = () => import('./trip/TripPage.jsx');\nconst b = () => import(\"../data/index.js\");\nconst c = () => import('preact/debug');", file, '/H.js');
  assert.ok(out.startsWith('import { importWithCss as __rsImportWithCss } from "/H.js";\n'));
  assert.ok(out.includes(`__rsImportWithCss(() => import('./trip/TripPage.jsx'), "pages/trip/TripPage.jsx")`));
  assert.ok(out.includes(`__rsImportWithCss(() => import("../data/index.js"), "data/index.js")`));
  assert.ok(out.includes("import('preact/debug')"), '包名（不是相对路径）不改');
  assert.equal(rewriteDynamicImports("import x from './x.js';", file), null, '没有动态 import 不改');
  assert.equal(chunkKey(abs('src/shell/Frame.jsx'), './FrameUI.jsx'), 'src/shell/FrameUI.jsx');
});

test('构建：首屏 CSS 在预算内；页面 / kit / 弹层 / 地图的样式拆成按需样式表，index.html 登记了每个页面要哪些', async () => {
  const a = await buildApp();
  const appCss = a.files.get(a.cssHref);
  assert.ok(gzipSync(appCss, { level: 9 }).length <= BUDGET.css, '首屏 CSS 不超预算');
  const appText = appCss.toString('utf8');
  assert.doesNotMatch(appText, /\.k-card\b|\.ov-sheet\b|\.leaflet-container|\.drv\b|\.stepper\b/, '页面级样式不在首屏样式表里');
  assert.match(appText, /\.tabbar\b/, '外壳样式在首屏');
  assert.match(appText, /\.icon-btn\b/, '外壳用到的组件样式在首屏');
  // 清单：每个页面都登记了按需样式表，引用的文件都在
  const meta = new RegExp(`<meta name="${CSS_MAP_META}" content="([^"]+)">`).exec(a.files.get('index.html').toString('utf8'));
  assert.ok(meta, 'index.html 有按需样式表清单');
  const map = JSON.parse(meta[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<'));
  for (const f of map.f) assert.ok(a.files.has(f), f);
  for (const page of ['trip/TripPage.jsx', 'day/DayPage.jsx', 'ledger/LedgerPage.jsx', 'map/MapPage.jsx', 'settings/SettingsPage.jsx']) {
    const list = map.m[`pages/${page}`];
    assert.ok(list?.length, `${page} 登记了按需样式表`);
    const text = list.map((i) => a.files.get(map.f[i]).toString('utf8')).join('\n');
    assert.match(text, /\.k-card\b|\.k-row\b/, `${page} 的按需样式表里有 kit 的样式`);
  }
  // 地图（lib/map/TripMap + leaflet）的样式在按需样式表里，并且有分包入口登记了它（用到地图的页面打开时带上）
  const leaflet = map.f.findIndex((f) => /\.leaflet-container/.test(a.files.get(f).toString('utf8')));
  assert.ok(leaflet >= 0, 'leaflet 的样式在按需样式表里');
  assert.ok(Object.values(map.m).some((list) => list.includes(leaflet)), '有分包入口要 leaflet 的样式');
  assert.ok(map.m['sheets/driver/DriverSheet.jsx']?.length, '「给司机看」带上自己的样式');
  // 每个 CSS 文件只出现在一个样式表里（不重复下载）
  const seen = new Map();
  for (const { file, group } of a.cssLayers) {
    assert.ok(!seen.has(file) || seen.get(file) === group, `${file} 同时在 ${seen.get(file)} 和 ${group} 里`);
    seen.set(file, group);
  }
  // 按需样式表进预缓存（离线也能打开页面），只给开发页用的那几组不进
  for (const f of map.f) {
    const devOnly = a.devOnly.includes(f);
    assert.equal(a.precache.includes(f), !devOnly, f);
  }
  // 字体授权文件随站部署（不预缓存）
  for (const f of Object.keys(FONT_LICENSE_FILES)) {
    assert.ok(a.files.has(f), f);
    assert.ok(!a.precache.includes(f), `${f} 不预缓存`);
  }
  assert.match(a.files.get('fonts/licenses/Noto-Serif-SC-OFL.txt').toString('utf8'), /SIL OPEN FONT LICENSE/i);
});
