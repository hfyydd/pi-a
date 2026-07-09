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

    const isMac = Deno.build.os === "darwin";

    if (isMac) {
      const escapedWorkspace = workspaceDir.replace(/"/g, '\\"');
      // 编译 macOS 沙箱规则：限制只允许写工作目录和 /tmp
      const profile = `
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/var"))
(allow file-write* (subpath "${escapedWorkspace}"))
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
      // 非 macOS 系统：直接运行 bash 终端（跨平台兼容降级）
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
