// =====================================================================
// kit/InlineAdd.jsx：行内快速添加（清单、打包、待办的最后一行）。打字、回车就加上，输入框清空、焦点留着，接着打下一条。
//
//   <InlineAdd placeholder="加一项打包" label="添加打包项" onAdd={(text) => store.insert('todos', { list: 'packing', title: text })} />
//   <InlineAdd … disabled disabledReason="只读成员不能添加" />
//
// - 回车 / 点「添加」提交；正在用输入法拼字时的回车不算（中文输入法选词时按回车不会误加）；Esc 清空。
// - 一次粘贴好几行：每行加一条（清单从备忘录里贴过来很方便）。
// - onAdd 可以返回 Promise；抛错（比如 DataError 的中文原因）时字留着、下面显示原因，输入框轻轻摇一下。
// - 成功后读屏会念「已添加：xxx」。输入框 16px（iOS 聚焦不放大），可点区域 ≥44px。
// =====================================================================

import './InlineAdd.css';
import { useRef, useState } from 'preact/hooks';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../ui/shake.js';
import { Glyph } from './Glyph.jsx';

/**
 * @param {{ onAdd: (text: string) => any, placeholder?: string, label?: string, submitLabel?: string, disabled?: boolean,
 *           disabledReason?: string, maxLength?: number, class?: string, testId?: string }} props
 */
export function InlineAdd({
  onAdd, placeholder = '添加一项', label = '添加一项', submitLabel = '添加', disabled = false, disabledReason, maxLength = 200,
  class: className, testId = 'inline-add',
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  const shake = () => {
    animateSpring(boxRef.current, {
      channel: 'inline-add-shake',
      from: { x: 0 },
      velocity: { x: SHAKE_VELOCITY },
      to: { x: 0 },
      spring: SHAKE_SPRING,
      precision: SHAKE_PRECISION,
      commit: 'clear',
      render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
    });
  };

  const addOne = async (value) => {
    const t = value.trim();
    if (!t) return true;
    try {
      await onAdd(t);
      setAnnounce(`已添加：${t}`);
      return true;
    } catch (e) {
      setError(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有加上，请再试一次');
      shake();
      return false;
    }
  };

  const submit = async () => {
    if (disabled) return;
    const value = text;
    if (!value.trim()) {
      inputRef.current?.focus();
      return;
    }
    setError('');
    setText('');
    const ok = await addOne(value);
    if (!ok) setText(value);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      // 输入法正在拼字（选词）时的回车不是提交
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && text) {
      e.preventDefault();
      e.stopPropagation();
      setText('');
      setError('');
    }
  };

  const onPaste = async (e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    const lines = pasted.split(/\r\n?|\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2 || disabled) return;
    e.preventDefault();
    setError('');
    let added = 0;
    for (const line of lines) {
      if (!(await addOne(line.slice(0, maxLength)))) break;
      added += 1;
    }
    if (added > 1) setAnnounce(`已添加 ${added} 条`);
  };

  const cls = ['k-add', disabled && 'k-add--disabled', error && 'k-add--error', className].filter(Boolean).join(' ');
  return (
    <div class={cls} data-testid={testId}>
      <div class="k-add__box" ref={boxRef}>
        <span class="k-add__plus" aria-hidden="true"><Glyph name="plus" size={18} stroke={2.2} /></span>
        <input
          ref={inputRef}
          class="k-add__input"
          type="text"
          value={text}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={error ? 'true' : undefined}
          maxLength={maxLength}
          enterKeyHint="next"
          autoComplete="off"
          disabled={disabled}
          onInput={(e) => {
            setText(e.currentTarget.value);
            if (error) setError('');
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          data-testid={`${testId}-input`}
        />
        <button
          type="button"
          class="k-add__submit"
          data-press="scale"
          disabled={disabled}
          data-empty={text.trim() ? undefined : ''}
          onPointerDown={(e) => e.preventDefault()}
          onClick={submit}
          data-testid={`${testId}-submit`}
        >
          {submitLabel}
        </button>
      </div>
      {error && <p class="k-add__error" role="alert">{error}</p>}
      {disabled && disabledReason && <p class="k-add__hint">{disabledReason}</p>}
      <span class="visually-hidden" role="status" aria-live="polite">{announce}</span>
    </div>
  );
}
