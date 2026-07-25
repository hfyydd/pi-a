// src/agent/sidecar.ts
// 独立 Agent Sidecar 进程入口 (ACP 协议标准服务端)。
// 对标 WorkBuddy 的 cbc (CodeBuddy CLI) Sidecar 隔离体系。

import { checkToolPermission, resetComputerUseCount } from "./permissions.ts";
import { getFullTools } from "./tools/index.ts";
import { createPiAgent } from "./engine.ts";

let portStr = Deno.env.get("SIDECAR_PORT") || "8899";
for (let i = 0; i < Deno.args.length; i++) {
  if (Deno.args[i] === "--port" && Deno.args[i + 1]) {
    portStr = Deno.args[i + 1];
  }
}
const PORT = parseInt(portStr, 10);
const startTime = Date.now();

// 活动会话与取消控制信号
const activeAbortControllers = new Map<string, AbortController>();

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

console.log(`[Sidecar] 🚀 Agent Sidecar 独立进程已就绪，正在监听 HTTP 端口: ${PORT}...`);

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // 1. 健康检查与探针
  if (path === "/health" && req.method === "GET") {
    return jsonResponse({
      status: "ok",
      service: "pi-a-sidecar",
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      pid: Deno.pid,
    });
  }

  // 2. ACP (Agent Client Protocol) 主入口
  if (path === "/api/v1/acp" && req.method === "POST") {
    try {
      const body = await req.json();
      const { method, params, id } = body;

      // ── ACP initialize 握手 ──
      if (method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2026-01-01",
            serverInfo: { name: "pi-a-sidecar", version: "2.0.0" },
            capabilities: {
              sessions: true,
              streaming: true,
              computerUse: true,
              permissionLevels: ["L1", "L2", "L3"],
            },
          },
        });
      }

      // ── ACP session/cancel 取消 ──
      if (method === "session/cancel") {
        const sessionId = params?.sessionId;
        if (sessionId && activeAbortControllers.has(sessionId)) {
          activeAbortControllers.get(sessionId)?.abort();
          activeAbortControllers.delete(sessionId);
          return jsonResponse({ jsonrpc: "2.0", id, result: { cancelled: true } });
        }
        return jsonResponse({ jsonrpc: "2.0", id, result: { cancelled: false } });
      }

      // ── ACP session/prompt 流式推理与工具循环 ──
      if (method === "session/prompt") {
        const { sessionId, text, mode = "craft", permission = "L2", modelProvider, modelId } = params;

        if (!sessionId || !text) {
          return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing sessionId or text" } }, 400);
        }

        resetComputerUseCount(sessionId);
        const abortController = new AbortController();
        activeAbortControllers.set(sessionId, abortController);

        // 创建 SSE 流式 Response
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const pushEvent = (type: string, data: unknown) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
              } catch {}
            };

            try {
              const tools = mode === "ask" ? [] : getFullTools();
              const handle = createPiAgent(
                (event: any) => {
                  pushEvent("event", event);
                },
                {
                  modelProvider,
                  modelId,
                  tools,
                }
              );

              // 运行推理
              await handle.agent.prompt(text, sessionId);
              pushEvent("agent_end", { status: "success" });
            } catch (err) {
              pushEvent("agent_end", { status: "error", error: (err as Error).message });
            } finally {
              activeAbortControllers.delete(sessionId);
              try { controller.close(); } catch {}
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 404);
    } catch (err) {
      return jsonResponse({ jsonrpc: "2.0", error: { code: -32700, message: (err as Error).message } }, 500);
    }
  }

  return new Response("Pi-a Sidecar Agent Process", { status: 200 });
});
