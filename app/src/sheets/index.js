// =====================================================================
// sheets/index.js：全站共用弹层的登记表 + 打开它们的小帮手（SPEC §9.2）。
//
// 这里登记的弹层都是**按需加载**的（overlay/ 的 defineOverlays）：网址里出现 ?sheet=<id> 时 OverlayHost 才下载
// 对应的模块并挂上，之后一直挂着（关的时候还要播退场动画）。所以刷新、分享链接、手机返回手势都能用，
// 而且从任何页面都能打开——不用在页面里放 <Sheet>。
// 本文件由 pages/index.js 在启动时引入（只有登记表和几个小函数，弹层本身的代码不进首屏包）。
//
// 打开一律用下面的帮手（不要自己拼参数）：
//
//   openDriverCard(place.id)                                 给司机看（arg = 地点 id；也可以是贴士 id → 给对方看当地语原文）
//   openExpenseSheet()                                       记一笔（空白）
//   openExpenseSheet({ itemId, placeId, bookingId, date, category })   记一笔，预填（给了 itemId 就不再写地点 / 日期，记一笔面板从条目推）
//   openExpenseSheet(expense.id)                             编辑这一笔
//   openItemSheet({ date, after, parent, variant, kind })    加条目（预填哪天、插在哪一条后面、挂在哪个主方案下）
//   openItemSheet(item.id)                                   编辑条目
//   openPlaceSheet(place.id)                                 地点详情
//   openReviewSheet(place.id) / openReviewSheet({ placeId, itemId })   写评级
//   openBookingSheet(booking.id)                             预订详情
//   openTodoSheet({ list: 'packing', dayId, bookingId, itemId }) / openTodoSheet(todo.id)   加 / 编辑待办
//   openJournalSheet({ date, mode: 'photo' | 'text', itemId, placeId })    写日记 / 拍照打卡
//   openPhotoViewer({ entryId, index }) / openPhotoViewer({ reviewId, index })   大图浏览
//   openTripNewSheet()                                       新建行程
//   openInviteSheet({ role })                                邀请成员
//
// 第二个参数都是 openOverlay 的选项：{ keyboard: true }（表单类弹层：iOS 先叫出键盘，必须在点击回调里同步调用）、
// { replace: true }（换掉当前那一层，不压历史）、{ trigger: 按钮元素 }（“从这个按钮长出来 / 关闭后焦点回到它”）。
// 参数的写法（网址 ?sheet=expense:i.<id>~d.2027-01-11）见 sheets/args.js 和 sheets/README.md。
// 弹层里读参数：const { mode, id, fields } = useSheetArgs()（sheets/hooks.js）。
// =====================================================================

// 直接从 manager.js 引（和 app.jsx 引 OverlayHost 一样）：overlay/index.js 会把 Sheet、AnchoredPanel 这些按需加载的组件
// 一起带进首屏包（build.test.js 守着这一条）
import { defineOverlays, openOverlay } from '../overlay/manager.js';
import { encodeSheetArg, categoryToCode } from './args.js';

/**
 * 登记表：id → { kind, title, owner, load }。
 *   kind：overlay 的弹层种类（sheet 底部面板 / menu 全屏）；title：中文名；owner：由谁做完（SPEC §9.2）
 */
export const SHEETS = Object.freeze({
  driver: { kind: 'menu', title: '给司机看', owner: '组件', load: () => import('./driver/DriverSheet.jsx') },
  expense: { kind: 'sheet', title: '记一笔', owner: '账本页', load: () => import('./expense/ExpenseSheet.jsx') },
  item: { kind: 'sheet', title: '行程条目', owner: '每天页', load: () => import('./item/ItemSheet.jsx') },
  place: { kind: 'sheet', title: '地点详情', owner: '地点页', load: () => import('./place/PlaceSheet.jsx') },
  review: { kind: 'sheet', title: '写评级', owner: '地点页', load: () => import('./review/ReviewSheet.jsx') },
  booking: { kind: 'sheet', title: '预订详情', owner: '预订页', load: () => import('./booking/BookingSheet.jsx') },
  todo: { kind: 'sheet', title: '待办', owner: '清单页', load: () => import('./todo/TodoSheet.jsx') },
  journal: { kind: 'sheet', title: '写日记', owner: '日记页', load: () => import('./journal/JournalSheet.jsx') },
  photo: { kind: 'menu', title: '看大图', owner: '日记页', load: () => import('./photo/PhotoSheet.jsx') },
  'trip-new': { kind: 'sheet', title: '新建行程', owner: '行程列表页', load: () => import('./trip-new/TripNewSheet.jsx') },
  invite: { kind: 'sheet', title: '邀请成员', owner: '设置页', load: () => import('./invite/InviteSheet.jsx') },
});

/** 所有登记的弹层 id */
export const SHEET_IDS = Object.freeze(Object.keys(SHEETS));

defineOverlays(Object.fromEntries(Object.entries(SHEETS).map(([id, s]) => [id, { kind: s.kind, load: s.load }])));

const open = (id, arg, opts) => openOverlay(id, { ...opts, arg: arg ?? undefined });
const idOrFields = (x) => (typeof x === 'string' ? x : null);

/** 给司机看 / 给对方看（全屏大字）。id：地点 id、贴士 id（也接受预订 / 条目 id，取它的地点） */
export function openDriverCard(id, opts) {
  return open('driver', id, opts);
}

/**
 * 记一笔 / 编辑一笔。
 * @param {string | { itemId?: string, placeId?: string, bookingId?: string, date?: string, category?: string }} [x]
 */
export function openExpenseSheet(x, opts) {
  const id = idOrFields(x);
  if (id) return open('expense', id, opts);
  const f = x || {};
  const arg = encodeSheetArg(
    { item: f.itemId, booking: f.bookingId, place: f.placeId, date: f.date, category: categoryToCode(f.category) },
    ['item', 'booking', 'place', 'date', 'category'],
  );
  return open('expense', arg, opts);
}

/**
 * 加条目 / 编辑条目。
 * @param {string | { date?: string, after?: string, parent?: string, variant?: 'primary'|'backup'|'rain', kind?: string }} [x]
 */
export function openItemSheet(x, opts) {
  const id = idOrFields(x);
  if (id) return open('item', id, opts);
  const f = x || {};
  return open('item', encodeSheetArg({ date: f.date, after: f.after, parent: f.parent, variant: f.variant, kind: f.kind }, ['date', 'parent', 'after', 'variant', 'kind']), opts);
}

/** 地点详情 */
export function openPlaceSheet(placeId, opts) {
  return open('place', placeId, opts);
}

/**
 * 写评级（每人每个地点一条：给地点 id 就是“我对这个地点的评级”，有就编辑，没有就新建）。
 * @param {string | { placeId: string, itemId?: string }} x
 */
export function openReviewSheet(x, opts) {
  const f = typeof x === 'string' ? { placeId: x } : x || {};
  return open('review', encodeSheetArg({ place: f.placeId, item: f.itemId }, ['place', 'item']), opts);
}

/** 预订详情 */
export function openBookingSheet(bookingId, opts) {
  return open('booking', bookingId, opts);
}

/**
 * 加待办 / 编辑待办。
 * @param {string | { list?: 'confirm'|'packing'|'todo'|'buy', dayId?: string, bookingId?: string, itemId?: string }} [x]
 */
export function openTodoSheet(x, opts) {
  const id = idOrFields(x);
  if (id) return open('todo', id, opts);
  const f = x || {};
  return open('todo', encodeSheetArg({ list: f.list, item: f.itemId, booking: f.bookingId, day: f.dayId }, ['list', 'item', 'booking', 'day']), opts);
}

/**
 * 写日记 / 拍照打卡。
 * @param {{ date?: string, mode?: 'text'|'photo', itemId?: string, placeId?: string }} [x]
 */
export function openJournalSheet(x, opts) {
  const f = x || {};
  return open('journal', encodeSheetArg({ mode: f.mode, date: f.date, item: f.itemId, place: f.placeId }, ['mode', 'date', 'item', 'place']), opts);
}

/**
 * 大图浏览。
 * @param {{ entryId?: string, reviewId?: string, index?: number }} x  日记里的照片（entryId）或评级里的照片（reviewId），第几张（从 0 开始）
 */
export function openPhotoViewer(x, opts) {
  const f = x || {};
  return open('photo', encodeSheetArg({ entry: f.entryId, review: f.reviewId, index: f.index }, ['entry', 'review', 'index']), opts);
}

/** 新建行程 */
export function openTripNewSheet(opts) {
  return open('trip-new', null, opts);
}

/** 邀请成员（行程 id 从网址读：在行程内页面打开；设置页打开时网址带 ?trip=<id>） */
export function openInviteSheet(x, opts) {
  const f = x || {};
  return open('invite', encodeSheetArg({ role: f.role }, ['role']), opts);
}
