# 统一 AI 引擎管理 — 摩擦日志

> 记录跨任务的经验教训和踩坑记录。

---

## 已知注意事项（初始化时记录）

### 项目约束
- **文件读写限制**: 每次不超过 200 行
- **UserDatas 路径**: 所有配置数据必须存储在 `UserDatas/` 下
- **IPC 模式**: 使用 `ipcMain.handle` / `ipcRenderer.invoke` 模式
- **中文界面**: 所有面向用户的文本使用中文

### API 接入注意
- **阿里云**: Fun-ASR 用 DashScope 自有 API（不是 OpenAI 兼容），千问3-ASR 才走 OpenAI 兼容
- **火山引擎**: V3 认证全部走 Header（X-Api-*），不在 Body 中传认证信息
- **科大讯飞**: 只需 `appId` + `secretKey` 两个凭据，API 路径不带 `/v2/`，是 5 步流程
- **本地文件 URL**: 火山和阿里云需要公网 URL，讯飞可直接上传
