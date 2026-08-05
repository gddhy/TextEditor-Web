# web-editor 项目长期笔记

## PWA WCO 让位模式
- **`env(titlebar-area-width)` 不是系统控件宽度**：WCO 规范里它表示标题栏**可用区域**宽度（左侧可绘制内容的宽度）。右侧系统控件实际占用宽度 = `100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,100vw)`。当 WCO 未启用时，titlebar-area-width 回退 100vw，公式自然得到 0。
- **appbar 全局让位**：`padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + env(safe-area-inset-right, 0px))`。
- **JS 测量 `--wco-right`**：`getTitlebarAreaRect()` 返回的也是可用区域 rect，系统控件宽度 = `window.innerWidth - rect.right`（不是 `rect.width`）。把这个值写到 `:root {--wco-right}`，供 `.diff-bar::after` 等子组件做弹性末位占位。
- **fixed 全屏容器不能全靠 `env()`**：`.diff-view` 是 `position:fixed; inset:0;`，内部 `.diff-bar` 用 JS 测量的 `--wco-right` 做末位占位，只推最右侧按钮、不动左/右面板对齐位置。
- **颜色匹配**：appbar 背景主动用 `#6750A4` 匹配 OS 实际绘制的 `theme_color`；暗色 WCO 下 appbar 变黑 `#1D1B20`；保存按钮 dirty 态在紫/黑底上用琥珀色 `#FFB300` 保证可识别。文本对比的 `.diff-bar` 也要跟随主 appbar：WCO 亮色 `#6750A4`、WCO/普通窗口暗色 `#1D1B20`，子元素（diff-side/diff-sel/diff-btn）改用高对比 surface 色。
- **拖拽与点击**：WCO 标题栏区域默认会被浏览器当作拖拽区，因此 `.diff-bar` 需加 `-webkit-app-region: drag`；其内部的按钮、下拉框、面板必须加 `-webkit-app-region: no-drag`，否则点击事件会被系统拖拽逻辑吞掉。
- **diff 右侧操作栏对齐 + 交换/关闭按钮防裁剪**：普通浏览器与 PWA WCO 需求不同，分别用 grid / flex 两套布局。
  - HTML 结构：`.diff-bar` 内包含 `.diff-left-area`（标题+左侧操作栏）、`.diff-right-area`（仅右侧操作栏）、`.diff-actions`（交换/关闭按钮），旧 `.diff-spacer` 不再使用。
  - 普通浏览器：`display: grid; grid-template-columns: calc(50vw - 7px) minmax(0, 1fr) auto; gap: 0; padding: 8px 0;`。第 1 列宽度≈下方左侧 Monaco 编辑器宽度，使第 2 列（右侧操作栏）左边缘与下方右侧编辑器文本区左边缘对齐；第 3 列 `auto` 固定容纳交换/关闭按钮，交换/关闭在 appbar 最右侧。
  - PWA WCO：`display: flex; gap: 0; padding: 8px 0;`。
    - `.diff-left-area` 固定 `calc(50vw - 7px)`，使右侧操作区起始位置与下方右侧编辑器对齐；
    - `.diff-right-area` 正常流排列，`.diff-actions` 紧跟其后，视觉上交换/关闭属于右侧操作栏组；
    - 末尾 `.diff-bar::after` 伪元素占位，宽度 `calc(var(--wco-right, 0px) + 160px)`，把整组推离系统最小化/最大化/关闭按钮区域；160px 安全边距覆盖部分 Chromium 在 PWA 全屏时 JS 测量值偏小的问题。
  - 右侧操作区内部让 `.diff-sel` 可收缩（`flex:1 1 auto; min-width:60px`），窄窗口优先压缩下拉框而非挤出按钮。

## 标签栏/appbar 布局（易踩坑）
- 主 appbar（新建/打开/保存等）与 tabbar（文件选项卡）在 `.app` 网格里是**两条独立行**（grid-template-rows: `var(--appbar-h) auto 1fr var(--status-h)`），互不绑定。
- **关键：`.app` 的 grid 列必须显式写成 `minmax(0, 1fr)`**。默认不写列时 `1fr` 等价于 `minmax(auto, 1fr)`，当 appbar 内部内容的 min-content 总宽超过容器时，整列会基于内容撑开，appbar 实际宽度超出视口，右侧按钮被溢出裁剪。
- **tabbar 内部**是 flex 行：`.tabs`(flex:1 滚动容器) + `.tab-add`(新建标签页按钮)。
  - 经典 flexbox 陷阱：`.tabs` 必须有 `min-width:0`（或 `flex:1 1 0`），否则默认 `min-width:auto` 不让它收缩，内部 `.tab`(`flex:0 0 auto`) 撑大 `.tabs`，把 `.tab-add` 顶出窗口。
  - `.tab-add` 必须 `flex:none`，永远固定留在 tabbar 最右；`overflow-x:auto` 让标签滚动，纵向滚轮转横向滚动的 `wheel` 监听在 app.js ~L320 已有。
- **appbar 在 WCO/窄窗口下别被挤出**：
  - `.app` 的 grid 列必须显式写成 `minmax(0, 1fr)`，防止 appbar 内容撑开整列。
  - `.appbar` 用 flex：`display:flex; min-width:0; overflow:hidden;`。
  - **布局优先级**：左侧菜单+图标+标题必须始终可见，右侧操作按钮在极端窄窗口下允许被裁剪。
    - `.appbar-lead` 用 `flex: 0 0 auto;` —— 左侧整体固定不收缩，避免被 WCO 占位/右侧按钮挤到 0 宽度而被 `overflow:hidden` 裁剪。
    - `.appbar-brand` 用 `flex: 0 0 auto; max-width: 220px; min-width: 120px; overflow: hidden;`，保证品牌区至少能放下图标+约 4 个汉字。
    - `.brand-name` 用 `flex: 1 1 auto; min-width: 4em; overflow: hidden; text-overflow: ellipsis;` —— `min-width: 4em` 是关键，防止 `overflow:hidden` 的文本在 flex 收缩时被压到 0 而完全消失。
    - `.appbar-actions` 用 `flex: 1 1 auto; min-width: 0; overflow: hidden;` —— 右侧占据剩余空间，空间不足时由右侧被裁剪。
  - **不要在小屏幕 media query 里把 `.brand-name` 直接 `display:none`**。之前 `@media (max-width: 720px) { .brand-name { display: none; } }` 导致 PWA/小窗口下标题文字消失；应改为 `max-width: 120px` 截断，保留文字可见。
  - **WCO 小窗口下可隐藏菜单已覆盖的次要按钮**（如 `#btnNew`、`#btnDownload`），避免操作栏被系统占位挤出；普通浏览器窗口保持原按钮布局。
  - WCO 图标色必须限定在 `.appbar .icon-btn`，不要把 tabbar 里的 `.tab-add` 也染成白色。

## SW 更新策略
- 每次改 CSS/JS/HTML 必须 bump `VERSION`，否则已装 PWA 不会拉新缓存。
- `sw.js` 自身必须走 network-first，避免旧 SW 把 `sw.js` 也缓存掉导致永远不能升级。
- 新 SW activate 后给所有 clients 发 `SW_UPDATED`，`app.js` 收到后自动 reload 一次（sessionStorage 去重）。
- **SW_UPDATED 自动 reload 必须非破坏性**：已打开文件(`Ed.docs.length>0`)/正在打开(launchBusy)/有待处理(pendingLaunch) 时**禁止**强制刷新，否则 launchQueue 只投递一次的文件会被 reload 冲掉（表现=「概率装好 PWA 后双击文件却进空页面」）。此时只弹「立即刷新」提示。

## 文件关联(PWA file_handlers)要点
- `setupLaunchQueue` 判断是否有文件要用 `!!(params.files && params.files.length)`，不要再依赖 `'files' in LaunchParams.prototype`（个别浏览器为 false，会把文件启动误判成快捷方式 targetURL，导致不打开任何文件）。
- 文件选择器用 `{accept:{'*/*':[]}}` 放开全部文件，二进制判断交给打开后 `Encoding.isBinary` + 确认框。

## Monaco / 文本对比
- 当前版本 0.53.0（阿里云/淘宝镜像）的 min 产物为**扁平 + 内容哈希**结构，没有 `base/worker/` 目录；worker 预热不能写死 `workerMain.js`。
- `prewarmWorker()` 应优先使用 `MonacoEnvironment.getWorker()` 让 Monaco 自己解析正确路径，旧版再回退固定路径。
- 差异计算在 worker 里，首次冷启动会慢；启动空闲期跑 `prewarmDiff()` 预热真实 diff 编辑器。
- Monaco 0.53 的 diff 结果读取用 `getLineChanges()` 仍可用，只是未算完时返回 `null`（不要当空数组处理）。
- 大文件 diff 避免重复计算：`batchDiffUpdate()` 先 `setModel(null)`，改完两侧再挂模型，只算一次。

## CSV/TSV 表格预览
- 预览类型识别在 `previewMode(doc)` 中，`.csv` / `.tsv` / `.tab` 返回 `'csv'`。
- 预览复用 Markdown 的 `#preview` 文章容器，通过 `className='markdown-body csv-view'` 切换为表格样式；切换回 Markdown/HTML 时必须把 `className` 重置回 `'markdown-body'`。
- 解析器走 RFC 4180 风格：支持引号包裹、字段内逗号/换行、`""` 转义；按扩展名自动选择分隔符（`.tsv/.tab` 用 Tab，其余用逗号）。
- 渲染限制：最多渲染 2000 行，避免超大 CSV 拖垮 DOM；首行作为表头并 sticky 置顶；空单元格用 `—` 占位。
- 滚动同步：CSV 表格仍在 `#preview` 容器内滚动，复用编辑器滚动比同步逻辑。
