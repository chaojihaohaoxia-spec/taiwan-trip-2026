# sheets/item/ —— 弹层「item」：加条目 / 编辑条目（SPEC §9.2，每天页负责）

```js
openItemSheet({ date, after, parent, variant, kind })   // 加条目：预填哪天、插在哪一条后面、挂在哪个主方案下、方案、种类
openItemSheet(item.id)                                  // 编辑
```

| 文件 | 内容 |
|---|---|
| `ItemSheet.jsx` | `<Sheet sheetId="item">`（`['content', 'large']`，底部 `SubmitButton`，`confirmClose` = 表单有改动）。表单：标题、类型（可横滑的种类胶囊）、时间（开始 / 结束用系统时间选择器；模糊时间 + 快捷词）、地点（搜这趟行程的地点，越南语不带声调也能搜；或新建一个只有名字的地点，保存时一起写进 `places`）、说明（自动长高）、方案（主 / 备选 / 雨天；备选可挂到那一天的某条主方案下）、哪天（含备选池）。只读成员：禁用并说明。编辑时底部有「删除这条（可以撤销）」：软删除，外壳弹「已删除 · 撤销」 |
| `form-model.js` | **纯逻辑**（`test/unit/page-day.test.js`）：`initialForm`、`validateForm`、`toRow`、`formPatch`（只提交改了的字段）、`resolveSortKey`（新建按钟点插进那一天 / 插在某条后面 / 排到最后；编辑只在换天或钟点变了且位置不对时重排；算法在 `pages/day/model.js`）、`dayOptions` / `parentOptions`、`filterPlaces`、`sameForm` |
| `item.css` | 样式（pages 层，按需加载），类名 `.item-*` |

保存成功：面板收回；加到当前页面这一天 → `toast.success`；加到别的天 → Toast 带「去看看」（跳到那一天并 `?item=` 展开）；放进备选池 → 提示。
失败：`SubmitButton` 摇头 + 中文原因（校验的提示，或数据层 `DataError` 的 message）。
