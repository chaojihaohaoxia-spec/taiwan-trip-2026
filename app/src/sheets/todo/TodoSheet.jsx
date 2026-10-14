// =====================================================================
// sheets/todo/TodoSheet.jsx：弹层「todo」——加待办 / 编辑待办（SPEC §5.7、§9.2）。
//
// 打开：sheets/index.js 的 openTodoSheet({ list, itemId, bookingId, dayId })（新建，预填）/ openTodoSheet(todo.id)（编辑）。
// ＋ 面板「加待办」、清单页点一行、预订 / 每天页「加一项要确认的事」都这么开；参数写法见 sheets/README.md。
//
//   放在哪个清单   [待确认 | 待办 | 打包 | 要买]（分段控件；换清单时排到那个清单最后）
//   标题（新建时自动聚焦，回车直接添加）、备注（里面的电话 / 邮箱 / 网址在下面给「打电话 / 打开网页」小胶囊）
//   分类（打包）   证件 / 衣物 / 电子 / 洗护 / 药品 / 其他 / 自定义；没选按标题猜
//   数量           步进器（打包、要买默认有；别的清单原来有才显示）
//   谁的东西 / 谁负责   共用（不指定）/ 每位成员
//   截止时间       日期 + 钟点（行程时区），快捷：今晚 21:00 / 明晚 21:00 / 出发前一晚；下面实时说「还剩 2 天 3 小时」
//   关联           哪天（D1… 小胶囊）、预订、条目（按天分组的下拉）；选了的旁边能直接打开
//   编辑时：已完成（谁、什么时候勾的）、删除（外壳弹「已删除 · 撤销」）
// 提交：SubmitButton 受控（文字 → 转圈 → 对勾）：先校验（不通过：标题摇一下、说原因，不转圈），通过才 insert / update →
//       await r.saved（写进本机队列就算成功，离线也行）→ 对勾 → 面板收回（force 关，不再问）；
//       不在清单页时弹「已加到「待办」· 查看」。
// 只读成员：所有输入禁用、没有提交按钮，顶上说明。改了一半关面板先问「放弃未保存的内容？」。
// =====================================================================

import './todo.css';
import { Fragment } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, toast } from '../../overlay/index.js';
import { SubmitButton, SegmentedControl, Stepper, Chip, Checkbox, Button, Skeleton, ExpandableCard } from '../../ui/index.js';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon, kindLabel } from '../../kit/index.js';
import { route, navigate, href } from '../../router/index.js';
import { authState } from '../../data/index.js';
import { now } from '../../lib/clock.js';
import { haptic } from '../../lib/native.js';
import { formatItemTime, formatDate, deviceTimeZone, timeZoneLabel } from '../../lib/datetime.js';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { parseSheetArg } from '../args.js';
import { openBookingSheet } from '../index.js';
import {
  LIST_IDS, LISTS, PACKING_CATEGORIES, categoryOf, inferCategory, inferUnit, ownerOptions, dueInfo, duePresets, dueParts, dueFromParts,
  doneByline, deviceEquivalent, zonesDiffer,
} from '../../pages/lists/model.js';
import { NoteActions } from '../../pages/lists/ActionChip.jsx';
import { initialForm, validateForm, formToValues, formPatch, isDirty, sheetTitle, linkSummaryText, CATEGORY_MAX } from './form.js';

/** 表单 → 标题 / footer / Sheet 的小通道（同一时间只开一个待办面板） */
const meta = signal({ dirty: false, canSubmit: false, readOnly: false, list: null });
/** 表单登记的动作（validate / save / focusError） */
const api = { current: null };

const MIN_LOADING = 420;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当前网址里 todo 弹层的参数（Sheet 外层也要知道是新建还是编辑，好写标题） */
function currentArg() {
  const stack = route.value?.sheets || [];
  const hit = stack.find((s) => s.id === 'todo');
  return hit ? hit.arg ?? null : null;
}

/** 摇一下（输入有误；参数和提交按钮同一套，ui/shake.js） */
function shake(el) {
  if (!el) return;
  animateSpring(el, {
    channel: 'todo-shake',
    from: { x: 0 },
    to: { x: 0 },
    velocity: { x: SHAKE_VELOCITY },
    spring: SHAKE_SPRING,
    precision: { x: SHAKE_PRECISION },
    commit: 'clear',
    reduced: 'instant',
    render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
  });
}

export default function TodoSheet() {
  const { mode, fields } = parseSheetArg(currentArg());
  const m = meta.value;
  const list = m.list || fields.list || 'todo';
  const [btn, setBtn] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const resultRef = useRef(null);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (btn === 'loading' || btn === 'success') return;
    const a = api.current;
    if (!a) return;
    const problem = a.validate();
    if (problem) {
      a.focusError(problem);
      return;
    }
    setBtn('loading');
    const t0 = performance.now();
    try {
      const res = await a.save();
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      resultRef.current = res;
      setBtn('success');
    } catch (err) {
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      setErrMsg(err?.message && /[一-鿿]/.test(err.message) ? err.message : '没保存上，请重试');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };
  if (api.current) api.current.submit = onSubmit;

  const onSaved = () => {
    const res = resultRef.current;
    resultRef.current = null;
    closeOverlay('todo', { force: true });
    if (!res || res.mode !== 'new') return;
    const r = route.peek();
    if (r?.name !== 'lists' && res.tripId) {
      toast.success(`已加到「${LISTS[res.list]?.label || '清单'}」`, {
        action: { label: '查看', onClick: () => navigate({ name: 'lists', params: { tripId: res.tripId }, query: { list: res.list, todo: res.id } }) },
      });
    }
  };

  return (
    <Sheet
      sheetId="todo"
      title={sheetTitle(list, mode)}
      detents={['content', 'large']}
      confirmClose={m.dirty && !m.readOnly}
      testId="sheet-todo"
      onClosed={() => setBtn('idle')}
      footer={() => (m.readOnly ? null : (
        <div class="tdf-foot">
          <SubmitButton
            block
            state={btn}
            label={mode === 'edit' ? '保存' : '添加'}
            loadingLabel="正在保存"
            successLabel={mode === 'edit' ? '已保存' : '已添加'}
            errorLabel="重试"
            errorMessage={errMsg}
            disabled={!m.canSubmit}
            onClick={onSubmit}
            onSuccess={onSaved}
            data-testid="todo-submit"
          />
        </div>
      ))}
    >
      {({ arg }) => <Body key={arg ?? 'new'} />}
    </Sheet>
  );
}

/** 表单本体（按弹层参数 key 重建）。store 还没好时显示骨架；编辑的那一项找不到时说清楚。 */
function Body() {
  const { mode, id, fields } = useSheetArgs();
  const { tripId, store, pending } = useSheetTrip();
  const trip = store?.trip.value || null;
  const row = mode === 'edit' && id ? store?.tables.todos.value.get(id) || null : null;
  const ready = Boolean(trip);

  if (!ready) {
    if (!pending && store && store.status.value === 'error') {
      return <EmptyState compact title="没有读到行程" description={store.error.value?.message || '请稍后再试'} data-testid="todo-sheet-error" />;
    }
    // 骨架和表单差不多高：面板按内容高度升起时（'content' 档在出场时量一次），数据到了表单不会被挡在下面
    return (
      <div class="tdf tdf--loading" aria-busy="true" data-testid="todo-sheet-loading">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={44} radius="pill" />
        <Skeleton variant="rect" height={140} radius="lg" />
        {[0.3, 0.45, 0.4].map((w) => (
          <div key={w} class="tdf-field">
            <Skeleton variant="text" width={`${Math.round(w * 100)}%`} />
            <Skeleton variant="rect" height={44} radius="pill" />
          </div>
        ))}
        <Skeleton variant="rect" height={96} radius="lg" />
      </div>
    );
  }
  if (mode === 'edit' && !row) {
    return <Missing />;
  }
  return <Form store={store} tripId={tripId} trip={trip} row={row} mode={mode} fields={fields} />;
}

/** 编辑的那一项不在了（被对方删掉、旧链接） */
function Missing() {
  useEffect(() => {
    meta.value = { dirty: false, canSubmit: false, readOnly: true, list: meta.peek().list };
  }, []);
  return (
    <div class="tdf" data-testid="todo-sheet-missing">
      <EmptyState compact title="这一项找不到了" description="可能已经被删除（也可能是对方刚删的）。" />
      <Button variant="secondary" block onClick={() => closeOverlay('todo', { force: true })}>知道了</Button>
    </div>
  );
}

/**
 * 点日期 / 钟点输入框任何地方都弹出选择器（浏览器自带的小日历图标藏起来了，见 todo.css）。
 * iOS 本来就弹滚轮；不支持 showPicker 或不让弹（不在点击里、跨域 iframe）就算了，照样能直接打字。
 */
function openPicker(e) {
  const el = e.currentTarget;
  if (el.disabled || typeof el.showPicker !== 'function') return;
  try {
    el.showPicker();
  } catch {
    /* 不让弹也没关系 */
  }
}

/** 一行说明 + 控件（左标签右控件；窄屏控件换到下一行） */
function Field({ label, children, wide = false, testId }) {
  return (
    <div class={wide ? 'tdf-field tdf-field--wide' : 'tdf-field'} data-testid={testId}>
      <span class="tdf-field__label">{label}</span>
      <div class="tdf-field__control">{children}</div>
    </div>
  );
}

function Form({ store, tripId, trip, row, mode, fields }) {
  const timeZone = trip.timezone || 'Asia/Hong_Kong';
  const canEdit = store.view.canEdit.value;
  const readOnly = !canEdit;
  const members = store.view.members.value;
  const meId = authState.value.user?.id || null;
  const at = now();

  const [initial] = useState(() => initialForm(row, fields, {
    timeZone,
    items: store.tables.items.value,
    bookings: store.tables.bookings.value,
    days: store.tables.days.value,
  }));
  // 打开面板那一刻的那一行（保存时按它算“改了什么”）
  const [rowAtOpen] = useState(() => row);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [categoryTouched, setCategoryTouched] = useState(Boolean(initial.category));
  const [customOpen, setCustomOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(Boolean(initial.dueDate));
  // 关联：平时收起成一行摘要；网址带了「从哪个预订 / 条目 / 哪天来」也先收着（摘要里看得到），想改再点开
  const [linksOpen, setLinksOpen] = useState(false);
  const titleRef = useRef(null);
  const noteRef = useRef(null);
  const customRef = useRef(null);
  const titleBoxRef = useRef(null);

  const patch = (p) => {
    setError(null);
    setForm((f) => ({ ...f, ...p }));
  };

  const dirty = isDirty(form, initial);
  const deleted = mode === 'edit' && !store.tables.todos.value.get(row?.id);
  const canSubmit = canEdit && !deleted;

  // 告诉外层（Sheet 的标题、confirmClose、footer 的按钮）
  useLayoutEffect(() => {
    meta.value = { dirty, canSubmit, readOnly, list: form.list };
  }, [dirty, canSubmit, readOnly, form.list]);
  useEffect(() => () => {
    meta.value = { dirty: false, canSubmit: false, readOnly: false, list: null };
  }, []);

  // 标题框跟着字数长高（textarea）
  const grow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    grow(titleRef.current);
    grow(noteRef.current);
  }, []);
  // 点「＋ 自定义」：输入框出来就聚焦（动态插进来的元素 autofocus 不生效）
  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen]);

  // 登记提交动作
  const mine = useRef({});
  useLayoutEffect(() => {
    api.current = mine.current;
    return () => {
      if (api.current === mine.current) api.current = null;
    };
  }, []);
  Object.assign(mine.current, {
    validate: () => (deleted ? '这一项已经被删除了' : validateForm(form)),
    focusError(message) {
      setError(message);
      haptic('warning');
      shake(titleBoxRef.current);
      titleRef.current?.focus({ preventScroll: true });
    },
    async save() {
      const listRows = store.view.todosByList.value.get(form.list) || [];
      if (mode === 'edit') {
        // 只提交这次改了的字段（和打开时比，不和现在的行比；见 form.js 的 formPatch）
        const changes = formPatch(form, initial, { timeZone, row: rowAtOpen, listRows });
        if (!Object.keys(changes).length) {
          haptic('success');
          return { mode, id: row.id, list: form.list, tripId };
        }
        const r = store.update('todos', row.id, changes);
        if (!r?.unchanged) await r.saved;
        haptic('success');
        return { mode, id: row.id, list: form.list, tripId };
      }
      const values = formToValues(form, { timeZone, row, listRows });
      const r = store.insert('todos', values);
      await r.saved;
      haptic('success');
      return { mode, id: r.row?.id || null, list: form.list, tripId };
    },
  });

  // ---------- 选项 ----------
  const options = useMemo(() => ownerOptions(members).filter((o) => o.value !== 'all'), [members]);
  const categories = useMemo(() => {
    const out = [];
    for (const t of store.view.todosByList.value.get('packing') || []) {
      const c = categoryOf(t);
      if (!out.includes(c)) out.push(c);
    }
    for (const c of PACKING_CATEGORIES) if (!out.includes(c)) out.push(c);
    if (form.category && !out.includes(form.category)) out.push(form.category);
    return out;
  }, [store.view.todosByList.value, form.category]);
  const guessed = form.list === 'packing' && !categoryTouched ? inferCategory(form.title) : null;
  const shownCategory = form.list === 'packing' ? (categoryTouched ? form.category : guessed || '') : form.category;

  const days = store.view.days.value;
  const bookings = store.view.bookings.value;
  const itemsByDay = store.view.itemsByDay.value;
  const showQty = form.list === 'packing' || form.list === 'buy' || initial.qty !== null;
  const unit = inferUnit(form.title, row?.extra);
  const deviceZone = useMemo(() => deviceTimeZone(), []);
  const dueIso = form.dueDate ? dueFromParts(form.dueDate, form.dueTime, timeZone) : null;
  const due = dueIso ? dueInfo(dueIso, { at, timeZone }) : null;
  // 设备时区和行程时区不一样（出发前人在香港）：说明这里填的是越南时间，并换算成这台设备的时间
  const zoneHint = zonesDiffer(deviceZone, timeZone, at)
    ? `按${timeZoneLabel(timeZone)}时间填${dueIso ? `（${deviceEquivalent(dueIso, { timeZone, deviceZone, at })}）` : ''}`
    : null;
  const presets = duePresets({ at, timeZone, startDate: trip.start_date });
  const byline = mode === 'edit' && row?.done ? doneByline(row, { memberName: (u) => store.memberName(u), meId, at, timeZone }) : null;
  const linkSummary = linkSummaryText(form, {
    days: store.tables.days.value, bookings: store.tables.bookings.value, items: store.tables.items.value, dayNumber: (d) => store.dayNumber(d),
  });
  const meta0 = LISTS[form.list] || LISTS.todo;

  const onTitleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      api.current?.submit?.();
    }
  };

  const remove = () => {
    try {
      store.remove('todos', row.id);
      haptic('warning');
      closeOverlay('todo', { force: true });
    } catch (e) {
      toast.error(e?.message || '没有删掉，请再试一次');
    }
  };

  return (
    <form class="tdf" onSubmit={(e) => { e.preventDefault(); api.current?.submit?.(); }} data-testid="todo-form" data-mode={mode} data-readonly={readOnly ? '' : undefined}>
      {readOnly && (
        <p class="tdf-note" data-testid="todo-readonly">
          <Glyph name="info" size={16} stroke={2} />
          <span>你是只读成员：只能看，不能修改。</span>
        </p>
      )}
      {deleted && (
        <p class="tdf-note tdf-note--warning" role="alert">
          <Glyph name="alert" size={16} stroke={2} />
          <span>这一项刚被删除了，改动保存不了。</span>
        </p>
      )}
      <fieldset class="tdf-set" disabled={readOnly}>
        <legend class="visually-hidden">{sheetTitle(form.list, mode)}</legend>

        <SegmentedControl
          label="放在哪个清单"
          value={form.list}
          disabled={readOnly}
          onChange={(l) => patch({ list: l, qty: form.qty === null && l === 'packing' ? 1 : form.qty })}
          options={LIST_IDS.map((l) => ({ value: l, label: LISTS[l].label }))}
          data-testid="todo-list"
        />

        <div class="tdf-box" ref={titleBoxRef} data-error={error ? '' : undefined}>
          <textarea
            ref={titleRef}
            class="tdf-title"
            rows={1}
            value={form.title}
            placeholder={meta0.titlePlaceholder}
            aria-label="标题"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'todo-title-error' : undefined}
            maxLength={200}
            enterKeyHint={mode === 'edit' ? 'done' : 'send'}
            data-autofocus={mode === 'new' ? '' : undefined}
            onInput={(e) => {
              grow(e.currentTarget);
              patch({ title: e.currentTarget.value.replace(/\n/g, ' ') });
            }}
            onKeyDown={onTitleKey}
            data-testid="todo-title"
          />
          <textarea
            class="tdf-noteinput"
            rows={2}
            value={form.note}
            placeholder="备注（可选）：要带什么、找谁、注意什么"
            aria-label="备注"
            maxLength={1000}
            onInput={(e) => {
              grow(e.currentTarget);
              patch({ note: e.currentTarget.value });
            }}
            ref={noteRef}
            data-testid="todo-note"
          />
        </div>
        {error && <p class="tdf-error" id="todo-title-error" role="alert">{error}</p>}
        {/* 备注里的电话 / 邮箱 / 网址：这里也能直接打、直接开（从概览、预订详情打开这个面板看详情时一样顺手；只读成员也能点） */}
        <NoteActions note={form.note} title={form.title} class="tdf-acts" testId="todo-note-actions" />

        {form.list === 'packing' && (
          <Field label="分类" wide testId="todo-category">
            <div class="tdf-chips">
              {categories.map((c) => (
                <Chip
                  key={c}
                  size="sm"
                  selected={shownCategory === c}
                  onToggle={(on) => {
                    setCategoryTouched(true);
                    setCustomOpen(false);
                    patch({ category: on ? c : '' });
                  }}
                >
                  {c}
                </Chip>
              ))}
              {!customOpen ? (
                <Chip size="sm" onClick={() => setCustomOpen(true)}>＋ 自定义</Chip>
              ) : (
                <input
                  class="tdf-custom"
                  type="text"
                  maxLength={CATEGORY_MAX}
                  placeholder="新分类"
                  aria-label="新分类的名字"
                  value={categories.includes(form.category) ? '' : form.category}
                  onInput={(e) => {
                    setCategoryTouched(true);
                    patch({ category: e.currentTarget.value });
                  }}
                  ref={customRef}
                />
              )}
            </div>
            {guessed && !categoryTouched && <p class="tdf-hint">按名字猜的是「{guessed}」，点别的可以改</p>}
          </Field>
        )}

        {showQty && (
          <Field label="数量" testId="todo-qty">
            <Stepper
              value={form.qty ?? 0}
              onChange={(v) => patch({ qty: v === 0 && initial.qty === null ? null : v })}
              min={0}
              max={999}
              unit={unit || undefined}
              addLabel="加数量"
              label="数量"
              disabled={readOnly}
            />
          </Field>
        )}

        {options.length > 1 && (
          <Field label={form.list === 'packing' ? '谁的东西' : '谁负责'} wide testId="todo-assignee">
            <SegmentedControl
              label={form.list === 'packing' ? '谁的东西' : '谁负责'}
              value={form.assignee || 'shared'}
              disabled={readOnly}
              onChange={(v) => patch({ assignee: v === 'shared' ? '' : v })}
              options={options.map((o) => ({
                value: o.value,
                label: o.value === 'shared' ? (form.list === 'packing' ? '共用' : '不指定') : o.label,
                ariaLabel: o.value === meId ? `${o.label}（我）` : undefined,
              }))}
            />
          </Field>
        )}

        <Field label="截止时间" wide testId="todo-due">
          {dueOpen || form.dueDate ? (
            <div class="tdf-due">
              <div class="tdf-due__inputs">
                <input
                  class="tdf-input"
                  type="date"
                  value={form.dueDate}
                  aria-label="截止日期"
                  onInput={(e) => patch({ dueDate: e.currentTarget.value, dueTime: form.dueTime || (e.currentTarget.value ? '21:00' : '') })}
                  onClick={openPicker}
                  data-testid="todo-due-date"
                />
                <input
                  class="tdf-input tdf-input--time"
                  type="time"
                  value={form.dueTime}
                  aria-label="截止钟点"
                  onInput={(e) => patch({ dueTime: e.currentTarget.value })}
                  onClick={openPicker}
                  data-testid="todo-due-time"
                />
                <button
                  type="button"
                  class="tdf-clear"
                  data-press="scale"
                  aria-label="不要截止时间"
                  onClick={() => {
                    patch({ dueDate: '', dueTime: '' });
                    setDueOpen(false);
                  }}
                >
                  <Glyph name="x" size={16} stroke={2.2} />
                </button>
              </div>
              <p class={`tdf-hint${due && due.tone !== 'neutral' ? ` tdf-hint--${due.tone}` : ''}`} data-testid="todo-due-hint">
                {due ? due.parts.map((t, i) => (
                  <Fragment key={i}>
                    {i > 0 && '\u00a0· '}
                    <span class="tdf-nowrap">{t}</span>
                  </Fragment>
                )) : '选一个日期'}
              </p>
              {zoneHint && <p class="tdf-hint tdf-hint--zone" data-testid="todo-due-zone">{zoneHint}</p>}
            </div>
          ) : (
            <div class="tdf-chips">
              {presets.map((p) => (
                <Chip key={p.key} size="sm" onClick={() => { const d = dueParts(p.value, timeZone); patch({ dueDate: d.date, dueTime: d.time }); setDueOpen(true); }}>
                  {p.label}
                </Chip>
              ))}
              <Chip size="sm" onClick={() => setDueOpen(true)}>选日期…</Chip>
            </div>
          )}
        </Field>

      </fieldset>

      {/* 关联（哪天 / 预订 / 条目）：平时收起成一行摘要（新建时表单短一截，键盘弹起时也看得到要紧的字段），
          点开原地展开（交互 7）；只读成员也能展开看、能点「看预订」「去看看」，只是改不了 */}
      <ExpandableCard
        variant="card"
        keepInPlace={false}
        class="tdf-links"
        title="关联"
        subtitle={linkSummary}
        open={linksOpen}
        onOpenChange={setLinksOpen}
        data-testid="todo-links"
      >
        <div class="tdf-links__body">
          {days.length > 0 && (
            <Field label="哪天" wide>
              <div class="tdf-chips tdf-chips--scroll">
                <Chip size="sm" selected={!form.day} disabled={readOnly} onToggle={() => patch({ day: '' })}>不关联</Chip>
                {days.map((d) => {
                  const n = store.dayNumber(d.date);
                  return (
                    <Chip key={d.id} size="sm" selected={form.day === d.id} disabled={readOnly} onToggle={(on) => patch({ day: on ? d.id : '' })}>
                      {n ? `D${n}` : formatDate(d.date, { timeZone, weekday: false })}
                      <span class="tdf-chipsub">{formatDate(d.date, { timeZone, weekday: false, year: 'never' })}</span>
                    </Chip>
                  );
                })}
              </div>
            </Field>
          )}
          {bookings.length > 0 && (
            <Field label="预订" wide>
              <div class="tdf-pick">
                <span class="tdf-select">
                  <select value={form.booking} disabled={readOnly} onChange={(e) => patch({ booking: e.currentTarget.value })} aria-label="关联的预订" data-testid="todo-booking">
                    <option value="">不关联</option>
                    {bookings.map((b) => (
                      <option key={b.id} value={b.id}>{`${kindLabel('booking', b.kind)} · ${b.title}`}</option>
                    ))}
                  </select>
                  <Glyph name="chev-d" size={14} stroke={2.2} />
                </span>
                {form.booking && (
                  <button type="button" class="tdf-open" data-press="scale" onClick={(e) => openBookingSheet(form.booking, { trigger: e.currentTarget })} aria-label="打开预订详情">
                    <KindIcon type="booking" kind={store.tables.bookings.value.get(form.booking)?.kind} size={16} />
                    看预订
                  </button>
                )}
              </div>
            </Field>
          )}
          {itemsByDay.size > 0 && (
            <Field label="条目" wide>
              <div class="tdf-pick">
                <span class="tdf-select">
                  <select
                    value={form.item}
                    disabled={readOnly}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      const it = v ? store.tables.items.value.get(v) : null;
                      patch({ item: v, day: it?.day_id || form.day });
                    }}
                    aria-label="关联的行程条目"
                    data-testid="todo-item"
                  >
                    <option value="">不关联</option>
                    {[...days, null].map((d) => {
                      const items = (itemsByDay.get(d ? d.id : null) || []).filter((it) => !it.deleted_at);
                      if (!items.length) return null;
                      const n = d ? store.dayNumber(d.date) : null;
                      const label = d ? `${n ? `D${n} · ` : ''}${formatDate(d.date, { timeZone })}` : '备选池';
                      return (
                        <optgroup key={d ? d.id : 'pool'} label={label}>
                          {items.map((it) => {
                            const t = formatItemTime(it).main;
                            const pre = it.variant === 'rain' ? '雨天：' : it.variant === 'backup' ? '备选：' : '';
                            return <option key={it.id} value={it.id}>{`${t ? `${t} ` : ''}${pre}${it.title}`}</option>;
                          })}
                        </optgroup>
                      );
                    })}
                  </select>
                  <Glyph name="chev-d" size={14} stroke={2.2} />
                </span>
                {form.item && (() => {
                  const it = store.tables.items.value.get(form.item);
                  const day = it?.day_id ? store.tables.days.value.get(it.day_id) : null;
                  const to = day ? { name: 'day', params: { tripId, date: day.date }, query: { item: it.id } } : { name: 'trip', params: { tripId }, query: { item: form.item } };
                  return (
                    <a class="tdf-open" data-press="scale" href={href(to)} aria-label="去看这个条目">
                      <KindIcon type="item" kind={it?.kind} size={16} />
                      去看看
                    </a>
                  );
                })()}
              </div>
            </Field>
          )}
          {!days.length && !bookings.length && !itemsByDay.size && <p class="tdf-hint">这趟行程还没有天数、预订和条目，暂时没什么可关联的。</p>}
        </div>
      </ExpandableCard>

      {mode === 'edit' && (
        <div class="tdf-done">
          <Checkbox
            checked={form.done}
            onChange={(v) => {
              haptic(v ? 'success' : 'light');
              patch({ done: v });
            }}
            label={LISTS[form.list]?.doneSection || '已完成'}
            description={form.done === Boolean(row?.done) ? byline : form.done ? '保存后算完成' : '保存后算没完成'}
            strike={false}
            disabled={readOnly}
            data-testid="todo-done"
          />
        </div>
      )}

      {mode === 'edit' && canEdit && !deleted && (
        <Button variant="danger-soft" block leading={<Glyph name="trash" size={18} />} onClick={remove} data-testid="todo-delete" class="tdf-delete">
          删除这一项
        </Button>
      )}
    </form>
  );
}
