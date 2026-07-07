// src/domains/memory/node/store.ts
// 记忆存储。对照 03 文档 §4.3：UserMemory（跨会话长期记忆）。
// MVP 简化：全量召回（P1 加缓存/向量召回）。

import { getDb } from "../../../infra/db.ts";

export interface Memory {
  id: string;
  scope: string;
  kind: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** 写入记忆 */
export function writeMemory(content: string, kind = "fact", scope = "user"): Memory {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO memories (id, scope, kind, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, scope, kind, content, now, now);
  return { id, scope, kind, content, createdAt: now, updatedAt: now };
}

/** 召回全部记忆（MVP 全量；P1 加 query 向量召回 + 缓存） */
export function recallMemories(): Memory[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, scope, kind, content, created_at as createdAt, updated_at as updatedAt FROM memories ORDER BY updated_at DESC",
  ).all() as unknown as Memory[];
}

/** 删除记忆 */
export function deleteMemory(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}
