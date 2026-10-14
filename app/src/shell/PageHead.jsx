// =====================================================================
// shell/PageHead.jsx：页面大标题（在内容里、随页面滚走；样稿的 .lt：宋体 40px 大标题 + 副标题）。
//
// - 行程 tab（概览 / 某一天 / 地图 / 账本）：大标题 = 行程名（第一段）+ 圆形下拉箭头，整块是按钮，点了从标题长出行程切换面板；
//   副标题 = 行程名后半段 + 日期区间（Geist 等宽数字）。
// - 二级页面：大标题 = 页面名，副标题 = 行程名；左边让出返回按钮的位置（返回按钮在顶栏里，固定不动）。
// - 行程列表 / 设置：大标题 = 页面名。
// 大标题和顶栏同一条横带（离顶 --topbar-inset，高 --topbar-bar-h），右边让出搜索 / 页面按钮的位置。
// 名字太长、一行放不下 40px 时退到 28px（title-1）；再长就省略号。
// 往下滚时整块淡出、微微缩小（Frame 的滚动处理逐帧写 opacity / transform），胶囊随后在顶栏正中出现，交接不叠字。
// 行程数据还没到：标题和副标题位置画骨架条（不闪空白、不跳布局）。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useResizeObserver } from '../motion/hooks.js';
import { MorphIcon } from '../ui/MorphIcon.jsx';

/**
 * @param {{ chrome: object, headRef: any, switcherProps: object|null, switcherOpen: boolean, covered: boolean }} props
 */
export function PageHead({ chrome, headRef, switcherProps, switcherOpen, covered }) {
  const bandRef = useRef(null);
  const nameRef = useRef(null);
  const [fit, setFit] = useState('lg');
  const title = chrome.title;

  // 一行放不下大号字就换小一号（先按大号量）
  const check = () => {
    const band = bandRef.current;
    const name = nameRef.current;
    if (!band || !name) return;
    band.removeAttribute('data-fit');
    const over = name.scrollWidth > name.clientWidth + 1;
    band.setAttribute('data-fit', over ? 'sm' : 'lg');
    setFit(over ? 'sm' : 'lg');
  };
  useResizeObserver(bandRef, check);
  useLayoutEffect(() => {
    check();
    let alive = true;
    document.fonts?.ready?.then(() => alive && check());
    return () => {
      alive = false;
    };
  }, [title]);

  if (chrome.kind === 'bare') return null;
  // 一直是胶囊（全屏地图）：不画大标题，但整页还要有一个 h1（读屏按标题跳转），视觉上藏起来
  if (chrome.collapse === 'always') {
    return chrome.loading ? null : <h1 class="visually-hidden" data-testid="shell-head-hidden">{title}</h1>;
  }
  const loading = chrome.loading;
  const name = <span ref={nameRef} class="shell-head__name">{loading ? ' ' : title}</span>;

  return (
    <div
      ref={headRef}
      class="shell-head"
      data-kind={chrome.kind}
      data-back={chrome.back ? '' : undefined}
      data-loading={loading ? '' : undefined}
      data-covered={covered ? '' : undefined}
      data-testid="shell-head"
    >
      <div ref={bandRef} class="shell-head__band" data-fit={fit}>
        <h1 class="shell-head__h1">
          {chrome.switcher ? (
            <button type="button" class="shell-head__title" data-press="scale" data-testid="shell-title" {...(switcherProps || {})} aria-label={loading ? '正在读取行程' : `${title}，切换行程`}>
              {name}
              {!loading && <span class="chev-chip chev-chip--lg" aria-hidden="true"><MorphIcon kind="chevron" state={switcherOpen} size={18} /></span>}
            </button>
          ) : (
            <span class="shell-head__title">{name}</span>
          )}
        </h1>
        {loading && <span class="shell-head__skel shell-head__skel--title" aria-hidden="true" />}
      </div>
      {(chrome.subtitle || loading) && (
        <p class="shell-head__sub">
          {loading ? <span class="shell-head__skel shell-head__skel--sub" aria-hidden="true" /> : chrome.subtitle}
        </p>
      )}
    </div>
  );
}
