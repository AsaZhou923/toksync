import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
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

interface EncryptedConfigSecret {
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  keyRef: "local-config-key-v1";
  iv: string;
  authTag: string;
  ciphertext: string;
}

type StoredAgentConfig = Omit<AgentConfig, "deviceToken"> & {
  deviceToken?: string;
  deviceTokenEncrypted?: EncryptedConfigSecret;
};

export function configDir() {
  return (
    process.env.TOKSYNC_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "toksync")
  );
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

export function configKeyPath() {
  return path.join(configDir(), "config.key");
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
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredAgentConfig;
  const {
    deviceToken: legacyDeviceToken,
    deviceTokenEncrypted,
    ...rest
  } = parsed;
  const deviceToken = deviceTokenEncrypted
    ? decryptConfigSecret(deviceTokenEncrypted)
    : legacyDeviceToken;
  return {
    ...rest,
    ...(deviceToken ? { deviceToken } : {}),
    apiUrl:
      process.env.TOKSYNC_API_URL || parsed.apiUrl || "http://localhost:4000",
    deviceSeed: parsed.deviceSeed || randomBytes(32).toString("base64url"),
  };
}

export function saveConfig(config: AgentConfig) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodBestEffort(dir, 0o700);
  const file = configPath();
  const { deviceToken, ...storedConfig } = config;
  const stored: StoredAgentConfig = {
    ...storedConfig,
    ...(deviceToken
      ? { deviceTokenEncrypted: encryptConfigSecret(deviceToken) }
      : {}),
  };
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodBestEffort(file, 0o600);
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

function chmodBestEffort(file: string, mode: number) {
  try {
    fs.chmodSync(file, mode);
  } catch {
    // Windows and locked-down filesystems may ignore POSIX-style mode changes.
  }
}

function encryptConfigSecret(value: string): EncryptedConfigSecret {
  const key = configEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    schemaVersion: 1,
    algorithm: "aes-256-gcm",
    keyRef: "local-config-key-v1",
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptConfigSecret(secret: EncryptedConfigSecret) {
  try {
    const decipher = createDecipheriv(
      secret.algorithm,
      configEncryptionKey(),
      Buffer.from(secret.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new Error(
      `Could not decrypt TokSync device token from local config: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function configEncryptionKey() {
  const envKey = process.env.TOKSYNC_CONFIG_ENCRYPTION_KEY;
  if (envKey) return normalizeConfigKey(envKey);

  const keyFile = configKeyPath();
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    chmodBestEffort(path.dirname(keyFile), 0o700);
    fs.writeFileSync(keyFile, `${randomBytes(32).toString("base64url")}\n`, {
      mode: 0o600,
    });
    chmodBestEffort(keyFile, 0o600);
  }
  return normalizeConfigKey(fs.readFileSync(keyFile, "utf8").trim());
}

function normalizeConfigKey(value: string) {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(value).digest();
}
