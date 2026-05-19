<div align="center">

# Windsurf Pool — 号池管理

**让 AI 编程永不断流的 Windsurf 多账号管理引擎**

无感换号 · 自动恢复 · 多实例分身 · 智能切号策略 · 界面汉化 · 长任务自动化

[![Version](https://img.shields.io/badge/version-7.6.5-blue?style=flat-square)](https://github.com/soulvon/windsurf-pool-releases) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()

</div>

---

> 如果这个工具帮你省了时间，欢迎请我喝杯咖啡。

<p align="center">
  <a href=""><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>&nbsp;
  <a href=""><img src="https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>&nbsp;
  <a href=""><img src="https://img.shields.io/badge/爱发电-946CE6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6TTIgMTdsMTAgNSAxMC01TTIgMTJsMTAgNSAxMC01Ii8+PC9zdmc+&logoColor=white" alt="爱发电"></a>
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/soulvon/windsurf-pool-releases/main/wechat-reward.jpg" width="240" alt="微信赞赏码">
</p>

<p align="center"><sub>微信赞赏</sub></p>

---

## 交流群

<p align="center">
  <b>Windsurf Pool插件交流群</b>｜群号：<code>1075342078</code><br>

</p>

---

## 它解决什么问题？

Windsurf 的 AI 配额用完就得等重置，手动切号要退出登录、重启编辑器，**正在进行的对话直接丢失**。多开窗口还会互相踢号。

Windsurf Pool 在 **不退出、不重启、不丢失会话** 的前提下，把多个账号变成一个无限额度的池子：配额快用完 → 自动切到最优账号 → 接着上次进度继续 → 你甚至感知不到发生了什么。

## 核心能力

### 🔄 无感换号引擎
- **Session 热注入** — 修补 Windsurf 内置扩展的认证方法，直接覆盖 Session Token，保留当前对话上下文
- **智能切号策略** — 最低非零优先 / 满额度优先，自动跳过 Free 账号，可配置额度下限与已用号阈值
- **30s 冷却 + 防误切** — 批量导入期间自动让位，避免并发冲突

### 🛡️ 自动恢复（AutoRecovery）
- **四级错误分类** — A 类自动重试 / B 类自动切号 / C 类发送 continue / D 类通知用户
- **30+ 错误模式识别** — 覆盖配额耗尽、模型不可达、网络超时、流式中断、认证失效、上下文超限等
- **切号后自动续接** — 切号成功后自动发送「继续」，AI 接着上次进度走，不重做工作
- **双语兼容** — 汉化后仍能准确匹配英文错误模式（`data-ws-orig` 原文保留机制）

### 🤖 长任务自动化
- **长任务模式** — AI 停止后自动发送消息队列，支持循环发送，让 AI 持续工作
- **守护模式** — 自动点击「继续回复」+ 自动重试 + 工具上限自动 continue + 权限自动批准
- **智能跳过** — 检测到权限提示时暂停，AI 生成中不计时，全局冷却防冲突

### 📊 配额可视化
- **实时仪表盘** — 每日 / 每周配额百分比、重置倒计时、Flex 余额、会员计划与到期日
- **号池汇总** — 总账号数、本日 / 本周配额总量一目了然
- **7 维筛选** — 标签 / 套餐 / 状态 / 会员等级 / 用量水平 / 到期状态 / 域名
- **智能排序** — 综合推荐 / 日配额 / 周配额 / 到期日 / 邮箱 / 添加时间，支持升降序

### 🖥️ 多实例分身
- 同时开多个 Windsurf 窗口，每个窗口独立账号，可以同时用同一个项目
- 实例标签分组，每个实例绑定标签，切号范围限定在分组内轮换
- 跨平台支持：Windows / macOS（`osascript`）/ Linux（`xdotool` / `wmctrl`）

### 🌐 Windsurf 增强
- **界面汉化** — 实时中英文切换，关闭后即时还原（`WeakMap` 原文记录 + attribute 双向备份）
- **回复建议气泡** — 多主题多形状，实时切换
- **完成提醒** — 提示音 + 桌面通知，支持 4 种铃声和多种触发条件
- **SHA256 校验值修复** — 自动重算 `product.json` 哈希，从根本消除 "installation appears corrupt" 提示

## 技术亮点

> 这不是一个简单的配置管理工具。以下是开发过程中攻克的几个硬核问题：

| 问题 | 方案 |
|------|------|
| **跨 origin 通信失效** | Webview（`vscode-webview://`）与 workbench（`vscode-file://`）origin 不同，`localStorage` 事件不跨 origin 触发。自建 localhost HTTP 桥（token 鉴权 + CORS preflight 缓存 + 端口持久化复用），彻底替代旧方案 |
| **Electron 文件校验** | 修改 `workbench.html` 后 Electron 校验 SHA256 失败弹 corrupt 提示。启动时自动重算所有 checksums 并写回 `product.json`，算法与 VS Code 内置一致 |
| **汉化与错误识别冲突** | 汉化替换 DOM 文本后，30+ 条英文正则全部失效。翻译时将原文存入 `data-ws-orig` 属性，错误检测时拼接原文 + 可见文本，双语共存 |
| **注入版本判断** | 以前靠手动维护 VERSION 常量决定是否重注入，多次遗漏导致用户装了新版不生效。改用脚本内容 SHA1 前 10 位作为版本标识，内容变 → hash 变 → 自动重注入 |
| **设置实时生效** | 侧栏改设置 → 扩展宿主写盘 → HTTP 桥推送 `apply-settings` 命令 → 注入脚本热更新 observer 开关，全链路无需 reload |
| **Windows UAC 合并** | 补丁注入 + 增强注入 + 校验值修复三步写操作合并为一次 UAC 提权弹窗，用户体验从弹 3 次变弹 1 次 |

## 快速开始

1. 下载最新 [`.vsix` 发布包](https://github.com/soulvon/windsurf-pool-releases)
2. 命令面板 → `Extensions: Install from VSIX...` → 选择文件
3. 侧栏点击 **Windsurf 号池管理** 图标 → 添加账号（登录 / 批量导入 / 从当前账户一键导入）
4. 点击「切换」或开启自动切号 → 完成

### 系统要求

| 平台 | 最低版本 | 备注 |
|------|----------|------|
| **Windows** | v1.x+ | 完整支持 |
| **macOS** | v4.13.2+ | 旧版本会报 `APPDATA 环境变量不存在` |
| **Linux** | v4.13.2+ | 多实例窗口聚焦需 `xdotool` 或 `wmctrl` |

<details>
<summary><b>macOS / Linux 首次使用补充</b></summary>

Windsurf 安装在系统目录时需要写权限。扩展检测到不可写会自动弹提示并提供一键复制的 `chmod` 命令：

```bash
sudo chmod -R a+w "/Applications/Windsurf.app"        # macOS
sudo chmod -R a+w "/usr/share/windsurf"               # Linux .deb
sudo chmod -R a+w "/opt/windsurf"                     # Linux 手动安装
```

用户级安装（`~/.local/opt/windsurf/`）无需此步骤。
</details>

## 安全与隐私

- **本地存储** — Session、API Key、密码存储在 VS Code `ExtensionContext.secrets`（操作系统密钥库），不上传任何远端
- **零遥测** — 不收集任何数据，不写日志到磁盘
- **最小外部请求** — 仅调用 Windsurf 官方 API 查询配额，无其他外部请求
- **本机生效** — 切号通过修补本机 Windsurf 内置扩展实现，不影响其他设备

> 仅供本地账号管理与个人学习使用。请遵守 Windsurf 官方服务条款。

<details>
<summary><h2>更新日志（点击展开）</h2></summary>

### v7.2.36
- **✨ 恢复 Banner 视觉重设计**：glassmorphism 毛玻璃背景、顶部渐变装饰条、图标容器、pill 倒计时徽章、渐变按钮带阴影、更粗的发光进度条、底部分隔线，整体更现代精致。
- **✨ 恢复 Toast 通知重设计**：左侧彩色指示条（蓝/绿/琥珀）、图标背景容器、毛玻璃效果、scale 弹入动画。

### v7.2.1
- **🏷️ 多标签支持**：每个账号可添加多个标签，标签栏和筛选器全面适配多标签。
- **🏷️ 标签显示数量**：标签栏每个标签 chip 显示该标签下的账号数（如"推荐(5)"），"全部"显示总数。
- **🏷️ 未分类标签**：自动在标签栏末尾显示灰色"未分类"标签，筛选没有 tag 的账号。
- **🏷️ 标签编辑弹窗改造**：从单文本输入改为多标签 picker（已选标签 chips + 输入框回车添加 + 已有标签点选 toggle）。
- **🏷️ 卡片多标签展示**：账号卡片显示所有标签 chip，每个可独立点击筛选/右键编辑/双击改色，末尾有"+"快速编辑入口。

### v6.9.14
- **🔄 动态模型列表**：模型选择器不再硬编码，改为从 Windsurf 本地数据库（state.vscdb）动态读取，模型名称与 Windsurf 下拉完全一致，自动过滤变体（Low/Medium/High 等）。
- **⏹️ 停止检测按钮**：侧栏和面板均支持中途停止。检测中按钮变为"停止"，点击立即中断当前 HTTP 连接和后续检测（通过 AbortSignal 传播到 TCP 层）。
- **🐛 修复模型名称不匹配**：之前硬编码的模型名（如 "Claude 4.5 Sonnet"）与 Windsurf 实际显示名不一致，现已完全对齐。

### v6.9.13
- **🚀 真实模型探测**：测活现在支持发送真实聊天消息到指定模型，验证模型是否实际有响应。支持选择 12 种常用模型（SWE-1.6/Claude 4.5/GPT-5.2/Gemini 等），精确检测账号对特定模型的可用性。
- **🎯 模型选择器**：测活面板新增模型下拉菜单，可选择“快速检测（不发消息）”或指定模型进行真实探测。快速模式不消耗配额，模型探测发送最小消息（"Reply with only OK"）确认可用性。
- **⚡ 探测响应优化**：新增 `postProbe` 探测性 HTTP 请求，只读第一个数据块即确认模型可用，不等待完整响应，单账号探测耗时通常 < 5秒。

### v6.9.12
- **🩺 账号测活功能**：全新独立测活面板（`Ctrl+Shift+P` → 打开测活面板），支持一键批量检测所有账号活跃状态。检测结果实时推送，逐条显示正常/异常/限速状态、原因和耗时。
- **🏷️ 卡片测活 Badge**：测活完成后，结果自动同步到侧栏账号卡片的标签行，以绿色（✓ 正常）、红色（✗ 异常）、橙色（⚠ 限速）Badge 直观标识，鼠标悬浮查看详情。
- **⚡ 侧栏一键测活入口**：用量统计区域下方新增测活入口栏，可直接在侧栏触发批量测活或跳转到独立面板查看详细结果。

### v6.9.11
- **🗑️ 移除账号可用性探测功能**：该功能实际使用价值不大，已全部移除相关代码（UI 按钮、批量探测、报告面板、注入脚本逻辑）。

### v6.9.10
- **🔧 修复探测完成模态框不弹出**：`showProbeSummary` 改为直接操作 DOM，绕过 `escHtml` 转义，支持 HTML 换行和状态图标着色显示。

### v6.9.9
- **🎨 探测结果图标化**：探测结果状态改用图标符号显示（✓ 可用、⚠ 受限、✗ 失效、⏱ 超时、? 未知、⏳ 检测中），界面更简洁。
- **📊 批量探测完成摘要**：批量测试完成后自动弹出模态框，显示各状态账号数量统计，快速了解整体测试结果。

### v6.9.8
- **🔎 账号可用性探测**：统计面板新增真实发送探活能力，可对单个账号或多选账号/分组顺序测试，发送最小消息后自动判定 `available / limited / invalid / timeout / unknown`。
- **📋 批量测试报告**：新增探测结果面板，保留每个账号的状态、原因与时间戳，方便快速定位被试用全局速率限制拦截的账号。

### v6.9.7
- **🛡️ v6.9.5/6 三次审查修复**（2 项）：
  - 🟡 **修复 sessionInjector 频率熔断失效**：v6.9.5 #17 引入的熔断逻辑有 bug——触发熔断后 `_switchTimestamps` 未清空，10s 冷却结束后第一次调用立即又触发熔断（因为 60s 窗口内仍有 8+ 次记录），等于无效熔断。修复：触发熔断时清空时间戳数组。
  - 🟢 **`logPanelProvider` onDidDispose 清理防抖定时器**：面板关闭时清理 `_pushDebounceTimer`，避免悬挂定时器（虽然 `if (_panel)` 保护已无害，但代码更干净）。

### v6.9.6
- **🛡️ v6.9.5 二次审查修复**（2 个回归 + 1 个加固）：
  - 🔴 **回滚 v6.9.5 #2**：`forceSwitch` 路径下不再调用 `_onAutoSwitchDone`。原修改会导致 windsurf-better.js 收到**两次** pool-result（一次来自 `_onAutoSwitchDone` 的 enqueueCommand，一次来自 `handlePoolSignal` 的 respond），触发两次"切号成功"提示和两次 retry。设计上 forceSwitch 通知靠 handlePoolSignal 的 respond 回路完成，无需重复推送。
  - 🔴 **回滚 v6.9.5 #10**：`activate` 不再 `await autoSwitchByBindMark`。原修改会让扩展启动**卡 5-30 秒**——因为 `autoSwitchByBindMark` 内部 `injectSession` 在 silent 模式下会等待 PATCHED_CMD 最多 30s，期间所有命令未注册、侧栏空白、状态栏不显示。改回后台异步运行，AutoSwitcher 的 `_switching` 互斥已能避免与定时器切号冲突。
  - 🟡 **dispose 幂等加固**：`usageTracker.dispose` 改用 `_disposePromise` 缓存，subscriptions 触发的第一次 dispose 启动写入但 VS Code 不 await；`deactivate` 显式 await 同一个 promise 等到落盘完成，避免数据丢失。

### v6.9.5
- **🛡️ 全面稳定性 & 安全性审查修复**（18 项）：
  - 🔴 `refreshAll` 所有 fire-and-forget 调用加 `.catch()`，杜绝 unhandled promise rejection
  - 🔴 `forceSwitch` 路径也触发 `_onAutoSwitchDone`，与定时器切号路径行为一致
  - 🔴 `usageTracker.dispose` 改 async 并 `await Promise.all`，确保扩展卸载时统计数据落盘
  - 🔴 `accountLock.writeLockFile` 增加 Windows 下 EPERM/EBUSY 回退（仿 usageDiskCache）
  - 🟡 跨日重置时同步清空 `_lastQuotaMap`，避免 dDelta 基于昨天数据产生伪重置标记
  - 🟡 `bridgeServer` CORS 收紧为 `vscode-file://` / `vscode-webview://`，防本机恶意网页 token 探测
  - 🟡 `usageDiskCache.writeEntry` 改返回 `Promise<void>`，调用方可选择 await
  - 🟡 `pendingQueue` 无 ack 限制文档化（依赖每秒轮询 + 命令幂等性兜底）
  - 🟡 `logPanelProvider.pushAllData` 加 200ms 防抖，避免多账号刷新时频繁全量推送
  - 🟡 `activate` 改 async 并 await `autoSwitchByBindMark`，确保 `lastEmail` 在 `AutoSwitcher.start()` 前确定
  - 🟡 `statusBar` 无条件重绘间隔 5s → 30s（事件驱动已覆盖大多数变化）
  - 🟡 `SidebarProvider` 注册到 `context.subscriptions`，扩展卸载时 OutputChannel 正确释放
  - 🟢 `accountStore._writeQueue.then(task, task)` 重写为更清晰的 `then().catch()` 模式
  - 🟢 `applyPatch` 提取的混淆变量名增加 `\w+` 严格性验证，防御文件污染或版本变化
  - 🟢 `soundPlayer` 所有 `setTimeout` 加入 `_pendingPlayTimers` 集合，`shutdownSoundPlayer` 统一清理
  - 🟢 `usageDiskCache` 跨进程"最后写入获胜"行为文档化（自愈机制兜底）
  - 🟢 `injectSession` 频率熔断：60s 内超过 8 次自动暂停 10s，避免循环切号刷接口
  - 🟢 `enhancementInjector` patchVersion 从 SHA1+10 位升级到 SHA256+12 位

### v6.9.4
- **🛡️ 自动继续 & 自动切号 稳定性修复**（7 项）：
  - 🔴 修复 `_checkAndSwitch` async 调用未捕获异常，可能导致 unhandled promise rejection
  - 🔴 长任务 brainless→smart 切换时增加模式保护，防止 setInterval 回调竞态多发一条消息
  - 🟡 `stopBrainlessMode` 现在会自动恢复守护模式（`continueMode='smart'` + 重启 autoContinue），避免长任务因错误/上限停止后自动续写和突破限制功能静默失效
  - 🟡 长任务参数（空闲等待、最大轮数）优先读 `longTask.*` 新字段，兼容回退旧字段 `brainlessIdleSeconds/brainlessMaxConsecutive`
  - 🟡 切号成功后恢复冷却从 30s 缩短至 15s，新错误可更快触发恢复
  - 🟢 切号成功后重置长任务连续计数 `_brainlessConsecutive`，避免跨号累计导致上限提前触发
  - 🟢 `checkForContinuePrompts` 注释修正，明确"按钮存在时跳过"的设计意图

### v6.9.3
- **🔧 统计面板全面修复**（11 项）：
  - 🔴 手动刷新按钮现在真正触发 API 重拉配额（之前只重推缓存数据），`force=true` 跳过 TTL 和 skipUntil
  - 🔴 刷新完成后显示结果 toast（「3 个已更新，1 个失败」），并提前结束按钮冷却
  - 🔴 图表「全部账号」模式不再聚合均值误导，改为按账号分线绘制（实线日/虚线周，不同颜色区分）
  - 🟡 窗口 resize 时图表自动重绘（ResizeObserver）
  - 🟡 均日/均周配额统计排除异常和禁用账号
  - 🟡 「当前账号」快捷筛选按钮在无历史记录时优雅降级并 toast 提示
  - 🟡 倒计时支持天数（`3天1h45m` 而非 `73h45m`）
  - 🟡 恢复日志和扫描诊断表格加分页（之前截断前 100 条）
  - 🟢 单账号图表检测配额重置事件（+20pt 以上跳跃），折线断开并标记绿色三角
  - 🟢 时间戳跨年自动显示年份
  - 🟢 隐私模式 SVG 图标初始 opacity 与按钮状态同步

### v6.9.2
- **📊 配额历史 UX 改进**：单条记录时图表画单点（带数值标签）而非显示空白「数据不足」；0 条时给出友好引导（「切换至 24h/全部查看更多」）；表头「日变化/周变化」加 `pt` 单位标注避免百分点/百分比混淆；当 delta 来自时间窗口外的上一次记录时（跨窗口对比），视觉弱化为灰色斜体 + ↗ 标记，hover 显示 tooltip 说明；图例的 30%/10% 线标注为「警戒/危险」。

### v6.9.1
- **🎨 多实例面板重设计**：采用 Linear 风格的工业精致美学。左侧状态色条取代冗余的状态点（当前窗口带 emerald 辉光，运行中实色，已停止淡灰）；操作徽章统一改为小型大写描边样式（CURRENT/RUNNING/STOPPED）；智能选号去掉 emoji ⭐ 改用矢量旋光图标 + 等宽邮箱主标识；"默认分组" 屎黄改为低调灰；跳转按钮归入操作区。悬停时左条变宽 + 卡片微抬升。完整适配深色 / 浅色 / 高对比主题。

### v6.9.0
- **🔓 强制切换占用账号**：被其他实例占用的账号卡片上新增"强制切换"按钮，允许两个实例同时使用同一个号。强制切换后当前实例接管锁，原实例心跳自动感知并放弃持有。手动切号成功后也会正确更新跨窗口锁状态。

### v6.8.9
- **🎨 移除多实例当前窗口多余 ✓ 按钮**：当前窗口实例已有"当前窗口"文字标识，不再显示无功能的 ✓ 按钮。

### v6.8.8
- **🐛 修复多实例账号显示映射**：跨窗口账号锁改用真实实例 ID，非当前但正在运行的实例也能在分身面板显示其当前使用账号。

### v6.8.7
- **🐛 修复多实例分身面板显示**：未分配号池分组改为"默认分组"；当前实例处于智能选号时，优先展示当前窗口的实际账号，不再误显示"尚未启动"。

### v6.8.6
- **🐛 彻底修复账号卡片闪烁**：三管齐下消灭闪烁——
  1. `scheduleRerender` 改为**就地 patch**：usage 数据到达时只更新现有卡片的文本/进度条，**不再全量重建 DOM**（零 DOM 变动 = 零闪烁）
  2. `renderCards` 改用 **DocumentFragment + replaceChildren**：需要全量重建时，先在内存构建全部卡片，再一次性原子替换（消除 `innerHTML=''` 到 `appendChild` 之间的中间空白帧）
  3. 所有 `renderCards` 调用均**禁用 `cardFadeIn` 入场动画**（`no-card-anim` class），下一帧恢复，确保后续真正新增的卡片仍有动画

### v6.7.13
- 修复换号日志表格右侧列数据为空问题：改用 indexOf 定位箭头字符，彻底解决正则编码不一致导致的解析失败
- 配额历史新增"当前"和"最近"快捷筛选按钮，点击即切换账号筛选
- 修复图表在所有数据点集中于同一小时时显示空白：直接用原始点绘制
- 修复换号日志表格多列内容被横向截断：table-wrap 改为 overflow-x: auto
- 修复侧栏"日/周总用量"数值溢出卡片右边框：bar-val 宽度从 36px 改为 min-width 72px

### v6.7.3
- 统计卡片扩展：新增正常/配额耗尽/异常账号数、平均日/周配额剩余
- 配额历史图表优化：改为按小时聚合统计，更清晰的趋势展示
- 配额历史筛选：新增"最近使用"选项，显示最近 7 天有配额变动的账号
- 日志同步机制：全屏面板打开时通过 bridgeServer 从主窗口拉取恢复日志和诊断日志
- 浅色主题适配：CSS 变量分深色/浅色两套，修复浅色主题下文字和边框不可见问题
- 表格优化：删除不存在的"套餐"和"Flex"列

### v6.7.1
- 侧栏配额历史卡片移除，数据整合至统计面板
- "统计面板"入口移至「用量统计」行右侧，更自然
- 移除不必要的"清除历史"功能
- 修复模态框/Toast 透明背景问题

### v6.7.0
- **🟢 监控面板增强**（借鉴 Antigravity Cockpit）：
  - **账号总览 Tab**：统计卡片行（总账号/今日切号/请求信号/配额检查）+ 全账号配额表（日/周进度条、Flex 额度、缓存年龄、状态、标签），当前账号蓝色高亮
  - **恢复日志 Tab**：错误恢复执行记录（时间、分类彩色徽章、错误文本、执行动作、耗时），支持分类筛选（网络/配额/模型/截断/权限/介入/自定义）
  - **隐私模式**：一键脱敏所有邮箱（`a***@domain.com`），方便截图分享
  - **历史清除**：清除单账号或全部配额历史，带确认弹窗
  - **刷新冷却**：10 秒冷却 + 旋转动画，防止频繁请求
  - **Toast 通知**：操作反馈（刷新、清除、隐私切换）
  - **快捷键** `Ctrl+Shift+Q` / `Cmd+Shift+Q` 快速打开监控面板

### v6.6.9
- **🟢 全屏监控面板**：新增独立 WebView 面板（命令面板搜索「打开监控面板」或侧栏「配额历史」右上角 ↗ 按钮），包含：
  - **配额历史 Tab**：全宽折线图（带 Y 轴刻度、20% 网格、面积阴影）+ 分页明细表（记录时间、账号、日/周剩余进度条、变化量、重置时间、倒计时），支持账号筛选 + 时间范围（24h/7天/30天/全部）
  - **换号日志 Tab**：结构化解析切号日志，展示来源/目标账号、配额详情、切换原因和结果
  - 底部状态栏显示数据条数和当前账号
- **🟢 侧栏入口按钮**：配额历史面板标题旁新增外链图标，点击直接跳转全屏面板

### v6.6.8
- **🟢 配额变动历史面板**：新增「配额历史」侧栏卡片，包含：
  - **SVG 折线图**：日配额（蓝）/ 周配额（橙）趋势可视化，30% 警告线 + 10% 危险线
  - **配额变动表格**：时间、日%、周%、变化量（红/绿色标）、重置时间，最新 50 条，hover 显示完整邮箱
  - **账号筛选**：下拉选择单个账号或查看全部
  - **变化检测记录**：仅在配额数值变化时记录（避免轮询产生重复），持久化最多 500 条（`globalState`），跨会话保留
- **🟢 切号日志增强**：切号日志现包含源/目标账号的日周配额数值，格式：`[HH:MM:SS] src(日X%周Y%) 原因 → target(日A%周B%)`，覆盖定时切号、信号切号、无候选、验证失败四种场景

### v6.6.6
- **🔴 Bug F 修复：banner 倒计时在 Trusted Types CSP 严格模式下崩溃**：`showRecoveryPrompt` 内 `refreshUI` 直接对 `.ws-rb-status` 元素 `innerHTML = ...` 赋值，绕过了 `_ttPolicy.createHTML` 包装。Windsurf 启用 `require-trusted-types-for 'script'` 时该行抛 `TypeError`，导致整个倒计时刷新失败、banner 卡住不动。改为统一调用 `setSafeHTML`，与其他 HTML 注入路径一致。
- **🟡 Bug G 修复：`checkForContinuePrompts` 不占用共享冷却**：smart 模式下检测到工具上限并发送 continue 后，未更新 `lastRecoveryTs` / `_recoveryCooldownMs`。后续 `checkForErrors` 仍可能找到同一错误并弹 banner，倒计时结束尝试再次发送（被 `sendContinueMessage` 内部 `_lastContinueTs` 拦截）。修复后发送即占用 15s 共享冷却，避免无意义二次 banner。
- **🟢 Bug H 修复：`showRecoveryNotification` escape 不一致**：toast 用了简化版 `replace(/[<>&]/g, ...)`，未转义 `"` 和 `'`，与代码库已有 `escapeHtml` 工具不一致。当前安全（message 在 span 文本内非属性内），改用统一 `escapeHtml` 防止未来重构出意外 XSS。

### v6.6.5
- **🔴 Bug C/D/E 修复：setTimeout 残留绕过开关检查**：第八轮审查发现三处恢复流程内嵌 `setTimeout` 在延迟期间不检查用户开关变化，违反"用户意图优先"原则。
  - **Bug C** (`handleRetryAction`)：retry 延迟最长 9s，原 setTimeout 只检查 3s 行为冷却，未检查 `autoRecoveryEnabled` / `guardian.autoRetry`。用户在 delay 期间关闭开关后，setTimeout 仍会触发重试。
  - **Bug D** (`checkForPoolResult`)：切号成功 3s 后调用 `retryLastMessage`，未检查 `autoRecoveryEnabled`。用户切号过程中关闭自动恢复，仍会触发重试。
  - **Bug E** (`handleSwitchModelAction`)：切模型 1.5s 后执行 afterAction，未检查 `autoRecoveryEnabled`。
  - **修复**：每个 setTimeout 闭包内加入 settings 短路检查，记录日志 `setTimeout 短路: <reason>` 便于排查。

### v6.6.4
- **🔴 Bug A 修复：`getLatestErrorText()` 路径 1 遮蔽新错误**：`.error-message` 等选择器扫描路径未过滤 `_wsRecoveryHandled`，导致已处理的错误 DOM 残留时，路径 2-4（文本匹配 / assistant 内嵌 / body 全局兜底）发现的新错误永远不被处理。现已在路径 1 加入 `_wsRecoveryHandled` 检查，四条路径行为一致。
- **🔴 Bug B 修复：关闭 banner 时子开关 fallback 被绕过**：当 `recoveryConfirmEnabled = false`（关闭确认 banner）时，`isActionDisabled` + fallback 逻辑在 `recoveryConfirmEnabled` 检查之后，完全被跳过。导致禁用的 action（如 `retry`）在 `dispatchRecoveryAction` 里静默 return，元素已标记但无任何动作执行也无通知。现已将子开关检查移到 `recoveryConfirmEnabled` 之前，确保无论 banner 开关状态如何都有 fallback。
- **📝 脚本纪律规则改为英文原版**：`resources/script-discipline-rules.md` 从中文翻译版替换为英文 `[Script File Discipline — HIGHEST PRIORITY / ZERO TOLERANCE]` 原文，与全局规则文件 `~/.codeium/windsurf/memories/global_rules.md` 保持单一真相源。AI 模型对英文原版指令的遵循度更稳定，无翻译损耗。注入流程不变。

### v6.6.3
- **第六轮状态机审查修复**：调整 `checkForErrors` 中 `_wsRecoveryHandled` 的标记时机，避免冷却期间、banner 显示期间、或未命中任何规则的错误元素被提前标记，导致后续恢复流程永久跳过。
- **Banner 与恢复流程更稳健**：banner 正在显示时，新错误只跳过本轮检测但不标记 DOM，保留后续重检机会；只有命中指纹去重、自定义规则或内置恢复规则时才标记已处理。
- **保持偏好 Soft 模式**：「记住此选择」仍表示下次默认选中该策略，但 banner 继续显示，保留通知与 5 秒反悔窗口。

### v6.6.2
- **� 关键修复「queued 状态下继续发不出去」**：用户反馈截图——配额耗尽 + 「1 消息 queued」+ 输入框残留「继续」 → 死锁好几天。根因：Windsurf 在 queued 状态下「发送按钮」被禁用或替换，扩展的「点最右边按钮」策略**误点到「全部接受/全部拒绝」权限按钮**。
- **修复路径**：检测到 queued 状态时直接派发 **Enter 键**（这是 Windsurf 自己的官方推荐路径，DOM 上明示「按回车发送排队消息 (⏎)」）：
  - `sendContinueMessage` 入口处：已有 queued 时**不重复入队**，直接 Enter 推队列。
  - `trySendMessage` 入口处：queued 时优先走 Enter 策略，绕过按钮策略。
  - 长任务模式输入框残留检测：queued 时不当作"失败"，直接 Enter 推队列。
- **强化 Enter 事件**：同时派发 `keydown`/`keypress`/`keyup` 三个事件，覆盖 Lexical / React / contentEditable 不同框架的监听。
- **按钮策略加保护**：`trySendMessage` 在找"最右边按钮"时排除「全部接受/全部拒绝/Accept all/Reject all」文本的按钮。
- **queued 检测扩展**：原正则只匹配纯英文 (`N message queued`) 或纯中文 (`N 条消息排队中`)。实测 Windsurf 汉化是分词替换的，DOM 上实际出现的是**「1 消息 queued」混合形态**——已加上混合正则 + 提示文本检测 (`按回车发送排队消息`)。
- **🔧 修复「允许 Web 请求」弹窗无法自动点击**：根因是按钮文本匹配用了 `txt === '允许'` 精确相等，Windsurf 新版按钮文本是「**允许一次**」（"Allow Once"），导致匹配失败自动放行失效。改为白名单集合匹配，覆盖 `允许一次 / allow once / allow this time / 仅此一次` 等变体；同时显式排除「不允许 / deny / never / cancel」避免误点。
- **容忍 UI 改版的容器兜底路径**：原 `closest('[class*="approval|permission|..."]')` 在 Windsurf 的 inline banner（非 modal）上失败；新增向上最多 6 层祖先节点的**文本特征兜底**（匹配 `允许 Web / Cascade wants / 想要访问` 等关键短语），即使 Windsurf 改了 class 名也能继续工作。
- **安全策略不变**：仍然只点「允许一次」这种一次性放行按钮，**永远不会**自动点击「始终允许此页面 / 允许所有请求」这类永久性授权，避免越权。

### v6.6.1
- **🛡️ 脚本纪律规则自动注入（Script File Discipline）**：启用 Windsurf 增强时自动在 `~/.windsurfrules` 追加"脚本文件纪律"规则，让 Cascade AI 禁止在 `python -c "..."`、`node -e "..."`、`bash -c "..."`、heredoc 等形式里塞入多语句代码，强制写到 `scripts/` 目录的真实文件中执行，用完即删。解决 AI 频繁"黑箱"执行一长串内联代码导致难以审查、难以复现的问题。
- **独立 marker + 独立开关命令**：新规则使用 `<!-- ws-better-script-discipline-start -->` / `<!-- ws-better-script-discipline-end -->` 独立标记，与智能建议规则互不干扰；新增命令面板命令 `注入脚本纪律规则` / `移除脚本纪律规则`，可单独管理。
- **与增强开关联动**：打开"Windsurf 增强"开关时自动注入两条规则（智能建议+脚本纪律），关闭时一并移除；恢复原始 workbench.html 时也会清理。
- **规则模板**：位于 `resources/script-discipline-rules.md`，用户可按需自定义内容，插件重新注入时会同步更新。

### v6.6.0
- **🎯 交互式恢复确认 Banner**：所有自动恢复操作（重试 / 发继续 / 切换模型 / 切换账号 / 自动允许权限）都先弹出右下角 banner，5 秒倒计时后自动执行。让用户清楚知道"软件正在介入"。
- **可点选的策略切换**：banner 上有候选策略按钮（如「发继续 ✓」「切换模型」「切换账号」「重试」），点未选中按钮 = 切换默认 + 重置倒计时；再点一下 = 立即执行；点「✕ 取消」= 终止本轮。
- **偏好持久化**：banner 上的 ☐ 记住此选择 checkbox，勾选后该分类下次用此策略，跨重启生效。可通过 `localStorage.removeItem('ws-recovery-prefs')` 重置。
- **「模型提供商不可达」默认策略修正**：从 `switch-model`（实测因模型名硬编码对不上而陷入死锁）改为 `send-continue`（实测等几秒发继续即恢复）。不再切到根本不存在的"Claude Opus 4.6 Thinking / 4.7 / GPT-5.5"。
- **配额耗尽 queued 死锁修复（Bug C）**：发送继续后输入框残留时，先检测「N message queued / N 条消息排队中」标记。若是 queued 入队成功，**不清空残留**也**不计入失败**——避免越积越多最终触发 `stopBrainlessMode('发送失败')`。
- **长任务发送后主动 poll 错误（Bug B）**：发完继续后 3 秒主动调用 `checkForErrors`，不等下一轮 8 秒 idle，避免"发完继续 → 立刻报错 → 8 秒后才反应"导致重复入队。
- **toast 改实色灰色背景**：右上角 toast 从渐变改为 `#2a2a2a` 实色，跟新 banner 视觉风格统一。
- **新增设置项**：`recoveryConfirmEnabled`（总开关，默认 true，关闭后退回老逻辑直接执行）、`recoveryCountdownSeconds`（倒计时时长，默认 5 秒，可在 3-15 之间调）。

### v6.5.8
- **完成提示音零卡顿**：根因是 `[Console]::Beep` 同步阻塞 PowerShell 主线程整个音符时长（funk 三连音 ~420ms × repeat），导致音符之间出现停顿、连续触发被 stdin 队列推延。改用 `[System.Media.SystemSounds]::*.Play()` 异步 fire-and-forget API（由 Windows 音频子系统调度），PS 进程零阻塞。
- **音调映射**：`funk → Asterisk`、`ding → Beep`、`chime → Exclamation`、`beep → Hand`，名称兼容、音色为 Windows 标准提示音。`custom` 自定义频率仍走 `[Console]::Beep`（保留精细控制）。
- **WAV 文件异步化**：`Media.SoundPlayer.PlaySync()` → `Play()`，repeat 间隔由 Node 端 `setTimeout` 调度，单条命令短，避免 PS stdin 队列堆积。

### v6.5.7
- **扩展工具失败错误识别**：补充 HTTP 5xx（500/502/503/504、`Internal Server Error`、`Bad Gateway`、`Gateway Timeout`、`Service Unavailable` 及中文版本）、工具调用失败（`tool call failed` / `failed to call|invoke|execute tool` / `工具调用失败` / `failed to fetch` / `network request failed`）、积分/credits 相关配额耗尽（`insufficient credits` / `no credits remaining` / `积分耗尽` 等）共 20+ 条新模式，分别归入 `networkErrors`（走 retry）和 `quotaErrors`（走切号）。
- **兜底 A 同步扩展**：assistant 消息内嵌错误检测的关键词白名单同步加入上述新模式，Cascade 把工具失败渲染在思考过程链内时也能触发恢复流程。

### v6.5.6
- **修复 Cascade 内嵌错误漏检**：Cascade 把 "⚠ 权限拒绝：Rate limit exceeded..." 渲染在思考过程链尾部（DOM 上落在 `assistantMessage` 容器内），导致主检测路径通过 `closest(ASSISTANT_MSG_SEL)` 排除掉、不触发自动切号/切模型。新增"兜底 A"分支：扫描最后一条 assistant 消息内符合高置信额度/速率关键词的短文本元素，命中即触发恢复流程。
- 关键词白名单严格限定（如 `权限拒绝.*rate limit`、`upgrade to a Pro`、`用量配额已耗尽` 等），避免把 AI 解释类回复内容误判。

### v6.4.0
- **标签设置持久化**：重构标签保存机制，专用轻量消息通道 + dirty 标记防覆盖 + 后端确认回执，彻底解决标签重启丢失问题。
- **标签选择器时序修复**：账号数据到达后自动重新渲染标签选择器，不再显示“暂无标签”。

### v6.3.2
- **标签设置持久化修复**：修复自动切号范围中已选标签重启后丢失的问题，仅在实际变化时写入。

### v6.3.1
- **声音播放零延迟**：长驻 PowerShell 进程池，避免每次冷启动 ~1s 延迟，窗口关闭时自动清理。
- **切号日志持久化**：sidebar 重建后自动恢复历史切号记录（最多 30 条）。
- **通知去重**：完成提醒仅走 HTTP 桥单一路径，8s 防抖，消除多路径重复播放。

### v6.3.0
- **标签实色背景**：标签改为实色背景 + 白色文字，不同标签自动分配不同颜色（10 色调色板）。
- **标签自定义颜色**：双击标签打开颜色选择器，支持预设色 + 自由取色 + 重置。
- **完成提醒三重检测**：拦截 Windsurf 原生 Notification API + 文本增长检测 + 轮询，声音通过 HTTP 桥接播放。

### v6.2.0
- **完成提醒**：复用长任务的 `isAIGenerating()`（`lucide-circle-stop` + thumbs-up 计数）。
- **多选模式卡片优化**：checkbox 绝对定位左上角 + padding-left 腰出空间，不遮挡文字、不影响布局。
- **自动切号 UI 重设计**：核心设置精简为一句话，高级参数折叠隐藏。
- **多标签选择**：切号范围支持多标签筛选，已选标签 chip 展示。
- **额度刷新频率设置**：新增“当前账号/全部账号”双刷新频率配置。
- **无感换号默认值优化**：检查间隔 5s、冷却 15s、阈值 15%，老用户升级自动迁移。
- **策略回退 Bug 修复**：修复“满额度优先”回退为“低额度优先”的 Bug。
- **旧标签数据迁移**：单标签 `poolTag` 自动迁移为 `poolTags` 数组。
- **评分模式移除**：去掉无实际用途的评分模式选项，硬编码为“智能”模式。

### v6.1.7
- **多选模式卡片优化**：checkbox 绝对定位左上角 + 卡片 padding-left 腰出空间，不遮挡文字，不影响布局。

### v6.1.5
- **自动切号 UI 重设计**：核心设置精简为一句话"额度低于 X% 时自动换号"，高级参数折叠隐藏，减少小白困惑。
- **评分模式移除**：去掉无实际用途的评分模式选项，硬编码为"智能"模式（取日/周较低者），简化 UI。
- **多标签选择**：切号范围支持多标签筛选，已选标签以 chip 展示，点击可添加/移除。
- **额度刷新频率设置**：新增"当前账号/全部账号"双刷新频率配置，位于 Windsurf 增强 → 底部状态栏下方。
- **无感换号默认值优化**：检查间隔 5s、冷却 15s、阈值 15%，老用户升级自动迁移。
- **策略回退 Bug 修复**：修复"满额度优先"策略回退为"低额度优先"的 Bug，确保选号策略生效。
- **旧标签数据迁移**：单标签 `poolTag` 自动迁移为多标签 `poolTags` 数组，无缝升级。

### v6.1.0
- **CSS V2 设计语言重构**：`main.css` 从 6477 行混合样式重写为 2400 行清洁 V2 样式表，新增 CSS 变量色彩令牌系统（VS Code 主题 + 强调色盘），完整覆盖卡片、面板、模态框、网格、Toast 等组件。
- **补全 25 个缺失 CSS 类**：覆盖审计发现的实例卡片状态类（`.current/.running/.stopped`）、网格标题与锁定遮罩、批量导入计数样式、账号选择器列表、标签徽章、浅色主题适配等。
- **新增 QQ 交流群信息**：README 顶部添加交流群文字入口，底部添加二维码图片（群号 1075342078）。

### v6.0.0
- **UI 字体全局提升**：提示文字、状态统计、按钮、日志、分页等多处 9-10px 小字统一提升至 11-12px，改善可读性。
- **模型列表竖排显示**：「可用模型优先级」列表从横排 chip 改为竖排列表，每行一个模型名，支持滚动，不再截断。
- **实例徽章实色化**：主实例 / Cockpit 来源徽章改为实色背景 + 白字；「未分配号池分组」改琥珀色高对比显示。
- **下拉框 z-index 统一修复**：所有下拉框（筛选、账号选择器、标签分组）z-index 提升至 10001，修复被模态框遮挡问题。
- **账号选择器 portal 定位修复**：修复 `.ap-list` 与 `.ap-list-portal` CSS 优先级冲突导致模态框内下拉无法打开的问题。
- **「系统就绪」去卡片化**：长任务面板状态条去除边框和背景，改为纯文字显示。
- **Mini Toggle 防变形**：添加 `flex-shrink: 0` 防止窄视口下开关被挤压。
- **回复建议使用前提说明**：新增 ⚠️ 提示区块，说明需要在 Global Rules 中注入气泡规则。
- **文案修正**：「未分配标签分组号池」→「未分配号池分组」。

### v5.0.3
- **Windows 提权批处理（`elevatedFs.ts`）**：新增 `elevatedFs` 模块，将启动阶段所有安装目录写操作（补丁注入、增强注入、校验值修复）合并为一次 UAC 弹窗；用户拒绝时提供「重试」或「以管理员身份运行」选项，不再每个文件单独报错。
- **长任务模式增强**：
  - 新增「发送重试次数」设置：输入框残留检测到连续 N 次发送失败后自动停止长任务（默认 3 次）。
  - 新增「遇到不可恢复错误时自动停止」选项。
  - **强制停止按钮**：发送 `force-stop` 命令到注入脚本，立即清除定时器 + 清空输入框残留 + 重置所有计数。
  - 停止原因显示：侧栏状态文本展示具体停止原因（达到最大次数 / 发送失败 / 队列消费完 / 切换到守护模式）。
  - 长任务运行中切换到守护 Tab 时弹确认对话框，防止误操作。
  - 每次成功发送后通过桥推送计数到侧栏，实时显示已发送次数和内容。
- **自动切号改进**：
  - `forceSwitch` 在自动切号关闭时不再执行（之前信号桥触发的强制切号不受开关限制，可能意外切号）。
  - 候选排除日志增加 Free 账号拒绝计数，方便排查"无可用候选"原因。
  - 切号提示文案区分"低于额度下限"与"低于阈值"，更精确。
  - 信号桥切号增加耗时统计和缓存大小，便于诊断延迟问题。
- **桥服务器启动集成**：增强启用时在扩展激活阶段自动启动桥服务器（复用上次 port/token），不再需要首次 reload。`deactivate` 时关闭桥。
- **CSP connect-src 自动添加**：`ensureConnectSrc` 在注入 workbench.html 时自动添加 `http://127.0.0.1:* http://localhost:*`，免手动配置。
- **注入版本 marker 格式更新**：格式改为 `<!-- ws-better-v1.0.0-a1b2c3d4e5 -->`（含 SHA1 hash），正则同步更新为匹配 `[\d.]+-[a-f0-9]+`。
- **scoreMode 提示优化**：daily / weekly 模式说明补充"若任一配额 ≤ 额度下限仍会强制切号"。
- **`brainlessMaxConsecutive` 语义修正**：`0` 表示无限（之前 0 被错误转换为 99999）。

### v5.0.2
- **切号策略默认值调整**：默认策略从「最低非零优先」改为「满额度优先」。
- **🔴 修复切号选中不可用账号**：新增硬约束——候选账号日/周任一维度 ≤1% 时绝对不选（不受 `minQuota` 配置值影响）。修复 `scoreMode=daily` 时可能选中「周 0% 日 100%」等实际不可用账号的问题。
- **🔴 修复重启自动发「继续」**：插件重启后不再自动进入长任务（brainless）模式发送继续消息。根因是 `collectEnhSettings()` 在长任务 tab 选中时总返回 `continueMode: 'brainless'`，持久化后重启即触发。
  - `collectEnhSettings()` 现在只在长任务实际运行时（`_ltRunning === true`）才返回 `brainless`，否则始终为 `smart`。
  - 长任务控制按钮改为通过 `saveLtMode()` 直接推送 `continueMode` 变更，走 `enhSave` → bridge `apply-settings` 正规链路。
  - `init()` 增加安全检查：检测到残留 `brainless` 状态时自动重置为 `smart` 并保存。
- **修复暂停后设置变更意外恢复 brainless**：暂停时未重置 `_ltRunning` 标志，导致修改其他设置时 `collectEnhSettings()` 仍返回 `brainless`。现在暂停/恢复正确切换 `_ltRunning` 状态。
- **清理 ~200 行死代码**：移除已迁移至侧栏的旧浮动设置面板（`injectPanelStyles` + `createSettingsUI`），减小 VSIX 体积。
- **批量导入选项居中修复**：radio 按钮改用 `padding` + `min-height` + `line-height: normal` 替代固定 `height` + `line-height: 1`，修复中文字符垂直不居中问题。

### v5.0.1
- **设置哈希稳定性**：嵌套对象（如 `longTask`）递归排序 key 后再 hash，避免字段顺序不同导致无意义重注入。
- **重载 banner 插入位置修复**：「已实时应用」banner 改为插入到 body 末尾，避免被其他元素遮挡。
- **实例标签占位符改名**：未绑定标签的实例显示为「未分配标签分组号池」，语义更清晰。

### v5.0.0
- **Devin Token 批量导入**：新增「Devin Token」导入格式，支持粘贴 `devin-session-token$` 或纯 JWT（自动补前缀），自动去重、标签分组。
- **自动继续面板 UI 统一**：「自动继续」与「自动切号」面板头部样式统一（图标颜色、折叠箭头位置、开关样式），使用 `as-top-*` 系列 class，移除冗余的 `ac-summary` / `ac-icon-box` 等旧样式。
- **长任务模式（brainless → longTask）重构**：从旧的 `brainlessModeEnabled` 迁移到结构化的 `longTask` 对象（含 `continueQueue` / `loop` / `idleSeconds` / `maxContinueCount`），支持多条消息队列循环发送。
- **守护模式（guardian）**：自动点击「继续回复」按钮 + 自动重试 + 工具上限自动发 continue + 权限自动批准 + 自动关闭 corrupt 提示，可逐项配置。

### v4.20.2
- **修复 `injectBubblesStyles` 冗余 DOM 操作**：`document.head.appendChild(style)` 在 `if (!style)` 块外无条件执行，每次调用都会多一次 DOM move。已移除。
- **优化 `applySettingsChange`**：主题/形状变化时不再调 `injectBubblesStyles()`（CSS 是静态的），只调 `restyleAllBubbles()` 即可。
- **修复 `getInjectionStatus` 正则**：旧正则 `[\d.]+` 无法匹配新版本格式 `1.0.0-a1b2c3d4e5`（含 hash 后缀），导致状态面板始终显示未注入。
- **Bridge fetch 超时保护**：`bridgePoll` 和 `bridgePostResult` 添加 5s `AbortController` 超时，防止 bridge server 无响应时 fetch 挂起阻塞轮询。

### v4.20.1
- **审查发现 v4.20.0 的气泡主题切换实际是 noop**：根因是 `injectBubblesStyles` 函数有 `if (document.getElementById('ws-bubbles-css')) return` 早返回，**重复调用直接跳过**。而且主题颜色其实不写在 CSS 里，是渲染时用 inline style 应用的——已存在的气泡 inline style 已固化，CSS 重注入也无济于事。
- **修复**：
  - 让 `injectBubblesStyles` 改为**幂等**（已存在 `<style>` 元素时复用并更新 textContent）
  - 抽出 `applyBubbleStyle(wrapper)` 函数（原嵌在 createBubble 内的主题/形状逻辑），便于复用
  - 新增 `restyleAllBubbles()`：遍历所有 `.ws-bubbles` 容器对每个调用 `applyBubbleStyle`
  - `applySettingsChange` 检测到 `bubblesTheme` 或 `bubblesShape` 变化时调 `restyleAllBubbles`
  - emerald 主题 → 清掉 inline override 让 CSS 默认生效；其他主题 → inline style 覆盖
  - hover 行为运行时读 `settings.bubblesTheme`，避免重复绑定 listener，主题切换 hover 也跟着变
- **影响**：现在改气泡主题/形状**真正实时**对所有现存气泡生效，符合 v4.20.0 README 的承诺。

### v4.20.0 ✨ 改设置一律实时生效，无需重启
- **新增 `apply-settings` 反向桥命令**：侧栏 webview 改设置 → `enhSave` → 扩展宿主写盘 + `enqueueCommand({action:'apply-settings', payload:merged})` → windsurf-better.js 通过 `GET /pending` 取走 → 直接调 `applySettingsChange`，启停各模块的 observer。
- **抽出 `applySettingsChange(newSettings, source)`**：原来散在 storage event handler 里的开关同步逻辑（启停 bubbles / 汉化 / autoContinue / dismissCorrupt / autoRecovery / notify / brainless）抽成统一函数，supports：
  - 来源 1：bridge `apply-settings` 命令（跨 origin，主流程）
  - 来源 2：storage event（同源 fallback）
- **额外覆盖**：`bubblesTheme` / `bubblesShape` 改变时重注入 CSS（之前没处理，需要 reload）；`recoveryRules` / `customRecoveryRules` 等纯数据字段直接 Object.assign 即生效。
- **banner 改成绿色"已实时应用"**（取代原来的"重启 Windsurf 后生效"），3.5s 自动消失，附保留「重启窗口」小链接以防万一。
- **影响**：从 v4.20.0 起 **侧栏所有增强设置改完即时生效**：
  - 切换汉化开关 → UI 立即变中/英文（v4.19.2 + v4.20.0 联动）
  - 切换无脑模式 / 自动恢复 / 自动继续 → observer 立即启停
  - 改气泡主题 → 立刻看到新颜色，无需 reload
  - 修改恢复规则 → 下次错误检测立即用新规则

### v4.19.2
- **汉化支持实时关闭**：之前关闭汉化只能停止"新内容翻译"，已翻译的中文必须 Reload Window 才能恢复英文。本版顺势利用 v4.19.0 加的原文记录机制实现真正的实时还原。
  - 翻译 textNode 时同时把原文存到 `WeakMap`（键是 textNode 本身，关闭时遍历整个 document 精确还原，不阻止 GC）
  - 翻译 attribute 时把原值存到 `data-ws-orig-<attr>` 属性（aria-label/title/placeholder/data-tooltip 都覆盖）
  - 关闭汉化时一次性扫描全文档：还原所有 textNode + 还原 attribute + 清理 `data-ws-orig` 标记
- **影响**：在侧栏勾掉「启用汉化」**立即看到英文 UI**，无需重启或 reload window。

### v4.19.1
- **审查发现 v4.19.0 漏修的 2 个相邻汉化兼容点**：
  - **`hasPermissionPrompt` 漏检中文权限按钮**：之前只检查 `accept all / approve / reject / 授权 / 允许`，但 TRANSLATIONS 把 "Accept all"/"Reject all" 翻译成了 "全部接受/全部拒绝"，关键字根本不命中。**后果**：开启无脑模式时，权限提示出现 → `hasPermissionPrompt` 返回 false → **仍会自动发送"继续"误干扰用户决策**。
  - **`isAIGenerating` 漏检中文同义词**：只匹配 `stop / 停止 / cancel / abort`，不识别 "取消 / 终止 / 中止 / 中断"。**后果**：AI 生成中按钮显示 "取消" → 误判 AI 已停止 → 无脑模式提前发"继续"干扰当前生成。
- **修复**：两个函数都改用「双语关键词集合 + `data-ws-orig` 原文兜底」的统一模式，与 v4.19.0 的 ERROR_PATTERNS 修复同套机制。

### v4.19.0 ⚠️ 重要：解决「汉化导致自动恢复失效」
- **🔴 修复汉化与错误识别的冲突**：你的猜测对的——汉化把 DOM 文本（如 `Model provider unreachable` → `模型提供商不可达`）原地替换，但 `ERROR_PATTERNS` 30+ 条几乎全是英文正则，**汉化开启时（默认开）几乎所有自动恢复模式都匹配不到**：
  - 配额耗尽自动切号 ❌（`/usage quota is exhausted/i` 不匹配中文 "配额已用完"）
  - 模型提供商故障自动切模型 ❌（`/Model provider unreachable/i` 不匹配 "模型提供商不可达"）
  - 网络超时自动重试 ❌（同样问题）
  - 工具调用上限自动发 continue ❌（`/tool call limit reached/i` 不匹配中文）
- **修复方案**：汉化时把原文存到父元素 `data-ws-orig` 属性，错误检测函数 `getLatestErrorText` / 续接扫描读元素文本时**拼接 `data-ws-orig` + 可见文本**，英文正则在原文上匹配，中文正则也能匹配可见文本，**两种语言共存**。
- **影响**：开启汉化的用户现在自动恢复终于真正生效；之前以为"自动恢复有问题"的多个症状其实都是这个 bug 引起的。
- **`autoContinue` 是个例外**：它本来就同时检查 `'Continue response'` 和 `'继续回复'` 两种文本，所以一直工作。其他 30+ 条只有少数加了中文 pattern 兼容。

### v4.18.1
- **「未检测到可用模型」修复**：模型选择器按钮 + 下拉面板的 selector 完全不够覆盖 Windsurf 实际 DOM。改进：
  - `findModelSelectorBtn` 增加到 4 层 fallback：aria-label / data-testid / class 含 `model+select` / **全文档扫描可点击元素文本匹配模型名前缀**（最稳）
  - 加 `[role="combobox"]` / `[aria-haspopup="listbox"|menu|true]` 覆盖更多自定义下拉
  - 选最短匹配（避免选到含 "claude" 字样的长按钮，如"Claude API 设置"等）
- **新增 `scanPageForModelNames` 全文档兜底**：`getAvailableModels` 在"找不到按钮"或"面板没出现"两种失败路径都会触发兜底扫描，直接从页面已渲染的按钮 / 列表项中抓符合模型名前缀的文本
- **详细调试日志**：每一步都打到 console，按 F12 → Console 可以看到具体卡在哪一步：
  - `[ModelSwitch] 找到选择器按钮: <文本>`
  - `[ModelSwitch] 模型下拉面板未出现，尝试全页面扫描`
  - `[ModelSwitch] 全页面扫描得到 N 个候选模型`

### v4.18.0 ⚠️ 重要：解决「装了新版没生效」问题
- **🔴 根因修复：注入触发机制**：之前 `enhancementInjector` 通过读取 `windsurf-better.js` 里的 `const VERSION = 'X.Y.Z'` 常量决定是否要重新注入。每次改脚本都要手动递增 VERSION，**多次遗漏导致用户装了新 vsix 但 workbench.html 仍嵌着旧版脚本**——这就是为什么 v4.17.1 / v4.17.2 / v4.17.3 的修复（通知样式 / payload 解包 / DOM fallback / CSS）很多用户实际装上后**根本没生效**。
  - **修复**：`getPatchVersion()` 改用脚本内容的 SHA1 前 10 位作为版本标识。**内容变 hash 必变 → 自动触发重注入**，不再依赖人为维护版本号。
  - **影响**：装了 4.18.0 后，今后所有 windsurf-better.js 修改都会被正确注入；同时**之前几个 patch 版本累积的修复也会一并生效**：
    - 通知改到右上角 + 渐变色条样式
    - 切号失败修复（pool-signal 走桥）
    - "未指定模型" 修复（payload 解包）
    - DOM 选择器多层 fallback
    - 数字输入框正常显示

### v4.17.3
- **修复数字输入框显示空白**：`<input type="number" class="enhance-select">` 被 `.enhance-select` 的 select 样式覆盖（`appearance:none` + 自定义下拉箭头 SVG + 24px 右 padding），导致 48px 宽的小输入框只剩 16px 显示空间，数字被挤出可见区。
  - **修复**：CSS 加针对 `input[type="number"].enhance-select` 和 `input[type="text"].enhance-select` 的特化规则，移除下拉箭头 SVG、改用原生 spinner、收窄 padding。
  - **影响**：「自动恢复」面板的「最大重试」「延迟」「无脑模式空闲秒数 / 连发上限」等所有数字输入框现在能正常显示。

### v4.17.2
- **🔴 修复"未指定模型"等参数丢失问题**：webview `sendCommand(action, extra)` 把参数包进 `payload` 字段，但 windsurf-better.js 直接读 `cmd.model` / `cmd.text` 等顶层字段，导致**所有带参数的测试命令拿不到数据**（最明显："测试切换模型"必报"未指定模型"）。修复：`handleSidebarCommand` 入口统一把 `cmd.payload.*` 平铺到 `cmd.*`，兼容平铺写法。
- **DOM 选择器多层 fallback**：原来 `findModelSelectorBtn` 只匹配 `aria-label*="Model Selector"`，Windsurf 实际 DOM 不一定有这个 aria-label。新增三层 fallback：
  1. `aria-label`（原匹配）
  2. **按钮文本是已知模型名前缀**（claude- / gpt- / o1 / gemini / sonnet / haiku / opus 等）
  3. `data-testid` 含 "model"
- **影响**：`获取可用模型列表`、`当前模型`、`测试切换模型` 在 Windsurf 实际 UI 下应能正确工作（之前都因选择器不匹配而失败）。
- **审查教训**：之前几次"代码审查"只看了流程没真测端到端字段，已记录在反馈里。

### v4.17.1
- **🔴 修复切号失败"切号超时，扩展可能未响应"**：根因是 `sendPoolSignal` 仍走 `localStorage` 跨 origin 路径（vscode-file:// → vscode-webview:// 不通），signalBridge 永远收不到信号。
  - **修复**：`sendPoolSignal` 改用 HTTP 桥发起切号请求；`sidebarProvider.onBridgeResult` 识别 `type='pool-signal'` 后调 `autoSwitcher.forceSwitch`，结果通过 `enqueueCommand({action:'pool-result'})` 反向回传，windsurf-better.js 的 `handleSidebarCommand` 加 `pool-result` case 写回 localStorage 触发原处理逻辑。
  - **影响**：自动恢复中"额度耗尽切号 / 限流切号 / 模型不可用降级切号"等所有切号路径**真正可用**了。
- **通知样式优化**：
  - 位置从底部 → **右上角**（更符合常规 toast 习惯，不被聊天框挡住）
  - 渐变背景 + 类型化左侧色条（蓝=info / 绿=success / 红=error）
  - 自动判类型：根据消息内容关键词自动选色（"成功/已切换"→绿，"超时/失败/错误"→红）
  - 滑入动画 + 模糊背板 + 关闭按钮 ×
  - 防 XSS：消息文本 HTML 转义

### v4.17.0
- **桥服务器健壮性修复**（基于 v4.16.0 的多轮审查发现）：
  - **端口/Token 持久化复用**：扩展宿主启动桥时优先复用上次的 port/token（保存在 `enh-settings.json`），让 windsurf-better.js 嵌入的旧值仍能匹配；端口被占自动 fallback 到 OS 分配。**修复每次 Windsurf 启动都需要 reload 才能用桥功能的问题**。
  - **fallback 路径修复**：旧实现 EADDRINUSE 时 `listen(0)` 没传回调，导致 Promise 永远 pending、新端口不会写入 enh-settings。改用 `'listening'` 事件统一处理首次 listen 和 fallback 两种情况。
  - **CORS preflight 缓存**：`Access-Control-Max-Age: 86400`，避免 windsurf-better.js 每秒 `GET /pending` 都触发 OPTIONS 预检。
  - **增强未启用时跳过桥**：`windsurfPool.enhancement.enabled = false` 时不启动 HTTP server，节省一个端口。
- **首次安装体验**：首次激活会弹一次「立即重启」提示（因为桥端口要嵌入 workbench.html），重启后所有功能即时可用；后续启动端口稳定不再弹。

### v4.16.0
- **HTTP 桥（`bridgeServer.ts`）**：解决侧栏 webview 与 workbench 注入脚本因 origin 隔离导致的所有跨向通信失效问题。
  - **问题根因**：旧实现用 `localStorage` + `storage event` 通信，但两边 origin 不同（`vscode-webview://` vs `vscode-file://`），事件不会跨 origin 触发，导致以下功能**从未真正工作**：
    - 获取可用模型列表 / 测试切号 / 测试重试 / 测试切换模型 / 测试发送继续 / 测试权限
    - 完成提醒声音（`ws-pool-notify`）
    - windsurf-better.js 检测到错误时的"立即切号信号"（`ws-pool-signal`）
  - **方案**：扩展宿主进程启动 localhost HTTP server（端口由 OS 分配，绑 127.0.0.1，token 鉴权）。
    - webview ─ `postMessage('enhCommand')` → 扩展宿主 ─ `enqueueCommand` → 桥队列
    - windsurf-better.js 每秒 ─ `GET /pending` → 取走命令 → 执行 ─ `POST /result` → 扩展宿主 ─ `postMessage('enhCommandResult')` → webview
  - **CSP 调整**：`enhancementInjector.ts` 的 `ensureConnectSrc` 自动给 workbench.html 的 CSP 加 `connect-src http://127.0.0.1:* http://localhost:*`。
  - **端口/token 嵌入**：写入 `enh-settings.json` 的 `__bridgePort` / `__bridgeToken`，由现有的注入机制带到 `window.__WS_BETTER_INJECTED_SETTINGS__`。
- **🤖 无脑模式（`brainlessModeEnabled`）**：AI 停止 N 秒后自动发"继续"，让 AI 不停工作。
  - 默认**关闭**，需要在「自动操作」section 手动启用。
  - 可配置：`brainlessIdleSeconds`（空闲秒数，默认 8s）、`brainlessMaxConsecutive`（连发上限，默认 3 次）。
  - 智能跳过：检测到权限提示（accept all / always allow / 授权 / 允许）时不触发；AI 正在生成时不计时；和 recovery 模块共用 5s 全局冷却避免冲突。
- **autoContinue 防抖优化**：`MutationObserver` 加 200ms 防抖，避免边生成边触发数十次 `querySelectorAll`；增加 5s 自冷却 + 与 recovery 模块共用 `isInCooldown()` 防双触；按钮加 `isVisibleAndClickable()` 校验避免点不可见按钮。
- **windsurf-better.js v1.1.0+**：新增 bridge HTTP client（`startBridgePolling` / `bridgePostResult`）；`handleSidebarCommand` 改用 bridge 回 `respond`，旧 `localStorage` 跨 origin 路径作废。

### v4.15.0
- **汉化大幅扩充**：新增 30+ 条翻译，覆盖智能体切换（Switch agent / Switch agent location）、模型选择（Send the task to a single model / Select multiple models to compare）、Devin 相关（Devin Local / Devin Cloud / Describe your task to Devin）、错误提示（Model provider unreachable / 第三方模型提供商不可用 / 每周配额耗尽）、UI 文本（See more / Auto-fix / Install Update / Reasoning Effort / Your modified files / Prompt cache has expired / Higher cost expected / Cannot switch modes after cascade has started）等。
- **增强设置共享机制**：新增 `enhSettingsStore.ts`，侧栏修改增强设置后自动写入 `workbench.html`（通过 `window.__WS_BETTER_INJECTED_SETTINGS__` 全局变量嵌入），windsurf-better.js 启动时优先读取注入值，保证侧栏与增强脚本设置一致。
- **注入器设置感知**：`enhancementInjector.ts` 增加设置哈希检测，版本相同但设置变化时也会重新注入，确保改设置后无需手动重注入。
- **自动恢复冷却机制**：所有自动操作（重试、切号、发送继续）增加 3 秒冷却期，防止短时间内重复触发导致消息刷屏。
- **按钮可见性检查**：重试按钮和发送按钮点击前增加 `isVisibleAndClickable` 校验（检测 display/visibility/opacity/disabled），避免误点不可见按钮。
- **自动恢复面板重构**：恢复规则分类从 A/B/C/D 改为语义化名称（网络超时 / 配额耗尽 / 模型不可用 / 响应截断 / 权限请求 / 用户介入），新增模型优先级排序、可用模型获取、自定义规则等完整 UI。
- **windsurf-better.js v1.1.0**：设置加载优先级改为 注入值 > localStorage > 默认值；启动时同步合并后的设置回 localStorage。

### v4.14.0
- **新增「校验值修复」(`checksumFixer.ts`)**：从根本消除 Windsurf 启动时弹出的 `Your Windsurf installation appears to be corrupt. Please reinstall.` 提示。
  - **原理**：Electron 启动时按 `product.json` 中的 `checksums` 字段对若干核心文件（含 `workbench.html`）做 SHA256 校验，失败即弹通知。补丁/增强修改了这些文件就必然触发。
  - **方案**：增强注入和补丁应用后自动重算所有 checksums 项的真实哈希并写回 `product.json`，让校验通过。算法与 VS Code 内置一致：`SHA256 → base64 → 去尾部 = 填充`。
  - **配置**：`windsurfPool.enhancement.fixChecksums`（默认 `true`）。需要保留旧行为可关闭。
  - **手动命令**：命令面板搜「修复 product.json 校验值」（`windsurfPool.fixChecksums`），可独立触发；并显示是否需要修复及修复结果。
  - **兜底保留**：DOM 自动点掉「已损坏」通知的逻辑（`dismissCorruptEnabled`）保留，作为校验值修复失败时的双保险。
  - **备份恢复**：首次修改前自动备份为 `product.json.origin`；执行「恢复原始 Workbench」会一并恢复 `product.json`。
  - **已知现象**：Windsurf 自动更新后**首次启动**可能仍会闪一下「已损坏」通知（此时扩展尚未激活、checksums 还未重算），扩展激活后会自动修复，**第二次启动起完全无感**。该闪动已由 DOM 兜底逻辑关闭。
  - **权限要求**：`product.json` 已加入权限预检，macOS/Linux 若目录不可写会弹一键 `sudo chmod` 提示。

### v7.3.1
- **macOS LS 二进制搜索增强**：新增 `windsurf-next` 扩展目录、`~/Applications/` 路径、`find` 命令兜底，修复 Mac 上测活找不到 LS 的问题。
- **卡片错误摘要优化**：去掉模型前缀，英文 quota/exhausted 正确识别为限速，探针失败简短显示"探针检测异常"。
- **标签列重叠修复**：多标签自动换行，不再溢出到模型列。

### v7.3.0
- **测活面板默认配置调优**：默认模型改为 Claude Opus 4.6，并发改为稳定 x1，间隔改为 60 秒。移除 SWE-1.6 冗余静态选项。
- **测活面板暂停/停止按钮重设计**：pill 形状 + SVG 图标 + 半透明填充背景 + 平滑过渡动画；暂停态琥珀色，继续态绿色，停止按钮红色系。
- **构建修复**：修正 `tsconfig.json` 的 `rootDir` 配置，确保编译产物正确输出到 `out/` 目录。
- **切号通知去重**：blocked 类型只保留 webview toast，移除 VS Code 原生弹窗；非 blocked 类型走 showAlert 模态弹窗不再重复 toast。
- **命令面板失败反馈**：`switchAccount` / `switchNextAccount` 失败时显示具体原因。
- **自动恢复 Bug F 修复**：切号成功后 `waitForAIIdle` 回调补上 `autoRecoveryEnabled` 短路检查。

### v7.2.37
- **360 拦截优化（零 PowerShell 启动）**：
  - 所有启动路径的 PowerShell 调用替换为原生 Windows 命令（wmic / tasklist / taskkill / reg），不触发 360 等安全软件拦截。
  - `getRunningWindsurfEntries`: wmic 异步优先，PowerShell 降为 fallback。
  - `detectWindsurfExePath`: wmic 获取进程路径 + reg query 查注册表，不再用 PowerShell。
  - `warmupSoundPlayer`: 不在启动时预创建 PowerShell 进程，改为首次播放时惰性初始化。
  - `acpRecovery`: wmic 查询进程 + taskkill 终止，完全移除 PowerShell。
  - `findLsBinary`: wmic 替代 PowerShell Get-CimInstance。
  - `stopInstance`: taskkill 替代 PowerShell CloseMainWindow。
  - 所有 runShellAsync 添加 windowsHide: true，避免控制台弹窗。

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

</details>

---

<div align="center">

**Windsurf Pool** — 一个人的全栈工程，从 Electron 逆向到 DOM 注入到跨进程通信。

如果它让你的 AI 编程体验更流畅，Star ⭐ 或赞赏就是最大的动力。

<a href=""><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>&nbsp;
<a href=""><img src="https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>&nbsp;
<a href=""><img src="https://img.shields.io/badge/爱发电-946CE6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6TTIgMTdsMTAgNSAxMC01TTIgMTJsMTAgNSAxMC01Ii8+PC9zdmc+&logoColor=white" alt="爱发电"></a>

<sub>MIT License · Made with ❤️ by soulvon</sub>

</div>

---

<div align="center">

### 交流群

<img src="qqqun.jpg" width="240" alt="QQ 交流群二维码">

**Windsurf 增强插件交流群**｜群号：`1075342078`

</div>
