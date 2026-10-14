// =====================================================================
// dev/primitives/demos-layout.jsx：展示页里“布局类”交互的演示：
// 原地展开、列表 ↔ 网格、FLIP 重排、顶栏收成胶囊、搜索原位展开。
// 内容全部虚构（地名、时间都是编的）。
// =====================================================================

import { useMemo, useRef, useState } from 'preact/hooks';
import { ExpandableCard, useAccordion } from '../../ui/ExpandableCard.jsx';
import { ViewSwitch, ViewToggle, ViewCard } from '../../ui/ViewSwitch.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { useHeightFlip } from '../../motion/hooks.js';
import { CollapsingHeader } from '../../ui/CollapsingHeader.jsx';
import { SearchExpand } from '../../ui/SearchExpand.jsx';
import { IconButton } from '../../ui/IconButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Badge, RatingBadge } from '../../ui/Badge.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { formatMoney } from '../../lib/money.js';
import {
  IconUtensils, IconMapPin, IconPlane, IconClock, IconArrowLeft, IconShare, IconShuffle, IconPlus, IconTrash,
  IconBed, IconCamera, IconSearchX, IconTicket, IconCoffee,
} from '../../ui/icons.js';
import photo01 from '../../../demo/photos/demo-photo-01.jpg';
import photo02 from '../../../demo/photos/demo-photo-02.jpg';
import photo03 from '../../../demo/photos/demo-photo-03.jpg';
import photo04 from '../../../demo/photos/demo-photo-04.jpg';
import photo05 from '../../../demo/photos/demo-photo-05.jpg';
import photo06 from '../../../demo/photos/demo-photo-06.jpg';
import photo07 from '../../../demo/photos/demo-photo-07.jpg';
import photo08 from '../../../demo/photos/demo-photo-08.jpg';
import { Group } from './Section.jsx';

// ---------------------------------------------------------------------
// 原地展开
// ---------------------------------------------------------------------
const TIMELINE = [
  { id: 'breakfast', time: '08:30', title: '椰林粉店 · 早餐', sub: '步行 6 分钟', icon: IconUtensils, badge: <Badge tone="success">已订</Badge>, cost: 120000 },
  { id: 'cable', time: '10:00', title: '跨海缆车', sub: '车程 25 分钟', icon: IconTicket, badge: <Badge tone="warning">待付款</Badge>, cost: 900000 },
  { id: 'beach', time: '13:30', title: '白沙湾 · 下午玩水', sub: '自由活动', icon: IconMapPin, badge: null, cost: 0 },
];

function TimelineDetail({ item }) {
  return (
    <div class="pv-detail">
      <p><IconClock size={16} aria-hidden="true" /> {item.time} 开始，预计 2 小时</p>
      <p><IconMapPin size={16} aria-hidden="true" /> 椰影岛北区（虚构地址）</p>
      {item.cost > 0 && <p>费用：{formatMoney(item.cost, 'VND')}</p>}
      <div class="pv-row">
        <Button size="sm" variant="tinted">导航过去</Button>
        <Button size="sm" variant="secondary">标为完成</Button>
      </div>
    </div>
  );
}

export function ExpandableDemo() {
  const acc = useAccordion('breakfast');
  return (
    <>
      <Group title="时间轴卡片（一次只开一张；点的那张待在手指下面，上下的内容平滑伸缩）">
        <div class="pv-cards" data-testid="xcard-list">
          {TIMELINE.map((it) => {
            const Icon = it.icon;
            return (
              <ExpandableCard
                key={it.id}
                title={it.title}
                subtitle={`${it.time} · ${it.sub}`}
                leading={<Icon size={20} />}
                meta={it.badge}
                {...acc.bind(it.id)}
                data-testid={`xcard-${it.id}`}
              >
                <TimelineDetail item={it} />
              </ExpandableCard>
            );
          })}
        </div>
        <div class="pv-after" data-testid="xcard-after">↑ 上面展开时，这一块也跟着平滑移动</div>
      </Group>
      <Group title="分组列表里的行（row 样式）">
        <div class="pv-list">
          <ExpandableCard variant="row" title="酒店：海风小筑" subtitle="1 月 10 日入住 · 2 晚" leading={<IconBed size={20} />} meta={<Badge tone="success">已确认</Badge>}>
            <p class="pv-detail">订单号 DEMO-2041 · 到店付款 · 含早餐</p>
          </ExpandableCard>
          <ExpandableCard variant="row" title="航班：DEMO 123" subtitle="1 月 10 日 09:15 起飞" leading={<IconPlane size={20} />}>
            <p class="pv-detail">托运 1 件 20kg · 提前 2 小时到机场</p>
          </ExpandableCard>
        </div>
      </Group>
      <Group title="嵌套（卡片里还有可展开的卡片）">
        <ExpandableCard title="第 2 天 · 美食清单" subtitle="3 家店，点开看评级" leading={<IconCoffee size={20} />} data-testid="xcard-nested">
          <div class="pv-cards">
            <ExpandableCard title="海鲜大排档" subtitle="晚餐 · 人均约 HK$120" meta={<RatingBadge rating={5} />}>
              <p class="pv-detail">吃了：烤扇贝、柠檬虾。下次还来。</p>
            </ExpandableCard>
            <ExpandableCard title="椰子咖啡" subtitle="下午茶" meta={<RatingBadge rating={3} />}>
              <p class="pv-detail">椰子冰沙不错，咖啡偏甜。</p>
            </ExpandableCard>
          </div>
        </ExpandableCard>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 列表 ↔ 网格
// ---------------------------------------------------------------------
const PHOTOS = [
  { id: 'p1', title: '海上日出', date: '1 月 11 日 06:20', src: photo01 },
  { id: 'p2', title: '椰林沙滩', date: '1 月 11 日 14:05', src: photo02 },
  { id: 'p3', title: '夜市灯串', date: '1 月 11 日 20:40', src: photo03 },
  { id: 'p4', title: '山间晨雾', date: '1 月 12 日 07:10', src: photo04 },
  { id: 'p5', title: '城市黄昏', date: '1 月 12 日 18:02', src: photo05 },
  { id: 'p6', title: '一碗热汤粉', date: '1 月 12 日 19:30', src: photo06 },
  { id: 'p7', title: '红灯笼', date: '1 月 13 日 21:15', src: photo07 },
  { id: 'p8', title: '海边日落', date: '1 月 13 日 17:48', src: photo08 },
];

export function ViewSwitchDemo() {
  const [view, setView] = useState('list');
  const [fav, setFav] = useState({ p2: true });
  return (
    <>
      <div class="pv-toolbar">
        <div>
          <b class="pv-toolbar__title">相册</b>
          <span class="pv-toolbar__sub">6 张 · {view === 'grid' ? '网格' : '列表'}</span>
        </div>
        <ViewToggle value={view} onChange={setView} data-testid="view-toggle" />
      </div>
      <ViewSwitch
        view={view}
        items={PHOTOS.slice(0, 6)}
        label="相册"
        data-testid="view-switch"
        renderItem={(p) => (
          <ViewCard
            flipKey={p.id}
            title={p.title}
            subtitle={p.date}
            image={p.src}
            meta={fav[p.id] ? <Badge tone="danger" size="sm">已收藏</Badge> : null}
            onClick={() => setFav({ ...fav, [p.id]: !fav[p.id] })}
            data-testid={`view-card-${p.id}`}
          />
        )}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// FLIP 重排（排序 / 新增 / 删除）
// ---------------------------------------------------------------------
const START_ITEMS = [
  { id: 'a', name: '护照', tag: '证件' },
  { id: 'b', name: '充电宝', tag: '电子' },
  { id: 'c', name: 'eSIM', tag: '电子' },
  { id: 'd', name: '防晒霜', tag: '洗护' },
  { id: 'e', name: '泳镜', tag: '玩水' },
];
const EXTRA = ['墨镜', '晕车药', '转换插头', '拖鞋', '帽子', '保温杯'];

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // 保证真的换了顺序
  if (a.every((x, i) => x.id === list[i].id) && a.length > 1) a.push(a.shift());
  return a;
}

export function FlipListDemo() {
  const [items, setItems] = useState(START_ITEMS);
  const seq = useRef(0);
  const trigger = useMemo(() => items.map((i) => i.id).join(','), [items]);
  return (
    <>
      <div class="pv-row">
        <Button size="sm" variant="secondary" leading={IconShuffle} onClick={() => setItems(shuffle(items))} data-testid="flip-shuffle">打乱</Button>
        <Button
          size="sm"
          variant="secondary"
          leading={IconPlus}
          onClick={() => {
            seq.current += 1;
            const name = EXTRA[seq.current % EXTRA.length];
            setItems([{ id: `x${seq.current}`, name, tag: '新加' }, ...items]);
          }}
          data-testid="flip-add"
        >
          加一件
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setItems([...items].sort((x, y) => x.name.localeCompare(y.name, 'zh')))}>按名称排序</Button>
      </div>
      <FlipGroup as="ul" class="pv-flip-list" trigger={trigger} options={{ spring: 'smooth', stagger: 12 }} data-testid="flip-list">
        {items.map((it) => (
          <li key={it.id} class="pv-flip-item" data-flip-key={it.id} data-flip="position">
            <span class="pv-flip-item__name">{it.name}</span>
            <Chip size="sm">{it.tag}</Chip>
            <IconButton icon={IconTrash} label={`删除${it.name}`} size="sm" variant="plain" onClick={() => setItems(items.filter((x) => x.id !== it.id))} />
          </li>
        ))}
      </FlipGroup>
      {items.length === 0 && (
        <EmptyState compact tone="neutral" icon={IconSearchX} title="清单空了" action={<Button size="sm" onClick={() => setItems(START_ITEMS)}>恢复</Button>} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// FLIP 高度（内容整体换掉：展开全文）
// ---------------------------------------------------------------------
const NOTE_SHORT = '第 2 天去缆车之前先买好往返票，下午的白沙湾记得带防晒……';
const NOTE_LONG = [
  '第 2 天去缆车之前先买好往返票，下午的白沙湾记得带防晒。',
  '缆车站早上 9 点开门，10 点以后排队的人会多起来；回程最后一班 17:30。',
  '白沙湾的躺椅要另外付钱（约 100,000₫，约 HK$30），自带沙滩巾也可以。',
  '晚饭想吃海鲜大排档的话，最好下午 4 点前打电话订位。',
];

export function HeightFlipDemo() {
  const [long, setLong] = useState(false);
  const cardRef = useRef(null);
  const capture = useHeightFlip(cardRef);
  return (
    <>
      <div ref={cardRef} class="pv-note" data-testid="height-card">
        <b class="pv-note__title">行前备注</b>
        {long ? NOTE_LONG.map((t) => <p key={t}>{t}</p>) : <p>{NOTE_SHORT}</p>}
        <Button
          size="sm"
          variant="tinted"
          data-testid="height-toggle"
          onClick={() => {
            capture();
            setLong(!long);
          }}
        >
          {long ? '收起' : '展开全文'}
        </Button>
      </div>
      <div class="pv-after" data-testid="height-after">↑ 内容变高 / 变矮时，这一块（以及整页后面的内容）跟着滑</div>
    </>
  );
}

// ---------------------------------------------------------------------
// 顶栏收成胶囊
// ---------------------------------------------------------------------
export function CollapsingHeaderDemo() {
  const frameRef = useRef(null);
  const [state, setState] = useState('bar');
  const [onPage, setOnPage] = useState(false);
  const [pageState, setPageState] = useState('bar');
  return (
    <>
      <div class="pv-row">
        <Chip selected={onPage} onToggle={setOnPage} data-testid="ch-page-toggle">在整页上试（读 window 滚动）</Chip>
        {onPage && <span class="dev-section__note">整页顶栏：<b data-testid="ch-page-state">{pageState === 'pill' ? '胶囊' : '展开'}</b></span>}
      </div>
      {onPage && (
        <CollapsingHeader
          position="fixed"
          title="基础组件 · 动效与交互"
          compactTitle="基础组件"
          onStateChange={setPageState}
          leading={<IconButton icon={IconArrowLeft} label="返回" size="sm" onClick={() => setOnPage(false)} />}
          trailing={<IconButton icon={IconShare} label="分享" size="sm" />}
          data-testid="ch-page"
        />
      )}
      <p class="dev-section__note">在下面的“手机框”里上下滑动（正式页面滚动的是整个页面，这里为了演示放进一个框；上面的开关可以在整页上试）。当前：<b data-testid="ch-state">{state === 'pill' ? '胶囊' : '展开'}</b></p>
      <div class="pv-phone" ref={frameRef} data-testid="ch-frame">
        <CollapsingHeader
          title="椰影岛 · 第 2 天"
          compactTitle="第 2 天"
          scrollRef={frameRef}
          safeArea={false}
          onStateChange={setState}
          leading={<IconButton icon={IconArrowLeft} label="返回" size="sm" />}
          trailing={<IconButton icon={IconShare} label="分享" size="sm" />}
          data-testid="ch"
        />
        <div class="pv-phone__content">
          <h3 class="pv-phone__large">第 2 天</h3>
          <p class="pv-phone__sub">1 月 11 日 星期一 · 晴 31°</p>
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} class="pv-phone__row">
              <span class="pv-phone__time">{String(8 + Math.floor(i / 2)).padStart(2, '0')}:{i % 2 ? '30' : '00'}</span>
              <span>{['早餐', '出发', '潜水', '午饭', '午睡', '海边', '咖啡', '散步', '晚餐', '夜市', '按摩', '回酒店', '整理照片', '睡觉'][i]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 搜索原位展开
// ---------------------------------------------------------------------
const SEARCHABLE = [
  { id: 1, icon: IconUtensils, text: '椰林粉店 · 早餐', kind: '地点' },
  { id: 2, icon: IconTicket, text: '跨海缆车 · 门票', kind: '预订' },
  { id: 3, icon: IconCamera, text: '白沙湾 · 打卡', kind: '日记' },
  { id: 4, icon: IconCoffee, text: '椰子咖啡 · 下午茶', kind: '记账' },
  { id: 5, icon: IconBed, text: '海风小筑 · 入住', kind: '预订' },
];

export function SearchDemo() {
  const [q, setQ] = useState('');
  const hits = SEARCHABLE.filter((it) => !q || it.text.includes(q) || it.kind.includes(q));
  return (
    <>
      <SearchExpand placeholder="搜地点、预订、日记、记账" value={q} onValueChange={setQ} sheetId="search" data-testid="search">
        <div class="pv-search-title">
          <b>第 2 天</b>
          <span>12 项安排</span>
        </div>
      </SearchExpand>
      <ul class="pv-list pv-search-results" data-testid="search-results" aria-live="polite">
        {hits.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.id} class="pv-list-row pv-list-row--static">
              <Icon size={18} aria-hidden="true" />
              <span>{it.text}</span>
              <Badge size="sm">{it.kind}</Badge>
            </li>
          );
        })}
        {hits.length === 0 && <li class="pv-list-row pv-list-row--static">没有找到「{q}」</li>}
      </ul>
      <p class="dev-section__note">展开状态进了网址历史（?sheet=search）：浏览器返回键 / 手机返回手势会把搜索收起来。</p>
    </>
  );
}
