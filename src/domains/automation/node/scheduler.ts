// src/domains/automation/node/scheduler.ts
// 自动化调度器。对照 08 计划功能 8 + WorkBuddy 子系统⑬。
// 30s 扫描一次，对 next_run <= now 的 cron 自动化触发执行。
// cron 解析：5 段 "分 时 日 月 周"，支持 * / 数字 / */n / a-b / a,b。

import {
  listEnabledCronAutomations, listDueAutomations, updateAutomation,
  createRun, finishRun, type Automation,
} from "./store.ts";
import { createConversation } from "../../session/node/store.ts";
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

/** 触发执行一个自动化：创建临时会话 → provider.prompt → 记录运行结果 */
async function executeAutomation(a: Automation): Promise<void> {
  const prompt = a.actionType === "skill"
    ? `【执行技能】${a.actionConfig.skill || ""}`
    : (a.actionConfig.prompt || "");
  if (!prompt) return;
  const conv = createConversation(`[自动] ${a.name}`, "automation");
  const run = createRun(a.id, conv.id);
  try {
    await provider.prompt(conv.id, prompt, { mode: "craft", permission: "default" });
    finishRun(run.id, "completed", "已触发执行");
  } catch (e) {
    finishRun(run.id, "failed", (e as Error).message);
  }
}

/** 启动调度器（应用启动时调用一次） */
export function startScheduler(): void {
  if (timer !== null) return;
  // 初始化所有启用 cron 自动化的 next_run（若为空）
  for (const a of listEnabledCronAutomations()) {
    if (a.nextRun === null && a.triggerConfig.cron) {
      const nt = nextCronTime(a.triggerConfig.cron, new Date());
      if (nt) updateAutomation(a.id, { nextRun: nt.getTime() });
    }
  }
  timer = setInterval(async () => {
    const now = Date.now();
    const due = listDueAutomations(now);
    for (const a of due) {
      console.log(`[scheduler] 触发自动化: ${a.name}`);
      await executeAutomation(a);
      const nt = a.triggerConfig.cron ? nextCronTime(a.triggerConfig.cron, new Date(now)) : null;
      updateAutomation(a.id, { lastRun: now, nextRun: nt ? nt.getTime() : null });
    }
  }, 30000);
  console.log("[scheduler] 自动化调度器已启动（30s 扫描）");
}

export function stopScheduler(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
}
