import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Base64Url } from "@toksync/privacy";

export interface AgentConfig {
  apiUrl: string;
  deviceId?: string;
  deviceToken?: string;
  deviceName?: string;
  platform?: "windows" | "macos" | "linux";
  username?: string;
  deviceSeed: string;
}

export function configDir() {
  return (
    process.env.TOKSYNC_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "toksync")
  );
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): AgentConfig {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return {
      apiUrl:
        process.env.TOKSYNC_API_URL ||
        process.env.API_URL ||
        "http://localhost:4000",
      deviceSeed: randomBytes(32).toString("base64url"),
    };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AgentConfig;
  return {
    ...parsed,
    apiUrl:
      process.env.TOKSYNC_API_URL || parsed.apiUrl || "http://localhost:4000",
    deviceSeed: parsed.deviceSeed || randomBytes(32).toString("base64url"),
  };
}

export function saveConfig(config: AgentConfig) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function clearAuth(config: AgentConfig) {
  const next = { ...config };
  delete next.deviceId;
  delete next.deviceToken;
  delete next.username;
  saveConfig(next);
}

export function deviceFingerprint(config: AgentConfig) {
  return sha256Base64Url(`toksync-device-v1\0${config.deviceSeed}`);
}

export function currentPlatform(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}
