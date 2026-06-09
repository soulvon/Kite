# 统一环境安装逻辑 - 开发计划

## Phase 1: 增强 EngineInstallModal（统一组件）
- [x] 1.1 增加 CPU/GPU 版本选择 ✅
- [x] 1.2 增加模型选择 ✅
- [x] 1.3 Python 环境复用提示 ✅
- [x] 1.4 回调增强 onInstall(options) ✅
- [x] 1.5 统一预设配置 (Demucs/Sherpa/FunASR/Whisper) ✅
- [x] 1.6 修复所有消费者适配新签名 ✅

## Phase 2: 下拉引擎列表标记"需安装"
- [x] 2.1 ASR 引擎选择器 (SpeechToText Sidebar + VideoTranslation VtSelect + VideoAnalysis ConfigPanel) ✅
- [ ] 2.2 TTS 引擎选择器 (延后: 需后端 TTS 状态检查 IPC, 当前本地 TTS 引擎无 check-status)
- [x] 2.3 人声分离引擎 (Demucs — 已有引擎状态标签 + 自动弹安装) ✅
- [ ] 2.4 剪辑器内触发 (延后: 编辑器暂未集成引擎安装)

## Phase 3: 清理旧安装 UI
- [x] 3.1 EnvironmentSetupModal 标记 @deprecated ✅ (仅保留给 EnvironmentGate)
- [x] 3.2 DownloadModal 标记 @deprecated ✅ (仅保留给 Whisper 多步骤下载)
- [x] 3.3 Qwen3TTSLocalPanel 迁移到 EngineInstallModal ✅
- [x] 3.4 Qwen3TTSLocalPanel 迁移到 EngineInstallModal ✅
- [x] 3.5 EngineInstallModal 添加 QWEN3TTS 预设配置 ✅
- [x] 3.7 onCancel 改为可选参数 ✅

## Phase 4: 后端安装逻辑适配
- [x] 4.1 Python 复用检测 ✅ (后端已有 findPythonWithTorch / checkInstallStatus.hasPython)
- [x] 4.2 CPU/GPU 变体安装 ✅ (Demucs 已支持 torchVariant 参数)
- [x] 4.3 TTS 安装使用专用 IPC ✅ (qwen-tts-local:install 替代 env:install-deps)
- [ ] 4.4 Whisper 模型选择安装 (延后: 仍使用旧 DownloadModal)

## 已完成文件变更清单

### 共享组件
- `src/components/shared/EngineInstallModal.tsx` — 统一安装弹窗 + 7 个预设配置 + onCancel 可选
- `src/components/environment/EnvironmentSetupModal.tsx` — @deprecated 标记
- `src/features/toolbox/speech-to-text/components/DownloadModal.tsx` — @deprecated 标记

### ASR 引擎标记
- `src/features/toolbox/speech-to-text/components/Sidebar.tsx` — "需安装" 标签
- `src/features/toolbox/video-translation/VideoTranslation.tsx` — "需安装" tag + warning variant
- `src/features/toolbox/video-translation/VideoTranslation.css` — warning tag 样式
- `src/features/toolbox/video-translation/components/VtSelect.tsx` — tagVariant 支持
- `src/features/toolbox/video-analysis/components/ConfigPanel.tsx` — 区分 "需安装"/"需配置"

### TTS 面板迁移
- `src/features/toolbox/text-to-speech/engines/Qwen3TTSLocalPanel.tsx` — EngineInstallModal + 专用 IPC
