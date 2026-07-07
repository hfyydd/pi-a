// src/domains/doc/node/reader.ts
// 文档读取引擎。对照 04 文档 §四：read_doc 工具的实现层。
// 支持: txt/md/json/csv(纯文本) + docx(mammoth) + xlsx(exceljs)
// pdf 暂不支持（pdf-parse 在 Deno 兼容性未验，P1）

const MAX_CHARS = 50_000;

export interface ReadResult {
  kind: string; // text|markdown|json|csv|docx|xlsx|error
  text: string;
  truncated: boolean;
  tables?: string[][]; // 表格类文档的结构化数据（xlsx/csv）
}

/** 统一读取入口：按扩展名路由 */
export async function readDoc(path: string): Promise<ReadResult> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  try {
    switch (ext) {
      case "txt":
        return readText(path, "text");
      case "md":
      case "markdown":
        return readText(path, "markdown");
      case "json":
        return readText(path, "json");
      case "csv":
        return await readCsv(path);
      case "docx":
        return await readDocx(path);
      case "xlsx":
        return await readXlsx(path);
      default:
        // 未知扩展名尝试当文本读
        return await readText(path, "text");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "error", text: `读取失败 (${ext}): ${msg}`, truncated: false };
  }
}

async function readText(path: string, kind: string): Promise<ReadResult> {
  const raw = await Deno.readTextFile(path);
  return truncate(raw, kind);
}

function truncate(raw: string, kind: string): ReadResult {
  const truncated = raw.length > MAX_CHARS;
  const text = truncated ? raw.slice(0, MAX_CHARS) + "\n...[已截断]" : raw;
  return { kind, text, truncated };
}

/** CSV：解析成表格，也返回纯文本表示 */
async function readCsv(path: string): Promise<ReadResult> {
  const raw = await Deno.readTextFile(path);
  const tables = parseCsv(raw);
  const text = tables.map((row) => row.join("\t")).join("\n");
  const r = truncate(text, "csv");
  return { ...r, tables: tables.slice(0, 100) }; // 限 100 行
}

function parseCsv(text: string): string[][] {
  // 简易 CSV 解析（支持逗号分隔，带引号）。生产可换 papaparse
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** docx：mammoth 转 HTML，再剥成纯文本 */
async function readDocx(path: string): Promise<ReadResult> {
  const mammoth = await import("mammoth");
  const buf = await Deno.readFile(path);
  // @ts-ignore mammouth 默认导出
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return truncate(result.value || "(空文档)", "docx");
}

/** xlsx：exceljs 读所有 sheet，转成 markdown 表格文本 */
async function readXlsx(path: string): Promise<ReadResult> {
  const ExcelJS = await import("exceljs");
  const buf = await Deno.readFile(path);
  // @ts-ignore exceljs 在 Deno 的类型不完全匹配
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as any);

  const parts: string[] = [];
  const allTables: string[][] = [];

  workbook.eachSheet((sheet: any) => {
    parts.push(`## ${sheet.name}`);
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      const vals = row.values as any[];
      // exceljs 的 values 数组从 index 1 开始
      const cells = (vals.slice(1) || []).map((v) => v?.toString?.() ?? "");
      rows.push(cells);
      parts.push("| " + cells.join(" | ") + " |");
    });
    parts.push("");
    allTables.push(...rows.slice(0, 50));
  });

  return truncate(parts.join("\n"), "xlsx");
}
