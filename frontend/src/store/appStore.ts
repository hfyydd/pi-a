// 设计变量（从 renderer/index.html 的 :root 迁移）
// light/dark 双主题通过 data-theme 属性切换

export const tokens = `
:root {
  --bg: #ffffff;
  --bg-subtle: #f5f5f7;
  --bg-sidebar: #ffffff;
  --bg-hover: #f5f5f7;
  --bg-active: #f0f0f2;
  --border: #ebebef;
  --border-soft: #f2f2f4;
  --border-strong: #e0e0e4;
  --text: #1d1d1f;
  --text-2: #515156;
  --text-3: #a1a1aa;
  --text-4: #c4c4c8;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;
  --accent-border: #c7d2fe;
  --green: #16a34a;
  --green-soft: #f0fdf4;
  --green-border: #bbf7d0;
  --green-text: #166534;
  --amber: #d97706;
  --red: #dc2626;
  --red-soft: #fef2f2;
  --red-border: #fecaca;
  --red-text: #991b1b;
  --blue-soft: #eff6ff;
  --blue-border: #bfdbfe;
  --blue-text: #1e40af;
  --blue-accent: #3b82f6;
  --brand-gradient: linear-gradient(135deg, #6366f1, #4f46e5 60%, #7c3aed);
  --brand-shadow: 0 2px 6px rgba(79,70,229,.28);
  --code-bg: #18181b;
  --code-text: #e4e4e7;
  --overlay: rgba(0,0,0,.28);
  --scrollbar: #d4d4d8;
  --scrollbar-hover: #a1a1aa;
  --selection: #c7d2fe;
  --shadow-sm: 0 1px 2px rgba(16,17,20,.05);
  --shadow-md: 0 4px 14px rgba(16,17,20,.06);
  --shadow-lg: 0 12px 36px rgba(16,17,20,.08);
  --r-sm: 7px; --r: 11px; --r-lg: 16px; --r-xl: 22px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --cat-c: #ef4444;
  --cat-p: #3b82f6;
  --cat-a: #8b5cf6;
  --cat-u: #f59e0b;
}
:root[data-theme="dark"] {
  --bg: #1a1b1e;
  --bg-subtle: #212327;
  --bg-sidebar: #141518;
  --bg-hover: #2a2c31;
  --bg-active: #2ea08822;
  --border: #34373d;
  --border-soft: #2a2c31;
  --border-strong: #3f4248;
  --text: rgba(255,255,255,.92);
  --text-2: rgba(255,255,255,.65);
  --text-3: rgba(255,255,255,.45);
  --text-4: rgba(255,255,255,.25);
  --accent: #818cf8;
  --accent-hover: #6366f1;
  --accent-soft: rgba(99,102,241,.15);
  --accent-border: rgba(99,102,241,.35);
  --green: #4ed88a;
  --green-soft: rgba(22,163,74,.15);
  --green-border: rgba(78,216,138,.3);
  --green-text: #4ed88a;
  --amber: #f59e0b;
  --red: #f47374;
  --red-soft: rgba(244,115,116,.12);
  --red-border: rgba(244,115,116,.3);
  --red-text: #f47374;
  --blue-soft: rgba(59,130,246,.12);
  --blue-border: rgba(59,130,246,.3);
  --blue-text: #60a5fa;
  --blue-accent: #60a5fa;
  --brand-gradient: linear-gradient(135deg, #818cf8, #6366f1 60%, #a78bfa);
  --brand-shadow: 0 2px 6px rgba(99,102,241,.3);
  --code-bg: #0d0d0f;
  --code-text: #e4e4e7;
  --overlay: rgba(0,0,0,.5);
  --scrollbar: #3f4248;
  --scrollbar-hover: #52555c;
  --selection: rgba(99,102,241,.3);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  --shadow-md: 0 4px 14px rgba(0,0,0,.35);
  --shadow-lg: 0 12px 36px rgba(0,0,0,.4);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body {
  font-family: var(--font);
  background: var(--bg); color: var(--text);
  font-size: 14px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); background-clip: padding-box; border: 3px solid transparent; }
::selection { background: var(--selection); }
button { font-family: inherit; cursor: pointer; }
input, textarea { font-family: inherit; }
`;

export type Theme = "light" | "dark";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("pi-a-theme", theme); } catch {}
}

export function initTheme(): Theme {
  let saved: string | null = null;
  try { saved = localStorage.getItem("pi-a-theme"); } catch {}
  if (!saved) {
    saved = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = saved;
  return saved as Theme;
}
