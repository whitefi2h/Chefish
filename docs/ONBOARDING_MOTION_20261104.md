# 初始化动效与启动页 · 2026-11-04

在已确认的 600px 固定宽度、552px 最大高度内调整动效，正文可独立滚动，底部操作固定。未改动偏好识别、存储、账户和管家调用。

| Before | After | Why |
| --- | --- | --- |
| 切页直接替换，整块横移 12px | 旧内容 120ms 淡出并移动 4px，新标题与表单以 35ms 间隔、340ms 轻移 6px 进入 | 保留阅读接续，减少突兀位移 |
| 切页时底部按钮短暂禁用变淡 | 过渡期间使用 inert 拦截输入，保留按钮外观；真实保存仍显示忙碌状态 | 消除切页闪烁并防止连续跳步 |
| 进度段直接换色，完成符号快速弹出 | 进度从左轻推填充；完成圆环、勾线、摘要分层接续 | 反馈更柔和，正文不循环晃动 |
| 启动时顶端横向大卡片 | 居中热汤碗、顶部小品牌、下方读取状态；蒸汽以 2.8 秒周期轻缓起伏 | 用厨房相关图形表达等待，避免空白表单感 |
| 读取状态使用 alert | 读取使用 status，失败才用 alert，并提供重试 | 区分等待与异常 |

保持 Logo 图形不变。加载动效只在实际等待读取时运行，不增加最短等待时间，不显示虚假百分比。重试期间回到读取状态，读取成功即进入原应用。键盘触发的切页不播放位移动画；系统减少动态效果设置关闭 CSS/WAAPI 动画。

## 检查与证据

- 浏览器：7 项检查覆盖初始化跳过/重开、原有保存调用、失败保留输入、AI 部分字段识别、五尺寸固定外框、启动失败重试、减少动态效果及键盘切页。
- 启动页检查：571×400、1000×700、1920×1080 无整页溢出。加载时间由合成 IPC 门控，仅用于检阅，不进入生产代码。
- 40 张五尺寸逐页截图继续由现有 compact setup 用例生成；新增 [启动页](screenshots/onboarding-motion/1000-startup.png)、[加载失败](screenshots/onboarding-motion/startup-error.png)、[完成页](screenshots/onboarding-motion/finished.png)。
- [动效录像](screenshots/onboarding-motion/walkthrough.webm)：1000×700 浏览器合成厨房，包含加载呼吸、前进、返回、偏好两页、键盘切页和完成反馈。
- Windows WebView2：单独 identifier `com.chefish.onboardingqa` 检阅版确认欢迎、模型及描述页切换与外框。854×534 CSS 视口、DPR 1.71875，外框 600×494.1px（高度受视口上限约束），欢迎/描述外框一致，正文无溢出。见 [原生欢迎页](screenshots/onboarding-motion/native-welcome.png)、[原生描述页](screenshots/onboarding-motion/native-description.png)。此原生检阅在最终消除底部按钮变灰的小修前进行；最终小修以浏览器录像及回归验证。
- 无真实模型/注册/生产数据写入验收，无安装覆盖、提交、推送或 Release 更新。正式交付重新使用生产 identifier 打包，检阅版不作为交付 EXE。

交付检查：最终 `npm run tauri -- build --bundles nsis` 退出码 0，TypeScript/Vite 与 Rust release 构建成功，NSIS 为 42.19 MiB。路径为 `E:\Chefish\src-tauri\target\release\chefish.exe`、`E:\Chefish\src-tauri\target\release\bundle\nsis\Chefish_2.0.0_x64-setup.exe`。最终浏览器回归 7 passed；隔离检阅进程已退出，个人进程未主动关闭。

## 后续修正：柔和节奏与切页闪回

| Before | After | Why |
| --- | --- | --- |
| 旧页淡出完成便取消动画，再请求 React 替换内容 | 保留淡出末帧，新页提交后在 layout effect 中取消旧动画并开始进入 | 防止取消动画恢复旧内容，在替换前闪回一帧 |
| 弹窗在 passive effect 中打开，整窗 160ms 淡入叠加正文进入 | 弹窗在绘制前打开；初始化外框不作透明度动画，只对正文分层进入 | 避免外框透出背景以及初次打开的重复动画 |
| 120ms 退出、340ms 进入，移动 4–6px | 180ms 退出、520ms 进入，移动 2–3px，分层间隔 45ms | 节奏舒缓，减少突然抽走和弹入的感觉 |
| 标题的程序焦点有时继承全局橙色边框 | 非操作标题不画焦点框，保留控件键盘焦点 | 避免标题突然出现橙框；保留读屏定位与键盘操作 |
| 完成反馈 380–650ms | 圆环 850ms、勾线 650ms、摘要 520ms；进度填充 560ms | 完成反馈与新的切页节奏一致 |

验证：新增切页生命周期回归在修改前失败，捕获到取消动画时仍是旧标题；修改后通过。初始化共 8 项通过，另有设置持久化、设置尺寸与键盘导航、库存抽屉焦点共 3 项通过。补充标题焦点修正后，针对闪回与完整录像的 2 项再次通过，TypeScript/ESLint 与正式 EXE/NSIS 构建通过。

更新后的 [浏览器录像](screenshots/onboarding-motion/walkthrough.webm) 使用合成厨房。隔离 Windows WebView2 检查 [描述页](screenshots/onboarding-motion/native-soft-description.png) 与 [核对页](screenshots/onboarding-motion/native-soft-review.png)，854×534 CSS 视口、DPR 1.71875，外框均为 600×494.1px。此次原生截图早于最后的标题焦点样式修正；该修正以浏览器回归验证并包含在正式构建中。静态原生截图仅证明布局，闪回时序由生命周期回归和浏览器录像佐证。业务调用、数据与初始化步骤未修改。
