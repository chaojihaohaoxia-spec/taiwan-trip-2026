// =====================================================================
// shell/glyphs.jsx：外壳首屏要用的几个线条图标（底栏的行程 / 地图 / 账本、返回、设置）。
//
// 笔法和样稿 04-body.html 的 <symbol>、kit/glyphs.js 完全一样（24×24、只描边、线宽 1.8、圆头圆角、currentColor），
// 路径也是样稿原样。为什么不直接用 kit/Glyph.jsx：外壳是首屏代码，kit/glyphs.js 有六十多个图形，
// 整个拖进首屏包不划算；首屏只要这五个。按需加载的面板（＋、更多、行程切换、搜索）用 kit/Glyph.jsx。
// 外壳不能引 ui/icons.js（单元测试检查：会把全站的图标拖进首屏包）。
// =====================================================================

const SHAPES = {
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  ledger: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </>
  ),
  back: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
};

/**
 * @param {{ name: 'route'|'map'|'ledger'|'back'|'sliders', size?: number, stroke?: number, class?: string }} props
 */
export function ShellGlyph({ name, size = 23, stroke = 1.8, class: className }) {
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  );
}

/** 给 ui/IconButton 的 icon 属性用：<IconButton icon={BackGlyph} …/> */
export const BackGlyph = ({ size }) => <ShellGlyph name="back" size={size} stroke={2.2} />;
export const SettingsGlyph = ({ size }) => <ShellGlyph name="sliders" size={size} />;
