// =====================================================================
// dev/primitives/demos-controls.jsx：展示页里“按钮类”和“输入类”组件的演示：
// 按压、按钮、图标按钮、变形图标、提交按钮、分段控件、标签页、步进器、滚动数字。
// 每个演示只用本地状态，不连后台；data-testid 给 e2e 用。
// =====================================================================

import { useRef, useState } from 'preact/hooks';
import { Pressable } from '../../ui/Pressable.jsx';
import { Button } from '../../ui/Button.jsx';
import { IconButton } from '../../ui/IconButton.jsx';
import { MorphIcon } from '../../ui/MorphIcon.jsx';
import { MORPHS } from '../../ui/morph-shapes.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Tabs, tabId, tabPanelId } from '../../ui/Tabs.jsx';
import { Stepper } from '../../ui/Stepper.jsx';
import { RollingNumber } from '../../ui/RollingNumber.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { formatAmount, moneyParts } from '../../lib/money.js';
import {
  IconPlus, IconShare, IconHeart, IconSearch, IconTrash, IconArrowLeft, IconSettings, IconMap, IconReceipt,
  IconCalendar, IconStar, IconChevronRight, IconShirt, IconUmbrella, IconWaves, IconSun, IconWallet,
} from '../../ui/icons.js';
import { Group, Specimen } from './Section.jsx';

// ---------------------------------------------------------------------
// 按压反馈
// ---------------------------------------------------------------------
export function PressDemo() {
  const [count, setCount] = useState(0);
  const [inner, setInner] = useState(0);
  return (
    <>
      <Group title="大卡片（缩放按尺寸自动变小）">
        <Pressable class="pv-press-card" data-testid="press-card" onClick={() => setCount((c) => c + 1)}>
          <span class="pv-press-card__title">按住我，再把手指滑出去</span>
          <span class="pv-press-card__sub">滑出卡片就回弹、不算点击；滑回来又按下。已点击 <b data-testid="press-count">{count}</b> 次</span>
        </Pressable>
      </Group>
      <Group title="列表行（高亮式，不缩放）">
        <div class="pv-list">
          {['行程概览', '账本', '打包清单'].map((t) => (
            <Pressable key={t} as="a" href="#demo-pressable" feedback="highlight" class="pv-list-row">
              <span>{t}</span>
              <span class="pv-list-row__chev" aria-hidden="true"><IconChevronRight size={18} /></span>
            </Pressable>
          ))}
        </div>
      </Group>
      <Group title="嵌套：按里面的按钮，外面的卡片不跟着缩">
        <Pressable as="div" role="button" tabIndex={0} class="pv-press-card pv-press-card--nested" data-testid="press-outer">
          <span class="pv-press-card__title">外层卡片</span>
          <Button size="sm" variant="tinted" data-testid="press-inner" onClick={(e) => { e.stopPropagation(); setInner((c) => c + 1); }}>
            里面的按钮（{inner}）
          </Button>
        </Pressable>
      </Group>
      <Group title="禁用：没有按压反馈" row>
        <Button disabled>不能点</Button>
        <IconButton icon={IconTrash} label="删除（禁用）" disabled />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 按钮
// ---------------------------------------------------------------------
const VARIANTS = [
  ['primary', '主要'], ['secondary', '次要'], ['tinted', '浅色强调'], ['outline', '描边'], ['text', '文字'], ['danger', '危险'], ['danger-soft', '危险浅底'],
];

export function ButtonsDemo() {
  return (
    <>
      <Group title="样式" row>
        {VARIANTS.map(([v, name]) => <Button key={v} variant={v}>{name}</Button>)}
      </Group>
      <Group title="尺寸（sm 36 / md 44 / lg 56 宋体；sm 的可点区域扩到 44）" row>
        <Button size="sm">小号</Button>
        <Button size="md">中号</Button>
        <Button size="lg">大号</Button>
      </Group>
      <Group title="带图标" row>
        <Button leading={IconPlus}>记一笔</Button>
        <Button variant="secondary" leading={IconShare}>分享行程</Button>
        <Button variant="tinted" trailing={IconChevronRight}>查看全部</Button>
        <Button variant="danger-soft" leading={IconTrash} size="sm">删除</Button>
      </Group>
      <Group title="按下态（静止展示：按住时就是这样，松手弹簧弹回）">
        {/* pv-static：只是展示按下的样子（缩小后不足 44px 是正常的）；inert：不能点、读屏不读，触控区检查也跳过 */}
        <div class="pv-row pv-static" inert>
          <Button data-pressed="">主要</Button>
          <Button variant="secondary" data-pressed="">次要</Button>
          <Button variant="tinted" data-pressed="">浅色强调</Button>
          <Button variant="text" data-pressed="">文字</Button>
          <Button variant="danger" data-pressed="">危险</Button>
        </div>
      </Group>
      <Group title="禁用 / 链接 / 撑满一行">
        <div class="pv-row">
          <Button disabled>禁用</Button>
          <Button variant="secondary" disabled>禁用</Button>
          <Button variant="outline" href="#demo-buttons">链接样式按钮</Button>
        </div>
        <Button block size="lg" leading={IconWallet}>撑满一行</Button>
      </Group>
    </>
  );
}

export function IconButtonsDemo() {
  const [liked, setLiked] = useState(false);
  return (
    <>
      <Group title="样式（都有底色：一眼看得出能点）" row>
        <Specimen label="fill"><IconButton icon={IconSearch} label="搜索" /></Specimen>
        <Specimen label="tinted"><IconButton icon={IconShare} label="分享" variant="tinted" /></Specimen>
        <Specimen label="filled"><IconButton icon={IconPlus} label="记一笔" variant="filled" /></Specimen>
        <Specimen label="glass"><span class="pv-glass-bg"><IconButton icon={IconMap} label="地图" variant="glass" /></span></Specimen>
        <Specimen label="plain"><IconButton icon={IconSettings} label="设置" variant="plain" /></Specimen>
      </Group>
      <Group title="尺寸" row>
        <Specimen label="sm 36（热区 44）"><IconButton icon={IconArrowLeft} label="返回" size="sm" /></Specimen>
        <Specimen label="md 44"><IconButton icon={IconArrowLeft} label="返回" /></Specimen>
        <Specimen label="lg 56"><IconButton icon={IconPlus} label="新增" size="lg" variant="filled" /></Specimen>
      </Group>
      <Group title="按下态（静止展示）">
        <div class="pv-row pv-static" inert>
          <Specimen label="fill 按下"><IconButton icon={IconSearch} label="搜索（按下态）" data-pressed="" /></Specimen>
          <Specimen label="filled 按下"><IconButton icon={IconPlus} label="新增（按下态）" variant="filled" data-pressed="" /></Specimen>
        </div>
      </Group>
      <Group title="开关（aria-pressed）/ 禁用" row>
        <Specimen label={liked ? '已收藏' : '未收藏'}>
          <IconButton icon={IconHeart} label="收藏" pressed={liked} onClick={() => setLiked(!liked)} data-testid="like-toggle" />
        </Specimen>
        <Specimen label="禁用"><IconButton icon={IconStar} label="评级（禁用）" disabled /></Specimen>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 变形图标
// ---------------------------------------------------------------------
const MORPH_DEMOS = [
  ['menu', '三横线 ↔ ×'],
  ['plus', '加号 ↔ ×'],
  ['play', '播放 ↔ 暂停'],
  ['view', '列表 ↔ 网格'],
  ['chevron', '向下 ↔ 向上'],
  ['check', '圆圈 ↔ 对勾'],
];

export function MorphIconDemo() {
  const [on, setOn] = useState({});
  const all = MORPH_DEMOS.every(([k]) => on[k]);
  return (
    <>
      <div class="pv-morph-grid">
        {MORPH_DEMOS.map(([kind, name]) => {
          const state = Boolean(on[kind]);
          return (
            <div key={kind} class="pv-morph-tile" data-testid={`morph-${kind}`}>
              <IconButton
                label={MORPHS[kind].label[state ? 1 : 0]}
                variant={state ? 'tinted' : 'fill'}
                size="lg"
                onClick={() => setOn({ ...on, [kind]: !state })}
              >
                <MorphIcon kind={kind} state={state} size={26} />
              </IconButton>
              <span class="pv-morph-tile__name">{name}</span>
              <span class="pv-morph-tile__state">{MORPHS[kind].label[state ? 1 : 0]}</span>
            </div>
          );
        })}
      </div>
      <Group title="静止的两端（state 0 / 1）" row>
        {MORPH_DEMOS.map(([kind]) => (
          <Specimen key={kind} label={kind}>
            <span class="pv-morph-pair">
              <MorphIcon kind={kind} state={0} size={22} />
              <MorphIcon kind={kind} state={1} size={22} />
            </span>
          </Specimen>
        ))}
      </Group>
      <div class="pv-row pv-row--center">
        <Button variant="secondary" size="sm" data-testid="morph-all" onClick={() => setOn(Object.fromEntries(MORPH_DEMOS.map(([k]) => [k, !all])))}>
          {all ? '全部变回去' : '全部一起变'}
        </Button>
      </div>
      <p class="dev-section__note">动画中途再点：从当前形状折返（不跳）。加号、菜单用 bouncy 会多转一点再回来。</p>
    </>
  );
}

// ---------------------------------------------------------------------
// 提交按钮
// ---------------------------------------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function SubmitDemo() {
  const [log, setLog] = useState([]);
  const [calls, setCalls] = useState(0);
  const add = (t) => setLog((l) => [t, ...l].slice(0, 3));
  return (
    <>
      <Group title="成功：文字 → 转圈 → 对勾 → 回到文字">
        <SubmitButton
          block
          label="保存这笔记账"
          action={() => {
            setCalls((c) => c + 1);
            // 1.6 秒：转圈看得清；e2e 在转圈期间要截几张图（页面铺了光场以后截图慢一些），1.1 秒不够
            return delay(1600);
          }}
          onSuccess={() => add('保存成功（这里可以关掉面板）')}
          data-testid="submit-ok"
        />
        <p class="dev-section__note">提交次数：<b data-testid="submit-calls">{calls}</b>（转圈期间连点也只算一次）</p>
      </Group>
      <Group title="失败：抖一下 + 变红「重试」，过一会儿恢复" row>
        <SubmitButton
          label="提交"
          size="md"
          action={() => delay(800).then(() => { throw new Error('演示：网络不好'); })}
          onError={(e) => add(`失败：${e.message}`)}
          data-testid="submit-fail"
        />
        <SubmitButton label="带文字的对勾" size="md" variant="tinted" successLabel="已加入" action={() => delay(600)} data-testid="submit-label" />
      </Group>
      {log.length > 0 && <ul class="pv-log" aria-live="polite">{log.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      <Group title="四种状态（受控，静止展示；宽度都一样）" row>
        {[['idle', '空闲'], ['loading', '提交中'], ['success', '成功'], ['error', '失败']].map(([s, name]) => (
          <Specimen key={s} label={name}>
            <SubmitButton state={s} label="保存" size="md" />
          </Specimen>
        ))}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 分段控件
// ---------------------------------------------------------------------
export function SegmentedDemo() {
  const [a, setA] = useState('list');
  const [b, setB] = useState('day');
  const [c, setC] = useState('map');
  const [d, setD] = useState('vnd');
  return (
    <>
      <Group title="三段（按住选中块左右拖，甩一下能甩到更远的段）">
        <SegmentedControl
          label="账本视图"
          value={a}
          onChange={setA}
          data-testid="seg-main"
          options={[{ value: 'list', label: '明细' }, { value: 'stats', label: '分析' }, { value: 'settle', label: '结算' }]}
        />
        <p class="dev-section__note">当前：<b data-testid="seg-value">{a}</b></p>
      </Group>
      <Group title="两段 · 小号（不撑满）">
        <SegmentedControl
          label="范围"
          size="sm"
          block={false}
          value={b}
          onChange={setB}
          options={[{ value: 'day', label: '今天' }, { value: 'trip', label: '整趟' }]}
        />
      </Group>
      <Group title="四段 · 带图标 · 大号">
        <SegmentedControl
          label="当天内容"
          size="lg"
          value={c}
          onChange={setC}
          options={[
            { value: 'map', label: '地图', icon: IconMap },
            { value: 'list', label: '行程', icon: IconCalendar },
            { value: 'money', label: '账', icon: IconReceipt },
            { value: 'star', label: '评级', icon: IconStar },
          ]}
        />
      </Group>
      <Group title="有一段禁用（键盘方向键会跳过它）">
        <SegmentedControl
          label="币种"
          value={d}
          onChange={setD}
          options={[{ value: 'vnd', label: '越南盾' }, { value: 'twd', label: '新台币', disabled: true }, { value: 'hkd', label: '港币' }]}
        />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 标签页
// ---------------------------------------------------------------------
const DAY_TABS = Array.from({ length: 8 }, (_, i) => ({ id: `d${i + 1}`, label: `第 ${i + 1} 天` }));
const PAGER_TABS = [{ id: 'timeline', label: '时间轴' }, { id: 'map', label: '地图' }, { id: 'notes', label: '备注', badge: 2 }];

export function TabsDemo() {
  const [tab, setTab] = useState('timeline');
  const [day, setDay] = useState('d1');
  // 可拖动：下面的内容横向滑动时，指示条跟着手指连续移动
  const [pager, setPager] = useState('timeline');
  const [pos, setPos] = useState(null);
  const pagerRef = useRef(null);
  const programmatic = useRef(false);

  function onPagerScroll() {
    const el = pagerRef.current;
    if (!el || programmatic.current) return;
    const p = el.scrollLeft / Math.max(1, el.clientWidth);
    setPos(p);
    const i = Math.round(p);
    if (Math.abs(p - i) < 0.02 && PAGER_TABS[i] && PAGER_TABS[i].id !== pager) setPager(PAGER_TABS[i].id);
  }
  function onPagerTab(id) {
    const i = PAGER_TABS.findIndex((t) => t.id === id);
    const el = pagerRef.current;
    setPos(null);
    setPager(id);
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    const done = () => {
      programmatic.current = false;
      el.removeEventListener('scrollend', done);
    };
    el.addEventListener('scrollend', done);
    setTimeout(done, 700);
  }

  return (
    <>
      <Group title="基本（指示条前沿快、后沿慢：先拉长再收拢）">
        <Tabs label="当天" idPrefix="pv-day" value={tab} onChange={setTab} tabs={PAGER_TABS} data-testid="tabs-main" />
        <div class="pv-tabpanel" role="tabpanel" id={tabPanelId('pv-day', tab)} aria-labelledby={tabId('pv-day', tab)}>
          当前面板：{PAGER_TABS.find((t) => t.id === tab)?.label}
        </div>
      </Group>
      <Group title="放不下时横向滚动，选中的自动滚到中间">
        <Tabs label="日期" idPrefix="pv-days" value={day} onChange={setDay} tabs={DAY_TABS} />
      </Group>
      <Group title="可拖动：左右滑下面的内容，指示条跟着手指走">
        <Tabs label="分页" idPrefix="pv-pager" value={pager} onChange={onPagerTab} tabs={PAGER_TABS} position={pos} />
        <div class="pv-pager" ref={pagerRef} onScroll={onPagerScroll} data-testid="tabs-pager">
          {PAGER_TABS.map((t) => (
            <div key={t.id} class="pv-pager__page" role="tabpanel" id={tabPanelId('pv-pager', t.id)} aria-labelledby={tabId('pv-pager', t.id)}>
              <b>{t.label}</b>
              <span>左右滑动切换</span>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 步进器
// ---------------------------------------------------------------------
const PACKING = [
  { id: 'shirt', title: '上衣', desc: '亮色系，拍照好看', unit: '件', icon: IconShirt, qty: 3 },
  { id: 'dress', title: '雪纺长裙', desc: '日落小镇穿', unit: '条', icon: IconSun, qty: 0 },
  { id: 'swim', title: '泳衣', desc: '酒店泳池、白沙滩', unit: '件', icon: IconWaves, qty: 2 },
  { id: 'umbrella', title: '折叠伞', desc: '午后可能有阵雨', unit: '把', icon: IconUmbrella, qty: 0 },
];

export function StepperDemo() {
  const [items, setItems] = useState(PACKING);
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  // 禁用的步进器被改动的次数（应该永远是 0：键盘、点按都改不了；e2e 读 data-change-count）
  const [disabledChanges, setDisabledChanges] = useState(0);
  const set = (id, qty) => setItems((list) => list.map((it) => (it.id === id ? { ...it, qty } : it)));
  const total = items.reduce((s, it) => s + it.qty, 0);
  return (
    <>
      <Group title="打包清单（todos.qty）">
        <div class="pv-list" data-testid="stepper-list">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.id} class="pv-pack-row">
                <span class="pv-pack-row__icon" aria-hidden="true"><Icon size={20} /></span>
                <span class="pv-pack-row__text">
                  <b>{it.title}</b>
                  <span>{it.desc}</span>
                </span>
                <Stepper value={it.qty} onChange={(v) => set(it.id, v)} unit={it.unit} label={`${it.title}数量`} data-testid={`stepper-${it.id}`} />
              </div>
            );
          })}
        </div>
        <p class="dev-section__note">一共 <RollingNumber value={total} /> 件。按住 + / − 连续加减；− 按住不会把数量减到 0（要再点一下才收回）。</p>
      </Group>
      <Group title="左对齐 / 小号 / 最少 1 件 / 禁用" row>
        <Stepper value={a} onChange={setA} align="start" addLabel="加入" unit="份" label="份数" />
        <Stepper value={b} onChange={setB} min={0} max={5} size="sm" unit="人" label="人数" />
        <Stepper value={2} onChange={() => setDisabledChanges((n) => n + 1)} disabled label="禁用" data-testid="stepper-disabled" data-change-count={disabledChanges} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 滚动数字
// ---------------------------------------------------------------------
export function RollingDemo() {
  const [amount, setAmount] = useState(1250000);
  const [n, setN] = useState(9);
  const parts = moneyParts(amount, 'VND');
  return (
    <>
      <Group title="金额（只滚变了的那几位）">
        <div class="pv-amount" data-testid="rolling-amount">
          <RollingNumber value={amount} format={(v) => formatAmount(v, 'VND')} class="pv-amount__main" />
          <span class="pv-amount__hkd">（{parts.hkd}）</span>
        </div>
        <div class="pv-row">
          <Button size="sm" variant="secondary" onClick={() => setAmount((v) => v + 85000)}>+ 85,000₫</Button>
          <Button size="sm" variant="secondary" onClick={() => setAmount((v) => Math.max(0, v - 400000))}>− 400,000₫</Button>
          <Button size="sm" variant="secondary" onClick={() => setAmount((v) => v * 10)}>× 10（位数变化）</Button>
        </div>
      </Group>
      <Group title="9 ↔ 10：多出来的一位从左边长出来">
        <div class="pv-row">
          <span class="pv-big-num"><RollingNumber value={n} /></span>
          <Button size="sm" variant="secondary" onClick={() => setN((v) => v + 1)} data-testid="rolling-inc">+1</Button>
          <Button size="sm" variant="secondary" onClick={() => setN((v) => Math.max(0, v - 1))}>−1</Button>
          <Badge tone="accent">快速连点也不会乱</Badge>
        </div>
      </Group>
    </>
  );
}
