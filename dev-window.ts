// dev-window.ts — 开发模式专用的「原生窗口启动器」。
//
// 背景：deno desktop 运行时会接管 Deno.serve 的端口（无论传什么端口都改派成随机端口），
// 导致「Vite 代理 → 固定 8000 后端」在 deno desktop 下永远对不上。因此 dev 模式下
// 后端必须由 `deno run --watch`（尊重 8000 端口、带 HMR）提供，而原生窗口单独由本脚本
// 通过 `deno desktop` 打开，只负责加载 Vite(5173)。三者分工：
//   - deno run --watch main.ts  → 后端 API（固定 8000，HMR）
//   - npm run dev (Vite 5173)   → 前端（HMR），并把 /api 代理到 8000
//   - deno desktop dev-window.ts → 原生窗口，加载 Vite，从而既有原生窗口又有 Vite HMR
//
// 注意：本脚本不包含任何后端逻辑，只创建 BrowserWindow。运行需 `deno desktop`（有 BrowserWindow）。

const VITE_URL = "http://127.0.0.1:5173";
const _Deno = Deno as any;

if (!_Deno.BrowserWindow) {
  console.log("[dev-window] 未检测到 Deno Desktop 运行时（BrowserWindow 不可用）。\n  请改用浏览器访问", VITE_URL, "进行开发。");
  Deno.exit(0);
}

// 透明标题栏在 macOS 上对首个隐式窗口不生效，先建一个屏幕外占位窗口
try {
  new _Deno.BrowserWindow({ width: 0, height: 0, x: -9999, y: -9999 });
} catch (e) {
  console.warn("[dev-window] 占位窗口创建失败:", e);
}

const win = new _Deno.BrowserWindow({
  width: 1280,
  height: 820,
  minWidth: 960,
  minHeight: 640,
  title: "Pi-a (dev)",
  url: VITE_URL,
  transparentTitlebar: true,
});
try {
  win.navigate(VITE_URL);
} catch (e) {
  console.warn("[dev-window] 导航失败:", e);
}
try {
  win.openDevtools();
} catch (e) {
  console.warn("[dev-window] 开启 DevTools 失败:", e);
}

console.log("[dev-window] 原生窗口已打开，加载", VITE_URL);
