import pty from "@lydell/node-pty";
try {
  const proc = pty.spawn("echo", ["pty-ok"], { cwd: "/tmp" });
  let out = "";
  proc.onData((d: string) => out += d);
  proc.onExit(() => console.log("✓ pty.spawn 可用, 输出:", JSON.stringify(out.trim())));
} catch (e) {
  console.log("✗", (e as Error).message.split("\n")[0].slice(0, 150));
}
setTimeout(() => {}, 2000);
