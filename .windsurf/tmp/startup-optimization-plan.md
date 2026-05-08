# GenStudio 渲染进程启动优化方案

## 当前启动架构分析

### 启动时间线（当前）

```
[0ms]   main.tsx 开始加载
[~50ms] 同步 import 布局组件: Sidebar, TitleBar, StatusBar, AssetLibrarySidePanel...
[~50ms] React.lazy 声明 20+ 页面组件（不阻塞，只注册 chunk）
[~80ms] 同步 import Store 模块: uiStore, providerStore, publishStore, videoDownloadStore, workspaceStore
[~80ms] 同步 import: editorSettingsStore, editorStoreV2, ProjectService （编辑器相关）

[~100ms] ★ Promise.all 并行初始化 4 个 Store:
  ├── initializeUIStore()             → IPC: storage:getAll('ui')
  ├── initializeProviderStore()       → IPC: storage:getAll('providers') × 3
  ├── initializePublishStore()        → IPC: storage:getAll('publish') × 2
  └── preloadVideoDownloads()         → IPC: video-download:get-tasks × 2 (重复!)
[等 4 个都完成]

[~200ms] await initializeWorkspaceStore()  → IPC: storage:getAll('workspace')
[~250ms] React 开始渲染 AppContent

[渲染阶段]:
  ├── <GlobalLogic> 挂载 → 立即触发:
  │   ├── useCapabilityInitialization() → 5 个注册 hook 同时运行
  │   │   ├── useBuiltinCapabilityRegistration()     → IPC × N
  │   │   ├── useAPICapabilityRegistration()         → IPC × N（每个 provider 都注册）
  │   │   ├── useLocalCapabilityRegistration()       → IPC × N
  │   │   ├── useAutomationCapabilityRegistration()  → IPC × N
  │   │   └── useV3ScriptCapabilityRegistration()    → IPC: get-scripts
  │   └── useASRCapabilityRegistration()             → IPC × N（11 个 ASR Provider！）
  │
  ├── <Sidebar> 渲染（同步 import，包含所有 icon，重型）
  ├── <TitleBar> 渲染
  ├── <StatusBar> 渲染
  ├── <ToolboxStudio> keep-alive 挂载（即使不在工具箱页面也会挂载！）
  │   └── 触发 openTools 中所有已打开工具的组件渲染
  └── 编辑器启动逻辑 initEditor() → 加载上次项目 → setProject

[后续触发]:
  ├── TTS 音色列表获取 × 2（重复！）
  ├── GPU 检测（vocal-separator-engine-detection）
  ├── yt-dlp 版本检查
  ├── Worker 池预热
  └── WaveformHandler × 7（每个 clip 一次）
```

### 发现的 7 个核心问题

| #   | 问题                                           | 影响                                                                    | 严重度 |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| 1   | **`publishStore` 首屏不需要**                  | 启动时就查询 DB，用户可能根本不用发布功能                               | ⭐⭐⭐    |
| 2   | **`preloadVideoDownloads` 首屏不需要**         | 查询下载任务+IndexedDB，且 `App.tsx:235` 还会再查一次 → **重复查询**    | ⭐⭐⭐    |
| 3   | **6 个 Capability 注册 hook 启动时全跑**       | 每个 hook 都发 IPC，ASR 有 11 个 Provider，总计 ~30+ IPC 调用           | ⭐⭐⭐⭐   |
| 4   | **ToolboxStudio keep-alive 始终挂载**          | 即使用户不在工具箱，组件也挂载，且渲染所有 `openTools` 中的工具         | ⭐⭐     |
| 5   | **TTS 音色列表启动时获取 × 2**                 | 主进程 log 显示连续两次 `获取音色列表 providerId: qwen3-tts`            | ⭐⭐     |
| 6   | **editorStoreV2 + ProjectService 同步 import** | 即使不打开编辑器，也会在首屏 import 这些重模块                          | ⭐⭐     |
| 7   | **Worker 池立即预热**                          | `VideoDecoder Worker 池预热` 在首屏就执行，但播放操作可能很久之后才发生 | ⭐      |

---

## 优化方案（分 3 个优先级）

### P0: 高收益低风险（可立即实施）

#### 1. `publishStore` 延迟初始化
**当前**: 启动时 `Promise.all` 中同步初始化
**优化**: 移到 `PublishManager` 组件内 `useEffect` 中初始化  
**收益**: 减少 2 次启动时 IPC 调用 + DB 查询

```ts
// App.tsx - 删除 initializePublishStore 从 Promise.all
Promise.all([
  initializeUIStore(),
  initializeProviderStore(),
  // initializePublishStore(),   ← 移除
  // preloadVideoDownloads(),    ← 移除
]).then(async () => {
  await initializeWorkspaceStore();
  ...
});

// PublishManager 组件内
useEffect(() => { initializePublishStore(); }, []);
```

#### 2. `preloadVideoDownloads` 延迟 + 去重
**当前**: 启动时预加载 + `App.tsx:235` 又调用 `video-download:get-tasks`
**优化**: 移到视频下载页面内初始化，或至少延迟到 `requestIdleCallback`
**收益**: 减少 2 次启动时 IPC + IndexedDB 查询，消除重复调用

#### 3. TTS 音色列表去重
**当前**: 启动时连续 2 次 `获取音色列表 { providerId: "qwen3-tts" }`
**优化**: 加 debounce/dedup 机制
**收益**: 减少 1 次 IPC + TTS 模块加载

### P1: 中等收益（需要小重构）

#### 4. Capability 注册延迟化
**当前**: `<GlobalLogic>` 在首屏渲染时一次性注册 6 类能力
**优化**: 按需注册
- `useBuiltinCapabilityRegistration` → 保留（轻量）
- `useAPICapabilityRegistration` → 保留（依赖 provider list，已有）
- `useASRCapabilityRegistration` → **延迟到 ASR 工具页面打开时**
- `useV3ScriptCapabilityRegistration` → **延迟到自动化页面打开时**
- `useLocalCapabilityRegistration` → 保留
- `useAutomationCapabilityRegistration` → **延迟到自动化页面打开时**

**收益**: 减少 ~15+ 次启动时 IPC 调用

```ts
// GlobalLogic.tsx 精简版
export const GlobalLogic: React.FC = () => {
    useCapabilityInitialization();
    // useASRCapabilityRegistration(); ← 移到 SpeechToText 组件
    ...
};
```

#### 5. ToolboxStudio 条件挂载
**当前**: `<ToolboxStudio>` 始终挂载（keep-alive），且渲染所有 openTools
**优化**: 首次进入工具箱后才挂载，之前用 `null`

```tsx
// App.tsx
const [toolboxVisited, setToolboxVisited] = useState(false);
useEffect(() => {
  if (currentMode === 'toolbox') setToolboxVisited(true);
}, [currentMode]);

// 只有访问过工具箱后才挂载 keep-alive
{toolboxVisited && (
  <div style={{ display: currentMode === 'toolbox' ? 'block' : 'none' }}>
    <ToolboxStudio />
  </div>
)}
```

**收益**: 用户不进工具箱 → 0 工具组件挂载

#### 6. 编辑器模块延迟 import  
**当前**: `editorSettingsStore`、`editorStoreV2`、`ProjectService` 在 `App.tsx` 顶层同步 import
**优化**: 移到 `initEditor` 函数内 dynamic import

```ts
// 当前（阻塞首屏）
import { useEditorSettingsStore } from '...editorSettingsStore';
import { ProjectService } from '...ProjectService';
import { useEditorStoreV2 } from '...editorStoreV2';

// 优化后（按需加载）
const initEditor = async () => {
  const { useEditorSettingsStore } = await import('...editorSettingsStore');
  const { ProjectService } = await import('...ProjectService');
  const { useEditorStoreV2 } = await import('...editorStoreV2');
  ...
};
```

**收益**: 首屏 bundle 减小 ~50-100KB

### P2: 锦上添花

#### 7. Worker 池懒预热
延迟到首次播放操作时才预热，或用 `requestIdleCallback`

#### 8. GPU 检测缓存
`vocal-separator-engine-detection` 的 GPU 结果存 KV Store，启动时直接读缓存

#### 9. 合并初始化 IPC
将 `initializeUIStore` + `initializeProviderStore` + `initializeWorkspaceStore` 合并为一个 `app:bootstrap` IPC，一次返回所有初始数据

---

## 预估收益

| 指标                 | 当前           | 优化后         |
| -------------------- | -------------- | -------------- |
| 启动时 IPC 调用数    | ~40+           | ~12            |
| Promise.all 并行任务 | 4 → await 1    | 2 → await 1    |
| 首屏 JS bundle 大小  | 包含编辑器模块 | 减少 ~50-100KB |
| 能力注册 IPC         | ~30 次         | ~10 次         |
| 首屏可交互时间       | ~2-3s          | ~1-1.5s        |

## 实施建议

1. **先做 P0**（3 个改动），验证效果
2. **再做 P1 的 4、5**（Capability 延迟 + ToolboxStudio 条件挂载）
3. P2 视效果决定是否实施
