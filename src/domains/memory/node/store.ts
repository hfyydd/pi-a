// src/domains/memory/node/store.ts
// 记忆存储。对照 WorkBuddy 四层记忆的简化版：
// - scope="user"：跨会话长期记忆（用户偏好、事实）
// - scope="working"：任务级工作记忆（当前会话临时数据，可手动清除）
// - scope="project"：项目级记忆（关联特定项目，P2）
// 召回带缓存（5 分钟 TTL，写操作自动失效）

import { getDb } from "../../../infra/db.ts";

export interface Memory {
  id: string;
  scope: string;   // user | working | project
  kind: string;    // fact | preference | note | task
  content: string;
  createdAt: number;
  updatedAt: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

// ===== 缓存（5 分钟 TTL）=====
let cache: { data: Memory[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function invalidateCache() { cache = null; }

function getCached(): Memory[] | null {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  return null;
}

/** 写入记忆 */
export function writeMemory(content: string, kind = "fact", scope = "user"): Memory {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO memories (id, scope, kind, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, scope, kind, content, now, now);
  invalidateCache();
  return { id, scope, kind, content, createdAt: now, updatedAt: now };
}

/** 召回长期记忆（scope=user，带缓存） */
export function recallMemories(): Memory[] {
  const cached = getCached();
  if (cached) return cached;
  const db = getDb();
  const data = db.prepare(
    "SELECT id, scope, kind, content, created_at as createdAt, updated_at as updatedAt FROM memories WHERE scope = 'user' ORDER BY updated_at DESC",
  ).all() as unknown as Memory[];
  cache = { data, ts: Date.now() };
  return data;
}

/** 召回工作记忆（scope=working） */
export function recallWorkingMemory(): Memory[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, scope, kind, content, created_at as createdAt, updated_at as updatedAt FROM memories WHERE scope = 'working' ORDER BY created_at DESC",
  ).all() as unknown as Memory[];
}

/** 召回所有记忆（含 working + user，用于注入系统提示） */
export function recallAllMemories(): Memory[] {
  const cached = getCached();
  if (cached) {
    const working = recallWorkingMemory();
    return [...working, ...cached];
  }
  const db = getDb();
  const data = db.prepare(
    "SELECT id, scope, kind, content, created_at as createdAt, updated_at as updatedAt FROM memories ORDER BY updated_at DESC",
  ).all() as unknown as Memory[];
  return data;
}

/** 清除某会话的工作记忆（会话结束时调用） */
export function clearWorkingMemory(): void {
  const db = getDb();
  db.prepare("DELETE FROM memories WHERE scope = 'working'").run();
  invalidateCache();
}

/** 列出所有记忆（管理面板用，不分 scope） */
export function listAllMemories(): Memory[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, scope, kind, content, created_at as createdAt, updated_at as updatedAt FROM memories ORDER BY updated_at DESC",
  ).all() as unknown as Memory[];
}

/** 删除记忆 */
export function deleteMemory(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  invalidateCache();
}
