import { spawn, spawnSync } from "node:child_process";
import { command, commandArgs, killProcessTree } from "./playwright-utils.mjs";

const mode = process.argv[2];

if (mode !== "api" && mode !== "web") {
  console.error("Usage: node scripts/playwright-web-server.mjs <api|web>");
  process.exit(1);
}

const children = new Set();

function runSync(args) {
  // args: ["pnpm", "db:reset"] etc.
  const result = spawnSync(command(), commandArgs(args), {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function spawnLongRunning(args) {
  // args: ["pnpm", "--filter", "@toksync/api", "start"] etc.
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

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killProcessTree(child.pid);
  }
  setTimeout(() => process.exit(0), 250).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("exit", shutdown);

if (mode === "api") {
  runSync(["pnpm", "db:reset"]);
  runSync(["pnpm", "db:seed"]);
  spawnLongRunning(["pnpm", "--filter", "@toksync/api", "start"]);
} else {
  spawnLongRunning([
    "pnpm",
    "--filter",
    "@toksync/web",
    "exec",
    "next",
    "dev",
    "-p",
    process.env.PLAYWRIGHT_WEB_PORT || "3300",
  ]);
}
