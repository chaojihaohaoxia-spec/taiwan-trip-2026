// =====================================================================
// pages/tips/TipsPage.jsx：贴士与常用语（路由 tips，#/t/:tripId/tips，SPEC §5.10）。
//
// 大标题「贴士与常用语」、返回、右上全局搜索由外壳画（shell/ 的 section 页）；这里只放内容：
//   - 最上面「当地须知」：按目的地档案现算的紧急电话、插座、小费、叫车、钱（LocalFacts.jsx；新行程没写贴士也有）
//   - 本页搜索框（标题、当地语原文、正文、标签、关联地点名；越南语不带声调也能搜，?q=；提示只在越南这类带声调的语言才写）
//   - 类型芯片：全部 / 防坑 / 小贴士 / 实用信息 / 消息模板 / 常用语（带数量，?kind=）
//   - 置顶提醒：最上面一张暖色的卡（醒目但不吓人），一行一条、点开看全文
//   - 按类型分组：防坑、小贴士、实用信息（长的原地展开、一次只开一张；短的整段显示）、
//     消息模板（原文 + 复制 / 给对方看 / 直接发给关联的联系人）、常用语（按场景的卡片网格 + 场景芯片 ?scene=，筛选时 FLIP）
//   - 网址带 ?tip=<id>（全局搜索的结果）：打开那一条、滚到屏幕中间、闪一下
// 结构和数据说明见同目录 README.md；纯逻辑在 model.js（test/unit/page-tips.test.js）。
// =====================================================================

import './tips.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { setQuery } from '../../router/index.js';
import { useAccordion } from '../../ui/ExpandableCard.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { Button } from '../../ui/Button.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PageEmptyState, ErrorState } from '../../kit/States.jsx';
import { haptic } from '../../lib/native.js';
import { translateLang } from '../../lib/translate/text.js';
import { tripProfile } from '../../data/dest.js';
import { LocalFacts, profileSosNumbers } from './LocalFacts.jsx';
import {
  pageState, useSkeletonHold, useUrlText, PageSearch, FilterChips, MissingTrip, onMarkdownLink, useFocusOnce,
} from './common.jsx';
import { TipCard, PinnedCard, TemplateCard, PhraseCard } from './parts.jsx';
import { useSpeech } from './speech.js';
import {
  KIND_TITLES, normalizeFilter, normalizeTipKind, filterTips, kindCounts, buildView, phraseView, normalizeScene,
  relatedOf, isToday, sendTargets, rendersExpandable, summaryLine, phraseScene,
} from './model.js';

export default function TipsPage({ route }) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const state = pageState(store);
  const loading = state === 'loading';
  const skeleton = useSkeletonHold(loading);

  let body = null;
  if (state === 'error') body = <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="tips-error" />;
  else if (state === 'missing') body = <MissingTrip testId="tips-missing" />;
  else if (state === 'ready') body = <Tips store={store} route={route} />;

  return (
    <div class="tp" data-testid="page-tips">
      <Reveal loading={loading} skeleton={skeleton ? <TipsSkeleton /> : null}>
        {loading && <span class="visually-hidden" role="status">正在读取贴士…</span>}
        {body}
      </Reveal>
    </div>
  );
}

/** 加载中：和真实版式一样的骨架（搜索框、芯片、置顶卡、几张卡片） */
function TipsSkeleton() {
  return (
    <div class="tp-skel">
      <Skeleton variant="rect" height={46} radius="pill" />
      <div class="tp-skel__chips">
        {[58, 70, 76, 88, 84].map((w, i) => <Skeleton key={i} variant="rect" width={w} height={32} radius="pill" />)}
      </div>
      <Skeleton variant="rect" height={132} radius="xl" />
      <Skeleton variant="text" width="30%" />
      {[0, 1, 2].map((i) => (
        <div key={i} class="tp-skel__card material-card">
          <Skeleton variant="rect" width={40} height={40} radius="md" />
          <div class="tp-skel__lines">
            <Skeleton variant="text" width="58%" />
            <Skeleton variant="text" lines={2} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 有数据时
// ---------------------------------------------------------------------

function Tips({ store, route }) {
  const tripId = store.tripId;
  const tips = store.view.tips.value;
  const places = store.tables.places.value;
  const bookings = store.tables.bookings.value;
  const segments = store.tables.segments.value;
  const days = store.view.days.value;
  const contacts = store.view.contacts.value;
  const itemsByDay = store.view.itemsByDay.value;
  const phase = store.view.phase.value?.phase;
  const todayDayId = phase === 'ongoing' ? store.view.today.value?.day?.id || null : null;
  const speech = useSpeech();
  // 要翻译的外语行程（目的地档案，语言包测过的）：「常用语」标题右边「去翻译」（常用语里没有的，到翻译页现翻）
  const canTranslate = Boolean(translateLang(store.trip.value));
  // 去声调的提示只在当地语言是带声调的拉丁字母（越南语）时写
  const toneHint = tripProfile(store).lang === 'vi';
  const knownSos = useMemo(() => profileSosNumbers(store), [store.trip.value]);

  const kind = normalizeFilter(route.query.kind);
  const [query, setQueryText] = useUrlText(route, 'q');
  const focusId = route.query.tip || null;
  const searching = Boolean(query.trim());

  // ---- 数据 ----
  const dayMap = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);
  const todayPlaceIds = useMemo(() => {
    if (!todayDayId) return null;
    return new Set((itemsByDay.get(todayDayId) || []).map((i) => i.place_id).filter(Boolean));
  }, [todayDayId, itemsByDay]);
  const searchCtx = useMemo(() => ({
    placeName: (id) => places.get(id)?.name || null,
    bookingTitle: (id) => bookings.get(id)?.title || null,
  }), [places, bookings]);
  const searched = useMemo(() => filterTips(tips, { query, ctx: searchCtx }), [tips, query, searchCtx]);
  const rows = useMemo(() => (kind === 'all' ? searched : searched.filter((r) => normalizeTipKind(r.tip.kind) === kind)), [searched, kind]);
  const view = useMemo(() => buildView(rows, { kind }), [rows, kind]);

  // 芯片：数据里有的类型才出（数量跟着搜索走，搜不到的那类变灰）
  const present = useMemo(() => new Set(tips.map((t) => normalizeTipKind(t.kind))), [tips]);
  const chipOptions = useMemo(() => kindCounts(searched)
    .filter((c) => present.has(c.kind))
    .map((c) => ({ value: c.kind, label: c.label, count: c.count })), [searched, present]);

  const setKind = (v) => {
    haptic('selection');
    setQuery({ kind: v === 'all' ? null : v, scene: null });
  };
  const clearFilters = () => {
    setQueryText('');
    setQuery({ q: null, kind: null, scene: null });
  };

  // ---- 一次只开一张（网址带 ?tip= 进来时先开那一张）----
  const focusTip = focusId ? tips.find((t) => t.id === focusId) : null;
  // 被筛选藏起来了：下面会清掉筛选，按「看全部」的样子判断它是不是一张能展开的卡
  const sceneHides = Boolean(focusTip && route.query.scene && normalizeTipKind(focusTip.kind) === 'phrase'
    && phraseScene(focusTip).key !== route.query.scene);
  const focusHidden = Boolean(focusTip && (sceneHides || !rows.some((r) => r.tip.id === focusId)));
  const focusOpens = rendersExpandable(focusTip, { kind: focusHidden ? 'all' : kind });
  const acc = useAccordion(focusOpens ? focusId : null);
  useEffect(() => {
    if (focusOpens) acc.setOpenId(focusId);
  }, [focusId]);
  // 带着 ?tip= 进来但被筛选藏起来了：清掉筛选（搜索结果一定要看得见）
  useEffect(() => {
    if (focusHidden) {
      setQueryText('');
      setQuery({ q: null, kind: null, scene: null });
    }
  }, [focusId]);
  const flash = useFocusOnce(focusId, Boolean(focusTip), (id) => `[data-tip-id="${CSS.escape(id)}"]`);

  const ctx = useMemo(() => ({
    tripId,
    flash,
    speech,
    related: (tip) => relatedOf(tip, { days: dayMap, places, bookings, segments, dayNumber: (d) => store.dayNumber(d) }),
    today: (tip) => isToday(tip, { todayDayId, todayPlaceIds }),
    sendTargets: (tip) => sendTargets(tip, contacts),
  }), [tripId, flash, speech, dayMap, places, bookings, segments, todayDayId, todayPlaceIds, contacts]);

  const total = tips.length;
  const summary = summaryLine({ total, shown: rows.length, pinned: tips.filter((t) => t.pinned).length, searching, kind });

  if (!total) {
    return (
      <div class="tp__stack">
        <LocalFacts store={store} />
        <PageEmptyState
          preset="tips"
          description="防坑提醒、常用语、消息模板都会放在这里：常用语和模板可以一键复制，或者全屏大字给对方看。"
          testId="tips-empty"
        />
      </div>
    );
  }

  return (
    <div class="tp__stack" onClick={onMarkdownLink}>
      {!searching && kind === 'all' && <LocalFacts store={store} />}
      <div class="tp-tools">
        <PageSearch
          value={query}
          onValue={setQueryText}
          placeholder={toneHint ? '搜贴士、常用语（越南语不用打声调）' : '搜贴士、常用语'}
          label="在贴士里搜索"
          testId="tips-search"
        />
        <FilterChips
          value={kind}
          onChange={setKind}
          options={chipOptions}
          total={searched.length}
          label="按类型筛选"
          testId="tips-kinds"
        />
      </div>

      {summary && <p class="pg-summary" data-testid="tips-summary" aria-live="polite">{summary}</p>}

      {!rows.length && (
        <EmptyState
          compact
          class="tp-none"
          icon={(p) => <Glyph name="search" size={p.size} />}
          title={searching ? `没有找到「${query.trim()}」` : `没有${KIND_TITLES[kind] || ''}`}
          description={searching ? (toneHint ? '换个说法试试：中文、英文、不带声调的越南语都可以搜。' : '换个说法试试：中文、英文都可以搜。') : null}
          action={<Button variant="secondary" size="sm" onClick={clearFilters}>{searching ? '清除搜索' : '看全部'}</Button>}
          data-testid="tips-none"
        />
      )}

      {view.pinned.length > 0 && <PinnedCard rows={view.pinned} ctx={ctx} acc={acc} knownSos={knownSos} />}

      {view.groups.map((g) => (
        <section key={g.kind} class="tp-group" data-kind={g.kind} data-testid={`tips-group-${g.kind}`} aria-labelledby={`tips-h-${g.kind}`}>
          <SectionHeader
            id={`tips-h-${g.kind}`}
            title={g.label}
            count={g.rows.length}
            meta={groupMeta(g.kind, speech)}
            action={g.kind === 'phrase' && canTranslate ? { label: '去翻译', to: { name: 'translate', params: { tripId } }, testId: 'tips-translate' } : undefined}
          />
          {g.kind === 'phrase' ? (
            <PhraseSection rows={g.rows} ctx={ctx} route={route} searching={searching} />
          ) : (
            <div class="tp-list">
              {g.rows.map(({ tip, hit }) => (g.kind === 'template'
                ? <TemplateCard key={tip.id} tip={tip} hit={hit} ctx={ctx} pinnedTag={kind !== 'all' && tip.pinned} />
                : <TipCard key={tip.id} tip={tip} hit={hit} ctx={ctx} acc={acc} pinnedTag={kind !== 'all' && tip.pinned} />))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** 段标题下面的一句用法说明 */
function groupMeta(kind, speech) {
  if (kind === 'phrase') return speech.can('vi') ? '点越南语读出来；「给对方看」全屏放大' : '「给对方看」全屏放大；复制可以贴进聊天';
  if (kind === 'template') return '复制原文发给对方，或者直接用 WhatsApp 发';
  return null;
}

// ---------------------------------------------------------------------
// 常用语：场景芯片 + 卡片网格（筛选时卡片 FLIP 到新位置）
// ---------------------------------------------------------------------

function PhraseSection({ rows, ctx, route, searching }) {
  const pv = useMemo(() => phraseView(rows), [rows]);
  const scene = normalizeScene(route.query.scene, pv.scenes);
  const shown = scene === 'all' ? pv.rows : pv.rows.filter((r) => r.scene.key === scene);
  const setScene = (v) => {
    haptic('selection');
    setQuery({ scene: v === 'all' ? null : v });
  };
  const chips = !searching && pv.scenes.length > 1 && rows.length >= 4;
  return (
    <>
      {chips && (
        <FilterChips
          class="tp-scenes"
          value={scene}
          onChange={setScene}
          options={pv.scenes.map((s) => ({ value: s.key, label: s.label, count: s.count, glyph: s.glyph }))}
          total={rows.length}
          label="按场景筛选常用语"
          testId="tips-scenes"
          layout="scroll"
        />
      )}
      <FlipGroup
        class="tp-phrases"
        trigger={shown.map((r) => r.tip.id).join()}
        options={{ spring: 'smooth', enter: 'fade' }}
        data-testid="tips-phrases"
      >
        {shown.map((r) => <PhraseCard key={r.tip.id} row={r} ctx={ctx} />)}
      </FlipGroup>
    </>
  );
}

