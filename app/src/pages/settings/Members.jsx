// =====================================================================
// pages/settings/Members.jsx：设置页「成员和邀请」——每趟行程一张可以原地展开的卡（一次只开一张，ui/ExpandableCard + useAccordion），
// 默认展开“当前行程”（上次打开的那趟；没有就列表第一趟）。
//
//   收起：封面点 + 行程名 +「2 位成员 · 你是创建者」
//   展开：成员（头像、名字、「我」、邮箱、角色芯片：创建者 / 可编辑 / 只读）
//         创建者：「邀请成员」（打开 invite 弹层，网址带 ?trip=<id>）；每位成员右边「⋯」小菜单：改成可编辑 / 改成只读 / 移出行程（先确认）
//         不是创建者：说明「只有创建者可以邀请」；自己那一行「退出这趟行程」（先确认）
//         能编辑的成员：「封面和主题色」（sheets/cover，网址带 ?trip=<id>）
// 成员数据在展开时才读（useTrip：卡片收起、离开设置页 15 秒后自动退订）。改角色、移出走数据层（写队列，离线也行）。
// =====================================================================

import { useState } from 'preact/hooks';
import { useTrip, authState } from '../../data/index.js';
import { navigate, route } from '../../router/index.js';
import { ExpandableCard, useAccordion } from '../../ui/ExpandableCard.jsx';
import { Avatar } from '../../ui/Avatar.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { Button } from '../../ui/Button.jsx';
import { IconButton } from '../../ui/IconButton.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Popover, MenuList, MenuItem, MenuSeparator, useOverlayTrigger, confirm, toast } from '../../overlay/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { CoverDot } from '../../shell/CoverDot.jsx';
import { ROLE_LABELS } from '../trips/model.js';
import { memberColor } from '../../kit/RatingChips.jsx';

const ROLE_TONE = { owner: 'accent', editor: 'success', viewer: 'neutral' };

const MoreGlyph = ({ size }) => <Glyph name="more" size={size} />;

/** 成员显示名：display_name → 邮箱 @ 前面 → 「成员」 */
export function memberDisplayName(m) {
  return m?.display_name || String(m?.email || '').split('@')[0] || '成员';
}

/**
 * @param {{ entries: Array<{ id: string, trip: object, role: string }>, currentId: string|null }} props
 */
export function MembersSection({ entries, currentId }) {
  const acc = useAccordion(currentId);
  if (!entries.length) {
    return <p class="set-empty" data-testid="settings-members-empty">还没有行程。新建一趟以后，可以在这里邀请对方加入。</p>;
  }
  return (
    <div class="set-trips" data-testid="settings-members">
      {entries.map((e) => (
        <ExpandableCard
          key={e.id}
          {...acc.bind(e.id)}
          lazy
          class="set-trip"
          leading={<CoverDot trip={e.trip} class="set-trip__dot" />}
          title={e.trip.title}
          subtitle={e.role === 'owner' ? '你是创建者' : e.role === 'viewer' ? '你是只读成员' : '你可以编辑'}
          data-testid={`settings-trip-${e.id}`}
        >
          <TripMembers entry={e} />
        </ExpandableCard>
      ))}
      <MemberMenu />
    </div>
  );
}

function TripMembers({ entry }) {
  const store = useTrip(entry.id);
  const me = authState.value.user?.id || null;
  const ready = store && store.trip.value;
  if (!ready) {
    if (store?.status.value === 'error') {
      return (
        <p class="set-note set-note--warning" role="status">
          {store.error.value?.message || '成员没有读出来，请稍后再试'}
          <button type="button" class="set-note__btn" data-press="scale" onClick={() => store.refresh()}>重试</button>
        </p>
      );
    }
    return (
      <div class="set-members" aria-busy="true">
        <span class="visually-hidden" role="status">正在读取成员…</span>
        {[0, 1].map((i) => (
          <div key={i} class="set-member">
            <Skeleton variant="circle" size={40} />
            <div class="set-member__text"><Skeleton variant="text" width="40%" /><Skeleton variant="text" width="64%" /></div>
          </div>
        ))}
      </div>
    );
  }
  const members = store.view.members.value;
  const isOwner = store.view.myRole.value === 'owner';
  const openInvite = (e) => {
    const r = route.peek();
    navigate({ name: 'settings', query: { ...(r?.query || {}), trip: entry.id }, sheets: [{ id: 'invite' }] }, { scroll: 'keep' });
    e?.currentTarget?.blur?.();
  };
  // 封面和主题色（sheets/cover）：设置页不在行程里，网址带 ?trip=<id>
  const openCover = (e) => {
    const r = route.peek();
    navigate({ name: 'settings', query: { ...(r?.query || {}), trip: entry.id }, sheets: [{ id: 'cover' }] }, { scroll: 'keep' });
    e?.currentTarget?.blur?.();
  };
  const leave = async () => {
    const ok = await confirm({
      title: `退出「${entry.trip.title}」？`,
      message: '退出以后这趟行程会从你的列表里消失，要创建者重新邀请才能回来。你写的日记和评级会留在行程里。',
      confirmText: '退出行程',
      cancelText: '先不退出',
      destructive: true,
    });
    if (!ok) return;
    try {
      store.removeMember(me);
      toast.success('已退出这趟行程');
    } catch (err) {
      toast.error(err?.message || '没有退出成功');
    }
  };
  return (
    <div class="set-members" data-testid={`settings-members-${entry.id}`}>
      <ul class="set-member-list">
        {members.map((m) => {
          const you = m.user_id === me;
          return (
            <li key={m.user_id} class="set-member" data-testid={`settings-member-${m.user_id}`}>
              <Avatar name={memberDisplayName(m)} color={memberColor(m, memberDisplayName(m))} decorative />
              <span class="set-member__text">
                <b>
                  {memberDisplayName(m)}
                  {you && <span class="set-member__you">我</span>}
                </b>
                {m.email && <span>{m.email}</span>}
              </span>
              <Badge tone={ROLE_TONE[m.role] || 'neutral'} size="sm">{ROLE_LABELS[m.role] || m.role}</Badge>
              {isOwner && !you && m.role !== 'owner' && <MemberMenuButton tripId={entry.id} member={m} />}
            </li>
          );
        })}
      </ul>
      {isOwner ? (
        <Button variant="tinted" block leading={<Glyph name="plus" size={18} stroke={2.2} />} onClick={openInvite} data-testid={`settings-invite-${entry.id}`}>
          邀请成员
        </Button>
      ) : (
        <div class="set-members__foot">
          <p class="set-note">只有创建者可以邀请新成员、改成员的权限。</p>
          {me && (
            <Button variant="danger-soft" size="sm" onClick={leave} data-testid={`settings-leave-${entry.id}`}>退出这趟行程</Button>
          )}
        </div>
      )}
      {store.view.canEdit.value && (
        <Button variant="secondary" block leading={<Glyph name="photo" size={18} />} onClick={openCover} data-testid={`settings-cover-${entry.id}`}>
          封面和颜色
        </Button>
      )}
    </div>
  );
}

const MENU_ID = 'member-menu';

function MemberMenuButton({ tripId, member }) {
  const arg = `${tripId}~${member.user_id}`;
  const t = useOverlayTrigger(MENU_ID, { arg, haspopup: 'menu' });
  return (
    <IconButton
      {...t.props}
      icon={MoreGlyph}
      label={`${memberDisplayName(member)} 的权限`}
      variant="fill"
      size="sm"
      class="set-member__more"
      data-testid={`settings-member-menu-${member.user_id}`}
    />
  );
}

/** 成员的小菜单（页面里无条件渲染一次；按参数知道是哪趟、哪个人） */
function MemberMenu() {
  return (
    <Popover sheetId={MENU_ID} label="成员权限" placement="below" align="end" width={290}>
      {({ arg }) => <MemberMenuBody arg={arg} />}
    </Popover>
  );
}

function MemberMenuBody({ arg }) {
  const [tripId, userId] = String(arg || '').split('~');
  const store = useTrip(tripId || null);
  const [busy, setBusy] = useState(false);
  const m = store?.view.membersByUser.value.get(userId);
  if (!m) return <p class="set-note">正在读取…</p>;
  const name = memberDisplayName(m);
  const setRole = (role) => {
    try {
      store.setMemberRole(userId, role);
      toast.success(`已把 ${name} 改成「${ROLE_LABELS[role]}」`);
    } catch (err) {
      toast.error(err?.message || '没有改成功');
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await confirm({
      title: `把 ${name} 移出行程？`,
      message: '移出以后对方看不到这趟行程了；要回来得重新邀请。对方写的日记和评级会留下。',
      confirmText: '移出',
      cancelText: '取消',
      destructive: true,
    });
    setBusy(false);
    if (!ok) return;
    try {
      store.removeMember(userId);
      toast.success(`已把 ${name} 移出行程`);
    } catch (err) {
      toast.error(err?.message || '没有移出成功');
    }
  };
  return (
    <MenuList>
      {m.role !== 'editor' && <MenuItem label="改成可编辑" detail="能改行程、清单、账本" icon={<Glyph name="pen" size={18} />} onSelect={() => setRole('editor')} testId="member-role-editor" />}
      {m.role !== 'viewer' && <MenuItem label="改成只读" detail="只能看，自己的日记和评级还能写" icon={<Glyph name="show" size={18} />} onSelect={() => setRole('viewer')} testId="member-role-viewer" />}
      <MenuSeparator />
      <MenuItem label="移出行程" tone="danger" icon={<Glyph name="trash" size={18} />} onSelect={remove} testId="member-remove" />
    </MenuList>
  );
}
