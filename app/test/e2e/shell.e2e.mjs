// 外壳整合（app.jsx + main.jsx）：各模块接进外壳以后的联动。
//   - 登录态接到路由：非演示模式没登录 → 带到 #/login?next=…；演示模式自带已登录的演示账号，直接进；
//     退出登录 → 登录页；密码 / 邮箱验证码登录 → 回到 next；已登录打开登录页 → 直接跳走；
//   - 开发页专用样式表（assets/dev-*.css）只在打开 #/dev 时才下载，首屏样式表里没有开发页的样式；
//   - 全站按压反馈的委托（motion/press.js）：任何带 data-press 的元素按下即缩、滑出取消、不算点击；
//   - 外壳的「有新版本」提示在时，Toast 往上让（--ov-toast-lift），两者不重叠。
// 截图在 __screenshots__/shell/。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, assertNoHorizontalOverflow, assertTapTargets } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (page) => page.evaluate(() => window.location.hash);
const waitHash = (page, test, timeout = 8000) => page.waitForFunction(
  (src) => new RegExp(src).test(window.location.hash), { timeout }, test.source,
);
const h1 = (page) => page.evaluate(() => document.querySelector('h1')?.textContent || '');

test('非演示模式、没登录：打开行程里的深层页面 → 改道登录页，next 记着原网址；登录页无报错、不连外网', async () => {
  const app = await openApp({ browser, server, demo: false, hash: '#/t/demo-island/ledger' });
  try {
    const { page } = app;
    await waitHash(page, /^#\/login\?/);
    assert.equal(await hashOf(page), '#/login?next=%23%2Ft%2Fdemo-island%2Fledger');
    await page.waitForSelector(T('login-password-form'));
    assert.equal(await h1(page), '登录');
    // 改道用的是 replace：历史里没有留下那个要登录的页面（还是本应用的第 0 条）
    assert.equal(await page.evaluate(() => window.history.state?.__rs?.idx), 0);
    // 输入检查给具体的中文提示（不发请求）
    await page.click(T('login-submit'));
    await page.waitForSelector(T('login-error'));
    assert.equal(await page.$eval(T('login-error'), (el) => el.textContent), '请填写邮箱');
    await page.type(T('login-email'), 'not-an-email');
    await page.click(T('login-submit'));
    await page.waitForFunction(() => document.querySelector('[data-testid="login-error"]')?.textContent === '邮箱格式不对', { timeout: 6000 });
    await app.shot('login-error');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('演示模式直接进：要登录的页面不改道；首页的行程列表、账号来自数据层', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island/ledger' });
  try {
    const { page } = app;
    await page.waitForFunction(() => document.title === '账本 · 热爱生活7885');
    await sleep(300);
    assert.equal(await hashOf(page), '#/t/demo-island/ledger', '没有被带去登录页');
    await app.go('#/trips');
    await page.waitForSelector(T('trip-demo-cities'));
    assert.match(await page.$eval(T('account-name'), (el) => el.textContent), /Jeremy/);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('演示模式：退出登录 → 登录页（next 记着首页）→ 密码错了显示原因 → 用 Cathy 登录（转圈 → 对勾）→ 回到首页', async () => {
  const app = await openApp({ browser, server });
  try {
    const { page } = app;
    await page.waitForSelector(T('sign-out'));
    await page.click(T('sign-out'));
    await waitHash(page, /^#\/login\?next=%23%2Ftrips$/);
    await page.waitForSelector(T('login-demo-hint'));
    await page.type(T('login-email'), 'cathy@example.com');
    await page.type(T('login-password'), 'wrong-password');
    await page.click(T('login-submit'));
    await page.waitForFunction(() => document.querySelector('[data-testid="login-error"]')?.textContent === '邮箱或密码不对', { timeout: 6000 });
    assert.equal(await page.$eval(T('login-submit'), (el) => el.dataset.state), 'error', '按钮抖一下、变成「重试」');
    // 改对密码，回车提交（表单里的提交按钮接管：转圈 → 对勾 → 跳回 next）
    await page.$eval(T('login-password'), (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type(T('login-password'), 'demo1234');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="login-submit"]')?.dataset.state === 'loading', { timeout: 4000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="login-submit"]')?.dataset.state === 'success', { timeout: 6000 });
    await waitHash(page, /^#\/trips$/);
    await page.waitForFunction(() => /Cathy/.test(document.querySelector('[data-testid="account-name"]')?.textContent || ''), { timeout: 6000 });
    // 登录页那一条历史被替换掉了：返回不会回到登录页
    assert.notEqual(await page.evaluate(() => window.location.hash), '#/login');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('演示模式：邮箱验证码登录（发送 → 对勾描完切到输入验证码 → 登录）；已登录再打开登录页会直接跳走', async () => {
  const app = await openApp({ browser, server });
  try {
    const { page } = app;
    await page.waitForSelector(T('sign-out'));
    await page.click(T('sign-out'));
    await page.waitForSelector(T('login-mode'));
    await page.click(`${T('login-mode')} .seg__item:nth-of-type(2)`);
    await page.waitForSelector(T('login-code-form'));
    await page.type(T('login-email'), 'jeremy@example.com');
    await page.click(T('login-send-code'));
    await page.waitForSelector(T('login-code'), { timeout: 6000 });
    assert.match(await page.$eval(T('login-code-form'), (el) => el.textContent), /已发到 jeremy@example\.com/);
    assert.match(await page.$eval(T('login-resend'), (el) => el.textContent), /秒后可以重发/);
    await page.type(T('login-code'), '123456');
    await page.click(T('login-verify'));
    await waitHash(page, /^#\/trips$/);
    await page.waitForFunction(() => /Jeremy/.test(document.querySelector('[data-testid="account-name"]')?.textContent || ''), { timeout: 6000 });
    // 已登录打开登录页（带 next）：直接去 next
    await page.evaluate(() => { window.location.hash = '#/login?next=%23%2Fsettings'; });
    await waitHash(page, /^#\/settings$/);
    // 网址先变、页面代码下载完才换页：机器忙的时候（几套 e2e 同时跑）要等新页面真的出来
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === '设置', { timeout: 8000 });
    assert.equal(await h1(page), '设置');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('开发页样式表单独成文件：首页不下载；打开开发页时先加载好再渲染；首屏样式表里没有开发页的样式', async () => {
  const seen = server.requests.length;
  const app = await openApp({ browser, server });
  try {
    const { page } = app;
    const devCss = await page.$eval('meta[name="rs7885-dev-css"]', (m) => m.content);
    assert.match(devCss, /^assets\/dev-[A-Z2-7]{8}\.css$/);
    const appCss = await page.$eval('link[rel="stylesheet"]', (l) => l.getAttribute('href'));
    assert.match(appCss, /^assets\/app-[A-Z2-7]{8}\.css$/);
    assert.equal(await page.$('link[data-dev-css]'), null, '首页没有加载开发页样式表');
    assert.ok(!server.requests.slice(seen).some((u) => u.includes('/assets/dev-')), '首页没有请求开发页样式表');
    await app.go('#/dev/primitives');
    await page.waitForSelector('[data-testid="primitives-page"]');
    // 样式表加载好以后才渲染：开发页导航的胶囊是圆角、有底色（不是浏览器默认的链接样式）
    const styled = await page.$eval('.dev-nav .dev-chip', (el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, decoration: cs.textDecorationLine };
    });
    assert.notEqual(styled.radius, '0px', `开发页样式生效：${JSON.stringify(styled)}`);
    assert.notEqual(styled.bg, 'rgba(0, 0, 0, 0)', `开发页样式生效：${JSON.stringify(styled)}`);
    assert.equal(await page.$$eval('link[data-dev-css]', (els) => els.length), 1);
    // 再进别的开发页不会重复加载
    await app.go('#/dev/overlays');
    await page.waitForSelector(T('demo-overlay-sheet'));
    assert.equal(await page.$$eval('link[data-dev-css]', (els) => els.length), 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('全站按压反馈的委托：带 data-press 的普通按钮按下即缩、滑出取消（不算点击）、松手弹回', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/overlays', device: 'desktop' });
  try {
    const { page } = app;
    const sel = T('toast-plain');
    await page.waitForSelector(T('open-expense'));
    // 这个按钮是普通 <button class="dev-btn">：给它加上 data-press，靠 main.jsx 装的全局委托响应
    await page.$eval(sel, (el) => {
      el.setAttribute('data-press', 'scale');
      el.scrollIntoView({ block: 'center' });
    });
    const scaleOf = () => page.$eval(sel, (el) => {
      const s = getComputedStyle(el).scale;
      return s === 'none' ? 1 : Number(s.split(' ')[0]);
    });
    const box = await (await page.$(sel)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await page.$eval(sel, (el) => el.hasAttribute('data-pressed')), true, '按下即有按下态');
    await page.waitForFunction((s) => {
      const v = getComputedStyle(document.querySelector(s)).scale;
      return v !== 'none' && Number(v.split(' ')[0]) < 0.99;
    }, {}, sel);
    // 滑出按钮：回弹，在外面松手不算点击（不会弹出 Toast）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 80, { steps: 5 });
    assert.equal(await page.$eval(sel, (el) => el.hasAttribute('data-pressed')), false, '滑出取消');
    await page.mouse.up();
    await sleep(300);
    assert.equal(await page.$('.ov-toast'), null, '滑出去松手没有触发点击');
    // 正常点一下：触发点击，弹回 1
    await page.click(sel);
    await page.waitForSelector('.ov-toast');
    await app.idle();
    assert.ok(Math.abs((await scaleOf()) - 1) < 0.002);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「有新版本」提示在时（外壳写 --ov-toast-lift），Toast 整体往上让，不重叠', async () => {
  const app = await openApp({ browser, server, hash: '#/dev/overlays' });
  try {
    const { page } = app;
    await page.waitForSelector(T('toast-plain'));
    await page.$eval(T('toast-plain'), (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(T('toast-plain'));
    await page.waitForSelector('.ov-toast[data-state="open"]');
    await app.idle();
    const bottom0 = await page.$eval('[data-overlay-toasts]', (el) => el.getBoundingClientRect().bottom);
    await page.evaluate(() => document.documentElement.style.setProperty('--ov-toast-lift', '60px'));
    await app.idle();
    const bottom1 = await page.$eval('[data-overlay-toasts]', (el) => el.getBoundingClientRect().bottom);
    assert.ok(Math.abs(bottom0 - bottom1 - 60) < 1, `往上让了 60px：${bottom0} → ${bottom1}`);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('登录页：手机深色 / 桌面截图，不横向滚动、触控区 ≥44px', async () => {
  for (const [device, colorScheme] of [['mobile', 'dark'], ['desktop', 'light']]) {
    const app = await openApp({ browser, server, demo: false, device, colorScheme });
    try {
      const { page } = app;
      await page.waitForSelector(T('login-password-form'));
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargets(page);
      await app.shot(`login-${colorScheme}`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});

test('M7 断网时进入没加载过的页面 → 「页面加载失败」；联网后点「重试」就能打开（不用刷新整页）', async () => {
  const app = await openApp({ browser, server, hash: '#/trips' });
  try {
    const { page } = app;
    await page.setOfflineMode(true);
    // 行程里的页面（占位页分包还没下载过）
    await page.evaluate(() => { window.location.hash = '#/t/demo-island/ledger'; });
    await page.waitForSelector('.shell-error', { timeout: 8000 });
    assert.equal(await page.$eval('.shell-error__title', (el) => el.textContent), '页面加载失败');
    await app.shot('chunk-error-offline', { fullPage: false });
    // 还没联网时点重试：仍然是加载失败（不会卡住、不会白屏）
    await page.click(T('error-retry'));
    await page.waitForSelector('.shell-error', { timeout: 8000 });
    // 联网后点重试：页面打开
    await page.setOfflineMode(false);
    await page.click(T('error-retry'));
    await page.waitForFunction(() => !document.querySelector('.shell-error') && document.querySelector('#main h1'), { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.location.hash), '#/t/demo-island/ledger', '没有刷新整页、网址没变');
    app.assertClean({ allowErrors: [/预加载页面失败|页面出错|dynamically imported module|ERR_INTERNET_DISCONNECTED|Failed to fetch/] });
  } finally {
    await app.close();
  }
});
