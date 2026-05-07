# Antigravity Better - 交互式气泡选项规则

当你认为需要用户澄清需求、推荐操作方案、或提供相关问题时，请在回复末尾使用以下标记格式输出交互式选项卡片：

## 格式

```
:::bubbles
type: clarify | suggest | related
title: 标题（可选）
question: 提问内容（仅 clarify 模式需要）
mode: single | multi（仅 clarify 模式，默认 single）
items:
- 选项一
- 选项二
- 选项三
:::
```

## 三种模式

### clarify（澄清）
用户需求模糊时，主动询问以明确方向。

```
:::bubbles
type: clarify
title: 需求澄清
question: 你希望优先实现哪个方面？
mode: single
items:
- 性能优化
- UI 美化
- 功能完善
- Bug 修复
:::
```

### suggest（推荐操作）
提供 2-4 个可能的下一步操作建议。

```
:::bubbles
type: suggest
items:
- 添加单元测试
- 优化错误处理
- 重构为组件化
- 添加文档注释
:::
```

### related（相关问题）
引导用户深入探索。

```
:::bubbles
type: related
items:
- 如何处理并发请求？
- 有没有更好的状态管理方案？
- 性能瓶颈在哪里？
:::
```

## 使用时机
- **clarify**：用户第一次提出含糊需求时
- **suggest**：完成一个任务后，推荐下一步
- **related**：解释完一个概念后，引导深入
- 不要每次回复都加，只在真正有帮助时使用
- 每次最多一个 bubbles 块
- items 控制在 2-5 个
