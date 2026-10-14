// 底栏 · 液态玻璃的纯逻辑：拉伸（motion/liquid.js）、追手指的弹簧、拖动选择的格子换算、派生通道（physics.js 的 deriveGroup）、
// 滚动收小的规则（shell/scroll-state.js 的 createTabbarIntent）、底栏参数和规则（shell/tabbar-motion.js）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liquidStretch, followSpring, slotPosition, nearestSelectable, rubberClamp, LIQUID_STRETCH } from '../../src/motion/liquid.js';
import { springGroup, deriveGroup, sampleFrames } from '../../src/motion/physics.js';
import { createTabbarIntent, createTopbarIntent } from '../../src/shell/scroll-state.js';
import { TABBAR_MOTION, isSelectable, selectableRange, magnifyAt, SLOTS, lensSpring, lensEdge, plusFade } from '../../src/shell/tabbar-motion.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('拉伸：静止不变形；越快拉得越长、竖向越扁、往后拖，但不超过上限；方向只影响往哪边拖', () => {
  assert.deepEqual(liquidStretch(0), { sx: 1, sy: 1, shift: 0 });
  const slow = liquidStretch(2);
  const fast = liquidStretch(12);
  const huge = liquidStretch(1e6);
  assert.ok(slow.sx > 1 && fast.sx > slow.sx, '越快越长');
  assert.ok(fast.sy < slow.sy && slow.sy < 1, '竖向压扁');
  assert.ok(close(huge.sx, 1 + LIQUID_STRETCH.max, 1e-9), '最多拉长 max');
  assert.ok(close(huge.sy, 1 - LIQUID_STRETCH.max * LIQUID_STRETCH.squash, 1e-9));
  assert.ok(fast.shift < 0, '往右走时整体往左（后面）拖一点');
  const left = liquidStretch(-12);
  assert.equal(left.sx, fast.sx);
  assert.equal(left.shift, -fast.shift);
  // vRef：速度等于 vRef 时拉到上限的 63%
  assert.ok(close(liquidStretch(LIQUID_STRETCH.vRef).sx - 1, LIQUID_STRETCH.max * (1 - Math.exp(-1)), 1e-9));
});

test('派生通道（deriveGroup）：按速度算的拉伸跟着进关键帧，起点终点都不拉伸、中途拉伸；接力只认原来的通道', () => {
  const base = springGroup(TABBAR_MOTION.lens.spring, { x: 0 }, { x: 3 });
  const g = deriveGroup(base, (v, vel) => liquidStretch(vel.x, TABBAR_MOTION.lens.stretch), { sx: 0.22, sy: 0.1, shift: 0.07 });
  assert.deepEqual(g.keys, ['x', 'sx', 'sy', 'shift']);
  assert.equal(g.from.sx, 1);
  assert.equal(g.to.sx, 1);
  assert.equal(g.to.shift, 0);
  const frames = sampleFrames(g);
  const peak = Math.max(...frames.map((f) => f.values.sx));
  assert.ok(peak > 1.15 && peak <= 1.22 + 1e-9, `跨三格的峰值拉伸 ${peak}`);
  assert.equal(frames[frames.length - 1].values.sx, 1, '停下不拉伸');
  // 派生通道的速度是 0（接力时下一段动画只认 x 和它的速度）
  assert.equal(g.velocityAt(0.05).sx, 0);
  assert.ok(g.velocityAt(0.05).x > 0);
  // 回弹：位置先越过终点一点点再回来（bounce 0.24）
  const overshoot = Math.max(...frames.map((f) => f.values.x)) - 3;
  assert.ok(overshoot > 0.03 && overshoot < 0.2, `过冲 ${overshoot} 格`);
});

test('追手指的弹簧：追得上目标、几乎不过冲；dt 再大也只积分 50ms（切后台回来不会飞出去）', () => {
  const s = { x: 0, v: 0 };
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    followSpring(s, 2, 1 / 60, TABBAR_MOTION.follow);
    peak = Math.max(peak, s.x);
  }
  assert.ok(close(s.x, 2, 1e-3), `追到了：${s.x}`);
  assert.ok(peak < 2.06, `几乎不过冲：${peak}`);
  const t = { x: 0, v: 0 };
  followSpring(t, 2, 5);
  const u = { x: 0, v: 0 };
  followSpring(u, 2, 0.05);
  assert.deepEqual(t, u);
  // 开始追的那几帧速度最大：这就是拉伸的来源
  const w = { x: 0, v: 0 };
  followSpring(w, 3, 0.05, TABBAR_MOTION.follow);
  assert.ok(w.v > 5, `甩出去的速度 ${w.v} 格/秒`);
});

test('拖动选择的换算：手指 x → 第几格；最近的可选格（跳过 ＋）带迟滞——越过中线 0.12 格才换，停在中线上抖不来回跳；可选范围外橡皮筋收住', () => {
  const centers = [50, 120, 190, 260, 330];
  assert.equal(slotPosition(50, centers), 0);
  assert.equal(slotPosition(260, centers), 3);
  assert.ok(close(slotPosition(155, centers), 1.5));
  const sel = (i) => isSelectable(i, 'trip');
  // 没有当前高亮：直接取最近的
  assert.equal(nearestSelectable(0.4, 5, sel), 0);
  assert.equal(nearestSelectable(0.6, 5, sel), 1);
  // 迟滞：从 0 出发，过了中线还不到 0.12 格不换；过了 0.12 格才换（反过来也一样）
  assert.equal(nearestSelectable(0.55, 5, sel, 0), 0, '过了中线 0.05 格：还是行程');
  assert.equal(nearestSelectable(0.61, 5, sel, 0), 0);
  assert.equal(nearestSelectable(0.63, 5, sel, 0), 1, '过了中线 0.13 格：换到地图');
  assert.equal(nearestSelectable(0.45, 5, sel, 1), 1);
  assert.equal(nearestSelectable(0.37, 5, sel, 1), 0);
  // 停在中线附近抖（±0.01 格来回 30 次）：一次都不换
  for (const start of [0, 1]) {
    let h = start;
    let flips = 0;
    for (let k = 0; k < 30; k++) {
      const next = nearestSelectable(0.5 + (k % 2 ? 0.01 : -0.01), 5, sel, h);
      if (next !== h) flips += 1;
      h = next;
    }
    assert.equal(flips, 0, `从 ${start} 出发抖 30 次换了 ${flips} 次`);
  }
  // 隔着 ＋ 的两格：＋ 正中两侧 0.12 格以内都留在原来那格，过了才换
  assert.equal(nearestSelectable(2, 5, sel, 3), 3, '从账本拖到 ＋ 正中：还是账本');
  assert.equal(nearestSelectable(2, 5, sel, 1), 1, '从地图拖到 ＋ 正中：还是地图');
  assert.equal(nearestSelectable(1.9, 5, sel, 3), 3);
  assert.equal(nearestSelectable(1.85, 5, sel, 3), 1, '过了 ＋ 正中 0.15 格：地图');
  assert.equal(nearestSelectable(2.15, 5, sel, 1), 3);
  assert.equal(nearestSelectable(1.9, 5, sel), 1, '＋ 永远选不中');
  assert.equal(nearestSelectable(4, 5, sel), 3, '「更多」不是当前页时不能选');
  assert.equal(nearestSelectable(4, 5, sel, 3), 3);
  assert.equal(nearestSelectable(4, 5, (i) => isSelectable(i, 'more')), 4, '二级页面时「更多」能选');
  assert.equal(nearestSelectable(1, 5, () => false), -1);
  assert.equal(nearestSelectable(1, 5, () => false, 1), -1);
  assert.equal(rubberClamp(2, 0, 3), 2);
  const over = rubberClamp(4.5, 0, 3, 0.5);
  assert.ok(over > 3 && over < 3.5, `过了头被收住：${over}`);
  assert.ok(rubberClamp(-3, 0, 3, 0.5) > -0.5);
});

test('选中块的弹簧：跨一两格照常回弹 0.24（过冲 2.5%）；跨得越远回弹越小，静止出发的过冲不超过 0.05 格', () => {
  assert.deepEqual(lensSpring(1), TABBAR_MOTION.lens.spring);
  assert.ok(Math.abs(lensSpring(-2).bounce - TABBAR_MOTION.lens.spring.bounce) < 0.005, '跨两格几乎不变');
  assert.deepEqual(lensSpring(0), TABBAR_MOTION.lens.spring);
  for (const d of [1, 2, 3, 4]) {
    const sp = lensSpring(d);
    assert.ok(sp.bounce <= TABBAR_MOTION.lens.spring.bounce && sp.bounce > 0.15, `跨 ${d} 格回弹 ${sp.bounce}`);
    assert.equal(sp.duration, TABBAR_MOTION.lens.spring.duration, '感知时长不变');
    const frames = sampleFrames(springGroup(sp, { x: 0 }, { x: d }));
    const over = Math.max(...frames.map((f) => f.values.x)) - d;
    assert.ok(over > 0 && over <= TABBAR_MOTION.lens.maxOvershoot + 0.003, `跨 ${d} 格过冲 ${over.toFixed(4)} 格`);
  }
  assert.ok(lensSpring(4).bounce < lensSpring(3).bounce);
});

test('选中块不出底栏（lensEdge）：在中间不动；两头超出的部分按橡皮筋压成最多 0.06 格，越往外越难；拉长时也收得住', () => {
  const { min, max, give } = TABBAR_MOTION.lens.edge;
  assert.equal(lensEdge({ x: 1 }), 1);
  assert.equal(lensEdge({ x: 0 }), 0, '停在最左一格：边正好在 -0.5，不动');
  assert.equal(lensEdge({ x: 4 }), 4);
  let last = Infinity;
  for (const x of [-0.02, -0.05, -0.1, -0.3, -1]) {
    const c = lensEdge({ x });
    const left = c - 0.5;
    assert.ok(left < min && left > min - give, `x=${x}：左边 ${left}`);
    assert.ok(c <= last + 1e-12 && c > x, '越往外越难、往回挪');
    last = c;
  }
  // 拉长（sx 1.2）、往后拖（shift）也一样
  const c = lensEdge({ x: 0.05, sx: 1.2, shift: -0.06 });
  assert.ok(c - 0.6 >= min - give, `拉长时左边 ${c - 0.6}`);
  const r = lensEdge({ x: 4.2, sx: 1.1 });
  assert.ok(r + 0.55 <= max + give && r + 0.55 > max);
});

test('选中块从 ＋ 后面穿过时变淡（plusFade）：正中最淡 0.5，1.4 / 2.6 格以外不淡；派生通道跟着进关键帧（跨过 ＋ 的那一段折线简化也留得住）', () => {
  assert.equal(plusFade(1), 1);
  assert.equal(plusFade(3), 1);
  assert.equal(plusFade(1.4), 1);
  assert.ok(close(plusFade(2), TABBAR_MOTION.lens.plus.min));
  assert.ok(plusFade(1.7) > 0.5 && plusFade(1.7) < 1);
  const base = springGroup(lensSpring(3), { x: 0 }, { x: 3 });
  const g = deriveGroup(base, (v, vel) => ({ ...liquidStretch(vel.x, TABBAR_MOTION.lens.stretch), o: plusFade(v.x) }), { sx: 0.22, sy: 0.1, shift: 0.07, o: 0.5 });
  const frames = sampleFrames(g);
  const dip = Math.min(...frames.map((f) => f.values.o));
  assert.ok(dip < 0.55, `关键帧里留住了变淡：最淡 ${dip}`);
  assert.equal(frames[0].values.o, 1);
  assert.equal(frames[frames.length - 1].values.o, 1);
});

test('底栏规则：行程 / 地图 / 账本能拖着选，＋ 不能，「更多」只在二级页面能；透镜下放大 1.12、0.75 格以外不放大', () => {
  assert.deepEqual(SLOTS, ['trip', 'map', 'fab', 'ledger', 'more']);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => isSelectable(i, 'map')), [true, true, false, true, false]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => isSelectable(i, 'more')), [true, true, false, true, true]);
  assert.deepEqual(selectableRange('trip'), { min: 0, max: 3 });
  assert.deepEqual(selectableRange('more'), { min: 0, max: 4 });
  assert.ok(close(magnifyAt(1, 1, 1), 1.12));
  assert.equal(magnifyAt(1, 2, 1), 1);
  assert.equal(magnifyAt(1.8, 1, 1), 1);
  assert.equal(magnifyAt(1, 1, 0), 1, '没浮起不放大');
  const half = magnifyAt(1.3, 1, 1);
  assert.ok(half > 1 && half < 1.12);
  // 参数在需求范围里：按下放大 1.1–1.15（横）、竖向能超出底栏；收小等比（玻璃两头还是正圆）
  assert.ok(TABBAR_MOTION.lift.scaleX >= 1.1 && TABBAR_MOTION.lift.scaleX <= 1.15);
  assert.equal(TABBAR_MOTION.lift.scaleY, TABBAR_MOTION.lift.scaleX, '等比放大：透镜两头还是正圆');
  assert.ok((70 - 2 * 3) * TABBAR_MOTION.lift.scaleY > 70, '选中块 64px 高放大后超出 70px 的底栏一点');
  assert.ok(TABBAR_MOTION.compact.scale * 56 >= 44, '收小后 ＋ 还有 44px');
  assert.ok(TABBAR_MOTION.compact.scale * 70 >= 44, '收小后每格还有 44px 高');
});

test('滚动收小（createTabbarIntent）：顶部完整；往下滚过 24px 收小；往上 12px 弹回；到底的橡皮筋不算往上；回到顶部一定完整；换页重置', () => {
  const it = createTabbarIntent();
  assert.equal(it.update(0, 2000), false);
  assert.equal(it.update(60, 2000), false, '离顶部不到 96px 不收');
  assert.equal(it.update(110, 2000), true, '过了 96px、往下滚了 50px（> 24）：收小');
  assert.equal(it.update(300, 2000), true);
  assert.equal(it.update(292, 2000), true, '往上 8px：还不够');
  assert.equal(it.update(286, 2000), false, '累计往上 14px：弹回');
  assert.equal(it.update(300, 2000), false, '往下 14px：还不够');
  assert.equal(it.update(320, 2000), true, '往下累计 34px：收小');
  // 到底的橡皮筋：位置超过 maxY 再弹回来，不算往上
  assert.equal(it.update(2000, 2000), true);
  assert.equal(it.update(2060, 2000), true);
  assert.equal(it.update(2000, 2000), true, '橡皮筋回弹不弹回');
  assert.equal(it.update(50, 2000), false, '回到顶部附近：完整');
  it.update(800, 2000);
  assert.equal(it.compact, true);
  assert.equal(it.reset(800), false, '换页：从完整开始');
  assert.equal(it.update(805, 2000), false, '换页以后的累计从 0 开始');
});

test('顶栏和底栏的滚动规则互不影响（同一串滚动位置：顶栏 pill / bar 照旧，底栏收小 / 展开各算各的）', () => {
  const top = createTopbarIntent();
  const bar = createTabbarIntent();
  const ys = [0, 40, 120, 300, 500, 480, 460, 440, 600, 0];
  const out = ys.map((y) => [top.update(y, 3000), bar.update(y, 3000)]);
  assert.deepEqual(out.map((o) => o[0]), ['top', 'top', 'pill', 'pill', 'pill', 'pill', 'bar', 'bar', 'pill', 'top']);
  assert.deepEqual(out.map((o) => o[1]), [false, false, true, true, true, false, false, false, true, false]);
});
