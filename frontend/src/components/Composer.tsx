import { useState, useRef, useEffect } from "react";
import { useStore, type RunMode, type PermLevel } from "../store/useStore";

const MODE_LABELS: Record<RunMode, string> = { ask: "Ask", plan: "Plan", craft: "Craft" };
const PERM_LABELS: Record<PermLevel, string> = { readonly: "仅阅读", default: "默认权限", full: "完全访问" };

export default function Composer() {
  const { sendMessage, abortGeneration, busy, mode, setMode, permission, setPermission } = useStore();
  const [text, setText] = useState("");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showPermMenu, setShowPermMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动高度
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

  return (
    <div style={{ flexShrink: 0, padding: "8px 28px 16px", background: "linear-gradient(to top, var(--bg) 65%, transparent)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{
          background: "var(--bg)", border: "1px solid var(--border-strong)",
          borderRadius: 16, boxShadow: "var(--shadow-md)", overflow: "hidden",
        }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={busy ? "Pi-a 思考中…" : "给 Pi-a 发送消息，或描述你的任务…"}
            rows={1}
            style={{
              width: "100%", border: "none", outline: "none", background: "transparent",
              fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, resize: "none",
              maxHeight: 160, padding: "12px 16px 4px", color: "var(--text)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 6px 10px" }}>
            {/* 模式切换 */}
            <div style={{ position: "relative" }}>
              <button onClick={() => { setShowModeMenu(!showModeMenu); setShowPermMenu(false); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px",
                  border: "1px solid transparent", borderRadius: 7, background: "transparent",
                  color: mode === "craft" ? "var(--accent)" : "var(--text-2)", fontSize: 12, fontWeight: 500,
                }}>
                {mode === "craft" ? "✍️" : mode === "plan" ? "📋" : "💬"} {MODE_LABELS[mode]}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {showModeMenu && (
                <div style={{ position: "absolute", bottom: "100%", marginBottom: 6, left: 0, background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 11, boxShadow: "var(--shadow-lg)", padding: 5, minWidth: 220, zIndex: 9999 }}>
                  {(["ask", "plan", "craft"] as RunMode[]).map((m) => (
                    <div key={m} onClick={() => { setMode(m); setShowModeMenu(false); }}
                      style={{ padding: "8px 10px", borderRadius: 7, cursor: "pointer", display: "flex", gap: 9, alignItems: "flex-start" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                      <span>{m === "ask" ? "💬" : m === "plan" ? "📋" : "✍️"}</span>
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: 550, color: m === mode ? "var(--accent)" : "var(--text)" }}>{MODE_LABELS[m]} 模式</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{m === "ask" ? "仅问答，不调用任何工具" : m === "plan" ? "先出方案，确认后再执行" : "直接执行，边做边改"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 权限切换 */}
            <div style={{ position: "relative" }}>
              <button onClick={() => { setShowPermMenu(!showPermMenu); setShowModeMenu(false); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px",
                  border: "1px solid transparent", borderRadius: 7, background: "transparent",
                  color: permission === "full" ? "var(--accent)" : "var(--text-2)", fontSize: 12, fontWeight: 500,
                }}>
                {permission === "readonly" ? "🔒" : permission === "full" ? "⚡" : "🛡️"} {PERM_LABELS[permission]}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {showPermMenu && (
                <div style={{ position: "absolute", bottom: "100%", marginBottom: 6, left: 0, background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 11, boxShadow: "var(--shadow-lg)", padding: 5, minWidth: 200, zIndex: 9999 }}>
                  {(["readonly", "default", "full"] as PermLevel[]).map((p) => (
                    <div key={p} onClick={() => { setPermission(p); setShowPermMenu(false); }}
                      style={{ padding: "8px 10px", borderRadius: 7, cursor: "pointer", display: "flex", gap: 9, alignItems: "flex-start" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                      <span>{p === "readonly" ? "🔒" : p === "full" ? "⚡" : "🛡️"}</span>
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: 550, color: p === permission ? "var(--accent)" : "var(--text)" }}>{PERM_LABELS[p]}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{p === "readonly" ? "只读不写，最安全" : p === "full" ? "全部自动执行" : "写操作需确认"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />

            {/* 发送/停止按钮 */}
            <button onClick={handleSend} disabled={!busy && !text.trim()}
              style={{
                marginLeft: "auto", width: 38, height: 38, flexShrink: 0, border: "none", borderRadius: 11,
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
        <div style={{ marginTop: 7, fontSize: "10.5px", color: "var(--text-3)", textAlign: "center" }}>
          回车发送 · Shift+回车换行 · Craft/Plan/Ask 切换执行模式
        </div>
      </div>
    </div>
  );
}
