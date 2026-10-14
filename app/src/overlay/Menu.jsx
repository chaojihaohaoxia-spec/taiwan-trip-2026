// =====================================================================
// overlay/Menu.jsx：弹层里的菜单行（小菜单 Popover、全屏菜单 FullscreenMenu、长出来的面板 AnchoredPanel 共用）。
//
//   <MenuList label="行程操作">
//     <MenuItem icon={<IconWallet size={18} />} label="记一笔" detail="越南盾自动折合港币" onSelect={() => openOverlay('expense')} />
//     <MenuItem href="#/t/x/ledger" label="去账本" chevron />
//     <MenuSeparator />
//     <MenuItem tone="danger" label="删除" onSelect={…} />
//   </MenuList>
//
// - 在 Popover（role="menu"）里自动变成菜单语义：menuitem，↑↓ / Home / End 移动焦点；
//   其他地方是普通列表（读屏软件读作“列表，共 n 项”）；
// - 点了之后默认先关掉所在的弹层（等网址更新），再执行 onSelect——这样 onSelect 里再打开别的弹层
//   （比如确认框）不会被一起关掉；带 href 的行交给路由换页（路由会替换掉弹层那条历史）；
// - 每行都有图标底色或强调色文字、≥44px 高，一眼看得出能点；带 data-ov-stagger，全屏菜单里会错落入场。
// =====================================================================

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { useOverlay } from './binding.js';
import { primeKeyboard as primeKeyboardNow } from './focus.js';
import { IconChevronRight } from '../ui/icons-core.js';

/** { mode: 'menu'（小菜单里）| 'list'（其他地方）, label: 小菜单给读屏软件的名字 } */
export const MenuModeContext = createContext({ mode: 'list', label: undefined });

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

/** role="menu" 里的方向键导航 */
function onMenuKeyDown(event) {
  const items = [...event.currentTarget.querySelectorAll(ITEM_SELECTOR)];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  let next = null;
  if (event.key === 'ArrowDown') next = items[(i + 1) % items.length];
  else if (event.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
  else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items[items.length - 1];
  if (next) {
    event.preventDefault();
    next.focus({ preventScroll: false });
  }
}

/**
 * @param {{ children: any, label?: string, class?: string }} props
 */
export function MenuList({ children, label, class: cls = '' }) {
  const { mode, label: inherited } = useContext(MenuModeContext);
  if (mode === 'menu') {
    return (
      <div class={`ov-menu-list ${cls}`} role="menu" aria-orientation="vertical" aria-label={label ?? inherited} onKeyDown={onMenuKeyDown}>
        {children}
      </div>
    );
  }
  return (
    <ul class={`ov-menu-list ${cls}`} role="list" aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * @param {Object} props
 * @param {string} [props.href]            站内链接（'#/…'）；有它就渲染成 <a>
 * @param {(e: Event) => any} [props.onSelect]
 * @param {any} [props.icon]               左边的图标（放在强调色浅底的小方块里）
 * @param {any} [props.label]              文字（也可以用 children）
 * @param {any} [props.detail]             第二行说明
 * @param {'neutral'|'danger'} [props.tone='neutral']   （旧写法 'default' 等于 'neutral'）
 * @param {boolean} [props.chevron]        末尾带一个圆底小箭头（去别的页面）
 * @param {boolean} [props.closeOnSelect=true]
 * @param {boolean} [props.primeKeyboard]  onSelect 会打开带输入框的面板时传 true（iOS 先把键盘叫出来）
 * @param {boolean} [props.current]        当前所在的页面（aria-current）
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.autofocus]      打开弹层时焦点先落在这一行
 * @param {string} [props.testId]
 */
export function MenuItem(props) {
  const {
    href, onSelect, icon, label, detail, tone = 'neutral', chevron = false, closeOnSelect = true,
    primeKeyboard = false, current = false, disabled = false, autofocus = false, testId, children,
  } = props;
  const { mode } = useContext(MenuModeContext);
  const ov = useOverlay();

  const handle = async (event) => {
    if (disabled) return;
    if (primeKeyboard) primeKeyboardNow();
    if (href) return; // 交给路由（它会替换掉弹层那条历史，弹层自己收回）
    event.preventDefault();
    if (closeOnSelect && ov) await ov.close('select');
    onSelect?.(event);
  };

  const inner = (
    <>
      {icon && <span class="ov-menu-item__icon" aria-hidden="true">{icon}</span>}
      <span class="ov-menu-item__text">
        <span class="ov-menu-item__label">{label ?? children}</span>
        {detail && <span class="ov-menu-item__detail">{detail}</span>}
      </span>
      {chevron && (
        <span class="ov-menu-item__chevron" aria-hidden="true">
          <IconChevronRight size={16} strokeWidth={2.4} />
        </span>
      )}
    </>
  );
  const common = {
    class: 'ov-menu-item',
    'data-press': 'scale',
    'data-tone': tone === 'danger' ? 'danger' : 'neutral',
    'data-testid': testId,
    'data-autofocus': autofocus ? '' : undefined,
    'aria-current': current ? 'page' : undefined,
    role: mode === 'menu' ? 'menuitem' : undefined,
    onClick: handle,
  };
  const control = href && !disabled
    ? <a href={href} {...common} data-ov-stagger={mode === 'menu' ? '' : undefined}>{inner}</a>
    : (
      <button type="button" {...common} disabled={disabled} data-ov-stagger={mode === 'menu' ? '' : undefined}>
        {inner}
      </button>
    );
  if (mode === 'menu') return control;
  return <li class="ov-menu-row" data-ov-stagger="">{control}</li>;
}

/** 分隔线 */
export function MenuSeparator() {
  const { mode } = useContext(MenuModeContext);
  if (mode === 'menu') return <hr class="ov-menu-separator" role="separator" />;
  return <li class="ov-menu-row" role="presentation"><hr class="ov-menu-separator" /></li>;
}
