import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import "./ChatArea.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ToolConfirmDialog from "./ToolConfirmDialog";
import { getRandomTip } from "../utils/loadingTips";
import { ChevronDown, Briefcase, Code2, Palette, FileCode, Globe, Bot, MoreHorizontal, FileText, BarChart3, Mail, Layout, Shapes, Image, Check, X, Loader2, Copy, ThumbsUp, ThumbsDown, Volume2, Share2 } from "lucide-react";


/** 工具卡片组件（对标 WorkBuddy：内联折叠式，支持点击展开查看详情） */
function ToolCard({
  name,
  status,
  args,
  content,
}: {
  name: string;
  status: "running" | "success" | "error";
  args?: string;
  content?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = status === "error" ? <X size={12} /> : status === "running" ? <Loader2 size={12} className="tool-spin" /> : <Check size={12} />;
  const statusText = status === "running" ? "执行中..." : status === "error" ? "失败" : "运行成功";
  const outcomeClass = status === "error" ? "error" : status === "running" ? "pending" : "success";

  // 解析命令参数
  let commandText = "";
  try {
    if (args) {
      const parsed = JSON.parse(args);
      commandText = parsed.command || JSON.stringify(parsed);
    }
  } catch {
    commandText = args || "";
  }

  const toolLabel: Record<string, string> = {
    bash: "bash",
    write: "写入文件",
    edit: "编辑文件",
    read: "读取文件",
    memory_write: "记忆",
    memory_recall: "回忆",
    web_search: "搜索",
    web_fetch: "抓取网页",
    screenshot: "截图",
    mouse_click: "点击",
    key_type: "键入",
  };
  const label = toolLabel[name] || name;

  return (
    <div className={`tool-collapsible-wrapper ${outcomeClass}`}>
      {/* 头部折叠控制条 */}
      <div
        className={`tool-inline-header ${outcomeClass} ${expanded ? "expanded" : ""}`}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span className={`tool-inline-icon ${outcomeClass}`}>{statusIcon}</span>
        <span className="tool-inline-name">
          {name === "bash" && commandText ? `运行 ${commandText.slice(0, 45)}${commandText.length > 45 ? "..." : ""}` : label}
        </span>
        <span className={`tool-inline-status ${outcomeClass}`}>{statusText}</span>
        <ChevronDown size={12} className={`tool-inline-chevron ${expanded ? "expanded" : ""}`} />
      </div>

      {/* 展开后的详细内容板 */}
      {expanded && (
        <div className="tool-details-panel">
          {commandText && (
            <pre className="tool-card-box-code command">{commandText}</pre>
          )}

          {content && (
            <pre className="tool-card-box-code output" style={{ marginTop: 6 }}>
              {content}
            </pre>
          )}
        </div>
      )}
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

function ThinkingBubble() {
  const [tip, setTip] = useState("");
  useEffect(() => {
    setTip(getRandomTip());
  }, []);

  return (
    <div className="chatMessageContainer assistantRow">
      <div className="avatarWrapper">
        <div className="assistantAvatar">π</div>
      </div>
      <div className="assistantMessage" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="loadingDots" style={{ display: "inline-flex" }}>
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>生成回复中</span>
        </div>
        {tip && (
          <div style={{
            fontSize: 12,
            color: "var(--text-3)",
            background: "var(--bg-sidebar)",
            border: "1px solid var(--border-soft)",
            padding: "5px 12px",
            borderRadius: 8,
            maxWidth: "fit-content",
            marginTop: 2,
            lineHeight: 1.4,
          }}>
            {tip}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function ChatArea() {
  const { messages, busy, currentConvId, sidebarCollapsed, toggleSidebar, conversations } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // 功能按钮状态记录
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, "up" | "down">>({});
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // 复制文字
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 点赞/踩评
  const handleRate = (id: string, type: "up" | "down") => {
    setRatings((prev) => ({
      ...prev,
      [id]: prev[id] === type ? undefined : type,
    }) as any);
  };

  // 语音朗读 (HTML5 SpeechSynthesis)
  const handleSpeak = (id: string, text: string) => {
    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);
      window.speechSynthesis.speak(utterance);
      setSpeakingId(id);
    }
  };

  // 分享功能
  const handleShare = (text: string) => {
    navigator.clipboard.writeText(text);
    // 可选：静默提示或自定义反馈。这里复制文字后可以直接提示已复制
  };

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
      <header className="chat-header">
        {sidebarCollapsed && (
          <button onClick={toggleSidebar} title="展开侧边栏"
            style={{ width: 28, height: 28, border: "none", background: "transparent", borderRadius: 6, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                <div key={msg.id} className="chatMessageContainer userRow" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div className="userMessageWrapper">
                    <div className="userMessageBubble">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                  <div className="message-action-row user-actions">
                    <button className="action-btn" onClick={() => handleCopy(msg.id, msg.content)} title="复制内容">
                      {copiedId === msg.id ? <Check size={12} className="copied" /> : <Copy size={12} />}
                    </button>
                    {msg.createdAt && <span className="message-time">{formatTime(msg.createdAt)}</span>}
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
                    {!isStreaming && (
                      <div className="message-action-row assistant-actions">
                        <button className="action-btn" onClick={() => handleCopy(msg.id, msg.content)} title="复制内容">
                          {copiedId === msg.id ? <Check size={12} className="copied" /> : <Copy size={12} />}
                        </button>
                        <button className={`action-btn ${ratings[msg.id] === "up" ? "active-like" : ""}`} onClick={() => handleRate(msg.id, "up")} title="赞同">
                          <ThumbsUp size={12} />
                        </button>
                        <button className={`action-btn ${ratings[msg.id] === "down" ? "active-dislike" : ""}`} onClick={() => handleRate(msg.id, "down")} title="反对">
                          <ThumbsDown size={12} />
                        </button>
                        <button className={`action-btn ${speakingId === msg.id ? "active-speak" : ""}`} onClick={() => handleSpeak(msg.id, msg.content)} title={speakingId === msg.id ? "停止朗读" : "语音朗读"}>
                          <Volume2 size={12} />
                        </button>
                        <button className="action-btn" onClick={() => handleShare(msg.content)} title="复制链接分享">
                          <Share2 size={12} />
                        </button>
                        <button className="action-btn" title="更多选项">
                          <MoreHorizontal size={12} />
                        </button>
                        {msg.createdAt && <span className="message-time">{formatTime(msg.createdAt)}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            // tool message — 内联折叠，无单独头像（对标 WorkBuddy）
            return (
              <div key={msg.id} className="tool-inline-row">
                <ToolCard
                  name={msg.toolName || "工具"}
                  status={msg.status || (msg.isError ? "error" : "success")}
                  args={msg.toolArgs}
                  content={msg.content}
                />
              </div>
            );
          })}

          {/* 内联工具确认卡片 */}
          <ToolConfirmDialog />

          {/* 思考中指示器 */}
          {showThinking && (
            <ThinkingBubble />
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

interface PromptScenario {
  id: string;
  title: string;
  desc: string;
  prompt: string;
  skillCmd?: string;
  icon: string;
}

const SCENARIOS: Record<string, PromptScenario[]> = {
  "日常办公-文档处理": [
    {
      id: "doc-weekly",
      title: "自动生成工作周报",
      desc: "整理近期提交记录与项目进展，一键输出结构化 Word 周报",
      prompt: "请帮我整理并生成一份本周工作周报 Word 文档",
      skillCmd: "/weekly-report",
      icon: "📝",
    },
    {
      id: "doc-polish",
      title: "文档润色与优化",
      desc: "对文字段落、排版和语言逻辑进行专业升华与结构改进",
      prompt: "请帮我润色和优化以下文档内容：",
      skillCmd: "/polish-writing",
      icon: "✍️",
    },
  ],
  "日常办公-数据分析": [
    {
      id: "data-excel",
      title: "Excel / CSV 数据表格分析",
      desc: "读取本地表格数据，自动计算关键指标并生成分析结论",
      prompt: "请帮我读取并分析桌面上的数据表格文件，汇总核心指标与趋势",
      skillCmd: "/data-analysis",
      icon: "📊",
    },
    {
      id: "data-ppt",
      title: "AI 自动生成 PPT 演示",
      desc: "基于数据分析或汇报大纲，一键生成高保真 PPT 图片与动态演示",
      prompt: "请使用 ppt-generator-pro 帮我生成一套高保真演示幻灯片",
      skillCmd: "/ppt-generator-pro",
      icon: "🎞️",
    },
  ],
  "日常办公-邮件管理": [
    {
      id: "mail-draft",
      title: "商务邮件撰写与回复",
      desc: "针对业务沟通、汇报对接，一键输出得体专业的商务邮件",
      prompt: "请帮我撰写一封关于项目合作确认的专业商务邮件",
      icon: "✉️",
    },
  ],
  "代码开发-日常开发": [
    {
      id: "dev-fix",
      title: "代码检查与 Bug 修复",
      desc: "分析工作区代码中的类型错误与规范问题并自动修补",
      prompt: "请扫描当前工作区，帮我分析代码中的潜在错误或规范问题并修补",
      skillCmd: "/implement",
      icon: "⚡",
    },
    {
      id: "dev-web",
      title: "现代 Web 组件构建",
      desc: "基于 React / CSS 最佳实践构建现代 UI 组件与响应式界面",
      prompt: "请按照现代 Web 最佳实践为我设计前端界面与组件",
      skillCmd: "/modern-web-guidance",
      icon: "🚀",
    },
  ],
  "代码开发-网站开发": [
    {
      id: "web-app",
      title: "全栈 Web App 快速原型",
      desc: "从零搭建具备现代化 UI 与丰富交互的前端应用原型",
      prompt: "请帮我从零设计并制作一个现代化 Web 应用原型",
      skillCmd: "/modern-web-guidance",
      icon: "🌐",
    },
    {
      id: "chrome-ext",
      title: "Chrome 扩展开发",
      desc: "构建与发布 Manifest V3 标准的 Chrome 浏览器插件",
      prompt: "请帮我设计一个 Manifest V3 的 Chrome 浏览器扩展",
      skillCmd: "/chrome-extensions",
      icon: "🧩",
    },
  ],
  "代码开发-Agent 应用": [
    {
      id: "agent-browser",
      title: "ego-browser 浏览器自动化",
      desc: "使用 Chromium 环境进行网页自动化、截图、表单与数据抓取",
      prompt: "请使用 ego-browser 帮我打开网站并进行自动化操作",
      skillCmd: "/ego-browser",
      icon: "🤖",
    },
    {
      id: "agent-subagent",
      title: "派发后台子智能体",
      desc: "在后台独立上下文派发子任务，不占用当前主窗口",
      prompt: "请在后台帮我执行以下独立任务：",
      skillCmd: "/subagent",
      icon: "⚙️",
    },
  ],
  "设计创意-UI 设计": [
    {
      id: "design-ui",
      title: "现代 UI / UX 界面设计",
      desc: "设计炫酷暗色模式、玻璃拟物与动态微交互 UI 界面",
      prompt: "请按照现代 Web 最佳实践为我设计一个高颜值的 UI 界面",
      skillCmd: "/modern-web-guidance",
      icon: "🎨",
    },
  ],
  "设计创意-图标生成": [
    {
      id: "design-icon",
      title: "矢量 SVG 图标与 Logo",
      desc: "生成高品质、响应式的应用图标与品牌 SVG 矢量标识",
      prompt: "请帮我设计一个精致且具备现代辨识度的 SVG 应用 Logo 图标",
      icon: "💎",
    },
  ],
};

/** 欢迎页（包含主分类、子分类与交互式场景 Prompt 卡片网格） */
function WelcomeScreen() {
  const { sendMessage } = useStore();
  const [activeTab, setActiveTab] = useState("日常办公");
  const [activeSubTab, setActiveSubTab] = useState("文档处理");

  const mainTabs = [
    { key: "日常办公", icon: Briefcase },
    { key: "代码开发", icon: Code2 },
    { key: "设计创意", icon: Palette },
  ];

  const subTabsMap: Record<string, Array<{ key: string; icon: any }>> = {
    "日常办公": [
      { key: "文档处理", icon: FileText },
      { key: "数据分析", icon: BarChart3 },
      { key: "邮件管理", icon: Mail },
      { key: "更多", icon: MoreHorizontal },
    ],
    "代码开发": [
      { key: "日常开发", icon: FileCode },
      { key: "网站开发", icon: Globe },
      { key: "Agent 应用", icon: Bot },
      { key: "更多", icon: MoreHorizontal },
    ],
    "设计创意": [
      { key: "UI 设计", icon: Layout },
      { key: "图标生成", icon: Shapes },
      { key: "图片编辑", icon: Image },
      { key: "更多", icon: MoreHorizontal },
    ],
  };

  const currentSubTabs = subTabsMap[activeTab] || [];
  const currentScenarios = SCENARIOS[`${activeTab}-${activeSubTab}`] || SCENARIOS["日常办公-文档处理"] || [];

  const handleRunScenario = (sc: PromptScenario) => {
    const fullText = sc.skillCmd ? `${sc.skillCmd} ${sc.prompt}` : sc.prompt;
    sendMessage(fullText);
  };

  return (
    <div className="welcome-screen">
      {/* 标题区 — 居中对齐 */}
      <div className="welcome-header">
        <h1 className="welcome-title">Pi-a</h1>
        <p className="welcome-subtitle">你的本地 AI 超能力</p>
      </div>

      {/* 主分类 tab */}
      <div className="welcome-tabs">
        {mainTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              className={`welcome-tab ${isActive ? "active" : ""}`}
              onClick={() => {
                setActiveTab(tab.key);
                const firstSub = (subTabsMap[tab.key] || [])[0]?.key || "文档处理";
                setActiveSubTab(firstSub);
              }}
            >
              <Icon size={15} className="welcome-tab-icon" strokeWidth={2} />
              {tab.key}
            </button>
          );
        })}
      </div>

      {/* 子分类（根据主 tab 动态切换） */}
      <div className="welcome-subtabs">
        {currentSubTabs.map((sub) => {
          const Icon = sub.icon;
          const isActive = activeSubTab === sub.key;
          return (
            <button
              key={sub.key}
              className={`welcome-subtab ${isActive ? "active" : ""}`}
              onClick={() => setActiveSubTab(sub.key)}
            >
              <Icon size={13} className="welcome-subtab-icon" strokeWidth={2} />
              {sub.key}
            </button>
          );
        })}
      </div>

      {/* 场景 Prompt 快捷卡片网格 */}
      <div className="welcome-scenarios-grid">
        {currentScenarios.map((sc) => (
          <div
            key={sc.id}
            className="welcome-scenario-card"
            onClick={() => handleRunScenario(sc)}
          >
            <div className="scenario-card-header">
              <span className="scenario-icon">{sc.icon}</span>
              <span className="scenario-title">{sc.title}</span>
              {sc.skillCmd && <span className="scenario-skill-tag">{sc.skillCmd}</span>}
            </div>
            <p className="scenario-desc">{sc.desc}</p>
            <div className="scenario-card-footer">
              <span className="scenario-action-hint">点击立即启动 AI 任务</span>
              <button
                className="scenario-run-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRunScenario(sc);
                }}
                title="立即运行"
              >
                ↵
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
