// =====================================================================
// sheets/place/flow.js：「地点详情 → 写评级 → 回到地点详情」的衔接。
//
// 底部面板同一时间只开一个（overlay/ 的规则：同类互斥），所以在地点详情里点「写评级」是把地点详情换成写评级面板
// （openReviewSheet(…, { replace: true })）。这里记一笔“从哪个地点详情过来的”，写评级面板关掉时（保存了、取消、
// 往下拉、返回手势都算）再把地点详情开回来——像 iOS 上一层面板盖着另一层，关掉上面那层就回到下面那层。
//
//   markReturnToPlace(placeId)          地点详情里点「写评级」之前调用
//   takeReturnToPlace(placeId) → bool   写评级面板打开时取走（只认同一个地点、30 分钟内的；取一次就清掉）
//
// 只在内存里：刷新页面后从网址直接打开的写评级面板，关掉就回到页面（没有“下面那层”）。
// =====================================================================

/** 记录保留多久（毫秒）：打开写评级后去忙别的、很久以后才关，不再跳回地点详情 */
export const RETURN_TTL_MS = 30 * 60 * 1000;

let pending = null;

/** 地点详情里点「写评级」之前调用 */
export function markReturnToPlace(placeId, at = Date.now()) {
  pending = placeId ? { placeId, at } : null;
}

/** 写评级面板打开时调用：是不是从这个地点的详情过来的（取一次就清掉） */
export function takeReturnToPlace(placeId, at = Date.now()) {
  const p = pending;
  pending = null;
  return Boolean(p && placeId && p.placeId === placeId && at - p.at >= 0 && at - p.at < RETURN_TTL_MS);
}
