import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getDb } from "../../infra/db.ts";
import { sessionContext } from "../../infra/context.ts";
import { provider } from "../provider.ts";
import { createConversation } from "../../domains/session/node/store.ts";

const subagentSchema = Type.Object({
  role: Type.String({ description: "子智能体的角色或定位（如: code_researcher, text_translator）" }),
  task: Type.String({ description: "分配给子智能体的具体任务 and 要求" }),
});

export const callSubagentTool: AgentTool<typeof subagentSchema, any> = {
  name: "call_subagent",
  label: "分派任务",
  description: "分派一个独立的子任务给子智能体，在后台运行并等待其返回最终结果。",
  parameters: subagentSchema,
  execute: async (_id, p) => {
    const { role, task } = p;
    const parentSessionId = sessionContext.getStore()?.sessionId;

    if (!parentSessionId) {
      return {
        content: [{ type: "text", text: "分派失败：未检测到当前会话的上下文" }],
        details: { error: true },
      };
    }

    const db = getDb();

    try {
      // 1. 查询父会话模型与工作空间配置
      const parentConv = db.prepare("SELECT model_provider, model_id, workspace_id FROM conversations WHERE id = ?").get(parentSessionId) as { model_provider: string; model_id: string; workspace_id?: string } | undefined;

      // 2. 创建子会话记录
      const childConv = createConversation(
        `子任务: ${role}`,
        "subagent",
        parentConv?.workspace_id || null,
        parentSessionId
      );

      // 3. 同步父会话的模型配置
      db.prepare("UPDATE conversations SET model_provider = ?, model_id = ? WHERE id = ?").run(
        parentConv?.model_provider || "deepseek",
        parentConv?.model_id || "deepseek-v4-flash",
        childConv.id
      );

      const childSessionId = childConv.id;
      console.log(`[subagent] 已创建子智能体任务会话: ${childSessionId}, 关联父会话: ${parentSessionId}`);

      // 4. 启动子会话任务
      await provider.prompt(childSessionId, task, { mode: "craft", permission: "default" });

      // 4. 轮询等待子会话执行完毕 (done / failed)
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = db.prepare("SELECT status FROM conversations WHERE id = ?").get(childSessionId) as { status: string } | undefined;
        if (status?.status === "done" || status?.status === "failed") {
          break;
        }
      }

      // 5. 提取子会话的最后一条 Assistant 回复作为结果
      const lastMsg = db.prepare(`
        SELECT content FROM messages 
        WHERE conversation_id = ? AND role = 'assistant' 
        ORDER BY created_at DESC LIMIT 1
      `).get(childSessionId) as { content: string } | undefined;

      const result = lastMsg?.content || "(子智能体执行完成，未返回具体回答)";

      return {
        content: [{ type: "text", text: result }],
        details: { childSessionId, success: true },
      };
    } catch (e) {
      console.error("[subagent] 子智能体任务异常:", e);
      return {
        content: [{ type: "text", text: `分派任务发生异常: ${(e as Error).message}` }],
        details: { error: true },
      };
    }
  }
};
