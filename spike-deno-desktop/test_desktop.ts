// deno desktop 集成测试: BrowserWindow + win.bind + pi + node:sqlite 一起跑
// 验证: in-process bindings 能否把 pi agent 事件流推到 UI

// @ts-ignore
const { Agent } = await import("npm:@earendil-works/pi-agent-core@0.80.3");
// @ts-ignore
const { createModels } = await import("npm:@earendil-works/pi-ai@0.80.3");
// @ts-ignore
const { deepseekProvider } = await import("npm:@earendil-works/pi-ai@0.80.3/providers/deepseek");
const { DatabaseSync } = await import("node:sqlite");

// 1. 验证 BrowserWindow 与 win.bind 是否存在
console.log("=== Deno.BrowserWindow 存在性 ===");
console.log("  Deno.BrowserWindow:", typeof (Deno as any).BrowserWindow);
console.log("  Deno.Tray:", typeof (Deno as any).Tray);
console.log("  Deno.globalShortcut:", typeof (Deno as any).globalShortcut);

// 2. node:sqlite 验证
console.log("\n=== node:sqlite ===");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE msgs (role TEXT, content TEXT)");
db.prepare("INSERT INTO msgs VALUES (?,?)").run("user", "hello");
console.log("  ✓ sqlite 查询:", JSON.stringify(db.prepare("SELECT * FROM msgs").get()));
db.close();

// 3. pi Agent (不发真实请求,验证在 desktop 上下文实例化)
console.log("\n=== pi Agent 实例化 ===");
const models = createModels();
models.setProvider(deepseekProvider());
const model = models.getModel("deepseek", "deepseek-v4-flash");
const agent = new Agent({ initialState: { model, systemPrompt: "test", tools: [] } });
console.log("  ✓ Agent 可用, prompt:", typeof agent.prompt, "subscribe:", typeof agent.subscribe);

// 4. HTTP serve + win.bind (核心: in-process bindings)
let bindCallCount = 0;
let windowRef: any = null;

Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px">
        <h2>WorkBuddy Spike · deno desktop 集成</h2>
        <p>✓ BrowserWindow 已开</p>
        <p>✓ node:sqlite 工作</p>
        <p>✓ pi Agent 已实例化</p>
        <p>bind 调用次数: <span id="c">0</span></p>
        <p>agent 状态: <span id="s">idle</span></p>
        <button onclick="bindings.ping().then(n=>document.getElementById('c').textContent=n)">
          测试 in-process binding
        </button>
        <script>
          // bindings 由 deno desktop 注入
          console.log('bindings 可用:', typeof bindings);
        </script>
      </body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return new Response("404", { status: 404 });
});

// 尝试 win.bind(若 BrowserWindow 可用)
if (typeof (Deno as any).BrowserWindow !== "undefined") {
  try {
    const win = new (Deno as any).BrowserWindow({ title: "WorkBuddy Spike" });
    windowRef = win;
    win.bind("ping", async () => {
      bindCallCount++;
      return bindCallCount;
    });
    win.bind("getAgentState", async () => ({
      isStreaming: agent.state.isStreaming,
      pendingTools: [...agent.state.pendingToolCalls],
    }));
    console.log("\n=== win.bind 注册成功 ===");
    console.log("  ✓ 'ping' / 'getAgentState' 已暴露给 webview");
  } catch (e) {
    console.log("\n  ✗ BrowserWindow/bind 失败:", (e as Error).message?.slice(0, 200));
  }
} else {
  console.log("\n  ⚠ Deno.BrowserWindow 不可用(可能需 deno desktop 运行时而非 deno run)");
}

console.log("\n集成测试就绪, 保持运行 8 秒...");
await new Promise((r) => setTimeout(r, 8000));
console.log("完成, 退出");
if (windowRef) try { windowRef.close?.(); } catch {}
Deno.exit(0);
