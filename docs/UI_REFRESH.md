# UI 视觉升级验收 · 2026-10-29

已应用明亮橙色、浅绿辅助和白色面板，保留现有导航、主要功能面板及操作流程。业务代码未修改。

## 实现范围

- 共享颜色、字体和圆角在 `src/tokens.css` 定义；原有硬编码颜色直接归入共享变量，没有叠加第二套主题。
- 首页、菜谱、配料与步骤、库存表格、周历、采购、助手和设置沿用原布局，统一表面、边框、文字层级及选中态。菜谱封面使用 16:10 容器；食材头像保持 contain，步骤图展示逻辑未改。
- 保留 Chefish 字标造型，其余展示字体统一 Windows 无衬线字体栈；日期与数量沿用等宽数字。主面板 18px、卡片 14px、控件 10px、标签 6px。
- Logo 仅由陶土红改为 `#CF4818`、白色图形改为纯白。去除颜色后与原 SVG 内容一致；路径、比例和透明边角不变。由原 Tauri CLI 流程重新生成图标，已查看 32px、128px 与 Windows 标题栏显示。
- 明确键盘焦点，保留减弱动画设置。700px 及以下高度隐藏侧栏装饰标语，确保底部设置入口可见。

## 验证结果

| 层次 | 结果与边界 |
| --- | --- |
| 静态检查 | typecheck、lint、前端生产构建通过；Git diff 空白检查通过。 |
| 前端单元 | 35 passed，13 个云服务可选测试 skipped。本轮未改后端，无新增后端测试结论。 |
| 浏览器完整回归 | 147 项中 145 passed、2 failed。失败项在 HEAD 原样式下单独复测同样失败，见下方说明。 |
| 视觉及相关交互复测 | 37 passed，覆盖菜谱分类拖拽、库存密度、菜单草稿、独立任务会话、任务横幅和抽屉几何位置。首轮分类拖拽关闭弹窗后曾超时，完整回归及专项复测均通过。 |
| 最后的小高度检查 | 6 passed，包含 1000／1280／1440／1920 宽度的页面、长菜名、缺图、空状态、键盘焦点，以及 600px 高度下设置入口和保存按钮可见。 |
| Windows 原生 | 独立 `com.chefish.uiqa20261029` 验收版使用实际 IPC 与独立 SQLite，建立 4 份合成菜谱、3 项库存和测试菜单。检查首页、菜谱、库存、周历、采购、助手、关于页面；助手开关不改变背景尺寸。原生实际 WebView 960×600，设置入口可见。未将浏览器 IPC 模拟称作原生验证。 |
| 本地成品 | Windows x64 release 与 NSIS 构建退出码 0。EXE 位于 `src-tauri/target/release/chefish.exe`，安装包位于 `src-tauri/target/release/bundle/nsis/Chefish_2.0.0_x64-setup.exe`。未运行安装程序。 |

完整回归中的两个已有失败：

1. `ingredient-images.spec.ts` 等待自动填入的食材头像，但没有取得图片元素。
2. `web-import.spec.ts` 最后一项期望第 5 行为蒜末，实际为糖。

两项都在修改前样式下复现。本轮不调整图片任务或导入排序逻辑；不将完整回归报告为全部通过。对照复测原始结果保存在本地 `docs/fixtures/ui-refresh-baseline-failures.json`。

## 本地证据

- 修改前后四种宽度、八个页面／状态截图：`docs/screenshots/ui-refresh/before/` 与 `after/`。
- 原生合成厨房截图：`docs/screenshots/ui-refresh/native/`；原生验证记录：`docs/fixtures/ui-refresh-native-evidence.json`。
- 助手横幅、独立会话及历史截图：`docs/screenshots/assistant-redesign/`。

上述截图与夹具按仓库既有规则保留在本地，不含个人厨房数据。版本号保持 2.0.0，不自动提交、推送或替换 GitHub Release。
