#!/usr/bin/env node
// =====================================================================
// scripts/tokens.mjs：把 src/motion/springs.js 里的弹簧参数生成到 tokens.css。
//
//   npm run tokens                  重新生成 tokens.css 里 <springs:generated> 那一段
//   node scripts/tokens.mjs --check 只检查是否同步（npm run build 会自动检查，不同步就报错）
// =====================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS_CSS } from './lib/paths.mjs';
import { renderSpringTokens } from '../src/motion/springs.js';

const BEGIN = '  /* <springs:generated> 由 `npm run tokens` 生成，勿手改 */';
const END = '  /* </springs:generated> */';

/** 返回把弹簧段替换成最新生成结果后的 tokens.css 全文 */
export function renderTokensCss(css = readFileSync(TOKENS_CSS, 'utf8')) {
  const a = css.indexOf(BEGIN);
  const b = css.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('tokens.css 里找不到 <springs:generated> 标记');
  return `${css.slice(0, a + BEGIN.length)}\n${renderSpringTokens()}\n${css.slice(b)}`;
}

/** tokens.css 的弹簧段是否和 springs.js 一致 */
export function tokensInSync() {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  return renderTokensCss(css) === css;
}

function main() {
  if (process.argv.includes('--check')) {
    if (!tokensInSync()) {
      console.error('tokens.css 的弹簧曲线和 src/motion/springs.js 不一致，运行 npm run tokens。');
      process.exit(1);
    }
    console.log('tokens.css 弹簧曲线已同步。');
    return;
  }
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const next = renderTokensCss(css);
  if (next === css) {
    console.log('tokens.css 没有变化。');
    return;
  }
  writeFileSync(TOKENS_CSS, next);
  console.log('已更新 tokens.css 的弹簧曲线。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
