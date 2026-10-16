// =====================================================================
// pages/launch/LaunchPage.jsx：启动页（路由 launch：网址没有 hash 或是 #/，包括从主屏图标启动——
// manifest 的 start_url 是 './'）。决定去哪，然后 replace 过去（不留历史：返回键不会回到这一页）。
//
// 规则（SPEC §4 末尾；纯函数在 shell/launch.js，单元测试覆盖）：
//   旧版快捷方式 ?go=today|ledger → 数据层的 resolveGo（当前行程的今天 / 账本）；
//   有进行中的行程 → 那一趟今天的 day 页；否则最近要出发的 → 概览；否则上次打开的行程 → 概览；再没有 → 行程列表。
//   显式打开 #/trips 永远是行程列表，不经过这里。行程列表加载失败（离线又没有缓存）→ 行程列表（那里显示原因和重试）。
//
// 数据没到之前显示品牌化的启动画面（和 index.html 的启动画面同一个位置、同样的字，启动画面淡出时看不出接缝；
// 多等一会儿出现转圈和「正在读取行程…」），底下是纸。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { replace } from '../../router/index.js';
import { useMyTrips, resolveGo } from '../../data/index.js';
import { now } from '../../lib/clock.js';
import { Spinner } from '../../ui/Spinner.jsx';
import { launchTarget } from '../../shell/launch.js';
import { lastTripId } from '../../shell/trip-state.js';
import './launch.css';

/** 多久还没决定就显示“正在读取行程…”（毫秒） */
const SLOW_MS = 700;

export default function LaunchPage({ route }) {
  const list = useMyTrips();
  const [slow, setSlow] = useState(false);
  const go = route.query.go;

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (list.status === 'error') {
      replace({ name: 'trips' }, { scroll: 'top' });
      return;
    }
    if (list.status !== 'ready') return;
    const at = now();
    const fromGo = go ? resolveGo(go, list.entries, at) : null;
    const target = fromGo || launchTarget({ entries: list.entries, lastTripId: lastTripId(), at });
    // 查询参数里的 go 用掉了就不再带；其他（例如 demo 相关的页面级参数不在 hash 里）不受影响
    replace(target, { scroll: 'top' });
  }, [list.status]);

  return (
    <div class="launch" data-testid="launch-page" aria-busy="true">
      <div class="launch__brand">
        <p class="launch__name">热爱生活7885</p>
        <p class="launch__text" role="status">{slow ? '正在读取行程…' : '正在打开…'}</p>
        <span class="launch__spin" data-shown={slow ? '' : undefined} aria-hidden="true"><Spinner size={20} /></span>
      </div>
    </div>
  );
}
