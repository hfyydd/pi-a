// 测试: Deno 能否 import pi 包并实例化核心对象
// 不发真实 LLM 请求, 只验证模块加载与类型/对象可用性

// 先试从 npm 引入(Deno 的 npm: specifier)
console.log("=== 测试 1: 从 npm 加载 pi-ai (createModels) ===");
try {
  // @ts-ignore npm specifier
  const ai = await import("npm:@earendil-works/pi-ai@0.80.3");
  console.log("  ✓ pi-ai 加载成功");
  console.log("  exports:", Object.keys(ai).filter((k) => !k.startsWith("_")).slice(0, 15).join(", "));
  console.log("  createModels 类型:", typeof ai.createModels);
} catch (e) {
  console.log("  ✗ pi-ai 加载失败:", (e as Error).message?.slice(0, 200));
}

console.log("\n=== 测试 2: 从 npm 加载 pi-agent-core (Agent) ===");
try {
  // @ts-ignore
  const agent = await import("npm:@earendil-works/pi-agent-core@0.80.3");
  console.log("  ✓ pi-agent-core 加载成功");
  console.log("  exports:", Object.keys(agent).filter((k) => !k.startsWith("_")).slice(0, 15).join(", "));
  console.log("  Agent 类型:", typeof agent.Agent);
} catch (e) {
  console.log("  ✗ pi-agent-core 加载失败:", (e as Error).message?.slice(0, 200));
}

console.log("\n=== 测试 3: 实例化 createModels + setProvider ===");
try {
  // @ts-ignore
  const { createModels } = await import("npm:@earendil-works/pi-ai@0.80.3");
  // @ts-ignore
  const { deepseekProvider } = await import("npm:@earendil-works/pi-ai@0.80.3/providers/deepseek");
  const models = createModels();
  console.log("  ✓ createModels() 成功, 类型:", typeof models);
  console.log("  setProvider 类型:", typeof models.setProvider);
  models.setProvider(deepseekProvider());
  console.log("  ✓ setProvider(deepseek) 成功");
  const model = models.getModel("deepseek", "deepseek-chat");
  console.log("  ✓ getModel 返回:", model ? `${model.provider}/${model.id}` : "null");
} catch (e) {
  console.log("  ✗ 失败:", (e as Error).message?.slice(0, 300));
}

console.log("\n=== 测试 4: 实例化 new Agent() ===");
try {
  // @ts-ignore
  const { Agent } = await import("npm:@earendil-works/pi-agent-core@0.80.3");
  // @ts-ignore
  const { createModels } = await import("npm:@earendil-works/pi-ai@0.80.3");
  // @ts-ignore
  const { deepseekProvider } = await import("npm:@earendil-works/pi-ai@0.80.3/providers/deepseek");
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", "deepseek-chat");
  const agent = new Agent({ initialState: { model, systemPrompt: "test", tools: [] } });
  console.log("  ✓ new Agent() 成功!");
  console.log("  agent.prompt 类型:", typeof agent.prompt);
  console.log("  agent.subscribe 类型:", typeof agent.subscribe);
  console.log("  agent.state.isStreaming:", agent.state.isStreaming);
} catch (e) {
  console.log("  ✗ 失败:", (e as Error).message?.slice(0, 300));
}

console.log("\n全部测试完成");
