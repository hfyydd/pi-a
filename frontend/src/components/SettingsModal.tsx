import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";
import {
  User, Settings, Cpu, Keyboard, Brain, Sparkles, Sliders, Laptop,
  Shield, HelpCircle, X, Eye, EyeOff, Trash2, Database, Sun, Moon,
  ChevronRight, Lock, Activity, FileText, Terminal, Globe, Plus
} from "lucide-react";
import "./SettingsModal.css";

type TabId =
  | "account"
  | "system"
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
  } = useStore();

  const [activeTab, setActiveTab] = useState<TabId>("system");

  // State for API keys form
  const [keysInput, setKeysInput] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

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
            <h2 className="settings-content-title">模型管理</h2>
            <div className="settings-section">
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认模型供应商</label>
                  <p className="settings-item-desc">新建对话时默认选中的大模型渠道。</p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.defaultProvider || "deepseek"}
                    onChange={(e) => updateSettings({ defaultProvider: e.target.value })}
                  >
                    {settings.providers?.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    )) || <option value="deepseek">DeepSeek</option>}
                  </select>
                </div>
              </div>

              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认模型 ID</label>
                  <p className="settings-item-desc">新建对话时默认使用的模型版本。</p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.defaultModelId || "deepseek-v4-flash"}
                    onChange={(e) => updateSettings({ defaultModelId: e.target.value })}
                  >
                    {settings.providers
                      ?.find((p: any) => p.id === (settings.defaultProvider || "deepseek"))
                      ?.models?.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                        </option>
                      )) || <option value="deepseek-v4-flash">deepseek-v4-flash</option>}
                  </select>
                </div>
              </div>

              {/* 模型提供商与可用模型列表（以网格卡片形式展示，对标“测试这些功能都有没有”） */}
              <div className="models-providers-section" style={{ marginTop: 20 }}>
                <h3 className="settings-section-subtitle" style={{ marginBottom: 12, fontSize: 13.5, color: "var(--text-2)" }}>支持的提供商与配置状态</h3>
                <div className="providers-grid">
                  {settings.providers?.map((provider: any) => {
                    const isConfigured = apiKeys[provider.id] === true;
                    return (
                      <div key={provider.id} className={`provider-model-card ${isConfigured ? "configured" : "unconfigured"}`}>
                        <div className="provider-card-header">
                          <h4 className="provider-name">{provider.name}</h4>
                          <span className={`provider-status-badge ${isConfigured ? "ok" : "warn"}`}>
                            {isConfigured ? "已配置" : "未配置"}
                          </span>
                        </div>
                        <p className="provider-desc">内置模型：</p>
                        <div className="provider-models-tags">
                          {provider.models?.map((m: any) => (
                            <span key={m.id} className="model-tag-item">{m.id}</span>
                          ))}
                        </div>
                        <button
                          className="provider-configure-btn"
                          onClick={() => setActiveTab("account")}
                        >
                          {isConfigured ? "更新密钥" : "前往配置密钥"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
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
                <div className="logo-badge">Pi-a</div>
                <h3 className="app-name-large">Pi-a Desktop</h3>
                <p className="app-version-txt">版本 v0.0.1 (Official Build)</p>
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
