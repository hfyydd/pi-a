// src/agent/tools/index.ts
// 工具注册表。pi 极简哲学：read / write / bash + memory + 文档工具
// 对照 pi-mono coding-agent 的工具集

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { memoryRecallTool, memoryWriteTool } from "./memory.ts";
import { readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool, editDocxFreeTool, editPptxTool } from "./doc.ts";
import { webFetchTool, webSearchTool } from "./web.ts";
import { screenshotTool, mouseClickTool, mouseMoveTool, keyTypeTool, appFocusTool, cursorPosTool } from "./os.ts";
import { indexDocTool, searchDocsTool } from "./rag.ts";
import { taskTool } from "./task.ts";
import { sandboxedBashTool } from "./sandbox.ts";
import { callSubagentTool } from "./subagent.ts";
import { askUserQuestionTool } from "./ask.ts";
import { connectCloudServiceTool } from "./connect_cloud_service.ts";

const HOME = Deno.env.get("HOME") || "/tmp";

// MCP 工具（异步加载，连接后填充）
let mcpTools: AgentTool<any>[] = [];

/** 设置 MCP 工具（启动时连接 MCP server 后调用） */
export function setMcpTools(tools: AgentTool<any>[]): void {
  mcpTools = tools;
}

/** 全量工具（Craft 模式）：pi 的 read/bash/edit/write + memory + 文档 + 联网 + MCP */
export function getFullTools(): AgentTool<any>[] {
  const rawCodingTools = createCodingTools(HOME); // read, bash, edit, write
  const codingTools = [
    ...rawCodingTools.filter(t => t.name !== "bash"),
    sandboxedBashTool
  ];
  return [
    ...codingTools,
    callSubagentTool,
    memoryRecallTool,
    memoryWriteTool,
    readDocTool,
    writeDocxTool,
    writeXlsxTool,
    writePptxTool,
    editDocxTool,
    editXlsxTool,
    editDocxFreeTool,
    editPptxTool,
    webFetchTool,
    webSearchTool,
    // Computer Use 工具（功能13）
    screenshotTool,
    mouseClickTool,
    mouseMoveTool,
    keyTypeTool,
    appFocusTool,
    cursorPosTool,
    // RAG 工具（功能18）
    indexDocTool,
    searchDocsTool,
    taskTool,
    // 交互式提问（对标 WorkBuddy AskUserQuestion）
    askUserQuestionTool,
    connectCloudServiceTool,
    ...mcpTools,
  ];
}

/** 只读工具（Plan 模式） */
export function getReadOnlyTools(): AgentTool<any>[] {
  const ro = createReadOnlyTools(HOME);
  return [...ro, memoryRecallTool, readDocTool, webFetchTool, webSearchTool, askUserQuestionTool, connectCloudServiceTool];
}

/** 兼容旧接口 */
export function getTools(): AgentTool<any>[] {
  return getFullTools();
}

export { memoryRecallTool, memoryWriteTool, readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool, editDocxFreeTool, editPptxTool, webFetchTool, webSearchTool, screenshotTool, mouseClickTool, mouseMoveTool, keyTypeTool, appFocusTool, cursorPosTool, indexDocTool, searchDocsTool, sandboxedBashTool, callSubagentTool, askUserQuestionTool, connectCloudServiceTool };
