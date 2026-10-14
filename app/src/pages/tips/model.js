// =====================================================================
// pages/tips/model.js：贴士与常用语页的纯逻辑（Node 里能直接测：test/unit/page-tips.test.js）。
//
//   KIND_ORDER / kindTitle / normalizeTipKind     五种贴士的顺序和中文名（防坑、小贴士、实用信息、消息模板、常用语）
//   bodyText / previewText / needsExpand           正文转纯文字、收起时的预览、长不长（要不要“原地展开”）
//   tipHaystack / matchTip / filterTips            本页搜索：中文子串、越南语不带声调（kit/search/fold.js 同一套折叠）
//   buildView                                      置顶 + 按类型分组（筛选某一类时置顶的也放回那一组）
//   kindCounts                                     筛选芯片的数量
//   rendersExpandable                              这一条在页面上是不是一张能原地展开的卡（网址 ?tip= 进来时先展开它）
//   isLongLocal                                    原文太长（先收起，「显示全文」）
//   PHRASE_SCENES / phraseScene / phraseView       常用语的场景（打车、吃饭、买东西……）：先看 tags，没有再按字推断
//   relatedOf                                      贴士关联的天 / 地点 / 预订 / 分段（「相关」那一行）
//   isToday                                        今天用得上（day_id 是今天，或者关联的地点在今天的安排里）
//   sendTargets / waSendHref / zaloChatHref / mailSendHref   模板发给谁：同一个预订 / 地点的联系人（WhatsApp 预填原文、邮件预填、Zalo 先复制）
//                                                  号码规则和联系人页同一套（pages/contacts/model.js）
//   isEmergencyTip                                 紧急类贴士（显示「联系人 · 紧急电话」入口）
//   langLabel / tipLang                            local_lang → 「越南语」「英文」；没写 local_lang 时按原文猜（越南语字母 / 中文 / 其他当英文）
// =====================================================================

import { markdownToText } from '../../lib/markdown.js';
import { formatMonthDay } from '../../lib/datetime.js';
import { foldText, queryTokens, findRanges } from '../../kit/search/fold.js';
import { phoneDigits, waHref, zaloHref, mailHref } from '../contacts/model.js';

/** 分组顺序（SPEC §5.10） */
export const KIND_ORDER = Object.freeze(['warning', 'tip', 'info', 'template', 'phrase']);

/** 中文名（和 kit/kinds.js 的 KIND_LABELS.tip 一致，单元测试核对） */
export const KIND_TITLES = Object.freeze({
  warning: '防坑', tip: '小贴士', info: '实用信息', template: '消息模板', phrase: '常用语',
});

/** 不认识的 kind 按数据库默认值当「小贴士」 */
export function normalizeTipKind(kind) {
  return Object.hasOwn(KIND_TITLES, kind) ? kind : 'tip';
}

export function kindTitle(kind) {
  return KIND_TITLES[normalizeTipKind(kind)];
}

/** 网址 ?kind= 的值 → 'all' 或一种 kind */
export function normalizeFilter(value) {
  return Object.hasOwn(KIND_TITLES, value) ? value : 'all';
}

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// ---------------------------------------------------------------------
// 正文
// ---------------------------------------------------------------------

/** 正文的纯文字（去掉 ** 和链接语法，列表换成 •） */
export function bodyText(tip) {
  return has(tip?.body) ? markdownToText(tip.body).trim() : '';
}

/** 收起时预览：段落、列表摊成一行（「• 」换成「 · 」），最多 limit 个字 */
export function previewText(tip, limit = 90) {
  const text = bodyText(tip)
    .replace(/\n+• /g, ' · ')
    .replace(/^• /, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/[\s，。、；：,.;:·]+$/u, '')}…`;
}

/** 正文多长以内整段直接显示（手机上大约 5–6 行）；再长就收起来、点开看全文 */
export const SHORT_BODY = 120;

/**
 * 正文长到收起时看不全（要原地展开）：超过 SHORT_BODY 个字、不止一段、或者有列表。
 * 短的贴士（防坑提醒大多一两句）直接整段显示，不做一个点开只多出几个字的展开。
 */
export function needsExpand(tip) {
  const t = bodyText(tip);
  if (!t) return false;
  return t.length > SHORT_BODY || /\n/.test(t);
}

/**
 * 这一条在页面上是不是一张能原地展开的卡：
 *   消息模板、常用语有自己的卡（原文一直看得见），不展开——除非它被置顶、在「看全部」时放进了置顶卡（置顶卡里一行一条，长的、有原文的点开看）；
 *   防坑 / 小贴士 / 实用信息：正文长（needsExpand）或者带原文的才展开，短的整段直接显示。
 * @param {object} tip
 * @param {{ kind?: string }} [o] 当前的类型筛选（'all' 时置顶的在置顶卡里）
 */
export function rendersExpandable(tip, { kind = 'all' } = {}) {
  if (!tip) return false;
  const k = normalizeTipKind(tip.kind);
  const inPinnedCard = kind === 'all' && Boolean(tip.pinned);
  if ((k === 'template' || k === 'phrase') && !inPinnedCard) return false;
  return needsExpand(tip) || has(tip.local_text);
}

/** 原文超过多少字 / 行就先收起（「显示全文」） */
export const LOCAL_CLAMP_CHARS = 200;
export const LOCAL_CLAMP_LINES = 6;

export function isLongLocal(text) {
  const s = String(text || '');
  return s.length > LOCAL_CLAMP_CHARS || s.split('\n').length > LOCAL_CLAMP_LINES;
}

// ---------------------------------------------------------------------
// 搜索（本页）
// ---------------------------------------------------------------------

/**
 * 一条贴士能被搜到的文字：标题、当地语原文、正文、标签、关联的地点名 / 预订名（折叠后）。
 * @param {object} tip
 * @param {{ placeName?: (id) => string|null, bookingTitle?: (id) => string|null }} [ctx]
 */
export function tipHaystack(tip, ctx = {}) {
  const parts = [
    tip?.title, tip?.local_text, bodyText(tip), ...(Array.isArray(tip?.tags) ? tip.tags : []),
    tip?.place_id && ctx.placeName ? ctx.placeName(tip.place_id) : null,
    tip?.booking_id && ctx.bookingTitle ? ctx.bookingTitle(tip.booking_id) : null,
    kindTitle(tip?.kind),
  ];
  return foldText(parts.filter(has).join('\n'));
}

/**
 * 正文里命中的一小段（标题、原文都没命中时给预览用）：命中处前后各 radius 个字，两头省略号。
 * @returns {{ text: string, ranges: Array<[number, number]> } | null}
 */
export function bodySnippet(tip, tokens, radius = 24) {
  const flat = bodyText(tip).replace(/\s*\n+\s*/g, ' ');
  const ranges = findRanges(flat, tokens);
  if (!ranges.length) return null;
  const [s] = ranges[0];
  const from = Math.max(0, s - radius);
  const to = Math.min(flat.length, s + radius * 2);
  const head = from > 0 ? '…' : '';
  const tail = to < flat.length ? '…' : '';
  const text = `${head}${flat.slice(from, to)}${tail}`;
  const shift = head.length - from;
  return {
    text,
    ranges: ranges.filter(([a, b]) => a >= from && b <= to).map(([a, b]) => [a + shift, b + shift]),
  };
}

/**
 * 这条贴士命中查询吗：每个词都要在（折叠后的）标题、原文、正文、标签、关联名字里出现。
 * 命中时返回高亮位置：title / local（原文）的区间，正文命中时的 snippet。
 * @returns {null | { title: Array<[number,number]>, local: Array<[number,number]>, snippet: null|{ text, ranges } }}
 */
export function matchTip(tip, tokens, ctx = {}) {
  if (!tokens?.length) return { title: [], local: [], snippet: null };
  const hay = tipHaystack(tip, ctx);
  if (!tokens.every((t) => hay.includes(t))) return null;
  const title = findRanges(tip.title || '', tokens);
  const local = findRanges(tip.local_text || '', tokens);
  const snippet = !title.length && !local.length ? bodySnippet(tip, tokens) : null;
  return { title, local, snippet };
}

/**
 * 按种类、搜索筛选。
 * @returns {Array<{ tip, hit }>}（原来的顺序：置顶在前，再按 sort）
 */
export function filterTips(tips, { kind = 'all', query = '', ctx = {} } = {}) {
  const tokens = queryTokens(query);
  const out = [];
  for (const tip of tips || []) {
    if (kind !== 'all' && normalizeTipKind(tip.kind) !== kind) continue;
    const hit = matchTip(tip, tokens, ctx);
    if (hit) out.push({ tip, hit });
  }
  return out;
}

/** 芯片上的数量：每一类有几条（跟着搜索走）；没有的类不出芯片 */
export function kindCounts(rows) {
  const n = Object.fromEntries(KIND_ORDER.map((k) => [k, 0]));
  for (const r of rows) n[normalizeTipKind(r.tip.kind)] += 1;
  return KIND_ORDER.map((k) => ({ kind: k, label: KIND_TITLES[k], count: n[k] }));
}

/**
 * 页面上怎么摆：
 *   - 看全部时：置顶的放在最上面一张卡里（不分类型），其余按 KIND_ORDER 分组；
 *   - 只看某一类时：不单独放置顶卡，置顶的排在那一组最前面（带「置顶」小标）。
 * @param {Array<{ tip, hit }>} rows filterTips 的结果
 * @param {{ kind?: string }} [o]
 * @returns {{ pinned: Array<{tip,hit}>, groups: Array<{ kind, label, rows: Array<{tip,hit}> }> }}
 */
export function buildView(rows, { kind = 'all' } = {}) {
  const pinned = kind === 'all' ? rows.filter((r) => r.tip.pinned) : [];
  const rest = kind === 'all' ? rows.filter((r) => !r.tip.pinned) : rows;
  const groups = [];
  for (const k of KIND_ORDER) {
    const list = rest.filter((r) => normalizeTipKind(r.tip.kind) === k);
    // 置顶的在组里排前面（sortedTips 已经是置顶在前，这里保险再排一次，保持原来的相对顺序）
    list.sort((a, b) => Number(Boolean(b.tip.pinned)) - Number(Boolean(a.tip.pinned)));
    if (list.length) groups.push({ kind: k, label: KIND_TITLES[k], rows: list });
  }
  return { pinned, groups };
}

// ---------------------------------------------------------------------
// 常用语的场景
// ---------------------------------------------------------------------

/**
 * 场景（顺序 = 显示顺序，最常用的在前；推断时按 INFER_ORDER 的先后，更具体的先判断）。tags 里写了这些名字或同义词就归这一类；
 * 没写 tags 时按标题、说明、原文里的字推断（words 是中文子串；vi 是折叠后的越南语 / 英文词，按整词匹配）。
 */
export const PHRASE_SCENES = Object.freeze([
  {
    key: 'polite', label: '礼貌', glyph: 'message',
    synonyms: ['礼貌', '打招呼', '寒暄', '基本', '常用'],
    words: ['你好', '谢谢', '不用', '对不起', '不好意思', '再见', '没关系', '请问', '是的', '不是'],
    vi: ['xin chao', 'cam on', 'xin loi', 'tam biet', 'khong sao', 'hello', 'thank'],
  },
  {
    key: 'taxi', label: '打车', glyph: 'car',
    synonyms: ['打车', '交通', '叫车', '出租车', '司机', 'grab', '坐车'],
    words: ['打车', '打表', '司机', '叫车', '上车', '下车', '停车', '停在', '靠边', '掉头', '送我', '机场', '车站', '码头', '开慢', '慢一点'],
    vi: ['taxi', 'driver', 'meter', 'tai xe', 'dong ho', 'cho toi den', 'dung xe', 'xe'],
  },
  {
    key: 'food', label: '吃饭', glyph: 'bowl',
    synonyms: ['吃饭', '吃', '餐厅', '美食', '点菜', '饮料', '咖啡', '餐饮'],
    words: ['吃', '喝', '菜单', '点菜', '买单', '结账', '埋单', '不要冰', '少冰', '加冰', '冰', '糖', '辣', '香菜', '订位', '位子', '座位', '打包', '外带', '咖啡', '啤酒', '饮料', '海鲜', '餐'],
    vi: ['tinh tien', 'thuc don', 'menu', 'khong da', 'it da', 'duong', 'khong cay', 'cay', 'ngo', 'ca phe', 'bia', 'mang ve', 'dat ban', 'bill'],
  },
  {
    key: 'shop', label: '买东西', glyph: 'bag',
    synonyms: ['买东西', '购物', '买', '砍价', '讲价', '钱', '付款', '市场'],
    words: ['多少钱', '贵', '便宜', '讲价', '砍价', '买', '刷卡', '现金', '找零', '公斤', '一斤', '收据', '发票', '电话卡', '尺码', '试穿', '换钱'],
    vi: ['bao nhieu', 'dat qua', 'tien mat', 'kg', 'sim'],
  },
  {
    key: 'ask', label: '问路', glyph: 'nav',
    synonyms: ['问路', '方向', '找路', '路'],
    words: ['在哪', '哪里', '怎么走', '怎么去', '洗手间', '厕所', '卫生间', '远吗', '多远', '左转', '右转', '直走', '附近', '入口', '出口'],
    vi: ['o dau', 've sinh', 'toilet', 'where', 'ben trai', 'ben phai', 'di thang'],
  },
  {
    key: 'massage', label: '按摩', glyph: 'spa',
    synonyms: ['按摩', '洗头', 'spa', '美容'],
    words: ['按摩', '洗头', '吹干', '吹头', '力度', '轻一点', '重一点', '水温', '温水', '精油'],
    vi: ['massage', 'goi dau', 'nhe', 'manh'],
  },
  {
    key: 'urgent', label: '紧急', glyph: 'siren',
    synonyms: ['紧急', '急救', '医疗', '求助', '安全', '医院'],
    words: ['救命', '救护车', '急救', '医院', '医生', '警察', '报警', '过敏', '不舒服', '受伤', '疼', '丢了', '被偷', '帮帮我', '药'],
    vi: ['cap cuu', 'cuu', 'benh vien', 'bac si', 'cong an', 'canh sat', 'di ung', 'thuoc', 'help'],
  },
]);

/** 按字推断时的先后：紧急最先（「吃药」不该算吃饭），买单这类先算吃饭再算买东西 */
export const INFER_ORDER = Object.freeze(['urgent', 'taxi', 'massage', 'ask', 'food', 'shop', 'polite']);

/** 推断不出来的 */
export const OTHER_SCENE = Object.freeze({ key: 'other', label: '其他', glyph: 'languages' });

const SCENE_BY_KEY = new Map(PHRASE_SCENES.map((s) => [s.key, s]));

/** 一段折叠后的文字里有没有这个词（整词：前后不是字母数字） */
function hasWord(folded, word) {
  let from = 0;
  for (;;) {
    const at = folded.indexOf(word, from);
    if (at === -1) return false;
    const before = folded[at - 1];
    const after = folded[at + word.length];
    if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true;
    from = at + 1;
  }
}

/**
 * 常用语属于哪个场景：{ key, label, glyph, custom? }。
 *   1. tags 里第一个认得的（场景名或同义词，比如「交通」→ 打车）；
 *   2. tags 里有别的字（不在上面的场景和同义词里）：直接用这个标签当一组（key = 'tag:<标签>'，custom: true）；
 *   3. 都没有：按标题和说明（中文）、原文（越南语 / 英文，整词）推断；
 *   4. 还推断不出来：「其他」。
 */
export function phraseScene(tip) {
  const tags = (Array.isArray(tip?.tags) ? tip.tags : []).map((t) => String(t).trim()).filter(Boolean);
  for (const tag of tags) {
    const f = foldText(tag);
    const hit = PHRASE_SCENES.find((s) => s.label === tag || s.synonyms.some((w) => foldText(w) === f));
    if (hit) return hit;
  }
  if (tags.length) return { key: `tag:${tags[0]}`, label: tags[0], glyph: 'languages', custom: true };
  const zh = `${tip?.title || ''} ${bodyText(tip)}`;
  const local = foldText(tip?.local_text || '');
  const ordered = INFER_ORDER.map((k) => SCENE_BY_KEY.get(k));
  // 先只看标题（最能说明这句话是干什么的），再看说明，最后看原文
  for (const s of ordered) if (s.words.some((w) => String(tip?.title || '').includes(w))) return s;
  for (const s of ordered) if (s.words.some((w) => zh.includes(w))) return s;
  for (const s of ordered) if (s.vi.some((w) => hasWord(local, w))) return s;
  return OTHER_SCENE;
}

/**
 * 常用语按场景排好、数好：
 * @returns {{ rows: Array<{ tip, hit, scene }>, scenes: Array<{ key, label, glyph, count }> }}
 *   rows 按场景顺序（PHRASE_SCENES → 自定义标签按出现先后 → 其他），同一场景里保持原来的顺序
 */
export function phraseView(rows) {
  const withScene = rows.map((r) => ({ ...r, scene: phraseScene(r.tip) }));
  const order = new Map(PHRASE_SCENES.map((s, i) => [s.key, i]));
  const customOrder = new Map();
  for (const r of withScene) if (r.scene.custom && !customOrder.has(r.scene.key)) customOrder.set(r.scene.key, customOrder.size);
  const rank = (s) => (order.has(s.key) ? order.get(s.key) : s.custom ? 100 + customOrder.get(s.key) : 1000);
  const sorted = withScene
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.scene) - rank(b.r.scene) || a.i - b.i)
    .map((x) => x.r);
  const scenes = [];
  for (const r of sorted) {
    const last = scenes[scenes.length - 1];
    if (last && last.key === r.scene.key) last.count += 1;
    else scenes.push({ key: r.scene.key, label: r.scene.label, glyph: r.scene.glyph, count: 1 });
  }
  return { rows: sorted, scenes };
}

/** 网址 ?scene= → 认得的场景 key，不认得 'all' */
export function normalizeScene(value, scenes) {
  return scenes.some((s) => s.key === value) ? value : 'all';
}

/** 常用语卡片要不要占满一行（原文长：两列放不下） */
export function phraseWide(tip) {
  return String(tip?.local_text || '').length > 34;
}

export function sceneOf(key) {
  return SCENE_BY_KEY.get(key) || null;
}

// ---------------------------------------------------------------------
// 关联：天、地点、预订、分段
// ---------------------------------------------------------------------

/**
 * 贴士关联到哪里（「相关」那一行的小胶囊，按 天 → 地点 → 预订 → 分段）：
 *   { type: 'day', id, date, label: 'D2 · 1月11日' } → 点了去那天
 *   { type: 'place', id, label } → 点了开地点详情
 *   { type: 'booking', id, label, kind } → 点了开预订详情
 *   { type: 'segment', id, label } → 只显示（不可点）
 * 找不到的（被删了）不显示。
 * @param {object} tip
 * @param {{ days: Map|Array, places: Map|Array, bookings: Map|Array, segments: Map|Array, dayNumber?: (date) => number|null }} ctx
 */
export function relatedOf(tip, ctx = {}) {
  const get = (coll, id) => {
    if (!id || !coll) return null;
    if (coll instanceof Map) return coll.get(id) || null;
    return coll.find((x) => x.id === id) || null;
  };
  const out = [];
  const day = get(ctx.days, tip?.day_id);
  if (day) {
    const n = ctx.dayNumber ? ctx.dayNumber(day.date) : null;
    const md = monthDay(day.date);
    out.push({ type: 'day', id: day.id, date: day.date, label: [n ? `D${n}` : null, md].filter(Boolean).join(' · ') || '那一天' });
  }
  const place = get(ctx.places, tip?.place_id);
  if (place && !place.deleted_at) out.push({ type: 'place', id: place.id, label: place.name || place.name_local || '地点', kind: place.kind });
  const booking = get(ctx.bookings, tip?.booking_id);
  if (booking) out.push({ type: 'booking', id: booking.id, label: booking.title || '预订', kind: booking.kind });
  const seg = get(ctx.segments, tip?.segment_id);
  if (seg) out.push({ type: 'segment', id: seg.id, label: seg.title || seg.name || '这一段' });
  return out;
}

/** '2027-01-11' → '1月11日' */
export function monthDay(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? formatMonthDay(date) : '';
}

/**
 * 今天用得上：行程进行中，贴士关联的那天就是今天，或者关联的地点在今天的安排里。
 * @param {object} tip
 * @param {{ todayDayId?: string|null, todayPlaceIds?: Set<string> }} o
 */
export function isToday(tip, { todayDayId = null, todayPlaceIds = null } = {}) {
  if (!todayDayId) return false;
  if (tip?.day_id) return tip.day_id === todayDayId;
  return Boolean(tip?.place_id && todayPlaceIds?.has(tip.place_id));
}

/** 紧急类：标签或标题里有「紧急」「急救」「报警」 */
export function isEmergencyTip(tip) {
  const text = `${tip?.title || ''} ${(tip?.tags || []).join(' ')}`;
  return /紧急|急救|报警|领事|医院/.test(text);
}

// ---------------------------------------------------------------------
// 模板发给谁
// ---------------------------------------------------------------------

export { phoneDigits };

/** WhatsApp 预填消息：https://wa.me/<数字>?text=<原文>；号码太短返回 null */
export function waSendHref(number, text) {
  const base = waHref(number);
  if (!base) return null;
  return has(text) ? `${base}?text=${encodeURIComponent(String(text))}` : base;
}

/** Zalo 聊天：https://zalo.me/<号码>（越南号码 +84 换成本地写法 0…，和联系人页、预订详情一致）；Zalo 的链接不能预填文字 */
export function zaloChatHref(number) {
  return zaloHref(number);
}

/** 邮件：mailto:<地址>?subject=…&body=…（地址不像邮箱返回 null） */
export function mailSendHref(email, { subject, body } = {}) {
  const base = mailHref(email);
  if (!base) return null;
  const q = [];
  if (has(subject)) q.push(`subject=${encodeURIComponent(subject)}`);
  if (has(body)) q.push(`body=${encodeURIComponent(body)}`);
  return `${base}${q.length ? `?${q.join('&')}` : ''}`;
}

/**
 * 消息模板可以直接发给谁：和模板同一个预订（booking_id）或同一个地点（place_id）的联系人，有 WhatsApp / Zalo / 邮箱的。
 * 每个联系人最多一个方式（WhatsApp 能预填原文最好 → Zalo（先复制原文）→ 邮件（预填））；最多 2 个联系人。
 * @returns {Array<{ key: 'whatsapp'|'zalo'|'email', contact, href, label, copyFirst: boolean }>}
 */
export function sendTargets(tip, contacts, { limit = 2 } = {}) {
  if (!tip || !has(tip.local_text)) return [];
  const list = (contacts || []).filter((c) => (tip.booking_id && c.booking_id === tip.booking_id) || (tip.place_id && c.place_id === tip.place_id));
  // 同一个预订的排在同一个地点的前面
  list.sort((a, b) => Number(Boolean(tip.booking_id && b.booking_id === tip.booking_id)) - Number(Boolean(tip.booking_id && a.booking_id === tip.booking_id)));
  const out = [];
  for (const c of list) {
    const wa = waSendHref(c.whatsapp, tip.local_text);
    if (wa) {
      out.push({ key: 'whatsapp', contact: c, href: wa, label: 'WhatsApp 发送', copyFirst: false });
    } else if (zaloChatHref(c.zalo)) {
      out.push({ key: 'zalo', contact: c, href: zaloChatHref(c.zalo), label: 'Zalo 发送', copyFirst: true });
    } else {
      const mail = mailSendHref(c.email, { subject: tip.title, body: tip.local_text });
      if (mail) out.push({ key: 'email', contact: c, href: mail, label: '发邮件', copyFirst: false });
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------

const LANG_NAMES = Object.freeze({
  vi: '越南语', en: '英文', 'zh-CN': '中文', 'zh-TW': '繁体中文', zh: '中文', ja: '日文', ko: '韩文', th: '泰文', fr: '法文',
});

/** 越南语才有的字母（带声调、帽子的元音和 đ）；只看小写，调用前先转小写 */
const VI_LETTERS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/u;
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u;

/**
 * 原文是什么语言（BCP 47）：写了 local_lang 就用它；没写按字猜——有越南语字母是 'vi'，有汉字是 'zh'，其他当 'en'；没有原文返回 null。
 * 用在 lang 属性（读屏、断词、字形）和「读出来」挑声音。
 */
export function tipLang(tip) {
  if (has(tip?.local_lang)) return String(tip.local_lang).trim();
  const text = String(tip?.local_text || '');
  if (!text.trim()) return null;
  const lower = text.toLowerCase();
  if (VI_LETTERS.test(lower)) return 'vi';
  if (CJK.test(text)) return 'zh';
  return 'en';
}

/** local_lang → 中文名（不认识返回 null） */
export function langLabel(lang) {
  if (!has(lang)) return null;
  const l = String(lang).trim();
  return LANG_NAMES[l] || LANG_NAMES[l.split('-')[0]] || null;
}

/** 页面上方那一句概况：「40 条 · 置顶 2 条」/ 只看一类「常用语 6 条 · 共 40 条」/ 搜索时「找到 3 条」 */
export function summaryLine({ total, shown, pinned, searching, kind = 'all' }) {
  if (!total) return '';
  if (searching) return shown ? `找到 ${shown} 条` : '';
  if (kind !== 'all') return shown ? `${kindTitle(kind)} ${shown} 条 · 共 ${total} 条` : '';
  return pinned ? `${total} 条 · 置顶 ${pinned} 条` : `${total} 条`;
}
