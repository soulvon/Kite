---
name: 视频理解
description: 视频内容理解与解析。当用户提供视频文件路径或视频链接（YouTube、Bilibili 等），需要理解、分析、总结视频内容时使用。触发词：视频理解、分析视频、看看这个视频、视频内容、帮我看视频、这个视频讲了什么
---

# 视频理解

通过 Google Gemini 解析视频内容，支持本地文件和在线链接。

## 方案选择

提供三种方案，按优先级选择：

| 方案                        | 前提条件                                       | 优点                           | 脚本                                    |
| --------------------------- | ---------------------------------------------- | ------------------------------ | --------------------------------------- |
| **A. 网页逆向 API**（首选） | 浏览器已登录 gemini.google.com + 能获取 Cookie | 免费，无需 API Key，支持大文件 | `analyze_video_web.py`                  |
| **B. 官方 SDK API**         | 需要 Google AI Studio API Key                  | 稳定，官方支持                 | `analyze_video.py` / `analyze_video.ts` |
| **C. 浏览器粘贴**           | 浏览器已登录 gemini.google.com                 | 最后的备选                     | 通过 `browser_subagent`                 |

## 总体工作流程

```
用户提供视频 → 判断来源类型
  ├─ 本地文件路径 → 可选: 中文重命名 → 选择方案执行分析
  └─ 视频链接 URL → 下载视频 → 选择方案执行分析
```

---

## 前置步骤（通用）

### 下载视频（仅限 URL）

判断依据：包含 `http://`、`https://`、`youtu`、`bilibili`、`b23.tv` 等 → 视为链接。

```powershell
python "<skill_dir>/scripts/download_video.py" "<video_url>" --max-height 720
```

- `<skill_dir>` 替换为本技能的实际绝对路径（即 SKILL.md 所在目录）
- 脚本会自动安装 yt-dlp（如未安装）
- 输出最后一行 `FILE_PATH=<path>` 即为下载后的文件路径

### 处理中文文件名

如果文件名包含中文或特殊字符，先复制为纯英文文件名：

```powershell
Copy-Item "<原始路径>" -Destination "$env:TEMP\video_analysis_input.mp4" -Force
```

---

## 方案 A：网页逆向 API（首选 ⭐）

原理：模拟 gemini.google.com 的浏览器行为，通过 Gemini 内部 API 上传视频并分析。
参考实现：[gemini-nexus](https://github.com/yeahhe365/gemini-nexus) 的 Web Client 方案。

### 获取 Cookie

**方法 1：从浏览器获取**

指引用户：
1. 在浏览器中打开 [gemini.google.com](https://gemini.google.com) 并确保已登录
2. 按 F12 打开开发者工具 → Network 标签
3. 刷新页面，点击任意请求
4. 在 Request Headers 中找到 `Cookie` 行，复制完整内容
5. 保存到文件（如 `cookie.txt`）

**方法 2：重点 Cookie 字段**

如果完整 Cookie 太长，至少需要以下字段：
- `__Secure-1PSID` — 主认证 Token
- `__Secure-1PSIDTS` — 时间戳签名
- `__Secure-1PSIDCC` — 辅助认证

### 执行分析

```powershell
# 基本用法
python "<skill_dir>/scripts/analyze_video_web.py" "<视频路径>" --cookie-file "<cookie文件路径>"

# 指定模型
python "<skill_dir>/scripts/analyze_video_web.py" "<视频路径>" --cookie-file "<cookie文件路径>" --model gemini-3-pro

# 直接传 Cookie 字符串
python "<skill_dir>/scripts/analyze_video_web.py" "<视频路径>" --cookie "<cookie字符串>"

# 自定义 Prompt
python "<skill_dir>/scripts/analyze_video_web.py" "<视频路径>" --cookie-file "<cookie文件路径>" --prompt "描述视频中的 UI 设计"
```

**模型选项：**
- `gemini-3-flash` — 默认，快速
- `gemini-3-flash-thinking` — 带思考过程，更深度分析
- `gemini-3-pro` — Pro 模型，最强能力

### 内部工作原理

```
1. 请求 gemini.google.com/app → 从 HTML 提取 SNlM0e (CSRF) 和 cfb2h (版本号)
2. Resumable Upload 上传视频到 content-push.googleapis.com
   - POST start → 获取 X-Goog-Upload-URL
   - POST upload+finalize → 传输二进制数据 → 获取文件标识符
3. POST BardFrontendService/StreamGenerate
   - Body: at={CSRF}&f.req={嵌套JSON: [消息, null, [对话上下文]]}
   - Header: x-goog-ext-525001261-jspb 选择模型
4. 解析流式嵌套 JSON 响应
   - 去掉 )]}' 反劫持前缀
   - 两层 JSON.parse
   - payload[4][0][1][0] → 文本
   - payload[4][0][37][0][0] → 思考过程
```

---

## 方案 B：官方 SDK API

需要 Google AI Studio 的 API Key。

### Python 版本

```powershell
# 安装依赖
pip install google-generativeai

# 执行（使用 Google 官方 API）
python "<skill_dir>/scripts/analyze_video.py" "<视频路径>" --api-key "<API_KEY>"

# 通过代理
python "<skill_dir>/scripts/analyze_video.py" "<视频路径>" --api-key "<API_KEY>" --base-url "https://代理地址"
```

### TypeScript 版本

```powershell
# 安装依赖（在技能目录下）
cd "<skill_dir>/scripts" && npm install @google/generative-ai

# 执行
npx tsx "<skill_dir>/scripts/analyze_video.ts" "<视频路径>" --api-key "<API_KEY>"
```

---

## 方案 C：浏览器粘贴（备选）

当方案 A 和 B 都不可用时（无法获取 Cookie 也没有 API Key），使用此方案。

### Step 1: 复制文件到系统剪贴板

```powershell
Add-Type -AssemblyName System.Windows.Forms
$files = New-Object System.Collections.Specialized.StringCollection
$files.Add("<视频文件绝对路径>")
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
```

### Step 2: 浏览器粘贴到 Gemini

使用 `browser_subagent` 工具，通过 **Ctrl+V 粘贴** 方式上传文件。

**browser_subagent 调用参数：**
- **TaskName**: `Upload Video to Gemini`
- **RecordingName**: `video_analysis`
- **Task** 内容模板（替换 `{{PROMPT}}`）：

```
你的任务是在 Google Gemini 中通过粘贴方式上传视频并获取分析结果。
文件已通过 PowerShell 复制到系统剪贴板。

重要：只在 gemini.google.com 操作，绝对不要去 aistudio.google.com！

步骤：
1. 导航到 https://gemini.google.com/app
2. 等待页面加载完成
3. 如果看到登录页面，返回 "NEED_LOGIN"

4. 点击聊天输入框（页面底部的文本输入区域），确保获得焦点
5. 按 Ctrl+V 粘贴文件
6. 等待 5-10 秒，观察文件上传进度/缩略图出现

7. 如果文件成功上传：
   - 通过 JavaScript 在输入框中写入分析 prompt：
   ```javascript
   const editor = document.querySelector('.ql-editor') || document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
   if (editor) {
     editor.focus();
     editor.textContent = '{{PROMPT}}';
     editor.dispatchEvent(new Event('input', { bubbles: true }));
   }
   ```
   - 点击发送按钮（➤ 图标）

8. 等待 Gemini 响应完全生成（可能 2-3 分钟，每 20 秒检查一次）
9. 通过 JavaScript 读取响应文本并返回

返回格式：
- 成功: "SUCCESS\n---\n" + 完整分析结果
- 登录: "NEED_LOGIN"
- 粘贴失败: "PASTE_FAILED\n---\n<详情>"
- 错误: "ERROR\n---\n<描述>"
```

---

## 默认分析 Prompt

当用户没有指定具体分析需求时，使用以下 prompt：

```
请全面分析这个视频：
1. 内容概要：视频主题和主要内容
2. 关键场景：列出关键场景/片段及大致时间点
3. 视觉元素：重要的视觉元素（UI界面、文字、图形、人物等）
4. 语音内容：对话、旁白或重要音频内容摘要
5. 技术细节：视频质量、风格、转场等制作技巧
6. 核心要点：主要结论或关键信息
请用中文回复。
```

如果用户有具体需求（如"看看UI设计"、"提取操作步骤"），根据需求定制 prompt。

## 内置工具

| 工具                   | 路径                           | 用途                                          |
| ---------------------- | ------------------------------ | --------------------------------------------- |
| 网页逆向分析脚本       | `scripts/analyze_video_web.py` | 通过 Gemini 网页 API 分析视频（无需 API Key） |
| 官方 SDK 脚本 (Python) | `scripts/analyze_video.py`     | 通过 Gemini File API 分析视频                 |
| 官方 SDK 脚本 (TS)     | `scripts/analyze_video.ts`     | 同上，TypeScript 版本                         |
| 视频下载脚本           | `scripts/download_video.py`    | 从 URL 下载视频，自动安装 yt-dlp              |

## 约束与限制

| 项目          | 限制                                 |
| ------------- | ------------------------------------ |
| 文件大小      | 最大约 2GB                           |
| 视频时长      | 含音频 ≤45min，纯视频 ≤1h            |
| 支持格式      | MP4, WEBM, MOV, MPEG, MPG, WMV       |
| Cookie 有效期 | 通常几小时到几天，过期需重新获取     |
| 文件名        | 建议纯英文路径，中文文件名需先重命名 |

## 故障处理

| 问题             | 方案                                                    |
| ---------------- | ------------------------------------------------------- |
| Cookie 过期      | 重新从浏览器获取 Cookie                                 |
| "未登录" 错误    | 确认浏览器已登录 gemini.google.com，重新获取 Cookie     |
| SNlM0e 提取失败  | Cookie 格式不正确，确保包含 `__Secure-1PSID` 等关键字段 |
| 上传超时         | 视频太大，尝试降低分辨率: `--max-height 480`            |
| yt-dlp 下载失败  | 检查网络/代理，或让用户手动下载后提供本地路径           |
| 视频太大（>2GB） | 用下载脚本 `--max-height 480` 降低分辨率                |
| 分析不够深入     | 使用 `--model gemini-3-pro` 或定制更具体的 prompt       |
