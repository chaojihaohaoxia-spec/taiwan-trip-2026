// 外壳 · 框架的纯逻辑：文字格式（大标题 / 副标题 / 日期）、哪种页面有什么外框、顶栏三种状态随滚动怎么变、
// 打开网站去哪、换页用哪种动效、天数分段条、＋ 面板、「更多」菜单状态、同步状态条、换行程去哪、主题色过渡。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTripTitle, dayLabel, dateRangeLabel, tripSubtitle, switcherDates, phaseChip, overviewLabel, nightsOf, parseYmd,
} from '../../src/shell/format.js';
import {
  chromeKind, activeTab, tabIndex, hasTabBar, dayStripIndex, defaultChrome, mergeChrome, transitionPlan, TABBAR_SLOTS,
} from '../../src/shell/rules.js';
import { createTopbarIntent } from '../../src/shell/scroll-state.js';
import { launchTarget } from '../../src/shell/launch.js';
import {
  dayStripCells, fabActions, menuStatuses, syncBanner, switchTarget, mixHex, hexToOklab, oklabToHex,
} from '../../src/shell/view-rules.js';
import { routes, SPECIAL_ROUTES } from '../../src/router/routes.js';

const R = (name, params = {}, path = null) => ({ name, params, path: path || `/${name}/${Object.values(params).join('/')}`, meta: routes.find((r) => r.name === name)?.meta || {} });

// ---------------------------------------------------------------------
// 文字格式
// ---------------------------------------------------------------------

test('行程名拆成大标题和后半段：按第一个「 · 」拆，没有就整个当大标题', () => {
  assert.deepEqual(splitTripTitle('富国岛 · 重阳 3 晚'), { short: '富国岛', rest: '重阳 3 晚' });
  assert.deepEqual(splitTripTitle('椰影岛·冬日海岛'), { short: '椰影岛', rest: '冬日海岛' });
  assert.deepEqual(splitTripTitle('三城 · 春日环岛 · 九天'), { short: '三城', rest: '春日环岛 · 九天' });
  assert.deepEqual(splitTripTitle('台湾旅行 2026'), { short: '台湾旅行 2026', rest: '' });
  assert.deepEqual(splitTripTitle('  '), { short: '', rest: '' });
  assert.deepEqual(splitTripTitle(' · 开头就是点'), { short: '· 开头就是点', rest: '' });
});

test('日期：月-日 + 周几；不合法的日期不出错', () => {
  assert.deepEqual(dayLabel('2026-10-16'), { md: '10-16', day: '16', weekday: '周五', year: 2026 });
  assert.deepEqual(dayLabel('2027-01-10'), { md: '01-10', day: '10', weekday: '周日', year: 2027 });
  assert.equal(dayLabel('2026-02-30').md, '');
  assert.equal(parseYmd('2028-02-29').d, 29);
  assert.equal(parseYmd('2027-02-29'), null);
});

test('日期区间：今年不写年份，不是今年写在开头，跨年两头都写，同一天只写一个', () => {
  assert.equal(dateRangeLabel('2026-10-16', '2026-10-19', { thisYear: 2026 }), '10-16 周五 – 10-19 周一');
  assert.equal(dateRangeLabel('2027-01-10', '2027-01-13', { thisYear: 2026 }), '2027-01-10 周日 – 01-13 周三');
  assert.equal(dateRangeLabel('2026-12-30', '2027-01-02', { thisYear: 2026 }), '2026-12-30 周三 – 2027-01-02 周六');
  assert.equal(dateRangeLabel('2026-10-16', '2026-10-16', { thisYear: 2026 }), '10-16 周五');
  assert.equal(dateRangeLabel('2026-10-16', null, { thisYear: 2026 }), '10-16 周五');
});

test('顶栏副标题 = 行程名后半段 + 日期区间；什么都没有写「日期未定」', () => {
  const trip = { title: '富国岛 · 重阳 3 晚', start_date: '2026-10-16', end_date: '2026-10-19' };
  assert.equal(tripSubtitle(trip, { thisYear: 2026 }), '重阳 3 晚 · 10-16 周五 – 10-19 周一');
  assert.equal(tripSubtitle({ title: '台湾旅行 2026', start_date: '2026-05-11', end_date: '2026-05-19' }, { thisYear: 2026 }), '05-11 周一 – 05-19 周二');
  assert.equal(tripSubtitle({ title: '没日期 · 再说' }), '再说');
  assert.equal(tripSubtitle({ title: '空' }), '日期未定');
});

test('切换面板的日期行：「10-16 周五 – 10-19 周一 · 3 晚」（和全站同一种写法）；不是今年、跨年写年份；一天的不写晚数', () => {
  assert.equal(switcherDates({ start_date: '2026-10-16', end_date: '2026-10-19' }, { thisYear: 2026 }), '10-16 周五 – 10-19 周一 · 3 晚');
  assert.equal(switcherDates({ start_date: '2026-12-30', end_date: '2027-01-02' }, { thisYear: 2026 }), '2026-12-30 周三 – 2027-01-02 周六 · 3 晚');
  assert.equal(switcherDates({ start_date: '2027-01-10', end_date: '2027-01-13' }, { thisYear: 2026 }), '2027-01-10 周日 – 01-13 周三 · 3 晚');
  assert.equal(switcherDates({ start_date: '2026-10-16', end_date: '2026-10-16' }, { thisYear: 2026 }), '10-16 周五');
  assert.equal(switcherDates({}), '日期未定');
  assert.equal(nightsOf({ start_date: '2026-05-11', end_date: '2026-05-19' }), 8);
});

test('阶段小标签：N 天后出发 / 明天出发 / 进行中 · 第 N 天 / 最后一天 / 已结束 · 回顾', () => {
  assert.deepEqual(phaseChip({ phase: 'upcoming', daysUntilStart: 5 }), { tone: 'accent', text: '5 天后出发' });
  assert.equal(phaseChip({ phase: 'upcoming', daysUntilStart: 1 }).text, '明天出发');
  assert.deepEqual(phaseChip({ phase: 'ongoing', dayNumber: 2, totalDays: 4 }), { tone: 'success', text: '进行中 · 第 2 天' });
  assert.equal(phaseChip({ phase: 'ongoing', dayNumber: 4, totalDays: 4 }).text, '进行中 · 最后一天');
  assert.equal(phaseChip({ phase: 'ended' }).text, '已结束 · 回顾');
  assert.equal(phaseChip({ phase: 'undated' }).text, '日期未定');
  assert.equal(overviewLabel('upcoming'), '出发前');
  assert.equal(overviewLabel('ongoing'), '进行中');
  assert.equal(overviewLabel('ended'), '回顾');
});

// ---------------------------------------------------------------------
// 外框规则
// ---------------------------------------------------------------------

test('每个路由都有外框种类：行程 tab / 二级页面 / 行程列表 / 设置，其余什么都不画', () => {
  const kinds = {
    trip: 'tab', day: 'tab', map: 'tab', ledger: 'tab',
    bookings: 'section', lists: 'section', journal: 'section', places: 'section', tips: 'section', contacts: 'section', translate: 'section',
    trips: 'root', settings: 'settings',
    launch: 'bare', join: 'bare', login: 'bare', dev: 'bare', 'dev-page': 'bare',
  };
  for (const r of routes) assert.equal(chromeKind({ name: r.name }), kinds[r.name], r.name);
  assert.equal(chromeKind({ name: SPECIAL_ROUTES.notFound.name }), 'bare');
  assert.equal(chromeKind({ name: SPECIAL_ROUTES.authCallback.name }), 'bare');
  assert.equal(chromeKind(null), 'bare');
});

test('底栏：只在行程里有；行程 tab 亮自己那格，二级页面亮「更多」；＋ 那格没有指示块', () => {
  assert.equal(hasTabBar({ name: 'day' }), true);
  assert.equal(hasTabBar({ name: 'tips' }), true);
  assert.equal(hasTabBar({ name: 'trips' }), false);
  assert.equal(hasTabBar({ name: 'settings' }), false);
  assert.equal(hasTabBar({ name: 'login' }), false);
  assert.equal(activeTab({ name: 'trip' }), 'trip');
  assert.equal(activeTab({ name: 'day' }), 'trip');
  assert.equal(activeTab({ name: 'map' }), 'map');
  assert.equal(activeTab({ name: 'ledger' }), 'ledger');
  assert.equal(activeTab({ name: 'contacts' }), 'more');
  assert.equal(activeTab({ name: 'trips' }), null);
  assert.deepEqual(TABBAR_SLOTS, ['trip', 'map', 'fab', 'ledger', 'more']);
  assert.deepEqual(['trip', 'map', 'ledger', 'more'].map(tabIndex), [0, 1, 3, 4]);
  assert.equal(tabIndex(null), -1);
});

test('天数分段条：概览第 0 格，第 n 天第 n 格，不在行程里的日期 -1', () => {
  const dates = ['2027-01-10', '2027-01-11', '2027-01-12'];
  assert.equal(dayStripIndex({ name: 'trip' }, dates), 0);
  assert.equal(dayStripIndex({ name: 'day', params: { date: '2027-01-12' } }, dates), 3);
  assert.equal(dayStripIndex({ name: 'day', params: { date: '2027-02-01' } }, dates), -1);
  assert.equal(dayStripIndex({ name: 'map' }, dates), -1);
});

test('默认外框：行程 tab 大标题是行程名、能切换、有搜索，trip / day 有分段条；数据没到是骨架', () => {
  const info = { ready: true, short: '椰影岛', subtitle: '冬日海岛 · 01-10 周日 – 01-13 周三', trip: { title: '椰影岛 · 冬日海岛' } };
  const c = defaultChrome(R('day', { tripId: 'x', date: '2027-01-10' }), info);
  assert.equal(c.kind, 'tab');
  assert.equal(c.title, '椰影岛');
  assert.equal(c.subtitle, info.subtitle);
  assert.equal(c.switcher, true);
  assert.equal(c.search, true);
  assert.equal(c.dayStrip, true);
  assert.equal(c.back, false);
  assert.equal(defaultChrome(R('ledger', { tripId: 'x' }), info).dayStrip, false);
  assert.equal(defaultChrome(R('trip', { tripId: 'x' }), null).loading, true);
  // 没加载成：不一直画骨架，写清楚是哪种情况；加载失败时正文整页说明原因并给「重试」，副标题不再重复（视觉评审 P2-3）
  const failed = defaultChrome(R('trip', { tripId: 'x' }), { status: 'error', ready: false });
  assert.deepEqual([failed.loading, failed.title, failed.subtitle], [false, '这趟行程', '']);
  assert.equal(defaultChrome(R('trip', { tripId: 'x' }), { status: 'missing', ready: false }).subtitle, '找不到这趟行程');
  assert.equal(defaultChrome(R('trip', { tripId: 'x' }), { status: 'removed', ready: false }).subtitle, '你已经不在这趟行程里');
  assert.equal(defaultChrome(R('trip', { tripId: 'x' }), { status: 'loading', ready: false }).loading, true);
});

test('默认外框：二级页面左上返回、标题是页面名、副标题是行程名；行程列表 / 设置是页面名，设置有返回', () => {
  const info = { ready: true, short: '椰影岛', trip: { title: '椰影岛 · 冬日海岛' } };
  const s = defaultChrome(R('tips', { tripId: 'x' }), info);
  assert.deepEqual([s.kind, s.title, s.subtitle, s.back, s.search], ['section', '贴士与常用语', '椰影岛 · 冬日海岛', true, true]);
  const t = defaultChrome(R('trips'), null);
  assert.deepEqual([t.kind, t.title, t.back, t.search], ['root', '全部行程', false, false]);
  const st = defaultChrome(R('settings'), null);
  assert.deepEqual([st.kind, st.title, st.back, st.search], ['settings', '设置', true, false]);
});

test('页面声明的外框只对它自己的路径生效，盖过默认值', () => {
  const base = defaultChrome(R('map', { tripId: 'x' }, '/t/x/map'), { ready: true, short: 'A' });
  const declared = { path: '/t/x/map', collapse: 'always', search: false, title: undefined };
  const m = mergeChrome(base, declared, '/t/x/map');
  assert.equal(m.collapse, 'always');
  assert.equal(m.search, false);
  assert.equal(m.title, 'A', '没写的项保持默认');
  assert.equal(mergeChrome(base, declared, '/t/x/ledger'), base, '别的页面声明的不算');
});

test('换页动效：天与天按方向滑，tab 之间交叉淡入，进二级页从右滑入、返回反向，换行程、进出登录页各有一种', () => {
  const trip = { name: 'trip', path: '/t/a', params: { tripId: 'a' } };
  const d1 = { name: 'day', path: '/t/a/day/2027-01-10', params: { tripId: 'a', date: '2027-01-10' } };
  const d2 = { name: 'day', path: '/t/a/day/2027-01-11', params: { tripId: 'a', date: '2027-01-11' } };
  const ledger = { name: 'ledger', path: '/t/a/ledger', params: { tripId: 'a' } };
  const tips = { name: 'tips', path: '/t/a/tips', params: { tripId: 'a' } };
  const lists = { name: 'lists', path: '/t/a/lists', params: { tripId: 'a' } };
  const trips = { name: 'trips', path: '/trips', params: {} };
  const settings = { name: 'settings', path: '/settings', params: {} };
  const otherTrip = { name: 'trip', path: '/t/b', params: { tripId: 'b' } };
  const login = { name: 'login', path: '/login', params: {} };
  assert.deepEqual(transitionPlan(trip, d1), { type: 'day', dir: 1 });
  assert.deepEqual(transitionPlan(d2, d1), { type: 'day', dir: -1 });
  assert.deepEqual(transitionPlan(d1, trip), { type: 'day', dir: -1 });
  assert.deepEqual(transitionPlan(trip, ledger), { type: 'tab', dir: 0 });
  assert.deepEqual(transitionPlan(tips, lists), { type: 'tab', dir: 0 });
  assert.deepEqual(transitionPlan(trip, tips), { type: 'push', dir: 1 });
  assert.deepEqual(transitionPlan(tips, d1), { type: 'push', dir: -1 });
  assert.deepEqual(transitionPlan(trips, trip), { type: 'push', dir: 1 });
  assert.deepEqual(transitionPlan(trip, trips), { type: 'push', dir: -1 });
  assert.deepEqual(transitionPlan(trips, settings), { type: 'push', dir: 1 });
  assert.deepEqual(transitionPlan(ledger, otherTrip), { type: 'trip', dir: 0 });
  assert.deepEqual(transitionPlan(login, trips), { type: 'fade', dir: 0 });
  assert.equal(transitionPlan(null, trip).type, 'none');
  assert.equal(transitionPlan(trip, trip).type, 'none');
  assert.equal(transitionPlan(trip, d1, { direction: 'initial' }).type, 'none');
  assert.equal(transitionPlan(trip, d1, { kind: 'query' }).type, 'none');
});

// ---------------------------------------------------------------------
// 顶栏状态
// ---------------------------------------------------------------------

test('顶栏：页面最上面是 top；往下滚过大标题直接变胶囊（不先闪一下整条）', () => {
  const it = createTopbarIntent();
  assert.equal(it.update(0, 2000), 'top');
  assert.equal(it.update(20, 2000), 'top');
  assert.equal(it.update(47, 2000), 'top');
  assert.equal(it.update(52, 2000), 'pill');
  assert.equal(it.update(300, 2000), 'pill');
});

test('顶栏：胶囊时往上滑超过 28px 才展开成整条，整条时往下滑超过 16px 收回胶囊；方向一变累计清零', () => {
  const it = createTopbarIntent();
  it.update(0, 2000);
  it.update(400, 2000);
  assert.equal(it.update(390, 2000), 'pill', '手指抖一下不展开');
  assert.equal(it.update(395, 2000), 'pill');
  assert.equal(it.update(380, 2000), 'pill', '往上 15');
  assert.equal(it.update(370, 2000), 'pill', '往上 25');
  assert.equal(it.update(366, 2000), 'bar', '往上 29');
  assert.equal(it.update(376, 2000), 'bar', '往下 10');
  assert.equal(it.update(383, 2000), 'pill', '往下 17');
  assert.equal(it.update(20, 2000), 'top', '回到最上面就是大标题');
});

test('顶栏：到底部的橡皮筋回弹不算往上滑；换页按新位置重新起算；一直胶囊 / 不收', () => {
  const it = createTopbarIntent();
  it.update(0, 1000);
  it.update(1000, 1000);
  assert.equal(it.update(1060, 1000), 'pill');
  assert.equal(it.update(1000, 1000), 'pill', '回弹回来位置没变');
  assert.equal(it.reset(0), 'top');
  assert.equal(it.reset(600), 'pill');
  assert.equal(it.reset(0, { collapse: 'always' }), 'pill');
  assert.equal(it.update(0, 1000, { collapse: 'always' }), 'pill');
  // 'never'：不收成胶囊——页面顶上是 top，滚过大标题一直是整条顶栏（标题看得见、点得开切换）
  assert.equal(it.update(900, 1000, { collapse: 'never' }), 'bar');
  assert.equal(it.update(10, 1000, { collapse: 'never' }), 'top');
  assert.equal(it.update(800, 1000, { collapse: 'never' }), 'bar');
  assert.equal(it.reset(600, { collapse: 'never' }), 'bar');
  const b = createTopbarIntent();
  b.update(0, 2000);
  b.update(500, 2000);
  assert.equal(b.forceBar(), 'bar');
});

// ---------------------------------------------------------------------
// 打开网站去哪
// ---------------------------------------------------------------------

const trip = (id, start, end, extra = {}) => ({ id, trip: { id, title: id, start_date: start, end_date: end, timezone: 'Asia/Ho_Chi_Minh', status: 'ready', ...extra } });

test('启动：有进行中的行程 → 那一趟今天的 day 页（按行程时区）；几趟同时进行取最晚开始的', () => {
  const at = new Date('2027-01-10T18:30:00Z'); // 越南 2027-01-11 01:30
  const entries = [trip('a', '2027-01-08', '2027-01-20'), trip('b', '2027-01-10', '2027-01-13'), trip('c', '2027-03-01', '2027-03-03')];
  assert.deepEqual(launchTarget({ entries, at }), { name: 'day', params: { tripId: 'b', date: '2027-01-11' } });
});

test('启动：没有进行中 → 最近要出发的那趟的概览；归档的不算', () => {
  const at = new Date('2026-10-11T04:00:00Z');
  const entries = [trip('far', '2027-01-10', '2027-01-13'), trip('near', '2026-10-16', '2026-10-19'), trip('old', '2026-05-11', '2026-05-19'), trip('arch', '2026-10-12', '2026-10-13', { status: 'archived' })];
  assert.deepEqual(launchTarget({ entries, at, lastTripId: 'old' }), { name: 'trip', params: { tripId: 'near' } });
});

test('启动：都结束了 → 上次打开的行程；上次打开的已经不在列表里 / 没有 → 行程列表', () => {
  const at = new Date('2027-06-01T04:00:00Z');
  const entries = [trip('a', '2027-01-10', '2027-01-13'), trip('b', '2026-05-11', '2026-05-19')];
  assert.deepEqual(launchTarget({ entries, at, lastTripId: 'b' }), { name: 'trip', params: { tripId: 'b' } });
  assert.deepEqual(launchTarget({ entries, at, lastTripId: 'gone' }), { name: 'trips' });
  assert.deepEqual(launchTarget({ entries, at }), { name: 'trips' });
  assert.deepEqual(launchTarget({ entries: [], at }), { name: 'trips' });
});

// ---------------------------------------------------------------------
// 界面规则
// ---------------------------------------------------------------------

test('天数分段条：概览格随阶段写出发前 / 进行中 / 回顾，天格写日期和周几，今天那格写「今天」', () => {
  const cells = dayStripCells({ tripId: 'x', dates: ['2027-01-10', '2027-01-11'], phase: 'ongoing', today: '2027-01-11' });
  assert.deepEqual(cells.map((c) => [c.top, c.big, c.today]), [['进行中', '概览', false], ['10 周日', 'D1', false], ['今天', 'D2', true]]);
  assert.deepEqual(cells[0].to, { name: 'trip', params: { tripId: 'x' } });
  assert.deepEqual(cells[2].to, { name: 'day', params: { tripId: 'x', date: '2027-01-11' } });
  assert.match(cells[2].label, /第 2 天.*今天/);
  assert.equal(dayStripCells({ tripId: 'x', dates: [], phase: 'ended' })[0].top, '回顾');
});

test('＋ 面板：进行中「记一笔」「加一项」并排放第一行（今天记了几笔）；出发前先加一项、加待办；回顾先写日记；单色列表（没有色块的颜色）', () => {
  const on = fabActions({ phase: 'ongoing', localCurrency: 'VND', todayCount: 3 });
  assert.deepEqual(on.map((a) => a.id), ['expense', 'item', 'photo', 'journal', 'todo']);
  assert.deepEqual(on.map((a) => Boolean(a.pair)), [true, true, false, false, false], '前两个并排');
  assert.equal(on[0].hero, true);
  assert.equal(on[0].hint, '今天已记 3 笔', '半宽：一行放得下');
  assert.equal(fabActions({ phase: 'ongoing', localCurrency: 'VND' })[0].hint, '越南盾自动折合港币');
  assert.equal(on[1].title, '加一项');
  assert.equal(on[1].hint, '按现在的时间插进去');
  assert.ok(on.every((a) => !('tone' in a) && !('wide' in a)), '一列单色的行：不再有图标块的颜色、不再有占整行的瓷砖');
  const pre = fabActions({ phase: 'upcoming', localCurrency: 'VND' });
  assert.deepEqual(pre.map((a) => a.id), ['item', 'todo', 'expense', 'journal', 'photo']);
  assert.ok(pre.every((a) => !a.hero));
  assert.ok(pre.every((a) => !a.pair), '出发前一个一行');
  assert.equal(pre.find((a) => a.id === 'expense').hint, '越南盾自动折合港币');
  assert.equal(fabActions({ phase: 'ended', localCurrency: 'HKD' })[0].id, 'journal');
  assert.equal(fabActions({ phase: 'ended', localCurrency: 'HKD' }).find((a) => a.id === 'expense').hint, '谁付的、怎么分都记上');
});

test('＋ 面板：只读成员的记一笔 / 加条目 / 加待办变淡、写明原因、排到最后；拍照打卡、写日记照常', () => {
  const ro = fabActions({ phase: 'ongoing', localCurrency: 'VND', todayCount: 3, canEdit: false });
  assert.deepEqual(ro.map((a) => a.id), ['photo', 'journal', 'expense', 'item', 'todo']);
  assert.ok(ro.every((a) => !a.hero));
  assert.ok(ro.every((a) => !a.pair), '只读成员不并排');
  assert.deepEqual(ro.filter((a) => a.disabled).map((a) => a.id), ['expense', 'item', 'todo']);
  assert.equal(ro.find((a) => a.id === 'expense').hint, '只读成员不能记账');
  assert.equal(ro.find((a) => a.id === 'item').hint, '只读成员不能改行程');
  assert.ok(!ro.find((a) => a.id === 'photo').disabled);
});

test('「更多」菜单的实时状态：待确认、打包进度、日记和照片、地点和评级、置顶防坑、紧急联系人', () => {
  const s = menuStatuses({
    bookings: [{ status: 'pending' }, { status: 'pending' }, { status: 'idea' }, { status: 'booked' }],
    todos: { total: 40, byList: { confirm: { total: 3, done: 1 }, packing: { total: 30, done: 18 }, todo: { total: 7, done: 2 } } },
    journal: [{ photos: ['a', 'b'] }, { photos: [] }, { photos: ['c'] }],
    places: 34,
    reviews: 8,
    tips: [{ pinned: true }, { pinned: false }, { pinned: true }],
    contacts: [{ category: 'emergency' }, { category: 'hotel' }],
  });
  assert.equal(s.bookings, '2 个待确认 · 1 个还没订');
  assert.equal(s.lists, '2 项待确认 · 打包 18/30');
  assert.equal(s.journal, '3 篇日记 · 3 张照片');
  assert.equal(s.places, '34 个地点 · 8 条评级');
  assert.equal(s.tips, '3 条 · 2 条置顶防坑');
  assert.equal(s.contacts, '2 位 · 1 个紧急');
  const empty = menuStatuses({});
  assert.equal(empty.bookings, '还没有预订');
  assert.equal(empty.lists, '还没有清单');
  assert.equal(menuStatuses({ bookings: [{ status: 'booked' }, { status: 'cancelled' }] }).bookings, '1 个预订都已订好');
});

test('同步状态条：离线 / 出错（重试、放弃）/ 重试中 / 没加载成 / 本机存储不可用；正在同步要等一会儿才出来；正常不显示', () => {
  assert.equal(syncBanner(null), null);
  assert.equal(syncBanner({ state: 'synced', message: '已同步' }), null);
  assert.deepEqual(
    (({ tone, retry, discard }) => ({ tone, retry, discard }))(syncBanner({ state: 'error', message: 'x', canRetry: true, canDiscard: true })),
    { tone: 'danger', retry: true, discard: true },
  );
  assert.equal(syncBanner({ state: 'offline', message: '离线 · 3 条改动联网后自动同步' }).tone, 'warning');
  assert.equal(syncBanner({ state: 'retrying', message: 'x' }).retry, true);
  assert.equal(syncBanner({ state: 'stale', message: '行程没有加载成功' }).retry, true);
  const syncing = syncBanner({ state: 'syncing', message: '正在同步 2 条改动…' });
  assert.equal(syncing.delayed, true);
  assert.equal(syncing.busy, true);
  const storage = syncBanner({ state: 'synced', message: '已同步', storage: 'memory', storageWarning: '这台设备的存储暂时不可用' });
  assert.equal(storage.tone, 'warning');
  assert.equal(storage.message, '这台设备的存储暂时不可用');
});

test('换行程：留在同一种页面（账本去新行程的账本），概览 / 某一天去新行程的概览，行程外去概览', () => {
  assert.deepEqual(switchTarget({ name: 'ledger', params: { tripId: 'a' } }, 'b'), { name: 'ledger', params: { tripId: 'b' } });
  assert.deepEqual(switchTarget({ name: 'contacts', params: { tripId: 'a' } }, 'b'), { name: 'contacts', params: { tripId: 'b' } });
  assert.deepEqual(switchTarget({ name: 'day', params: { tripId: 'a', date: '2027-01-10' } }, 'b'), { name: 'trip', params: { tripId: 'b' } });
  assert.deepEqual(switchTarget({ name: 'trips', params: {} }, 'b'), { name: 'trip', params: { tripId: 'b' } });
});

test('主题色过渡：OKLab 往返不变色，两端等于起止色，中间是两者之间的颜色；不是 #RRGGBB 的半路换', () => {
  for (const hex of ['#0e8a8a', '#c2255c', '#f2a65a', '#000000', '#ffffff']) assert.equal(oklabToHex(hexToOklab(hex)), hex);
  assert.equal(mixHex('#0E8A8A', '#C2255C', 0).toLowerCase(), '#0e8a8a');
  assert.equal(mixHex('#0E8A8A', '#C2255C', 1).toLowerCase(), '#c2255c');
  const mid = mixHex('#0E8A8A', '#C2255C', 0.5);
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.notEqual(mid, '#0e8a8a');
  assert.notEqual(mid, '#c2255c');
  assert.equal(mixHex(null, '#C2255C', 0.3), null);
  assert.equal(mixHex(null, '#C2255C', 0.7), '#C2255C');
});
