// =====================================================================
// dev/pages/DataPage.jsx：数据层展示页（#/dev/data，只在本机）。
//
// 在演示模式（?demo=1）下把数据层的每一块都摆出来、能直接点：
//   会话（登录 / 验证码 / 退出前确认未同步）· 同步状态（重试 / 放弃）· 演示网络（在线 / 很差 / 断网、延迟）
//   行程列表 → 行程数据包（来源、实时、各表行数）→ 时间（把“现在”拨到行程里）→ 某一天（主方案 / 备选、路线点、住处、天气点、当天待办）
//   预算 · 记账（按币种结算）· 清单进度 · 写操作试验台（记一笔、勾选、软删除 + 撤销、撤销窗口删除、模拟对方改动）
//   写队列 · 文件上传（压缩结果 + 预览）· 邀请 · 搜索 · 维护（刷新、清缓存、重置演示数据）
// e2e（test/e2e/data.e2e.mjs）按 data-testid 操作这一页。
// =====================================================================

import './data-page.css';
import { useEffect, useState } from 'preact/hooks';
import {
  data, initData, authState, authNotice, syncStatus, undoable, useMyTrips, useTrip, useSignedUrl, selectors as S, isDemoMode,
} from '../../data/index.js';
import { route as routeSignal, setQuery } from '../../router/index.js';
import { formatMoney } from '../../lib/money.js';
import { now, setNowForTesting } from '../../lib/clock.js';
import { nowInZone, zonedTimeToMs } from '../../data/zoned.js';
import { BUNDLE_TABLES } from '../../data/tables.js';

const TABLE_LABELS = {
  trips: '行程', trip_members: '成员', segments: '分段', places: '地点', bookings: '预订', days: '天', items: '条目',
  contacts: '联系人', todos: '清单', tips: '贴士', journal_entries: '日记', reviews: '评级', expenses: '记账',
};
const SYNC_TONE = { synced: 'success', syncing: 'info', retrying: 'warning', offline: 'warning', error: 'danger', stale: 'warning' };
const STATUS_LABEL = { idle: '未打开', loading: '加载中', ready: '已就绪', error: '加载失败', missing: '找不到', removed: '已移出' };
const SOURCE_LABEL = { cache: '本机缓存', network: '网络' };
const REALTIME_LABEL = { off: '未订阅', connecting: '连接中', live: '实时同步中', error: '实时断开' };
const OP_KIND = { insert: '新建', update: '修改', delete: '删除', upload: '上传', 'remove-files': '删文件' };

function useAsync() {
  const [state, set] = useState({ busy: false, error: null, done: null });
  const run = async (fn) => {
    set({ busy: true, error: null, done: null });
    try {
      const r = await fn();
      set({ busy: false, error: null, done: r ?? true });
      return r;
    } catch (e) {
      set({ busy: false, error: e, done: null });
      return undefined;
    }
  };
  return [state, run];
}

function Pill({ tone = 'neutral', children, ...rest }) {
  return <span class={`dd-pill dd-pill--${tone}`} {...rest}>{children}</span>;
}

function Row({ label, children, testid }) {
  return (
    <div class="dd-row" data-testid={testid}>
      <span class="dd-row__label">{label}</span>
      <span class="dd-row__value">{children}</span>
    </div>
  );
}

function Section({ id, title, note, children }) {
  return (
    <section class="dev-section" data-testid={`data-${id}`}>
      <h2 class="dev-section__title">{title}</h2>
      {note && <p class="dev-section__note">{note}</p>}
      <div class="dev-section__body dd-body">{children}</div>
    </section>
  );
}

function ErrorText({ error }) {
  if (!error) return null;
  return <p class="dd-error" role="alert">{error.message || String(error)}</p>;
}

// ---------------------------------------------------------------------
// 会话、同步、演示网络
// ---------------------------------------------------------------------

function LoginForm() {
  const [email, setEmail] = useState('cathy@example.com');
  const [password, setPassword] = useState(isDemoMode() ? 'demo1234' : '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [st, run] = useAsync();
  return (
    <div class="dd-login" data-testid="data-login">
      <p class="dd-muted">未登录。{isDemoMode() && '演示账号：jeremy@example.com / cathy@example.com，密码 demo1234，验证码 123456。'}</p>
      {authNotice.value && <p class="dd-error">{authNotice.value}</p>}
      <label class="dd-field">
        <span>邮箱</span>
        <input type="email" inputMode="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} data-testid="login-email" />
      </label>
      <label class="dd-field">
        <span>密码</span>
        <input type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} data-testid="login-password" />
      </label>
      <div class="dev-buttons">
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" disabled={st.busy} onClick={() => run(() => data.auth.signInWithPassword(email, password))} data-testid="login-submit">
          {st.busy ? '登录中…' : '密码登录'}
        </button>
        <button type="button" class="dev-btn dev-btn--outline" data-press="scale" disabled={st.busy} onClick={() => run(async () => { await data.auth.sendEmailCode(email); setSent(true); })}>
          发验证码
        </button>
      </div>
      {sent && (
        <div class="dd-inline">
          <label class="dd-field dd-field--grow">
            <span>验证码</span>
            <input inputMode="numeric" autocomplete="one-time-code" value={code} onInput={(e) => setCode(e.currentTarget.value)} />
          </label>
          <button type="button" class="dev-btn dev-btn--primary" data-press="scale" onClick={() => run(() => data.auth.verifyEmailCode(email, code))}>验证并登录</button>
        </div>
      )}
      <ErrorText error={st.error} />
    </div>
  );
}

function SessionPanel() {
  const a = authState.value;
  const sync = syncStatus.value;
  const [confirm, setConfirm] = useState(null);
  const [st, run] = useAsync();
  const demo = isDemoMode();
  const net = data.backend.demo?.network?.value;

  const signOut = (discard = false) => run(async () => {
    const r = await data.auth.signOut({ discardUnsynced: discard, timeoutMs: 3000 });
    setConfirm(r.ok ? null : r);
    return r;
  });

  return (
    <div class="dd-status" data-testid="data-status">
      {a.status === 'unknown' && <p class="dd-muted">正在恢复登录状态…</p>}
      {a.status === 'signed-out' && <LoginForm />}
      {a.status === 'signed-in' && (
        <div class="dd-status__row">
          <span class="dd-avatar" aria-hidden="true">{(a.user.displayName || a.user.email || '?').slice(0, 1).toUpperCase()}</span>
          <span class="dd-status__who">
            <strong data-testid="data-user">{a.user.displayName || a.user.email}</strong>
            <span class="dd-muted">{a.user.email}{a.offline ? ' · 离线登录' : ''}</span>
          </span>
          <button type="button" class="dev-btn" data-press="scale" disabled={st.busy} onClick={() => signOut(false)} data-testid="signout">{st.busy ? '同步中…' : '退出'}</button>
        </div>
      )}
      {confirm && (
        <div class="dd-confirm" role="alertdialog" aria-label="还有没同步的改动" data-testid="signout-confirm">
          <p>还有 {confirm.pending} 条改动没同步。现在退出，这些改动会丢失。</p>
          <div class="dev-buttons">
            <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => signOut(true)} data-testid="signout-discard">放弃改动并退出</button>
            <button type="button" class="dev-btn" data-press="scale" onClick={() => setConfirm(null)}>先不退出</button>
          </div>
        </div>
      )}
      <div class="dd-status__row">
        <Pill tone={SYNC_TONE[sync.state] || 'neutral'} data-testid="sync-pill" data-state={sync.state}>{sync.message}</Pill>
        {sync.canRetry && <button type="button" class="dev-btn dev-btn--outline" data-press="scale" onClick={() => data.retrySync()} data-testid="sync-retry">重试</button>}
        {sync.canDiscard && <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => data.discardFailed()} data-testid="sync-discard">放弃这条改动</button>}
      </div>
      {demo && net && (
        <div class="dd-status__row dd-status__row--wrap">
          <span class="dd-muted">演示网络</span>
          <div class="dd-seg" role="group" aria-label="演示网络">
            {[['online', '在线'], ['flaky', '很差'], ['offline', '断网']].map(([mode, label]) => (
              <button key={mode} type="button" class={`dd-seg__btn${net.mode === mode ? ' is-active' : ''}`} data-press="scale" aria-pressed={net.mode === mode}
                onClick={() => {
                  data.backend.demo.setNetwork({ mode });
                  if (mode !== 'offline') data.outbox.wake();
                }} data-testid={`net-${mode}`}
              >{label}</button>
            ))}
          </div>
          <label class="dd-field dd-field--inline">
            <span>延迟</span>
            <select value={String(net.latency)} onChange={(e) => data.backend.demo.setNetwork({ latency: Number(e.currentTarget.value) })} data-testid="net-latency">
              {[0, 120, 600, 1500].map((ms) => <option key={ms} value={String(ms)}>{ms} 毫秒</option>)}
            </select>
          </label>
        </div>
      )}
      <ErrorText error={st.error} />
    </div>
  );
}

// ---------------------------------------------------------------------
// 行程
// ---------------------------------------------------------------------

function TripPicker({ entries, current }) {
  if (!entries.length) return <p class="dd-muted">还没有行程。</p>;
  return (
    <div class="dd-chips" role="list">
      {entries.map((e) => {
        const ph = S.tripPhase(e.trip, now());
        return (
          <button key={e.id} type="button" role="listitem" class={`dd-chip${e.id === current ? ' is-active' : ''}`} data-press="scale" aria-pressed={e.id === current}
            onClick={() => setQuery({ trip: e.id, day: null })} data-testid={`trip-chip-${e.id}`}
          >
            <span aria-hidden="true">{e.trip.cover?.emoji || e.trip.cover_emoji || '✈️'}</span>
            <span>{e.trip.title}</span>
            <Pill tone={ph.phase === 'ongoing' ? 'success' : ph.phase === 'upcoming' ? 'info' : 'neutral'}>{ph.label}</Pill>
          </button>
        );
      })}
    </div>
  );
}

function Overview({ store }) {
  const t = store.trip.value;
  return (
    <>
      <Row label="行程" testid="ov-title">{t ? `${t.title}（${t.id}）` : '—'}</Row>
      <Row label="日期 · 时区">{t ? `${t.start_date} → ${t.end_date} · ${t.timezone}` : '—'}</Row>
      <Row label="我的角色">{S.ROLE_LABELS[store.view.myRole.value] || '—'}</Row>
      <Row label="状态" testid="ov-status">
        <Pill tone={store.status.value === 'ready' ? 'success' : store.status.value === 'error' ? 'danger' : 'neutral'} data-state={store.status.value}>{STATUS_LABEL[store.status.value]}</Pill>
        {store.source.value && <Pill>来源：{SOURCE_LABEL[store.source.value]}</Pill>}
        <Pill tone={store.realtime.value === 'live' ? 'success' : store.realtime.value === 'error' ? 'warning' : 'neutral'} data-testid="ov-realtime" data-state={store.realtime.value}>{REALTIME_LABEL[store.realtime.value]}</Pill>
        {store.refreshing.value && <Pill tone="info">刷新中</Pill>}
      </Row>
      {store.error.value && <ErrorText error={store.error.value} />}
      <div class="dd-grid" data-testid="ov-counts">
        {BUNDLE_TABLES.map((t2) => (
          <div key={t2} class="dd-stat" data-table={t2}>
            <span class="dd-stat__n">{store.tables[t2].value.size}</span>
            <span class="dd-stat__label">{TABLE_LABELS[t2]}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function TimePanel({ store }) {
  const t = store.trip.value;
  data.clockTick.value;
  if (!t) return null;
  const tz = t.timezone;
  const local = nowInZone(now(), tz);
  const cd = store.view.countdown.value;
  const today = store.view.today.value;
  const set = (ms) => {
    setNowForTesting(ms === null ? null : new Date(ms));
    data.clockTick.value += 1;
  };
  const dates = store.view.dates.value;
  return (
    <>
      <Row label="现在（行程时区）" testid="time-now">{`${local.date} ${local.time.slice(0, 5)}`}</Row>
      <Row label="阶段 · 倒计时" testid="time-countdown">{cd.label}</Row>
      {today.day && (
        <Row label="今天" testid="time-today">
          {`第 ${S.dayNumber(t, today.day.date)} 天 · ${today.day.title}`}
          {today.current && <Pill tone="success">进行中：{today.current.title}</Pill>}
          {today.next && <Pill tone="info">下一项：{today.next.title}（{today.minutesUntilNext} 分钟后）</Pill>}
        </Row>
      )}
      <div class="dev-buttons">
        {dates.length > 0 && <button type="button" class="dev-btn" data-press="scale" onClick={() => set(zonedTimeToMs(dates[0], '09:00:00', tz) - 86_400_000)} data-testid="time-before">出发前一天</button>}
        {dates.slice(0, 3).map((d, i) => (
          <button key={d} type="button" class="dev-btn" data-press="scale" onClick={() => set(zonedTimeToMs(d, '11:00:00', tz))} data-testid={`time-day-${i + 1}`}>第 {i + 1} 天 11:00</button>
        ))}
        <button type="button" class="dev-btn dev-btn--outline" data-press="scale" onClick={() => set(null)} data-testid="time-real">恢复真实时间</button>
      </div>
    </>
  );
}

function ItemLine({ item, store, alts }) {
  const place = item.place_id ? store.tables.places.value.get(item.place_id) : null;
  const time = item.start_time ? item.start_time.slice(0, 5) : item.time_label || '—';
  return (
    <li class={`dd-item dd-item--${item.status}`}>
      <span class="dd-item__time">{time}</span>
      <span class="dd-item__main">
        <span class="dd-item__title">{item.title}</span>
        {place && <span class="dd-muted">{place.name}{place.lat === null ? ' · 位置未知' : place.coord_precision !== 'exact' ? ' · 大概位置' : ''}</span>}
        {alts?.length > 0 && (
          <span class="dd-alts">{alts.map((a) => <Pill key={a.id} tone={a.variant === 'rain' ? 'info' : 'neutral'}>{a.variant === 'rain' ? '雨天' : '备选'}：{a.title}</Pill>)}</span>
        )}
      </span>
      {item.status !== 'planned' && <Pill tone={item.status === 'done' ? 'success' : 'neutral'}>{item.status === 'done' ? '已完成' : '跳过'}</Pill>}
    </li>
  );
}

function DayPanel({ store, date }) {
  const days = store.view.days.value;
  const day = (date && store.view.dayByDate.value.get(date)) || days[0];
  if (!day) return <p class="dd-muted">还没有日期。</p>;
  const plan = store.view.plans.value.get(day.id) || S.dayPlan([]);
  const route = store.dayRoute(day.id);
  const stay = store.stayForDay(day);
  const wp = store.weatherPoint(day);
  const todos = store.view.todosByDay.value.get(day.id) || [];
  return (
    <>
      <div class="dd-chips" role="list">
        {days.map((d) => (
          <button key={d.id} type="button" role="listitem" class={`dd-chip${d.id === day.id ? ' is-active' : ''}`} data-press="scale" aria-pressed={d.id === day.id}
            onClick={() => setQuery({ day: d.date })} data-testid={`day-chip-${d.date}`}
          >第 {store.dayNumber(d.date)} 天 · {d.date.slice(5)}</button>
        ))}
      </div>
      <Row label="当天">{`${day.title || '（没写标题）'} · ${store.dayTimezone(day)}`}</Row>
      <ol class="dd-list" data-testid="day-items">
        {plan.primary.map((it) => <ItemLine key={it.id} item={it} store={store} alts={plan.alternatives.get(it.id)} />)}
      </ol>
      {plan.general.length > 0 && <Row label="当天通用备选">{plan.general.map((g) => <Pill key={g.id}>{g.title}</Pill>)}</Row>}
      <Row label="地图路线" testid="day-route">{route.points.length ? route.points.map((p) => `${p.order}. ${p.name}${p.approximate ? '（大概）' : ''}`).join(' → ') : '没有带坐标的地点'}</Row>
      {route.missing.length > 0 && <Row label="位置未知">{route.missing.map((m) => m.name).join('、')}</Row>}
      <Row label="当晚住处">{stay ? `${stay.booking.title}${stay.place ? ` · ${stay.place.name}` : ''}` : '—'}</Row>
      <Row label="天气查询点">{wp ? `${wp.name}（${wp.source === 'stay' ? '住处' : wp.source === 'segment' ? '分段中心' : '行程第一段'}）${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}` : '—'}</Row>
      {todos.length > 0 && <Row label="当天待办">{todos.map((t) => <Pill key={t.id} tone={t.done ? 'success' : 'neutral'}>{S.TODO_LIST_LABELS[t.list]}：{t.title}</Pill>)}</Row>}
    </>
  );
}

function BudgetPanel({ store }) {
  const b = store.view.budget.value;
  const range = (o) => (o.min === o.max ? formatMoney(o.min, b.home) : `${formatMoney(o.min, b.home)} – ${formatMoney(o.max, b.home)}`);
  return (
    <>
      <Row label="合计" testid="budget-total"><strong>{range(b.total)}</strong></Row>
      <Row label="已订（预订价）">{range(b.booked)}</Row>
      <Row label="估算（条目）">{range(b.estimated)}</Row>
      <Row label="同行人数 · 汇率">{`${b.partySize} 人 · ${b.fxSource === 'approx' ? '参考汇率' : b.fxSource === 'demo' ? '演示汇率' : '实时汇率'}`}</Row>
      <Row label="按币种">
        {b.byCurrency.map((c) => <Pill key={c.currency}>{c.min === c.max ? formatMoney(c.min, c.currency) : `${formatMoney(c.min, c.currency)}–${formatMoney(c.max, c.currency)}`}</Pill>)}
      </Row>
      {b.unconverted.length > 0 && <Row label="换算不了">{b.unconverted.map((u) => u.currency).join('、')}</Row>}
      <Row label="付款" testid="budget-payments">{`已付 ${formatMoney(b.payments.paid, b.home)} · 待付 ${formatMoney(b.payments.due, b.home)}（其中到店付 ${formatMoney(b.payments.atProperty, b.home)}）`}</Row>
    </>
  );
}

function LedgerPanel({ store }) {
  const L = store.view.ledger.value;
  const name = (id) => L.people.find((p) => p.id === id)?.name || '未知';
  return (
    <>
      <Row label="合计（折合）" testid="ledger-total"><strong>{formatMoney(L.home.total, L.home.currency)}</strong>{` · ${L.count} 笔${L.home.approxCount ? ` · ${L.home.approxCount} 笔用参考汇率` : ''}`}</Row>
      {L.currencies.map((c) => (
        <div key={c.currency} class="dd-card" data-testid={`ledger-${c.currency}`}>
          <div class="dd-card__head"><strong>{c.currency}</strong><span>{formatMoney(c.total, c.currency)} · {c.count} 笔</span></div>
          {[...new Set([...Object.keys(c.paid), ...Object.keys(c.share)])].map((id) => (
            <Row key={id} label={name(id)}>{`付了 ${formatMoney(c.paid[id] || 0, c.currency)} · 承担 ${formatMoney(c.share[id] || 0, c.currency)}`}</Row>
          ))}
          <Row label="结算建议">{c.transfers.length ? c.transfers.map((t) => `${name(t.from)} → ${name(t.to)} ${formatMoney(t.amount, c.currency)}`).join('；') : '两清'}</Row>
        </div>
      ))}
      {L.issues.length > 0 && <Row label="需要检查">{L.issues.map((i) => i.kind).join('、')}</Row>}
    </>
  );
}

function TodoPanel({ store }) {
  const p = store.view.todoProgress.value;
  return (
    <div class="dd-progress" data-testid="todo-progress">
      {S.TODO_LISTS.map((l) => {
        const x = p.byList[l];
        const ratio = x.total ? x.done / x.total : 0;
        return (
          <div key={l} class="dd-progress__row">
            <span class="dd-progress__label">{S.TODO_LIST_LABELS[l]}</span>
            <span class="dd-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax={x.total} aria-valuenow={x.done} aria-label={`${S.TODO_LIST_LABELS[l]}进度`}>
              <span class="dd-progress__fill" style={{ transform: `scaleX(${ratio})` }} />
            </span>
            <span class="dd-progress__n">{x.done}/{x.total}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// 写操作
// ---------------------------------------------------------------------

function WritePanel({ store, date }) {
  const t = store.trip.value;
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const cur = currency || t?.local_currency || t?.home_currency || 'HKD';
  const day = (date && store.view.dayByDate.value.get(date)) || store.view.days.value[0];
  const plan = day ? store.view.plans.value.get(day.id) : null;
  const firstItem = plan?.primary[0];
  const todo = store.view.todosByList.value.get('packing')?.[0] || [...store.tables.todos.value.values()][0];
  const me = data.userId.value;
  const partner = store.view.members.value.find((m) => m.user_id !== me);
  const demoApi = data.backend.demo;
  const u = undoable.value;

  const act = (fn, text) => {
    setErr(null);
    try {
      const r = fn();
      setMsg(text);
      return r;
    } catch (e) {
      setErr(e);
      setMsg(null);
      return null;
    }
  };

  const addExpense = async () => {
    const r = act(() => store.addExpense({ amount: Number(amount), currency: cur, description: desc || null, category: '其他' }), '已记一笔（乐观显示，正在同步）');
    if (!r) return;
    setAmount('');
    setDesc('');
    const res = await r.synced;
    setMsg(res.ok ? `已同步：${formatMoney(r.row.amount, r.row.currency)}` : `没保存成功：${res.error?.message || '已取消'}`);
  };

  return (
    <>
      <div class="dd-inline">
        <label class="dd-field dd-field--grow">
          <span>金额</span>
          <input inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} placeholder="例如 150000" data-testid="exp-amount" />
        </label>
        <label class="dd-field">
          <span>币种</span>
          <select value={cur} onChange={(e) => setCurrency(e.currentTarget.value)} data-testid="exp-currency">
            {[...new Set([t?.local_currency, t?.home_currency, 'HKD', 'CNY', 'VND', 'TWD'].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div class="dd-inline">
        <label class="dd-field dd-field--grow">
          <span>说明</span>
          <input value={desc} onInput={(e) => setDesc(e.currentTarget.value)} placeholder="例如 打车" data-testid="exp-desc" />
        </label>
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" onClick={addExpense} data-testid="exp-add">记一笔</button>
      </div>
      <div class="dev-buttons">
        {todo && (
          <button type="button" class="dev-btn" data-press="scale" onClick={() => act(() => store.toggleTodo(todo.id), `已${todo.done ? '取消勾选' : '勾选'}「${todo.title}」`)} data-testid="todo-toggle">
            {todo.done ? '取消勾选' : '勾选'}「{todo.title}」
          </button>
        )}
        {firstItem && (
          <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => act(() => store.softDelete('items', firstItem.id), `已删除「${firstItem.title}」（软删除，可撤销）`)} data-testid="item-delete">
            删除「{firstItem.title}」
          </button>
        )}
        {todo && (
          <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => act(() => store.remove('todos', todo.id, { undoMs: 5000 }), `已删除「${todo.title}」（5 秒内可撤销）`)} data-testid="todo-delete">
            删除清单项（5 秒可撤销）
          </button>
        )}
        {demoApi && partner && firstItem && (
          <button type="button" class="dev-btn dev-btn--outline" data-press="scale" data-testid="remote-edit"
            onClick={() => act(() => demoApi.as(partner.user_id).update('items', { id: firstItem.id }, { title: firstItem.title.endsWith('（对方改过）') ? firstItem.title.replace('（对方改过）', '') : `${firstItem.title}（对方改过）` }), `模拟 ${partner.display_name || '对方'} 改了「${firstItem.title}」，等实时推送`)}
          >模拟 {partner.display_name || '对方'} 修改第一条</button>
        )}
        {demoApi && partner && (
          <button type="button" class="dev-btn dev-btn--outline" data-press="scale" data-testid="remote-expense"
            onClick={() => act(() => demoApi.as(partner.user_id).insert('expenses', { trip_id: store.tripId, amount: 88, currency: 'HKD', description: `${partner.display_name || '对方'} 记的`, category: '餐饮', paid_by_user_id: partner.user_id, split: { mode: 'equal', user_ids: store.view.members.value.map((m) => m.user_id) } }), `模拟 ${partner.display_name || '对方'} 记了一笔`)}
          >模拟 {partner.display_name || '对方'} 记一笔</button>
        )}
      </div>
      {u && (
        <div class="dd-undo" role="status" data-testid="undo-bar">
          <span>{u.label}</span>
          <button type="button" class="dev-btn dev-btn--outline" data-press="scale" onClick={async () => { await u.undo(); undoable.value = null; setMsg('已撤销'); }} data-testid="undo">撤销</button>
        </div>
      )}
      {msg && <p class="dd-note" role="status" data-testid="write-msg">{msg}</p>}
      <ErrorText error={err} />
    </>
  );
}

function OutboxPanel() {
  const st = data.outbox.state.value;
  const ops = data.outbox.ops;
  if (!ops.length) return <p class="dd-muted" data-testid="outbox-empty">写队列是空的（所有改动都同步了）。</p>;
  return (
    <ol class="dd-list" data-testid="outbox-list">
      {ops.map((op) => (
        <li key={op.id} class="dd-op">
          <Pill tone={op.status === 'failed' ? 'danger' : op.notBefore && op.notBefore > Date.now() ? 'neutral' : 'info'}>{OP_KIND[op.kind] || op.kind}</Pill>
          <span class="dd-op__label">{op.label || `${op.table} ${op.key}`}</span>
          <span class="dd-muted">{op.status === 'failed' ? `失败：${op.error?.message}` : op.attempts ? `已重试 ${op.attempts} 次` : op.notBefore && op.notBefore > Date.now() ? '等待撤销期' : st.sending && op === ops[0] ? '发送中' : '排队中'}</span>
          {op.status === 'failed' && (
            <span class="dev-buttons">
              <button type="button" class="dev-btn" data-press="scale" onClick={() => data.outbox.retry(op.id)}>重试</button>
              <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => data.outbox.discard(op.id)}>放弃</button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------
// 文件、邀请、搜索、维护
// ---------------------------------------------------------------------

function kb(n) {
  if (!Number.isFinite(n)) return '—';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function FilePanel({ store }) {
  const [res, setRes] = useState(null);
  const [st, run] = useAsync();
  const url = useSignedUrl(res?.path || null);
  return (
    <>
      <label class="dd-file">
        <input type="file" accept="image/*,application/pdf" data-testid="file-input"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) run(async () => setRes(await store.upload('journal', f)));
          }}
        />
        <span class="dev-btn dev-btn--primary" data-press="scale" aria-hidden="true">{st.busy ? '压缩中…' : '选一张照片上传'}</span>
      </label>
      {res && (
        <div class="dd-upload" data-testid="file-result">
          {url && res.type.startsWith('image/') && <img class="dd-upload__img" src={url} alt="刚上传的照片预览" data-testid="file-preview" />}
          <div>
            <Row label="压缩" testid="file-compress">
              {res.converted ? `${kb(res.originalSize)} → ${kb(res.size)} · ${res.width}×${res.height}`
                : res.reason === 'original-smaller' ? `原图已经够小（没有 EXIF），直接上传 · ${kb(res.size)} · ${res.width}×${res.height}`
                    : `原样上传（${res.type}）`}
            </Row>
            <Row label="拍摄时间">{res.takenAt || '读不到'}</Row>
            <Row label="路径"><code class="dd-code">{res.path}</code></Row>
          </div>
        </div>
      )}
      <ErrorText error={st.error} />
    </>
  );
}

function InvitePanel({ store }) {
  const [code, setCode] = useState(null);
  const [list, setList] = useState(null);
  const [st, run] = useAsync();
  const load = () => run(async () => setList(await data.rpc.loadInvites(store.tripId)));
  if (!store.view.canEdit.value) return <p class="dd-muted">只读成员不能生成邀请码。</p>;
  return (
    <>
      <div class="dev-buttons">
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" disabled={st.busy} data-testid="invite-create"
          onClick={() => run(async () => {
            setCode(await data.rpc.createInvite(store.tripId, { role: 'editor' }));
            setList(await data.rpc.loadInvites(store.tripId));
          })}
        >生成邀请码（可编辑）</button>
        <button type="button" class="dev-btn" data-press="scale" disabled={st.busy} onClick={load}>看邀请列表</button>
      </div>
      {code && (
        <div class="dd-card">
          <Row label="邀请码" testid="invite-code"><code class="dd-code dd-code--big">{code}</code></Row>
          <Row label="链接"><code class="dd-code">{data.rpc.inviteLink(code)}</code></Row>
        </div>
      )}
      {list && (
        <ol class="dd-list">
          {list.map((i) => (
            <li key={i.id} class="dd-op">
              <Pill tone={i.state === 'active' ? 'success' : 'neutral'}>{i.stateLabel}</Pill>
              <span class="dd-op__label">{i.role === 'editor' ? '可编辑' : '只读'} · 已用 {i.used_count}/{i.max_uses}</span>
              {i.state === 'active' && <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => run(async () => { await data.rpc.revokeInvite(i.id); setList(await data.rpc.loadInvites(store.tripId)); })}>撤销</button>}
            </li>
          ))}
        </ol>
      )}
      <ErrorText error={st.error} />
    </>
  );
}

function SearchPanel({ store }) {
  const [q, setQ] = useState('');
  const results = q.trim() ? store.search(q, { limit: 8 }) : [];
  return (
    <>
      <label class="dd-field">
        <span>搜索这个行程</span>
        <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="条目、地点、记账、评级…" data-testid="search-input" />
      </label>
      {q.trim() && (
        <ol class="dd-list" data-testid="search-results">
          {results.length ? results.map((r) => (
            <li key={`${r.type}:${r.id}`} class="dd-op"><Pill>{r.typeLabel}</Pill><span class="dd-op__label">{r.title}</span>{r.detail && <span class="dd-muted">{r.detail}</span>}</li>
          )) : <li class="dd-muted">没有找到</li>}
        </ol>
      )}
    </>
  );
}

function MaintenancePanel({ store }) {
  const [st, run] = useAsync();
  const demoApi = data.backend.demo;
  return (
    <>
      <div class="dev-buttons">
        <button type="button" class="dev-btn" data-press="scale" disabled={store.refreshing.value} onClick={() => store.refresh()} data-testid="trip-refresh">重新加载行程</button>
        <button type="button" class="dev-btn" data-press="scale" onClick={() => run(() => data.clearCaches())}>清空本机缓存</button>
        {demoApi && (
          <button type="button" class="dev-btn dev-btn--danger" data-press="scale" onClick={() => run(async () => { await demoApi.reset(); window.location.reload(); })} data-testid="demo-reset">重置演示数据</button>
        )}
      </div>
      {st.done && <p class="dd-note">已完成。</p>}
      <ErrorText error={st.error} />
    </>
  );
}

// ---------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------

function TripSections({ store, date }) {
  if (store.status.value === 'loading' || store.status.value === 'idle') return <p class="dd-muted" data-testid="trip-loading">正在加载行程…</p>;
  if (!store.trip.value) {
    return <ErrorText error={store.error.value || { message: '行程没有加载出来' }} />;
  }
  return (
    <>
      <Section id="overview" title="行程数据包" note="先显示本机缓存，再后台刷新；进入行程时订阅实时，切换行程时退订。"><Overview store={store} /></Section>
      <Section id="time" title="时间" note="今天、阶段、倒计时都按行程时区算。可以把“现在”拨到行程里看“进行中 / 下一项”。"><TimePanel store={store} /></Section>
      <Section id="day" title="某一天" note="排序：sort_key → start_time（空值在后）→ created_at；备选挂在主方案下；路线只连主方案的地点。"><DayPanel store={store} date={date} /></Section>
      <Section id="budget" title="预算" note="cost_estimate：每人的乘人数、区间分别汇总；已订的看预订价；换算成 home_currency。"><BudgetPanel store={store} /></Section>
      <Section id="ledger" title="记账" note="按币种分开结算（不换汇率）；折合金额用每笔记账时的汇率。"><LedgerPanel store={store} /></Section>
      <Section id="todos" title="清单进度"><TodoPanel store={store} /></Section>
      <Section id="write" title="写操作" note="乐观更新：点了马上变；断网时进写队列，联网后按顺序重放。"><WritePanel store={store} date={date} /></Section>
      <Section id="outbox" title="写队列"><OutboxPanel /></Section>
      <Section id="files" title="文件" note="上传前在浏览器压缩（长边 2048 的 JPEG，去掉 GPS）；进写队列，传完前用本机预览。"><FilePanel store={store} /></Section>
      <Section id="invite" title="邀请"><InvitePanel store={store} /></Section>
      <Section id="search" title="搜索"><SearchPanel store={store} /></Section>
      <Section id="maintenance" title="维护"><MaintenancePanel store={store} /></Section>
    </>
  );
}

export default function DataPage() {
  useEffect(() => {
    initData();
  }, []);
  const r = routeSignal.value;
  const a = authState.value;
  const list = useMyTrips();
  const entries = sortEntries(list.entries || []);
  const tripId = r.query.trip && entries.some((e) => e.id === r.query.trip) ? r.query.trip : entries[0]?.id || null;
  const store = useTrip(a.status === 'signed-in' ? tripId : null);
  return (
    <div class="dd">
      {!isDemoMode() && <p class="dd-warn">不是演示模式：这里连的是真实后台。开发和测试请在网址加 ?demo=1。</p>}
      <SessionPanel />
      {a.status === 'signed-in' && (
        <Section id="trips" title="全部行程" note={list.status === 'loading' ? '正在加载…' : `${entries.length} 个行程${list.source === 'cache' ? ' · 来自本机缓存' : ''}`}>
          <TripPicker entries={entries} current={tripId} />
          <ErrorText error={list.error} />
        </Section>
      )}
      {store && <TripSections store={store} date={r.query.day || null} />}
    </div>
  );
}

function sortEntries(entries) {
  data.clockTick.value;
  return [...entries].sort((x, y) => (x.trip.sort ?? 0) - (y.trip.sort ?? 0) || String(x.trip.start_date).localeCompare(String(y.trip.start_date)));
}
