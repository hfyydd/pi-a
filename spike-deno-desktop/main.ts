// WorkBuddy · deno desktop 最小 spike
// 目标: 验证 deno desktop 能否开窗口 + 跑 pi
// 阶段 1: Hello window (验证 deno desktop 基础能力)

Deno.serve(() =>
  new Response(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
       <h1>WorkBuddy Spike · deno desktop</h1>
       <p>阶段 1: 基础窗口已打开 ✓</p>
       <p>当前时间: ${new Date().toLocaleString("zh-CN")}</p>
       <p>Deno 版本: ${Deno.version.deno}</p>
     </body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
);
