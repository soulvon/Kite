<div align="center">

# Kite — AI IDE Enhancement Suite

**UI enhancement, multi-instance, [AnyBridge](https://github.com/soulvon/AnyBridge) model routing and multi-account pool tooling for Windsurf / Devin**

UI Enhancement · [AnyBridge](https://github.com/soulvon/AnyBridge) Model Routing · Multi-Instance · Multi-Account Pool · Auto Recovery · Long-Task Automation

[![Version](https://img.shields.io/badge/version-8.7.38-blue?style=flat-square)](https://github.com/soulvon/Kite/releases/latest) [![Downloads](https://img.shields.io/github/downloads/soulvon/Kite/total?style=flat-square&color=orange)](https://github.com/soulvon/Kite/releases/latest) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![Issues](https://img.shields.io/github/issues/soulvon/Kite?style=flat-square)](https://github.com/soulvon/Kite/issues) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/soulvon/Kite/pulls) [![Discussions](https://img.shields.io/github/discussions/soulvon/Kite?style=flat-square)](https://github.com/soulvon/Kite/discussions) [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()

[English](README_en.md) • [简体中文](README.md)

> Migrated and rebuilt from the legacy [windsurf-pool-releases](https://github.com/soulvon/windsurf-pool-releases) project.

</div>

---

> If this tool saves you time, feel free to buy me a coffee.

<p align="center">
  <img src="https://raw.githubusercontent.com/soulvon/windsurf-pool-releases/main/wechat-reward.jpg" width="240" alt="WeChat reward QR code">
</p>

<p align="center"><sub>WeChat reward</sub></p>

---

## Community

<p align="center">
  <b>Kite plugin group</b>｜QQ: <code>1075342078</code><br>

</p>

---

## What it solves?

When Windsurf's AI quota runs out you wait for the reset — and manual account switching means signing out, restarting the editor and **losing the conversation in progress**. Multiple windows kick each other's sessions.

Kite integrates UI enhancement, [AnyBridge](https://github.com/soulvon/AnyBridge) model routing, multi-instance and multi-account capabilities into one IDE enhancement suite — **without signing out, without restarting, without losing sessions**: quota nearly out → auto-switch to the best account → continue where you left off → you barely notice it happened.

## Core features

### 🔄 Seamless account-switch engine
- **Session hot-injection** — patches the auth method of Windsurf's built-in extension to overwrite the session token directly, keeping the current conversation context
- **Smart switching strategies** — lowest-nonzero-first / highest-quota-first, auto-skipping Free accounts, configurable quota floors and used-account thresholds
- **30s cooldown + anti-mistake guards** — yields automatically during bulk imports to avoid concurrency conflicts

### 🛡️ AutoRecovery
- **Four-tier error classification** — A: auto-retry / B: auto-switch / C: send continue / D: notify the user
- **30+ error patterns** — quota exhaustion, model unreachable, network timeout, stream interruption, auth expiry, context overflow and more
- **Auto-resume after switch** — sends "continue" automatically after a successful switch so the AI picks up where it left off, no rework
- **Bilingual-safe** — error patterns still match after UI localization (`data-ws-orig` original-text preservation)

### 🤖 Long-task automation
- **Long-task mode** — auto-sends messages from a queue when the AI stops, with loop sending for continuous work
- **Guardian mode** — auto-clicks "continue", auto-retries, auto-continues on tool limits, auto-approves permissions
- **Smart pausing** — pauses on permission prompts, stops the timer while the AI is generating, global cooldown against conflicts

### 📊 Quota visualization
- **Live dashboard** — daily/weekly quota percentages, reset countdowns, Flex balance, membership plan and expiry
- **Pool summary** — total accounts and today/this-week quota totals at a glance
- **7-dimension filtering** — tags / plan / status / membership / usage level / expiry / domain
- **Smart sorting** — recommended / daily quota / weekly quota / expiry / email / added time, ascending or descending

### 🖥️ Multi-instance
- Run multiple Windsurf windows side by side, each with its own account, all on the same project
- Instance tag groups — each instance binds tags so switching rotates within the group
- Cross-platform: Windows / macOS (`osascript`) / Linux (`xdotool` / `wmctrl`)

### 🌐 Windsurf enhancement
- **UI localization** — real-time EN/ZH toggle, instant restore when disabled (`WeakMap` original-text records + two-way attribute backup)
- **Reply suggestion bubbles** — multi-theme, multi-shape, switchable in real time
- **Completion alerts** — sound + desktop notification, 4 ringtones and multiple triggers
- **SHA256 checksum repair** — recomputes `product.json` hashes automatically, eliminating the "installation appears corrupt" prompt at the root

## Technical highlights

> This is not a simple config manager. A few hard problems solved along the way:

| Problem | Solution |
|------|------|
| **Cross-origin communication broken** | Webview (`vscode-webview://`) and workbench (`vscode-file://`) have different origins — `localStorage` events never fire across them. Built a localhost HTTP bridge (token auth + CORS preflight cache + persistent port reuse) to replace the old approach entirely |
| **Electron file validation** | Editing `workbench.html` trips Electron's SHA256 check with a corrupt-install prompt. Checksums are recomputed and written back to `product.json` on startup, algorithm identical to VS Code's built-in |
| **Localization vs error detection** | Localizing DOM text broke 30+ English regex patterns. Originals are stored in `data-ws-orig` attributes; detection concatenates original + visible text so both languages coexist |
| **Injection versioning** | A manually maintained VERSION constant used to decide re-injection and was repeatedly forgotten. Now the first 12 chars of the script content's SHA256 act as the version — content changes → hash changes → auto re-inject |
| **Live settings** | Sidebar change → extension host writes to disk → HTTP bridge pushes `apply-settings` → injected script hot-updates observer switches. The whole chain runs without a reload |
| **Windows UAC merging** | Patch injection + enhancement + checksum repair merge into a single UAC elevation prompt — three popups become one |

## Quick start

1. Download the latest [`.vsix` release](https://github.com/soulvon/Kite/releases/latest)
2. Command palette → `Extensions: Install from VSIX...` → pick the file
3. Click the **Kite** icon in the sidebar → add accounts (login / bulk import / one-click from current account)
4. Hit **Switch** or enable auto-switching → done

### System requirements

| Platform | Minimum | Notes |
|------|----------|------|
| **Windows** | v1.x+ | Fully supported |
| **macOS** | v4.13.2+ | Older versions report a missing `APPDATA environment variable` |
| **Linux** | v4.13.2+ | Multi-instance window focus needs `xdotool` or `wmctrl` |

<details>
<summary><b>macOS / Linux first-use notes</b></summary>

Windsurf installed in system directories needs write access. The extension detects read-only installs and offers a one-click-copy `chmod` command:

```bash
sudo chmod -R a+w "/Applications/Windsurf.app"        # macOS
sudo chmod -R a+w "/usr/share/windsurf"               # Linux .deb
sudo chmod -R a+w "/opt/windsurf"                     # Linux manual install
```

User-level installs (`~/.local/opt/windsurf/`) do not need this.
</details>

## Security & privacy

- **Local storage** — sessions, API keys and passwords live in VS Code `ExtensionContext.secrets` (OS keychain); nothing is uploaded
- **Zero telemetry** — no data collection, no disk logs
- **Minimal external requests** — only the official Windsurf API for quota queries
- **Local-only effect** — switching patches the local Windsurf extension; other devices are unaffected

> For local account management and personal study only. Please follow Windsurf's official terms of service.

<details>
<summary><h2>Changelog (click to expand — kept in Chinese as the historical record)</h2></summary>

### v8.7.38
- **Fixed "Error rendering Markdown"**：气泡渲染此前用 `range.deleteContents()` + `el.remove()` 直接删除 React 渲染出来的 markdown 节点，React 后续 diff/卸载时再调 `removeChild` 就会抛 `The node to be removed is not a child of this node`，被消息组件的 error boundary 捕获后整条回复变成红色报错框。
- **改为非破坏性渲染**：不再删除或移动任何 React 拥有的节点 —— 完全落在 `:::bubbles` 范围内的元素只打 `data-ws-bubbles-src` 属性由 CSS 隐藏，边界文本节点仅裁剪 `nodeValue`，气泡卡片用 `insertBefore` 追加（纯新增操作，React 不受影响）。
- **卡片丢失可重建**：`wsBubblesProcessed` 标记改为附带校验 —— React 重建子树把卡片丢弃后会自动清除标记并重新渲染气泡，不会出现「原文没了、卡片也没了」。

### v8.7.37
- **修复回复建议气泡不发送**：点击气泡后文本已填入但消息发不出去，且会误点输入框旁的「+」（添加附件）按钮。原 SVG 兜底按「文档顺序」取第一个 `path ≤ 3` 的按钮，「+」排在工具栏最左因而被稳定误选。改为取**最右侧**按钮，并新增 `isLikelySendBtn` 语义过滤（`aria-label` / `title` / `data-tooltip-id` / `data-testid`）排除附件、模型选择、语音等非发送按钮。
- **发送兜底校验**：点击发送按钮后 350ms 校验输入框文本是否仍在，未发出则自动回退到 Enter 键发送，保证消息必达。
- **补充发送按钮选择器**：新增 `button[data-testid*="send"]` 与 `button[type="submit"]`。
- **Windsurf 同步加固**：`windsurf-better.js` 应用同一套发送按钮识别与兜底校验逻辑。

### v8.7.35
- **修复 Windows 证书链兼容**：Node TLS 证书签名失败时改用系统 `curl.exe`（Schannel）重试，仍保持证书校验，不关闭 HTTPS 安全验证。

### v8.7.34
- **修复配额刷新失败清空数据**：网络或 TLS 证书异常时保留最近一次成功额度快照，并显示具体错误原因。
- **增加官方 API TLS 回退**：账号 API 域名证书握手失败时自动尝试 `server.codeium.com`，避免单一域名证书链异常导致全部数据不可用。

### v8.7.33
- **修复增强注入失效**：移除启动时 `restoreWindsurfExtensionJs` 误卸合法会话补丁的 legacy cleanup 逻辑（该逻辑在 `autoApplyOnStartup=true` 时会卸掉已应用的切号补丁并 early-return 跳过 bridge/autoSwitcher 等关键启动步骤）。
- **修复 Devin 永久安全模式**：将 Devin 安全启动从每次启动强制关闭增强改为一次性清理（`DEVIN_SAFE_STARTUP_CLEANUP_KEY`），不再每次启动重置 `enhancement.enabled=false`。
- **修复 Windsurf 安全清理误伤**：`runWindsurfSafeStartupCleanup` 新增 `enhancementEnabled` 参数，当增强已启用时跳过 workbench 恢复，避免"开关开着但功能全失效"。
- **修复设置保存不报错**：`mergeEnhSettings` 写盘失败时 throw Error；`enhSave` / `toggleEnhancement` / reinject 路径全部 catch 并 `showErrorMessage`；webview 新增 `enhSaveError` toast。
- **启用增强时启动 bridge**：`toggleEnhancement` 和 `reinjectEnhancement` 命令注入成功后均启动 bridge server，避免 windsurf-better.js 无法与扩展通信。
- **注入失败回滚开关**：`toggleEnhancement` 启用注入失败时回滚 `enabled=false`，避免配置显示开但 workbench 无脚本。
- **兼容 electron-sandbox 路径**：`getWorkbenchHtmlPath` 和 `checkInstallPermission` 新增 `electron-sandbox/workbench/workbench.html` 候选路径。
- **汉化/applyI18nOnly 在增强启用时也执行**：不再仅绑定 `autoApplyOnStartup`。
- **错误文案动态脚本名**：`ensureEnhancement` 找不到脚本时显示 `windsurf-better.js` 或 `devin-better.js`（根据 IDE 自动切换）。
- **修复 ensureEnhancement 误清 session 补丁**：`ensureEnhancement` 清 workbench 后不再调用 `restoreWindsurfExtensionJs()`，避免越界清掉 extension.js 中的账号切换补丁（增强注入和会话补丁是独立关注点）。
- **修复 safe cleanup 提前 flush 导致多次 UAC**：`runWindsurfSafeStartupCleanup` / `runDevinSafeStartupOnce` 在 `flushElevatedBatch()` 后立即 `beginElevatedBatch()` 恢复批量模式，后续 `ensureEnhancement` / `checksumFix` 写操作仍可合并为单次 UAC 提示。

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

### Earlier versions
- See the [Chinese README](README.md) for the full changelog of v8.7.1 – v8.7.10 and earlier (toggle fixes, localization modes, globalState/credential migrations, BYOK slot management and more).

</details>

## Related projects

Model routing, API relay, BYOK and related capabilities live in the standalone [AnyBridge](https://github.com/soulvon/AnyBridge) project. The full AI toolbox by the same author:

| Project | What it does | For whom |
| :--- | :--- | :--- |
| [🚀 **AnyBridge**](https://github.com/soulvon/AnyBridge) ![Downloads](https://img.shields.io/github/downloads/soulvon/AnyBridge/total?color=orange) | Unified BYOK model access for 16+ AI coding agents (Cursor / Windsurf / Devin / Claude Code / Codex / CodeBuddy…): local proxy takeover + config writing, relay-friendly | Give closed IDEs your own models |
| [🎫 **BuddyRelay**](https://github.com/soulvon/BuddyRelay) ![Open VSX Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fopen-vsx.org%2Fapi%2Fsoulvon%2Fbuddy-relay&query=%24.downloadCount&label=openvsx%20downloads&color=orange) | Multi-account switcher extension for CodeBuddy / WorkBuddy: cross-window pool sync, usage ledger, probe pre-check & auto-switch. Available on Open VSX | CodeBuddy / WorkBuddy users |
| [🛸 **Antigravity-Kite**](https://github.com/soulvon/Antigravity-Kite) ![Downloads](https://img.shields.io/github/downloads/soulvon/Antigravity-Kite/total?color=orange) | Seamless multi-account switcher & account pool for Antigravity IDE: official dual-model dual-window quotas (Claude / Gemini, 5h + weekly with reset countdowns), auto-confirmed security notice, bilingual UI | Antigravity IDE users |
| [🔍 **devin-search-mcp**](https://github.com/soulvon/devin-search-mcp) ![npm Downloads](https://img.shields.io/npm/dt/devin-search-mcp?color=orange) | Exposes Devin's native real-time web search & clean page extraction as a standard MCP: ~1s response, zero LLM quota, install via `npx -y devin-search-mcp` | Cursor / Claude Code / Claude Desktop / CodeBuddy users |

> **Kite →** lightweight IDE enhancement & account workflow tooling
> **AnyBridge →** model routing & API layer capabilities
> All open source · local-first · actively maintained — see the [author profile](https://github.com/soulvon) for all projects.

## Contributing & feedback

- 🐛 **Found a bug** → [Open an issue](https://github.com/soulvon/Kite/issues)
- 💡 **Feature idea** → [Feature request](https://github.com/soulvon/Kite/issues/new/choose) or [Discussions](https://github.com/soulvon/Kite/discussions)
- 🚀 **Code** → Pull requests welcome, see the [contributing guide](.github/CONTRIBUTING.md)

---

## License

MIT
