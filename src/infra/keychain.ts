// src/infra/keychain.ts
// API Key 存取。spike 验证 keytar 可用；MVP 优先 env 兜底

const SERVICE = "pi-a";

/**
 * 读取 API key：优先 keychain，兜底 env 变量。
 * provider 映射到环境变量名：deepseek → DEEPSEEK_API_KEY
 */
export async function getApiKey(provider: string): Promise<string | undefined> {
  // 1. env 兜底（开发期最方便）
  const envKey = providerToEnvKey(provider);
  const envVal = Deno.env.get(envKey);
  if (envVal) return envVal;

  // 2. keychain（spike 验证 keytar.setPassword/getPassword 可用）
  try {
    const keytar = await import("keytar");
    const pwd = await keytar.getPassword(SERVICE, provider);
    return pwd ?? undefined;
  } catch (e) {
    console.warn(`[keychain] 读取 ${provider} 失败:`, (e as Error).message);
    return undefined;
  }
}

/** 写入 keychain */
export async function setApiKey(provider: string, key: string): Promise<void> {
  const keytar = await import("keytar");
  await keytar.setPassword(SERVICE, provider, key);
}

/** 删除 keychain 中的 key */
export async function deleteApiKey(provider: string): Promise<void> {
  const keytar = await import("keytar");
  await keytar.deletePassword(SERVICE, provider);
}

function providerToEnvKey(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}
