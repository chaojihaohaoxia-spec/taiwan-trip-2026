# pages/journal —— 日记相册（SPEC §5.8）

路由 `journal`（`#/t/:tripId/journal`），从「更多」菜单进来的二级页面：大标题「日记相册」、返回、搜索由外壳画，页面只放内容、只滚文档。
两个人在富国岛街头单手用：最常用的两件事——**拍照打卡**（一下就开相机）和**写今天的日记**——放在页面最上面；今天我没写的那一行也有这两个文字链接（别的日子只给「写一篇 ›」）。

| 文件 | 内容 |
|---|---|
| `JournalPage.jsx` | 页面：加载 / 出错 / 找不到行程 / 没有分天 四种状态；顶部分段控件（按天 / 相册）+ 一句统计；按天视图和相册视图 |
| `parts.jsx` | 小组件：`EntryCard`（一篇日记）、`EntryEmpty`（还没写）、`ExpandableText`（正文先显示 6 行，「展开全文」原地长高）、`Thumb`（签名链接缩略图）、`AlbumCard`（相册的一格） |
| `model.js` | 纯逻辑（`test/unit/page-journal.test.js`）：视图 / 布局的查询参数（`parseView(view, tab)`：`?view=album`，概览页链接过来的 `?tab=photos` 也认）、`tripState`、`daySections`、`journalStats`、`albumGroups`、`authorOptions`、`scrollTarget`、`actionDay`、`entryTime`（同一天只写钟点，隔天补写的带日子） |
| `journal.css` | 样式（`.jn`、`.jn-day`、`.jn-entry`、`.jn-text`、`.jn-strip`、`.jn-thumb`、`.jn-pc`），只用 tokens.css 的变量 |

## 页面结构

```
.jn
  .jn__top        SegmentedControl「按天 · 相册」（seg--glass，直接放在光场上）+ 「3 篇日记 · 4 张照片 · 还有 2 天没写」
  按天 .jn__days
    .jn__actions  PhotoInput「拍照打卡」（叠着 <input type=file capture>）+ Button「写日记」+ 「记到 D2 · 今天」
    .jn-day × N   D1 徽章（今天是强调色实心）+ 标题（天的标题，没有就日期）+ 小字「昨天 · 3 张照片」
                  （今天写日期 + 「今天」标签；标题已经是日期时小字只写相对的日子 / 张数，不重复日期）
      .jn-day__entries   手机上下、≥640px 并排：我的那格永远在前
        EntryCard        心情 emoji（44px 方块）+ PersonChip + 「写于 21:00」（隔天补写的「写于 昨天 09:10」）+ 「编辑 / 继续写」；正文（ExpandableText）；照片条 .jn-strip（92px 方块，点开看大图）；「有一份没保存的草稿」
        EntryEmpty       一行灰字 + 文字链接。我的：别的日子「还没写 · 写一篇 ›」，今天「今天还没写 · 拍照打卡 · 写日记 ›」，有草稿「写了一半，还没保存 · 继续写 ›」；对方的：灰字「Cathy 还没写」（不画框）
  相册 .jn__album
    .jn__album-bar  Chip「全部 4 · Jeremy 1 · Cathy 3」（?who=）+ ViewToggle（?layout=）
    .jn__album-day × 有照片的天   SectionHeader「D1 · 昨天 3」+ ViewSwitch（AlbumCard：底板 / 图片 / 文字各自 FLIP）
```

## 用到的数据

- `useTrip(tripId)`：`store.view.days`、`journalByDay`（day id → 日记，成员顺序）、`members`、`phase.phase`（注意 `phase` 是对象）、`today.day.date`、`trip.timezone`；`store.memberName(userId)`。
- `authState.value.user.id`：我是谁（我的那格在前、能编辑 / 删除的只有自己的）。
- 照片：`sheets/photo/model.js` 的 `journalPhotoList`（整趟相册的顺序：按天 → 拍摄时间）、`entryPhotos`、`viewerArgsFor`；缩略图用 `useSignedUrl(path)`（还没传完的是本机 `blob:` 预览）。
- 草稿：`sheets/journal/draft.js` 的 `draftDays(tripId, me)`（本机有草稿的天；页面按 `draftVersion` 记忆，草稿变了才重新读）。
- 查询参数：`?view=album`（概览页的「相册」「N 张照片」链接写的 `?tab=photos` 也认，切回「按天」时一起清掉）、`?layout=list`、`?who=<userId>`（都用 `setQuery`，不压历史）、`?day=<日期>`（打开时滚到那一天；看大图的「打开那天的日记」也用它）。

## 交互

- **拍照打卡一步到位**：`PhotoInput camera` 是真按钮上叠一层透明的 `<input type="file" accept="image/*" capture="environment">`，手指点到的就是它（iOS 只认这种真实点击才弹相机）。
  拍完 `checkInWith(files, { date })`（`sheets/journal/capture.js`）：照片放进中转站，打开 `journal` 面板（mode=photo），面板挂上就开始压缩、上传。
- **写日记**：`openJournalSheet({ date, mode: 'text' }, { keyboard: true, trigger })`——在点击回调里同步调用，iOS 先叫出键盘。
- **看大图**：缩略图外层（`Thumb`）写 `data-pv-thumb=<path>`，`openPhotoViewer(viewerArgsFor(photo))`；photo 弹层从那个缩略图放大出来、关闭时缩回“现在这一张”的缩略图（`sheets/photo`）。
- **展开全文**：`-webkit-line-clamp` 先显示 6 行，量出被截了才出现「展开全文」（正文、宽度变了、字体到了都重新量：换字体行数会变，不然会多出一个没用的按钮）；
  点了 `useHeightFlip` 原地长高（`motion/flip.js` 的 `playHeight`：元素先到新高度、`clip-path` 从旧高度卷开），下面的内容跟着滑。
- **列表 ↔ 网格**：`ui/ViewSwitch` + `AlbumCard` 的三个部件 `data-flip="box | crop | text"`（图片等比裁切、文字不压扁）。
- **打开先滚到今天**：只在页面刚打开、还在最上面时滚一次（`scrollTarget`），不抢用户的滚动；`.jn-day` 的 `scroll-margin-top` 给顶栏胶囊留位置；
  靠后的天下面内容不够时能滚多远滚多远（滚到底）。
- 触感：切视图 / 筛选 / 点缩略图 `haptic('selection')`。

## 状态（SPEC §7）

加载中骨架（根节点 `aria-busy`，骨架照真内容的形状：分段控件、两个入口按钮、D 徽章 + 标题、两张卡）→ 数据到了 `ui/Reveal` 交叉淡入（骨架和内容叠在同一格，不跳版）；没有分天 → `PageEmptyState preset="journal"` + 「去行程概览」；
相册没有照片 → `PageEmptyState preset="photos"` + 拍照打卡；出错 → `ErrorState`（中文原因 + 重试）；找不到 / 被移出行程 → `notfound`。
离线：写日记、传照片都进写队列（同步状态条由外壳显示）；这台设备从没打开过这趟行程、一开始就没网时是「现在没有网络」+ 重试（数据层连缓存都没有，不是页面能补的）。
**只读成员也能写自己的日记**（个人内容表，数据层允许），所以页面没有只读的禁用态。
深色、375 / 390 / 1280、超长正文（折行 + 展开）、0 / 1 / 很多条都在 `test/e2e/page-journal.e2e.mjs` 里截图核对。

## 测试

- 单元：`test/unit/page-journal.test.js`（本页 model、表单逻辑、照片列表、看大图的几何和手势判定）。
- e2e：`test/e2e/page-journal.e2e.mjs`（按天 / 相册 / 看大图 / 写日记 / 拍照打卡 / 离线，半路截图在 `__shots__/page-journal/`：
  `album-flip-mid`、`viewer-open-mid`、`viewer-close-mid`、`viewer-drag-mid`、`expand-text-mid`；加载中 → 交叉淡入、`?tab=photos`、草稿不等防抖就关掉也在）。
  看大图的代码是按需加载的：截“打开的半路”之前先开一次再关掉（`warmViewer`），不然半路截到的是在下载模块。
- 截图：`node scripts/shoot.mjs --base http://localhost:<端口>/ --now … --routes 'days=#/t/demo-island/journal,album=…?view=album,viewer=…?sheet=photo:e.<日记 id>~n.0'`。

## 10-14 评审修改

- 每天的「D1」徽章改用 `kit/DayBadge`（第几天的颜色和概览、地图、账本同一套）；「今天」小标签是实心强调色胶囊（对比度够）。
