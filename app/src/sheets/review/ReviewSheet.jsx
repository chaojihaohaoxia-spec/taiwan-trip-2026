// =====================================================================
// sheets/review/ReviewSheet.jsx：弹层「review」——写评级（SPEC §5.9、docs/数据结构.md B4.13 / B5.10）。
//
// 打开：sheets/index.js 的 openReviewSheet(place.id) / openReviewSheet({ placeId, itemId })（从某个条目打开时关联那一次）。
// 每人每个地点一条：已经评过就是编辑那一条（data 的 saveReview：有就改、没有就建）。只读成员也能写自己的评级。
//
// 表单（从上到下）：
//   五档评级：夯 / 顶级 / 人上人 / NPC / 拉完了（--color-rating-*）大色块按钮，选中弹一下；再点一下取消（可以只写评语）
//   评语
//   吃了什么 / 买了什么（B5.10 LogEntry：名字、价格（币种可选，认得 45k、4.5万）、好不好吃（同样五档））——
//     吃喝类地点「吃了什么」在前，其他地点「买了什么」在前；打名字回车就加一条，可以连着加
//   照片（可选；选了先本机预览，保存时压缩上传到私有桶，离线也能存，联网后自动传）
//   删除我的评级（编辑时；删除后几秒内可以撤销）
// 底部 SubmitButton「保存评级」：文字 → 转圈 → 对勾；失败摇头 + 中文原因。改过没保存就关，先问“放弃未保存的内容？”。
//
// 从地点详情点「写评级」过来的（sheets/place/flow.js 记着），这个面板关掉（保存、取消、往下拉、返回手势）后回到地点详情。
// 表单状态放在“这一次打开”的会话里（signals）：标题、底部按钮、关闭前确认都在 Sheet 外层，和表单内容共用。
// =====================================================================

import './review.css';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet, closeOverlay, confirm, toast } from '../../overlay/index.js';
import { route } from '../../router/index.js';
import { data, online, useSignedUrl } from '../../data/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { InlineAdd } from '../../kit/InlineAdd.jsx';
import { haptic } from '../../lib/native.js';
import { now } from '../../lib/clock.js';
import { formatMoney, formatAmount, normalizeCurrency, currencyName } from '../../lib/money.js';
import { zonedToInstant } from '../../lib/datetime.js';
import { openPlaceSheet } from '../index.js';
import { parseSheetArg } from '../args.js';
import { useSheetTrip } from '../hooks.js';
import { RATING_TIERS, ratingName, EATING_KINDS, placeKind, itemTimeText, dayLabel, localName } from '../place/model.js';
import { popSpring } from '../place/parts.jsx';
import { takeReturnToPlace } from '../place/flow.js';
import { tripDayNumber } from '../../lib/datetime.js';
import {
  initialForm, formKey, isEmptyForm, priceErrors, buildPatch, parsePrice, newEntry, currencyChoices, visitedAtFor,
  wantsThousands, priceInputMode, timesThousand, forgotThousands,
  MAX_LOG_ENTRIES, MAX_PHOTOS, MAX_NOTES, MAX_NAME, nextKey,
} from './form-model.js';

// ---------------------------------------------------------------------
// 这一次打开的会话
// ---------------------------------------------------------------------

/** 网址里 review 弹层的参数（Sheet 外层也要知道：哪个地点、哪个条目） */
function reviewArg() {
  const entry = route.value?.sheets?.find((s) => s.id === 'review');
  return entry ? entry.arg ?? '' : null;
}

function createSession(arg) {
  const { id, fields } = parseSheetArg(arg || null);
  const placeId = fields.place || id || null;
  return {
    arg,
    placeId,
    itemId: fields.item || null,
    path: route.value?.path || null,
    returnToPlace: takeReturnToPlace(placeId),
    form: signal(null),
    initialKey: signal(''),
    /** 打开时就有我的评级（编辑）还是新写；保存后不再变，标题和按钮不会在保存的一瞬间换字 */
    editing: signal(null),
    existing: null,
    error: signal(''),
    closed: false,
    handled: false,
  };
}

const dirtyOf = (s) => Boolean(s?.form.value && formKey(s.form.value) !== s.initialKey.value);

export default function ReviewSheet() {
  const arg = reviewArg();
  const ref = useRef(null);
  if (arg !== null && (!ref.current || ref.current.arg !== arg || ref.current.closed)) ref.current = createSession(arg);
  const session = ref.current;

  // 面板关掉了（网址里没有 review 了）：从地点详情过来的，回到地点详情（保存时已经自己换过去的不算）
  useEffect(() => {
    const s = ref.current;
    if (arg !== null || !s || s.closed) return;
    s.closed = true;
    if (s.returnToPlace && !s.handled && s.placeId && route.value?.path === s.path) {
      openPlaceSheet(s.placeId);
    }
  }, [arg]);

  const dirty = dirtyOf(session);
  return (
    <Sheet
      sheetId="review"
      title={<ReviewTitle session={session} />}
      description={<ReviewSubtitle session={session} />}
      detents={['large']}
      confirmClose={dirty}
      testId="sheet-review"
      class="rv-sheet"
      footer={<ReviewFooter session={session} />}
    >
      <ReviewBody session={session} />
    </Sheet>
  );
}

/** 地点、我那条评级、关联的条目（都可能还在读） */
function useReviewData(session) {
  const { store, pending } = useSheetTrip();
  const placeId = session?.placeId;
  const place = placeId ? store?.tables?.places?.value?.get(placeId) || null : null;
  const userId = data.userId.value;
  let mine = null;
  if (place && store) for (const r of store.tables.reviews.value.values()) if (r.place_id === placeId && r.user_id === userId) mine = r;
  const item = session?.itemId ? store?.tables?.items?.value?.get(session.itemId) || null : null;
  return { store, pending, place, mine, item, userId };
}

function ReviewTitle({ session }) {
  const { place, pending } = useReviewData(session);
  if (place) return <span data-testid="review-sheet-title">{place.name}</span>;
  return pending ? '正在读取…' : '写评级';
}

function ReviewSubtitle({ session }) {
  const { place, mine, item, store } = useReviewData(session);
  if (!place) return null;
  const day = item?.day_id ? store?.tables?.days?.value?.get(item.day_id) : null;
  const when = item && day ? [dayLabel(tripDayNumber(day.date, store.trip.value?.start_date), day.date), itemTimeText(item)].filter(Boolean).join(' · ') : null;
  const editing = session.editing.value ?? Boolean(mine);
  const parts = [editing ? '改我的评级' : '我的评级', when ? `${when} ${item.title}` : localName(place)].filter(Boolean);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------

function ReviewBody({ session }) {
  const { store, pending, place, mine } = useReviewData(session);
  const trip = store?.trip?.value || null;
  const currency = normalizeCurrency(trip?.local_currency || trip?.home_currency) || 'HKD';

  // 数据到了以后初始化一次表单（已有评级 → 填好；没有 → 空表单）
  useLayoutEffect(() => {
    if (!session || session.form.peek() || !place || !trip) return;
    session.existing = mine;
    session.editing.value = Boolean(mine);
    const f = initialForm(mine, { currency });
    session.form.value = f;
    session.initialKey.value = formKey(f);
  }, [session, place, trip, mine]);

  if (!session) return null;
  const form = session.form.value;
  if (!form) {
    if (!place && !pending && store?.trip?.value) {
      return (
        <EmptyState
          compact
          icon={(p) => <Glyph name="pin" size={p.size} />}
          title="找不到这个地点"
          description="可能已经被删掉了，或者不在这趟行程里。"
          data-testid="review-sheet-missing"
        />
      );
    }
    return (
      <div class="rv-loading" aria-busy="true">
        <span class="visually-hidden" role="status">正在读取…</span>
        <Skeleton variant="rect" height={64} radius="lg" />
        <Skeleton variant="rect" height={96} radius="lg" />
        <Skeleton variant="text" lines={2} />
      </div>
    );
  }

  const set = (patch) => {
    session.form.value = { ...session.form.peek(), ...patch };
    if (session.error.peek()) session.error.value = '';
  };
  const choices = currencyChoices(trip, [...form.food, ...form.shop].map((e) => e.currency));
  const eatingFirst = EATING_KINDS.includes(placeKind(place));
  const food = (
    <LogSection
      key="food"
      kind="food"
      title="吃了什么"
      glyph="bowl"
      entries={form.food}
      onChange={(food) => set({ food })}
      currency={currency}
      choices={choices}
      placeholder="加一道菜，比如：烤海鲜拼盘"
      addLabel="添加吃的"
    />
  );
  const shop = (
    <LogSection
      key="shop"
      kind="shop"
      title="买了什么"
      glyph="bag"
      entries={form.shop}
      onChange={(shop) => set({ shop })}
      currency={currency}
      choices={choices}
      placeholder="加一样东西，比如：胡椒粉"
      addLabel="添加买的"
    />
  );

  return (
    <div class="rv" data-testid="review-form">
      <TierPicker value={form.rating} onChange={(rating) => set({ rating })} />

      <section class="rv-sec" aria-labelledby="rv-notes-label">
        <label class="rv-sec__title" id="rv-notes-label" for="rv-notes">评语</label>
        <AutoTextarea
          id="rv-notes"
          value={form.notes}
          maxLength={MAX_NOTES}
          placeholder="说说感受：哪里好、哪里踩雷、下次点什么…"
          onInput={(notes) => set({ notes })}
        />
      </section>

      {eatingFirst ? [food, shop] : [shop, food]}

      <Photos photos={form.photos} onChange={(photos) => set({ photos })} />

      {session.existing && <DeleteReview session={session} store={store} />}

      {!online.value && (
        <p class="rv-offline" data-testid="review-offline">
          <Glyph name="info" size={15} />
          现在没有网络：照常保存，联网后自动同步（照片也会自动上传）。
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 五档评级
// ---------------------------------------------------------------------

function TierPicker({ value, onChange }) {
  const faces = useRef({});
  const btns = useRef({});
  const hint = RATING_TIERS.find((t) => t.value === value)?.hint;
  const pick = (v) => {
    const next = value === v ? null : v;
    onChange(next);
    haptic('selection');
    if (next) popSpring(faces.current[v], 0.84, 'rv-tier-pop');
  };
  const onKeyDown = (e) => {
    const order = RATING_TIERS.map((t) => t.value);
    const i = order.indexOf(value ?? order[0]);
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(order.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = order.length - 1;
    if (j === null) return;
    e.preventDefault();
    const v = order[j];
    if (v !== value) {
      onChange(v);
      haptic('selection');
      popSpring(faces.current[v], 0.84, 'rv-tier-pop');
    }
    btns.current[v]?.focus();
  };
  return (
    <section class="rv-sec rv-sec--tiers" aria-labelledby="rv-tier-label">
      <p class="rv-sec__title" id="rv-tier-label">评个级</p>
      <div class="rv-tiers" role="radiogroup" aria-labelledby="rv-tier-label" onKeyDown={onKeyDown} data-testid="review-tiers" data-value={value ?? ''}>
        {RATING_TIERS.map((t, i) => {
          const on = value === t.value;
          const focusable = on || (!value && i === 0);
          return (
            <button
              key={t.value}
              ref={(el) => { btns.current[t.value] = el; }}
              type="button"
              role="radio"
              aria-checked={on ? 'true' : 'false'}
              tabIndex={focusable ? 0 : -1}
              class={`rv-tier rv-tier--r${t.value}`}
              data-selected={on ? '' : undefined}
              data-dim={value && !on ? '' : undefined}
              data-press="scale"
              data-testid={`tier-${t.value}`}
              title={t.hint}
              onClick={() => pick(t.value)}
            >
              <span class="rv-tier__face" ref={(el) => { faces.current[t.value] = el; }}>
                <span class="rv-tier__label">{t.label}</span>
                <span class="rv-tier__bar" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
      <p class="rv-tiers__hint" aria-live="polite" data-testid="review-tier-hint">
        {value ? <><b>{ratingName(value)}</b>：{hint}<span class="rv-tiers__again">（再点一下取消）</span></> : '选一个档位；也可以只写评语'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------
// 评语（随内容长高）
// ---------------------------------------------------------------------

function AutoTextarea({ id, value, onInput, placeholder, maxLength }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(320, el.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      class="rv-input rv-textarea"
      rows={3}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      enterKeyHint="enter"
      data-testid="review-notes"
      onInput={(e) => onInput(e.currentTarget.value)}
    />
  );
}

// ---------------------------------------------------------------------
// 吃了什么 / 买了什么
// ---------------------------------------------------------------------

function LogSection({ kind, title, glyph, entries, onChange, currency, choices, placeholder, addLabel }) {
  const full = entries.length >= MAX_LOG_ENTRIES;
  const update = (key, patch) => onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const remove = (key) => {
    haptic('light');
    onChange(entries.filter((e) => e.key !== key));
  };
  const add = (text) => {
    if (entries.length >= MAX_LOG_ENTRIES) throw new Error(`最多 ${MAX_LOG_ENTRIES} 条`);
    onChange([...entries, newEntry(text, currency)]);
  };
  return (
    <section class="rv-sec" aria-labelledby={`rv-${kind}-label`} data-testid={`review-${kind}`}>
      <p class="rv-sec__title" id={`rv-${kind}-label`}>
        <Glyph name={glyph} size={16} />
        {title}
        {entries.length > 0 && <span class="rv-sec__count">{entries.length}</span>}
      </p>
      <FlipGroup as="ul" class="rv-logs" trigger={entries.map((e) => e.key).join(',')} options={{ spring: 'smooth' }}>
        {entries.map((e) => (
          <LogEntryRow key={e.key} kind={kind} entry={e} choices={choices} onChange={(patch) => update(e.key, patch)} onRemove={() => remove(e.key)} />
        ))}
      </FlipGroup>
      <InlineAdd
        onAdd={add}
        placeholder={placeholder}
        label={addLabel}
        maxLength={MAX_NAME}
        disabled={full}
        disabledReason={`最多 ${MAX_LOG_ENTRIES} 条`}
        testId={`review-${kind}-add`}
      />
    </section>
  );
}

function LogEntryRow({ kind, entry, choices, onChange, onRemove }) {
  const price = parsePrice(entry.amount, entry.currency);
  const preview = price.value !== null ? formatMoney(price.value, entry.currency) : null;
  const opts = choices.includes(entry.currency) ? choices : [...choices, entry.currency];
  const thousands = wantsThousands(entry.currency);
  // 「太少了？」只在打完（输入框没在打字）时提醒：边打 45000 边冒出“4₫ 太少了”会一闪一闪
  const [typing, setTyping] = useState(false);
  const forgot = typing ? null : forgotThousands(entry.amount, entry.currency);
  const times = () => {
    const t = timesThousand(entry.amount, entry.currency);
    if (t === null) return;
    haptic('selection');
    onChange({ amount: t });
  };
  return (
    <li class="rv-log" data-flip-key={entry.key} data-testid={`review-${kind}-entry`}>
      <div class="rv-log__row">
        <input
          class="rv-input rv-log__name"
          type="text"
          value={entry.name}
          maxLength={MAX_NAME}
          aria-label={kind === 'food' ? '吃了什么' : '买了什么'}
          placeholder="名字"
          onInput={(e) => onChange({ name: e.currentTarget.value })}
        />
        <button type="button" class="rv-log__remove" data-press="scale" aria-label={`删掉「${entry.name || '这一条'}」`} onClick={onRemove}>
          <Glyph name="x" size={15} stroke={2.2} />
        </button>
      </div>
      <div class="rv-log__row">
        <label class="rv-price" data-error={price.error ? '' : undefined}>
          <span class="visually-hidden">价格</span>
          <input
            class="rv-input rv-price__input"
            type="text"
            inputMode={priceInputMode(entry.currency)}
            value={entry.amount}
            placeholder="价格（可不填）"
            autoComplete="off"
            onInput={(e) => onChange({ amount: e.currentTarget.value })}
            onFocus={() => setTyping(true)}
            onBlur={() => {
              setTyping(false);
              if (price.value !== null) onChange({ amount: formatAmount(price.value, entry.currency).replace(/[^\d.,]/g, '') });
            }}
          />
          {thousands && (
            // 手机的数字键盘打不出 k：45 →「千」→ 45,000。按下时不抢输入框的焦点（键盘不收起，接着打）
            <button
              type="button"
              class="rv-price__k"
              data-press="scale"
              disabled={price.value === null}
              aria-label="乘以一千（比如 45 → 45,000）"
              data-testid="review-price-k"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={times}
            >
              千
            </button>
          )}
          <select
            class="rv-price__cur"
            value={entry.currency}
            aria-label="币种"
            onChange={(e) => onChange({ currency: e.currentTarget.value })}
          >
            {opts.map((c) => <option key={c} value={c}>{currencyName(c) || c}</option>)}
          </select>
        </label>
        {preview && <span class="rv-price__preview" aria-live="polite">{preview}</span>}
      </div>
      {price.error && <p class="rv-log__error" role="alert">{price.error}</p>}
      {!price.error && forgot && (
        <button type="button" class="rv-log__forgot" data-press="scale" onClick={times} data-testid="review-price-forgot">
          <Glyph name="info" size={14} />
          <span>{formatAmount(price.value, entry.currency)} 太少了？点这里改成 {formatMoney(forgot.value, entry.currency)}</span>
        </button>
      )}
      <MiniTiers value={entry.rating} kind={kind} onChange={(rating) => onChange({ rating })} />
    </li>
  );
}

/** 一样东西好不好吃 / 值不值：同样五档的小胶囊；再点一下取消 */
function MiniTiers({ value, kind, onChange }) {
  return (
    <div class="rv-mini" role="radiogroup" aria-label={kind === 'food' ? '好不好吃' : '值不值'}>
      {RATING_TIERS.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on ? 'true' : 'false'}
            class={`rv-mini__tier rv-mini__tier--r${t.value}`}
            data-selected={on ? '' : undefined}
            data-press="scale"
            onClick={(e) => {
              haptic('selection');
              onChange(on ? null : t.value);
              if (!on) popSpring(e.currentTarget.firstChild, 0.8, 'rv-mini-pop');
            }}
          >
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// 照片
// ---------------------------------------------------------------------

function Photos({ photos, onChange }) {
  const inputRef = useRef(null);
  const full = photos.length >= MAX_PHOTOS;
  // 新选的照片：本机预览网址，面板关掉时释放
  const urls = useRef(new Set());
  useEffect(() => () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current.clear();
  }, []);
  const pickFiles = (files) => {
    const list = [...(files || [])].filter((f) => f && (/^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name || '')));
    if (!list.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (list.length > room) toast.warning(`最多 ${MAX_PHOTOS} 张，多出来的 ${list.length - room} 张没有加`);
    const added = list.slice(0, Math.max(0, room)).map((file) => {
      let preview = null;
      try {
        preview = URL.createObjectURL(file);
        urls.current.add(preview);
      } catch {
        preview = null;
      }
      return { key: nextKey('p'), path: null, file, preview, width: null, height: null, taken_at: null, caption: null };
    });
    if (added.length) {
      haptic('light');
      onChange([...photos, ...added]);
    }
  };
  return (
    <section class="rv-sec" aria-labelledby="rv-photo-label" data-testid="review-photos">
      <p class="rv-sec__title" id="rv-photo-label">
        <Glyph name="camera" size={16} />
        照片
        <span class="rv-sec__hint">可不加</span>
      </p>
      <FlipGroup as="ul" class="rv-photos" trigger={photos.map((p) => p.key).join(',')} options={{ spring: 'smooth' }}>
        {photos.map((p, i) => (
          <PhotoTile key={p.key} photo={p} index={i} onRemove={() => onChange(photos.filter((x) => x.key !== p.key))} />
        ))}
        <li class="rv-photo rv-photo--add" data-flip-key="add">
          <label class="rv-photo__add" data-disabled={full ? '' : undefined} data-press="scale">
            <input
              ref={inputRef}
              class="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              disabled={full}
              data-testid="review-photo-input"
              onChange={(e) => {
                pickFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
            <Glyph name="plus" size={22} stroke={2} />
            <span>{full ? '满了' : '加照片'}</span>
          </label>
        </li>
      </FlipGroup>
    </section>
  );
}

function PhotoTile({ photo, index, onRemove }) {
  const signed = useSignedUrl(photo.path || null);
  const url = photo.preview || signed;
  return (
    <li class="rv-photo" data-flip-key={photo.key} data-testid="review-photo">
      {url ? <img src={url} alt={`第 ${index + 1} 张`} draggable={false} /> : <span class="rv-photo__ph" aria-hidden="true"><Glyph name="photo" size={20} /></span>}
      {!photo.path && <span class="rv-photo__new">新</span>}
      <button type="button" class="rv-photo__remove" data-press="scale" aria-label={`去掉第 ${index + 1} 张照片`} onClick={onRemove}>
        <Glyph name="x" size={13} stroke={2.6} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------
// 删除我的评级
// ---------------------------------------------------------------------

function DeleteReview({ session, store }) {
  const remove = async () => {
    const ok = await confirm({ title: '删除我的评级？', message: '档位、评语、吃了什么、照片都会一起删掉；删除后几秒内可以撤销。', confirmText: '删除', destructive: true });
    if (!ok) return;
    try {
      const existing = session.existing;
      const res = store.remove('reviews', existing.id, { undoMs: 6000, label: '删除评级' });
      // 照片文件等删除真的发出去（撤销窗口过了、没被撤销）再从私有桶里删，和日记一样（代码评审 P2-4：以前评级删了、照片还留在桶里）
      const paths = (existing.photos || []).map((p) => p?.path).filter(Boolean);
      if (paths.length && res?.synced) {
        res.synced.then((r) => {
          if (!r?.ok) return;
          try {
            data.files?.remove?.(store.tripId, paths);
          } catch {
            /* 删文件失败不影响：最多桶里多一张没人引用的图 */
          }
        }).catch(() => {});
      }
      haptic('success');
      finish(session, { force: true });
    } catch (e) {
      haptic('warning');
      toast.error(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没能删除，请稍后再试');
    }
  };
  return (
    <div class="rv-delete">
      <Button variant="danger-soft" size="sm" leading={<Glyph name="trash" size={16} />} onClick={remove} data-testid="review-delete">
        删除我的评级
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------

/** 关掉写评级：从地点详情过来的换回地点详情，否则直接关 */
function finish(session, { force = true } = {}) {
  const f = session.form.peek();
  if (f) session.initialKey.value = formKey(f);
  if (session.returnToPlace && session.placeId) {
    session.handled = true;
    openPlaceSheet(session.placeId, { replace: true });
  } else {
    closeOverlay('review', { force });
  }
}

function ReviewFooter({ session }) {
  const { store, place, mine, item } = useReviewData(session);
  const form = session?.form.value;
  const trip = store?.trip?.value;
  const empty = !form || isEmptyForm(form);
  const editing = session?.editing.value ?? Boolean(mine);
  const label = editing ? '保存修改' : '保存评级';
  const errorText = session?.error.value || '';
  const tz = trip?.timezone;
  const day = item?.day_id ? store?.tables?.days?.value?.get(item.day_id) : null;
  const ongoing = store?.view?.phase?.value?.phase === 'ongoing';

  const save = async () => {
    const f = session.form.peek();
    if (!f || !store || !place) throw new Error('还没读到地点');
    const bad = priceErrors(f);
    if (bad.length) {
      session.error.value = `「${bad[0].name}」的价格看不懂，改一下再保存`;
      throw new Error(session.error.peek());
    }
    // 新照片先压缩上传（离线也行：进写队列，联网后自动传）；传好的换成 path，失败重试时不会再传一次
    const photos = [];
    for (const p of f.photos) {
      if (p.path) {
        photos.push(p);
        continue;
      }
      const up = await store.upload('reviews', p.file);
      const done = { ...p, path: up.path, width: up.width ?? null, height: up.height ?? null, taken_at: up.takenAt ?? null, file: null };
      photos.push(done);
      session.form.value = { ...session.form.peek(), photos: session.form.peek().photos.map((x) => (x.key === p.key ? done : x)) };
    }
    const existing = mine;
    const visitedAt = existing?.visited_at ? null : visitedAtFor({ item, day, timeZone: tz, ongoing, now: now(), toInstant: zonedToInstant });
    const patch = buildPatch(session.form.peek(), { photos, itemId: session.itemId, visitedAt, existing });
    const r = store.saveReview(session.placeId, patch);
    await r.saved;
    // 从评级里去掉的旧照片：文件也删掉（只会是自己目录里的）
    const kept = new Set(photos.map((p) => p.path));
    const removed = (existing?.photos || []).map((p) => p?.path).filter((p) => p && !kept.has(p));
    if (removed.length) {
      try {
        data.files.remove(store.tripId, removed);
      } catch {
        /* 删文件失败不影响评级本身 */
      }
    }
    session.error.value = '';
    session.initialKey.value = formKey(session.form.peek());
    haptic('success');
  };

  return (
    <div class="rv-foot">
      {errorText && <p class="rv-foot__error" role="alert" data-testid="review-error">{errorText}</p>}
      {empty && <p class="rv-foot__hint">{editing ? '什么都没写了：要删掉这条评级，点上面的「删除我的评级」' : '选个档位，或者写两句再保存'}</p>}
      <SubmitButton
        block
        label={label}
        loadingLabel="正在保存"
        successLabel="已保存"
        errorMessage={errorText || '没有保存成功，请重试'}
        disabled={!form || empty}
        action={save}
        onError={(e) => {
          if (!session.error.peek()) session.error.value = e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有保存成功，请重试';
        }}
        onSuccess={() => finish(session)}
        resetAfter={false}
        data-testid="review-save"
      />
    </div>
  );
}
