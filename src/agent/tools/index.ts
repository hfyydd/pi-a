// src/agent/tools/index.ts
// 工具注册表。pi 极简哲学：read / write / bash + memory + 文档工具
// 对照 pi-mono coding-agent 的工具集

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { memoryRecallTool, memoryWriteTool } from "./memory.ts";
import { readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool } from "./doc.ts";
import { webFetchTool, webSearchTool } from "./web.ts";

const HOME = Deno.env.get("HOME") || "/tmp";

// MCP 工具（异步加载，连接后填充）
let mcpTools: AgentTool<any>[] = [];

/** 设置 MCP 工具（启动时连接 MCP server 后调用） */
export function setMcpTools(tools: AgentTool<any>[]): void {
  mcpTools = tools;
}

/** 全量工具（Craft 模式）：pi 的 read/bash/edit/write + memory + 文档 + 联网 + MCP */
export function getFullTools(): AgentTool<any>[] {
  const codingTools = createCodingTools(HOME); // read, bash, edit, write
  return [
    ...codingTools,
    memoryRecallTool,
    memoryWriteTool,
    readDocTool,
    writeDocxTool,
    writeXlsxTool,
    writePptxTool,
    editDocxTool,
    editXlsxTool,
    webFetchTool,
    webSearchTool,
    ...mcpTools,
  ];
}

/** 只读工具（Plan 模式） */
export function getReadOnlyTools(): AgentTool<any>[] {
  const ro = createReadOnlyTools(HOME);
  return [...ro, memoryRecallTool, readDocTool, webFetchTool, webSearchTool];
}

/** 兼容旧接口 */
export function getTools(): AgentTool<any>[] {
  return getFullTools();
}

export { memoryRecallTool, memoryWriteTool, readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool, webFetchTool, webSearchTool };
