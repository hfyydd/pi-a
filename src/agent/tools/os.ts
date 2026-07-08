// src/agent/tools/os.ts
// Computer Use 工具：截图 + 鼠标键盘控制。对照 08 计划功能13 + 05 文档§三（感知-操作循环）。
// macOS 实现：screencapture（截图）+ cliclick（鼠标键盘）+ osascript（app focus）。
// 安全：mouse_click/key_type 在 permissions.ts 的 DANGER_TOOLS 中，即使 full 权限也强制确认。

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const HOME = Deno.env.get("HOME") || "/tmp";
const SHOTS_DIR = `${HOME}/.pi-a/screenshots`;

async function ensureShotsDir(): Promise<void> {
  try { await Deno.mkdir(SHOTS_DIR, { recursive: true }); } catch { /* 已存在 */ }
}

/** Uint8Array → base64（分块防栈溢出） */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 检测 cliclick 是否安装 */
async function hasCliclick(): Promise<boolean> {
  try {
    const cmd = new Deno.Command("which", { args: ["cliclick"], stdout: "null", stderr: "null" });
    const r = await cmd.output();
    return r.code === 0;
  } catch { return false; }
}

/** 运行命令，成功返回 stdout，失败抛错 */
async function runCmd(name: string, args: string[]): Promise<string> {
  const cmd = new Deno.Command(name, { args, stdout: "piped", stderr: "piped" });
  const r = await cmd.output();
  const stdout = new TextDecoder().decode(r.stdout).trim();
  const stderr = new TextDecoder().decode(r.stderr).trim();
  if (r.code !== 0) throw new Error(stderr || `${name} 退出码 ${r.code}`);
  return stdout;
}

// ===== screenshot =====
const screenshotSchema = Type.Object({
  region: Type.Optional(Type.Object({
    x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number(),
  }, { description: "可选：截取指定区域（不传则全屏）" })),
});

export const screenshotTool: AgentTool<typeof screenshotSchema, { path: string }> = {
  name: "screenshot",
  label: "截图",
  description: "截取屏幕（或指定区域）并返回图片，供视觉分析。用于查看屏幕内容、确认操作效果。建议每次操作后截图自检。",
  parameters: screenshotSchema,
  execute: async (_id, p) => {
    await ensureShotsDir();
    const path = `${SHOTS_DIR}/shot-${Date.now()}.png`;
    const args = ["-x", "-C"]; // -x 静音；-C 含光标
    if (p.region) args.push("-R", `${p.region.x},${p.region.y},${p.region.w},${p.region.h}`);
    args.push(path);
    try {
      await runCmd("screencapture", args);
    } catch (e) {
      return {
        content: [{ type: "text", text: `❌ 截图失败：${(e as Error).message}\n（macOS 需在「系统设置 > 隐私与安全 > 屏幕录制」授权 Pi-a）` }],
        details: { path: "" },
      };
    }
    try {
      const bytes = await Deno.readFile(path);
      const base64 = toBase64(bytes);
      return {
        content: [
          { type: "image" as const, data: base64, mimeType: "image/png" },
          { type: "text" as const, text: `截图已保存：${path}` },
        ],
        details: { path },
      };
    } catch {
      return {
        content: [{ type: "text", text: `截图已保存但读取失败：${path}` }],
        details: { path },
      };
    }
  },
};

// ===== mouse_click =====
const clickSchema = Type.Object({
  x: Type.Number({ description: "点击的 x 坐标" }),
  y: Type.Number({ description: "点击的 y 坐标" }),
  button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")], { description: "左键(默认)/右键" })),
  double: Type.Optional(Type.Boolean({ description: "是否双击" })),
});

export const mouseClickTool: AgentTool<typeof clickSchema, { x: number; y: number }> = {
  name: "mouse_click",
  label: "鼠标点击",
  description: "在屏幕坐标 (x,y) 处点击鼠标。默认左键单击。需 cliclick（brew install cliclick）+ 辅助功能权限。",
  parameters: clickSchema,
  execute: async (_id, p) => {
    if (!(await hasCliclick())) {
      return { content: [{ type: "text", text: "❌ 未安装 cliclick。请运行 `brew install cliclick` 后重试。" }], details: { x: p.x, y: p.y } };
    }
    let action = "c";
    if (p.double) action = "dc";
    else if (p.button === "right") action = "rc";
    try {
      await runCmd("cliclick", [`${action}:${p.x},${p.y}`]);
      return { content: [{ type: "text", text: `✓ 已${p.double ? "双" : p.button === "right" ? "右键" : ""}点击 (${p.x},${p.y})` }], details: { x: p.x, y: p.y } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 点击失败：${(e as Error).message}\n（需在「系统设置 > 隐私与安全 > 辅助功能」授权 cliclick）` }], details: { x: p.x, y: p.y } };
    }
  },
};

// ===== mouse_move =====
const moveSchema = Type.Object({
  x: Type.Number({ description: "目标 x 坐标" }),
  y: Type.Number({ description: "目标 y 坐标" }),
});
export const mouseMoveTool: AgentTool<typeof moveSchema, { x: number; y: number }> = {
  name: "mouse_move",
  label: "鼠标移动",
  description: "移动鼠标到 (x,y)。需 cliclick + 辅助功能权限。",
  parameters: moveSchema,
  execute: async (_id, p) => {
    if (!(await hasCliclick())) {
      return { content: [{ type: "text", text: "❌ 未安装 cliclick。请运行 `brew install cliclick` 后重试。" }], details: { x: p.x, y: p.y } };
    }
    try {
      await runCmd("cliclick", [`m:${p.x},${p.y}`]);
      return { content: [{ type: "text", text: `✓ 已移动到 (${p.x},${p.y})` }], details: { x: p.x, y: p.y } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 移动失败：${(e as Error).message}` }], details: { x: p.x, y: p.y } };
    }
  },
};

// ===== key_type =====
const keySchema = Type.Object({
  text: Type.Optional(Type.String({ description: "要输入的文本" })),
  key: Type.Optional(Type.String({ description: "要按的键（return/tab/esc/cmd+c/shift+a 等，组合键用 + 连接）" })),
});
export const keyTypeTool: AgentTool<typeof keySchema, { input: string }> = {
  name: "key_type",
  label: "键盘输入",
  description: "输入文本或按键。text 输入字符串，key 按键（return/tab/esc/cmd+c 等）。需 cliclick + 辅助功能权限。",
  parameters: keySchema,
  execute: async (_id, p) => {
    if (!(await hasCliclick())) {
      return { content: [{ type: "text", text: "❌ 未安装 cliclick。请运行 `brew install cliclick` 后重试。" }], details: { input: p.text || p.key || "" } };
    }
    try {
      if (p.text) {
        await runCmd("cliclick", [`t:${p.text}`]);
        return { content: [{ type: "text", text: `✓ 已输入文本：${p.text.slice(0, 50)}` }], details: { input: p.text } };
      } else if (p.key) {
        await runCmd("cliclick", [`kp:${p.key}`]);
        return { content: [{ type: "text", text: `✓ 已按键：${p.key}` }], details: { input: p.key } };
      }
      return { content: [{ type: "text", text: "❌ 请提供 text 或 key 参数" }], details: { input: "" } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 按键失败：${(e as Error).message}\n（需在「系统设置 > 隐私与安全 > 辅助功能」授权）` }], details: { input: p.text || p.key || "" } };
    }
  },
};

// ===== app_focus =====
const appSchema = Type.Object({
  name: Type.String({ description: "应用名（如 Safari, Finder, 飞书）" }),
});
export const appFocusTool: AgentTool<typeof appSchema, { name: string }> = {
  name: "app_focus",
  label: "切换应用",
  description: "激活/前台显示指定应用。用 osascript 调用。",
  parameters: appSchema,
  execute: async (_id, p) => {
    try {
      await runCmd("osascript", ["-e", `tell application "${p.name}" to activate`]);
      return { content: [{ type: "text", text: `✓ 已切换到 ${p.name}` }], details: { name: p.name } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 切换失败：${(e as Error).message}\n（应用名可能不正确，试试英文名）` }], details: { name: p.name } };
    }
  },
};

// ===== cursor_pos =====
const cursorSchema = Type.Object({}, { description: "无参数" });
export const cursorPosTool: AgentTool<typeof cursorSchema, { x: number; y: number }> = {
  name: "cursor_pos",
  label: "鼠标位置",
  description: "获取当前鼠标坐标。需 cliclick。",
  parameters: cursorSchema,
  execute: async () => {
    if (!(await hasCliclick())) {
      return { content: [{ type: "text", text: "❌ 未安装 cliclick。" }], details: { x: -1, y: -1 } };
    }
    try {
      const out = await runCmd("cliclick", ["p"]);
      const m = out.match(/(\d+),(\d+)/);
      if (m) {
        const x = parseInt(m[1], 10), y = parseInt(m[2], 10);
        return { content: [{ type: "text", text: `当前鼠标位置：(${x},${y})` }], details: { x, y } };
      }
      return { content: [{ type: "text", text: out }], details: { x: -1, y: -1 } };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ 获取失败：${(e as Error).message}` }], details: { x: -1, y: -1 } };
    }
  },
};
