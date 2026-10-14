// =====================================================================
// ui/EmptyState.jsx：空状态（还没有记录、搜不到、出错）。图标 + 标题 + 一句说明 + 一个主要操作。
//
//   <EmptyState icon={IconReceipt} title="还没有记账" description="点下面的按钮记下第一笔，越南盾会自动折合港币。"
//               action={<Button leading={IconPlus} onClick={…}>记一笔</Button>} />
//   <EmptyState tone="danger" icon={IconWifiOff} title="没有网络" … />
//
// 出现时轻轻浮上来（只做一次，减弱动态效果时只淡入）。compact：放在卡片里的小号版本。
// =====================================================================

import './EmptyState.css';
import { cx, renderIcon } from './util.js';

/**
 * @param {{ icon?: any, title: any, description?: any, action?: any, secondary?: any,
 *           tone?: 'neutral'|'accent'|'danger'|'success', compact?: boolean, class?: string }} props
 */
export function EmptyState({ icon, title, description, action, secondary, tone = 'accent', compact = false, class: className, ...rest }) {
  return (
    <div class={cx('empty', `empty--${tone}`, compact && 'empty--compact', className)} {...rest}>
      {icon && <span class="empty__icon" aria-hidden="true">{renderIcon(icon, compact ? 24 : 30)}</span>}
      <p class="empty__title">{title}</p>
      {description && <p class="empty__desc">{description}</p>}
      {(action || secondary) && (
        <div class="empty__actions">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
