import { spawn, spawnSync } from "node:child_process";

const mode = process.argv[2];

if (mode !== "api" && mode !== "web") {
  console.error("Usage: node scripts/playwright-web-server.mjs <api|web>");
  process.exit(1);
}

const useCmd = process.platform === "win32";
const children = new Set();

function runSync(args) {
  const result = spawnSync(command(), commandArgs(args), {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function spawnLongRunning(args) {
  const child = spawn(command(), commandArgs(args), {
    detached: process.platform !== "win32",
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsVerbatimArguments: false,
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) process.exit(code ?? (signal ? 1 : 0));
  });
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

function command() {
  return useCmd ? "cmd.exe" : "pnpm";
}

function commandArgs(args) {
  return useCmd ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")] : args;
}

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killProcessTree(child.pid);
  }
  setTimeout(() => process.exit(0), 250).unref();
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("exit", shutdown);

if (mode === "api") {
  runSync(["db:reset"]);
  runSync(["db:seed"]);
  spawnLongRunning(["--filter", "@toksync/api", "start"]);
} else {
  spawnLongRunning([
    "--filter",
    "@toksync/web",
    "exec",
    "next",
    "dev",
    "-p",
    process.env.PLAYWRIGHT_WEB_PORT || "3300",
  ]);
}
