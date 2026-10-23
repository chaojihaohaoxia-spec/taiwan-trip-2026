// 翻译（pages/translate、lib/translate、sheets/converse、给对方看 tr.<id>）的纯逻辑：
//   文字规则（同一句、方向、还在打拼音、写完了、称呼、外文、结果整理、哪趟行程要翻译）；
//   本机存的句子（最近翻过 30 条去重、收藏 50 条挤掉最早的、按 id 找、peek 的先后、称呼）；
//   接口客户端（text/plain + token 放 body、行程 id、预热 4 分钟一次、bad_token 换 token 重试、网络断了重试一次、没网不发、
//     没接上 / 404、限频（自动的少用名额）、429、超时、以最后一次为准）；演示接口；
//   页面的状态机（边打边翻的停顿、拼音不翻、同一句不重发、「翻译」变淡、什么时候记进最近翻过、上一句、⇄ 对调和还原、称呼、
//     翻过的直接拿出来、限频悄悄补发、失败的说法、语言栏自动翻过来只提示一次）；
//   对话模式两半屏各显示什么；「给对方看」一句翻译；路由、外框、CSP、配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyOf, dirOf, composing, finished, withHonor, foreign, shape, translateLang, HONORS, MAX_CHARS, outputOf,
} from '../../src/lib/translate/text.js';
import { createPhraseStore, RECENT_KEEP, STAR_KEEP } from '../../src/lib/translate/store.js';
import { createTranslateClient, createLimiter, codeOfResponse, MSG, WARM_GAP, LIMITS } from '../../src/lib/translate/client.js';
import { createDemoFetch, demoTranslate } from '../../src/lib/translate/demo.js';
import { createTranslateController, viewOf, staleOf, clearMsgOf, TABS, TIMING, L } from '../../src/pages/translate/controller.js';
import { rowsOf, tail, CL } from '../../src/sheets/converse/model.js';
import { canListen, listen, resetListen } from '../../src/lib/translate/listen.js';
import { translationCard, isTranslationArg } from '../../src/sheets/driver/translation.js';
import { routes } from '../../src/router/routes.js';
import { chromeKind, SECTION_TITLES } from '../../src/shell/rules.js';
import { TRANSLATE_URL } from '../../src/data/config.js';
import { CSP_SOURCES, TRANSLATE_ORIGIN } from '../../scripts/lib/csp.mjs';

// ---------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------

function memStorage() {
  const m = new Map();
  return {
    get: (k, f = null) => (m.has(k) ? m.get(k) : f),
    set: (k, v) => { m.set(k, String(v)); return true; },
    remove: (k) => m.delete(k),
    getJSON(k, f = null) { const v = this.get(k, null); if (v === null) return f; try { return JSON.parse(v); } catch { return f; } },
    setJSON(k, v) { return this.set(k, JSON.stringify(v)); },
    _m: m,
  };
}

/** 假时钟 + 假定时器：advance(ms) 按时间顺序执行到期的回调，每一步之后把 Promise 都跑完 */
function fakeTimers() {
  let t = 0;
  let id = 0;
  const q = new Map();
  const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  return {
    now: () => t,
    setTimeout: (fn, ms) => { id += 1; q.set(id, { at: t + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (x) => { q.delete(x); },
    async advance(ms) {
      const end = t + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const [k, v] of q) if (v.at <= end && (!next || v.at < next[1].at)) next = [k, v];
        if (!next) break;
        q.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
    flush,
    pending: () => q.size,
  };
}

/** 假客户端：每次 run 记下来，结果由测试决定（resolve / reject） */
function fakeClient() {
  const calls = [];
  const client = {
    calls,
    runner() {
      let seq = 0;
      return {
        run(input, opts) {
          const my = ++seq;
          let resolve;
          let reject;
          const p = new Promise((a, b) => { resolve = a; reject = b; });
          calls.push({ input, opts, resolve, reject, get stale() { return my !== seq; } });
          return p.then((r) => { if (my !== seq) { const e = new Error(''); e.code = 'stale'; throw e; } return r; },
            (e) => { if (my !== seq) { const s = new Error(''); s.code = 'stale'; throw s; } throw e; });
        },
        cancel() { seq += 1; },
      };
    },
  };
  return client;
}

const OUT = (input, vi = `VI(${input})`) => ({ dir: 'out', input, vi, en: `EN(${input})`, zh: '', back: `回译(${input})`, demo: false });
const IN = (input, zh = `中文(${input})`) => ({ dir: 'in', input, vi: '', en: '', zh, back: '', demo: false });

function setup() {
  const timers = fakeTimers();
  const client = fakeClient();
  const phrases = createPhraseStore({ storage: memStorage(), now: () => 1_700_000_000_000 + timers.now() });
  const shown = [];
  let comp = false;
  const ctl = createTranslateController({ client, phrases, timers, isComposing: () => comp, onShown: (r, o) => shown.push({ r, o }) });
  return { timers, client, phrases, ctl, shown, setComposing: (v) => { comp = v; } };
}

// ---------------------------------------------------------------------
// 文字规则
// ---------------------------------------------------------------------

test('同一句：空白、句末的句号 / 感叹号 / 逗号不算，问号算，不分大小写', () => {
  assert.equal(keyOf(' 请问 夜市怎么走 '), keyOf('请问 夜市怎么走'));
  assert.equal(keyOf('不要香菜'), keyOf('不要香菜。'));
  assert.equal(keyOf('不要香菜'), keyOf('不要香菜！！'));
  assert.notEqual(keyOf('可以'), keyOf('可以？'));
  assert.equal(keyOf('Hello World.'), keyOf('hello world'));
  assert.equal(keyOf(''), '');
});

test('方向：中文翻出去，越南语、英语翻进来；夹着英文名的中文还是中文', () => {
  assert.equal(dirOf('请问夜市怎么走？'), 'out');
  assert.equal(dirOf('去 JW Marriott 大堂'), 'out');
  assert.equal(dirOf('Anh ơi, tới rồi nha.'), 'in');
  assert.equal(dirOf('Sorry, we are fully booked.'), 'in');
  assert.equal(dirOf('Phở 好吃'), 'out');
});

test('还在打拼音：汉字后面跟着小写字母不翻；英文名有大写、越南语方向的几个小写字母照翻', () => {
  assert.equal(composing('请问夜市zen'), true);
  assert.equal(composing('好的，xie'), true);
  assert.equal(composing("请问xi'an"), true);
  assert.equal(composing('请问ye shi'), true);
  assert.equal(composing('qing'), true);
  assert.equal(composing('qing', undefined, 'in'), false);
  assert.equal(composing('去 JW Marriott'), false);
  assert.equal(composing('请问夜市怎么走'), false);
  // 光标在中间：只看光标前面
  assert.equal(composing('请问zen夜市', 4), true);
});

test('写完了：句末有标点', () => {
  assert.equal(finished('不要香菜。'), true);
  assert.equal(finished('多少钱？'), true);
  assert.equal(finished('How much?'), true);
  assert.equal(finished('不要香菜'), false);
});

test('称呼：中文、开头没有称呼才拼「大哥，」；外文不拼', () => {
  assert.equal(withHonor('这个多少钱？', 'ge'), '大哥，这个多少钱？');
  assert.equal(withHonor('师傅，去这个地址', 'ge'), '师傅，去这个地址');
  assert.equal(withHonor('Cái này bao nhiêu?', 'ge'), 'Cái này bao nhiêu?');
  assert.equal(withHonor('这个多少钱？', ''), '这个多少钱？');
  assert.equal(withHonor('这个多少钱？', 'nope'), '这个多少钱？');
  assert.deepEqual(HONORS.map((h) => h.id), ['', 'ge', 'jie', 'em', 'co', 'chu']);
});

test('外文（粘贴提示）：越南语、几个英文词；中文、网址、太长的不算', () => {
  assert.equal(foreign('Dạ, chờ em một chút nha.'), true);
  assert.equal(foreign('fully booked tonight'), true);
  assert.equal(foreign('请问'), false);
  assert.equal(foreign('https://example.com/a b'), false);
  assert.equal(foreign('ok'), false);
  assert.equal(foreign('a b '.repeat(200)), false);
});

test('接口返回 → 结果：中文进来给越南语、英语、回译；外文进来给中文', () => {
  assert.deepEqual(shape({ src: 'zh', vi: ' Xin chào ', en: 'Hi', back: '你好', zh: '' }, ' 你好 '),
    { dir: 'out', input: '你好', vi: 'Xin chào', en: 'Hi', zh: '', back: '你好', demo: false });
  assert.deepEqual(shape({ src: 'vi', zh: '到了', vi: '', en: '' }, 'Tới rồi'),
    { dir: 'in', input: 'Tới rồi', vi: '', en: '', zh: '到了', back: '', demo: false });
  assert.equal(outputOf({ dir: 'in', zh: '到了' }), '到了');
  assert.equal(outputOf({ dir: 'out', vi: 'Xin' }), 'Xin');
});

test('哪趟行程要翻译：越南盾或越南时区才有（台湾那趟没有）', () => {
  assert.equal(translateLang({ local_currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' }), 'vi');
  assert.equal(translateLang({ local_currency: null, timezone: 'Asia/Saigon' }), 'vi');
  assert.equal(translateLang({ local_currency: 'TWD', timezone: 'Asia/Taipei' }), null);
  assert.equal(translateLang({ local_currency: 'HKD', timezone: null }), null);
  assert.equal(translateLang(null), null);
});

// ---------------------------------------------------------------------
// 本机存的句子
// ---------------------------------------------------------------------

test('最近翻过：同一句只留最新的一条、排最前；最多 30 条；按 id 删', () => {
  let t = 0;
  const s = createPhraseStore({ storage: memStorage(), now: () => ++t });
  const a = s.save('不要香菜', OUT('不要香菜'));
  s.save('这个多少钱？', OUT('这个多少钱？'));
  const a2 = s.save('不要香菜。', OUT('不要香菜。'));
  assert.equal(s.list().length, 2);
  assert.equal(s.list()[0].id, a2.id);
  assert.notEqual(a.id, a2.id);
  for (let i = 0; i < 40; i += 1) s.save(`第${i}句`, OUT(`第${i}句`));
  assert.equal(s.list().length, RECENT_KEEP);
  const v0 = s.version.value;
  s.remove(s.list()[0].id);
  assert.equal(s.list().length, RECENT_KEEP - 1);
  assert.ok(s.version.value > v0, '删了要通知页面重画');
});

test('收藏：整条存（没网也能给对方看）；满 50 条挤掉最早的并告诉页面；按 id 或原句取消；get 两边都找', () => {
  let t = 0;
  const s = createPhraseStore({ storage: memStorage(), now: () => ++t });
  const r = s.star(OUT('不要香菜'));
  assert.equal(r.dropped, false);
  assert.equal(s.starred('不要香菜。').vi, 'VI(不要香菜)');
  assert.equal(s.get(r.row.id).input, '不要香菜');
  for (let i = 0; i < STAR_KEEP - 1; i += 1) s.star(OUT(`句子${i}`));
  assert.equal(s.stars().length, STAR_KEEP);
  assert.equal(s.star(OUT('再来一句')).dropped, true);
  assert.equal(s.stars().length, STAR_KEEP);
  assert.equal(s.starred('不要香菜'), null, '最早的那条被挤掉');
  s.unstar('再来一句');
  assert.equal(s.starred('再来一句'), null);
  const keep = s.stars()[0];
  s.unstar(keep.id);
  assert.equal(s.get(keep.id), null);
});

test('翻过的同一句：收藏 → 最近翻过 → 这次打开记着的', () => {
  const s = createPhraseStore({ storage: memStorage() });
  s.remember('你好', { ...OUT('你好', 'memo') });
  assert.equal(s.peek('你好').vi, 'memo');
  s.save('你好', OUT('你好', 'recent'));
  assert.equal(s.peek('你好。').vi, 'recent');
  s.star(OUT('你好', 'star'));
  assert.equal(s.peek('你好').vi, 'star');
  assert.equal(s.peek(''), null);
});

test('清空最近翻过：全删、通知页面重画、返回删了几条；收藏不动；本来就空不重画', () => {
  const st = memStorage();
  const s = createPhraseStore({ storage: st });
  s.save('不要香菜', OUT('不要香菜'));
  s.save('这个多少钱？', OUT('这个多少钱？'));
  s.star(OUT('不要香菜'));
  const v0 = s.version.value;
  assert.equal(s.clearRecent(), 2);
  assert.deepEqual(s.list(), []);
  assert.equal(st._m.has('translate:recent'), false, '键也删掉');
  assert.ok(s.version.value > v0);
  assert.equal(s.stars().length, 1, '收藏不动');
  assert.equal(s.peek('不要香菜').vi, 'VI(不要香菜)', '收藏的照样直接拿出来');
  const v1 = s.version.value;
  assert.equal(s.clearRecent(), 0);
  assert.equal(s.version.value, v1);
});

test('称呼记在本机；不认识的当「不称呼」；坏掉的存储不报错', () => {
  const st = memStorage();
  const s = createPhraseStore({ storage: st });
  assert.equal(s.honor(), '');
  assert.equal(s.setHonor('jie'), 'jie');
  assert.equal(createPhraseStore({ storage: st }).honor(), 'jie');
  assert.equal(s.setHonor('???'), '');
  st.set('translate:recent', '{坏的');
  assert.deepEqual(s.list(), []);
  st.setJSON('translate:star', [{ id: 's1', input: 'ok', vi: 'x' }, null, { id: '', input: 'x' }, 'str']);
  assert.equal(s.stars().length, 1);
});

// ---------------------------------------------------------------------
// 接口客户端
// ---------------------------------------------------------------------

function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const r = await handler(body, calls.length, init);
    if (r instanceof Error) throw r;
    return { status: r[0], json: async () => r[1] };
  };
  f.calls = calls;
  return f;
}
const OK = (extra = {}) => [200, { ok: true, src: 'zh', vi: 'Xin chào', en: 'Hello', back: '你好', zh: '', ...extra }];

test('请求格式：POST text/plain（不发预检）、token 放 body、带行程 id、不带 cookie；返回整理好的结果', async () => {
  const f = mockFetch(() => OK());
  const c = createTranslateClient({ url: 'https://x.test/translate-web', fetch: f, getToken: async () => 'tok-1', online: () => true });
  const r = await c.translate(' 你好 ', { trip: 'phuquoc2026' });
  assert.deepEqual(r, { dir: 'out', input: '你好', vi: 'Xin chào', en: 'Hello', zh: '', back: '你好', demo: false });
  const { url, init, body } = f.calls[0];
  assert.equal(url, 'https://x.test/translate-web');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers.Authorization, undefined);
  assert.deepEqual(body, { text: '你好', trip: 'phuquoc2026', token: 'tok-1' });
  // 批 A：多语言只留通路——给了 lang 就带上（给司机看「让 AI 翻一下」按档案的语言）
  await c.translate('椰影咖啡', { trip: 'phuquoc2026', lang: 'vi' });
  assert.equal(f.calls[1].body.lang, 'vi');
});

test('预热：带 warm 和行程、4 分钟内只发一次；刚翻成过也算热；没认成下次再试', async () => {
  let t = 0;
  const f = mockFetch((b) => (b.warm ? [200, { ok: true, warm: true }] : OK()));
  const c = createTranslateClient({ url: 'u', fetch: f, getToken: async () => 'tok', online: () => true, now: () => t });
  assert.equal(c.warm({ trip: 'a' }), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(f.calls[0].body, { warm: true, trip: 'a', token: 'tok' });
  t += WARM_GAP - 1;
  assert.equal(c.warm({ trip: 'a' }), false);
  t += 1;
  await c.translate('你好');
  assert.equal(c.warm({}), false, '刚翻成过：不用预热');
  // 没登录：预热失败，下次照样再试
  const c2 = createTranslateClient({ url: 'u', fetch: f, getToken: async () => null, online: () => true, now: () => 0 });
  assert.equal(c2.warm(), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c2.warm(), true);
});

test('bad_token：换新 token 悄悄再试一次；还不行才说登录过期', async () => {
  const tokens = [];
  const f = mockFetch((b) => (b.token === 'new' ? OK() : [401, { ok: false, code: 'bad_token' }]));
  const c = createTranslateClient({ url: 'u', fetch: f, online: () => true, getToken: async (o) => { tokens.push(o.refresh); return o.refresh ? 'new' : 'old'; } });
  const r = await c.translate('你好');
  assert.equal(r.vi, 'Xin chào');
  assert.deepEqual(tokens, [false, true]);
  const f2 = mockFetch(() => [401, { ok: false, code: 'bad_token' }]);
  const c2 = createTranslateClient({ url: 'u', fetch: f2, online: () => true, getToken: async () => 'x' });
  await assert.rejects(c2.translate('你好'), (e) => e.code === 'bad_token' && e.message === MSG.bad_token);
  assert.equal(f2.calls.length, 2);
});

test('没登录、不是成员、没接上、404、服务端限频 / 额度：各说各的', async () => {
  const mk = (h, o = {}) => createTranslateClient({ url: 'u', fetch: mockFetch(h), online: () => true, getToken: async () => 'tok', ...o });
  await assert.rejects(mk(() => OK(), { getToken: async () => null }).translate('你好'), { code: 'no_token' });
  await assert.rejects(mk(() => [403, { ok: false, code: 'not_member' }]).translate('你好'), { code: 'not_member', message: MSG.not_member });
  await assert.rejects(createTranslateClient({ url: null }).translate('你好'), { code: 'not_ready' });
  await assert.rejects(mk(() => [404, null]).translate('你好'), { code: 'not_ready' });
  await assert.rejects(mk(() => [429, { ok: false, code: 'rate' }]).translate('你好'), (e) => e.code === 'rate' && e.wait > 0);
  await assert.rejects(mk(() => [200, { ok: false, code: 'quota', error: '…' }]).translate('你好'), { code: 'quota' });
  await assert.rejects(mk(() => [200, { ok: false, code: 'weird' }]).translate('你好'), { code: 'error' });
  await assert.rejects(mk(() => OK()).translate('   '), { code: 'empty' });
  await assert.rejects(mk(() => OK()).translate('字'.repeat(MAX_CHARS + 1)), { code: 'too_long' });
  assert.equal(codeOfResponse(503, null), 'auth_down');
  assert.equal(codeOfResponse(500, null), 'busy');
  assert.equal(codeOfResponse(200, { ok: true }), null);
});

test('auth_down（认人那一步网慢）：再试一次', async () => {
  const f = mockFetch((b, n) => (n === 1 ? [503, { ok: false, code: 'auth_down' }] : OK()));
  const c = createTranslateClient({ url: 'u', fetch: f, online: () => true, getToken: async () => 't' });
  assert.equal((await c.translate('你好')).vi, 'Xin chào');
  assert.equal(f.calls.length, 2);
});

test('网络断了一下：再试一次；一直连不上 = 暂时连不上；手机没网：不发，说没网', async () => {
  const f = mockFetch((b, n) => (n === 1 ? new TypeError('Failed to fetch') : OK()));
  const c = createTranslateClient({ url: 'u', fetch: f, online: () => true, getToken: async () => 't' });
  assert.equal((await c.translate('你好')).vi, 'Xin chào');
  assert.equal(f.calls.length, 2);
  const f2 = mockFetch(() => new TypeError('Failed to fetch'));
  const c2 = createTranslateClient({ url: 'u', fetch: f2, online: () => true, getToken: async () => 't' });
  await assert.rejects(c2.translate('你好'), { code: 'unreachable', message: MSG.unreachable });
  assert.equal(f2.calls.length, 2);
  const f3 = mockFetch(() => OK());
  const c3 = createTranslateClient({ url: 'u', fetch: f3, online: () => false, getToken: async () => 't' });
  await assert.rejects(c3.translate('你好'), { code: 'offline' });
  assert.equal(f3.calls.length, 0);
});

test('超时：10 秒没回来就不等了（说网慢）', async () => {
  const f = (url, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const c = createTranslateClient({
    url: 'u', fetch: f, online: () => true, getToken: async () => 't',
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 10_000 ? 5 : ms),
  });
  await assert.rejects(c.translate('你好'), { code: 'timeout' });
});

test('手机上的限频：10 秒 8 次、一分钟 30 次；边打边翻自动发的只能用 6 / 24 次', () => {
  let t = 0;
  const lim = createLimiter(() => t);
  for (let i = 0; i < 6; i += 1) assert.equal(lim.take('auto'), true);
  assert.equal(lim.take('auto'), false, '自动的第 7 次挡住');
  assert.ok(lim.waitMs('auto') > 0 && lim.waitMs('auto') <= 10_030);
  assert.equal(lim.take('manual'), true);
  assert.equal(lim.take('manual'), true);
  assert.equal(lim.take('manual'), false, '手动的第 9 次挡住');
  t += 10_000;
  assert.equal(lim.take('manual'), true);
  lim.reset();
  for (let i = 0; i < 30; i += 1) { t += 1500; assert.equal(lim.take('manual'), true, `第 ${i + 1} 次`); }
  t += 1500;
  assert.equal(lim.take('manual'), false, '一分钟 30 次');
  assert.equal(LIMITS.s10, 8);
});

test('撞到限频：reject rate，带还要等多久；不发请求', async () => {
  const f = mockFetch(() => OK());
  const c = createTranslateClient({ url: 'u', fetch: f, online: () => true, getToken: async () => 't', now: () => 0 });
  for (let i = 0; i < 6; i += 1) await c.translate(`句子${i}`, { auto: true });
  await assert.rejects(c.translate('再来', { auto: true }), (e) => e.code === 'rate' && e.wait > 0);
  assert.equal(f.calls.length, 6);
});

test('以最后一次为准：新的一发，旧的作废（停掉请求）', async () => {
  const aborted = [];
  const f = (url, init) => new Promise((res) => {
    const body = JSON.parse(init.body);
    init.signal.addEventListener('abort', () => aborted.push(body.text));
    setTimeout(() => res({ status: 200, json: async () => ({ ok: true, src: 'zh', vi: `VI ${body.text}`, en: '', back: '' }) }), 5);
  });
  const c = createTranslateClient({ url: 'u', fetch: f, online: () => true, getToken: async () => 't' });
  const run = c.runner();
  const p1 = run.run('第一句');
  await new Promise((r) => setTimeout(r, 0));
  const p2 = run.run('第二句');
  await assert.rejects(p1, { code: 'stale' });
  assert.equal((await p2).vi, 'VI 第二句');
  assert.deepEqual(aborted, ['第一句']);
  run.cancel();
});

test('演示接口：和真接口一样的返回；认得的句子、称呼、外文、不认得的给示例；没 token 401', async () => {
  assert.equal(demoTranslate('不要香菜，我们不吃海鲜。').vi, 'Không cho ngò nha, tụi tôi không ăn hải sản.');
  const h = demoTranslate('大哥，这个多少钱？');
  assert.equal(h.vi, 'Anh ơi, cái này bao nhiêu tiền ạ?');
  assert.equal(h.back, '大哥，这个多少钱？');
  assert.equal(demoTranslate('Anh ơi, tới rồi nha. 150 ngàn.').zh, '到了哦，15 万越南盾。');
  assert.equal(demoTranslate('Sorry, we are fully booked tonight.').src, 'en');
  assert.equal(demoTranslate('随便写一句').demo, true);
  const f = createDemoFetch({ delay: 0 });
  const c = createTranslateClient({ url: 'demo', fetch: f, online: () => true, getToken: async () => 'demo.u' });
  assert.equal((await c.translate('这个多少钱？')).en, 'How much is this?');
  const r = await f('demo', { body: JSON.stringify({ text: 'x' }) });
  assert.equal(r.status, 401);
});

// ---------------------------------------------------------------------
// 页面的状态机
// ---------------------------------------------------------------------

test('边打边翻：没写完停 0.65 秒、写完了停 0.45 秒才发；还在打拼音、输入法拼写中不发', async () => {
  const { ctl, client, timers, setComposing } = setup();
  ctl.input('请问夜市怎么走');
  await timers.advance(TIMING.autoMid - 1);
  assert.equal(client.calls.length, 0);
  await timers.advance(1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].opts.auto, true);
  ctl.input('请问夜市怎么走？');
  await timers.advance(TIMING.auto);
  assert.equal(client.calls.length, 2);
  ctl.input('请问夜市zen');
  await timers.advance(1000);
  assert.equal(client.calls.length, 2, '拼音不发');
  setComposing(true);
  ctl.input('请问夜市怎么走呀');
  await timers.advance(1000);
  assert.equal(client.calls.length, 2, '输入法还在拼写');
  setComposing(false);
});

test('翻好：结果卡出来；同一句不重发；点「翻译」不再发、记进最近翻过、按钮变淡', async () => {
  const { ctl, client, timers, phrases, shown } = setup();
  ctl.input('不要香菜');
  await timers.advance(TIMING.autoMid);
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  assert.equal(ctl.state.value.res.vi, 'VI(不要香菜)');
  assert.equal(shown.length, 1);
  assert.equal(phrases.list().length, 0, '边打边翻的中间结果先不记');
  assert.equal(viewOf(ctl.state.value).goOff, false);
  ctl.go();
  assert.equal(client.calls.length, 1, '同一句不重发');
  assert.equal(phrases.list().length, 1);
  assert.equal(ctl.state.value.done, true);
  assert.equal(viewOf(ctl.state.value).goOff, true);
  // 补个句号：还是同一句
  ctl.input('不要香菜。');
  await timers.advance(1000);
  assert.equal(client.calls.length, 1);
});

test('什么时候记进最近翻过：写完了的停 2.5 秒记；没写完的不记，收键盘时才记；离开时只记写完了的', async () => {
  const a = setup();
  a.ctl.input('多少钱？');
  await a.timers.advance(TIMING.auto);
  a.client.calls[0].resolve(OUT('多少钱？'));
  await a.timers.advance(TIMING.commit - 1);
  assert.equal(a.phrases.list().length, 0);
  await a.timers.advance(1);
  assert.equal(a.phrases.list().length, 1);
  assert.ok(a.ctl.state.value.res.id, '记下以后结果卡带上 id（给对方看要用）');

  const b = setup();
  b.ctl.input('多少钱');
  await b.timers.advance(TIMING.autoMid);
  b.client.calls[0].resolve(OUT('多少钱'));
  await b.timers.advance(5000);
  assert.equal(b.phrases.list().length, 0);
  b.ctl.leave();
  assert.equal(b.phrases.list().length, 0, '没写完：离开也不记');
  b.ctl.blur();
  assert.equal(b.phrases.list().length, 1, '收键盘时记');
});

test('改了字：旧结果变淡；新的一句没翻成 / 手动翻还没出来，写「上一句」，不能给对方看', async () => {
  const { ctl, client, timers } = setup();
  ctl.input('不要香菜');
  ctl.go();
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  let v = viewOf(ctl.state.value);
  assert.equal(v.canShow, true);
  ctl.input('不要放辣');
  v = viewOf(ctl.state.value);
  assert.equal(v.stale, true);
  assert.equal(v.dim, true);
  assert.equal(v.old, false, '只是变淡，不写上一句');
  assert.equal(v.canShow, false);
  ctl.go();
  v = viewOf(ctl.state.value);
  assert.equal(v.old, true, '点了「翻译」还没出来');
  const e = new Error(MSG.timeout);
  e.code = 'timeout';
  client.calls[1].reject(e);
  await timers.flush();
  assert.equal(ctl.state.value.failed, true);
  assert.equal(ctl.state.value.msg, MSG.timeout);
  assert.equal(ctl.state.value.msgKind, 'bad');
  assert.equal(viewOf(ctl.state.value).old, true);
});

test('清空：结果收起、正在翻的作废', async () => {
  const { ctl, client, timers } = setup();
  ctl.input('不要香菜');
  await timers.advance(TIMING.autoMid);
  ctl.clear();
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  assert.equal(ctl.state.value.res, null);
  assert.equal(ctl.state.value.text, '');
});

test('翻过的同一句（收藏、最近翻过）：直接拿出来，不连网，标「之前翻过」', async () => {
  const { ctl, client, timers, phrases } = setup();
  phrases.save('这个多少钱？', OUT('这个多少钱？'));
  ctl.input(' 这个多少钱？');
  await timers.advance(TIMING.autoMid);
  assert.equal(client.calls.length, 0);
  assert.equal(ctl.state.value.res.again, true);
  assert.equal(ctl.state.value.res.vi, 'VI(这个多少钱？)');
});

test('称呼：拼在原文前面拿去翻；换了称呼，刚才的结果就算上一句', async () => {
  const { ctl, client, timers } = setup();
  ctl.setHonor('ge');
  ctl.input('这个多少钱？');
  ctl.go();
  assert.equal(client.calls[0].input, '大哥，这个多少钱？');
  client.calls[0].resolve(OUT('大哥，这个多少钱？'));
  await timers.flush();
  assert.equal(viewOf(ctl.state.value).stale, false);
  ctl.setHonor('');
  assert.equal(viewOf(ctl.state.value).stale, true);
  assert.equal(staleOf('这个多少钱？', ctl.state.value.res, 'ge'), false);
  // 从收藏点开一条没带称呼的：选着称呼也不算上一句（能给对方看）；点「翻译」才按称呼重翻
  ctl.setHonor('ge');
  ctl.openRow({ id: 's1', ...OUT('不要香菜') });
  assert.equal(viewOf(ctl.state.value).canShow, true);
  ctl.go();
  assert.equal(client.calls.at(-1).input, '大哥，不要香菜');
});

test('⇄ 对调：越南语挪进输入框、回译现成就是中文结果（不再翻）；再按一下还原原来那句', async () => {
  const { ctl, client, timers } = setup();
  ctl.input('不要香菜');
  ctl.go();
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  ctl.swap();
  let s = ctl.state.value;
  assert.equal(s.dir, 'in');
  assert.equal(s.text, 'VI(不要香菜)');
  assert.equal(s.res.zh, '回译(不要香菜)');
  assert.equal(client.calls.length, 1, '不用再翻');
  ctl.swap();
  s = ctl.state.value;
  assert.equal(s.dir, 'out');
  assert.equal(s.text, '不要香菜');
  assert.equal(s.res.vi, 'VI(不要香菜)');
  assert.equal(client.calls.length, 1);
  assert.equal(s.spin, 2);
});

test('⇄ 对调外文结果：中文挪进输入框再翻成越南语；没结果时只换方向', async () => {
  const { ctl, client, timers } = setup();
  ctl.swap();
  assert.equal(ctl.state.value.dir, 'in');
  assert.equal(client.calls.length, 0);
  ctl.input('Tới rồi');
  ctl.go();
  client.calls[0].resolve(IN('Tới rồi', '到了'));
  await timers.flush();
  ctl.swap();
  assert.equal(ctl.state.value.text, '到了');
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].input, '到了');
});

test('写的语言和语言栏不一样：栏自己翻过来，每个方向只提示一次', async () => {
  const { ctl, client, timers } = setup();
  ctl.input('Tới rồi');
  ctl.go();
  client.calls[0].resolve(IN('Tới rồi'));
  await timers.flush();
  assert.equal(ctl.state.value.dir, 'in');
  assert.equal(ctl.state.value.msg, L.fixIn);
  ctl.input('你好');
  ctl.go();
  client.calls[1].resolve(OUT('你好'));
  await timers.flush();
  assert.equal(ctl.state.value.msg, L.fixOut);
  ctl.input('Dạ');
  ctl.go();
  client.calls[2].resolve(IN('Dạ'));
  await timers.flush();
  assert.equal(ctl.state.value.dir, 'in');
  assert.equal(ctl.state.value.msg, '', '第二次不再提示');
});

test('限频：边打边翻的不吵，等名额空出来自动补发；手动的 5 秒内转着圈等，再久才提示', async () => {
  const { ctl, client, timers } = setup();
  const rate = (wait) => Object.assign(new Error(MSG.rate), { code: 'rate', wait });
  ctl.input('不要香菜');
  await timers.advance(TIMING.autoMid);
  client.calls[0].reject(rate(3000));
  await timers.flush();
  assert.equal(ctl.state.value.msg, '');
  assert.equal(ctl.state.value.busy, false);
  await timers.advance(3000);
  assert.equal(client.calls.length, 2, '自动补发');
  client.calls[1].resolve(OUT('不要香菜'));
  await timers.flush();
  ctl.input('多少钱？');
  ctl.go();
  client.calls[2].reject(rate(2000));
  await timers.flush();
  assert.equal(ctl.state.value.busy, true, '手动的转着圈等');
  await timers.advance(2000);
  assert.equal(client.calls.length, 4);
  client.calls[3].reject(rate(9000));
  await timers.flush();
  assert.equal(ctl.state.value.msg, MSG.rate);
});

test('没网：说没网（offline 的语气）；收藏和最近翻过照样能点开', async () => {
  const { ctl, client, timers, phrases } = setup();
  ctl.input('请问夜市怎么走？');
  ctl.go();
  client.calls[0].reject(Object.assign(new Error(MSG.offline), { code: 'offline' }));
  await timers.flush();
  assert.equal(ctl.state.value.msgKind, 'offline');
  const { row } = phrases.star(OUT('不要香菜'));
  ctl.openRow(row);
  assert.equal(ctl.state.value.res.vi, 'VI(不要香菜)');
  assert.equal(ctl.state.value.msg, '');
  assert.equal(viewOf(ctl.state.value).canShow, true);
});

test('收藏、给对方看之前记一条（拿到 id）；粘贴马上翻；删掉正在看的那条结果卡也收起', async () => {
  const { ctl, client, timers, phrases } = setup();
  ctl.input('不要香菜');
  await timers.advance(TIMING.autoMid);
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  const row = ctl.keep();
  assert.ok(row?.id);
  assert.equal(phrases.list().length, 1);
  assert.deepEqual(ctl.toggleStar(), { on: true, dropped: false });
  assert.equal(phrases.stars().length, 1);
  assert.deepEqual(ctl.toggleStar(), { on: false, dropped: false });
  ctl.remove(ctl.state.value.res.id);
  assert.equal(ctl.state.value.res, null);
  assert.equal(ctl.paste(''), false);
  assert.equal(ctl.state.value.msg, L.pasteNone);
  assert.equal(ctl.paste('Dạ, chờ em một chút nha.'), true);
  assert.equal(client.calls.at(-1).input, 'Dạ, chờ em một chút nha.');
  assert.equal(client.calls.at(-1).opts.auto, false);
});

test('分栏：一开始停在「翻译」；去「记录」先把边打边翻的结果记下来；点一条回到「翻译」显示它；离开再进来回到「翻译」', async () => {
  const { ctl, client, timers, phrases, shown } = setup();
  assert.deepEqual(TABS, ['tr', 'rec']);
  assert.equal(ctl.state.value.tab, 'tr');
  ctl.input('不要香菜');
  await timers.advance(TIMING.autoMid);
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  assert.equal(phrases.list().length, 0, '边打边翻的还没记');
  ctl.setTab('rec');
  assert.equal(ctl.state.value.tab, 'rec');
  assert.equal(phrases.list().length, 1, '去「记录」之前记下来（和收键盘一样），记录里看得到刚才那句');
  assert.ok(ctl.state.value.res.id, '结果卡拿到了 id');
  // 不认识的分栏当「翻译」；同一栏再点不做事
  ctl.setTab('nope');
  assert.equal(ctl.state.value.tab, 'tr');
  ctl.setTab('rec');
  const before = ctl.state.value;
  ctl.setTab('rec');
  assert.equal(ctl.state.value, before);
  // 在「记录」点一条：回到「翻译」，成了结果卡
  const { row } = phrases.star(OUT('这个多少钱？'));
  ctl.openRow(row);
  assert.equal(ctl.state.value.tab, 'tr');
  assert.equal(ctl.state.value.text, '这个多少钱？');
  assert.equal(ctl.state.value.res.vi, 'VI(这个多少钱？)');
  assert.equal(shown.at(-1).o.opened, true);
  // 离开这一页：下次进来停在「翻译」
  ctl.setTab('rec');
  ctl.leave();
  assert.equal(ctl.state.value.tab, 'tr');
});

test('「记录」的清空：只删最近翻过、收藏不动；正在显示的那条被删了，「翻译」里这一句也收起；收藏着的留着', async () => {
  const { ctl, client, timers, phrases } = setup();
  ctl.input('不要香菜');
  ctl.go();
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  ctl.input('');
  ctl.input('这个多少钱？');
  ctl.go();
  client.calls[1].resolve(OUT('这个多少钱？'));
  await timers.flush();
  phrases.star(OUT('谢谢'));
  assert.equal(phrases.list().length, 2);
  ctl.setTab('rec');
  assert.equal(ctl.clearRecent(), 2);
  assert.deepEqual(phrases.list(), []);
  assert.equal(phrases.stars().length, 1, '收藏不动');
  const st = ctl.state.value;
  assert.equal(st.res, null, '正在显示的那条删了：结果卡收起');
  assert.equal(st.text, '', '输入框里就是这一句：也清掉');
  assert.equal(st.tab, 'rec');
  // 再翻一句也收藏了：清空以后结果卡还在（换成收藏那条的 id，「给对方看」照样打得开）
  ctl.input('谢谢');
  ctl.go();
  assert.equal(client.calls.length, 2, '收藏过的直接拿出来');
  ctl.input('请问厕所在哪里？');
  ctl.go();
  client.calls[2].resolve(OUT('请问厕所在哪里？'));
  await timers.flush();
  const { row: star } = phrases.star(ctl.state.value.res);
  ctl.clearRecent();
  assert.equal(ctl.state.value.res.id, star.id);
  assert.equal(ctl.state.value.text, '请问厕所在哪里？');
  assert.equal(phrases.get(ctl.state.value.res.id).input, '请问厕所在哪里？');
  // 确认框里那句话
  assert.equal(clearMsgOf(3), '这 3 句会从这台手机上删掉，收藏的不动。');
});

test('删掉单条：正在显示的那条，输入框里没改过就一起清掉；改过字的留着', async () => {
  const { ctl, client, timers, phrases } = setup();
  ctl.input('不要香菜');
  ctl.go();
  client.calls[0].resolve(OUT('不要香菜'));
  await timers.flush();
  ctl.input('不要香菜，也不要葱');
  const id = ctl.state.value.res.id;
  ctl.remove(id);
  assert.equal(ctl.state.value.res, null);
  assert.equal(ctl.state.value.text, '不要香菜，也不要葱', '改过的字留着');
  assert.equal(phrases.list().length, 0);
});

test('「翻译」没写字：提示先写一句；行程 id 跟着请求走', async () => {
  const { ctl, client } = setup();
  assert.equal(ctl.go(), false);
  assert.equal(ctl.state.value.msg, '先写一句');
  ctl.setTrip('phuquoc2026');
  ctl.input('你好');
  ctl.go();
  assert.equal(client.calls[0].opts.trip, 'phuquoc2026');
  assert.equal(viewOf({ ...ctl.state.value, text: '字'.repeat(250) }).left, '50');
});

// ---------------------------------------------------------------------
// 对话模式、给对方看
// ---------------------------------------------------------------------

test('对话：双方的话都翻成对方的语言落到对方那半屏；自己的原话留在自己那边；没翻成的两边都说', () => {
  const turns = [
    { id: '1', who: 'me', src: '你好', res: { dir: 'out', vi: 'Xin chào', en: 'Hello' }, live: false, fail: false },
    { id: '2', who: 'them', src: 'Dạ', res: { dir: 'in', zh: '好的' }, live: false, fail: false },
    { id: '3', who: 'me', src: '多少钱', res: null, live: true, fail: false },
    { id: '4', who: 'them', src: 'Hả?', res: null, live: false, fail: true },
  ];
  const { me, them } = rowsOf(turns);
  assert.deepEqual(me.map((x) => [x.own, x.main]), [[true, '你好'], [false, '好的'], [true, '多少钱'], [false, CL.fail]]);
  assert.deepEqual(them.map((x) => [x.own, x.main, x.sub]), [[false, 'Xin chào', 'Hello'], [true, 'Dạ', ''], [false, '', ''], [true, 'Hả?', '']]);
  assert.equal(them[2].live, true);
  assert.equal(me[3].fail, true);
  assert.equal(me[3].last, true);
  // 对方说的是中文（比如华人老板）：不用翻，原样给我看
  assert.equal(rowsOf([{ id: '9', who: 'them', src: '你好', res: { dir: 'out', vi: 'x' } }]).me[0].main, '你好');
  assert.equal(tail('字'.repeat(70)), `…${'字'.repeat(60)}`);
  assert.equal(tail('短'), '短');
});

test('给对方看一句翻译（tr.<id>）：越南语最大、英语、中文小字；找不到时说清楚；别的参数不管', () => {
  const s = createPhraseStore({ storage: memStorage() });
  const row = s.save('不要香菜', OUT('不要香菜'));
  const c = translationCard(`tr.${row.id}`, s);
  assert.equal(c.primary, 'VI(不要香菜)');
  assert.equal(c.secondary, 'EN(不要香菜)');
  assert.equal(c.note, '不要香菜');
  assert.equal(c.badge, '给对方看');
  assert.equal(c.lang, 'vi');
  assert.equal(c.copy, 'VI(不要香菜)');
  assert.equal(translationCard('tr.nope', s).primary, '这句找不到了');
  assert.equal(translationCard('8e0843e1-aaaa', s), null);
  assert.equal(isTranslationArg('tr.'), false);
  assert.ok(/^[A-Za-z0-9_.~-]{1,80}$/.test(`tr.${row.id}`), '网址参数只能用这些字符');
});

// ---------------------------------------------------------------------
// 接上外壳、配置
// ---------------------------------------------------------------------

test('路由、外框：翻译是行程里的二级页面（底栏亮「更多」，大标题「翻译」）', () => {
  const r = routes.find((x) => x.name === 'translate');
  assert.equal(r.path, '/t/:tripId/translate');
  assert.equal(r.meta.auth, true);
  assert.equal(chromeKind({ name: 'translate' }), 'section');
  assert.equal(SECTION_TITLES.translate, '翻译');
});

test('接口地址只写在 config.js 一处，CSP 放行它的来源；地址是 https', () => {
  assert.match(TRANSLATE_URL, /^https:\/\/[^/]+\.tcloudbase\.com\/translate-web$/);
  assert.equal(TRANSLATE_ORIGIN, new URL(TRANSLATE_URL).origin);
  assert.ok(CSP_SOURCES.connect.includes(TRANSLATE_ORIGIN));
});

// ---------------------------------------------------------------------
// 对话模式：直接听（浏览器的语音识别）
// ---------------------------------------------------------------------

/** 假的 SpeechRecognition：start 以后按脚本吐结果 / 出错，再 end */
function fakeRecognition(script) {
  const made = [];
  class Rec {
    constructor() { made.push(this); }
    start() {
      queueMicrotask(() => {
        for (const step of script) {
          if (step.error) this.onerror?.({ error: step.error });
          else this.onresult?.({ results: step.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
        }
        this.onend?.();
      });
    }
    stop() { this.stopped = true; }
  }
  return { Rec, made };
}

test('直接听：边听边出字，说完自动停（done）；没给麦克风记住、这次打开不再试；没听到是 quiet', async () => {
  const saved = globalThis.window;
  try {
    resetListen();
    globalThis.window = {};
    assert.equal(canListen(), false, '没有 SpeechRecognition');
    const ok = fakeRecognition([[['Cho tôi', false]], [['Cho tôi một ly cà phê', true]]]);
    globalThis.window = { webkitSpeechRecognition: ok.Rec };
    assert.equal(canListen(), true);
    assert.equal(canListen({ coarse: false }), false, '桌面不用');
    const texts = [];
    const reason = await new Promise((done) => listen({ lang: 'vi-VN', onText: (t, f) => texts.push([t, f]), onEnd: done }));
    assert.equal(reason, 'done');
    assert.deepEqual(texts, [['Cho tôi', false], ['Cho tôi một ly cà phê', true]]);
    assert.equal(ok.made[0].lang, 'vi-VN');
    assert.equal(ok.made[0].interimResults, true);

    const quiet = fakeRecognition([{ error: 'no-speech' }]);
    globalThis.window = { webkitSpeechRecognition: quiet.Rec };
    assert.equal(await new Promise((done) => listen({ lang: 'zh-CN', onEnd: done })), 'quiet');

    const denied = fakeRecognition([{ error: 'not-allowed' }]);
    globalThis.window = { SpeechRecognition: denied.Rec };
    assert.equal(await new Promise((done) => listen({ lang: 'zh-CN', onEnd: done })), 'denied');
    assert.equal(canListen(), false, '拒绝过：这次打开不再试，退回键盘');

    resetListen();
    globalThis.window = { SpeechRecognition: class { constructor() { throw new Error('nope'); } } };
    assert.equal(await new Promise((done) => listen({ lang: 'zh-CN', onEnd: done })), 'fail', '构造不了也不抛错');
  } finally {
    globalThis.window = saved;
    resetListen();
  }
});

test('对话模式的文案：直接听时说「直接说」；键盘方式给对方一行越南语提示', () => {
  assert.match(CL.i2sVoice, /直接说/);
  assert.match(CL.themKb, /micro/);
  assert.equal(CL.voiceThem, '在听越南语，说完自动翻');
  assert.equal(L.demo, '演示模式：只认得几句');
  assert.equal(L.copyVi, '复制越南语');
});
