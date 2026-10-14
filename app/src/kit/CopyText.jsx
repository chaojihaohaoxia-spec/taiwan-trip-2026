// =====================================================================
// kit/CopyText.jsx：点一下就复制的文字（订单号、地址、电话、Wi-Fi 密码……）。
//
//   <CopyText text="DEMO-FL01" label="订单号" mono />        等宽字；点了复制，提示「已复制订单号」，轻震一下
//   <CopyText text={place.address} label="地址" />            长地址自动折行
//   <CopyText text={code}>{formatCode(code)}</CopyText>      显示的和复制的不一样时：children 是显示的
//
// 外观：浅底小胶囊 + 复制图标（一眼看得出能点）；复制成功后图标换成对勾 1.6 秒。
// 复制走 lib/clipboard.js（iOS 兼容、真换行、提示走 Toast），触感走 lib/native.js 的 haptic（以后 iOS 外壳接管）。
// 读屏：按钮名「复制订单号：DEMO-FL01」；复制结果由 Toast（aria-live）读出来。
// =====================================================================

import './CopyText.css';
import { useCopy } from '../lib/clipboard.js';
import { haptic } from '../lib/native.js';
import { Glyph } from './Glyph.jsx';

/**
 * @param {{ text: string, label?: string, mono?: boolean, size?: 'sm'|'md', block?: boolean, children?: any, class?: string,
 *           onCopied?: (result: object) => void }} props
 *   block：占满一行（长地址）
 */
export function CopyText({ text, label = '', mono = false, size = 'md', block = false, children, class: className, onCopied, ...rest }) {
  const { copy, copied } = useCopy();
  const value = String(text ?? '');
  if (!value) return null;
  const onClick = () => {
    // 同步发起（iOS 只认点击回调里直接发起的复制）
    copy(value, { label }).then((r) => {
      if (r.ok) haptic('success');
      onCopied?.(r);
    });
  };
  const cls = ['k-copy', mono && 'k-copy--mono', `k-copy--${size}`, block && 'k-copy--block', copied && 'k-copy--done', className]
    .filter(Boolean).join(' ');
  return (
    <button type="button" class={cls} onClick={onClick} data-press="scale" aria-label={`复制${label}：${value}`} {...rest}>
      <span class="k-copy__text">{children ?? value}</span>
      <span class="k-copy__icon" aria-hidden="true">
        <Glyph name={copied ? 'check' : 'copy'} size={size === 'sm' ? 14 : 16} stroke={copied ? 2.4 : 1.9} />
      </span>
    </button>
  );
}
