# sheets/invite/ —— 弹层「invite」：邀请成员（SPEC §5.12）

打开：设置页「每趟行程」里创建者的「邀请成员」（`navigate({ name: 'settings', query: { trip: id }, sheets: [{ id: 'invite' }] })`）；
行程内页面也能用 `openInviteSheet({ role })`（行程从路径的 `:tripId` 读）。参数 `role: 'viewer'` 预选只读。底部面板 `['content', 'large']`。

## 内容

1. 顶上：邀请到哪一趟（封面点 + 宋体行程名）。
2. 只有**创建者**能邀请（数据层的 RPC 也允许可编辑成员，这里按产品要求只给创建者）；不是创建者时说明原因。
3. 设置：加入后的权限（可编辑 / 只读 + 一句说明）、有效期（1 / 7 / 30 天）、能用几次（1 / 5 次）——三个 `SegmentedControl`。
4. 「生成邀请链接」：`SubmitButton` 受控（`data.rpc.createInvite`，要联网；离线时禁用并说明）→ 换成结果：
   - 大号邀请码（系统字体等宽数字、大字距；码里没有 I O 0 1，念给对方也不会听错）——**只显示这一次**（库里只存哈希）；
   - 链接 `…/#/join/<码>`（码在 # 后面，不进服务器日志）；
   - 「分享给对方」：`lib/native.js` 的 `share()`（系统分享；不支持就复制链接 + 提示；以后 iOS 外壳接管），分享的那段话 `inviteShareText`；
   - 「复制链接」（按钮就地变「已复制链接」）；说明「可编辑 · 7 天内有效（到 10月20日 21:44） · 能用 1 次」；「再生成一个」。
5. 已发出的邀请（出场动画播完才去读，要联网）：状态芯片（有效 / 已用完 / 已过期 / 已撤销）、权限、「已用 0/1 次」、到期 / 用完 / 撤销的时间；
   有效的可以「撤销」（确认后 `data.rpc.revokeInvite`，列表刷新）。离线：说明 + 重试。刚生成一个时列表自动刷新。

二维码：可选项，这次没做（没有二维码库；当面邀请也可以直接分享链接）。

## 文件

| 文件 | 内容 |
|---|---|
| `InviteSheet.jsx` | 弹层 |
| `model.js` | 纯逻辑：选项、`inviteShareText`、`inviteMeta` / `inviteMetaParts`、`inviteRowInfo`、`sortInvites`、`validLabel` |
| `invite.css` | 样式（`ivf-` 前缀） |

测试：`test/unit/page-account.test.js`、`test/e2e/page-account.e2e.mjs`（生成 → 码的格式和链接 → 复制 → 列表里有效的一条 → 撤销 → 已撤销；Cathy 用它加入）。
