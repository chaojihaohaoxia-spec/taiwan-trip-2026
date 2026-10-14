// =====================================================================
// dev/overlays.jsx：弹层系统的展示页（#/dev/overlays 上的各个区块，登记在 dev/demos.js）。
//
// 每个导出的组件是一个区块：
//   SheetDemo      底部面板：内容高度 + 自动聚焦（键盘上移）、半屏 / 全屏两档（拖动、滚动接力）、未保存提醒
//   PanelDemo      从按钮长出来的面板：悬浮加号（加号转 ×）、行程切换器（箭头翻转）
//   MenuDemo       圆形扩散的全屏菜单（三横线转 ×、菜单项错落入场、换页链接）
//   DialogDemo     确认框：普通 / 危险 / 只有一个按钮 / 排队 / 声明式
//   ToastDemo      Toast：普通、成功、出错、撤销、堆叠、常驻
//   PopoverDemo    行尾“更多”小菜单 → 删除确认 → 撤销
//   StackDemo      弹层栈调试：网址里的栈、管理器里的层、锁滚动、互斥、不认识的 id、按需加载的弹层（注册表）
//
// 只用本地状态和虚构内容（和演示数据同一套名字），不连后台。e2e：test/e2e/overlay.e2e.mjs。
// =====================================================================

import './overlays.css';
import { useEffect, useState } from 'preact/hooks';
import {
  Sheet, AnchoredPanel, FullscreenMenu, Dialog, Popover, MenuList, MenuItem, MenuSeparator,
  openOverlay, closeOverlay, useOverlayTrigger, useSheetClaim, useOverlay, confirm, alert, toast, dismissAllToasts,
  layers, isScrollLocked, primeKeyboard, defineOverlays,
} from '../overlay/index.js';
import { MorphIcon } from '../ui/MorphIcon.jsx';
import { notify } from '../lib/notify.js';
import { route, openSheet } from '../router/index.js';
import { formatMoney, parseAmount } from '../lib/money.js';
import { themePreference, setThemePreference } from '../lib/theme.js';
import {
  IconWallet, IconCamera, IconNotebookPen, IconCalendar, IconHome, IconMap, IconReceipt, IconTicket, IconLuggage,
  IconBookOpen, IconSettings, IconTrash, IconPencil, IconPlus, IconMapPin, IconShare,
} from '../ui/icons.js';

// 注册表演示：网址出现 ?sheet=demo-lazy 时才加载 overlays-lazy.jsx（OverlayHost 负责加载和挂上）
defineOverlays({ 'demo-lazy': { kind: 'sheet', load: () => import('./overlays-lazy.jsx') } });

const TRIPS = [
  { id: 'demo-island', emoji: '🌴', name: '椰影岛 · 冬日海岛', detail: '1 月 10 日 – 1 月 13 日 · 未开始' },
  { id: 'demo-cities', emoji: '🏮', name: '三城 · 春日环岛', detail: '3 月 12 日 – 3 月 20 日 · 已结束' },
];

const CURRENCY_CHOICES = ['VND', 'HKD', 'CNY', 'TWD'];
const CATEGORIES = ['餐饮', '交通', '住宿', '门票', '购物', '其他'];

// =====================================================================
// 底部面板
// =====================================================================

function ExpenseSheet() {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('VND');
  const [category, setCategory] = useState('餐饮');
  const value = parseAmount(amount, { currency });
  const valid = Number.isFinite(value) && value > 0;
  const save = async () => {
    if (!valid) return;
    await closeOverlay('demo-expense', { force: true });
    toast.success(`已记一笔（${category}）：${formatMoney(value, currency)}`, { key: 'demo-expense' });
    setAmount('');
  };
  return (
    <Sheet
      sheetId="demo-expense"
      title="记一笔"
      description="演示：金额框自动聚焦；手机上键盘弹起时面板跟着上移"
      testId="sheet-expense"
      footer={(
        <button type="button" class="ovd-primary" data-press="scale" disabled={!valid} onClick={save} data-testid="expense-save">
          {valid ? `保存 · ${formatMoney(value, currency)}` : '保存'}
        </button>
      )}
    >
      <label class="ovd-field">
        <span class="ovd-field__label">金额</span>
        <input
          class="ovd-input ovd-input--amount"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="例如 450k、45万"
          value={amount}
          onInput={(e) => setAmount(e.currentTarget.value)}
          data-autofocus=""
          data-testid="expense-amount"
        />
      </label>
      <fieldset class="ovd-field">
        <legend class="ovd-field__label">币种</legend>
        <div class="ovd-segments" role="radiogroup" aria-label="币种">
          {CURRENCY_CHOICES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={currency === c ? 'true' : 'false'} class="ovd-segment" data-press="scale" onClick={() => setCurrency(c)}>
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset class="ovd-field">
        <legend class="ovd-field__label">分类</legend>
        <div class="ovd-chips">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" class="ovd-chip" data-press="scale" aria-pressed={category === c ? 'true' : 'false'} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <label class="ovd-field">
        <span class="ovd-field__label">备注</span>
        <textarea class="ovd-input" rows={3} placeholder="可以不填" />
      </label>
    </Sheet>
  );
}

const NEARBY = [
  ['夜市小吃街', '步行 6 分钟 · 18:00 后最热闹'],
  ['海边步道', '步行 12 分钟 · 看日落'],
  ['渔港早市', '骑车 8 分钟 · 早上 6 点开'],
  ['椰林咖啡', '步行 3 分钟 · 有冷萃'],
  ['珍珠博物馆', '打车 15 分钟 · 门票另付'],
  ['北岬灯塔', '打车 25 分钟 · 风大带外套'],
  ['南湾沙滩', '打车 10 分钟 · 适合浮潜'],
  ['小岛渡口', '打车 20 分钟 · 船班看天气'],
  ['手作市集', '周末才开 · 可以刷卡'],
  ['老街糖水铺', '步行 9 分钟 · 晚上排队'],
  ['温泉会馆', '打车 30 分钟 · 要预约'],
  ['观星草地', '晚上 9 点后 · 带驱蚊水'],
];

function PlaceSheet() {
  const more = useOverlayTrigger('demo-place-more', { haspopup: 'menu' });
  const [saved, setSaved] = useState(false);
  return (
    <Sheet
      sheetId="demo-place"
      title="南湾沙滩"
      description="半屏 / 全屏两档：拖把手切换，内容区往上滑先展开"
      detents={['medium', 'large']}
      testId="sheet-place"
    >
      <div class="ovd-place">
        <div class="ovd-place__hero" aria-hidden="true">
          <IconMapPin size={28} />
        </div>
        <p class="ovd-place__meta">虚构地址 · 演示数据 · 评级「顶级」</p>
        <div class="ovd-place__actions">
          <button type="button" class="ovd-pill" data-press="scale" aria-pressed={saved ? 'true' : 'false'} onClick={() => setSaved((v) => !v)}>
            {saved ? '已收藏' : '收藏'}
          </button>
          <button type="button" class="ovd-pill" data-press="scale" {...more.props} data-testid="place-more">更多</button>
          <button
            type="button"
            class="ovd-pill ovd-pill--danger"
            data-press="scale"
            data-testid="place-delete"
            onClick={async () => {
              const ok = await confirm({ title: '删除「南湾沙滩」？', message: '当天行程里引用它的条目会变成“位置未知”。', confirmText: '删除', destructive: true });
              if (ok) toast({ message: '已删除「南湾沙滩」', action: { label: '撤销', onClick: () => toast.success('已恢复') } });
            }}
          >
            删除
          </button>
        </div>
        <h3 class="ovd-subtitle">附近</h3>
        <ul class="ovd-list" data-testid="place-list">
          {NEARBY.map(([name, detail]) => (
            <li key={name} class="ovd-list__row">
              <b>{name}</b>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      </div>
      <Popover sheetId="demo-place-more" label="地点操作" testId="popover-place">
        <MenuList>
          <MenuItem icon={<IconShare size={16} />} label="分享位置" onSelect={() => toast('（演示）已复制位置链接')} />
          <MenuItem icon={<IconPencil size={16} />} label="编辑地点" onSelect={() => toast('（演示）编辑地点')} />
        </MenuList>
      </Popover>
    </Sheet>
  );
}

function DiarySheet() {
  const [text, setText] = useState('');
  const dirty = text.trim().length > 0;
  return (
    <Sheet
      sheetId="demo-form"
      title="写日记"
      description="写了字再关（拖走、点遮罩、Esc、返回）会先问“放弃未保存的内容？”"
      confirmClose={dirty}
      testId="sheet-form"
      footer={(
        <button
          type="button"
          class="ovd-primary"
          data-press="scale"
          disabled={!dirty}
          data-testid="form-save"
          onClick={async () => {
            await closeOverlay('demo-form', { force: true });
            setText('');
            toast.success('日记已保存（演示）');
          }}
        >
          保存
        </button>
      )}
    >
      <label class="ovd-field">
        <span class="ovd-field__label">今天</span>
        <textarea
          class="ovd-input"
          rows={5}
          placeholder="今天最开心的一件事……"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          data-autofocus=""
          data-testid="form-text"
        />
      </label>
    </Sheet>
  );
}

/** 内容很短、又有大档的面板（['content', 'large'] + 底部按钮）：'content' 档按内容高度升起，底部按钮在露出来那一截的底边 */
function ShortSheet() {
  return (
    <Sheet
      sheetId="demo-short"
      title="加一条待办"
      description="内容高 + 大档：拖把手到大档，按钮一直贴着面板露出来的底边"
      detents={['content', 'large']}
      testId="sheet-short"
      footer={(
        <button type="button" class="ovd-primary" data-press="scale" data-testid="short-save" onClick={() => closeOverlay('demo-short', { force: true })}>
          加上
        </button>
      )}
    >
      <p class="ovd-place__meta" data-testid="short-body">换 2 万越南盾零钱（演示）</p>
    </Sheet>
  );
}

export function SheetDemo() {
  return (
    <div>
      <div class="dev-buttons">
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" data-testid="open-expense" onClick={() => openOverlay('demo-expense', { keyboard: true })}>
          记一笔
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="open-place" onClick={() => openOverlay('demo-place')}>
          地点详情（两档）
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="open-form" onClick={() => openOverlay('demo-form', { keyboard: true })}>
          写日记（未保存提醒）
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="open-short" onClick={() => openOverlay('demo-short')}>
          短内容 + 底部按钮（两档）
        </button>
      </div>
      <p class="dev-section__note">
        关闭方式：右上角 ×、点遮罩、往下拖（甩一下就走）、Esc、手机返回手势 / 浏览器返回键。宽屏下是底部居中的卡片。
      </p>
      <ExpenseSheet />
      <PlaceSheet />
      <DiarySheet />
      <ShortSheet />
    </div>
  );
}

// =====================================================================
// 从按钮长出来的面板
// =====================================================================

/** 加号面板里的一块方形按钮：点了先收起面板，再做事 */
function Tile({ icon, title, detail, onSelect, keyboard = false, testId }) {
  const ov = useOverlay();
  return (
    <button
      type="button"
      class="ovd-tile"
      data-press="scale"
      data-testid={testId}
      onClick={async () => {
        if (keyboard) primeKeyboard();
        await ov?.close('select');
        onSelect?.();
      }}
    >
      <span class="ovd-tile__icon" aria-hidden="true">{icon}</span>
      <b class="ovd-tile__title">{title}</b>
      <span class="ovd-tile__detail">{detail}</span>
    </button>
  );
}

function TripPillContent({ trip, open }) {
  return (
    <>
      <span class="ovd-trip-pill__emoji" aria-hidden="true">{trip.emoji}</span>
      <span class="ovd-trip-pill__name">{trip.name}</span>
      <MorphIcon kind="chevron" state={open} size={18} />
    </>
  );
}

export function PanelDemo() {
  const fab = useOverlayTrigger('demo-fab');
  const trips = useOverlayTrigger('demo-trips');
  const [trip, setTrip] = useState(TRIPS[0]);
  return (
    <div>
      <div class="ovd-stage">
        <button {...trips.props} type="button" class="ovd-trip-pill" data-press="scale" data-testid="trip-pill" aria-label={`切换行程，现在是「${trip.name}」`}>
          <TripPillContent trip={trip} open={trips.isOpen} />
        </button>
        <p class="ovd-stage__hint">悬浮加号在右下角 → 面板从它长出来，加号转成 ×</p>
        <button {...fab.props} type="button" class="ovd-fab" data-press="scale" data-press-float="" data-testid="fab" aria-label={fab.isOpen ? '关闭' : '快速添加'}>
          <MorphIcon kind="plus" state={fab.isOpen} size={26} />
        </button>
      </div>

      <AnchoredPanel
        sheetId="demo-fab"
        placement="above"
        align="end"
        width={380}
        title="快速添加"
        testId="panel-fab"
        anchorProxy={{ class: 'ovd-fab', label: '关闭快速添加', render: ({ open }) => <MorphIcon kind="plus" state={open} size={26} /> }}
      >
        <div class="ovd-tiles">
          <Tile icon={<IconWallet size={22} />} title="记一笔" detail="越南盾自动折合港币" keyboard testId="tile-expense" onSelect={() => openOverlay('demo-expense')} />
          <Tile icon={<IconCamera size={22} />} title="拍照打卡" detail="照片自动归到当天" onSelect={() => toast('（演示）打开相机')} />
          <Tile icon={<IconNotebookPen size={22} />} title="写日记" detail="今天的小事和心情" keyboard onSelect={() => openOverlay('demo-form')} />
          <Tile icon={<IconCalendar size={22} />} title="加行程" detail="插进某一天的时间轴" onSelect={() => toast('（演示）加行程')} />
        </div>
      </AnchoredPanel>

      <AnchoredPanel
        sheetId="demo-trips"
        placement="below"
        align="start"
        width={320}
        label="切换行程"
        testId="panel-trips"
        anchorProxy={{ class: 'ovd-trip-pill', label: '收起行程列表', render: ({ open }) => <TripPillContent trip={trip} open={open} /> }}
      >
        <MenuList label="全部行程">
          {TRIPS.map((t) => (
            <MenuItem
              key={t.id}
              icon={<span class="ovd-emoji">{t.emoji}</span>}
              label={t.name}
              detail={t.detail}
              current={t.id === trip.id}
              testId={`trip-${t.id}`}
              onSelect={() => {
                setTrip(t);
                toast(`已切换到「${t.name}」`, { key: 'demo-trip' });
              }}
            />
          ))}
          <MenuSeparator />
          <MenuItem icon={<IconPlus size={18} />} label="新建行程" onSelect={() => toast('（演示）新建行程')} />
        </MenuList>
      </AnchoredPanel>
    </div>
  );
}

// =====================================================================
// 全屏菜单
// =====================================================================

function ThemeSwitch() {
  const pref = themePreference.value;
  const options = [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']];
  return (
    <div class="ovd-theme">
      <span class="ovd-theme__label">外观</span>
      <div class="ovd-segments" role="radiogroup" aria-label="外观">
        {options.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={pref === value ? 'true' : 'false'} class="ovd-segment" data-press="scale" onClick={() => setThemePreference(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MenuDemo() {
  const menu = useOverlayTrigger('demo-menu');
  const say = (what) => () => toast(`（演示）去「${what}」`);
  return (
    <div>
      <div class="ovd-toolbar">
        <span class="ovd-toolbar__title">椰影岛 · 冬日海岛</span>
        <button {...menu.props} type="button" class="ovd-icon-btn" data-press="scale" data-testid="menu-button" aria-label={menu.isOpen ? '关闭菜单' : '打开菜单'}>
          <MorphIcon kind="menu" state={menu.isOpen} />
        </button>
      </div>
      <p class="dev-section__note">圆从按钮中心扩散铺满全屏，菜单项逐个错落入场；关闭时原路收回到按钮。最后一项是真链接：点了换页，菜单那条历史被替换。</p>
      <FullscreenMenu
        sheetId="demo-menu"
        title="椰影岛 · 冬日海岛"
        subtitle="1 月 10 日 – 1 月 13 日 · 4 天"
        testId="menu"
        anchorProxy={{ class: 'ovd-icon-btn', label: '关闭菜单', render: ({ open }) => <MorphIcon kind="menu" state={open} /> }}
        footer={<ThemeSwitch />}
      >
        <MenuList label="行程页面">
          <MenuItem icon={<IconHome size={20} />} label="行程概览" detail="倒计时、今天、下一项" chevron testId="menu-item-home" onSelect={say('行程概览')} />
          <MenuItem icon={<IconCalendar size={20} />} label="每日行程" detail="4 天 · 18 项" chevron onSelect={say('每日行程')} />
          <MenuItem icon={<IconMap size={20} />} label="地图" detail="按天连线" chevron onSelect={say('地图')} />
          <MenuItem icon={<IconReceipt size={20} />} label="账本" detail={`12 笔 · 合计 ${formatMoney(5880000, 'VND')}`} chevron onSelect={say('账本')} />
          <MenuItem icon={<IconTicket size={20} />} label="预订" detail="机票 2 段 · 住宿 3 晚" chevron onSelect={say('预订')} />
          <MenuItem icon={<IconLuggage size={20} />} label="清单" detail="打包 24 项 · 待办 5 项" chevron onSelect={say('清单')} />
          <MenuItem icon={<IconBookOpen size={20} />} label="日记" detail="出发后每晚写一段" chevron onSelect={say('日记')} />
          <MenuItem icon={<IconSettings size={20} />} href="#/dev/tokens" label="设计变量（开发页）" detail="真链接：换页" chevron testId="menu-link" />
        </MenuList>
      </FullscreenMenu>
    </div>
  );
}

// =====================================================================
// 确认框
// =====================================================================

export function DialogDemo() {
  const [last, setLast] = useState('（还没点过）');
  return (
    <div>
      <div class="dev-buttons">
        <button
          type="button"
          class="dev-btn dev-btn--primary"
          data-press="scale"
          data-testid="confirm-normal"
          onClick={async () => {
            const ok = await confirm({ title: '把「渔港早市」移到第 2 天？', message: '原来那天 6:00 的位置会空出来。', confirmText: '移过去' });
            setLast(ok ? '移过去' : '取消');
          }}
        >
          普通确认
        </button>
        <button
          type="button"
          class="dev-btn dev-btn--danger"
          data-press="scale"
          data-testid="confirm-danger"
          onClick={async () => {
            const ok = await confirm({ title: '删除这笔记账？', message: `「晚餐 · ${formatMoney(450000, 'VND')}」删除后 6 秒内可以撤销。`, confirmText: '删除', destructive: true });
            setLast(ok ? '删除' : '取消');
          }}
        >
          删除确认
        </button>
        <button
          type="button"
          class="dev-btn"
          data-press="scale"
          data-testid="alert"
          onClick={async () => {
            await alert({ title: '已复制订单号', message: '演示订单号 DEMO-0001，粘贴到酒店的聊天窗口就行。', okText: '知道了' });
            setLast('知道了');
          }}
        >
          只有一个按钮
        </button>
        <button
          type="button"
          class="dev-btn"
          data-press="scale"
          data-testid="confirm-queue"
          onClick={() => {
            confirm({ title: '第一个确认', message: '点完它，第二个才会出来（同类同时只开一个）。', confirmText: '下一个' }).then((ok) => setLast(`第一个：${ok ? '下一个' : '取消'}`));
            confirm({ title: '第二个确认', message: '排在后面的确认框。' }).then((ok) => setLast((v) => `${v}；第二个：${ok ? '确定' : '取消'}`));
          }}
        >
          连续两个（排队）
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="open-leave" onClick={() => openOverlay('demo-leave')}>
          声明式 Dialog
        </button>
      </div>
      <p class="dev-section__note" data-testid="dialog-result" aria-live="polite">上一次结果：{last}</p>
      <Dialog
        sheetId="demo-leave"
        title="离开编辑？"
        message="改动还没保存。点遮罩也能关（这个确认框开了 closeOnScrim）。"
        closeOnScrim
        testId="leave-dialog"
        actions={[
          { label: '留下', role: 'cancel', testId: 'leave-stay' },
          { label: '不保存，离开', role: 'destructive', testId: 'leave-go', onSelect: () => setLast('不保存，离开') },
        ]}
      />
    </div>
  );
}

// =====================================================================
// Toast
// =====================================================================

const TOAST_ROWS = [
  { id: 'r1', title: '早餐 · 河粉', amount: 65000, currency: 'VND' },
  { id: 'r2', title: '打车去渡口', amount: 120000, currency: 'VND' },
  { id: 'r3', title: '机场快线', amount: 115, currency: 'HKD' },
];

export function ToastDemo() {
  const [rows, setRows] = useState(TOAST_ROWS);
  const remove = (row) => {
    const index = rows.findIndex((r) => r.id === row.id);
    setRows((list) => list.filter((r) => r.id !== row.id));
    toast({
      message: `已删除「${row.title}」`,
      action: {
        label: '撤销',
        onClick: () => setRows((list) => {
          if (list.some((r) => r.id === row.id)) return list;
          const next = [...list];
          next.splice(Math.min(index, next.length), 0, row);
          return next;
        }),
      },
    });
  };
  return (
    <div>
      <div class="dev-buttons">
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-plain" onClick={() => toast('已保存')}>普通</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-success" onClick={() => toast.success(`已记一笔：${formatMoney(400000, 'VND')}`)}>成功</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-warning" onClick={() => toast.warning('离线中：3 条改动联网后自动同步')}>提醒</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-info" onClick={() => toast.info('Cathy 刚刚更新了第 2 天的行程')}>说明</button>
        <button type="button" class="dev-btn dev-btn--danger" data-press="scale" data-testid="toast-error" onClick={() => toast.error('网络不稳定，没保存上，稍后会自动重试')}>出错</button>
        <button
          type="button"
          class="dev-btn"
          data-press="scale"
          data-testid="toast-burst"
          onClick={() => {
            toast('第 1 条：已同步 3 笔记账');
            toast.success('第 2 条：打卡照片已上传');
            toast('第 3 条：Cathy 更新了第 2 天');
          }}
        >
          连发三条（堆叠）
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-sticky" onClick={() => toast({ message: '正在同步……（不会自动消失，同 key 会被替换）', duration: Infinity, key: 'demo-sync' })}>
          常驻
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-notify" onClick={() => notify('已复制当天行程（lib 的 notify() 发出）', { tone: 'success', key: 'copy' })}>
          lib 的 notify()
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="toast-clear" onClick={dismissAllToasts}>全部关掉</button>
      </div>
      <p class="dev-section__note">删除下面的一行会出现带「撤销」的提示（6 秒）；鼠标悬停或键盘焦点在提示上时暂停倒计时；可以左右或往下甩掉。</p>
      <ul class="ovd-rows" data-testid="toast-rows">
        {rows.map((row) => (
          <li key={row.id} class="ovd-row">
            <span class="ovd-row__title">{row.title}</span>
            <span class="ovd-row__amount tabular-nums">{formatMoney(row.amount, row.currency)}</span>
            <button type="button" class="ovd-chip ovd-chip--danger" data-press="scale" data-testid={`delete-${row.id}`} onClick={() => remove(row)}>
              删除
            </button>
          </li>
        ))}
        {rows.length === 0 && <li class="ovd-row ovd-row--empty">都删光了，点提示里的「撤销」找回来</li>}
      </ul>
    </div>
  );
}

// =====================================================================
// 小菜单
// =====================================================================

const EXPENSES = [
  { id: 'e1', title: '晚餐 · 海鲜大排档', amount: 680000, currency: 'VND' },
  { id: 'e2', title: '浮潜船票', amount: 900000, currency: 'VND' },
  { id: 'e3', title: '伴手礼', amount: 168, currency: 'CNY' },
];

function ExpenseRow({ row }) {
  const more = useOverlayTrigger('demo-row-more', { arg: row.id, haspopup: 'menu' });
  return (
    <li class="ovd-row">
      <span class="ovd-row__title">{row.title}</span>
      <span class="ovd-row__amount tabular-nums">{formatMoney(row.amount, row.currency)}</span>
      <button {...more.props} type="button" class="ovd-chip" data-press="scale" data-testid={`more-${row.id}`} aria-label={`「${row.title}」的更多操作`}>
        更多
      </button>
    </li>
  );
}

export function PopoverDemo() {
  const [rows, setRows] = useState(EXPENSES);
  return (
    <div>
      <ul class="ovd-rows" data-testid="popover-rows">
        {rows.map((row) => <ExpenseRow key={row.id} row={row} />)}
      </ul>
      <Popover sheetId="demo-row-more" label="这笔记账的操作" testId="popover">
        {({ arg }) => {
          const row = rows.find((r) => r.id === arg);
          if (!row) return <p class="ovd-muted">这笔记账已经不在了</p>;
          return (
            <MenuList>
              <MenuItem icon={<IconPencil size={16} />} label="编辑" testId="popover-edit" onSelect={() => toast(`（演示）编辑「${row.title}」`)} />
              <MenuItem icon={<IconReceipt size={16} />} label="复制金额" onSelect={() => toast(`已复制 ${formatMoney(row.amount, row.currency)}`)} />
              <MenuSeparator />
              <MenuItem
                icon={<IconTrash size={16} />}
                tone="danger"
                label="删除"
                testId="popover-delete"
                onSelect={async () => {
                  const ok = await confirm({ title: `删除「${row.title}」？`, message: '删除后 6 秒内可以撤销。', confirmText: '删除', destructive: true });
                  if (!ok) return;
                  const index = rows.findIndex((r) => r.id === row.id);
                  setRows((list) => list.filter((r) => r.id !== row.id));
                  toast({
                    message: `已删除「${row.title}」`,
                    action: { label: '撤销', onClick: () => setRows((list) => (list.some((r) => r.id === row.id) ? list : [...list.slice(0, index), row, ...list.slice(index)])) },
                  });
                }}
              />
            </MenuList>
          );
        }}
      </Popover>
    </div>
  );
}

// =====================================================================
// 弹层栈调试
// =====================================================================

export function StackDemo() {
  // 下面「路由弹层参数」演示只显示网址、不画弹层：这里代为认领它的两个 id，免得被当成“不认识的弹层”清掉
  useSheetClaim('demo-a');
  useSheetClaim('demo-b');
  const r = route.value;
  const list = layers.value;
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollY(Math.round(window.scrollY)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return (
    <div>
      <dl class="ovd-kv" data-testid="stack-state">
        <dt>网址里的弹层栈</dt>
        <dd data-testid="stack-route">{r?.sheets.length ? r.sheets.map((s) => (s.arg ? `${s.id}:${s.arg}` : s.id)).join(' → ') : '（空）'}</dd>
        <dt>管理器里的层</dt>
        <dd data-testid="stack-layers">{list.length ? list.map((l) => `${l.sheetId}（${l.kind}，${l.state === 'open' ? '打开' : '退场中'}）`).join(' → ') : '（空）'}</dd>
        <dt>背后页面锁滚动</dt>
        <dd data-testid="stack-locked">{isScrollLocked() ? '锁着' : '没锁'} · scrollY = {scrollY}</dd>
      </dl>
      <div class="dev-buttons">
        <button
          type="button"
          class="dev-btn"
          data-press="scale"
          data-testid="stack-sheet-confirm"
          onClick={async () => {
            await openOverlay('demo-place');
            const ok = await confirm({ title: '面板上面再弹一个确认', message: '确认框盖住面板（层级按打开顺序递增）；返回手势先关它。' });
            toast(ok ? '确认框：确定' : '确认框：取消');
          }}
        >
          面板 + 确认（叠加）
        </button>
        <button
          type="button"
          class="dev-btn"
          data-press="scale"
          data-testid="stack-exclusive"
          onClick={async () => {
            await openOverlay('demo-place');
            openOverlay('demo-expense');
          }}
        >
          同类互斥（面板换面板）
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="stack-unknown" onClick={() => openSheet('demo-nobody')}>
          打开没人认领的 id
        </button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="stack-lazy" onClick={() => openOverlay('demo-lazy', { arg: '450000' })}>
          按需加载的面板（注册表）
        </button>
      </div>
      <ol class="ovd-zlist" aria-label="层级从低到高">
        <li><code>--z-topbar / --z-tabbar / --z-fab</code>导航（顶栏、底栏、悬浮加号）</li>
        <li><code>--z-sheet + n</code>底部面板、从按钮长出来的面板、确认框（n = 第几层）</li>
        <li><code>--z-menu + n</code>全屏菜单（菜单里再弹的确认框跟着它往上叠）</li>
        <li><code>--z-popover + n</code>小菜单（能盖住面板）</li>
        <li><code>--z-toast</code>Toast（永远在最上面，面板开着时“撤销”也点得到）</li>
      </ol>
    </div>
  );
}
