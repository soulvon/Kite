# 统一 AI 引擎管理 — PRD + 任务清单

> **规格文档**: `spec/66_统一AI引擎管理(UNIFIED_AI_ENGINE_MANAGEMENT).md`

---

## ⚡ 当前阶段 — 先读此

> **活跃阶段：第一阶段 — 基础设施（引擎配置层）**
> **下一个任务：任务 1.2 — EngineConfigStore 实现**
> **说明：见下方任务详情**

---

## 阶段概览

| 阶段 | 描述                   | 任务数 | 完成 | 状态     |
| ---- | ---------------------- | ------ | ---- | -------- |
| 1    | 基础设施（引擎配置层） | 4      | 1    | 🔄 进行中 |
| 2    | ASR 在线引擎接入       | 4      | 0    | ⏳ 等待   |
| 3    | 前端 UI 组件           | 3      | 0    | ⏳ 等待   |
| 4    | 业务集成               | 2      | 0    | ⏳ 等待   |

---

## 第一阶段：基础设施（引擎配置层）

- ✅ 任务 1.1：引擎类型定义
  **目标**: 创建统一引擎管理的核心类型定义
  **文件**: `electron/services/engineConfig/types.ts`
  **步骤**:
  1. 创建 `electron/services/engineConfig/` 目录
  2. 定义 `EngineCategory`, `EngineRuntime`, `EngineStatus` 类型
  3. 定义 `EngineConfigField` 接口（配置字段元数据）
  4. 定义 `EngineDescriptor` 接口（引擎描述符）
  5. 导出所有类型
  **验收标准**:
  - [ ] 类型定义与 spec §3.3 一致
  - [ ] `tsc --noEmit` 通过
  **依赖**: 无

- ❌ 任务 1.2：EngineConfigStore 实现
  **目标**: 实现统一引擎配置存储（读写 engines.json）
  **文件**: `electron/services/engineConfig/EngineConfigStore.ts`
  **步骤**:
  1. 实现单例模式 `EngineConfigStore`
  2. 配置文件路径: `UserDatas/Config/engines.json`
  3. 实现 CRUD: `getConfig`, `setConfig`, `deleteConfig`, `getAllConfigs`
  4. 实现默认引擎管理: `getDefault`, `setDefault`（存储在 `__defaults__` key 下）
  5. 实现文件读写（带缓存，写入时同步到磁盘）
  6. 参考 `EngineReadinessStore` 的实现模式
  **验收标准**:
  - [ ] CRUD 操作正确读写 JSON 文件
  - [ ] 文件不存在时自动创建空对象
  - [ ] 密码字段（API Key）以明文存储（本地文件，不需要加密）
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1

- ❌ 任务 1.3：引擎描述符注册表
  **目标**: 创建所有引擎的描述符注册表（静态数据）
  **文件**: `electron/services/engineConfig/engineDescriptors.ts`
  **步骤**:
  1. 为所有已有引擎创建 `EngineDescriptor`（先做 ASR 类别）:
     - 已有本地: `whisperx`, `local-whisper`, `funasr`, `sherpa-onnx`
     - 已有在线: `doubao-asr`, `qwen-asr`, `openai-whisper`
     - 待接入: `aliyun-asr`, `volcengine-asr`, `iflytek-asr`
  2. 导出 `getEngineDescriptor(id)` 和 `listEnginesByCategory(category)` 函数
  3. 每个待接入引擎的 `configFields` 按 spec §6 定义
  **验收标准**:
  - [ ] 至少 10 个 ASR 引擎的描述符
  - [ ] `configFields` 与 spec 中各引擎的配置字段一致
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1

- ❌ 任务 1.4：引擎配置 IPC Handlers
  **目标**: 实现引擎配置的 IPC 通信层
  **文件**: `electron/ipc/handlers/engineConfigHandlers.ts`
  **步骤**:
  1. 创建 `registerEngineConfigHandlers(ipcMain)` 函数
  2. 实现 9 个 IPC 通道（见 spec §4.1）:
     - `engine-config:get`, `save`, `delete`, `get-all`
     - `engine-config:get-default`, `set-default`
     - `engine-config:test-connection`（先返回 stub，后续各 Provider 实现）
     - `engine-config:list-by-category`
  3. 在主进程入口注册 handlers
  4. 参考 `environmentManagerHandlers.ts` 的注册模式
  **验收标准**:
  - [ ] 所有 9 个 IPC 通道注册并可调用
  - [ ] `test-connection` 对未实现的引擎返回 `{ success: false, error: '暂不支持' }`
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1, 1.2, 1.3

---

## 第二阶段：ASR 在线引擎接入

- ❌ 任务 2.1：阿里云百炼 ASR Provider (Fun-ASR)
  **目标**: 实现阿里云百炼 Fun-ASR 录音文件识别
  **文件**: `electron/services/asr/providers/AliyunASRProvider.ts`
  **步骤**:
  1. 实现 `ASRProvider` 接口
  2. 从 `EngineConfigStore` 读取 `apiKey` 和 `model` 配置
  3. 实现 DashScope 异步任务模式:
     - POST 提交任务到 `https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription`
     - GET 轮询 `https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`
  4. 认证: `Authorization: Bearer {api-key}`
  5. 音频输入: 本地文件需先转为可访问 URL（临时 HTTP server 或 base64）
  6. 支持模型切换: `fun-asr`(默认) / `qwen3-asr-flash-filetrans`
  7. 说话人分离: `diarization_enabled` 参数（仅 Fun-ASR 支持）
  8. 解析结果为 `ASRSegment[]` 格式
  **验收标准**:
  - [ ] `checkStatus()` 正确检测 API Key 是否配置
  - [ ] `transcribe()` 返回带时间戳的 `ASRSegment[]`
  - [ ] 错误处理: 无 Key / Key 无效 / 网络超时
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1, 1.2

- ❌ 任务 2.2：火山引擎 ASR Provider
  **目标**: 实现火山引擎豆包录音文件识别
  **文件**: `electron/services/asr/providers/VolcEngineASRProvider.ts`
  **步骤**:
  1. 实现 `ASRProvider` 接口
  2. 从 `EngineConfigStore` 读取配置 (`appId`, `accessToken`, `resourceId`)
  3. 优先实现极速版:
     - POST `https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
  4. 超大文件回退标准版:
     - POST submit → POST query 轮询
  5. V3 请求头: `X-Api-App-Key`, `X-Api-Access-Key`, `X-Api-Resource-Id`, `X-Api-Request-Id`, `X-Api-Sequence`
  6. 请求体: `{ audio: { url, format }, request: { model_name: "bigmodel", ... } }`
  7. 本地文件需暴露临时 HTTP URL
  8. 说话人分离: `enable_speaker_info: true`
  9. 解析结果为 `ASRSegment[]`
  **验收标准**:
  - [ ] 极速版正常工作
  - [ ] 请求头参数正确
  - [ ] 错误处理完备
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1, 1.2

- ❌ 任务 2.3：科大讯飞 ASR Provider
  **目标**: 实现科大讯飞语音转写
  **文件**: `electron/services/asr/providers/IflytekASRProvider.ts`
  **步骤**:
  1. 实现 `ASRProvider` 接口
  2. 从 `EngineConfigStore` 读取配置 (`appId`, `secretKey`)
  3. 实现五步流程:
     - ① prepare → ② upload (分片 10MB) → ③ merge → ④ getProgress → ⑤ getResult
  4. 实现 HmacSHA1 签名:
     - `baseString = appId + ts`
     - `md5 = MD5(baseString)`
     - `signa = Base64(HmacSHA1(secretKey, md5))`
  5. URL: `https://raasr.xfyun.cn/api/{prepare|upload|merge|getProgress|getResult}`
  6. 说话人分离: `has_seperate=true` + `speaker_number=N`
  7. 解析结果为 `ASRSegment[]`
  **验收标准**:
  - [ ] 签名算法正确
  - [ ] 分片上传正常工作
  - [ ] 轮询进度正确处理
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 1.1, 1.2

- ❌ 任务 2.4：ASRService 注册新 Provider
  **目标**: 将三个新 Provider 注册到 ASRService
  **文件**: `electron/services/asr/ASRService.ts`, `electron/services/asr/types.ts`
  **步骤**:
  1. 在 `types.ts` 的 `ASRProviderType` 中新增 `aliyun-asr`, `volcengine-asr`, `iflytek-asr`
  2. 在 `ASRService.ts` 的构造函数中注册三个新 Provider
  3. 确保 `getProviders()` 返回包含新 Provider
  4. 更新 `test-connection` IPC handler 支持三个新引擎
  **验收标准**:
  - [ ] 三个新引擎出现在 provider 列表
  - [ ] 选择新引擎后能正确路由到对应 Provider
  - [ ] `tsc --noEmit` 通过
  **依赖**: 任务 2.1, 2.2, 2.3

---

## 第三阶段：前端 UI 组件

- ❌ 任务 3.1：EngineConfigModal 通用配置弹窗
  **目标**: 实现根据 configFields 动态渲染的引擎配置弹窗
  **文件**: `src/components/EngineConfigModal.tsx`
  **步骤**:
  1. 接收 props: `engineId`, `descriptor: EngineDescriptor`, `onClose`, `onSaved`
  2. 加载已有配置: `window.electron.invoke('engine-config:get', { engineId })`
  3. 根据 `descriptor.configFields` 动态渲染表单:
     - `text` → `<input type="text">`
     - `password` → `<input type="password">` + 显示/隐藏切换
     - `select` → `<select>` 从 options 渲染
     - `toggle` → 开关组件
  4. [测试连接] 按钮 → `engine-config:test-connection`
  5. [保存] 按钮 → `engine-config:save`
  6. 展示引擎信息: 特性、价格、申请地址
  7. 样式参考项目现有弹窗风格
  **验收标准**:
  - [ ] 所有字段类型正确渲染
  - [ ] password 字段有眼睛图标切换
  - [ ] 保存后调用 onSaved 回调
  - [ ] UI 文本为中文
  **依赖**: 任务 1.4

- ❌ 任务 3.2：EngineSelector 通用引擎选择器
  **目标**: 实现业务页面使用的引擎选择下拉组件
  **文件**: `src/components/EngineSelector.tsx`
  **步骤**:
  1. 接收 props: `category`, `value`, `onChange`, `filter?`, `className?`
  2. 加载引擎列表: `engine-config:list-by-category`
  3. 按状态分组展示:
     - 🟢 ready → 可点击选中
     - 🟡 needs-config → 右侧 ⚙️ 按钮，弹出 EngineConfigModal
     - 🔴 needs-install → 右侧 📦 按钮，跳转安装
  4. 底部 "管理所有引擎..." 入口 → 打开设置页
  5. 显示当前默认引擎标记 [默认]
  **验收标准**:
  - [ ] 三种状态的引擎正确展示
  - [ ] needs-config 点 ⚙️ 弹出配置弹窗，配置完自动选中
  - [ ] 下拉动画流畅
  - [ ] UI 文本为中文
  **依赖**: 任务 3.1

- ❌ 任务 3.3：AIEngineSection 设置页
  **目标**: 在设置页新增 AI 引擎 Tab
  **文件**: `src/features/settings/sections/AIEngineSection.tsx`
  **步骤**:
  1. 按 spec §5.1 布局，左侧类别导航（语音识别/语音合成/人声分离/去水印/视频分割）
  2. 右侧展示所选类别的引擎列表
  3. 引擎列表分为 "本地引擎" 和 "在线引擎" 两组
  4. 每个引擎行: 图标 + 名称 + 状态 + 操作按钮（配置/安装/设默认）
  5. 在设置页注册此 Section（找到注册位置并添加）
  **验收标准**:
  - [ ] 5 个类别正确切换
  - [ ] 引擎状态实时展示
  - [ ] 配置按钮弹出 EngineConfigModal
  - [ ] UI 文本为中文
  **依赖**: 任务 3.1, 3.2, 1.4

---

## 第四阶段：业务集成

- ❌ 任务 4.1：视频翻译 V2 集成 EngineSelector
  **目标**: 在 ConfigStep 中使用 EngineSelector 选择 ASR 引擎
  **文件**: `src/features/toolbox/video-translation-v2/steps/ConfigStep.tsx`
  **步骤**:
  1. 找到当前 ASR 引擎选择的 UI
  2. 替换为 `<EngineSelector category="asr" />`
  3. 确保选中的引擎 ID 正确传递给后续流程
  **验收标准**:
  - [ ] ConfigStep 中显示 EngineSelector
  - [ ] 选中引擎后 ASR 流程使用该引擎
  **依赖**: 任务 3.2

- ❌ 任务 4.2：ASRSection 增强
  **目标**: 增强现有 ASR 设置页，链接到 AIEngineSection
  **文件**: `src/features/settings/sections/ASRSection.tsx`
  **步骤**:
  1. 在 ASRSection 中添加 "管理所有引擎" 入口
  2. 点击后跳转到 AIEngineSection 的语音识别类别
  3. 保持现有功能不变
  **验收标准**:
  - [ ] 跳转链接正常工作
  - [ ] 现有功能无回归
  **依赖**: 任务 3.3
