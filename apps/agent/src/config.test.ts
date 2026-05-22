import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configKeyPath,
  configPath,
  loadConfig,
  saveConfig,
  type AgentConfig,
} from "./config";

describe("agent config persistence", () => {
  const previousConfigDir = process.env.TOKSYNC_CONFIG_DIR;
  const previousConfigKey = process.env.TOKSYNC_CONFIG_ENCRYPTION_KEY;
  let tempDir: string | null = null;

  afterEach(() => {
    if (previousConfigDir === undefined) {
      delete process.env.TOKSYNC_CONFIG_DIR;
    } else {
      process.env.TOKSYNC_CONFIG_DIR = previousConfigDir;
    }
    if (previousConfigKey === undefined) {
      delete process.env.TOKSYNC_CONFIG_ENCRYPTION_KEY;
    } else {
      process.env.TOKSYNC_CONFIG_ENCRYPTION_KEY = previousConfigKey;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function useTempConfigDir() {
    tempDir = mkdtempSync(path.join(tmpdir(), "toksync-agent-config-"));
    process.env.TOKSYNC_CONFIG_DIR = tempDir;
    return tempDir;
  }

  it("encrypts device tokens on disk and decrypts them on load", () => {
    useTempConfigDir();
    const config: AgentConfig = {
      apiUrl: "http://localhost:4000",
      deviceId: "device-1",
      deviceToken: "tsd_secret-device-token",
      deviceSeed: "seed-1",
      username: "demo",
    };

    saveConfig(config);

    const raw = readFileSync(configPath(), "utf8");
    expect(raw).not.toContain("tsd_secret-device-token");
    expect(raw).toContain("deviceTokenEncrypted");
    expect(readFileSync(configKeyPath(), "utf8").trim()).not.toHaveLength(0);
    expect(loadConfig()).toMatchObject(config);
  });

  it("migrates legacy plaintext device tokens on the next save", () => {
    useTempConfigDir();
    writeFileSync(
      configPath(),
      JSON.stringify({
        apiUrl: "http://localhost:4000",
        deviceId: "legacy-device",
        deviceToken: "tsd_legacy-token",
        deviceSeed: "legacy-seed",
      }),
    );

    const loaded = loadConfig();
    expect(loaded.deviceToken).toBe("tsd_legacy-token");
    saveConfig(loaded);

    const raw = readFileSync(configPath(), "utf8");
    expect(raw).not.toContain("tsd_legacy-token");
    expect(raw).toContain("deviceTokenEncrypted");
  });
});
