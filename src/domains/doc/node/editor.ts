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
