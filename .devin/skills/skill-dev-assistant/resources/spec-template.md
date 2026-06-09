# {{技能名称}} 设计规格

> 创建日期：{{日期}}  
> 状态：**设计中**  
> 版本：1.0

---

## 一、产品概述

### 1.1 背景

{{描述这个技能要解决什么问题}}

### 1.2 核心能力

```
{{流程图}}
```

---

## 二、输入输出定义

### 2.1 输入参数

```typescript
interface SkillInput {
  // TODO: 定义输入
}
```

### 2.2 输出结果

```typescript
interface SkillOutput {
  // TODO: 定义输出
}
```

---

## 三、用户流程

### 3.1 主流程

```
Step 1: ...
Step 2: ...
Step 3: ...
```

---

## 四、服务架构

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│ SkillPage (React Component)                                        │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ SkillService                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心服务

```typescript
// services/SkillService.ts

export class SkillService {
  async generate(input: SkillInput): Promise<SkillOutput> {
    // TODO: 实现
  }
}
```

---

## 五、Prompt 设计

### 5.1 System Prompt

```
TODO: 定义 System Prompt
```

### 5.2 User Prompt

```
TODO: 定义 User Prompt，使用 {{变量}} 占位
```

---

## 六、目录结构

```
src/features/skills/skills/{{SkillName}}/
├── index.tsx                      # 技能页面入口
├── config.ts                      # 配置常量
├── types.ts                       # 类型定义
└── services/
    └── SkillService.ts            # 核心服务
```

---

## 七、实施计划

### Phase 1：核心功能

- [ ] 服务实现
- [ ] 基础 UI
- [ ] 验证完整流程

### Phase 2：增强功能

- [ ] 批量生成模式
- [ ] 更多配置选项
