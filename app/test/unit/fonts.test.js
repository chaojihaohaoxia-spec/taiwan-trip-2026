// 网页字体（P2「杂志宋体」）：@font-face、思源宋体的分片、预加载、授权文件、字体角色变量。
// 字体文件和 styles/fonts.css 由 scripts/fonts/build-fonts.py 生成；这里核对生成结果守得住约定。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss } from '../../scripts/lib/bundle.mjs';
import { renderHtml } from '../../scripts/lib/html.mjs';
import { fontPreloadHrefs, preloadSources } from '../../scripts/fonts/preload.mjs';
import { loadTokens } from './helpers/tokens.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS_FILE = path.join(APP, 'src/styles/fonts.css');
const FONTS_DIR = path.join(APP, 'static/fonts');
const css = readFileSync(CSS_FILE, 'utf8');
const manifest = JSON.parse(readFileSync(path.join(FONTS_DIR, 'fonts.json'), 'utf8'));

/** fonts.css 里的 @font-face，按声明顺序 */
function faces() {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const d = Object.fromEntries([...m[1].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
    return {
      family: d['font-family'].replace(/"/g, ''),
      file: /url\("([^"]+)"\)/.exec(d.src)[1],
      weight: d['font-weight'],
      style: d['font-style'] || 'normal',
      display: d['font-display'],
      range: d['unicode-range'],
      sizeAdjust: d['size-adjust'],
    };
  });
}

function parseRanges(spec) {
  return spec.split(',').map((p) => p.trim().replace(/^U\+/i, '')).filter(Boolean).map((p) => {
    const [a, b] = p.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}
const covers = (ranges, c) => ranges.some(([a, b]) => c >= a && c <= b);

test('@font-face：只有四个字族（不要 Geist Mono），全部 font-display: swap，文件都在 static/fonts/', () => {
  const list = faces();
  assert.ok(list.length > 10);
  assert.deepEqual([...new Set(list.map((f) => f.family))].sort(), ['Geist', 'Instrument Serif', 'Noto Serif SC', 'P2 Figure One']);
  for (const f of list) {
    assert.equal(f.display, 'swap', `${f.file}`);
    assert.match(f.file, /^\.\.\/\.\.\/static\/fonts\/[a-z0-9-]+\.woff2$/);
    assert.ok(existsSync(path.join(APP, 'src/styles', f.file)), `${f.file} 不存在`);
    // 思源宋体的分片、P2 Figure One 必须写 unicode-range；预加载的拉丁字体（一定会下载）不写，省首屏 CSS
    if (f.family === 'Noto Serif SC' || f.family === 'P2 Figure One') assert.ok(f.range, `${f.file} 要写 unicode-range`);
    else assert.equal(f.range, undefined, `${f.file} 是预加载的拉丁字体，不用写 unicode-range`);
  }
  assert.ok(list.filter((f) => f.family === 'Noto Serif SC').every((f) => f.weight === '600' && f.style === 'normal'), '思源宋体只要 600');
  assert.deepEqual(list.filter((f) => f.family === 'Instrument Serif').map((f) => f.style).sort(), ['italic', 'normal']);
  assert.equal(list.find((f) => f.family === 'Geist').weight, '100 900', 'Geist 是可变字重');
  assert.ok(!/Geist Mono/.test(css));
});

test('P2 Figure One：只接管「1」和「₫」（U+31、U+20AB），size-adjust 92%；正体 + 斜体（按 Instrument Serif 斜体的角度斜切）', () => {
  const one = faces().filter((f) => f.family === 'P2 Figure One');
  assert.deepEqual(one.map((f) => f.style).sort(), ['italic', 'normal']);
  for (const f of one) {
    assert.equal(f.range, 'U+31,U+20AB', `${f.file}：越南盾符号「₫」也由它接管（Instrument Serif、Geist 都没有 ₫，否则回退到粗的宋体 600）`);
    assert.equal(f.sizeAdjust, '92%');
    assert.equal(f.weight, '400');
  }
  const italic = manifest.faces.find((f) => f.family === 'P2 Figure One' && f.style === 'italic');
  assert.equal(italic.slant, 13, '斜切角度和 Instrument Serif 斜体一样（13°）');
  assert.equal(italic.preload, false, '斜体用到时才下载');
});

test('思源宋体分片：互不重叠、合起来就是整个子集；每个字按“后声明先匹配”找到的第一片就是它所在的那片（不会白下载）', () => {
  const list = faces();
  const noto = list.filter((f) => f.family === 'Noto Serif SC');
  const byFile = new Map(manifest.faces.map((f) => [f.file, f]));
  const owner = new Map();
  let total = 0;
  for (const f of noto) {
    const m = byFile.get(path.basename(f.file));
    assert.ok(m, `fonts.json 里没有 ${f.file}`);
    assert.equal(m.unicodeRange, f.range, `${f.file} 的 unicode-range 和清单一致`);
    for (const [a, b] of parseRanges(m.owns)) {
      for (let c = a; c <= b; c++) {
        assert.ok(!owner.has(c), `U+${c.toString(16)} 同时在 ${owner.get(c)} 和 ${m.file}`);
        owner.set(c, m.file);
        total += 1;
      }
    }
  }
  assert.equal(total, manifest.notoSerifSC.codepoints, '分片合起来 = 整个子集');
  // 浏览器按声明的倒序检查 unicode-range：第一个覆盖这个字的面必须就是它所在的那片
  const reversed = [...noto].reverse().map((f) => ({ file: path.basename(f.file), ranges: parseRanges(f.range) }));
  for (const [c, file] of owner) {
    const first = reversed.find((f) => covers(f.ranges, c));
    assert.equal(first?.file, file, `U+${c.toString(16)}`);
  }
  // 常用字：通用规范一级字表全在里面
  const tgh = readFileSync(path.join(APP, 'scripts/fonts/data/tgh-level1-3500.txt'), 'utf8').trim();
  for (const ch of tgh) assert.ok(owner.has(ch.codePointAt(0)), `一级字「${ch}」不在子集里`);
  // 界面上常见的标点和符号
  for (const ch of '，。、：；？！“”（）《》·—…・−') assert.ok(owner.has(ch.codePointAt(0)), `「${ch}」不在子集里`);
});

test('分片够小：每片不超过 40 KB；字体文件和 fonts.json 一一对应（没有多余的旧文件）', () => {
  for (const f of manifest.faces.filter((x) => x.family === 'Noto Serif SC')) assert.ok(f.bytes < 40 * 1024, `${f.file} ${f.bytes}`);
  const onDisk = readdirSync(FONTS_DIR).filter((n) => n.endsWith('.woff2')).sort();
  assert.deepEqual(onDisk, manifest.faces.map((f) => f.file).sort());
});

test('预加载：Instrument Serif 正体、Geist、P2 Figure One 正体；名字和 esbuild 打包出来的一致；斜体（只给倒计时用）和宋体分片不预加载', async () => {
  const sources = preloadSources().map((p) => path.basename(p)).sort();
  assert.deepEqual(sources, ['geist.woff2', 'instrument-serif-400.woff2', 'p2-figure-one.woff2']);
  const hrefs = fontPreloadHrefs('assets');
  assert.equal(hrefs.length, 3);
  // 用真正的 CSS 打包流程打一遍 fonts.css，预加载的文件名必须在产物里
  const out = await buildCss({ dev: false, outdir: path.join(APP, '.font-test-out', 'assets'), files: [CSS_FILE] });
  const emitted = new Set(out.files.filter((f) => f.kind === 'asset').map((f) => `assets/${path.basename(f.path)}`));
  for (const h of hrefs) assert.ok(emitted.has(h), `预加载的 ${h} 不在打包产物里`);
  const html = renderHtml({ cssHref: 'assets/app-X.css', jsHref: 'assets/main-X.js', version: 't' });
  for (const h of hrefs) {
    assert.ok(html.includes(`<link rel="preload" href="${h}" as="font" type="font/woff2" crossorigin>`), `index.html 预加载 ${h}`);
  }
  assert.doesNotMatch(html, /preload" href="assets\/noto-serif-sc/, '宋体分片不预加载');
  assert.doesNotMatch(html, /preload" href="assets\/[a-z0-9-]*italic/, '斜体不预加载');
  assert.ok(html.indexOf('rel="preload"') < html.indexOf('rel="stylesheet"'), '预加载写在样式表前面');
});

test('授权：三套字体的 OFL 1.1 原文随字体一起放在 static/fonts/licenses/', () => {
  const dir = path.join(FONTS_DIR, 'licenses');
  for (const f of ['Noto-Serif-SC-OFL.txt', 'Instrument-Serif-OFL.txt', 'Geist-OFL.txt']) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/, f);
  }
  assert.ok(existsSync(path.join(FONTS_DIR, 'README.md')));
});

test('字体角色变量：宋体 / 大号数字 / 斜体数字 / 标签；正体、斜体数字都先走 P2 Figure One；全站不假粗', () => {
  const t = loadTokens();
  assert.match(t.light['--font-serif'], /^"Noto Serif SC"/);
  assert.match(t.light['--font-figure'], /^"P2 Figure One", "Instrument Serif"/);
  assert.match(t.light['--font-figure-italic'], /^"P2 Figure One", "Instrument Serif"/);
  assert.match(t.light['--font-label'], /^"Geist"/);
  assert.equal(t.light['--font-display'], 'var(--font-serif)');
  const base = readFileSync(path.join(APP, 'src/styles/base.css'), 'utf8');
  assert.match(base, /font-synthesis: none;/);
  assert.match(base, /@import "\.\/fonts\.css";/);
});
