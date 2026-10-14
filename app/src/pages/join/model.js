// =====================================================================
// pages/join/model.js：加入行程的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//
//   codeFromInput(text)            用户粘贴进来的东西 → 规范的邀请码 'XXXX-XXXX-XXXX'（整条邀请链接、带空格、小写都认）；认不出返回 null
//   joinErrorInfo(error, o)        加入失败 → 中文标题 + 说明 + 能不能重试 + 该给什么按钮
//   pendingInvite / rememberInvite / forgetInvite   没登录时打开邀请链接：本机记一下邀请码（行程列表提示「还有一个邀请没加入」）
//   inviterLine(members, trip)     加入以后「邀请人：Jeremy（创建者）」
//
// 后台的 redeem_invite 对所有失败只说「邀请码无效或已过期」（不区分过期、用完、撤销，免得被人试出有效的码），
// 所以页面把三种可能都列出来，并告诉用户怎么办（让对方重新生成一个）。
// =====================================================================

import { normalizeInviteCode } from '../../data/rpc.js';

/** 本机记住的“还没加入的邀请”（lib/storage.js 的 local，自动带 rs7885: 前缀） */
export const PENDING_KEY = 'join:pending';
/** 记住多久（邀请最长有效 30 天；两周后不再提示） */
export const PENDING_TTL_MS = 14 * 24 * 3600 * 1000;

/**
 * 粘贴进来的文字 → 邀请码。认得：'38S7-72Q9-FTCZ'、'38s7 72q9 ftcz'、整条链接 'https://…/#/join/38S7-72Q9-FTCZ'、
 * 旧版链接 '?invite=38S772Q9FTCZ'。认不出返回 null。
 */
export function codeFromInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const fromLink = /#\/join\/([A-Za-z0-9 -]{4,40})/.exec(raw) || /[?&]invite=([A-Za-z0-9 -]{4,40})/.exec(raw);
  return normalizeInviteCode(fromLink ? decodeURIComponent(fromLink[1]) : raw);
}

/**
 * 加入失败的说法。
 * @param {any} error  DataError（kind: network / validation / permission / unauthenticated / server …）
 * @param {{ online?: boolean }} [o]
 * @returns {{ kind: 'network'|'invalid'|'auth'|'unknown', title: string, message: string, reasons: string[], retry: boolean }}
 */
export function joinErrorInfo(error, { online = true } = {}) {
  const kind = error?.kind;
  const msg = String(error?.message || '');
  if (!online || kind === 'network' || kind === 'timeout') {
    return {
      kind: 'network',
      title: '现在连不上网络',
      message: '加入行程要联网确认邀请码。连上网络后再点一次「确认加入」就行，邀请码不会因为这次失败作废。',
      reasons: [],
      retry: true,
    };
  }
  if (kind === 'unauthenticated' || /请先登录|需要先登录/.test(msg)) {
    return { kind: 'auth', title: '要先登录', message: '登录以后会回到这一页，接着加入。', reasons: [], retry: false };
  }
  if (kind === 'validation' || /邀请码/.test(msg)) {
    return {
      kind: 'invalid',
      title: '这个邀请用不了',
      message: '请让对方在「设置 → 成员和邀请」里重新生成一个邀请链接发给你。',
      reasons: ['已经过期了（邀请链接有有效期）', '已经被用过了（一个链接能用的次数有限）', '被创建者撤销了', '复制的时候少了几位'],
      retry: false,
    };
  }
  return {
    kind: 'unknown',
    title: '没有加入成功',
    message: /[一-鿿]/.test(msg) ? msg : '请稍后再试一次。',
    reasons: [],
    retry: true,
  };
}

/**
 * 本机记着的“还没加入的邀请”（过期的、格式不对的当没有）。
 * @param {{ getJSON: (k: string, f: any) => any }} storage  lib/storage.js 的 local
 * @param {Date} [at]
 * @returns {{ code: string, savedAt: string } | null}
 */
export function pendingInvite(storage, at = new Date()) {
  const v = storage?.getJSON?.(PENDING_KEY, null);
  if (!v || typeof v !== 'object') return null;
  const code = normalizeInviteCode(v.code);
  const t = Date.parse(v.savedAt);
  if (!code || !Number.isFinite(t)) return null;
  if (at.getTime() - t > PENDING_TTL_MS || t - at.getTime() > 60_000) return null;
  return { code, savedAt: v.savedAt };
}

/** 记下这个邀请（没登录时打开了邀请链接） */
export function rememberInvite(storage, code, at = new Date()) {
  const norm = normalizeInviteCode(code);
  if (!norm) return false;
  return Boolean(storage?.setJSON?.(PENDING_KEY, { code: norm, savedAt: at.toISOString() }));
}

/** 加入成功 / 不加入了：忘掉它 */
export function forgetInvite(storage) {
  storage?.remove?.(PENDING_KEY);
}

/**
 * 加入以后的「邀请人」一行：行程创建者的名字。
 * @param {Array<{ user_id: string, display_name?: string, email?: string, role?: string }>} members
 * @param {{ owner_id?: string }} trip
 * @param {string|null} me  自己的 user id（自己就是创建者时不写）
 */
export function inviterLine(members, trip, me = null) {
  const list = Array.isArray(members) ? members : [];
  const owner = list.find((m) => m.user_id && m.user_id === trip?.owner_id) || list.find((m) => m.role === 'owner');
  if (!owner || owner.user_id === me) return '';
  const name = owner.display_name || String(owner.email || '').split('@')[0] || '创建者';
  return `邀请人：${name}（创建者）`;
}
