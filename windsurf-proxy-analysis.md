## Windsurf-Proxy 核心原理与架构设计白皮书

本文档深度剖析 `windsurf-proxy` 项目的核心设计、运行机制、拦截技术以及底层的协议转码原理。

---

## 1. 整体架构与流量拓扑

`windsurf-proxy` 的核心目标是在保留免费 Codeium 账号的**自动补全、用户登录、云端遥测**等周边生态功能的前提下，将核心的 LLM 后端（Cascade 聊天与行内 AI 编辑）完美替换为你自己的 Anthropic/OpenAI API Key。

整个系统由两个独立的本地 Node.js 代理服务、VS Code 插件补丁以及证书链体系构成：

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; border: 1px solid #111111; border-radius: 4px; background: #ffffff; margin: 24px 0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.04); color: #111111; max-width: 680px;">
<div style="background: #111111; padding: 12px 16px; border-bottom: 1px solid #111111; display: flex; justify-content: space-between; align-items: center; color: #ffffff;">
<span style="font-weight: bold; font-size: 11px; font-family: monospace; letter-spacing: 0.5px;">DIAGRAM-01: WINDSURF PROXY SYSTEM TOPOLOGY</span>
<span style="font-size: 8px; font-family: monospace; background: #222222; color: #ffffff; padding: 2px 6px; border-radius: 2px;">ACTIVE ROUTING</span>
</div>
<div style="padding: 20px; display: flex; flex-direction: column; gap: 16px; background: #ffffff;">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
<div style="border: 1px solid #111111; padding: 10px; border-radius: 2px; background: #fafafa; width: 200px; text-align: center; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px;">Windsurf Extension</div>
<div style="font-size: 9px; font-family: monospace; color: #666666; margin-top: 2px;">dist/extension.js</div>
<div style="font-size: 8px; color: #c0392b; margin-top: 4px; font-weight: bold; font-family: monospace;">[ P1 / P2 / P3 Patched ]</div>
</div>
<div style="flex: 1; height: 1px; background: #111111; position: relative; display: flex; justify-content: center; align-items: center;">
<span style="font-size: 8px; color: #555555; background: #ffffff; padding: 0 4px; font-family: monospace;">spawns</span>
</div>
<div style="border: 1px solid #111111; padding: 10px; border-radius: 2px; background: #111111; color: #ffffff; width: 200px; text-align: center; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px;">language_server Binary</div>
<div style="font-size: 8px; font-family: monospace; color: #999999; margin-top: 2px;">Go Compiled Core</div>
</div>
</div>
<div style="display: flex; justify-content: flex-end; padding-right: 90px; margin-top: -8px; margin-bottom: -8px;">
<div style="height: 20px; width: 1px; background: #111111; position: relative;"></div>
</div>
<div style="display: flex; gap: 16px; justify-content: center;">
<div style="border: 1px solid #111111; border-radius: 2px; background: #fafafa; padding: 12px; flex: 1; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 10px; font-family: monospace; border-bottom: 1px solid #111111; padding-bottom: 4px; margin-bottom: 6px;">PORT 3000 (HTTP/1.1)</div>
<div style="font-size: 10px; color: #333333; line-height: 1.4;">
🔓 <b>hybrid-server.js</b><br>
终结 <code>server.codeium.com</code> 的 TLS 连接。拦截 <code>GetChatMessage</code>，重写登录返回。
</div>
</div>
<div style="border: 1px solid #111111; border-radius: 2px; background: #fafafa; padding: 12px; flex: 1; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 10px; font-family: monospace; border-bottom: 1px solid #111111; padding-bottom: 4px; margin-bottom: 6px;">PORT 3001 (HTTP/2)</div>
<div style="font-size: 10px; color: #333333; line-height: 1.4;">
⚡ <b>inference-proxy.js</b><br>
承接流式 HTTP/2 流量。拦截行内编辑 <code>GetChatMessage</code> 消息，放行自动补全。
</div>
</div>
</div>
</div>
</div>

---

## 2. 三大核心内鬼补丁 (Patches)

Windsurf 的后台服务由 Go 二进制文件（`language_server`）承载，其网络端点参数由 JavaScript 扩展端（`extension.js`）在启动时动态计算传入。代理通过对 `extension.js` 实施精准的三处正则替换实现流量劫持：

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border: 1px solid #111111; border-radius: 4px; background: #ffffff; margin: 24px 0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.04); color: #111111; max-width: 680px;">
<div style="background: #111111; padding: 12px 16px; border-bottom: 1px solid #111111; color: #ffffff; font-weight: bold; font-size: 11px; font-family: monospace; letter-spacing: 0.5px;">
SPEC-02: JS PATCH INJECTION ANALYSIS
</div>
<div style="padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #ffffff;">
<div style="border: 1px solid #e1e1e1; padding: 12px; border-radius: 2px; background: #fafafa; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px; color: #111111; margin-bottom: 4px;">P1 // getApiServerUrlFromContext 信标劫持</div>
<div style="font-size: 10px; color: #555555; line-height: 1.5;">
• <b>拦截位置</b>: <code>getApiServerUrlFromContext</code> 返回逻辑。<br>
• <b>机制描述</b>: 屏蔽读取官方服务器地址，直接硬编码返回 <code>http://localhost:3000</code>。让 Go 在加载时默认连向本地。
</div>
</div>
<div style="border: 1px solid #e1e1e1; padding: 12px; border-radius: 2px; background: #fafafa; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px; color: #111111; margin-bottom: 4px;">P2 // restart(A) 重启锁死</div>
<div style="font-size: 10px; color: #555555; line-height: 1.5;">
• <b>拦截位置</b>: 账号登录重刷调用的 <code>restart(A)</code> 接口。<br>
• <b>机制描述</b>: 在重启动作触发时，将传入的外部 URL 参数 <code>A</code> 暴力改写回 <code>http://localhost:3000</code>，防范配置回刷。
</div>
</div>
<div style="border: 1px solid #e1e1e1; padding: 12px; border-radius: 2px; background: #fafafa; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px; color: #111111; margin-bottom: 4px;">P3 // INFERENCE_API_SERVER_URL 终点重定向</div>
<div style="font-size: 10px; color: #555555; line-height: 1.5;">
• <b>拦截位置</b>: 推理服务器参数加载端点。<br>
• <b>机制描述</b>: 强制将推理集群 URL 设置为 <code>http://localhost:3001</code>，夺取行内快捷修码与 AI 行内编辑的主动权。
</div>
</div>
</div>
</div>

---

## 3. 双模代理与 TLS 终结机制 (Port 3000)

`hybrid-server.js` 绑定本地 `3000` 端口，通过接管 `connect` 事件同时支持两套完全不同的代理链路：

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border: 1px solid #111111; border-radius: 4px; background: #ffffff; margin: 24px 0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.04); color: #111111; max-width: 680px;">
<div style="background: #111111; padding: 12px 16px; border-bottom: 1px solid #111111; color: #ffffff; font-weight: bold; font-size: 11px; font-family: monospace; letter-spacing: 0.5px;">
SPEC-03: DUAL PASS FILTER SPECIFICATION
</div>
<div style="padding: 16px; display: flex; gap: 16px; background: #ffffff;">
<div style="flex: 1; border: 1px solid #e1e1e1; padding: 12px; border-radius: 2px; background: #fafafa; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px; color: #111111; margin-bottom: 6px;">🔓 盲管道转发 (Passthrough)</div>
<div style="font-size: 10px; color: #555555; line-height: 1.6;">
针对非核心遥测、登录及应用市场等（如 <code>register.codeium.com</code>），不解密其 TLS 连接，直接通过两端 socket 建立无阻碍管道原样放行，保留免费账号全部生态。
</div>
</div>
<div style="flex: 1; border: 1px solid #e1e1e1; padding: 12px; border-radius: 2px; background: #fafafa; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 11px; color: #111111; margin-bottom: 6px;">🔑 MITM 深度解密 (Decryption)</div>
<div style="font-size: 10px; color: #555555; line-height: 1.6;">
专门截击 <code>server.self-serve.windsurf.com</code>。加载本地 mkcert CA 伪造证书终结 TLS。截获核心的 <code>GetChatMessage</code> 消息，并在 <code>RegisterUser</code> 返回时重写云端下发配置。
</div>
</div>
</div>
</div>

---

## 4. Connect-RPC 帧格式与无 Schema 解码

Windsurf 在传输层上没有使用标准的 HTTP gRPC 协议，而是选用了 **Connect-RPC** 协议（即通过 HTTP POST 承载带有 5 字节 Connect 帧头的数据流）。

<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; border: 1px solid #111111; border-radius: 4px; background: #ffffff; margin: 24px 0; overflow: hidden; max-width: 680px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
<div style="background: #111111; padding: 10px 16px; color: #ffffff; font-weight: bold; font-size: 11px; font-family: monospace; letter-spacing: 0.5px;">
SPEC-04: CONNECT-RPC GRPC ENVELOPE STRUCT
</div>
<div style="padding: 16px; background: #ffffff; font-size: 11px; line-height: 1.7; color: #333333;">
<div style="display: flex; border: 1px solid #111111; font-family: monospace; text-align: center; margin-bottom: 12px; background: #fafafa;">
<div style="flex: 1; border-right: 1px solid #111111; padding: 6px;">
<b>Flags (1 Byte)</b><br><span style="color: #666666; font-size: 10px;">0x01: Gzip / 0x03: EOS</span>
</div>
<div style="flex: 2; border-right: 1px solid #111111; padding: 6px;">
<b>Length (4 Bytes, BE)</b><br><span style="color: #666666; font-size: 10px;">Payload Size (UInt32BE)</span>
</div>
<div style="flex: 4; padding: 6px;">
<b>Serialized Payload (N Bytes)</b><br><span style="color: #666666; font-size: 10px;">Gzipped Protobuf Data</span>
</div>
</div>
<div style="border-left: 2px solid #111111; padding-left: 10px; color: #555555; line-height: 1.6;">
• <b>解帧设计 (connect.js)</b>：解析前置 5 字节帧头。如果是压缩包（Flags = 1），通过 <code>gunzipSync</code> 剥离外壳并解压。<br>
• <b>无 Schema 解码 (proto.js)</b>：利用变长整型解码 <code>decodeVarint</code> 递归读取二进制，直接定位 System Prompt (字段 2)、上下文历史 (字段 3)、客户端工具定义 (字段 10) 及模型名称 (字段 21)。
</div>
</div>
</div>

---

## 5. 消息协议逆向与严格角色并组

### 角色转换映射

通过二进制逆向后，我们恢复了消息来源的枚举关系（`ChatMessageSource`）：

<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; border: 1px solid #111111; border-radius: 4px; background: #ffffff; margin: 24px 0; overflow: hidden; max-width: 680px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
<div style="background: #111111; padding: 10px 16px; color: #ffffff; font-weight: bold; font-size: 11px; font-family: monospace; letter-spacing: 0.5px;">
SPEC-05: ROLE COLLAPSE & STATE ALIGNMENT
</div>
<div style="padding: 16px; background: #ffffff; font-size: 11px; line-height: 1.7; color: #333333;">
<div style="border-left: 3px solid #111111; padding: 8px 16px; background: #fafafa; margin-bottom: 12px; font-size: 11px; color: #444444;">
<strong>冲突防御原理：</strong> Windsurf 在并发工具调用时，常返回连续的 <code>TOOL</code> (Source: 4) 块，转换后会产生连续的多个 <code>user</code> 消息。若不干预，直接发给 API 必定触发 Anthropic 严格交替报错熔断。
</div>
<div style="font-weight: bold; margin-bottom: 6px;">映射与并组流水线 (parse-request.js)：</div>
<div style="padding-left: 12px; font-family: monospace; color: #555555;">
- USER (Source: 1) ─────────► <code>user</code> 角色<br>
- SYSTEM/UNKNOWN (2/3) ────► <code>assistant</code> 角色（提取字段 11 注入思维链）<br>
- TOOL (Source: 4) ─────────► <code>tool_result</code> 并组至前序 <code>user.content</code> 数组<br>
- 连续角色消息 ──────────────► 启动 <code>mergeConsecutiveMessages</code> 自动规并
</div>
</div>
</div>

---

## 6. SSE 逆向流状态机封装

自定义大模型以流式文本事件（Server-Sent Events）格式回传时，代理层必须将其转换为客户端二进制识别的 Connect 帧，并通过流的方式返回。

```
[自定义 LLM 吐字] 
       │
       ▼ (Event Parser: parseSSEChunk)
 提取出：text_delta / thinking_delta / signature_delta / input_json_delta
       │
       ▼ (二进制编译封装: build-response.js)
  - text 碎片        ──► buildTextDelta (Field 3)
  - 思维链碎片        ──► buildThinkingDelta (Field 9)
  - 完整工具入参     ──► 缓冲input_json，在 block_stop 时 buildToolCallDelta (Field 6)
       │
       v (Connect-RPC 协议封帧: connect.js)
  1. wrapEnvelope()：前置 [0x01] 压缩标记与 4 字节长度头。
  2. 流结束：追加 endOfStreamEnvelope() (Flags: 0x03, 载荷: `{}`)。
       │
       ▼ (写回 HTTP 响应流)
[Windsurf 顺畅流式渲染]
```

通过这一层对流状态机的深度管理，代理成功将底层的分段逻辑、思维链显示、工具回调过程完美拟合进了官方客户端的渲染机制中。

