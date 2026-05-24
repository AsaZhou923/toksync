import fs from "node:fs";
import path from "node:path";

export function loadDotEnvIfPresent(
  startDir = process.env.INIT_CWD || process.cwd(),
) {
  const envPath = findDotEnvPath(startDir);
  if (!envPath) return;
  const envDir = path.dirname(envPath);
  process.env.TOKSYNC_DB_BASE_DIR ??= envDir;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const value =
      key === "TOKSYNC_DB_FILE" && rawValue && !path.isAbsolute(rawValue)
        ? path.resolve(envDir, rawValue)
        : rawValue;
    process.env[key] ??= value;
  }
}

export function findDotEnvPath(startDir: string) {
  let cursor = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(cursor, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
