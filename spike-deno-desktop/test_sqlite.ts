// 测试: Node 原生模块在 Deno 能否加载
// 这是 deno desktop 路线的关键风险点

console.log("=== 测试 1: better-sqlite3 (Node 原生模块 .node) ===");
try {
  // 需要 node_modules 目录 + allow-scripts 安装原生绑定
  const Database = (await import("npm:better-sqlite3@12.8.0")).default;
  console.log("  ✓ better-sqlite3 import 成功, 类型:", typeof Database);
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  db.prepare("INSERT INTO t (name) VALUES (?)").run("测试");
  const row = db.prepare("SELECT * FROM t").get() as any;
  console.log("  ✓ 建表/插入/查询成功:", JSON.stringify(row));
  db.close();
} catch (e) {
  console.log("  ✗ 失败:", (e as Error).message?.slice(0, 250));
}

console.log("\n=== 测试 2: Deno 内置 SQLite (Deno.openKv / 原生) ===");
try {
  const kv = await Deno.openKv(":memory:");
  await kv.set(["test", "key"], { value: "hello" });
  const entry = await kv.get(["test", "key"]);
  console.log("  ✓ Deno KV 成功:", JSON.stringify(entry.value));
  kv.close();
} catch (e) {
  console.log("  ⚠ Deno KV:", (e as Error).message?.slice(0, 150));
}

console.log("\n=== 测试 3: node-pty (终端, 关键 OS 能力) ===");
try {
  // @ts-ignore
  const pty = (await import("npm:@lydell/node-pty@1.2.0-beta.12")).default;
  console.log("  ✓ node-pty import 成功, 类型:", typeof pty, typeof pty.spawn);
} catch (e) {
  console.log("  ✗ 失败:", (e as Error).message?.slice(0, 250));
}

console.log("\n=== 测试 4: keytar (keychain, 原生模块) ===");
try {
  const keytar = await import("npm:keytar@7.9.0");
  console.log("  ✓ keytar import 成功");
} catch (e) {
  console.log("  ✗ 失败:", (e as Error).message?.slice(0, 250));
}

console.log("\n全部原生模块测试完成");
