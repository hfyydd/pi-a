// frontend/src/components/FloatView.tsx — 速唤浮窗组件
import { useState, useEffect, useRef } from "react";
import { Send, ExternalLink, X, Zap, Sparkles } from "lucide-react";
import "./FloatView.css";

export default function FloatView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"ask" | "craft">("ask");
  const [context, setContext] = useState<{ app: string; selection: string } | null>(null);
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 获取上下文 (前台 App + 选中文本)
  const fetchContext = async () => {
    try {
      const res = await fetch("/api/system/context");
      const data = await res.json();
      if (data && (data.app || data.selection)) {
        setContext(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchContext();
    inputRef.current?.focus();

    // 监听 ESC 关闭浮窗
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFloat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const closeFloat = () => {
    // 隐藏窗口
    fetch("/api/float/close", { method: "POST" }).catch(() => {});
  };

  const handleSend = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setResponse("");

    try {
      // 1. 创建临时速唤会话
      const convRes = await fetch("/api/conv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `[速唤] ${prompt.slice(0, 20)}`, category: "assistant" }),
      });
      const convData = await convRes.json();
      const sessionId = convData.id;
      setCurrentSessionId(sessionId);

      // 如果有选中文本，合成入 prompt
      let fullPrompt = prompt;
      if (context?.selection) {
        fullPrompt = `[选中内容来自应用 "${context.app}"]:\n"""\n${context.selection}\n"""\n\n我的问题/指令：${prompt}`;
      }

      // 2. 发起 prompt
      await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text: fullPrompt,
          mode,
          permission: mode === "craft" ? "full" : "readonly",
        }),
      });

      // 3. 建立 SSE 流接收回复
      const es = new EventSource(`/api/events/${sessionId}/stream`);
      let answerText = "";

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "message_update") {
            const content = ev.message?.content?.[0]?.text || "";
            if (content) {
              answerText = content;
              setResponse(answerText);
            }
          }
          if (ev.type === "agent_end") {
            es.close();
            setLoading(false);
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        setLoading(false);
      };
    } catch (err) {
      setResponse(`出错了: ${(err as Error).message}`);
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!currentSessionId) return;
    try {
      await fetch("/api/float/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
      closeFloat();
    } catch {}
  };

  return (
    <div className="float-container">
      {/* 头部极简输入栏 */}
      <div className="float-header">
        <div className="float-brand">π</div>

        {context?.app && (
          <span className="float-chip" title={context.selection ? `选中: ${context.selection}` : undefined}>
            来自 {context.app}
          </span>
        )}

        <div className="float-input-row">
          <input
            ref={inputRef}
            className="float-input"
            placeholder={context?.selection ? `针对 "${context.app}" 选中内容提问…` : "给 Pi-a 提问，按 Esc 退出…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
        </div>

        <div className="float-actions">
          <button
            className={`float-btn ${mode === "craft" ? "active" : ""}`}
            title={mode === "ask" ? "当前: Ask (问答模式)" : "当前: Craft (工具模式)"}
            onClick={() => setMode(mode === "ask" ? "craft" : "ask")}
          >
            {mode === "ask" ? <Zap size={14} /> : <Sparkles size={14} />}
          </button>
          <button className="float-send-btn" disabled={!prompt.trim() || loading} onClick={handleSend}>
            <Send size={13} />
          </button>
          <button className="float-btn" onClick={closeFloat} title="关闭 (Esc)">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 结果显示与转存栏 */}
      {(response || loading) && (
        <>
          <div className="float-result-body">
            {response ? (
              <div style={{ whiteSpace: "pre-wrap" }}>{response}</div>
            ) : (
              <div style={{ color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}>
                <span>Pi-a 正在思考中...</span>
              </div>
            )}
          </div>

          <div className="float-result-footer">
            <span>模式: {mode.toUpperCase()}</span>
            {currentSessionId && response && (
              <button className="float-transfer-btn" onClick={handleTransfer}>
                <ExternalLink size={12} /> 转存为主会话
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
