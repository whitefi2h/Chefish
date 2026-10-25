# Changelog

## Unreleased — 2026-10-25

- 左下角“我的厨房”打开统一设置，集中管理用餐偏好、通用选项、模型与备份。
- 默认人数联动菜谱展示和新增配餐；口味、忌口、厨具描述可保存、清除并提供给 AI 参考。
- 支持手动备份、每日启动自动快照、恢复预览和恢复前安全备份，菜谱图片随数据库保存。
- 可设置启动页面和助手发送按键。
- 新增“账户与云端”设置：可选 Firebase 邮箱账户与手动云备份，支持图片分块去重、下载校验和恢复前安全备份；独立项目尚未部署，多设备自动合并留待后续。
- 临时数据验证：28 项前端单元、100 项 Rust、114 项 Playwright、6 项 Firebase 模拟器测试通过；2 项联网测试默认忽略。Windows x64 本地安装包构建成功，尚未发布为新发行版；真实云项目与双机验收未完成。

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
