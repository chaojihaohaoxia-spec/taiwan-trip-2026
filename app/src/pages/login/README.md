# pages/login/ —— 登录（路由 `login`，`#/login?next=…`；SPEC §5.13）

路由守卫把没登录的人带到这里（`#/login?next=<原来要去的网址>`）。没有外壳的框（bare），只有光场。

## 新视觉（A 液态玻璃 · 海岛光 + P2 杂志宋体）

一列：圆形海岛小标（主题色渐变天空 + 太阳 + 海面，纯 CSS）→ 品牌眉标「热爱生活7885」→ 宋体大标题「登录」→ 一句说明 →
（next 是加入行程的链接时）「登录以后会回到邀请页，继续加入行程」→ 一张磨砂白卡片（登录方式分段控件、往下凹的浅灰输入框、宋体大按钮、出错原因）→
演示说明（只在本机 `?demo=1`）→ 版本页脚（版本号 · 离线可用 / 在线）。手机铺满（左右 `--gutter`），平板 / 桌面居中、最宽 420。

## 逻辑（和外壳阶段一样，没改）

- 两种方式：密码（`data.auth.signInWithPassword`，iOS 钥匙串能自动填）/ 邮箱验证码（发送 → 60 秒后可重发 → 一行大号数字输入 `autocomplete="one-time-code"` → `data.auth.verifyEmailCode`）。
- 提交按钮 `ui/SubmitButton`（文字 → 转圈 → 对勾；失败抖一下、显示中文原因）；对勾描完 `replace(nextAfterLogin(route))`。已经登录的人打开登录页直接跳走。
- 新加：**这台设备上次用哪种方式登录成功，下次默认就是哪种**（`rs7885:login:mode`）；密码那一栏下面「忘了密码？用邮箱验证码登录」一键换过去（邮箱带过去）；验证码那一步可以「换个邮箱」。
- 第一次打开默认是**密码登录**：`test/e2e/shell.e2e.mjs`、`smoke.e2e.mjs` 约定一打开就是 `login-password-form`（不能改别人的测试）。
  SPEC 要求「邮箱验证码为主」——要改成第一次打开就是验证码，把 `LoginPage.jsx` 里 `readMode()` 的默认值改成 `'code'`，同时改那两个测试（见交付报告「需要整合的改动」）。
- 「发送验证码」和「登录」两个提交按钮都带 `key`：不带的话 Preact 会把已经停在对勾上的「发送」按钮直接拿来当「登录」按钮，点了没反应。

testid（e2e 依赖，别改）：`login-mode`、`login-password-form`、`login-code-form`、`login-email`、`login-password`、`login-submit`、`login-send-code`、`login-code`、`login-verify`、`login-resend`、`login-error`、`login-notice`、`login-demo-hint`、`login-foot`；新加 `page-login`、`login-to-code`、`login-change-email`、`login-joining`。

测试：`test/e2e/shell.e2e.mjs`（登录流程）、`test/e2e/page-account.e2e.mjs`（新视觉 390 浅色 / 深色、375、1280，切到验证码带着邮箱，记住登录方式）。
