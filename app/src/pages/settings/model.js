// =====================================================================
// pages/settings/model.js：设置页的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//   formatBytes(n)        本机占用：'3.2 MB'
//   storageLabel(s)       syncStatus.storage → { text, tone }
//   syncTone(state)       syncStatus.state → InfoRow 的语气
//   versionParts(v)       '2.0.0+0a1b2c3d4e' → { version: '2.0.0', build: '0a1b2c3d4e' }
//   FONT_LICENSES         三种字体的授权文件（构建时复制到产物的 fonts/licenses/，scripts/build.mjs 的 FONT_LICENSE_FILES）
// =====================================================================

/** 字节数 → 'KB / MB / GB'（一位小数，整数不带小数） */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const t = x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString();
  return `${t} ${units[i]}`;
}

/** 本机存储状态（syncStatus.storage：ok / memory / unavailable） */
export function storageLabel(state) {
  if (state === 'memory') return { text: '暂时只存在内存里', tone: 'warning' };
  if (state === 'unavailable') return { text: '暂时读不了，稍后自动重试', tone: 'warning' };
  return { text: '正常', tone: 'neutral' };
}

/** 同步状态的语气 */
export function syncTone(state) {
  if (state === 'error' || state === 'stale') return 'danger';
  if (state === 'offline' || state === 'retrying') return 'warning';
  return 'neutral';
}

/** 版本号拆成「版本 · 构建号」 */
export function versionParts(v) {
  const s = String(v || '').trim();
  if (!s) return { version: '—', build: '' };
  const [version, build = ''] = s.split('+');
  return { version: version || s, build };
}

/** 字体授权文件（相对网站根目录） */
export const FONT_LICENSES = Object.freeze([
  { key: 'noto', name: '思源宋体 Noto Serif SC', use: '标题、行程名、大按钮', file: 'fonts/licenses/Noto-Serif-SC-OFL.txt' },
  { key: 'instrument', name: 'Instrument Serif', use: '大号数字（倒计时、金额、时间）', file: 'fonts/licenses/Instrument-Serif-OFL.txt' },
  { key: 'geist', name: 'Geist', use: '日期、计数、标签', file: 'fonts/licenses/Geist-OFL.txt' },
]);
