# 视频分析脚本

两个独立的视频分析脚本，使用 Gemini API 通过 Antigravity 代理分析视频内容。

## 📦 安装依赖

### Python 版本
```bash
pip install google-generativeai
```

### Node.js 版本
```bash
npm install @google/generative-ai
# 或
pnpm add @google/generative-ai
```

## 🚀 使用方法

### Python 脚本

```bash
# 基本用法（使用默认提示词）
python analyze_video.py video.mp4

# 自定义提示词
python analyze_video.py video.mp4 "分析这个视频的剪辑节奏和配乐"

# 详细分析
python analyze_video.py tutorial.mp4 "这是一个教程视频，请提取关键步骤和讲解要点"
```

### Node.js 脚本

```bash
# 基本用法（使用默认提示词）
node analyze_video.js video.mp4

# 自定义提示词
node analyze_video.js video.mp4 "分析这个视频的剪辑节奏和配乐"

# 详细分析
node analyze_video.js tutorial.mp4 "这是一个教程视频，请提取关键步骤和讲解要点"
```

## ⚙️ 配置说明

在脚本开头可以修改以下配置：

```python
# Python
API_KEY = "你的API密钥"
API_ENDPOINT = "http://127.0.0.1:8045"  # Antigravity 代理地址
MODEL_NAME = "gemini-3-pro-high"
DEFAULT_PROMPT = "默认提示词"
```

```javascript
// Node.js
const API_KEY = "你的API密钥";
const API_ENDPOINT = "http://127.0.0.1:8045";  // Antigravity 代理地址
const MODEL_NAME = "gemini-3-pro-high";
const DEFAULT_PROMPT = "默认提示词";
```

## 📝 支持的视频格式

- `.mp4` (推荐)
- `.webm`
- `.mov`
- `.avi`
- `.mkv`
- `.flv`
- `.3gp`
- `.m4v`

## 🔧 在其他项目中使用

### Python 模块导入

```python
from analyze_video import analyze_video

result = analyze_video("path/to/video.mp4", "你的提示词")
print(result)
```

### Node.js 模块导入

```javascript
const { analyzeVideo } = require('./analyze_video.js');

analyzeVideo('path/to/video.mp4', '你的提示词')
    .then(result => console.log(result))
    .catch(error => console.error(error));
```

## ⚠️ 注意事项

1. **确保 GenStudio 应用正在运行**（Antigravity 代理才可用）
2. **大文件处理**：视频会被完整读入内存并转为 Base64，超大视频可能占用较多内存
3. **网络连接**：需要能访问配置的 API 端点
4. **API 配额**：注意 Gemini API 的使用配额限制

## 🎯 常见用途

- 视频内容分析
- 创作流程提取
- 剪辑技巧识别
- 教程步骤提取
- 字幕/台词生成
- 视频质量评估
