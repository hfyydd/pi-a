// src/domains/doc/node/editor.ts
// 文档编辑引擎 (Layer 1 JS) + 历史版本备份逻辑。
// 对照 04 文档 §4.3: edit_docx(模板) / edit_xlsx。

import Pizzip from "pizzip";
import Docxtemplater from "docxtemplater";
import excelMod from "exceljs";
// @ts-ignore
const ExcelJS = excelMod.default || excelMod;
import {
  getArtifactByPath,
  createArtifact,
  getNextVersion,
  createArtifactVersion,
} from "../../artifact/node/store.ts";

const HOME = Deno.env.get("HOME") ?? "/tmp";
const VERSIONS_DIR = `${HOME}/.pi-a/artifacts/.versions`;

/** 确保版本备份目录存在 */
async function ensureVersionsDir(): Promise<void> {
  try {
    await Deno.mkdir(VERSIONS_DIR, { recursive: true });
  } catch { /* 已存在 */ }
}

/**
 * 在编辑前备份当前工件为一个历史版本。
 * @param filePath 绝对文件路径
 * @param conversationId 会话 ID（用于新工件关联）
 * @returns 备份的版本号，失败返回 -1
 */
export async function createBackupVersion(filePath: string, conversationId?: string): Promise<number> {
  try {
    await ensureVersionsDir();

    // 1. 获取或创建工件记录
    let artifact = getArtifactByPath(filePath);
    if (!artifact) {
      const fileName = filePath.split("/").pop() || filePath;
      const stat = await Deno.stat(filePath).catch(() => ({ size: 0 }));
      artifact = createArtifact({
        conversationId,
        fileName,
        filePath,
        bytes: stat.size,
      });
    }

    const artifactId = artifact.id;
    const nextVer = getNextVersion(artifactId);

    // 2. 复制文件到版本备份库
    const ext = filePath.split(".").pop()?.toLowerCase() || "tmp";
    const backupPath = `${VERSIONS_DIR}/${artifactId}_v${nextVer}.${ext}`;
    await Deno.copyFile(filePath, backupPath);

    // 3. 写入数据库
    createArtifactVersion(artifactId, nextVer, backupPath);
    console.log(`[editor] 成功备份工件版本: ${filePath} -> v${nextVer} (${backupPath})`);
    return nextVer;
  } catch (e) {
    console.warn("[editor] 创建历史备份版本失败:", (e as Error).message);
    return -1;
  }
}

/**
 * 编辑 Excel 表格 (exceljs 读-改-写)
 */
export async function editXlsx(filePath: string, changes: any[]): Promise<string> {
  // @ts-ignore
  const workbook = new ExcelJS.Workbook();
  const buf = await Deno.readFile(filePath);
  // @ts-ignore
  await workbook.xlsx.load(buf as any);

  for (const c of changes) {
    if (c.op === "add_sheet") {
      workbook.addWorksheet(c.name);
    } else {
      const sheet = workbook.getWorksheet(c.sheet);
      if (!sheet) throw new Error(`找不到工作表: "${c.sheet}"`);

      if (c.op === "set_cell") {
        const cell = sheet.getCell(c.cell);
        if (c.formula) {
          cell.value = { formula: c.formula, result: c.value };
        } else {
          cell.value = c.value;
        }
      } else if (c.op === "add_row") {
        sheet.addRow(c.row);
      }
    }
  }

  const newBuf = await workbook.xlsx.writeBuffer();
  await Deno.writeFile(filePath, new Uint8Array(newBuf as any));
  return filePath;
}

/**
 * 模板填充 Word 文档 (docxtemplater)
 */
export async function editDocxTemplate(
  filePath: string,
  vars: Record<string, any>,
  outPath?: string,
): Promise<string> {
  const content = await Deno.readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(content);
  // @ts-ignore
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: "{{",
      end: "}}",
    },
  });
  doc.render(vars);
  const buf = doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const targetPath = outPath || filePath;
  await Deno.writeFile(targetPath, buf);
  return targetPath;
}

/** XML 转义 */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** docx 自由编辑操作（结构化 op 驱动，对照 08 计划功能11） */
export type DocxOp =
  | { op: "replace_text"; from: string; to: string }
  | { op: "insert_paragraph"; afterMatch: string; text: string; heading?: "h1" | "h2" | "normal" }
  | { op: "delete_paragraph"; match: string };

/**
 * 自由编辑 Word 文档（pizzip 直接操作 word/document.xml，保真度高）。
 * 支持：替换文本、在某段后插入段落、删除含某文本的段落。复杂样式保留。
 */
export async function editDocxFree(filePath: string, ops: DocxOp[]): Promise<string> {
  const buf = await Deno.readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("文档格式异常：找不到 word/document.xml");
  let xml = docFile.asText();
  for (const o of ops) {
    if (o.op === "replace_text") {
      xml = xml.split(escapeXml(o.from)).join(escapeXml(o.to));
    } else if (o.op === "delete_paragraph") {
      const m = escapeXml(o.match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`<w:p[^>]*>[\\s\\S]*?${m}[\\s\\S]*?</w:p>`, "g");
      xml = xml.replace(re, "");
    } else if (o.op === "insert_paragraph") {
      const m = escapeXml(o.afterMatch).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const style = o.heading === "h1" ? '<w:pStyle w:val="Heading1"/>'
        : o.heading === "h2" ? '<w:pStyle w:val="Heading2"/>' : "";
      const newP = `<w:p>${style ? `<w:pPr>${style}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(o.text)}</w:t></w:r></w:p>`;
      const re = new RegExp(`(<w:p[^>]*>[\\s\\S]*?${m}[\\s\\S]*?</w:p>)`, "g");
      xml = xml.replace(re, `$1${newP}`);
    }
  }
  zip.file("word/document.xml", xml);
  const out = zip.generate({ type: "nodebuffer" });
  await Deno.writeFile(filePath, out);
  return filePath;
}

/** pptx 编辑操作 */
export type PptxOp =
  | { op: "replace_text"; slide: number; from: string; to: string };

/**
 * 编辑 PPT 演示文稿（pizzip 操作 ppt/slides/slideN.xml）。
 * 支持：替换某页文本。（duplicate_slide 涉及 rels/Content_Types 较复杂，留 P2）
 */
export async function editPptx(filePath: string, ops: PptxOp[]): Promise<string> {
  const buf = await Deno.readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(buf);
  for (const o of ops) {
    if (o.op === "replace_text") {
      const file = `ppt/slides/slide${o.slide}.xml`;
      const f = zip.file(file);
      if (!f) throw new Error(`幻灯片第 ${o.slide} 页不存在`);
      let sxml = f.asText();
      sxml = sxml.split(escapeXml(o.from)).join(escapeXml(o.to));
      zip.file(file, sxml);
    }
  }
  const out = zip.generate({ type: "nodebuffer" });
  await Deno.writeFile(filePath, out);
  return filePath;
}
