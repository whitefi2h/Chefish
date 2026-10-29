# Chefish

**收好菜谱，记住食材，安排每天的一餐。**

Chefish 是一款 Windows 厨房管理应用。把喜欢的做法收进菜谱库，看看冰箱里还剩什么，排好一周菜单，再按缺口去买菜。做完饭，写下实际用了什么，库存也会随之更新。

**目前主要面向中文用户，应用界面和 AI 助手以中文为主。**

v2.0.0 加入了主动式厨房管家：周末和你商量下周吃什么，平时整理厨房信息，再找几道值得试的新菜。你决定安排，它承担重复的整理工作。

[下载 v2.0.0](https://github.com/whitefi2h/Chefish/releases/tag/v2.0.0) · [English](#english) · [开发文档](docs/README.md) · [版本记录](CHANGELOG.md)

![Chefish 每周菜单与厨房助手](docs/images/assistant-proposal.png)

*菜单与 AI 提案界面，使用演示数据。*

## 收藏想做的菜

看到下厨房里喜欢的做法，贴入链接就能整理成菜谱，连同封面、步骤图和原作者信息一起保存。也可以自己写菜谱，或导入 JSON、网页 HTML。

菜谱可以分类、收藏，加入周灵感。人数一改，配料用量跟着调整。做过之后写几句手记，记下这次的火候、口味和下次想改的地方。配方修改会留下版本，旧做法随时能翻出来看。

## 记住冰箱里有什么

同一种食材可以按不同购买批次记录，各自保留数量、存放位置和到期日期。冷藏、冷冻、常温分开查看，快到期的食材会出现在首页提醒中。

盐、糖、生抽这些常备调料单独放在侧栏。缺了就点亮感叹号，补齐后再点一下；缺货调料会一起出现在采购提醒里。

## 排好一周，少想几次“今天吃什么”

把菜谱拖进周历，一餐可以安排多道菜，也能调整人数、移动到别的日子。周末想做得丰盛一点，工作日想省些时间，都可以提前排好。

采购清单会根据菜单用量和现有库存算出还缺什么。买菜时可以补记临时想买的东西，确认购买后直接入库。

做好一餐，直接写下“韭菜和鸡蛋全部用完”或“鸡肉用了 200 克，蘑菇用了一半”。AI 按库存单位整理实际用量，优先采用你的明确描述；“少许”等模糊用量才参考菜谱和人数估计。确认完成后扣减库存，也可以展开手动调整。

## 让管家提前想一想

在左下角「我的厨房 → 厨房管家」开启主动服务，选择常做餐次、任务时间和通知方式。升级后默认关闭，由你决定是否启用。

**每周菜单，一起商量。** 管家询问下周想吃什么、哪几天不在家，再结合菜谱、库存和偏好生成草稿。你可以继续说“周三简单一点，周五想吃牛排”。草稿跨天、跨重启保留，核对菜单与采购需求后再确认保存。

**厨房信息，日常整理。** 管家检查新增、修改的数据，自动补充分类、标签和图片；在允许估计时补充缺失库位与预计复查日期。你明确填写的信息优先，预计复查不等于包装有效期。整理结果可查看、修正或按批撤销，只有必要的问题才集中询问。

**新菜灵感，按需推荐。** 根据已有菜谱、库存和偏好寻找下厨房做法，排除已有来源与明显重复的菜式。推荐附来源和理由，读取原文、整理并确认后才收进菜谱库。

任务直接显示为助手里的横幅，点击进入独立会话。处理完的任务移入历史，历史会话保留 30 天；未处理的菜单草稿继续保留。各项任务和通知可以分别关闭，免打扰会暂停全部主动任务，手动聊天仍可使用。

管家需要程序运行。启用管家或开机自启动后，关闭窗口会留在托盘；双击图标可打开，右键菜单可设置开机自启动或彻底退出。关机、睡眠和程序退出期间不执行任务。

更多细节见[厨房管家说明](docs/STEWARD.md)。

## 让厨房助手帮忙

不用每次都找按钮，也可以直接说：

> 帮我找三种下厨房的番茄炒蛋做法。
>
> 把第二个整理进菜谱。
>
> 用现有菜谱安排周末晚餐，两个人，别重复。
>
> 蒜和鸡翅都买了，帮我勾掉。

助手能查询菜谱和库存、安排菜单、记录购买、修改配方、整理分类和手记。聊天中的业务修改先展示提案：看清菜名、日期、人数和补购内容，点同意就执行；不满意可以继续聊，让它改。主动整理则按设置中的权限自动执行，并保留结果和撤销入口。

聊天记录自动保存在本机，关掉窗口后还能接着说，也可以手动清除。模型支持 DeepSeek、OpenAI 和 Gemini，在助手设置里填入自己的 API 密钥和模型名称即可使用，调用费用按所选服务计收。DeepSeek 是目前主要开发和实测的服务。配置与使用见 [AI 助手说明](docs/ASSISTANT.md)。

## 下载与使用

1. 下载 [v2.0.0 Windows x64 安装包](https://github.com/whitefi2h/Chefish/releases/download/v2.0.0/Chefish_2.0.0_x64-setup.exe)，运行并按提示安装。系统需要 WebView2 运行环境。
2. 首次打开时菜谱库为空。先录入一道菜，或记下家里现有的食材，就可以开始安排菜单。
3. 想用 AI 时，在「我的厨房 → AI 助手」配置模型；想让管家主动服务，再到「厨房管家」中开启。

[Release 页面](https://github.com/whitefi2h/Chefish/releases/tag/v2.0.0)也提供独立 EXE。升级前可在「我的厨房 → 数据与备份」保存一份本地备份。

手动管理菜谱、库存和菜单不需要配置 AI。使用厨房助手时，相关对话和厨房信息会发送到你选择的模型服务；API 密钥保存在 Windows 凭据管理器。菜谱、库存和聊天记录保存在本机。

应用提供可选账户、云备份与多设备同步。菜谱、图片、库存和正式菜单可以同步，聊天、管家任务与未确认草稿留在本机。**v2.0.0 的云端兼容规则尚待部署，暂不能把本版云同步视为已就绪。** 云端状态、首次连接和冲突处理见[同步说明](docs/CLOUD_SYNC.md)。本地功能可独立使用。

想了解后续计划，可以看 [路线图](docs/ROADMAP.md)。

## 从源码运行

需要 Windows、Node.js / npm、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2。

```powershell
npm ci
npm run tauri dev
```

构建 Windows 安装包：

```powershell
npm run tauri build -- --bundles nsis
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。只看浏览器演示可运行 `npm run dev`；演示使用独立样例数据，刷新后重置。

技术栈：Tauri 2 · React · TypeScript · SQLite。

---

## English

**Your recipes, pantry and weekly meals, together.**

Chefish is a Windows app for keeping recipes, tracking groceries and planning meals. Save a dish you want to try, check what is already in the fridge, plan the week and take the shopping list with you. The kitchen assistant can help with each step.

**The app interface and AI assistant are Chinese-first.**

[Download v2.0.0](https://github.com/whitefi2h/Chefish/releases/tag/v2.0.0)

### Keep your recipes

Import a Xiachufang link with its cover, step images and author details, write your own recipe, or import JSON and HTML. Organize recipes into categories, save favorites and adjust ingredient amounts by serving size.

Cooking notes give you a place to record what worked and what you would change next time. Recipe edits keep their history, so you can return to an earlier version.

### Know what is in the kitchen

Track separate batches of the same ingredient, including quantity, storage location and expiry date. The home screen highlights food that needs attention.

Common seasonings have their own sidebar. Tap the alert icon when something runs out and tap again after restocking. Missing seasonings appear in shopping reminders.

### Plan meals and shop for what is missing

Drag recipes onto the weekly calendar, add several dishes to a meal and adjust servings. The shopping list uses your plans and pantry stock to work out what you still need.

Add extra groceries as you shop. Confirming a purchase receives it into the pantry. After cooking, describe what you actually used. Explicit amounts and statements such as “used all the eggs” take priority over recipe estimates. Review or adjust the quantities before confirming consumption.

### A kitchen steward that plans with you

Version 2.0.0 adds an opt-in steward for weekly menu planning, routine kitchen data maintenance and new recipe suggestions. Discuss a draft, change individual meals, then review the menu and shopping needs before saving. Unfinished menu drafts survive restarts.

Tasks appear as compact banners, each opening a separate conversation. Completed tasks move to history, retained for 30 days; pending menu drafts remain available. Task schedules and notifications are configurable. Do Not Disturb pauses proactive work while leaving manual chat available.

The app must be running for scheduled work. With the steward or autostart enabled, closing the window keeps it in the tray. Double-click the tray icon to reopen it; use the context menu to toggle Windows autostart or quit. Enable the steward in the kitchen settings when you are ready to use it.

### Ask the assistant

Search for recipes, organize a selected result, plan dinner, record purchases or edit your collection through conversation. Changes requested through chat are shown as proposals for approval. Approve one, reject it or explain what you want changed. Routine maintenance runs under the permissions you enable and provides a record with undo controls.

Chats are saved locally so you can pick up where you left off. DeepSeek, OpenAI and Gemini are supported through the assistant settings. Bring your own API key and model ID; provider charges apply. DeepSeek is the primary development and live-tested provider.

### Get started

Download the [Windows x64 installer](https://github.com/whitefi2h/Chefish/releases/download/v2.0.0/Chefish_2.0.0_x64-setup.exe) and follow the setup steps. WebView2 is required. Start by adding a recipe or recording pantry stock, then configure AI in the kitchen settings if you want to use it. The Release page also includes a standalone EXE.

Manual recipe, pantry and planning features work without AI. When using the assistant, relevant conversation and kitchen data are sent to your selected provider. API keys are stored in Windows Credential Manager; kitchen data and chat history stay on your computer.

Optional accounts, cloud backups and multi-device sync are included. Chats, steward tasks and pending drafts stay local. **The cloud compatibility rules for v2.0.0 are still awaiting deployment; cloud sync should not yet be treated as ready for this release.** See the [sync documentation](docs/CLOUD_SYNC.md) for status and setup. Local features work independently.

### Build from source

On Windows, install Node.js / npm, Rust MSVC, Visual Studio C++ Build Tools and WebView2, then run:

```powershell
npm ci
npm run tauri dev
```

Build the installer with `npm run tauri build -- --bundles nsis`. Output goes to `src-tauri/target/release/bundle/nsis/`. For a browser demo with sample data, run `npm run dev`.

[Project docs](docs/README.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)
