// src/agent/permissions.ts
// 工具权限与审计。对标 WorkBuddy 的三层安全审计与策略 (L1/L2/L3)：
//
// 权限级别（对标 WorkBuddy permissionMode 与 L1/L2/L3 三层架构）：
//   L1 (readonly) → 只读模式：仅只读工具放行，任何写工具与操控工具直接拦截
//   L2 (default)  → 标准模式：只读命令放行；写文件/修改与命令行需弹窗确认
//   L3 (full)     → 完全控制模式：自动放行常规写操作，但高危操控工具与黑名单危险命令强行弹窗二次确认

import { logToolAudit } from "../infra/db.ts";

export type PermLevel = "L1" | "L2" | "L3" | "readonly" | "default" | "full";

/** 标准化权限级别 */
export function normalizePermLevel(perm?: PermLevel): "L1" | "L2" | "L3" {
  if (perm === "readonly" || perm === "L1") return "L1";
  if (perm === "full" || perm === "L3") return "L3";
  return "L2";
}

// ─── 安全分类规则（对标 WorkBuddy classifySafety） ───────────────────────

/**
 * 只读命令白名单（对标 WorkBuddy 的 autoApprove 分类）。
 * 这些命令只读取信息不修改文件系统，在所有权限级别下都可以直接放行。
 */
const READ_ONLY_COMMANDS: RegExp[] = [
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
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*lsof\b/,
  /^\s*netstat\b/,
  /^\s*ss\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|tag|stash\s+list)\b/,
  /^\s*node\s+(-e|--eval)\b/,
  /^\s*python3?\s+(-c)\b/,
  /^\s*deno\s+(info|check)\b/,
  /^\s*npm\s+(ls|list|view|info|outdated|audit)\b/,
  /^\s*yarn\s+(list|info|why)\b/,
  /^\s*pnpm\s+(ls|list|why)\b/,
  /^\s*cargo\s+(tree|metadata)\b/,
  /^\s*go\s+(list|version|env)\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*cut\b/,
  /^\s*awk\b/,
  /^\s*sed\s+-n\b/,
  /^\s*tr\b/,
  /^\s*column\b/,
  /^\s*jq\b/,
  /^\s*xargs\b/,
  /^\s*tee\b/,
  /^\s*ping\b/,
  /^\s*dig\b/,
  /^\s*nslookup\b/,
  /^\s*host\b/,
  /^\s*ifconfig\b/,
  /^\s*ip\s+(addr|link|route)\b/,
];

/** L1 放行的只读工具 */
const READ_ONLY_TOOLS = new Set([
  "read",
  "read_doc",
  "web_fetch",
  "web_search",
  "memory_recall",
  "screenshot",
  "cursor_pos",
  "index_doc",
  "search_docs",
]);

/** 需要确认的写/修改工具 */
const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "memory_write",
  "write_docx",
  "write_xlsx",
  "write_pptx",
  "edit_docx",
  "edit_xlsx",
  "edit_docx_free",
  "edit_pptx",
  "mouse_click",
  "mouse_move",
  "key_type",
  "computer",
]);

/** 高危工具（即使 L3 权限也强制弹窗确认） */
const DANGER_TOOLS = new Set([
  "mouse_click",
  "key_type",
  "computer",
]);

/** Computer Use 步数上限 */
const COMPUTER_USE_ACTION_TOOLS = new Set(["mouse_click", "mouse_move", "key_type", "computer"]);
const MAX_COMPUTER_USE_STEPS = 20;
const computerUseCount = new Map<string, number>();

/** 重置某会话的 Computer Use 步数计数 */
export function resetComputerUseCount(sessionId: string): void {
  computerUseCount.delete(sessionId);
}

/** 危险命令黑名单（正则） */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf?\s+\/($|\s)/i,       // rm -rf /
  /rm\s+-rf?\s+~/,               // rm -rf ~
  /rm\s+-rf?\s+\/Users/i,         // rm -rf /Users
  /mkfs/i,                        // 格式化磁盘
  /dd\s+.*of=\/dev\//i,          // dd 写入设备
  /:\(\)\s*\{.*\};:/,            // fork bomb
  /\bchmod\s+-R\s+777\s+\//i,   // 递归 chmod 根目录
  />\s*\/dev\/sd[a-z]/i,         // 写入磁盘设备
  /\bsudo\b/i,                   // sudo 提权命令
  /curl\s+.*\|\s*(ba|z)?sh/i,    // curl pipe sh/bash/zsh
  /wget\s+.*\|\s*(ba|z)?sh/i,    // wget pipe sh/bash/zsh
  />\s*\/etc\//i,                // 修改 /etc 目录
  />\s*\/System\//i,             // 修改 /System 目录
];

/** 检查命令是否危险（黑名单） */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

/** 检查 bash 命令是否为只读命令 */
function isReadOnlyBashCommand(command: string): boolean {
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const firstCmd = trimmed.split(/\s*\|\s*/)[0].trim();
    if (!firstCmd) continue;
    const isReadOnly = READ_ONLY_COMMANDS.some((p) => p.test(firstCmd));
    if (!isReadOnly) return false;
  }
  return true;
}

export type BashSafetyLevel = "block" | "auto_approve" | "needs_confirm";

export function classifyBashSafety(command: string): { level: BashSafetyLevel; reason?: string } {
  if (isDangerousCommand(command)) {
    return { level: "block", reason: "⚠️ 检测到危险系统级命令或敏感路径提权，已被黑名单直接拦截。" };
  }
  if (isReadOnlyBashCommand(command)) {
    return { level: "auto_approve" };
  }
  return { level: "needs_confirm", reason: "此命令包含写操作或管道系统调用，需要您的授权确认。" };
}

export interface PermissionDecision {
  allow: boolean;
  block?: boolean;
  reason?: string;
  needConfirm?: boolean;
}

const confirmHandlers = new Map<string, (toolName: string, args: unknown) => Promise<boolean>>();

export function setConfirmHandler(sessionId: string, handler: (toolName: string, args: unknown) => Promise<boolean>): void {
  confirmHandlers.set(sessionId, handler);
}

export function clearConfirmHandler(sessionId: string): void {
  confirmHandlers.delete(sessionId);
}

/**
 * 工具执行前权限检查 (三层模型 L1/L2/L3)。
 */
export async function checkToolPermission(
  sessionId: string,
  permInput: PermLevel = "L2",
  toolName: string,
  args: unknown,
): Promise<PermissionDecision> {
  const level = normalizePermLevel(permInput);

  // ── bash 命令智能分类 ──
  if (toolName === "bash") {
    const cmdStr = (args as any)?.command || "";
    const classification = classifyBashSafety(cmdStr);

    if (classification.level === "block") {
      console.warn(`[permissions] 拦截到黑名单危险命令: ${cmdStr}`);
      return { allow: false, block: true, reason: classification.reason };
    }

    if (classification.level === "auto_approve") {
      return { allow: true };
    }

    if (level === "L1") {
      return { allow: false, block: true, reason: "L1 (只读模式) 下拒绝执行非只读 Bash 命令" };
    }

    if (level === "L3") {
      // 在 L3 模式下，非黑名单命令放行
      return { allow: true };
    }

    // L2 模式下，写命令弹窗确认
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
        reason: `Computer Use 操控步数已达上限 ${MAX_COMPUTER_USE_STEPS} 步，已被系统防失控熔断机制拦截。`,
      };
    }
  }

  // ── L1 模式 (只读) ──
  if (level === "L1") {
    if (!READ_ONLY_TOOLS.has(toolName)) {
      return { allow: false, block: true, reason: `L1 (只读模式) 下工具 ${toolName} 被禁止调用` };
    }
    return { allow: true };
  }

  // ── L3 模式 (完全控制) ──
  if (level === "L3") {
    if (DANGER_TOOLS.has(toolName)) {
      // 屏幕高危操控即便在 L3 也二次确认
      return await requestUserConfirmation(sessionId, toolName, args);
    }
    return { allow: true };
  }

  // ── L2 模式 (标准) ──
  if (WRITE_TOOLS.has(toolName)) {
    return await requestUserConfirmation(sessionId, toolName, args);
  }

  return { allow: true };
}

async function requestUserConfirmation(
  sessionId: string,
  toolName: string,
  args: unknown,
): Promise<PermissionDecision> {
  const handler = confirmHandlers.get(sessionId);
  if (!handler) {
    console.warn(`[permissions] 写工具 ${toolName} 无确认通道，默认模式下放行`);
    return { allow: true, reason: "无确认通道" };
  }
  try {
    const approved = await handler(toolName, args);
    return approved
      ? { allow: true }
      : { allow: false, block: true, reason: "用户拒绝了工具调用" };
  } catch (e) {
    console.error(`[permissions] 确认流程异常:`, e);
    return { allow: false, block: true, reason: "确认流程出错" };
  }
}

export async function logToolCall(
  toolName: string,
  args: unknown,
  isError: boolean,
): Promise<void> {
  logToolAudit(toolName, args, isError);
  console.log(`[audit] ${toolName} ${isError ? "✗" : "✓"}`);
}
