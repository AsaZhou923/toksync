import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  apiError,
  usageEventV1Schema,
  vaultEncryptedPayloadSchema,
  type UsageEventV1,
  type VaultEncryptedPayload,
} from "@toksync/shared";
import { assertMetricsOnlyPayload, sha256Base64Url } from "@toksync/privacy";
import type {
  BreakdownRow,
  DeviceRecord,
  PublicProfileStatsRecord,
  StoredUsageEvent,
  TokSyncData,
  VaultExportRecord,
} from "./types";

interface VaultScryptParams {
  N: number;
  r: number;
  p: number;
}

const VAULT_SCRYPT_PARAMS: VaultScryptParams = { N: 65_536, r: 8, p: 1 };

export interface VaultArtifactStore {
  put(params: {
    userId: string;
    exportId: string;
    payload: VaultEncryptedPayload;
  }): string;
  get(storageKey: string): VaultEncryptedPayload | null;
}

export class FileVaultArtifactStore implements VaultArtifactStore {
  constructor(
    public readonly rootDir = process.env.TOKSYNC_VAULT_ARTIFACT_DIR ||
      path.resolve(
        process.env.INIT_CWD || process.cwd(),
        ".tmp",
        "vault-artifacts",
      ),
  ) {}

  put(params: {
    userId: string;
    exportId: string;
    payload: VaultEncryptedPayload;
  }) {
    const storageKey = vaultArtifactStorageKey(params.userId, params.exportId);
    const filePath = this.pathForKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(params.payload)}\n`);
    return storageKey;
  }

  get(storageKey: string) {
    const filePath = this.pathForKey(storageKey);
    if (!fs.existsSync(filePath)) return null;
    const parsed = vaultEncryptedPayloadSchema.safeParse(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  }

  private pathForKey(storageKey: string) {
    if (!/^vault\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.json$/.test(storageKey)) {
      throw new Error("Invalid vault artifact storage key");
    }
    const root = path.resolve(this.rootDir);
    const filePath = path.resolve(root, storageKey);
    const relative = path.relative(root, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Vault artifact key escapes storage root");
    }
    return filePath;
  }
}

export function resolveVaultArtifactStore(): VaultArtifactStore | null {
  return process.env.TOKSYNC_VAULT_ARTIFACT_DIR
    ? new FileVaultArtifactStore(process.env.TOKSYNC_VAULT_ARTIFACT_DIR)
    : null;
}

export function vaultSnapshotEvent(event: StoredUsageEvent): UsageEventV1 {
  return {
    schemaVersion: event.schemaVersion,
    source: event.source,
    sourceSessionId: event.sourceSessionId,
    sourceMessageId: event.sourceMessageId,
    dedupKey: event.dedupKey,
    deviceId: event.deviceId,
    workspaceKeyHash: event.workspaceKeyHash,
    workspaceLabel: event.workspaceLabel,
    agent: event.agent,
    modelId: event.modelId,
    providerId: event.providerId,
    timestampMs: event.timestampMs,
    localDate: event.localDate,
    tokens: event.tokens,
    costUsd: event.costUsd,
    messageCount: event.messageCount,
    isTurnStart: event.isTurnStart,
  };
}

export function encryptVaultPayload(
  snapshot: unknown,
  recoveryPassphrase: string,
  createdAt: string,
): VaultEncryptedPayload {
  const plainText = JSON.stringify(snapshot);
  const iv = randomBytes(12);
  const salt = randomBytes(16);
  const key = deriveVaultKey(recoveryPassphrase, salt, VAULT_SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    format: "toksync-vault-v1",
    schemaVersion: 1,
    createdAt,
    payloadDigest: `sha256:${sha256Base64Url(ciphertext)}`,
    includes:
      isRecord(snapshot) && isRecord(snapshot.includes)
        ? {
            publicCache: Boolean(snapshot.includes.publicCache),
            receipts: Boolean(snapshot.includes.receipts),
            includeContent: Boolean(snapshot.includes.includeContent),
          }
        : {
            publicCache: true,
            receipts: true,
            includeContent: false,
          },
    keyDerivation: {
      algorithm: "scrypt",
      salt: salt.toString("base64url"),
      keyLength: 32,
      params: VAULT_SCRYPT_PARAMS,
    },
    encryption: {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      authTag: authTag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    },
  };
}

export function parseVaultPayload(
  rawPayload: unknown,
  recoveryPassphrase: string,
) {
  const parsedPayload = vaultEncryptedPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return {
      ok: false as const,
      response: apiError(
        "invalid_payload",
        "Vault payload failed validation",
        parsedPayload.error.issues,
      ),
      status: 400,
    };
  }
  if (parsedPayload.data.includes.includeContent) {
    return {
      ok: false as const,
      response: apiError(
        "feature_not_enabled",
        "Content vault payloads are not supported",
      ),
      status: 400,
    };
  }

  let snapshot: unknown;
  try {
    snapshot = decryptVaultPayload(parsedPayload.data, recoveryPassphrase);
  } catch (error) {
    return {
      ok: false as const,
      response: apiError(
        "invalid_payload",
        error instanceof Error
          ? error.message
          : "Vault payload could not be decrypted",
      ),
      status: 400,
    };
  }
  try {
    assertMetricsOnlyPayload(snapshot);
  } catch (error) {
    return {
      ok: false as const,
      response: apiError(
        "privacy_violation",
        error instanceof Error
          ? error.message
          : "Vault payload contains forbidden content fields",
      ),
      status: 400,
    };
  }

  const extracted = extractVaultEvents(snapshot);
  if (!extracted.ok) {
    return {
      ok: false as const,
      response: apiError("invalid_payload", extracted.message),
      status: 400,
    };
  }
  return {
    ok: true as const,
    payload: parsedPayload.data,
    snapshot,
    extracted,
  };
}

export function previewStoredEvent(event: UsageEventV1): StoredUsageEvent {
  return {
    ...event,
    id: "preview",
    userId: "preview",
    syncRunId: "preview",
    createdAt: "preview",
    updatedAt: "preview",
  };
}

export function ensureVaultImportDevices(
  data: TokSyncData,
  userId: string,
  snapshotDevices: VaultSnapshotDevice[],
  events: UsageEventV1[],
  now: string,
  hashDeviceFingerprint: (value: string) => string,
) {
  const devicesById = new Map(
    snapshotDevices.map((device) => [device.id, device]),
  );
  for (const deviceId of new Set(events.map((event) => event.deviceId))) {
    const existing = data.devices.find(
      (device) => device.userId === userId && device.id === deviceId,
    );
    if (existing) {
      existing.lastSeenAt = now;
      existing.updatedAt = now;
      continue;
    }
    const snapshotDevice = devicesById.get(deviceId);
    data.devices.push({
      id: deviceId,
      userId,
      deviceFingerprintHash: hashDeviceFingerprint(
        `vault-import:${userId}:${deviceId}`,
      ),
      name: snapshotDevice?.name ?? "Imported vault device",
      platform: snapshotDevice?.platform ?? "linux",
      agentVersion: snapshotDevice?.agentVersion ?? "vault-import",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies DeviceRecord);
  }
}

export function vaultExportView(record: VaultExportRecord) {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    format: record.format,
    includePublicCache: record.includePublicCache,
    includeReceipts: record.includeReceipts,
    includeContent: record.includeContent,
    payloadDigest: record.artifactDigest,
    artifactByteSize: record.artifactByteSize,
    eventCount: record.eventCount,
    deviceCount: record.deviceCount,
    error: record.error,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
  };
}

export function vaultPublicProfileStats(
  stats: PublicProfileStatsRecord | null,
) {
  if (!stats) return null;
  return {
    usernameLower: stats.usernameLower,
    displayName: stats.displayName,
    avatarUrl: stats.avatarUrl,
    totalTokens: stats.totalTokens,
    totalCostUsd: stats.totalCostUsd,
    activeDays: stats.activeDays,
    topSources: stats.topSources.map(vaultBreakdownRow),
    topModels: stats.topModels.map(vaultBreakdownRow),
    topWorkspaces: stats.topWorkspaces.map(vaultBreakdownRow),
    dateStart: stats.dateStart,
    dateEnd: stats.dateEnd,
    lastSyncAt: stats.lastSyncAt,
    updatedAt: stats.updatedAt,
    showCost: stats.showCost,
    showSourceBreakdown: stats.showSourceBreakdown,
    showModelBreakdown: stats.showModelBreakdown,
    showWorkspaceBreakdown: stats.showWorkspaceBreakdown,
    dailyPublic: stats.dailyPublic,
    leaderboardOptIn: stats.leaderboardOptIn,
  };
}

export function vaultBreakdownRow(row: BreakdownRow) {
  return {
    key: row.key,
    tokens: row.tokens,
    costUsd: row.costUsd,
    messageCount: row.messages,
  };
}

interface VaultSnapshotDevice {
  id: string;
  name?: string;
  platform?: "windows" | "macos" | "linux";
  agentVersion?: string;
}

function vaultArtifactStorageKey(userId: string, exportId: string) {
  return `vault/${safeStorageSegment(userId)}/${safeStorageSegment(exportId)}.json`;
}

function safeStorageSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128) || "unknown";
}

function decryptVaultPayload(
  payload: VaultEncryptedPayload,
  recoveryPassphrase: string,
) {
  const ciphertext = Buffer.from(payload.encryption.ciphertext, "base64url");
  const expectedDigest = `sha256:${sha256Base64Url(ciphertext)}`;
  if (payload.payloadDigest !== expectedDigest) {
    throw new Error("Vault payload digest mismatch");
  }
  const iv = Buffer.from(payload.encryption.iv, "base64url");
  const authTag = Buffer.from(payload.encryption.authTag, "base64url");
  const salt = Buffer.from(payload.keyDerivation.salt, "base64url");
  const key = deriveVaultKey(
    recoveryPassphrase,
    salt,
    payload.keyDerivation.params,
  );
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plainText = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plainText) as unknown;
}

function deriveVaultKey(
  recoveryPassphrase: string,
  salt: Buffer,
  params?: VaultScryptParams,
) {
  if (!params) return scryptSync(recoveryPassphrase, salt, 32);
  return scryptSync(recoveryPassphrase, salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2,
  });
}

function extractVaultEvents(snapshot: unknown) {
  if (!isRecord(snapshot)) {
    return { ok: false as const, message: "Vault snapshot must be an object" };
  }
  if (snapshot.format !== "toksync-vault-v1" || snapshot.schemaVersion !== 1) {
    return {
      ok: false as const,
      message: "Vault schema version is not supported",
    };
  }
  const metrics = isRecord(snapshot.metrics) ? snapshot.metrics : null;
  const events = Array.isArray(metrics?.events) ? metrics.events : null;
  if (!events) {
    return {
      ok: false as const,
      message: "Vault snapshot is missing metrics.events",
    };
  }
  const parsedEvents = events
    .map((event) => usageEventV1Schema.safeParse(event))
    .filter((result) => result.success)
    .map((result) => result.data);
  if (parsedEvents.length !== events.length) {
    return {
      ok: false as const,
      message: "Vault snapshot contains invalid metrics events",
    };
  }
  const devices = Array.isArray(snapshot.devices)
    ? snapshot.devices
        .map(vaultSnapshotDevice)
        .filter((device): device is VaultSnapshotDevice => Boolean(device))
    : [];
  return {
    ok: true as const,
    events: parsedEvents,
    devices,
    receiptCount: Array.isArray(snapshot.receipts)
      ? snapshot.receipts.length
      : 0,
  };
}

function vaultSnapshotDevice(value: unknown): VaultSnapshotDevice | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const device: VaultSnapshotDevice = { id: value.id };
  if (typeof value.name === "string") device.name = value.name;
  if (
    value.platform === "windows" ||
    value.platform === "macos" ||
    value.platform === "linux"
  ) {
    device.platform = value.platform;
  }
  if (typeof value.agentVersion === "string") {
    device.agentVersion = value.agentVersion;
  }
  return device;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
