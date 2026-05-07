# Windsurf 号池管理

Windsurf 无感换号：在编辑器侧栏内集中管理多个账号，一键切换、自动注入会话，实时显示每日 / 每周配额与会员期限。免退出、免重启。

> 仅供本地账号管理与个人学习使用。请遵守 Windsurf 官方服务条款。

## 功能特性

- **多账号管理**：邮箱密码登录、批量导入（文本 / JSON）、从当前已登录账户一键导入（依赖补丁注入命令，无需密码）。
- **实时配额显示**：每日 / 每周配额百分比、重置倒计时、Flex 余额、会员计划与到期日。
- **号池汇总**：总账号数、本日 / 本周配额总量与百分比一目了然；无数据时显示占位，不隐藏面板。
- **一键切换**：保留当前会话的前提下注入目标账号 Session，无需重启 Windsurf。
- **自动切号**：当前账号 `min(日%, 周%)` 低于阈值时自动切换到候选最优账号；30 s 冷却 + 批量导入期间自动让位，避免误切。
- **多实例分身**：同时开多个 Windsurf 窗口，每个窗口登不同账号，可以同时用同一个项目。支持从 Cockpit Tools 导入实例。
- **配额排序**：综合配额 / 日配额 / 周配额 / 会员到期日 / 邮箱 / 默认顺序，多种排序方式。
- **批量导入进度弹窗**：webview 内模态弹窗实时进度条、成功 / 失败 / 跳过标签统计、失败明细列表、完成按钮关闭。
- **统一 webview 弹窗**：所有操作反馈（登录成功/失败、切换、添加账号等）均使用 webview 内模态弹窗，不再弹出 VS Code 原生对话框。
- **直连模式**：配额查询与登录请求绕过 VS Code 全局代理，避免代理未启动时请求失败。
- **无闪烁刷新**：账号卡片与实例列表刷新时原地更新 DOM，结构不变时不重建，消除视觉闪烁。
- **失败重试与限流**：自动重试瞬时错误、相邻请求最小间隔、单项超时兜底。
- **重复账号去重**：批量导入时自动跳过号池已存在的邮箱。
- **Windsurf 增强脚本**：注入 windsurf-better.js，提供界面汉化、回复建议气泡、自动恢复、完成提醒等功能。
- **自动恢复（AutoRecovery）**：错误分类检测（A 类重试 / B 类切号 / C 类继续 / D 类通知），自动重试与信号桥切号。
- **完成提醒**：AI 回复完成时播放提示音和/或弹桌面通知，支持多种铃声和触发条件。
- **切号策略**：最低非零优先（推荐）/ 满额度优先，自动跳过 Free 账号，可配置额度下限和已用号阈值。
- **切号范围**：全部账号 / 按标签筛选 / 当前实例分组，三种切号范围模式。
- **账号启用/禁用**：单个或批量启用、禁用账号；禁用的账号自动切号时自动跳过。
- **批量操作**：多选模式下支持批量加标签、启用、禁用、删除。
- **实例标签分组**：每个实例可绑定一个标签，切号范围选「当前实例分组」时只在该标签账号中轮换。
- **分组筛选**：按标签 / 套餐 / 状态 / 会员等级 / 用量水平 / 到期状态 / 域名，7 种维度。
- **分页浏览**：账号列表支持分页显示（10/20/50/全部），适配大量账号场景。

## 使用方法

1. 在活动栏点击 **Windsurf 号池管理** 图标打开侧栏。
2. 通过 **单个登录** / **批量导入** / **已登录账户** 任一方式添加账号。
3. 点击账号卡片的「切换」即可注入 Session 到当前 Windsurf。
4. 在「自动切号」面板开启自动切换、调整阈值（默认 10%）。
5. 通过卡片右上角的排序按钮选择排序方式。

## 系统要求

| 平台 | 最低版本 | 备注 |
|------|----------|------|
| **Windows** | v1.x+ | 完整支持 |
| **macOS** | **v4.13.2+** | 依赖跨平台适配（旧版本会报 `APPDATA 环境变量不存在`） |
| **Linux** | **v4.13.2+** | 同上；多实例窗口聚焦需额外安装 `xdotool` 或 `wmctrl` |

> ⚠️ **macOS / Linux 用户请务必使用 v4.13.2+**。早期版本未适配跨平台路径，在非 Windows 系统上启动会直接报错。

## 安装

1. 下载最新的 `.vsix` 包。
2. VS Code / Windsurf：命令面板 → `Extensions: Install from VSIX...`，选择该文件。
3. 首次切号时会自动提示应用 Session 注入补丁；按提示重启 Windsurf 即可。

### macOS / Linux 首次使用补充

Windsurf 主体安装在 `/Applications/`（macOS）或 `/usr/share/windsurf/`、`/opt/windsurf/`（Linux）时，需要写权限才能应用补丁。扩展检测到不可写时会自动弹提示并提供一键复制的 `chmod` 命令：

```bash
# 示例（实际路径以提示为准）
sudo chmod -R a+w "/Applications/Windsurf.app"        # macOS
sudo chmod -R a+w "/usr/share/windsurf"               # Linux .deb
sudo chmod -R a+w "/opt/windsurf"                     # Linux 手动安装
```

执行完重启 Windsurf 即可；用户级安装（`~/.local/opt/windsurf/`）无需此步骤。

## 安全与隐私

- 账号 Session、API Key 与密码均仅存储在 **VS Code `ExtensionContext.secrets`**（操作系统密钥库），不会上传任何远端。
- 配额查询直接调用 Windsurf 官方 API；除此之外不发起任何外部请求。
- 不收集遥测，不写日志到磁盘。
- 切号通过修补 Windsurf 内置扩展的认证方法注入 Session，仅在本机生效。

## 项目结构

```
windsurf-pool/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts
│   ├── accountStore.ts
│   ├── loginService.ts
│   ├── usageService.ts
│   ├── sessionInjector.ts
│   ├── sidebarProvider.ts
│   ├── instanceManager.ts
│   ├── autoSwitcher.ts
│   ├── signalBridge.ts
│   └── types.ts
└── resources/
    ├── icon.png / icon.svg
    ├── windsurf-better.js
    └── webview/
        ├── main.js
        └── main.css
```

## 开发

```bash
npm install
npm run compile      # 或 npx tsc
npm run package      # 生成 vsix
```

按 `F5` 启动扩展开发宿主进行调试。

## 更新日志

### v4.13.2
- **跨平台兼容（macOS / Linux 关键修复）**：
  - 修复旧版在非 Windows 系统上启动报 `APPDATA 环境变量不存在` 的错误。
  - `getAppDataDir()` 增加跨平台分支：Windows `%APPDATA%` / macOS `~/Library/Application Support` / Linux `$XDG_CONFIG_HOME` 或 `~/.config`。
- **多实例跨平台启动**：
  - Linux 可执行文件检测增加 `/usr/share/windsurf/`、`/usr/lib/windsurf/`、`~/.local/opt/windsurf/` 等路径。
  - CLI 模式启动使用 `realpathSync` 解析 symlink，并从 `cli.js` 反推出真实 Electron 二进制位置（避免 shell wrapper 不支持 `ELECTRON_RUN_AS_NODE`）。
  - 多实例面板以往仅 Windows 可见，现在全平台可用。
  - 进程检测：Linux/macOS 改用 `ps aux` + `/proc/<pid>/cmdline`；stop 使用 SIGTERM→SIGKILL；focus 使用 `osascript`（macOS）/ `xdotool` 或 `wmctrl`（Linux）。
- **权限友好提示**：激活时检测 Windsurf 安装目录是否可写，不可写时弹一次提示并提供一键复制的 `sudo chmod` 命令，点击「不再提示」后不再骚扰。
- **提示音 / 音频文件**：macOS 使用 `afplay`，Linux 使用 `paplay`→`aplay` 回退；UI placeholder 改为跨平台描述。

### v4.13.0
- **账号启用/禁用**：每张卡片新增眼睛图标按钮，点击切换启用/禁用状态；禁用的账号半透明显示并标记「已禁用」。
- **批量操作增强**：多选模式批量操作栏新增「加标签」「启用」「禁用」按钮，可对选中账号批量设置标签或切换状态。
- **切号范围（Pool Scope）**：自动切号设置新增「范围」下拉，支持三种模式：
  - **全部账号**：在所有非禁用账号中轮换（默认）。
  - **按标签**：只在指定标签的账号中轮换。
  - **当前实例分组**：读取当前实例绑定的标签，只在该标签账号中轮换。
- **实例标签分组**：实例卡片显示绑定标签（📌 标签名）；编辑实例时可选择「切号标签分组」，限定该实例的自动切号范围。
- **自动切号跳过禁用**：禁用的账号在自动切号和配额刷新时均自动跳过。
- **选择框美化**：账号列表选择框改为正方形（16×16），左侧选择区域去除背景色。

### v4.11.0
- **完成响铃修复**：解决 AudioContext autoplay 限制导致响铃无声的问题，改为通过扩展后端 PowerShell 播放系统蜂鸣音，桌面通知改用 VS Code 原生通知。
- **增强开关重载提示**：切换增强开关后弹出确认对话框，点击「立即重载」自动重载窗口。
- **增强开关点击修复**：修复 `<summary>` 内开关无法点击的问题，在 summary 层拦截事件。
- **无感切号状态修正**：信号桥状态不再依赖增强开关，只看脚本是否注入。
- **HTTP 请求容错**：增加 15s 超时、自动重试 2 次（TLS/socket 错误自动恢复）、连接池限制 6 并发。

### v4.10.0
- **增强面板开关**：「已禁用」红色文字改为 Switch 滑块开关，与自动切号样式一致，点击即可启用/禁用增强。
- **无感切号状态行**：增强面板新增「无感切号」状态显示（✓ 已就绪 / ⏸ 增强已关闭 / ✗ 未注入）。
- **信号桥可靠性提升**：轮询间隔 2s→1s；添加 60s 过期保护；webview 恢复可见时立即检查积压信号。
- **侧栏可见性恢复**：侧栏重新可见时自动重推自动切号设置和增强状态，防止状态丢失。
- **分类标题字号**：增强面板分区标题从 11px 增大到 13px。

### v4.9.0
- **账号搜索栏**：新增搜索框，按邮箱或标签实时筛选账号，支持防抖和清除。
- **按推荐排序**：参考 Cockpit Tools 逻辑，新增「⭐ 按推荐」智能排序模式，综合考虑账号有效性、到期状态、配额余量，将最佳账号排在最前。
- **排序方向切换**：新增 ⬇/⬆ 按钮切换升序/降序，所有排序模式均支持方向切换。
- **多标签筛选**：新增标签筛选下拉面板，支持同时勾选多个标签进行交集过滤，带计数显示和一键清空。
- **添加时间排序**：新增「添加时间」排序模式（按 `created_at` 排序）。
- **筛选计数**：搜索或标签过滤激活时，卡片计数显示 `筛选数 / 总数` 格式。
- 所有筛选/排序/搜索状态均持久化到 webview state。

### v4.8.0
- **AutoRecovery 历史日志面板**：侧栏「自动恢复」区域新增可折叠日志，记录每次错误检测、重试、切号、通知的完整链路。
  - 每条记录含：时间、分类（A/B/C/D 彩色标签）、动作（retry / switch / send-continue / notify）、结果（scheduled / signal-sent / switched:email / failed:reason / gave-up）、错误片段。
  - 支持按分类筛选（全部/A/B/C/D）、刷新、清空。
  - 最多保留 100 条，自动滚动剔除旧记录。
  - 面板展开时每 3s 自动刷新一次。
- **数据存储**：`localStorage['ws-recovery-log']` JSON 数组，与信号桥共享同一存储域。

### v4.7.0
- **AutoRecovery 大扩展**（基于 Reddit / GitHub Issues 社区调研）：
  - **A 类新增 7 种重试模式**：`Deadline exceeded` / `context deadline exceeded` / `Client.Timeout` / `Cascade has encountered an internal error in this step` / `No credits consumed on this tool call` / `Encountered unexpected error during` / `This request is taking longer than expected` / 流式中断 / 连接重置。覆盖 Claude Sonnet 4 闪退、thinking 超时被截断等高频痛点。
  - **C 类新增工具上限模式**：`Cascade can make up to N tool calls per prompt` / `maximum tool calls reached` / `tool call limit reached`，自动发 continue。
  - **D 类重构为 `{pattern, hint}` 结构，新增 6 种通知**：登录态失效（`Failed to log in: [deadline_exceeded]` / `Authentication failed` / `unauthorized`）→ 提示重新登录；上下文超限（`context length exceeded` / `prompt is too long` / `maximum context length`）→ 提示压缩对话或新开会话。
- **新错误翻译**：所有上述新增错误模式都加了中文翻译，错误条直接显示中文提示。
- **完成提醒触发判定**：`notifyTrigger=error` 模式现在也包含 D 类错误，确保所有异常都能弹通知。

### v4.6.0
- **切号后自动发送"继续"**：额度耗尽 / 限流切号成功后，自动在输入框发送「继续」让 Cascade 接着上次的进度走，避免重发整个原始 prompt 重做工作。
- **新增设置 `continueAfterSwitch`**（默认开启），位于「自动恢复」面板，可关闭恢复为旧行为（重发上一条用户消息）。
- **优先级**：Retry 按钮 → 切号后发"继续" → 否则重发上条消息，逻辑更清晰。
- **修复**：send 按钮 disabled 时不触发 click，避免无效提交。

### v4.5.2
- **试听按钮内存优化**：复用单一 AudioContext，避免每次点击试听创建新实例。
- **试听按钮 AudioContext suspended 修复**：与提醒声播放一致，挂起时自动 `resume()`。

### v4.5.1
- **修复翻译正则**：trace ID 改用 `[^)]+` 匹配 UUID 等任意格式（含 `-`），避免错误信息无法翻译。
- **新增通用错误翻译模板**：Permission denied / Failed precondition / Resource exhausted / Internal error 各种格式带 trace ID 的错误。
- **修复音频播放**：在 AudioContext 挂起时自动 `resume()`，符合浏览器自动播放策略。
- **分组持久化**：`groupBy` 选择刷新后保留，切换分组时重置分页到第 1 页。
- **修复分页布局**：`.pager-bar` 添加 `grid-column: 1 / -1`，跨满网格全宽。

### v4.5.0
- **完成提醒**：AI 回复完成或出现异常时播放提示音 / 弹桌面通知。支持 4 种内置铃声（Funk / Ding / Chime / Beep）、可配置触发条件（每次 / 仅异常 / 仅窗口不活跃）、响铃次数（1-5 次），侧栏可试听。
- **切号策略配置**：新增「最低非零优先」策略（推荐），优先消耗低额度号再换满额度号；可配置额度下限（minQuota）和已用号阈值（preferUsedThreshold）。
- **跳过 Free 账号**：自动切号时自动排除 Free 计划账号，不再切到无配额的免费号。
- **防止自动切号被意外关闭**：修复 webview 初始化时序问题，在未收到后端同步前不发送设置，避免默认值覆盖。
- **分组筛选增强**：新增「按会员等级」「按用量水平」「按到期状态」三种分组维度，快速区分 Free/Pro/已用尽/即将到期的号。
- **账户列表分页**：支持每页 10/20/50/全部显示，含分页导航，管理大量账号更方便。
- **翻译更新**：新增 Permission denied 速率限制、Duplicate cascade、Create snapshot 等翻译。
- **AutoRecovery 优化**：复用更精确的输入框查找逻辑（Lexical editor 兼容），防止 poolResult 重复处理，新增 rate limit 错误自动切号。

### v4.4.0
- **自动恢复（AutoRecovery）**：全自动错误检测与分类恢复——A 类错误自动重试、B 类错误自动切号、C 类工具上限自动发送 continue、D 类仅通知。
- **信号桥**：windsurf-better.js 通过 localStorage 与扩展通信，实现切号请求与结果回传。
- **标签管理 UI**：动态标签列表、筛选、编辑模态框。
- **增强面板 UI 统一**：菜单样式与全局风格一致。

### v3.8.0
- 修复扩展版本显示问题，确保版本号正确更新。

### v3.7.0
- 新增 GitHub 自动更新功能：支持从 GitHub Releases 自动检测并安装新版本。
- 新增更新配置项（windsurfPool.update）：支持配置仓库信息、GitHub Token、自动检查/安装开关。
- 新增手动检查更新命令（命令面板 → "Windsurf Pool: 检查更新"）。
- 启动后延迟 30 秒自动检查更新，避免影响启动性能。
- 支持公开仓库和私有仓库（私有仓库需配置 GitHub PAT）。
- 新增打包脚本：`npm run package`（仅打包）和 `npm run package:release`（打包+上传到公开仓库）。

### v3.6.0
- 新增 Auth1 Token 直接导入：批量导入支持粘贴 `auth1_` 开头的 token，自动识别并登录。
- 批量导入新增「登录方式」选项（自动 / Auth1 / Firebase），提示文字和输入框 placeholder 随选项动态切换。
- 自动切号新增「评分策略」设置（智能 / 仅日配额 / 仅周配额），切换时动态显示策略说明。
- 自动切号设置区域改为默认折叠，点击展开，界面更简洁。
- 自动切号默认开启。
- 自动切号设置排版重构为两列 grid 布局，视觉更整齐。
- 修复多实例启动时 Windsurf 内置扩展未激活完毕导致的"切换失败"弹窗：启动自动切号改为静默等待最多 30 秒，失败不弹窗。
- 修复"从当前账户添加"在新实例中立即失败的问题：增加最多 15 秒自动重试等待。
- 修复实例卡片"主实例"徽章被名称 overflow 截断的问题。
- 修复 `batchLogin` 未传 `authMethod` 参数、`batchTokenImport` 成功后不刷新 UI、`batchLogin` 失败不返回错误信息等问题。
- 编辑实例绑定账号下拉框额度改为显示「日余 / 周余」剩余百分比，更直观。
- 单个登录和已登录账户页面的按钮增加顶部间距，避免与输入框紧贴。

### v2.14.x
- 新增「多实例分身」面板：独立 user-data-dir 启动多个 Windsurf 窗口，支持 Cockpit Tools 实例导入。
- 所有操作反馈统一为 webview 内模态弹窗（info / warn / error + 确认按钮），移除全部 VS Code 原生对话框。
- 配额查询与登录请求使用独立 `https.Agent` 直连，绕过 VS Code 全局代理。
- 号池汇总面板：无数据时仍显示面板（占位 —），不再隐藏。
- 账号卡片与实例列表刷新改为 DOM 原地更新，消除视觉闪烁。
- 批量导入完成弹窗新增「完成」按钮；成功/失败/跳过计数改为圆角标签样式。
- 刷新按钮样式统一，移除 focus outline。

### v2.5.0
- 批量导入改为 webview 内浮层模态框，实时进度 + 失败明细 + 关闭按钮。
- 页面重载时自动恢复未完成的批量队列与进度展示。

### v2.4.0
- 修复自动切号多个问题：冷却态错误持久化导致卡死、误报「配额不足」、批量导入期间抢占切号、当前账号无 usage 时误判等。

### v2.3.0
- 新增配额排序按钮（综合 / 日 / 周 / 到期日 / 邮箱 / 默认），排序偏好持久化，当前账号始终置顶。

### v2.2.x
- 新增「从当前已登录账户添加」功能（依赖补丁注入命令，无需密码）。
- 批量导入：失败重试、限流、超时兜底、去重已有账号、模态结果汇总。
- 删除按钮去除二次确认；图标改为垃圾桶。

### v2.0.0
- 重写补丁注入逻辑，匹配 Windsurf 内置扩展最新结构；切号自动应用补丁。

### v1.x
- 初始版本：多账号管理、实时配额、自动切号、批量导入、Session 注入补丁。

## 免责声明

本扩展为社区工具，与 Windsurf 官方无关。使用本扩展产生的任何后果由使用者自行承担。
