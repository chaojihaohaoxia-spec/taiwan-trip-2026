# scripts/fonts/ —— 网页字体的裁剪、分片脚本

| 文件 | 内容 |
|---|---|
| `build-fonts.py` | 生成 `static/fonts/*.woff2`、`static/fonts/fonts.json`、`src/styles/fonts.css`：思源宋体按字表裁剪后按 `unicode-range` 切片，Instrument Serif 裁到拉丁 + 越南语，另裁出「P2 Figure One」（思源宋体 Regular 的「1」和「₫」，正体 + 按 Instrument Serif 斜体角度斜切、收窄的斜体）。同样的输入每次生成一字节不差（不改写字体里的时间戳：文件名的内容哈希不变，用户缓存的字体不会白白作废）。用法、参数、依赖见 `static/fonts/README.md`「重新生成」 |
| `preload.mjs` | 首屏要预加载的字体打包后叫什么（`assets/<名>-<内容哈希>.woff2`，和 esbuild 一致），`scripts/lib/html.mjs` 用它写 `<link rel="preload" as="font">` |
| `data/tgh-level1-3500.txt` | 《通用规范汉字表》一级 3500 字（Unicode Unihan `kTGH` ≤ 3500，公开数据） |
| `data/google-noto-serif-sc-slices.json` | Google Fonts 给 Noto Serif SC 600 的分片方案（只有 unicode-range 范围数据，用来判断哪些字常用） |

脚本里没有真实行程的内容：要把真实行程里的生僻字收进子集，运行时用 `--extra-text <仓库外的文件>` 传进去，脚本只读字符、只输出字体文件。
