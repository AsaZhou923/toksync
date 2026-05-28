import { spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";

export function command() {
  return IS_WIN ? "cmd.exe" : "pnpm";
}

export function commandArgs(args) {
  // args already includes "pnpm" as the first element (e.g. ["pnpm", "exec", "playwright", ...])
  // On Unix: strip "pnpm", pass the rest to pnpm directly
  // On Windows: wrap the whole thing in cmd.exe
  if (!IS_WIN) return args.slice(1);
  return ["/d", "/s", "/c", args.map(quoteArg).join(" ")];
}

export function quoteArg(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}

export function killProcessTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
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
