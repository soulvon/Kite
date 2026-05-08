---
name: feedback-pull
description: 从 Supabase 拉取用户反馈，AI 分类去重，生成 Markdown 任务文件。触发词：/反馈拉取、拉取反馈、pull feedback
---

# 反馈拉取 Skill

从 Supabase 拉取未处理的用户反馈，使用 AI 自动分类、评优先级、去重，生成结构化 Markdown 报告。

## 前置条件

1. Supabase 项目已配置（见 `spec/72_用户反馈收集系统(FEEDBACK_COLLECTION).md`）
2. 需要 `service_role` key（不是 `anon` key）放在 `.env.local`：
   ```env
   SUPABASE_SERVICE_KEY=eyJ...你的service_role_key
   ```
3. Node.js 环境可用

## 执行流程

### Step 1: 拉取数据

```bash
# 在项目根目录执行
node .agent/skills/feedback-pull/scripts/pull.mjs
```

脚本会：
1. 用 `service_role` key 连接 Supabase
2. 查询 `status = 'open'` 的反馈
3. 下载关联的截图和日志包到 `spec/feedback/attachments/`
4. 解压 gzip 日志为可读 JSON
5. 输出原始数据到 `spec/feedback/raw-{date}.json`

### Step 2: AI 分析

拿到原始数据后，使用 AI 进行分析。将以下 prompt 和原始数据一起发给 AI：

```
你是 GenStudio 的产品经理。请分析以下用户反馈数据，完成：

1. **分类**：将每条反馈分为 bug / feature / question / other
2. **优先级**：P0（崩溃/数据丢失）/ P1（功能异常）/ P2（体验优化）/ P3（建议）
3. **去重**：识别描述相似问题的反馈，合并为一条
4. **摘要**：为每条反馈生成一行摘要
5. **趋势**：按 device_id 统计活跃设备和高频问题

输出格式参见 spec/72 文档的第 5 节示例。
```

### Step 3: 生成报告

AI 分析完成后，将结果保存为 Markdown：

```
spec/feedback/
├── report-2026-04-20.md     ← 本次拉取报告
├── raw-2026-04-20.json      ← 原始数据
└── attachments/
    ├── {id}/screenshot.webp
    └── {id}/logs.json       ← 解压后的日志
```

### Step 4: 回写状态（可选）

分析完成后，可以将 AI 分类结果回写到 Supabase：

```javascript
// 使用 service_role key 更新
await supabase.from('feedback').update({
  ai_category: 'bug',
  ai_priority: 'P1',
  ai_summary: '导出卡在 99%',
  status: 'resolved',  // 或保持 open
}).eq('id', feedbackId);
```

## 报告模板

```markdown
# 反馈拉取报告 — {日期}

| 统计     | 数量           |
| -------- | -------------- |
| 新增反馈 | {count}        |
| Bug      | {bugCount}     |
| 功能建议 | {featureCount} |
| 去重合并 | {dupCount}     |
| 独立设备 | {deviceCount}  |

## 🔴 P0 - 紧急
{列表}

## 🟠 P1 - 重要
{列表}

## 🟡 P2 - 优化
{列表}

## 🟢 P3 - 建议
{列表}

## 📊 设备活跃度
{按 device_id 统计}
```

## 注意事项

- `service_role` key 拥有全部权限，**绝对不要** 提交到 Git
- 拉取脚本仅在开发者本地执行，不打包进应用
- 截图和日志仅保存在本地 `spec/feedback/` 目录

## ⚠️ 故障排查（拉取失败时必读）

### 🔴 首先检查：Supabase 项目是否被暂停

Supabase **免费版**会在项目 **7 天无任何 API 请求**时自动暂停。暂停后所有 API 请求都会返回 `ECONNRESET` / `ERR_CONNECTION_CLOSED`。

**症状**：`fetch failed`、`ECONNRESET`、`ERR_CONNECTION_CLOSED`，且所有连接方式（Node.js、curl、浏览器）都失败。

**验证方法**：在浏览器打开 `https://supabase.com/dashboard/project/kraddlasqxxokkwceprq`，如果看到 **"项目目前暂停"** 提示，就是这个原因。

**解决**：点 Supabase 仪表盘上的 **"Resume Project"（简历项目）** 按钮恢复，等待几分钟生效。

**预防**：已在 `src/main.tsx` 中添加心跳，每次 GenStudio 启动时自动 ping Supabase 保活。如果长时间不开 GenStudio，项目仍可能被暂停。

### 其他可能原因（按优先级排序）

1. **环境变量未配置**：检查 `.env.local` 中是否有 `SUPABASE_SERVICE_KEY`
2. **Key 过期/无效**：在 Supabase 仪表盘 Settings → API 页面确认 key 是否正确
3. **网络问题**：浏览器打开 Supabase URL 确认能否访问。如果浏览器也打不开，那就是网络/代理问题
4. **⛔ 不要盲目怀疑 Node.js 版本、代理配置、Fake IP 等** — 先用浏览器确认 Supabase 本身是否可达
