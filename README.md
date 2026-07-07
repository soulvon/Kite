<div align="center">

# Kite — AI IDE 增强套件

**面向 Windsurf / Devin 的界面增强、多实例、[AnyBridge](https://github.com/soulvon/AnyBridge) 模型路由与多账号号池工具**

界面增强 · [AnyBridge](https://github.com/soulvon/AnyBridge) 模型路由 · 多实例分身 · 多账号号池 · 自动恢复 · 长任务自动化

[![Version](https://img.shields.io/badge/version-8.7.14-blue?style=flat-square)](https://github.com/soulvon/Kite/releases/latest) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()

> 本项目由旧版 [windsurf-pool-releases](https://github.com/soulvon/windsurf-pool-releases) 迁移并重构而来。

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
  <b>Kite 插件交流群</b>｜群号：<code>1075342078</code><br>

</p>

---

## 它解决什么问题？

Windsurf 的 AI 配额用完就得等重置，手动切号要退出登录、重启编辑器，**正在进行的对话直接丢失**。多开窗口还会互相踢号。

Kite 在 **不退出、不重启、不丢失会话** 的前提下，把界面增强、[AnyBridge](https://github.com/soulvon/AnyBridge) 模型路由、多实例和多账号能力整合成一个 IDE 增强套件：配额快用完 → 自动切到最优账号 → 接着上次进度继续 → 你甚至感知不到发生了什么。

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
| **注入版本判断** | 以前靠手动维护 VERSION 常量决定是否重注入，多次遗漏导致用户装了新版不生效。改用脚本内容 SHA256 前 12 位作为版本标识，内容变 → hash 变 → 自动重注入 |
| **设置实时生效** | 侧栏改设置 → 扩展宿主写盘 → HTTP 桥推送 `apply-settings` 命令 → 注入脚本热更新 observer 开关，全链路无需 reload |
| **Windows UAC 合并** | 补丁注入 + 增强注入 + 校验值修复三步写操作合并为一次 UAC 提权弹窗，用户体验从弹 3 次变弹 1 次 |

## 快速开始

1. 下载最新 [`.vsix` 发布包](https://github.com/soulvon/Kite/releases/latest)
2. 命令面板 → `Extensions: Install from VSIX...` → 选择文件
3. 侧栏点击 **Kite** 图标 → 添加账号（登录 / 批量导入 / 从当前账户一键导入）
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

### v8.7.25
- **修复 Devin 安装后扩展宿主循环崩溃**：扩展 ID 从 `local.windsurf-pool` 改成 `local.kite` 后，Devin 会把它当成全新扩展，导致 globalState/globalStorage/secrets 分裂，并触发启动迁移、旧凭据恢复和进程探测等兼容逻辑。v8.7.25 将扩展 ID 恢复为稳定的 `local.windsurf-pool`，显示名仍为 Kite；同时 Devin 下默认关闭 PowerShell 旧凭据自动恢复和 `wmic` 进程探测，保留手动修复命令和显式开关。

### v8.7.24
- **Devin 稳定性修复**：恢复 `onStartupFinished` 激活时机，避免启动过早；Devin 下默认进入安全模式，不再自动注入 Workbench / 自动切号 / 自动 ACP 补丁；修复侧栏 `syncStrategyUI is not defined` 导致的 Webview 初始化错误。

### v8.7.13
- **修复扩展不激活问题**：将 `activationEvents` 从 `onStartupFinished` 改为 `*`，确保扩展安装后立即激活，避免在某些环境下因激活事件不触发导致侧栏白屏。

### v8.7.12
- **检测旧扩展冲突**：启动时检测是否仍安装旧扩展 `local.windsurf-pool`，若同时存在则弹窗提醒卸载，避免新旧扩展命令冲突导致扩展主机卡死/白屏。

### v8.7.11
- **保留 BYOK 入口并指向 AnyBridge**：Kite 不再内置 BYOK 功能，侧栏保留「BYOK」主 Tab，页面说明能力已迁移至姊妹项目 [AnyBridge](https://github.com/soulvon/AnyBridge)，并提供一键打开仓库按钮。

### v8.7.10
- **修复 mini toggle 开关视觉偏移**：将 `v2-mini-toggle` 开启状态 thumb 的 translate 从 `12px` 调整为 `10px`，使 thumb 在轨道右半区居中，避免贴边导致视觉上"歪"；同时补充 `margin-left: auto` 与 `flex-shrink: 0`，确保在 flex 条目中严格右对齐且不收缩。

### v8.7.9
- **汉化双模式**：新增「汉化模式」选择器，支持「实时翻译」和「补丁模式（流畅）」两种模式。实时模式使用 MutationObserver 实时翻译所有 DOM 变更（全面但可能卡顿）；补丁模式不启动 MutationObserver，仅启动时一次性翻译 + 每 10 秒轻量补扫（流畅但新内容有延迟）。可在侧栏增强面板中切换，实时生效无需重启。

### v8.7.8
- **深度修复 globalState 迁移**：`tryMigrateLegacyGlobalState` 改为同步函数（不 await），确保 `activate()` 中 `UsageTracker`/`AutoSwitcher` 等组件读取前数据已写入内存。添加 4 级 key 搜索策略覆盖不同 VS Code 版本的 globalState 存储格式。
- **修复 globalStorage 文件迁移**：添加 `oldDir === newDir` 安全检查防止自拷贝；支持递归复制子目录。
- **完整覆盖所有 globalState key**：`lastEmail`、`as.*`（自动切号 16 项设置）、`autoSwitchLogs`、`recoveryLogs`、`diagnoseLogs`、`anomalyCount`、`tagColors`、`usageTracker.stats`、`usageTracker.quotaHistory`、`usageTracker.diagnosticHistory`。

### v8.7.7
- **迁移 globalState 设置**：扩展名变更后 `globalState` 也按扩展 ID 隔离，导致自动切号设置（`as.*`）、`lastEmail`、切号日志、用量统计、配额历史等全部丢失。新增启动时自动从 `state.vscdb` 读取旧扩展 `local.windsurf-pool` 的 globalState 并写入新扩展。
- **迁移 globalStorage 文件**：磁盘缓存（`usage-cache.json`）、日志文件等存储在 `globalStorage/<extensionId>/` 下，路径随扩展名变化。新增启动时自动从旧目录复制文件到新目录。
- **修复自动切号设置重置**：用户无需重新配置自动切号策略、阈值、冷却时间等参数。

### v8.7.6
- **兼容旧版 windsurf-pool 凭据**：扩展名从 `windsurf-pool` 改为 `kite` 后，旧版存储在 VS Code secrets 中的 apiKey 无法直接读取。新增启动时自动尝试从旧版扩展 `local.windsurf-pool` 的加密 secrets 中恢复凭据（Windows DPAPI 解密），并新增命令面板命令 **"Kite: 修复缺失凭据"** 供手动触发。
- **凭据缺失时给出明确错误**：`fetchUsage`、`testModelAccess`、`injectSession` 在检测到 `apiKey` 为空时立即返回明确提示，避免静默失败。
- **修复账号刷新/切换失败**：因扩展 ID 变化导致 apiKey 丢失，刷新配额和切换账号失败。现在会自动尝试恢复并提示用户。

### v8.7.5
- 当前开发版本。

### v8.6.9
- **Devin 兼容增强**：补齐 ACP 自定义智能体解锁与本地 registry 兜底，降低远端 registry 异常时的影响。
- **汉化与注入稳定性补充**：同步 Devin / Windsurf 增强脚本的翻译与恢复逻辑，保持 8.6.x 系列修复生效。

### v8.5.0
- **BYOK 改为开发中状态**：侧栏与命令面板标记 BYOK 开发中；暂停新增配置、启动 Sidecar 和应用 Patch，保留停止 Sidecar / 恢复 Patch 以便清理旧状态。

### v8.4.31
- **自动化页交互与视觉修复**：修复左侧「长任务」入口与内部分段状态不同步的问题，优化自动化总开关对齐，并统一左侧子导航、分段控件和轻拟物小卡片的视觉风格。

### v8.4.30
- **侧栏视觉精简**：账号、实例、自动化、增强等主 Tab 去掉顶层面板背景、外框和大阴影，顶层区域固定展开并隐藏折叠箭头，整体调整为更接近 IDE-BYOK 的简洁科技轻拟物风格。

### v8.4.29
- **多实例分身界面微调**：去掉多实例分身区域的最外层面板边框、圆角背景和阴影，保留内部实例卡片边框。

### v8.4.28
- **BYOK 日志界面修复**：日志页增加运行日志标题、条数统计、空状态提示和稳定高度；窄侧栏下筛选/导出/清空按钮改为紧凑栅格，避免只剩一条灰色日志占位。

### v8.4.27
- **品牌与图标更新**：软件展示统一为 Kite，侧栏、设置页、命令分类和 README 定位文案去掉"IDE增强助手/IDE 号池管理"的旧表达，并换用新版 logo。

### v8.4.26
- **BYOK 供应商与模型映射交互升级**：供应商添加、模型选择和模型映射改为接近 IDE-BYOK 的全屏编辑体验，支持供应商模型列表、默认模型、映射搜索和清晰的状态反馈。
- **新增故障转移与扩展槽位管理**：模型映射可配置多目标顺序 failover；扩展槽位可从 Windsurf 模型目录启用，并为注入模型指定供应商、目标模型和图片能力。
- **新增 BYOK 显示名模板与运行统计**：支持 `{prefix}` / `{label}` / `{provider}` / `{apiModel}` 模板，侧栏显示请求、Token、重试、错误和最近

</details>

## 相关项目

模型路由、API 中转、自带 Key、BYOK 等能力由独立项目 [AnyBridge](https://github.com/soulvon/AnyBridge) 承担。

> **Kite →** 轻量的 IDE 增强与账号工作流工具
> **AnyBridge →** 模型路由与 API 层能力

---

## License

MIT
