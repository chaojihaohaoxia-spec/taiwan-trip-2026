// =====================================================================
// scripts/lib/paths.mjs：构建、开发、测试脚本共用的路径和常量。
// =====================================================================

import path from 'node:path';
import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** app/ 目录 */
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 仓库根目录（GitHub Pages 从这里发布；不设 RS_OUT_DIR 时构建产物写到这里） */
export const REPO_ROOT = path.resolve(APP_DIR, '..');
export const SRC_DIR = path.join(APP_DIR, 'src');
export const STATIC_DIR = path.join(APP_DIR, 'static');
export const DEMO_DIR = path.join(APP_DIR, 'demo');

/** 入口 */
export const ENTRY = path.join(SRC_DIR, 'main.jsx');
export const SW_TEMPLATE = path.join(SRC_DIR, 'sw', 'sw.js');
export const TOKENS_CSS = path.join(SRC_DIR, 'styles', 'tokens.css');

/** 构建产物（相对仓库根目录）。清理时只删这些，绝不碰 guides/、legacy/、docs/、app/ 等 */
export const OUTPUTS = Object.freeze({
  html: 'index.html',
  assetsDir: 'assets',
  sw: 'sw.js',
  manifest: 'manifest.webmanifest',
  iconsDir: 'icons',
  /** 字体授权文件（fonts/licenses/*.txt + README.md，随站部署；字体文件本身在 assets/ 里） */
  fontsDir: 'fonts',
  nojekyll: '.nojekyll',
});

/**
 * 路径的“真实位置”：最近一级已经存在的目录取 realpath（解开软链接），后面还不存在的部分原样接上。
 * 检查“在不在仓库里”要用它：仓库外一个指向仓库里的软链接，看路径字符串在仓库外，写进去其实落在仓库里。
 */
export function realPathOf(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** p 是不是 dir 本身或者在 dir 里面（两边都按真实位置算，软链接绕不过去） */
export function isInsideReal(p, dir) {
  const a = realPathOf(p);
  const b = realPathOf(dir);
  return a === b || a.startsWith(b + path.sep);
}

/** 自定义输出目录里的标记文件：有它才说明这个目录是构建建的，清理时才敢删里面的 OUTPUTS */
export const OUT_MARKER = '.rs7885-out';

/**
 * 解析构建输出目录（纯函数，单元测试直接测）。
 *   不设 RS_OUT_DIR → 仓库根目录（行为和以前完全一样）；
 *   设了 → 那个目录（相对路径按当前工作目录解析）。几个 agent 并行构建 / 跑 e2e 时各用各的，互不覆盖。
 * 为了不误删东西，自定义目录有这些限制：
 *   - 不能在 app/ 里面（会被当成源码监听，还可能被 npm run build 的清理碰到）；
 *   - 不能在仓库里（公开仓库，不留构建垃圾；要写仓库就别设 RS_OUT_DIR）；
 *   - 已存在且不是空目录时，里面必须有标记文件 .rs7885-out（是以前的构建输出），否则拒绝，
 *     免得把 ~/ 这类目录下的 assets/、icons/、index.html 当成旧产物删掉。
 * @param {string|undefined} value  process.env.RS_OUT_DIR
 * @param {{ cwd?: string }} [o]
 * @returns {{ dir: string, custom: boolean }}
 */
export function resolveOutDir(value, { cwd = process.cwd() } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { dir: REPO_ROOT, custom: false };
  const dir = path.resolve(cwd, raw);
  if (dir === REPO_ROOT) return { dir: REPO_ROOT, custom: false };
  const inside = (parent) => dir === parent || dir.startsWith(parent + path.sep) || isInsideReal(dir, parent);
  if (inside(APP_DIR)) throw new Error(`RS_OUT_DIR 不能在 app/ 里面：${dir}`);
  if (inside(REPO_ROOT)) throw new Error(`RS_OUT_DIR 不能在仓库里面（要输出到仓库根目录就别设 RS_OUT_DIR）：${dir}`);
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Error(`RS_OUT_DIR 不是目录：${dir}`);
    const entries = readdirSync(dir).filter((n) => n !== '.DS_Store');
    if (entries.length && !entries.includes(OUT_MARKER)) {
      throw new Error(`RS_OUT_DIR 已经有别的文件、又不是以前的构建输出（没有 ${OUT_MARKER}），为了不误删拒绝使用：${dir}\n换一个空目录或新目录。`);
    }
  }
  return { dir, custom: true };
}

const outDir = resolveOutDir(process.env.RS_OUT_DIR);
// 写回绝对路径：子进程（e2e 里跑构建、node --test 跑测试文件）的工作目录可能不同，相对路径会解析到别处
if (outDir.custom) process.env.RS_OUT_DIR = outDir.dir;
/** 构建产物所在目录：npm run build 写到这里，npm run preview / e2e 从这里起静态服务器 */
export const OUT_DIR = outDir.dir;
/** 是否设了 RS_OUT_DIR（产物不在仓库根目录） */
export const CUSTOM_OUT_DIR = outDir.custom;

/**
 * e2e 截图的根目录（下面是 __screenshots__/ 和 __shots__/）。
 *   不设 RS_OUT_DIR：test/e2e/（和以前一样）；设了：<RS_OUT_DIR>/_e2e/（并行跑的 e2e 截图不互相覆盖）。
 *   RS_E2E_SHOTS 可以再单独指定。
 */
export const E2E_SHOTS_ROOT = process.env.RS_E2E_SHOTS
  ? path.resolve(process.env.RS_E2E_SHOTS)
  : CUSTOM_OUT_DIR ? path.join(OUT_DIR, '_e2e') : path.join(APP_DIR, 'test', 'e2e');

/** 本地开发服务器默认端口（被占用就往后找） */
export const DEV_PORT = 5173;
/** npm run preview 的端口 */
export const PREVIEW_PORT = 4173;
/** 本地模拟 GitHub Pages 时用的子路径（检验产物里没有写死仓库名） */
export const PAGES_BASE = '/taiwan-trip-2026/';

/** 应用名、描述（manifest、<title>、<meta>） */
export const APP_NAME = '热爱生活7885';
export const APP_DESCRIPTION = '两个人一起用的旅行手帐：行程、预订、账本、清单和日记。';

/** 浏览器目标：iOS/Safari 16.4 起（color-mix、:has、ES2022） */
export const BROWSER_TARGETS = ['chrome111', 'edge111', 'firefox115', 'safari16.4', 'ios16.4'];

/** 本机 Chrome（e2e、生成图标） */
export const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
