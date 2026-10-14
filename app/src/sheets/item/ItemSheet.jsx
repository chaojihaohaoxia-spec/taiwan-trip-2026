// =====================================================================
// sheets/item/ItemSheet.jsx：弹层「item」——新增 / 编辑时间轴条目（SPEC §9.2，每天页负责）。
//
//   openItemSheet({ date, after, parent, variant, kind })   加条目（预填哪天、插在哪一条后面、挂在哪个主方案下）
//   openItemSheet(item.id)                                  编辑条目
//
// 表单：标题、类型（一排可横滑的种类胶囊）、时间（开始 / 结束用系统的时间选择器，模糊时间有快捷词）、
//   地点（从这趟行程的地点里搜着选，或直接新建一个只有名字的地点——保存时一起写进 places）、说明、
//   方案（主 / 备选 / 雨天；备选可以挂到那一天的某条主方案下）、哪天（含备选池）。
// 保存：ui/SubmitButton（文字 → 转圈 → 对勾，失败摇头 + 中文原因），成功后面板收回；新建的条目按钟点插进那一天
//   （排序值的算法在 pages/day/model.js）。删除走数据层的软删除，外壳自动弹「已删除 · 撤销」。
// 填了一半关掉会先问“放弃未保存的内容？”（Sheet 的 confirmClose）。只读成员：表单禁用并说明。
// 纯逻辑（初始值、校验、改动字段、排序值、选项、搜地点）在 form-model.js；参数读法见 sheets/README.md。
// =====================================================================

import './item.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, confirm, toast, useOverlay, DISCARD_TEXTS } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Button } from '../../ui/Button.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { KindIcon, Glyph, kindLabel } from '../../kit/index.js';
import { haptic } from '../../lib/native.js';
import { navigate, route } from '../../router/index.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { lastSavedItem } from './saved.js';
import {
  POOL, KIND_OPTIONS, VARIANT_OPTIONS, TIME_LABEL_PRESETS, initialForm, validateForm, toRow, formPatch, resolveSortKey,
  dayOptions, parentOptions, filterPlaces, sameForm,
} from './form-model.js';

/** 表单的一格：标签 + 控件 */
function Field({ label, hint, children, class: cls, testId }) {
  return (
    <div class={['item-field', cls].filter(Boolean).join(' ')} data-testid={testId}>
      <span class="item-field__label">{label}</span>
      {children}
      {hint && <span class="item-field__hint">{hint}</span>}
    </div>
  );
}

/** 自动长高的多行输入 */
function AutoTextarea({ value, onInput, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(240, el.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={ref} class="item-input item-input--area" rows={2} value={value} onInput={onInput} {...rest} />;
}

/** 选地点：当前的地点一行；展开后搜索 + 候选 + 新建 */
function PlacePicker({ form, setForm, places, readOnly }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = form.place_id ? places.find((p) => p.id === form.place_id) || null : null;
  const results = useMemo(() => filterPlaces(places, q, 8), [places, q]);
  const trimmed = q.trim();
  const exact = trimmed && results.some((r) => r.place.name === trimmed);

  const pick = (p) => {
    haptic('selection');
    setForm((f) => ({ ...f, place_id: p.id, newPlace: '' }));
    setOpen(false);
    setQ('');
  };
  const create = () => {
    haptic('selection');
    setForm((f) => ({ ...f, place_id: null, newPlace: trimmed }));
    setOpen(false);
    setQ('');
  };
  const clear = () => {
    setForm((f) => ({ ...f, place_id: null, newPlace: '' }));
  };

  const label = current ? current.name : form.newPlace ? `${form.newPlace}（新地点）` : '还没选地点';
  return (
    <div class="item-place" data-testid="item-place">
      <div class="item-place__row">
        <button
          type="button"
          class={['item-place__current', 'material-inset', !(current || form.newPlace) && 'item-place__current--empty'].filter(Boolean).join(' ')}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open ? 'true' : 'false'}
          disabled={readOnly}
          data-press="highlight"
          data-testid="item-place-toggle"
        >
          {current ? <KindIcon type="place" kind={current.kind} tile="xs" /> : <span class="item-place__icon" aria-hidden="true"><Glyph name="pin" size={16} /></span>}
          <span class="item-place__name">{label}</span>
          <Glyph name={open ? 'chev-u' : 'chev-d'} size={16} stroke={2.2} class="item-place__chev" />
        </button>
        {(current || form.newPlace) && !readOnly && (
          <button type="button" class="item-place__clear" onClick={clear} aria-label="清除地点" data-press="scale" data-testid="item-place-clear">
            <Glyph name="x" size={16} stroke={2.2} />
          </button>
        )}
      </div>
      {open && !readOnly && (
        <div class="item-place__panel" data-testid="item-place-panel">
          <input
            class="item-input"
            type="search"
            value={q}
            placeholder="搜地点名、地址，或输入新地点的名字"
            onInput={(e) => setQ(e.currentTarget.value)}
            autocomplete="off"
            enterKeyHint="search"
            data-testid="item-place-search"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                if (results.length) pick(results[0].place);
                else if (trimmed) create();
              }
            }}
          />
          <ul class="item-place__list" role="listbox" aria-label="地点">
            {results.map(({ place }) => (
              <li key={place.id}>
                <button type="button" class="item-place__opt" role="option" aria-selected={place.id === form.place_id ? 'true' : 'false'} onClick={() => pick(place)} data-press="highlight" data-testid={`item-place-opt-${place.id}`}>
                  <KindIcon type="place" kind={place.kind} tile="xs" />
                  <span class="item-place__opt-text">
                    <b>{place.name}</b>
                    {(place.name_local || place.address) && <span>{[place.name_local, place.address].filter(Boolean).join(' · ')}</span>}
                  </span>
                </button>
              </li>
            ))}
            {trimmed && !exact && (
              <li>
                <button type="button" class="item-place__opt item-place__opt--new" role="option" aria-selected="false" onClick={create} data-press="highlight" data-testid="item-place-new">
                  <span class="item-place__icon item-place__icon--new" aria-hidden="true"><Glyph name="plus" size={16} stroke={2.2} /></span>
                  <span class="item-place__opt-text"><b>新建地点「{trimmed}」</b><span>只记名字，坐标和地址以后在地点页补</span></span>
                </button>
              </li>
            )}
            {!results.length && !trimmed && <li class="item-place__empty">这趟行程还没有地点：输入名字新建一个</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Form({ api, onMeta }) {
  const ov = useOverlay();
  const { mode, id, fields } = useSheetArgs();
  const { tripId, store, pending } = useSheetTrip();
  const r = route.value;
  const pageDate = r?.name === 'day' ? r.params?.date || null : null;
  const item = mode === 'edit' && store ? store.tables.items.value.get(id) || null : null;
  const days = store ? store.view.days.value : [];
  const places = store ? store.view.places.value : [];
  const plans = store ? store.view.plans.value : null;
  const canEdit = store ? Boolean(store.view.canEdit.value) : false;
  const timeZone = store?.trip.value?.timezone;
  const ready = Boolean(store) && store.status.value !== 'loading' && store.status.value !== 'idle';

  const initial = useMemo(() => initialForm({ mode, item, fields, defaultDate: pageDate, days }), [mode, id, ready]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.currentTarget.value }));
  // 数据到了以后（编辑那一行刚读出来）重新算初始值
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const dirty = !sameForm(initial, form);
  const targetPrimary = form.day !== POOL && plans ? plans.get(form.day)?.primary || [] : [];
  const parents = useMemo(() => parentOptions(targetPrimary, item?.id || null), [targetPrimary, item?.id]);
  const dayOpts = useMemo(() => dayOptions(days, { timeZone }), [days, timeZone]);
  const missingEdit = mode === 'edit' && ready && !item;

  const submit = async () => {
    setError('');
    const problem = validateForm(form);
    if (problem) throw new Error(problem);
    if (!store) throw new Error('行程还没读出来');
    let placeId = form.place_id;
    const saved = [];
    if (!placeId && form.newPlace.trim()) {
      const p = store.insert('places', { name: form.newPlace.trim(), kind: 'other' });
      placeId = p.row.id;
      saved.push(p.saved);
    }
    const next = { ...form, place_id: placeId };
    const afterId = mode === 'new' ? fields.after || null : null;
    const sortKey = resolveSortKey({ form: next, item, primary: targetPrimary, afterId });
    let rowId;
    if (item) {
      // 只提交这次在面板里改了的字段：和“打开面板那一刻”的样子（initial）比，不和现在的行比——
      // 面板开着时另一台手机改了别的字段（补了说明、改了时间），这边保存不会把它改回去（代码评审 P1-1）
      const patch = formPatch(initial, next);
      if (sortKey !== undefined) patch.sort_key = sortKey;
      const res = store.update('items', item.id, patch);
      saved.push(res.saved);
      rowId = item.id;
      // 主方案换了一天：挂在它下面的备选 / 雨天方案跟着搬过去（不然留在原来那天，变成“当天通用备选”，代码评审 P2-1）
      if ('day_id' in patch && (item.variant || 'primary') === 'primary' && patch.day_id) {
        for (const child of store.tables.items.value.values()) {
          if (child.parent_item_id !== item.id || child.deleted_at || child.day_id === patch.day_id) continue;
          saved.push(store.update('items', child.id, { day_id: patch.day_id }).saved);
        }
      }
    } else {
      const row = toRow(next);
      if (sortKey !== undefined) row.sort_key = sortKey;
      const res = store.insert('items', row);
      saved.push(res.saved);
      rowId = res.row.id;
    }
    await Promise.all(saved);
    haptic('success');
    const dayId = next.day === POOL ? null : next.day;
    lastSavedItem.value = { id: rowId, mode: item ? 'edit' : 'new', at: Date.now(), tripId, dayId };
    return { id: rowId, dayId };
  };

  const done = (result) => {
    closeOverlay('item', { force: true });
    const title = form.title.trim();
    const day = result?.dayId ? days.find((d) => d.id === result.dayId) : null;
    const onThisPage = Boolean(day) && pageDate === day.date;
    // 那一天是不是行程里的“今天”（出发前在 D3 页加一条，不能说「已加到今天的时间轴」，代码评审 P2-3）
    const isToday = Boolean(day) && store?.view.today.value?.day?.id === day.id;
    const dayName = day ? (isToday ? '今天' : ` D${days.indexOf(day) + 1} `) : '';
    if (mode === 'edit') {
      toast.success(`已保存「${title}」`);
    } else if (onThisPage || !day) {
      toast.success(day ? `已加到${dayName}的时间轴：「${title}」` : `已放进备选池：「${title}」`);
    } else {
      toast({
        message: `已加到 D${days.indexOf(day) + 1}：「${title}」`,
        tone: 'success',
        action: { label: '去看看', onClick: () => navigate({ name: 'day', params: { tripId, date: day.date }, query: { item: result.id } }) },
      });
    }
  };

  const remove = async () => {
    if (!item || !store) return;
    await closeOverlay('item', { force: true });
    try {
      store.softDelete('items', item.id);
    } catch (e) {
      toast.error(e?.message || '没有删掉');
    }
  };

  // 底部的提交按钮在面板外面（Sheet 的 footer）：把“能不能提交 / 是新建还是编辑”告诉它
  const submittable = ready && !missingEdit && canEdit;
  useEffect(() => {
    onMeta?.({ ready: submittable, editing: mode === 'edit' });
  }, [submittable, mode]);

  const resultRef = useRef(null);
  api.current = {
    submit: async () => {
      resultRef.current = await submit();
    },
    onSuccess: () => done(resultRef.current),
    onError: (e) => setError(e?.message || '没有保存上，请重试'),
    dirty: () => dirty,
    ready: ready && !missingEdit && canEdit,
    mode,
  };

  if (!store || pending || !ready) {
    return (
      <div class="item-form item-form--pending" aria-busy="true" data-testid="item-form-pending">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={52} radius="sm" />
        <Skeleton variant="rect" height={44} radius="pill" />
        <Skeleton variant="rect" height={52} radius="sm" />
      </div>
    );
  }
  if (missingEdit) {
    return (
      <div class="item-form" data-testid="item-form-missing">
        <p class="item-form__note">找不到要编辑的条目（可能刚被删除）。</p>
        <Button variant="secondary" block onClick={() => ov?.close()}>知道了</Button>
      </div>
    );
  }
  const readOnly = !canEdit;

  return (
    <form class="item-form" onSubmit={(e) => e.preventDefault()} data-testid="item-form" data-mode={mode}>
      {readOnly && <p class="item-form__note item-form__note--warn" data-testid="item-readonly"><Glyph name="info" size={15} /><span>只读成员不能加 / 改条目，这里只能看。</span></p>}

      <Field label="标题" testId="item-field-title">
        <input
          class="item-input item-input--title"
          type="text"
          value={form.title}
          onInput={set('title')}
          placeholder="例如：清晨粉店吃粉"
          maxLength={200}
          autocomplete="off"
          enterKeyHint="next"
          disabled={readOnly}
          data-autofocus={mode === 'new' ? '' : undefined}
          data-testid="item-title"
        />
      </Field>

      <Field label="类型" testId="item-field-kind">
        <div class="item-kinds" role="radiogroup" aria-label="类型" data-testid="item-kinds">
          {KIND_OPTIONS.map((k) => (
            <Chip
              key={k.value}
              size="sm"
              selected={form.kind === k.value}
              onToggle={() => { haptic('selection'); setForm((f) => ({ ...f, kind: k.value })); }}
              disabled={readOnly}
              role="radio"
              aria-checked={form.kind === k.value ? 'true' : 'false'}
              data-kind={k.value}
            >
              <KindIcon type="item" kind={k.value} size={15} />
              {k.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="时间" hint={form.end_time && form.start_time && form.end_time < form.start_time ? '结束比开始早：按跨过午夜算（次日）' : undefined} testId="item-field-time">
        <div class="item-times">
          <label class="item-time">
            <span>开始</span>
            <input class="item-input t-label" type="time" value={form.start_time} onInput={set('start_time')} disabled={readOnly} data-testid="item-start" />
          </label>
          <span class="item-times__dash" aria-hidden="true">–</span>
          <label class="item-time">
            <span>结束</span>
            <input class="item-input t-label" type="time" value={form.end_time} onInput={set('end_time')} disabled={readOnly || !form.start_time} data-testid="item-end" />
          </label>
        </div>
        <div class="item-labels" aria-label="模糊时间">
          <input
            class="item-input item-input--label"
            type="text"
            value={form.time_label}
            onInput={set('time_label')}
            placeholder="模糊时间（上午 / 午饭后 / 日落前）"
            autocomplete="off"
            disabled={readOnly}
            data-testid="item-time-label"
          />
          <div class="item-labels__chips">
            {TIME_LABEL_PRESETS.map((t) => (
              <Chip key={t} size="sm" selected={form.time_label === t} onToggle={(on) => setForm((f) => ({ ...f, time_label: on ? t : '' }))} disabled={readOnly}>{t}</Chip>
            ))}
          </div>
        </div>
      </Field>

      <Field label="地点" testId="item-field-place">
        <PlacePicker form={form} setForm={setForm} places={places} readOnly={readOnly} />
      </Field>

      <Field label="说明" testId="item-field-desc">
        <AutoTextarea value={form.description} onInput={set('description')} placeholder="怎么玩、注意什么、点什么菜…" disabled={readOnly} data-testid="item-desc" />
      </Field>

      <Field label="方案" testId="item-field-variant">
        <SegmentedControl
          label="方案"
          size="sm"
          value={form.variant}
          options={VARIANT_OPTIONS}
          disabled={readOnly}
          onChange={(v) => { haptic('selection'); setForm((f) => ({ ...f, variant: v, parent_item_id: v === 'primary' ? null : f.parent_item_id })); }}
        />
        {form.variant !== 'primary' && form.day !== POOL && (
          <label class="item-select">
            <span class="item-select__label">挂在哪条主方案下</span>
            <span class="item-select__box material-inset">
              <select class="item-select__el" value={form.parent_item_id || ''} onChange={(e) => setForm((f) => ({ ...f, parent_item_id: e.currentTarget.value || null }))} disabled={readOnly} data-testid="item-parent">
                {parents.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Glyph name="chev-d" size={16} stroke={2.2} class="item-select__chev" />
            </span>
          </label>
        )}
      </Field>

      <Field label="哪天" testId="item-field-day">
        <label class="item-select">
          <span class="item-select__box material-inset">
            <select class="item-select__el" value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: e.currentTarget.value, parent_item_id: null }))} disabled={readOnly} data-testid="item-day">
              {dayOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Glyph name="chev-d" size={16} stroke={2.2} class="item-select__chev" />
          </span>
        </label>
      </Field>

      {error && <p class="item-form__error" role="alert" data-testid="item-error">{error}</p>}

      {mode === 'edit' && item && canEdit && (
        <div class="item-form__danger">
          <Button variant="danger-soft" block leading={() => <Glyph name="trash" size={20} />} onClick={remove} data-testid="item-delete">删除这条（可以撤销）</Button>
        </div>
      )}
    </form>
  );
}

export default function ItemSheet() {
  const api = useRef({ submit: async () => {}, onSuccess: () => {}, onError: () => {}, dirty: () => false, ready: false, mode: 'new' });
  const [meta, setMeta] = useState({ ready: false, editing: false });
  // 面板的标题要跟着 mode 变：表单还没挂上时先看网址里的参数（一个 id = 编辑）
  const sheet = route.value?.sheets?.find((s) => s.id === 'item');
  const editing = meta.editing || Boolean(sheet?.arg && !String(sheet.arg).includes('.'));
  return (
    <Sheet
      sheetId="item"
      title={editing ? '编辑条目' : '加条目'}
      detents={['content', 'large']}
      // 函数形式的 confirmClose：返回 true = 可以关；填了一半就先问“放弃未保存的内容？”
      confirmClose={() => (api.current.dirty() ? confirm({ ...DISCARD_TEXTS, destructive: true }) : true)}
      testId="sheet-item"
      footer={(
        <SubmitButton
          block
          label={editing ? '保存' : '加进去'}
          action={() => api.current.submit()}
          onSuccess={() => api.current.onSuccess()}
          onError={(e) => api.current.onError(e)}
          resetAfter={false}
          disabled={!meta.ready}
          data-testid="item-submit"
        />
      )}
    >
      <Form api={api} onMeta={setMeta} />
    </Sheet>
  );
}
