#!/usr/bin/env node
// =====================================================================
// scripts/preview.mjs：本地预览构建产物（npm run preview），和线上 GitHub Pages 一样挂在
// /taiwan-trip-2026/ 子路径下，Service Worker、离线、更新提示都能在这里试。
//   先 npm run build，再 npm run preview，打开打印出来的网址。
//   RS_OUT_DIR=<目录> npm run preview：预览那个目录里的产物（和 RS_OUT_DIR=<目录> npm run build 配套）。
// =====================================================================

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PREVIEW_PORT, OUTPUTS, OUT_DIR, CUSTOM_OUT_DIR } from './lib/paths.mjs';
import { startStaticServer } from './lib/static-server.mjs';

if (!existsSync(path.join(OUT_DIR, OUTPUTS.html))) {
  console.error(CUSTOM_OUT_DIR
    ? `RS_OUT_DIR（${OUT_DIR}）里还没有构建产物，先运行 RS_OUT_DIR=${OUT_DIR} npm run build。`
    : '还没有构建产物，先运行 npm run build。');
  process.exit(1);
}

let server;
for (let port = PREVIEW_PORT; port < PREVIEW_PORT + 20; port++) {
  try {
    server = await startStaticServer({ port, log: process.argv.includes('--log') });
    break;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
  }
}
if (!server) {
  console.error('找不到空闲端口');
  process.exit(1);
}
console.log(`预览构建产物：${server.url}${CUSTOM_OUT_DIR ? `（来自 ${OUT_DIR}）` : ''}`);
console.log(`演示模式：    ${server.url}?demo=1#/trips`);
console.log('按 Ctrl+C 停止。');
