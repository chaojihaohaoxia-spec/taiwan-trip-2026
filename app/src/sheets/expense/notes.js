// =====================================================================
// sheets/expense/notes.js：记一笔面板里几句说明文字的纯逻辑（Node 里能直接测：test/unit/page-ledger.test.js）。
//
//   footerNote({ snapshot, isOnline, currency, home, readOnly })   提交按钮下面那一行：按什么汇率记、离线了怎么办、只读成员
// =====================================================================

import { fxStatus, formatRate } from '../../lib/services/fx.js';
import { formatRelativeTime } from '../../lib/datetime.js';
import { now } from '../../lib/clock.js';

/**
 * 提交按钮下面那一行小字：
 *   只读成员 → 「你是只读成员，不能记账」
 *   离线     → 「现在离线：先存在手机上，联网后自动同步 · 按最近一次汇率（1 港币 ≈ 3,294 越南盾，5 小时前更新）记」
 *   过期 / 内置参考值 → 「按 1 港币 ≈ 3,294 越南盾 折算 · 汇率 2 天前更新，先按这个汇率记」（警示色）
 *   正常     → 「按 1 港币 ≈ 3,294 越南盾 折算 · 汇率 · 3 小时前更新」
 *   本币     → 空（占一行的高度，按钮不跳）
 * @param {{ snapshot: object|null, isOnline: boolean, currency: string|null, home: string|null, readOnly?: boolean, at?: Date }} o
 * @returns {{ text: string, tone: 'offline'|'warning'|undefined }}
 */
export function footerNote({ snapshot: snap, isOnline, currency, home, readOnly = false, at = now() }) {
  const foreign = Boolean(currency && home && currency !== home);
  const rate = foreign && snap ? formatRate(snap, currency) : '';
  const when = snap?.providerUpdatedAt || snap?.fetchedAt;
  const updated = when ? `${formatRelativeTime(when, { now: at })}更新` : '';
  if (readOnly) return { text: '你是只读成员，不能记账', tone: undefined };
  if (!isOnline) {
    let text = '现在离线：先存在手机上，联网后自动同步';
    if (foreign) text += rate ? ` · 按最近一次汇率（${rate}${updated ? `，${updated}` : ''}）记` : ' · 联网后再补汇率';
    return { text, tone: 'offline' };
  }
  if (!foreign) return { text: ' ', tone: undefined };
  const notes = [];
  if (rate) notes.push(`按 ${rate} 折算`);
  const st = fxStatus(snap, { now: at });
  let tone;
  if (!snap) notes.push(st.text);
  else if (snap.source === 'fallback') {
    notes.push('离线汇率 · 内置参考值，先按这个记');
    tone = 'warning';
  } else if (snap.stale || snap.offline) {
    notes.push(updated ? `汇率 ${updated}，先按这个汇率记` : st.text);
    tone = 'warning';
  } else if (st.text) notes.push(st.text);
  return { text: notes.join(' · ') || ' ', tone };
}
