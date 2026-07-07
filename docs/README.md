# WorkBuddy —— 智能体桌面产品设计方案

> 基于 **pi**（极简 agent 工具包）+ **deno desktop** 打造的 AI 原生桌面工作台。
> 目标：做一款**极简、可靠、能真正动手干活、不绑生态**的中文知识工作者桌面智能体。
> 直接对标产品：腾讯 [WorkBuddy](https://cloud.tencent.com/developer/article/2638618)（已逆向调研，见 [00](./00-WorkBuddy逆向调研.md)）。

---

## 这份文档是什么

WorkBuddy 项目的**前期设计阶段产出**。市场调研 + 直接竞品逆向 + 产品设计 + 技术架构 + 落地路线，全部做细做透，作为编码依据。

| # | 文档 | 核心回答的问题 |
|---|------|----------------|
| 00 | [WorkBuddy（腾讯）逆向调研](./00-WorkBuddy逆向调研.md) | 直接竞品用什么技术、怎么做到的、我们如何对等并差异化 |
| 01 | [市场调研与产品定位](./01-市场调研与产品定位.md) | 市场有什么、机会在哪、我们定位与差异化 |
| 02 | [产品架构与功能设计](./02-产品架构与功能设计.md) | WorkBuddy 长什么样、有哪些模块、用户怎么用 |
| 03 | [技术架构设计](./03-技术架构设计.md) | pi 怎么嵌进 deno desktop、in-process bindings、数据流、扩展机制 |
| 04 | [文档处理引擎](./04-文档处理引擎.md) | docx/xlsx/pptx/pdf 怎么读、怎么写、怎么编辑 |
| 05 | [OS 自动化与权限](./05-OS自动化与权限.md) | 怎么操控电脑、权限与安全模型 |
| 06 | [MVP 与路线图](./06-MVP与路线图.md) | 先做什么、后做什么、里程碑、风险 |

---

## 核心判断（一句话版）

> **腾讯 WorkBuddy 证明了"自然语言操控电脑 + 文档自动化 + IM 远程驱动"的市场需求真实存在，且用 Electron + TS agent 框架（@openai/agents）+ MCP + sidecar runtime 做成了。我们用 deno desktop（in-process bindings，零 IPC）+ pi（极简可靠）+ 开源文档引擎做一款同类产品，差异化在：pi 更极简、模型完全自由（不绑混元）、不绑腾讯/飞书生态、核心开源、轻量（~40MB）。**

## 三大支柱

```
        ┌─────────────────────────────────────────────┐
        │              WorkBuddy 三大支柱              │
        ├──────────────┬──────────────┬───────────────┤
        │  ① pi 极简可靠 │  ② 深度 OS    │  ③ 文档引擎   │
        │              │   自动化      │   (读写编辑)   │
        │ 做减法:       │ Computer Use │ docx/xlsx     │
        │ · 更少工具    │ 终端/脚本     │ pptx/pdf      │
        │ · 更短 prompt │ 屏幕/剪贴板   │ 本地优先       │
        │ · 拒绝花哨    │ 跨 App 编排   │               │
        │   planning   │ 权限沙箱      │               │
        │              │              │               │
        │ → 对冲 agent  │ → 真正"能动手"│ → 替代腾讯     │
        │   不可靠痛点  │              │   docs-engine  │
        └──────────────┴──────────────┴───────────────┘
```

## 技术选型（参考 WorkBuddy 逆向 + pi 源码核验 + deno desktop spike）

| 层 | 选型 | 对照 WorkBuddy | 理由 |
|----|------|----------------|------|
| 桌面框架 | **deno desktop 2.9** | Electron | **in-process bindings（零 IPC）+ ~40MB 包体 + 单机交叉编译 + 内置更新**；spike 验证 |
| UI↔后端通信 | **win.bind in-process bindings** | ipcMain/ipcRenderer | 同进程通道，无 socket 往返；与"钩子直调"哲学契合；spike 验证 |
| Agent 内核 | **pi** v0.80.3 (`pi-agent-core` + `pi-ai`) | `@openai/agents` | pi 更极简、中文 provider 原生全覆盖、可嵌入；spike 验证在 Deno 可跑 |
| MCP | MVP 不做，P1 `@modelcontextprotocol/sdk` | ✅ 同（1.24） | 按需 |
| 文档引擎 | **开源栈自建**：JS(docx/xlsx/pptxgenjs) + Python sidecar(P1) | `@tencent/docs-engine`(闭源) | 腾讯引擎闭源不可用；开源栈，不绑生态，详见 [04] |
| OS 能力 | `@lydell/node-pty` + Deno.Tray + Deno API | ✅ 同（node-pty） | 终端/托盘 spike 验证；全局热键暂缺（P1 FFI） |
| 存储 | **node:sqlite**（Deno 内置 DatabaseSync） | better-sqlite3 | spike 验证 better-sqlite3 在 Deno 不兼容，node:sqlite 完美替代 |
| HTTP | **Deno 原生 fetch** + provider 官方 SDK | undici | Deno 内置，无 CORS |
| 前端 | React + TypeScript | React（推断） | 生态最大、与 pi(TS) 契合 |
| 模板 | nunjucks（prompt/文档模板） | ✅ 同 | 与 WorkBuddy 一致 |
| Keychain | keytar | — | spike 验证可用 |
| 自动更新 | **Deno.autoUpdate**（内置 bsdiff + 回滚） | electron-updater + Squirrel | deno desktop 内置 |
| 监控 | MVP console；P1 OpenTelemetry | ✅ 同 | 分阶段 |

**技术栈演进说明**：本方案桌面框架经历三轮决策，最终落到 deno desktop：
1. **Tauri**（初版）→ 弃：pi LLM 网络层在 Tauri WebView 被 CORS 拦截，需 fork pi。
2. **Electron**（二版）→ 弃：与 WorkBuddy 同栈、零风险，但 ipcMain/ipcRenderer 跨进程 IPC 与"钩子直调"哲学有张力，包体大。
3. **deno desktop**（最终，spike 验证）→ 取：**in-process bindings 天生契合**（pi 与 UI 同进程零往返），~40MB 轻量，单机交叉编译，内置更新。spike 7 项测试全通过（含真实 LLM 流式），核心风险消除。详见 [07-deno-desktop-spike验证](./07-deno-desktop-spike验证.md)。

## pi 源码核验结论（已落地）

pi 源码在本地 `~/Desktop/pi-mono`，已 `git pull` 到最新（**v0.80.3，MIT，2026-07**）。关键结论：

- **6 个包**：`pi-ai`、`pi-agent-core`（**我们用这两个**）、`pi-coding-agent`、`pi-orchestrator`（experimental，多 agent 编排）、`pi-tui`、`mom`。
- **pi-ai 新 API**：`createModels()` + provider factory（旧全局 API 在 `/compat`，将移除）。中文 provider 全覆盖：DeepSeek、Ant Ling、Moonshot/Kimi、MiniMax、ZAI、Xiaomi。
- **核心 `Agent` 类**（0.80 稳定）：`new Agent(opts)` → `prompt()` → `subscribe()` 收事件。`beforeToolCall` 钩子天然对接权限模型。
- **技能格式**：`Skill` 接口 + `SKILL.md`，与 WorkBuddy/agentskills.io **格式兼容**。
- **spike 验证 pi 在 Deno 可跑**：加载、实例化、真实 DeepSeek 流式对话（24 chunk）全通过。详见 [07](./07-deno-desktop-spike验证.md)。

详见 [03-技术架构设计](./03-技术架构设计.md) 与 [00-WorkBuddy逆向调研](./00-WorkBuddy逆向调研.md)。

## 状态

设计阶段，尚未开始编码。工作目录 `pi-a` 当前为 `docs/`。
