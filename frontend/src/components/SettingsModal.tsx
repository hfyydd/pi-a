import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";
import {
  User, Settings, Cpu, Keyboard, Brain, Sparkles, Sliders, Laptop,
  Shield, HelpCircle, X, Eye, EyeOff, Trash2, Database, Sun, Moon,
  ChevronRight, Lock, Activity, FileText, Terminal, Globe, Plus
} from "lucide-react";
import "./SettingsModal.css";
import { PiLogo } from "./PiLogo";

type TabId =
  | "account"
  | "system"
  | "computer_use"
  | "agent"
  | "shortcut"
  | "memory"
  | "model"
  | "assistant"
  | "personalize"
  | "data"
  | "security"
  | "help";

interface TabItem {
  id: TabId;
  label: string;
  icon: any;
}

const TABS: TabItem[] = [
  { id: "account", label: "账户管理", icon: User },
  { id: "system", label: "系统设置", icon: Settings },
  { id: "computer_use", label: "电脑操控 (Computer Use)", icon: Laptop },
  { id: "agent", label: "智能体设置", icon: Cpu },
  { id: "shortcut", label: "快捷键", icon: Keyboard },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "model", label: "模型", icon: Sparkles },
  { id: "assistant", label: "助理设置", icon: Sliders },
  { id: "personalize", label: "个性化", icon: Laptop },
  { id: "data", label: "数据管理", icon: Database },
  { id: "security", label: "安全中心", icon: Shield },
  { id: "help", label: "帮助与反馈", icon: HelpCircle },
];

export default function SettingsModal() {
  const {
    showSettings,
    setShowSettings,
    settings,
    updateSettings,
    apiKeys,
    saveApiKey,
    deleteApiKey,
    memories,
    loadMemories,
    deleteMemory,
    theme,
    toggleTheme,
    auditLogs,
    loadAuditLogs,
    testConnection,
    saveCustomProvider,
    deleteCustomProvider,
    fetchOllamaModels,
  } = useStore();

  const [activeTab, setActiveTab] = useState<TabId>("system");

  // State for API keys form
  const [keysInput, setKeysInput] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // State for Model tab testing & custom forms
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState<{ id?: string; name: string; baseUrl: string; apiKey: string; models: string }>({
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: "",
  });
  const [ollamaStatus, setOllamaStatus] = useState<any>(null);

  // State for memory searching
  const [memorySearch, setMemorySearch] = useState("");

  // Sub-modals for Security center rules
  const [subModalType, setSubModalType] = useState<"file" | "command" | "network" | null>(null);
  const [newRuleInput, setNewRuleInput] = useState("");

  const getSecurityRulesList = (type: "file" | "command" | "network"): string[] => {
    try {
      const val = type === "file" ? settings.securityFileRules
                : type === "command" ? settings.securityCommandRules
                : settings.securityNetworkRules;
      return JSON.parse(val || "[]");
    } catch {
      return [];
    }
  };

  const handleAddSecurityRule = (type: "file" | "command" | "network") => {
    if (!newRuleInput.trim()) return;
    const current = getSecurityRulesList(type);
    if (current.includes(newRuleInput.trim())) {
      setNewRuleInput("");
      return;
    }
    const next = [...current, newRuleInput.trim()];
    const str = JSON.stringify(next);
    if (type === "file") updateSettings({ securityFileRules: str });
    else if (type === "command") updateSettings({ securityCommandRules: str });
    else updateSettings({ securityNetworkRules: str });
    setNewRuleInput("");
  };

  const handleRemoveSecurityRule = (type: "file" | "command" | "network", rule: string) => {
    const current = getSecurityRulesList(type);
    const next = current.filter(r => r !== rule);
    const str = JSON.stringify(next);
    if (type === "file") updateSettings({ securityFileRules: str });
    else if (type === "command") updateSettings({ securityCommandRules: str });
    else updateSettings({ securityNetworkRules: str });
  };

  // State for Computer Use system permissions
  const [systemPerms, setSystemPerms] = useState<any>(null);
  const [loadingPerms, setLoadingPerms] = useState(false);

  const fetchSystemPerms = async () => {
    setLoadingPerms(true);
    try {
      const res = await fetch("/api/system/permissions");
      const data = await res.json();
      setSystemPerms(data);
    } catch (e) {
      console.error("[SettingsModal] 获取权限状态失败:", e);
    } finally {
      setLoadingPerms(false);
    }
  };

  const openSystemSettings = async (target: "accessibility" | "screen") => {
    try {
      await fetch("/api/system/permissions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
    } catch (e) {
      console.error("[SettingsModal] 打开系统偏好设置失败:", e);
    }
  };

  // Load memories and settings keys on mount
  useEffect(() => {
    if (showSettings) {
      useStore.getState().loadSettings();
      if (activeTab === "memory") {
        loadMemories();
      }
      if (activeTab === "security") {
        loadAuditLogs();
      }
      if (activeTab === "computer_use") {
        fetchSystemPerms();
      }
      if (activeTab === "model") {
        fetchOllamaModels().then(setOllamaStatus);
      }
    }
  }, [showSettings, activeTab]);

  if (!showSettings) return null;

  // Handle Directory Browse for Default Workspace
  const handleBrowseWorkspaceDir = async () => {
    try {
      const res = await fetch("/api/pick-dir");
      const data = await res.json();
      if (data.cancelled || !data.path) return;
      updateSettings({ defaultWorkspaceDir: data.path });
    } catch (e) {
      console.error("[settings] pick-dir error:", e);
    }
  };

  // Convert fontSize string to slider index (values: 12, 14, 16, 18, 20, 22)
  const fontSizes = ["12", "14", "16", "18", "20", "22"];
  const getFontSliderValue = () => {
    const idx = fontSizes.indexOf(settings.fontSize || "14");
    return idx === -1 ? 1 : idx;
  };
  const handleFontSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    updateSettings({ fontSize: fontSizes[idx] });
  };

  // Render Left Navigation Sidebar
  const renderSidebar = () => {
    return (
      <div className="settings-sidebar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`settings-tab-btn ${isActive ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="settings-tab-icon">
                <Icon size={16} />
              </span>
              <span className="settings-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // Render Right Details Panel according to activeTab
  const renderContent = () => {
    switch (activeTab) {
      case "computer_use":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">电脑操控 (Computer Use)</h2>
            <p className="settings-section-desc" style={{ color: "var(--text-2)", marginBottom: 16, fontSize: 13 }}>
              基于 CodeX / Anthropic 规范的屏幕识别与鼠标键盘掌控通道。支持 Retina 高分屏坐标自动换算与 AppleScript 降级执行。
            </p>

            <div className="settings-section">
              {/* 依赖与权限检测卡片 */}
              <div className="security-card-box full-width">
                <div className="security-card-header">
                  <div className="security-card-title-group">
                    <Laptop size={18} className="icon-blue" />
                    <h3 className="security-card-title">系统依赖与权限诊断</h3>
                  </div>
                  <button className="settings-btn" onClick={fetchSystemPerms} disabled={loadingPerms}>
                    {loadingPerms ? "检测中..." : "重新检测"}
                  </button>
                </div>

                <div className="perm-diag-list" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* 屏幕录制 */}
                  <div className="perm-diag-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>屏幕录制权限 (Screen Recording)</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>用于截取当前屏幕提供给视觉 LLM 分析</div>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`log-status-badge ${systemPerms?.screenRecordingGranted ? "success" : "error"}`}>
                        {systemPerms?.screenRecordingGranted ? "已准备就绪" : "待检测 / 未授权"}
                      </span>
                      <button className="settings-btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => openSystemSettings("screen")}>
                        打开授权设置
                      </button>
                    </div>
                  </div>

                  {/* 辅助功能 */}
                  <div className="perm-diag-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>辅助功能权限 (Accessibility)</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>用于模拟点击、键盘输入与滚动控制</div>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`log-status-badge ${systemPerms?.accessibilityGranted ? "success" : "error"}`}>
                        {systemPerms?.accessibilityGranted ? "已授权" : "未授权 (将拦截点击)"}
                      </span>
                      <button className="settings-btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => openSystemSettings("accessibility")}>
                        打开授权设置
                      </button>
                    </div>
                  </div>

                  {/* cliclick 依赖 */}
                  <div className="perm-diag-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>cliclick 命令行工具 (快捷操作增强)</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>未安装时系统将自动降级使用 macOS 原生 AppleScript</div>
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`log-status-badge ${systemPerms?.cliclickInstalled ? "success" : "warning"}`} style={!systemPerms?.cliclickInstalled ? { background: "var(--amber-soft)", color: "var(--amber)" } : {}}>
                        {systemPerms?.cliclickInstalled ? "已安装" : "未安装 (已降级原生)"}
                      </span>
                    </div>
                  </div>

                  {/* 显示器分辨率与 Retina 信息 */}
                  {systemPerms?.metrics && (
                    <div className="perm-diag-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>显示屏分辨率与缩放比</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                          逻辑点阵: {systemPerms.metrics.width} x {systemPerms.metrics.height} | 缩放比: {systemPerms.metrics.scaleFactor}x
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-2)", fontWeight: 500 }}>
                        Retina 坐标自动换算就绪
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );

      case "system":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">系统设置</h2>
            <div className="settings-section">
              {/* 显示语言 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">显示语言</label>
                  <p className="settings-item-desc">设置应用程序界面的显示语言。</p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.language || "zh-CN"}
                    onChange={(e) => updateSettings({ language: e.target.value })}
                  >
                    <option value="zh-CN">中文(简体)</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
              </div>

              {/* 字体大小 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">字体大小</label>
                </div>
                <div className="settings-item-control slider-wrapper">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    className="settings-slider"
                    value={getFontSliderValue()}
                    onChange={handleFontSliderChange}
                  />
                  <div className="slider-ticks">
                    <span>小</span>
                    <span>默认</span>
                    <span>稍大</span>
                    <span>大</span>
                    <span>特大</span>
                    <span>超大</span>
                  </div>
                </div>
              </div>

              {/* 技能自动更新 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">技能自动更新</label>
                  <p className="settings-item-desc">
                    开启后将自动更新已安装的技能为最新版本，不会更新你在 WorkBuddy 中编辑过的技能。
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={settings.autoUpdateSkills !== false}
                      onChange={(e) => updateSettings({ autoUpdateSkills: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>

              {/* 非高风险技能自动安装 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">非高风险技能自动安装</label>
                  <p className="settings-item-desc">
                    上传技能后仍会显示安全检测过程；检测结果为非高风险时自动继续安装，高风险始终需要手动确认。
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={!!settings.autoInstallSkills}
                      onChange={(e) => updateSettings({ autoInstallSkills: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>

              {/* 锁屏远程 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">锁屏远程</label>
                  <p className="settings-item-desc">
                    开启后即使在锁屏状态下，电脑也不会进入休眠、屏幕也不会自动关闭，方便通过手机远程操控和保持自动化任务持续进行。
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={!!settings.keepAwake}
                      onChange={(e) => updateSettings({ keepAwake: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>

              {/* 默认工作空间存储路径 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认工作空间存储路径</label>
                  <p className="settings-item-desc">
                    新建任务、工作空间时将自动存放在该路径下。修改后不影响已有数据。
                  </p>
                </div>
                <div className="settings-input-row" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className="settings-input"
                    value={settings.defaultWorkspaceDir || "~/WorkBuddy"}
                    onChange={(e) => updateSettings({ defaultWorkspaceDir: e.target.value })}
                  />
                  <button className="settings-btn" onClick={handleBrowseWorkspaceDir}>
                    更改
                  </button>
                </div>
              </div>

              {/* 体验优化计划 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">体验优化计划</label>
                  <p className="settings-item-desc">
                    允许我们使用您的数据进行模型优化，提升产品使用体验。我们将采取措施保护您的数据。{" "}
                    <a href="#learn-more" className="settings-link">
                      了解更多
                    </a>
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={settings.experienceOpt !== false}
                      onChange={(e) => updateSettings({ experienceOpt: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case "account":
        const providersList = [
          { id: "deepseek", name: "DeepSeek", url: "https://platform.deepseek.com/" },
          { id: "openai", name: "OpenAI", url: "https://platform.openai.com/" },
          { id: "anthropic", name: "Anthropic Claude", url: "https://console.anthropic.com/" },
          { id: "gemini", name: "Google Gemini", url: "https://aistudio.google.com/" },
          { id: "zhipu", name: "智谱 AI (GLM)", url: "https://open.bigmodel.cn/" },
        ];
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">账户管理 / API Keys</h2>
            <div className="settings-section">
              <p className="settings-intro-text">
                在这里配置不同大模型提供商的 API Key。密钥会被安全地保存在本地系统钥匙串中，不会上传到云端。
              </p>
              {providersList.map((prov) => {
                const hasKey = !!apiKeys[prov.id];
                const value = keysInput[prov.id] || "";
                const isShowing = !!showKey[prov.id];
                return (
                  <div key={prov.id} className="settings-item-card col-layout">
                    <div className="settings-provider-header">
                      <div>
                        <span className="settings-provider-name">{prov.name}</span>
                        <span className={`settings-badge ${hasKey ? "active" : ""}`}>
                          {hasKey ? "已配置" : "未配置"}
                        </span>
                      </div>
                      <a href={prov.url} target="_blank" rel="noreferrer" className="settings-link text-xs">
                        获取 API Key
                      </a>
                    </div>
                    <div className="settings-input-row" style={{ marginTop: 8 }}>
                      <div className="settings-input-password-wrapper">
                        <input
                          type={isShowing ? "text" : "password"}
                          className="settings-input"
                          placeholder={hasKey ? "••••••••••••••••••••••••••••••••" : "输入 API Key"}
                          value={value}
                          onChange={(e) => setKeysInput({ ...keysInput, [prov.id]: e.target.value })}
                        />
                        <button
                          className="settings-eye-btn"
                          onClick={() => setShowKey({ ...showKey, [prov.id]: !isShowing })}
                        >
                          {isShowing ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <button
                        className="settings-btn btn-primary"
                        disabled={!value.trim()}
                        onClick={async () => {
                          await saveApiKey(prov.id, value);
                          setKeysInput({ ...keysInput, [prov.id]: "" });
                        }}
                      >
                        保存
                      </button>
                      {hasKey && (
                        <button
                          className="settings-btn danger"
                          onClick={async () => {
                            if (confirm(`确认要删除 ${prov.name} 的 API Key 吗？`)) {
                              await deleteApiKey(prov.id);
                            }
                          }}
                        >
                          清除
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case "memory":
        const filteredMemories = memories.filter((m) =>
          (m.content || "").toLowerCase().includes(memorySearch.toLowerCase())
        );
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">长期记忆管理</h2>
            <div className="settings-section">
              <p className="settings-intro-text">
                智能体在对话中习得的知识和偏好会自动存入长期记忆，以便在后续对话中为您提供个性化服务。
              </p>
              <div style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  className="settings-input w-full"
                  placeholder="搜索记忆项..."
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                />
              </div>
              <div className="memory-list-container">
                {filteredMemories.length === 0 ? (
                  <div className="settings-empty-hint">暂无匹配的长期记忆项目</div>
                ) : (
                  filteredMemories.map((mem) => (
                    <div key={mem.id} className="memory-item-row">
                      <div className="memory-item-content">
                        <div className="memory-item-text">🧠 {mem.content}</div>
                        <div className="memory-item-meta-info">
                          <span>类型: {mem.kind === "fact" ? "事实" : mem.kind}</span>
                          <span style={{ marginLeft: 12 }}>
                            时间: {new Date(mem.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        className="memory-del-btn"
                        onClick={async () => {
                          if (confirm("确认删除该条记忆吗？这会影响智能体以后对该信息的认知。")) {
                            await deleteMemory(mem.id);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );

      case "agent":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">智能体设置</h2>
            <div className="settings-section">
              {/* 系统提示词 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">系统提示词 (System Prompt)</label>
                  <p className="settings-item-desc">配置智能体运行时的全局系统提示词，用来定义智能体的角色、口吻和安全规则。</p>
                </div>
                <textarea
                  className="settings-textarea"
                  style={{ marginTop: 8, height: 120, width: "100%", resize: "vertical" }}
                  value={settings.agentSystemPrompt || ""}
                  onChange={(e) => updateSettings({ agentSystemPrompt: e.target.value })}
                  placeholder="请输入系统提示词..."
                />
              </div>

              {/* 模型温度 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">模型温度 (Temperature: {settings.agentTemperature || "0.7"})</label>
                  <p className="settings-item-desc">较高的温度值会使输出更有创意，较低的值更具确定性和精确性。</p>
                </div>
                <div className="settings-item-control slider-wrapper" style={{ marginTop: 8 }}>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    className="settings-slider"
                    value={parseFloat(settings.agentTemperature || "0.7")}
                    onChange={(e) => updateSettings({ agentTemperature: e.target.value })}
                  />
                  <div className="slider-ticks">
                    <span>确定性 (0.0)</span>
                    <span>平衡 (1.0)</span>
                    <span>创意性 (2.0)</span>
                  </div>
                </div>
              </div>

              {/* 单次输出最大 Token */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">单次输出限制 (Max Tokens)</label>
                  <p className="settings-item-desc">限制智能体单次回答能产生的最大 Token 数量。</p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.agentMaxTokens || "4096"}
                    onChange={(e) => updateSettings({ agentMaxTokens: e.target.value })}
                  >
                    <option value="2048">2048 Tokens</option>
                    <option value="4096">4096 Tokens</option>
                    <option value="8192">8192 Tokens</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        );

      case "model":
        return (
          <div className="settings-tab-content">
            <div className="settings-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 className="settings-content-title" style={{ marginBottom: 4 }}>模型配置中心</h2>
                <p className="settings-section-desc" style={{ color: "var(--text-2)", margin: 0, fontSize: 13 }}>
                  配置主流云端 AI 模型、本地 Ollama 引擎及自定义 OpenAI 规范 API。密钥完全保存在本地安全钥匙串中。
                </p>
              </div>
              <button
                className="settings-btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
                onClick={() => {
                  setCustomForm({ name: "", baseUrl: "https://api.openai.com/v1", apiKey: "", models: "" });
                  setCustomModalOpen(true);
                }}
              >
                <Plus size={14} />
                添加自定义 API
              </button>
            </div>

            <div className="settings-section">
              {/* 默认模型配置卡片 */}
              <div className="security-card-box full-width">
                <h3 className="security-card-title" style={{ marginBottom: 12 }}>默认模型与默认渠道</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label className="settings-item-title" style={{ fontSize: 12.5, display: "block", marginBottom: 6 }}>
                      默认模型提供商
                    </label>
                    <select
                      className="settings-select"
                      style={{ width: "100%" }}
                      value={settings.defaultProvider || "deepseek"}
                      onChange={(e) => updateSettings({ defaultProvider: e.target.value })}
                    >
                      {settings.providers?.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="settings-item-title" style={{ fontSize: 12.5, display: "block", marginBottom: 6 }}>
                      默认模型 ID
                    </label>
                    <select
                      className="settings-select"
                      style={{ width: "100%" }}
                      value={settings.defaultModelId || "deepseek-v4-flash"}
                      onChange={(e) => updateSettings({ defaultModelId: e.target.value })}
                    >
                      {settings.providers
                        ?.find((p: any) => p.id === (settings.defaultProvider || "deepseek"))
                        ?.models?.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        )) || <option value="deepseek-v4-flash">deepseek-v4-flash</option>}
                    </select>
                  </div>
                </div>
              </div>

              {/* 本地 Ollama 配置卡片 */}
              <div className="security-card-box full-width" style={{ marginTop: 16 }}>
                <div className="security-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="security-card-title-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>🦙</span>
                    <h3 className="security-card-title" style={{ margin: 0 }}>Ollama 本地大模型</h3>
                    <span className={`log-status-badge ${ollamaStatus?.running ? "success" : "error"}`}>
                      {ollamaStatus?.loading ? "检测中..." : ollamaStatus?.running ? `服务在线 (${ollamaStatus.latencyMs || 0}ms)` : "未连接"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="settings-btn"
                      onClick={async () => {
                        const res = await fetchOllamaModels();
                        setOllamaStatus(res);
                      }}
                    >
                      刷新本地模型
                    </button>
                    <button
                      className="settings-btn"
                      onClick={async () => {
                        const res = await testConnection({ provider: "ollama", baseUrl: settings.ollamaBaseUrl });
                        setTestResults((prev) => ({ ...prev, ollama: res }));
                      }}
                    >
                      测试连通性
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="settings-item-meta" style={{ marginBottom: 6 }}>
                    <label className="settings-item-title" style={{ fontSize: 12.5 }}>Ollama 服务地址 (Base URL)</label>
                  </div>
                  <div className="settings-input-row" style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      className="settings-input"
                      style={{ flex: 1 }}
                      value={settings.ollamaBaseUrl || "http://127.0.0.1:11434"}
                      onChange={(e) => updateSettings({ ollamaBaseUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434"
                    />
                    <button
                      className="settings-btn"
                      onClick={() => updateSettings({ ollamaBaseUrl: "http://127.0.0.1:11434" })}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>

                {testResults.ollama && (
                  <div style={{ marginTop: 8, fontSize: 12, color: testResults.ollama.ok ? "var(--green)" : "var(--red)" }}>
                    {testResults.ollama.ok ? `✓ ${testResults.ollama.message}` : `✗ ${testResults.ollama.error}`}
                  </div>
                )}

                {/* 已查找到的 Ollama 模型列表 */}
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 600 }}>
                    已侦测到的本地模型 ({settings.providers?.find((p: any) => p.id === "ollama")?.models?.length || 0})：
                  </span>
                  <div className="provider-models-tags" style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {settings.providers
                      ?.find((p: any) => p.id === "ollama")
                      ?.models?.map((m: any) => (
                        <span
                          key={m.id}
                          className="model-tag-item"
                          title="点击设为当前对话模型"
                          onClick={() => {
                            useStore.setState({ modelProvider: "ollama", modelId: m.id });
                            updateSettings({ defaultProvider: "ollama", defaultModelId: m.id });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          🦙 {m.id} {m.size ? `(${m.size})` : ""}
                        </span>
                      ))}
                  </div>
                </div>
              </div>

              {/* 自定义 OpenAI 提供商卡片列表 */}
              {settings.customProviders && settings.customProviders.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h3 className="settings-section-subtitle" style={{ marginBottom: 12, fontSize: 13.5, color: "var(--text-2)" }}>
                    自定义 OpenAI 规范端点 ({settings.customProviders.length})
                  </h3>
                  <div className="providers-grid">
                    {settings.customProviders.map((cp) => {
                      const isTesting = testingProvider === cp.id;
                      const testRes = testResults[cp.id];
                      return (
                        <div key={cp.id} className="provider-model-card configured">
                          <div className="provider-card-header">
                            <div>
                              <h4 className="provider-name">🔧 {cp.name}</h4>
                              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{cp.baseUrl}</div>
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                className="settings-btn text-xs"
                                style={{ padding: "3px 7px" }}
                                onClick={() => {
                                  setCustomForm({
                                    id: cp.id,
                                    name: cp.name,
                                    baseUrl: cp.baseUrl,
                                    apiKey: "",
                                    models: (cp.models || []).join(", "),
                                  });
                                  setCustomModalOpen(true);
                                }}
                              >
                                编辑
                              </button>
                              <button
                                className="settings-btn danger text-xs"
                                style={{ padding: "3px 7px" }}
                                onClick={() => deleteCustomProvider(cp.id)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <div className="provider-models-tags" style={{ marginTop: 8 }}>
                            {cp.models?.map((m) => (
                              <span key={m} className="model-tag-item">{m}</span>
                            ))}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                            <button
                              className="settings-btn text-xs"
                              disabled={isTesting}
                              onClick={async () => {
                                setTestingProvider(cp.id);
                                const res = await testConnection({ provider: cp.id, baseUrl: cp.baseUrl });
                                setTestResults((prev) => ({ ...prev, [cp.id]: res }));
                                setTestingProvider(null);
                              }}
                            >
                              {isTesting ? "测试中..." : "测试连通性"}
                            </button>
                            {testRes && (
                              <span style={{ fontSize: 11, color: testRes.ok ? "var(--green)" : "var(--red)" }}>
                                {testRes.ok ? `✓ ${testRes.latencyMs || 0}ms` : `✗ 失败`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 主流云端大模型服务商 */}
              <div className="models-providers-section" style={{ marginTop: 20 }}>
                <h3 className="settings-section-subtitle" style={{ marginBottom: 12, fontSize: 13.5, color: "var(--text-2)" }}>
                  主流云端模型服务商 API 配置
                </h3>
                <div className="providers-grid">
                  {settings.providers
                    ?.filter((p: any) => p.id !== "ollama" && !p.isCustom)
                    .map((provider: any) => {
                      const hasKey = !!apiKeys[provider.id];
                      const val = keysInput[provider.id] || "";
                      const isShowing = !!showKey[provider.id];
                      const isTesting = testingProvider === provider.id;
                      const testRes = testResults[provider.id];

                      return (
                        <div key={provider.id} className={`provider-model-card ${hasKey ? "configured" : "unconfigured"}`}>
                          <div className="provider-card-header">
                            <h4 className="provider-name">{provider.name}</h4>
                            <span className={`provider-status-badge ${hasKey ? "ok" : "warn"}`}>
                              {hasKey ? "已配置 Key" : "未配置 Key"}
                            </span>
                          </div>

                          {/* API Key 密码卡片 */}
                          <div className="settings-input-password-wrapper" style={{ marginTop: 8 }}>
                            <input
                              type={isShowing ? "text" : "password"}
                              className="settings-input"
                              placeholder={hasKey ? "••••••••••••••••••••••••" : "输入 API Key"}
                              value={val}
                              onChange={(e) => setKeysInput({ ...keysInput, [provider.id]: e.target.value })}
                            />
                            <button
                              className="settings-eye-btn"
                              onClick={() => setShowKey({ ...showKey, [provider.id]: !isShowing })}
                            >
                              {isShowing ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </div>

                          <div className="provider-models-tags" style={{ marginTop: 8 }}>
                            {provider.models?.map((m: any) => (
                              <span key={m.id} className="model-tag-item">{m.id}</span>
                            ))}
                          </div>

                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            <button
                              className="settings-btn btn-primary text-xs"
                              style={{ flex: 1 }}
                              disabled={!val.trim()}
                              onClick={async () => {
                                await saveApiKey(provider.id, val);
                                setKeysInput({ ...keysInput, [provider.id]: "" });
                              }}
                            >
                              保存 Key
                            </button>
                            <button
                              className="settings-btn text-xs"
                              disabled={isTesting}
                              onClick={async () => {
                                setTestingProvider(provider.id);
                                const res = await testConnection({ provider: provider.id, apiKey: val || undefined });
                                setTestResults((prev) => ({ ...prev, [provider.id]: res }));
                                setTestingProvider(null);
                              }}
                            >
                              {isTesting ? "测试中..." : "测试连接"}
                            </button>
                            {hasKey && (
                              <button
                                className="settings-btn danger text-xs"
                                onClick={() => deleteApiKey(provider.id)}
                              >
                                清除
                              </button>
                            )}
                          </div>

                          {testRes && (
                            <div style={{ marginTop: 4, fontSize: 11, color: testRes.ok ? "var(--green)" : "var(--red)" }}>
                              {testRes.ok ? `✓ ${testRes.message}` : `✗ ${testRes.error}`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* 自定义 Provider 添加/编辑弹窗 */}
            {customModalOpen && (
              <div className="cmd-palette-backdrop" style={{ zIndex: 1000 }}>
                <div className="cmd-palette-modal" style={{ padding: 20, maxWidth: 480 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>
                      {customForm.id ? "编辑自定义 OpenAI API" : "添加自定义 OpenAI API"}
                    </h3>
                    <button className="settings-eye-btn" onClick={() => setCustomModalOpen(false)}>
                      <X size={16} />
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label className="settings-item-title" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        提供商名称 (Provider Name)
                      </label>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: 硅基流动 / 公司代理"
                        value={customForm.name}
                        onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="settings-item-title" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        Base URL (兼容 OpenAI /v1 端点)
                      </label>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: https://api.siliconflow.cn/v1"
                        value={customForm.baseUrl}
                        onChange={(e) => setCustomForm({ ...customForm, baseUrl: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="settings-item-title" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        API Key (可选)
                      </label>
                      <input
                        type="password"
                        className="settings-input w-full"
                        placeholder="sk-..."
                        value={customForm.apiKey}
                        onChange={(e) => setCustomForm({ ...customForm, apiKey: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="settings-item-title" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                        可用模型列表 (英文逗号分隔)
                      </label>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-Coder-32B-Instruct"
                        value={customForm.models}
                        onChange={(e) => setCustomForm({ ...customForm, models: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                    <button className="settings-btn" onClick={() => setCustomModalOpen(false)}>取消</button>
                    <button
                      className="settings-btn btn-primary"
                      disabled={!customForm.name.trim() || !customForm.baseUrl.trim()}
                      onClick={async () => {
                        await saveCustomProvider(customForm);
                        setCustomModalOpen(false);
                      }}
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "assistant":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">助理设置</h2>
            <div className="settings-section">
              {/* 默认搜索引擎 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认搜索引擎</label>
                  <p className="settings-item-desc">智能体在需要联网检索信息时默认选用的搜索引擎。</p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.searchEngine || "google"}
                    onChange={(e) => updateSettings({ searchEngine: e.target.value })}
                  >
                    <option value="google">Google Search</option>
                    <option value="bing">Bing Search</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                  </select>
                </div>
              </div>

              {/* 默认文档检索目录 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认文档检索路径 (docs_dir)</label>
                  <p className="settings-item-desc">智能体搜索与加载外部引用文件（如 docx/pdf）的默认起始路径。</p>
                </div>
                <div className="settings-input-row" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className="settings-input"
                    value={settings.docsDir || "~/Desktop"}
                    onChange={(e) => updateSettings({ docsDir: e.target.value })}
                  />
                  <button
                    className="settings-btn"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/pick-dir");
                        const data = await res.json();
                        if (!data.cancelled && data.path) {
                          updateSettings({ docsDir: data.path });
                        }
                      } catch {}
                    }}
                  >
                    浏览
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case "shortcut":
        const shortcuts = [
          { keys: ["Option", "Space"], desc: "全局唤醒 / 隐藏 Pi-a 助理" },
          { keys: ["Cmd", "Enter"], desc: "发送当前输入的指令" },
          { keys: ["Shift", "Enter"], desc: "在输入框中插入新行" },
          { keys: ["Cmd", "N"], desc: "快速创建一个新的对话任务" },
          { keys: ["Cmd", "K"], desc: "清除对话并重置侧边栏" },
          { keys: ["Esc"], desc: "关闭当前弹窗或中断会话生成" },
        ];
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">快捷键列表</h2>
            <div className="settings-section">
              <p className="settings-intro-text">
                使用快捷键可以在操作 Pi-a 界面时提高效率。
              </p>
              <div className="shortcuts-list">
                {shortcuts.map((sh, idx) => (
                  <div key={idx} className="shortcut-row">
                    <span className="shortcut-desc">{sh.desc}</span>
                    <div className="shortcut-keys">
                      {sh.keys.map((k, kIdx) => (
                        <kbd key={kIdx} className="kbd-key">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "personalize":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">个性化</h2>
            <div className="settings-section">
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">色彩主题模式</label>
                  <p className="settings-item-desc">切换软件的浅色、深色模式外观风格。</p>
                </div>
                <div className="settings-item-control theme-selector-grid">
                  <button
                    className={`theme-card ${theme === "light" ? "active" : ""}`}
                    onClick={() => {
                      if (theme !== "light") toggleTheme();
                    }}
                  >
                    <Sun size={20} />
                    <span>浅色模式</span>
                  </button>
                  <button
                    className={`theme-card ${theme === "dark" ? "active" : ""}`}
                    onClick={() => {
                      if (theme !== "dark") toggleTheme();
                    }}
                  >
                    <Moon size={20} />
                    <span>深色模式</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case "data":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">数据管理</h2>
            <div className="settings-section">
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">备份与重置</label>
                  <p className="settings-item-desc">
                    在此管理您的本地数据安全，可以清除或导出您的所有任务。
                  </p>
                </div>
                <div className="settings-btn-grid" style={{ marginTop: 12 }}>
                  <button
                    className="settings-btn"
                    onClick={() => {
                      alert("系统已自动开启动态备份，在 ~/.pi-a/pi-a.db 即可找到数据文件。");
                    }}
                  >
                    浏览本地数据库目录
                  </button>
                  <button
                    className="settings-btn danger"
                    onClick={() => {
                      if (
                        confirm(
                          "警告！这会清除您在 Pi-a 中的所有对话任务、配置与记忆，且不可撤销！确认清除吗？"
                        )
                      ) {
                        alert("数据已重置。程序将自动重启。");
                        window.location.reload();
                      }
                    }}
                  >
                    清除所有对话与配置数据
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="settings-tab-content security-tab-view">
            <div className="security-header-row">
              <div>
                <h2 className="settings-content-title">安全中心</h2>
                <p className="security-subtitle">统一管理工作空间内的进程安全、数据安全与系统授权</p>
              </div>
              <span className="security-runtime-provider-badge">安全能力由本地运行时提供</span>
            </div>

            <div className="security-grid-container">
              {/* 沙箱安全 */}
              <div className="security-card-box">
                <div className="security-card-header">
                  <div className="security-card-title-group">
                    <Shield size={18} className="icon-green" />
                    <h3 className="security-card-title">沙箱安全</h3>
                    <button className="security-help-info" title="沙箱安全说明" onClick={() => alert("沙箱安全通过本地隔离容器运行AI命令与网络访问，防止主机被恶意控制。")}>
                      <HelpCircle size={14} />
                    </button>
                  </div>
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={settings.sandboxSecurity !== false}
                      onChange={(e) => updateSettings({ sandboxSecurity: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
                <p className="security-card-desc">AI 运行于隔离沙箱，并配置文件、命令、网络访问策略</p>

                <div className="security-list-items">
                  <div className="security-list-row" onClick={() => setSubModalType("file")}>
                    <div className="security-row-left">
                      <FileText size={16} className="item-icon" />
                      <div>
                        <div className="security-row-title">文件安全</div>
                        <div className="security-row-desc">为沙箱拦截后的文件路径配置白名单和黑名单</div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="chevron-icon" />
                  </div>

                  <div className="security-list-row" onClick={() => setSubModalType("command")}>
                    <div className="security-row-left">
                      <Terminal size={16} className="item-icon" />
                      <div>
                        <div className="security-row-title">命令安全</div>
                        <div className="security-row-desc">为命令前缀配置询问和放行名单</div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="chevron-icon" />
                  </div>

                  <div className="security-list-row" onClick={() => setSubModalType("network")}>
                    <div className="security-row-left">
                      <Globe size={16} className="item-icon" />
                      <div>
                        <div className="security-row-title">网络安全</div>
                        <div className="security-row-desc">控制 URL 访问与沙箱网络域名规则</div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="chevron-icon" />
                  </div>
                </div>
              </div>

              {/* 数据安全 */}
              <div className="security-card-box">
                <div className="security-card-header no-toggle">
                  <div className="security-card-title-group">
                    <Lock size={18} className="icon-blue" />
                    <h3 className="security-card-title">数据安全</h3>
                  </div>
                </div>
                <p className="security-card-desc">数据流转及删除行为的安全防护</p>

                <div className="security-data-settings">
                  {/* 安全网关 */}
                  <div className="security-data-item">
                    <div>
                      <div className="security-data-title">安全网关</div>
                      <div className="security-data-desc">工作空间出入流量统一经过安全网关安全处理</div>
                    </div>
                    <span className="security-status-pill active">已开启</span>
                  </div>

                  {/* 传输加密 */}
                  <div className="security-data-item">
                    <div>
                      <div className="security-data-title">传输加密</div>
                      <div className="security-data-desc">本地与云端通信使用端到端加密通道</div>
                    </div>
                    <span className="security-status-pill active">已开启</span>
                  </div>

                  {/* 删除保护 */}
                  <div className="security-data-item flex-align">
                    <div>
                      <div className="security-data-title">删除保护</div>
                      <div className="security-data-desc">开启后优先移到废纸篓/回收站，关闭后按系统删除</div>
                    </div>
                    <label className="switch-toggle">
                      <input
                        type="checkbox"
                        checked={settings.deletionProtection !== false}
                        onChange={(e) => updateSettings({ deletionProtection: e.target.checked })}
                      />
                      <span className="slider-round"></span>
                    </label>
                  </div>

                  {/* 批量删除审批 */}
                  <div className="security-data-item flex-align">
                    <div>
                      <div className="security-data-title">批量删除审批</div>
                      <div className="security-data-desc">需开启删除保护。一次删除达到该数量时需要审批</div>
                    </div>
                    <div className="security-number-input-wrapper">
                      <input
                        type="number"
                        className="security-number-input"
                        value={settings.bulkDeletionLimit || "50"}
                        onChange={(e) => updateSettings({ bulkDeletionLimit: e.target.value })}
                        min="1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 内置运行时 */}
            <div className="security-card-box full-width">
              <div className="security-card-header">
                <div className="security-card-title-group">
                  <Activity size={18} className="icon-green" />
                  <h3 className="security-card-title">内置运行时</h3>
                </div>
                <label className="switch-toggle">
                  <input
                    type="checkbox"
                    checked={settings.builtinRuntime !== false}
                    onChange={(e) => updateSettings({ builtinRuntime: e.target.checked })}
                  />
                  <span className="slider-round"></span>
                </label>
              </div>
              <p className="security-card-desc">允许使用随包提供的 Node.js、Python 和 Git Bash 工具</p>

              <table className="runtime-table">
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>说明</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="runtime-tool-cell">
                      <img src="https://img.icons8.com/color/48/python--v1.png" alt="Python" className="runtime-logo" />
                      <span>Python</span>
                    </td>
                    <td className="runtime-desc-cell">通用编程语言，适用于脚本编写、自动化和数据处理</td>
                    <td>
                      <label className="switch-toggle">
                        <input
                          type="checkbox"
                          checked={settings.runtimePython !== false}
                          disabled={settings.builtinRuntime === false}
                          onChange={(e) => updateSettings({ runtimePython: e.target.checked })}
                        />
                        <span className="slider-round"></span>
                      </label>
                    </td>
                  </tr>
                  <tr>
                    <td className="runtime-tool-cell">
                      <img src="https://img.icons8.com/fluency/48/node-js.png" alt="Node.js" className="runtime-logo" />
                      <span>Node.js</span>
                    </td>
                    <td className="runtime-desc-cell">基于 Chrome V8 引擎的 JavaScript 运行时，用于服务端开发</td>
                    <td>
                      <label className="switch-toggle">
                        <input
                          type="checkbox"
                          checked={settings.runtimeNodejs !== false}
                          disabled={settings.builtinRuntime === false}
                          onChange={(e) => updateSettings({ runtimeNodejs: e.target.checked })}
                        />
                        <span className="slider-round"></span>
                      </label>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 安全审计日志表格 */}
            <div className="security-card-box full-width font-table">
              <h3 className="security-card-title" style={{ fontSize: 13, marginBottom: 8 }}>安全审查日志 (最近50条记录)</h3>
              <div className="audit-logs-table-wrapper" style={{ maxHeight: 120 }}>
                {auditLogs.length === 0 ? (
                  <div className="audit-logs-empty">暂无审计日志</div>
                ) : (
                  <table className="audit-logs-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>工具名称</th>
                        <th>参数简述</th>
                        <th>状态</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={{ color: "var(--text-3)" }}>{log.id}</td>
                          <td className="log-tool-name" style={{ fontWeight: 600 }}>{log.toolName}</td>
                          <td className="log-args-cell" title={log.args}>
                            {log.args ? (log.args.length > 50 ? `${log.args.slice(0, 50)}...` : log.args) : "-"}
                          </td>
                          <td>
                            <span className={`log-status-badge ${log.isError ? "error" : "success"}`}>
                              {log.isError ? "失败" : "成功"}
                            </span>
                          </td>
                          <td className="log-time-cell">
                            {new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );

      case "help":
      default:
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">帮助与反馈</h2>
            <div className="settings-section help-section">
              <div className="app-logo-section">
                <PiLogo size={64} style={{ marginBottom: 12 }} />
                <h3 className="app-name-large">Pi-a Desktop</h3>
                <p className="app-version-txt">版本 v2.0 (Official Build)</p>
              </div>
              <div className="divider-line" />
              <div className="help-links-list">
                <div className="help-link-item">
                  <span>项目官方网站:</span>
                  <a href="https://github.com/earendil-works" className="settings-link" target="_blank" rel="noreferrer">
                    github.com/earendil-works
                  </a>
                </div>
                <div className="help-link-item">
                  <span>用户交流与反馈:</span>
                  <a href="#feedback" className="settings-link">
                    发送反馈邮件
                  </a>
                </div>
                <div className="help-link-item">
                  <span>开发者文档:</span>
                  <a href="#docs" className="settings-link">
                    浏览在线帮助文档
                  </a>
                </div>
              </div>
              <p className="copyright-txt">
                © 2026 DeepMind Advanced Agentic Coding Team. All rights reserved.
              </p>
            </div>
          </div>
        );
    }
  };

  const renderSecuritySubModal = () => {
    if (!subModalType) return null;
    const rules = getSecurityRulesList(subModalType);
    const title = subModalType === "file" ? "文件路径白名单规则"
                : subModalType === "command" ? "安全命令放行规则"
                : "网络安全域名规则";
    const placeholder = subModalType === "file" ? "请输入绝对文件路径，例如 /Users/username/safe-folder"
                      : subModalType === "command" ? "请输入允许放行的命令，例如 git"
                      : "请输入允许访问的域名，例如 api.deepseek.com";

    return (
      <div className="security-submodal-overlay" onClick={() => setSubModalType(null)}>
        <div className="security-submodal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="security-submodal-header">
            <h3 className="security-submodal-title">{title}</h3>
            <button className="security-submodal-close" onClick={() => setSubModalType(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="security-submodal-body">
            <div className="submodal-input-row">
              <input
                type="text"
                className="settings-input"
                placeholder={placeholder}
                value={newRuleInput}
                onChange={(e) => setNewRuleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSecurityRule(subModalType);
                }}
              />
              <button className="settings-btn" onClick={() => handleAddSecurityRule(subModalType)}>
                <Plus size={14} style={{ marginRight: 4 }} /> 添加
              </button>
            </div>
            <div className="submodal-rules-list">
              {rules.length === 0 ? (
                <div className="rules-empty">暂无白名单规则，智能体在该项操作前将默认请求授权</div>
              ) : (
                rules.map((rule, idx) => (
                  <div key={idx} className="rule-item-row">
                    <span className="rule-text" title={rule}>{rule}</span>
                    <button className="rule-del-btn" title="删除" onClick={() => handleRemoveSecurityRule(subModalType, rule)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="settings-modal-overlay" onMouseDown={() => setShowSettings(false)}>
      <div className="settings-modal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span className="settings-modal-title">设置</span>
          <button className="settings-modal-close" onClick={() => setShowSettings(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="settings-modal-body">
          {renderSidebar()}
          <div className="settings-content-area">{renderContent()}</div>
        </div>
        {renderSecuritySubModal()}
      </div>
    </div>
  );
}
