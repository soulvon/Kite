# Windsurf 号池管理 — 全新重写开发规格文档

> 本文档详细描述了现有 VS Code 扩展 "Windsurf 号池管理" 的**全部功能、API 接口、数据结构、UI 交互**，  
> 目标是让开发者可以从零复刻一个功能完全等价的 TypeScript + Webview 扩展，**无需阅读混淆代码**。

---

## 一、项目概述

| 字段 | 值 |
|------|----|
| 名称 | `windsurf-pool` |
| 显示名 | Windsurf 号池管理 |
| 描述 | Windsurf 无感换号：一键切换多账号，自动注入会话，实时显示每日/每周配额，免退出、免重启。 |
| 入口 | 侧栏 Webview（Activity Bar 图标） |
| 引擎 | VS Code / Windsurf ≥ 1.80.0 |
| 语言 | 后端 TypeScript，前端纯 HTML+CSS+JS（注入到 Webview） |

---

## 二、扩展声明（package.json）

### 2.1 视图容器

```jsonc
"viewsContainers": {
  "activitybar": [{
    "id": "windsurfSwitchMinimal",
    "title": "Windsurf 号池管理",
    "icon": "resources/icon.svg"
  }]
},
"views": {
  "windsurfSwitchMinimal": [{
    "type": "webview",
    "id": "windsurfSwitchMinimal.sidebar",
    "name": " "
  }]
}
```

### 2.2 命令

| 命令 ID | 标题 | 快捷键 |
|---------|------|--------|
| `windsurfSwitchMinimal.openSidebar` | 打开换号侧栏 | — |
| `windsurfSwitchMinimal.applyPatch` | 应用 Windsurf 注入补丁 | — |
| `windsurfSwitchMinimal.addAccount` | 添加账号 | — |
| `windsurfSwitchMinimal.switchAccount` | 切换账号（弹窗列表） | — |
| `windsurfSwitchMinimal.switchNextAccount` | 切换下一个账号 | `Ctrl+Alt+Shift+K` |
| `windsurfSwitchMinimal.removeAccount` | 删除账号 | — |
| `windsurfSwitchMinimal.showStatus` | 账号状态 | — |

### 2.3 配置项

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `windsurfSwitchMinimal.refreshOnSwitch` | boolean | false | 切换后是否重载窗口 |
| `windsurfSwitchMinimal.showSwitchNotification` | boolean | false | 切换时弹提示 |
| `windsurfSwitchMinimal.logoutBeforeSwitch` | boolean | false | 切换前先 logout |

---

## 三、后端架构

### 3.1 账号存储

- **存储位置**: VS Code `ExtensionContext.secrets`（加密安全存储）
- **存储键**: 一个常量字符串（如 `"windsurfSwitchMinimal.accounts.v1"`）
- **数据格式**: JSON 数组

```typescript
interface StoredAccount {
  email: string;       // 邮箱
  apiKey: string;      // Session Token（从登录 API 获取）
  apiServerUrl: string; // API 服务器地址
  name?: string;       // 显示名（通常是 email 的 @ 前部分）
}
```

#### 读取账号
```typescript
async function readAccounts(context: vscode.ExtensionContext): Promise<StoredAccount[]> {
  const raw = await context.secrets.get(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidAccount) : [];
  } catch { return []; }
}
```

#### 保存账号
```typescript
async function saveAccounts(context: vscode.ExtensionContext, accounts: StoredAccount[]): Promise<void> {
  await context.secrets.store(ACCOUNTS_KEY, JSON.stringify(accounts));
}
```

#### 新增账号（upsert 逻辑）
```typescript
async function upsertAccount(context: vscode.ExtensionContext, account: StoredAccount): Promise<void> {
  const accounts = await readAccounts(context);
  const idx = accounts.findIndex(a => a.email === account.email);
  if (idx >= 0) {
    accounts[idx] = account; // 已存在则更新
  } else {
    accounts.push(account);  // 新增
  }
  await saveAccounts(context, accounts);
}
```

#### 删除账号
```typescript
async function removeAccount(context: vscode.ExtensionContext, email: string): Promise<boolean> {
  const accounts = await readAccounts(context);
  const filtered = accounts.filter(a => a.email !== email);
  if (filtered.length === accounts.length) return false; // 没找到
  await saveAccounts(context, filtered);
  return true;
}
```

### 3.2 当前活跃账号

- **存储方式**: 通过 `ExtensionContext.globalState` 存 `lastEmail`
- 用于标记当前正在使用的账号

---

## 四、Windsurf API 接口（完整登录流程）

### 4.1 认证方式检测

```
POST https://windsurf.com/_devin-auth/connections
Content-Type: application/json

Body: { "product": "windsurf", "email": "<邮箱>" }

Response 200:
{
  "auth_method": {
    "method": "auth1" | "firebase",
    "has_password": true | false
  }
}
```

- `method === "auth1"` → 走 Auth1 流程（新版账号）
- `method === "firebase"` → 走 Firebase 流程（旧版账号）

### 4.2 Auth1 登录流程

#### 步骤 1：密码登录

```
POST https://windsurf.com/_devin-auth/password/login
Content-Type: application/json

Body: { "email": "<邮箱>", "password": "<密码>" }

Response 200:
{
  "token": "<auth1Token>",
  "user_id": "<userId>"
}
```

- 401/403 → 邮箱或密码错误
- `has_password === false` → 该账号未开启密码登录（Google/SSO 账号）

#### 步骤 2：PostAuth（获取 sessionToken）

```
POST https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth
Content-Type: application/json

Headers:
  Accept: application/json
  Connect-Protocol-Version: 1
  X-Devin-Auth1-Token: <auth1Token>
  X-Devin-Account-Id: <userId>

Body: {}

Response 200:
{
  "sessionToken": "<sessionToken>",
  "accountId": "<accountId>",
  "primaryOrgId": "<primaryOrgId>"
}
```

- `sessionToken` 就是最终的 `apiKey`
- `apiServerUrl` 固定为 `https://server.self-serve.windsurf.com`

#### Auth1 登录成功返回：
```typescript
{
  ok: true,
  value: {
    email: email,
    apiKey: sessionToken,
    apiServerUrl: "https://server.self-serve.windsurf.com",
    name: email.split("@")[0]
  }
}
```

### 4.3 Firebase 登录流程（旧版兜底）

#### 步骤 1：Firebase signInWithPassword

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY
Content-Type: application/json

Headers:
  Accept: */*
  Referer: https://windsurf.com/

Body: {
  "email": "<邮箱>",
  "password": "<密码>",
  "returnSecureToken": true,
  "clientType": "CLIENT_TYPE_WEB"
}

Response 200:
{
  "idToken": "<firebaseIdToken>",
  ...
}
```

错误码映射：
| 错误码 | 中文 |
|--------|------|
| `EMAIL_NOT_FOUND` | 邮箱不存在 |
| `INVALID_PASSWORD` | 密码错误 |
| `INVALID_LOGIN_CREDENTIALS` | 邮箱或密码错误 |
| `USER_DISABLED` | 账号已被禁用 |
| `TOO_MANY_ATTEMPTS_TRY_LATER` | 尝试过多请稍后再试 |

#### 步骤 2：RegisterUser（获取 apiKey）

```
POST https://register.windsurf.com/exa.api_server_pb.ApiServerService/RegisterUser
Content-Type: application/json

Headers:
  Accept: application/json
  connect-protocol-version: 1

Body: { "firebase_id_token": "<idToken>" }

Response 200:
{
  "api_key": "<apiKey>",
  "api_server_url": "https://server.codeium.com",
  "name": "<name>"
}
```

#### Firebase 登录成功返回：
```typescript
{
  ok: true,
  value: {
    email: email,
    apiKey: api_key,
    apiServerUrl: api_server_url || "https://server.codeium.com",
    name: name || email.split("@")[0]
  }
}
```

### 4.4 配额查询（GetUserStatus）

```
POST <apiServerUrl>/exa.api_server_pb.ApiServerService/GetUserStatus
Content-Type: application/json

Headers:
  Connect-Protocol-Version: 1
  Accept: application/json

Body: {
  "metadata": {
    "apiKey": "<apiKey>",
    "ideName": "windsurf",
    "ideVersion": "0.0.0",
    "extensionName": "windsurf-next",
    "extensionVersion": "1.0.0",
    "locale": "en"
  }
}

Response 200:
{
  "userStatus": {
    "planStatus": {
      "planInfo": {
        "name": "Pro" | "Free" | ...
      },
      "dailyQuotaRemainingPercent": 85,
      "weeklyQuotaRemainingPercent": 72,
      "dailyQuotaResetAtUnix": "1714900000",
      "weeklyQuotaResetAtUnix": "1715200000",
      "overageBalanceMicros": "5000000",
      "availableFlexCredits": "...",
      "availablePromptCredits": "...",
      "availableFlowCredits": "..."
    }
  }
}
```

**注意**: `apiServerUrl` 不同的账号可能不同：
- Auth1 账号: `https://server.self-serve.windsurf.com`
- Firebase 账号: `https://server.codeium.com`

#### 构建 snapshot 对象：
```typescript
interface UsageSnapshot {
  name: string;
  email: string;
  planName: string;                 // planStatus.planInfo.name || "Unknown"
  dailyRemainingPercent: number;    // planStatus.dailyQuotaRemainingPercent
  weeklyRemainingPercent: number;   // planStatus.weeklyQuotaRemainingPercent
  dailyResetAtUnix: number;         // parseInt(planStatus.dailyQuotaResetAtUnix)
  weeklyResetAtUnix: number;        // parseInt(planStatus.weeklyQuotaResetAtUnix)
  flexCredits: number;              // parseInt(planStatus.availableFlexCredits)
  _rawPlanStatus: object;           // 原始 planStatus 对象（用于额外字段）
}
```

### 4.5 会员期限查询（GetPlanStatus）

```
POST https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus
Content-Type: application/json

Headers:
  Accept: application/json
  Connect-Protocol-Version: 1
  x-auth-token: <apiKey>
  x-devin-session-token: <apiKey>

Body: { "includeTopUpStatus": true }

Response 200:
{
  "planStatus": {
    "planStart": "2025-01-01T00:00:00Z",
    "planEnd": "2025-02-01T00:00:00Z",
    "availablePromptCredits": "...",
    "availableFlowCredits": "..."
  }
}
```

用于显示会员期限（`planStart` ~ `planEnd`）和剩余天数。

### 4.6 登录错误处理汇总

```typescript
// 通用错误格式
interface LoginResult {
  ok: boolean;
  error?: string;             // 失败时的中文错误消息
  value?: StoredAccount;      // 成功时的账号数据
}
```

---

## 五、账号切换机制（核心）

### 5.1 注入 Session 到 Windsurf

切换账号的核心是将 `apiKey`（sessionToken）注入到 Windsurf 的认证系统中。  
这通过**修补 Windsurf 内置的 AuthenticationProvider** 实现：

#### 关键操作：
```typescript
// 1. 构造 session 对象
const session = {
  id: uuid(),                        // 随机 UUID
  accessToken: account.apiKey,       // Session Token
  account: { label: account.email, id: account.email },
  scopes: []
};

// 2. 写入 Windsurf 的 secrets 存储
// sessionsSecretKey 是 Windsurf 内置认证提供者的 session 存储键
await context.secrets.store(sessionsSecretKey, JSON.stringify([session]));

// 3. 更新 apiServerUrl
await context.globalState.update("apiServerUrl", account.apiServerUrl);

// 4. 如果 apiServerUrl 变化了，重启 LanguageServerClient
if (newUrl !== oldUrl) {
  await LanguageServerClient.getInstance().restart(newUrl);
}

// 5. 触发 session 变更事件
this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
```

### 5.2 补丁注入方式

扩展需要在 Windsurf 的**内置认证处理函数**中注入自定义代码。  
这通过在运行时搜索并修补 Windsurf 的 `handleAuthToken` 方法实现：

```
目标正则：/^async handleAuthToken\(A\)\{.../
替换逻辑：在 handleAuthToken 中插入自定义的 session 写入代码
```

具体补丁的查找和注入方法：
1. 扫描 Windsurf 安装目录下的 `workbench.desktop.main.js`
2. 找到 `handleAuthToken` 方法
3. 在其中注入 session 写入 + apiServerUrl 更新 + LSP 重启逻辑

### 5.3 切换流程

```
用户点击"切换" → postMessage({type:'switch', email})
  → 后端 _t(panel, email)
    → 从 secrets 读取账号列表
    → 找到目标账号
    → 调用 q(extensionContext, email) 注入 session
      → secrets.store(sessionsSecretKey, [...])
      → globalState.update("apiServerUrl", ...)
      → 重启 LanguageServer（如有必要）
    → showInformationMessage("已切换至 " + email)
    → refresh() 刷新侧栏
```

---

## 六、Webview 消息协议

### 6.1 Webview → 后端（postMessage）

| type | 参数 | 说明 |
|------|------|------|
| `loginSave` | `{email, password}` | 登录并保存账号 |
| `saveApiKey` | `{email, apiKey, apiServerUrl}` | 手动保存 Token（已移除此Tab） |
| `switch` | `{email}` | 切换到指定账号 |
| `delete` | `{email}` | 删除账号 |
| `fetchUsageFor` | `{email}` | 请求指定账号的配额数据 |
| `runCommand` | `{command}` | 执行 VS Code 命令 |
| `openExternal` | `{url}` | 在浏览器打开链接 |
| `licenseActivate` | `{key}` | 激活卡密（已移除此UI） |
| `licenseRefresh` | — | 刷新卡密状态（已移除此UI） |

### 6.2 后端 → Webview（postMessage）

| type | 数据 | 说明 |
|------|------|------|
| `usage` | `{email, snapshot, error?}` | 某账号的配额数据 |
| `accountsChanged` | `{accounts: [{email}], lastEmail}` | 账号列表变更通知 |
| `licenseResult` | `{ok, error?, expireAt?}` | 卡密激活结果（已移除） |

---

## 七、Webview 前端功能

### 7.1 初始化流程

```javascript
removeUnwantedSections();  // 移除不需要的 UI（卡密、购买链接、apiKey Tab）
initTabs();                // Tab 切换
initAccountList();         // 账号列表操作
initButtons();             // 全局按钮
initUsageChannel();        // 配额数据监听
initAutoRefresh();         // 定时刷新
initLicenseChannel();      // 卡密监听（可不实现）
restoreUsageCache();       // 恢复缓存
initBatchImport();         // 批量导入 UI
checkBatchResume();        // 恢复未完成的批量导入
initAutoSwitch();          // 自动切号
initCardView();            // 卡片视图
fetchAllGridUsage();       // 延迟 1s 拉取所有配额
```

### 7.2 卡片视图（主视图）

每个账号显示为一张卡片，包含：

```
┌─────────────────────────────────┐
│ user@example.com        [当前]  │  ← 邮箱 + 激活标签
│ Pro                             │  ← 套餐名
├─────────────────────────────────┤
│ 日配额        85%               │
│ ████████████░░░░                │  ← 进度条（颜色分级）
│ 重置 05-04 08:00                │
│                                 │
│ 周配额        72%               │
│ █████████░░░░░░░                │
│ 重置 05-07 08:00                │
├─────────────────────────────────┤
│ 额外用量余额      $5.00         │
│ 会员期限     剩余28天 (01/01-02/01) │
├─────────────────────────────────┤
│ ● 使用中        🔄 ✕            │  ← 操作按钮
└─────────────────────────────────┘
```

#### 进度条颜色分级：
| 剩余百分比 | CSS 类 | 颜色含义 |
|-----------|--------|---------|
| ≤ 10% | `is-danger` | 红色 |
| ≤ 30% | `is-warn` | 黄色 |
| < 50% | `is-info` | 蓝色 |
| ≥ 50% | `is-ok` | 绿色 |

#### 会员期限颜色：
| 条件 | CSS 类 |
|------|--------|
| 已过期 | `period-gray` |
| ≤ 1 天 | `period-red` |
| ≤ 3 天 | `period-yellow` |
| > 3 天 | `period-green` |

#### 卡片操作按钮：
- **切换** (`data-grid-action="switch"`) — 非当前账号显示
- **使用中** — 当前账号显示
- **刷新** (`data-grid-action="refresh"`) — 刷新单个卡片配额
- **删除** (`data-grid-action="delete"`) — 带淡出动画

#### 卡片排序规则：
1. 当前账号始终置顶
2. 其余按日配额降序排列

### 7.3 右上角工具栏

- **刷新按钮** — 刷新所有账号配额（带旋转动画）
- **设置按钮** — 弹出刷新间隔设置：
  - "配额自动刷新"：1/3/5/10/30/60 分钟
  - "当前账号刷新"：1/2/3/5/10 分钟

### 7.4 批量导入

位于「邮箱密码」面板中，通过 radio 切换「单个登录」/「批量导入」。

#### 文本格式导入：
- 分隔符选项：`----`（默认）、Tab、空格、逗号、竖线、自定义
- 格式：每行 `邮箱{分隔符}密码`
- 示例：`user1@example.com----password123`

#### JSON 格式导入：
- 格式：`[{"email":"...", "password":"..."},...]`

#### 批量导入流程：
1. 解析文本 → `[{email, password}]` 数组
2. 设置 `globalThis._wsBatchMode = true`（抑制后端单条通知）
3. 将队列存入 `vscode.setState({_batchQueue, _batchIndex, _batchTotal, _batchResults})`
4. 逐个发送 `loginSave` 消息
5. 每个账号登录后，后端调 `refresh()` → 发 `accountsChanged` → 前端动态加卡片
6. 记录每个账号的成功/失败到 `_batchResults`
7. 10s 超时未响应 → 记为失败，继续下一个
8. 全部完成后显示汇总：`批量导入完成：8/11 成功，3 失败（a@x.com、b@x.com）`

#### 批量导入恢复（跨 webview 重建）：
- `checkBatchResume()` — webview 初始化时检查 `vscode.getState()` 中是否有未完成的队列
- 如有 → 自动恢复批量模式，1.5s 后继续

### 7.5 自动切号

- **切换开关** — 动态注入到 UI
- **阈值设置** — 剩余配额低于 N% 时切换（默认 15%）
- **评分算法** — `min(日配额, 周配额)`
- **切换策略** — 找所有账号中评分最高的（且高于阈值），自动切换
- **冷却** — 切换后 30s 内不再触发
- **检查频率** — 每次收到 usage 消息时检查当前账号
- **日志** — 显示在可折叠的 `<pre>` 中，最多 20 条
- **持久化** — `autoSwitchEnabled`、`autoSwitchThreshold` 存入 `vscode.setState()`

### 7.6 配额缓存

- **缓存位置**: `vscode.setState()._usageCache`
- **缓存结构**: `{ [email]: { snapshot, error, ts } }`
- **过期时间**: 5 分钟
- **恢复**: webview 重建时从 state 恢复，立即填充卡片数据
- **作用**: 防止 webview 重建时配额数据丢失、闪烁

### 7.7 定时自动刷新

| 类型 | 默认间隔 | 作用 |
|------|---------|------|
| 全部账号刷新 | 10 分钟 | 遍历所有卡片发 `fetchUsageFor` |
| 当前账号刷新 | 1 分钟 | 只刷新当前激活账号 |

设置存入 `vscode.setState()` 持久化。

### 7.8 Smart Refresh（避免全量刷新）

后端 `refresh()` 方法被补丁拦截：
- **首次调用** → 正常渲染 HTML（完整页面）
- **后续调用** → 发 `accountsChanged` 消息到 webview

前端 `handleAccountsChanged(accounts, lastEmail)`：
1. 移除已删除账号的卡片（带动画）
2. 为新账号创建卡片（`buildSingleGridCard`）
3. 更新激活状态
4. 更新账号计数
5. 触发排序
6. 记录批量导入结果 + 继续队列

---

## 八、数据流总览

```
┌────────────────────────────┐
│        Webview (前端)       │
│                            │
│  loginSave ──────────────────────→ 后端 Rt()
│  switch ─────────────────────────→ 后端 _t() → q() 注入 session
│  delete ─────────────────────────→ 后端 Ct() → D() 删除账号
│  fetchUsageFor ──────────────────→ 后端 pushUsage() → 调 GetUserStatus API
│                            │
│  ←──────── usage           │ ← 后端返回 {email, snapshot}
│  ←──────── accountsChanged │ ← 后端 refresh() 触发
│                            │
│  [卡片视图] [配额条] [自动切号] │
│  [批量导入] [缓存] [定时刷新]  │
└────────────────────────────┘
```

---

## 九、UI 移除/修改项

从原版 Windsurf Zen 中移除以下 UI：

| 移除项 | 原因 |
|--------|------|
| 卡密激活区域（licenseKey, licenseActivate） | 不需要 |
| 购买链接（openPurchase） | 不需要 |
| ApiKey 手动输入 Tab | 不需要，只保留邮箱密码 |
| 视图切换按钮（列表/卡片切换） | 只保留卡片视图 |
| 标题 "Windsurf Zen" → "Windsurf 号池管理" | 品牌定制 |

---

## 十、完整文件结构（建议）

```
windsurf-zen/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts          # 扩展入口 (activate/deactivate)
│   ├── accountStore.ts       # 账号 CRUD（secrets 存储）
│   ├── loginService.ts       # 登录 API（Auth1 + Firebase 双路径）
│   ├── usageService.ts       # 配额查询（GetUserStatus + GetPlanStatus）
│   ├── sessionInjector.ts    # Session 注入到 Windsurf（补丁机制）
│   ├── sidebarProvider.ts    # WebviewViewProvider（生成 HTML + 消息路由）
│   └── types.ts              # 类型定义
├── resources/
│   ├── icon.svg
│   ├── icon.png
│   └── webview/
│       ├── main.js           # 前端逻辑
│       └── main.css          # 样式
└── out/                      # 编译输出
```

---

## 十一、关键注意事项

### 11.1 Firebase API Key
Firebase 认证使用的 API Key（公开的，用于 signInWithPassword）：
```
AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY
```

### 11.2 Session 注入是核心难点
- 需要找到并修补 Windsurf 的 `workbench.desktop.main.js`
- 目标：替换 `handleAuthToken` 方法，注入自定义 session
- 补丁需要适配 Windsurf 版本更新（代码变化时补丁可能失效）
- `applyPatch` 命令负责执行此补丁

### 11.3 Webview State 持久化
`vscode.setState()` / `vscode.getState()` 用于：
- 配额缓存（`_usageCache`）
- 批量导入队列（`_batchQueue`, `_batchIndex`, `_batchTotal`, `_batchResults`）
- 自动切号设置（`autoSwitchEnabled`, `autoSwitchThreshold`）
- 刷新间隔设置
- 视图模式（`isCardView`）

### 11.4 网络超时与重试
- 登录 API 超时建议 15s
- 配额查询超时建议 10s
- 批量导入单个账号超时 10s 后自动跳过

### 11.5 CSS 说明
现有 CSS 约 1584 行，34KB。包含：
- VS Code 主题变量适配（`var(--vscode-*)`)
- 卡片视图样式（`.grid-card`, `.grid-card-quotas`）
- 进度条样式（`.quota-bar`, `.quota-bar-fill`）
- 自动切号面板（`.auto-switch-card`, `.as-*`）
- 批量导入面板（`.batch-*`）
- 设置弹窗（`.settings-popup`）
- 动画（入场、淡出、旋转）
- 暗色/亮色主题适配

**建议**: 全新重写时直接搬运现有 `main.css`，或基于此重新设计。

---

## 十二、测试要点

1. **Auth1 登录** — 使用 Auth1 类型账号登录，验证获取 sessionToken
2. **Firebase 登录** — 使用 Firebase 类型账号登录，验证获取 apiKey
3. **配额显示** — 登录后卡片正确显示日/周配额、进度条、颜色
4. **会员期限** — 正确显示开始/结束日期、剩余天数、颜色
5. **账号切换** — 切换后 Windsurf 使用新 session，无需重启
6. **账号删除** — 删除后卡片消失，带动画
7. **批量导入** — 文本/JSON 格式均正确解析，汇总结果
8. **自动切号** — 日配额低于阈值时自动切到最优账号
9. **缓存持久化** — webview 重建后配额数据不丢失
10. **定时刷新** — 按设置的间隔自动拉取配额

---

## 附录 A：qe() 登录函数完整逻辑（伪代码）

```typescript
async function login(email: string, password: string): Promise<LoginResult> {
  if (!email || !password) return { ok: false, error: "请输入邮箱和密码。" };

  try {
    // 1. 检测认证方式
    const det = await post("https://windsurf.com/_devin-auth/connections",
      { product: "windsurf", email });
    let authMethod = "firebase";
    let hasPassword = null;
    if (det.status === 200) {
      const dd = JSON.parse(det.body);
      authMethod = (dd.auth_method?.method || "firebase").toLowerCase();
      hasPassword = dd.auth_method?.has_password;
    }

    if (authMethod === "auth1") {
      // Auth1 路径
      if (hasPassword === false) {
        return { ok: false, error: "该账号未开启密码登录（可能是 Google/SSO 账号），请先设置密码" };
      }
      const lr = await post("https://windsurf.com/_devin-auth/password/login",
        { email, password });
      if (lr.status === 401 || lr.status === 403) {
        return { ok: false, error: "邮箱或密码错误" };
      }
      if (lr.status !== 200) {
        return { ok: false, error: `Auth1登录失败:HTTP${lr.status}` };
      }
      const { token: auth1Token, user_id: userId } = JSON.parse(lr.body);
      if (!auth1Token) return { ok: false, error: "Auth1响应缺少token" };

      const pa = await post(
        "https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth",
        {},
        {
          Accept: "application/json",
          "Connect-Protocol-Version": "1",
          "X-Devin-Auth1-Token": auth1Token,
          "X-Devin-Account-Id": userId
        }
      );
      if (pa.status !== 200) {
        return { ok: false, error: `PostAuth失败:${pa.status}` };
      }
      const pd = JSON.parse(pa.body);
      const sessionToken = pd.sessionToken || pd.session_token;
      if (!sessionToken) return { ok: false, error: "PostAuth未返回sessionToken" };

      return {
        ok: true,
        value: {
          email,
          apiKey: sessionToken,
          apiServerUrl: "https://server.self-serve.windsurf.com",
          name: email.split("@")[0]
        }
      };

    } else {
      // Firebase 路径
      const fr = await post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY",
        { email, password, returnSecureToken: true, clientType: "CLIENT_TYPE_WEB" },
        { Accept: "*/*", Referer: "https://windsurf.com/" }
      );
      if (fr.status !== 200) {
        const errMsg = JSON.parse(fr.body)?.error?.message;
        const errMap: Record<string, string> = {
          EMAIL_NOT_FOUND: "邮箱不存在",
          INVALID_PASSWORD: "密码错误",
          INVALID_LOGIN_CREDENTIALS: "邮箱或密码错误",
          USER_DISABLED: "账号已被禁用",
          TOO_MANY_ATTEMPTS_TRY_LATER: "尝试过多请稍后再试"
        };
        return { ok: false, error: errMap[errMsg] || `Firebase登录失败:${errMsg || "HTTP" + fr.status}` };
      }
      const idToken = JSON.parse(fr.body).idToken;
      if (!idToken) return { ok: false, error: "Firebase响应缺少idToken" };

      const rr = await post(
        "https://register.windsurf.com/exa.api_server_pb.ApiServerService/RegisterUser",
        { firebase_id_token: idToken },
        { Accept: "application/json", "connect-protocol-version": "1" }
      );
      if (rr.status !== 200) return { ok: false, error: `RegisterUser失败:HTTP${rr.status}` };

      const rd = JSON.parse(rr.body);
      const apiKey = rd.api_key || rd.apiKey;
      if (!apiKey) return { ok: false, error: "RegisterUser响应缺少api_key" };

      return {
        ok: true,
        value: {
          email,
          apiKey,
          apiServerUrl: rd.api_server_url || rd.apiServerUrl || "https://server.codeium.com",
          name: rd.name || email.split("@")[0]
        }
      };
    }
  } catch (err) {
    return { ok: false, error: "登录出错:" + (err instanceof Error ? err.message : String(err)) };
  }
}
```

---

## 附录 B：Webview HTML 模板结构（后端 refresh 生成）

后端 `refresh()` 方法生成完整的 HTML，发送给 webview。模板需包含：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <!-- 标题 -->
  <h2 class="app-title">Windsurf 号池管理</h2>

  <!-- 账号列表区域（.list-card） -->
  <div class="card list-card">
    <div class="card-header">
      <span>我的账号</span>
      <span class="grid-count">${accounts.length} 个</span>
      <!-- 右侧按钮由 JS 注入 -->
    </div>

    <!-- 隐藏的列表视图（兼容老代码） -->
    <div class="account-list" style="display:none">
      ${accounts.map(acct => `
        <div class="account-item ${acct.email === lastEmail ? 'is-active' : ''}"
             data-email="${acct.email}">
          <div class="account-row" data-row-action="toggle">
            <span class="account-email">${acct.email}</span>
            <span class="account-server">${acct.apiServerUrl}</span>
            <button data-row-action="switch">切换</button>
            <button data-row-action="delete">删除</button>
          </div>
          <div class="account-expand" data-expand="${acct.email}" hidden>
            <!-- 配额详情（展开时加载） -->
          </div>
        </div>
      `).join('')}
    </div>

    <!-- 卡片网格容器（由 JS 的 initCardView 创建） -->
    <!-- <div id="accountGrid" class="account-grid"></div> -->
  </div>

  <!-- 登录面板 -->
  <div class="card">
    <div class="tab-bar">
      <button class="tab is-active" data-tab="email">邮箱密码</button>
    </div>
    <div class="tab-panel" data-panel="email">
      <label>邮箱</label>
      <input type="email" id="email" placeholder="your@email.com">
      <label>密码</label>
      <input type="password" id="loginPassword" placeholder="密码">
      <button class="primary" data-action="loginSave">登录并保存</button>
    </div>
  </div>

  <script src="${jsUri}"></script>
</body>
</html>
```

> **注意**: `main.js` 会在运行时动态注入卡片网格、自动切号面板、批量导入 UI 等组件。  
> 因此 HTML 模板只需提供基础骨架，JS 负责增强。

---

*文档完成。基于此文档，开发者可以从零实现一个功能完全等价的 VS Code 扩展。*
