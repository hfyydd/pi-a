// src/agent/tools/memory.ts
// memory_recall / memory_write 工具

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { writeMemory, recallMemories } from "../../domains/memory/node/store.ts";

const recallSchema = Type.Object({}, { description: "无参数，召回所有记忆" });

export const memoryRecallTool: AgentTool<typeof recallSchema, { count: number }> = {
  name: "memory_recall",
  label: "回忆",
  description: "召回用户的长期记忆（跨会话的事实/偏好）。无需参数，返回所有记忆。",
  parameters: recallSchema,
  execute: async () => {
    const mems = recallMemories();
    const text = mems.length === 0
      ? "(暂无记忆)"
      : mems.map((m) => `- [${m.kind}] ${m.content}`).join("\n");
    return {
      content: [{ type: "text", text }],
      details: { count: mems.length },
    };
  },
};

const writeSchema = Type.Object({
  content: Type.String({ description: "要记住的内容" }),
  kind: Type.Optional(Type.String({ description: "记忆类型: fact/preference/note，默认 fact" })),
});

export const memoryWriteTool: AgentTool<typeof writeSchema, { id: string }> = {
  name: "memory_write",
  label: "记住",
  description: "把一条信息写入长期记忆（跨会话保留）。用于记住用户的事实、偏好等。提供 content 和可选 kind。",
  parameters: writeSchema,
  execute: async (_id, p) => {
    const mem = writeMemory(p.content, p.kind);
    return {
      content: [{ type: "text", text: `✓ 已记住: ${mem.content}` }],
      details: { id: mem.id },
    };
  },
};
