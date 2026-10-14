// =====================================================================
// pages/lists/model.js：清单页（SPEC §5.7）和待办弹层（sheets/todo）共用的纯逻辑（Node 里能直接测，test/unit/page-lists.test.js）。
//
//   四个清单的名字和文案      LISTS、LIST_IDS、normalizeList、defaultList
//   进度                      progressOf、tabBadge
//   截止时间提醒              dueInfo（过期 / 不到 1 天 / 1–3 天 / 更晚）、dueSummary、zoneNote（卡片头说一次「按越南时间」）、
//                             deviceEquivalent（弹层里顺带换算成这台设备的时间）
//   勾完的沉到下面            splitRows（hold：刚勾的先留在原位一会儿再沉）
//   打包按分类分组 + 谁的东西  categoryOf、packingGroups、ownerOptions、normalizeWho、matchOwner
//   快速添加                  inferCategory（按关键字猜分类）、newTodoValues、nextSort、STARTER_PACKING
//   数量单位                  inferUnit（「3 件」「2 双」，拿不准就不写单位）
//   关联的小链接              linkChips（预订 / 条目 / 哪天）
//   勾的人和时间              doneByline
//   备注里的电话 / 邮箱 / 网址 noteParts、noteActions（行里的「打电话 / WhatsApp / 邮件 / 网页」小胶囊）
//
// 依赖：lib/datetime.js（时区换算、日期说法）、kit/status.js 的 formatLeft（「2 天 3 小时」，和免费取消倒计时同一种说法）。
// =====================================================================

import {
  formatInstant, formatDate, formatRelativeTime, tzOffsetMinutes, timeZoneLabel, tzDifferenceLabel, zonedParts, addDays, zonedToInstant,
} from '../../lib/datetime.js';
import { formatLeft } from '../../kit/status.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------
// 四个清单
// ---------------------------------------------------------------------

/** 标签的先后（SPEC §5.7：待确认 / 待办 / 打包 / 要买）——和 data/selectors.js 的 TODO_LISTS（数据层的固定顺序）不是一回事 */
export const LIST_IDS = Object.freeze(['confirm', 'todo', 'packing', 'buy']);

/**
 * 每个清单的文案。unit：量词；countUnit：大数字后面那半句（「还有 5 件没装」）；verb：勾完以后的说法（「已装好 3 件 · 撤销」）。
 * newTitle / editTitle：待办弹层的标题；placeholder：快速添加的提示；who：负责人那一栏叫什么。
 */
export const LISTS = Object.freeze({
  confirm: Object.freeze({
    id: 'confirm', label: '待确认', glyph: 'check-circle', unit: '项', countUnit: '项要确认', verb: '已确认',
    placeholder: '加一项待确认，回车接着加', addLabel: '添加要确认的事',
    newTitle: '加一项要确认的事', editTitle: '编辑待确认',
    titlePlaceholder: '例如：等酒店确认订单',
    emptyTitle: '没有要确认的事', emptyDesc: '等酒店回复、到店付款、和司机约时间……要和别人确认的事记在这里，可以关联预订。',
    doneTitle: '都确认好了', doneDesc: (n) => `${n} 项都确认过了，安心出发。`,
    doneSection: '已确认',
  }),
  todo: Object.freeze({
    id: 'todo', label: '待办', glyph: 'checklist', unit: '件', countUnit: '件事要办', verb: '已完成',
    placeholder: '加一项待办，回车接着加', addLabel: '添加待办',
    newTitle: '加一项待办', editTitle: '编辑待办',
    titlePlaceholder: '例如：去程网上值机',
    emptyTitle: '没有待办', emptyDesc: '值机、换钱、下载离线地图……要做的事随手记下，到期前会提醒。',
    doneTitle: '待办都办完了', doneDesc: (n) => `${n} 件事都办好了。`,
    doneSection: '已完成',
  }),
  packing: Object.freeze({
    id: 'packing', label: '打包', glyph: 'suitcase', unit: '件', countUnit: '件没装', verb: '已装好',
    placeholder: '加一件要带的，回车接着加', addLabel: '添加打包项',
    newTitle: '加一件要带的', editTitle: '编辑打包项',
    titlePlaceholder: '例如：转换插头',
    emptyTitle: '打包清单还是空的', emptyDesc: '证件、衣物、电子、洗护、药品……按分类记下要带的东西，数量用步进器调。',
    doneTitle: '行李收拾好了', doneDesc: (n) => `${n} 件都装好了，出发吧。`,
    doneSection: '已装好',
  }),
  buy: Object.freeze({
    id: 'buy', label: '要买', glyph: 'bag', unit: '样', countUnit: '样要买', verb: '已买到',
    placeholder: '加一样要买的，回车接着加', addLabel: '添加要买的',
    newTitle: '加一样要买的', editTitle: '编辑要买的',
    titlePlaceholder: '例如：咖啡豆',
    emptyTitle: '没有要买的', emptyDesc: '伴手礼、特产、药妆……想买的先记下，买到了勾掉。',
    doneTitle: '都买齐了', doneDesc: (n) => `${n} 样都买到了。`,
    doneSection: '已买到',
  }),
});

/** 合法的清单 id；不认识的返回 null */
export function normalizeList(v) {
  return LIST_IDS.includes(v) ? v : null;
}

/**
 * 没指定标签时先看哪个清单：
 *   出发前 / 日期未定：待确认 → 待办 → 打包 → 要买；进行中：待办 → 要买 → 待确认 → 打包；结束后：要买 → 待办 → …
 * 按这个顺序第一个还有没勾的；都勾完了就第一个有内容的；一条都没有 → 待办。
 * @param {Map<string, object[]>|Record<string, object[]>} byList
 * @param {{ phase?: string }} [o]
 */
export function defaultList(byList, { phase } = {}) {
  const get = (l) => (byList instanceof Map ? byList.get(l) : byList?.[l]) || [];
  const order = phase === 'ongoing' ? ['todo', 'buy', 'confirm', 'packing']
    : phase === 'ended' ? ['buy', 'todo', 'confirm', 'packing']
      : LIST_IDS;
  return order.find((l) => get(l).some((t) => !t.done)) || order.find((l) => get(l).length) || 'todo';
}

// ---------------------------------------------------------------------
// 进度
// ---------------------------------------------------------------------

/** { total, done, remaining, ratio } */
export function progressOf(rows = []) {
  const total = rows.length;
  const done = rows.filter((r) => r.done).length;
  return { total, done, remaining: total - done, ratio: total ? done / total : 0 };
}

/** 标签上的进度「3/7」；一条都没有时不显示 */
export function tabBadge(p) {
  return p?.total ? `${p.done}/${p.total}` : null;
}

// ---------------------------------------------------------------------
// 截止时间
// ---------------------------------------------------------------------

/** 截止前多久算“快到了”（警示色）、多久算“马上”（红色）——和免费取消倒计时一致（kit/status.js） */
export const DUE_SOON_MS = 3 * DAY;
export const DUE_URGENT_MS = DAY;

/** 设备所在时区和行程时区此刻差不差（出发前人在香港、看的是越南时间） */
export function zonesDiffer(deviceZone, timeZone, at = new Date()) {
  return Boolean(deviceZone && timeZone && tzOffsetMinutes(deviceZone, at) !== tzOffsetMinutes(timeZone, at));
}

/**
 * 截止时间的说法和语气（时间按行程时区显示）。
 *   已经过了   → overdue  danger   「已过期 · 1月8日 23:59」
 *   不到 1 天  → urgent   danger   「还剩 5 小时 · 今天 23:59 前」
 *   1–3 天     → soon     warning  「还剩 2 天 3 小时 · 1月9日 07:05 前」
 *   更晚       → later    neutral  「1月12日 20:00 前」
 *   已完成     → done     neutral  「1月12日 20:00 前」（不再提醒）
 * parts：页面上按「 · 」分开的几段（每段自己不折行，只在两段之间折行：「还剩 2 天 14 小时」「10月17日 00:00 前」）。
 * 时区（10-14 现场走查 P1-1）：传了 displayZone（那一刻人在哪个时区，store.presenceZone(due)）时，钟点按它写——
 * 出发前的截止（人还在香港）写香港钟点；这时只要显示的时区和行程时区不同、或者和人此刻所在的时区（hereZone）不同，
 * zone =「香港时间」/「越南时间」，行里跟一个小标签（zoneTag），label 最后注明「（香港时间）」。
 * 没传 displayZone（旧写法）：按行程时区写，设备时区不同时 zone =「越南时间」，卡片头说一次（zoneNote）。
 * @param {string|null} dueAt  todos.due_at
 * @param {{ at?: Date, timeZone?: string, done?: boolean, deviceZone?: string, displayZone?: string, hereZone?: string }} [o]
 * @returns {null | { state: 'overdue'|'urgent'|'soon'|'later'|'done', tone: 'danger'|'warning'|'neutral', text: string, label: string, short: string, when: string, parts: string[], zone: string|null, zoneTag: string|null, msLeft: number }}
 */
export function dueInfo(dueAt, { at = new Date(), timeZone, done = false, deviceZone, displayZone, hereZone } = {}) {
  if (!dueAt) return null;
  const end = new Date(dueAt).getTime();
  if (Number.isNaN(end)) return null;
  const shownZone = displayZone || timeZone;
  const when = formatInstant(dueAt, { timeZone: shownZone, relative: true, at });
  let zone = null;
  let zoneTag = null;
  if (displayZone) {
    if (displayZone !== timeZone || (hereZone && hereZone !== displayZone)) zone = zoneTag = `${timeZoneLabel(displayZone)}时间`;
  } else if (zonesDiffer(deviceZone, timeZone, at)) {
    zone = `${timeZoneLabel(timeZone)}时间`;
  }
  const msLeft = end - at.getTime();
  const out = (state, tone, parts, short) => {
    const text = parts.join(' · ');
    return { state, tone, text, label: zone ? `${text}（${zone}）` : text, short, when, parts, zone, zoneTag, msLeft };
  };
  if (done) return out('done', 'neutral', [`${when} 前`], `${when} 前`);
  if (msLeft <= 0) return out('overdue', 'danger', ['已过期', when], '已过期');
  const rest = formatLeft(msLeft);
  if (msLeft < DUE_URGENT_MS) return out('urgent', 'danger', [`还剩 ${rest}`, `${when} 前`], `还剩 ${rest}`);
  if (msLeft < DUE_SOON_MS) return out('soon', 'warning', [`还剩 ${rest}`, `${when} 前`], `还剩 ${rest}`);
  return out('later', 'neutral', [`${when} 前`], `${when} 前`);
}

/**
 * 卡片头的一句时区说明（这张卡里有截止时间、而且设备时区和行程时区此刻不一样时才有）：
 *   「截止时间按越南时间（比香港慢 1 小时）」
 * 按「人那一刻在哪」显示（ctx.zoneOf，行里自带「香港时间」小标签）时不需要这句：传 tagged: true 返回 null。
 * @param {object[]} rows  这张卡片里显示的行
 * @param {{ timeZone?: string, deviceZone?: string, at?: Date, tagged?: boolean }} o
 */
export function zoneNote(rows, { timeZone, deviceZone, at = new Date(), tagged = false } = {}) {
  if (tagged) return null;
  if (!zonesDiffer(deviceZone, timeZone, at)) return null;
  if (!rows.some((r) => r.due_at && !r.done)) return null;
  return `截止时间按${timeZoneLabel(timeZone)}时间（${tzDifferenceLabel(timeZone, deviceZone, at)}）`;
}

/**
 * 待办弹层里填截止时间时，顺带换算成这台设备的时间（出发前人在香港，想的是香港时间）：
 *   「香港时间 10月15日 23:59」；时区一样、没填返回 null
 */
export function deviceEquivalent(dueAt, { timeZone, deviceZone, at = new Date() } = {}) {
  if (!dueAt || !zonesDiffer(deviceZone, timeZone, at)) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${timeZoneLabel(deviceZone)}时间 ${formatInstant(d, { timeZone: deviceZone, relative: true, at })}`;
}

/**
 * 一个清单里没勾的项：几项过期、几项 24 小时内到期、几项 3 天内到期 → 一句提醒（没有就 null）。
 *   「1 项已过期 · 2 项 24 小时内到期」；有过期或 24 小时内的是红色，只有 3 天内的是警示色
 *   hold：和 splitRows 一样，刚勾的还按勾之前算（沉下去之前卡片头不变，行不会被推着跳）
 */
export function dueSummary(rows, { at = new Date(), hold } = {}) {
  let overdue = 0;
  let urgent = 0;
  let soon = 0;
  for (const r of rows) {
    const done = hold?.has(r.id) ? hold.get(r.id) : r.done;
    if (done || !r.due_at) continue;
    const left = new Date(r.due_at).getTime() - at.getTime();
    if (Number.isNaN(left)) continue;
    if (left <= 0) overdue += 1;
    else if (left < DUE_URGENT_MS) urgent += 1;
    else if (left < DUE_SOON_MS) soon += 1;
  }
  if (!overdue && !urgent && !soon) return null;
  const parts = [];
  if (overdue) parts.push(`${overdue} 项已过期`);
  if (urgent) parts.push(`${urgent} 项 24 小时内到期`);
  if (soon) parts.push(`${soon} 项 3 天内到期`);
  return { overdue, urgent, soon, tone: overdue || urgent ? 'danger' : 'warning', parts, text: parts.join(' · ') };
}

// ---------------------------------------------------------------------
// 勾完的沉到下面
// ---------------------------------------------------------------------

const tsOf = (v) => {
  const n = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(n) ? -Infinity : n;
};

/** 截止时间的急缓档：0 已过期、1 不到 24 小时、2 不到 3 天、3 更晚或没有截止时间 */
export function dueRank(row, at) {
  if (!at || !row?.due_at) return 3;
  const left = new Date(row.due_at).getTime() - at.getTime();
  if (Number.isNaN(left)) return 3;
  if (left <= 0) return 0;
  if (left < DUE_URGENT_MS) return 1;
  if (left < DUE_SOON_MS) return 2;
  return 3;
}

/**
 * 分成「没勾的」和「勾完的」两段：
 *   - 没勾的：传了 at 时，快到期的排在最前面——已过期 → 24 小时内 → 3 天内（同一档按截止时间先后），
 *     其余（更晚的、没截止时间的）保持清单本来的顺序（sort → created_at，数据层已经排好）（10-14 现场走查 P1-4：
 *     3 小时后就截止的那项原来排第 7、要往下翻两屏）；
 *   - 勾完的按勾的时间从新到旧（刚勾的沉到「已完成」最上面，离原来的位置最近）；没有时间的排最后、保持原顺序；
 *   - hold：刚勾 / 刚取消勾的行（id → 勾之前的状态）先按原来的状态排，留在手指下面，过一会儿再一起沉下去 / 浮上来；
 *   - hideDone：不显示勾完的（hold 里刚勾的照样先留在原位）。
 * @param {object[]} rows  同一个清单（或同一组）的行，已按清单顺序排好
 * @param {{ hold?: Map<string, boolean>, hideDone?: boolean, at?: Date|null }} [o]
 * @returns {{ open: object[], done: object[], doneCount: number }}
 */
export function splitRows(rows = [], { hold, hideDone = false, at = null } = {}) {
  const shownDone = (r) => (hold?.has(r.id) ? Boolean(hold.get(r.id)) : Boolean(r.done));
  const open = [];
  const done = [];
  rows.forEach((r, i) => (shownDone(r) ? done : open).push({ r, i }));
  if (at) {
    for (const x of open) x.rank = dueRank(x.r, at);
    open.sort((a, b) => a.rank - b.rank || (a.rank < 3 ? tsOf(a.r.due_at) - tsOf(b.r.due_at) : 0) || a.i - b.i);
  }
  done.sort((a, b) => tsOf(b.r.done_at) - tsOf(a.r.done_at) || a.i - b.i);
  return { open: open.map((x) => x.r), done: hideDone ? [] : done.map((x) => x.r), doneCount: done.length };
}

// ---------------------------------------------------------------------
// 打包：分类、谁的东西
// ---------------------------------------------------------------------

/** 建议的打包分类（docs/数据结构.md B4.9），前端按出现顺序分组，不认识的分类照样成组 */
export const PACKING_CATEGORIES = Object.freeze(['证件', '衣物', '电子', '洗护', '药品', '其他']);

/** 分类 → 图形名（kit/glyphs.js；pill 是本目录 glyphs.jsx 补的） */
export const CATEGORY_GLYPHS = Object.freeze({ 证件: 'id', 衣物: 'shirt', 电子: 'phone', 洗护: 'drop', 药品: 'pill', 其他: 'suitcase' });

/** 一行属于哪个分类（空的算「其他」，和 data/selectors.js 的 packingGroups 一致） */
export function categoryOf(row) {
  const c = typeof row?.category === 'string' ? row.category.trim() : '';
  return c || '其他';
}

/** 分类的图形：认识的用对应图形，自定义分类用标签 */
export function categoryGlyph(category) {
  return CATEGORY_GLYPHS[category] || 'list';
}

/**
 * 「谁的东西」筛选的选项：全部 / 共用 / 每位成员（owner 在前，再按加入时间）。
 * @param {object[]} members trip_members 行
 */
export function ownerOptions(members = []) {
  const ms = [...members].sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner') || String(a.joined_at || '').localeCompare(String(b.joined_at || '')));
  return [
    { value: 'all', label: '全部' },
    { value: 'shared', label: '共用' },
    ...ms.map((m) => ({ value: m.user_id, label: m.display_name || (m.email ? String(m.email).split('@')[0] : '成员'), color: m.color || null })),
  ];
}

/** 网址里的 who 不认识（成员已经退出等）→ 'all' */
export function normalizeWho(who, members = []) {
  if (who === 'shared') return 'shared';
  if (who && members.some((m) => m.user_id === who)) return who;
  return 'all';
}

/** 这一行符不符合「谁的东西」筛选 */
export function matchOwner(row, who) {
  if (!who || who === 'all') return true;
  if (who === 'shared') return !row.assignee_user_id;
  return row.assignee_user_id === who;
}

/**
 * 打包清单按分类分组。组的先后 = **整张清单**里分类第一次出现的顺序（筛选不改变组的先后，换筛选时组不跳来跳去）；
 * 每组里没勾的在前、勾完的沉到下面（splitRows）；筛选后一项都没有的组不显示。
 * @param {object[]} rows 打包清单（已按清单顺序排好）
 * @param {{ who?: string, hold?: Map<string, boolean>, hideDone?: boolean }} [o]
 * @returns {Array<{ category: string, glyph: string, rows: object[], open: object[], done: object[], doneCount: number, progress: ReturnType<typeof progressOf> }>}
 */
export function packingGroups(rows = [], { who = 'all', hold, hideDone = false } = {}) {
  const order = [];
  for (const r of rows) {
    const c = categoryOf(r);
    if (!order.includes(c)) order.push(c);
  }
  const out = [];
  for (const category of order) {
    const mine = rows.filter((r) => categoryOf(r) === category && matchOwner(r, who));
    if (!mine.length) continue;
    const split = splitRows(mine, { hold, hideDone });
    out.push({ category, glyph: categoryGlyph(category), rows: mine, ...split, progress: progressOf(mine) });
  }
  return out;
}

// ---------------------------------------------------------------------
// 按关键字猜分类、猜量词（快速添加用；猜不出就用默认，不硬猜）
// ---------------------------------------------------------------------

/**
 * 每个分类的关键字。匹配时取**最长**的那个关键字（「防晒衣」比「防晒」长 → 衣物；「洗衣液」比「衣」长 → 洗护），
 * 一样长取靠前的分类。
 */
const CATEGORY_WORDS = Object.freeze({
  证件: ['护照', '签证', '身份证', '回乡证', '通行证', '驾照', '驾驶证', '证件', '机票', '登机牌', '行程单', '保险单', '信用卡', '银行卡', '借记卡', '现金', '现钞', '钞', '钱包', '八达通', '复印件', '打印件', '订单', '房卡', '入境卡'],
  衣物: ['衣服', '上衣', '外套', '衬衫', '短袖', '长袖', 'T 恤', 'T恤', '背心', '裤', '裙', '袜', '鞋', '拖鞋', '凉鞋', '帽', '内衣', '内裤', '睡衣', '泳衣', '泳裤', '比基尼', '防晒衣', '雨衣', '围巾', '手套', '墨镜', '太阳镜', '腰带', '换洗'],
  电子: ['充电', '充电宝', '充电器', '充电线', '数据线', '插头', '转换插头', '转换器', '插座', '排插', '电源', '耳机', '相机', '手机', '平板', '电脑', 'iPad', 'Kindle', '手表', '自拍杆', '三脚架', '电池', '存储卡', '内存卡', 'U 盘', 'U盘', 'eSIM', 'SIM', '无人机', 'GoPro', 'DJI', 'Pocket', '云台', '运动相机', '镜头', '风扇'],
  洗护: ['牙刷', '牙膏', '洗发', '护发', '沐浴', '洗面', '洗脸', '护肤', '面霜', '面膜', '防晒', '防晒霜', '防晒喷雾', '晒后', '乳液', '爽肤水', '卸妆', '化妆', '梳子', '剃须', '毛巾', '浴巾', '隐形眼镜', '护理液', '护手霜', '润唇', '香水', '身体乳', '发圈', '洗衣', '洗衣液', '纸巾', '湿巾', '卫生巾', '指甲'],
  药品: ['药', '晕车', '晕船', '创可贴', '绷带', '碘伏', '酒精', '口罩', '体温计', '止泻', '消炎', '退烧', '感冒', '过敏', '维生素', '驱蚊', '蚊', '药膏', '眼药水', '痛', '布洛芬'],
  其他: ['雨伞', '伞', '水杯', '保温杯', '颈枕', '眼罩', '耳塞', '防水袋', '手机袋', '收纳', '衣架', '零食', '保鲜膜', '笔'],
});

/**
 * 按标题猜打包分类：最长关键字 → 分类；猜不出返回 null。
 *   inferCategory('充电宝') → '电子'；inferCategory('防晒衣') → '衣物'；inferCategory('防晒霜') → '洗护'
 */
export function inferCategory(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  let best = null;
  let len = 0;
  for (const cat of PACKING_CATEGORIES) {
    for (const w of CATEGORY_WORDS[cat] || []) {
      if (w.length > len && lower.includes(w.toLowerCase())) {
        best = cat;
        len = w.length;
      }
    }
  }
  return best;
}

/** 量词的关键字（同样取最长匹配）。只放有把握的；括号里的说明不算 */
const UNIT_WORDS = Object.freeze({
  双: ['袜', '鞋', '拖鞋', '凉鞋', '手套', '筷子'],
  条: ['裤', '裙', '泳裤', '毛巾', '浴巾', '围巾', '项链', '腰带', '领带'],
  件: ['衣', '上衣', 'T 恤', 'T恤', '衬衫', '外套', '背心', '泳衣', '防晒衣', '雨衣', '睡衣', '内衣'],
  本: ['护照', '书', '本子', '笔记本'],
  张: ['卡', '信用卡', '银行卡', '房卡', '身份证', '八达通', '照片', '证件照', '票', '机票'],
  份: ['打印件', '复印件', '行程单', '保险单'],
  根: ['充电线', '数据线', '耳机线'],
  个: ['充电宝', '插头', '转换插头', '转换器', '移动电源', '相机', '运动相机', '颈枕', '眼罩', '水杯', '防水袋', '手机袋', '收纳袋'],
  副: ['墨镜', '太阳镜', '眼镜', '耳塞'],
  顶: ['帽', '帽子'],
  把: ['伞', '雨伞', '梳子', '剃须刀'],
  瓶: ['霜', '防晒霜', '乳', '乳液', '液', '驱蚊液', '水', '喷雾', '鱼露', '洗发水', '沐浴露'],
  支: ['牙刷', '牙膏', '笔', '口红', '润唇膏', '药膏'],
  片: ['创可贴', '面膜', '贴'],
  盒: ['药', '晕船药', '晕车药', '肠胃药', '感冒药'],
  包: ['零食', '纸巾', '湿巾', '咖啡豆', '茶叶'],
});

/**
 * 按标题猜数量的量词（「3 件」「2 双」）；标题里列了好几样（「帽子、太阳镜」「相机 + 防水壳」）或猜不出 → ''（只显示数字）。
 * todos.extra.unit 有值时优先用它。
 */
export function inferUnit(title, extra) {
  if (extra && typeof extra.unit === 'string' && extra.unit.trim()) return extra.unit.trim().slice(0, 2);
  const t = String(title || '').replace(/[（(][^）)]*[）)]/g, '').trim();
  if (!t || /[、,，+＋&/／]|和|与|及|或/.test(t)) return '';
  let best = '';
  let len = 0;
  for (const [unit, words] of Object.entries(UNIT_WORDS)) {
    for (const w of words) {
      if (w.length > len && t.includes(w)) {
        best = unit;
        len = w.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------
// 新加一项
// ---------------------------------------------------------------------

/** 新的一项排在这个清单最后（数据库默认 sort 0 会排到最前面，所以显式给一个比现有都大的值） */
export function nextSort(rows = []) {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.sort);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 10;
}

/**
 * 快速添加的一行：自动带上当前清单、当前「谁的东西」筛选；打包清单还带分类（选了用选的，没选按标题猜，猜不出「其他」）和数量 1。
 * @param {{ list: string, title: string, who?: string, category?: string|null, rows?: object[] }} o  rows：这个清单现有的行（算 sort）
 */
export function newTodoValues({ list, title, who = 'all', category = null, rows = [] }) {
  const v = { list, title: String(title || '').trim() };
  if (who && who !== 'all' && who !== 'shared') v.assignee_user_id = who;
  if (list === 'packing') {
    v.category = category || inferCategory(v.title) || '其他';
    v.qty = 1;
  }
  v.sort = nextSort(rows);
  return v;
}

/** 打包清单是空的时「用常用清单开始」：一键加进这些（都是共用、数量按两个人算的常见值） */
export const STARTER_PACKING = Object.freeze([
  { category: '证件', title: '护照', qty: 2 },
  { category: '证件', title: '信用卡', qty: 2 },
  { category: '证件', title: '现金', qty: 1 },
  { category: '衣物', title: '换洗衣服', qty: 4 },
  { category: '衣物', title: '睡衣', qty: 2 },
  { category: '衣物', title: '拖鞋', qty: 2 },
  { category: '电子', title: '充电宝', qty: 1 },
  { category: '电子', title: '充电线', qty: 2 },
  { category: '电子', title: '转换插头', qty: 1 },
  { category: '洗护', title: '牙刷', qty: 2 },
  { category: '洗护', title: '防晒霜', qty: 1 },
  { category: '药品', title: '常用药', qty: 1 },
  { category: '其他', title: '雨伞', qty: 1 },
]);

// ---------------------------------------------------------------------
// 关联的小链接、勾的人
// ---------------------------------------------------------------------

/**
 * 一行下面的小链接：关联的预订（点了开预订详情）、关联的条目（去那天并展开它）或哪一天（去那天）。
 * 已删除的条目、找不到的预订不显示。
 * @param {object} todo
 * @param {{ bookings?: Map, items?: Map, days?: Map, dayNumber?: (date: string) => number|null, timeZone?: string, at?: Date }} ctx
 * @returns {Array<{ type: 'booking'|'item'|'day', id: string, label: string, detail: string|null, kind?: string, date?: string|null }>}
 */
export function linkChips(todo, { bookings, items, days, dayNumber, timeZone, at } = {}) {
  const out = [];
  const b = todo?.booking_id ? bookings?.get(todo.booking_id) : null;
  if (b) out.push({ type: 'booking', id: b.id, label: b.title || '预订', detail: null, kind: b.kind });
  const dayLabel = (day) => {
    if (!day?.date) return null;
    const n = dayNumber?.(day.date);
    return n ? `D${n}` : formatDate(day.date, { timeZone, weekday: false, at });
  };
  const it = todo?.item_id ? items?.get(todo.item_id) : null;
  if (it && !it.deleted_at) {
    const day = it.day_id ? days?.get(it.day_id) : null;
    out.push({ type: 'item', id: it.id, label: it.title || '条目', detail: dayLabel(day), kind: it.kind, date: day?.date || null });
    return out;
  }
  const day = todo?.day_id ? days?.get(todo.day_id) : null;
  if (day) {
    out.push({ type: 'day', id: day.id, label: dayLabel(day), detail: dayDetail(day.date, { timeZone, at }), date: day.date });
  }
  return out;
}

/** 小链接上的日期：昨天 / 今天 / 明天直接这么说（行程中一眼看出是不是今天的事），别的写「1月10日 周日」 */
export function dayDetail(date, { timeZone, at } = {}) {
  const rel = formatDate(date, { timeZone, at, relative: true });
  return ['昨天', '今天', '明天'].includes(rel) ? rel : formatDate(date, { timeZone, at });
}

/**
 * 勾完的项下面那一小行：「Cathy 勾的 · 昨天 21:10」。没记录是谁勾的就只说时间；都没有返回 null。
 * @param {object} todo
 * @param {{ memberName?: (userId: string) => string, meId?: string, at?: Date, timeZone?: string }} ctx
 */
export function doneByline(todo, { memberName, meId, at = new Date(), timeZone } = {}) {
  if (!todo?.done) return null;
  const who = todo.done_by ? (todo.done_by === meId ? '我' : memberName?.(todo.done_by) || null) : null;
  const t = todo.done_at ? new Date(todo.done_at).getTime() : NaN;
  // 勾的时间比“现在”还晚（另一台设备的时钟快了）：不说「2 天后」，直接写日期时间
  const when = Number.isNaN(t) ? ''
    : t > at.getTime() + 60_000 ? formatInstant(todo.done_at, { timeZone, at })
      : formatRelativeTime(todo.done_at, { now: at, timeZone });
  if (!who && !when) return null;
  if (!who) return joinWords(when, '勾的');
  return when ? `${joinWords(who, '勾的')} · ${when}` : joinWords(who, '勾的');
}

/** 拼两段字：拉丁字母 / 数字和中文之间加一个空格（「Cathy 勾的」「21:10 勾的」「我勾的」） */
export function joinWords(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return /[A-Za-z0-9]$/.test(a) || /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : `${a}${b}`;
}

// ---------------------------------------------------------------------
// 截止时间的快捷选项（待办弹层用）
// ---------------------------------------------------------------------

/**
 * 截止时间的快捷选项（按行程时区）：今晚 21:00、明晚 21:00、出发前一晚 21:00（比明晚还晚时才给）。已经过了的不给。
 * @param {{ at?: Date, timeZone: string, startDate?: string|null }} o
 * @returns {Array<{ key: string, label: string, value: string }>} value = ISO 时刻
 */
export function duePresets({ at = new Date(), timeZone, startDate = null }) {
  if (!timeZone) return [];
  const todayDate = zonedParts(at, timeZone).date;
  const make = (key, label, date) => {
    const inst = zonedToInstant(date, '21:00', timeZone);
    return inst && inst.getTime() > at.getTime() ? { key, label, value: inst.toISOString() } : null;
  };
  const out = [make('tonight', '今晚 21:00', todayDate), make('tomorrow', '明晚 21:00', addDays(todayDate, 1))];
  // 出发前一晚和「明晚」是同一天时不重复给
  if (startDate && addDays(startDate, -1) > addDays(todayDate, 1)) out.push(make('eve', '出发前一晚', addDays(startDate, -1)));
  return out.filter(Boolean);
}

/** ISO 时刻 → 行程时区里的 { date: 'YYYY-MM-DD', time: 'HH:MM' }（给 <input type="date"> / "time"） */
export function dueParts(dueAt, timeZone) {
  if (!dueAt) return { date: '', time: '' };
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const p = zonedParts(d, timeZone);
  return { date: p.date, time: p.time };
}

/** 行程时区里的日期 + 钟点 → ISO 时刻；日期空 → null；钟点空按 23:59 */
export function dueFromParts(date, time, timeZone) {
  if (!date) return null;
  const inst = zonedToInstant(date, time || '23:59', timeZone);
  return inst ? inst.toISOString() : null;
}

// ---------------------------------------------------------------------
// 备注里的电话、邮箱、网址：在行里变成能点的小胶囊（街上要打电话确认、看官网时一下就到）
// ---------------------------------------------------------------------

/** 网址结尾常跟着的标点（中文句号、括号……）不算网址的一部分 */
const URL_TRAIL = /[.,;:!?。，、；：！？)）」』】>]+$/;

/**
 * 备注里能点的东西（按出现顺序；不重叠，先认邮箱，再认网址、电话）：
 *   tel  国际写法「+84 123 456 789」（+ 和 7–15 位数字，中间可以有空格、连字符），或 0 开头、9–11 位数字的本地号码
 *   mail 邮箱
 *   url  http(s):// 开头的网址，或常见后缀的裸域名（「example.vn/hours」）
 * 时间（08:15–12:45）、日期（01-09）、金额（1,234.50 万）都不会被当成电话。
 */
const NOTE_LINK = new RegExp([
  '(?<mail>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})',
  '(?<url>https?:\\/\\/[^\\s<>"\'，。、；！？（）「」『』【】]+)',
  '(?<bare>(?<![\\w@.-])(?:[A-Za-z0-9-]+\\.)+(?:com|net|org|vn|hk|cn|tw|jp|kr|info|travel)(?![\\w-])(?:\\/[^\\s<>"\'，。、；！？（）「」『』【】]*)?)',
  '(?<tel>(?<![\\w+])\\+\\d{1,3}(?:[ -]?\\d){6,13}(?!\\d)|(?<![\\w:.,-])0\\d(?:[ -]?\\d){7,9}(?![\\d:]))',
].join('|'), 'g');

/**
 * 把备注拆成文字和链接：
 *   noteParts('打 +84 123 456 789 问') → [{ type: 'text', value: '打 ' }, { type: 'tel', value: '+84 123 456 789', href: 'tel:+84123456789' }, { type: 'text', value: ' 问' }]
 * href 交给 lib/native.js 的 openExternal（白名单里有 tel: / mailto: / https:）。
 * @param {string|null|undefined} text
 * @returns {Array<{ type: 'text'|'tel'|'mail'|'url', value: string, href?: string }>}
 */
export function noteParts(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  const pushText = (v) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev?.type === 'text') prev.value += v;
    else out.push({ type: 'text', value: v });
  };
  for (const m of s.matchAll(NOTE_LINK)) {
    let value = m[0];
    const g = m.groups;
    let type;
    let href;
    if (g.mail) {
      type = 'mail';
      href = `mailto:${value}`;
    } else if (g.url || g.bare) {
      value = value.replace(URL_TRAIL, '');
      type = 'url';
      href = g.url ? value : `https://${value}`;
    } else {
      type = 'tel';
      href = `tel:${value.startsWith('+') ? '+' : ''}${value.replace(/\D/g, '')}`;
    }
    pushText(s.slice(last, m.index));
    out.push({ type, value, href });
    last = m.index + value.length;
  }
  pushText(s.slice(last));
  return out;
}

/** 行里最多放几个「打电话 / 网页」胶囊（再多就是备注本身太复杂了，点开看全文） */
export const NOTE_ACTIONS_MAX = 3;

/**
 * 一行下面的「打电话 / WhatsApp / 写邮件 / 打开网页」小胶囊（从备注里认出来的，同一个号码 / 网址只给一个）：
 *   - 电话：标题或备注里提到 WhatsApp 的，改成 WhatsApp（https://wa.me/<号码>，通用链接唤起 App；本地 0 开头的号码认不出国家，照旧打电话）；
 *   - 邮箱：写邮件（mailto:）；网址：打开网页。
 * 为什么不直接在备注文字里做下划线链接：链接的可点区域要 ≥44 高，备注一行只有 19.5，上下几行的字都会变成“点了就打电话”。
 * @param {string|null|undefined} note
 * @param {{ title?: string }} [o]
 * @returns {Array<{ type: 'tel'|'whatsapp'|'mail'|'url', value: string, href: string, label: string, aria: string }>}
 */
export function noteActions(note, { title = '' } = {}) {
  const whatsapp = /whats\s?app/i.test(`${title} ${note || ''}`);
  const out = [];
  const seen = new Set();
  for (const p of noteParts(note)) {
    if (p.type === 'text') continue;
    let a;
    if (p.type === 'tel' && whatsapp && p.value.startsWith('+')) {
      const digits = p.value.replace(/\D/g, '');
      a = { type: 'whatsapp', value: p.value, href: `https://wa.me/${digits}`, label: p.value, aria: `用 WhatsApp 联系 ${p.value}` };
    } else if (p.type === 'tel') {
      a = { type: 'tel', value: p.value, href: p.href, label: p.value, aria: `打电话 ${p.value}` };
    } else if (p.type === 'mail') {
      a = { type: 'mail', value: p.value, href: p.href, label: p.value, aria: `写邮件给 ${p.value}` };
    } else {
      const label = p.value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
      a = { type: 'url', value: p.value, href: p.href, label, aria: `打开网页 ${label}` };
    }
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    out.push(a);
    if (out.length >= NOTE_ACTIONS_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------------
// 勾完以后的提示
// ---------------------------------------------------------------------

/**
 * 一批刚沉下去的（只算“勾上”的，取消勾的不提示）→ 提示文字；没有就 null。
 *   1 项：「已装好「护照」」；几项：「已装好 3 件」
 * @param {Array<{ title: string, list: string, to: boolean }>} batch
 */
export function sinkToastText(batch = []) {
  const done = batch.filter((x) => x.to);
  if (!done.length) return null;
  const meta = LISTS[done[0].list] || LISTS.todo;
  const short = (t) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);
  return done.length === 1 ? `${meta.verb}「${short(done[0].title || '这一项')}」` : `${meta.verb} ${done.length} ${meta.unit}`;
}
