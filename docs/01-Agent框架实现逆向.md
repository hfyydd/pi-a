# 01 · WorkBuddy Agent 框架实现逆向

> 聚焦"agent 框架怎么实现的"——内核选型、运行容器、通信协议、循环机制、工具系统、多 agent 编排。
> 数据源：`cli/dist/codebuddy.js`（19MB，cbc 主程序）+ `cli/bin/codebuddy`（启动器）+ `acp.js`（ACP SDK）+ 主进程 `index.js`。
> 方法：字符串提取 + OpenAPI 规范原文（cbc 内嵌了完整 ACP OpenAPI 文档）+ 类名/方法名定位。

---

## 一、Agent 框架全景：三层架构

WorkBuddy 的 agent 框架不是单体，而是**三层**：

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: ACP 协议层（对外契约）                              │
│  @agentclientprotocol/sdk + cbc 的 ACP server                │
│  · HTTP + SSE + JSON-RPC 2.0                                 │
│  · 方法: initialize/session.*/connect/resume                 │
│  · 事件: agent_message_chunk/tool_call/handoff/usage_update  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Agent 应用层（cbc 自己的工程封装）                  │
│  IoC 容器(@Component/@Autowired + reflect-metadata)          │
│  · AgentService    — agent 生命周期编排                       │
│  · SessionManager  — 会话状态                                 │
│  · ToolManager     — 工具注册/路由/委托                       │
│  · PlanStorageService — 计划/TODO 持久化                      │
│  · CheckpointService — 会话快照                               │
│  · GoalService     — 目标管理（/goal 命令）                   │
│  · PromptBuilder   — system prompt 模板组装                  │
│  · AgentTeam       — 多 agent 编排（subagent/orchestrator）   │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Agent 内核（@openai/agents）                        │
│  · Agent / Runner / RunState                                 │
│  · function_tool / handoff                                   │
│  · AgentOutput / ToolsSchema                                 │
│  · 真正的 agent loop（LLM 调用 → tool_call 派发 → 循环）      │
└─────────────────────────────────────────────────────────────┘
```

**核心设计**：内核用 OpenAI 官方 `@openai/agents`（不自己造轮子），上层用 IoC 容器做工程封装，对外用 ACP 标准协议。

---

## 二、运行容器：cbc（CodeBuddy CLI）独立进程

### 2.1 cbc 是什么
- 独立的 Node 程序：`cli/bin/codebuddy`（启动器）+ `cli/dist/codebuddy.js`（19MB rspack 打包）。
- 跑在内嵌的 `vendor/node.tar.gz`（Node v22.22.2）上。
- 既是桌面端的 agent sidecar，又能独立在终端跑（`codebuddy`/`cbc` 命令）。

### 2.2 双模式启动
- **交互模式**：终端直接用，TUI/REPL。
- **serve 模式**（桌面端用）：`cbc --serve --port XXXX`，起 HTTP server 监听 `127.0.0.1:xxxxx`，桌面端经 ACP 接入。

### 2.3 为什么独立进程（架构动机）
1. **崩溃隔离**：LLM 超时/工具异常不连累 UI。
2. **复用**：同一 binary 服务桌面 + 终端 + Web + IM 多入口。
3. **独立升级**：cbc 可与桌面端解耦迭代。
4. **资源隔离**：agent 的 CPU/内存独立计量。

---

## 三、ACP 协议层（对外契约——OpenAPI 原文）

cbc 内嵌了完整 ACP OpenAPI 规范，**这是 agent 框架对外的精确契约**（比任何逆向都权威）：

### 3.1 连接生命周期（原文照录）

```
1. POST /api/v1/acp/connect
   → { connectionId, sessionToken }

2. POST /api/v1/acp  (method: "initialize")
   Header: acp-connection-id: <connectionId>
   → SSE 流返回 JSON-RPC response: { protocolVersion, serverInfo, capabilities }

3. POST /api/v1/acp  (method: "session/new" | "session/load" | "session/resume")
   → SSE 流返回 JSON-RPC response: { sessionId, models, modes, configOptions }
   → loadSession 时会先回放历史事件（agent_message_chunk, tool_call 等）
   → resumeSession 只恢复运行态，不回放历史事件

4. POST /api/v1/acp  (method: "session/prompt")
   → SSE 流返回实时事件（sessionUpdate notifications）：
     agent_message_chunk, tool_call, tool_call_update,
     interruption_request, session_info_update, session_end 等

5. GET /api/v1/acp（可选）
   → SSE 长连接，接收异步 notifications（team 事件、广播等）

6. DELETE /api/v1/acp
   → 断开连接，释放服务端资源
```

### 3.2 关键架构特征
- **传输**：HTTP POST + **SSE（Server-Sent Events）** 流式响应，NDJSON 格式（每行一个 JSON-RPC message）。
- **两类消息**：JSON-RPC Response（请求的直接响应）+ JSON-RPC Notification（异步事件推送）。
- **连接复用**：`connectionId` + `acp-connection-id` header，一个连接承载多 session。
- **会话恢复**：`load`（回放历史事件）vs `resume`（只恢复运行态）—— 两种恢复语义。

### 3.3 事件类型清单（从 session/update 推送，按出现频次）

| 事件 | 用途 |
|------|------|
| `session_info_update` | 会话元信息变化（模型/模式/配置） |
| `agent_message_chunk` | LLM 流式 token |
| `tool_call` | 工具调用开始 |
| `tool_call_update` | 工具执行进度/结果 |
| `handoff` | agent 间任务交接 |
| `usage_update` | token/成本统计 |
| `session_end` | 会话结束 |
| `plan_update` | 计划/TODO 更新 |
| `interruption_request` | 中断请求 |

---

## 四、Agent 内核：@openai/agents 的用法

### 4.1 用到的核心 API（全部核验）
| API | 出现次数 | 用途 |
|-----|:---:|------|
| `Agent({ ... })` | 39 | 定义 agent |
| `RunState` | 33 | 运行态（流式产出/工具结果聚合） |
| `Runner.run` | 2 | 启动 agent loop |
| `handoff(...)` | 1+ | 注册 agent 间交接 |
| `AgentOutput` | 5 | 输出类型 |
| `ToolsSchema` | 2 | 工具 schema |

### 4.2 Agent 定义（标准 @openai/agents 配置）
核验到的配置字段：
```typescript
new Agent({
  name,
  instructions,        // ← 18 处，system prompt
  model,               // ← 52 处
  tools,               // ← 36 处
  handoffs,            // ← 6 处，交接目标
  mcpServers,          // ← 9 处，MCP server 直连
  outputType,          // ← 3 处
  toolUseBehavior,     // 工具使用策略
  resetToolChoice,     // 每轮重置工具选择
})
```
> 这是教科书式 @openai/agents 用法。**WorkBuddy 没有自己造 agent loop，直接用官方 SDK。**

### 4.3 三种模式 = prompt 切换（非多 agent）
`workbuddy-ask/craft/expert-prompt.tpl` 三套模板，通过 `instructions` 字段切换：
- **ask**：注入 `ask-mode-reminder`，约束只读
- **craft**：注入 `craft-mode-reminder`，解锁写操作
- **expert**：整套专家 persona 模板（35KB）

---

## 五、Agent 应用层：IoC 容器 + 核心服务

### 5.1 IoC 架构
cbc 用 **`@Component` + `@Autowired` + `reflect-metadata`** 做依赖注入（典型 NestJS 风格，但自实现轻量容器）。所有核心服务都是 `@Component`：

### 5.2 核心服务（核验到的类）
| 服务 | 职责 |
|------|------|
| **AgentService** | agent 生命周期编排，调用 `Runner.run` |
| **SessionManager** | 会话状态管理（create/load/move/archive） |
| **ToolManager** | 工具注册表 + 路由 + 委托 |
| **PlanStorageService** | 计划/TODO 持久化（plan_update 事件源） |
| **CheckpointService** | 会话快照（可回滚点） |
| **GoalService** | 目标管理（`/goal` 命令，设定任务目标） |
| **PromptBuilder** | system prompt 模板组装（nunjucks） |
| **CommandExecutor** | 命令执行（16 处，含 `/clear`/`/goal` 等斜杠命令） |
| **AcpService** | ACP 协议适配 |

### 5.3 AgentService 入口方法
```
AgentService.run              // 主入口
AgentService.runDefault       // 默认配置运行
AgentService.runOneTime       // 一次性运行（无状态）
AgentService.runOneTimeWithOverrides  // 带覆盖的一次性运行
```
内部调 `runner.run(...)`（@openai/agents 的 Runner）。

---

## 六、工具系统

### 6.1 工具注册（ToolManager）
```javascript
registerTool(id, definition, providerId)
// id          — 工具名
// definition  — JSON Schema 定义
// providerId  — 来源(builtin / 某 MCP server / 某 connector)
```
- 工具按 **providerId 分组**，便于按来源启停。
- **delegate tool（委托工具）**：ACP 把远程工具"委托"注册到本地 Runner，统一调度。
- 注释原话：`[ACP Agent] Registered delegate tool: ${id}`

### 6.2 工具 schema
- 用 `parameters`(JSON Schema) + `strict:true`（15 处严格模式）
- `isError`（24 处）标记工具失败
- 与 @openai/agents 的 `function_tool` / `ToolsSchema` 对齐

### 6.3 内置工具（从主进程 + cbc 提取）
| 工具 | 用途 |
|------|------|
| `read_file` / `write_file` / `edit_file` / `list_files` | 文件（经 sandbox） |
| `execute_command` | shell（node-pty / spawn，经 commandSafety 审计） |
| `web_search` / `web_fetch` | 联网（经后端网关） |
| `image_gen` | 图像生成 |
| `DeferExecuteTool` | **延迟执行**——危险操作求确认 |

### 6.4 工具权限机制（三层）
1. **DeferExecuteTool**（12 处）：危险工具不立即执行，先 emit 事件等 UI 确认。
2. **commandSafety**（3 处）：每条 shell 命令过安全审计 + 写审计日志。
3. **auto_execute 设置**：用户可设"自动执行"或"逐条确认"。

---

## 七、Agent Teams：多 agent 编排（扩展特性）

WorkBuddy 在标准 @openai/agents 之上扩展了 **Agent Teams**（ACP 文档原文称 "Agent Teams 扩展"）：

| 概念 | 出现次数 | 含义 |
|------|:---:|------|
| `delegate` | 90 | 工具/任务委托 |
| `subagent` | 69 | 子 agent |
| `orchestrator` | 35 | 编排 agent（管 subagent） |
| `AgentTeam` | 7 | 团队定义 |
| `handoff` | 8+ | 交接（配合 `buildHandoffSummarySystemPrompt`） |

**模型**：一个 **orchestrator agent** 管理多个 **subagent**，通过 `handoff` 在它们之间转移控制权，交接时生成摘要 prompt（`buildHandoffSummarySystemPrompt`）。
- 这对应 UI 上的"专家中心/数字同事"——本质是 orchestrator → subagent 的 handoff。
- `GET /api/v1/acp`（SSE 长连接）专门接收 team 异步事件。

---

## 八、记忆与上下文注入

### 8.1 四层记忆（nunjucks 模板注入主 prompt）
```
{{ WorkingMemoryContent }}    ← 当前任务的工作记忆
{{ UserLocalMemoryContent }}  ← 本地长期记忆
{{ UserMemoryContent }}       ← 云端用户记忆
{{ ClawMemory_1 }}            ← Claw 远程会话记忆
```

### 8.2 计划/目标上下文
- `PlanStorageService` 维护当前 plan/TODO，经 `plan_update` 事件同步到 UI。
- `GoalService` 维护用户设定的目标（`/goal <text>` 命令），注入 prompt 作为方向约束。

---

## 九、可观测性
- `usage_update` 事件：实时推送 token/成本（`Map<sessionId, UsageSnapshot>`）。
- `CheckpointService`：会话快照，支持 `resume` 恢复运行态。
- `appendCommandSafetyAuditLog`：命令审计落盘。
- OpenTelemetry + Aegis：主进程侧全链路追踪。

---

## 十、对我们 pi 方案的核心启示

### 10.1 架构层级对照

| 层 | WorkBuddy | 我们（pi） |
|----|-----------|------|
| 内核 | `@openai/agents`（Agent/Runner/RunState） | **pi**（Agent 类/agent-loop）—— 对等 |
| 工程 | IoC 容器 + AgentService/ToolManager | 可简化（pi 已有 Agent/Tool 抽象） |
| 协议 | ACP（HTTP+SSE+JSON-RPC） | pi 可包装成 ACP server，或先用内部协议 |
| 多 agent | Agent Teams（orchestrator/subagent/handoff） | pi 有 `orchestrator` 包（experimental）可对标 |
| 工具权限 | DeferExecuteTool + commandSafety | pi 的 `beforeToolCall {block:true}` 天然对等 |

### 10.2 关键工程借鉴
1. **SSE 流式 + NDJSON**：比 WebSocket 简单，HTTP 友好，适合 agent 事件流。pi 的 `subscribe` 事件可经 SSE 转发。
2. **load vs resume 双语义**：load 回放历史、resume 只恢复运行态——会话恢复的优雅设计。
3. **工具 providerId 分组**：按来源（builtin/MCP/connector）管理工具，启停清晰。
4. **delegate tool**：远程工具委托注册到本地 Runner，统一调度——MCP 工具接入的范式。
5. **危险工具 DeferExecute**：不立即执行，emit 事件求确认——和 pi 的 beforeToolCall 殊途同归，但 cbc 用"工具即事件"模式，pi 用"钩子拦截"模式，pi 更简洁。
6. **handoff summary prompt**：agent 交接时生成摘要——pi 若做多 agent 要实现。
7. **Windows 放弃 node-pty**：纯管道 + JSON-RPC——直接吸取。

### 10.3 我们可简化的地方
- **IoC 容器**：MVP 不需要，pi 的 Agent 类已够用，过度工程化反而拖慢。
- **ACP 标准协议**：MVP 先用 Electron 主进程内直接调 pi（零协议开销），P1 再考虑包装 ACP server 拆进程。
- **Agent Teams**：MVP 单 agent 足够，P1 用 pi orchestrator 做多 agent。

### 10.4 pi 相对 @openai/agents 的差异化
- pi 的 `beforeToolCall/afterToolCall` 钩子比 @openai/agents 的工具内联更解耦。
- pi 极简哲学（少工具、短 prompt）vs @openai/agents 的"全功能"。
- pi 中文 provider 原生全覆盖，@openai/agents 需自己接。
- pi 的 `CustomAgentMessages` 声明合并机制，工件/通知消息扩展更优雅。

---

## 附：本次逆向方法清单
- `cli/dist/codebuddy.js`（19MB）→ 精确 grep 类名/方法名/配置字段，统计出现次数定位核心
- **OpenAPI 文档原文**：cbc 内嵌完整 ACP OpenAPI 描述（`generateOpenApiSpec()`），直接给出协议规范——这是最权威来源
- `acp.js`（未压缩）→ AGENT_METHODS/CLIENT_METHODS/PROTOCOL_VERSION
- `templates/*.tpl` → prompt 模板揭示模式/记忆注入机制
- `bin/codebuddy` → 启动器逻辑（Node 版本检查、进程计时）
