# 技术结构

Tauri 2 承载 React / TypeScript 界面，Rust 管理 SQLite、业务事务、网页读取、模型调用与凭据。浏览器演示使用独立 fixture 和客户端，不作为真实业务数据来源。

## 代码入口

| 位置 | 责任 |
|---|---|
| `src/App.tsx` | 页面与应用状态协调 |
| `src/services/kitchenClient.ts` | 原生命令与返回类型 |
| `src/services/`、`src/fixtures/` | 原生访问与浏览器演示边界 |
| `src/Recipes.tsx`、`src/RecipeEditor.tsx` | 菜谱、详情、编辑与导入 |
| `src/Inventory.tsx`、`src/Seasonings.tsx` | 批次库存与常备调料 |
| `src/Planner.tsx`、`src/Shopping.tsx`、`src/Cooking.tsx` | 菜单、采购、烹饪 |
| `src/KitchenAssistant.tsx`、`src/AISettings.tsx` | 对话、提案与配置 |
| `src/Settings.tsx`、`src/Backup.tsx` | 统一设置弹窗、用餐偏好与本地备份恢复 |
| `src-tauri/src/main.rs` | IPC 注册与原生协调 |
| `src-tauri/src/db/`、`src-tauri/migrations/` | 业务事务与结构升级 |
| `src-tauri/src/assistant.rs`、`assistant_prompt.txt` | 上下文、提案和提示词 |
| `src-tauri/src/ai.rs` | 模型服务、设置与凭据 |
| `src-tauri/src/recipe_import.rs`、`recipe_images.rs`、`site_search.rs`、`site_access.rs` | 解析、图片与站点访问 |
| `tests/` | 浏览器交互和 IPC fixture 回归 |

## 数据约束

- 生产数据库位于应用数据目录。开发与 release 当前使用同一 identifier，不得用 fixture 覆盖用户库。
- SQLite 使用外键、WAL、事务和版本检查。迁移前用一致快照备份；未知或更高版本数据库不自动重建。
- 数量以十进制文本保存，后端负责权威计算。前端数值预览和演示预测不替代生产结果。
- 配方版本不可变，菜单引用特定版本；修改菜谱不能改变历史计划。
- 计划不扣库存。采购事实、入库和实际烹饪分别管理，重算需求不抹掉购买事实。
- 常备调料按备有 / 缺少管理，不按餐次扣减。移出列表后不会因旧菜谱再保存而自动复活，可主动重新添加。
- 库存保留不可变事件。日期修正复用版本化校正事件，并保存旧日期供撤销；后续批次变化会阻止过时撤销。
- AI 在数据库副本试运行命令，确认后同事务提交。过时、重复或失败提案不能部分写入。
- 用餐与通用设置以 `preferences_v1` 保存在 `app_settings`；独立 IPC 保存，AI 操作命令不能修改。仅用餐人数与饮食描述进入模型上下文，修改默认值不重写配方或已有菜单。

## 发布边界

代码、锁文件、配置、迁移和合成测试属于源码。个人数据库、凭据、聊天、导入图片、日志、截图、原始设计参考及构建产物不进入版本控制。

项目版本在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 保持一致；schema 独立演进。
