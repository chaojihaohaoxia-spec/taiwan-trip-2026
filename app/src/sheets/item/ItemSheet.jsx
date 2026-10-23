// =====================================================================
// sheets/item/ItemSheet.jsx：弹层「item」——加一项 / 改一项（时间轴上的条目，SPEC §9.2，每天页负责）。
//
//   openItemSheet({ date, after, parent, variant, kind })   加一项（预填哪天、插在哪一条后面、挂在哪个主方案下）
//   openItemSheet(item.id)                                  改一项
//
// 两层（10-19 加条目改版，对齐小程序 1.4.3 的「加一项」；默认值的规则在 form-model.js）：
//   上面一层，一屏放得下：「做什么 / 备注」同一块（自动聚焦，回车 = 加进去）→ 哪天（一排字签，今天写「今天」）
//     → 几点（今天默认现在；空着写「不定」）→ 在哪（空着时这一天用到的地点、当晚住的排在前面）
//     → 怎么去（选了地点才有：自动 · 走路 · 打车 · 地铁公交 · 自驾 · 骑车 · 有人接 · 更多；下面一行灰字说现在会给哪几个按钮、为什么，
//       芯片和写法在 rules/how.js，和每天页的「改」同一排 pages/day/HowRow.jsx）
//     → 做完了（加的时候；今天、几点不晚于现在 5 分钟默认打开）/ 状态（改的时候：计划中 · 做完了 · 跳过了）
//   「更多设置」默认收起（收起时写一行摘要）：类型（选了地点按地点给，不用人选）、模糊时间、方案（主 / 备选 / 雨天，备选可挂到某条主方案下）。
//     网址带了方案 / 挂在谁下 / 类型时展开。
// 保存：ui/SubmitButton（受控：文字 → 转圈 → 对勾，失败摇头 + 中文原因），成功后面板收回；新的一条按钟点插进那一天
//   （今天又没写钟点：插在「现在」那一条后面），原地淡入、亮一下（每天页读 saved.js 的 lastSavedItem）；提示条带「撤销」。
//   删除走数据层的软删除，外壳自动弹「已删除 · 撤销」。
// 填了一半关掉会先问“放弃未保存的内容？”（Sheet 的 confirmClose）。只读成员：表单禁用并说明。
// 纯逻辑（初始值、默认值、校验、改动字段、排序值、选项、搜地点）在 form-model.js；参数读法见 sheets/README.md。
// =====================================================================

import './item.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, confirm, toast, dismissToastKey, useOverlay, DISCARD_TEXTS } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Button } from '../../ui/Button.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { KindIcon, Glyph } from '../../kit/index.js';
import { haptic } from '../../lib/native.js';
import { now as clockNow } from '../../lib/clock.js';
import { formatTime } from '../../lib/datetime.js';
import { route } from '../../router/index.js';
import { defaultActualTime, minutesIntoDay, nowOnTimeline } from '../../pages/day/model.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { lastSavedItem } from './saved.js';
import { TransportChips } from '../../pages/day/HowRow.jsx';
import { howPreview } from '../../pages/day/how-model.js';
import { itemHow } from '../../data/dest.js';
import { transportPatch } from '../../rules/how.js';
import {
  POOL, KIND_OPTIONS, VARIANT_OPTIONS, STATUS_OPTIONS, TIME_LABEL_PRESETS, initialForm, validateForm, toRow, formPatch, resolveSortKey,
  dayChips, parentOptions, filterPlaces, dayPlaceIds, sameForm, autoDone, nowAnchor, kindForPlace, moreSummary, shortTitle, actualTimeFor,
} from './form-model.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 上面一层的一行：左边小字标签，右边控件；行间一根细线 */
function Row({ label, children, class: cls, testId, labelFor }) {
  const Label = labelFor ? 'label' : 'span';
  return (
    <div class={['item-row', cls].filter(Boolean).join(' ')} data-testid={testId}>
      <Label class="item-row__label" for={labelFor}>{label}</Label>
      <div class="item-row__ctl">{children}</div>
    </div>
  );
}

/** 「更多设置」里的一格：标签 + 控件 */
function Field({ label, hint, children, testId }) {
  return (
    <div class="item-field" data-testid={testId}>
      <span class="item-field__label">{label}</span>
      {children}
      {hint && <span class="item-field__hint">{hint}</span>}
    </div>
  );
}

/** 自动长高的多行输入 */
function AutoTextarea({ value, onInput, class: cls, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={ref} class={cls} rows={1} value={value} onInput={onInput} {...rest} />;
}

/**
 * 钟点：看到的是自己写的「21:40」（24 小时制，不跟系统的「09:40 PM」）；上面盖一层透明的系统时间框，
 * 手指点到的就是它——iPhone 一下就弹出滚轮；桌面浏览器点了叫出选择器（showPicker），也能直接键盘输入。空着写「不定」。
 */
function TimeInput({ value, onInput, disabled, label, testId, empty = '不定' }) {
  const ref = useRef(null);
  const open = () => {
    try {
      ref.current?.showPicker?.();
    } catch {
      // 不支持 / 不是用户点的：系统自己处理
    }
  };
  return (
    <span class="item-time" data-empty={value ? undefined : ''} data-disabled={disabled ? '' : undefined}>
      <span class="item-time__face t-label" aria-hidden="true">{value ? formatTime(value) : empty}</span>
      <input ref={ref} class="item-time__input" type="time" value={value} onInput={onInput} onClick={open} disabled={disabled} aria-label={label} data-testid={testId} />
    </span>
  );
}

/** 选地点：当前的地点一行（空着灰字「选个地方」）；展开后搜索 + 候选 + 新建 */
function PlacePicker({ form, onPick, places, first, readOnly }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = form.place_id ? places.find((p) => p.id === form.place_id) || null : null;
  const results = useMemo(() => filterPlaces(places, q, 8, { first }), [places, q, first]);
  const trimmed = q.trim();
  const exact = trimmed && results.some((r) => r.place.name === trimmed);
  const searchRef = useRef(null);
  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  const pick = (p) => {
    haptic('selection');
    onPick({ place_id: p.id, newPlace: '' }, p);
    setOpen(false);
    setQ('');
  };
  const create = () => {
    haptic('selection');
    onPick({ place_id: null, newPlace: trimmed }, null);
    setOpen(false);
    setQ('');
  };
  const clear = () => onPick({ place_id: null, newPlace: '' }, null);

  const label = current ? current.name : form.newPlace ? `${form.newPlace}（新地点）` : '选个地方';
  const has = Boolean(current || form.newPlace);
  return (
    <div class="item-place" data-testid="item-place">
      <div class="item-place__row">
        <button
          type="button"
          class={['item-place__current', !has && 'item-place__current--empty'].filter(Boolean).join(' ')}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open ? 'true' : 'false'}
          aria-label={`在哪：${current || form.newPlace ? label : '还没选'}`}
          disabled={readOnly}
          data-press="highlight"
          data-testid="item-place-toggle"
        >
          {current && <KindIcon type="place" kind={current.kind} size={16} />}
          <span class="item-place__name">{label}</span>
          <Glyph name={open ? 'chev-u' : 'chev-r'} size={16} stroke={2.2} class="item-place__chev" />
        </button>
        {has && !readOnly && (
          <button type="button" class="item-place__clear" onClick={clear} aria-label="不写地点" data-press="scale" data-testid="item-place-clear">
            <Glyph name="x" size={16} stroke={2.2} />
          </button>
        )}
      </div>
      {open && !readOnly && (
        <div class="item-place__panel" data-testid="item-place-panel">
          <input
            ref={searchRef}
            class="item-input"
            type="search"
            value={q}
            placeholder="搜地点，或写个新地名"
            onInput={(e) => setQ(e.currentTarget.value)}
            autocomplete="off"
            enterKeyHint="search"
            data-testid="item-place-search"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                if (results.length && (!trimmed || exact || results[0].score >= 80)) pick(results[0].place);
                else if (trimmed) create();
              }
            }}
          />
          <ul class="item-place__list" role="listbox" aria-label="地点">
            {results.map(({ place, first: near }) => (
              <li key={place.id}>
                <button type="button" class="item-place__opt" role="option" aria-selected={place.id === form.place_id ? 'true' : 'false'} onClick={() => pick(place)} data-press="highlight" data-near={near ? '' : undefined} data-testid={`item-place-opt-${place.id}`}>
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
                  <span class="item-place__opt-text"><b>就写「{trimmed}」</b><span>新地点只记名字，坐标和地址以后在地点页补</span></span>
                </button>
              </li>
            )}
            {!results.length && !trimmed && <li class="item-place__empty">这趟行程还没有地点：写个名字就行</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 行程里的今天、那一天当地的现在几点（给默认值用） */
function nowCtx(store) {
  if (!store) return {};
  const todayDay = store.view.today.value?.day || null;
  const at = clockNow();
  const tz = todayDay ? store.dayTimezone(todayDay) : store.trip.value?.timezone;
  return {
    todayId: todayDay?.id || null,
    today: store.view.phase.value?.today || null,
    nowTime: todayDay ? defaultActualTime(todayDay.date, tz, at) || null : null,
    at,
  };
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

  const ctx = useMemo(() => nowCtx(store), [store, ready]);
  const initial = useMemo(() => initialForm({ mode, item, fields, defaultDate: pageDate, days, ctx }), [mode, id, ready]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  // 人自己动过的（之后不再跟着默认值变）：类型、做完了、几点
  const touched = useRef({ kind: false, status: false, time: false });
  const [moreOpen, setMoreOpen] = useState(() => Boolean(fields.variant || fields.parent || fields.kind));
  // 数据到了以后（编辑那一行刚读出来）重新算初始值
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  /** 改几样字段；加的时候「几点」跟着哪天变（今天 = 现在，别的天空着）、「做完了」跟着哪天 / 几点变，直到人自己动过 */
  const patch = (p) => setForm((f) => {
    const next = { ...f, ...p };
    if (mode === 'new' && !touched.current.time && 'day' in p && !('start_time' in p)) {
      next.start_time = next.day !== POOL && next.day === ctx.todayId && next.variant === 'primary' ? str(ctx.nowTime) : '';
      if (!next.start_time) next.end_time = '';
    }
    if (mode === 'new' && !touched.current.status && ('day' in p || 'start_time' in p || 'variant' in p)) {
      next.status = autoDone(next, ctx) ? 'done' : 'planned';
    }
    return next;
  });
  const set = (k) => (e) => {
    if (k === 'start_time' || k === 'end_time') touched.current.time = true;
    patch({ [k]: e.currentTarget.value });
  };

  const dirty = !sameForm(initial, form);
  const targetPlan = form.day !== POOL && plans ? plans.get(form.day) || null : null;
  const targetPrimary = targetPlan?.primary || [];
  const parents = useMemo(() => parentOptions(targetPrimary, item?.id || null), [targetPrimary, item?.id]);
  const chips = useMemo(() => dayChips(days, ctx.todayId, { timeZone }), [days, ctx.todayId, timeZone]);
  const targetDay = form.day !== POOL ? days.find((d) => d.id === form.day) || null : null;
  const firstPlaces = useMemo(() => {
    if (!targetDay || !store) return [];
    return dayPlaceIds(targetPlan?.all || [], store.stayForDay(targetDay)?.place?.id || null);
  }, [targetDay, targetPlan, store]);
  const missingEdit = mode === 'edit' && ready && !item;
  // 「怎么去」的预览：拿面板里还没保存的地点、天、钟点、怎么去，按规则包算一遍（和每天页一样）
  const howNow = useMemo(() => {
    if (!store || !form.place_id) return null;
    const draft = {
      ...(item || {}), id: item?.id || '__draft', title: form.title, kind: form.kind, variant: form.variant,
      parent_item_id: form.parent_item_id, start_time: form.start_time || null, day_id: form.day === POOL ? null : form.day,
      place_id: form.place_id, transport_in: form.transport_in, status: form.status,
    };
    try {
      return itemHow(store, draft);
    } catch {
      return null;
    }
  }, [store, item, form.place_id, form.day, form.start_time, form.transport_in, form.kind, form.title, form.variant, form.parent_item_id, form.status]);

  // 「哪天」的字签多于一屏：选中的那一个横着滚到中间（只动这一排；不用 scrollIntoView——入场时面板还在屏幕外，它会去滚面板的外框）
  const daysRef = useRef(null);
  useEffect(() => {
    const box = daysRef.current;
    const el = box?.querySelector('[aria-checked="true"]');
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
  }, [ready, chips.length]);

  const onPickPlace = (p, place) => {
    const k = place ? kindForPlace(place) : null;
    // 类型跟着地点走：加的时候人没选过；改的时候原来是「其他」也跟着
    const followKind = !touched.current.kind && (mode === 'new' || (initial.kind || 'other') === 'other');
    patch({ ...p, ...(followKind ? { kind: k || (mode === 'new' ? fields.kind || 'other' : initial.kind) } : {}) });
  };

  const submit = async () => {
    setError('');
    const problem = validateForm(form);
    if (problem) throw new Error(problem);
    if (!store) throw new Error('行程还没读出来');
    let placeId = form.place_id;
    let newPlaceId = null;
    const saved = [];
    if (!placeId && form.newPlace.trim()) {
      const p = store.insert('places', { name: form.newPlace.trim(), kind: 'other' });
      placeId = p.row.id;
      newPlaceId = placeId;
      saved.push(p.saved);
    }
    const next = { ...form, place_id: placeId };
    let afterId = mode === 'new' ? fields.after || null : null;
    let atStart = false;
    // 今天、没写钟点：插在「现在」那一条后面
    if (mode === 'new' && !afterId && !next.start_time && next.day !== POOL && next.day === ctx.todayId && targetDay) {
      const at = clockNow();
      const info = nowOnTimeline(targetPrimary, minutesIntoDay(targetDay.date, store.dayTimezone(targetDay), at));
      const anchor = nowAnchor(targetPrimary, info);
      if (anchor) ({ afterId, atStart } = anchor);
    }
    const sortKey = resolveSortKey({ form: next, item, primary: targetPrimary, afterId, atStart });
    // 「做完了」也写实际时间（和时间轴、概览上的「完成」一样：写了几点用几点，否则那一天当地的现在）
    const actualFallback = targetDay ? defaultActualTime(targetDay.date, store.dayTimezone(targetDay), clockNow()) : '';
    let rowId;
    if (item) {
      // 只提交这次在面板里改了的字段：和“打开面板那一刻”的样子（initial）比，不和现在的行比——
      // 面板开着时另一台手机改了别的字段（补了说明、改了时间），这边保存不会把它改回去（代码评审 P1-1）
      const p = formPatch(initial, next);
      if (p.status === 'done') p.actual_time = actualTimeFor(toRow(next), actualFallback);
      if (sortKey !== undefined) p.sort_key = sortKey;
      const res = store.update('items', item.id, p);
      saved.push(res.saved);
      rowId = item.id;
      // 主方案换了一天：挂在它下面的备选 / 雨天方案跟着搬过去（不然留在原来那天，变成“当天通用备选”，代码评审 P2-1）
      if ('day_id' in p && (item.variant || 'primary') === 'primary' && p.day_id) {
        for (const child of store.tables.items.value.values()) {
          if (child.parent_item_id !== item.id || child.deleted_at || child.day_id === p.day_id) continue;
          saved.push(store.update('items', child.id, { day_id: p.day_id }).saved);
        }
      }
    } else {
      const row = toRow(next);
      if (row.status === 'done') row.actual_time = actualTimeFor(row, actualFallback);
      if (sortKey !== undefined) row.sort_key = sortKey;
      const res = store.insert('items', row);
      saved.push(res.saved);
      rowId = res.row.id;
    }
    await Promise.all(saved);
    haptic('success');
    const dayId = next.day === POOL ? null : next.day;
    lastSavedItem.value = { id: rowId, mode: item ? 'edit' : 'new', at: Date.now(), tripId, dayId };
    return { id: rowId, dayId, newPlaceId, time: toRow(next).start_time };
  };

  const done = (result) => {
    closeOverlay('item', { force: true });
    const title = form.title.trim();
    if (mode === 'edit') {
      toast.success(`已保存「${title}」`);
      return;
    }
    const day = result?.dayId ? days.find((d) => d.id === result.dayId) : null;
    const onThisPage = Boolean(day) && pageDate === day.date;
    // 那一天是不是行程里的“今天”（出发前在 D3 页加一条，不能说「已加到今天」，代码评审 P2-3）
    const where = day ? (day.id === ctx.todayId ? '今天' : `D${days.indexOf(day) + 1}`) : '备选池';
    const when = day && result?.time ? ` ${formatTime(result.time)}` : '';
    // 提示条一行放得下：标题太长截短（「·」不挂在行尾）
    const name = shortTitle(title, onThisPage ? 12 : 9);
    const message = onThisPage
      ? `已加「${name}」${when ? `·${when}` : ''}`   // 「」自带空白：写成「…」· 12:45
      : `已加到${where === '今天' || where === '备选池' ? where : ` ${where}`}${when}：「${name}」`;
    toast({
      message,
      tone: 'success',
      key: 'item-added',
      action: { label: '撤销', onClick: () => undoAdd(result) },
    });
  };

  // 撤销刚加的一条：软删除（不再弹「已删除 · 撤销」）；顺手建的新地点一起删掉
  const undoAdd = (result) => {
    if (!store || !result?.id) return;
    try {
      const row = store.tables.items.value.get(result.id);
      if (row && !row.deleted_at) store.update('items', result.id, { deleted_at: new Date(clockNow()).toISOString() }, { label: `撤销加一项「${row.title}」` });
      if (result.newPlaceId && store.tables.places.value.get(result.newPlaceId)) {
        const used = [...store.tables.items.value.values()].some((x) => x.place_id === result.newPlaceId && !x.deleted_at && x.id !== result.id);
        if (!used) store.remove('places', result.newPlaceId, { undoMs: 0 });
      }
      haptic('light');
      toast({ message: '已撤销', key: 'item-added' });
    } catch (e) {
      toast.error(e?.message || '没能撤销');
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
  // 合进去，不整个换掉：面板外层在同一个对象上挂了 trigger（回车提交用）
  Object.assign(api.current, {
    submit: async () => {
      resultRef.current = await submit();
    },
    onSuccess: () => done(resultRef.current),
    onError: (e) => setError(e?.message || '没有保存上，请重试'),
    dirty: () => dirty,
    ready: submittable,
    mode,
  });

  if (!store || pending || !ready) {
    return (
      <div class="item-form item-form--pending" aria-busy="true" data-testid="item-form-pending">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={96} radius="sm" />
        <Skeleton variant="rect" height={44} radius="sm" />
        <Skeleton variant="rect" height={44} radius="sm" />
      </div>
    );
  }
  if (missingEdit) {
    return (
      <div class="item-form" data-testid="item-form-missing">
        <p class="item-form__note">找不到这一项（可能刚被删除）。</p>
        <Button variant="secondary" block onClick={() => ov?.close()}>知道了</Button>
      </div>
    );
  }
  const readOnly = !canEdit;
  const summary = moreSummary(form);
  const kindLocked = form.kind !== 'other' && !touched.current.kind && mode === 'new' && form.place_id;

  // 回车 = 加进去（输入法选词的回车不算；备注里 Shift+回车换行）
  const onEnter = (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.shiftKey) return;
    e.preventDefault();
    api.current?.trigger?.();
  };

  return (
    <form class="item-form" onSubmit={(e) => e.preventDefault()} data-testid="item-form" data-mode={mode}>
      {readOnly && <p class="item-form__note item-form__note--warn" data-testid="item-readonly"><Glyph name="info" size={15} /><span>只读成员不能加、改行程，这里只能看。</span></p>}

      <div class="item-what" data-testid="item-field-title">
        <input
          class="item-what__title"
          type="text"
          value={form.title}
          onInput={set('title')}
          onKeyDown={onEnter}
          placeholder="做什么"
          aria-label="做什么"
          maxLength={200}
          autocomplete="off"
          enterKeyHint="done"
          disabled={readOnly}
          data-autofocus={mode === 'new' ? '' : undefined}
          data-testid="item-title"
        />
        <AutoTextarea
          class="item-what__note"
          value={form.description}
          onInput={set('description')}
          placeholder="备注"
          aria-label="备注"
          disabled={readOnly}
          data-testid="item-desc"
        />
      </div>

      <div class="item-rows">
        <Row label="哪天" testId="item-field-day">
          <div class="item-days" role="radiogroup" aria-label="哪天" ref={daysRef} data-testid="item-day" data-value={form.day}>
            {chips.map((c) => (
              <Chip
                key={c.value}
                size="sm"
                selected={form.day === c.value}
                onToggle={() => { if (form.day === c.value) return; haptic('selection'); patch({ day: c.value, parent_item_id: null }); }}
                disabled={readOnly}
                role="radio"
                aria-checked={form.day === c.value ? 'true' : 'false'}
                aria-label={c.aria}
                data-today={c.today ? '' : undefined}
                data-testid={`item-day-${c.value}`}
              >
                {c.label}
              </Chip>
            ))}
          </div>
        </Row>

        <Row label="几点" testId="item-field-time">
          <div class="item-times">
            <TimeInput value={form.start_time} onInput={set('start_time')} disabled={readOnly} label="开始" testId="item-start" />
            {form.start_time && (
              <>
                <span class="item-times__to" aria-hidden="true">到</span>
                <TimeInput value={form.end_time} onInput={set('end_time')} disabled={readOnly} label="结束" testId="item-end" empty="—" />
                {!readOnly && (
                  <button type="button" class="item-times__clear" onClick={() => { touched.current.time = true; patch({ start_time: '', end_time: '' }); }} aria-label="不写钟点" data-press="scale" data-testid="item-time-clear">
                    <Glyph name="x" size={15} stroke={2.2} />
                  </button>
                )}
              </>
            )}
          </div>
          {form.end_time && form.start_time && form.end_time < form.start_time && <span class="item-row__hint">结束比开始早：按次日算</span>}
        </Row>

        <Row label="在哪" testId="item-field-place">
          <PlacePicker form={form} onPick={onPickPlace} places={places} first={firstPlaces} readOnly={readOnly} />
        </Row>

        {(form.place_id || form.newPlace) && (
          <Row label="怎么去" class="item-row--how" testId="item-field-how">
            <TransportChips
              item={item || {}}
              transportIn={form.transport_in}
              disabled={readOnly}
              testId="item-how"
              onPick={(choice) => {
                try {
                  const next = transportPatch({ ...(item || {}), transport_in: form.transport_in }, choice);
                  setForm((f) => ({ ...f, transport_in: next }));
                } catch (e) {
                  setError(e?.message || '没改成');
                }
              }}
            />
            {howNow && <span class="item-row__hint item-how__hint" data-testid="item-how-hint">{howPreview(howNow, !form.transport_in || form.transport_in.auto === true)}</span>}
            {!howNow && form.newPlace && <span class="item-row__hint item-how__hint">新地点还没有位置：存好以后按距离算</span>}
          </Row>
        )}

        {mode === 'new' ? (
          <div class="item-row item-row--done" data-testid="item-field-done">
            <Checkbox
              checked={form.status === 'done'}
              onChange={(on) => { touched.current.status = true; haptic('selection'); setForm((f) => ({ ...f, status: on ? 'done' : 'planned' })); }}
              label="做完了"
              disabled={readOnly}
              data-testid="item-done"
            />
          </div>
        ) : (
          <Row label="状态" testId="item-field-status">
            <SegmentedControl
              label="状态"
              size="sm"
              value={form.status}
              options={STATUS_OPTIONS}
              disabled={readOnly}
              onChange={(v) => { haptic('selection'); setForm((f) => ({ ...f, status: v })); }}
              data-testid="item-status"
            />
          </Row>
        )}
      </div>

      <button
        type="button"
        class="item-more"
        aria-expanded={moreOpen ? 'true' : 'false'}
        onClick={() => setMoreOpen((o) => !o)}
        data-press="highlight"
        data-testid="item-more"
      >
        <span class="item-more__label">更多设置</span>
        {!moreOpen && summary && <span class="item-more__sum">{summary}</span>}
        <Glyph name={moreOpen ? 'chev-u' : 'chev-d'} size={16} stroke={2.2} class="item-more__chev" />
      </button>

      {moreOpen && (
        <div class="item-more__body" data-testid="item-more-body">
          <Field label="类型" hint={kindLocked ? '按地点给的，选一个就换' : undefined} testId="item-field-kind">
            <div class="item-kinds" role="radiogroup" aria-label="类型" data-testid="item-kinds">
              {KIND_OPTIONS.map((k) => (
                <Chip
                  key={k.value}
                  size="sm"
                  selected={form.kind === k.value}
                  onToggle={() => { touched.current.kind = true; haptic('selection'); setForm((f) => ({ ...f, kind: k.value })); }}
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

          <Field label="大概什么时候" testId="item-field-label">
            <input
              class="item-input item-input--label"
              type="text"
              value={form.time_label}
              onInput={set('time_label')}
              placeholder="上午 / 午饭后 / 日落前"
              autocomplete="off"
              disabled={readOnly}
              data-testid="item-time-label"
            />
            <div class="item-labels__chips">
              {TIME_LABEL_PRESETS.map((t) => (
                <Chip key={t} size="sm" selected={form.time_label === t} onToggle={(on) => setForm((f) => ({ ...f, time_label: on ? t : '' }))} disabled={readOnly}>{t}</Chip>
              ))}
            </div>
          </Field>

          <Field label="方案" testId="item-field-variant">
            <SegmentedControl
              label="方案"
              size="sm"
              value={form.variant}
              options={VARIANT_OPTIONS}
              disabled={readOnly}
              onChange={(v) => { haptic('selection'); patch({ variant: v, parent_item_id: v === 'primary' ? null : form.parent_item_id }); }}
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
        </div>
      )}

      {error && <p class="item-form__error" role="alert" data-testid="item-error">{error}</p>}

      {mode === 'edit' && item && canEdit && (
        <div class="item-form__danger">
          <Button variant="danger-soft" block leading={() => <Glyph name="trash" size={20} />} onClick={remove} data-testid="item-delete">删除这一项（可以撤销）</Button>
        </div>
      )}
    </form>
  );
}

const MIN_LOADING = 360;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function ItemSheet() {
  const api = useRef({ submit: async () => {}, onSuccess: () => {}, onError: () => {}, dirty: () => false, ready: false, mode: 'new' });
  const [meta, setMeta] = useState({ ready: false, editing: false });
  const [btn, setBtn] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  // 面板的标题要跟着 mode 变：表单还没挂上时先看网址里的参数（一个 id = 编辑）
  const sheet = route.value?.sheets?.find((s) => s.id === 'item');
  const editing = meta.editing || Boolean(sheet?.arg && !String(sheet.arg).includes('.'));
  // 面板打开时收起上一条「已加 · 撤销」：不压在面板里的「更多设置」上（评审）
  const open = Boolean(sheet);
  useEffect(() => {
    if (open) dismissToastKey('item-added');
  }, [open]);

  // 提交（底部按钮、标题里按回车都走这里；受控的 SubmitButton：转圈 → 对勾 / 摇头）
  const busy = useRef(false);
  const trigger = async () => {
    if (busy.current || !api.current.ready) return;
    busy.current = true;
    setBtn('loading');
    const t0 = performance.now();
    try {
      await api.current.submit();
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      setBtn('success');
    } catch (e) {
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      api.current.onError(e);
      setErrMsg(e?.message || '没有保存上，请重试');
      setBtn('error');
      busy.current = false;
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };
  api.current.trigger = trigger;

  return (
    <Sheet
      sheetId="item"
      title={editing ? '改一项' : '加一项'}
      detents={['content', 'large']}
      // 函数形式的 confirmClose：返回 true = 可以关；填了一半就先问“放弃未保存的内容？”
      confirmClose={() => (api.current.dirty() ? confirm({ ...DISCARD_TEXTS, destructive: true }) : true)}
      onClosed={() => { busy.current = false; setBtn('idle'); }}
      testId="sheet-item"
      footer={(
        <SubmitButton
          block
          state={btn}
          label={editing ? '保存' : '加进去'}
          loadingLabel="正在保存"
          errorMessage={errMsg}
          onClick={trigger}
          onSuccess={() => {
            api.current.onSuccess();
            // 面板收回以后回到「保存」（收回途中又被打开——同一个面板实例——也不会卡在对勾、点不动）
            setTimeout(() => { busy.current = false; setBtn((b) => (b === 'success' ? 'idle' : b)); }, 700);
          }}
          disabled={!meta.ready}
          data-testid="item-submit"
        />
      )}
    >
      <Form api={api} onMeta={setMeta} />
    </Sheet>
  );
}
