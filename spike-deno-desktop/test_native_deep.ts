// 深度测试: 各 native 模块的实际调用能力(不只是 import)
console.log("=== 1. better-sqlite3 实例化 ===");
try {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  console.log("  ✓ 可用");
  db.close();
} catch (e) {
  console.log("  ✗ 不可用:", (e as Error).message.split("\n")[0].slice(0, 180));
}

console.log("\n=== 2. Deno 原生 SQLite (node:sqlite) ===");
try {
  // Deno 2.9 支持 node:sqlite (实验性)
  // @ts-ignore
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (name TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("测试");
  const row = db.prepare("SELECT * FROM t").get();
  console.log("  ✓ node:sqlite 可用! 数据:", JSON.stringify(row));
  db.close();
} catch (e) {
  console.log("  ✗ node:sqlite 不可用:", (e as Error).message.split("\n")[0].slice(0, 180));
}

console.log("\n=== 3. node-pty 实际 spawn ===");
try {
  const pty = (await import("@lydell/node-pty")).default;
  const proc = pty.spawn("echo", ["hello-from-pty"], { cwd: "/tmp" });
  let output = "";
  proc.onData((d: string) => { output += d; });
  proc.onExit(() => {
    console.log("  ✓ pty.spawn 成功, 输出:", JSON.stringify(output.trim()));
  });
  await new Promise((r) => setTimeout(r, 1500));
} catch (e) {
  console.log("  ✗ pty.spawn 失败:", (e as Error).message.split("\n")[0].slice(0, 180));
}

console.log("\n=== 4. keytar 实际调用 ===");
try {
  const keytar = await import("keytar");
  await keytar.setPassword("workbuddy-test", "user1", "secret123");
  const pwd = await keytar.getPassword("workbuddy-test", "user1");
  console.log("  ✓ keytar 可用, 读回:", pwd);
  await keytar.deletePassword("workbuddy-test", "user1");
} catch (e) {
  console.log("  ✗ keytar 失败:", (e as Error).message.split("\n")[0].slice(0, 180));
}

console.log("\n深度测试完成");
