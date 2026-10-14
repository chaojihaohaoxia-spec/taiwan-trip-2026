// =====================================================================
// pages/trips/TripsPage.jsx：行程列表（路由 trips，#/trips；SPEC §5.1）。
//
// 外壳画大标题「全部行程」和右上的设置按钮（root 外框，没有底栏），这一页只放内容：
//   - 一句话总览「3 趟旅行 · 下一趟 5 天后出发」+ 列表 ↔ 网格切换（ui/ViewToggle，图标变形；本机记住）；
//   - 按阶段分组：进行中（段标题右边「打开今天」直接到今天的安排）→ 接下来 → 回顾 → 已归档；
//     每趟一张卡片（TripCard：主题色渐变封面 + emoji / 封面照片、名称、日期、几天几晚、阶段芯片、只读标记），
//     列表 ↔ 网格时卡片的底板、封面、文字各自 FLIP（ui/ViewSwitch）；
//   - 新建行程（sheets/trip-new 弹层，提交按钮转圈打勾，成功后直接进新行程）；
//   - 空状态：还没有行程（新建 / 粘贴邀请码加入）；没登录时打开过邀请链接、还没加入（本机记着邀请码）→「等你加入」；
//   - 底部账号条：当前账号、退出登录（有没同步的改动先确认）；
//   - 旧版快捷方式 ?go=today|ledger（路由把 ?shortcut= 换成 #/trips?go=…）：列表到了就 replace 到当前行程的今天 / 账本。
//     打开网站本身（#/?go=）由启动页 LaunchPage 处理，这里只管 #/trips?go=。
// 状态：加载中骨架 → 交叉淡入；出错（中文原因 + 重试）；有缓存但刷新失败（离线）时列表照常显示、顶上一句说明。
// =====================================================================

import './trips.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { now } from '../../lib/clock.js';
import { local } from '../../lib/storage.js';
import { haptic } from '../../lib/native.js';
import { useMyTrips, resolveGo, data, authState } from '../../data/index.js';
import { replace, setQuery, href } from '../../router/index.js';
import { Button } from '../../ui/Button.jsx';
import { Avatar } from '../../ui/Avatar.jsx';
import { Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { ViewSwitch, ViewToggle } from '../../ui/ViewSwitch.jsx';
import { Card, PageEmptyState, ErrorState, Glyph, useNow } from '../../kit/index.js';
import { openTripNewSheet } from '../../sheets/index.js';
import { TripCard } from './TripCard.jsx';
import { groupTrips, tripCardInfo, todayInfo, tripsSummary, normalizeView, VIEW_KEY, GO_LABELS } from './model.js';
import { pendingInvite, forgetInvite } from '../join/model.js';
import { JoinCodeForm } from '../join/JoinCodeForm.jsx';
import { signOutFlow } from '../settings/account.js';
import { memberColor } from '../../kit/RatingChips.jsx';

export default function TripsPage({ route }) {
  const list = useMyTrips();
  const at = useNow(60_000);
  const go = route.query.go;
  const entries = list.entries || [];

  // 旧版快捷方式：列表到了就跳到当前行程的今天 / 账本（替换掉这一条历史，返回不会回到这里）
  useEffect(() => {
    if (!go || list.status !== 'ready') return;
    const target = resolveGo(go, list.entries, now());
    if (target) replace(target);
    else setQuery({ go: null });
  }, [go, list.status]);

  const state = !entries.length && list.status === 'error' ? 'error' : !entries.length && list.status !== 'ready' ? 'loading' : 'ready';

  return (
    <div class="trips" data-testid="page-trips">
      {go && (
        <p class="trips-note trips-note--info" role="status" data-testid="trips-go">
          <Glyph name="route" size={16} />
          <span>从旧版快捷方式进来，正在打开当前行程的「{GO_LABELS[go] || go}」…</span>
        </p>
      )}
      {state === 'error' ? (
        <ErrorState error={list.error} onRetry={() => data.trips.load({ fresh: true })} testId="trips-error" />
      ) : (
        <Reveal loading={state === 'loading'} skeleton={<TripsSkeleton />} class="trips__reveal">
          {state === 'ready' && <TripsBody list={list} entries={entries} at={at} />}
        </Reveal>
      )}
      {state !== 'loading' && <AccountBar color={(() => { const m = entries.find((e) => e.member?.color)?.member; return m ? memberColor(m) : undefined; })()} />}
    </div>
  );
}

/** 加载中：总览一行 + 三张卡片 */
function TripsSkeleton() {
  return (
    <div class="trips-skel">
      <span class="visually-hidden" role="status">正在读取行程…</span>
      <div class="trips-skel__bar">
        <Skeleton variant="text" width={150} />
        <Skeleton variant="circle" size={44} />
      </div>
      {[0.62, 0.48, 0.56].map((w, i) => (
        <div key={i} class="trips-skel__card material-card">
          <Skeleton variant="rect" width={72} height={72} radius="md" />
          <div class="trips-skel__text">
            <Skeleton variant="text" width={`${Math.round(w * 100)}%`} />
            <Skeleton variant="text" width="54%" />
            <Skeleton variant="rect" width={92} height={22} radius="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

function readView() {
  return normalizeView(local.get(VIEW_KEY, 'list'));
}

function TripsBody({ list, entries, at }) {
  const [view, setView] = useState(readView);
  /** 「不加入了」以后重画一次（邀请码记在本机存储里，不在状态里） */
  const [, bump] = useState(0);
  const ordered = useMemo(() => groupTrips(entries, at).flatMap((g) => g.entries), [entries, at]);
  const today = useMemo(() => todayInfo(ordered, at), [ordered, at]);
  const invite = pendingInvite(local, at);
  const changeView = (v) => {
    const next = normalizeView(v);
    haptic('selection');
    setView(next);
    local.set(VIEW_KEY, next);
  };

  if (!entries.length) {
    return (
      <div class="trips-empty">
        {invite ? (
          <PageEmptyState
            preset="invited"
            description={`你在这台设备上打开过一个邀请链接（邀请码 ${invite.code}），还没有加入。`}
            action={(
              <div class="trips-empty__actions">
                <Button size="lg" block href={href({ name: 'join', params: { code: invite.code } })} data-testid="trips-invite-continue">继续加入</Button>
                <Button variant="text" block onClick={() => { forgetInvite(local); bump((n) => n + 1); }} data-testid="trips-invite-forget">不加入了</Button>
              </div>
            )}
            testId="trips-invited"
          />
        ) : (
          <PageEmptyState
            preset="trips"
            action={(
              <div class="trips-empty__actions">
                <Button size="lg" block leading={<Glyph name="plus" size={20} stroke={2.2} />} onClick={(e) => openTripNewSheet({ keyboard: true, trigger: e.currentTarget })} data-testid="trips-new">
                  新建行程
                </Button>
              </div>
            )}
            testId="trips-empty"
          />
        )}
        {!invite && (
          <div class="trips-join material-card">
            <JoinCodeForm label="对方发来了邀请？" testId="trips-join" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="trips-body">
      {list.error && (
        <p class="trips-note trips-note--warning" role="status" data-testid="trips-stale">
          <Glyph name="alert" size={16} />
          <span>{list.error.kind === 'network' ? '现在没有网络，显示的是这台设备上次保存的行程。' : '行程列表没有刷新成功，显示的是上次保存的。'}</span>
          <button type="button" class="trips-note__btn" data-press="scale" onClick={() => data.trips.load({ fresh: true })}>重试</button>
        </p>
      )}
      {invite && (
        <a class="trips-invite material-card" href={href({ name: 'join', params: { code: invite.code } })} data-press="scale" data-testid="trips-invite">
          <span class="trips-invite__icon" aria-hidden="true"><Glyph name="message" size={20} /></span>
          <span class="trips-invite__text">
            <b>还有一个邀请没加入</b>
            <span>邀请码 {invite.code} · 点这里继续</span>
          </span>
          <span class="trips-invite__chev" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
        </a>
      )}
      <div class="trips-bar">
        <p class="trips-bar__summary" data-testid="trips-summary">{tripsSummary(entries, at)}</p>
        <ViewToggle value={view} onChange={changeView} data-testid="trips-view" />
      </div>
      {today && (
        <a class="trips-today material-card" href={href(today.to)} data-press="scale" data-testid="trips-today">
          <span class="trips-today__icon" aria-hidden="true"><Glyph name="sun" size={22} /></span>
          <span class="trips-today__text">
            <b>今天：{today.title}</b>
            <span>{today.phrase} · 打开今天的安排</span>
          </span>
          <span class="trips-today__chev" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
        </a>
      )}
      <ViewSwitch
        view={view}
        items={ordered}
        label="全部行程"
        class="trips-grid"
        data-testid="trips-list"
        renderItem={(entry) => <TripCard entry={entry} info={tripCardInfo(entry, at)} view={view} />}
      />
      <Button
        variant="secondary"
        block
        class="trips-new"
        leading={<Glyph name="plus" size={20} stroke={2.2} />}
        onClick={(e) => openTripNewSheet({ keyboard: true, trigger: e.currentTarget })}
        data-testid="trips-new"
      >
        新建行程
      </Button>
    </div>
  );
}

/** 底部账号条（kit 的卡片，小内边距）：当前账号 + 退出登录（有没同步的改动先确认） */
function AccountBar({ color }) {
  const auth = authState.value;
  const user = auth.user;
  const [busy, setBusy] = useState(false);
  if (!user && auth.status !== 'unknown') return null;
  const name = user ? user.displayName || user.email : '正在恢复登录…';
  const out = async () => {
    setBusy(true);
    try {
      await signOutFlow();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="sm" class="trips-account" aria-label="账号" testId="trips-account">
      <div class="trips-account__row">
        {user && <Avatar name={user.displayName || user.email} color={color} decorative size="sm" />}
        <span class="trips-account__text">
          <b data-testid="account-name">{name}</b>
          {user?.email && <span>{auth.offline ? `${user.email} · 离线中` : user.email}</span>}
        </span>
        {user && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={out} data-testid="sign-out">
            {busy ? '正在退出…' : '退出登录'}
          </Button>
        )}
      </div>
    </Card>
  );
}
