// =====================================================================
// pages/contacts/ContactsPage.jsx：联系人（路由 contacts，#/t/:tripId/contacts，SPEC §5.11）。
//
// 大标题「联系人」、返回、右上全局搜索由外壳画（shell/ 的 section 页）；这里只放内容：
//   - 本页搜索框（名字、身份、备注、关联的预订 / 地点名；号码按数字；越南语不带声调也能搜，?q=）
//   - 类别芯片：全部 / 今天（行程进行中、今天用得上的）/ 紧急 / 酒店 / 交通 …（带数量，一行横滑，?cat=）
//   - 按类别分组，紧急在最上面；每个联系人一张卡（ui/ExpandableCard 原地展开，一次只开一张）：
//       收起：类别图标、名字、身份 · 关联预订 / 地点、号码（等宽）、备注一行；右边 1–2 个快捷圆钮（打电话 + WhatsApp / Zalo）
//       展开：每个号码一行（点了复制）、带字的大按钮（打电话 / WhatsApp / Zalo / 邮件）、邮箱 / 微信 / LINE（点了复制）、
//             备注全文、关联的预订（开预订详情）和地点（开地点详情）
//   - 网址带 ?contact=<id>（全局搜索的结果）：展开那一个、滚到屏幕中间、闪一下
//   - 添加 / 编辑联系人：列表最后「添加联系人」、展开后「编辑」→ 页面里的底部面板 contact-edit（ContactSheet.jsx）
// 只读成员：所有动作照常能用（打电话、发消息、复制都不改数据）；添加、编辑的入口换成一句说明。
// 结构和数据说明见同目录 README.md；纯逻辑在 model.js（test/unit/page-tips.test.js 的「联系人」一节）。
// =====================================================================

import './contacts.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { setQuery } from '../../router/index.js';
import { useAccordion } from '../../ui/ExpandableCard.jsx';
import { Button } from '../../ui/Button.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PageEmptyState, ErrorState } from '../../kit/States.jsx';
import { haptic } from '../../lib/native.js';
import { zonedParts } from '../../lib/datetime.js';
import {
  pageState, useSkeletonHold, useUrlText, PageSearch, FilterChips, MissingTrip, useFocusOnce,
} from '../tips/common.jsx';
import { ContactCard } from './parts.jsx';
import { ContactSheet, openContactSheet } from './ContactSheet.jsx';
import { newArg } from './form.js';
import {
  CATEGORY_TITLES, normalizeCategoryFilter, groupContacts, linksOf, isTodayContact, bookingSpan, summaryLine,
} from './model.js';

export default function ContactsPage({ route }) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const state = pageState(store);
  const loading = state === 'loading';
  const skeleton = useSkeletonHold(loading);

  let body = null;
  if (state === 'error') body = <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="contacts-error" />;
  else if (state === 'missing') body = <MissingTrip testId="contacts-missing" />;
  else if (state === 'ready') body = <Contacts store={store} route={route} />;

  return (
    <div class="ct" data-testid="page-contacts">
      <Reveal loading={loading} skeleton={skeleton ? <ContactsSkeleton /> : null}>
        {loading && <span class="visually-hidden" role="status">正在读取联系人…</span>}
        {body}
      </Reveal>
      {/* 添加 / 编辑联系人：页面里的底部面板，无条件渲染（刷新、返回都能恢复） */}
      <ContactSheet store={store} canEdit={Boolean(store?.view.canEdit.value)} />
    </div>
  );
}

/** 「添加联系人」（只读成员换成一句说明） */
function AddContact({ canEdit, category }) {
  if (!canEdit) {
    return <p class="ct-readonly" data-testid="contacts-readonly">你是只读成员：可以打电话、发消息、复制，不能添加或修改联系人。</p>;
  }
  return (
    <Button
      variant="secondary"
      block
      class="ct-add"
      leading={<Glyph name="plus" size={18} stroke={2.2} />}
      data-overlay-trigger="contact-edit"
      data-testid="contacts-add"
      onClick={(e) => openContactSheet(newArg(category === 'today' ? null : category), { trigger: e.currentTarget })}
    >
      添加联系人
    </Button>
  );
}

/** 加载中：和真实版式一样的骨架（搜索框、芯片、段标题、几张卡片） */
function ContactsSkeleton() {
  return (
    <div class="ct-skel">
      <Skeleton variant="rect" height={46} radius="pill" />
      <div class="ct-skel__chips">
        {[64, 58, 70, 64, 76].map((w, i) => <Skeleton key={i} variant="rect" width={w} height={32} radius="pill" />)}
      </div>
      <Skeleton variant="text" width="22%" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="ct-skel__card material-card">
          <Skeleton variant="rect" width={40} height={40} radius="md" />
          <div class="ct-skel__lines">
            <Skeleton variant="text" width="52%" />
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="text" width="60%" />
          </div>
          <Skeleton variant="circle" width={44} height={44} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 有数据时
// ---------------------------------------------------------------------

function Contacts({ store, route }) {
  const tripId = store.tripId;
  const trip = store.trip.value;
  const contacts = store.view.contacts.value;
  const bookings = store.tables.bookings.value;
  const places = store.tables.places.value;
  const itemsByDay = store.view.itemsByDay.value;
  const canEdit = store.view.canEdit.value;
  const phase = store.view.phase.value?.phase;
  const today = phase === 'ongoing' ? store.view.today.value : null;
  const todayDayId = today?.day?.id || null;
  const todayDate = today?.day?.date || today?.local?.date || null;

  const cat = normalizeCategoryFilter(route.query.cat);
  const [query, setQueryText] = useUrlText(route, 'q');
  const focusId = route.query.contact || null;
  const searching = Boolean(query.trim());

  // ---- 今天用得上：关联的预订今天开始 / 进行中，或者关联的地点在今天的安排里 ----
  const todayPlaceIds = useMemo(() => {
    if (!todayDayId) return null;
    return new Set((itemsByDay.get(todayDayId) || []).map((i) => i.place_id).filter(Boolean));
  }, [todayDayId, itemsByDay]);
  const todayOf = useMemo(() => {
    if (!todayDate) return () => false;
    const toLocal = (at, tz) => zonedParts(at, tz).date;
    const spans = new Map();
    const bookingDates = (id) => {
      if (!spans.has(id)) spans.set(id, bookingSpan(bookings.get(id), toLocal, trip?.timezone));
      return spans.get(id);
    };
    return (c) => isTodayContact(c, { todayDate, todayPlaceIds, bookingDates });
  }, [todayDate, todayPlaceIds, bookings, trip?.timezone]);

  const linksFor = useMemo(() => {
    const cache = new Map();
    return (c) => {
      if (!cache.has(c.id)) cache.set(c.id, linksOf(c, { bookings, places }));
      return cache.get(c.id);
    };
  }, [bookings, places]);

  const view = useMemo(
    () => groupContacts(contacts, { query, category: cat, linksFor, todayOf }),
    [contacts, query, cat, linksFor, todayOf],
  );

  // 芯片：今天（进行中且有）+ 数据里有的类别；数量跟着搜索走
  const chipOptions = useMemo(() => {
    const all = groupContacts(contacts, { linksFor, todayOf });
    const hit = new Map(view.counts.map((c) => [c.cat, c.count]));
    const opts = [];
    if (all.todayCount > 0) opts.push({ value: 'today', label: '今天', count: view.todayCount, glyph: 'sun' });
    for (const c of all.counts) opts.push({ value: c.cat, label: c.label, count: hit.get(c.cat) || 0 });
    return opts;
  }, [contacts, linksFor, todayOf, view]);

  const setCat = (v) => {
    haptic('selection');
    setQuery({ cat: v === 'all' ? null : v });
  };
  const clearFilters = () => {
    setQueryText('');
    setQuery({ q: null, cat: null });
  };

  // ---- 一次只开一张；网址带 ?contact= 进来时先开那一张 ----
  const focusContact = focusId ? contacts.find((c) => c.id === focusId) : null;
  const acc = useAccordion(focusContact ? focusId : null);
  useEffect(() => {
    if (focusContact) acc.setOpenId(focusId);
  }, [focusId]);
  // 带着 ?contact= 进来但被筛选藏起来了：清掉筛选（搜索结果一定要看得见）
  useEffect(() => {
    if (!focusContact) return;
    const shown = view.groups.some((g) => g.rows.some((r) => r.contact.id === focusId));
    if (!shown) {
      setQueryText('');
      setQuery({ q: null, cat: null });
    }
  }, [focusId]);
  const flash = useFocusOnce(focusId, Boolean(focusContact), (id) => `[data-contact-id="${CSS.escape(id)}"]`);

  const ctx = useMemo(() => ({ tripId, flash, canEdit }), [tripId, flash, canEdit]);

  const total = contacts.length;
  const emergency = contacts.filter((c) => c.category === 'emergency').length;
  const summary = summaryLine({ total, shown: view.shown, emergency, searching, category: cat });

  if (!total) {
    return (
      <PageEmptyState
        preset="contacts"
        description="酒店前台、司机、餐厅、紧急电话都会放在这里：一键打电话、WhatsApp、Zalo，号码点一下就复制。"
        action={canEdit ? (
          <Button
            variant="secondary"
            leading={<Glyph name="plus" size={18} stroke={2.2} />}
            data-testid="contacts-add"
            onClick={(e) => openContactSheet('new', { trigger: e.currentTarget })}
          >
            添加联系人
          </Button>
        ) : null}
        testId="contacts-empty"
      />
    );
  }

  const filtered = searching || cat !== 'all';
  return (
    <div class="ct__stack">
      <div class="ct-tools">
        {total > 4 && (
          <PageSearch
            value={query}
            onValue={setQueryText}
            placeholder="搜名字、号码、酒店、餐厅"
            label="在联系人里搜索"
            testId="contacts-search"
          />
        )}
        <FilterChips
          value={cat}
          onChange={setCat}
          options={chipOptions}
          total={view.matched}
          label="按类别筛选"
          testId="contacts-cats"
          layout="scroll"
        />
      </div>

      {summary && <p class="pg-summary" data-testid="contacts-summary" aria-live="polite">{summary}</p>}

      {!view.shown && (
        <EmptyState
          compact
          class="ct-none"
          icon={(p) => <Glyph name="search" size={p.size} />}
          title={searching ? `没有找到「${query.trim()}」` : cat === 'today' ? '今天没有要联系的' : `没有${CATEGORY_TITLES[cat] || ''}联系人`}
          description={searching ? '换个说法试试：名字、号码（只打数字也行）、酒店名、不带声调的越南语都可以搜。' : null}
          action={filtered ? <Button variant="secondary" size="sm" onClick={clearFilters}>{searching ? '清除搜索' : '看全部'}</Button> : null}
          data-testid="contacts-none"
        />
      )}

      {view.groups.map((g) => (
        <section key={g.cat} class="ct-group" data-cat={g.cat} data-testid={`contacts-group-${g.cat}`} aria-labelledby={`ct-h-${g.cat}`}>
          <SectionHeader
            id={`ct-h-${g.cat}`}
            title={g.label}
            count={g.rows.length}
            meta={g.cat === 'emergency' ? '报警、急救、医院、领事：点右边的圆钮直接拨号' : null}
          />
          <div class="ct-list">
            {g.rows.map((row) => <ContactCard key={row.contact.id} row={row} ctx={ctx} acc={acc} />)}
          </div>
        </section>
      ))}

      <AddContact canEdit={canEdit} category={cat} />
    </div>
  );
}
