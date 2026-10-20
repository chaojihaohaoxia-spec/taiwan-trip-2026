// 「页面不单调」那一批的纯逻辑：路线速写（kit/route-sketch.js）、补照片（sheets/photo-import）、封面和颜色（sheets/cover）、
// 回顾的数字（pages/trip/model.js recapTiles）、每天页的大号日期 / 一句日记 / 照片条（pages/day/visual.js）、紧急电话的大号数字（pages/tips/emergency.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSketch, sketchWorthy, shortPlaceName, sketchDays } from '../../src/kit/route-sketch.js';
import { planImport, mergePhotos, rangeText, planSummary } from '../../src/sheets/photo-import/model.js';
import { runImport, importTask, stashImport, takeImport, resetImportTask } from '../../src/sheets/photo-import/task.js';
import { coverPhotos, presetOf, colorChoices, coverForm, coverPatch, isCoverChanged, choiceStyle, replacedCover } from '../../src/sheets/cover/model.js';
import { recapTiles } from '../../src/pages/trip/model.js';
import { mastDate, firstSentence, dayQuote, stripPhotos } from '../../src/pages/day/visual.js';
import { emergencyNumbers, emergencyRest } from '../../src/pages/tips/emergency.js';

// ---------------------------------------------------------------------
// 路线速写
// ---------------------------------------------------------------------

// 一个虚构的小岛：南北 40 公里，三个分段；第一天从远处的机场飞过来
const ISLAND = {
  anchors: [
    { lat: 10.30, lng: 103.95, name: '北岸 · 长滩' },
    { lat: 10.10, lng: 104.00, name: '中部' },
    { lat: 9.95, lng: 104.02, name: '南湾｜小镇' },
  ],
  days: [
    { n: 1, points: [{ lat: 22.31, lng: 113.91 }, { lat: 10.17, lng: 103.99 }, { lat: 10.30, lng: 103.95 }] },
    { n: 2, points: [{ lat: 10.30, lng: 103.95 }, { lat: 10.25, lng: 103.97 }, { lat: 10.10, lng: 104.00 }] },
    { n: 3, points: [{ lat: 10.10, lng: 104.00 }, { lat: 10.10, lng: 104.00 }, { lat: 9.95, lng: 104.02 }] },
    { n: 4, points: [] },
  ],
};

test('路线速写：离分段中心太远的点（出发地机场）不画；每天一条线、都在画布里；地名只留「·」前面那段', () => {
  const s = buildSketch({ ...ISLAND, anchors: ISLAND.anchors.map((a) => ({ ...a, name: shortPlaceName(a.name) })), width: 300, height: 160, pad: 12 });
  assert.equal(s.far, 1, '香港机场被排除');
  assert.deepEqual(s.lines.map((l) => l.n), [1, 2, 3]);
  for (const l of s.lines) {
    assert.match(l.d, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+$/);
    for (const [x, y] of [l.start, l.end, ...l.dots]) {
      assert.ok(x >= 0 && x <= 300 && y >= 0 && y <= 160, `${x},${y} 在画布里`);
    }
  }
  // 第三天两个一样的点合成一个：只剩起点、终点
  assert.equal(s.lines[2].dots.length, 0);
  // 北在上：北岸的 y 比南湾小
  const north = s.labels.find((l) => l.name === '北岸');
  const south = s.labels.find((l) => l.name === '南湾');
  assert.ok(north && south && north.y < south.y);
  assert.equal(shortPlaceName('长滩北段 · 阳东'), '长滩北段');
  assert.equal(shortPlaceName(''), '');
});

test('路线速写：保持比例（经度按纬度缩），高瘦的岛不会被拉宽', () => {
  const s = buildSketch({ ...ISLAND, width: 300, height: 160, pad: 10, labels: false });
  const xs = s.lines.flatMap((l) => [l.start[0], l.end[0]]);
  const ys = s.lines.flatMap((l) => [l.start[1], l.end[1]]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  // 实际：东西约 0.07° × cos(10°)，南北 0.35°：宽高比约 0.2
  assert.ok(w / h < 0.35, `宽高比 ${w / h}`);
  assert.ok(h > 120, '撑满高度');
});

test('路线速写：focus 只画那一天、按那天取景；点不够两个返回空；context 才画别的天', () => {
  const s = buildSketch({ ...ISLAND, focus: 2, width: 120, height: 90, pad: 8, labels: false });
  assert.deepEqual(s.lines.map((l) => l.n), [2]);
  assert.ok(s.lines[0].focus);
  const withContext = buildSketch({ ...ISLAND, focus: 2, context: true, width: 120, height: 90, pad: 8, labels: false });
  assert.deepEqual(withContext.lines.map((l) => [l.n, l.focus]), [[1, false], [3, false], [2, true]], '当前那天画在最上面');
  assert.equal(buildSketch({ ...ISLAND, focus: 4 }).lines.length, 0, '第 4 天没有点');
  assert.equal(buildSketch({ days: [{ n: 1, points: [{ lat: 1, lng: 1 }] }] }).lines.length, 0);
  assert.equal(buildSketch({ days: [{ n: 1, points: [{ lat: null, lng: 2 }, { lat: 'x', lng: 1 }] }] }).lines.length, 0);
});

test('路线速写：只走了几百米的一天不会放大成跨岛的线（最小取景约 1 公里）', () => {
  const s = buildSketch({ days: [{ n: 1, points: [{ lat: 10, lng: 104 }, { lat: 10.0005, lng: 104.0005 }] }], width: 100, height: 100, pad: 0, labels: false });
  const [a, b] = [s.lines[0].start, s.lines[0].end];
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 10, '短短一笔');
});

test('路线速写值不值得画：地方太少、一根细线、一个远点把图拉偏都不画（宁缺毋滥）', () => {
  const P = (pts) => pts.map(([x, y]) => ({ x, y }));
  // 四个分得开的地方、方方正正：画
  assert.equal(sketchWorthy(P([[0, 0], [10, 0], [10, 8], [0, 8]])), true);
  // 两个地方来回：不画
  assert.equal(sketchWorthy(P([[0, 0], [10, 8], [0, 0], [10, 8]])), false);
  // 挨得很近的三个点算一个地方
  assert.equal(sketchWorthy(P([[0, 0], [0.1, 0.1], [0.2, 0], [10, 8], [0, 8]])), true);
  assert.equal(sketchWorthy(P([[0, 0], [0.1, 0.1], [0.2, 0], [10, 8]])), false);
  // 一根细线（南北长、东西窄的岛）：不画
  assert.equal(sketchWorthy(P([[0, 0], [0.5, 4], [0.2, 8], [0.6, 12]])), false);
  // 一个小三角拖一根长线（一个远点把整张图拉开）：不画
  assert.equal(sketchWorthy(P([[0, 0], [1, 0.2], [0.5, 1], [0, 0], [30, 20]])), false);
  // 门槛可以调：概览要 4 个地方
  const three = P([[0, 0], [10, 0], [5, 8]]);
  assert.equal(sketchWorthy(three), true);
  assert.equal(sketchWorthy(three, { clusters: 4 }), false);
  assert.equal(sketchWorthy([]), false);
  // buildSketch 把结论写在 ok 上：小岛（细长）整趟不够格
  assert.equal(buildSketch({ ...ISLAND, width: 300, height: 160 }).ok, false);
  const square = { days: [{ n: 1, points: [{ lat: 10, lng: 104 }, { lat: 10, lng: 104.1 }] }, { n: 2, points: [{ lat: 10.1, lng: 104.1 }, { lat: 10.1, lng: 104 }] }] };
  assert.equal(buildSketch({ ...square, width: 300, height: 160 }).ok, true);
});

test('路线速写：地名挤在一起就不放（不往下挪成一团）', () => {
  const anchors = [{ lat: 10.0, lng: 104.0, name: '南部' }, { lat: 10.001, lng: 104.0, name: '日落小镇' }, { lat: 10.2, lng: 104.2, name: '北岸' }];
  const s = buildSketch({ days: [{ n: 1, points: [{ lat: 10, lng: 104 }, { lat: 10.2, lng: 104.2 }, { lat: 10.2, lng: 104 }] }], anchors, width: 300, height: 160 });
  assert.deepEqual(s.labels.map((l) => l.name).sort(), ['北岸', '南部']);
});

test('路线速写：从 TripStore 取每天的点和分段中心', () => {
  const store = {
    view: {
      days: { value: [{ id: 'd1', date: '2027-01-10' }, { id: 'd2', date: '2027-01-11' }] },
      tripRoute: { value: [{ lat: 10, lng: 104, name: '北岸 · 长滩' }] },
    },
    dayRoute: (id) => (id === 'd1' ? { points: [{ lat: 10, lng: 104 }, { lat: 10.1, lng: 104.1 }] } : { points: [] }),
  };
  const r = sketchDays(store);
  assert.deepEqual(r.days.map((d) => [d.n, d.points.length]), [[1, 2], [2, 0]]);
  assert.deepEqual(r.anchors, [{ lat: 10, lng: 104, name: '北岸' }]);
  assert.deepEqual(sketchDays(null), { days: [], anchors: [] });
});

// ---------------------------------------------------------------------
// 补照片
// ---------------------------------------------------------------------

const DAYS = [{ id: 'd1', date: '2026-10-16' }, { id: 'd2', date: '2026-10-17' }, { id: 'd3', date: '2026-10-18' }];

test('补照片：按照片自己的当地日期分到每天；不是这几天的、没有拍摄时间的、已经在日记里的分开数', () => {
  const photos = [
    { key: 'a', local: '2026-10-16T15:05:00', iso: '2026-10-16T15:05:00+08:00' }, // 香港机场拍的也算出发那天
    { key: 'b', local: '2026-10-16T21:40:10', iso: '2026-10-16T21:40:10+07:00' },
    { key: 'c', local: '2026-10-18T09:12:00', iso: '2026-10-18T09:12:00+07:00' },
    { key: 'd', local: '2026-10-20T10:00:00', iso: '2026-10-20T10:00:00+08:00' }, // 回来以后
    { key: 'e', local: null, iso: null }, // 截图
    { key: 'f', local: '2026-10-18T10:00:00', iso: '2026-10-18T10:00:00+07:00' }, // 已经放过
  ];
  const existing = new Map([['d3', [{ path: 'x', taken_at: '2026-10-18T03:00:00Z' }]]]);
  const plan = planImport({ photos, days: DAYS, existing });
  assert.deepEqual(plan.groups.map((g) => [g.n, g.keys]), [[1, ['a', 'b']], [3, ['c']]]);
  assert.deepEqual(plan.outside, ['d']);
  assert.deepEqual(plan.unknown, ['e']);
  assert.deepEqual(plan.dupes, ['f'], '同一刻拍的不再放一次（时间写法不同也认得）');
  assert.equal(plan.count, 3);
  assert.equal(rangeText(plan.groups[0]), '15:05–21:40');
  assert.equal(rangeText(plan.groups[1]), '09:12');
  assert.equal(planSummary(plan), '3 张放进 2 天的日记 · 1 张已经在日记里了 · 1 张不是这几天拍的 · 1 张没有拍摄时间');
  // 没有拍摄时间的挑一天放
  const withDay = planImport({ photos, days: DAYS, existing, unknownDay: 'd2' });
  assert.deepEqual(withDay.groups.map((g) => [g.n, g.keys]), [[1, ['a', 'b']], [2, ['e']], [3, ['c']]]);
  assert.deepEqual(withDay.unknown, []);
  // 同一批里同一秒的两张（连拍）都放；同一个文件选了两次（文件名和大小一样）才算重复
  const burst = planImport({ photos: [photos[2], { ...photos[2], key: 'c2' }], days: DAYS });
  assert.deepEqual(burst.dupes, []);
  assert.deepEqual(burst.groups[0].keys, ['c', 'c2']);
  const same = planImport({ photos: [{ ...photos[2], sig: 'IMG_1.JPG|100|1' }, { ...photos[2], key: 'c2', sig: 'IMG_1.JPG|100|1' }], days: DAYS });
  assert.deepEqual(same.dupes, ['c2']);
  // 日记里那一秒已经有 1 张：这批里那一秒的第 1 张算已经有了，第 2 张照放
  const known = new Map([['d3', [{ path: 'x', taken_at: '2026-10-18T09:12:00+07:00' }]]]);
  const again = planImport({ photos: [photos[2], { ...photos[2], key: 'c2' }], days: DAYS, existing: known });
  assert.deepEqual(again.dupes, ['c']);
  assert.deepEqual(again.groups[0].keys, ['c2']);
});

test('补照片：合并进日记按拍摄时间排，同一个 path 只留一个，没有时间的放后面', () => {
  const old = [{ path: 'p2', taken_at: '2026-10-16T12:00:00+07:00' }, { path: 'p0' }];
  const added = [{ path: 'p1', taken_at: '2026-10-16T09:00:00+07:00' }, { path: 'p2', taken_at: '2026-10-16T12:00:00+07:00' }];
  assert.deepEqual(mergePhotos(old, added).map((p) => p.path), ['p1', 'p2', 'p0']);
  assert.deepEqual(mergePhotos(), []);
});

test('补照片：一张一张传，一天传完存一次我那天的日记（接在原有照片后面，按时间排）；传不上的数着、不中断', async () => {
  resetImportTask();
  const saved = [];
  let n = 0;
  const store = {
    tripId: 't1',
    tables: { journal_entries: { value: new Map([['j1', { id: 'j1', day_id: 'd1', user_id: 'me', photos: [{ path: 'old', taken_at: '2026-10-16T20:00:00+07:00' }] }]]) } },
    upload: async (purpose, file) => {
      assert.equal(purpose, 'journal');
      if (file === 'bad') throw new Error('打不开');
      n += 1;
      return { path: `new${n}`, takenAt: null, width: 2048, height: 1536 };
    },
    saveJournal: (dayId, patch) => saved.push([dayId, patch.photos.map((p) => p.path)]),
  };
  const plan = { groups: [{ day: { id: 'd1' }, keys: ['a', 'b'] }, { day: { id: 'd2' }, keys: ['c'] }] };
  const files = new Map([
    ['a', { file: 'fa', iso: '2026-10-16T09:00:00+07:00' }],
    ['b', { file: 'bad', iso: null }],
    ['c', { file: 'fc', iso: '2026-10-17T10:00:00+07:00' }],
  ]);
  const first = runImport(store, plan, files, 'me');
  assert.equal(runImport(store, plan, files, 'me'), first, '正在做时再点返回同一个');
  const r = await first;
  assert.deepEqual(r, { done: 2, failed: 1, days: 2 });
  assert.deepEqual(saved, [['d1', ['new1', 'old']], ['d2', ['new2']]]);
  assert.equal(importTask.value.state, 'done');
  assert.equal(importTask.value.total, 3);
  // 中转站：取一次就没了，过期作废
  stashImport(['x']);
  assert.deepEqual(takeImport(), ['x']);
  assert.deepEqual(takeImport(), []);
  stashImport(['y']);
  assert.deepEqual(takeImport(Date.now() + 200_000), []);
  resetImportTask();
});

// ---------------------------------------------------------------------
// 封面和颜色
// ---------------------------------------------------------------------

test('封面：换掉的旧封面只删自己从面板传的、别处没用到的', () => {
  const o = { tripId: 't1', me: 'u1' };
  assert.equal(replacedCover('t1/u1/covers/a.jpg', 't1/u1/covers/b.jpg', o), 't1/u1/covers/a.jpg');
  assert.equal(replacedCover('t1/u1/covers/a.jpg', null, o), 't1/u1/covers/a.jpg', '去掉照片也删');
  assert.equal(replacedCover('t1/u1/covers/a.jpg', 't1/u1/covers/a.jpg', o), null, '没换');
  assert.equal(replacedCover('t1/u1/journal/a.jpg', null, o), null, '从日记挑来的不删');
  assert.equal(replacedCover('t1/u2/covers/a.jpg', null, o), null, '别人传的不删');
  assert.equal(replacedCover('t2/u1/covers/a.jpg', null, o), null, '别的行程的不删');
  assert.equal(replacedCover('t1/u1/covers/a.jpg', null, { ...o, inUse: new Set(['t1/u1/covers/a.jpg']) }), null, '别处用着的不删');
  assert.equal(replacedCover(null, 'x', o), null);
  assert.equal(replacedCover('t1/u1/covers/a.jpg', null, { tripId: 't1', me: null }), null);
});

test('封面：能挑的照片按天、按拍摄时间，日记在前评级在后，去重，最多 12 张', () => {
  const journal = [
    { day_id: 'd2', photos: [{ path: 'b2', taken_at: '2026-10-17T10:00:00Z' }, { path: 'b1', taken_at: '2026-10-17T09:00:00Z' }] },
    { day_id: 'd1', photos: [{ path: 'a1' }] },
    { day_id: 'd1', deleted_at: '2026-10-20T00:00:00Z', photos: [{ path: 'gone' }] },
  ];
  const reviews = [{ photos: [{ path: 'r1' }, { path: 'a1' }] }];
  assert.deepEqual(coverPhotos({ journal, reviews, days: DAYS }).map((p) => p.path), ['a1', 'b1', 'b2', 'r1']);
  const many = [{ day_id: 'd1', photos: Array.from({ length: 20 }, (_, i) => ({ path: `p${i}` })) }];
  assert.equal(coverPhotos({ journal: many, days: DAYS }).length, 12);
});

test('封面：颜色——预设认得出来；不是预设的放在最前面「现在的颜色」；改完只动照片和颜色，别的键留着', () => {
  const pq = { emoji: '🏝️', accent: '#0B7480', accent_2: '#C26A16' };
  assert.equal(presetOf(pq), null);
  const choices = colorChoices(pq);
  assert.equal(choices[0].key, 'current');
  assert.deepEqual(choices[0].colors, ['0B7480', 'C26A16']);
  assert.equal(choices.length, 7);
  const form = coverForm(pq);
  assert.deepEqual(form, { imagePath: null, color: 'current' });
  assert.equal(isCoverChanged(pq, form), false);
  const next = { ...form, color: 'sunset', imagePath: 'phuquoc2026/u/covers/x.jpg' };
  assert.equal(isCoverChanged(pq, next), true);
  assert.deepEqual(coverPatch(pq, next), { emoji: '🏝️', accent: '#C8642A', accent_2: '#F2B544', image_path: 'phuquoc2026/u/covers/x.jpg' });
  // 去掉照片
  assert.deepEqual(coverPatch({ ...pq, image_path: 'a' }, { imagePath: null, color: 'current' }), pq);
  // 预设的颜色
  const island = { accent: '#0e8a8a', accent_2: '#F2A65A' };
  assert.equal(presetOf(island).key, 'island');
  assert.equal(colorChoices(island).length, 6);
  assert.deepEqual(choiceStyle(colorChoices(island)[0]), { '--trip-accent': '#0E8A8A', '--trip-accent-2': '#F2A65A' });
  // 没有颜色的行程
  assert.deepEqual(coverForm({}), { imagePath: null, color: null });
});

// ---------------------------------------------------------------------
// 回顾的数字
// ---------------------------------------------------------------------

test('回顾的数字：是 0 的不占位置，最多 4 个；记账也算', () => {
  const tiles = recapTiles({ places: 23, placesPlanned: true, done: 0, journal: 0, photos: 0, expenses: 5 }, 't');
  assert.deepEqual(tiles.map((t) => [t.key, t.value, t.label]), [['places', 23, '安排的地方'], ['expenses', 5, '笔账']]);
  assert.deepEqual(tiles[1].to, { name: 'ledger', params: { tripId: 't' } });
  const full = recapTiles({ places: 18, placesPlanned: false, done: 24, journal: 6, photos: 10, expenses: 16 }, 't');
  assert.deepEqual(full.map((t) => t.key), ['places', 'done', 'journal', 'photos']);
  assert.equal(full[0].label, '去过的地方');
  assert.deepEqual(recapTiles({ places: 0, done: 0, journal: 0, photos: 0, expenses: 0 }, 't'), []);
});

// ---------------------------------------------------------------------
// 每天页：大号日期、一句日记、照片条
// ---------------------------------------------------------------------

test('每天页：大号日期拆成「18」「10月」「周日」，相对的日子只认今天 / 明天 / 昨天', () => {
  const at = new Date('2026-10-18T14:00:00+07:00');
  assert.deepEqual(mastDate('2026-10-18', 'Asia/Ho_Chi_Minh', at), { day: '18', month: '10月', weekday: '周日', rel: '今天' });
  assert.equal(mastDate('2026-10-19', 'Asia/Ho_Chi_Minh', at).rel, '明天');
  assert.equal(mastDate('2026-10-16', 'Asia/Ho_Chi_Minh', at).rel, null);
  assert.equal(mastDate('2026-05-01', 'Asia/Ho_Chi_Minh', at).day, '1');
  assert.equal(mastDate('nope', 'Asia/Ho_Chi_Minh', at), null);
});

test('每天页：日记的第一句（去掉 Markdown、到第一个句号；太长截断）；先写的那篇；没有正文不凑', () => {
  assert.equal(firstSentence('**夜市**人好多！胡椒饼排了半小时。'), '夜市人好多！');
  assert.equal(firstSentence('# 标题\n第二行'), '标题');
  assert.equal(firstSentence('“真好吃。”她说'), '“真好吃。”她说');
  assert.equal(firstSentence('一'.repeat(60), 20), `${'一'.repeat(19)}…`);
  assert.equal(firstSentence('  '), '');
  const entries = [
    { user_id: 'c', body: '晚霞很好看。还有烟花', created_at: '2026-10-18T13:00:00Z' },
    { user_id: 'j', body: '早上去拍照。', created_at: '2026-10-18T12:00:00Z' },
    { user_id: 'x', body: '', created_at: '2026-10-18T11:00:00Z' },
  ];
  assert.deepEqual(dayQuote(entries, (id) => ({ c: 'Cathy', j: 'Jeremy' }[id])), { text: '早上去拍照。', who: 'Jeremy' });
  assert.equal(dayQuote([{ user_id: 'j', body: '', photos: [{}] }], () => 'J'), null);
  assert.equal(dayQuote(null), null);
});

test('每天页：照片条最多三张，多的数「+N」', () => {
  assert.deepEqual(stripPhotos([1, 2, 3, 4, 5]), { shown: [1, 2, 3], more: 2 });
  assert.deepEqual(stripPhotos([1]), { shown: [1], more: 0 });
  assert.deepEqual(stripPhotos(null), { shown: [], more: 0 });
});

// ---------------------------------------------------------------------
// 贴士：紧急电话
// ---------------------------------------------------------------------

test('紧急电话：拆成大号数字的那一行不在正文里重复；那一行还有别的话就留着', () => {
  assert.equal(emergencyRest('报警 113，急救 115，火警 114\n\n医院：Vinmec 富国 0297 …'), '医院：Vinmec 富国 0297 …');
  assert.equal(emergencyRest('**报警 113**、急救 115。\n医院'), '医院');
  const keep = '报警 113，急救 115（说英语，中文不通）\n医院';
  assert.equal(emergencyRest(keep), keep);
  assert.equal(emergencyRest('医院 0297 3985 588'), '医院 0297 3985 588');
  assert.equal(emergencyRest(''), '');
});

test('紧急电话：第一行的「报警 113，急救 115，火警 114」拆成大号数字；长号码、拆不出两个的不拆', () => {
  assert.deepEqual(emergencyNumbers('- 报警 **113**，急救 **115**，火警 114\n- 医院急诊：0297 0000 000'), [
    { label: '报警', number: '113' }, { label: '急救', number: '115' }, { label: '火警', number: '114' },
  ]);
  assert.deepEqual(emergencyNumbers('报警 110、救护车：119'), [{ label: '报警', number: '110' }, { label: '救护车', number: '119' }]);
  assert.deepEqual(emergencyNumbers('医院急诊：0297 3985 511'), []);
  assert.deepEqual(emergencyNumbers('报警 113'), [], '只有一个不拆');
  assert.deepEqual(emergencyNumbers(''), []);
});
