// =====================================================================
// shell/Field.jsx：页面背景——纸（整页只有这一个；styles/field.css 的 .paper）。
//
// 「杂志纸本」（SPEC §11）：米白的纸（深色是深墨色的纸），纯色，只留一点点纸纹；不再有每趟行程一套主题色的光斑。
// 换行程时纸不变，主题色只用在强调色上（外壳部件的主题色补间在 trip-state.js）。
// fixed 铺满视口、在内容下面、不接收点击、contain: strict：页面滚动时纸不动也不重绘。
// =====================================================================

export function Field() {
  return <div class="paper shell-field" aria-hidden="true" data-testid="shell-field" />;
}
