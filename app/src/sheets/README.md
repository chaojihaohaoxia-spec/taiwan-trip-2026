# sheets/ —— 全站共用的弹层（按需加载）

职责：不属于某一页、好几个地方都要打开的弹层（SPEC §9.2）——记一笔、加条目、地点详情、写评级、预订详情、待办、写日记、看大图、新建行程、邀请成员，
以及已经做完的**「给司机看 / 给对方看」全屏大字卡**。外壳负责的 `switcher` / `fab` / `menu` / `search` 不在这里（`shell/overlays.js`）。

| 文件 | 内容 |
|---|---|
| `index.js` | **登记表** `SHEETS`（id → 种类、中文名、由谁完成、模块）+ `defineOverlays` 登记成按需加载 + **打开它们的帮手**（`openExpenseSheet` …）。由 `pages/index.js` 在启动时引入（只有几行，弹层本身的代码不进首屏包） |
| `args.js` | 网址参数的写法：`encodeSheetArg` / `parseSheetArg`（纯函数，单元测试 `test/unit/kit.test.js`） |
| `hooks.js` | 弹层里用：`useSheetArgs()`（参数解析好）、`useSheetTrip()` → `{ tripId, store, pending }`（属于哪个行程；**确定登录了才打开行程**，恢复登录期间 `store` 是 null、`pending` 为真）、`findRow(store, id)`（在各张表里找 id） |
| `driver/DriverSheet.jsx` / `driver.css` | 给司机看（做完了，见下文） |
| `expense/` `item/` `place/` `review/` `booking/` `todo/` `journal/` `photo/` `trip-new/` `invite/` | 每个 id 一个目录，现在是占位，页面阶段由对应页面的 agent 整个替换 |

| id | 中文名 | 种类 | 由谁完成 |
|---|---|---|---|
| `driver` | 给司机看 / 给对方看 | 全屏（kind `menu`） | 组件（已完成） |
| `expense` | 记一笔 / 编辑一笔 | 底部面板 | 账本页 |
| `item` | 新增 / 编辑时间轴条目 | 底部面板 | 每天页 |
| `place` | 地点详情 | 底部面板 | 地点页 |
| `review` | 写评级 | 底部面板 | 地点页 |
| `booking` | 预订详情 | 底部面板 | 预订页 |
| `todo` | 加待办 / 编辑待办 | 底部面板 | 清单页 |
| `journal` | 写日记 / 拍照打卡 | 底部面板 | 日记页 |
| `photo` | 看大图 | 全屏（kind `menu`；占位暂时用底部面板） | 日记页 |
| `trip-new` | 新建行程 | 底部面板 | 行程列表页 |
| `invite` | 邀请成员 | 底部面板 | 设置页 |

## 怎么打开（所有打开方都用这些帮手，不要自己拼参数）

```js
import { openDriverCard, openExpenseSheet, openItemSheet, openPlaceSheet, openReviewSheet, openBookingSheet,
  openTodoSheet, openJournalSheet, openPhotoViewer, openTripNewSheet, openInviteSheet } from '../sheets/index.js';

openDriverCard(place.id, { trigger: e.currentTarget });                   // 给司机看（也接受贴士 / 预订 / 条目 / 联系人的 id）
openExpenseSheet();                                                        // 记一笔（空白）
openExpenseSheet({ itemId, placeId, bookingId, date, category: '餐饮' }, { keyboard: true });   // 预填
openExpenseSheet(expense.id);                                              // 编辑这一笔
openItemSheet({ date: day.date, after: item.id, parent, variant: 'rain', kind });   // 加条目；openItemSheet(item.id) 编辑
openPlaceSheet(place.id);                     openReviewSheet(place.id) / openReviewSheet({ placeId, itemId });
openBookingSheet(booking.id);                 openTodoSheet({ list: 'packing', dayId, bookingId, itemId }) / openTodoSheet(todo.id);
openJournalSheet({ date, mode: 'photo' | 'text', itemId, placeId });
openPhotoViewer({ entryId, index }) / openPhotoViewer({ reviewId, index });
openTripNewSheet();                           openInviteSheet({ role: 'viewer' });
```

第二个参数是 `openOverlay` 的选项：`{ keyboard: true }`（表单类：iOS 先叫出键盘，**必须在点击回调里同步调用**）、`{ replace: true }`（换掉当前这一层，不压历史）、
`{ trigger: 按钮元素 }`（从这个按钮长出来 / 关闭后焦点回到它；按钮上写 `data-overlay-trigger="<id>" data-overlay-arg="<参数>"` 也行，刷新后照样找得到）。
它们都返回 Promise（网址更新后 resolve）。

## 参数的写法（网址 `?sheet=<id>:<参数>`）

网址里的参数只能用字母、数字和 `_ . ~ -`，最长 80 位（`router/url.js`）。约定三种：

| 写法 | 意思 | 例子 |
|---|---|---|
| 没有参数 | 新建（空白） | `?sheet=expense` |
| 一个 id | 打开 / 编辑这一条 | `?sheet=expense:8e0843e1-…` |
| `键.值~键.值` | 新建，并预填这些字段（mode `'new'`） | `?sheet=expense:i.5c0710f0-…~d.2027-01-11~c.food`、`?sheet=photo:e.<日记 id>~n.3`（`e` 是 entry 键：fields `{ entry, index }`） |
| `id.<id>~键.值` | 打开 `id` 那一条 + 附加参数（mode `'edit'`，fields 里是附加参数） | `?sheet=booking:id.<预订 id>~t.attachments` |

键是一个字母（两个 uuid 加起来就 72 位），代码里一律用长名字，`args.js` 负责换算：

| 长名字 | 键 | 长名字 | 键 | 长名字 | 键 |
|---|---|---|---|---|---|
| `id` | `id` | `item` | `i` | `place` | `p` |
| `booking` | `b` | `date` | `d` | `day` | `y` |
| `category` | `c` | `list` | `l` | `kind` | `k` |
| `after` | `a` | `parent` | `r` | `variant` | `v` |
| `mode` | `m` | `entry` | `e` | `review` | `w` |
| `index` | `n` | `tab` | `t` | `role` | `o` |
| `currency` | `u` | | | | |

- 值里不能有 `~` 和中文：记账分类写成代码（`餐饮 → food、交通 → transport、住宿 → stay、购物 → shop、门票 → ticket、活动 → activity、其他 → other`，
  `categoryToCode` / `categoryFromCode`）。
- 超过 80 位时按帮手里写的优先级从后往前丢：例如记一笔 `item > booking > place > date > category`——**给了条目就可能不再带地点和日期，弹层自己从条目推**
  （条目有 `place_id`、`day_id`）。**一个参数最多放得下两个 uuid**（每个 38 位）：两个 uuid 之后的字段一定会被丢。丢了哪些在开发构建里会 `console.warn`
  （`encodeSheetArg` 的 `onDrop`）。各帮手可能丢的字段：

  | 帮手 | 优先级（从高到低） | 可能被丢 |
  |---|---|---|
  | `openExpenseSheet` | item、booking、place、date、category | 给了两个 id（条目 + 预订，或预订 + 地点）时，后面的地点 / 日期 / 分类 |
  | `openItemSheet` | date、parent、after、variant、kind | after（parent 和 after 都给时） |
  | `openReviewSheet` | place、item | 不会 |
  | `openTodoSheet` | list、item、booking、day | 给了两个 id 时的第三个 id |
  | `openJournalSheet` | mode、date、item、place | 给了条目和地点时的地点（从条目推） |
  | `openPhotoViewer` | entry、review、index | 不会（只给一个 id） |
- 新加字段：在 `ARG_KEYS` 登记一个没用过的字母（单元测试检查不重复）。

## 弹层里怎么读

```jsx
// sheets/expense/ExpenseSheet.jsx（页面阶段的样子）
import { Sheet } from '../../overlay/index.js';
import { useSheetArgs, useSheetTrip, findRow } from '../hooks.js';
import { categoryFromCode } from '../args.js';

export default function ExpenseSheet() {
  return <Sheet sheetId="expense" title="记一笔" detents={['content', 'large']} confirmClose={dirty}><Form /></Sheet>;
}
function Form() {
  const { mode, id, fields } = useSheetArgs();     // mode: 'new' | 'edit'；fields.item / fields.date / fields.category（代码）…
  const { tripId, store, pending } = useSheetTrip();   // 网址路径里的 :tripId，没有就看 ?trip=<id>；pending = 还在恢复登录 / 行程还在读
  const item = fields.item ? store?.tables.items.value.get(fields.item) : null;
  …
}
```

- 模块 default 导出一个组件，**自己渲染 `<Sheet sheetId="…">`**（或别的 overlay 组件），只靠网址参数渲染：刷新、返回、分享链接都能恢复。
  OverlayHost 在网址里第一次出现这个 id 时才下载模块，之后一直挂着（关的时候还要播退场动画）。
- 弹层属于哪个行程：行程内页面（`#/t/<id>/…`）直接用路径里的；行程以外的页面（设置、开发页）要打开属于某个行程的弹层时，网址带上 `?trip=<id>`
  （设置页的「邀请成员」、`#/dev/kit` 就是这么做的）。
- 重活（请求、地图、长列表）`await useOverlay().whenOpened()` 之后再做（overlay/README.md）。
- 占位的种类（`SHEETS` 里的 `kind`）和最后做成的组件要一致（`photo` 是全屏，占位暂时用底部面板）。

## 10-14 评审修改：编辑只提交改了的字段

条目（`ItemSheet`）、待办（`TodoSheet`，`form.js` 的 `formPatch`）、记一笔（`ExpenseSheet`，`baseRef`）、联系人（`pages/contacts/ContactSheet`）的编辑，
都和**打开面板那一刻**的样子比，只提交这次在面板里改了的字段——面板开着时另一台手机改了别的字段（勾上了、补了说明、改了分类），这边保存不会把它改回去
（`BookingSheet` 本来就是这样做的）。另外：
- **记一笔**：编辑台湾那趟的旧记账（`paid_by` 是名字、`split` 是 `{}`）时，付款人、分摊按数据层认出来的人填（`ctx.legacyShares`）；只有亲手改过谁付 / 怎么分、或改了金额 / 币种才写这两个字段。
  行程那几天里人还在香港（出发当天落地前、回程那晚落地后：`store.presenceZone` ≠ 行程时区）时默认币种是本币（港币），时间框下面说一句「按越南时间记 · 香港现在 13:00」。每人平摊的折合港币和金额框下面同一个汇率。
- **加条目**：保存后写 `sheets/item/saved.js` 的 `lastSavedItem`（每天页据此让新的一条在面板收回后淡入、高亮）；主方案换了天，挂在它下面的备选 / 雨天方案跟着搬；
  提示「已加到今天 / D3 的时间轴」按那一天是不是今天写。
- **写评级**：删除评级以后，等删除真的发出去（撤销窗口过了）再删私有桶里的照片（和日记一样）。
- **大图浏览**：分享走 `lib/native.js` 的 `share({ files })`（分享照片本身）；不能分享文件时不发链接（签名链接谁拿到都能看、刚拍的 `blob:` 对方打不开），提示长按存到相册。

## 给司机看（`driver`，SPEC §6）

`openDriverCard(id)`：`id` 是地点 id（显示 `lib/ride-links.js` 的 `driverCardFields`：最大号当地语名字，下面地址，再下面小字中文名；有电话才有「打电话」；
地点有下车点 `extra.ride_via` 时显示下车点那个地点，再加一行下车提示 `ride_note`——开车到不了时接上 `access_note`，SPEC §10）
或贴士 id（显示当地语原文 `local_text`，小字中文标题，顶上写「给对方看」；`lang` 用 `local_lang`）；也接受预订 / 条目 / 联系人的 id（取它关联的地点）。

- **版式**：全屏、不透明、不用玻璃：白底墨字（`--color-driver-bg` 底 + `--color-text` 字，深色模式是深墨底、米白字），对比度 ≥16:1。换成纸本以后这一屏也不改，全站只有它是纯白底。
  大字用系统字体粗体（越南语声调最清楚）；左上角关闭和「给司机看」，右上角留空（演示模式的角标在那里）；底部「复制」「打电话」两个 52px 大按钮 + 「点空白处或往下拉关闭」。
- **字号自动适配**：二分查找能放下的最大字号——名字 32–72px（平板、桌面按宽度放大，最大 128），地址 = 名字 × 0.62 但**不小于 28px**；
  到最小字号还放不下 → 中间那块可以上下滚动（上下边缘渐隐）。转屏、改窗口大小时重新算（ResizeObserver）；横屏按钮和提示并排、上下留白收紧。
- **关闭**：点空白处（按钮以外的任何地方；出场动画播完才算，打开时误点两下不会马上关掉）、往下拉（过 110px 或甩一下，速度 > 700px/秒；拉的时候跟手、稍微变淡；不够就弹回）、左上 ×、Esc、手机返回手势。
  平板、桌面上关闭按钮、大字、按钮在同一条居中的栏里（`--content-max` 宽，左边对齐）。
  能滚动时从中间那块开始的手势交给滚动。
- **动画**：从点的按钮长出来（`motion/morph.js` 的 `morphFrom`，clip 模式、不回弹的 smooth：全屏的卡过冲会露出背后的页面），同时整张卡 0 → 1 淡入——
  第 0 帧按钮原样看得见，不会“按钮的字一下子没了、变成一块白”；大字在形状长到 40%–90% 之间出现。
  关：按钮还在就原路收回，一开始收就跟着淡（smooth 停稳时间的 15% 之后、`--dur-base` 缓出：大字内容在收回的前一小段就淡掉了，卡片紧跟着，不会剩一块空白的卡缩回去）；往下拉关的接着手指速度滑出屏幕；找不到按钮（刷新打开）就淡入淡出。减弱动态效果：只淡入淡出。
  半路截图见 e2e（`__shots__/kit/driver-open-00.png`、`-30`、`driver-close-50.png`）。
- 找不到 id：显示「找不到要显示的地点」；数据还在读：「正在读取…」。
- 弹层基础设施（网址、锁滚动、背景 inert、焦点进出、Esc）用 `overlay/index.js` 导出的 `useOverlayRoute` / `useLayer` / `Portal` / `findTrigger` / `anchorRect` / `viewportInfo` / `fadeTo`……
  （外壳评审后从 `overlay/index.js` 导出了，不再直接引 overlay 的内部文件）；看大图（`photo`）这种自定义全屏弹层照这个写。
