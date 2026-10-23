// =====================================================================
// data/rpc.js：建行程、邀请、加入（文档 A4 的 RPC）。
//
//   const id = await rpc.createTrip({ id, title, startDate, endDate, timezone, homeCurrency, localCurrency, subtitle, cover });
//   const code = await rpc.createInvite(tripId, { role: 'editor', validHours: 168, maxUses: 1 });   // 明文码只这一次拿得到
//   rpc.inviteLink(code)            → 'https://…/#/join/38S7-72Q9-FTCZ'
//   const peek = await rpc.peekInvite(code)          // 加入前看一眼：{ trip_title, inviter_name, role, expires_at }；后台没装时 null
//   const tripId = await rpc.redeemInvite(code)      // 大小写、空格、连字符都无所谓
//   await rpc.revokeInvite(inviteId); const list = await rpc.loadInvites(tripId);
//
// 平台化 · 批 A（迁移 20261022090000_platform_a）：
//   const r = await rpc.createTripV2({ token, title, startDate, endDate, dest, segments, copyFrom, … })
//                                     → { tripId, days, segments, packing, todos, added, inHousehold, replay }
//   await rpc.setTripDates(tripId, { startDate, endDate, moveToPool })   // 范围外有内容：DataError.field = 'need_move'（.days = 每天的件数）
//                                                                        // 有日记的天：field = 'journal'
//   const row = await rpc.setTripDest(tripId, { ride: 'xanhsm' }, { segmentId })   // 合并写 extra.dest；null 的键去掉
//   const r = await rpc.addPartner(tripId)                               // → { added, inHousehold, members }
//
// 这些都要联网（要拿到返回值才能继续），不进写队列；离线时直接给出“需要联网”的提示。
// 提前在本地校验格式（行程 id、日期、时区、币种、邀请码），少跑一趟网络、提示也更具体。
// =====================================================================

import { DataError } from './errors.js';
import { isValidDate, newId } from './util.js';
import { isValidTimeZone } from './tables.js';

export const TRIP_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;

/** 邀请码规范化成 'XXXX-XXXX-XXXX'；格式不对返回 null */
export function normalizeInviteCode(code) {
  const raw = String(code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!CODE_ALPHABET.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** 根据标题和出发日期建议一个行程 id（标题里的英文、拼音保留，中文去掉；不够长用 trip） */
export function suggestTripId(title, startDate, taken = []) {
  // 先去声调（NFKD 拆出组合符号再去掉，đ → d）：「Phú Quốc」→ phu-quoc，不会变成 phu-quo-c
  const ascii = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  const year = isValidDate(startDate) ? startDate.slice(0, 4) : '';
  let base = `${ascii.length >= 2 ? ascii : 'trip'}${year ? `-${year}` : ''}`.replace(/^[^a-z0-9]+/, '');
  if (!TRIP_ID_RE.test(base)) base = `trip-${year || 'new'}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const c = `${base}-${i}`.slice(0, 40);
    if (!used.has(c)) return c;
  }
  return `${base.slice(0, 30)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {{ backend: object, getUserId: () => string|null, trips: object, isOnline?: () => boolean, location?: { origin: string, pathname: string } }} deps
 */
export function createRpc(deps) {
  const isOnline = deps.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  function requireOnline(what) {
    if (!deps.getUserId()) throw new DataError('请先登录', { kind: 'unauthenticated' });
    if (!isOnline()) throw new DataError(`${what}需要联网，请连上网络后再试`, { kind: 'network' });
  }

  /** 新建行程（自己是 owner），返回行程 id；列表自动刷新 */
  async function createTrip(input) {
    const id = String(input.id || '').trim();
    const title = String(input.title || '').trim();
    if (!TRIP_ID_RE.test(id)) throw new DataError('行程 id 只能用小写字母、数字、- 和 _，2 到 40 位', { kind: 'validation', field: 'id' });
    if (!title) throw new DataError('行程标题不能为空', { kind: 'validation', field: 'title' });
    if (input.startDate && !isValidDate(input.startDate)) throw new DataError('开始日期格式不对', { kind: 'validation', field: 'start_date' });
    if (input.endDate && !isValidDate(input.endDate)) throw new DataError('结束日期格式不对', { kind: 'validation', field: 'end_date' });
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new DataError('结束日期不能早于开始日期', { kind: 'validation', field: 'end_date' });
    const tz = input.timezone || 'Asia/Hong_Kong';
    if (!isValidTimeZone(tz)) throw new DataError('时区不对（例如 Asia/Ho_Chi_Minh）', { kind: 'validation', field: 'timezone' });
    const home = String(input.homeCurrency || 'HKD').toUpperCase();
    const local = input.localCurrency ? String(input.localCurrency).toUpperCase() : null;
    if (!/^[A-Z]{3}$/.test(home) || (local && !/^[A-Z]{3}$/.test(local))) throw new DataError('币种要写三位代码（如 HKD、VND）', { kind: 'validation', field: 'home_currency' });
    requireOnline('新建行程');
    const tripId = await deps.backend.rpc('create_trip', {
      p_id: id, p_title: title, p_start_date: input.startDate || null, p_end_date: input.endDate || null,
      p_timezone: tz, p_home_currency: home, p_local_currency: local, p_subtitle: input.subtitle || null, p_cover: input.cover || {},
    });
    await deps.trips.load({ fresh: true });
    return tripId;
  }

  /**
   * 新建行程（批 A）：一次写好行程、自己（owner）+ 对方（editor）、分段、每天空白页、上一趟的行李清单（勾清掉）、通用待办。
   * input = {
   *   token,                      同一张表单重试要用同一个（打开表单时生成一次）；不给就现生成（那就不防重了）
   *   id?,                        不给由服务器按「第一个城市 id-年份」起，被占了自动加 -2
   *   title, startDate, endDate,  必填，最多 60 天
   *   timezone?, homeCurrency?, localCurrency?, subtitle?, cover?, shortName?,
   *   dest?,                      trips.extra.dest（规则包 destOk 先挡一遍）
   *   segments?: [{ id?, name, nameEn?, startDate?, endDate?, lat?, lng?, timezone?, icon?, dest? }],
   *   withPartner = true, copyFrom?, todos?: [{ title, list?, note? }]（不给 = 按地区带几条；[] = 不带）
   * }
   * → { tripId, days, segments, packing, todos, added, inHousehold, replay }；行程列表自动刷新
   */
  async function createTripV2(input = {}) {
    const title = String(input.title || '').trim();
    if (!title) throw new DataError('行程名字不能为空', { kind: 'validation', field: 'title' });
    if (title.length > 100) throw new DataError('行程名字太长了', { kind: 'validation', field: 'title' });
    if (input.id && !TRIP_ID_RE.test(String(input.id))) throw new DataError('行程 id 只能用小写字母、数字、- 和 _，2 到 40 位', { kind: 'validation', field: 'id' });
    if (!input.startDate || !input.endDate) throw new DataError('要选出发和回来的日期', { kind: 'validation', field: 'start_date' });
    if (!isValidDate(input.startDate) || !isValidDate(input.endDate)) throw new DataError('日期格式不对', { kind: 'validation', field: 'start_date' });
    if (input.endDate < input.startDate) throw new DataError('回来的日期不能早于出发', { kind: 'validation', field: 'end_date' });
    if ((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 > 59) throw new DataError('一趟最多 60 天', { kind: 'validation', field: 'end_date' });
    const tz = input.timezone || null;
    if (tz && !isValidTimeZone(tz)) throw new DataError('时区不对（例如 Asia/Ho_Chi_Minh）', { kind: 'validation', field: 'timezone' });
    const home = String(input.homeCurrency || 'HKD').toUpperCase();
    const local = input.localCurrency ? String(input.localCurrency).toUpperCase() : null;
    if (!/^[A-Z]{3}$/.test(home) || (local && !/^[A-Z]{3}$/.test(local))) throw new DataError('币种要写三位代码（如 HKD、VND）', { kind: 'validation', field: 'home_currency' });
    // 规则包的档案表不进首屏：用到时再加载（新建行程的面板本来就是按需加载的）
    const { destOk, segDestOk } = await import('../rules/dest.js');
    if (!destOk(input.dest ?? null)) throw new DataError('目的地的写法不对', { kind: 'validation', field: 'dest' });
    const segments = (input.segments || []).map((g) => {
      if (!segDestOk(g?.dest ?? null)) throw new DataError(`「${g?.name || ''}」的目的地写法不对`, { kind: 'validation', field: 'segments' });
      return {
        id: g.id || undefined, name: g.name, name_en: g.nameEn || undefined, start_date: g.startDate || undefined, end_date: g.endDate || undefined,
        center_lat: g.lat ?? undefined, center_lng: g.lng ?? undefined, timezone: g.timezone || undefined, icon: g.icon || undefined, dest: g.dest || undefined,
      };
    });
    if (segments.length > 5) throw new DataError('一趟最多 5 个城市', { kind: 'validation', field: 'segments' });
    requireOnline('新建行程');
    const p = {
      token: input.token || newId(), id: input.id || undefined, title, start_date: input.startDate, end_date: input.endDate,
      timezone: tz || undefined, home_currency: home, local_currency: local || undefined, subtitle: input.subtitle || undefined,
      cover: input.cover || undefined, dest: input.dest || undefined, short_name: input.shortName || undefined,
      segments: segments.length ? segments : undefined, with_partner: input.withPartner !== false,
      copy_from: input.copyFrom || undefined, todos: Array.isArray(input.todos) ? input.todos : undefined,
    };
    const r = await deps.backend.rpc('create_trip_v2', { p: JSON.parse(JSON.stringify(p)) });
    await deps.trips.load({ fresh: true });
    return {
      tripId: r.trip_id, days: r.days, segments: r.segments, packing: r.packing, todos: r.todos,
      added: r.added || [], inHousehold: Boolean(r.in_household), replay: Boolean(r.replay),
    };
  }

  /**
   * 改日期（editor）。范围外的天：写了日记 → 抛 DataError（field 'journal'）；有条目 / 待办 / 贴士 / 住处 → 不带 moveToPool 抛
   * DataError（field 'need_move'，days = [{ date, items, todos, tips, stay }]，message 就是能直接显示的那句）；带了就挪进备选池。
   * → { startDate, endDate, added, removed, movedItems, unlinkedTodos, unlinkedTips, droppedStays }
   */
  async function setTripDates(tripId, { startDate, endDate, moveToPool = false } = {}) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw new DataError('要选出发和回来的日期', { kind: 'validation', field: 'start_date' });
    if (endDate < startDate) throw new DataError('回来的日期不能早于出发', { kind: 'validation', field: 'end_date' });
    requireOnline('改日期');
    let r;
    try {
      r = await deps.backend.rpc('set_trip_dates', { p_trip_id: tripId, p_start_date: startDate, p_end_date: endDate, p_move_to_pool: Boolean(moveToPool) });
    } catch (e) {
      const hint = e?.cause?.hint;
      if (hint === 'need_move' || hint === 'journal') {
        const err = new DataError(e.message, { kind: 'validation', code: e.code, field: hint, cause: e });
        try {
          err.days = e.cause.details ? JSON.parse(e.cause.details) : [];
        } catch {
          err.days = [];
        }
        throw err;
      }
      throw e;
    }
    await deps.trips.load({ fresh: true });
    return {
      startDate: r.start_date, endDate: r.end_date, added: r.added, removed: r.removed, movedItems: r.moved_items,
      unlinkedTodos: r.unlinked_todos, unlinkedTips: r.unlinked_tips, droppedStays: r.dropped_stays,
    };
  }

  /**
   * 改目的地档案（editor）：合并写 trips.extra.dest（给 segmentId 就写那一段的 segments.extra.dest）。
   * patch 里写了的键覆盖、写 null 的键去掉、没写的不动；patch = null 去掉整个档案。不整包覆盖 extra（ledger_* 这些不会被冲掉）。
   * → 改完的那一行（实时推送也会到）
   */
  async function setTripDest(tripId, patch, { segmentId = null } = {}) {
    if (patch !== null && (typeof patch !== 'object' || Array.isArray(patch))) throw new DataError('目的地的写法不对', { kind: 'validation', field: 'dest' });
    requireOnline('改目的地');
    return deps.backend.rpc('set_trip_dest', { p_trip_id: tripId, p_patch: patch, p_segment_id: segmentId });
  }

  /** 把对方加进来（editor；只有自己时用）→ { added, inHousehold, members } */
  async function addPartner(tripId) {
    requireOnline('拉对方进来');
    const r = await deps.backend.rpc('add_household_to_trip', { p_trip_id: tripId });
    await deps.trips.load({ fresh: true });
    return { added: r.added || [], inHousehold: Boolean(r.in_household), members: r.members || [] };
  }

  /** 生成邀请码（owner / editor）。明文码只在这次返回，库里只存哈希 */
  async function createInvite(tripId, { role = 'editor', validHours = 168, maxUses = 1 } = {}) {
    if (!['editor', 'viewer'].includes(role)) throw new DataError('邀请角色只能是可编辑或只读', { kind: 'validation' });
    if (!Number.isInteger(validHours) || validHours < 1 || validHours > 720) throw new DataError('有效期必须在 1 到 720 小时之间', { kind: 'validation' });
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) throw new DataError('可用次数必须在 1 到 20 之间', { kind: 'validation' });
    requireOnline('生成邀请码');
    return deps.backend.rpc('create_invite', { p_trip_id: tripId, p_role: role, p_valid_hours: validHours, p_max_uses: maxUses });
  }

  /**
   * 加入之前先看一眼邀请：{ trip_title, inviter_name, role, expires_at, already_member }。
   * 码无效 / 过期 → 抛「邀请码无效或已过期」（加入页可以先说）；后台还没装 peek_invite（迁移没执行）、
   * 没登录、离线 → 返回 null（加入页照常能加入，只是加入后才显示行程名）。
   */
  async function peekInvite(code) {
    const norm = normalizeInviteCode(code);
    if (!norm) throw new DataError('邀请码是 12 位字母和数字（如 38S7-72Q9-FTCZ），请检查一下', { kind: 'validation' });
    if (!deps.getUserId() || !isOnline()) return null;
    try {
      const res = await deps.backend.rpc('peek_invite', { p_code: norm });
      return res && typeof res === 'object' ? res : null;
    } catch (e) {
      // 码无效：照实说；其他（函数不存在 PGRST202 / 42883、网络）都当作“看不了”，不挡加入
      if (/邀请码无效或已过期/.test(String(e?.message || ''))) throw new DataError('邀请码无效或已过期', { kind: 'validation', cause: e });
      return null;
    }
  }

  /** 用邀请码加入行程，返回行程 id（已经是成员也直接返回） */
  async function redeemInvite(code) {
    const norm = normalizeInviteCode(code);
    if (!norm) throw new DataError('邀请码是 12 位字母和数字（如 38S7-72Q9-FTCZ），请检查一下', { kind: 'validation' });
    requireOnline('加入行程');
    const tripId = await deps.backend.rpc('redeem_invite', { p_code: norm });
    await deps.trips.load({ fresh: true });
    return tripId;
  }

  async function revokeInvite(inviteId) {
    requireOnline('撤销邀请');
    await deps.backend.rpc('revoke_invite', { p_invite_id: inviteId });
  }

  /** 邀请列表（owner / editor 才看得到），带状态：有效 / 已用完 / 已过期 / 已撤销 */
  async function loadInvites(tripId, at = new Date()) {
    requireOnline('读取邀请');
    const rows = await deps.backend.fetchInvites(tripId);
    return rows.map((r) => {
      const state = r.revoked_at ? 'revoked' : r.used_count >= r.max_uses ? 'used' : Date.parse(r.expires_at) <= at.getTime() ? 'expired' : 'active';
      return { ...r, state, stateLabel: { active: '有效', used: '已用完', expired: '已过期', revoked: '已撤销' }[state] };
    });
  }

  /** 邀请链接（码放在 hash 里，不进服务器日志） */
  function inviteLink(code) {
    const loc = deps.location || (typeof location !== 'undefined' ? location : { origin: '', pathname: '/' });
    const norm = normalizeInviteCode(code) || code;
    return `${loc.origin}${loc.pathname}#/join/${norm}`;
  }

  return { createTrip, createTripV2, setTripDates, setTripDest, addPartner, createInvite, peekInvite, redeemInvite, revokeInvite, loadInvites, inviteLink };
}
