# 07 · deno desktop Spike 验证记录

> 本篇记录 2026-07-05 对 **deno desktop**（Deno 2.9 官方桌面框架）的可行性 spike 全过程与结论。
> 它是技术栈从 Electron 切换到 deno desktop 的**事实依据**。
> spike 工程位于 `~/Desktop/pi-a/spike-deno-desktop/`。

---

## 一、Spike 目的

回答一个问题：**pi 能否在 deno desktop 上跑起来，足以支撑 WorkBuddy？**

之前评估的硬风险是：pi 是 npm 包 + 依赖 Node 原生模块（better-sqlite3/node-pty/keytar），deno desktop 仅 2 周龄（2.9.0 = 2026-06-25），兼容性未验证。

## 二、环境

- Deno **2.9.1**（2026-07-01 发布，含 deno desktop 子命令）
- macOS darwin 25.5.0 arm64
- 后端：laufey webview v0.5.0（自动下载）

---

## 三、7 项测试与结果

### 测试 1：deno desktop 基础（窗口 + serve + 打包）
```
main.ts → Deno.serve() → deno desktop main.ts
```
- ✅ 编译为 `.dylib` + 下载 laufey webview 后端 + 打包成 `.app` + 代码签名
- ✅ 窗口打开（laufey_webview 进程存活）
- ✅ Deno.serve 绑定 `127.0.0.1:50659`，HTML 正常渲染（含动态内容）
- **结论**：deno desktop 基础能力完整可用

### 测试 2：pi 完整加载
```
import("npm:@earendil-works/pi-ai@0.80.3")
import("npm:@earendil-works/pi-agent-core@0.80.3")
```
- ✅ pi-ai 加载成功（exports 含 createModels/createImagesModels/Type 等）
- ✅ pi-agent-core 加载成功（exports 含 Agent/AgentHarness 等）
- **结论**：pi 的 npm 包在 Deno 完全可用（含全部传递依赖：openai/anthropic-sdk/google-genai/aws-sdk 等）

### 测试 3：pi Agent 实例化
```
createModels() → setProvider(deepseekProvider()) → getModel("deepseek","deepseek-v4-flash") → new Agent({...})
```
- ✅ createModels() 成功
- ✅ setProvider + getModel 成功（拉到 DeepSeek V4 catalog：deepseek-v4-flash / deepseek-v4-pro）
- ✅ **`new Agent({initialState:{model, systemPrompt, tools:[]}})` 成功**
- ✅ agent.prompt / agent.subscribe / agent.state.isStreaming 全是预期类型
- **结论**：spike 的核心问题——pi Agent 能否实例化——**通过**

### 测试 4：真实 LLM 流式对话（DeepSeek）⭐
```
agent.prompt("你好,介绍一下你自己(一句话)")
```
- ✅ pi-ai streamSimple 经 Deno fetch 调用 DeepSeek API 成功
- ✅ 流式回传 **24 个 chunk**
- ✅ 完整回复："你好！我是你的测试助手，可以帮你快速验证功能、查找问题或提供简洁的测试建议。"
- ✅ agent_end 正常触发
- **结论**：**Deno 网络层（fetch）完全支持 pi 的 LLM 调用**——当初的第二大风险消除

### 测试 5：原生模块（better-sqlite3 / node:sqlite / node-pty / keytar）
| 模块 | import | 实际调用 | 结论 |
|------|:---:|:---:|------|
| better-sqlite3 | ✅ | ❌ | "Cannot load native addon... legacy Node.js native addon API (NODE_MODULE)"——**N-API 原生模块在 Deno 不兼容** |
| **node:sqlite**（Deno 内置） | ✅ | ✅ | 建表/插入/查询全通，`{"name":"测试"}`——**完美替代** |
| @lydell/node-pty | ✅ | ✅ | pty.spawn("echo",...) 可起（需 --allow-write） |
| keytar | ✅ | ✅ | setPassword/getPassword/deletePassword 全通，读回 `secret123` |
- **结论**：better-sqlite3 失败但有 node:sqlite 内置替代；node-pty/keytar 可用

### 测试 6：win.bind in-process bindings
```
win.bind("ping", async () => { count++; return count; })
win.bind("getAgentState", async () => ({isStreaming: agent.state.isStreaming, ...}))
```
- ✅ `Deno.BrowserWindow` 存在（function）
- ✅ **`win.bind` 注册成功**，'ping'/'getAgentState' 暴露给 webview
- **结论**：deno desktop 的核心卖点——in-process bindings（非 IPC）——**可用**

### 测试 7：OS 能力探测
```
typeof Deno.BrowserWindow  → "function"  ✅
typeof Deno.Tray           → "function"  ✅（文档未写但 API 存在）
typeof Deno.globalShortcut → "undefined" ❌（已知缺口）
```
- ✅ 窗口、托盘可用
- ❌ **全局热键暂不支持**（deno desktop 当前无 globalShortcut）——速唤浮窗 P1 用 FFI/native 解决
- **结论**：核心 OS 能力可用；热键是已知缺口，MVP 不影响

---

## 四、验证矩阵汇总

| # | 验证项 | 结果 |
|---|--------|:---:|
| 1 | deno desktop 窗口 + serve + 打包 + 签名 | ✅ |
| 2 | pi-ai / pi-agent-core 完整加载 | ✅ |
| 3 | pi `new Agent()` 实例化 | ✅ |
| 4 | **真实 DeepSeek 流式对话（24 chunk）** | ✅ |
| 5 | better-sqlite3 ❌ → **node:sqlite ✅ 替代** | ✅ |
| 6 | **win.bind in-process bindings** | ✅ |
| 7 | Deno.BrowserWindow / Deno.Tray ✅；globalShortcut ❌ | ✅/❌ |
| 补 | keytar（keychain） | ✅ |
| 补 | @lydell/node-pty（终端） | ✅ |

---

## 五、决策结论

**采用 deno desktop。** 理由：

1. **核心风险全部消除**：pi 加载、Agent 实例化、真实 LLM 流式——三大未知全过。
2. **in-process bindings 是真实架构优势**：pi 与 UI 同进程零 IPC，比 Electron 的 ipcMain/ipcRenderer 跨进程序列化更优，且与"钩子直调"哲学天生契合。
3. **原生模块缺口有解**：better-sqlite3 → node:sqlite（内置，更好）；全局热键 → P1 FFI。
4. **轻量 + 交叉编译 + 内置更新**：~40MB 包体、单机出三平台包、Deno.autoUpdate 内置 bsdiff+回滚。
5. **"可以试错 + 从头开始"** 对冲了 2 周龄的成熟度风险。

## 六、已知风险与对策

| 风险 | 对策 |
|------|------|
| deno desktop 2 周龄，复杂场景（长会话/并发/内存）稳定性未知 | MVP 持续观察；架构边界保证可回退 Electron（pi API 与宿主无关） |
| 全局热键缺失 | P1 速唤浮窗时用 `Deno.dlopen`（FFI）调系统 API 或 native 插件 |
| 无 WorkBuddy 同栈参照 | 借鉴 WorkBuddy 的设计模式（domain/AgentProvider/记忆缓存），实现用 Deno API |
| node:sqlite 相对 better-sqlite3 是同步 API，性能特征略不同 | MVP 数据量小，无瓶颈；P1 如有问题再优化 |

---

## 七、Spike 工程产物

```
spike-deno-desktop/
├── main.ts              # Hello window
├── test_pi.ts           # pi 加载与实例化
├── test_models.ts       # 列出 DeepSeek model ids
├── test_llm.ts          # 真实 LLM 流式（用 DEEPSEEK_API_KEY）
├── test_sqlite.ts       # 原生模块测试
├── test_native_deep.ts  # 深度原生模块调用
├── test_pty.ts          # node-pty
├── test_desktop.ts      # desktop 集成（BrowserWindow + bind + pi + sqlite）
└── deno.json            # 配置
```

这些脚本可作为正式 M0 工程的起点。
