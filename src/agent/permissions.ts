// src/agent/permissions.ts
// 工具权限与审计。对照 03 文档 §3.2：
//   beforeToolCall → checkToolPermission（按权限级别决定放行/拦截/求确认）
//   afterToolCall  → logToolCall（审计落 SQLite）
//
// 权限模型：
//   full    → 全部自动放行
//   default → 读类工具放行；写类工具需用户确认（经 onConfirm 回调发 UI）

import { logToolAudit } from "../infra/db.ts";
import type { PermLevel } from "./provider.ts";

/** 需要确认的写/执行工具（默认权限下需用户确认） */
const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "bash",
  "memory_write",
  "write_docx",
  "write_xlsx",
  "write_pptx",
]);

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

/** 检查命令是否危险 */
function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
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
  // 危险命令拦截（黑名单，所有权限级别都强制拦截）
  if (toolName === "bash") {
    const cmdStr = (args as any)?.command || "";
    if (isDangerousCommand(cmdStr)) {
      console.warn(`[permissions] 拦截到危险命令: ${cmdStr}`);
      return { allow: false, block: true, reason: "检测到危险命令，已被系统安全拦截。" };
    }
  }

  // 完全访问权限：全放行
  if (perm === "full") {
    return { allow: true };
  }

  // 默认权限：写工具需确认
  if (WRITE_TOOLS.has(toolName)) {
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

  // 读类工具：放行
  return { allow: true };
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
