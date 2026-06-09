# WhisperX 集成实现计划

> **目标**: 将 WhisperX (含 faster-whisper) 作为 B 类 Python AI 引擎集成到 GenStudio，替代现有 whisper.cpp (A 类) 实现，提供字级强制对齐 + 说话人分离能力。

## 一、架构决策

| 决策项           | 方案                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| **替代还是并存** | 并存。whisper.cpp 保留为"轻量离线"选项，WhisperX 新增为"高精度"选项                 |
| **引擎 ID**      | `whisperx` (区别于现有 `local-whisper`)                                             |
| **安装类型**     | B 类 (Python AI Engine) — 同 FunASR/QwenTTS 模式                                    |
| **共享 Python**  | ✅ 共享 `python-libs/`，PyTorch 不重复安装                                           |
| **说话人分离**   | 首版不做。pyannote.audio 需要 HuggingFace token + 受限模型，UX 太复杂。后续版本可加 |
| **核心能力**     | faster-whisper 转录 + WhisperX 强制对齐 + VAD                                       |

## 二、依赖分析

### pip 包
```
faster-whisper    # CTranslate2 推理引擎
whisperx          # 强制对齐 + VAD + 批处理
ctranslate2       # faster-whisper 后端 (会自动装)
transformers      # Wav2Vec2 对齐模型 (已有，FunASR 共享)
nltk              # WhisperX 依赖
```

### 共享依赖 (已有)
```
torch / torchaudio    # PyTorch (python-libs/ 已有)
numpy                 # 基础库 (已有)
transformers          # FunASR 已装
```

### 增量磁盘
- pip 包增量: ~200 MB (faster-whisper + whisperx + ctranslate2)
- 模型: large-v3 ~3 GB, base ~150 MB, small ~500 MB
- 对齐模型: Wav2Vec2 ~1 GB (按语言自动下载)

## 三、文件清单

### 后端 (6 个文件)

| #   | 文件                                                     | 职责                                      | 参考                    |
| --- | -------------------------------------------------------- | ----------------------------------------- | ----------------------- |
| 1   | `electron/services/whisperX/WhisperXInstaller.ts`        | B 类安装器: pip install + 模型下载 + 验证 | FunASRInstaller.ts      |
| 2   | `electron/services/whisperX/WhisperXProvider.ts`         | ASR Provider: 对接 ASRService 的标准接口  | LocalWhisperProvider.ts |
| 3   | `electron/services/whisperX/scripts/whisperx_worker.py`  | Python 工作脚本: 加载模型 + 转录 + 对齐   | funasr_transcribe.py    |
| 4   | `electron/services/whisperX/types.ts`                    | 类型定义                                  | —                       |
| 5   | `electron/services/environment/UnifiedInstallService.ts` | 新增 `whisperx` target                    | 已有文件追加            |
| 6   | `electron/services/asr/ASRService.ts`                    | 注册 WhisperXProvider                     | 已有文件追加            |

### 前端 (2 个文件)

| #   | 文件                                                         | 职责                         |
| --- | ------------------------------------------------------------ | ---------------------------- |
| 7   | `src/components/shared/EnvironmentInstallModal.tsx`          | 新增 WHISPERX_INSTALL_CONFIG |
| 8   | `electron/services/environment/FeatureDependencyRegistry.ts` | 注册 whisperx 依赖           |

### 文档 (1 个文件)

| #   | 文件                                           | 职责                   |
| --- | ---------------------------------------------- | ---------------------- |
| 9   | `spec/60-02 统一安装流程规范(INSTALL_FLOW).md` | B 类增加 WhisperX 条目 |

## 四、分步实现

### Phase 1: 后端安装器 ⬜

**WhisperXInstaller.ts** — 标准 B 类安装器

五阶段:
1. **检查环境** (0-10%): Python 存在性 → uv/pip 可用性
2. **安装依赖** (10-50%): PyTorch (如已有则跳过) → faster-whisper → whisperx
3. **下载模型** (50-90%): 按用户选择下载 base/small/medium/large-v3
4. **验证安装** (90-98%): `python -c "import whisperx; ..."`
5. **完成** (100%): markAvailable

特性:
- `cancelled` 标志 + 阶段间检查
- 镜像测速 → pip install 使用最快源
- uv 优先, pip 兜底
- 进度: onProgress({ percent, message, detailMessage, stage })
- 模型下载通过 Python 脚本触发 HuggingFace 下载

### Phase 2: Python Worker 脚本 ⬜

**whisperx_worker.py** — 转录 + 对齐

```python
# 输入: audio_path, model_size, language, compute_type, device
# 输出: JSON { segments: [{ start, end, text, words: [{ word, start, end }] }] }
#
# Pipeline:
# 1. whisperx.load_model(model_size, device, compute_type)
# 2. audio = whisperx.load_audio(audio_path)
# 3. result = model.transcribe(audio, batch_size=16)
# 4. model_a, metadata = whisperx.load_align_model(language_code, device)
# 5. result = whisperx.align(result["segments"], model_a, metadata, audio, device)
# 6. print(json.dumps(result))
```

### Phase 3: ASR Provider ⬜

**WhisperXProvider.ts** — 对接 ASRService

- id: `whisperx`
- name: `WhisperX (高精度)`
- transcribe(): 调用 whisperx_worker.py
- getModels(): 返回 base/small/medium/large-v3 列表 (查本地文件判断是否已下载)
- checkAvailability(): 检查 Python + whisperx 包 + 模型

### Phase 4: 注册 + 前端 ⬜

1. **UnifiedInstallService**: 新增 `whisperx` target (同 FunASR 模式)
2. **ASRService**: registerProvider(new WhisperXProvider())
3. **FeatureDependencyRegistry**: 注册 whisperx 依赖
4. **EnvironmentInstallModal**: 新增 WHISPERX_INSTALL_CONFIG
   - CPU / GPU 变体选择
   - 模型选择 (base 必选, small/medium/large-v3 可选)
   - showPythonReuse: true

### Phase 5: 文档 ⬜

- 60-02 规范: B 类对照表新增 WhisperX

## 五、安装配置预览

```typescript
export const WHISPERX_INSTALL_CONFIG: EngineInstallConfig = {
  title: '安装 WhisperX 引擎',
  description: 'WhisperX 是基于 faster-whisper 的高精度语音识别引擎，支持字级时间戳对齐和 99 种语言。',
  features: [
    '🎯 毫秒级字级时间戳（强制对齐）',
    '🌍 支持 99 种语言',
    '⚡ 70 倍实时速度（GPU）',
    '🔒 离线运行，隐私安全',
  ],
  showPythonReuse: true,
  variants: [
    { id: 'cpu', label: 'CPU 模式', description: '兼容性好，无需显卡', size: '约 2 GB', default: true },
    { id: 'gpu', label: 'GPU 加速', description: 'Nvidia 显卡加速，推荐 8GB+ 显存', size: '约 4 GB' },
  ],
  models: [
    { id: 'base', label: 'Base 模型', size: '150 MB', description: '速度快，适合快速预览', default: true, required: true },
    { id: 'small', label: 'Small 模型', size: '500 MB', description: '精度较高，推荐日常使用' },
    { id: 'medium', label: 'Medium 模型', size: '1.5 GB', description: '高精度，速度适中' },
    { id: 'large-v3', label: 'Large-v3 模型', size: '3 GB', description: '最高精度，需要较好配置' },
  ],
  stages: [
    { label: '检查环境', range: [0, 9] },
    { label: '安装 WhisperX 依赖', range: [10, 49] },
    { label: '下载模型', range: [50, 92] },
    { label: '验证安装', range: [93, 100] },
  ],
  installTimeHint: '首次安装约 5-15 分钟',
  doneTitle: '安装完成',
  doneDescription: 'WhisperX 已准备就绪，支持 99 种语言和毫秒级字级时间戳',
};
```

## 六、风险与注意

| 风险                                | 缓解                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| whisperx 从 GitHub 安装 (不在 PyPI) | 用 `pip install git+https://github.com/m-bain/whisperx.git`，或 fork 发布到 PyPI |
| 对齐模型按语言自动下载              | 首次转录时自动下载 Wav2Vec2，需提示用户                                          |
| 显存不足 OOM                        | 检测显存，自动切换 int8/CPU                                                      |
| 大模型下载慢                        | 走 HuggingFace 镜像 (hf-mirror.com)                                              |
| pyannote 需要 HF token              | 首版不做说话人分离，后续再加                                                     |

## 七、验收标准

- [ ] `pip install whisperx` 通过安装弹窗一键完成
- [ ] CPU/GPU 变体正确安装
- [ ] base/small/medium/large-v3 模型可选下载
- [ ] 转录输出包含字级时间戳 `words: [{ word, start, end }]`
- [ ] 安装进度实时更新，可取消
- [ ] 已有 Python/PyTorch 时不重复安装
- [ ] 安装后验证通过，引擎状态变为 `available`
