// =====================================================================
// pages/settings/LegacyImport.jsx：设置页的「旧版本机记录」（SPEC §5.12 末尾；逻辑在 legacy-import.js）。
//
//   LegacyCards     这台设备上有旧版的键才出现：
//                   - 旧版明文存的 AI 接口密钥（taiwanTrip_anthropicKey）：红色提示 +「删除这个密钥」（先确认；只删，不读、不显示它的值）；
//                   - 「发现旧版台湾行程的本机记录」+「预览并导入」；导入过以后写「已经导入过（时间、导入到哪一趟）」+「清掉旧版本机记录」。
//   LegacyImportSheet  预览和导入（页面里的底部面板 legacy-import，无条件渲染）：
//                   导入到哪一趟（确定是台湾行程时只显示名字；是猜的就让人挑）→ 每一类一行（勾选框 + 「标成完成 12 个条目 · 3 个已经有了」，
//                   展开看明细和对不上的原因）→ 个人记账可以另外勾「也导入行程日期以外的 N 笔」→
//                   「导入 N 条」（先确认）→ 转圈 → 对勾 → 结果（每一类导入了几条、同步状态）→ 同步完以后可以「清掉旧版本机记录」。
// 读本机在面板出场动画播完以后才做（whenOpened）；导入全部走数据层（写队列，离线也行，联网后自动同步）。
// =====================================================================

import { useEffect, useMemo, useState } from 'preact/hooks';
import { useTrip, authState, syncStatus, online, fxRates } from '../../data/index.js';
import { Sheet, openOverlay, closeOverlay, confirm, toast, useOverlay } from '../../overlay/index.js';
import { Button } from '../../ui/Button.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { Card } from '../../kit/Card.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { local } from '../../lib/storage.js';
import { now } from '../../lib/clock.js';
import { formatInstant } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import {
  LEGACY_KEYS, CLEARABLE_KEYS, IMPORTED_MARK, SECTIONS, legacyKeysPresent, readLegacyData, pickLegacyTarget, planLegacyImport,
  applyLegacyImport, sectionSummary,
} from './legacy-import.js';

const SHEET_ID = 'legacy-import';

/** 浏览器的 localStorage（隐私模式、被禁用时是 null） */
function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 删掉几个旧键（失败的返回出来） */
function removeKeys(keys) {
  const s = browserStorage();
  const failed = [];
  for (const k of keys) {
    try {
      s?.removeItem(k);
    } catch {
      failed.push(k);
    }
  }
  return failed;
}

/** 旧键扫描（只看键名）+ 本机的“导入过了”标记；bump() 以后重新扫 */
export function useLegacyScan() {
  const [n, setN] = useState(0);
  const keys = useMemo(() => legacyKeysPresent(browserStorage()), [n]);
  const mark = useMemo(() => local.getJSON(IMPORTED_MARK, null), [n]);
  useEffect(() => {
    // 别的标签页（旧版页面）改了本机存储
    const onStorage = () => setN((x) => x + 1);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return { keys, mark, bump: () => setN((x) => x + 1) };
}

/** 设置页里的卡片（没有旧键就什么都不画） */
export function LegacyCards({ scan }) {
  const { keys, mark, bump } = scan;
  if (!keys.apiKey && !keys.any) return null;

  const removeApiKey = async () => {
    const ok = await confirm({
      title: '删除旧版的 AI 接口密钥？',
      message: '新版用不到它。删除只影响这台设备上的旧版页面（旧版的“AI 助手”会要你重新填）。',
      confirmText: '删除',
      cancelText: '先留着',
      destructive: true,
    });
    if (!ok) return;
    const failed = removeKeys([LEGACY_KEYS.apiKey]);
    bump();
    if (failed.length) toast.error('没有删掉：这台设备的本机存储现在不能写');
    else {
      haptic('success');
      toast.success('已删除旧版的 AI 接口密钥');
    }
  };

  const clearOld = async () => {
    const ok = await confirm({
      title: '清掉旧版的本机记录？',
      message: '内容已经导入新版并同步到云端了。清掉以后，这台设备上的旧版页面会回到空白（旧版的登录不受影响）。',
      confirmText: '清掉',
      cancelText: '先留着',
      destructive: true,
    });
    if (!ok) return;
    const failed = removeKeys(CLEARABLE_KEYS);
    bump();
    if (failed.length) toast.error('没有清干净：这台设备的本机存储现在不能写');
    else toast.success('已清掉旧版的本机记录');
  };

  const markText = mark?.at ? `已经导入过（${formatInstant(mark.at, { timeZone: 'Asia/Hong_Kong', year: 'auto' })}${mark.title ? `，导入到「${mark.title}」` : ''}）` : '';

  return (
    <div class="set-legacy" data-testid="settings-legacy">
      {keys.apiKey && (
        <Card tone="warning" glyph="shield" title="旧版存了一个 AI 接口密钥" testId="settings-legacy-key">
          <p class="set-p">旧版把它明文存在这台设备的浏览器里，能打开这个浏览器的人都看得到。新版用不到它，建议删除。我们不会读出或显示它。</p>
          <Button variant="danger" block leading={<Glyph name="trash" size={18} />} onClick={removeApiKey} data-testid="settings-legacy-key-delete">删除这个密钥</Button>
        </Card>
      )}
      {keys.any && (
        <Card glyph="swap" title={mark ? '旧版的本机记录' : '发现旧版台湾行程的本机记录'} testId="settings-legacy-import">
          {mark ? (
            <p class="set-p" data-testid="settings-legacy-mark">{markText}。确认两台设备上都看到了以后，可以把旧版的本机记录清掉。</p>
          ) : (
            <p class="set-p">旧版有些东西只存在这台设备上：完成和确认的勾、评级、日记、打包清单、个人记账。导入到新版的台湾行程，两个人、两台设备都能看到。导入前会先给你看清单。</p>
          )}
          <div class="set-actions">
            <Button variant={mark ? 'secondary' : 'primary'} block onClick={(e) => openOverlay(SHEET_ID, { trigger: e.currentTarget })} data-testid="settings-legacy-open">
              {mark ? '再看一次' : '预览并导入'}
            </Button>
            {mark && <Button variant="danger-soft" block onClick={clearOld} data-testid="settings-legacy-clear">清掉旧版本机记录</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}

/** 预览和导入（底部面板） */
export function LegacyImportSheet({ entries, scan }) {
  return (
    <Sheet sheetId={SHEET_ID} title="导入旧版记录" detents={['large']} testId="sheet-legacy-import">
      <LegacyImportBody entries={entries} scan={scan} />
    </Sheet>
  );
}

function LegacyImportBody({ entries, scan }) {
  const ov = useOverlay();
  const [legacy, setLegacy] = useState(null);
  const editable = useMemo(() => entries.filter((e) => e.role === 'owner' || e.role === 'editor'), [entries]);
  const guess = useMemo(() => pickLegacyTarget(entries, now()), [entries]);
  const [targetId, setTargetId] = useState(guess?.id || null);
  const [phase, setPhase] = useState('preview');
  const [result, setResult] = useState(null);

  // 读本机放在出场动画播完以后
  useEffect(() => {
    let alive = true;
    (ov?.whenOpened?.() || Promise.resolve()).then(() => {
      if (alive) setLegacy(readLegacyData(browserStorage()));
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!targetId && guess?.id) setTargetId(guess.id);
  }, [guess?.id]);

  const store = useTrip(targetId);
  const target = editable.find((e) => e.id === targetId) || null;

  if (!editable.length) {
    return <p class="set-note set-note--warning" data-testid="legacy-no-target">你还没有能编辑的行程，没地方导入。先让创建者把你设成「可编辑」，或者新建一趟。</p>;
  }
  if (phase === 'done' && result) return <ImportResult result={result} scan={scan} />;

  return (
    <div class="lgi" data-testid="legacy-import-body">
      <section class="lgi-target">
        <span class="lgi-label">导入到</span>
        {guess?.sure ? (
          <p class="lgi-target__one" data-testid="legacy-target">{target?.trip.title}</p>
        ) : (
          <>
            <p class="lgi-hint">没有找到台湾那趟（taiwan2026），选一趟导入：</p>
            <div class="lgi-chips" role="group" aria-label="导入到哪一趟" data-testid="legacy-target-choices">
              {editable.map((e) => (
                <Chip key={e.id} selected={e.id === targetId} onToggle={() => setTargetId(e.id)} data-testid={`legacy-target-${e.id}`}>{e.trip.title}</Chip>
              ))}
            </div>
          </>
        )}
      </section>
      {legacy && store?.trip.value ? (
        <Preview legacy={legacy} store={store} target={target} onDone={(r) => { setResult(r); setPhase('done'); scan.bump(); }} />
      ) : store && !store.trip.value && store.status.value === 'error' ? (
        <p class="set-note set-note--warning" role="status" data-testid="legacy-target-error">
          {store.error.value?.message || '这趟行程没有读出来'}
          <button type="button" class="set-note__btn" data-press="scale" onClick={() => store.refresh()}>重试</button>
        </p>
      ) : (
        <div class="lgi-loading" aria-busy="true">
          <span class="visually-hidden" role="status">正在读取…</span>
          {[0, 1, 2, 3].map((i) => <div key={i} class="lgi-row"><Skeleton variant="circle" size={24} /><div class="lgi-row__text"><Skeleton variant="text" width="38%" /><Skeleton variant="text" width="72%" /></div></div>)}
        </div>
      )}
    </div>
  );
}

function bundleOf(store) {
  const arr = (t) => [...store.tables[t].value.values()];
  return {
    trip: store.trip.value,
    days: arr('days'),
    items: arr('items'),
    todos: arr('todos'),
    places: arr('places'),
    reviews: arr('reviews'),
    journal: arr('journal_entries'),
    expenses: arr('expenses'),
    members: store.view.members.value,
  };
}

function Preview({ legacy, store, target, onDone }) {
  const userId = authState.value.user?.id || null;
  const fx = fxRates.value;
  const plan = useMemo(() => planLegacyImport(legacy, bundleOf(store), { userId, rate: (a, b) => fx.rate(a, b) }), [
    legacy, userId, fx, store.tables.items.value, store.tables.todos.value, store.tables.reviews.value, store.tables.journal_entries.value,
    store.tables.expenses.value, store.tables.days.value, store.tables.places.value, store.tables.trip_members.value,
  ]);
  const [off, setOff] = useState(() => new Set());
  const [outside, setOutside] = useState(false);
  const [btn, setBtn] = useState('idle');
  const [fail, setFail] = useState('');
  const canEdit = store.view.canEdit.value;
  const sections = SECTIONS.map((s) => plan.sections[s.key]);
  const include = sections.filter((s) => (s.ops.length || (s.key === 'ledger' && outside && s.outside?.length)) && !off.has(s.key)).map((s) => s.key);
  const count = sections.reduce((n, s) => n + (include.includes(s.key) ? s.ops.length + (s.key === 'ledger' && outside ? s.outside?.length || 0 : 0) : 0), 0);
  const nothing = sections.every((s) => !s.ops.length && !s.outside?.length);

  const run = async () => {
    if (btn === 'loading' || btn === 'success' || !count) return;
    const lines = sections.filter((s) => include.includes(s.key)).map((s) => `${s.label} ${s.ops.length + (s.key === 'ledger' && outside ? s.outside?.length || 0 : 0)}`);
    const ok = await confirm({
      title: `导入 ${count} 条到「${target?.trip.title || '这趟行程'}」？`,
      message: `${lines.join('、')}。只会补上新版没有的，不会改掉新版里已经有的内容；可以重复导入，不会重复记。`,
      confirmText: '导入',
      cancelText: '再看看',
    });
    if (!ok) return;
    setBtn('loading');
    setFail('');
    const t0 = performance.now();
    try {
      const res = applyLegacyImport(store, plan, { include, includeOutside: outside });
      await Promise.all(res.results.map((r) => r.saved));
      const left = 520 - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      local.setJSON(IMPORTED_MARK, { at: now().toISOString(), tripId: plan.tripId, title: target?.trip.title || '', counts: res.counts });
      haptic('success');
      setBtn('success');
      setTimeout(() => onDone({ ...res, title: target?.trip.title || '' }), 650);
    } catch (e) {
      setFail(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有导入成功，请再试一次');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  return (
    <>
      {legacy.problems.length > 0 && <p class="set-note set-note--warning" role="status">{legacy.problems.join('；')}</p>}
      {!canEdit && <p class="set-note set-note--warning" role="status">你在这趟行程里是只读成员，只能导入自己的日记和评级。</p>}
      {nothing ? (
        <p class="lgi-nothing" data-testid="legacy-nothing">
          <Glyph name="check-circle" size={20} />
          旧版记录里的东西新版都已经有了，不用再导入。
        </p>
      ) : (
        <ul class="lgi-list" data-testid="legacy-sections">
          {sections.map((s) => (
            <SectionRow
              key={s.key}
              s={s}
              on={!off.has(s.key)}
              toggle={(v) => setOff((prev) => {
                const next = new Set(prev);
                if (v) next.delete(s.key);
                else next.add(s.key);
                return next;
              })}
              outside={outside}
              setOutside={setOutside}
            />
          ))}
        </ul>
      )}
      <div class="lgi-foot">
        {fail && <p class="lgi-error" role="alert">{fail}</p>}
        <SubmitButton
          block
          state={btn}
          label={count ? `导入 ${count} 条` : '没有要导入的'}
          loadingLabel="正在导入"
          successLabel="已导入"
          errorMessage={fail || '没有导入成功'}
          disabled={!count}
          onClick={run}
          data-testid="legacy-import-submit"
        />
        <p class="lgi-hint">导入的东西先存在这台设备上，{online.value === false ? '联网以后' : '马上'}自动同步到云端。</p>
      </div>
    </>
  );
}

function SectionRow({ s, on, toggle, outside, setOutside }) {
  const [open, setOpen] = useState(false);
  const has = s.ops.length > 0 || (s.outside?.length || 0) > 0;
  const details = [...s.ops, ...(outside ? s.outside || [] : [])];
  return (
    <li class="lgi-row" data-testid={`legacy-section-${s.key}`} data-empty={has ? undefined : ''}>
      <Checkbox
        checked={has && on && (s.ops.length > 0 || outside)}
        onChange={toggle}
        disabled={!has || (s.key === 'ledger' && !s.ops.length && !outside)}
        label={s.label}
        description={sectionSummary(s)}
        shape="square"
      />
      {s.key === 'ledger' && s.outside?.length > 0 && (
        <div class="lgi-sub">
          <Checkbox checked={outside} onChange={setOutside} label={`也导入行程日期以外的 ${s.outside.length} 笔`} description="旧版的个人记账是日常账本，不全是旅行时记的" shape="square" data-testid="legacy-outside" />
        </div>
      )}
      {(details.length > 0 || s.skipped.length > 0) && (
        <>
          <button type="button" class="lgi-more" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((o) => !o)} data-press="scale" data-testid={`legacy-more-${s.key}`}>
            {open ? '收起明细' : '看明细'}
            <Glyph name={open ? 'chev-u' : 'chev-d'} size={14} stroke={2.4} />
          </button>
          {open && (
            <ul class="lgi-detail">
              {details.slice(0, 40).map((op, i) => (
                <li key={`o${i}`}>
                  <span class="lgi-detail__name">{op.date ? `${op.date.slice(5)} ` : ''}{op.title}{op.rating ? ` · ${['', '拉完了', 'NPC', '人上人', '顶级', '夯'][op.rating]}` : ''}{op.kind === 'todo-new' ? ' · 新加' : ''}{op.mode === 'append' ? ' · 接在已有日记后面' : ''}</span>
                  {op.amount !== undefined && <MoneyText amount={op.amount} currency={op.currency} size="sm" />}
                </li>
              ))}
              {details.length > 40 && <li class="lgi-detail__more">还有 {details.length - 40} 条</li>}
              {s.skipped.map((x, i) => (
                <li key={`s${i}`} class="lgi-detail__skip">
                  <span class="lgi-detail__name">{x.name}</span>
                  <span class="lgi-detail__why">{x.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

function ImportResult({ result, scan }) {
  const sync = syncStatus.value;
  const pending = Number(sync?.pending) || 0;
  const synced = pending === 0 && sync?.state !== 'error';
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  const clear = async () => {
    const ok = await confirm({
      title: '清掉旧版的本机记录？',
      message: '内容已经导入新版并同步到云端了。清掉以后，这台设备上的旧版页面会回到空白（旧版的登录不受影响）。',
      confirmText: '清掉',
      cancelText: '先留着',
      destructive: true,
    });
    if (!ok) return;
    const failed = removeKeys(CLEARABLE_KEYS);
    scan.bump();
    if (failed.length) toast.error('没有清干净：这台设备的本机存储现在不能写');
    else {
      toast.success('已清掉旧版的本机记录');
      closeOverlay(SHEET_ID);
    }
  };
  return (
    <div class="lgi lgi--done" data-testid="legacy-result">
      <div class="lgi-done">
        <span class="lgi-done__icon" aria-hidden="true"><Glyph name="check" size={28} stroke={2.6} /></span>
        <b>导入了 {total} 条到「{result.title}」</b>
        <span>{SECTIONS.filter((s) => result.counts[s.key]).map((s) => `${s.label} ${result.counts[s.key]}`).join(' · ')}</span>
      </div>
      {result.failed.length > 0 && (
        <div class="set-note set-note--warning" role="status">
          有 {result.failed.length} 条没写进去：{result.failed.slice(0, 3).map((f) => `「${f.title}」${f.message}`).join('；')}
        </div>
      )}
      <p class={`lgi-sync${synced ? ' lgi-sync--ok' : ''}`} role="status" data-testid="legacy-sync">
        <Glyph name={synced ? 'check-circle' : 'refresh'} size={18} />
        {synced ? '已经同步到云端，另一台设备也能看到了。' : sync?.message || `还有 ${pending} 条改动在同步…`}
      </p>
      <p class="lgi-hint">旧版的本机记录原样保留着。两台设备上都看到了以后，可以清掉它们。</p>
      <div class="set-actions">
        <Button variant="danger-soft" block disabled={!synced} onClick={clear} data-testid="legacy-clear">
          {synced ? '清掉旧版本机记录' : '同步完以后可以清掉旧版本机记录'}
        </Button>
        <Button variant="secondary" block onClick={() => closeOverlay(SHEET_ID)} data-testid="legacy-done">完成</Button>
      </div>
    </div>
  );
}
