# Devin 兼容性支持实施计划

> 基于调研报告 `devin-compatibility-report.md` 制定
> 版本：v1.0
> 目标：使 windsurf-pool 同时兼容 Devin（新版）和 Windsurf（旧版）

---

## 一、目标与范围

### 核心目标

- **Windsurf 旧版**：保持 100% 功能可用（零回归）
- **Devin 新版**：实现 100% 核心功能可用（实例启动、切号、模型切换、Cascade 探测、自动恢复、workbench 增强）

### 不在本次范围

- Devin 特有的 session token 认证路径（`handleDevinAuthToken`）— 保留现有 Codeium token 路径
- Devin Portal URL 企业部署功能
- 扩展 ID 从 `codeium.windsurf` 改为 `codeium.devin`

---

## 二、已完成（本轮调研 + 实施已落地）

| # | 文件/改动 | 状态 | 说明 |
|---|-----------|------|------|
| 1 | `resources/devin-better.js` | ✅ | 从 `windsurf-better.js` 生成，74 处 `"Windsurf"` → `"Devin"` 产品名替换，技术标识符保留 |
| 2 | `src/enhancementInjector.ts` | ✅ | `getScriptContent()` 使用 `getEnhancementScriptName()` 动态选择脚本 |
| 3 | `src/ideDetector.ts` | ✅ | 新建模块：`detectIdeFlavor()`、`getEnhancementScriptName()`、`getStateDbPath()`、`getIdeVersion()` 等 |
| 4 | `src/instanceManager.ts` | ✅ | exe 检测、userDataDir、注册表搜索、wmic/PowerShell 进程名全部适配 Devin |
| 5 | `src/sidebarProvider.ts` | ✅ | state.vscdb 路径改为 `getStateDbPath()` 动态获取 |
| 6 | `src/healthCheckPanel.ts` | ✅ | state.vscdb 路径、设备指纹搜索目录（加入 Devin）、提示文案全部适配 |
| 7 | `src/cascadeProbe.ts` | ✅ | findLsBinary 候选路径、extensions_dir、windsurf_version 全部动态获取 |
| 8 | `src/extension.ts` | ✅ | PowerShell 提权命令动态选择、增强提示文案动态 |
| 9 | `src/statusBar.ts` | ✅ | QuickPick placeholder 和 tooltip 文案动态 |
| 10 | `src/contextMonitor.ts` | ✅ | Language Server 未找到提示文案动态 |
| 11 | `src/elevatedFs.ts` | ✅ | 提权失败错误提示文案动态 |

**编译验证**：`npx tsc --skipLibCheck -p ./` — **零错误通过** ✅

---

## 三、待实施任务清单

### Phase 1：路径发现层适配（P0 — 阻塞级）

#### 任务 1.1：修改 `src/instanceManager.ts` — 可执行文件检测

**问题**：wmic / PowerShell / 注册表搜索 / 候选路径列表中只涉及 `Windsurf.exe`

**具体修改点**：
- `:430` — `wmic process where "name='Windsurf.exe'"` → 同时搜索 `Devin.exe`
- `:437-445` — `exeCandidates` 数组追加 Devin 路径
- `:459` — `reg query ... /f "Windsurf"` → 同时搜索 `"Devin"`
- `:472` — 硬编码拼接 `Windsurf.exe` → 使用 `getIdeExeName()`
- `:481` — `where Windsurf.exe` → `where` 多个候选
- `:58-65` — `getDefaultUserDataDir()` 只检测 `%APPDATA%\Windsurf`
- `:762` — 第二处 wmic 硬编码
- `:785` — PowerShell 进程名过滤

**代码变更**：
```typescript
import { detectIdeFlavor, getIdeExeName, getIdeProcessNames, getUserDataDirCandidates } from './ideDetector';

// 进程名检测
const processNames = getIdeProcessNames(); // ['Devin.exe', 'Windsurf.exe']

// userDataDir
const dirCandidates = getUserDataDirCandidates();
for (const { path, flavor } of dirCandidates) {
  if (fs.existsSync(path)) return path;
}

// exe 候选
const exeName = getIdeExeName(); // 'Devin.exe' | 'Windsurf.exe'
```

**验收标准**：
- [ ] Devin 运行时 `instanceManager.getDefaultUserDataDir()` 返回 `%APPDATA%\Devin`
- [ ] Windsurf 运行时仍返回 `%APPDATA%\Windsurf`
- [ ] `findWindsurfExe()` 在 Devin 安装路径下找到 `Devin.exe`
- [ ] `getRunningWindsurfProcesses()` 返回 Devin 进程列表

**风险**：低。纯路径/字符串替换，无逻辑变更。

---

#### 任务 1.2：修改 `src/sidebarProvider.ts` — state.vscdb 路径

**问题**：`:400` 和 `:442` 硬编码 `Windsurf/User/globalStorage/state.vscdb`

**具体修改**：
```typescript
import { getStateDbPath } from './ideDetector';

// 替换硬编码路径
const dbPath = getStateDbPath(); // 自动检测 Devin/Windsurf
```

**验收标准**：
- [ ] Devin 上能正确读取 `%APPDATA%\Devin\User\globalStorage\state.vscdb`
- [ ] Windsurf 上仍读取 `%APPDATA%\Windsurf\User\globalStorage\state.vscdb`
- [ ] 两个目录都存在时优先使用 Devin（新版优先策略）

---

#### 任务 1.3：修改 `src/healthCheckPanel.ts` — state.vscdb + 设备指纹

**问题**：
- `:575` — state.vscdb 路径硬编码
- `:863`、`:966` — `versions = ['Windsurf', 'Windsurf - Next']` 不搜索 Devin
- `:882` — 提示文案 `"Windsurf 窗口"`

**具体修改**：
```typescript
import { getStateDbPath } from './ideDetector';

// state.vscdb 路径
const dbPath = getStateDbPath();

// 设备指纹搜索目录
const searchDirs = ['Devin', 'Windsurf', 'Windsurf - Next'];

// 提示文案
const ideName = getIdeDisplayName(); // 'Devin' | 'Windsurf'
showInfoMessage(`请在 ${ideName} 窗口中使用...`);
```

**验收标准**：
- [ ] 设备指纹重置功能在 Devin 上可用
- [ ] 提示文案显示 "Devin 窗口" 而非 "Windsurf 窗口"

---

#### 任务 1.4：修改 `src/cascadeProbe.ts` — LS 路径 + extensions_dir + version

**问题**：
- `:334-344` — `findLsBinary()` 只搜索 Windsurf 安装路径
- `:426`、`:606` — `--extensions_dir` 硬编码 `.windsurf`
- `:427`、`:432`、`:607`、`:611` — `--windsurf_version` 硬编码 `'2.2.17'`

**具体修改**：
```typescript
import { getIdeVersion } from './ideDetector';

// findLsBinary 候选路径追加
const candidates = [
  // ... 现有 Windsurf 路径 ...
  path.join(localAppData, 'Programs', 'Devin', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
  'E:\\Program\\devin\\resources\\app\\extensions\\windsurf\\bin\\' + binName,
];

// extensions_dir
function getExtensionsDir(homeDir: string): string {
  const devinExt = path.join(homeDir, '.devin', 'extensions');
  const wsExt = path.join(homeDir, '.windsurf', 'extensions');
  if (fs.existsSync(devinExt) && fs.readdirSync(devinExt).length > 1) return devinExt;
  return wsExt;
}

// version
const version = getIdeVersion(); // 从 package.json 动态读取
```

**验收标准**：
- [ ] `findLsBinary()` 在 Devin 安装路径下找到 `language_server_windows_x64.exe`
- [ ] `--extensions_dir` 指向 `.devin/extensions`（当 Devin 运行时）
- [ ] `--windsurf_version` 参数值为 Devin 实际版本（如 `1.110.1`）
- [ ] Cascade 探测在 Devin 上成功返回 gRPC 响应

---

### Phase 2：跨平台路径适配（P1 — 非阻塞）

#### 任务 2.1：修改 `src/instanceManager.ts` — macOS/Linux 路径

**问题**：macOS/Linux 候选路径只包含 Windsurf

**具体修改**：
```typescript
// macOS
'/Applications/Devin.app/Contents/MacOS/Electron',
path.join(home, 'Applications', 'Devin.app', 'Contents', 'MacOS', 'Electron'),

// Linux
'/usr/bin/devin',
'/usr/local/bin/devin',
'/opt/devin/devin',
```

**验收标准**：
- [ ] macOS 上能找到 Devin.app
- [ ] Linux 上能找到 devin 可执行文件

---

### Phase 3：集成测试与发布

#### 任务 3.1：TypeScript 编译验证

```bash
npx tsc --skipLibCheck -p ./
```

**验收标准**：
- [ ] 零编译错误
- [ ] 零新引入的编译警告

---

#### 任务 3.2：双环境功能测试

| 测试项 | Windsurf 旧版 | Devin 新版 |
|--------|--------------|-----------|
| 扩展启动 | ✅ | ✅ |
| workbench.html 注入 | ✅ windsurf-better.js | ✅ devin-better.js |
| 实例启动 | ✅ | ✅ |
| 模型列表读取 | ✅ | ✅ |
| 切号（session 注入） | ✅ | ✅ |
| Cascade 探测 | ✅ | ✅ |
| 自动恢复（错误检测+重试） | ✅ | ✅ |
| ACP 恢复 | ✅ | ✅ |
| 设备指纹重置 | ✅ | ✅ |
| 设置面板 | ✅ | ✅ |

**验收标准**：
- [ ] 所有 P0 功能在 Devin 上可用
- [ ] 所有 P0 功能在 Windsurf 上无回归

---

#### 任务 3.3：版本发布

```bash
# 1. 版本号 +1
# 2. 更新 README/CHANGELOG
# 3. 编译
npx tsc --skipLibCheck -p ./
# 4. 打包
npx vsce package --no-dependencies
```

**验收标准**：
- [ ] VSIX 文件生成成功
- [ ] 解包验证包含 `resources/devin-better.js`
- [ ] 解包验证 `out/ideDetector.js` 存在

---

## 四、实施顺序

```
Phase 1（P0 阻塞级）
  ├── 任务 1.1: instanceManager.ts
  ├── 任务 1.2: sidebarProvider.ts
  ├── 任务 1.3: healthCheckPanel.ts
  └── 任务 1.4: cascadeProbe.ts
        ↓
Phase 2（P1 跨平台）
  └── 任务 2.1: instanceManager.ts macOS/Linux
        ↓
Phase 3（测试与发布）
  ├── 任务 3.1: TypeScript 编译
  ├── 任务 3.2: 双环境功能测试
  └── 任务 3.3: 版本发布
```

---

## 五、风险管理

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Devin 运行时 `process.execPath` 不含 "devin" | 低 | 高 | fallback：检查 `vscode.env.appName` 或 `%APPDATA%` 目录存在性 |
| 两个数据目录同时存在导致状态不一致 | 高 | 中 | 统一优先 Devin 目录策略；文档说明用户不应同时使用两版 |
| Devin 未来版本删除 `handleCodeiumAuthToken` | 中 | 高 | 监控 Devin 更新日志；预留切换 `handleDevinAuthToken` 的接口 |
| `devin-better.js` 与 `windsurf-better.js` 不同步 | 高 | 中 | 修改 `windsurf-better.js` 后必须重新生成 `devin-better.js`；建议在 CI 中加入生成脚本 |

---

## 六、devin-better.js 维护规范

`devin-better.js` 是**生成文件**，不应直接修改。

### 重新生成流程

```bash
# 1. 修改 windsurf-better.js
# 2. 运行生成脚本（待补充到 package.json scripts）
node scripts/generate-devin-better.js
# 3. 验证生成结果
node scripts/verify-devin-better.js
```

### 生成规则

- 替换 `"Windsurf"` → `"Devin"`（产品名，大写 W）
- **保留** `"windsurf"`（技术标识符，小写 w）：`windsurf.login`、`windsurf.com`、`codeium.windsurf` 等
- 更新文件头版本号：`Windsurf Better` → `Devin Better`
- 更新 `LOG_PREFIX`：`[WS-Better]` → `[Devin-Better]`

---

## 七、附录

### A. ideDetector.ts 接口定义

```typescript
// src/ideDetector.ts
export function detectIdeFlavor(): 'devin' | 'windsurf';
export function getIdeDisplayName(flavor?: 'devin' | 'windsurf'): string;
export function getIdeExeName(flavor?: 'devin' | 'windsurf'): string;
export function getIdeProcessNames(): string[];
export function getUserDataDirCandidates(): UserDataDirCandidate[];
export function getStateDbPath(): string;
export function getEnhancementScriptName(): string;
export function getIdeVersion(): string;
```

### B. 关键文件状态速查

| 文件 | Devin 兼容状态 | 修改方式 |
|------|---------------|----------|
| `sessionInjector.ts` | ✅ 自动兼容 | 无需修改 |
| `enhancementInjector.ts` | ✅ 已完成 | 动态选择脚本 |
| `instanceManager.ts` | ❌ 需修改 | 复用 ideDetector |
| `sidebarProvider.ts` | ❌ 需修改 | 复用 getStateDbPath |
| `healthCheckPanel.ts` | ❌ 需修改 | 复用 ideDetector |
| `cascadeProbe.ts` | ❌ 需修改 | 复用 ideDetector |
| `acpRecovery.ts` | ✅ 已适配 | 无需修改 |
| `rulesInjector.ts` | ✅ 自动兼容 | 无需修改 |
| `checksumFixer.ts` | ✅ 自动兼容 | 无需修改 |
