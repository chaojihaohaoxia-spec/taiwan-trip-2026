// =====================================================================
// pages/login/LoginPage.jsx：登录页（#/login，路由守卫把没登录的人带到这里：#/login?next=<原来要去的网址>；SPEC §5.13）。
// 外框是 bare（没有顶栏、底栏，只有纸）。新视觉：品牌眉标 + 宋体大标题 + 一张磨砂白卡片（登录方式分段、表单、出错原因），
// 下面是演示账号说明和版本页脚。
//
// 两种登录方式（分段控件切换，指示块弹簧跟随）：
//   密码登录       邮箱 + 密码 → data.auth.signInWithPassword（iOS 钥匙串能自动填）
//   邮箱验证码     邮箱 → 发送验证码（60 秒后可重发）→ 输入邮件里的 6 位数字（一行大号数字，iOS 能从邮件自动填）→ data.auth.verifyEmailCode
// 这台设备上次用哪种方式登录成功，下次默认就是哪种（本机记住）；第一次打开是密码登录（shell.e2e / smoke 的约定）。
// 密码那一栏下面有「忘了密码？用邮箱验证码登录」：一键换到验证码，邮箱带过去。
// 提交按钮是 ui/SubmitButton（文字 → 转圈 → 对勾，期间不会重复提交；失败时抖一下并显示原因）；
// 对勾描完后跳回 ?next= 指的页面（data/ 的 nextAfterLogin：只接受站内网址），替换掉登录页这条历史。
// 已经登录的人打开这一页：直接跳走。next 是加入行程的链接时，顶上说「登录后会继续加入行程」。
// 数据层的提示（登录链接过期之类，authNotice）显示在卡片上面；演示模式（本机 ?demo=1）显示演示账号。
// 页脚是版本号和离线状态（PWA 装到主屏后，在这里确认是不是最新版）。
// 注意：「发送验证码」和「登录」两个提交按钮都带 key——不带的话 Preact 会把发送那个（已经停在对勾上）直接拿来当登录按钮用，点了没反应。
// =====================================================================

import './login.css';
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { data, authState, authNotice, nextAfterLogin } from '../../data/index.js';
import { replace } from '../../router/index.js';
import { isDemoMode, appVersion, APP_NAME } from '../../lib/env.js';
import { swControlled } from '../../lib/pwa.js';
import { local } from '../../lib/storage.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
// 只要 toast()：直接引 overlay/toast.js（经过 overlay/index.js 会把整套弹层组件拖进登录页的包，登录页常是第一屏）
import { toast } from '../../overlay/toast.js';

const MODES = [
  { value: 'password', label: '密码登录' },
  { value: 'code', label: '邮箱验证码' },
];

/** 验证码多久以后可以重发（秒） */
const RESEND_SECONDS = 60;
/** 本机记住上次成功的登录方式 */
const MODE_KEY = 'login:mode';

function readMode() {
  const m = local.get(MODE_KEY, 'password');
  return m === 'code' ? 'code' : 'password';
}

/** next 指向加入行程的链接吗（登录页顶上换一句说明） */
function joiningCode(route) {
  const next = route?.query?.next;
  const m = typeof next === 'string' ? /^#\/join\/([A-Za-z0-9 -]{4,40})/.exec(next) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

function Field({ label, hint, id, big = false, ...input }) {
  return (
    <div class="login-field">
      <label class="login-field__label" for={id}>{label}</label>
      <input id={id} class={big ? 'login-field__input login-field__input--code' : 'login-field__input'} {...input} />
      {hint && <span class="login-field__hint">{hint}</span>}
    </div>
  );
}

export default function LoginPage({ route }) {
  const [mode, setMode] = useState(readMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState(null);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState('');
  /** 正在用这一页登录：登录成功后等对勾描完再跳（别被下面的“已登录就跳走”抢先） */
  const signingIn = useRef(false);
  /** 验证码发到了哪个邮箱（发送按钮的对勾描完再切到“输验证码”） */
  const sentTo = useRef(null);
  const auth = authState.value;
  const notice = authNotice.value;
  const joining = joiningCode(route);

  // 已经登录的人打开登录页：直接去 next（或全部行程）
  useEffect(() => {
    if (auth.status === 'signed-in' && !signingIn.current) replace(nextAfterLogin(route));
  }, [auth.status]);

  // 重发验证码的倒计时
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };
  const done = (used) => () => {
    local.set(MODE_KEY, used);
    replace(nextAfterLogin(route));
  };
  const fail = (e) => {
    signingIn.current = false;
    setError(e?.message || '没有登录成功，请稍后再试');
  };

  const signInWithPassword = async () => {
    setError('');
    signingIn.current = true;
    await data.auth.signInWithPassword(email, password);
  };

  const sendCode = async () => {
    setError('');
    sentTo.current = await data.auth.sendEmailCode(email);
  };
  const codeSent = () => {
    setCodeSentTo(sentTo.current);
    setCode('');
    setResendIn(RESEND_SECONDS);
  };
  const resendCode = async () => {
    setError('');
    try {
      const sent = await data.auth.sendEmailCode(codeSentTo || email);
      setCodeSentTo(sent);
      setResendIn(RESEND_SECONDS);
      toast.success(`验证码已重新发到 ${sent}`);
    } catch (e) {
      fail(e);
    }
  };
  const changeEmail = () => {
    setCodeSentTo(null);
    setCode('');
    setError('');
  };

  const verifyCode = async () => {
    setError('');
    signingIn.current = true;
    await data.auth.verifyEmailCode(codeSentTo || email, code);
  };

  // 回车提交：交给表单里的提交按钮（它负责转圈、防重复提交）
  const onSubmit = (e) => e.preventDefault();

  const emailField = (
    <Field
      id="login-email"
      label="邮箱"
      type="email"
      name="email"
      autoComplete="username"
      inputMode="email"
      autoCapitalize="none"
      spellcheck={false}
      placeholder="you@example.com"
      value={email}
      onInput={(e) => setEmail(e.currentTarget.value)}
      readOnly={mode === 'code' && Boolean(codeSentTo)}
      data-testid="login-email"
    />
  );

  return (
    <div class="login" data-testid="page-login">
      <div class="login__panel">
        <header class="login__head">
          <span class="login__mark" aria-hidden="true">
            <span class="login__mark-sun" />
            <span class="login__mark-sea" />
          </span>
          <p class="login__brand">{APP_NAME}</p>
          <h1 class="login__title">登录</h1>
          <p class="login__subtitle">两个人一起用的旅行手帐：行程、预订、账本、清单和日记。</p>
        </header>

        {joining && <p class="login__notice login__notice--join" role="status" data-testid="login-joining">登录以后会回到邀请页，继续加入行程。</p>}
        {notice && <p class="login__notice" role="status" data-testid="login-notice">{notice}</p>}

        <div class="login__card material-card">
          <SegmentedControl label="登录方式" value={mode} onChange={switchMode} options={MODES} data-testid="login-mode" />

          {mode === 'password' ? (
            <form class="login__form" onSubmit={onSubmit} noValidate data-testid="login-password-form">
              {emailField}
              <Field
                id="login-password"
                label="密码"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="至少 6 位"
                value={password}
                onInput={(e) => setPassword(e.currentTarget.value)}
                data-testid="login-password"
              />
              <SubmitButton
                type="submit"
                label="登录"
                loadingLabel="正在登录"
                successLabel="已登录"
                errorMessage={error || '没有登录成功'}
                action={signInWithPassword}
                onSuccess={done('password')}
                onError={fail}
                resetAfter={false}
                block
                data-testid="login-submit"
              />
              <button type="button" class="login__switch" data-press="scale" onClick={() => switchMode('code')} data-testid="login-to-code">
                忘了密码？用邮箱验证码登录
              </button>
            </form>
          ) : (
            <form class="login__form" onSubmit={onSubmit} noValidate data-testid="login-code-form">
              {emailField}
              {codeSentTo ? (
                <Fragment key="sent">
                  <Field
                    id="login-code"
                    big
                    label="验证码"
                    hint={`已发到 ${codeSentTo}，邮件里的 6 位数字`}
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    placeholder="000000"
                    value={code}
                    onInput={(e) => setCode(e.currentTarget.value)}
                    data-testid="login-code"
                  />
                  <SubmitButton
                    key="verify"
                    type="submit"
                    label="登录"
                    loadingLabel="正在登录"
                    successLabel="已登录"
                    errorMessage={error || '没有登录成功'}
                    action={verifyCode}
                    onSuccess={done('code')}
                    onError={fail}
                    resetAfter={false}
                    block
                    data-testid="login-verify"
                  />
                  <div class="login__row">
                    <Button variant="text" disabled={resendIn > 0} onClick={resendCode} data-testid="login-resend">
                      {resendIn > 0 ? `${resendIn} 秒后可以重发` : '重新发送验证码'}
                    </Button>
                    <Button variant="text" onClick={changeEmail} data-testid="login-change-email">换个邮箱</Button>
                  </div>
                </Fragment>
              ) : (
                <Fragment key="send">
                  <SubmitButton
                    key="send"
                    type="submit"
                    label="发送验证码"
                    loadingLabel="正在发送"
                    successLabel="已发送"
                    errorMessage={error || '没有发送成功'}
                    action={sendCode}
                    onSuccess={codeSent}
                    onError={fail}
                    resetAfter={false}
                    block
                    data-testid="login-send-code"
                  />
                  <p class="login__fine">不用记密码：验证码发到你的邮箱，几分钟内有效。</p>
                </Fragment>
              )}
            </form>
          )}

          {error && <p class="login__error" role="alert" data-testid="login-error">{error}</p>}
        </div>

        {isDemoMode() && (
          <p class="login__demo" data-testid="login-demo-hint">
            演示模式：账号 jeremy@example.com 或 cathy@example.com，密码 demo1234；邮箱验证码一律 123456。数据全部虚构。
          </p>
        )}

        <p class="login__foot" data-testid="login-foot">
          版本 <span class="login__mono">{appVersion()}</span> · {swControlled.value ? '离线可用' : '在线'}
        </p>
      </div>
    </div>
  );
}
