// src/agent/models.ts
// 全局 Models 集合管理（spike 验证可用）
// 按 03 文档 §2.3：createModels() + provider factory，避免 /compat 和 providers/all

import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

// 全局唯一 Models 实例
const models = createModels();

// provider factory 注册表（按用户设置动态注册，MVP 先写死 deepseek）
const providerFactories: Record<string, () => ReturnType<typeof deepseekProvider>> = {
  deepseek: deepseekProvider,
};

let initialized = false;

/** 初始化：注册所有默认 provider。幂等。 */
export function initModels() {
  if (initialized) return;
  for (const [id, factory] of Object.entries(providerFactories)) {
    models.setProvider(factory());
    console.log(`[models] 已注册 provider: ${id}`);
  }
  initialized = true;
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

/** 直接暴露 models 实例（engine 用 streamSimple） */
export function getModels() {
  if (!initialized) initModels();
  return models;
}
