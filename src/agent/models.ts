// src/agent/models.ts
// 全局 Models 集合管理
// 支持多 provider 动态注册（DeepSeek + Moonshot + ZAI 等）

import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

const models = createModels();

// 所有支持的 provider factory（按需动态加载，避免一次性 import 太多）
const providerFactories: Record<string, () => Promise<any>> = {
  deepseek: async () => (await import("@earendil-works/pi-ai/providers/deepseek")).deepseekProvider(),
  moonshot: async () => (await import("@earendil-works/pi-ai/providers/moonshotai")).moonshotaiProvider(),
  zai: async () => (await import("@earendil-works/pi-ai/providers/zai")).zaiProvider(),
  minimax: async () => (await import("@earendil-works/pi-ai/providers/minimax-cn")).minimaxCnProvider(),
  antling: async () => (await import("@earendil-works/pi-ai/providers/ant-ling")).antLingProvider(),
  xiaomi: async () => (await import("@earendil-works/pi-ai/providers/xiaomi")).xiaomiProvider(),
};

// provider 显示名
export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  moonshot: "Kimi (月之暗面)",
  zai: "ZAI (阶跃星辰)",
  minimax: "MiniMax",
  antling: "蚂蚁百灵",
  xiaomi: "小米",
};

// 已注册的 providers
const registered = new Set<string>();
let initialized = false;

/** 初始化：注册 DeepSeek（默认，无需额外 API key 来源） */
export function initModels() {
  if (initialized) return;
  models.setProvider(deepseekProvider());
  registered.add("deepseek");
  console.log("[models] 已注册 provider: deepseek");
  initialized = true;
}

/** 动态注册一个 provider（按需） */
export async function registerProvider(providerId: string): Promise<boolean> {
  if (registered.has(providerId)) return true;
  const factory = providerFactories[providerId];
  if (!factory) return false;
  try {
    const provider = await factory();
    models.setProvider(provider);
    registered.add(providerId);
    console.log(`[models] 已注册 provider: ${providerId}`);
    return true;
  } catch (e) {
    console.warn(`[models] 注册 ${providerId} 失败:`, e);
    return false;
  }
}

/** 获取 model 对象 */
export function getModel(provider: string, modelId: string) {
  if (!initialized) initModels();
  return models.getModel(provider, modelId);
}

/** 列出某 provider 的所有可用 model（供 UI 选择） */
export function listModels(provider: string) {
  if (!initialized) initModels();
  return models.getModels(provider);
}

/** 列出所有已注册 provider 及其模型（供 UI 选择器） */
export function listAllProviders(): Array<{ provider: string; label: string; models: any[] }> {
  if (!initialized) initModels();
  const result: Array<{ provider: string; label: string; models: any[] }> = [];
  for (const p of registered) {
    result.push({
      provider: p,
      label: PROVIDER_LABELS[p] || p,
      models: [...models.getModels(p)],
    });
  }
  return result;
}

/** 列出所有可注册的 provider（含未注册的） */
export function listAvailableProviders(): string[] {
  return Object.keys(providerFactories);
}

/** 直接暴露 models 实例（engine 用 streamSimple） */
export function getModels() {
  if (!initialized) initModels();
  return models;
}
