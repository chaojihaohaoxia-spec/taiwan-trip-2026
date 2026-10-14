// =====================================================================
// overlay/OverlayHost.jsx：弹层宿主（app.jsx 里挂一个，和 RouterView 平级）。
//
// 它做五件事：
//   1. 开始盯着网址里“谁都不认识”的弹层 id（宽限后关掉，见 manager.js）；
//   2. 注册表里登记过的按需加载弹层（defineOverlays）：网址里出现这个 id 时加载模块并挂上，
//      之后一直挂着（模块自己的 <Sheet>/<Dialog> 按网址决定显示与否，关闭时还要播退场动画）；
//   3. 命令式确认框 confirm() / alert() 的显示（DialogHost）；
//   4. Toast 显示区（ToastRegion，放进弹层挂载点：模态弹层开着时它也能点）；
//   5. 接上 lib/notify.js 的提示总线：lib 里的工具（复制、汇率、网络……）notify() 发出的提示在这里显示成 Toast。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { route } from '../router/index.js';
import { recoverFromChunkError } from '../lib/lazy.js';
import { onNotify, lastNotice } from '../lib/notify.js';
import { toast } from './toast.js';
import { startUnknownCleanup, registeredOverlay, registryVersion, closeOverlay } from './manager.js';
import { Portal } from './Portal.jsx';
import { DialogHost } from './Dialog.jsx';
import { ToastRegion } from './Toast.jsx';

/** 加载并挂上一个注册表里的弹层模块 */
function RegisteredOverlay({ id }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let alive = true;
    const entry = registeredOverlay(id);
    if (!entry) return undefined;
    entry.load().then(
      (mod) => alive && setComp(() => mod.default),
      (error) => {
        if (recoverFromChunkError(error)) return;
        console.error(`[overlay] 加载弹层「${id}」失败`, error);
        closeOverlay(id, { force: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return Comp ? <Comp /> : null;
}

/** 宿主挂上之前发出的提示，多久以内的还补显示（毫秒） */
const LATE_NOTICE_MS = 3000;

export function OverlayHost() {
  useEffect(() => startUnknownCleanup(), []);

  // lib/notify.js：lib 只“发”提示，这里“收”并显示（字段和 toast() 一致）
  useEffect(() => {
    const early = lastNotice.peek();
    if (early && Date.now() - early.at < LATE_NOTICE_MS) toast(early);
    return onNotify((notice) => toast(notice));
  }, []);

  // 出现过的注册表弹层（加载后一直挂着）
  const r = route.value;
  registryVersion.value; // 订阅：注册表变化时重新看一遍
  const [ids, setIds] = useState(() => new Set());
  const wanted = (r?.sheets || []).map((s) => s.id).filter((id) => registeredOverlay(id) && !ids.has(id));
  useEffect(() => {
    if (wanted.length) setIds((prev) => new Set([...prev, ...wanted]));
  }, [wanted.join(',')]);

  return (
    <>
      {[...ids].map((id) => <RegisteredOverlay key={id} id={id} />)}
      <DialogHost />
      <Portal>
        <ToastRegion />
      </Portal>
    </>
  );
}
