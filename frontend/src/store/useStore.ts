import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "../api/client";

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
  createdAt: number;
  updatedAt: number;
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

  // 对话
  messages: Message[];
  busy: boolean;
  mode: RunMode;
  permission: PermLevel;

  // 主题
  theme: Theme;

  // UI 面板
  showSettings: boolean;
  showArtifacts: boolean;

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
}

let sseSource: EventSource | null = null;

export const useStore = create<AppState>((set, get) => ({
  sidebarCollapsed: false,
  activeCategory: "assistant",
  conversations: [],
  currentConvId: null,
  searchQuery: "",
  messages: [],
  busy: false,
  mode: "craft",
  permission: "default",
  theme: "light",
  showSettings: false,
  showArtifacts: false,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setCategory: (cat) => {
    set({ activeCategory: cat, currentConvId: null, messages: [] });
    get().loadConversations();
  },

  loadConversations: async () => {
    try {
      const params = new URLSearchParams();
      const s = get();
      params.set("category", s.activeCategory);
      if (s.searchQuery) params.set("search", s.searchQuery);
      const list = await apiGet<Conversation[]>("/api/conv?" + params.toString());
      set({ conversations: list });
      if (list.length > 0 && !get().currentConvId) {
        get().selectConversation(list[0].id);
      }
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
    const s = get();
    const conv = await apiPost<Conversation>("/api/conv", { title, category: s.activeCategory });
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
        messages: [...st.messages, { id: crypto.randomUUID(), role: "assistant", content: "❌ 出错了：" + (e as Error).message, createdAt: Date.now() }],
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
        m.id === ev.toolCallId ? { ...m, content: `${ev.toolName} ${ev.isError ? "✗" : "✓"}`, isError: ev.isError } : m
      );
      return { messages: msgs };
    });
  } else if (ev.type === "agent_end") {
    set({ busy: false });
    get().loadConversations();
  }
}
