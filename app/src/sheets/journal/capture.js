// =====================================================================
// sheets/journal/capture.js：「拍照打卡」一步到位——点了直接调起相机，拍完照片交给写日记面板。
//
// iOS 只有在点击回调里**同步**调用 input.click() 才会弹出相机 / 相册（异步一下就被拦）。所以“先打开面板、
// 面板里再叫相机”在 iPhone 上不可靠；做法是：点的那一下就叫相机，拍完（change 事件）把照片放进这里的“中转站”，
// 再打开 journal 面板（mode=photo），面板一挂上就从中转站取走照片开始压缩、上传。
//
//   // 方式 1（页面里最稳）：按钮里叠一个透明的 <input type="file" capture>，手指直接点到它上面（原生行为，iOS 一定认）：
//   <PhotoInput camera onFiles={(files) => checkInWith(files, { date })} />     见 PhotoInput.jsx
//   // 方式 2（没法叠 input 的地方，例如外壳的 ＋ 面板）：在点击回调里同步调用
//   capturePhotoCheckIn({ date, itemId, placeId });                              点的那一下就叫相机
//
// 这个文件很小、只依赖 sheets/index.js 的帮手：外壳的 ＋ 面板直接引（拍照打卡的瓷砖上叠着 file input，拍完 checkInWith）。
// =====================================================================

// 按需引 sheets/index.js（它经过 overlay/、router/ 用到 window）：这个文件的其余部分是纯逻辑，Node 里的单元测试能直接引
const openJournal = (fields) => import('../index.js').then((m) => m.openJournalSheet(fields));

/** 中转站：拍完 / 选完还没被面板取走的照片 */
let stash = null;

/** 放进中转站（再打开面板） */
export function stashPhotos(files) {
  const list = [...(files || [])].filter(Boolean);
  stash = list.length ? { files: list, at: Date.now() } : null;
}

/** 面板挂上时取走（只能取一次；超过 2 分钟没人取的作废，免得下次打开面板冒出一张旧照片） */
export function takeStashedPhotos(now = Date.now()) {
  const s = stash;
  stash = null;
  if (!s || now - s.at > 120_000) return [];
  return s.files;
}

/** 中转站里有没有照片（面板据此决定要不要自动叫相机） */
export function hasStashedPhotos() {
  return Boolean(stash?.files?.length);
}

/**
 * 叫出相机 / 相册，选完返回照片（取消返回空数组）。**必须在点击回调里同步调用**。
 * @param {{ camera?: boolean, multiple?: boolean }} [o] camera：直接开相机（手机上；电脑上是选文件）
 * @returns {Promise<File[]>}
 */
export function pickPhotos({ camera = false, multiple = !camera } = {}) {
  if (typeof document === 'undefined') return Promise.resolve([]);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (camera) input.setAttribute('capture', 'environment');
  if (multiple) input.multiple = true;
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(input);
  return new Promise((resolve) => {
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus, true);
      input.remove();
      resolve(files);
    };
    // 取消：新浏览器有 cancel 事件；老的 Safari 只能看“窗口重新拿到焦点后一会儿还没有 change”
    const onFocus = () => setTimeout(() => finish(input.files ? [...input.files] : []), 1200);
    input.addEventListener('change', () => finish([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    window.addEventListener('focus', onFocus, true);
    input.click();
  });
}

/**
 * 选好的照片 → 打开写日记面板（拍照打卡）。
 * @param {File[]} files
 * @param {{ date?: string, itemId?: string, placeId?: string }} [fields]
 */
export function checkInWith(files, fields = {}) {
  if (!files?.length) return Promise.resolve();
  stashPhotos(files);
  return openJournal({ ...fields, mode: 'photo' });
}

/**
 * 「拍照打卡」：点的那一下就叫相机，拍完打开写日记面板。**在点击回调里同步调用**。
 * @param {{ date?: string, itemId?: string, placeId?: string }} [fields]
 */
export function capturePhotoCheckIn(fields = {}) {
  return pickPhotos({ camera: true }).then((files) => checkInWith(files, fields));
}
