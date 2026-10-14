// ui/ 里的纯逻辑：可变形图标的几何、滚动意图（顶栏收成胶囊）、数字滚动的逐位比较

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MORPHS, MORPH_KINDS, morphFrame, interpolateShape, shapePath } from '../../src/ui/morph-shapes.js';
import { createScrollIntent } from '../../src/ui/scroll-intent.js';
import { rollDiff, rollDirection, slotRank } from '../../src/ui/roll-diff.js';

const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

test('可变形图标：六种都在；两端形状数量一一对应；每个形状 4 个点', () => {
  assert.deepEqual(MORPH_KINDS, ['menu', 'plus', 'play', 'view', 'chevron', 'check']);
  for (const kind of MORPH_KINDS) {
    const def = MORPHS[kind];
    assert.equal(def.label.length, 2, `${kind} 两个状态的中文名`);
    assert.ok(['snappy', 'bouncy', 'smooth'].includes(def.spring));
    if (def.special) continue;
    assert.equal(def.a.length, def.b.length, kind);
    for (const s of [...def.a, ...def.b]) assert.equal(s.pts.length, 4);
  }
  assert.throws(() => morphFrame('star', 0), /没有 star/);
});

test('可变形图标：p=0 / p=1 就是两端的样子；路径坐标都在 24×24 画布内', () => {
  for (const kind of MORPH_KINDS.filter((k) => !MORPHS[k].special)) {
    const def = MORPHS[kind];
    for (const [p, shapes] of [[0, def.a], [1, def.b]]) {
      const frame = morphFrame(kind, p);
      frame.forEach((f, i) => {
        assert.equal(f.d, shapePath(shapes[i]), `${kind} p=${p} 形状 ${i}`);
        for (const v of nums(f.d)) assert.ok(v >= 0 && v <= 24, `${kind} 坐标 ${v} 在画布内`);
      });
    }
  }
  // 圆圈 ↔ 对勾：描线进度夹在 0–1
  assert.deepEqual(morphFrame('check', 0.4), { circle: true, draw: 0.4 });
  assert.deepEqual(morphFrame('check', 1.05), { circle: true, draw: 1 });
});

test('向下 ↔ 向上的箭头：两端和 lucide 的 chevron-down / chevron-up 一致；整组旋转，半路是朝左的箭头（不压扁成横线）', () => {
  const ends = (p) => morphFrame('chevron', p).map((f) => nums(f.d));
  // 每段是退化的四边形：前两个点就是线段两端
  const seg = (pts) => [[pts[0], pts[1]], [pts[2], pts[3]]];
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  const down = ends(0);
  assert.ok(close(seg(down[0]).flat(), [6, 9, 12, 15]), `左段 ${down[0]}`);
  assert.ok(close(seg(down[1]).flat(), [12, 15, 18, 9]), `右段 ${down[1]}`);
  const up = ends(1);
  // 转过 180° 后两段互换了位置：按线段的集合比较（和 lucide chevron-up：m18 15-6-6-6 6 一致）
  const key = (pts) => seg(pts).map((p) => p.map((v) => Math.round(v * 100) / 100).join(',')).sort().join('|');
  assert.deepEqual(up.map(key).sort(), [[6, 15, 12, 9], [12, 9, 18, 15]].map(key).sort());
  // 半路：整组转了 90°，是一个朝左的箭头“<”（两段长度不变，不是一条横线）
  const half = ends(0.5);
  assert.ok(close(seg(half[0]).flat(), [15, 6, 9, 12]), `半路左段 ${half[0]}`);
  assert.ok(close(seg(half[1]).flat(), [9, 12, 15, 18]), `半路右段 ${half[1]}`);
  for (const pts of half) assert.ok(Math.abs(Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) - 8.49) < 0.02, '长度不变');
});

test('三横线 → ×：前 45% 三条线向中间收拢（不转，中间那条淡出），后 55% 再旋转——中途不会像“>”', () => {
  const def = MORPHS.menu;
  const at = (i, p) => interpolateShape(def.a[i], def.b[i], p, def.phases);
  // 12%：还是三条水平线，只是往中间靠了
  for (const i of [0, 2]) assert.equal(at(i, 0.12).a, 0, '收拢阶段不旋转');
  assert.ok(at(0, 0.12).cy > 6 && at(0, 0.12).cy < 12);
  // 45%：上下两条已经并到中间，中间那条已经看不见，还没开始转
  assert.equal(at(0, 0.45).cy, 12);
  assert.equal(at(1, 0.45).op, 0);
  assert.equal(at(0, 0.45).a, 0);
  // 之后才转：72.5% 时转了一半（±22.5°）
  assert.ok(Math.abs(at(0, 0.725).a - 22.5) < 1e-9);
  assert.ok(Math.abs(at(2, 0.725).a + 22.5) < 1e-9);
  // 线的长度在旋转过程中基本不变
  const len = (s) => Math.hypot(s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]);
  assert.ok(Math.abs(len(at(0, 0.725)) - len(def.a[0])) < 1);
  // 弹簧过冲：p 略大于 1 时多转一点（回弹感），位置不会冲过中线，不透明度夹在 0–1
  assert.ok(at(0, 1.05).a > 45);
  assert.equal(at(0, 1.05).cy, 12);
  assert.equal(at(1, 1.05).op, 0);
  // 收回（× → 三横线）时同样是两段：先转回水平，再散开
  assert.equal(at(0, 0.6).cy, 12);
});

test('摇头（提交失败）：峰值约 8 / 4 / 2 / 1px、三次看得见的摆动、约 0.45 秒停稳——不是往一边磕一下', async () => {
  const { springMotion } = await import('../../src/motion/physics.js');
  const { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } = await import('../../src/ui/shake.js');
  const m = springMotion(SHAKE_SPRING, { from: 0, to: 0, velocity: SHAKE_VELOCITY, precision: SHAKE_PRECISION });
  const peaks = [];
  let prev = 0;
  let prevV = SHAKE_VELOCITY;
  for (let t = 0.0005; t < 1; t += 0.0005) {
    const v = m.velocity(t);
    if (Math.sign(v) !== Math.sign(prevV) && prevV !== 0) peaks.push(m.position(t));
    prev = m.position(t);
    prevV = v;
  }
  assert.ok(prev !== undefined);
  const mags = peaks.map(Math.abs);
  assert.ok(peaks[0] < 0, '先往左');
  assert.ok(Math.abs(mags[0] - 8) < 1, `第一摆约 8px（${mags[0].toFixed(2)}）`);
  assert.ok(Math.abs(mags[1] - 4) < 1, `第二摆约 4px（${mags[1].toFixed(2)}）`);
  assert.ok(Math.abs(mags[2] - 2) < 0.8, `第三摆约 2px（${mags[2].toFixed(2)}）`);
  assert.ok(mags.filter((x) => x >= 1.5).length >= 3, '至少三次看得见的摆动');
  assert.ok(m.settle < 0.6 && m.settle > 0.3, `约 0.45 秒停稳（${m.settle.toFixed(3)}s）`);
});

test('播放 → 暂停：三角形两半拼起来没有缝（切在同一条竖线上），两端都是实心', () => {
  const [left, right] = MORPHS.play.a;
  assert.deepEqual(left.pts[1], right.pts[0]);
  assert.deepEqual(left.pts[2], right.pts[3]);
  for (const s of [...MORPHS.play.a, ...MORPHS.play.b]) assert.equal(s.fill, 1);
});

test('滚动意图：往下滚过阈值收成胶囊，往上要有意滑一段才展开；回到顶部永远展开；到底回弹不算往上', () => {
  const it = createScrollIntent({ threshold: 56, down: 10, up: 24 });
  assert.equal(it.update(0, 1000), 'bar');
  assert.equal(it.update(30, 1000), 'bar', '还在顶部区域内');
  assert.equal(it.update(50, 1000), 'bar');
  assert.equal(it.update(80, 1000), 'pill', '离开顶部并往下滚了 ≥10px');
  assert.equal(it.update(70, 1000), 'pill', '往上 10px：手指抖一下，不展开');
  assert.equal(it.update(60, 1000), 'pill');
  assert.equal(it.update(50, 1000), 'bar', '往上累计 30px：展开');
  assert.equal(it.update(70, 1000), 'pill');
  // 方向一变累计清零
  assert.equal(it.update(60, 1000), 'pill');
  assert.equal(it.update(80, 1000), 'pill');
  assert.equal(it.update(65, 1000), 'pill', '上一段往上只有 10，又往下，再往上 15：都不够');
  // 到底部的橡皮筋回弹（位置先超过最大值再回来）：夹住后不算往上滚
  assert.equal(it.update(1000, 1000), 'pill');
  assert.equal(it.update(1060, 1000), 'pill');
  assert.equal(it.update(1000, 1000), 'pill');
  // 回到顶部
  assert.equal(it.update(2, 1000), 'bar');
  // 强制展开（点胶囊）
  it.update(300, 1000);
  it.update(400, 1000);
  assert.equal(it.state, 'pill');
  assert.equal(it.forceBar(), 'bar');
  assert.equal(it.update(395, 1000), 'bar');
  assert.equal(it.update(420, 1000), 'pill', '再往下滚又收起');
});

test('数字滚动：按分位对齐比较（lib/number.js 的 numberSlots），只滚变了的位；位数变化时那一位长出 / 收掉', () => {
  assert.deepEqual(rollDiff('10', '11').map((d) => d.kind), ['same', 'change']);
  assert.deepEqual(rollDiff('9', '10'), [
    { kind: 'enter', from: null, to: '1', key: 'i1' },
    { kind: 'change', from: '9', to: '0', key: 'i0' },
  ]);
  assert.deepEqual(rollDiff('100', '99').map((d) => d.kind), ['exit', 'change', 'change']);
  // 999 → 1,000：千位和千分位逗号是新长出来的两列，原来三列原地滚
  assert.deepEqual(rollDiff('999', '1,000').map((d) => `${d.key}:${d.kind}`), ['i3:enter', 'g3:enter', 'i2:change', 'i1:change', 'i0:change']);
  // 1,250,000₫ → 1,335,000₫：只有万、十万、百万后面那三位在变
  assert.deepEqual(rollDiff('1,250,000₫', '1,335,000₫').map((d) => d.kind), ['same', 'same', 'change', 'change', 'change', 'same', 'same', 'same', 'same', 'same']);
  // 小数位数变了：个位还是对着个位（按位置右对齐会把 5 和 2 对上）
  assert.deepEqual(rollDiff('HK$12.5', 'HK$12').map((d) => `${d.key}:${d.kind}`), ['p0:same', 'p1:same', 'p2:same', 'i1:same', 'i0:same', 'dp:exit', 'f1:exit']);
  // 正负号、前后缀
  assert.deepEqual(rollDiff('−400₫', '400₫').map((d) => `${d.key}:${d.kind}`), ['sign:exit', 'i2:same', 'i1:same', 'i0:same', 's0:same']);
  assert.deepEqual(rollDiff('', '5').map((d) => d.kind), ['enter']);
  assert.ok(slotRank('i3') < slotRank('g3') && slotRank('g3') < slotRank('i2') && slotRank('i0') < slotRank('dp') && slotRank('dp') < slotRank('f1'));
  assert.equal(rollDirection(1, 2), 1);
  assert.equal(rollDirection(2, 1), -1);
  assert.equal(rollDirection('a', 'b'), 1);
});
