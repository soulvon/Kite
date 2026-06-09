# 视频模板系统修复计划

> 基于两次审查结果，分 4 批修复所有问题

## 批次概览

| 批次    | 内容        | 优先级 | 预计改动文件数 |
| ------- | ----------- | ------ | -------------- |
| Batch 1 | P0 严重问题 | 🔴 最高 | 3              |
| Batch 2 | P1 功能问题 | 🟡 高   | 3              |
| Batch 3 | P2 健壮性   | 🟢 中   | 4              |
| Batch 4 | P3 代码卫生 | ⚪ 低   | 6+             |

---

## Batch 1: P0 严重问题 🔴

### 1.1 "导出视频"按钮逻辑错误
- **文件**: `src/features/templates/components/storyboard/StoryboardView.tsx`
- **问题**: L285-293 "导出视频"按钮调用 `handleOpenInEditor`，应直接触发视频导出
- **修复**: 创建 `handleExportVideo` 方法，调用 applyTemplate → 设置 project → 触发导出
- **状态**: [ ] 待修复

### 1.2 slotIndex 冲突静默覆盖
- **文件**: `src/features/templates/services/TemplateSceneExtractor.ts`
- **问题**: 手动 `templateSlot.index` 可能与自动递增的 `mediaSlotIndex` 冲突
- **修复**: 在 extractScenes 末尾添加 slotIndex 重复检测，发现重复则 console.warn 并自动重新编号
- **状态**: [ ] 待修复

---

## Batch 2: P1 功能问题 🟡

### 2.1 scene.id 每次重新生成导致选中状态丢失
- **文件**: `src/features/templates/services/TemplateSceneExtractor.ts`
- **问题**: nanoid(8) 每次生成不同 ID，导致 selectedSceneId 在重新提取后失效
- **修复**: 用确定性 hash（基于 clipId + order）代替 nanoid 生成 scene.id 和 slot.id
- **状态**: [ ] 待修复

### 2.2 countAudioSlots 统计不准确
- **文件**: `src/features/templates/services/TemplateManager.ts`
- **问题**: L239-247 统计所有音频轨道 clip，而非仅有 templateSlot 标记的
- **修复**: 改为只统计有 `clip.templateSlot` 的音频 clip，与 countMediaSlots/countTextSlots 对称
- **状态**: [ ] 待修复

### 2.3 duration 重复字段
- **文件**: `src/features/templates/types/template.ts`
- **问题**: `preview.duration` 和 `slots.totalDuration` 重复
- **修复**: 将 `slots.totalDuration` 标记为 @deprecated，UI 统一读 `preview.duration`
- **状态**: [ ] 待修复

---

## Batch 3: P2 健壮性 🟢

### 3.1 video 元素内存泄漏
- **文件**: `src/features/templates/components/SlotFillerPanel.tsx`, `src/features/templates/components/storyboard/SceneEditor.tsx`
- **问题**: 视频时长探测创建的 video 元素未设置 `video.src = ''` 清理
- **修复**: 在 useEffect 的 cleanup 中添加 `video.src = ''; video.load()`
- **状态**: [ ] 待修复

### 3.2 TemplateSlotResolver 类型安全
- **文件**: `src/features/templates/services/TemplateSlotResolver.ts`
- **问题**: L207, L220, L269 使用 `as any` 强转
- **修复**: 检查 EditorProject 和 Clip 类型定义，添加缺失的字段声明，移除 as any
- **状态**: [ ] 待修复

### 3.3 TemplatePackageService hash 改进
- **文件**: `electron/services/templatePackage/TemplatePackageService.ts`
- **问题**: hashPath 基于路径而非内容
- **修复**: 改为 hash(path + size + mtime)，增加唯一性
- **状态**: [ ] 待修复

---

## Batch 4: P3 代码卫生 ⚪

### 4.1 SCENE_COLORS 重复 3 次
- **修复**: 提取到 `src/features/templates/constants.ts`
- **涉及**: SlotFillerPanel.tsx, SceneCard.tsx, SceneEditor.tsx
- **状态**: [ ] 待修复

### 4.2 格式化函数重复 5+ 次
- **修复**: 统一到 TemplateSceneExtractor.formatTime 或新建 utils
- **涉及**: SlotFillerPanel.tsx, SceneCard.tsx, SceneEditor.tsx, StoryboardView.tsx, TemplateEditorView.tsx
- **状态**: [ ] 待修复

### 4.3 清理废弃代码
- **修复**: 
  - 移除 TemplateCategory type (template.ts L10-11)
  - 移除 TemplatePackager 中两个 @deprecated 方法
- **状态**: [ ] 待修复

### 4.4 TODO 占位符标注
- **修复**: 给 AI 文案生成/润色按钮添加 toast 提示"功能开发中"，而非静默无响应
- **涉及**: SlotFillerPanel.tsx, SceneEditor.tsx
- **状态**: [ ] 待修复

---

## 执行记录

| 批次    | 开始时间 | 完成时间 | 状态   |
| ------- | -------- | -------- | ------ |
| Batch 1 |          |          | 待开始 |
| Batch 2 |          |          | 待开始 |
| Batch 3 |          |          | 待开始 |
| Batch 4 |          |          | 待开始 |
