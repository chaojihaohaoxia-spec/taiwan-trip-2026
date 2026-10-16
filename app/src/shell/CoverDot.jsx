// =====================================================================
// shell/CoverDot.jsx：行程的小封面（顶栏胶囊、整条顶栏、行程切换面板、「更多」菜单、行程列表、邀请、新建行程预览）。
//
// 「杂志纸本」：不用 emoji、不画渐变——行程主题色（压成墨一样深的 --color-accent）的纯色底 + 宋体的行程名首字（「富」「台」）。
// 颜色写在这个元素自己身上（accent-scope 重新派生），不跟随 <html> 上过渡中的主题色。
//   <CoverDot info={tripInfo} />                 圆点（32px，顶栏整条）
//   <CoverDot info={tripInfo} small />           小圆点（26px，胶囊）
//   <CoverDot trip={tripRow} shape="tile" />     圆角方块（大小由外面的 class 定）
// 没有主题色的行程用默认的海水绿；没有名字只画底色。有封面照片的地方（行程列表）照片盖在它上面。
// =====================================================================

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** 行程名的第一个字（跳过空白；emoji、标点不算字）。纯函数，单元测试直接测 */
export function coverInitial(title) {
  for (const ch of Array.from(String(title ?? '').trim())) {
    if (/[\p{Script=Han}\p{L}\p{N}]/u.test(ch)) return ch.toLocaleUpperCase();
  }
  return '';
}

/**
 * @param {{ info?: object|null, trip?: object|null, small?: boolean, shape?: 'dot'|'tile', class?: string }} props
 */
export function CoverDot({ info, trip, small = false, shape = 'dot', class: className }) {
  const row = trip || info?.trip || null;
  const cover = row?.cover || null;
  const accent = HEX.test(cover?.accent || '') ? cover.accent : 'initial';
  const accent2 = HEX.test(cover?.accent_2 || '') ? cover.accent_2 : 'initial';
  const initial = coverInitial(row?.title);
  const cls = ['cover-dot', 'accent-scope', shape === 'tile' ? 'cover-dot--tile' : small ? 'cover-dot--sm' : '', className].filter(Boolean).join(' ');
  return (
    <span class={cls} style={{ '--trip-accent': accent, '--trip-accent-2': accent2 }} aria-hidden="true">
      {initial && <span class="cover-dot__char">{initial}</span>}
    </span>
  );
}
