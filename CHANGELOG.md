# Changelog

## Unreleased — 2026-10-26

- 完成账户首次连接与多设备自动同步：离线补传、含图片厨房基线、原生事务重放、上传去重与崩溃重试；不同记录继续合并，同一记录冲突暂停并提供安全备份后保留云端。
- schema 13 新增账户绑定、确认游标与操作回执，升级前自动备份；聊天、密钥与通用设置留在本机。账户切换不自动转移厨房。
- 独立 Firebase 免费项目已部署权限与索引，保持未计费。两份原生临时数据库通过模拟器及真实云端合成数据传输，测试账户和文档已清理；未上传个人厨房。
- 单份云备份快照上限提高到 512 MiB，包含菜谱图片。
- 左下角“我的厨房”打开统一设置，集中管理偏好、通用选项、模型、本地备份与云端。默认人数联动展示和新增配餐。
- 支持手动备份、每日启动快照、恢复预览和恢复前安全备份，以及启动页和助手发送按键设置。
- Windows x64 安装包在本地构建，未更新公开发行版；检查结果与限制见 [同步验证](docs/sync-validation.json)。

## v1.0.0 — 2026-10-23

首次公开源码版本，主要面向中文 Windows 用户。

- 菜谱库、版本编辑、来源、封面步骤图和厨房手记。
- 批次库存、分类、历史操作与受版本保护的撤销。
- 常备调料、缺货切换、补购提醒与删除。
- 跨周多菜菜单、配方版本绑定、采购预测和购买入库。
- 烹饪确认、实际用量扣减、记录与整次撤销。
- DeepSeek 厨房助手，OpenAI / Gemini 适配；下厨房检索、整理与本地业务提案。
- 聊天保存、提案同意 / 拒绝、校验、事务执行与失败保护。
- 上下文承接、口语购买匹配、已有批次日期修改及授权估计说明。
- 重写中英文 README，合并旧文档，明确当前状态与后续方向。

提供 Windows x64 安装包与 SHA-256 校验文件。备份恢复、完整导出和自动更新留待后续开发。

First release: Chinese-first Windows kitchen management with recipe revisions, pantry batches, seasoning reminders, weekly meals, shopping and cooking records, plus a proposal-based AI assistant. Includes a Windows x64 installer and SHA-256 checksums.
