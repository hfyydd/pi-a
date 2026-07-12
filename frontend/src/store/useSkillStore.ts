import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";
import { useStore } from "./useStore";

export interface SkillMeta {
  name: string;        // 标识名
  displayName?: string;// 显示名
  description: string;
  body: string;
  disabled: boolean;
  builtin: boolean;
  path: string;
}

export interface Expert {
  id: string;
  name: string;
  nickname?: string;
  icon: string;
  description: string;
  systemPrompt: string;
  tags?: string[];
  badge?: string;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: "stdio" | "sse" | "http";
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpConnectionInfo {
  name: string;
  toolCount: number;
  tools: string[];
}

interface SkillState {
  skills: SkillMeta[];
  experts: Expert[];
  loading: boolean;
  mcpConfig: McpConfig | null;
  mcpConnected: McpConnectionInfo[];

  loadSkills: () => Promise<void>;
  saveSkill: (
    name: string,
    description: string,
    disabled: boolean,
    body: string,
    displayName?: string
  ) => Promise<SkillMeta>;
  deleteSkill: (name: string) => Promise<void>;
  toggleSkill: (name: string, disabled: boolean) => Promise<void>;
  loadExperts: () => Promise<void>;
  startExpertChat: (expertId: string, expertName: string) => Promise<void>;
  loadMcp: () => Promise<void>;
  saveMcp: (config: McpConfig) => Promise<boolean>;
  installPresetMcp: (serverName: string, config: McpServerConfig) => Promise<boolean>;
  uninstallMcp: (serverName: string) => Promise<boolean>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  experts: [],
  loading: false,
  mcpConfig: null,
  mcpConnected: [],

  loadSkills: async () => {
    set({ loading: true });
    try {
      const list = await apiGet<SkillMeta[]>("/api/skills");
      set({ skills: list });
    } catch (e) {
      console.error("[useSkillStore] 加载技能失败:", e);
    } finally {
      set({ loading: false });
    }
  },

  saveSkill: async (name, description, disabled, body, displayName) => {
    // 检查是否已存在，决定是用 POST 还是 PUT
    const existing = get().skills.find((s) => s.name === name);
    let res: SkillMeta;
    if (existing) {
      res = await apiPut<SkillMeta>("/api/skills/" + name, {
        description,
        disabled,
        body,
        displayName,
      });
    } else {
      res = await apiPost<SkillMeta>("/api/skills", {
        name,
        description,
        disabled,
        body,
        displayName,
      });
    }
    await get().loadSkills();
    return res;
  },

  deleteSkill: async (name) => {
    await apiDelete("/api/skills/" + name);
    await get().loadSkills();
  },

  toggleSkill: async (name, disabled) => {
    const existing = get().skills.find((s) => s.name === name);
    if (!existing) return;
    await apiPut<SkillMeta>("/api/skills/" + name, {
      description: existing.description,
      disabled,
      body: existing.body,
      displayName: existing.displayName || existing.name,
    });
    await get().loadSkills();
  },

  loadExperts: async () => {
    try {
      const list = await apiGet<Expert[]>("/api/experts");
      set({ experts: list });
    } catch (e) {
      console.error("[useSkillStore] 加载专家失败:", e);
    }
  },

  startExpertChat: async (expertId, expertName) => {
    // 1. 新建会话
    const appStore = useStore.getState();
    const convId = await appStore.createConversation(`${expertName}会话`);

    // 2. 绑定专家
    await apiPost(`/api/conv/${convId}/expert`, { expertId });

    // 3. 重新加载并选中该会话
    await appStore.loadConversations();
    await appStore.selectConversation(convId);
  },

  loadMcp: async () => {
    try {
      const res = await apiGet<{ config: McpConfig; connected: McpConnectionInfo[] }>("/api/mcp");
      set({ mcpConfig: res.config, mcpConnected: res.connected });
    } catch (e) {
      console.error("[useSkillStore] 加载 MCP 失败:", e);
    }
  },

  saveMcp: async (config) => {
    try {
      await apiPost("/api/mcp", config);
      await get().loadMcp();
      return true;
    } catch (e) {
      console.error("[useSkillStore] 保存 MCP 失败:", e);
      return false;
    }
  },

  installPresetMcp: async (serverName, serverConfig) => {
    const current = get().mcpConfig || { mcpServers: {} };
    const updated = {
      ...current,
      mcpServers: {
        ...current.mcpServers,
        [serverName]: serverConfig,
      },
    };
    return get().saveMcp(updated);
  },

  uninstallMcp: async (serverName) => {
    const current = get().mcpConfig || { mcpServers: {} };
    const mcpServers = { ...current.mcpServers };
    delete mcpServers[serverName];
    const updated = { ...current, mcpServers };
    return get().saveMcp(updated);
  },
}));
