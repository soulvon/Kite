# Kite

Kite 是面向 Windsurf / Devin 的 AI IDE 增强套件，聚焦界面增强、多实例分身、多账号号池、自动恢复与长任务自动化。

[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)]()

## 核心能力

- 无感换号：在不退出、不重启、不丢失当前会话的前提下切换账号。
- 智能号池：按额度、套餐、标签、到期状态等维度筛选和排序账号。
- 自动恢复：识别配额耗尽、认证失效、网络中断、上下文超限等常见错误，并按策略重试或切号。
- 长任务自动化：支持队列消息、持续继续、权限确认和完成提醒。
- 多实例分身：每个 IDE 窗口使用独立 user-data 目录和账号绑定，适合并行任务。
- IDE 增强：界面汉化、回复建议、状态栏、提示音、校验值修复等本地增强能力。

## 相关项目

模型路由、API 中转、自带 Key、BYOK 等能力不再内置在 Kite 中，后续由独立项目 AnyBridge 承担：

[soulvon/AnyBridge](https://github.com/soulvon/AnyBridge)

这样 Kite 保持为轻量的 IDE 增强与账号工作流工具，AnyBridge 专注模型与 API 层能力。

## 开发

```bash
npm install
npm run compile
```

打包 VSIX：

```bash
npm run package
```

## 隐私

- 账号会话、密码和导入 token 使用 VS Code `ExtensionContext.secrets` 存储。
- Kite 不上传账号数据，不做远程遥测。
- 外部请求仅用于登录、配额查询和 Windsurf / Devin 官方接口调用。
- 补丁和增强只作用于本机 IDE 安装目录。

## 使用边界

Kite 仅供本地账号管理、个人效率增强和学习研究使用。使用前请确认符合 Windsurf / Devin 的服务条款。

## License

MIT
