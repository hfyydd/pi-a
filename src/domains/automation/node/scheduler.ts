// src/domains/automation/node/scheduler.ts
// 自动化调度器。对照 08 计划功能 8 + WorkBuddy 子系统⑬。
// 30s 扫描一次，对 next_run <= now 的 cron 自动化触发执行。
// cron 解析：5 段 "分 时 日 月 周"，支持 * / 数字 / */n / a-b / a,b。

import {
  listEnabledCronAutomations, listEnabledIntervalAutomations, listEnabledOnceAutomations,
  listDueAutomations, updateAutomation, createRun, finishRun, type Automation,
} from "./store.ts";
import { createConversation, appendMessage, getMessages } from "../../session/node/store.ts";
import { provider } from "../../../agent/provider.ts";

let timer: ReturnType<typeof setInterval> | null = null;

/** 简单 cron 字段匹配：field 是 cron 段，value 是当前值 */
function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }
  if (field.includes(",")) {
    return field.split(",").some((f) => matchField(f, value));
  }
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}

/** 判断 cron 表达式是否匹配给定时间 */
export function matchCron(expr: string, d: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [m, h, dom, mon, dow] = parts;
  return matchField(m, d.getMinutes()) &&
    matchField(h, d.getHours()) &&
    matchField(dom, d.getDate()) &&
    matchField(mon, d.getMonth() + 1) &&
    matchField(dow, d.getDay());
}

/** 计算从 from 之后下一个匹配 cron 的时间（分钟级，最多扫 7 天） */
export function nextCronTime(expr: string, from: Date): Date | null {
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1); // 从下一分钟开始
  const limit = from.getTime() + 7 * 24 * 60 * 60 * 1000;
  while (t.getTime() < limit) {
    if (matchCron(expr, t)) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}

/** 检查自动化是否在有效日期范围内 */
function isWithinValidity(a: Automation, now: number): boolean {
  if (a.validFrom && now < a.validFrom) return false;
  if (a.validUntil && now > a.validUntil) return false;
  return true;
}

/** 执行自动化并把对话落库（user 提示词 + assistant 回复），供手动触发与调度共用。
 *  正常聊天靠前端 SSE 连接把 assistant 消息写进 DB；自动化触发没有前端连接，
 *  所以这里由后端自行挂接消息持久化（provider.attachPersistence），确保「查看会话」跳过去是真实对话。 */
export async function runAutomationWithPersistence(a: Automation, convId: string, runId: string): Promise<void> {
  const prompt = a.actionType === "skill"
    ? `【执行技能】${a.actionConfig.skill || ""}`
    : (a.prompt || a.actionConfig.prompt || "");
  if (!prompt) { finishRun(runId, "completed", "无提示词，跳过"); return; }
  // 落库用户提示词（与正常聊天 /api/prompt 一致）
  appendMessage(convId, "user", prompt);
  // 挂接消息持久化（assistant / 工具调用落库到 SQLite）
  const unsub = await provider.attachPersistence(convId);
  try {
    await provider.prompt(convId, prompt, { mode: "craft", permission: a.permission || "default" });
    // agent 的 message_end 事件在 provider.prompt 的 promise resolve 之后才发出，
    // 等一小段时间让其落库，再读摘要
    await new Promise((r) => setTimeout(r, 3000));
    const msgs = getMessages(convId);
    const last = msgs.filter((m) => m.role === "assistant").pop();
    finishRun(runId, "completed", last?.content ? last.content.slice(0, 60) : "已触发执行");
  } catch (e) {
    finishRun(runId, "failed", (e as Error).message);
  } finally {
    // 退订要推迟：message_end 在 prompt promise resolve 之后才发，立即退订会漏掉落库
    setTimeout(() => { try { unsub(); } catch {} }, 20000);
  }
}

/** 触发执行一个自动化：创建临时会话 → 落库执行 → 记录运行结果 */
async function executeAutomation(a: Automation): Promise<void> {
  if (!a.prompt && !a.actionConfig.prompt && a.actionType !== "skill") return;
  const conv = createConversation(`[自动] ${a.name}`, "automation", a.workspaceId);
  const run = createRun(a.id, conv.id);
  await runAutomationWithPersistence(a, conv.id, run.id);
}

/** 初始化自动化的 next_run */
export function initAutomationNextRun(a: Automation): void {
  if (!a.enabled || a.triggerType !== "cron") return;
  const now = Date.now();
  if (!isWithinValidity(a, now)) return;
  if (a.scheduleType === "once") {
    const t = a.triggerConfig.onceAt;
    if (t && t > now) updateAutomation(a.id, { nextRun: t });
    else if (t && t <= now) updateAutomation(a.id, { nextRun: null, enabled: false });
  } else if (a.scheduleType === "interval") {
    const mins = a.triggerConfig.intervalMinutes ?? 30;
    updateAutomation(a.id, { nextRun: now + mins * 60 * 1000 });
  } else if (a.scheduleType === "cron" && a.triggerConfig.cron) {
    const nt = nextCronTime(a.triggerConfig.cron, new Date());
    if (nt) updateAutomation(a.id, { nextRun: nt.getTime() });
  }
}

/** 启动调度器（应用启动时调用一次） */
export function startScheduler(): void {
  if (timer !== null) return;
  // 初始化所有启用自动化的 next_run（若为空）
  for (const a of listEnabledCronAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  for (const a of listEnabledIntervalAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  for (const a of listEnabledOnceAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  timer = setInterval(async () => {
    const now = Date.now();
    const due = listDueAutomations(now).filter((a) => isWithinValidity(a, now));
    for (const a of due) {
      console.log(`[scheduler] 触发自动化: ${a.name}`);
      await executeAutomation(a);
      // 更新 lastRun / nextRun
      if (a.scheduleType === "once") {
        updateAutomation(a.id, { lastRun: now, nextRun: null, enabled: false });
      } else if (a.scheduleType === "interval") {
        const mins = a.triggerConfig.intervalMinutes ?? 30;
        updateAutomation(a.id, { lastRun: now, nextRun: now + mins * 60 * 1000 });
      } else {
        const nt = a.triggerConfig.cron ? nextCronTime(a.triggerConfig.cron, new Date(now)) : null;
        updateAutomation(a.id, { lastRun: now, nextRun: nt ? nt.getTime() : null });
      }
    }
  }, 30000);
  console.log("[scheduler] 自动化调度器已启动（30s 扫描）");
}

export function stopScheduler(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
}
