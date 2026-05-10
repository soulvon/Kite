# Windsurf 自动继续（Auto-Continue）设计规格

> 版本：v0.3 | 日期：2026-05-08

---

## 概述

**功能名称**：自动继续（Auto-Continue）

**两种模式**：

| 模式 | 定位 | 核心逻辑 |
|---|---|---|
| **长任务模式** | 进攻型：驱动 AI 持续工作 | AI 停下来 = 任务没完 = 发送继续 |
| **守护模式** | 防守型：保证对话完整性 | 只在异常中断时介入，正常结束不干预 |

---

## 0. 当前实现现状（已有代码）

### 0.1 检测机制

| 检测模块 | 函数名 | 触发方式 | 检测目标 | 位置 |
|---|---|---|---|---|
| 错误文本扫描 | `checkForErrors()` | MutationObserver + 500ms 防抖 | 匹配 ERROR_PATTERNS 正则表 | L3044 |
| 继续提示检测 | `checkForContinuePrompts()` | 同上（随 MutationObserver 触发） | continuationErrors 文本 + Continue 按钮 | L3224 |
| 权限审批检测 | `checkForPermissionApproval()` | 同上 | Allow/Run/Execute 按钮文字匹配 | L3266 |
| Continue 按钮 | `startAutoContinue()` | MutationObserver + 200ms 防抖 | "Continue response" / "继续回复" 按钮 | L2261 |
| 无脑 idle 检测 | `startBrainlessMode()` | setInterval 2s 轮询 | AI 停止 + 内容不变 + idle 超时 | L3496 |
| AI 生成状态 | `isAIGenerating()` | 被其他模块调用 | Stop/Cancel/停止/取消 按钮存在 | L3451 |
| 权限提示检测 | `hasPermissionPrompt()` | 被 brainless 调用 | Allow/Accept 等审批按钮（中英双语） | L3424 |
| Pool 结果检测 | `checkForPoolResult()` | setInterval 3s + MutationObserver | localStorage 中的切号结果 | L2837 |
| 最后用户消息 | `trackLastUserMessage()` | 随 MutationObserver 触发 | DOM 中最后一条 user 消息文本 | L2707 |
| 损坏通知关闭 | `dismissCorruptWarning()` | MutationObserver | "corrupt" / "reinstall" 通知弹窗 | L2294 |

### 0.2 已有的错误正则表（ERROR_PATTERNS，共 35 条）

**networkErrors（14 条）**：
```
Model provider unreachable
an internal error occurred
retryable error from model provider
API provider is overloaded. Please try again
This is taking a long time
Deadline exceeded:.*context deadline exceeded
context deadline exceeded
Client.Timeout or context cancellation
Cascade has encountered an internal error in this step
No credits consumed on this tool call
Encountered unexpected error during
This request is taking longer than expected
stream was (interrupted|cancelled|aborted)
connection was (reset|closed)
```

**quotaErrors（14 条）**：
```
daily usage quota has been exhausted          → signal: quota-daily-exhausted
usage quota.*exhausted                        → signal: quota-exhausted
monthly acu limit reached                    → signal: quota-exhausted
you have reached your.*limit                 → signal: quota-exhausted
reached your usage limit                     → signal: quota-exhausted
resource_exhausted                            → signal: rate-limited
all API providers are over capacity          → signal: provider-overloaded
Failed precondition.*quota                   → signal: quota-exhausted
all API providers are over their global rate limit → signal: rate-limited
rate limit exceeded                          → signal: rate-limited
upgrade to a Pro account for higher limits   → signal: rate-limited
权限拒绝.*rate limit                         → signal: rate-limited
Reached.*(message|rate) limit                → signal: rate-limited
此模型已达到消息速率限制                      → signal: rate-limited
已达到.*(配额|限制|额度)                      → signal: quota-exhausted
额度.*(耗尽|用完|不足)                        → signal: quota-exhausted
```

**modelErrors（2 条）**：
```
third-party model provider is experiencing issues → signal: provider-unavailable
model provider is currently not available         → signal: provider-unavailable
```

**continuationErrors（4 条）**：
```
reached.*invocation limit                    → triggerAction: send-continue
Cascade can make up to \d+ tool calls per prompt → triggerAction: send-continue
maximum (number of )?tool calls reached      → triggerAction: send-continue
tool call limit reached                      → triggerAction: send-continue
```

**userIntervention（7 条）**：
```
Windsurf version is out of date              → hint: 请更新 Windsurf 版本
Failed to log in: [deadline_exceeded]        → hint: 登录态失效
Authentication (failed|expired)              → hint: 认证失败，请重新登录
unauthorized                                 → hint: 未授权，请重新登录
context length exceeded                      → hint: 上下文超长，请新开会话
prompt is too long                           → hint: 提示词过长
maximum context length                       → hint: 已达模型最大上下文
```

### 0.3 已有的按钮检测

| 按钮类型 | 检测方式 | 匹配文字 |
|---|---|---|
| Continue 按钮 | `startAutoContinue()` 遍历所有 button | `Continue response` / `继续回复` |
| Retry 按钮 | `findRetryButton()` 遍历所有 button | `retry` / `重试` / `try again` / `再试一次` |
| 权限按钮 | `checkForPermissionApproval()` | `allow` / `允许` / `approve` / `批准` / `accept` / `接受` / `run` / `运行` / `allow and run` / `允许并运行` |
| 权限提示（brainless 用） | `hasPermissionPrompt()` | EN: `accept all`, `always allow`, `allow this conversation`, `approve`, `reject all`, `reject`<br>ZH: `全部接受`, `全部拒绝`, `始终允许`, `允许此对话`, `授权`, `允许`, `批准`, `拒绝` |
| 发送按钮 | `findSendBtnAdvanced()` | `data-tooltip-id*="send"`, `aria-label*="Send"`, `button.send-button` |
| 模型选择器 | `findModelSelectorBtn()` | `aria-label*="Model Selector"`, `data-testid*="model"`, class 含 model-selector |
| AI 生成中 | `isAIGenerating()` 遍历所有 button | `stop` / `cancel` / `abort` / `停止` / `取消` / `终止` / `中止` / `中断` |

### 0.4 已有的错误文本提取

| 方法 | 说明 |
|---|---|
| `getLatestErrorText()` | 四级搜索：① ERROR_BUBBLE_SEL 类名 → ② SVG red 图标旁 → ③ 最后 assistant 消息 → ④ 全文档 quota 关键词 |
| `getElementErrorText(el)` | 拼接 `textContent` + `data-ws-orig`（汉化前原文），让英文正则在汉化后仍能匹配 |
| `makeErrorFingerprint(text)` | 正规化错误文本用于去重（去数字/多余空格/截断 120 字符） |

### 0.5 已有的处理动作

| 动作 | 函数 | 说明 |
|---|---|---|
| 重试 | `handleRetryAction()` | 指数退避延迟后点击 Retry 按钮，有 maxRetries 上限 |
| 切号 | `handleSwitchAccountAction()` → `sendPoolSignal()` | 发信号给扩展侧，扩展执行换号 |
| 切模型 | `handleSwitchModelAction()` → `switchToNextModel()` | 按优先级列表自动切换模型 |
| 发送继续 | `handleSendContinueAction()` → `sendContinueMessage()` | Lexical API 写入文本 + 最右边按钮点击 |
| 自动批准 | `checkForPermissionApproval()` → `btn.click()` | 直接点击权限按钮 |
| 通知 | `showRecoveryNotification()` | 右上角 toast 提示 |
| 重发消息 | `retryLastMessage()` | 切号后/Retry 后重发上次用户消息 |

### 0.6 已有的安全机制

| 机制 | 说明 |
|---|---|
| `isInCooldown()` | 全局冷却（操作后短时间内禁止再次操作） |
| `makeErrorFingerprint()` | 同一错误指纹 10s 内不重复处理 |
| `recoveryRetryCount` + `maxRetries` | 同一错误最多重试 N 次 |
| `_lastContinueTs` | sendContinueMessage 自身 10s 防重入 |
| `_brainlessConsecutive` + `maxConsecutive` | brainless 模式连续触发上限 |
| `_brainlessLastFireTs` | brainless 5s 冷却 |
| 输入框残留检查 | 发送前检查输入框是否有文本（v4.21.18） |
| 发送结果验证 | 1.5s 后检查输入框是否清空（v4.21.18） |

---

## 1. 中断场景分类

### A 类：需要"继续"（Continuation）

| ID | 场景 | 触发条件 | 表现 | 是否有按钮 |
|---|---|---|---|---|
| A1 | 工具调用上限 | 每个 prompt ≤20 次工具调用 | AI 停止，显示提示文字 | ✅ Continue 按钮 |
| A2 | 输出截断 | 回复过长触发 token 上限 | 回复中断 | ✅ "Continue response" 按钮 |
| A3 | 静默停止 | AI 停止生成，无错误/无按钮 | AI 无声停下 | ❌ 无 |

### B 类：需要"重试"（Retry）

| ID | 场景 | 错误文本特征 | 是否有按钮 |
|---|---|---|---|
| B1 | 网络超时 | `Model provider unreachable` | ✅ Retry |
| B2 | 内部错误 | `Cascade has encountered an internal error in this step` | ✅ Retry |
| B3 | API 过载 | `API provider is overloaded. Please try again` | ✅ Retry |
| B4 | 流中断 | `stream was interrupted/cancelled/aborted` | ✅ Retry |
| B5 | 超时等待 | `This request is taking longer than expected` | ✅ Retry |
| B6 | deadline | `context deadline exceeded` | ✅ Retry |
| B7 | 重试类错误 | `retryable error from model provider` | ✅ Retry |
| B8 | 步骤错误 | `No credits consumed on this tool call` | ✅ Retry |

### C 类：需要"切换账号"（Switch Account）

| ID | 场景 | 错误文本特征 |
|---|---|---|
| C1 | 每日配额耗尽 | `daily usage quota has been exhausted` |
| C2 | 速率限制 | `rate limit exceeded` / `Reached message limit` |
| C3 | 月度配额 | `monthly acu limit reached` |
| C4 | 全局过载 | `all API providers are over capacity/rate limit` |
| C5 | 配额不足 | `you have reached your limit` / `usage quota exhausted` |

### D 类：需要"切换模型"（Switch Model）

| ID | 场景 | 错误文本特征 |
|---|---|---|
| D1 | 第三方故障 | `third-party model provider is experiencing issues` |
| D2 | 模型不可用 | `model provider is currently not available` |

### E 类：需要"自动批准"（Auto Approve）

| ID | 场景 | 触发条件 |
|---|---|---|
| E1 | 文件操作 | Allow/Accept 按钮出现（file write/create/edit） |
| E2 | 终端命令 | Run/Execute 按钮出现（terminal/command） |
| E3 | 网络请求 | Allow 按钮出现（web/fetch/http） |

### F 类：需要"用户介入"（User Intervention）

| ID | 场景 | 错误文本特征 | 处理 |
|---|---|---|---|
| F1 | 上下文超长 | `context length exceeded` / `prompt is too long` | 通知：新开会话 |
| F2 | 认证失效 | `Authentication failed/expired` / `unauthorized` | 通知：重新登录 |
| F3 | 版本过旧 | `Windsurf version is out of date` | 通知：更新 IDE |

---

## 2. 模式设计

### 2.1 长任务模式（Long Task Mode）

**定位**：进攻型——驱动 AI 持续工作，直到任务完成或达到上限。

**核心逻辑**：AI 停下来 = 任务没完 = 发送继续

```
适用场景:
  - 给 AI 一个大任务（写整个项目、迁移代码、批量重构）
  - 让 AI 自己跑到底，不需要人盯着
  - 类似"挂机"模式

触发条件:
  1. AI 停止生成（无 Stop/Cancel 按钮）
  2. 最后 assistant 消息内容 N 秒无变化（idle 超时）
  3. 输入框为空（排除发送失败残留）
  4. 当前不在处理中断（切号中/重试等待中时暂停 idle 计时）

处理流程:
  1. AI 正常结束回复 → 从队列取下一条文本 → 发送
  2. 遇到中断（网络错误/权限/限额等）→ 先处理中断 → 恢复后继续
  3. 达到最大继续次数 → 停止 + 通知用户

不停止的条件:
  - 只要没达到 maxContinueCount，就一直发
  - 中间的任何中断（B/C/D/E 类）都自动处理后继续

停止条件:
  - 达到 maxContinueCount（可设为 0 = 无限）
  - 队列跑完且未勾选循环（loop = false）
  - 用户手动停止 / 强制停止
  - 遇到 F 类错误（需要用户介入，如上下文超长）
  - 连续发送失败（输入框残留未清空 N 次）
```

#### 继续文字队列

```javascript
// 队列配置
continueQueue: ['继续完成', '还有遗漏的吗？请继续', '总结一下进度'],
loop: true,  // ☑ 循环使用队列（不勾选则跑完一轮自动停止）

// 示例行为（勾选循环，队列 3 条）:
// 第 1 次继续 → 发送 "继续完成"
// 第 2 次继续 → 发送 "还有遗漏的吗？请继续"
// 第 3 次继续 → 发送 "总结一下进度"
// 第 4 次继续 → 发送 "继续完成"（循环）
// ...

// 示例行为（不勾选循环）:
// 第 1 次继续 → 发送 "继续完成"
// 第 2 次继续 → 发送 "还有遗漏的吗？请继续"
// 第 3 次继续 → 发送 "总结一下进度"
// 第 4 次继续 → 队列跑完，自动停止

// 注：队列文字支持 @skill-name 语法，可调用 Windsurf Skill（二期实现）
// 例: ['继续完成', '@code-review 检查代码', '修复问题']
```

#### 长任务模式的中断处理

长任务模式下遇到中断时，**先处理中断，处理完继续跑**：

| 中断类型 | 处理方式 | 处理完后 |
|---|---|---|
| A1 工具调用上限 | 点击 Continue 按钮 / 发送 continue | 等 AI 完成 → 继续发队列 |
| A2 输出截断 | 点击 "Continue response" 按钮 | 等 AI 完成 → 继续发队列 |
| B 类网络错误 | 点 Retry（延迟重试） | 等 AI 完成 → 继续发队列 |
| C 类配额耗尽 | 自动切号 → **重发上次消息** → 等 AI 完成 | 继续发队列 |
| C 类速率限制 | 自动切号 → **发送继续** → 等 AI 完成 | 继续发队列 |
| D 类模型不可用 | 自动切模型 → **发送继续** → 等 AI 完成 | 继续发队列 |
| E 类权限请求 | 自动点 Allow | AI 继续执行 → 继续发队列 |
| F 类需用户介入 | **停止长任务** + 通知用户 | 用户处理后可手动恢复 |

> **关键**：切号/切模型只是换了执行环境，AI 不会自动继续。必须在切换成功后**主动发送消息**（重发上次用户消息或发送"继续"），AI 才会在新环境下重新开始工作。

---

### 2.2 守护模式（Guardian Mode）

**定位**：防守型——保证当前对话完整完成，不主动驱动新动作。

**核心逻辑**：只在异常中断时介入，AI 正常结束不干预。

```
适用场景:
  - 日常使用，一问一答
  - 不想 AI 无限跑，只想确保每次回复不因技术问题中断
  - 默认模式

触发方式: MutationObserver（DOM 变化时被动扫描）

处理流程（按优先级）:
  1. 检测到 "Continue response" / "Continue" 按钮 → 自动点击
  2. 检测到 Retry 按钮 + 匹配 B 类错误 → 延迟后点击 Retry
  3. 检测到 continuationErrors 文本（工具上限）→ 发送 "continue"
  4. 检测到 Allow/Run 按钮 → 自动点击
  5. 检测到配额错误 → 切号 → 切号成功后重发消息/发送继续
  6. 检测到模型不可用 → 切模型 → 切换成功后发送继续

不做的事:
  - AI 正常结束回复后，不发任何消息
  - 不主动轮询 AI 状态
  - 不判断"截断"
```

---

### 2.3 两种模式的对比

| | 长任务模式 | 守护模式 |
|---|---|---|
| AI 正常结束后 | ✅ 发送队列中的下一条 | ❌ 不做任何事 |
| A1 工具调用上限 | ✅ 点 Continue / 发 continue | ✅ 同左 |
| A2 输出截断 | ✅ 点 "Continue response" | ✅ 同左 |
| B 类网络错误 | ✅ 点 Retry（AI 自动重跑） | ✅ 同左 |
| C 类配额耗尽 | ✅ 切号 → 重发消息/发继续 → 等完成 → 继续跑 | ✅ 切号 → 重发消息/发继续 |
| D 类模型不可用 | ✅ 切模型 → 发继续 → 等完成 → 继续跑 | ✅ 切模型 → 发继续 |
| D 降级（模型全不可用）| ✅ 降级切号 → 同 C 类处理 | ✅ 同左 |
| E 类权限请求 | ✅ 点 Allow（AI 自动继续） | ✅ 同左 |
| F 类需用户介入 | ⛔ 停止 + 通知 | ⛔ 通知 |
| 触发方式 | 定时轮询（主动） | MutationObserver（被动） |
| 继续文字 | 自定义队列（多条） | 固定 "continue"（单条） |
| 最大继续次数 | 可配置（0=无限） | 无（不主动发） |

> **哪些需要两步操作（切换 + 发送）**：
> - ✅ C 类（切号后）→ `executeAfterAction`: auto/send-continue/retry-message
> - ✅ D 类（切模型后）→ `executeAfterAction`: send-continue
> - ✅ D 降级切号后 → 同 C 类
>
> **哪些不需要**（点击按钮本身就触发 AI 继续）：
> - B 类 Retry → 点击后 AI 直接重新生成
> - A 类 Continue → 点击/发送后 AI 直接继续
> - E 类 Allow → 批准后 AI 自动继续执行

---

## 3. 技术实现架构

```
┌──────────────────────────────────────────────────────────────┐
│ windsurf-better.js（注入脚本，运行在 workbench 页面）           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [检测层]                                                    │
│  ├─ MutationObserver → 触发扫描（守护模式 + 长任务模式共用）  │
│  │   ├─ checkForErrors()           → 匹配 ERROR_PATTERNS     │
│  │   ├─ checkForContinuePrompts()  → 匹配 continuationErrors │
│  │   ├─ checkForPermissionApproval() → 匹配权限按钮           │
│  │   └─ detectContinueButton()     → 检测 Continue 按钮      │
│  │                                                            │
│  └─ 定时轮询（仅长任务模式）                                  │
│      └─ checkTaskIdle()            → AI 停止 + idle 超时检测  │
│                                                              │
│  [动作层]                                                    │
│  ├─ 点击按钮: btn.click()                      (可靠 ✅)      │
│  ├─ 发送文字: setInputText() + trySendMessage() (已验证 ✅)   │
│  └─ 发信号:   sendPoolSignal()                (独立通道)      │
│                                                              │
│  [发送机制]                                                  │
│  ├─ setInputText()  → Lexical 内部 API 写入文本               │
│  ├─ trySendMessage()                                         │
│  │   ├─ 策略1: findSendBtnAdvanced() 标准选择器               │
│  │   ├─ 策略2: 输入区域最右边按钮（已确认可用 ✅）             │
│  │   └─ 策略3: Enter 键模拟（fallback）                      │
│  └─ 发送验证: 1.5s 后检查输入框是否清空                       │
│                                                              │
│  [队列管理]（仅长任务模式）                                   │
│  ├─ continueQueue[]     — 待发送文字队列                      │
│  ├─ queueIndex          — 当前队列位置                        │
│  ├─ queueMode           — loop / sequential / single          │
│  └─ getNextQueueText()  — 取下一条文字                        │
│                                                              │
│  [安全层]                                                    │
│  ├─ isInCooldown()      — 全局冷却                            │
│  ├─ maxContinueCount    — 长任务最大继续次数                   │
│  ├─ 指纹去重            — 同一错误不重复处理                   │
│  ├─ 输入框残留检查      — 发送失败后清空                       │
│  ├─ 发送结果验证        — 确认消息真正发出                     │
│  └─ F 类错误自动停止    — 不可恢复错误时停止长任务              │
│                                                              │
└───────────────────────┬──────────────────────────────────────┘
                        │ bridge HTTP（命令通道）
┌───────────────────────▼──────────────────────────────────────┐
│ 扩展侧 extension host（TypeScript）                           │
├──────────────────────────────────────────────────────────────┤
│  ├─ 接收 pool signal → 执行换号逻辑                           │
│  ├─ 接收 switch-result → 通知注入脚本                         │
│  └─ 侧边栏 webview → 模式切换、队列编辑、状态显示             │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 配置项

```javascript
// ═══════ 开关 + 模式 ═══════
autoContinueEnabled: true,                // 右上角开关
autoContinueTab: 'guardian' | 'long-task', // 当前选中的 Tab（默认 guardian）

// ═══════ 长任务模式参数 ═══════
longTask: {
  idleSeconds: 8,              // AI 停止后等待多少秒再发送继续
  maxContinueCount: 0,         // 最大继续次数（0 = 无限）
  continueQueue: ['继续'],     // 继续文字队列
  loop: true,                 // 循环使用队列（false = 跑完一轮自动停止）
  stopOnUserIntervention: true,// 遇到 F 类错误自动停止
},

// ═══════ 守护模式参数（勾选项，长任务模式继承） ═══════
guardian: {
  // 中断处理
  autoContinueButton: true,    // ☑ 自动点击 Continue / 继续回复 按钮
  autoRetry: true,             // ☑ 自动点击 Retry / 重试 按钮
  autoSendOnToolLimit: true,   // ☑ 工具调用上限时发送 continue
  // 权限批准（折叠区）
  autoApprovePermission: true, // ☑ 自动批准权限请求
  permissionScope: ['web-request', 'terminal', 'file-write'],  // 默认全选
  // 其他（折叠区）
  dismissCorrupt: true,        // ☑ 自动关闭"文件损坏"通知
},
// 注：自动切号/切模型保持下方独立区域的原有配置，不在此重复

// ═══════ 通用恢复参数 ═══════
recovery: {
  maxRetries: 3,               // 网络错误最大重试次数
  baseDelay: 3000,             // 重试基础延迟（ms）
  modelPriority: ['Claude Opus 4.6 Thinking', 'Claude Opus 4.7', 'GPT-5.5'],
},

// ═══════ 发送机制参数 ═══════
send: {
  verifyTimeout: 1500,         // 发送后验证等待时间（ms）
  retryOnFail: false,          // 发送失败是否重试
  cooldown: 5000,              // 两次发送最小间隔（ms）
},
```

---

## 5. 与 Windsurf 内置功能的关系

| Windsurf 内置功能 | 我们的增强 | 关系 |
|---|---|---|
| Auto-Continue（官方设置项） | 守护模式 | 互补：官方按钮点击可能有延迟/bug，我们更快更全 |
| Continue 按钮 | 自动点击 | 替代手动点击 |
| Retry 按钮 | 自动点击 | 替代手动点击 |
| 20 次工具调用停止 | 自动发 continue | 替代手动输入 |
| 无 | 长任务模式 | 官方完全没有的功能 |
| 无 | 自动切号 | 官方完全没有的功能 |
| 无 | 自动切模型 | 官方完全没有的功能 |
| 无 | 继续文字队列 | 官方完全没有的功能 |

---

## 6. 侧边栏 UI 设计

> 基于现有 `enhance-subgroup` + `enhance-segmented` 组件风格改造

### 6.1 完整界面线框图

#### 长任务 Tab（未启动状态）

```
┌─ enhance-subgroup ────────────────────────────────────────┐
│ 自动继续                                    [ ● 开关 ]   │
│                                              ← 参考自动切号│
│ ┌─────────────────────────┬━━━━━━━━━━━━━━━━━━━━━━━━━━━┐  │
│ │       🛡 守护             │      🚀 长任务             │  │
│ └─────────────────────────┴━━━━━━━━━━━━━━━━━━━━━━━━━━━┘  │
│                                                            │
│ 在守护模式基础上，AI 停下来就自动发「继续」。               │
│ 适合：写项目、迁移代码、批量重构等大型任务。                │
│                                                            │
│ ┌─────────────────────────────────────────────────────┐   │
│ │                   🛑 强制停止                       │   │
│ └─────────────────────────────────────────────────────┘   │
│                         ↑ 红色醒目按钮，始终可见            │
│                                                            │
│ ┌─ 状态栏 ────────────────────────────────────────────┐   │
│ │ ● 就绪                                              │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                            │
│ 继续队列                                                   │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ ⠿  [ 继续                                    ] [✕] │   │
│ └─────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────┐ ┌──────┐    │
│ │ 添加新的继续文字...                        │ │ 添加 │    │
│ └──────────────────────────────────────────┘ └──────┘    │
│                                                            │
│ ☑ 循环使用队列（不勾选则跑完一轮自动停止）                  │
│                                                            │
│ ▸ 高级设置                                 ← 默认折叠      │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ 空闲等待    [ 8  ] 秒                               │   │
│ │ 最大继续    [ 0  ] 次（0=无限）                      │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌─────────────────────────────────────────────────────┐   │
│ │                    ▶ 开始                            │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                            │
│ [ 测试发送 ]                                               │
└───────────────────────────────────────────────────────────┘
```

#### 长任务 Tab（运行中状态，队列有 3 条）

```
┌─ enhance-subgroup ────────────────────────────────────────┐
│ 自动继续                                    [ ●━ 开启 ]   │
│                                                            │
│ ┌─────────────────────────┬━━━━━━━━━━━━━━━━━━━━━━━━━━━┐  │
│ │       🛡 守护             │      🚀 长任务             │  │
│ └─────────────────────────┴━━━━━━━━━━━━━━━━━━━━━━━━━━━┘  │
│                                                            │
│ ┌─────────────────────────────────────────────────────┐   │
│ │                   🛑 强制停止                       │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌─ 状态栏 ────────────────────────────────────────────┐   │
│ │ 🟢 运行中                            已继续 5 次    │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                            │
│ 继续队列                           当前 → 第 3 条 (循环)  │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ ⠿  [ 继续完成                                ] [✕] │   │
│ │ ⠿  [ 还有遗漏的吗？请继续                    ] [✕] │   │
│ │ ⠿  [ 总结一下进度                            ] [✕] │ ← │
│ └─────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────┐ ┌──────┐    │
│ │ 添加新的继续文字...                        │ │ 添加 │    │
│ └──────────────────────────────────────────┘ └──────┘    │
│                                                            │
│ ☑ 循环使用队列（不勾选则跑完一轮自动停止）                  │
│                                                            │
│ ┌────────────────────────┐ ┌────────────────────────┐    │
│ │       ⏸ 暂停            │ │       ⏹ 停止           │    │
│ └────────────────────────┘ └────────────────────────┘    │
│                                                            │
│ 最近: ✅ 发送"继续完成" (3s前)                             │
└───────────────────────────────────────────────────────────┘
```

#### 长任务 Tab（已暂停 / 已停止 / 处理中断）

```
已暂停:
│ ┌─ 状态栏 ─────────────────────────────────────────┐      │
│ │ 🟡 已暂停                        已继续 12 次    │      │
│ └──────────────────────────────────────────────────┘      │
│ 按钮: [ ▶ 继续 ] [ ⏹ 停止 ]                              │

已停止:
│ ┌─ 状态栏 ─────────────────────────────────────────┐      │
│ │ 🔴 已停止  原因: 达到最大次数(20)  已继续 20 次   │      │
│ └──────────────────────────────────────────────────┘      │
│ 按钮: [ ▶ 重新开始 ]                                      │

处理中断:
│ ┌─ 状态栏 ─────────────────────────────────────────┐      │
│ │ � 处理中断: 配额耗尽→切号中...   已继续 5 次     │      │
│ └──────────────────────────────────────────────────┘      │

```
┌─ enhance-subgroup ────────────────────────────────────────┐
│ 自动继续                                    [ ●━ 开启 ]   │
│                                                            │
│ ┌━━━━━━━━━━━━━━━━━━━━━━━━━┬─────────────────────────────┐  │
│ │       🛡 守护              │      🚀 长任务             │  │
│ └━━━━━━━━━━━━━━━━━━━━━━━━━┴─────────────────────────────┘  │
│                                                            │
│ 只在异常中断时介入，AI 正常结束不干预。                      │
│                                                            │
│ 中断处理                                                    │
│ ☑ 自动点击 Continue / 继续回复 按钮                         │
│ ☑ 自动点击 Retry / 重试 按钮                                │
│ ☑ 工具调用上限时发送 continue                                │
│                                                            │
│ ▸ 更多设置                               ← 默认折叠          │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 权限批准                                             │   │
│ │ ☑ 自动批准权限请求                                   │   │
│ │   ☑ Web 请求  ☑ 终端命令  ☑ 文件写入                │   │
│ │                                                       │   │
│ │ 其他                                                 │   │
│ │ ☑ 自动关闭“文件损坏”通知                            │   │
│ └───────────────────────────────────────────────────┘   │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

---

#### 开关关闭时（两个 Tab 都灰掉）

```
┌─ enhance-subgroup ────────────────────────────────────────┐
│ 自动继续                                    [ ○─ 关闭 ]   │
│                                                            │
│ ┌─────────────────────────┬─────────────────────────────┐ │
│ │       🛡 守护              │      🚀 长任务             │ │
│ └─────────────────────────┴─────────────────────────────┘ │
│                                                   (灰色)  │
│ 已关闭。所有自动处理停止，遇到中断需手动处理。              │
└───────────────────────────────────────────────────────────┘
```

---

### 6.2 停止原因枚举

状态栏显示的停止原因：

| 原因 | 显示文字 |
|---|---|
| 达到最大继续次数 | `达到最大继续次数(N)` |
| 队列消费完（sequential 模式） | `队列已消费完` |
| 用户手动停止 | `用户手动停止` |
| F 类错误 | `上下文超长，需新开会话` / `认证失效` / `版本过旧` |
| 发送失败 | `发送失败(连续N次)` |

### 6.3 最近操作日志行

运行中状态下，在按钮下方显示最近一条操作记录：

```
格式: [图标] [操作描述] ([时间])
示例:
  ✅ 发送"继续完成" (3s前)
  🔄 切号中... (进行中)
  ✅ 切号成功 → 重发消息 (15s前)
  ⚡ 点击 Continue 按钮 (8s前)
  🔁 Retry 第2次 (延迟3s后) (20s前)
  🛡️ 自动批准权限 (1m前)
  ⚠️ 发送失败，已清空输入框 (5s前)
```

### 6.4 视觉状态总表

| 状态 | 状态点 | 文字 | 左按钮 | 右按钮 | 可编辑队列/参数 |
|---|---|---|---|---|---|
| 未启动 | ⚪ 灰 | 就绪 | ▶ 开始 | 无 | ✅ 可编辑 |
| 运行中 | 🟢 绿(呼吸) | 运行中 | ⏸ 暂停 | ⏹ 停止 | ✅ 可编辑（实时生效） |
| 已暂停 | 🟡 橙 | 已暂停 | ▶ 继续 | ⏹ 停止 | ✅ 可编辑 |
| 已停止 | 🔴 红 | 已停止(原因) | ▶ 重新开始 | 无 | ✅ 可编辑 |
| 处理中断 | 🔵 蓝(闪) | 处理中断:xxx | ⏸ 暂停 | ⏹ 停止 | ❌ 禁用 |

> **强制停止按钮**：未启动状态下灰色不可点击（disabled），运行中/暂停/处理中断时红色可点击。
>
> **测试发送按钮**：仅长任务 Tab 有。点击后发送队列第一条文字（不改变队列指针），用于验证发送机制是否正常。

### 6.5 交互逻辑

| 操作 | 行为 |
|---|---|
| **开关关闭** | **全关**：Tab 栏灰掉，下方内容隐藏，只显示"已关闭"。长任务强制停止，守护模式的所有自动行为也停止（不自动 Retry、不自动切号、不自动批准） |
| **开关开启** | 根据当前 Tab 激活对应模式。默认 Tab = 🛡 守护 |
| **切换 Tab** | 切换显示对应面板内容。若长任务正在运行中切到守护 Tab → 弹确认"长任务正在运行，切换将停止" |
| **长任务开始** | 进入运行中状态，开始 idle 监控。**不立即发送**，等当前 AI 回复结束 + idle 超时后才发送第一条 |
| **长任务暂停** | 暂停 idle 轮询，不清除计数 |
| **长任务停止**（⏹ 停止） | 等当前 AI 回复完成后停止，重置状态为"就绪"，不清空队列 |
| **强制停止**（🛑） | **立即停止一切**：清除所有定时器、取消待执行的 afterAction、清空输入框残留。不等 AI 回复完成。相当于紧急制动 |
| **处理中断时** | idle 计时器暂停，等中断处理完毕（切号成功/Retry 完成）后恢复计时 |

### 6.5.1 强制停止 vs 普通停止

| | ⏹ 停止 | 🛑 强制停止 |
|---|---|---|
| 等 AI 回复完成 | ✅ 等完再停 | ❌ 立即停 |
| 清除定时器 | ✅ | ✅ |
| 取消待执行 afterAction | ❌ 让它执行完 | ✅ 立即取消 |
| 清空输入框残留 | ❌ | ✅ |
| 重置计数 | ✅ | ✅ |
| 保留队列 | ✅ | ✅ |
| 触发方式 | 面板按钮 | 面板按钮 + 开关关闭 |

### 6.6 与现有 UI 的改动对照

| 现有元素 | 改动 |
|---|---|
| `enhance-subgroup-title`（"自动继续"纯文字标题） | → 右侧加开关按钮（参考"自动切号"样式） |
| `enhance-segmented`（⚡ 智能 / 🤖 无脑 / 关闭，3 档单选） | → 改为 2 个 Tab（� 守护 / 🚀 长任务），关闭由开关控制 |
| `enhContinueText`（单行文本框） | → 长任务 Tab 下改为队列列表；守护 Tab 下去掉 |
| `brainlessRow`（空闲 N 秒 / 最多连发 N 次） | → 移入长任务 Tab（空闲等待 / 最大继续），字段语义不变 |
| `testSendContinueBtn`（测试发送按钮） | → 仅长任务 Tab 保留 |
| 无 | → 新增：开关按钮、Tab 切换、模式说明区、强制停止按钮、状态栏、队列列表+添加、循环勾选、折叠高级设置、开始/暂停/停止按钮、最近操作日志 |
| 下方"自动切号"子分组 | 保持不变 |
| 下方"错误恢复"区域 | 保持不变（两种模式共用） |

---

## 7. 状态流转

### 长任务模式状态机

```
                    用户开启
                       │
                       ▼
              ┌─────────────┐
              │   等待 AI    │◄───────────────┐
              │  开始生成    │                │
              └──────┬──────┘                │
                     │ AI 开始生成            │
                     ▼                       │
              ┌─────────────┐                │
              │  AI 生成中   │                │
              │  (监控中)    │                │
              └──────┬──────┘                │
                     │ AI 停止生成            │
                     ▼                       │
              ┌─────────────┐                │
              │  idle 计时   │                │
              │  (等 N 秒)   │                │
              └──────┬──────┘                │
                     │ 超时                   │
                     ▼                       │
              ┌─────────────┐     成功       │
              │  发送继续    │───────────────►┘
              │  (从队列取)  │
              └──────┬──────┘
                     │ 失败 / 达到上限 / F 类错误
                     ▼
              ┌─────────────┐
              │   已停止     │
              │  (通知用户)  │
              └─────────────┘
```

### 守护模式状态机

```
              ┌─────────────┐
              │  被动监听    │◄──── 处理完毕
              │(MutationObs)│
              └──────┬──────┘
                     │ 检测到中断信号
                     ▼
              ┌─────────────┐
              │  判断类型    │
              │  分发处理    │
              └──────┬──────┘
                     │
          ┌──────────┼──────────┬───────────┐
          ▼          ▼          ▼           ▼
      点按钮     点 Retry    切号/切模型   通知
    (Continue)  (延迟重试)   (发信号)    (F类)
```

---

## 8. 待确认事项

### 已确认

- [x] 开关关闭 = 全关（守护模式的所有自动行为也停止）
- [x] 长任务"开始"不立即发送，等 idle 超时后才发第一条
- [x] 守护 Tab 不显示自动切号勾选，切号保持下方原有独立区域
- [x] 不设置全局快捷键（强制停止只通过面板按钮）
- [x] 队列运行中编辑实时生效
- [x] 默认 Tab = 🛡 守护
- [x] 守护模式默认全部勾选
- [x] Tab 顺序：🛡 守护（左）| 🚀 长任务（右）
- [x] 智能模式改名为守护模式
- [x] 不重要的设置默认折叠
- [x] 队列循环改为勾选框，不勾选 = 跑完一轮自动停止
- [x] 自动继续开关是总开关（控制所有自动行为）

### 待确认

- [ ] Windsurf 当前版本的 Auto-Continue 内置功能效果如何？是否与我们冲突？
- [ ] 工具调用上限（20次）到达时，是否显示 Continue 按钮？
- [ ] 长任务模式下，AI 明确说"已完成"时是否需要自动停止？（完成判定 → 二期）
- [ ] 继续文字队列是否需要支持模板变量？（→ 二期）
- [ ] 最右边按钮策略在不同 Windsurf 版本是否稳定？

---

## 9. 二期规划（Phase 2）

| 功能 | 说明 |
|---|---|
| **@skill-name 调用** | 队列文字中包含 `@skill-name` 时自动调用 Windsurf Skill，支持编排多步骤工作流（如：编码 → 审查 → 测试 → 修复） |
| **预设任务模板** | 内置常见工作流模板（full-feature、refactor、debug 等），用户一键选择 |
| **完成判定** | AI 回复中包含"已完成"/"任务结束"等关键词时自动停止长任务 |
| **模板变量** | 队列文字支持 `{{count}}`（已继续次数）、`{{elapsed}}`（已运行时间）等变量 |
| **运行统计** | 长任务结束后生成报告：总耗时、继续次数、中断处理次数、token 消耗估算 |

---

## 10. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-05-08 | 初始草稿 v0.1 |
| 2026-05-08 | v0.2: 重命名为"自动继续"，重设计为"长任务模式 + 智能模式"双模式架构，新增继续文字队列、状态机、UI 设计 |
| 2026-05-08 | v0.3: 智能→守护模式，去掉自动切号勾选，队列模式改为循环勾选框，参数折叠，确认总开关逻辑 |
