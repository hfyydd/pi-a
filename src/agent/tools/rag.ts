// src/agent/tools/rag.ts
// RAG 工具：index_doc + search_docs（对照 08 计划功能18）

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { indexDoc, searchChunks } from "../../domains/rag/node/store.ts";

const indexSchema = Type.Object({
  path: Type.String({ description: "要索引的文档路径（支持 ~）" }),
});

export const indexDocTool: AgentTool<typeof indexSchema, { chunks: number }> = {
  name: "index_doc",
  label: "建立索引",
  description: "为文档建立 RAG 索引（分块 + 关键词）。索引后可用 search_docs 检索相关片段。支持 txt/md/docx/xlsx/pdf 等。长文档问答前先建索引。",
  parameters: indexSchema,
  execute: async (_id, p) => {
    const path = p.path.startsWith("~/") ? (Deno.env.get("HOME") || "") + p.path.slice(1) : p.path;
    try {
      const n = await indexDoc(path);
      return {
        content: [{ type: "text", text: n > 0 ? `✓ 已索引 ${n} 个块：${path}` : `❌ 文档为空或读取失败：${path}` }],
        details: { chunks: n },
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 索引失败：${(e as Error).message}` }], details: { chunks: 0 } };
    }
  },
};

const searchSchema = Type.Object({
  query: Type.String({ description: "检索查询" }),
  path: Type.Optional(Type.String({ description: "限定在某文档内检索（支持 ~ 路径）" })),
  topK: Type.Optional(Type.Number({ description: "返回块数，默认 5" })),
});

export const searchDocsTool: AgentTool<typeof searchSchema, { count: number }> = {
  name: "search_docs",
  label: "文档检索",
  description: "在已索引文档中检索相关片段（RAG）。适合长文档精准问答，避免整文件喂入超上下文。文档需先用 index_doc 建立索引。",
  parameters: searchSchema,
  execute: async (_id, p) => {
    const path = p.path?.startsWith("~/") ? (Deno.env.get("HOME") || "") + p.path.slice(1) : p.path;
    try {
      const chunks = await searchChunks(p.query, path, p.topK ?? 5);
      const text = chunks.length === 0
        ? "(无匹配片段。可能文档未建立索引，先调 index_doc)"
        : chunks.map((c, i) => `[${i + 1}] (相关度:${c.score.toFixed(2)} | ${c.docPath}#${c.chunkIndex})\n${c.text}`).join("\n\n");
      return { content: [{ type: "text", text }], details: { count: chunks.length } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 检索失败：${(e as Error).message}` }], details: { count: 0 } };
    }
  },
};
