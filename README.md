# Chefish

**好好吃饭，慢慢生活。 · A little planning, a better meal.**

把想做的菜、冰箱里的食材和下一次采购放在一起管理。Chefish 是一款本地优先的 Windows 厨房应用：收藏菜谱、安排每周菜单、核对食材缺口，也可以让 AI 将操作整理成提案，确认后执行。

**当前版本：v1.0.0。主要面向中文用户，界面、助手提示词和使用流程以中文为主；尚未提供英文界面。**

[中文](#中文) · [English](#english)

![Chefish 菜单与 AI 提案界面 / Meal planning and AI proposals](docs/images/assistant-proposal.png)

*界面示例使用合成演示数据；不包含用户厨房记录。 / Screenshot uses synthetic demo data, not personal kitchen records.*

## 中文

### 从一道菜到一顿饭

- **我的菜谱**：手动创建、JSON / 下厨房链接 / HTML 导入；保存来源、封面和步骤图，支持分类、收藏、配方版本与厨房手记。
- **食材库存**：按批次记录数量、库位、购买日期与到期日；支持使用、丢弃、校正、转移和受后续操作保护的撤销。
- **常备调料**：与普通食材分开管理。点击感叹号标记缺货，再点取消；缺货项优先显示，并在首页和采购清单提醒。
- **每周菜单**：跨周安排、一餐多菜、拖拽移动、调整人数；菜单引用安排时的配方版本，后续编辑菜谱不会悄悄改变旧计划。
- **采购与烹饪**：根据菜单和可用库存计算缺口；常规购买确认后同时入库。完成烹饪时核对实际用量，再记录库存消耗。
- **厨房助手**：搜索和整理下厨房菜谱，查询本地数据，提出菜单、库存、采购、菜谱、分类和手记的修改方案。聊天自动保存在本机，可手动清除。

安排菜单和写手记不会扣库存。AI 提案在你点击同意前不会执行；删除、丢弃等操作还要求额外确认。

### 开始使用

目前以源码构建运行，尚未交付经过验收的安装器或自动更新功能。

在 Windows 上准备 Node.js / npm、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2，然后运行：

```powershell
npm ci
npm run tauri dev
```

构建桌面可执行程序：

```powershell
npm run tauri build -- --no-bundle
.\src-tauri\target\release\chefish.exe
```

第一次启动为空菜谱库。只想看看界面，可以运行 `npm run dev`，打开终端显示的本地地址（通常是 `http://127.0.0.1:5173`）。浏览器使用独立的演示数据和固定日期，刷新会重置；真实持久化能力请在 Windows 桌面版中使用。

### 配置 AI

打开「厨房助手 → 设置」，选择服务，填写自己的 API 密钥和模型名称，再测试连接。

- **DeepSeek** 是当前主要开发和实测服务。
- **OpenAI、Gemini** 已提供配置与调用适配，不代表所有模型均已完成真实账号验收。
- 密钥保存在 Windows 凭据管理器，不随项目发布，也不写入业务数据库。
- AI 为可选功能；未配置模型或离线时，手动菜谱、库存、菜单和采购仍可使用。

可以这样说：

> 用现有菜谱安排周末晚餐，两个人，尽量不重复。
>
> 帮我在下厨房找三种番茄炒蛋，再整理第二个。
>
> 蒜和鸡翅都买了，帮我勾掉。
>
> 这批大蒜放冷藏，按常见情况估计一个复查日期。

助手结合实际批次、菜单和采购项目生成提案；缺少关键信息时会询问，明确授权估计的日期会附带假设和依据。

### 数据与隐私

业务数据位于 `%APPDATA%\com.chefish.desktop\chefish.sqlite3`。当前开发版与 release 共用该目录，替换程序文件不会主动清空数据库。

本地优先不等于 AI 离线运行：使用助手时，相关对话和本地厨房上下文会发送到所选模型服务；下厨房检索、网页读取和图片下载也需要网络。聊天记录在本机保留。模型调用可能产生服务商费用。

公开仓库不包含个人数据库、聊天记录、密钥、导入的私人图片或本地测试截图。网页菜谱和图片的权利归原作者，导入保留来源，不构成对第三方内容的再许可。

### v1.0.0 的边界

- 备份恢复界面、完整数据导出、正式安装器和自动更新尚未提供。迁移前的内部数据库备份不能替代完整备份功能。
- 下厨房可能限流、拦截或返回不完整页面；提供 HTML / 正文回退，不保证所有链接都能自动读取。
- 站内搜索按取得的当前结果页做过人数排序，不宣称是全站人气排行榜。
- 小勺、适量和范围等用量保留原文，不凭空换算克数，也不自动参与精确采购和库存扣减。
- 食材别名匹配目前有限，长期饮食偏好和更长的连续操作流程仍需完善。
- 预计复查日期是管理提醒，不是核实的包装有效期。AI 提案仍需查看，不能保证所有自然语言请求都一次理解正确。

当前状态和下一步见 [开发文档](docs/README.md)。

## English

Chefish connects recipes, pantry stock, weekly meals and shopping in a local-first Windows app. Its AI assistant turns requests into reviewable proposals and applies changes after you approve them.

**Version: v1.0.0. Chefish currently primarily serves Chinese-speaking users. The interface, assistant prompts and workflows are Chinese-first; an English interface is not available yet.**

### What you can do

- Create and organize recipes; import JSON or Xiachufang pages; keep sources, cover and step images, recipe revisions and cooking notes.
- Track pantry batches, quantities, storage locations and dates; record usage, corrections, disposal and transfers.
- Manage common seasonings separately. Toggle a missing flag for replenishment reminders without tracking every spoonful.
- Plan multiple dishes per meal across weeks. Plans retain the recipe revision originally selected.
- Calculate shopping shortages from planned meals and stock. Normal purchase confirmation also receives food into inventory.
- Confirm actual consumption when completing a meal. Planning a meal or writing a note does not consume stock.
- Ask the assistant to search and organize recipes, inspect local data, and propose changes to meals, pantry, shopping, recipes, categories and notes.

Changes require approval in the proposal card. Destructive actions require an additional confirmation. Chat history is retained locally and can be cleared manually.

### Run from source

The supported target is Windows. Install Node.js / npm, the Rust MSVC toolchain, Visual Studio C++ Build Tools and WebView2, then run:

```powershell
npm ci
npm run tauri dev
```

To build the desktop executable:

```powershell
npm run tauri build -- --no-bundle
.\src-tauri\target\release\chefish.exe
```

The desktop starts with an empty recipe library. `npm run dev` starts a separate browser demo with fixed sample data and a fixed date; refreshing resets it. It does not replace the persistent desktop app. A validated installer and automatic updater are not included in this release.

### AI and data

Open the assistant settings, choose a provider, enter your API key and model ID, and test the connection. DeepSeek is the primary development and live-tested provider. OpenAI and Gemini adapters are included, but not every provider/model combination has been live-tested.

Credentials are stored in Windows Credential Manager. The business database is at `%APPDATA%\com.chefish.desktop\chefish.sqlite3`. Manual kitchen features work without an AI account. AI requests send relevant conversation and kitchen context to the selected provider; web search, page retrieval and image downloads require network access. Provider charges may apply.

The repository excludes personal databases, chat history, credentials, imported personal media and local test captures. Imported third-party recipes and images remain subject to their authors' rights.

### Current limits

Backup/restore UI, full export, a validated installer and automatic updates remain future work. Xiachufang may block or rate-limit access; HTML and pasted-text fallbacks are available. Search ordering reflects the fetched result page, not a global ranking. Free-form quantities are preserved rather than guessed into grams. Ingredient aliases and multi-step assistant workflows are still limited. Estimated review dates and AI proposals require human review.

### Development and verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:ui
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --bin chefish
```

Playwright uses Microsoft Edge. UI fixtures, backend tests and native live-model checks establish different things; see [Testing](docs/TESTING.md) for the release verification scope.

### Project guide

- [Current status / 当前状态](docs/STATUS.md)
- [Architecture / 技术结构](docs/ARCHITECTURE.md)
- [AI behavior / 助手行为](docs/ASSISTANT.md)
- [Roadmap / 后续方向](docs/ROADMAP.md)
- [Changelog / 版本记录](CHANGELOG.md)

Built with Tauri 2, React, TypeScript and SQLite. This repository is public; no project-wide license has been selected yet.
