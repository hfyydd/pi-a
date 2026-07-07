// src/domains/doc/node/paths.ts
// 文档落盘路径管理（artifacts 目录）

const HOME = Deno.env.get("HOME") ?? "/tmp";
const DATA_DIR = `${HOME}/.pi-a`;
const ARTIFACTS_DIR = `${DATA_DIR}/artifacts`;

/** 确保 artifacts 目录存在 */
export async function ensureArtifactsDir(): Promise<void> {
  try {
    await Deno.mkdir(ARTIFACTS_DIR, { recursive: true });
  } catch { /* 已存在 */ }
}

/** 生成 artifact 完整路径（自动加时间戳防覆盖） */
export function artifactPath(fileName: string): string {
  // 若 fileName 是绝对路径，直接用；否则拼到 artifacts 下
  if (fileName.startsWith("/")) return fileName;
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // 在文件名插入时间戳：report.docx → report-20260705.docx
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = fileName.slice(0, dotIdx);
    const ext = fileName.slice(dotIdx);
    return `${ARTIFACTS_DIR}/${base}-${ts}${ext}`;
  }
  return `${ARTIFACTS_DIR}/${fileName}-${ts}`;
}

export const artifactsDir = ARTIFACTS_DIR;
