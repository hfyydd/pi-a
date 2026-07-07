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
// 初始化基础设施
import { initDb } from "./src/infra/db.ts";
import { initModels, listModels } from "./src/agent/models.ts";
import { provider, type AgentEvent } from "./src/agent/provider.ts";
import { setConfirmHandler, clearConfirmHandler } from "./src/agent/permissions.ts";
import {
  createConversation, listConversations, renameConversation,
  moveConversation, deleteConversation, appendMessage, getMessages,
} from "./src/domains/session/node/store.ts";

initDb();
initModels();
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
      return json(listConversations(u.searchParams.get("category") || undefined, u.searchParams.get("search") || undefined));
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

console.log("[main] win.windowId =", win.windowId, "serveUrl =", serveUrl);

console.log("[main] Pi-a 已就绪，使用 HTTP API（/api/*）通信");
