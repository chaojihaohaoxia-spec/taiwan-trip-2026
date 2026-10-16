# pages/join/ —— 加入行程（路由 `join`，`#/join/:code`；SPEC §5.13）

这一页不用登录（`meta.auth: false`）、没有外壳的框（bare），自己画：左上「回到行程列表」（登录了才有，玻璃小圆）、品牌眉标、宋体大标题「加入行程」、一句说明（左对齐，和登录页一致，不放插图）、一张纸片。

## 卡片里的几种情况

| 情况 | 显示 | testid |
|---|---|---|
| 链接里的码不对 | 「这个邀请链接不完整」+ 说明 + 粘贴邀请码重新来（`JoinCodeForm`，替换这条历史） | `join-bad` |
| 还在确认登录 | 转圈「正在确认登录…」 | `join-wait` |
| 没登录 | 邀请码（大字）+「要先登录才能加入」+「登录后加入」（`#/login?next=#/join/<码>`）；本机记下这个码（`rs7885:join:pending`，行程列表会提示「还有一个邀请没加入」，两周后不再提示） | `join-signed-out`、`join-login` |
| 登录了 | 邀请码 +「以 xxx@… 加入 · 不是你？换个账号」（退出后留在这一页）+「确认加入」（`SubmitButton` 受控：`data.rpc.redeemInvite`，要联网；离线时禁用并说明）+「先不加入」 | `join-ready`、`join-submit` |
| 加入成功 | 封面 +「已加入」/「你本来就在这趟行程里」+ 行程名 + 日期 +「邀请人：Jeremy（创建者） · 你的权限：可编辑」+「进入行程」（replace）/「看全部行程」 | `join-done`、`join-inviter`、`join-open` |
| 失败 | `model.js` 的 `joinErrorInfo`：没网（可以重试，码不会作废）/ 邀请用不了（列出可能的原因：过期、用过、撤销、复制少了几位 —— 后台不区分，统一报「邀请码无效或已过期」）+「换一个邀请码」/ 要先登录 / 其他（中文原因 + 重试） | `join-error`（`data-kind`） |

**邀请人和行程名**：现在的 RPC（`docs/数据结构.md` A4）没有“不加入、只看看这个邀请”的函数，所以只能**加入以后**再显示行程名和邀请人（`loadTrip` 读成员，取 `trips.owner_id` 那位的显示名；读不到也不影响加入）。
页面已经预留：数据层以后加了 `data.rpc.peekInvite(code)`（返回 `{ trip_title, inviter_name, role, expires_at }`），加入前就先显示（见交付报告里的「需要整合的改动」）。

## 文件

| 文件 | 内容 |
|---|---|
| `JoinPage.jsx` | 页面 |
| `JoinCodeForm.jsx` + `join-form.css` | 「有邀请码？」一行：粘贴整条链接、旧版 `?invite=`、带空格、小写都认 → `#/join/<码>`；认不出摇一下说原因（行程列表的空状态也用它） |
| `model.js` | 纯逻辑：`codeFromInput`、`joinErrorInfo`、`pendingInvite` / `rememberInvite` / `forgetInvite`、`inviterLine` |
| `join.css` | 样式（`join-` 前缀） |

测试：`test/unit/page-account.test.js`、`test/e2e/page-account.e2e.mjs`（Jeremy 发邀请 → Cathy 加入 → 邀请人 / 权限 → 进入；再开同一个链接；无效码；不完整的码；没登录）。
