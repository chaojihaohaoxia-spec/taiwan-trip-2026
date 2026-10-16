// =====================================================================
// pages/join/JoinPage.jsx：加入行程（路由 join，#/join/:code；SPEC §5.13）。
// 这一页没有外壳的顶栏、底栏（bare 外框），自己画：左上「行程列表」返回（登录了才有）、品牌、插图、宋体大标题，下面一张卡片。
//
// 卡片里按情况：
//   - 链接里的邀请码不对（少了几位、乱码）：说清楚 + 粘贴邀请码重新来（JoinCodeForm）；
//   - 还在确认登录：转圈；
//   - 没登录：本机记下这个邀请码（行程列表会提示「还有一个邀请没加入」）+「登录后加入」（登录页 ?next= 带回这一页）；
//   - 登录了：邀请码（大字）+「以 xxx@… 加入」（不是你？换个账号）+「确认加入」（SubmitButton：data.rpc.redeemInvite，要联网）；
//     data.rpc.peekInvite（RPC peek_invite，迁移 20261013200000_peek_invite.sql）：加入前先显示行程名、邀请人、加入后的权限；后台还没执行这个迁移时返回 null，加入后才显示；
//   - 加入成功：封面 + 行程名 + 日期 +「邀请人：Jeremy（创建者）」+ 你的权限 +「进入行程」；本来就是成员时说「你本来就在这趟行程里」；
//   - 失败：中文标题 + 说明 + 可能的原因（已过期 / 已用完 / 被撤销 / 复制少了几位，后台不区分）+ 重试或换一个邀请码。
// =====================================================================

import './join.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { data, authState, online, useMyTrips, normalizeInviteCode, loadTrip, sortTripsForList } from '../../data/index.js';
import { navigate, href } from '../../router/index.js';
import { local } from '../../lib/storage.js';
import { haptic } from '../../lib/native.js';
import { now } from '../../lib/clock.js';
import { Button } from '../../ui/Button.jsx';
import { IconButton } from '../../ui/IconButton.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Glyph } from '../../kit/index.js';
import { CoverDot } from '../../shell/CoverDot.jsx';
import { BackGlyph } from '../../shell/glyphs.jsx';
import { switcherDates } from '../../shell/format.js';
import { ROLE_LABELS } from '../trips/model.js';
import { joinErrorInfo, rememberInvite, forgetInvite, inviterLine } from './model.js';
import { JoinCodeForm } from './JoinCodeForm.jsx';
import { signOutFlow } from '../settings/account.js';

export default function JoinPage({ route }) {
  const raw = route.params.code || '';
  const code = useMemo(() => normalizeInviteCode(raw), [raw]);
  const auth = authState.value;
  const signedIn = auth.status === 'signed-in';

  // 没登录时打开了邀请链接：本机记下来（登录以后行程列表会提示继续加入）
  useEffect(() => {
    if (code && auth.status === 'signed-out') rememberInvite(local, code, now());
  }, [code, auth.status]);

  return (
    <div class="join" data-testid="page-join">
      {signedIn && (
        <IconButton icon={BackGlyph} label="回到行程列表" variant="glass" class="join__back" data-press-float="" onClick={() => navigate({ name: 'trips' })} data-testid="join-back" />
      )}
      <header class="join__hero">
        <p class="join__brand">热爱生活7885</p>
        <h1 class="join__title">加入行程</h1>
        <p class="join__lede">两个人看同一份行程、清单和账本，改了马上同步。</p>
      </header>
      <div class="join__card material-card">
        {!code ? (
          <BadLink raw={raw} />
        ) : auth.status === 'unknown' ? (
          <p class="join__wait" role="status" data-testid="join-wait"><Spinner size={20} />正在确认登录…</p>
        ) : !signedIn ? (
          <SignedOut code={code} />
        ) : (
          <JoinFlow code={code} />
        )}
      </div>
    </div>
  );
}

function CodeBlock({ code }) {
  return (
    <div class="join-code">
      <span class="join-code__label">邀请码</span>
      <span class="join-code__value" data-testid="join-code">{code}</span>
    </div>
  );
}

function BadLink({ raw }) {
  return (
    <div class="join-state" data-testid="join-bad">
      <h2 class="join-state__title">这个邀请链接不完整</h2>
      <p class="join-state__text">
        {raw ? `链接里的「${raw.slice(0, 40)}」不是邀请码。` : '链接里没有邀请码。'}
        邀请码是 12 位字母和数字（例如 38S7-72Q9-FTCZ），可能复制的时候少了几位。
      </p>
      <JoinCodeForm label="把对方发来的链接或邀请码粘贴在这里" replace testId="join-retype" />
    </div>
  );
}

function SignedOut({ code }) {
  const next = `#/join/${code}`;
  return (
    <div class="join-state" data-testid="join-signed-out">
      <CodeBlock code={code} />
      <p class="join-state__text">要先登录才能加入。登录以后会回到这一页，再点一下「确认加入」就好。</p>
      <Button size="lg" block href={href({ name: 'login', query: { next } })} data-testid="join-login">登录后加入</Button>
      <p class="join-state__fine">邀请码已经记在这台设备上：登录以后在行程列表里也能继续加入。</p>
    </div>
  );
}

function JoinFlow({ code }) {
  const auth = authState.value;
  const list = useMyTrips();
  const isOnline = online.value !== false;
  const [btn, setBtn] = useState('idle');
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(null);
  const [peek, setPeek] = useState(null);

  // 后台有「查看邀请」的 RPC 时，加入前先显示行程名和邀请人（现在的 RPC 不支持；见 README）
  useEffect(() => {
    const fn = data.rpc.peekInvite;
    if (typeof fn !== 'function' || !isOnline) return undefined;
    let alive = true;
    fn(code).then((p) => alive && setPeek(p)).catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [code]);

  const join = async () => {
    if (btn === 'loading' || btn === 'success') return;
    setBtn('loading');
    setError(null);
    const before = new Set((list.entries || []).map((e) => e.id));
    const t0 = performance.now();
    try {
      const tripId = await data.rpc.redeemInvite(code);
      // 读一下这趟行程（成员、创建者），好说「邀请人」；读不到也不影响加入
      let store = null;
      try {
        store = await Promise.race([loadTrip(tripId), new Promise((r) => setTimeout(() => r(null), 4000))]);
      } catch {
        store = null;
      }
      const left = 520 - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      forgetInvite(local);
      const entry = sortTripsForList(data.trips.state.value.entries || [], now()).find((e) => e.id === tripId) || null;
      const trip = store?.trip.value || entry?.trip || { id: tripId, title: '这趟行程' };
      const members = store?.view.members.value || [];
      setJoined({
        tripId,
        trip,
        already: before.has(tripId),
        inviter: inviterLine(members, trip, auth.user?.id || null),
        role: store?.view.myRole.value || entry?.role || null,
      });
      haptic('success');
      setBtn('success');
    } catch (e) {
      const left = 520 - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      setError(e);
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  // 换个账号：退出（有没同步的改动先问），这一页不用登录，退出后留在这里显示「登录后加入」
  const switchAccount = () => signOutFlow();

  if (joined && btn !== 'loading') return <Joined joined={joined} />;

  const info = error ? joinErrorInfo(error, { online: isOnline }) : null;
  return (
    <div class="join-state" data-testid="join-ready">
      {peek?.trip_title && (
        <div class="join-peek" data-testid="join-peek">
          <b>{peek.trip_title}</b>
          {peek.inviter_name && <span>邀请人：{peek.inviter_name}</span>}
          {peek.already_member ? <span>你已经是这趟行程的成员</span> : peek.role && <span>{peek.role === 'viewer' ? '加入后只能查看' : '加入后可以一起编辑'}</span>}
        </div>
      )}
      <CodeBlock code={code} />
      <p class="join-state__as">
        以 <b data-testid="join-as">{auth.user?.email || auth.user?.displayName}</b> 加入
        <button type="button" class="join-state__switch" data-press="scale" onClick={switchAccount} data-testid="join-switch">不是你？换个账号</button>
      </p>
      {info && (
        <div class={`join-error join-error--${info.kind}`} role="alert" data-testid="join-error" data-kind={info.kind}>
          <b>{info.title}</b>
          <p>{info.message}</p>
          {info.reasons.length > 0 && (
            <ul>
              {info.reasons.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
        </div>
      )}
      {!isOnline && !info && (
        <p class="join-note" role="status" data-testid="join-offline"><Glyph name="alert" size={16} />加入行程要联网，现在没有网络。</p>
      )}
      {info?.kind === 'invalid' ? (
        <>
          <JoinCodeForm label="换一个邀请码" replace testId="join-retype" />
          <Button variant="text" block href={href({ name: 'trips' })} data-testid="join-cancel">回到行程列表</Button>
        </>
      ) : (
        <>
          <SubmitButton
            block
            state={btn}
            label="确认加入"
            loadingLabel="正在加入"
            successLabel="已加入"
            errorLabel="重试"
            errorMessage={info?.title || '没有加入成功'}
            disabled={!isOnline}
            onClick={join}
            data-testid="join-submit"
          />
          <Button variant="text" block href={href({ name: 'trips' })} onClick={() => forgetInvite(local)} data-testid="join-cancel">先不加入</Button>
        </>
      )}
    </div>
  );
}

function Joined({ joined }) {
  const { trip, tripId, already, inviter, role } = joined;
  return (
    <div class="join-state join-state--done" data-testid="join-done">
      <div class="join-done">
        <span class="join-done__cover"><CoverDot trip={trip} shape="tile" /></span>
        <span class="join-done__eyebrow">{already ? '你本来就在这趟行程里' : '已加入'}</span>
        <b class="join-done__title" data-testid="join-trip-title">{trip.title}</b>
        <span class="join-done__dates">{trip.start_date ? switcherDates(trip) : '日期未定'}</span>
        {(inviter || role) && (
          <span class="join-done__meta" data-testid="join-inviter">
            {[inviter, role ? `你的权限：${ROLE_LABELS[role] || role}` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <Button size="lg" block onClick={() => navigate({ name: 'trip', params: { tripId } }, { replace: true, scroll: 'top' })} data-testid="join-open">进入行程</Button>
      <Button variant="text" block href={href({ name: 'trips' })}>看全部行程</Button>
    </div>
  );
}
