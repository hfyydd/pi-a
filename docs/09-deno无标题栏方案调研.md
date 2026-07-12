# 09 · Deno Desktop 无标题栏（frameless）实现方案调研

> 调研时间：2026-07-10
> 运行时：**Deno 2.9.1**（deno desktop，laufey webview 后端，macOS arm64）
> 结论依据：① 官方文档 `docs.deno.com/runtime/desktop/windows`；② **运行时自省真实 `Deno.BrowserWindow` 实例的方法集合**（见附录）。

---

## 一、结论先行（给 Pi-a 的建议）

Deno Desktop 2.9.1 对"无标题栏"提供两种正交手段，但**都绕不开一个硬限制：没有 `minimize()` / `maximize()` / `setTrafficLightsVisible()` 这类程序化窗口控制 API**。

| 方向 | 选项 | 红绿灯 | 窗口控制 | 推荐度 |
|------|------|:---:|------|:---:|
| **A. 透明标题栏**（当前主窗口方案） | `transparentTitlebar: true` | 保留（原生） | 关闭/最小化/最大化/缩放 **全原生可用** | ⭐⭐⭐ 主窗口保持 |
| **B. 完全无边框**（自建标题栏） | `frameless: true` | 移除 | 必须自建；关闭=`close()`，最小化=`hide()`（进托盘），最大化=DIY | ⭐⭐ 仅浮窗/面板 |

**建议**：
1. **主窗口继续用 `transparentTitlebar: true` + 自定义可拖拽区**（已在 `main.ts` 采用）。这是 2.9.1 下体验最完整、成本最低的方案——红绿灯和原生缩放全部白嫖。
2. **"完全无标题栏"视觉只用于浮窗 / 速唤面板**：用 `frameless: true` + `noActivate`，自建三按钮（关闭 / 最小化→托盘 / 最大化→DIY）。
3. **不要指望 Deno 2.9.1 提供 `minimize()` / `maximize()` / `setTrafficLightsVisible()`**——均未实现（见附录方法表）。
4. **first-window 限制对 `frameless` / `transparentTitlebar` / `noActivate` 全部生效**：creation-only 配置在"隐式首窗口"上被忽略，必须用占位窗口 hack（见第四节）。

---

## 二、Deno Desktop 的真实 API 现状（运行时自省）

通过 `new Deno.BrowserWindow({ frameless: true })` 后 `Object.getPrototypeOf(win)` 拿到的方法全集：

```
constructor, windowId, bind, unbind, setTitle,
getSize, setSize, getPosition, setPosition,
isResizable, setResizable, isAlwaysOnTop, setAlwaysOnTop,
isClosed, close, isVisible, show, hide, focus,
navigate, openDevtools, reload, executeJs,
setApplicationMenu, showContextMenu, getNativeWindow,
onkeydown, onkeyup, onmousedown, onmouseup, onclick, ondblclick,
onmousemove, onwheel, onmouseenter, onmouseleave, onfocus, onblur,
onresize, onmove, onclose, onmenuclick, oncontextmenuclick
```

**逐项核对"无标题栏"关心的控制能力**：

| 能力 | 是否存在 | 说明 |
|------|:---:|------|
| `close()` | ✅ | 自建"关闭"按钮可用 |
| `hide()` / `show()` / `focus()` | ✅ | "最小化"可改为 `hide()` 进托盘 |
| `setSize()` / `setPosition()` / `getSize()` / `getPosition()` | ✅ | **可 DIY 最大化**（设到屏幕可用区） |
| `minimize` / `maximize` / `unmaximize` / `restore` / `isMaximized` | ❌ | **完全没有**程序化最小化/最大化 |
| `setMinimizable` / `setMaximizable` | ❌ | 无 |
| `setTrafficLightsVisible` / `setWindowButtonPosition` / `setWindowButtonVisibility` | ❌ | 无法保留/移动红绿灯（frameless 下它们被整体移除） |
| `setVibrancy` / `setOpacity` / `setBackgroundColor` | ❌ | 无原生毛玻璃/透明/背景色 |
| `setFullScreen` / `isFullScreen` / `center` | ❌ | 无 |
| `resizable`（构造项，默认 `true`） | ✅ | frameless 下 macOS 通常仍可从边缘缩放，但无可见手柄/光标 |

> 官方文档列出的构造项：`title / width / height / x,y / resizable / alwaysOnTop / frameless / noActivate / transparentTitlebar`。其中 **`frameless`、`noActivate`、`transparentTitlebar` 均为 creation-only**（只能在 `new` 时设置，之后不可改）。

**关键推论**：Deno Desktop 2.9.1 的窗口 API 是"够用但原始"的——能建、能关、能藏、能改尺寸位置、能设菜单，但**不做 OS 级窗口状态管理（最小化/最大化/全屏/红绿灯位置）**。任何"无标题栏"实现都要自己补齐这部分。

---

## 三、两种方案落地细节

### 方案 A：`transparentTitlebar: true`（主窗口 — 推荐保持）

机制：标题栏视觉融入内容区，**红绿灯（●○×）保留且原生可用**，内容可延伸到标题栏下方区域。

- 拖拽：在 webview 里用 CSS `-webkit-app-region: drag`（WebKit 支持，laufey 即 WebKit）。交互元素加 `-webkit-app-region: no-drag`。
- 布局避让：macOS 红绿灯固定在左上角（约 x=12,y=12 起，占宽 ~70px）。真实前端 UI 的顶栏/侧栏头部需预留 `padding-left: 72px` 左右，避免按钮与红绿灯重叠。
- 优点：零成本获得完整窗口控制 + 原生缩放/双击最大化/拖拽；跨 macOS 体验一致。
- 缺点：
  - `transparentTitlebar` **仅 macOS 生效**，Windows/Linux 会被忽略（仍显示原生标题栏）。若要跨平台统一观感需另想办法。
  - 无法自定义红绿灯位置/隐藏；左上角永远留白。

Pi-a 当前 `main.ts` 第 959 行已用此方案 + 占位窗口 hack，方向正确，只需在真实前端（frontend/src 的顶栏）补 `-webkit-app-region` 与左避让。

### 方案 B：`frameless: true`（完全无边框 — 仅浮窗/面板）

机制：移除标题栏与窗口 chrome（含红绿灯），**全部 UI 自建**。

必须自建的零件：

1. **拖拽区**：`-webkit-app-region: drag` 包住标题栏；按钮/输入框 `no-drag`。
2. **三按钮**（renderer 里画，通过 HTTP bridge 调主进程）：
   - 关闭：`win.close()` → 经 `/api/window/close`
   - 最小化：`win.hide()` → 经 `/api/window/min`；配合现有 `closeRequested → hide()` + 托盘恢复，体验一致
   - 最大化：**DIY**——`getSize/getPosition` 存旧几何，`setSize(availW, availH)` + `setPosition(0,0)` 到屏幕可用区；再次点击还原。屏幕可用区可由 webview 内 `window.screen.availWidth/availHeight`（标准 Web API，webview 可用）读取，或用 `executeJs` 取。
3. **缩放手柄**（可选）：frameless 下原生边缘手柄不可见。可依赖 `resizable:true` 让 macOS 边缘仍可拖拽（无光标反馈），或在 renderer 底部/右缘加 `mousedown` + `mousemove` + `setSize` 自建 grip。
4. **圆角/阴影**：frameless 下 webview 默认矩形，OS 不裁剪圆角。需在内容层用 CSS `border-radius` + 背景色模拟；阴影可用 `box-shadow` 近似（但 frameless 窗口本身可能无 OS 阴影，需验证）。
5. **`noActivate: true`**（与 `frameless` 搭配）：做菜单栏/速唤弹层时，窗口不抢焦点、点击外部自动失焦——配合 `Tray.attachPanel` 是官方推荐范式。

限制提醒：无 `setVibrancy`，毛玻璃只能靠网页层 CSS 模拟；无原生圆角裁剪；无双击最大化；无红绿灯。

---

## 四、first-window 限制与占位窗口 hack（必读）

官方文档原文：

> The **first** `new Deno.BrowserWindow()` you construct adopts that initial window; every construction after that opens a new one. … `frameless`, `noActivate`, and `transparentTitlebar` can only be set at creation time.

实测 `windowId`：占位窗口 `ph` 拿到 `windowId: 1`（吞掉隐式首窗口），真实 `frameless` 窗口拿到 `windowId: 2`。**证明 creation-only 配置在首窗口上确实被忽略**，必须用占位窗口 trick：

```ts
// 占位窗口：吞掉"隐式首窗口"，使其忽略 transparentTitlebar/frameless 也无所谓
new _Deno.BrowserWindow({ width: 0, height: 0, x: -9999, y: -9999 });
// 真实窗口作为第二个创建，creation-only 配置才生效
const win = new _Deno.BrowserWindow({
  width: 1280, height: 820,
  transparentTitlebar: true,   // 或 frameless: true
  // ...
});
```

> ⚠️ 不要对占位窗口调 `hide()`——`main.ts` 注释已记：会触发 webview 挂起。把它丢到屏幕外 `(-9999,-9999)` 即可。

此 hack 对 `frameless` / `transparentTitlebar` / `noActivate` **全部适用**，是通用解法。

---

## 五、给 Pi-a 的落地清单

1. **主窗口**：保持 `transparentTitlebar: true` + 占位窗口 hack（已在 `main.ts`）。
   - 在真实前端（frontend/src）顶栏加 `-webkit-app-region: drag`，红绿灯区 `padding-left` 避让。
   - 跨平台：Windows/Linux 下 `transparentTitlebar` 无效，需决定是接受原生标题栏还是改用 `frameless`（见下）。
2. **速唤浮窗（Sprint 3 功能9）**：用 `frameless: true` + `noActivate: true` + `alwaysOnTop: true` + `resizable: false`，自建标题栏 + 三按钮。
   - 新增 HTTP 端点：`/api/window/min`（`win.hide()`）、`/api/window/close`（`win.close()`）、`/api/window/max`（DIY 设尺寸到 `window.screen.avail*`）。
   - 复用现有托盘 + `closeRequested → hide()` 逻辑做"最小化=收托盘"。
3. **不要等 Deno 补 API**：2.9.1 的 `minimize/maximize/setTrafficLightsVisible` 缺失是现实约束；要么 DIY，要么用原生标题栏（方案 A）。
4. **验证项**：frameless 下圆角/阴影观感、边缘缩放手感、双击行为——需在真机目测（无 API 可程序化验证）。

---

## 附录：运行时自省原始输出（节选）

```
typeof Deno.BrowserWindow: function
win.windowId: 2
prototype own props/methods:
  constructor, windowId, bind, unbind, setTitle,
  getSize, setSize, getPosition, setPosition,
  isResizable, setResizable, isAlwaysOnTop, setAlwaysOnTop,
  isClosed, close, isVisible, show, hide, focus,
  navigate, openDevtools, reload, executeJs,
  setApplicationMenu, showContextMenu, getNativeWindow,
  [on* 事件处理器 ×17]
minimize/maximize/unmaximize/restore/isMaximized:        undefined
setTrafficLightsVisible/setWindowButtonPosition/...:      undefined
setVibrancy/setOpacity/setBackgroundColor/setFullScreen/center: undefined
show/hide/focus/close/reload/isClosed/isVisible:          function
```

> 自省脚本：`scratch/introspect_desktop_api.ts`（用 `deno desktop` 跑真实 frameless 窗口后 `Object.getPrototypeOf(win)` 打印）。
