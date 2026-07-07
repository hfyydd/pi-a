// src/agent/tools/doc.ts
// 文档工具：read_doc / write_docx / write_xlsx / write_pptx
// 包装 domains/doc 的 reader/writer 为 pi AgentTool
// 这些工具生成格式化文档（结构化 JSON → docx/xlsx/pptx），与 pi 的 write（纯文本）互补

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { readDoc } from "../../domains/doc/node/reader.ts";
import { writeDocx, writeXlsx, writePptx } from "../../domains/doc/node/writer.ts";
import type { DocxSection, XlsxSheet, PptxSlide } from "../../domains/doc/node/writer.ts";
import { createArtifact } from "../../domains/artifact/node/store.ts";

// ===== read_doc：读文档（比 pi read 更强，支持 docx/xlsx/csv 结构化解析） =====
const readDocSchema = Type.Object({
  path: Type.String({ description: "文件路径（支持 ~ 路径，如 ~/Desktop/report.xlsx）" }),
});

export const readDocTool: AgentTool<typeof readDocSchema, { kind: string; truncated: boolean }> = {
  name: "read_doc",
  label: "读文档",
  description:
    "读取文档内容，支持 docx/xlsx/csv/md/json/txt。xlsx 和 csv 会解析成表格格式，docx 提取纯文本。比 read 工具更适合读 Office 文档。",
  parameters: readDocSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    const result = await readDoc(fullPath);
    return {
      content: [{ type: "text", text: `[${result.kind}] ${result.text}` }],
      details: { kind: result.kind, truncated: result.truncated },
    };
  },
};

// ===== write_docx：生成 Word 文档 =====
const writeDocxSchema = Type.Object({
  fileName: Type.String({ description: "文件名，如 周报.docx" }),
  title: Type.Optional(Type.String({ description: "文档标题" })),
  sections: Type.Array(
    Type.Object({
      heading: Type.Optional(Type.String()),
      paragraphs: Type.Optional(Type.Array(Type.String())),
      bullets: Type.Optional(Type.Array(Type.String())),
    }),
    { description: "章节列表，每节可有标题/段落/要点" },
  ),
});

export const writeDocxTool: AgentTool<typeof writeDocxSchema, { path: string }> = {
  name: "write_docx",
  label: "生成 Word",
  description:
    "生成 Word 文档(.docx)。提供 fileName、可选 title、sections（章节列表，每节可有 heading/paragraphs/bullets）。文件存到 ~/.pi-a/artifacts/。",
  parameters: writeDocxSchema,
  execute: async (_id, p) => {
    const path = await writeDocx(p.title, p.sections as DocxSection[], p.fileName);
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 Word 文档：${path}` }],
      details: { path },
    };
  },
};

// ===== write_xlsx：生成 Excel 表格 =====
const writeXlsxSchema = Type.Object({
  fileName: Type.String({ description: "文件名，如 data.xlsx" }),
  sheets: Type.Array(
    Type.Object({
      name: Type.String({ description: "工作表名" }),
      headers: Type.Optional(Type.Array(Type.String())),
      rows: Type.Array(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Null()]))),
    }),
    { description: "工作表列表" },
  ),
});

export const writeXlsxTool: AgentTool<typeof writeXlsxSchema, { path: string }> = {
  name: "write_xlsx",
  label: "生成 Excel",
  description:
    "生成 Excel 表格(.xlsx)。提供 fileName 和 sheets（每个 sheet 有 name/可选 headers/rows 二维数组）。文件存到 ~/.pi-a/artifacts/。",
  parameters: writeXlsxSchema,
  execute: async (_id, p) => {
    const path = await writeXlsx(p.sheets as XlsxSheet[], p.fileName);
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 Excel 表格：${path}` }],
      details: { path },
    };
  },
};

// ===== write_pptx：生成 PPT 演示文稿 =====
const writePptxSchema = Type.Object({
  fileName: Type.String({ description: "文件名，如 季度汇报.pptx" }),
  slides: Type.Array(
    Type.Object({
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      bullets: Type.Optional(Type.Array(Type.String())),
    }),
    { description: "幻灯片列表，每页可有 title/body/bullets" },
  ),
});

export const writePptxTool: AgentTool<typeof writePptxSchema, { path: string }> = {
  name: "write_pptx",
  label: "生成 PPT",
  description:
    "生成 PowerPoint 演示文稿(.pptx)。提供 fileName 和 slides（每页可有 title/body/bullets）。文件存到 ~/.pi-a/artifacts/。",
  parameters: writePptxSchema,
  execute: async (_id, p) => {
    const path = await writePptx(p.slides as PptxSlide[], p.fileName);
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 PPT 演示文稿：${path}` }],
      details: { path },
    };
  },
};

import { editXlsx, editDocxTemplate, createBackupVersion } from "../../domains/doc/node/editor.ts";
import { getDb } from "../../infra/db.ts";
import { getArtifactByPath } from "../../domains/artifact/node/store.ts";

// ===== edit_xlsx：编辑 Excel 表格 =====
const editXlsxSchema = Type.Object({
  path: Type.String({ description: "Excel 文件路径（支持 ~ 路径）" }),
  changes: Type.Array(
    Type.Object({
      op: Type.Union([Type.Literal("set_cell"), Type.Literal("add_row"), Type.Literal("add_sheet")]),
      sheet: Type.Optional(Type.String({ description: "工作表名称，add_sheet 模式下可选" })),
      cell: Type.Optional(Type.String({ description: "单元格位置，如 A1，仅 set_cell 模式需要" })),
      value: Type.Optional(Type.Any({ description: "单元格的值，仅 set_cell 模式需要" })),
      formula: Type.Optional(Type.String({ description: "单元格的公式，可选，仅 set_cell 模式需要" })),
      row: Type.Optional(Type.Array(Type.Any({ description: "整行数据数组，仅 add_row 模式需要" }))),
      name: Type.Optional(Type.String({ description: "工作表名称，仅 add_sheet 模式需要" })),
    }),
    { description: "修改操作列表" },
  ),
});

export const editXlsxTool: AgentTool<typeof editXlsxSchema, { path: string; version: number }> = {
  name: "edit_xlsx",
  label: "编辑 Excel",
  description: "编辑已有的 Excel 表格。支持 set_cell (修改单元格)、add_row (追加行)、add_sheet (新建表)。在修改前，会自动将当前状态备份存为历史版本。",
  parameters: editXlsxSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    
    // 获取当前活跃会话 ID
    const db = getDb();
    const activeConv = db.prepare("SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined;
    const sessionId = activeConv?.id;

    // 创建历史版本备份
    const version = await createBackupVersion(fullPath, sessionId);

    // 执行修改
    await editXlsx(fullPath, p.changes);

    // 更新工件大小记录
    const stat = await Deno.stat(fullPath).catch(() => ({ size: 0 }));
    const art = getArtifactByPath(fullPath);
    if (art) {
      db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(stat.size, art.id);
    }

    return {
      content: [{ type: "text", text: `已成功编辑 Excel 表格：${fullPath} (已自动备份原版本为 v${version})` }],
      details: { path: fullPath, version },
    };
  },
};

// ===== edit_docx：编辑 Word 文档 (模板填充) =====
const editDocxSchema = Type.Object({
  path: Type.String({ description: "Word 文档路径（支持 ~ 路径，作为模版文件）" }),
  vars: Type.Record(Type.String(), Type.Any(), { description: "模版中占位符 {{key}} 对应替换的值" }),
  outFileName: Type.Optional(Type.String({ description: "输出文件名，若不提供则原地覆盖原有文件并存为新版本" })),
});

export const editDocxTool: AgentTool<typeof editDocxSchema, { path: string; version: number }> = {
  name: "edit_docx",
  label: "编辑 Word",
  description: "使用模板方式编辑 Word 文档。利用 vars 字典替换文档中的 {{key}} 占位符。在修改前，会自动将当前状态备份存为历史版本。",
  parameters: editDocxSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    
    // 获取当前活跃会话 ID
    const db = getDb();
    const activeConv = db.prepare("SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined;
    const sessionId = activeConv?.id;

    let targetPath = fullPath;
    let version = -1;

    if (p.outFileName) {
      // 写入新文件
      const { artifactPath } = await import("../../domains/doc/node/paths.ts");
      targetPath = artifactPath(p.outFileName);
      await editDocxTemplate(fullPath, p.vars, targetPath);
      // 注册为新工件
      const stat = await Deno.stat(targetPath).catch(() => ({ size: 0 }));
      createArtifact({
        conversationId: sessionId,
        fileName: p.outFileName,
        filePath: targetPath,
        bytes: stat.size,
      });
    } else {
      // 原地修改：先备份
      version = await createBackupVersion(fullPath, sessionId);
      await editDocxTemplate(fullPath, p.vars);
      // 更新大小
      const stat = await Deno.stat(fullPath).catch(() => ({ size: 0 }));
      const art = getArtifactByPath(fullPath);
      if (art) {
        db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(stat.size, art.id);
      }
    }

    return {
      content: [{ type: "text", text: `已成功生成/编辑 Word 文档：${targetPath} ${version !== -1 ? `(已自动备份原版本为 v${version})` : ""}` }],
      details: { path: targetPath, version },
    };
  },
};

/** 注册工件到 DB（便于 UI 列出和预览） */
function trackArtifact(path: string): void {
  try {
    const fileName = path.split("/").pop() || path;
    createArtifact({ fileName, filePath: path });
  } catch (e) {
    console.warn("[doc] 工件注册失败:", e);
  }
}

/** 展开 ~ 路径 */
function resolvePath(p: string): string {
  if (p.startsWith("~/")) return (Deno.env.get("HOME") || "") + p.slice(1);
  if (p === "~") return Deno.env.get("HOME") || "";
  return p;
}
