import { spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
const PNPM_RUNNER =
  process.env.TOKSYNC_PLAYWRIGHT_PNPM_RUNNER ?? (IS_WIN ? "corepack" : "pnpm");

export function command() {
  if (IS_WIN) return "cmd.exe";
  return PNPM_RUNNER === "corepack" ? "corepack" : "pnpm";
}

export function commandArgs(args) {
  // args already includes "pnpm" as the first element (e.g. ["pnpm", "exec", "playwright", ...])
  // On Unix: strip "pnpm", pass the rest to pnpm/corepack directly
  // On Windows: wrap the whole thing in cmd.exe
  const commandLine = normalizePnpmArgs(args);
  if (!IS_WIN) {
    return PNPM_RUNNER === "corepack" && args[0] === "pnpm"
      ? ["pnpm", ...args.slice(1)]
      : commandLine.slice(1);
  }
  return ["/d", "/s", "/c", commandLine.map(quoteArg).join(" ")];
}

function normalizePnpmArgs(args) {
  if (args[0] !== "pnpm" || PNPM_RUNNER !== "corepack") return args;
  return ["corepack", "pnpm", ...args.slice(1)];
}

export function quoteArg(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}

export function killProcessTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
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
