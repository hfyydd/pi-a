// src/agent/provider.ts
// AgentProvider 抽象 + LocalPiProvider。
// 对照 03 文档 §2.2：吸收 WorkBuddy 双模式发现，抽象出 AgentProvider 接口，
// MVP 唯一实现 LocalPiProvider（pi 在 Deno runtime 直跑），P2 预留 CloudProvider。

import type { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
export type { AgentEvent };
import { createWorkBuddyAgent, type AgentHandle } from "./engine.ts";
import { getFullTools, getReadOnlyTools } from "./tools/index.ts";
import { getDb } from "../infra/db.ts";
import { updateConversationStatus, getMessages, appendMessage } from "../domains/session/node/store.ts";
import { sessionContext } from "../infra/context.ts";

/** 执行模式：Ask=仅问答 / Plan=先方案 / Craft=直接执行 */
export type RunMode = "ask" | "plan" | "craft";

/** 权限级别（三层模型，对标 WorkBuddy）：
 * - readonly (L1)：只读，所有写工具被拦截
 * - default  (L2)：写工具需确认（兼容旧值）
 * - full     (L3)：完全自动，不确认（兼容旧值）
 */
export type PermLevel = "L1" | "L2" | "L3" | "readonly" | "default" | "full";

/** 单次 prompt 的选项（由 UI 传入） */
export interface PromptOptions {
  mode: RunMode;
  permission: PermLevel;
}

/** AgentProvider 契约：所有 agent 后端实现此接口 */
export interface AgentProvider {
  readonly id: "local" | "cloud";
  /** 发起一次 prompt（带模式/权限） */
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<void>;
  /** 中途插话 */
  steer(sessionId: string, msg: string): Promise<void>;
  /** 中止当前 */
  abort(sessionId: string): Promise<void>;
  /** 订阅某会话的事件流 */
  onEvent(sessionId: string, cb: (e: AgentEvent) => void): Promise<() => void>;
  /** 向某会话广播一个事件（供外部注入非 agent 事件，如工具确认请求 tool_confirmation） */
  emitEvent(sessionId: string, event: AgentEvent): void;
  /** 销毁某会话 */
  dispose(sessionId: string): Promise<void>;
}

/** 各模式对应的工具集（用 pi 自带工具） */
function toolsForMode(mode: RunMode): AgentTool<any>[] {
  if (mode === "ask") return [];          // Ask：无工具，纯问答
  if (mode === "plan") return getReadOnlyTools(); // Plan：只读（read/grep/find/ls + memory_recall）
  return getFullTools();                  // Craft：全工具（read/bash/edit/write + memory）
}

/** 各模式的系统提示增量 */
const MODE_PROMPTS: Record<RunMode, string> = {
  ask: "\n\n【当前模式：Ask】用户只需回答，请勿调用任何工具，直接用文字回答。",
  plan: "\n\n【当前模式：Plan】请先分析任务、列出分步方案（编号列表），等待用户确认后再执行写操作。不要在未经确认时直接创建或修改文件。",
  craft: "",
};

interface SessionEntry {
  handle: AgentHandle;
  listeners: Set<(e: AgentEvent) => void>;
  /** 最近一次 prompt 的选项（mode/permission） */
  lastOpts: PromptOptions;
}

/** 默认选项 */
const DEFAULT_OPTS: PromptOptions = { mode: "craft", permission: "default" };

/**
 * LocalPiProvider：pi Agent 在 Deno runtime 直跑。
 * spike 验证：new Agent({...}) + 真实 LLM 流式对话全通过。
 *
 * 每个 sessionId 对应一个独立的 pi Agent 实例（独立对话历史）。
 */
export class LocalPiProvider implements AgentProvider {
  readonly id = "local" as const;
  private sessions = new Map<string, SessionEntry>();

  private async ensureSession(sessionId: string): Promise<SessionEntry> {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      const listeners = new Set<(e: AgentEvent) => void>();
      
      // 查询会话的模型配置 + 专家配置
      const db = getDb();
      const conv = db.prepare("SELECT model_provider, model_id, expert_id FROM conversations WHERE id = ?").get(sessionId) as { model_provider: string; model_id: string; expert_id?: string } | undefined;

      // 如果有专家，加载专家的 system prompt (支持网络置换 + 本地缓存)
      let expertPrompt: string | undefined;
      if (conv?.expert_id) {
        try {
          const { getExpertSystemPrompt } = await import("./experts.ts");
          expertPrompt = await getExpertSystemPrompt(conv.expert_id);
        } catch {}
      }

      const handle = createWorkBuddyAgent((event) => {
        // 广播给该会话的所有监听者
        for (const cb of listeners) {
          try {
            cb(event);
          } catch (e) {
            console.error("[provider] 事件监听器异常:", e);
          }
        }
      }, {
        modelProvider: conv?.model_provider || "deepseek",
        modelId: conv?.model_id || "deepseek-v4-flash",
        systemPrompt: expertPrompt,
      });
      // 若会话有历史消息（fork 分支或旧会话续聊），重放进 agent state，避免"失忆"
      const history = getMessages(sessionId);
      if (history.length > 0) {
        (handle.agent.state as any).messages = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role,
            content: [{ type: "text", text: m.content }],
            timestamp: m.createdAt,
          }));
        console.log(`[provider] 会话 ${sessionId} 重放 ${history.length} 条历史消息`);
      }
      entry = { handle, listeners, lastOpts: DEFAULT_OPTS };
      this.sessions.set(sessionId, entry);
      console.log(`[provider] 创建会话 ${sessionId} (模型: ${conv?.model_provider || "deepseek"}/${conv?.model_id || "deepseek-v4-flash"})`);
    }
    return entry;
  }

  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<void> {
    const entry = await this.ensureSession(sessionId);
    const o = opts ?? entry.lastOpts;
    entry.lastOpts = o;

    // 按模式切换工具集 + 系统提示
    const agent = entry.handle.agent;
    agent.state.tools = toolsForMode(o.mode);
    const basePrompt = agent.state.systemPrompt.split("\n\n【当前模式")[0]; // 去掉旧的模式标记
    agent.state.systemPrompt = basePrompt + MODE_PROMPTS[o.mode];

    // 记录权限级别，供 beforeToolCall 钩子读取（见 engine.ts 的权限注入）
    (agent as any).__perm = o.permission;
    (agent as any).__sessionId = sessionId;

    // 标记会话为运行中
    updateConversationStatus(sessionId, "running");

    sessionContext.run({ sessionId }, () => {
      agent.prompt(text).then(() => {
        console.log(`[provider] 会话 ${sessionId} prompt 完成`);
        updateConversationStatus(sessionId, "done");
      }).catch((e) => {
        const errorMsg = "出错了：" + (e?.message || String(e));
        console.error(`[provider] 会话 ${sessionId} prompt 失败:`, errorMsg);
        updateConversationStatus(sessionId, "failed");

        // 1. 将错误信息追加到数据库记录中
        appendMessage(sessionId, "assistant", errorMsg);

        // 2. 向上层 SSE / 轮询队列广播消息更新，将错误渲染到界面
        this.emitEvent(sessionId, {
          type: "message_update" as any,
          sessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: errorMsg }]
          }
        } as any);

        this.emitEvent(sessionId, {
          type: "message_end" as any,
          sessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: errorMsg }]
          }
        } as any);

        // 3. 广播 agent_end 事件，解锁 UI
        this.emitEvent(sessionId, { type: "agent_end" } as any);
      });
    });
  }

  /** 读取某会话当前权限级别（供权限钩子用） */
  getPermission(sessionId: string): PermLevel {
    return this.sessions.get(sessionId)?.lastOpts.permission ?? "default";
  }

  async steer(sessionId: string, msg: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.handle.agent.steer({
      role: "user",
      content: [{ type: "text", text: msg }],
      timestamp: Date.now(),
    });
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.handle.agent.abort();
  }

  async onEvent(sessionId: string, cb: (e: AgentEvent) => void): Promise<() => void> {
    const entry = await this.ensureSession(sessionId);
    entry.listeners.add(cb);
    return () => entry.listeners.delete(cb);
  }

  /**
   * 为某会话挂接「消息落库」监听器：把 agent 的 message_end（assistant 文本）
   * 与 tool_execution_end（工具调用）持久化进 SQLite。
   * 正常聊天由 main.ts 的 getQueue 负责落库（同时进轮询队列）；
   * 自动化触发没有前端连接，需后端自行挂接，确保「查看会话」显示真实对话。
   * @returns 取消订阅函数
   */
  async attachPersistence(sessionId: string): Promise<() => void> {
    const entry = await this.ensureSession(sessionId);
    const toolArgs = new Map<string, string>();
    const cb = (event: any) => {
      try {
        if (event.type === "tool_execution_start") {
          const toolCallId = event.toolCallId;
          const args = event.args;
          if (toolCallId && args) toolArgs.set(toolCallId, typeof args === "string" ? args : JSON.stringify(args));
        } else if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = (event.message.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          if (text) appendMessage(sessionId, "assistant", text);
        } else if (event.type === "tool_execution_end") {
          const toolCallId = event.toolCallId;
          const argsStr = toolCallId ? toolArgs.get(toolCallId) : undefined;
          if (toolCallId) toolArgs.delete(toolCallId);
          const outputStr = getToolOutputString(event.output);
          if (outputStr) appendMessage(sessionId, "tool", outputStr, { toolName: event.toolName, toolArgs: argsStr, isError: event.isError });
        }
      } catch (e) {
        console.error("[provider] 消息持久化异常:", e);
      }
    };
    entry.listeners.add(cb);
    return () => entry.listeners.delete(cb);
  }

  /**
   * 向某会话广播一个事件（供外部注入非 agent 事件，如工具确认请求 tool_confirmation）。
   * 与 createWorkBuddyAgent 的事件回调走同一条 listeners 通路，
   * 因此 SSE（onEvent 订阅）与 getQueue（onEvent → push queue）都能实时收到。
   */
  emitEvent(sessionId: string, event: AgentEvent): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    for (const cb of entry.listeners) {
      try {
        cb(event);
      } catch (e) {
        console.error("[provider] 事件监听器异常:", e);
      }
    }
  }

  async dispose(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.listeners.clear();
      this.sessions.delete(sessionId);
      console.log(`[provider] 销毁会话 ${sessionId}`);
    }
  }
}

/** 把工具输出规整为可存储的字符串（与 main.ts 的 getToolOutputString 同逻辑） */
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

/** MVP 唯一的 provider 实例 */
export const provider = new LocalPiProvider();

/** 获取底层 Agent（用于内部访问） */
export function getSessionAgent(sessionId: string): Agent | undefined {
  return provider["sessions"].get(sessionId)?.handle.agent;
}

/** 获取某会话当前权限级别 */
export function getSessionPermission(sessionId: string): PermLevel {
  return provider.getPermission(sessionId);
}
