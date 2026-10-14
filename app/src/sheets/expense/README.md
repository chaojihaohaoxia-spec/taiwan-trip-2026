# sheets/expense/ —— 记一笔 / 编辑一笔（弹层 id `expense`，SPEC §5.5）

行程中最高频的写操作，速度和准确第一：**最少点击 ＋ → 记一笔 → 输入金额 → 记下这笔**，打开时金额框已经聚焦、数字键盘弹出，
越南盾打 `350` 按「千」就是 350,000₫，折合港币实时显示，默认今天 / 现在 / 我付 / 两人平摊，分类按打开的条目自动选。

| 文件 | 内容 |
|---|---|
| `ExpenseSheet.jsx` | 弹层本体：`<Sheet sheetId="expense" detents={['content','large']}>`，标题（记一笔 / 编辑这一笔）、`confirmClose`（表单动过才问）、footer（提交按钮 + 汇率说明）；表单 `Body` 按参数 key 重建，读参数（`useSheetArgs`）和行程（`useSheetTrip`），提交逻辑 |
| `AmountField.jsx` | 金额块：大号 Instrument Serif 输入 + 币种名 + 折合 / 每人一行 + 「千 / 万」「清空」+ 币种分段（当地币 / 港币 / 人民币 / 其他 → 下拉） |
| `parts.jsx` | 分类胶囊、谁付分段、分摊（平摊 / 个人 / 按金额）、日期时间、关联条目、小票照片、输入不对时的摇头 |
| `form-model.js` | 纯逻辑（单元测试 `test/unit/page-ledger.test.js`）：金额输入格式化和光标、「千 / 万」、币种分段、从条目 / 地点 / 预订推分类、分摊的换算、预填 / 编辑的初始状态、校验、提交参数、脏检查 |
| `notes.js` | 纯逻辑：footer 那一行说明（按什么汇率记、离线先存手机、过期提醒、只读） |
| `saved.js` | `lastSavedExpense` 信号：刚保存的是哪一笔（账本页据此让新的一笔带入场动画出现、高亮） |
| `expense.css` | 样式（`.xf-*`），只用 tokens.css 的变量 |

## 打开（所有打开方都用 `sheets/index.js` 的帮手）

```js
openExpenseSheet();                                                      // 空白（＋ 面板、账本页）
openExpenseSheet({ date }, { keyboard: true });                          // ＋ 面板在行程进行中：预填今天
openExpenseSheet({ itemId, date, category }, { keyboard: true, trigger: e.currentTarget });   // 条目动作行、「现在 / 接下来」卡
openExpenseSheet({ placeId }, { keyboard: true });                       // 地点动作行（kit/PlaceActions）
openExpenseSheet({ bookingId }, { keyboard: true });                     // 预订详情「付了，记一笔」
openExpenseSheet(expense.id, { trigger });                               // 编辑这一笔（账本页详情）
```

`{ keyboard: true }` 必须在点击回调里同步调用（iOS 先叫出键盘，面板里 `data-autofocus` 的金额框接过焦点，键盘不收）。
网址写法 `?sheet=expense`、`?sheet=expense:<id>`、`?sheet=expense:i.<条目>~d.2027-01-11~c.food`（见 sheets/README.md；太长时按 item > booking > place > date > category 丢，
弹层自己从条目推地点 / 日期）。行程以外的页面打开要带 `?trip=<id>`。

## 预填规则（`form-model.js` 的 `initialState`）

- 条目 → 日期（那天）、时间（条目开始时间）、分类（按 `kind`：food / cafe / night_market → 餐饮，flight / transport → 交通，hotel → 住宿，sight → 门票，beach / activity / spa / sunset → 活动，shopping → 购物）、
  说明（条目标题）、地点（条目的）、关联预订（条目的）、费用预估（「预估 450,000₫ / 人 · 用预估」一键填入）。
- 地点 → 分类（按地点 `kind`）、说明（地点名）；那天有用这个地点的条目就顺手关联上。
- 预订 → 分类（按预订 `kind`）、说明、金额和币种按还没付的那部分（已付全额 / 订金后的余款）。
- 日期参数 → 那天（不是今天的话时间留空）；分类参数 → 那个分类。
- 空白：当地币、今天（行程时区）、现在的时间、我付、平摊、分类默认「餐饮」。

## 表单

- **金额**：边打边加千位分隔，光标放回“同一个数字后面”；越南盾这类没有小数的币种只认数字（越南写法 450.000 的点号当千位分隔），港币 / 人民币最多两位小数；
  `inputmode` 按币种 numeric / decimal；电脑键盘直接打 `350k` / `35万` 也认；越南盾不到 1,000 提醒「多半是忘了按「千」」一键改成 ×1000；位数封顶 12 位。
  下面一行：「≈ HK$106 · 平摊每人 HK$53」（折合取整，和全站「约 HK$…」一致）/「只算 Cathy 的」/「按金额分」；没有汇率时「没有 X 的汇率，先按原币记」。
- **币种分段**：当地币 / 港币 / 人民币 / 其他（其他 → 下拉：美元、新台币、日元、泰铢……）；换币种数字照旧不换算，只按新币种的小数规则重排；「千 / 万」只给大面额币种。
- **分类**：七个胶囊（餐饮 / 交通 / 住宿 / 购物 / 门票 / 活动 / 其他，`kit/kinds.js` 的种类图标）。
- **谁付**：成员分段（创建者和可编辑成员），名字后面标「我」，默认我。
- **怎么分**：平摊（默认；「2 人平摊，每人 175,000₫（约 HK$53）」）/ 个人（「算 Jeremy 的」「算 Cathy 的」胶囊：Jeremy 帮 Cathy 买 → 存成 `amounts` 只有 Cathy 一份）/
  按金额（每人一个输入框，没动过的人自动补上剩下的；`selectors.splitMismatch` 实时对账，对不上红字「各人加起来比总额多 / 少了 100,000₫」，提交时拦下并摇一下、滚到那里）。
- **说明**、**日期和时间**（原生控件，旁边「D2 · 今天 周一」）、**关联行程条目**（那天的时间轴条目，可不选）、**小票照片**（拍 / 选 → `store.upload('receipts')` 进写队列，离线也行，缩略图、移除）。
- 编辑时底部「删除这一笔」（确认框 → 软删除 → 关面板，外壳弹「已删除 · 撤销」）。
- 桌面上输入框里按回车 = 提交（输入法选词的回车不算）。

## 提交

`SubmitButton`（受控）：先校验（没金额 → 金额块摇一下、聚焦；按金额对不上 → 分摊块摇一下）→ 转圈（至少 420ms）→
`store.addExpense` / `updateExpense`（汇率和折合由数据层按当前 `fxRates` 写进 `fx_rate` / `amount_home`）→ `await r.saved`（写进本机队列就算成功，**离线也行**）→
对勾描完 → `closeOverlay('expense', { force: true })` 收回面板 → 写 `lastSavedExpense`（账本页让新的一笔带入场动画出现并高亮；不在账本页时弹「已记一笔：… · 查看」）。
失败：按钮摇头变「重试」、下面红字原因（`DataError` 的中文）。存储暂时不可用（`saved.durable === false`）时提示一句。

footer 说明（`notes.js` 的 `footerNote`）：「按 1 港币 ≈ 3,294 越南盾 折算 · 汇率 · 3 小时前更新」；**离线**「现在离线：先存在手机上，联网后自动同步 · 按最近一次汇率（…，5 小时前更新）记」；
过期 / 内置参考值警示色；只读成员「你是只读成员，不能记账」（提交按钮禁用，全部控件禁用）。

## 状态

读取中（深层链接、刷新）：骨架；找不到要编辑的那一笔：「找不到这一笔」+ 关闭；不在行程里打开：「先打开一趟行程」；只读成员；离线；深色；
375 / 390（面板离屏幕两边 8px）/ 1280（居中浮动卡片）；减弱动态效果（面板只淡入淡出、换币种不弹）。

## 需要整合的改动

- `overlay/Sheet.jsx` 的 `'content'` 档只在视口变化时重量内容高度；这里从骨架换成表单、分摊方式换了行数时用 `window.dispatchEvent(new Event('resize'))` 触发重量，建议 Sheet 自己用 `ResizeObserver` 盯内容。
