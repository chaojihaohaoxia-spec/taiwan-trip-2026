// 数据层 · 小模块：工具函数、错误翻译、写入校验（和 SQL 约束一致）、币种和换算、排序值、图片尺寸、
// 行程列表排序、缓存、内存 kv，以及 Supabase 适配层（用假的 supabase 客户端核对发出去的请求）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../../src/data/util.js';
import { DataError, toDataError, toAuthError } from '../../src/data/errors.js';
import { BUNDLE_TABLES, validateRow, writableColumns, readonlyOnUpdate, normalizeIncomingRow, rowKey, matchOf, isValidTimeZone } from '../../src/data/tables.js';
import { REALTIME_TABLES, TABLES } from '../../src/data/schema.js';
import { normalizeCurrency, currencyDecimals, toMinor, fromMinor, allocate, createFx, fxRates, setFxRates, resetFxRates } from '../../src/data/fx.js';
import { between, planMove, nextSortValue } from '../../src/data/ordering.js';
import { prepareImage, isHeic, mimeOf, extensionFor, isImageFile } from '../../src/data/image.js';
import { sortTripsForList, pickCurrentTrip, resolveGo, toEntries } from '../../src/data/trips.js';
import { readTripCache, writeTripCache, patchTripCache, CACHE_VERSION, tripKey } from '../../src/data/cache.js';
import { createMemoryKv } from '../../src/data/kv.js';
import { createSupabaseBackend } from '../../src/data/backend-supabase.js';
import { fetchWithTimeout } from '../../src/data/supabase.js';
import { AUTH_STORAGE_KEY } from '../../src/data/config.js';
import { nowInZone, zonedStartOfDay, tzOffsetMs } from '../../src/data/zoned.js';

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------

test('时间戳统一写法（PostgREST、实时推送、用户输入）', () => {
  assert.equal(U.normalizeTimestamptz('2027-01-10 03:35:00+00'), '2027-01-10T03:35:00+00:00');
  assert.equal(U.normalizeTimestamptz('2027-01-10T03:35Z'), '2027-01-10T03:35:00+00:00');
  assert.equal(U.normalizeTimestamptz('2027-01-10T10:35:00.123456+0700'), '2027-01-10T10:35:00.123456+07:00');
  assert.equal(U.normalizeTimestamptz('2027-01-10T03:35:00+00:00'), '2027-01-10T03:35:00+00:00');
  assert.equal(U.normalizeTimestamptz(null), null);
  assert.equal(U.toTimestamptz(new Date('2027-01-10T03:35:00Z')), '2027-01-10T03:35:00.000+00:00');
  assert.equal(U.isValidTimestamptz('2027-01-10T10:00:00'), false, '必须带时区');
  assert.equal(U.isValidTimestamptz('2027-01-10T10:00:00+07:00'), true);
});

test('钟点统一成 HH:MM:SS；日期必须真实存在', () => {
  assert.equal(U.normalizeTime('9:05'), '09:05:00');
  assert.equal(U.normalizeTime('21:30:15.5'), '21:30:15');
  assert.equal(U.normalizeTime(''), null);
  assert.throws(() => U.normalizeTime('25:00'), /超出范围/);
  assert.throws(() => U.normalizeTime('上午'), /格式不对/);
  assert.equal(U.timeToMinutes('10:30:00'), 630);
  assert.equal(U.isValidDate('2027-02-29'), false);
  assert.equal(U.isValidDate('2028-02-29'), true);
  assert.equal(U.addDays('2027-02-28', 1), '2027-03-01');
});

test('只提交改动字段：jsonb 键的顺序不同不算改动', () => {
  const cur = { title: 'a', cost_estimate: { amount: 1, currency: 'VND' }, tags: ['x'] };
  assert.deepEqual(U.diffPatch(cur, { title: 'a', cost_estimate: { currency: 'VND', amount: 1 }, tags: ['x'], note: undefined }), {});
  assert.deepEqual(U.diffPatch(cur, { title: 'b', tags: ['x', 'y'] }), { title: 'b', tags: ['x', 'y'] });
  assert.equal(U.deepEqual(null, undefined), false);
  assert.equal(U.deepEqual(NaN, NaN), true);
  assert.match(U.newId(), U.UUID_RE);
  assert.equal(U.emailHandle('cathy@example.com'), 'cathy');
});

test('时区换算：当地钟点 ↔ 时刻（含夏令时）', () => {
  assert.equal(tzOffsetMs(new Date('2027-01-10T00:00:00Z'), 'Asia/Ho_Chi_Minh'), 7 * 3600e3);
  assert.equal(new Date(zonedStartOfDay('2027-01-10', 'Asia/Ho_Chi_Minh')).toISOString(), '2027-01-09T17:00:00.000Z');
  // 纽约 2027-03-14 02:00 开始夏令时：当天零点还是 -5，次日零点是 -4
  assert.equal(new Date(zonedStartOfDay('2027-03-14', 'America/New_York')).toISOString(), '2027-03-14T05:00:00.000Z');
  assert.equal(new Date(zonedStartOfDay('2027-03-15', 'America/New_York')).toISOString(), '2027-03-15T04:00:00.000Z');
  assert.deepEqual(nowInZone(new Date('2027-01-10T16:59:00Z'), 'Asia/Ho_Chi_Minh'), { date: '2027-01-10', time: '23:59:00', minutes: 1439 });
});

// ---------------------------------------------------------------------
// 错误翻译
// ---------------------------------------------------------------------

test('后台错误 → 中文 DataError（kind 决定写队列重试还是停下来）', () => {
  const rls = toDataError({ code: '42501', message: 'new row violates row-level security policy for table "items"' }, { status: 403 });
  assert.deepEqual([rls.kind, rls.retryable, rls.message], ['permission', false, '没有权限做这个操作']);
  const net = toDataError({ message: 'TypeError: Failed to fetch', code: '' }, { status: 0 });
  assert.deepEqual([net.kind, net.retryable], ['network', true]);
  assert.equal(toDataError(new TypeError('Load failed')).kind, 'network', 'Safari 的断网写法');
  assert.equal(toDataError({ message: 'JWT expired', code: 'PGRST301' }, { status: 401 }).kind, 'auth');
  assert.equal(toDataError({ message: 'x' }, { status: 503 }).kind, 'server');
  assert.equal(toDataError({ message: 'x' }, { status: 429 }).retryable, true);
  assert.equal(toDataError({ code: '23505', message: 'duplicate key' }).kind, 'conflict');
  assert.equal(toDataError({ code: '23514', message: 'check' }).message, '内容不符合规则');
  assert.equal(toDataError({ code: '22023', message: '邀请码无效或已过期' }).message, '邀请码无效或已过期', '我们自己的 RPC 报的是中文，直接用');
  assert.equal(toDataError({ code: 'PGRST116', message: 'x' }).kind, 'not-found');
  assert.equal(toDataError({ message: 'x', statusCode: '413' }, { status: 413 }).message, '文件太大了（最大 20 MB）');
  const e = new DataError('a', { kind: 'network' });
  assert.equal(toDataError(e), e);
  assert.deepEqual(DataError.from(e.toJSON()).kind, 'network');
});

test('登录错误 → 中文', () => {
  assert.equal(toAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }).message, '邮箱或密码不对');
  assert.equal(toAuthError({ message: 'For security purposes, you can only request this after 42 seconds.', status: 429 }).message, '操作太频繁，请 42 秒后再试');
  assert.equal(toAuthError({ message: 'Token has expired or is invalid', status: 403 }).message, '验证码不对或已过期');
  assert.equal(toAuthError({ code: 'weak_password', message: 'Password should be at least 8 characters.' }).message, '密码太简单了：至少 8 位');
  assert.equal(toAuthError({ message: 'Signups not allowed for otp' }).message, '这个邮箱还没注册，请先注册');
  assert.equal(toAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }).kind, 'network');
  assert.equal(toAuthError({ message: 'User already registered' }).kind, 'conflict');
});

// ---------------------------------------------------------------------
// 表元数据和校验
// ---------------------------------------------------------------------

test('数据包的表 = 文档 A6 的实时表；可写列不含系统列 / 生成列 / 旧版列', () => {
  assert.deepEqual([...BUNDLE_TABLES].sort(), [...REALTIME_TABLES].sort());
  const w = writableColumns('expenses');
  for (const c of ['created_at', 'updated_at', 'created_by', 'updated_by', 'currency_iso', 'amount_hkd', 'paid_by', 'split_with', 'receipt_url', 'day_id']) assert.ok(!w.includes(c), c);
  for (const c of ['amount', 'currency', 'split', 'fx_rate', 'deleted_at']) assert.ok(w.includes(c), c);
  assert.ok(readonlyOnUpdate('journal_entries').has('user_id'));
  assert.ok(readonlyOnUpdate('items').has('trip_id'));
  assert.equal(rowKey('trip_members', { trip_id: 't', user_id: 'u' }), 't|u');
  assert.deepEqual(matchOf('trip_members', { trip_id: 't', user_id: 'u', role: 'x' }), { trip_id: 't', user_id: 'u' });
});

test('写入校验和 SQL 的约束一致（NOT NULL、枚举、CHECK、JSON 结构）', () => {
  const base = { id: U.newId(), trip_id: 't', extra: {} };
  const item = { ...base, title: 'x', kind: 'other', status: 'planned', variant: 'primary', sort_key: 10, links: [], tags: [], stops: [] };
  assert.equal(validateRow('items', item), null);
  assert.match(validateRow('items', { ...item, title: ' ' }).message, /标题：不能为空/);
  assert.match(validateRow('items', { ...item, kind: 'boat' }).message, /类型：取值不对/);
  assert.match(validateRow('items', { ...item, variant: 'primary', parent_item_id: U.newId() }).message, /主方案不能挂/);
  assert.match(validateRow('items', { ...item, start_time: '25:00' }).message, /钟点格式不对/);
  assert.match(validateRow('items', { ...item, cost_estimate: { amount: 10, amount_max: 5, currency: 'VND' } }).message, /上限不能小于下限/);
  assert.match(validateRow('items', { ...item, cost_estimate: { amount: 10, currency: 'vnd' } }).message, /ISO/);
  assert.match(validateRow('items', { ...item, transport_in: { options: [{ mode: 'rocket' }] } }).message, /交通方式不认识/);
  assert.match(validateRow('items', { ...item, links: [{ url: 'x' }] }).message, /链接/);
  const place = { ...base, name: 'p', kind: 'other', coord_precision: 'exact', aliases: [], links: [], tags: [], wishlist: false };
  assert.match(validateRow('places', { ...place, lat: 10, lng: null }).message, /经纬度要一起写/);
  assert.match(validateRow('places', { ...place, lat: 91, lng: 10 }).message, /超出范围/);
  const booking = { ...base, kind: 'hotel', title: 'h', status: 'booked', payment_status: 'unpaid', attachments: [], links: [], details: {}, sort: 0 };
  assert.match(validateRow('bookings', { ...booking, price_amount: 100 }).message, /写了价格就要写币种/);
  assert.match(validateRow('bookings', { ...booking, start_at: '2027-01-02T00:00:00+00:00', end_at: '2027-01-01T00:00:00+00:00' }).message, /不能早于/);
  assert.match(validateRow('bookings', { ...booking, start_tz: 'Asia/Nowhere' }).message, /时区/);
  const exp = { ...base, amount: 1, currency: 'VND', split: { mode: 'equal', user_ids: [] } };
  assert.match(validateRow('expenses', exp).message, /平摊要选至少一个人/);
  assert.equal(validateRow('expenses', { ...exp, split: {} }), null, '旧数据的空对象可以');
  assert.match(validateRow('expenses', { ...exp, split: { mode: 'half' } }).message, /分摊方式/);
  assert.match(validateRow('journal_entries', { ...base, day_id: U.newId(), user_id: U.newId(), body: '', photos: [], mood: '😀'.repeat(17) }).message, /最多 16 个字符/);
  assert.match(validateRow('todos', { ...base, list: 'todo', title: 'x', done: false, sort: 0, qty: -1 }).message, /不能小于 0/);
  assert.match(validateRow('trips', { id: 't', title: 'x', timezone: 'Asia/Hong_Kong', home_currency: 'HKD', cover: {}, status: 'planning', sort: 0, extra: {}, start_date: '2027-01-02', end_date: '2027-01-01' }).message, /不能早于开始日期/);
  assert.equal(isValidTimeZone('Asia/Ho_Chi_Minh'), true);
  assert.equal(isValidTimeZone('Asia/Saigon '), false);
});

test('后台来的行统一写法后冻结（实时推送偶尔是空格和 +00）', () => {
  const r = normalizeIncomingRow('items', { id: 'x', updated_at: '2027-01-10 03:35:00+00', start_time: '9:30', sort_key: '15.5', title: 't' });
  assert.equal(r.updated_at, '2027-01-10T03:35:00+00:00');
  assert.equal(r.start_time, '09:30:00');
  assert.equal(r.sort_key, 15.5);
  assert.ok(Object.isFrozen(r));
});

// ---------------------------------------------------------------------
// 币种
// ---------------------------------------------------------------------

test('币种：NTD → TWD、RMB → CNY；越南盾、新台币没有小数；最小单位换算不出浮点误差', () => {
  assert.equal(normalizeCurrency(' ntd '), 'TWD');
  assert.equal(normalizeCurrency('RMB'), 'CNY');
  assert.equal(normalizeCurrency(''), null);
  assert.equal(currencyDecimals('VND'), 0);
  assert.equal(currencyDecimals('HKD'), 2);
  assert.equal(toMinor(1.005, 'HKD'), 101);
  assert.equal(toMinor(0.1 + 0.2, 'HKD'), 30);
  assert.equal(fromMinor(12345, 'CNY'), 123.45);
  assert.equal(toMinor(150000.4, 'VND'), 150000);
});

test('按权重分摊：份额之和严格等于总额（含负数）', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(10, [3, 1]), [8, 2]);
  assert.deepEqual(allocate(5, [0, 0]), [5, 0]);
  for (const [t, w] of [[99999, [1, 2, 3, 4]], [7, [0.3, 0.3, 0.4]]]) assert.equal(allocate(t, w).reduce((a, b) => a + b, 0), t);
});

test('换算：参考汇率（港币为中间币）；换一套汇率后信号更新', () => {
  const fx = createFx();
  assert.equal(fx.rate('HKD', 'HKD'), 1);
  assert.equal(fx.convert(3300, 'VND', 'HKD'), 1);
  assert.ok(Math.abs(fx.convert(1, 'CNY', 'TWD') - 1.17 * 4.07) < 1e-9);
  assert.equal(fx.convert(1, 'JPY', 'HKD'), null);
  assert.equal(fx.source, 'approx');
  setFxRates({ HKD: 1, VND: 1 / 3000, JPY: 0.05 }, { source: 'live', at: '2027-01-10T00:00:00Z' });
  assert.equal(fxRates.value.source, 'live');
  assert.equal(fxRates.value.convert(100, 'JPY', 'HKD'), 5);
  resetFxRates();
  assert.equal(fxRates.value.source, 'approx');
});

// ---------------------------------------------------------------------
// 排序值、图片、行程列表
// ---------------------------------------------------------------------

test('排序值：中间值；整数没有空隙时整列重新编号', () => {
  assert.equal(between(10, 20, false), 15);
  assert.equal(between(10, 11, false), 10.5);
  assert.equal(between(null, 10, true), 0);
  assert.equal(between(30, null, true), 40);
  assert.equal(between(10, 11, true), null);
  const list = [{ id: 'a', sort: 10 }, { id: 'b', sort: 11 }, { id: 'c', sort: 12 }];
  assert.deepEqual(planMove(list, 'c', 0, { field: 'sort', integer: true }), [{ id: 'c', value: 0 }], '移到最前：比第一条小 10，只改一行');
  assert.deepEqual(planMove(list, 'c', 1, { field: 'sort', integer: true }), [{ id: 'c', value: 20 }, { id: 'b', value: 30 }], '10 和 11 之间没有整数：重新编号（没变的 a 不写）');
  assert.deepEqual(planMove([{ id: 'a', sort_key: 10 }, { id: 'b', sort_key: 20 }, { id: 'c', sort_key: 30 }], 'a', 2, { field: 'sort_key', integer: false }), [{ id: 'a', value: 40 }]);
  assert.deepEqual(planMove(list, 'a', 0), []);
  assert.equal(nextSortValue([{ sort: 15 }, { sort: 30 }]), 40);
  assert.equal(nextSortValue([]), 10);
});

test('照片：压缩结果整理成上传要的形状（含拍摄时间）；HEIC 解不开就原样上传；其他图片打不开给中文错误', async () => {
  const jpeg = new Blob(['x'.repeat(10)], { type: 'image/jpeg' });
  const r = await prepareImage({ type: 'image/png', name: 'a.png', size: 5000 }, {
    compress: async () => ({ blob: jpeg, type: 'image/jpeg', width: 2048, height: 1536, bytesBefore: 5000, bytesAfter: 10, takenAt: { iso: '2027-01-10T18:30:00+07:00' } }),
  });
  assert.deepEqual({ ...r, blob: undefined }, { blob: undefined, type: 'image/jpeg', width: 2048, height: 1536, size: 10, originalSize: 5000, converted: true, reason: null, takenAt: '2027-01-10T18:30:00+07:00' });
  const small = { type: 'image/jpeg', name: 's.jpg', size: 8 };
  const keep = await prepareImage(small, { compress: async () => ({ blob: jpeg, type: 'image/jpeg', width: 800, height: 600, sourceWidth: 800, sourceHeight: 600, bytesBefore: 8, bytesAfter: 10, exif: null, takenAt: null }) });
  assert.deepEqual([keep.blob, keep.converted, keep.reason], [small, false, 'original-smaller'], '没有 EXIF、不用缩小、原图更小：用原图');
  const withExif = await prepareImage(small, { compress: async () => ({ blob: jpeg, type: 'image/jpeg', width: 800, height: 600, sourceWidth: 800, sourceHeight: 600, bytesBefore: 8, bytesAfter: 10, exif: { Make: 'x' }, takenAt: null }) });
  assert.equal(withExif.blob, jpeg, '有 EXIF 一律重新编码（去掉元数据）');
  const gif = await prepareImage({ type: 'image/gif', size: 3 }, { compress: async (f) => ({ blob: f, type: 'image/gif', width: 0, height: 0, bytesBefore: 3, bytesAfter: 3, skipped: 'gif', takenAt: null }) });
  assert.deepEqual([gif.converted, gif.reason, gif.width], [false, 'gif', null]);
  const heic = { type: '', name: 'IMG_0001.HEIC', size: 9 };
  const h = await prepareImage(heic, { compress: async () => { throw Object.assign(new Error('打不开'), { code: 'decode-failed' }); } });
  assert.deepEqual([h.blob, h.type, h.converted, h.reason], [heic, 'image/heic', false, 'heic-unsupported']);
  await assert.rejects(prepareImage({ type: 'image/png', size: 1 }, { compress: async () => { throw new Error('这张图片打不开，可能已损坏'); } }), (e) => e instanceof DataError && /打不开/.test(e.message));
  assert.equal(isHeic({ type: '', name: 'IMG_0001.HEIC' }), true);
  assert.equal(mimeOf({ type: '', name: 'a.jpeg' }), 'image/jpeg');
  assert.equal(mimeOf({ type: 'image/jpg' }), 'image/jpeg');
  assert.equal(extensionFor('image/heic'), 'heic');
  assert.equal(isImageFile({ type: 'application/pdf', name: 'a.pdf' }), false);
});

test('行程列表：归档在最后；进行中 → 未开始（近的在前）→ 已结束（近的在前）；当前行程和旧版快捷方式', () => {
  const mk = (id, start, end, extra = {}) => ({ id, trip: { id, title: id, start_date: start, end_date: end, timezone: 'Asia/Hong_Kong', sort: 0, status: 'planning', ...extra }, role: 'owner' });
  const entries = [
    mk('old', '2026-03-01', '2026-03-05'), mk('older', '2025-03-01', '2025-03-05'), mk('far', '2027-05-01', '2027-05-03'),
    mk('soon', '2026-10-16', '2026-10-19'), mk('now', '2026-10-10', '2026-10-12'), mk('arch', '2026-10-01', '2026-10-30', { status: 'archived' }),
  ];
  const at = new Date('2026-10-11T04:00:00Z');
  assert.deepEqual(sortTripsForList(entries, at).map((e) => e.id), ['now', 'soon', 'far', 'old', 'older', 'arch']);
  assert.equal(pickCurrentTrip(entries, at).id, 'now');
  assert.equal(pickCurrentTrip(entries.filter((e) => e.id !== 'now'), at).id, 'soon');
  assert.deepEqual(resolveGo('today', entries, at), { name: 'day', params: { tripId: 'now', date: '2026-10-11' } });
  assert.deepEqual(resolveGo('ledger', entries, at), { name: 'ledger', params: { tripId: 'now' } });
  assert.deepEqual(resolveGo('today', [mk('soon', '2026-10-16', '2026-10-19')], at), { name: 'trip', params: { tripId: 'soon' } });
  assert.equal(resolveGo('today', [], at), null);
  const e = toEntries([{ id: 'a', owner_id: 'u' }, { id: 'b', owner_id: 'x' }, { id: 'c' }], [{ trip_id: 'a', user_id: 'u', role: 'editor' }, { trip_id: 'b', user_id: 'u', role: 'viewer' }], 'u');
  assert.deepEqual(e.map((x) => [x.id, x.role]), [['a', 'owner'], ['b', 'viewer']]);
});

// ---------------------------------------------------------------------
// 缓存、kv
// ---------------------------------------------------------------------

test('缓存：按行程分开存、记着是谁的；版本不对当作没有；可以只改一行', async () => {
  const kv = createMemoryKv();
  await writeTripCache(kv, 't', 'u', { trips: [{ id: 't' }], todos: [{ id: 'a', title: 'A' }] });
  assert.equal((await readTripCache(kv, 't', 'u')).rows.todos.length, 1);
  assert.equal(await readTripCache(kv, 't', 'other'), null);
  await patchTripCache(kv, 't', 'u', 'todos', { row: { id: 'b', title: 'B' } });
  await patchTripCache(kv, 't', 'u', 'todos', { row: { id: 'a', title: 'A2' } });
  await patchTripCache(kv, 't', 'u', 'todos', { deleteKey: 'b' });
  assert.deepEqual((await readTripCache(kv, 't', 'u')).rows.todos, [{ id: 'a', title: 'A2' }]);
  await kv.set(tripKey('t'), { v: CACHE_VERSION + 1, userId: 'u', rows: {} });
  assert.equal(await readTripCache(kv, 't', 'u'), null);
});

test('内存 kv：存的是副本；按前缀列出并排序', async () => {
  const kv = createMemoryKv();
  const v = { a: [1] };
  await kv.set('op:2', v);
  await kv.set('op:1', { b: 1 });
  await kv.set('trip:x', 1);
  v.a.push(2);
  assert.deepEqual(await kv.get('op:2'), { a: [1] });
  assert.deepEqual((await kv.entries('op:')).map(([k]) => k), ['op:1', 'op:2']);
  await kv.clear('op:');
  assert.deepEqual(await kv.keys(''), ['trip:x']);
});

// ---------------------------------------------------------------------
// Supabase 适配层（假客户端，不联网）
// ---------------------------------------------------------------------

function fakeSupabase(respond) {
  const calls = [];
  const channels = [];
  const removed = [];
  const query = (table) => {
    const st = { table, op: 'select', filters: [], range: null, single: false, maybe: false, order: null, payload: null };
    const b = {
      select(cols) { st.cols = cols; return b; },
      insert(row) { st.op = 'insert'; st.payload = row; return b; },
      update(patch) { st.op = 'update'; st.payload = patch; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push(['eq', c, v]); return b; },
      in(c, v) { st.filters.push(['in', c, v]); return b; },
      match(m) { for (const [c, v] of Object.entries(m)) st.filters.push(['eq', c, v]); return b; },
      order(c) { st.order = c; return b; },
      range(a, z) { st.range = [a, z]; return b; },
      single() { st.single = true; return b; },
      maybeSingle() { st.maybe = true; return b; },
      then(res, rej) { calls.push(st); return Promise.resolve(respond(st)).then(res, rej); },
    };
    return b;
  };
  const storageCalls = [];
  const client = {
    from: query,
    rpc: (name, params) => ({ then(res, rej) { const st = { op: 'rpc', name, params }; calls.push(st); return Promise.resolve(respond(st)).then(res, rej); } }),
    storage: {
      from: (bucket) => ({
        upload: async (path, blob, o) => { storageCalls.push(['upload', bucket, path, o]); return respond({ op: 'upload', path }); },
        createSignedUrls: async (paths, ttl) => { storageCalls.push(['sign', bucket, paths, ttl]); return respond({ op: 'sign', paths, ttl }); },
        remove: async (paths) => { storageCalls.push(['remove', bucket, paths]); return { error: null }; },
      }),
    },
    channel(name) {
      const ch = { name, bindings: [], on(type, filter, cb) { this.bindings.push({ type, filter, cb }); return this; }, subscribe(cb) { this.statusCb = cb; return this; } };
      channels.push(ch);
      return ch;
    },
    removeChannel: async (ch) => { removed.push(ch); },
    auth: {
      listeners: [],
      onAuthStateChange(cb) { this.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => respond({ op: 'getSession' }),
      signUp: async (p) => respond({ op: 'signUp', p }),
      signOut: async (p) => { calls.push({ op: 'signOut', p }); return { error: null }; },
    },
  };
  return { client, calls, channels, removed, storageCalls };
}

test('Supabase：整包加载每张表按 trip_id 过滤（trips 按 id），分页拉全（每页 1000 行）', async () => {
  const f = fakeSupabase((st) => {
    if (st.table === 'items') {
      const n = st.range[0] === 0 ? 1000 : 3;
      return { data: Array.from({ length: n }, (_, i) => ({ id: `i${st.range[0] + i}` })), error: null, status: 200 };
    }
    return { data: [{ id: st.table }], error: null, status: 200 };
  });
  const be = createSupabaseBackend({ getClient: async () => f.client });
  const rows = await be.fetchTripBundle('demo-island');
  assert.deepEqual(Object.keys(rows).sort(), [...BUNDLE_TABLES].sort());
  assert.equal(rows.items.length, 1003);
  const trips = f.calls.find((c) => c.table === 'trips');
  assert.deepEqual(trips.filters, [['eq', 'id', 'demo-island']]);
  const members = f.calls.find((c) => c.table === 'trip_members');
  assert.deepEqual([members.filters, members.order], [[['eq', 'trip_id', 'demo-island']], 'user_id']);
  assert.deepEqual(f.calls.filter((c) => c.table === 'items').map((c) => c.range), [[0, 999], [1000, 1999]]);
});

test('Supabase：update 只发补丁、按主键；0 行时再读一次区分“没权限”和“已删除”', async () => {
  let exists = true;
  const f = fakeSupabase((st) => {
    if (st.op === 'update') return { data: st.filters[0][2] === 'ok' ? [{ id: 'ok', title: 'x' }] : [], error: null, status: 200 };
    if (st.op === 'select' && st.maybe) return { data: exists ? { id: 'x' } : null, error: null, status: 200 };
    if (st.op === 'delete') return { data: [], error: null, status: 200 };
    return { data: null, error: null };
  });
  const be = createSupabaseBackend({ getClient: async () => f.client });
  assert.deepEqual(await be.update('items', { id: 'ok' }, { title: 'x' }), { id: 'ok', title: 'x' });
  assert.deepEqual(f.calls[0].payload, { title: 'x' });
  await assert.rejects(be.update('items', { id: 'x' }, { title: 'y' }), (e) => e.kind === 'permission');
  exists = false;
  assert.equal(await be.update('items', { id: 'x' }, { title: 'y' }), null, '已经被删了');
  await be.remove('todos', { id: 'x' });
  exists = true;
  await assert.rejects(be.remove('todos', { id: 'x' }), /没有权限删除/);
});

test('Supabase：错误转成 DataError（RLS → permission，断网 → network）', async () => {
  const f = fakeSupabase((st) => {
    if (st.table === 'items') return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 };
    return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
  });
  const be = createSupabaseBackend({ getClient: async () => f.client });
  await assert.rejects(be.insert('items', { id: 'a' }), (e) => e instanceof DataError && e.kind === 'permission');
  await assert.rejects(be.insert('todos', { id: 'a' }), (e) => e.kind === 'network' && e.retryable);
  assert.equal(f.calls[0].single, true, 'insert 返回整行（select + single）');
});

test('Supabase：RPC 参数原样传；上传撞了同名（上次其实传成功了）当作成功；签名链接批量取', async () => {
  const f = fakeSupabase((st) => {
    if (st.op === 'rpc') return { data: 'demo-island', error: null, status: 200 };
    if (st.op === 'upload') return { data: null, error: st.path.includes('dup') ? { statusCode: '409', message: 'The resource already exists' } : null };
    if (st.op === 'sign') return { data: st.paths.map((p) => (p.includes('bad') ? { path: p, error: 'not found', signedUrl: null } : { path: p, signedUrl: `https://example.com/${p}` })), error: null };
    return { data: null, error: null };
  });
  const be = createSupabaseBackend({ getClient: async () => f.client });
  assert.equal(await be.rpc('redeem_invite', { p_code: 'X' }), 'demo-island');
  assert.deepEqual(f.calls[0], { op: 'rpc', name: 'redeem_invite', params: { p_code: 'X' } });
  await be.upload('t/u/journal/dup.jpg', new Blob(['x']), 'image/jpeg');
  assert.deepEqual(f.storageCalls[0][3], { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  assert.equal(f.storageCalls[0][1], 'trip-files');
  const m = await be.signedUrls(['a.jpg', 'bad.jpg'], 3600);
  assert.equal(m.get('a.jpg'), 'https://example.com/a.jpg');
  assert.equal(m.get('bad.jpg'), null);
});

test('Supabase 实时：每张表一个带 trip_id 过滤的监听 + 一个不过滤的 DELETE 监听；状态映射；退订；频道名每次不同', async () => {
  const f = fakeSupabase(() => ({ data: null, error: null }));
  const be = createSupabaseBackend({ getClient: async () => f.client });
  const changes = [];
  const statuses = [];
  const off = be.subscribeTrip('demo-island', { onChange: (c) => changes.push(c), onStatus: (s) => statuses.push(s) });
  await new Promise((r) => setImmediate(r));
  const ch = f.channels[0];
  assert.match(ch.name, /^trip:demo-island:\d+$/, '频道名带序号（快速离开又回来时不会撞上还在退出中的旧频道）');
  assert.equal(ch.bindings.length, BUNDLE_TABLES.length + 1);
  const trips = ch.bindings.find((b) => b.filter.table === 'trips');
  assert.equal(trips.filter.filter, 'id=eq.demo-island');
  assert.equal(ch.bindings.find((b) => b.filter.table === 'items').filter.filter, 'trip_id=eq.demo-island');
  const del = ch.bindings.find((b) => b.filter.event === 'DELETE');
  assert.equal(del.filter.table, undefined, 'DELETE 不按表、不按 trip_id 过滤');
  ch.bindings.find((b) => b.filter.table === 'items').cb({ eventType: 'UPDATE', new: { id: 'i1' }, old: { id: 'i1' } });
  del.cb({ table: 'items', eventType: 'DELETE', old: { id: 'i2' } });
  del.cb({ table: 'checkins', eventType: 'DELETE', old: { id: 'zz' } });
  assert.deepEqual(changes.map((c) => [c.table, c.type]), [['items', 'UPDATE'], ['items', 'DELETE']]);
  ch.statusCb('SUBSCRIBED');
  ch.statusCb('CHANNEL_ERROR');
  ch.statusCb('CLOSED');
  assert.deepEqual(statuses, ['live', 'error', 'off']);
  off();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.removed[0], ch);
  // 退订之后旧频道的回调一律忽略（不会把新订阅的状态写成“已断开”、不会再推送变化）
  ch.statusCb('CLOSED');
  ch.bindings.find((b) => b.filter.table === 'items').cb({ eventType: 'UPDATE', new: { id: 'i3' }, old: { id: 'i3' } });
  assert.deepEqual(statuses, ['live', 'error', 'off']);
  assert.equal(changes.length, 2);
  // 再订阅同一个行程：新的频道名
  const off2 = be.subscribeTrip('demo-island', { onChange: () => {}, onStatus: () => {} });
  await new Promise((r) => setImmediate(r));
  assert.notEqual(f.channels[1].name, ch.name);
  off2();
});

test('Supabase 登录：离线且令牌过期（刷新失败是网络问题）时，按本机保存的会话认作已登录', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    store.set(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'x', user: { id: 'u1', email: 'a@example.com', user_metadata: { display_name: '阿杰' } } }));
    const f = fakeSupabase((st) => (st.op === 'getSession' ? { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } } : {}));
    const be = createSupabaseBackend({ getClient: async () => f.client });
    const r = await be.auth.init(() => {});
    assert.deepEqual(r, { user: { id: 'u1', email: 'a@example.com', displayName: '阿杰' }, offline: true });
    const f2 = fakeSupabase((st) => (st.op === 'getSession' ? { data: { session: null }, error: null } : {}));
    assert.deepEqual(await createSupabaseBackend({ getClient: async () => f2.client }).auth.init(() => {}), { user: null, offline: false });
    // 已注册的邮箱：GoTrue 返回一个没有 identities 的假用户
    const f3 = fakeSupabase((st) => (st.op === 'signUp' ? { data: { user: { id: 'z', identities: [] }, session: null }, error: null } : {}));
    await assert.rejects(createSupabaseBackend({ getClient: async () => f3.client }).auth.signUp('a@example.com', 'abcdef'), /已经注册过了/);
    // 退出只退这台设备
    await be.auth.signOut();
    assert.deepEqual(f.calls.find((c) => c.op === 'signOut').p, { scope: 'local' });
  } finally {
    delete globalThis.localStorage;
  }
});

test('请求超时：给 supabase-js 的 fetch 带上 signal；外面传的 signal 中止也会中止', async () => {
  let seen;
  const wrapped = fetchWithTimeout((input, init) => {
    seen = init.signal;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  });
  const outer = new AbortController();
  const p = wrapped('https://example.com/rest/v1/items', { signal: outer.signal });
  outer.abort(new Error('页面离开'));
  await assert.rejects(p, /页面离开/);
  assert.ok(seen instanceof AbortSignal);
  assert.ok(TABLES.items);
});
