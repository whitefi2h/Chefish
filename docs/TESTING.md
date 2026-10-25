# 测试与验收

在 Windows 项目根目录运行：

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:ui
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --bin chefish
npm run tauri build -- --no-bundle
```

Playwright 使用 Microsoft Edge，自动启动 Vite。`test-results/`、`playwright-report/` 和 `docs/screenshots/` 是生成结果，不进入仓库。被忽略的真实网站测试需显式运行，可能受网络和限流影响。

| 检查 | 证据范围 |
|---|---|
| 类型 / lint / 前端构建 | 静态约束及前端构建 |
| TypeScript 单元测试 | 前端领域逻辑与转换 |
| Rust 测试 | 临时数据库、事务、迁移、版本、解析与提案试运行 |
| Firebase 模拟器 | `npm run test:cloud:emulator`：本地权限规则与云备份传输；需要 Java 21+，使用 demo-chefish 和独立端口，不代表真实云项目验收 |
| Playwright | 浏览器、IPC 模拟、布局、交互和错误处理，不替代真实 Windows DB |
| 原生桌面 | 实际进程、用户环境、重启、凭据与真实模型链路，须标明具体分支 |

单次模型成功不代表所有请求和服务均通过。不为测试在用户真实库执行库存、菜单或删除操作，使用临时库 / fixture；真实环境测试提案后可拒绝，保留业务数据。

v1.0.0 检查见 [验收记录](release-v1.0.0.json)。此前逐阶段材料已保留在开发者本地，不再作为当前公开文档。

2026-10-25 云备份首版的测试范围与本地构建校验值见 [验证记录](cloud-backup-validation.json)。后续独立 Firebase 项目部署与真实云端合成数据测试见 [部署记录](cloud-deployment-validation.json)；WebView2 真实账户、原生完整往返、双机和安装升级验收仍待完成。
