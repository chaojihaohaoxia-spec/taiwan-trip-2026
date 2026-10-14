// 动效原语的纯逻辑（motion/physics.js、flip.js、morph.js、press.js 里不碰 DOM 的部分）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRINGS, SPRING_NAMES, solveSpring } from '../../src/motion/springs.js';
import {
  resolveSpring, springMotion, springGroup, sampleFrames, rubberBand, projectMomentum, VelocityTracker,
  cubicBezier, parseCubicBezier, num, clamp, lerp,
} from '../../src/motion/physics.js';
import { invertFor, flipRenderer } from '../../src/motion/flip.js';
import { clipMorphStart, clipMorphEnd, transformMorphStart, coverRadius } from '../../src/motion/morph.js';
import { autoPressScale } from '../../src/motion/press.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('resolveSpring：名字 → 参数；参数原样；不合法抛错', () => {
  for (const n of SPRING_NAMES) assert.deepEqual(resolveSpring(n), SPRINGS[n]);
  const custom = { duration: 0.5, bounce: 0.2 };
  assert.equal(resolveSpring(custom), custom);
  assert.throws(() => resolveSpring('wobbly'), /没有名为/);
  assert.throws(() => resolveSpring({ duration: 0, bounce: 0 }), RangeError);
  assert.throws(() => resolveSpring({ duration: 0.3, bounce: 1 }), RangeError);
});

test('springMotion 0→1 和 springs.js 的 solveSpring 是同一条曲线（含初速度）', () => {
  for (const n of SPRING_NAMES) {
    for (const v of [0, 3, -2]) {
      const a = springMotion(n, { from: 0, to: 1, velocity: v });
      const b = solveSpring(SPRINGS[n], v);
      for (const t of [0.01, 0.05, 0.1, 0.2, 0.3]) {
        assert.ok(close(a.position(t), b.position(t), 1e-9), `${n} v=${v} t=${t}`);
        assert.ok(close(a.velocity(t), b.velocity(t), 1e-9), `${n} 速度 v=${v} t=${t}`);
      }
    }
  }
});

test('springMotion：任意单位、起点终点、初速度；速度是位置的导数；停稳后正好在终点', () => {
  const m = springMotion('bouncy', { from: 120, to: -40, velocity: 900 });
  assert.equal(m.position(0), 120);
  assert.equal(m.velocity(0), 900);
  const dt = 1e-5;
  for (const t of [0.03, 0.12, 0.25]) {
    const numeric = (m.position(t + dt) - m.position(t - dt)) / (2 * dt);
    assert.ok(Math.abs(numeric - m.velocity(t)) < 1e-2, `t=${t}`);
  }
  assert.equal(m.position(m.settle), -40);
  assert.equal(m.velocity(m.settle + 1), 0);
  assert.ok(Math.abs(m.position(m.settle - 0.005) + 40) < Math.abs(160) * 2e-3, '停稳前一刻已经非常接近终点');
  // 没有运动：停稳时间 0
  assert.equal(springMotion('snappy', { from: 5, to: 5 }).settle, 0);
  // 只有速度（起点 = 终点）：冲出去再回来
  const kick = springMotion('snappy', { from: 0, to: 0, velocity: -760 });
  assert.ok(kick.settle > 0.1);
  assert.ok(kick.position(0.03) < -5, '先被速度带出去');
  assert.equal(kick.position(kick.settle), 0);
});

test('打断接力：在半路换目标，用当前位置和速度起新弹簧——位置、速度都连续', () => {
  const a = springMotion('smooth', { from: 0, to: 300 });
  const t = 0.12;
  const pos = a.position(t);
  const vel = a.velocity(t);
  assert.ok(pos > 30 && pos < 270 && vel > 0);
  const b = springMotion('smooth', { from: pos, to: 0, velocity: vel });
  assert.equal(b.position(0), pos);
  assert.equal(b.velocity(0), vel);
  // 往回走之前，因为惯性还会先往前多走一点（真实物体的感觉）
  assert.ok(b.position(0.02) > pos, '惯性：先继续往前');
  assert.equal(b.position(b.settle), 0);
});

test('springGroup：每个通道可以用不同的弹簧，总时长取最长', () => {
  const g = springGroup({ l: 'smooth', r: 'snappy' }, { l: 0, r: 0 }, { l: 100, r: 100 });
  assert.deepEqual(g.keys, ['l', 'r']);
  assert.equal(g.duration, Math.max(g.motions.l.settle, g.motions.r.settle));
  const at = g.at(0.08);
  assert.ok(at.r > at.l, '前沿（snappy）比后沿（smooth）走得快——指示条被拉长');
  assert.deepEqual(g.to, { l: 100, r: 100 });
  // 缺省起点：等于终点（不动）
  const h = springGroup('snappy', {}, { x: 7 });
  assert.equal(h.duration, 0);
});

test('sampleFrames：首尾是 0 和 1、偏移递增、终点精确、简化后误差在容差内、帧数大幅减少', () => {
  const g = springGroup('bouncy', { x: 0, s: 0.9 }, { x: 300, s: 1 }, { x: 0, s: 0 });
  const frames = sampleFrames(g);
  assert.equal(frames[0].offset, 0);
  assert.equal(frames.at(-1).offset, 1);
  assert.deepEqual(frames.at(-1).values, { x: 300, s: 1 });
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset > frames[i - 1].offset);
  assert.ok(frames.length < 60, `帧数 ${frames.length}`);
  // 在任意时刻，相邻关键帧的线性插值和真实弹簧的差 < 0.6px（300px 的 0.2%）
  for (let k = 0; k <= 400; k++) {
    const p = k / 400;
    const t = p * g.duration;
    const i = frames.findIndex((f) => f.offset >= p);
    const a = frames[Math.max(0, i - 1)];
    const b = frames[i];
    const f = b.offset === a.offset ? 0 : (p - a.offset) / (b.offset - a.offset);
    const x = a.values.x + (b.values.x - a.values.x) * f;
    assert.ok(Math.abs(x - g.at(t).x) < 0.6, `p=${p}`);
  }
  // 没有运动：两帧
  const still = sampleFrames(springGroup('smooth', { x: 1 }, { x: 1 }));
  assert.equal(still.length, 2);
});

test('橡皮筋：范围内不变；超出越拉越费劲，永远不超过参考尺寸', () => {
  assert.equal(rubberBand(50, 0, 100, 100), 50);
  const a = rubberBand(150, 0, 100, 100);
  const b = rubberBand(300, 0, 100, 100);
  assert.ok(a > 100 && a < 150);
  assert.ok(b > a && b < 200, '单调，但有上限');
  assert.ok(rubberBand(-50, 0, 100, 100) < 0 && rubberBand(-50, 0, 100, 100) > -50);
});

test('惯性投射与手指速度估计', () => {
  assert.ok(close(projectMomentum(1000, 0.99), 99, 1e-9));
  assert.ok(close(projectMomentum(-1000, 0.998), -499, 1e-9));
  const tr = new VelocityTracker();
  for (let t = 0; t <= 120; t += 8) tr.add(t * 0.5, t); // 0.5 px/ms = 500 px/s
  assert.ok(Math.abs(tr.velocity(120) - 500) < 1);
  assert.equal(tr.velocity(400), 0, '手指停住很久再松手：速度 0');
  tr.reset();
  assert.equal(tr.velocity(), 0);
});

test('三次贝塞尔：端点、线性、标准 ease 的已知值；解析 CSS 写法', () => {
  const linear = cubicBezier(0, 0, 1, 1);
  for (const t of [0, 0.25, 0.5, 1]) assert.ok(close(linear(t), t, 1e-5));
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.ok(close(ease(0.5), 0.8024, 2e-3));
  const out = parseCubicBezier('cubic-bezier(0.16, 1, 0.3, 1)');
  assert.ok(out(0.3) > 0.8, '缓出：前段变化大');
  assert.equal(out(0), 0);
  assert.equal(out(1), 1);
  assert.equal(parseCubicBezier('ease')(0.4), 0.4, '不认识的写法按线性');
  assert.equal(num(-0.0001), '0');
  assert.equal(num(1.23456), '1.235');
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(lerp(2, 4, 0.5), 3);
});

test('FLIP 反算：只移动 → 平移；尺寸变了 → 平移 + 缩放；图片 → 等比 + 裁切；没变 → null', () => {
  const L = { left: 100, top: 200, width: 200, height: 100 };
  assert.equal(invertFor('auto', L, L), null);
  const moved = invertFor('auto', { ...L, left: 40, top: 260 }, L);
  assert.deepEqual(moved, { mode: 'position', from: { x: -60, y: 60 }, to: { x: 0, y: 0 } });
  const box = invertFor('auto', { left: 0, top: 0, width: 400, height: 50 }, L, { firstRadius: 4, lastRadius: 20 });
  assert.equal(box.mode, 'box');
  assert.deepEqual(box.from, { x: -100, y: -200, sx: 2, sy: 0.5, r: 4 });
  assert.deepEqual(box.to, { x: 0, y: 0, sx: 1, sy: 1, r: 20 });
  // crop：64×64 的缩略图 → 200×100 的大图
  const F = { left: 10, top: 20, width: 64, height: 64 };
  const c = invertFor('crop', F, L, { firstRadius: 12, lastRadius: 16 });
  assert.equal(c.mode, 'crop');
  const { x, y, s, ix, iy } = c.from;
  // 露出来的部分（缩放后）正好盖住旧框：左上角、宽高都对得上
  assert.ok(close(L.left + x + s * ix, F.left, 1e-9));
  assert.ok(close(L.top + y + s * iy, F.top, 1e-9));
  assert.ok(close(s * (L.width - 2 * ix), F.width, 1e-9));
  assert.ok(close(s * (L.height - 2 * iy), F.height, 1e-9));
  // 渲染：圆角按缩放反向修正
  const css = flipRenderer('box')({ x: 1, y: 2, sx: 2, sy: 0.5, r: 10 });
  assert.equal(css.transform, 'translate(1px, 2px) scale(2, 0.5)');
  assert.equal(css.borderRadius, '5px / 20px');
  assert.match(flipRenderer('crop')({ x: 0, y: 0, s: 0.5, ix: 3, iy: 4, r: 10 }).clipPath, /^inset\(4px 3px 4px 3px round 20px\)$/);
});

test('形变（clip）：起点露出的区域和源元素重合、在目标里离源最近的位置；终点完全展开', () => {
  const T = { left: 50, top: 100, width: 300, height: 200, radius: 28 };
  const S = { left: 330, top: 330, width: 56, height: 56, radius: 28 }; // 面板右下方的悬浮按钮
  const st = clipMorphStart(T, S);
  // 露出的区域（目标局部坐标）平移后，中心正好在源的中心
  const rw = T.width - st.l - st.r;
  const rh = T.height - st.t - st.b;
  assert.ok(close(rw, 56) && close(rh, 56));
  assert.ok(close(T.left + st.x + st.l + rw / 2, S.left + 28));
  assert.ok(close(T.top + st.y + st.t + rh / 2, S.top + 28));
  // 选在目标的右下角（离按钮最近）
  assert.ok(close(st.r, 0) && close(st.b, 0));
  assert.equal(st.rad, 28);
  assert.deepEqual(clipMorphEnd(T), { x: 0, y: 0, t: -0, r: -0, b: -0, l: -0, rad: 28 });
  assert.deepEqual(clipMorphEnd(T, 20), { x: 0, y: 0, t: -20, r: -20, b: -20, l: -20, rad: 48 });
  // transform 方式
  assert.deepEqual(transformMorphStart(T, S), { x: 280, y: 230, sx: 56 / 300, sy: 56 / 200, rad: 28 });
  // 圆形扩散的半径：到最远的角
  assert.ok(close(coverRadius(0, 0, 300, 400), 500));
  assert.ok(close(coverRadius(150, 200, 300, 400), 250));
});

test('按压缩放：小元素 0.96，大元素缩小量不超过 12px', () => {
  assert.equal(autoPressScale(44, 44), 0.96);
  assert.equal(autoPressScale(120, 44), 0.96);
  assert.equal(autoPressScale(358, 120), 0.966);
  assert.equal(autoPressScale(1000, 300), 0.988);
  assert.equal(autoPressScale(0, 0), 0.96);
});
