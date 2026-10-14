// =====================================================================
// shell/undo-toast.js：把数据层的“最近一次可撤销的删除”（data/index.js 的 undoable）显示成
// 「已删除「…」 · 撤销」提示条。全站一处接好，页面删东西不用自己再弹提示。
//
//   bridgeUndoToasts(undoable)   main.jsx 在数据层加载好之后调用一次（数据层单独成包，这里不直接 import 它）
//
// 规则（代码评审 M4）：
//   - 提示条的时长 = undoable.expiresAt − 现在，并且**不暂停**（pausable: false）：悬停、切去微信再回来都照样走表，
//     提示条消失的那一刻正好是删除真正发给服务器的时刻（data/trip-store.js 的 remove：硬删除 undoMs 后才发）；
//     否则会出现“撤销按钮还在、点了却没用”；
//   - 点「撤销」：undo() 返回 false（已经发出去了 / 已经恢复过）→ 提示“删除已经生效，没能撤销”；
//   - 又删了一条：同一个 key 替换掉上一条（不会堆一串）；撤销窗口过了（undoable 变回 null）→ 收起。
// =====================================================================

import { effect } from '@preact/signals';
import { toast } from '../overlay/toast.js';

/** 剩不到这么久就不弹了（来不及点） */
const MIN_VISIBLE_MS = 600;
const KEY = 'undo-delete';

/**
 * @param {import('@preact/signals').Signal<{ id: string, label: string, undo: () => Promise<boolean>, expiresAt: number } | null>} undoable
 * @param {{ now?: () => number }} [o]
 * @returns {() => void} 卸下
 */
export function bridgeUndoToasts(undoable, { now = () => Date.now() } = {}) {
  let shown = null;
  return effect(() => {
    const u = undoable.value;
    if (!u) {
      shown?.handle.dismiss();
      shown = null;
      return;
    }
    if (shown?.id === u.id) return;
    const remaining = u.expiresAt - now();
    if (remaining < MIN_VISIBLE_MS) return;
    const handle = toast({
      message: u.label,
      key: KEY,
      duration: remaining,
      pausable: false,
      action: {
        label: '撤销',
        onClick: async () => {
          let ok = false;
          try {
            ok = await u.undo();
          } catch {
            ok = false;
          }
          if (!ok) toast.warning('删除已经生效，没能撤销', { key: KEY });
        },
      },
    });
    shown = { id: u.id, handle };
  });
}
