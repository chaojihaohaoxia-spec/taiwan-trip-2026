// =====================================================================
// dev/pages/KitPage.jsx：页面共用组件一览（#/dev/kit）——kit/ 的每个组件、每种状态，sheets/ 的弹层登记表。
//
// 数据：演示行程「椰影岛」（data/ 的 useTrip('demo-island')，全部虚构）。打开这一页时网址自动带上 ?trip=demo-island，
// 给司机看、记一笔这些全站弹层据此知道是哪一趟（sheets/hooks.js 的 useSheetTrip）。
// 边界情况（没坐标、只有名字、什么都没有、只精确到城市）用页面里现拼的地点对象演示（同样是虚构的）。
// e2e：test/e2e/kit.e2e.mjs。
// =====================================================================

import './kit-page.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { setQuery } from '../../router/index.js';
import { now } from '../../lib/clock.js';
import { useTrip, useMyTrips } from '../../data/index.js';
import { Button } from '../../ui/Button.jsx';
import {
  Card, SectionHeader, ListRow, InfoRow, Divider, MoneyText, KindIcon, Glyph, StatusChip, PhaseChip, PersonChip, CountdownText,
  DateLabel, CopyText, PlaceActions, PageEmptyState, ErrorState, InlineAdd, SwipeRow, EMPTY_PRESETS, KIND_LABELS, GLYPH_NAMES, kindLabel,
  searchTrip, flattenResults, moveActive, SearchResults,
} from '../../kit/index.js';
import { STATUS } from '../../kit/status.js';
import { SHEETS, openDriverCard, openExpenseSheet, openItemSheet, openPlaceSheet, openReviewSheet, openBookingSheet, openTodoSheet,
  openJournalSheet, openPhotoViewer, openTripNewSheet, openInviteSheet } from '../../sheets/index.js';

const TRIP = 'demo-island';
const HOUR = 3_600_000;
const iso = (ms) => new Date(now().getTime() + ms).toISOString();

function Section({ id, title, note, children }) {
  return (
    <section class="dev-section kit-section" id={`kit-${id}`} data-testid={`kit-${id}`}>
      <h2 class="dev-section__title">{title}</h2>
      {note && <p class="dev-section__note">{note}</p>}
      <div class="kit-section__body">{children}</div>
    </section>
  );
}

/** 两个并排的样本（手机上一列） */
function Pair({ children }) {
  return <div class="kit-pair">{children}</div>;
}

// ---------------------------------------------------------------------

function Cards({ store }) {
  const tid = { tripId: TRIP };
  return (
    <Pair>
      <Card title="出发前待办" meta="还剩 5 项" footer={<Button variant="secondary" block>查看全部待办</Button>}>
        <ListRow title="填入境申报" subtitle="抵达前 72 小时内 · 两人各一份" glyph="id" />
        <ListRow title="两人各买 eSIM" subtitle="出发前" glyph="phone" />
      </Card>
      <Card eyebrow="距离出发还有" action={<StatusChip kind="booking" value="booked" />}>
        <p class="kit-figure t-figure-italic">5<span class="t-serif">天</span></p>
      </Card>
      <Card to={{ name: 'ledger', params: tid }} title="今天花了" glyph="wallet" testId="kit-card-link">
        <MoneyText amount={1180000} currency="VND" size="xl" />
      </Card>
      <Card onClick={() => openExpenseSheet()} title="整张卡是按钮" eyebrow="onClick" testId="kit-card-button">
        <p class="dev-muted">点任意处打开「记一笔」（占位弹层）。</p>
      </Card>
      <Card tone="accent" eyebrow="现在 · 10:30–12:00" title="珊瑚小岛浮潜" glyph="wave">
        <p class="dev-muted">tone="accent"：要突出的卡（“现在 / 接下来”）。</p>
      </Card>
      <Card tone="warning" eyebrow="快到期" title="海景屋免费取消还剩 5 小时" padding="sm">
        <p class="dev-muted">tone="warning" + padding="sm"。</p>
      </Card>
      {store && <p class="dev-muted kit-span">数据：{store.trip.value?.title || '读取中…'}</p>}
    </Pair>
  );
}

function Headers() {
  return (
    <div class="kit-stack">
      <SectionHeader title="四天安排" count={4} />
      <SectionHeader title="备选池" meta="还没排进哪天的条目" action={{ label: '全部地点', to: { name: 'places', params: { tripId: TRIP } } }} />
      <SectionHeader title="一个特别长特别长的段标题，看看在手机上怎么折行" count={128} action={{ label: '添加', glyph: 'plus', onClick: () => {} }} />
    </div>
  );
}

function Rows() {
  const [checked, setChecked] = useState(false);
  return (
    <Pair>
      <Card padding="sm" title="ListRow">
        <ListRow leading={<KindIcon type="expense" kind="餐饮" tile />} title="夜市烤海鲜" subtitle="1月10日 · Jeremy 付 · 平摊"
          value={<MoneyText amount={520000} currency="VND" hkd="below" align="end" />} onClick={() => setChecked(!checked)} />
        <ListRow leading={<KindIcon type="place" kind="hub" tile />} title="椰影码头" subtitle="Bến tàu Dừa · 交通站点" to={{ name: 'places', params: { tripId: TRIP } }} />
        <ListRow glyph="bed" title="一个超长的标题：从椰影码头搭早班渡轮去对面的珊瑚小岛浮潜、在岛上吃海鲜午餐，再绕到白灯塔看日落" subtitle="两行以后省略" />
        <ListRow glyph="flag" title="已跳过的条目" subtitle="dim：完成 / 跳过淡化" dim value={<StatusChip kind="item" value="skipped" size="sm" />} />
        <ListRow glyph="trash" title="删除这趟行程" tone="danger" onClick={() => {}} />
        <ListRow title="没有图标、不可点的一行" value="12 项" />
        <ListRow title="禁用" subtitle="disabled" glyph="ticket" onClick={() => {}} disabled />
      </Card>
      <Card padding="md" title="InfoRow / Divider">
        <InfoRow glyph="star">Google 5.0 · 682 条，没有冷评</InfoRow>
        <InfoRow glyph="wallet">约 45 万越南盾/人（约 HK$136）</InfoRow>
        <InfoRow glyph="clock" tone="warning">开到 23:00 · 快打烊了</InfoRow>
        <InfoRow glyph="pin">118/2/1 Đường Hoa Sứ（虚构地址）</InfoRow>
        <Divider />
        <InfoRow pair label="订单号"><CopyText text="DEMO-FL01" label="订单号" mono size="sm" /></InfoRow>
        <InfoRow pair label="付款"><StatusChip kind="payment" value="pay_at_property" /></InfoRow>
        <Divider label="备选方案" />
        <InfoRow glyph="drop" tone="muted">下雨就改去历史馆</InfoRow>
        <Divider inset />
        <p class="dev-muted">Divider inset：从文字处开始。</p>
      </Card>
    </Pair>
  );
}

const MONEY = [
  [400000, 'VND'], [88.5, 'HKD'], [300, 'CNY'], [1280, 'TWD'], [12.5, 'USD'], [1500, 'JPY'], [0, 'VND'],
];

function Money() {
  return (
    <Pair>
      <Card title="正文大小（md / sm）">
        {MONEY.map(([a, c]) => (
          <InfoRow key={c + a} pair label={c}><MoneyText amount={a} currency={c} /></InfoRow>
        ))}
        <InfoRow pair label="readable"><MoneyText amount={450000} currency="VND" readable /></InfoRow>
        <InfoRow pair label="sm"><MoneyText amount={1236000} currency="VND" size="sm" /></InfoRow>
        <InfoRow pair label="signed +"><MoneyText amount={418.66} currency="HKD" signed /></InfoRow>
        <InfoRow pair label="signed −"><MoneyText amount={-2625.63} currency="CNY" signed /></InfoRow>
        <InfoRow pair label="hkd none"><MoneyText amount={400000} currency="VND" hkd="none" /></InfoRow>
      </Card>
      <Card title="大号数字（lg / xl / 2xl / 3xl）">
        <div class="kit-stack">
          <MoneyText amount={520000} currency="VND" size="lg" />
          <MoneyText amount={1180000} currency="VND" size="xl" />
          <MoneyText amount={2625.63} currency="CNY" size="2xl" />
          <MoneyText amount={12360000} currency="VND" size="3xl" readable />
          <MoneyText amount={-418.66} currency="HKD" size="xl" signed />
        </div>
      </Card>
    </Pair>
  );
}

function Kinds() {
  const types = ['item', 'place', 'booking', 'contact', 'expense', 'transport', 'todo', 'tip'];
  return (
    <div class="kit-stack">
      {types.map((t) => (
        <div key={t} class="kit-kinds">
          <p class="kit-kinds__type">{t}</p>
          <div class="kit-kinds__grid">
            {Object.keys(KIND_LABELS[t]).map((k) => (
              <figure key={k} class="kit-kind">
                <KindIcon type={t} kind={k} tile />
                <figcaption>{kindLabel(t, k)}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
      <div class="kit-kinds">
        <p class="kit-kinds__type">tile 尺寸和语气</p>
        <div class="kit-kinds__grid">
          {[['xs', 'accent'], ['sm', 'soft'], ['md', 'solid'], ['lg', 'neutral']].map(([s, tone]) => (
            <figure key={s} class="kit-kind">
              <KindIcon type="item" kind="spa" tile={s} tone={tone} />
              <figcaption>{s} · {tone}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div class="kit-kinds">
        <p class="kit-kinds__type">全部图形（kit/glyphs.js，{GLYPH_NAMES.length} 个）</p>
        <div class="kit-glyphs">
          {GLYPH_NAMES.map((n) => (
            <figure key={n} class="kit-glyph">
              <Glyph name={n} size={24} />
              <figcaption>{n}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

function Statuses({ trips, members }) {
  const deadlines = useMemo(() => [
    ['已经过了', iso(-2 * HOUR)], ['不到 1 天', iso(5 * HOUR)], ['1–3 天', iso(51 * HOUR)], ['3 天以后', iso(9 * 24 * HOUR)],
  ], []);
  return (
    <Pair>
      <Card title="StatusChip">
        {Object.entries(STATUS).map(([kind, table]) => (
          <div key={kind} class="kit-chips">
            <span class="kit-chips__label">{kind}</span>
            {Object.keys(table).map((v) => <StatusChip key={v} kind={kind} value={v} />)}
          </div>
        ))}
        <div class="kit-chips">
          <span class="kit-chips__label">免费取消</span>
          {deadlines.map(([label, at]) => <StatusChip key={label} deadline={at} timeZone="Asia/Ho_Chi_Minh" data-case={label} />)}
        </div>
        <div class="kit-chips">
          <span class="kit-chips__label">short</span>
          {deadlines.map(([label, at]) => <StatusChip key={label} deadline={at} timeZone="Asia/Ho_Chi_Minh" short size="sm" />)}
        </div>
      </Card>
      <Card title="阶段 / 成员 / 时间">
        <div class="kit-stack">
          {trips.map(({ trip }) => (
            <div key={trip.id} class="kit-chips"><span class="kit-chips__label">{trip.title}</span><PhaseChip trip={trip} detail /></div>
          ))}
          <div class="kit-chips"><span class="kit-chips__label">没日期</span><PhaseChip trip={{ title: '未定' }} detail /></div>
          <div class="kit-chips">
            {members.map((m, i) => <PersonChip key={m.user_id} member={m} you={i === 0} />)}
            <PersonChip name="没有颜色的人" size="sm" />
          </div>
          <InfoRow pair label="CountdownText"><CountdownText to={iso(51 * HOUR + 20 * 60_000)} /></InfoRow>
          <InfoRow pair label="到点后"><CountdownText to={iso(-HOUR)} expired="已经出发了" /></InfoRow>
          <InfoRow pair label="DateLabel"><DateLabel date="2027-01-10" /></InfoRow>
          <InfoRow pair label="relative"><DateLabel at={now()} timeZone="Asia/Ho_Chi_Minh" relative time /></InfoRow>
          <InfoRow pair label="时刻"><DateLabel at="2027-01-10T00:05:00Z" timeZone="Asia/Hong_Kong" time year="never" /></InfoRow>
        </div>
      </Card>
    </Pair>
  );
}

function Copies() {
  return (
    <Card title="CopyText">
      <div class="kit-stack">
        <div class="kit-chips"><span class="kit-chips__label">订单号</span><CopyText text="DEMO-FL01" label="订单号" mono data-testid="kit-copy-code" /></div>
        <div class="kit-chips"><span class="kit-chips__label">小号</span><CopyText text="+00 000 0000 0001" label="电话" size="sm" /></div>
        <CopyText block label="地址" text={'Nhà Thùng Nước Mắm Ông Lâm\nTổ 7, Ấp Rạch Vẹm, Xã Gành Dầu, Đường ven biển Tây Bắc nối dài（虚构地址）'} />
      </div>
    </Card>
  );
}

/** 页面里现拼的边界地点（虚构；没存进数据库、没有 id，所以「给司机看」是禁用的） */
const EDGE = {
  addressOnly: { name: '没有坐标的小店', name_local: 'Quán Nhỏ', address: '9 Đường Hoa Sứ, Thị trấn Dừa（虚构地址）', lat: null, lng: null },
  nameOnly: { name: '只有名字的地方', name_local: 'Chỗ Không Tên', lat: null, lng: null },
  city: { name: '只精确到城市', name_local: 'Thị trấn Dừa', lat: 8.68, lng: 106.6, coord_precision: 'city', address: 'Thị trấn Dừa（虚构地址）' },
  nothing: { name: '', address: '' },
};

function Actions({ places }) {
  const hotel = places.find((p) => p.name === '椰影湾酒店');
  const longAddr = places.find((p) => (p.address || '').length > 100);
  // 下车点（SPEC §10）：园区里的餐厅 → 在度假村大堂下车；海上的桥 → 岸上的看台；只能坐缆车的小岛 → 叫车去缆车站
  const viaPlace = places.find((p) => p.extra?.ride_via && !p.extra?.no_road && p.kind === 'food');
  const seaPlace = places.find((p) => p.extra?.ride_via && !p.extra?.no_road && p.kind !== 'food');
  const noRoad = places.find((p) => p.extra?.no_road);
  return (
    <div class="kit-stack">
      {viaPlace && (
        <Card eyebrow="下车点 · 叫 Grab、给司机看去度假村大堂，导航仍到餐厅" title={viaPlace.name} testId="kit-actions-via">
          <PlaceActions place={viaPlace} testId="kit-pa-via" />
        </Card>
      )}
      {seaPlace && (
        <Card eyebrow="海上的点 · 叫车去岸上的看台，导航仍到桥" title={seaPlace.name} testId="kit-actions-sea">
          <PlaceActions place={seaPlace} testId="kit-pa-sea" />
        </Card>
      )}
      {noRoad && (
        <Card eyebrow="开车到不了 · 叫车去缆车站" title={noRoad.name} testId="kit-actions-noroad">
          <PlaceActions place={noRoad} testId="kit-pa-noroad" />
        </Card>
      )}
      {hotel && (
        <Card eyebrow="完整 · 主要动作 grab · 打电话 · 记一笔" title={hotel.name} testId="kit-actions-hotel">
          <PlaceActions place={hotel} primary="grab" call expense={{ date: '2027-01-11' }} testId="kit-pa-hotel" />
        </Card>
      )}
      {hotel && (
        <Card eyebrow="紧凑" title={hotel.name} padding="sm" testId="kit-actions-compact">
          <PlaceActions place={hotel} size="compact" call primary="nav" testId="kit-pa-compact" />
        </Card>
      )}
      {longAddr && (
        <Card eyebrow="超长越南语地址 · 步行导航" title={longAddr.name} testId="kit-actions-long">
          <PlaceActions place={longAddr} mode="walk" testId="kit-pa-long" />
        </Card>
      )}
      <Card eyebrow="没有坐标（只带地址和名字）" title={EDGE.addressOnly.name}>
        <PlaceActions place={EDGE.addressOnly} testId="kit-pa-address-only" />
      </Card>
      <Card eyebrow="只有名字" title={EDGE.nameOnly.name}>
        <PlaceActions place={EDGE.nameOnly} testId="kit-pa-name-only" />
      </Card>
      <Card eyebrow="坐标只精确到城市" title={EDGE.city.name}>
        <PlaceActions place={EDGE.city} size="compact" testId="kit-pa-city" />
      </Card>
      <Card eyebrow="什么都没有" title="（空地点）">
        <PlaceActions place={EDGE.nothing} expense readOnly testId="kit-pa-nothing" />
      </Card>
    </div>
  );
}

function Driver({ places, tips }) {
  const hotel = places.find((p) => p.name === '椰影湾酒店');
  const longAddr = places.find((p) => (p.address || '').length > 100);
  const noAddr = places.find((p) => !p.address && p.lat === null);
  const phrase = tips.find((t) => t.kind === 'phrase' && t.local_text);
  const template = tips.find((t) => t.kind === 'template' && (t.local_text || '').length > 80 && t.local_lang === 'vi');
  const viaPlace = places.find((p) => p.extra?.ride_via && !p.extra?.no_road && p.kind === 'food');
  const seaPlace = places.find((p) => p.extra?.ride_via && !p.extra?.no_road && p.kind !== 'food');
  const noRoad = places.find((p) => p.extra?.no_road);
  const cases = [
    ['hotel', '酒店（有电话）', hotel],
    ['via', '下车点（园区里的餐厅）', viaPlace],
    ['sea', '下车点（海上的桥 → 岸上看台）', seaPlace],
    ['noroad', '开车到不了（坐缆车）', noRoad],
    ['long', '超长越南语地址', longAddr],
    ['noaddr', '没地址也没坐标', noAddr],
    ['phrase', '常用语', phrase],
    ['template', '长消息模板', template],
  ].filter(([, , x]) => x);
  return (
    <div class="kit-driver">
      {cases.map(([key, label, x]) => (
        <button
          key={key}
          type="button"
          class="kit-driver__btn material-raised"
          data-press="scale"
          data-overlay-trigger="driver"
          data-overlay-arg={x.id}
          onClick={(e) => openDriverCard(x.id, { trigger: e.currentTarget })}
          data-testid={`kit-driver-${key}`}
        >
          <Glyph name={key === 'phrase' || key === 'template' ? 'languages' : 'show'} size={20} />
          <span>{label}</span>
        </button>
      ))}
      <button type="button" class="kit-driver__btn material-raised" data-press="scale" onClick={() => openDriverCard('00000000-0000-0000-0000-000000000000')} data-testid="kit-driver-missing">
        <Glyph name="x" size={20} />
        <span>找不到的 id</span>
      </button>
    </div>
  );
}

function States() {
  return (
    <div class="kit-stack">
      <div class="kit-presets">
        {Object.keys(EMPTY_PRESETS).map((p) => (
          <div key={p} class="kit-preset material-card"><PageEmptyState preset={p} compact /></div>
        ))}
      </div>
      <Pair>
        <div class="material-card kit-preset"><PageEmptyState preset="ledger" action={<Button leading={<Glyph name="plus" size={20} stroke={2.2} />}>记一笔</Button>} /></div>
        <div class="material-card kit-preset"><ErrorState error={{ message: '网络太慢，请求超时了，稍后会自动重试', kind: 'network' }} onRetry={() => {}} /></div>
        <div class="material-card kit-preset"><ErrorState error={{ message: '没有权限做这个操作', kind: 'permission' }} onRetry={() => {}} /></div>
        <div class="material-card kit-preset"><ErrorState error={new Error('TypeError: x is undefined')} /></div>
      </Pair>
    </div>
  );
}

function Adds() {
  const [items, setItems] = useState(['防晒霜', '泳镜']);
  return (
    <Pair>
      <Card title="InlineAdd" meta={`${items.length} 项`} testId="kit-add-card">
        <ul class="kit-add-list" data-testid="kit-add-list">
          {items.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}
        </ul>
        <InlineAdd
          label="添加打包项"
          placeholder="加一项打包，回车接着加"
          onAdd={(text) => {
            if (text.includes('错')) throw new Error('演示：字里有「错」就加不上');
            setItems((list) => [...list, text]);
          }}
          testId="kit-add"
        />
      </Card>
      <Card title="只读成员">
        <InlineAdd label="添加打包项" placeholder="加一项打包" disabled disabledReason="只读成员不能添加" testId="kit-add-disabled" />
      </Card>
    </Pair>
  );
}

const SWIPE_ROWS = [
  { id: 's1', title: '夜市烤海鲜', amount: 520000, cat: '餐饮' },
  { id: 's2', title: '电动车租半天', amount: 150000, cat: '交通' },
  { id: 's3', title: '椰子冰 × 2', amount: 60000, cat: '餐饮' },
  { id: 's4', title: '手作市集的明信片', amount: 45000, cat: '购物' },
];

function Swipes() {
  const [rows, setRows] = useState(SWIPE_ROWS.map((r) => ({ ...r, done: false })));
  const [log, setLog] = useState('');
  return (
    <Card title="SwipeRow" meta="往左拖；拉到底直接删" padding="sm" testId="kit-swipe-card">
      {rows.map((r) => (
        <SwipeRow
          key={r.id}
          label={r.title}
          fullSwipe="delete"
          testId={`kit-swipe-${r.id}`}
          actions={[
            { key: 'done', label: r.done ? '取消' : '完成', glyph: r.done ? 'refresh' : 'check', tone: 'success', onAction: () => {
              setRows((list) => list.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)));
              setLog(`「${r.title}」${r.done ? '取消完成' : '完成'}`);
            } },
            { key: 'delete', label: '删除', glyph: 'trash', tone: 'danger', onAction: () => {
              setRows((list) => list.filter((x) => x.id !== r.id));
              setLog(`删除了「${r.title}」`);
            } },
          ]}
        >
          <ListRow
            onClick={() => setLog(`点了「${r.title}」`)}
            leading={<KindIcon type="expense" kind={r.cat} tile />}
            title={r.title}
            subtitle={r.done ? '已完成' : r.cat}
            dim={r.done}
            value={<MoneyText amount={r.amount} currency="VND" hkd="below" align="end" />}
            chevron={false}
          />
        </SwipeRow>
      ))}
      {!rows.length && <PageEmptyState preset="ledger" compact title="都删完了" description="刷新页面恢复演示数据。" />}
      <p class="dev-muted kit-log" role="status" data-testid="kit-swipe-log">{log || '还没有操作'}</p>
      <Button variant="text" size="sm" onClick={() => setRows(SWIPE_ROWS.map((r) => ({ ...r, done: false })))}>恢复</Button>
    </Card>
  );
}

function Search({ store }) {
  const [q, setQ] = useState('ben tau');
  const [active, setActive] = useState(-1);
  const groups = store && q.trim() ? searchTrip(store.bundle, q, { limit: 3 }) : [];
  const flat = flattenResults(groups);
  return (
    <Card title="搜索（kit/search）" meta={q.trim() ? `${flat.length} 条` : ''} testId="kit-search-card">
      <input
        class="kit-search-input"
        type="search"
        value={q}
        aria-label="搜索这趟行程"
        role="combobox"
        aria-controls="kit-search-list"
        aria-expanded={flat.length ? 'true' : 'false'}
        aria-activedescendant={active >= 0 ? `kit-search-opt-${active}` : undefined}
        placeholder="试试：夜市、pho、ben tau、GRAB、demo-fl"
        onInput={(e) => {
          setQ(e.currentTarget.value);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => moveActive(flat.length, i, e.key === 'ArrowDown' ? 1 : -1));
          }
        }}
        data-testid="kit-search-input"
      />
      <SearchResults groups={groups} query={q} activeIndex={active} onActiveChange={setActive} idPrefix="kit-search" />
    </Card>
  );
}

function SheetsList({ store }) {
  const first = (table) => store?.view[table]?.value?.[0]?.id || null;
  const item = [...(store?.tables.items.value.values() || [])].find((x) => x.place_id && x.day_id)?.id || null;
  const open = {
    driver: () => openDriverCard(first('places')),
    expense: () => openExpenseSheet({ itemId: item, date: '2027-01-11', category: '餐饮' }, { keyboard: true }),
    item: () => openItemSheet({ date: '2027-01-11', variant: 'rain' }),
    place: () => openPlaceSheet(first('places')),
    review: () => openReviewSheet({ placeId: first('places') }),
    booking: () => openBookingSheet(first('bookings')),
    todo: () => openTodoSheet({ list: 'packing' }),
    journal: () => openJournalSheet({ mode: 'photo', date: '2027-01-10' }),
    photo: () => openPhotoViewer({ index: 2 }),
    'trip-new': () => openTripNewSheet(),
    invite: () => openInviteSheet({ role: 'viewer' }),
  };
  return (
    <Card title="sheets/ 登记的弹层" meta={`${Object.keys(SHEETS).length} 个`} padding="sm" testId="kit-sheets">
      {Object.entries(SHEETS).map(([id, s]) => (
        <ListRow
          key={id}
          onClick={(e) => open[id]?.(e)}
          glyph={id === 'driver' ? 'show' : 'sparkle'}
          title={`${s.title}（${id}）`}
          subtitle={`${s.kind === 'menu' ? '全屏' : '底部面板'} · 由${s.owner}完成`}
          data-testid={`kit-sheet-${id}`}
        />
      ))}
    </Card>
  );
}

export default function KitPage({ route }) {
  // 全站弹层（给司机看、记一笔……）靠网址里的 ?trip= 知道是哪一趟
  useEffect(() => {
    if (route?.query?.trip !== TRIP) setQuery({ trip: TRIP }, { replace: true });
  }, []);
  const store = useTrip(TRIP);
  const list = useMyTrips();
  const places = store?.view.places.value || [];
  const tips = store?.view.tips.value || [];
  const trips = list.entries || [];

  return (
    <div class="kit-page" data-testid="kit-page">
      <Section id="card" title="卡片 Card" note="卡片材质（不开 backdrop-filter）+ 折射描边，圆角 26，内边距 18；整张可点的变体带凸起的白圆箭头、按下一缩。">
        <Cards store={store} />
      </Section>
      <Section id="section" title="段标题 SectionHeader" note="宋体 21px + 计数；右边一个文字动作（可点区域 ≥44px）。">
        <Headers />
      </Section>
      <Section id="rows" title="列表行 ListRow · 信息行 InfoRow · 分隔线 Divider" note="可点的行按下换底色；行与行之间的分隔线从文字处开始；完成 / 跳过淡化并划掉。">
        <Rows />
      </Section>
      <Section id="money" title="金额 MoneyText" note="lib/money.js 的 formatMoney：外币后面「约 HK$…」次要色小字；大号用 Instrument Serif（1 由 P2 Figure One 顶替）。">
        <Money />
      </Section>
      <Section id="kinds" title="种类图标 KindIcon" note="样稿 04-body.html 那套笔法（24×24、线宽 1.8、圆头圆角），缺的按同样笔法补画。">
        <Kinds />
      </Section>
      <Section id="status" title="状态芯片 · 阶段 · 成员 · 倒计时 · 日期" note="免费取消：≤3 天警示色、≤1 天红色、过了灰色，自己会走。">
        <Statuses trips={trips} members={store?.view.members.value || []} />
      </Section>
      <Section id="copy" title="点一下复制 CopyText" note="复制后提示「已复制…」、轻震一下，图标变成对勾 1.6 秒。">
        <Copies />
      </Section>
      <Section id="actions" title="动作行 PlaceActions" note="导航（Google 地图）/ 叫 Grab（先复制地址再跳，1.5 秒没切走就提示）/ 给司机看 / 复制地址；用不了的禁用并说明原因。">
        <Actions places={places} />
      </Section>
      <Section id="driver" title="给司机看（弹层 driver）" note="全屏大字：从点的按钮长出来；字号自动适配（名字 32–72px，地址不小于 28px），再长就能滚；点空白处或往下拉关闭。">
        <Driver places={places} tips={tips} />
      </Section>
      <Section id="states" title="空状态 PageEmptyState · 出错 ErrorState" note="每种页面一张线条插图；出错只显示中文原因，网络问题换成离线的样子。">
        <States />
      </Section>
      <Section id="add" title="行内快速添加 InlineAdd" note="回车连续加（输入法选词时的回车不算）；一次粘贴几行就加几条；出错字留着、下面说原因。">
        <Adds />
      </Section>
      <Section id="swipe" title="左滑 SwipeRow" note="手指和鼠标都能拖；松手按位置和速度决定开还是关；键盘 Tab 到按钮上自动滑开；读屏直接找得到按钮。">
        <Swipes />
      </Section>
      <Section id="search" title="搜索 searchTrip + SearchResults" note="中文子串、英文不分大小写、越南语去声调；标题完全匹配 > 前缀 > 子串 > 说明里；↑ ↓ 选择。">
        <Search store={store} />
      </Section>
      <Section id="sheets" title="弹层登记表 sheets/" note="每个 id 一个按需加载的占位面板（driver 已经做完）；带预填参数打开（写法见 sheets/README.md），返回手势能关。">
        <SheetsList store={store} />
      </Section>
    </div>
  );
}
