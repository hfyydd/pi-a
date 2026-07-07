// src/agent/skills.ts
// 技能系统：扫描 SKILL.md，注入系统提示（对照 pi 的 skills.ts）
// 兼容 agentskills.io 格式：SKILL.md 含 frontmatter (name/description) + 正文

import { loadSkills, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";

const HOME = Deno.env.get("HOME") || "/tmp";
/** 技能目录：~/.pi-a/skills/（用户技能） */
const SKILLS_DIR = `${HOME}/.pi-a/skills`;

/** 确保技能目录存在 */
export async function ensureSkillsDir(): Promise<void> {
  try {
    await Deno.mkdir(SKILLS_DIR, { recursive: true });
    // 写入 5 个内置技能（首次）
    await writeBuiltinSkills();
  } catch { /* 已存在 */ }
}

/** 加载所有技能，返回格式化后的提示词片段 */
export function loadSkillsPrompt(): string {
  try {
    const result = loadSkills({
      agentDir: `${HOME}/.pi-a`,
      cwd: HOME,
      skillPaths: [SKILLS_DIR],
      includeDefaults: false,
    });
    if (result.skills.length === 0) return "";
    return "\n\n<skills>\n你可以使用以下技能。用户提到相关任务时，按技能描述的方式完成任务：\n" +
      formatSkillsForPrompt(result.skills) +
      "\n</skills>";
  } catch (e) {
    console.warn("[skills] 加载失败:", e);
    return "";
  }
}

/** 写入 5 个内置技能（如果不存在） */
async function writeBuiltinSkills(): Promise<void> {
  const builtins: Record<string, string> = {
    "weekly-report": `---
name: weekly-report
description: 生成结构化的工作周报 Word 文档
---

# 周报技能

当用户要求生成周报时，按以下结构用 write_docx 工具生成：

1. 文档标题：「XX周报（日期范围）」
2. 章节「本周进展」：列出 3-5 个关键完成项（bullet 格式）
3. 章节「下周计划」：列出 2-4 个计划项
4. 章节「风险与问题」：如有则列出，无则省略

文件名格式：周报-YYYYMMDD.docx
`,

    "data-analysis": `---
name: data-analysis
description: 读取表格数据（xlsx/csv）并生成分析摘要
---

# 数据分析技能

当用户要求分析数据时：

1. 用 read_doc 工具读取 xlsx/csv 文件
2. 总结数据概况：行数、列名、数据范围
3. 提取关键洞察：趋势、异常值、汇总统计
4. 如用户需要，用 write_xlsx 生成分析结果表格
`,

    "presentation": `---
name: presentation
description: 根据主题生成多页 PPT 演示文稿
---

# PPT 生成技能

当用户要求做 PPT 时，按以下结构用 write_pptx 生成：

1. 封面页：主题标题
2. 目录页：列出主要章节
3. 内容页：每个章节 1-2 页，含标题 + 3-5 个要点
4. 总结页：关键结论

每页 bullets 不超过 5 条，语言简洁。文件名格式：主题-YYYYMMDD.pptx
`,

    "polish-writing": `---
name: polish-writing
description: 润色和优化文本文档
---

# 文档润色技能

当用户要求润色文档时：

1. 用 read_doc 读取原文（或用户直接提供文本）
2. 改善：逻辑结构、语言流畅度、用词准确性、格式规范
3. 保持原意不变，不添加未经证实的信息
4. 用 write_docx 输出润色后的版本，或直接返回修改后的文本
`,

    "doc-qa": `---
name: doc-qa
description: 针对文档内容回答问题
---

# 文档问答技能

当用户针对某个文档提问时：

1. 用 read_doc 工具读取文档全文
2. 根据文档内容回答用户问题
3. 回答时引用文档中的具体内容作为依据
4. 如文档中没有相关信息，明确告知
`,
  };

  for (const [name, content] of Object.entries(builtins)) {
    const skillDir = `${SKILLS_DIR}/${name}`;
    const skillFile = `${skillDir}/SKILL.md`;
    try {
      await Deno.mkdir(skillDir, { recursive: true });
      // 不覆盖已有技能（用户可能自定义了）
      try {
        await Deno.stat(skillFile);
      } catch {
        await Deno.writeTextFile(skillFile, content);
      }
    } catch { /* 忽略 */ }
  }
}
