# 视觉规范：赛博极简矩阵 (Cyber Minimalist Matrix)

## 1. 配色令牌 (Design Tokens)
- **Background**: `#0a0a0c` / 深邃黑
- **Surface**: `rgba(255, 255, 255, 0.03)` / 磨砂玻璃感
- **Accent**: `#00AEEF` / 亮蓝色
- **Secondary**: `#52525b` / 锌灰
- **Error/Alert**: `#ef4444` / 警示红

## 2. 字体系统
- **Headings**: `Inter` 或 `Outfit`, FontWeight: 900
- **Body**: `Inter`, FontWeight: 300
- **System/Metas**: `JetBrains Mono` (用于显示代码、标签、模块编号)

## 3. 核心动效组件 (Anime.js)
- **Entry**: `stagger(100ms)`
- **Easing**: `easeOutQuart`
- **Hover**: 1.05x 缓动缩放

## 4. 界面元素
- **Console Tags**: 所有功能编号必须包裹在 `[ MODULE.01 ]` 风格的矩形边框内。
- **Grid Background**: 全局 120px 间距的动态点阵背景。
- **Glassmorphism**: 详细内容弹窗必须使用 `backdrop-filter: blur(20px)`。
