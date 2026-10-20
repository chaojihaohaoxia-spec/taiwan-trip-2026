// =====================================================================
// sheets/cover/model.js：「封面和颜色」的纯逻辑（test/unit/page-visual.test.js）。
//
//   coverPhotos({ journal, reviews, days, limit })   能挑来当封面的照片：这趟的日记、评级照片，按天、按拍摄时间，最多 limit 张
//   presetOf(cover)                                  现在用的是哪个预设颜色（不是预设返回 null）
//   colorChoices(cover)                              六个预设，现在用的颜色不在里面时放在最前面（「现在的颜色」）
//   coverPatch(cover, { imagePath, accent, accent2 }) 改完的 trips.cover（别的键原样留着；imagePath = null 去掉照片）
//   isCoverChanged(cover, form)                      有没有改动
//   replacedCover(oldPath, newPath, { tripId, me, inUse })   换掉的旧封面要不要删（只删自己从面板传的 covers/ 里的、别处没用到的）
//
// 颜色是行程的**数据**（不是界面颜色）：存的是不带 # 的六位十六进制（和 trip-new 一样，tokens 测试不让 JS 里出现界面颜色），写进 cover 时补 #。
// =====================================================================

import { COVER_PRESETS } from '../trip-new/model.js';

const HEX6 = /^[0-9A-Fa-f]{6}$/;
const strip = (v) => String(v || '').replace(/^#/, '').toUpperCase();
const withHash = (v) => (HEX6.test(v) ? `#${v.toUpperCase()}` : null);

const ms = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : Infinity;
};

/**
 * @param {{ journal?: object[], reviews?: object[], days?: Array<{ id: string }>, limit?: number }} o
 * @returns {Array<{ path: string, takenAt: string|null }>}
 */
export function coverPhotos({ journal = [], reviews = [], days = [], limit = 12 } = {}) {
  const order = new Map(days.map((d, i) => [d.id, i]));
  const out = [];
  const seen = new Set();
  const push = (p, dayIndex) => {
    if (!p?.path || seen.has(p.path)) return;
    seen.add(p.path);
    out.push({ path: p.path, takenAt: p.taken_at || null, dayIndex });
  };
  for (const j of journal) {
    if (!j || j.deleted_at) continue;
    for (const p of j.photos || []) push(p, order.has(j.day_id) ? order.get(j.day_id) : 999);
  }
  for (const r of reviews) {
    if (!r || r.deleted_at) continue;
    for (const p of r.photos || []) push(p, 999);
  }
  return out
    .sort((a, b) => a.dayIndex - b.dayIndex || ms(a.takenAt) - ms(b.takenAt))
    .slice(0, limit)
    .map(({ path, takenAt }) => ({ path, takenAt }));
}

/** 现在用的是哪个预设（主题色一样就算；第二色不比） */
export function presetOf(cover) {
  const a = strip(cover?.accent);
  return COVER_PRESETS.find((p) => p.colors[0] === a) || null;
}

/**
 * 颜色选项：{ key, label, colors: [主, 第二] }。现在的颜色不是预设时，第一个是「现在的颜色」（key 'current'）。
 */
export function colorChoices(cover) {
  const a = strip(cover?.accent);
  const b = strip(cover?.accent_2);
  const list = [...COVER_PRESETS];
  if (HEX6.test(a) && !presetOf(cover)) list.unshift({ key: 'current', label: '现在的颜色', colors: [a, HEX6.test(b) ? b : a] });
  return list;
}

/** 表单的初始值 */
export function coverForm(cover) {
  const choices = colorChoices(cover);
  const preset = presetOf(cover);
  const key = preset ? preset.key : choices[0]?.key === 'current' ? 'current' : null;
  return { imagePath: cover?.image_path || null, color: key };
}

/**
 * 改完的 trips.cover：照片、颜色按表单，别的键（emoji 等）原样留着。
 * @param {object} cover 现在的 trips.cover
 * @param {{ imagePath: string|null, color: string|null }} form
 */
export function coverPatch(cover, form) {
  const next = { ...(cover || {}) };
  if (form.imagePath) next.image_path = form.imagePath;
  else delete next.image_path;
  const choice = colorChoices(cover).find((c) => c.key === form.color);
  if (choice) {
    const a = withHash(choice.colors[0]);
    const b = withHash(choice.colors[1]);
    if (a) next.accent = a;
    if (b) next.accent_2 = b;
  }
  return next;
}

/** 有没有改动 */
export function isCoverChanged(cover, form) {
  const init = coverForm(cover);
  return (form.imagePath || null) !== init.imagePath || form.color !== init.color;
}

/** 颜色色块的 style（accent-scope 派生出实心底） */
export function choiceStyle(choice) {
  return { '--trip-accent': withHash(choice.colors[0]) || 'initial', '--trip-accent-2': withHash(choice.colors[1]) || 'initial' };
}

/**
 * 换了封面以后，旧的那张文件要不要删：返回要删的 path，或者 null。
 * 只删「自己从这个面板传的」（<行程>/<我>/covers/…，存储的 RLS 也只让删自己目录里的）、而且日记 / 评级里没用到的；
 * 从日记里挑来当封面的照片（…/journal/…）、别人传的封面都不删。
 * @param {string|null} oldPath
 * @param {string|null} newPath
 * @param {{ tripId: string, me: string|null, inUse?: Set<string> }} o
 */
export function replacedCover(oldPath, newPath, { tripId, me, inUse = new Set() }) {
  if (!oldPath || oldPath === newPath || !tripId || !me) return null;
  if (!String(oldPath).startsWith(`${tripId}/${me}/covers/`)) return null;
  if (inUse.has(oldPath)) return null;
  return oldPath;
}
