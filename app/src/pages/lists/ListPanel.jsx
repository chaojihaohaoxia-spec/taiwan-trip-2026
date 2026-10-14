// =====================================================================
// pages/lists/ListPanel.jsx：待确认 / 待办 / 要买 三个清单的内容（一张卡片）。
//
//   卡片头（还有几项 + 快到期提醒 + 进度圆环；全部勾完换成小小的庆祝）
//   没勾的（清单本来的顺序）
//   快速添加（回车连续加，加进当前清单，新的一项从这里冒出来）
//   「已完成 3 · 收起」
//   勾完的（刚勾的在最上面）
//
// 行在 FlipGroup 里：勾完的沉到下面、取消勾的浮上来、删掉的淡出、新加的弹出来，都是 FLIP（只平移，字不压扁）。
// 左滑删除（kit/SwipeRow，拉到底直接删），删除后外壳弹「已删除 · 撤销」。
// =====================================================================

import { FlipGroup } from '../../ui/index.js';
import { Card, InlineAdd, PageEmptyState, SwipeRow } from '../../kit/index.js';
import { LISTS, splitRows, progressOf, dueSummary, zoneNote } from './model.js';
import { TodoRow } from './TodoRow.jsx';
import { PanelHead, DoneDivider } from './parts.jsx';

/** FLIP 的选项：平稳不回弹（沉下去的行不在终点晃） */
export const FLIP_OPTIONS = Object.freeze({ spring: 'smooth' });

/** 这一组行的 FLIP 触发键：顺序、勾没勾、收没收 */
export function flipKey(open, done, hideDone, extra = '') {
  return `${open.map((r) => r.id).join(',')}|${hideDone ? 'h' : 's'}|${done.map((r) => r.id).join(',')}|${extra}`;
}

/**
 * 一行（左滑删除 + FLIP 的键）。
 * @param {{ todo: object, ctx: object, actions: object, focusId?: string|null, showOwner?: boolean }} props
 */
export function RowItem({ todo, ctx, actions, focusId, showOwner = true, hold = null }) {
  return (
    <div class="litem" data-flip-key={todo.id} data-flip="position" data-moving={ctx.moving?.has(todo.id) ? '' : undefined}>
      <SwipeRow
        class="lswipe"
        label={todo.title}
        disabled={!ctx.canEdit}
        fullSwipe="delete"
        actions={[{ key: 'delete', label: '删除', glyph: 'trash', tone: 'danger', onAction: () => actions.remove(todo) }]}
        testId={`todo-swipe-${todo.id}`}
      >
        <TodoRow
          todo={todo}
          ctx={ctx}
          focused={focusId === todo.id}
          showOwner={showOwner}
          held={Boolean(hold?.has(todo.id))}
          heldFrom={Boolean(hold?.get(todo.id))}
          onToggle={actions.toggle}
          onOpen={actions.open}
          onQty={actions.qty}
          onBooking={actions.booking}
        />
      </SwipeRow>
    </div>
  );
}

/**
 * @param {{ list: string, rows: object[], ctx: object, actions: object, hold: Map, hideDone: boolean, onHideDone: () => void,
 *           focusId?: string|null, celebrate?: 'static'|'play'|null }} props
 *   actions：{ toggle, open, qty, booking, remove, add(list, text) }
 */
export function ListPanel({ list, rows, ctx, actions, hold, hideDone, onHideDone, focusId, celebrate }) {
  const meta = LISTS[list];
  // 没勾的：快到期的排前面（行程结束以后不催，保持清单顺序）
  const { open, done, doneCount } = splitRows(rows, { hold, hideDone, at: ctx.quiet ? null : ctx.now });
  const progress = progressOf(rows);
  // 行程结束以后（ctx.quiet）不催：不提醒快到期、也不说时区
  const due = ctx.quiet ? null : dueSummary(rows, { at: ctx.now, hold });
  const zone = ctx.quiet ? null : zoneNote(rows, { timeZone: ctx.timeZone, deviceZone: ctx.deviceZone, at: ctx.now, tagged: Boolean(ctx.zoneOf) });
  const empty = rows.length === 0;

  return (
    <Card padding="sm" class="lpanel" testId={`lists-panel-${list}`}>
      {empty ? (
        <PageEmptyState
          preset="lists"
          compact
          title={meta.emptyTitle}
          description={ctx.canEdit ? meta.emptyDesc : '这个清单还没有内容。'}
          testId="lists-empty"
        />
      ) : (
        <PanelHead list={list} open={progress.remaining} progress={progress} due={due} zone={zone} celebrate={celebrate} />
      )}
      <FlipGroup class="lpanel__rows" trigger={flipKey(open, done, hideDone, ctx.canEdit ? 'e' : 'r')} options={FLIP_OPTIONS}>
        {open.map((t) => <RowItem key={t.id} todo={t} ctx={ctx} actions={actions} focusId={focusId} hold={hold} />)}
        {ctx.canEdit && (
          <div class="lpanel__add" data-flip-key="__add" data-flip="position">
            <InlineAdd
              label={meta.addLabel}
              placeholder={meta.placeholder}
              onAdd={(text) => actions.add(list, text)}
              testId={`lists-add-${list}`}
            />
          </div>
        )}
        {doneCount > 0 && (
          <div class="lpanel__done" data-flip-key="__done" data-flip="position">
            <DoneDivider list={list} count={doneCount} hidden={hideDone} onToggle={onHideDone} />
          </div>
        )}
        {done.map((t) => <RowItem key={t.id} todo={t} ctx={ctx} actions={actions} focusId={focusId} hold={hold} />)}
      </FlipGroup>
    </Card>
  );
}
