import { useState } from "react";
import { useStore } from "../store/useStore";
import GenerativeWidget from "./GenerativeWidget";
import "./ArtifactPanel.css";

export default function ArtifactPanel() {
  const { showArtifacts, setShowArtifacts, messages, memories, mode, permission, modelId, currentConvId, conversations } = useStore();
  const [activeTab, setActiveTab] = useState<"artifacts" | "status" | "memories">("artifacts");

  const subagentTasks = conversations.filter((c) => c.parentId === currentConvId);

  if (!showArtifacts) return null;

  // 提取所有生成的文件 (工件)
  const artifacts = messages
    .filter((m) => m.role === "tool" && !m.isError && m.content)
    .map((m) => {
      let path = "";
      try {
        const parsed = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
        path = parsed?.details?.path || parsed?.path || "";
      } catch {
        const match = m.content.match(/(?:\/|~)[^\s]+\.(?:docx|xlsx|pptx|pdf|png|jpg|txt|md)/i);
        if (match) path = match[0];
      }
      return { id: m.id, toolName: m.toolName, path, createdAt: m.createdAt };
    })
    .filter((item) => item.path);

  // 估算 Token 占用
  const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const approxTokens = Math.round(totalChars / 3);
  const maxTokens = 128000;
  const tokenPercent = Math.min(100, Math.round((approxTokens / maxTokens) * 100));

  return (
    <div className="artifact-panel">
      <div className="artifact-header">
        <div className="artifact-tabs">
          <button
            className={`tab-btn ${activeTab === "artifacts" ? "active" : ""}`}
            onClick={() => setActiveTab("artifacts")}
          >
            📦 工件 ({artifacts.length})
          </button>
          <button
            className={`tab-btn ${activeTab === "status" ? "active" : ""}`}
            onClick={() => setActiveTab("status")}
          >
            📊 状态
          </button>
          <button
            className={`tab-btn ${activeTab === "memories" ? "active" : ""}`}
            onClick={() => setActiveTab("memories")}
          >
            🧠 记忆 ({memories.length})
          </button>
        </div>
        <button className="close-panel-btn" onClick={() => setShowArtifacts(false)} title="关闭右栏">
          ✕
        </button>
      </div>

      <div className="artifact-content">
        {activeTab === "artifacts" && (
          <div className="artifacts-list">
            {artifacts.length === 0 ? (
              <div className="artifact-empty">
                <div className="empty-icon">📁</div>
                <div>尚未生成任何文档工件</div>
                <div className="empty-sub">让 Agent 生成 Word/Excel/PPT 后在此预览</div>
              </div>
            ) : (
              artifacts.map((art) => {
                const ext = art.path.split(".").pop()?.toLowerCase() || "";
                const icon = ext === "docx" ? "📄" : ext === "xlsx" ? "📊" : ext === "pptx" ? "🎨" : "📑";
                const filename = art.path.split("/").pop() || art.path;

                return (
                  <div key={art.id} className="artifact-item-group">
                    <div className="artifact-card">
                      <div className="artifact-icon">{icon}</div>
                      <div className="artifact-info">
                        <div className="artifact-filename" title={art.path}>
                          {filename}
                        </div>
                        <div className="artifact-meta">
                          <span>.{ext.toUpperCase()}</span>
                          <span>•</span>
                          <span>{new Date(art.createdAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      <button
                        className="artifact-open-btn"
                        onClick={() => {
                          window.open(`file://${art.path}`);
                        }}
                        title="打开文件"
                      >
                        打开
                      </button>
                    </div>

                    <GenerativeWidget toolName={art.toolName} filePath={art.path} />
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "status" && (
          <div className="status-section">
            <div className="status-card">
              <div className="status-card-title">Token 上下文占用</div>
              <div className="token-bar-container">
                <div className="token-bar-fill" style={{ width: `${tokenPercent}%` }} />
              </div>
              <div className="token-status-text">
                <span>约 {approxTokens.toLocaleString()} tokens</span>
                <span>{tokenPercent}% / 128k</span>
              </div>
            </div>

            <div className="status-card">
              <div className="status-card-title">当前引擎状态</div>
              <div className="status-item">
                <span className="label">当前模型:</span>
                <span className="val">{modelId}</span>
              </div>
              <div className="status-item">
                <span className="label">运行模式:</span>
                <span className="val mode-tag">{mode.toUpperCase()}</span>
              </div>
              <div className="status-item">
                <span className="label">权限级别:</span>
                <span className="val perm-tag">{permission.toUpperCase()}</span>
              </div>
              <div className="status-item">
                <span className="label">Context Compaction:</span>
                <span className="val active">已启用 (Auto)</span>
              </div>
            </div>

            <div className="status-card">
              <div className="status-card-title">🤖 后台子代理任务 (pi-subagents)</div>
              {subagentTasks.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--text-3)", padding: "4px 0" }}>暂无后台子代理任务</div>
              ) : (
                subagentTasks.map((st) => (
                  <div key={st.id} className="status-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, fontWeight: 500 }}>
                      <span>{st.title.replace("子任务: ", "")}</span>
                      <span className={`val ${st.status === "running" ? "active" : ""}`}>
                        {st.status === "running" ? "⏳ 运行中" : st.status === "done" ? "✅ 完成" : "❌ 失败"}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                      会话 ID: {st.id.slice(0, 8)} • {new Date(st.updatedAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "memories" && (
          <div className="memories-list">
            {memories.length === 0 ? (
              <div className="artifact-empty">
                <div className="empty-icon">🧠</div>
                <div>暂无知识记忆</div>
              </div>
            ) : (
              memories.map((mem) => (
                <div key={mem.id} className="memory-card">
                  <div className="memory-tag">{mem.kind || "fact"}</div>
                  <div className="memory-text">{mem.content}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
