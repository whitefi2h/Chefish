# UI 层级与动态文字调整

2026-11-01。依据用户对中文产品研究的反馈实施，延续思源黑体和橙绿配色。

| Before | After | Why |
| --- | --- | --- |
| 搜索与辅助操作挤在一整行，分类操作像普通文字 | 搜索框收窄至标题右侧；分类操作恢复浅绿底、描边和点击区域 | 筛选仍完整放在列表上方，保持核心入口的辨识度 |
| 标题右侧重复说明 | 删除“直接调整数量与库位” | 为搜索腾出位置 |
| 数量中的数字、单位居中，字符长度影响位置 | 数字右对齐，单位固定留位、略弱 | 提高跨行扫描一致性 |
| 首页右侧区块标题接近重点菜名 | 提醒与采购摘要标题设为 18px，下一餐标题保持原样 | 建立主次，面板顺序与功能不变 |
| 采购右侧三组统计均铺底色 | 待买保留浅底，其余两组退为普通统计行 | 减少辅助区的视觉竞争 |
| 辅助信息广泛沿用 Medium | 通用提示、标签、辅助文字改 Regular，主要名称与数值保留原层级 | 保留主信息清晰度 |
| 侧栏标语与工具文字使用相同字体 | “好好吃饭，慢慢生活”使用细笔画衬线字体栈，Windows 使用宋体回落 | 仅在文案区域增加变化，不影响数字与数据录入 |
| 动态区域遗留 10–12px 文本或隐式继承 | 弹窗内容明确 14px，AI 用量解释、提案状态、导入提示、助手错误、管家展开内容、设置辅助文字统一到 13px | 检查条件显示的内容，不依赖默认页面截图 |

衬线字体使用系统已有字体，不新增外部下载或字体包。字号基于 CSS 像素，系统缩放会改变实际物理大小。

## 截图检阅

- [库存与完整筛选](screenshots/ui-coherence/after/1440-inventory.png)
- [首页主次与侧栏标语](screenshots/ui-coherence/after/1440-home.png)
- [采购摘要](screenshots/ui-coherence/after/1440-shopping.png)
- [AI 实际用量结果](screenshots/ui-coherence/1440-cooking-ai-result.png)
- [窄窗口手动用量展开](screenshots/ui-coherence/1000-cooking-expanded.png)
- [烹饪保存失败后保留的草稿](screenshots/ui-coherence/cooking-failure.png)
- [AI 提案](screenshots/assistant-pantry/1280-proposal.png)
- [菜谱导入编辑](screenshots/web-import/1280-preview.png)

以上为浏览器中实际应用组件与隔离演示数据的截图，不作为 Windows 原生字体渲染或真实模型服务验收。动态用量测试使用 IPC 替身触发结果与失败；未改变提示词、业务逻辑或个人厨房数据。

## 验证

- TypeScript、前端构建、ESLint、Windows EXE 与 NSIS 打包成功。
- 菜谱、库存、烹饪与布局首组 17 项通过；新增动态字号及失败草稿检查 3 项通过。
- 设置、助手、提案、导入、采购及弹窗综合回归 55 项中 54 项通过。唯一失败为 `visible source ingredients remain authoritative and unified amounts can change type`：期待第 5 项为蒜末，实际为糖；临时按名称定位蒜末仍未找到，故不能仅归因于序号变化。没有修改导入解析、领域规则，也没有放宽或删除原断言。临时定位修改已撤回，此项保留未通过记录。
- 视觉宽度覆盖 1000、1280、1440、1920；用量展开、失败草稿、导入预览和提案均触发后检查。窄库存采用原有表格局部滚动，列未隐藏。
- 导入预览截图禁用动画后重新捕获，避免把弹窗入场中间帧当作最终界面。
- 成品：`src-tauri/target/release/chefish.exe`；安装包：`src-tauri/target/release/bundle/nsis/Chefish_2.0.0_x64-setup.exe`。
- 构建时保留正在运行的旧进程，其文件移动到同目录 `chefish-running-20261101.exe`；未强制结束程序。已有窗口需从托盘退出后重新打开新 EXE 才会显示本轮样式。

版本继续为 2.0.0；未提交、推送或替换 Release。本轮没有新做 Windows 原生截图，不将浏览器检阅记为原生渲染验证。
