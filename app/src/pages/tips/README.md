# pages/tips/ —— 贴士与常用语（路由 `tips`，`#/t/:tripId/tips`，SPEC §5.10）

大标题「贴士与常用语」、返回、右上全局搜索、底栏由外壳画（`section` 页）；这一页只放内容。
同一个 agent 做的联系人页（`pages/contacts/`）和这一页共用 `common.jsx` / `common.css`（搜索框、筛选芯片、「相关」文字链接、小标、闪一下、外链）。

## 文件

| 文件 | 内容 |
|---|---|
| `TipsPage.jsx` | 页面：加载中骨架（`Reveal` 交叉淡入）/ 出错（`ErrorState` + 重试）/ 找不到行程 / 空行程（`PageEmptyState preset="tips"`）；有数据时：搜索框 + 类型芯片 + 概况 → 置顶提醒 → 五组 |
| `parts.jsx` | 卡片：`TipCard`（防坑 / 小贴士 / 实用信息，短的整段显示、长的 `ExpandableCard` 原地展开）、`PinnedCard`（置顶）、`TemplateCard`（消息模板）、`PhraseCard`（常用语），以及原文块、复制、给对方看、直接发 |
| `common.jsx` / `common.css` | 两页共用：`pageState`、`useSkeletonHold`、`useUrlText`（搜索框的字先本地变、400ms 后写进 `?q=`）、`PageSearch`、`FilterChips`（`layout` wrap / scroll）、`RelatedLinks`、`Tags`、`openLink`、`onMarkdownLink`、`useFocusOnce` |
| `speech.js` | 常用语「读出来」：系统自带的语音（`speechSynthesis`，不联网）；只有这台设备有这种语言的声音才给按钮 |
| `model.js` | 纯逻辑（`test/unit/page-tips.test.js`）：类型、预览、要不要展开、搜索和高亮、置顶、常用语场景、「相关」、今天、模板发给谁、语言 |
| `tips.css` | 这一页的样子（颜色、圆角、阴影、字体、动效只用 tokens.css 的变量） |

## 页面结构（从上到下）

1. **搜索框**（`?q=`）：标题、当地语原文、正文、标签、关联的地点 / 预订名、类型名都能搜；中文按子串，越南语不带声调也行（`kit/search/fold.js`，`khong da` → Không đá），每个词都要命中；
   命中的字高亮（`<mark class="k-hl">`）；标题和原文都没命中时，卡片上多一行正文命中处的一小段。Esc 清空，回车收键盘。搜不到：空状态 +「清除搜索」。
2. **类型芯片**（`?kind=`）：全部 / 防坑 / 小贴士 / 实用信息 / 消息模板 / 常用语，带数量（跟着搜索走，0 条的变灰）；只出数据里有的类型；
   折行显示（六个选项一眼都看得见，「常用语」不会藏在右边要滑）。
3. **概况**：「40 条 · 置顶 2 条」/「常用语 6 条 · 共 40 条」/「找到 3 条」。
4. **置顶提醒**（看全部时）：最上面一组「置顶 2」（纸本：和别的组一样排在纸上，行间细线；不要暖色底和图钉圆），一行一条；长的点开原地展开。只看某一类时，置顶的回到那一组排最前、带「置顶」小标。
5. **五组**（`SectionHeader`，顺序 防坑 → 小贴士 → 实用信息 → 消息模板 → 常用语）：
   - **防坑 / 小贴士 / 实用信息**：纸本不放图标块（分组标题已经说了是哪一类），每条是排在纸上的一段、上面一根细线。正文短（≤120 字、单段）整段直接显示；
     长的或有列表的用 `ExpandableCard`（页面一个 `useAccordion`，一次只开一张，标题行不跑）：收起时两行预览，展开时预览收起、Markdown 全文展开（`lib/markdown.js`：段落、列表、加粗、链接；
     链接走 `lib/native.js` 的 `openExternal`）。带原文的贴士展开后也有原文块和复制 / 给对方看。紧急类（标题或标签有紧急、急救、报警、领事、医院）多一个「联系人 · 紧急电话」→ 联系人页 `?cat=emergency`。
   - **消息模板**：用法说明 → 原文块（标「越南语原文」「英文原文」；超过 200 字或 6 行先收起，「显示全文」用 `useHeightFlip` 平滑展开）→ 复制原文 / 给对方看 →
     能直接发给谁：同一个预订（优先）或同一个地点的联系人——有 WhatsApp 用 `https://wa.me/<号码>?text=<原文>`（预填原文），有 Zalo 先复制原文再打开 `https://zalo.me/<号码>`（Zalo 链接不能预填），有邮箱用 `mailto:`（预填标题和原文）；最多两个。
   - **常用语**：卡片网格（手机两列、≥600px 三列，原文长的占满一行），场景芯片（`?scene=`，一行横滑；筛选时卡片用 `FlipGroup` 滑到新位置）。
     场景：`tags` 里写了场景名或同义词（「交通」→ 打车）就用它；写了别的标签自成一组；没写按标题、说明、原文的字推断（礼貌、打车、吃饭、买东西、问路、按摩、紧急、其他）。
     每张：场景小字 → 中文 → **最大号的当地语原文**（系统字体粗体 22px，越南语声调最清楚；`lang` 属性对）→ 说明 → 复制（图标）+「给对方看」（细线框 + 海色字，窄卡片放不下图标就只留字）。
     这台设备有这种语言的声音时，点原文读出来（慢一点 0.85 倍速；再点一下停；右下角小喇叭，读的时候变实心）。
6. 每张卡的 **「相关」文字链接**：那一天（D2 · 1月11日 → 去那天）、地点（开地点详情 `place` 弹层）、预订（开预订详情 `booking` 弹层）、分段（只显示）。行程进行中，关联今天（那天、或者今天安排里的地点）的带「今天」小标。

## 给对方看

「给对方看」打开 `sheets/` 的 `driver` 弹层，参数是贴士 id（`openDriverCard(tip.id, { trigger })`）：全屏大字卡从这个按钮长出来，最大号显示 `local_text`、下面小字中文标题。复制走 `lib/clipboard.js`（按钮就地变「已复制」+ 提示「已复制原文」+ 轻震）。

## 网址

| 参数 | 意思 |
|---|---|
| `?q=` | 本页搜索的字 |
| `?kind=` | 只看一类（warning / tip / info / template / phrase） |
| `?scene=` | 常用语的场景（polite / taxi / food / shop / ask / massage / urgent / other / `tag:<标签>`） |
| `?tip=<id>` | 全局搜索的结果：那一条能展开就展开、滚到屏幕中间、闪三下；被筛选藏起来时先清掉筛选 |

筛选都用 `setQuery`（替换，不压历史）；返回、刷新、分享链接都能还原。

## 数据

`useTrip(tripId)`：`view.tips`（置顶在前，再按 `sort`）、`view.contacts`（模板发给谁）、`view.days` / `tables.places` / `tables.bookings` / `tables.segments`（「相关」）、
`view.itemsByDay` + `view.today` + `view.phase`（今天）、`store.dayNumber(date)`。表结构见 `docs/数据结构.md` B4.10。这一页只读不写（没有编辑贴士的入口）。

## 状态

加载中（骨架和真实版式一样）、出错（中文原因 + 重试；断网换插图）、找不到行程、空行程、搜不到 / 这一类没有、离线（有缓存照常看，复制、给对方看、读出来都不要网）、
只读成员（这一页没有写操作，全部照常用）、深色、375 / 390 / 1280 宽、超长标题和越南语原文（折行、`overflow-wrap: anywhere`、`hyphens: auto`）。

## 测试

- 单元：`test/unit/page-tips.test.js`（贴士和联系人的纯逻辑 + 演示数据跑一遍）。
- e2e：`test/e2e/page-tips.e2e.mjs`（展开半路图、场景 FLIP 半路图、给对方看半路图、搜索、复制进剪贴板、WhatsApp 预填、`?tip=`、各宽度和深色、空、出错、骨架）。

## 紧急电话（10-19）

置顶组最上面：「紧急电话」那条贴士正文第一行的「报警 113，急救 115，火警 114」拆成三个大号数字并排（Instrument Serif），下面一行小字，整格点了直接拨（`tel:`）。
拆不出两个以上就不显示，正文照常（`emergency.js`、`EmergencyNumbers.jsx`；单元测试 `test/unit/page-visual.test.js`）。

