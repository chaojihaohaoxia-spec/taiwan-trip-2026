// =====================================================================
// kit/States.jsx：页面级的空状态和出错状态（带一张简洁的线条插图）。
//
//   <PageEmptyState preset="ledger" action={<Button leading={IconPlus} onClick={…}>记一笔</Button>} />
//   <PageEmptyState preset="search" description={`没有和「${q}」有关的内容`} compact />
//   <PageEmptyState preset="day" title="这天自由活动" description="…" />          标题、说明可以覆盖预设
//   <ErrorState error={store.error.value} onRetry={() => store.refresh()} />  中文原因 + 「重试」；网络问题自动换成离线的样子
//
// 预设（插图 + 默认标题 + 说明，见 PRESETS）：trips、invited、day、bookings、ledger、lists、journal、photos、places、tips、
// contacts、search、offline、error、notfound。插图在 kit/illustrations.js（同一种线条笔法，颜色只用设计变量）。
// 外观和 ui/EmptyState 一致：标题宋体、说明次要色、操作按钮居中；compact 是放在卡片里的小号版本。出现时轻轻浮上来。
// =====================================================================

import './States.css';
import { h } from 'preact';
import { Button } from '../ui/Button.jsx';
import { ILLUSTRATIONS } from './illustrations.js';

export const PRESETS = Object.freeze({
  trips: { title: '还没有行程', description: '新建一趟行程，或者打开对方发来的邀请链接加入。' },
  invited: { title: '等你加入', description: '对方已经邀请你了，打开邀请链接就能看到这趟行程。' },
  day: { title: '这一天还没安排', description: '先加几个想去的地方，排好时间就会出现在时间轴上。' },
  bookings: { title: '还没有预订', description: '机票、酒店、活动的预订会出现在这里，免费取消快到期时会提醒。' },
  ledger: { title: '还没有记账', description: '点「记一笔」记下第一笔，外币会自动折合港币。' },
  lists: { title: '清单是空的', description: '在下面加一行，按回车就能接着加下一条。' },
  journal: { title: '还没有日记', description: '今天的小事和心情，两个人各写一篇。' },
  photos: { title: '还没有照片', description: '拍照打卡、写日记时加的照片都会出现在这里。' },
  places: { title: '还没有地点', description: '给行程条目填上地点，或者把想去的地方收进来。' },
  tips: { title: '还没有贴士', description: '防坑提醒、常用语、消息模板都可以放在这里。' },
  contacts: { title: '还没有联系人', description: '酒店前台、司机、导游的电话放这里，一点就能打。' },
  search: { title: '没有找到', description: '换个说法试试：中文、英文、当地文字都可以搜，不用打声调。' },
  offline: { title: '现在没有网络', description: '已经存在这台手机上的内容照常能看，改动联网后会自动同步。' },
  error: { title: '出了点问题', description: '请稍后再试。' },
  notfound: { title: '找不到这一页', description: '可能已经被删除，或者链接打错了。' },
});

/** 插图（装饰，读屏跳过） */
export function Illustration({ name, class: className }) {
  const parts = ILLUSTRATIONS[name] || ILLUSTRATIONS.notfound;
  return (
    <svg class={className ? `k-ill ${className}` : 'k-ill'} viewBox="9 5 102 82" aria-hidden="true" focusable="false" data-illustration={name}>
      {parts.map(([tag, attrs, role], i) => h(tag, { key: i, ...attrs, class: `k-ill__${role}` }))}
    </svg>
  );
}

/**
 * @param {{ preset?: string, title?: any, description?: any, action?: any, secondary?: any, compact?: boolean,
 *           illustration?: string|false, class?: string, testId?: string }} props
 *   illustration：换一张插图（名字），false = 不要插图
 */
export function PageEmptyState({ preset = 'error', title, description, action, secondary, compact = false, illustration, class: className, testId, ...rest }) {
  const def = PRESETS[preset] || PRESETS.error;
  const ill = illustration === false ? null : illustration || preset;
  return (
    <div class={['k-empty', compact && 'k-empty--compact', className].filter(Boolean).join(' ')} data-preset={preset} data-testid={testId} {...rest}>
      {ill && <Illustration name={ill} />}
      <p class="k-empty__title">{title ?? def.title}</p>
      {(description ?? def.description) && <p class="k-empty__desc">{description ?? def.description}</p>}
      {(action || secondary) && (
        <div class="k-empty__actions">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

/** 错误是不是“网络不通 / 离线”（这时换成离线的插图和说法） */
export function isOfflineError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error?.kind === 'network' || error?.kind === 'offline';
}

/**
 * 出错：插图 + 中文原因 + 「重试」。
 * @param {{ error?: any, title?: any, description?: any, onRetry?: () => any, retryLabel?: string, compact?: boolean, class?: string, testId?: string }} props
 *   error：DataError（message 已经是中文）、Error 或一句话；onRetry：给了才有「重试」按钮
 */
export function ErrorState({ error, title, description, onRetry, retryLabel = '重试', compact = false, class: className, testId, ...rest }) {
  const offline = isOfflineError(error);
  const msg = typeof error === 'string' ? error : error?.message;
  // 只显示中文原因（英文的技术报错不给用户看）
  const reason = msg && /[一-鿿]/.test(msg) ? msg : null;
  return (
    <PageEmptyState
      preset={offline ? 'offline' : 'error'}
      title={title ?? (offline ? PRESETS.offline.title : '没有加载成功')}
      description={description ?? reason ?? (offline ? PRESETS.offline.description : PRESETS.error.description)}
      action={onRetry ? <Button variant="secondary" onClick={onRetry} data-testid={testId ? `${testId}-retry` : undefined}>{retryLabel}</Button> : null}
      compact={compact}
      class={['k-empty--error', className].filter(Boolean).join(' ')}
      testId={testId}
      role="alert"
      {...rest}
    />
  );
}
