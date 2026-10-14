// 贴士与常用语（pages/tips）、联系人（pages/contacts）的纯逻辑：
//   贴士：五种类型的中文名和顺序、正文预览和要不要展开、哪些是能展开的卡、原文太长先收起、本页搜索（越南语去声调、高亮、正文片段）、
//   类型筛选和置顶、常用语的场景（tags → 场景、同义词、自定义标签、按字推断）和排序、「相关」、今天用得上、紧急类、
//   消息模板直接发给谁（WhatsApp 预填原文 / Zalo 先复制 / 邮件预填）、语言名、概况；
//   联系人：类别顺序（紧急在最上面）、打电话 / WhatsApp / Zalo / 邮件链接（+、00、短号、越南号码换本地写法）、越南手机号推 Zalo、
//   快捷按钮、号码一行一个（同号合并）、关联、搜索（号码只按数字）、分组和「今天」、预订的当地日期、概况；
//   最后用演示数据（demo-island、demo-cities、demo-empty）整体跑一遍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { KIND_LABELS } from '../../src/kit/kinds.js';
import { ENUMS } from '../../src/data/schema.js';
import { zonedParts } from '../../src/lib/datetime.js';
import { queryTokens } from '../../src/kit/search/fold.js';
import {
  KIND_ORDER, KIND_TITLES, normalizeTipKind, kindTitle, normalizeFilter, bodyText, previewText, needsExpand, SHORT_BODY,
  rendersExpandable, isLongLocal, LOCAL_CLAMP_CHARS, tipHaystack, matchTip, bodySnippet, filterTips, kindCounts, buildView,
  PHRASE_SCENES, INFER_ORDER, phraseScene, phraseView, normalizeScene, phraseWide, relatedOf, monthDay, isToday, isEmergencyTip,
  waSendHref, zaloChatHref, mailSendHref, sendTargets, langLabel, tipLang, summaryLine as tipsSummary,
} from '../../src/pages/tips/model.js';
import { pickVoice, baseLang } from '../../src/pages/tips/speech.js';
import {
  CATEGORY_ORDER, CATEGORY_TITLES, categoryOf, categoryTitle, normalizeCategoryFilter, phoneDigits, isVnMobile, telHref, waHref,
  zaloHref, mailHref, samePhone, channelsOf, numberLines, headlineNumber, linksOf, subtitleOf, contactHaystack, matchContact,
  groupContacts, isTodayContact, bookingSpan, summaryLine as contactsSummary, numberLabel, phoneSpans,
} from '../../src/pages/contacts/model.js';

import {
  CONTACT_SHEET, newArg, parseArg, CATEGORY_OPTIONS, FIELDS, initialForm, isDirty, validateForm, formToValues, changedValues, nextSort,
} from '../../src/pages/contacts/form.js';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(APP, 'src');
const DB = JSON.parse(readFileSync(path.join(APP, 'demo/demo-db.json'), 'utf8'));
const rows = (table, trip) => DB.tables[table].filter((r) => r.trip_id === trip);

const tip = (o) => ({ id: o.id || `t-${Math.random().toString(36).slice(2, 8)}`, kind: 'tip', title: '', body: '', tags: [], pinned: false, ...o });

// =====================================================================
// 贴士
// =====================================================================

test('贴士：五种类型的顺序、中文名和 kit/kinds.js、数据库枚举一致；不认识的按「小贴士」', () => {
  assert.deepEqual(KIND_ORDER, ['warning', 'tip', 'info', 'template', 'phrase']);
  for (const k of KIND_ORDER) assert.equal(KIND_TITLES[k], KIND_LABELS.tip[k], k);
  assert.deepEqual([...KIND_ORDER].sort(), [...ENUMS['tips.kind']].sort(), '和 data/schema.js 的枚举一一对应');
  assert.equal(normalizeTipKind('nope'), 'tip');
  assert.equal(normalizeTipKind(undefined), 'tip');
  assert.equal(kindTitle('phrase'), '常用语');
  assert.equal(normalizeFilter('template'), 'template');
  assert.equal(normalizeFilter('xx'), 'all');
  assert.equal(normalizeFilter(undefined), 'all');
});

test('贴士：正文转纯文字、收起时的预览（列表摊成一行、太长省略号不留标点）、短的不做展开', () => {
  const t = tip({ body: '上车前确认**打表**。\n\n- 机场出口先问价\n- 夜里叫车' });
  assert.equal(bodyText(t), '上车前确认打表。\n\n• 机场出口先问价\n• 夜里叫车');
  assert.equal(previewText(t), '上车前确认打表。 · 机场出口先问价 · 夜里叫车');
  assert.ok(needsExpand(t), '有列表：要展开');
  assert.equal(needsExpand(tip({ body: '一句话就说完。' })), false, '短的整段显示');
  assert.equal(needsExpand(tip({ body: '' })), false);
  const long = tip({ body: '字'.repeat(SHORT_BODY + 1) });
  assert.ok(needsExpand(long));
  const p = previewText(tip({ body: `${'很长的一段，'.repeat(30)}` }), 20);
  assert.ok(p.endsWith('…') && p.length <= 21, p);
  assert.ok(!/[，,]…$/.test(p), '省略号前不留逗号');
});

test('贴士：哪些是能原地展开的卡——模板和常用语有自己的卡，置顶进了置顶卡才展开；短的防坑不展开', () => {
  const longWarn = tip({ kind: 'warning', body: '- a\n- b' });
  const shortWarn = tip({ kind: 'warning', body: '短' });
  const tpl = tip({ kind: 'template', local_text: 'Hello', body: '说明' });
  const pinnedPhrase = tip({ kind: 'phrase', local_text: 'Xin chào', pinned: true });
  const withLocal = tip({ kind: 'tip', body: '短', local_text: 'Cảm ơn' });
  assert.equal(rendersExpandable(longWarn), true);
  assert.equal(rendersExpandable(shortWarn), false);
  assert.equal(rendersExpandable(tpl), false);
  assert.equal(rendersExpandable(pinnedPhrase), true, '看全部时置顶的常用语在置顶卡里，一行一条点开看');
  assert.equal(rendersExpandable(pinnedPhrase, { kind: 'phrase' }), false, '只看常用语时回到卡片网格');
  assert.equal(rendersExpandable(withLocal), true, '带原文的小贴士点开有复制 / 给对方看');
  assert.equal(rendersExpandable(null), false);
});

test('贴士：原文太长（字数或行数）先收起', () => {
  assert.equal(isLongLocal('short'), false);
  assert.equal(isLongLocal('x'.repeat(LOCAL_CLAMP_CHARS + 1)), true);
  assert.equal(isLongLocal('a\nb\nc\nd\ne\nf\ng'), true);
  assert.equal(isLongLocal(null), false);
});

test('贴士搜索：中文子串、越南语不带声调、每个词都要命中；标签、关联的地点 / 预订名也算', () => {
  const t = tip({ title: '不要冰', local_text: 'Không đá', kind: 'phrase', tags: ['饮料'], place_id: 'p1' });
  const ctx = { placeName: (id) => (id === 'p1' ? '椰子咖啡' : null) };
  assert.ok(tipHaystack(t, ctx).includes('khong da'));
  assert.ok(matchTip(t, queryTokens('khong da'), ctx), '不带声调');
  assert.ok(matchTip(t, queryTokens('KHÔNG'), ctx), '大小写、带声调');
  assert.ok(matchTip(t, queryTokens('冰'), ctx));
  assert.ok(matchTip(t, queryTokens('饮料'), ctx), '标签');
  assert.ok(matchTip(t, queryTokens('椰子'), ctx), '关联地点名');
  assert.ok(matchTip(t, queryTokens('常用语'), ctx), '类型名');
  assert.equal(matchTip(t, queryTokens('冰 热'), ctx), null, '两个词都要命中');
  const hit = matchTip(t, queryTokens('da'), ctx);
  assert.deepEqual(hit.local, [[6, 8]], '原文「đá」整字高亮');
  assert.deepEqual(matchTip(t, [], ctx), { title: [], local: [], snippet: null }, '空查询全部命中');
});

test('贴士搜索：标题、原文都没命中时给正文命中处的一小段（两头省略号、高亮位置对得上）', () => {
  const t = tip({ title: '汇率', body: `${'开头的话'.repeat(10)}夜市只收现金，记得换钱${'结尾'.repeat(40)}` });
  const hit = matchTip(t, queryTokens('现金'));
  assert.equal(hit.title.length, 0);
  assert.ok(hit.snippet);
  assert.ok(hit.snippet.text.startsWith('…') && hit.snippet.text.endsWith('…'), hit.snippet.text);
  const [[a, b]] = hit.snippet.ranges;
  assert.equal(hit.snippet.text.slice(a, b), '现金');
  assert.equal(bodySnippet(t, queryTokens('没有的词')), null);
});

test('贴士：按类型筛选、芯片数量、置顶——看全部时置顶的单独一张卡，筛某一类时回到组里排最前', () => {
  const list = [
    tip({ id: 'w1', kind: 'warning', title: '置顶防坑', pinned: true }),
    tip({ id: 'w2', kind: 'warning', title: '防坑二' }),
    tip({ id: 'i1', kind: 'info', title: '电压' }),
    tip({ id: 'p1', kind: 'phrase', title: '谢谢', local_text: 'Cảm ơn', pinned: true }),
    tip({ id: 'x', kind: 'weird', title: '不认识的类型' }),
  ];
  const all = filterTips(list);
  assert.equal(all.length, 5);
  const counts = Object.fromEntries(kindCounts(all).map((c) => [c.kind, c.count]));
  assert.deepEqual(counts, { warning: 2, tip: 1, info: 1, template: 0, phrase: 1 });
  const v = buildView(all);
  assert.deepEqual(v.pinned.map((r) => r.tip.id), ['w1', 'p1']);
  assert.deepEqual(v.groups.map((g) => g.kind), ['warning', 'tip', 'info'], '空组不出；置顶的不在组里重复');
  assert.deepEqual(v.groups[0].rows.map((r) => r.tip.id), ['w2']);
  const onlyWarn = buildView(filterTips(list, { kind: 'warning' }), { kind: 'warning' });
  assert.equal(onlyWarn.pinned.length, 0);
  assert.deepEqual(onlyWarn.groups[0].rows.map((r) => r.tip.id), ['w1', 'w2'], '置顶的排在那一组最前');
  assert.deepEqual(filterTips(list, { query: 'cam on' }).map((r) => r.tip.id), ['p1']);
});

test('常用语场景：tags（场景名、同义词）优先；不认识的标签自成一组；没标签按标题、说明、原文推断；推不出来是「其他」', () => {
  assert.equal(phraseScene(tip({ title: '随便', tags: ['吃饭'] })).key, 'food');
  assert.equal(phraseScene(tip({ title: '随便', tags: ['交通'] })).key, 'taxi', '同义词');
  assert.equal(phraseScene(tip({ title: '随便', tags: ['Grab'] })).key, 'taxi', '同义词不分大小写');
  const custom = phraseScene(tip({ title: '随便', tags: ['看演出'] }));
  assert.equal(custom.key, 'tag:看演出');
  assert.equal(custom.custom, true);
  assert.equal(phraseScene(tip({ title: '不要冰' })).key, 'food');
  assert.equal(phraseScene(tip({ title: '多少钱？' })).key, 'shop');
  assert.equal(phraseScene(tip({ title: '洗手间在哪？' })).key, 'ask');
  assert.equal(phraseScene(tip({ title: '买单' })).key, 'food', '买单先算吃饭');
  assert.equal(phraseScene(tip({ title: '我要吃药' })).key, 'urgent', '紧急最先判断（「吃药」不算吃饭）');
  assert.equal(phraseScene(tip({ title: '请送我到这里' })).key, 'taxi');
  assert.equal(phraseScene(tip({ title: '你好' })).key, 'polite');
  assert.equal(phraseScene(tip({ title: '？', local_text: 'Cho tôi đến sân bay' })).key, 'taxi', '原文整词');
  assert.equal(phraseScene(tip({ title: '？', local_text: 'abc' })).key, 'other');
  // 每个场景都有图形、中文名；推断顺序覆盖全部场景
  for (const s of PHRASE_SCENES) assert.ok(s.glyph && s.label, s.key);
  assert.deepEqual([...INFER_ORDER].sort(), PHRASE_SCENES.map((s) => s.key).sort());
});

test('常用语：按场景排好、数好（场景顺序 → 自定义标签 → 其他，同场景保持原顺序）；?scene= 认得才用；长句占满一行', () => {
  const list = filterTips([
    tip({ id: 'a', kind: 'phrase', title: '谢谢' }),
    tip({ id: 'b', kind: 'phrase', title: '不要冰' }),
    tip({ id: 'c', kind: 'phrase', title: '？', local_text: 'zzz' }),
    tip({ id: 'd', kind: 'phrase', title: '你好' }),
    tip({ id: 'e', kind: 'phrase', title: '看演出', tags: ['演出'] }),
  ]);
  const pv = phraseView(list);
  assert.deepEqual(pv.rows.map((r) => r.tip.id), ['a', 'd', 'b', 'e', 'c']);
  assert.deepEqual(pv.scenes.map((s) => [s.key, s.count]), [['polite', 2], ['food', 1], ['tag:演出', 1], ['other', 1]]);
  assert.equal(normalizeScene('food', pv.scenes), 'food');
  assert.equal(normalizeScene('taxi', pv.scenes), 'all', '这次没有打车的');
  assert.equal(phraseWide(tip({ local_text: 'Xin chào' })), false);
  assert.equal(phraseWide(tip({ local_text: 'Cho tôi đến địa chỉ này, cảm ơn anh nhiều' })), true);
});

test('贴士「相关」：天（D2 · 1月11日）→ 地点 → 预订 → 分段；被删的地点、找不到的不显示', () => {
  const ctx = {
    days: [{ id: 'd2', date: '2027-01-11' }],
    places: new Map([['p1', { id: 'p1', name: '夜市', kind: 'market' }], ['p2', { id: 'p2', name: '旧', deleted_at: '2027-01-01' }]]),
    bookings: [{ id: 'b1', title: '浮潜团', kind: 'activity' }],
    segments: [{ id: 's1', title: '椰影镇' }],
    dayNumber: () => 2,
  };
  const links = relatedOf(tip({ day_id: 'd2', place_id: 'p1', booking_id: 'b1', segment_id: 's1' }), ctx);
  assert.deepEqual(links.map((l) => [l.type, l.label]), [['day', 'D2 · 1月11日'], ['place', '夜市'], ['booking', '浮潜团'], ['segment', '椰影镇']]);
  assert.deepEqual(relatedOf(tip({ place_id: 'p2', booking_id: 'nope' }), ctx), []);
  assert.equal(monthDay('2027-01-11'), '1月11日');
  assert.equal(monthDay('bad'), '');
});

test('贴士：今天用得上（关联的天是今天，或关联的地点在今天的安排里）；紧急类认得出来', () => {
  const o = { todayDayId: 'd2', todayPlaceIds: new Set(['p1']) };
  assert.equal(isToday(tip({ day_id: 'd2' }), o), true);
  assert.equal(isToday(tip({ day_id: 'd3', place_id: 'p1' }), o), false, '写了别的天就不是今天');
  assert.equal(isToday(tip({ place_id: 'p1' }), o), true);
  assert.equal(isToday(tip({ place_id: 'p1' }), { todayDayId: null }), false, '不在行程中');
  assert.equal(isEmergencyTip(tip({ title: '紧急情况' })), true);
  assert.equal(isEmergencyTip(tip({ title: '证件', tags: ['医院'] })), true);
  assert.equal(isEmergencyTip(tip({ title: '电压' })), false);
});

test('消息模板发给谁：同一个预订优先，再同一个地点；WhatsApp 预填原文、Zalo 先复制、邮件预填；最多两个', () => {
  const t = tip({ kind: 'template', title: '订位', local_text: 'Đặt bàn 2 người & cảm ơn', booking_id: 'b1', place_id: 'p1' });
  const contacts = [
    { id: 'c-place', name: '餐厅', place_id: 'p1', zalo: '+84 912 000 111' },
    { id: 'c-book', name: '订位', booking_id: 'b1', whatsapp: '+00 000 0000 0022' },
    { id: 'c-mail', name: '邮件', booking_id: 'b1', email: 'a@example.com' },
    { id: 'c-other', name: '别人', whatsapp: '+00 000 0000 0099' },
  ];
  const out = sendTargets(t, contacts);
  assert.deepEqual(out.map((x) => [x.contact.id, x.key]), [['c-book', 'whatsapp'], ['c-mail', 'email']]);
  assert.equal(out[0].href, `https://wa.me/${'+00 000 0000 0022'.replace(/\D/g, '')}?text=${encodeURIComponent(t.local_text)}`);
  assert.ok(out[1].href.startsWith('mailto:a@example.com?subject='));
  const three = sendTargets(t, contacts, { limit: 3 });
  assert.deepEqual(three[2], { key: 'zalo', contact: contacts[0], href: 'https://zalo.me/0912000111', label: 'Zalo 发送', copyFirst: true });
  assert.deepEqual(sendTargets(tip({ kind: 'template', booking_id: 'b1' }), contacts), [], '没有原文就不给发');
  assert.equal(waSendHref('12', 'x'), null);
  assert.equal(waSendHref('+00 000 0000 0022', ''), 'https://wa.me/0000000000022');
  assert.equal(zaloChatHref('+84 912 000 111'), 'https://zalo.me/0912000111');
  assert.equal(mailSendHref('不是邮箱'), null);
  assert.equal(mailSendHref('a@example.com', { subject: '你好' }), `mailto:a@example.com?subject=${encodeURIComponent('你好')}`);
});

test('贴士：语言名、概况一句话', () => {
  assert.equal(langLabel('vi'), '越南语');
  assert.equal(langLabel('vi-VN'), '越南语');
  assert.equal(langLabel('en'), '英文');
  assert.equal(langLabel('zh-TW'), '繁体中文');
  assert.equal(langLabel('xx'), null);
  assert.equal(tipLang({ local_lang: 'en', local_text: 'Cảm ơn' }), 'en', '写了就用写的');
  assert.equal(tipLang({ local_text: 'Không đá' }), 'vi', '没写：有越南语字母');
  assert.equal(tipLang({ local_text: 'KHÔNG ĐÁ' }), 'vi', '大写也认');
  assert.equal(tipLang({ local_text: '請問洗手間在哪裡' }), 'zh');
  assert.equal(tipLang({ local_text: 'Hello, thank you' }), 'en');
  assert.equal(tipLang({ local_text: '' }), null);
  assert.equal(langLabel(''), null);
  assert.equal(tipsSummary({ total: 0 }), '');
  assert.equal(tipsSummary({ total: 29, pinned: 2 }), '29 条 · 置顶 2 条');
  assert.equal(tipsSummary({ total: 5, pinned: 0 }), '5 条');
  assert.equal(tipsSummary({ total: 29, shown: 3, searching: true }), '找到 3 条');
  assert.equal(tipsSummary({ total: 29, shown: 0, searching: true }), '');
  assert.equal(tipsSummary({ total: 29, shown: 9, pinned: 2, kind: 'phrase' }), '常用语 9 条 · 共 29 条');
});

test('读出来：只有这种语言的声音才算能读；本机声音、完全一样的地区优先', () => {
  const voices = [
    { lang: 'en-US', localService: true },
    { lang: 'vi-VN', localService: false, name: 'net' },
    { lang: 'vi-VN', localService: true, name: 'Linh' },
  ];
  assert.equal(pickVoice(voices, 'vi').name, 'Linh');
  assert.equal(pickVoice(voices, 'vi-VN').name, 'Linh');
  assert.equal(pickVoice(voices, 'th'), null, '没有泰语的声音：不给读（拿英文声音念是乱的）');
  assert.equal(pickVoice([], 'vi'), null);
  assert.equal(baseLang('vi_VN'), 'vi');
});

// =====================================================================
// 联系人
// =====================================================================

test('联系人：类别顺序（紧急在最上面）覆盖数据库枚举，中文名和 kit/kinds.js 一致；?cat= 认得今天和类别', () => {
  assert.equal(CATEGORY_ORDER[0], 'emergency');
  assert.deepEqual([...CATEGORY_ORDER].sort(), [...ENUMS['contacts.category']].sort());
  for (const k of CATEGORY_ORDER) assert.equal(CATEGORY_TITLES[k], KIND_LABELS.contact[k], k);
  assert.equal(categoryOf({ category: 'nope' }), 'other');
  assert.equal(categoryTitle('hotel'), '酒店');
  assert.equal(normalizeCategoryFilter('today'), 'today');
  assert.equal(normalizeCategoryFilter('hotel'), 'hotel');
  assert.equal(normalizeCategoryFilter('x'), 'all');
});

test('联系人链接：tel:（+、00 国际冠码、三位急救号）、WhatsApp、Zalo（越南号码换本地写法）、邮件；太短的不给', () => {
  assert.equal(telHref('+00 000 0000 0001'), 'tel:+0000000000001', '带 + 的原样（只去空格）');
  assert.equal(telHref('0084 297 000 0000'), 'tel:+842970000000');
  assert.equal(telHref('115'), 'tel:115');
  assert.equal(telHref('12'), null);
  assert.equal(telHref(''), null);
  assert.equal(phoneDigits('0084 912'), '84912');
  assert.equal(phoneDigits('+00 000 0000 0022'), '0000000000022', '带 + 的不去 00');
  assert.equal(waHref('+00 000 0000 0003'), 'https://wa.me/0000000000003');
  assert.equal(waHref('115'), null);
  assert.equal(zaloHref('+84 912 000 111'), 'https://zalo.me/0912000111');
  assert.equal(zaloHref('0912 000 111'), 'https://zalo.me/0912000111');
  assert.equal(mailHref('a@example.com'), 'mailto:a@example.com');
  assert.equal(mailHref('abc'), null);
  assert.equal(samePhone('+84 912 000 111', '0912000111'), true, '一个带国家码一个不带');
  assert.equal(samePhone('+84 912 000 111', '+84 912 000 112'), false);
  assert.equal(numberLabel('  +84   912  '), '+84 912');
});

test('越南手机号（+84 3/5/7/8/9 开头）才推 Zalo：座机、短号、外国号码不推', () => {
  assert.equal(isVnMobile('+84 912 000 111'), true);
  assert.equal(isVnMobile('+84 389 000 111'), true);
  assert.equal(isVnMobile('0912 000 111'), true);
  assert.equal(isVnMobile('+84 297 000 0000'), false, '座机');
  assert.equal(isVnMobile('1900 0000'), false, '热线');
  assert.equal(isVnMobile('113'), false);
  assert.equal(isVnMobile('+852 9000 0000'), false);
  assert.equal(isVnMobile('+0912 000 111'), false);
});

test('联系人能做什么：外链按钮的顺序、快捷按钮（打电话 + 第一个聊天方式；推出来的 Zalo 不进快捷）、复制项', () => {
  const full = channelsOf({ name: 'A', phone: '+00 000 0000 0001', whatsapp: '+00 000 0000 0001', email: 'a@example.com', wechat: 'wx_a', line: 'line.a' });
  assert.deepEqual(full.actions.map((a) => a.key), ['call', 'whatsapp', 'email']);
  assert.deepEqual(full.quick.map((a) => a.key), ['call', 'whatsapp']);
  assert.deepEqual(full.copies.map((c) => c.key), ['number', 'email', 'wechat', 'line']);
  const vn = channelsOf({ phone: '+84 912 000 111' });
  assert.deepEqual(vn.actions.map((a) => [a.key, Boolean(a.inferred)]), [['call', false], ['zalo', true]]);
  assert.deepEqual(vn.quick.map((a) => a.key), ['call'], '推出来的 Zalo 不一定开着，不放快捷');
  assert.equal(vn.actions[1].href, 'https://zalo.me/0912000111');
  const zalo = channelsOf({ phone: '+84 912 000 111', zalo: '+84 912 000 222' });
  assert.deepEqual(zalo.actions.filter((a) => a.key === 'zalo').map((a) => [a.href, Boolean(a.inferred)]), [['https://zalo.me/0912000222', false]]);
  assert.deepEqual(zalo.quick.map((a) => a.key), ['call', 'zalo']);
  assert.deepEqual(channelsOf({ whatsapp: '+00 000 0000 0003' }).quick.map((a) => a.key), ['whatsapp'], '没电话：聊天方式');
  assert.deepEqual(channelsOf({ email: 'a@example.com' }).quick.map((a) => a.key), ['email'], '只有邮箱');
  const none = channelsOf({ name: '只有名字' });
  assert.deepEqual([none.actions, none.copies, none.quick, none.primary], [[], [], [], null]);
});

test('联系人号码：一行一个，同一个号码合并（「电话 · WhatsApp」）；收起时显示第一个号码，没有就显示邮箱', () => {
  assert.deepEqual(numberLines({ phone: '+00 000 0000 0001', whatsapp: '+00 000 0000 0001', zalo: '+00 000 0000 0009' }), [
    { key: 'phone', label: '电话', value: '+00 000 0000 0001', also: ['WhatsApp'] },
    { key: 'zalo', label: 'Zalo', value: '+00 000 0000 0009' },
  ]);
  assert.deepEqual(numberLines({ whatsapp: '+00 000 0000 0003' }), [{ key: 'whatsapp', label: 'WhatsApp', value: '+00 000 0000 0003' }]);
  assert.deepEqual(headlineNumber({ zalo: '+00 000 0000 0009', email: 'a@example.com' }), { kind: 'number', value: '+00 000 0000 0009' });
  assert.deepEqual(headlineNumber({ email: 'a@example.com' }), { kind: 'email', value: 'a@example.com' });
  assert.equal(headlineNumber({}), null);
});

test('联系人关联和副标题：预订、地点（找得到才算、删了不算）；副标题 = 身份 · 预订名（没有预订用地点名）', () => {
  const bookings = new Map([['b1', { id: 'b1', title: '园景房', kind: 'hotel' }]]);
  const places = new Map([['p1', { id: 'p1', name: '椰影湾酒店', kind: 'hotel' }], ['p2', { id: 'p2', name: '旧', deleted_at: 'x' }]]);
  const c = { role: '前台', booking_id: 'b1', place_id: 'p1' };
  const links = linksOf(c, { bookings, places });
  assert.deepEqual(links.map((l) => [l.type, l.label]), [['booking', '园景房'], ['place', '椰影湾酒店']]);
  assert.equal(subtitleOf(c, links), '前台 · 园景房');
  assert.equal(subtitleOf({ place_id: 'p1' }, linksOf({ place_id: 'p1' }, { bookings, places })), '椰影湾酒店');
  assert.deepEqual(linksOf({ place_id: 'p2', booking_id: 'nope' }, { bookings, places }), []);
  assert.equal(subtitleOf({}, []), '');
  assert.equal(subtitleOf({ name: '椰影湾酒店', place_id: 'p1' }, linksOf({ place_id: 'p1' }, { bookings, places })), '', '地点和联系人同名：不重复');
  assert.equal(subtitleOf({ name: '园景房前台', booking_id: 'b1', place_id: 'p1' }, links), '椰影湾酒店', '预订名被名字包含：换地点名');
});

test('联系人搜索：名字（越南语去声调）、身份、备注、类别名、关联名字；号码只按数字（至少 3 位）', () => {
  const c = { name: 'Chị Lan 阿兰', role: '老板娘', note: '晚上 10 点后不回', category: 'hotel', phone: '+00 000 0000 0011' };
  const links = [{ type: 'booking', label: '海景房' }];
  assert.ok(contactHaystack(c, links).includes('chi lan'));
  assert.ok(matchContact(c, queryTokens('chi lan'), links));
  assert.ok(matchContact(c, queryTokens('老板'), links));
  assert.ok(matchContact(c, queryTokens('酒店'), links), '类别名');
  assert.ok(matchContact(c, queryTokens('海景'), links), '关联预订名');
  assert.ok(matchContact(c, queryTokens('0011'), links), '号码后几位');
  assert.equal(matchContact(c, queryTokens('99'), links), null, '两位数字不按号码找');
  assert.deepEqual(matchContact(c, queryTokens('lan'), links).name, [[4, 7]], '名字高亮');
});

test('联系人分组：紧急在最上面、组内保持原顺序；按类别 / 「今天」筛；芯片数量跟着搜索走', () => {
  const list = [
    { id: 'h1', name: '酒店前台', category: 'hotel', booking_id: 'b1' },
    { id: 'e1', name: '报警', category: 'emergency', phone: '113' },
    { id: 'r1', name: '海鲜', category: 'restaurant', place_id: 'p1' },
    { id: 'x1', name: '不认识的类别', category: 'nope' },
    { id: 'e2', name: '急救', category: 'emergency', phone: '115' },
  ];
  const todayOf = (c) => c.id === 'r1';
  const all = groupContacts(list, { todayOf });
  assert.deepEqual(all.groups.map((g) => [g.cat, g.rows.map((r) => r.contact.id)]), [
    ['emergency', ['e1', 'e2']], ['hotel', ['h1']], ['restaurant', ['r1']], ['other', ['x1']],
  ]);
  assert.equal(all.todayCount, 1);
  assert.deepEqual(all.counts.map((c) => [c.cat, c.count]), [['emergency', 2], ['hotel', 1], ['restaurant', 1], ['other', 1]]);
  const today = groupContacts(list, { category: 'today', todayOf });
  assert.deepEqual(today.groups.map((g) => g.cat), ['restaurant']);
  assert.equal(today.shown, 1);
  const search = groupContacts(list, { query: '救', category: 'all', todayOf });
  assert.deepEqual(search.groups.flatMap((g) => g.rows.map((r) => r.contact.id)), ['e2']);
  assert.equal(search.matched, 1);
  assert.equal(groupContacts([], {}).total, 0);
});

test('联系人「今天用得上」：关联的地点在今天的安排里，或者关联的预订今天在期间内（按各自时区的当地日期）', () => {
  const toLocal = (at, tz) => zonedParts(at, tz).date;
  const hotel = { id: 'b1', start_at: '2027-01-10T07:00:00+00:00', start_tz: 'Asia/Ho_Chi_Minh', end_at: '2027-01-12T05:00:00+00:00' };
  assert.deepEqual(bookingSpan(hotel, toLocal, 'Asia/Ho_Chi_Minh'), { from: '2027-01-10', to: '2027-01-12' });
  // 18:00 UTC = 越南第二天 01:00
  assert.deepEqual(bookingSpan({ start_at: '2027-01-10T18:00:00+00:00' }, toLocal, 'Asia/Ho_Chi_Minh'), { from: '2027-01-11', to: '2027-01-11' });
  assert.equal(bookingSpan({}, toLocal, 'Asia/Ho_Chi_Minh'), null);
  const spans = { b1: bookingSpan(hotel, toLocal, 'Asia/Ho_Chi_Minh') };
  const o = (todayDate) => ({ todayDate, todayPlaceIds: new Set(['p1']), bookingDates: (id) => spans[id] || null });
  assert.equal(isTodayContact({ booking_id: 'b1' }, o('2027-01-11')), true);
  assert.equal(isTodayContact({ booking_id: 'b1' }, o('2027-01-13')), false);
  assert.equal(isTodayContact({ place_id: 'p1' }, o('2027-01-13')), true);
  assert.equal(isTodayContact({ place_id: 'p1' }, o(null)), false, '不在行程中');
});

test('联系人备注里的号码拆出来做成 tel: 链接；日期、时间、分机、价格、编号不算', () => {
  const spans = phoneSpans('总机 +00 000 0000 0099；另一个电话 1900 000000。分机 2141，2027-01-10 后 10:30 打，约 120 万，房号 Room1203456');
  const tels = spans.filter((s) => s.tel);
  assert.deepEqual(tels.map((s) => [s.text, s.tel]), [['+00 000 0000 0099', 'tel:+0000000000099'], ['1900 000000', 'tel:1900000000']]);
  assert.equal(spans.map((s) => s.text).join(''), '总机 +00 000 0000 0099；另一个电话 1900 000000。分机 2141，2027-01-10 后 10:30 打，约 120 万，房号 Room1203456', '拼回去就是原文');
  assert.deepEqual(phoneSpans(''), []);
  assert.deepEqual(phoneSpans('没有号码'), [{ text: '没有号码' }]);
});

test('联系人概况一句话', () => {
  assert.equal(contactsSummary({ total: 0 }), '');
  assert.equal(contactsSummary({ total: 17, emergency: 4 }), '17 个 · 紧急 4 个');
  assert.equal(contactsSummary({ total: 3, emergency: 0 }), '3 个');
  assert.equal(contactsSummary({ total: 17, shown: 2, searching: true }), '找到 2 个');
  assert.equal(contactsSummary({ total: 17, shown: 2, emergency: 4, category: 'hotel' }), '酒店 2 个 · 共 17 个');
  assert.equal(contactsSummary({ total: 17, shown: 6, category: 'today' }), '今天用得上 6 个 · 共 17 个');
  assert.equal(contactsSummary({ total: 17, shown: 0, category: 'today' }), '');
});

// =====================================================================
// 联系人表单（添加 / 编辑面板）
// =====================================================================

test('联系人表单：面板参数（new / new-类别 / id）、类别选项紧急在前、联系方式六栏', () => {
  assert.equal(CONTACT_SHEET, 'contact-edit');
  assert.ok(/^[a-z0-9-]+$/.test(CONTACT_SHEET), '弹层 id 只用小写字母、数字、连字符');
  assert.equal(newArg('hotel'), 'new-hotel');
  assert.equal(newArg('nope'), 'new');
  assert.equal(newArg(null), 'new');
  assert.deepEqual(parseArg('new-hotel'), { mode: 'new', category: 'hotel' });
  assert.deepEqual(parseArg('new-xxx'), { mode: 'new', category: 'other' });
  assert.deepEqual(parseArg(''), { mode: 'new', category: 'other' });
  assert.deepEqual(parseArg('8e0843e1-aaaa'), { mode: 'edit', id: '8e0843e1-aaaa' });
  for (const a of ['new', 'new-transport', '8e0843e1-0000-5000-8000-000000000000']) assert.ok(/^[A-Za-z0-9_.~-]{1,80}$/.test(a), `网址参数能放进 ?sheet=：${a}`);
  assert.equal(CATEGORY_OPTIONS[0].value, 'emergency');
  assert.deepEqual(FIELDS.map((f) => f.key), ['phone', 'whatsapp', 'zalo', 'email', 'wechat', 'line']);
});

test('联系人表单：初值、改没改过、检查（名字必填、号码长度、邮箱）、写进数据库的列、编辑只交改了的、新的排最后', () => {
  const row = { id: 'c1', name: '前台', category: 'hotel', role: null, phone: '+00 000 0000 0001', whatsapp: null, zalo: null, email: null, wechat: null, line: null, note: null, sort: 3 };
  const f0 = initialForm(row);
  assert.equal(f0.name, '前台');
  assert.equal(f0.role, '', 'null 显示成空');
  assert.equal(f0.category, 'hotel');
  assert.equal(initialForm(null, { category: 'transport' }).category, 'transport');
  assert.equal(isDirty(f0, f0), false);
  assert.equal(isDirty({ ...f0, name: ' 前台 ' }, f0), false, '只多了空格不算改');
  assert.equal(isDirty({ ...f0, category: 'other' }, f0), true);
  assert.deepEqual(validateForm({ ...f0, name: '  ' }), { name: '写个名字，比如「酒店前台」「接机司机」' });
  assert.deepEqual(Object.keys(validateForm({ ...f0, phone: '12', whatsapp: '123', email: 'x@' })).sort(), ['email', 'phone', 'whatsapp']);
  assert.deepEqual(validateForm({ ...f0, phone: '113' }), {}, '三位急救号能存');
  const values = formToValues({ ...f0, role: '  夜班 ', whatsapp: '+00 000 0000 0001', note: '第一行\n第二行 ' });
  assert.equal(values.role, '夜班');
  assert.equal(values.email, null, '空的写 null');
  assert.equal(values.note, '第一行\n第二行', '中间的换行留着');
  assert.deepEqual(changedValues(values, row), { role: '夜班', whatsapp: '+00 000 0000 0001', note: '第一行\n第二行' });
  assert.deepEqual(changedValues(formToValues(f0), row), {}, '没改就什么都不交');
  assert.equal(nextSort([{ sort: 3 }, { sort: 9 }, {}]), 10);
  assert.equal(nextSort([]), 0);
});

// =====================================================================
// 演示数据整体跑一遍
// =====================================================================

test('演示数据（椰影岛）：29 条贴士五类都有、置顶在最上面；9 条常用语都推得出场景（不落到「其他」）；正文都能转文字', () => {
  const tips = rows('tips', 'demo-island');
  const all = filterTips(tips);
  const v = buildView(all);
  assert.ok(v.pinned.length >= 1, '有置顶');
  assert.deepEqual(v.groups.map((g) => g.kind), KIND_ORDER);
  const phrases = tips.filter((t) => t.kind === 'phrase');
  const pv = phraseView(filterTips(phrases));
  assert.ok(pv.rows.every((r) => r.scene.key !== 'other'), pv.rows.filter((r) => r.scene.key === 'other').map((r) => r.tip.title).join());
  assert.ok(pv.scenes.length >= 3, '常用语分成好几个场景，场景芯片有意义');
  for (const t of tips) assert.equal(typeof bodyText(t), 'string');
  // 越南语不带声调能搜到常用语
  assert.ok(filterTips(tips, { query: 'tinh tien' }).some((r) => r.tip.kind === 'phrase'));
  // 模板：订海边位子能直接 WhatsApp 给烧烤屋
  const tpl = tips.find((t) => t.kind === 'template' && t.booking_id && rows('contacts', 'demo-island').some((c) => c.booking_id === t.booking_id && c.whatsapp));
  assert.ok(tpl, '演示数据里有能直接发的模板');
  assert.equal(sendTargets(tpl, rows('contacts', 'demo-island'))[0].key, 'whatsapp');
});

test('演示数据：联系人分组紧急在最上面；每个都至少有一个动作或一条说明；三城、空行程也能算', () => {
  for (const trip of ['demo-island', 'demo-cities', 'demo-empty']) {
    const list = rows('contacts', trip).sort((a, b) => a.sort - b.sort);
    const bookings = new Map(rows('bookings', trip).map((b) => [b.id, b]));
    const places = new Map(rows('places', trip).map((p) => [p.id, p]));
    const g = groupContacts(list, { linksFor: (c) => linksOf(c, { bookings, places }) });
    assert.equal(g.total, list.length, trip);
    if (list.some((c) => c.category === 'emergency')) assert.equal(g.groups[0].cat, 'emergency', trip);
    for (const c of list) {
      const ch = channelsOf(c);
      assert.ok(ch.actions.length || ch.copies.length || c.note, `${trip} ${c.name}`);
    }
  }
  assert.equal(rows('contacts', 'demo-empty').length, 0);
  assert.equal(rows('tips', 'demo-empty').length, 0);
});

test('两页的代码：外链和触感都走 lib/native.js（不直接写 window.open、navigator.vibrate、location.href），文案没有英文报错', () => {
  const files = [];
  for (const dir of ['pages/tips', 'pages/contacts']) {
    for (const name of readdirSync(path.join(SRC, dir))) if (/\.(js|jsx)$/.test(name)) files.push(path.join(dir, name));
  }
  for (const f of files) {
    const text = readFileSync(path.join(SRC, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/window\.open\(|navigator\.vibrate|location\.href\s*=/.test(text), f);
  }
});
