// =====================================================================
// sheets/photo/model.js：照片列表的纯函数（日记相册页的「相册」和看大图弹层共用，Node 里能直接测）。
//
//   const list = journalPhotoList({ days, byDay, members });   // 整趟行程的日记照片，相册的顺序（按天 → 拍摄时间）
//   const start = resolveStartIndex(list, { entry, index });    // 从网址参数（e.<日记 id>~n.<第几张>）找到起点
//   reviewPhotoList(review)                                     // 一条评级里的照片
//   groupByDay(list, days)                                      // 相册：按天分组
//   photoFileName(photo, { name })                              // 分享 / 保存时的文件名「Cathy-2027-01-10-2.jpg」
//
// 一张照片统一成：
//   { key, path, caption, takenAt, width, height, source: 'journal'|'review', entryId, reviewId, indexInSource,
//     dayId, date, userId, mood }
// key 就是存储路径（全站唯一），缩略图上写 data-pv-thumb="<path>"，看大图关闭时据此找到“缩回哪里”。
// =====================================================================

/** 时刻 → 毫秒（无效返回 null） */
function instantMs(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** 照片对象里有效的那几张（必须有 path） */
export function validPhotos(photos) {
  return Array.isArray(photos) ? photos.filter((p) => p && typeof p.path === 'string' && p.path) : [];
}

/**
 * 一篇日记的照片 → 统一形状（顺序不变）。
 * @param {object} entry journal_entries 行
 * @param {object} [day] days 行
 */
export function entryPhotos(entry, day = null) {
  return validPhotos(entry?.photos).map((p, i) => ({
    key: p.path,
    path: p.path,
    caption: typeof p.caption === 'string' ? p.caption : '',
    takenAt: p.taken_at || null,
    width: Number(p.width) > 0 ? Number(p.width) : null,
    height: Number(p.height) > 0 ? Number(p.height) : null,
    source: 'journal',
    entryId: entry.id,
    reviewId: null,
    indexInSource: i,
    dayId: entry.day_id || day?.id || null,
    date: day?.date || null,
    userId: entry.user_id || null,
    mood: entry.mood || '',
  }));
}

/**
 * 整趟行程的日记照片（相册的顺序）：按天（days 的顺序）；同一天里按拍摄时间从早到晚，
 * 没有拍摄时间的排在这一天的最后、保持日记里的顺序（成员顺序 → 日记里的顺序）。
 * @param {{ days: object[], byDay: Map<string, object[]>, members?: object[] }} o
 */
export function journalPhotoList({ days = [], byDay = new Map() } = {}) {
  const out = [];
  for (const day of days) {
    const entries = byDay?.get?.(day.id) || [];
    const photos = entries.flatMap((e) => entryPhotos(e, day));
    const order = photos.map((p, i) => ({ p, i, t: instantMs(p.takenAt) }));
    order.sort((a, b) => {
      if (a.t !== null && b.t !== null && a.t !== b.t) return a.t - b.t;
      if (a.t === null && b.t !== null) return 1;
      if (a.t !== null && b.t === null) return -1;
      return a.i - b.i;
    });
    for (const x of order) out.push(x.p);
  }
  return out;
}

/** 一条评级里的照片（顺序不变） */
export function reviewPhotoList(review, place = null) {
  return validPhotos(review?.photos).map((p, i) => ({
    key: p.path,
    path: p.path,
    caption: typeof p.caption === 'string' && p.caption ? p.caption : (place?.name || ''),
    takenAt: p.taken_at || review?.visited_at || null,
    width: Number(p.width) > 0 ? Number(p.width) : null,
    height: Number(p.height) > 0 ? Number(p.height) : null,
    source: 'review',
    entryId: null,
    reviewId: review.id,
    indexInSource: i,
    dayId: null,
    date: null,
    userId: review.user_id || null,
    mood: '',
    placeId: review.place_id || null,
  }));
}

/**
 * 网址参数 → 起点下标。参数里的 index 是“这篇日记 / 这条评级里的第几张”（从 0 开始）。
 * 找不到那一张时退回这篇的第一张，再退回 0。
 * @param {object[]} list
 * @param {{ entry?: string, review?: string, index?: string|number }} f
 */
export function resolveStartIndex(list, { entry, review, index } = {}) {
  if (!list.length) return 0;
  const n = Number.parseInt(index ?? 0, 10);
  const want = Number.isFinite(n) && n >= 0 ? n : 0;
  const same = (p) => (entry ? p.entryId === entry : review ? p.reviewId === review : false);
  const exact = list.findIndex((p) => same(p) && p.indexInSource === want);
  if (exact !== -1) return exact;
  const first = list.findIndex(same);
  return first !== -1 ? first : 0;
}

/** 一张照片 → openPhotoViewer 的参数 */
export function viewerArgsFor(photo) {
  if (!photo) return null;
  return photo.source === 'review'
    ? { reviewId: photo.reviewId, index: photo.indexInSource }
    : { entryId: photo.entryId, index: photo.indexInSource };
}

/** 列表变了（有照片被删、新加）以后，原来看的那张现在在第几张；不在了就停在原来的位置（夹在范围内） */
export function reindex(list, key, fallbackIndex) {
  const i = key ? list.findIndex((p) => p.key === key) : -1;
  if (i !== -1) return i;
  return Math.max(0, Math.min(list.length - 1, fallbackIndex | 0));
}

/** 只看某个人拍的（userId 为空 = 全部） */
export function filterByAuthor(list, userId) {
  return userId ? list.filter((p) => p.userId === userId) : list;
}

/** 每个人各有几张（Map<userId, number>） */
export function countByAuthor(list) {
  const m = new Map();
  for (const p of list) m.set(p.userId, (m.get(p.userId) || 0) + 1);
  return m;
}

/**
 * 相册：按天分组（只有有照片的天）。
 * @returns {Array<{ day: object, photos: object[] }>}
 */
export function groupByDay(list, days = []) {
  const byId = new Map();
  for (const p of list) {
    if (!byId.has(p.dayId)) byId.set(p.dayId, []);
    byId.get(p.dayId).push(p);
  }
  return days.filter((d) => byId.has(d.id)).map((day) => ({ day, photos: byId.get(day.id) }));
}

/**
 * 读屏 / alt 文字：「夜市 · Cathy 在第 1 天拍的」「Jeremy 在第 2 天拍的照片」。
 * @param {object} photo
 * @param {{ name?: string, dayNumber?: number|null }} o
 */
export function photoAlt(photo, { name, dayNumber } = {}) {
  const who = name ? `${name}` : '';
  const when = dayNumber ? `第 ${dayNumber} 天` : '';
  const tail = who || when ? `${who}${who && when ? '在' : ''}${when}拍的` : '';
  if (photo?.caption) return tail ? `${photo.caption} · ${tail}` : photo.caption;
  return tail ? `${tail}照片` : '照片';
}

/**
 * 分享 / 保存时的文件名：「Cathy-2027-01-10-2.jpg」（谁-哪天-这篇里的第几张，扩展名跟存储路径）。
 * @param {object} photo
 * @param {{ name?: string }} o
 */
export function photoFileName(photo, { name } = {}) {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(photo?.path || '')?.[1]?.toLowerCase() || 'jpg';
  const who = String(name || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  const n = Number.isInteger(photo?.indexInSource) ? photo.indexInSource + 1 : null;
  const stem = [who, photo?.date, n].filter((x) => x !== null && x !== undefined && x !== '').join('-') || '照片';
  return `${stem}.${ext}`;
}

/** 照片的宽高比（宽 / 高），没有尺寸时 fallback（默认 4:3） */
export function aspectOf(photo, fallback = 4 / 3) {
  const w = Number(photo?.width);
  const h = Number(photo?.height);
  return w > 0 && h > 0 ? w / h : fallback;
}

/**
 * 日记正文的摘录：去掉多余空白，最多 max 个字（按字符，不切开 emoji），超出加省略号。
 */
export function excerpt(text, max = 60) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : s;
}
