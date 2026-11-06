# 软件更新

入口为“厨房设置 → 关于 Chefish”。沿用既有设置分组、行布局、开关、字体与按钮，未新增侧栏顶层页面。

- 新版本提示默认开启：启动后、每六小时及恢复联网时检查公开 GitHub 最新稳定 Release。提示点击后进入更新区。
- 自动更新默认关闭。开启后会同时开启版本检查，自动下载并校验更新；由用户点击“重启并安装”后退出应用并安装，不在后台强制关闭。
- 手动检查、下载和安装入口始终保留。旧版 Release 没有签名更新清单时提供发布页手动安装入口，不运行未签名的远程安装包。
- 两个开关立即存入本机 WebView localStorage 的 `chefish:update-options`，不进入厨房同步或备份，也不需要点击“保存设置”。当前设置有未保存改动或备份忙碌时，安装按钮禁用。
- 更新检查失败显示重试信息，不阻止启动和厨房功能。下载完成的包由官方插件暂存在本次进程中；用户直接退出而不安装时，下次运行重新检查/下载。

## 更新来源与安装

项目：https://github.com/whitefi2h/Chefish

版本发现使用 `https://api.github.com/repos/whitefi2h/Chefish/releases/latest`。原生端使用 SemVer 比较版本，本地较新时不降级。可自动安装的 Release 需附带 `latest.json`，官方 Tauri updater 从固定 GitHub Releases 地址读取清单，下载后使用内置公钥验证签名，安装采用 Windows passive 模式。相关机制见 [Tauri updater 文档](https://v2.tauri.app/plugin/updater/)。

主要入口：`src/AppUpdates.tsx`、`src/services/appUpdater.ts`、`src-tauri/src/updates.rs`。不读取个人队列，不改变 Firebase 规则或数据库 schema。

## 本机构建与后续发布

运行 `npm run release:build`，生成 NSIS 安装包、同名 `.sig` 和 `latest.json`，均位于 `src-tauri/target/release/bundle/nsis/`。脚本从 CHANGELOG 当前版本段落提取更新说明。

签名私钥保存在当前 Windows 用户目录的 `.tauri/chefish-update.key`，公钥在 `src-tauri/tauri.conf.json`。私钥不在仓库，不打印到日志。应离线妥善备份该文件；未来版本必须继续使用同一密钥，不能为了构建成功另生成替代密钥。其他构建机器通过 `TAURI_SIGNING_PRIVATE_KEY` 与可选的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入密钥；不会写入仓库。普通 `tauri build` 也需要签名环境变量。

发布时创建对应 `v<version>` 的 GitHub Release，一并上传 `Chefish_<version>_x64-setup.exe`、`.exe.sig`、`latest.json`，将其标为最新稳定版本。必须一次准备完整后再发布，以免客户端看见缺失的清单。构建脚本不提交、不推送、不自动发布。

v2.3.3 的公开更新入口为 [GitHub Release](https://github.com/whitefi2h/Chefish/releases/tag/v2.3.3)，发布检查见 `release-v2.3.3.json`。v2.2.x 及更早版本没有软件内更新功能，需先手动安装 v2.3.3；v2.3.0 起可通过软件内更新。浏览器 fixture 与单元测试不等于用户电脑执行覆盖安装成功。
