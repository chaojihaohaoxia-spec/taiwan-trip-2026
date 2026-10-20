// =====================================================================
// overlay/index.js：弹层系统的对外入口（页面、外壳、ui 组件都从这里 import）。
//
//   import { Sheet, AnchoredPanel, FullscreenMenu, Dialog, Popover, MenuList, MenuItem,
//            openOverlay, closeOverlay, useOverlayTrigger, confirm, alert, toast } from '../overlay/index.js';
//
// 说明和示例见同目录 README.md。
// =====================================================================

// 组件
export { Sheet } from './Sheet.jsx';
export { AnchoredPanel } from './AnchoredPanel.jsx';
export { FullscreenMenu } from './FullscreenMenu.jsx';
export { Dialog } from './Dialog.jsx';
export { Popover } from './Popover.jsx';
export { MenuList, MenuItem, MenuSeparator } from './Menu.jsx';
export { CloseButton } from './parts.jsx';
export { OverlayHost } from './OverlayHost.jsx';

// 开关与状态
export {
  openOverlay, closeOverlay, toggleOverlay, isOverlayOpen, defineOverlays, claimSheet, layers, topOpenLayer,
} from './manager.js';
export { useOverlayTrigger, useSheetClaim, useOverlay, useOpenedGate, DISCARD_TEXTS } from './binding.js';

// 命令式
export { confirm, alert } from './dialogs.js';
export { toast, dismissToast, dismissToastKey, dismissAllToasts, toasts } from './toast.js';

// 工具
export { primeKeyboard, hadUserInput } from './focus.js';
export { isScrollLocked } from './scroll-lock.js';

// 自定义全屏弹层（「给司机看」、看大图这类不是 Sheet / 面板 / 菜单的）要的基础设施：网址联动、焦点、背景 inert、Esc、
// 挂到弹层根节点、找触发按钮、几何、淡入淡出。用法见 sheets/driver/DriverSheet.jsx 和 README「自定义全屏弹层」
export { useOverlayRoute, useLayer, OverlayContext } from './binding.js';
export { Portal } from './Portal.jsx';
export { findTrigger } from './manager.js';
export { anchorRect, viewportInfo, uid, setPageCovered } from './dom.js';
export { fadeTo, prepareHidden, scrimTo } from './transitions.js';
