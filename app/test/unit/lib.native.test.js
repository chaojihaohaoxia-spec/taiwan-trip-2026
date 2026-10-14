// lib/native.js：外链白名单、同窗口 / 新标签页、iOS 外壳的桥（window.webkit.messageHandlers.rs7885）、
// 触感（navigator.vibrate，外壳接管）、系统分享（不支持就复制链接 + 提示）、跳去别的 App 后的检测。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openExternal, haptic, share, isNativeShell, safeExternalUrl, watchAppSwitch, ALLOWED_PROTOCOLS, HAPTIC_PATTERNS,
  NATIVE_HANDLER, NATIVE_BRIDGE_VERSION,
} from '../../src/lib/native.js';
import { onNotify } from '../../src/lib/notify.js';

/** 假浏览器：记录 location.href 的赋值、window.open 的调用、事件监听 */
function fakeEnv({ shell = false, openReturns = 'window', nav = {}, doc = {} } = {}) {
  const posted = [];
  const opened = [];
  const listeners = new Map();
  const location = { href: 'http://localhost/app/#/t/x' };
  const on = (target) => ({
    addEventListener: (type, fn) => listeners.set(`${target}:${type}`, fn),
    removeEventListener: (type) => listeners.delete(`${target}:${type}`),
  });
  const window = {
    location,
    open(url, name) {
      opened.push({ url, name });
      if (openReturns === 'throw') throw new Error('blocked');
      return openReturns === 'window' ? { opener: 'me' } : null;
    },
    ...on('window'),
  };
  if (shell) window.webkit = { messageHandlers: { [NATIVE_HANDLER]: { postMessage: (m) => posted.push(m) } } };
  const document = { visibilityState: 'visible', ...on('document'), ...doc };
  return { env: { window, navigator: nav, document }, posted, opened, location, listeners };
}

function captureNotices() {
  const list = [];
  const off = onNotify((n) => list.push(n));
  return { list, off };
}

test('外链白名单：http(s) / tel / mailto / sms / grab 等放行；javascript:、data:、file:、相对网址、控制字符一律拒绝', () => {
  assert.deepEqual([...ALLOWED_PROTOCOLS], ['http:', 'https:', 'tel:', 'mailto:', 'sms:', 'grab:', 'comgooglemaps:', 'whatsapp:']);
  assert.equal(safeExternalUrl('https://www.google.com/maps/dir/?api=1&destination=10.2,103.9'), 'https://www.google.com/maps/dir/?api=1&destination=10.2,103.9');
  assert.equal(safeExternalUrl('  https://example.com/a b  '), 'https://example.com/a%20b', 'http(s) 用规范后的写法');
  assert.equal(safeExternalUrl('tel:+0000012345678'), 'tel:+0000012345678');
  assert.equal(safeExternalUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
  assert.equal(safeExternalUrl('grab://open?screenType=BOOKING&dropOffKeywords=Ch%E1%BB%A3'), 'grab://open?screenType=BOOKING&dropOffKeywords=Ch%E1%BB%A3', 'App 深链接原样保留');
  assert.equal(safeExternalUrl('HTTPS://EXAMPLE.COM/'), 'https://example.com/');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<b>x</b>',
    'file:///etc/hosts', 'blob:https://example.com/x', 'vbscript:x', 'intent://x', '/relative/path', '#/t/x', 'example.com', '',
    null, undefined, 'https://', 'https://exa\u0000mple.com', 'https://example.com/\tx']) {
    assert.equal(safeExternalUrl(bad), null, String(bad));
  }
});

test('openExternal（网页）：默认同一个窗口 location.href；newTab 用 window.open 并切断 opener；被拦退回同窗口', () => {
  const a = fakeEnv();
  assert.equal(openExternal('https://www.google.com/maps/search/?api=1&query=x', { env: a.env }), true);
  assert.equal(a.location.href, 'https://www.google.com/maps/search/?api=1&query=x');
  assert.equal(a.opened.length, 0, '默认不开新标签页（iOS 只有同窗口跳转才会唤起 App）');

  const b = fakeEnv();
  let opener;
  b.env.window.open = (url, name) => {
    b.opened.push({ url, name });
    const w = { opener: 'me' };
    queueMicrotask(() => { opener = w.opener; });
    return w;
  };
  assert.equal(openExternal('https://example.com/manage', { newTab: true, env: b.env }), true);
  assert.deepEqual(b.opened, [{ url: 'https://example.com/manage', name: '_blank' }]);
  assert.equal(b.location.href, 'http://localhost/app/#/t/x', '开了新标签页，本页不跳');
  return Promise.resolve().then(() => assert.equal(opener, null, '新窗口的 opener 被切断'));
});

test('openExternal：新标签页被浏览器拦了（返回 null / 抛错）就同窗口打开；tel:/grab: 即使要求 newTab 也同窗口', () => {
  for (const openReturns of [null, 'throw']) {
    const e = fakeEnv({ openReturns });
    assert.equal(openExternal('https://example.com/x', { newTab: true, env: e.env }), true);
    assert.equal(e.location.href, 'https://example.com/x', String(openReturns));
  }
  for (const url of ['tel:+0000012345678', 'grab://open?screenType=BOOKING', 'mailto:a@example.com']) {
    const e = fakeEnv();
    openExternal(url, { newTab: true, env: e.env });
    assert.equal(e.opened.length, 0, url);
    assert.equal(e.location.href, url);
  }
});

test('openExternal：不安全的链接不打开、返回 false、本页不动', () => {
  const e = fakeEnv();
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal(openExternal('javascript:alert(document.cookie)', { env: e.env }), false);
    assert.equal(openExternal('data:text/html,hi', { newTab: true, env: e.env }), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(e.location.href, 'http://localhost/app/#/t/x');
  assert.equal(e.opened.length, 0);
  assert.equal(warned.length, 2);
});

test('iOS 外壳：检测到 window.webkit.messageHandlers.rs7885 就交给外壳（open / haptic / share），网页自己不再做', async () => {
  const e = fakeEnv({ shell: true, nav: { vibrate: () => assert.fail('外壳在时不该调 vibrate'), share: () => assert.fail('外壳在时不该调 navigator.share') } });
  assert.equal(isNativeShell({ env: e.env }), true);
  assert.equal(isNativeShell({ env: fakeEnv().env }), false);
  assert.equal(isNativeShell({ env: { window: { webkit: { messageHandlers: { [NATIVE_HANDLER]: {} } } } } }), false, '没有 postMessage 不算');

  assert.equal(openExternal('https://example.com/a', { env: e.env }), true);
  assert.equal(openExternal('grab://open?screenType=BOOKING', { newTab: true, env: e.env }), true);
  assert.equal(haptic('success', { env: e.env }), true);
  assert.equal(haptic('奇怪的种类', { env: e.env }), true);
  assert.deepEqual(await share({ title: '行程', url: 'https://example.com/t' }, { env: e.env }), { ok: true, method: 'native' });
  assert.equal(e.location.href, 'http://localhost/app/#/t/x', '网页自己不跳');
  assert.equal(e.opened.length, 0);
  assert.deepEqual(e.posted, [
    { v: NATIVE_BRIDGE_VERSION, type: 'open', url: 'https://example.com/a', newTab: false },
    { v: NATIVE_BRIDGE_VERSION, type: 'open', url: 'grab://open?screenType=BOOKING', newTab: true },
    { v: NATIVE_BRIDGE_VERSION, type: 'haptic', kind: 'success' },
    { v: NATIVE_BRIDGE_VERSION, type: 'haptic', kind: 'light' },
    { v: NATIVE_BRIDGE_VERSION, type: 'share', title: '行程', url: 'https://example.com/t' },
  ]);
  // 外壳里也不放行不安全的链接
  assert.equal(openExternal('javascript:void 0', { env: e.env }), false);
  assert.equal(e.posted.length, 5);
});

test('haptic（网页）：navigator.vibrate 按种类给震动模式；没有 vibrate、页面还没被点过时什么都不做', () => {
  const calls = [];
  const nav = { vibrate: (p) => { calls.push(p); return true; }, userActivation: { hasBeenActive: true } };
  for (const kind of ['light', 'medium', 'success', 'warning', 'selection']) assert.equal(haptic(kind, { env: { navigator: nav } }), true);
  assert.equal(haptic(undefined, { env: { navigator: nav } }), true);
  assert.deepEqual(calls, [HAPTIC_PATTERNS.light, HAPTIC_PATTERNS.medium, HAPTIC_PATTERNS.success, HAPTIC_PATTERNS.warning, HAPTIC_PATTERNS.selection, HAPTIC_PATTERNS.light]);
  assert.equal(haptic('light', { env: { navigator: {} } }), false, 'iOS Safari 没有 vibrate');
  assert.equal(haptic('light', { env: {} }), false);
  const idle = { vibrate: () => assert.fail('没点过页面不该震'), userActivation: { hasBeenActive: false } };
  assert.equal(haptic('light', { env: { navigator: idle } }), false);
  assert.equal(haptic('light', { env: { navigator: { vibrate: () => { throw new Error('x'); } } } }), false, '出错不抛');
});

test('share：支持 navigator.share 就用系统分享；用户取消不复制；其他错误退回复制', async () => {
  const shared = [];
  const ok = { share: async (d) => { shared.push(d); }, canShare: () => true };
  assert.deepEqual(await share({ title: '椰影岛', text: '一起看行程', url: 'https://example.com/t/demo' }, { env: { navigator: ok } }), { ok: true, method: 'share' });
  assert.deepEqual(shared, [{ title: '椰影岛', text: '一起看行程', url: 'https://example.com/t/demo' }]);

  const writes = [];
  const cancel = { share: async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }, clipboard: { writeText: async (t) => writes.push(t) } };
  assert.deepEqual(await share({ url: 'https://example.com/x' }, { env: { navigator: cancel } }), { ok: false, method: 'share', cancelled: true });
  assert.deepEqual(writes, [], '用户取消分享，不偷偷复制');

  const n = captureNotices();
  try {
    const denied = { share: async () => { const e = new Error('no gesture'); e.name = 'NotAllowedError'; throw e; }, clipboard: { writeText: async (t) => writes.push(t) } };
    assert.deepEqual(await share({ title: 't', url: 'https://example.com/y' }, { env: { navigator: denied } }), { ok: true, method: 'copy' });
    assert.deepEqual(writes, ['https://example.com/y']);
    assert.equal(n.list.at(-1).message, '链接已复制，可以粘贴给对方');
    assert.equal(n.list.at(-1).tone, 'success');
  } finally {
    n.off();
  }
});

test('share：不支持系统分享（桌面浏览器）→ 复制链接并提示；没有链接复制标题 + 文字；复制也失败时提示手动复制；什么都没给不做事', async () => {
  const n = captureNotices();
  try {
    const writes = [];
    const desktop = { clipboard: { writeText: async (t) => writes.push(t) } };
    assert.deepEqual(await share({ title: '椰影岛', url: 'https://example.com/t' }, { env: { navigator: desktop } }), { ok: true, method: 'copy' });
    assert.equal(writes[0], 'https://example.com/t', '有链接只复制链接');
    assert.deepEqual(await share({ title: '常用语', text: 'Cảm ơn' }, { env: { navigator: desktop } }), { ok: true, method: 'copy' });
    assert.equal(writes[1], '常用语\nCảm ơn', '真换行');
    assert.equal(n.list.at(-1).message, '已复制，可以粘贴给对方');

    // canShare 说分享不了（比如带了不支持的字段）也退回复制
    const cannot = { share: async () => assert.fail('canShare 为 false 时不该调 share'), canShare: () => false, clipboard: { writeText: async (t) => writes.push(t) } };
    assert.equal((await share({ url: 'https://example.com/z' }, { env: { navigator: cannot } })).method, 'copy');

    const broken = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
    assert.deepEqual(await share({ url: 'https://example.com/t' }, { env: { navigator: broken, document: undefined } }), { ok: false, method: 'copy' });
    assert.equal(n.list.at(-1).tone, 'warning');
    assert.match(n.list.at(-1).message, /手动复制/);

    assert.deepEqual(await share({}, { env: { navigator: desktop } }), { ok: false, method: null });
  } finally {
    n.off();
  }
});

test('watchAppSwitch：timeout 内页面被切到后台（visibilitychange → hidden / pagehide / blur）→ true；一直在前台 → false', async () => {
  const a = fakeEnv();
  const pa = watchAppSwitch({ timeout: 200, env: a.env });
  a.env.document.visibilityState = 'hidden';
  a.listeners.get('document:visibilitychange')();
  assert.equal(await pa, true);
  assert.equal(a.listeners.size, 0, '监听都摘掉了');

  for (const ev of ['window:pagehide', 'window:blur']) {
    const e = fakeEnv();
    const p = watchAppSwitch({ timeout: 200, env: e.env });
    e.listeners.get(ev)();
    assert.equal(await p, true, ev);
  }

  const b = fakeEnv();
  const t0 = Date.now();
  assert.equal(await watchAppSwitch({ timeout: 60, env: b.env }), false);
  assert.ok(Date.now() - t0 >= 50);
  assert.equal(b.listeners.size, 0);

  // 页面还可见时的 visibilitychange（比如别的原因触发）不算
  const c = fakeEnv();
  const pc = watchAppSwitch({ timeout: 60, env: c.env });
  c.listeners.get('document:visibilitychange')();
  assert.equal(await pc, false);

  assert.equal(await watchAppSwitch({ env: fakeEnv({ shell: true }).env }), true, '外壳里由外壳打开，当作打开了');
  assert.equal(await watchAppSwitch({ env: {} }), false);
});
