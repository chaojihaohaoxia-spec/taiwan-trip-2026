// =====================================================================
// dev/primitives/demos-display.jsx：展示页里“展示类”组件的演示：
// 勾选框、小胶囊、角标、骨架屏、头像、空状态。
// =====================================================================

import { useState } from 'preact/hooks';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Badge, CountBadge, DotBadge, RatingBadge } from '../../ui/Badge.jsx';
import { Skeleton, SkeletonCard, Reveal } from '../../ui/Skeleton.jsx';
import { Avatar, AvatarGroup } from '../../ui/Avatar.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Button } from '../../ui/Button.jsx';
import { IconButton } from '../../ui/IconButton.jsx';
import {
  IconPlus, IconMapPin, IconReceipt, IconWifiOff, IconRefresh, IconBell, IconUtensils, IconPlane, IconCircleCheck, IconAlert,
} from '../../ui/icons.js';
import photo08 from '../../../demo/photos/demo-photo-08.jpg';
import { Group } from './Section.jsx';

// ---------------------------------------------------------------------
// 勾选框
// ---------------------------------------------------------------------
const TODO = [
  { id: 'passport', label: '护照', desc: '放随身包，别托运' },
  { id: 'esim', label: 'eSIM', desc: '出发前一天激活' },
  { id: 'cash', label: '换一点现金', desc: '约 2,000,000₫（约 HK$606）' },
];

export function CheckboxDemo() {
  const [done, setDone] = useState({ passport: true });
  const [sq, setSq] = useState(false);
  const count = TODO.filter((t) => done[t.id]).length;
  const all = count === TODO.length;
  return (
    <>
      <Group title="待办（勾上后文字被一条线划掉）">
        <div class="pv-list" data-testid="check-list">
          <Checkbox
            shape="square"
            label="全部"
            description={`${count} / ${TODO.length} 已完成`}
            checked={all}
            indeterminate={count > 0 && !all}
            onChange={(v) => setDone(Object.fromEntries(TODO.map((t) => [t.id, v])))}
          />
          {TODO.map((t) => (
            <Checkbox
              key={t.id}
              label={t.label}
              description={t.desc}
              strike
              checked={Boolean(done[t.id])}
              onChange={(v) => setDone({ ...done, [t.id]: v })}
              data-testid={`check-${t.id}`}
            />
          ))}
        </div>
      </Group>
      <Group title="行内 / 方形 / 禁用" row>
        <Checkbox variant="inline" shape="square" label="记住选择" checked={sq} onChange={setSq} />
        <Checkbox variant="inline" label="已勾选（禁用）" checked disabled onChange={() => {}} />
        <Checkbox variant="inline" label="未勾选（禁用）" checked={false} disabled onChange={() => {}} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 小胶囊
// ---------------------------------------------------------------------
const FILTERS = ['全部', '美食', '景点', '交通', '住宿'];

export function ChipsDemo() {
  const [sel, setSel] = useState({ 全部: true });
  const [tags, setTags] = useState(['海边', '日落', '夜市', '按摩']);
  return (
    <>
      <Group title="筛选（可多选；选中时左侧对勾长出来）" row>
        {FILTERS.map((f, i) => (
          <Chip key={f} selected={Boolean(sel[f])} onToggle={(v) => setSel({ ...sel, [f]: v })} count={i === 0 ? 24 : undefined} data-testid={`chip-${i}`}>
            {f}
          </Chip>
        ))}
      </Group>
      <Group title="禁用" row>
        <Chip selected disabled onToggle={() => {}}>已选（禁用）</Chip>
        <Chip disabled onToggle={() => {}}>未选（禁用）</Chip>
      </Group>
      <Group title="只展示（不可点）" row>
        <Chip icon={IconMapPin}>3 个地点</Chip>
        <Chip icon={IconUtensils} size="sm">美食</Chip>
        <Chip icon={IconPlane} size="sm">航班</Chip>
      </Group>
      <Group title="可删除" row>
        {tags.map((t) => <Chip key={t} onRemove={() => setTags(tags.filter((x) => x !== t))}>{t}</Chip>)}
        {tags.length === 0 && <Button size="sm" variant="text" onClick={() => setTags(['海边', '日落', '夜市', '按摩'])}>恢复标签</Button>}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 角标
// ---------------------------------------------------------------------
export function BadgesDemo() {
  const [n, setN] = useState(3);
  const tones = [['neutral', '普通'], ['accent', '强调'], ['success', '已确认'], ['warning', '待付款'], ['danger', '已取消'], ['info', '提示']];
  return (
    <>
      <Group title="浅底（soft）" row>
        {tones.map(([t, name]) => <Badge key={t} tone={t}>{name}</Badge>)}
      </Group>
      <Group title="实心（solid）/ 描边 / 带图标 / 小号" row>
        {tones.map(([t, name]) => <Badge key={t} tone={t} variant="solid">{name}</Badge>)}
        <Badge tone="accent" variant="outline">描边</Badge>
        <Badge tone="success" icon={IconCircleCheck}>已出票</Badge>
        <Badge tone="warning" icon={IconAlert} size="sm">还没订</Badge>
      </Group>
      <Group title="数字角标（变化时弹一下、数字滚动；0 时缩掉）">
        <div class="pv-row">
          <span class="pv-badge-anchor">
            <IconButton icon={IconBell} label="通知" />
            <CountBadge count={n} label={`${n} 条新通知`} class="pv-badge-anchor__badge" data-testid="count-badge" />
          </span>
          <span class="pv-badge-anchor">
            <IconButton icon={IconReceipt} label="账本" />
            <DotBadge class="pv-badge-anchor__dot" />
          </span>
          <Button size="sm" variant="secondary" onClick={() => setN(n + 1)} data-testid="count-inc">+1</Button>
          <Button size="sm" variant="secondary" onClick={() => setN(Math.max(0, n - 1))}>−1</Button>
          <Button size="sm" variant="secondary" onClick={() => setN(120)}>120</Button>
        </div>
      </Group>
      <Group title="评级五档" row>
        {[5, 4, 3, 2, 1].map((r) => <RatingBadge key={r} rating={r} />)}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 骨架屏
// ---------------------------------------------------------------------
export function SkeletonDemo() {
  const [loading, setLoading] = useState(true);
  return (
    <>
      <div class="pv-row">
        <Button size="sm" variant="secondary" leading={IconRefresh} onClick={() => setLoading(!loading)} data-testid="skeleton-toggle">
          {loading ? '加载完成' : '重新加载'}
        </Button>
      </div>
      <Reveal
        loading={loading}
        skeleton={<div class="pv-list"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      >
        <div class="pv-list">
          {['海上日出', '椰林沙滩', '夜市灯串'].map((t, i) => (
            <div key={t} class="pv-skel-real">
              <span class="pv-skel-real__thumb" style={{ backgroundImage: `url(${photo08})`, backgroundPosition: `${i * 40}% 50%` }} />
              <span><b>{t}</b><span>1 月 1{i + 1} 日</span></span>
            </div>
          ))}
        </div>
      </Reveal>
      <Group title="单独的形状" row>
        <Skeleton variant="circle" size={40} />
        <div class="pv-skel-col"><Skeleton variant="text" lines={3} /></div>
        <Skeleton variant="rect" width={120} height={72} radius="lg" />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 头像
// ---------------------------------------------------------------------
export function AvatarDemo() {
  return (
    <>
      <Group title="尺寸（xs 24 / sm 32 / md 40 / lg 56 / xl 80）" row>
        {['xs', 'sm', 'md', 'lg', 'xl'].map((s) => <Avatar key={s} name="Jeremy" size={s} />)}
      </Group>
      <Group title="首字 / 图片 / 状态 / 叠放" row>
        <Avatar name="Cathy" />
        <Avatar name="小谭" />
        <Avatar name="海边" src={photo08} />
        <Avatar name="Jeremy" status="online" />
        <Avatar name="Cathy" status="busy" />
        <AvatarGroup names={['Jeremy', 'Cathy']} label="成员：Jeremy、Cathy" />
        <AvatarGroup names={['Jeremy', 'Cathy', '阿明', '小雨', '大卫']} max={3} size="md" />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------
// 空状态
// ---------------------------------------------------------------------
export function EmptyDemo() {
  const [k, setK] = useState(0);
  return (
    <>
      <div class="pv-row">
        <Button size="sm" variant="secondary" onClick={() => setK(k + 1)}>重新播放出现动画</Button>
      </div>
      <div class="pv-empty-grid" key={k}>
        <div class="pv-empty-card">
          <EmptyState
            icon={IconReceipt}
            title="还没有记账"
            description="点下面的按钮记下第一笔，越南盾会自动折合港币。"
            action={<Button leading={IconPlus}>记一笔</Button>}
          />
        </div>
        <div class="pv-empty-card">
          <EmptyState
            compact
            tone="danger"
            icon={IconWifiOff}
            title="没有网络"
            description="已保存在这台手机上，联网后自动同步。"
            action={<Button size="sm" variant="secondary" leading={IconRefresh}>重试</Button>}
          />
        </div>
      </div>
    </>
  );
}

