// 翻译（pages/translate）、对话模式（sheets/converse）、给对方看一句翻译（driver tr.<id>）：演示数据（椰影岛进行中第 2 天；三城是台湾，不该有翻译）。
//   入口：「更多」菜单第一行「翻译」（椰影岛有、三城没有）；
//   页面：空的时候一句话；输入区浮在底栏上面；边打边翻（停一下自动出结果，越南语最大、意思是、英语）；「翻译」翻好变淡、记进最近翻过；
//     收藏（星）、复制、「给对方看」从按钮长出全屏大字；⇄ 对调（回译现成）；加称呼；最近翻过点开；刷新以后收藏、最近翻过还在；
//   分栏「翻译 · 记录」（拿手机给对方看时不露翻过的句子）：默认在「翻译」、「翻译」里没有任何列表；「记录」里有收藏和最近翻过、
//     输入区收起；点一条回到「翻译」显示它；「清空」先问、只清最近翻过；离开再回来、回到后台都回到「翻译」；tablist 语义、方向键能切；
//   对话：第一次讲怎么用、我说 → 对方那半屏（转 180°）出越南语、对方说 → 胶囊照着出字；退出；
//   真接口的请求格式（?trhttp=1，拦下请求返回假的）：text/plain、token 和行程放 body、进页面先预热；bad_token 换 token 重试；
//     连不上（接口没上线）说「暂时连不上」、收藏照样能看；
//   375 / 1280 / 深色不横向滚动、触控区 ≥44。
// 截图：<截图根目录>/__screenshots__/page-translate/（TR_SHOTS 给了就再存一份到那里）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { openApp, assertNoHorizontalOverflow, SCREENSHOT_DIR } from './lib/harness.mjs';
import { launchChrome } from '../../scripts/lib/chrome.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { TRANSLATE_URL } from '../../src/data/config.js';

const DURING = '2027-01-11T10:00:00+07:00';
const SHOTS = path.join(SCREENSHOT_DIR, 'page-translate');
const EXTRA = process.env.TR_SHOTS || '';
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面脚本跑之前：去掉浏览器的语音识别（对话模式退回键盘方式） */
const NO_SPEECH = () => {
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true });
};

/** 页面脚本跑之前：换一个假的语音识别——我说（zh-CN）/ 对方说（vi-VN）各说一句，先出半句再出整句；window.__recMode = 'deny' 时拒绝麦克风 */
const FAKE_SPEECH = () => {
  const SAY = { 'zh-CN': '我们两个人，有海边的位子吗？', 'vi-VN': 'Dạ, chờ em một chút nha.' };
  class FakeRec {
    start() {
      window.__recLangs = [...(window.__recLangs || []), this.lang];
      const full = SAY[this.lang] || '';
      setTimeout(() => {
        if (window.__recMode === 'deny') {
          this.onerror?.({ error: 'not-allowed' });
          this.onend?.();
          return;
        }
        this.onresult?.({ results: [Object.assign([{ transcript: full.slice(0, 4) }], { isFinal: false })] });
        setTimeout(() => {
          if (this.stopped) return;
          this.onresult?.({ results: [Object.assign([{ transcript: full }], { isFinal: true })] });
          setTimeout(() => this.onend?.(), 120);
        }, 260);
      }, 120);
    }
    stop() {
      this.stopped = true;
      setTimeout(() => this.onend?.(), 30);
    }
  }
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRec, configurable: true, writable: true });
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
};

let browser;
let server;
before(async () => {
  browser = await launchChrome();
  server = await startStaticServer();
  mkdirSync(SHOTS, { recursive: true });
  if (EXTRA) mkdirSync(EXTRA, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** 截一屏（不是整页）：存到截图目录，TR_SHOTS 给了再复制一份 */
async function shot(app, name) {
  await app.idle();
  const file = path.join(SHOTS, `${name}.png`);
  await app.page.screenshot({ path: file });
  if (EXTRA) copyFileSync(file, path.join(EXTRA, `${name}.png`));
  return file;
}

async function openTranslate(o = {}) {
  const { hash: h = '#/t/demo-island/translate', ...rest } = o;
  const app = await openApp({ browser, server, hash: h, now: DURING, ...rest });
  await app.page.waitForSelector(T('page-translate'), { timeout: 10000 });
  await app.page.waitForFunction(() => document.querySelector('[data-testid="tr-dock"]') || document.querySelector('[data-testid="tr-none"]'), { timeout: 10000 });
  await app.idle();
  return app;
}

/** 在输入框里写字（像真人打字：一个一个 input 事件） */
async function typeIn(page, text) {
  await page.focus(T('tr-input'));
  await page.keyboard.type(text, { delay: 8 });
}

/** 先滚到屏幕中间再点（puppeteer 自己滚只滚到边上，会被浮着的输入区盖住） */
async function tap(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.click(sel);
}

async function waitResult(page, vi) {
  await page.waitForFunction((v) => document.querySelector('[data-testid="tr-vi"], [data-testid="tr-zh"]')?.textContent.includes(v), { timeout: 6000 }, vi);
}

/** 换到某一栏（'tr' 翻译 / 'rec' 记录）：点标签，等那一栏的面板出来、动画停下 */
async function toTab(app, id) {
  const { page } = app;
  await page.$eval('#tr-tab-' + id, (el) => el.scrollIntoView({ block: 'nearest' }));
  await page.click('#tr-tab-' + id);
  await page.waitForSelector(id === 'rec' ? T('tr-records') : T('tr-feed'), { timeout: 3000 });
  await app.idle();
}

/** 现在停在哪一栏（读 aria-selected） */
const tabNow = (page) => page.$eval('[role="tablist"] [aria-selected="true"]', (n) => n.id.replace('tr-tab-', ''));

/** 页面上一行收藏 / 常用语 / 最近翻过都没有（不是藏起来，是根本不在页面里） */
async function assertNoRows(page, why) {
  const n = await page.evaluate(() => document.querySelectorAll('[data-testid="tr-row"], [data-testid="tr-tip-row"], [data-testid="tr-saved"], [data-testid="tr-recent"], [data-testid="tr-tips"], [data-testid="tr-records"]').length);
  assert.equal(n, 0, why);
}

/** 本机存一条收藏、三条最近翻过（假的句子，不是真实行程） */
const SEED = () => {
  localStorage.setItem('rs7885:translate:star', JSON.stringify([
    { id: 's1', dir: 'out', input: '我对花生过敏，菜里不能有花生和花生油。', vi: 'Tôi bị dị ứng đậu phộng, món ăn không được có đậu phộng và dầu đậu phộng nha.', en: "I'm allergic to peanuts.", zh: '', back: '我对花生过敏', at: 1 },
  ]));
  localStorage.setItem('rs7885:translate:recent', JSON.stringify([
    { id: 't3', dir: 'out', input: '请问你们几点关门？', vi: 'Cho tôi hỏi tiệm mấy giờ đóng cửa ạ?', en: 'What time do you close?', zh: '', back: '请问店几点关门？', at: 3 },
    { id: 't2', dir: 'out', input: '不要香菜，我们不吃海鲜。', vi: 'Không cho ngò nha, tụi tôi không ăn hải sản.', en: "No cilantro, please. We don't eat seafood.", zh: '', back: '别放香菜哦，我们不吃海鲜。', at: 2 },
    { id: 't1', dir: 'in', input: 'Dạ, chờ em một chút nha.', vi: '', en: '', zh: '好的，稍等我一下。', back: '', at: 1 },
  ]));
};
const SEEDED = ['我对花生过敏', '请问你们几点关门', '不要香菜', 'chờ em một chút'];

/** 打开翻译页，本机先存好收藏和最近翻过 */
async function openSeeded(o = {}) {
  const app = await openTranslate(o);
  await app.page.evaluate(SEED);
  await app.page.reload({ waitUntil: 'load' });
  await app.page.waitForSelector(T('tr-dock'), { timeout: 10000 });
  await app.idle();
  return app;
}

/** 只检查某一块里可点的东西 */
async function assertTapTargetsIn(page, root) {
  const small = await page.evaluate((sel) => {
    const out = [];
    for (const scope of document.querySelectorAll(sel)) {
      for (const el of scope.querySelectorAll('a[href], button, [role="button"], select, textarea')) {
        if (el.closest('[inert]') || el.getAttribute('aria-hidden') === 'true' || el.tabIndex < 0) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        if (el.tagName === 'SELECT') continue;   // 透明的原生选择框盖在「加称呼」上，量外面那个 label
        let w = r.width;
        let h = r.height;
        for (const pseudo of ['::after', '::before']) {
          const ps = getComputedStyle(el, pseudo);
          if (ps.content === 'none' || ps.position !== 'absolute') continue;
          const n = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
          w = Math.max(w, r.width - n(ps.left) - n(ps.right));
          h = Math.max(h, r.height - n(ps.top) - n(ps.bottom));
        }
        if (w < 43.5 || h < 39.5) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}」${Math.round(w)}×${Math.round(h)}`);
      }
    }
    return out;
  }, root);
  assert.deepEqual(small, [], `这些可点元素太小：\n${small.join('\n')}`);
}

test('入口：椰影岛（越南）「更多」第一行是翻译，点进去；三城（台湾）没有，硬打开说不用翻译', async () => {
  const app = await openApp({ browser, server, hash: '#/t/demo-island', now: DURING });
  const { page } = app;
  try {
    await page.click(T('tab-more'));
    await page.waitForSelector(T('more-translate'));
    await app.idle();
    const first = await page.$eval('.more-grid', (n) => n.querySelector('.more-tile')?.dataset.testid);
    assert.equal(first, 'more-translate');
    await shot(app, '01-更多菜单-翻译在第一行');
    // 一屏放得下：签名不被底栏挡住
    const fits = await page.evaluate(() => {
      const sign = document.querySelector('.more-sign');
      const bar = document.querySelector('[data-testid="shell-tabbar"]');
      return !sign || !bar || sign.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1;
    });
    assert.ok(fits, '「更多」菜单加了一行以后签名被底栏挡住了');
    await page.click(T('more-translate'));
    await page.waitForSelector(T('tr-dock'), { timeout: 8000 });
    await app.idle();
    assert.match(await page.evaluate(() => location.hash), /#\/t\/demo-island\/translate/);
    const tabOn = await page.$eval(T('tab-more'), (n) => n.getAttribute('aria-current') || n.dataset.active || '');
    assert.ok(tabOn !== null);
    app.assertClean();
  } finally {
    await app.close();
  }
  const tw = await openApp({ browser, server, hash: '#/t/demo-cities', now: DURING });
  try {
    await tw.page.click(T('tab-more'));
    await tw.page.waitForSelector(T('more-bookings'));
    assert.equal(await tw.page.$(T('more-translate')), null);
    await tw.close();
    const tw2 = await openTranslate({ hash: '#/t/demo-cities/translate' });
    await tw2.page.waitForSelector(T('tr-none'));
    assert.equal(await tw2.page.$(T('tr-dock')), null);
    tw2.assertClean();
    await tw2.close();
  } catch (e) {
    await tw.close();
    throw e;
  }
});

test('翻译页：空的时候一句话；输入区浮在底栏上面；边打边翻出结果（越南语最大、意思是、英语）；「翻译」变淡、记进最近翻过', async () => {
  const app = await openTranslate();
  const { page } = app;
  try {
    await page.waitForSelector(T('tr-tip'));
    // 空的时候只有一句淡淡的话（不提「翻过的句子」）
    const tip = await page.$eval(T('tr-tip'), (n) => n.textContent);
    assert.match(tip, /中文或越南语/);
    assert.doesNotMatch(tip, /翻过|记录|留在/);
    // 输入区在底栏上面，不重叠
    const geo = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="tr-dock"]').getBoundingClientRect();
      const b = document.querySelector('[data-testid="shell-tabbar"]').getBoundingClientRect();
      return { dockBottom: d.bottom, barTop: b.top, dockTop: d.top, h: innerHeight };
    });
    assert.ok(geo.dockBottom <= geo.barTop + 1, `输入区压在底栏上：${JSON.stringify(geo)}`);
    assert.ok(geo.dockTop > geo.h * 0.55, '输入区在屏幕下半（拇指够得着）');
    await shot(app, '02-空的');
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, '.tr-page');

    await typeIn(page, '不要香菜，我们不吃海鲜。');
    await page.waitForSelector(T('tr-result'), { timeout: 6000 });
    await waitResult(page, 'Không cho ngò nha');
    // 边打边翻的结果先不进最近翻过；「翻译」还能点
    assert.equal(await page.evaluate(() => localStorage.getItem('rs7885:translate:recent')), null);
    assert.equal(await page.$(T('tr-tip')), null, '有结果了：提示收起');
    assert.equal(await page.$eval(T('tr-go'), (n) => n.hasAttribute('data-off')), false);
    const sizes = await page.evaluate(() => ({
      vi: parseFloat(getComputedStyle(document.querySelector('[data-testid="tr-vi"]')).fontSize),
      en: parseFloat(getComputedStyle(document.querySelector('.tr-en__t')).fontSize),
      back: document.querySelector('[data-testid="tr-back"]').textContent,
    }));
    assert.ok(sizes.vi > sizes.en + 6, '越南语最大');
    assert.match(sizes.back, /意思是/);
    // 结果卡底边停在输入区上面（没被挡住；上面有常用语时要平滑滚一下）
    const fits = () => {
      const c = document.querySelector('[data-testid="tr-result"]').getBoundingClientRect().bottom;
      return c <= document.querySelector('[data-testid="tr-dock"]').getBoundingClientRect().top;
    };
    const ok = await page.waitForFunction(fits, { timeout: 3000 }).then(() => true, () => false);
    assert.ok(ok, '结果卡被输入区挡住');
    await page.$eval(T('tr-input'), (n) => n.blur());
    await shot(app, '03-有结果');

    await page.click(T('tr-go'));
    await app.idle();
    assert.equal(await page.$eval(T('tr-go'), (n) => n.hasAttribute('data-off')), true, '翻好了：「翻译」变淡');
    // 再写一句：上一句进了最近翻过（在「记录」里看；「翻译」里只有这一张结果卡）
    await page.click(T('tr-clear'));
    await typeIn(page, '请问你们几点关门？');
    await waitResult(page, 'mấy giờ đóng cửa');
    await page.$eval(T('tr-input'), (n) => n.blur());
    await app.idle();
    await assertNoRows(page, '「翻译」里不该有最近翻过');
    await toTab(app, 'rec');
    await page.waitForSelector(T('tr-recent'));
    const recent = await page.$$eval(`${T('tr-recent')} ${T('tr-row')}`, (n) => n.map((x) => x.textContent));
    assert.ok(recent[0].includes('几点关门'), `新的在上面：${recent.join(' | ')}`);
    assert.ok(recent.some((x) => x.includes('不要香菜')), recent.join(' | '));
    await shot(app, '04-最近翻过');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('收藏、复制、给对方看（从按钮长出全屏大字）、⇄ 对调、加称呼；刷新以后收藏和最近翻过还在', async () => {
  const app = await openTranslate();
  const { page } = app;
  try {
    await typeIn(page, '太贵了，便宜一点吧，两个三十万行不行？');
    await waitResult(page, 'Mắc quá');
    await page.click(T('tr-go'));
    await app.idle();
    // 收藏（收藏列表在「记录」里，「翻译」里看不到）
    await tap(page, T('tr-star'));
    await page.waitForSelector(`${T('tr-star')}[aria-pressed="true"]`);
    await assertNoRows(page, '收藏以后「翻译」里也不出现收藏列表');
    // 复制
    const ctx = page.browserContext();
    await ctx.overridePermissions(server.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
    await tap(page, T('tr-copy'));
    await page.waitForSelector(`${T('tr-copy')}[data-done]`);
    // 给对方看
    await tap(page, T('tr-show'));
    await page.waitForSelector(T('driver-card'));
    await sleep(140);
    await shot(app, '05-给对方看-长出来');
    await app.idle();
    const card = await page.evaluate(() => ({
      primary: document.querySelector('[data-testid="driver-primary"]').textContent,
      secondary: document.querySelector('[data-testid="driver-secondary"]')?.textContent || '',
      note: document.querySelector('[data-testid="driver-note"]')?.textContent || '',
      hash: location.hash,
    }));
    assert.match(card.primary, /Mắc quá/);
    assert.match(card.secondary, /too expensive/);
    assert.match(card.note, /太贵了/);
    assert.match(card.hash, /sheet=driver:tr\./);
    // 给对方看的全屏里只有这一句：没有收藏、最近翻过
    await assertNoRows(page, '「给对方看」时页面上不该有记录');
    assert.doesNotMatch(await page.$eval(T('driver-card'), (n) => n.textContent), /最近翻过|收藏/);
    await shot(app, '06-给对方看');
    await page.click(T('driver-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 5000 });
    await app.idle();

    // ⇄ 对调：越南语挪进输入框，回译现成就是中文结果
    await page.click(T('tr-swap'));
    await app.idle();
    const swapped = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="tr-input"]').value,
      zh: document.querySelector('[data-testid="tr-zh"]')?.textContent || '',
    }));
    assert.match(swapped.text, /Mắc quá/);
    assert.match(swapped.zh, /太贵了/);
    await shot(app, '07-对调');
    await page.click(T('tr-swap'));
    await app.idle();
    assert.match(await page.$eval(T('tr-input'), (n) => n.value), /太贵了/);

    // 加称呼：大哥 → 越南语句首 Anh ơi
    await page.click(T('tr-clear'));
    await page.select(T('tr-honor'), 'ge');
    await typeIn(page, '这个多少钱？');
    await waitResult(page, 'Anh ơi, cái này');
    await page.$eval(T('tr-input'), (n) => n.blur());
    await shot(app, '08-加称呼');

    // 刷新：收藏、最近翻过、称呼还在（存在这台手机里）；刷新以后停在「翻译」
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(T('tr-dock'), { timeout: 10000 });
    assert.equal(await tabNow(page), 'tr');
    assert.equal(await page.$eval(T('tr-honor'), (n) => n.value), 'ge');
    await toTab(app, 'rec');
    await page.waitForSelector(T('tr-saved'));
    await page.waitForSelector(T('tr-recent'));
    // 点开一条收藏：回到「翻译」，成了下面的结果卡，可以给对方看
    await tap(page, `${T('tr-saved')} ${T('tr-row')}`);
    await waitResult(page, 'Mắc quá');
    assert.equal(await tabNow(page), 'tr');
    assert.ok(await page.$(T('tr-show')));
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('对话（键盘方式，手机不能语音识别时）：第一次讲怎么用；我说 → 对方那半屏（转 180°）出越南语；对方说 → 胶囊照着出字、我这半屏出中文；退出', async () => {
  const app = await openTranslate({ init: NO_SPEECH });
  const { page } = app;
  try {
    await page.click(T('tr-talk'));
    await page.waitForSelector(T('converse'));
    await app.idle();
    await page.waitForSelector(T('cv-intro'));
    await shot(app, '09-对话-怎么用');
    await page.click(T('cv-intro-ok'));
    await app.idle();
    const rot = await page.$eval(T('cv-them'), (n) => getComputedStyle(n).transform);
    assert.notEqual(rot, 'none', '对方那半屏转过来了');
    await shot(app, '10-对话-打开');

    await page.click(T('cv-me-say'));
    await page.keyboard.type('我们两个人，有海边的位子吗？', { delay: 6 });
    await page.waitForFunction(() => document.querySelector('[data-testid="cv-them"]').textContent.includes('Tụi tôi hai người'), { timeout: 6000 });
    await page.click(T('cv-switch'));
    await app.idle();
    await page.waitForSelector(T('cv-listen'));
    await page.waitForSelector(T('cv-kbtip'));
    // 对方那头一行越南语：点键盘上的话筒说
    assert.match(await page.$eval(T('cv-listen-kb'), (n) => n.textContent), /micro/);
    await page.keyboard.type('Dạ, chờ em một chút nha.', { delay: 6 });
    await page.waitForFunction(() => document.querySelector('[data-testid="cv-me"]').textContent.includes('稍等我一下'), { timeout: 6000 });
    await shot(app, '11-对话-对方在说');
    await page.$eval(T('cv-input'), (n) => n.blur());
    await page.waitForSelector(T('cv-me-say'));
    await app.idle();
    await shot(app, '12-对话-一来一回');
    await page.click(T('cv-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="converse"]'), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('对话（直接听）：点「我说」「对方说」不弹键盘、直接听，说完自动翻；「打字」随时改成键盘；麦克风被拒退回打字', async () => {
  const app = await openTranslate({ init: FAKE_SPEECH });
  const { page } = app;
  try {
    await page.evaluate(() => localStorage.setItem('rs7885:translate:converse-intro', '1'));
    await page.click(T('tr-talk'));
    await page.waitForSelector(T('converse'));
    await app.idle();
    // 我说：直接听中文（不聚焦输入框），说完自动翻到对方那半屏
    await page.click(T('cv-me-say'));
    await page.waitForSelector(T('cv-voicetip'));
    assert.match(await page.$eval(T('cv-voicetip'), (n) => n.textContent), /在听中文/);
    assert.notEqual(await page.evaluate(() => document.activeElement?.dataset?.testid), 'cv-input', '直接听：不弹键盘');
    await page.waitForFunction(() => document.querySelector('[data-testid="cv-them"]').textContent.includes('Tụi tôi hai người'), { timeout: 6000 });
    await page.waitForSelector(T('cv-me-say'), { timeout: 6000 });
    // 对方说：听越南语，胶囊里照着出字，我这半屏出中文
    await page.click(T('cv-them-say'));
    await page.waitForSelector(T('cv-listen'));
    assert.match(await page.$eval(T('cv-voicetip'), (n) => n.textContent), /在听越南语/);
    assert.equal(await page.$(T('cv-listen-kb')), null, '直接听时不叫他点键盘');
    await sleep(200);
    await shot(app, '11b-对话-直接听');
    await page.waitForFunction(() => document.querySelector('[data-testid="cv-me"]').textContent.includes('稍等我一下'), { timeout: 6000 });
    assert.deepEqual(await page.evaluate(() => window.__recLangs), ['zh-CN', 'vi-VN']);
    // 「打字」：停下来改成键盘
    await page.waitForSelector(T('cv-me-say'), { timeout: 6000 });
    await page.click(T('cv-me-say'));
    await page.waitForSelector(T('cv-type'));
    await page.click(T('cv-type'));
    await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'cv-input', { timeout: 3000 });
    assert.equal(await page.$(T('cv-voicetip')), null);
    await page.$eval(T('cv-input'), (n) => n.blur());
    await page.waitForSelector(T('cv-me-say'), { timeout: 6000 });
    // 麦克风被拒：说一句、改成打字（点输入框弹键盘），这次打开里不再试
    await page.evaluate(() => { window.__recMode = 'deny'; });
    await page.click(T('cv-them-say'));
    await page.waitForSelector(T('cv-note'), { timeout: 3000 });
    assert.match(await page.$eval(T('cv-note'), (n) => n.textContent), /话筒用不了/);
    await page.focus(T('cv-input'));
    await page.keyboard.type('Cảm ơn nhiều', { delay: 6 });
    await page.waitForFunction(() => document.querySelector('[data-testid="cv-me"]').textContent.includes('演示模式'), { timeout: 6000 });
    await page.$eval(T('cv-input'), (n) => n.blur());
    await page.waitForSelector(T('cv-me-say'), { timeout: 6000 });
    await page.click(T('cv-me-say'));
    await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'cv-input', { timeout: 3000 });
    assert.equal(await page.$(T('cv-voicetip')), null, '拒绝过：直接走键盘');
    await page.$eval(T('cv-input'), (n) => n.blur());
    await page.click(T('cv-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="converse"]'), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「记录」里没收藏时列出这趟的常用语，点一行直接给对方看；贴士页「常用语」右边「去翻译」', async () => {
  const app = await openTranslate();
  const { page } = app;
  try {
    await assertNoRows(page, '「翻译」里不列常用语');
    await toTab(app, 'rec');
    await page.waitForSelector(T('tr-tips'));
    const rows = await page.$$eval(`${T('tr-tips')} ${T('tr-tip-row')}`, (n) => n.length);
    assert.ok(rows >= 1 && rows <= 4, `先露几条：${rows}`);
    // 还没翻过：没有「最近翻过」和「清空」，最下面一句淡淡的话
    assert.equal(await page.$(T('tr-recent')), null);
    assert.equal(await page.$(T('tr-clear-all')), null);
    assert.match(await page.$eval(T('tr-rec-empty'), (n) => n.textContent), /翻过的句子/);
    await shot(app, '20-记录-空');
    await tap(page, `${T('tr-tips')} ${T('tr-tip-row')}`);
    await page.waitForSelector(T('driver-card'));
    await app.idle();
    assert.ok((await page.$eval(T('driver-primary'), (n) => n.textContent)).trim().length > 0);
    await page.click(T('driver-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="driver-card"]'), { timeout: 5000 });
    // 顶栏一直是胶囊（没有停在半淡的大标题）
    assert.ok(await page.$('[data-testid="shell-head-hidden"]'), '这一页不画大标题');
    await app.go('#/t/demo-island/tips');
    await page.waitForSelector(T('tips-translate'), { timeout: 8000 });
    await page.click(T('tips-translate'));
    await page.waitForSelector(T('tr-dock'), { timeout: 8000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('小屏、打字时能看见的地方不够：结果卡收紧，「给对方看」和越南语一直看得见（不被分栏挡住）；「最近翻过」的数字对得上', async () => {
  const app = await openTranslate({ device: 'small' });
  const { page } = app;
  try {
    await typeIn(page, '可以帮我们拍张照吗？把后面的海也拍进去。');
    await waitResult(page, 'Chụp giùm');
    await page.waitForSelector(`${T('tr-result')}[data-compact]`, { timeout: 3000 });
    // 收紧以后平滑滚到位
    await page.waitForFunction(() => {
      const show = document.querySelector('[data-testid="tr-show"]')?.getBoundingClientRect();
      return show && show.bottom <= document.querySelector('[data-testid="tr-dock"]').getBoundingClientRect().top;
    }, { timeout: 3000 }).catch(() => {});
    const g = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="tr-result"]');
      const show = document.querySelector('[data-testid="tr-show"]').getBoundingClientRect();
      const dock = document.querySelector('[data-testid="tr-dock"]').getBoundingClientRect();
      const en = document.querySelector('.tr-en');
      return { compact: card.hasAttribute('data-compact'), showBottom: show.bottom, showTop: show.top, dockTop: dock.top, enShown: Boolean(en && en.getClientRects().length) };
    });
    assert.ok(g.compact, '收紧了');
    assert.ok(!g.enShown, '英语先收起');
    assert.ok(g.showTop > 60 && g.showBottom <= g.dockTop, `「给对方看」被挡住：${JSON.stringify(g)}`);
    const tabsBottom = await page.$eval(T('tr-tabs'), (n) => n.getBoundingClientRect().bottom);
    assert.ok(g.showTop >= tabsBottom - 1, `「给对方看」钻到分栏下面了：${g.showTop} < ${tabsBottom}`);
    await shot(app, '14b-小屏-打字时');
    // 收起键盘：完整的卡
    await page.$eval(T('tr-input'), (n) => n.blur());
    await app.idle();
    assert.equal(await page.$eval(T('tr-result'), (n) => n.hasAttribute('data-compact')), false);
    // 底部那行的「复制」写清楚复制什么
    assert.match(await page.$eval(T('tr-copy'), (n) => n.textContent), /复制越南语/);
    // 再翻一句：两句都进了最近翻过（「记录」里列全，计数对得上）
    await page.click(T('tr-go'));
    await page.click(T('tr-clear'));
    await typeIn(page, '请问你们几点关门？');
    await waitResult(page, 'mấy giờ đóng cửa');
    await page.$eval(T('tr-input'), (n) => n.blur());
    await toTab(app, 'rec');
    await page.waitForSelector(T('tr-recent'));
    const c = await page.evaluate(() => ({
      count: document.querySelector('[data-testid="tr-recent"]').closest('section').querySelector('.k-sec__count')?.textContent.trim(),
      rows: document.querySelectorAll('[data-testid="tr-recent"] [data-testid="tr-row"]').length,
    }));
    assert.equal(String(c.rows), c.count, JSON.stringify(c));
    assert.equal(c.rows, 2, JSON.stringify(c));
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, '.tr-page');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('真接口的请求格式（拦下来返回假的）：进页面先预热；text/plain、token 和行程放 body；bad_token 换 token 重试', async () => {
  const app = await openTranslate({ intercept: false, search: { trhttp: '1' } });
  const { page } = app;
  const bodies = [];
  let mode = 'ok';
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith(server.origin) || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
      if (url === TRANSLATE_URL && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        bodies.push({ body, type: req.headers()['content-type'], auth: req.headers().authorization });
        const cors = { 'Access-Control-Allow-Origin': server.origin, Vary: 'Origin' };
        if (mode === 'down') return req.abort('connectionrefused');
        if (mode === 'badtoken' && bodies.filter((b) => !b.body.warm).length === 1 && !body.warm) {
          return req.respond({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'bad_token', error: '登录过期了' }) });
        }
        const out = body.warm ? { ok: true, warm: true } : { ok: true, src: 'zh', vi: 'Xin chào (mock)', en: 'Hello (mock)', back: '你好', zh: '', model: 'hy3' };
        return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(out) });
      }
      return req.abort('blockedbyclient');
    });
    // 预热：重新进页面会发一次（4 分钟内只发一次，这里是新打开的页面）
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(T('tr-dock'), { timeout: 10000 });
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && !bodies.some((b) => b.body.warm); i += 1) await sleep(50);
    const warm = bodies.find((b) => b.body.warm);
    assert.ok(warm, '进页面先预热');
    assert.equal(warm.body.trip, 'demo-island');
    assert.ok(warm.body.token, 'token 在 body 里');
    assert.match(warm.type, /^text\/plain/);
    assert.equal(warm.auth, undefined, '不用 Authorization 头（免预检）');

    mode = 'badtoken';
    await typeIn(page, '你好');
    await page.click(T('tr-go'));
    await waitResult(page, 'Xin chào (mock)');
    const sent = bodies.filter((b) => !b.body.warm);
    assert.equal(sent.length, 2, 'bad_token 以后换 token 悄悄再试一次');
    assert.deepEqual(Object.keys(sent[0].body).sort(), ['text', 'token', 'trip']);
    assert.equal(sent[0].body.text, '你好');
    assert.equal(sent[0].body.trip, 'demo-island');
    assert.equal(await page.$(T('tr-msg')), null);

    // 接口连不上（还没上线 / 服务挂了）：一句话说清楚；收藏照样能点
    await tap(page, T('tr-star'));
    mode = 'down';
    await page.click(T('tr-clear'));
    await typeIn(page, '请问夜市怎么走？');
    await page.click(T('tr-go'));
    await page.waitForSelector(T('tr-msg'), { timeout: 8000 });
    const msg = await page.$eval(T('tr-msg'), (n) => n.textContent);
    assert.match(msg, /暂时连不上|没连上网/);
    await page.$eval(T('tr-input'), (n) => n.blur());
    await shot(app, '13-接口连不上');
    await toTab(app, 'rec');
    await tap(page, `${T('tr-saved')} ${T('tr-row')}`);
    await waitResult(page, 'Xin chào (mock)');
    assert.equal(await tabNow(page), 'tr');
    const errs = app.errors.filter((e) => !/translate-web|Failed to load resource|ERR_CONNECTION_REFUSED/.test(e));
    assert.deepEqual(errs, []);
  } finally {
    await app.close();
  }
});

test('分栏：默认在「翻译」，「翻译」里一行记录都没有（句子不在页面上）；tablist 语义、方向键能切；「记录」里输入区收起', async () => {
  const app = await openSeeded();
  const { page } = app;
  try {
    const a11y = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]');
      const p = document.querySelector('[role="tabpanel"]');
      return {
        label: list.getAttribute('aria-label'),
        tabs: [...list.querySelectorAll('[role="tab"]')].map((t) => [t.textContent.trim(), t.getAttribute('aria-selected'), t.tabIndex, t.getAttribute('aria-controls')]),
        panel: p && [p.id, p.getAttribute('aria-labelledby')],
      };
    });
    assert.ok(a11y.label, '分栏有读屏用的名字');
    assert.deepEqual(a11y.tabs, [['翻译', 'true', 0, 'tr-panel-tr'], ['记录', 'false', -1, 'tr-panel-rec']]);
    assert.deepEqual(a11y.panel, ['tr-panel-tr', 'tr-tab-tr']);
    // 本机有收藏、有最近翻过，「翻译」里也一个字都不露（拿手机给对方看时对方看不到）
    await assertNoRows(page, '默认的「翻译」里不该有列表');
    const text = await page.$eval(T('page-translate'), (n) => n.innerText);
    for (const t of SEEDED) assert.ok(!text.includes(t), `「翻译」里露出了翻过的句子：${t}`);
    await page.waitForSelector(T('tr-tip'));
    // 分栏吸顶：在顶栏下面
    const geo = await page.evaluate(() => ({
      tabs: document.querySelector('[data-testid="tr-tabs"]').getBoundingClientRect().top,
      pos: getComputedStyle(document.querySelector('.tr-tabbar')).position,
    }));
    assert.equal(geo.pos, 'sticky');
    assert.ok(geo.tabs > 40 && geo.tabs < 160, `分栏在顶栏下面：${geo.tabs}`);
    await assertTapTargetsIn(page, '.tr-tabbar');
    await shot(app, '17-翻译-空');

    // 键盘：→ 换到「记录」（焦点跟过去），← 回来
    await page.focus('#tr-tab-tr');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector(T('tr-records'));
    await app.idle();
    assert.equal(await tabNow(page), 'rec');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tr-tab-rec');
    assert.deepEqual(await page.$eval('[role="tabpanel"]', (p) => [p.id, p.getAttribute('aria-labelledby')]), ['tr-panel-rec', 'tr-tab-rec']);
    // 输入区收起：看不见、点不到、读屏读不到
    const dock = await page.$eval(T('tr-dock'), (n) => ({ inert: n.inert, vis: getComputedStyle(n).visibility, op: getComputedStyle(n).opacity }));
    assert.deepEqual(dock, { inert: true, vis: 'hidden', op: '0' });
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector(T('tr-feed'));
    await app.idle();
    assert.equal(await tabNow(page), 'tr');
    assert.equal(await page.$eval(T('tr-dock'), (n) => n.inert), false);
    assert.equal(await page.$eval(T('tr-dock'), (n) => getComputedStyle(n).visibility), 'visible');
    await assertNoRows(page, '回到「翻译」：列表收走');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「记录」：收藏和最近翻过都在（新的在上）；点一条回到「翻译」显示它；「对话」全屏里也没有记录', async () => {
  const app = await openSeeded();
  const { page } = app;
  try {
    await toTab(app, 'rec');
    const saved = await page.$$eval(`${T('tr-saved')} ${T('tr-row')}`, (n) => n.map((x) => x.textContent));
    assert.equal(saved.length, 1);
    assert.match(saved[0], /我对花生过敏/);
    assert.equal(await page.$(T('tr-tips')), null, '有收藏就不列常用语');
    const recent = await page.$$eval(`${T('tr-recent')} ${T('tr-row')}`, (n) => n.map((x) => x.textContent));
    assert.equal(recent.length, 3);
    assert.match(recent[0], /几点关门/, '新的在上面');
    assert.match(recent[2], /chờ em/);
    assert.ok(await page.$(T('tr-clear-all')));
    await assertNoHorizontalOverflow(page);
    await assertTapTargetsIn(page, '.tr-page');
    await shot(app, '19-记录');

    // 点一条：回到「翻译」，成了结果卡；列表收走；焦点落在「翻译」标签上
    await tap(page, `${T('tr-recent')} ${T('tr-row')}`);
    await waitResult(page, 'mấy giờ đóng cửa');
    assert.equal(await tabNow(page), 'tr');
    assert.equal(await page.$eval(T('tr-input'), (n) => n.value), '请问你们几点关门？');
    await assertNoRows(page, '回到「翻译」不带列表');
    await page.waitForFunction(() => document.activeElement?.id === 'tr-tab-tr', { timeout: 2000 });
    const fits = await page.waitForFunction(() => {
      const c = document.querySelector('[data-testid="tr-result"]').getBoundingClientRect();
      return c.bottom <= document.querySelector('[data-testid="tr-dock"]').getBoundingClientRect().top
        && c.top >= document.querySelector('[data-testid="tr-tabs"]').getBoundingClientRect().bottom;
    }, { timeout: 3000 }).then(() => true, () => false);
    assert.ok(fits, '结果卡在分栏和输入区之间');
    await shot(app, '18-翻译-点开一条');

    // 对话：全屏里没有收藏、最近翻过
    await page.evaluate(() => localStorage.setItem('rs7885:translate:converse-intro', '1'));
    await page.click(T('tr-talk'));
    await page.waitForSelector(T('converse'));
    await app.idle();
    const cv = await page.$eval(T('converse'), (n) => n.innerText);
    for (const t of ['我对花生过敏', '不要香菜', 'chờ em một chút']) assert.ok(!cv.includes(t), `对话里露出了记录：${t}`);
    assert.equal((await page.$$(`${T('converse')} ${T('tr-row')}`)).length, 0);
    await page.click(T('cv-close'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="converse"]'), { timeout: 5000 });
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('「清空」：先问一句；取消什么都不动；确定只清最近翻过，收藏还在；「翻译」里正在显示的那句也收起', async () => {
  const app = await openSeeded();
  const { page } = app;
  try {
    // 先点开一条最近翻过（「翻译」里显示它），再回「记录」清空
    await toTab(app, 'rec');
    await tap(page, `${T('tr-recent')} ${T('tr-row')}`);
    await waitResult(page, 'mấy giờ đóng cửa');
    await toTab(app, 'rec');
    await tap(page, T('tr-clear-all'));
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 5000 });
    const ask = await page.$eval('[role="alertdialog"], [role="dialog"]', (el) => el.textContent);
    assert.match(ask, /清空最近翻过/);
    assert.match(ask, /3 句/);
    assert.match(ask, /收藏的不动/);
    await sleep(300);
    await shot(app, '21-清空-先问');
    // 取消：什么都不动
    await page.click(T('dialog-cancel'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="dialog-cancel"]'), { timeout: 5000 });
    await app.idle();
    assert.equal((await page.$$(`${T('tr-recent')} ${T('tr-row')}`)).length, 3);
    // 确定：最近翻过没了，收藏还在
    await tap(page, T('tr-clear-all'));
    await page.waitForSelector(T('dialog-confirm'), { visible: true, timeout: 5000 });
    await page.click(T('dialog-confirm'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="tr-recent"]'), { timeout: 5000 });
    await app.idle();
    assert.equal((await page.$$(`${T('tr-saved')} ${T('tr-row')}`)).length, 1, '收藏不动');
    assert.equal(await page.$(T('tr-clear-all')), null);
    assert.ok(await page.$(T('tr-rec-empty')));
    const kept = await page.evaluate(() => ({
      recent: localStorage.getItem('rs7885:translate:recent'),
      star: JSON.parse(localStorage.getItem('rs7885:translate:star') || '[]').length,
    }));
    assert.deepEqual(kept, { recent: null, star: 1 });
    // 回到「翻译」：刚才显示的那句（已经删了）也收起
    await toTab(app, 'tr');
    assert.equal(await page.$eval(T('tr-input'), (n) => n.value), '');
    assert.equal(await page.$(T('tr-result')), null);
    await page.waitForSelector(T('tr-tip'));
    // 刷新以后也还是空的
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(T('tr-dock'), { timeout: 10000 });
    await toTab(app, 'rec');
    assert.equal(await page.$(T('tr-recent')), null);
    assert.equal((await page.$$(`${T('tr-saved')} ${T('tr-row')}`)).length, 1);
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('每次进来都停在「翻译」：在「记录」离开再回来、回到后台、刷新，都回到「翻译」', async () => {
  const app = await openSeeded();
  const { page } = app;
  try {
    // 离开这一页再回来
    await toTab(app, 'rec');
    await app.go('#/t/demo-island');
    await page.waitForFunction(() => !document.querySelector('[data-testid="page-translate"]'), { timeout: 8000 });
    await app.go('#/t/demo-island/translate');
    await page.waitForSelector(T('tr-dock'), { timeout: 8000 });
    await app.idle();
    assert.equal(await tabNow(page), 'tr');
    await assertNoRows(page, '回来停在「翻译」，不带列表');
    // 浏览器返回键回来也一样
    await toTab(app, 'rec');
    await app.go('#/t/demo-island/tips');
    await page.waitForFunction(() => !document.querySelector('[data-testid="page-translate"]'), { timeout: 8000 });
    await page.goBack();
    await page.waitForSelector(T('tr-dock'), { timeout: 8000 });
    await app.idle();
    assert.equal(await tabNow(page), 'tr');
    await assertNoRows(page, '返回键回来停在「翻译」');
    // 切到后台（锁屏、换别的 app）再回来
    await toTab(app, 'rec');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForSelector(T('tr-feed'), { timeout: 3000 });
    await app.idle();
    assert.equal(await tabNow(page), 'tr');
    await assertNoRows(page, '回到前台停在「翻译」');
    // 刷新
    await toTab(app, 'rec');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(T('tr-dock'), { timeout: 10000 });
    await app.idle();
    assert.equal(await tabNow(page), 'tr');
    await assertNoRows(page, '刷新以后停在「翻译」');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('减少动态效果：换栏照样能用，输入区只淡出、不位移', async () => {
  const app = await openSeeded({ reducedMotion: true });
  const { page } = app;
  try {
    await toTab(app, 'rec');
    const away = await page.$eval(T('tr-dock'), (n) => ({ tr: getComputedStyle(n).translate, vis: getComputedStyle(n).visibility }));
    assert.deepEqual(away, { tr: 'none', vis: 'hidden' });
    assert.equal(await page.$eval(T('tr-records'), (n) => getComputedStyle(n).transform), 'none', '面板停稳了');
    await toTab(app, 'tr');
    assert.equal(await page.$eval(T('tr-dock'), (n) => getComputedStyle(n).visibility), 'visible');
    app.assertClean();
  } finally {
    await app.close();
  }
});

test('375 小屏 / 桌面 / 深色：两栏都不横向滚动，截图', async () => {
  for (const [o, name] of [
    [{ device: 'small' }, '14-小屏375'],
    [{ colorScheme: 'dark' }, '15-深色'],
    [{ device: 'desktop' }, '16-桌面'],
  ]) {
    const app = await openSeeded(o);
    const { page } = app;
    try {
      await typeIn(page, '可以帮我们拍张照吗？把后面的海也拍进去。');
      await waitResult(page, 'Chụp giùm');
      await page.$eval(T('tr-input'), (n) => n.blur());
      await app.idle();
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, '.tr-page');
      await shot(app, name);
      await toTab(app, 'rec');
      await page.waitForSelector(T('tr-saved'));
      await assertNoHorizontalOverflow(page);
      await assertTapTargetsIn(page, '.tr-page');
      await shot(app, `${name}-记录`);
      app.assertClean();
    } finally {
      await app.close();
    }
  }
});
