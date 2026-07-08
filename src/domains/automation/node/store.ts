// src/domains/automation/node/store.ts
// 自动化 CRUD + 运行记录。对照 08 计划功能 8 + WorkBuddy 子系统⑬。

import { getDb } from "../../../infra/db.ts";

export type TriggerType = "cron" | "file_watch";
export type ActionType = "prompt" | "skill";
export type RunStatus = "inProgress" | "completed" | "failed";

export interface TriggerConfig {
  cron?: string;        // "*/5 * * * *" 5 段：分 时 日 月 周
  path?: string;        // file_watch: 监听目录
  pattern?: string;     // file_watch: 文件名 glob
}
export interface ActionConfig {
  prompt?: string;      // action_type=prompt
  skill?: string;       // action_type=skill
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actionType: ActionType;
  actionConfig: ActionConfig;
  lastRun: number | null;
  nextRun: number | null;
  createdAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: RunStatus;
  sessionId: string | null;
  summary: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function uuid(): string { return crypto.randomUUID(); }

function rowToAutomation(r: any): Automation {
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    triggerType: r.trigger_type,
    triggerConfig: JSON.parse(r.trigger_config || "{}"),
    actionType: r.action_type,
    actionConfig: JSON.parse(r.action_config || "{}"),
    lastRun: r.last_run ?? null,
    nextRun: r.next_run ?? null,
    createdAt: r.created_at,
  };
}

export function listAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations ORDER BY created_at DESC").all() as any[]).map(rowToAutomation);
}

export function getAutomation(id: string): Automation | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as any;
  return r ? rowToAutomation(r) : null;
}

export function createAutomation(a: {
  name: string;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actionType: ActionType;
  actionConfig: ActionConfig;
}): Automation {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO automations (id, name, enabled, trigger_type, trigger_config, action_type, action_config, last_run, next_run, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, NULL, NULL, ?)",
  ).run(id, a.name, a.triggerType, JSON.stringify(a.triggerConfig), a.actionType, JSON.stringify(a.actionConfig), now);
  return getAutomation(id)!;
}

export function updateAutomation(id: string, patch: Partial<{
  name: string; enabled: boolean; triggerType: TriggerType;
  triggerConfig: TriggerConfig; actionType: ActionType; actionConfig: ActionConfig;
  lastRun: number | null; nextRun: number | null;
}>): void {
  const db = getDb();
  const cur = getAutomation(id);
  if (!cur) throw new Error("自动化不存在");
  const merged = {
    name: patch.name ?? cur.name,
    enabled: patch.enabled ?? cur.enabled,
    triggerType: patch.triggerType ?? cur.triggerType,
    triggerConfig: patch.triggerConfig ?? cur.triggerConfig,
    actionType: patch.actionType ?? cur.actionType,
    actionConfig: patch.actionConfig ?? cur.actionConfig,
    lastRun: patch.lastRun ?? cur.lastRun,
    nextRun: patch.nextRun ?? cur.nextRun,
  };
  db.prepare(
    "UPDATE automations SET name=?, enabled=?, trigger_type=?, trigger_config=?, action_type=?, action_config=?, last_run=?, next_run=? WHERE id=?",
  ).run(merged.name, merged.enabled ? 1 : 0, merged.triggerType, JSON.stringify(merged.triggerConfig), merged.actionType, JSON.stringify(merged.actionConfig), merged.lastRun, merged.nextRun, id);
}

export function deleteAutomation(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM automations WHERE id = ?").run(id);
}

export function listRuns(automationId: string, limit = 50): AutomationRun[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, automation_id as automationId, status, session_id as sessionId, summary, started_at as startedAt, finished_at as finishedAt FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?",
  ).all(automationId, limit) as unknown as AutomationRun[];
}

export function createRun(automationId: string, sessionId: string | null): AutomationRun {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO automation_runs (id, automation_id, status, session_id, summary, started_at, finished_at) VALUES (?, ?, ?, ?, NULL, ?, NULL)",
  ).run(id, automationId, "inProgress", sessionId, now);
  return { id, automationId, status: "inProgress", sessionId, summary: null, startedAt: now, finishedAt: null };
}

export function finishRun(runId: string, status: RunStatus, summary: string | null): void {
  const db = getDb();
  db.prepare("UPDATE automation_runs SET status=?, summary=?, finished_at=? WHERE id=?").run(status, summary, Date.now(), runId);
}

/** 列出所有到期（next_run <= now）的启用 cron 自动化 */
export function listDueAutomations(now: number): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron' AND next_run IS NOT NULL AND next_run <= ?").all(now) as any[]).map(rowToAutomation);
}

/** 列出所有启用的 cron 自动化（用于初始化 next_run） */
export function listEnabledCronAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron'").all() as any[]).map(rowToAutomation);
}
