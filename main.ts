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

// 前端静态文件：构建时内嵌（deno desktop 不打包非源码目录）
// gen:frontend 任务会把 frontend/dist/ 的所有文件读成一个 TS 模块
import { FRONTEND_FILES } from "./src/ui/frontend-assets.ts";
import { initDb } from "./src/infra/db.ts";
import { getDb } from "./src/infra/db.ts";
import { initModels, listModels, listAllProviders, registerProvider, listAvailableProviders } from "./src/agent/models.ts";
import { provider, type AgentEvent } from "./src/agent/provider.ts";
import { setConfirmHandler, clearConfirmHandler, resetComputerUseCount } from "./src/agent/permissions.ts";
import { ensureSkillsDir } from "./src/agent/skills.ts";
import { startScheduler } from "./src/domains/automation/node/scheduler.ts";
import { ensureMcpConfig, connectAllMcpServers } from "./src/agent/mcp.ts";
import { setMcpTools } from "./src/agent/tools/index.ts";
import { resolvePendingAnswer, isPendingAnswer } from "./src/agent/interactive.ts";
import {
  createConversation, listConversations, renameConversation,
  moveConversation, deleteConversation, appendMessage, getMessages,
} from "./src/domains/session/node/store.ts";
import { listArtifacts, deleteArtifact } from "./src/domains/artifact/node/store.ts";
import { createProject, listProjects, getProject, updateProject, deleteProject, assignConversationToProject, listProjectConversations } from "./src/domains/project/node/store.ts";
import { createWorkspace, listWorkspaces, getWorkspace, updateWorkspace, deleteWorkspace, touchWorkspace, listWorkspaceConversations, assignConversationToWorkspace } from "./src/domains/workspace/node/store.ts";
import { SidecarManager } from "./src/infra/sidecar_manager.ts";

// 启动 Sidecar 隔离进程
SidecarManager.getInstance().start();
import { BUILTIN_EXPERTS, getExpert } from "./src/agent/experts.ts";
import { getApiKey } from "./src/infra/keychain.ts";
import { getSetting, applyKeepAwake } from "./src/domains/settings/node/store.ts";

initDb();
initModels();
ensureSkillsDir();
ensureMcpConfig();
startScheduler();

// 初始化锁屏防睡眠状态
applyKeepAwake(getSetting("keep_awake", "false") === "true");

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
const toolArgsMap = new Map<string, string>(); // toolCallId -> JSON string of args

function getToolOutputString(output: unknown): string {
  if (!output) return "";
  if (typeof output === "string") return output;
  const anyOutput = output as any;
  if (Array.isArray(anyOutput.content)) {
    return anyOutput.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  if (typeof anyOutput.text === "string") return anyOutput.text;
  return JSON.stringify(output);
}

function getQueue(sessionId: string): AgentEvent[] {
  let q = eventQueues.get(sessionId);
  if (!q) {
    q = [];
    eventQueues.set(sessionId, q);
    // 订阅该会话的 provider 事件 → 入队 并持久化到数据库
    provider.onEvent(sessionId, (event) => {
      // 拦截并持久化消息到 SQLite（统一入口，避免 SSE 和轮询重复写入）
      try {
        if (event.type === "tool_execution_start") {
          const toolCallId = (event as any).toolCallId;
          const args = (event as any).args;
          if (toolCallId && args) {
            toolArgsMap.set(toolCallId, typeof args === "string" ? args : JSON.stringify(args));
          }
        } else if (event.type === "message_end" && (event as any).message?.role === "assistant") {
          const text = ((event as any).message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          if (text) appendMessage(sessionId, "assistant", text);
          logUsage(sessionId, (event as any).message);
        } else if (event.type === "tool_execution_end") {
          const toolCallId = (event as any).toolCallId;
          const argsStr = toolCallId ? toolArgsMap.get(toolCallId) : undefined;
          if (toolCallId) toolArgsMap.delete(toolCallId);
          const outputStr = getToolOutputString((event as any).output);
          appendMessage(sessionId, "tool", outputStr, {
            toolName: (event as any).toolName,
            toolArgs: argsStr,
            isError: (event as any).isError
          });
        }
      } catch (dbErr) {
        console.error("[queue] 消息持久化异常:", dbErr);
      }

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

/** 记录 token 用量到 DB */
function logUsage(sessionId: string, message: any) {
  try {
    const opt = getSetting("experience_opt", "true");
    if (opt === "false") {
      console.log("[privacy] 用户已退出体验优化计划，跳过记录用量日志");
      return;
    }
    const u = message?.usage;
    if (!u) return;
    const db = getDb();
    db.prepare(
      "INSERT INTO usage_logs (conversation_id, provider, model, input_tokens, output_tokens, total_tokens, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      sessionId,
      message.provider || "unknown",
      message.model || "unknown",
      u.input || 0,
      u.output || 0,
      u.totalTokens || 0,
      u.cost?.total || 0,
      Date.now(),
    );
  } catch {}
}

export async function handleApi(req: Request, path: string): Promise<Response> {
  const json = (s: unknown) => new Response(JSON.stringify(s), { headers: { "content-type": "application/json" } });
  try {
    // GET /api/conv?category=&search=&workspaceId=
    if (path === "/api/conv" && req.method === "GET") {
      const u = new URL(req.url);
      return json(listConversations(
        u.searchParams.get("category") || undefined,
        u.searchParams.get("search") || undefined,
        u.searchParams.get("status") || undefined,
        u.searchParams.get("workspaceId") || undefined,
      ));
    }
    // POST /api/conv  { title, category, workspaceId }
    if (path === "/api/conv" && req.method === "POST") {
      const b = await req.json();
      const conv = createConversation(b.title, b.category, b.workspaceId ?? null);
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
      const events = q.splice(0, q.length).filter((ev: any) =>
        !(ev.type === "tool_confirmation" && !pendingConfirms.has(ev.requestId)) &&
        !(ev.type === "ask_user_question" && !isPendingAnswer(ev.requestId))
      );
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
          const pending = q.splice(0, q.length).filter((ev: any) =>
            !(ev.type === "tool_confirmation" && !pendingConfirms.has(ev.requestId)) &&
            !(ev.type === "ask_user_question" && !isPendingAnswer(ev.requestId))
          );
          for (const ev of pending) {
            send(ev);
          }

          // 订阅新事件（onEvent 是异步的，先注册回调）
          let unsub: (() => void) | null = null;
          provider.onEvent(id, (event) => {
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
    // POST /api/ask-answer  { requestId, answers } — 用户回答 AskUserQuestion
    if (path === "/api/ask-answer" && req.method === "POST") {
      const b = await req.json();
      const ok = resolvePendingAnswer(b.requestId, b.answers);
      return json({ ok });
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
    // GET /api/pick-dir — 弹出 macOS 原生目录选择对话框，返回选中的绝对路径
    if (path === "/api/pick-dir" && req.method === "GET") {
      try {
        const cmd = new Deno.Command("osascript", {
          args: ["-e", 'try', '-e', 'set chosenFolder to choose folder with prompt "选择工作空间文件夹"', '-e', 'return POSIX path of chosenFolder', '-e', 'on error number -128', '-e', 'return ""', '-e', 'end try'],
          stdout: "piped",
          stderr: "piped",
        });
        const { stdout } = await cmd.output();
        const dirPath = new TextDecoder().decode(stdout).trim();
        if (!dirPath) return json({ cancelled: true });
        // 从绝对路径推导目录名
        const dirName = dirPath.replace(/\/$/, "").split("/").pop() || "新空间";
        return json({ path: dirPath, name: dirName });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    // GET /api/settings — 获取全局设置
    if (path === "/api/settings" && req.method === "GET") {
      const { getSetting } = await import("./src/domains/settings/node/store.ts");
      const { listAllProviders, listAvailableProviders, getCustomProviders } = await import("./src/agent/models.ts");
      const defaultProvider = getSetting("default_provider", "deepseek");
      const defaultModelId = getSetting("default_model_id", "deepseek-v4-flash");
      const docsDir = getSetting("docs_dir", "~/Desktop");
      
      const language = getSetting("language", "zh-CN");
      const fontSize = getSetting("font_size", "14");
      const autoUpdateSkills = getSetting("auto_update_skills", "true") === "true";
      const autoInstallSkills = getSetting("auto_install_skills", "false") === "true";
      const keepAwake = getSetting("keep_awake", "false") === "true";
      const defaultWorkspaceDir = getSetting("default_workspace_dir", "~/Pi-a");
      const experienceOpt = getSetting("experience_opt", "true") === "true";

      const agentSystemPrompt = getSetting("agent_system_prompt", "你是一个有用、高效的本地桌面助理，随时帮我处理各种任务。");
      const agentTemperature = getSetting("agent_temperature", "0.7");
      const agentMaxTokens = getSetting("agent_max_tokens", "4096");
      const searchEngine = getSetting("search_engine", "google");

      const sandboxSecurity = getSetting("sandbox_security", "true") === "true";
      const deletionProtection = getSetting("deletion_protection", "true") === "true";
      const bulkDeletionLimit = getSetting("bulk_deletion_limit", "50");
      const builtinRuntime = getSetting("builtin_runtime", "true") === "true";
      const runtimePython = getSetting("runtime_python", "true") === "true";
      const runtimeNodejs = getSetting("runtime_nodejs", "true") === "true";
      const securityFileRules = getSetting("security_file_rules", JSON.stringify(["/Users/hanfeng/Desktop/pi-a", "/tmp"]));
      const securityCommandRules = getSetting("security_command_rules", JSON.stringify(["git", "deno", "npm", "python"]));
      const securityNetworkRules = getSetting("security_network_rules", JSON.stringify(["api.deepseek.com", "github.com", "deno.land"]));

      const ollamaBaseUrl = getSetting("ollama_base_url", "http://127.0.0.1:11434");

      return json({
        defaultProvider,
        defaultModelId,
        docsDir,
        language,
        fontSize,
        autoUpdateSkills,
        autoInstallSkills,
        keepAwake,
        defaultWorkspaceDir,
        experienceOpt,
        agentSystemPrompt,
        agentTemperature,
        agentMaxTokens,
        searchEngine,
        sandboxSecurity,
        deletionProtection,
        bulkDeletionLimit,
        builtinRuntime,
        runtimePython,
        runtimeNodejs,
        securityFileRules,
        securityCommandRules,
        securityNetworkRules,
        ollamaBaseUrl,
        customProviders: getCustomProviders(),
        providers: listAllProviders(),
        availableProviders: listAvailableProviders(),
      });
    }
    // POST /api/settings — 保存全局设置
    if (path === "/api/settings" && req.method === "POST") {
      const b = await req.json();
      const { setSetting } = await import("./src/domains/settings/node/store.ts");
      const { registerProvider } = await import("./src/agent/models.ts");

      if (b.defaultProvider) setSetting("default_provider", b.defaultProvider);
      if (b.defaultModelId) setSetting("default_model_id", b.defaultModelId);
      if (b.docsDir) setSetting("docs_dir", b.docsDir);
      
      if (b.language) setSetting("language", b.language);
      if (b.fontSize) setSetting("font_size", b.fontSize);
      if (b.autoUpdateSkills !== undefined) setSetting("auto_update_skills", b.autoUpdateSkills ? "true" : "false");
      if (b.autoInstallSkills !== undefined) setSetting("auto_install_skills", b.autoInstallSkills ? "true" : "false");
      if (b.keepAwake !== undefined) setSetting("keep_awake", b.keepAwake ? "true" : "false");
      if (b.defaultWorkspaceDir) setSetting("default_workspace_dir", b.defaultWorkspaceDir);
      if (b.experienceOpt !== undefined) setSetting("experience_opt", b.experienceOpt ? "true" : "false");

      if (b.agentSystemPrompt !== undefined) setSetting("agent_system_prompt", b.agentSystemPrompt);
      if (b.agentTemperature !== undefined) setSetting("agent_temperature", b.agentTemperature);
      if (b.agentMaxTokens !== undefined) setSetting("agent_max_tokens", b.agentMaxTokens);
      if (b.searchEngine !== undefined) setSetting("search_engine", b.searchEngine);

      if (b.sandboxSecurity !== undefined) setSetting("sandbox_security", b.sandboxSecurity ? "true" : "false");
      if (b.deletionProtection !== undefined) setSetting("deletion_protection", b.deletionProtection ? "true" : "false");
      if (b.bulkDeletionLimit !== undefined) setSetting("bulk_deletion_limit", String(b.bulkDeletionLimit));
      if (b.builtinRuntime !== undefined) setSetting("builtin_runtime", b.builtinRuntime ? "true" : "false");
      if (b.runtimePython !== undefined) setSetting("runtime_python", b.runtimePython ? "true" : "false");
      if (b.runtimeNodejs !== undefined) setSetting("runtime_nodejs", b.runtimeNodejs ? "true" : "false");
      if (b.securityFileRules !== undefined) setSetting("security_file_rules", b.securityFileRules);
      if (b.securityCommandRules !== undefined) setSetting("security_command_rules", b.securityCommandRules);
      if (b.securityNetworkRules !== undefined) setSetting("security_network_rules", b.securityNetworkRules);

      if (b.ollamaBaseUrl) {
        setSetting("ollama_base_url", b.ollamaBaseUrl);
        await registerProvider("ollama");
      }

      return json({ ok: true });
    }
    // GET /api/ollama/models — 获取/刷新 Ollama 本地已安装模型
    if (path === "/api/ollama/models" && req.method === "GET") {
      const { getSetting } = await import("./src/domains/settings/node/store.ts");
      const { registerProvider } = await import("./src/agent/models.ts");
      const rawOllamaUrl = getSetting("ollama_base_url", "http://127.0.0.1:11434");
      const rootUrl = rawOllamaUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
      try {
        const start = Date.now();
        const res = await fetch(`${rootUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          const data = await res.json();
          const modelsList = (data.models || []).map((m: any) => ({
            id: m.name || m.model,
            name: m.name || m.model,
            size: m.size ? `${(m.size / (1024 * 1024 * 1024)).toFixed(1)}GB` : undefined,
            modifiedAt: m.modified_at,
          }));
          await registerProvider("ollama");
          return json({ ok: true, running: true, latencyMs, models: modelsList });
        }
        return json({ ok: false, running: false, error: `HTTP ${res.status} ${res.statusText}` });
      } catch (e) {
        return json({ ok: false, running: false, error: `未连接到 Ollama 服务 (${(e as Error).message})` });
      }
    }
    // POST /api/settings/custom-providers — 保存/添加自定义 OpenAI 提供商
    if (path === "/api/settings/custom-providers" && req.method === "POST") {
      const b = await req.json();
      const { setSetting, getSetting } = await import("./src/domains/settings/node/store.ts");
      const { registerProvider } = await import("./src/agent/models.ts");
      const { setApiKey } = await import("./src/infra/keychain.ts");

      const existingRaw = getSetting("custom_providers", "[]");
      let list: any[] = [];
      try { list = JSON.parse(existingRaw); } catch {}

      const providerId = b.id || `custom_${Date.now()}`;
      const name = b.name || "自定义 Provider";
      const baseUrl = b.baseUrl || "https://api.openai.com/v1";
      const modelsList = Array.isArray(b.models)
        ? b.models
        : (typeof b.models === "string" ? b.models.split(",").map((s: string) => s.trim()).filter(Boolean) : ["default"]);

      const newItem = { id: providerId, name, baseUrl, models: modelsList };
      const existingIdx = list.findIndex((item) => item.id === providerId);
      if (existingIdx >= 0) {
        list[existingIdx] = newItem;
      } else {
        list.push(newItem);
      }

      setSetting("custom_providers", JSON.stringify(list));
      if (b.apiKey) {
        await setApiKey(providerId, b.apiKey);
      }
      await registerProvider(providerId);
      return json({ ok: true, provider: newItem });
    }
    // DELETE /api/settings/custom-providers/:id — 删除自定义提供商
    if (path.startsWith("/api/settings/custom-providers/") && req.method === "DELETE") {
      const id = path.split("/")[4];
      const { setSetting, getSetting } = await import("./src/domains/settings/node/store.ts");
      const { deleteApiKey } = await import("./src/infra/keychain.ts");
      const existingRaw = getSetting("custom_providers", "[]");
      let list: any[] = [];
      try { list = JSON.parse(existingRaw); } catch {}
      list = list.filter((item) => item.id !== id);
      setSetting("custom_providers", JSON.stringify(list));
      await deleteApiKey(id);
      return json({ ok: true });
    }
    // POST /api/settings/test-connection — 连通性测试 (支持预设 / Ollama / 自定义)
    if (path === "/api/settings/test-connection" && req.method === "POST") {
      const b = await req.json();
      const { getApiKey } = await import("./src/infra/keychain.ts");
      const { PROVIDER_BASE_URLS } = await import("./src/agent/models.ts");

      const providerId = b.provider;
      const key = b.apiKey || (await getApiKey(providerId)) || "";
      const rawBaseUrl = b.baseUrl || PROVIDER_BASE_URLS[providerId] || "https://api.openai.com/v1";

      const start = Date.now();

      // Ollama 连通测试
      if (providerId === "ollama") {
        const rootUrl = rawBaseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
        try {
          const res = await fetch(`${rootUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
          const latencyMs = Date.now() - start;
          if (res.ok) {
            const data = await res.json();
            const count = data.models?.length || 0;
            return json({ ok: true, latencyMs, message: `Ollama 连接正常，查找到 ${count} 个本地模型` });
          }
          return json({ ok: false, error: `Ollama 响应异常 (HTTP ${res.status})` });
        } catch (e) {
          return json({ ok: false, error: `无法连接到 Ollama 服务 (${(e as Error).message})` });
        }
      }

      // 其它云端/通用 API 连通测试
      const baseUrl = rawBaseUrl.endsWith("/v1") ? rawBaseUrl : `${rawBaseUrl.replace(/\/$/, "")}/v1`;
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: key ? { Authorization: `Bearer ${key}` } : {},
          signal: AbortSignal.timeout(6000),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          return json({ ok: true, latencyMs, message: `连接成功 (延迟 ${latencyMs}ms)` });
        }
        if (res.status === 401 || res.status === 403) {
          return json({ ok: false, error: "身份验证失败 (401/403): 请检查 API Key 是否有效" });
        }
        return json({ ok: true, latencyMs, message: `网络通畅 (HTTP ${res.status})` });
      } catch (e) {
        return json({ ok: false, error: `网络请求失败: ${(e as Error).message}` });
      }
    }
    // GET /api/settings/audit-logs — 获取安全中心审计日志
    if (path === "/api/settings/audit-logs" && req.method === "GET") {
      try {
        const db = getDb();
        const logs = db.prepare("SELECT id, tool_name as toolName, args, is_error as isError, created_at as createdAt FROM tool_audit_log ORDER BY id DESC LIMIT 50").all();
        return json(logs);
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
      }
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
    // POST /api/skills — 新建技能 { name, description, disabled, body, displayName }
    if (path === "/api/skills" && req.method === "POST") {
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(b.name, b.description || "", !!b.disabled, b.body || "", b.displayName || b.name);
        return json(skill);
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // PUT /api/skills/:name — 编辑技能 { description, disabled, body, displayName }
    if (path.match(/^\/api\/skills\/[^/]+$/) && req.method === "PUT") {
      const name = path.split("/")[3];
      const b = await req.json();
      const { saveSkill } = await import("./src/domains/skill/node/store.ts");
      try {
        const skill = await saveSkill(name, b.description || "", !!b.disabled, b.body || "", b.displayName || name);
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
    // POST /api/automations — 新建 { name, workspaceId, triggerType, triggerConfig, actionType, actionConfig, prompt, expertId, permission, connector, scheduleType, validFrom, validUntil, pushToWxmp }
    if (path === "/api/automations" && req.method === "POST") {
      const b = await req.json();
      const { createAutomation, updateAutomation, getAutomation } = await import("./src/domains/automation/node/store.ts");
      const { initAutomationNextRun } = await import("./src/domains/automation/node/scheduler.ts");
      const a = createAutomation(b);
      initAutomationNextRun(a);
      return json(getAutomation(a.id));
    }
    // PUT /api/automations/:id — 更新
    if (path.match(/^\/api\/automations\/[^/]+$/) && !path.endsWith("/runs") && !path.endsWith("/run") && req.method === "PUT") {
      const id = path.split("/")[3];
      const b = await req.json();
      const { updateAutomation, getAutomation } = await import("./src/domains/automation/node/store.ts");
      const { initAutomationNextRun } = await import("./src/domains/automation/node/scheduler.ts");
      updateAutomation(id, b);
      const a = getAutomation(id);
      if (a) {
        if (a.enabled && a.triggerType === "cron") initAutomationNextRun(a);
        else updateAutomation(id, { nextRun: null });
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
      const { getAutomation, createRun } = await import("./src/domains/automation/node/store.ts");
      const a = getAutomation(id);
      if (!a) return json({ error: "自动化不存在" });
      const conv = createConversation(`[自动] ${a.name}`, "automation", a.workspaceId ?? undefined);
      const run = createRun(a.id, conv.id);
      const { runAutomationWithPersistence } = await import("./src/domains/automation/node/scheduler.ts");
      runAutomationWithPersistence(a, conv.id, run.id);
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
    // GET /api/system/permissions — 诊断 Computer Use 系统权限及依赖（纯 C API 静默检查，绝不出弹出/不强开系统偏好）
    if (path === "/api/system/permissions" && req.method === "GET") {
      const { hasCliclick, getDisplayMetrics } = await import("./src/agent/tools/os.ts");
      const cliclickInstalled = await hasCliclick();
      const metrics = await getDisplayMetrics();

      let accessibilityGranted = false;
      let screenRecordingGranted = false;

      if (Deno.build.os === "darwin") {
        // 1. 辅助功能检测 (AXIsProcessTrusted + AppleScript System Events 双重检测)
        try {
          const appServices = Deno.dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", {
            AXIsProcessTrusted: { parameters: [], result: "bool" },
          });
          accessibilityGranted = appServices.symbols.AXIsProcessTrusted();
          appServices.close();
        } catch {}

        if (!accessibilityGranted) {
          try {
            const cmd = new Deno.Command("osascript", {
              args: ["-e", 'tell application "System Events" to return true'],
              stdout: "null", stderr: "null"
            });
            const r = await cmd.output();
            accessibilityGranted = r.code === 0;
          } catch {}
        }

        // 2. 屏幕录制检测 (CGPreflightScreenCaptureAccess + CGRequestScreenCaptureAccess + Accessibility 强信号三重静默检测)
        try {
          const coreGraphics = Deno.dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
            CGPreflightScreenCaptureAccess: { parameters: [], result: "bool" },
            CGRequestScreenCaptureAccess: { parameters: [], result: "bool" },
          });
          const preflight = coreGraphics.symbols.CGPreflightScreenCaptureAccess();
          const request = coreGraphics.symbols.CGRequestScreenCaptureAccess();
          screenRecordingGranted = preflight || request || accessibilityGranted;
          coreGraphics.close();
        } catch {
          screenRecordingGranted = true;
        }
      } else {
        accessibilityGranted = true;
        screenRecordingGranted = true;
      }

      return json({
        os: Deno.build.os,
        cliclickInstalled,
        accessibilityGranted,
        screenRecordingGranted,
        metrics,
      });
    }
    // POST /api/system/permissions/open — 打开 macOS 权限系统偏好设置页面
    if (path === "/api/system/permissions/open" && req.method === "POST") {
      try {
        const cmd = new Deno.Command("open", { args: ["x-apple.systempreferences:com.apple.preference.security"] });
        await cmd.output();
        return json({ ok: true });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    }
    // GET /api/system/sidecar — 查询 Sidecar 进程状态与日志
    if (path === "/api/system/sidecar" && req.method === "GET") {
      const mgr = SidecarManager.getInstance();
      return json({
        ready: mgr.isReady(),
        port: mgr.getPort(),
        logs: mgr.getLogs(),
      });
    }

    // POST /api/system/exit — 强制退出程序
    if (path === "/api/system/exit" && req.method === "POST") {
      setTimeout(() => {
        try { Deno.exit(0); } catch {}
      }, 100);
      return json({ success: true });
    }

    // GET /api/system/context — 获取当前前台应用名及选中内容
    if (path === "/api/system/context" && req.method === "GET") {
      let app = "";
      let selection = "";
      try {
        const cmd = new Deno.Command("osascript", {
          args: ["-e", 'tell application "System Events" to name of first process whose frontmost is true']
        });
        const r = await cmd.output();
        app = new TextDecoder().decode(r.stdout).trim();
      } catch {}

      try {
        const cmd = new Deno.Command("pbpaste");
        const r = await cmd.output();
        selection = new TextDecoder().decode(r.stdout).trim().slice(0, 1000);
      } catch {}

      return json({ app, selection });
    }

    // POST /api/float/transfer — 将速唤浮窗记录转存为主会话
    if (path === "/api/float/transfer" && req.method === "POST") {
      const b = await req.json();
      const sessionId = b.sessionId;
      if (sessionId) {
        const db = getDb();
        db.prepare("UPDATE conversations SET category = 'assistant' WHERE id = ?").run(sessionId);
        return json({ ok: true });
      }
      return json({ error: "缺失 sessionId" });
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
    // ===== 工作空间 API =====
    if (path === "/api/workspaces" && req.method === "GET") {
      return json(listWorkspaces());
    }
    if (path === "/api/workspaces" && req.method === "POST") {
      const b = await req.json();
      return json(createWorkspace(b.name, b));
    }
    if (path.startsWith("/api/workspaces/") && !path.includes("/assign") && req.method === "GET") {
      const id = path.split("/")[3];
      const ws = getWorkspace(id);
      if (!ws) return json({ error: "工作空间不存在" });
      touchWorkspace(id);
      const convs = listWorkspaceConversations(id);
      return json({ ...ws, conversations: convs });
    }
    if (path.startsWith("/api/workspaces/") && !path.includes("/assign") && req.method === "PUT") {
      const id = path.split("/")[3];
      const b = await req.json();
      updateWorkspace(id, b);
      return json({ ok: true });
    }
    if (path.startsWith("/api/workspaces/") && !path.includes("/assign") && req.method === "DELETE") {
      const id = path.split("/")[3];
      deleteWorkspace(id);
      return json({ ok: true });
    }
    if (path.includes("/assign") && path.startsWith("/api/workspaces/") && req.method === "POST") {
      const id = path.split("/")[3];
      const b = await req.json();
      assignConversationToWorkspace(b.conversationId, id);
      return json({ ok: true });
    }
    // ===== 专家 API =====
    // ===== 用量统计 API =====
    // GET /api/usage — 获取 token 用量汇总（最近7天）
    if (path === "/api/usage" && req.method === "GET") {
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const rows = getDb().prepare(
        "SELECT provider, model, SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, SUM(total_tokens) as totalTokens, SUM(cost) as cost, COUNT(*) as calls, DATE(created_at/1000, 'unixepoch', 'localtime') as date FROM usage_logs WHERE created_at >= ? GROUP BY provider, model, date ORDER BY date DESC",
      ).all(since) as any[];
      // 总计
      const totals = getDb().prepare(
        "SELECT SUM(total_tokens) as totalTokens, SUM(cost) as totalCost, COUNT(*) as totalCalls FROM usage_logs WHERE created_at >= ?",
      ).get(since) as any;
      return json({ rows, totals: { totalTokens: totals?.totalTokens || 0, totalCost: totals?.totalCost || 0, totalCalls: totals?.totalCalls || 0 } });
    }
    // GET /api/usage/audit — 获取工具审计日志（最近100条）
    if (path === "/api/usage/audit" && req.method === "GET") {
      const { logToolAudit } = await import("./src/infra/db.ts");
      // 直接查 DB
      const rows = getDb().prepare(
        "SELECT tool_name as toolName, args, is_error as isError, created_at as createdAt FROM tool_audit_log ORDER BY created_at DESC LIMIT 100",
      ).all();
      return json(rows);
    }
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
  // 后端端口固定（默认 8000），便于 Vite dev server 把 /api 代理过来
  const servePortNum = Number(Deno.env.get("PI_A_PORT") || 8000);
  const httpServer = Deno.serve({ port: servePortNum }, async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      return handleApi(req, path);
    }
    // 从内嵌的前端文件 map 里查找
    const lookupPath = path === "/" ? "/index.html" : path;
    const file = FRONTEND_FILES[lookupPath];
    if (file) {
      return new Response(file.content as any, {
        headers: { "content-type": file.contentType },
      });
    }
    // SPA fallback
    const index = FRONTEND_FILES["/index.html"];
    if (index) {
      return new Response(index.content as any, {
        headers: { "content-type": index.contentType },
      });
    }
    return new Response("Frontend not built. Run: deno task gen:frontend", { status: 500 });
  });
  const servePort = (httpServer.addr as any).port;
  const serveUrl = `http://127.0.0.1:${servePort}/`;

  // 开发模式（PI_A_DEV_FRONTEND=1）：桌面窗口直接加载 Vite dev server（5173），
  // 前端改动经 Vite HMR 秒级生效；API 请求由 Vite 代理回本后端端口。
  // 生产/打包模式走内嵌前端（serveUrl），行为不变。
  const DEV_FRONTEND = Deno.env.get("PI_A_DEV_FRONTEND") === "1";
  const frontendUrl = DEV_FRONTEND ? "http://127.0.0.1:5173" : serveUrl;

  // ===== BrowserWindow =====
  const _Deno = Deno as any;
  let win: any = null;
  if (_Deno.BrowserWindow) {
    // Deno Desktop 限制：第一个窗口（隐式启动的窗口）会忽略 transparentTitlebar 等创建期配置。
    // 为了使透明标题栏在 macOS 上生效，我们先采用并创建一个位于屏幕外的 0x0 占位窗口（不调用 hide() 以防触发 webview 挂起），
    // 然后创建一个崭新的第二个窗口作为主窗口，并显式调用 navigate() 保证加载成功。
    try {
      const _firstWin = new _Deno.BrowserWindow({ width: 0, height: 0, x: -9999, y: -9999 });
    } catch (e) {
      console.warn("[main] 创建占位窗口失败:", e);
    }

    try {
      win = new _Deno.BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 960,
        minHeight: 640,
        title: "Pi-a",
        url: frontendUrl,
        transparentTitlebar: true,
      });
      try {
        win.navigate(frontendUrl);
      } catch (e) {
        console.warn("[main] 显式导航主窗口失败:", e);
      }
      try {
        win.openDevtools();
      } catch (e) {
        console.warn("[main] 开启 DevTools 失败:", e);
      }
    } catch (e) {
      // 窗口创建失败（如无显示环境 / webview 初始化异常）不应拖垮后端服务
      console.warn("[main] 创建主窗口失败，后端继续运行:", e);
      win = null;
    }
  } else {
    console.log("[main] 未检测到 Deno Desktop 运行时，跳过窗口创建。");
  }

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
    if (win) {
      win.addEventListener("reopen", () => {
        try { win.show(); win.focus(); } catch {}
      });
    }
  } catch {}

  // ===== 托盘常驻 =====
  // 关闭窗口时隐藏到托盘而非退出；点托盘图标恢复
  let tray: any = null;
  if (_Deno.Tray) {
    try {
      tray = new _Deno.Tray({ tooltip: "Pi-a · 本地优先 AI 助手" });
      tray.addEventListener("click", () => {
        try {
          if (win && win.isVisible()) { win.hide(); } else if (win) { win.show(); win.focus(); }
        } catch {}
      });
      // 托盘菜单
      tray.setMenu([
        { label: "显示 Pi-a", click: () => { try { if (win) { win.show(); win.focus(); } } catch {} } },
        { label: "新建对话", click: () => { try { if (win) { win.show(); win.focus(); } } catch {} } },
        { type: "separator" },
        { label: "退出 Pi-a", click: () => { try { Deno.exit(0); } catch {} } },
      ]);
      console.log("[main] 托盘已创建");
    } catch (e) {
      console.warn("[main] 托盘不可用:", e);
    }
  }

  // 窗口关闭按钮 → 彻底退出程序
  try {
    if (win) {
      const exitFn = () => {
        console.log("[main] 用户点击窗口关闭按钮，直接退出程序");
        try { Deno.exit(0); } catch {}
      };
      win.addEventListener("closeRequested", exitFn);
      win.addEventListener("close", exitFn);
      win.addEventListener("closed", exitFn);
    }
  } catch {}

  console.log("[main] win.windowId =", win ? win.windowId : "none", "serveUrl =", serveUrl);
  console.log("[main] Pi-a 已就绪，使用 HTTP API（/api/*）通信");
}
