import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  apiError,
  isValidUsername,
  normalizeUsername,
  publicProfileInputSchema,
  totalTokens,
  usageBatchV1Schema,
  usageEventV1Schema,
  type DeviceStartInput,
  type PublicProfileInput,
  type UsageBatchV1,
  type UsageEventV1,
} from "@toksync/shared";
import { hashOpaqueValue } from "@toksync/privacy";
import { FileTokSyncStore } from "./store";
import type {
  BreakdownRow,
  DeviceRecord,
  DeviceTokenRecord,
  ProfileStatsRecord,
  PublicProfileStatsRecord,
  StoredUsageEvent,
  SyncRunRecord,
  TokSyncData,
  UsageDailyRecord,
  UserRecord,
} from "./types";

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

export class TokSyncRepository {
  constructor(
    private readonly store = new FileTokSyncStore(),
    private readonly secrets: RepositorySecrets = {
      tokenHashSecret: process.env.TOKEN_HASH_SECRET || "dev-secret-change-me",
      deviceCodeSecret:
        process.env.DEVICE_CODE_SECRET || "dev-secret-change-me",
      deviceFingerprintPepper:
        process.env.DEVICE_FINGERPRINT_PEPPER || "dev-secret-change-me",
    },
  ) {}

  reset() {
    this.store.reset();
  }

  seedDevelopmentUser(username = "demo") {
    const user = this.ensureUser(username, { displayName: "Demo Developer" });
    this.recomputeUser(user.id);
    return user;
  }

  ensureUser(username: string, patch: Partial<UserRecord> = {}) {
    const lower = normalizeUsername(username);
    if (!isValidUsername(username))
      throw new Error(`Invalid username: ${username}`);
    const data = this.store.read();
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
        createdAt: now,
        updatedAt: now,
        ...patch,
      };
      data.users.push(user);
    } else {
      Object.assign(user, patch, { updatedAt: now });
    }
    this.store.write(data);
    return user;
  }

  getUser(username = "demo") {
    const lower = normalizeUsername(username);
    return this.store.read().users.find((item) => item.usernameLower === lower);
  }

  createDeviceCode(input: DeviceStartInput) {
    const data = this.store.read();
    const deviceCode = `dev_${randomBytes(24).toString("base64url")}`;
    const userCode = `TS-${randomBytes(2).toString("hex").toUpperCase()}`;
    const now = new Date();
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
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
    });
    this.store.write(data);
    return {
      deviceCode,
      userCode,
      verificationUrl: `${process.env.APP_URL || "http://localhost:3000"}/device`,
      expiresIn: 900,
      interval: 2,
    };
  }

  authorizeDeviceCode(userCode: string, username = "demo") {
    const data = this.store.read();
    const code = data.deviceCodes.find(
      (item) => item.userCode.toUpperCase() === userCode.toUpperCase(),
    );
    if (!code) return null;
    if (Date.parse(code.expiresAt) < Date.now()) return null;
    if (code.consumedAt) return null;
    const user = this.ensureUser(username, {
      displayName: username === "demo" ? "Demo Developer" : username,
    });
    code.authorizedUserId = user.id;
    this.store.write(data);
    return { status: "authorized", username: user.username };
  }

  pollDeviceCode(deviceCode: string) {
    const data = this.store.read();
    const code = data.deviceCodes.find(
      (item) => item.deviceCodeHash === this.hashDeviceCode(deviceCode),
    );
    if (!code) return { status: "not_found" as const };
    if (Date.parse(code.expiresAt) < Date.now())
      return { status: "expired" as const };
    if (code.consumedAt) return { status: "not_found" as const };
    if (!code.authorizedUserId)
      return { status: "pending" as const, interval: 2 };

    const user = data.users.find((item) => item.id === code.authorizedUserId);
    if (!user) return { status: "not_found" as const };

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
    this.store.write(data);
    return {
      status: "authorized" as const,
      deviceId: device.id,
      deviceToken: rawToken,
      scopes: token.scopes,
      username: user.username,
    };
  }

  authenticateDevice(rawToken?: string | null): AuthContext | null {
    if (!rawToken?.startsWith("tsd_")) return null;
    const data = this.store.read();
    const tokenHash = this.hashToken(rawToken);
    const token = data.deviceTokens.find((item) =>
      constantTimeEqual(item.tokenHash, tokenHash),
    );
    if (!token || token.revokedAt) return null;
    const device = data.devices.find((item) => item.id === token.deviceId);
    const user = data.users.find((item) => item.id === token.userId);
    if (!device || !user || device.revokedAt) return null;
    const now = new Date().toISOString();
    token.lastUsedAt = now;
    device.lastSeenAt = now;
    device.updatedAt = now;
    this.store.write(data);
    return { user, device, token };
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

  ingestUsageBatch(rawToken: string | undefined, rawPayload: unknown) {
    const auth = this.authenticateDevice(rawToken);
    if (!auth)
      return {
        ok: false as const,
        response: apiError("invalid_auth", "Invalid or revoked device token"),
        status: 401,
      };

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

    const data = this.store.read();
    const batch = envelope.data;
    const now = new Date().toISOString();
    let syncRun = data.syncRuns.find(
      (run) =>
        run.userId === auth.user.id &&
        run.deviceId === auth.device.id &&
        run.clientRunId === batch.runId,
    );
    if (!syncRun) {
      syncRun = {
        id: randomUUID(),
        clientRunId: batch.runId,
        userId: auth.user.id,
        deviceId: auth.device.id,
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

    const errors: Array<{ index: number; code: string; message: string }> = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const sourceSummary: Record<string, number> = {};

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
      if (
        event.deviceId !== auth.device.id ||
        batch.device.id !== auth.device.id
      ) {
        errors.push({
          index,
          code: "wrong_device",
          message: "Event device does not match token device",
        });
        continue;
      }

      sourceSummary[event.source] = (sourceSummary[event.source] ?? 0) + 1;
      const existingIndex = findExistingUsageEventIndex(
        data,
        auth.user.id,
        event,
      );
      const existing =
        existingIndex >= 0 ? data.usageEvents[existingIndex] : undefined;
      if (!existing) {
        data.usageEvents.push({
          ...event,
          id: randomUUID(),
          userId: auth.user.id,
          syncRunId: syncRun.id,
          createdAt: now,
          updatedAt: now,
        });
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
        removeDuplicateUsageEvents(data, auth.user.id, event, existing.id);
        updated += 1;
      } else {
        removeDuplicateUsageEvents(data, auth.user.id, event, existing.id);
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
    auth.device.lastSeenAt = now;
    this.recomputeUserInData(data, auth.user.id);
    this.store.write(data);

    return {
      ok: true as const,
      response: {
        runId: batch.runId,
        status: syncRun.status === "failed" ? "rejected" : "accepted",
        inserted,
        updated,
        skipped,
        errors,
        rollupStatus: "completed",
      },
      status: 200,
    };
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
      .map((device) => ({
        ...device,
        eventCount: data.usageEvents.filter(
          (event) => event.deviceId === device.id,
        ).length,
      }));
  }

  listSyncRuns(username = "demo") {
    const user = this.getUser(username);
    if (!user) return [];
    return this.store
      .read()
      .syncRuns.filter((run) => run.userId === user.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  revokeDevice(username: string, deviceId: string) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    const device = user
      ? data.devices.find(
          (item) => item.userId === user.id && item.id === deviceId,
        )
      : undefined;
    if (!user || !device) return null;
    const now = new Date().toISOString();
    device.revokedAt = now;
    for (const token of data.deviceTokens.filter(
      (item) => item.deviceId === device.id,
    )) {
      token.revokedAt = now;
    }
    this.store.write(data);
    return { status: "revoked" };
  }

  deleteDeviceData(username: string, deviceId: string) {
    const data = this.store.read();
    const user = this.userByName(data, username);
    const device = user
      ? data.devices.find(
          (item) => item.userId === user.id && item.id === deviceId,
        )
      : undefined;
    if (!user || !device) return null;
    data.usageEvents = data.usageEvents.filter(
      (event) => event.deviceId !== device.id,
    );
    device.dataClearedAt = new Date().toISOString();
    this.recomputeUserInData(data, user.id);
    this.store.write(data);
    return { status: "completed", jobId: randomUUID() };
  }

  setPublicProfile(username: string, rawInput: PublicProfileInput) {
    const input = publicProfileInputSchema.parse(rawInput);
    const data = this.store.read();
    const user = this.ensureUser(username);
    const current = data.users.find((item) => item.id === user.id);
    if (!current)
      throw new Error("User disappeared during public profile update");
    Object.assign(current, {
      publicProfileEnabled: input.enabled,
      showCost: input.showCost,
      showSourceBreakdown: input.showSourceBreakdown,
      showModelBreakdown: input.showModelBreakdown,
      updatedAt: new Date().toISOString(),
    });
    this.recomputeUserInData(data, current.id);
    this.store.write(data);
    return {
      enabled: current.publicProfileEnabled,
      url: `${process.env.APP_URL || "http://localhost:3000"}/u/${current.username}`,
    };
  }

  getPublicStats(username: string) {
    const lower = normalizeUsername(username);
    return (
      this.store
        .read()
        .publicProfileStats.find((stats) => stats.usernameLower === lower) ??
      null
    );
  }

  private recomputeUser(userId: string) {
    const data = this.store.read();
    this.recomputeUserInData(data, userId);
    this.store.write(data);
  }

  private recomputeUserInData(data: TokSyncData, userId: string) {
    data.usageDaily = data.usageDaily.filter((row) => row.userId !== userId);
    const userEvents = data.usageEvents.filter(
      (event) => event.userId === userId,
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
        dailyPublic: data.usageDaily
          .filter((row) => row.userId === userId)
          .map((row) => ({
            date: row.date,
            tokens: totalTokens(row.tokens),
            costUsd: row.costUsd,
          })),
        leaderboardOptIn: false,
      };
      if (user.displayName) publicStats.displayName = user.displayName;
      if (user.avatarUrl) publicStats.avatarUrl = user.avatarUrl;
      data.publicProfileStats.push(publicStats);
    }
  }

  private userByName(data: TokSyncData, username: string) {
    const lower = normalizeUsername(username);
    return data.users.find((user) => user.usernameLower === lower);
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

function findExistingUsageEventIndex(
  data: TokSyncData,
  userId: string,
  event: UsageEventV1,
) {
  const exactIndex = data.usageEvents.findIndex(
    (item) =>
      item.userId === userId &&
      item.source === event.source &&
      item.dedupKey === event.dedupKey,
  );
  if (exactIndex >= 0) return exactIndex;

  return data.usageEvents.findIndex(
    (item) => item.userId === userId && sameStableUsageIdentity(item, event),
  );
}

function removeDuplicateUsageEvents(
  data: TokSyncData,
  userId: string,
  event: UsageEventV1,
  keepId: string,
) {
  for (let index = data.usageEvents.length - 1; index >= 0; index -= 1) {
    const item = data.usageEvents[index];
    if (
      item &&
      item.id !== keepId &&
      item.userId === userId &&
      sameStableUsageIdentity(item, event)
    ) {
      data.usageEvents.splice(index, 1);
    }
  }
}

function sameStableUsageIdentity(left: StoredUsageEvent, right: UsageEventV1) {
  return (
    left.source === right.source &&
    left.sourceSessionId === right.sourceSessionId &&
    left.sourceMessageId === right.sourceMessageId &&
    left.timestampMs === right.timestampMs
  );
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
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
