// 设计变量（tokens.css）的约束：深色两处一致、覆盖完整、对比度达标、组件里不写死颜色、引用的变量都存在。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTokens, themeVars, resolveColor, over, contrast } from './helpers/tokens.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const tokens = loadTokens();

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test('深色：跟随系统和强制深色两处的值完全一致', () => {
  assert.deepEqual(tokens.darkMedia, tokens.darkForced);
});

test('深色覆盖了浅色里每一个跟主题有关的颜色和阴影变量', () => {
  const themeDependent = Object.keys(tokens.light).filter((k) => (k.startsWith('--color-') || k.startsWith('--shadow-') || k.startsWith('--accent-'))
    && !tokens.light[k].includes('var(')); // 由别的变量推出来的会自动跟着变
  const missing = themeDependent.filter((k) => !(k in tokens.darkForced));
  assert.deepEqual(missing, [], `深色里缺少：${missing.join(', ')}`);
  const extra = Object.keys(tokens.darkForced).filter((k) => !(k in tokens.light));
  assert.deepEqual(extra, [], `深色里多出浅色没有的变量：${extra.join(', ')}`);
});

test('所有颜色变量在两种主题下都能算出颜色', () => {
  for (const theme of ['light', 'dark']) {
    const vars = themeVars(tokens, theme);
    for (const name of Object.keys(vars).filter((k) => k.startsWith('--color-'))) {
      assert.ok(resolveColor(vars[name], vars), `${theme} ${name}`);
    }
  }
});

// [前景, 背景, 最低对比度, 说明]；背景若半透明，先叠在 surface 上
const PAIRS = [
  ['--color-text', '--color-canvas', 4.5],
  ['--color-text', '--color-surface', 4.5],
  ['--color-text', '--color-surface-2', 4.5],
  ['--color-text', '--color-surface-3', 4.5],
  ['--color-text-2', '--color-canvas', 4.5],
  ['--color-text-2', '--color-surface', 4.5],
  ['--color-text-2', '--color-surface-2', 4.5],
  ['--color-text-3', '--color-surface', 3],
  ['--color-text-3', '--color-canvas', 3],
  ['--color-text', '--color-fill-pressed', 4.5],
  ['--color-accent-text', '--color-canvas', 4.5],
  ['--color-accent-text', '--color-surface', 4.5],
  ['--color-accent-text', '--color-accent-soft', 4.5],
  ['--color-accent-text', '--color-fill', 4.5],
  ['--color-on-accent', '--color-accent', 4.5],
  ['--color-on-accent', '--color-accent-hover', 4.5],
  ['--color-on-accent', '--color-accent-pressed', 4.5],
  ['--color-success-text', '--color-surface', 4.5],
  ['--color-success-text', '--color-success-soft', 4.5],
  ['--color-warning-text', '--color-surface', 4.5],
  ['--color-warning-text', '--color-warning-soft', 4.5],
  ['--color-danger-text', '--color-surface', 4.5],
  ['--color-danger-text', '--color-danger-soft', 4.5],
  ['--color-on-success', '--color-success', 4.5],
  ['--color-on-warning', '--color-warning', 4.5],
  ['--color-on-danger', '--color-danger', 4.5],
  ...[1, 2, 3, 4, 5].map((n) => ['--color-on-rating', `--color-rating-${n}`, 4.5]),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`--color-cat-${n}`, '--color-surface', 3]),
  // 第几天的颜色（视觉评审 P1-1 / P1-2）：徽章白字压在深色调上 ≥ 4.5；图钉上的字（text-inverse）压在跟主题走的那份上 ≥ 4.5
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ['--color-on-tile', `--color-day-${n}-deep`, 4.5]),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ['--color-text-inverse', `--color-day-${n}`, 4.5]),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => [`--color-day-${n}`, '--color-surface', 3]),
  ['--color-focus-ring', '--color-canvas', 3],
  ['--color-focus-ring', '--color-surface', 3],
  ['--color-border-strong', '--color-surface', 1.8],
];

for (const theme of ['light', 'dark']) {
  test(`对比度达标（${theme === 'light' ? '浅色' : '深色'}）`, () => {
    const vars = themeVars(tokens, theme);
    const color = (name) => resolveColor(vars[name], vars);
    const surface = over(color('--color-surface'), color('--color-canvas'));
    const failures = [];
    for (const [fg, bg, min] of PAIRS) {
      const b = over(color(bg), surface);
      const f = over(color(fg), b);
      const ratio = contrast(f, b);
      if (ratio < min) failures.push(`${fg} 放在 ${bg} 上：${ratio.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(failures, []);
  });
}

test('行程主题色：设置 --trip-accent 后 --color-accent 跟着变（浅色压暗一点、深色提亮），没设就是默认的海水绿', () => {
  const round = (c) => c.slice(0, 3).map(Math.round);
  const light = { ...themeVars(tokens, 'light'), '--trip-accent': '#0e8a8a' };
  // 所有浏览器都认的写法：浅色和黑按 88% 混（白字更清楚）；深色和白按 58% 混（深底上看得清）
  assert.deepEqual(round(resolveColor(light['--color-accent'], light)), [12, 121, 121]);
  const dark = { ...themeVars(tokens, 'dark'), '--trip-accent': '#0e8a8a' };
  assert.deepEqual(round(resolveColor(dark['--color-accent'], dark)), [115, 187, 187]);
  const defaults = themeVars(tokens, 'light');
  assert.deepEqual(round(resolveColor(defaults['--color-accent'], defaults)), [31, 95, 91], '默认海水绿 #1f5f5b（墨一样深）');
  const darkDefaults = themeVars(tokens, 'dark');
  assert.deepEqual(round(resolveColor(darkDefaults['--color-accent'], darkDefaults)), [143, 184, 177], '深色默认 #8fb8b1（灰青，不发光）');
  // 第二主题色同样
  const two = { ...themeVars(tokens, 'light'), '--trip-accent-2': '#f59f00' };
  assert.notDeepEqual(round(resolveColor(two['--color-accent-2'], two)), round(resolveColor(defaults['--color-accent-2'], defaults)));
});

test('组件 CSS 不写死颜色（只有 tokens.css 可以写具体颜色）', () => {
  const bad = [];
  for (const file of walk(SRC, ['.css'])) {
    if (file.endsWith(path.join('styles', 'tokens.css'))) continue;
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    text.split('\n').forEach((line, i) => {
      // 只看声明的值（属性名: 值;），不看选择器
      const decl = /^\s*(--)?[a-z-]+\s*:\s*(.+?);?\s*$/.exec(line);
      if (!decl || /\{\s*$/.test(line)) return;
      const value = decl[2];
      if (/#[0-9a-fA-F]{3,8}\b/.test(value)
        || /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/.test(value)
        || /(^|[\s,(])(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\b/.test(value)) {
        bad.push(`${path.relative(SRC, file)}:${i + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(bad, [], `这些地方写死了颜色，请改用 var(--color-*)：\n${bad.join('\n')}`);
});

test('JS/JSX 里不写死颜色字符串', () => {
  const bad = [];
  for (const file of walk(SRC, ['.js', '.jsx'])) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/['"`]#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?['"`]/.test(line)
        || /\b(rgba?|hsla?)\(\s*\d/.test(line)) bad.push(`${path.relative(SRC, file)}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `这些地方写死了颜色：\n${bad.join('\n')}`);
});

test('CSS 里引用的 var(--x) 都在 tokens.css 里定义了（或是组件自己声明的局部变量）', () => {
  const defined = new Set([
    ...Object.keys(tokens.light), ...Object.keys(tokens.derived), ...Object.keys(tokens.darkForced),
  ]);
  const missing = [];
  for (const file of walk(SRC, ['.css', '.jsx', '.js'])) {
    // 去掉注释（注释里举例的 var(--x) 不算）
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // 文件里自己声明的局部变量（例如 --dev-xxx: …）也算定义过
    const local = new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // 只看写全了的名字（模板字符串里拼出来的 var(--color-${x}) 跳过）
    for (const m of text.matchAll(/var\((--[a-z0-9-]*[a-z0-9])\s*[,)]/g)) {
      if (!defined.has(m[1]) && !local.has(m[1])) missing.push(`${path.relative(SRC, file)}：${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('层级令牌从低到高严格递增', () => {
  const order = ['below', 'base', 'raised', 'sticky', 'topbar', 'tabbar', 'fab', 'scrim', 'sheet', 'menu', 'popover', 'toast', 'update', 'dev'];
  const values = order.map((n) => Number(tokens.light[`--z-${n}`]));
  values.forEach((v, i) => assert.ok(Number.isFinite(v), `--z-${order[i]} 没定义`));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1], `--z-${order[i]} 应大于 --z-${order[i - 1]}`);
  const allZ = Object.keys(tokens.light).filter((k) => k.startsWith('--z-')).map((k) => k.slice(4));
  assert.deepEqual(allZ.sort(), [...order].sort(), '新增层级令牌要同时加进这个测试和文档');
});
