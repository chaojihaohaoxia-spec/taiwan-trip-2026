// =====================================================================
// pages/settings/account.js：退出登录的流程（设置页和行程列表底部的账号条共用）。
//
//   await signOutFlow()   → true（已退出，数据层的守卫会把页面带到登录页）/ false（取消了或没退出成功，已经提示过）
//
// 规则（SPEC §5.12「有没同步的改动先确认」）：
//   - 离线而且还有改动排着队：先问（不用白等数据层 6 秒的“先发完再退”）；
//   - 在线：交给数据层先把排队的改动发完；还有发不出去的（data.auth.signOut 返回 unsynced）再问；
//   - 问的时候说清楚有几条、退出会丢；「先不退出」是默认（取消）按钮。
// 没有排队的改动时不问，直接退（一键就走，测试 shell.e2e 也是这么点的）。
// =====================================================================

import { data, syncStatus, online } from '../../data/index.js';
import { confirm, toast } from '../../overlay/index.js';

async function askDiscard(pending, offline) {
  return confirm({
    title: '还有改动没同步',
    message: offline
      ? `有 ${pending} 条改动还存在这台设备上，现在没有网络、传不上去。现在退出，这些改动会丢掉。建议连上网络等同步完再退出。`
      : `有 ${pending} 条改动没能传到服务器。现在退出，这些改动会丢掉。`,
    confirmText: '仍然退出',
    cancelText: '先不退出',
    destructive: true,
  });
}

/** 退出登录（见文件头）。返回是否真的退出了 */
export async function signOutFlow() {
  try {
    const s = syncStatus.peek?.() ?? syncStatus.value;
    const pending = Number(s?.pending) || 0;
    const isOnline = online.peek?.() ?? online.value;
    if (pending > 0 && isOnline === false) {
      if (!(await askDiscard(pending, true))) return false;
      const r = await data.auth.signOut({ discardUnsynced: true });
      if (!r.ok) toast.error('没有退出成功，请稍后再试');
      return Boolean(r.ok);
    }
    let r = await data.auth.signOut();
    if (!r.ok && r.reason === 'unsynced') {
      if (!(await askDiscard(r.pending, false))) return false;
      r = await data.auth.signOut({ discardUnsynced: true });
    }
    if (!r.ok) toast.error('没有退出成功，请稍后再试');
    return Boolean(r.ok);
  } catch (error) {
    toast.error(error?.message && /[一-鿿]/.test(error.message) ? error.message : '没有退出成功，请稍后再试');
    return false;
  }
}
