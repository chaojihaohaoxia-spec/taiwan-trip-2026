// =====================================================================
// pages/journal/JournalPage.jsx：日记相册（路由 journal，#/t/:tripId/journal，SPEC §5.8）。
//
// 两个视图（分段控件，记在 ?view=；行程概览页链接过来的 ?tab=photos 也认）：
//   按天   每天一节：D1 徽章 + 标题 + 日期；下面两个人各一格（我的在前）——写了的显示心情 emoji、正文
//          （长的先显示几行，「展开全文」原地长高）、照片条（点开看大图）；没写的我的那格有「拍照打卡」「写日记」入口，
//          对方的那格写「Cathy 还没写」。本机有草稿的标「继续写」。
//   相册   所有照片按天分组，列表 ↔ 网格切换（?layout=，ui/ViewSwitch 的 FLIP），顶上按「谁拍的」筛选（?who=）。
// 大标题、返回、搜索由外壳画（section 页）。页面只滚文档。
// 入口：顶上一行「拍照打卡」（PhotoInput：手指点到的就是 <input capture>，一下就开相机，拍完直接进写日记面板）
//       和「写日记」（journal 弹层）；每一天我没写的那格也有同样两个入口。
// 看大图：缩略图外层 data-pv-thumb=<path>，photo 弹层从它放大出来、关闭缩回去（sheets/photo）。
// 打开页面：?day=<日期> 或行程进行中时先滚到那一天（只在页面刚打开、还在最上面时滚一次，不抢用户的滚动）。
// 状态：加载中（骨架，加载完 ui/Reveal 交叉淡入）、空（没有分天 / 没有照片）、出错（中文原因 + 重试）、找不到行程；离线照常写（进写队列）；
//       只读成员也能写自己的日记（个人内容表）。
// =====================================================================

import './journal.css';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useTrip, authState } from '../../data/index.js';
import { setQuery, href } from '../../router/index.js';
import { formatDate, formatInstant } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { ViewSwitch, ViewToggle } from '../../ui/ViewSwitch.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Button } from '../../ui/Button.jsx';
import { Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { Card, SectionHeader, PageEmptyState, ErrorState, Glyph, DayBadge } from '../../kit/index.js';
import { openJournalSheet, openPhotoViewer, importPhotosWith } from '../../sheets/index.js';
import { PhotoInput } from '../../sheets/journal/PhotoInput.jsx';
import { checkInWith } from '../../sheets/journal/capture.js';
import { draftDays, draftVersion } from '../../sheets/journal/draft.js';
import { journalPhotoList, viewerArgsFor } from '../../sheets/photo/model.js';
import { EntryCard, EntryEmpty, AlbumCard } from './parts.jsx';
import {
  VIEWS, parseView, parseLayout, tripState, daySections, journalStats, albumGroups, authorOptions, scrollTarget, actionDay,
} from './model.js';

export default function JournalPage({ route }) {
  const tripId = route.params.tripId;
  const store = useTrip(tripId);
  const state = tripState(store);
  const trip = store?.trip.value || null;
  const timeZone = trip?.timezone;
  const me = authState.value.user?.id || null;
  const view = parseView(route.query.view, route.query.tab);
  const layout = parseLayout(route.query.layout);
  const author = route.query.who || '';

  const days = store?.view.days.value || [];
  const byDay = store?.view.journalByDay.value;
  const members = store?.view.members.value || [];
  const phase = store?.view.phase.value?.phase || null;
  const todayDate = store?.view.today.value?.day?.date || null;
  // 本机有草稿的天：草稿变了（draftVersion）才重新读，不然每次渲染都是新的 Set、下面的 useMemo 白做
  const draftTick = draftVersion.value;
  const drafts = useMemo(() => draftDays(tripId, me), [tripId, me, draftTick]);

  const sections = useMemo(
    () => daySections({ days, byDay, members, me, todayDate, drafts }),
    [days, byDay, members, me, todayDate, drafts],
  );
  const stats = useMemo(() => journalStats(sections), [sections]);
  const photoList = useMemo(() => journalPhotoList({ days, byDay }), [days, byDay]);
  const groups = useMemo(() => albumGroups({ list: photoList, days, author }), [photoList, days, author]);
  const authors = useMemo(() => authorOptions({ members, list: photoList, me }), [members, photoList, me]);
  const nameOf = (userId, member) => member?.display_name || store?.memberName(userId) || '成员';

  const mineDays = useMemo(() => new Set(sections.filter((s) => s.entries.some((e) => e.mine && e.entry)).map((s) => s.day.id)), [sections]);
  const target = actionDay({ days, phase, todayDate, mine: mineDays });

  // 打开页面先滚到 ?day= 或今天（只在刚打开、还在最上面时滚一次）
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || state !== 'ready' || view !== 'days') return;
    const date = scrollTarget({ query: route.query, phase, todayDate, sections });
    scrolled.current = true;
    if (!date || window.scrollY > 8) return;
    const el = document.getElementById(`jn-day-${date}`);
    el?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [state, sections.length]);

  const openWrite = (date, e) => openJournalSheet({ date, mode: 'text' }, { keyboard: true, trigger: e?.currentTarget });
  const openPhoto = (photo, el) => {
    haptic('selection');
    openPhotoViewer(viewerArgsFor(photo), { trigger: el });
  };
  const setView = (v) => {
    haptic('selection');
    // 概览页链接过来的 ?tab=photos 一起清掉，不然切回「按天」还是相册
    setQuery({ view: v === 'days' ? null : v, tab: null });
  };

  // ---------- 出错 / 找不到 ----------
  if (state === 'error') {
    return (
      <div class="jn" data-testid="page-journal">
        <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="journal-error" />
      </div>
    );
  }
  if (state === 'missing') {
    return (
      <div class="jn" data-testid="page-journal">
        <PageEmptyState
          preset="notfound"
          title="找不到这趟行程"
          description="可能已经被删除，或者你不是这趟行程的成员。"
          action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
        />
      </div>
    );
  }

  // ---------- 加载中（骨架）→ 加载完交叉淡入（ui/Reveal）；没有分天：什么都写不了 ----------
  const loading = state === 'loading';
  const skeleton = (
    <div class="jn__skel" data-testid="journal-loading">
      <span class="visually-hidden" role="status">正在读取日记…</span>
      <Skeleton variant="rect" height={44} radius="pill" />
      <Skeleton variant="text" width="46%" class="jn__skel-line" />
      <div class="jn__skel-row"><Skeleton variant="rect" height={48} radius="pill" /><Skeleton variant="rect" height={48} radius="pill" /></div>
      <div class="jn__skel-head"><Skeleton variant="rect" width={48} height={48} radius="md" /><Skeleton variant="text" lines={2} /></div>
      <div class="material-card jn__skel-card"><Skeleton variant="circle" size={44} /><Skeleton variant="text" lines={3} /></div>
      <div class="material-card jn__skel-card"><Skeleton variant="circle" size={44} /><Skeleton variant="text" lines={2} /></div>
    </div>
  );
  if (!loading && !days.length) {
    return (
      <div class="jn" data-testid="page-journal">
        <PageEmptyState
          preset="journal"
          description="这趟行程还没有定日期，先在行程里定下出发和返程的日子，就能按天写日记、放照片了。"
          action={<Button variant="secondary" href={href({ name: 'trip', params: { tripId } })}>去行程概览</Button>}
          data-testid="journal-empty-nodays"
        />
      </div>
    );
  }

  const statsText = stats.entries
    ? `${stats.entries} 篇日记 · ${stats.photos} 张照片${stats.writtenDays < stats.days ? ` · 还有 ${stats.days - stats.writtenDays} 天没写` : ''}`
    : `${days.length} 天 · 还没有日记`;

  // ---------- 按天 ----------
  // 结束以后「拍照打卡」用不上了：换成「补照片」（从相册挑一批，按拍摄日期分到每天，sheets/photo-import）
  const ended = phase === 'ended';
  const blank = stats.entries === 0;
  const targetText = target ? `D${days.indexOf(target) + 1} · ${formatDate(target.date, { timeZone, relative: true })}` : '';
  const actions = target && (
    <div class="jn__actions" data-testid="journal-actions">
      {ended ? (
        <PhotoInput multiple variant={blank ? 'primary' : 'secondary'} block onFiles={(files) => importPhotosWith(files)} testId="journal-action-import">补照片</PhotoInput>
      ) : (
        <PhotoInput camera onFiles={(files) => checkInWith(files, { date: target.date })} block testId="journal-action-camera">拍照打卡</PhotoInput>
      )}
      <Button variant="secondary" block leading={<Glyph name="pen" size={20} />} onClick={(e) => openWrite(target.date, e)} data-testid="journal-action-write">写日记</Button>
      {!blank && <p class="jn__actions-hint t-label">{ended ? `写日记记到 ${targetText}` : `记到 ${targetText}`}</p>}
    </div>
  );
  const daysView = blank ? (
    // 一篇都没有：空状态只说一次，下面是一行一天的目录（不再每天重复「还没写 / Cathy 还没写」）
    <div class="jn__days jn__days--blank" data-testid="journal-days-view">
      <div class="jn-blank" data-testid="journal-blank">
        <p class="jn-blank__lead">这趟还没有日记</p>
        <p class="jn-blank__text">{ended ? '挑一批照片，按拍摄日期自动分到每天；想写几句，点哪天都行。' : '拍张照、写两句，每天各一篇。点哪天都能写。'}</p>
      </div>
      {actions}
      <ol class="jn-index" aria-label="每天">
        {sections.map((s) => {
          const mine = s.entries.find((e) => e.mine);
          return (
            <li key={s.day.id} id={`jn-day-${s.day.date}`} class="jn-index__row" data-today={s.isToday ? '' : undefined} data-testid={`journal-day-${s.day.date}`}>
              <button type="button" class="jn-index__btn" data-press="highlight" onClick={(ev) => openWrite(s.day.date, ev)}>
                <DayBadge n={s.number} size="md" today={s.isToday} class="jn-index__badge" />
                <span class="jn-index__text">
                  <b>{s.day.title || formatDate(s.day.date, { timeZone })}</b>
                  <span class="t-label">{formatDate(s.day.date, { timeZone, relative: true })}</span>
                </span>
                <span class="jn-index__go t-label">{mine?.draft ? '继续写' : '写一篇'}<Glyph name="chev-r" size={14} stroke={2.2} /></span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  ) : (
    <div class="jn__days" data-testid="journal-days-view">
      {actions}

      {sections.map((s) => {
        // 标题是那天的标题，没有就用日期；小字写相对的日子（昨天 / 明天）——今天用日期 + 「今天」标签
        // （relative 会直接写成「今天」，和标签重复）；标题已经是日期时小字不再重复日期
        const abs = formatDate(s.day.date, { timeZone });
        const rel = formatDate(s.day.date, { timeZone, relative: true });
        const dateLine = s.day.title ? (s.isToday ? abs : rel) : (!s.isToday && rel !== abs ? rel : null);
        return (
          <section
            key={s.day.id}
            id={`jn-day-${s.day.date}`}
            class="jn-day"
            data-today={s.isToday ? '' : undefined}
            data-testid={`journal-day-${s.day.date}`}
            aria-labelledby={`jn-day-title-${s.day.id}`}
          >
            <header class="jn-day__head">
              <DayBadge n={s.number} size="lg" today={s.isToday} class="jn-day__badge" />
              <div class="jn-day__titles">
                <h2 id={`jn-day-title-${s.day.id}`} class="jn-day__title">
                  <span class="visually-hidden">第 {s.number} 天 </span>
                  {s.day.title || abs}
                </h2>
                {(dateLine || s.isToday || s.photoCount > 0) && (
                  <p class="jn-day__meta t-label">
                    {dateLine}
                    {s.isToday && <span class="jn-day__today">今天</span>}
                    {s.photoCount > 0 && `${dateLine || s.isToday ? ' · ' : ''}${s.photoCount} 张照片`}
                  </p>
                )}
              </div>
            </header>
            <div class="jn-day__entries">
            {s.entries.map((e) => {
              const name = nameOf(e.userId, e.member);
              return e.entry ? (
                <EntryCard
                  key={e.userId}
                  entry={e.entry}
                  member={e.member}
                  name={name}
                  mine={e.mine}
                  draft={e.draft}
                  timeZone={timeZone}
                  dayNumber={s.number}
                  day={s.day}
                  onEdit={e.mine ? (ev) => openWrite(s.day.date, ev) : undefined}
                  onOpenPhoto={openPhoto}
                />
              ) : (
                <EntryEmpty
                  key={e.userId}
                  name={name}
                  mine={e.mine}
                  draft={e.draft}
                  isToday={s.isToday}
                  onWrite={(ev) => openWrite(s.day.date, ev)}
                  onPhotos={(files) => checkInWith(files, { date: s.day.date })}
                />
              );
            })}
            </div>
          </section>
        );
      })}
    </div>
  );

  // ---------- 相册 ----------
  const albumView = (
    <div class="jn__album" data-testid="journal-album-view">
      {photoList.length === 0 ? (
        <PageEmptyState
          preset="photos"
          description={ended ? '从相册挑一批这趟拍的照片，按拍摄日期自动分到每天。' : undefined}
          action={ended ? (
            <PhotoInput multiple onFiles={(files) => importPhotosWith(files)} variant="primary" testId="journal-album-import">从相册挑照片</PhotoInput>
          ) : target ? <PhotoInput camera onFiles={(files) => checkInWith(files, { date: target.date })} variant="primary" testId="journal-album-camera">拍照打卡</PhotoInput> : null}
          data-testid="journal-empty-photos"
        />
      ) : (
        <>
          <div class="jn__album-bar">
            <div class="jn__who" role="group" aria-label="谁拍的" data-testid="journal-who">
              {authors.map((a) => (
                <Chip
                  key={a.value || 'all'}
                  size="sm"
                  selected={author === a.value}
                  count={a.count}
                  onToggle={() => {
                    haptic('selection');
                    setQuery({ who: a.value || null });
                  }}
                  data-testid={`journal-who-${a.value || 'all'}`}
                >
                  {a.label}
                </Chip>
              ))}
            </div>
            <ViewToggle value={layout} onChange={(v) => setQuery({ layout: v === 'grid' ? null : v })} data-testid="journal-layout" />
          </div>
          {groups.length === 0 ? (
            <Card padding="sm"><p class="jn__none">{authors.find((a) => a.value === author)?.label || '这个人'}还没有照片。</p></Card>
          ) : groups.map(({ day, photos }) => {
            const n = days.indexOf(day) + 1;
            return (
              <section key={day.id} class="jn__album-day" data-testid={`album-day-${day.date}`}>
                <SectionHeader
                  title={`D${n} · ${formatDate(day.date, { timeZone, relative: true })}`}
                  count={photos.length}
                  meta={day.title || undefined}
                  level={2}
                />
                <ViewSwitch
                  view={layout}
                  items={photos}
                  getKey={(p) => p.key}
                  label={`第 ${n} 天的照片`}
                  renderItem={(p, v) => (
                    <AlbumCard
                      photo={p}
                      view={v}
                      who={nameOf(p.userId, members.find((m) => m.user_id === p.userId))}
                      when={p.takenAt ? formatInstant(p.takenAt, { timeZone, date: false }) : ''}
                      dayNumber={n}
                      onOpen={openPhoto}
                    />
                  )}
                />
              </section>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <div class="jn" data-testid="page-journal" data-view={view} aria-busy={loading ? 'true' : undefined}>
      <Reveal loading={loading} skeleton={skeleton}>
        {!loading && (
          <>
            <div class="jn__top">
              <SegmentedControl label="日记视图" value={view} onChange={setView} options={VIEWS} class="seg--glass" data-testid="journal-view" />
              {!(blank && view === 'days') && <p class="jn__stats t-label" data-testid="journal-stats">{statsText}</p>}
            </div>
            {view === 'days' ? daysView : albumView}
          </>
        )}
      </Reveal>
    </div>
  );
}
