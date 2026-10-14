// =====================================================================
// pages/PlaceholderPage.jsx：还没做的页面先显示这个占位页。
// 显示页面名、将来由哪块功能实现、当前路由参数（方便各模块联调路由）。
// =====================================================================

import { SkPage, SkHeader, SkCard, SkInfoRow, SkLinkRow } from './skeleton.jsx';
import { IconHome } from '../ui/icons.js';

const PURPOSE = {
  trip: '行程概览：倒计时、今天、下一项、预算、待确认',
  day: '当天时间轴：条目、路线卡、取舍说明、备选和雨天方案',
  map: '地图：当天路线、总路线、地点标记',
  ledger: '账本：记一笔、明细、按币种结算',
  bookings: '预订：航班、酒店、活动，已订 / 待确认 / 已付',
  lists: '清单：待确认、打包、待办、要买',
  journal: '日记和相册',
  places: '地点、想去清单、评级',
  tips: '贴士：防坑、消息模板、常用语、实用信息',
  settings: '设置：账号、主题、成员和邀请',
  join: '加入行程：输入或打开邀请码',
  login: '登录',
  'auth-callback': '登录回调：数据模块处理完会自动离开这一页',
};

function json(value) {
  return Object.keys(value || {}).length ? JSON.stringify(value) : '—';
}

export default function PlaceholderPage({ route }) {
  const title = route.meta?.title || route.name;
  return (
    <SkPage>
      <SkHeader showBack eyebrow="占位页" title={title} subtitle={PURPOSE[route.name] || '这一页还在建设中。'} />
      <SkCard title="路由信息" footer="这些值来自网址，刷新页面也不会丢。">
        <SkInfoRow label="路由名"><span class="sk-mono">{route.name}</span></SkInfoRow>
        <SkInfoRow label="路径"><span class="sk-mono">{route.path}</span></SkInfoRow>
        <SkInfoRow label="参数"><span class="sk-mono" data-testid="route-params">{json(route.params)}</span></SkInfoRow>
        <SkInfoRow label="查询参数"><span class="sk-mono">{json(route.query)}</span></SkInfoRow>
        <SkInfoRow label="弹层"><span class="sk-mono">{route.sheets.length ? route.sheets.map((s) => (s.arg ? `${s.id}:${s.arg}` : s.id)).join(' › ') : '—'}</span></SkInfoRow>
        <SkInfoRow label="历史序号"><span class="sk-mono">{route.index}</span></SkInfoRow>
      </SkCard>
      <SkCard>
        <SkLinkRow to={{ name: 'trips' }} leading={<IconHome size={20} />} title="回到首页" />
      </SkCard>
    </SkPage>
  );
}
