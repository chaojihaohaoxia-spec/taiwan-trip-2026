// =====================================================================
// data/hooks.js：给页面组件用的 Preact hooks（index.js 用 createHooks(data) 生成并导出）。
//
//   const store = useTrip(route.params.tripId);   // 进页面自动打开行程（缓存 → 网络 → 实时）；
//                                                 // 离开行程（最后一个用它的页面卸载 15 秒后）自动退订实时；
//                                                 // 还没确定登录（恢复会话中 / 没登录）时是 null，不发任何请求
//   store.status.value / store.view.plans.value / store.addExpense(...)
//   const list = useMyTrips();                    // { status, entries, error }，进页面自动刷新
//   const url = useSignedUrl(photo.path);         // 照片签名链接（有缓存直接给，没有就去取）
//
// 组件里读 signal 的 .value 会自动订阅（@preact/signals），数据一变组件自动重画。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';

/**
 * @param {ReturnType<import('./layer.js').createDataLayer>} data
 * @param {() => any} [start] 启动数据层（幂等）。hooks 第一次用到时自动调用：外壳还没接 initData() 时页面也能用
 */
export function createHooks(data, start = () => data.auth.init()) {
  /**
   * 打开一个行程并返回它的 TripStore。tripId 为空返回 null。换账号后会自动换成新的 store。
   * 同一个行程里换页面（概览 → 当天 → 地图）：实时在线、刚同步过时不会重拉整包（trip-store.js 的 open）；
   * 页面卸载时登记“不用了”，最后一个用它的页面离开一段时间后退订实时（layer.js 的 retainTrip）。
   */
  function useTrip(tripId) {
    // 读 userId：换账号时组件重画，拿到新账号的 store。
    // 确定登录了才打开行程（恢复登录期间 / 没登录时返回 null）：没登录的人打开深层链接会被守卫带去登录页，
    // 不要先去拉行程、发注定失败的请求；页面拿到 null 就显示加载中（外壳评审：以前页面各自手写这道门）
    const uid = data.userId.value;
    const id = uid && tripId ? tripId : null;
    const store = id ? data.getStore(id) : null;
    useEffect(() => {
      start();
      if (!id) return undefined;
      return data.retainTrip(id);
    }, [id, store]);
    return store;
  }

  /** 全部行程列表（进页面刷新一次；先显示缓存） */
  function useMyTrips() {
    const uid = data.userId.value;
    useEffect(() => {
      start();
      if (uid) data.trips.load();
    }, [uid]);
    return data.trips.state.value;
  }

  /** 文件签名链接；path 为空返回 null；取不到返回 null（页面显示占位） */
  function useSignedUrl(path) {
    data.files.version.value;
    const [url, setUrl] = useState(() => data.files.peek(path));
    useEffect(() => {
      let alive = true;
      const hit = data.files.peek(path);
      if (hit) {
        setUrl(hit);
        return undefined;
      }
      setUrl(null);
      if (path) data.files.getSignedUrl(path).then((u) => alive && setUrl(u));
      return () => {
        alive = false;
      };
    }, [path]);
    return path ? data.files.peek(path) || url : null;
  }

  return { useTrip, useMyTrips, useSignedUrl };
}
