# sheets/photo —— 弹层「photo」：全屏看大图

`openPhotoViewer({ entryId, index })`（日记里的第几张；左右滑能滑遍整趟行程的照片）/ `openPhotoViewer({ reviewId, index })`（只在这条评级的几张里）/ `openPhotoViewer({ index })`（整趟相册第几张）。
自定义全屏弹层（kind `menu`），基础设施同 `sheets/driver/DriverSheet.jsx`：`useOverlayRoute` / `useLayer` / `Portal`，网址联动、背景 inert、焦点、Esc、返回手势。

| 文件 | 内容 |
|---|---|
| `PhotoSheet.jsx` | 弹层：列表和起点、幻灯片（当前 ±1 预渲染）、手势、键盘、打开 / 关闭动画、顶部 / 底部的字 |
| `model.js` | 纯逻辑：`journalPhotoList`（按天 → 拍摄时间）、`reviewPhotoList`、`resolveStartIndex`、`reindex`、`groupByDay`、`filterByAuthor`、`photoAlt`、`aspectOf`、`excerpt`、`photoFileName`（分享时的文件名「Cathy-2027-01-10-2.jpg」） |
| `gestures.js` | 纯逻辑：`containRect`、`panBounds` / `clampPan`、`zoomAround`、`rubberZoom`、`doubleTapZoom`、`settleZoom`、`classifyDrag`、`swipeTarget`、`shouldDismiss`、`dismissFollow`、`backdropOpacity`、`flyFromRect` / `visualRect` |
| `photo.css` | 样式（`.pv`、`.pv__backdrop`、`.pv__stage / __track / __slide / __frame / __zoom`、`.pv__top / __bottom`） |

## 结构和几何

```
.pv-layer (ov-layer)
  .pv__backdrop           白底（深色模式近黑）；点一下隐藏文字后变成纯深色（两种外观下都是深的）
  .pv (dialog)
    .pv__stage            Pointer Events 都在这里（touch-action: none）
      .pv__track          左右滑时整条平移
        .pv__slide × 3    left = (i − index) × (视口宽 + 20px 缝)
          .pv__frame      照片框 F = containRect(宽高比, 视口, 安全区)：打开 / 关闭的 FLIP、往下拉的跟手都在它上面（transform-origin 0 0）
            .pv__zoom     捏合 / 双击 / 平移：translate(x, y) scale(s)
              .pv__ph     模糊占位（有缩略图就放大模糊缩略图，没有就是主题色柔光）
              img         签名链接（useSignedUrl），加载完淡入，真实宽高比交回去重算 F
    .pv__top              × ｜ 「Cathy · 第 1 天」+ 「1月10日 13:10」（拍摄时间不在这一天就按拍摄时间写日子）｜ 2 / 4 ｜ 分享
    .pv__bottom           照片说明；关联日记（心情 + 摘录）；「打开那天的日记」（navigate 到 journal?day=）、「编辑」（自己的：openJournalSheet replace）
```

## 手势

| 手势 | 判定（`gestures.js`） | 做什么 |
|---|---|---|
| 左右拖 | 没放大、横向为主 → `swipe` | 轨道跟手（两端橡皮筋），松手 `swipeTarget`（拉过 22% 或甩 > 380px/s）→ snappy 弹簧滑到目标，播完换 index、轨道回零（同一帧，不闪） |
| 往下拉 | 没放大、竖向往下 → `dismiss` | `dismissFollow`：照片跟着手指缩小到 0.72、按下的点留在手指下面；背景 `backdropOpacity` 渐隐、文字淡掉。松手 `shouldDismiss`（> 110px 或甩 > 650px/s）→ 接着手指速度滑出屏幕关掉；不够 → bouncy 弹回 |
| 双指捏合 | 两根手指 → `pinch` | 以两指中点为中心 `zoomAround`，过界 `rubberZoom` 有阻尼；松一根手指 `settleZoom` 落到 1–4 倍、另一根接着平移 |
| 双击 | 两次点按 < 280ms、< 32px | `doubleTapZoom`：以点按处放大 2.5 倍 / 还原 |
| 放大后单指 | `pan`；贴着边再往外拉 → `swipe` | 平移（过界阻尼，松手夹回范围 + 速度）；贴边接着换张 |
| 单击 | 没移动、不是双击 | 显示 / 隐藏顶部和底部的字（`data-chrome`），背景变纯深色 |
| 键盘 | ← → Home End，空格切换文字，Esc 关 | |
| 触控板横向滚 | `wheel` deltaX | 换张 |

## 打开 / 关闭动画

- 打开：找页面上这张照片的缩略图 `[data-pv-thumb="<path>"]`（看得见的那个）→ `invertFor('crop', 缩略图矩形, F)` → `animateSpring(frame, flipRenderer('crop'))`：等比放大 + `clip-path` 从缩略图的裁切长到整张（不变形），背景同时淡入，文字 140ms 后出现。找不到缩略图（直接打开网址）→ 整层淡入 + 0.96 放大。
- 关闭：缩回“现在这一张”的缩略图（看完别的再关也缩回对应那一格；缩略图滚出屏幕 → 淡出）；往下拉关掉 → 接着手指速度滑出；减弱动态效果 → 只淡入淡出。
- 半路截图：`test/e2e/page-journal.e2e.mjs`（`__shots__/page-journal/viewer-open-mid.png`、`viewer-close-mid.png`、`viewer-drag-mid.png`）。

## 分享

右上角「分享这张照片」：先把正在显示的图取成文件，`navigator.canShare({ files })` 支持就 `navigator.share({ files })`——iPhone 的分享面板里能「存储图像」、直接发给对方；
不支持（桌面浏览器）、取不到文件、分享文件失败时退回 `lib/native.js` 的 `share({ url })`（签名链接；复制到剪贴板兜底）。iOS 外壳里（`isNativeShell()`）直接走 `share()` 让外壳接管。
整合建议：把「分享文件」做进 `lib/native.js` 的 `share({ files })`，外壳接管时也能拿到文件（见交付报告）。

## 数据

`useSheetTrip()` → `store.view.days / journalByDay`、`tables.reviews / places / journal_entries`；`store.memberName`；`authState` 判断是不是自己的（「编辑」）。
起点（第几张）**在渲染里定**（`startOf(list)`，不等 effect）：第一帧画的就是那张照片，不会先出一帧空弹层再换成照片（e2e 等 `data-index ≥ 0` 和标题有字）。
照片被删 / 列表变了：`reindex` 还看原来那张。找不到那篇日记：退回整趟相册第一张；整趟没有照片：「找不到这张照片」+ 关闭。
