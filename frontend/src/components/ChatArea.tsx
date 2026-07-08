import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";

export default function ChatArea() {
  const { messages, busy, currentConvId, sidebarCollapsed, toggleSidebar, conversations } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const conv = conversations.find((c) => c.id === currentConvId);
  const showThinking = busy && messages.length > 0 && messages[messages.length - 1].role === "user";

  return (
    <>
      {/* 顶栏 */}
      <header style={{
        height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "0 20px", borderBottom: "1px solid var(--border-soft)", background: "var(--bg)",
      }}>
        {sidebarCollapsed && (
          <button onClick={toggleSidebar} title="展开侧边栏"
            style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 6, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
        )}
        <span style={{ fontSize: "13.5px", fontWeight: 550, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {conv?.title || "新对话"}
        </span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px",
          border: "1px solid var(--border-strong)", borderRadius: 999, fontSize: "11.5px", fontWeight: 550, color: "var(--text-2)",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
          deepseek-v4-flash
        </span>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", scrollBehavior: "smooth" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
          {messages.length === 0 && !busy && (
            <div style={{ textAlign: "center", paddingTop: "12vh" }}>
              <div style={{
                width: 52, height: 52, borderRadius: 15, margin: "0 auto 16px",
                background: "var(--brand-gradient)", color: "#fff", fontWeight: 700, fontSize: 22,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 8px 24px rgba(79,70,229,.3)",
              }}>π</div>
              <h2 style={{ fontSize: 24, fontWeight: 650, marginBottom: 7 }}>有什么可以帮你？</h2>
              <p style={{ color: "var(--text-3)", fontSize: 14 }}>Pi-a 是本地优先的 AI 桌面助手</p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    maxWidth: "78%", background: "var(--accent-soft)", color: "var(--accent)",
                    border: "1px solid var(--accent-border)", padding: "10px 14px",
                    borderRadius: 16, borderBottomRightRadius: 5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                    fontSize: 14, lineHeight: 1.6,
                  }}>{msg.content}</div>
                </div>
              );
            }
            if (msg.role === "assistant") {
              return (
                <div key={msg.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: "var(--brand-gradient)", color: "#fff", fontWeight: 650, fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>π</div>
                  <div style={{ minWidth: 0, maxWidth: "calc(100% - 40px)" }}>
                    <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-3)", marginBottom: 3 }}>Pi-a</div>
                    <div style={{ color: "var(--text)", fontSize: 15, lineHeight: 1.72, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                      {msg.content}{(msg as any)._streaming && <span style={{ display: "inline-block", width: 7, height: 15, background: "var(--accent)", borderRadius: 1, marginLeft: 2, animation: "caret 1s steps(2) infinite" }} />}
                    </div>
                  </div>
                </div>
              );
            }
            // tool message
            return (
              <div key={msg.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 14 }}>🔧</div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 10px",
                  borderRadius: 11, fontSize: 12, fontFamily: "var(--mono)",
                  background: msg.isError ? "var(--red-soft)" : "var(--green-soft)",
                  border: `1px solid ${msg.isError ? "var(--red-border)" : "var(--green-border)"}`,
                  color: msg.isError ? "var(--red-text)" : "var(--green-text)",
                }}>
                  {msg.isError ? "✗" : "✓"} {msg.toolName || "工具"}
                </div>
              </div>
            );
          })}

          {/* 思考中指示器 */}
          {showThinking && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: "var(--brand-gradient)", color: "#fff", fontWeight: 650, fontSize: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>π</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-3)", fontSize: 13 }}>
                <span className="think-dot" />
                <span className="think-dot" />
                <span className="think-dot" />
                <span style={{ marginLeft: 4 }}>思考中</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
