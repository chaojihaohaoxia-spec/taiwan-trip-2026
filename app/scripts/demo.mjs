#!/usr/bin/env node
// =====================================================================
// scripts/demo.mjs：生成演示数据库 app/demo/demo-db.json。
//
//   npm run demo            重新生成（改了 demo/source/*.json 之后运行）
//   node scripts/demo.mjs --check   只检查 demo-db.json 是不是最新，不是就退出码 1
//
// npm run build / npm run dev 会自动调用 ensureDemoDb()，一般不用手动跑。
// =====================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_DIR, APP_DIR } from './lib/paths.mjs';
import { expandDemo } from './lib/demo-expand.mjs';

export const DEMO_DB_FILE = path.join(DEMO_DIR, 'demo-db.json');
const SOURCE_DIR = path.join(DEMO_DIR, 'source');

/** 读所有源文件（按文件名排序），展开成 demo-db.json 的文本 */
export function renderDemoDb() {
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.json')).sort();
  const sources = files.map((f) => ({
    file: path.relative(APP_DIR, path.join(SOURCE_DIR, f)),
    doc: JSON.parse(readFileSync(path.join(SOURCE_DIR, f), 'utf8')),
  }));
  const out = expandDemo(sources);
  const doc = {
    _说明: '演示数据库（自动生成，不要手改）。源文件在 demo/source/，改完运行 npm run demo。内容全部虚构。',
    generated_from: sources.map((s) => s.file),
    current_user_id: out.currentUserId,
    users: out.users,
    files: out.files,
    tables: out.tables,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * 原子写入：先写临时文件再改名。几个 agent 同时构建（RS_OUT_DIR 并行）时都可能重新生成 demo-db.json，
 * 别的进程（esbuild 打包、单元测试）任何时候读到的都是完整的旧文件或完整的新文件。
 */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** 不是最新就重新生成。返回 'unchanged' | 'written' */
export function ensureDemoDb({ log = console.log } = {}) {
  const text = renderDemoDb();
  const old = existsSync(DEMO_DB_FILE) ? readFileSync(DEMO_DB_FILE, 'utf8') : null;
  if (old === text) return 'unchanged';
  writeAtomic(DEMO_DB_FILE, text);
  log(`演示数据已更新：${path.relative(APP_DIR, DEMO_DB_FILE)}`);
  return 'written';
}

function main() {
  const check = process.argv.includes('--check');
  const text = renderDemoDb();
  const old = existsSync(DEMO_DB_FILE) ? readFileSync(DEMO_DB_FILE, 'utf8') : null;
  if (check) {
    if (old !== text) {
      console.error('demo/demo-db.json 不是最新的，运行 npm run demo 重新生成。');
      process.exit(1);
    }
    console.log('demo/demo-db.json 是最新的。');
    return;
  }
  const db = JSON.parse(text);
  if (old !== text) writeAtomic(DEMO_DB_FILE, text);
  const counts = Object.entries(db.tables).filter(([, rows]) => rows.length).map(([t, rows]) => `${t} ${rows.length}`);
  console.log(`${old === text ? '没有变化' : '已生成'}：${path.relative(APP_DIR, DEMO_DB_FILE)}`);
  console.log(`  ${counts.join('，')}`);
  console.log(`  演示用户 ${db.users.map((u) => `${u.display_name}（${u.email}）`).join('、')}；演示文件 ${Object.keys(db.files).length} 个`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
