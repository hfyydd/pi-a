import { useState, useRef, useEffect } from "react";
import { useStore, type RunMode } from "../store/useStore";
import { FolderOpen, ChevronDown, Plus, Search, FolderInput, Settings2, Sparkles, MessageSquare, PenLine, ClipboardList, Zap } from "lucide-react";

const MODE_LABELS: Record<RunMode, string> = { ask: "Ask", plan: "Plan", craft: "Craft" };

function ModeIcon({ mode, size = 13 }: { mode: RunMode; size?: number }) {
  if (mode === "ask") return <MessageSquare size={size} />;
  if (mode === "plan") return <ClipboardList size={size} />;
  return <PenLine size={size} />;
}

export default function Composer() {
  const { sendMessage, abortGeneration, busy, mode, setMode, permission, setPermission,
          currentConvId, conversations,
          workspaces, composerWorkspaceId, setComposerWorkspaceId,
          setShowWorkspaceManager } = useStore();
  const [text, setText] = useState("");
  const runningSubAgent = conversations.find(
    c => c.parentId === currentConvId && c.status === "running"
  );
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [text]);

  const handleSend = () => {
    if (busy) { abortGeneration(); return; }
    const t = text.trim();
    if (!t) return;
    setText("");
    sendMessage(t);
  };

  // 当前选中的空间名
  const activeWs = composerWorkspaceId
    ? workspaces.find(w => w.id === composerWorkspaceId)
    : null;
  const wsLabel = activeWs?.name || "选择工作空间";

  // 是否显示底部空间行（仅无会话时）
  const showBottomBar = currentConvId === null;

  return (
    <div style={{ flexShrink: 0, padding: "8px 28px 16px", background: "linear-gradient(to top, var(--bg) 65%, transparent)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", position: "relative" }}>
        {/* ── 输入框 + 工具栏（始终显示）── */}
        <div style={{
          background: "var(--bg)", border: "1px solid var(--border-strong)",
          borderRadius: 16, boxShadow: "var(--shadow-md)",
          display: "flex", flexDirection: "column", position: "relative",
        }}>
          {runningSubAgent && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", background: "var(--bg-sidebar)",
              borderBottom: "1px solid var(--border)",
              fontSize: 12, color: "var(--text-2)",
            }}>
              <Sparkles size={13} style={{ color: "var(--accent)" }} />
              <span>正在调用子智能体：</span>
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>{runningSubAgent.title.replace("子任务: ", "")}</strong>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>处理中...</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={busy ? "Pi-a 思考中…" : "今天帮你做些什么？@ 引用对话文件，/ 调用技能与指令"}
            rows={1}
            style={{
              width: "100%", border: "none", outline: "none", background: "transparent",
              fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, resize: "none",
              maxHeight: 160, padding: "12px 16px 4px", color: "var(--text)",
            }}
          />
          {/* ── 工具栏 ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 6px 10px" }}>

            {/* + 按钮 */}
            <button title="附件" style={{
              width: 30, height: 30, border: "none", borderRadius: 7, background: "transparent",
              color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Plus size={16} />
            </button>

            {/* 模式切换 */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowModeMenu(!showModeMenu)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px",
                  border: "1px solid transparent", borderRadius: 7, background: "transparent",
                  color: mode === "craft" ? "var(--accent)" : "var(--text-2)", fontSize: 12, fontWeight: 500,
                }}>
                <ModeIcon mode={mode} /> {MODE_LABELS[mode]}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {showModeMenu && (
                <div style={{ position: "absolute", bottom: "calc(100% + 10px)", left: 0, background: "var(--bg)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 36px rgba(0,0,0,0.45)", padding: 5, minWidth: 220, zIndex: 99999 }}>
                  {(["ask", "plan", "craft"] as RunMode[]).map((m) => (
                    <div key={m} onClick={() => {
                      setMode(m);
                      if (m === "ask" || m === "plan") {
                        setPermission("readonly");
                      } else if (permission === "readonly") {
                        setPermission("default");
                      }
                      setShowModeMenu(false);
                    }}
                      style={{ padding: "8px 10px", borderRadius: 7, cursor: "pointer", display: "flex", gap: 9, alignItems: "flex-start" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                      <span><ModeIcon mode={m} size={15} /></span>
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: 550, color: m === mode ? "var(--accent)" : "var(--text)" }}>{MODE_LABELS[m]} 模式</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{m === "ask" ? "仅问答，自动只读不调工具" : m === "plan" ? "先出方案，确认后再执行" : "动手改代码，边做边测"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }} />

            {/* 模型选择（对齐 WorkBuddy 截图2） */}
            <ModelPicker />

            {/* 麦克风 */}
            <button title="语音输入" style={{
              width: 30, height: 30, border: "none", borderRadius: 7, background: "transparent",
              color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>

            {/* 发送/停止按钮 */}
            <button onClick={handleSend} disabled={!busy && !text.trim()}
              style={{
                width: 38, height: 38, flexShrink: 0, border: "none", borderRadius: 11,
                background: busy ? "var(--text)" : "var(--accent)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: !busy && !text.trim() ? 0.5 : 1,
              }}>
              {busy ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              )}
            </button>
          </div>
        </div>

        {/* ── 底部空间行（仅初始界面 / 无会话时显示）── */}
        {showBottomBar && (
          <div className="composer-bottom-bar">
            {/* 选择工作空间 */}
            <WsPickerDropdown
              label={wsLabel}
              hasSelection={!!composerWorkspaceId}
              open={showWsPicker}
              onToggle={() => setShowWsPicker(!showWsPicker)}
              onClose={() => setShowWsPicker(false)}
              workspaces={workspaces}
              currentId={composerWorkspaceId}
              onSelect={(id) => { setComposerWorkspaceId(id); setShowWsPicker(false); }}
              onManage={() => { setShowWsPicker(false); setShowWorkspaceManager(true); }}
            />
          </div>
        )}

        <div style={{ marginTop: 7, fontSize: "10.5px", color: "var(--text-3)", textAlign: "center" }}>
          内容由 AI 生成，请核实重要信息
        </div>
      </div>
    </div>
  );
}

/* ===== 工作空间下拉（对齐 WorkBuddy 截图）===== */
function WsPickerDropdown({
  label, hasSelection, open, onToggle, onClose,
  workspaces, currentId, onSelect, onManage,
}: {
  label: string;
  hasSelection: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  workspaces: { id: string; name: string; icon: string; dirPath: string }[];
  currentId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  useEffect(() => { if (open) setQuery(""); }, [open]);

  const filtered = query.trim()
    ? workspaces.filter(w =>
        w.name.toLowerCase().includes(query.toLowerCase()) ||
        w.dirPath.toLowerCase().includes(query.toLowerCase())
      )
    : workspaces;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={onToggle}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px",
          border: "1px solid var(--border)", borderRadius: 7, background: "transparent",
          color: hasSelection ? "var(--accent)" : "var(--text-2)", fontSize: 12, fontWeight: 500,
          transition: "all .12s",
        }}>
        <FolderOpen size={14} />
        <span>{label}</span>
        <ChevronDown size={11} style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div className="ws-picker-dropdown">
          {/* 搜索 */}
          <div className="ws-picker-search">
            <Search size={13} className="ws-picker-search-icon" />
            <input
              className="ws-picker-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索工作空间"
              autoFocus
            />
          </div>

          {/* 空间列表 */}
          <div className="ws-picker-list">
            {filtered.length === 0 && query.trim() && (
              <div className="ws-picker-empty">无匹配结果</div>
            )}
            {filtered.map((w) => (
              <button
                key={w.id}
                className={`ws-picker-item ${w.id === currentId ? "active" : ""}`}
                onClick={() => onSelect(w.id)}
              >
                <FolderOpen size={15} className="ws-picker-item-icon" />
                <div className="ws-picker-item-text">
                  <span className="ws-picker-item-name">{w.name}</span>
                  {w.dirPath && <span className="ws-picker-item-path">{w.dirPath}</span>}
                </div>
                {w.id === currentId && <CheckMark />}
              </button>
            ))}
          </div>

          {/* 底部操作 */}
          <div className="ws-picker-actions">
            <button className="ws-picker-action-btn" onClick={onManage}>
              <Plus size={13} />新建工作空间
            </button>
            <button className="ws-picker-action-btn ws-picker-browse" onClick={async () => {
              try {
                const res = await fetch("/api/pick-dir");
                const data = await res.json();
                if (data.cancelled || !data.path) return;
                onManage();
                onClose();
                useStore.getState()._pendingDirPath = { name: data.name, path: data.path };
              } catch (e) {
                console.error("[pick-dir] error:", e);
              }
            }}>
              <FolderInput size={13} />打开本地文件夹
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ws-picker-check">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ===== 模型选择器（对齐 WorkBuddy 截图2）===== */

const MODEL_LIST = [
  { id: "Hy3", provider: "zhipu", name: "Hy3", badge: "当前全高", price: "0.00x", recommended: true },
  { id: "GLM-5.2", provider: "zhipu", name: "GLM-5.2", badge: "周间折扣", price: "0.79x" },
  { id: "GLM-5.1", provider: "zhipu", name: "GLM-5.1", badge: "", price: "0.79x" },
  { id: "GLM-5v-Turbo", provider: "zhipu", name: "GLM-5v-Turbo", badge: "", price: "0.95x" },
  { id: "MiniMax-M3", provider: "minimax", name: "MiniMax-M3", badge: "", price: "0.25x" },
  { id: "Kimi-K2.7-Code", provider: "moonshot", name: "Kimi-K2.7-Code", badge: "", price: "0.57x" },
  { id: "Kimi-K2.6", provider: "moonshot", name: "Kimi-K2.6", badge: "", price: "0.52x" },
  { id: "deepseek-v4-flash", provider: "deepseek", name: "DeepSeek V4 Flash", badge: "", price: "免费" },
];

function ModelPicker() {
  const { modelId } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 当前选中的模型显示名
  const current = MODEL_LIST.find(m => m.id === (modelId || "deepseek-v4-flash")) || MODEL_LIST[MODEL_LIST.length - 1];
  const displayName = current.name;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (m: typeof MODEL_LIST[number]) => {
    // 更新 store 的模型（影响新建会话和后续请求）
    useStore.setState({ modelId: m.id, modelProvider: m.provider });
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px",
          border: "1px solid transparent", borderRadius: 7, background: "transparent",
          color: "var(--text-2)", fontSize: 12, fontWeight: 500,
        }}>
        <Sparkles size={14} />
        <span>{displayName}</span>
        <ChevronDown size={11} style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div className="model-picker-dropdown">
          {/* Max 模式 */}
          <div className="model-picker-header">
            <Zap size={13} className="model-picker-header-icon" />
            <span className="model-picker-header-title">Max 模式</span>
            <label className="model-picker-toggle">
              <input type="checkbox" />
              <span className="toggle-slider" />
            </label>
          </div>

          {/* 推荐模型 */}
          <div className="model-picker-section-title">
            <Sparkles size={13} /> 推荐模型
          </div>

          {/* 模型列表 */}
          <div className="model-picker-list">
            {MODEL_LIST.map((m) => (
              <button
                key={m.id}
                className={`model-item ${m.id === (modelId || "deepseek-v4-flash") ? "active" : ""}`}
                onClick={() => handleSelect(m)}
              >
                <span className="model-item-dot" style={{ background: getModelColor(m.provider) }} />
                <span className="model-item-name">{m.name}</span>
                {m.badge && <span className={`model-badge ${m.badge.includes("全高") ? "highlight" : ""}`}>{m.badge}</span>}
                <span className="model-item-price">{m.price}</span>
                {m.id === (modelId || "deepseek-v4-flash") && <CheckMark />}
              </button>
            ))}
          </div>

          {/* 配置自定义模型 */}
          <button className="model-custom-btn">
            <Settings2 size={13} />
            配置自定义模型
          </button>
        </div>
      )}
    </div>
  );
}

function getModelColor(provider: string): string {
  const colors: Record<string, string> = {
    zhipu: "#4F46E5",
    deepseek: "#10B981",
    minimax: "#EC4899",
    moonshot: "#F59E0B",
  };
  return colors[provider] || "var(--text-3)";
}
