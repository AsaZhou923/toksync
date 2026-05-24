import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDotEnvPath, loadDotEnvIfPresent } from "./env";

const envKeys = [
  "TOKSYNC_DEV_AUTH",
  "TOKSYNC_DEV_USER",
  "TOKSYNC_DB_FILE",
  "TOKSYNC_DB_BASE_DIR",
] as const;
const previousEnv = new Map<string, string | undefined>();

describe("API env loading", () => {
  afterEach(() => {
    for (const key of envKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    previousEnv.clear();
  });

  it("loads the repo-level .env from a package working directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "toksync-env-"));
    const packageDir = path.join(root, "apps", "api");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, ".env"),
      "TOKSYNC_DEV_AUTH=1\nTOKSYNC_DEV_USER=demo\nTOKSYNC_DB_FILE=.tmp/toksync-dev.json\n",
    );

    rememberEnv();
    delete process.env.TOKSYNC_DEV_AUTH;
    delete process.env.TOKSYNC_DEV_USER;
    delete process.env.TOKSYNC_DB_FILE;
    delete process.env.TOKSYNC_DB_BASE_DIR;

    expect(findDotEnvPath(packageDir)).toBe(path.join(root, ".env"));

    loadDotEnvIfPresent(packageDir);

    expect(process.env.TOKSYNC_DEV_AUTH).toBe("1");
    expect(process.env.TOKSYNC_DEV_USER).toBe("demo");
    expect(process.env.TOKSYNC_DB_BASE_DIR).toBe(root);
    expect(process.env.TOKSYNC_DB_FILE).toBe(
      path.join(root, ".tmp", "toksync-dev.json"),
    );
  });
});

function rememberEnv() {
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
}
