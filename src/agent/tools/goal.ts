// src/agent/tools/goal.ts
// pi-goal：目标驱动强校验模式工具 (Goal Verification Tool)

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const goalCompleteSchema = Type.Object({
  success: Type.Boolean({ description: "目标是否已完全达标且验证通过" }),
  summary: Type.String({ description: "目标完成成果摘要" }),
  proof: Type.String({ description: "验证通过的具体依据/断言结果/输出文件路径" }),
});

export const goalCompleteTool: AgentTool<typeof goalCompleteSchema, any> = {
  name: "goal_complete",
  label: "目标完成校验",
  description: "【目标驱动模式强制工具】当且仅当目标完全达成并经过代码或结果断言验证通过后，调用此工具宣告目标成功闭环。",
  parameters: goalCompleteSchema,
  execute: async (_id, p) => {
    console.log(`[pi-goal] 目标完成校验: success=${p.success}, proof=${p.proof}`);
    return {
      content: [
        {
          type: "text",
          text: p.success
            ? `🎯 [目标完成强校验通过]: ${p.summary}\n验证凭据: ${p.proof}`
            : `❌ [目标未能闭环]: ${p.summary}`,
        },
      ],
      details: { success: p.success, proof: p.proof },
    };
  },
};
