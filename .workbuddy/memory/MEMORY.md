# web-editor 项目长期笔记

## PWA WCO 让位模式
- **appbar 全局让位**：`padding-right: calc(env(titlebar-area-width,0px) + env(safe-area-inset-right,0px))`。
- **fixed 全屏容器不能全靠 `env()`**：`.diff-view` 是 `position:fixed; inset:0;`，内部 `.diff-bar` 用 JS 把 `getTitlebarAreaRect().width` 写到 `:root {--wco-right}`，再用 `.diff-bar::after` 做弹性末位占位，只推最右侧按钮、不动左/右面板对齐位置。
- **颜色匹配**：appbar 背景主动用 `#6750A4` 匹配 OS 实际绘制的 `theme_color`；暗色 WCO 下 appbar 变黑 `#1D1B20`；保存按钮 dirty 态在紫/黑底上用琥珀色 `#FFB300` 保证可识别。文本对比的 `.diff-bar` 也要跟随主 appbar：WCO 亮色 `#6750A4`、WCO/普通窗口暗色 `#1D1B20`，子元素（diff-side/diff-sel/diff-btn）改用高对比 surface 色。
- **拖拽与点击**：WCO 标题栏区域默认会被浏览器当作拖拽区，因此 `.diff-bar` 需加 `-webkit-app-region: drag`；其内部的按钮、下拉框、面板必须加 `-webkit-app-region: no-drag`，否则点击事件会被系统拖拽逻辑吞掉。

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
