// =====================================================================
// sheets/booking/EditForm.jsx：预订详情弹层的「改」模式（BookingSheet.jsx 用）：状态、付款（谁付、付了多少、付款方式）、订单号、备注。
// 价格、时间、details 这些结构化的内容还是在行程 JSON 里改（导入），这里只改出门在外最常变的几样。
//
// 表单状态在 BookingSheet 里（底部的「保存」按钮也要用）；这里只画、只回报改动。
// 提交和校验在 model.js 的 patchFromForm（单元测试覆盖）。
// =====================================================================

import { useEffect, useRef } from 'preact/hooks';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { statusInfo } from '../../kit/status.js';
import { normalizeCurrency, currencyName, parseAmount, formatMoney } from '../../lib/money.js';
import { animateSpring } from '../../motion/animate.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { STATUS_OPTIONS, PAYMENT_OPTIONS, needsPayer, needsMethod } from './model.js';

/**
 * @param {{ booking: object, form: object, errors?: Record<string,string>, members: Array<{ user_id: string, display_name?: string }>,
 *           memberName: (uid: string) => string, myId?: string, onChange: (patch: object) => void }} props
 */
export function EditForm({ booking: b, form, errors = {}, members, memberName, myId, onChange }) {
  const amountRef = useRef(null);
  const set = (k) => (v) => onChange({ [k]: v });
  const currency = b.price_currency ? normalizeCurrency(b.price_currency) : null;
  const payerOptions = members.map((m) => ({ value: m.user_id, label: memberName(m.user_id) || m.display_name || '成员' }));
  // 订金金额边打边换算：「50万」→「= 500,000₫（约 HK$152）」（认不出就不显示，保存时再说原因）
  const paidPreview = (() => {
    const raw = String(form.paid_amount ?? '').trim();
    if (!raw || !currency) return null;
    const n = parseAmount(raw, { currency });
    return n !== null && Number.isFinite(n) && n > 0 ? formatMoney(n, currency) : null;
  })();
  const total = b.price_amount !== null && b.price_amount !== undefined && currency ? formatMoney(Number(b.price_amount), currency) : null;

  // 换成「付了订金」时把焦点放到金额上；改成要记谁付的、还没选人时默认是自己
  const pickPayment = (v) => {
    const patch = { payment_status: v };
    if (needsPayer(v) && !form.paid_by_user_id && myId && members.some((m) => m.user_id === myId)) patch.paid_by_user_id = myId;
    onChange(patch);
    if (v === 'partial') requestAnimationFrame(() => amountRef.current?.focus());
  };

  // 出错的那一栏摇一下（和 SubmitButton 同一套参数）
  useEffect(() => {
    const el = errors.paid_amount ? amountRef.current?.closest('.bks-field') : null;
    if (!el) return;
    animateSpring(el, {
      channel: 'bks-shake',
      current: () => ({ x: 0 }),
      to: { x: 0 },
      velocity: { x: SHAKE_VELOCITY },
      spring: SHAKE_SPRING,
      precision: { x: SHAKE_PRECISION },
      commit: 'clear',
      render: ({ x }) => ({ translate: `${x}px 0` }),
    });
  }, [errors.paid_amount, errors._seq]);

  return (
    <form class="bks-form bks-swap" data-testid="booking-form" onSubmit={(e) => e.preventDefault()} noValidate>
      <fieldset class="bks-field">
        <legend class="bks-field__label">预订状态</legend>
        <SegmentedControl
          label="预订状态"
          value={form.status}
          onChange={set('status')}
          options={STATUS_OPTIONS.map((v) => ({ value: v, label: statusInfo('booking', v).label }))}
          data-testid="form-status"
        />
        {form.status === 'cancelled' && b.status !== 'cancelled' && (
          <p class="bks-field__hint">改成已取消后会收进页面底部「已取消」里；付了钱又退了，付款记得改成「已退款」。</p>
        )}
      </fieldset>

      <fieldset class="bks-field">
        <legend class="bks-field__label">付款</legend>
        <div class="bks-chips" role="group" aria-label="付款情况" data-testid="form-payment">
          {PAYMENT_OPTIONS.map((v) => (
            <Chip
              key={v}
              selected={form.payment_status === v}
              onToggle={() => pickPayment(v)}
              data-value={v}
            >
              {statusInfo('payment', v).label}
            </Chip>
          ))}
        </div>
      </fieldset>

      {form.payment_status === 'partial' && (
        <div class="bks-field">
          <label class="bks-field__label" for="bks-paid-amount">已经付了多少</label>
          <div class="bks-amount">
            <input
              ref={amountRef}
              id="bks-paid-amount"
              class="bks-input"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder={currency === 'VND' ? '例如 500000 或 50万' : '例如 200'}
              value={form.paid_amount}
              aria-invalid={errors.paid_amount ? 'true' : undefined}
              aria-describedby={errors.paid_amount ? 'bks-paid-err' : undefined}
              onInput={(e) => onChange({ paid_amount: e.currentTarget.value })}
              data-testid="form-paid-amount"
            />
            <span class="bks-amount__cur">{currency ? currencyName(currency) || currency : '没写币种'}</span>
          </div>
          {errors.paid_amount ? (
            <p class="bks-field__error" id="bks-paid-err" role="alert">{errors.paid_amount}</p>
          ) : (paidPreview || total) && (
            <p class="bks-field__hint bks-field__hint--money" aria-live="polite" data-testid="form-paid-preview">
              {paidPreview ? `= ${paidPreview}` : null}
              {paidPreview && total ? ' · ' : null}
              {total ? `总价 ${total}` : null}
            </p>
          )}
        </div>
      )}

      {needsPayer(form.payment_status) && payerOptions.length > 0 && (
        <fieldset class="bks-field">
          <legend class="bks-field__label">谁付的</legend>
          <SegmentedControl
            label="谁付的"
            value={form.paid_by_user_id || null}
            onChange={set('paid_by_user_id')}
            options={payerOptions}
            data-testid="form-payer"
          />
        </fieldset>
      )}

      {needsMethod(form.payment_status) && (
        <div class="bks-field">
          <label class="bks-field__label" for="bks-method">付款方式</label>
          <input
            id="bks-method"
            class="bks-input"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={40}
            placeholder="信用卡、微信、现金……"
            value={form.payment_method}
            onInput={(e) => onChange({ payment_method: e.currentTarget.value })}
            data-testid="form-method"
          />
          <p class="bks-field__hint"><Glyph name="shield" size={13} />不要写卡号或卡号尾数。</p>
        </div>
      )}

      <div class="bks-field">
        <label class="bks-field__label" for="bks-code">订单号</label>
        <input
          id="bks-code"
          class="bks-input bks-input--mono"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellcheck={false}
          enterKeyHint="next"
          maxLength={80}
          placeholder="商家给的订单号 / 确认号"
          value={form.confirmation_code}
          onInput={(e) => onChange({ confirmation_code: e.currentTarget.value })}
          data-testid="form-code"
        />
      </div>

      <div class="bks-field">
        <label class="bks-field__label" for="bks-notes">备注</label>
        <textarea
          id="bks-notes"
          class="bks-input bks-input--area"
          rows={4}
          maxLength={2000}
          placeholder="例如：入住时要出示护照；押金退房时退"
          value={form.notes}
          onInput={(e) => onChange({ notes: e.currentTarget.value })}
          data-testid="form-notes"
        />
      </div>
    </form>
  );
}
