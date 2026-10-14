// =====================================================================
// shell/CoverDot.jsx：行程封面的小圆点 / 小方块（顶栏胶囊、整条顶栏、行程切换面板、「更多」菜单）。
//
// 封面就是 trips.cover（docs/数据结构.md B5.2）：accent → accent_2 的渐变底 + emoji。
// 颜色写在这个元素自己身上（accent-scope 重新派生），不跟随 <html> 上过渡中的主题色。
//   <CoverDot info={tripInfo} />                 圆点（28px，顶栏整条）
//   <CoverDot info={tripInfo} small />           小圆点（22px，胶囊）
//   <CoverDot trip={tripRow} shape="tile" />     圆角方块（切换面板里的大封面 68px，菜单 40px，大小由外面的 class 定）
// 没有主题色的行程用默认的海岛色；没有 emoji 只画渐变。
// =====================================================================

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * @param {{ info?: object|null, trip?: object|null, small?: boolean, shape?: 'dot'|'tile', class?: string }} props
 */
export function CoverDot({ info, trip, small = false, shape = 'dot', class: className }) {
  const cover = trip?.cover || info?.trip?.cover || null;
  const accent = HEX.test(cover?.accent || '') ? cover.accent : 'initial';
  const accent2 = HEX.test(cover?.accent_2 || '') ? cover.accent_2 : 'initial';
  const emoji = cover?.emoji || trip?.cover_emoji || info?.trip?.cover_emoji || '';
  const cls = ['cover-dot', 'accent-scope', shape === 'tile' ? 'cover-dot--tile' : small ? 'cover-dot--sm' : '', className].filter(Boolean).join(' ');
  return (
    <span class={cls} style={{ '--trip-accent': accent, '--trip-accent-2': accent2 }} aria-hidden="true">
      {emoji && <span class="cover-dot__emoji">{emoji}</span>}
    </span>
  );
}
