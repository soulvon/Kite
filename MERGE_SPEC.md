# Windsurf Pool + Better 合并规范

> 本文档描述将 `windsurf-better.js`（DOM 增强脚本）集成到 `windsurf-pool`（VS Code 扩展）的完整方案，包括自动部署、错误恢复、双端协作协议。

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────┐
│                  windsurf-pool 扩展                    │
│                                                      │
│  extension.ts ──┬── autoSwitcher.ts  (自动切号引擎)    │
│                 ├── sessionInjector.ts (session 注入)  │
│                 ├── enhancementInjector.ts [新建]      │
│                 │     ↳ 自动注入 windsurf-better.js    │
│                 └── signalBridge.ts [新建]             │
│                       ↳ 监听 localStorage 信号         │
│                                                      │
│  resources/                                          │
│    └── windsurf-better.js  [从 Windsurf_Better 复制]  │
└──────────────┬───────────────────────────────────────┘
               │
               │  localStorage (双向通信)
               │
┌──────────────┴───────────────────────────────────────┐
│            windsurf-better.js (DOM 层)                │
│                                                      │
│  ┌─ 汉化模块 (Localization)                           │
│  ├─ 气泡模块 (Bubbles)                                │
│  ├─ 设置面板 (Settings UI)                            │
│  └─ 自动恢复模块 (AutoRecovery) [新建]                 │
│       ↳ 错误检测 → 自动重试 / 发信号给扩展              │
└──────────────────────────────────────────────────────┘
```

---

## 二、自动部署（enhancementInjector.ts）

### 2.1 职责

将 `resources/windsurf-better.js` 自动注入到 Windsurf 的 `workbench.html`，替代手动执行 `python deploy.py deploy -b`。

### 2.2 注入位置

```
{appRoot}/resources/app/out/vs/code/electron-browser/workbench/workbench.html
```

其中 `appRoot = vscode.env.appRoot`，向上一级为 Windsurf 安装根目录。

### 2.3 注入流程

```
activate()
  ↓
enhancementInjector.ensureInjected()
  ↓
1. 读取 workbench.html
2. 检查是否已注入（查找标记 <!-- ws-better-v{VERSION} -->）
3. 如果版本匹配 → 跳过
4. 如果未注入或版本不同：
   a. 备份原始文件为 workbench.html.origin（仅首次）
   b. 清理旧补丁（删除旧的 <script> 标记块）
   c. 修改 CSP：添加 'unsafe-inline' 到 script-src
   d. 添加 trusted-type: abBubbles
   e. 在 </body> 前内联注入 <script> 标签
   f. 写入版本标记注释
   g. 返回 { injected: true, needRestart: true }
5. 如果返回 needRestart → 提示用户重启
```

### 2.4 版本跟踪

使用 HTML 注释标记版本：

```html
<!-- ws-better-v4.2.0 -->
<script>
// ... windsurf-better.js 内容 ...
</script>
<!-- /ws-better -->
```

版本号跟随 `package.json` 的 `version` 字段。每次扩展更新时，自动检测版本差异并重新注入。

### 2.5 Windsurf 更新检测

Windsurf 自身更新会覆盖 `workbench.html`，导致注入失效。检测策略：

- 在 `activate()` 时检查 `workbench.html` 是否包含版本标记
- 如果标记不存在 → 说明被覆盖 → 自动重新注入
- 可选：监听 `workbench.html` 的文件变更（`fs.watch`）

### 2.6 卸载/恢复

注册命令 `windsurfPool.restoreWorkbench`：

- 用 `workbench.html.origin` 恢复原始文件
- 清理注入标记

---

## 三、自动恢复模块（AutoRecovery）

### 3.1 在 windsurf-better.js 中新增

```javascript
// ========== 自动恢复 ==========
const RECOVERY_CONFIG = {
  maxRetries: 3,
  baseDelay: 5000,       // 5 秒
  maxDelay: 60000,       // 60 秒
  retryablePatterns: [...],
  switchablePatterns: [...],
};
```

### 3.2 错误分类与处理策略

#### A 类：可自动重试（DOM 层独立处理）

| 错误特征 | 策略 | 延迟 |
|---------|------|------|
| `Model provider unreachable` | 点击 Retry 按钮 | 5-30s 指数退避 |
| `internal error occurred` | 点击 Retry 按钮 | 5s |
| `retryable error from model provider` | 点击 Retry 按钮 | 10-30s |
| `This is taking a long time` | 点击 Retry 链接 | 3s |
| `Surfing.` 超过 60s 无响应 | 点击 Retry | 5s |

检测方式：MutationObserver 监听聊天区域，匹配错误文本。

```javascript
const RETRYABLE_PATTERNS = [
  /Model provider unreachable/i,
  /internal error occurred/i,
  /retryable error from model provider/i,
  /Please try again/i,
];
```

重试动作：
1. 查找错误消息附近的 Retry / 重试按钮
2. 如果找到 → `setTimeout(() => btn.click(), delay)`
3. 如果找不到按钮 → 尝试重发最后一条用户消息（从输入框历史恢复）
4. 重试计数 +1，超过 maxRetries 则停止并通知用户

#### B 类：需要切号（DOM 检测 → 通知扩展 → 扩展切号 → DOM 继续）

| 错误特征 | 信号类型 |
|---------|---------|
| `daily usage quota has been exhausted` | `quota-daily-exhausted` |
| `usage quota is exhausted` | `quota-exhausted` |
| `resource_exhausted` | `rate-limited` |
| `Failed precondition` + quota 相关 | `quota-exhausted` |
| `all API providers are over capacity` | `provider-overloaded` |

**完整协作流程**（以额度耗尽为例）：

```
时间线：
─────────────────────────────────────────────────────────────

[DOM] 检测到 "quota has been exhausted"
  │
  ├─ 记录当前对话的最后一条用户消息（从 DOM 提取）
  │
  ├─ 写 localStorage: ws-pool-signal
  │   { type: "quota-exhausted", ts: 1234567890, lastMessage: "..." }
  │
  ├─ 显示状态提示："额度耗尽，正在切换账号..."
  │
  ▼
[扩展] signalBridge 检测到信号
  │
  ├─ 立即调用 autoSwitcher.forceSwitch()
  │   （跳过定时器等待，直接找最佳候选并切换）
  │
  ├─ 切换成功后写 localStorage: ws-pool-result
  │   { type: "switched", email: "new@example.com", ts: 1234567891 }
  │
  ▼
[DOM] 检测到切换完成信号
  │
  ├─ 等待 2-3 秒（让新 session 生效）
  │
  ├─ 自动在输入框填入 lastMessage 并发送
  │   或：如果有 Retry 按钮，直接点击
  │
  ├─ 清除状态提示
  │
  └─ 清理 localStorage 信号
```

#### C 类：自动继续（已有，扩展）

| 场景 | 策略 |
|------|------|
| `Continue response` 按钮出现 | 自动点击（已实现） |
| 工具调用达到 25 次上限，Cascade 停止 | 自动在输入框发送 `continue` |
| Web 请求需要 Allow | 自动点击 Allow 按钮 |

#### D 类：仅通知（无法自动恢复）

| 场景 | 处理 |
|------|------|
| `Windsurf version is out of date` | 弹通知提醒更新 |
| 所有账号均无额度（切号失败） | 弹通知 "所有账号额度已耗尽" |

---

## 四、通信协议（localStorage Bridge）

### 4.1 信号方向

```
DOM → 扩展：localStorage key = "ws-pool-signal"
扩展 → DOM：localStorage key = "ws-pool-result"
```

### 4.2 信号格式

#### DOM → 扩展（请求信号）

```typescript
interface PoolSignal {
  type: 'quota-exhausted'       // 每日/每周额度耗尽
      | 'quota-daily-exhausted' // 仅每日耗尽
      | 'rate-limited'          // 速率限制
      | 'provider-overloaded';  // API 提供商过载
  ts: number;                   // 时间戳（毫秒）
  lastMessage?: string;         // 最后一条用户消息（用于切号后重发）
  conversationId?: string;      // 当前会话 ID（可选）
  retryCount?: number;          // 已重试次数
}
```

#### 扩展 → DOM（结果信号）

```typescript
interface PoolResult {
  type: 'switched'              // 切号成功
      | 'switch-failed'         // 切号失败（无可用账号等）
      | 'retrying';             // 正在切换中
  ts: number;
  email?: string;               // 新账号
  error?: string;               // 失败原因
}
```

### 4.3 扩展侧监听实现（signalBridge.ts）

```typescript
// 方案 A：定时轮询 localStorage（通过 webview 中转）
// 方案 B：通过 Webview postMessage 中转

// 推荐方案 B：利用已有的 sidebarProvider webview
// sidebarProvider 的 webview 运行在渲染进程，可以访问 localStorage
// webview 轮询 localStorage → postMessage → 扩展收到 → 执行切号
```

#### 方案 B 详细流程

```
sidebarProvider webview (渲染进程)
  │
  ├── setInterval 每 2s 检查 localStorage['ws-pool-signal']
  │
  ├── 检测到新信号 → vscode.postMessage({ command: 'poolSignal', data: signal })
  │
  └── 接收扩展回复 → 写 localStorage['ws-pool-result']

extension.ts (扩展主机进程)
  │
  ├── webview.onDidReceiveMessage → 收到 'poolSignal'
  │
  ├── 调用 autoSwitcher.forceSwitch()
  │
  └── 回复 webview → { command: 'poolResult', data: result }
```

### 4.4 无 windsurf-pool 时的降级

如果用户没有安装 windsurf-pool 扩展：

- DOM 写入 `ws-pool-signal` 后，设置 5 秒超时
- 超时无 `ws-pool-result` → 判定扩展未安装
- 降级为：A 类错误自动重试，B 类错误仅弹通知
- 通知内容："额度耗尽，请手动切换账号或安装 windsurf-pool 扩展实现自动切换"

---

## 五、windsurf-better.js 改动明细

### 5.1 新增 settings 字段

```javascript
const DEFAULT_SETTINGS = {
  // ... 现有字段 ...
  // 自动恢复
  autoRecoveryEnabled: true,
  autoApproveWebRequests: false,   // Web 请求自动批准（默认关闭，安全考虑）
  autoSendContinue: true,          // 工具上限自动发 continue
  recoveryMaxRetries: 3,
  recoveryBaseDelay: 5000,
};
```

### 5.2 设置面板新增区块

```
自动恢复
  ☑ 启用自动恢复
  ☑ 工具上限自动继续
  ☐ Web 请求自动批准
  最大重试次数: [3]
```

### 5.3 AutoRecovery 模块结构

```javascript
// ========== 自动恢复 ==========
let recoveryObserver = null;
let recoveryRetryCount = 0;
let lastUserMessage = '';

function startAutoRecovery() {
  if (recoveryObserver) recoveryObserver.disconnect();
  if (!settings.autoRecoveryEnabled) return;

  recoveryObserver = new MutationObserver(debounce(() => {
    checkForErrors();
    checkForContinuePrompts();
    checkForWebRequestApproval();
    checkForPoolResult();
  }, 500));

  recoveryObserver.observe(document.body, { childList: true, subtree: true });
  trackLastUserMessage();  // 持续跟踪最后一条用户消息
}

function checkForErrors() {
  // 1. 扫描聊天区域的错误文本
  // 2. 分类：A 类 / B 类 / D 类
  // 3. A 类 → findAndClickRetry(delay)
  // 4. B 类 → sendPoolSignal(type, lastUserMessage)
  // 5. D 类 → showNotification(message)
}

function sendPoolSignal(type, lastMessage) {
  const signal = { type, ts: Date.now(), lastMessage };
  localStorage.setItem('ws-pool-signal', JSON.stringify(signal));
  showRecoveryStatus('正在请求切换账号...');
  // 设置超时检测
  setTimeout(() => checkPoolTimeout(signal.ts), 8000);
}

function checkForPoolResult() {
  const raw = localStorage.getItem('ws-pool-result');
  if (!raw) return;
  const result = JSON.parse(raw);
  // 只处理最近 30 秒内的结果
  if (Date.now() - result.ts > 30000) return;

  if (result.type === 'switched') {
    // 切号成功 → 等待 session 生效 → 重发
    setTimeout(() => {
      retryLastMessage(result);
      localStorage.removeItem('ws-pool-result');
      localStorage.removeItem('ws-pool-signal');
    }, 3000);
  } else if (result.type === 'switch-failed') {
    showNotification(result.error || '切换失败，所有账号可能均无额度');
    localStorage.removeItem('ws-pool-result');
    localStorage.removeItem('ws-pool-signal');
  }
}

function retryLastMessage(result) {
  // 优先点击 Retry 按钮
  const retryBtn = findRetryButton();
  if (retryBtn) { retryBtn.click(); return; }
  // 否则在输入框重发最后一条消息
  const input = findCascadeInput();
  if (input && lastUserMessage) {
    input.textContent = lastUserMessage;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // 触发发送
    setTimeout(() => {
      const sendBtn = findSendButton();
      if (sendBtn) sendBtn.click();
    }, 500);
  }
}

function trackLastUserMessage() {
  // 监听输入框的 submit 事件，持续记录最后一条消息
  // 或从 DOM 中提取最后一条用户消息气泡的文本
}
```

### 5.4 错误检测正则汇总

```javascript
// A 类：可自动重试
const RETRYABLE_ERRORS = [
  /Model provider unreachable/i,
  /an internal error occurred/i,
  /retryable error from model provider/i,
  /API provider is overloaded\.\s*Please try again/i,
  /This is taking a long time/i,
];

// B 类：需要切号
const SWITCHABLE_ERRORS = [
  { pattern: /daily usage quota has been exhausted/i, signal: 'quota-daily-exhausted' },
  { pattern: /usage quota is exhausted/i, signal: 'quota-exhausted' },
  { pattern: /resource_exhausted/i, signal: 'rate-limited' },
  { pattern: /all API providers are over capacity/i, signal: 'provider-overloaded' },
  { pattern: /Failed precondition.*quota/i, signal: 'quota-exhausted' },
];

// C 类：自动继续
const CONTINUE_TRIGGERS = [
  { text: 'Continue response', action: 'click' },          // 回复截断
  { text: '继续回复', action: 'click' },                    // 已翻译版
  { pattern: /reached.*invocation limit/i, action: 'send-continue' },  // 工具上限
];

// D 类：仅通知
const NOTIFY_ONLY = [
  /Windsurf version is out of date/i,
];
```

---

## 六、windsurf-pool 扩展改动明细

### 6.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/enhancementInjector.ts` | workbench.html 注入逻辑 |
| `src/signalBridge.ts` | localStorage 信号桥接 |
| `resources/windsurf-better.js` | DOM 增强脚本（从 Windsurf_Better 项目复制） |

### 6.2 enhancementInjector.ts

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_PREFIX = '<!-- ws-better-v';
const MARKER_SUFFIX = ' -->';
const BLOCK_START = '<!-- ws-better-start -->';
const BLOCK_END = '<!-- ws-better-end -->';

export function ensureEnhancement(): { injected: boolean; needRestart: boolean } {
  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) return { injected: false, needRestart: false };

  const html = fs.readFileSync(workbenchPath, 'utf8');
  const currentVersion = getExtensionVersion();

  // 检查版本标记
  if (html.includes(`${MARKER_PREFIX}${currentVersion}${MARKER_SUFFIX}`)) {
    return { injected: true, needRestart: false };  // 版本匹配，无需重新注入
  }

  // 需要注入或更新
  const scriptContent = getScriptContent();
  if (!scriptContent) return { injected: false, needRestart: false };

  // 备份（仅首次）
  const originPath = workbenchPath + '.origin';
  if (!fs.existsSync(originPath)) {
    fs.copyFileSync(workbenchPath, originPath);
  }

  let newHtml = html;

  // 清理旧注入
  const blockStartIdx = newHtml.indexOf(BLOCK_START);
  const blockEndIdx = newHtml.indexOf(BLOCK_END);
  if (blockStartIdx >= 0 && blockEndIdx >= 0) {
    newHtml = newHtml.substring(0, blockStartIdx) +
              newHtml.substring(blockEndIdx + BLOCK_END.length);
  }

  // CSP: 添加 'unsafe-inline'
  newHtml = ensureCSP(newHtml);

  // Trusted Types: 添加 abBubbles
  newHtml = ensureTrustedTypes(newHtml);

  // 注入脚本
  const injection =
    `\n${BLOCK_START}\n` +
    `${MARKER_PREFIX}${currentVersion}${MARKER_SUFFIX}\n` +
    `<script>\n${scriptContent}\n</script>\n` +
    `${BLOCK_END}\n`;

  newHtml = newHtml.replace('</body>', injection + '</body>');
  fs.writeFileSync(workbenchPath, newHtml, 'utf8');

  return { injected: true, needRestart: true };
}

export function restoreWorkbench(): boolean {
  const workbenchPath = getWorkbenchHtmlPath();
  if (!workbenchPath) return false;
  const originPath = workbenchPath + '.origin';
  if (!fs.existsSync(originPath)) return false;
  fs.copyFileSync(originPath, workbenchPath);
  return true;
}

function getWorkbenchHtmlPath(): string | null {
  const appRoot = vscode.env.appRoot;
  const p = path.join(appRoot, 'out', 'vs', 'code',
    'electron-browser', 'workbench', 'workbench.html');
  return fs.existsSync(p) ? p : null;
}

function getScriptContent(): string | null {
  // 从扩展 resources 目录读取
  const ext = vscode.extensions.getExtension('local.windsurf-pool');
  if (!ext) return null;
  const scriptPath = path.join(ext.extensionPath, 'resources', 'windsurf-better.js');
  return fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : null;
}

function getExtensionVersion(): string {
  const ext = vscode.extensions.getExtension('local.windsurf-pool');
  return ext?.packageJSON?.version || '0.0.0';
}

function ensureCSP(html: string): string {
  // 在 script-src 中添加 'unsafe-inline'
  if (html.includes("'unsafe-inline'")) return html;
  return html.replace(
    /script-src\s+'([^']+)'/,
    "script-src '$1' 'unsafe-inline'"
  );
}

function ensureTrustedTypes(html: string): string {
  if (html.includes('abBubbles')) return html;
  return html.replace(
    /trusted-types\s+([^;]+)/,
    'trusted-types $1 abBubbles'
  );
}
```

### 6.3 signalBridge.ts

```typescript
import { AutoSwitcher } from './autoSwitcher';

/**
 * 信号桥接：在 sidebarProvider 的 webview 中注入 localStorage 轮询脚本
 * webview 检测到 ws-pool-signal → postMessage → 扩展处理 → 回写结果
 */

export function getSignalBridgeScript(): string {
  return `
    // localStorage 信号桥
    (function() {
      let lastSignalTs = 0;
      setInterval(() => {
        try {
          const raw = localStorage.getItem('ws-pool-signal');
          if (!raw) return;
          const signal = JSON.parse(raw);
          if (signal.ts <= lastSignalTs) return;
          lastSignalTs = signal.ts;
          // 通知扩展
          vscode.postMessage({ command: 'poolSignal', data: signal });
        } catch {}
      }, 2000);

      // 接收扩展回复，写入 localStorage
      window.addEventListener('message', e => {
        if (e.data?.command === 'poolResult') {
          localStorage.setItem('ws-pool-result', JSON.stringify(e.data.data));
        }
      });
    })();
  `;
}

/**
 * 在 sidebarProvider 的 onDidReceiveMessage 中处理信号
 */
export async function handlePoolSignal(
  signal: { type: string; ts: number; lastMessage?: string },
  autoSwitcher: AutoSwitcher,
  respond: (result: any) => void
): Promise<void> {
  console.log('[signalBridge] 收到信号:', signal.type);

  try {
    // 强制立即切号（不等定时器）
    const switched = await autoSwitcher.forceSwitch(signal.type);
    if (switched) {
      respond({
        type: 'switched',
        ts: Date.now(),
        email: switched.email,
      });
    } else {
      respond({
        type: 'switch-failed',
        ts: Date.now(),
        error: '无可用账号',
      });
    }
  } catch (err) {
    respond({
      type: 'switch-failed',
      ts: Date.now(),
      error: String(err),
    });
  }
}
```

### 6.4 autoSwitcher.ts 新增方法

```typescript
/**
 * 强制立即切号（由信号桥触发，跳过定时器和冷却期）
 */
async forceSwitch(reason: string): Promise<{ email: string } | null> {
  const s = this.settings;
  const curEmail = this._ctx.globalState.get<string>('lastEmail');
  if (!curEmail) return null;

  // 先刷新所有号的额度
  await this.refreshAll(true);

  // 找最佳候选（不看 threshold，只看谁最多额度）
  const cand = this._findBest(curEmail, 0, s.scoreMode);
  if (!cand || cand.score <= 0) return null;

  // 执行切换
  const accounts = await accountStore.readAccounts(this._ctx);
  const acct = accounts.find(a => a.email === cand.email);
  if (!acct) return null;

  const { injectSession } = await import('./sessionInjector');
  const ok = await injectSession(this._ctx, acct);
  if (!ok) return null;

  await accountStore.setCurrentAccount(this._ctx, cand.email);
  this._onRefreshUI?.();

  const log = `[${ts()}] 信号切号(${reason}): ${curEmail} → ${cand.email}`;
  this._onSwitchEvent?.(log, `${reason} → ${cand.email}`, '');

  return { email: cand.email };
}
```

### 6.5 extension.ts 改动

```typescript
import { ensureEnhancement } from './enhancementInjector';

export function activate(context: vscode.ExtensionContext) {
  // ... 现有代码 ...

  // [新增] 自动注入 DOM 增强
  try {
    const result = ensureEnhancement();
    if (result.needRestart) {
      vscode.window.showInformationMessage(
        'Windsurf 增强已更新，重启后生效。',
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }
  } catch (err) {
    console.error('[windsurf-pool] Enhancement injection failed:', err);
  }

  // ... 现有命令注册 ...

  // [新增] 恢复命令
  context.subscriptions.push(
    vscode.commands.registerCommand('windsurfPool.restoreWorkbench', () => {
      const { restoreWorkbench } = require('./enhancementInjector');
      if (restoreWorkbench()) {
        vscode.window.showInformationMessage('已恢复原始 workbench.html，重启生效。');
      }
    })
  );
}
```

### 6.6 package.json 新增

```json
{
  "commands": [
    {
      "command": "windsurfPool.restoreWorkbench",
      "title": "恢复原始 Workbench",
      "category": "Windsurf Pool"
    }
  ],
  "configuration": {
    "properties": {
      "windsurfPool.enhancement.enabled": {
        "type": "boolean",
        "default": true,
        "description": "启用 Windsurf 增强（汉化+气泡+自动恢复）"
      },
      "windsurfPool.enhancement.autoRecovery": {
        "type": "boolean",
        "default": true,
        "description": "启用自动错误恢复（额度耗尽自动切号+自动重试）"
      }
    }
  }
}
```

---

## 七、协作场景完整流程

### 场景 1：额度耗尽 → 切号 → 自动继续

```
用户: "帮我写个登录页面"
  ↓
Cascade: 开始生成代码...
  ↓
[错误] "Failed precondition: Your daily usage quota has been exhausted"
  ↓
[DOM/AutoRecovery] 检测到 B 类错误
  ├─ 提取 lastMessage = "帮我写个登录页面"
  ├─ 写 localStorage: ws-pool-signal { type: "quota-daily-exhausted", lastMessage: "..." }
  ├─ UI 显示："额度耗尽，正在切换账号..."
  ↓
[扩展/signalBridge] 收到信号
  ├─ autoSwitcher.forceSwitch("quota-daily-exhausted")
  ├─ 刷新所有号额度 → 选最佳候选 → 注入 session
  ├─ 写 localStorage: ws-pool-result { type: "switched", email: "b@test.com" }
  ↓
[DOM/AutoRecovery] 检测到切号完成
  ├─ 等待 3s（session 生效）
  ├─ 在输入框填入 "帮我写个登录页面" 并发送
  ├─ UI 显示："已切换至 b@test.com，继续中..."
  ↓
Cascade: 继续生成代码... ✅
```

### 场景 2：速率限制 → 先重试 → 仍失败 → 切号

```
[错误] "resource_exhausted. Please try again later."
  ↓
[DOM/AutoRecovery] 检测到 B 类错误
  ├─ 先当作 A 类尝试：等待 10s → 点 Retry
  ├─ 如果仍报错（retryCount >= 2）
  ├─ 升级为 B 类：发送 ws-pool-signal { type: "rate-limited" }
  ↓
[扩展] 切号流程同场景 1
```

### 场景 3：回复截断 → 自动继续（纯 DOM，无需扩展）

```
Cascade: 代码输出中...
  ↓
[截断] "Cascade's response was cut short"
  ↓ 出现 "Continue response" 按钮
  ↓
[DOM/AutoContinue] 800ms 后自动点击
  ↓
Cascade: 继续输出... ✅
```

### 场景 4：工具调用上限 → 自动发 continue

```
Cascade: 第 25 次工具调用后停止
  ↓
[DOM/AutoRecovery] 检测到 Cascade 停止且无错误
  ├─ 等待 3s 确认确实停止
  ├─ 在输入框输入 "continue" 并发送
  ↓
Cascade: 继续工作... ✅
```

### 场景 5：Web 请求授权（需用户选择是否自动）

```
Cascade: 需要访问 https://xxx.com
  ↓ 出现 Allow / Deny 弹窗
  ↓
[DOM/AutoRecovery]
  ├─ 如果 autoApproveWebRequests = true → 自动点 Allow
  ├─ 如果 = false → 不处理（用户手动）
```

### 场景 6：无 windsurf-pool 时的降级

```
[错误] "quota has been exhausted"
  ↓
[DOM] 写 ws-pool-signal → 等待 8s → 无 ws-pool-result
  ↓
[DOM] 降级处理：
  ├─ 弹通知："额度耗尽，请手动切换账号"
  ├─ 可选：显示链接 "安装 windsurf-pool 实现自动切换"
  └─ 停止自动重试
```

---

## 八、开发顺序建议

### Phase 1：DOM 增强 + 自动恢复（windsurf-better.js）
1. ☐ 新增 AutoRecovery 模块（错误检测 + A 类自动重试）
2. ☐ 新增 localStorage 信号发送（B 类错误）
3. ☐ 新增 C 类自动继续扩展（工具上限 + Web 请求）
4. ☐ 新增 ws-pool-result 监听 + 自动重发
5. ☐ 新增设置面板区块
6. ☐ 新增降级逻辑（无扩展时的 fallback）

### Phase 2：扩展集成（windsurf-pool）
7. ☐ 创建 `enhancementInjector.ts`
8. ☐ 在 `activate()` 中调用自动注入
9. ☐ 复制 `windsurf-better.js` 到 `resources/`
10. ☐ 创建 `signalBridge.ts`
11. ☐ 在 `sidebarProvider.ts` 中集成信号桥脚本
12. ☐ 在 `autoSwitcher.ts` 中新增 `forceSwitch()` 方法
13. ☐ 注册新命令（restoreWorkbench）
14. ☐ 更新 `package.json` 配置项

### Phase 3：测试 + 优化
15. ☐ 端到端测试所有协作场景
16. ☐ 边界情况：快速连续错误、切号失败回退、多窗口冲突
17. ☐ 清理旧的 `deploy.py` 依赖，更新 README

---

## 九、注意事项

1. **localStorage 访问权限**：扩展主机进程无法直接访问 localStorage，必须通过 webview（sidebarProvider）中转
2. **竞态条件**：多窗口/多实例场景下 localStorage 可能被并发写入，需用时间戳去重
3. **安全性**：`autoApproveWebRequests` 默认关闭，避免自动批准恶意请求
4. **幂等性**：DOM 注入和扩展补丁都需要幂等，重复执行不应产生副作用
5. **Windsurf 更新**：每次 Windsurf 更新会覆盖 workbench.html 和 extension.js，两个补丁都需要自动重新应用
