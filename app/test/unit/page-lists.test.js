// 清单页（src/pages/lists/model.js）和待办弹层（src/sheets/todo/form.js）的纯逻辑：
// 标签顺序和默认标签、进度、截止时间的说法和语气（含时区说明）、勾完的沉到下面（hold）、打包分组和谁的东西筛选、
// 按名字猜分类和量词、新加一项的字段（排到最后、带上筛选的人）、关联的小链接、勾的人和时间、截止时间快捷选项、
// 表单初值 / 校验 / 写入字段 / 改没改过、备注里认出电话 / 邮箱 / 网址（行里的「打电话 / 打开网页」小胶囊）。数据都是现场编的（不读真实行程）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST_IDS, LISTS, normalizeList, defaultList, progressOf, tabBadge, dueInfo, dueSummary, splitRows, PACKING_CATEGORIES,
  categoryOf, categoryGlyph, ownerOptions, normalizeWho, matchOwner, packingGroups, inferCategory, inferUnit, nextSort,
  newTodoValues, STARTER_PACKING, linkChips, doneByline, joinWords, duePresets, dueParts, dueFromParts, sinkToastText,
  zonesDiffer, zoneNote, deviceEquivalent, dayDetail, noteParts, noteActions, NOTE_ACTIONS_MAX,
} from '../../src/pages/lists/model.js';
import { initialForm, validateForm, formToValues, isDirty, sheetTitle, linkSummaryText } from '../../src/sheets/todo/form.js';

const TZ = 'Asia/Ho_Chi_Minh';
const AT = new Date('2027-01-08T09:00:00+07:00');
const ME = 'u-me';
const HER = 'u-her';

const row = (o) => ({ id: o.id, list: 'todo', title: o.id, done: false, sort: 0, ...o });

test('标签：待确认 / 待办 / 打包 / 要买；不认识的清单 → null', () => {
  assert.deepEqual(LIST_IDS, ['confirm', 'todo', 'packing', 'buy']);
  assert.deepEqual(LIST_IDS.map((l) => LISTS[l].label), ['待确认', '待办', '打包', '要买']);
  assert.equal(normalizeList('buy'), 'buy');
  assert.equal(normalizeList('nope'), null);
  assert.equal(normalizeList(undefined), null);
});

test('默认标签：出发前按 待确认 → 待办 → 打包，进行中先看待办和要买，都勾完了看第一个有内容的，空行程是待办', () => {
  const by = new Map([
    ['confirm', [row({ id: 'c', done: true })]],
    ['todo', [row({ id: 't' })]],
    ['packing', [row({ id: 'p' })]],
    ['buy', [row({ id: 'b' })]],
  ]);
  assert.equal(defaultList(by, { phase: 'upcoming' }), 'todo');
  assert.equal(defaultList(by, { phase: 'ongoing' }), 'todo');
  assert.equal(defaultList({ buy: [row({ id: 'b' })], todo: [row({ id: 't', done: true })] }, { phase: 'ended' }), 'buy');
  assert.equal(defaultList(new Map([['packing', [row({ id: 'p', done: true })]]]), {}), 'packing');
  assert.equal(defaultList(new Map(), {}), 'todo');
});

test('进度和标签上的「3/7」（一条都没有不显示）', () => {
  const p = progressOf([row({ id: 'a', done: true }), row({ id: 'b' }), row({ id: 'c', done: true })]);
  assert.deepEqual(p, { total: 3, done: 2, remaining: 1, ratio: 2 / 3 });
  assert.equal(tabBadge(p), '2/3');
  assert.equal(tabBadge(progressOf([])), null);
});

test('截止时间：过期 / 不到 1 天红色，1–3 天警示色，更晚普通；勾完的不提醒；设备时区不同时注明「（越南时间）」', () => {
  const at = AT;
  const overdue = dueInfo('2027-01-08T08:00:00+07:00', { at, timeZone: TZ });
  assert.equal(overdue.state, 'overdue');
  assert.equal(overdue.tone, 'danger');
  assert.match(overdue.label, /^已过期 · 今天 08:00$/);
  const urgent = dueInfo('2027-01-08T23:59:00+07:00', { at, timeZone: TZ });
  assert.equal(urgent.state, 'urgent');
  assert.equal(urgent.label, '还剩 14 小时 · 今天 23:59 前');
  const soon = dueInfo('2027-01-10T18:00:00+07:00', { at, timeZone: TZ });
  assert.equal(soon.state, 'soon');
  assert.equal(soon.tone, 'warning');
  assert.match(soon.label, /^还剩 2 天 9 小时 · 后天 18:00 前$/);
  const later = dueInfo('2027-01-12T20:00:00+07:00', { at, timeZone: TZ });
  assert.equal(later.state, 'later');
  assert.equal(later.tone, 'neutral');
  assert.equal(later.label, '1月12日 20:00 前');
  // 人在香港（比越南快 1 小时）：时间按行程时区写，并注明
  const hk = dueInfo('2027-01-09T08:05:00+08:00', { at, timeZone: TZ, deviceZone: 'Asia/Hong_Kong' });
  assert.equal(hk.text, '还剩 22 小时 · 明天 07:05 前');
  assert.equal(hk.label, '还剩 22 小时 · 明天 07:05 前（越南时间）');
  assert.equal(hk.zone, '越南时间');
  assert.equal(dueInfo('2027-01-09T08:05:00+07:00', { at, timeZone: TZ, deviceZone: TZ }).zone, null);
  assert.equal(dueInfo('2027-01-08T08:00:00+07:00', { at, timeZone: TZ, done: true }).state, 'done');
  assert.equal(dueInfo(null), null);
  assert.equal(dueInfo('不是时间'), null);
});

test('卡片头的截止提醒：几项过期 / 24 小时内 / 3 天内；刚勾还没沉下去的（hold）照旧算', () => {
  const rows = [
    row({ id: 'a', due_at: '2027-01-08T08:00:00+07:00' }),
    row({ id: 'b', due_at: '2027-01-08T20:00:00+07:00' }),
    row({ id: 'c', due_at: '2027-01-10T08:00:00+07:00' }),
    row({ id: 'd', due_at: '2027-01-20T08:00:00+07:00' }),
    row({ id: 'e', due_at: '2027-01-08T08:00:00+07:00', done: true }),
  ];
  const s = dueSummary(rows, { at: AT });
  assert.deepEqual(s.parts, ['1 项已过期', '1 项 24 小时内到期', '1 项 3 天内到期']);
  assert.equal(s.tone, 'danger');
  assert.equal(dueSummary([rows[2]], { at: AT }).tone, 'warning');
  assert.equal(dueSummary([rows[3]], { at: AT }), null);
  // a 刚勾上（数据里 done 了，hold 里记着勾之前没勾）：还算过期
  const held = dueSummary([{ ...rows[0], done: true }], { at: AT, hold: new Map([['a', false]]) });
  assert.equal(held.overdue, 1);
});

test('勾完的沉到下面：没勾的保持原顺序，勾完的按勾的时间从新到旧；hold 里的先留在原位；hideDone 不显示勾完的', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', done: true, done_at: '2027-01-01T10:00:00Z' }),
    row({ id: 'c' }),
    row({ id: 'd', done: true, done_at: '2027-01-03T10:00:00Z' }),
    row({ id: 'e', done: true }),
  ];
  const s = splitRows(rows);
  assert.deepEqual(s.open.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(s.done.map((r) => r.id), ['d', 'b', 'e']);
  assert.equal(s.doneCount, 3);
  // c 刚勾（数据里已经 done），还没到时间：留在没勾的那段原来的位置
  const justDone = rows.map((r) => (r.id === 'c' ? { ...r, done: true, done_at: '2027-01-08T02:00:00Z' } : r));
  const held = splitRows(justDone, { hold: new Map([['c', false]]) });
  assert.deepEqual(held.open.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(splitRows(justDone).done.map((r) => r.id), ['c', 'd', 'b', 'e']);
  // 刚取消勾的 d：先留在勾完的那段
  const unDone = rows.map((r) => (r.id === 'd' ? { ...r, done: false } : r));
  assert.deepEqual(splitRows(unDone, { hold: new Map([['d', true]]) }).done.map((r) => r.id), ['d', 'b', 'e']);
  const hidden = splitRows(rows, { hideDone: true });
  assert.deepEqual(hidden.done, []);
  assert.equal(hidden.doneCount, 3);
});

test('打包：分类（空的算其他）、图形、按整张清单的出现顺序分组；谁的东西筛选不改变组的先后，筛完没有的组不显示', () => {
  assert.deepEqual(PACKING_CATEGORIES, ['证件', '衣物', '电子', '洗护', '药品', '其他']);
  assert.equal(categoryOf({ category: '  ' }), '其他');
  assert.equal(categoryOf({ category: '衣物' }), '衣物');
  assert.equal(categoryGlyph('药品'), 'pill');
  assert.equal(categoryGlyph('潜水装备'), 'list');
  const rows = [
    row({ id: 'p1', list: 'packing', category: '衣物', assignee_user_id: HER }),
    row({ id: 'p2', list: 'packing', category: '证件' }),
    row({ id: 'p3', list: 'packing', category: '衣物', done: true }),
    row({ id: 'p4', list: 'packing', category: null, assignee_user_id: ME }),
  ];
  const all = packingGroups(rows);
  assert.deepEqual(all.map((g) => g.category), ['衣物', '证件', '其他']);
  assert.deepEqual(all[0].progress, { total: 2, done: 1, remaining: 1, ratio: 0.5 });
  assert.deepEqual(all[0].open.map((r) => r.id), ['p1']);
  assert.deepEqual(all[0].done.map((r) => r.id), ['p3']);
  assert.deepEqual(packingGroups(rows, { who: HER }).map((g) => g.category), ['衣物']);
  assert.deepEqual(packingGroups(rows, { who: 'shared' }).map((g) => [g.category, g.rows.map((r) => r.id)]), [['衣物', ['p3']], ['证件', ['p2']]]);
  assert.deepEqual(packingGroups(rows, { hideDone: true })[0].done, []);
});

test('谁的东西：选项（全部 / 共用 / owner 在前的成员）、网址里不认识的人退回全部、筛选规则', () => {
  const members = [
    { user_id: HER, role: 'editor', display_name: 'Cathy', joined_at: '2026-01-02T00:00:00Z' },
    { user_id: ME, role: 'owner', display_name: 'Jeremy', joined_at: '2026-01-01T00:00:00Z' },
    { user_id: 'u3', role: 'viewer', email: 'friend@example.com', joined_at: '2026-01-03T00:00:00Z' },
  ];
  assert.deepEqual(ownerOptions(members).map((o) => o.label), ['全部', '共用', 'Jeremy', 'Cathy', 'friend']);
  assert.equal(normalizeWho(HER, members), HER);
  assert.equal(normalizeWho('shared', members), 'shared');
  assert.equal(normalizeWho('u-gone', members), 'all');
  assert.equal(normalizeWho(undefined, members), 'all');
  assert.equal(matchOwner({ assignee_user_id: null }, 'shared'), true);
  assert.equal(matchOwner({ assignee_user_id: HER }, 'shared'), false);
  assert.equal(matchOwner({ assignee_user_id: HER }, HER), true);
  assert.equal(matchOwner({ assignee_user_id: HER }, 'all'), true);
});

test('按名字猜分类（最长的关键字赢）和量词（列了好几样、猜不出就不写；extra.unit 优先）', () => {
  assert.equal(inferCategory('充电宝'), '电子');
  assert.equal(inferCategory('防晒衣'), '衣物');
  assert.equal(inferCategory('防晒霜'), '洗护');
  assert.equal(inferCategory('洗衣液小样'), '洗护');
  assert.equal(inferCategory('晕船药'), '药品');
  assert.equal(inferCategory('护照复印件'), '证件');
  assert.equal(inferCategory('颈枕'), '其他');
  assert.equal(inferCategory('一本小说'), null);
  assert.equal(inferCategory(''), null);
  assert.equal(inferUnit('袜子'), '双');
  assert.equal(inferUnit('T 恤'), '件');
  assert.equal(inferUnit('泳裤'), '条');
  assert.equal(inferUnit('护照'), '本');
  assert.equal(inferUnit('充电线'), '根');
  assert.equal(inferUnit('机场快线车票'), '张', '「快线」里的线不算');
  assert.equal(inferUnit('防晒霜'), '瓶');
  assert.equal(inferUnit('创可贴'), '片');
  assert.equal(inferUnit('帽子、太阳镜'), '');
  assert.equal(inferUnit('相机 + 防水壳'), '');
  assert.equal(inferUnit('折叠伞或雨衣'), '');
  assert.equal(inferUnit('保鲜膜（包鱼露托运）'), '', '括号里的说明不算');
  assert.equal(inferUnit('椰子糖'), '');
  assert.equal(inferUnit('椰子糖', { unit: '袋' }), '袋');
});

test('新加一项：排到这个清单最后；带上筛选的人；打包带分类（选的 > 猜的 > 其他）和数量 1', () => {
  const rows = [row({ id: 'a', sort: 10 }), row({ id: 'b', sort: 40 }), row({ id: 'c', sort: 'x' })];
  assert.equal(nextSort(rows), 50);
  assert.equal(nextSort([]), 10);
  assert.deepEqual(newTodoValues({ list: 'todo', title: '  换钱 ', rows }), { list: 'todo', title: '换钱', sort: 50 });
  assert.deepEqual(newTodoValues({ list: 'packing', title: '充电宝', who: HER, rows: [] }), { list: 'packing', title: '充电宝', assignee_user_id: HER, category: '电子', qty: 1, sort: 10 });
  assert.equal(newTodoValues({ list: 'packing', title: '充电宝', category: '其他' }).category, '其他');
  assert.equal(newTodoValues({ list: 'packing', title: '一本小说' }).category, '其他');
  assert.equal('assignee_user_id' in newTodoValues({ list: 'packing', title: 'x', who: 'shared' }), false);
  assert.ok(STARTER_PACKING.length >= 10);
  assert.ok(STARTER_PACKING.every((s) => PACKING_CATEGORIES.includes(s.category) && s.qty >= 1));
});

test('关联的小链接：预订、条目（带 D 几）或哪一天；删掉的条目不显示', () => {
  const bookings = new Map([['b1', { id: 'b1', title: '椰影湾酒店', kind: 'hotel' }]]);
  const days = new Map([['d2', { id: 'd2', date: '2027-01-11' }]]);
  const items = new Map([
    ['i1', { id: 'i1', title: '出海浮潜', kind: 'activity', day_id: 'd2' }],
    ['i2', { id: 'i2', title: '删掉的', day_id: 'd2', deleted_at: '2027-01-01T00:00:00Z' }],
    ['i3', { id: 'i3', title: '备选池里的', day_id: null }],
  ]);
  const ctx = { bookings, days, items, dayNumber: (d) => (d === '2027-01-11' ? 2 : null), timeZone: TZ, at: AT };
  assert.deepEqual(linkChips({ booking_id: 'b1', item_id: 'i1' }, ctx).map((c) => [c.type, c.label, c.detail]), [['booking', '椰影湾酒店', null], ['item', '出海浮潜', 'D2']]);
  assert.deepEqual(linkChips({ item_id: 'i2', day_id: 'd2' }, ctx).map((c) => [c.type, c.label]), [['day', 'D2']]);
  assert.deepEqual(linkChips({ item_id: 'i3' }, ctx).map((c) => [c.type, c.date]), [['item', null]]);
  assert.deepEqual(linkChips({ booking_id: 'gone' }, ctx), []);
});

test('勾的人和时间：「我勾的 · 1 小时前」「Cathy 勾的 · 昨天 21:10」；时间比现在还晚写日期；没勾不显示', () => {
  const memberName = (u) => (u === HER ? 'Cathy' : '成员');
  assert.equal(doneByline({ done: true, done_by: ME, done_at: '2027-01-08T08:00:00+07:00' }, { memberName, meId: ME, at: AT, timeZone: TZ }), '我勾的 · 1 小时前');
  assert.equal(doneByline({ done: true, done_by: HER, done_at: '2027-01-07T21:10:00+07:00' }, { memberName, meId: ME, at: AT, timeZone: TZ }), 'Cathy 勾的 · 昨天 21:10');
  assert.equal(doneByline({ done: true, done_by: HER, done_at: '2027-01-10T20:15:00+07:00' }, { memberName, meId: ME, at: AT, timeZone: TZ }), 'Cathy 勾的 · 1月10日 20:15');
  assert.equal(doneByline({ done: true, done_by: HER }, { memberName, at: AT }), 'Cathy 勾的');
  assert.equal(doneByline({ done: false, done_by: HER }, { memberName }), null);
  assert.equal(doneByline({ done: true }, {}), null);
  assert.equal(joinWords('Cathy', '勾的'), 'Cathy 勾的');
  assert.equal(joinWords('我', '勾的'), '我勾的');
  assert.equal(joinWords('谭婧', '勾的'), '谭婧勾的');
});

test('勾完以后的提示：一项说名字（太长截断），几项说数量，只取消勾的不提示', () => {
  assert.equal(sinkToastText([{ title: '护照', list: 'packing', to: true }]), '已装好「护照」');
  assert.equal(sinkToastText([{ title: 'a', list: 'buy', to: true }, { title: 'b', list: 'buy', to: true }, { title: 'c', list: 'buy', to: false }]), '已买到 2 样');
  assert.equal(sinkToastText([{ title: '一二三四五六七八九十一二三四五', list: 'todo', to: true }]), '已完成「一二三四五六七八九十一二三…」');
  assert.equal(sinkToastText([{ title: 'a', list: 'todo', to: false }]), null);
});

test('截止时间的快捷选项（行程时区）：今晚 / 明晚 21:00、出发前一晚；已经过了的不给；日期 + 钟点和时刻互相换', () => {
  const p = duePresets({ at: AT, timeZone: TZ, startDate: '2027-01-10' });
  assert.deepEqual(p.map((x) => x.key), ['tonight', 'tomorrow']);
  const p2 = duePresets({ at: AT, timeZone: TZ, startDate: '2027-01-15' });
  assert.deepEqual(p2.map((x) => [x.key, dueParts(x.value, TZ).date]), [['tonight', '2027-01-08'], ['tomorrow', '2027-01-09'], ['eve', '2027-01-14']]);
  assert.deepEqual(duePresets({ at: new Date('2027-01-08T22:00:00+07:00'), timeZone: TZ }).map((x) => x.key), ['tomorrow']);
  assert.deepEqual(dueParts('2027-01-09T01:05:00Z', TZ), { date: '2027-01-09', time: '08:05' });
  assert.deepEqual(dueParts(null, TZ), { date: '', time: '' });
  assert.equal(dueFromParts('2027-01-09', '08:05', TZ), '2027-01-09T01:05:00.000Z');
  assert.equal(dueFromParts('2027-01-09', '', TZ), '2027-01-09T16:59:00.000Z', '没写钟点按 23:59');
  assert.equal(dueFromParts('', '08:05', TZ), null);
});

test('待办弹层：表单初值（编辑 / 新建预填：只给条目时天从条目推，从预订来默认待确认）、校验、写入字段、改没改过', () => {
  const items = new Map([['i1', { id: 'i1', day_id: 'd2' }]]);
  const bookings = new Map([['b1', { id: 'b1' }]]);
  const days = new Map([['d2', { id: 'd2' }]]);
  const ctx = { timeZone: TZ, items, bookings, days };
  const fromItem = initialForm(null, { item: 'i1' }, ctx);
  assert.equal(fromItem.list, 'todo');
  assert.equal(fromItem.day, 'd2');
  assert.equal(initialForm(null, { booking: 'b1' }, ctx).list, 'confirm');
  assert.equal(initialForm(null, { booking: 'gone' }, ctx).booking, '');
  assert.equal(initialForm(null, { list: 'packing' }, ctx).qty, 1);
  const r = { id: 't1', list: 'packing', title: '护照', note: '随身', qty: 2, category: '证件', assignee_user_id: HER, due_at: '2027-01-09T01:05:00Z', day_id: null, booking_id: null, item_id: null, done: true, sort: 30 };
  const f = initialForm(r, {}, ctx);
  assert.deepEqual([f.dueDate, f.dueTime, f.assignee, f.category, f.done], ['2027-01-09', '08:05', HER, '证件', true]);
  assert.equal(isDirty(f, f), false);
  assert.equal(isDirty({ ...f, title: '护照 ' }, f), false, '前后空白不算改');
  assert.equal(isDirty({ ...f, qty: 3 }, f), true);

  assert.equal(validateForm({ ...f, title: '  ' }), '先写一下是什么');
  assert.equal(validateForm({ ...f, qty: -1 }), '数量只能是 0–999 的整数');
  assert.equal(validateForm({ ...f, dueDate: '', dueTime: '08:00' }), '截止时间要先选日期');
  assert.equal(validateForm(f), null);

  // 编辑：同一个清单不改 sort；换清单排到那个清单最后
  const same = formToValues({ ...f, note: '  ' }, { timeZone: TZ, row: r, listRows: [r] });
  assert.equal(same.note, null);
  assert.equal(same.due_at, '2027-01-09T01:05:00.000Z');
  assert.equal(same.assignee_user_id, HER);
  assert.equal('sort' in same, false);
  const moved = formToValues({ ...f, list: 'buy' }, { timeZone: TZ, row: r, listRows: [{ id: 'x', sort: 70 }] });
  assert.equal(moved.sort, 80);
  assert.equal(moved.category, '证件', '换到别的清单时分类不丢');
  // 新建打包：没选分类按标题猜
  const nv = formToValues({ ...initialForm(null, { list: 'packing' }, ctx), title: '充电宝' }, { timeZone: TZ, listRows: [] });
  assert.deepEqual([nv.list, nv.category, nv.qty, nv.sort, 'done' in nv], ['packing', '电子', 1, 10, false]);
  assert.equal(sheetTitle('packing', 'new'), '加一件要带的');
  assert.equal(sheetTitle('todo', 'edit'), '编辑待办');
});

test('截止时间分段（只在「 · 」处折行）；时区在卡片头说一次：设备和行程时区不一样、而且有没勾的截止时间时才说', () => {
  assert.deepEqual(dueInfo('2027-01-10T18:00:00+07:00', { at: AT, timeZone: TZ }).parts, ['还剩 2 天 9 小时', '后天 18:00 前']);
  assert.deepEqual(dueInfo('2027-01-08T08:00:00+07:00', { at: AT, timeZone: TZ }).parts, ['已过期', '今天 08:00']);
  assert.deepEqual(dueInfo('2027-01-20T08:00:00+07:00', { at: AT, timeZone: TZ }).parts, ['1月20日 08:00 前']);
  assert.equal(zonesDiffer('Asia/Hong_Kong', TZ, AT), true);
  assert.equal(zonesDiffer(TZ, TZ, AT), false);
  assert.equal(zonesDiffer('Asia/Bangkok', TZ, AT), false, '时区名不同但此刻同一个时差：不算');
  assert.equal(zonesDiffer(undefined, TZ, AT), false);
  const rows = [row({ id: 'a', due_at: '2027-01-09T08:00:00+07:00' }), row({ id: 'b' })];
  assert.equal(zoneNote(rows, { timeZone: TZ, deviceZone: 'Asia/Hong_Kong', at: AT }), '截止时间按越南时间（比香港慢 1 小时）');
  assert.equal(zoneNote(rows, { timeZone: TZ, deviceZone: TZ, at: AT }), null, '人已经在越南：不说');
  assert.equal(zoneNote([row({ id: 'b' })], { timeZone: TZ, deviceZone: 'Asia/Hong_Kong', at: AT }), null, '没有截止时间：不说');
  assert.equal(zoneNote([row({ id: 'a', due_at: '2027-01-09T08:00:00+07:00', done: true })], { timeZone: TZ, deviceZone: 'Asia/Hong_Kong', at: AT }), null, '勾完的不算');
});

test('弹层里换算成这台设备的时间（「香港时间 明天 23:59」）；时区一样、没填不说', () => {
  // 越南 22:59 = 香港 23:59（香港时间 23:59 截止，越南时间显示 22:59）
  assert.equal(deviceEquivalent('2027-01-09T22:59:00+07:00', { timeZone: TZ, deviceZone: 'Asia/Hong_Kong', at: AT }), '香港时间 明天 23:59');
  assert.equal(deviceEquivalent('2027-01-09T22:59:00+07:00', { timeZone: TZ, deviceZone: TZ, at: AT }), null);
  assert.equal(deviceEquivalent(null, { timeZone: TZ, deviceZone: 'Asia/Hong_Kong', at: AT }), null);
});

test('小链接上的日期：昨天 / 今天 / 明天直接说，别的写日期', () => {
  const at = new Date('2027-01-11T10:00:00+07:00');
  assert.equal(dayDetail('2027-01-11', { timeZone: TZ, at }), '今天');
  assert.equal(dayDetail('2027-01-12', { timeZone: TZ, at }), '明天');
  assert.equal(dayDetail('2027-01-10', { timeZone: TZ, at }), '昨天');
  assert.match(dayDetail('2027-01-13', { timeZone: TZ, at }), /^1月13日/);
  const days = new Map([['d2', { id: 'd2', date: '2027-01-11' }]]);
  assert.deepEqual(linkChips({ day_id: 'd2' }, { days, dayNumber: () => 2, timeZone: TZ, at }).map((c) => [c.label, c.detail]), [['D2', '今天']]);
});

test('「关联」收起时的摘要：哪天 · 预订 · 条目（长名字截断，删掉的不说）；都没有时说可以关联什么', () => {
  const days = new Map([['d2', { id: 'd2', date: '2027-01-11' }]]);
  const bookings = new Map([['b1', { id: 'b1', title: '椰影湾酒店' }], ['b2', { id: 'b2', title: '一二三四五六七八九十一二三四' }]]);
  const items = new Map([['i1', { id: 'i1', title: '出海浮潜' }], ['i2', { id: 'i2', title: '删掉的', deleted_at: '2027-01-01T00:00:00Z' }]]);
  const ctx = { days, bookings, items, dayNumber: () => 2 };
  assert.equal(linkSummaryText({ day: 'd2', booking: 'b1', item: 'i1' }, ctx), 'D2 · 预订「椰影湾酒店」 · 条目「出海浮潜」');
  assert.equal(linkSummaryText({ booking: 'b2' }, ctx), '预订「一二三四五六七八九十一…」');
  assert.equal(linkSummaryText({ item: 'i2', booking: 'gone' }, ctx), '不关联（可以关联哪天、预订或条目）');
  assert.equal(linkSummaryText({}, ctx), '不关联（可以关联哪天、预订或条目）');
  assert.match(linkSummaryText({ day: 'd2' }, { days }), /1月11日$/, '没有第几天就写日期');
});

test('备注里的电话 / 邮箱 / 网址变成链接：时间、日期、金额、订单号不算电话；网址结尾的标点不算；裸域名补 https', () => {
  const links = (t) => noteParts(t).filter((p) => p.type !== 'text').map((p) => [p.type, p.value, p.href]);
  assert.deepEqual(links('邮箱 demo_fb@example.com，模板见「消息模板」。'), [['mail', 'demo_fb@example.com', 'mailto:demo_fb@example.com']]);
  assert.deepEqual(links('上 example.vn/operations 看，或打 +84 123 456 789。'), [
    ['url', 'example.vn/operations', 'https://example.vn/operations'],
    ['tel', '+84 123 456 789', 'tel:+84123456789'],
  ]);
  assert.deepEqual(links('看 https://example.com/a?b=1。然后'), [['url', 'https://example.com/a?b=1', 'https://example.com/a?b=1']]);
  assert.deepEqual(links('本地号码 0297 123 4567、0912345678'), [
    ['tel', '0297 123 4567', 'tel:02971234567'],
    ['tel', '0912345678', 'tel:0912345678'],
  ]);
  // 不是电话：钟点、日期、金额、订单号、版本号、产品名
  assert.deepEqual(links('开放 08:15–12:45、14:10–16:20；01-09 00:00 前；2027-01-08'), []);
  assert.deepEqual(links('预估 1,234.50 万越南盾（约 HK$1,000）；订单 12345678；房号 305'), []);
  assert.deepEqual(links('第 3 季、版本 1.2.3、iPad.app、Node.js'), []);
  // 拼回去和原文一字不差（文字段和链接段首尾相接）
  const text = '先打 +84 123 456 789，再发邮件 a.b@example.vn。官网 example.com/x）结束';
  assert.equal(noteParts(text).map((p) => p.value).join(''), text);
  assert.deepEqual(noteParts(''), []);
  assert.deepEqual(noteParts(null), []);
  assert.deepEqual(noteParts('没有链接'), [{ type: 'text', value: '没有链接' }]);
});

test('备注里的动作胶囊：电话 / 邮箱 / 网址各一个（同一个只给一次，最多 3 个）；提到 WhatsApp 的国际号码改成 wa.me；网址去掉协议和 www', () => {
  const kinds = (note, o) => noteActions(note, o).map((a) => [a.type, a.label, a.href]);
  assert.deepEqual(kinds('前台 +84 123 456 789，官网 https://www.example.vn/stay/ 。再打一次 +84 123 456 789'), [
    ['tel', '+84 123 456 789', 'tel:+84123456789'],
    ['url', 'example.vn/stay', 'https://www.example.vn/stay/'],
  ]);
  assert.deepEqual(kinds('+84 123 456 789，模板见「消息模板」。', { title: 'WhatsApp 订午饭' }), [
    ['whatsapp', '+84 123 456 789', 'https://wa.me/84123456789'],
  ]);
  // 本地 0 开头的号码认不出国家：提到 WhatsApp 也照旧打电话
  assert.deepEqual(kinds('WhatsApp 不通就打 0912345678'), [['tel', '0912345678', 'tel:0912345678']]);
  assert.deepEqual(kinds('邮箱 demo@example.com'), [['mail', 'demo@example.com', 'mailto:demo@example.com']]);
  assert.equal(noteActions('+84 111 111 111 +84 222 222 222 +84 333 333 333 +84 444 444 444').length, NOTE_ACTIONS_MAX);
  assert.ok(noteActions('打 +84 123 456 789').every((a) => a.aria.startsWith('打电话')));
  assert.deepEqual(noteActions(''), []);
  assert.deepEqual(noteActions(null), []);
});
