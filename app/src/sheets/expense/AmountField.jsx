// =====================================================================
// sheets/expense/AmountField.jsx：记一笔的金额块——大号数字输入（Instrument Serif）+ 右边币种名 + 下面一行折合港币 /
// 每人多少 + 「千 / 万」快捷 + 币种分段（当地币 / 港币 / 人民币 / 其他）。
//
//   <AmountField state={state} onChange={patch} trip={trip} rate={rate} perPerson={…} autoFocus invalid={…} />
//
// 输入细节：
//   - 边打边加千位分隔（formatAmountInput），光标放回“同一个数字后面”（caretAfter），删除逗号前的数字也顺手；
//   - 越南盾这类没有小数的币种只认数字；港币 / 人民币最多两位小数；
//   - 电脑键盘直接打 350k / 35万 也认（trailingUnit）；手机数字键盘上用「千」「万」两个按钮：350 →「千」→ 350,000；
//   - 越南盾不到 1,000 多半是忘了按「千」：下面提醒一句，点一下补上；
//   - inputmode 按币种：没有小数的用 numeric（iOS 的纯数字键盘），有小数的用 decimal；
//   - data-autofocus：弹层打开（openOverlay 的 keyboard: true 先叫出键盘）后焦点落到这里，键盘不收。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { formatMoney, currencyName, normalizeCurrency, formatAmount } from '../../lib/money.js';
import { haptic } from '../../lib/native.js';
import {
  formatAmountInput, caretAfter, multiplyAmount, trailingUnit, allowsDecimals, wantsQuickUnits, QUICK_UNITS,
  currencyChoices, otherCurrencyOptions, segmentForCurrency, currencyUnitLabel, smallAmountSuggestion, MAX_INT_DIGITS,
} from './form-model.js';

/**
 * @param {{ state: object, onChange: (patch: object) => void, trip: object, rate: number|null, perPerson: number|null,
 *           splitMode: string, forName?: string|null, autoFocus?: boolean, invalid?: boolean, errorId?: string,
 *           disabled?: boolean, inputRef?: { current: HTMLInputElement|null } }} props
 *   rate：1 单位当前币种 = 多少 home 币种（没有 = null）；perPerson：平摊时每人多少（原币）
 */
export function AmountField({ state, onChange, trip, rate, perPerson, splitMode, forName, autoFocus = false, invalid = false, errorId, disabled = false, inputRef }) {
  const ownRef = useRef(null);
  const ref = inputRef || ownRef;
  const rowRef = useRef(null);
  const [bump, setBump] = useState(0);
  const currency = normalizeCurrency(state.currency);
  const home = normalizeCurrency(trip?.home_currency || 'HKD');
  const { value } = formatAmountInput(state.amountText, currency);
  const choices = currencyChoices(trip);
  const segment = segmentForCurrency(trip, currency);
  const others = otherCurrencyOptions(trip);
  const quick = wantsQuickUnits(currency);
  const small = smallAmountSuggestion(state);

  // 换币种时数字轻轻弹一下
  useLayoutEffect(() => {
    if (!bump || !rowRef.current) return undefined;
    const el = rowRef.current;
    el.setAttribute('data-bump', '');
    const t = setTimeout(() => el.removeAttribute('data-bump'), 320);
    return () => clearTimeout(t);
  }, [bump]);

  function commit(raw, caret) {
    const el = ref.current;
    // 电脑上直接打了单位（350k / 35万）
    const unit = trailingUnit(raw);
    if (unit) {
      const next = multiplyAmount(unit.rest, unit.factor, currency);
      if (next !== null) {
        onChange({ amountText: next });
        if (el) {
          el.value = next;
          el.setSelectionRange(next.length, next.length);
        }
        return;
      }
    }
    const { text } = formatAmountInput(raw, currency);
    if (el) {
      el.value = text;
      const pos = caretAfter(raw, caret, text, currency);
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* 某些 inputmode 下不支持 */
      }
    }
    onChange({ amountText: text });
  }

  const onInput = (e) => commit(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);

  const applyUnit = (factor) => {
    const next = multiplyAmount(state.amountText, factor, currency);
    if (next === null) return;
    haptic('selection');
    onChange({ amountText: next });
    const el = ref.current;
    if (el) {
      el.value = next;
      el.focus({ preventScroll: true });
      el.setSelectionRange(next.length, next.length);
    }
  };

  const clear = () => {
    onChange({ amountText: '' });
    const el = ref.current;
    if (el) {
      el.value = '';
      el.focus({ preventScroll: true });
    }
  };

  const setCurrency = (next) => {
    const cur = normalizeCurrency(next);
    if (cur === currency) return;
    haptic('selection');
    // 数字照旧（不换算），只按新币种的小数规则重新排一遍
    const { text } = formatAmountInput(state.amountText, cur);
    onChange({ currency: cur, amountText: text });
    setBump((n) => n + 1);
  };

  const onSegment = (seg) => {
    if (seg === 'other') {
      // 「其他」：默认第一个候选（美元），下面的下拉再换
      if (segment !== 'other') setCurrency(others[0]?.value || 'USD');
      return;
    }
    setCurrency(seg);
  };

  // 下面那一行：折合 + 每人。折合后的数只是“看一眼大概多少港币”，和全站的「约 HK$121」一样取整；本币的每人金额照实写
  const approx = (v) => formatAmount(Math.round(v * rate), home);
  let conv = null;
  let convTone;
  if (value) {
    const parts = [];
    if (currency !== home) {
      if (rate) parts.push(<>约 <b>{approx(value)}</b></>);
      else {
        parts.push(<>没有{currencyName(currency)}的汇率，先按原币记</>);
        convTone = 'warning';
      }
    }
    if (splitMode === 'equal' && perPerson) {
      const per = currency !== home && rate ? approx(perPerson) : formatAmount(perPerson, currency);
      parts.push(<>平摊每人 <b>{per}</b></>);
    } else if (splitMode === 'personal') {
      parts.push(<>{forName ? `只算 ${forName} 的` : '一人付，不分摊'}</>);
    } else if (splitMode === 'amounts') {
      parts.push(<>按金额分</>);
    }
    conv = parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>);
  } else {
    conv = <span>{currency === home ? '输入金额' : rate ? `输入金额，自动折合${currencyName(home)}` : '输入金额'}</span>;
  }

  const longInput = (state.amountText || '').replace(/[^\d]/g, '').length > 9;

  return (
    <div class="xf-amount" data-invalid={invalid ? '' : undefined} data-long={longInput ? '' : undefined} data-testid="xf-amount">
      <div ref={rowRef} class="xf-amount__row">
        <input
          ref={ref}
          class="xf-amount__input"
          type="text"
          inputMode={allowsDecimals(currency) ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          placeholder="0"
          maxLength={MAX_INT_DIGITS + 8}
          value={state.amountText}
          aria-label={`金额（${currencyUnitLabel(currency)}）`}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={errorId}
          disabled={disabled}
          data-autofocus={autoFocus ? '' : undefined}
          data-testid="xf-amount-input"
          onInput={onInput}
        />
        <span class="xf-amount__unit" data-testid="xf-amount-unit">{currencyUnitLabel(currency)}</span>
      </div>
      <p class="xf-amount__conv" data-tone={convTone} data-testid="xf-amount-conv" aria-live="polite">{conv}</p>
      {(quick || state.amountText) && (
        <div class="xf-amount__quick">
          {quick && QUICK_UNITS.map((u) => (
            <button
              key={u.key}
              type="button"
              class="xf-quick"
              data-press="scale"
              disabled={disabled || !value}
              aria-label={`乘以 ${u.factor.toLocaleString('en-US')}（${u.label}）`}
              data-testid={`xf-quick-${u.key}`}
              onClick={() => applyUnit(u.factor)}
            >
              <span class="xf-quick__unit">{u.label}</span>
              <span class="xf-quick__factor">×{u.factor.toLocaleString('en-US')}</span>
            </button>
          ))}
          {state.amountText && !disabled && (
            <button type="button" class="xf-quick xf-quick--clear" data-press="scale" aria-label="清空金额" data-testid="xf-amount-clear" onClick={clear}>清空</button>
          )}
        </div>
      )}
      {small !== null && !disabled && (
        <p class="xf-amount__hint" data-testid="xf-amount-small">
          <span>{formatAmount(value, currency)} 太小了？多半是忘了按「千」</span>
          <button type="button" class="xf-amount__hint-btn" data-press="scale" onClick={() => applyUnit(1000)}>改成 {formatAmount(small, currency)}</button>
        </p>
      )}
      <div class="xf-amount__seg">
        <SegmentedControl label="币种" options={choices} value={segment} onChange={onSegment} disabled={disabled} />
      </div>
      {segment === 'other' && (
        <select class="xf-field xf-amount__other" aria-label="其他币种" value={currency} disabled={disabled} data-testid="xf-currency-other" onChange={(e) => setCurrency(e.currentTarget.value)}>
          {!others.some((o) => o.value === currency) && <option value={currency}>{currencyUnitLabel(currency)}</option>}
          {others.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}
