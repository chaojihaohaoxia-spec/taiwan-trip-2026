// =====================================================================
// dev/primitives.jsx：动效与交互组件库的展示页（#/dev/primitives，只在本机）。
//
// 把 ui/ 的每个组件、每个状态摆出来，10 个交互都能现场试；顶部有：
//   - 目录（点了滚到对应区块）；
//   - 慢动作（全站动效 ×1 / ×4 / ×10，方便看清弹簧和形变的过程；只影响本次打开的页面）；
//   - 当前是否“减弱动态效果”。
// 页面最后接着显示其他模块登记在 dev/demos.js 里的演示（弹簧曲线、按压基础写法、交互清单……）。
// 每个区块的 id 是 demo-<名字>，e2e（test/e2e/interactions.e2e.mjs）按它定位。
// =====================================================================

import './primitives/primitives.css';
import { useEffect } from 'preact/hooks';
import { DemoList } from './DemoList.jsx';
import { Section } from './primitives/Section.jsx';
import { SegmentedControl } from '../ui/SegmentedControl.jsx';
import { Badge } from '../ui/Badge.jsx';
import { timeScale, setTimeScale } from '../motion/time.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import {
  PressDemo, ButtonsDemo, IconButtonsDemo, MorphIconDemo, SubmitDemo, SegmentedDemo, TabsDemo, StepperDemo, RollingDemo,
} from './primitives/demos-controls.jsx';
import { ExpandableDemo, ViewSwitchDemo, FlipListDemo, HeightFlipDemo, CollapsingHeaderDemo, SearchDemo } from './primitives/demos-layout.jsx';
import { FabMorphDemo, CircleRevealDemo, ToastDemo } from './primitives/demos-overlay.jsx';
import { CheckboxDemo, ChipsDemo, BadgesDemo, SkeletonDemo, AvatarDemo, EmptyDemo } from './primitives/demos-display.jsx';

/** 区块清单：[id, 标题, 交互编号或分类, 说明, 组件] */
const SECTIONS = [
  ['search', '搜索原位展开', '交互 1', '点放大镜：输入框从按钮的位置长出来，光标自动定位、键盘直接弹出；取消 / Esc / 返回键原路收回。', SearchDemo],
  ['fab-morph', '悬浮加号长成面板', '交互 2 · 原语', '共享元素形变（motion/morph.js 的 morphFrom / morphTo）：面板从加号的位置和圆角长出来，加号转成 ×；关闭时收回到加号现在的位置。overlay/AnchoredPanel 就是用它做的（完整演示在 #/dev/overlays）。', FabMorphDemo],
  ['submit', '提交按钮', '交互 3', '文字 → 转圈 → 对勾，宽度不跳；期间再点无效；失败会抖一下。', SubmitDemo],
  ['morph-icon', '图标平滑变形', '交互 4', 'SVG 路径逐帧插值（不是换图）：三横线 ↔ ×、加号 ↔ ×、播放 ↔ 暂停、列表 ↔ 网格、箭头下 ↔ 上、圆圈 ↔ 对勾。弹层的触发按钮和替身按钮用的也是它。', MorphIconDemo],
  ['segmented', '分段控件', '交互 5', '选中块弹簧跟随；按住选中块可以左右拖，松手按速度吸附；方向键可切换。', SegmentedDemo],
  ['tabs', '标签页', '交互 5', '下划线指示条弹簧跟随（前沿快、后沿慢）；可以由下面内容的横向滑动连续驱动。', TabsDemo],
  ['stepper', '按钮变步进器', '交互 6', '「＋ 添加」原地展开成「− 数字 ＋」，数字滚动；减到 0 收回成按钮。', StepperDemo],
  ['expandable', '列表项原地展开', '交互 7', '详情原地展开，下面的列表和整页内容平滑下移；可嵌套。', ExpandableDemo],
  ['view-switch', '列表 ↔ 网格', '交互 8', '每张卡片的底板、图片、文字各自 FLIP 到新位置：图片等比裁切放大，文字不变形。', ViewSwitchDemo],
  ['flip-list', 'FLIP 重排', '交互 8 · 原语', '排序、新增、删除：留下的平滑挪位，新的浮出来，删掉的淡出缩小。', FlipListDemo],
  ['flip-height', 'FLIP 高度', '交互 7 · 原语', '内容整体换掉（展开全文）：元素从旧高度“卷”开到新高度，后面的内容同一条弹簧滑下去；不动 height。', HeightFlipDemo],
  ['collapsing-header', '顶栏收成胶囊', '交互 9', '往下滚收成屏幕顶部的小胶囊，往上滑恢复；点胶囊展开。', CollapsingHeaderDemo],
  ['circle-reveal', '菜单圆形扩散', '交互 10 · 原语', 'clip-path: circle() 从按钮中心扩散铺满（motion/morph.js 的 revealCircle），原路收回；三横线同时变成 ×。overlay/FullscreenMenu 用的同一个原语（完整演示在 #/dev/overlays）。', CircleRevealDemo],
  ['pressable', '按压反馈', '基础', '按下即缩、松手弹簧回弹、手指滑出取消、嵌套只缩里面那个。', PressDemo],
  ['buttons', '按钮', '基础', '七种样式、三种尺寸，都有底色、描边或强调色文字。', ButtonsDemo],
  ['icon-buttons', '图标按钮', '基础', '圆形；必须有中文 label；视觉 36 的热区扩到 44。', IconButtonsDemo],
  ['rolling', '滚动数字', '基础', '只滚变了的位；外币后面括号标折合港币。', RollingDemo],
  ['checkbox', '勾选框', '基础', '底色弹出 + 对勾描线；整行可点；半选。', CheckboxDemo],
  ['chips', '小胶囊', '基础', '筛选、展示、可删除。', ChipsDemo],
  ['badges', '角标', '基础', '状态标签、数字角标、圆点、评级五档。', BadgesDemo],
  ['skeleton', '骨架屏', '基础', '加载时微光扫过，加载完交叉淡入真实内容，不跳版。', SkeletonDemo],
  ['avatar', '头像', '基础', '首字 + 按名字固定的颜色；图片；状态；叠放。', AvatarDemo],
  ['empty', '空状态', '基础', '图标 + 标题 + 说明 + 一个主要操作。', EmptyDemo],
  ['toast', '轻提示', '基础', '全站唯一的一套 Toast（overlay/ 的 toast()）：从下面弹上来；左右或往下甩掉；悬停暂停计时；五种语气。', ToastDemo],
];

const SPEEDS = [{ value: 1, label: '正常' }, { value: 4, label: '慢 ×4' }, { value: 10, label: '慢 ×10' }];

function Toolbar() {
  // 离开页面时恢复正常速度
  useEffect(() => () => setTimeScale(1), []);
  return (
    <div class="pv-toolbar-top">
      <div class="pv-toolbar-top__row">
        <span class="pv-toolbar-top__label">动画速度</span>
        <SegmentedControl label="动画速度" size="sm" block={false} value={timeScale.value} onChange={setTimeScale} options={SPEEDS} data-testid="speed" />
        {prefersReducedMotion.value
          ? <Badge tone="warning">系统开了“减弱动态效果”：大位移改成淡入淡出</Badge>
          : <Badge tone="success">动效全开</Badge>}
      </div>
      <nav class="pv-toc" aria-label="组件目录">
        {SECTIONS.map(([id, title]) => (
          <a key={id} class="pv-toc__chip" data-press="highlight" href={`#demo-${id}`}>{title}</a>
        ))}
      </nav>
    </div>
  );
}

export default function PrimitivesShowcase() {
  return (
    <div class="pv" data-testid="primitives-page">
      <Toolbar />
      {SECTIONS.map(([id, title, tag, note, Demo]) => (
        <Section key={id} id={id} title={title} tag={tag} note={note}>
          <Demo />
        </Section>
      ))}
      <h2 class="pv-divider">其他模块登记的演示</h2>
      <DemoList page="primitives" />
    </div>
  );
}
