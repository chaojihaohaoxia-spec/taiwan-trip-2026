// 「杂志纸本」（SPEC §11）的对比度：页面是不透明的纸（--color-canvas），少数几样是纸片（--color-card：「现在」、预订卡、弹层），
// 浮层是不透明的纸（--color-glass-strong / --color-surface-raised），选中块是一张纸片（--color-thumb）。
// 底下不再有光场，所以每种背景就是一个颜色：正文、次要文字、强调色文字在这些背景上都要 ≥4.5:1（户外强光）。
// 两种情况都算：所有浏览器都认的近似（color-mix 和黑 / 白混合）和支持相对颜色语法的浏览器（@supports 里的 OKLCH 版本）。
// 主题色：默认、富国岛（真实行程的主题色）、样稿的富国岛 / 台湾、演示数据的两趟、再加一组冷色（青 + 蓝）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTokens, themeVars, resolveColor, over, contrast, readRelativeBlock } from './helpers/tokens.js';

const tokens = loadTokens();
const relative = readRelativeBlock(tokens.css);

const PALETTES = [
  ['默认（海水绿 / 沙色）', null, null],
  ['富国岛', '#0b7480', '#e8925a'],
  ['样稿 · 富国岛', '#0a7c75', '#e85d3f'],
  ['样稿 · 台湾', '#bd4f16', '#d99400'],
  ['演示 · 椰影岛', '#0e8a8a', '#f2a65a'],
  ['演示 · 三城', '#c2255c', '#f59f00'],
  ['冷色（青 + 蓝）', '#2bb3a3', '#3b82c4'],
];

/** 纸、纸片、浮层、选中块：每种都是不透明的一个颜色 */
const PAPERS = ['--color-canvas', '--color-card', '--color-surface', '--color-surface-raised', '--color-glass-strong', '--color-thumb', '--color-tabbar-glass'];

function varsFor(theme, accent, accent2, enhanced) {
  const vars = { ...themeVars(tokens, theme) };
  if (accent) vars['--trip-accent'] = accent;
  if (accent2) vars['--trip-accent-2'] = accent2;
  return enhanced ? { ...vars, ...relative } : vars;
}

const color = (vars, name) => {
  const c = resolveColor(vars[name], vars);
  assert.ok(c, `${name} 算不出颜色`);
  return c;
};

/** 前景（可能半透明）放在一组背景上，最差的对比度 */
function worst(fg, backgrounds) {
  let min = Infinity;
  for (const bg of backgrounds) min = Math.min(min, contrast(over(fg, bg), bg));
  return min;
}

test('纸是不透明的：页面底、纸片、浮层、选中块都没有透明度（不再透出底下的光场）', () => {
  for (const theme of ['light', 'dark']) {
    const vars = varsFor(theme, null, null, false);
    for (const name of PAPERS) assert.equal(color(vars, name)[3], 1, `${theme} ${name}`);
  }
  // 纸的颜色：浅色米白、深色深墨（不偏青也不偏棕）
  assert.deepEqual(color(varsFor('light', null, null, false), '--color-canvas').slice(0, 3), [244, 241, 234]);
  assert.deepEqual(color(varsFor('dark', null, null, false), '--color-canvas').slice(0, 3), [20, 20, 19]);
});

for (const theme of ['light', 'dark']) {
  for (const enhanced of [false, true]) {
    const label = `${theme === 'light' ? '浅色' : '深色'} · ${enhanced ? 'OKLCH（iOS 18 / Chrome 119 起）' : '通用近似'}`;
    test(`纸上的对比度：正文、次要文字、强调色文字在纸、纸片、浮层、选中块上都 ≥4.5:1（${label}）`, (t) => {
      const failures = [];
      for (const [name, a1, a2] of PALETTES) {
        const vars = varsFor(theme, a1, a2, enhanced);
        const papers = PAPERS.map((p) => color(vars, p));
        const rows = {
          正文: worst(color(vars, '--color-text'), papers),
          次要: worst(color(vars, '--color-text-2'), papers),
          强调字: worst(color(vars, '--color-accent-text'), papers),
          砖红: worst(color(vars, '--color-danger-text'), papers),
          赭石: worst(color(vars, '--color-warning-text'), papers),
          底栏字: worst(color(vars, '--color-tabbar-ink'), [color(vars, '--color-tabbar-glass')]),
        };
        t.diagnostic(`${name}：${Object.entries(rows).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('，')}`);
        // 老浏览器（没有 OKLCH）只能和黑 / 白按固定比例混：太浅的主题色（例如 #2bb3a3）压不到 4.5，已知限制，见 styles/README.md
        const lightAccent = !enhanced && a1 && contrast([255, 255, 255, 1], resolveColor(a1, {})) < 3;
        for (const [k, v] of Object.entries(rows)) {
          if (v >= 4.5) continue;
          if (lightAccent && k === '强调字') continue;
          failures.push(`${name} ${k}：${v.toFixed(2)}`);
        }
      }
      assert.deepEqual(failures, []);
    });
  }
}

test('装饰灰（--color-text-3）在纸上 ≥3:1（只做装饰、眉标、占位，不做正文）', () => {
  for (const theme of ['light', 'dark']) {
    const vars = varsFor(theme, null, null, false);
    const r = worst(color(vars, '--color-text-3'), PAPERS.map((p) => color(vars, p)));
    assert.ok(r >= 3, `${theme}：${r.toFixed(2)}`);
  }
});

test('实心强调色上的字（主按钮、＋、选中的天）≥4.5:1：默认色和支持 OKLCH 时的任意主题色', (t) => {
  const failures = [];
  for (const theme of ['light', 'dark']) {
    for (const [name, a1, a2] of PALETTES) {
      // 默认色：所有浏览器；行程主题色：OKLCH 版本（只调亮度和彩度，任何颜色都达标）
      for (const enhanced of a1 ? [true] : [false, true]) {
        const vars = varsFor(theme, a1, a2, enhanced);
        const on = color(vars, '--color-on-accent');
        const ratios = ['--color-accent', '--color-accent-hover', '--color-accent-pressed'].map((n) => contrast(over(on, color(vars, n)), color(vars, n)));
        const min = Math.min(...ratios);
        t.diagnostic(`${theme === 'light' ? '浅色' : '深色'} ${name}${enhanced ? '（OKLCH）' : ''}：${min.toFixed(2)}`);
        if (min < 4.5) failures.push(`${theme} ${name}：${min.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('不支持 OKLCH 的老浏览器：深一点的主题色（青绿、玫红、橙红）实心底上的字仍 ≥4.5:1（太亮的金黄色做不到，见 styles/README.md）', () => {
  for (const theme of ['light', 'dark']) {
    for (const [name, a1, a2] of PALETTES.filter(([, a]) => ['#0b7480', '#0a7c75', '#0e8a8a', '#c2255c', '#bd4f16'].includes(a))) {
      const vars = varsFor(theme, a1, a2, false);
      const ratio = contrast(over(color(vars, '--color-on-accent'), color(vars, '--color-accent')), color(vars, '--color-accent'));
      assert.ok(ratio >= 4.5, `${theme} ${name}：${ratio.toFixed(2)}`);
    }
  }
});

test('海水绿和样稿一致：默认 #1f5f5b；富国岛的主题色在 OKLCH 里压成墨一样深的 #28585f（每个通道差 ≤8）、文字 #25555c', () => {
  const near = (c, rgb, d = 8) => rgb.every((v, i) => Math.abs(v - c[i]) <= d);
  assert.deepEqual(color(varsFor('light', null, null, false), '--color-accent').slice(0, 3), [31, 95, 91]);
  const pq = varsFor('light', '#0b7480', null, true);
  assert.ok(near(color(pq, '--color-accent'), [40, 88, 95]), `实心：${color(pq, '--color-accent').slice(0, 3)}`);
  assert.ok(near(color(pq, '--color-accent-text'), [37, 85, 92]), `文字：${color(pq, '--color-accent-text').slice(0, 3)}`);
  // 深色：降成灰青、不发光（亮度 0.70–0.76）
  const dark = varsFor('dark', '#0b7480', null, true);
  const [r, g, b] = color(dark, '--color-accent');
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 70, '深色的海色彩度很低');
});

test('主题色跟着 --trip-accent / --trip-accent-2 走（.accent-scope 的容器各算各的）', () => {
  for (const enhanced of [false, true]) {
    const a = varsFor('light', '#0e8a8a', '#f2a65a', enhanced);
    const b = varsFor('light', '#c2255c', '#f59f00', enhanced);
    for (const name of ['--color-accent', '--color-accent-2', '--color-accent-text', '--color-accent-soft']) {
      assert.notDeepEqual(color(a, name), color(b, name), `${name} 应该随主题色变化`);
    }
  }
});

test('不发光、没有渐变：强调色的柔光、玻璃的高光、底栏的晕都是透明的', () => {
  for (const theme of ['light', 'dark']) {
    const vars = varsFor(theme, '#0b7480', null, false);
    for (const name of ['--color-accent-glow', '--color-sheen', '--color-rim', '--color-glass-glow', '--color-glass-highlight', '--color-tabbar-halo', '--color-tabbar-lens']) {
      assert.equal(color(vars, name)[3], 0, `${theme} ${name}`);
    }
  }
  assert.equal(tokens.derived['--material-accent'], 'linear-gradient(var(--color-accent), var(--color-accent))');
  assert.equal(tokens.light['--glass-filter'], 'none');
  assert.equal(tokens.light['--tabbar-glass-filter'], 'none');
});
