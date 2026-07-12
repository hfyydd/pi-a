// src/agent/mcp.ts
// MCP Host：连接外部 MCP server，把工具注册进 agent
// 极简方案（对照 WorkBuddy 三层代理的减法）：
//   1. 读 ~/.pi-a/mcp.json 配置
//   2. 每个 server 用 SDK Client 连接（stdio / SSE / streamable HTTP）
//   3. listTools → 包装成 pi AgentTool → 注册进 getFullTools()
//   4. 工具调用时转发给对应 MCP server

import type { AgentTool } from "@earendil-works/pi-agent-core";

const HOME = Deno.env.get("HOME") || "/tmp";
const MCP_CONFIG_PATH = `${HOME}/.pi-a/mcp.json`;

export interface McpServerConfig {
  command?: string;       // stdio: 可执行命令
  args?: string[];        // stdio: 命令参数
  env?: Record<string, string>;
  staticEnv?: Record<string, string>;
  url?: string;           // SSE/HTTP: server URL
  type?: string;          // 默认根据 command/url 自动判断
  disabled?: boolean;
  headers?: Record<string, string>;
  staticHeaders?: Record<string, string>;
  timeout?: number;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** 默认配置（首次创建） */
const DEFAULT_CONFIG: McpConfig = {
  mcpServers: {
    // 示例：文件系统 MCP server
    // "filesystem": {
    //   "command": "npx",
    //   "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Desktop"],
    // }
  },
};

/** 确保 MCP 配置文件存在 */
export async function ensureMcpConfig(): Promise<void> {
  try {
    await Deno.readTextFile(MCP_CONFIG_PATH);
  } catch {
    await Deno.mkdir(`${HOME}/.pi-a`, { recursive: true }).catch(() => {});
    await Deno.writeTextFile(MCP_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log("[mcp] 创建默认配置:", MCP_CONFIG_PATH);
  }
}

/** 读取 MCP 配置 */
export async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const text = await Deno.readTextFile(MCP_CONFIG_PATH);
    return JSON.parse(text);
  } catch {
    return { mcpServers: {} };
  }
}

/** 保存 MCP 配置 */
export async function saveMcpConfig(config: McpConfig): Promise<void> {
  await Deno.writeTextFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ===== MCP 连接管理 =====

interface McpConnection {
  client: any;
  tools: AgentTool<any>[];
  serverName: string;
}

const connections = new Map<string, McpConnection>();

/** 获取桌面登录 session 票据 */
async function getDesktopToken(): Promise<string> {
  try {
    const homedir = Deno.env.get("HOME") || "/tmp";
    const authDir = Deno.build.os === "darwin"
      ? `${homedir}/Library/Application Support/CodeBuddyExtension/Data/Public/auth`
      : Deno.build.os === "windows"
        ? `${Deno.env.get("LOCALAPPDATA") || `${homedir}/AppData/Local`}/CodeBuddyExtension/Data/Public/auth`
        : `${homedir}/.local/share/CodeBuddyExtension/Data/Public/auth`;

    for await (const entry of Deno.readDir(authDir)) {
      if (entry.isFile && entry.name.endsWith(".info") && !entry.name.endsWith(".logged-out")) {
        const content = await Deno.readTextFile(`${authDir}/${entry.name}`);
        const parsed = JSON.parse(content);
        if (parsed?.auth?.accessToken) {
          return parsed.auth.accessToken;
        }
      }
    }
  } catch { /* 忽略 */ }
  return "";
}

/** 替换模板变量 ${VAR_NAME} */
function resolveTemplate(str: string, token: string): string {
  return str.replace(/\${([^}]+)}/g, (match, name) => {
    const envVal = Deno.env.get(name);
    if (envVal) return envVal;
    // 凡是包含 TOKEN/KEY/AUTH 等字段的模板，均默认注入当前 active 的 desktop 票据
    if (name.includes("TOKEN") || name.includes("KEY") || name.includes("AUTH") || name.includes("ACCESS")) {
      return token;
    }
    return match;
  });
}

/** 连接所有已配置且未禁用的 MCP server，返回所有工具 */
export async function connectAllMcpServers(): Promise<AgentTool<any>[]> {
  const config = await loadMcpConfig();
  const allTools: AgentTool<any>[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if (serverConfig.disabled) continue;

    // 已连接则复用
    if (connections.has(name)) {
      allTools.push(...connections.get(name)!.tools);
      continue;
    }

    try {
      const tools = await connectMcpServer(name, serverConfig);
      if (tools.length > 0) {
        allTools.push(...tools);
        console.log(`[mcp] ${name}: ${tools.length} 个工具已注册`);
      }
    } catch (e) {
      console.warn(`[mcp] ${name} 连接失败:`, e instanceof Error ? e.message : e);
    }
  }

  return allTools;
}

/** 连接单个 MCP server */
async function connectMcpServer(name: string, config: McpServerConfig): Promise<AgentTool<any>[]> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

  let transport: any;
  const token = await getDesktopToken();

  if (config.command) {
    // stdio transport
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    
    // 合并并处理环境配置
    const mergedEnv = {
      ...Deno.env.toObject(),
      ...(config.env || {}),
      ...(config.staticEnv || {}),
    };
    
    // 替换环境中的 ${TOKEN} 等占位符
    const resolvedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(mergedEnv)) {
      resolvedEnv[k] = typeof v === "string" ? resolveTemplate(v, token) : String(v);
    }

    transport = new StdioClientTransport({
      command: config.command,
      args: (config.args || []).map(arg => resolveTemplate(arg, token)),
      env: resolvedEnv as any,
    });
  } else if (config.url) {
    // SSE 或 streamable HTTP
    const resolvedUrl = resolveTemplate(config.url, token);
    const transportType = config.type || "http";

    // 构建 Headers
    const headers: Record<string, string> = {};
    if (config.staticHeaders) {
      for (const [k, v] of Object.entries(config.staticHeaders)) {
        headers[k] = resolveTemplate(v, token);
      }
    }
    if (config.headers) {
      for (const [k, v] of Object.entries(config.headers)) {
        headers[k] = resolveTemplate(v, token);
      }
    }
    
    // 如果无 authorization 且有 session token，自动补齐 authorization 头
    if (token && !headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (transportType.toLowerCase() === "sse") {
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      transport = new SSEClientTransport(new URL(resolvedUrl), {
        eventSourceInit: {
          headers: headers
        }
      } as any);
    } else {
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      transport = new StreamableHTTPClientTransport(new URL(resolvedUrl), {
        requestInit: {
          headers: headers
        }
      });
    }
  } else {
    throw new Error("MCP server 配置需要 command (stdio) 或 url (HTTP/SSE)");
  }

  const client = new Client(
    { name: "pi-a", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  // 列出工具
  const toolsResponse = await client.listTools();
  const mcpTools = toolsResponse.tools || [];

  // 包装成 pi AgentTool
  const tools: AgentTool<any>[] = mcpTools.map((mcpTool: any) => {
    const prefixedName = `mcp_${name}_${mcpTool.name}`;
    return {
      name: prefixedName,
      label: `MCP: ${mcpTool.name}`,
      description: `[${name}] ${mcpTool.description || mcpTool.name}`,
      parameters: mcpTool.inputSchema || { type: "object", properties: {} },
      execute: async (_id: string, params: any) => {
        const result = await client.callTool({ name: mcpTool.name, arguments: params });
        const content = (result.content || []) as any[];
        const text = content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
        return {
          content: [{ type: "text", text: text || "(无输出)" }],
          details: { server: name, tool: mcpTool.name },
        };
      },
    };
  });

  connections.set(name, { client, tools, serverName: name });
  return tools;
}

/** 断开所有 MCP 连接 */
export async function disconnectAllMcpServers(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      await conn.client.close();
      console.log(`[mcp] ${name} 已断开`);
    } catch { /* 忽略 */ }
  }
  connections.clear();
}

/** 列出已连接的 MCP server 及其工具（供 UI 展示） */
export function listMcpConnections(): Array<{ name: string; toolCount: number; tools: string[] }> {
  return [...connections.values()].map((conn) => ({
    name: conn.serverName,
    toolCount: conn.tools.length,
    tools: conn.tools.map((t) => t.name),
  }));
}
