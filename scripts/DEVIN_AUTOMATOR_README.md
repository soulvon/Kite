# Devin AI 任务自动化脚本

自动完成 Devin AI 的引导任务，获取 $200 积分奖励。

## 任务清单

| 任务 | 奖励 | 触发条件 |
|------|------|----------|
| devin_review | - | 使用 Devin 代码审查 |
| connect_integration | - | 连接 GitHub/GitLab |
| **automations** | **$200** | 访问 automations 页面 |

## 安装依赖

```bash
# 基础依赖
pip install requests

# 浏览器模式额外依赖
pip install playwright
playwright install chromium
```

## 使用方法

### 1. 协议模式 (API)

需要先从浏览器获取 Cookie:
1. 登录 https://app.devin.ai
2. 打开开发者工具 (F12) → Network
3. 刷新页面，找到任意请求
4. 复制 Request Headers 中的 Cookie 值

```bash
python devin_automator.py --mode api --cookie "session=xxx; ..."
```

### 2. 浏览器模式

自动打开浏览器完成 GitHub OAuth 登录:

```bash
# 有头模式（可看到浏览器）
python devin_automator.py --mode browser --github-user xxx --github-pass xxx

# 无头模式（后台运行）
python devin_automator.py --mode browser --github-user xxx --github-pass xxx --headless
```

### 3. 批量模式

从 JSON 文件读取多个账号:

```bash
python devin_automator.py --mode batch --accounts accounts.json
```

## 账号文件格式

`accounts.json`:
```json
[
  {"github_user": "user1", "github_pass": "pass1"},
  {"github_user": "user2", "github_pass": "pass2"},
  {"email": "email@example.com", "password": "xxx"},
  {"cookie": "session=xxx"}
]
```

## API 端点参考

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth1/password/login` | POST | 邮箱密码登录 |
| `/api/users/post-auth` | POST | 登录后初始化 |
| `/api/organizations` | GET | 获取组织列表 |
| `/api/billing/checklist-credit-status` | GET | 获取任务状态 |
| `/api/{org_id}/automations` | GET | 获取自动化列表 |
| `/api/users/preferences` | POST | 标记引导完成 |

## 关键 Headers

```
Cookie: session=xxx
x-cog-org-id: org-xxx
Accept: application/json
```

## 任务状态响应示例

未完成:
```json
{
  "completion": {"devin_review": false, "connect_integration": false, "automations": false},
  "amounts": {"automations": 200},
  "granted": {},
  "unit": "dollars"
}
```

已完成:
```json
{
  "completion": {"devin_review": false, "connect_integration": false, "automations": true},
  "amounts": {},
  "granted": {"automations": 200},
  "unit": "dollars"
}
```

## ⚠️ 风险提示

1. **违反 ToS**: 批量操作可能导致账号被封禁
2. **IP 限制**: 同 IP 大量请求可能触发风控
3. **GitHub 2FA**: 如果账号开启了 2FA，需要手动处理
4. **账号安全**: 请勿在不安全的环境存储密码

## 常见问题

### Q: 提示 "post-auth 失败"
A: Cookie 已过期，需要重新获取

### Q: GitHub 登录卡住
A: 可能是 2FA 或需要验证设备，建议用有头模式手动处理

### Q: 任务未完成但没报错
A: 可能需要先完成 GitHub 连接任务 (connect_integration)
