// src/agent/experts.ts
// 专家模式：预设角色 + 系统提示模板
// 对照 WorkBuddy 的 Expert（WorkBuddy 是 plugin 级换装，我们是 system prompt 切换）

export interface Expert {
  id: string;
  name: string;
  nickname?: string;
  icon: string;
  description: string;
  systemPrompt: string;
  promptFile?: string;
  tags?: string[];
  quickPrompts?: string[];
  badge?: string;
}

/** 内置原始 6 个 mock 专家，作为离线降级与首选展示 */
const MOCK_EXPERTS: Expert[] = [
  {
    id: "product-manager",
    name: "产品经理",
    nickname: "许清楚",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/SeniorProjectManager.png",
    description: "需求分析、PRD 撰写、产品规划",
    systemPrompt: `你是一位资深产品经理。擅长需求分析、用户故事拆解、PRD 撰写、产品路线图规划。
回答时优先使用产品思维框架（用户价值、商业价值、技术可行性），输出结构化的产品文档。
当用户要求生成文档时，用 write_docx 生成标准 PRD 格式。`,
    tags: ["需求分析", "PRD撰写", "产品规划"],
    badge: "官方专家",
  },
  {
    id: "data-analyst",
    name: "数据分析师",
    nickname: "舒明析",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/DataAnalyticsReporter.png",
    description: "数据分析、可视化、报表",
    systemPrompt: `你是一位数据分析师。擅长从表格数据中提取洞察、趋势分析、统计建模。
回答时先理解数据结构，再给出分析结论 and 可执行建议。
当用户要求分析数据时，先用 read_doc 读取 xlsx/csv，用 write_xlsx 生成分析结果表。`,
    tags: ["数据分析", "数据诊断", "报表设计"],
    badge: "官方专家",
  },
  {
    id: "copywriter",
    name: "文案专家",
    nickname: "文博凯",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/ContentCreator.png",
    description: "营销文案、内容创作、品牌策略",
    systemPrompt: `你是一位资深文案专家。擅长营销文案、品牌故事、社交媒体内容、SEO 文章。
回答时注重文字的感染力和传播性，提供多个文案选项供用户选择。`,
    tags: ["内容策略", "品牌故事", "社媒创作"],
    badge: "官方专家",
  },
  {
    id: "translator",
    name: "翻译专家",
    nickname: "何执舟",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/DocumentGenerationExpert.png",
    description: "中英互译、多语言翻译、本地化",
    systemPrompt: `你是一位专业翻译。精通中英互译，熟悉技术文档、商务文件、文学作品的不同翻译风格。
翻译时保持原文语义，适应目标语言的表达习惯，必要时提供翻译注释。`,
    tags: ["中英互译", "本地化", "技术翻译"],
    badge: "官方专家",
  },
  {
    id: "coder",
    name: "编程助手",
    nickname: "寇豆码",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/UiDesigner.png",
    description: "代码编写、调试、架构设计",
    systemPrompt: `你是一位资深全栈工程师。精通多种编程语言，擅长代码编写、调试、架构设计、性能优化。
回答时给出可直接运行的代码，附带简要说明。用 bash 工具可以执行 and 测试代码。`,
    tags: ["代码编写", "架构设计", "性能优化"],
    badge: "官方专家",
  },
  {
    id: "legal-advisor",
    name: "法务顾问",
    nickname: "严过关",
    icon: "https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/avatars/BrandGuardian.png",
    description: "合同审查、法律咨询、合规",
    systemPrompt: `你是一位法务顾问。擅长合同审查、法律风险评估、合规建议。
回答时引用相关法律条文，提供专业但不构成正式法律意见的参考建议。
重要：始终提醒用户复杂法律问题应咨询执业律师。`,
    tags: ["合同审查", "合规审查", "风险评估"],
    badge: "官方专家",
  },
];

// 加载本地的 expert_center.json 并组合出 300+ 专家
const localText = await Deno.readTextFile(new URL("./expert_center.json", import.meta.url)).catch(() => "");
let cosExperts: any[] = [];
if (localText) {
  try {
    const data = JSON.parse(localText);
    cosExperts = data.experts || [];
  } catch {}
}

const mappedCosExperts: Expert[] = cosExperts.map((item: any) => {
  const name = item.profession?.zh || item.displayName?.zh || item.id;
  const nickname = item.profession?.zh !== item.displayName?.zh ? (item.displayName?.zh || "") : "";
  return {
    id: item.id,
    name: name,
    nickname: nickname,
    icon: item.avatar
      ? `https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace${item.avatar}`
      : "",
    description: item.description?.zh || item.description?.en || "",
    promptFile: item.promptFile,
    tags: (item.tags || []).map((t: any) => t.zh || t.en),
    quickPrompts: (item.quickPrompts || []).map((qp: any) => qp.zh || qp.en),
    systemPrompt: item.defaultInitPrompt?.zh || "",
    badge: item.isOPC ? "特邀专家" : undefined,
  };
});

export const BUILTIN_EXPERTS: Expert[] = [...MOCK_EXPERTS];
for (const e of mappedCosExperts) {
  if (!BUILTIN_EXPERTS.some(x => x.id === e.id)) {
    BUILTIN_EXPERTS.push(e);
  }
}

/** 按 id 获取专家 */
export function getExpert(id: string): Expert | undefined {
  return BUILTIN_EXPERTS.find((e) => e.id === id);
}

// ===== 系统提示词加载与 COS 下载缓存机制 =====

const CACHE_DIR = `${Deno.env.get("HOME") || "/tmp"}/.pi-a/expert_prompts`;

async function getCachedPrompt(id: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(`${CACHE_DIR}/${id}.md`);
  } catch {
    return null;
  }
}

async function writeCachedPrompt(id: string, text: string): Promise<void> {
  try {
    await Deno.mkdir(CACHE_DIR, { recursive: true });
    await Deno.writeTextFile(`${CACHE_DIR}/${id}.md`, text);
  } catch (e) {
    console.error("[experts] 写入缓存提示词出错:", e);
  }
}

function parseSystemPrompt(mdText: string): string {
  const parts = mdText.split("---");
  if (parts.length >= 3) {
    // 剔除 YAML Frontmatter，仅保留正文作为系统提示词
    return parts.slice(2).join("---").trim();
  }
  return mdText.trim();
}

/** 动态加载专家的系统提示词，支持网络拉取与本地磁盘缓存 */
export async function getExpertSystemPrompt(expertId: string): Promise<string> {
  const expert = getExpert(expertId);
  if (!expert) return "";

  // 1. 尝试读本地缓存
  const cached = await getCachedPrompt(expertId);
  if (cached) return parseSystemPrompt(cached);

  // 2. 如果是 COS 专家，则尝试从腾讯云下载
  if (expert.promptFile) {
    try {
      const url = `https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace${expert.promptFile}`;
      console.log(`[experts] 正在下载专家 ${expertId} 的 Prompt:`, url);
      const resp = await fetch(url);
      if (resp.ok) {
        const text = await resp.text();
        await writeCachedPrompt(expertId, text);
        return parseSystemPrompt(text);
      }
    } catch (e) {
      console.error(`[experts] 无法下载专家 ${expertId} 的 Prompt:`, e);
    }
  }

  // 降级使用默认提示词
  return expert.systemPrompt || "";
}
