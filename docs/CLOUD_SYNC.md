# 账户与云备份

2026-10-25：可选云备份已接入独立 Firebase 项目 `chefish-kitchen`。香港区域 `asia-east2` 的默认 Firestore 数据库、账户隔离规则与索引已部署；数据库为免费层，已开启防误删保护，未关联计费账户。普通邮箱密码登录已开启，真实云端合成数据传输通过验证；原生桌面完整往返和双机验收仍未完成。参考项目 `E:\zenfish` 只读，未复用其项目配置、凭据或业务集合。

在左下角“我的厨房 → 账户与云端”注册或登录邮箱账户，验证邮箱后，手动上传厨房备份。另一台电脑登录同一账户后，刷新列表、下载预览，再确认恢复。登录、退出和下载预览均不会替换本机业务数据。未配置云服务的构建显示连接状态，本地功能保持可用。

这一步提供备份迁移能力。多台设备同时编辑时，当前不自动合并，不宣称已完成持续双向同步。

## 备份内容

| 内容 | 云端处理 |
|---|---|
| 菜谱、封面与步骤图、历史配方 | 包含，图片与引用保持一致 |
| 库存、操作历史、采购、菜单、烹饪与手记 | 整体一致快照 |
| 默认人数、口味、忌口、厨具 | 包含；确认恢复时替换 |
| 聊天记录、未知设置字段 | 从快照副本移除，再 VACUUM 清除释放页；恢复保留本机最新聊天 |
| 启动页、发送快捷键、自动备份开关 | 上传副本重置为默认值；恢复保留本机设置 |
| 模型密钥、Firebase 登录凭据 | 不在业务快照内，不上传 |

云备份包含个人厨房信息；Firebase 按账户权限保护，当前未实现客户端端到端加密。登录状态由 Firebase SDK 保存到应用的 WebView 存储，退出不清空 SQLite。

## 数据与失败处理

原生层创建 SQLite 一致副本，按 256 KiB 原始字节分块，每块 gzip 压缩后计算 SHA-256。分块以内容哈希为 ID，可在账户内复用。单个原始快照最大 512 MiB，本机与云端规则使用同一上限；这是应用大小上限，不代表云端额度保证。容量上限已从首版的 128 MiB 提高，旧版程序仍受旧上限限制，恢复大备份前应更新程序。

路径为 `users/{uid}/chunks/{sha256}` 与 `users/{uid}/backups/{uuid}`。完成全部分块上传后才发布清单；分块与清单发布后不可更改，完全相同的重试允许通过。上传采用服务端事务，离线失败，不排队等待日后静默上传。读取从服务端获取，错误不会显示为成功。

`firestore.indexes.json` 排除分块的 base64 内容及备份清单的分块数组索引，保留备份时间排序。它们不参与查询，避免为大载荷维护无用索引。

下载每块校验压缩数据哈希、长度与有界解压，再校验整体数据库哈希、schema、SQLite 完整性及外键，迁移副本后才生成恢复预览。实际替换前另存本机安全备份，并在数据库锁内把最新本机聊天和通用设置带入恢复副本。恢复继续使用既有 SQLite 在线备份与失败回滚流程；模型提案失效，避免对恢复后的厨房执行旧操作。

暂存文件在传输结束或失败后清理。强制结束进程可能留下缓存目录；尚未加入启动时清理。已上传但未发布的分块保留用于重试，当前没有云端垃圾回收或删除界面，列表显示最近 20 份。开始正式长期使用前应补充占用统计和保留策略。

## 独立项目配置

1. 使用已创建的 Chefish Firebase 项目 `chefish-kitchen`，保持 Spark。不要选择 Zenfish 项目，不启用计费或 Cloud Storage。
2. 在 [Authentication 控制台](https://console.firebase.google.com/project/chefish-kitchen/authentication)首次点击“开始使用”，启用普通 Email/Password。无需启用无密码邮箱链接登录或升级 Identity Platform。数据库已位于香港区域。邮箱验证链接必须能正常打开。
3. 注册 Firebase Web App。把四个公开配置字段填入本地 `.env.local`，字段见 [`.env.example`](../.env.example)。这些字段是客户端标识；服务账号、私钥、密码和 AI 密钥不能写入 `VITE_` 变量。
4. 重新认证后，明确传入真实项目 ID 部署权限：

```powershell
.\node_modules\.bin\firebase.cmd login --reauth
.\node_modules\.bin\firebase.cmd deploy --only firestore --project chefish-kitchen
npm run tauri build
```

不提交个人 `.env.local`，不保留指向参考项目的 `.firebaserc`。原生 CSP 只放行 Firebase Auth、Secure Token、Firestore 和 Installations 的具体 Google API 主机，不关闭 CSP。

本机构建使用已写入 `.env.local` 的独立 Web App 配置；其他开发者的源码构建仍需自行配置。首次 Firebase Authentication 初始化已由项目所有者在控制台完成，没有升级 Identity Platform，也未启用计费。

Firestore 单文档上限 1 MiB；本方案的压缩分块经过 base64 后仍低于此上限。Spark 的免费数据库容量与日读写额度有限，图片会占用数据库额度，不承诺无限免费。官方说明见 [Firestore 配额](https://firebase.google.com/docs/firestore/quotas)。Cloud Storage 的计费条件已变化，如后续改为对象存储，需要单独确认 Blaze；见 [Cloud Storage 方案变更](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)。当前代码未使用 Storage。

## 验证与尚待验收

```powershell
# Java 21+ 在 PATH；仅 demo-chefish 模拟项目，不访问真实云项目
npm run test:cloud:emulator
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:ui -- tests/settings.spec.ts
```

模拟器覆盖账户隔离、邮箱验证权限、不可变数据、大小与字段约束、分块复用、往返传输、上传中断、会话变化与缺块处理。Rust 临时库验证去除聊天与凭据字节、图片往返、损坏与超限拒绝、恢复前备份及本机设置保留。普通 `npm test` 会跳过未启动模拟器的云测试。

独立项目部署已完成；未登录真实请求返回 `403 PERMISSION_DENIED`。显式启用的真实云端测试已用临时账户验证注册、未验证邮箱拒绝、账户内上传与下载、分块复用、他人账户与访客拒绝，并清理临时账户和数据。测试用合成字节载荷与传输桥，没有读取个人厨房数据库，也没有发送邮件；只对生成的测试身份通过管理 API 标记验证。它证明真实 Auth/Firestore 及客户端传输，不能代替原生 SQLite 恢复链路和真实邮箱收信。部署状态见 [记录](cloud-deployment-validation.json)。

需要明确运行真实云检查时，在 PowerShell 中设置 `CHEFISH_LIVE_CLOUD_TEST=1` 后运行 `npx vitest run tests/firebase-live.test.ts`；完成后移除该环境变量。测试只允许 `chefish-kitchen` 项目，需要当前 Firebase CLI 管理登录和 `.env.local`。普通 `npm test` 默认跳过它。该检查会在真实项目创建并清理合成测试账户与数据，不能对其他项目运行。

仍待 Windows WebView2 真实账户登录与验证邮件、原生桌面云备份完整往返、两台电脑恢复及长期配额检查。程序已启动并看到原生设置弹窗；窗口随后最小化，未继续输入账户或执行恢复。

## 后续多设备同步

保留本地 SQLite 为业务权威。下一步先增加本地设备标识、事务 outbox 和云端游标；每次烹饪、采购入库或撤销作为一个原子操作组，重复重放不能重复扣减或入库。配方版本保持不可变，计划引用明确版本。并发库存变化需检测版本冲突并由用户处理，不能沿用简单的最后写入覆盖。

首次连接需明确选择上传本机厨房或恢复云端厨房；账户切换保持数据归属可见，不自动把一个账户下载的数据传给另一个账户。图片独立按内容哈希同步。聊天是否同步另行确认。完成这些约束及离线恢复验证后，再开启自动同步。
