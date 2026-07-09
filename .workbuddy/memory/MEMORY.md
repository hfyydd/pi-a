# Pi-a 项目长期记忆

## 项目概览
Pi-a = 本地优先 AI 桌面助手，Deno Desktop 架构（main.ts 起 Deno.serve HTTP API + Deno.BrowserWindow 加载 renderer）。对标 WorkBuddy，非 Electron/Tauri。开发计划见 docs/08-对标WorkBuddy开发计划.md（5 个 Sprint，23 个功能）。

## 关键架构约定
- **事件流**：provider.onEvent 走 listeners Set 订阅。SSE（/api/events/:id/stream）和 getQueue（onEvent→push queue）都订阅 provider.onEvent。外部注入事件（如 tool_confirmation）必须用 `provider.emitEvent()` 广播，不能只 push queue——否则 SSE 建立后只订阅 onEvent 不再 splice queue，事件会卡住。
- **renderer 重新生成**：改 renderer/index.html 后必须 `deno task gen:renderer` 重新生成 src/ui/renderer.ts（main.ts import RENDERER_HTML）。忘掉这步会导致前端改动不生效。
- **DB**：~/.pi-a/pi-a.db（node:sqlite，WAL 模式）。schema 在 src/infra/db.ts initDb，幂等。加列用 addColumn（SQLite 不支持 ADD COLUMN IF NOT EXISTS）。
- **技能**：~/.pi-a/skills/<name>/SKILL.md（frontmatter name+description + markdown body）。5 个内置技能在 src/agent/skills.ts writeBuiltinSkills。加载用 pi-coding-agent 的 loadSkills。
- **启动**：`deno task desktop` 编译打包 pi-a.app 并签名，但打包后父进程退出不自动开窗，需再 `open pi-a.app`。运行进程名 laufey_webview。重启：先 pkill laufey_webview，再 deno task desktop，再 open。
- **权限三层**：readonly(L1)/default(L2)/full(L3)。readonly 拦截所有写工具；default 写工具走确认弹窗（tool_confirmation 事件）；full 全放行。危险命令黑名单 DANGEROUS_PATTERNS 所有级别强制拦截。
- **UI 图标规范（用户强约束）**：**严禁用 emoji 作 UI 图标**。所有控件图标/状态指示/头像/工作空间图标必须用 lucide-react 线性图标（与 WorkBuddy 同款）。交付前必须自查 emoji 残留、重复元素、逻辑自洽。用户极度反感"AI 自动生成的廉价感"。

## 进度
- Sprint 1（P0 价值闭环）：✅ 全部完成（SSE/导出/PDF读/项目/专家）
- Sprint 2（差异化能力）：✅ 全部完成（权限三层/记忆分层/会话分叉/技能编辑器）
- Sprint 3（自动化与控制）：✅ 功能8 自动化 / ✅功能13 Computer Use / ✅功能17 文件快照 / ⏳功能9 速唤浮窗待 spike（Deno 全局热键 API 不确定）
- Sprint 4（深度与工程化）：✅全部完成（功能11 docx/pptx编辑 / 功能12 PDF导出 / 功能18 RAG(TF-IDF MVP) / 功能15 会话恢复）
- Sprint 5：未开始（Sidecar/可观测性/桌面集成等）
