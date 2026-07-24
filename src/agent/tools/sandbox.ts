import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getDb } from "../../infra/db.ts";
import { sessionContext } from "../../infra/context.ts";

const bashSchema = Type.Object({
  command: Type.String({ description: "要运行的 bash 命令" }),
});

export const sandboxedBashTool: AgentTool<typeof bashSchema, any> = {
  name: "bash",
  label: "终端执行",
  description: "在沙箱化的终端中执行命令。写操作会被限制在当前工作目录和 /tmp 目录下，保障系统安全。",
  parameters: bashSchema,
  execute: async (_id, p) => {
    const command = p.command;
    const sessionId = sessionContext.getStore()?.sessionId;

    // 获取当前会话绑定的工作空间目录
    let workspaceDir = Deno.cwd();
    if (sessionId) {
      try {
        const db = getDb();
        const conv = db.prepare("SELECT workspace_id FROM conversations WHERE id = ?").get(sessionId) as { workspace_id?: string } | undefined;
        if (conv?.workspace_id) {
          const ws = db.prepare("SELECT dir_path FROM workspaces WHERE id = ?").get(conv.workspace_id) as { dir_path: string } | undefined;
          if (ws?.dir_path) {
            workspaceDir = ws.dir_path;
          }
        }
      } catch (e) {
        console.error("[sandbox] 获取工作空间失败:", e);
      }
    }

    const { getSetting } = await import("../../domains/settings/node/store.ts");
    const sandboxEnabled = getSetting("sandbox_security", "false") === "true";

    // 1. 解析命令名称 (例如 "npm install" 中的 "npm")
    const trimmed = command.trim();
    const firstWord = trimmed.split(/\s+/)[0];
    const cmdName = firstWord.split("/").pop() || "";

    // 2. 内置运行时开关控制 (Python, Node.js)
    if (sandboxEnabled) {
      const builtinRuntime = getSetting("builtin_runtime", "true") === "true";
      const pythonEnabled = getSetting("runtime_python", "true") === "true";
      const nodejsEnabled = getSetting("runtime_nodejs", "true") === "true";

      if (builtinRuntime) {
        if (cmdName === "python" || cmdName === "python3") {
          if (!pythonEnabled) {
            return {
              content: [{ type: "text", text: `[安全中心拦截]: Python 运行时已被禁用。` }],
              details: { error: true }
            };
          }
        }
        if (cmdName === "node") {
          if (!nodejsEnabled) {
            return {
              content: [{ type: "text", text: `[安全中心拦截]: Node.js 运行时已被禁用。` }],
              details: { error: true }
            };
          }
        }
      }
    }

    // 3. 命令安全放行名单检测
    if (sandboxEnabled) {
      const commandRulesJson = getSetting("security_command_rules", "[]");
      let whitelistedCommands: string[] = [];
      try {
        whitelistedCommands = JSON.parse(commandRulesJson);
      } catch {}

      const shellBuiltins = [
        "cd", "echo", "pwd", "exit", "ls", "cat", "mkdir", "clear",
        "ego-browser", "node", "deno", "python", "python3", "git", "npm", "npx",
        "yarn", "pnpm", "cargo", "go", "curl", "wget", "bash", "sh", "zsh"
      ];
      if (cmdName && !whitelistedCommands.includes(cmdName) && !shellBuiltins.includes(cmdName)) {
        return {
          content: [{ type: "text", text: `[安全中心拦截]: 命令 "${cmdName}" 不在安全放行名单中！若要允许执行此命令，请在「设置-安全中心-命令安全」中配置放行。` }],
          details: { error: true },
        };
      }
    }

    // 4. 数据安全删除保护与批量删除限制检测
    if (sandboxEnabled && command.includes("rm ")) {
      const deletionProtection = getSetting("deletion_protection", "true") === "true";
      if (deletionProtection) {
        const limitStr = getSetting("bulk_deletion_limit", "50");
        const limit = parseInt(limitStr, 10) || 50;

        // 获取可能的被删除文件/文件夹参数
        const parts = trimmed.split(/\s+/).filter(p => !p.startsWith("-"));
        const fileArgsCount = Math.max(0, parts.length - 1); // 扣除 rm 命令本身

        if (fileArgsCount >= limit || command.includes("*")) {
          return {
            content: [{ type: "text", text: `[安全中心拦截]: 检测到批量删除行为（删除对象数量 ${fileArgsCount} 达到或超过审批限额 ${limit}，或命令中包含通配符 * ），已自动拦截此操作。` }],
            details: { error: true }
          };
        }
        console.log(`[sandbox] 删除保护已启用：正在删除 ${fileArgsCount} 个文件，未超出批量审批上限 ${limit}`);
      }
    }

    const isMac = Deno.build.os === "darwin";

    if (isMac && sandboxEnabled) {
      const escapedWorkspace = workspaceDir.replace(/"/g, '\\"');
      
      // 5. 文件安全白名单规则合并到 macOS 沙箱 profile
      const fileRulesJson = getSetting("security_file_rules", "[]");
      let whitelistedPaths: string[] = [];
      try {
        whitelistedPaths = JSON.parse(fileRulesJson);
      } catch {}

      let fileRulesProfile = "";
      for (const path of whitelistedPaths) {
        if (path.trim()) {
          const escaped = path.trim().replace(/"/g, '\\"');
          fileRulesProfile += `(allow file-write* (subpath "${escaped}"))\n`;
        }
      }

      // 编译 macOS 沙箱规则：限制只允许写工作目录、/tmp 和用户配置的白名单目录
      const profile = `
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/var"))
(allow file-write* (subpath "${escapedWorkspace}"))
${fileRulesProfile}
`;
      try {
        const cmd = new Deno.Command("sandbox-exec", {
          args: ["-p", profile, "bash", "-c", command],
          cwd: workspaceDir,
          stdout: "piped",
          stderr: "piped",
        });
        const { code, stdout, stderr } = await cmd.output();
        const outText = new TextDecoder().decode(stdout);
        const errText = new TextDecoder().decode(stderr);
        const combined = (outText + errText).trim();

        return {
          content: [{ type: "text", text: combined || `(执行完毕，退出码: ${code})` }],
          details: { code },
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `[沙箱执行异常]: ${(e as Error).message}` }],
          details: { error: true },
        };
      }
    } else {
      // 未启用沙箱，或非 macOS 系统：直接运行 bash 终端
      try {
        const cmd = new Deno.Command("bash", {
          args: ["-c", command],
          cwd: workspaceDir,
          stdout: "piped",
          stderr: "piped",
        });
        const { code, stdout, stderr } = await cmd.output();
        const outText = new TextDecoder().decode(stdout);
        const errText = new TextDecoder().decode(stderr);
        const combined = (outText + errText).trim();

        return {
          content: [{ type: "text", text: combined || `(执行完毕，退出码: ${code})` }],
          details: { code },
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `[终端运行异常]: ${(e as Error).message}` }],
          details: { error: true },
        };
      }
    }
  }
};
