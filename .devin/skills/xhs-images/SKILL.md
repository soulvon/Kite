---
name: xhs-images
description: 小红书信息图系列生成器，支持多种风格。将内容拆分为 1-10 张卡通风格的信息图。当用户要求创建“小红书图片”、“XHS images”或“红薯图”时使用。
---

# 小红书信息图系列生成器

将复杂内容拆解为极具吸引力的小红书系列信息图。

## 使用方法

```bash
# 根据内容自动选择风格和布局
/xhs-images posts/ai-future/article.md

# 指定风格
/xhs-images posts/ai-future/article.md --style notion

# 指定布局
/xhs-images posts/ai-future/article.md --layout dense

# 组合风格和布局
/xhs-images posts/ai-future/article.md --style tech --layout list

# 直接输入内容
/xhs-images
[在此粘贴内容]
```

## 选项

| 选项              | 描述                       |
| ----------------- | -------------------------- |
| `--style <name>`  | 视觉风格（见下方的风格库） |
| `--layout <name>` | 信息布局（见下方的布局库） |

## 两个维度

| 维度              | 控制内容                     | 选项                                                                              |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| **风格 (Style)**  | 视觉美学：颜色、线条、装饰物 | cute, fresh, tech, warm, bold, minimal, retro, pop, notion, productivity, insight |
| **布局 (Layout)** | 信息结构：密度、排列方式     | sparse, balanced, dense, list, comparison, flow                                   |

风格 × 布局可以自由组合。例如：`--style notion --layout dense` 将创建一个具有高信息密度的理性知识卡。

## 风格库（快速参考）

| 风格           | 描述                                | 最适合                |
| -------------- | ----------------------------------- | --------------------- |
| `cute`         | 甜美、可爱、少女感 - 经典小红书美学 | 生活、美容、时尚      |
| `fresh`        | 干净、清爽、自然                    | 健康、养生、自我提升  |
| `tech`         | 现代、智能、数字化                  | 技术教程、AI 相关内容 |
| `warm`         | 温馨、友好、亲切                    | 个人故事、生活感悟    |
| `bold`         | 高冲击力、抓人眼球                  | 重要提示、警告信息    |
| `minimal`      | 极简、高级感                        | 专业领域内容          |
| `retro`        | 复古、怀旧、潮流                    | 经典回顾、传统秘诀    |
| `pop`          | 鲜艳、活力、醒目                    | 趣闻、公告通知        |
| `notion`       | 极简手绘线条艺术                    | 知识分享、SaaS 工具   |
| `productivity` | 结构化、亮色模式、清爽 UI           | 操作指南、工具推荐    |
| `insight`      | 高清晰度、暗黑模式、高级感          | 思维模型、深度思考    |

**详细风格规范（颜色、元素、字体）**：参见 `references/styles.md`

## 布局库（快速参考）

| 布局         | 密度                      | 最适合                     |
| ------------ | ------------------------- | -------------------------- |
| `sparse`     | 1-2 个要点，60-70% 留白   | 封面、金句、冲击力强的陈述 |
| `balanced`   | 3-4 个要点，40-50% 留白   | 常规内容、教程说明         |
| `dense`      | 5-8 个要点，20-30% 留白   | 总结卡片、干货清单         |
| `list`       | 4-7 个项目，30-40% 留白   | Top N 排行榜、清单检查表   |
| `comparison` | 2×2-4 个要点，30-40% 留白 | 红黑榜、对比、利弊分析     |
| `flow`       | 3-6 个步骤，30-40% 留白   | 流程图、时间轴、顺序操作   |

**详细布局规范及风格×布局矩阵**：参见 `references/layouts.md`

## 自动选择逻辑

### 自动风格选择

| 内容信号                        | 选择风格       |
| ------------------------------- | -------------- |
| 美妆、时尚、可爱、女生、粉色    | `cute`         |
| 健康、自然、干净、清新          | `fresh`        |
| 技术、AI、代码、数字、APP、工具 | `tech`         |
| 生活、故事、情感、感受          | `warm`         |
| 警告、重要、必须、关键          | `bold`         |
| 专业、商业、优雅                | `minimal`      |
| 经典、复古、旧、传统            | `retro`        |
| 有趣、激动、超赞、惊讶          | `pop`          |
| 知识、概念、生产力、SaaS        | `notion`       |
| 指南、教程、工具推荐            | `productivity` |
| 思维模型、深度思考、洞察        | `insight`      |

### 自动布局选择

| 内容信号                     | 选择布局     |
| ---------------------------- | ------------ |
| 单句引用、一个核心点、封面   | `sparse`     |
| 3-4 个要点、解释、教程       | `balanced`   |
| 5 个以上要点、总结、干货集合 | `dense`      |
| 编号项目、Top N、清单        | `list`       |
| 对比、PK、前后对比、优缺点   | `comparison` |
| 流程、阶段、时间轴、循序步骤 | `flow`       |

### 按位置推荐布局

| 位置   | 推荐布局                                     |
| ------ | -------------------------------------------- |
| 封面   | `sparse`                                     |
| 内容页 | `balanced` / `dense` / `list` （根据内容定） |
| 结尾页 | `sparse` 或 `balanced`                       |

## 文件管理

### 带有文章路径时

保存在文章所在目录下的 `xhs-images/` 子目录中：

```
posts/ai-future/
├── article.md
└── xhs-images/
    ├── outline.md
    ├── prompts/
    │   ├── 01-cover.md
    │   └── ...
    ├── 01-cover.png
    └── 02-ending.png
```

### 不带文章路径时

保存在 `xhs-outputs/YYYY-MM-DD/[topic-slug]/` 下。

## 工作流

### 第 1 步：分析内容并选择风格/布局

1. 阅读内容。
2. 如果指定了 `--style`，则使用该风格；否则根据内容自动选择。
3. 如果指定了 `--layout`，则使用该布局；否则根据每张图的内容自动选择。
4. 确定图片数量：
   - 简单话题：2-3 张
   - 中等复杂度：4-6 张
   - 深度拆解：7-10 张

### 第 2 步：生成大纲

为每一张图片规划风格和布局规范。保存为 `outline.md`：

```markdown
# 小红书信息图系列大纲

**主题**：[topic]
**风格**：[selected style]
**默认布局**：[selected layout 或 "varies"]
**图片数量**：N
**生成时间**：YYYY-MM-DD HH:mm

---

## 图片 1 / N

**位置**：封面
**布局**：sparse
**核心信息**：[一句话标题]
**文件名**：01-cover.png

**文字内容**：
- 标题：xxx
- 副标题：xxx

**视觉概念**：[符合风格和布局的视觉描述]

---
...
```

### 第 3 步：逐一生成图片

对于每张图片：

1. 从 `references/styles.md` 读取风格详情（仅加载目标风格部分）。
2. 从 `references/layouts.md` 读取布局详情（仅加载目标布局部分）。
3. 在 `prompts/` 目录下创建提示词文件。
4. 使用以下命令生成：

```bash
/gemini-web --promptfiles [SKILL_ROOT]/prompts/system.md [TARGET_DIR]/prompts/01-cover.md --image [TARGET_DIR]/01-cover.png
```

**提示词格式**：

```markdown
Infographic theme: [topic]
Style: [style name]
Layout: [layout name]
Position: [cover/content/ending]

Visual composition:
- Main visual: [符合风格的描述]
- Arrangement: [符合布局的结构]
- Decorative elements: [风格专属装饰]

Color scheme:
- Primary: [来自风格规范]
- Background: [来自风格规范]
- Accent: [来自风格规范]

Text content:
- Title: 「xxx」(巨大且醒目)
- Key points: [根据布局密度确定]

Layout instructions: [来自布局规范]
Style notes: [来自风格规范]
```

### 第 4 步：完成报告

```
小红书系列信息图生成完成！

主题：[topic]
风格：[style name]
布局：[layout name 或 "varies"]
位置：[目录路径]
图片：共 N 张

- 01-cover.png ✓ 封面 (sparse)
- 02-content-1.png ✓ 内容 (balanced)
- 03-ending.png ✓ 结尾 (sparse)

大纲文件：outline.md
```

## 内容拆解原则

1. **封面（图 1）**：强视觉冲击力，核心标题，钩子（hook） → `sparse` 布局。
2. **正文（中间）**：每张图围绕一个核心点，密度随内容复杂度变化。
3. **结尾（最后）**：总结 / 行动号召（CTA） / 金句感悟 → `sparse` 或 `balanced` 布局。

## 注意事项

- 生成一张图片通常需要 10-30 秒。
- 生成失败后自动重试一次。
- 涉及敏感公众人物时使用卡通化形象替代。
- 输出语言应与输入内容语言一致。
- 保持整个系列图片风格高度一致。
