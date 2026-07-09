import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store/useStore";
import {
  Search, Plus, Settings, PanelLeft, Sun, Moon, MessageSquare,
  FolderKanban, Star, Cog, Trash2, MoreHorizontal, FolderInput, SlidersHorizontal,
  ChevronDown, ChevronRight, X, RotateCcw, Check,
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

/* 筛选选项（对齐 WorkBuddy 截图2） */
const STATUS_OPTIONS = [
  { key: "", label: "全部状态" },
  { key: "running", label: "进行中" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失败" },
  { key: "pending", label: "待处理" },
  { key: "planning", label: "规划中" },
] as const;

const TIME_OPTIONS = [
  { key: "", label: "全部时间" },
  { key: "today", label: "今天" },
  { key: "week", label: "最近 7 天" },
  { key: "month", label: "最近 30 天" },
] as const;

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
    resetToWelcome,
    toggleSidebar, searchQuery, theme, toggleTheme, setShowSettings,
    workspaces,
  } = useStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTime, setFilterTime] = useState("");

  // 点击空白处关闭筛选面板（搜索弹窗有独立遮罩，不在此处理）
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".sidebar-titlebar")) return;
      setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  // 时间过滤辅助
  const timeFilterMs = useMemo(() => {
    if (filterTime === "today") return 86400000;
    if (filterTime === "week") return 604800000;
    if (filterTime === "month") return 2592000000;
    return Infinity;
  }, [filterTime]);

  // 分离 + 过滤：未归入空间的会话（任务）vs 按空间分组的会话
  const { taskConvs, spaceMap } = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, typeof conversations>();
    for (const ws of workspaces) map.set(ws.id, []);
    const tasks: typeof conversations = [];
    for (const c of conversations) {
      // 状态过滤
      if (filterStatus && c.status !== filterStatus) {
        // 未归入空间的任务跳过，空间的也跳过
        if (!c.workspaceId || !map.has(c.workspaceId)) continue;
        // 有空间归属的继续走空间分组
      }
      // 时间过滤
      if (now - (c.updatedAt || 0) > timeFilterMs) {
        if (!c.workspaceId || !map.has(c.workspaceId)) continue;
      }
      if (c.workspaceId && map.has(c.workspaceId)) {
        map.get(c.workspaceId)!.push(c);
      } else {
        tasks.push(c);
      }
    }
    // 统一按最近更新排序
    const sortFn = (a: typeof conversations[number], b: typeof conversations[number]) =>
      (b.updatedAt || 0) - (a.updatedAt || 0);
    tasks.sort(sortFn);
    for (const [, v] of map) v.sort(sortFn);
    return { taskConvs: tasks, spaceMap: map };
  }, [conversations, workspaces, filterStatus, timeFilterMs]);

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
        {/* 检索 / 筛选（标题栏右侧，对齐 WorkBuddy） */}
        <div className="sidebar-titlebar-actions">
          <button
            className={`sidebar-icon-btn ${searchOpen ? "active" : ""}`}
            title="检索"
            onClick={() => { setSearchOpen(true); setLocalSearchQuery(searchQuery); }}
          >
            <Search size={16} />
          </button>
          <button
            className={`sidebar-icon-btn ${filterOpen ? "active" : ""}`}
            title="筛选"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* ── 新建任务按钮 ── */}
      <div className="sidebar-new-task">
        <button className="new-task-btn" onClick={() => resetToWelcome()}>
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

      {/* ── 筛选下拉菜单（状态 + 时间，挂载在侧边栏根级） ── */}
      {filterOpen && (
        <div className="sidebar-filter-menu" onClick={(e) => e.stopPropagation()}>
          <div className="filter-section-label">状态</div>
          {STATUS_OPTIONS.map(({ key, label }) => (
            <button
              key={key || "all-status"}
              className={`sidebar-filter-item ${filterStatus === key ? "active" : ""}`}
              onClick={() => setFilterStatus(key)}
            >
              <span className="filter-item-label">{label}</span>
              {filterStatus === key && <Check size={13} />}
            </button>
          ))}
          <div className="filter-section-label">筛选时间</div>
          {TIME_OPTIONS.map(({ key, label }) => (
            <button
              key={key || "all-time"}
              className={`sidebar-filter-item ${filterTime === key ? "active" : ""}`}
              onClick={() => setFilterTime(key)}
            >
              <span className="filter-item-label">{label}</span>
              {filterTime === key && <Check size={13} />}
            </button>
          ))}
          <div className="filter-divider" />
          <button
            className="sidebar-filter-reset"
            onClick={() => { setFilterStatus(""); setFilterTime(""); }}
          >
            <RotateCcw size={12} />
            重置筛选条件
          </button>
        </div>
      )}

      {/* ═══════ 检索弹窗（全屏遮罩，对齐 WorkBuddy 截图1） ═══════ */}
      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            {/* 搜索框头部 */}
            <div className="search-header">
              <Search size={16} color="var(--text-3)" />
              <input
                className="search-input"
                autoFocus
                value={localSearchQuery}
                onChange={(e) => {
                  setLocalSearchQuery(e.target.value);
                  useStore.setState({ searchQuery: e.target.value });
                  useStore.getState().loadConversations();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
                placeholder="搜索任务"
              />
              <button className="search-close-btn" onClick={() => setSearchOpen(false)}>
                <X size={16} />
              </button>
            </div>

            {/* 结果列表 */}
            <div className="search-results">
              {localSearchQuery.trim() && conversations.length > 0 ? (
                (() => {
                  const q = localSearchQuery.toLowerCase();
                  const hits = conversations
                    .filter(c => (c.title || "").toLowerCase().includes(q))
                    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                    .slice(0, 50);
                  if (hits.length === 0) {
                    return <div className="search-empty">未找到匹配的任务</div>;
                  }
                  return hits.map(c => {
                    const ws = c.workspaceId ? workspaces.find(w => w.id === c.workspaceId) : null;
                    return (
                      <div
                        key={c.id}
                        className="search-result-item"
                        onClick={() => { useStore.getState().selectConversation(c.id); setSearchOpen(false); }}
                      >
                        <div className="search-result-title">{c.title || "新任务"}</div>
                        <div className="search-result-meta">
                          <span className="search-result-time">{timeAgo(c.updatedAt)}</span>
                          {ws && (
                            <>
                              <WorkspaceIcon name={ws.icon} size={12} />
                              <span className="search-result-ws">{ws.name}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              ) : localSearchQuery.trim() ? (
                <div className="search-empty">未找到匹配的任务</div>
              ) : (
                <div className="search-empty">输入关键词搜索任务</div>
              )}
            </div>
          </div>
        </div>
      )}

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
