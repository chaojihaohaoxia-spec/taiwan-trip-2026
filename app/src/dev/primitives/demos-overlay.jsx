// =====================================================================
// dev/primitives/demos-overlay.jsx：弹层类交互用到的动效原语的现场演示（放在一个“舞台”框里）：
//   - 共享元素形变：悬浮加号长成操作面板，原路收回（motion/morph.js 的 morphFrom / morphTo）——
//     overlay/AnchoredPanel 就是用这两个原语做的（再加上进历史、锁滚动、焦点、替身按钮）；
//   - 圆形扩散：菜单从按钮位置铺满，原路收回（revealCircle）——overlay/FullscreenMenu 用的同一个；
//   - 轻提示：全站唯一的一套 Toast（overlay/ 的 toast()）：出现、甩掉、撤销、堆叠。
// 正式组件的完整演示在 #/dev/overlays。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { morphFrom, morphTo, revealCircle } from '../../motion/morph.js';
import { animateTween } from '../../motion/animate.js';
import { prefersReducedMotion } from '../../motion/reduced-motion.js';
import { IconButton } from '../../ui/IconButton.jsx';
import { MorphIcon } from '../../ui/MorphIcon.jsx';
import { Button } from '../../ui/Button.jsx';
import { Pressable } from '../../ui/Pressable.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { toast } from '../../overlay/toast.js';
import { IconReceipt, IconCamera, IconNotebookPen, IconCalendar, IconSettings, IconUsers, IconMap, IconWallet, IconLuggage } from '../../ui/icons.js';

// ---------------------------------------------------------------------
// 悬浮加号 → 操作面板（共享元素形变）
// ---------------------------------------------------------------------
const FAB_ACTIONS = [
  { id: 'expense', icon: IconReceipt, title: '记一笔', sub: '越南盾自动折合港币' },
  { id: 'checkin', icon: IconCamera, title: '拍照打卡', sub: '照片归到当天' },
  { id: 'journal', icon: IconNotebookPen, title: '写日记', sub: '今天的小事和心情' },
  { id: 'item', icon: IconCalendar, title: '加行程', sub: '插进某一天的时间轴' },
];

export function FabMorphDemo() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState('clip');
  const fabRef = useRef(null);
  const panelRef = useRef(null);
  const scrimRef = useRef(null);

  // 打开：先渲染面板（最终布局），再从加号的位置长出来；关闭：原路收回，播完再卸载。
  // 面板里盖一层加号颜色的色层（tint），内容和色层的浓淡都跟着形状此刻有多大走（contentFade: 'shape'）：
  // 看起来是“加号变成面板、面板变回加号”，和 overlay/AnchoredPanel 同一套
  const shapeOptions = (panel, fab) => {
    const tint = panel.querySelector('.pv-fab-panel__tint');
    tint.style.backgroundColor = getComputedStyle(fab).backgroundColor;
    return { mode, content: '.pv-fab-panel__inner', contentFade: 'shape', tint };
  };
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const fab = fabRef.current;
    if (open && panel && fab) {
      morphFrom(panel, fab, shapeOptions(panel, fab));
      if (scrimRef.current) animateTween(scrimRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', channel: 'scrim', commit: 'final' });
    } else if (!open && shown && panel && fab) {
      if (scrimRef.current) animateTween(scrimRef.current, [{ opacity: 0 }], { duration: 'base', channel: 'scrim', commit: 'final' });
      morphTo(panel, fab, shapeOptions(panel, fab)).finished.then((done) => {
        if (done) setShown(false);
      });
    }
  }, [open, shown]);

  const toggle = () => {
    if (!open) setShown(true);
    setOpen(!open);
  };

  return (
    <>
      <div class="pv-row">
        <SegmentedControl
          label="形变方式"
          size="sm"
          block={false}
          value={mode}
          onChange={setMode}
          options={[{ value: 'clip', label: '裁切（内容不缩放）' }, { value: 'transform', label: '缩放' }]}
        />
      </div>
      <div class="pv-stage" data-testid="fab-stage">
        <div class="pv-stage__content">
          <b>富国岛 · 第 1 天</b>
          <span>点右下角的加号</span>
        </div>
        {shown && <div ref={scrimRef} class="pv-stage__scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
        {shown && (
          <div ref={panelRef} class="pv-fab-panel" role="dialog" aria-label="快速添加" data-testid="fab-panel">
            <div class="pv-fab-panel__inner">
              <p class="pv-fab-panel__title">快速添加</p>
              <div class="pv-fab-panel__grid">
                {FAB_ACTIONS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <Pressable key={a.id} class="pv-fab-action" onClick={() => setOpen(false)}>
                      <span class="pv-fab-action__icon" aria-hidden="true"><Icon size={20} /></span>
                      <b>{a.title}</b>
                      <span>{a.sub}</span>
                    </Pressable>
                  );
                })}
              </div>
            </div>
            <div class="pv-fab-panel__tint" aria-hidden="true" />
          </div>
        )}
        <IconButton
          elRef={fabRef}
          class="pv-fab"
          label={open ? '收起快速添加' : '快速添加'}
          expanded={open}
          variant="filled"
          size="lg"
          onClick={toggle}
          data-testid="fab"
        >
          <MorphIcon kind="plus" state={open} size={26} />
        </IconButton>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 圆形扩散菜单
// ---------------------------------------------------------------------
const MENU = [
  { icon: IconMap, title: '地图' },
  { icon: IconWallet, title: '账本' },
  { icon: IconLuggage, title: '打包清单' },
  { icon: IconUsers, title: '成员' },
  { icon: IconSettings, title: '设置' },
];

export function CircleRevealDemo() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const btnRef = useRef(null);
  const layerRef = useRef(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const btn = btnRef.current;
    if (!layer || !btn) return;
    const items = layer.querySelectorAll('.pv-menu__item');
    if (open) {
      revealCircle(layer, btn);
      // 菜单项依次浮上来（减弱动态效果时只淡入）
      items.forEach((el, i) => {
        animateTween(el, prefersReducedMotion.value
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
          duration: 'slow', easing: 'out', delay: 60 + i * 35, channel: 'menu-item', commit: 'final',
        });
      });
    } else if (shown) {
      items.forEach((el) => animateTween(el, [{ opacity: 0 }], { duration: 'fast', channel: 'menu-item', commit: 'final' }));
      revealCircle(layer, btn, { reverse: true }).finished.then((done) => {
        if (done) setShown(false);
      });
    }
  }, [open, shown]);

  return (
    <div class="pv-stage pv-stage--menu" data-testid="reveal-stage">
      <div class="pv-stage__content">
        <b>行程概览</b>
        <span>点左上角的菜单按钮</span>
      </div>
      {shown && (
        <nav ref={layerRef} class="pv-menu" aria-label="更多" data-testid="reveal-layer">
          <ul>
            {MENU.map((m) => {
              const Icon = m.icon;
              return (
                <li key={m.title} class="pv-menu__item">
                  <Pressable class="pv-menu__link" onClick={() => setOpen(false)}>
                    <span class="pv-menu__icon" aria-hidden="true"><Icon size={22} /></span>
                    {m.title}
                  </Pressable>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <IconButton
        elRef={btnRef}
        class="pv-menu-btn"
        label={open ? '关闭菜单' : '打开菜单'}
        expanded={open}
        variant={open ? 'glass' : 'fill'}
        onClick={() => {
          if (!open) setShown(true);
          setOpen(!open);
        }}
        data-testid="reveal-toggle"
      >
        <MorphIcon kind="menu" state={open} />
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------------
// 轻提示（全站唯一的一套：overlay/ 的 toast()，显示在页面底部）
// ---------------------------------------------------------------------
export function ToastDemo() {
  return (
    <>
      <div class="pv-row">
        <Button
          size="sm"
          variant="secondary"
          data-testid="toast-success"
          onClick={() => toast.success('已记一笔：400,000₫（约 HK$121）', { action: { label: '撤销', onClick: () => toast('已撤销') } })}
        >
          成功 + 撤销
        </Button>
        <Button size="sm" variant="secondary" data-testid="toast-info" onClick={() => toast.info('Cathy 刚刚更新了第 2 天的行程')}>说明</Button>
        <Button size="sm" variant="secondary" data-testid="toast-warning" onClick={() => toast.warning('离线中，记账会在联网后自动同步')}>提醒</Button>
        <Button size="sm" variant="secondary" data-testid="toast-danger" onClick={() => toast.error('没有保存上，请稍后重试')}>出错</Button>
      </div>
      <p class="dev-section__note">提示出现在屏幕下方：左右或往下拖可以甩掉，鼠标悬停 / 键盘聚焦时暂停计时；带「撤销」的显示 6 秒。</p>
    </>
  );
}
