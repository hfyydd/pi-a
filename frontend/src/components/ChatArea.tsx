import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import "./ChatArea.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, Briefcase, Code2, Palette, FileCode, Globe, Bot, MoreHorizontal, FileText, BarChart3, Mail, Layout, Shapes, Image, Check, X, Loader2, Wrench } from "lucide-react";


/** 工具卡片组件（照 WorkBuddy ToolCard 模式） */
function ToolCard({ name, status, args, result }: { name: string; status: "running" | "success" | "error"; args?: string; result?: string }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = status === "error" ? <X size={13} /> : status === "running" ? <Loader2 size={13} className="tool-spin" /> : <Check size={13} />;
  const outcomeClass = status === "error" ? "error" : status === "running" ? "pending" : "success";

  return (
    <div className="tool-card-container">
      <div className={`tool-card ${outcomeClass}`}>
        <div className="tool-inner" onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
          <div className="card-header">
            <div className="card-header-top">
              <div className="left">
                <span className="tool-icon">{statusIcon}</span>
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
                  <div className="assistantAvatar"><Wrench size={14} /></div>
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

/** 欢迎页（对齐 WorkBuddy 初始界面，使用 lucide 图标） */
function WelcomeScreen() {
  const [activeTab, setActiveTab] = useState("代码开发");

  const mainTabs = [
    { key: "日常办公", icon: Briefcase },
    { key: "代码开发", icon: Code2 },
    { key: "设计创意", icon: Palette },
  ];

  const subTabs: Record<string, Array<{ key: string; icon: any }>> = {
    "代码开发": [
      { key: "日常开发", icon: FileCode },
      { key: "网站开发", icon: Globe },
      { key: "Agent 应用", icon: Bot },
      { key: "更多", icon: MoreHorizontal },
    ],
    "日常办公": [
      { key: "文档处理", icon: FileText },
      { key: "数据分析", icon: BarChart3 },
      { key: "邮件管理", icon: Mail },
      { key: "更多", icon: MoreHorizontal },
    ],
    "设计创意": [
      { key: "UI 设计", icon: Layout },
      { key: "图标生成", icon: Shapes },
      { key: "图片编辑", icon: Image },
      { key: "更多", icon: MoreHorizontal },
    ],
  };

  return (
    <div className="welcome-screen">
      {/* 标题区 — 左对齐 */}
      <div className="welcome-header">
        <h1 className="welcome-title">Pi-a</h1>
        <p className="welcome-subtitle">你的本地 AI 超能力</p>
      </div>

      {/* 主分类 tab */}
      <div className="welcome-tabs">
        {mainTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={`welcome-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon size={15} className="welcome-tab-icon" strokeWidth={2} />
              {tab.key}
            </button>
          );
        })}
      </div>

      {/* 子分类（根据主 tab 变化） */}
      <div className="welcome-subtabs">
        {(subTabs[activeTab] || []).map((sub) => {
          const Icon = sub.icon;
          return (
            <button key={sub.key} className="welcome-subtab">
              <Icon size={13} className="welcome-subtab-icon" strokeWidth={2} />
              {sub.key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
