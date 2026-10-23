// =====================================================================
// pages/day/empty.jsx：空白的一天（新建的行程每天都是这样，批 A · 三）。
//
//   还空着                               ← 宋体，一页纸的留白感
//   想去哪、几点，写一条就行。回车接着写下一条。
//   [＋ 比如：10:00 早市            加上]   ← kit/InlineAdd：回车就加进这一天（打头的钟点自动拆出来，按钟点排）；
//                                          一次粘贴几行就加几条（从备忘录、攻略里贴）
//   详细加一项：地点、几点到几点 ›         ← 打开条目面板（预填这一天）
//
// 加了第一条以后每天页照常显示时间轴；这次是从这里加的，就只留输入框在时间轴下面（compact），可以接着写。
// 两种样子是同一个组件、输入框在同一个位置（DayPage 也放在同一个位置），换的时候输入框不重建，焦点和键盘都留着。
// 只读成员：只有字，没有输入框。逻辑在 empty-model.js。
// =====================================================================

import './empty.css';
import { InlineAdd } from '../../kit/InlineAdd.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { blankCopy } from './empty-model.js';

/**
 * @param {{ canEdit: boolean, phase: string|null, onAdd: (e?: Event) => void, onQuickAdd: (text: string) => any, compact?: boolean }} props
 */
export function BlankDay({ canEdit, phase, onAdd, onQuickAdd, compact = false }) {
  const copy = blankCopy({ phase, canEdit });
  return (
    <section class={compact ? 'dblank dblank--compact' : 'dblank'} data-testid={compact ? 'day-quick' : 'day-empty'} aria-label={compact ? '接着加' : copy.title}>
      {!compact && <span class="dblank__rule" aria-hidden="true" />}
      {!compact && <h2 class="dblank__title">{copy.title}</h2>}
      {!compact && copy.desc && <p class="dblank__desc">{copy.desc}</p>}
      {canEdit && <InlineAdd placeholder={compact ? '接着写：14:00 下午茶' : '比如：10:00 早市'} label="写一条" submitLabel="加上" onAdd={onQuickAdd} testId="day-quick-add" />}
      {canEdit && !compact && (
        <button type="button" class="dblank__more" data-press="highlight" onClick={onAdd} data-testid="day-empty-add">
          <Glyph name="cal-plus" size={18} />
          <span>详细加一项：地点、几点到几点</span>
          <Glyph name="chev-r" size={16} stroke={2.2} />
        </button>
      )}
    </section>
  );
}
