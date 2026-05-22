import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  apiError,
  costGuardrailInputSchema,
  isValidUsername,
  leaderboardOptInInputSchema,
  normalizeUsername,
  SOURCE_REGISTRY,
  publicProfileInputSchema,
  totalTokens,
  vaultExportInputSchema,
  vaultImportInputSchema,
  type CostGuardrailInput,
  type LeaderboardOptInInput,
  userApiTokenInputSchema,
  usageBatchV1Schema,
  usageEventV1Schema,
  type DeviceStartInput,
  type PublicProfileInput,
  type UserApiTokenInput,
  type UsageBatchEnvelope,
  type UsageEventV1,
  type VaultEncryptedPayload,
  type VaultExportInput,
  type VaultImportInput,
} from "@toksync/shared";
import {
  FORBIDDEN_CONTENT_KEYS,
  assertMetricsOnlyPayload,
  hashOpaqueValue,
  sanitizeWorkspaceLabel,
  sha256Base64Url,
} from "@toksync/privacy";
import { FileTokSyncStore } from "./store";
import type {
  BreakdownRow,
  CostAnomalyRecord,
  CostGuardrailRuleRecord,
  DeviceRecord,
  DeviceTokenRecord,
  MergeIssueRecord,
  ProfileStatsRecord,
  PublicProfileStatsRecord,
  SourceHealthSnapshotRecord,
  StoredUsageEvent,
  SyncReceiptRecord,
  SyncRunRecord,
  TokSyncData,
  UsageDailyRecord,
  UserRecord,
  UserApiTokenRecord,
  VaultExportRecord,
} from "./types";
import {
  encryptVaultPayload,
  ensureVaultImportDevices,
  previewStoredEvent,
  resolveVaultArtifactStore,
  parseVaultPayload,
  vaultExportView,
  vaultPublicProfileStats,
  vaultSnapshotEvent,
  type VaultArtifactStore,
} from "./vault";
export { FileVaultArtifactStore, type VaultArtifactStore } from "./vault";

const DEFAULT_DEVICE_CODE_TTL_SECONDS = 15 * 60;
const DEVICE_CODE_POLL_INTERVAL_SECONDS = 2;
const COST_SPIKE_BASELINE_DAYS = 7;
const COST_SPIKE_MULTIPLIER = 2;
const COST_SPIKE_MIN_DELTA_USD = 1;

export interface RepositorySecrets {
  tokenHashSecret: string;
  deviceCodeSecret: string;
  deviceFingerprintPepper: string;
}

export interface AuthContext {
  user: UserRecord;
  device: DeviceRecord;
  token: DeviceTokenRecord;
}

interface IngestUsageBatchResponse {
  runId: string;
  status: "accepted" | "rejected";
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; code: string; message: string }>;
  rollupStatus: "completed";
}

type IngestUsageBatchResult =
  | {
      ok: false;
      response: ReturnType<typeof apiError>;
      status: number;
    }
  | {
      ok: true;
      response: IngestUsageBatchResponse;
      status: 200;
    };

type DevicePollResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "consumed" }
  | { status: "pending"; interval: number }
  | {
      status: "authorized";
      deviceId: string;
      deviceToken: string;
      scopes: DeviceTokenRecord["scopes"];
      username: string;
    };

type LeaderboardOptInResult =
  | null
  | {
      ok: false;
      code: "public_profile_required";
      message: string;
    }
  | {
      ok: true;
      enabled: boolean;
      nextSnapshotAt: string;
    };

export interface UserApiTokenAuthContext {
  user: UserRecord;
  token: UserApiTokenRecord;
}

export interface GitHubUserProfile {
  githubId: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export class CostGuardrailTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostGuardrailTargetError";
  }
}

const DEV_SECRET = "dev-secret-change-me";

function resolveRepositorySecrets(): RepositorySecrets {
  return {
    tokenHashSecret: requireSecret("TOKEN_HASH_SECRET"),
    deviceCodeSecret: requireSecret("DEVICE_CODE_SECRET"),
    deviceFingerprintPepper: requireSecret("DEVICE_FINGERPRINT_PEPPER"),
  };
}

function requireSecret(name: keyof NodeJS.ProcessEnv) {
  const value = process.env[name] || DEV_SECRET;
  if (process.env.NODE_ENV === "production" && value === DEV_SECRET) {
    throw new Error(
      `${name} must be set to a non-default value before starting TokSync in production`,
    );
  }
  return value;
}

function deviceCodeTtlSeconds() {
  const raw = process.env.DEVICE_CODE_TTL_SECONDS;
  if (!raw) return DEFAULT_DEVICE_CODE_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DEVICE_CODE_TTL_SECONDS;
  }
  return parsed;
}

function githubUsername(username: string) {
  const normalized = username.trim();
  if (isValidUsername(normalized)) return normalized;
  const fallback = normalized
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
  return isValidUsername(fallback) ? fallback : "github-user";
}

function uniqueGitHubUsername(
  data: TokSyncData,
  preferredUsername: string,
  githubId: string,
) {
  const preferredLower = normalizeUsername(preferredUsername);
  const existing = data.users.find(
    (item) => item.usernameLower === preferredLower,
  );
  if (!existing || existing.githubId === githubId || !existing.githubId) {
    return preferredUsername;
  }

  const suffix = `-${githubId}`.slice(0, 8);
  const base = preferredUsername.slice(0, 39 - suffix.length);
  let candidate = `${base}${suffix}`;
  let counter = 2;
  while (
    data.users.some(
      (item) => item.usernameLower === normalizeUsername(candidate),
    )
  ) {
    const nextSuffix = `-${counter}`;
    candidate = `${base.slice(0, 39 - nextSuffix.length)}${nextSuffix}`;
    counter += 1;
  }
  return candidate;
}

export class TokSyncRepository {
  constructor(
    private readonly store = new FileTokSyncStore(),
    private readonly secrets: RepositorySecrets = resolveRepositorySecrets(),
    private readonly vaultArtifactStore: VaultArtifactStore | null = resolveVaultArtifactStore(),
  ) {}

  reset() {
    this.store.reset();
  }

  seedDevelopmentUser(username = "demo") {
    const existing = this.getUser(username);
    if (existing?.displayName) return existing;
    const user = this.ensureUser(username, { displayName: "Demo Developer" });
    this.recomputeUser(user.id);
    return user;
  }

  ensureUser(username: string, patch: Partial<UserRecord> = {}) {
    return this.store.transaction((data) => ({
      commit: true,
      result: this.ensureUserInData(data, username, patch),
    }));
  }

  getUser(username = "demo") {
    const lower = normalizeUsername(username);
    return this.store.read().users.find((item) => item.usernameLower === lower);
  }

  ensureGitHubUser(profile: GitHubUserProfile) {
    return this.store.transaction((data) => {
      const now = new Date().toISOString();
      const preferredUsername = githubUsername(profile.username);
      let user = data.users.find((item) => item.githubId === profile.githubId);
      user ??= data.users.find(
        (item) =>
          item.usernameLower === normalizeUsername(preferredUsername) &&
          !item.githubId,
      );
      if (!user) {
        const username = uniqueGitHubUsername(
          data,
          preferredUsername,
          profile.githubId,
        );
        user = {
          id: randomUUID(),
          username,
          usernameLower: normalizeUsername(username),
          publicProfileEnabled: false,
          showCost: false,
          showSourceBreakdown: false,
          showModelBreakdown: false,
          showWorkspaceBreakdown: false,
          createdAt: now,
          updatedAt: now,
        };
        data.users.push(user);
      }
      Object.assign(user, {
        githubId: profile.githubId,
        username: user.username,
        usernameLower: normalizeUsername(user.username),
        updatedAt: now,
      });
      if (profile.email) user.email = profile.email;
      if (profile.displayName) user.displayName = profile.displayName;
      if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
      return { commit: true, result: user };
    });
  }

  createDeviceCode(input: DeviceStartInput) {
    return this.store.transaction((data) => {
      pruneDeviceCodesInData(data);
      const deviceCode = `dev_${randomBytes(24).toString("base64url")}`;
      const userCode = `TS-${randomBytes(2).toString("hex").toUpperCase()}`;
      const now = new Date();
      const ttlSeconds = deviceCodeTtlSeconds();
      const fingerprint =
        input.deviceFingerprint || randomBytes(32).toString("base64url");
      data.deviceCodes.push({
        id: randomUUID(),
        deviceCodeHash: this.hashDeviceCode(deviceCode),
        userCode,
        deviceName: input.deviceName,
        platform: input.platform,
        agentVersion: input.agentVersion,
        deviceFingerprintHash: this.hashDeviceFingerprint(fingerprint),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        createdAt: now.toISOString(),
      });
      return {
        commit: true,
        result: {
          deviceCode,
          userCode,
          verificationUrl: `${process.env.APP_URL || "http://localhost:3000"}/device`,
          expiresIn: ttlSeconds,
          interval: DEVICE_CODE_POLL_INTERVAL_SECONDS,
        },
      };
    });
  }

  authorizeDeviceCode(userCode: string, username = "demo") {
    return this.store.transaction((data) => {
      const pruned = pruneDeviceCodesInData(data);
      const code = data.deviceCodes.find(
        (item) => item.userCode.toUpperCase() === userCode.toUpperCase(),
      );
      if (!code) return { commit: pruned, result: null };
      if (Date.parse(code.expiresAt) < Date.now()) {
        return { commit: pruned, result: null };
      }
      if (code.consumedAt) return { commit: pruned, result: null };
      const user = this.ensureUserInData(data, username, {
        displayName: username === "demo" ? "Demo Developer" : username,
      });
      code.authorizedUserId = user.id;
      return {
        commit: true,
        result: { status: "authorized", username: user.username },
      };
    });
  }

  pollDeviceCode(deviceCode: string): DevicePollResult {
    return this.store.transaction<DevicePollResult>((data) => {
      const pruned = pruneDeviceCodesInData(data);
      const code = data.deviceCodes.find(
        (item) => item.deviceCodeHash === this.hashDeviceCode(deviceCode),
      );
      if (!code) {
        return { commit: pruned, result: { status: "not_found" as const } };
      }
      if (Date.parse(code.expiresAt) < Date.now()) {
        return { commit: pruned, result: { status: "expired" as const } };
      }
      if (code.consumedAt) {
        return { commit: pruned, result: { status: "consumed" as const } };
      }
      if (!code.authorizedUserId) {
        return {
          commit: pruned,
          result: { status: "pending" as const, interval: 2 },
        };
      }

      const user = data.users.find((item) => item.id === code.authorizedUserId);
      if (!user) {
        return { commit: pruned, result: { status: "not_found" as const } };
      }

      let device = data.devices.find(
        (item) =>
          item.userId === user.id &&
          item.deviceFingerprintHash === code.deviceFingerprintHash,
      );
      const now = new Date().toISOString();
      if (!device) {
        device = {
          id: randomUUID(),
          userId: user.id,
          deviceFingerprintHash: code.deviceFingerprintHash,
          name: code.deviceName,
          platform: code.platform,
          agentVersion: code.agentVersion,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        data.devices.push(device);
      } else {
        Object.assign(device, {
          name: code.deviceName,
          platform: code.platform,
          agentVersion: code.agentVersion,
          lastSeenAt: now,
          revokedAt: undefined,
          updatedAt: now,
        });
      }

      const rawToken = `tsd_${randomBytes(32).toString("base64url")}`;
      const token: DeviceTokenRecord = {
        id: randomUUID(),
        userId: user.id,
        deviceId: device.id,
        tokenHash: this.hashToken(rawToken),
        scopes: ["usage:write", "device:read"],
        createdAt: now,
      };
      data.deviceTokens.push(token);
      code.consumedAt = now;
      return {
        commit: true,
        result: {
          status: "authorized" as const,
          deviceId: device.id,
          deviceToken: rawToken,
          scopes: token.scopes,
          username: user.username,
        },
      };
    });
  }

  authenticateDevice(rawToken?: string | null): AuthContext | null {
    if (!rawToken?.startsWith("tsd_")) return null;
    return this.store.transaction<AuthContext | null>((data) => {
      const tokenHash = this.hashToken(rawToken);
      const token = data.deviceTokens.find((item) =>
        constantTimeEqual(item.tokenHash, tokenHash),
      );
      if (!token || token.revokedAt) return { commit: false, result: null };
      const device = data.devices.find((item) => item.id === token.deviceId);
      const user = data.users.find((item) => item.id === token.userId);
      if (!device || !user || device.revokedAt) {
        return { commit: false, result: null };
      }
      const now = new Date().toISOString();
      token.lastUsedAt = now;
      device.lastSeenAt = now;
      device.updatedAt = now;
      return { commit: true, result: { user, device, token } };
    });
  }

  authenticateUserApiToken(
    rawToken?: string | null,
  ): UserApiTokenAuthContext | null {
    if (!rawToken?.startsWith("tsk_")) return null;
    return this.store.transaction<UserApiTokenAuthContext | null>((data) => {
      const tokenHash = this.hashToken(rawToken);
      const token = data.userApiTokens.find((item) =>
        constantTimeEqual(item.tokenHash, tokenHash),
      );
      if (!token || token.revokedAt) return { commit: false, result: null };
      if (token.expiresAt && Date.parse(token.expiresAt) < Date.now()) {
        return { commit: false, result: null };
      }
      const user = data.users.find((item) => item.id === token.userId);
      if (!user) return { commit: false, result: null };
      token.lastUsedAt = new Date().toISOString();
      return { commit: true, result: { user, token } };
    });
  }

  listUserApiTokens(username = "demo") {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return [];
    return data.userApiTokens
      .filter((token) => token.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(userApiTokenMetadataView);
  }

  createUserApiToken(username: string, rawInput: UserApiTokenInput) {
    const input = userApiTokenInputSchema.parse(rawInput);
    return this.store.transaction((data) => {
      const user = this.ensureUserInData(data, username);
      const now = new Date().toISOString();
      const rawToken = `tsk_${randomBytes(32).toString("base64url")}`;
      const token: UserApiTokenRecord = {
        id: randomUUID(),
        userId: user.id,
        name: input.name,
        tokenHash: this.hashToken(rawToken),
        scopes: [...new Set(input.scopes)],
        createdAt: now,
      };
      if (input.expiresAt) token.expiresAt = input.expiresAt;
      data.userApiTokens.push(token);
      return {
        commit: true,
        result: { token: rawToken, metadata: userApiTokenMetadataView(token) },
      };
    });
  }

  revokeUserApiToken(username: string, tokenId: string) {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      const token = user
        ? data.userApiTokens.find(
            (item) => item.userId === user.id && item.id === tokenId,
          )
        : undefined;
      if (!user || !token) return { commit: false, result: null };
      token.revokedAt = new Date().toISOString();
      return { commit: true, result: { status: "revoked" } };
    });
  }

  authSession(username = "demo") {
    const user = this.getUser(username) ?? this.seedDevelopmentUser(username);
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        email: user.email,
        authProvider: user.githubId ? "github" : "development",
      },
    };
  }

  getSyncState(rawToken?: string | null) {
    const auth = this.authenticateDevice(rawToken);
    if (!auth) return null;
    const data = this.store.read();
    const events = data.usageEvents.filter(
      (event) =>
        event.userId === auth.user.id && event.deviceId === auth.device.id,
    );
    const knownSources: Record<
      string,
      { lastEventAt: number; eventCount: number }
    > = {};
    for (const event of events) {
      const current = knownSources[event.source] ?? {
        lastEventAt: 0,
        eventCount: 0,
      };
      current.lastEventAt = Math.max(current.lastEventAt, event.timestampMs);
      current.eventCount += 1;
      knownSources[event.source] = current;
    }
    const lastRun = data.syncRuns
      .filter(
        (run) =>
          run.userId === auth.user.id &&
          run.deviceId === auth.device.id &&
          run.status !== "failed",
      )
      .sort((a, b) =>
        (b.finishedAt || b.startedAt).localeCompare(
          a.finishedAt || a.startedAt,
        ),
      )[0];
    return {
      deviceId: auth.device.id,
      lastAcceptedRunAt: lastRun?.finishedAt ?? null,
      knownSources,
    };
  }

  ingestUsageBatch(
    rawToken: string | undefined,
    rawPayload: unknown,
  ): IngestUsageBatchResult {
    const envelope = usageBatchV1Schema.safeParse(rawPayload);
    if (!envelope.success) {
      return {
        ok: false as const,
        response: apiError(
          "invalid_payload",
          "Usage batch failed validation",
          envelope.error.issues,
        ),
        status: 400,
      };
    }
    try {
      assertMetricsOnlyPayload(rawPayload);
    } catch (error) {
      return {
        ok: false as const,
        response: apiError(
          "privacy_violation",
          error instanceof Error
            ? error.message
            : "Payload contains forbidden content fields",
        ),
        status: 400,
      };
    }

    const batch = envelope.data;
    return this.store.transaction<IngestUsageBatchResult>((data) => {
      const usageAuth = this.authenticateUsageWriter(data, rawToken, batch);
      if (!usageAuth) {
        return {
          commit: false,
          result: {
            ok: false as const,
            response: apiError(
              "invalid_auth",
              "Invalid or revoked write token",
            ),
            status: 401,
          },
        };
      }
      const { user, device } = usageAuth;
      const now = new Date().toISOString();
      let syncRun = data.syncRuns.find(
        (run) =>
          run.userId === user.id &&
          run.deviceId === device.id &&
          run.clientRunId === batch.runId,
      );
      if (!syncRun) {
        syncRun = {
          id: randomUUID(),
          clientRunId: batch.runId,
          userId: user.id,
          deviceId: device.id,
          mode: batch.mode,
          status: "started",
          sourceSummary: {},
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          startedAt: now,
        };
        data.syncRuns.push(syncRun);
      }

      const errors: Array<{ index: number; code: string; message: string }> =
        [];
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const sourceSummary: Record<string, number> = {};
      const usageIndexes = buildUsageEventIndexes(data, user.id);

      for (const [index, rawEvent] of batch.events.entries()) {
        const parsed = usageEventV1Schema.safeParse(rawEvent);
        if (!parsed.success) {
          errors.push({
            index,
            code: "invalid_event",
            message: parsed.error.issues[0]?.message || "Invalid event",
          });
          continue;
        }
        const event = parsed.data;
        if (event.deviceId !== device.id || batch.device.id !== device.id) {
          errors.push({
            index,
            code: "wrong_device",
            message: "Event device does not match token device",
          });
          continue;
        }

        sourceSummary[event.source] = (sourceSummary[event.source] ?? 0) + 1;
        const existing = findExistingUsageEvent(usageIndexes, user.id, event);
        if (!existing) {
          const stored = {
            ...event,
            id: randomUUID(),
            userId: user.id,
            syncRunId: syncRun.id,
            createdAt: now,
            updatedAt: now,
          };
          data.usageEvents.push(stored);
          indexUsageEvent(usageIndexes, stored);
          inserted += 1;
        } else if (existing.deviceId !== event.deviceId) {
          skipped += 1;
        } else if (
          storedEventFingerprint(existing) !== storedEventFingerprint(event)
        ) {
          Object.assign(existing, event, {
            syncRunId: syncRun.id,
            updatedAt: now,
          });
          removeDuplicateUsageEvents(
            data,
            usageIndexes,
            user.id,
            event,
            existing.id,
          );
          indexUsageEvent(usageIndexes, existing);
          updated += 1;
        } else {
          removeDuplicateUsageEvents(
            data,
            usageIndexes,
            user.id,
            event,
            existing.id,
          );
          skipped += 1;
        }
      }

      syncRun.status =
        errors.length > 0 && inserted + updated + skipped > 0
          ? "partial"
          : errors.length > 0
            ? "failed"
            : "completed";
      syncRun.sourceSummary = sourceSummary;
      syncRun.insertedCount = inserted;
      syncRun.updatedCount = updated;
      syncRun.skippedCount = skipped;
      syncRun.errorCount = errors.length;
      syncRun.finishedAt = now;
      device.lastSeenAt = now;
      device.updatedAt = now;
      this.recomputeUserInData(data, user.id);
      const response: IngestUsageBatchResponse = {
        runId: batch.runId,
        status: syncRun.status === "failed" ? "rejected" : "accepted",
        inserted,
        updated,
        skipped,
        errors,
        rollupStatus: "completed",
      };
      data.syncReceipts = data.syncReceipts.filter(
        (receipt) => receipt.syncRunId !== syncRun.id,
      );
      data.syncReceipts.push(
        buildSyncReceipt(user.id, device.id, batch, syncRun, response, now),
      );
      this.refreshSourceHealthInData(data, user.id, now);
      this.refreshMergeIssuesInData(data, user.id, now);

      return {
        commit: true,
        result: {
          ok: true as const,
          response,
          status: 200,
        },
      };
    });
  }

  dashboardSummary(username = "demo", filters: DashboardFilters = {}) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return null;
    const events = this.filterEvents(data, user.id, filters);
    const totals = sumEvents(events);
    return {
      totals: {
        tokens: totals.tokens,
        costUsd: round(totals.costUsd),
        activeDays: new Set(events.map((event) => event.localDate)).size,
        messages: totals.messages,
        turns: events.filter((event) => event.isTurnStart).length,
      },
      topSources: breakdown(events, "source"),
      topModels: breakdown(events, "modelId"),
      topDevices: breakdown(events, "deviceId"),
      topWorkspaces: breakdown(events, "workspaceLabel"),
      lastSyncAt: latest(
        data.syncRuns
          .filter((run) => run.userId === user.id)
          .map((run) => run.finishedAt || run.startedAt),
      ),
    };
  }

  usageDaily(username = "demo", filters: DashboardFilters = {}) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return null;
    const events = this.filterEvents(data, user.id, filters);
    const byDate = new Map<string, StoredUsageEvent[]>();
    for (const event of events) {
      byDate.set(event.localDate, [
        ...(byDate.get(event.localDate) ?? []),
        event,
      ]);
    }
    return {
      days: [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, items]) => {
          const totals = sumEvents(items);
          const sourceBreakdown: Record<
            string,
            { tokens: number; costUsd: number }
          > = {};
          for (const row of breakdown(items, "source")) {
            sourceBreakdown[row.key] = {
              tokens: row.tokens,
              costUsd: row.costUsd,
            };
          }
          return {
            date,
            tokens: totals.tokens,
            costUsd: round(totals.costUsd),
            sourceBreakdown,
          };
        }),
    };
  }

  listDevices(username = "demo") {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return [];
    return data.devices
      .filter((device) => device.userId === user.id)
      .map((device) =>
        deviceView(
          device,
          data.usageEvents.filter((event) => event.deviceId === device.id)
            .length,
        ),
      );
  }

  listSyncRuns(username = "demo") {
    const user = this.getUser(username);
    if (!user) return [];
    return this.store
      .read()
      .syncRuns.filter((run) => run.userId === user.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(syncRunView);
  }

  listSyncReceipts(username = "demo") {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return [];
    return data.syncReceipts
      .filter((receipt) => receipt.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(syncReceiptView);
  }

  getSyncReceipt(username: string, receiptId: string) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return null;
    const receipt =
      data.syncReceipts.find(
        (receipt) => receipt.userId === user.id && receipt.id === receiptId,
      ) ?? null;
    return receipt ? syncReceiptView(receipt) : null;
  }

  sourceHealth(username = "demo") {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      if (!user) return { commit: false, result: [] };
      this.refreshSourceHealthInData(data, user.id, new Date().toISOString());
      return {
        commit: true,
        result: data.sourceHealthSnapshots
          .filter((snapshot) => snapshot.userId === user.id)
          .sort((a, b) => a.source.localeCompare(b.source))
          .map(sourceHealthView),
      };
    });
  }

  listCostGuardrails(username = "demo") {
    return this.store.transaction((data) => {
      const user =
        this.userByName(data, username) ??
        this.ensureUserInData(data, username, {
          displayName: "Demo Developer",
        });
      this.refreshCostAnomaliesInData(data, user.id, new Date().toISOString());
      return {
        commit: true,
        result: {
          rules: data.costGuardrailRules
            .filter((rule) => rule.userId === user.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map(costGuardrailRuleView),
          anomalies: data.costAnomalies
            .filter((anomaly) => anomaly.userId === user.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(costAnomalyView),
        },
      };
    });
  }

  upsertCostGuardrail(username: string, rawInput: CostGuardrailInput) {
    const input = costGuardrailInputSchema.parse(rawInput);
    return this.store.transaction((data) => {
      const user =
        this.userByName(data, username) ??
        this.ensureUserInData(data, username, {
          displayName: "Demo Developer",
        });
      if (
        input.scope === "device" &&
        !data.devices.some(
          (device) => device.userId === user.id && device.id === input.deviceId,
        )
      ) {
        throw new CostGuardrailTargetError(
          "Guardrail device target was not found for this user",
        );
      }

      const now = new Date().toISOString();
      const patch = normalizeCostGuardrailInput(input);
      const existing =
        data.costGuardrailRules.find(
          (rule) => rule.userId === user.id && rule.id === input.id,
        ) ??
        data.costGuardrailRules.find((rule) =>
          sameCostGuardrailTarget(rule, user.id, input),
        );

      const rule: CostGuardrailRuleRecord = existing ?? {
        id: input.id ?? randomUUID(),
        userId: user.id,
        scope: patch.scope,
        period: patch.period,
        limitUsd: patch.limitUsd,
        enabled: patch.enabled,
        createdAt: now,
        updatedAt: now,
      };

      Object.assign(rule, patch, { updatedAt: now });
      if (!existing) data.costGuardrailRules.push(rule);

      this.refreshCostAnomaliesInData(data, user.id, now);
      return {
        commit: true,
        result: {
          rule: costGuardrailRuleView(rule),
          anomalies: data.costAnomalies
            .filter((anomaly) => anomaly.userId === user.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(costAnomalyView),
        },
      };
    });
  }

  mergeIssues(username = "demo") {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      if (!user) return { commit: false, result: [] };
      this.refreshMergeIssuesInData(data, user.id, new Date().toISOString());
      return {
        commit: true,
        result: data.mergeIssues
          .filter((issue) => issue.userId === user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(mergeIssueView),
      };
    });
  }

  resolveMergeIssue(
    username: string,
    issueId: string,
    action: MergeIssueRecord["suggestedAction"],
  ) {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      const issue = user
        ? data.mergeIssues.find(
            (item) => item.userId === user.id && item.id === issueId,
          )
        : undefined;
      if (!user || !issue) return { commit: false, result: null };
      issue.status = action === "dismiss" ? "dismissed" : "resolved";
      issue.resolvedAt = new Date().toISOString();
      this.recomputeUserInData(data, user.id);
      return {
        commit: true,
        result: { status: issue.status, rollupStatus: "completed" },
      };
    });
  }

  exportMetrics(
    username = "demo",
    options: DashboardFilters & { format?: "json" | "csv" } = {},
  ) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return null;
    const rows = this.filterEvents(data, user.id, options).map((event) =>
      metricsExportRow(event),
    );
    if (options.format === "csv") {
      return {
        format: "csv" as const,
        fileName: `toksync-metrics-${user.usernameLower}.csv`,
        contentType: "text/csv; charset=utf-8",
        rowCount: rows.length,
        body: toCsv(rows),
      };
    }
    return {
      format: "json" as const,
      fileName: `toksync-metrics-${user.usernameLower}.json`,
      contentType: "application/json; charset=utf-8",
      rowCount: rows.length,
      body: JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          privacy: {
            mode: "metrics-only",
            excludedFields: RECEIPT_EXCLUDED_FIELDS,
          },
          rows,
        },
        null,
        2,
      ),
    };
  }

  listVaultExports(username = "demo") {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return [];
    return data.vaultExports
      .filter((record) => record.userId === user.id && record.kind === "export")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(vaultExportView);
  }

  getVaultExport(username: string, exportId: string) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    if (!user) return null;
    const record =
      data.vaultExports.find(
        (item) =>
          item.userId === user.id &&
          item.kind === "export" &&
          item.id === exportId,
      ) ?? null;
    if (!record) return null;
    const payload = this.loadVaultArtifact(record);
    if (!payload) return null;
    return {
      export: vaultExportView(record),
      payload,
      payloadDigest: payload.payloadDigest,
    };
  }

  private storeVaultArtifact(
    userId: string,
    exportId: string,
    payload: VaultEncryptedPayload,
  ): Pick<VaultExportRecord, "artifact" | "artifactStorageKey"> {
    if (!this.vaultArtifactStore) return { artifact: payload };
    return {
      artifactStorageKey: this.vaultArtifactStore.put({
        userId,
        exportId,
        payload,
      }),
    };
  }

  private loadVaultArtifact(record: VaultExportRecord) {
    if (record.artifact) return record.artifact;
    if (!record.artifactStorageKey || !this.vaultArtifactStore) return null;
    const payload = this.vaultArtifactStore.get(record.artifactStorageKey);
    if (!payload) return null;
    if (
      record.artifactDigest &&
      payload.payloadDigest !== record.artifactDigest
    ) {
      throw new Error("Vault artifact digest mismatch");
    }
    return payload;
  }

  createVaultExport(username = "demo", rawInput: VaultExportInput) {
    const input = vaultExportInputSchema.parse(rawInput);
    return this.store.transaction((data) => {
      const user =
        this.userByName(data, username) ??
        this.ensureUserInData(data, username);
      if (input.includeContent) {
        throw new Error("TokSync vault content export is not enabled");
      }

      const now = new Date().toISOString();
      this.refreshSourceHealthInData(data, user.id, now);
      const events = this.filterEvents(data, user.id, {});
      const totals = sumEvents(events);
      const devices = data.devices
        .filter((device) => device.userId === user.id)
        .map((device) =>
          deviceView(
            device,
            events.filter((event) => event.deviceId === device.id).length,
          ),
        );
      const snapshot = {
        schemaVersion: 1 as const,
        format: input.format,
        exportedAt: now,
        privacy: {
          mode: "metrics-only" as const,
          encrypted: true,
          excludedFields: RECEIPT_EXCLUDED_FIELDS,
        },
        includes: {
          publicCache: input.includePublicCache,
          receipts: input.includeReceipts,
          includeContent: false,
        },
        user: {
          username: user.username,
          displayName: user.displayName,
          publicProfileEnabled: user.publicProfileEnabled,
          showCost: user.showCost,
          showSourceBreakdown: user.showSourceBreakdown,
          showModelBreakdown: user.showModelBreakdown,
          showWorkspaceBreakdown: user.showWorkspaceBreakdown,
        },
        devices,
        metrics: {
          events: events.map(vaultSnapshotEvent),
          summary: {
            totals: {
              tokens: totals.tokens,
              costUsd: round(totals.costUsd),
              activeDays: new Set(events.map((event) => event.localDate)).size,
              messageCount: totals.messages,
              turns: events.filter((event) => event.isTurnStart).length,
            },
            topSources: vaultBreakdown(events, "source"),
            topModels: vaultBreakdown(events, "modelId"),
            topDevices: vaultBreakdown(events, "deviceId"),
            topWorkspaces: vaultBreakdown(events, "workspaceLabel"),
            lastSyncAt: latest(
              data.syncRuns
                .filter((run) => run.userId === user.id)
                .map((run) => run.finishedAt || run.startedAt),
            ),
          },
          usageDaily: usageDailyView(events),
          sourceHealth: data.sourceHealthSnapshots
            .filter((snapshot) => snapshot.userId === user.id)
            .sort((a, b) => a.source.localeCompare(b.source))
            .map(sourceHealthView),
          mergeIssues: data.mergeIssues
            .filter((issue) => issue.userId === user.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(mergeIssueView),
          costGuardrails: {
            rules: data.costGuardrailRules
              .filter((rule) => rule.userId === user.id)
              .map(costGuardrailRuleView),
            anomalies: data.costAnomalies
              .filter((anomaly) => anomaly.userId === user.id)
              .map(costAnomalyView),
          },
        },
        ...(input.includeReceipts
          ? {
              receipts: data.syncReceipts
                .filter((receipt) => receipt.userId === user.id)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map(syncReceiptView),
            }
          : {}),
        ...(input.includePublicCache
          ? {
              publicProfile: {
                enabled: user.publicProfileEnabled,
                stats: vaultPublicProfileStats(
                  data.publicProfileStats.find(
                    (stats) => stats.userId === user.id,
                  ) ?? null,
                ),
              },
            }
          : {}),
      };

      assertMetricsOnlyPayload(snapshot);
      const payload = encryptVaultPayload(
        snapshot,
        input.recoveryPassphrase,
        now,
      );
      const receiptCount = input.includeReceipts
        ? data.syncReceipts.filter((receipt) => receipt.userId === user.id)
            .length
        : 0;
      const exportId = randomUUID();
      const artifactLocation = this.storeVaultArtifact(
        user.id,
        exportId,
        payload,
      );
      const record: VaultExportRecord = {
        id: exportId,
        userId: user.id,
        kind: "export",
        status: "completed",
        format: input.format,
        includePublicCache: input.includePublicCache,
        includeReceipts: input.includeReceipts,
        includeContent: false,
        artifactDigest: payload.payloadDigest,
        artifactByteSize: Buffer.byteLength(JSON.stringify(payload)),
        ...artifactLocation,
        eventCount: events.length,
        deviceCount: devices.length,
        sourceCount: new Set(events.map((event) => event.source)).size,
        receiptCount,
        createdAt: now,
        finishedAt: now,
      };
      data.vaultExports.push(record);
      return {
        commit: true,
        result: {
          export: vaultExportView(record),
          payload,
          payloadDigest: payload.payloadDigest,
        },
      };
    });
  }

  previewVaultImport(
    username: string,
    rawPayload: unknown,
    recoveryPassphrase: string,
  ) {
    const parsed = parseVaultPayload(rawPayload, recoveryPassphrase);
    if (!parsed.ok) return parsed;
    const data = this.store.read();
    const user = this.userByName(data, username);
    const duplicateEvents = user
      ? countVaultDuplicateEvents(data, user.id, parsed.extracted.events)
      : 0;
    const previewEvents = parsed.extracted.events.map(previewStoredEvent);
    const totals = sumEvents(previewEvents);
    return {
      ok: true as const,
      response: {
        format: parsed.payload.format,
        createdAt: parsed.payload.createdAt,
        payloadDigest: parsed.payload.payloadDigest,
        includes: parsed.payload.includes,
        eventCount: parsed.extracted.events.length,
        importableEvents: parsed.extracted.events.length - duplicateEvents,
        duplicateEvents,
        deviceCount: parsed.extracted.devices.length,
        receiptCount: parsed.extracted.receiptCount,
        sourceSummary: countBy(parsed.extracted.events, "source"),
        totals: {
          tokens: totals.tokens,
          costUsd: round(totals.costUsd),
          messageCount: totals.messages,
        },
      },
      status: 200,
    };
  }

  importVault(
    username: string,
    rawPayload: unknown,
    recoveryPassphrase: string,
  ) {
    const parsed = parseVaultPayload(rawPayload, recoveryPassphrase);
    if (!parsed.ok) return parsed;
    return this.store.transaction((data) => {
      const user = this.ensureUserInData(data, username);
      const now = new Date().toISOString();
      const indexes = buildUsageEventIndexes(data, user.id);
      let inserted = 0;
      let skipped = 0;
      const sourceSummary: Record<string, number> = {};
      ensureVaultImportDevices(
        data,
        user.id,
        parsed.extracted.devices,
        parsed.extracted.events,
        now,
        (value) => this.hashDeviceFingerprint(value),
      );
      const syncRun: SyncRunRecord = {
        id: randomUUID(),
        clientRunId: `vault-import-${randomUUID()}`,
        userId: user.id,
        deviceId: parsed.extracted.events[0]?.deviceId ?? "vault-import",
        mode: "sync",
        status: "completed",
        sourceSummary,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        startedAt: now,
        finishedAt: now,
      };
      data.syncRuns.push(syncRun);

      for (const event of parsed.extracted.events) {
        sourceSummary[event.source] = (sourceSummary[event.source] ?? 0) + 1;
        if (findExistingUsageEvent(indexes, user.id, event)) {
          skipped += 1;
          continue;
        }
        const stored: StoredUsageEvent = {
          ...event,
          id: randomUUID(),
          userId: user.id,
          syncRunId: syncRun.id,
          createdAt: now,
          updatedAt: now,
        };
        data.usageEvents.push(stored);
        indexUsageEvent(indexes, stored);
        inserted += 1;
      }

      syncRun.insertedCount = inserted;
      syncRun.skippedCount = skipped;
      syncRun.sourceSummary = sourceSummary;
      data.vaultExports.push({
        id: randomUUID(),
        userId: user.id,
        kind: "import",
        status: "completed",
        format: parsed.payload.format,
        includePublicCache: parsed.payload.includes.publicCache,
        includeReceipts: parsed.payload.includes.receipts,
        includeContent: false,
        artifactDigest: parsed.payload.payloadDigest,
        artifactByteSize: Buffer.byteLength(JSON.stringify(parsed.payload)),
        eventCount: parsed.extracted.events.length,
        deviceCount: parsed.extracted.devices.length,
        sourceCount: Object.keys(sourceSummary).length,
        receiptCount: parsed.extracted.receiptCount,
        createdAt: now,
        finishedAt: now,
      });
      this.recomputeUserInData(data, user.id);
      this.refreshSourceHealthInData(data, user.id, now);
      this.refreshMergeIssuesInData(data, user.id, now);

      const previewEvents = parsed.extracted.events.map(previewStoredEvent);
      const totals = sumEvents(previewEvents);
      return {
        commit: true,
        result: {
          ok: true as const,
          response: {
            format: parsed.payload.format,
            createdAt: parsed.payload.createdAt,
            payloadDigest: parsed.payload.payloadDigest,
            eventCount: parsed.extracted.events.length,
            importedEvents: inserted,
            duplicateEvents: skipped,
            deviceCount: parsed.extracted.devices.length,
            receiptCount: parsed.extracted.receiptCount,
            sourceSummary,
            totals: {
              tokens: totals.tokens,
              costUsd: round(totals.costUsd),
              messageCount: totals.messages,
            },
          },
          status: 200,
        },
      };
    });
  }

  deleteSubmittedData(username = "demo") {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      if (!user) return { commit: false, result: null };
      user.publicProfileEnabled = false;
      user.showCost = false;
      user.showSourceBreakdown = false;
      user.showModelBreakdown = false;
      user.updatedAt = new Date().toISOString();
      data.publicProfileStats = data.publicProfileStats.filter(
        (stats) => stats.userId !== user.id,
      );
      return {
        commit: true,
        result: {
          deleted: true,
          publicProfileEnabled: false,
          leaderboardOptIn: false,
        },
      };
    });
  }

  previewLocalPayload(rawPayload: unknown) {
    try {
      assertMetricsOnlyPayload(rawPayload);
    } catch (error) {
      return {
        ok: false as const,
        response: apiError(
          "privacy_violation",
          error instanceof Error
            ? error.message
            : "Payload contains forbidden content fields",
        ),
        status: 400,
      };
    }
    const envelope = usageBatchV1Schema.safeParse(rawPayload);
    if (!envelope.success) {
      return {
        ok: false as const,
        response: apiError(
          "invalid_payload",
          "Usage batch failed validation",
          envelope.error.issues,
        ),
        status: 400,
      };
    }
    const events = envelope.data.events
      .map((event) => usageEventV1Schema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => result.data);
    const previewEvents = events.map((event) => ({
      ...event,
      id: "preview",
      userId: "preview",
      syncRunId: "preview",
      createdAt: "preview",
      updatedAt: "preview",
    }));
    const totals = sumEvents(previewEvents);
    return {
      ok: true as const,
      response: {
        eventCount: events.length,
        totals: {
          tokens: totals.tokens,
          costUsd: round(totals.costUsd),
          messages: totals.messages,
        },
        sourceSummary: countBy(events, "source"),
        receipt: buildPreviewReceipt(envelope.data),
      },
      status: 200,
    };
  }

  revokeDevice(username: string, deviceId: string) {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      const device = user
        ? data.devices.find(
            (item) => item.userId === user.id && item.id === deviceId,
          )
        : undefined;
      if (!user || !device) return { commit: false, result: null };
      const now = new Date().toISOString();
      device.revokedAt = now;
      for (const token of data.deviceTokens.filter(
        (item) => item.deviceId === device.id,
      )) {
        token.revokedAt = now;
      }
      return { commit: true, result: { status: "revoked" } };
    });
  }

  deleteDeviceData(username: string, deviceId: string) {
    return this.store.transaction((data) => {
      const user = this.userByName(data, username);
      const device = user
        ? data.devices.find(
            (item) => item.userId === user.id && item.id === deviceId,
          )
        : undefined;
      if (!user || !device) return { commit: false, result: null };
      data.usageEvents = data.usageEvents.filter(
        (event) => event.deviceId !== device.id,
      );
      device.dataClearedAt = new Date().toISOString();
      this.recomputeUserInData(data, user.id);
      return {
        commit: true,
        result: { status: "completed", jobId: randomUUID() },
      };
    });
  }

  setPublicProfile(username: string, rawInput: PublicProfileInput) {
    const input = publicProfileInputSchema.parse(rawInput);
    return this.store.transaction((data) => {
      const user = this.ensureUserInData(data, username);
      Object.assign(user, {
        publicProfileEnabled: input.enabled,
        showCost: input.showCost,
        showSourceBreakdown: input.showSourceBreakdown,
        showModelBreakdown: input.showModelBreakdown,
        showWorkspaceBreakdown: input.showWorkspaceBreakdown,
        updatedAt: new Date().toISOString(),
      });
      this.recomputeUserInData(data, user.id);
      return {
        commit: true,
        result: {
          enabled: user.publicProfileEnabled,
          url: `${process.env.APP_URL || "http://localhost:3000"}/u/${user.username}`,
        },
      };
    });
  }

  getPublicStats(username: string) {
    const lower = normalizeUsername(username);
    const data = this.store.read();
    const stats =
      data.publicProfileStats.find((item) => item.usernameLower === lower) ??
      null;
    if (!stats) return null;
    const user = data.users.find((item) => item.id === stats.userId);
    if (!user?.publicProfileEnabled) return null;
    return stats;
  }

  getPublicProofPack(username: string) {
    const lower = normalizeUsername(username);
    const data = this.store.read();
    const stats = this.getPublicStats(lower);
    if (!stats) return null;
    const receiptDigests = data.syncReceipts
      .filter((receipt) => receipt.userId === stats.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((receipt) => ({
        payloadDigest: receipt.payloadDigest,
        status: receipt.status,
        resultSummary: receipt.resultSummary,
        createdAt: receipt.createdAt,
      }));
    const proof = {
      schemaVersion: 1,
      proofType: "public-proof-pack" as const,
      username: stats.usernameLower,
      generatedAt: new Date().toISOString(),
      publicFields: publicFieldsForStats(stats),
      excludedFields: RECEIPT_EXCLUDED_FIELDS,
      summary: publicSummaryFromStats(stats),
      receiptCount: data.syncReceipts.filter(
        (receipt) => receipt.userId === stats.userId,
      ).length,
      receiptDigests,
    };
    return {
      ...proof,
      proofDigest: `sha256:${sha256Base64Url(JSON.stringify(proof))}`,
    };
  }

  getPrivateWrapped(username = "demo") {
    const summary = this.dashboardSummary(username);
    const daily = this.usageDaily(username);
    if (!summary || !daily) return null;
    const busiestDay = [...daily.days].sort(
      (left, right) => right.tokens - left.tokens,
    )[0];
    return {
      schemaVersion: 1,
      visibility: "private" as const,
      username: normalizeUsername(username),
      generatedAt: new Date().toISOString(),
      totals: summary.totals,
      highlights: {
        topSource: summary.topSources[0] ?? null,
        topModel: summary.topModels[0] ?? null,
        busiestDay: busiestDay
          ? {
              date: busiestDay.date,
              tokens: busiestDay.tokens,
              costUsd: busiestDay.costUsd,
            }
          : null,
      },
      publicShareAvailable: Boolean(this.getPublicStats(username)),
    };
  }

  getPublicWrapped(username: string) {
    const stats = this.getPublicStats(username);
    if (!stats) return null;
    const daily = stats.dailyPublic.map((row) => ({
      date: row.date,
      tokens: row.tokens,
      ...(stats.showCost ? { costUsd: row.costUsd } : {}),
    }));
    const busiestDay = [...daily].sort(
      (left, right) => right.tokens - left.tokens,
    )[0];
    return {
      schemaVersion: 1,
      visibility: "public" as const,
      username: stats.usernameLower,
      generatedAt: new Date().toISOString(),
      publicFields: publicFieldsForStats(stats),
      excludedFields: RECEIPT_EXCLUDED_FIELDS,
      totals: publicSummaryFromStats(stats).totals,
      highlights: {
        topSource: stats.showSourceBreakdown
          ? (publicBreakdown(stats.topSources, stats.showCost)[0] ?? null)
          : null,
        topModel: stats.showModelBreakdown
          ? (publicBreakdown(stats.topModels, stats.showCost)[0] ?? null)
          : null,
        busiestDay: busiestDay ?? null,
      },
    };
  }

  setLeaderboardOptIn(
    username: string,
    rawInput: LeaderboardOptInInput,
  ): LeaderboardOptInResult {
    const input = leaderboardOptInInputSchema.parse(rawInput);
    return this.store.transaction<LeaderboardOptInResult>((data) => {
      const user = this.userByName(data, username);
      if (!user) return { commit: false, result: null };
      const now = new Date().toISOString();

      if (!user.publicProfileEnabled) {
        data.publicProfileStats = data.publicProfileStats.filter(
          (stats) => stats.userId !== user.id,
        );
        if (input.enabled) {
          return {
            commit: true,
            result: {
              ok: false as const,
              code: "public_profile_required",
              message: "Enable public profile before joining the leaderboard",
            },
          };
        }
        return {
          commit: true,
          result: {
            ok: true as const,
            enabled: false,
            nextSnapshotAt: nextLeaderboardSnapshotAt(now),
          },
        };
      }

      let publicStats = data.publicProfileStats.find(
        (stats) => stats.userId === user.id,
      );
      if (!publicStats) {
        this.recomputeUserInData(data, user.id);
        publicStats = data.publicProfileStats.find(
          (stats) => stats.userId === user.id,
        );
      }
      if (!publicStats) {
        return {
          commit: false,
          result: {
            ok: false as const,
            code: "public_profile_required",
            message: "Enable public profile before joining the leaderboard",
          },
        };
      }

      publicStats.leaderboardOptIn = input.enabled;
      publicStats.updatedAt = now;
      return {
        commit: true,
        result: {
          ok: true as const,
          enabled: publicStats.leaderboardOptIn,
          nextSnapshotAt: nextLeaderboardSnapshotAt(now),
        },
      };
    });
  }

  listLeaderboard(query: LeaderboardQuery = {}) {
    const data = this.store.read();
    const metric = query.metric ?? "tokens";
    const period = query.period ?? "all_time";
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const generatedAt = new Date().toISOString();

    const rows = data.publicProfileStats
      .filter((stats) => stats.leaderboardOptIn)
      .map((stats) => leaderboardEntryFromPublicStats(stats, metric, period))
      .filter((row) => row.metricValue > 0)
      .sort(
        (left, right) =>
          right.metricValue - left.metricValue ||
          right.totalTokens - left.totalTokens ||
          left.username.localeCompare(right.username),
      )
      .slice(0, limit)
      .map((row, index) => ({ rank: index + 1, ...row }));

    return {
      metric,
      period,
      generatedAt,
      rows,
    };
  }

  private recomputeUser(userId: string) {
    this.store.transaction((data) => {
      this.recomputeUserInData(data, userId);
      return { commit: true, result: null };
    });
  }

  private recomputeUserInData(data: TokSyncData, userId: string) {
    data.usageDaily = data.usageDaily.filter((row) => row.userId !== userId);
    const userEvents = data.usageEvents.filter(
      (event) => event.userId === userId,
    );
    const previousPublicStats = data.publicProfileStats.find(
      (row) => row.userId === userId,
    );
    const grouped = new Map<string, StoredUsageEvent[]>();
    for (const event of userEvents) {
      const key = [
        event.localDate,
        event.deviceId,
        event.source,
        event.workspaceKeyHash ?? "",
        event.workspaceLabel ?? "",
        event.modelId,
        event.providerId ?? "",
      ].join("|");
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    const now = new Date().toISOString();
    for (const [key, events] of grouped) {
      const [
        date,
        deviceId,
        source,
        workspaceKeyHash,
        workspaceLabel,
        modelId,
        providerId,
      ] = key.split("|");
      const totals = sumEvents(events);
      const row: UsageDailyRecord = {
        id: randomUUID(),
        userId,
        date: date ?? "",
        tokens: totals.breakdown,
        costUsd: round(totals.costUsd),
        messageCount: totals.messages,
        turnCount: events.filter((event) => event.isTurnStart).length,
        eventCount: events.length,
        updatedAt: now,
      };
      if (deviceId) row.deviceId = deviceId;
      if (source) row.source = source;
      if (workspaceKeyHash) row.workspaceKeyHash = workspaceKeyHash;
      if (workspaceLabel) row.workspaceLabel = workspaceLabel;
      if (modelId) row.modelId = modelId;
      if (providerId) row.providerId = providerId;
      data.usageDaily.push(row);
    }

    const profile = buildProfileStats(userId, userEvents, data.syncRuns);
    data.profileStats = data.profileStats.filter(
      (row) => row.userId !== userId,
    );
    data.profileStats.push(profile);

    const user = data.users.find((item) => item.id === userId);
    data.publicProfileStats = data.publicProfileStats.filter(
      (row) => row.userId !== userId,
    );
    if (user?.publicProfileEnabled) {
      const publicStats: PublicProfileStatsRecord = {
        ...profile,
        usernameLower: user.usernameLower,
        showCost: user.showCost,
        showSourceBreakdown: user.showSourceBreakdown,
        showModelBreakdown: user.showModelBreakdown,
        showWorkspaceBreakdown: user.showWorkspaceBreakdown,
        dailyPublic: aggregatePublicDaily(userEvents),
        leaderboardOptIn: previousPublicStats?.leaderboardOptIn ?? false,
      };
      if (user.displayName) publicStats.displayName = user.displayName;
      if (user.avatarUrl) publicStats.avatarUrl = user.avatarUrl;
      data.publicProfileStats.push(publicStats);
    }
    this.refreshCostAnomaliesInData(data, userId, now);
  }

  private userByName(data: TokSyncData, username: string) {
    const lower = normalizeUsername(username);
    return data.users.find((user) => user.usernameLower === lower);
  }

  private ensureUserInData(
    data: TokSyncData,
    username: string,
    patch: Partial<UserRecord> = {},
  ) {
    const lower = normalizeUsername(username);
    if (!isValidUsername(username)) {
      throw new Error(`Invalid username: ${username}`);
    }
    let user = data.users.find((item) => item.usernameLower === lower);
    const now = new Date().toISOString();
    if (!user) {
      user = {
        id: randomUUID(),
        username,
        usernameLower: lower,
        publicProfileEnabled: false,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
        showWorkspaceBreakdown: false,
        createdAt: now,
        updatedAt: now,
        ...patch,
      };
      data.users.push(user);
    } else {
      Object.assign(user, patch, { updatedAt: now });
    }
    return user;
  }

  private filterEvents(
    data: TokSyncData,
    userId: string,
    filters: DashboardFilters,
  ) {
    return data.usageEvents.filter((event) => {
      if (event.userId !== userId) return false;
      if (filters.from && event.localDate < filters.from) return false;
      if (filters.to && event.localDate > filters.to) return false;
      if (filters.source && event.source !== filters.source) return false;
      if (filters.deviceId && event.deviceId !== filters.deviceId) return false;
      if (filters.modelId && event.modelId !== filters.modelId) return false;
      if (
        filters.workspace &&
        event.workspaceLabel !== filters.workspace &&
        event.workspaceKeyHash !== filters.workspace
      ) {
        return false;
      }
      return true;
    });
  }

  private authenticateUsageWriter(
    data: TokSyncData,
    rawToken: string | undefined,
    batch: UsageBatchEnvelope,
  ): { user: UserRecord; device: DeviceRecord } | null {
    if (!rawToken) return null;
    const tokenHash = this.hashToken(rawToken);
    if (rawToken.startsWith("tsd_")) {
      const token = data.deviceTokens.find((item) =>
        constantTimeEqual(item.tokenHash, tokenHash),
      );
      if (!token || token.revokedAt || !token.scopes.includes("usage:write")) {
        return null;
      }
      const user = data.users.find((item) => item.id === token.userId);
      const device = data.devices.find((item) => item.id === token.deviceId);
      if (!user || !device || device.revokedAt) return null;
      if (device.id !== batch.device.id) return null;
      token.lastUsedAt = new Date().toISOString();
      return { user, device };
    }

    if (rawToken.startsWith("tsk_")) {
      const token = data.userApiTokens.find((item) =>
        constantTimeEqual(item.tokenHash, tokenHash),
      );
      if (
        !token ||
        token.revokedAt ||
        !token.scopes.includes("usage:write") ||
        (token.expiresAt && Date.parse(token.expiresAt) < Date.now())
      ) {
        return null;
      }
      const user = data.users.find((item) => item.id === token.userId);
      if (!user) return null;
      const existingOwner = data.devices.find(
        (item) => item.id === batch.device.id && item.userId !== user.id,
      );
      if (existingOwner) return null;
      let device = data.devices.find(
        (item) => item.id === batch.device.id && item.userId === user.id,
      );
      const now = new Date().toISOString();
      if (!device) {
        device = {
          id: batch.device.id,
          userId: user.id,
          deviceFingerprintHash: this.hashDeviceFingerprint(
            `user-api:${user.id}:${batch.device.id}`,
          ),
          name: batch.device.name,
          platform: batch.device.platform,
          agentVersion: batch.device.agentVersion,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        };
        data.devices.push(device);
      }
      token.lastUsedAt = now;
      return { user, device };
    }

    return null;
  }

  private refreshSourceHealthInData(
    data: TokSyncData,
    userId: string,
    now: string,
  ) {
    data.sourceHealthSnapshots = data.sourceHealthSnapshots.filter(
      (snapshot) => snapshot.userId !== userId,
    );
    const userRuns = data.syncRuns.filter((run) => run.userId === userId);
    const userEvents = data.usageEvents.filter(
      (event) => event.userId === userId,
    );
    for (const source of SOURCE_REGISTRY) {
      const sourceEvents = userEvents.filter(
        (event) => event.source === source.id,
      );
      const sourceRuns = userRuns.filter((run) => run.sourceSummary[source.id]);
      const lastRun = latest(
        sourceRuns.map((run) => run.finishedAt || run.startedAt),
      );
      const lastEventMs = Math.max(
        0,
        ...sourceEvents.map((event) => event.timestampMs),
      );
      const stale =
        lastRun && Date.now() - Date.parse(lastRun) > 7 * 24 * 60 * 60 * 1000;
      const retentionRisk =
        lastEventMs > 0 && Date.now() - lastEventMs > 21 * 24 * 60 * 60 * 1000;
      const status: SourceHealthSnapshotRecord["status"] =
        sourceEvents.length === 0
          ? "missing"
          : retentionRisk
            ? "retention_risk"
            : stale
              ? "stale"
              : "ok";
      const snapshot: SourceHealthSnapshotRecord = {
        id: randomUUID(),
        userId,
        source: source.id,
        status,
        details: {
          displayName: source.displayName,
          eventCount: sourceEvents.length,
          retentionDays: null,
        },
        createdAt: now,
      };
      if (lastRun) snapshot.lastSuccessfulSyncAt = lastRun;
      if (lastEventMs)
        snapshot.lastEventAt = new Date(lastEventMs).toISOString();
      const recommendedAction = sourceHealthAction(status, source.id);
      if (recommendedAction) snapshot.recommendedAction = recommendedAction;
      data.sourceHealthSnapshots.push(snapshot);
    }
  }

  private refreshCostAnomaliesInData(
    data: TokSyncData,
    userId: string,
    now: string,
  ) {
    const previousById = new Map(
      data.costAnomalies
        .filter((anomaly) => anomaly.userId === userId)
        .map((anomaly) => [anomaly.id, anomaly]),
    );
    const otherAnomalies = data.costAnomalies.filter(
      (anomaly) => anomaly.userId !== userId,
    );
    const nextAnomalies: CostAnomalyRecord[] = [];

    const rules = data.costGuardrailRules.filter(
      (rule) => rule.userId === userId && rule.enabled,
    );
    if (!rules.length) {
      data.costAnomalies = otherAnomalies;
      return;
    }

    const userEvents = data.usageEvents.filter(
      (event) => event.userId === userId,
    );
    if (!userEvents.length) {
      data.costAnomalies = otherAnomalies;
      return;
    }

    for (const rule of rules) {
      const scopedEvents = userEvents.filter((event) =>
        matchesCostGuardrailRule(event, rule),
      );
      if (!scopedEvents.length) continue;

      const latestDate = latestLocalDate(scopedEvents);
      const window = costGuardrailWindow(rule.period, latestDate);
      const periodEvents = scopedEvents.filter((event) =>
        isWithinDateWindow(event.localDate, window),
      );

      const knownCostEvents = periodEvents.filter(
        (event) => typeof event.costUsd === "number",
      );
      const periodCost = round(
        knownCostEvents.reduce((sum, event) => sum + (event.costUsd ?? 0), 0),
      );

      if (periodCost > rule.limitUsd) {
        nextAnomalies.push(
          preserveCostAnomaly(
            previousById,
            buildCostAnomalyRecord(
              userId,
              rule,
              "budget_exceeded",
              "critical",
              now,
              {
                periodStart: window.start,
                periodEnd: window.end,
                deltaUsd: round(periodCost - rule.limitUsd),
                explanation: `${costGuardrailLabel(rule)} ${rule.period} cost reached $${periodCost.toFixed(2)} against a $${rule.limitUsd.toFixed(2)} limit.`,
              },
            ),
          ),
        );
      }

      const unknownPricingCount = periodEvents.length - knownCostEvents.length;
      if (unknownPricingCount > 0) {
        nextAnomalies.push(
          preserveCostAnomaly(
            previousById,
            buildCostAnomalyRecord(
              userId,
              rule,
              "unknown_pricing",
              "warning",
              now,
              {
                periodStart: window.start,
                periodEnd: window.end,
                explanation: `${unknownPricingCount} events in the ${costGuardrailLabel(rule)} ${rule.period} window have unknown pricing and are excluded from budget totals.`,
              },
            ),
          ),
        );
      }

      const spike = detectCostSpike(scopedEvents, rule, latestDate);
      if (spike) {
        nextAnomalies.push(
          preserveCostAnomaly(
            previousById,
            buildCostAnomalyRecord(
              userId,
              rule,
              "cost_spike",
              "warning",
              now,
              spike,
            ),
          ),
        );
      }
    }
    data.costAnomalies = [...otherAnomalies, ...nextAnomalies];
  }

  private refreshMergeIssuesInData(
    data: TokSyncData,
    userId: string,
    now: string,
  ) {
    const skippedBySource = new Map<string, number>();
    for (const run of data.syncRuns.filter((item) => item.userId === userId)) {
      if (run.skippedCount <= 0) continue;
      const sources = Object.keys(run.sourceSummary);
      for (const source of sources.length ? sources : ["unknown"]) {
        skippedBySource.set(
          source,
          (skippedBySource.get(source) ?? 0) + run.skippedCount,
        );
      }
    }
    for (const [source, skipped] of skippedBySource) {
      const existing = data.mergeIssues.find(
        (issue) =>
          issue.userId === userId &&
          issue.source === source &&
          issue.type === "duplicate_history" &&
          issue.status === "open",
      );
      const devices = [
        ...new Set(
          data.syncRuns
            .filter(
              (run) =>
                run.userId === userId &&
                run.skippedCount > 0 &&
                (run.sourceSummary[source] || source === "unknown"),
            )
            .map((run) => run.deviceId),
        ),
      ];
      if (existing) {
        existing.affectedEvents = skipped;
        existing.devices = devices;
        continue;
      }
      data.mergeIssues.push({
        id: randomUUID(),
        userId,
        type: "duplicate_history",
        status: "open",
        source,
        devices,
        affectedEvents: skipped,
        affectedTokens: 0,
        suggestedAction: "confirm_duplicate",
        createdAt: now,
      });
    }
  }

  private hashToken(rawToken: string) {
    return hashOpaqueValue(rawToken, this.secrets.tokenHashSecret);
  }

  private hashDeviceCode(deviceCode: string) {
    return hashOpaqueValue(deviceCode, this.secrets.deviceCodeSecret);
  }

  private hashDeviceFingerprint(fingerprint: string) {
    return hashOpaqueValue(fingerprint, this.secrets.deviceFingerprintPepper);
  }
}

export interface DashboardFilters {
  from?: string;
  to?: string;
  source?: string;
  deviceId?: string;
  modelId?: string;
  workspace?: string;
}

export interface LeaderboardQuery {
  metric?: "tokens" | "active_days" | "streak" | "monthly_tokens";
  period?: "all_time" | "weekly" | "monthly";
  limit?: number;
}

const RECEIPT_UPLOADED_FIELDS = [
  "schemaVersion",
  "source",
  "device identity",
  "workspace label",
  "agent",
  "modelId",
  "providerId",
  "timestampMs",
  "localDate",
  "tokens",
  "costUsd",
  "messageCount",
  "isTurnStart",
];

const RECEIPT_EXCLUDED_FIELDS = [
  "conversation content",
  "assistant replies",
  "tool payloads",
  "file contents",
  "raw project paths",
  "source message identifiers",
  "workspace hashes",
  "secrets",
  "device names",
];

function normalizeCostGuardrailInput(input: CostGuardrailInput) {
  return {
    scope: input.scope,
    period: input.period,
    limitUsd: round(input.limitUsd),
    enabled: input.enabled,
    source: input.scope === "source" ? input.source : undefined,
    modelId: input.scope === "model" ? input.modelId : undefined,
    deviceId: input.scope === "device" ? input.deviceId : undefined,
  };
}

function sameCostGuardrailTarget(
  rule: CostGuardrailRuleRecord,
  userId: string,
  input: CostGuardrailInput,
) {
  const normalized = normalizeCostGuardrailInput(input);
  return (
    rule.userId === userId &&
    rule.scope === normalized.scope &&
    rule.period === normalized.period &&
    rule.source === normalized.source &&
    rule.modelId === normalized.modelId &&
    rule.deviceId === normalized.deviceId
  );
}

function costGuardrailRuleView(rule: CostGuardrailRuleRecord) {
  return {
    id: rule.id,
    scope: rule.scope,
    source: rule.source,
    modelId: rule.modelId,
    deviceId: rule.deviceId,
    period: rule.period,
    limitUsd: rule.limitUsd,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function costAnomalyView(anomaly: CostAnomalyRecord) {
  return {
    id: anomaly.id,
    ruleId: anomaly.ruleId,
    type: anomaly.type,
    severity: anomaly.severity,
    source: anomaly.source,
    modelId: anomaly.modelId,
    deviceId: anomaly.deviceId,
    periodStart: anomaly.periodStart,
    periodEnd: anomaly.periodEnd,
    deltaUsd: anomaly.deltaUsd,
    explanation: anomaly.explanation,
    status: anomaly.status,
    createdAt: anomaly.createdAt,
  };
}

function costGuardrailLabel(rule: CostGuardrailRuleRecord) {
  if (rule.scope === "source") return `Source ${rule.source}`;
  if (rule.scope === "model") return `Model ${rule.modelId}`;
  if (rule.scope === "device") return "Device scope";
  return "Global";
}

function latestLocalDate(events: StoredUsageEvent[]) {
  return (
    events
      .map((event) => event.localDate)
      .sort()
      .at(-1) ?? new Date().toISOString().slice(0, 10)
  );
}

function costGuardrailWindow(
  period: CostGuardrailRuleRecord["period"],
  latestDate: string,
) {
  if (period === "daily") {
    return { start: latestDate, end: latestDate };
  }
  if (period === "weekly") {
    return { start: addDaysToDateString(latestDate, -6), end: latestDate };
  }
  return {
    start: `${latestDate.slice(0, 7)}-01`,
    end: latestDate,
  };
}

function addDaysToDateString(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isWithinDateWindow(
  date: string,
  window: { start: string; end: string },
) {
  return date >= window.start && date <= window.end;
}

function matchesCostGuardrailRule(
  event: StoredUsageEvent,
  rule: CostGuardrailRuleRecord,
) {
  if (rule.scope === "source") return event.source === rule.source;
  if (rule.scope === "model") return event.modelId === rule.modelId;
  if (rule.scope === "device") return event.deviceId === rule.deviceId;
  return true;
}

function buildCostAnomalyRecord(
  userId: string,
  rule: CostGuardrailRuleRecord,
  type: CostAnomalyRecord["type"],
  severity: CostAnomalyRecord["severity"],
  now: string,
  payload: {
    periodStart?: string;
    periodEnd?: string;
    deltaUsd?: number;
    explanation: string;
  },
): CostAnomalyRecord {
  const fingerprint = [
    userId,
    rule.id,
    type,
    payload.periodStart ?? "",
    payload.periodEnd ?? "",
  ].join("\0");
  const anomaly: CostAnomalyRecord = {
    id: `cga_${sha256Base64Url(fingerprint).slice(0, 24)}`,
    userId,
    ruleId: rule.id,
    type,
    severity,
    explanation: payload.explanation,
    status: "open",
    createdAt: now,
  };
  if (rule.source) anomaly.source = rule.source;
  if (rule.modelId) anomaly.modelId = rule.modelId;
  if (rule.deviceId) anomaly.deviceId = rule.deviceId;
  if (payload.periodStart) anomaly.periodStart = payload.periodStart;
  if (payload.periodEnd) anomaly.periodEnd = payload.periodEnd;
  if (payload.deltaUsd !== undefined) anomaly.deltaUsd = payload.deltaUsd;
  return anomaly;
}

function preserveCostAnomaly(
  previousById: Map<string, CostAnomalyRecord>,
  next: CostAnomalyRecord,
) {
  const previous = previousById.get(next.id);
  if (!previous) return next;
  return {
    ...next,
    status: previous.status,
    createdAt: previous.createdAt,
  };
}

function detectCostSpike(
  scopedEvents: StoredUsageEvent[],
  rule: CostGuardrailRuleRecord,
  latestDate: string,
) {
  const dailyCosts = aggregateCostByDate(scopedEvents);
  const latestCost = dailyCosts.get(latestDate) ?? 0;
  if (latestCost <= 0) return null;

  const baselineDates = [...dailyCosts.keys()]
    .filter((date) => date < latestDate)
    .sort()
    .slice(-COST_SPIKE_BASELINE_DAYS);
  if (!baselineDates.length) return null;

  const baselineAverage =
    baselineDates.reduce((sum, date) => sum + (dailyCosts.get(date) ?? 0), 0) /
    baselineDates.length;
  if (baselineAverage <= 0) return null;
  if (
    latestCost < baselineAverage * COST_SPIKE_MULTIPLIER ||
    latestCost - baselineAverage < COST_SPIKE_MIN_DELTA_USD
  ) {
    return null;
  }

  return {
    periodStart: latestDate,
    periodEnd: latestDate,
    deltaUsd: round(latestCost - baselineAverage),
    explanation: `${costGuardrailLabel(rule)} daily cost is $${latestCost.toFixed(2)}, versus a $${baselineAverage.toFixed(2)} baseline over the previous ${baselineDates.length} days.`,
  };
}

function aggregateCostByDate(events: StoredUsageEvent[]) {
  const totals = new Map<string, number>();
  for (const event of events) {
    if (typeof event.costUsd !== "number") continue;
    totals.set(
      event.localDate,
      round((totals.get(event.localDate) ?? 0) + event.costUsd),
    );
  }
  return totals;
}

function aggregatePublicDaily(events: StoredUsageEvent[]) {
  const byDate = new Map<
    string,
    { date: string; tokens: number; costUsd: number }
  >();
  for (const event of events) {
    const current = byDate.get(event.localDate) ?? {
      date: event.localDate,
      tokens: 0,
      costUsd: 0,
    };
    current.tokens += totalTokens(event.tokens);
    current.costUsd = round(current.costUsd + (event.costUsd ?? 0));
    byDate.set(event.localDate, current);
  }
  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function leaderboardEntryFromPublicStats(
  stats: PublicProfileStatsRecord,
  metric: NonNullable<LeaderboardQuery["metric"]>,
  period: NonNullable<LeaderboardQuery["period"]>,
) {
  const window = leaderboardWindowFromDailyPublic(stats.dailyPublic, period);
  const metricValue =
    metric === "tokens"
      ? window.tokens
      : metric === "active_days"
        ? window.activeDays
        : metric === "monthly_tokens"
          ? leaderboardWindowFromDailyPublic(stats.dailyPublic, "monthly")
              .tokens
          : window.streak;

  return {
    username: stats.usernameLower,
    displayName: stats.displayName,
    avatarUrl: stats.avatarUrl,
    totalTokens: stats.totalTokens,
    activeDays: window.activeDays,
    streak: window.streak,
    monthlyTokens: leaderboardWindowFromDailyPublic(
      stats.dailyPublic,
      "monthly",
    ).tokens,
    metricValue,
    lastSyncAt: stats.lastSyncAt,
  };
}

function leaderboardWindowFromDailyPublic(
  dailyPublic: PublicProfileStatsRecord["dailyPublic"],
  period: NonNullable<LeaderboardQuery["period"]>,
) {
  if (!dailyPublic.length) {
    return { tokens: 0, activeDays: 0, streak: 0 };
  }
  const sorted = [...dailyPublic].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const latestDate =
    sorted.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const window =
    period === "weekly"
      ? { start: addDaysToDateString(latestDate, -6), end: latestDate }
      : period === "monthly"
        ? { start: `${latestDate.slice(0, 7)}-01`, end: latestDate }
        : {
            start: sorted[0]?.date ?? latestDate,
            end: latestDate,
          };
  const filtered = sorted.filter((row) => isWithinDateWindow(row.date, window));
  const tokens = round(filtered.reduce((sum, row) => sum + row.tokens, 0));
  const activeDays = filtered.filter((row) => row.tokens > 0).length;
  const streak = currentActiveStreak(filtered, window.end);
  return { tokens, activeDays, streak };
}

function currentActiveStreak(
  rows: Array<{ date: string; tokens: number }>,
  latestDate: string,
) {
  const activeDates = new Set(
    rows.filter((row) => row.tokens > 0).map((row) => row.date),
  );
  let streak = 0;
  let cursor = latestDate;
  while (activeDates.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateString(cursor, -1);
  }
  return streak;
}

function nextLeaderboardSnapshotAt(now: string) {
  const date = new Date(now);
  date.setUTCHours(24, 0, 0, 0);
  return date.toISOString();
}

function buildSyncReceipt(
  userId: string,
  deviceId: string,
  batch: UsageBatchEnvelope,
  syncRun: SyncRunRecord,
  response: {
    status: "accepted" | "rejected";
    inserted: number;
    updated: number;
    skipped: number;
    errors: unknown[];
  },
  now: string,
): SyncReceiptRecord {
  return {
    id: randomUUID(),
    userId,
    deviceId,
    syncRunId: syncRun.id,
    clientRunId: batch.runId,
    mode: batch.mode,
    status: response.status,
    uploadedFields: RECEIPT_UPLOADED_FIELDS,
    excludedFields: RECEIPT_EXCLUDED_FIELDS,
    privacyChecks: [
      { name: "metrics_only_payload", status: "pass" },
      { name: "content_fields_excluded", status: "pass" },
      { name: "raw_paths_excluded", status: "pass" },
    ],
    payloadDigest: `sha256:${sha256Base64Url(JSON.stringify(batch))}`,
    sourceSummary: syncRun.sourceSummary,
    resultSummary: {
      inserted: response.inserted,
      updated: response.updated,
      skipped: response.skipped,
      errors: response.errors.length,
    },
    createdAt: now,
  };
}

function buildPreviewReceipt(batch: UsageBatchEnvelope) {
  return {
    mode: batch.mode,
    uploadedFields: RECEIPT_UPLOADED_FIELDS,
    excludedFields: RECEIPT_EXCLUDED_FIELDS,
    privacyChecks: [
      { name: "metrics_only_payload", status: "pass" },
      { name: "content_fields_excluded", status: "pass" },
      { name: "raw_paths_excluded", status: "pass" },
    ],
    payloadDigest: `sha256:${sha256Base64Url(JSON.stringify(batch))}`,
    sourceSummary: countBy(
      batch.events
        .map((event) => usageEventV1Schema.safeParse(event))
        .filter((result) => result.success)
        .map((result) => result.data),
      "source",
    ),
  };
}

function metricsExportRow(event: StoredUsageEvent) {
  return {
    schemaVersion: event.schemaVersion,
    source: event.source,
    localDate: event.localDate,
    timestampMs: event.timestampMs,
    modelId: event.modelId,
    providerId: event.providerId ?? "",
    inputTokens: event.tokens.input,
    outputTokens: event.tokens.output,
    cacheReadTokens: event.tokens.cacheRead,
    cacheWriteTokens: event.tokens.cacheWrite,
    reasoningTokens: event.tokens.reasoning,
    totalTokens: totalTokens(event.tokens),
    costUsd: event.costUsd ?? 0,
    messageCount: event.messageCount,
    isTurnStart: Boolean(event.isTurnStart),
  };
}

function countVaultDuplicateEvents(
  data: TokSyncData,
  userId: string,
  events: UsageEventV1[],
) {
  const indexes = buildUsageEventIndexes(data, userId);
  return events.filter((event) =>
    Boolean(findExistingUsageEvent(indexes, userId, event)),
  ).length;
}

function toCsv(rows: Array<ReturnType<typeof metricsExportRow>>) {
  const headers = [
    "schemaVersion",
    "source",
    "localDate",
    "timestampMs",
    "modelId",
    "providerId",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "totalTokens",
    "costUsd",
    "messageCount",
    "isTurnStart",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => csvCell(row[header as keyof typeof row]))
        .join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string | number | boolean) {
  const raw =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value)
      ? `'${value}`
      : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceHealthAction(
  status: SourceHealthSnapshotRecord["status"],
  source: string,
) {
  if (status === "missing")
    return `Run toksync sources list and sync ${source}`;
  if (status === "stale") return `Run toksync sync --source ${source}`;
  if (status === "retention_risk")
    return `Sync ${source} before local logs rotate`;
  if (status === "permission_error")
    return `Check local read permissions for ${source}`;
  return undefined;
}

function pruneDeviceCodesInData(data: TokSyncData) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const before = data.deviceCodes.length;
  data.deviceCodes = data.deviceCodes.filter((code) => {
    const expiredLongAgo = Date.parse(code.expiresAt) < cutoff;
    const consumedLongAgo = code.consumedAt
      ? Date.parse(code.consumedAt) < cutoff
      : false;
    return !expiredLongAgo && !consumedLongAgo;
  });
  return data.deviceCodes.length !== before;
}

function userApiTokenMetadataView(token: UserApiTokenRecord) {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
  };
}

function deviceView(device: DeviceRecord, eventCount: number) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    agentVersion: device.agentVersion,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    dataClearedAt: device.dataClearedAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    eventCount,
  };
}

function syncRunView(run: SyncRunRecord) {
  return {
    id: run.id,
    clientRunId: run.clientRunId,
    mode: run.mode,
    status: run.status,
    sourceSummary: run.sourceSummary,
    insertedCount: run.insertedCount,
    updatedCount: run.updatedCount,
    skippedCount: run.skippedCount,
    errorCount: run.errorCount,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function syncReceiptView(receipt: SyncReceiptRecord) {
  return {
    id: receipt.id,
    runId: receipt.clientRunId,
    mode: receipt.mode,
    status: receipt.status,
    uploadedFields: receipt.uploadedFields,
    excludedFields: receipt.excludedFields,
    privacyChecks: receipt.privacyChecks,
    payloadDigest: receipt.payloadDigest,
    sourceSummary: receipt.sourceSummary,
    resultSummary: receipt.resultSummary,
    createdAt: receipt.createdAt,
  };
}

function sourceHealthView(snapshot: SourceHealthSnapshotRecord) {
  return {
    id: snapshot.id,
    source: snapshot.source,
    status: snapshot.status,
    lastSuccessfulSyncAt: snapshot.lastSuccessfulSyncAt,
    lastEventAt: snapshot.lastEventAt,
    details: snapshot.details,
    recommendedAction: snapshot.recommendedAction,
    createdAt: snapshot.createdAt,
  };
}

function mergeIssueView(issue: MergeIssueRecord) {
  return {
    id: issue.id,
    type: issue.type,
    status: issue.status,
    source: issue.source,
    devices: issue.devices,
    affectedEvents: issue.affectedEvents,
    affectedTokens: issue.affectedTokens,
    suggestedAction: issue.suggestedAction,
    createdAt: issue.createdAt,
    resolvedAt: issue.resolvedAt,
  };
}

function buildProfileStats(
  userId: string,
  events: StoredUsageEvent[],
  syncRuns: SyncRunRecord[],
): ProfileStatsRecord {
  const totals = sumEvents(events);
  const dates = [...new Set(events.map((event) => event.localDate))].sort();
  const now = new Date().toISOString();
  const profile: ProfileStatsRecord = {
    userId,
    totalTokens: totals.tokens,
    totalCostUsd: round(totals.costUsd),
    activeDays: dates.length,
    topSources: breakdown(events, "source"),
    topModels: breakdown(events, "modelId"),
    topWorkspaces: publicWorkspaceBreakdown(events),
    updatedAt: now,
  };
  if (dates[0]) profile.dateStart = dates[0];
  const dateEnd = dates[dates.length - 1];
  if (dateEnd) profile.dateEnd = dateEnd;
  const lastSyncAt = latest(
    syncRuns
      .filter((run) => run.userId === userId)
      .map((run) => run.finishedAt || run.startedAt),
  );
  if (lastSyncAt) profile.lastSyncAt = lastSyncAt;
  return profile;
}

function usageDailyView(events: StoredUsageEvent[]) {
  const byDate = new Map<string, StoredUsageEvent[]>();
  for (const event of events) {
    byDate.set(event.localDate, [
      ...(byDate.get(event.localDate) ?? []),
      event,
    ]);
  }
  return {
    days: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => {
        const totals = sumEvents(items);
        const sourceBreakdown: Record<
          string,
          { tokens: number; costUsd: number }
        > = {};
        for (const row of breakdown(items, "source")) {
          sourceBreakdown[row.key] = {
            tokens: row.tokens,
            costUsd: row.costUsd,
          };
        }
        return {
          date,
          tokens: totals.tokens,
          costUsd: round(totals.costUsd),
          sourceBreakdown,
        };
      }),
  };
}

function sumEvents(events: StoredUsageEvent[]) {
  const breakdownTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
  let costUsd = 0;
  let messages = 0;
  for (const event of events) {
    breakdownTotals.input += event.tokens.input;
    breakdownTotals.output += event.tokens.output;
    breakdownTotals.cacheRead += event.tokens.cacheRead;
    breakdownTotals.cacheWrite += event.tokens.cacheWrite;
    breakdownTotals.reasoning += event.tokens.reasoning;
    costUsd += event.costUsd ?? 0;
    messages += event.messageCount;
  }
  return {
    tokens: totalTokens(breakdownTotals),
    breakdown: breakdownTotals,
    costUsd,
    messages,
  };
}

function breakdown(
  events: StoredUsageEvent[],
  key: "source" | "modelId" | "deviceId" | "workspaceLabel",
): BreakdownRow[] {
  const rows = new Map<string, StoredUsageEvent[]>();
  for (const event of events) {
    const value = event[key] || "unknown";
    rows.set(value, [...(rows.get(value) ?? []), event]);
  }
  return [...rows.entries()]
    .map(([rowKey, rowEvents]) => {
      const totals = sumEvents(rowEvents);
      return {
        key: rowKey,
        tokens: totals.tokens,
        costUsd: round(totals.costUsd),
        messages: totals.messages,
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
}

function vaultBreakdown(
  events: StoredUsageEvent[],
  key: "source" | "modelId" | "deviceId" | "workspaceLabel",
) {
  return breakdown(events, key).map((row) => ({
    key: row.key,
    tokens: row.tokens,
    costUsd: row.costUsd,
    messageCount: row.messages,
  }));
}

function publicFieldsForStats(stats: PublicProfileStatsRecord) {
  return [
    "username",
    "totalTokens",
    "activeDays",
    "dateRange",
    "dailyPublic.tokens",
    ...(stats.showCost ? ["totalCostUsd", "dailyPublic.costUsd"] : []),
    ...(stats.showSourceBreakdown ? ["topSources"] : []),
    ...(stats.showModelBreakdown ? ["topModels"] : []),
    ...(stats.showWorkspaceBreakdown ? ["topWorkspaces"] : []),
    "receiptDigests.payloadDigest",
  ];
}

function publicSummaryFromStats(stats: PublicProfileStatsRecord) {
  return {
    totals: {
      totalTokens: stats.totalTokens,
      activeDays: stats.activeDays,
      ...(stats.showCost ? { totalCostUsd: stats.totalCostUsd } : {}),
    },
    dateRange: {
      dateStart: stats.dateStart,
      dateEnd: stats.dateEnd,
      lastSyncAt: stats.lastSyncAt,
    },
    dailyPublic: stats.dailyPublic.map((row) => ({
      date: row.date,
      tokens: row.tokens,
      ...(stats.showCost ? { costUsd: row.costUsd } : {}),
    })),
    topSources: stats.showSourceBreakdown
      ? publicBreakdown(stats.topSources, stats.showCost)
      : [],
    topModels: stats.showModelBreakdown
      ? publicBreakdown(stats.topModels, stats.showCost)
      : [],
    topWorkspaces: stats.showWorkspaceBreakdown
      ? publicBreakdown(stats.topWorkspaces, stats.showCost)
      : [],
    controls: {
      showCost: stats.showCost,
      showSourceBreakdown: stats.showSourceBreakdown,
      showModelBreakdown: stats.showModelBreakdown,
      showWorkspaceBreakdown: stats.showWorkspaceBreakdown,
    },
  };
}

function publicBreakdown(rows: BreakdownRow[], showCost: boolean) {
  return rows.map((row) => ({
    key: row.key,
    tokens: row.tokens,
    messages: row.messages,
    ...(showCost ? { costUsd: row.costUsd } : {}),
  }));
}

function publicWorkspaceBreakdown(events: StoredUsageEvent[]): BreakdownRow[] {
  const publicEvents: StoredUsageEvent[] = [];
  for (const event of events) {
    const workspaceLabel = publicWorkspaceLabel(event.workspaceLabel);
    if (workspaceLabel) publicEvents.push({ ...event, workspaceLabel });
  }
  return breakdown(publicEvents, "workspaceLabel");
}

function publicWorkspaceLabel(label: string | undefined) {
  if (!label) return null;
  if (label.includes("/") || label.includes("\\") || label.includes(":")) {
    return null;
  }
  const sanitized = sanitizeWorkspaceLabel(label);
  return sanitized === label ? sanitized : null;
}

function storedEventFingerprint(event: UsageEventV1) {
  return JSON.stringify({
    deviceId: event.deviceId,
    source: event.source,
    sourceSessionId: event.sourceSessionId,
    sourceMessageId: event.sourceMessageId,
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
  });
}

interface UsageEventIndexes {
  byDedupKey: Map<string, StoredUsageEvent>;
  byStableKey: Map<string, StoredUsageEvent[]>;
}

function buildUsageEventIndexes(data: TokSyncData, userId: string) {
  const indexes: UsageEventIndexes = {
    byDedupKey: new Map(),
    byStableKey: new Map(),
  };
  for (const event of data.usageEvents) {
    if (event.userId === userId) indexUsageEvent(indexes, event);
  }
  return indexes;
}

function indexUsageEvent(indexes: UsageEventIndexes, event: StoredUsageEvent) {
  indexes.byDedupKey.set(
    dedupIndexKey(event.userId, event.source, event.dedupKey),
    event,
  );
  const stableKey = stableUsageIndexKey(event.userId, event);
  indexes.byStableKey.set(stableKey, [
    ...(indexes.byStableKey.get(stableKey) ?? []).filter(
      (item) => item.id !== event.id,
    ),
    event,
  ]);
}

function findExistingUsageEvent(
  indexes: UsageEventIndexes,
  userId: string,
  event: UsageEventV1,
) {
  const exact = indexes.byDedupKey.get(
    dedupIndexKey(userId, event.source, event.dedupKey),
  );
  if (exact) return exact;
  return indexes.byStableKey.get(stableUsageIndexKey(userId, event))?.[0];
}

function removeDuplicateUsageEvents(
  data: TokSyncData,
  indexes: UsageEventIndexes,
  userId: string,
  event: UsageEventV1,
  keepId: string,
) {
  const stableKey = stableUsageIndexKey(userId, event);
  const duplicates = indexes.byStableKey
    .get(stableKey)
    ?.filter((item) => item.id !== keepId);
  if (!duplicates?.length) return;

  const duplicateIds = new Set(duplicates.map((item) => item.id));
  data.usageEvents = data.usageEvents.filter(
    (item) => !duplicateIds.has(item.id),
  );
  for (const duplicate of duplicates) {
    indexes.byDedupKey.delete(
      dedupIndexKey(duplicate.userId, duplicate.source, duplicate.dedupKey),
    );
  }
  indexes.byStableKey.set(
    stableKey,
    (indexes.byStableKey.get(stableKey) ?? []).filter(
      (item) => !duplicateIds.has(item.id),
    ),
  );
}

function dedupIndexKey(userId: string, source: string, dedupKey: string) {
  return `${userId}\0${source}\0${dedupKey}`;
}

function stableUsageIndexKey(
  userId: string,
  event: Pick<
    UsageEventV1,
    "source" | "sourceSessionId" | "sourceMessageId" | "timestampMs"
  >,
) {
  return [
    userId,
    event.source,
    event.sourceSessionId,
    event.sourceMessageId ?? "",
    event.timestampMs,
  ].join("\0");
}

function constantTimeEqual(left: string, right: string) {
  const leftLength = Buffer.byteLength(left);
  const rightLength = Buffer.byteLength(right);
  const width = Math.max(leftLength, rightLength, 1);
  const leftBuffer = Buffer.alloc(width);
  const rightBuffer = Buffer.alloc(width);
  leftBuffer.write(left);
  rightBuffer.write(right);
  return timingSafeEqual(leftBuffer, rightBuffer) && leftLength === rightLength;
}

function latest(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
