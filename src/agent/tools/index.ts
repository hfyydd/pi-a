// src/agent/tools/index.ts
// 工具注册表。直接用 pi 自带的 read/write/bash/edit（来自 pi-coding-agent）
// 外加我们自己的 memory 工具（pi 没有）

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { memoryRecallTool, memoryWriteTool } from "./memory.ts";

const HOME = Deno.env.get("HOME") || "/tmp";

/** 全量工具（Craft 模式）：pi 的 read/bash/edit/write + memory */
export function getFullTools(): AgentTool<any>[] {
  const codingTools = createCodingTools(HOME); // read, bash, edit, write
  return [...codingTools, memoryRecallTool, memoryWriteTool];
}

/** 只读工具（Plan 模式）：pi 的 read/grep/find/ls + memory_recall */
export function getReadOnlyTools(): AgentTool<any>[] {
  const ro = createReadOnlyTools(HOME); // read, grep, find, ls
  return [...ro, memoryRecallTool];
}

/** 兼容旧接口 */
export function getTools(): AgentTool<any>[] {
  return getFullTools();
}

export { memoryRecallTool, memoryWriteTool };
