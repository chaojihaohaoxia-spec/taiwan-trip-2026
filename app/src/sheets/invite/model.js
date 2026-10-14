// =====================================================================
// sheets/invite/model.js：邀请成员弹层的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//   ROLE_OPTIONS / VALID_OPTIONS / USES_OPTIONS   三个分段控件的选项
//   inviteShareText(trip, link, o)                系统分享 / 复制时的那段话
//   inviteMeta(o, at, tz)                         「可编辑 · 7 天内有效（到 10月20日 21:30）· 能用 1 次」
//   inviteRowInfo(row, at, tz)                    已发出的邀请一行：状态芯片、角色、用了几次、什么时候过期 / 撤销的
//   sortInvites(rows)                             有效的在前，其余按生成时间新 → 旧
// =====================================================================

import { formatInstant } from '../../lib/datetime.js';

export const ROLE_OPTIONS = Object.freeze([
  { value: 'editor', label: '可编辑' },
  { value: 'viewer', label: '只读' },
]);
export const ROLE_HINTS = Object.freeze({
  editor: '能改行程、清单、账本，和你一样（除了邀请和改权限）',
  viewer: '只能看；自己的日记和评级还能写',
});
export const VALID_OPTIONS = Object.freeze([
  { value: 24, label: '1 天' },
  { value: 168, label: '7 天' },
  { value: 720, label: '30 天' },
]);
export const USES_OPTIONS = Object.freeze([
  { value: 1, label: '1 次' },
  { value: 5, label: '5 次' },
]);

const ROLE_NAMES = Object.freeze({ editor: '可编辑', viewer: '只读', owner: '创建者' });
const STATE_TONES = Object.freeze({ active: 'success', used: 'neutral', expired: 'warning', revoked: 'neutral' });

/** 有效期的说法：24 → '1 天'，168 → '7 天'，36 → '36 小时' */
export function validLabel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return '';
  return h % 24 === 0 ? `${h / 24} 天` : `${h} 小时`;
}

/** 分享的那段话（对方在微信 / WhatsApp 里看到的） */
export function inviteShareText(trip, link, { role = 'editor' } = {}) {
  const title = String(trip?.title || '').trim() || '我们的行程';
  return `一起用「热爱生活7885」看「${title}」的行程、清单和账本吧：点下面的链接，登录后确认加入（${ROLE_NAMES[role] || '可编辑'}）。\n${link}`;
}

/**
 * 刚生成的邀请的说明。
 * @param {{ role: string, validHours: number, maxUses: number }} o
 */
export function inviteMetaParts({ role, validHours, maxUses }, at = new Date(), timeZone = 'Asia/Hong_Kong') {
  const until = new Date(at.getTime() + Number(validHours) * 3600_000);
  return [
    ROLE_NAMES[role] || role,
    `${validLabel(validHours)}内有效（到 ${formatInstant(until, { timeZone, at })}）`,
    `能用 ${maxUses} 次`,
  ];
}

export function inviteMeta(o, at = new Date(), timeZone = 'Asia/Hong_Kong') {
  return inviteMetaParts(o, at, timeZone).join(' · ');
}

/**
 * 已发出的邀请一行（data.rpc.loadInvites 的结果：带 state / stateLabel）。
 * @returns {{ id: string, tone: string, stateLabel: string, role: string, usage: string, when: string, active: boolean }}
 */
export function inviteRowInfo(row, at = new Date(), timeZone = 'Asia/Hong_Kong') {
  const state = row?.state || 'active';
  const when = state === 'revoked' && row.revoked_at
    ? `${formatInstant(row.revoked_at, { timeZone, at })} 撤销`
    : state === 'expired'
      ? `${formatInstant(row.expires_at, { timeZone, at })} 过期`
      : state === 'used' && row.last_used_at
        ? `${formatInstant(row.last_used_at, { timeZone, at })} 用完`
        : `到 ${formatInstant(row.expires_at, { timeZone, at })} 有效`;
  return {
    id: row?.id,
    tone: STATE_TONES[state] || 'neutral',
    stateLabel: row?.stateLabel || { active: '有效', used: '已用完', expired: '已过期', revoked: '已撤销' }[state] || state,
    role: ROLE_NAMES[row?.role] || row?.role || '',
    usage: `已用 ${Number(row?.used_count) || 0}/${Number(row?.max_uses) || 1} 次`,
    created: row?.created_at ? `${formatInstant(row.created_at, { timeZone, at })} 生成` : '',
    when,
    active: state === 'active',
  };
}

/** 有效的在前，其余按生成时间新 → 旧 */
export function sortInvites(rows) {
  return [...(rows || [])].sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1)
    || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
