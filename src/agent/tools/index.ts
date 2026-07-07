// src/agent/tools/index.ts
// 工具注册表。pi 极简哲学：read / write / bash + memory + 文档工具
// 对照 pi-mono coding-agent 的工具集

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodingTools, createReadOnlyTools } from "@earendil-works/pi-coding-agent";
import { memoryRecallTool, memoryWriteTool } from "./memory.ts";
import { readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool } from "./doc.ts";

const HOME = Deno.env.get("HOME") || "/tmp";

/** 全量工具（Craft 模式）：pi 的 read/bash/edit/write + memory + 文档 */
export function getFullTools(): AgentTool<any>[] {
  const codingTools = createCodingTools(HOME); // read, bash, edit, write
  return [
    ...codingTools,
    memoryRecallTool,
    memoryWriteTool,
    readDocTool,        // 读文档（docx/xlsx/csv 结构化解析）
    writeDocxTool,      // 生成 Word
    writeXlsxTool,      // 生成 Excel
    writePptxTool,      // 生成 PPT
    editDocxTool,       // 编辑 Word (模板)
    editXlsxTool,       // 编辑 Excel
  ];
}

/** 只读工具（Plan 模式）：pi 的 read/grep/find/ls + memory_recall + read_doc */
export function getReadOnlyTools(): AgentTool<any>[] {
  const ro = createReadOnlyTools(HOME); // read, grep, find, ls
  return [...ro, memoryRecallTool, readDocTool];
}

/** 兼容旧接口 */
export function getTools(): AgentTool<any>[] {
  return getFullTools();
}

export { memoryRecallTool, memoryWriteTool, readDocTool, writeDocxTool, writeXlsxTool, writePptxTool, editDocxTool, editXlsxTool };
