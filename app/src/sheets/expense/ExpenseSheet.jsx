// =====================================================================
// sheets/expense/ExpenseSheet.jsx：弹层「expense」——记一笔 / 编辑一笔（SPEC §5.5）。
//
// 打开：sheets/index.js 的 openExpenseSheet()（空白）/ openExpenseSheet({ itemId, placeId, bookingId, date, category })（预填）/
//       openExpenseSheet(expense.id)（编辑）。＋ 面板、条目动作行（kit/PlaceActions）、账本页都这么开；参数写法见 sheets/README.md。
// 最少点击：＋ → 记一笔 → 输入金额 → 记下这笔。打开时金额框自动聚焦（openOverlay 的 keyboard: true 先叫出键盘，
// 这里的输入框带 data-autofocus 接过焦点，iOS 键盘不收）。
//
// 结构：
//   ExpenseSheet（default）  渲染 <Sheet sheetId="expense">；标题、confirmClose（表单动过才问）、footer（提交按钮）都在这一层，
//                            表单内容在 Body（按参数 key 重建：换一笔就是新表单）
//   Body                    读参数（useSheetArgs）和行程（useSheetTrip），初始状态由 form-model.js 的 initialState 算，
//                            所有改动经 patch()，校验 / 提交逻辑也在 form-model.js（纯函数，单元测试覆盖）
//   表单 ↔ footer 之间只通过两个很小的通道：meta 信号（dirty / mode / 能不能提交）和 api（validate / save / focusError）
//
// 提交：SubmitButton 受控（文字 → 转圈 → 对勾）：先 validate（不通过：对应的块摇一下、聚焦，不转圈），通过才
//       store.addExpense / updateExpense → await r.saved（写进本机队列就算成功，离线也行）→ 对勾 → 面板收回（force 关，不再问）；
//       保存后写 saved.js 的 lastSavedExpense（账本页据此让新的一笔带入场动画出现、高亮），不在账本页时弹「已记一笔 · 查看」。
// 汇率：data 的 fxRates（实时 / 缓存 / 演示 / 内置参考），footer 写明「按 1 港币 ≈ 3,294 越南盾折算 · 3 小时前更新」，过期 / 离线另标。
// =====================================================================

import './expense.css';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, confirm, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { route, navigate } from '../../router/index.js';
import { authState, fxRates, online, selectors } from '../../data/index.js';
import { useFx } from '../../lib/services/fx.js';
import { now } from '../../lib/clock.js';
import { formatClock, today } from '../../lib/datetime.js';
import { formatMoney, normalizeCurrency } from '../../lib/money.js';
import { haptic } from '../../lib/native.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { categoryFromCode, parseSheetArg } from '../args.js';
import { AmountField } from './AmountField.jsx';
import { CategoryChips, PayerSegment, SplitSection, WhenRow, LinkRow, ReceiptField, shakeElement } from './parts.jsx';
import { initialState, validateState, toInsert, toPatch, isDirty, buildSplit, formatAmountInput, perPerson } from './form-model.js';
import { footerNote } from './notes.js';
import { lastSavedExpense } from './saved.js';

/** 表单 → footer / Sheet 的小通道（同一时间只开一个记一笔面板） */
const meta = signal({ dirty: false, canSubmit: false, readOnly: false, currency: null });
/** 表单登记的动作（validate / save / focusError） */
const api = { current: null };
/** footer 的提交动作（表单里按回车时调） */
const submitRef = { current: null };

const MIN_LOADING = 420;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当前网址里 expense 弹层的参数（Sheet 外层也要知道是新建还是编辑，好写标题） */
function currentArg() {
  const stack = route.value?.sheets || [];
  const hit = stack.find((s) => s.id === 'expense');
  return hit ? hit.arg ?? null : null;
}

export default function ExpenseSheet() {
  const { mode } = parseSheetArg(currentArg());
  const m = meta.value;
  const [btn, setBtn] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const resultRef = useRef(null);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    if (btn === 'loading' || btn === 'success') return;
    const a = api.current;
    if (!a) return;
    const v = a.validate();
    if (!v.ok) {
      a.focusError(v);
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
      setErrMsg(err?.message || '没保存上，请重试');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  submitRef.current = onSubmit;

  const onSaved = () => {
    const res = resultRef.current;
    resultRef.current = null;
    closeOverlay('expense', { force: true });
    if (!res) return;
    const r = route.peek();
    if (r?.name !== 'ledger' && res.tripId) {
      toast.success(`已记一笔：${res.summary}`, {
        action: { label: '查看', onClick: () => navigate({ name: 'ledger', params: { tripId: res.tripId }, query: { expense: res.id } }) },
      });
    }
  };

  return (
    <Sheet
      sheetId="expense"
      title={mode === 'edit' ? '编辑这一笔' : '记一笔'}
      detents={['content', 'large']}
      confirmClose={m.dirty}
      testId="sheet-expense"
      onClosed={() => setBtn('idle')}
      footer={() => (
        <Footer mode={mode} btn={btn} errMsg={errMsg} meta={m} onSubmit={onSubmit} onSaved={onSaved} />
      )}
    >
      {({ arg }) => <Body key={arg ?? 'new'} />}
    </Sheet>
  );
}

/** 提交区：按钮 + 汇率说明 / 离线说明 */
function Footer({ mode, btn, errMsg, meta: m, onSubmit, onSaved }) {
  const fx = useFx(undefined, { ensure: false });
  const snap = fx.snapshot;
  const isOnline = online.value !== false;
  const { text, tone } = footerNote({ snapshot: snap, isOnline, currency: m.currency, home: m.home, readOnly: m.readOnly, at: now() });
  return (
    <div class="xf-foot">
      <SubmitButton
        block
        state={btn}
        label={mode === 'edit' ? '保存修改' : '记下这笔'}
        loadingLabel="正在保存"
        successLabel="已保存"
        errorLabel="重试"
        errorMessage={errMsg}
        disabled={!m.canSubmit}
        onClick={onSubmit}
        onSuccess={onSaved}
        data-testid="xf-submit"
      />
      <p class="xf-foot__note" data-tone={tone} data-testid="xf-foot-note">{text}</p>
    </div>
  );
}

/**
 * 表单本体。按弹层参数 key 重建；store 还没好时显示骨架。
 */
function Body() {
  const { mode, id, fields } = useSheetArgs();
  const { tripId, store, pending } = useSheetTrip();
  const trip = store?.trip.value || null;
  const status = store?.status.value;
  const ready = Boolean(trip) && (status === 'ready' || status === 'loading' || store?.source.value === 'cache');
  const myId = authState.value.user?.id || null;
  const canEdit = store?.view.canEdit.value ?? false;
  const members = store?.view.members.value || [];
  const expense = mode === 'edit' && id ? store?.tables.expenses.value.get(id) || null : null;
  const missing = ready && mode === 'edit' && (!expense || expense.deleted_at);

  // 行程上下文（给 form-model 的纯函数用；函数都是闭包，按需读 store）
  const ctx = useMemo(() => {
    if (!store || !trip) return null;
    const sharers = members
      .filter((mb) => mb.role === 'owner' || mb.role === 'editor')
      .map((mb) => ({ user_id: mb.user_id, name: store.memberName(mb.user_id), color: mb.color || null }));
    if (myId && !sharers.some((s) => s.user_id === myId)) sharers.unshift({ user_id: myId, name: store.memberName(myId), color: null });
    const tz = trip.timezone;
    const at = now();
    // 那一刻人在哪个时区（去程落地前 / 回程落地后是香港）：只在行程那几天里（出发当天还在香港机场、回程那晚已经回到香港）
    // 默认币种改用本币，时间框旁边说明按行程时区记、香港现在几点；出发前、结束以后补记行程里的账照旧默认当地币
    const here = store.presenceZone ? store.presenceZone(at) : tz;
    const ongoing = store.view?.phase?.value?.phase === 'ongoing';
    return {
      trip,
      timeZone: tz,
      myId,
      sharers,
      away: Boolean(ongoing && here && here !== tz),
      hereZone: here,
      hereTime: formatClock(at, here),
      today: today(tz, at),
      nowTime: formatClock(at, tz),
      getItem: (x) => store.tables.items.value.get(x) || null,
      getPlace: (x) => store.tables.places.value.get(x) || null,
      getBooking: (x) => store.tables.bookings.value.get(x) || null,
      getDay: (x) => store.tables.days.value.get(x) || null,
      getExpense: (x) => store.tables.expenses.value.get(x) || null,
      legacyShares: (e) => {
        const r = selectors.expenseShares(e, store.bundle);
        return { payer: r.payer, ids: [...r.shares.keys()] };
      },
      itemsOnDate: (date) => {
        const day = store.view.dayByDate.value.get(date);
        if (!day) return [];
        const list = store.view.itemsByDay.value.get(day.id) || [];
        return [...list].sort((a, b) => (a.variant === 'primary' ? 0 : 1) - (b.variant === 'primary' ? 0 : 1));
      },
    };
  }, [store, trip, members, myId]);

  // 初始状态（编辑 / 预填）：store 已经好了就在第一次渲染里算出来——底部面板按第一帧的内容高度定档位，
  // 不能先画骨架再换成表单（面板会停在骨架那么高、底部按钮压在内容上）
  const initialRef = useRef(null);
  const hintRef = useRef(null);
  const baseRef = useRef(null);
  const build = () => {
    if (!ctx || !ready) return null;
    const init = initialState({ mode, id, fields: { ...fields, category: fields.category ? categoryFromCode(fields.category) || fields.category : undefined } }, ctx);
    if (init.missing) return null;
    const s = init.state;
    // 空白新建时默认「餐饮」（旅行里最常记的）；预填 / 编辑按原样
    if (mode === 'new' && !s.category) s.category = '餐饮';
    initialRef.current = s;
    // 打开面板那一刻的那一笔：保存时按它算“改了什么”，面板开着时另一台手机改的字段不会被改回去（代码评审 P1-1）
    baseRef.current = mode === 'edit' && id ? ctx.getExpense(id) : null;
    hintRef.current = init.hint;
    return s;
  };
  const [state, setState] = useState(build);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const amountRef = useRef(null);
  const splitRef = useRef(null);
  const whenRef = useRef(null);
  const hint = hintRef.current;

  // 打开时 store 还没好（深层链接、刷新）：数据到了再初始化
  useEffect(() => {
    if (state || !ctx || !ready) return;
    const s = build();
    if (s) setState(s);
  }, [ctx, ready, state, mode, id]);

  // 表单从骨架换成真内容、行数变了：overlay/Sheet 自己用 ResizeObserver 盯着内容区，面板跟着长高 / 变矮（不用再发 resize 事件）

  const patch = (p) => {
    setError(null);
    setState((s) => (s ? { ...s, ...p } : s));
  };

  const home = normalizeCurrency(trip?.home_currency || 'HKD');
  const currency = state ? normalizeCurrency(state.currency) : null;
  const rate = currency ? fxRates.value.rate(currency, home) : null;
  const amount = state ? formatAmountInput(state.amountText, currency).value : null;
  const mismatch = state && ctx && state.splitMode === 'amounts' && amount ? selectors.splitMismatch(buildSplit(state, ctx), amount, currency) : 0;
  const dirty = Boolean(state && isDirty(state, initialRef.current));
  const readOnly = ready && !canEdit;
  const canSubmit = Boolean(state && ctx && ready && !missing && !readOnly);

  // 告诉外层（Sheet 的 confirmClose、footer 的按钮）
  useEffect(() => {
    meta.value = { dirty, canSubmit, readOnly, currency, home };
  }, [dirty, canSubmit, readOnly, currency, home]);
  useEffect(() => () => {
    meta.value = { dirty: false, canSubmit: false, readOnly: false, currency: null, home: null };
  }, []);

  // 登记提交动作（每个表单实例自己一份；换一笔时旧的卸载不会把新的清掉）
  const mine = useRef({});
  useLayoutEffect(() => {
    api.current = mine.current;
    return () => {
      if (api.current === mine.current) api.current = null;
    };
  }, []);
  Object.assign(mine.current, {
    validate() {
      if (!state || !ctx) return { ok: false, field: 'amount', message: '正在读取…' };
      return validateState(state, ctx, { splitMismatch: selectors.splitMismatch });
    },
    focusError(v) {
      setError(v);
      haptic('warning');
      if (v.field === 'split') {
        shakeElement(splitRef.current);
        // 差多少的说明在输入框下面：滚到看得见的地方再聚焦第一个输入框
        splitRef.current?.querySelector('[data-testid="xf-split-mismatch"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        splitRef.current?.querySelector('input')?.focus({ preventScroll: true });
      } else if (v.field === 'date' || v.field === 'time') {
        shakeElement(whenRef.current);
      } else {
        shakeElement(amountRef.current?.closest('.xf-amount'));
        amountRef.current?.focus({ preventScroll: true });
      }
    },
    async save() {
      if (!state || !ctx || !store) throw new Error('正在读取行程，请稍等');
      const input = toInsert(state, ctx);
      const summary = `${input.description || input.category} ${formatMoney(input.amount, input.currency)}`;
      let savedId = id;
      let saved = null;
      if (mode === 'edit') {
        if (!expense) throw new Error('这笔记账已经不存在了');
        const p = toPatch(state, baseRef.current || expense, ctx);
        if (Object.keys(p).length) {
          const r = store.updateExpense(id, p);
          saved = await r.saved;
        }
      } else {
        const r = store.addExpense(input);
        saved = await r.saved;
        savedId = r.row?.id || null;
      }
      lastSavedExpense.value = { id: savedId, mode, at: Date.now(), tripId };
      haptic('success');
      // 这台设备的存储暂时不可用：改动只在内存里（data 的 r.saved → { durable: false }），提醒一句，别关页面
      if (saved && saved.durable === false) toast.warning('手机存储暂时不可用，这笔先记在内存里：联网同步前别关掉页面');
      return { ok: true, id: savedId, tripId, summary };
    },
  });

  async function onPickReceipt(file) {
    if (!store) return;
    try {
      setUploading(true);
      const r = store.upload('receipts', file);
      const up = await r;
      patch({ receiptPath: up.path });
      up.synced?.then?.(() => setUploading(false)).catch?.(() => setUploading(false));
    } catch (err) {
      setUploading(false);
      toast.error(err?.message || '照片没传上，请重试');
    }
  }

  async function onDelete() {
    if (!expense || !store) return;
    const ok = await confirm({
      title: '删除这一笔？',
      message: `「${expense.description || expense.category || '一笔账'}」${formatMoney(Number(expense.amount), expense.currency_iso || expense.currency)}。删除后几秒内可以撤销。`,
      confirmText: '删除',
      cancelText: '先不删',
      destructive: true,
    });
    if (!ok) return;
    store.softDelete('expenses', expense.id);
    closeOverlay('expense', { force: true });
  }

  if (!tripId) return <div class="xf-state"><EmptyState compact title="先打开一趟行程" description="记一笔要记在某一趟行程里。" /></div>;
  if (!ready || (!state && !missing)) {
    return (
      <div class="xf xf--loading" aria-busy="true" data-testid="xf-loading">
        <span class="visually-hidden" role="status">{pending || !ready ? '正在读取行程…' : '正在准备表单…'}</span>
        <Skeleton variant="rect" height={132} radius="lg" />
        <Skeleton variant="rect" height={44} radius="pill" />
        <Skeleton variant="text" lines={2} />
      </div>
    );
  }
  if (missing) {
    return (
      <div class="xf-state" data-testid="xf-missing">
        <EmptyState compact title="找不到这一笔" description="可能已经被删除了。" action={<Button variant="secondary" onClick={() => closeOverlay('expense', { force: true })}>关闭</Button>} />
      </div>
    );
  }

  const forName = state.splitMode === 'personal' ? ctx.sharers.find((s) => s.user_id === (state.personalFor || state.payer))?.name || null : null;
  const items = state.date ? ctx.itemsOnDate(state.date) : [];
  const linkedItem = state.itemId ? ctx.getItem(state.itemId) : null;
  const linkedBooking = state.bookingId ? ctx.getBooking(state.bookingId) : null;
  const linkedPlace = state.placeId ? ctx.getPlace(state.placeId) : null;
  const errorId = 'xf-error';

  return (
    <form
      class="xf"
      data-mode={mode}
      data-testid="xf-form"
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // 桌面上在输入框里按回车 = 提交（输入法选词的回车不算）
        if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
        const tag = e.target?.tagName;
        if (tag === 'INPUT' && e.target.type !== 'file') {
          e.preventDefault();
          submitRef.current?.();
        }
      }}
    >
      <AmountField
        state={state}
        onChange={patch}
        trip={trip}
        rate={rate}
        perPerson={perPerson(state, ctx)}
        splitMode={state.splitMode}
        forName={forName}
        autoFocus={mode === 'new'}
        invalid={error?.field === 'amount'}
        errorId={error?.field === 'amount' ? errorId : undefined}
        disabled={readOnly}
        inputRef={amountRef}
      />
      {error?.field === 'amount' && <p class="xf-error" id={errorId} role="alert" data-testid="xf-error">{error.message}</p>}
      {hint && !state.amountText && (
        <p class="xf-split__note" data-testid="xf-hint">
          预估 {formatMoney(hint.amount, hint.currency)}{hint.per === 'person' ? ' / 人' : ''}
          {' · '}
          <button
            type="button"
            class="xf-amount__hint-btn"
            data-press="scale"
            onClick={() => patch({ currency: hint.currency, amountText: formatAmountInput(String(hint.per === 'person' ? hint.amount * ctx.sharers.length : hint.amount), hint.currency).text })}
          >
            用预估
          </button>
        </p>
      )}

      <div class="xf__section">
        <span class="xf__label"><span>分类</span></span>
        <CategoryChips value={state.category} onChange={(c) => patch({ category: c })} disabled={readOnly} />
      </div>

      <div class="xf__section">
        <span class="xf__label"><span>谁付</span></span>
        <PayerSegment sharers={ctx.sharers} value={state.payer} myId={myId} disabled={readOnly} onChange={(v) => patch({ payer: v, splitDirty: true, ...(state.splitMode === 'personal' && state.personalFor === state.payer ? { personalFor: v } : {}) })} />
      </div>

      <div class="xf__section" ref={splitRef}>
        <span class="xf__label"><span>怎么分</span></span>
        <SplitSection state={state} ctx={ctx} onChange={patch} mismatch={mismatch} disabled={readOnly} errorId="xf-split-error" rate={rate} home={home} />
      </div>

      <div class="xf__section">
        <span class="xf__label"><span>说明</span><span class="xf__label-hint">{linkedPlace ? linkedPlace.name : ''}</span></span>
        <input
          class="xf-field"
          type="text"
          value={state.description}
          placeholder="吃了什么、买了什么…"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={120}
          disabled={readOnly}
          aria-label="说明"
          data-testid="xf-desc"
          onInput={(e) => patch({ description: e.currentTarget.value })}
        />
      </div>

      <div ref={whenRef}>
        <WhenRow state={state} onChange={patch} trip={trip} disabled={readOnly} away={ctx?.away ? { zone: ctx.hereZone, time: ctx.hereTime } : null} />
        {(error?.field === 'date' || error?.field === 'time') && <p class="xf-error" role="alert">{error.message}</p>}
      </div>

      <LinkRow state={state} onChange={patch} items={items} disabled={readOnly} />
      {(linkedBooking || (linkedItem && !items.some((it) => it.id === linkedItem.id))) && (
        <p class="xf-split__note" data-testid="xf-linked">
          <Glyph name="ticket" size={14} />{' '}
          {linkedBooking ? `关联预订「${linkedBooking.title}」` : `关联条目「${linkedItem.title}」`}
        </p>
      )}

      <ReceiptField path={state.receiptPath} uploading={uploading} disabled={readOnly} onPick={onPickReceipt} onRemove={() => patch({ receiptPath: null })} />

      {mode === 'edit' && canEdit && (
        <div class="xf-danger">
          <Button variant="danger-soft" block leading={<Glyph name="trash" size={18} />} onClick={onDelete} data-testid="xf-delete">删除这一笔</Button>
        </div>
      )}
    </form>
  );
}
