# Devin（原 Windsurf）兼容性调研报告

> 调研日期：2026-06-04/06  
> 调研范围：`E:\Program\Windsurf`（旧版 v2.3.15）vs `E:\Program\devin`（新版 v1.110.1）  
> 目标：确认 windsurf-pool 在 Devin 上需要哪些修改才能兼容，同时保持旧版 Windsurf 可用

---

## 一、Devin 安装结构对比

| 项目 | Windsurf（旧） | Devin（新） | 兼容性 |
|------|---------------|-------------|--------|
| 安装目录 | `E:\Program\Windsurf` | `E:\Program\devin` | ❌ 不同 |
| 主进程 exe | `Windsurf.exe` | `Devin.exe` | ❌ 不同 |
| CLI 脚本 | `bin/windsurf-desktop.cmd` | `bin/devin-desktop.cmd` | ❌ 不同 |
| LS 二进制 | `extensions/windsurf/bin/language_server_windows_x64.exe` | **同路径同名** | ✅ |
| ACP 代理 | `extensions/windsurf/devin/bin/devin.exe` | **同路径同名** | ✅ |
| extension.js | `extensions/windsurf/dist/extension.js` | **同路径同名** | ✅ |
| workbench.html | `out/vs/code/electron-browser/workbench/workbench.html` | **同路径同名** | ✅ |
| product.json | `resources/app/product.json` | **同路径** | ✅ |
| 扩展目录名 | `extensions/windsurf/` | **同名** | ✅ |
| 扩展 ID | `codeium.windsurf` | **未改名** | ✅ |

### product.json 关键字段

```
Devin:  nameShort=Devin, nameLong=Devin, applicationName=devin-desktop
        dataFolderName=.devin, oldDataFolderName=.windsurf
        urlProtocol=devin, oldUrlProtocol=windsurf
        win32DirName=Devin

Windsurf: nameShort=Windsurf, nameLong=Windsurf, applicationName=windsurf-desktop
          dataFolderName=.windsurf
          urlProtocol=windsurf
          win32DirName=Windsurf
```

**关键发现**：Devin 的 `product.json` 保留了 `oldDataFolderName=.windsurf` / `oldNameShort=Windsurf` / `oldUrlProtocol=windsurf`，官方做了向后兼容设计。

---

## 二、数据目录迁移状态

| 目录 | 存在 | 说明 |
|------|------|------|
| `%APPDATA%\Devin` | ✅ | 新数据目录，已从 Windsurf 迁移 |
| `%APPDATA%\Windsurf` | ✅ | 旧数据目录仍存在 |
| `%USERPROFILE%\.devin\extensions` | ✅ | 新扩展目录（目前几乎为空） |
| `%USERPROFILE%\.windsurf\extensions` | ✅ | 旧扩展目录（含已安装扩展） |
| `%APPDATA%\Devin\User\globalStorage\state.vscdb` | ✅ | 新 DB |
| `%APPDATA%\Windsurf\User\globalStorage\state.vscdb` | ✅ | 旧 DB |
| `%APPDATA%\Devin\.devin-migration-complete` | ✅ | 迁移标记文件 |
| `%USERPROFILE%\.windsurfrules` | ✅ | Devin 仍读取此文件 |
| `%USERPROFILE%\.devinrules` | ❌ | 不存在，Devin 仍用 .windsurfrules |

### 迁移标记内容

```json
{
  "migratedAt": "2026-06-02T22:44:23.145Z",
  "skippedExistingDevinData": true,
  "version": "1.110.1"
}
```

### State DB 兼容性（核心）

**✅ 关键发现**：Devin 的 `state.vscdb` 仍使用 **`codeium.windsurf`** 作为主键名，**未改名**！

两个 DB 共有的 key：
- `codeium.windsurf` — 含 `windsurf.state.lastSelectedCascadeModelUids` 等子字段
- `windsurfConfigurations` — 模型配置
- `windsurf.acp.*` — ACP 会话数据

**结论**：读写 `codeium.windsurf` key 的逻辑在 Devin 上**无需修改**，但 DB **路径**需要适配。

---

## 三、LS 启动参数兼容性

### Devin extension.js 中的 LS 启动逻辑

```javascript
// ide_name 仍返回 "windsurf"（不是 "devin"）
getWindsurfIdeName = function() {
  return l() ? "windsurf-insiders"
       : u() ? "windsurf-next"
       : d() ? "windsurf-eu"
       : h() ? "windsurf-fed"
       : D() ? "windsurf-secure"
       : (0,B.isDevelopment)() ? "windsurf-dev"
       : "windsurf"  // ← 默认仍是 "windsurf"
}

// --windsurf_version 参数名不变，值从 getWindsurfIdeVersion() 动态获取
o.push("--windsurf_version", J)

// WINDSURF_CSRF_TOKEN 环境变量名不变
WINDSURF_CSRF_TOKEN: A.csrfToken

// --ide_name 仍为 "windsurf"
o.push("--ide_name", getWindsurfIdeName())
```

**结论**：LS 启动参数 `--ide_name` / `--windsurf_version` / `WINDSURF_CSRF_TOKEN` **全部保持不变**，Devin 的 LS 与 Windsurf 的 LS 完全兼容。

### 当前运行中的 LS 实际参数（来自旧版 Windsurf）

```
--windsurf_version: 2.3.15
--extensions_dir: C:\Users\admin\.windsurf\extensions
--ide_name: windsurf
--extension_server_port: 35457
```

---

## 四、认证流程变更（🔴 最关键）

### 旧版 Windsurf 的认证命令注册

```javascript
// 旧版有 PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER 常量
s.commands.registerCommand(
  t.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER,
  async A => { try { return { session: await e.handleAuthToken(A), error: void 0 } } catch(A) { ... } }
)
```

### 新版 Devin 的认证命令注册

```javascript
// ❌ PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER 常量已删除（出现次数 = 0）
// ✅ 新增 PROVIDE_DEVIN_AUTH_CODE_TO_AUTH_PROVIDER 常量
s.commands.registerCommand(
  t.PROVIDE_DEVIN_AUTH_CODE_TO_AUTH_PROVIDER,
  async A => { try { return { session: await e.handleAuthToken({kind:"devin",devinCode:A,state:null}), error: void 0 } } catch(A) { ... } }
)

// ✅ LOGIN_WITH_AUTH_TOKEN 仍存在
s.commands.registerCommand(t.LOGIN_WITH_AUTH_TOKEN, () => { e.provideAuthManually() })
```

### handleAuthToken 方法仍存在且兼容

```javascript
// Devin 的 handleAuthToken 现在是双路分发器
async handleAuthToken(A) {
  if ("string" == typeof A)
    return (0,N.looksLikeCodeiumAuthToken)(A)
      ? await this.handleCodeiumAuthToken(A)    // ← Codeium 路径（旧 Windsurf 兼容）
      : await this.handleDevinAuthToken(A);      // ← Devin 路径（新增）
  switch(A.kind) {
    case "codeium": return await this.handleCodeiumAuthToken(A.accessToken);
    case "devin":   return await this.handleDevinAuthToken(A.devinCode);
  }
}
```

### authProviderId 与 state.vscdb 键名实测确认

**authProviderId**：Devin `extension.js` 中 `authProviderId` 仍返回 `"codeium.windsurf"`，注册给 VS Code 的认证提供程序显示名为 `"Devin Auth"`。内部 ID 未变。

**state.vscdb 键名**：Devin 的 `%APPDATA%\Devin\User\globalStorage\state.vscdb` 中：
- `codeium.windsurf` key **仍然存在**（与 Windsurf 相同）
- `windsurf.acp.session/*` 键名前缀也未变

**结论**：读写 `codeium.windsurf` key 的逻辑在 Devin 上**无需修改**，只需适配 DB **路径**。

### handleCodeiumAuthToken 仍调用 registerUser

```javascript
async handleCodeiumAuthToken(A) {
  const e = await (0,y.registerUser)(A);  // ← 仍走 registerUser！
  const {apiKey:t, name:i} = e;
  const n = (0,w.getApiServerUrl)(e.apiServerUrl);
  // ... 创建 session，调用 persistSessionAndRestart
}
```

### 对 sessionInjector.ts 的影响

**当前补丁注入方式**：
1. 在 `handleAuthToken` 方法后插入 `handleAuthTokenWithShit` 方法
2. 定位 `PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER` 命令注册，复制并改名为 `windsurf.provideAuthTokenToAuthProviderWithShit`

**验证结果**：经实际用 Devin `extension.js` 测试，**现有正则已兼容**！

```typescript
// 现有正则（sessionInjector.ts:88 和 :508）
const oriRe = /(\w)\.commands\.registerCommand\((\w)\.PROVIDE_(?:WINDSURF_)?AUTH_TOKEN_TO_AUTH_PROVIDER,async (\w)=>\{[^]*?await (\w)\.handleAuthToken\(\3\)/;
```

- **旧版 Windsurf**：匹配 `t.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER` ✅
- **新版 Devin**：匹配 `t.PROVIDE_WINDSURF_AUTH_TOKEN_TO_AUTH_PROVIDER` ✅（`(?:WINDSURF_)?` 命中）

Devin 的 `registerAuthHandlers` 中：
- `PROVIDE_WINDSURF_AUTH_TOKEN_TO_AUTH_PROVIDER` → `handleAuthToken(A)`（字符串入参）→ `handleCodeiumAuthToken` → `registerUser`
- `PROVIDE_DEVIN_AUTH_CODE_TO_AUTH_PROVIDER` → `handleAuthToken({kind:"devin",...})`（对象入参）→ `handleDevinAuthToken`

我们的补丁只需要复用第一条路径（字符串 token），**完全无需改动正则**。

**结论**：`sessionInjector.ts` **无需修改**，现有代码自动兼容新旧两版。

---

## 五、命令 ID 命名变更

### 旧版 Windsurf 命令前缀：`windsurf.`

```
windsurf.provideAuthTokenToAuthProviderWithShit  ← 我们的补丁
windsurf.exportCurrentSessionWithShit            ← 我们的补丁
windsurf.reloadAcpConnections
windsurf.openAcpLocalRegistry
windsurf.updateTerminalLastCommand
windsurf.setWorkspaceCascadeMap
windsurf.resetProductEducation
windsurf.setPortalUrl
windsurf.lifeguard.*
windsurf.onShellCommandCompletion
windsurf.onShellCommandStart
windsurf.onManagedTerminalExit
```

### 新版 Devin 命令前缀：`devin.`

```
devin.reloadAcpConnections          ← 改名了！
devin.openAcpLocalRegistry
devin.updateTerminalLastCommand
devin.setWorkspaceCascadeMap
devin.resetProductEducation
devin.setPortalUrl
devin.lifeguard.*
devin.onShellCommandCompletion
devin.onShellCommandStart
devin.onManagedTerminalExit
```

**注意**：`windsurf.login` / `windsurf.logout` 等命令不在 `registerCommand` 中注册（它们通过 VS Code 的 `authentication` API 注册），所以不受影响。

**影响**：我们的补丁注入的命令 `windsurf.provideAuthTokenToAuthProviderWithShit` 使用 `windsurf.` 前缀。在 Devin 上执行时，VS Code 的命令系统不关心前缀，**命令仍可正常调用**。但建议未来版本考虑根据 IDE 类型使用 `devin.` 前缀。

---

## 六、需要修改的代码文件清单

### 🔴 P0 — 必须修改（否则 Devin 上核心功能不可用）

#### 1. `src/instanceManager.ts` — 可执行文件检测 + userDataDir

**问题**：只搜索 `Windsurf.exe`，不搜索 `Devin.exe`；只检测 `%APPDATA%/Windsurf`，不检测 `%APPDATA%/Devin`

**实测验证**：
- Devin 当前运行进程名：`Devin.exe`（主进程）和 `devin.exe`（子进程如 gpu-process/crashpad-handler）
- Devin 安装路径：`E:\Program\devin\Devin.exe`
- Devin user-data-dir：`C:\Users\admin\AppData\Roaming\Devin`
- LocalAppData 安装：`%LOCALAPPDATA%\Programs\devin` 存在

**涉及行**：
- `:430` — wmic 进程名硬编码 `Windsurf.exe`
- `:437-445` — 候选路径只有 Windsurf
- `:459` — 注册表搜索只搜 "Windsurf"
- `:472` — 拼接 `Windsurf.exe`
- `:481` — `where Windsurf.exe`
- `:58-65` — getDefaultUserDataDir 只检测 Windsurf
- `:762` — wmic 进程名 `Windsurf.exe`
- `:785` — PowerShell 进程名 `Windsurf.exe`

**修改方案**：
```typescript
// 检测 IDE 进程名列表（Devin 优先，Windsurf 回退）
const IDE_PROCESS_NAMES = ['Devin.exe', 'Windsurf.exe'];

// userDataDir 候选列表
const candidates = [
  path.join(appDataDir, 'Devin'),         // 新增
  path.join(appDataDir, 'Windsurf'),
  path.join(appDataDir, 'Windsurf - Next'),
];

// 可执行文件候选路径
const exeCandidates = [
  path.join(localAppData, 'Programs', 'Devin', 'Devin.exe'),     // 新增
  path.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
  // ... 其他路径
  'E:\\Program\\devin\\Devin.exe',                               // 新增
  'E:\\Program\\Windsurf\\Windsurf.exe',
];
```

#### 2. `src/instanceManager.ts` — CLI 脚本适配

**实测差异**：
- Windsurf CLI: `bin\windsurf.cmd` → `"%~dp0..\Windsurf.exe"`
- Devin CLI: `bin\devin-desktop.cmd` → `"%~dp0..\Devin.exe"`

`instanceManager.ts` 通过 `exeDir` 推导 `cli.js` 路径（`resources\app\out\cli.js`），相对路径结构一致，**自动兼容**。唯一需要注意的是 `wmic` / PowerShell 进程名过滤需要同时匹配 `Devin.exe` 和 `Windsurf.exe`。

#### 3. `src/sidebarProvider.ts` — state.vscdb 路径硬编码

**问题**：`path.join(process.env.APPDATA || '', 'Windsurf/User/globalStorage/state.vscdb')` 硬编码 Windsurf

**涉及行**：`:400` 和 `:442`

**修改方案**：动态检测 DB 路径
```typescript
function getStateDbPath(): string {
  const appData = process.env.APPDATA || '';
  // Devin 优先（如果存在），回退 Windsurf
  const candidates = [
    path.join(appData, 'Devin', 'User', 'globalStorage', 'state.vscdb'),
    path.join(appData, 'Windsurf', 'User', 'globalStorage', 'state.vscdb'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1]; // 默认回退
}
```

#### 4. `src/cascadeProbe.ts` — findLsBinary() 路径搜索

**问题**：只搜索 Windsurf 安装路径下的 LS 二进制

**涉及行**：`:334-344` — Windows 候选路径

**修改方案**：新增 Devin 安装路径
```typescript
// Windows 候选路径
candidates.push(
  path.join(execDir, 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
);
const localAppData = process.env.LOCALAPPDATA || '';
if (localAppData) {
  candidates.push(
    path.join(localAppData, 'Programs', 'Devin', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),  // 新增
    path.join(localAppData, 'Programs', 'Windsurf', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
    path.join(localAppData, 'Programs', 'Windsurf - Next', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
  );
}
// 自定义安装路径
candidates.push(
  'E:\\Program\\devin\\resources\\app\\extensions\\windsurf\\bin\\' + binName,   // 新增
  'E:\\Program\\Windsurf\\resources\\app\\extensions\\windsurf\\bin\\' + binName,
);
```

#### 5. `src/cascadeProbe.ts` — `--extensions_dir` 硬编码

**问题**：硬编码 `path.join(homeDir, '.windsurf', 'extensions')`

**涉及行**：`:426` 和 `:606`

**修改方案**：动态检测
```typescript
function getExtensionsDir(homeDir: string): string {
  const devinExt = path.join(homeDir, '.devin', 'extensions');
  const windsurfExt = path.join(homeDir, '.windsurf', 'extensions');
  // 优先使用存在的目录，都不存在则默认 .windsurf
  if (fs.existsSync(devinExt) && fs.readdirSync(devinExt).length > 1) return devinExt;
  if (fs.existsSync(windsurfExt)) return windsurfExt;
  return windsurfExt;
}
```

#### 6. `src/cascadeProbe.ts` — `--windsurf_version` 硬编码

**问题**：硬编码 `'2.2.17'`，Devin 版本号不同

**涉及行**：`:427`、`:432`、`:607`、`:611`

**修改方案**：从 product.json 动态读取版本号
```typescript
function getIdeVersion(): string {
  try {
    const execDir = path.dirname(process.execPath);
    const productJsonPath = path.join(execDir, 'resources', 'app', 'product.json');
    if (fs.existsSync(productJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
      // package.json 的 version 字段是 IDE 版本
      const pkgPath = path.join(execDir, 'resources', 'app', 'package.json');
      if (fs.existsSync(pkgPath)) {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '2.2.17';
      }
    }
  } catch {}
  return '2.2.17'; // 回退
}
```

#### ✅ `src/sessionInjector.ts` — 已验证自动兼容

**验证结果**：用 Devin `extension.js` 实测，现有正则 `(?:WINDSURF_)?` 已成功匹配 `PROVIDE_WINDSURF_AUTH_TOKEN_TO_AUTH_PROVIDER`。

- `sessionInjector.ts:88`：`oriRe` 匹配成功
- `sessionInjector.ts:508`：`cmdRe` 匹配成功

**无需修改**。

### 🟡 P1 — 应该修改（功能降级但不致命）

#### 7. `src/instanceManager.ts` — macOS/Linux 路径候选

**问题**：只搜 Windsurf.app / windsurf 路径

**修改方案**：新增 Devin.app / devin 路径
```typescript
// macOS
const candidates = [
  '/Applications/Devin.app/Contents/MacOS/Electron',      // 新增
  '/Applications/Windsurf.app/Contents/MacOS/Electron',
  path.join(home, 'Applications', 'Devin.app', ...),      // 新增
  path.join(home, 'Applications', 'Windsurf.app', ...),
];
// Linux
const candidates = [
  '/usr/bin/devin',          // 新增
  '/usr/bin/windsurf',
  '/usr/local/bin/devin',    // 新增
  '/usr/local/bin/windsurf',
  '/opt/devin/devin',        // 新增
  '/opt/windsurf/windsurf',
];
```

#### 8. `src/instanceManager.ts` — 注册表搜索

**问题**：`reg query ... /f "Windsurf"` 不搜索 "Devin"

**修改方案**：搜索两个关键词
```typescript
const searchTerms = ['Devin', 'Windsurf'];
for (const term of searchTerms) {
  const regOut = await runShellAsync(`reg query "${regBase}" /s /f "${term}" /d 2>nul`, 5000);
  // ...
  const exe = path.join(installDir, term === 'Devin' ? 'Devin.exe' : 'Windsurf.exe');
}
```

#### 9. `src/healthCheckPanel.ts` — state.vscdb 路径 + 设备指纹重置

**问题**：
- `:575` — `path.join(process.env.APPDATA || '', 'Windsurf/User/globalStorage/state.vscdb')` 硬编码
- `:863`、`:966` — `versions = ['Windsurf', 'Windsurf - Next']` 不搜索 Devin
- `:882` — 提示文案 `"Windsurf 窗口"` 需要适配

**修改方案**：复用 `getStateDbPath()` 统一函数，设备指纹搜索增加 `Devin` 目录。

#### 10. `src/enhancementInjector.ts` + `resources/devin-better.js` — 增强脚本适配

**问题**：`windsurf-better.js` 中大量 UI 文本硬编码 `"Windsurf"`，Devin  rebranding 后这些文本已改为 `"Devin"`，导致：
- 汉化翻译规则失效（如 `'Windsurf Tab'` → 不再匹配 Devin 的 `'Devin Tab'`）
- 错误检测正则可能漏报（如 `'Windsurf 官方配额耗尽'` 文案变化）
- 日志/提示文本不统一

**实测验证**：
- Devin 的 `workbench.html` 中**没有** `ws-better` 注入标记（ windsurf-pool 扩展未安装在 Devin 上）
- 即使安装后，原 `windsurf-better.js` 的文本匹配也会失效

**已实施的修改**：

1. **创建 `resources/devin-better.js`** — 从 `windsurf-better.js` 生成，替换所有 `"Windsurf"` → `"Devin"`（保留 `"windsurf"` 技术标识符如命令前缀、URL 等）

2. **修改 `src/enhancementInjector.ts`** — `getScriptContent()` 使用 `getEnhancementScriptName()` 动态选择：
```typescript
const scriptName = getEnhancementScriptName(); // 'devin-better.js' | 'windsurf-better.js'
const scriptPath = path.join(ext.extensionPath, 'resources', scriptName);
```

3. **创建 `src/ideDetector.ts`** — 统一检测 IDE 类型：
```typescript
export function detectIdeFlavor(): 'devin' | 'windsurf' {
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes('devin')) return 'devin';
  return 'windsurf';
}
export function getEnhancementScriptName(): string {
  return detectIdeFlavor() === 'devin' ? 'devin-better.js' : 'windsurf-better.js';
}
```

**影响范围**：`devin-better.js` 中 74 处 `"Windsurf"` 产品名引用全部替换为 `"Devin"`，技术标识符（`windsurf.login`、`windsurf.com`、`codeium.windsurf` 等）保持不变。

### 🟢 P2 — 暂不需修改

| 文件/功能 | 原因 |
|-----------|------|
| `sessionInjector.ts` — 切号补丁注入 | 正则 `(?:WINDSURF_)?` 已实测兼容 Devin `PROVIDE_WINDSURF_AUTH_TOKEN_TO_AUTH_PROVIDER` ✅ |
| `enhancementInjector.ts` — workbench.html 注入 | 路径动态兼容，**但 windsurf-better.js 中的 "Windsurf" UI 文本在 Devin 上会失效** ✅ |
| `windsurf-better.js` — 汉化/恢复脚本 | 已创建 `devin-better.js`（Windsurf → Devin 文本替换），enhancementInjector.ts 已改为动态选择脚本 ✅ |
| `checksumFixer.ts` — product.json checksum | Devin 的 checksum 格式与 Windsurf 相同（`vs/code/electron-browser/workbench/workbench.html` 等 key 一致）✅ |
| `acpRecovery.ts` — ACP 代理清理 | 已适配 `devin.exe` ✅ |
| `rulesInjector.ts` — .windsurfrules | Devin workbench 仍读取 `.windsurfrules`（workbench.desktop.main.js 中出现 3 次）✅ |
| `windsurfOAuthService.ts` — OAuth URL | `windsurf.com` / `server.codeium.com` 不变 ✅ |
| `bridgeServer.ts` — 端口/token 机制 | 不变 ✅ |
| `utils.ts` — `.windsurf-pool` 目录 | 这是我们自己的目录，与 IDE 无关 ✅ |
| `contextMonitor.ts` — LS gRPC 通信 | 端口/CSRF/协议不变 ✅ |
| `usageService.ts` — 云端 API | URL 不变 ✅ |
| `loginService.ts` — 登录流程 | 走 `handleAuthToken` → `handleCodeiumAuthToken` → `registerUser`，不变 ✅ |
| `extension.ts` — 文件写入权限检查 | `appRoot` 动态获取，自动兼容 ✅ |
| 扩展市场 URL | 两者都是 `marketplace.windsurf.com` ✅ |

---

## 七、推荐适配架构

### 核心工具函数（建议放在 `src/ideDetector.ts`）

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type IdeFlavor = 'devin' | 'windsurf';

/** 检测当前运行的 IDE 类型 */
export function detectIdeFlavor(): IdeFlavor {
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes('devin')) return 'devin';
  return 'windsurf';
}

/** 获取 IDE 显示名 */
export function getIdeDisplayName(flavor?: IdeFlavor): string {
  return (flavor || detectIdeFlavor()) === 'devin' ? 'Devin' : 'Windsurf';
}

/** 获取主进程 exe 名 */
export function getIdeExeName(flavor?: IdeFlavor): string {
  return (flavor || detectIdeFlavor()) === 'devin' ? 'Devin.exe' : 'Windsurf.exe';
}

/** 获取 userDataDir 候选列表（优先存在的） */
export function getUserDataDirCandidates(): string[] {
  const appData = process.env.APPDATA || '';
  return [
    path.join(appData, 'Devin'),
    path.join(appData, 'Windsurf'),
    path.join(appData, 'Windsurf - Next'),
  ];
}

/** 获取 state.vscdb 路径 */
export function getStateDbPath(): string {
  const appData = process.env.APPDATA || '';
  const candidates = [
    path.join(appData, 'Devin', 'User', 'globalStorage', 'state.vscdb'),
    path.join(appData, 'Windsurf', 'User', 'globalStorage', 'state.vscdb'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/** 获取 extensions_dir 参数值 */
export function getExtensionsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const devinExt = path.join(home, '.devin', 'extensions');
  const windsurfExt = path.join(home, '.windsurf', 'extensions');
  if (fs.existsSync(devinExt)) return devinExt;
  return windsurfExt;
}

/** 从 product.json / package.json 获取 IDE 版本号 */
export function getIdeVersion(): string {
  try {
    const execDir = path.dirname(process.execPath);
    const pkgPath = path.join(execDir, 'resources', 'app', 'package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '2.2.17';
    }
  } catch {}
  return '2.2.17';
}

/** 获取 IDE exe 候选路径列表（Windows） */
export function getIdeExeCandidatesWin(): string[] {
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';
  return [
    path.join(localAppData, 'Programs', 'Devin', 'Devin.exe'),
    path.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
    path.join(localAppData, 'Programs', 'Windsurf - Next', 'Windsurf.exe'),
    'C:\\Program Files\\Devin\\Devin.exe',
    'C:\\Program Files\\Windsurf\\Windsurf.exe',
    'D:\\Program\\devin\\Devin.exe',
    'D:\\Program\\Windsurf\\Windsurf.exe',
    'E:\\Program\\devin\\Devin.exe',
    'E:\\Program\\Windsurf\\Windsurf.exe',
    path.join(userProfile, 'scoop', 'apps', 'devin', 'current', 'Devin.exe'),
    path.join(userProfile, 'scoop', 'apps', 'windsurf', 'current', 'Windsurf.exe'),
  ].filter(Boolean);
}
```

---

## 八、实施优先级与风险

### 实施顺序建议

1. **创建 `ideDetector.ts`** — 集中管理所有 IDE 检测逻辑（`detectIdeFlavor()`、`getStateDbPath()`、`getIdeExeCandidatesWin()` 等）
2. **创建 `resources/devin-better.js` + 修改 `enhancementInjector.ts`** — Devin 专用增强脚本（已完成）
3. **修改 `instanceManager.ts`** — exe 检测 + userDataDir + 注册表搜索 + wmic/PowerShell 进程名
4. **修改 `sidebarProvider.ts`** — state.vscdb 路径（复用 `ideDetector.ts` 函数）
5. **修改 `healthCheckPanel.ts`** — state.vscdb 路径 + 设备指纹搜索目录
6. **修改 `cascadeProbe.ts`** — findLsBinary + extensions_dir + version 动态读取
7. **全面测试** — Devin + Windsurf 双环境验证

### 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Devin 未来版本改名 `codeium.windsurf` key | 中 | 高 | 监控 Devin 更新，预留 key 名检测逻辑 |
| Devin 未来版本改 `--windsurf_version` 为 `--devin_version` | 低 | 中 | 从运行中 LS 进程的命令行动态提取 |
| Devin 未来版本删除 `handleCodeiumAuthToken` | 中 | 高 | 需要改用 `handleDevinAuthToken`，需适配 Devin session token 格式 |
| Devin 未来版本改名 `.windsurfrules` 为 `.devinrules` | 低 | 低 | 监控 workbench 代码变化 |
| 两个数据目录（Devin + Windsurf）同时存在导致状态不同步 | 高 | 中 | 明确优先使用 Devin 目录，文档说明 |

---

## 九、Devin 新增功能（需关注）

### 1. Devin Session Token 认证

Devin 新增了 `handleDevinAuthToken` 路径：
```
exchangeDevinCode(devinCode) → sessionToken → fetchCurrentUserNameWithDevinToken(sessionToken) → session
```

Session token 有 `DEVIN_SESSION_TOKEN_PREFIX` 前缀标识。这意味着未来 Devin 可能全面转向 session token 认证，弃用 Codeium API key。**需关注此趋势**。

### 2. Devin Portal URL

新增 `devin.setPortalUrl` 命令，支持自定义 Portal URL（企业部署场景）。

### 3. Devin ACP Agent

`devin.exe acp` 进程是 Devin 的 ACP（Agent Communication Protocol）代理，支持 `summarizer` 等多种 agent 类型。`acpRecovery.ts` 已有处理。

---

## 十、总结

### 兼容性矩阵

| 功能 | Windsurf（旧） | Devin（新） | 需要修改 |
|------|---------------|-------------|----------|
| 实例启动 | ✅ | ❌ 找不到 exe | 是 |
| 切号（session 注入） | ✅ | ✅ 自动兼容 | **否** |
| 模型列表/切换 | ✅ | ❌ DB 路径错误 | 是 |
| Cascade 探测 | ✅ | ❌ LS 路径/参数错误 | 是 |
| 自动恢复 | ✅ | ✅ 依赖切号（已兼容） | 否 |
| workbench 增强 | ✅ | ⚠️ 需 devin-better.js 适配 | 是 |
| Rules 注入 | ✅ | ✅ 自动兼容 | 否 |
| Checksum 修复 | ✅ | ✅ 自动兼容 | 否 |
| ACP 恢复 | ✅ | ✅ 已适配 | 否 |
| Bridge 通信 | ✅ | ✅ 自动兼容 | 否 |
| OAuth 登录 | ✅ | ✅ 自动兼容 | 否 |

### 核心结论

1. **Devin 本质是 Windsurf 换皮** — 内部扩展 ID、LS 二进制、gRPC 协议、CSRF 机制、state.vscdb key 名全部保持不变
2. **需要修改的集中在"路径发现"层** — exe 名、数据目录、DB 路径、LS 路径
3. **sessionInjector 已确认自动兼容** — 现有正则 `(?:WINDSURF_)?` 已实测匹配 Devin 的 `PROVIDE_WINDSURF_AUTH_TOKEN_TO_AUTH_PROVIDER`，**无需修改**
4. **`windsurf-better.js` 需要 Devin 适配版本** — UI 文本从 "Windsurf" 改为 "Devin" 后，汉化/错误检测规则失效。已创建 `devin-better.js` + 修改 `enhancementInjector.ts` 动态选择脚本
5. **已创建 `ideDetector.ts`** — 统一检测 IDE 类型（`detectIdeFlavor()`），`instanceManager.ts`/`sidebarProvider.ts`/`cascadeProbe.ts` 等应复用此模块
6. **Devin 的 `handleAuthToken` 仍接受 Codeium token** — 我们的切号机制（绕过 registerUser）在 Devin 上仍可行
