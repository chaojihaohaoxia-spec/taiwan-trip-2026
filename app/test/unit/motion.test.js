// 弹簧（motion/springs.js）、形变跟着形状走的规则（motion/morph-shape.js）和滚动记忆（router/scroll.js）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRINGS, SPRING_NAMES, solveSpring, springToLinear, spring, SPRING_FALLBACKS } from '../../src/motion/springs.js';
import { tokensInSync } from '../../scripts/tokens.mjs';
import { createScrollMemory } from '../../src/router/scroll.js';
import { shapeProgress, morphTintAt, morphContentAt, MORPH_TINT_RANGE, MORPH_CONTENT_RANGE } from '../../src/motion/morph-shape.js';
import { memoryStorage } from './helpers/fake-window.js';
import { loadTokens } from './helpers/tokens.js';

test('三条弹簧的名字固定：snappy / bouncy / smooth', () => {
  assert.deepEqual(SPRING_NAMES, ['snappy', 'bouncy', 'smooth']);
  assert.deepEqual(Object.keys(SPRING_FALLBACKS), SPRING_NAMES);
});

test('弹簧解析解：起点 0、终点 1、初速度、停稳', () => {
  for (const name of SPRING_NAMES) {
    const s = solveSpring(SPRINGS[name]);
    assert.equal(s.position(0), 0);
    assert.ok(Math.abs(s.position(s.settleTime) - 1) < 0.001, `${name} 停稳时应接近 1`);
    assert.ok(Math.abs(s.position(5) - 1) < 1e-6);
    assert.ok(s.settleTime > SPRINGS[name].duration, '停稳时间比感知时长长');
  }
  const withVelocity = solveSpring(SPRINGS.snappy, 4);
  assert.ok(Math.abs(withVelocity.velocity(0) - 4) < 1e-9, '初速度接得上（手势松手）');
  const dt = 1e-5;
  const numeric = (withVelocity.position(0.05 + dt) - withVelocity.position(0.05 - dt)) / (2 * dt);
  assert.ok(Math.abs(numeric - withVelocity.velocity(0.05)) < 1e-3, '速度是位置的导数');
  assert.throws(() => solveSpring({ duration: 0.3, bounce: 1 }), /bounce/);
  assert.throws(() => solveSpring({ duration: 0, bounce: 0 }), /duration/);
});

test('smooth 不过冲，bouncy 过冲比 snappy 大', () => {
  const o = Object.fromEntries(SPRING_NAMES.map((n) => [n, springToLinear(SPRINGS[n]).overshoot]));
  assert.equal(o.smooth, 0);
  assert.ok(o.bouncy > o.snappy && o.snappy > 0);
  assert.ok(o.bouncy < 0.1, '回弹克制，不超过 10%');
});

test('linear() 输出：以 0 开头、1 结尾、百分比递增、点数适中', () => {
  for (const name of SPRING_NAMES) {
    const { easing, durationMs } = springToLinear(SPRINGS[name]);
    assert.match(easing, /^linear\(0, .+, 1\)$/);
    const pcts = [...easing.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]));
    for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] > pcts[i - 1], `${name} 百分比要递增`);
    assert.ok(pcts.length >= 8 && pcts.length <= 60, `${name} 点数 ${pcts.length}`);
    assert.equal(durationMs % 10, 0);
    assert.deepEqual(spring(name), { easing: SPRING_FALLBACKS[name], duration: durationMs }, 'Node 里没有 CSS.supports，用近似贝塞尔');
  }
  assert.throws(() => spring('wobbly'), /没有名为/);
});

test('tokens.css 的弹簧曲线和 springs.js 同步（不同步就运行 npm run tokens）', () => {
  assert.ok(tokensInSync());
  const t = loadTokens();
  for (const name of SPRING_NAMES) {
    const { easing, durationMs } = springToLinear(SPRINGS[name]);
    assert.equal(t.light[`--spring-${name}`], easing);
    assert.equal(t.light[`--spring-${name}-duration`], `${durationMs}ms`);
  }
});

test('滚动记忆：按条目和路径分别记，超出上限丢最旧的，能持久化', () => {
  const storage = memoryStorage();
  const mem = createScrollMemory(storage);
  mem.save('k1', '/trips', 120.4);
  mem.save('k2', '/settings', -5);
  assert.equal(mem.forEntry('k1'), 120);
  assert.equal(mem.forEntry('k2'), 0);
  assert.equal(mem.forPath('/trips'), 120);
  assert.equal(mem.forEntry('nope'), undefined);
  for (let i = 0; i < 200; i++) mem.save(`x${i}`, `/p${i}`, i);
  assert.equal(mem.forEntry('k1'), undefined, '旧条目被挤掉');
  assert.equal(mem.forEntry('x199'), 199);
  mem.persist();
  const again = createScrollMemory(storage);
  assert.equal(again.forEntry('x199'), 199);
  assert.equal(again.forPath('/p199'), 199);
  const broken = createScrollMemory({ getJSON: () => ({ e: 'bad' }), setJSON: () => false });
  assert.equal(broken.forEntry('a'), undefined, '存储里是坏数据也不出错');
});

test('不支持 linear() 时的近似贝塞尔：贴着真实弹簧（均方误差 < 3.5%，最大过冲差不到 1 个百分点），tokens.css 里写的一样', async () => {
  const { cubicBezier, parseCubicBezier } = await import('../../src/motion/physics.js');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
  const block = /@supports not \(transition-timing-function: linear\(0, 1\)\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  for (const name of SPRING_NAMES) {
    assert.ok(block.includes(`--spring-${name}: ${SPRING_FALLBACKS[name]};`), `tokens.css 的 ${name} 和 SPRING_FALLBACKS 一致`);
    const solved = solveSpring(SPRINGS[name]);
    const T = springToLinear(SPRINGS[name]).durationMs / 1000;
    const ease = parseCubicBezier(SPRING_FALLBACKS[name]);
    let sq = 0;
    let overTrue = 0;
    let overFit = 0;
    const n = 400;
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const truth = solved.position(p * T);
      const fit = ease(p);
      sq += (fit - truth) ** 2;
      overTrue = Math.max(overTrue, truth - 1);
      overFit = Math.max(overFit, fit - 1);
    }
    const rms = Math.sqrt(sq / (n + 1));
    assert.ok(rms < 0.035, `${name} 均方误差 ${(rms * 100).toFixed(1)}%`);
    assert.ok(Math.abs(overFit - overTrue) < 0.01, `${name} 过冲 ${(overFit * 100).toFixed(1)}% vs 弹簧 ${(overTrue * 100).toFixed(1)}%`);
  }
  assert.ok(typeof cubicBezier === 'function');
});

test('动效评审 #6：按钮长成面板时，色层和内容跟着“形状此刻有多大”走——按钮大小时完全是按钮的颜色，整块时完全是内容；中间没有又白又空的一段', () => {
  const size = { width: 358, height: 301 };
  const anchor = { width: 56, height: 56 };
  // 和按钮一样大（裁切 = 面板减按钮）→ 0；整块（不裁）→ 1；弹簧过冲（负的裁切）夹在 1
  const cut = (f) => {
    const w = anchor.width + (size.width - anchor.width) * f;
    const h = anchor.height + (size.height - anchor.height) * f;
    return { t: size.height - h, r: 0, b: 0, l: size.width - w };
  };
  const clipProgress = shapeProgress('clip', size, anchor);
  assert.equal(clipProgress(cut(0)), 0);
  assert.equal(clipProgress(cut(1)), 1);
  assert.ok(Math.abs(clipProgress(cut(0.37)) - 0.37) < 1e-9);
  assert.equal(clipProgress({ t: -9.5, r: -3, b: 0, l: -9 }), 1, '过冲不超过 1');
  // 面板和按钮一样宽（只在高度上长）：那个方向不算，进度不会除以 0
  assert.equal(shapeProgress('clip', { width: 56, height: 200 }, anchor)({ t: 0, r: 0, b: 0, l: 0 }), 1);

  assert.equal(morphTintAt(0), 1, '按钮那么大：完全是按钮的颜色');
  assert.equal(morphTintAt(MORPH_TINT_RANGE[0]), 1);
  assert.equal(morphTintAt(MORPH_TINT_RANGE[1]), 0);
  assert.equal(morphTintAt(1), 0, '整块：色层看不见');
  assert.equal(morphContentAt(MORPH_CONTENT_RANGE[0]), 0, '还小的时候内容透明（文字不会挤在按钮大小的框里）');
  assert.equal(morphContentAt(1), 1);
  // 单调：形状越大，色层越淡、内容越浓
  let lastTint = 2;
  let lastContent = -1;
  let blank = 0;
  for (let f = 0; f <= 1.0001; f += 0.01) {
    const tint = morphTintAt(f);
    const content = morphContentAt(f);
    assert.ok(tint <= lastTint + 1e-12 && content >= lastContent - 1e-12, `f=${f.toFixed(2)} 单调`);
    lastTint = tint;
    lastContent = content;
    // 色层和内容都几乎看不见（一块空白）的区间
    if (tint < 0.1 && content < 0.1) blank += 0.01;
  }
  // 两段有重叠：几乎全空的只有一小段形状进度（收回时约 1 帧）
  assert.ok(MORPH_CONTENT_RANGE[0] < MORPH_TINT_RANGE[1], '内容出现之前色层还没褪完');
  assert.ok(blank <= 0.06, `几乎全空的形状进度区间：${blank.toFixed(2)}`);
  // transform 方式：按缩放比例算（一半大小 → 一半进度）
  const tp = shapeProgress('transform', { width: 300, height: 200 }, { width: 60, height: 40 });
  assert.equal(tp({ sx: 60 / 300, sy: 40 / 200 }), 0);
  assert.equal(tp({ sx: 1, sy: 1 }), 1);
  assert.ok(Math.abs(tp({ sx: 180 / 300, sy: 120 / 200 }) - 0.5) < 1e-9);
});

