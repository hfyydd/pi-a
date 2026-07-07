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
import { updateConversationStatus } from "../domains/session/node/store.ts";

/** 执行模式：Ask=仅问答 / Plan=先方案 / Craft=直接执行 */
export type RunMode = "ask" | "plan" | "craft";

/** 权限级别：default=写操作需确认 / full=全放行 */
export type PermLevel = "default" | "full";

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
  onEvent(sessionId: string, cb: (e: AgentEvent) => void): () => void;
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

  private ensureSession(sessionId: string): SessionEntry {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      const listeners = new Set<(e: AgentEvent) => void>();
      
      // 查询会话的模型配置
      const db = getDb();
      const conv = db.prepare("SELECT model_provider, model_id FROM conversations WHERE id = ?").get(sessionId) as { model_provider: string; model_id: string } | undefined;
      
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
      });
      entry = { handle, listeners, lastOpts: DEFAULT_OPTS };
      this.sessions.set(sessionId, entry);
      console.log(`[provider] 创建会话 ${sessionId} (模型: ${conv?.model_provider || "deepseek"}/${conv?.model_id || "deepseek-v4-flash"})`);
    }
    return entry;
  }

  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<void> {
    const entry = this.ensureSession(sessionId);
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

    agent.prompt(text).then(() => {
      console.log(`[provider] 会话 ${sessionId} prompt 完成`);
      updateConversationStatus(sessionId, "done");
    }).catch((e) => {
      console.error(`[provider] 会话 ${sessionId} prompt 失败:`, e?.message || e);
      updateConversationStatus(sessionId, "failed");
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

  onEvent(sessionId: string, cb: (e: AgentEvent) => void): () => void {
    const entry = this.ensureSession(sessionId);
    entry.listeners.add(cb);
    return () => entry.listeners.delete(cb);
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
