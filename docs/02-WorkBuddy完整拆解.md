# 02 · WorkBuddy 完整拆解（每个关键实现都讲清楚）

> 本篇是对 `/Applications/WorkBuddy.app`（v5.1.7）的**逐子系统实现级拆解**。
> 每个关键实现都给出："它具体怎么做 + 关键代码/数据结构 + 工程细节"。
> 目的：让我们做 pi 方案时，对每个子系统都有"WorkBuddy 是怎么干的"作为参照。

---

## 子系统①：Electron 主进程架构

### 1.1 窗口类型清单（6 类，各不同 webPreferences）

| 窗口角色 | 用途 | webPreferences 关键配置 |
|----------|------|------------------------|
| **main** | 主 UI（React） | `contextIsolation:true, sandbox:true/false, nodeIntegration:false, webviewTag:true` |
| **splash** | 启动闪屏（claw.png） | 轻量，独立 preload |
| **claw** | Claw 远程控制设置 | `contextIsolation:false, sandbox:false`（需特殊权限） |
| **float** | 浮动辅助窗口 | — |
| **tray** | 托盘点击窗口 | — |
| **mcp-app / tdoc-import / tdoc-preview / wx-share / agent-browser-preview** | 第三方内容承载（webview） | `webSecurity:false` + 独立 `session.fromPartition` |

**关键设计**：第三方内容（MCP app、腾讯文档、微信分享、agent 浏览器预览）跑在**独立 webview + 独立 session partition**，关 webSecurity 但隔离 cookie/存储。`webviewTag:true` 让主窗口能内嵌 `<webview>`。

### 1.2 IPC 机制
- **registerChannel 模式**（40 处）：每个模块用 `CLAW_RPC_CHANNELS = { KEY: "claw:xxx" }` 常量字典注册一组 channel。
- 主进程 `ipcMain.handle` + preload `ipcRenderer.invoke` 包装成命名 API。
- **preload（133KB）只暴露一个主入口 `buddyAPI`** 到 `window`，其余 `__xxx`（`__hostPlatform`/`__wsRpcPort`/`__getTdocImportPreloadUrl` 等）是基础设施。

### 1.3 生命周期与基础设施
- **单例锁**：`requestSingleInstanceLock` + `second-instance` 处理（deep-link 唤起已运行实例）。
- **Deep Link**：`setAsDefaultProtocolClient` + `open-url`（macOS）/ `second-instance`（Windows），`workbuddy://` scheme。
- **托盘**：`Tray`（60 处）+ 右键菜单。
- **自动更新**：`electron-updater` 全套（`checkForUpdates`/`update-downloaded`/`quitAndInstall`），源 `https://copilot.tencent.com`。
- **崩溃上报**：`crash-reporter.js` + Sentry 风格。

---

## 子系统②：ACP 协议（Agent 通信契约）

### 2.1 ACP 方法全集（acp.js + OpenAPI 原文）
```
initialize          — 握手（声明 protocolVersion/serverInfo/capabilities）
authenticate        — 鉴权（external/internal/iOA/selfhosted 多模式）
session/new         — 新建会话，返回 {sessionId, models, modes, configOptions}
session/load        — 加载会话（回放历史事件：agent_message_chunk, tool_call...）
session/resume      — 恢复会话（只恢复运行态，不回放历史）
session/list        — 列出所有会话
session/fork        — 从某点分叉新会话（分支对话）
session/prompt      — 发起 prompt（核心，触发 agent loop）
session/update      — 服务端推送事件（notification）
session/cancel      — 中断当前 prompt
session/close       — 关闭会话
session/delete      — 删除会话
connect / disconnect — 连接生命周期管理
```

### 2.2 连接生命周期（OpenAPI 原文照录）
```
1. POST /api/v1/acp/connect → { connectionId, sessionToken }
2. POST /api/v1/acp (method:initialize) Header:acp-connection-id → SSE: {protocolVersion, serverInfo, capabilities}
3. POST /api/v1/acp (method:session/new|load|resume) → SSE: {sessionId, models, modes, configOptions}
4. POST /api/v1/acp (method:session/prompt) → SSE 流实时事件
5. GET /api/v1/acp → SSE 长连接（team 事件、广播）
6. DELETE /api/v1/acp → 断开
```

### 2.3 传输实现（StreamManager，核心）
- **双 transport**：`stdio`（终端 cbc 直连）+ `HTTP/SSE`（桌面/Web 接入）。
- 用 **Web Streams API**（`ReadableStream`/`WritableStream`）+ **NDJSON**（每行一个 JSON-RPC message）。
- 状态管理：`connectionStates: Map<connId, {initialized, inFlightPrompts, streamMapping, requestResponseMap}>`。
- **心跳保活**：`heartbeatTimers` + `postHeartbeatTimers`。
- **流清理**：`streamCloseTimers` + `cancellationSweepTimers`（周期清扫僵尸流）。
- 取消：`pausedPromptStreams` Set 暂停流；`session/cancel` notification 处理。

### 2.4 SessionUpdate 事件类型（oneOf，完整清单）
```
AgentMessageChunk      — LLM 流式 token
AgentThoughtChunk      — LLM 思考链（reasoning）
UserMessageChunk       — 用户消息回显
ToolCall               — 工具调用开始
ToolCallUpdate         — 工具执行进度/结果
InterruptionRequest    — 中断请求
SessionEnd             — 会话结束
SessionInfoUpdate      — 元信息变化（模型/模式/配置）
ModelUpdate            — 模型切换
```
推送函数：`pushSessionUpdate(stream, sessionId, update, _meta)`。

---

## 子系统③：cbc Sidecar 启动/管理/通信

### 3.1 cbc 是什么
- 独立 Node 程序：`cli/bin/codebuddy`（启动器）+ `cli/dist/codebuddy.js`（19MB rspack 打包）。
- 双模式：交互终端 + `--serve --port` HTTP server（桌面端用）。
- 跑在内嵌 `vendor/node.tar.gz`（Node v22.22.2）上（独立 CLI 场景）；**桌面端场景复用 Electron 的 Node**（`ELECTRON_RUN_AS_NODE=1`）。

### 3.2 spawnSidecar 完整流程（核验自源码）
```javascript
async spawnSidecar() {
  const token = randomUUID();                    // 实例令牌
  const entryPath = this.resolveSidecarEntry();  // sidecar-entry.js
  const execPath = process.execPath;             // Electron 二进制
  const args = [...processExecArgv, entryPath, "--token", token];
  const child = child_process.spawn(execPath, args, {
    detached: true,              // 独立进程组（父退出不连累）
    stdio: ["ignore", "ignore", "pipe"],  // 只捕获 stderr
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1", // 关键：Electron 当纯 Node 跑
      NODE_OPTIONS: "",          // 清空避免 V8 标志冲突
      ...connectorTokenEnv,
      ...proxyEnv,               // resolveProxyEnv() 注入代理
    }
  });
  // stderr 环形缓冲（SIDECAR_STDERR_TAIL_LINES）供崩溃诊断
  child.stderr.on("data", ...);
  // PID 文件（sidecar.pid）防多开
}
```

### 3.3 双通道 IPC（protocol.js 全文核验）
- **控制通道**：`sidecar.sock`（Unix）/ `\\.\pipe\workbuddy-{token}-sidecar-control`（Windows Named Pipe）。
- **数据通道**：每会话独立 `s-{sha1(id,16)}.sock`，互不干扰。
- 路径哈希避免冲突；处理 macOS `sun_path` 104 字节限制（超长降级 `/tmp`）。
- 超时：`IDLE_TIMEOUT_MS=1800s`、`RPC_TIMEOUT_MS=10s`、`SESSION_LIFECYCLE_RPC_TIMEOUT_MS=60s`。
- **RingBuffer 8MB**：环形捕获子进程 stdout/stderr 供调试回放。
- 就绪探测：`waitForPort`（端口探测）+ `acpConnectMs` 计量。

### 3.4 Windows PTY 策略（踩坑后决策）
源码注释原文：
> *"Windows node-pty repeatedly surfaces native-layer failures (winpty-conout ENOENT, ConPTY unavailable on older builds, named-pipe lock contention, winpty output truncation). WorkBuddy Desktop does not ... Trading PTY for a plain pipe on Windows. Desktop talks to the CLI over ACP/HTTP, so PTY semantics are not required."*
- macOS/Linux：`@lydell/node-pty`（PTY 语义）。
- **Windows：放弃 node-pty，用 `child_process.spawn` 纯管道**（因走 ACP/HTTP，不需要终端语义）。

---

## 子系统④：工具系统（DelegateToolManager + 委托执行）

### 4.1 工具注册表数据结构
```javascript
class DelegateToolManager {
  tools: Map<id, {definition, providerId, registeredAt}>  // 主表
  providerTools: Map<providerId, Set<id>>                 // 反向索引(按来源启停)
  connection: AcpConnection                                // 绑定的 ACP 连接
  onToolsChanged: () => Promise<void>                      // 变更回调(动态重注册到 Runner)

  async registerTool(id, definition, providerId) {
    this.tools.set(id, {definition, providerId, registeredAt: Date.now()})
    this.providerTools.get(providerId)?.add(id) ?? this.providerTools.set(providerId, new Set([id]))
    await this.onToolsChanged?.()   // 通知 Runner 工具集变了
  }
  async unregisterTool(id) { ...对称清理... }
}
```
**关键**：工具按 **providerId 分组**（builtin / 某 MCP server / 某 connector），可按来源整体启停。

### 4.2 工具执行：反向委托架构（重要）
```javascript
executeTool(toolId, input, timeout) {
  if (!this.tools.has(toolId)) return {status:"error", error:"Tool not found"}
  if (!this.connection) return {status:"error", error:"ACP connection not available"}
  // 关键：通过 ACP 扩展方法把执行发回 Electron 主进程
  return this.connection.extMethod("_codebuddy.ai/delegateTool", {
    sessionId: "",
    toolCallId: `delegate-${toolId}-${Date.now()}`,
    toolId, input, timeout: timeout || 30000
  })
}
```
**架构洞见**：`_codebuddy.ai/delegateTool` 是 **ACP 厂商扩展方法**（标准允许 `_namespace/` 扩展）。LLM 在 cbc 里决定调工具 → cbc 把执行**反向委托回 Electron 主进程**（因为文件/命令/web 等真实能力在主进程）→ 主进程执行 → 结果返 cbc。cbc 只做"调度"，不持有能力。

### 4.3 工具 schema
- `parameters`（JSON Schema）+ `strict:true`（严格模式）+ `jsonSchema`。
- `isError` 标记工具失败。
- 与 @openai/agents 的 `function_tool` / `ToolsSchema` 对齐。

### 4.4 DeferExecuteTool（危险工具延迟执行）
- 不立即执行，先 emit 事件（`tool_call_update` 带 `status:"incomplete"`）等 UI 确认。
- 配套 `emitCancelledToolCallUpdatesForDenials`：用户拒绝时发取消事件。
- UI 侧 `auto_execute` 设置：用户可设"自动执行"或"逐条确认"。

---

## 子系统⑤：内置工具与命令安全

### 5.1 内置工具清单
| 工具 | 实现类/服务 |
|------|------------|
| `read_file`/`write_file`/`edit_file`/`list_files` | 文件服务（经 sandbox FileProjection） |
| `grep` | `GrepTool`（4 处） |
| `glob` | `GlobTool`（3 处） |
| `execute_command` | `localShellService.execute`（经 commandSafety 审计 + sandbox） |
| `web_search`/`web_fetch` | web 服务（经后端网关） |
| `image_gen` | `ImageServiceImpl`（3 处） |
| `todo`/`plan` | `PlanStorageService`（plan_update 事件） |

### 5.2 命令安全审计（commandSafety）
```javascript
// 每条 execute_command 过三层
1. execPolicy 匹配       // 策略白/黑名单
2. commandSafety 规则集   // 危险模式检测
3. excluded-command 检查  // 排除命令
// 命中则:
appendCommandSafetyAuditLog("excluded-command", {command, ...})  // 审计落盘
return {handle: await localShellService.execute(cmd), bypassed:false}
// 系统级工具识别:
bashSandboxManager.isSystemLevelTool(cmdName)  // 决定是否走沙箱
```

### 5.3 文件操作与 FileProjection
- `FileProjection`：文件投影同步（agent 改文件 → 投影到主进程 → 经 sandbox 写真实 fs）。
- 文件版本快照：`snapshotFile` + 主进程侧 `listFileCommits`/`revertFileCommit`（改前 commit，可回滚）。

---

## 子系统⑥：MCP Host 实现

### 6.1 三 transport 全支持
- `StdioClientTransport`（7）— 本地子进程 MCP server（spawn）
- `SSEClientTransport`（7）— 远程 SSE
- `StreamableHTTPClientTransport`（7）— HTTP 流式
- `McpConnectionManager`（5）— 连接生命周期管理

### 6.2 MCP 工具并入 Agent（关键机制）
```javascript
// 每个 MCP server 关联一个 subagent
mcpServers: serverList,
handoffDescription: desc,
handoffs: handoffList
agent = await this.factory.create(config)
this.mcpSubagentToolManager.register(agentName, toolManager)  // 注册到子 agent 工具管理器
this.agentMap.set(agentName, agent)
```
**MCP server = subagent**：每个 MCP server 被包装成一个 subagent，工具经 `mcpSubagentToolManager` 管理，通过 handoff 机制接入主 agent。

### 6.3 沙箱 webview（主进程侧）
- `builtin-mcp-apps/` 下的 MCP app 跑在**独立 BrowserWindow webview**。
- `mcp-app-preload.js`（10.7KB）做桥接。
- 独立 session partition，与主 UI 隔离。

---

## 子系统⑦：OS 级沙箱（AnthropicSandboxManager + sandbox-cli）

### 7.1 多平台沙箱后端
```javascript
class AnthropicSandboxManager {
  async initialize(config) {
    if (platform !== 'darwin') {
      // 非 macOS: 委托 sandbox-cli(Rust 二进制)
      log("delegating to sandbox-cli backend, skipping AnthropicSandboxManager.initialize")
      return
    }
    // Linux 依赖检查: bwrap(bubblewrap)
    const missing = await this.checkLinuxDependencies()
    if (missing.length) { this.initialized = false; return }
    const runtimeConfig = await this.toRuntimeConfig(config)
    await nh(runtimeConfig)  // 初始化运行时
    this.initialized = true
  }
}
```
- **macOS**：AnthropicSandboxManager（疑似 Anthropic 开源的沙箱框架，可能基于 seatbelt/sandbox-exec）。
- **Linux**：`bwrap`（bubblewrap）容器。
- **Windows/其他**：`sandbox-cli`（Rust 二进制，3.2MB）+ `tsbx_rules.json` 规则。
- macOS 系统扩展（sandbox-config.json）：`Network Extension`（网络代理拦截）+ `File Provider`（文件虚拟化）+ `App Group`。

### 7.2 命令执行流转
```
execute_command
  → commandSafety 审计（execPolicy + 规则 + excluded）
  → bashSandboxManager.isSystemLevelTool? 
      是 → 直接执行(系统工具免沙箱)
      否 → localShellService.execute(经沙箱)
  → appendCommandSafetyAuditLog 落盘
```

---

## 子系统⑧：技能系统（SKILL.md + agentskills.io 兼容）

### 8.1 技能加载流程（SkillProductProvider.scanSkillsDirectory）
```javascript
async scanSkillsDirectory(baseDir, ext, visited, ..., root) {
  // 1. 递归扫描目录
  const skills = await this.scanSkillsDirectory(...)
  // 2. 找 SKILL.md
  const skillMdPath = join(ext, "SKILL.md")
  if (!visited.has(skillMdPath) && await this.pathExists(skillMdPath)) {
    const skill = await this.parseSkillFile(skillMdPath, ext, ..., root)
    skills.push(skill); visited.add(skillMdPath)
  }
  log(`Loaded ${skills.length} skill(s) from extension: ${ext}`)
}
```
- 扫描路径：`~/.workbuddy/skills/`（用户）+ `builtin-skills/`（内置）+ 企业技能目录。
- 解析：`parseSkillFile` 读 YAML frontmatter（`name`/`description`/`allowed-tools`/`disable`）+ Markdown body。
- 与 **pi 的 `Skill` 接口 + agentskills.io 规范完全兼容**。

### 8.2 三类技能
- **installed**：本地已装（`~/.workbuddy/skills/`）。
- **enterprise**：企业下发。
- **knot**：市场技能（`skillhub`/`knot` IPC，分类/标签/搜索/安装）。

### 8.3 技能技能（元技能）
`skill-creator/` 内置技能，带 Python 脚本（`init_skill.py`/`package_skill.py`/`quick_validate.py`）—— **用 agent 创建 agent 技能**。

---

## 子系统⑨：记忆四层实现

### 9.1 四层记忆（nunjucks 模板注入主 prompt）
```
{{ ClawMemory_1 }}            — Claw 远程会话记忆（IM 渠道来的上下文）
{{ WorkingMemoryContent }}    — 当前任务工作记忆（任务级，会话内）
{{ UserLocalMemoryContent }}  — 本地长期记忆（跨会话，存本地）
{{ UserMemoryContent }}       — 云端用户记忆（跨设备，存 copilot 后端）
```

### 9.2 UserMemoryCollector 实现（带缓存）
```javascript
USER_MEMORY_TIMEOUT_MS = 30000       // 超时 30s
USER_MEMORY_CACHE_TTL_MS = 300000    // 正缓存 5 分钟
USER_MEMORY_NEGATIVE_TTL_MS = 30000  // 负缓存 30s（没查到也缓存，避免重复打后端）
MAX_USER_MEMORY_CHARS = 10000        // 上限 1 万字符（防 prompt 爆）
inflightFetches = new Map()          // 并发去重（同 key 只发一次）
```
- 存储：`~/.workbuddy/memory/`（user-memory、working-memory 分文件）。
- 云端 UserMemory 走后端 API（copilot.tencent.com）。
- **正负缓存 + 并发去重 + 字符上限** 是工程亮点。

### 9.3 上下文注入
主 prompt 用 nunjucks 模板组装，四层记忆 + 模式 reminder + 安全策略 + 个人文件保护规则一起注入。

---

## 子系统⑩：会话存储

### 10.1 存储分工
- **cbc 侧**：`SessionStore.transformItemForSaveAsync` → 会话内容以 **JSONL 流式落盘**（增量 + 可回放）。目录 `~/.workbuddy/sessions/`。
- **主进程侧**：`better-sqlite3` 存会话元数据/消息索引。
- **CheckpointService**（7 处）：会话快照，支持 `resume`（恢复运行态）。

### 10.2 会话恢复双语义（ACP 原文）
- `session/load`：**回放历史事件**（agent_message_chunk, tool_call 等逐条重放）。
- `session/resume`：**只恢复运行态**（不回放历史，接续未完成任务）。

### 10.3 ~/.workbuddy/ 目录全貌
```
~/.workbuddy/
├── sessions/           — 会话 JSONL
├── memory/             — 记忆(user-memory/working-memory)
├── skills/             — 用户技能(SKILL.md)
├── skills-marketplace/ — 市场技能缓存
├── plugins/            — 插件
├── plugin-marketplace-state-new/
├── connectors/         — 连接器配置
├── connectors-marketplace/
├── mcp/                — MCP server 配置
├── plans/              — 计划/TODO
├── binaries/           — 二进制(ripgrep 等)
├── logs/               — 日志
└── sidecar.pid/.sock   — sidecar 运行时
```

---

## 子系统⑪：文档引擎（@tencent/docs-engine SaaS 客户端）

### 11.1 架构
```
主进程
  └─ createTencentDocsDomainFacade(deps)
       └─ createDomainProxy<TencentDocsDomainService>('tencentDocs')
            └─ tencentDocs:{method}  // domain proxy RPC
                 │
                 ▼
       start_server_addon.node  (Node addon, 起独立 server)
            └─ libeditor_sdk_ffi.dylib  (C++ FFI, 腾讯文档编辑器核心)
                 └─ icudt72l.dat  (ICU 国际化)
```

### 11.2 能力（tencentDocs:* 方法全集）
```
tencentDocs:startAuth / checkAuthStatus / revokeAuth    — OAuth 授权
tencentDocs:getFileList / getFolderContents / searchFiles — 文件列表/搜索
tencentDocs:createFile / uploadFile / deleteFile / renameFile — 文件 CRUD
tencentDocs:createSaasImport / batchCreateSaasImport     — SaaS 导入
tencentDocs:querySaasImportProgress / queryBatch...Progress — 导入进度
tencentDocs:getPreviewUrl / prepareEnterpriseDocPreview  — 预览
tencentDocs:getTdocsLicense / verifyPersonalLicense / getPersonalTdocCookie — 授权/许可
```

### 11.3 UI 桥（preload）
- `tdoc-import-preload.js`（27KB）/ `tdoc-preview-preload.js`（30KB）：注入加载腾讯文档的 webview。
- 做 **iframe 通信拦截 + cookie 注入**（`__tdocImportSubFramePatched__`）。
- 独立 session partition：`persist:tdoc-import`。
- OAuth 自动刷新：`startServerSideOauthRefresher`。

### 11.4 边界
- ✅ 完整渲染/编辑腾讯文档（保真等同 Web 版）。
- ❌ 强绑腾讯云（OAuth + 数据云端 + 登录态）。
- ❌ 闭源，不可复用。**我们无法复刻，走本地开源栈。**

---

## 子系统⑫：Agent Teams（多 agent 编排）

### 12.1 模型
- **orchestrator agent** 管理多个 **subagent**。
- 工具委托：`delegateTo`（7 处）+ `delegate`（90 处）。
- 团队定义：`AgentTeam`（7 处）。
- `agentMap: Map<name, Agent>` — 全局 agent 注册表。

### 12.2 handoff 实现（@openai/agents 原生 API）
```javascript
// 把目标 subagent 包成 handoff tool
const handoffTool = handoff(targetAgent, {
  onHandoff: (ctx, input) => { if (input) targetAgent.prompt = input.prompt },
  inputType: this.parseParametersToZod(params),  // zod schema
  inputFilter: (input) => { /* 过滤交接内容 */ },
})
handoffTool.asTool({toolDescription: targetAgent.handoffDescription})
// 配套: RunHandoffOutputItem / withHandoffSpan (追踪)
```
- 交接时生成摘要：`buildHandoffSummarySystemPrompt()`（给目标 agent 上下文）。
- handoff 是 @openai/agents 一等公民（`RunHandoffOutputItem`/`withHandoffSpan`）。

### 12.3 MCP = subagent
每个 MCP server 被包装成 subagent，经 `mcpSubagentToolManager` 注册，通过 handoff 接入主 agent。**统一了"工具"和"子 agent"的抽象。**

---

## 子系统⑬：自动化系统（主进程侧）

### 13.1 架构
- 完全在 **Electron 主进程**实现（cbc 侧无相关代码）。
- IPC：`automation:create/update/delete/test` + 运行记录查询。

### 13.2 组成（从 i18n + IPC 还原）
- **触发器**：cron（周几/时间）+ 事件（文件变化、剪贴板、热键）。
- **数据源**（`automation:datasource`）：连接器提供的外部数据（如股票、财务）。
- **动作**：执行一个技能 / 一段 agent prompt。
- **运行记录**：`inProgress/scheduled/completed/archived` 四态 + 详情（artifacts/summary/linked conversation）。

### 13.3 示例（内置模板）
- `healthCheckupReminder`：定时健康检查提醒（带 prompt 模板）。
- `competitorSnapshot`：访问竞品网站对比昨日快照。

---

## 子系统⑭：Claw 远程控制（10 渠道 + 后端中转）

### 14.1 渠道（CLAW_CHANNEL_MAP）
微信、企业微信、微信小程序、飞书、钉钉、QQ、Slack、Discord、Telegram、元宝（10 个）。

### 14.2 RPC 方法（CLAW_RPC_CHANNELS 全集）
```
渠道管理:    getChannelStatus / getSavedChannels / registerChannel / unregisterChannel
             getSavedChannelConfigs
启停:        getWecomEnabled/setWecomEnabled  getWechatmpEnabled/setWechatmpEnabled
             getWechatmpArtifactUploadEnabled/setWechatmpArtifactUploadEnabled
微信客服:    wechatkfGetLink / wechatkfGetBindStatus / wechatkfUnbind
微信扫码:    weixinQrStart / weixinQrWait
微信小程序:  wechatmpDeviceAuthCode
元宝扫码:    yuanbaoScanBindCode / yuanbaoCheckScanBindStatus
会话:        getLatestSession / notifySessionActive
事件:        channelStatusChange / channelConfigSaved / wechatkfBindSuccess
环境检测:    getIsIOAMachine
```

### 14.3 通信架构
- **后端中转**：IM 消息 → 腾讯云后端（copilot.tencent.com）→ WebSocket 推到桌面端 → 触发 agent。
- `ClawPowerLifecycle.runReconnectWave`：断线重连波。
- `ClawService`（216 处）是主进程重模块。
- 每渠道有独立 SDK（`@larksuiteoapi`/`dingtalk-stream`/`@wecom/aibot-node-sdk`/`@slack/*`/`@tencent-connect/qqbot-connector`）。

---

## 全局工程实践总结

### A. 可观测性
- **OpenTelemetry** 全链路（主进程 + cbc）。
- **Aegis**（腾讯前端监控）。
- `electron-log` + sidecar 专属日志 + stderr 环形缓冲。
- `usage_update` 实时推送 token/成本。

### B. 安全（纵深防御）
1. 渲染进程 `contextIsolation:true, nodeIntegration:false, sandbox:true`。
2. 第三方内容独立 webview + partition + 关 webSecurity。
3. 工具执行 DeferExecute（危险求确认）。
4. 命令 commandSafety 审计 + 落盘。
5. OS 级沙箱（Network Extension + File Provider）。
6. 文件操作前快照（可回滚）。
7. 主 prompt 内嵌内容安全策略（政治敏感/色情/违法/个人信息拒绝 + 港澳台措辞）。

### C. 性能/稳定性
- sidecar `detached:true` 崩溃隔离。
- 心跳 + 流清理 + 取消清扫。
- 记忆正负缓存 + 并发去重。
- cbc 独立升级路径。

### D. 跨平台
- PTY：mac/linux 用 node-pty，Windows 用纯管道。
- 沙箱：mac AnthropicSandboxManager，linux bwrap，win sandbox-cli。
- socket：Unix socket vs Windows Named Pipe。
- 路径：处理 macOS sun_path 104 字节限制。

---

## 对 pi 方案的逐子系统借鉴表

| 子系统 | WorkBuddy 做法 | pi 对应/借鉴 | 优先级 |
|--------|----------------|--------------|:---:|
| ①主进程 | Electron + registerChannel + tray/updater/deeplink | 直接照搬模式 | MVP |
| ②ACP 协议 | HTTP+SSE+NDJSON，12 方法 | pi subscribe 经 SSE 转发；MVP 先内部协议 | P1 |
| ③sidecar | ELECTRON_RUN_AS_NODE + 双 socket | MVP 主进程跑 pi；P1 拆 sidecar | P1 |
| ④工具 | DelegateToolManager + 反向委托 | pi AgentTool + beforeToolCall（更简洁） | MVP |
| ⑤内置工具 | 文件/命令/web/image + safety | pi 工具桥到主进程能力 | MVP |
| ⑥MCP | 三 transport + MCP=subagent | pi 接 @modelcontextprotocol/sdk | P1 |
| ⑦sandbox | OS 扩展 + sandbox-cli | MVP 不做；P1 文件快照+审计 | P2 |
| ⑧技能 | SKILL.md + scan + 市场 | pi Skill 接口（格式兼容） | MVP |
| ⑨记忆 | 四层 + 缓存 + 去重 | pi 分层记忆 + 缓存机制借鉴 | MVP基础/P1 |
| ⑩会话 | JSONL + Checkpoint + load/resume | pi Session 树 + JSONL 持久化 | MVP |
| ⑪文档 | docs-engine SaaS（闭源） | ❌ 本地开源栈（docx/xlsx/pptx） | MVP |
| ⑫多 agent | Agent Teams + handoff | pi orchestrator（experimental） | P2 |
| ⑬自动化 | 主进程 cron + 数据源 + 技能 | pi 自动化模块 | P1 |
| ⑭Claw | 10 渠道 + 后端中转 | ❌ 不做（明确不绑生态） | — |
