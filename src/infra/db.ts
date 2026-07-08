// src/infra/db.ts
// node:sqlite 封装（spike 验证 DatabaseSync 可用，替代 better-sqlite3）
// MVP：初始化 + tool_audit_log 表验证连通。完整 schema 见 03 文档 §六

import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

const DATA_DIR = (() => {
  const home = Deno.env.get("HOME") ?? "/tmp";
  return `${home}/.pi-a`;
})();

const DB_PATH = `${DATA_DIR}/pi-a.db`;

/** 幂等加列：SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 try/catch 兜底 */
function addColumn(table: string, col: string, def: string) {
  try { db!.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
  catch { /* 列已存在 */ }
}

/** 初始化数据库（幂等） */
export function initDb(): DatabaseSync {
  if (db) return db;

  // 确保 data 目录存在
  try {
    Deno.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* 已存在 */ }

  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");

  // MVP 最小 schema：工具审计日志（验证连通）
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      args TEXT,
      is_error INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      category TEXT NOT NULL DEFAULT 'assistant',
      model_provider TEXT DEFAULT 'deepseek',
      model_id TEXT DEFAULT 'deepseek-v4-flash',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_cat ON conversations(category);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      is_error INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'user',
      kind TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'docx',
      bytes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (artifact_id, version),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_versions_art ON artifact_versions(artifact_id);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      dir_path TEXT DEFAULT '',
      color TEXT DEFAULT '#3b82f6',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_forks (
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      from_msg TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (src, dst)
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL,
      last_run INTEGER,
      next_run INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      summary TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auto_runs_aid ON automation_runs(automation_id);

    CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snap_path ON file_snapshots(original_path);

    CREATE TABLE IF NOT EXISTS doc_chunks (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      keywords TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_path);
  `);

  // 补 conversations.project_id 列
  addColumn("conversations", "project_id", "TEXT");
  // 补 conversations.expert_id 列（专家模式）
  addColumn("conversations", "expert_id", "TEXT");
  // 补 messages.branch_id 列（会话分叉/消息树）
  addColumn("messages", "branch_id", "TEXT DEFAULT 'main'");
  // 补 messages.parent_id 列（会话分叉：记录消息树形父节点）
  addColumn("messages", "parent_id", "TEXT");

  // 兼容旧库：补 category 列（已存在则跳过）
  addColumn("conversations", "category", "TEXT NOT NULL DEFAULT 'assistant'");
  // 补 status 列（会话状态：idle/running/done/failed/pending/planning）
  addColumn("conversations", "status", "TEXT NOT NULL DEFAULT 'idle'");

  console.log(`[db] 已初始化: ${DB_PATH}`);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) return initDb();
  return db;
}

/** 记录工具调用审计 */
export function logToolAudit(toolName: string, args: unknown, isError: boolean): void {
  try {
    const d = getDb();
    d.prepare(
      "INSERT INTO tool_audit_log (tool_name, args, is_error, created_at) VALUES (?, ?, ?, ?)",
    ).run(toolName, JSON.stringify(args ?? {}), isError ? 1 : 0, Date.now());
  } catch (e) {
    console.warn("[db] 审计写入失败:", (e as Error).message);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
