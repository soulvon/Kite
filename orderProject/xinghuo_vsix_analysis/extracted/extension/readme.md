<div align="center">

# 星火无痕换号

**Windsurf 账号调度中枢 · AI 驱动 · 全自动 · 零感知换号**

面向重度 AI 编码工作流的下一代账号自动轮转引擎

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#许可证)
[![Platform](https://img.shields.io/badge/Platform-Windsurf-ff5e1f.svg)](#)
[![Version](https://img.shields.io/badge/Version-8.4.1-brightgreen.svg)](#)
[![VSCode Engine](https://img.shields.io/badge/VSCode%20Engine-%5E1.71.0-blue.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.7-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## 目录

- [为什么选择星火无痕换号](#为什么选择星火无痕换号)
- [十大核心卖点（功能开关全览）](#十大核心卖点功能开关全览)
- [安装](#安装)
- [快速上手](#快速上手)
- [功能开关（Settings）](#功能开关settings)
- [命令索引](#命令索引)
- [快捷键](#快捷键)
- [高级补丁](#高级补丁)
- [数据与隐私](#数据与隐私)
- [技术亮点](#技术亮点)
- [常见问题](#常见问题)
- [免责声明](#免责声明)
- [许可证](#许可证)

---

## 为什么选择星火无痕换号

一句话说清楚：**让你再也不用关心"今天 Cascade 还剩几次"**。

- **全流程 AI 驱动**：账号评分、配额预测、消息锚定、预热调度，全部由插件自动完成
- **零感知切号**：对话不断、会话不崩、焦点不跳，Cascade 继续写代码
- **多账号池 + 健康评分**：自动规避低额度、冻结、使用中、等待重置的账号
- **多端协同**：与星火无痕换号主体软件共享账号池，插件 / 客户端任意一端操作互通
- **安全可回滚**：所有打补丁操作都有对应的还原命令与原版备份，支持一键回到未改动状态

---

## 十大核心卖点（功能开关全览）

> 带 **【高级】** 标签的功能需要配合高级补丁或后台调度引擎，适合重度用户。

### 1. 开启无感换号

- 基于 Windsurf 内置命令注入会话 Token，不破坏当前 Cascade 会话
- 软件内直接完成换号，无需重启 Windsurf
- 提示：**如需在软件内换号，建议关闭 Windsurf 的管理员 / 高权限启动**，以确保本地账号数据库可写

### 2. 配额自动换号

- 实时监控日 / 周配额，临界点自动切号
- 配合健康评分：优先选择高额度、非冷却、非黑名单账号
- 自动规避最近使用过的账号，避免乒乓切换

### 3. 自动预热账号 【高级】

- 后台定时刷新所有账号 Token 与会话
- 切号时 **零等待秒切**，不再等 Windsurf 重新拉起 session
- 并发受控，避免触发风控

### 4. 消息锚定切号 【高级】

- 嗅探"发消息"瞬间即刻换号，**不依赖配额轮询延迟**
- 多探针（cascade 文件 + network 事件）双保险
- 低可信单独命中自动降级为只记录诊断，避免误触

### 5. 快捷键换号

- 默认：`Cmd+Alt+S`（macOS） / `Ctrl+Alt+S`（Windows / Linux）
- 在 `Keyboard Shortcuts` 搜索 `xinghuo.switchNext` 可完全自定义
- 手动切号绕过自动切号冷却，立即跳到下一个可用账号

### 6. 开启节省积分

- 优化 API 调用策略，减少不必要的模型往返
- 智能合并请求，延长单个账号的使用时长

### 7. 高级持续对话 【高级】

- AI 结束对话时强行唤醒下一轮，**持续压榨 AI 产出**
- 解除 Cascade 对话回合数上限
- 一键启用 / 还原，附带安全回滚

### 8. 免魔法换号 【高级】

- 国内网络直连，**无需科学上网**
- 默认走 Cloudflare Worker 中转
- 支持手动指定本地代理端口（Clash / V2Ray），软路由用户可强制直连

### 9. 全自动 AI 无人值守 【高级】

- AI 全自动执行命令，**无需手动点击确认和 Run**
- 自动嗅探 Cascade 状态并及时介入
- 配合消息锚定实现接近"无感值守"的体验

### 10. 健康报告与统一自检

- 账号池健康一览：可用 / 低额度 / 使用中 / 冻结 / 等待重置
- 统一自检（Self-Test）一键诊断切号核心链路
- 自适应运行时快照 · 活跃实例列表 · 激活健康报告
- 失败黑名单自愈 · 归档账号恢复 · 设备指纹刷新

---

## 安装

### 方式一：VSIX 本地安装（推荐）

1. 下载 `xinghuo-windsurf-x.x.x.vsix`
2. 打开 Windsurf，`Extensions` 面板右上角 `...` 菜单 → **Install from VSIX…**
3. 选中下载的 `.vsix` 文件，重新加载窗口

### 方式二：Open VSX / Visual Studio Marketplace

> 最终发布可用状态以 Marketplace 页面为准。

---

## 快速上手

1. 点击左侧 Activity Bar 的 **星火无痕换号** 图标
2. 在控制面板中 **添加 / 批量添加 / 同步** 账号
3. 按需开启开关：
   - **开启无感换号**（配额用尽自动切）
   - **消息锚定切号**（发消息瞬间切换）
   - **自动预热账号**（后台刷 Token 秒切）
   - **快捷键换号**（启用快捷键）
4. 正常使用 Windsurf，插件在后台维护可用账号池

---

## 功能开关（Settings）

所有开关可在 `Settings → Extensions → 星火无痕换号` 中配置：

| 开关 Key | 默认 | 说明 |
|---|---|---|
| `xinghuo-windsurf.enableAutoSwitch` | `false` | 开启无痕换号：账号配额用尽自动切到下一个 |
| `xinghuo-windsurf.enableSavePoints` | `false` | 节省积分：优化 API 调用 |
| `xinghuo-windsurf.enableShortcutSwitch` | `false` | 开启快捷键换号 |
| `xinghuo-windsurf.injectCommands` | `[]` | 自定义注入命令列表（高级：调试 Windsurf fork） |
| `xinghuo-windsurf.notifyLevel` | `notify` | 通知级别：`silent` 零弹窗 / `notify` 主动操作弹窗 / `verbose` 全部弹窗 |
| `xinghuo-windsurf.manualProxyPort` | `""` | 手动代理端口（`127.0.0.1`，例如 `7890`） |
| `xinghuo-windsurf.disableProxy` | `false` | 强制直连（忽略手动代理端口） |
| `xinghuo-windsurf.logoutBeforeSwitch` | `false` | 切号前主动登出当前账号（清理遗留会话） |
| `xinghuo-windsurf.preferShitInject` | `true` | 切号优先走补丁通道（失败透明降级为命令注入 / URI 回调） |

---

## 命令索引

所有命令归类于 `星火无痕换号`，`Cmd+Shift+P` 搜索即可调用：

### 账号切换

- `切换下一个账号`
- `紧急切号 (跳过评分随机选号)`

### 面板与自检

- `刷新面板`
- `显示对话框`
- `统一自检 (诊断切号核心链路)`
- `查看自适应运行时快照`
- `查看活跃实例列表`
- `查看激活健康报告`

### 账号池维护

- `刷新所有账号有效期/配额`
- `批量验证并清理无效账号`
- `清空失败黑名单`
- `恢复归档账号`
- `手动刷新设备指纹 (后台静默，下次启动生效)`

### 高级补丁

- `保存 Windsurf 原版 (打补丁前的安全网)`
- `还原 Windsurf 原版 (一键回到未打补丁状态)`
- `应用切号注入补丁` / `移除切号注入补丁`
- `应用 Auto-Continue 补丁` / `移除 Auto-Continue 补丁`
- `应用 Model Unhide 补丁` / `移除 Model Unhide 补丁`
- `开启 Pro UI 伪装` / `关闭 Pro UI 伪装`
- `修复扩展 (清理重复补丁)`
- `从备份恢复扩展`

### 其他

- `检查更新`

---

## 快捷键

| 操作 | macOS | Windows / Linux | 前置条件 |
|---|---|---|---|
| 切换下一个账号 | `Cmd+Alt+S` | `Ctrl+Alt+S` | `enableShortcutSwitch = true` |

在 `Keyboard Shortcuts` 搜索 `xinghuo.switchNext` 可自定义。

---

## 高级补丁

高级补丁 **不是** 切号主路径，仅作为可选增强功能：

- **切号注入补丁 (Switch Injection)**：`apiKey` 直注 secret session，切号最快通道
- **Auto-Continue 补丁**：解除 Cascade 对话回合数限制，实现"高级持续对话"
- **Model Unhide 补丁**：修改 webview `MAX_INVOCATIONS`
- **Pro UI 伪装**：前端显示 Pro 等级（仅显示层，不改变真实账号权限）

**所有补丁均配备 保存原版 / 还原原版 / 从备份恢复 三重安全网**。首次使用建议先执行 `保存 Windsurf 原版`。

---

## 数据与隐私

- 账号池与主体软件共享数据目录（互通）：
  - macOS：`~/Library/Application Support/.xinghuowindsurf/shared-data`
  - Windows：`%APPDATA%\.xinghuowindsurf\shared-data`
- 插件 **仅做本地账号管理与配额查询**，不上报用户信息
- 配额查询仅访问 Windsurf 官方 API 或用户配置的代理

---

## 技术亮点

- **代码混淆**：生产构建使用 `webpack-obfuscator`（字符串 base64 化 + 控制流扁平化 + 十六进制变量名）+ terser 压缩，逆向成本显著提高
- **多实例协同**：多 Windsurf 窗口共享账号池与切号锁，避免并发冲突
- **自适应探针**：消息锚定多探针架构，采用高 / 低可信佐证机制降低误触
- **健康评分模型**：账号可用性 / 低额度 / 使用中 / 冻结 / 等待重置 统一建模
- **安全回滚**：所有打补丁命令都有对应还原命令，并在首次应用前自动保存基线

---

## 常见问题

### Q: 切号失败提示"注入返回成功但真实登录账号未确认"？

A: 执行 `统一自检` 定位；或临时开启 `logoutBeforeSwitch`；必要时执行 `修复扩展 (清理重复补丁)`。

### Q: 面板长时间显示"加载中..."？

A: Reload Window；若仍卡住执行 `修复扩展 (清理重复补丁)`，或通过 `从备份恢复扩展` 回到干净状态。

### Q: 国内网络配额查询慢 / 超时？

A: 默认走 Cloudflare Worker 中转；如仍慢可在 `manualProxyPort` 填入本地代理端口，或开启 `disableProxy` 强制直连。

### Q: 快捷键不生效？

A: 确认 `enableShortcutSwitch = true`；到 `Keyboard Shortcuts` 搜索 `xinghuo.switchNext` 查看是否被其他扩展占用。

### Q: 打补丁后 Windsurf 异常？

A: 先尝试 `还原 Windsurf 原版 (一键回到未打补丁状态)`；不行再执行 `从备份恢复扩展`。

### Q: 以管理员权限启动 Windsurf 后不能换号？

A: 关闭管理员 / 高权限启动。管理员模式下 Windsurf 写入路径被系统策略限制，插件无法在软件内完成换号。

---

## 免责声明

本项目仅供学习和研究使用，不得用于商业用途。

- **风险自负**：使用本工具所产生的一切后果由使用者自行承担
- **无担保**：本项目按"原样"提供，不提供任何明示或暗示的担保
- **无关联**：本项目与 Codeium / Windsurf 官方无任何关联
- **合规风险**：使用本工具可能违反 Windsurf 的服务条款，请自行评估风险
- **维护声明**：本项目可能随时停止维护，恕不另行通知

使用本工具即表示您已阅读并同意上述条款。

---

## 许可证

MIT License © 2025 xinghuoWindsurf
