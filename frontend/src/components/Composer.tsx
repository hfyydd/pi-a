import { useState, useRef, useEffect, Fragment } from "react";
import { useStore, type RunMode, type PermLevel } from "../store/useStore";
import { FolderOpen, ChevronDown, Plus, Search, FolderInput, Settings2, Sparkles, Zap, Shield, X } from "lucide-react";

interface ActiveSkillTag {
  cmd: string;
  name: string;
  icon: string;
}

interface CombinedOption {
  key: string;
  mode: RunMode;
  permission: PermLevel;
  title: string;
  badge?: string;
  desc: string;
  icon: any;
}

const COMBINED_OPTIONS: CombinedOption[] = [
  {
    key: "default",
    mode: "craft",
    permission: "default",
    title: "默认权限",
    badge: "写需确认",
    desc: "智能放行只读操作，修改文件与终端指令需弹窗授权",
    icon: Shield,
  },
  {
    key: "full",
    mode: "craft",
    permission: "full",
    title: "完全访问",
    badge: "自动运行",
    desc: "常用写操作与指令自动执行，高危系统命令安全拦截",
    icon: Zap,
  },
];

interface SlashCommand {
  cmd: string;
  name: string;
  desc: string;
  icon: string;
  category: "skill" | "mode" | "action";
  action: (text: string, setText: (t: string) => void) => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    cmd: "/ego-browser",
    name: "ego-browser 浏览器自动化",
    desc: "使用 Chromium 浏览器环境进行网页自动化、截图、表单与数据抓取",
    icon: "🌐",
    category: "skill",
    action: (_, setText) => setText("请使用 ego-browser 帮我打开网站并进行自动化操作："),
  },
  {
    cmd: "/ppt-generator-pro",
    name: "PPT 高级制作技能",
    desc: "AI 自动生成高质量 PPT 图片与演示，支持智能转场与交互播放",
    icon: "🎞️",
    category: "skill",
    action: (_, setText) => setText("请使用 ppt-generator-pro 帮我生成一套高保真演示幻灯片："),
  },
  {
    cmd: "/weekly-report",
    name: "工作周报生成技能",
    desc: "搜集 Git 提交与项目进展，生成结构化 Word 周报",
    icon: "📝",
    category: "skill",
    action: (_, setText) => setText("请帮我整理并生成一份本周工作周报 Word 文档"),
  },
  {
    cmd: "/data-analysis",
    name: "数据分析技能",
    desc: "读取表格数据 (xlsx/csv) 并生成分析图表摘要",
    icon: "📊",
    category: "skill",
    action: (_, setText) => setText("请帮我读取并分析桌面上的数据表格文件"),
  },
  {
    cmd: "/presentation",
    name: "PPT 演示生成技能",
    desc: "根据主题生成多页 PPT 演示文稿",
    icon: "🎨",
    category: "skill",
    action: (_, setText) => setText("请帮我根据最近项目成果制作一份 PPT 演示文稿"),
  },
  {
    cmd: "/modern-web-guidance",
    name: "现代 Web 规范指南",
    desc: "针对 HTML/CSS/React 提供现代前端最佳实践与 API 规范",
    icon: "🚀",
    category: "skill",
    action: (_, setText) => setText("请按照现代 Web 最佳实践为我设计前端界面与组件："),
  },
  {
    cmd: "/chrome-extensions",
    name: "Chrome 扩展开发技能",
    desc: "构建与发布 Manifest V3 标准的 Chrome 浏览器插件",
    icon: "🧩",
    category: "skill",
    action: (_, setText) => setText("请帮我设计一个 Manifest V3 的 Chrome 浏览器扩展："),
  },
  {
    cmd: "/polish-writing",
    name: "文档润色技能",
    desc: "润色和优化文本文档结构与用词",
    icon: "✍️",
    category: "skill",
    action: (_, setText) => setText("请帮我润色和优化以下文档内容："),
  },
  {
    cmd: "/doc-qa",
    name: "文档问答技能",
    desc: "针对文档内容进行精准问答与引用",
    icon: "❓",
    category: "skill",
    action: (_, setText) => setText("请结合文档回答我以下问题："),
  },
  {
    cmd: "/brainstorm",
    name: "Brainstorm (Superpowers)",
    desc: "发散思考模式：从多角度评估 3-5 种潜在方案，对比可行性与优缺点",
    icon: "🧠",
    category: "mode",
    action: (_, setText) => {
      setText("/brainstorm ");
    },
  },
  {
    cmd: "/plan",
    name: "Plan (Superpowers 方案)",
    desc: "方案拆解模式：制定模块架构与分步执行清单",
    icon: "📋",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("plan");
      setText("/plan ");
    },
  },
  {
    cmd: "/implement",
    name: "Implement (Superpowers)",
    desc: "精准落地模式：高效编写代码或生成工件，同步进行验证",
    icon: "⚡",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("craft");
      setText("/implement ");
    },
  },
  {
    cmd: "/subagent",
    name: "派发子代理 (pi-subagents)",
    desc: "在后台独立上下文派发子任务，不占用当前主窗口",
    icon: "🤖",
    category: "action",
    action: (_, setText) => {
      setText("/subagent 请在后台帮我执行以下独立任务：");
    },
  },
  {
    cmd: "/goal",
    name: "Goal (目标强校验模式)",
    desc: "目标驱动模式：持续推演并验证，直到调用 goal_complete 凭据闭环",
    icon: "🎯",
    category: "mode",
    action: (_, setText) => {
      setText("/goal ");
    },
  },
  {
    cmd: "/craft",
    name: "Craft 模式",
    desc: "切换到 Craft 直接执行模式 (读写与命令)",
    icon: "🛠️",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("craft");
      setText("");
    },
  },
  {
    cmd: "/ask",
    name: "Ask 模式",
    desc: "切换到 Ask 纯文本问答模式",
    icon: "💬",
    category: "mode",
    action: (_, setText) => {
      useStore.getState().setMode("ask");
      setText("");
    },
  },
];

function getActiveOptionKey(permission: PermLevel): string {
  if (permission === "full" || permission === "L3") return "full";
  return "default";
}

export default function Composer() {
  const { sendMessage, abortGeneration, busy, mode, setMode, permission, setPermission,
          currentConvId, conversations,
          workspaces, composerWorkspaceId, setComposerWorkspaceId,
          setShowWorkspaceManager } = useStore();
  const [text, setText] = useState("");
  const [activeSkillTag, setActiveSkillTag] = useState<ActiveSkillTag | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const runningSubAgent = conversations.find(
    c => c.parentId === currentConvId && c.status === "running"
  );
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showModeMenu) return;
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModeMenu]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [text]);

  const handleSend = () => {
    if (busy) { abortGeneration(); return; }
    const t = text.trim();
    if (!t && !activeSkillTag) return;
    const fullMessage = activeSkillTag
      ? `${activeSkillTag.cmd} ${t}`
      : t;
    setText("");
    setActiveSkillTag(null);
    sendMessage(fullMessage);
  };

  // 当前选中的空间名
  const activeWs = composerWorkspaceId
    ? workspaces.find(w => w.id === composerWorkspaceId)
    : null;
  const wsLabel = activeWs?.name || "选择工作空间";

  // 是否显示底部空间行（仅无会话时）
  const showBottomBar = currentConvId === null;

  const activeKey = getActiveOptionKey(permission);
  const activeOpt = COMBINED_OPTIONS.find(o => o.key === activeKey) || COMBINED_OPTIONS[0];
  const ActiveIcon = activeOpt.icon;

  const filteredSlashCmds = slashQuery !== null
    ? SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes("/" + slashQuery) || c.name.toLowerCase().includes(slashQuery))
    : [];

  const handleSelectSlashCmd = (cmd: SlashCommand) => {
    if (cmd.category === "skill") {
      setActiveSkillTag({ cmd: cmd.cmd, name: cmd.name, icon: cmd.icon });
      setText((prev) => prev.replace(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, "").trimStart());
    } else {
      cmd.action(text, setText);
    }
    setSlashQuery(null);
  };

  return (
    <div style={{ flexShrink: 0, padding: "8px 28px 16px", background: "linear-gradient(to top, var(--bg) 65%, transparent)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", position: "relative" }}>
        {/* ── 输入框 + 工具栏（始终显示）── */}
        <div style={{
          background: "var(--bg)", border: "1px solid var(--border-strong)",
          borderRadius: 16, boxShadow: "var(--shadow-md)",
          display: "flex", flexDirection: "column", position: "relative",
        }}>
          {/* ── 激活的 Skill 标签 Chip (Atomic Skill Badge) ── */}
          {activeSkillTag && (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              margin: "10px 14px 2px",
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--accent)",
              width: "fit-content",
              userSelect: "none",
            }}>
              <span>{activeSkillTag.icon}</span>
              <span>{activeSkillTag.cmd}</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>({activeSkillTag.name})</span>
              <button
                onClick={() => setActiveSkillTag(null)}
                title="删除技能标签 (Backspace)"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "currentColor",
                  cursor: "pointer",
                  padding: 0,
                  marginLeft: 2,
                  display: "flex",
                  alignItems: "center",
                  opacity: 0.8,
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* ── 斜杠技能菜单 (Slash Skill Menu) ── */}
          {slashQuery !== null && filteredSlashCmds.length > 0 && (
            <div style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: 0,
              right: 0,
              background: "var(--bg)",
              backdropFilter: "blur(16px) saturate(180%)",
              WebkitBackdropFilter: "blur(16px) saturate(180%)",
              border: "1px solid var(--border-strong)",
              borderRadius: 14,
              boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
              padding: 6,
              zIndex: 99999,
              maxHeight: 300,
              overflowY: "auto",
            }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 10px 6px", borderBottom: "1px solid var(--border)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                <span>⚡ 快捷技能与系统指令</span>
                <span>Tab / Enter 选中 · Esc 退出</span>
              </div>
              {filteredSlashCmds.map((cmd, idx) => {
                const isFirstOfCategory = idx === 0 || filteredSlashCmds[idx - 1].category !== cmd.category;
                const categoryLabel = cmd.category === "skill" ? "🎯 内置技能 (Skills)" : "🎛️ 系统模式 (Modes)";

                return (
                  <Fragment key={cmd.cmd}>
                    {isFirstOfCategory && (
                      <div style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--text-3)",
                        padding: "6px 10px 2px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>
                        {categoryLabel}
                      </div>
                    )}
                    <div
                      onClick={() => handleSelectSlashCmd(cmd)}
                      onMouseEnter={() => setSlashIndex(idx)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: idx === slashIndex ? "var(--bg-hover)" : "transparent",
                        transition: "background 0.1s ease",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{cmd.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: idx === slashIndex ? "var(--accent)" : "var(--text)", display: "flex", gap: 6, alignItems: "center" }}>
                          <span>{cmd.cmd}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: "normal" }}>({cmd.name})</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cmd.desc}
                        </div>
                      </div>
                      {idx === slashIndex && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>↵ 选择</span>}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}

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
            onChange={(e) => {
              const val = e.target.value;
              setText(val);
              const m = val.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
              if (m) {
                setSlashQuery(m[1].toLowerCase());
                setSlashIndex(0);
              } else {
                setSlashQuery(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && activeSkillTag && text === "") {
                e.preventDefault();
                setActiveSkillTag(null);
                return;
              }
              if (slashQuery !== null && filteredSlashCmds.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((prev) => (prev + 1) % filteredSlashCmds.length);
                  return;
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((prev) => (prev - 1 + filteredSlashCmds.length) % filteredSlashCmds.length);
                  return;
                } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                  e.preventDefault();
                  handleSelectSlashCmd(filteredSlashCmds[slashIndex]);
                  return;
                } else if (e.key === "Escape") {
                  setSlashQuery(null);
                  return;
                }
              }
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

            {/* 合并后的单一下拉框（模式与权限一体） */}
            <div style={{ position: "relative" }} ref={modeMenuRef}>
              <button onClick={() => setShowModeMenu(!showModeMenu)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px",
                  border: "1px solid transparent", borderRadius: 7, background: "transparent",
                  color: mode === "craft" ? (permission === "full" || permission === "L3" ? "var(--accent)" : "var(--text)") : "var(--text-2)", fontSize: 12, fontWeight: 500,
                }}>
                <ActiveIcon size={14} />
                <span>{activeOpt.title}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {showModeMenu && (
                <div style={{ position: "absolute", bottom: "calc(100% + 10px)", left: 0, background: "var(--bg)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 36px rgba(0,0,0,0.45)", padding: 6, minWidth: 270, zIndex: 99999 }}>
                  {COMBINED_OPTIONS.map((opt) => {
                    const OptIcon = opt.icon;
                    const isActive = opt.key === activeKey;
                    return (
                      <div
                        key={opt.key}
                        onClick={() => {
                          setMode(opt.mode);
                          setPermission(opt.permission);
                          setShowModeMenu(false);
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          background: isActive ? "var(--bg-hover)" : "transparent",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = isActive ? "var(--bg-hover)" : "transparent"}
                      >
                        <span style={{ marginTop: 2, color: isActive ? "var(--accent)" : "var(--text-2)" }}>
                          <OptIcon size={15} />
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "12.5px", fontWeight: 600, color: isActive ? "var(--accent)" : "var(--text)" }}>
                              {opt.title}
                            </span>
                            {opt.badge && (
                              <span style={{
                                fontSize: 10,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: opt.permission === "full" ? "rgba(239,68,68,0.12)" : opt.permission === "default" ? "var(--accent-soft)" : "var(--bg-sidebar)",
                                color: opt.permission === "full" ? "#ef4444" : opt.permission === "default" ? "var(--accent)" : "var(--text-3)",
                                fontWeight: 500
                              }}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                            {opt.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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

/* ===== 模型选择器（对齐 WorkBuddy / Pi-a 动态模型）===== */

function ModelPicker() {
  const { modelId, modelProvider, settings, setShowSettings } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 从 settings.providers 动态扁平化已填 API Key 或配置启用的真实可用模型项
  const availableModels: Array<{ id: string; provider: string; name: string; providerName: string }> = [];
  if (settings.providers && settings.providers.length > 0) {
    for (const p of settings.providers) {
      // 仅当属于 Ollama 本地服务、或者已填写有效 API Key / 显式启用时展示该渠道模型
      const isConfigured = p.id === "ollama" || (p.apiKey && p.apiKey.trim().length > 0 && p.enabled !== false);
      if (isConfigured && p.models && p.models.length > 0) {
        for (const m of p.models) {
          availableModels.push({
            id: m.id,
            provider: p.id,
            name: m.name || m.id,
            providerName: p.name || p.id,
          });
        }
      }
    }
  }

  // 兜底列表（当尚未填写任何 API Key 时）
  const fallbackList = [
    { id: "deepseek-chat", provider: "deepseek", name: "DeepSeek Chat (V3)", providerName: "DeepSeek" },
    { id: "glm-4-flash", provider: "zhipu", name: "GLM-4 Flash (免费极速)", providerName: "智谱 AI" },
    { id: "moonshot-v1-8k", provider: "moonshot", name: "Kimi 8K", providerName: "Kimi" },
    { id: "gpt-4o", provider: "openai", name: "GPT-4o", providerName: "OpenAI" },
  ];

  const modelList = availableModels.length > 0 ? availableModels : fallbackList;

  // 当前选中的模型
  const current = modelList.find((m) => m.id === modelId && m.provider === modelProvider)
    || modelList.find((m) => m.id === modelId)
    || modelList[0];

  const displayName = current ? `${current.name}` : "DeepSeek Chat (V3)";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (m: (typeof modelList)[number]) => {
    useStore.setState({ modelId: m.id, modelProvider: m.provider });
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "5px 8px",
          border: "1px solid transparent",
          borderRadius: 7,
          background: "transparent",
          color: "var(--text-2)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        <Sparkles size={14} />
        <span>{displayName}</span>
        <ChevronDown size={11} style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div className="model-picker-dropdown">
          {/* Max 模式 */}
          <div className="model-picker-header">
            <Zap size={13} className="model-picker-header-icon" />
            <span className="model-picker-header-title">Max 模式 (全开)</span>
            <label className="model-picker-toggle">
              <input type="checkbox" defaultChecked />
              <span className="toggle-slider" />
            </label>
          </div>

          {/* 推荐模型 */}
          <div className="model-picker-section-title">
            <Sparkles size={13} /> 可用大模型列表 ({modelList.length})
          </div>

          {/* 模型列表 */}
          <div className="model-picker-list" style={{ maxHeight: 240, overflowY: "auto" }}>
            {modelList.map((m) => {
              const active = m.id === modelId;
              return (
                <button
                  key={`${m.provider}-${m.id}`}
                  className={`model-item ${active ? "active" : ""}`}
                  onClick={() => handleSelect(m)}
                >
                  <span className="model-item-dot" style={{ background: getModelColor(m.provider) }} />
                  <span className="model-item-name">{m.name}</span>
                  <span className="model-item-price" style={{ fontSize: 10, color: "var(--text-3)" }}>{m.providerName}</span>
                  {active && <CheckMark />}
                </button>
              );
            })}
          </div>

          {/* 配置自定义模型 */}
          <button
            className="model-custom-btn"
            onClick={() => {
              setOpen(false);
              setShowSettings(true);
            }}
          >
            <Settings2 size={13} />
            配置模型与 API 渠道
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
