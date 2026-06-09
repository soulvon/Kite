# VCT 组件库

可复用的 HTML 组件模板，生成概念页面时按需组合。

---

## 1. Hero Section

### 标准 Hero（居中大标题 + 副标题）

```html
<section id="hero" class="relative min-h-screen flex items-center justify-center overflow-hidden">
  <!-- 背景装饰 -->
  <div class="absolute inset-0 dot-grid"></div>
  <div class="gradient-glow absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2"></div>

  <div class="container relative z-10 text-center">
    <!-- 标签 -->
    <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-overlay)] mb-6 animate-in">
      <span class="w-2 h-2 rounded-full bg-[var(--accent-success)] animate-pulse"></span>
      <span class="text-sm text-[var(--text-secondary)]">概念可视化</span>
    </div>

    <!-- 主标题 -->
    <h1 class="text-5xl md:text-7xl font-black tracking-tight text-[var(--text-primary)] mb-6 animate-in">
      [概念名称]
    </h1>

    <!-- 副标题 -->
    <p class="text-lg md:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 animate-in">
      [一句话概念描述，清晰易懂]
    </p>

    <!-- CTA 按钮 -->
    <div class="flex gap-4 justify-center animate-in">
      <a href="#visual-board" class="btn px-6 py-3 rounded-xl bg-[var(--accent-primary)] text-white font-medium hover:bg-[var(--accent-primary-hover)] transition-all">
        开始探索 ↓
      </a>
    </div>
  </div>

  <!-- 底部渐变过渡 -->
  <div class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--bg-base)] to-transparent"></div>
</section>
```

---

## 2. Visual Board（核心可视化区域）

### SVG 容器

```html
<section id="visual-board" class="py-24">
  <div class="container">
    <div class="text-center mb-12 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">核心原理</h2>
      <p class="text-[var(--text-secondary)] max-w-xl mx-auto">以下图表展示了 [概念] 的核心工作机制</p>
    </div>

    <!-- SVG 容器 -->
    <div class="max-w-4xl mx-auto p-8 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] animate-in">
      <svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto">
        <!-- SVG 内容在此 -->
      </svg>
    </div>
  </div>
</section>
```

### AI 图片容器（反重力环境）

```html
<section id="visual-board" class="py-24">
  <div class="container">
    <div class="text-center mb-12 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">核心原理</h2>
      <p class="text-[var(--text-secondary)] max-w-xl mx-auto">可视化展示 [概念] 的核心机制</p>
    </div>

    <div class="max-w-4xl mx-auto rounded-2xl overflow-hidden border border-[var(--border-default)] shadow-lg animate-in">
      <img src="[GENERATED_IMAGE_PATH]"
           alt="[概念] 的可视化解释"
           class="w-full h-auto object-cover"
           loading="lazy">
    </div>
  </div>
</section>
```

---

## 3. Deep Dive（卡片式细节拆解）

```html
<section id="deep-dive" class="py-24">
  <div class="container">
    <div class="text-center mb-16 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">深入解析</h2>
      <p class="text-[var(--text-secondary)]">分解 [概念] 的核心要素</p>
    </div>

    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      <!-- 单个概念卡片 -->
      <div class="card group p-6 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] animate-in">
        <!-- 图标区 -->
        <div class="w-12 h-12 rounded-lg bg-[var(--accent-primary-subtle)] flex items-center justify-center mb-4">
          <i data-lucide="[icon-name]" class="w-6 h-6 text-[var(--accent-primary)]"></i>
        </div>
        <!-- 标题 -->
        <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-2">[子概念标题]</h3>
        <!-- 描述 -->
        <p class="text-[var(--text-secondary)] leading-relaxed">[子概念详细描述，2-3 句话，清晰易懂]</p>
      </div>

      <!-- 重复更多卡片... -->
    </div>
  </div>
</section>
```

---

## 4. Timeline（步骤/流程展示）

### 垂直时间轴

```html
<section id="timeline" class="py-24">
  <div class="container max-w-3xl">
    <div class="text-center mb-16 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">工作流程</h2>
    </div>

    <div class="relative">
      <!-- 时间轴线 -->
      <div class="absolute left-8 top-0 bottom-0 w-px bg-[var(--border-default)]"></div>

      <!-- 步骤 1 -->
      <div class="relative flex gap-6 mb-12 animate-in">
        <!-- 节点 -->
        <div class="relative z-10 w-16 h-16 rounded-full bg-[var(--accent-primary)] flex items-center justify-center shrink-0 shadow-lg">
          <span class="text-white font-bold text-lg">1</span>
        </div>
        <!-- 内容 -->
        <div class="pt-2">
          <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-2">[步骤标题]</h3>
          <p class="text-[var(--text-secondary)] leading-relaxed">[步骤详细描述]</p>
        </div>
      </div>

      <!-- 步骤 2 -->
      <div class="relative flex gap-6 mb-12 animate-in">
        <div class="relative z-10 w-16 h-16 rounded-full bg-[var(--accent-secondary)] flex items-center justify-center shrink-0 shadow-lg">
          <span class="text-white font-bold text-lg">2</span>
        </div>
        <div class="pt-2">
          <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-2">[步骤标题]</h3>
          <p class="text-[var(--text-secondary)] leading-relaxed">[步骤详细描述]</p>
        </div>
      </div>

      <!-- 更多步骤... -->
    </div>
  </div>
</section>
```

---

## 5. Comparison（对比分析）

```html
<section id="comparison" class="py-24">
  <div class="container">
    <div class="text-center mb-16 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">[A] vs [B]</h2>
    </div>

    <div class="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
      <!-- 左栏 -->
      <div class="p-8 rounded-2xl border-2 border-[var(--accent-primary)] bg-[var(--accent-primary-subtle)] animate-in">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-[var(--accent-primary)] flex items-center justify-center">
            <i data-lucide="check" class="w-5 h-5 text-white"></i>
          </div>
          <h3 class="text-2xl font-bold text-[var(--text-primary)]">[A 的名称]</h3>
        </div>
        <ul class="space-y-3">
          <li class="flex items-start gap-2 text-[var(--text-secondary)]">
            <span class="text-[var(--accent-primary)] mt-1">•</span>
            <span>[特点描述]</span>
          </li>
          <!-- 更多特点... -->
        </ul>
      </div>

      <!-- 右栏 -->
      <div class="p-8 rounded-2xl border-2 border-[var(--accent-secondary)] bg-[var(--accent-secondary-subtle)] animate-in">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-lg bg-[var(--accent-secondary)] flex items-center justify-center">
            <i data-lucide="x" class="w-5 h-5 text-white"></i>
          </div>
          <h3 class="text-2xl font-bold text-[var(--text-primary)]">[B 的名称]</h3>
        </div>
        <ul class="space-y-3">
          <li class="flex items-start gap-2 text-[var(--text-secondary)]">
            <span class="text-[var(--accent-secondary)] mt-1">•</span>
            <span>[特点描述]</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</section>
```

---

## 6. Interactive Demo（交互演示）

### Tab 切换器

```html
<section id="interactive" class="py-24">
  <div class="container max-w-3xl">
    <div class="text-center mb-12 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">交互演示</h2>
    </div>

    <div class="animate-in" x-data="{ activeTab: 0 }">
      <!-- Tab 导航 -->
      <div class="flex gap-2 p-1 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-default)] mb-8">
        <template x-for="(tab, idx) in ['步骤一', '步骤二', '步骤三']" :key="idx">
          <button
            @click="activeTab = idx"
            :class="activeTab === idx ? 'bg-[var(--accent-primary)] text-white shadow-md' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
            class="flex-1 py-3 px-4 rounded-lg font-medium transition-all text-sm"
            x-text="tab">
          </button>
        </template>
      </div>

      <!-- Tab 内容 -->
      <div class="p-8 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] min-h-[300px]">
        <div x-show="activeTab === 0" x-transition>
          <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-4">[步骤一标题]</h3>
          <p class="text-[var(--text-secondary)]">[步骤一内容]</p>
        </div>
        <div x-show="activeTab === 1" x-transition>
          <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-4">[步骤二标题]</h3>
          <p class="text-[var(--text-secondary)]">[步骤二内容]</p>
        </div>
        <div x-show="activeTab === 2" x-transition>
          <h3 class="text-xl font-semibold text-[var(--text-primary)] mb-4">[步骤三标题]</h3>
          <p class="text-[var(--text-secondary)]">[步骤三内容]</p>
        </div>
      </div>
    </div>
  </div>
</section>
```

### 无 Alpine.js 版本（纯 JS Tab）

```html
<div class="tab-container">
  <div class="flex gap-2 p-1 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-default)] mb-8">
    <button onclick="switchTab(0)" class="tab-btn active flex-1 py-3 px-4 rounded-lg font-medium text-sm">步骤一</button>
    <button onclick="switchTab(1)" class="tab-btn flex-1 py-3 px-4 rounded-lg font-medium text-sm">步骤二</button>
    <button onclick="switchTab(2)" class="tab-btn flex-1 py-3 px-4 rounded-lg font-medium text-sm">步骤三</button>
  </div>
  <div class="tab-content p-8 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
    <div class="tab-panel" data-tab="0">[内容]</div>
    <div class="tab-panel hidden" data-tab="1">[内容]</div>
    <div class="tab-panel hidden" data-tab="2">[内容]</div>
  </div>
</div>

<script>
function switchTab(idx) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
    btn.style.background = i === idx ? 'var(--accent-primary)' : 'transparent';
    btn.style.color = i === idx ? 'white' : 'var(--text-secondary)';
  });
  document.querySelectorAll('.tab-panel').forEach((panel, i) => {
    panel.classList.toggle('hidden', i !== idx);
  });
}
</script>
```

---

## 7. Stats Dashboard（数据统计）

```html
<section id="stats" class="py-24">
  <div class="container">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
      <div class="text-center p-6 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] animate-in">
        <div class="text-4xl font-black text-[var(--accent-primary)] mb-2"
             data-counter="99" data-suffix="%">0</div>
        <div class="text-sm text-[var(--text-muted)]">[指标名称]</div>
      </div>
      <div class="text-center p-6 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] animate-in">
        <div class="text-4xl font-black text-[var(--accent-secondary)] mb-2"
             data-counter="1000" data-suffix="+">0</div>
        <div class="text-sm text-[var(--text-muted)]">[指标名称]</div>
      </div>
      <!-- 更多统计... -->
    </div>
  </div>
</section>
```

---

## 8. FAQ / Myths（手风琴折叠）

```html
<section id="faq" class="py-24">
  <div class="container max-w-3xl">
    <div class="text-center mb-16 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">常见误区</h2>
    </div>

    <div class="space-y-4">
      <div class="animate-in">
        <details class="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden">
          <summary class="flex items-center justify-between p-6 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
            <div class="flex items-center gap-3">
              <span class="text-red-400 text-xl">❌</span>
              <span class="font-medium text-[var(--text-primary)]">[误区描述]</span>
            </div>
            <i data-lucide="chevron-down" class="w-5 h-5 text-[var(--text-muted)] group-open:rotate-180 transition-transform"></i>
          </summary>
          <div class="px-6 pb-6 pt-2">
            <div class="flex items-start gap-3">
              <span class="text-green-400 text-xl mt-0.5">✅</span>
              <p class="text-[var(--text-secondary)] leading-relaxed">[正确解释]</p>
            </div>
          </div>
        </details>
      </div>
      <!-- 更多条目... -->
    </div>
  </div>
</section>
```

---

## 9. Code Playground（代码展示）

```html
<section id="code" class="py-24">
  <div class="container max-w-3xl">
    <div class="text-center mb-12 animate-in">
      <h2 class="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">代码示例</h2>
    </div>

    <div class="rounded-2xl border border-[var(--border-default)] overflow-hidden animate-in">
      <!-- 头部 -->
      <div class="flex items-center gap-2 px-4 py-3 bg-[var(--bg-elevated)] border-b border-[var(--border-default)]">
        <div class="flex gap-1.5">
          <div class="w-3 h-3 rounded-full bg-red-400/60"></div>
          <div class="w-3 h-3 rounded-full bg-yellow-400/60"></div>
          <div class="w-3 h-3 rounded-full bg-green-400/60"></div>
        </div>
        <span class="text-xs text-[var(--text-muted)] ml-2 font-mono">[filename.ext]</span>
      </div>
      <!-- 代码内容 -->
      <pre class="p-6 bg-[var(--bg-surface)] overflow-x-auto"><code class="text-sm font-mono leading-relaxed text-[var(--text-secondary)]">[代码内容，每行带注释]</code></pre>
    </div>
  </div>
</section>
```

---

## 10. Navigation（固定导航栏）

### 顶部导航

```html
<nav class="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-[var(--bg-base)]/80 border-b border-[var(--border-default)]">
  <div class="container flex items-center justify-between h-16">
    <a href="#hero" class="font-bold text-[var(--text-primary)]">[概念名称]</a>
    <div class="hidden md:flex items-center gap-6">
      <a href="#visual-board" class="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">原理</a>
      <a href="#deep-dive" class="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">解析</a>
      <a href="#timeline" class="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">流程</a>
      <a href="#faq" class="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">FAQ</a>
    </div>
  </div>
</nav>
```

### 滚动进度条

```html
<div class="fixed top-0 left-0 z-[60] h-1 bg-[var(--accent-primary)] transition-all" id="progress-bar" style="width: 0%"></div>

<script>
window.addEventListener('scroll', () => {
  const scrollTop = document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = (scrollTop / scrollHeight) * 100;
  document.getElementById('progress-bar').style.width = progress + '%';
});
</script>
```

---

## 11. Footer

```html
<footer class="py-16 border-t border-[var(--border-default)]">
  <div class="container text-center">
    <p class="text-[var(--text-muted)] text-sm mb-4">
      由 <span class="text-[var(--accent-primary)]">一目了然</span> 生成
    </p>
    <p class="text-[var(--text-muted)] text-xs">
      [生成日期] · [概念来源/参考资料]
    </p>
  </div>
</footer>
```
