// =====================================================================
// pages/lists/TodoRow.jsx：清单里的一行（样稿概览页「出发前待办」那种行 + 打包步进器）。
//
//   ◯  标题                                   [− 2 件 +]
//      ⏱ 还剩 5 小时 · 今天 23:59 前   ● Cathy      （时区在卡片头说一次，行里不重复）
//      备注（没勾的显示全文；勾完的只留一行）
//      [📞 +84 …]  [🛏 椰影湾酒店]  [D2 · 出海浮潜]      （备注里的电话 / 网址在最前面，点了直接打 / 打开）
//      Cathy 勾的 · 昨天 21:10                （勾完的）
//
// 结构：整行铺一个透明按钮（点了打开待办弹层编辑，按下整行换底色），勾选框、步进器、小链接浮在它上面各管各的
// （可点的东西不互相嵌套）。勾选：圆圈从中心弹出 + 对勾描出来（ui/Checkbox），标题一条线从左往右划过去；
// 位置由清单决定（刚勾的先留在原位一会儿，再 FLIP 沉到下面，见 ListsPage / useSinkHold）。
// 只读成员：勾选框、步进器禁用；点行照样能打开看详情（弹层里是只读的）。
// =====================================================================

import { Fragment } from 'preact';
import { Checkbox, Stepper } from '../../ui/index.js';
import { PersonChip, KindIcon } from '../../kit/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { href } from '../../router/index.js';
import { dueInfo, linkChips, inferUnit, doneByline, noteActions } from './model.js';
import { ActionChip } from './ActionChip.jsx';

/**
 * 小链接的路由目标：条目 → 那天并展开它（备选池里的 → 行程概览 ?item=）；哪天 → 那天
 */
export function chipTarget(chip, tripId) {
  if (chip.type === 'item') {
    return chip.date
      ? { name: 'day', params: { tripId, date: chip.date }, query: { item: chip.id } }
      : { name: 'trip', params: { tripId }, query: { item: chip.id } };
  }
  if (chip.type === 'day') return { name: 'day', params: { tripId, date: chip.date } };
  return null;
}

/**
 * @param {{
 *   todo: object, ctx: object, focused?: boolean, showOwner?: boolean, showQty?: boolean,
 *   onToggle: (todo: object, checked: boolean) => void, onOpen: (todo: object, el: Element) => void,
 *   onQty: (todo: object, qty: number) => void, onBooking: (bookingId: string, el: Element) => void,
 * }} props
 *   ctx：{ tripId, timeZone, deviceZone, now, meId, canEdit, quiet（行程已结束：不催）, members: Map, memberName, links: { bookings, items, days, dayNumber } }
 */
export function TodoRow({ todo, ctx, focused = false, showOwner = true, held = false, heldFrom = false, onToggle, onOpen, onQty, onBooking }) {
  const { canEdit, now, timeZone } = ctx;
  // 版式按“勾之前”的样子算，直到这一行真的沉下去（held：刚勾 / 刚取消勾、还留在原位）：
  // 勾上的那一下行高不变（不多出「我勾的 · 刚刚」、备注不收成一行），下一行不会被挤下去、点到别的东西；
  // 版式的变化和沉底的那次 FLIP 一起发生（交互评审 P1-3）。勾选框、划线照常按 todo.done 马上变。
  const layoutDone = held ? Boolean(heldFrom) : Boolean(todo.done);
  const title = todo.title || '（没有标题）';
  // 行程结束以后（ctx.quiet）：没勾的也只平平地写「1月8日 23:59 前」，不标红、不写「已过期」
  const due = dueInfo(todo.due_at, {
    at: now, timeZone, done: Boolean(layoutDone || ctx.quiet), deviceZone: ctx.deviceZone,
    displayZone: todo.due_at && ctx.zoneOf ? ctx.zoneOf(todo.due_at) : undefined, hereZone: ctx.here,
  });
  const chips = linkChips(todo, { ...ctx.links, timeZone, at: now });
  // 备注里的电话 / 网址：没勾的才给（勾完的事不用再打电话了，行也收短一点）
  const acts = layoutDone ? [] : noteActions(todo.note, { title: todo.title });
  const assignee = showOwner && todo.assignee_user_id ? ctx.members.get(todo.assignee_user_id) || null : null;
  const byline = layoutDone ? doneByline(todo, { memberName: ctx.memberName, meId: ctx.meId, at: now, timeZone }) : null;
  const hasQty = todo.qty !== null && todo.qty !== undefined;
  const unit = hasQty ? inferUnit(todo.title, todo.extra) : '';
  // 勾完的不再提醒截止时间（下面改说是谁、什么时候勾的）
  const showDue = Boolean(due) && !layoutDone;
  const hasBody = showDue || Boolean(assignee) || Boolean(todo.note) || chips.length > 0 || acts.length > 0 || Boolean(byline);

  return (
    <div
      class="lrow"
      data-done={todo.done ? '' : undefined}
      data-layout-done={layoutDone ? '' : undefined}
      data-due={showDue ? due.state : undefined}
      data-focus={focused ? '' : undefined}
      data-qty={hasQty ? '' : undefined}
      data-body={hasBody ? '' : undefined}
      data-testid={`todo-${todo.id}`}
    >
      <span class="lrow__check">
        <Checkbox
          variant="inline"
          checked={Boolean(todo.done)}
          disabled={!canEdit}
          onChange={(v) => onToggle(todo, v)}
          label={<span class="visually-hidden">{title}</span>}
          data-testid={`todo-check-${todo.id}`}
        />
      </span>
      {/* 整行的透明按钮：放在勾选框后面（Tab 先到勾选框，再到「编辑」），视觉上铺在最底下 */}
      <button
        type="button"
        class="lrow__hit"
        data-press="highlight"
        aria-label={canEdit ? `编辑「${title}」` : `查看「${title}」`}
        onClick={(e) => onOpen(todo, e.currentTarget)}
        data-testid={`todo-open-${todo.id}`}
      />
      <span class="lrow__title"><span class="lrow__tt">{title}</span></span>
      {hasQty && (
        <span class="lrow__qty">
          <Stepper
            value={Math.max(0, Number(todo.qty) || 0)}
            onChange={(v) => onQty(todo, v)}
            min={0}
            max={99}
            unit={unit || undefined}
            addLabel="加入"
            label={`「${title}」的数量`}
            disabled={!canEdit}
          />
        </span>
      )}
      {hasBody && (
        <span class="lrow__body">
          {(showDue || assignee) && (
            <span class="lrow__meta">
              {showDue && (
                <span class={`lrow__due lrow__due--${due.tone}`} data-testid={`todo-due-${todo.id}`}>
                  <Glyph name={due.state === 'overdue' ? 'alert' : 'clock'} size={14} stroke={2} />
                  {/* 读屏念完整的一句（带时区）；看的是分段、每段自己不折行，只在「 · 」处折行；钟点和行程时区不同时跟一个「香港时间」小标签 */}
                  <span class="visually-hidden">截止：{due.label}</span>
                  <span class="lrow__duet" aria-hidden="true">
                    {due.parts.map((t, i) => (
                      <Fragment key={i}>
                        {i > 0 && '\u00a0· '}
                        <span class="lrow__part">{t}</span>
                      </Fragment>
                    ))}
                    {due.zoneTag && <span class="lrow__zone" data-testid={`todo-zone-${todo.id}`}>{due.zoneTag}</span>}
                  </span>
                </span>
              )}
              {assignee && <PersonChip member={assignee} size="sm" you={assignee.user_id === ctx.meId} class="lrow__who" />}
            </span>
          )}
          {todo.note && <span class="lrow__note">{todo.note}</span>}
          {(chips.length > 0 || acts.length > 0) && (
            <span class="lrow__links">
              {acts.map((a) => <ActionChip key={a.href} a={a} />)}
              {chips.map((c) => (c.type === 'booking' ? (
                <button
                  key={`b-${c.id}`}
                  type="button"
                  class="lchip"
                  data-press="scale"
                  onClick={(e) => onBooking(c.id, e.currentTarget)}
                  aria-label={`查看预订「${c.label}」`}
                >
                  <KindIcon type="booking" kind={c.kind} size={14} />
                  <span class="lchip__label">{c.label}</span>
                </button>
              ) : (
                <a
                  key={`${c.type}-${c.id}`}
                  class="lchip"
                  data-press="scale"
                  href={href(chipTarget(c, ctx.tripId))}
                  aria-label={c.type === 'item' ? `去看条目「${c.label}」${c.detail ? `（${c.detail}）` : ''}` : `去看 ${c.detail || c.label}`}
                >
                  {c.type === 'item'
                    ? <KindIcon type="item" kind={c.kind} size={14} />
                    : <Glyph name="cal-plus" size={14} stroke={2} />}
                  {c.type === 'item' && c.detail && <span class="lchip__day">{c.detail}</span>}
                  <span class="lchip__label">{c.type === 'item' ? c.label : c.detail ? `${c.label} · ${c.detail}` : c.label}</span>
                </a>
              )))}
            </span>
          )}
          {byline && (
            <span class="lrow__by">
              <Glyph name="check" size={12} stroke={2.4} />
              <span>{byline}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}
