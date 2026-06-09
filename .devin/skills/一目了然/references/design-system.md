# VCT 设计系统参考

## 1. CSS 变量系统

每个风格通过 CSS 变量定义，切换风格只需替换 `:root` 中的变量值。

### Dark 风格（默认）

```css
:root {
  /* 背景层级 */
  --bg-base: #0a0a0f;
  --bg-surface: #111119;
  --bg-elevated: #1a1a25;
  --bg-overlay: rgba(255, 255, 255, 0.03);
  --bg-hover: rgba(255, 255, 255, 0.06);

  /* 强调色 */
  --accent-primary: #6366f1;
  --accent-primary-hover: #818cf8;
  --accent-primary-subtle: rgba(99, 102, 241, 0.12);
  --accent-secondary: #22d3ee;
  --accent-secondary-subtle: rgba(34, 211, 238, 0.12);
  --accent-success: #34d399;
  --accent-warning: #fbbf24;
  --accent-danger: #f87171;

  /* 文字 */
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #0f172a;

  /* 边框 */
  --border-default: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  --border-active: var(--accent-primary);

  /* 阴影 */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.15);

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;
}
```

### Light 风格

```css
:root {
  --bg-base: #fafbfc;
  --bg-surface: #ffffff;
  --bg-elevated: #ffffff;
  --bg-overlay: rgba(0, 0, 0, 0.02);
  --bg-hover: rgba(0, 0, 0, 0.04);

  --accent-primary: #4f46e5;
  --accent-primary-hover: #6366f1;
  --accent-primary-subtle: rgba(79, 70, 229, 0.08);
  --accent-secondary: #0891b2;
  --accent-secondary-subtle: rgba(8, 145, 178, 0.08);

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;

  --border-default: #e2e8f0;
  --border-hover: #cbd5e1;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
}
```

### Neo 风格（赛博朋克）

```css
:root {
  --bg-base: #050510;
  --bg-surface: #0a0a1a;
  --bg-elevated: #0f0f25;
  --bg-overlay: rgba(0, 174, 239, 0.04);
  --bg-hover: rgba(0, 174, 239, 0.08);

  --accent-primary: #00AEEF;
  --accent-primary-hover: #33c1f5;
  --accent-primary-subtle: rgba(0, 174, 239, 0.12);
  --accent-secondary: #ff3e88;
  --accent-secondary-subtle: rgba(255, 62, 136, 0.12);

  --text-primary: #e0e0e0;
  --text-secondary: #7a7a8e;
  --text-muted: #4a4a5e;

  --border-default: rgba(0, 174, 239, 0.12);
  --border-hover: rgba(0, 174, 239, 0.25);

  --shadow-glow: 0 0 30px rgba(0, 174, 239, 0.2);
}
```

### Warm 风格（暖色学术）

```css
:root {
  --bg-base: #fefcf8;
  --bg-surface: #fffbf0;
  --bg-elevated: #ffffff;
  --bg-overlay: rgba(180, 83, 9, 0.03);
  --bg-hover: rgba(180, 83, 9, 0.06);

  --accent-primary: #b45309;
  --accent-primary-hover: #d97706;
  --accent-primary-subtle: rgba(180, 83, 9, 0.08);
  --accent-secondary: #0f766e;
  --accent-secondary-subtle: rgba(15, 118, 110, 0.08);

  --text-primary: #292524;
  --text-secondary: #57534e;
  --text-muted: #a8a29e;

  --border-default: #e7e5e4;
  --border-hover: #d6d3d1;

  --shadow-sm: 0 1px 3px rgba(120, 53, 15, 0.06);
  --shadow-md: 0 4px 12px rgba(120, 53, 15, 0.08);
}
```

---

## 2. 字体系统

### 字体比例（Major Third - 1.25）

| 层级       | 大小     | 行高 | 字重 | 用途         |
| ---------- | -------- | ---- | ---- | ------------ |
| Display    | 4rem     | 1.1  | 900  | Hero 主标题  |
| H1         | 2.5rem   | 1.2  | 700  | Section 标题 |
| H2         | 2rem     | 1.25 | 600  | 子 Section   |
| H3         | 1.5rem   | 1.3  | 600  | 卡片标题     |
| Body Large | 1.125rem | 1.6  | 400  | 引导文案     |
| Body       | 1rem     | 1.7  | 400  | 正文         |
| Small      | 0.875rem | 1.5  | 400  | 辅助说明     |
| Caption    | 0.75rem  | 1.4  | 500  | 注释/标签    |
| Code       | 0.9rem   | 1.6  | 400  | 代码/等宽    |

### 字体配对

```css
/* 标题字体 */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* 代码/标签字体 */
font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
```

---

## 3. 间距系统（8px 基准网格）

| Token   | 值   | 用途             |
| ------- | ---- | ---------------- |
| `--s-1` | 4px  | 紧凑间距         |
| `--s-2` | 8px  | 图标与文字间距   |
| `--s-3` | 12px | 小组件内边距     |
| `--s-4` | 16px | 段落间距         |
| `--s-5` | 24px | 卡片内边距       |
| `--s-6` | 32px | Section 内部间距 |
| `--s-7` | 48px | Section 之间间距 |
| `--s-8` | 64px | 大 Section 之间  |
| `--s-9` | 96px | 页面级分隔       |

---

## 4. 动画模式

### 入场动画（Intersection Observer 驱动）

```css
/* 淡入上移 */
.animate-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}
.animate-in.visible {
  opacity: 1;
  transform: translateY(0);
}

/* 错位入场（stagger） */
.animate-in:nth-child(1) { transition-delay: 0ms; }
.animate-in:nth-child(2) { transition-delay: 100ms; }
.animate-in:nth-child(3) { transition-delay: 200ms; }
.animate-in:nth-child(4) { transition-delay: 300ms; }
.animate-in:nth-child(5) { transition-delay: 400ms; }

/* 无动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .animate-in {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

### Intersection Observer 初始化

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));
```

### 悬停效果

```css
/* 卡片悬停 */
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-hover);
}

/* 按钮悬停 */
.btn {
  transition: background-color 0.15s ease, transform 0.1s ease;
}
.btn:hover {
  transform: translateY(-1px);
}
.btn:active {
  transform: translateY(0);
}
```

### 数字计数动画

```javascript
function animateCounter(el, target, duration = 2000) {
  let start = 0;
  const increment = target / (duration / 16);
  const suffix = el.dataset.suffix || '';
  const prefix = el.dataset.prefix || '';

  function update() {
    start += increment;
    if (start >= target) {
      el.textContent = prefix + target.toLocaleString() + suffix;
      return;
    }
    el.textContent = prefix + Math.floor(start).toLocaleString() + suffix;
    requestAnimationFrame(update);
  }
  update();
}
```

---

## 5. 响应式断点

```css
/* 移动优先 */
/* sm: 640px */
@media (min-width: 640px) { }

/* md: 768px */
@media (min-width: 768px) { }

/* lg: 1024px */
@media (min-width: 1024px) { }

/* xl: 1280px */
@media (min-width: 1280px) { }
```

### 容器最大宽度

```css
.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

@media (min-width: 640px) {
  .container { padding: 0 2rem; }
}

@media (min-width: 1024px) {
  .container { padding: 0 3rem; }
}
```

---

## 6. 背景装饰模式

### 点阵网格

```css
.dot-grid {
  background-image: radial-gradient(var(--accent-primary) 0.5px, transparent 0.5px);
  background-size: 32px 32px;
  opacity: 0.08;
}
```

### 渐变光晕

```css
.gradient-glow {
  position: absolute;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-primary-subtle) 0%, transparent 70%);
  filter: blur(80px);
  pointer-events: none;
}
```

### 网格线

```css
.grid-lines {
  background-image:
    linear-gradient(var(--border-default) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-default) 1px, transparent 1px);
  background-size: 60px 60px;
  opacity: 0.3;
}
```
