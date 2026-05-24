import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTokSyncDbFilePath } from "./store";

describe("FileTokSyncStore path resolution", () => {
  it("resolves relative TOKSYNC_DB_FILE from the configured base directory", () => {
    expect(
      defaultTokSyncDbFilePathForTest({
        TOKSYNC_DB_FILE: ".tmp/toksync-dev.json",
        TOKSYNC_DB_BASE_DIR: path.join("E:", "Project Code", "toksync"),
      }),
    ).toBe(
      path.resolve(
        path.join("E:", "Project Code", "toksync"),
        ".tmp",
        "toksync-dev.json",
      ),
    );
  });

  it("falls back to INIT_CWD for unconfigured development stores", () => {
    expect(
      defaultTokSyncDbFilePathForTest({
        INIT_CWD: path.join("E:", "Project Code", "toksync"),
      }),
    ).toBe(
      path.resolve(
        path.join("E:", "Project Code", "toksync"),
        ".tmp",
        "toksync-dev.json",
      ),
    );
  });
});

function defaultTokSyncDbFilePathForTest(
  env: Partial<NodeJS.ProcessEnv>,
): string {
  const previous = {
    TOKSYNC_DB_FILE: process.env.TOKSYNC_DB_FILE,
    TOKSYNC_DB_BASE_DIR: process.env.TOKSYNC_DB_BASE_DIR,
    INIT_CWD: process.env.INIT_CWD,
  };
  try {
    delete process.env.TOKSYNC_DB_FILE;
    delete process.env.TOKSYNC_DB_BASE_DIR;
    delete process.env.INIT_CWD;
    Object.assign(process.env, env);
    return defaultTokSyncDbFilePath();
  } finally {
    restoreEnv("TOKSYNC_DB_FILE", previous.TOKSYNC_DB_FILE);
    restoreEnv("TOKSYNC_DB_BASE_DIR", previous.TOKSYNC_DB_BASE_DIR);
    restoreEnv("INIT_CWD", previous.INIT_CWD);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
