// =====================================================================
// pages/join/JoinCodeForm.jsx：「有邀请码？」一行输入框 + 「下一步」。
// 行程列表的空状态、加入页（链接里的码不对时）都用它：粘贴整条邀请链接、带空格、小写都认（model.js 的 codeFromInput），
// 认出来就去 #/join/<码>（加入页负责确认和加入）；认不出来输入框摇一下并说原因。
// =====================================================================

import './join-form.css';
import { useRef, useState } from 'preact/hooks';
import { navigate } from '../../router/index.js';
import { Button } from '../../ui/Button.jsx';
import { animateSpring } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { SHAKE_SPRING, SHAKE_VELOCITY, SHAKE_PRECISION } from '../../ui/shake.js';
import { codeFromInput } from './model.js';

function shake(el) {
  if (!el) return;
  animateSpring(el, {
    channel: 'join-shake',
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

/**
 * @param {{ label?: string, initial?: string, replace?: boolean, testId?: string }} props
 *   replace：换掉当前这一条历史（加入页里改码时用，返回不会回到错的码）
 */
export function JoinCodeForm({ label = '有邀请码？', initial = '', replace = false, testId = 'join-code-form' }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const submit = (e) => {
    e.preventDefault();
    const code = codeFromInput(text);
    if (!code) {
      setError(text.trim() ? '认不出这个邀请码：是 12 位字母和数字，例如 38S7-72Q9-FTCZ' : '先粘贴邀请链接或邀请码');
      shake(boxRef.current);
      return;
    }
    setError('');
    navigate({ name: 'join', params: { code } }, { replace });
  };
  const id = `${testId}-input`;
  return (
    <form class="joinf" onSubmit={submit} noValidate data-testid={testId}>
      <label class="joinf__label" for={id}>{label}</label>
      <div class="joinf__row" ref={boxRef} data-error={error ? '' : undefined}>
        <input
          id={id}
          class="joinf__input"
          value={text}
          onInput={(e) => {
            setText(e.currentTarget.value);
            if (error) setError('');
          }}
          placeholder="粘贴邀请链接或邀请码"
          autoComplete="off"
          autoCapitalize="characters"
          spellcheck={false}
          enterKeyHint="go"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid={`${testId}-input`}
        />
        <Button type="submit" variant="tinted" size="md" data-testid={`${testId}-go`}>下一步</Button>
      </div>
      {error && <p class="joinf__error" id={`${id}-error`} role="alert">{error}</p>}
    </form>
  );
}
