import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  acquireJsonDirectoryLock,
  acquireJsonFileLock,
  releaseJsonDirectoryLock,
  releaseJsonFileLock,
} from "./playwright-locks.mjs";
import { command, commandArgs, killProcessTree } from "./playwright-utils.mjs";

const project = process.argv[2];
if (!["e2e", "hosted-auth", "visual"].includes(project)) {
  console.error(
    "Usage: node scripts/run-playwright.mjs <e2e|hosted-auth|visual>",
  );
  process.exit(1);
}

const defaultApiPort = 4300;
const defaultWebPort = 3300;
const defaultFakeGitHubPort = 4399;
const rootDir = path.resolve(import.meta.dirname, "..");
const apiEntry = path.join(rootDir, "apps", "api", "src", "index.ts");
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const webDir = path.join(rootDir, "apps", "web");
const nextCli = path.join(
  webDir,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const safeRunRoots = [
  path.join(rootDir, ".tmp"),
  path.join(rootDir, "output", "playwright"),
  path.join(webDir, ".tmp"),
];
const runId = `${project}-${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const portLockDir = path.join(rootDir, ".tmp", "playwright", "port-locks");
const nextEnvPath = path.join(webDir, "next-env.d.ts");
const nextEnvLockDir = path.join(
  rootDir,
  ".tmp",
  "playwright",
  "next-env.lock",
);
const nextEnvLockToken = randomUUID();
const ownedPortLocks = new Map();
let nextEnvLockOwned = false;
let preservedNextEnvBytes;
const testDbFile = resolveRunPath(
  "TOKSYNC_PLAYWRIGHT_DB_FILE",
  path.join(".tmp", "playwright", runId, "toksync.json"),
);
const configDir = resolveRunPath(
  "TOKSYNC_PLAYWRIGHT_CONFIG_DIR",
  path.join(".tmp", "playwright", runId, "agent-config"),
);
const outputDir = resolveRunPath(
  "TOKSYNC_PLAYWRIGHT_OUTPUT_DIR",
  path.join("output", "playwright", "runs", runId),
);
const nextDistDir = resolveNextDistDir(
  process.env.TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR,
  path.join(".tmp", "playwright", runId, "next"),
);
const nextDistPath = path.resolve(webDir, nextDistDir);
const nextTsconfigFile = `.toksync-playwright-${runId}.json`;
const nextTsconfigPath = path.join(webDir, nextTsconfigFile);
const children = new Set();
let shuttingDown = false;
let launchedServers = false;
let apiPort;
let webPort;
let fakeGitHubPort;
let exitCode = 1;

process.on("SIGINT", () => void exitAfterShutdown(130));
process.on("SIGTERM", () => void exitAfterShutdown(143));

try {
  const runEnv = {
    ...process.env,
    TOKSYNC_API_TOKEN: "",
    TOKSYNC_CONFIG_DIR: configDir,
    TOKSYNC_DB_FILE: testDbFile,
    TOKSYNC_DEV_AUTH: project === "hosted-auth" ? "0" : "1",
    TOKSYNC_DEV_USER: "demo",
    TOKSYNC_PLAYWRIGHT_CONFIG_DIR: configDir,
    TOKSYNC_PLAYWRIGHT_DB_FILE: testDbFile,
    TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR: nextDistDir,
    TOKSYNC_PLAYWRIGHT_OUTPUT_DIR: outputDir,
    TOKSYNC_PLAYWRIGHT_TSCONFIG_PATH: nextTsconfigFile,
    TOKSYNC_SKIP_PLAYWRIGHT_WEBSERVER: "1",
  };
  delete runEnv.PORT;

  await prepareRunPaths();
  await preserveNextEnvForStartup();
  runPnpm(["db:reset"], runEnv);
  runPnpm(["db:seed"], runEnv);

  apiPort = await resolvePort(
    "TOKSYNC_PLAYWRIGHT_API_PORT",
    defaultApiPort,
    new Set(),
  );
  webPort = await resolvePort(
    "TOKSYNC_PLAYWRIGHT_WEB_PORT",
    defaultWebPort,
    new Set([apiPort]),
  );
  fakeGitHubPort = await resolvePort(
    "TOKSYNC_PLAYWRIGHT_FAKE_GITHUB_PORT",
    defaultFakeGitHubPort,
    new Set([apiPort, webPort]),
  );
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const fakeGitHubUrl = `http://127.0.0.1:${fakeGitHubPort}`;
  const baseEnv = {
    ...runEnv,
    API_URL: apiUrl,
    NEXT_PUBLIC_API_URL: apiUrl,
    APP_URL: webUrl,
    GITHUB_AUTHORIZE_URL: `${fakeGitHubUrl}/login/oauth/authorize`,
    GITHUB_CLIENT_ID: "playwright-client",
    GITHUB_CLIENT_SECRET: "playwright-secret",
    GITHUB_EMAILS_URL: `${fakeGitHubUrl}/user/emails`,
    GITHUB_REDIRECT_URI: `${apiUrl}/v1/auth/github/callback`,
    GITHUB_OAUTH_SUCCESS_REDIRECT: `${webUrl}/app`,
    GITHUB_TOKEN_URL: `${fakeGitHubUrl}/login/oauth/access_token`,
    GITHUB_USER_URL: `${fakeGitHubUrl}/user`,
    PLAYWRIGHT_WEB_PORT: String(webPort),
    TOKSYNC_API_URL: apiUrl,
    TOKSYNC_PLAYWRIGHT_API_PORT: String(apiPort),
    TOKSYNC_PLAYWRIGHT_FAKE_GITHUB_PORT: String(fakeGitHubPort),
    TOKSYNC_PLAYWRIGHT_WEB_PORT: String(webPort),
  };
  const apiEnv = { ...baseEnv, PORT: String(apiPort) };
  const webEnv = { ...baseEnv, PORT: String(webPort) };

  console.log(
    `Playwright ${project} run: API ${apiUrl}, web ${webUrl}, data ${path.relative(rootDir, testDbFile)}`,
  );

  launchedServers = true;
  const apiChild = spawnNode([tsxCli, apiEntry], apiEnv);
  const webChild = spawnNode(
    [nextCli, "dev", "-p", String(webPort)],
    webEnv,
    webDir,
  );

  await waitForUrl(`${apiUrl}/health`, apiChild, "API");
  await waitForUrl(webUrl, webChild, "web");
  await restoreNextEnvAfterStartup();

  const result = spawnPnpm(
    ["exec", "playwright", "test", `--project=${project}`],
    baseEnv,
  );
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await shutdown();
}

process.exit(exitCode);

function runPnpm(args, env) {
  const result = spawnPnpm(args, env);
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed`);
  }
}

function spawnNode(args, env, cwd = rootDir) {
  const child = spawn(process.execPath, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.on("error", (error) => {
    throw error;
  });
  return child;
}

function spawnPnpm(args, env) {
  return spawnSync(command(), commandArgs(["pnpm", ...args]), {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

async function waitForUrl(url, child, label) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Playwright ${label} server exited before becoming ready at ${url}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (child.exitCode === null && child.signalCode === null) return;
        throw new Error(
          `Playwright ${label} server exited during startup at ${url}`,
        );
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${url}${lastError ? `: ${lastError}` : ""}`,
  );
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const runningChildren = [...children];
  for (const child of runningChildren) {
    killProcessTree(child.pid);
  }
  await waitForChildrenToExit(runningChildren, 5_000);
  for (const child of runningChildren) {
    killProcessTree(child.pid);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await waitForChildrenToExit(runningChildren, 5_000);
  if (launchedServers) {
    await waitForPortsToClose([apiPort, webPort, fakeGitHubPort]);
  }
  await releasePortLocks();
  await restoreNextEnvDuringShutdown();
  await fs.rm(nextTsconfigPath, { force: true });
}

async function preserveNextEnvForStartup() {
  await acquireNextEnvLock();
  preservedNextEnvBytes = await fs.readFile(nextEnvPath);
}

async function restoreNextEnvAfterStartup() {
  try {
    await restorePreservedNextEnv();
  } finally {
    await releaseNextEnvLock();
  }
}

async function restoreNextEnvDuringShutdown() {
  if (!preservedNextEnvBytes) {
    await releaseNextEnvLock();
    return;
  }
  const acquiredForShutdown = !nextEnvLockOwned;
  if (acquiredForShutdown) await acquireNextEnvLock();
  try {
    await restorePreservedNextEnv();
  } finally {
    await releaseNextEnvLock();
  }
}

async function restorePreservedNextEnv() {
  if (!preservedNextEnvBytes) return;
  await fs.writeFile(nextEnvPath, preservedNextEnvBytes);
}

async function acquireNextEnvLock() {
  if (nextEnvLockOwned) return;
  await acquireJsonDirectoryLock(
    nextEnvLockDir,
    {
      pid: process.pid,
      runId,
      token: nextEnvLockToken,
      createdAt: new Date().toISOString(),
    },
    {
      timeoutMessage: "Timed out waiting for Playwright next-env.d.ts lock",
    },
  );
  nextEnvLockOwned = true;
}

async function releaseNextEnvLock() {
  if (!nextEnvLockOwned) return;
  await releaseJsonDirectoryLock({
    lockDir: nextEnvLockDir,
    token: nextEnvLockToken,
  });
  nextEnvLockOwned = false;
}

function waitForChildrenToExit(childrenToWaitFor, timeoutMs) {
  if (childrenToWaitFor.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = childrenToWaitFor.length;
    const timer = setTimeout(resolve, timeoutMs);
    for (const child of childrenToWaitFor) {
      if (child.exitCode !== null || child.signalCode !== null) {
        remaining -= 1;
        continue;
      }
      child.once("exit", () => {
        remaining -= 1;
        if (remaining === 0) {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    if (remaining === 0) {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function waitForPortsToClose(ports) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const openPorts = [];
    for (const port of ports) {
      if (await canConnect(port)) openPorts.push(port);
    }
    if (openPorts.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn(
    `Timed out waiting for Playwright ports to close: ${ports.join(", ")}`,
  );
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function resolvePort(envName, fallbackPort, excludedPorts) {
  const configured = process.env[envName]?.trim();
  const port = configured ? parsePort(configured, envName) : fallbackPort;
  const reservation = excludedPorts.has(port)
    ? null
    : await reservePort(port, envName);
  if (reservation) {
    if (await isPortFree(port)) return port;
    await releasePortLock(reservation);
  }
  if (configured) {
    throw new Error(`${envName}=${port} is already in use`);
  }
  const availablePort = await findAvailablePort(envName, excludedPorts);
  console.warn(
    `Default Playwright port ${port} is unavailable; using ${availablePort} for ${envName}.`,
  );
  return availablePort;
}

function parsePort(value, envName) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${envName} must be an integer between 1 and 65535`);
  }
  return port;
}

async function findAvailablePort(envName, excludedPorts) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await ephemeralPort();
    if (excludedPorts.has(port)) continue;
    const reservation = await reservePort(port, envName);
    if (!reservation) continue;
    if (await isPortFree(port)) {
      return port;
    }
    await releasePortLock(reservation);
  }
  throw new Error("Could not allocate a distinct Playwright port");
}

async function reservePort(port, envName) {
  const lockPath = path.join(portLockDir, `${port}.lock`);
  const token = randomUUID();
  const lock = await acquireJsonFileLock(lockPath, {
    envName,
    pid: process.pid,
    port,
    runId,
    token,
    createdAt: new Date().toISOString(),
  });
  if (!lock) return null;
  const reservation = { lockPath, port, token };
  ownedPortLocks.set(lockPath, reservation);
  return reservation;
}

async function releasePortLocks() {
  const reservations = [...ownedPortLocks.values()];
  for (const reservation of reservations) {
    await releasePortLock(reservation);
  }
}

async function releasePortLock(reservation) {
  ownedPortLocks.delete(reservation.lockPath);
  await releaseJsonFileLock(reservation);
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine an available Playwright port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen({ port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

async function isPortFree(port) {
  return !(await canConnect(port)) && (await isPortAvailable(port));
}

function resolveRunPath(envName, fallbackPath) {
  const configured = process.env[envName]?.trim();
  return path.resolve(rootDir, configured || fallbackPath);
}

async function prepareRunPaths() {
  assertSafeRunPath(testDbFile, "Playwright database file");
  assertSafeRunPath(configDir, "Playwright agent config directory");
  assertSafeRunPath(outputDir, "Playwright output directory");
  assertSafeRunPath(nextDistPath, "Playwright Next.js output directory");
  await fs.rm(testDbFile, { force: true });
  await fs.rm(`${testDbFile}.lock`, { force: true });
  await fs.rm(configDir, { recursive: true, force: true });
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(nextDistPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(testDbFile), { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    nextTsconfigPath,
    `${JSON.stringify({ extends: "./tsconfig.json" }, null, 2)}\n`,
  );
}

function assertSafeRunPath(targetPath, label) {
  const isSafe = safeRunRoots.some((safeRoot) =>
    isNestedPath(safeRoot, targetPath),
  );
  if (!isSafe) {
    throw new Error(
      `${label} must be inside a Playwright .tmp or output directory`,
    );
  }
}

function resolveNextDistDir(configuredPath, fallbackPath) {
  const absolutePath = path.resolve(
    webDir,
    configuredPath?.trim() || fallbackPath,
  );
  const relativePath = path.relative(webDir, absolutePath);
  if (!isNestedPath(webDir, absolutePath)) {
    throw new Error(
      "TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR must stay inside apps/web",
    );
  }
  return relativePath;
}

function isNestedPath(parentPath, targetPath) {
  const relativePath = path.relative(parentPath, targetPath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

async function exitAfterShutdown(code) {
  await shutdown();
  process.exit(code);
}
