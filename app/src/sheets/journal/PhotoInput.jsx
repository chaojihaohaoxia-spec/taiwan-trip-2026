// =====================================================================
// sheets/journal/PhotoInput.jsx：「拍照」「从相册选」按钮——一个看起来是普通按钮、实际上手指点到的是
// 透明的 <input type="file"> 的组件。iOS 只在**真实的点击**落在 file input 上时才一定会弹出相机 / 相册
// （JS 里异步 input.click() 会被拦），所以按钮上直接叠一层 input：点的那一下就是原生行为，一步到位。
//
//   <PhotoInput camera onFiles={(files) => …}>拍照打卡</PhotoInput>          直接开相机（手机；电脑上是选文件）
//   <PhotoInput multiple onFiles={(files) => …}>从相册选</PhotoInput>        相册多选
//   variant / size / block / leading 同 ui/Button；icon 可以给 kit/Glyph 的名字（默认相机 / 照片）
//
// 读屏：input 带 aria-label（按钮文字），按钮本身 aria-hidden；键盘 Tab 到的是 input，回车 / 空格打开选择器。
// 选完 onFiles(File[])，input 立刻清空（同一张照片再选一次也会触发 change）。
// =====================================================================

import './photo-input.css';
import { Button } from '../../ui/Button.jsx';
import { Glyph } from '../../kit/Glyph.jsx';

/**
 * @param {{ camera?: boolean, multiple?: boolean, onFiles: (files: File[]) => void, children: any, icon?: string|false,
 *           variant?: string, size?: string, block?: boolean, disabled?: boolean, class?: string, testId?: string }} props
 */
export function PhotoInput({
  camera = false, multiple = !camera, onFiles, children, icon, variant = 'secondary', size = 'md', block = false, disabled = false,
  class: className, testId, ...rest
}) {
  const glyph = icon === false ? null : icon || (camera ? 'camera' : 'photo');
  const label = typeof children === 'string' ? children : camera ? '拍照' : '选照片';
  return (
    <span class={['jn-pi', block && 'jn-pi--block', disabled && 'jn-pi--disabled', className].filter(Boolean).join(' ')} {...rest}>
      <Button
        as="span"
        variant={variant}
        size={size}
        block={block}
        leading={glyph ? <Glyph name={glyph} size={size === 'lg' ? 22 : 20} /> : undefined}
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
      >
        {children}
      </Button>
      <input
        class="jn-pi__input"
        type="file"
        accept="image/*"
        capture={camera ? 'environment' : undefined}
        multiple={multiple || undefined}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const files = [...(e.currentTarget.files || [])];
          e.currentTarget.value = '';
          if (files.length) onFiles?.(files);
        }}
      />
    </span>
  );
}
