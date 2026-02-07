import path from "node:path";
import type { AppConfig } from "../../../config";
import type {
  CodeProject,
  HealthStatus,
  ICodeExecutor,
  PluginConfig,
  TaskCallbacks,
  TaskProgress,
  TaskResult,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import type { CodeTaskRepository } from "../../database/sqlite/code-tasks";
import type { ProjectRepository } from "../../database/sqlite/projects";
import { parseNdjsonLine } from "../ndjson-parser";
import {
  buildSandboxImage,
  checkDockerAvailable,
  checkImageExists,
  dockerRun,
  getContainerStatus,
  type SandboxConfig,
  startSandboxStack,
  stopSandboxStack,
} from "./manager";

const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export class DockerCodeExecutor implements ICodeExecutor {
  name = "code-executor";
  version = "1.0.0";

  private config!: AppConfig["code_execution"];
  private proxyContainerName!: string;
  private projectRepo!: ProjectRepository;
  private codeTaskRepo!: CodeTaskRepository;
  private runningTasks = new Map<
    string,
    { proc: ReturnType<typeof Bun.spawn>; abort: AbortController }
  >();
  private sandboxConfig!: SandboxConfig;

  setDeps(deps: { projectRepo: ProjectRepository; codeTaskRepo: CodeTaskRepository }): void {
    this.projectRepo = deps.projectRepo;
    this.codeTaskRepo = deps.codeTaskRepo;
  }

  async init(config: PluginConfig): Promise<void> {
    const logger = getLogger();
    const cfg = config as { code_execution: AppConfig["code_execution"] };
    const ce = cfg.code_execution;
    this.config = ce;
    this.proxyContainerName = `${ce.container_name}-proxy`;

    // Check Docker
    if (!(await checkDockerAvailable())) {
      throw new Error("Docker is not available. Install Docker and ensure it's running.");
    }

    // Build sandbox image if not exists
    if (!(await checkImageExists(ce.sandbox_image))) {
      const dockerfilePath = path.resolve(
        new URL("./Dockerfile.sandbox", import.meta.url).pathname,
      );
      const contextDir = path.resolve(new URL("./", import.meta.url).pathname);
      await buildSandboxImage(dockerfilePath, contextDir, ce.sandbox_image);
    }

    // Prepare sandbox config
    this.sandboxConfig = {
      containerName: ce.container_name,
      proxyContainerName: this.proxyContainerName,
      imageName: ce.sandbox_image,
      proxyImage: ce.proxy_image,
      internalNetwork: ce.network.internal_name,
      externalNetwork: ce.network.external_name,
      resources: {
        memory: ce.resources.memory,
        cpus: ce.resources.cpus,
        pidsLimit: ce.resources.pids_limit,
      },
      claudeConfigDir: `${process.env.HOME}/.claude`,
      workspacePath: process.env.WORKSPACE_HOST_PATH || path.resolve("./workspace"),
      workspaceLocalPath: path.resolve("./workspace"),
      dataHostPath: process.env.DATA_HOST_PATH || path.resolve("./data"),
      claudeDataVolume: "justdobot-claude-data",
      allowedDomains: ce.allowed_domains,
      proxyEnv: {
        HTTP_PROXY: `http://${this.proxyContainerName}:3128`,
        HTTPS_PROXY: `http://${this.proxyContainerName}:3128`,
      },
      gitEnv: ce.git.enabled
        ? {
            GIT_USER_NAME: ce.git.user_name,
            GIT_USER_EMAIL: ce.git.user_email,
            GIT_TOKEN: ce.git.token,
          }
        : undefined,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    };

    // Start sandbox stack
    await startSandboxStack(this.sandboxConfig);

    // Recovery: reset stuck projects
    const stuck = this.projectRepo.resetStuckProjects();
    if (stuck > 0) {
      logger.warn({ count: stuck }, "Reset stuck running projects to error");
    }

    logger.info("Code executor initialized");
  }

  // ─── Task Execution ───────────────────────────────────────

  runTaskInBackground(
    projectName: string,
    prompt: string,
    userId: string,
    callbacks: TaskCallbacks,
  ): void {
    const logger = getLogger();

    // Check concurrency limit
    if (this.runningTasks.size >= this.config.max_concurrent_tasks) {
      callbacks.onError(
        `Max ${this.config.max_concurrent_tasks} concurrent task(s). Wait or cancel running task.`,
        projectName,
      );
      return;
    }

    // Fire and forget
    this._executeTask(projectName, prompt, userId, callbacks).catch((err) => {
      logger.error({ err, projectName }, "Background task error");
      callbacks.onError(String(err), projectName);
    });
  }

  private async _executeTask(
    projectName: string,
    prompt: string,
    _userId: string,
    callbacks: TaskCallbacks,
  ): Promise<void> {
    const logger = getLogger();

    // 0. Ensure sandbox container is running
    const containerStatus = await getContainerStatus(this.sandboxConfig.containerName);
    if (containerStatus === "not_found") {
      logger.warn({ projectName }, "Sandbox container gone — recreating full stack");
      await startSandboxStack(this.sandboxConfig);
    } else if (containerStatus === "stopped") {
      logger.warn({ projectName }, "Sandbox stopped — restarting");
      await dockerRun(["start", this.sandboxConfig.containerName]);
    }

    // 0.5. Disk space guard
    const MAX_WORKSPACE_MB = 2048;
    const { stdout: duOut } = await dockerRun([
      "exec",
      this.sandboxConfig.containerName,
      "du",
      "-sm",
      "/workspace/code",
    ]);
    const usedMb = Number.parseInt(duOut.split("\t")[0] ?? "0", 10);
    if (usedMb > MAX_WORKSPACE_MB) {
      throw new Error(
        `Workspace disk usage ${usedMb} MB exceeds ${MAX_WORKSPACE_MB} MB limit. Delete old projects with /project_delete.`,
      );
    }

    // 1. Create project dir
    await dockerRun([
      "exec",
      this.sandboxConfig.containerName,
      "mkdir",
      "-p",
      `/workspace/code/${projectName}`,
    ]);

    // 2. Update status
    this.projectRepo.updateStatus(projectName, "running");

    // 3. Determine if follow-up
    const project = this.projectRepo.getProject(projectName);
    const isFollowUp = Boolean(project?.lastTaskPrompt);

    // 4. Build claude command
    const claudeArgs = [
      "exec",
      "-w",
      `/workspace/code/${projectName}`,
      this.sandboxConfig.containerName,
      "claude",
      "-p",
      prompt,
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      this.config.model,
      "--max-turns",
      String(this.config.max_turns),
    ];
    if (this.config.allowed_tools.length > 0) {
      claudeArgs.push("--allowed-tools", this.config.allowed_tools.join(","));
    }
    if (isFollowUp) {
      claudeArgs.push("--continue");
    }
    if (this.config.append_system_prompt) {
      claudeArgs.push("--append-system-prompt", this.config.append_system_prompt);
    }

    // 5. Spawn process
    const abort = new AbortController();
    const proc = Bun.spawn(["docker", ...claudeArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });
    this.runningTasks.set(projectName, { proc, abort });

    // 6. Timeout
    const timeoutMs = this.config.timeout_minutes * 60 * 1000;
    const timeout = setTimeout(() => {
      logger.warn({ projectName }, "Task timeout — killing");
      abort.abort();
      proc.kill("SIGTERM");
    }, timeoutMs);

    // 7. Parse NDJSON
    const stderrPromise = new Response(proc.stderr).text();
    let lastResult: TaskProgress | null = null;
    let lastProgressTime = 0;
    const PROGRESS_INTERVAL_MS = 10_000;

    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const progress = parseNdjsonLine(line);
          if (!progress) continue;

          if (progress.type === "result") {
            lastResult = progress;
          }

          // Debounced progress to Telegram
          if (progress.type === "assistant" && progress.text) {
            const now = Date.now();
            if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
              lastProgressTime = now;
              await callbacks.onProgress(progress.text.slice(0, 300));
            }
          }
        }
      }

      // Parse remaining buffer
      if (buffer.trim()) {
        const progress = parseNdjsonLine(buffer);
        if (progress?.type === "result") lastResult = progress;
      }
    } finally {
      clearTimeout(timeout);
      this.runningTasks.delete(projectName);
      try {
        proc.kill("SIGTERM");
      } catch {}
      // Kill orphaned claude process inside container
      await dockerRun([
        "exec",
        this.sandboxConfig.containerName,
        "pkill",
        "-f",
        `claude.*${projectName}`,
      ]).catch(() => {});
    }

    // Race with timeout to prevent hanging
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 5000)),
    ]);
    const stderr = await stderrPromise;

    // 8. Build result
    let resultText = lastResult?.text ?? (stderr || `No output (exit code: ${exitCode})`);
    if (exitCode === 137) {
      resultText =
        `Task killed: out of memory (${this.config.resources.memory} limit exceeded). ` +
        "Try reducing project complexity or increasing resources.memory in config.";
    }
    const result: TaskResult = {
      success: lastResult?.isError === false && exitCode === 0,
      resultText,
      durationMs: lastResult?.durationMs ?? 0,
      numTurns: lastResult?.numTurns ?? 0,
      costUsd: lastResult?.costUsd ?? 0,
      exitCode,
    };

    // 9. Save to DB
    if (project?.id) {
      this.codeTaskRepo.logTask(project.id, prompt, result);
      this.projectRepo.updateTaskResult(projectName, result, prompt);
      this.projectRepo.updateStatus(projectName, result.success ? "completed" : "error");
    }

    // 10. Notify
    if (result.success) {
      await callbacks.onComplete(result, projectName);
    } else {
      await callbacks.onError(result.resultText, projectName);
    }
  }

  // ─── Task Management ──────────────────────────────────────

  async cancelTask(projectName: string): Promise<void> {
    const task = this.runningTasks.get(projectName);
    if (task) {
      task.abort.abort();
      try {
        task.proc.kill("SIGTERM");
      } catch {}
      this.runningTasks.delete(projectName);
      // Kill orphaned claude process inside container
      await dockerRun([
        "exec",
        this.sandboxConfig.containerName,
        "pkill",
        "-f",
        `claude.*${projectName}`,
      ]).catch(() => {});
      this.projectRepo.updateStatus(projectName, "active");
    }
  }

  isTaskRunning(projectName: string): boolean {
    return this.runningTasks.has(projectName);
  }

  getRunningTaskCount(): number {
    return this.runningTasks.size;
  }

  // ─── Project Management ───────────────────────────────────

  async createProject(name: string, userId: string): Promise<CodeProject> {
    if (!PROJECT_NAME_RE.test(name)) {
      throw new Error("Invalid project name. Use lowercase letters, digits, hyphens, 2-32 chars.");
    }
    const count = this.projectRepo.getActiveProjectCount(userId);
    if (count >= this.config.max_projects) {
      throw new Error(
        `Max ${this.config.max_projects} projects. Delete old ones with /project_delete.`,
      );
    }
    await dockerRun([
      "exec",
      this.sandboxConfig.containerName,
      "mkdir",
      "-p",
      `/workspace/code/${name}`,
    ]);
    this.projectRepo.createProject(name, userId);
    return this.projectRepo.getProject(name)!;
  }

  async deleteProject(name: string): Promise<void> {
    await this.cancelTask(name);
    await dockerRun([
      "exec",
      this.sandboxConfig.containerName,
      "rm",
      "-rf",
      `/workspace/code/${name}`,
    ]);
    this.projectRepo.markDeleted(name);
  }

  async getProject(name: string): Promise<CodeProject | null> {
    return this.projectRepo.getProject(name);
  }

  async listProjects(userId?: string): Promise<CodeProject[]> {
    return this.projectRepo.listProjects(userId);
  }

  // ─── Credentials ─────────────────────────────────────────

  async pushCredentials(credentialsJson: string): Promise<void> {
    const status = await getContainerStatus(this.sandboxConfig.containerName);
    if (status !== "running") return;

    const proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        "-u",
        "0",
        this.sandboxConfig.containerName,
        "sh",
        "-c",
        "cat > /home/coder/.claude/.credentials.json && chmod 644 /home/coder/.claude/.credentials.json",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    proc.stdin.write(credentialsJson);
    proc.stdin.end();
    await proc.exited;
    getLogger().debug("Sandbox credentials updated");
  }

  // ─── Lifecycle ────────────────────────────────────────────

  private sandboxStopped = false;

  async destroySandbox(): Promise<void> {
    if (this.sandboxStopped) return;
    this.sandboxStopped = true;
    for (const [name] of this.runningTasks) {
      await this.cancelTask(name);
    }
    await stopSandboxStack(this.sandboxConfig.containerName, this.proxyContainerName);
  }

  async destroy(): Promise<void> {
    await this.destroySandbox();
  }

  async healthCheck(): Promise<HealthStatus> {
    const status = await getContainerStatus(this.sandboxConfig.containerName);
    const proxyStatus = await getContainerStatus(this.proxyContainerName);
    const healthy = status === "running" && proxyStatus === "running";
    return {
      healthy,
      message: healthy
        ? `Sandbox: ${status}, Proxy: ${proxyStatus}, Tasks: ${this.runningTasks.size}`
        : `Sandbox: ${status}, Proxy: ${proxyStatus}`,
      lastCheck: new Date(),
    };
  }
}
