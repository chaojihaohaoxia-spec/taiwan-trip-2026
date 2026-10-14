// =====================================================================
// dev/pages/lib/ImageDemo.jsx：照片压缩 + 读拍摄时间（lib/image.js、lib/exif.js）。
//
//   - 选一张照片：压缩成长边 2048 的 JPEG，显示前后体积、尺寸、拍摄时间（按行程时区理解）；
//   - 生成测试照片：在画布上画一张 3000×2000 的图转 JPEG，再塞进 EXIF（拍摄时间 + 时区 +07:00），
//     走一遍完整流程——e2e 用它验证“压缩 + 读 EXIF”在真浏览器里能跑通；
//   - 演示照片：演示数据里的插画（没有 EXIF，应显示“照片里没有拍摄时间”）。
// 画布颜色取设计变量（cssVar），不写死颜色。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { compressImage, formatBytes } from '../../../lib/image.js';
import { cssVar } from '../../../lib/theme.js';
import { loadDemoDb } from '../../../data/demo.js';
import { IconImage, IconSparkles } from '../../../ui/icons.js';
import { buildTiff, insertJpegExif } from './exif-fixture.js';

const TRIP_TZ = 'Asia/Ho_Chi_Minh';

/** 画一张测试图（渐变 + 网格），转 JPEG，再插入 EXIF */
async function makeFixturePhoto() {
  const canvas = document.createElement('canvas');
  canvas.width = 3000;
  canvas.height = 2000;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 3000, 2000);
  g.addColorStop(0, cssVar('--color-cat-6') || cssVar('--color-accent'));
  g.addColorStop(0.55, cssVar('--color-cat-1') || cssVar('--color-accent'));
  g.addColorStop(1, cssVar('--color-cat-4') || cssVar('--color-accent'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 3000, 2000);
  ctx.strokeStyle = cssVar('--color-glass-highlight') || cssVar('--color-separator');
  ctx.lineWidth = 6;
  for (let x = 0; x <= 3000; x += 250) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 2000);
    ctx.stroke();
  }
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  const tiff = buildTiff({ dateTimeOriginal: '2027:01:10 17:42:05', offsetTimeOriginal: '+07:00', make: 'Demo', model: 'Fixture Camera', orientation: 1 });
  return new File([insertJpegExif(bytes, tiff)], 'fixture.jpg', { type: 'image/jpeg' });
}

function takenText(t) {
  if (!t?.local) return '照片里没有拍摄时间';
  const [date, time] = t.local.split('T');
  const how = t.source === 'exif-offset' ? '照片自带时区' : t.source === 'time-zone' ? '按行程时区理解' : '不知道时区';
  return `${date} ${time.slice(0, 5)}（${t.offset || '无偏移'}，${how}）`;
}

export default function ImageDemo() {
  const [state, setState] = useState({ status: 'idle' });
  const [preview, setPreview] = useState(null);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const run = async (getFile, name) => {
    setState({ status: 'working', name });
    try {
      const file = await getFile();
      const out = await compressImage(file, { timeZone: TRIP_TZ });
      setPreview(URL.createObjectURL(out.blob));
      setState({ status: 'done', name, out });
    } catch (error) {
      setState({ status: 'error', name, message: error.message });
    }
  };

  const onPick = (e) => {
    const file = e.currentTarget.files?.[0];
    if (file) run(async () => file, file.name);
    e.currentTarget.value = '';
  };

  const demoPhoto = async () => {
    const db = await loadDemoDb();
    const url = Object.values(db.photoUrls).find(Boolean);
    const blob = await (await fetch(url)).blob();
    return new File([blob], 'demo-photo.jpg', { type: blob.type || 'image/jpeg' });
  };

  const out = state.out;
  return (
    <article class="lp-card" data-testid="img-card" data-status={state.status}>
      <header class="lp-card__head">
        <h3 class="lp-card__title">照片压缩 + 拍摄时间<span class="lp-card__sub">长边 2048 的 JPEG，去掉 GPS 等元数据；拍摄时间先读出来</span></h3>
      </header>
      <div class="dev-buttons">
        <label class="dev-btn dev-btn--primary lp-file" data-press="scale">
          <IconImage size={16} aria-hidden="true" />
          <span>选一张照片</span>
          {/* 透明的文件框盖满整个按钮：点哪里都能选，读屏也读得到 */}
          <input type="file" accept="image/*" class="lp-file__input" onChange={onPick} data-testid="img-input" aria-label="选一张照片" />
        </label>
        <button type="button" class="dev-btn" data-press="scale" onClick={() => run(makeFixturePhoto, '测试照片（带 EXIF）')} disabled={state.status === 'working'} data-testid="img-fixture">
          <IconSparkles size={16} aria-hidden="true" />
          <span>生成测试照片</span>
        </button>
        <button type="button" class="dev-btn" data-press="scale" onClick={() => run(demoPhoto, '演示照片')} disabled={state.status === 'working'} data-testid="img-demo">
          用演示照片
        </button>
      </div>
      {state.status === 'working' && <p class="lp-muted">正在处理 {state.name}…</p>}
      {state.status === 'error' && <p class="lp-error" data-testid="img-error">{state.message}</p>}
      {state.status === 'done' && (
        <div class="lp-img">
          {preview && <img class="lp-img__preview" src={preview} alt={`压缩后的${state.name}`} width={out.width} height={out.height} />}
          <dl class="lp-kv" data-testid="img-result">
            <div class="lp-kv__row"><dt>文件</dt><dd>{state.name}</dd></div>
            <div class="lp-kv__row"><dt>尺寸</dt><dd class="tabular-nums" data-testid="img-size">{out.sourceWidth}×{out.sourceHeight} → {out.width}×{out.height}</dd></div>
            <div class="lp-kv__row"><dt>体积</dt><dd class="tabular-nums">{formatBytes(out.bytesBefore)} → {formatBytes(out.bytesAfter)}（{out.type}）</dd></div>
            <div class="lp-kv__row"><dt>拍摄时间</dt><dd data-testid="img-taken">{takenText(out.takenAt)}</dd></div>
            {out.exif?.make && <div class="lp-kv__row"><dt>相机</dt><dd>{out.exif.make} {out.exif.model}</dd></div>}
          </dl>
        </div>
      )}
    </article>
  );
}
