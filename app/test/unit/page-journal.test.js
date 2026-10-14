// 日记相册页（pages/journal）、写日记面板（sheets/journal）、看大图（sheets/photo）的纯逻辑：
// 页面的按天分组 / 相册分组 / 入口默认写哪天；表单的心情、草稿、只提交改动、上传状态；照片列表的顺序、起点、重定位；
// 看大图的几何（contain、平移范围、以点缩放、双击、松手落点）和手势判定（换张 / 下拉 / 平移、吸附、关闭阈值、跟手）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWS, parseView, parseLayout, tripState, daySections, journalStats, albumGroups, authorOptions, scrollTarget, actionDay, entryTime,
} from '../../src/pages/journal/model.js';
import {
  MOODS, moodLabel, moodOptions, MOOD_MAX, defaultJournalDay, cleanPhoto, formFromEntry, applyDraft, formIsDirty, formIsEmpty, formPatch,
  uploadStateOf, uploadSummary, UPLOAD_LABELS, charCount, tripReady,
} from '../../src/sheets/journal/form.js';
import { stashPhotos, takeStashedPhotos, hasStashedPhotos } from '../../src/sheets/journal/capture.js';
import {
  entryPhotos, journalPhotoList, reviewPhotoList, resolveStartIndex, viewerArgsFor, reindex, filterByAuthor, countByAuthor, groupByDay,
  photoAlt, aspectOf, excerpt, photoFileName,
} from '../../src/sheets/photo/model.js';
import {
  containRect, panBounds, clampPan, zoomAround, rubberZoom, doubleTapZoom, settleZoom, classifyDrag, swipeTarget, shouldDismiss,
  dismissFollow, backdropOpacity, flyFromRect, visualRect, rectVisible, MAX_ZOOM, DOUBLE_TAP_ZOOM, DRAG_SLOP, DISMISS_DISTANCE,
} from '../../src/sheets/photo/gestures.js';

// ---------------------------------------------------------------------
// 夹具（全部虚构）
// ---------------------------------------------------------------------
const J = 'u-jeremy';
const C = 'u-cathy';
const members = [
  { user_id: J, display_name: 'Jeremy', color: '#2F6FDE', role: 'owner' },
  { user_id: C, display_name: 'Cathy', color: '#D9480F', role: 'editor' },
];
const days = [
  { id: 'd1', date: '2027-01-10', title: '落地' },
  { id: 'd2', date: '2027-01-11', title: '浮潜' },
  { id: 'd3', date: '2027-01-12', title: '' },
];
const photo = (path, extra = {}) => ({ path, ...extra });
const entries = {
  d1j: { id: 'j1', day_id: 'd1', user_id: J, mood: '😎', body: '第一天', photos: [photo('t/j/journal/a.jpg', { taken_at: '2027-01-10T17:44:00+07:00', width: 1200, height: 900 })], updated_at: '2027-01-10T14:00:00+00:00' },
  d1c: { id: 'j2', day_id: 'd1', user_id: C, mood: '🥰', body: '夜市', photos: [photo('t/c/journal/b.jpg', { taken_at: '2027-01-10T19:52:00+07:00' }), photo('t/c/journal/c.jpg', { caption: '椰子冰', taken_at: '2027-01-10T13:10:00+07:00' })] },
  d2c: { id: 'j3', day_id: 'd2', user_id: C, mood: '🤿', body: '', photos: [photo('t/c/journal/d.jpg')] },
};
const byDay = new Map([['d1', [entries.d1j, entries.d1c]], ['d2', [entries.d2c]]]);
const fakeStore = ({ status = 'ready', trip = { id: 't' }, source = 'network' } = {}) => ({ status: { value: status }, trip: { value: trip }, source: { value: source } });

// ---------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------
test('视图和布局：查询参数不认识的回到默认（按天、网格）；概览页链接过来的 ?tab=photos 也认（有 ?view= 时以 view 为准）', () => {
  assert.deepEqual(VIEWS.map((v) => v.value), ['days', 'album']);
  assert.equal(parseView('album'), 'album');
  assert.equal(parseView(undefined), 'days');
  assert.equal(parseView('x'), 'days');
  assert.equal(parseView(undefined, 'photos'), 'album');
  assert.equal(parseView(undefined, 'album'), 'album');
  assert.equal(parseView('days', 'photos'), 'days');
  assert.equal(parseView(undefined, 'x'), 'days');
  assert.equal(parseLayout('list'), 'list');
  assert.equal(parseLayout(undefined), 'grid');
});

test('行程数据到了没：有缓存先显示缓存；出错且没有行程才算出错；找不到 / 被移出是 missing', () => {
  assert.equal(tripState(null), 'loading');
  assert.equal(tripState(fakeStore({ status: 'loading', trip: null })), 'loading');
  assert.equal(tripState(fakeStore({ status: 'loading', source: 'cache' })), 'ready');
  assert.equal(tripState(fakeStore({ status: 'ready' })), 'ready');
  assert.equal(tripState(fakeStore({ status: 'error', trip: null })), 'error');
  assert.equal(tripState(fakeStore({ status: 'error' })), 'ready');
  assert.equal(tripState(fakeStore({ status: 'missing' })), 'missing');
  assert.equal(tripState(fakeStore({ status: 'removed' })), 'missing');
  assert.equal(tripReady(fakeStore({ status: 'ready' })), true);
  assert.equal(tripReady(null), false);
});

test('按天：每天一节，我的那格永远在前；没写的 entry 为 null；草稿标在我的那格；照片数按天算；今天标出来', () => {
  const s = daySections({ days, byDay, members, me: C, todayDate: '2027-01-11', drafts: new Set(['d3']) });
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.number), [1, 2, 3]);
  assert.deepEqual(s[0].entries.map((e) => e.userId), [C, J], 'Cathy 登录时她排第一');
  assert.equal(s[0].entries[0].mine, true);
  assert.equal(s[0].entries[0].entry.id, 'j2');
  assert.equal(s[0].photoCount, 3);
  assert.equal(s[1].isToday, true);
  assert.equal(s[1].entries[1].entry, null, 'Jeremy 第二天没写');
  assert.equal(s[2].entries[0].draft, true);
  assert.equal(s[2].entries[1].draft, false);
  assert.equal(s[2].photoCount, 0);
});

test('按天：已退出成员写过的日记不丢（排最后）；我还不是成员时也给我一格', () => {
  const extra = new Map(byDay);
  extra.set('d2', [entries.d2c, { id: 'j9', day_id: 'd2', user_id: 'u-gone', body: '旧的', photos: [] }]);
  const s = daySections({ days, byDay: extra, members, me: J, todayDate: null });
  assert.deepEqual(s[1].entries.map((e) => e.userId), [J, C, 'u-gone']);
  assert.equal(s[1].entries[2].member, null);
  const alone = daySections({ days, byDay, members: [members[1]], me: J });
  assert.equal(alone[0].entries[0].userId, J);
  assert.equal(alone[0].entries[0].entry.id, 'j1');
});

test('统计：几篇、几张、写了几天', () => {
  const s = daySections({ days, byDay, members, me: J });
  assert.deepEqual(journalStats(s), { entries: 3, photos: 4, writtenDays: 2, days: 3 });
  assert.deepEqual(journalStats([]), { entries: 0, photos: 0, writtenDays: 0, days: 0 });
});

test('相册：按天分组只留有照片的天，按作者筛选；筛选选项带张数、我排第一', () => {
  const list = journalPhotoList({ days, byDay });
  assert.equal(list.length, 4);
  const groups = albumGroups({ list, days });
  assert.deepEqual(groups.map((g) => [g.day.id, g.photos.length]), [['d1', 3], ['d2', 1]]);
  const onlyJ = albumGroups({ list, days, author: J });
  assert.deepEqual(onlyJ.map((g) => [g.day.id, g.photos.length]), [['d1', 1]]);
  const opts = authorOptions({ members, list, me: C });
  assert.deepEqual(opts.map((o) => [o.value, o.label, o.count]), [['', '全部', 4], [C, 'Cathy', 3], [J, 'Jeremy', 1]]);
});

test('打开页面先滚到哪：?day= 优先；进行中滚到今天；其他从头看；不存在的日期不滚', () => {
  const s = daySections({ days, byDay, members, me: J });
  assert.equal(scrollTarget({ query: { day: '2027-01-12' }, phase: 'ongoing', todayDate: '2027-01-11', sections: s }), '2027-01-12');
  assert.equal(scrollTarget({ query: {}, phase: 'ongoing', todayDate: '2027-01-11', sections: s }), '2027-01-11');
  assert.equal(scrollTarget({ query: {}, phase: 'upcoming', todayDate: null, sections: s }), null);
  assert.equal(scrollTarget({ query: { day: '2030-01-01' }, phase: 'ended', sections: s }), null);
});

test('入口默认写哪天：进行中 → 今天（今天没建就最近的过去一天）；已结束 → 最后一个没写的；出发前 → 第一天；没分天 → null', () => {
  assert.equal(actionDay({ days, phase: 'ongoing', todayDate: '2027-01-11' }).id, 'd2');
  assert.equal(actionDay({ days, phase: 'ongoing', todayDate: '2027-01-15' }).id, 'd3');
  assert.equal(actionDay({ days, phase: 'ended', mine: new Set(['d3']) }).id, 'd2');
  assert.equal(actionDay({ days, phase: 'ended', mine: new Set(['d1', 'd2', 'd3']) }).id, 'd3');
  assert.equal(actionDay({ days, phase: 'upcoming' }).id, 'd1');
  assert.equal(actionDay({ days: [], phase: 'ongoing' }), null);
});

test('一篇日记的钟点按行程时区；给了这一天的日期时，同一天只写钟点，隔天补写的带上日子（不写年份）', () => {
  assert.equal(entryTime(entries.d1j, 'Asia/Ho_Chi_Minh'), '21:00');
  assert.equal(entryTime(entries.d1j, 'Asia/Hong_Kong'), '22:00');
  assert.equal(entryTime({}, 'Asia/Hong_Kong'), '');
  assert.equal(entryTime(entries.d1j, 'Asia/Ho_Chi_Minh', '2027-01-10'), '21:00', '14:00Z = 胡志明 21:00，还是 1 月 10 日');
  const late = { ...entries.d1j, updated_at: '2027-01-11T02:10:00+00:00' };
  assert.match(entryTime(late, 'Asia/Ho_Chi_Minh', '2027-01-10'), /^1月11日 09:10$|^(今天|明天|昨天) 09:10$/, '隔天 09:10 补写：带日子');
  assert.equal(entryTime(late, 'Asia/Ho_Chi_Minh', '2027-01-11'), '09:10');
});

// ---------------------------------------------------------------------
// 写日记面板的纯逻辑
// ---------------------------------------------------------------------
test('心情：每个都有 emoji 和中文名，不超过 16 个字符；日记里不在列表的心情放最前面；取不到名字叫「心情」', () => {
  for (const m of MOODS) {
    assert.ok(m.emoji && m.label);
    assert.ok([...m.emoji].length <= MOOD_MAX);
    assert.equal(moodLabel(m.emoji), m.label);
  }
  assert.equal(moodLabel('🍵'), '心情');
  assert.equal(moodLabel(''), '');
  assert.equal(moodOptions('🍵')[0].emoji, '🍵');
  assert.equal(moodOptions('🥰').length, MOODS.length);
  assert.equal(moodOptions('').length, MOODS.length);
});

test('面板默认写哪天：和页面入口同一套规则', () => {
  assert.equal(defaultJournalDay({ days, phase: 'ongoing', todayDate: '2027-01-11' }).id, 'd2');
  assert.equal(defaultJournalDay({ days, phase: 'ended', todayDate: '2027-02-01', mine: new Set(['d3']) }).id, 'd2');
  assert.equal(defaultJournalDay({ days, phase: 'upcoming', todayDate: '2027-01-01' }).id, 'd1');
  assert.equal(defaultJournalDay({ days: [] }), null);
});

test('照片对象只留数据库认的字段；表单初值只留有 path 的照片', () => {
  assert.deepEqual(cleanPhoto({ path: 'p', caption: '', taken_at: 't', width: '1200', height: 900.4, preview: 'blob:x' }), { path: 'p', taken_at: 't', width: 1200, height: 900 });
  const f = formFromEntry({ mood: '😎', body: ' hi ', photos: [{ path: 'a' }, { nope: 1 }, null] });
  assert.deepEqual(f, { mood: '😎', body: ' hi ', photos: [{ path: 'a' }] });
  assert.deepEqual(formFromEntry(null), { mood: '', body: '', photos: [] });
});

test('草稿叠到表单上：和已保存的一样就不算恢复；真有不同才提示', () => {
  const base = formFromEntry(entries.d1j);
  assert.deepEqual(applyDraft(base, null), { form: base, restored: false });
  const same = applyDraft(base, { mood: '😎', body: '第一天', photos: base.photos });
  assert.equal(same.restored, false);
  const diff = applyDraft(base, { body: '第一天，补两句' });
  assert.equal(diff.restored, true);
  assert.equal(diff.form.body, '第一天，补两句');
  assert.equal(diff.form.mood, '😎', '草稿没写的字段用已保存的');
});

test('只提交改了的字段：新建三个都写；编辑只带变化的；正文首尾空白不算改动；空表单判断', () => {
  const base = formFromEntry(entries.d1j);
  assert.deepEqual(formPatch({ mood: '😎', body: '第一天 ', photos: base.photos }, entries.d1j), {});
  assert.deepEqual(formPatch({ mood: '', body: '第一天', photos: base.photos }, entries.d1j), { mood: null });
  assert.deepEqual(formPatch({ mood: '😎', body: '新', photos: [] }, entries.d1j), { body: '新', photos: [] });
  assert.deepEqual(formPatch({ mood: '', body: ' 你好 ', photos: [{ path: 'x', junk: 1 }] }, null), { mood: null, body: '你好', photos: [{ path: 'x' }] });
  assert.equal(formIsDirty({ mood: '😎', body: '第一天', photos: base.photos }, base), false);
  assert.equal(formIsDirty({ mood: '😎', body: '第一天', photos: [] }, base), true);
  assert.equal(formIsEmpty({ mood: '', body: '  ', photos: [] }), true);
  assert.equal(formIsEmpty({ mood: '', body: '', photos: [{ path: 'x' }] }), false);
  assert.equal(charCount('你好🥰'), 3);
});

test('照片上传状态：按写队列判断（排队 / 上传中 / 离线 / 失败 / 传完）', () => {
  const op = (path, extra = {}) => ({ id: `op-${path}`, kind: 'upload', file: { path }, status: 'pending', ...extra });
  assert.equal(uploadStateOf('a', { ops: [], online: true }), 'done');
  assert.equal(uploadStateOf('a', { ops: [op('a')], sending: true, online: true }), 'uploading');
  assert.equal(uploadStateOf('a', { ops: [{ id: 'x', kind: 'insert' }, op('a')], sending: true, online: true }), 'queued');
  assert.equal(uploadStateOf('a', { ops: [op('a')], sending: false, online: true }), 'queued');
  assert.equal(uploadStateOf('a', { ops: [op('a')], online: false }), 'offline');
  assert.equal(uploadStateOf('a', { ops: [op('a', { status: 'failed' })], online: true }), 'failed');
  assert.equal(uploadStateOf('a', { ops: [op('a')], failedId: 'op-a', online: true }), 'failed');
  assert.deepEqual(uploadSummary(['done', 'done', 'failed', 'offline']), { total: 4, done: 2, failed: 1, waiting: 1 });
  for (const k of ['processing', 'uploading', 'queued', 'offline', 'failed', 'error', 'done']) assert.match(UPLOAD_LABELS[k], /\S/);
});

test('拍照打卡的中转站：放进去只能取一次，过期作废', () => {
  stashPhotos([]);
  assert.equal(hasStashedPhotos(), false);
  stashPhotos([{ name: 'a.jpg' }, null]);
  assert.equal(hasStashedPhotos(), true);
  assert.deepEqual(takeStashedPhotos(), [{ name: 'a.jpg' }]);
  assert.deepEqual(takeStashedPhotos(), []);
  stashPhotos([{ name: 'b.jpg' }]);
  assert.deepEqual(takeStashedPhotos(Date.now() + 200_000), [], '超过 2 分钟没人取的作废');
});

// ---------------------------------------------------------------------
// 照片列表
// ---------------------------------------------------------------------
test('整趟相册：按天，同一天按拍摄时间，没有时间的排在那天最后并保持原顺序', () => {
  const list = journalPhotoList({ days, byDay });
  assert.deepEqual(list.map((p) => p.path), ['t/c/journal/c.jpg', 't/j/journal/a.jpg', 't/c/journal/b.jpg', 't/c/journal/d.jpg']);
  assert.equal(list[0].caption, '椰子冰');
  assert.equal(list[0].date, '2027-01-10');
  assert.equal(list[0].userId, C);
  assert.equal(list[0].indexInSource, 1);
  assert.equal(list[1].key, 't/j/journal/a.jpg');
  assert.equal(entryPhotos({ photos: [{ path: '' }, { path: 'x' }] }).length, 1);
});

test('起点：按日记 id + 第几张；找不到那一张退回这篇第一张，再退回 0；评级照片同理', () => {
  const list = journalPhotoList({ days, byDay });
  assert.equal(resolveStartIndex(list, { entry: 'j2', index: 0 }), 2);
  assert.equal(resolveStartIndex(list, { entry: 'j2', index: '1' }), 0);
  assert.equal(resolveStartIndex(list, { entry: 'j2', index: 9 }), 0, '退回这篇的第一张（相册顺序里是第 0 张）');
  assert.equal(resolveStartIndex(list, { entry: 'nope' }), 0);
  assert.equal(resolveStartIndex([], { entry: 'j2' }), 0);
  const rv = reviewPhotoList({ id: 'r1', place_id: 'p1', user_id: J, visited_at: '2027-01-11T05:00:00Z', photos: [{ path: 'r/a.jpg' }, { path: 'r/b.jpg', caption: '招牌' }] }, { name: '海鲜档' });
  assert.equal(rv.length, 2);
  assert.equal(rv[0].caption, '海鲜档');
  assert.equal(rv[1].caption, '招牌');
  assert.equal(rv[0].takenAt, '2027-01-11T05:00:00Z');
  assert.equal(resolveStartIndex(rv, { review: 'r1', index: 1 }), 1);
  assert.deepEqual(viewerArgsFor(rv[1]), { reviewId: 'r1', index: 1 });
  assert.deepEqual(viewerArgsFor(list[2]), { entryId: 'j2', index: 0 });
  assert.equal(viewerArgsFor(null), null);
});

test('列表变了以后还看原来那张；被删了就停在原位（夹在范围内）；按作者筛选和计数；按天分组', () => {
  const list = journalPhotoList({ days, byDay });
  assert.equal(reindex(list, 't/c/journal/d.jpg', 0), 3);
  assert.equal(reindex(list, 'gone', 9), 3);
  assert.equal(reindex([], 'gone', 2), 0);
  assert.equal(filterByAuthor(list, J).length, 1);
  assert.equal(filterByAuthor(list, null).length, 4);
  assert.deepEqual([...countByAuthor(list)], [[C, 3], [J, 1]]);
  assert.deepEqual(groupByDay(list, days).map((g) => g.day.id), ['d1', 'd2']);
});

test('分享 / 保存的文件名：谁-哪天-第几张，扩展名跟存储路径；名字里的斜杠、空白换成连字符', () => {
  const list = journalPhotoList({ days, byDay });
  assert.equal(photoFileName(list[0], { name: 'Cathy' }), 'Cathy-2027-01-10-2.jpg');
  assert.equal(photoFileName({ path: 'x/y.PNG', date: '2027-01-11', indexInSource: 0 }, { name: 'Je remy/K' }), 'Je-remy-K-2027-01-11-1.png');
  assert.equal(photoFileName({ path: 'noext' }, {}), '照片.jpg');
  assert.equal(photoFileName(null, {}), '照片.jpg');
});

test('读屏文字、宽高比、摘录', () => {
  assert.equal(photoAlt({ caption: '夜市' }, { name: 'Cathy', dayNumber: 1 }), '夜市 · Cathy在第 1 天拍的');
  assert.equal(photoAlt({}, { name: 'Jeremy', dayNumber: 2 }), 'Jeremy在第 2 天拍的照片');
  assert.equal(photoAlt({}, {}), '照片');
  assert.equal(aspectOf({ width: 1200, height: 900 }), 4 / 3);
  assert.equal(aspectOf({ width: 0, height: 900 }), 4 / 3);
  assert.equal(aspectOf(null, 1), 1);
  assert.equal(excerpt('  第一行\n\n第二行  '), '第一行 第二行');
  assert.equal(excerpt('一二三四五六', 3), '一二三…');
  assert.equal(excerpt(''), '');
});

// ---------------------------------------------------------------------
// 看大图：几何
// ---------------------------------------------------------------------
const V = { width: 390, height: 844 };

test('照片等比放进屏幕（contain）并居中；留白从可用区域里扣；无效比例按 4:3', () => {
  const F = containRect(4 / 3, V);
  assert.equal(F.width, 390);
  assert.equal(Math.round(F.height), 293);
  assert.equal(Math.round(F.top), 276);
  const tall = containRect(3 / 4, V, { top: 50, bottom: 34 });
  assert.equal(Math.round(tall.height), 520, '竖图：宽占满 390，高 520，放得下');
  assert.equal(Math.round(tall.top), 50 + (760 - 520) / 2);
  assert.equal(tall.left, 0);
  const veryTall = containRect(1 / 4, V, { top: 50, bottom: 34 });
  assert.equal(Math.round(veryTall.height), 760, '太高的图按高度算');
  assert.equal(Math.round(veryTall.left), Math.round((390 - 760 / 4) / 2));
  assert.equal(containRect(NaN, V).width, 390);
});

test('放大后的平移范围：比屏幕窄时只能居中；比屏幕宽时边不能离开屏幕；夹回范围', () => {
  const F = containRect(4 / 3, V);
  const b1 = panBounds(F, 1, V);
  assert.equal(b1.minX, b1.maxX);
  assert.equal(b1.minY, b1.maxY);
  const b2 = panBounds(F, 2, V);
  assert.equal(b2.maxX, -F.left);
  assert.equal(b2.minX, V.width - F.width * 2 - F.left);
  const c = clampPan({ s: 2, x: 500, y: -9999 }, F, V);
  assert.equal(c.x, b2.maxX);
  assert.equal(c.y, b2.minY);
});

test('以屏幕上某一点为中心缩放：那一点下面的内容不动', () => {
  const F = containRect(1, V);
  const point = { x: 100, y: 400 };
  const z0 = { s: 1, x: 0, y: 0 };
  const z1 = zoomAround(z0, 2, point, F);
  // 缩放前后，point 对应的照片内坐标一样
  const u0 = { x: (point.x - F.left - z0.x) / z0.s, y: (point.y - F.top - z0.y) / z0.s };
  const u1 = { x: (point.x - F.left - z1.x) / z1.s, y: (point.y - F.top - z1.y) / z1.s };
  assert.ok(Math.abs(u0.x - u1.x) < 1e-9 && Math.abs(u0.y - u1.y) < 1e-9);
});

test('捏合过界有阻尼；双击放大到固定倍数、再双击还原；松手落点回到 1–最大倍数之间', () => {
  assert.ok(rubberZoom(0.5) > 0.5 && rubberZoom(0.5) < 1);
  assert.ok(rubberZoom(MAX_ZOOM + 3) > MAX_ZOOM && rubberZoom(MAX_ZOOM + 3) < MAX_ZOOM + 3);
  assert.equal(rubberZoom(2), 2);
  const F = containRect(4 / 3, V);
  const z = doubleTapZoom({ s: 1, x: 0, y: 0 }, { x: 195, y: 422 }, F, V);
  assert.equal(z.s, DOUBLE_TAP_ZOOM);
  assert.deepEqual(doubleTapZoom(z, { x: 10, y: 10 }, F, V), { s: 1, x: 0, y: 0 });
  assert.deepEqual(settleZoom({ s: 0.7, x: 30, y: 30 }, { x: 0, y: 0 }, F, V), { s: 1, x: 0, y: 0 });
  const over = settleZoom({ s: 9, x: 0, y: 0 }, { x: 195, y: 422 }, F, V);
  assert.equal(over.s, MAX_ZOOM);
  const b = panBounds(F, MAX_ZOOM, V);
  assert.ok(over.x >= b.minX - 1e-6 && over.x <= b.maxX + 1e-6);
});

// ---------------------------------------------------------------------
// 看大图：手势判定
// ---------------------------------------------------------------------
test('拖动是什么手势：没到阈值 null；没放大横着是换张、往下是关闭、往上不做事；放大了是平移，贴边再往外拉是换张', () => {
  assert.equal(classifyDrag({ dx: 3, dy: 2 }), null);
  assert.equal(classifyDrag({ dx: 20, dy: 5 }), 'swipe');
  assert.equal(classifyDrag({ dx: 5, dy: 30 }), 'dismiss');
  assert.equal(classifyDrag({ dx: 5, dy: -30 }), 'swipe');
  assert.equal(classifyDrag({ dx: 20, dy: 5, zoomed: true }), 'pan');
  assert.equal(classifyDrag({ dx: 20, dy: 5, zoomed: true, atMaxX: true }), 'swipe');
  assert.equal(classifyDrag({ dx: -20, dy: 5, zoomed: true, atMinX: true }), 'swipe');
  assert.equal(classifyDrag({ dx: -20, dy: 5, zoomed: true, atMaxX: true }), 'pan');
  assert.equal(classifyDrag({ dx: 0, dy: 30, zoomed: true }), 'pan');
  assert.ok(DRAG_SLOP > 0);
});

test('左右滑松手停在哪：拉得远或甩得快就换张，反方向甩留在原地，两端夹住', () => {
  const o = { index: 1, count: 3, width: 390 };
  assert.equal(swipeTarget({ ...o, dx: -30, vx: 0 }), 1);
  assert.equal(swipeTarget({ ...o, dx: -120, vx: 0 }), 2);
  assert.equal(swipeTarget({ ...o, dx: 120, vx: 0 }), 0);
  assert.equal(swipeTarget({ ...o, dx: -40, vx: -900 }), 2, '甩一下');
  assert.equal(swipeTarget({ ...o, dx: -120, vx: 900 }), 1, '拉远了又反方向甩回去：不换');
  assert.equal(swipeTarget({ ...o, index: 2, dx: -300, vx: -900 }), 2);
  assert.equal(swipeTarget({ ...o, index: 0, dx: 300, vx: 0 }), 0);
  assert.equal(swipeTarget({ index: 0, count: 0, dx: -300, vx: 0, width: 390 }), 0);
});

test('往下拉松手：过了距离或甩得快就关，往上甩不关', () => {
  assert.equal(shouldDismiss({ dy: DISMISS_DISTANCE + 1, vy: 0 }), true);
  assert.equal(shouldDismiss({ dy: 40, vy: 900 }), true);
  assert.equal(shouldDismiss({ dy: 10, vy: 900 }), false, '几乎没拉就甩：不关（防误触）');
  assert.equal(shouldDismiss({ dy: 60, vy: 0 }), false);
  assert.equal(shouldDismiss({ dy: 200, vy: -500 }), false);
});

test('往下拉的跟手：照片跟着手指、越往下越小，按下的那一点留在手指下面；背景越来越透；往上拉有阻尼', () => {
  const grab = { x: 100, y: 50 };
  const a = dismissFollow(0, 0, grab, 844);
  assert.deepEqual(a.fly, { x: 0, y: 0, s: 1, ix: 0, iy: 0, r: 0 });
  assert.equal(a.progress, 0);
  const b = dismissFollow(10, 200, grab, 844);
  assert.ok(b.fly.s < 1 && b.fly.s >= 0.72);
  assert.ok(b.progress > 0 && b.progress < 1);
  // 按下的点（grab）缩放后仍在手指下面：grab 点的新位置 = fly 平移 + grab × s = 手指位移 + grab
  assert.ok(Math.abs(b.fly.x + grab.x * b.fly.s - (10 + grab.x)) < 1e-9);
  assert.ok(Math.abs(b.fly.y + grab.y * b.fly.s - (200 + grab.y)) < 1e-9);
  assert.ok(backdropOpacity(b.progress) < 1);
  assert.equal(backdropOpacity(0), 1);
  assert.equal(backdropOpacity(1), 0);
  const up = dismissFollow(0, -300, grab, 844);
  assert.ok(up.fly.y < 0 && up.fly.y > -60);
  assert.equal(up.fly.s, 1);
});

test('矩形换算：此刻在屏幕上的矩形 ↔ 照片框的 fly 数值；矩形和视口有没有交集', () => {
  const F = containRect(4 / 3, V);
  const vis = visualRect(F, { s: 2, x: -100, y: -50 }, { x: 0, y: 0, s: 1 });
  assert.equal(vis.width, F.width * 2);
  assert.equal(vis.left, F.left - 100);
  const fly = flyFromRect({ left: 20, top: 400, width: 195, height: 146.25 }, F);
  assert.equal(fly.s, 0.5);
  assert.equal(fly.x, 20 - F.left);
  assert.equal(rectVisible({ left: 0, top: 0, width: 10, height: 10 }, V), true);
  assert.equal(rectVisible({ left: 400, top: 0, width: 10, height: 10 }, V), false);
  assert.equal(rectVisible({ left: 0, top: -20, width: 10, height: 10 }, V), false);
  assert.equal(rectVisible(null, V), false);
});
