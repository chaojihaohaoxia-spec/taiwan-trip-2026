// =====================================================================
// pages/day/empty-model.js：空白的一天（empty.jsx）用的纯逻辑（Node 里能测：test/unit/trip-new.test.js）。
//
//   parseQuickLine('10:00 早市')   → { title: '早市', time: '10:00' }   打头的钟点拆出来，其余当标题（'10:00-12:00 早市' 多一个 end）
//   quickRow(line, { dayId, primary }) → 写进 items 的一行（主方案、计划中，按钟点排进当天）
//   blankCopy({ phase, canEdit })  → 空白天的两行字
// =====================================================================

import { sortKeyForTime, sortKeyBetween } from './model.js';

const pad = (n) => String(n).padStart(2, '0');

const HALF = /^(凌晨|上午|早上|中午|下午|傍晚|晚上)\s*/;

/** 打头的一个钟点：「10:00」「9点半」「下午3点」→ { h, min, len }（len 是吃掉的字数）；不是钟点 → null */
function timeAt(s, pmDefault = null) {
  let rest = s;
  let half = pmDefault;
  const hm = HALF.exec(rest);
  if (hm && /^\d/.test(rest.slice(hm[0].length))) {
    half = hm[1];
    rest = rest.slice(hm[0].length);
  }
  let m = /^(\d{1,2})\s*[:：.]\s*(\d{2})(?!\d)/.exec(rest);
  let h;
  let min;
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else {
    m = /^(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/.exec(rest);
    if (!m) return null;
    h = Number(m[1]);
    min = m[2] === '半' ? 30 : m[3] ? Number(m[3]) : 0;
  }
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  // 晚上 12 点 / 24:00 是半夜：这一天里排不上钟点（排到最后，原话留在标题里）
  const midnight = h === 24 || (h === 12 && (half === '晚上' || half === '傍晚'));
  if (!midnight && h > 23) return null;
  if (!midnight && (half === '下午' || half === '傍晚' || half === '晚上') && h < 12) h += 12;
  if (half === '凌晨' && h === 12) h = 0;
  return { h, min, midnight, len: s.length - rest.length + m[0].length, half };
}

/**
 * 「10:00 早市」「9点半 去码头」「21：30夜市」「10:00-12:00 早市」→ 拆出钟点（只认打头的）。
 * 认的写法：H:MM / H：MM / H.MM、H 点 / H 点半 / H 点 MM（分）、凌晨 / 上午 / 下午 / 晚上 H 点（12 小时制往后挪 12）；
 * 后面跟「-12:00」「到 3 点」是结束时间（end）。晚上 12 点、24:00 是半夜：不拆钟点，原样当标题（排在当天最后）。
 * 只有钟点没有别的字 → 标题为空（调用方不加）。
 * @returns {{ title: string, time: string|null, end?: string }}
 */
export function parseQuickLine(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const t = timeAt(raw);
  if (!t || t.midnight) return { title: String(text || '').trim(), time: null };
  let s = raw.slice(t.len);
  let endTime = null;
  const dash = /^\s*(?:[-–—~～至到])\s*/.exec(s);
  if (dash) {
    // 结束时间跟着开始的上午 / 下午走（「下午2点-4点」是 16:00）
    const e = timeAt(s.slice(dash[0].length), t.half && !['凌晨', '上午', '早上'].includes(t.half) ? t.half : null);
    if (e && !e.midnight) {
      let eh = e.h;
      if (eh < t.h && eh + 12 <= 23 && !e.half) eh += 12;
      if (eh * 60 + e.min > t.h * 60 + t.min) endTime = `${pad(eh)}:${pad(e.min)}`;
      s = s.slice(dash[0].length + e.len);
    }
  }
  const title = s.replace(/^\s*[，,、\-—–·]?\s*/, '').trim();
  const out = { title, time: `${pad(t.h)}:${pad(t.min)}` };
  if (endTime) out.end = endTime;
  return out;
}

/**
 * 快速加的一行 → items 行（主方案、计划中；有钟点按钟点排进当天，没有就排在最后）。
 * @param {string} line
 * @param {{ dayId: string, primary?: object[] }} o primary：当天主方案（已排序）
 * @returns {object|null} 标题是空的 → null
 */
export function quickRow(line, { dayId, primary = [] }) {
  const { title, time, end } = parseQuickLine(line);
  if (!title) return null;
  const last = primary.length ? Number(primary[primary.length - 1].sort_key) : null;
  const sort = time ? sortKeyForTime(primary, time) ?? sortKeyBetween(last, null) : sortKeyBetween(Number.isFinite(last) ? last : null, null);
  const row = { title: title.slice(0, 200), kind: 'other', start_time: time, variant: 'primary', day_id: dayId, status: 'planned', sort_key: sort };
  if (end) row.end_time = end;
  return row;
}

/** 空白天的字：能编辑 →「还空着」+ 怎么加；只读 → 等对方排；结束了 → 这天没留下安排 */
export function blankCopy({ phase, canEdit }) {
  if (phase === 'ended') return { title: '这一天没留下安排', desc: canEdit ? '想补记，就写一条。' : '' };
  if (!canEdit) return { title: '还空着', desc: '等对方排好，就会出现在这里。' };
  return { title: '还空着', desc: '想去哪、几点，写一条就行。回车接着写下一条。' };
}
