# GenStudio 项目记忆

> 本文件存储项目特定的知识、踩坑经验和技术细节

## 📑 目录

- [GenStudio 专项开发规范](#genstudio-专项开发规范)
- [血泪案例（踩过的坑）](#-血泪案例本项目踩过的坑)
- [剪辑2 专项知识](#-剪辑2-专项知识)
- [任务中心设计原则](#-任务中心设计原则)
- [Electron 开发知识](#️-electron-开发知识)
- [FFmpeg 知识](#-ffmpeg-知识)
- [UI 常见问题](#-ui-常见问题)
- [🔍 搜索与定位技巧](#-搜索与定位技巧)

---


## GenStudio 专项开发规范

### 技术栈强制规范

- **Tailwind CSS**: 项目使用 Tailwind，禁止非必要 Vanilla CSS
  - ⚠️ 注意：`@/lib/utils` 中的 `cn()` 函数当前不可用，使用模板字符串拼接类名
  - 遵循 Utility-First 原则
- **组件库**: 优先复用 `radix-ui` 原语
- **Electron**: 使用 `preload.ts` 暴露的安全 API

### MCP 工具使用规则

| 工具           | 适用场景                         | 前端代码                                        |
| -------------- | -------------------------------- | ----------------------------------------------- |
| **Codex**      | 后端逻辑、配置修改、文件批量操作 | ❌ **禁止** — Codex 前端代码质量差，产出不可用   |
| **Gemini CLI** | 前端组件、CSS 样式、UI 逻辑      | ✅ 推荐 — 如需 MCP 辅助前端开发，使用 Gemini CLI |
| **手动编辑**   | 精确修改、小范围改动             | ✅ 首选 — replace_file_content / multi_replace   |


### "百万年薪" UI 设计标准

| 特征           | 实现方式                                                     |
| -------------- | ------------------------------------------------------------ |
| **磨砂与景深** | `backdrop-blur-xl`，`bg-zinc-900/40` 或 `bg-black/20`        |
| **高级质感**   | 极细微渐变 `bg-gradient-to-b`，1px 高光边框 `border-white/5` |
| **动态交互**   | Hover 态必须有，包括光晕、位移、ring 高亮                    |
| **主题色**     | Cyan (主色), Pink, Emerald                                   |
| **排版细节**   | 标题 `tracking-tight`，数据 `font-mono`                      |

### 环境感知

- **端口检测**: Dev server 端口自动分配（port: 0），从终端日志或 VITE_DEV_SERVER_URL 获取实际端口

---

## 🩸 血泪案例（本项目踩过的坑）

| 案例                                  | 错误做法                                                                                           | 造成的问题                                                                                                      | 正确做法                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **导出 vs 预览**                      | 预览用 A 渲染逻辑，导出用 B 渲染逻辑                                                               | 预览效果和导出不一致                                                                                            | 共用 PixiExportService                                                                                                                                                                                                                                                                           |
| **立即导出 vs 添加到队列**            | 各自拼路径、各自调用 API                                                                           | 路径格式不一致导致导出失败                                                                                      | 共用 `handleExportTask(config, autoStart)`                                                                                                                                                                                                                                                       |
| **outputPath 构建**                   | 对话框构建一次，渲染器再构建一次                                                                   | 路径被覆盖为目录，文件 0KB                                                                                      | 只在 ExportDialog 构建一次                                                                                                                                                                                                                                                                       |
| **导出尺寸丢失**                      | ExportDialog 的 buildFinalConfig 未传 `width/height`                                               | ExportWorker 使用默认 1920x1080，9:16 竖屏变成 16:9 横屏                                                        | **必须传递** `width: project.width, height: project.height`                                                                                                                                                                                                                                      |
| **Pixi 容器渲染顺序**                 | 只在 `parent !== container` 时才 `addChild`                                                        | 后创建的图片容器覆盖已存在的 overlay 容器，导致叠加层只在第一张图显示                                           | **每帧都 `addChild`**：Pixi 的渲染顺序由 addChild 顺序决定，后 add 的在上层                                                                                                                                                                                                                      |
| **concat demuxer + NVENC**            | 使用 `-f concat` 拼接视频                                                                          | 只有前 300 秒被编码，后续内容丢失                                                                               | 改用 `filter_complex concat`                                                                                                                                                                                                                                                                     |
| **z-index 嵌套**                      | 子元素设置高 z-index 如 z-50                                                                       | 受限于父容器的 z-index（如 z-10），被后续 DOM 遮挡                                                              | 需要在最顶层时，移到独立容器并设置该容器的 z-index                                                                                                                                                                                                                                               |
| **时间轴框选偏移**                    | Logic层未减去轨道头宽度(256px)，Render层却基于容器渲染                                             | 鼠标、框选框与逻辑选中区域三者错位                                                                              | **坐标系统一**：Logic层减去Header宽转为Content Space，Render层加回Header宽转为Screen Space                                                                                                                                                                                                       |
| **React 拖拽卡顿**                    | 在 `onMouseMove` 中 `setState` 更新样式                                                            | 大量组件重渲染导致明显卡顿                                                                                      | **直接 DOM 操作**：`useRef` 存值，`ref.current.style.transform` 更新样式，松开时同步 State                                                                                                                                                                                                       |
| **Props 重命名漏更新**                | 重命名 `inputPath` → `filePath` 后未更新父组件调用                                                 | 父组件传旧参数名，子组件收到 undefined                                                                          | **grep 搜索所有调用点**，逐一更新                                                                                                                                                                                                                                                                |
| **组件/图标/Hook 未导入**             | 在 JSX 中使用新的组件、图标或 Hook 但忘记导入                                                      | ReferenceError 白屏崩溃                                                                                         | **添加任何新引用后立即检查 import 语句**                                                                                                                                                                                                                                                         |
| **重构导致回调函数丢失**              | 重绘布局（如将 JSX 移动到 `DraggableCard`）时，使用 `() => {}` 占位或忘记重新映射逻辑              | 界面显示正常但功能按钮点击无响应，无任何报错，排查成本高                                                        | **重构必重连**：大规模调整 JSX 结构后，必须逐个对比原有的 `onClick` 指向，并在开发完成后进行核心路径验证。                                                                                                                                                                                       |
| **函数签名不同步**                    | 调用点传 3 参数，定义只收 2 参数                                                                   | 参数变量 undefined                                                                                              | 修改调用后**必须同步更新函数定义**                                                                                                                                                                                                                                                               |
| **ONNX 输入格式错误**                 | 将像素值归一化到 [0,1]（除以 255）                                                                 | TransNet 输出全 0，AI 检测失效                                                                                  | 集成第三方模型前**必读官方源码**确认输入格式                                                                                                                                                                                                                                                     |
| **Zustand Store TDZ 错误**            | 在 `create()` 回调中直接调用 `useXxxStore.setState()`                                              | "Cannot access 'useXxxStore' before initialization" 运行时崩溃                                                  | 使用 `setTimeout(() => init(set, get), 0)` 延迟初始化，或直接使用回调参数 `set/get`                                                                                                                                                                                                              |
| **Store 缺失导入**                    | 添加 `create<State>()` 但忘记 `import { create } from 'zustand'`                                   | "create is not defined" ReferenceError 白屏                                                                     | **添加 Zustand Store 后立即检查导入语句**                                                                                                                                                                                                                                                        |
| **常量未导入**                        | 使用 `DEFAULT_TITLE` 等常量但未导入                                                                | "DEFAULT_TITLE is not defined" 运行时错误                                                                       | 确保所有使用的常量都有对应的 import 语句                                                                                                                                                                                                                                                         |
| **PowerShell 文件编码**               | 使用 `Out-File` 或 `>` 重定向提取 Git 文件                                                         | UTF-16LE 编码导致中文乱码和 JSX 语法错误                                                                        | 使用 `git checkout <commit> -- <file>` 或 `cmd /c "git show ..."` 直接提取                                                                                                                                                                                                                       |
| **代码编辑 HTML 实体**                | 在 `replace_file_content` 中写 `=>、`<`、`>` 等符号                                                | 被转义为 `&gt;`、`&lt;` 导致语法错误                                                                            | 编辑后**立即 view_file 验证**，发现实体编码立即修复                                                                                                                                                                                                                                              |
| **Git 回退覆盖其他功能**              | `git checkout <commit> -- <file>` 恢复样式时，覆盖了同一文件的功能代码                             | 多选拖拽功能丢失 118 行逻辑代码                                                                                 | 回退前先 `git diff` 检查差异，回退后 **grep 搜索关键逻辑** 确认完整                                                                                                                                                                                                                              |
| **Base64 解码前缀**                   | `Buffer.from(base64, 'base64')` 直接解码带 `data:image/jpeg;base64,` 前缀的数据                    | 生成的文件损坏无法打开                                                                                          | 解码前**去除 data: 前缀**：`base64.includes(',') ? base64.split(',')[1] : base64`                                                                                                                                                                                                                |
| **ESM 中使用 require()**              | 在 Vite ESM 环境中使用裸 `require('onnxruntime-node')` 等                                          | `ReferenceError: require is not defined`                                                                        | **原生模块(.node)必须用 `createRequire`**：`import { createRequire } from 'module'; const _require = createRequire(import.meta.url); const ort = _require('onnxruntime-node');`。纯 JS 模块用 `import`/`await import()`。项目中 SherpaOnnxProvider、dwmApi、metadataHandler 均为标准参考         |
| **media:// Content-Type**             | 自定义协议返回固定 `application/octet-stream`                                                      | 浏览器无法渲染图片（显示空白）                                                                                  | 根据文件扩展名返回正确 MIME 类型（`.jpg` → `image/jpeg`）                                                                                                                                                                                                                                        |
| **随意修改工作代码**                  | 在优化时用 astats 过滤器替换原本工作的 PCM 采样方式                                                | 峰值数量减半，波形只显示一半                                                                                    | **不要动正常工作的代码**，除非有明确的性能问题和测试数据支撑                                                                                                                                                                                                                                     |
| **System IPC 返回值**                 | 直接使用 `await window.electron.invoke('app:get-path')` 的结果                                     | 某些情况返回空/失败，导致后续逻辑（如 `fs:ensure-dir`）崩溃                                                     | **必须判空**：`const path = await ...; if(!path) throw/return;`                                                                                                                                                                                                                                  |
| **scrollIntoViewIfNeeded 卡顿**       | 使用 `await element.scrollIntoViewIfNeeded()` 滚动到元素                                           | 在某些页面上导致 30+ 秒卡顿                                                                                     | **优先尝试不滚动**：直接用 JavaScript `dispatchEvent` 触发交互。只有确认元素不可见时才考虑滚动，且需设置超时                                                                                                                                                                                     |
| **继承类缺少 super()**                | 子类不定义 constructor，但父类 constructor 需要参数初始化                                          | `this.logger` 等父类属性为 undefined，日志无输出                                                                | 子类必须定义 `constructor() { super('Name'); }`                                                                                                                                                                                                                                                  |
| **Base64文件MIME映射**                | 直接用MIME subtype做扩展名（如 `audio/mpeg` 的 subtype `mpeg` 直接作为扩展名）                     | 文件保存为错误扩展名（`.mpeg` 而非 `.mp3`），第三方服务（如Gemini）拒绝上传                                     | **建立MIME映射表**：`{ 'mpeg': 'mp3', 'jpeg': 'jpg' }`，参考 [MDN MIME types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types)                                                                                                                          |
| **架构重复未清理**                    | 早期为特定能力硬编码 provider（如 `doubao2api`），后期建立通用系统（如 V3 自动化）但未删除旧代码   | 同一功能在界面上显示两次，用户困惑                                                                              | **新功能上线前 grep 搜索相似实现**，统一架构或删除遗留代码                                                                                                                                                                                                                                       |
| **路由逻辑只看前缀**                  | 视频分析路由只根据 channel 前缀判断（`provider-`），未检查 `providerType`                          | 本地自动化被错误路由到 API Provider，报"未配置 API Key"错误                                                     | **参考成熟模块**（如 chat 的 apiServer.ts），根据 `providerType` 区分：`automation` → 调用 `v3ScriptExecutor`，`api` → 调用 API Provider                                                                                                                                                         |
| **URL 未下载直接传递**                | 把视频 URL 直接当作文件路径传给脚本执行器                                                          | ENOENT 错误，文件找不到                                                                                         | 检查 `inputType`，如果是 `url` 先调用 `videoDownloadService.download()` 下载到本地                                                                                                                                                                                                               |
| **eval/AsyncFunction 中使用 require** | 在脚本字符串中调用 `require('fs')`                                                                 | `ReferenceError: require is not defined`                                                                        | 在执行器中提前 `import` 模块，作为参数传入 `AsyncFunction`                                                                                                                                                                                                                                       |
| **IPC 调用路径错误**                  | 使用 `window.electron.ipcRenderer.invoke()`                                                        | IPC 调用静默失败，功能不工作                                                                                    | **查看 preload.ts 确认暴露的 API 路径**：本项目使用 `window.electron.invoke()`                                                                                                                                                                                                                   |
| **Electron 原生模块编译失败**         | 使用 `npx @electron/rebuild` 编译                                                                  | 预编译版本不可用时编译失败，报 node-gyp 错误                                                                    | **用 prebuild-install 下载预编译**：`cd node_modules/<module> && npx prebuild-install --runtime electron --target <版本号>`                                                                                                                                                                      |
| **BrowserView 阻塞关闭**              | 在 `mainWindow.on('close')` 中直接调用 `executeJavaScript()`                                       | BrowserView 存在时 executeJavaScript 会阻塞，导致关闭按钮卡死                                                   | **先隐藏 BrowserView**：在 executeJavaScript 前调用 `EmbeddedBrowserManager.getInstance().hideAll()`                                                                                                                                                                                             |
| **await loadURL 阻塞**                | 使用 `await view.webContents.loadURL(url)` 等待页面加载                                            | 新标签页打开耗时 2-5 秒，用户感知卡顿                                                                           | 如果不需要等待页面内容，使用 `loadURL(url).catch(...)` 不等待，通过 `did-finish-load` 事件处理后续逻辑                                                                                                                                                                                           |
| **端口配置读取 undefined**            | 直接从 `manifest.service.port` 解构使用                                                            | 服务启动失败，`isPortInUse(undefined)` 报错                                                                     | **先读取用户配置**：`config.port                                                                                                                                                                                                                                                                 |                                                          | manifest.port                       |                                                          | 8000`，确保有兜底值                                                  |
| **Provider 列表顺序**                 | `setProviders([...providers, newProvider])` 添加到末尾                                             | 新服务商显示在列表最下方，不易发现                                                                              | 添加到数组**开头**：`setProviders([newProvider, ...providers])`                                                                                                                                                                                                                                  |
| **`                                   |                                                                                                    | undefined` 吞掉空字符串**                                                                                       | `nameCn: value                                                                                                                                                                                                                                                                                   |                                                          | undefined` 传参                     | 空字符串 `''` 被转为 `undefined`，后端无法识别"删除"意图 | **显式传递值**：直接传 `nameCn: value`，后端判断 `=== ''` 时执行删除 |
| **PowerShell JSON 多次读写数据丢失**  | 使用 `ConvertTo-Json                                                                               | Set-Content` 后再次读写                                                                                         | 某些对象被意外删除，JSON 结构被破坏                                                                                                                                                                                                                                                              | **单次操作 + 立即验证**：每次 JSON 修改后用 `Get-Content | Select-String` 验证关键数据是否存在 |
| **显示名称直接用 ID**                 | `displayName: providerId` 直接使用技术 ID                                                          | 用户看到 `custom-1767027707948` 等难以理解的标识符                                                              | **从数据源查找**：`providers.find(p => p.id === id)?.name                                                                                                                                                                                                                                        |                                                          | id`                                 |
| **V2/重构版本未清理**                 | 重构后保留旧文件（如 V2 后缀），实际只用新版本                                                     | 修改错误文件，功能不生效                                                                                        | **重构完成后删除旧文件并重命名 V2**：`grep_search` 确认旧文件无导入 → 删除旧文件 → 重命名 V2 去掉后缀                                                                                                                                                                                            |
| **NSIS 升级流程与 UserDatas 保护**    | (1) 在 `oneClick: false` 下用 `customInstallMode`；(2) 只在 `customRemoveFiles` 中保护 UserDatas   | (1) `customInstallMode` 仅 One-Click 有效；(2) 升级时跑的是**旧版卸载程序**，旧版没有保护逻辑则 UserDatas 被删  | **关键知识**：electron-builder NSIS 升级是「先运行旧版卸载器 → 再安装新版」，不是直接覆盖。UserDatas 保护需要**双保险**：(1) `customInit`（安装器侧，旧卸载器运行前 Rename）；(2) `customRemoveFiles`（卸载器侧，替换默认删除逻辑）。单独只做其中一个都不够。详见 `build/installer.nsh` 头部注释 |
| **日志路径硬编码**                    | 直接写死路径如 `process.cwd() + '/logs'` 或绝对路径                                                | 开发/生产环境路径不一致，日志分散                                                                               | **使用 `UserDataPaths.getLogsDir()`**：所有日志统一存放在 `UserDatas/Logs/`，渲染进程通过 `path:get-logs-dir` IPC 获取                                                                                                                                                                           |
| **扩展/工具路径分散**                 | 工具在 `resources/tools/`，扩展在 `resources/extensions/`，概念混淆                                | 代码需要维护多套路径查找逻辑，打包配置复杂                                                                      | **统一到 `UserDatas/Extensions/`**：所有扩展和工具都放在用户数据目录，使用 `ExtensionPathManager.getExtensionPath()` 统一访问（2026-01-20 迁移完成）                                                                                                                                             |
| **代码迁移只 return 不删除**          | 迁移 IPC 监听器时只加 `return` 屏蔽逻辑，不删除旧代码                                              | 重复注册监听器、内存泄漏、日志混乱、用户浪费大量调试时间                                                        | **完全删除旧代码**：迁移后必须彻底删除原实现，不能只屏蔽功能                                                                                                                                                                                                                                     |
| **悬浮 UI 事件穿透**                  | 注入的悬浮按钮未阻止 mouseover 事件穿透到下层元素                                                  | 按钮位置被反复重算，出现"飘动"现象                                                                              | **悬浮 UI 必须做事件隔离**：在 mouseover 事件开头检查鼠标是否在 UI 元素区域内，是则跳过处理                                                                                                                                                                                                      |
| **OAuth 授权后页面黑屏**              | OAuth 授权页面（如抖音）调用 `window.close()` 后，未处理 BrowserView 重建                          | 授权完成后 Modal 显示黑屏，用户无法点击确认登录                                                                 | **监听 destroyed 事件**：(1) 主进程 `webContents.on('destroyed')` 发送事件 (2) 前端 BrowserModal 监听事件后自动重建 BrowserView 并导航回初始 URL。详见 `BrowserModal.tsx` 头部注释                                                                                                               |
| **get-info 调用报 getURL 错误**       | OAuth 授权页面关闭后，BrowserView 的 webContents 被销毁，继续调用 `getURL()` 报错                  | 控制台大量 `Cannot read properties of undefined (reading 'getURL')` 错误                                        | **isDestroyed 检查**：`getCurrentUrl` 和 `getTitle` 方法中必须先检查 `webContents.isDestroyed()`，销毁后返回 null                                                                                                                                                                                |
| **Modal 中 BrowserView 黑屏**         | 设置面板等 overlay 增加了 overlayCount，导致 BrowserView 的 `show()` 方法返回 false                | Modal 打开时 BrowserView 无法显示                                                                               | **forceShow 参数**：`show(id, bounds, forceShow=true)` 在 Modal 场景下忽略 overlay 检查，强制显示                                                                                                                                                                                                |
| **destroy 中 loadURL about:blank**    | 在 `destroy()` 方法中使用 `loadURL('about:blank')` 来停止媒体播放                                  | BrowserModal 的轮询检测到 about:blank，误判为 OAuth 窗口关闭，意外触发 Cookie 获取弹窗                          | **不要在 destroy 中 loadURL**：使用 `stop()` + `setAudioMuted(true)` 即可。`webContents.destroy()` 本身会释放资源                                                                                                                                                                                |
| **onClose/onConfirmLogin 混用**       | AddAccountModal 中 `onClose` 和 `onConfirmLogin` 都指向同一个 `handleBrowserClose` 函数            | OAuth 流程、页面意外关闭等都会触发 onClose，导致意外获取 Cookie                                                 | **分离回调逻辑**：`onClose` 只返回选择页面（不获取 Cookie），`onConfirmLogin` 才获取 Cookie。只有用户主动点击确认才触发业务逻辑                                                                                                                                                                  |
| **模块数据模型不一致**                | 成品库用 `ProductType: 'dynamic'`，发布管理用 `ContentType: 'note'`；素材引用方式也不同            | 跨模块联动需要写转换函数，数据可能不同步（Product.publishRecords vs PublishPost.results）                       | **设计阶段统一数据模型**：跨模块共用数据时，类型命名、字段结构、关联关系必须在设计文档中统一规范。如已存在差异，创建 `xxxToYyy` 转换工具并记录映射关系                                                                                                                                           |
| **平台脚本兼容性**                    | 只针对单一页面 URL 或选择器                                                                        | 平台改版后脚本全部失效                                                                                          | **兼容多版本**：循环检测多种 URL 模式（如抖音 V1/V2 页面）；使用 `getByText`/`getByRole` 语义化选择器；参考 `social-auto-upload` 项目的健壮策略                                                                                                                                                  |
| **过滤时只看主条件**                  | `providers.filter(p => p.enabled)` 只检查启用状态                                                  | 服务商启用但没有符合条件的子数据（如只有图片模型），UI 仍然显示                                                 | **同时检查关联条件**：`providers.filter(p => p.enabled && p.models.some(m => isTextModel(m)))`                                                                                                                                                                                                   |
| **UI 使用 Emoji 图标**                | 在按钮/菜单中使用 🔒 等 Emoji 图标                                                                  | 不同系统/字体渲染不一致，不支持主题色变化                                                                       | **一律使用 SVG 图标 (lucide-react)**，禁止 Emoji                                                                                                                                                                                                                                                 |
| **硬编码暗色主题样式**                | Modal/滚动条只写 `bg-zinc-900` 暗色背景                                                            | 亮色主题下看不见或对比度差                                                                                      | **使用 CSS 变量或 theme 类**，确保亮色/暗色主题都适配                                                                                                                                                                                                                                            |
| **使用 app.getPath('userData')**      | 直接调用 `app.getPath('userData')` 获取路径                                                        | 路径不统一，跨平台/环境差异                                                                                     | **使用 `UserDataPaths` 工具类获取路径**                                                                                                                                                                                                                                                          |
| **createPortal 中使用 BrowserModal**  | 在 Modal 内用 `ReactDOM.createPortal` 渲染 `BrowserModal`                                          | BrowserView bounds 计算错误，标题栏和边框被覆盖不可见                                                           | **使用早返回模式**：在组件函数开头判断 `if (showBrowser) return <BrowserModal ... />`，参考 `AddAccountModal.tsx`                                                                                                                                                                                |
| **高频日志并发写入**                  | 每收到一条日志就调用 `fs:append-file` 写入文件                                                     | 多条写入并发执行，文件内容交错乱码，无法分析                                                                    | **批量缓冲写入**：用数组收集日志，`setTimeout` 200ms 批量写入一次。特别是 Worker `postMessage` 高频回传日志的场景                                                                                                                                                                                |
| **IPC 事件重复监听**                  | 多个组件各自监听同一 IPC 事件（如 `videoDownload:complete`），各自执行副作用（如入库）             | 同一操作被执行两次，产生重复数据（如素材库出现两份相同视频）                                                    | **单一职责原则**：同一 IPC 事件的副作用（入库、通知等）只在一个地方处理。其他组件只做 UI 更新，不执行业务逻辑                                                                                                                                                                                    |
| **双数据源 flush 覆盖**               | 后端 store 缺少部分字段（如 thumbnail），App.tsx flush 用 `INSERT OR REPLACE` 全量覆盖前端 DB      | 重启后封面/元数据丢失                                                                                           | **合并策略**：双数据源同步时，已存在的记录只更新状态字段（status/progress），保留原始元数据                                                                                                                                                                                                      |
| **前端删除未通知后端**                | 前端 `clearCompleted` 只删前端 DB 和内存，后端 store 内存中还保留着                                | 后端广播时将已删任务重新写回前端 DB，任务"复活"                                                                 | **双向同步**：前后端双 store 的增删操作必须通过 IPC 双向同步。删除任务时同时调用 `videoDownload:delete` 通知后端                                                                                                                                                                                 |
| **重构/重写文件前未查类型**           | 凭记忆重写代码，直接写返回值结构和 API 调用                                                        | 类型错误反复修 3 轮（SeparationResult、EngineStatus、FFmpegService API 全错）                                   | **重写任何文件前，先 view_file 查看所有用到的类型定义和依赖模块 API**                                                                                                                                                                                                                            |
| **拆分类方法时状态快照 bug**          | 用 `{ cancelled: this.cancelled }` 传值类型状态给提取出的函数                                      | 取消操作不生效：cancel() 修改的是 this.cancelled，子函数看到的是旧值                                            | **传 `this` 引用**（需配合 public 字段），或用 getter/回调函数传递实时状态                                                                                                                                                                                                                       |
| **批量替换后未验证全覆盖**            | 用 `AllowMultiple` 替换代码后没有 `grep_search` 确认无遗漏                                         | 遗漏的旧代码导致隐蔽 bug，音频轨静音波形变小排查 5 轮才找到                                                     | **批量替换后必须 grep 搜索旧代码关键词**，确认所有实例已被替换。特别注意不同时期添加的同类代码                                                                                                                                                                                                   |
| **检查方法内有副作用**                | `checkStatus()` 调用 `getDir()` 方法，后者内部 `mkdirSync` 自动创建空目录                          | 检查逻辑判定"已安装"（目录存在），实际目录为空；清理环境后 check 又重建了空目录                                 | **检查/状态查询方法禁止有副作用**：`checkXxx()` 方法只读取，不创建目录/文件。创建操作放在 `install()` 或 `ensure()` 方法中                                                                                                                                                                       |
| **共享资源用功能名命名**              | Python 依赖池目录叫 `demucs-libs`，后来 FunASR 也往里装包                                          | 名不副实，后续功能复用时混乱；最终涉及 7 文件 12 处全量重命名                                                   | **共享资源用通用名 + 集中管理方法**：如 `python-libs` 而非 `demucs-libs`。通过 `ExtensionPathManager.getPythonLibsDir()` 统一管理，含自动迁移旧目录逻辑                                                                                                                                          |
| **配置面板空间不足**                  | 在已满的配置面板中添加大尺寸选择卡片（mode-card）                                                  | 预览区域被挤掉，用户反复要求缩小                                                                                | **添加新 UI 区块前先评估剩余空间**：配置面板空间有限时，优先用紧凑样式（chip/tag），不要复用大卡片                                                                                                                                                                                               |
| **新功能只覆盖部分引擎**              | 模型选择只给 local-whisper 做了，没搜索其他引擎是否也有 getModels                                  | 用户指出 WhisperX 也有多模型，需额外修复                                                                        | **添加引擎相关功能前，grep 搜索所有 Provider 的同名方法**（如 `getModels`），确认覆盖范围                                                                                                                                                                                                        |
| **pip --target 不复用已有包**         | `pip install torch==2.5.1` 以为已安装的 `2.5.1+cu121` 会被识别为满足条件                           | 每个引擎安装时都重新下载 2.3GB PyTorch，用户等了几天                                                            | **PyTorch 版本号必须带完整本地标识符** (PEP 440): `torch==2.5.1+cu121` 而非 `torch==2.5.1`。pip 的 `==` 不匹配 local version。同时在 `runPythonPackageInstall` 预检 dist-info 作保底                                                                                                             |
| **多状态条件渲染未互斥**              | `{isA && (...)} {isB && (...)}` 各自独立判断                                                       | 多个状态同时为 true 时 UI 叠加显示（如 loading + completed 同时渲染）                                           | **条件渲染必须互斥**：使用 `{isA && !isB && !isC && (...)}` 或 if/else if 结构。useState 初始值必须基于实际数据，不写死                                                                                                                                                                          |
| **缓存标记无失效机制**                | 添加 `isDone` 缓存标记但只在完成时设 true                                                          | 上游数据变更后仍命中缓存，显示过期结果                                                                          | **缓存必须有失效路径**：grep 搜索所有修改上游数据的地方（如 updateSegment、retranslate），在数据变更时同步重置缓存标记                                                                                                                                                                           |
| **extraResources 先复制后删除**       | `extraResources` 用 `"**/*"` 打包整个 Extensions 目录，靠 `after-pack.cjs` 事后清理                | 打包先复制 7GB+ 文件，electron-builder 遍历数千个 exe 做签名检查，卡死 30+ 分钟                                 | **在 filter 层直接排除**：`"!python/**"`, `"!whisper/**"` 等，不复制就不需要删。`after-pack.cjs` 只作兜底                                                                                                                                                                                        |
| **Models 目录意外打包**               | `extraResources` 包含 `UserDatas/Models` 且 filter 为 `"**/*"`                                     | 开发环境 22GB 模型文件全量打包进安装程序，NSIS 压缩卡死                                                         | **绝对禁止**将 `UserDatas/Models` 加入 `extraResources`，模型文件由用户安装后通过应用内功能下载                                                                                                                                                                                                  |
| **同源多片段播放声音卡顿**            | `PixiVideo.tsx` 的 useEffect 依赖 `[asset?.path, asset?.src, clip.id]`，clip.id 变化就完整拆卸重建 | 同一视频分割成多段后播放，每次 clip 切换都触发 AudioManager unregister→register，Web Audio 链路断流导致声音卡顿 | **资源 Effect 只依赖 src，不依赖 clip.id**：将 Effect 拆为资源生命周期（依赖 `[src]`）和 clip 绑定（依赖 `[clip.id, src]`）。同源切段时 video element、Pixi Texture、音频链路零拆卸，只更新时间映射。额外将 `registered` 从 useState 改为 useRef 修复闭包捕获过期 state 的清理遗漏 bug           |
| **重写代码后未自审就提交打包**        | 将 TransNet V2 从子进程改回主进程后，直接提交+打包，未自审逻辑、未查资料确认技术方案               | 裸 `require()` 在 ESM 不可用、推理协议未对齐官方、Session 未释放等多个问题被遗漏，多走两轮修复                  | **重写/重构后必须三步走**：(1) 自审代码逻辑（资源释放、错误处理、竞态）(2) 搜索项目中同类模式确认写法一致 (3) 对接第三方模型/库时先查官方文档确认协议。**不要主动打包**，等用户指示                                                                                                              |
| **安装脚本改一半又改**                | 拿到需求就开始写代码，边写边发现边界场景                                                           | 迭代 4 轮，每轮发现新问题（旧版兼容、取消安装、文件锁定、跨盘）                                                 | **系统级代码必须先列测试矩阵**：写代码前穷举所有安装/卸载/升级场景 + 异常路径（取消、锁定、跨盘），确认覆盖后再动手。参考 `installer.nsh` 15 场景矩阵                                                                                                                                            |
| **安装/部署方案未调研**               | 直接凭自己理解写 NSIS 安装脚本方案                                                                 | 被用户指出"别人怎么做的"，方案缺乏业界验证                                                                      | **打包/安装/部署/系统级改动必须先搜索业界做法**：用 search_web 查 VS Code / Obsidian / electron-builder issues 的实际方案，确认主流做法后再写代码。不要在未调研的领域凭直觉设计方案                                                                                                              |
| **UI 问题分析 vs 修复**               | 用户说"检查/分析问题"时直接改代码                                                                  | 改错方向，被用户多次纠正"你先别瞎改"，反复修改 5 次浪费时间                                                     | **用户说"分析/检查"时只做分析不改代码**：① 读相关文件 ② 查 git 历史 ③ 查 spec/memory 文档 ④ 输出分析结论。等用户确认方向后再动手                                                                                                                                                                 |
| **FFprobe 返回值未做 NaN 防御**       | `parseInt(parts[0]) / parseInt(parts[1])` 直接除，未检查分母为 0                                   | `r_frame_rate="0/0"` → `0/0=NaN` → 所有场景时间变 NaN，前端显示 `NaN:00NaN`                                     | **FFprobe 数值必须校验**：所有从 FFprobe 解析的数值（fps、duration、bitrate）都必须经过 `Number.isFinite(val) && val > 0` 检查，异常值给默认值（fps→30, duration→0）                                                                                                                             |
| **UI 显示异常先改渲染层**             | 用户说"时间显示有问题"，没看清截图就去改 `formatTime` 的四舍五入逻辑                               | 白跑一轮，第二次用户贴高清截图才发现数据源就是 `NaN`                                                            | **UI 显示异常先验证数据源**：先 `console.log` / 打日志确认传入数据是否正确，数据正常才看渲染层。截图看不清时主动要高清截图或让用户打开 DevTools 看数据                                                                                                                                           |
| **"刚才还正常"时从底层原理排查**      | 用户说"一小时前还正常"，不听建议去查 N-API 版本、PE 头、npm 注册表                                 | 浪费大量时间在无关的底层分析上，最终 `git diff` 证明代码没变，重装就好了                                        | **"刚才还正常"= 优先查最近变更**：① `git diff` 查未提交改动 ② `git log -5` 查最近提交 ③ 检查 `npm install` 是否跑过。用户建议的排查方向优先执行，不要按自己的假设深挖                                                                                                                            |
| **CSS 修复盲改**                      | 改 CSS → 让用户截图 → 不行再改，循环 5 次                                                          | 用户反复截图验证，体验极差，被怒批                                                                              | **CSS/UI 修复前先用浏览器验证**：通过浏览器自动化注入 CSS 测试效果，确认方案可行后再修改源码。避免"改-看-不行-再改"的低效循环                                                                                                                                                                    |
| **重构丢失 CSS 配置**                 | 模块化重构时将多行 CSS 压缩为单行，丢失了 `height: 0px`                                            | 以前解决过的双滚动条 bug 回归，查了 5 轮才定位到重构 commit 丢失的那一行                                        | **重构后 diff 对比关键样式**：重构涉及 CSS/style 时，`git diff` 逐行对比旧版样式声明，确认所有属性都被保留。特别注意多行压单行时的属性丢失                                                                                                                                                       |
| **视频分段处理遗漏 head 段**          | overlayEffects 只处理 overlay 段 + tail 段，overlayStartSec > 0 时前段视频丢失                     | 扫光不从 0s 开始时前面的视频全部被截断                                                                          | **分段必须全覆盖**：拆分视频时按 head + 处理段 + tail 三段检查，每段都要有对应逻辑或明确跳过理由                                                                                                                                                                                                 |
| **FFmpeg -vn vs -an 混淆**            | 要去音频（保留视频）时写了 `-vn`（去视频）                                                         | tail_seg.mp4 全黑（无视频流），拼接后视频后半段黑屏                                                             | **-vn = no Video, -an = no Audio**：改完必须 grep 搜索全文 `-vn` 和 `-an` 确认每处都符合意图                                                                                                                                                                                                     |
| **排序与合并坐标系不一致**            | analyzeSegments 按 clip.start（编辑时间轴）排序，但合并条件用 clip.offset（素材内偏移）            | 反序剪辑时合并逻辑出错：不该合并的被合并，该合并的无法合并                                                      | **合并前按合并依据字段排序**：合并判断用哪个字段，排序就用哪个字段。不同坐标系（时间轴 vs 素材偏移）必须在注释中标注清楚                                                                                                                                                                         |

---



## 📦 拓展中心专项知识

### manifest.json 规范

| 字段           | 说明         | 示例                                  |
| -------------- | ------------ | ------------------------------------- |
| `id`           | 拓展唯一标识 | `whisper`, `ffmpeg`                   |
| `type`         | 拓展类型     | `executable`, `python-cli`, `runtime` |
| `category`     | 分类         | `media-tools`, `ai-tools`, `runtime`  |
| `variants`     | 变体数组     | CPU/CUDA 版本                         |
| `models`       | 模型数组     | Whisper 的 base/large 模型            |
| `healthCheck`  | 健康检查配置 | `command`, `file`, `http`             |
| `capabilities` | 能力声明     | 注册到能力中心                        |
| `dependencies` | 依赖其他拓展 | Python 工具依赖 python                |

### 服务层文件职责

| 文件                             | 职责                    |
| -------------------------------- | ----------------------- |
| `ExtensionManager.ts`            | 主入口，聚合所有子服务  |
| `ExtensionRegistry.ts`           | 管理可用/已安装拓展清单 |
| `ExtensionInstaller.ts`          | 安装/卸载/更新          |
| `DownloadManager.ts`             | 镜像测速+下载           |
| `HealthChecker.ts`               | 健康状态检查            |
| `ServiceManager.ts`              | 本地服务生命周期        |
| `ExtensionDependencyResolver.ts` | 依赖检查与自动安装      |

### IPC 通道前缀

所有拓展中心 IPC 使用 `ext:` 前缀：
- `ext:get-available`, `ext:get-installed`
- `ext:install`, `ext:uninstall`, `ext:update`
- `ext:service-start`, `ext:service-stop`
- `ext:get-config`, `ext:set-config`

---

## 🐛 逻辑设计易错点

| 场景               | 错误做法                                     | 后果                     | 正确做法                                                                                                         |
| ------------------ | -------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **兜底逻辑顺序**   | 将 generic fallback 放在 specific logic 之前 | 特定逻辑被兜底逻辑"截胡" | **倒金字塔结构**：最具体的判断放最前，最通用的兜底放最后                                                         |
| **跨组件数据同步** | 各组件独立加载数据，无通知机制               | 修改配置后其他组件不更新 | **使用自定义事件**：修改方 `dispatchEvent(new CustomEvent('xxx:updated'))`，消费方 `addEventListener` 监听并刷新 |

---

## 🎬 剪辑2 专项知识

| 主题             | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染一致性       | 预览和导出使用同一套逻辑（参考音频可视化、粒子组件）                                                                                                                                                                                                                                                                                                                                                                                                    |
| 坐标问题         | 注意 PixiClipLayer 的 transform 处理                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 选择框           | 组件选择框要和组件一样大小                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 声音问题         | 不能忽略声音，注意 AudioManager 集成                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 调试数据         | `UserDatas\projects` 有视频 JSON 工程文件可排查                                                                                                                                                                                                                                                                                                                                                                                                         |
| z-index 层级     | 修改前 grep 搜索所有层级，画层级表                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 遮罩层实现       | 需要不随滚动移动的遮罩，使用 fixed + ResizeObserver                                                                                                                                                                                                                                                                                                                                                                                                     |
| WebGL Canvas     | toDataURL 需在渲染帧内同步调用，或设置 preserveDrawingBuffer: true                                                                                                                                                                                                                                                                                                                                                                                      |
| Worker导出管线   | `BatchRenderManager.executeTask` → `ExportManager.submitJob` → `ExportWorker`(Worker线程) → `WorkerVideoDecoder` + `renderFrameToContainer`。Worker 线程中无法访问 VideoFrameService/VideoElement，必须用 WorkerVideoDecoder 独立解码                                                                                                                                                                                                                   |
| 视频解码器架构   | 按 clip.id 创建独立迭代器（从 clip.offset 开始），共享 per-asset 的 WorkerVideoDecoder sink。同一 asset 的连续 clip 可共享迭代器优化性能。帧率差异（源25fps vs 项目30fps）通过帧缓存+clone复用处理                                                                                                                                                                                                                                                      |
| 09_AUDIO_PITFALL | **同源 clip 切换不可拆音频链路**：`PixiVideo` 的资源 Effect 必须只依赖 `src`（视频源 URL），禁止依赖 `clip.id`。clip.id 变化只更新 `VideoResourceService.bindClipElement` 映射，不触发 video element / Texture / AudioManager 的拆卸重建。`AudioManager.register` 中 `createMediaElementSource` 对同一 element 只能调用一次，频繁 unregister→register 会导致声音断流。`registered` 状态用 `useRef` 而非 `useState`，防止闭包捕获过期值导致 cleanup 遗漏 |

---

## 🎯 任务中心设计原则

| 原则           | 说明                                                               |
| -------------- | ------------------------------------------------------------------ |
| **总线设计**   | 任务中心是统一的任务状态总线，为全局服务                           |
| **不执行任务** | 任务中心只负责状态存储和控制路由                                   |
| **可干预**     | 提供控制接口：暂停、恢复、取消、开始、重试                         |
| **执行器独立** | 任务执行由各自的执行器负责（如 BatchRenderManager 负责 video-gen） |
| **状态同步**   | 执行器将状态同步到任务中心，由任务中心统一存储和展示               |

---

## 🖥️ Electron 开发知识

| 主题                     | 说明                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **isQuitting 状态管理**  | 关闭窗口逻辑中需要 `isQuitting` 标志区分最小化和真正退出                                          |
| **托盘菜单**             | 使用 `Tray.setContextMenu()` 创建右键菜单                                                         |
| **IPC 双向通信**         | Main → Renderer 用 `webContents.send()`，Renderer → Main 用 `ipcRenderer.invoke()`                |
| **背景色**               | 优先使用内联 style，Tailwind 类在 Electron 中可能不生效                                           |
| **z-index 堆叠**         | transform、transition 可能创建新的堆叠上下文                                                      |
| **Fixed 定位**           | 使用 fixed + ResizeObserver                                                                       |
| **GPU 合成**             | 必要时使用 `transform: translateZ(0)`                                                             |
| **开发模式黑屏**         | 忘记调用 `mainWindow.loadURL(url)` 加载 Vite 开发服务器                                           | 开发环境窗口黑屏，无任何内容 | 确保在 `isDev` 分支中调用 `loadURL(VITE_DEV_SERVER_URL)` |
| **webContents 事件时机** | `did-navigate`、`did-finish-load` 等事件监听器必须在 `loadURL()` 之前注册，否则会错过初始导航事件 |


---

## 🎥 FFmpeg 知识

### 视频拼接方法选择

| 场景             | 推荐方法                     | 原因                                  |
| ---------------- | ---------------------------- | ------------------------------------- |
| 同源 stream-copy | `concat demuxer` (-f concat) | 高效，无需重编码                      |
| 混合来源需重编码 | `filter_complex concat`      | 强制解码后重编码，兼容性好            |
| 使用硬件编码器   | **必须用 filter_complex**    | concat demuxer + NVENC 存在兼容性问题 |

### 硬件编码器注意事项

| 参数            | 注意事项                      |
| --------------- | ----------------------------- |
| `-tune ll`      | 可能禁用 B 帧和影响关键帧生成 |
| `-g` (GOP size) | 硬件编码器必须显式设置        |
| `-rc`           | NVENC 推荐使用 `vbr` 或 `cbr` |

### 视频问题诊断命令

```bash
# 检查基本信息
ffprobe -show_format -show_streams video.mp4

# 检查关键帧分布
ffprobe -select_streams v:0 -show_entries packet=pts_time,flags video.mp4 | grep "K"

# 检查帧数（期望帧数 = 时长(秒) × fps）
ffprobe -show_entries format=duration -show_entries stream=nb_frames video.mp4
```

---

## 🎬 视频分析模块专项知识

### providerType 架构设计

| 类型         | 说明                          | 调用方式                                                        | 示例                           |
| ------------ | ----------------------------- | --------------------------------------------------------------- | ------------------------------ |
| `api`        | 云端 API 服务商，需要 API Key | 使用 `DynamicMultimodalProvider`，调用 Google Generative AI SDK | OpenAI、Gemini API、Claude API |
| `automation` | 浏览器自动化脚本              | **直接调用 `v3ScriptExecutor.executeScript()`**                 | Gemini Web、Doubao Web         |
| `local`      | 本地模型（预留）              | 待实现                                                          | Local Whisper、Local LLM       |

### Channel ID 格式规范

| Channel 前缀  | 格式                              | 用途                                           |
| ------------- | --------------------------------- | ---------------------------------------------- |
| `automation-` | `automation-{scriptId}`           | 内置脚本快捷方式（如 `automation-gemini-web`） |
| `provider-`   | `provider-{providerId}-{modelId}` | 用户在"视频分析"配置中添加的多模态来源         |
| 其他          | `{providerId}`                    | 内置 Provider（如 `bilibili-subtitle`）        |

### 路由逻辑决策树

```
收到分析请求 (channel, inputPath, inputType)
 ├─ channel.startsWith('automation-') 
 │   └─ 调用 AutomationMultimodalProvider
 │
 ├─ channel.startsWith('provider-')
 │   ├─ 查找 source.providerType
 │   │   ├─ providerType === 'automation'
 │   │   │   ├─ inputType === 'url' ? 先下载视频
 │   │   │   └─ 调用 v3ScriptExecutor.executeScript(modelId, { videoPath })
 │   │   │
 │   │   └─ providerType === 'api'
 │   │       └─ 调用 DynamicMultimodalProvider（Google AI SDK）
 │   │
 │   └─ source 未找到 → 错误
 │
 └─ 其他
     └─ 从 ProviderFactory 获取内置 Provider
```

### 参考实现

- **Chat 模块的最佳实践**: [apiServer.ts](file:///e:/project/GenStudio/electron/services/automation_v3/apiServer.ts#L387-L391)
- **视频分析的修复版本**: [VideoAnalysisService.ts](file:///e:/project/GenStudio/electron/services/videoAnalysis/VideoAnalysisService.ts#L111-L176)

---

## 🎭 Playwright 专项知识

| 需求                      | 错误做法                                             | 正确做法                                                                                                                                    |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **获取 User Agent**       | `page.userAgent()` (不存在)                          | `await page.evaluate(() => navigator.userAgent)`                                                                                            |
| **主进程 window**         | 在 `ipcMain` 中使用 `window`                         | 主进程无 DOM，需通过 `BrowserWindow` 或 `event.sender` 操作                                                                                 |
| **等待异步数据**          | 使用 `waitForSelector` 等元素出现                    | **必须用 `waitForFunction`** 等待数据格式 (如 `/\d+粉丝/`)，确保接口数据已加载                                                              |
| **多参数传递**            | `page.evaluate(fn, arg1, arg2)` 传多个参数           | **包装为对象**：`page.evaluate(fn, { arg1, arg2 })`，函数内解构 `({ arg1, arg2 }) => ...`                                                   |
| **跨域 API 调用**         | 在 A 域名的 page 上直接 fetch B 域名 API             | **先跳转域名**：`page.goto(B域名)` 后再 `page.evaluate(() => fetch(...))`                                                                   |
| **Cookie 同步（反检测）** | `context.storageState()` 导出 Cookie 和 localStorage | **用 `context.cookies()`**：纯 CDP 调用，不执行 JS，不触发反检测弹窗。`storageState()` 会遍历所有页面/frame 执行 JS 读取 localStorage       |
| **面向用户的浏览器窗口**  | `chromium.launchPersistentContext()` 启动            | **`spawn(exe) + chromium.connectOverCDP()`**：像手动打开一样启动，避免 `--enable-automation` 等自动化标志。加 `--disable-infobars` 隐藏横幅 |

---

## 🎨 UI 常见问题

### z-index 层级参考

| 层级       | 用途        |
| ---------- | ----------- |
| z-0 ~ z-40 | 普通内容层  |
| z-50       | header/导航 |
| z-100~200  | Modal/弹窗  |
| z-250+     | Toast 通知  |

### z-index 使用规则

| 规则                 | 说明                                                              |
| -------------------- | ----------------------------------------------------------------- |
| **禁止超高 z-index** | 禁止使用 `z-[9999]` 等超高值，Modal 类最高不超过 200              |
| **Toast 最高优先**   | Toast 通知必须始终可见，其 z-index (250) 应高于所有其他层         |
| **使用 CSS 变量**    | 优先使用 `variables.css` 中定义的 `--z-modal`、`--z-toast` 等变量 |

### 内容溢出/截断问题诊断清单

| 检查顺序 | 检查项     | 调整方向                                            |
| -------- | ---------- | --------------------------------------------------- |
| 1️⃣        | 容器高度   | `h-full` vs `h-[固定值]`，是否有 `min-h-0`          |
| 2️⃣        | 字号大小   | `text-xl` → `text-lg` → `text-base`                 |
| 3️⃣        | 行高       | `leading-tight` → `leading-snug` → `leading-normal` |
| 4️⃣        | 内边距     | `p-8` → `p-6` → `p-4`                               |
| 5️⃣        | Flex 布局  | `justify-between` 让内容自动分布                    |
| 6️⃣        | Line Clamp | `line-clamp-2/3` 配合上述调整                       |

### 多级菜单状态管理

| 场景             | 推荐做法                       | 示例                                                      |
| ---------------- | ------------------------------ | --------------------------------------------------------- |
| 多级菜单（≥2级） | 每级使用独立 state 变量        | `activeModule`, `activeUISection`, `activeFeatureSection` |
| 级别切换         | 切换上级时，下级自动选中默认项 | 切换模块时重置子选项为第一项                              |
| 渲染逻辑         | 根据上级状态条件渲染下级列表   | `{activeModule === 'ui' && <UISubOptions />}`             |

### ⚠️ 设置 Tab 页面布局规范

**GlobalSettingsModal 的关闭按钮 (X) 位于 `absolute top-4 right-4`，所有 Tab 页面的 Header 区域必须预留右边距避免内容被关闭按钮遮挡！**

| 规范            | 做法                                                         |
| --------------- | ------------------------------------------------------------ |
| Header 右内边距 | 使用 `pr-12` (48px) 或更大，确保右侧按钮不与关闭按钮重叠     |
| 靠右操作按钮    | 放在距离右边缘至少 48px 的位置                               |
| 正确示例        | `<div className="px-6 py-4 pr-12 border-b ...">`             |
| 错误示例        | `<div className="px-6 py-4 border-b ...">` ← 按钮会与 X 重叠 |

---

## 🔌 第三方 API 代理知识

| 问题                                     | 原因                                                                                    | 解决方案                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Gemini 模型 "Failed to parse stream"** | 第三方代理（如 api.mortis.edu.kg）只支持 OpenAI 兼容格式，不支持 Google 原生 SSE 流格式 | 自动检测代理格式：测试 `/v1beta/models` 端点，失败则降级为 OpenAI 兼容模式 |
| **代理格式检测**                         | 需要判断代理支持 Google 原生还是 OpenAI 兼容格式                                        | 调用 `/v1beta/models` 接口，返回 `{"models": [...]}` 说明支持原生格式      |
| **视频附件兼容**                         | Gemini 模型通过 OpenAI 兼容格式也支持视频                                               | 在 `isExtendedVideoModel` 判断中加入 `isGeminiModel`                       |

### 代理格式判断逻辑

```typescript
// 1. Google 官方 API 必须走原生格式
// 2. 第三方代理自动检测，不支持则降级为 OpenAI 兼容
const isGoogleOfficial = provider.id === 'google' || provider.apiUrl.includes('googleapis');
if (!isGoogleOfficial && isGeminiModel) {
    const supportsNative = await checkProxySupportsNativeFormat(apiUrl, apiKey);
    // 检测失败自动降级
}
```
