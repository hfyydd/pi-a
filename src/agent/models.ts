// src/agent/models.ts
// 全局 Models 集合管理
// 支持主流模型（DeepSeek、智谱 GLM、Kimi Moonshot、MiniMax、OpenAI、Claude、Gemini、阶跃星辰 ZAI、零一万物、通义千问 Qwen）
// 支持本地 Ollama 侦测与配置
// 支持自定义 OpenAI 规范 endpoint 动态注册

import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getApiKey } from "../infra/keychain.ts";
import { getSetting } from "../domains/settings/node/store.ts";

const models = createModels();

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

// 预设 Provider 的显示标签
export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  zhipu: "智谱 AI (GLM)",
  moonshot: "Kimi (月之暗面)",
  minimax: "MiniMax",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  zai: "阶跃星辰 (ZAI)",
  zeroone: "零一万物 (01.AI)",
  qwen: "通义千问 (Qwen)",
  ollama: "Ollama (本地大模型)",
};

// 预设 Provider 的 Base URL 默认值
export const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  minimax: "https://api.minimax.chat/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  zai: "https://api.stepfun.com/v1",
  zeroone: "https://api.lingyiwanwu.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://127.0.0.1:11434/v1",
};

// 预设 Provider 的默认模型列表
export const PRESET_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  deepseek: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
  ],
  zhipu: [
    { id: "glm-4-flash", name: "GLM-4 Flash (免费极速)" },
    { id: "glm-4-plus", name: "GLM-4 Plus (旗舰)" },
    { id: "glm-4-air", name: "GLM-4 Air (平衡)" },
    { id: "glm-4-long", name: "GLM-4 Long (超长上下文)" },
    { id: "glm-4", name: "GLM-4 Standard" },
  ],
  moonshot: [
    { id: "moonshot-v1-8k", name: "Moonshot v1 8K" },
    { id: "moonshot-v1-32k", name: "Moonshot v1 32K" },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  minimax: [
    { id: "abab6.5s-chat", name: "MiniMax abab6.5s" },
    { id: "abab6.5t-chat", name: "MiniMax abab6.5t" },
    { id: "abab6.5g-chat", name: "MiniMax abab6.5g" },
    { id: "minimax-text-01", name: "MiniMax Text 01" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "o1", name: "OpenAI o1" },
    { id: "o3-mini", name: "OpenAI o3-mini" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-latest", name: "Claude 3 Opus" },
  ],
  google: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  ],
  zai: [
    { id: "step-2-16k", name: "Step-2 16K" },
    { id: "step-1-flash", name: "Step-1 Flash" },
  ],
  zeroone: [
    { id: "yi-lightning", name: "Yi Lightning" },
    { id: "yi-large", name: "Yi Large" },
    { id: "yi-medium", name: "Yi Medium" },
  ],
  qwen: [
    { id: "qwen-max", name: "通义千问 Qwen Max" },
    { id: "qwen-plus", name: "通义千问 Qwen Plus" },
    { id: "qwen-turbo", name: "通义千问 Qwen Turbo" },
    { id: "qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
  ],
  ollama: [
    { id: "qwen2.5-coder:latest", name: "Qwen 2.5 Coder (本地)" },
    { id: "deepseek-r1:8b", name: "DeepSeek R1 (本地)" },
    { id: "llama3:latest", name: "Llama 3 (本地)" },
  ],
};

// 已注册的 providers 集合
const registered = new Set<string>();
let initialized = false;

function createModelItem(id: string, name: string, providerId: string, baseUrl: string) {
  return {
    id,
    name: name || id,
    provider: providerId,
    api: "openai-completions" as const,
    baseUrl,
    reasoning: false,
    input: ["text" as const, "image" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

function createApiKeyAuth(key: string, name = "API Key") {
  return {
    apiKey: {
      type: "api-key" as const,
      name,
      resolve: async () => ({
        auth: { apiKey: key },
      }),
    },
  };
}

/** 获取全部自定义 Provider 配置列表 */
export function getCustomProviders(): CustomProviderConfig[] {
  try {
    const raw = getSetting("custom_providers", "[]");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** 动态构造并注册 Provider 实例 */
async function buildProviderInstance(providerId: string): Promise<any> {
  // 1. 自定义 OpenAI Provider
  const customList = getCustomProviders();
  const customConfig = customList.find((c) => c.id === providerId);
  if (customConfig) {
    const key = customConfig.apiKey || (await getApiKey(providerId)) || "unused";
    const baseUrl = customConfig.baseUrl.endsWith("/v1")
      ? customConfig.baseUrl
      : `${customConfig.baseUrl.replace(/\/$/, "")}/v1`;
    const modelNames = customConfig.models.length > 0 ? customConfig.models : ["default-model"];
    return createProvider({
      id: customConfig.id,
      name: customConfig.name || customConfig.id,
      baseUrl,
      auth: createApiKeyAuth(key),
      models: modelNames.map((m) => createModelItem(m, m, customConfig.id, baseUrl)),
      api: openAICompletionsApi(),
    });
  }

  // 2. 本地 Ollama Provider
  if (providerId === "ollama") {
    const rawOllamaUrl = getSetting("ollama_base_url", "http://127.0.0.1:11434");
    const baseUrl = rawOllamaUrl.endsWith("/v1")
      ? rawOllamaUrl
      : `${rawOllamaUrl.replace(/\/$/, "")}/v1`;

    let modelItems = PRESET_MODELS.ollama.map((m) => m.id);

    // 尝试向 Ollama 服务自动侦测本地已被 pull 的模型
    try {
      const rootUrl = rawOllamaUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
      const res = await fetch(`${rootUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          modelItems = data.models.map((m: any) => m.name || m.model);
        }
      }
    } catch (e) {
      console.warn("[ollama] 本地模型连通检测:", (e as Error).message);
    }

    return createProvider({
      id: "ollama",
      name: "Ollama (本地大模型)",
      baseUrl,
      auth: createApiKeyAuth("ollama"),
      models: modelItems.map((m) => createModelItem(m, m, "ollama", baseUrl)),
      api: openAICompletionsApi(),
    });
  }

  // 3. 原生 pi-ai 官方 SDK 提供商 (DeepSeek, Kimi, MiniMax, OpenAI, Anthropic, Google, ZAI)
  if (providerId === "deepseek") {
    return (await import("@earendil-works/pi-ai/providers/deepseek")).deepseekProvider();
  }
  if (providerId === "moonshot") {
    return (await import("@earendil-works/pi-ai/providers/moonshotai-cn")).moonshotaiCnProvider();
  }
  if (providerId === "minimax") {
    return (await import("@earendil-works/pi-ai/providers/minimax-cn")).minimaxCnProvider();
  }
  if (providerId === "openai") {
    return (await import("@earendil-works/pi-ai/providers/openai")).openaiProvider();
  }
  if (providerId === "anthropic") {
    return (await import("@earendil-works/pi-ai/providers/anthropic")).anthropicProvider();
  }
  if (providerId === "google") {
    return (await import("@earendil-works/pi-ai/providers/google")).googleProvider();
  }
  if (providerId === "zai") {
    return (await import("@earendil-works/pi-ai/providers/zai")).zaiProvider();
  }

  // 4. 通用 OpenAI 规范兼容提供商（智谱 GLM、零一万物 01.AI、通义千问 Qwen 等）
  const customBaseUrl = getSetting(`provider_base_url_${providerId}`, "");
  const baseUrl = customBaseUrl || PROVIDER_BASE_URLS[providerId] || "https://api.openai.com/v1";
  const apiKey = (await getApiKey(providerId)) || "unused";
  const presets = PRESET_MODELS[providerId] || [{ id: `${providerId}-default`, name: `${providerId}-default` }];

  return createProvider({
    id: providerId,
    name: PROVIDER_LABELS[providerId] || providerId,
    baseUrl,
    auth: createApiKeyAuth(apiKey),
    models: presets.map((m) => createModelItem(m.id, m.name, providerId, baseUrl)),
    api: openAICompletionsApi(),
  });
}

/** 初始化：加载并注册默认与已有 API Key 的 Provider */
export async function initModels() {
  if (initialized) return;

  // 默认注册 DeepSeek 和 Ollama
  await registerProvider("deepseek");
  await registerProvider("ollama");

  // 注册预设 Provider 中有 API key 的那些
  for (const pId of Object.keys(PROVIDER_LABELS)) {
    const key = await getApiKey(pId);
    if (key) {
      await registerProvider(pId);
    }
  }

  // 注册自定义 Provider
  const customList = getCustomProviders();
  for (const c of customList) {
    await registerProvider(c.id);
  }

  initialized = true;
  console.log("[models] 全局模型模块初始化完成，已注册:", [...registered]);
}

/** 动态注册/刷新指定 Provider */
export async function registerProvider(providerId: string): Promise<boolean> {
  try {
    const providerInst = await buildProviderInstance(providerId);
    models.setProvider(providerInst);
    registered.add(providerId);
    console.log(`[models] 已注册/重载 provider: ${providerId}`);
    return true;
  } catch (e) {
    console.warn(`[models] 注册 ${providerId} 失败:`, (e as Error).message);
    return false;
  }
}

/** 获取 model 对象 */
export function getModel(provider: string, modelId: string) {
  if (!initialized) {
    try { initModels(); } catch {}
  }
  return models.getModel(provider, modelId);
}

/** 列出某 provider 的所有可用 model */
export function listModels(provider: string) {
  if (!initialized) {
    try { initModels(); } catch {}
  }
  return models.getModels(provider);
}

/** 列出所有可用的 provider 及其模型结构（供前端 UI） */
export function listAllProviders(): Array<{
  id: string;
  provider: string;
  name: string;
  label: string;
  baseUrl?: string;
  isCustom?: boolean;
  models: Array<{ id: string; name: string }>;
}> {
  const result: Array<{
    id: string;
    provider: string;
    name: string;
    label: string;
    baseUrl?: string;
    isCustom?: boolean;
    models: Array<{ id: string; name: string }>;
  }> = [];

  // 1. 预设服务商（DeepSeek, 智谱, Kimi, MiniMax, OpenAI, Claude, Gemini, ZAI, 零一万物, 通义千问, Ollama）
  for (const pId of Object.keys(PROVIDER_LABELS)) {
    const registeredModels = models.getModels(pId);
    const modelList = registeredModels && registeredModels.length > 0
      ? registeredModels.map((m) => ({ id: m.id, name: m.name || m.id }))
      : PRESET_MODELS[pId] || [];

    const customBaseUrl = getSetting(`provider_base_url_${pId}`, "");

    result.push({
      id: pId,
      provider: pId,
      name: PROVIDER_LABELS[pId],
      label: PROVIDER_LABELS[pId],
      baseUrl: customBaseUrl || PROVIDER_BASE_URLS[pId],
      isCustom: false,
      models: modelList,
    });
  }

  // 2. 自定义 OpenAI 服务商
  const customList = getCustomProviders();
  for (const c of customList) {
    const registeredModels = models.getModels(c.id);
    const modelList = registeredModels && registeredModels.length > 0
      ? registeredModels.map((m) => ({ id: m.id, name: m.name || m.id }))
      : c.models.map((m) => ({ id: m, name: m }));

    result.push({
      id: c.id,
      provider: c.id,
      name: c.name,
      label: c.name,
      baseUrl: c.baseUrl,
      isCustom: true,
      models: modelList,
    });
  }

  return result;
}

/** 列出所有可注册的预设 provider ID */
export function listAvailableProviders(): string[] {
  const customIds = getCustomProviders().map((c) => c.id);
  return [...Object.keys(PROVIDER_LABELS), ...customIds];
}

/** 暴露 models 容器实例 */
export function getModels() {
  if (!initialized) {
    try { initModels(); } catch {}
  }
  return models;
}
