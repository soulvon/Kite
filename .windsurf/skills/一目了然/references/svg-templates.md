# VCT SVG 模板库

用于在不支持 AI 图片生成的环境中，以内联 SVG 替代图片展示概念。

---

## 通用 SVG 规范

```xml
<!-- 所有 SVG 必须包含 -->
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 [width] [height]"
     class="w-full h-auto"
     role="img"
     aria-label="[图表描述]">

  <!-- 可选：减弱动画偏好支持 -->
  <style>
    @media (prefers-reduced-motion: reduce) {
      .flow-animate { animation: none !important; }
    }
  </style>

  <!-- 内容 -->
</svg>
```

---

## 1. 流程图（Flow Diagram）

适用于：步骤、工作流、管道

```xml
<svg viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto" role="img" aria-label="流程图">
  <defs>
    <marker id="arrowPrimary" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="var(--accent-primary, #6366f1)"/>
    </marker>
    <linearGradient id="nodeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#4f46e5"/>
    </linearGradient>
  </defs>

  <style>
    .flow-line {
      stroke-dasharray: 8, 4;
      animation: dashFlow 0.6s linear infinite;
    }
    @keyframes dashFlow {
      to { stroke-dashoffset: -12; }
    }
    .node-label {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 600;
      fill: white;
      text-anchor: middle;
      dominant-baseline: central;
    }
    .node-desc {
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      fill: #94a3b8;
      text-anchor: middle;
      dominant-baseline: central;
    }
  </style>

  <!-- 节点 1 -->
  <g transform="translate(50, 60)">
    <rect width="150" height="60" rx="12" fill="url(#nodeGrad)" opacity="0.9"/>
    <text x="75" y="25" class="node-label">[步骤一]</text>
    <text x="75" y="45" class="node-desc">[描述]</text>
  </g>

  <!-- 连接线 1→2 -->
  <path d="M 210 90 L 290 90" stroke="#e2e8f0" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M 210 90 L 290 90" class="flow-line" stroke="#6366f1" stroke-width="2" fill="none" marker-end="url(#arrowPrimary)" stroke-linecap="round"/>

  <!-- 节点 2 -->
  <g transform="translate(300, 60)">
    <rect width="150" height="60" rx="12" fill="url(#nodeGrad)" opacity="0.9"/>
    <text x="75" y="25" class="node-label">[步骤二]</text>
    <text x="75" y="45" class="node-desc">[描述]</text>
  </g>

  <!-- 连接线 2→3 -->
  <path d="M 460 90 L 540 90" stroke="#e2e8f0" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M 460 90 L 540 90" class="flow-line" stroke="#6366f1" stroke-width="2" fill="none" marker-end="url(#arrowPrimary)" stroke-linecap="round"/>

  <!-- 节点 3 -->
  <g transform="translate(550, 60)">
    <rect width="150" height="60" rx="12" fill="url(#nodeGrad)" opacity="0.9"/>
    <text x="75" y="25" class="node-label">[步骤三]</text>
    <text x="75" y="45" class="node-desc">[描述]</text>
  </g>
</svg>
```

---

## 2. 时序图（Sequence Diagram）

适用于：请求/响应、握手协议、消息传递

```xml
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto" role="img" aria-label="时序图">
  <defs>
    <marker id="arrowRight" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L7,3 z" fill="#6366f1"/>
    </marker>
    <marker id="arrowLeft" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
      <path d="M7,0 L7,6 L0,3 z" fill="#22d3ee"/>
    </marker>
  </defs>

  <style>
    .lifeline { stroke: #334155; stroke-width: 2; stroke-dasharray: 6, 4; }
    .entity-label { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700; fill: white; text-anchor: middle; }
    .msg-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; fill: #94a3b8; }
    .msg-line-send {
      stroke: #6366f1; stroke-width: 2;
      stroke-dasharray: 6, 3;
      animation: msgFlow 0.8s linear infinite;
    }
    .msg-line-reply {
      stroke: #22d3ee; stroke-width: 2;
      stroke-dasharray: 6, 3;
      animation: msgFlowReverse 0.8s linear infinite;
    }
    @keyframes msgFlow { to { stroke-dashoffset: -9; } }
    @keyframes msgFlowReverse { to { stroke-dashoffset: 9; } }
  </style>

  <!-- 实体 A -->
  <rect x="130" y="20" width="140" height="40" rx="8" fill="#6366f1"/>
  <text x="200" y="45" class="entity-label">[实体 A]</text>
  <line x1="200" y1="60" x2="200" y2="380" class="lifeline"/>

  <!-- 实体 B -->
  <rect x="530" y="20" width="140" height="40" rx="8" fill="#22d3ee"/>
  <text x="600" y="45" class="entity-label">[实体 B]</text>
  <line x1="600" y1="60" x2="600" y2="380" class="lifeline"/>

  <!-- 消息 1: A → B -->
  <line x1="210" y1="120" x2="590" y2="120" class="msg-line-send" marker-end="url(#arrowRight)"/>
  <text x="400" y="110" class="msg-label" text-anchor="middle">[消息内容]</text>

  <!-- 消息 2: B → A -->
  <line x1="590" y1="200" x2="210" y2="200" class="msg-line-reply" marker-end="url(#arrowLeft)"/>
  <text x="400" y="190" class="msg-label" text-anchor="middle">[响应内容]</text>

  <!-- 消息 3: A → B -->
  <line x1="210" y1="280" x2="590" y2="280" class="msg-line-send" marker-end="url(#arrowRight)"/>
  <text x="400" y="270" class="msg-label" text-anchor="middle">[确认内容]</text>
</svg>
```

---

## 3. 层级架构图（Layer Diagram）

适用于：系统架构、协议栈、分层结构

```xml
<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto" role="img" aria-label="层级架构图">
  <style>
    .layer-label {
      font-family: 'Inter', sans-serif;
      font-size: 16px;
      font-weight: 700;
      fill: white;
      text-anchor: middle;
      dominant-baseline: central;
    }
    .layer-desc {
      font-family: 'Inter', sans-serif;
      font-size: 11px;
      fill: rgba(255,255,255,0.7);
      text-anchor: middle;
      dominant-baseline: central;
    }
    .layer-rect {
      transition: opacity 0.2s ease;
      cursor: pointer;
    }
    .layer-rect:hover { opacity: 0.85; }
  </style>

  <!-- 顶层 -->
  <g>
    <rect class="layer-rect" x="50" y="20" width="500" height="70" rx="10" fill="#6366f1"/>
    <text x="300" y="45" class="layer-label">[顶层名称]</text>
    <text x="300" y="65" class="layer-desc">[描述]</text>
  </g>

  <!-- 中间层 -->
  <g>
    <rect class="layer-rect" x="50" y="110" width="500" height="70" rx="10" fill="#8b5cf6"/>
    <text x="300" y="135" class="layer-label">[中间层名称]</text>
    <text x="300" y="155" class="layer-desc">[描述]</text>
  </g>

  <!-- 下层 -->
  <g>
    <rect class="layer-rect" x="50" y="200" width="500" height="70" rx="10" fill="#a78bfa"/>
    <text x="300" y="225" class="layer-label">[下层名称]</text>
    <text x="300" y="245" class="layer-desc">[描述]</text>
  </g>

  <!-- 底层 -->
  <g>
    <rect class="layer-rect" x="50" y="290" width="500" height="70" rx="10" fill="#c4b5fd"/>
    <text x="300" y="315" class="layer-label" fill="#1e1b4b">[底层名称]</text>
    <text x="300" y="335" class="layer-desc" fill="#4c1d95">[描述]</text>
  </g>

  <!-- 侧边标注 -->
  <text x="25" y="200" transform="rotate(-90, 25, 200)" font-family="Inter" font-size="12" fill="#64748b" text-anchor="middle">抽象层级 ↑</text>
</svg>
```

---

## 4. 对比双栏图（Comparison Diagram）

适用于：概念对比、优劣分析

```xml
<svg viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto" role="img" aria-label="对比图">
  <style>
    .cmp-title { font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 700; text-anchor: middle; }
    .cmp-item { font-family: 'Inter', sans-serif; font-size: 13px; fill: #94a3b8; }
    .cmp-check { fill: #34d399; }
    .cmp-cross { fill: #f87171; }
  </style>

  <!-- 分隔线 -->
  <line x1="400" y1="30" x2="400" y2="270" stroke="#334155" stroke-width="1" stroke-dasharray="4,4"/>

  <!-- 左栏标题 -->
  <rect x="50" y="20" width="300" height="40" rx="8" fill="rgba(99, 102, 241, 0.15)"/>
  <text x="200" y="45" class="cmp-title" fill="#6366f1">[概念 A]</text>

  <!-- 左栏条目 -->
  <g transform="translate(70, 80)">
    <circle cx="8" cy="8" r="6" class="cmp-check"/>
    <text x="24" y="12" class="cmp-item">[特点一]</text>
  </g>
  <g transform="translate(70, 120)">
    <circle cx="8" cy="8" r="6" class="cmp-check"/>
    <text x="24" y="12" class="cmp-item">[特点二]</text>
  </g>
  <g transform="translate(70, 160)">
    <circle cx="8" cy="8" r="6" class="cmp-cross"/>
    <text x="24" y="12" class="cmp-item">[缺点一]</text>
  </g>

  <!-- 右栏标题 -->
  <rect x="450" y="20" width="300" height="40" rx="8" fill="rgba(34, 211, 238, 0.15)"/>
  <text x="600" y="45" class="cmp-title" fill="#22d3ee">[概念 B]</text>

  <!-- 右栏条目 -->
  <g transform="translate(470, 80)">
    <circle cx="8" cy="8" r="6" class="cmp-check"/>
    <text x="24" y="12" class="cmp-item">[特点一]</text>
  </g>
  <g transform="translate(470, 120)">
    <circle cx="8" cy="8" r="6" class="cmp-cross"/>
    <text x="24" y="12" class="cmp-item">[缺点一]</text>
  </g>
  <g transform="translate(470, 160)">
    <circle cx="8" cy="8" r="6" class="cmp-check"/>
    <text x="24" y="12" class="cmp-item">[特点二]</text>
  </g>
</svg>
```

---

## 5. 循环图（Cycle Diagram）

适用于：循环流程、反馈回路、生命周期

```xml
<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto max-w-md mx-auto" role="img" aria-label="循环图">
  <defs>
    <marker id="cycleArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L7,3 z" fill="#6366f1"/>
    </marker>
  </defs>

  <style>
    .cycle-node {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 600;
      fill: white;
      text-anchor: middle;
      dominant-baseline: central;
    }
    .cycle-arc {
      stroke: #6366f1;
      stroke-width: 2;
      fill: none;
      stroke-dasharray: 6, 3;
      animation: cycleFlow 1s linear infinite;
    }
    @keyframes cycleFlow { to { stroke-dashoffset: -9; } }
  </style>

  <!-- 中心圆 -->
  <circle cx="250" cy="250" r="60" fill="rgba(99, 102, 241, 0.1)" stroke="#6366f1" stroke-width="1"/>
  <text x="250" y="250" class="cycle-node" fill="#6366f1" font-size="16">[核心]</text>

  <!-- 节点 1 (上) -->
  <circle cx="250" cy="100" r="45" fill="#6366f1"/>
  <text x="250" y="100" class="cycle-node">[阶段 1]</text>

  <!-- 节点 2 (右下) -->
  <circle cx="380" cy="340" r="45" fill="#8b5cf6"/>
  <text x="380" y="340" class="cycle-node">[阶段 2]</text>

  <!-- 节点 3 (左下) -->
  <circle cx="120" cy="340" r="45" fill="#a78bfa"/>
  <text x="120" y="340" class="cycle-node">[阶段 3]</text>

  <!-- 弧线连接 -->
  <path d="M 285 115 Q 370 170 375 295" class="cycle-arc" marker-end="url(#cycleArrow)"/>
  <path d="M 350 370 Q 250 420 150 370" class="cycle-arc" marker-end="url(#cycleArrow)"/>
  <path d="M 105 300 Q 100 200 230 110" class="cycle-arc" marker-end="url(#cycleArrow)"/>
</svg>
```

---

## 6. 脉冲粒子效果（通用装饰）

适用于：为抽象概念增加视觉动感

```xml
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto" role="img" aria-label="粒子效果">
  <style>
    @keyframes pulse { 0%,100% { r: 3; opacity: 0.3; } 50% { r: 6; opacity: 0.8; } }
    @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .particle { animation: pulse 2s ease-in-out infinite; }
    .floating { animation: float 3s ease-in-out infinite; }
  </style>

  <!-- 粒子群 -->
  <circle cx="100" cy="200" r="3" fill="#6366f1" class="particle" style="animation-delay: 0s"/>
  <circle cx="200" cy="150" r="4" fill="#22d3ee" class="particle" style="animation-delay: 0.3s"/>
  <circle cx="350" cy="250" r="3" fill="#6366f1" class="particle" style="animation-delay: 0.6s"/>
  <circle cx="500" cy="180" r="5" fill="#22d3ee" class="particle" style="animation-delay: 0.9s"/>
  <circle cx="650" cy="220" r="3" fill="#6366f1" class="particle" style="animation-delay: 1.2s"/>
  <circle cx="750" cy="160" r="4" fill="#22d3ee" class="particle" style="animation-delay: 1.5s"/>

  <!-- 连接线 -->
  <line x1="100" y1="200" x2="200" y2="150" stroke="#6366f1" stroke-width="0.5" opacity="0.3"/>
  <line x1="200" y1="150" x2="350" y2="250" stroke="#22d3ee" stroke-width="0.5" opacity="0.3"/>
  <line x1="350" y1="250" x2="500" y2="180" stroke="#6366f1" stroke-width="0.5" opacity="0.3"/>
  <line x1="500" y1="180" x2="650" y2="220" stroke="#22d3ee" stroke-width="0.5" opacity="0.3"/>
  <line x1="650" y1="220" x2="750" y2="160" stroke="#6366f1" stroke-width="0.5" opacity="0.3"/>
</svg>
```

---

## 色彩映射

不同类型的组件使用对应的色彩语义：

| 语义      | 色值（Dark 风格）   | 用途                 |
| --------- | ------------------- | -------------------- |
| 主要/输入 | `#6366f1` (Indigo)  | 起点、发送方、正向   |
| 次要/输出 | `#22d3ee` (Cyan)    | 终点、接收方、数据流 |
| 成功      | `#34d399` (Emerald) | 正确、通过、完成     |
| 警告      | `#fbbf24` (Amber)   | 注意、待定、处理中   |
| 危险      | `#f87171` (Red)     | 错误、拒绝、缺点     |
| 中性      | `#94a3b8` (Slate)   | 辅助文字、边框       |
