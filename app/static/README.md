# static/ —— 静态资源源文件

| 路径 | 内容 |
|---|---|
| `icons/icon.svg` | 应用图标（还是中性默认皮肤的蓝色圆角底 + 白色“爱心定位针”；换成 A 皮肤的配色要另外改 SVG 并 `npm run images`，这次没动），普通图标用（圆角、角落透明） |
| `icons/icon-maskable.svg` | 满版图标：Android 自适应图标（maskable）和 iOS 主屏图标用，图形都在中心 40% 半径的安全区内 |
| `icons/favicon.svg` | 浏览器标签页小图标（简化版） |
| `fonts/` | 网页字体（思源宋体 600 分片、Instrument Serif、P2 Figure One）和授权原文 `fonts/licenses/`。由 `scripts/fonts/build-fonts.py` 生成，说明见 `fonts/README.md`。构建时不是整目录复制：`src/styles/fonts.css` 里 `url()` 引到的字体由 esbuild 带进 `assets/`（文件名加哈希）；`licenses/` 目前还没有复制进产物（见 `fonts/README.md`） |
| `icons/*.png` | 由 `npm run images` 用本机 Chrome 渲染生成：`icon-192.png`、`icon-512.png`、`icon-maskable-192.png`、`icon-maskable-512.png`、`apple-touch-icon.png`（180×180，不透明）、`favicon-32.png`。生成后用 `sips` 核对尺寸，单元测试也会检查 |

`npm run build` 把这些复制到仓库根目录的 `icons/`，manifest 和 index.html 用相对路径引用。

换皮时如果要换图标：改 SVG → `npm run images` → `npm run build`。iOS 主屏图标在安装时就定下了，已经装过的人要删掉重装才会变。
