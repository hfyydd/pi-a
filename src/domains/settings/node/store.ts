// src/domains/settings/node/store.ts
// 全局设置存储。基于 SQLite settings 表。

import { getDb } from "../../../infra/db.ts";

/** 获取配置项，若不存在则返回默认值 */
export function getSetting(key: string, defaultVal: string): string {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : defaultVal;
  } catch (e) {
    console.warn(`[settings] 读取 ${key} 失败:`, (e as Error).message);
    return defaultVal;
  }
}

/** 写入/更新配置项 */
export function setSetting(key: string, val: string): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    ).run(key, val, val);
  } catch (e) {
    console.warn(`[settings] 写入 ${key} 失败:`, (e as Error).message);
  }
}
