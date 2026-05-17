# Windsurf Team/组织 试用配额机制调研报告

> 调研日期：2026-05-17
> 信息来源：Windsurf 官方文档、第三方定价分析、windsurf-account-manager-simple 源码逆向、Reddit 社区

---

## 一、Windsurf 当前定价体系（2026 年 3 月新版）

### 1.1 套餐一览

| 套餐 | 价格 | 配额 | 说明 |
|------|------|------|------|
| **Free** | $0/月 | 25 credits/月 → 改为日/周 quota | 约 3-5 次有意义的 AI 会话 |
| **Pro** | $15/月 | 500 credits/月 → 改为日/周 quota | 新用户 2 周试用 + 100 credits |
| **Max** | 更高 | 更大 quota | 重度 Cascade 用户 |
| **Teams** | **$30/人/月** | **每人独立 500 credits → 日/周 quota** | 最多 200 席位 |
| **Enterprise** | $60/人/月 | 每人 1000 credits → ACU 计费 | SSO+SCIM 含内 |

### 1.2 2026年3月重大变更：Credit → Quota

- 旧系统：每条消息消耗 1 credit（premium 模型有乘数）
- **新系统**：基于 token 消耗的日/周 quota 预算，按日历日自动重置
- 日配额 > 周配额的 1/7（方便周末工作的用户）
- 超出 quota 后：Free 用户等重置，付费用户可购买 "Extra Usage"（按模型 API 价格计费）

### 1.3 试用政策（官方明确声明）

> **试用是促销活动，不是权利。**

官方明确排除以下人群的试用资格：
- ❌ 曾使用过 Windsurf / Devin / Codeium 的用户（**包括不同账号或不同套餐**）
- ❌ 系统预测不太可能购买 Pro 订阅的用户
- ❌ 被标记为疑似滥用、欺诈或违反 TOS 的用户

**资格由系统自动判定，不可申诉。**

---

## 二、Team（组织）机制详解

### 2.1 创建 Team 的流程

1. 访问 `windsurf.com/pricing` 选择 Teams 套餐
2. 选择席位数量（需要绑定信用卡付费）
3. 在 `windsurf.com/team/members` 管理邀请
4. 通过邮件或邀请链接添加成员

### 2.2 Team 配额分配机制

- **每人独立配额**：每个成员有自己的月度 credits/quota，**不共享不池化**
- **加购 credits 是池化的**：Admin 购买的 add-on credits 全组可用（$40/1000 credits）
- **席位上限**：Teams 最多 200 人，超过需要 Enterprise
- **Admin 权限**：只有 admin 可以取消计划、删除团队、移除用户

### 2.3 Devin 集成

- Devin 包含在现有 Windsurf 套餐中，**消耗相同的 quota/extra usage 余额**
- 首次连接 GitHub 到 Devin 时，赠送最多 **$50 extra usage credits**
- Enterprise 需要管理员在 Admin Portal 开启 Devin 访问权限

---

## 三、"Team 试用" 利用机制（实测验证）

### 3.1 核心发现（已实测确认 ✅）

用卖家提供的测试账号 `rhymynli74@gmail.com` 实际调用 API 验证：

```
一个 email 账号 → 2 个 org（组织）→ 2 个独立 session_token → 2 套独立配额
```

| | 个人 org | 团队 org |
|---|---|---|
| **Org ID** | org-72fda2e521234bfc... | org-4f6985466baa4dfa... |
| **名称** | lin | My Team |
| **套餐** | free | **pro-trial** ⭐ |
| **Account ID** | account-c897b8... | account-adf955...（不同！） |
| **session_token** | ✅ 独立 | ✅ 独立 |

### 3.2 技术流程（实测确认）

```
登录 → auth1_token（每次登录都会轮换，但 user_id 不变）
        ↓
WindsurfPostAuth(auth1_token, org_id="")  → 返回 2 个 org（无 session_token）
WindsurfPostAuth(auth1_token, org_id_personal) → session_token_A（free 配额）
WindsurfPostAuth(auth1_token, org_id_team)     → session_token_B（pro-trial 配额）⭐
```

**关键：Account ID 在不同 org 下不同** → 说明配额系统完全隔离，每个 org 有独立的 account。

### 3.3 卖家操作链路（已证实）

```
批量注册 Gmail 账号（零成本）
  ↓
登录获得 auth1_token
  ↓
创建 Team "My Team" → 自动获得 pro-trial（零成本！不需要绑卡）
  ↓
PostAuth(auth1_token, org_id_team) → 拿到 pro-trial 的 session_token
  ↓
¥1 一个 token 出售 → 买家获得 Pro 级别试用配额
```

### 3.4 经济学分析

- **成本**：¥0（注册 + 创建 Team 试用均免费）
- **收入**：¥1/token
- **利润率**：100%（纯自动化操作）
- **Pro 试用配额**：比 Free 的 25 credits 大得多（试用期内享受 Pro 级别配额）
- **复购驱动**：试用到期后 token 失效 → 买家需再次购买

### 3.5 为什么不是 ¥30 而是 ¥1？

之前推测卖家需要付费 $30/seat 创建 Team，实际不是：
- **Team 有免费试用期** → 创建 Team 不需要付费
- 试用期间享受 Pro 级别配额
- 试用到期后自动降级 → token 配额用完就废
- 这就是为什么 ¥1 就能卖 — 成本为零，卖的是时间有限的试用配额

---

## 四、限制与反滥用措施

### 4.1 官方已知的防御措施

| 措施 | 说明 |
|------|------|
| **试用资格自动判定** | 系统检测历史使用记录，跨账号/跨产品 |
| **Teams 席位上限** | 单个 Team 最多 200 人 |
| **信用卡绑定** | Teams/Enterprise 需要付费订阅 |
| **域名验证** | Enterprise 可验证域名，自动管理该域名下的用户 |
| **RBAC 权限** | 可以禁用特定用户的 Windsurf 访问 |
| **usage cap** | Admin 可以设置每用户 credit 上限 |

### 4.2 检测不到的限速

从我们之前的研究已知：
- `CheckUserMessageRateLimit` API → **检不到** overall message rate limit
- `GetUserStatus` API → **检不到** overall message rate limit
- 只有**实际走 Cascade 对话**才能检测到被限速

这意味着：即使账号实际已被限速/标记滥用，远程 API 查询可能仍返回"正常"。

---

## 五、对 windsurf-pool 的影响

### 5.1 当前问题

windsurf-pool 用 **email** 做账号去重 key → 同 email 不同 org 的 token 会互相覆盖。

### 5.2 卖家 token 的实质

| 类型 | 格式 | 有效期 | 可刷新 |
|------|------|--------|--------|
| **session_token** | `devin-session-token$...` | ~32 天（伪过期，实际看服务端） | 需要 auth1_token |
| **auth1_token** | `auth1_<52字符>` | 长期 | 是凭证根令牌 |

卖家通常只出售 `session_token`，不提供 `auth1_token`。这意味着：
- token 过期后**无法自动刷新**
- 买家需要再次购买新的 token

### 5.3 建议适配方向

1. **存储增强**：用 `email + orgId`（或 teamId）组合做唯一标识
2. **token 元数据**：记录每个 token 对应的 org/team 信息
3. **过期检测**：session_token 约 32 天伪过期，实际可能更短

---

## 六、核心结论

1. **卖家出售的是 Team/Org 级别的配额 token**，不是账号级别的
2. **每个 org 有独立配额池**，同一账号可以通过关联多个 org 获得多份配额
3. **创建 Team 需要付费**（$30/seat/月），不是免费的
4. **Free 试用已有反滥用系统**，不保证每个新账号都能获得试用
5. **2026年3月起改为 quota 制**，日/周 quota 自动重置，对比旧 credit 制更难囤积
6. **session_token 无法自动续期**（除非有 auth1_token），卖家商业模式依赖买家重复购买
