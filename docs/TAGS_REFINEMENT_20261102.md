# 标签管理与周灵感修正 · 2026-11-02

按本轮截图批注调整。预设目录数量与默认开关不变，仍为菜系 46、菜品特性 12、烹饪方法 49，默认开启 24 项。

| Before | After | Why |
| --- | --- | --- |
| 菜系按大段独立分组排列 | 中餐、西餐作为可展开父级，子菜系缩进显示 | 直接表达所属关系，减少平铺长度 |
| 批量选择入口不明显 | 顶部全选、反选、清空；父级提供整组选中和反选 | 无需逐条勾选，也能处理收起的子项 |
| 每行重复类型、别名、上级与词条说明 | 列表保留名称、展开、开关和编辑 | 类型已由当前页签表达；别名仍用于搜索与 AI 匹配 |
| 原生 Ctrl 多选上级、大说明框 | 可搜索的普通复选框、已选标签；删除说明输入 | 不依赖组合键，选择结果清晰 |
| 保存标签位于表单底部 | 保存固定在弹窗右上角 | 小窗口和长列表中均可直接保存 |
| 旧 AI 自由词残留在待整理中 | schema 17 升级清理其元数据、未匹配词和迁移产生的关联 | 统一使用受控目录，保留原分类与人工选择 |
| 全局周灵感长期延续 | 以周一日期保存各周名单，新周为空 | 各周独立，切回已设置的周可继续使用 |

## 数据行为

- schema 16 → 17 使用现有迁移前安全备份与事务。历史 AI 元数据中的 `legacyTags`、`tags`、`tagsOrigin` 退出使用；人工确认过的结构化标签不因同名旧 AI 词被删。
- 原有手工分类无法匹配目录时，仍可在“待整理”归入受控标签。不会删除菜谱或配方版本。
- 周灵感保存为 `app_settings` 中的 `inspiration_week:YYYY-MM-DD`，复用持久化、撤销、同步日志与备份链路。
- 旧版本全局灵感没有所属周信息，因此保留旧表原记录供恢复，但不再作为任何新周的活跃名单，也不伪造历史周。已安排餐次保持原样。
- 菜谱库的“周灵感”按钮作用于当前查看的周。停留在应用跨周时，只有原本查看当前周才自动跟随新周，手动查看的其他周不被切走。

## 验证

- TypeScript、ESLint、生产构建通过。
- Rust 常规回归 155 passed / 1 ignored（排除 live 与 firestore），其后新增 schema 16 升级清理测试通过；标签同步重放测试扩展至周灵感并通过。持久化与迁移使用临时 SQLite，不操作个人厨房。
- 浏览器标签／周灵感／周导航与弹窗回归 11 项通过。固定保存调整后，标签与周灵感 6 项再次通过，包含 1000、1280、1440、1920 宽度的保存可见性检查。
- 前端单元测试 36 passed / 1 skipped；Firestore 本地模拟器 8 项通过，schema 17 可接受、未来版本拒绝。
- Windows WebView2 使用同一生产组件的隔离内存演示副本，检查树形层级和添加标签。原生存储由临时数据库测试覆盖；没有将演示界面称为个人数据库端到端验收。
- 本轮未调用真实模型、未部署线上云规则、未提交推送、未替换 GitHub Release。

截图：[标签树](screenshots/tags-refinement/tree-expanded.png)、[所属标签与顶部保存](screenshots/tags-refinement/parent-picker.png)、[新周为空](screenshots/tags-refinement/new-week.png)、[WebView2 标签树](screenshots/tags-refinement/native/tree-expanded.png)、[WebView2 顶部保存](screenshots/tags-refinement/native/parent-picker.png)。

## 成品

- `src-tauri/target/release/chefish.exe`：2026-11-02 01:39:09，本机时间。
- `src-tauri/target/release/bundle/nsis/Chefish_2.0.0_x64-setup.exe`：2026-11-02 01:39:08，42.17 MiB。
- 版本维持 2.0.0。构建退出码 0。

当前旧实例被保留，运行文件改名为 `chefish-running-before-tags-refinement-20261102.exe`。请从托盘退出旧实例后再启动新 EXE，避免单实例机制继续唤起旧界面。

云规则仅本地验证，线上是否仍限制旧 schema 未在本轮刷新。新格式在线同步／备份需部署本仓库支持 schema 17 的规则；本轮没有执行部署。
