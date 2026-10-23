// =====================================================================
// sheets/trip-new/moves.js：新建行程、设置页每趟行程卡共用的两样小东西（单独一个文件，设置页不用拉城市表）：
//   MOVE_HINT       「这趟怎么走」每一种给什么按钮的一句话
//   partnerOf       对方叫什么（「和 Cathy 一起」「把 Cathy 加进来」）
// =====================================================================

/** 选了这一种，每天给什么按钮（芯片下面那句） */
export const MOVE_HINT = Object.freeze({
  ride: '远一点就给叫车和「给司机看」',
  transit: '远一点给导航，也能叫车',
  self_drive: '只给导航，按开车走',
  scooter: '只给导航，按开车走',
  walk: '3 公里内都按走路',
});

/** 对方：那趟行程里另一位能编辑的成员 → 名字（没有、或者不止一位（带了朋友的那趟认不准是谁）→ null，界面写「对方」） */
export function partnerOf(members = [], me = null) {
  const others = members.filter((x) => x.user_id !== me && ['owner', 'editor'].includes(x.role));
  if (others.length !== 1) return null;
  const m = others[0];
  return m.display_name || String(m.email || '').split('@')[0] || null;
}
