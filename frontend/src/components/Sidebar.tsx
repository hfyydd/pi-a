import { useState } from "react";
import { useStore } from "../store/useStore";
import { Search, Plus, Settings, PanelLeft, Sun, Moon, MessageSquare, FolderKanban, Star, Cog, Trash2 } from "lucide-react";
import "./Sidebar.css";

const CATEGORIES = [
  { id: "assistant", label: "助理", icon: MessageSquare, color: "var(--cat-a)", enabled: false },
  { id: "project", label: "项目", icon: FolderKanban, color: "var(--cat-p)", enabled: false },
  { id: "expert", label: "专家", icon: Star, color: "var(--cat-c)", enabled: false },
  { id: "automation", label: "自动化", icon: Cog, color: "var(--cat-u)", enabled: false },
];

const STATUS_COLORS: Record<string, string> = {
  idle: "var(--text-4)",
  running: "#3b82f6",
  done: "var(--green)",
  failed: "var(--red)",
  pending: "var(--text-3)",
  planning: "var(--amber)",
};

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(d / 3600000);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(d / 86400000)} 天前`;
}

export default function Sidebar() {
  const {
    activeCategory, setCategory, conversations, currentConvId,
    selectConversation, createConversation, deleteConversation,
    toggleSidebar, searchQuery, theme, toggleTheme, setShowSettings,
  } = useStore();
  const [hoverConv, setHoverConv] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      {/* 标题栏 */}
      <div className="sidebar-titlebar">
        <button className="sidebar-icon-btn" onClick={toggleSidebar} title="收起侧边栏">
          <PanelLeft size={17} />
        </button>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">π</div>
          <span className="sidebar-brand-name">Pi-a</span>
        </div>
      </div>

      {/* 新任务按钮 */}
      <div className="sidebar-new-task">
        <button className="new-task-btn" onClick={() => createConversation()}>
          <Plus size={16} strokeWidth={2.5} />
          <span>新建任务</span>
        </button>
      </div>

      {/* 分类导航 */}
      <nav className="sidebar-nav">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          if (!cat.enabled) {
            return (
              <button
                key={cat.id}
                className="sidebar-nav-item disabled"
                onClick={() => alert(`${cat.label}功能开发中，敬请期待`)}
              >
                <span className="sidebar-nav-icon" style={{ color: "var(--text-4)" }}>
                  <Icon size={17} />
                </span>
                <span className="sidebar-nav-label">{cat.label}</span>
                <span className="sidebar-nav-badge">即将上线</span>
              </button>
            );
          }
          return (
            <button
              key={cat.id}
              className={`sidebar-nav-item ${active ? "active" : ""}`}
              onClick={() => setCategory(cat.id)}
            >
              <span className="sidebar-nav-icon" style={{ color: cat.color }}>
                <Icon size={17} />
              </span>
              <span className="sidebar-nav-label">{cat.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 搜索 */}
      <div className="sidebar-search">
        <Search size={13} color="var(--text-3)" />
        <input
          className="sidebar-search-input"
          value={searchQuery}
          onChange={(e) => {
            useStore.setState({ searchQuery: e.target.value });
            useStore.getState().loadConversations();
          }}
          placeholder="搜索对话…"
        />
      </div>

      {/* 任务列表 */}
      <div className="sidebar-section-label">任务</div>
      <div className="sidebar-conv-list">
        {conversations.length === 0 && (
          <div className="sidebar-conv-empty">暂无任务，点击上方新建</div>
        )}
        {conversations.map((c) => {
          const active = c.id === currentConvId;
          const isHover = hoverConv === c.id;
          const statusColor = STATUS_COLORS[c.status] || "var(--text-4)";
          const showStatusDot = c.status && c.status !== "idle";
          return (
            <div
              key={c.id}
              className={`sidebar-conv-item ${active ? "active" : ""}`}
              onClick={() => selectConversation(c.id)}
              onMouseEnter={() => setHoverConv(c.id)}
              onMouseLeave={() => setHoverConv(null)}
            >
              <div className="sidebar-conv-main">
                <div className="sidebar-conv-title">
                  {showStatusDot && (
                    <span
                      className={`sidebar-conv-status ${c.status === "running" ? "pulsing" : ""}`}
                      style={{ background: statusColor }}
                      title={c.status}
                    />
                  )}
                  {c.title || "新任务"}
                </div>
                <div className="sidebar-conv-time">{timeAgo(c.updatedAt)}</div>
              </div>
              {(isHover || active) && (
                <button
                  className="sidebar-conv-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部 */}
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">HF</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">本地用户</div>
          <div className="sidebar-user-plan">DeepSeek · 就绪</div>
        </div>
        <button className="sidebar-icon-btn" onClick={toggleTheme} title="切换主题">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="sidebar-icon-btn" onClick={() => setShowSettings(true)} title="设置">
          <Settings size={16} />
        </button>
      </div>
    </aside>
  );
}
