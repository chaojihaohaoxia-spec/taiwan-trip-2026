// =====================================================================
// sheets/trip-new/TripNewSheet.jsx：弹层「trip-new」——新建行程（一屏建好，批 A · 三）。
//
// 打开：sheets/index.js 的 openTripNewSheet({ keyboard: true, trigger })（行程列表、行程切换面板的「新建行程」）。
//
//   去哪          搜城市（自动聚焦；中文、英文、当地名、别名，去过的排前面）；没打字时一排「常用」（去过的在前）；
//                 可以再加城市（最多 5 个）；城市表里没有 → 按国家建（城市名用打的字）。选好下面一行灰字档案预览：
//                 「越南盾 · 比香港慢 1 小时 · 叫车用 Grab · 插座要转换头」
//   什么时候      日历（RangeCalendar）：点出发、点回来；只点出发默认 4 天。几个城市时下面「每个城市住几晚」（加减一晚，总晚数不变）
//   这趟怎么走    芯片（打车为主 · 公交为主 · 自驾 · 骑车 · 走路为主），按城市默认亮一个；点过才写进档案
//   名字          按城市和月份自动起（「富国岛 · 10 月」），改了就不再跟着变
//   和 Cathy 一起（默认勾）；从上一趟带行李清单（默认勾，只在上一趟有打包项时出现）
//   更多          时区、当地币种（一般不用动）
// 提交：「建好」→ data.rpc.createTripV2（token 打开面板时生成一次，内容没变的重试用同一个，服务器不会建两趟；
//       失败以后改了表单再点，换一个 token，不然会把上次其实建成了的那趟原样还回来）→ 对勾 → 进第一天。
// 离线：按钮禁用，写「要联网才能建」；面板里填的东西留着。
// 草稿：填了一半关掉面板，存在这台设备上（localStorage，按账号分开，留 14 天），下次打开接着填，顶上一行「接着上次没填完的 · 重新填」；
//       建好了清掉。存不了（无痕模式）时关面板前先问一句。
// =====================================================================

import './trip-new.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { data, useMyTrips, useTrip, online, authState } from '../../data/index.js';
import { newId } from '../../data/util.js';
import { navigate } from '../../router/index.js';
import { now } from '../../lib/clock.js';
import { today } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { local } from '../../lib/storage.js';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { previewLine, regionInfo } from '../../rules/dest.js';
import { RangeCalendar } from './RangeCalendar.jsx';
import {
  MOVE_CHOICES, MAX_CITIES, initialTripForm, isTripFormDirty, cityPick, usedCities, quickCities, rankCities, searchRegions, regionPick,
  primaryCity, rangeText, rangeDays, splitNights, shiftNights, fitNights, cityDates, zhDay, moveFor, moveHint, titleOf, zoneForCity,
  profileForForm, starterTodoTitles, validateTripForm, tripFormToInput, packingCandidates, partnerOf, zoneSummary, searchZones,
  canonicalZone, currencyOptions, currencyLabel, draftOf, restoreDraft, submitKey,
} from './model.js';

const MIN_LOADING = 480;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function shake(el) {
  if (!el) return;
  animateSpring(el, {
    channel: 'trip-new-shake',
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

/** 浏览器支持的全部时区（「更多」里搜时区用） */
function allZones() {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

/**
 * 行李清单从哪趟带：最近出发的那趟；那趟一项打包都没有就看再早一趟（最多 3 趟）。顺便从那趟的成员里认出对方是谁。
 * @returns {{ tripId: string|null, title: string, count: number|null, partner: string|null }}
 */
function usePackingSource(entries, start) {
  const ids = packingCandidates(entries, start);
  const key = ids.join('|');
  const [skip, setSkip] = useState(0);
  useEffect(() => setSkip(0), [key]);
  const id = ids[skip] || null;
  const store = useTrip(id);
  const trip = store?.trip.value || null;
  const todos = trip ? store.tables.todos.value : null;
  const count = todos ? [...todos.values()].filter((t) => t.list === 'packing').length : null;
  useEffect(() => {
    if (count === 0 && skip < ids.length - 1) setSkip((s) => s + 1);
  }, [count, skip, key]);
  const members = trip ? store.view.members.value : [];
  return { tripId: id, title: trip?.title || '', count, partner: partnerOf(members, authState.value.user?.id || null) };
}

/** 草稿存在哪（按账号分开：同一台设备换了账号不串） */
const draftKey = () => `trip-new-draft:${authState.value.user?.id || 'anon'}`;

/** 打开面板时的表单：有草稿接着填，没有就是空的 */
function startForm() {
  const f = restoreDraft(local.getJSON(draftKey()), { at: Date.now(), todayDate: today('Asia/Hong_Kong', now()) });
  return f ? { form: f, restored: true } : { form: initialTripForm(), restored: false };
}

export default function TripNewSheet() {
  const [start] = useState(startForm);
  const [form, setForm] = useState(start.form);
  const [restored, setRestored] = useState(start.restored);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState(null);
  const [btn, setBtn] = useState('idle');
  const [failure, setFailure] = useState('');
  const created = useRef(null);
  // 同一张表单重试用同一个 token（请求超时、不知道建没建成时，服务器认得出来，不会建两趟）；
  // 内容变了再点就换一个（sent：上次用这个 token 发出去的内容）
  const token = useRef(newId());
  const sent = useRef(null);
  const refs = { where: useRef(null), when: useRef(null), title: useRef(null), more: useRef(null) };
  const list = useMyTrips();
  const entries = list.entries || [];
  const isOnline = online.value !== false;
  const packing = usePackingSource(entries, form.range.start);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));
    if (error) setError(null);
  };

  // 草稿：表单一变就存（没填什么就删掉）；建好了不再存
  useEffect(() => {
    if (btn === 'success') return;
    const d = draftOf(form);
    setDraftSaved(d ? local.setJSON(draftKey(), d) : (local.remove(draftKey()), false));
  }, [form, btn]);

  const startOver = () => {
    local.remove(draftKey());
    setForm(initialTripForm());
    setRestored(false);
    setError(null);
    sent.current = null;
    token.current = newId();
  };

  const submit = async () => {
    if (btn === 'loading' || btn === 'success') return;
    const problem = validateTripForm(form);
    if (problem) {
      setError(problem);
      const el = refs[problem.field]?.current;
      shake(el);
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      haptic('error');
      return;
    }
    setBtn('loading');
    setFailure('');
    const t0 = performance.now();
    try {
      let input = tripFormToInput(form, { token: token.current, copyFrom: packing.count ? packing.tripId : null });
      const key = submitKey(input);
      if (sent.current !== null && sent.current !== key) {
        token.current = newId();
        input = { ...input, token: token.current };
      }
      sent.current = key;
      const r = await data.rpc.createTripV2(input);
      local.remove(draftKey());
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      created.current = { id: r.tripId, title: input.title, start: input.startDate, partnerMissing: input.withPartner && !r.inHousehold };
      haptic('success');
      setBtn('success');
    } catch (e) {
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      setFailure(e?.kind === 'network' ? '没连上网：连上以后再点一次（不会建成两趟）' : e?.message && /[一-鿿]/.test(e.message) ? e.message : '没建成，再试一次');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  const onCreated = () => {
    const c = created.current;
    if (!c) return;
    if (c.partnerMissing) toast.warning('对方没加进来：在设置里这趟行程下面再拉一下');
    else toast.success(`建好了「${c.title}」`);
    // 直接进第一天（从弹层里换页：弹层那几条历史一起清掉，返回回到弹层底下的页面）
    navigate({ name: 'day', params: { tripId: c.id, date: c.start } }, { scroll: 'top' });
  };

  // 关掉以后：建好了从空表单开始；没建好草稿还在，下次打开接着填
  const reset = () => {
    const next = btn === 'success' ? { form: initialTripForm(), restored: false } : startForm();
    setForm(next.form);
    setRestored(next.restored);
    setError(null);
    setBtn('idle');
    setFailure('');
    created.current = null;
    sent.current = null;
    token.current = newId();
  };

  // 草稿存上了，关掉不会丢：不用再问
  const dirty = btn !== 'success' && isTripFormDirty(form) && !draftSaved;

  return (
    <Sheet
      sheetId="trip-new"
      title="新建行程"
      detents={['large']}
      confirmClose={dirty}
      onClosed={reset}
      testId="sheet-trip-new"
      footer={(
        <div class="tnf-foot">
          {!isOnline && (
            <p class="tnf-foot__note" role="status" data-testid="trip-new-offline">
              <Glyph name="offline" size={15} />
              要联网才能建，填的先留着
            </p>
          )}
          {failure && btn === 'error' && <p class="tnf-foot__error" role="alert" data-testid="trip-new-error">{failure}</p>}
          <SubmitButton
            block
            state={btn}
            label="建好"
            loadingLabel="正在建"
            successLabel="建好了"
            errorLabel="重试"
            errorMessage={failure || '没建成'}
            disabled={!isOnline}
            onClick={submit}
            onSuccess={onCreated}
            data-testid="trip-new-submit"
          />
        </div>
      )}
    >
      {restored && isTripFormDirty(form) && (
        <p class="tnf-draft" role="status" data-testid="trip-new-draft">
          <span>接着上次没填完的</span>
          <button type="button" class="tnf-draft__btn" data-press="scale" onClick={startOver} data-testid="trip-new-draft-clear">重新填</button>
        </p>
      )}
      <TripForm form={form} set={set} error={error} refs={refs} entries={entries} packing={packing} onSubmit={submit} />
    </Sheet>
  );
}

function TripForm({ form, set, error, refs, entries, packing, onSubmit }) {
  const at = now();
  const hkToday = today('Asia/Hong_Kong', at);
  const err = (f) => (error?.field === f ? error.message : '');
  const profile = useMemo(() => profileForForm(form), [form.cities, form.move, form.timezone]);
  const preview = profile ? previewLine(profile) : '';

  return (
    <form class="tnf" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate data-testid="trip-new-form">
      <WhereField form={form} set={set} boxRef={refs.where} error={err('where')} entries={entries} preview={preview} />
      <WhenField form={form} set={set} boxRef={refs.when} error={err('when')} at={at} todayDate={hkToday} />
      {form.cities.length > 0 && <MoveField form={form} set={set} />}
      <TitleField form={form} set={set} boxRef={refs.title} error={err('title')} />
      <div class="tnf-field tnf-checks">
        <Checkbox
          checked={form.withPartner}
          onChange={(v) => set({ withPartner: v })}
          label={packing.partner ? `和 ${packing.partner} 一起` : '两个人一起'}
          description={form.withPartner ? '建好对方就能看到、一起改' : '只有你自己，之后在设置里能拉对方进来'}
          data-testid="trip-new-partner"
        />
        {packing.count > 0 && (
          <Checkbox
            checked={form.copyPacking}
            onChange={(v) => set({ copyPacking: v })}
            label={`带上上一趟的行李清单（${packing.count} 项）`}
            description={`从「${packing.title}」带过来，勾都清掉`}
            data-testid="trip-new-packing"
          />
        )}
      </div>
      {form.cities.length > 0 && <StarterLine form={form} profile={profile} />}
      <MoreField form={form} set={set} boxRef={refs.more} error={err('more')} at={at} profile={profile} />
    </form>
  );
}

// ---------------------------------------------------------------------
// 去哪
// ---------------------------------------------------------------------

function WhereField({ form, set, boxRef, error, entries, preview }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(true);
  const inputRef = useRef(null);
  const used = useMemo(() => usedCities(entries), [entries]);
  const chosen = form.cities.map((c) => c.id).filter(Boolean);
  const results = useMemo(() => (q.trim() ? rankCities(q, used, { exclude: chosen }) : []), [q, used, chosen.join()]);
  const quick = useMemo(() => quickCities(entries, { exclude: chosen }), [entries, chosen.join()]);
  const regions = useMemo(() => (q.trim() && !results.length ? searchRegions(q) : []), [q, results.length]);
  const showSearch = adding || !form.cities.length;
  const full = form.cities.length >= MAX_CITIES;

  const add = (city) => {
    haptic('selection');
    set((f) => {
      const cities = [...f.cities, city];
      const patch = { cities };
      if (f.cities.length === 0) {
        if (!f.zoneTouched) patch.timezone = zoneForCity(city);
        if (!f.currencyTouched) patch.currency = regionInfo(city.r)?.cur || '';
      }
      return patch;
    });
    setQ('');
    setAdding(false);
  };
  const remove = (i) => {
    set((f) => {
      const cities = f.cities.filter((_, k) => k !== i);
      const patch = { cities };
      if (i === 0 && cities[0]) {
        if (!f.zoneTouched) patch.timezone = zoneForCity(cities[0]);
        if (!f.currencyTouched) patch.currency = regionInfo(cities[0].r)?.cur || '';
      }
      return patch;
    });
    if (form.cities.length <= 1) {
      setAdding(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (results[0]) add(cityPick(results[0]));
    } else if (e.key === 'Escape' && q) {
      e.stopPropagation();
      setQ('');
    }
  };

  return (
    <div class="tnf-field" ref={boxRef} data-error={error ? '' : undefined} data-testid="trip-new-where">
      <span class="tnf-label" id="tnf-where-label">去哪</span>
      {form.cities.length > 0 && (
        <ul class="tnf-cities" aria-labelledby="tnf-where-label" data-testid="trip-new-cities">
          {form.cities.map((c, i) => (
            <li key={`${c.id || c.zh}-${i}`} class="tnf-city">
              <span class="tnf-city__name">{c.zh}</span>
              <span class="tnf-city__sub">{c.custom ? `${regionInfo(c.r)?.zh || c.r} · 按国家建` : regionInfo(c.r)?.zh}</span>
              <button type="button" class="tnf-city__x" aria-label={`去掉${c.zh}`} data-press="scale" onClick={() => remove(i)} data-testid={`trip-new-city-x-${i}`}>
                <Glyph name="x" size={16} stroke={2.2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {showSearch ? (
        <div class="tnf-search">
          <span class="tnf-search__icon" aria-hidden="true"><Glyph name="search" size={18} /></span>
          <input
            ref={inputRef}
            class="tnf-input tnf-input--search"
            type="search"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder={form.cities.length ? '再加一个城市' : '城市名：东京、垦丁、Bangkok'}
            aria-label={form.cities.length ? '再加一个城市' : '去哪'}
            aria-describedby="tnf-where-hint"
            autoComplete="off"
            enterKeyHint="search"
            data-autofocus={form.cities.length ? undefined : ''}
            data-testid="trip-new-city-search"
          />
        </div>
      ) : !full && (
        <button type="button" class="tnf-more-city" data-press="highlight" onClick={() => { setAdding(true); requestAnimationFrame(() => inputRef.current?.focus()); }} data-testid="trip-new-add-city">
          <Glyph name="plus" size={16} stroke={2.2} />
          再加一个城市
        </button>
      )}
      {showSearch && q.trim() && (
        <ul class="tnf-zlist" data-testid="trip-new-city-results">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" class="tnf-zrow" data-press="highlight" onClick={() => add(cityPick(c))} data-testid={`trip-new-city-${c.id}`}>
                <span class="tnf-zrow__name">{c.zh}{used.includes(c.id) && <i class="tnf-zrow__tag">去过</i>}</span>
                <span class="tnf-zrow__sub">{[c.regionZh, c.local !== c.zh ? c.local : c.en].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
          {!results.length && (
            <>
              <li class="tnf-zempty">城市表里没有「{q.trim()}」，选国家也能建：</li>
              {regions.map((r) => (
                <li key={r.code}>
                  <button type="button" class="tnf-zrow" data-press="highlight" onClick={() => add(regionPick(r.code, q))} data-testid={`trip-new-region-${r.code}`}>
                    <span class="tnf-zrow__name">{r.zh}</span>
                    <span class="tnf-zrow__sub">{`「${q.trim()}」按${r.zh}的习惯带`}</span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
      {showSearch && !q.trim() && quick.length > 0 && !full && (
        <div class="tnf-chips" role="group" aria-label="常用" data-testid="trip-new-quick">
          {quick.map((c) => (
            <Chip key={c.id} onClick={() => add(cityPick(c))} data-testid={`trip-new-quick-${c.id}`}>{c.zh}</Chip>
          ))}
        </div>
      )}
      <p class="tnf-hint" id="tnf-where-hint" data-testid="trip-new-preview">
        {error || preview || (form.cities.length || q.trim() ? '' : '去过的城市排在前面')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// 什么时候
// ---------------------------------------------------------------------

function WhenField({ form, set, boxRef, error, at, todayDate }) {
  const [tooLong, setTooLong] = useState(false);
  const tz = form.timezone || 'Asia/Hong_Kong';
  const text = rangeText(form.range, at, tz);
  const n = form.cities.length;
  const total = Math.max(0, rangeDays(form.range) - 1);
  const nights = n > 1 ? fitNights(form.nights, total, n) : [];
  const dates = n > 1 && form.range.start ? cityDates(form.range, nights) : [];
  const enough = n < 2 || total >= n - 1;
  return (
    <div class="tnf-field" ref={boxRef} data-error={error ? '' : undefined}>
      <span class="tnf-label" id="tnf-when-label">什么时候</span>
      <RangeCalendar
        range={form.range}
        today={todayDate}
        onPick={(range) => { setTooLong(false); set({ range, nights: n > 1 ? splitNights(Math.max(0, rangeDays(range) - 1), n) : [] }); }}
        onTooLong={() => { setTooLong(true); shake(boxRef.current); }}
        testId="trip-new-cal"
      />
      <div class="tnf-when" aria-live="polite" data-testid="trip-new-length">
        {text.main && <b class="tnf-when__main">{text.main}</b>}
        <span class="tnf-when__sub">{error || (tooLong ? '一趟最多 60 天' : text.sub)}</span>
      </div>
      {n > 1 && form.range.start && enough && (
        <ul class="tnf-nights" aria-label="每个城市住几晚" data-testid="trip-new-nights">
          {form.cities.map((c, i) => (
            <li key={`${c.id || c.zh}-${i}`} class="tnf-night">
              <span class="tnf-night__text">
                <b>{c.zh}</b>
                <span>{dates[i] ? (dates[i].start === dates[i].end ? zhDay(dates[i].start) : `${zhDay(dates[i].start)} – ${zhDay(dates[i].end).split(' ')[0]}`) : ''}</span>
              </span>
              <span class="tnf-night__step">
                <button type="button" class="tnf-step" aria-label={`${c.zh}少住一晚`} data-press="scale" disabled={shiftNights(nights, i, -1) === nights}
                  onClick={() => set({ nights: shiftNights(nights, i, -1) })} data-testid={`trip-new-night-minus-${i}`}>
                  <Glyph name="minus" size={16} stroke={2.2} />
                </button>
                <span class="tnf-night__n" data-testid={`trip-new-night-${i}`}>{nights[i]} 晚</span>
                <button type="button" class="tnf-step" aria-label={`${c.zh}多住一晚`} data-press="scale" disabled={shiftNights(nights, i, 1) === nights}
                  onClick={() => set({ nights: shiftNights(nights, i, 1) })} data-testid={`trip-new-night-plus-${i}`}>
                  <Glyph name="plus" size={16} stroke={2.2} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 这趟怎么走、名字、顺带的待办
// ---------------------------------------------------------------------

function MoveField({ form, set }) {
  const current = moveFor(form);
  const hint = moveHint(form);
  return (
    <div class="tnf-field">
      <span class="tnf-label" id="tnf-move-label">这趟怎么走</span>
      <div class="tnf-chips" role="group" aria-labelledby="tnf-move-label" data-testid="trip-new-move">
        {MOVE_CHOICES.map((m) => (
          <Chip key={m.id} selected={current === m.id} onToggle={() => { haptic('selection'); set({ move: m.id }); }} data-testid={`trip-new-move-${m.id}`}>
            {m.label}
          </Chip>
        ))}
      </div>
      <p class="tnf-hint" data-testid="trip-new-move-hint">{hint}</p>
    </div>
  );
}

function TitleField({ form, set, boxRef, error }) {
  const value = titleOf(form);
  return (
    <div class="tnf-field" ref={boxRef} data-error={error ? '' : undefined}>
      <label class="tnf-label" for="tnf-title">名字</label>
      <input
        id="tnf-title"
        class="tnf-input tnf-input--title"
        value={value}
        onInput={(e) => set({ title: e.currentTarget.value, titleTouched: true })}
        placeholder="选了城市和日期会自动起"
        maxLength={60}
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby="tnf-title-hint"
        data-testid="trip-new-title"
      />
      <p class="tnf-hint" id="tnf-title-hint">{error || '「 · 」前面当大标题，后面放在日期旁边'}</p>
    </div>
  );
}

function StarterLine({ form, profile }) {
  const c = primaryCity(form);
  const local = (form.currency || profile?.cur || '').toUpperCase();
  const titles = starterTodoTitles(c?.r, local);
  if (!titles.length) return null;
  return (
    <p class="tnf-fine" data-testid="trip-new-starter">
      顺带加 {titles.length} 条出发前待办：{titles.join('、')}
    </p>
  );
}

// ---------------------------------------------------------------------
// 更多：时区、当地币种
// ---------------------------------------------------------------------

function MoreField({ form, set, boxRef, error, at, profile }) {
  const [open, setOpen] = useState(Boolean(error));
  const [zq, setZq] = useState('');
  const [other, setOther] = useState(false);
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);
  const zones = useMemo(() => (zq.trim() ? searchZones(zq, allZones()) : []), [zq]);
  const local = (profile?.cur || '').toUpperCase();
  const options = currencyOptions(local || form.currency);
  const tz = form.timezone;
  const summary = [tz ? zoneSummary(tz, at).split(' · ').slice(0, 2).join(' ') : '', form.currency ? currencyLabel(form.currency) : '', '汇总按港币']
    .filter(Boolean).join(' · ');
  return (
    <div class="tnf-field tnf-moref" ref={boxRef} data-error={error ? '' : undefined}>
      <button type="button" class="tnf-more" aria-expanded={open ? 'true' : 'false'} data-press="highlight" onClick={() => setOpen((o) => !o)} data-testid="trip-new-more">
        <span class="tnf-more__text">
          <b>时区和币种</b>
          <span>{form.cities.length ? summary : '选了城市会自动带'}</span>
        </span>
        <Glyph name={open ? 'chev-u' : 'chev-d'} size={18} stroke={2.2} />
      </button>
      {open && (
        <div class="tnf-more__body">
          <span class="tnf-label">时区</span>
          <p class="tnf-hint" data-testid="trip-new-zone-summary">{tz ? zoneSummary(tz, at) : '还没选城市'}</p>
          <input
            class="tnf-input"
            type="search"
            value={zq}
            onInput={(e) => setZq(e.currentTarget.value)}
            placeholder="换时区：搜城市或国家"
            aria-label="搜索时区"
            autoComplete="off"
            enterKeyHint="search"
            data-testid="trip-new-zone-search"
          />
          {zq.trim() && (
            <ul class="tnf-zlist" data-testid="trip-new-zone-results">
              {zones.length ? zones.map((z) => (
                <li key={z}>
                  <button type="button" class="tnf-zrow" data-press="highlight" aria-pressed={tz === z ? 'true' : 'false'}
                    onClick={() => { set({ timezone: canonicalZone(z), zoneTouched: true }); setZq(''); }}>
                    <span class="tnf-zrow__name">{zoneSummary(z, at).split(' · ')[0]}</span>
                    <span class="tnf-zrow__sub">{zoneSummary(z, at).split(' · ').slice(1).join(' · ')}</span>
                  </button>
                </li>
              )) : <li class="tnf-zempty">没有找到「{zq.trim()}」，换个写法试试</li>}
            </ul>
          )}
          <span class="tnf-label" id="tnf-cur-label">当地币种</span>
          <div class="tnf-chips" role="group" aria-labelledby="tnf-cur-label" data-testid="trip-new-currencies">
            {options.map((c) => (
              <Chip key={c} selected={form.currency === c && !other} onToggle={() => { setOther(false); haptic('selection'); set({ currency: c, currencyTouched: true }); }} data-testid={`trip-new-cur-${c}`}>
                {currencyLabel(c)}
              </Chip>
            ))}
            <Chip selected={other} onToggle={() => setOther((o) => !o)} data-testid="trip-new-cur-other">其他</Chip>
          </div>
          {other && (
            <input
              class="tnf-input tnf-input--code"
              value={form.currency}
              onInput={(e) => set({ currency: e.currentTarget.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3), currencyTouched: true })}
              placeholder="三位代码，例如 MYR"
              aria-label="币种代码"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={3}
              data-testid="trip-new-cur-code"
            />
          )}
          <p class="tnf-hint">{error || '记一笔默认用当地币种，自动折合港币'}</p>
        </div>
      )}
    </div>
  );
}
