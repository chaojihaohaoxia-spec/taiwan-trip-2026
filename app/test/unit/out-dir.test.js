// 并行构建的输出目录（RS_OUT_DIR，scripts/lib/paths.mjs）：不设时和以前完全一样（仓库根目录）；设了就用那个目录；
// 为了不误删东西，不能在 app/ 或仓库里、已有文件又不是以前的构建输出时拒绝；子进程拿到的是绝对路径。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutDir, REPO_ROOT, APP_DIR, OUT_MARKER, OUT_DIR, CUSTOM_OUT_DIR, E2E_SHOTS_ROOT } from '../../scripts/lib/paths.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'rs7885-outdir-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const PATHS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/lib/paths.mjs');

test('不设 RS_OUT_DIR（或设成空串、仓库根目录本身）：输出到仓库根目录，和以前一样', () => {
  for (const v of [undefined, '', '   ', REPO_ROOT]) assert.deepEqual(resolveOutDir(v), { dir: REPO_ROOT, custom: false }, String(v));
  if (!process.env.RS_OUT_DIR) {
    assert.equal(OUT_DIR, REPO_ROOT);
    assert.equal(CUSTOM_OUT_DIR, false);
    assert.equal(E2E_SHOTS_ROOT, path.join(APP_DIR, 'test', 'e2e'), '截图还在 test/e2e/ 下');
  }
});

test('设了：不存在的目录、空目录、带标记文件的旧输出目录都可以；相对路径按当前目录解析', () => {
  const fresh = path.join(tmp, 'fresh', 'deep');
  assert.deepEqual(resolveOutDir(fresh), { dir: fresh, custom: true });
  const empty = path.join(tmp, 'empty');
  mkdirSync(empty);
  assert.equal(resolveOutDir(empty).custom, true);
  writeFileSync(path.join(empty, '.DS_Store'), '');
  assert.equal(resolveOutDir(empty).custom, true, '.DS_Store 不算');
  const old = path.join(tmp, 'old');
  mkdirSync(old);
  writeFileSync(path.join(old, OUT_MARKER), 'x');
  writeFileSync(path.join(old, 'index.html'), 'x');
  assert.equal(resolveOutDir(old).dir, old);
  assert.equal(resolveOutDir('rel/out', { cwd: tmp }).dir, path.join(tmp, 'rel', 'out'));
});

test('拒绝：在 app/ 里、在仓库里、不是目录、已有别的文件又没有标记（免得把 ~/ 这类目录下的 assets/、icons/ 删掉）', () => {
  assert.throws(() => resolveOutDir(path.join(APP_DIR, 'dist')), /不能在 app\/ 里面/);
  assert.throws(() => resolveOutDir(APP_DIR), /不能在 app\/ 里面/);
  assert.throws(() => resolveOutDir(path.join(REPO_ROOT, 'out')), /不能在仓库里面/);
  const file = path.join(tmp, 'a-file');
  writeFileSync(file, 'x');
  assert.throws(() => resolveOutDir(file), /不是目录/);
  const busy = path.join(tmp, 'busy');
  mkdirSync(busy);
  writeFileSync(path.join(busy, 'notes.txt'), 'x');
  assert.throws(() => resolveOutDir(busy), /为了不误删拒绝使用/);
});

test('子进程：RS_OUT_DIR 写成相对路径时，paths.mjs 解析成绝对路径并写回环境变量；截图根目录跟着到 <RS_OUT_DIR>/_e2e', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const p = await import(${JSON.stringify(PATHS)}); console.log(JSON.stringify({ out: p.OUT_DIR, custom: p.CUSTOM_OUT_DIR, shots: p.E2E_SHOTS_ROOT, env: process.env.RS_OUT_DIR }));`,
  ], { cwd: tmp, env: { ...process.env, RS_OUT_DIR: 'child-out', RS_E2E_SHOTS: '' }, encoding: 'utf8' });
  const r = JSON.parse(out.trim());
  const expect = path.join(tmp, 'child-out');
  // macOS 的 /var → /private/var：比较真实路径的结尾
  assert.ok(r.out.endsWith(path.join(path.basename(tmp), 'child-out')), r.out);
  assert.equal(r.custom, true);
  assert.equal(r.env, r.out, '写回了绝对路径');
  assert.equal(r.shots, path.join(r.out, '_e2e'));
  assert.ok(path.isAbsolute(r.out) && expect.endsWith('child-out'));
});
