---
name: svg-architecture
description: 生成带有流动动画效果的系统架构图 SVG 矢量图。当用户需要生成系统架构图、项目结构可视化、数据流图、或带动画的 SVG 图表时使用。触发命令：/svg-architecture [项目路径或描述]
---

# SVG Architecture Diagram Generator

生成带有流动动画效果的专业系统架构图。

## 使用方式

```
/svg-architecture [项目路径或描述]
```

**示例**:
- `/svg-architecture X:\Desktop\my-project`
- `/svg-architecture 前后端分离系统，Node.js + React + MongoDB`

---

## 任务流程

1. **分析输入** — 路径则探索项目结构；描述则解析系统组件和数据流
2. **设计布局** — 数据流向左→右或上→下，合理分组，保持视觉平衡
3. **生成 SVG** — 应用标准配色和流动动画
4. **保存文件** — 命名为 `[项目名]-architecture.svg`

---

## SVG 模板结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900">
  <defs>
    <!-- 渐变 -->
    <linearGradient id="[name]Gradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#主色;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#深色;stop-opacity:1" />
    </linearGradient>
    
    <!-- 箭头标记 -->
    <marker id="arrow[Color]" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#颜色"/>
    </marker>
  </defs>

  <style>
    .flow-line-[color] {
      stroke-dasharray: 8, 4;
      animation: dash-flow-[color] 0.5s linear infinite;
    }
    @keyframes dash-flow-[color] {
      to { stroke-dashoffset: -12; }
    }
  </style>

  <rect width="1200" height="900" fill="#ffffff"/>
  <!-- 内容 -->
</svg>
```

---

## 标准配色

| 模块类型    | 主色    | 浅色背景 | 深色    | 动画类名         |
| ----------- | ------- | -------- | ------- | ---------------- |
| 数据源/采集 | #22c55e | #f0fdf4  | #16a34a | flow-line-green  |
| 分析/处理   | #f97316 | #fff7ed  | #ea580c | flow-line-orange |
| 存储/数据库 | #3b82f6 | #eff6ff  | #2563eb | flow-line-blue   |
| API/接口    | #a855f7 | #faf5ff  | #7c3aed | flow-line-purple |
| 前端/展示   | #42b883 | #f0fdf4  | #35495e | flow-line-teal   |
| 用户/终端   | #0ea5e9 | #f1f5f9  | #0284c7 | flow-line-sky    |

---

## 核心组件模板

### 流动连接线（双层结构）

```xml
<!-- 底层浅色背景线 -->
<path d="M x1 y1 L x2 y2" stroke="#浅色" stroke-width="6" fill="none" stroke-linecap="round"/>
<!-- 顶层动画线 -->
<path d="M x1 y1 L x2 y2" class="flow-line-[color]" stroke="#主色" stroke-width="3" fill="none" marker-end="url(#arrow[Color])" stroke-linecap="round"/>
<!-- 标签 -->
<text x="中点x" y="中点y-10" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#主色">标签</text>
```

### 模块卡片

```xml
<g transform="translate(x, y)">
  <rect x="0" y="0" width="280" height="180" rx="12" fill="#浅色背景" stroke="#主色" stroke-width="2"/>
  <rect x="0" y="0" width="280" height="35" rx="12" fill="url(#xxxGradient)"/>
  <text x="140" y="24" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff">🔧 模块名称</text>
  
  <!-- 内部子模块 -->
  <g transform="translate(15, 45)">
    <rect x="0" y="0" width="115" height="55" rx="6" fill="#ffffff" stroke="#浅边框" stroke-width="1"/>
    <text x="57" y="20" text-anchor="middle" font-family="monospace" font-size="10" fill="#主色">文件名.py</text>
    <text x="57" y="35" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#64748b">描述</text>
  </g>
</g>
```

### 网格背景（可选）

```xml
<g opacity="0.15">
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#94a3b8" stroke-width="0.5"/>
  </pattern>
  <rect width="1200" height="900" fill="url(#grid)"/>
</g>
```

### 流程说明区域

```xml
<g transform="translate(50, 500)">
  <rect x="0" y="0" width="500" height="180" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <text x="250" y="25" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="#1e293b">📋 数据流程说明</text>
  
  <g transform="translate(20, 45)">
    <circle cx="8" cy="8" r="6" fill="#22c55e"/>
    <text x="25" y="12" font-family="Arial" font-size="11" fill="#1e293b">1. 步骤描述</text>
  </g>
</g>
```

### 图例

```xml
<g transform="translate(50, 720)">
  <rect x="0" y="0" width="500" height="60" rx="8" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <text x="250" y="20" text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="#64748b">图例</text>
  
  <rect x="20" y="35" width="30" height="15" rx="3" fill="#22c55e"/>
  <text x="55" y="47" font-family="Arial" font-size="10" fill="#1e293b">模块名</text>
</g>
```

---

## 必须包含的元素

1. ✅ **标题区** — 中英文双语标题
2. ✅ **模块卡片** — 各系统组件，使用对应配色
3. ✅ **流动连接线** — 双层结构 + CSS动画
4. ✅ **流程说明** — 左下角步骤说明
5. ✅ **图例** — 颜色说明
6. ✅ **白色背景** — 清爽简洁
7. ⭕ **数据模型** — 关键数据结构（可选）
