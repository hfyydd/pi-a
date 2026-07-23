// src/infra/sidecar_manager.ts
// Sidecar 进程生命周期管理器。对标 WorkBuddy 的 sidecar-entry.js 基础设施。
//
// 职责：
//   1. 自动拉起/管理独立的 Deno Sidecar 子进程 (src/agent/sidecar.ts)
//   2. 维护 8MB 环形日志缓冲区 (RingBuffer)，捕获 stderr/stdout 供异常恢复与诊断
//   3. 崩溃感知与无感自动复活 (Auto-Restart)
//   4. 端口就绪探针 (Health Check)

export class RingBuffer {
  private buffer: string[] = [];
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  push(line: string) {
    this.buffer.push(line);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getLogs(): string {
    return this.buffer.join("\n");
  }
}

export class SidecarManager {
  private static instance: SidecarManager | null = null;
  private childProcess: Deno.ChildProcess | null = null;
  private port = 8899;
  private ringBuffer = new RingBuffer(300);
  private isShuttingDown = false;
  private ready = false;

  private constructor() {}

  static getInstance(): SidecarManager {
    if (!SidecarManager.instance) {
      SidecarManager.instance = new SidecarManager();
    }
    return SidecarManager.instance;
  }

  getPort(): number {
    return this.port;
  }

  isReady(): boolean {
    return this.ready;
  }

  getLogs(): string {
    return this.ringBuffer.getLogs();
  }

  /**
   * 启动/确保 Sidecar 进程就绪
   */
  async start(): Promise<boolean> {
    if (this.childProcess && this.ready) {
      return true;
    }

    console.log(`[SidecarManager] 正在启动 Agent Sidecar 独立进程 (端口: ${this.port})...`);
    this.isShuttingDown = false;

    try {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          "src/agent/sidecar.ts",
          "--port",
          String(this.port),
        ],
        stdout: "piped",
        stderr: "piped",
        env: {
          ...Deno.env.toObject(),
          SIDECAR_PORT: String(this.port),
        },
      });

      this.childProcess = command.spawn();

      // 捕获 stdout
      (async () => {
        if (!this.childProcess?.stdout) return;
        const reader = this.childProcess.stdout.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            text.split("\n").forEach((line) => {
              if (line.trim()) this.ringBuffer.push(`[stdout] ${line}`);
            });
          }
        } catch {}
      })();

      // 捕获 stderr
      (async () => {
        if (!this.childProcess?.stderr) return;
        const reader = this.childProcess.stderr.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            text.split("\n").forEach((line) => {
              if (line.trim()) this.ringBuffer.push(`[stderr] ${line}`);
            });
          }
        } catch {}
      })();

      // 监视子进程退出与自愈
      this.childProcess.status.then((status) => {
        console.warn(`[SidecarManager] Sidecar 进程已退出，退出码: ${status.code}`);
        this.ready = false;
        this.childProcess = null;

        if (!this.isShuttingDown) {
          console.log("[SidecarManager] 检测到 Sidecar 异常退出，正在触发瞬间自愈复活机制...");
          setTimeout(() => this.start(), 1000);
        }
      });

      // 探针校验端口就绪
      const ready = await this.pollHealth(15, 300);
      if (ready) {
        this.ready = true;
        console.log(`[SidecarManager] Agent Sidecar 进程启动成功，端口: ${this.port}`);
        return true;
      } else {
        console.warn("[SidecarManager] Sidecar 探针超时，降级为内置模组");
        return false;
      }
    } catch (e) {
      console.error("[SidecarManager] 启动 Sidecar 子进程失败:", e);
      return false;
    }
  }

  /**
   * 健康检查轮询
   */
  private async pollHealth(retries = 10, delayMs = 200): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "ok") return true;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  /**
   * 关闭 Sidecar 进程
   */
  stop(): void {
    this.isShuttingDown = true;
    if (this.childProcess) {
      try {
        this.childProcess.kill("SIGTERM");
      } catch {}
      this.childProcess = null;
    }
    this.ready = false;
    console.log("[SidecarManager] Sidecar 进程已被关闭");
  }
}
