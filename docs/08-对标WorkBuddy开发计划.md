# 08 · Pi-a 对标 WorkBuddy 开发计划

> 本文档基于 `02-WorkBuddy完整拆解.md`（WorkBuddy 14 个子系统的实现级拆解）与 `06-MVP与路线图.md`（MVP 边界与 P1/P2 路线），对照 Pi-a **现有代码**（`src/` 全量核验）逐条梳理出待开发功能。
>
> **已实现功能不再列入**（详见项目根 README 或 `06` 文档 §1.2）：pi agent 内核 + 三模式/两级权限、自带工具 + 文档工具、联网工具、MCP Host、技能系统、工件区、记忆 CRUD、多模型、会话管理、主题、@引用、命令安全审计、流式输出、工具确认弹窗。
>
> 架构前提：Pi-a = **Deno Desktop**（`main.ts` 起 `Deno.serve` HTTP API + `Deno.BrowserWindow` 加载 `renderer/index.html`），非 Electron / 非 Tauri。所有"对标"均落到此架构上。

---

## 阅读约定

每项功能按统一 7 段格式：

1. **功能 / 描述** — 名称 + 一句话
2. **对标 WorkBuddy** — 对应子系统/能力 + 借鉴点
3. **优先级 / 难度** — P0 / P1 / P2 + 低/中/高
4. **实现方案** — 涉及文件、新建文件、改动文件
5. **关键代码/接口** — 伪代码或接口签名
6. **前端 UI 变化**
7. **测试方法**

优先级图例：
- **P0（立即）** — MVP 价值闭环必需，或补齐已存在但未落地的 UI 入口（如"项目/专家/自动化"侧栏分类当前是空壳）
- **P1（重要）** — 路线图明确列入，落地即显著提升产品力
- **P2（远期）** — 路线图远期或工程优化项

---

# 第一部分 · P0 立即落地（补齐价值闭环 + 填实空壳入口）

## 功能 1 · 对话导出（Markdown / 纯文本 / JSON）

**1. 描述**
把当前会话的完整消息（含工具调用记录）一键导出为本地文件，便于归档与分享。

**2. 对标 WorkBuddy**
对标子系统 ②（ACP `session/list` 会话归档）与 06 路线图 M1 "导出"。WorkBuddy 会话以 JSONL 持久化，天然可回放；Pi-a 的 messages 表同样结构化，只需加导出层。

**3. 优先级 / 难度**
P0 / 低

**4. 实现方案**
- 改 `main.ts`：新增 `GET /api/conv/:id/export?format=md|txt|json`
- 复用 `src/domains/session/node/store.ts` 的 `getMessages(id)` + 会话标题
- 不新建文件，仅加一个路由分支

**5. 关键代码 / 接口**
```ts
// main.ts handleApi 内新增
if (path.match(/^\/api\/conv\/[^/]+\/export$/) && req.method === "GET") {
  const id = path.split("/")[3];
  const format = new URL(req.url).searchParams.get("format") || "md";
  const { getMessages } = await import("./src/domains/session/node/store.ts");
  const msgs = getMessages(id);
  const content = format === "json" ? JSON.stringify(msgs, null, 2)
    : format === "txt" ? msgs.map(m => `[${m.role}] ${m.content}`).join("\n\n")
    : msgs.map(m => m.role === "user" ? `**用户：** ${m.content}`
        : m.role === "tool" ? `> 🔧 ${m.content}`
        : `**助手：** ${m.content}`).join("\n\n");
  const safeTitle = (await getTitle(id)).replace(/[\\\/:*?"<>|]/g, "_");
  return new Response(content, { headers: {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="${safeTitle}.${format}"`
  }});
}
```

**6. 前端 UI 变化**
- 顶栏 `topbar`（`index.html` 第 741 行附近）标题旁加"导出"图标按钮，点击弹 3 项菜单（MD / TXT / JSON）
- 触发浏览器 `window.location = '/api/conv/:id/export?format=md'` 直接下载

**7. 测试方法**
- 新建会话发 2 轮对话 + 触发一次工具，导出三种格式，检查文件内容含 user/assistant/tool 三类
- 标题含特殊字符（`/`、`:`）时文件名安全转义

---

## 功能 2 · 项目实体（会话归类 + 关联文件目录）

**1. 描述**
侧栏已有"项目"分类（`data-cat="project"`），但目前只是 conversations 表的一个 category 值，没有真正的项目实体。补齐：项目可创建、可关联一个本地工作目录、会话归到项目下。

**2. 对标 WorkBuddy**
对标子系统 ⑩（`~/.workbuddy/` 目录组织）+ 06 路线图 MVP "创建项目、关联文件目录、会话归到项目"。WorkBuddy 的 connectors/skills/mcp 都按"工作区"组织，项目是 Pi-a 对"工作区"的轻量实现。

**3. 优先级 / 难度**
P0 / 中

**4. 实现方案**
- `src/infra/db.ts`：新增 `projects` 表（幂等 `CREATE TABLE IF NOT EXISTS`）；给 `conversations` 加 `project_id` 列（`addColumn`）
- 新建 `src/domains/project/node/store.ts`：项目 CRUD
- `main.ts`：新增 `/api/projects`（GET 列表 / POST 创建 / DELETE / PATCH 改目录）
- `src/domains/session/node/store.ts`：`createConversation` 支持 `projectId`；`listConversations` 支持 `projectId` 过滤
- 当某项目被选中时，该会话的 agent 默认 `cwd` / `docs_dir` 切到项目目录（改 `engine.ts` 读 settings 时优先取项目级配置）

**5. 关键代码 / 接口**
```ts
// db.ts schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dir TEXT NOT NULL,           -- 关联的本地目录
    color TEXT DEFAULT 'var(--cat-p)',
    created_at INTEGER NOT NULL
  );
`);
addColumn("conversations", "project_id", "TEXT");

// src/domains/project/node/store.ts
export interface Project { id: string; name: string; dir: string; color: string; createdAt: number; }
export function createProject(name: string, dir: string, color?: string): Project;
export function listProjects(): Project[];
export function deleteProject(id: string): void;
export function updateProject(id: string, patch: Partial<Pick<Project,"name"|"dir"|"color">>): void;
```

**6. 前端 UI 变化**
- 点击侧栏"项目"分类时，主区改为项目列表视图（卡片：名称 / 目录路径 / 会话数），而非直接对话
- 项目卡片点击进入该项目 → 显示该项目下的会话列表 + "新对话"按钮
- 新建会话时若处于项目内，自动绑定 `project_id`，且 `@引用` 候选文件读自项目 `dir`
- 设置面板"常规设置"内的 `docs_dir` 增加"跟随当前项目"选项

**7. 测试方法**
- 创建项目指向 `~/Desktop/test-project`，在其中建 2 个会话，切到"助理"分类看不到它们，切回"项目"看到，验证隔离
- 删除项目时会话不连带删除（保留 conversations，`project_id` 置空）

---

## 功能 3 · 专家模式入口（预设角色 / 系统提示模板）

**1. 描述**
侧栏已有"专家"分类（`data-cat="expert"`）但无实体。补齐：预置若干"专家"（如文案专家、数据分析专家、翻译专家），每个专家有定制系统提示 + 推荐模型 + 默认工具子集，本质是"预设 agent 配置"。

**2. 对标 WorkBuddy**
对标子系统 ⑫（Agent Teams 的 agentMap）的轻量版——WorkBuddy 用 `agentMap: Map<name, Agent>` 管理多 agent，每个有独立 systemPrompt/工具。Pi-a MVP 不做真正的多 agent 编排，但做"配置预设"。

**3. 优先级 / 难度**
P0 / 中

**4. 实现方案**
- `src/infra/db.ts`：新增 `experts` 表（内置预置记录 + 用户自定义）
- 新建 `src/domains/expert/node/store.ts`：专家 CRUD + 内置种子
- `src/agent/engine.ts`：`createWorkBuddyAgent` 的 `opts.systemPrompt` 已支持，把专家的 `systemPrompt` / `recommendedModel` / `toolsMask` 注入
- `main.ts`：`/api/experts` CRUD；`/api/prompt` 支持 `expertId` 参数，prompt 时从专家取配置覆盖默认
- `src/domains/session/node/store.ts`：`conversations` 加 `expert_id` 列

**5. 关键代码 / 接口**
```ts
// src/domains/expert/node/store.ts
export interface Expert {
  id: string;
  name: string;            // "文案专家"
  icon: string;            // emoji
  systemPrompt: string;    // 追加到基础 SYSTEM_PROMPT 之后
  recommendedProvider?: string;
  recommendedModelId?: string;
  toolsMask?: string[];    // 可选：限制可用工具白名单
  builtin: boolean;
}
export function listExperts(): Expert[];
export function createExpert(e: Omit<Expert,"id"|"builtin">): Expert;
export function seedBuiltinExperts(): void; // 启动时调用，写文案/数据/翻译/法律/编程 5 个

// engine.ts：opts 扩展
createWorkBuddyAgent(onEvent, {
  modelProvider: expert?.recommendedProvider ?? conv.model_provider,
  modelId: expert?.recommendedModelId ?? conv.model_id,
  systemPrompt: BASE_PROMPT + (expert?.systemPrompt ?? ""),
  tools: expert?.toolsMask ? filterTools(getFullTools(), expert.toolsMask) : undefined,
});
```

**6. 前端 UI 变化**
- 点侧栏"专家"→ 主区显示专家卡片网格（图标 / 名称 / 一句描述 / "开始对话"按钮）
- 进入专家对话时，顶栏 model-badge 显示专家推荐模型，composer 工具栏显示专家身份 chip
- 设置面板新增"专家管理"tab：列出专家、编辑 systemPrompt、新建自定义专家

**7. 测试方法**
- 选"翻译专家"，发英文要求翻译，验证输出受专家 systemPrompt 影响（如固定输出格式）
- 专家设置了 `toolsMask: ["read_doc","web_search"]`，验证 agent 只能调这两个工具，write_docx 被屏蔽

---

## 功能 4 · PDF 文档读取（补全 read_doc 支持格式）

**1. 描述**
`src/domains/doc/node/reader.ts` 当前支持 txt/md/json/csv/docx/xlsx/pptx，唯独缺 pdf。reader.ts 第 4 行注释明确写"pdf 暂不支持（P1）"。补齐 PDF 文本提取。

**2. 对标 WorkBuddy**
对标子系统 ⑤（内置工具全集）+ 04 文档引擎"读(pdf)"。WorkBuddy 用 pdf 服务端解析；Pi-a 本地用纯 JS 库。

**3. 优先级 / 难度**
P0 / 中（核心在选对 Deno 兼容的库）

**4. 实现方案**
- `deno.json` 新增依赖：`"pdfjs-dist": "npm:pdfjs-dist@4.x"`（纯 JS，Deno 兼容，无需 worker）
- `src/domains/doc/node/reader.ts`：`readDoc` switch 加 `case "pdf": return readPdf(path)`
- 新增 `readPdf`：用 pdfjs-dist 的 `getDocument` API，逐页 `getTextContent` 拼接
- `/api/preview`（main.ts 第 381 行）的 ext 分支加 `pdf`：返回文本大纲（保留兼容）
- `@引用` 候选文件扩展名白名单（main.ts 第 144 行）加 `pdf`

**5. 关键代码 / 接口**
```ts
// reader.ts
async function readPdf(path: string): Promise<ReadResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await Deno.readFile(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => it.str).join(" ");
    parts.push(`## 第 ${i} 页\n${text}`);
  }
  return truncate(parts.join("\n\n") || "(空 PDF)", "pdf");
}
```

**6. 前端 UI 变化**
- 预览弹窗：pdf 先走文本大纲渲染（与 pptx 一致）；远期可嵌入 `<iframe>` + pdf.js viewer 做保真预览
- `@引用` 输入 `@报告.pdf` 可联想

**7. 测试方法**
- 选一个含中文的扫描/文本混合 PDF，验证文本页提取完整、页码正确
- 加密 PDF 返回友好错误而非崩溃
- 大 PDF（>100 页）验证 MAX_CHARS 截断生效

---

## 功能 5 · 事件推送改造（轮询 → SSE）

**1. 描述**
当前前端轮询 `GET /api/events/:id`（main.ts 第 246 行），注释自承"MVP 用轮询模型（最简）；P1 研究 deno desktop 的事件主动推送 API"。改为 SSE 长连接，降低延迟与空轮询开销。

**2. 对标 WorkBuddy**
子系统 ②（ACP 全程 SSE 流式）+ ③（StreamManager 双 transport）。WorkBuddy 的 `SessionUpdate` 事件（AgentMessageChunk / ToolCallUpdate 等）全部经 SSE 实时推。Pi-a 的 `AgentEvent` 已是事件流，只差传输层。

**3. 优先级 / 难度**
P0 / 中

**4. 实现方案**
- `main.ts`：新增 `GET /api/stream/:id`（SSE），用 `ReadableStream` + `text/event-stream`
- 改 `getQueue` 机制：SSE 连接建立时直接 `provider.onEvent(id, cb)` 推送，不再写队列；保留 `/api/events` 兼容降级
- 前端 `renderer/index.html`：把 `setInterval` 轮询改为 `new EventSource('/api/stream/'+id)`，`onmessage` 分发事件；断线自动重连
- 心跳：每 15s 推一个 `: ping\n\n` 注释行防代理超时

**5. 关键代码 / 接口**
```ts
// main.ts
if (path.startsWith("/api/stream/") && req.method === "GET") {
  const id = path.split("/")[3];
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (ev: any) => controller.enqueue(
        enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const unsub = provider.onEvent(id, send);
      const heartbeat = setInterval(() =>
        controller.enqueue(enc.encode(`: ping\n\n`)), 15000);
      // request.closed 时清理
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat); unsub(); controller.close();
      });
    }
  });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream",
    "cache-control": "no-cache", "connection": "keep-alive"
  }});
}

// 前端
const es = new EventSource(`/api/stream/${sessionId}`);
es.onmessage = (e) => handleEvent(JSON.parse(e.data));
es.onerror = () => { es.close(); setTimeout(reconnect, 2000); };
```

**6. 前端 UI 变化**
无明显视觉变化，但流式 token 显示更跟手（无轮询间隔造成的卡顿）；移除轮询 setInterval。

**7. 测试方法**
- 发起长任务（让 agent 连续调 5 个工具），观察事件到达间隔 < 200ms（轮询模型通常 500ms+）
- 断网/关窗后服务端 listener 被正确清理（`provider.sessions` 不泄漏）
- 多会话并发各开 SSE，互不串流

---

# 第二部分 · P1 重要能力（路线图明确列入）

## 功能 6 · 会话分叉（消息树 / Fork）

**1. 描述**
从某条消息处"分叉"出新会话，保留原会话不变，在新分支上探索不同方向。当前 messages 表是扁平列表（无 parent_id），无法表达树形分支。

**2. 对标 WorkBuddy**
直接对标子系统 ② 的 `session/fork`（"从某点分叉新会话（分支对话）"）+ 06 路线图 M1 "消息树分支"。WorkBuddy fork 是 ACP 一等公民。

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- `src/infra/db.ts`：`messages` 表加 `parent_id` 列（记录上一条消息 id）；新增 `conversation_forks` 表记录分叉关系
- `src/domains/session/node/store.ts`：
  - `appendMessage` 支持 `parentId`
  - 新增 `forkConversation(srcId, fromMessageId)`：拷贝 srcId 中 `createdAt <= fromMessage.createdAt` 的消息到新会话，返回新会话 id
- `src/agent/provider.ts`：`ensureSession` 时若该会话是 fork 出来的，把历史消息重建进 agent state（而非从空开始）
- `main.ts`：`POST /api/conv/:id/fork { fromMessageId }`

**5. 关键代码 / 接口**
```ts
// session store
export function forkConversation(srcId: string, fromMsgId: string): Conversation {
  const db = getDb();
  const src = getMessages(srcId);
  const cutoff = src.find(m => m.id === fromMsgId);
  if (!cutoff) throw new Error("fork 点不存在");
  const keep = src.filter(m => m.createdAt <= cutoff.createdAt);
  const newConv = createConversation(getConv(srcId).title + " (分支)", getConv(srcId).category);
  for (const m of keep) {
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, ...) VALUES (?)")
      .run(crypto.randomUUID(), newConv.id, m.role, m.content, ...);
  }
  db.prepare("INSERT INTO conversation_forks (src, dst, from_msg) VALUES (?,?,?)")
    .run(srcId, newConv.id, fromMsgId);
  return newConv;
}

// provider：fork 会话首次 prompt 前重放历史
ensureSession(id) {
  // ... 现有逻辑
  const history = getMessages(id);
  if (history.length > 0) agent.state.messages = rebuildFromHistory(history);
}
```

**6. 前端 UI 变化**
- 每条消息 hover 显示"分叉"图标，点击后弹确认 → 跳转到新会话
- 原会话与 fork 会话在侧栏用缩进或连线表示父子关系（可选，远期）

**7. 测试方法**
- 3 轮对话后从第 2 条 fork，验证新会话含前 2 轮、原会话不动
- 在 fork 会话继续对话，agent 上下文含历史（不"失忆"）
- fork 自 fork（孙分支）链路正确

---

## 功能 7 · 工作记忆分层 + 缓存优化

**1. 描述**
当前记忆是单层扁平全量召回（`recallMemories()` 一次性返回全部，engine.ts `loadMemoryPrompt` 全量注入）。对标 WorkBuddy 四层记忆 + 正负缓存 + 并发去重 + 字符上限。

**2. 对标 WorkBuddy**
子系统 ⑨ 完整对标：
- 四层：ClawMemory / WorkingMemory / UserLocalMemory / UserMemory → Pi-a 简化为两层（WorkingMemory 任务级 + UserMemory 长期，去掉 Claw 云端层）
- `USER_MEMORY_CACHE_TTL_MS=300000` 正缓存 + `NEGATIVE_TTL_MS=30000` 负缓存
- `inflightFetches` 并发去重
- `MAX_USER_MEMORY_CHARS=10000` 上限

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- `src/infra/db.ts`：`memories` 表已有 `scope` 字段（当前未充分使用），扩展 `kind` 增加枚举值 `working`；新增 `session_id` 列（工作记忆按会话隔离）
- `src/domains/memory/node/store.ts`：
  - `recallMemories(scope?)`：按 scope 过滤；长期记忆全量、工作记忆按 sessionId
  - 新增缓存层：`MemoryCache`（Map + TTL + inflight 去重）
- `src/agent/engine.ts`：`loadMemoryPrompt` 分两段注入：`<working_memory>`（当前会话）+ `<user_memory>`（长期，带 10000 字符上限）
- `src/agent/tools/memory.ts`：`memory_write` 工具支持 `scope` 参数（user / working）

**5. 关键代码 / 接口**
```ts
// store.ts 缓存层
class MemoryCache {
  private cache = new Map<string, { data: Memory[]; expire: number }>();
  private inflight = new Map<string, Promise<Memory[]>>();
  async get(scope: string, fetcher: () => Promise<Memory[]>): Promise<Memory[]> {
    const hit = this.cache.get(scope);
    if (hit && hit.expire > Date.now()) return hit.data;
    if (this.inflight.has(scope)) return this.inflight.get(scope)!;
    const p = fetcher().then(data => {
      this.cache.set(scope, { data, expire: Date.now() + 300000 });
      this.inflight.delete(scope);
      return data;
    });
    this.inflight.set(scope, p);
    return p;
  }
  invalidate(scope?: string) { scope ? this.cache.delete(scope) : this.cache.clear(); }
}

// engine.ts 注入分层
function loadMemoryPrompt(sessionId: string): string {
  const working = recallMemories("working", sessionId);   // 任务级
  const user = recallMemories("user");                     // 长期
  return `\n<working_memory>\n${fmt(working)}\n</working_memory>
\n<user_memory>\n${truncate(fmt(user), 10000)}\n</user_memory>`;
}
```

**6. 前端 UI 变化**
- 设置面板"长期记忆"tab 区分两个分组：长期记忆（跨会话）/ 工作记忆（当前会话，随会话关闭归档或清理）
- 记忆列表项显示 scope 标签

**7. 测试方法**
- 写 100 条长期记忆，验证 prompt 注入超 10000 字符时正确截断并提示
- 并发 3 个 prompt 同时触发 recallMemories，验证只查一次 DB（并发去重）
- 工作记忆在会话 A 写入，会话 B 看不到（隔离）

---

## 功能 8 · 自动化系统（触发器 + 定时任务）

**1. 描述**
侧栏已有"自动化"分类（`data-cat="automation"`）但完全空壳。补齐 WorkBuddy 子系统 ⑬：cron 定时 / 事件触发，执行一个技能或 agent prompt，记录运行结果。

**2. 对标 WorkBuddy**
子系统 ⑬ 完整对标：
- 触发器：cron（周几/时间）+ 事件（文件变化、热键）
- 数据源（`automation:datasource`）
- 动作：执行技能 / agent prompt
- 运行记录：inProgress/scheduled/completed/archived 四态 + artifacts/summary/linked conversation
- 内置模板：`healthCheckupReminder`、`competitorSnapshot`

**3. 优先级 / 难度**
P1 / 高

**4. 实现方案**
- `src/infra/db.ts`：新增 `automations` 表 + `automation_runs` 表
- 新建 `src/domains/automation/node/store.ts`：自动化 CRUD + 运行记录
- 新建 `src/domains/automation/node/scheduler.ts`：调度器（Deno 里用 `setInterval` 轮询 + cron 解析，或用 `node-cron`）
- 新建 `src/domains/automation/node/triggers.ts`：文件监听（`Deno.watchFs`）+ 热键（后续 OS 自动化配合）
- `main.ts`：`/api/automations` CRUD + `/api/automations/:id/runs`；启动时 `startScheduler()`
- 触发时：创建一个临时会话（category="automation"）→ `provider.prompt(sessionId, actionPrompt)` → 结果写入 `automation_runs`

**5. 关键代码 / 接口**
```ts
// db.ts
db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, name TEXT, enabled INTEGER DEFAULT 1,
    trigger_type TEXT,        -- cron | file_watch | hotkey
    trigger_config TEXT,      -- JSON: {cron:"0 9 * * 1"} | {path:"~/Desktop", pattern:"*.xlsx"} | {key:"⌘⇧R"}
    action_type TEXT,         -- skill | prompt
    action_config TEXT,       -- JSON: {skill:"weekly-report"} | {prompt:"总结今天的桌面文件"}
    last_run INTEGER, next_run INTEGER, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY, automation_id TEXT, status TEXT,  -- scheduled|inProgress|completed|failed|archived
    session_id TEXT, summary TEXT, artifacts_json TEXT, started_at INTEGER, finished_at INTEGER
  );
`);

// scheduler.ts
export function startScheduler() {
  setInterval(async () => {
    const due = listDueAutomations(Date.now());   // next_run <= now
    for (const a of due) {
      const run = await executeAutomation(a);      // 创建会话 + provider.prompt
      updateNextRun(a.id, computeNextCron(a.trigger_config.cron));
    }
  }, 30000);  // 30s 扫描一次
}

// 触发执行
async function executeAutomation(a: Automation): Promise<Run> {
  const conv = createConversation(`[自动] ${a.name}`, "automation");
  const prompt = a.action_type === "skill"
    ? buildSkillPrompt(a.action_config.skill)
    : a.action_config.prompt;
  provider.prompt(conv.id, prompt, { mode: "craft", permission: "default" });
  return createRun(a.id, "inProgress", conv.id);
}
```

**6. 前端 UI 变化**
- 点侧栏"自动化"→ 主区显示自动化列表（名称 / 触发器图标 / 下次运行 / 状态 / 开关）
- 新建自动化表单：触发器类型选择 + cron 可视化（预设"每天 9 点/每周一"等）+ 动作选择（技能下拉 / 自定义 prompt）
- 运行记录抽屉：点击某自动化查看历史运行（含摘要、生成工件、关联会话跳转）
- 内置 2 个模板卡片一键创建（每日桌面整理 / 竞品快照）

**7. 测试方法**
- 创建一个 `cron: "*/2 * * * *"`（每 2 分钟）的自动化，等待触发，验证生成会话与工件
- 文件监听触发：在监听目录新建文件，验证触发
- 禁用自动化后不再触发；重启应用后调度恢复

---

## 功能 9 · 速唤浮窗（全局热键唤起）

**1. 描述**
系统级全局快捷键（如 `⌥Space`）随时唤起一个轻量浮窗，输入即问，上下文感知（自动带上当前前台应用/选中文本）。

**2. 对标 WorkBuddy**
子系统 ①（float 浮动窗口）+ 06 路线图 P1 "速唤浮窗（⌥Space、上下文感知）"。WorkBuddy 有独立 `float` 窗口角色。

**3. 优先级 / 难度**
P1 / 高（依赖 Deno Desktop 是否暴露全局热键 API，需 spike）

**4. 实现方案**
- spike 验证 `Deno.BrowserWindow` 是否支持 `setShortcut` / 全局热键注册；若不支持，用原生 Swift helper（一个小 `.app` 注册 `CGEventTap` 热键）通过 IPC 通知主进程
- `main.ts`：新增第二个 `BrowserWindow`（`frame:false, type:"utility", alwaysOnTop:true, skipTaskbar:true, hidden:true`），加载 `/float` 路由（renderer 内加一个轻量浮窗 HTML 视图）
- 浮窗复用同一 `provider`，但默认用 Ask 模式（快速问答），可切到 Craft
- 上下文采集：调 `osascript`（macOS）取当前前台 app 名 + 选中文本（`pbpaste` 配合），注入 prompt

**5. 关键代码 / 接口**
```ts
// main.ts
let floatWin: any;
function createFloatWindow() {
  floatWin = new (Deno as any).BrowserWindow({
    width: 480, height: 72, frame: false, type: "utility",
    alwaysOnTop: true, skipTaskbar: true, show: false, url: serveUrl + "#float"
  });
}
// 全局热键（spike 确认 API 后）
registerGlobalShortcut("Alt+Space", () => {
  if (floatWin.isVisible()) { floatWin.hide(); }
  else { floatWin.show(); floatWin.focus(); captureContext(); }
});

// 上下文采集
async function captureContext(): Promise<{ app: string; selection: string }> {
  const app = (await new Deno.Command("osascript", { args: ["-e", 'tell application "System Events" to name of first process whose frontmost is true'] }).output())
    .stdout.toString().trim();
  const selection = (await new Deno.Command("pbpaste").output()).stdout.toString().trim().slice(0, 500);
  return { app, selection };
}
```

**6. 前端 UI 变化**
- 新增 `#float` 视图：极简单行输入框 + 答案气泡，无侧栏无会话列表
- 浮窗答案可"转入主窗口继续"（把当前问答转成主区的一个新会话）
- 设置面板新增"速唤"tab：配置热键、是否自动带选中文本、默认模式

**7. 测试方法**
- 任意应用下按 `⌥Space` 浮窗弹出，再按隐藏
- 在浏览器选一段文本，唤起浮窗提问，验证选中文本被注入上下文
- 浮窗 Ask 模式不触发任何工具调用

---

## 功能 10 · 自定义技能编辑器（GUI 创建/编辑/导入导出）

**1. 描述**
当前技能只能手改 `~/.pi-a/skills/*/SKILL.md`。补齐 GUI：在设置面板内创建、编辑技能（YAML frontmatter + Markdown body）、导入导出 `.skill` 包。

**2. 对标 WorkBuddy**
子系统 ⑧（三类技能 + 技能市场 + skill-creator 元技能）+ 06 路线图 P1 "自定义技能编辑器 + 导入导出"。

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- 新建 `src/domains/skill/node/store.ts`：技能文件 CRUD（读写 `~/.pi-a/skills/<name>/SKILL.md`），解析 frontmatter
- `main.ts`：
  - `GET /api/skills`：列出（含 builtin 标记）
  - `POST /api/skills`：新建 `{ name, description, body }`
  - `PUT /api/skills/:name`：编辑
  - `DELETE /api/skills/:name`：删除（builtin 不可删）
  - `POST /api/skills/import`（multipart 上传 `.skill` zip）
  - `GET /api/skills/:name/export`：导出为 zip
- 复用 `src/agent/skills.ts` 的 `loadSkillsPrompt`（编辑后下次 prompt 自动重载）

**5. 关键代码 / 接口**
```ts
// src/domains/skill/node/store.ts
export interface SkillMeta {
  name: string; description: string; allowedTools?: string[];
  disabled: boolean; builtin: boolean; path: string; body: string;
}
export async function listSkills(): Promise<SkillMeta[]> {
  // 扫描 SKILLS_DIR + builtin（resources/builtin-skills）
  // 解析每个 SKILL.md 的 frontmatter
}
export async function saveSkill(name: string, meta: Partial<SkillMeta>): Promise<void> {
  const dir = `${SKILLS_DIR}/${name}`;
  await Deno.mkdir(dir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: ${meta.description}\n${meta.allowedTools?`allowed-tools: ${meta.allowedTools.join(",")}`:""}\n---\n\n${meta.body}`;
  await Deno.writeTextFile(`${dir}/SKILL.md`, content);
}
export async function parseSkillFrontmatter(text: string): Promise<SkillMeta>;
```

**6. 前端 UI 变化**
- 设置面板新增"技能"tab（或独立大弹窗）：
  - 左：技能列表（builtin 灰显、用户技能可编辑/删除）
  - 右：编辑器（frontmatter 表单字段 + Markdown body 编辑区 + 实时预览）
  - 顶部按钮：新建 / 导入 / 导出
- 技能可设 `disabled`（临时禁用，不影响文件）

**7. 测试方法**
- 新建技能"会议纪要"，描述触发词，验证下次对话提到"会议纪要"时 agent 按技能执行
- 导出技能为 zip，删除后导入，验证还原
- 编辑 builtin 技能提示"内置不可编辑"（允许复制为副本再编辑）

---

## 功能 11 · docx 自由编辑 + pptx 编辑（结构化驱动）

**1. 描述**
当前 docx 只能"模板填充"（`edit_docx` 用 docxtemplater 替换 `{{key}}`），无法自由增删段落；pptx 只能生成不能编辑。补齐结构化编辑能力（不追求 XML 自由编辑，但支持增删段落/替换文本）。

**2. 对标 WorkBuddy**
子系统 ⑤（文件操作 FileProjection + 文件版本快照）+ 11（文档引擎）+ 06 路线图 P1 "docx 自由编辑 / pptx 编辑"。WorkBuddy 走 FileProjection 改 XML；Pi-a 走结构化 op 驱动（更可靠）。

**3. 优先级 / 难度**
P1 / 高

**4. 实现方案**
- `src/domains/doc/node/editor.ts`：
  - 新增 `editDocxFree(path, ops)`：用 `docx` 库（deno.json 已依赖）读取 → 应用 ops（`insert_paragraph_after` / `delete_paragraph` / `replace_text` / `set_heading`）→ 写回
  - 新增 `editPptx(path, ops)`：用 pptxgenjs 不支持改现有文件，改用 pizzip 直接操作 `ppt/slides/slideN.xml`（替换 `<a:t>` 文本、复制 slide）
- `src/agent/tools/doc.ts`：扩展 `editDocxTool` 的 schema 支持 ops 数组；新增 `editPptxTool`
- 编辑前复用现有 `createBackupVersion`（已有，第 33 行）

**5. 关键代码 / 接口**
```ts
// editor.ts
type DocxOp =
  | { op: "insert_paragraph"; afterHeading?: string; text: string; style?: "h1"|"h2"|"normal" }
  | { op: "delete_paragraph"; match: string }   // 删含某文本的段
  | { op: "replace_text"; from: string; to: string };

export async function editDocxFree(path: string, ops: DocxOp[]): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  // 1. 用 mammoth 提取现有结构 → 转成内部 Paragraph[] 模型
  // 2. 逐个应用 ops 修改模型
  // 3. new Document({ sections: [{ children: paragraphs }] }) → Packer.toBuffer → 写回
  // 注：保真度有限，复杂样式可能丢失，配套版本备份兜底
}

type PptxOp =
  | { op: "replace_text"; slide: number; from: string; to: string }
  | { op: "duplicate_slide"; slide: number };

export async function editPptx(path: string, ops: PptxOp[]): Promise<void> {
  const buf = await Deno.readFile(path);
  const Pizzip = (await import("pizzip")).default;
  const zip = new Pizzip(buf);
  for (const o of ops) {
    if (o.op === "replace_text") {
      const file = zip.files[`ppt/slides/slide${o.slide}.xml`];
      const xml = file.asText().replace(escapeXml(o.from), escapeXml(o.to));
      zip.file(`ppt/slides/slide${o.slide}.xml`, xml);
    }
  }
  await Deno.writeFile(path, zip.generate({ type: "nodebuffer" }));
}
```

**6. 前端 UI 变化**
无明显 UI 变化（工具层）；预览弹窗编辑后刷新即可看到结果。版本历史面板可看到每次编辑的快照。

**7. 测试方法**
- 对生成的 docx 执行 `insert_paragraph` + `replace_text`，重新预览验证
- 对 pptx 替换某页文本，重新预览验证替换生效且不破坏其他页
- 编辑前自动备份 v2，回滚到 v1 验证内容还原

---

## 功能 12 · PDF 导出（本地导出 docx/xlsx → PDF）

**1. 描述**
把工件区的 docx/xlsx 一键导出为 PDF。当前无此能力。

**2. 对标 WorkBuddy**
06 路线图 P1 "导出 PDF（LibreOffice）"。WorkBuddy 有服务端渲染；Pi-a 走本地（不绑生态）。

**3. 优先级 / 难度**
P1 / 中（依赖外部工具，需处理"未安装"降级）

**4. 实现方案**
- 优先方案：检测系统是否装了 LibreOffice（`/Applications/LibreOffice.app`），有则 `soffice --headless --convert-to pdf`
- 备选方案：检测是否装了 `pandoc`（docx→pdf 需 LaTeX），或用 macOS 原生 `cupsfilter`（仅文本类）
- 兜底：docx 可用 `docx` + 浏览器打印（开预览 → 调用 `window.print()`，但保真差）
- `main.ts`：`POST /api/artifacts/:id/export-pdf`，先 `createBackupVersion`，调转换器，输出到 artifacts 目录并登记新工件

**5. 关键代码 / 接口**
```ts
// main.ts
async function exportToPdf(srcPath: string): Promise<string> {
  const outDir = srcPath.split("/").slice(0, -1).join("/");
  // 试 LibreOffice
  const soffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  try {
    await Deno.stat(soffice);
    const cmd = new Deno.Command(soffice, {
      args: ["--headless", "--convert-to", "pdf", "--outdir", outDir, srcPath]
    });
    await cmd.output();
    return srcPath.replace(/\.(docx|xlsx|pptx)$/, ".pdf");
  } catch {
    throw new Error("未检测到 LibreOffice，请安装后重试（brew install libreoffice）");
  }
}
```

**6. 前端 UI 变化**
- 工件预览弹窗加"导出 PDF"按钮
- 若 LibreOffice 未装，点击后弹引导（安装链接 + 说明）

**7. 测试方法**
- 装 LibreOffice 后导出 docx，验证 PDF 生成、页数合理
- 未装时点击返回友好错误
- 导出的 PDF 登记为工件，可在工件区看到

---

## 功能 13 · OS Computer Use（截图 + 鼠标键盘控制）

**1. 描述**
让 agent 能看到屏幕（截图）并操作鼠标键盘，实现"帮我点开XX""在那个窗口输入YY"。

**2. 对标 WorkBuddy**
05 文档（OS 自动化与权限）+ 06 路线图 P1 "Computer Use（macOS Accessibility 优先）"。WorkBuddy 走 macOS Accessibility API。

**3. 优先级 / 难度**
P1 / 高（安全与可靠性需重点打磨）

**4. 实现方案**
- 工具层（新建 `src/agent/tools/os.ts`）：
  - `screenshot`：macOS 用 `screencapture -x -C` 截图 → 返回图片路径（多模态模型识图）
  - `mouse_click {x, y}` / `mouse_move` / `key_type {keys}`：调用 `cliclick`（需用户装）或 AppleScript
  - `app_focus {name}`：`osascript -e 'tell application "X" to activate'`
- 权限：首次使用引导用户授予"辅助功能"权限（`/usr/bin/tccutil` 检测状态）
- 安全：Computer Use 工具强制走确认弹窗（即使 full 权限），步数上限（防失控），每步截图留证
- `src/agent/tools/index.ts`：Craft 模式工具集加这些（Ask/Plan 不加）

**5. 关键代码 / 接口**
```ts
// src/agent/tools/os.ts
const screenshotTool: AgentTool = {
  name: "screenshot",
  parameters: Type.Object({ region: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() })) }),
  execute: async (_id, p) => {
    const path = `${artifactsDir}/shot-${Date.now()}.png`;
    const cmd = new Deno.Command("screencapture", { args: ["-x", "-C", path] });
    await cmd.output();
    return { content: [{ type: "image", path }], details: { path } };
  },
};
const clickTool: AgentTool = {
  name: "mouse_click",
  parameters: Type.Object({ x: Type.Number(), y: Type.Number(), button: Type.Optional(Type.Union([Type.Literal("left"),Type.Literal("right")])) }),
  execute: async (_id, p) => {
    const cmd = new Deno.Command("cliclick", { args: [p.button==="right"?"rc:":"c:", `${p.x},${p.y}`] });
    await cmd.output();
    return { content: [{ type: "text", text: `已点击 (${p.x},${p.y})` }] };
  },
};
```

**6. 前端 UI 变化**
- composer 工具栏新增"电脑控制"开关（默认关，开启后这些工具才注入）
- Computer Use 执行时主区显示实时截图缩略图流（每步一张）+ 确认弹窗
- 设置面板新增"权限"区域：辅助功能授权状态检测 + 引导

**7. 测试方法**
- 让 agent"截个屏看看"，验证截图生成、多模态模型能描述内容
- 让 agent"打开 Safari 并搜索 weather"，逐步确认执行
- 步数上限（如 20 步）触发自动中断

---

## 功能 14 · 权限三层模型（L1/L2/L3）

**1. 描述**
当前是两级（default/full）。升级为三层：L1 只读 / L2 写操作确认 / L3 危险操作必须确认，配套引导。

**2. 对标 WorkBuddy**
子系统 ⑤（命令安全三层审计 execPolicy/commandSafety/excluded）+ ④（DeferExecuteTool）+ 06 路线图 P1 "权限三层模型（L1/L2/L3）+ 引导"。

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- `src/agent/permissions.ts`：
  - `PermLevel` 改为 `"L1" | "L2" | "L3"`
  - 工具分级表：`READ_TOOLS`（read/read_doc/web_fetch/memory_recall/screenshot）→ L1 放行；`WRITE_TOOLS`（write/edit/bash/write_docx 等）→ L2 确认；`DANGER_TOOLS`（rm 类 bash、Computer Use 的 mouse_click/key_type）→ L3 强制确认（即使 L3 权限也要二次确认）
- `src/agent/provider.ts`：`PromptOptions.permission` 类型更新
- `main.ts`：确认弹窗按级别显示不同警示色（L2 黄 / L3 红）
- 前端：模式菜单三选项替换现有两选项

**5. 关键代码 / 接口**
```ts
// permissions.ts
export type PermLevel = "L1" | "L2" | "L3";
const TOOL_LEVEL: Record<string, 1|2|3> = {
  read: 1, read_doc: 1, web_fetch: 1, web_search: 1, memory_recall: 1, screenshot: 1,
  write: 2, edit: 2, bash: 2, write_docx: 2, write_xlsx: 2, write_pptx: 2, edit_xlsx: 2, edit_docx: 2, memory_write: 2,
  mouse_click: 3, key_type: 3,
};
export async function checkToolPermission(sessionId, perm: PermLevel, toolName, args) {
  const dangerCmd = toolName === "bash" && isDangerousCommand(args.command);  // 黑名单仍强制
  if (dangerCmd) return { allow:false, block:true, reason:"危险命令拦截" };
  const need = TOOL_LEVEL[toolName] ?? 2;
  const allowed = perm === "L3" || (perm === "L2" && need <= 2) || (perm === "L1" && need === 1);
  if (allowed && need < 3) return { allow:true };
  // 需确认（L2 的写、L3 的危险、或权限不足）
  const handler = confirmHandlers.get(sessionId);
  const approved = handler ? await handler(toolName, args) : false;
  return approved ? { allow:true } : { allow:false, block:true, reason:"用户拒绝" };
}
```

**6. 前端 UI 变化**
- composer 权限菜单三选项：L1 只读（🟢）/ L2 标准（🟡，默认）/ L3 完全（🔴）
- 确认弹窗按工具级别配色 + 文案（L3 显著警示 + 显示完整命令）

**7. 测试方法**
- L1 下 agent 调 write 被拦截要求确认；L2 下 write 直接执行但 mouse_click 仍确认；L3 全放行但危险工具二次确认
- 危险命令（rm -rf）任何级别都拦截

---

## 功能 15 · 会话恢复（Resume）双语义

**1. 描述**
当前关闭/重启应用后，历史会话能看消息但不能"继续运行"。补齐 WorkBuddy 的 `session/load`（回放历史重建 agent 上下文）与 `session/resume`（恢复运行态）双语义。

**2. 对标 WorkBuddy**
子系统 ②（load 回放 / resume 仅运行态）+ ⑩（CheckpointService）。

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- `src/agent/provider.ts`：`ensureSession` 改造——首次访问某会话时，从 DB 读历史消息，重建 `agent.state.messages`（load 语义）
- 新建 `src/domains/session/node/checkpoint.ts`：会话运行态快照（agent state 序列化到 `~/.pi-a/checkpoints/<id>.json`），支持 resume
- `provider.prompt` 完成后自动写 checkpoint；启动时扫描未完成会话（status=running）提示用户是否 resume

**5. 关键代码 / 接口**
```ts
// provider.ts ensureSession 改造
private ensureSession(sessionId: string): SessionEntry {
  // ... 现有
  const history = getMessages(sessionId);
  const handle = createWorkBuddyAgent(emit, { ... });
  if (history.length > 0) {
    // load 语义：重建 messages
    handle.agent.state.messages = history.map(rebuildMsg);
  }
  // resume：若 status=running 且有 checkpoint，恢复运行态
  const ckpt = loadCheckpoint(sessionId);
  if (ckpt?.running) { handle.agent.state = { ...handle.agent.state, ...ckpt.state }; }
}

// checkpoint.ts
export function saveCheckpoint(sessionId: string, state: any): void {
  Deno.writeTextFile(`${CKPT_DIR}/${sessionId}.json`, JSON.stringify({ state, running: provider.isRunning(sessionId), ts: Date.now() }));
}
```

**6. 前端 UI 变化**
- 会话列表 status=running 的会话显示"未完成"标记，点击时弹"恢复运行 / 仅查看"选择
- 应用启动时若有未完成会话，顶栏提示条

**7. 测试方法**
- 对话进行中强制退出应用，重启后该会话标记未完成，选"恢复"能继续（agent 记得上下文）
- 长会话（20 轮）load 后 agent 上下文完整

---

## 功能 16 · ACP 协议化 + Sidecar 拆分

**1. 描述**
当前 pi agent 在 Deno 主进程内直接跑（`LocalPiProvider`）。拆为独立 sidecar 进程（崩溃隔离、独立升级、可被其他客户端复用），主进程通过 ACP 协议通信。

**2. 对标 WorkBuddy**
子系统 ②（ACP 协议 12 方法）+ ③（cbc sidecar：`ELECTRON_RUN_AS_NODE` + 双 socket + RingBuffer + 就绪探测）。Pi-a 借鉴架构，但 Deno 场景下用 `Deno.Command` spawn 子进程 + Unix socket。

**3. 优先级 / 难度**
P1 / 高（大重构）

**4. 实现方案**
- 新建 `src/sidecar/entry.ts`：sidecar 入口（独立 `deno run`），加载 pi + 监听 socket，实现 ACP 方法
- 新建 `src/agent/acp_protocol.ts`：ACP 方法定义（initialize/session.new/session.prompt/...）+ NDJSON 序列化
- 改 `src/agent/provider.ts`：新增 `SidecarPiProvider implements AgentProvider`（spawn sidecar + socket 通信），保留 `LocalPiProvider` 作降级
- `main.ts`：启动时 spawn sidecar（`detached:true`），stderr 环形缓冲
- 心跳 + 流清理（借鉴 WorkBuddy `heartbeatTimers`）

**5. 关键代码 / 接口**
```ts
// src/agent/acp_protocol.ts
export type AcpMethod =
  | "initialize" | "session/new" | "session/load" | "session/prompt"
  | "session/cancel" | "session/close";
export interface AcpRequest { jsonrpc:"2.0"; id:string; method:AcpMethod; params:any; }
export interface AcpResponse { jsonrpc:"2.0"; id:string; result?:any; error?:{code:number;message:string}; }
// NDJSON over Unix socket

// src/agent/provider.ts
export class SidecarPiProvider implements AgentProvider {
  private proc?: Deno.ChildProcess;
  private sockPath = `${DATA_DIR}/pi-a.sock`;
  async start() {
    this.proc = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", "src/sidecar/entry.ts", "--sock", this.sockPath],
      stderr: "piped", stdout: "piped",
    }).spawn();
    await this.waitForSocket(this.sockPath);   // 就绪探测
    this.startHeartbeat();
  }
  async prompt(sessionId, text, opts) {
    await this.send({ method:"session/prompt", params:{ sessionId, text, ...opts } });
  }
  onEvent(sessionId, cb) { /* 订阅 NDJSON 流 */ }
}
```

**6. 前端 UI 变化**
设置面板"高级"区域显示"Agent 引擎：sidecar（运行中）/ 本地（降级）"+ 重启 sidecar 按钮。崩溃时自动降级到 LocalPiProvider 并提示。

**7. 测试方法**
- sidecar 进程被 kill，主进程检测到后自动重启 + 降级不中断用户对话
- 主进程退出时 sidecar（detached）正确清理或独立存活可被复用
- ACP session/prompt 流式事件经 socket 实时到达

---

## 功能 17 · 命令沙箱 + 文件操作快照

**1. 描述**
WorkBuddy 的 OS 级沙箱（子系统 ⑦）对 Pi-a 过重（P2），但可先做轻量版：bash 命令在受限工作目录执行（chroot 式或 cwd 限制）+ 所有文件改写前强制快照（部分已有，补全到 pi 的 write/edit/bash 改文件场景）。

**2. 对标 WorkBuddy**
子系统 ⑤（FileProjection + `snapshotFile`/`listFileCommits`/`revertFileCommit`）+ ⑦（bashSandboxManager.isSystemLevelTool）。

**3. 优先级 / 难度**
P1 / 中

**4. 实现方案**
- 复用 `src/domains/doc/node/editor.ts` 的 `createBackupVersion`，扩展为通用文件快照（不限 docx/xlsx）
- 新建 `src/infra/file_snapshot.ts`：任意文件改前快照（注册到 artifact_versions 或新表 `file_snapshots`）
- `src/agent/permissions.ts`：bash 工具执行前，若命令含文件写入（启发式检测 `>`/`tee`/`sed -i` 等），对受影响文件快照
- 工作目录限制：default 权限下 bash 的 cwd 限制在项目目录或 `~/Desktop`，跨目录写操作需确认

**5. 关键代码 / 接口**
```ts
// src/infra/file_snapshot.ts
export async function snapshotFile(path: string, sessionId?: string): Promise<number> {
  // 复用 createBackupVersion 逻辑，但写入 file_snapshots 表（含任意路径）
}
export function listFileSnapshots(path: string): Snapshot[];
export async function revertFileSnapshot(path: string, version: number): Promise<void>;

// permissions.ts checkToolPermission bash 分支增强
if (toolName === "bash") {
  const writes = detectFileWrites(args.command);   // 启发式
  for (const f of writes) await snapshotFile(resolveInCwd(f), sessionId);
}
```

**6. 前端 UI 变化**
- 工件/文件历史面板扩展为"文件快照"统一面板，按文件路径分组显示历史
- bash 命令执行确认弹窗显示"将修改 N 个文件，已自动快照"

**7. 测试方法**
- agent 用 `echo x > ~/Desktop/test.txt` 改文件，验证改前快照，可回滚
- default 权限下 bash 写到 `/etc/` 被拦截

---

## 功能 18 · RAG 向量召回（长文档精准检索）

**1. 描述**
当前"文档问答"靠整文件喂 LLM（`read_doc` 全量读），长文档超上下文窗口即失效。补齐本地向量检索：文档分块 → embedding → sqlite-vss 存储 → 检索相关块。

**2. 对标 WorkBuddy**
06 路线图 P1 "RAG 向量召回（sqlite-vss 或本地 embedding）"。WorkBuddy 走云端 embedding；Pi-a 本地优先。

**3. 优先级 / 难度**
P1 / 高

**4. 实现方案**
- 选型：embedding 用本地模型（`@xenova/transformers` 的 `all-MiniLM-L6-v2`，纯 JS 在 Deno 跑）或调支持 embedding 的 provider（DeepSeek/GLM）
- 存储：`sqlite-vss`（SQLite 扩展）或退化为纯 JS 余弦相似度（小规模够用）
- 新建 `src/domains/rag/node/store.ts`：文档索引 CRUD（`index_doc(path)` 分块 + embedding + 入库）
- 新建 `src/agent/tools/rag.ts`：`search_docs { query, path? }` 工具
- `src/agent/tools/index.ts`：Craft 工具集加 `search_docs`
- 文档问答技能（builtin）改用 `search_docs` 而非 `read_doc` 全量读

**5. 关键代码 / 接口**
```ts
// src/domains/rag/node/store.ts
export interface Chunk { id: string; docPath: string; text: string; embedding: number[]; index: number; }
export async function indexDoc(path: string): Promise<number> {
  const { text } = await readDoc(path);
  const chunks = splitText(text, 800, 100);   // 800 字符块，100 重叠
  const embeddings = await embed(chunks.map(c => c.text));
  // 入库 sqlite-vss 或 JS 索引
  return chunks.length;
}
export async function searchChunks(query: string, docPath?: string, topK = 5): Promise<Chunk[]> {
  const qEmb = await embed([query])[0];
  return cosineTopK(qEmb, docPath);   // sqlite-vss 或内存
}

// src/agent/tools/rag.ts
export const searchDocsTool: AgentTool = {
  name: "search_docs",
  parameters: Type.Object({ query: Type.String(), path: Type.Optional(Type.String()) }),
  execute: async (_id, p) => {
    const chunks = await searchChunks(p.query, p.path);
    return { content: [{ type:"text", text: chunks.map((c,i)=>`[${i+1}] ${c.text}`).join("\n\n") }] };
  },
};
```

**6. 前端 UI 变化**
- 工件/文件预览面板加"建立索引"按钮（首次问答长文档时提示）
- 文档问答回答中标注引用的 chunk 编号

**7. 测试方法**
- 索引一个 50 页 PDF，问其中某细节，验证召回相关块（非全量塞）
- 索引耗时与内存监控（防 embedding 模型爆内存）

---

# 第三部分 · P2 远期与工程化

## 功能 19 · 桌面集成（托盘 + 全局菜单 + 单例 + Deep Link）

**1. 描述**
系统托盘图标（常驻 + 右键菜单）、单例锁（防多开）、Deep Link（`pi-a://` 唤起）。

**2. 对标 WorkBuddy**
子系统 ①（Tray 60 处 + requestSingleInstanceLock + setAsDefaultProtocolClient + second-instance）。

**3. 优先级 / 难度**
P2 / 中（依赖 Deno Desktop API 成熟度）

**4. 实现方案**
- spike `Deno.Tray` / `Deno.Dock` API 是否可用（main.ts 已用 `Deno.Dock` 监听 reopen，第 478 行）
- 单例：文件锁 `~/.pi-a/.lock`（PID 写入，启动检测）
- Deep Link：注册 `pi-a://` scheme（`Info.plist` CFBundleURLTypes），`open-url` 事件解析

**5-7** （略，按 ① 对标实现，重点是托盘菜单含"新建对话/速唤/退出"，Deep Link 支持 `pi-a://new?text=...`）

---

## 功能 20 · 自动更新

**1. 描述**
应用自检更新、下载、安装。

**2. 对标 WorkBuddy**
子系统 ①（`electron-updater` 全套，源 `copilot.tencent.com`）。Pi-a 用 GitHub Releases 作为更新源。

**3. 优先级 / 难度**
P2 / 中

**4. 实现方案**
- 新建 `src/infra/updater.ts`：轮询 GitHub Releases API 比对版本号，下载 `.dmg`/`.app`，提示用户手动安装（macOS 不能静默替换运行中 app）
- 或接 `deno desktop` 的原生更新 API（若提供）

**5-7** （略）

---

## 功能 21 · 多 Agent 编排（Agent Teams + Handoff）

**1. 描述**
orchestrator agent 管理多个 subagent（如"研究员"负责联网、"文档作者"负责出 docx），通过 handoff 交接。

**2. 对标 WorkBuddy**
子系统 ⑫（Agent Teams + @openai/agents 的 `handoff` API + `delegateTo`）。Pi-a 用 pi 自带的 `orchestrator`（experimental 包）。

**3. 优先级 / 难度**
P2 / 高

**4. 实现方案**
- 引入 `@earendil-works/pi-orchestrator`（experimental）
- `src/agent/engine.ts`：新建 `createOrchestratorAgent`，定义 subagent（每个有自己的工具子集 + systemPrompt）
- MCP server 包成 subagent（对标 WorkBuddy "MCP = subagent"）

**5-7** （略，落地前补详细设计，按 06 文档 §六 要求）

---

## 功能 22 · 可观测性（日志 + 审计面板 + token 用量）

**1. 描述**
结构化日志 + 工具调用审计可视化 + token/成本统计。

**2. 对标 WorkBuddy**
全局工程实践 A（OpenTelemetry 全链路 + Aegis + `usage_update` token 推送）。

**3. 优先级 / 难度**
P2 / 低-中

**4. 实现方案**
- 复用 `tool_audit_log` 表（已有，db.ts 第 36 行），新增 `GET /api/audit` 查询接口
- 新建 `src/infra/usage.ts`：从 agent event 累计 token 用量，按会话/模型/天统计
- 前端设置面板新增"审计日志"tab + "用量统计"图表

**5-7** （略）

---

## 功能 23 · Windows 平台移植

**1. 描述**
当前仅 macOS（多处 `osascript`/`screencapture`/`cliclick`）。补齐 Windows。

**2. 对标 WorkBuddy**
子系统 ③（Windows 放弃 node-pty 用纯管道）+ 全局 D（跨平台：socket→Named Pipe、路径 sun_path 限制）。

**3. 优先级 / 难度**
P2 / 中

**4. 实现方案**
- 抽象 OS 能力层（`src/infra/os/<platform>.ts`）：截图/热键/打开文件/app focus 按平台分流
- Windows 截图用 `PowerShell + .NET`，热键用 Win32 API
- socket 路径用 Named Pipe

**5-7** （略）

---

# 附录 A · 优先级与依赖总表

| # | 功能 | 优先级 | 难度 | 依赖 | 对标子系统 |
|---|------|:---:|:---:|------|:---:|
| 1 | 对话导出 | P0 | 低 | — | ②⑩ |
| 2 | 项目实体 | P0 | 中 | — | ⑩ |
| 3 | 专家模式 | P0 | 中 | — | ⑫ |
| 4 | PDF 读取 | P0 | 中 | — | ⑤ |
| 5 | SSE 事件推送 | P0 | 中 | — | ② |
| 6 | 会话分叉 | P1 | 中 | — | ②⑩ |
| 7 | 工作记忆分层 | P1 | 中 | — | ⑨ |
| 8 | 自动化系统 | P1 | 高 | 2（项目） | ⑬ |
| 9 | 速唤浮窗 | P1 | 高 | — | ① |
| 10 | 技能编辑器 | P1 | 中 | — | ⑧ |
| 11 | docx/pptx 编辑 | P1 | 高 | — | ⑤⑪ |
| 12 | PDF 导出 | P1 | 中 | — | ⑪ |
| 13 | Computer Use | P1 | 高 | 14（权限） | ⑤ |
| 14 | 权限三层 | P1 | 中 | — | ⑤④ |
| 15 | 会话恢复 | P1 | 中 | — | ②⑩ |
| 16 | ACP+Sidecar | P1 | 高 | — | ②③ |
| 17 | 文件快照沙箱 | P1 | 中 | — | ⑤⑦ |
| 18 | RAG 向量召回 | P1 | 高 | 4（PDF） | — |
| 19 | 桌面集成 | P2 | 中 | — | ① |
| 20 | 自动更新 | P2 | 中 | 19 | ① |
| 21 | 多 Agent 编排 | P2 | 高 | — | ⑫ |
| 22 | 可观测性 | P2 | 低-中 | — | 工程实践 |
| 23 | Windows 移植 | P2 | 中 | — | ③ |

## 附录 B · 建议执行顺序（单人/小团队）

1. **Sprint 1（P0 价值闭环）**：功能 5（SSE）→ 1（导出）→ 4（PDF 读）→ 2（项目）→ 3（专家）
2. **Sprint 2（差异化能力）**：功能 14（权限三层）→ 7（记忆分层）→ 6（分叉）→ 10（技能编辑器）
3. **Sprint 3（自动化与控制）**：功能 8（自动化）→ 9（速唤）→ 13（Computer Use）→ 17（文件快照）
4. **Sprint 4（深度与工程化）**：功能 11（docx/pptx 编辑）→ 12（PDF 导出）→ 18（RAG）→ 15（会话恢复）
5. **Sprint 5（架构升级）**：功能 16（Sidecar）→ 22（可观测性）→ 19/20/21/23

## 附录 C · 文件改动地图（新建/改动一览）

**新建文件：**
- `src/domains/project/node/store.ts`（功能 2）
- `src/domains/expert/node/store.ts`（功能 3）
- `src/domains/automation/node/store.ts` `scheduler.ts` `triggers.ts`（功能 8）
- `src/domains/skill/node/store.ts`（功能 10）
- `src/domains/rag/node/store.ts`（功能 18）
- `src/domains/session/node/checkpoint.ts`（功能 15）
- `src/agent/tools/os.ts`（功能 13）
- `src/agent/tools/rag.ts`（功能 18）
- `src/infra/file_snapshot.ts`（功能 17）
- `src/infra/usage.ts`（功能 22）
- `src/infra/updater.ts`（功能 20）
- `src/sidecar/entry.ts`（功能 16）
- `src/agent/acp_protocol.ts`（功能 16）

**主要改动文件：**
- `main.ts`：每个功能基本都要加路由（API 总入口）
- `src/infra/db.ts`：新增表（projects/experts/automations/automation_runs/file_snapshots 等）
- `src/agent/engine.ts`：记忆分层（7）、专家配置（3）、项目 cwd（2）
- `src/agent/provider.ts`：SSE（5）、PermLevel 三层（14）、ensureSession 重放（6/15）、SidecarProvider（16）
- `src/agent/permissions.ts`：三层模型（14）、文件快照钩子（17）
- `src/agent/tools/index.ts`：os 工具（13）、rag 工具（18）、edit_pptx（11）
- `src/agent/tools/doc.ts`：edit_docx 扩展、edit_pptx（11）
- `src/domains/doc/node/reader.ts`：PDF（4）
- `src/domains/doc/node/editor.ts`：docx/pptx 自由编辑（11）
- `src/domains/memory/node/store.ts`：分层 + 缓存（7）
- `renderer/index.html`：每个有 UI 变化的功能都要改（导出按钮/项目视图/专家卡片/自动化列表/技能编辑器/浮窗/权限三选项/审计面板等）

---

## 文档导航

- [README · 总览](./README.md)
- [02 · WorkBuddy 完整拆解](./02-WorkBuddy完整拆解.md)
- [06 · MVP 与路线图](./06-MVP与路线图.md)
- **08 · 对标 WorkBuddy 开发计划**（本文）

> 本计划为活文档，每项落地后回填实际实现细节与踩坑记录。
