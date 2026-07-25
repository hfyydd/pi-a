// src/agent/sandbox.ts
// Pi-Sandbox: Pi-Agent 引擎核心沙箱模块
// 包含：进程级安全门控、环境变量净化、文件系统边界隔离、Docker 容器隔离自适应检测与高危指令动态拦截。

export interface SandboxPolicy {
  enableEnvironmentSanitization: boolean;
  enablePathBoundaryCheck: boolean;
  blockedCommandPatterns: RegExp[];
  sanitizedEnvVars: string[];
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  enableEnvironmentSanitization: true,
  enablePathBoundaryCheck: true,
  sanitizedEnvVars: [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_BOT_TOKEN",
  ],
  blockedCommandPatterns: [
    /^\s*rm\s+-[rRfF]*\s+\/\s*$/,                 // rm -rf /
    /^\s*rm\s+-[rRfF]*\s+~\s*$/,                 // rm -rf ~
    /^\s*rm\s+-[rRfF]*\s+\*$/,                  // rm -rf *
    /:\(\)\s*\{\s*:\|\:&\s*\}\s*;\s*:/,          // Fork Bomb 炸弹指令
    />\s*\/dev\/sd[a-z]/,                        // 覆盖物理磁盘裸设备
    />\s*\/dev\/nvme/,                          // 覆盖 NVMe 裸设备
    /^\s*dd\s+if=.*of=\/dev\//,                 // dd 覆盖设备
    /^\s*mkfs\./,                               // 格式化文件系统
    /chmod\s+(-R\s+)?777\s+\//,                 // 毁灭性全盘提权
    /curl\s+.*\|\s*(sudo\s+)?sh\b/,              // 未经检查的远程脚本管道提权
    /wget\s+.*\|\s*(sudo\s+)?sh\b/,
  ],
};

export interface SandboxInspectionResult {
  allowed: boolean;
  reason?: string;
  isDangerous?: boolean;
}

export class PiSandbox {
  private static instance: PiSandbox;
  private policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY;

  private constructor() {}

  public static getInstance(): PiSandbox {
    if (!PiSandbox.instance) {
      PiSandbox.instance = new PiSandbox();
    }
    return PiSandbox.instance;
  }

  /**
   * 净化工具调用的环境变量，防止恶意脚本向外部逃逸敏感 API Key
   */
  public sanitizeEnvironment(env: Record<string, string>): Record<string, string> {
    if (!this.policy.enableEnvironmentSanitization) return { ...env };
    const cleanEnv = { ...env };
    for (const key of this.policy.sanitizedEnvVars) {
      delete cleanEnv[key];
    }
    return cleanEnv;
  }

  /**
   * 沙箱核心审查：对工具及 Shell 指令进行极速安全校验
   */
  public inspectToolCall(toolName: string, args: any): SandboxInspectionResult {
    // 1. Shell 指令高危拦截
    if (toolName === "bash" || toolName === "run_command") {
      const cmdStr = (args?.command || args?.CommandLine || "").trim();
      for (const pattern of this.policy.blockedCommandPatterns) {
        if (pattern.test(cmdStr)) {
          return {
            allowed: false,
            isDangerous: true,
            reason: `[Pi-Sandbox] 拦截到高危系统破坏性指令: "${cmdStr}"。保护宿主机绝对安全。`,
          };
        }
      }
    }

    // 2. 物理目录边界过滤（防止跨系统根目录毁灭性写文件）
    if (toolName === "write" || toolName === "edit") {
      const filePath = (args?.filePath || args?.path || "").trim();
      if (filePath.startsWith("/etc/") || filePath.startsWith("/System/") || filePath.startsWith("/usr/bin/")) {
        return {
          allowed: false,
          isDangerous: true,
          reason: `[Pi-Sandbox] 禁止修改 macOS / Linux 系统底层关键配置: "${filePath}"`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 诊断当前宿主机环境支持的沙箱模式
   */
  public async getSandboxCapabilities(): Promise<{
    denoPermissionGate: boolean;
    pathBoundaryProtection: boolean;
    dockerAvailable: boolean;
  }> {
    let dockerAvailable = false;
    try {
      const cmd = new Deno.Command("docker", { args: ["--version"], stdout: "null", stderr: "null" });
      const r = await cmd.output();
      dockerAvailable = r.code === 0;
    } catch {
      dockerAvailable = false;
    }

    return {
      denoPermissionGate: true,
      pathBoundaryProtection: true,
      dockerAvailable,
    };
  }
}
