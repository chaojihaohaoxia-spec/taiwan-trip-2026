// =====================================================================
// sheets/photo/PhotoSheet.jsx：弹层「photo」——全屏看大图（SPEC §5.8）。
//
//   openPhotoViewer({ entryId, index })     日记里的照片：在整趟行程的相册（按天 → 拍摄时间）里从这一张看起，左右滑能看到别的天
//   openPhotoViewer({ reviewId, index })    评级里的照片：只在这条评级的几张里切换
//   openPhotoViewer({ index })              没给 id：整趟相册的第几张（开发页用）
//
// 手势（stage 上的 Pointer Events，自己判定，纯函数在 gestures.js）：
//   左右滑换张（跟手、松手按位置 + 速度吸附，两端有橡皮筋）；双指捏合缩放（以两指中点为中心，过界有阻尼，松手弹回 1–4 倍）；
//   双击放大 / 还原；放大后单指平移（到边再往外拉就接着换张，和 iOS 照片一样）；
//   没放大时往下拉关闭：照片跟着手指缩小、背景渐隐、顶部和底部的字淡掉，不够就弹回；
//   单击：显示 / 隐藏顶部和底部的字（隐藏时背景变成纯黑，专心看图）。
//   键盘：← → 换张，Home / End，Esc 关闭。
// 打开 / 关闭：页面里缩略图的外层写 data-pv-thumb=<path>（pages/journal/parts.jsx 的 Thumb）——打开时照片从那个
//   缩略图的位置和裁切放大出来（motion/flip.js 的 crop 模式：等比放大 + clip-path 裁切，不变形）、背景淡入、字稍后出现；
//   关闭时缩回“现在这一张”的缩略图（看完别的照片关掉也缩回对应的那一格；缩略图不在屏幕里就改成淡出）。
//   往下拉关掉：接着手指速度滑出屏幕。减弱动态效果：只淡入淡出。
// 图片：签名链接（data/ 的 useSignedUrl；还没传完的照片是本机预览），加载前是模糊占位（有缩略图就用缩略图放大模糊，
//   没有就是主题色的柔光），加载完淡入；相邻两张提前渲染（预加载）。
// 顶部：× ｜「Cathy · 第 1 天」+ 「1月10日 13:10」｜ 2 / 4 ｜ 分享（优先分享照片文件本身：iOS 分享面板里能存到相册、
//   发给对方；不能分享文件时退回 lib/native.js 的 share）。
// 底部：照片说明，关联的日记（心情 + 摘录）→「打开那天的日记」；自己的照片还能「编辑日记」。
// 弹层基础设施同 sheets/driver/DriverSheet.jsx（useOverlayRoute / useLayer / Portal）。
// =====================================================================

import './photo.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Portal, OverlayContext, useLayer, useOpenedGate, useOverlayRoute, viewportInfo, uid, prepareHidden, hadUserInput, setPageCovered, toast,
} from '../../overlay/index.js';
import { animateSpring, animateTween, stopAnimation, clearStyle, getAnimation } from '../../motion/animate.js';
import { invertFor, flipRenderer } from '../../motion/flip.js';
import { VelocityTracker, clamp, num, rubberBand } from '../../motion/physics.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { haptic, share, isNativeShell } from '../../lib/native.js';
import { formatDate, formatInstant, instantTimeParts } from '../../lib/datetime.js';
import { navigate } from '../../router/index.js';
import { authState, useSignedUrl } from '../../data/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { useSheetTrip } from '../hooks.js';
import { parseSheetArg } from '../args.js';
import { openJournalSheet } from '../index.js';
import { tripReady } from '../journal/form.js';
import { journalPhotoList, reviewPhotoList, resolveStartIndex, reindex, aspectOf, excerpt, photoAlt, photoFileName } from './model.js';
import {
  containRect, panBounds, clampPan, zoomAround, rubberZoom, doubleTapZoom, settleZoom, classifyDrag, swipeTarget, shouldDismiss,
  dismissFollow, backdropOpacity, flyFromRect, visualRect, rectVisible, SLIDE_GAP, DRAG_SLOP, DOUBLE_TAP_MS, DOUBLE_TAP_DIST,
} from './gestures.js';

const CH = Object.freeze({ track: 'pv-track', fly: 'pv-fly', zoom: 'pv-zoom', backdrop: 'pv-bd', chrome: 'pv-chrome', card: 'pv-card' });
const CHROME = '.pv__top, .pv__bottom';
const identity = () => ({ s: 1, x: 0, y: 0 });
const renderZoom = ({ s, x, y }) => ({ transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(s, 4)})` });
const renderTrack = ({ x }) => ({ transform: `translate(${num(x)}px, 0)` });
const renderFly = ({ x, y, s }) => ({ transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(s, 4)})` });

/** 页面上这张照片的缩略图（看得见的那一个） */
function findThumb(path) {
  if (!path || typeof document === 'undefined') return null;
  const vp = viewportInfo();
  const sel = `[data-pv-thumb="${CSS.escape(path)}"]`;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-overlay-layer]')) continue;
    const r = el.getBoundingClientRect();
    if (rectVisible(r, vp, 4)) return el;
  }
  return null;
}

/** 把正在显示的图取成 File（分享文件用）；取不到返回 null（跨域、断网都不报错） */
async function fetchAsFile(src, name) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

/** 元素此刻（含动画中）的 translateX（px） */
function translateXOf(el) {
  if (!el) return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(t).m41;
  } catch {
    return 0;
  }
}

function rectAndRadius(el) {
  const r = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius: Math.min(radius, r.width / 2, r.height / 2) };
}

export default function PhotoSheet() {
  const ov = useOverlayRoute('photo', { kind: 'menu' });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <PhotoLayer ov={ov} />
    </Portal>
  );
}

function PhotoLayer({ ov }) {
  // 入场播完：整页被不透明的大图盖住，关掉底下看不见的毛玻璃（overlay/dom.js 的 setPageCovered）；开始退场 / 卸载时还回去
  const covered = useRef(false);
  const cover = (on) => {
    if (covered.current === on) return;
    covered.current = on;
    setPageCovered(on);
  };
  useEffect(() => () => cover(false), []);
  const gate = useOpenedGate(() => cover(true));
  const layerRef = useRef(null);
  const backdropRef = useRef(null);
  const cardRef = useRef(null);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const closeRef = useRef(null);
  const frames = useRef(new Map());
  const zoomEls = useRef(new Map());
  const motion = useRef({ token: 0, exit: null, shown: false });
  const z = useRef(identity());
  const fly = useRef({ x: 0, y: 0, s: 1 });
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const tapTimer = useRef(0);
  const labelId = useMemo(() => uid('pv-title'), []);

  const { fields } = parseSheetArg(ov.arg);
  const { store, pending } = useSheetTrip();
  const ready = tripReady(store);
  const trip = store?.trip.value || null;
  const timeZone = trip?.timezone;
  const tripId = store?.tripId || null;
  const me = authState.value.user?.id || null;
  const days = store?.view.days.value || [];
  const byDay = store?.view.journalByDay.value;
  const reviews = store?.tables.reviews.value;
  const places = store?.tables.places.value;
  const entries = store?.tables.journal_entries.value;

  const list = useMemo(() => {
    if (!ready) return [];
    if (fields.review) {
      const rv = reviews?.get(fields.review);
      return rv ? reviewPhotoList(rv, places?.get(rv.place_id) || null) : [];
    }
    return journalPhotoList({ days, byDay });
  }, [ready, fields.review, reviews, places, days, byDay]);

  // ---------- 第几张 ----------
  // 第一次拿到列表就在渲染里定下起点（不等 effect）：第一帧画的就是那张照片，不会先出一帧空的弹层再换成照片
  // （页面上的缩略图、从网址打开都一样）。之后的换张走 setIndex。
  const [indexState, setIndexState] = useState(-1);
  const indexRef = useRef(-1);
  const keyRef = useRef(null);
  const startOf = (l) => (fields.entry || fields.review ? resolveStartIndex(l, fields) : clamp(Number.parseInt(fields.index ?? 0, 10) || 0, 0, l.length - 1));
  const index = indexState >= 0 ? indexState : list.length ? startOf(list) : -1;
  if (indexRef.current === -1 && index >= 0) {
    indexRef.current = index;
    keyRef.current = list[index]?.key || null;
  }
  const setIndex = (i) => {
    indexRef.current = i;
    keyRef.current = list[i]?.key || null;
    setIndexState(i);
  };
  useEffect(() => {
    if (!list.length) return;
    if (indexState === -1) {
      // 把渲染里算出来的起点记成状态（之后列表变了按 key 重定位）
      setIndex(index);
      return;
    }
    // 列表变了（照片被删 / 新加）：还看原来那张
    const i = reindex(list, keyRef.current, indexRef.current);
    if (i !== indexRef.current) setIndex(i);
  }, [list]);
  const photo = index >= 0 ? list[index] || null : null;
  const count = list.length;

  // ---------- 视口、照片框 ----------
  const [vp, setVp] = useState(() => viewportInfo());
  const [aspects, setAspects] = useState(() => new Map());
  const [chrome, setChrome] = useState(true);
  const pad = { top: vp.insets?.top || 0, bottom: vp.insets?.bottom || 0, left: 0, right: 0 };
  const frameFor = (p) => containRect(aspects.get(p?.key) ?? aspectOf(p), vp, pad);
  const W = vp.width + SLIDE_GAP;
  const F = photo ? frameFor(photo) : null;

  useEffect(() => {
    if (!ov.open) return undefined;
    const onResize = () => {
      setVp(viewportInfo());
      for (const el of [trackRef.current, ...frames.current.values(), ...zoomEls.current.values()]) {
        if (!el) continue;
        for (const ch of Object.values(CH)) stopAnimation(el, ch, { commit: false });
        clearStyle(el, ['transform', 'clipPath', 'opacity']);
      }
      z.current = identity();
      fly.current = { x: 0, y: 0, s: 1 };
      stopAnimation(backdropRef.current, CH.backdrop, { commit: false });
      clearStyle(backdropRef.current, ['opacity']);
      gate.open();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ov.open]);

  // 换张以后：轨道回零、缩放回 1（在绘制前，和重新排好的幻灯片同一帧）
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) {
      stopAnimation(track, CH.track, { commit: false });
      clearStyle(track, ['transform']);
    }
    for (const [i, el] of zoomEls.current) {
      if (i !== index && el) {
        stopAnimation(el, CH.zoom, { commit: false });
        clearStyle(el, ['transform']);
      }
    }
    z.current = identity();
  }, [index]);

  // ---------- 进出场 ----------
  useLayoutEffect(() => {
    prepareHidden(backdropRef.current, cardRef.current);
  }, []);

  const enter = () => {
    motion.current.token += 1;
    motion.current.exit = null;
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    const frame = frames.current.get(index);
    const reduced = prefersReducedMotion.peek();
    gate.reset();
    stopAnimation(card, CH.card, { commit: false });
    clearStyle(card, ['opacity', 'scale', 'translate']);
    const from = motion.current.shown ? Number(getComputedStyle(backdrop).opacity) || 0 : 0;
    motion.current.shown = true;
    animateTween(backdrop, [{ opacity: from }, { opacity: 1 }], { duration: reduced ? 'fast' : 'base', easing: 'out', channel: CH.backdrop, commit: 'final' });
    // 顶部 / 底部的字：稍后淡入（fill backwards：延迟期间停在 0；播完撤掉动画，回到 CSS 的值）
    for (const el of card.querySelectorAll(CHROME)) {
      clearStyle(el, ['opacity']);
      animateTween(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', easing: 'out', delay: reduced ? 0 : 140, channel: CH.chrome });
    }
    const thumb = !reduced && photo ? findThumb(photo.path) : null;
    let anim = null;
    if (thumb && frame && F) {
      const first = rectAndRadius(thumb);
      const inv = invertFor('crop', first, { left: F.left, top: F.top, width: F.width, height: F.height }, { firstRadius: first.radius, lastRadius: 0 });
      if (inv) {
        card.style.opacity = '1';
        anim = animateSpring(frame, { channel: CH.fly, from: inv.from, to: inv.to, spring: 'smooth', render: flipRenderer(inv.mode), commit: 'clear', reduced: 'tween' });
      }
    }
    if (!anim) {
      clearStyle(card, ['opacity']);
      anim = animateTween(card, [{ opacity: 0, scale: reduced ? '1' : '0.96' }, { opacity: 1, scale: '1' }], { duration: reduced ? 'fast' : 'slow', easing: 'out', channel: CH.card });
    }
    anim.finished.then((done) => done && gate.open());
  };

  const exit = () => {
    cover(false);
    motion.current.token += 1;
    const token = motion.current.token;
    const card = cardRef.current;
    const backdrop = backdropRef.current;
    const frame = frames.current.get(indexRef.current);
    const reduced = prefersReducedMotion.peek();
    const how = motion.current.exit;
    for (const el of card.querySelectorAll(CHROME)) animateTween(el, [{ opacity: 0 }], { duration: 'fast', easing: 'in', channel: CH.chrome, commit: 'final' });
    let anim;
    if (how?.kind === 'drag' && frame && !reduced) {
      const to = { x: how.fly.x, y: vp.height, s: how.fly.s };
      anim = animateSpring(frame, { channel: CH.fly, from: how.fly, velocity: { y: Math.max(how.vy, 0) }, to, spring: 'smooth', render: renderFly, commit: 'final' });
      animateTween(backdrop, [{ opacity: 0 }], { duration: 'base', easing: 'out', channel: CH.backdrop, commit: 'final' });
    } else {
      const cur = list[indexRef.current];
      const thumb = !reduced && cur ? findThumb(cur.path) : null;
      if (thumb && frame && F) {
        const zoomEl = zoomEls.current.get(indexRef.current);
        const visual = visualRect(F, zoomEl ? currentZoom(zoomEl) : z.current, fly.current);
        if (zoomEl) {
          stopAnimation(zoomEl, CH.zoom, { commit: false });
          clearStyle(zoomEl, ['transform']);
        }
        stopAnimation(frame, CH.fly, { commit: false });
        const first = rectAndRadius(thumb);
        const inv = invertFor('crop', first, { left: F.left, top: F.top, width: F.width, height: F.height }, { firstRadius: first.radius, lastRadius: 0 });
        const from = { ...flyFromRect(visual, F), ix: 0, iy: 0, r: 0 };
        const to = inv ? inv.from : { x: 0, y: 0, s: 1, ix: 0, iy: 0, r: 0 };
        anim = animateSpring(frame, { channel: CH.fly, from, to, spring: 'smooth', render: flipRenderer('crop'), commit: 'final', reduced: 'tween' });
        animateTween(backdrop, [{ opacity: 0 }], { duration: 'base', easing: 'out', channel: CH.backdrop, commit: 'final' });
      } else {
        anim = animateTween(card, [{ opacity: 0 }], { duration: reduced ? 'fast' : 'base', easing: 'in', channel: CH.card, commit: 'final' });
        animateTween(backdrop, [{ opacity: 0 }], { duration: reduced ? 'fast' : 'base', easing: 'in', channel: CH.backdrop, commit: 'final' });
      }
    }
    anim.finished.then((done) => {
      if (!done || token !== motion.current.token) return;
      ov.onExited();
    });
  };

  // 第一张照片的框算好了（index 从 -1 变成有效）才开始出场动画；关闭随时
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (ov.open) {
      if (index < 0 && list.length) return;
      if (entered.current && !motion.current.closing) return;
      entered.current = true;
      motion.current.closing = false;
      enter();
    } else {
      motion.current.closing = true;
      exit();
    }
  }, [ov.open, index < 0]);

  // 从网址直接打开（还没点过屏幕）时焦点放在容器上，不在关闭按钮上画焦点框（和 overlay/ 的面板一致）
  useLayer(ov, { layerRef, focusRef: cardRef, closeOnEsc: true, initialFocus: () => (hadUserInput() ? closeRef.current : cardRef.current) });
  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);

  // ---------- 换张 ----------
  const goTo = (target, { vx = 0 } = {}) => {
    const i = indexRef.current;
    const track = trackRef.current;
    if (!track || count === 0) return;
    const next = clamp(target, 0, count - 1);
    const to = -(next - i) * W;
    const anim = animateSpring(track, { channel: CH.track, current: () => ({ x: translateXOf(track) }), velocity: { x: vx }, to: { x: to }, spring: next === i ? 'bouncy' : 'snappy', render: renderTrack, commit: 'final' });
    if (next !== i) {
      haptic('selection');
      anim.finished.then((done) => {
        if (done && indexRef.current === i) setIndex(next);
      });
    }
  };

  const applyZoom = (zz) => {
    z.current = zz;
    const el = zoomEls.current.get(indexRef.current);
    if (!el) return;
    stopAnimation(el, CH.zoom, { commit: false });
    el.style.transform = renderZoom(zz).transform;
  };
  const springZoom = (to, velocity) => {
    const el = zoomEls.current.get(indexRef.current);
    if (!el) return;
    z.current = to;
    animateSpring(el, { channel: CH.zoom, from: { ...z.current, ...currentZoom(el) }, velocity, to, spring: 'smooth', render: renderZoom, commit: 'final' });
  };
  const currentZoom = (el) => {
    const a = getAnimation(el, CH.zoom);
    if (a) {
      const v = a.values();
      if (v && Number.isFinite(v.s)) return v;
    }
    return z.current;
  };

  const toggleChrome = () => {
    setChrome((c) => !c);
    haptic('selection');
  };

  // ---------- 手势 ----------
  const isControl = (t) => Boolean(t?.closest?.('button, a, input, [data-pv-keep]'));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const onPointerDown = (e) => {
    if (!ov.open || isControl(e.target) || !photo || !F) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const stage = stageRef.current;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    let g = gesture.current;
    if (!g) {
      g = { pointers: new Map(), kind: null, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, tx: new VelocityTracker(), ty: new VelocityTracker(), z0: null, grab: null, pinch: null };
      gesture.current = g;
      const zoomEl = zoomEls.current.get(indexRef.current);
      if (zoomEl) {
        z.current = currentZoom(zoomEl);
        stopAnimation(zoomEl, CH.zoom, { commit: false });
        applyZoom(z.current);
      }
      const track = trackRef.current;
      stopAnimation(track, CH.track, { commit: false });
      clearStyle(track, ['transform']);
      g.z0 = { ...z.current };
      g.grab = { x: e.clientX - F.left, y: e.clientY - F.top };
      g.tx.add(e.clientX, e.timeStamp);
      g.ty.add(e.clientY, e.timeStamp);
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.kind = 'pinch';
      g.pinch = { d0: Math.max(1, dist(a, b)), c0: mid(a, b), z0: { ...z.current } };
      // 捏合前的半路跟手全部取消
      resetFollow();
    }
  };

  const resetFollow = () => {
    const track = trackRef.current;
    const frame = frames.current.get(indexRef.current);
    if (track) track.style.transform = '';
    if (frame) {
      frame.style.transform = '';
      fly.current = { x: 0, y: 0, s: 1 };
    }
    if (backdropRef.current) backdropRef.current.style.opacity = '1';
    for (const el of cardRef.current?.querySelectorAll(CHROME) || []) el.style.opacity = '';
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId) || !F) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === 'pinch') {
      if (g.pointers.size < 2) return;
      const [a, b] = [...g.pointers.values()];
      const c = mid(a, b);
      const s = rubberZoom(g.pinch.z0.s * (dist(a, b) / g.pinch.d0));
      const zz = zoomAround(g.pinch.z0, s, g.pinch.c0, F);
      applyZoom({ s: zz.s, x: zz.x + (c.x - g.pinch.c0.x), y: zz.y + (c.y - g.pinch.c0.y) });
      g.pinch.last = c;
      return;
    }
    if (g.pointers.size !== 1) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    g.tx.add(e.clientX, e.timeStamp);
    g.ty.add(e.clientY, e.timeStamp);
    if (!g.kind) {
      const zoomed = g.z0.s > 1.01;
      const b = panBounds(F, g.z0.s, vp);
      g.kind = classifyDrag({ dx, dy, zoomed, atMinX: g.z0.x <= b.minX + 0.5, atMaxX: g.z0.x >= b.maxX - 0.5 });
      if (!g.kind) return;
      if (g.kind === 'swipe' && zoomed) {
        // 放大后贴边继续拉：先把缩放收回去再换张
        springZoom(identity(), {});
        g.z0 = identity();
      }
    }
    if (g.kind === 'swipe') {
      const i = indexRef.current;
      const minX = -(count - 1 - i) * W;
      const maxX = i * W;
      const x = rubberBand(dx, minX, maxX, vp.width);
      trackRef.current.style.transform = renderTrack({ x }).transform;
    } else if (g.kind === 'dismiss') {
      const r = dismissFollow(dx, dy, g.grab, vp.height);
      fly.current = { x: r.fly.x, y: r.fly.y, s: r.fly.s };
      const frame = frames.current.get(indexRef.current);
      if (frame) frame.style.transform = renderFly(fly.current).transform;
      backdropRef.current.style.opacity = String(num(backdropOpacity(r.progress)));
      for (const el of cardRef.current.querySelectorAll(CHROME)) el.style.opacity = String(num(clamp(1 - r.progress * 2.2, 0, 1)));
    } else if (g.kind === 'pan') {
      const raw = { s: g.z0.s, x: g.z0.x + dx, y: g.z0.y + dy };
      const c = clampPan(raw, F, vp);
      // 过界有阻尼（松手弹回）
      applyZoom({ s: raw.s, x: c.x + (raw.x - c.x) * 0.35, y: c.y + (raw.y - c.y) * 0.35 });
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    const last = g.pointers.get(e.pointerId);
    g.pointers.delete(e.pointerId);
    if (g.kind === 'pinch') {
      if (g.pointers.size >= 1) {
        // 一根手指松开：先把缩放落到范围里，剩下那根接着平移
        const settled = settleZoom(z.current, g.pinch.last || g.pinch.c0, F, vp);
        springZoom(settled, {});
        const rest = [...g.pointers.values()][0];
        g.kind = 'pan';
        g.x0 = rest.x;
        g.y0 = rest.y;
        g.z0 = settled;
        return;
      }
      const settled = settleZoom(z.current, g.pinch.last || g.pinch.c0, F, vp);
      springZoom(settled, {});
      gesture.current = null;
      return;
    }
    if (g.pointers.size) return;
    gesture.current = null;
    const dx = (last?.x ?? g.x0) - g.x0;
    const dy = (last?.y ?? g.y0) - g.y0;
    const vx = g.tx.velocity(e.timeStamp);
    const vy = g.ty.velocity(e.timeStamp);
    if (!g.kind) {
      if (Math.hypot(dx, dy) > DRAG_SLOP || e.type === 'pointercancel') return;
      onTap({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      return;
    }
    if (g.kind === 'swipe') {
      if (e.type === 'pointercancel') {
        goTo(indexRef.current);
        return;
      }
      goTo(swipeTarget({ index: indexRef.current, count, dx, vx, width: vp.width }), { vx });
    } else if (g.kind === 'dismiss') {
      if (e.type !== 'pointercancel' && shouldDismiss({ dy, vy })) {
        motion.current.exit = { kind: 'drag', fly: { ...fly.current }, vy };
        haptic('light');
        close('drag');
        return;
      }
      const frame = frames.current.get(indexRef.current);
      if (frame) {
        animateSpring(frame, { channel: CH.fly, from: { ...fly.current }, velocity: { y: vy, x: vx }, to: { x: 0, y: 0, s: 1 }, spring: 'bouncy', render: renderFly, commit: 'clear' });
      }
      fly.current = { x: 0, y: 0, s: 1 };
      animateTween(backdropRef.current, [{ opacity: 1 }], { duration: 'base', easing: 'out', channel: CH.backdrop, commit: 'final' });
      for (const el of cardRef.current.querySelectorAll(CHROME)) {
        const cur = getComputedStyle(el).opacity;
        clearStyle(el, ['opacity']);
        animateTween(el, [{ opacity: cur }, { opacity: 1 }], { duration: 'base', easing: 'out', channel: CH.chrome });
      }
    } else if (g.kind === 'pan') {
      springZoom(clampPan(z.current, F, vp), { x: vx, y: vy });
    }
  };

  const onTap = (tap) => {
    const prev = lastTap.current;
    if (prev && tap.t - prev.t < DOUBLE_TAP_MS && Math.hypot(tap.x - prev.x, tap.y - prev.y) < DOUBLE_TAP_DIST) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      springZoom(doubleTapZoom(z.current, tap, F, vp), {});
      haptic('light');
      return;
    }
    lastTap.current = tap;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      if (gate.opened) toggleChrome();
    }, DOUBLE_TAP_MS);
  };
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const onKeyDown = (e) => {
    if (!ov.open || count === 0) return;
    if (e.key === 'ArrowRight') goTo(indexRef.current + 1);
    else if (e.key === 'ArrowLeft') goTo(indexRef.current - 1);
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(count - 1);
    else if (e.key === ' ' && !isControl(e.target)) toggleChrome();
    else return;
    e.preventDefault();
  };

  const onWheel = (e) => {
    if (!ov.open || z.current.s > 1.01 || Math.abs(e.deltaX) < Math.abs(e.deltaY) || Math.abs(e.deltaX) < 30) return;
    if (gesture.current || getAnimation(trackRef.current, CH.track)) return;
    goTo(indexRef.current + (e.deltaX > 0 ? 1 : -1));
  };

  // ---------- 说明文字 ----------
  const dayOf = (p) => (p?.dayId ? days.find((d) => d.id === p.dayId) : null);
  const info = useMemo(() => {
    if (!photo || !store) return null;
    const day = dayOf(photo);
    const n = day ? days.indexOf(day) + 1 : null;
    const who = store.memberName(photo.userId);
    // 标题下面一行：哪天 + 几点（「1月10日 13:10」）。拍摄时间不在这一天（隔天补传的）就按拍摄时间写日子；
    // 没有拍摄时间只写这一天的日期；评级照片（没有天）按拍摄时间写
    let when = '';
    if (photo.takenAt && day) {
      const parts = instantTimeParts(photo.takenAt, timeZone, day.date);
      when = parts.shift === 0 ? `${formatDate(day.date, { timeZone, weekday: false })} ${parts.time}` : formatInstant(photo.takenAt, { timeZone });
    } else if (photo.takenAt) when = formatInstant(photo.takenAt, { timeZone, relative: true });
    else if (day) when = formatDate(day.date, { timeZone, weekday: false });
    const entry = photo.source === 'journal' && photo.entryId ? entries?.get(photo.entryId) : null;
    const place = photo.source === 'review' && photo.placeId ? places?.get(photo.placeId) : null;
    return {
      who, n, day, when, entry, place,
      title: [who, n ? `第 ${n} 天` : day ? formatDate(day.date, { timeZone }) : null].filter(Boolean).join(' · '),
      alt: photoAlt(photo, { name: who, dayNumber: n }),
      mine: photo.userId === me,
    };
  }, [photo, store, days, entries, places, timeZone, me]);

  const openJournal = () => {
    if (!tripId || !info?.day) return;
    navigate({ name: 'journal', params: { tripId }, query: { day: info.day.date } });
  };
  const editJournal = (e) => {
    if (!info?.day) return;
    openJournalSheet({ date: info.day.date, mode: 'text' }, { replace: true, keyboard: true, trigger: e.currentTarget });
  };
  // 分享：分享照片本身（iOS 的分享面板里能「存储图像」、发给对方），走 lib/native.js 的 share({ files })。
  // 不能分享文件时不发链接（代码评审 P2-8：已上传的照片是带令牌的签名链接，谁拿到都能看；刚拍还没传的是 blob: 链接，对方打不开），
  // 提示长按图片存到相册。
  const sharePhoto = async () => {
    const el = cardRef.current?.querySelector('.pv__slide[data-current] img');
    const src = el?.currentSrc || el?.src || null;
    if (!src || !photo) return;
    const title = info?.alt || '照片';
    const file = isNativeShell() ? null : await fetchAsFile(src, photoFileName(photo, { name: info?.who }));
    const r = file ? await share({ title, files: [file] }) : { ok: false, unsupported: true };
    if (r.ok || r.cancelled) return;
    toast.info('这台设备不能直接分享照片：长按图片可以存到相册，再从相册发给对方', { key: 'photo-share' });
  };

  const slides = index >= 0 ? [index - 1, index, index + 1].filter((i) => i >= 0 && i < count) : [];
  const loading = !ready && pending;

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer pv-layer"
        data-overlay-layer=""
        data-kind="menu"
        data-sheet-id="photo"
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <div ref={backdropRef} class="pv__backdrop" data-chrome={chrome ? 'on' : 'off'} aria-hidden="true" />
        <section
          ref={cardRef}
          class="pv"
          role="dialog"
          aria-modal="true"
          aria-label="看大图"
          aria-describedby={labelId}
          tabIndex={-1}
          data-chrome={chrome ? 'on' : 'off'}
          data-testid="photo-viewer"
          data-index={index}
          data-count={count}
          onKeyDown={onKeyDown}
        >
          <div
            ref={stageRef}
            class="pv__stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <div ref={trackRef} class="pv__track">
              {slides.map((i) => {
                const p = list[i];
                const R = frameFor(p);
                return (
                  <figure key={p.key} class="pv__slide" data-index={i} data-current={i === index ? '' : undefined} style={{ left: `${(i - index) * W}px` }} data-testid="photo-slide">
                    <div
                      class="pv__frame"
                      ref={(el) => (el ? frames.current.set(i, el) : frames.current.delete(i))}
                      style={{ left: `${num(R.left)}px`, top: `${num(R.top)}px`, width: `${num(R.width)}px`, height: `${num(R.height)}px` }}
                    >
                      <div class="pv__zoom" ref={(el) => (el ? zoomEls.current.set(i, el) : zoomEls.current.delete(i))}>
                        <SlideImage
                          photo={p}
                          alt={i === index ? info?.alt || '照片' : ''}
                          current={i === index}
                          onSize={(ratio) => setAspects((m) => (m.get(p.key) === ratio ? m : new Map(m).set(p.key, ratio)))}
                        />
                      </div>
                    </div>
                  </figure>
                );
              })}
            </div>
            {!photo && (
              <p class="pv__empty" role="status" data-testid="photo-empty">{loading || (!ready && !store) ? '正在读取…' : '找不到这张照片，可能已经被删除了。'}</p>
            )}
          </div>

          <header class="pv__top">
            <button ref={closeRef} type="button" class="pv__btn" data-press="scale" aria-label="关闭" onClick={() => close('button')} data-testid="photo-close">
              <Glyph name="x" size={20} stroke={2.2} />
            </button>
            <div class="pv__heading" id={labelId}>
              <span class="pv__title" data-testid="photo-title">{info?.title || (photo ? '照片' : '')}</span>
              {info?.when && <span class="pv__when t-label">{info.when}</span>}
            </div>
            <span class="pv__count t-label" aria-live="polite" data-testid="photo-counter">{count ? `${index + 1} / ${count}` : ''}</span>
            {photo && (
              <button type="button" class="pv__btn" data-press="scale" aria-label="分享这张照片" onClick={sharePhoto} data-testid="photo-share">
                <Glyph name="external" size={20} />
              </button>
            )}
          </header>

          <footer class="pv__bottom">
            {photo?.caption && <p class="pv__caption" data-testid="photo-caption">{photo.caption}</p>}
            {info?.entry && (info.entry.body || info.entry.mood) && (
              <div class="pv__journal" data-testid="photo-journal">
                {info.entry.mood && <span class="pv__mood" aria-hidden="true">{info.entry.mood}</span>}
                <p class="pv__excerpt">{excerpt(info.entry.body, 96) || '（只有照片）'}</p>
              </div>
            )}
            {info?.place && <p class="pv__excerpt">评级照片 · {info.place.name}</p>}
            {info?.day && (
              <div class="pv__actions">
                <button type="button" class="pv__action" data-press="scale" onClick={openJournal} data-testid="photo-open-journal">
                  <Glyph name="book" size={18} />
                  打开那天的日记
                </button>
                {info.mine && photo.source === 'journal' && (
                  <button type="button" class="pv__action" data-press="scale" onClick={editJournal} data-testid="photo-edit-journal">
                    <Glyph name="pen" size={18} />
                    编辑
                  </button>
                )}
              </div>
            )}
          </footer>
        </section>
      </div>
    </OverlayContext.Provider>
  );
}

/** 一张幻灯片的图：签名链接；加载前模糊占位（有缩略图就放大模糊缩略图），加载完淡入并把真实宽高比交回去 */
function SlideImage({ photo, alt, current, onSize }) {
  const url = useSignedUrl(photo?.path || null);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  const thumbSrc = useMemo(() => {
    const el = findThumb(photo?.path)?.querySelector?.('img');
    return el && el.complete && el.naturalWidth > 0 ? el.currentSrc || el.src : null;
  }, [photo?.path]);
  useEffect(() => {
    setLoaded(false);
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      onSize?.(img.naturalWidth / img.naturalHeight);
    }
  }, [url]);
  return (
    <>
      <span class="pv__ph" data-hidden={loaded ? '' : undefined} aria-hidden="true" style={thumbSrc ? { backgroundImage: `url("${thumbSrc}")` } : undefined} />
      {url && (
        <img
          ref={imgRef}
          class="pv__img"
          src={url}
          alt={alt}
          draggable={false}
          decoding="async"
          fetchpriority={current ? 'high' : 'low'}
          data-loaded={loaded ? '' : undefined}
          onLoad={(e) => {
            setLoaded(true);
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) onSize?.(img.naturalWidth / img.naturalHeight);
          }}
        />
      )}
      {!url && photo && <span class="pv__nourl" aria-hidden="true"><Glyph name="photo" size={28} /></span>}
    </>
  );
}

