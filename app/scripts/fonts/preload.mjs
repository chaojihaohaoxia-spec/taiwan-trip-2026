// =====================================================================
// scripts/fonts/preload.mjs：首屏要预加载的字体文件，打包后叫什么名字（index.html 的 <link rel="preload" as="font">）。
//
// 字体文件在 app/static/fonts/，styles/fonts.css 用 url() 引它们；构建时 esbuild 的 file loader 把它们复制进
// assets/ 并改名为 <原名>-<内容哈希>.woff2（scripts/lib/bundle.mjs 的 assetNames: '[name]-[hash]'，哈希只看文件内容）。
// 这里用同样的 esbuild 设置把要预加载的几个文件“打包”一遍（不写盘），拿到同样的文件名——
// 不用改构建脚本，开发服务器、生产构建、e2e 拿到的名字都和真实产物一致（build.mjs 的自检会核对 index.html 引用的文件都存在）。
//
// 预加载哪些：static/fonts/fonts.json 里 preload: true 的（Instrument Serif 正体、P2 Figure One 正体）。
// 思源宋体的分片不预加载：一屏只用到其中几片，浏览器按 unicode-range 自己挑。
// =====================================================================

import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FONTS_DIR = path.join(APP_DIR, 'static', 'fonts');
export const FONTS_MANIFEST = path.join(FONTS_DIR, 'fonts.json');

/** 和 scripts/lib/bundle.mjs 一致的资源文件命名（单元测试会核对两边产物同名） */
const ASSET_NAMES = '[name]-[hash]';

let cache = null;

/** 清单里要预加载的源文件（绝对路径） */
export function preloadSources() {
  if (!existsSync(FONTS_MANIFEST)) return [];
  const manifest = JSON.parse(readFileSync(FONTS_MANIFEST, 'utf8'));
  return manifest.faces.filter((f) => f.preload).map((f) => path.join(FONTS_DIR, f.file));
}

/**
 * 预加载的字体在构建产物里的路径（相对站点根目录，例如 assets/instrument-serif-400-ABCD1234.woff2）
 * @param {string} [assetsDir='assets']
 * @returns {string[]}
 */
export function fontPreloadHrefs(assetsDir = 'assets') {
  const sources = preloadSources();
  if (!sources.length) return [];
  const key = sources.map((f) => `${f}:${statSync(f).mtimeMs}:${statSync(f).size}`).join('|');
  if (!cache || cache.key !== key) {
    const outdir = path.join(APP_DIR, '.font-preload-out');
    const css = sources.map((f, i) => `@font-face{font-family:p${i};src:url(${JSON.stringify(f)})}`).join('\n');
    const result = esbuild.buildSync({
      stdin: { contents: css, resolveDir: APP_DIR, sourcefile: 'font-preload.css', loader: 'css' },
      bundle: true,
      outdir,
      loader: { '.woff2': 'file' },
      assetNames: ASSET_NAMES,
      write: false,
      logLevel: 'silent',
    });
    const names = result.outputFiles.filter((f) => f.path.endsWith('.woff2')).map((f) => path.basename(f.path));
    // 保持清单里的顺序（esbuild 输出的顺序不保证）
    const named = (src) => {
      const base = path.basename(src, '.woff2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${base}-[A-Z0-9]{8}\\.woff2$`);
    };
    const ordered = sources.map((src) => names.find((n) => named(src).test(n))).filter(Boolean);
    cache = { key, names: ordered };
  }
  return cache.names.map((n) => `${assetsDir}/${n}`);
}
