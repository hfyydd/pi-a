# 00 · WorkBuddy（腾讯）架构与实现逆向

> 对 `/Applications/WorkBuddy.app`（v5.1.7）的静态逆向。
> **聚焦点：架构怎么搭、代码怎么实现、进程怎么跑、模块怎么通信**。不含产品定位推断。
> 方法：解包 `app.asar` → 读源码（protocol.js / sidecar-entry.js 全文，index.js 字符串提取）+ 依赖清单 + 原生模块。

---

## 一、整体架构：双层 + 双进程模型

WorkBuddy 不是"Electron 主进程直接跑 agent"，而是一个**清晰的"UI 壳 + Agent sidecar"双层架构**：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Electron 应用进程                                                    │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  渲染进程 (renderer/, React UI)                                 │  │
│  │  contextIsolation:true  nodeIntegration:false  sandbox:true    │  │
│  │  只通过 window.workbuddy API 访问能力（无 Node 直访）           │  │
│  └───────────────┬───────────────────────────────────────────────┘  │
│                  │ ipcRenderer/ipcMain + contextBridge(preload)      │
│  ┌───────────────▼───────────────────────────────────────────────┐  │
│  │  主进程 (main/index.js, 14.4MB 打包)                           │  │
│  │                                                               │  │
│  │  · 窗口/会话/技能/自动化 业务逻辑                              │  │
│  │  · ACP Client ────── HTTP ──────┐                             │  │
│  │  · MCP Host (@modelcontextprotocol/sdk)                        │  │
│  │  · docs-engine 客户端 (tencentDocs:{method} domain proxy)      │  │
│  │  · better-sqlite3 存储 / keychain / chokidar                   │  │
│  │  · SidecarServer (管理 cbc 进程)                               │  │
│  └───────────────┬───────────────────────────────────┬───────────┘  │
│                  │ Unix socket / Named Pipe             │ spawn       │
│          (control + per-session data)                   │             │
└──────────────────┼──────────────────────────────────────┼─────────────┘
                   │                                      │
        ┌──────────▼──────────┐              ┌────────────▼────────────┐
        │  cbc (CodeBuddy CLI) │              │  docs-engine server     │
        │  sidecar 进程        │              │  (start_server_addon)   │
        │                      │              │  独立 server + FFI      │
        │  @openai/agents 跑这 │              │  libeditor_sdk_ffi.dylib│
        │  HTTP server         │              │  + OAuth (腾讯文档 SaaS)│
        │  127.0.0.1:xxxxx     │              └─────────────────────────┘
        │  /api/v1/acp         │
        │                      │
        │  · Agent loop        │              ┌─────────────────────────┐
        │  · 工具执行          │              │  sandbox-cli (Rust 3.2MB)│
        │  · 内置工具          │              │  系统级沙箱             │
        │  · MCP server        │              │  Network Extension      │
        │  · 技能加载          │              │  + File Provider        │
        └──────────────────────┘              │  + App Group (macOS)    │
                                              └─────────────────────────┘
```

**核心设计思想**：
1. **UI 与 Agent 解耦**：Electron 只做 UI 壳 + 系统胶水，真正的 agent loop 在独立 cbc 进程跑。Agent 崩溃不连累 UI；cbc 可独立升级/复用。
2. **标准协议通信**：用 **ACP（Agent Client Protocol）** 而非私有协议——这是 Zed Editor 提出的开放标准。
3. **多 sidecar 各司其职**：cbc（agent）/ docs-engine（文档）/ sandbox-cli（沙箱）独立进程。
4. **OS 级隔离**：sandbox-cli 用 macOS Network Extension + File Provider 做系统级权限，超出普通进程沙箱。

---

## 二、ACP（Agent Client Protocol）—— 核心通信架构

### 2.1 ACP 是什么
ACP 是 Zed Editor 提出的**开放 agent 通信标准**（类似 LSP 之于编辑器）。WorkBuddy 实现了完整 ACP client（`@agentclientprotocol/sdk` + `@genie/agent-client-protocol` 内部封装）。

### 2.2 通信路径（核验自源码）
```
主进程 ACP Client
   │  HTTP POST  127.0.0.1:xxxxx/api/v1/acp
   │  (JSON-RPC 2.0 over HTTP)
   ▼
cbc sidecar (HTTP server)
   │  方法: initialize / authenticate / session/new / session/prompt
   │        session/update (流式推送) / session/cancel
   │  产出: ACP artifact / checkpoint / tool_call / sessionUpdate / stopReason
```

### 2.3 ACP 方法集（从 acp.js 提取）
| 方法 | 用途 |
|------|------|
| `initialize` | 握手，声明能力 |
| `authenticate` | 鉴权（透传到 cbc 的 auth） |
| `session/new` | 新建会话 |
| `session/prompt` | 发起一次 prompt（触发 agent loop） |
| `session/update` | 服务端推送（流式 token / 工具事件 / artifact） |
| `session/cancel` | 中断 |

错误码用标准 JSON-RPC（-32700 parse / -32601 method-not-found / -32000 session-not-found）。

### 2.4 为什么用 ACP（架构启示）
- **进程隔离**：agent 的不稳定（LLM 超时/工具崩溃/内存泄漏）不波及 UI。
- **cbc 复用**：同一 cbc 既服务桌面端，又能在终端独立跑（`codebuddy`/`cbc` CLI）——一份 agent runtime 多入口。
- **可替换**：理论上任何 ACP server 都能接入（pi 若实现 ACP server 也能当后端）。

> **对我们的启示**：pi 也可包装成 ACP server 跑在独立进程，Electron 做 ACP client。这是比"主进程直接跑 pi"更稳的架构（虽然 MVP 可先简化）。

---

## 三、Sidecar 通信框架（protocol.js + sidecar-entry.js）

这是 WorkBuddy **自己实现**的 sidecar 管理层（非 ACP，是更底层的进程/IO 管理）：

### 3.1 双通道 IPC（核验自 protocol.js 全文）
- **控制通道**：`sidecar.sock`（mac/Linux Unix socket）/ `\\.\pipe\workbuddy-{token}-sidecar-control`（Windows Named Pipe）
- **数据通道**：每会话一个 `s-{sha1(id)}.sock`，互不干扰
- 路径哈希避免冲突，且处理了 macOS `sun_path` 104 字节限制（超长降级到 `/tmp`）

### 3.2 SidecarServer 职责（sidecar-entry.js）
- 启动 cbc 子进程，管理生命周期
- **RingBuffer（8MB 默认）**：环形缓冲捕获子进程 stdout/stderr，供调试回放
- 超时管理：`IDLE_TIMEOUT_MS=1800s`、`RPC_TIMEOUT_MS=10s`、`SESSION_LIFECYCLE_RPC_TIMEOUT_MS=60s`
- PID 文件（`sidecar.pid`）防多开

### 3.3 跨平台 PTY 策略（重要工程细节）
源码注释揭示踩过的坑：
- **macOS / Linux**：用 `@lydell/node-pty`（PTY 语义）
- **Windows**：**放弃 node-pty**，改用 `child_process.spawn` 纯管道。原因：ConPTY 在旧版不可用、winpty 多个 ENOENT/锁竞争/输出截断 bug。
- 注释原话：*"Trading PTY for a plain pipe on Windows... Desktop talks to the CLI over ACP/HTTP, so PTY semantics are not required"*（既然走 ACP/HTTP，PTY 的终端语义没必要）

> **工程启示**：Windows 上不要硬上 node-pty，纯管道 + ACP/HTTP 更稳。我们若做终端类功能要吸取。

---

## 四、Agent 内核：@openai/agents（在 cbc 里跑）

### 4.1 内核选型
- `@openai/agents` ^0.5.2（OpenAI 官方 Agents SDK）—— 在 **cbc sidecar 进程**内运行，不在 Electron 主进程。
- 概念核验：`Runner`、`RunState`、`handoff`（任务交接）、`runAgent` 均在源码中出现。
- `handoff` 用途：agent 间任务转移（如通用 agent → 专家 agent），配合 `buildHandoffSummarySystemPrompt()` 生成交接摘要。

### 4.2 三种交互模式（核验自 templates/）
通过切换 system prompt 模板实现，不是多 agent：
- **ask 模式**（`ask-mode-reminder.tpl`）：只读，禁止任何写操作
- **craft 模式**（`craft-mode-reminder.tpl`）：可写可改，文件编辑解锁
- **expert 模式**（`workbuddy-expert-prompt.tpl`）：注入领域专家 persona

> 模式切换是 prompt 级实现，非架构级。pi 完全可用同样的 prompt 模板机制实现。

### 4.3 上下文注入（核验自主 prompt）
主 prompt `workbuddy-prompt.tpl` 用 nunjucks 模板注入：
```
{{ modelName }}
{{ ClawMemory_1 }}          ← Claw 远程会话记忆
{{ WorkingMemoryContent }}  ← 当前任务工作记忆
{{ UserLocalMemoryContent }} ← 本地长期记忆
{{ UserMemoryContent }}     ← 云端用户记忆
```
**四层记忆**：Working（任务级）/ UserLocal（本地）/ User（云端）/ Claw（远程会话）。

---

## 五、工具系统

### 5.1 内置工具（从源码提取）
| 工具 | 用途 |
|------|------|
| `read_file` / `write_file` / `edit_file` / `list_files` | 文件操作（经 sandbox） |
| `execute_command` | 执行 shell（经 node-pty / sandbox-cli） |
| `web_search` / `web_fetch` | 联网（经后端网关） |
| `image_gen` | 图像生成（ImageGen） |
| `DeferExecuteTool` | 延迟执行（需用户确认的危险操作） |

每个工具有对应的 `*_result` 消息类型（如 `execute_command_result`）。

### 5.2 工具执行与权限
- **DeferExecuteTool**：危险工具不立即执行，先求确认（对应我们的权限 L3）。
- **命令安全审计**：`appendCommandSafetyAuditLog`、`commandSafety.sandboxExecuted` —— 每条命令过安全检查 + 审计日志。
- **auto_execute 开关**：`settings.securityCenter.systemTools.option.auto_execute` —— 用户可设自动执行或逐条确认。

### 5.3 ConnectorProxyServer（连接器代理）
- `ConnectorProxyServer.registerToolHandlersFor(mcpServer, getContext)` —— **连接器以 MCP server 形态暴露工具**。
- 即 GitHub/Figma/CNB 等连接器，各自包装成 MCP server，工具经 MCP 协议统一接入 agent。

---

## 六、MCP 实现

### 6.1 完整 MCP Host（mcp.js, 52KB）
- `@modelcontextprotocol/sdk` 1.24.3，支持三种 transport：
  - **stdio**（本地子进程 MCP server）
  - **SSE**（远程 SSE）
  - **StreamableHTTP**（`streamableHttp.js`, 54KB —— HTTP 流式）
- 能力协商、`tools/list`、`ToolListChangedNotification`、`resources/*` 全实现。

### 6.2 builtin-mcp-apps 沙箱
- MCP app 跑在**独立 BrowserWindow webview**（`mcp-app-preload.js`），`webviewTag:true`，独立 partition session。
- MCP server 在 webview 里执行，与主 UI 隔离（类似浏览器沙箱）。
- `ardot-mcp-app`（设计）、`_workbuddy-runtime`（运行时）是内置 MCP app。

> **架构启示**：MCP app = webview 沙箱 + preload 桥。既隔离又不失灵活。我们可用 UtilityProcess 或 webview 实现。

---

## 七、文档引擎：@tencent/docs-engine（SaaS 客户端架构）

### 7.1 它是什么（核验自 package.json + dylib）
**腾讯文档（在线 SaaS）的桌面编辑器引擎**，非本地 docx 库：
```
lib/darwin-arm64/
├── libeditor_sdk_ffi.dylib      ← 腾讯文档编辑器核心（C++ FFI，与 docs.qq.com 同源）
├── start_server_addon.node      ← Node 绑定，起独立 server
└── icudt72l.dat                 ← ICU 国际化数据
```

### 7.2 架构
- `startServer(options, cb)` —— addon 启动后端 server 进程
- 主进程通过 **domain proxy** 调用：`createDomainProxy<TencentDocsDomainService>('tencentDocs')` → `tencentDocs:{method}`
- 方法如 `tencentDocs:batchCreateSaasImport`（批量导入 SaaS 文档）

### 7.3 与 UI 的桥（preload 架构）
- `tdoc-import-preload.js`（27KB）/ `tdoc-preview-preload.js`（30KB）：注入到加载腾讯文档的 webview，做 iframe 通信拦截 + cookie 注入
- 独立 session partition：`persist:tdoc-import`（隔离 cookie）
- OAuth 流程：`startServerSideOauthFlow` / `startServerSideOauthRefresher`（自动刷新 token）

### 7.4 能力边界
- ✅ 完整渲染/编辑腾讯文档（表格/幻灯片/文档，保真等同 Web 版）
- ❌ 强绑腾讯云（OAuth + 数据在云端 + 登录态）
- ❌ 闭源，不可复用

> **对我们的启示**：无法复刻。我们的文档能力必须走"本地开源栈"路线（docx/xlsx/pptxgenjs + Python sidecar），保真度低但不绑生态。

---

## 八、sandbox-cli：系统级沙箱（Rust）

### 8.1 它是什么
`cli/vendor/sandbox/sandbox-cli`（3.2MB，Rust 编译）+ `tsbx_rules.json` 规则。配套 macOS 系统扩展：
```json
(sandbox-config.json)
{
  "appGroupId": "group.com.workbuddy.workbuddy",
  "fileProviderBundleId": "com.workbuddy.workbuddy.FileProvider",
  "networkExtensionBundleId": "com.workbuddy.workbuddy.NetworkExtension",
  "helperBundleId": "com.workbuddy.workbuddy.SandboxHelper",
  "tunnelDescription": "WorkBuddy 沙盒网络代理",
  "signingMode": "full"
}
```

### 8.2 能力（OS 级，远超普通进程沙箱）
- **Network Extension**：系统级网络代理，可拦截 agent 的网络请求（`securityCenter.audit.sandbox.networkBlocked`）
- **File Provider**：文件系统虚拟化 + 访问控制
- **App Group**：与主 app 共享沙箱容器
- **文件版本快照**：`listFileCommits` / `revertFileCommit` / `queryFileVersionCache` / `interceptRequest` —— agent 改文件前先 commit 快照，可回滚

### 8.3 命令安全
- 每条 `execute_command` 过 `appendCommandSafetyAuditLog` 审计
- `sandboxExecuted` 标记在沙箱内执行的命令
- Windows 用 `%LOCALAPPDATA%\LiteSandbox\`（旧版遗留路径注释提及）

> **架构启示**：这是 WorkBuddy 安全的真正护城河——OS 级网络/文件拦截 + 可回滚快照。我们 MVP 用不上，但 P1 要做权限时，至少要做到"文件操作前快照 + 命令审计"。

---

## 九、存储与会话

### 9.1 存储
- `better-sqlite3` ^12.8（同步原生 SQLite）
- 数据目录：`~/.workbuddy/`（`product.json: dataFolderName: ".workbuddy"`）
- 配置：`settings.json`（cbc 侧）+ SQLite（会话/消息）

### 9.2 会话持久化
- cbc 侧有完整 `SessionStore`（`SessionStore.transformItemForSaveAsync`），会话存 JSONL
- 主进程侧 `session:*` IPC（create/list/load/move/archive/navigate/rename/destroy）
- `agent-cli JSONL` —— 会话以 JSONL 流式落盘（便于增量 + 回放）

### 9.3 usage 快照
- `Map<sessionId, UsageSnapshot>` —— 内存中跟踪每会话 token/成本
- `usage_update` 经 ACP 推送，持久化以恢复

---

## 十、网络层

- **undici** ^6.23（Node 高性能 HTTP，全双工流式）—— 主进程用
- **axios** —— 备用
- **ws** —— WebSocket（远程连接器用）
- LLM 请求走 **cbc → 后端网关 copilot.tencent.com**（不是用户直连 LLM）—— 这是它绑腾讯云的关键点
- `aegis`（腾讯前端监控）+ OpenTelemetry 全链路追踪

---

## 十一、关键技术决策汇总（对我们的启示）

| WorkBuddy 的决策 | 原因 | 我们是否采用 |
|------------------|------|------|
| Agent 跑独立 cbc 进程，非主进程 | 进程隔离 + cbc 复用 + 崩溃隔离 | 🟡 MVP 可简化（主进程跑 pi），P1 拆 sidecar |
| 用 ACP 标准协议通信 | 开放标准、可替换后端 | 🟢 pi 可包装成 ACP server |
| Windows 放弃 node-pty 用纯管道 | ConPTY/winpty 不稳定 | ✅ 直接吸取 |
| 文档用 SaaS 编辑器引擎 | 保真度最高（但绑生态） | ❌ 走本地开源栈 |
| OS 级 sandbox（Network Extension） | 最强隔离 + 可回滚 | 🟡 MVP 不做，P1 文件快照+审计 |
| 工具危险操作 DeferExecute | 安全（求确认） | ✅ pi 的 beforeToolCall 天然支持 |
| 记忆四层（Working/User/Local/Claw） | 不同生命周期分离 | 🟢 借鉴分层 |
| 连接器包装成 MCP server | 统一工具协议 | ✅ 好做法 |
| LLM 走后端网关 | 统一计费/合规/模型管理 | ❌ 我们走用户自带 key |

---

## 十二、对我们方案的核心架构启示

1. **进程模型应仿效"UI 壳 + agent sidecar"**：即使 MVP 简化为"主进程跑 pi"，架构上要预留"pi 可拆到独立进程"的边界（pi 的 Agent 类天然支持，streamFn/invoke 可跨进程）。
2. **ACP 是值得考虑的标准**：若 pi 包装成 ACP server，能获得进程隔离 + 标准化 + 可替换性。但 ACP 会增加复杂度，MVP 可先内部协议，P1 再标准化。
3. **Windows PTY 陷阱已知**：直接用 `child_process.spawn` + JSON-RPC，不碰 node-pty on Windows。
4. **文档能力无法对等**：接受"本地开源栈"定位，主打自动化处理而非编辑器级渲染。
5. **安全靠"快照 + 审计 + 确认"三板斧**：不必上 OS 扩展，但文件改前快照、命令审计、危险操作确认必须有。

---

## 附：本次逆向方法清单

- 解包 `app.asar` → 读 `package.json`/`product.json`/`cli/package.json`
- **全文阅读**：`protocol.js`、`sidecar-entry.js`（这两个未压缩，信息密度高）
- `index.js`（14.4MB 压缩）→ `strings` 提取 IPC channel / 类名 / 注释片段
- `acp.js` / `mcp.js` → 提取协议方法与 SDK 用法
- 原生模块：`@tencent/docs-engine/lib/`、`sandbox-cli`、`*.node`
- `resources/templates/*.tpl` → 主 prompt 揭示上下文注入与模式机制
- 依赖版本来自 `package.json` 的 `dependencies`
