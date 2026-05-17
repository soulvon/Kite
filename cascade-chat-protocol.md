# Windsurf Cascade 对话协议逆向文档

## 概述

Windsurf 的对话功能已从旧的 `GetChatMessage` 迁移到 **Cascade** 架构。旧接口 `GetChatMessage` 在本地语言服务器上标记为 `deprecated`，返回 `unimplemented`。

本文档记录了通过逆向 Go 二进制和 extension.js 得到的完整 Cascade 对话协议。

---

## 架构

```
Extension (JS) → 本地 Go 二进制 (language_server_macos_arm) → 云端 (server.self-serve.windsurf.com)
                  ↑ 监听本地端口，gRPC + JSON                    ↑ Connect-RPC
```

- **协议**: gRPC over HTTP/1.1，Content-Type `application/grpc+json`
- **认证**: 请求头 `x-codeium-csrf-token` + metadata 中的 `apiKey`
- **服务路径**: `exa.language_server_pb.LanguageServerService`

---

## 本地语言服务器连接信息

### 获取进程 PID
```bash
ps aux | grep 'language_server_macos' | grep windsurf | grep -v grep
```

### 获取 CSRF Token
```bash
ps eww -p <PID> | grep -o 'WINDSURF_CSRF_TOKEN=[^ ]*' | cut -d= -f2
```

### 获取监听端口
```bash
lsof -i -P -n -p <PID> -a 2>/dev/null | grep LISTEN
```

### 获取 IDE 版本号（关键！版本太旧会被拒绝）
```bash
ps eww -p <PID> | tr ' ' '\n' | grep -A1 'windsurf_version'
# 输出示例: 2.2.17
```

---

## gRPC 帧格式

所有请求/响应使用 5 字节头 + JSON payload：

```
[1字节 flags][4字节 大端长度][JSON payload]
```

- flags: 0x00 = 普通数据
- 长度: payload 的字节数（大端 uint32）

### 构造示例 (Python)
```python
import struct, json
payload = json.dumps(request_obj).encode()
frame = struct.pack('>BI', 0, len(payload)) + payload
```

### 构造示例 (Node.js)
```javascript
function grpcFrame(obj) {
  const p = Buffer.from(JSON.stringify(obj));
  const h = Buffer.alloc(5);
  h.writeUInt32BE(p.length, 1);
  return Buffer.concat([h, p]);
}
```

---

## HTTP 请求格式

```http
POST /exa.language_server_pb.LanguageServerService/<方法名> HTTP/1.1
Host: 127.0.0.1:<PORT>
Content-Type: application/grpc+json
x-codeium-csrf-token: <CSRF_TOKEN>
te: trailers
Content-Length: <帧总长度>

<gRPC 帧>
```

### curl 示例
```bash
curl -s --raw -m 30 -X POST \
  "http://127.0.0.1:<PORT>/exa.language_server_pb.LanguageServerService/StartCascade" \
  -H "Content-Type: application/grpc+json" \
  -H "x-codeium-csrf-token: <CSRF>" \
  -H "te: trailers" \
  --data-binary @request.bin
```

---

## Metadata 结构（所有请求必填）

```json
{
  "metadata": {
    "ideName": "windsurf",
    "ideVersion": "2.2.17",
    "extensionName": "windsurf-next",
    "extensionVersion": "2.2.17",
    "apiKey": "<账号的 apiKey>"
  }
}
```

**⚠️ `ideVersion` 必须是当前最新版本号，否则会返回 "Your Windsurf version is out of date"。**

---

## 完整对话流程

### 第一步：StartCascade（创建会话）

**路径**: `/exa.language_server_pb.LanguageServerService/StartCascade`

**请求体**:
```json
{
  "metadata": { ... },
  "chatMessages": [
    {
      "messageId": "<UUID>",
      "conversationId": "<UUID>",
      "source": 1,
      "prompt": "你好",
      "timestamp": "2026-05-14T20:00:00Z"
    }
  ]
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| metadata | object | ✅ | 见上方 Metadata 结构 |
| chatMessages | array | ✅ | 至少 1 条消息 |
| chatMessages[].messageId | string | ✅ | UUID，≥1 字符 |
| chatMessages[].conversationId | string | ✅ | UUID，≥1 字符 |
| chatMessages[].source | int | ✅ | 1 = USER |
| chatMessages[].prompt | string | ✅ | 用户消息内容 |
| chatMessages[].timestamp | string | ✅ | RFC 3339 时间戳 |

**响应**:
```json
{
  "cascadeId": "b1124738-69e6-41a8-ab93-ac500b3f82fa"
}
```

---

### 第二步：SendUserCascadeMessage（触发模型调用）

**路径**: `/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`

**请求体**:
```json
{
  "metadata": { ... },
  "cascadeId": "<第一步返回的 cascadeId>",
  "items": [
    { "text": "你好" }
  ],
  "cascadeConfig": {
    "plannerConfig": {
      "plannerTypeConfig": { "conversational": {} },
      "requestedModelUid": "MODEL_SWE_1_5",
      "planModelUid": "MODEL_SWE_1_5"
    }
  }
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| metadata | object | ✅ | |
| cascadeId | string | ✅ | StartCascade 返回的 ID |
| items | array | ✅ | TextOrScopeItem 数组 |
| items[].text | string | | oneof chunk 的 text 分支 |
| cascadeConfig | object | ✅ | 包含模型配置 |
| cascadeConfig.plannerConfig.plannerTypeConfig | object | | `{conversational: {}}` |
| cascadeConfig.plannerConfig.requestedModelUid | string | ✅ | 模型名（字符串） |
| cascadeConfig.plannerConfig.planModelUid | string | ✅ | 同 requestedModelUid |

**可用模型**:
| 模型 | 枚举值 | 说明 |
|------|--------|------|
| MODEL_SWE_1_5 | 非 legacy | ✅ 推荐 |
| MODEL_SWE_1_6 | | 未识别 |
| MODEL_SWE_1_6_FAST | | |
| MODEL_CHAT_11121 | legacy | ❌ 已弃用 |

**响应**: `{}` + `Grpc-Status: 0`（异步处理，结果通过步骤获取）

---

### 第三步：GetCascadeTrajectorySteps（获取结果）

**路径**: `/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps`

**请求体**:
```json
{
  "metadata": { ... },
  "cascadeId": "<cascadeId>"
}
```

**响应**:
```json
{
  "steps": [
    {
      "type": "CORTEX_STEP_TYPE_RETRIEVE_MEMORY",
      "status": "CORTEX_STEP_STATUS_DONE"
    },
    {
      "type": "CORTEX_STEP_TYPE_MEMORY",
      "status": "CORTEX_STEP_STATUS_DONE"
    },
    {
      "type": "CORTEX_STEP_TYPE_USER_INPUT",
      "status": "CORTEX_STEP_STATUS_DONE"
    },
    {
      "type": "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
      "status": "CORTEX_STEP_STATUS_DONE",
      "plannerResponse": {
        "response": "\n我在",
        "modifiedResponse": "我在",
        "messageId": "bot-<uuid>"
      }
    }
  ]
}
```

**需要轮询**：建议每 5 秒调一次，直到没有 `RUNNING`/`PENDING` 状态的步骤。

---

## 步骤类型与状态

### 正常对话步骤顺序
1. `RETRIEVE_MEMORY` → DONE
2. `MEMORY` → DONE
3. `USER_INPUT` → DONE
4. `PLANNER_RESPONSE` → DONE（**包含 AI 回复**）
5. `CHECKPOINT` → DONE

### 错误情况
步骤 4 变为 `ERROR_MESSAGE`，包含错误信息：

```json
{
  "type": "CORTEX_STEP_TYPE_ERROR_MESSAGE",
  "errorMessage": {
    "error": {
      "userErrorMessage": "错误描述"
    }
  }
}
```

---

## 账号状态判断

| 错误信息 | 账号状态 |
|----------|---------|
| 无 ERROR_MESSAGE，有 PLANNER_RESPONSE | ✅ **正常** |
| `Your daily usage quota has been exhausted` | ⚠️ **配额耗尽** |
| `Reached overall message rate limit` | ❌ **被封禁** |
| `Your Windsurf version is out of date` | ⚙️ **版本号错误** |
| 401 / Key 已失效 | ❌ **Token 失效** |

---

## 辅助接口

### CheckUserMessageRateLimit
```
POST /exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit
Content-Type: application/json
Connect-Protocol-Version: 1
```
```json
{"metadata": {...}, "modelUid": "MODEL_SWE_1_5"}
```
⚠️ **此接口不反映封禁状态**，被封账号仍返回 `hasCapacity: true`。

### GetUserStatus
```
POST /exa.seat_management_pb.SeatManagementService/GetUserStatus
```
⚠️ **此接口不反映封禁状态**，被封账号仍返回正常的 planStatus。

### CheckChatCapacity（云端直连）
```
POST /exa.api_server_pb.ApiServerService/CheckChatCapacity
```
⚠️ 同样不反映封禁。

**结论：只有通过实际触发 Cascade 对话流程，才能准确检测封禁状态。**

---

## 已弃用接口

| 接口 | 状态 |
|------|------|
| `LanguageServerService/GetChatMessage` | `unimplemented: GetChatMessage is deprecated :)` |

---

## 逆向方法参考

### 利用服务器验证探测字段名
发送空或不完整请求，服务器会返回缺少哪个字段：

```bash
# 空请求 → "metadata: value is required"
# 加 metadata → "metadata.ide_name: value length must be at least 1"
# 加 ide_name → "metadata.api_key: value length must be at least 1"
# ...逐步补全所有必填字段
```

### 从 Go 二进制提取方法和字段
```bash
# 列出所有 RPC 方法
strings language_server_macos_arm | grep -E '^(Start|Get|Send|Stream|Create|Check).*Request$'

# 提取某个请求的 getter 方法（即字段名）
strings language_server_macos_arm | grep 'SendUserCascadeMessageRequest).Get'

# 提取嵌套结构字段
strings language_server_macos_arm | grep 'PlannerConfig).Get'
```

### 从 extension.js 提取 proto 定义
```bash
# 类定义（字段名和类型）
grep -oE 'class [A-Za-z]+ extends [a-z.]*Message\{metadata;cascadeId[^}]*\}'

# 字段编号和类型
grep -oE '\{no:\d+,name:"plan_model_name"[^}]*\}'

# 枚举值
grep -oE 'MODEL_SWE_1_5[^]]*\]='
```
