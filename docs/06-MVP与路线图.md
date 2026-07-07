# 06 · MVP 与路线图

> 本篇把前 5 篇的设计收敛成**可执行的落地计划**：MVP 边界、里程碑、技术风险、验证指标、第一步动作。
>
> 核心原则：**MVP 必须能完整跑通"读数据 → 出文档 → 迭代编辑"这条最高价值路径**，且全程不依赖 Node/Python/LibreOffice sidecar（保持 Tauri 的轻量承诺）。

---

## 一、MVP 定义

### 1.1 MVP 的"一句话"
> 用户能用自然语言，让 WorkBuddy 读取本地 xlsx/csv/docx，分析后**生成**新的 docx/xlsx/pptx，并对 docx/xlsx 做**编辑迭代**——全程本地、轻量、可靠。

### 1.2 MVP 包含（In Scope）

| 模块 | MVP 范围 |
|------|----------|
| **对话** | 流式对话、多轮、会话列表、消息树分支、@引用文件、导出 |
| **Agent 引擎** | pi 嵌入 WebView（方案A）、自定义工具桥到 Rust、流式事件、系统 prompt 管理 |
| **文档引擎** | 读(docx/xlsx/csv/md/pdf/pptx) + 创建(docx/xlsx/pptx) + 编辑(xlsx via umya；docx 模板 via docxtemplater) |
| **工件区** | 右栏工件预览、迭代、版本历史、Finder 中显示 |
| **模型管理** | 多 provider（先接 OpenAI/DeepSeek/GLM，预留 Ollama）；keychain 存 key；任务路由 |
| **记忆（基础）** | 全局记忆的增删查改面板；agent 可 recall/write |
| **技能（内置）** | 周报生成、数据分析出表、PPT 制作、文档润色、文档问答（5 个内置技能） |
| **项目** | 创建项目、关联文件目录、会话归到项目 |
| **设置** | 文档访问目录、模型配置、外观、数据导出 |
| **轻量入口** | `open_url`/`open_file` 工具；主窗口为主 |

### 1.3 MVP 不含（Out of Scope，留给 P1+）

- ❌ OS Computer Use（截图/点击/键盘）—— 整体 P1（安全与可靠性需打磨）
- ❌ 速唤浮窗 —— P1
- ❌ 后台自动化与触发器 —— P1
- ❌ docx 自由编辑（python sidecar）/ pptx 编辑 —— P1
- ❌ 导出 PDF（LibreOffice）—— P1
- ❌ 自定义技能编辑器 —— P1
- ❌ RAG 向量召回 —— P1（MVP 的"文档问答"用整文件喂 LLM）
- ❌ Windows 平台 —— P1（MVP 仅 macOS）
- ❌ 自动更新、技能市场、协作 —— P2

### 1.4 为什么这样切

- **价值闭环**：MVP 的文档能力本身就构成可演示、可留存的核心价值，不靠"能控制电脑"吸引人。
- **架构验证**：MVP 完成时，"pi 嵌入 + Rust 能力层"这条最关键的架构假设已被验证，再叠 OS 自动化风险更可控。
- **零 sidecar 承诺**：MVP 全程 Rust + 前端 JS，包体小、启动快——正面兑现"轻量"卖点。

---

## 二、里程碑与时间线

> 时间估算为单人/小团队节奏；可按团队规模压缩。

### M0 · 起步验证（1 周）

**目标**：在 Tauri WebView 里把 pi 的 `Agent` 跑通（源码已核验，本阶段是工程冒烟，不再是不确定性验证）。

- [x] ~~核验 pi 源码~~ —— **已完成并 pull 到最新**（v0.80.3，见 [03] §2）。`Agent` 类 API、新 `Models` API、Node 依赖边界、provider 覆盖均已确认。
- [ ] 起最小 Tauri 2 + React + TS + Vite 工程
- [ ] `npm i @earendil-works/pi-ai @earendil-works/pi-agent-core typebox`
- [ ] **用新 API**：`createModels()` + `models.setProvider(deepseekProvider())`（从 `pi-ai/providers/deepseek`）+ `models.getModel(...)`；**避免 `/compat` 和 `providers/all`**
- [ ] `new Agent({ initialState:{ model, ... }, streamFn:(m,c,o)=>models.streamSimple(m,c,o), getApiKey, ... })` + `agent.subscribe` → 调通一次流式对话
- [ ] 写一个自定义 `AgentTool` → `execute` 内 `invoke('ping')` → Rust 返回，验证工具桥
- [ ] 验证 `beforeToolCall` 钩子能 `{block:true}` 拦截（权限挂载点）
- **产出**：一个能流式对话、能调 Rust 工具、带权限拦截点的 Tauri 空壳。
- **决策点**：仅当 Vite 打包 pi 出现不可解的 Node 依赖问题时，才触发 [03] §2.5 方案 B/C。

### M1 · MVP 核心（4-6 周）

按垂直切片，每周一个能跑的端到端能力：

| 周 | 交付 | 说明 |
|----|------|------|
| W1 | 对话 UI + 会话持久化 | React 对话流、SQLite schema、消息树 |
| W2 | 文档读取 | `read_doc` 多格式（docx-rs/calamine/pdf-extract/comrak；pptx 先占位返回"需 P1") |
| W3 | 文档创建 | `write_docx`(docx-rs) + `write_xlsx`(rust_xlsxwriter) + `write_pptx`(pptxgenjs) |
| W4 | 文档编辑 | `edit_xlsx`(umya-spreadsheet) + `edit_docx` 模板(docxtemplater) + 工件版本历史 |
| W5 | 工件区预览 | 右栏 docx/xlsx/pptx 预览（docx→mammoth→HTML；xlsx→表格；pptx→图片或文本大纲） |
| W6 | 内置技能 + 模型路由 + 记忆面板 | 5 个内置技能、DeepSeek/GLM 接入、记忆 CRUD |
- **产出**：可对外演示的 macOS MVP。

### M2 · 打磨与发布（2 周）

- 权限/文件访问范围 UI、数据流透明面板（MVP 版）
- 打包、签名、公证（macOS notarization）
- 落地页 + GitHub README + 一支 90 秒演示视频
- **发布 MVP 0.1**（macOS，公测）

### P1 · OS 自动化与补全（M2 之后，6-8 周）

- 速唤浮窗（`⌥Space`、上下文感知）
- Computer Use（macOS Accessibility 优先）
- 权限三层模型（L1/L2/L3）+ 引导
- Windows 平台移植
- Python sidecar（docx 自由编辑、pptx 编辑）
- LibreOffice PDF 导出
- 后台自动化（cron/文件/热键触发）
- 自定义技能编辑器 + 导入导出
- RAG 向量召回（`sqlite-vss` 或本地 embedding）

### P2 · 远期

- Linux 支持
- 技能市场 / 社区分享
- 多模态深化（语音输入/输出）
- 团队/协作（若转向 ToB）

---

## 三、技术风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|:---:|:---:|------|
| ~~pi 无法在 WebView 直接跑~~ | — | — | **已排除**：官方 README "Browser Usage" 章节 + Node 依赖隔离（见 [03] §2.1） |
| **Vite 打包 pi 时误拉 Node-only 依赖**（@aws-sdk/proxy-agent） | 低-中 | 中 | `optimizeDeps.exclude`/手动 chunk；参照官方 esbuild 配置 |
| **Tauri 平台 WebView 差异/踩坑**（Chatbox 教训） | 中 | 中 | 锁 macOS 版本；标准 CSS；CI 视觉回归 |
| **umya-spreadsheet / docx-rs 维护停滞** | 低-中 | 中 | 实现前核验活跃度；备 openpyxl sidecar / 自维护 fork |
| **docx/xlsx 编辑保真不足** | 中 | 中 | 结构化驱动（不吐 XML）+ 版本回退 + 失败可见 |
| **macOS 辅助功能授权体验差** | 中 | 中 | 清晰引导 + 检测状态 API；降级到模拟按键 |
| **模型成本（多模态视觉调用）** | 中 | 中 | 默认本地优先；视觉只在 OS 任务用；缓存截图 |
| **包体膨胀**（带 Python/LibreOffice sidecar） | 中 | 中 | sidecar 懒下载（用到才装）；MVP 零 sidecar |
| **Computer Use 可靠性不足伤信任** | 中-高 | 高 | 语义优先、步数上限、随时中断、确认机制 |
| **腾讯 WorkBuddy 快速迭代挤压** | 中 | 中 | 差异化打"开源+轻量+可控+不绑生态"，不正面拼飞书集成 |

---

## 四、成功指标（MVP 验证）

定量（发布 4-8 周内观察）：
- **首周留存** D7 ≥ 30%（核心信号：文档能力是否真有用）
- **每用户每周文档生成数** ≥ 3（验证核心价值频次）
- **MVP 包体** < 25MB、冷启动 < 1.5s、内存 < 250MB（兑现轻量承诺）
- **关键路径成功率**（读数据→出文档→编辑）≥ 80%

定性：
- 用户能否独立完成"周报/出表/PPT"三类场景而不用翻文档
- 是否主动反馈"比 ChatGPT/腾讯 WorkBuddy 更轻/更快/更可控"

---

## 五、第一步动作清单（M0 立即可做）

1. **[x] ~~核验 pi 源码~~** —— 已完成并 pull 到最新（v0.80.3，[03] §2 已是核验后事实）。关键收获：
   - pi 现有 6 包，我们只用 `pi-ai` + `pi-agent-core` 主入口；新增 `orchestrator`（experimental）远期参考
   - **pi-ai 已升级为新 `createModels()` + provider factory API**（旧全局 API 在 `/compat`，将移除，避免使用）
   - 核心 API 是 `Agent` 类，事件驱动，自带 `beforeToolCall`（权限钩子）/`afterToolCall`（审计）
   - 中文 provider 全覆盖（DeepSeek/Ant Ling/Moonshot/MiniMax/ZAI/Xiaomi），官方 README 有 "Browser Usage" 章节

2. **[ ] 起最小工程**
   ```bash
   npm create tauri-app@latest   # React + TS + Vite
   npm i @earendil-works/pi-ai @earendil-works/pi-agent-core typebox
   ```

3. **[ ] 接通 pi 的 `Agent` + 一次流式对话**（验证方案 A 的工程层）
   - `createModels()` + `models.setProvider(deepseekProvider())` + `models.getModel(...)`
   - `new Agent({ streamFn:(m,c,o)=>models.streamSimple(m,c,o), ... })` + `agent.subscribe`
   - 验证 Vite 打包 pi 不拉入 Node-only 依赖（按需引入 provider 子路径）

4. **[ ] 写第一个 Rust 工具（ping）并包成 `AgentTool` 调通**（验证工具桥）

5. **[ ] 验证 `beforeToolCall` 拦截**（验证权限挂载点）

---

## 六、设计文档维护

- 本设计为**活文档**，实现过程中遇与设计冲突，**改文档而非绕过**。
- 每个 P1 能力落地前，补充该模块的详细设计（如 OS 自动化的 trait 细节、技能编辑器的交互）。
- 每个 P1 能力落地前，补充该模块的详细设计（如 OS 自动化的 trait 细节、技能编辑器的交互）。

---

## 附：文档导航

- [README · 总览](./README.md)
- [01 · 市场调研与产品定位](./01-市场调研与产品定位.md)
- [02 · 产品架构与功能设计](./02-产品架构与功能设计.md)
- [03 · 技术架构设计](./03-技术架构设计.md)
- [04 · 文档处理引擎](./04-文档处理引擎.md)
- [05 · OS 自动化与权限](./05-OS自动化与权限.md)
- **06 · MVP 与路线图**（本文）
