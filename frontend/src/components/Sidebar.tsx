import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store/useStore";
import {
  Search, Plus, Settings, PanelLeft, Sun, Moon,
  Star, Cog, Trash2, MoreHorizontal, FolderInput, SlidersHorizontal,
  ChevronDown, ChevronRight, X, RotateCcw, Check,
} from "lucide-react";
import "./Sidebar.css";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { t } from "../utils/i18n";

const CATEGORIES = [
  { id: "assistant", labelKey: "assistant_mode", labelFallback: "💬 对话", icon: Star, color: "var(--cat-p)", enabled: true },
  { id: "expert", labelKey: "experts_skills", labelFallback: "🎓 专家", icon: Star, color: "var(--cat-c)", enabled: true },
  { id: "automation", labelKey: "automation", labelFallback: "🤖 自动化", icon: Cog, color: "var(--cat-u)", enabled: true },
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
  { key: "", labelKey: "all_status" },
  { key: "running", labelKey: "running" },
  { key: "done", labelKey: "done" },
  { key: "failed", labelKey: "failed" },
  { key: "pending", labelKey: "pending" },
  { key: "planning", labelKey: "planning" },
] as const;

const TIME_OPTIONS = [
  { key: "", labelKey: "all_time" },
  { key: "today", labelKey: "today" },
  { key: "week", labelKey: "last_7_days" },
  { key: "month", labelKey: "last_30_days" },
] as const;

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return t("just_now");
  if (m < 60) return `${m} ${t("minutes_ago")}`;
  const h = Math.floor(d / 3600000);
  if (h < 24) return `${h} ${t("hours_ago")}`;
  return `${Math.floor(d / 86400000)} ${t("days_ago")}`;
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
            title={t("more")}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            <MoreHorizontal size={13} />
          </button>
          <button
            className="sidebar-conv-del"
            title={t("delete")}
            onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
          >
            <Trash2 size={13} />
          </button>
          {menuOpen && (
            <div className="conv-move-menu" onClick={(e) => e.stopPropagation()}>
              <div className="conv-move-label"><FolderInput size={12} /> {t("move_to_space")}</div>
              {workspaces.length === 0 && (
                <div style={{ padding: "4px 7px", fontSize: 11.5, color: "var(--text-3)" }}>{t("no_space_available")}</div>
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
            <div className="ws-item-empty">{t("no_conversations")}</div>
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
export default function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
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
      if (t.closest(".sidebar-header-container")) return;
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

  const isMac = useMemo(() => navigator.userAgent.includes("Mac"), []);

  // 收起状态：渲染窄 rail（保留交通灯占位 + 常驻展开按钮），不卸载以免丢失展开入口
  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <div className="sidebar-collapsed-rail">
          {isMac && <div className="sidebar-traffic-lights-spacer-v" />}
          <button className="sidebar-icon-btn" onClick={toggleSidebar} title="展开侧边栏">
            <PanelLeft size={17} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      {/* ── 标题栏 (无标题栏/透明标题栏适配) ── */}
      <div className="sidebar-header-container">
        <div className="sidebar-top-row">
          {isMac && <div className="sidebar-traffic-lights-spacer" />}
          <div className="sidebar-brand-row">
            <span className="sidebar-brand-name">Pi-a</span>
            <span className="sidebar-brand-version">v0.0.1</span>
          </div>
          <div className="sidebar-top-actions">
            <button className="sidebar-icon-btn" onClick={toggleSidebar} title="收起侧边栏">
              <PanelLeft size={17} />
            </button>
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
      </div>

      {/* ── 新建任务按钮 ── */}
      <div className="sidebar-new-task">
        <button className="new-task-btn" onClick={() => resetToWelcome()}>
          <Plus size={16} strokeWidth={2.5} />
          <span>{t("new_task")}</span>
        </button>
      </div>

      {/* ── 分类导航 ── */}
      <nav className="sidebar-nav">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          const label = t(cat.labelKey);
          if (!cat.enabled) {
            return (
              <button
                key={cat.id}
                className="sidebar-nav-item disabled"
                onClick={() => alert(`${label} function is under development`)}
              >
                <span className="sidebar-nav-icon" style={{ color: "var(--text-4)" }}>
                  <Icon size={17} />
                </span>
                <span className="sidebar-nav-label">{label}</span>
                <span className="sidebar-nav-badge">Soon</span>
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
              <span className="sidebar-nav-label">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── 筛选下拉菜单（状态 + 时间，挂载在侧边栏根级） ── */}
      {filterOpen && (
        <div className="sidebar-filter-menu" onClick={(e) => e.stopPropagation()}>
          <div className="filter-section-label">{t("status")}</div>
          {STATUS_OPTIONS.map(({ key, labelKey }) => (
            <button
              key={key || "all-status"}
              className={`sidebar-filter-item ${filterStatus === key ? "active" : ""}`}
              onClick={() => setFilterStatus(key)}
            >
              <span className="filter-item-label">{t(labelKey)}</span>
              {filterStatus === key && <Check size={13} />}
            </button>
          ))}
          <div className="filter-section-label">{t("filter_time")}</div>
          {TIME_OPTIONS.map(({ key, labelKey }) => (
            <button
              key={key || "all-time"}
              className={`sidebar-filter-item ${filterTime === key ? "active" : ""}`}
              onClick={() => setFilterTime(key)}
            >
              <span className="filter-item-label">{t(labelKey)}</span>
              {filterTime === key && <Check size={13} />}
            </button>
          ))}
          <div className="filter-divider" />
          <button
            className="sidebar-filter-reset"
            onClick={() => { setFilterStatus(""); setFilterTime(""); }}
          >
            <RotateCcw size={12} />
            {t("reset_filter")}
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
                placeholder={t("search_task")}
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
                    return <div className="search-empty">{t("no_matching_tasks")}</div>;
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
                <div className="search-empty">{t("no_matching_tasks")}</div>
              ) : (
                <div className="search-empty">{t("input_keyword_search")}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ 会话列表区域 ═══════ */}
      <div className="sidebar-list-area">

        {/* ── 任务 (N) ── */}
        <CollapsibleSection label={t("tasks")} count={taskConvs.length}>
          {taskConvs.length === 0 ? (
            <div className="sidebar-section-empty">{t("no_tasks")}</div>
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
        <CollapsibleSection label={t("spaces")} count={spaceTotal}>
          {workspaces.length === 0 ? (
            <div className="sidebar-section-empty">{t("no_spaces")}</div>
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
          <div className="sidebar-conv-empty">{t("no_task_click_above")}</div>
        )}
      </div>

      {/* ── 底部 ── */}
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">HF</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{t("local_user")}</div>
          <div className="sidebar-user-plan">DeepSeek · {t("ready")}</div>
        </div>
        <button className="sidebar-icon-btn" onClick={toggleTheme} title={t("toggle_theme")}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="sidebar-icon-btn" onClick={() => setShowSettings(true)} title={t("settings")}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
  );
}
