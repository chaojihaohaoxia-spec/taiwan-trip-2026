// 规则包（src/rules）的金标准用例：cases/*.json 逐条跑三遍——
//   ① 网页用的 ESM 源文件；② esbuild 打成小程序那份（CommonJS、es2015）后再跑；③ 删掉 Intl 再跑一遍（小程序没有 Intl）。
// 三遍结果都要对上 expect，②③ 和 ① 的输出也要一字不差（小程序那边 tools/test-trip-rules.js 用同一个 runner 再核一次）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import * as rules from '../../src/rules/index.js';
import { runFile } from '../../src/rules/cases/runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(here, '../../src/rules');
const CASES_DIR = path.join(RULES_DIR, 'cases');
const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json')).sort();
const load = (f) => JSON.parse(readFileSync(path.join(CASES_DIR, f), 'utf8'));

/** 照小程序同步脚本的打法：一个文件、CommonJS、es2015、压缩、中文原样 */
function buildCjs() {
  const out = buildSync({
    entryPoints: [path.join(RULES_DIR, 'index.js')], bundle: true, format: 'cjs', target: 'es2015',
    write: false, minify: true, charset: 'utf8', legalComments: 'none', logLevel: 'silent',
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports);
  return { mod: mod.exports, bytes: out.outputFiles[0].contents.length };
}

const cjs = buildCjs();

test('用例文件齐全、格式对、数量够', () => {
  assert.deepEqual(files, ['currency.json', 'dest.json', 'geo.json', 'how.json', 'place-actions.json', 'prev-stop.json', 'transport.json']);
  let total = 0;
  for (const f of files) {
    const file = load(f);
    assert.equal(typeof file.fn, 'string', f);
    assert.ok(Array.isArray(file.cases) && file.cases.length > 0, f);
    const names = new Set();
    for (const c of file.cases) {
      assert.ok(c.name && !names.has(c.name), `${f}：用例名字要有、不能重复：${c.name}`);
      names.add(c.name);
      assert.ok('expect' in c, `${f}：${c.name} 没写 expect`);
    }
    total += file.cases.length;
  }
  // spec 验收：how ≥ 70 条
  assert.ok(load('how.json').cases.length >= 70);
  assert.ok(total >= 250, `一共 ${total} 条`);
});

for (const f of files) {
  test(`金标准 ${f}：网页 ESM`, () => {
    const bad = runFile(rules, load(f)).filter((r) => !r.ok);
    assert.deepEqual(bad.map((r) => `${r.name}：${r.diff.join('；')}`), []);
  });

  test(`金标准 ${f}：小程序那份（esbuild → CommonJS es2015），和网页输出一字不差`, () => {
    const a = runFile(rules, load(f));
    const b = runFile(cjs.mod, load(f));
    assert.deepEqual(b.filter((r) => !r.ok).map((r) => `${r.name}：${r.diff.join('；')}`), []);
    assert.equal(JSON.stringify(b.map((r) => r.actual)), JSON.stringify(a.map((r) => r.actual)));
  });

  test(`金标准 ${f}：没有 Intl 也一样`, () => {
    const expected = JSON.stringify(runFile(rules, load(f)).map((r) => r.actual));
    const saved = globalThis.Intl;
    let got;
    try {
      delete globalThis.Intl;
      assert.equal(typeof Intl, 'undefined');
      got = runFile(cjs.mod, load(f));
    } finally {
      globalThis.Intl = saved;
    }
    assert.deepEqual(got.filter((r) => !r.ok).map((r) => r.name), []);
    assert.equal(JSON.stringify(got.map((r) => r.actual)), expected);
  });
}

test('小程序那份的大小（主包要用；A3 挪走演示代码后再进主包）', () => {
  // 压缩、中文原样（charset utf8）后的字节数。超了要先想办法瘦身，不要直接调大
  assert.ok(cjs.bytes < 48 * 1024, `规则包 ${cjs.bytes} 字节`);
  assert.equal(cjs.mod.RULES_VERSION, rules.RULES_VERSION);
  assert.deepEqual(Object.keys(cjs.mod).sort(), Object.keys(rules).sort());
});
