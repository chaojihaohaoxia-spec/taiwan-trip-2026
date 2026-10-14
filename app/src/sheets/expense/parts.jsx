// =====================================================================
// sheets/expense/parts.jsx：记一笔表单的几块（金额块在 AmountField.jsx）。
//
//   <CategoryChips value onChange />                 分类胶囊（餐饮 / 交通 / 住宿 / 购物 / 门票 / 活动 / 其他，带种类图标）
//   <PayerSegment sharers value onChange myId />     谁付（Jeremy / Cathy 分段，名字后面标「我」）
//   <SplitSection state ctx onChange mismatch />      平摊 / 个人 / 按金额 + 每人多少 / 算谁的 / 各人金额
//   <WhenRow state onChange trip />                   日期 + 时间（原生控件），旁边标「D2 · 周一」
//   <LinkRow state onChange items />                  关联条目（那天的时间轴条目）
//   <ReceiptField path onPick onRemove uploading />   小票照片（拍 / 选 → 上传，缩略图）
//   shakeElement(el)                                   输入不对时左右摇一下（和 SubmitButton 同一组参数）
// =====================================================================

import { useMemo } from 'preact/hooks';
import { Chip } from '../../ui/Chip.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PersonChip } from '../../kit/Chips.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { useSignedUrl } from '../../data/index.js';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { prefersReducedMotion } from '../../motion/reduced-motion.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { formatAmount, formatMoney, normalizeCurrency, currencyMinorUnits } from '../../lib/money.js';
import { formatDate, formatItemTime, tripDayNumber, weekdayName, timeZoneLabel } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { CATEGORIES, formatAmountInput, autoShares, perPerson as perPersonOf } from './form-model.js';

/** 输入不对：左右摇一下（参数同 ui/shake.js） */
export function shakeElement(el) {
  if (!el || prefersReducedMotion.value) return;
  animateSpring(el, {
    channel: 'xf-shake',
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

/** 分类胶囊 */
export function CategoryChips({ value, onChange, disabled = false }) {
  return (
    <div class="xf-cats" role="group" aria-label="分类" data-testid="xf-cats">
      {CATEGORIES.map((c) => (
        <Chip
          key={c}
          selected={value === c}
          disabled={disabled}
          icon={<Glyph name={kindGlyph('expense', c)} size={16} />}
          data-testid={`xf-cat-${c}`}
          onToggle={() => {
            haptic('selection');
            onChange(c);
          }}
        >
          {c}
        </Chip>
      ))}
    </div>
  );
}

/** 谁付 */
export function PayerSegment({ sharers, value, onChange, myId, disabled = false }) {
  const options = useMemo(() => sharers.map((s) => ({ value: s.user_id, label: s.user_id === myId ? `${s.name}（我）` : s.name })), [sharers, myId]);
  if (options.length <= 1) {
    const only = sharers[0];
    return <p class="xf-split__note" data-testid="xf-payer-only">{only ? `${only.name} 付` : '—'}</p>;
  }
  return (
    <SegmentedControl
      label="谁付"
      options={options}
      value={value}
      disabled={disabled}
      onChange={(v) => {
        haptic('selection');
        onChange(v);
      }}
      data-testid="xf-payer"
    />
  );
}

const SPLIT_OPTIONS = Object.freeze([
  { value: 'equal', label: '平摊' },
  { value: 'personal', label: '个人' },
  { value: 'amounts', label: '按金额' },
]);

/**
 * 分摊：平摊（每人多少）/ 个人（算谁的）/ 按金额（各人输入；没动过的人自动补上剩下的；对不上时红字说明差多少）。
 * @param {{ state: object, ctx: { sharers: Array<{ user_id, name, color }> }, onChange: (patch: object) => void,
 *           mismatch: number, disabled?: boolean, errorId?: string }} props
 *   mismatch：selectors.splitMismatch 的结果（最小单位整数，正 = 少了、负 = 多了）
 */
export function SplitSection({ state, ctx, onChange, mismatch, disabled = false, errorId, rate = null, home = 'HKD' }) {
  const sharers = ctx.sharers || [];
  const currency = normalizeCurrency(state.currency);
  const amount = formatAmountInput(state.amountText, currency).value;
  const per = perPersonOf(state, ctx);
  const ids = sharers.map((s) => s.user_id);
  const shown = state.splitMode === 'amounts' ? autoShares(state.shares || {}, state.touched || {}, amount, ids, currency) : null;
  const canSplit = sharers.length > 1;

  const setMode = (mode) => {
    haptic('selection');
    onChange({ splitMode: mode, splitDirty: true, ...(mode === 'personal' && !state.personalFor ? { personalFor: state.payer } : {}) });
  };

  if (!canSplit) {
    return <p class="xf-split__note" data-testid="xf-split-only">只有你一个人在这趟行程里，不分摊。</p>;
  }

  return (
    <div class="xf__section">
      <SegmentedControl label="怎么分" options={SPLIT_OPTIONS} value={state.splitMode} disabled={disabled} onChange={setMode} data-testid="xf-split" />
      {state.splitMode === 'equal' && (
        <p class="xf-split__note" data-testid="xf-split-equal">
          {/* 每人折合港币用和金额框下面同一个汇率（以前一个按记一笔的汇率、一个按参考汇率，同一个面板两个数，10-14 现场走查 P2-4） */}
          {amount ? `${sharers.length} 人平摊，每人 ${formatMoney(per, currency, { hkdValue: rate && home === 'HKD' && per !== null ? Math.round(per * rate) : null })}` : `${sharers.map((s) => s.name).join('、')} 平摊`}
        </p>
      )}
      {state.splitMode === 'personal' && (
        <div class="xf-for" role="group" aria-label="算谁的" data-testid="xf-for">
          {sharers.map((s) => (
            <Chip
              key={s.user_id}
              size="sm"
              selected={(state.personalFor || state.payer) === s.user_id}
              disabled={disabled}
              data-testid={`xf-for-${s.user_id}`}
              onToggle={() => {
                haptic('selection');
                onChange({ personalFor: s.user_id, splitDirty: true });
              }}
            >
              算 {s.name} 的
            </Chip>
          ))}
        </div>
      )}
      {state.splitMode === 'amounts' && (
        <div class="xf-shares" data-testid="xf-shares">
          {sharers.map((s) => (
            <label key={s.user_id} class="xf-share">
              <PersonChip name={s.name} color={s.color} />
              <input
                class="xf-field xf-field--num xf-share__input"
                type="text"
                inputMode={currency === 'VND' ? 'numeric' : 'decimal'}
                autoComplete="off"
                placeholder="0"
                disabled={disabled}
                aria-label={`${s.name} 承担的金额`}
                aria-invalid={mismatch ? 'true' : undefined}
                aria-describedby={mismatch ? errorId : undefined}
                data-invalid={mismatch ? '' : undefined}
                data-testid={`xf-share-${s.user_id}`}
                value={shown?.[s.user_id] ?? ''}
                onInput={(e) => {
                  const { text } = formatAmountInput(e.currentTarget.value, currency);
                  e.currentTarget.value = text;
                  onChange({
                    shares: { ...(state.shares || {}), [s.user_id]: text },
                    touched: { ...(state.touched || {}), [s.user_id]: true },
                    splitDirty: true,
                  });
                }}
              />
            </label>
          ))}
          {amount ? (
            mismatch ? (
              <p class="xf-split__note" data-tone="danger" id={errorId} role="alert" data-testid="xf-split-mismatch">
                各人加起来比总额{mismatch > 0 ? '少' : '多'}了 {formatAmount(Math.abs(mismatch) / 10 ** currencyMinorUnits(currency), currency)}
              </p>
            ) : (
              <p class="xf-split__note" data-tone="success" data-testid="xf-split-ok">各人加起来正好是总额</p>
            )
          ) : (
            <p class="xf-split__note">先输入总额，没填的人会自动补上剩下的</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 日期 + 时间；旁边标「D2 · 周一」 */
export function WhenRow({ state, onChange, trip, disabled = false, away = null }) {
  const dayNo = state.date && trip?.start_date ? tripDayNumber(state.date, trip.start_date) : null;
  const inTrip = dayNo !== null && dayNo >= 1 && (!trip?.end_date || state.date <= trip.end_date);
  const label = state.date
    ? `${inTrip ? `D${dayNo} · ` : ''}${formatDate(state.date, { timeZone: trip?.timezone, relative: true, weekday: false })} ${weekdayName(state.date)}`
    : '没写日期';
  return (
    <div class="xf__section">
      <span class="xf__label">
        <span>日期和时间</span>
        <span class="xf__label-hint xf-when__day" data-testid="xf-when-label">{label}</span>
      </span>
      <div class="xf-when">
        <input
          class="xf-field"
          type="date"
          value={state.date || ''}
          min={trip?.start_date ? addDaysStr(trip.start_date, -60) : undefined}
          max={trip?.end_date ? addDaysStr(trip.end_date, 60) : undefined}
          disabled={disabled}
          aria-label="日期"
          data-testid="xf-date"
          onChange={(e) => onChange({ date: e.currentTarget.value })}
        />
        <input
          class="xf-field"
          type="time"
          value={state.time || ''}
          disabled={disabled}
          aria-label="时间"
          data-testid="xf-time"
          onChange={(e) => onChange({ time: e.currentTarget.value })}
        />
      </div>
      {away && (
        // 人还在香港（出发当天落地前 / 回程落地后）：账本按行程时区记时间，说一句，免得以为填错了
        <p class="xf-when__zone" data-testid="xf-when-zone">
          <Glyph name="clock" size={13} stroke={2} />
          <span>按{timeZoneLabel(trip?.timezone)}时间记 · {timeZoneLabel(away.zone)}现在 {away.time}</span>
        </p>
      )}
    </div>
  );
}

function addDaysStr(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 关联条目：那一天的时间轴条目（主方案 + 备选），不关联也行。
 * @param {{ state: object, onChange: (patch: object) => void, items: object[], getPlace?: (id: string) => object|null, disabled?: boolean }} props
 */
export function LinkRow({ state, onChange, items, disabled = false }) {
  const list = items || [];
  const current = state.itemId && !list.some((it) => it.id === state.itemId) ? state.itemId : null;
  if (!list.length && !state.itemId) return null;
  return (
    <div class="xf__section">
      <span class="xf__label"><span>关联行程条目</span><span class="xf__label-hint">可不选</span></span>
      <select
        class="xf-field"
        value={state.itemId || ''}
        disabled={disabled}
        aria-label="关联行程条目"
        data-testid="xf-item"
        onChange={(e) => onChange({ itemId: e.currentTarget.value || null })}
      >
        <option value="">不关联</option>
        {current && <option value={current}>（已关联的条目不在这一天）</option>}
        {list.map((it) => {
          const t = formatItemTime(it);
          return <option key={it.id} value={it.id}>{[t.main || t.sub, it.title].filter(Boolean).join(' · ')}</option>;
        })}
      </select>
    </div>
  );
}

/**
 * 小票照片：拍 / 选一张（透明的 file input 叠在按钮上，iOS 一定会弹相机 / 相册），上传进写队列（离线也行）。
 * @param {{ path: string|null, onPick: (file: File) => void, onRemove: () => void, uploading?: boolean, disabled?: boolean }} props
 */
export function ReceiptField({ path, onPick, onRemove, uploading = false, disabled = false }) {
  const url = useSignedUrl(path);
  return (
    <div class="xf__section">
      <span class="xf__label"><span>小票照片</span><span class="xf__label-hint">可不拍</span></span>
      <div class="xf-receipt" data-testid="xf-receipt">
        {path && (
          <span class="xf-receipt__thumb" data-testid="xf-receipt-thumb">
            {url ? <img src={url} alt="小票" /> : <span class="xf-receipt__state">…</span>}
          </span>
        )}
        <span class="xf-receipt__meta">
          <span class="xf-receipt__pick" data-press="scale">
            <input
              class="xf-receipt__input"
              type="file"
              accept="image/*"
              disabled={disabled}
              aria-label={path ? '换一张小票' : '拍小票或从相册选'}
              data-testid="xf-receipt-input"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (f) onPick(f);
              }}
            />
            <span class="xf-receipt__pick-label" aria-hidden="true">
              <Glyph name="camera" size={18} />
              {' '}{path ? '换一张' : '拍小票'}
            </span>
          </span>
          {path && (
            <button type="button" class="xf-receipt__state" data-press="highlight" disabled={disabled} data-testid="xf-receipt-remove" onClick={onRemove}>
              {uploading ? '正在上传… ' : ''}移除
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
