// main.ts — Pi-a 入口
// 对照 03 文档：Deno.serve + Deno.BrowserWindow + win.bind in-process bindings
// 装配：provider + 事件队列 + 前端 bindings
// renderer HTML 内嵌为字符串模块，避免打包后路径问题

// 加载 .env（API key 等本地配置）
// 多路径尝试：开发环境 cwd + 用户主目录
for (const envPath of [".env", `${Deno.env.get("HOME")}/.pi-a/.env`, `${Deno.env.get("HOME")}/.pi-a-env`]) {
  try {
    const envText = await Deno.readTextFile(envPath);
    for (const line of envText.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !Deno.env.get(m[1])) Deno.env.set(m[1], m[2].trim());
    }
    console.log("[main] 已加载", envPath);
    break;
  } catch { /* 试下一个 */ }
}
console.log("[main] DEEPSEEK_API_KEY:", Deno.env.get("DEEPSEEK_API_KEY") ? "已设置(" + Deno.env.get("DEEPSEEK_API_KEY")!.slice(0,8) + "...)" : "未设置");

import { RENDERER_HTML } from "./src/ui/renderer.ts";
import { initDb } from "./src/infra/db.ts";
import { initModels, listModels, listAllProviders, registerProvider, listAvailableProviders } from "./src/agent/models.ts";
import { provider, type AgentEvent } from "./src/agent/provider.ts";
import { setConfirmHandler, clearConfirmHandler, resetComputerUseCount } from "./src/agent/permissions.ts";
import { ensureSkillsDir } from "./src/agent/skills.ts";
import { startScheduler } from "./src/domains/automation/node/scheduler.ts";
import { ensureMcpConfig, connectAllMcpServers } from "./src/agent/mcp.ts";
import { setMcpTools } from "./src/agent/tools/index.ts";
import {
  createConversation, listConversations, renameConversation,
  moveConversation, deleteConversation, appendMessage, getMessages,
} from "./src/domains/session/node/store.ts";
import { listArtifacts, deleteArtifact } from "./src/domains/artifact/node/store.ts";
import { createProject, listProjects, getProject, updateProject, deleteProject, assignConversationToProject, listProjectConversations } from "./src/domains/project/node/store.ts";
import { BUILTIN_EXPERTS, getExpert } from "./src/agent/experts.ts";
import { getApiKey } from "./src/infra/keychain.ts";

initDb();
initModels();
ensureSkillsDir();
ensureMcpConfig();
startScheduler();

// 启动时自动注册所有已经配置了 API Key 的 Provider
(async () => {
  try {
    const providers = listAvailableProviders();
    for (const p of providers) {
      const k = await getApiKey(p);
      if (k) {
        await registerProvider(p);
      }
    }
  } catch (e) {
    console.warn("[main] 启动时动态注册 Provider 失败:", (e as Error).message);
  }
})();

// 启动时连接 MCP server（异步，不阻塞主流程）
(async () => {
  try {
    const tools = await connectAllMcpServers();
    if (tools.length > 0) {
      setMcpTools(tools);
      console.log(`[main] MCP 工具已加载: ${tools.length} 个`);
    }
  } catch (e) {
    console.warn("[main] MCP 连接失败:", (e as Error).message);
  }
})();

console.log("[main] 可用 DeepSeek 模型:", listModels("deepseek").map((m: any) => m.id));

// ===== 事件队列：每会话一个，前端轮询拉取 =====
// MVP 用轮询模型（最简）；P1 研究 deno desktop 的事件主动推送 API
const eventQueues = new Map<string, AgentEvent[]>();

function getQueue(sessionId: string): AgentEvent[] {
  let q = eventQueues.get(sessionId);
  if (!q) {
    q = [];
    eventQueues.set(sessionId, q);
    // 订阅该会话的 provider 事件 → 入队
    provider.onEvent(sessionId, (event) => {
      q!.push(event);
      console.log("[queue] 事件入队:", sessionId.slice(0,8), event.type, "队列长度:", q!.length);
      // 限制队列长度，防止前端长时间不拉取导致内存膨胀
      if (q!.length > 500) q!.shift();
    });
    console.log("[queue] 为会话", sessionId.slice(0,8), "创建队列并订阅事件");
  }
  return q;
}

// ===== HTTP serve + API =====
// 绕过 deno desktop 的 win.bind（两套桥接系统冲突），
// 改用标准 HTTP API 做 webview↔后端通信（100% 可靠）

// 确认请求挂起表（API /api/confirm 用）
const pendingConfirms = new Map<string, (approved: boolean) => void>();

export async function handleApi(req: Request, path: string): Promise<Response> {
  const json = (s: unknown) => new Response(JSON.stringify(s), { headers: { "content-type": "application/json" } });
  try {
    // GET /api/conv?category=&search=
    if (path === "/api/conv" && req.method === "GET") {
      const u = new URL(req.url);
      return json(listConversations(
        u.searchParams.get("category") || undefined,
        u.searchParams.get("search") || undefined,
        u.searchParams.get("status") || undefined,
      ));
    }
    // POST /api/conv  { title, category }
    if (path === "/api/conv" && req.method === "POST") {
      const b = await req.json();
      const conv = createConversation(b.title, b.category);
      return json(conv);
    }
    // DELETE /api/conv/:id
    if (path.startsWith("/api/conv/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      deleteConversation(id);
      clearConfirmHandler(id);
      provider.dispose(id);
      return json({ ok: true });
    }
    // GET /api/msgs/:id
    if (path.startsWith("/api/msgs/") && req.method === "GET") {
      const id = path.split("/")[3];
      return json(getMessages(id));
    }
    // GET /api/mention/suggestions?q=xxx — 获取输入框 @ 联动推荐项
    if (path === "/api/mention/suggestions" && req.method === "GET") {
      const q = new URL(req.url).searchParams.get("q") || "";
      const { getSetting } = await import("./src/domains/settings/node/store.ts");
      const { recallMemories } = await import("./src/domains/memory/node/store.ts");
      const docsDirRaw = getSetting("docs_dir", "~/Desktop");
      const docsDir = docsDirRaw.startsWith("~/") ? (Deno.env.get("HOME") || "") + docsDirRaw.slice(1) : docsDirRaw;

      // 1. 读取配置文件夹下的候选文件
      const files: Array<{ name: string; path: string; type: "file" }> = [];
      try {
        for await (const entry of Deno.readDir(docsDir)) {
          if (entry.isFile) {
            const ext = entry.name.split(".").pop()?.toLowerCase() || "";
            if (["docx", "xlsx", "pptx", "csv", "txt", "md", "json"].includes(ext)) {
              if (!q || entry.name.toLowerCase().includes(q.toLowerCase())) {
                files.push({ name: entry.name, path: `${docsDir}/${entry.name}`, type: "file" });
              }
            }
          }
        }
      } catch (e) {
        console.warn("[main] 获取 suggestions 读取 docs_dir 失败:", e);
      }

      // 2. 读取记忆
      const memories = recallMemories()
        .filter((m: any) => !q || m.content.toLowerCase().includes(q.toLowerCase()))
        .map((m: any) => ({ name: `🧠 记忆: ${m.content.slice(0, 30)}`, content: m.content, type: "memory" }));

      // 3. 内置技能
      const builtInSkills = [
        { name: "📊 周报生成", q: "周报生成", type: "skill" },
        { name: "📈 数据分析出表", q: "数据分析出表", type: "skill" },
        { name: "🎨 PPT 制作", q: "PPT 制作", type: "skill" },
        { name: "📝 文档润色", q: "文档润色", type: "skill" },
        { name: "🔍 文档问答", q: "文档问答", type: "skill" },
      ].filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));

      return json({
        files: files.slice(0, 10),
        memories: memories.slice(0, 5),
        skills: builtInSkills.slice(0, 5)
      });
    }
    // POST /api/prompt  { sessionId, text, mode, permission }
    if (path === "/api/prompt" && req.method === "POST") {
      const b = await req.json();
      console.log("[api] /api/prompt session:", b.sessionId?.slice(0,8), "mode:", b.mode);
      // 确保 queue 已订阅（在 prompt 之前）
      getQueue(b.sessionId);
      // 新 prompt = 新任务，重置 Computer Use 步数计数
      resetComputerUseCount(b.sessionId);
      appendMessage(b.sessionId, "user", b.text);
      setConfirmHandler(b.sessionId, async (toolName: string, args: unknown) => {
        const requestId = crypto.randomUUID();
        // 通过 provider 广播 tool_confirmation 事件，走 listeners 通路：
        // SSE（onEvent 订阅）和 getQueue（onEvent → push queue）都能实时收到。
        // ⚠️ 不能只 push queue：SSE 连接建立后只订阅 onEvent，不再 splice queue，
        //    会导致确认框首次不显示、切 chat 重连后才吐出的 bug。
        provider.emitEvent(b.sessionId, { type: "tool_confirmation" as any, requestId, toolName, args, sessionId: b.sessionId } as any);
        return await new Promise<boolean>((resolve) => {
          pendingConfirms.set(requestId, resolve);
          setTimeout(() => { if (pendingConfirms.has(requestId)) { pendingConfirms.delete(requestId); resolve(false); } }, 120000);
        });
      });

      // ===== 解析 @引用 文件内容 =====
      let processedText = b.text || "";
      const mentionRegex = /@([a-zA-Z0-9_\-\.\u4e00-\u9fa5]+\.[a-zA-Z0-9]+)/g;
      let match;
      const fileRefs = new Set<string>();
      while ((match = mentionRegex.exec(b.text || "")) !== null) {
        fileRefs.add(match[1]);
      }

      if (fileRefs.size > 0) {
        const { getSetting } = await import("./src/domains/settings/node/store.ts");
        const { readDoc } = await import("./src/domains/doc/node/reader.ts");
        const docsDirRaw = getSetting("docs_dir", "~/Desktop");
        const docsDir = docsDirRaw.startsWith("~/") ? (Deno.env.get("HOME") || "") + docsDirRaw.slice(1) : docsDirRaw;
        
        let fileContext = "";
        for (const filename of fileRefs) {
          const filePath = `${docsDir}/${filename}`;
          try {
            const stat = await Deno.stat(filePath);
            if (stat.isFile) {
              const readResult = await readDoc(filePath);
              fileContext += `\n<referenced_file name="${filename}" path="${filePath}">\n${readResult.text}\n</referenced_file>\n`;
              console.log(`[main] 自动加载 @引用 文件: ${filePath} (${readResult.text.length} 字符)`);
            }
          } catch (e) {
            // 兜底：如果找不到，尝试在当前工作目录或绝对路径寻找
            try {
              const stat = await Deno.stat(filename);
              if (stat.isFile) {
                const readResult = await readDoc(filename);
                fileContext += `\n<referenced_file name="${filename}" path="${filename}">\n${readResult.text}\n</referenced_file>\n`;
                console.log(`[main] 自动加载 @引用 绝对路径文件: ${filename} (${readResult.text.length} 字符)`);
              }
            } catch {
              console.warn(`[main] @引用 文件读取失败: ${filename}`, (e as Error).message);
            }
          }
        }
        if (fileContext) {
          processedText = `${fileContext}\n${processedText}`;
        }
      }

      provider.prompt(b.sessionId, processedText, { mode: b.mode || "craft", permission: b.permission || "default" });
      return json({ ok: true });
    }
    // POST /api/abort  { sessionId }
    if (path === "/api/abort" && req.method === "POST") {
      const b = await req.json();
      provider.abort(b.sessionId);
      return json({ ok: true });
    }
    // GET /api/events/:id — 轮询（保留向后兼容，SSE 不可用时兜底）
    if (path.startsWith("/api/events/") && !path.includes("/stream") && req.method === "GET") {
      const id = path.split("/")[3];
      const q = getQueue(id);
      // 过滤已 resolved（用户已响应/超时）的确认请求，避免切 chat 重连后重复弹已处理的确认框
      const events = q.splice(0, q.length).filter((ev: any) => !(ev.type === "tool_confirmation" && !pendingConfirms.has(ev.requestId)));
      for (const ev of events) {
        if (ev.type === "message_end" && (ev as any).message?.role === "assistant") {
          const text = ((ev as any).message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (text) appendMessage(id, "assistant", text);
        } else if (ev.type === "tool_execution_end") {
          appendMessage(id, "tool", `${(ev as any).toolName} ${(ev as any).isError ? "✗" : "✓"}`, { toolName: (ev as any).toolName, isError: (ev as any).isError });
        }
      }
      return json(events);
    }
    // GET /api/events/:id/stream — SSE 实时推送
    if (path.startsWith("/api/events/") && path.endsWith("/stream") && req.method === "GET") {
      const id = path.split("/")[3];
      getQueue(id); // 确保队列已订阅

      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          // 发送已有事件（队列里积攒的）
          const q = getQueue(id);
          // 过滤已 resolved（用户已响应/超时）的确认请求，避免切 chat 重连后重复弹已处理的确认框
          const pending = q.splice(0, q.length).filter((ev: any) => !(ev.type === "tool_confirmation" && !pendingConfirms.has(ev.requestId)));
          for (const ev of pending) {
            if (ev.type === "message_end" && (ev as any).message?.role === "assistant") {
              const text = ((ev as any).message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
              if (text) appendMessage(id, "assistant", text);
            } else if (ev.type === "tool_execution_end") {
              appendMessage(id, "tool", `${(ev as any).toolName} ${(ev as any).isError ? "✗" : "✓"}`, { toolName: (ev as any).toolName, isError: (ev as any).isError });
            }
            send(ev);
          }

          // 订阅新事件（onEvent 是异步的，先注册回调）
          let unsub: (() => void) | null = null;
          provider.onEvent(id, (event) => {
            if (event.type === "message_end" && (event as any).message?.role === "assistant") {
              const text = ((event as any).message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
              if (text) appendMessage(id, "assistant", text);
            } else if (event.type === "tool_execution_end") {
              appendMessage(id, "tool", `${(event as any).toolName} ${(event as any).isError ? "✗" : "✓"}`, { toolName: (event as any).toolName, isError: (event as any).isError });
            }
            send(event);
          }).then((fn) => { unsub = fn; });

          // 心跳（每 30 秒发 ping，保持连接）
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch {}
          }, 30000);

          // 清理
          req.signal.addEventListener("abort", () => {
            clearInterval(heartbeat);
            if (unsub) unsub();
            try { controller.close(); } catch {}
          });
        },
      });

      return new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        },
      });
    }
    // POST /api/confirm  { requestId, approved }
    if (path === "/api/confirm" && req.method === "POST") {
      const b = await req.json();
      const resolve = pendingConfirms.get(b.requestId);
      if (resolve) { pendingConfirms.delete(b.requestId); resolve(b.approved); }
      return json({ ok: true });
    }
    // GET /api/artifacts — 列出所有工件
    if (path === "/api/artifacts" && req.method === "GET") {
      return json(listArtifacts());
    }
    // DELETE /api/artifacts/:id — 删除工件记录
    if (path.startsWith("/api/artifacts/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      deleteArtifact(id);
      return json({ ok: true });
    }
    // GET /api/file?path=xxx — 读取文件内容（工件预览用）
    if (path === "/api/file" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      try {
        const data = await Deno.readFile(filePath);
        return new Response(data, { headers: { "content-type": "application/octet-stream" } });
      } catch {
        return new Response("文件不存在", { status: 404 });
      }
    }
    // GET /api/open?path=xxx — 在系统默认应用打开文件
    if (path === "/api/open" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      const cmd = new Deno.Command("open", { args: [filePath] });
      await cmd.output();
      return json({ ok: true });
    }
    // GET /api/settings — 获取全局设置
    if (path === "/api/settings" && req.method === "GET") {
      const { getSetting } = await import("./src/domains/settings/node/store.ts");
      const { listAllProviders, listAvailableProviders } = await import("./src/agent/models.ts");
      const defaultProvider = getSetting("default_provider", "deepseek");
      const defaultModelId = getSetting("default_model_id", "deepseek-v4-flash");
      const docsDir = getSetting("docs_dir", "~/Desktop");
      return json({
        defaultProvider,
        defaultModelId,
        docsDir,
        providers: listAllProviders(),
        availableProviders: listAvailableProviders(),
      });
    }
    // POST /api/settings — 保存全局设置
    if (path === "/api/settings" && req.method === "POST") {
      const b = await req.json();
      const { setSetting } = await import("./src/domains/settings/node/store.ts");
      if (b.defaultProvider) setSetting("default_provider", b.defaultProvider);
      if (b.defaultModelId) setSetting("default_model_id", b.defaultModelId);
      if (b.docsDir) setSetting("docs_dir", b.docsDir);
      return json({ ok: true });
    }
    // GET /api/settings/keys — 获取已存 API Keys 的 Provider 状态
    if (path === "/api/settings/keys" && req.method === "GET") {
      const { getApiKey } = await import("./src/infra/keychain.ts");
      const { listAvailableProviders } = await import("./src/agent/models.ts");
      const providers = listAvailableProviders();
      const result: Record<string, boolean> = {};
      for (const p of providers) {
        const k = await getApiKey(p);
        result[p] = !!k;
      }
      return json(result);
    }
    // POST /api/settings/keys — 安全存储 API Key
    if (path === "/api/settings/keys" && req.method === "POST") {
      const b = await req.json();
      const { setApiKey } = await import("./src/infra/keychain.ts");
      const { registerProvider } = await import("./src/agent/models.ts");
      await setApiKey(b.provider, b.key);
      await registerProvider(b.provider);
      return json({ ok: true });
    }
    // DELETE /api/settings/keys/:provider — 删除钥匙串里的 Key
    if (path.startsWith("/api/settings/keys/") && req.method === "DELETE") {
      const providerId = path.split("/")[4];
      const { deleteApiKey } = await import("./src/infra/keychain.ts");
      await deleteApiKey(providerId);
      return json({ ok: true });
    }
    // GET /api/memories — 获取全部记忆（含 working + user，面板用）
    if (path === "/api/memories" && req.method === "GET") {
      const { listAllMemories } = await import("./src/domains/memory/node/store.ts");
      return json(listAllMemories());
    }
    // POST /api/memories — 新增长期记忆
    if (path === "/api/memories" && req.method === "POST") {
      const b = await req.json();
      const { writeMemory } = await import("./src/domains/memory/node/store.ts");
      const mem = writeMemory(b.content, b.kind || "fact", b.scope || "user");
      return json(mem);
    }
    // DELETE /api/memories/:id — 删除长期记忆
    if (path.startsWith("/api/memories/") && req.method === "DELETE") {
      const id = path.split("/")[3];
      const { deleteMemory } = await import("./src/domains/memory/node/store.ts");
      deleteMemory(id);
      return json({ ok: true });
    }
    // ===== 技能 API（技能编辑器） =====
    // GET /api/skills — 列出所有技能
    if (path === "/api/skills" && req.method === "GET") {
      const { listSkills } = await import("./src/domains/skill/node/store.ts");
      return json(await listSkills());
    }
    // POST /api/skills — 新建技能 { name, description, body }
    if (path === "/api/skills" && req.method === "POST") {
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(b.name, b.description || "", b.body || "");
        return json(skill);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // PUT /api/skills/:name — 编辑技能 { description, body }
    if (path.match(/^\/api\/skills\/[^/]+$/) && req.method === "PUT") {
      const name = path.split("/")[3];
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(name, b.description || "", b.body || "");
        return json(skill);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // DELETE /api/skills/:name — 删除技能（内置不可删）
    if (path.match(/^\/api\/skills\/[^/]+$/) && req.method === "DELETE") {
      const name = path.split("/")[3];
      const { deleteSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        await deleteSkill(name);
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // ===== 自动化 API（功能8） =====
    // GET /api/automations — 列出所有自动化
    if (path === "/api/automations" && req.method === "GET") {
      const { listAutomations } = await import("./src/domains/automation/node/store.ts");
      return json(listAutomations());
    }
    // POST /api/automations — 新建 { name, triggerType, triggerConfig, actionType, actionConfig }
    if (path === "/api/automations" && req.method === "POST") {
      const b = await req.json();
      const { createAutomation, updateAutomation, getAutomation } = await import("./src/domains/automation/node/store.ts");
      const { nextCronTime } = await import("./src/domains/automation/node/scheduler.ts");
      const a = createAutomation(b);
      if (a.triggerType === "cron" && a.triggerConfig.cron) {
        const nt = nextCronTime(a.triggerConfig.cron, new Date());
        if (nt) updateAutomation(a.id, { nextRun: nt.getTime() });
      }
      return json(getAutomation(a.id));
    }
    // PUT /api/automations/:id — 更新（name/enabled/trigger/action 等）
    if (path.match(/^\/api\/automations\/[^/]+$/) && !path.endsWith("/runs") && !path.endsWith("/run") && req.method === "PUT") {
      const id = path.split("/")[3];
      const b = await req.json();
      const { updateAutomation, getAutomation } = await import("./src/domains/automation/node/store.ts");
      const { nextCronTime } = await import("./src/domains/automation/node/scheduler.ts");
      updateAutomation(id, b);
      // 更新后重算 next_run
      const a = getAutomation(id);
      if (a && a.enabled && a.triggerType === "cron" && a.triggerConfig.cron) {
        const nt = nextCronTime(a.triggerConfig.cron, new Date());
        updateAutomation(id, { nextRun: nt ? nt.getTime() : null });
      } else if (a && (!a.enabled || a.triggerType !== "cron")) {
        updateAutomation(id, { nextRun: null });
      }
      return json(getAutomation(id));
    }
    // DELETE /api/automations/:id
    if (path.match(/^\/api\/automations\/[^/]+$/) && !path.endsWith("/runs") && !path.endsWith("/run") && req.method === "DELETE") {
      const id = path.split("/")[3];
      const { deleteAutomation } = await import("./src/domains/automation/node/store.ts");
      deleteAutomation(id);
      return json({ ok: true });
    }
    // GET /api/automations/:id/runs — 运行记录
    if (path.match(/^\/api\/automations\/[^/]+\/runs$/) && req.method === "GET") {
      const id = path.split("/")[3];
      const { listRuns } = await import("./src/domains/automation/node/store.ts");
      return json(listRuns(id));
    }
    // POST /api/automations/:id/run — 手动触发一次
    if (path.match(/^\/api\/automations\/[^/]+\/run$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const { getAutomation, createRun, finishRun } = await import("./src/domains/automation/node/store.ts");
      const a = getAutomation(id);
      if (!a) return json({ error: "自动化不存在" });
      const prompt = a.actionType === "skill"
        ? `【执行技能】${a.actionConfig.skill || ""}`
        : (a.actionConfig.prompt || "");
      const conv = createConversation(`[自动] ${a.name}`, "automation");
      const run = createRun(a.id, conv.id);
      (async () => {
        try {
          await provider.prompt(conv.id, prompt, { mode: "craft", permission: "default" });
          finishRun(run.id, "completed", "手动触发已执行");
        } catch (e) {
          finishRun(run.id, "failed", (e as Error).message);
        }
      })();
      return json({ ok: true, runId: run.id, sessionId: conv.id });
    }
    // ===== 文件快照 API（功能17） =====
    // GET /api/file-snapshots?path= — 列出文件快照（有 path 列某文件快照，无 path 列所有文件）
    if (path === "/api/file-snapshots" && req.method === "GET") {
      const fp = new URL(req.url).searchParams.get("path");
      const { listFileSnapshots, listSnapshottedFiles } = await import("./src/infra/file_snapshot.ts");
      return json(fp ? listFileSnapshots(fp) : listSnapshottedFiles());
    }
    // POST /api/file-snapshots/:id/revert — 回滚到某快照
    if (path.match(/^\/api\/file-snapshots\/[^/]+\/revert$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const { revertFileSnapshot } = await import("./src/infra/file_snapshot.ts");
      try {
        await revertFileSnapshot(id);
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // GET /api/artifacts/:id/versions — 列出版本历史
    if (path.startsWith("/api/artifacts/") && path.endsWith("/versions") && req.method === "GET") {
      const id = path.split("/")[3];
      const { listArtifactVersions } = await import("./src/domains/artifact/node/store.ts");
      return json(listArtifactVersions(id));
    }
    // POST /api/artifacts/:id/restore — 还原版本
    if (path.startsWith("/api/artifacts/") && path.endsWith("/restore") && req.method === "POST") {
      const id = path.split("/")[3];
      const b = await req.json();
      const { restoreArtifactVersion } = await import("./src/domains/artifact/node/store.ts");
      await restoreArtifactVersion(id, b.version);
      return json({ ok: true });
    }
    // POST /api/export-pdf { path } — 导出文档为 PDF（用 soffice/LibreOffice，对照 08 计划功能12）
    if (path === "/api/export-pdf" && req.method === "POST") {
      const b = await req.json();
      const srcPath = b.path?.startsWith("~/") ? (Deno.env.get("HOME") || "") + b.path.slice(1) : b.path;
      if (!srcPath) return json({ error: "缺少 path" });
      try { await Deno.stat(srcPath); } catch { return json({ error: "文件不存在" }); }
      // 检测 soffice
      const soffice = await (async () => {
        const candidates = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/opt/homebrew/bin/soffice"];
        for (const c of candidates) {
          try { await Deno.stat(c); return c; } catch {}
        }
        return null;
      })();
      if (!soffice) {
        return json({ error: "未检测到 LibreOffice/soffice，请安装：brew install --cask libreoffice" });
      }
      const outDir = srcPath.split("/").slice(0, -1).join("/") || ".";
      try {
        const cmd = new Deno.Command(soffice, {
          args: ["--headless", "--convert-to", "pdf", "--outdir", outDir, srcPath],
          stdout: "piped", stderr: "piped",
          signal: AbortSignal.timeout(60_000), // 60 秒超时，防止 soffice 卡死
        });
        const r = await cmd.output();
        if (r.code !== 0) {
          const stderr = new TextDecoder().decode(r.stderr);
          return json({ error: `转换失败：${stderr}` });
        }
        const pdfPath = srcPath.replace(/\.(docx|xlsx|pptx|doc|xls|ppt)$/i, ".pdf");
        // 校验输出文件确实生成
        const stat = await Deno.stat(pdfPath).catch(() => null);
        if (!stat || !stat.isFile) {
          return json({ error: "转换未生成输出文件，可能 LibreOffice 版本不兼容" });
        }
        // 登记为工件
        try {
          const { createArtifact } = await import("./src/domains/artifact/node/store.ts");
          const fileName = pdfPath.split("/").pop() || "export.pdf";
          createArtifact({ fileName, filePath: pdfPath, bytes: stat.size });
        } catch {}
        return json({ ok: true, pdfPath });
      } catch (e) {
        return json({ error: `导出失败：${(e as Error).message}` });
      }
    }
    // GET /api/preview?path=xxx — 格式化文档预览
    if (path === "/api/preview" && req.method === "GET") {
      const filePath = new URL(req.url).searchParams.get("path") || "";
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      try {
        if (ext === "docx") {
          const mammothMod = await import("mammoth");
          const mammoth = (mammothMod as any).default || mammothMod;
          // @ts-ignore
          const result = await mammoth.convertToHtml({ path: filePath });
          return json({ kind: "docx", html: result.value || "(空文档)" });
        } else if (ext === "xlsx") {
          const excelMod = await import("exceljs");
          const ExcelJS = (excelMod as any).default || excelMod;
          const buf = await Deno.readFile(filePath);
          // @ts-ignore
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buf as any);
          const sheets: any[] = [];
          workbook.eachSheet((sheet: any) => {
            const rows: any[] = [];
            sheet.eachRow({ includeEmpty: true }, (row: any) => {
              const vals = row.values as any[];
              const cells = (vals.slice(1) || []).map((v) => v?.toString?.() ?? "");
              rows.push(cells);
            });
            sheets.push({ name: sheet.name, rows: rows.slice(0, 100) });
          });
          return json({ kind: "xlsx", sheets });
        } else if (ext === "csv") {
          const text = await Deno.readTextFile(filePath);
          const rows = text.split("\n").map(r => r.split(",").map(c => c.replace(/^"|"$/g, "")));
          return json({ kind: "csv", sheets: [{ name: "CSV", rows: rows.slice(0, 100) }] });
        } else if (ext === "pptx") {
          const { readDoc } = await import("./src/domains/doc/node/reader.ts");
          const result = await readDoc(filePath);
          return json({ kind: "pptx", text: result.text });
        } else if (ext === "pdf") {
          const { readDoc } = await import("./src/domains/doc/node/reader.ts");
          const result = await readDoc(filePath);
          return json({ kind: "pdf", text: result.text });
        } else if (ext === "md" || ext === "txt" || ext === "json") {
          const text = await Deno.readTextFile(filePath);
          return json({ kind: ext, text });
        }
        return json({ error: `不支持预览格式: ${ext}` });
      } catch (e) {
        return json({ error: `预览加载失败: ${(e as Error).message}` });
      }
    }
    // GET /api/mcp — 列出 MCP server 配置和连接状态
    if (path === "/api/mcp" && req.method === "GET") {
      const { loadMcpConfig } = await import("./src/agent/mcp.ts");
      const { listMcpConnections } = await import("./src/agent/mcp.ts");
      const config = await loadMcpConfig();
      const connected = listMcpConnections();
      return json({ config, connected });
    }
    // POST /api/mcp — 保存 MCP 配置并重连
    if (path === "/api/mcp" && req.method === "POST") {
      const b = await req.json();
      const { saveMcpConfig, disconnectAllMcpServers, connectAllMcpServers } = await import("./src/agent/mcp.ts");
      await saveMcpConfig(b);
      await disconnectAllMcpServers();
      const tools = await connectAllMcpServers();
      setMcpTools(tools);
      return json({ ok: true, toolCount: tools.length });
    }
    // GET /api/conv/:id/export?format=md|txt|json — 导出对话
    if (path.includes("/export") && path.startsWith("/api/conv/") && req.method === "GET") {
      const parts = path.split("/");
      const id = parts[3];
      const format = new URL(req.url).searchParams.get("format") || "md";
      const messages = getMessages(id);
      const conv = listConversations().find((c: any) => c.id === id);
      const title = conv?.title || "对话";

      let content = "";
      const filename = title.replace(/[\/\\:*?"<>|]/g, "_");

      if (format === "json") {
        content = JSON.stringify({ title, id, messages }, null, 2);
      } else if (format === "txt") {
        content = `${title}\n${"=".repeat(title.length)}\n\n`;
        for (const m of messages) {
          const who = m.role === "user" ? "我" : m.role === "assistant" ? "Pi-a" : `🔧 ${m.toolName || "工具"}`;
          content += `[${who}]\n${m.content}\n\n`;
        }
      } else {
        // markdown（默认）
        content = `# ${title}\n\n`;
        for (const m of messages) {
          if (m.role === "user") {
            content += `## 🧑 我\n\n${m.content}\n\n`;
          } else if (m.role === "assistant") {
            content += `## 🤖 Pi-a\n\n${m.content}\n\n`;
          } else {
            content += `**🔧 ${m.toolName || "工具"}** ${m.isError ? "✗" : "✓"}\n\n`;
          }
        }
      }

      const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
      return new Response(content, {
        headers: {
          "content-type": format === "json" ? "application/json" : "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${encodeURIComponent(filename)}.${ext}"`,
        },
      });
    }
    // POST /api/conv/:id/fork { fromMessageId } — 从某条消息分叉出新会话
    if (path.match(/^\/api\/conv\/[^/]+\/fork$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const b = await req.json();
      const { forkConversation } = await import("./src/domains/session/node/store.ts");
      try {
        const conv = forkConversation(id, b.fromMessageId);
        return json(conv);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // ===== 项目 API =====
    if (path === "/api/projects" && req.method === "GET") {
      return json(listProjects());
    }
    if (path === "/api/projects" && req.method === "POST") {
      const b = await req.json();
      return json(createProject(b.name, b));
    }
    if (path.startsWith("/api/projects/") && !path.includes("/assign") && req.method === "GET") {
      const id = path.split("/")[3];
      const proj = getProject(id);
      if (!proj) return json({ error: "项目不存在" });
      const convs = listProjectConversations(id);
      return json({ ...proj, conversations: convs });
    }
    if (path.startsWith("/api/projects/") && !path.includes("/assign") && req.method === "PUT") {
      const id = path.split("/")[3];
      const b = await req.json();
      updateProject(id, b);
      return json({ ok: true });
    }
    if (path.startsWith("/api/projects/") && !path.includes("/assign") && req.method === "DELETE") {
      const id = path.split("/")[3];
      deleteProject(id);
      return json({ ok: true });
    }
    // POST /api/projects/:id/assign — 把会话归入项目 { conversationId }
    if (path.includes("/assign") && path.startsWith("/api/projects/") && req.method === "POST") {
      const id = path.split("/")[3];
      const b = await req.json();
      assignConversationToProject(b.conversationId, id);
      return json({ ok: true });
    }
    // ===== 专家 API =====
    // GET /api/experts — 列出所有专家
    if (path === "/api/experts" && req.method === "GET") {
      return json(BUILTIN_EXPERTS);
    }
    // POST /api/conv/:id/expert — 给会话切换专家 { expertId }
    if (path.includes("/expert") && path.startsWith("/api/conv/") && req.method === "POST") {
      const convId = path.split("/")[3];
      const b = await req.json();
      const expert = b.expertId ? getExpert(b.expertId) : undefined;
      const db = (await import("./src/infra/db.ts")).getDb();
      db.prepare("UPDATE conversations SET expert_id = ?, updated_at = ? WHERE id = ?")
        .run(b.expertId || null, Date.now(), convId);
      return json({ ok: true, expert: expert || null });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

if (import.meta.main) {
  const httpServer = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/" || path === "/index.html") {
      return new Response(RENDERER_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path.startsWith("/api/")) {
      return handleApi(req, path);
    }
    return new Response("404", { status: 404 });
  });
  const servePort = (httpServer.addr as any).port;
  const serveUrl = `http://127.0.0.1:${servePort}/`;

  // ===== BrowserWindow =====
  const _Deno = Deno as any;
  const win: any = new _Deno.BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 760,
    minHeight: 480,
    title: "Pi-a",
    url: serveUrl,
  });

  // 监听窗口事件：最小化后从 Dock 点击恢复
  try {
    const dock = _Deno.Dock ? new _Deno.Dock() : null;
    if (dock) {
      dock.addEventListener("reopen", () => {
        console.log("[main] dock reopen，恢复窗口");
        try { win.show(); win.focus(); } catch (e) { console.warn("[main] 恢复窗口失败:", e); }
      });
    }
  } catch (e) {
    console.warn("[main] Dock 监听不可用:", e);
  }

  // 兜底：监听 BrowserWindow 自身的事件
  try {
    win.addEventListener("reopen", () => {
      try { win.show(); win.focus(); } catch {}
    });
  } catch {}

  console.log("[main] win.windowId =", win.windowId, "serveUrl =", serveUrl);
  console.log("[main] Pi-a 已就绪，使用 HTTP API（/api/*）通信");
}
