import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import "./ChatArea.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";


/** 工具卡片组件（照 WorkBuddy ToolCard 模式） */
function ToolCard({ name, status, args, result }: { name: string; status: "running" | "success" | "error"; args?: string; result?: string }) {
  const [expanded, setExpanded] = useState(false);
  const icon = status === "error" ? "✗" : status === "running" ? "⋯" : "✓";
  const outcomeClass = status === "error" ? "error" : status === "running" ? "pending" : "success";

  return (
    <div className="tool-card-container">
      <div className={`tool-card ${outcomeClass}`}>
        <div className="tool-inner" onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
          <div className="card-header">
            <div className="card-header-top">
              <div className="left">
                <span className="tool-icon">{icon}</span>
                <span className="tool-name">{name}</span>
              </div>
              <div className="right">
                <span className={`tool-status ${outcomeClass}`}>
                  {status === "running" ? "执行中" : status === "error" ? "失败" : "完成"}
                </span>
                {(args || result) && <ChevronDown size={14} className={`tool-chevron ${expanded ? "expanded" : ""}`} />}
              </div>
            </div>
          </div>
          {expanded && (args || result) && (
            <div className="card-content">
              {args && (
                <div className="tool-section">
                  <div className="tool-section-title">参数</div>
                  <pre className="tool-detail">{args}</pre>
                </div>
              )}
              {result && (
                <div className="tool-section">
                  <div className="tool-section-title">结果</div>
                  <pre className="tool-detail">{result}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 助手消息内容（照 WorkBuddy AssistantContentRenderer） */
function AssistantContent({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className="assistantTextContent">
      <div className={streaming ? "cb-markdown streaming" : "cb-markdown"}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }: any) {
              const isInline = !className;
              if (isInline) return <code className="inline-code" {...props}>{children}</code>;
              return <code className={className} {...props}>{children}</code>;
            },
            a({ children, ...props }: any) {
              return <a target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {streaming && <span className="streaming-cursor" />}
    </div>
  );
}

export default function ChatArea() {
  const { messages, busy, currentConvId, sidebarCollapsed, toggleSidebar, conversations } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // 自动滚动（照 WorkBuddy useMessageScroll 模式）
  useEffect(() => {
    if (scrollRef.current && autoScrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 用户向上滚动时暂停自动滚动
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      autoScrollRef.current = true;
    }
  };

  const conv = conversations.find((c) => c.id === currentConvId);
  const showThinking = busy && messages.length > 0 && messages[messages.length - 1].role === "user";
  const showScrollBtn = !autoScrollRef.current && messages.length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
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
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: busy ? "var(--amber)" : "var(--green)" }} />
          {conv?.modelId || "deepseek-v4-flash"}
        </span>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        <div style={{ maxWidth: 832, margin: "0 auto", padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
          {messages.length === 0 && !busy && <WelcomeScreen />}

          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="chatMessageContainer" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div className="userMessageWrapper">
                    <div className="userMessageBubble">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            }
            if (msg.role === "assistant") {
              const isStreaming = (msg as any)._streaming;
              return (
                <div key={msg.id} className="chatMessageContainer assistantRow">
                  <div className="avatarWrapper">
                    <div className="assistantAvatar">π</div>
                  </div>
                  <div className={`assistantMessage ${isStreaming ? "streamingMessage" : ""}`}>
                    <div className="assistantMessageContent">
                      <AssistantContent content={msg.content} streaming={isStreaming} />
                    </div>
                  </div>
                </div>
              );
            }
            // tool message
            return (
              <div key={msg.id} className="chatMessageContainer assistantRow" style={{ alignItems: "center" }}>
                <div className="avatarWrapper" style={{ opacity: 0.7 }}>
                  <div className="assistantAvatar">🔧</div>
                </div>
                <div className="assistantMessage">
                  <ToolCard
                    name={msg.toolName || "工具"}
                    status={msg.isError ? "error" : "success"}
                  />
                </div>
              </div>
            );
          })}

          {/* 思考中指示器 */}
          {showThinking && (
            <div className="chatMessageContainer assistantRow">
              <div className="avatarWrapper">
                <div className="assistantAvatar">π</div>
              </div>
              <div className="assistantMessage">
                <div className="loadingDots">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 滚动到底部按钮 */}
        {showScrollBtn && (
          <button onClick={scrollToBottom} style={{
            position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
            width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--border-strong)",
            background: "var(--bg)", boxShadow: "var(--shadow-md)", display: "flex",
            alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10,
          }}>
            <ChevronDown size={18} color="var(--text-2)" />
          </button>
        )}
      </div>
    </div>
  );
}

/** 欢迎页 */
function WelcomeScreen() {
  return (
    <div style={{ textAlign: "center", paddingTop: "10vh" }}>
      <div style={{
        width: 52, height: 52, borderRadius: 15, margin: "0 auto 16px",
        background: "var(--brand-gradient)", color: "#fff", fontWeight: 700, fontSize: 22,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 8px 24px rgba(79,70,229,.3)",
      }}>π</div>
      <h2 style={{ fontSize: 24, fontWeight: 650, marginBottom: 7, letterSpacing: "-.02em" }}>有什么可以帮你？</h2>
      <p style={{ color: "var(--text-3)", fontSize: 14 }}>Pi-a 是本地优先的 AI 桌面助手</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 520, margin: "28px auto 0" }}>
        {[
          { t: "📊 读取表格并总结", d: "支持 xlsx/csv/docx", q: "读一下 ~/Desktop/sample.xlsx 并总结内容" },
          { t: "📝 生成周报文档", d: "输出 docx 工件", q: "帮我生成一份本周工作周报 docx" },
          { t: "🧠 记住我的偏好", d: "写入长期记忆", q: "记住我喜欢简洁的写作风格" },
          { t: "🎯 生成演示文稿", d: "输出 pptx 工件", q: "做一个产品季度汇报 PPT" },
        ].map((s, i) => (
          <div key={i} onClick={() => useStore.getState().sendMessage(s.q)} style={{
            textAlign: "left", padding: "13px 14px", background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 11, cursor: "pointer", transition: "all .14s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg)"; }}>
            <div style={{ fontSize: 13, fontWeight: 550, color: "var(--text)", marginBottom: 2 }}>{s.t}</div>
            <div style={{ fontSize: "11.5px", color: "var(--text-3)" }}>{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
