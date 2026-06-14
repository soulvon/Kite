# windsurf-pool BYOK 支持实施计划

> 状态: 已实施首版并完成本地验证
> 日期: 2026-06-08
> 目标: 在 windsurf-pool 中集成 BYOK 自带 Key 能力, 让 Windsurf / Devin 的 Cascade 对话可按模型路由到用户配置的 Anthropic / OpenAI 兼容 API, 同时保留现有号池、增强、多实例与测活功能。

## 1. 调研结论

### 1.1 windsurf-pool 现状

当前仓库没有正式的 BYOK 调研或实施文档。已发现的相关材料是:

| 类型 | 路径 | 结论 |
|---|---|---|
| 产品命名 | `spec/naming-proposal.md` | 提到 BYOK 是产品能力之一, 但没有技术设计。 |
| UI 原型 | `resources/webview/windsurf-byok.html` | 独立 BYOK 桌面式界面原型, 未接入扩展消息。 |
| UI 原型 | `resources/webview/byok-dashboard-v2.html` | 侧栏第 5 个 BYOK Tab 的视觉方案, 未接入后端。 |
| UI 原型 | `resources/webview/windsurf-kite-demo.html` | 供应商、模型映射、日志、设置等完整视觉原型。 |
| 现有代码 | `src/sidebarProvider.ts`, `resources/webview/main.js` | 没有 BYOK message type、provider store、proxy manager 或 sidecar 生命周期管理。 |

可复用的现有基础:

- `src/elevatedFs.ts`: 已有提权写 IDE 安装目录的能力。
- `src/sessionInjector.ts`: 已有 patch IDE 内置 `extension.js` 的经验和回滚思路。
- `src/enhancementInjector.ts`: 已有 workbench 注入、备份、hash 版本标记和 checksum 修复链路。
- `src/ideDetector.ts`: 已有 Windsurf / Devin 路径与命名适配。
- `src/bridgeServer.ts`: 已有本地 HTTP bridge, 可借鉴 token、端口、CORS 的安全模型。
- `src/utils.ts`: 已有跨平台 app data 路径, BYOK 配置可落在 `.windsurf-pool/byok/` 下。

### 1.2 IDE-BYOK 参考项目

参考路径: `E:\project\IDE-BYOK`

核心方案:

- Tauri 桌面壳 + Node sidecar。
- 默认本地端口 `7450` 作为混合代理, 拦截 Cascade chat; 其余请求透传官方服务。
- 通过 `http.proxy = http://localhost:7450` 和 `http.proxyStrictSSL = false` 让 IDE 流量进入本地代理。
- `sidecar/hybrid-server.js` 处理 CONNECT / MITM, `GetChatMessage` 命中后转第三方供应商, 其他方法透传。
- `sidecar/handlers/chat.js` 从 `GetChatMessageRequest` protobuf field 21 提取 `modelUid`, 用 `model-map.json` 查槽位和 targets。
- `sidecar/provider-pool.js` 读取 `providers.json` + `model-map.json`, 解析 provider、真实模型、API path、能力标记。
- `sidecar/handlers/parse-request.js` 将 Windsurf protobuf 请求转换为 Anthropic 风格消息、工具、图片块。
- `sidecar/handlers/openai-stream.js` / `anthropic-stream.js` 将上游 SSE 转回 Windsurf 需要的 Connect-RPC protobuf chunk。
- `sidecar/rename-models.js` 可改写 `GetUserStatus` 响应, 做模型改名、解锁 `disabled`、设置 `supports_images`、注入 BYOK 模型项。

关键逆向结论:

- `GetChatMessageRequest` 的模型 ID 在 top-level field 21。
- `ClientModelConfig.disabled` 是 field 4, bool; `supports_images` 是 field 5, bool。
- 模型 UI 层是否可点可通过 `GetUserStatus` 响应改写控制。
- 只要 `GetChatMessage` 被 sidecar 拦截并转到 BYOK API, 就不再走官方模型调用链。
- Gemini / OpenAI 兼容层可能不支持完整 JSON Schema, 需要工具 schema 兼容清洗。
- 参考项目已实现遥测方法屏蔽、限速检查响应伪造、请求重试、provider failover、模型能力自动标记。

### 1.3 Proxy Manager 参考项目

参考路径: `E:\project\fix\逆向分析\windsurf-proxy-manager-extracted`

核心方案:

- VS Code / Windsurf / Devin 扩展封装 Node 代理运行时。
- 安装后将 `resources/proxy` 复制到 `context.globalStorageUri/proxy-runtime`。
- 通过 webview 管理 `.env`、profile、模型读取、启动/停止 3000/3001/3002 服务。
- 默认走补丁直连模式: 修改 IDE 内置 `extension.js`, 将 `api_server_url` 和 `inference_api_server_url` 指向 `localhost:3000/3001`。
- 补丁直连模式不需要 MITM 证书; 透明 MITM/CONNECT 模式才需要证书。

可借鉴点:

- `ProxyManager.prepareEnvironment()` 的运行时同步策略: VSIX 内资源复制到 globalStorage, 保留用户 `.env` / profile。
- `startService()` / `stopServiceById()` 的进程托管策略。
- `fetchModels()` 从 OpenAI 兼容 `/v1/models` 读取模型列表, 失败时 fallback。
- 侧栏 + 全屏面板共享状态推送。

对 windsurf-pool 的定位:

- **插件形态以 Proxy Manager 为基准**: 在当前 VS Code / Windsurf / Devin 扩展内托管代理运行时, 不另起 Tauri 桌面壳。
- **sidecar 协议实现以 IDE-BYOK 为主**: 复用其更新的 `GetChatMessage` 解析、provider pool、模型改写、schema 兼容、stats 等逻辑。
- **UI/存储/命令以 windsurf-pool 现有结构为准**: 接入 `SidebarProvider`、`main.js`、SecretStorage、`elevatedFs`、`ideDetector` 和 checksum 修复链路。

## 2. 推荐路线

> 2026-06-08 实施记录: 已按“插件托管 sidecar + 直连 patch”路线完成首版。新增 `src/byokStore.ts`、`src/byokProxyManager.ts`、`src/byokIdePatch.ts`、`src/byokTypes.ts`; 已迁入 `resources/byok-sidecar`; 侧栏已接入 Provider、模型映射、运行日志和 patch 状态。审查时额外修正了两个关键点: Provider Host 中的 base path 会合并到 `apiPath`，例如 `https://openrouter.ai/api` + `/v1/chat/completions` 会写成 origin `https://openrouter.ai` 与 path `/api/v1/chat/completions`; sidecar 监听地址默认收紧为 `127.0.0.1`，避免暴露到局域网。
>
> 2026-06-09 实施记录: 已按 `E:\project\IDE-BYOK` 的交互设计迁移可落地能力。供应商新增/编辑改为全屏编辑器，支持模型目录、默认模型和连接测试回填；模型映射改为 IDE 槽位 + 供应商模型双栏选择；新增显示名模板设置、扩展槽位管理、故障转移链编辑、运行统计和日志筛选/导出。审查时修正两点: sidecar 运行时复制跳过开发用 `node_modules`，日志“清空显示”不会被下一次状态同步立即刷回。

### 2.1 插件托管优先

实现路线应更接近 `windsurf-proxy-manager-extracted`:

```text
windsurf-pool 扩展
  -> SidebarProvider / commands 管理 BYOK UI
  -> byokProxyManager 复制/启动/停止 Node sidecar
  -> byokIdePatch 修改并恢复 IDE 内置 extension.js
  -> sidecar 执行协议转换和 provider 路由
```

也就是说, windsurf-pool 不做独立桌面应用, 不引入 Tauri 命令层; 只把 BYOK 作为现有扩展的一个子系统。

### 2.2 默认采用补丁直连模式

建议 windsurf-pool 第一版 BYOK 默认走 **补丁直连模式**, 而不是 IDE-BYOK 的 `http.proxy` MITM 模式。

原因:

- windsurf-pool 已经具备 IDE 文件补丁、提权、备份、恢复和 checksum 修复能力。
- 不需要生成/安装 MITM 证书, 用户上手成本更低。
- 不修改用户全局代理设置, 代理停止后不容易造成 IDE 网络残留故障。
- 和 Proxy Manager 的 VS Code 扩展封装方式更接近, 迁移成本更低。
- 与当前插件版本形态一致: VSIX 内带运行时资源, 用户在侧栏完成配置、启动、停止、补丁和恢复。

默认链路:

```text
Windsurf / Devin extension.js patch
  -> language_server --api_server_url http://127.0.0.1:<apiPort>
  -> BYOK sidecar hybrid proxy
       -> GetChatMessage 命中 model-map 槽位: 转 Anthropic/OpenAI 兼容 API
       -> GetUserStatus: 可选改写模型显示/解锁/注入
       -> 其他请求: 透传官方服务
```

### 2.3 可选保留 MITM 模式

后续可提供高级接入模式:

```json
{
  "http.proxy": "http://localhost:7450",
  "http.proxyStrictSSL": false
}
```

MITM 模式适合不想改 IDE 安装目录的用户, 但必须解决证书生成、信任安装、settings 备份恢复、CONNECT 主机兼容等问题, 不建议作为 MVP 默认路径。

## 3. 功能范围

### 3.1 MVP 范围

- BYOK 开关: 启动/停止本地 sidecar。
- Provider 管理: Anthropic、OpenAI 兼容供应商; host、path、format、default model、能力标记。
- API Key 安全存储: 扩展侧用 VS Code SecretStorage 作为真相源。
- 模型映射: Windsurf / Devin modelUid -> provider target, 支持多个 targets 顺序 failover。
- 模型列表: 捕获 IDE 模型列表 + 读取 provider `/v1/models`。
- Patch 接入: 将 IDE `api_server_url` 指向本地 BYOK sidecar, 支持恢复。
- 日志与状态: sidecar stdout/stderr、端口状态、最近请求统计、错误提示。
- 与现有功能共存: 不影响账号切换、自动恢复、多实例、增强脚本。

### 3.2 首版暂不做

- 不做 Tauri 壳。
- 不做卡密、商业鉴权、共享 Pro token 替换。
- 不把用户 API Key 长期明文写入 `providers.json`。
- 不默认屏蔽所有遥测; 先做可配置开关。
- 不默认改行内补全 / inference; 第一阶段优先 Cascade 对话, 第二阶段再接 3001。
- 不做 Remote SSH 完整部署; 仅记录为后续扩展项。

## 4. 模块设计

### 4.1 新增后端模块

| 文件 | 职责 |
|---|---|
| `src/byokTypes.ts` | Provider、ModelMap、ProxyStatus、SidecarEvent 类型定义。 |
| `src/byokStore.ts` | 读写 BYOK 配置; API Key 写 SecretStorage; 非敏感配置写 `.windsurf-pool/byok/*.json`。 |
| `src/byokProxyManager.ts` | sidecar 运行时准备、启动、停止、健康检查、日志收集、端口状态。 |
| `src/byokIdePatch.ts` | patch / restore IDE 内置 `extension.js` 的 API server URL; 复用 `ideDetector` 与 `elevatedFs`。 |
| `src/byokModelService.ts` | provider `/v1/models` 拉取、IDE 模型缓存读取、模型映射校验。 |
| `src/byokRuntimeConfig.ts` | 启动 sidecar 前生成短生命周期 runtime config, 停止后清理。 |

### 4.2 新增资源目录

```text
resources/byok-sidecar/
  package.json
  proxy-entry.js
  hybrid-server.js
  provider-pool.js
  proto.js
  connect.js
  stats.js
  rename-models.js
  handlers/
    chat.js
    parse-request.js
    build-response.js
    anthropic-stream.js
    openai-stream.js
  prompts/
    system-prompt.md
```

迁移原则:

- 插件托管方式以 `E:\project\fix\逆向分析\windsurf-proxy-manager-extracted\extension\extension.js` 为模板: 运行时复制到扩展 storage、由扩展启动/停止进程、侧栏同步状态。
- sidecar 代码以 `E:\project\IDE-BYOK\sidecar` 为主, 因为它比 Proxy Manager 的解包版本更新, 已包含模型解锁、注入、provider pool、schema 兼容和 stats。
- 删除 Tauri 专用依赖。
- 增加 `/__byok/health`、`/__byok/stats`、`/__byok/shutdown` 本地控制端点。
- sidecar 只监听 `127.0.0.1`, 控制端点要求扩展生成的随机 token。

### 4.3 配置目录

使用 windsurf-pool 自有根目录:

```text
%APPDATA%\.windsurf-pool\byok\
  config.json
  providers.json          # 不含明文 apiKey
  model-map.json
  ide-models.json
  logs/
  runtime/
    providers.resolved.json  # 启动期临时文件, 停止后删除
```

Provider 配置建议:

```json
{
  "providers": [
    {
      "id": "openai-main",
      "name": "OpenAI Main",
      "apiHost": "api.openai.com",
      "apiPath": "/v1/responses",
      "apiFormat": "openai",
      "defaultModel": "gpt-5.1",
      "enabled": true,
      "secretRef": "windsurfPool.byok.provider.openai-main.apiKey",
      "capabilities": {
        "text": true,
        "stream": true,
        "vision": true,
        "tools": true,
        "toolSchemaCompat": ""
      },
      "modelCaps": {}
    }
  ]
}
```

Model map 建议沿用 IDE-BYOK:

```json
{
  "namePrefix": "(BYOK)",
  "labelTemplate": "{prefix} {label} ({provider})",
  "slots": [
    {
      "modelUid": "MODEL_XAI_GROK_3",
      "displayName": "Claude Opus BYOK",
      "enabled": true,
      "supportsImages": true,
      "targets": [
        { "providerId": "openai-main", "model": "gpt-5.1" }
      ]
    }
  ],
  "injected": []
}
```

## 5. UI 设计

### 5.1 侧栏入口

在现有侧栏增加 BYOK 面板。若 `spec/tab-ui-refactor.md` 先落地, BYOK 可作为第 5 个 Tab; 若未落地, 先增加一个独立 `#byokArea` 折叠卡片。

页面分区:

| 区域 | 控件 |
|---|---|
| 状态 | 开关、端口、patch 状态、当前命中模型、错误数。 |
| 供应商 | 列表、新增、编辑、启用/禁用、测试连接、拉取模型。 |
| 模型映射 | IDE 模型列表、provider target、supportsImages、failover 顺序、显示名模板。 |
| 扩展槽位 | 从 Windsurf catalog 启用可注入模型, 配置 provider / apiModel / 图片能力。 |
| 接入 | 应用补丁、恢复补丁、重启 IDE 提示、可选 http.proxy 模式。 |
| 日志 | 最近 sidecar 日志、请求统计、导出日志。 |

### 5.2 Webview 消息

新增 `WebviewMessageType`:

```typescript
| 'byokLoad'
| 'byokSaveProvider'
| 'byokDeleteProvider'
| 'byokTestProvider'
| 'byokSaveSlot'
| 'byokSaveModelMapSettings'
| 'byokSaveInjected'
| 'byokDeleteSlot'
| 'byokStart'
| 'byokStop'
| 'byokApplyPatch'
| 'byokRestorePatch'
```

新增 backend message:

```typescript
| 'byokStateSync'
| 'byokProviderTestResult'
| 'byokLog'
```

## 6. 实施阶段

### Phase 0: 文档与边界确认

- [x] 确认 windsurf-pool 内没有正式 BYOK 调研文档。
- [x] 调研 IDE-BYOK 与 Proxy Manager 的实现差异。
- [x] 评审本计划, 确认默认采用补丁直连模式。

### Phase 1: Sidecar MVP

- [x] 复制并瘦身 `E:\project\IDE-BYOK\sidecar` 到 `resources/byok-sidecar`。
- [x] 增加 stats endpoint、运行日志和本地健康探测。
- [x] 保留 `GetChatMessage` -> Anthropic/OpenAI 转换、stream 回包、provider failover。
- [x] 保留 `GetUserStatus` 模型列表捕获、显示名改写、模型解锁和注入能力。
- [x] 编写扩展托管启动链路, 用 runtime config 驱动 sidecar。

验收:

- `node resources/byok-sidecar/proxy-entry.js` 可监听本地端口。
- `/__byok/health` 返回 ok。
- sample `providers.resolved.json` + `model-map.json` 下可将一个 `GetChatMessage` 样本路由到指定 provider。

### Phase 2: 扩展托管

- [x] 新建 `byokStore.ts`, 配置落 `.windsurf-pool/byok`, API Key 落 SecretStorage。
- [x] 新建 `byokProxyManager.ts`, 将 sidecar 复制到 `context.globalStorageUri/byok-runtime` 后启动。
- [x] 启动前解析 SecretStorage, 生成短生命周期 runtime config。
- [x] 停止 sidecar 后清理临时 key 文件。
- [x] 侧栏能显示 running、port、patch、request count、token、retry、error 和最近路由。

验收:

- 扩展命令可启动/停止 BYOK sidecar。
- 端口冲突时给出明确提示, 不抢占未知进程。
- API Key 不出现在持久化 `providers.json`。

### Phase 3: IDE 补丁接入

- [x] 新建 `byokIdePatch.ts`, 定位 Windsurf / Devin 内置 `extensions/windsurf/dist/extension.js`。
- [x] 实现 API server URL 补丁: `--api_server_url` 指向 `http://127.0.0.1:<apiPort>`。
- [x] 实现 inference URL 补丁: `--inference_api_server_url` 指向 `http://127.0.0.1:<inferencePort>`。
- [x] 增加补丁 marker、备份、恢复、兼容性检测。
- [x] 与现有补丁链保持分区 marker, BYOK 恢复只移除自己的 marker。
- [x] patch 后调用 checksum 修复。

验收:

- 应用补丁后重启 IDE, sidecar 日志能看到官方 API 请求进入本地端口。
- 未配置 BYOK 槽位的请求仍可透传官方服务。
- 恢复补丁后 IDE 不再访问本地端口。

### Phase 4: 侧栏 UI

- [x] 在 `src/types.ts` 增加 BYOK message types。
- [x] 在 `src/sidebarProvider.ts` 增加 BYOK message handler。
- [x] 在 `_getHtmlForWebview()` 增加 BYOK Tab。
- [x] 在 `resources/webview/main.js` 增加 provider/model-map 状态渲染和事件绑定。
- [x] 复用 IDE-BYOK 的全屏编辑、目录选择、故障转移、扩展槽位和运行仪表盘交互, 并适配现有侧栏视觉变量和控件密度。

验收:

- 可在侧栏新增 provider、保存 key、测试连接、拉取模型。
- 可把 IDE modelUid 映射到 provider model。
- 可一键启动代理、应用补丁、停止代理、恢复补丁。

### Phase 5: 模型改写与注入

- [ ] 默认只改名已配置槽位, 不默认解锁全部模型。
- [ ] 增加配置项 `unlockConfiguredModelsOnly`。
- [ ] 对已配置 slot 改写 label, 并按 `supportsImages` 改写 field 5。
- [ ] 对 injected 模型先做只读预览, 再开放写入。
- [ ] 捕获 `ide-models.json`, UI 中显示原始 label、modelUid、provider、是否可用。

验收:

- 配置过的 BYOK 模型在 IDE 下拉框显示 `(BYOK)` 前缀。
- 支持图片开关能影响 IDE 发图入口状态。
- 未配置槽位不会被误导性解锁。

### Phase 6: 稳定性与兼容

- [ ] Provider 请求重试、failover、超时配置。
- [ ] Gemini / OpenAI 兼容层工具 schema 清洗。
- [ ] 日志脱敏: API Key、Authorization、x-api-key 必须遮蔽。
- [ ] 可选遥测屏蔽开关。
- [ ] 多实例端口隔离: 每个实例是否共享一个 BYOK 代理需明确。MVP 建议全局单代理, 多实例共享配置。
- [ ] Windows / macOS / Linux 路径验证。

验收:

- TypeScript 编译通过。
- 至少验证 Windsurf + Devin 各一次启动、patch、对话、停止、恢复。
- Sidecar 崩溃时 UI 能感知并允许恢复 IDE 补丁。

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `extension.js` 版本变化导致补丁失败 | BYOK 接入不可用 | 补丁前做兼容性检测; 保留 http.proxy MITM 作为高级 fallback。 |
| 与 `sessionInjector` 同文件补丁冲突 | 切号和 BYOK 互相覆盖 | 把 patch 操作集中成可组合 patch manager, marker 分区, 回滚只移除自己的 marker。 |
| API Key 泄露到磁盘或日志 | 高风险 | SecretStorage 为真相源; runtime config 短生命周期; 日志统一 redact。 |
| sidecar 端口残留 | IDE 断网或启动失败 | stop 时 kill 托管进程; 端口占用只提示不抢占未知进程; restore patch 兜底。 |
| 模型全解锁误导用户 | 用户选择未配置模型后失败 | 默认只解锁/改名已配置模型; 全解锁作为高级开关。 |
| 上游 provider 协议差异 | 400/工具调用失败/stream 不完整 | 保留 schema compat、Responses/Chat Completions 双模式、Anthropic 原生模式。 |
| 多实例共享代理状态混乱 | A 实例改配置影响 B 实例 | MVP 采用全局单代理并在 UI 明示; 后续再做实例级 profile。 |

## 8. 验收标准

### MVP 验收

- 用户可在 windsurf-pool 侧栏添加一个 OpenAI 兼容 provider。
- API Key 不以明文长期保存在 `providers.json`。
- 用户可把一个 Windsurf / Devin 模型映射到该 provider 的真实模型。
- 点击启动 BYOK 后, sidecar 运行并显示健康状态。
- 应用 IDE 补丁并重启后, Cascade 对话命中配置模型时走 BYOK provider。
- 未命中配置模型时仍透传官方服务。
- 停止 BYOK 并恢复补丁后, IDE 回到原始官方服务。
- 现有账号切换、自动恢复、侧栏刷新不回归。

### 编译与测试

```powershell
npm run compile
```

手测矩阵:

| 场景 | Windsurf | Devin |
|---|---|---|
| 扩展启动 | 编译通过, 待 IDE 实机 | 编译通过, 待 IDE 实机 |
| BYOK sidecar 启停 | 待实机 | 待实机 |
| IDE 补丁应用/恢复 | 待实机 | 待实机 |
| Cascade BYOK 对话 | 待实机 | 待实机 |
| 未映射模型透传 | 待实机 | 待实机 |
| 账号切换 | 未触及, 待回归 | 未触及, 待回归 |

## 9. 后续增强

- 打包 sidecar 为独立 exe, 减少对系统 Node.js 的依赖。
- 增加 MITM/http.proxy 高级模式。
- 增加 provider profile 与模型映射导入导出。
- 增加每 provider 成本估算和 token 统计。
- 支持 Web Search / Embeddings / Inference 代理。
- 支持 Remote SSH 部署向导。
- 支持模型 catalog 更新机制。
