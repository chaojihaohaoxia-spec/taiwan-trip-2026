// 弹层系统（src/overlay/）里的纯逻辑：几何定位、底部面板松手落点、键盘高度、弹层栈规则、Toast 规则。
// 通用的物理（弹簧、橡皮筋、手指速度、惯性投射、形变）在 motion/，测试见 motion.physics.test.js。
// DOM 和动画的行为在 test/e2e/overlay.e2e.mjs 里用真实浏览器测。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRadius, placeAnchored, releaseTarget, keyboardInset, SHEET_DECELERATION } from '../../src/overlay/geometry.js';
import { zIndexFor, planOpen, planClose, firstUnknownIndex, findSheet, KIND_Z_BASE, OVERLAY_KINDS } from '../../src/overlay/stack.js';
import { projectMomentum } from '../../src/motion/physics.js';
import {
  normalizeToast, insertToast, createCountdown, stackLayout, TOAST_DURATION, TOAST_ACTION_DURATION,
} from '../../src/overlay/toast-model.js';

const VP = { width: 390, height: 844, insets: { top: 47, right: 0, bottom: 34, left: 0 } };

// ---------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------

test('圆角：百分比、超大值、椭圆写法都换成实际 px（不超过短边的一半）', () => {
  const rect = { left: 0, top: 0, width: 56, height: 56 };
  assert.equal(resolveRadius('50%', rect), 28);
  assert.equal(resolveRadius('999px', rect), 28, '不超过短边的一半');
  assert.equal(resolveRadius('12px 8px', rect), 12);
  assert.equal(resolveRadius('', rect), 0);
  assert.equal(resolveRadius('50%', { left: 0, top: 0, width: 200, height: 44 }), 22);
});

test('定位：下面放得下就放下面，左边对齐；超出屏幕右边时往回推', () => {
  const anchor = { left: 300, top: 100, width: 80, height: 44 };
  const p = placeAnchored({ anchor, size: { width: 240, height: 200 }, viewport: VP, placement: 'below', align: 'start', gap: 6, margin: 8 });
  assert.equal(p.side, 'bottom');
  assert.equal(p.top, 150);
  assert.equal(p.height, 200);
  assert.equal(p.left, 390 - 8 - 240, '右边夹在屏幕内（留 8px）');
  assert.equal(p.originY, 0, '从上边（按钮那一侧）弹出');
  assert.ok(p.originX > 0 && p.originX <= 240);
});

test('定位：下面放不下 → 翻到上面；上下都放不下 → 选空间大的一侧并限制高度（内部滚动）', () => {
  const low = { left: 20, top: 700, width: 56, height: 56 };
  const p = placeAnchored({ anchor: low, size: { width: 300, height: 300 }, viewport: VP, placement: 'below', align: 'center', gap: 10, margin: 16 });
  assert.equal(p.side, 'top');
  assert.equal(p.top + p.height, 690, '面板底边 = 按钮顶边 − 间距');
  assert.equal(p.left, 16, '左边夹在屏幕内');
  assert.equal(p.originY, p.height, '从下边（按钮那一侧）弹出');

  const huge = placeAnchored({ anchor: { left: 0, top: 400, width: 50, height: 40 }, size: { width: 200, height: 2000 }, viewport: VP, placement: 'auto' });
  const below = 844 - 34 - 16 - (440 + 8);
  const above = 400 - 8 - (47 + 16);
  assert.equal(huge.side, below >= above ? 'bottom' : 'top');
  assert.equal(huge.height, Math.max(below, above));
});

test('定位：宽度不超过屏幕减两边留白；居中对齐；上方优先', () => {
  const fab = { left: 167, top: 760, width: 56, height: 56 };
  const p = placeAnchored({ anchor: fab, size: { width: 500, height: 300 }, viewport: VP, placement: 'above', align: 'center', margin: 16 });
  assert.equal(p.width, 390 - 32);
  assert.equal(p.left, 16);
  assert.equal(p.side, 'top');
  assert.equal(Math.round(p.originX), 195 - 16, '原点在按钮中心');
});

test('松手落点：慢慢拖一点点弹回原档；甩一下就关；按速度推算到最近的一档；不能关时永远不关', () => {
  const snaps = [0, 380];
  assert.deepEqual(releaseTarget({ offset: 30, velocity: 50, snaps, closed: 820 }), { target: 0, close: false });
  assert.deepEqual(releaseTarget({ offset: 420, velocity: 2500, snaps, closed: 820 }), { target: 820, close: true });
  assert.deepEqual(releaseTarget({ offset: 60, velocity: 1800, snaps, closed: 820 }), { target: 380, close: false });
  assert.deepEqual(releaseTarget({ offset: 300, velocity: -1500, snaps, closed: 820 }), { target: 0, close: false }, '往上甩到大档');
  assert.deepEqual(releaseTarget({ offset: 700, velocity: 3000, snaps, closed: 820, dismissible: false }), { target: 380, close: false });
  // 只有一档（内容高度）：拖过 45% 就关
  assert.equal(releaseTarget({ offset: 260, velocity: 0, snaps: [0], closed: 460 }).close, true);
  assert.equal(releaseTarget({ offset: 200, velocity: 0, snaps: [0], closed: 460 }).close, false);
  // 推算用的是 motion/physics.js 的惯性投射：0.998 ≈ iOS 滚动的 normal 减速，约等于甩出 0.5 秒的距离
  assert.ok(Math.abs(projectMomentum(1000, SHEET_DECELERATION) - 499) < 1);
});

test('松手落点（动效评审 #2 的实测场景）：内容高 629px 的面板，拖 60px 后 500 px/s 甩就关；停在 55% 关、40% 弹回；半屏档往上甩升到大档', () => {
  const H = 629;
  const closed = H + 64;
  for (const v of [500, 800, 1200]) {
    assert.equal(releaseTarget({ offset: 60, velocity: v, snaps: [0], closed, height: H }).close, true, `${v} px/s 甩一下就关`);
  }
  assert.equal(releaseTarget({ offset: H * 0.55, velocity: 0, snaps: [0], closed, height: H }).close, true, '拖到 55% 停住松手：关');
  assert.equal(releaseTarget({ offset: H * 0.4, velocity: 0, snaps: [0], closed, height: H }).close, false, '40%：弹回');
  assert.equal(releaseTarget({ offset: 30, velocity: 300, snaps: [0], closed, height: H }).close, false, '慢慢的小动作不关');
  // 半屏档（[large 0, medium 422]，面板高 844）：往上 800 px/s 甩 60px → 大档；往下甩 → 关闭
  const snaps = [0, 422];
  assert.deepEqual(releaseTarget({ offset: 362, velocity: -800, snaps, closed: 908, height: 844 }), { target: 0, close: false });
  assert.deepEqual(releaseTarget({ offset: 482, velocity: 800, snaps, closed: 908, height: 844 }), { target: 908, close: true });
  // 大档往下甩：降一档到半屏；特别用力才直接关
  assert.deepEqual(releaseTarget({ offset: 40, velocity: 900, snaps, closed: 908, height: 844 }), { target: 422, close: false });
  assert.equal(releaseTarget({ offset: 40, velocity: 3200, snaps, closed: 908, height: 844 }).close, true);
  // 从大档一口气拖到半屏附近、手还在快速往下：已经到了半屏那一档，再往下就是关闭
  assert.equal(releaseTarget({ offset: 408, velocity: 2400, snaps: [0, 410], closed: 896, height: 832 }).close, true);
  // 半屏往上甩、已经拖到大档附近：就停在大档
  assert.deepEqual(releaseTarget({ offset: 12, velocity: -900, snaps, closed: 908, height: 844 }), { target: 0, close: false });
});

test('键盘高度：visualViewport 推算；小差值（工具条）、双指放大时不算', () => {
  assert.equal(keyboardInset({ innerHeight: 844, height: 500, offsetTop: 0 }), 344);
  assert.equal(keyboardInset({ innerHeight: 844, height: 500, offsetTop: 40 }), 304, 'iOS 把可见区域往上推了');
  assert.equal(keyboardInset({ innerHeight: 844, height: 800, offsetTop: 0 }), 0, '44px 是工具条，不是键盘');
  assert.equal(keyboardInset({ innerHeight: 844, height: 400, offsetTop: 0, scale: 2 }), 0);
  assert.equal(keyboardInset({ innerHeight: 844, height: 0 }), 0);
});

test('定位：屏幕比两边留白还窄时贴左边，不算出负宽度', () => {
  const p = placeAnchored({ anchor: { left: 0, top: 10, width: 20, height: 20 }, size: { width: 200, height: 50 }, viewport: { width: 20, height: 400 }, margin: 16 });
  assert.equal(p.width, 0);
  assert.equal(p.left, 16);
});

// ---------------------------------------------------------------------
// 弹层栈规则
// ---------------------------------------------------------------------

test('层级：导航 < 底部面板 < 确认框（叠在面板上）< 全屏菜单 < 小菜单；后开的永远在上面', () => {
  assert.deepEqual(OVERLAY_KINDS, ['sheet', 'panel', 'dialog', 'menu', 'popover']);
  assert.equal(KIND_Z_BASE.dialog, 'sheet');
  assert.equal(zIndexFor(['sheet'], 0), 'calc(var(--z-sheet) + 0)');
  assert.equal(zIndexFor(['sheet', 'dialog'], 1), 'calc(var(--z-sheet) + 1)');
  assert.equal(zIndexFor(['menu'], 0), 'calc(var(--z-menu) + 0)');
  assert.equal(zIndexFor(['menu', 'dialog'], 1), 'calc(var(--z-menu) + 1)', '菜单里弹的确认框在菜单上面');
  assert.equal(zIndexFor(['sheet', 'popover', 'dialog'], 2), 'calc(var(--z-popover) + 2)', '小菜单里弹的确认框在小菜单上面');
  assert.equal(zIndexFor([null, 'sheet'], 1), 'calc(var(--z-sheet) + 1)', '不认识的层（只借用网址的）不影响基准');
  assert.equal(zIndexFor(new Array(15).fill('sheet'), 14), 'calc(var(--z-sheet) + 9)', '同一基准里最多叠 10 层');
});

test('打开：已开着 → 不动；同 id 换参数 / 同类弹层已在栈里 → 先关它（和上面的）再开；不同类 → 直接叠', () => {
  const stack = [{ id: 'add-expense', arg: null, kind: 'sheet' }, { id: 'confirm', arg: 'c1', kind: 'dialog' }];
  assert.deepEqual(planOpen(stack, { id: 'add-expense', kind: 'sheet' }), { type: 'noop', index: 0 });
  assert.deepEqual(planOpen(stack, { id: 'pick-currency', kind: 'popover' }), { type: 'push' });
  assert.deepEqual(planOpen(stack, { id: 'edit-item', arg: 'x', kind: 'sheet' }), { type: 'close-then-push', index: 0, reason: 'same-kind' });
  assert.deepEqual(planOpen(stack, { id: 'confirm', arg: 'c2', kind: 'dialog' }), { type: 'close-then-push', index: 1, reason: 'same-id' });
  assert.deepEqual(planOpen([{ id: 'search', arg: null, kind: null }], { id: 'menu', kind: 'menu' }), { type: 'push' }, '只借用网址的不参与互斥');
  assert.deepEqual(planOpen([], { id: 'x', kind: 'not-a-kind' }), { type: 'push' });
});

test('关闭：都是本应用压进来的 → 一次 history.go(-n)；有直接打开的层 → 一层一层关', () => {
  assert.deepEqual(planClose(3, 1, 3), { type: 'go', delta: -2 });
  assert.deepEqual(planClose(3, 2, 1), { type: 'go', delta: -1 });
  assert.deepEqual(planClose(3, 0, 1), { type: 'step', count: 3 });
  assert.deepEqual(planClose(2, 2, 5), { type: 'noop' });
  assert.deepEqual(planClose(2, -3, 2), { type: 'go', delta: -2 });
});

test('不认识的 id 和按参数找层', () => {
  const stack = [{ id: 'a', arg: null }, { id: 'confirm', arg: 'c9' }, { id: 'b', arg: null }];
  const known = (id, arg) => id === 'a' || id === 'b' || (id === 'confirm' && arg === 'c1');
  assert.equal(firstUnknownIndex(stack, known), 1);
  assert.equal(firstUnknownIndex(stack.filter((s) => s.id !== 'confirm'), known), -1);
  const s2 = [{ id: 'x', arg: '1' }, { id: 'x', arg: '2' }];
  assert.equal(findSheet(s2, 'x'), 1, '同 id 多层时取最上面');
  assert.equal(findSheet(s2, 'x', '1'), 0);
  assert.equal(findSheet(s2, 'x', null), -1);
  assert.equal(findSheet([{ id: 'y', arg: null }], 'y', null), 0);
});

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------

test('Toast：默认时长、带按钮更长、常驻、语气、空文字报错', () => {
  const a = normalizeToast('已保存', 't1');
  assert.deepEqual(a, { id: 't1', message: '已保存', tone: 'neutral', action: null, duration: TOAST_DURATION, key: null, pausable: true });
  assert.equal(normalizeToast({ message: 'x', pausable: false }, 2).pausable, false, '撤销条可以设成不暂停');
  const undo = () => {};
  const b = normalizeToast({ message: '已删除', action: { label: '撤销', onClick: undo }, tone: 'success' }, 't2');
  assert.equal(b.duration, TOAST_ACTION_DURATION);
  assert.equal(b.action.onClick, undo);
  assert.equal(b.tone, 'success');
  assert.equal(normalizeToast({ message: 'x', duration: Infinity }, 3).duration, Infinity);
  assert.equal(normalizeToast({ message: 'x', tone: 'loud' }, 3).tone, 'neutral');
  assert.equal(normalizeToast({ message: 'x', tone: 'default' }, 3).tone, 'neutral', '旧写法 default = neutral');
  assert.equal(normalizeToast({ message: 'x', tone: 'warning' }, 3).tone, 'warning');
  assert.equal(normalizeToast({ message: 'x', action: { label: '撤销' } }, 3).action, null, '没有回调的按钮不显示');
  assert.throws(() => normalizeToast('  ', 4), /一段文字/);
});

test('Toast：新的放最前，同 key 的旧提示被替换', () => {
  const t1 = normalizeToast({ message: '同步中', key: 'sync' }, 1);
  const t2 = normalizeToast('别的', 2);
  const t3 = normalizeToast({ message: '同步完成', key: 'sync' }, 3);
  let { list } = insertToast([], t1);
  ({ list } = insertToast(list, t2));
  const r = insertToast(list, t3);
  assert.deepEqual(r.list.map((t) => t.id), [3, 2]);
  assert.deepEqual(r.replaced.map((t) => t.id), [1]);
});

test('Toast 倒计时：暂停时不走，恢复后接着数', () => {
  const c = createCountdown(3000, 0);
  assert.equal(c.remaining(1000), 2000);
  c.pause(1000);
  assert.equal(c.running, false);
  assert.equal(c.remaining(5000), 2000, '暂停期间不走');
  c.resume(5000);
  assert.equal(c.remaining(6500), 500);
  c.pause(6500);
  c.pause(9000);
  assert.equal(c.remaining(9000), 500, '重复暂停无害');
  assert.equal(createCountdown(100, 0).remaining(500), 0);
});

test('Toast 堆叠：收起时后面两张露边、统一压成最前那张的高度；展开时排成一列', () => {
  const collapsed = stackLayout([60, 80, 50, 70], { expanded: false, peek: 10, shrink: 0.05, maxVisible: 3 });
  assert.deepEqual(collapsed.map((p) => p.y), [-0, -10, -20, -20]);
  assert.deepEqual(collapsed.map((p) => p.scale), [1, 0.95, 0.9, 0.9]);
  assert.deepEqual(collapsed.map((p) => p.visible), [true, true, true, false]);
  assert.deepEqual(collapsed.map((p) => p.clampHeight), [null, 60, 60, 60]);
  const expanded = stackLayout([60, 80, 50], { expanded: true, gap: 8 });
  assert.deepEqual(expanded.map((p) => p.y), [-0, -68, -156]);
  assert.ok(expanded.every((p) => p.scale === 1 && p.clampHeight === null));
});

test('M4 撤销条：时长 = 撤销窗口剩下的时间、不暂停；撤销失败提示“删除已经生效”；窗口过了自动收起', async () => {
  const { signal } = await import('@preact/signals');
  const { bridgeUndoToasts } = await import('../../src/shell/undo-toast.js');
  const { toasts, dismissAllToasts } = await import('../../src/overlay/toast.js');
  dismissAllToasts();
  toasts.value = [];
  let t = 1_000_000;
  const undoable = signal(null);
  const stop = bridgeUndoToasts(undoable, { now: () => t });
  let undone = 0;
  undoable.value = { id: 'u1', label: '已删除「防晒霜」', undo: async () => { undone += 1; return false; }, expiresAt: t + 5000 };
  const shown = toasts.value.find((x) => x.state === 'open');
  assert.equal(shown.message, '已删除「防晒霜」');
  assert.equal(shown.duration, 5000, '时长和撤销窗口一致（不是默认的 6 秒）');
  assert.equal(shown.pausable, false, '悬停 / 切到后台都不暂停');
  assert.equal(shown.action.label, '撤销');
  await shown.action.onClick();
  assert.equal(undone, 1);
  const warn = toasts.value.find((x) => x.state === 'open');
  assert.equal(warn.message, '删除已经生效，没能撤销');
  assert.equal(warn.tone, 'warning');
  // 又删了一条：替换；窗口过了：收起
  undoable.value = { id: 'u2', label: '已删除「泳镜」', undo: async () => true, expiresAt: t + 4000 };
  assert.equal(toasts.value.filter((x) => x.state === 'open').length, 1);
  undoable.value = null;
  assert.equal(toasts.value.filter((x) => x.state === 'open').length, 0);
  // 剩下的时间太短（来不及点）：不弹
  t += 10;
  undoable.value = { id: 'u3', label: '已删除「x」', undo: async () => true, expiresAt: t + 100 };
  assert.equal(toasts.value.filter((x) => x.state === 'open').length, 0);
  stop();
});
