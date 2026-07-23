import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

export type RunMode = "ask" | "plan" | "craft";
export type PermLevel = "L1" | "L2" | "L3" | "readonly" | "default" | "full";
export type Theme = "light" | "dark";

export interface Conversation {
  id: string;
  title: string;
  category: string;
  status: string;
  modelProvider: string;
  modelId: string;
  workspaceId?: string;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  dirPath: string;
  icon: string;
  lastOpenedAt: number;
  createdAt: number;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  status?: "running" | "success" | "error";
  createdAt: number;
}

/** 工具确认请求（对标 WorkBuddy permissionRequest） */
export interface PendingConfirm {
  requestId: string;
  toolName: string;
  args: any;
  sessionId: string;
}

/** 交互式提问（AskUserQuestion） */
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}
export interface PendingAsk {
  requestId: string;
  sessionId: string;
  questions: AskQuestion[];
}

interface AppState {
  // 侧边栏
  sidebarCollapsed: boolean;
  activeCategory: string;
  conversations: Conversation[];
  currentConvId: string | null;
  searchQuery: string;

  // 工作空间
  workspaces: Workspace[];
  composerWorkspaceId: string | null;  // Composer 里选的空间，新建会话时绑定

  // 对话
  messages: Message[];
  busy: boolean;
  mode: RunMode;
  permission: PermLevel;

  // 主题
  theme: Theme;

  // 模型
  modelId: string;       // 当前选择的模型 ID（如 "Hy3", "deepseek-v4-flash"）
  modelProvider: string; // 当前模型提供商（如 "zhipu", "deepseek"）

  // 工具确认（对标 WorkBuddy permissionRequest 弹窗）
  pendingConfirm: PendingConfirm | null;
  respondConfirm: (approved: boolean) => Promise<void>;

  // 交互式提问（AskUserQuestion）
  pendingAsk: PendingAsk | null;
  respondAsk: (answers: any) => Promise<void>;

  // UI 面板
  showSettings: boolean;
  showArtifacts: boolean;
  showWorkspaceManager: boolean;
  _pendingDirPath: { name: string; path: string } | null;  // 「打开本地文件夹」传给 modal 的临时状态

  // 全局设置状态与动作
  settings: {
    defaultProvider: string;
    defaultModelId: string;
    docsDir: string;
    language: string;
    fontSize: string;
    autoUpdateSkills: boolean;
    autoInstallSkills: boolean;
    keepAwake: boolean;
    defaultWorkspaceDir: string;
    experienceOpt: boolean;
    agentSystemPrompt: string;
    agentTemperature: string;
    agentMaxTokens: string;
    searchEngine: string;
    sandboxSecurity: boolean;
    deletionProtection: boolean;
    bulkDeletionLimit: string;
    builtinRuntime: boolean;
    runtimePython: boolean;
    runtimeNodejs: boolean;
    securityFileRules: string;
    securityCommandRules: string;
    securityNetworkRules: string;
    providers: any[];
    availableProviders: any[];
  };
  apiKeys: Record<string, boolean>;
  memories: Array<{ id: string; content: string; scope: string; kind: string; createdAt: number }>;
  auditLogs: Array<{ id: number; toolName: string; args: string; isError: number; createdAt: number }>;

  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppState["settings"]>) => Promise<void>;
  saveApiKey: (provider: string, key: string) => Promise<void>;
  deleteApiKey: (provider: string) => Promise<void>;
  loadMemories: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  loadAuditLogs: () => Promise<void>;

  // Actions
  toggleSidebar: () => void;
  setCategory: (cat: string) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
  resetToWelcome: () => void;  // 回到起始页（欢迎屏 + 工作空间选择器），不直接建会话
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  abortGeneration: () => Promise<void>;
  setMode: (m: RunMode) => void;
  setPermission: (p: PermLevel) => void;
  toggleTheme: () => void;
  setShowSettings: (v: boolean) => void;
  setShowArtifacts: (v: boolean) => void;
  setShowWorkspaceManager: (v: boolean) => void;
  setComposerWorkspaceId: (id: string | null) => void;

  // 工作空间
  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  createWorkspace: (name: string, dirPath?: string, icon?: string) => Promise<void>;
  updateWorkspace: (id: string, patch: { name?: string; dirPath?: string; icon?: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  assignConversation: (convId: string, workspaceId: string) => Promise<void>;
}

let sseSource: EventSource | null = null;

function connectSSE(id: string, set: any, get: any) {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  try {
    const source = new EventSource("/api/events/" + id + "/stream");
    sseSource = source;
    source.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        handleEvent(ev, set, get);
      } catch {}
    };
    source.onerror = () => {
      source.close();
      if (sseSource === source) {
        sseSource = null;
      }
      // 3秒后尝试重连（如果依然处于当前会话且未连接）
      setTimeout(() => {
        if (get().currentConvId === id && !sseSource) {
          console.log("[SSE] 正在尝试重新连接事件流...");
          connectSSE(id, set, get);
        }
      }, 3000);
    };
  } catch (err) {
    console.error("[SSE] 创建连接失败:", err);
  }
}

export const useStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  activeCategory: "assistant",
  conversations: [],
  currentConvId: null,
  searchQuery: "",
  workspaces: [],
  composerWorkspaceId: null,
  messages: [],
  busy: false,
  mode: "craft",
  permission: "default",
  theme: "light",
  pendingConfirm: null,

  respondConfirm: async (approved: boolean) => {
    const confirm = get().pendingConfirm;
    if (!confirm) return;
    set({ pendingConfirm: null });
    try {
      await apiPost("/api/confirm", { requestId: confirm.requestId, approved });
    } catch (e) {
      console.error("[confirm] 发送确认响应失败:", e);
    }
  },

  pendingAsk: null,

  respondAsk: async (answers: any) => {
    const ask = get().pendingAsk;
    if (!ask) return;
    set({ pendingAsk: null });
    try {
      await apiPost("/api/ask-answer", { requestId: ask.requestId, answers });
    } catch (e) {
      console.error("[ask] 发送回答失败:", e);
    }
  },

  // 模型与设置
  modelId: "deepseek-v4-flash",
  modelProvider: "deepseek",
  showSettings: false,
  showArtifacts: false,
  showWorkspaceManager: false,
  _pendingDirPath: null,

  settings: {
    defaultProvider: "deepseek",
    defaultModelId: "deepseek-v4-flash",
    docsDir: "~/Desktop",
    language: "zh-CN",
    fontSize: "14",
    autoUpdateSkills: true,
    autoInstallSkills: false,
    keepAwake: false,
    defaultWorkspaceDir: "~/WorkBuddy",
    experienceOpt: true,
    agentSystemPrompt: "你是一个有用、高效的本地桌面助理，随时帮我处理各种任务。",
    agentTemperature: "0.7",
    agentMaxTokens: "4096",
    searchEngine: "google",
    sandboxSecurity: true,
    deletionProtection: true,
    bulkDeletionLimit: "50",
    builtinRuntime: true,
    runtimePython: true,
    runtimeNodejs: true,
    securityFileRules: JSON.stringify(["/Users/hanfeng/Desktop/pi-a", "/tmp"]),
    securityCommandRules: JSON.stringify(["git", "deno", "npm", "python"]),
    securityNetworkRules: JSON.stringify(["api.deepseek.com", "github.com", "deno.land"]),
    providers: [],
    availableProviders: [],
  },
  apiKeys: {},
  memories: [],
  auditLogs: [],

  loadSettings: async () => {
    try {
      const data = await apiGet("/api/settings");
      set({ settings: data });
      if (data.fontSize) {
        document.documentElement.style.setProperty("--app-font-size", `${data.fontSize}px`);
      }
      const keys = await apiGet("/api/settings/keys");
      set({ apiKeys: keys });
    } catch (e) {
      console.error("[settings] loadSettings error:", e);
    }
  },

  updateSettings: async (patch) => {
    try {
      const current = get().settings;
      const next = { ...current, ...patch };
      await apiPost("/api/settings", next);
      set({ settings: next });
      if (patch.fontSize) {
        document.documentElement.style.setProperty("--app-font-size", `${patch.fontSize}px`);
      }
    } catch (e) {
      console.error("[settings] updateSettings error:", e);
    }
  },

  saveApiKey: async (provider, key) => {
    try {
      await apiPost("/api/settings/keys", { provider, key });
      const apiKeys = { ...get().apiKeys, [provider]: true };
      set({ apiKeys });
      await get().loadSettings();
    } catch (e) {
      console.error("[settings] saveApiKey error:", e);
    }
  },

  deleteApiKey: async (provider) => {
    try {
      await apiDelete(`/api/settings/keys/${provider}`);
      const apiKeys = { ...get().apiKeys, [provider]: false };
      set({ apiKeys });
      await get().loadSettings();
    } catch (e) {
      console.error("[settings] deleteApiKey error:", e);
    }
  },

  loadMemories: async () => {
    try {
      const list = await apiGet("/api/memories");
      set({ memories: list });
    } catch (e) {
      console.error("[settings] loadMemories error:", e);
    }
  },

  deleteMemory: async (id) => {
    try {
      await apiDelete(`/api/memories/${id}`);
      const memories = get().memories.filter((m) => m.id !== id);
      set({ memories });
    } catch (e) {
      console.error("[settings] deleteMemory error:", e);
    }
  },

  loadAuditLogs: async () => {
    try {
      const list = await apiGet("/api/settings/audit-logs");
      set({ auditLogs: list });
    } catch (e) {
      console.error("[settings] loadAuditLogs error:", e);
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setCategory: (cat) => {
    set({ activeCategory: cat });
    // 四个分类都是独立功能模块，暂未开发
  },

  loadConversations: async () => {
    try {
      const params = new URLSearchParams();
      const s = get();
      if (s.searchQuery) params.set("search", s.searchQuery);
      // 加载全部会话（侧边栏按「任务」/「空间」分组展示）
      const list = await apiGet<Conversation[]>("/api/conv?" + params.toString());
      set({ conversations: list });
      // 不自动选中——保持初始界面（欢迎屏+工作空间选择器），对齐 WorkBuddy
    } catch {}
  },

  selectConversation: async (id) => {
    // 关闭旧 SSE
    if (sseSource) { sseSource.close(); sseSource = null; }
    // 选择会话即强制回到聊天视图（退出自动化/专家等独立面板）
    set({ currentConvId: id, messages: [], activeCategory: "assistant" });
    // 确保该会话出现在侧边栏列表中（自动化等后台创建的会话需在选入时补进列表）
    const { conversations } = get();
    if (!conversations.find((c) => c.id === id)) {
      get().loadConversations();
    }
    try {
      const msgs = await apiGet<Message[]>("/api/msgs/" + id);
      set({ messages: msgs });
    } catch {}
    // 开启 SSE
    connectSSE(id, set, get);
  },

  createConversation: async (title = "新对话") => {
    const wsId = get().composerWorkspaceId;  // Composer 里选的空间
    const conv = await apiPost<Conversation>("/api/conv", { title, workspaceId: wsId });
    // 建完即复位：下一次「开始对话」默认不归属任何空间（任务）
    set({ composerWorkspaceId: null });
    await get().loadConversations();
    await get().selectConversation(conv.id);
    return conv.id;
  },

  resetToWelcome: () => {
    // 关闭旧 SSE，回到起始页
    if (sseSource) { sseSource.close(); sseSource = null; }
    set({ currentConvId: null, messages: [], composerWorkspaceId: null, busy: false, activeCategory: "assistant" });
  },

  deleteConversation: async (id) => {
    await apiDelete("/api/conv/" + id);
    if (get().currentConvId === id) {
      set({ currentConvId: null, messages: [] });
    }
    await get().loadConversations();
  },

  sendMessage: async (text) => {
    const s = get();
    if (s.busy || !text.trim()) return;
    let convId = s.currentConvId;
    if (!convId) {
      convId = await get().createConversation(text.slice(0, 24));
    }
    // 确保 SSE 连接就绪
    if (!sseSource && convId) {
      connectSSE(convId, set, get);
    }
    // 添加用户消息到 UI（用 get() 获取最新 messages，避免被 selectConversation 覆盖）
    const currentMsgs = get().messages;
    set({
      messages: [...currentMsgs, { id: crypto.randomUUID(), role: "user", content: text, createdAt: Date.now() }],
      busy: true,
    });
    try {
      await apiPost("/api/prompt", {
        sessionId: convId,
        text,
        mode: s.mode,
        permission: s.permission,
      });
    } catch (e) {
      set((st) => ({
        messages: [...st.messages, { id: crypto.randomUUID(), role: "assistant", content: "出错了：" + (e as Error).message, createdAt: Date.now() }],
        busy: false,
      }));
    }
  },

  abortGeneration: async () => {
    const id = get().currentConvId;
    if (!id) return;
    try { await apiPost("/api/abort", { sessionId: id }); } catch {}
    set({ busy: false });
  },

  setMode: (m) => set({ mode: m }),
  setPermission: (p) => set({ permission: p }),

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pi-a-theme", next); } catch {}
  },

  setShowSettings: (v) => set({ showSettings: v }),
  setShowArtifacts: (v) => set({ showArtifacts: v }),
  setShowWorkspaceManager: (v) => set({ showWorkspaceManager: v }),
  setComposerWorkspaceId: (id) => set({ composerWorkspaceId: id }),

  // ===== 工作空间 =====
  loadWorkspaces: async () => {
    try {
      const list = await apiGet<Workspace[]>("/api/workspaces");
      // 不自动创建默认空间——空间由用户主动创建
      set({ workspaces: list });
    } catch {}
  },

  selectWorkspace: (id) => {
    set({ composerWorkspaceId: id });
  },

  createWorkspace: async (name, dirPath, icon) => {
    const ws = await apiPost<Workspace>("/api/workspaces", {
      name,
      dirPath: dirPath || "",
      icon: icon || "folder",
    });
    await get().loadWorkspaces();
    set({ composerWorkspaceId: ws.id });
  },

  updateWorkspace: async (id, patch) => {
    await apiPut("/api/workspaces/" + id, patch);
    await get().loadWorkspaces();
  },

  deleteWorkspace: async (id) => {
    await apiDelete("/api/workspaces/" + id);
    // 清除 composer 选择如果删的是当前选的
    if (get().composerWorkspaceId === id) set({ composerWorkspaceId: null });
    await get().loadWorkspaces();
    await get().loadConversations();
  },

  assignConversation: async (convId, workspaceId) => {
    await apiPost("/api/workspaces/" + workspaceId + "/assign", { conversationId: convId });
    await get().loadConversations();
  },
}));

// SSE 事件处理
function getToolOutputString(output: unknown): string {
  if (!output) return "";
  if (typeof output === "string") return output;
  const anyOutput = output as any;
  if (Array.isArray(anyOutput.content)) {
    return anyOutput.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  if (typeof anyOutput.text === "string") return anyOutput.text;
  return JSON.stringify(output);
}

function handleEvent(ev: any, set: any, get: any) {
  if (ev.type === "agent_start") {
    // 思考中状态由 UI 根据 busy 自动渲染
  } else if (ev.type === "message_update") {
    const text = (ev.message?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (ev.message?.role === "assistant" && text) {
      set((st: AppState) => {
        const msgs = [...st.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === "assistant" && (last as any)._streaming) {
          last.content = text;
          return { messages: [...msgs] };
        }
        return { messages: [...msgs, { id: crypto.randomUUID(), role: "assistant", content: text, createdAt: Date.now(), _streaming: true } as any] };
      });
    }
  } else if (ev.type === "message_end") {
    const text = (ev.message?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (ev.message?.role === "assistant" && text) {
      set((st: AppState) => {
        const msgs = [...st.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === "assistant" && (last as any)._streaming) {
          last.content = text;
          delete (last as any)._streaming;
          return { messages: [...msgs] };
        }
        return { messages: [...msgs, { id: crypto.randomUUID(), role: "assistant", content: text, createdAt: Date.now() }] };
      });
    }
  } else if (ev.type === "tool_execution_start") {
    set((st: AppState) => ({
      messages: [...st.messages, {
        id: ev.toolCallId,
        role: "tool",
        content: "",
        toolName: ev.toolName,
        toolArgs: typeof ev.args === "string" ? ev.args : JSON.stringify(ev.args ?? {}),
        status: "running",
        createdAt: Date.now(),
        isError: false
      } as any],
    }));
  } else if (ev.type === "tool_execution_end") {
    set((st: AppState) => {
      const outputStr = getToolOutputString(ev.output);
      const msgs = st.messages.map((m) =>
        m.id === ev.toolCallId ? {
          ...m,
          content: outputStr,
          status: ev.isError ? "error" : "success",
          isError: ev.isError
        } : m
      );
      return { messages: msgs };
    });
  } else if (ev.type === "agent_end") {
    set({ busy: false });
    get().loadConversations();
  } else if (ev.type === "tool_confirmation") {
    // 对标 WorkBuddy permissionRequest 流程：
    // 后端发来工具确认请求，展示确认弹窗
    set({
      pendingConfirm: {
        requestId: ev.requestId,
        toolName: ev.toolName,
        args: ev.args,
        sessionId: ev.sessionId,
      },
    });
  } else if (ev.type === "ask_user_question") {
    // 后端发来交互式提问（AskUserQuestion），展示提问卡片
    set({
      pendingAsk: {
        requestId: ev.requestId,
        sessionId: ev.sessionId,
        questions: ev.questions,
      },
    });
  }
}
