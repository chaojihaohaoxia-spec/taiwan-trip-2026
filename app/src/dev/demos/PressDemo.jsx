// =====================================================================
// dev/demos/PressDemo.jsx：按压反馈的“最简写法”——任何按钮只写 data-press="scale"。
//
// main.jsx 启动时装了全局委托（motion/press.js 的 delegatePress）：带 data-press 属性、又没有自己 attachPress
// 的元素，自动得到和 ui/Pressable 完全一样的按压行为——按下即缩（--press-duration 缓出，缩到 --press-scale）、
// 松手 --spring-bouncy 回弹、手指滑出取消（不算点击）、键盘按住也有按下态。
// 外壳、弹层、占位页的按钮都是这样写的；组件里需要更多控制（禁用回调、按压开始 / 结束的回调）时用 ui/Pressable。
// =====================================================================

export default function PressDemo() {
  return (
    <div class="dev-buttons">
      <button type="button" class="dev-btn dev-btn--primary" data-press="scale">主要按钮</button>
      <button type="button" class="dev-btn" data-press="scale">次要按钮</button>
      <button type="button" class="dev-btn dev-btn--outline" data-press="scale">描边按钮</button>
      <button type="button" class="dev-btn dev-btn--danger" data-press="scale">删除</button>
    </div>
  );
}
