// =====================================================================
// sheets/journal/form.js：写日记 / 拍照打卡面板的纯逻辑（Node 里能直接测）。
//
//   MOODS / moodOptions(current)            心情一排 emoji（带中文名）；日记里已有、不在列表里的心情放最前面
//   defaultJournalDay({ days, phase, todayDate, mine })   没指定哪天时写哪天
//   formFromEntry(entry) / applyDraft(form, draft, entry)  表单初值：已有的日记 + 本机草稿
//   formPatch(form, entry)                  要保存的字段（只留改了的）；formIsEmpty / formIsDirty
//   uploadStateOf(path, outbox)             一张新照片现在的上传状态（写队列里还有没有、是不是正在发、失败了没有）
//   uploadSummary(photos, states)           「已上传 2/3」
//   tripReady(store)                        行程数据到了没（有缓存就先用缓存；日记页和两个弹层共用）
// =====================================================================

/**
 * 行程数据到了没（和占位页同一套规则：有缓存就先显示缓存，网络回来自动更新）。
 * @param {{ status: { value: string }, trip: { value: object|null }, source: { value: string|null } } | null} store
 */
export function tripReady(store) {
  if (!store) return false;
  const status = store.status.value;
  if (status === 'missing' || status === 'removed') return false;
  // 行程这一行在（缓存或网络给的）就能显示：刷新失败也先用手上的数据，同步状态条会说明没加载成功
  return Boolean(store.trip.value);
}

/** 心情（一个 emoji + 中文名）。顺序：常用的开心在前 */
export const MOODS = Object.freeze([
  { emoji: '🥰', label: '开心' },
  { emoji: '😆', label: '好玩' },
  { emoji: '🤩', label: '惊艳' },
  { emoji: '😋', label: '好吃' },
  { emoji: '😌', label: '放松' },
  { emoji: '😎', label: '惬意' },
  { emoji: '🌅', label: '好美' },
  { emoji: '🤿', label: '下水' },
  { emoji: '🥵', label: '好热' },
  { emoji: '😴', label: '好累' },
  { emoji: '🥲', label: '小遗憾' },
  { emoji: '😤', label: '生气' },
]);

/** 心情的中文名（不在列表里的返回 '心情'） */
export function moodLabel(emoji) {
  return MOODS.find((m) => m.emoji === emoji)?.label || (emoji ? '心情' : '');
}

/** 选项：日记里已有的心情不在列表里时放在最前面（不会因为列表里没有就看不到、改不回来） */
export function moodOptions(current) {
  const extra = current && !MOODS.some((m) => m.emoji === current) ? [{ emoji: current, label: '心情' }] : [];
  return [...extra, ...MOODS];
}

/** 心情最多 16 个字符（数据库约束，按码点数） */
export const MOOD_MAX = 16;

/**
 * 没指定哪天时写哪天：
 *   进行中 → 今天；已结束 → 最后一天里我还没写的那天（都写了就最后一天）；出发前 / 没日期 → 第一天。
 * @param {{ days: object[], phase?: string, todayDate?: string|null, mine?: Set<string> }} o  mine：我已经写过的 day id
 * @returns {object|null} days 行
 */
export function defaultJournalDay({ days = [], phase, todayDate, mine = new Set() }) {
  if (!days.length) return null;
  if (todayDate) {
    const today = days.find((d) => d.date === todayDate);
    if (today && phase !== 'ended') return today;
  }
  if (phase === 'ended') {
    const missing = [...days].reverse().find((d) => !mine.has(d.id));
    return missing || days[days.length - 1];
  }
  if (phase === 'ongoing') {
    // 今天这一天没有建（日期有空缺）：今天之前最近的一天
    const past = days.filter((d) => !todayDate || d.date <= todayDate);
    return past[past.length - 1] || days[0];
  }
  return days[0];
}

/** 照片对象只留数据库认的字段（B5.1 Photo），去掉界面里临时加的 */
export function cleanPhoto(p) {
  const out = { path: p.path };
  if (p.caption) out.caption = String(p.caption);
  if (p.taken_at) out.taken_at = p.taken_at;
  if (Number(p.width) > 0) out.width = Math.round(Number(p.width));
  if (Number(p.height) > 0) out.height = Math.round(Number(p.height));
  return out;
}

/** 已有的日记 → 表单 */
export function formFromEntry(entry) {
  return {
    mood: entry?.mood || '',
    body: entry?.body || '',
    photos: Array.isArray(entry?.photos) ? entry.photos.filter((p) => p?.path).map(cleanPhoto) : [],
  };
}

/**
 * 本机草稿叠到表单上。草稿只在“和数据库里的不一样”时才算数：
 * 返回 { form, restored }（restored = 真的用了草稿的内容，界面提示「已恢复没保存的草稿」）。
 * @param {{ mood, body, photos }} base formFromEntry 的结果
 * @param {{ mood?, body?, photos?, at? } | null} draft
 */
export function applyDraft(base, draft) {
  if (!draft) return { form: base, restored: false };
  const form = {
    mood: typeof draft.mood === 'string' ? draft.mood : base.mood,
    body: typeof draft.body === 'string' ? draft.body : base.body,
    photos: Array.isArray(draft.photos) ? draft.photos.filter((p) => p?.path).map(cleanPhoto) : base.photos,
  };
  return { form, restored: formIsDirty(form, base) };
}

const samePhotos = (a, b) => a.length === b.length && a.every((p, i) => {
  const q = b[i];
  return q && p.path === q.path && (p.caption || '') === (q.caption || '');
});

/** 表单和已保存的样子是否不同（正文首尾空白不算） */
export function formIsDirty(form, base) {
  return (form.mood || '') !== (base.mood || '')
    || String(form.body || '').trim() !== String(base.body || '').trim()
    || !samePhotos(form.photos || [], base.photos || []);
}

/** 什么都没写（没心情、没正文、没照片） */
export function formIsEmpty(form) {
  return !form.mood && !String(form.body || '').trim() && !(form.photos || []).length;
}

/**
 * 要保存的字段（只留改了的；正文去掉首尾空白）。entry 为空 = 新建，三个字段都写。
 * @returns {{ mood?: string|null, body?: string, photos?: object[] }}
 */
export function formPatch(form, entry) {
  const next = {
    mood: form.mood || null,
    body: String(form.body || '').trim(),
    photos: (form.photos || []).map(cleanPhoto),
  };
  if (!entry) return next;
  const base = formFromEntry(entry);
  const out = {};
  if ((next.mood || '') !== (base.mood || '')) out.mood = next.mood;
  if (next.body !== String(base.body || '').trim()) out.body = next.body;
  if (!samePhotos(next.photos, base.photos)) out.photos = next.photos;
  return out;
}

/**
 * 一张照片的上传状态（看写队列）：
 *   'processing'   还在压缩（界面自己标，不看队列）
 *   'uploading'    正在发（队列头就是它，而且在发送中）
 *   'queued'       在队列里排着（前面还有别的改动，或者稍后重试）
 *   'offline'      在队列里，但现在没网：联网后自动上传
 *   'failed'       发送失败、停在那里等人处理（重试 / 放弃）
 *   'done'         队列里已经没有它了（传上去了）
 * @param {string} path
 * @param {{ ops: object[], sending: boolean, failedId?: string|null, online: boolean }} q
 */
export function uploadStateOf(path, { ops = [], sending = false, failedId = null, online = true } = {}) {
  const i = ops.findIndex((op) => op.kind === 'upload' && op.file?.path === path);
  if (i === -1) return 'done';
  const op = ops[i];
  if (op.status === 'failed' || (failedId && op.id === failedId)) return 'failed';
  if (!online) return 'offline';
  if (i === 0 && sending) return 'uploading';
  return 'queued';
}

/** 新加的照片里传完了几张：{ done, total, failed, waiting } */
export function uploadSummary(states) {
  const list = [...states];
  return {
    total: list.length,
    done: list.filter((s) => s === 'done').length,
    failed: list.filter((s) => s === 'failed').length,
    waiting: list.filter((s) => s === 'offline').length,
  };
}

/** 状态 → 界面上的短说明 */
export const UPLOAD_LABELS = Object.freeze({
  processing: '处理中',
  uploading: '上传中',
  queued: '排队上传',
  offline: '联网后上传',
  failed: '上传失败',
  error: '打不开',
  done: '已上传',
});

/** 一个字符串的字符数（按码点，emoji 算一个） */
export function charCount(s) {
  return [...String(s || '')].length;
}
