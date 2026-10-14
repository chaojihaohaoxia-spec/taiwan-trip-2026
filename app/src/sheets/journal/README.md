# sheets/journal —— 弹层「journal」：写日记 / 拍照打卡

`openJournalSheet({ date, mode: 'text' | 'photo', itemId, placeId }, { keyboard: true })`（`sheets/index.js`）。每天每人一篇：这一天我写过就是编辑，没写就新建（`store.saveJournal`）。

| 文件 | 内容 |
|---|---|
| `JournalSheet.jsx` | `<Sheet sheetId="journal" detents={['content','large']}>`：标题（写日记 / 编辑日记 / 拍照打卡）+ 副标题（D2 · 今天 · 浮潜）+ 表单 + 底部 `SubmitButton`（文字 → 转圈 → 对勾 → 收回） |
| `form.js` | 纯逻辑：心情列表 `MOODS`、`defaultJournalDay`、`formFromEntry` / `applyDraft` / `formPatch`（只提交改了的字段）、`uploadStateOf`（看写队列判断每张照片的状态）、`tripReady` |
| `draft.js` | 本机草稿：`readDraft` / `writeDraft` / `draftDays`，键 `rs7885:journal-drafts:<trip>:<user>`；`--real` 预览只放内存 |
| `capture.js` | 拍照打卡的中转站：`checkInWith(files, { date })` 把拍好的照片放进来再打开面板；`pickPhotos` / `capturePhotoCheckIn`（必须在点击回调里同步调用） |
| `PhotoInput.jsx` + `photo-input.css` | 「拍照」「从相册选」按钮：按钮上叠一层透明的 `<input type=file>`，手指点到的就是它（iOS 才一定弹相机）；页面也用它 |
| `journal-sheet.css` | 表单样式（`.jn-f`） |

## 表单

1. **哪一天**（多于一天时）：横向滚动的小格 `D2 / 今天`，写过的有个点；换天时当前这天的草稿先落盘。默认：`?date=` → 条目所在天 → 进行中今天 / 已结束最后一个没写的 / 出发前第一天。
   默认的那天**在渲染里定**（不等 effect）：从页面打开时数据早就在，第一帧画的就是完整表单，底部面板量到的内容高度才是对的；
   定过一次就不再自动换（保存以后“最后一个没写的天”变了也不跳），用户在日期条上点的另算。
2. **心情**：一排 emoji（`role="radiogroup"`），再点一下取消；日记里已有、不在列表里的心情放最前面；打开时选中的那个不在可见范围就滚进来。
3. **正文**：自动增高的 `<textarea>`（≥16px，iOS 不放大页面；打开时已有的日记 / 恢复的草稿也量一次高度，不只在打字时），`data-autofocus`（mode=text 时 `keyboard: true` 叫出的键盘接过来）。
4. **照片**：`拍照`（相机）/ `从相册选`（多选）→ 逐张 `store.upload('journal', file)`（`lib/image.js`：长边 2048 JPEG、按 EXIF 摆正、去 GPS、读拍摄时间 → `taken_at`）→ 进写队列 → 私有桶。
   每张显示状态：处理中（转圈）/ 上传中、排队（底边扫动条）/ 联网后上传 / 上传失败 · 重试（`data.retrySync()`）/ 传完显示拍摄钟点。× 去掉：这次会话新传的，还没发出去的从写队列撤掉，已经发出去（或正在发）的把文件也删掉（`data.files.remove`，排在上传后面）；日记里原有的照片这时只从表单去掉（没保存前还能反悔），**保存成功后**再统一删文件。私有桶里不留没人引用的文件。
   `mode=photo` 时照片区在最上面，「拍照」是主要按钮；中转站里有照片的话面板一打开（`whenOpened` 之后）就开始传。
5. **保存**：`formPatch` 只带改了的字段 → `store.saveJournal(dayId, patch)` → `await r.saved`（离线也成功）→ 清草稿 → 对勾描完 `closeOverlay('journal', { force: true })`。
   存储不可用提示「只保存在内存里」；离线提示「联网后自动同步」。失败：按钮摇头 + 下面显示中文原因。
6. **删除这篇日记**（编辑时）：`confirm` → `store.remove('journal_entries', id, { undoMs: 6000 })`，外壳弹「已删除 · 撤销」。照片文件等 `synced` 兑现为 `ok`（撤销窗口过了、删除真的发出去）再删；撤销回来照片还在。页面在 6 秒内被关掉的话文件留在桶里（没人引用，不影响使用）。
7. **面板高度**：`['content','large']`。表单从骨架换成真内容、照片多了少了、出现了提示（恢复草稿 / 出错 / 删除行）时 `requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))`
   让 `overlay/Sheet` 重新量内容高度——和记一笔面板同一个做法（Sheet 现在只在视口尺寸变化时重量；整合时建议 Sheet 自己用 ResizeObserver 盯内容）。
   冷启动没网、数据还没到时显示「正在读取…」骨架（不说“找不到”）。

## 草稿

每改一下（防抖 400ms）把 `{ mood, body, photos }` 存到这台设备；只在和已保存的不一样时才算草稿。**面板卸载时把防抖里还没落盘的最后几个字也写进去**（保存 / 删除以外的任何关闭：往下拉、返回手势、切页；e2e 打完字马上按 Esc 再打开核对）。往下拉关掉、切到别的 App、没网都不丢，下次打开同一天「已恢复上次没保存的草稿」。
所以关闭**不再问**「放弃未保存的内容？」。页面上我的那格显示「继续写 / 写了一半，还没保存」。保存成功后草稿删掉。

## 和别处的对接

- 页面 / ＋ 面板打开：`openJournalSheet(...)`；拍照打卡要一步到位的地方用 `PhotoInput camera` + `checkInWith`（日记页、外壳的 ＋ 面板都这样做：＋ 面板「拍照打卡」的瓷砖上叠着透明的 `<input type=file capture>`，点了直接开相机，拍完收回 ＋ 面板、`checkInWith` 打开写日记面板）。
- 从条目 / 地点打开（`itemId` / `placeId`）：用条目所在的天，表单顶上显示「关于「xxx」」（不写进日记）。
- 看大图的「编辑」：`openJournalSheet({ date }, { replace: true })` 换掉 photo 那一层。
- 两台设备离线各写了同一天：数据层合并（正文拼接、照片去重、心情用后来的），面板不用管；表单打开期间底稿变了而我没改时跟着换。
