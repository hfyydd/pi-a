import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

export type RunMode = "ask" | "plan" | "craft";
export type PermLevel = "readonly" | "default" | "full";
export type Theme = "light" | "dark";

export interface Conversation {
  id: string;
  title: string;
  category: string;
  status: string;
  modelProvider: string;
  modelId: string;
  workspaceId?: string;
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
  isError?: boolean;
  createdAt: number;
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

  // UI 面板
  showSettings: boolean;
  showArtifacts: boolean;
  showWorkspaceManager: boolean;
  _pendingDirPath: { name: string; path: string } | null;  // 「打开本地文件夹」传给 modal 的临时状态

  // Actions
  toggleSidebar: () => void;
  setCategory: (cat: string) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (title?: string) => Promise<string>;
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

  // 模型
  modelId: "deepseek-v4-flash",
  modelProvider: "deepseek",
  showSettings: false,
  showArtifacts: false,
  showWorkspaceManager: false,
  _pendingDirPath: null,

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
    set({ currentConvId: id, messages: [] });
    try {
      const msgs = await apiGet<Message[]>("/api/msgs/" + id);
      set({ messages: msgs });
    } catch {}
    // 开启 SSE
    try {
      sseSource = new EventSource("/api/events/" + id + "/stream");
      sseSource.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          handleEvent(ev, set, get);
        } catch {}
      };
      sseSource.onerror = () => {
        if (sseSource) { sseSource.close(); sseSource = null; }
      };
    } catch {}
  },

  createConversation: async (title = "新对话") => {
    const wsId = get().composerWorkspaceId;  // Composer 里选的空间
    const conv = await apiPost<Conversation>("/api/conv", { title, workspaceId: wsId });
    // 建完即复位：下一次「开始对话」默认不归属任何空间（任务）
    set({ composerWorkspaceId: null });
    await get().loadConversations();
    get().selectConversation(conv.id);
    return conv.id;
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
    // 添加用户消息到 UI
    set((st) => ({
      messages: [...st.messages, { id: crypto.randomUUID(), role: "user", content: text, createdAt: Date.now() }],
      busy: true,
    }));
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
      messages: [...st.messages, { id: ev.toolCallId, role: "tool", content: ev.toolName, toolName: ev.toolName, createdAt: Date.now(), isError: false } as any],
    }));
  } else if (ev.type === "tool_execution_end") {
    set((st: AppState) => {
      const msgs = st.messages.map((m) =>
        m.id === ev.toolCallId ? { ...m, content: ev.toolName, isError: ev.isError } : m
      );
      return { messages: msgs };
    });
  } else if (ev.type === "agent_end") {
    set({ busy: false });
    get().loadConversations();
  }
}
