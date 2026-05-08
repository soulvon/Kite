---
name: skill-dev-assistant
description: 辅助开发 GenStudio 内容生产技能，从需求拆解到代码生成。当用户描述"我想做一个 xxx 视频技能"或"帮我设计技能"时激活。
---

# GenStudio 技能开发助手

> 当用户描述一个内容生产需求时，自动拆解为技能定义，并生成对应的规格文档和代码。

## 触发条件

当用户说以下关键词时激活：
- "我想做一个 xxx 视频技能"
- "帮我设计 xxx 技能"
- "开发一个 xxx 的功能"
- `/技能开发助手`

---

## 可用能力清单（可以复用）

### 工具箱（主要入口）

| 工具 ID             | 名称         | 功能                           | 路径                                          |
| ------------------- | ------------ | ------------------------------ | --------------------------------------------- |
| `video-downloader`  | 视频下载     | 从 主流平台媒体网站提取视频    | `src/features/toolbox/VideoDownloader.tsx`    |
| `video-analysis`    | 视频内容分析 | AI 分析视频、提取文案/分镜/BGM | `src/features/toolbox/video-analysis/`        |
| `speech-to-text`    | 语音转文字   | 音视频字幕提取                 | `src/features/toolbox/SpeechToText.tsx`       |
| `tips-image`        | 文案图生成   | 智能排版文案，透明 PNG         | `src/features/toolbox/TipsImageGenerator.tsx` |
| `text-to-speech`    | 文字转语音   | 多音色配音                     | `src/features/toolbox/TextToSpeech.tsx`       |
| `image-generator`   | AI 绘图      | 即梦/Gemini 等图片生成         | `src/features/toolbox/ImageGenerator.tsx`     |
| `video-generator`   | AI 视频      | 即梦/云雾 Sora 等视频生成      | `src/features/toolbox/VideoGenerator.tsx`     |
| `watermark-remover` | AI 去水印    | LaMa 等模型图片去水印          | `src/features/toolbox/watermark-removal/`     |
| `video-splitter`    | 视频分割     | 场景检测分割                   | `src/features/toolbox/video-splitter/`        |
| `prompt-optimizer`  | 提示词优化器 | AI 优化提示词                  | `src/features/toolbox/prompt-optimizer/`      |

### 剪辑系统（V2 可用）
将素材根据需求生成剪辑工程文件放入这进行渲染

| 服务               | 功能              | 路径                                                    |
| ------------------ | ----------------- | ------------------------------------------------------- |
| BatchRenderManager | 批量视频渲染      | `src/features/editor-v2/services/BatchRenderManager.ts` |
| ProjectFileService | 工程文件保存/加载 | `src/features/editor-v2/services/ProjectFileService.ts` |
| TemplateService    | 模板管理          | `src/features/editor-v2/services/TemplateService.ts`    |


### 素材库（可用）
管理用户本地素材, 智能调用, 转成成品可供发布使用

| 模块            | 功能                 | 路径                             |
| --------------- | -------------------- | -------------------------------- |
| MaterialManager | 素材导入、分类、检索 | `src/features/material-manager/` |

---



### 发布管理（可用）
将成品视频发布到各个平台

| 模块           | 功能       | 路径                            |
| -------------- | ---------- | ------------------------------- |
| PublishManager | 多平台发布 | `src/features/publish-manager/` |

### 浏览器自动化（V3 可用）
自动化操作浏览器,比如视频到平台发布, 将豆包等平台算力2api转成通用openai接口使用, 数据批量抓取等

| 模块          | 功能           | 路径                               |
| ------------- | -------------- | ---------------------------------- |
| Automation V3 | 网页自动化操作 | `electron/services/automation_v3/` |

### 能力层（CapabilityRegistry）
暴露给技能调用的能力

| 类型              | 说明     | 调用方式                                                         |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `text-generation` | 文本生成 | `capabilityRegistry.execute('api-xxx-text-generation', {...})`   |
| `scene-detection` | 场景检测 | `capabilityRegistry.execute('local-scene-detect-ffmpeg', {...})` |

---

## 工作流程

### Step 1: 需求理解 ✅

1. 分析用户描述，提取：
   - 内容类型（视频/图片/文案）
   - 输入要素（用户需要填什么）
   - 输出产物（最终生成什么）
   - 参考案例

2. 回复确认：
   ```
   我理解你想要的是：
   - 技能名称：xxx
   - 输入：用户提供 A、B、C
   - 输出：生成 X、Y、Z
   - 复用能力：ImageGenerator + TextToSpeech + BatchRenderManager
   
   是否正确？
   ```

### Step 2: 流程设计 ✅

1. 查看现有技能设计 (`spec/skills/*.md`) 作为参考
2. 设计 Prompt Chain：
   - 定义输入槽位（用户填什么）
   - 定义处理步骤（调用哪些工具/能力）
   - 定义输出槽位（生成什么）

3. 输出流程图

### Step 3: 规格文档生成 ✅

在 `spec/skills/` 目录下生成技能规格文档：
- 文件名：`XX_技能名称.md`
- 使用 `resources/spec-template.md` 模板

### Step 4: 代码实现 ✅

在 `src/features/skills/skills/` 下生成：
```
SkillName/
├── index.tsx          # 技能页面
├── config.ts          # 配置
├── types.ts           # 类型定义
└── services/
    └── SkillService.ts
```

注册到 `src/features/skills/registry.ts`

---

## 核心原则

1. **复用工具箱**：图片/语音/视频生成优先使用工具箱组件
2. **能力层调用**：文本生成走 `capabilityRegistry.execute()`
3. **结构化输出**：Prompt 要求返回 JSON
4. **用户可控**：关键步骤提供编辑/重新生成选项

---

## 禁止事项

- ❌ 不要使用已弃用的模块（剪辑 V1、发布中心 V1、自动化 V1/V2）
- ❌ 不要硬编码 AI API 调用
- ❌ 不要跳过规格文档直接写代码
- ❌ 不要一次生成所有代码，应分步确认
