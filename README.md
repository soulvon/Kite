# Windsurf 号池管理

Windsurf 无感换号：在编辑器侧栏内集中管理多个账号，一键切换、自动注入会话，实时显示每日 / 每周配额与会员期限。免退出、免重启。

> 仅供本地账号管理与个人学习使用。请遵守 Windsurf 官方服务条款。

## 功能特性

- **多账号管理**：邮箱密码登录、批量导入（文本 / JSON / Devin Token）、从当前已登录账户一键导入（依赖补丁注入命令，无需密码）。
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
- **校验值自动修复**：补丁/增强会修改 `workbench.html` 等被 Electron 校验的核心文件，默认启用 `fixChecksums` 后自动重算 product.json 中的 SHA256 哈希，**从根本消除"installation appears corrupt"提示**（无需依赖 DOM 自动点掉通知的兜底）。
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

### v5.0.0
- **Devin Token 批量导入**：新增「Devin Token」导入格式，支持粘贴 `devin-session-token$` 或纯 JWT（自动补前缀），自动去重、标签分组。
- **自动继续面板 UI 统一**：「自动继续」与「自动切号」面板头部样式统一（图标颜色、折叠箭头位置、开关样式），使用 `as-top-*` 系列 class，移除冗余的 `ac-summary` / `ac-icon-box` 等旧样式。
- **🔴 修复重启自动发「继续」**：插件重启后不再自动进入长任务（brainless）模式发送继续消息。根因是 `collectEnhSettings()` 在长任务 tab 选中时总返回 `continueMode: 'brainless'`，持久化后重启即触发。
  - `collectEnhSettings()` 现在只在长任务实际运行时（`_ltRunning === true`）才返回 `brainless`，否则始终为 `smart`。
  - 长任务控制按钮改为通过 `saveLtMode()` 直接推送 `continueMode` 变更，走 `enhSave` → bridge `apply-settings` 正规链路（原 `bridgeCommand` 消息类型在后端未处理，从未生效）。
  - `init()` 增加安全检查：检测到残留 `brainless` 状态时自动重置为 `smart` 并保存。
  - 显式写入 `brainlessModeEnabled: false` 清除旧字段，防止 `loadSettings` 迁移逻辑重新激活。
- **修复暂停后设置变更意外恢复 brainless**：暂停时未重置 `_ltRunning` 标志，导致修改其他设置时 `collectEnhSettings()` 仍返回 `brainless`。现在暂停/恢复正确切换 `_ltRunning` 状态。
- **清理 ~200 行死代码**：移除已迁移至侧栏的旧浮动设置面板（`injectPanelStyles` + `createSettingsUI`），减小 VSIX 体积。
- **🔴 修复切号选中不可用账号**：新增硬约束——候选账号日/周任一维度 ≤1% 时绝对不选（不受 `minQuota` 配置值影响）。修复 `scoreMode=daily` 时可能选中「周 0% 日 100%」等实际不可用账号的问题。
- **切号策略默认值调整**：默认策略从「最低非零优先」改为「满额度优先」。
- **批量导入选项居中修复**：radio 按钮改用 `padding` + `min-height` + `line-height: normal` 替代固定 `height` + `line-height: 1`，修复中文字符垂直不居中问题。

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
