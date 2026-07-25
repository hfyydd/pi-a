// src/agent/tools/task.ts
// Subagent Task 工具：主 Agent 通过 task 工具调用子 Agent
// 对照 WorkBuddy 的 Task/code-explorer 机制（WorkBuddy 在 CLI 内 fork，我们用 pi Agent 创建临时实例）
// 设计：task 工具接收 description + prompt，创建一个独立 Agent（无工具/只读工具），
//       执行一轮后返回结果给主 Agent

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModels, listAllProviders } from "../models.ts";
import { getApiKey } from "../../infra/keychain.ts";
import { createReadOnlyTools } from "@earendil-works/pi-coding-agent";

const HOME = Deno.env.get("HOME") || "/tmp";

const taskSchema = Type.Object({
  description: Type.String({ description: "子任务描述（一句话，如「搜索代码库中所有 TODO」）" }),
  prompt: Type.String({ description: "给子 Agent 的详细指令" }),
});

export const taskTool: AgentTool<typeof taskSchema, { tokens: number }> = {
  name: "task",
  label: "子任务",
  description:
    "启动一个子 Agent 执行隔离任务。子 Agent 有自己的上下文（不影响主对话），只读工具（read/grep/find/ls/web_fetch/web_search）。执行完毕后返回结果摘要。适合：大范围搜索、独立分析、并行调研。",
  parameters: taskSchema,
  execute: async (_id, p) => {
    try {
      const models = getModels();
      // 子 Agent 用 deepseek-v4-flash（快速模型）
      let model = models.getModel("deepseek", "deepseek-v4-flash");
      if (!model) {
        // 兜底：跨已注册 provider 拿第一个可用模型
        for (const p of listAllProviders()) {
          if (p.models && p.models.length > 0) {
            model = models.getModel(p.provider, p.models[0].id);
            if (model) break;
          }
        }
      }
      if (!model) {
        return {
          content: [{ type: "text", text: "子任务失败：无可用模型" }],
          details: { tokens: 0 },
        };
      }

      const roTools = createReadOnlyTools(HOME);

      // 收集子 Agent 的输出
      let output = "";
      const subAgent = new Agent({
        initialState: {
          model,
          systemPrompt: `你是 Pi-a 的子任务执行器。你的任务是：${p.description}\n\n请高效执行，给出简洁结论。不要寒暄，直接返回结果。`,
          tools: roTools,
        },
        streamFn: (m, ctx, o) => models.streamSimple(m, ctx, o),
        getApiKey: async (provider: string) => (await getApiKey(provider)) ?? undefined,
        toolExecution: "sequential",
      });

      subAgent.subscribe(async (event: any) => {
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = (event.message.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          if (text) output = text;
        }
      });

      // 执行子任务（等待完成）
      await subAgent.prompt(p.prompt);

      const tokens = output.length; // 粗估

      return {
        content: [{ type: "text", text: output || "(子任务无输出)" }],
        details: { tokens },
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `子任务执行失败: ${e instanceof Error ? e.message : String(e)}` }],
        details: { tokens: 0 },
      };
    }
  },
};
