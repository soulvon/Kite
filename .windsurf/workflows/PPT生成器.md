---
description: 启动互动 PPT 生成器逻辑
---

1. 读取内容文件：`内容工厂功能亮点.md`
2. 调用技能：`ppt-interactive-html-gen`
3. 使用 `boilerplate.html` 作为基础
4. 应用 `design-spec.md` 的赛博风格
5. 输出至目录：`PPT/`
6. **注意：禁止执行 packaging/打包逻辑，不产生 .skill 文件**
