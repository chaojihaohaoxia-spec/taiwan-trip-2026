// scripts/shoot.mjs（截图工具）的参数解析：路由列表（含弹层栈里的逗号）、宽度和高度、目标网址、
// --real 时截图必须放在仓库外、各种写错的参数给中文提示。真正截图在本机用 Chrome 跑（见 scripts/README.md）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, parseRoutes, parseViewport, targetUrl, HELP } from '../../scripts/shoot.mjs';
import { REPO_ROOT, APP_DIR, OUT_DIR } from '../../scripts/lib/paths.mjs';

test('路由列表：名字=#/路由，逗号分隔；弹层栈 sheet=a,b:1 里的逗号不切开；没写名字的按路由起名', () => {
  assert.deepEqual(parseRoutes('home=#/t/demo-island,d1=#/t/demo-island/day/2027-01-10,fab=#/t/demo-island?sheet=fab'), [
    { name: 'home', hash: '#/t/demo-island' },
    { name: 'd1', hash: '#/t/demo-island/day/2027-01-10' },
    { name: 'fab', hash: '#/t/demo-island?sheet=fab' },
  ]);
  assert.deepEqual(parseRoutes('two=#/t/x?sheet=menu,item:abc, 概览=#/t/x'), [
    { name: 'two', hash: '#/t/x?sheet=menu,item:abc' },
    { name: '概览', hash: '#/t/x' },
  ]);
  assert.deepEqual(parseRoutes('#/trips,#/t/demo-island/ledger'), [
    { name: 'trips', hash: '#/trips' },
    { name: 't-demo-island-ledger', hash: '#/t/demo-island/ledger' },
  ]);
  assert.throws(() => parseRoutes('home=/t/x'), /路由写法不对/);
  assert.throws(() => parseRoutes('a=#/x,a=#/y'), /名字重复/);
  assert.throws(() => parseRoutes('a b=#/x'), /路由写法不对|名字只能/);
});

test('宽度：390→844、375→667、1280→800；可以直接写 390x700；其他宽度按比例', () => {
  assert.deepEqual(parseViewport('390'), { width: 390, height: 844, label: '390' });
  assert.deepEqual(parseViewport('375'), { width: 375, height: 667, label: '375' });
  assert.deepEqual(parseViewport('1280'), { width: 1280, height: 800, label: '1280' });
  assert.deepEqual(parseViewport('390x700'), { width: 390, height: 700, label: '390x700' });
  assert.equal(parseViewport('360').height, 780);
  assert.equal(parseViewport('1920').height, 800);
  assert.throws(() => parseViewport('wide'), /宽度写法不对/);
});

test('目标网址：默认加 ?demo=1&nosw=1；--real 加 real=1；--now 编码进查询参数；原来的查询参数保留', () => {
  assert.equal(targetUrl('http://localhost:5173/', '#/trips'), 'http://localhost:5173/?demo=1&nosw=1#/trips');
  assert.equal(targetUrl('http://localhost:5173/?demouser=cathy', '#/t/x?sheet=fab', { real: true, now: '2027-01-11T10:00:00+07:00' }),
    'http://localhost:5173/?demouser=cathy&demo=1&real=1&nosw=1&now=2027-01-11T10%3A00%3A00%2B07%3A00#/t/x?sheet=fab');
  assert.equal(targetUrl('http://localhost:4173/taiwan-trip-2026/', '#/trips', { demo: false }), 'http://localhost:4173/taiwan-trip-2026/?nosw=1#/trips');
});

test('参数：默认值、--dist 不写目录用构建输出目录、各种写错给中文提示', () => {
  const o = parseArgs(['--routes', 'home=#/t/demo-island', '--widths', '390,1280', '--themes', 'light,dark']);
  assert.equal(o.demo, true);
  assert.equal(o.scale, 2);
  assert.equal(o.full, false);
  assert.deepEqual(o.viewports.map((v) => v.width), [390, 1280]);
  assert.deepEqual(o.themeList, ['light', 'dark']);
  assert.ok(o.outDir.startsWith(path.join(os.tmpdir(), 'rs7885-shots')), '默认截到系统临时目录');
  assert.equal(parseArgs(['--dist']).dist, OUT_DIR);
  assert.equal(parseArgs(['--dist', '/tmp/x', '--routes', '#/trips']).dist, '/tmp/x');
  assert.equal(parseArgs(['--help']).help, true);
  assert.match(HELP, /--real/);
  assert.throws(() => parseArgs(['--themes', 'sepia']), /light \/ dark/);
  assert.throws(() => parseArgs(['--now', '2027-01-11T10:00:00']), /带时区/);
  assert.throws(() => parseArgs(['--scale', '9']), /1 到 4/);
  assert.throws(() => parseArgs(['--base', 'http://localhost:5173/', '--dist', '/tmp/x']), /二选一/);
  assert.throws(() => parseArgs(['--real', '--dist', '/tmp/x']), /开发服务器/);
  assert.throws(() => parseArgs(['--real', '--no-demo']), /演示模式/);
  assert.throws(() => parseArgs(['--routes']), /后面要跟一个值/);
  assert.throws(() => parseArgs(['--what']), /不认识的参数/);
});

test('--real 截到的是真实数据：--out 在仓库里（含 app/、仓库根目录本身）直接报错；仓库外可以', () => {
  for (const inside of [REPO_ROOT, path.join(APP_DIR, 'test', 'e2e', '__shots__'), path.join(REPO_ROOT, 'docs', 'x')]) {
    assert.throws(() => parseArgs(['--real', '--out', inside]), /必须在仓库外/, inside);
  }
  const outside = path.join(os.tmpdir(), 'rs7885-shots-real-test');
  assert.equal(parseArgs(['--real', '--out', outside]).outDir, outside);
  // 不带 --real 时仓库里也可以（比如 test/e2e/__shots__，已在 gitignore 里）
  assert.equal(parseArgs(['--out', path.join(APP_DIR, 'test', 'e2e', '__shots__', 'x')]).real, false);
});
