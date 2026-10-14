// =====================================================================
// dev/pages/lib/FxDemo.jsx：汇率卡演示（lib/services/fx.js）。
//
// 几种情景都用“假接口”（不连网），每种情景一个独立的服务实例：
//   演示数据        —— 演示模式的内置假数据（标“演示汇率”）
//   接口正常        —— 假接口 0.6 秒后返回和 open.er-api.com 一样格式的数据；缓存用真的 IndexedDB
//                      （开发页专用的库 rs7885-dev-fx），24 小时内再打开这一页不会再请求
//   断网 · 有旧缓存 —— 假接口报网络错误，缓存里有 2 天前的汇率 → “离线汇率 · 2 天前更新”
//   断网 · 没缓存   —— 假接口报网络错误、缓存空 → “离线汇率 · 内置参考值”（用户定的固定汇率）
//   真实接口        —— 真的请求 open.er-api.com（手动看效果用，e2e 不点）
// “连续重新渲染 30 次”证明渲染不会触发请求：请求次数不变。
// =====================================================================

import { useMemo, useState } from 'preact/hooks';
import { createFxService, useFx, fxStatus, formatRate, demoSnapshot, FX_CACHE_KEY } from '../../../lib/services/fx.js';
import { createMemoryCache, createIdbCache } from '../../../lib/services/cache.js';
import { convertAmount, parseAmount, formatAmount, formatAmountReadable, currencyName } from '../../../lib/money.js';
import { now } from '../../../lib/clock.js';
import { IconArrowRightLeft, IconRefresh, IconWifiOff, IconCheck } from '../../../ui/icons.js';
import { RollingNumber } from '../../../ui/RollingNumber.jsx';
import { Skeleton } from '../../../ui/Skeleton.jsx';

/** 和 open.er-api.com 一样格式的假数据 */
function fakeApiJson(at) {
  const sec = Math.floor(at / 1000);
  return {
    result: 'success',
    base_code: 'HKD',
    time_last_update_unix: sec - 3 * 3600,
    time_next_update_unix: sec + 21 * 3600,
    rates: { HKD: 1, VND: 3301.25, TWD: 4.1032, CNY: 0.8561, USD: 0.12841, JPY: 19.87, EUR: 0.1139 },
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const okFetch = async () => {
  await delay(600);
  return new Response(JSON.stringify(fakeApiJson(now().getTime())), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const failFetch = async () => {
  await delay(400);
  throw new TypeError('Failed to fetch');
};

/** “接口正常”情景用的 IndexedDB 库名（开发页专用，不碰正式缓存 rs7885-services） */
export const DEV_FX_DB = 'rs7885-dev-fx';

export const FX_SCENARIOS = [
  { id: 'demo', label: '演示数据' },
  { id: 'ok', label: '接口正常' },
  { id: 'offline-cache', label: '断网 · 有旧缓存' },
  { id: 'offline-none', label: '断网 · 没缓存' },
  { id: 'real', label: '真实接口（会连网）' },
];

function makeService(id) {
  switch (id) {
    case 'ok': {
      const cache = createIdbCache({ dbName: DEV_FX_DB });
      return Object.assign(createFxService({ fetch: okFetch, cache, onlineTarget: null }), { cache });
    }
    case 'offline-cache': {
      const cache = createMemoryCache();
      // 正好 2 天前（不要再早一小时：半夜 0 点到 1 点之间跑测试会跨成「3 天前」）
      const old = { ...demoSnapshot(now()), source: 'network', fetchedAt: now().getTime() - 2 * 86_400_000, providerUpdatedAt: now().getTime() - 2 * 86_400_000 };
      cache.set(FX_CACHE_KEY, { savedAt: old.fetchedAt, data: old });
      return createFxService({ fetch: failFetch, cache, onlineTarget: null });
    }
    case 'offline-none':
      return createFxService({ fetch: failFetch, cache: createMemoryCache(), onlineTarget: null });
    case 'real':
      return createFxService({ cache: createMemoryCache(), onlineTarget: null });
    default:
      return createFxService({ demo: true, onlineTarget: null });
  }
}

const CURRENCIES = ['VND', 'TWD', 'CNY', 'USD', 'HKD'];

export default function FxDemo() {
  const [scenario, setScenario] = useState('demo');
  const services = useMemo(() => new Map(), []);
  if (!services.has(scenario)) services.set(scenario, makeService(scenario));
  const service = services.get(scenario);
  const { status, snapshot, error } = useFx(service);
  const [amountText, setAmountText] = useState('450k');
  const [currency, setCurrency] = useState('VND');
  const [, setTick] = useState(0);
  const [renders, setRenders] = useState(0);

  const amount = parseAmount(amountText, { currency });
  const target = currency === 'HKD' ? 'VND' : 'HKD';
  const converted = amount === null || !snapshot ? null : convertAmount(amount, currency, target, snapshot);
  const st = fxStatus(snapshot);

  const rerender = () => {
    // 连续 30 次状态更新 = 30 次重新渲染；useFx 只在挂载时 ensure，一次请求都不会多
    let n = 0;
    const step = () => {
      n += 1;
      setTick((x) => x + 1);
      setRenders((x) => x + 1);
      service.ensure();
      if (n < 30) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return (
    <div class="lp-stack">
      <div class="lp-chips" role="group" aria-label="情景">
        {FX_SCENARIOS.map((s) => (
          <button key={s.id} type="button" class={`dev-chip${s.id === scenario ? ' is-active' : ''}`} data-press="scale" aria-pressed={s.id === scenario}
            data-testid={`fx-scenario-${s.id}`} onClick={() => setScenario(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <article class="lp-card" data-testid="fx-card" data-status={status} data-tone={st.tone}>
        <header class="lp-card__head">
          <h3 class="lp-card__title">汇率</h3>
          <span class="lp-status" data-tone={st.tone} data-testid="fx-status">
            {st.tone === 'offline' && <IconWifiOff size={14} aria-hidden="true" />}
            {st.text}
          </span>
        </header>

        <div class="lp-fx-body">
          <ul class="lp-rates" aria-busy={!snapshot}>
            {['VND', 'TWD', 'CNY', 'USD'].map((c) => (
              <li key={c} class="lp-rates__row">
                <span class="lp-rates__code">{c}</span>
                <span class="lp-rates__text tabular-nums">{snapshot ? formatRate(snapshot, c) : <Skeleton variant="text" class="lp-rates__skel" />}</span>
              </li>
            ))}
          </ul>

          <div class="lp-convert">
            <label class="lp-field">
              <span class="lp-field__label">金额（可以写 450k、45万、450.000）</span>
              <input class="lp-input" inputMode="decimal" value={amountText} data-testid="fx-amount"
                onInput={(e) => setAmountText(e.currentTarget.value)} autoComplete="off" spellcheck={false}
              />
            </label>
            <div class="lp-seg" role="group" aria-label="币种">
              {CURRENCIES.map((c) => (
                <button key={c} type="button" class="lp-seg__btn" data-press="scale" aria-pressed={c === currency} onClick={() => setCurrency(c)}>
                  {currencyName(c)}
                </button>
              ))}
            </div>
            <div class="lp-convert__result" aria-live="polite">
              <IconArrowRightLeft size={18} aria-hidden="true" />
              {converted === null
                ? <span class="lp-muted">{amount === null ? '认不出这个金额' : '等汇率…'}</span>
                : <RollingNumber class="lp-convert__value" value={converted} format={(v) => `≈ ${formatAmount(v, target)}`} data-testid="fx-converted" />}
            </div>
            {amount !== null && (
              <p class="lp-muted">
                {formatAmount(amount, currency)}
                {currency === 'VND' && ` · ${formatAmountReadable(amount, currency)}`}
              </p>
            )}
          </div>
        </div>

        <footer class="lp-card__foot">
          <button type="button" class="dev-btn" data-press="scale" onClick={() => service.refresh()} disabled={status === 'loading'} data-testid="fx-refresh">
            <IconRefresh size={16} aria-hidden="true" />
            <span>刷新汇率</span>
          </button>
          <button type="button" class="dev-btn dev-btn--outline" data-press="scale" onClick={rerender} data-testid="fx-rerender">连续重新渲染 30 次</button>
          <span class="lp-muted" data-testid="fx-requests">
            网络请求 {service.requestCount} 次 · 已重新渲染 {renders} 次
            {service.cache && ` · 缓存：${service.cache.kind === 'indexeddb' ? 'IndexedDB' : '内存'}`}
            {renders >= 30 && <IconCheck size={14} aria-hidden="true" />}
          </span>
        </footer>
        {error && <p class="lp-error" data-testid="fx-error">上次失败：{error.kind}（{error.message}）</p>}
      </article>
    </div>
  );
}
