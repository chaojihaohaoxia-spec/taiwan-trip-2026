// =====================================================================
// pages/trip/TripPage.jsx：行程概览（路由 trip，#/t/:tripId）——用户每天打开最先看到的页面（SPEC §5.2）。
//
// 大标题（行程名 + 切换）、日期副标题、天数分段条「概览 · D1 …」都由外壳画（shell/FrameUI.jsx）；这一页只放分段条下面的内容，
// 按行程阶段分三种（store.view.phase）：
//   出发前  倒计时 + 去程航班、出发前待办（可直接勾）、免费取消截止、打包进度、目的地天气、每天概要（四天目录）
//   进行中  现在 / 接下来（导航 / 叫 Grab / 给司机看 / 记一笔 / 完成）、今晚住哪、天气一行、今天的待办、免费取消截止、明天
//           （「杂志纸本」：一屏一个主角，时间轴缩略、今天花了、备选池、每天安排不在概览上）
//   结束后  回顾（几天几晚、路线、数字）、总花费、谁该给谁、每天一张照片、评级最高、日记摘录、每天回顾
// 顺序按“这一刻最需要什么”（pages/trip/model.js 的 upcomingOrder / ongoingOrder），卡片都能点进对应详情。
//
// 状态：加载中骨架（数据到了以后卡片错落淡入）、出错（中文原因 + 重试）、找不到行程、只读成员（勾选 / 排进 / 完成都禁用并说明）、
//       离线（改动照常进写队列，外壳的同步条负责提示）。备选池在地点页（搜索结果里备选池的条目也跳到那里）。
// 纯逻辑在 model.js（单元测试 test/unit/page-overview.test.js），e2e 在 test/e2e/page-overview.e2e.mjs。
// =====================================================================

import './trip.css';
import { useEffect } from 'preact/hooks';
import { ErrorState, PageEmptyState, useNow } from '../../kit/index.js';
import { Button } from '../../ui/index.js';
import { href } from '../../router/index.js';
import { useOverviewTrip, useEnterStagger } from './hooks.js';
import { OverviewSkeleton } from './cards-shared.jsx';
import { UpcomingView, OngoingView, EndedView } from './views.jsx';

const APP_NAME = '热爱生活7885';

export default function TripPage({ route }) {
  const { tripId, store, trip, state } = useOverviewTrip(route);
  const entering = useEnterStagger(state);
  // 阶段、截止提醒、倒计时都和“现在”有关：每 30 秒刷新一次（页面在后台时不刷新）
  const at = useNow(30_000);
  const phase = state === 'ready' ? store.view.phase.value.phase : null;

  useEffect(() => {
    if (trip?.title && typeof document !== 'undefined') document.title = `${trip.title} · ${APP_NAME}`;
  }, [trip?.title]);

  let body;
  if (state === 'loading') body = <OverviewSkeleton />;
  else if (state === 'error') body = <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="ov-error" />;
  else if (state === 'missing') {
    body = (
      <PageEmptyState
        preset="notfound"
        title="找不到这趟行程"
        description="可能已经被删除，或者你不是这趟行程的成员。"
        action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
        testId="ov-missing"
      />
    );
  } else if (phase === 'ongoing') body = <OngoingView store={store} tripId={tripId} trip={trip} at={at} />;
  else if (phase === 'ended') body = <EndedView store={store} tripId={tripId} trip={trip} at={at} />;
  else body = <UpcomingView store={store} tripId={tripId} trip={trip} at={at} />;

  return (
    <div
      class="ov"
      data-testid="page-trip"
      data-state={state}
      data-phase={phase || undefined}
      data-entering={entering ? '' : undefined}
      aria-busy={state === 'loading' ? 'true' : undefined}
    >
      {body}
    </div>
  );
}
