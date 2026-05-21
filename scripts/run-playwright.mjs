import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const project = process.argv[2];
if (project !== "e2e" && project !== "visual") {
  console.error("Usage: node scripts/run-playwright.mjs <e2e|visual>");
  process.exit(1);
}

const apiPort = "4300";
const webPort = "3300";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
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
const testDbFile = path.join(rootDir, ".tmp", "playwright-toksync.json");
const children = new Set();

const baseEnv = {
  ...process.env,
  API_URL: apiUrl,
  NEXT_PUBLIC_API_URL: apiUrl,
  APP_URL: webUrl,
  PORT: apiPort,
  TOKSYNC_DB_FILE: testDbFile,
  TOKSYNC_DEV_USER: "demo",
  TOKSYNC_SKIP_PLAYWRIGHT_WEBSERVER: "1",
};

let shuttingDown = false;

let exitCode = 1;

try {
  runPnpm(["db:reset"], baseEnv);
  runPnpm(["db:seed"], baseEnv);

  spawnNode([tsxCli, apiEntry], baseEnv);
  spawnNode([nextCli, "dev", "-p", webPort], baseEnv, webDir);

  await waitForUrl(`${apiUrl}/health`);
  await waitForUrl(webUrl);

  const result = spawnPnpm(
    ["exec", "playwright", "test", `--project=${project}`],
    baseEnv,
    { wait: true },
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
  const result = spawnSync(command(), commandArgs(["pnpm", ...args]), {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
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

function spawnPnpm(args, env, options = {}) {
  if (options.wait) {
    return spawnSync(command(), commandArgs(["pnpm", ...args]), {
      cwd: rootDir,
      env,
      stdio: "inherit",
    });
  }
  const child = spawn(command(), commandArgs(["pnpm", ...args]), {
    cwd: rootDir,
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

async function waitForUrl(url) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${url}${lastError ? `: ${lastError}` : ""}`,
  );
}

function command() {
  return process.platform === "win32" ? "cmd.exe" : "pnpm";
}

function commandArgs(args) {
  if (process.platform !== "win32") return args.slice(1);
  return ["/d", "/s", "/c", args.map(quoteArg).join(" ")];
}

function quoteArg(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const runningChildren = [...children];
  for (const child of runningChildren) {
    child.kill();
  }
  await waitForChildrenToExit(runningChildren, 5_000);
  for (const child of [...children]) {
    killProcessTree(child.pid);
  }
  await waitForChildrenToExit([...children], 5_000);
  await waitForPortsToClose([Number(apiPort), Number(webPort)]);
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

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process already exited.
    }
  }
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

process.on("SIGINT", () => {
  void shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  void shutdown();
  process.exit(143);
});
