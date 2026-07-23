// src/agent/engine.ts
// pi Agent 封装。对照 03 文档 §2.3：
//   createModels + new Agent + streamFn + getApiKey + beforeToolCall + afterToolCall + subscribe
// spike 验证：new Agent({...}) + 真实 DeepSeek 流式对话全通过

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { getModels } from "./models.ts";
import { getApiKey } from "../infra/keychain.ts";
import { checkToolPermission, logToolCall } from "./permissions.ts";
import { getTools } from "./tools/index.ts";
import { loadSkillsPrompt, ensureSkillsDir } from "./skills.ts";
import { snapshotFile, detectFileWrites } from "../infra/file_snapshot.ts";
import { recallMemories, recallWorkingMemory } from "../domains/memory/node/store.ts";

export const SYSTEM_PROMPT = `你是 Pi-a，一个本地优先的 AI 桌面助手。所有数据和计算都在用户本地完成。

<identity>
你是用户的智能工作伙伴，能读写文件、执行命令、处理文档、记忆偏好。
用户桌面路径：~/Desktop/（macOS）。
回答用中文，简洁直接。
</identity>

<tools>
你有以下工具：
- read：读取文件内容（支持 ~ 路径）
- write：写文件到任意路径（自动创建父目录）
- edit：编辑已有文件
- bash：执行 shell 命令（ls/mkdir/cp/mv 等）
- read_doc：读取文档（docx/xlsx/csv 结构化解析，比 read 更适合 Office 文件）
- write_docx：生成 Word 文档（提供标题和章节）
- write_xlsx：生成 Excel 表格（提供工作表和行列数据）
- write_pptx：生成 PPT 演示文稿（提供幻灯片标题和要点）
- memory_recall：读取长期记忆
- memory_write：写入长期记忆（记住用户偏好和事实）
- web_fetch：抓取网页内容（URL → 纯文本）
- web_search：搜索引擎查询（获取最新信息）
- computer：Anthropic/CodeX 规范的统一电脑掌控工具 (action: screenshot | left_click | right_click | double_click | type | key | scroll | app_focus)
- screenshot：截取屏幕（可指定区域），返回图片供视觉分析
- mouse_click：在屏幕坐标 (x,y) 点击鼠标（左键/右键/双击）
- mouse_move：移动鼠标到 (x,y)
- key_type：键盘输入文本或按键（return/tab/cmd+c 等）
- app_focus：激活/前台显示指定应用
- cursor_pos：获取当前鼠标坐标
- ask_user_question：向用户提问并收集选项/自由输入（需要用户澄清、或要在多个候选方案间让用户选择时使用）
</tools>

<computer_use>
操控电脑（Computer Use，对标 CodeX / Anthropic 规范）时按"感知-操作循环"执行：
1. 用 computer(action="screenshot") 或 screenshot() 截图查看当前屏幕全貌。
2. 分析截图中的视觉元素，获取目标点的逻辑坐标 [x, y]。
3. 用 computer(action="left_click", coordinate=[x, y]) 或 mouse_click(x, y) 执行点击，或用 computer(action="type", text="...") 输入文本。
4. 执行操作后，再次截图验证屏幕界面变化。
5. 循环直至目标达成。
提示：系统已内置 Retina 屏幕缩放换算与 AppleScript 原生操控自动降级机制。
</computer_use>

<agent_loop>
收到任务后按以下步骤执行：
1. 理解：确认用户想要什么；信息不足或面临多个方案时用 ask_user_question 向用户澄清/选择，不要自己猜
2. 执行：用工具直接完成任务，不要让用户自己做
3. 验证：确认操作成功（如创建文件后确认文件存在）
4. 总结：简要告诉用户结果
</agent_loop>

<tool_usage_policy>
- 主动用工具完成任务。用户说"建一个 txt"就用 write 创建，不要回复"你可以自己右键新建"。
- 用户说"读一下某文件"就用 read 读取后总结，不要说"请把内容贴给我"。
- 需要路径时优先用 ~/Desktop/、~/Documents/ 等标准路径。
- 不确定文件位置时，先用 bash ls 查看，再操作。
</tool_usage_policy>

<file_safety>
执行文件操作时遵守：
- 禁止递归删除目录（rm -rf /、rm -rf ~）
- 删除文件前先确认
- 批量操作不超过 10 个文件
- 移动/重命名前确保目标路径正确
- 不修改系统关键文件（/etc、/System、/usr）
</file_safety>

<working_modes>
- Craft 模式：直接执行任务，可读写文件、执行命令
- Plan 模式：先分析、列方案，等用户确认后再执行
- Ask 模式：只回答问题，不调用任何工具
</working_modes>

<memory>
用户偏好和事实会通过 memory 工具存取。
当用户说"记住我喜欢简洁风格"时，用 memory_write 存储。
回答问题时如有相关记忆，用 memory_recall 查找。
</memory>

<result_presentation>
- 回复简洁，避免冗长解释
- 用 markdown 格式（标题/列表/代码块）
- 执行了哪些操作简要说明
- 文件路径用代码格式标注
</result_presentation>
`;

/** 加载记忆并注入系统提示（对标 WorkBuddy 四层记忆的简化版：working + user 两层） */
const MAX_USER_CHARS = 10000; // 长期记忆字符上限，防 prompt 爆炸
function loadMemoryPrompt(): string {
  try {
    const userMems = recallMemories();          // scope=user 长期记忆（跨会话）
    const workingMems = recallWorkingMemory();  // scope=working 工作记忆（当前任务级）
    if (userMems.length === 0 && workingMems.length === 0) return "";
    const fmt = (arr: { kind?: string; content: string }[]) =>
      arr.length === 0 ? "(无)" : arr.map((m) => `- [${m.kind || "fact"}] ${m.content}`).join("\n");
    const workingLines = fmt(workingMems);
    let userLines = fmt(userMems);
    if (userLines.length > MAX_USER_CHARS) {
      userLines = userLines.slice(0, MAX_USER_CHARS) + "\n...(更多长期记忆已截断)";
    }
    return `\n\n<memory>
<working_memory>
以下是当前任务的工作记忆（临时，随会话清理）：
${workingLines}
</working_memory>
<user_memory>
以下是关于用户的长期记忆（跨会话保留），回答时参考：
${userLines}
</user_memory>
</memory>`;
  } catch {
    return "";
  }
}

export interface AgentHandle {
  agent: Agent;
  /** 推送事件给前端（由调用方注入） */
  emit: (event: AgentEvent) => void;
}

/**
 * 创建一个 pi Agent 实例。
 * @param onEvent  事件回调（由 provider 注入，负责推送给前端）
 * @param tools    可选：覆盖默认工具集
 */
export function createWorkBuddyAgent(
  onEvent: (event: AgentEvent) => void,
  opts?: {
    modelProvider?: string;
    modelId?: string;
    systemPrompt?: string;
    tools?: AgentTool<any>[];
  },
): AgentHandle {
  const modelProvider = opts?.modelProvider ?? "deepseek";
  const modelId = opts?.modelId ?? "deepseek-v4-flash";

  const models = getModels();
  const model = models.getModel(modelProvider, modelId);
  if (!model) {
    throw new Error(
      `模型 ${modelProvider}/${modelId} 未注册。可用: ${
        JSON.stringify(models.getModels(modelProvider)?.map((m: any) => m.id) ?? [])
      }`,
    );
  }

  const tools = opts?.tools ?? getTools();

  // 注入技能提示词
  const skillsPrompt = loadSkillsPrompt();

  // 注入记忆（自动召回，不用 agent 主动调 memory_recall）
  const memoryPrompt = loadMemoryPrompt();

  const fullSystemPrompt = (opts?.systemPrompt ?? SYSTEM_PROMPT) + memoryPrompt + skillsPrompt;

  const agent = new Agent({
    initialState: {
      model,
      systemPrompt: fullSystemPrompt,
      tools,
    },
    // LLM 流式：经 Models（Deno 原生 fetch，无 CORS）
    streamFn: (m, ctx, o) => models.streamSimple(m, ctx, o),
    // API key 走 keychain（带 env 兜底）
    getApiKey: async (provider: string) => (await getApiKey(provider)) ?? undefined,
    // 权限钩子：beforeToolCall（按会话权限级别 + 工具类型决定放行/确认/拦截）
    beforeToolCall: async (ctx) => {
      const sessionId = (agent as any).__sessionId as string | undefined;
      const perm = (agent as any).__perm as "readonly" | "default" | "full" | undefined;
      const d = await checkToolPermission(sessionId ?? "", perm ?? "default", ctx.toolCall.name, ctx.args);
      if (d.allow) {
        // bash 写文件前自动快照（default 确认通过后 / full 直接放行后，执行前）
        if (ctx.toolCall.name === "bash") {
          const cmd = (ctx.args as any)?.command || "";
          const files = detectFileWrites(cmd);
          for (const f of files) {
            try { await snapshotFile(f, sessionId); } catch {}
          }
        }
        return undefined;
      }
      return { block: true, reason: d.reason };
    },
    // 审计钩子：afterToolCall（落 SQLite）
    afterToolCall: async (ctx) => {
      await logToolCall(ctx.toolCall.name, ctx.args, ctx.isError);
    },
    toolExecution: "parallel",
  });

  // 订阅事件流 → 经 onEvent 推给前端
  agent.subscribe(async (event: AgentEvent) => {
    onEvent(event);
  });

  return { agent, emit: onEvent };
}
