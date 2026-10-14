// =====================================================================
// shell/SyncBar.jsx：同步状态条（顶栏下方正中的一颗小胶囊；数据层的 syncStatus）。
//
//   离线          「离线 · 3 条改动联网后自动同步」（警示色点）
//   正在同步      「正在同步 2 条改动…」（转圈；超过 1.2 秒还没同步完才出来，快的不打扰）
//   重试中        「1 条改动暂时没同步上，稍后自动重试」+「重试」
//   出错          「有改动没保存成功：……」+「重试」「放弃」（危险色点）
//   行程没加载成  「行程没有加载成功」+「重试」
//   本机存储不可用 数据层的 storageWarning（警示色点）
//   恢复正常      闪一下「已同步」（成功色点，1.6 秒后收起）
// 出现：从上面滑下来 + 淡入（--spring-snappy）；收起：淡出上移；换文字时交叉淡化（CSS）。
// 不挡标题：条出现时页面大标题区下面让出同样的高度（onSpace 把高度交给 Frame，写进 --shell-sync-space，分段条和正文往下挪）；
// 有副标题、顶栏还没收起时条放在副标题下面（belowSub），不插在大标题和副标题中间。
// =====================================================================

import './syncbar.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring, animateTween, stopAnimation } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { Spinner } from '../ui/Spinner.jsx';
import { dataApi } from './trip-state.js';
import { syncBanner } from './view-rules.js';

export { syncBanner };

/** 正在同步要持续多久才显示（毫秒） */
const SYNC_DELAY_MS = 1200;
/** 「已同步」停留多久（毫秒） */
const DONE_MS = 1600;
const CH = 'sync-bar';

const DONE = Object.freeze({ key: 'synced', tone: 'success', message: '已同步', retry: false, discard: false, busy: false, delayed: false });

/**
 * @param {{ onSpace?: (px: number) => void }} props
 */
export function SyncBar({ onSpace, belowSub = false }) {
  const api = dataApi.value;
  const status = api?.syncStatus.value || null;
  const wanted = syncBanner(status);
  /** 想显示的内容（延迟、「已同步」都算好以后） */
  const [target, setTarget] = useState(null);
  /** 正在显示的内容（收起动画播完才清空） */
  const [view, setView] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const hadProblem = useRef(false);
  const ref = useRef(null);
  const visible = useRef(false);

  useEffect(() => {
    let timer = 0;
    if (wanted?.delayed) {
      timer = setTimeout(() => {
        hadProblem.current = true;
        setTarget(wanted);
      }, SYNC_DELAY_MS);
    } else if (wanted) {
      hadProblem.current = true;
      setTarget(wanted);
    } else if (hadProblem.current && status?.state === 'synced') {
      hadProblem.current = false;
      setTarget(DONE);
      timer = setTimeout(() => setTarget(null), DONE_MS);
    } else {
      setTarget(null);
    }
    return () => clearTimeout(timer);
  }, [wanted?.key, wanted?.message, status?.state]);

  useEffect(() => {
    if (target) {
      setView(target);
      setLeaving(false);
    } else if (view) {
      setLeaving(true);
    }
  }, [target]);

  // 出现 / 收起的动画
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (view && !leaving && !visible.current) {
      visible.current = true;
      animateSpring(el, {
        channel: CH,
        from: { y: -10, o: 0 },
        to: { y: 0, o: 1 },
        spring: 'snappy',
        commit: 'clear',
        render: ({ y, o }) => ({ transform: `translateY(${num(y)}px)`, opacity: num(Math.min(1, Math.max(0, o))) }),
      });
    } else if (view && leaving) {
      visible.current = false;
      animateTween(el, [{ opacity: 0, transform: 'translateY(-8px)' }], { duration: 'fast', easing: 'in', channel: CH, fill: 'forwards' })
        .finished.then((done) => {
          if (!done) return;
          stopAnimation(el, CH, { commit: false });
          setView(null);
          setLeaving(false);
        });
    }
  }, [view, leaving]);

  // 让出高度（副标题往下挪）
  useLayoutEffect(() => {
    const el = ref.current;
    onSpace?.(view && !leaving && el ? el.offsetHeight + 8 : 0);
  }, [view, leaving]);

  if (!view) return null;
  return (
    <div ref={ref} class="sync-bar" data-tone={view.tone} data-below-sub={belowSub ? '' : undefined} role="status" aria-live="polite" data-testid="sync-bar" data-state={view.key} data-accent-follow="">
      {view.busy ? <Spinner size={14} class="sync-bar__spin" /> : <span class="sync-bar__dot" aria-hidden="true" />}
      <span class="sync-bar__text" key={view.message}>{view.message}</span>
      {view.retry && (
        <button type="button" class="sync-bar__btn" data-press="scale" onClick={() => api?.data.retrySync()}>重试</button>
      )}
      {view.discard && (
        <button type="button" class="sync-bar__btn sync-bar__btn--quiet" data-press="scale" onClick={() => api?.data.discardFailed()}>放弃</button>
      )}
    </div>
  );
}
