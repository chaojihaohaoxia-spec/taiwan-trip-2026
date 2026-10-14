// =====================================================================
// sheets/trip-new/TripNewSheet.jsx：弹层「trip-new」——新建行程（SPEC §5.1）。
//
// 打开：sheets/index.js 的 openTripNewSheet({ keyboard: true, trigger })（行程列表、行程切换面板的「新建行程」）。
//
//   最上面一张小预览：封面（主题色渐变 + emoji）+ 名字 + 日期，跟着下面的选择实时变；
//   名字（自动聚焦；「 · 」前半段会当大标题）；
//   日期：出发 / 回来（系统日期选择器；选了出发、没选回来时默认 4 天 3 晚），下面「4 天 3 晚 · 12 天后出发」；可以先不填（日期未定）；
//   时区：常用的几个芯片（越南、台湾、日本……）+「其他」搜索（中文地名、英文城市名都能搜），下面「越南 · UTC+7 · 比香港慢 1 小时」；
//   当地币种：芯片（选时区时自动带出推荐的币种，自己改过就不再跟着变）+「其他」三位代码；本币固定港币；
//   封面：8 个主题色色块 + 10 个 emoji。
// 提交：SubmitButton 受控：先校验（不通过：那一项摇一下、说原因，不转圈）→ data.rpc.createTrip（要联网；id 按名字和年份自动起，
//       撞了别人的 id 自动换下一个，最多试 4 次）→ 对勾 → 进新行程的概览（弹层的历史一起清掉，返回回到行程列表）。
// 离线：提交按钮禁用，说明「新建行程要联网」。填了一半关面板先问「放弃未保存的内容？」。
// =====================================================================

import './trip-new.css';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { CoverDot } from '../../shell/CoverDot.jsx';
import { data, useMyTrips, online } from '../../data/index.js';
import { navigate } from '../../router/index.js';
import { now } from '../../lib/clock.js';
import { haptic } from '../../lib/native.js';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { dateRangeLabel } from '../../shell/format.js';
import {
  ZONE_PRESETS, currencyOptions, COVER_PRESETS, EMOJI_PRESETS, initialTripForm, validateTripForm, tripFormToInput, nextTripId,
  isIdConflict, isTripFormDirty, currencyForZone, currencyLabel, zoneSummary, zoneName, searchZones, canonicalZone, adjustEndDate,
  formLengthLabel, startHint, presetStyle, coverFromForm,
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

/** 浏览器支持的全部时区（搜索用） */
function allZones() {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

export default function TripNewSheet() {
  const [form, setForm] = useState(initialTripForm);
  const [error, setError] = useState(null);
  const [btn, setBtn] = useState('idle');
  const [failure, setFailure] = useState('');
  const created = useRef(null);
  const refs = { title: useRef(null), dates: useRef(null), timezone: useRef(null), currency: useRef(null) };
  const list = useMyTrips();
  const isOnline = online.value !== false;

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    if (error) setError(null);
  };

  const submit = async () => {
    if (btn === 'loading' || btn === 'success') return;
    const problem = validateTripForm(form);
    if (problem) {
      setError(problem);
      const el = refs[problem.field]?.current;
      shake(el);
      el?.querySelector('input')?.focus({ preventScroll: false });
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBtn('loading');
    setFailure('');
    const t0 = performance.now();
    try {
      const taken = (list.entries || []).map((e) => e.id);
      const input = tripFormToInput(form, taken);
      let id = input.id;
      let tripId = null;
      for (let n = 1; n <= 4 && !tripId; n++) {
        try {
          tripId = await data.rpc.createTrip({ ...input, id });
        } catch (e) {
          if (!isIdConflict(e) || n === 4) throw e;
          id = nextTripId(input.id, n);
        }
      }
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      created.current = { id: tripId || id, title: input.title };
      haptic('success');
      setBtn('success');
    } catch (e) {
      const left = MIN_LOADING - (performance.now() - t0);
      if (left > 0) await wait(left);
      setFailure(e?.kind === 'network' ? '新建行程要联网：连上网络后再点一次' : e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有建成，请再试一次');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  const onCreated = () => {
    const c = created.current;
    if (!c) return;
    toast.success(`已新建「${c.title}」`);
    // 从弹层里去别的页面：弹层那几条历史一起清掉，返回回到弹层底下的页面（行程列表）
    navigate({ name: 'trip', params: { tripId: c.id } }, { scroll: 'top' });
  };

  const reset = () => {
    setForm(initialTripForm());
    setError(null);
    setBtn('idle');
    setFailure('');
    created.current = null;
  };

  const dirty = btn !== 'success' && isTripFormDirty(form);

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
              <Glyph name="alert" size={15} />
              新建行程要联网，现在没有网络
            </p>
          )}
          {failure && btn === 'error' && <p class="tnf-foot__error" role="alert" data-testid="trip-new-error">{failure}</p>}
          <SubmitButton
            block
            state={btn}
            label="创建行程"
            loadingLabel="正在创建"
            successLabel="已创建"
            errorLabel="重试"
            errorMessage={failure || '没有建成'}
            disabled={!isOnline}
            onClick={submit}
            onSuccess={onCreated}
            data-testid="trip-new-submit"
          />
        </div>
      )}
    >
      <TripForm form={form} set={set} error={error} refs={refs} onSubmit={submit} />
    </Sheet>
  );
}

function TripForm({ form, set, error, refs, onSubmit }) {
  const at = now();
  const preset = COVER_PRESETS.find((p) => p.key === form.cover) || COVER_PRESETS[0];
  const coverTrip = useMemo(() => ({ cover: coverFromForm(form) }), [form.cover, form.emoji]);
  const length = formLengthLabel(form);
  const hint = startHint(form, at);
  const dates = form.startDate ? dateRangeLabel(form.startDate, form.endDate || form.startDate) : '日期未定';
  const err = (f) => (error?.field === f ? error.message : '');

  const pickZone = (tz) => {
    const zone = canonicalZone(tz);
    const patch = { timezone: zone };
    const cur = currencyForZone(zone);
    if (cur && !form.currencyTouched) patch.currency = cur;
    haptic('selection');
    set(patch);
  };

  return (
    <form class="tnf" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate data-testid="trip-new-form">
      {/* 预览：跟着下面的选择实时变 */}
      <div class="tnf-preview material-card accent-scope" style={presetStyle(preset)} aria-hidden="true" data-testid="trip-new-preview">
        <span class="tnf-preview__cover"><CoverDot trip={coverTrip} shape="tile" /></span>
        <span class="tnf-preview__text">
          <b>{form.title.trim() || '给这趟旅行起个名字'}</b>
          <span>{[dates, length].filter(Boolean).join(' · ')}</span>
        </span>
      </div>

      <div class="tnf-field" ref={refs.title} data-error={err('title') ? '' : undefined}>
        <label class="tnf-label" for="tnf-title">名字</label>
        <input
          id="tnf-title"
          class="tnf-input tnf-input--title"
          value={form.title}
          onInput={(e) => set({ title: e.currentTarget.value })}
          placeholder="例如：富国岛 · 重阳三晚"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="next"
          aria-invalid={err('title') ? 'true' : undefined}
          aria-describedby="tnf-title-hint"
          data-autofocus=""
          data-testid="trip-new-title"
        />
        <p class="tnf-hint" id="tnf-title-hint">{err('title') || '用「 · 」隔开：前半段当大标题，后半段放在日期旁边'}</p>
      </div>

      <div class="tnf-field" ref={refs.dates} data-error={err('dates') ? '' : undefined}>
        <span class="tnf-label" id="tnf-dates-label">日期</span>
        <div class="tnf-dates" role="group" aria-labelledby="tnf-dates-label">
          <label class="tnf-date">
            <span>出发</span>
            {!form.startDate && <i class="tnf-date__ph" aria-hidden="true">选日期</i>}
            <input
              type="date"
              class="tnf-input tnf-input--date"
              value={form.startDate}
              data-empty={form.startDate ? undefined : ''}
              onInput={(e) => {
                const v = e.currentTarget.value;
                set({ startDate: v, endDate: v ? adjustEndDate(v, form.endDate) : form.endDate });
              }}
              data-testid="trip-new-start"
            />
          </label>
          <span class="tnf-dates__arrow" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
          <label class="tnf-date">
            <span>回来</span>
            {!form.endDate && <i class="tnf-date__ph" aria-hidden="true">选日期</i>}
            <input
              type="date"
              class="tnf-input tnf-input--date"
              value={form.endDate}
              data-empty={form.endDate ? undefined : ''}
              min={form.startDate || undefined}
              onInput={(e) => set({ endDate: e.currentTarget.value })}
              data-testid="trip-new-end"
            />
          </label>
        </div>
        <p class="tnf-hint" data-testid="trip-new-length">
          {err('dates') || (length ? [length, hint].filter(Boolean).join(' · ') : '还没定也可以先空着，之后在行程里补上')}
        </p>
      </div>

      <ZoneField form={form} pickZone={pickZone} boxRef={refs.timezone} error={err('timezone')} at={at} />

      <CurrencyField form={form} set={set} boxRef={refs.currency} error={err('currency')} />

      <div class="tnf-field">
        <span class="tnf-label" id="tnf-cover-label">封面</span>
        <div class="tnf-swatches" role="radiogroup" aria-labelledby="tnf-cover-label" data-testid="trip-new-colors">
          {COVER_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={form.cover === p.key ? 'true' : 'false'}
              aria-label={p.label}
              class="tnf-swatch accent-scope"
              style={presetStyle(p)}
              data-press="scale"
              onClick={() => { haptic('selection'); set({ cover: p.key }); }}
              data-testid={`trip-new-color-${p.key}`}
            >
              <span class="tnf-swatch__fill" aria-hidden="true" />
              {form.cover === p.key && <span class="tnf-swatch__check" aria-hidden="true"><Glyph name="check" size={16} stroke={2.6} /></span>}
            </button>
          ))}
        </div>
        <div class="tnf-emojis" role="radiogroup" aria-label="封面图标" data-testid="trip-new-emojis">
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={form.emoji === e ? 'true' : 'false'}
              aria-label={`封面图标 ${e}`}
              class="tnf-emoji"
              data-press="scale"
              onClick={() => { haptic('selection'); set({ emoji: e }); }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <p class="tnf-fine">建好以后你是这趟行程的创建者，可以在「设置 → 成员和邀请」邀请对方加入。</p>
    </form>
  );
}

function ZoneField({ form, pickZone, boxRef, error, at }) {
  const preset = ZONE_PRESETS.some((z) => z.tz === form.timezone);
  const [searching, setSearching] = useState(!preset);
  const [q, setQ] = useState('');
  const zones = useMemo(() => (searching ? searchZones(q, allZones()) : []), [searching, q]);
  return (
    <div class="tnf-field" ref={boxRef} data-error={error ? '' : undefined}>
      <span class="tnf-label" id="tnf-zone-label">时区</span>
      <div class="tnf-chips" role="group" aria-labelledby="tnf-zone-label" data-testid="trip-new-zones">
        {ZONE_PRESETS.map((z) => (
          <Chip
            key={z.tz}
            selected={form.timezone === z.tz}
            onToggle={() => { setSearching(false); pickZone(z.tz); }}
            data-testid={`trip-new-zone-${z.tz.split('/').pop()}`}
          >
            {z.label}
          </Chip>
        ))}
        <Chip
          selected={searching || !preset}
          onToggle={() => setSearching((s) => !s || !preset)}
          aria-expanded={searching ? 'true' : 'false'}
          data-testid="trip-new-zone-other"
        >
          {preset ? '其他' : zoneName(form.timezone)}
        </Chip>
      </div>
      {searching && (
        <div class="tnf-zsearch">
          <input
            class="tnf-input"
            type="search"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            placeholder="搜城市或国家：胡志明、大阪、巴黎、Tokyo"
            aria-label="搜索时区"
            autoComplete="off"
            enterKeyHint="search"
            data-testid="trip-new-zone-search"
          />
          {q.trim() && (
            <ul class="tnf-zlist" data-testid="trip-new-zone-results">
              {zones.length ? zones.map((tz) => (
                <li key={tz}>
                  <button type="button" class="tnf-zrow" data-press="highlight" aria-pressed={form.timezone === tz ? 'true' : 'false'} onClick={() => pickZone(tz)}>
                    <span class="tnf-zrow__name">{zoneName(tz)}</span>
                    <span class="tnf-zrow__sub">{zoneSummary(tz, at).split(' · ').slice(1).join(' · ')}</span>
                    {form.timezone === tz && <Glyph name="check" size={18} stroke={2.4} />}
                  </button>
                </li>
              )) : <li class="tnf-zempty">没有找到「{q.trim()}」，换个写法试试（中文地名或英文城市名）</li>}
            </ul>
          )}
        </div>
      )}
      <p class="tnf-hint" data-testid="trip-new-zone-summary">{error || zoneSummary(form.timezone, at)}</p>
    </div>
  );
}

function CurrencyField({ form, set, boxRef, error }) {
  const options = currencyOptions(form.timezone);
  const custom = Boolean(form.currency) && !options.includes(form.currency);
  const [other, setOther] = useState(custom);
  return (
    <div class="tnf-field" ref={boxRef} data-error={error ? '' : undefined}>
      <span class="tnf-label" id="tnf-cur-label">当地币种</span>
      <div class="tnf-chips" role="group" aria-labelledby="tnf-cur-label" data-testid="trip-new-currencies">
        {options.map((c) => (
          <Chip
            key={c}
            selected={form.currency === c && !other}
            onToggle={() => { setOther(false); haptic('selection'); set({ currency: c, currencyTouched: true }); }}
            data-testid={`trip-new-cur-${c}`}
          >
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
      <p class="tnf-hint">{error || `记一笔默认用${currencyLabel(form.currency) || '当地币种'}，外币自动折合港币；本币是港币`}</p>
    </div>
  );
}
