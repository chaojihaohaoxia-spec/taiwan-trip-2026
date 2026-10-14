# sheets/trip-new/ —— 弹层「trip-new」：新建行程（SPEC §5.1）

打开：`openTripNewSheet({ keyboard: true, trigger })`（`sheets/index.js`）。行程列表的「新建行程」、外壳行程切换面板的「新建行程」都这么开。底部面板，`detents: ['large']`。

## 表单

| 项 | 控件 | 规则 |
|---|---|---|
| 预览 | 封面（主题色渐变 + emoji）+ 名字 + 日期 · 几天几晚，跟着下面的选择实时变 | |
| 名字 | 大字输入框，自动聚焦（iOS 先叫出键盘） | 必填，≤60 字；提示「用「 · 」隔开：前半段当大标题」 |
| 日期 | 出发 / 回来两个系统日期选择器（没选时统一写「选日期」） | 可以先空着（日期未定）；选了出发、没选回来 → 默认 4 天 3 晚；回来早于出发时跟着挪；下面「4 天 3 晚 · 12 天后出发」；一趟最长 90 天 |
| 时区 | 常用的芯片（越南、台湾、日本、韩国、泰国、香港）+「其他」搜索（中文地名、英文城市名、浏览器的旧名字都能搜：「富国岛」「大阪」「saigon」） | 下面「越南 · UTC+7 · 比香港慢 1 小时」；浏览器的旧名字换成通用写法（Asia/Saigon → Asia/Ho_Chi_Minh） |
| 当地币种 | 按时区推荐的币种 + 港币、人民币、美元 +「其他」（三位代码） | 选时区时自动换成推荐的币种；自己改过就不再跟着变；本币固定港币 |
| 封面 | 6 个主题色色块（`accent-scope` 实时派生）+ 6 个 emoji | 写进 `trips.cover`：`{ accent, accent_2, emoji }` |

提交：`SubmitButton` 受控。先校验（不通过：那一项摇一下、标红、说原因，**不转圈**）→ `data.rpc.createTrip`（要联网；离线时按钮禁用并说明）。
行程 id 按名字和年份自动起（`suggestTripId`，避开全部行程用过的）；撞了别人的 id（看不见）自动换 `-2`、`-3`，最多试 4 次。
→ 对勾 → Toast「已新建「…」」→ 进新行程的概览（从弹层里换页：弹层那几条历史一起清掉，返回回到行程列表）。填了一半关面板先问「放弃未保存的内容？」。

主题色预设是写进 `trips.cover` 的**数据**，不是界面颜色：`model.js` 里存不带 `#` 的六位十六进制，写数据时补上（tokens 测试不让 JS 里出现 `'#xxxxxx'`）。
以后想统一管理，可以挪进 `tokens.css` 做成 `--trip-preset-*`（见交付报告）。

## 文件

| 文件 | 内容 |
|---|---|
| `TripNewSheet.jsx` | 弹层 |
| `model.js` | 纯逻辑：预设、`currencyForZone` / `currencyOptions`、`searchZones` / `canonicalZone` / `zoneSummary`、`validateTripForm`、`tripFormToInput`、`adjustEndDate`、`formLengthLabel`、`startHint`、`nextTripId`、`isIdConflict`、`isTripFormDirty`、`coverFromForm` / `presetStyle` |
| `trip-new.css` | 样式（`tnf-` 前缀） |

测试：`test/unit/page-account.test.js`、`test/e2e/page-account.e2e.mjs`（空名字不转圈、日期联动、时区换币种、搜时区、选色 → 转圈 → 对勾 → 新行程的主题色 → 返回列表里有它）。
