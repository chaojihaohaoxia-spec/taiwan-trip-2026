# pages/translate —— 翻译（`#/t/:tripId/translate`）

照小程序 1.4.5 的翻译栏做（`我们的账本/miniprogram/components/trip-translate`、`trip-converse`），换成网页的组件、动效和「杂志纸本」。
后端是云开发 HTTP 访问服务上的云函数 `translate-web`：和小程序同一份提示词、同一个 hy3，认人用网页的 Supabase 登录 token。

## 入口

「更多」菜单第一行「翻译」（`shell/overlays/MoreMenu.jsx`），**只在越南这类外语行程里有**（`lib/translate/text.js` 的 `translateLang`：越南盾或越南时区）。
提示词写死了越南（中文 → 越南语 + 英语），台湾那趟不需要；别的行程硬打开这一页说一句「这趟不用翻译」。
为什么不放底栏：底栏五格（行程 / 地图 / ＋ / 账本 / 更多）都是每趟都有的，翻译只有外语行程才有；放「更多」第一行，两下就到。

## 版式

- 上面随页面滚动：收藏（先露 4 条，「全部」展开）、最近翻过（旧的在上、新的在下）、结果卡（最新的一张紧挨着输入区）。内容不够一屏时贴着下面排（像聊天）。
- 下面固定输入区 `.tr-dock`（浮在底栏上面的纸片；键盘弹起时底栏沉下去，输入区贴着键盘上沿：`overlay/keyboard.js` 的 visualViewport 高度）：
  语言栏「中文 ⇄ 越南语 ＋英语」（只有 ⇄ 对调，点语言名 ⇄ 跳一下）+「对话」；输入框（× 清空、加称呼、粘贴、还能写几个字、「翻译」）。
- 结果卡：越南语最大（点它 = 给对方看）、「意思是 …」（回译）、英语（带复制）；外文进来就是中文。最下面一行：星、复制、读出来（有越南语声音才有）、「给对方看」。
- 「给对方看」：`openDriverCard('tr.<id>')`，driver 全屏大字卡（越南语最大、英语、中文小字），内容从 localStorage 读（`sheets/driver/translation.js`），刷新、没网也能开。
- 「对话」：`openConverse()`，`sheets/converse/ConverseSheet.jsx`（上半屏转 180° 朝着对方，我说 / 对方说，第一次讲怎么用，屏幕常亮）。

## 规则（`controller.js`，Node 里测）

边打边翻（写完了停 0.45 秒、没写完 0.65 秒；拼音和输入法拼写中不翻；同一句不重发；以最后一次为准）、什么时候记进最近翻过、上一句、⇄ 对调和还原、称呼、
翻过的直接拿出来（不连网）、限频悄悄补发、语言栏自动翻过来提示一次——都照小程序，见文件头。

## 接口（`data/translate.js` → `lib/translate/client.js`）

- 地址只在 `data/config.js` 的 `TRANSLATE_URL`（`scripts/lib/csp.mjs` 也读它放行 connect-src）。
- `POST`，`Content-Type: text/plain`（不发 CORS 预检），body `{ text, token, trip }`；进页面、回到前台、点输入框时预热 `{ warm: true }`（4 分钟一次）。
- 超时 10 秒；网络断一下重试一次；`bad_token` 先换 token 再试；手机上也限频（10 秒 8 次、一分钟 30 次，自动发的 6 / 24 次）。
- 后端没上线 / 连不上：一句「翻译暂时连不上，晚点再试」，收藏和最近翻过照样能看、能给对方看；地址留空 = 「翻译还没接上」。
- 演示模式（`?demo=1`）用 `lib/translate/demo.js` 的假接口（只认得几句）；本机再加 `?trhttp=1` 走真的 fetch（e2e 拦下请求检查格式）。

## 本机存的

`localStorage`：`rs7885:translate:recent`（最近翻过 30 条）、`:star`（收藏 50 条）、`:honor`（称呼）、`:converse-intro`（对话的说明看过了）。不分行程。

## 测试

- 单元：`test/unit/page-translate.test.js`（文字规则、存储、客户端、演示接口、状态机、对话两半屏、给对方看、路由和 CSP）。
- e2e：`test/e2e/page-translate.e2e.mjs`（入口、边打边翻、收藏 / 复制 / 给对方看 / 对调 / 称呼 / 刷新、对话、真接口的请求格式和失败、375 / 深色 / 桌面）。
  截图：`<截图根目录>/__screenshots__/page-translate/`，`TR_SHOTS=<目录>` 再存一份。
