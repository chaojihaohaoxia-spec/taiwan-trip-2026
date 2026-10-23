// =====================================================================
// sheets/invite/InviteSheet.jsx：弹层「invite」——邀请成员（SPEC §5.12）。
//
// 打开：设置页「每趟行程」里创建者的「邀请成员」（网址带 ?trip=<id>）；行程内页面也能开（路径里的 :tripId）。
// 参数：openInviteSheet({ role: 'viewer' }) 预选只读（sheets/index.js）。
//
//   顶上：邀请到哪一趟（封面点 + 行程名）
//   设置：加入后的权限（可编辑 / 只读，下面一句说明）、有效期（1 / 7 / 30 天）、能用几次（1 / 5 次）——三个分段控件，指示块弹簧跟随
//   「生成邀请链接」：SubmitButton（文字 → 转圈 → 对勾；data.rpc.createInvite，要联网）→ 换成结果：
//       大号邀请码（只显示这一次：库里只存哈希）、链接 #/join/<码>、「分享给对方」（lib/native.js 的 share：系统分享，
//       不支持就复制）、「复制链接」、说明「可编辑 · 7 天内有效（到 …）· 能用 1 次」、「再生成一个」
//   已发出的邀请（出场动画播完才去读，要联网）：状态芯片（有效 / 已用完 / 已过期 / 已撤销）、权限、用了几次、什么时候到期；
//       有效的可以「撤销」（先确认）。离线：说明 + 重试。
// 只有创建者能邀请（data 层的 RPC 也允许可编辑成员，这里按产品要求只给创建者）；不是创建者打开时说明原因。
// =====================================================================

import './invite.css';
import { useEffect, useState } from 'preact/hooks';
import { Sheet, confirm, toast, useOverlay } from '../../overlay/index.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { CoverDot } from '../../shell/CoverDot.jsx';
import { data, online } from '../../data/index.js';
import { copyText } from '../../lib/clipboard.js';
import { share, haptic } from '../../lib/native.js';
import { now } from '../../lib/clock.js';
import { deviceTimeZone } from '../../lib/datetime.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { ROLE_OPTIONS, ROLE_HINTS, VALID_OPTIONS, USES_OPTIONS, inviteShareText, inviteMeta, inviteMetaParts, inviteRowInfo, sortInvites } from './model.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function InviteSheet() {
  return (
    <Sheet sheetId="invite" title="邀请成员" detents={['content', 'large']} testId="sheet-invite">
      {({ arg }) => <InviteBody key={arg ?? 'new'} />}
    </Sheet>
  );
}

function InviteBody() {
  const { fields } = useSheetArgs();
  const { tripId, store, pending } = useSheetTrip();
  const trip = store?.trip.value || null;

  if (!tripId) {
    return <EmptyState compact title="不知道要邀请到哪一趟" description="从「设置 → 每趟行程」里点某一趟的「邀请成员」。" data-testid="invite-no-trip" />;
  }
  if (!trip) {
    if (!pending && store && (store.status.value === 'error' || store.status.value === 'missing')) {
      return <EmptyState compact title="没有读到这趟行程" description={store.error.value?.message || '请稍后再试'} data-testid="invite-error" />;
    }
    return (
      <div class="ivf" aria-busy="true" data-testid="invite-loading">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={56} radius="lg" />
        <Skeleton variant="rect" height={44} radius="pill" />
        <Skeleton variant="rect" height={44} radius="pill" />
        <Skeleton variant="rect" height={56} radius="pill" />
      </div>
    );
  }
  const isOwner = store.view.myRole.value === 'owner';
  return (
    <div class="ivf" data-testid="invite-body">
      <div class="ivf-trip">
        <CoverDot trip={trip} />
        <span class="ivf-trip__text">
          <span class="ivf-trip__eyebrow">邀请对方加入</span>
          <b>{trip.title}</b>
        </span>
      </div>
      {isOwner ? <InviteMaker trip={trip} tripId={tripId} initialRole={fields.role === 'viewer' ? 'viewer' : 'editor'} /> : (
        <p class="ivf-note" data-testid="invite-not-owner">
          <Glyph name="info" size={16} />
          只有这趟行程的创建者可以邀请新成员。需要邀请谁，跟创建者说一声。
        </p>
      )}
      {isOwner && <InviteList tripId={tripId} />}
    </div>
  );
}

function InviteMaker({ trip, tripId, initialRole }) {
  const [role, setRole] = useState(initialRole);
  const [validHours, setValid] = useState(168);
  const [maxUses, setUses] = useState(1);
  const [made, setMade] = useState(null);
  const [btn, setBtn] = useState('idle');
  const [fail, setFail] = useState('');
  const isOnline = online.value !== false;
  const tz = deviceTimeZone();

  const generate = async () => {
    if (btn === 'loading' || btn === 'success') return;
    setBtn('loading');
    setFail('');
    const t0 = performance.now();
    try {
      const code = await data.rpc.createInvite(tripId, { role, validHours, maxUses });
      const link = data.rpc.inviteLink(code);
      const left = 480 - (performance.now() - t0);
      if (left > 0) await wait(left);
      setMade({ code, link, role, validHours, maxUses, at: now() });
      haptic('success');
      setBtn('success');
      document.dispatchEvent(new CustomEvent('invite-created'));
    } catch (e) {
      const left = 480 - (performance.now() - t0);
      if (left > 0) await wait(left);
      setFail(e?.kind === 'network' ? '生成邀请要联网：连上网络后再点一次' : e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有生成成功，请再试一次');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  if (made && btn !== 'loading') {
    return <InviteResult trip={trip} made={made} tz={tz} onAgain={() => { setMade(null); setBtn('idle'); }} />;
  }

  return (
    <div class="ivf-form" data-testid="invite-form">
      <div class="ivf-field">
        <span class="ivf-label" id="ivf-role">加入后的权限</span>
        <SegmentedControl block label="加入后的权限" options={ROLE_OPTIONS} value={role} onChange={(v) => { haptic('selection'); setRole(v); }} data-testid="invite-role" />
        <p class="ivf-hint">{ROLE_HINTS[role]}</p>
      </div>
      <div class="ivf-field">
        <span class="ivf-label">有效期</span>
        <SegmentedControl block label="有效期" options={VALID_OPTIONS} value={validHours} onChange={(v) => { haptic('selection'); setValid(v); }} data-testid="invite-valid" />
      </div>
      <div class="ivf-field">
        <span class="ivf-label">能用几次</span>
        <SegmentedControl block label="能用几次" options={USES_OPTIONS} value={maxUses} onChange={(v) => { haptic('selection'); setUses(v); }} data-testid="invite-uses" />
        <p class="ivf-hint">发给一个人用 1 次就够；过期、用完或撤销以后，链接就打不开了。</p>
      </div>
      {!isOnline && (
        <p class="ivf-note ivf-note--warning" role="status" data-testid="invite-offline">
          <Glyph name="alert" size={16} />
          生成邀请要联网，现在没有网络。
        </p>
      )}
      {fail && btn === 'error' && <p class="ivf-error" role="alert" data-testid="invite-error-msg">{fail}</p>}
      <SubmitButton
        block
        state={btn}
        label="生成邀请链接"
        loadingLabel="正在生成"
        successLabel="已生成"
        errorMessage={fail || '没有生成成功'}
        disabled={!isOnline}
        onClick={generate}
        data-testid="invite-generate"
      />
    </div>
  );
}

function InviteResult({ trip, made, tz, onAgain }) {
  const [copied, setCopied] = useState(false);
  const text = inviteShareText(trip, made.link, { role: made.role });
  const doShare = async () => {
    // 要在点击回调里同步发起（Safari 只认用户手势）
    const r = await share({ title: `加入「${trip.title}」`, text, url: made.link });
    if (r.ok && r.method !== 'copy') haptic('success');
  };
  const doCopy = async () => {
    const r = await copyText(made.link, { label: '邀请链接' });
    if (r.ok) {
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div class="ivf-made" data-testid="invite-result">
      <div class="ivf-code material-card">
        <span class="ivf-code__eyebrow">邀请码 · 只显示这一次</span>
        <span class="ivf-code__value" data-testid="invite-code">{made.code}</span>
        <span class="ivf-code__link" data-testid="invite-link">{made.link}</span>
        <span class="ivf-code__meta" aria-label={inviteMeta(made, made.at, tz)}>
          {inviteMetaParts(made, made.at, tz).map((p, i) => <span key={i} class="ivf-nowrap">{i > 0 && ' · '}{p}</span>)}
        </span>
      </div>
      <div class="ivf-actions">
        <Button size="lg" block leading={<Glyph name="message" size={20} />} onClick={doShare} data-testid="invite-share">分享给对方</Button>
        <Button variant="secondary" block leading={<Glyph name={copied ? 'check' : 'copy'} size={18} />} onClick={doCopy} data-testid="invite-copy">
          {copied ? '已复制链接' : '复制链接'}
        </Button>
      </div>
      <p class="ivf-hint">对方打开链接、登录后点「确认加入」就行。关掉这个面板以后邀请码就看不到了（链接照样有效）；要再发，重新生成一个。</p>
      <Button variant="text" block onClick={onAgain} data-testid="invite-again">再生成一个</Button>
    </div>
  );
}

function InviteList({ tripId }) {
  const ov = useOverlay();
  const [state, setState] = useState({ status: 'loading', rows: [], error: null });
  const [n, setN] = useState(0);
  const tz = deviceTimeZone();
  const at = now();

  useEffect(() => {
    let alive = true;
    (async () => {
      await (ov?.whenOpened?.() || Promise.resolve());
      if (!alive) return;
      setState((s) => ({ ...s, status: s.rows.length ? 'refreshing' : 'loading', error: null }));
      try {
        const rows = await data.rpc.loadInvites(tripId);
        if (alive) setState({ status: 'ready', rows: sortInvites(rows), error: null });
      } catch (error) {
        if (alive) setState((s) => ({ ...s, status: 'error', error }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId, n]);

  // 刚生成了一个：列表跟着刷新
  useEffect(() => {
    const on = () => setN((x) => x + 1);
    document.addEventListener('invite-created', on);
    return () => document.removeEventListener('invite-created', on);
  }, []);

  const revoke = async (row) => {
    const ok = await confirm({
      title: '撤销这个邀请？',
      message: '撤销以后这个链接就打不开了。已经用它加入的人不受影响（要移出的话在成员列表里操作）。',
      confirmText: '撤销',
      cancelText: '不撤销',
      destructive: true,
    });
    if (!ok) return;
    try {
      await data.rpc.revokeInvite(row.id);
      toast.success('已撤销');
      setN((x) => x + 1);
    } catch (e) {
      toast.error(e?.kind === 'network' ? '撤销要联网，现在没有网络' : e?.message || '没有撤销成功');
    }
  };

  return (
    <section class="ivf-list" aria-labelledby="ivf-list-title" data-testid="invite-list">
      <h3 class="ivf-list__title" id="ivf-list-title">已发出的邀请{state.rows.length ? <span class="ivf-list__count">{state.rows.length}</span> : null}</h3>
      {state.status === 'loading' && (
        <div class="ivf-rows" aria-busy="true">
          {[0, 1].map((i) => <div key={i} class="ivf-row"><Skeleton variant="rect" width={52} height={22} radius="pill" /><Skeleton variant="text" width="60%" /></div>)}
        </div>
      )}
      {state.status === 'error' && (
        <p class="ivf-note ivf-note--warning" role="status" data-testid="invite-list-error">
          <Glyph name="alert" size={16} />
          <span>{state.error?.kind === 'network' ? '看邀请记录要联网，现在没有网络。' : state.error?.message || '邀请记录没有读出来。'}</span>
          <button type="button" class="ivf-note__btn" data-press="scale" onClick={() => setN((x) => x + 1)}>重试</button>
        </p>
      )}
      {(state.status === 'ready' || state.status === 'refreshing') && !state.rows.length && <p class="ivf-hint">还没有发过邀请。</p>}
      {state.rows.length > 0 && (
        <ul class="ivf-rows">
          {state.rows.map((r) => {
            const info = inviteRowInfo(r, at, tz);
            return (
              <li key={r.id} class="ivf-row" data-state={r.state} data-testid={`invite-row-${r.id}`}>
                <Badge tone={info.tone} size="sm">{info.stateLabel}</Badge>
                <span class="ivf-row__text">
                  <b>{info.role} · {info.usage}</b>
                  <span>{info.when}</span>
                </span>
                {info.active && <Button size="sm" variant="danger-soft" onClick={() => revoke(r)} data-testid={`invite-revoke-${r.id}`}>撤销</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
