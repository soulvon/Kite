# 星火无痕换号 VSIX 插件分析报告

> 版本: v8.4.3 | 发布者: SparkCore | 分析日期: 2025-07

---

## 目录

- [1. 基本信息](#1-基本信息)
- [2. 文件结构](#2-文件结构)
- [3. 架构概述](#3-架构概述)
- [4. 核心功能模块](#4-核心功能模块)
- [5. Auto-Continue 补丁详解](#5-auto-continue-补丁详解)
- [6. 命令与快捷键](#6-命令与快捷键)
- [7. 配置项](#7-配置项)
- [8. 多实例管理](#8-多实例管理)
- [9. 混淆策略](#9-混淆策略)
- [10. 数据存储与共享](#10-数据存储与共享)
- [11. 与 Electron 主体应用的关系](#11-与-electron-主体应用的关系)
- [12. 安全风险评估](#12-安全风险评估)
- [13. 总结](#13-总结)

---

## 1. 基本信息

| 字段 | 值 |
|---|---|
| **包名** | `xinghuo-windsurf` |
| **显示名** | 星火无痕换号 |
| **版本** | 8.4.3 |
| **发布者** | SparkCore |
| **作者** | xinghuoWindsurf |
| **许可证** | MIT |
| **引擎要求** | VSCode ^1.71.0 |
| **激活事件** | `onStartupFinished` |
| **分类** | AI, Other |
| **入口文件** | `dist/extension.js` (6.9MB) |

### 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `jsonc-parser` | ^3.3.1 | 解析带注释的 JSON 配置文件 |
| `sql.js` | ^1.13.0 | 操作 SQLite 数据库 (state.vscdb) |
| `uuid` | ^9.0.0 | 生成唯一标识符 (设备指纹/实例 ID) |

---

## 2. 文件结构

```
xinghuo-windsurf-8.4.3.vsix (ZIP)
├── [Content_Types].xml                    # VSIX 元数据
├── extension.vsixmanifest                 # 扩展清单
└── extension/
    ├── package.json                       # 扩展配置 (11KB)
    ├── readme.md                          # 功能文档 (10KB)
    ├── LICENSE.txt                        # MIT 许可证
    ├── resources/
    │   └── windsurf-icon.png              # 图标 (10KB)
    └── dist/
        ├── extension.js                   # 主逻辑 (6.9MB, 重度混淆)
        ├── sql-asm.js                     # sql.js WASM 运行时 (1.3MB)
        └── resources/
            ├── accountPanel.js            # 控制面板 WebView (131KB, 混淆)
            ├── instanceManager.html       # 分身管理页面
            ├── instanceManager.js         # 分身管理逻辑 (19KB, 混淆)
            ├── instanceManager.css        # 分身管理样式 (7KB, 明文)
            └── windsurf-icon.png          # 图标副本
```

---

## 3. 架构概述

```
┌─────────────────────────────────────────────────────┐
│                    Windsurf IDE                      │
│                                                      │
│  ┌──────────────────┐    ┌────────────────────────┐  │
│  │  Extension Host   │    │   Cascade Webview      │  │
│  │                   │    │                         │  │
│  │  extension.js     │◄──►│  [注入的AutoContinue]  │  │
│  │  (混淆主逻辑)     │HTTP │  配额检测/自动继续     │  │
│  │                   │桥   │  DOM 操作/切号信号     │  │
│  │  • 账号管理       │    │                         │  │
│  │  • Token 注入     │    └────────────────────────┘  │
│  │  • 补丁服务       │                                │
│  │  • 配额监控       │    ┌────────────────────────┐  │
│  │  • 指纹重置       │    │  Account Panel Webview  │  │
│  │  • 多实例管理     │◄──►│  accountPanel.js        │  │
│  │  • HTTP 桥服务    │IPC │  控制面板 UI            │  │
│  │  • 自检诊断       │    └────────────────────────┘  │
│  └──────────────────┘                                │
│          │                                           │
│          ▼                                           │
│  ┌──────────────────┐    ┌────────────────────────┐  │
│  │  state.vscdb      │    │  extension.js (被补丁)  │  │
│  │  (SQLite 账号库)  │    │  workbench.html (注入)  │  │
│  └──────────────────┘    └────────────────────────┘  │
└──────────────────────────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │ 共享数据目录          │
                    │ .xinghuowindsurf/    │
                    │   shared-data/       │
                    │   (与 Electron 互通) │
                    └─────────────────────┘
```

### 通信机制

1. **VSCode 命令注入**: 通过 `vscode.commands.executeCommand()` 调用 Windsurf 内置命令 (`windsurf.provideAuthTokenToAuthProvider` 等) 注入 Token
2. **HTTP 本地桥**: 端口 34580-34589, 路径 `/__xinghuo_auto_continue`，用于 Extension Host ↔ 注入的 Webview 脚本通信
3. **临时文件桥**: 通过 `%TEMP%` 下的 JSON 文件传递切号信号、设置更新、状态快照
4. **IPC (postMessage)**: Extension Host ↔ WebView Panel (accountPanel/instanceManager)

---

## 4. 核心功能模块

### 4.1 账号池管理

- 支持批量添加/同步账号
- 健康评分模型：可用 / 低额度 / 使用中 / 冻结 / 等待重置
- 失败黑名单自愈
- 归档账号恢复
- 账号有效期/配额批量刷新
- 批量验证并清理无效账号

### 4.2 无感切号 (Token 注入)

三级切号链路（优先级递减）：

| 优先级 | 链路 | 说明 |
|---|---|---|
| 1 | **补丁通道** | `provideAuthTokenToAuthProviderWithShit` (需先打切号注入补丁) |
| 2 | **命令注入** | `windsurf.provideAuthTokenToAuthProvider` / `codeium.provideAuthToken` / `windsurf.provideAuthToken` |
| 3 | **URI 回调** | 备用降级方案 |

- 切号前可选登出当前账号 (`logoutBeforeSwitch`)
- 自定义注入命令列表，兼容 Windsurf fork (Trae/Void/Kiro)
- 跨窗口 localStorage 锁，避免多窗口并发切号冲突

### 4.3 配额自动换号

- 实时监控日/周配额
- 配额耗尽自动切到下一个可用账号
- 健康评分优先选择高额度账号
- 避免乒乓切换（规避最近使用过的账号）

### 4.4 消息锚定切号

- 嗅探 Cascade 发消息瞬间即刻换号
- 多探针（cascade 文件 + network 事件）双保险
- 低可信单独命中自动降级为仅记录诊断

### 4.5 自动预热

- 后台定时刷新所有账号 Token 与会话
- 切号时零等待秒切
- 并发受控，避免触发风控

### 4.6 补丁系统

| 补丁名称 | 功能 | 修改目标 |
|---|---|---|
| **Switch Injection** | apiKey 直注 secret session，切号最快通道 | `extension.js` |
| **Auto-Continue** | 解除 Cascade 对话回合数限制 | `workbench.html` |
| **Model Unhide** | 修改 webview `MAX_INVOCATIONS` | webview 相关文件 |
| **Pro UI 伪装** | 前端显示 Pro 等级 (仅显示层) | UI 相关文件 |

安全机制：
- `保存 Windsurf 原版` → 打补丁前的安全网 (Baseline)
- `还原 Windsurf 原版` → 一键回到未打补丁状态
- `从备份恢复扩展` → 三重安全网
- `修复扩展 (清理重复补丁)` → 清理异常状态

### 4.7 设备指纹重置

- 手动刷新设备指纹 (后台静默, 下次启动生效)
- 设备码重置并自动重启 Windsurf
- 解除 "too many free" 限流

### 4.8 节省积分

- 优化 API 调用策略
- 智能合并请求
- 延长单个账号使用时长

---

## 5. Auto-Continue 补丁详解

`extension.js` 中包含 **两份完整的 Auto-Continue 脚本模板**（lines 2-1988 和 lines 1990-3976），均为**明文未混淆**代码，作为模板字符串嵌入，在打补丁时注入到 Windsurf 的 `workbench.html` 中。

### 5.1 核心子系统

#### 配额耗尽检测 (`detectQuotaExhausted`)

三层结构化扫描路径（优先级递减）：

1. **浮层 Banner**: `div[class*="z-"][class*="absolute"][class*="rounded/bg-red/bg-yellow"]`
2. **z-index 绝对定位兜底**: `div.absolute`, `div[class*="z-10/20/30/40/50"]`
3. **Step 内联红条**: `[data-step-index] div[class*="bg-red-6/bg-yellow-6"]`

关键词匹配：
```javascript
EXHAUST_KEYWORDS = [
    'your included usage quota is exhausted',
    'your included daily usage quota is exhausted',
    'your included weekly usage quota is exhausted',
    'quota is exhausted',
    'usage quota is exhausted',
    'purchase extra usage',
    'purchase additional usage',
    'continue using premium models',
    '配额已用完', '每日配额已用完'
];
```

#### 防误判系统

- **忽略区域**: Monaco 编辑器、终端面板、通知中心、Problems/Output 面板、聊天历史引用
- **源码检测**: 如果文本包含 `var exhaust_keywords`、`hunt_keywords` 等，认为是源码而非真实红条
- **讨论语境**: 中文讨论关键词 + quota 关键词 = 用户在讨论 quota
- **终端输出**: 包含 shell 提示符/命令特征的文本被排除
- **DOM 新鲜度**: WeakSet 去重，同一 DOM 元素只触发一次

#### 自动发送 "继续" (`startAutoContinue`)

完整流程：

```
检测触发 → 用户输入保护 → 节流/冷却 → 配额/截断判定
    ↓ 配额真正耗尽
    → requestAccountSwitch → 后端切号 → 等待完成 → 发送 "继续前一个被网络中断的任务"
    ↓ 仅截断
    → setInputText("继续") → 点击 submit / Enter 兜底 → 验证发送 → 重试(最多8次)
```

输入框写入策略（按优先级）：
1. Lexical Editor API 直接写入
2. 全选删除 + `insertText`
3. DOM 兜底 (创建 `<p>` 节点)

#### HTTP 桥通信

```
Extension Host ←→ localhost:34580-34589/__xinghuo_auto_continue/
    /quota-hit       — 配额命中通知 (70s 超时，同步等待切号)
    /quota-switch    — 请求切号 (70s 超时)
    /pull-settings   — 拉取最新设置 (每 2s)
```

- 并行尝试 10 个端口 (34580-34589)，任一成功即返回
- AbortController 超时控制
- 支持文件桥和 HTTP 桥双通道

#### 空闲自动继续 (`startIdleContinueMonitor`)

- 阈值: 30-300 秒可配置
- 每 15 秒检查一次
- 排除条件：AI 正在生成 (lucide-square 停止按钮可见)、配额耗尽、用户正在输入、AI 在提问、有 "Continue response" 按钮

#### 限流自动继续 (`detectRateLimitAndContinue`)

```javascript
RATE_LIMIT_KEYWORDS = [
    'permission denied: rate limit exceeded',
    'rate limit exceeded', 'rate limit error'
];
RATE_LIMIT_REAL_MARKERS = [  // 双重确认，防止聊天引用误判
    'trace id', 'credits were used', 'request was not processed',
    'try again in about', 'upgrade to a pro account', 'add-credits'
];
```

- 30 秒节流 + DOM WeakSet 去重 + hash 去重
- 同时读 localStorage 跨刷新节流

#### Corrupt 警告自动关闭 (`startCorruptWarningDismiss`)

- 关键词: `corrupt`, `reinstall`, `unsupported`, `modified`, `损坏`, `重新安装`
- MutationObserver 常驻监听 + 多时间点主动扫描 (1s/3s/10s/30s/60s)
- 整个 Windsurf 生命周期运行，不断开

#### AI 提问检测 (`detectAiQuestion`)

支持中英文 30+ 种提问模式识别，命中时发送系统通知。

### 5.2 状态管理

| 状态文件 | 用途 |
|---|---|
| `_settingsUpdatePath` | 设置热更新 (每 2s 轮询) |
| `_statusPath` | 运行时状态快照 (每 2s 写入) |
| `_switchSignalPath` | 切号信号 (pending/done/failed) |
| `_hunterHitFile` | 配额捕手命中记录 |

---

## 6. 命令与快捷键

### 注册的命令 (22 个)

| 命令 ID | 功能 |
|---|---|
| `xinghuo.refresh` | 刷新面板 |
| `xinghuo.switchNext` | 切换下一个账号 |
| `xinghuo.dialog.show` | 显示对话框 |
| `xinghuo.repairExtension` | 修复扩展 (清理重复补丁) |
| `xinghuo.restoreFromBackup` | 从备份恢复扩展 |
| `xinghuo.saveWindsurfBaseline` | 保存 Windsurf 原版 |
| `xinghuo.restoreWindsurfBaseline` | 还原 Windsurf 原版 |
| `xinghuo.enableProSkin` | 开启 Pro UI 伪装 |
| `xinghuo.disableProSkin` | 关闭 Pro UI 伪装 |
| `xinghuo.applyAutoContinuePatch` | 应用 Auto-Continue 补丁 |
| `xinghuo.removeAutoContinuePatch` | 移除 Auto-Continue 补丁 |
| `xinghuo.applySwitchInjectionPatch` | 应用切号注入补丁 |
| `xinghuo.removeSwitchInjectionPatch` | 移除切号注入补丁 |
| `xinghuo.applyModelUnhidePatch` | 应用 Model Unhide 补丁 |
| `xinghuo.removeModelUnhidePatch` | 移除 Model Unhide 补丁 |
| `xinghuo.checkUpdate` | 检查更新 |
| `xinghuo.showAdaptiveSnapshot` | 查看自适应运行时快照 |
| `xinghuo.showInstances` | 查看活跃实例列表 |
| `xinghuo.clearBlacklist` | 清空失败黑名单 |
| `xinghuo.restoreArchived` | 恢复归档账号 |
| `xinghuo.scanExpiry` | 刷新所有账号有效期/配额 |
| `xinghuo.verifyAll` | 批量验证并清理无效账号 |
| `xinghuo.panicSwitch` | 紧急切号 |
| `xinghuo.showActivateHealth` | 查看激活健康报告 |
| `xinghuo.selfTest` | 统一自检 |
| `xinghuo.resetFingerprint` | 手动刷新设备指纹 |
| `xinghuo.resetFingerprintAndRestart` | 设备码重置 + 自动重启 |
| `xinghuo.toggleDevMode` | 切换开发者日志模式 |
| `xinghuo.openInstanceManager` | 分身管理 |

### 快捷键

| 操作 | Windows/Linux | macOS | 前置条件 |
|---|---|---|---|
| 切换下一个账号 | `Ctrl+Alt+S` | `Cmd+Alt+S` | `enableShortcutSwitch = true` |

---

## 7. 配置项

| Key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enableAutoSwitch` | boolean | false | 配额用尽自动切号 |
| `enableSavePoints` | boolean | false | 节省积分 |
| `enableShortcutSwitch` | boolean | false | 快捷键换号 |
| `injectCommands` | string[] | [] | 自定义注入命令 (兼容 fork) |
| `notifyLevel` | enum | "notify" | silent / notify / verbose |
| `manualProxyPort` | string | "" | 本地代理端口 (127.0.0.1) |
| `disableProxy` | boolean | false | 强制直连 (忽略代理) |
| `logoutBeforeSwitch` | boolean | false | 切号前先登出 |
| `preferShitInject` | boolean | true | 优先走补丁通道切号 |

---

## 8. 多实例管理

独立的分身管理系统，通过 `xinghuo.openInstanceManager` 命令打开 WebView Panel。

### 功能
- **创建分身**: 选择账号创建并自动登录，或创建空白分身
- **实例操作**: 启动 / 停止 / 删除
- **状态监控**: 每 5 秒自动刷新
- **独立数据**: 每个分身有独立的数据目录，互不干扰

### UI
- 使用 VSCode 主题变量，亮暗色自适应
- 表格展示：分身名、状态、登录账号、创建时间、操作
- 底部消息条 + 计数提示

---

## 9. 混淆策略

| 组件 | 大小 | 混淆级别 | 技术 |
|---|---|---|---|
| `extension.js` 主逻辑 | ~6.9MB | **重度** | webpack-obfuscator (字符串 Base64+RC4、控制流扁平化、十六进制变量名) + terser |
| `accountPanel.js` | 131KB | **重度** | 同上 |
| `instanceManager.js` | 19KB | **重度** | 同上 |
| Auto-Continue 模板 | ~4000 行 | **明文** | 未混淆 (模板字符串，运行时注入) |
| `instanceManager.html` | 2KB | **明文** | HTML 模板 |
| `instanceManager.css` | 7KB | **明文** | CSS 样式 |

### 混淆特征

```javascript
// 原始代码 (推测)
const accounts = this.accountMap;

// 混淆后
this[cMq(D6z.l,D6z.i,D6z.z,D6z.J,D6z.e)+cMi(D6z.M,D6z.g,0x549f,D6z.s,0x3544)]
```

- 所有字符串通过查表函数 + RC4 解码
- 控制流被扁平化为 switch-case 循环
- 变量名全部替换为十六进制

---

## 10. 数据存储与共享

### 数据目录

| 平台 | 路径 |
|---|---|
| Windows | `%APPDATA%\.xinghuowindsurf\shared-data\` |
| macOS | `~/Library/Application Support/.xinghuowindsurf/shared-data/` |

### SQLite 操作

通过 `sql.js` (纯 JS SQLite 实现) 操作 Windsurf 的 `state.vscdb`：
- 读取/写入认证 Token
- 账号信息持久化
- 会话状态管理

### 临时文件

Auto-Continue 补丁使用 `%TEMP%` 下的文件进行进程间通信：
- 设置更新文件
- 运行时状态快照
- 切号信号文件
- 配额捕手命中记录

---

## 11. 与 Electron 主体应用的关系

VSIX 插件与之前分析的 Electron 桌面应用 (`xinghuo_analysis/`) 是**同一产品的两个组件**：

| 维度 | Electron 主体 | VSIX 插件 |
|---|---|---|
| **运行环境** | 独立桌面应用 | Windsurf 扩展 |
| **安装方式** | NSIS 安装器 | VSIX 本地安装 |
| **核心功能** | 注册/绑卡/全局管理 | 切号/补丁/无人值守 |
| **数据共享** | 写入 shared-data | 读写 shared-data |
| **混淆** | javascript-obfuscator (商业模块) | webpack-obfuscator (全量) |
| **UI** | Electron + 毛玻璃 | VSCode WebView |
| **补丁能力** | windsurfPatchService.js | 内置补丁系统 |

互补关系：
- **Electron 端**: 负责账号注册、批量管理、虚拟卡绑定、Firebase/Devin 双通道认证
- **VSIX 端**: 负责 IDE 内无感切号、配额监控、自动继续对话、补丁注入、多实例管理

两端通过 `shared-data` 目录共享账号池，实现"任意一端操作互通"。

---

## 12. 安全风险评估

### 高风险

| 行为 | 风险等级 | 说明 |
|---|---|---|
| **修改 extension.js** | 🔴 高 | Switch Injection 补丁直接修改 Windsurf 核心文件 |
| **注入 workbench.html** | 🔴 高 | Auto-Continue 脚本注入到 IDE 渲染进程 |
| **操作 state.vscdb** | 🔴 高 | 直接写入认证数据库伪造登录状态 |
| **设备指纹重置** | 🔴 高 | 规避 Windsurf 的设备绑定限制 |
| **自动关闭完整性警告** | 🔴 高 | 掩盖文件修改痕迹 |
| **Trusted Types 策略** | 🟡 中 | Auto-Continue 创建自定义 TrustedTypes policy 绕过安全限制 |

### 隐私方面

- README 声明"不上报用户信息"
- 配额查询仅访问 Windsurf 官方 API 或用户配置的代理
- 但主体混淆代码无法验证是否有遥测/回传

### 与 Windsurf TOS 冲突

- 多账号轮转绕过配额限制
- 设备码重置规避 "too many free" 限流
- 修改 IDE 核心文件
- Pro UI 伪装

---

## 13. 总结

星火无痕换号 VSIX 插件是一个**功能极其丰富的 Windsurf IDE 账号自动化管理工具**，与同名 Electron 桌面应用配合使用，形成完整的"账号池 + 无感切号 + 自动对话"工作流。

### 技术亮点

1. **三级切号链路**: 补丁通道 → 命令注入 → URI 回调，逐级降级，用户无感
2. **Auto-Continue 引擎**: ~4000 行明文代码实现了完整的 DOM 监控、配额检测、自动发送、错误重试、防误判系统
3. **HTTP 本地桥**: 10 端口并行探测，解决 Webview 沙盒与 Extension Host 的通信难题
4. **多实例管理**: 独立数据目录实现多账号同时在线
5. **健康评分模型**: 账号池智能调度
6. **三重安全网**: 基线备份 + 还原 + 修复，补丁可完全回滚

### 工程规模

- 主逻辑 6.9MB (混淆后)，估计原始代码量 30,000+ 行
- 22 个注册命令
- 9 个可配置项
- Auto-Continue 模板约 4000 行明文代码
- 完善的错误处理和降级机制

### 风险总结

该插件通过修改 Windsurf IDE 核心文件、伪造认证状态、重置设备标识等方式，系统性地绕过 Windsurf 的付费限制和使用配额。虽然提供了完善的回滚机制，但其核心行为违反 Windsurf 服务条款，存在账号封禁和法律风险。

---

## 附录 A: 反混淆详细分析

> 以下内容基于自定义 VM 沙盒反混淆工具提取的 1584 个解码字符串、结合 AST 常量对象解析和人工逻辑推演。

### A.1 反混淆方法论

混淆器为 **javascript-obfuscator**，使用如下保护层：

| 保护层 | 说明 |
|---|---|
| **字符串数组** | 所有明文字符串替换为 Base64+RC4 编码值，存入数组 `T()` / `B()` |
| **数组旋转** | IIFE 将数组循环移位直到校验和匹配，防止静态提取 |
| **解码函数** | `z(idx)` / `D(idx)` 通过索引+RC4密钥还原原始字符串 |
| **别名分裂** | 解码器通过 `var o=z, H=z` 等别名分散调用 |
| **常量对象间接引用** | 索引值存入 `const II={R:0x1c3,...}`, 调用变为 `o(II.R)` |
| **5参数包装函数** (仅extension.js) | `DH(a,b,c,d,e)` 只取其中2个参数计算实际索引 |
| **控制流扁平化** | `switch(L[k++])` + 乱序 case 标签 |
| **十六进制常量** | 所有数字替换为 `0x1ac` 等十六进制表达式 |
| **死代码注入** | 永远不执行的分支干扰分析 |

**工具链**: 自主开发 Node.js VM 沙盒反混淆器 (`deob_v5.js` / `deob_v6_ast.js`)，在隔离 VM 中执行字符串初始化代码，枚举所有有效索引解码，再通过正则+AST替换。

### A.2 instanceManager.js 逻辑还原

反混淆后提取 **64 个字符串**，**72 处引用**替换成功。还原的完整逻辑：

#### DOM 元素映射

| 变量 | DOM ID | 用途 |
|---|---|---|
| `s` | `instanceBody` | 实例表格 tbody |
| `E` | `accountSelect` | 账号下拉选择框 |
| `S` | `btnCreateWithAccount` | "以账号开新分身"按钮 |
| `Y` | `btnCreateBlank` | "创建空白分身"按钮 |
| `f` | `btnRefresh` | 刷新按钮 |
| `i` | `msgBar` | 消息提示条 |
| `v` | `countHint` | 底部计数提示 |

#### 数据结构

```
F = []   // 实例列表 [{id, name, running, email, accountLabel, pid, createdAt, ...}]
G = []   // 账号列表 [{id, email, nickname, isCurrent, ...}]
b = null // 消息自动隐藏定时器
```

#### 核心函数

| 函数 | 功能 |
|---|---|
| `n(d)` | HTML 转义 (`&` `<` `>` `"` `'`) |
| `D(y)` | 日期格式化 → `YYYY/MM/DD HH:mm` |
| `u(type, msg)` | 显示消息条 (info=5s / error=8s 自动隐藏) |
| `J()` | 渲染账号下拉列表，显示昵称、当前账号标记 `[当前]`、isCurrent 标识 |
| `q()` | 更新创建按钮状态：未选择账号时禁用 |
| `a()` | 渲染实例表格：名称/状态徽章/邮箱/创建时间/操作按钮 |

#### 状态徽章渲染

```
running=true  → <span class="status-badge running">运行中 #PID</span>
running=false → <span class="status-badge stopped">已停止</span>
```

#### 邮箱显示逻辑

```
instance.email 存在      → <span class="cell-email">email</span>
instance.accountLabel 存在 → <span class="cell-email dim">(accountLabel 自动) </span>
都没有                    → <span class="cell-email dim">未登录</span>
```

#### VSCode IPC 消息

| 消息类型 (outgoing) | 触发 | 携带参数 |
|---|---|---|
| `createInstance` | 点击"以账号开新分身" | `{accountId}` |
| `createBlankInstance` | 点击"创建空白分身" | 无 |
| `listInstances` | 点击刷新 / 初始化 | 无 |
| `listAccountList` | 点击刷新 / 初始化 | 无 |
| `launch` | 表格内"▶ 启动"按钮 | `{instanceId}` |
| `stop` | 表格内"停止"按钮 | `{instanceId}` |
| `deleteInstance` | 表格内"删除"按钮 | `{instanceId}` |
| `renameInstance` | 表格内"改名"按钮 | `{instanceId, oldLabel}` |

| 消息类型 (incoming) | 处理 |
|---|---|
| `instanceList` | 更新 `F` 数组，重新渲染表格 |
| `accountList` | 更新 `G` 数组，重新渲染下拉框 |
| `info` | 显示信息提示 |
| `error` | 显示错误提示 |

#### 事件委托

表格操作使用事件委托模式：点击事件冒泡到 `tbody`，通过 `closest('[data-action]')` 获取 `data-action` (launch/stop/delete/rename) 和 `data-id` (instanceId)。

### A.3 accountPanel.js 字符串分析

反混淆提取 **1520 个字符串**，涵盖完整 UI 功能。关键发现：

#### 功能开关 (Toggle) 体系

从解码字符串中提取的开关列表（与 `package.json` 配置项对应，但面板内开关远多于外部配置）：

| 开关标识 (碎片拼接) | 功能 |
|---|---|
| `enableAutoSwitch` + `Toggle` | 配额自动换号 |
| `enableShortcutSwitch` | 快捷键换号 |
| `enableSavePoints` | 节省积分 |
| `enableQuota` + `Toggle` | 配额监控 |
| `enableIdle` + `Continue` | 空闲自动继续 |
| `enableAi` + `Toggle` | AI 提问检测 |
| `enableTo` + `kenPre` + `heat` | Token 预热 |
| `enableNo` + `Proxy` | 免魔法模式 |
| `enableRa` + `teLimitDetect` | 限流检测 |
| `enableAd` + `vancedCo` + `ntinue` | 高级持续对话 |
| `toggleBa` + `seline` | 基线管理 |
| `toggleQu` + `ota` | 配额面板 |
| `toggleDi` + `ag` | 诊断面板 |
| `toggleSo` + `rt` | 排序切换 |
| `toggleFe` + `ature` | 功能指标 |
| `toggleCa` + `rd` | 账号卡片模式 |
| `toggleAu` + `toRun` | 自动运行 |
| `modelUnh` + `ide` | 模型解锁 |
| `noProxyS` + `witch` | 无代理切换 |
| `messageA` + `nchor` | 消息锚定 |
| `switch-a` + `uto` | 自动切号 |

#### 配额系统 UI 字段

| 字符串碎片 | 含义 |
|---|---|
| `quotaErr` | 配额错误 |
| `quotaAut` + `oSwitch` | 配额自动切号 |
| `quotaText` | 配额文本 |
| `quota-delta-down` / `delta-up` | 配额变化指示器 (↓↑) |
| `weeklyQuota` + `Count` | 周配额计数 |
| `quotaRemain` + `ing` | 剩余配额 |
| `todayMessages` | 今日消息数 |
| `streakDays` | 连续天数 |
| `promptTokens` | Prompt 可用积分 |
| `Flow可用积分` | Flow 积分显示 |
| `maxStreaming` | 最大流式数 |

#### 账号管理 UI 功能

| 字符串碎片 | 含义 |
|---|---|
| `正在添加账号..` | 批量添加中 |
| `正在删除账号..` | 删除中 |
| `正在刷新配额..` | 配额刷新 |
| `批量添加完成：成功/失败` | 批量结果 |
| `未解析到有效账号` | 输入验证 |
| `此账号未在管理库` | 未导入提示 |
| `请输入邮箱地址` | 输入提示 |
| `请输入密码` | 密码输入 |
| `Token 获取` | Token 状态 |
| `冻结账号` / `解冻` | 冻结/解冻 |
| `❄️ 已冻结` | 冻结状态标记 |
| `⏱ 待重置` | 等待重置 |
| `batchAdd` | 批量添加 |
| `accountCard` | 账号卡片 |
| `acDiagSkip` / `acDiagRun` | 账号诊断跳过/运行 |

#### 补丁系统 UI

| 字符串碎片 | 含义 |
|---|---|
| `Auto-Continue 补丁` | AC 补丁标识 |
| `效，点击还原原版` | 补丁生效提示 |
| `patch-baseline` | 基线管理 |
| `点击启用，自动备份并应用补丁` | 补丁启用说明 |
| `点击关闭 Auto-Continue` | AC 关闭 |
| `还原原版` | 还原操作 |
| `不可还原` | 不可逆提示 |
| `当前版本不兼容` | 版本检查 |
| `份并应用补丁` | 备份+应用 |
| `后端/前端补丁` | 补丁类型 |

#### 状态与运行时信息

| 字符串碎片 | 含义 |
|---|---|
| `加载中...` / `读取中...` | 加载状态 |
| `刷新完成` | 刷新结果 |
| `共享数据不可用` | 共享目录异常 |
| `正在检查新版本..` | 更新检查 |
| `正在准备设备码重置` | 指纹重置 |
| `isSwitch` + `ing` | 切号中状态锁 |
| `autoHide` | 自动隐藏 |
| `health` | 健康评分 |
| `baseline` | 基线状态 |
| `tokenStatus` | Token 状态 |

### A.4 extension.js (webpack 主包) 关键标识符

主包使用 **5参数包装函数 + 常量对象**双重间接引用，正则无法直接解码。通过残留明文标识符提取的关键信息：

#### 核心函数名 (明文残留)

| 标识符 | 用途 |
|---|---|
| `provideAuthToken` | 认证 Token 提供 |
| `provideAuthTokenToAuthProvider` | 提供 Token 给认证提供者 |
| `provideAuthTokenToAuthProviderWithShit` | 补丁通道 Token 注入 |
| `switchNext` | 切换下一个账号 |
| `autoSwitch` | 自动切换 |
| `autoContinue` | 自动继续 |
| `savePoint` | 节省积分 |
| `baseline` | 基线管理 |
| `machineId` | 设备 ID |
| `modelUnhide` | 模型解锁 |
| `quota` | 配额 |

#### 中文残留字符串 (line 1 webpack 包)

```
版本 保存 补丁 补全 超快 超时 成功 触发
存在 代码 登录 冻结 恢复 继续 兼容 脚本
解冻 可写 空闲 路径 密码 免费 配置 启动
切号 清理 权限 认证 设定 设置 识别 数量
所有 探测 提示 跳过 停用 停止 修改 账号
```

#### 中文残留字符串 (line 3977 第二份 Auto-Continue)

```
补丁未正确加载       切号注入返回成功
旧登录链路           真实登录账号未确认
切号冷却             正在切号
注入刚失败           注入失败
指纹                 登录失败
空闲                 免费
冷却                 权限
```

### A.5 accountPanel.js 面板功能架构还原

基于 1520 个解码字符串和代码结构分析，accountPanel 的完整 UI 架构：

```
┌──────────────────────────────────────────────┐
│  星火无痕换号 控制面板                         │
├──────────────────────────────────────────────┤
│                                               │
│  ┌─ 账号列表 ─────────────────────────────┐  │
│  │ [搜索框] [排序切换] [批量添加] [刷新]    │  │
│  │                                         │  │
│  │ ┌─ 账号卡片 ──────────────────────────┐ │  │
│  │ │ 📧 user@example.com                 │ │  │
│  │ │ 状态: ✅可用  Plan: Pro  Token: ✓    │ │  │
│  │ │ 日配额: 45/50  周配额: 280/500       │ │  │
│  │ │ 配额变化: ↓5 (delta-down)           │ │  │
│  │ │ 今日消息: 12  连续天数: 5            │ │  │
│  │ │ Prompt积分: 1200  Flow积分: 800     │ │  │
│  │ │ [切换] [冻结] [删除] [详情▾]         │ │  │
│  │ │ ┌─ 详情展开 ───────────────────┐    │ │  │
│  │ │ │ Token 状态 / 有效期 / 健康分   │    │ │  │
│  │ │ │ 诊断: [跳过] [运行]           │    │ │  │
│  │ │ └─────────────────────────────┘    │ │  │
│  │ └──────────────────────────────────┘ │  │
│  └─────────────────────────────────────┘  │
│                                               │
│  ┌─ 功能开关区 ──────────────────────────┐  │
│  │ ☐ 配额自动换号    ☐ 快捷键换号         │  │
│  │ ☐ Token 预热      ☐ 消息锚定           │  │
│  │ ☐ 空闲自动继续    ☐ AI 提问检测        │  │
│  │ ☐ 节省积分        ☐ 免魔法模式          │  │
│  │ ☐ 限流检测        ☐ 高级持续对话        │  │
│  │ ☐ 自动运行模式    ☐ 模型解锁            │  │
│  └────────────────────────────────────────┘  │
│                                               │
│  ┌─ 补丁管理 ────────────────────────────┐  │
│  │ Auto-Continue: [已生效/点击启用]        │  │
│  │ Switch Injection: [已生效/点击启用]     │  │
│  │ Model Unhide: [已生效/点击启用]         │  │
│  │ Pro UI: [已生效/点击启用]               │  │
│  │                                         │  │
│  │ [保存原版] [还原原版] [基线管理]         │  │
│  └────────────────────────────────────────┘  │
│                                               │
│  ┌─ 多开管理 ────────────────────────────┐  │
│  │ [分身管理] → 打开 instanceManager      │  │
│  └────────────────────────────────────────┘  │
│                                               │
│  底部: 版本 8.4.3 | N 个账号 | 更新检查       │
└──────────────────────────────────────────────┘
```

### A.6 反混淆工具产出

| 文件 | 说明 |
|---|---|
| `scripts/deob_v5.js` | VM 沙盒全文件执行反混淆器 |
| `scripts/deob_v6_ast.js` | AST 常量对象 + VM 联合反混淆器 |
| `deobfuscated/instanceManager_clean.js` | instanceManager 反混淆结果 (64 strings, 72 refs) |
| `deobfuscated/accountPanel_deep.js` | accountPanel 反混淆结果 (1520 strings) |
| `deobfuscated/accountPanel_deep_strings.json` | accountPanel 完整字符串映射表 |
| `deobfuscated/instanceManager_clean_strings.json` | instanceManager 字符串映射表 |

### A.7 反混淆局限性

| 组件 | 反混淆程度 | 主要障碍 |
|---|---|---|
| `instanceManager.js` | **85%** | 常量对象间接引用部分未替换 |
| `accountPanel.js` | **65%** | 1520 字符串已解码但间接引用替换率低；碎片化字符串需人工拼接 |
| `extension.js` (webpack) | **15%** | 5参数包装函数+常量对象双重间接引用；需完整 Babel AST 变换 |
| Auto-Continue 模板 | **100%** | 原始明文，无需反混淆 |
