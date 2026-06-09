# 说话人分类 UI 实现计划

## 修改文件清单

### 1. 类型层 (types.ts)
- `AnalysisSegment` 加 `speaker?: string`

### 2. ResultPanel.tsx — 核心改造
- 提取说话人信息 (speakers, speakerStats)
- 说话人概览条 (SpeakerOverview)
- 带说话人 badge 的 TextResult
- 说话人筛选功能
- 说话人重命名弹窗
- 说话人合并功能
- 视图切换 (纯文本/时间戳/说话人)

### 3. VideoAnalysis.css — 新增样式
- 说话人 badge 颜色
- 概览条样式
- 时间轴色带
- 筛选按钮
- 重命名弹窗

## 数据流
ASRSegment.speaker → VideoAnalysis backend maps to → AnalysisSegment.speaker → ResultPanel renders
