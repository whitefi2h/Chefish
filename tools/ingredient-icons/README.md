# 食材头像索引与人工检阅

已接入应用的本地食材头像展示，未改变 AI 服务、数据库或库存计算，也未替换用户已有图片。

## 检阅与查询

打开 [本机检阅页](../../docs/ingredient-icon-review.html)，先看顶部彩色图标与文字头像混排，再按名称、别名、分类、来源及状态筛选。点击食材可比较候选及 32px 预览；每项详情都有文字兜底样式。

```powershell
# 在新检出目录恢复自定义许可 PNG 的本机缓存；已有文件会跳过
node tools/ingredient-icons/build.mjs fetch
node tools/ingredient-icons/build.mjs build
node tools/ingredient-icons/build.mjs query 泡打粉
node tools/ingredient-icons/build.mjs query 白玉菇
node tools/ingredient-icons/build.mjs search mushroom
node tools/ingredient-icons/build.mjs check
node --test tests/ingredient-icon-index.test.mjs
node tools/ingredient-icons/check-review.mjs
```

生成页内嵌预览，可通过 `file://` 离线打开；官方来源链接需要联网。生成页及自定义许可原 PNG 均为本机开发文件，不提交或发布为素材包。

## 选图约定

优先顺序：用户指定图片 → 精确彩色图形 → 允许的彩色类别图 → 文字头像。

`lookupIngredient(catalog, name, options)` 只按完整标准名或别名匹配。名称进行 NFKC、首尾空白和英文大小写归一化，不移除“酱”“粉”等语义字符。`searchEntries` 仅返回候选，不能把子串检索当成自动匹配。

类别代用首次从允许的类别候选中随机选择；传入 `existingIconId` 后复用该选择。调用方负责保存，函数不会操作厨房数据库。单次命令行没有持久存储，重复查询可能抽到不同图形，但同一次返回的 `iconId` 与 `avatar` 保持一致。

`resolveIngredientAvatar(catalog, name, { userImageUrl, existingIconId })` 返回 `image` 或 `text`。用户图片优先；其余复用同一选图逻辑。文字输出含 `label`、`background`、`color` 和完整名称。已收录但没有图片的食材直接使用文字，不为找图反复请求 LLM；未知或歧义名称仍返回 `needsLLM: true`，但展示层可以立即使用名称首字头像。本工具不调用模型。

文字头像采用名称首字（包括未收录食材）；旧 `avatarText` 字段只保留作历史参考。小头像字号为 18px，详情大头像为 40px。文字头像与图片共享尺寸和圆角；颜色按 `avatar.tones` 中的类别固定，未知类别使用中性灰绿。主头像加载失败时就地改为同尺寸文字，不移动行布局或更改已保存的选图。

`matchKind` 继续区分 `exact`、`category`、`pending`；最后一项在检阅页显示为“文字头像”，保留缺图记录，方便后续补图。不同食材共享图形不意味着库存或用途可合并。

## 许可和风格

- Fluent Flat：MIT；Twemoji 图形：CC BY 4.0。保留各自版权、许可和署名。
- SVG Repo 原有两个样例在原站授权复核前仍只供参考，不参与自动选择。
- Japaclip、いらすとや：已按 Chefish 非商用应用前提核对官方自定义条款，详见 `licenses/` 与 [补缺记录](ASIAN_SOURCES.md)。原图存入被忽略的 `resources/ingredient-icons/local/`，不直接随公共源码作为素材包再分发；后续正式应用分发按实际使用方式处理。
- IconPark、Free Classic 的线稿／粗描边样例已排除。旧研究 URL 保留在 `source-research.json` 供追溯，不显示为候选，也不参与随机选择。即使资产误被标成可选，`visualStyle: outline` 仍会被选图函数排除。

当前为 131 项食材、64 项精确图形、55 项类别代用、12 项文字头像。20 张新增彩色 PNG 覆盖原待补的 18 类，其中金针菇、面粉各有两组可比较素材。PNG 保留原格式，不伪装成矢量。

## 检阅记录

人工首选、认可状态和备注单独保存在 `chefish:ingredient-icon-review:0.1.0`。初次随机分配保存于 `chefish:ingredient-icon-assignments:0.1.0`；搜索、筛选、别名和重载复用它。版本键保持不变，保留既有记录；不再允许的候选不会成为显示首选。

“导出检阅记录”只导出选择与备注，“下载索引 JSON”只导出元数据，均不提供原 PNG 文件下载。当前查询结果显示原始索引及稳定分配，不把未合并的人工首选冒充正式默认。

验证覆盖随机候选、保存复用、用户图片优先、已知与未知文字兜底、线稿排除、图形加载失败、离线搜索、筛选、保存、导出及 390px 页面。测试使用隔离浏览器上下文，不读写个人厨房。

## 应用接入

Vite 开发启动和构建时通过 `prepare-app.mjs` 生成精简运行时索引与本地应用资源；类型检查前也生成索引。新检出目录先运行 `node tools/ingredient-icons/build.mjs fetch` 准备自定义许可原图缓存。生成目录不加入公共源码，安装包内包含应用展示资源和许可记录。

共享 `IngredientAvatar` 覆盖首页、库存、常备调料以及演示／原生采购列表。明确选择或上传的用户图片优先；旧版自动抓取的 Commons 照片默认改用本地彩色候选，类别候选首次随机分配后按食材身份保存在本机。图片失败时依次回落本地图形和固定配色文字头像，不更改食材记录。未知名称也使用首字，仅空名称显示“食”。

“设置 → 关于 Chefish”可查看素材作者与许可；库存详情也展示所用本地图形来源。后台自动网络照片补齐停止，用户显式“让 AI 换张图片”的操作仍保留。

旧 Commons 照片的默认展示已切换为彩色图标／文字头像；只有用户明确换图成功后才优先使用对应照片，原照片数据保留。
