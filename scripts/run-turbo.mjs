import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const shimDir = path.join(rootDir, ".tmp", "corepack-pnpm-shim");
const isWindows = process.platform === "win32";

mkdirSync(shimDir, { recursive: true });
if (isWindows) {
  writeFileSync(
    path.join(shimDir, "pnpm.cmd"),
    "@echo off\r\ncorepack pnpm %*\r\n",
  );
} else {
  writeFileSync(
    path.join(shimDir, "pnpm"),
    '#!/bin/sh\nexec corepack pnpm "$@"\n',
    {
      mode: 0o755,
    },
  );
}

const pathKey =
  Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
  "PATH";
const env = {
  ...process.env,
  [pathKey]: `${shimDir}${path.delimiter}${process.env[pathKey] ?? ""}`,
};
const turboArgs = process.argv.slice(2);
const commandLine = ["corepack", "pnpm", "exec", "turbo", ...turboArgs];
const result = isWindows
  ? spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine.map(quote).join(" ")], {
      cwd: rootDir,
      env,
      stdio: "inherit",
    })
  : spawnSync("corepack", ["pnpm", "exec", "turbo", ...turboArgs], {
      cwd: rootDir,
      env,
      stdio: "inherit",
    });

process.exit(result.status ?? 1);

function quote(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value;
}
