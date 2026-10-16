// =====================================================================
// shell/overlays/SwitcherPanel.jsx：行程切换面板（sheet id switcher；样稿 02-行程切换面板.png、12-帧条）。
//
// 从被点的标题原位长出来（overlay/AnchoredPanel：大标题、顶栏胶囊、整条顶栏里的行程按钮都是它的触发按钮，
// 哪个被点就从哪个长出来）；面板停在屏幕顶上（盖住顶栏，样稿同款），标题这时在顶栏里淡掉（Frame 的 covered）。
//   - 头：当前行程的封面点 +「切换行程」+「N 趟 · 点一下切换」+ 收起按钮（↑）；
//   - 列表：每趟一行（封面方块、名称、日期「10-16 周五 – 10-19 周一 · 3 晚」（和全站同一种写法）、阶段：进行中 / N 天后出发 / 已结束 · 回顾），
//     当前那趟描边 + 实心对勾；按「进行中 → 未开始 → 已结束」排（数据层 sortTripsForList）；
//   - 点一趟：触感，换过去并留在同一种页面（在账本就去新行程的账本；在概览 / 某一天就去新行程的概览），
//     面板收回到新的标题上，主题色一起过渡（trip-state；纸不变）；
//   - 底部：「全部行程」（行程列表）和「新建行程」（sheet id trip-new，sheets/ 的 openTripNewSheet）；
//   - 键盘：打开时焦点落在当前那趟上；↑ ↓ / Home / End 在行程之间移动，回车换过去，Esc 收起。
// 列表在面板长出来之前就渲染好（缓存先到），长出来的动画期间不做重活。
// =====================================================================

import './overlays.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AnchoredPanel } from '../../overlay/AnchoredPanel.jsx';
import { closeOverlay, findTrigger, isOverlayOpen } from '../../overlay/manager.js';
import { animateTween } from '../../motion/animate.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { route, navigate, href } from '../../router/index.js';
import { useMyTrips, useSignedUrl, sortTripsForList, selectors } from '../../data/index.js';
import { now } from '../../lib/clock.js';
import { safeAreaInsets } from '../../lib/media.js';
import { haptic } from '../../lib/native.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { openTripNewSheet } from '../../sheets/index.js';
import { CoverDot } from '../CoverDot.jsx';
import { switcherDates, phaseChip, parseYmd } from '../format.js';
import { switchTarget } from '../view-rules.js';
import { tripInfo } from '../trip-state.js';

/** 面板顶边停在安全区下面 8px：按被点的那个标题算出 AnchoredPanel 的 gap（负数 = 盖住标题） */
function panelGap() {
  const el = findTrigger('switcher');
  if (!el || !el.isConnected) return 8;
  const r = el.getBoundingClientRect();
  return Math.round(safeAreaInsets().top + 8 - r.bottom);
}

function TripCover({ trip }) {
  const url = useSignedUrl(trip.cover?.image_path || null);
  return (
    <span class="sw__cover">
      <CoverDot trip={trip} shape="tile" />
      {url && <img class="sw__photo" src={url} alt="" loading="lazy" decoding="async" />}
    </span>
  );
}

/**
 * 标题是透明底（没有按钮颜色可以“变成面板”）：面板的玻璃跟着长大从半透明变实（开），收回时先变透明、
 * 下面的标题同时淡回来（关）——标题和面板交叉淡化（样稿 12-帧条），不会有一块白板压着标题收回去。
 * 收回用缓出、--dur-fast（一开始就快速变淡，约 120ms 就看不见了）：面板里的内容在收回的前一小段就淡掉了，玻璃要跟着一起淡，
 * 不然中途会剩一块空的磨砂框缩回标题（外壳评审）。
 */
function useTitleCrossfade() {
  const open = isOverlayOpen('switcher');
  useLayoutEffect(() => {
    if (prefersReducedMotion.peek()) return undefined;
    const run = (panel) => {
      if (open) animateTween(panel, [{ opacity: 0.25 }, { opacity: 1 }], { duration: 'base', easing: 'in-out', channel: 'sw-fade' });
      else animateTween(panel, [{ opacity: 0 }], { duration: 'fast', easing: 'out', channel: 'sw-fade', fill: 'forwards' });
    };
    const panel = document.querySelector('.sw-panel');
    if (panel) {
      run(panel);
      return undefined;
    }
    if (!open) return undefined;
    // 面板画在弹层挂载点里另一个渲染根（Portal），可能比这里晚一拍才挂上（列表刚到、弹层路由刚认领）：
    // 挂上的那一刻再开始（MutationObserver 在绘制之前回调，第 0 帧就是半透明，不会先闪一帧实心的面板）
    const mo = new MutationObserver(() => {
      const p = document.querySelector('.sw-panel');
      if (!p) return;
      mo.disconnect();
      run(p);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [open]);
}

/** 点中另一趟行程后，面板停多久再收回、换页（先让对勾跳过去，确认点中了；样稿 17-帧条 140ms 时面板还开着、对勾已在新行程上） */
const PICK_HOLD_MS = 140;

export default function SwitcherPanel() {
  useTitleCrossfade();
  const open = isOverlayOpen('switcher');
  /** 刚点中、还在停顿里的行程 id（对勾先跳过去） */
  const [picked, setPicked] = useState(null);
  const holdTimer = useRef(0);
  // 停顿期间面板被关掉（Esc、返回）：不换页了；下次打开从头来
  useEffect(() => {
    if (open) return undefined;
    clearTimeout(holdTimer.current);
    setPicked(null);
    return undefined;
  }, [open]);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  const list = useMyTrips();
  const r = route.value;
  const current = r?.params?.tripId || null;
  const at = now();
  const entries = sortTripsForList(list.entries || [], at);
  const info = tripInfo.value;
  const loading = list.status !== 'ready' && !entries.length;

  // 面板长出来时按内容量好高度、之后不再变：列表还没到（直接打开带 ?sheet=switcher 的网址）就先不挂，
  // 到了再从标题长出来（外壳启动时已经预先加载列表，平时点标题时列表早就在了）
  if (loading && list.status !== 'error') return null;

  const pick = (id) => {
    if (picked) return;
    haptic('selection');
    if (id === current) {
      closeOverlay('switcher');
      return;
    }
    const go = () => navigate(switchTarget(route.peek(), id), { scroll: 'top' });
    if (prefersReducedMotion.peek()) {
      go();
      return;
    }
    setPicked(id);
    holdTimer.current = setTimeout(go, PICK_HOLD_MS);
  };
  const checked = picked || current;

  // 键盘：打开时焦点在当前那趟（data-autofocus）；↑ ↓ 在行程之间移动，Home / End 到第一趟 / 最后一趟
  const onListKey = (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...e.currentTarget.querySelectorAll('.sw__trip')];
    const at = items.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const to = step ? Math.max(0, Math.min(items.length - 1, at + step)) : e.key === 'Home' ? 0 : items.length - 1;
    items[to]?.focus();
  };

  return (
    <AnchoredPanel
      sheetId="switcher"
      placement="below"
      align="start"
      width={520}
      gap={panelGap()}
      label="切换行程"
      class="sw-panel"
      testId="switcher-panel"
    >
      {({ close }) => (
        <div class="sw" data-accent-follow="">
          <div class="sw__head">
            <CoverDot info={info} />
            <span class="sw__htext">
              <b>切换行程</b>
              <i>{`${entries.length} 趟 · 点一下切换`}</i>
            </span>
            <button type="button" class="sw__close" data-press="scale" aria-label="收起" onClick={() => close('button')}>
              <Glyph name="chev-u" size={20} stroke={2.2} />
            </button>
          </div>
          {list.status === 'error' && !entries.length ? (
            <p class="sw__empty" role="alert">行程列表没有加载成功：{list.error?.message || '请稍后再试'}</p>
          ) : (
            <ul class="sw__list" onKeyDown={onListKey}>
              {entries.map(({ id, trip }) => {
                const phase = selectors.tripPhase(trip, at);
                const chip = phaseChip(phase);
                const on = id === checked;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      class="sw__trip"
                      data-press="scale"
                      data-autofocus={id === current ? '' : undefined}
                      aria-current={on ? 'true' : undefined}
                      data-picked={picked === id ? '' : undefined}
                      data-testid={`switcher-trip-${id}`}
                      onClick={() => pick(id)}
                    >
                      <TripCover trip={trip} />
                      <span class="sw__info">
                        <b>{trip.title}</b>
                        <i>{switcherDates(trip, { thisYear: parseYmd(phase.today)?.y ?? null })}</i>
                        <span class="sw__chip" data-tone={chip.tone}>{chip.text}</span>
                      </span>
                      <span class="sw__check" aria-hidden="true"><Glyph name="check" size={16} stroke={2.6} /></span>
                    </button>
                  </li>
                );
              })}
              {list.status === 'ready' && !entries.length && <li class="sw__empty">还没有行程。</li>}
            </ul>
          )}
          <div class="sw__foot">
            <a href={href({ name: 'trips' })} class="sw__btn" data-press="scale" data-testid="switcher-all">
              <Glyph name="list" size={18} />全部行程
            </a>
            <button
              type="button"
              class="sw__btn sw__btn--new"
              data-press="scale"
              data-testid="switcher-new"
              onClick={() => closeOverlay('switcher', { force: true }).then(() => openTripNewSheet())}
            >
              <Glyph name="plus" size={18} />新建行程
            </button>
          </div>
        </div>
      )}
    </AnchoredPanel>
  );
}
