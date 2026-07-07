// src/domains/session/node/store.ts
// 会话持久化。对照 03 文档 §4.5：SQLite 元数据 + provider 内存态。

import { getDb } from "../../../infra/db.ts";

export interface Conversation {
  id: string;
  title: string;
  category: string; // assistant | project | expert | automation
  status: string;   // idle | running | done | failed | pending | planning
  modelProvider: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError: boolean;
  createdAt: number;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** 新建会话 */
export function createConversation(title = "新对话", category = "assistant"): Conversation {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  
  // 查询全局默认模型设置
  let provider = "deepseek";
  let modelId = "deepseek-v4-flash";
  try {
    const rowProv = db.prepare("SELECT value FROM settings WHERE key = 'default_provider'").get() as { value: string } | undefined;
    const rowModel = db.prepare("SELECT value FROM settings WHERE key = 'default_model_id'").get() as { value: string } | undefined;
    if (rowProv) provider = rowProv.value;
    if (rowModel) modelId = rowModel.value;
  } catch { /* 表不存在或未初始化 */ }

  db.prepare(
    "INSERT INTO conversations (id, title, category, status, model_provider, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, title, category, "idle", provider, modelId, now, now);
  return { id, title, category, status: "idle", modelProvider: provider, modelId: modelId, createdAt: now, updatedAt: now };
}

/** 列出会话（可按分类/状态筛选 + 关键词搜索，按更新时间倒序） */
export function listConversations(category?: string, search?: string, status?: string): Conversation[] {
  const db = getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (category && category !== "all") { conds.push("category = ?"); params.push(category); }
  if (search && search.trim()) { conds.push("LOWER(title) LIKE ?"); params.push(`%${search.trim().toLowerCase()}%`); }
  if (status && status !== "all") { conds.push("status = ?"); params.push(status); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const stmt = db.prepare(
    `SELECT id, title, category, status, model_provider as modelProvider, model_id as modelId, created_at as createdAt, updated_at as updatedAt FROM conversations ${where} ORDER BY updated_at DESC`,
  );
  const rows = stmt.all(...(params as any[])) as unknown as Conversation[];
  return rows;
}

/** 重命名 */
export function renameConversation(id: string, title: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), id);
}

/** 更改分类 */
export function moveConversation(id: string, category: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET category = ?, updated_at = ? WHERE id = ?").run(category, Date.now(), id);
}

/** 删除会话及其消息 */
export function deleteConversation(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

/** 触摸更新时间 */
export function touchConversation(id: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

/** 更新会话状态 */
export function updateConversationStatus(id: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

/** 记录一条消息 */
export function appendMessage(
  conversationId: string,
  role: string,
  content: string,
  opts?: { toolName?: string; toolArgs?: string; isError?: boolean },
): MessageRecord {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, tool_name, tool_args, is_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    conversationId,
    role,
    content,
    opts?.toolName ?? null,
    opts?.toolArgs ?? null,
    opts?.isError ? 1 : 0,
    now,
  );
  touchConversation(conversationId);
  return {
    id, conversationId, role, content,
    toolName: opts?.toolName, toolArgs: opts?.toolArgs,
    isError: opts?.isError ?? false, createdAt: now,
  };
}

/** 读取会话历史消息 */
export function getMessages(conversationId: string): MessageRecord[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, conversation_id as conversationId, role, content, tool_name as toolName, tool_args as toolArgs, is_error as isError, created_at as createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
  ).all(conversationId) as unknown as MessageRecord[];
}
