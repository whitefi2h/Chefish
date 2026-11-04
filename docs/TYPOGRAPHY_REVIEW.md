# 字体实机检阅记录

检阅日期：2026-11-01。最终字体和全局排版字重仍待用户选择。

## 已修正的问题

| Before | After | Why |
| --- | --- | --- |
| MiSans VF 声明为 CSS 100–900，标题使用 700 | 官方静态 Light / Regular / Medium / Semibold / Bold 分别对应 CSS 300 / 400 / 500 / 600 / 700 | 原始变轴范围 150–700，其中 Regular=330、Heavy=700；原映射把标题推向 Heavy |
| 允许浏览器合成字重 | `font-synthesis: none` | 对照时只显示字体实际提供的样式 |
| 只有浏览器文字样板 | Windows WebView2 原生矩阵及实际组件截图 | 检查密集信息与页面层级中的实际视觉重量 |

字体元数据来自本地官方原始文件，MiSans 静态 WOFF2 未修改字形或字体内部元数据。思源黑体使用 Adobe 官方 Source Han Sans CN VF，许可副本保存在本地字体缓存中。

## 检阅方案

页面基准字号：页面标题 30px、菜名 17px、正文 14px。

| 方案 | 字体与字重 | 指定文字字号补偿 |
| --- | --- | --- |
| 0 | 旧 MiSans VF，保留原页面字重 | 0 |
| 1 | MiSans Regular，去加粗 | 0 |
| 2 | MiSans Regular，去加粗 | +1px |
| 3 | MiSans Light，去加粗 | +1px |
| 4 | 思源黑体 Regular，去加粗 | 0 |
| 5 | 思源黑体 Light，去加粗 | +1px |

字号补偿只作用于指定标题、正文和关键控件，不是每一处辅助字号。300/400/500/600 矩阵按命名字重语义对齐，包含 12、14、16、18、22、30px。

## 可复核范围

- 独立 Tauri 检阅器：`src-tauri/target/release/chefish-font-viewer.exe`。
- 前端为生产构建实际 React 组件副本，检阅副本强制走内存演示分支；不调用个人厨房数据库。
- 原生 Windows WebView2 渲染，截图通过窗口捕获保留，未经图片锐化或重排；图像自然尺寸 2234×1210。
- 菜谱使用现有演示插画，占位资源在所有方案中一致。此证据用于字体对比，不代表个人数据下的完整业务验收。
- 原图位于 `docs/screenshots/font-native/native/`；浏览器预检图不计入实机截图。
- 检阅入口：`docs/ui-round2-font-review.html`。

## 构建与回归

- 生产构建、TypeScript 检查、ESLint 通过。
- `library-polish.spec.ts`、`inventory-refinement.spec.ts`、`modal-stability.spec.ts` 共 14 项回归通过。
- 最初回归因 Vite 扫描运行中的检阅 EXE 遇到 EBUSY 中断；加入 docs/fixtures 监听忽略后，完整重跑 14 项通过。
- 修正字重资源后的生产 EXE：`src-tauri/target/release/chefish.exe`。
- NSIS：`src-tauri/target/release/bundle/nsis/Chefish_2.0.0_x64-setup.exe`。
- 去加粗 / Light 方案仅供检阅，生产样式尚未全局切换为 Regular 或 Light；未发布新的线上 Release。

## 采集状态

2026-11-01 已补齐：菜谱页 6 张、库存页 6 张、双字体字号字重矩阵 4 张，共 16 张原生截图。窗口恢复后重新观察并核对方案标签，确认文字和食材图标显示完整后保存。检阅页已开放全部方案、原尺寸显示和原图链接。

前一轮因最小化和窗口状态不同步暂停；该阻碍已解除。未使用浏览器预检截图替代原生截图。本轮只更新检阅证据与页面，未修改业务功能。

## Medium 正文与分级标题补充

按用户反馈新增两组 MiSans 与两组思源黑体候选，均沿用上一轮 +1px：标题 31px、菜名 18px、正文 15px。只改变字重，不混入新的字号调整。

| Before | After | Why |
| --- | --- | --- |
| 全页 Regular，标题也为 400 | 标题和正文均为 Medium 500 | 检查 Medium 的基础视觉重量 |
| 标题与正文同为 500 | 标题、菜名、强调、主要操作为 Semibold 600，正文为 Medium 500 | 用字重差恢复标题层级 |

预检读取真实组件计算样式：Semibold 方案菜名为 600、正文为 500，无脚本错误。新方案只进入独立检阅器，未应用到生产全局字体；待用户选择。

新增截图：菜谱与库存各 4 张，共 8 张；连同上一轮共 24 张。检阅器重新构建成功；检阅页默认 M/M 与 SB/M，支持原尺寸图像检阅。本轮未改动生产样式或业务逻辑。
