import path from "node:path";
import { getLogger } from "../../../core/logger";

const logger = getLogger();

// ─── Docker CLI Wrapper ──────────────────────────────────────────

/** Run a docker CLI command */
export async function dockerRun(
  args: string[],
  options?: { timeoutMs?: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: options?.env ? { ...process.env, ...options.env } : undefined,
  });

  // Read stdout and stderr in PARALLEL (prevents deadlock)
  const stderrPromise = new Response(proc.stderr).text();

  let killed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (options?.timeoutMs) {
    timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
    }, options.timeoutMs);
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await stderrPromise;
  const exitCode = await proc.exited;

  if (timer) clearTimeout(timer);

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: killed ? -1 : exitCode,
  };
}

/** Check Docker availability */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    const { exitCode } = await dockerRun(["info", "--format", "{{.ServerVersion}}"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

/** Check if image exists locally */
export async function checkImageExists(image: string): Promise<boolean> {
  const { exitCode } = await dockerRun(["image", "inspect", image]);
  return exitCode === 0;
}

/** Pre-pull an image so that subsequent build/run commands find it cached.
 *  This avoids TLS issues in Docker Desktop's build proxy. */
export async function pullImage(image: string): Promise<void> {
  if (await checkImageExists(image)) return;
  logger.info({ image }, "Pulling image...");
  const { exitCode } = await dockerRun(["pull", image], { timeoutMs: 300_000 });
  if (exitCode !== 0)
    logger.warn({ image }, "docker pull failed — build may still succeed if cached");
}

/** Build sandbox image from Dockerfile */
export async function buildSandboxImage(
  dockerfilePath: string,
  contextDir: string,
  imageName: string,
): Promise<void> {
  // Pre-pull base image to avoid TLS issues during build
  try {
    const content = await Bun.file(dockerfilePath).text();
    const match = content.match(/^FROM\s+(\S+)/m);
    if (match) await pullImage(match[1]);
  } catch {
    // Non-critical — build may still work with cached image
  }
  logger.info({ imageName }, "Building sandbox image (may take a few minutes)...");
  const { exitCode, stderr } = await dockerRun(
    ["build", "-t", imageName, "-f", dockerfilePath, contextDir],
    { timeoutMs: 600_000, env: { DOCKER_BUILDKIT: "1" } },
  );
  if (exitCode !== 0) throw new Error(`Image build failed: ${stderr}`);
  logger.info({ imageName }, "Sandbox image built");
}

/** Ensure Docker network exists */
export async function ensureNetwork(name: string, internal: boolean): Promise<void> {
  const { exitCode } = await dockerRun(["network", "inspect", name]);
  if (exitCode !== 0) {
    const args = ["network", "create", name, "--driver", "bridge"];
    if (internal) args.push("--internal");
    await dockerRun(args);
    logger.info({ network: name, internal }, "Created Docker network");
  }
}

/** Get container status */
export async function getContainerStatus(
  name: string,
): Promise<"running" | "stopped" | "not_found"> {
  const { exitCode, stdout } = await dockerRun(["inspect", "--format", "{{.State.Running}}", name]);
  if (exitCode !== 0) return "not_found";
  return stdout === "true" ? "running" : "stopped";
}

/** Connect container to network */
export async function connectToNetwork(containerName: string, networkName: string): Promise<void> {
  await dockerRun(["network", "connect", networkName, containerName]);
}

/** Copy files from host to container volume */
export async function copyToContainer(
  containerName: string,
  srcPath: string,
  destPath: string,
): Promise<void> {
  const { exitCode, stderr } = await dockerRun(["cp", srcPath, `${containerName}:${destPath}`]);
  if (exitCode !== 0) {
    logger.warn({ stderr }, "Copy to container failed (may be OK on first run)");
  }
}

// ─── Squid Configuration ────────────────────────────────────────

/** Generate squid.conf content from allowed domains */
export function generateSquidConf(allowedDomains: string[]): string {
  const domainLines = allowedDomains.map((d) => `acl allowed_domains dstdomain ${d}`).join("\n");

  return `http_port 3128

acl localnet src 10.0.0.0/8
acl localnet src 172.16.0.0/12
acl localnet src 192.168.0.0/16
acl SSL_ports port 443
acl Safe_ports port 80 443
acl CONNECT method CONNECT

${domainLines}

http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports
http_access allow localnet allowed_domains
http_access deny all

cache deny all
logfile_rotate 0
access_log none
coredump_dir /var/spool/squid
max_filedescriptors 1024
`;
}

// ─── Sandbox Lifecycle ──────────────────────────────────────────

export interface SandboxConfig {
  containerName: string;
  proxyContainerName: string;
  imageName: string;
  proxyImage: string;
  internalNetwork: string;
  externalNetwork: string;
  resources: { memory: string; cpus: string; pidsLimit: number };
  claudeConfigDir: string;
  /** Host path for Docker volume mounts (Docker-in-Docker) */
  workspacePath: string;
  /** Container-local path for file I/O (may differ from workspacePath in DinD) */
  workspaceLocalPath: string;
  /** Host path for data directory (Docker volume mounts) */
  dataHostPath: string;
  claudeDataVolume: string;
  allowedDomains: string[];
  proxyEnv: { HTTP_PROXY: string; HTTPS_PROXY: string };
  gitEnv?: { GIT_USER_NAME: string; GIT_USER_EMAIL: string; GIT_TOKEN: string };
  anthropicApiKey?: string;
}

/** Full sandbox stack startup */
export async function startSandboxStack(config: SandboxConfig): Promise<void> {
  // 1. Create networks
  await ensureNetwork(config.internalNetwork, true);
  await ensureNetwork(config.externalNetwork, false);

  // 2. Create workspace code dir (use local path for file I/O)
  const codeDir = path.join(config.workspaceLocalPath, "code");
  await Bun.write(path.join(codeDir, ".keep"), "");

  // 3. Create named volume for claude data
  await dockerRun(["volume", "create", config.claudeDataVolume]);

  // 4. Write squid.conf (local path for writing, host path for Docker mount)
  const squidConfLocalPath = path.resolve("./data/sandbox/squid.conf");
  await Bun.write(squidConfLocalPath, generateSquidConf(config.allowedDomains));
  const squidConfHostPath = path.join(config.dataHostPath, "sandbox", "squid.conf");

  // 5. Start proxy container (if not running)
  const proxyStatus = await getContainerStatus(config.proxyContainerName);
  if (proxyStatus === "not_found") {
    await pullImage(config.proxyImage);
    await dockerRun([
      "run",
      "-d",
      "--name",
      config.proxyContainerName,
      "--network",
      config.externalNetwork,
      "--restart",
      "unless-stopped",
      "-v",
      `${squidConfHostPath}:/etc/squid/squid.conf:ro`,
      config.proxyImage,
    ]);
    // Connect proxy to internal network too
    await connectToNetwork(config.proxyContainerName, config.internalNetwork);
    logger.info("Proxy container started");
  } else if (proxyStatus === "stopped") {
    await dockerRun(["start", config.proxyContainerName]);
  }

  // 6. Start sandbox container (if not running)
  const sandboxStatus = await getContainerStatus(config.containerName);
  if (sandboxStatus === "not_found") {
    const envArgs: string[] = [
      "-e",
      `HTTP_PROXY=${config.proxyEnv.HTTP_PROXY}`,
      "-e",
      `HTTPS_PROXY=${config.proxyEnv.HTTPS_PROXY}`,
      "-e",
      `http_proxy=${config.proxyEnv.HTTP_PROXY}`,
      "-e",
      `https_proxy=${config.proxyEnv.HTTPS_PROXY}`,
      "-e",
      "NO_PROXY=localhost,127.0.0.1",
      "-e",
      "CLAUDE_CODE_SKIP_UPDATE_CHECK=1",
      "-e",
      "NODE_OPTIONS=--require global-agent/bootstrap",
      "-e",
      `GLOBAL_AGENT_HTTP_PROXY=${config.proxyEnv.HTTP_PROXY}`,
      "-e",
      `GLOBAL_AGENT_HTTPS_PROXY=${config.proxyEnv.HTTPS_PROXY}`,
    ];
    if (config.anthropicApiKey) {
      envArgs.push("-e", `ANTHROPIC_API_KEY=${config.anthropicApiKey}`);
    }
    if (config.gitEnv) {
      envArgs.push(
        "-e",
        `GIT_USER_NAME=${config.gitEnv.GIT_USER_NAME}`,
        "-e",
        `GIT_USER_EMAIL=${config.gitEnv.GIT_USER_EMAIL}`,
        "-e",
        `GIT_TOKEN=${config.gitEnv.GIT_TOKEN}`,
      );
    }

    await dockerRun([
      "run",
      "-d",
      "--name",
      config.containerName,
      "--network",
      config.internalNetwork,
      // Security
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      String(config.resources.pidsLimit),
      "--read-only",
      "--tmpfs",
      "/tmp:size=1g",
      "--tmpfs",
      "/home/coder:size=512m,uid=1000,gid=1000",
      // Resources
      "--memory",
      config.resources.memory,
      "--cpus",
      config.resources.cpus,
      // Volumes
      "-v",
      `${config.workspacePath}:/workspace`,
      "-v",
      `${config.claudeDataVolume}:/home/coder/.claude`,
      // User
      "--user",
      "1000:1000",
      "--workdir",
      "/workspace",
      // Env
      ...envArgs,
      config.imageName,
    ]);
    logger.info("Sandbox container started");
  } else if (sandboxStatus === "stopped") {
    await dockerRun(["start", config.containerName]);
  }

  // 7. Fix claude data volume ownership (named volume initializes as root)
  await dockerRun([
    "exec",
    "-u",
    "0",
    config.containerName,
    "chown",
    "1000:1000",
    "/home/coder/.claude",
  ]);

  // 8. Always copy fresh credentials (token may have been refreshed since last start)
  if (!config.anthropicApiKey) {
    const credPath = path.join(config.claudeConfigDir, ".credentials.json");
    const credContent = await Bun.file(credPath).text();
    const writeProc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        "-u",
        "0",
        config.containerName,
        "sh",
        "-c",
        "cat > /home/coder/.claude/.credentials.json && chmod 644 /home/coder/.claude/.credentials.json",
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    writeProc.stdin.write(credContent);
    writeProc.stdin.end();
    await writeProc.exited;
    logger.info("Credentials copied to sandbox");
  } else {
    logger.info("Using ANTHROPIC_API_KEY — skipping credential copy");
  }

  // 9. Verify Claude Code is accessible (unset NODE_OPTIONS to avoid global-agent preload)
  const { exitCode } = await dockerRun([
    "exec",
    "-e",
    "NODE_OPTIONS=",
    config.containerName,
    "claude",
    "--version",
  ]);
  if (exitCode !== 0) {
    throw new Error("Claude Code CLI not available in sandbox container");
  }
}

/** Stop sandbox stack */
export async function stopSandboxStack(
  containerName: string,
  proxyContainerName: string,
): Promise<void> {
  await dockerRun(["stop", containerName]);
  await dockerRun(["stop", proxyContainerName]);
  logger.info("Sandbox stack stopped");
}

/** Destroy sandbox stack completely */
export async function destroySandboxStack(
  containerName: string,
  proxyContainerName: string,
  internalNetwork: string,
  externalNetwork: string,
): Promise<void> {
  await dockerRun(["rm", "-f", containerName]);
  await dockerRun(["rm", "-f", proxyContainerName]);
  try {
    await dockerRun(["network", "rm", internalNetwork]);
  } catch {}
  try {
    await dockerRun(["network", "rm", externalNetwork]);
  } catch {}
  logger.info("Sandbox stack destroyed");
}
