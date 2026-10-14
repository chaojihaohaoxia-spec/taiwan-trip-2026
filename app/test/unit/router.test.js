// 路由器行为（router/router.js），用假的浏览器窗口跑：导航、历史栈、返回、弹层、守卫、
// 滚动恢复、过渡钩子、旧网址兼容、点击拦截。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/router/router.js';
import { routes } from '../../src/router/routes.js';
import { createFakeWindow, flush, fakeAnchor, memoryStorage } from './helpers/fake-window.js';

// 默认从 #/trips 开始（没有 hash 的网址会进启动页 launch，见下面「启动」两个用例）
function setup(url = 'http://localhost/taiwan-trip-2026/#/trips', options = {}) {
  const fw = createFakeWindow(url);
  const storage = options.storage || memoryStorage();
  const router = createRouter({ window: fw.window, routes, devEnabled: true, storage, appTitle: '热爱生活7885', ...options });
  return { fw, router, storage, win: fw.window };
}

const r = (router) => router.route.value;

test('启动：已有 #/trips 直接显示，不多出历史条目', async () => {
  const { fw, router } = setup();
  await router.start();
  assert.equal(r(router).name, 'trips');
  assert.equal(fw.window.location.hash, '#/trips');
  assert.equal(fw.entries.length, 1);
  assert.equal(r(router).index, 0);
  assert.equal(fw.window.document.title, '全部行程 · 热爱生活7885');
  assert.equal(fw.window.history.scrollRestoration, 'manual');
  router.stop();
});

test('启动：没有 hash、# 、#/（主屏启动，start_url 是 ./）都进启动页 launch，网址规范成 #/，不多出历史条目', async () => {
  for (const url of ['http://localhost/taiwan-trip-2026/', 'http://localhost/taiwan-trip-2026/#', 'http://localhost/taiwan-trip-2026/#/']) {
    const { fw, router } = setup(url);
    await router.start();
    assert.equal(r(router).name, 'launch', url);
    assert.equal(r(router).path, '/', url);
    assert.equal(fw.window.location.hash, '#/', url);
    assert.equal(fw.entries.length, 1, url);
    assert.equal(r(router).index, 0, url);
    assert.equal(fw.window.document.title, '热爱生活7885', '启动页不写标题：就是应用名');
    // 启动页用 replace 离开：不留历史，返回键不会回到启动页
    await router.replace('/trips');
    assert.equal(r(router).name, 'trips');
    assert.equal(fw.entries.length, 1, url);
    router.stop();
  }
});

test('启动页：#/?go=today 带着查询参数进 launch；按名字 / 字符串都能导航到 #/；路由表里没有 launch 时空 hash 仍去默认页', async () => {
  const a = setup('http://localhost/x/#/?go=today');
  await a.router.start();
  assert.equal(r(a.router).name, 'launch');
  assert.deepEqual(r(a.router).query, { go: 'today' });
  assert.equal(a.router.href({ name: 'launch' }), '#/');
  assert.equal(a.router.href('/'), '#/');
  assert.equal(a.router.href('#/'), '#/');
  await a.router.navigate({ name: 'settings' });
  await a.router.navigate('#/');
  assert.equal(r(a.router).name, 'launch');
  a.router.stop();
  // 登录后回到 next=#/（守卫把没登录的启动页带去登录页时就是这个值）
  const b = setup('http://localhost/x/#/settings');
  await b.router.start();
  await b.router.replace('#/');
  assert.equal(r(b.router).name, 'launch');
  b.router.stop();
  // 自定义路由表（没有 launch）：空 hash 照旧去 DEFAULT_PATH
  const c = setup('http://localhost/x/', { routes: routes.filter((x) => x.name !== 'launch') });
  await c.router.start();
  assert.equal(r(c.router).name, 'trips');
  assert.equal(c.fw.window.location.hash, '#/trips');
  c.router.stop();
});

test('启动：乱写的 hash 也回到默认页；不存在的路径显示 not-found', async () => {
  const a = setup('http://localhost/x/#section-1');
  await a.router.start();
  assert.equal(r(a.router).name, 'trips');
  const b = setup('http://localhost/x/#/no/such/page');
  await b.router.start();
  assert.equal(r(b.router).name, 'not-found');
  assert.equal(r(b.router).path, '/no/such/page');
});

test('navigate 压入历史，浏览器返回 / 前进触发正确方向', async () => {
  const { fw, router } = setup();
  await router.start();
  const directions = [];
  router.onAfterChange((ctx) => directions.push(`${ctx.kind}:${ctx.direction}`));

  await router.navigate({ name: 'trip', params: { tripId: 'demo-island' } });
  await router.navigate({ name: 'ledger', params: { tripId: 'demo-island' } });
  assert.equal(r(router).name, 'ledger');
  assert.equal(r(router).index, 2);
  assert.equal(fw.entries.length, 3);
  assert.equal(fw.window.location.hash, '#/t/demo-island/ledger');

  fw.window.history.back();
  await flush();
  assert.equal(r(router).name, 'trip');
  assert.equal(r(router).index, 1);

  fw.window.history.forward();
  await flush();
  assert.equal(r(router).name, 'ledger');
  assert.deepEqual(directions, ['page:forward', 'page:forward', 'page:back', 'page:forward']);
});

test('navigate 到当前网址什么都不做；字符串目标和对象目标等价', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.navigate('/t/demo-island');
  await router.navigate({ name: 'trip', params: { tripId: 'demo-island' } });
  await router.navigate('#/t/demo-island');
  assert.equal(fw.entries.length, 2);
});

test('replace 不增加历史；back() 在第一条时去 parent，不离开网站', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island/ledger');
  await router.start();
  assert.equal(r(router).index, 0);
  const seen = [];
  router.onAfterChange((ctx) => seen.push(ctx.direction));
  router.back();
  await flush();
  assert.equal(r(router).name, 'trip', '账本的 parent 是行程概览');
  assert.equal(fw.entries.length, 1);
  assert.deepEqual(seen, ['back'], '动画方向按“返回”');
  router.back();
  await flush();
  assert.equal(r(router).name, 'trips');
  router.back();
  await flush();
  assert.equal(r(router).name, 'trips', '没有 parent 就停在默认页');
  await router.replace({ name: 'settings' });
  assert.equal(fw.entries.length, 1);
  assert.equal(r(router).name, 'settings');
});

test('back() 有本应用的上一条历史时等同浏览器返回', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.navigate({ name: 'settings' });
  router.back();
  await flush();
  assert.equal(r(router).name, 'trips');
  assert.equal(fw.index, 0);
});

test('弹层：openSheet 压历史、返回手势关掉、前进重新打开', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.navigate({ name: 'ledger', params: { tripId: 'demo-island' } });
  const kinds = [];
  router.onAfterChange((ctx) => kinds.push(ctx.kind));

  await router.openSheet('add-expense');
  assert.equal(fw.window.location.hash, '#/t/demo-island/ledger?sheet=add-expense');
  assert.deepEqual(r(router).sheet, { id: 'add-expense', arg: null });
  await router.openSheet('pick-currency', { arg: 'VND' });
  assert.equal(fw.window.location.hash, '#/t/demo-island/ledger?sheet=add-expense,pick-currency:VND');
  assert.equal(r(router).sheets.length, 2);
  assert.equal(fw.entries.length, 4);

  fw.window.history.back(); // 手势返回
  await flush();
  assert.deepEqual(r(router).sheets, [{ id: 'add-expense', arg: null }]);
  router.closeSheet(); // 代码关闭：等同返回
  await flush();
  assert.deepEqual(r(router).sheets, []);
  assert.equal(r(router).name, 'ledger');
  fw.window.history.forward();
  await flush();
  assert.equal(r(router).sheet.id, 'add-expense');
  assert.ok(kinds.every((k) => k === 'sheet'), '弹层变化不算换页');
});

test('弹层：同一个弹层重复打开不叠加；不合规则的 id 直接报错', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.openSheet('fab');
  await router.openSheet('fab');
  assert.equal(r(router).sheets.length, 1);
  assert.equal(fw.entries.length, 2);
  assert.throws(() => router.openSheet('Bad Id'), /不合规则/);
  assert.throws(() => router.openSheet('ok', { arg: 'has space' }), /不合规则/);
});

test('弹层：直接打开带 ?sheet= 的网址，关闭用 replace（不会退出网站）', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island/day/2027-01-10?sheet=edit-item:abc');
  await router.start();
  assert.equal(r(router).sheet.arg, 'abc');
  router.closeSheet();
  await flush();
  assert.deepEqual(r(router).sheets, []);
  assert.equal(fw.entries.length, 1);
  assert.equal(fw.window.location.hash, '#/t/demo-island/day/2027-01-10');
});

test('弹层：closeSheet({ all }) 一次关掉压进来的所有层', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.openSheet('a');
  await router.openSheet('b');
  await router.openSheet('c');
  router.closeSheet({ all: true });
  await flush(10);
  assert.deepEqual(r(router).sheets, []);
  assert.equal(fw.index, 0);
});

test('弹层：深链接带的弹层 + 应用里又叠的弹层，all 关闭后一个不剩', async () => {
  const { router } = setup('http://localhost/x/#/trips?sheet=a');
  await router.start();
  await router.openSheet('b');
  router.closeSheet({ all: true });
  await flush(20);
  assert.deepEqual(r(router).sheets, []);
});

test('从弹层里去别的页面：替换掉弹层那条历史，返回时弹层不再出现', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.navigate({ name: 'trip', params: { tripId: 'demo-island' } });
  await router.openSheet('fab');
  await router.navigate({ name: 'ledger', params: { tripId: 'demo-island' } });
  assert.equal(fw.entries.length, 3);
  fw.window.history.back();
  await flush();
  assert.equal(r(router).name, 'trip');
  assert.deepEqual(r(router).sheets, []);
});

test('setQuery 默认 replace、保留弹层；null 删除键', async () => {
  const { fw, router } = setup();
  await router.start();
  await router.navigate({ name: 'journal', params: { tripId: 'demo-island' } });
  const kinds = [];
  router.onAfterChange((ctx) => kinds.push(ctx.kind));
  await router.setQuery({ view: 'grid', q: '海' });
  assert.equal(fw.window.location.hash, '#/t/demo-island/journal?q=%E6%B5%B7&view=grid');
  assert.equal(fw.entries.length, 2);
  await router.setQuery({ q: null });
  assert.deepEqual(r(router).query, { view: 'grid' });
  await router.setQuery({ view: 'list' }, { replace: false });
  assert.equal(fw.entries.length, 3);
  assert.deepEqual(kinds, ['query', 'query', 'query']);
  assert.throws(() => router.setQuery({ sheet: 'x' }), /openSheet/);
});

test('守卫：改道一律生效，push 时新页面照样压历史；返回 true/undefined 放行', async () => {
  const { fw, router } = setup();
  let loggedIn = false;
  router.addGuard((to) => (to.meta.auth && !loggedIn ? { name: 'login', query: { next: to.href } } : undefined));
  await router.start();
  assert.equal(r(router).name, 'login');
  assert.equal(r(router).query.next, '#/trips');
  assert.equal(fw.entries.length, 1);
  loggedIn = true;
  await router.navigate('/settings');
  assert.equal(r(router).name, 'settings');
  assert.equal(fw.entries.length, 2);
});

test('守卫：互相改道的死循环会报错', async () => {
  const { router } = setup();
  router.addGuard((to) => (to.name === 'trips' ? '/settings' : '/trips'));
  await assert.rejects(router.start(), /改道次数过多/);
});

test('滚动：push 回到顶部，返回恢复离开时的位置', async () => {
  const { fw, router, win } = setup();
  await router.start();
  await router.navigate({ name: 'dev-page', params: { page: 'router' } });
  fw.scrollTo(1234);
  await router.navigate({ name: 'day', params: { tripId: 'demo-island', date: '2027-01-10' } });
  assert.equal(win.scrollY, 0, '新页面从顶部开始');
  fw.scrollTo(300);
  fw.window.history.back();
  await flush();
  assert.equal(win.scrollY, 1234, '返回后回到 1234');
  fw.window.history.forward();
  await flush();
  assert.equal(win.scrollY, 300, '前进后回到 300');
});

test('滚动：弹层开关、查询参数变化都不动滚动位置；scroll 选项', async () => {
  const { fw, router, win } = setup();
  await router.start();
  fw.scrollTo(500);
  await router.openSheet('fab');
  assert.equal(win.scrollY, 500);
  router.closeSheet();
  await flush();
  assert.equal(win.scrollY, 500);
  await router.setQuery({ view: 'grid' });
  assert.equal(win.scrollY, 500);
  await router.navigate({ name: 'settings' }, { scroll: 'keep' });
  assert.equal(win.scrollY, 500);
  await router.navigate({ name: 'trip', params: { tripId: 'demo-island' } }, { scroll: 260 });
  assert.equal(win.scrollY, 260);
  // 'restore'：按路径记忆（例如底栏切回某页）
  await router.navigate({ name: 'trips' }, { scroll: 'restore' });
  assert.equal(win.scrollY, 500, '上次离开 /trips 时在 500');
});

test('滚动：刷新页面（新的路由器实例、同一个历史条目）恢复位置', async () => {
  const storage = memoryStorage();
  const fw = createFakeWindow('http://localhost/x/');
  const first = createRouter({ window: fw.window, routes, storage, appTitle: 'x' });
  await first.start();
  await first.navigate('/settings');
  fw.scrollTo(777);
  first.persistScroll();
  first.stop();
  fw.scrollTo(0);
  const second = createRouter({ window: fw.window, routes, storage, appTitle: 'x' });
  await second.start();
  assert.equal(second.route.value.name, 'settings');
  assert.equal(second.route.value.index, 1, '历史序号从 history.state 恢复');
  assert.equal(fw.window.scrollY, 777);
});

test('手改地址栏 / 普通链接改 hash：当作前进一步，补上历史信息', async () => {
  const { fw, router } = setup();
  await router.start();
  fw.userNavigate('#/t/demo-island/map');
  await flush();
  assert.equal(r(router).name, 'map');
  assert.equal(r(router).index, 1);
  assert.ok(fw.window.history.state.__rs.key, '补写了 state');
  fw.window.history.back();
  await flush();
  assert.equal(r(router).name, 'trips');
});

test('过渡钩子：before → 驱动 → commit → after 的顺序，驱动可以包住 commit', async () => {
  const { router } = setup();
  await router.start();
  const log = [];
  router.onBeforeChange((ctx) => log.push(`before:${ctx.to.name}:${ctx.from.name}`));
  router.onAfterChange((ctx) => log.push(`after:${ctx.to.name}`));
  router.setTransitionDriver(async (ctx) => {
    log.push('driver-start');
    assert.equal(router.route.value.name, 'trips', 'commit 之前还是旧页面');
    await ctx.commit();
    log.push(`driver-committed:${router.route.value.name}`);
  });
  await router.navigate({ name: 'settings' });
  assert.deepEqual(log, ['before:settings:trips', 'driver-start', 'after:settings', 'driver-committed:settings']);
  router.setTransitionDriver(null);
});

test('预加载：新页面代码到了才提交；被更新的导航超越就放弃', async () => {
  const pending = [];
  const { router } = setup('http://localhost/x/#/trips', {
    preload: (route) => new Promise((resolve) => pending.push({ name: route.name, resolve })),
  });
  const started = router.start();
  pending.shift().resolve();
  await started;
  const slow = router.navigate({ name: 'settings' });
  await flush();
  assert.equal(router.route.value.name, 'trips', '代码没到，还停在旧页面');
  assert.equal(router.isNavigating.value, true);
  const fast = router.navigate({ name: 'login' });
  await flush();
  pending.find((p) => p.name === 'login').resolve();
  await fast;
  assert.equal(router.route.value.name, 'login');
  pending.find((p) => p.name === 'settings').resolve();
  await slow;
  assert.equal(router.route.value.name, 'login', '慢的那次导航不会再覆盖');
  assert.equal(router.isNavigating.value, false);
});

test('驱动没调用 commit 也会补上；驱动抛错不影响导航', async () => {
  const { router } = setup();
  await router.start();
  router.setTransitionDriver(() => {});
  await router.navigate({ name: 'settings' });
  assert.equal(router.route.value.name, 'settings');
  router.setTransitionDriver(() => {
    throw new Error('boom');
  });
  const original = console.error;
  console.error = () => {};
  try {
    await router.navigate({ name: 'login' });
  } finally {
    console.error = original;
  }
  assert.equal(router.route.value.name, 'login');
});

test('旧版网址：?invite=CODE → #/join/CODE；?shortcut=today → #/trips?go=today，并去掉查询参数', async () => {
  const a = setup('http://localhost/taiwan-trip-2026/?invite=38S7-72Q9-FTCZ&demo=1');
  await a.router.start();
  assert.equal(r(a.router).name, 'join');
  assert.equal(r(a.router).params.code, '38S7-72Q9-FTCZ');
  assert.equal(a.fw.window.location.search, '?demo=1');
  const b = setup('http://localhost/taiwan-trip-2026/?shortcut=expenses');
  await b.router.start();
  assert.equal(r(b.router).name, 'trips');
  assert.equal(r(b.router).query.go, 'ledger');
  assert.equal(b.fw.window.location.search, '');
});

test('登录回调的 hash 原样留给 supabase-js，路由给出 auth-callback', async () => {
  const { fw, router } = setup('http://localhost/x/#access_token=abc&refresh_token=def&type=recovery');
  await router.start();
  assert.equal(r(router).name, 'auth-callback');
  assert.equal(fw.window.location.hash, '#access_token=abc&refresh_token=def&type=recovery');
  await router.replace('/trips');
  assert.equal(r(router).name, 'trips');
  assert.equal(fw.entries.length, 1);
});

test('点击拦截：站内链接走 navigate，修饰键、新窗口、下载、页内锚点各自处理', async () => {
  const { fw, router } = setup();
  await router.start();
  let e = fw.click(fakeAnchor('#/settings'));
  assert.ok(e.defaultPrevented);
  await flush();
  assert.equal(r(router).name, 'settings');
  assert.equal(fw.entries.length, 2);

  e = fw.click(fakeAnchor('#/login', { dataset: { replace: 'true' } }));
  await flush();
  assert.equal(r(router).name, 'login');
  assert.equal(fw.entries.length, 2, 'data-replace');

  e = fw.click(fakeAnchor('#/trips'), { metaKey: true });
  assert.ok(!e.defaultPrevented, '按住 ⌘ 点击交给浏览器（新标签页）');
  e = fw.click(fakeAnchor('#/trips', { target: '_blank' }));
  assert.ok(!e.defaultPrevented);
  e = fw.click(fakeAnchor('https://example.com/'));
  assert.ok(!e.defaultPrevented, '外部链接不管');
  e = fw.click(fakeAnchor('#section-2'));
  assert.ok(e.defaultPrevented, '页内锚点不改 hash');
  await flush();
  assert.equal(r(router).name, 'login');
});

test('href / resolve：拼网址和解析，不导航', async () => {
  const { router } = setup();
  await router.start();
  assert.equal(router.href({ name: 'day', params: { tripId: 'demo-island', date: '2027-01-11' }, query: { item: 'x' } }), '#/t/demo-island/day/2027-01-11?item=x');
  assert.equal(router.href({ name: 'ledger', params: { tripId: 'demo-island' }, sheets: ['add-expense'] }), '#/t/demo-island/ledger?sheet=add-expense');
  const res = router.resolve('/t/demo-island/day/2027-01-11');
  assert.equal(res.name, 'day');
  assert.equal(res.meta.parent(res.params).name, 'trip');
  assert.throws(() => router.href({ name: 'ledger', query: { sheet: 'x' }, params: { tripId: 'a1' } }), /sheet/);
});

test('没 start 就导航会报错（防止在启动前误用）', () => {
  const { router } = setup();
  assert.throws(() => router.navigate('/trips'), /start/);
});

test('过渡可被打断：新导航开始时，上一次的 ctx.signal 收到中止', async () => {
  const { router } = setup();
  await router.start();
  const signals = [];
  let release;
  router.setTransitionDriver(async (ctx) => {
    signals.push(ctx.signal);
    await ctx.commit();
    if (signals.length === 1) await new Promise((r) => { release = r; }); // 第一次过渡“还在播”
  });
  const first = router.navigate({ name: 'settings' });
  await flush();
  assert.equal(signals[0].aborted, false);
  await router.navigate({ name: 'login' });
  assert.equal(signals[0].aborted, true, '第一次过渡收到中止');
  assert.equal(signals[1].aborted, false);
  release();
  await first;
  assert.equal(router.route.value.name, 'login');
});

// ---------------------------------------------------------------------
// 评审修复：L1（replace 打开的弹层、从两层弹层里跳页）、M8（返回还没落地就跳页）
// ---------------------------------------------------------------------

test('L1 弹层：replace 打开的一层，closeSheet 只关它这一层（用 replace），下面压进来的那层还在', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island/ledger');
  await router.start();
  await router.openSheet('add-expense');
  await router.openSheet('pick-currency', { replace: true });
  assert.deepEqual(r(router).sheets.map((s) => s.id), ['add-expense', 'pick-currency']);
  assert.equal(fw.entries.length, 2, 'replace 不多压历史');
  assert.deepEqual(router.sheetHistory(), { layers: '10', pushed: 1, trailing: 0 });
  await router.closeSheet();
  await flush(10);
  assert.deepEqual(r(router).sheets.map((s) => s.id), ['add-expense'], '只关了 replace 打开的那一层');
  assert.deepEqual(router.sheetHistory(), { layers: '1', pushed: 1, trailing: 1 });
  await router.closeSheet();
  await flush(10);
  assert.deepEqual(r(router).sheets, []);
  assert.equal(fw.index, 0, '压进来的那层用 back 关，回到原来的条目');
});

test('L1 弹层：两层弹层里跳页，返回时回到弹层底下的页面（两层都不再出现），前进记录里也没有带弹层的旧条目', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island/ledger');
  await router.start();
  await router.openSheet('a');
  await router.openSheet('b');
  await router.navigate({ name: 'map', params: { tripId: 'demo-island' } });
  assert.equal(r(router).name, 'map');
  assert.deepEqual(fw.entries.map((e) => new URL(e.url).hash), ['#/t/demo-island/ledger', '#/t/demo-island/map']);
  router.back();
  await flush(10);
  assert.equal(r(router).href, '#/t/demo-island/ledger', '回到弹层底下的页面，弹层不再出现');
});

test('L1 弹层：来自网址的弹层（深链接）里跳页，返回时同样不再出现', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island/ledger?sheet=edit-item:abc');
  await router.start();
  await router.navigate({ name: 'map', params: { tripId: 'demo-island' } });
  assert.equal(fw.entries.length, 2);
  router.back();
  await flush(10);
  assert.equal(r(router).href, '#/t/demo-island/ledger');
});

test('L1 弹层：closeSheet({ all }) 遇到 replace 打开的层也一次关干净', async () => {
  const { fw, router } = setup('http://localhost/x/#/trips');
  await router.start();
  await router.openSheet('a');
  await router.openSheet('b', { replace: true });
  await router.openSheet('c');
  await router.closeSheet({ all: true });
  await flush(20);
  assert.deepEqual(r(router).sheets, []);
  assert.equal(fw.index, 0);
});

test('M8 返回还没落地就跳页（搜索框失焦收起的同时点了链接）：先等返回落地，再跳；跳页没有被吞掉', async () => {
  const { fw, router } = setup('http://localhost/x/#/t/demo-island');
  await router.start();
  await router.openSheet('search');
  router.closeSheet(); // 失焦收起 → history.back()（异步）
  assert.equal(router.popPending, true);
  const nav = router.navigate({ name: 'ledger', params: { tripId: 'demo-island' } }); // 同一时刻点了链接
  await nav;
  await flush(10);
  assert.equal(r(router).name, 'ledger', '跳页生效了');
  assert.equal(fw.window.location.hash, '#/t/demo-island/ledger');
  router.back();
  await flush(10);
  assert.equal(r(router).href, '#/t/demo-island', '返回到原页面（没有搜索弹层）');
});
