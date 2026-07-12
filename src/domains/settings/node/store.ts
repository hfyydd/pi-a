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

let caffeinateProcess: Deno.ChildProcess | null = null;

/** 开启/关闭系统锁屏防睡眠 (macOS caffeinate) */
export function applyKeepAwake(enabled: boolean) {
  if (Deno.build.os !== "darwin") {
    return; // caffeinate is macOS-specific
  }
  if (enabled) {
    if (caffeinateProcess) return;
    try {
      console.log("[keep-awake] Starting caffeinate process to prevent system and display sleep...");
      const cmd = new Deno.Command("caffeinate", {
        args: ["-d", "-i"], // -d: prevent display sleep, -i: prevent idle sleep
        stdout: "null",
        stderr: "null",
      });
      caffeinateProcess = cmd.spawn();
    } catch (e) {
      console.warn("[keep-awake] Failed to start caffeinate:", (e as Error).message);
    }
  } else {
    if (!caffeinateProcess) return;
    try {
      console.log("[keep-awake] Stopping caffeinate process...");
      caffeinateProcess.kill();
      caffeinateProcess = null;
    } catch (e) {
      console.warn("[keep-awake] Failed to stop caffeinate:", (e as Error).message);
    }
  }
}

/** 写入/更新配置项 */
export function setSetting(key: string, val: string): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    ).run(key, val, val);

    if (key === "keep_awake") {
      applyKeepAwake(val === "true");
    }
  } catch (e) {
    console.warn(`[settings] 写入 ${key} 失败:`, (e as Error).message);
  }
}
