#!/usr/bin/env node
// =====================================================================
// scripts/e2e.mjs：端到端测试（npm run e2e）。
//
// 1. 构建产物不存在、或者比源码旧，就先 npm run build（e2e 测的是真实产物，不是开发服务器）；
// 2. 用 node:test 依次跑 test/e2e/*.e2e.mjs（一次一个文件，避免抢 Chrome）；
// 3. 截图在 test/e2e/__screenshots__/<测试文件名>/。
//
//   npm run e2e                          全部
//   npm run e2e -- smoke                 只跑文件名含 smoke 的
//   npm run e2e -- --test-name-pattern=弹层   只跑名字匹配的用例
//   HEADFUL=1 npm run e2e                看得见浏览器窗口
//
// 并行：RS_OUT_DIR=<目录> npm run e2e —— 构建产物、判断要不要重新构建、静态服务器的根目录都换成那个目录，
// 截图写到 <目录>/_e2e/；静态服务器端口每次由系统分配空闲端口，Chrome 每次用全新的临时配置目录，
// 所以几个不同 RS_OUT_DIR 的 e2e 可以同时跑（同一个 RS_OUT_DIR 不要同时跑两个）。
// =====================================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR, OUTPUTS, OUT_DIR, CUSTOM_OUT_DIR, E2E_SHOTS_ROOT } from './lib/paths.mjs';

function newestMtime(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '__screenshots__') continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    newest = Math.max(newest, st.isDirectory() ? newestMtime(p) : st.mtimeMs);
  }
  return newest;
}

function needsBuild() {
  const html = path.join(OUT_DIR, OUTPUTS.html);
  if (!existsSync(html)) return CUSTOM_OUT_DIR ? `RS_OUT_DIR（${OUT_DIR}）里还没有构建产物` : '还没有构建产物';
  if (!readFileSync(html, 'utf8').includes('content="rs7885-build"')) return `${CUSTOM_OUT_DIR ? 'RS_OUT_DIR' : '根目录'}的 index.html 不是本工程构建的`;
  const builtAt = statSync(html).mtimeMs;
  const sources = Math.max(...['src', 'demo', 'static', 'scripts'].map((d) => newestMtime(path.join(APP_DIR, d))), statSync(path.join(APP_DIR, 'package.json')).mtimeMs);
  if (sources > builtAt) return '源码比构建产物新';
  return null;
}

if (CUSTOM_OUT_DIR) console.log(`RS_OUT_DIR：构建产物和截图都在 ${OUT_DIR}`);
const reason = needsBuild();
if (reason) {
  console.log(`${reason}，先构建……`);
  // 子进程继承环境变量（RS_OUT_DIR），构建写到同一个目录
  const r = spawnSync(process.execPath, [path.join(APP_DIR, 'scripts', 'build.mjs')], { stdio: 'inherit', cwd: APP_DIR });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));
const flags = args.filter((a) => a.startsWith('--'));
const e2eDir = path.join(APP_DIR, 'test', 'e2e');
const files = readdirSync(e2eDir)
  .filter((f) => f.endsWith('.e2e.mjs'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort()
  .map((f) => path.join('test', 'e2e', f));
if (!files.length) {
  console.error('没有匹配的 e2e 测试文件');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...flags, ...files], {
  stdio: 'inherit',
  cwd: APP_DIR,
});
const shotsDir = path.join(E2E_SHOTS_ROOT, '__screenshots__');
console.log(`\n截图目录：${CUSTOM_OUT_DIR ? shotsDir : path.relative(APP_DIR, shotsDir)}/`);
process.exit(r.status ?? 1);
