// 列出 deepseek provider 注册后, 实际可用的 model ids
// @ts-ignore
const { createModels } = await import("npm:@earendil-works/pi-ai@0.80.3");
// @ts-ignore
const { deepseekProvider } = await import("npm:@earendil-works/pi-ai@0.80.3/providers/deepseek");

const models = createModels();
const provider = deepseekProvider();
console.log("=== provider 信息 ===");
console.log("id:", provider.id);
console.log("models keys:", Object.keys(provider.models ?? {}).join(", "));
models.setProvider(provider);
console.log("\n=== getModels('deepseek') ===");
try {
  const list = models.getModels("deepseek");
  console.log(JSON.stringify(list, null, 2).slice(0, 800));
} catch (e) {
  console.log("getModels 失败:", (e as Error).message?.slice(0, 200));
}
