// src/domains/skill/node/store.ts
// 技能文件 CRUD（~/.pi-a/skills/<name>/SKILL.md），供技能编辑器 GUI 用。
// 技能加载/注入仍由 src/agent/skills.ts 的 loadSkillsPrompt 负责。

const HOME = Deno.env.get("HOME") || "/tmp";
export const SKILLS_DIR = `${HOME}/.pi-a/skills`;

/** 内置技能名（不可删除） */
const BUILTIN_NAMES = new Set([
  "weekly-report", "data-analysis", "presentation", "polish-writing", "doc-qa",
]);

export interface SkillMeta {
  name: string;
  description: string;
  body: string;       // markdown 正文（frontmatter 之后）
  builtin: boolean;
  path: string;       // SKILL.md 路径
}

/** 解析 SKILL.md：frontmatter (name/description) + 正文 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: text };
  const fm = m[1];
  const body = m[2].replace(/^\n+/, "");
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description, body };
}

/** 组装 SKILL.md 文本 */
export function serializeSkill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

/** 列出所有技能 */
export async function listSkills(): Promise<SkillMeta[]> {
  try {
    await Deno.mkdir(SKILLS_DIR, { recursive: true });
  } catch { /* 已存在 */ }
  const result: SkillMeta[] = [];
  try {
    for await (const entry of Deno.readDir(SKILLS_DIR)) {
      if (!entry.isDirectory) continue;
      const skillFile = `${SKILLS_DIR}/${entry.name}/SKILL.md`;
      try {
        const text = await Deno.readTextFile(skillFile);
        const parsed = parseSkillFrontmatter(text);
        result.push({
          name: parsed.name || entry.name,
          description: parsed.description || "",
          body: parsed.body,
          builtin: BUILTIN_NAMES.has(entry.name),
          path: skillFile,
        });
      } catch { /* SKILL.md 不存在，跳过 */ }
    }
  } catch (e) {
    console.warn("[skill] 列出技能失败:", e);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** 读单个技能 */
export async function getSkill(name: string): Promise<SkillMeta | null> {
  const skillFile = `${SKILLS_DIR}/${name}/SKILL.md`;
  try {
    const text = await Deno.readTextFile(skillFile);
    const parsed = parseSkillFrontmatter(text);
    return {
      name: parsed.name || name,
      description: parsed.description || "",
      body: parsed.body,
      builtin: BUILTIN_NAMES.has(name),
      path: skillFile,
    };
  } catch {
    return null;
  }
}

/** 保存技能（新建或覆盖）。name 含非法字符拒绝。 */
export async function saveSkill(name: string, description: string, body: string): Promise<SkillMeta> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("技能名只能含字母数字、下划线、连字符");
  const skillDir = `${SKILLS_DIR}/${name}`;
  await Deno.mkdir(skillDir, { recursive: true });
  const content = serializeSkill(name, description, body);
  const skillFile = `${skillDir}/SKILL.md`;
  await Deno.writeTextFile(skillFile, content);
  return { name, description, body, builtin: BUILTIN_NAMES.has(name), path: skillFile };
}

/** 删除技能（内置不可删） */
export async function deleteSkill(name: string): Promise<void> {
  if (BUILTIN_NAMES.has(name)) throw new Error("内置技能不可删除");
  const skillDir = `${SKILLS_DIR}/${name}`;
  await Deno.remove(skillDir, { recursive: true });
}
