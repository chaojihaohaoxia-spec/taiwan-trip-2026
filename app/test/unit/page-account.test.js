// 行程列表 / 新建行程 / 设置 / 邀请 / 加入（页面 agent「account」）的纯逻辑：
//   src/pages/trips/model.js、src/sheets/trip-new/model.js、src/sheets/invite/model.js、src/pages/join/model.js、
//   src/pages/settings/model.js、src/pages/settings/legacy-import.js（旧版本机记录导入）。
// 数据全部是现场编的（行程、成员、旧版记录都是虚构的；不读真实行程 JSON）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  groupTrips, tripCardInfo, todayInfo, todayTarget, tripsSummary, normalizeView, lengthLabel, ROLE_LABELS,
} from '../../src/pages/trips/model.js';
import {
  codeFromInput, joinErrorInfo, pendingInvite, rememberInvite, forgetInvite, inviterLine, PENDING_KEY, PENDING_TTL_MS,
} from '../../src/pages/join/model.js';
import { inviteRowInfo, sortInvites, inviteMeta, inviteMetaParts, inviteShareText, validLabel, ROLE_OPTIONS } from '../../src/sheets/invite/model.js';
import { formatBytes, storageLabel, syncTone, versionParts, FONT_LICENSES } from '../../src/pages/settings/model.js';
import {
  LEGACY_KEYS, CLEARABLE_KEYS, legacyKeysPresent, readLegacyData, normalizeLegacyState, normalizeLegacyExpenses, pickLegacyTarget,
  planLegacyImport, applyLegacyImport, sectionSummary, mergeBody, legacyRowId, ledgerEntryToExpense, sharedExpenseToExpense,
  RATING_FROM_LEGACY, MOOD_FROM_LEGACY, SECTIONS,
} from '../../src/pages/settings/legacy-import.js';

const HK = 'Asia/Hong_Kong';
const VN = 'Asia/Ho_Chi_Minh';
const trip = (id, o = {}) => ({ id, trip: { id, title: `行程 ${id}`, timezone: VN, start_date: null, end_date: null, status: 'planning', sort: 0, cover: {}, ...o }, role: 'owner' });

// ---------------------------------------------------------------------
// 行程列表
// ---------------------------------------------------------------------

test('行程列表分组：进行中 → 接下来（有日期的按出发先后，日期未定的最后）→ 回顾 → 已归档；空组不出现', () => {
  const at = new Date('2027-01-11T10:00:00+07:00');
  const entries = [
    trip('ended-old', { start_date: '2026-03-14', end_date: '2026-03-22' }),
    trip('undated'),
    trip('far', { start_date: '2027-04-03', end_date: '2027-04-04' }),
    trip('now', { start_date: '2027-01-10', end_date: '2027-01-13' }),
    trip('soon', { start_date: '2027-02-01', end_date: '2027-02-03' }),
    trip('arch', { start_date: '2025-01-01', end_date: '2025-01-02', status: 'archived' }),
  ];
  const g = groupTrips(entries, at);
  assert.deepEqual(g.map((x) => x.key), ['ongoing', 'upcoming', 'ended', 'archived']);
  assert.deepEqual(g.map((x) => x.title), ['进行中', '接下来', '回顾', '已归档']);
  assert.deepEqual(g[1].entries.map((e) => e.id), ['soon', 'far', 'undated']);
  assert.deepEqual(groupTrips([], at), []);
  assert.deepEqual(groupTrips([trip('x', { start_date: '2027-03-01', end_date: '2027-03-02' })], at).map((x) => x.key), ['upcoming']);
});

test('行程卡片：日期（今年不写年）、几天几晚、阶段芯片（和切换面板同一套说法）、只读、读屏标签', () => {
  const at = new Date('2027-01-08T09:00:00+07:00');
  const up = tripCardInfo({ id: 'a', role: 'viewer', trip: { title: '  椰影岛 · 冬日海岛 ', timezone: VN, start_date: '2027-01-10', end_date: '2027-01-13', cover: { emoji: '🌴', image_path: 'a/u/covers/x.jpg' } } }, at);
  assert.equal(up.title, '椰影岛 · 冬日海岛');
  assert.equal(up.dates, '01-10 周日 – 01-13 周三');
  assert.equal(up.length, '4 天 3 晚');
  assert.deepEqual(up.chip, { tone: 'accent', text: '2 天后出发' });
  assert.equal(up.emoji, '🌴');
  assert.equal(up.imagePath, 'a/u/covers/x.jpg');
  assert.equal(up.readOnly, true);
  assert.match(up.label, /椰影岛 · 冬日海岛，01-10 周日 – 01-13 周三，4 天 3 晚，2 天后出发，只读/);

  const ended = tripCardInfo(trip('b', { start_date: '2026-03-14', end_date: '2026-03-22', cover_emoji: '🏮' }), at);
  assert.equal(ended.dates, '2026-03-14 周六 – 03-22 周日', '不是今年：写年份');
  assert.deepEqual(ended.chip, { tone: 'neutral', text: '已结束 · 回顾' });
  assert.equal(ended.emoji, '🏮', '没有 cover.emoji 时用旧字段 cover_emoji');

  const on = tripCardInfo(trip('c', { start_date: '2027-01-07', end_date: '2027-01-08' }), at);
  assert.equal(on.phase, 'ongoing');
  assert.equal(on.chip.text, '进行中 · 最后一天');

  const undated = tripCardInfo(trip('d', { title: '' }), at);
  assert.equal(undated.title, '未命名行程');
  assert.equal(undated.dates, '日期未定');
  assert.equal(undated.length, '');
  const arch = tripCardInfo(trip('e', { status: 'archived', start_date: '2025-01-01', end_date: '2025-01-01' }), at);
  assert.equal(arch.phase, 'archived');
  assert.equal(arch.chip.text, '已归档');
  assert.equal(lengthLabel({ start_date: '2027-01-01', end_date: '2027-01-01' }), '1 天');
  assert.equal(ROLE_LABELS.viewer, '只读');
});

test('「今天」入口：进行中的那趟今天的 day 页（几趟同时进行取最晚开始的）；没有进行中 → null', () => {
  const at = new Date('2027-01-11T10:00:00+07:00');
  const a = trip('a', { start_date: '2027-01-10', end_date: '2027-01-13' });
  const b = trip('b', { start_date: '2027-01-11', end_date: '2027-01-11', timezone: HK });
  const t = todayInfo([a, b], at);
  assert.deepEqual(t.to, { name: 'day', params: { tripId: 'b', date: '2027-01-11' } });
  assert.equal(t.phrase, '第 1 天 · 共 1 天');
  assert.deepEqual(todayInfo([a], at), { to: { name: 'day', params: { tripId: 'a', date: '2027-01-11' } }, tripId: 'a', title: '行程 a', phrase: '第 2 天 · 共 4 天' });
  assert.equal(todayInfo([trip('x', { start_date: '2027-02-01', end_date: '2027-02-02' })], at), null);
  assert.equal(todayTarget(trip('x'), at), null);
  assert.equal(todayInfo([{ ...a, trip: { ...a.trip, status: 'archived' } }], at), null, '归档的不算');
});

test('列表上方的一句话、列表 / 网格偏好', () => {
  const at = new Date('2027-01-08T09:00:00+07:00');
  assert.equal(tripsSummary([], at), '');
  assert.equal(tripsSummary([trip('a', { start_date: '2027-01-10', end_date: '2027-01-13' }), trip('b', { start_date: '2026-03-14', end_date: '2026-03-22' })], at), '2 趟旅行 · 下一趟 2 天后出发');
  assert.equal(tripsSummary([trip('a', { start_date: '2027-01-09', end_date: '2027-01-13' })], at), '1 趟旅行 · 下一趟明天出发');
  assert.equal(tripsSummary([trip('a', { start_date: '2027-01-07', end_date: '2027-01-13' })], at), '1 趟旅行 · 1 趟进行中');
  assert.equal(normalizeView('grid'), 'grid');
  assert.equal(normalizeView('whatever'), 'list');
  assert.equal(normalizeView(null), 'list');
});

// ---------------------------------------------------------------------
// 加入
// ---------------------------------------------------------------------

function memoryStorage() {
  const m = new Map();
  return {
    get: (k, f = null) => (m.has(k) ? m.get(k) : f),
    set: (k, v) => { m.set(k, String(v)); return true; },
    remove: (k) => m.delete(k),
    getJSON(k, f = null) { const v = m.get(k); if (v === undefined) return f; try { return JSON.parse(v); } catch { return f; } },
    setJSON(k, v) { m.set(k, JSON.stringify(v)); return true; },
    raw: m,
  };
}

test('邀请码：整条链接、旧版 ?invite=、空格、小写都认；认不出 → null', () => {
  assert.equal(codeFromInput('38S7-72Q9-FTCZ'), '38S7-72Q9-FTCZ');
  assert.equal(codeFromInput(' 38s7 72q9 ftcz '), '38S7-72Q9-FTCZ');
  assert.equal(codeFromInput('https://example.com/app/#/join/38S7-72Q9-FTCZ'), '38S7-72Q9-FTCZ');
  assert.equal(codeFromInput('https://example.com/app/?invite=38S772Q9FTCZ'), '38S7-72Q9-FTCZ');
  assert.equal(codeFromInput('一起去玩吧 https://example.com/#/join/38s7-72q9-ftcz'), '38S7-72Q9-FTCZ');
  assert.equal(codeFromInput('38S7-72Q9'), null, '少了几位');
  assert.equal(codeFromInput('IIII-OOOO-0000'), null, '字母表里没有 I O 0 1');
  assert.equal(codeFromInput(''), null);
});

test('加入失败的说法：没网（可以重试）/ 邀请码无效（列出可能的原因）/ 要先登录 / 其他', () => {
  const net = joinErrorInfo({ kind: 'network', message: '加入行程需要联网' });
  assert.equal(net.kind, 'network');
  assert.equal(net.retry, true);
  assert.equal(joinErrorInfo({ kind: 'server', message: 'x' }, { online: false }).kind, 'network');
  const bad = joinErrorInfo({ kind: 'validation', message: '邀请码无效或已过期' });
  assert.equal(bad.kind, 'invalid');
  assert.equal(bad.title, '这个邀请用不了');
  assert.ok(bad.reasons.some((r) => /过期/.test(r)) && bad.reasons.some((r) => /用过/.test(r)) && bad.reasons.some((r) => /撤销/.test(r)));
  assert.equal(joinErrorInfo({ kind: 'server', message: '邀请码无效或已过期' }).kind, 'invalid', '后台的中文报错也认得');
  assert.equal(joinErrorInfo({ kind: 'unauthenticated', message: '请先登录' }).kind, 'auth');
  const other = joinErrorInfo({ kind: 'server', message: 'internal error 500' });
  assert.equal(other.kind, 'unknown');
  assert.equal(other.message, '请稍后再试一次。', '英文技术报错不给用户看');
});

test('没登录时打开的邀请：记下来、两周后不再提示、格式不对当没有、加入后忘掉', () => {
  const s = memoryStorage();
  const t0 = new Date('2026-10-13T08:00:00Z');
  assert.equal(pendingInvite(s, t0), null);
  assert.equal(rememberInvite(s, 'nope', t0), false);
  assert.equal(rememberInvite(s, '38s7 72q9 ftcz', t0), true);
  assert.deepEqual(pendingInvite(s, new Date(t0.getTime() + 3600_000)), { code: '38S7-72Q9-FTCZ', savedAt: t0.toISOString() });
  assert.equal(pendingInvite(s, new Date(t0.getTime() + PENDING_TTL_MS + 1)), null);
  s.raw.set(PENDING_KEY, '{坏了');
  assert.equal(pendingInvite(s, t0), null);
  rememberInvite(s, '38S7-72Q9-FTCZ', t0);
  forgetInvite(s);
  assert.equal(pendingInvite(s, t0), null);
});

test('加入后的「邀请人」：创建者的显示名（没有用邮箱前缀）；自己就是创建者时不写', () => {
  const members = [
    { user_id: 'u1', display_name: 'Jeremy', email: 'j@example.com', role: 'owner' },
    { user_id: 'u2', display_name: null, email: 'cathy@example.com', role: 'editor' },
  ];
  assert.equal(inviterLine(members, { owner_id: 'u1' }, 'u2'), '邀请人：Jeremy（创建者）');
  assert.equal(inviterLine(members, { owner_id: 'u1' }, 'u1'), '');
  assert.equal(inviterLine([{ user_id: 'u3', email: 'kai@example.com', role: 'owner' }], { owner_id: 'u3' }, 'u2'), '邀请人：kai（创建者）');
  assert.equal(inviterLine([], {}, 'u2'), '');
});

// ---------------------------------------------------------------------
// 新建行程：批 A 重写成一屏（去哪 / 日历 / 这趟怎么走 / 和对方一起 / 带行李清单），测试挪到 test/unit/trip-new.test.js。
// 原来这里测的时区芯片、emoji 封面、两个系统日期框、自己起 id 撞了换下一个，新表单里都没有了（id 由服务器 create_trip_v2 起、
// 封面按目的地默认、时区按城市带出），对应的旧断言一起去掉。
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// 邀请
// ---------------------------------------------------------------------

test('邀请：已发出的一行（四种状态）、排序（有效的在前）、刚生成的说明、分享的话', () => {
  const at = new Date('2026-10-13T08:00:00Z');
  const base = { id: 'i1', role: 'editor', max_uses: 1, used_count: 0, created_at: '2026-10-10T01:00:00+00:00', expires_at: '2026-10-17T01:00:00+00:00' };
  const active = inviteRowInfo({ ...base, state: 'active', stateLabel: '有效' }, at, HK);
  assert.deepEqual([active.tone, active.stateLabel, active.role, active.usage, active.active], ['success', '有效', '可编辑', '已用 0/1 次', true]);
  assert.match(active.when, /^到 .*10月17日 09:00 有效$/);
  assert.match(inviteRowInfo({ ...base, state: 'expired' }, at, HK).when, /过期$/);
  assert.equal(inviteRowInfo({ ...base, state: 'expired' }, at, HK).tone, 'warning');
  assert.match(inviteRowInfo({ ...base, state: 'revoked', revoked_at: '2026-10-11T02:00:00+00:00' }, at, HK).when, /撤销$/);
  const used = inviteRowInfo({ ...base, state: 'used', used_count: 1, last_used_at: '2026-10-12T03:00:00+00:00', role: 'viewer' }, at, HK);
  assert.deepEqual([used.stateLabel, used.role, used.usage, used.active], ['已用完', '只读', '已用 1/1 次', false]);
  const sorted = sortInvites([
    { id: 'old', state: 'expired', created_at: '2026-10-01T00:00:00+00:00' },
    { id: 'new', state: 'revoked', created_at: '2026-10-12T00:00:00+00:00' },
    { id: 'act', state: 'active', created_at: '2026-09-01T00:00:00+00:00' },
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ['act', 'new', 'old']);
  assert.deepEqual(inviteMetaParts({ role: 'editor', validHours: 168, maxUses: 1 }, at, HK), ['可编辑', '7 天内有效（到 10月20日 16:00）', '能用 1 次']);
  assert.equal(inviteMeta({ role: 'viewer', validHours: 24, maxUses: 5 }, at, HK), '只读 · 1 天内有效（到 10月14日 16:00） · 能用 5 次');
  assert.equal(validLabel(36), '36 小时');
  const text = inviteShareText({ title: '海岛 · 秋假' }, 'https://example.com/#/join/38S7-72Q9-FTCZ');
  assert.match(text, /「海岛 · 秋假」/);
  assert.ok(text.endsWith('https://example.com/#/join/38S7-72Q9-FTCZ'));
  assert.deepEqual(ROLE_OPTIONS.map((o) => o.value), ['editor', 'viewer']);
});

// ---------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------

test('设置：本机占用、存储状态、同步语气、版本号拆分、字体授权文件', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(3.24 * 1024 * 1024), '3.2 MB');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(storageLabel('ok').text, '正常');
  assert.equal(storageLabel('memory').tone, 'warning');
  assert.equal(syncTone('error'), 'danger');
  assert.equal(syncTone('offline'), 'warning');
  assert.equal(syncTone('synced'), 'neutral');
  assert.deepEqual(versionParts('2.0.0+0a1b2c3d4e'), { version: '2.0.0', build: '0a1b2c3d4e' });
  assert.deepEqual(versionParts('dev'), { version: 'dev', build: '' });
  assert.deepEqual(versionParts(''), { version: '—', build: '' });
  const build = readFileSync(fileURLToPath(new URL('../../scripts/build.mjs', import.meta.url)), 'utf8');
  for (const f of FONT_LICENSES) assert.ok(build.includes(`'${f.file}'`), `构建会把 ${f.file} 放进产物`);
});

// ---------------------------------------------------------------------
// 旧版本机记录导入（全部虚构的样本）
// ---------------------------------------------------------------------

const ME = 'user-me';
const HER = 'user-her';

/** 假的 localStorage：值存在 Map 里；读密钥那个键直接抛错（证明从来不读它的值） */
function fakeLocalStorage(values) {
  const m = new Map(Object.entries(values));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem(k) {
      if (k === LEGACY_KEYS.apiKey) throw new Error('不应该读 AI 密钥的值');
      return m.has(k) ? m.get(k) : null;
    },
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}

/** 虚构的目标行程（像新版的台湾行程：天有 legacy_id、条目有 legacy_id、待确认有 legacy_confirm_key） */
function bundle(o = {}) {
  return {
    trip: { id: 'trip-x', title: '三城 · 春日', start_date: '2026-03-14', end_date: '2026-03-16', home_currency: 'HKD', timezone: 'Asia/Taipei' },
    days: [
      { id: 'D3', date: '2026-03-16', extra: {} },
      { id: 'D1', date: '2026-03-14', extra: { legacy_id: 'd1' } },
      { id: 'D2', date: '2026-03-15', extra: {} },
    ],
    items: [
      { id: 'I1', day_id: 'D1', title: '老街牛肉面', legacy_id: 'd1-1400', status: 'planned', start_time: '14:00:00', variant: 'primary' },
      { id: 'I2', day_id: 'D2', title: '老城散步', legacy_id: null, status: 'planned', start_time: '10:00:00', variant: 'primary' },
      { id: 'I3', day_id: 'D2', title: '北门夜市', status: 'done', start_time: '19:00:00', variant: 'primary' },
      { id: 'I4', day_id: 'D3', title: '四兽小径', status: 'skipped', start_time: '20:30:00', variant: 'primary' },
      { id: 'I5', day_id: 'D3', title: '雨天：博物馆', status: 'planned', start_time: '20:30:00', variant: 'rain' },
      { id: 'I6', day_id: 'D3', title: '甲', status: 'planned', start_time: '09:00:00', variant: 'primary' },
      { id: 'I7', day_id: 'D3', title: '乙', status: 'planned', start_time: '09:00:00', variant: 'primary' },
    ],
    todos: [
      { id: 'T1', list: 'confirm', title: '现金已准备', done: false, extra: { legacy_confirm_key: 'confirm-现金已准备：一万' } },
      { id: 'T2', list: 'confirm', title: '确认采茶集合时间', done: false, extra: {} },
      { id: 'T3', list: 'confirm', title: '已经勾了的', done: true, extra: {} },
      { id: 'P1', list: 'packing', category: '其他', title: '折叠伞', done: true, extra: {} },
      { id: 'P2', list: 'packing', category: '电子', title: '充电宝', done: false, extra: {} },
    ],
    places: [
      { id: 'PL1', name: '灯笼老街', aliases: ['老街'], name_en: 'Lantern Street' },
      { id: 'PL2', name: '旧城博物馆', aliases: [] },
      { id: 'PL3', name: '云顶茶馆', aliases: [] },
    ],
    reviews: [
      { id: 'R1', place_id: 'PL2', user_id: ME, rating: 5, extra: {} },
      { id: 'R2', place_id: 'PL3', user_id: HER, rating: 4, extra: { legacy_spot_key: 'spot-雾港-云顶茶馆' } },
    ],
    journal: [{ id: 'J1', day_id: 'D2', user_id: ME, body: '第二天走了很多路。', mood: null }],
    expenses: [{ id: '0f6b7a3e-1111-4222-8333-944445555666', amount: 100, currency: 'TWD' }],
    members: [
      { user_id: ME, email: 'me@example.com', display_name: 'Me', role: 'owner' },
      { user_id: HER, email: 'her@example.com', display_name: 'Her', role: 'editor' },
    ],
    ...o,
  };
}

/** 虚构的旧版 appState */
const LEGACY_STATE = {
  designVersion: 'x',
  completedItems: { 'd1-1400': true, 'd2-1000': true, 'd2-1900': true, 'd3-2030': true, 'd3-0900': true, 'd9-0000': true, 'd1-0800': false, 'odd-id': true },
  confirmStatus: { 'confirm-现金已准备：一万': true, 'confirm-确认采茶集合时间': true, 'confirm-已经勾了的': true, 'rem-d2-0': true, 'confirm-没有这一项': true, 'confirm-没勾': false },
  spotReviews: {
    'spot-南湾-灯笼老街': { rating: '顶级', notes: '晚上灯笼都亮了', foodLog: [{ text: '糖葫芦\n很甜', photos: ['https://example.com/a.jpg'] }], shopLog: [{ text: '小灯笼' }], ratedAt: '2026-03-15T12:00:00Z' },
    'spot-雾港-旧城博物馆': { rating: '夯' },
    'spot-雾港-云顶茶馆': { rating: 'NPC' },
    'spot-雾港-不存在的店': { rating: '拉完了' },
    'spot-雾港-空的': {},
  },
  checkedItems: { 'spot-雾港-灯笼老街': true },
  dayDiaries: { d1: { mood: 'great', text: '第一天到了。' }, d2: { mood: 'tired', text: '第二天走了很多路。' }, d3: { text: '最后一天' }, d8: { text: '没有这一天' } },
  dayNotes: { d1: '备注：机场好大', d3: '最后一天' },
  packingList: { 其他: { 折叠伞: true }, 电子: { 充电宝: true, 转换插头: false }, 衣物: { 薄外套: true } },
  personalLedger: [
    { id: 'pl-1', type: 'expense', amount: 120, currency: 'NTD', category: '餐饮', note: '夜市小吃', date: '2026-03-15', addedBy: 'me@example.com', paidBy: 'me', forWhom: 'shared' },
    { id: 'pl-2', type: 'income', amount: 500, currency: 'HKD', date: '2026-03-15', addedBy: 'me@example.com' },
    { id: 'pl-3', type: 'expense', amount: '88', currency: 'HKD', category: '奇怪的分类', note: '超市', date: '2026-04-02', addedBy: 'her@example.com', paidBy: 'me', forWhom: 'me' },
    { id: 'pl-4', type: 'expense', amount: 60, currency: 'RMB', category: '交通', note: '给她买的车票', date: '2026-03-14', addedBy: 'me@example.com', paidBy: 'me', forWhom: 'partner' },
    { id: 'pl-5', type: 'expense', amount: 30, currency: 'HKD', category: '餐饮', note: '她付的我的', date: '2026-03-16', addedBy: 'me@example.com', paidBy: 'partner', forWhom: 'me' },
    { id: 'pl-6', type: 'expense', amount: 0, currency: 'HKD', date: '2026-03-16' },
  ],
};

const LEGACY_EXPENSES = [
  { id: '0f6b7a3e-1111-4222-8333-944445555666', amount: 100, currency: 'NTD', description: '已经在云端的' },
  { id: '1a2b3c4d-1111-4222-8333-944445555777', amount: 250, currency: 'NTD', amount_hkd: 61.5, description: '本机没传上去的', paid_by: 'Her', split_with: ['Her', 'Me'], date: '2026-03-15', category: '门票' },
  { id: 'local-9', amount: 40, currency: 'HKD', description: '只给我', paid_by: '我', split_with: ['我'], day_id: 'd1' },
];

const rate = (from, to) => ({ 'TWD>HKD': 0.25, 'CNY>HKD': 1.1 })[`${from}>${to}`] ?? null;

test('旧键扫描：只枚举键名，一个值都不读（AI 密钥的值从来不碰）；读不了本机存储当作没有', () => {
  const s = fakeLocalStorage({ [LEGACY_KEYS.state]: '{}', [LEGACY_KEYS.apiKey]: 'demo-not-a-real-key', 'rs7885:theme': 'dark' });
  assert.deepEqual(legacyKeysPresent(s), { state: true, expenses: false, apiKey: true, any: true });
  assert.deepEqual(legacyKeysPresent(null), { state: false, expenses: false, apiKey: false, any: false });
  const broken = { get length() { throw new Error('denied'); } };
  assert.equal(legacyKeysPresent(broken).any, false);
  // 读数据也只读两个键（getItem 读密钥会抛错，这里没抛）
  const read = readLegacyData(s);
  assert.deepEqual(read.problems, []);
  assert.ok(read.state);
  assert.deepEqual(CLEARABLE_KEYS, [LEGACY_KEYS.state, LEGACY_KEYS.expenses], '清旧键不包括旧版的登录会话');
});

test('旧数据读坏了：记下原因，不抛错；旧旧版的 { 天: [...] } 账本也认', () => {
  const s = fakeLocalStorage({ [LEGACY_KEYS.state]: '{坏', [LEGACY_KEYS.expenses]: JSON.stringify({ d1: [{ id: 'a', amount: 1 }], d2: 'x' }) });
  const r = readLegacyData(s);
  assert.equal(r.state, null);
  assert.match(r.problems[0], /taiwanTrip2026State/);
  assert.deepEqual(r.expenses, [{ day_id: 'd1', id: 'a', amount: 1 }]);
  assert.equal(normalizeLegacyState([]), null);
  assert.deepEqual(normalizeLegacyExpenses('nope'), []);
  const st = normalizeLegacyState({ completedItems: [], personalLedger: 'x', checklistStatus: { a: true } });
  assert.deepEqual(st.completedItems, {});
  assert.deepEqual(st.personalLedger, []);
  assert.deepEqual(st.checkedItems, { a: true }, 'checklistStatus 优先');
});

test('导入到哪一趟：taiwan2026 → 名字里有台湾 → 台北时区已结束的 → 第一趟能编辑的；只读的不算', () => {
  const at = new Date('2027-01-08T00:00:00Z');
  const tw = { id: 'taiwan2026', trip: { title: '台湾 · 五月' }, role: 'editor' };
  const named = { id: 'x', trip: { title: '再去台湾' }, role: 'owner' };
  const tpe = { id: 'y', trip: { title: '三城', timezone: 'Asia/Taipei', start_date: '2026-03-14', end_date: '2026-03-22' }, role: 'owner' };
  const tpeFuture = { id: 'z', trip: { title: '山雾镇', timezone: 'Asia/Taipei', start_date: '2027-04-03', end_date: '2027-04-04' }, role: 'owner' };
  const ro = { id: 'taiwan2026', trip: { title: '台湾' }, role: 'viewer' };
  assert.deepEqual(pickLegacyTarget([named, tw], at), { id: 'taiwan2026', title: '台湾 · 五月', sure: true });
  assert.deepEqual(pickLegacyTarget([tpe, named], at), { id: 'x', title: '再去台湾', sure: false });
  assert.equal(pickLegacyTarget([tpeFuture, tpe], at).id, 'y', '台北时区里先挑已结束的');
  assert.equal(pickLegacyTarget([ro], at), null);
  assert.equal(pickLegacyTarget([], at), null);
});

test('导入预览：完成状态（legacy_id → 第几天几点的主方案；已完成 / 跳过 / 对不上 / 同一时间好几条）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.items;
  assert.deepEqual(s.ops.map((o) => o.id), ['I1', 'I2'], 'd1-1400 按 legacy_id；d2-1000 按第 2 天 10:00');
  assert.equal(s.already, 1, 'd2-1900 已经是完成');
  const reasons = Object.fromEntries(s.skipped.map((x) => [x.name, x.reason]));
  assert.equal(reasons['四兽小径'], '新版里标了「跳过」，不改');
  assert.equal(reasons['d3-0900'], '同一时间有好几个条目，没法确定是哪一个');
  assert.equal(reasons['d9-0000'], '新版里没有这一天');
  assert.equal(reasons['odd-id'], '新版里找不到这个条目');
  assert.equal(s.skipped.length, 4, '没勾的（false）不算');
});

test('导入预览：确认状态（legacy_confirm_key → 同名的待确认）；旧版每天的小提醒对不上', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.confirm;
  assert.deepEqual(s.ops.map((o) => o.id), ['T1', 'T2']);
  assert.equal(s.already, 1);
  assert.deepEqual(s.skipped.map((x) => x.reason), ['旧版每天的小提醒，新版没有对应的待办', '新版的待确认清单里没有这一项']);
});

test('导入预览：评级（地点名字 / 别名；自己已经评过的跳过；五档换成 1–5；吃了什么 / 买了什么；旧照片链接记在 extra）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.reviews;
  assert.equal(s.ops.length, 2, '灯笼老街 + 云顶茶馆（对方评过不影响自己的）');
  const lantern = s.ops.find((o) => o.placeId === 'PL1');
  assert.deepEqual(lantern.values, {
    rating: 4, notes: '晚上灯笼都亮了',
    food_log: [{ name: '糖葫芦', note: '很甜' }], shop_log: [{ name: '小灯笼' }], visited_at: '2026-03-15T12:00:00Z',
    extra: { legacy_spot_key: 'spot-南湾-灯笼老街', legacy_rating: '顶级', legacy_photo_urls: ['https://example.com/a.jpg'] },
  });
  assert.equal(s.ops.find((o) => o.placeId === 'PL3').values.rating, 2);
  assert.equal(s.already, 1, '旧城博物馆自己已经评过');
  assert.deepEqual(s.skipped, [{ name: '不存在的店', reason: '新版的地点里没有同名的' }]);
  assert.deepEqual(RATING_FROM_LEGACY, { 夯: 5, 顶级: 4, 人上人: 3, NPC: 2, 拉完了: 1 });
});

test('导入预览：日记（日记 + 每天的备注；新建 / 接在已有的后面 / 已经有了就跳过；心情换成 emoji）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.journal;
  const d1 = s.ops.find((o) => o.dayId === 'D1');
  assert.deepEqual(d1, { kind: 'journal', dayId: 'D1', date: '2026-03-14', mode: 'new', title: '2026-03-14', values: { body: '第一天到了。\n\n备注：机场好大', mood: '🌟' } });
  const d2 = s.ops.find((o) => o.dayId === 'D2');
  assert.deepEqual(d2.values, { mood: '😴' }, '正文已经在里面了，只补心情');
  assert.equal(d2.mode, 'append');
  const d3 = s.ops.find((o) => o.dayId === 'D3');
  assert.deepEqual(d3.values, { body: '最后一天' }, '日记和备注一样的只写一次');
  assert.deepEqual(s.skipped, [{ name: 'd8', reason: '新版里没有这一天' }]);
  assert.equal(MOOD_FROM_LEGACY.bad, '🌧');
  assert.equal(mergeBody('a', 'a'), 'a');
  assert.equal(mergeBody('', ' b '), 'b');
  assert.equal(mergeBody('今天 很好', '今天很好'), '今天 很好', '空白不同也算已经包含');
});

test('导入预览：打包（同名勾上、已经勾了的跳过、新版没有的新建，id 固定）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.packing;
  assert.equal(s.already, 1);
  assert.deepEqual(s.ops.find((o) => o.kind === 'todo-done'), { kind: 'todo-done', id: 'P2', title: '充电宝' });
  const created = s.ops.filter((o) => o.kind === 'todo-new');
  assert.deepEqual(created.map((o) => [o.values.title, o.values.category, o.values.done]), [['转换插头', '电子', false], ['薄外套', '衣物', true]]);
  assert.equal(created[0].values.id, legacyRowId('trip-x', 'todo', 'packing-电子/转换插头'));
  assert.deepEqual(created[0].values.extra, { legacy_packing_key: '电子/转换插头' });
});

test('导入预览：个人记账（谁付、给谁 → 付款人 + 分摊；收入和 0 元不导入；行程日期以外的单独放）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: [] }, bundle(), { userId: ME, rate });
  const s = plan.sections.ledger;
  const by = Object.fromEntries([...s.ops, ...s.outside].map((o) => [o.values.extra.legacy_id, o.values]));
  assert.deepEqual(by['pl-1'].split, { mode: 'equal', user_ids: [ME, HER] });
  assert.equal(by['pl-1'].currency, 'TWD');
  assert.equal(by['pl-1'].fx_rate, 0.25);
  assert.equal(by['pl-1'].amount_home, 30);
  assert.equal(by['pl-1'].paid_by_user_id, ME);
  assert.deepEqual(by['pl-4'].split, { mode: 'amounts', shares: [{ user_id: HER, amount: 60 }] }, '我付的、给她的');
  assert.equal(by['pl-4'].currency, 'CNY');
  assert.equal(by['pl-5'].paid_by_user_id, HER, '她付的、给我的');
  assert.deepEqual(by['pl-5'].split, { mode: 'amounts', shares: [{ user_id: ME, amount: 30 }] });
  assert.equal(by['pl-3'].paid_by_user_id, HER, '她记的「我付、给我」= 她自己');
  assert.deepEqual(by['pl-3'].split, { mode: 'personal' });
  assert.equal(by['pl-3'].category, '其他', '不认识的分类');
  assert.equal(by['pl-3'].amount, 88, '字符串金额');
  assert.deepEqual(s.ops.map((o) => o.values.extra.legacy_id), ['pl-1', 'pl-4', 'pl-5']);
  assert.deepEqual(s.outside.map((o) => o.values.extra.legacy_id), ['pl-3'], '4 月 2 日不在行程日期内');
  assert.deepEqual(s.skipped.map((x) => x.reason), ['收入不导入（新版账本只记支出）', '金额不对']);
  assert.equal(by['pl-1'].id, legacyRowId('trip-x', 'expense', 'pl-pl-1'));
  assert.deepEqual(ledgerEntryToExpense({ id: 'q', type: 'expense', amount: 5, date: 'x' }, { tripId: 't', userId: ME, members: [] }), { reason: '没有日期' });
});

test('导入预览：共同账本只补云端没有的（按 id）；付款人和分摊按名字认；有 amount_hkd 用当时的汇率', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: LEGACY_EXPENSES }, bundle(), { userId: ME, rate });
  const s = plan.sections.expenses;
  assert.equal(s.already, 1);
  assert.equal(s.ops.length, 2);
  const [a, b] = s.ops.map((o) => o.values);
  assert.equal(a.id, '1a2b3c4d-1111-4222-8333-944445555777');
  assert.equal(a.paid_by_user_id, HER);
  assert.deepEqual(a.split, { mode: 'equal', user_ids: [HER, ME] });
  assert.equal(a.fx_rate, 0.246);
  assert.equal(a.amount_home, 61.5);
  assert.equal(a.category, '门票');
  assert.equal(b.id, legacyRowId('trip-x', 'expense', 'shared-local-9'));
  assert.equal(b.date, '2026-03-14', '没有日期时按 day_id 推');
  assert.deepEqual(b.split, { mode: 'personal' });
  const unknownPayer = sharedExpenseToExpense({ id: 'k', amount: 10, currency: 'HKD', paid_by: '路人' }, { tripId: 't', userId: ME, members: bundle().members });
  assert.equal(unknownPayer.values.paid_by_user_id, ME);
  assert.equal(unknownPayer.values.extra.legacy_paid_by, '路人');
  assert.deepEqual(unknownPayer.values.split, { mode: 'equal', user_ids: [ME, HER] });
});

test('导入预览的一句话、可以重复导入（导入过的再算一次全是「已经有了」）', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: LEGACY_EXPENSES }, bundle(), { userId: ME, rate });
  assert.equal(sectionSummary(plan.sections.items), '标成完成 2 个条目 · 1 个条目已经有了 · 4 个条目对不上');
  assert.equal(sectionSummary(plan.sections.ledger), '导入 3 笔 · 行程日期以外还有 1 笔 · 2 笔对不上');
  assert.equal(sectionSummary({ key: 'x', unit: '项', ops: [], already: 0, skipped: [] }), '没有要导入的');
  assert.equal(plan.total, Object.values(plan.sections).reduce((n, s) => n + s.ops.length, 0));
  assert.deepEqual(SECTIONS.map((s) => s.key), Object.keys(plan.sections));

  // 照预览把新行加进行程（模拟导入完、同步回来）：再预览一次，新建的东西都「已经有了」
  const b = bundle();
  const done = {
    items: b.items.map((i) => (['I1', 'I2'].includes(i.id) ? { ...i, status: 'done' } : i)),
    todos: [...b.todos.map((t) => (['T1', 'T2', 'P2'].includes(t.id) ? { ...t, done: true } : t)), ...plan.sections.packing.ops.filter((o) => o.kind === 'todo-new').map((o) => o.values)],
    reviews: [...b.reviews, ...plan.sections.reviews.ops.map((o, i) => ({ id: `new-${i}`, place_id: o.placeId, user_id: ME, ...o.values }))],
    journal: [
      { id: 'J1', day_id: 'D2', user_id: ME, body: '第二天走了很多路。', mood: '😴' },
      { id: 'J2', day_id: 'D1', user_id: ME, body: '第一天到了。\n\n备注：机场好大', mood: '🌟' },
      { id: 'J3', day_id: 'D3', user_id: ME, body: '最后一天', mood: null },
    ],
    expenses: [...b.expenses, ...plan.sections.ledger.ops.map((o) => o.values), ...plan.sections.expenses.ops.map((o) => o.values)],
  };
  const again = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: LEGACY_EXPENSES }, bundle(done), { userId: ME, rate });
  for (const k of ['items', 'confirm', 'reviews', 'journal', 'packing', 'expenses']) assert.equal(again.sections[k].ops.length, 0, `${k} 不会重复导入`);
  assert.equal(again.sections.ledger.ops.length, 0);
  assert.equal(again.sections.ledger.outside.length, 1, '没勾选的行程外那笔还在');
});

test('照预览写进数据层：每类调对应的方法；只导入勾选的；个人记账可以带上行程日期以外的；出错的记下来不中断', () => {
  const plan = planLegacyImport({ state: normalizeLegacyState(LEGACY_STATE), expenses: LEGACY_EXPENSES }, bundle(), { userId: ME, rate });
  const calls = [];
  const ok = (name) => (...args) => {
    calls.push([name, ...args]);
    return { saved: Promise.resolve({ durable: true }) };
  };
  const store = {
    setItemStatus: ok('setItemStatus'),
    toggleTodo: ok('toggleTodo'),
    insert: (table, values, o) => {
      if (values.title === '薄外套') throw new Error('写不进去');
      return ok('insert')(table, values, o);
    },
    saveReview: ok('saveReview'),
    saveJournal: ok('saveJournal'),
  };
  const r = applyLegacyImport(store, plan, { include: ['items', 'packing', 'ledger'], includeOutside: true });
  assert.deepEqual(r.counts, { items: 2, packing: 2, ledger: 4 });
  assert.deepEqual(r.failed, [{ key: 'packing', title: '薄外套', message: '写不进去' }]);
  assert.equal(r.results.length, 8);
  assert.deepEqual(calls.filter((c) => c[0] === 'setItemStatus').map((c) => [c[1], c[2]]), [['I1', 'done'], ['I2', 'done']]);
  assert.deepEqual(calls.filter((c) => c[0] === 'toggleTodo').map((c) => [c[1], c[2]]), [['P2', true]]);
  assert.equal(calls.filter((c) => c[0] === 'insert' && c[1] === 'expenses').length, 4);
  assert.ok(!calls.some((c) => c[0] === 'saveReview' || c[0] === 'saveJournal'), '没勾选的类不写');
  const all = applyLegacyImport({ ...store, insert: ok('insert') }, plan);
  assert.equal(all.counts.ledger, 3, '默认不带行程日期以外的');
  assert.equal(all.counts.reviews, 2);
  assert.equal(all.counts.journal, 3);
});
