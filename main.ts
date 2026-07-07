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
import { setConfirmHandler, clearConfirmHandler } from "./src/agent/permissions.ts";
import { ensureSkillsDir } from "./src/agent/skills.ts";
import {
  createConversation, listConversations, renameConversation,
  moveConversation, deleteConversation, appendMessage, getMessages,
} from "./src/domains/session/node/store.ts";
import { listArtifacts, deleteArtifact } from "./src/domains/artifact/node/store.ts";
import { getApiKey } from "./src/infra/keychain.ts";

initDb();
initModels();
ensureSkillsDir();

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

async function handleApi(req: Request, path: string): Promise<Response> {
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
    // POST /api/prompt  { sessionId, text, mode, permission }
    if (path === "/api/prompt" && req.method === "POST") {
      const b = await req.json();
      console.log("[api] /api/prompt session:", b.sessionId?.slice(0,8), "mode:", b.mode);
      // 确保 queue 已订阅（在 prompt 之前）
      getQueue(b.sessionId);
      appendMessage(b.sessionId, "user", b.text);
      setConfirmHandler(b.sessionId, async (toolName: string, args: unknown) => {
        const requestId = crypto.randomUUID();
        const q = getQueue(b.sessionId);
        q.push({ type: "tool_confirmation" as any, requestId, toolName, args, sessionId: b.sessionId } as any);
        return await new Promise<boolean>((resolve) => {
          pendingConfirms.set(requestId, resolve);
          setTimeout(() => { if (pendingConfirms.has(requestId)) { pendingConfirms.delete(requestId); resolve(false); } }, 120000);
        });
      });
      provider.prompt(b.sessionId, b.text, { mode: b.mode || "craft", permission: b.permission || "default" });
      return json({ ok: true });
    }
    // POST /api/abort  { sessionId }
    if (path === "/api/abort" && req.method === "POST") {
      const b = await req.json();
      provider.abort(b.sessionId);
      return json({ ok: true });
    }
    // GET /api/events/:id
    if (path.startsWith("/api/events/") && req.method === "GET") {
      const id = path.split("/")[3];
      const q = getQueue(id);
      const events = q.splice(0, q.length);
      if (events.length > 0) console.log("[api] /api/events 返回", events.length, "个事件给", id.slice(0,8));
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
    // GET /api/memories — 获取全部记忆
    if (path === "/api/memories" && req.method === "GET") {
      const { recallMemories } = await import("./src/domains/memory/node/store.ts");
      return json(recallMemories());
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
        } else if (ext === "md" || ext === "txt" || ext === "json") {
          const text = await Deno.readTextFile(filePath);
          return json({ kind: ext, text });
        }
        return json({ error: `不支持预览格式: ${ext}` });
      } catch (e) {
        return json({ error: `预览加载失败: ${(e as Error).message}` });
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

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
  // 显式导航到我们的 serve URL
  url: serveUrl,
});

// 监听窗口事件：最小化后从 Dock 点击恢复
// deno desktop 的 reopen 事件发给 Dock 对象，需手动调 win.show() 恢复
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

// 兜底：监听 BrowserWindow 自身的事件（如果 reopen 也发给 window）
try {
  win.addEventListener("reopen", () => {
    try { win.show(); win.focus(); } catch {}
  });
} catch {}

console.log("[main] win.windowId =", win.windowId, "serveUrl =", serveUrl);

console.log("[main] Pi-a 已就绪，使用 HTTP API（/api/*）通信");
