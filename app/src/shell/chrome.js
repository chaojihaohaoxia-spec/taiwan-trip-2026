// =====================================================================
// shell/chrome.js：页面“外框”的规则（哪种页面有什么顶栏、底栏）+ 页面声明顶栏内容的 hook usePageChrome()。
//
// 页面分五种（chromeKind）：
//   tab      行程 tab 的四个页面：trip（概览）/ day（某一天）/ map / ledger。
//            大标题 = 行程名（点开行程切换面板），副标题 = 日期区间，右上搜索；有底栏。trip / day 还有天数分段条。
//   section  行程里的二级页面：bookings / lists / journal / places / tips / contacts（从「更多」进来）。
//            左上返回（有历史就返回，没有就回行程概览），大标题 = 页面名，副标题 = 行程名，右上搜索；
//            有底栏（指示块停在「更多」上：这些页面都住在「更多」里面）。
//   root     行程列表 trips：大标题「全部行程」，右上设置按钮；没有底栏。
//   settings 设置：左上返回，大标题「设置」；没有底栏、没有搜索。
//   bare     启动页、登录、加入行程、登录回调、找不到页面、开发页：什么框都不画（只有纸）。
//
// 底栏只在行程里（tab、section）出现：底栏的五个入口（行程 / 地图 / ＋ / 账本 / 更多）都要知道“哪一趟”，
// 行程列表和设置不属于任何一趟，所以那里不显示底栏；进了行程底栏从底部升上来，离开行程降下去。
//
// 页面声明自己的顶栏（都可选，不调就用上面的默认值）：
//   usePageChrome({ title, subtitle, back, actions, collapse, search, dayStrip })
//     title / subtitle  覆盖默认的大标题 / 副标题（字符串或元素）
//     back              true / false（显示返回按钮），或一个路由目标（没有历史可退时去那里）
//     actions           右上搜索按钮左边的按钮（建议 <IconButton variant="glass" …/>，最多两个）
//     collapse          'auto'（默认：大标题随滚动收成胶囊）| 'always'（一直是胶囊、不显示大标题，例如全屏地图；
//                       页面里仍有一个读屏用的隐藏 h1）| 'never'（不收成胶囊：滚过大标题后一直是整条顶栏，标题、副标题一直看得见）
//     search            false = 不要右上搜索
//     dayStrip          false = trip / day 页不要天数分段条
// =====================================================================

import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { route } from '../router/index.js';

export {
  TAB_OF, SECTION_PAGES, SECTION_TITLES, TABBAR_SLOTS, chromeKind, activeTab, tabIndex, hasTabBar, dayStripIndex,
  defaultChrome, mergeChrome, CHROME_KEYS,
} from './rules.js';
import { CHROME_KEYS as KEYS } from './rules.js';

/** 页面用 usePageChrome() 声明的内容（{ owner, path, ...选项 }；页面卸载时清掉） */
export const declaredChrome = signal(null);

/** 顶栏此刻的状态（top / pill / bar；FrameUI 按滚动算好写进来，首屏代码——演示角标——也要读） */
export const topbarState = signal('top');
/** 同步状态条出现时大标题下面让出的高度（px；SyncBar 量、FrameUI 写；> 0 = 同步条正在显示） */
export const syncSpace = signal(0);

function sameOptions(a, b) {
  if (!a || !b) return false;
  return KEYS.every((k) => a[k] === b[k]) && a.path === b.path && a.owner === b.owner;
}

/**
 * 页面声明顶栏内容（见文件开头）。页面组件里无条件调用；选项变了会跟着更新，页面卸载时自动撤销。
 * @param {{ title?: any, subtitle?: any, back?: boolean|object, actions?: any, collapse?: 'auto'|'always'|'never',
 *           search?: boolean, dayStrip?: boolean }} [options]
 */
export function usePageChrome(options = {}) {
  const owner = useRef(null);
  if (!owner.current) owner.current = {};
  const path = useRef(route.peek()?.path);
  useLayoutEffect(() => {
    const next = { owner: owner.current, path: path.current };
    for (const k of KEYS) if (options[k] !== undefined) next[k] = options[k];
    if (!sameOptions(declaredChrome.peek(), next)) declaredChrome.value = next;
  });
  useLayoutEffect(() => () => {
    if (declaredChrome.peek()?.owner === owner.current) declaredChrome.value = null;
  }, []);
}
