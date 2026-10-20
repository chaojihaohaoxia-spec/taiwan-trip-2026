// =====================================================================
// sheets/driver/DriverSheet.jsx：「给司机看 / 给对方看」全屏大字卡（弹层 id: driver，SPEC §6）。
//
//   openDriverCard(place.id)        地点：最大号当地语名字（name_local），下面地址，再下面小字中文名；有电话才有「打电话」；
//                                   有下车点（extra.ride_via，SPEC §10）时显示下车点那个地点，再加一行下车提示（ride_note）
//   openDriverCard(tip.id)          贴士：最大号当地语原文（local_text），下面小字中文标题（「给对方看」）
//   也接受预订 / 条目 / 联系人的 id：取它关联的地点。参数写法见 sheets/README.md。
//
// 版式：白底墨字（深色模式：深墨底、米白字），用 --color-driver-bg / --color-text，对比度 ≥16:1；
//   字号自动适配：名字 32–72px（平板、桌面按宽度放大到 128px），地址不小于 28px（名字的 0.62 倍），二分查找能放下的最大字号；
//   到最小字号还放不下 → 中间那块可以上下滚动。横屏、转屏时重新算（ResizeObserver）。
// 关闭：点空白处（按钮以外的任何地方）、往下拉（过 110px 或甩一下）、右上角 ×、Esc、手机返回手势。
//   点空白处要等出场动画播完才算（打开时不小心点了两下，第二下不会把刚打开的卡关掉）。
// 动画（motion/ 的原语，和 overlay/AnchoredPanel 同一套）：
//   打开：从点的那个按钮长出来（morphFrom，clip 模式，不回弹的 smooth——全屏的卡过冲会露出背后的页面），
//         同时整张卡 0 → 1 淡入（--dur-base）：第 0 帧按钮原样看得见，白色的卡边长大边浮现，不会“按钮的字一下子没了、
//         变成一块白”；大字内容在形状长到 40%–90% 之间出现（contentFade: 'shape'）。
//         找不到按钮（刷新、分享链接打开）：淡入 + 从 0.97 放大。
//   关闭：按钮还在 → 原路收回到按钮（morphTo），一开始收就跟着淡（smooth 停稳时间的 15% 之后、--dur-base 缓出）：
//         大字内容在收回的前一小段就淡掉了，卡片也要一起变淡，不然中途是一块没有内容的白块（深色是黑块）缩回按钮；
//         往下拉关掉 → 接着手指速度滑出屏幕、同时变淡；其他 → 淡出。
//   减弱动态效果：只淡入淡出。
// 弹层的基础设施（网址联动、锁滚动、背景 inert、焦点进出、Esc）用 overlay/index.js 导出的 useOverlayRoute / useLayer / Portal，
// 和其他弹层一致（以后的自定义全屏弹层——看大图——照这个写）。
// =====================================================================

import './driver.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Portal, OverlayContext, useLayer, useOpenedGate, useOverlayRoute, findTrigger, anchorRect, uid, viewportInfo, fadeTo, prepareHidden, setPageCovered,
} from '../../overlay/index.js';
import { morphFrom, morphTo } from '../../motion/morph.js';
import { animateSpring, animateTween, stopAnimation, clearStyle } from '../../motion/animate.js';
import { trackDrag } from '../../motion/gesture.js';
import { clamp, num, rubberBand } from '../../motion/physics.js';
import { spring } from '../../motion/springs.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { driverCardFields, addressForCopy } from '../../lib/ride-links.js';
import { useCopy } from '../../lib/clipboard.js';
import { openExternal, haptic } from '../../lib/native.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { telHref } from '../../kit/place-actions.js';
import { useSheetTrip, findRow } from '../hooks.js';
import { translationCard } from './translation.js';
import { useSpeech } from '../../pages/tips/speech.js';
import { tipLang } from '../../pages/tips/model.js';

/** 名字的字号范围（px）；地址 = 名字 × ADDRESS_RATIO，但不小于 ADDRESS_MIN。
 *  上限在手机上是 72；屏幕更宽（平板、桌面）时按宽度放大，最大 NAME_MAX_WIDE */
export const NAME_MIN = 32;
export const NAME_MAX = 72;
export const NAME_MAX_WIDE = 128;
export const ADDRESS_RATIO = 0.62;
export const ADDRESS_MIN = 28;
/** 往下拉多远 / 多快算“关掉” */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 700;
/** 跟着形状出现 / 淡出的内容 */
const CONTENT = '.drv__top, .drv__main, .drv__bottom';
const CH_DRAG = 'drv-drag';
/** 收回到按钮时，从 smooth 弹簧停稳时间的多少开始淡（内容这时已经开始淡，卡片紧跟着） */
const EXIT_FADE_AT = 0.15;
const CH_FADE = 'drv-fade';

/**
 * 参数里的 id → 卡片内容。地点直接用；贴士用当地语原文；预订 / 条目 / 联系人取关联的地点。
 * @returns {null | { kind: 'place'|'tip', primary: string, address: string|null, secondary: string|null, phone: string|null,
 *                    copy: string, badge: string, lang?: string, note?: string|null }}
 */
export function driverContent(found, store) {
  if (!found) return null;
  const { table, row } = found;
  if (table === 'tips') {
    const local = (row.local_text || '').trim();
    if (!local) return { kind: 'tip', primary: row.title, address: null, secondary: null, phone: null, copy: row.title, badge: '给对方看' };
    return { kind: 'tip', primary: local, address: null, secondary: row.title, phone: null, copy: local, badge: '给对方看', lang: row.local_lang || tipLang(row) || undefined };
  }
  let place = table === 'places' ? row : null;
  if (!place && row.place_id) place = store?.tables?.places?.value?.get(row.place_id) || null;
  if (!place) return null;
  const placeTable = store?.tables?.places?.value;
  const o = { getPlace: (id) => placeTable?.get(id) || null };
  const f = driverCardFields(place, o);
  if (!f.primary) return null;
  return {
    kind: 'place', primary: f.primary, address: f.address, secondary: f.secondary, phone: f.phone, note: f.note,
    copy: addressForCopy(place, o), badge: '给司机看',
  };
}

/** 元素还看得见（触发按钮被别的弹层盖住、滚出屏幕时就不“收回到按钮”） */
function visibleRect(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const vp = viewportInfo();
  if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vp.height || r.right < 0 || r.left > vp.width) return null;
  return anchorRect(el);
}

export default function DriverSheet() {
  const ov = useOverlayRoute('driver', { kind: 'menu' });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <DriverLayer ov={ov} />
    </Portal>
  );
}

function DriverLayer({ ov }) {
  // 入场播完：整页被不透明的卡片盖住，关掉底下看不见的毛玻璃（overlay/dom.js 的 setPageCovered）；开始退场 / 卸载时还回去
  const covered = useRef(false);
  const cover = (on) => {
    if (covered.current === on) return;
    covered.current = on;
    setPageCovered(on);
  };
  useEffect(() => () => cover(false), []);
  const gate = useOpenedGate(() => cover(true));
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const mainRef = useRef(null);
  const textRef = useRef(null);
  const headingRef = useRef(null);
  const anchorEl = useRef(null);
  const motion = useRef({ token: 0, exit: null });
  const titleId = useMemo(() => uid('drv-title'), []);
  const [scrollable, setScrollable] = useState(false);
  const { copy, copied } = useCopy();
  const speech = useSpeech();

  const { store, pending } = useSheetTrip();
  // tr.<id>：翻译页的一句（存在这台手机里，不在行程数据里）
  const tr = translationCard(ov.arg);
  const found = tr ? null : findRow(store, ov.arg);
  const content = tr || driverContent(found, store);
  const loading = !content && pending;

  // ---------- 字号自动适配 ----------
  const fit = () => {
    const main = mainRef.current;
    const text = textRef.current;
    if (!main || !text) return;
    const avail = main.clientHeight;
    const width = main.clientWidth;
    const apply = (s) => text.style.setProperty('--drv-size', `${s}px`);
    const fits = () => text.scrollHeight <= avail + 0.5 && text.scrollWidth <= width + 0.5;
    let lo = NAME_MIN;
    let hi = Math.round(Math.min(NAME_MAX_WIDE, Math.max(NAME_MAX, width / 9)));
    apply(hi);
    if (fits()) lo = hi;
    else {
      apply(lo);
      if (fits()) {
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          apply(mid);
          if (fits()) lo = mid;
          else hi = mid;
        }
      }
    }
    apply(lo);
    const over = !fits();
    setScrollable(over);
    text.dataset.size = String(lo);
  };

  useLayoutEffect(fit, [content?.primary, content?.address, content?.secondary, loading]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  // ---------- 进出场 ----------
  /** 形变参数：大字内容跟着形状出现 / 淡出（卡片本身的浓淡另外用 CH_FADE 通道补间） */
  const SHAPE = { content: CONTENT, contentFade: 'shape' };

  // 挂上的第一帧先透明（不管是从按钮长出来还是淡入，都从 0 开始）
  useLayoutEffect(() => {
    const el = findTrigger('driver', ov.arg);
    anchorEl.current = el && el.isConnected ? el : null;
    prepareHidden(cardRef.current);
  }, []);

  const enter = () => {
    motion.current.token += 1;
    motion.current.exit = null;
    const card = cardRef.current;
    stopAnimation(card, CH_DRAG, { commit: false });
    clearStyle(card, ['translate']);
    const reduced = prefersReducedMotion.peek();
    const source = !reduced ? visibleRect(anchorEl.current) : null;
    gate.reset();
    // 浓淡的起点：刚挂上是 0；收回到一半又打开，从此刻的浓淡接着走
    const from = motion.current.shown ? Number(getComputedStyle(card).opacity) : 0;
    motion.current.shown = true;
    const fadeIn = (kind) => animateTween(card, [{ opacity: from }, { opacity: 1 }], {
      duration: kind === 'reduced' ? 'fast' : 'base', easing: kind === 'reduced' ? 'out' : 'standard', channel: CH_FADE, commit: 'final',
    });
    if (source) {
      const anim = morphFrom(card, source, { mode: 'clip', spring: 'smooth', fadeShadow: false, ...SHAPE });
      fadeIn('in');
      anim.finished.then((done) => done && gate.open());
    } else {
      const a = fadeIn(reduced ? 'reduced' : 'in');
      if (!reduced) {
        animateTween(card, [{ scale: '0.97' }, { scale: '1' }], { duration: 'slow', easing: 'out', channel: 'drv-scale' });
      }
      a.finished.then((done) => done && gate.open());
    }
  };

  const exit = () => {
    cover(false);
    motion.current.token += 1;
    const token = motion.current.token;
    const card = cardRef.current;
    const reduced = prefersReducedMotion.peek();
    const how = motion.current.exit;
    let anim;
    if (how?.kind === 'swipe' && !reduced) {
      // 往下拉关掉：接着手指的速度滑出屏幕，同时变淡
      const vh = viewportInfo().height;
      anim = animateSpring(card, {
        channel: CH_DRAG,
        from: { y: how.from },
        velocity: { y: Math.max(how.velocity, 0) },
        to: { y: vh },
        spring: 'smooth',
        commit: 'final',
        render: ({ y }) => ({ translate: `0 ${num(y)}px`, opacity: num(clamp(1 - y / (vh * 0.85), 0, 1)) }),
      });
    } else {
      const dest = !reduced ? visibleRect(anchorEl.current) : null;
      if (dest) {
        // 收回到按钮，同时整张卡跟着淡掉（内容先没，卡片紧跟着变淡，最后和按钮交接；等两个都播完才卸载）
        const shrink = morphTo(card, dest, { mode: 'clip', ...SHAPE });
        const fade = animateTween(card, [{ opacity: 0 }], {
          duration: 'base', easing: 'out', delay: spring('smooth').duration * EXIT_FADE_AT, channel: CH_FADE, commit: 'final',
        });
        anim = { finished: Promise.all([shrink.finished, fade.finished]).then((r) => r.every(Boolean)) };
      } else {
        anim = fadeTo(card, 0, reduced ? 'reduced' : 'out-slow', { channel: CH_FADE });
      }
    }
    anim.finished.then((done) => {
      if (!done || token !== motion.current.token) return;
      ov.onExited();
    });
  };

  useLayoutEffect(() => {
    if (ov.open) enter();
    else exit();
  }, [ov.open]);

  // 视口变了（转屏）：动画直接到位、重新排字
  useEffect(() => {
    if (!ov.open) return undefined;
    const onResize = () => {
      const card = cardRef.current;
      if (!card) return;
      stopAnimation(card, 'morph', { commit: false });
      clearStyle(card, ['transform', 'clipPath', 'transformOrigin']);
      for (const el of card.querySelectorAll(CONTENT)) {
        stopAnimation(el, 'morph', { commit: false });
        clearStyle(el, ['opacity']);
      }
      stopAnimation(card, CH_FADE, { commit: false });
      clearStyle(card, ['opacity']);
      gate.open();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ov.open]);

  useLayer(ov, { layerRef, focusRef: cardRef, closeOnEsc: true, initialFocus: () => headingRef.current });

  const close = (reason = 'action') => ov.requestClose(reason);
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);

  // ---------- 点空白处关闭、往下拉关闭 ----------
  const isControl = (t) => Boolean(t?.closest?.('button, a, input, [data-drv-keep]'));

  const onClick = (e) => {
    // 出场动画还没播完：不算（防误双击——第二下落在刚长出来的卡上）
    if (!ov.open || !gate.opened || isControl(e.target)) return;
    close('tap');
  };

  const onPointerDown = (e) => {
    if (!ov.open || isControl(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = cardRef.current;
    const main = mainRef.current;
    // 中间那块能滚动时：从那里开始的手势交给滚动（滚到顶再往下拉也不关，避免误关）
    if (scrollable && main?.contains(e.target)) return;
    let y = 0;
    trackDrag(e, {
      axis: 'y',
      element: card,
      onStart: () => {
        stopAnimation(card, CH_DRAG, { commit: false });
      },
      onMove: ({ dy }) => {
        y = dy > 0 ? dy : rubberBand(dy, 0, 0, 260);
        card.style.translate = `0 ${num(y)}px`;
        card.style.opacity = String(num(clamp(1 - Math.max(0, y) / 900, 0.6, 1)));
      },
      onEnd: ({ dy, vy }) => {
        if (dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY) {
          motion.current.exit = { kind: 'swipe', from: y, velocity: vy };
          haptic('light');
          close('drag');
          return;
        }
        animateSpring(card, {
          channel: CH_DRAG,
          from: { y },
          velocity: { y: vy },
          to: { y: 0 },
          spring: 'bouncy',
          commit: 'clear',
          render: ({ y: v }) => ({ translate: `0 ${num(v)}px`, opacity: num(clamp(1 - Math.max(0, v) / 900, 0.6, 1)) }),
        });
        clearStyle(card, ['opacity']);
      },
      onCancel: () => {
        animateSpring(card, {
          channel: CH_DRAG, from: { y }, to: { y: 0 }, spring: 'smooth', commit: 'clear', render: ({ y: v }) => ({ translate: `0 ${num(v)}px` }),
        });
        clearStyle(card, ['opacity']);
      },
    });
  };

  const tel = content?.phone ? telHref(content.phone) : null;
  // 当地语的一句（常用语、翻译）：这台设备有这种语言的声音就能「读出来」（评审 8：全屏这一页最需要读）
  const say = content?.kind === 'tip' && content.lang && content.copy && speech.can(content.lang) ? content.copy : null;
  const btnCount = 1 + (tel ? 1 : 0) + (say ? 1 : 0);

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer drv-layer"
        data-overlay-layer=""
        data-kind="menu"
        data-sheet-id="driver"
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <section
          ref={cardRef}
          class="drv"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-kind={content?.kind || 'empty'}
          data-scrollable={scrollable ? '' : undefined}
          data-testid="driver-card"
          onClick={onClick}
          onPointerDown={onPointerDown}
        >
          <div class="drv__top">
            <button type="button" class="drv__close" data-press="scale" aria-label="关闭" onClick={() => close('button')} data-testid="driver-close">
              <Glyph name="x" size={20} stroke={2.2} />
            </button>
            <span class="drv__badge">
              <Glyph name={content?.kind === 'tip' ? 'languages' : 'car'} size={18} />
              {content?.badge || '给司机看'}
            </span>
          </div>

          <div class="drv__main" ref={mainRef}>
            <div class="drv__text" ref={textRef} lang={content?.lang}>
              {content ? (
                <>
                  <h2 ref={headingRef} id={titleId} class="drv__primary" tabIndex={-1} data-testid="driver-primary">{content.primary}</h2>
                  {content.address && <p class="drv__address" data-testid="driver-address">{content.address}</p>}
                  {content.secondary && <p class="drv__secondary" lang="zh-CN" data-testid="driver-secondary">{content.secondary}</p>}
                  {content.note && <p class="drv__note" lang="zh-CN" data-testid="driver-note">{content.note}</p>}
                </>
              ) : (
                <>
                  <h2 ref={headingRef} id={titleId} class="drv__empty" tabIndex={-1}>{loading ? '正在读取…' : '找不到要显示的地点'}</h2>
                  {!loading && <p class="drv__secondary">可能已经被删除，或者不在这个行程里。</p>}
                </>
              )}
            </div>
          </div>

          <div class="drv__bottom">
            {content && (
              <div class={`drv__actions${btnCount > 1 ? ' drv__actions--two' : ''}`}>
                <button
                  type="button"
                  class="drv__btn"
                  data-press="scale"
                  data-testid="driver-copy"
                  onClick={() => copy(content.copy, { label: content.copyLabel || (content.kind === 'tip' ? '原文' : '地址') }).then((r) => r.ok && haptic('success'))}
                >
                  <Glyph name={copied ? 'check' : 'copy'} size={20} stroke={copied ? 2.4 : 1.9} />
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
                {say && (
                  <button
                    type="button"
                    class="drv__btn"
                    data-press="scale"
                    aria-pressed={speech.speaking === say ? 'true' : 'false'}
                    onClick={() => {
                      haptic('light');
                      speech.speak(say, content.lang);
                    }}
                    data-testid="driver-speak"
                  >
                    <Glyph name="speaker" size={20} />
                    <span>{speech.speaking === say ? '停' : '读出来'}</span>
                  </button>
                )}
                {tel && (
                  <a
                    class="drv__btn"
                    href={tel}
                    data-press="scale"
                    data-testid="driver-call"
                    onClick={(e) => {
                      e.preventDefault();
                      openExternal(tel);
                    }}
                  >
                    <Glyph name="call" size={20} />
                    <span>打电话</span>
                  </a>
                )}
              </div>
            )}
            <p class="drv__hint" aria-hidden="true">点空白处或往下拉关闭</p>
          </div>
        </section>
      </div>
    </OverlayContext.Provider>
  );
}
