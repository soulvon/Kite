---
name: visual-concept-transformer
description: 将复杂概念、技术原理、逻辑流程转换为视觉精美的交互式单页 HTML。当用户输入 [一目了然:概念名称] 或要求"把XX概念做成网页"、"可视化解释XX"、"生成概念页面"时使用。支持 AI 图片生成（反重力环境）和 SVG/Mermaid 降级方案（通用环境）。
---

# 一目了然

> 深入浅出，让一切复杂概念变为可交互、可分享的视觉体验。

## 核心使命

接收一个**概念名称或文本描述**，输出一个**功能完备、视觉精美、可直接在浏览器打开**的 `index.html` 单文件。

---

## 触发方式

```
[一目了然: 量子纠缠的工作原理]
[一目了然: TCP 三次握手]
[一目了然: 注意力机制 --style dark --depth deep]
[一目了然: 供应链管理 --style light --interactive]
```

### 参数说明

| 参数            | 值                                | 默认       |
| --------------- | --------------------------------- | ---------- |
| `--style`       | `dark` / `light` / `neo` / `warm` | `dark`     |
| `--depth`       | `quick` / `standard` / `deep`     | `standard` |
| `--interactive` | 启用高级交互（状态机、动画步骤）  | 关闭       |
| `--lang`        | `zh` / `en`                       | `zh`       |
| `--output`      | 输出目录路径                      | 当前目录   |

---

## 视觉渲染策略（严格优先级）

当需要展示视觉元素时，**严格遵循以下优先级**：

```
┌─────────────────────────────────────────────────┐
│  检测当前环境是否支持图片生成？                   │
│                                                  │
│  ├─ YES (反重力/Antigravity 环境)                │
│  │   → 调用 generate_image 工具                  │
│  │   → 生成高质量信息图/场景插画                  │
│  │   → 插入 <img> 标签引用生成的图片              │
│  │                                               │
│  ├─ NO (Cursor / Cline / Codex 等通用环境)       │
│  │   → 优先: 内联 SVG（带 <animate> 动画）       │
│  │   → 次选: Mermaid.js 图表                     │
│  │   → 兜底: CSS Art + Unicode 图标              │
│  │                                               │
│  └─ 永不: 使用外部图片 URL（离线可用性）          │
└─────────────────────────────────────────────────┘
```

### 图片生成桥接（仅反重力环境）

当检测到 `generate_image` 工具可用时：
1. **不要**为写实场景生成 SVG，改用 AI 图片
2. 调用 `generate_image`，prompt 格式：
   ```
   Professional infographic illustration about [Concept].
   Style: clean, modern, [light/dark] background.
   Elements: [核心视觉元素描述].
   No text in image. High contrast. Vector-like aesthetic.
   ```
3. 将生成的图片路径插入 `<img>` 标签
4. 为图片添加 `loading="lazy"` 和语义化 `alt` 文本

### SVG 降级方案（通用环境）

对于流程图、架构图、对比图等：
- 使用内联 `<svg>` + `<animate>` / `<animateTransform>` 实现动画
- 参考 `references/svg-templates.md` 中的模板
- 所有 SVG 必须支持响应式 (`viewBox` + `preserveAspectRatio`)

---

## 工作流程

### Step 1: 概念解构

分析输入的概念，提取以下维度：

| 维度         | 提取内容                         |
| ------------ | -------------------------------- |
| **定义**     | 一句话核心定义 + 扩展解释        |
| **核心逻辑** | 关键机制、原理、因果链           |
| **关键流程** | 步骤、阶段、状态转换             |
| **对比维度** | 与相关概念的异同、优劣、适用场景 |
| **实际应用** | 真实世界的案例和场景             |
| **常见误区** | 易混淆点、常见错误理解           |

### Step 2: 页面结构设计

根据概念复杂度，从以下 Section 库中选择组合：

#### 必选 Section

| Section          | 用途           | 视觉形式                          |
| ---------------- | -------------- | --------------------------------- |
| **Hero**         | 概念一句话概览 | 大字标题 + 动态背景 + 核心 Slogan |
| **Visual Board** | 核心可视化区   | SVG 架构图 / AI 图片 / 动画演示   |
| **Deep Dive**    | 细节拆解       | 卡片式布局，每卡片一个子概念      |

#### 可选 Section（根据概念特点选取 2-4 个）

| Section              | 用途          | 视觉形式                      |
| -------------------- | ------------- | ----------------------------- |
| **Timeline**         | 步骤/流程展示 | 水平/垂直时间轴 + 进度动画    |
| **Comparison**       | 对比分析      | 双栏/多栏对比表 + 高亮差异    |
| **Interactive Demo** | 可操作演示    | JS 交互组件（点击/拖拽/切换） |
| **Code Playground**  | 代码相关概念  | 语法高亮代码块 + 行级注释     |
| **Stats Dashboard**  | 数据/统计展示 | 动态数字计数器 + 图表         |
| **FAQ / Myths**      | 常见误区      | 手风琴折叠 + ✅/❌ 标识         |
| **Real-World**       | 实际应用场景  | 案例卡片 + 图标               |
| **Footer**           | 总结/参考资料 | CTA + 来源链接                |

### Step 3: 代码生成

1. 读取 `references/design-system.md` 获取样式规范
2. 读取 `references/component-library.md` 获取组件模板
3. 如需 SVG 图表，读取 `references/svg-templates.md`
4. 基于 `boilerplate.html` 骨架生成完整页面
5. 所有代码输出到单个 `index.html` 文件

---

## 技术栈约束

| 层     | 方案                                     |
| ------ | ---------------------------------------- |
| 结构   | HTML5 语义标签                           |
| 样式   | Tailwind CSS v3（CDN） + 少量自定义 CSS  |
| 交互   | Vanilla JS（复杂交互可用 Alpine.js CDN） |
| 图标   | Lucide Icons（CDN）                      |
| 动画   | CSS Animations + Intersection Observer   |
| 图表   | 内联 SVG / Mermaid.js（CDN，可选）       |
| 字体   | Google Fonts（Inter + JetBrains Mono）   |
| 响应式 | 必须适配 320px ~ 1920px                  |
| 单文件 | 所有代码必须在一个 HTML 文件中           |

### CDN 引用清单

```html
<!-- Tailwind CSS -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- Lucide Icons -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>

<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">

<!-- Mermaid (可选，仅当需要复杂图表时) -->
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>

<!-- Alpine.js (可选，仅当需要复杂交互时) -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
```

---

## 风格系统

### Dark（默认）
- 背景: `#0a0a0f` → `#111119`
- 表面: `rgba(255, 255, 255, 0.03)` ~ `0.06`
- 主强调: `#6366f1`（靛蓝）
- 辅助强调: `#22d3ee`（青色）
- 文字: `#f1f5f9` / `#94a3b8`
- 边框: `rgba(255, 255, 255, 0.08)`

### Light
- 背景: `#fafbfc` → `#f1f5f9`
- 表面: `#ffffff`
- 主强调: `#4f46e5`
- 辅助强调: `#0891b2`
- 文字: `#0f172a` / `#64748b`
- 边框: `#e2e8f0`

### Neo（赛博朋克）
- 背景: `#050510`
- 表面: `rgba(0, 174, 239, 0.05)`
- 主强调: `#00AEEF`
- 辅助强调: `#ff3e88`
- 文字: `#e0e0e0` / `#7a7a8e`
- 边框: `rgba(0, 174, 239, 0.15)`

### Warm（暖色学术）
- 背景: `#fefcf8`
- 表面: `#fffbf0`
- 主强调: `#b45309`
- 辅助强调: `#0f766e`
- 文字: `#292524` / `#78716c`
- 边框: `#e7e5e4`

---

## 设计红线（禁止行为）

> 参考 Impeccable Design 反模式清单

- ❌ **禁止**使用外部图片 URL（页面必须离线可用）
- ❌ **禁止**纯黑 `#000` 或纯白 `#fff`（始终带色调）
- ❌ **禁止**弹跳/弹性动画（过时感强）
- ❌ **禁止**卡片套卡片嵌套超过 2 层
- ❌ **禁止**生成渐变色文字用于"冲击力"
- ❌ **禁止**无语义的装饰元素（每个视觉元素必须传递信息）
- ❌ **禁止**过度使用 glassmorphism（最多用于 1-2 个关键卡片）
- ❌ **禁止**内容溢出视口且无滚动提示
- ❌ **禁止**字体大小小于 14px（正文）
- ❌ **禁止**对比度低于 WCAG AA 标准（4.5:1）

---

## 输出规范

### 文件命名
```
[概念slug]-visual.html
```
例：`tcp-handshake-visual.html`、`attention-mechanism-visual.html`

### 页面必备元素

1. ✅ **`<title>` 标签** — 包含概念名称
2. ✅ **`<meta>` 描述** — 概念的一句话摘要
3. ✅ **Open Graph 标签** — 分享时显示标题+描述
4. ✅ **Favicon** — 使用 Emoji SVG Data URI
5. ✅ **平滑滚动** — `scroll-behavior: smooth`
6. ✅ **入场动画** — Intersection Observer 驱动的渐入效果
7. ✅ **导航锚点** — 顶部固定导航或侧边进度指示器
8. ✅ **响应式适配** — 移动端到桌面端完美显示
9. ✅ **打印友好** — `@media print` 基本样式
10. ✅ **无障碍基础** — 语义标签 + aria-label + 焦点可见

### 完成报告

生成完毕后输出：

```
✅ 概念可视化页面生成完成！

📋 概念: [概念名称]
🎨 风格: [使用的风格]
📊 深度: [quick/standard/deep]
📐 Section 数: [N]
🖼 视觉元素: [SVG x N / AI 图片 x N / Mermaid x N]
📁 输出: [文件路径]

页面结构:
1. Hero - 概念概览
2. Visual Board - [具体可视化描述]
3. Deep Dive - [子概念列表]
4. [其他 Section]...

💡 浏览器打开即可使用，无需任何服务器。
```

---

## 示例调用

### 示例 1: 技术概念（通用环境）
```
用户: [一目了然: TCP 三次握手]

AI 行为:
1. 解构: 定义、SYN/ACK 流程、状态转换、与 UDP 对比
2. 布局: Hero → Visual Board(SVG时序图) → Timeline(三步骤) → Comparison(TCP vs UDP) → FAQ
3. 视觉: SVG 动画展示数据包在客户端和服务端之间的往返
4. 交互: 点击"下一步"逐步展示握手过程
5. 输出: tcp-handshake-visual.html
```

### 示例 2: 科学概念（反重力环境）
```
用户: [一目了然: 量子纠缠的工作原理]

AI 行为:
1. 解构: 波函数、叠加态、测量塌缩、Bell 定理
2. 布局: Hero → Visual Board(AI图片:粒子对纠缠态) → Deep Dive(原理卡片) → Interactive Demo(模拟测量)
3. 视觉: 调用 generate_image 生成粒子纠缠的科学插画
4. 交互: 点击"测量"按钮，两个粒子同步改变状态
5. 输出: quantum-entanglement-visual.html
```

---

## 质量检查清单

生成后自我检查：

- [ ] 页面能在浏览器直接打开（无需服务器）
- [ ] 移动端显示正常（320px 宽度）
- [ ] 所有 SVG 都有 `viewBox` 属性
- [ ] 无外部图片依赖（除 CDN 字体和框架）
- [ ] 文字对比度符合 WCAG AA
- [ ] 交互元素有 hover 反馈
- [ ] 入场动画使用 `prefers-reduced-motion` 降级
- [ ] 页面加载时间 < 3s（CDN 资源除外）
- [ ] 中文内容使用中文界面

---

## 附属参考文件

| 文件                              | 用途             |
| --------------------------------- | ---------------- |
| `references/design-system.md`     | 完整设计系统规范 |
| `references/component-library.md` | 可复用组件模板   |
| `references/svg-templates.md`     | SVG 图表模板     |
| `boilerplate.html`                | HTML 骨架模板    |

按需读取，不要一次性全部加载。
