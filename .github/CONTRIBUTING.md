# Kite 贡献指南 (Contributing Guide)

感谢你对 Kite 感兴趣并愿意参与贡献！Kite 是面向 Windsurf / Devin 的 AI IDE 增强套件。

## 🎯 如何参与

1. **反馈 Bug**：如果在日常使用中遇到问题，欢迎前往 [Issues](https://github.com/soulvon/Kite/issues) 提交 Bug 报告。
2. **提出功能建议**：有好的点子或改进思路？欢迎提交 [Feature Request](https://github.com/soulvon/Kite/issues/new/choose) 或在 [Discussions](https://github.com/soulvon/Kite/discussions) 中发起讨论。
3. **提交代码 (Pull Request)**：
   - Fork 本仓库到你的个人 GitHub 账号。
   - 创建你的特性分支（例如 `git checkout -b feature/awesome-feature` 或 `git checkout -b fix/bug-fix`）。
   - 本地开发与测试（执行 `npm run compile` 确保编译通过）。
   - 提交代码并推送到你的 Fork 仓库。
   - 在 GitHub 上向 `soulvon/Kite` 提交 Pull Request。

## 🛠️ 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 编译 TypeScript
npm run compile

# 3. 监听模式编译
npm run watch

# 4. 打包 VSIX 插件包
npm run package
```

## 📋 提交规范

- 提交 PR 时请清晰填写 PR 模板中的改动说明与验证方式。
- 保证代码风格与现有项目一致，避免引入无关的格式化改动。
