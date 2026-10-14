// =====================================================================
// pages/HomePage.jsx：骨架阶段的首页（路由 trips，#/trips）。
//
// 显示「骨架已就绪」、当前账号（可以退出登录）、运行环境、全部行程（数据层 useMyTrips：演示模式是两趟虚构行程，
// 正式环境是登录账号的行程）、全部页面入口、开发工具入口。
// 旧版快捷方式 ?go=today | ledger：行程列表到了以后跳到当前行程的今天 / 账本（data/ 的 resolveGo）。
// 行程列表模块完成后，用真正的「全部行程」页替换 pages/index.js 里的 trips 条目，这个文件删掉即可。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { SkPage, SkHeader, SkCard, SkLinkRow, SkInfoRow } from './skeleton.jsx';
import { isDemoMode, isDevToolsEnabled, appVersion, IS_DEV } from '../lib/env.js';
import { now } from '../lib/clock.js';
import { formatDateRange, formatTripPhase } from '../lib/datetime.js';
import { data, useMyTrips, authState, sortTripsForList, resolveGo } from '../data/index.js';
import { routes } from '../router/routes.js';
import { replace, setQuery } from '../router/index.js';
import { confirm, toast } from '../overlay/index.js';
import { IconFlask } from '../ui/icons.js';
import { swControlled } from '../lib/pwa.js';

const ROUTE_LABELS = {
  trip: '行程概览',
  day: '当天',
  map: '地图',
  ledger: '账本',
  bookings: '预订',
  lists: '清单',
  journal: '日记',
  places: '地点',
  tips: '贴士',
  settings: '设置',
  join: '加入行程',
  login: '登录',
};

const GO_LABELS = { today: '今日行程', ledger: '账本' };

function sampleParams(name, trip) {
  const tripId = trip?.id || 'demo-island';
  if (name === 'day') return { tripId, date: trip?.start_date || '2027-01-10' };
  if (name === 'join') return { code: '38S7-72Q9-FTCZ' };
  return { tripId };
}

/** 退出登录：还有没同步的改动时先问一句 */
async function signOut(setBusy) {
  setBusy(true);
  try {
    let r = await data.auth.signOut();
    if (!r.ok && r.reason === 'unsynced') {
      const ok = await confirm({
        title: '还有改动没同步',
        message: `有 ${r.pending} 条改动还没传到服务器，现在退出这些改动会丢掉。`,
        confirmText: '仍然退出',
        cancelText: '先不退出',
        destructive: true,
      });
      if (!ok) return;
      r = await data.auth.signOut({ discardUnsynced: true });
    }
    // 退出成功后数据层的守卫会把页面带到登录页
    if (!r.ok) toast.error('没有退出成功，请稍后再试');
  } catch (error) {
    toast.error(error?.message || '没有退出成功，请稍后再试');
  } finally {
    setBusy(false);
  }
}

/** 行程卡片底部的说明：出错 / 正在读 / 一个行程都没有 */
function tripsFooter(list, count) {
  if (list.status === 'error') return `行程列表没有加载成功：${list.error?.message || '请稍后再试'}`;
  if (count) return null;
  return list.status === 'ready' ? '还没有行程。' : '正在读取行程…';
}

export default function HomePage({ route }) {
  const demo = isDemoMode();
  const list = useMyTrips();
  const auth = authState.value;
  const [busy, setBusy] = useState(false);
  const entries = sortTripsForList(list.entries || [], now());
  const firstTrip = entries[0]?.trip;
  const go = route.query.go;
  const swState = swControlled.value ? '已启用（离线可用）' : IS_DEV ? '开发模式不启用' : '未启用';
  const user = auth.user;

  // 旧版快捷方式：行程列表到了就跳到当前行程的今天 / 账本（替换掉这一条历史，返回不会回到这里）
  useEffect(() => {
    if (!go || list.status !== 'ready') return;
    const target = resolveGo(go, list.entries, now());
    if (target) replace(target);
    else setQuery({ go: null });
  }, [go, list.status]);

  return (
    <SkPage>
      <SkHeader
        eyebrow="热爱生活7885 · v2"
        title="骨架已就绪"
        subtitle="路由、设计变量、动效、弹层、数据层、工具都已接进外壳，接下来往里面填页面。"
      />

      {go && (
        <p class="sk-notice" role="status">
          从旧版快捷方式进来，目标是「{GO_LABELS[go] || go}」，正在找当前行程…
        </p>
      )}

      <SkCard title="账号">
        <SkInfoRow label="当前登录">
          <span data-testid="account-name">{user ? (user.displayName || user.email) : '正在恢复登录…'}</span>
        </SkInfoRow>
        {user?.email && <SkInfoRow label="邮箱"><span class="sk-mono">{user.email}</span></SkInfoRow>}
        {user && (
          <div class="sk-actions">
            <button type="button" class="sk-button" data-press="scale" disabled={busy} onClick={() => signOut(setBusy)} data-testid="sign-out">
              {busy ? '正在退出…' : '退出登录'}
            </button>
          </div>
        )}
      </SkCard>

      <SkCard title="运行环境">
        <SkInfoRow label="版本"><span class="sk-mono">{appVersion()}</span></SkInfoRow>
        <SkInfoRow label="数据">{demo ? '演示数据（虚构，不连后台）' : 'Supabase 后台'}</SkInfoRow>
        <SkInfoRow label="离线缓存">{swState}</SkInfoRow>
      </SkCard>

      <SkCard
        title={demo ? '全部行程（演示）' : '全部行程'}
        footer={tripsFooter(list, entries.length)}
      >
        {entries.map(({ id, trip }) => (
          <SkLinkRow
            key={id}
            to={{ name: 'trip', params: { tripId: id } }}
            leading={trip.cover?.emoji || '✈️'}
            title={trip.title}
            detail={`${formatDateRange(trip.start_date, trip.end_date, { timeZone: trip.timezone })} · ${formatTripPhase(trip, now())}`}
            data-testid={`trip-${id}`}
          />
        ))}
      </SkCard>

      <SkCard title="页面一览" footer="除首页外都是占位页，点进去能看到路由参数。">
        {routes.filter((r) => ROUTE_LABELS[r.name]).map((r) => {
          const needsParams = r.path.includes(':');
          const to = { name: r.name, params: needsParams ? sampleParams(r.name, firstTrip) : {} };
          return (
            <SkLinkRow key={r.name} to={to} title={ROUTE_LABELS[r.name]} detail={<span class="sk-mono">{r.path}</span>} />
          );
        })}
      </SkCard>

      {isDevToolsEnabled() && (
        <SkCard title="开发工具（只在本机显示）">
          <SkLinkRow to={{ name: 'dev' }} leading={<IconFlask size={20} />} title="开发工具首页" detail="设计变量、基础组件、弹层、路由、第三方库、工具、数据层" />
        </SkCard>
      )}
    </SkPage>
  );
}
