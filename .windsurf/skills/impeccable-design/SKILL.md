---
name: impeccable-design
description: 无瑕设计 - 开源 AI 设计语言系统（by Paul Bakaus），消除 AI 生成 UI 的"AI味"。包含 20 个设计命令（audit/polish/critique 等）+ 7 份专业参考指南（排版/色彩/动效/交互/响应式/空间/UX文案）。当用户需要 UI 设计审查、优化、打磨或构建高质量前端界面时使用。
license: Apache 2.0. Based on Anthropic's frontend-design skill. See NOTICE.md for attribution.
---

# Impeccable Design 无瑕设计

> The design language that makes your AI harness better at design.
> 让 AI 生成的 UI 不再有"AI味"，达到专业设计师水准。

**来源**: [GitHub - pbakaus/impeccable](https://github.com/pbakaus/impeccable) | [官网 impeccable.style](https://impeccable.style)

---

## 核心理念

Impeccable 解决的核心问题：AI 生成的 UI 千篇一律（Inter 字体、紫色渐变、玻璃态卡片、弹跳动画……）。
它通过**反模式清单 + 专业设计语言**，让 AI 理解什么该做、什么不该做。

---

## 技能结构

本技能包含以下子技能，全部位于当前目录下的子文件夹中：

### 🎨 核心设计技能
| 子技能               | 说明                                 | 路径                        |
| -------------------- | ------------------------------------ | --------------------------- |
| **frontend-design**  | 核心设计技能，含 7 份参考指南        | `frontend-design/SKILL.md`  |
| **teach-impeccable** | 收集项目设计上下文（首次使用前运行） | `teach-impeccable/SKILL.md` |

### 🔍 审查 & 分析
| 子技能       | 说明                                                           | 路径                |
| ------------ | -------------------------------------------------------------- | ------------------- |
| **audit**    | 技术质量审查（可访问性/性能/主题/响应式/反模式），输出评分报告 | `audit/SKILL.md`    |
| **critique** | UX 设计评审（视觉层级/信息架构/认知负荷），输出量化评分        | `critique/SKILL.md` |

### ✨ 优化 & 打磨
| 子技能        | 说明                                      | 路径                 |
| ------------- | ----------------------------------------- | -------------------- |
| **polish**    | 发布前最终打磨（对齐/间距/一致性/微细节） | `polish/SKILL.md`    |
| **normalize** | 对齐设计系统标准（token/间距/模式）       | `normalize/SKILL.md` |
| **optimize**  | UI 性能优化（加载/渲染/动画/Bundle）      | `optimize/SKILL.md`  |
| **harden**    | 加固生产健壮性（错误处理/i18n/溢出/边界） | `harden/SKILL.md`    |
| **distill**   | 精简设计，去除不必要的复杂度              | `distill/SKILL.md`   |
| **extract**   | 提取可复用组件和 design token             | `extract/SKILL.md`   |

### 🎬 视觉 & 动效
| 子技能        | 说明                                       | 路径                 |
| ------------- | ------------------------------------------ | -------------------- |
| **animate**   | 添加有目的的动效和微交互                   | `animate/SKILL.md`   |
| **colorize**  | 给单色设计增添战略性色彩                   | `colorize/SKILL.md`  |
| **bolder**    | 放大保守设计的视觉冲击力                   | `bolder/SKILL.md`    |
| **quieter**   | 降低过度刺激设计的视觉强度                 | `quieter/SKILL.md`   |
| **delight**   | 添加愉悦体验、个性和惊喜触感               | `delight/SKILL.md`   |
| **overdrive** | 极致效果（着色器/弹簧物理/滚动驱动/60fps） | `overdrive/SKILL.md` |

### 📐 布局 & 排版
| 子技能      | 说明                                 | 路径               |
| ----------- | ------------------------------------ | ------------------ |
| **arrange** | 优化布局、间距和视觉节奏             | `arrange/SKILL.md` |
| **typeset** | 优化排版（字体/层级/尺寸/可读性）    | `typeset/SKILL.md` |
| **adapt**   | 响应式适配（断点/流式布局/触控目标） | `adapt/SKILL.md`   |

### 📝 内容 & 引导
| 子技能      | 说明                               | 路径               |
| ----------- | ---------------------------------- | ------------------ |
| **clarify** | 改善 UX 文案（错误消息/标签/说明） | `clarify/SKILL.md` |
| **onboard** | 设计引导流程和空状态               | `onboard/SKILL.md` |

---

## 参考指南（位于 frontend-design/reference/）

| 指南                    | 内容                         |
| ----------------------- | ---------------------------- |
| `typography.md`         | 字体比例、配对策略、加载优化 |
| `color-and-contrast.md` | OKLCH 色彩、调色板、暗色模式 |
| `spatial-design.md`     | 网格、节奏、容器查询         |
| `motion-design.md`      | 时序、缓动、减少动效偏好     |
| `interaction-design.md` | 表单、焦点、加载模式         |
| `responsive-design.md`  | 移动优先、流式设计、容器查询 |
| `ux-writing.md`         | 标签、错误消息、空状态文案   |

---

## 使用方式

### 首次使用
读取 `teach-impeccable/SKILL.md` 并执行，收集项目设计上下文。

### 日常使用
根据需求读取对应子技能的 SKILL.md：

```
# 审查当前页面质量
→ 读取 audit/SKILL.md

# UX 设计评审
→ 读取 critique/SKILL.md

# 发布前打磨
→ 读取 polish/SKILL.md

# 完整工作流：审查 → 修复 → 打磨
→ 依次读取 audit → normalize → polish
```

### 推荐工作流
1. `/audit` — 先了解问题在哪
2. 根据报告运行对应命令（如 `/normalize`、`/colorize`、`/typeset`）
3. `/polish` — 最后打磨
4. `/audit` — 再次审查确认改善

---

## 反模式清单（AI Slop 检测）

以下是 AI 生成 UI 的典型"指纹"，应当避免：
- ❌ 滥用 Inter/Roboto/Arial 等通用字体
- ❌ 紫色渐变配白色背景
- ❌ 到处使用玻璃态效果（glassmorphism）
- ❌ 灰色文字放在彩色背景上
- ❌ 卡片套卡片
- ❌ 弹跳/弹性缓动（感觉过时）
- ❌ 渐变色文字用于"冲击力"
- ❌ 纯黑(#000)/纯白(#fff)，应始终带色调
- ❌ 默认暗色模式 + 发光强调色
- ❌ 重复的卡片网格（图标 + 标题 + 文字无限循环）
