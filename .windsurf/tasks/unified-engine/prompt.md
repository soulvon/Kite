# 统一 AI 引擎管理 — 长任务说明书

> **模式**: B（项目构建型）
> **规格文档**: `spec/66_统一AI引擎管理(UNIFIED_AI_ENGINE_MANAGEMENT).md`
> **项目路径**: `e:\project\GenStudio`

---

## §0 架构北极星

GenStudio 是一个 Electron 桌面应用（Vite + React + TypeScript）。

**三层架构**：环境管理（地基）→ AI 引擎（能力）→ 插件中心（扩展）

**本任务目标**：实现 AI 引擎层 — 统一管理 ASR/TTS/人声分离等引擎的配置、状态和选择。

**核心设计理念**：
- 所有在线引擎凭据存入 `UserDatas/Config/engines.json`
- 每个引擎通过 `EngineDescriptor` 声明自己的元信息和配置字段
- 前端通过 `EngineConfigModal` 动态渲染配置表单，不需要每个引擎单独写 UI
- 业务页面通过 `EngineSelector` 选择引擎，支持就地配置

**约束**：
- 界面中文，不使用英文，除非是技术术语
- 所有数据存储在 `UserDatas` 目录下
- Electron 主进程 ↔ 渲染进程通过 IPC 通信
- 调试地址: http://localhost:3100（仅限界面调试）
- dev 命令: `npm run dev:electron`

---

## §1 核心循环

每次迭代严格执行以下步骤：

1. 读取本文件（prompt.md）
2. 读取 PRD.md → 找到 "⚡ 当前阶段"
3. 读取 progress.txt → 确认已完成的工作
4. 读取 friction-log.md → 了解前人踩过的坑
5. 选择下一个 ❌ 任务
6. 按 PRD.md 中该任务的说明执行
7. 运行对抗性自我审查（§1.1）
8. 追加 progress.txt
9. 更新 PRD.md（❌ → ✅，更新 ⚡ 指针）
10. 更新 friction-log.md（如遇到新问题）

⚠️ **硬性规则：每次迭代最多完成 1 个任务！**

---

## §1.1 对抗性自我审查检查表

完成任务后，以审查者身份检查：

1. [ ] TypeScript 严格模式无错误（`npx tsc --noEmit` 针对修改的文件）
2. [ ] 无 `any` 类型（允许 `Record<string, unknown>`）
3. [ ] 导入路径正确（相对路径 vs alias）
4. [ ] 无未使用的导入
5. [ ] 错误处理完备（try-catch + 日志）
6. [ ] IPC 通道名与 spec 一致
7. [ ] 引擎 ID 与 spec 中定义一致
8. [ ] 配置数据只存 `UserDatas/Config/engines.json`
9. [ ] UI 文本使用中文
10. [ ] 文件位于 spec 定义的目录位置

如有违规 → 修复后重新检查，最多循环 3 次。

---

## §2 项目结构规范

```
# 后端（Electron 主进程）
electron/services/engineConfig/
├── types.ts                    # 类型定义
├── EngineConfigStore.ts        # 配置存储
└── engineDescriptors.ts        # 引擎描述符注册表

electron/services/asr/providers/
├── AliyunASRProvider.ts        # 阿里云百炼
├── VolcEngineASRProvider.ts    # 火山引擎
└── IflytekASRProvider.ts       # 科大讯飞

electron/ipc/handlers/
└── engineConfigHandlers.ts     # 引擎配置 IPC

# 前端（React 渲染进程）
src/components/
├── EngineConfigModal.tsx       # 通用配置弹窗
└── EngineSelector.tsx          # 通用引擎选择器

src/features/settings/sections/
└── AIEngineSection.tsx         # 设置页 AI 引擎 Tab
```

---

## §3 锚定接口

### EngineCategory / EngineDescriptor

```typescript
export type EngineCategory =
  | 'asr' | 'tts' | 'vocal-separator'
  | 'watermark-removal' | 'video-detection';

export type EngineRuntime = 'local' | 'cloud' | 'browser' | 'hybrid';
export type EngineStatus = 'ready' | 'needs-config' | 'needs-install' | 'error' | 'checking';

export interface EngineConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'toggle';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { label: string; value: string }[];
}

export interface EngineDescriptor {
  id: string;
  name: string;
  category: EngineCategory;
  runtime: EngineRuntime;
  description: string;
  features: string[];
  pricing: { isFree: boolean; priceInfo?: string };
  configFields: EngineConfigField[];
  applyUrl?: string;
}
```

### IPC 通道

```
engine-config:get              → { engineId } → config | null
engine-config:save             → { engineId, config } → { success }
engine-config:delete           → { engineId } → { success }
engine-config:get-all          → void → configs
engine-config:get-default      → { category } → engineId | null
engine-config:set-default      → { category, engineId } → { success }
engine-config:test-connection  → { engineId } → { success, error? }
engine-config:list-by-category → { category } → EngineDescriptor[]
```

### ASRProvider 接口（已有）

```typescript
export interface ASRProvider {
  readonly id: string;
  readonly name: string;
  checkStatus(): Promise<ASRProviderStatus>;
  transcribe(input: ASRInput): Promise<ASRResult>;
  getModels?(): Promise<ASRModelInfo[]>;
}
```

---

## §4 已有代码参考

在实现前，参考以下已有文件了解模式：

| 文件                                                       | 参考什么                   |
| ---------------------------------------------------------- | -------------------------- |
| `electron/services/asr/ASRService.ts`                      | Provider 注册和路由模式    |
| `electron/services/asr/providers/OpenAIWhisperProvider.ts` | 在线 ASR Provider 实现参考 |
| `electron/services/asr/providers/DoubaoASRProvider.ts`     | 复杂鉴权的实现参考         |
| `electron/services/asr/types.ts`                           | ASR 类型定义               |
| `electron/services/environment/EngineReadinessStore.ts`    | 类似的 JSON 配置存储模式   |
| `electron/ipc/handlers/environmentManagerHandlers.ts`      | IPC handler 注册模式       |
| `src/features/settings/sections/ASRSection.tsx`            | 设置页 section 组件参考    |

---

## §5 通用执行规范

### 代码质量门（每个任务都必须过）
- TypeScript 严格模式无错误
- 无 any 类型
- 错误处理完备（try-catch + console.error/log）
- 符合项目目录结构规范
- 新增 IPC 通道需在 handler 中注册

### 遇到阻塞时
- 如果依赖前序任务的产出 → 检查 progress.txt 确认已完成
- 如果缺少外部依赖 → 记录到 friction-log 并跳过
- 如果任务描述不清晰 → 记录为摩擦，做最合理的推断，标注 ⚠️

### 文件读写
- 读取和写入文件时分批操作，每次不超过 200 行
- 优先用 `mcp_fast-context_fast_context_search` 做代码搜索

---

## §8 摩擦日志协议

### 何时写入
- 遇到意外的代码模式或不一致
- 发现 spec 与实际代码不符
- 类型错误/导入问题/路径问题
- 任何花费 > 5 分钟排查的问题

### 何时读取
- 每次迭代开始时（步骤 4）
- 实现类似功能时，检查是否有相关坑记录
