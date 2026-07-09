import { useState, useMemo } from "react";
import { useStore } from "../store/useStore";
import {
  Search, Plus, Settings, PanelLeft, Sun, Moon, MessageSquare,
  FolderKanban, Star, Cog, Trash2, MoreHorizontal, FolderInput,
  ChevronDown, ChevronRight,
} from "lucide-react";
import "./Sidebar.css";
import { WorkspaceIcon } from "./WorkspaceIcon";

const CATEGORIES = [
  { id: "assistant", label: "助理", icon: MessageSquare, color: "var(--cat-a)", enabled: false },
  { id: "project", label: "项目", icon: FolderKanban, color: "var(--cat-p)", enabled: false },
  { id: "expert", label: "专家·技能·连接器", icon: Star, color: "var(--cat-c)", enabled: false },
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

/* ===== 可折叠 Section（任务 / 空间）===== */
function CollapsibleSection({
  label, count, defaultOpen = true, children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ArrowIcon = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button className="section-header" onClick={() => setOpen((v) => !v)}>
        <span className="section-header-arrow"><ArrowIcon size={13} /></span>
        <span className="section-header-label">{label}</span>
        <span className="section-header-count">({count})</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </>
  );
}

/* ===== 单个会话项（自管理 hover 与菜单）===== */
function ConvItem({
  c, onDelete, onMove,
}: {
  c: { id: string; title: string; status: string; updatedAt: number; workspaceId?: string };
  onDelete: (id: string) => void;
  onMove: (convId: string, wsId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = useStore((s) => s.currentConvId === c.id);
  const workspaces = useStore((s) => s.workspaces);
  const statusColor = STATUS_COLORS[c.status] || "var(--text-4)";
  const showStatusDot = c.status && c.status !== "idle";

  return (
    <div
      className={`sidebar-conv-item ${active ? "active" : ""}`}
      onClick={() => useStore.getState().selectConversation(c.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
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
      {(hovered || active) && (
        <div className="sidebar-conv-actions">
          <button
            className="sidebar-conv-menu"
            title="更多"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            <MoreHorizontal size={13} />
          </button>
          <button
            className="sidebar-conv-del"
            title="删除"
            onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
          >
            <Trash2 size={13} />
          </button>
          {menuOpen && (
            <div className="conv-move-menu" onClick={(e) => e.stopPropagation()}>
              <div className="conv-move-label"><FolderInput size={12} /> 移动到空间</div>
              {workspaces.length === 0 && (
                <div style={{ padding: "4px 7px", fontSize: 11.5, color: "var(--text-3)" }}>暂无空间</div>
              )}
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  className={`conv-move-item ${w.id === c.workspaceId ? "current" : ""}`}
                  onClick={() => { if (w.id !== c.workspaceId) onMove(c.id, w.id); setMenuOpen(false); }}
                >
                  <span><WorkspaceIcon name={w.icon} /></span>{w.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== 空间项（可折叠，内含该空间的会话）===== */
function WorkspaceItem({ ws, convs }: {
  ws: { id: string; name: string; icon: string };
  convs: { id: string; title: string; status: string; updatedAt: number; workspaceId?: string }[];
}) {
  const [expanded, setExpanded] = useState(true);
  const ArrowIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="ws-item">
      <button className="ws-item-header" onClick={() => setExpanded((v) => !v)}>
        <span className="ws-item-arrow"><ArrowIcon size={14} /></span>
        <span className="ws-item-icon"><WorkspaceIcon name={ws.icon} /></span>
        <span className="ws-item-name">{ws.name}</span>
      </button>

      {expanded && (
        <div className="ws-item-convs">
          {convs.length === 0 && (
            <div className="ws-item-empty">暂无对话</div>
          )}
          {convs.map((c) => (
            <ConvItem
              key={c.id}
              c={c}
              onDelete={(id) => useStore.getState().deleteConversation(id)}
              onMove={(cid, wid) => useStore.getState().assignConversation(cid, wid)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== 主侧边栏 ===== */
export default function Sidebar() {
  const {
    activeCategory, setCategory, conversations,
    createConversation,
    toggleSidebar, searchQuery, theme, toggleTheme, setShowSettings,
    workspaces,
  } = useStore();

  // 分离：未归入空间的会话（任务）vs 按空间分组的会话
  const { taskConvs, spaceMap } = useMemo(() => {
    const map = new Map<string, typeof conversations>();
    for (const ws of workspaces) map.set(ws.id, []);
    const tasks: typeof conversations = [];
    for (const c of conversations) {
      if (c.workspaceId && map.has(c.workspaceId)) {
        map.get(c.workspaceId)!.push(c);
      } else {
        tasks.push(c);
      }
    }
    return { taskConvs: tasks, spaceMap: map };
  }, [conversations, workspaces]);

  // 各空间的会话计数
  const spaceTotal = workspaces.reduce((sum, ws) => sum + (spaceMap.get(ws.id)?.length || 0), 0);

  return (
    <aside className="sidebar">
      {/* ── 标题栏 ── */}
      <div className="sidebar-titlebar">
        <button className="sidebar-icon-btn" onClick={toggleSidebar} title="收起侧边栏">
          <PanelLeft size={17} />
        </button>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">π</div>
          <span className="sidebar-brand-name">Pi-a</span>
        </div>
      </div>

      {/* ── 新建任务按钮 ── */}
      <div className="sidebar-new-task">
        <button className="new-task-btn" onClick={() => createConversation()}>
          <Plus size={16} strokeWidth={2.5} />
          <span>新建任务</span>
        </button>
      </div>

      {/* ── 分类导航 ── */}
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

      {/* ── 搜索 ── */}
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

      {/* ═══════ 会话列表区域 ═══════ */}
      <div className="sidebar-list-area">

        {/* ── 任务 (N) ── */}
        <CollapsibleSection label="任务" count={taskConvs.length}>
          {taskConvs.length === 0 ? (
            <div className="sidebar-section-empty">暂无任务</div>
          ) : (
            <div className="sidebar-conv-list">
              {taskConvs.map((c) => (
                <ConvItem
                  key={c.id}
                  c={c}
                  onDelete={(id) => useStore.getState().deleteConversation(id)}
                  onMove={(cid, wid) => useStore.getState().assignConversation(cid, wid)}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* ── 空间 (M) ── */}
        <CollapsibleSection label="空间" count={spaceTotal}>
          {workspaces.length === 0 ? (
            <div className="sidebar-section-empty">暂无空间</div>
          ) : (
            <div className="workspace-list">
              {workspaces.map((ws) => (
                <WorkspaceItem
                  key={ws.id}
                  ws={ws}
                  convs={spaceMap.get(ws.id) || []}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* 完全空状态 */}
        {taskConvs.length === 0 && workspaces.length === 0 && conversations.length === 0 && (
          <div className="sidebar-conv-empty">暂无任务，点击上方新建</div>
        )}
      </div>

      {/* ── 底部 ── */}
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
