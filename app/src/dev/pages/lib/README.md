# dev/pages/lib/ —— #/dev/lib「工具与服务」展示页的各段

页面入口是 `../LibPage.jsx`；这里每段一个文件，只用演示数据和假接口，不连任何外网。e2e：`test/e2e/lib.e2e.mjs`。

| 文件 | 内容 |
|---|---|
| `FxDemo.jsx` | 汇率卡：情景（演示数据 / 接口正常 / 断网有旧缓存 / 断网没缓存 / 真实接口）、换算、“连续重新渲染 30 次”看请求次数不变 |
| `WeatherDemo.jsx` | 天气卡：把“现在”拨到不同时刻（出发前一周可看、出发前 5 天、出发前 14 天、行程第 2 天、断网）；`WEATHER_ICONS` 图标对照 |
| `MapDemo.jsx` | 地图：全部地点 / 每天路线切换（实例不重建）、地图 ↔ 列表联动、Google 地图链接、手动加载真实底图 |
| `FormatDemo.jsx` | 日期时间样例表（可切时区）、金额样例表、数字滚动（`ui/RollingNumber`）、金额输入解析 |
| `TextDemo.jsx` | 复制当天行程（useCopy + 提示总线，提示显示成外壳里的 Toast）、Google 地图链接表、Markdown 实时预览 |
| `ImageDemo.jsx` | 选照片压缩、生成带 EXIF 的测试照片、演示照片 |
| `demo-data.js` | 从演示数据库整理地图、天气、复制要的数据 |
| `exif-fixture.js` | 造带 EXIF 的 JPEG / HEIC / WebP / PNG / TIFF（单元测试也用它） |
| `lib-page.css` | 样式（`lp-` 前缀）。加载占位用 `ui/Skeleton`、按压用 `data-press`，这里不另写一套 |
