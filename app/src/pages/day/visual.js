// =====================================================================
// pages/day/visual.js：每天页页头「有质感」那几样的纯逻辑（test/unit/page-visual.test.js）。
//
//   mastDate(date, timeZone, at)   大号日期：{ day: '18', month: '10月', weekday: '周日', rel: '今天'|'明天'|'昨天'|null }
//   firstSentence(text, max)       日记的第一句（去掉 Markdown、到第一个句号 / 问号 / 感叹号 / 换行；太长截断加「…」）
//   dayQuote(entries, nameOf)      这一天放一句什么：先写了正文的那篇的第一句 → { text, who } | null
//   stripPhotos(list, max)         照片条放几张：最多 max 张，多出来的数「+N」
// =====================================================================

import { formatDate, parseDate, weekdayName } from '../../lib/datetime.js';

export function mastDate(date, timeZone, at) {
  const p = parseDate(date);
  if (!p) return null;
  const rel = formatDate(date, { timeZone, at, relative: true });
  return {
    day: String(p.day),
    month: `${p.month}月`,
    weekday: weekdayName(date),
    rel: ['今天', '明天', '昨天'].includes(rel) ? rel : null,
  };
}

/** 去掉常见的 Markdown 记号 */
function plain(text) {
  return String(text || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function firstSentence(text, max = 40) {
  const t = plain(text);
  if (!t) return '';
  const m = /^[\s\S]*?[。！？!?](?=\s|$|[^。！？!?」”’）)])|^[^\n]+/.exec(t);
  let s = (m ? m[0] : t).replace(/\s+/g, ' ').trim();
  if (Array.from(s).length > max) s = `${Array.from(s).slice(0, max - 1).join('').replace(/[，、,；;：:\s]+$/, '')}…`;
  return s;
}

/**
 * @param {Array<{ user_id: string, body?: string, created_at?: string }>} entries 这一天的日记（成员顺序）
 * @param {(userId: string) => string} nameOf
 */
export function dayQuote(entries, nameOf) {
  const list = (entries || []).filter((e) => e && !e.deleted_at && String(e.body || '').trim());
  if (!list.length) return null;
  const pick = [...list].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
  const text = firstSentence(pick.body);
  return text ? { text, who: nameOf?.(pick.user_id) || '' } : null;
}

/** @returns {{ shown: object[], more: number }} */
export function stripPhotos(list, max = 3) {
  const all = Array.isArray(list) ? list : [];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
