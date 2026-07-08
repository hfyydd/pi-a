import { useStore } from "../store/useStore";

const CATEGORIES = [
  { id: "assistant", label: "助理", color: "var(--cat-a)", icon: "💬" },
  { id: "project", label: "项目", color: "var(--cat-p)", icon: "📁" },
  { id: "expert", label: "专家", color: "var(--cat-c)", icon: "⭐" },
  { id: "automation", label: "自动化", color: "var(--cat-u)", icon: "⚙️" },
];

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000);
  if (day > 0) return `${day} 天前`;
  if (h > 0) return `${h} 小时前`;
  if (m > 0) return `${m} 分钟前`;
  return "刚刚";
}

export default function Sidebar() {
  const {
    activeCategory, setCategory, conversations, currentConvId,
    selectConversation, createConversation, deleteConversation,
    toggleSidebar, searchQuery, theme, toggleTheme, setShowSettings,
  } = useStore();

  return (
    <aside style={{
      width: 248, flexShrink: 0, background: "var(--bg-sidebar)",
      borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
    }}>
      {/* 顶部行：折叠 + 品牌 + 新建 */}
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "0 8px" }}>
        <button onClick={toggleSidebar} title="收起侧边栏"
          style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 6, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: "var(--brand-gradient)", color: "#fff", fontWeight: 700, fontSize: 11,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>π</div>
          <span style={{ fontWeight: 620, fontSize: "13.5px" }}>Pi-a</span>
        </div>
        <button onClick={() => createConversation()} title="新建对话 (⌘N)"
          style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 6, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      {/* 分类导航 */}
      <nav style={{ padding: "6px 8px 4px" }}>
        {CATEGORIES.map((cat) => (
          <button key={cat.id} onClick={() => setCategory(cat.id)}
            style={{
              width: "100%", padding: "6px 8px", display: "flex", alignItems: "center", gap: 9,
              border: "none", borderRadius: 6, textAlign: "left", fontSize: 13, transition: "all .1s",
              background: activeCategory === cat.id ? "var(--bg-active)" : "transparent",
              color: activeCategory === cat.id ? "var(--text)" : "var(--text-2)",
              fontWeight: activeCategory === cat.id ? 550 : 450, marginBottom: 1,
            }}>
            <span style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", color: cat.color }}>{cat.icon}</span>
            <span style={{ flex: 1 }}>{cat.label}</span>
          </button>
        ))}
      </nav>

      {/* 搜索 */}
      <div style={{ padding: "4px 8px 6px" }}>
        <input
          value={searchQuery}
          onChange={(e) => { useStore.setState({ searchQuery: e.target.value }); useStore.getState().loadConversations(); }}
          placeholder="搜索对话…"
          style={{
            width: "100%", padding: "5px 8px", border: "1px solid transparent", borderRadius: 6,
            background: "var(--bg-subtle)", color: "var(--text)", fontSize: "12.5px", outline: "none",
          }}
        />
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
        {conversations.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: "12.5px", color: "var(--text-3)", textAlign: "center", lineHeight: 1.8 }}>
            暂无对话，点击 + 新建
          </div>
        )}
        {conversations.map((c) => (
          <div key={c.id} onClick={() => selectConversation(c.id)}
            style={{
              padding: "7px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 1,
              display: "flex", alignItems: "center", gap: 8, transition: "background .1s",
              background: c.id === currentConvId ? "var(--bg-active)" : "transparent",
            }}
            onMouseEnter={(e) => { if (c.id !== currentConvId) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (c.id !== currentConvId) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: c.id === currentConvId ? "var(--text)" : "var(--text-2)", fontWeight: c.id === currentConvId ? 550 : 450, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title || "新对话"}
              </div>
              <div style={{ fontSize: "10.5px", color: "var(--text-3)", marginTop: 1 }}>{timeAgo(c.updatedAt)}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
              style={{ width: 20, height: 20, border: "none", background: "transparent", borderRadius: 5, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.parentElement!.style.opacity = "1"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        ))}
      </div>

      {/* 底部 */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%", background: "var(--brand-gradient)",
          color: "#fff", fontWeight: 600, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
        }}>HF</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12.5px", fontWeight: 500 }}>本地用户</div>
          <div style={{ fontSize: "10.5px", color: "var(--text-3)" }}>DeepSeek · 就绪</div>
        </div>
        <button onClick={toggleTheme} title="切换主题"
          style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 7, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
        <button onClick={() => setShowSettings(true)} title="设置"
          style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 7, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </aside>
  );
}
