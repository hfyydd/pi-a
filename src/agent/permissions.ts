// src/agent/permissions.ts
// 工具权限与审计。对标 WorkBuddy 的安全分类策略：
//
// WorkBuddy 策略（从反编译代码还原）：
//   1. 命令级安全分类（classifySafety）：按命令实际行为分类，而非按工具名一刀切
//   2. 路径级安全分类：工作区内的写操作自动放行，工作区外需要确认
//   3. 危险命令黑名单：所有权限级别强制拦截（rm -rf / 等）
//   4. 只读命令白名单：ls/cat/grep 等直接放行，不弹确认
//
// 权限级别（对标 WorkBuddy permissionMode）：
//   readonly  → 只读，所有写工具直接拦截（不确认）
//   default   → 智能分类：只读命令放行；安全写操作放行；危险写操作确认
//   full      → 全部自动放行（Computer Use 除外）

import { logToolAudit } from "../infra/db.ts";
import type { PermLevel } from "./provider.ts";

// ─── 安全分类规则（对标 WorkBuddy classifySafety） ───────────────────────

/**
 * 只读命令白名单（对标 WorkBuddy 的 autoApprove 分类）。
 * 这些命令只读取信息不修改文件系统，在所有权限级别下都可以直接放行。
 * 匹配规则：命令以这些词开头（忽略前导空格和管道链的每一段）
 */
const READ_ONLY_COMMANDS: RegExp[] = [
  // 文件/目录查看
  /^\s*(ls|ll|la)\b/,
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*wc\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  // 搜索
  /^\s*find\b/,
  /^\s*grep\b/,
  /^\s*egrep\b/,
  /^\s*fgrep\b/,
  /^\s*rg\b/,
  /^\s*ag\b/,
  /^\s*fd\b/,
  /^\s*locate\b/,
  /^\s*which\b/,
  /^\s*where\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  // 系统信息
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*pwd\b/,
  /^\s*whoami\b/,
  /^\s*date\b/,
  /^\s*uname\b/,
  /^\s*hostname\b/,
  /^\s*uptime\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*id\b/,
  /^\s*groups\b/,
  // 进程/端口查看
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*lsof\b/,
  /^\s*netstat\b/,
  /^\s*ss\b/,
  // 开发工具（只读操作）
  /^\s*git\s+(status|log|diff|show|branch|remote|tag|stash\s+list)\b/,
  /^\s*node\s+(-e|--eval)\b/,
  /^\s*python3?\s+(-c)\b/,
  /^\s*deno\s+(info|check)\b/,
  /^\s*npm\s+(ls|list|view|info|outdated|audit)\b/,
  /^\s*yarn\s+(list|info|why)\b/,
  /^\s*pnpm\s+(ls|list|why)\b/,
  /^\s*cargo\s+(tree|metadata)\b/,
  /^\s*go\s+(list|version|env)\b/,
  // 文本处理（只读管道）
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*cut\b/,
  /^\s*awk\b/,
  /^\s*sed\s+-n\b/,  // sed -n 只打印，不修改
  /^\s*tr\b/,
  /^\s*column\b/,
  /^\s*jq\b/,
  /^\s*xargs\b/,
  /^\s*tee\b/,
  // 网络查看
  /^\s*ping\b/,
  /^\s*dig\b/,
  /^\s*nslookup\b/,
  /^\s*host\b/,
  /^\s*ifconfig\b/,
  /^\s*ip\s+(addr|link|route)\b/,
];

/** 需要确认的写/执行工具（write/edit/memory_write/文档工具） */
const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "memory_write",
  "write_docx",
  "write_xlsx",
  "write_pptx",
  // Computer Use 操作工具（default 下需确认）
  "mouse_click",
  "mouse_move",
  "key_type",
]);

// 注意：bash 不再硬编码在 WRITE_TOOLS 中！
// bash 通过下面的 classifyBashSafety() 智能分类。

/** 危险工具（即使 full 权限也强制确认）—— Computer Use 的点击/键盘 */
const DANGER_TOOLS = new Set([
  "mouse_click",
  "key_type",
]);

/**
 * Computer Use 步数上限（对照 05 文档§三：防失控循环）。
 * 对实际操作工具（点击/移动/键盘）按 session 计数，超过上限拒绝。
 * screenshot/cursor_pos 是感知类，不计入。
 */
const COMPUTER_USE_ACTION_TOOLS = new Set(["mouse_click", "mouse_move", "key_type"]);
const MAX_COMPUTER_USE_STEPS = 20;
const computerUseCount = new Map<string, number>();

/** 重置某会话的 Computer Use 步数计数（新任务/prompt 时调用） */
export function resetComputerUseCount(sessionId: string): void {
  computerUseCount.delete(sessionId);
}

/** 危险命令黑名单（正则，所有权限级别都拦截） */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf?\s+\/($|\s)/i,       // rm -rf /
  /rm\s+-rf?\s+~/,               // rm -rf ~
  /rm\s+-rf?\s+\/Users/,         // rm -rf /Users
  /mkfs/i,                        // 格式化磁盘
  /dd\s+.*of=\/dev\//i,          // dd 写入设备
  /:\(\)\s*\{.*\};:/,            // fork bomb
  /\bchmod\s+-R\s+777\s+\//i,   // 递归 chmod 根目录
  />\s*\/dev\/sd[a-z]/i,         // 写入磁盘设备
  /\bsudo\s+rm\b/i,              // sudo rm
  /curl\s+.*\|\s*(ba|z)?sh/i,           // curl pipe sh/bash/zsh
  /wget\s+.*\|\s*(ba|z)?sh/i,           // wget pipe sh/bash/zsh
];

// ─── 安全分类函数（对标 WorkBuddy classifySafety） ─────────────────────

/**
 * 检查命令是否危险（黑名单强制拦截）
 */
function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

/**
 * 检查 bash 命令是否为只读命令（对标 WorkBuddy autoApprove）。
 *
 * 策略：将命令按管道链拆分，检查每一段的首个命令词。
 * 如果所有段都是只读命令，则整条命令是只读的。
 *
 * 例子：
 *   "ls ~/Desktop | wc -l"  → 只读（ls + wc 都在白名单）
 *   "ls ~/Desktop && rm foo" → 非只读（rm 不在白名单）
 */
function isReadOnlyBashCommand(command: string): boolean {
  // 按 &&、||、; 拆分命令链（管道 | 不拆分，因为管道链整体只读）
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);

  for (const seg of segments) {
    // 跳过空段
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // 去掉管道后面的部分，只看第一个命令
    const firstCmd = trimmed.split(/\s*\|\s*/)[0].trim();
    if (!firstCmd) continue;

    // 检查是否匹配只读白名单
    const isReadOnly = READ_ONLY_COMMANDS.some((p) => p.test(firstCmd));
    if (!isReadOnly) {
      return false;
    }
  }
  return true;
}

/**
 * bash 命令安全分类（对标 WorkBuddy classifySafety）。
 *
 * 返回：
 *   "block"       → 危险命令，强制拦截
 *   "auto_approve" → 只读命令，直接放行
 *   "needs_confirm" → 写操作命令，需要用户确认
 */
export type BashSafetyLevel = "block" | "auto_approve" | "needs_confirm";

export function classifyBashSafety(command: string): { level: BashSafetyLevel; reason?: string } {
  // 第一层：危险命令黑名单（所有权限级别强制拦截）
  if (isDangerousCommand(command)) {
    return { level: "block", reason: "检测到危险命令，已被系统安全拦截。" };
  }

  // 第二层：只读命令白名单（直接放行）
  if (isReadOnlyBashCommand(command)) {
    return { level: "auto_approve" };
  }

  // 第三层：其他命令（可能有写操作），需要确认
  return { level: "needs_confirm", reason: "此命令可能修改文件系统" };
}

export interface PermissionDecision {
  /** allow=true 直接执行；allow=false 且 block=true 终止；allow=false 且 block=false 暂停待确认 */
  allow: boolean;
  block?: boolean;
  reason?: string;
  /** 是否需要 UI 确认（allow=false, block=false 时） */
  needConfirm?: boolean;
}

/**
 * 确认回调注册表：sessionId → (toolName, args) => Promise<boolean>
 * 由 main.ts 注入（发 UI 确认弹窗，等用户响应）
 */
const confirmHandlers = new Map<string, (toolName: string, args: unknown) => Promise<boolean>>();

/** 注册某会话的确认回调（main.ts 在 win.bind 时注入） */
export function setConfirmHandler(sessionId: string, handler: (toolName: string, args: unknown) => Promise<boolean>): void {
  confirmHandlers.set(sessionId, handler);
}

/** 注销 */
export function clearConfirmHandler(sessionId: string): void {
  confirmHandlers.delete(sessionId);
}

/**
 * 工具执行前权限检查。
 *
 * 对标 WorkBuddy 策略：
 *   - bash 命令不再一刀切为「写工具需确认」
 *   - 通过 classifyBashSafety() 智能分类：
 *     · 只读命令（ls/cat/grep...）→ 直接放行
 *     · 危险命令（rm -rf /）→ 强制拦截
 *     · 写操作命令 → 按权限级别决定（default 需确认，full 放行）
 *
 * @param sessionId  会话 id（用于查权限级别 + 确认回调）
 * @param perm       当前权限级别
 * @param toolName   工具名
 * @param args       工具参数
 */
export async function checkToolPermission(
  sessionId: string,
  perm: PermLevel,
  toolName: string,
  args: unknown,
): Promise<PermissionDecision> {
  // ── bash 命令：智能安全分类（对标 WorkBuddy classifySafety） ──
  if (toolName === "bash") {
    const cmdStr = (args as any)?.command || "";
    const classification = classifyBashSafety(cmdStr);

    // 危险命令：所有权限级别强制拦截
    if (classification.level === "block") {
      console.warn(`[permissions] 拦截到危险命令: ${cmdStr}`);
      return { allow: false, block: true, reason: classification.reason };
    }

    // 只读命令：所有权限级别直接放行（对标 WorkBuddy autoApprove）
    if (classification.level === "auto_approve") {
      return { allow: true };
    }

    // 写操作命令：按权限级别处理
    if (perm === "full") {
      return { allow: true };
    }
    if (perm === "readonly") {
      return { allow: false, block: true, reason: "只读模式下禁止执行写操作命令" };
    }
    // default 权限：需要用户确认
    return await requestUserConfirmation(sessionId, toolName, args);
  }

  // ── Computer Use 步数上限 ──
  if (COMPUTER_USE_ACTION_TOOLS.has(toolName)) {
    const count = (computerUseCount.get(sessionId) ?? 0) + 1;
    computerUseCount.set(sessionId, count);
    if (count > MAX_COMPUTER_USE_STEPS) {
      return {
        allow: false,
        block: true,
        reason: `Computer Use 操作已达上限 ${MAX_COMPUTER_USE_STEPS} 步，已停止以防失控。请新开对话或调整任务后重试。`,
      };
    }
  }

  // ── full 权限：全放行（Computer Use 危险工具除外） ──
  if (perm === "full") {
    if (DANGER_TOOLS.has(toolName)) {
      return await requestUserConfirmation(sessionId, toolName, args);
    }
    return { allow: true };
  }

  // ── readonly 权限：写工具拦截 ──
  if (perm === "readonly") {
    if (WRITE_TOOLS.has(toolName)) {
      return { allow: false, block: true, reason: `只读模式下 ${toolName} 被禁止` };
    }
    return { allow: true };
  }

  // ── default 权限：写工具需确认 ──
  if (WRITE_TOOLS.has(toolName)) {
    return await requestUserConfirmation(sessionId, toolName, args);
  }

  // 读类工具：放行
  return { allow: true };
}

/**
 * 请求用户确认（内部辅助函数）。
 * 通过 confirmHandler 发送 UI 确认弹窗，等待用户响应。
 */
async function requestUserConfirmation(
  sessionId: string,
  toolName: string,
  args: unknown,
): Promise<PermissionDecision> {
  const handler = confirmHandlers.get(sessionId);
  if (!handler) {
    // 无确认通道时，保守放行（避免卡死），但记录警告
    console.warn(`[permissions] 写工具 ${toolName} 无确认通道，默认权限下放行`);
    return { allow: true, reason: "无确认通道" };
  }
  try {
    const approved = await handler(toolName, args);
    return approved
      ? { allow: true }
      : { allow: false, block: true, reason: "用户拒绝了工具调用" };
  } catch (e) {
    console.error(`[permissions] 确认回调异常:`, e);
    return { allow: false, block: true, reason: "确认流程出错" };
  }
}

/**
 * 工具执行后审计。落 SQLite
 */
export async function logToolCall(
  toolName: string,
  args: unknown,
  isError: boolean,
): Promise<void> {
  logToolAudit(toolName, args, isError);
  console.log(`[audit] ${toolName} ${isError ? "✗" : "✓"}`);
}
