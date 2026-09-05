import {
  createCipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { SOURCE_REGISTRY } from "@toksync/shared";
import { FileTokSyncStore } from "./store";
import { FileVaultArtifactStore, TokSyncRepository } from "./repository";
import { PostgresVaultExportRepository } from "./vault-postgres";
import type { TokSyncData, VaultExportRecord } from "./types";

class FakeVaultDb {
  rows: any[] = [];

  select() {
    const query = {
      from: () => query,
      where: () => query,
      orderBy: () => Promise.resolve(this.rows),
      then: (resolve: (rows: any[]) => unknown) =>
        Promise.resolve(this.rows).then(resolve),
    };
    return query;
  }

  insert() {
    return {
      values: (row: any) => {
        this.rows.push(row);
        return Promise.resolve();
      },
    };
  }
}

class FakeVaultArtifactStore {
  payloads = new Map<string, any>();

  put({
    userId,
    exportId,
    payload,
  }: {
    userId: string;
    exportId: string;
    payload: any;
  }) {
    const key = `vault/${userId}/${exportId}.json`;
    this.payloads.set(key, payload);
    return key;
  }

  get(storageKey: string) {
    return this.payloads.get(storageKey) ?? null;
  }
}

class TrackingFileStore extends FileTokSyncStore {
  writes = 0;
  transactions = 0;

  override write(data?: TokSyncData) {
    this.writes += 1;
    return super.write(data);
  }

  override transaction<T>(
    operation: (data: TokSyncData) => { result: T; commit: boolean },
  ): T {
    this.transactions += 1;
    return super.transaction(operation);
  }
}

function createRepo() {
  return createRepoWithStore().repo;
}

function createRepoWithStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
  const file = path.join(dir, "db.json");
  const store = new FileTokSyncStore(file);
  return { repo: new TokSyncRepository(store), store, file };
}

function createRepoWithTrackingStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
  const file = path.join(dir, "db.json");
  const store = new TrackingFileStore(file);
  return { repo: new TokSyncRepository(store), store, file };
}

function authorizeDevice(
  repo: TokSyncRepository,
  username = "demo",
  deviceFingerprint = `${username}-fingerprint`,
) {
  const started = repo.createDeviceCode({
    deviceName: "Test device",
    platform: "windows",
    agentVersion: "0.1.0",
    deviceFingerprint,
  });
  repo.authorizeDeviceCode(started.userCode, username);
  const auth = repo.pollDeviceCode(started.deviceCode);
  expect(auth.status).toBe("authorized");
  if (auth.status !== "authorized") throw new Error("login failed");
  return auth;
}

function usageEvent(
  deviceId: string,
  localDate: string,
  costUsd?: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1 as const,
    source: "codex",
    sourceSessionId: `session-${localDate}`,
    sourceMessageId: `message-${localDate}`,
    dedupKey: `codex:${deviceId}:${localDate}:${String(overrides["sourceMessageId"] ?? "default")}`,
    deviceId,
    workspaceKeyHash: "sha256:test",
    workspaceLabel: "repo",
    modelId: "gpt-5.4",
    providerId: "openai",
    timestampMs: Date.parse(`${localDate}T12:00:00.000Z`),
    localDate,
    tokens: {
      input: 100,
      output: 40,
      cacheRead: 5,
      cacheWrite: 2,
      reasoning: 10,
    },
    ...(costUsd === undefined ? {} : { costUsd }),
    messageCount: 1,
    isTurnStart: true,
    ...overrides,
  };
}

function ingestEvents(
  repo: TokSyncRepository,
  auth: ReturnType<typeof authorizeDevice>,
  events: Array<ReturnType<typeof usageEvent>>,
  runId = "run-1",
) {
  const result = repo.ingestUsageBatch(auth.deviceToken, {
    schemaVersion: 1,
    runId,
    device: {
      id: auth.deviceId,
      name: "Test device",
      platform: "windows",
      agentVersion: "0.1.0",
    },
    mode: "sync",
    sourceVersions: { codex: null },
    events,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("ingest failed");
  return result.response;
}

describe("TokSyncRepository", () => {
  it("rejects production startup with default repository secrets", () => {
    const previous = process.env.NODE_ENV;
    const previousSecrets = {
      TOKEN_HASH_SECRET: process.env.TOKEN_HASH_SECRET,
      DEVICE_CODE_SECRET: process.env.DEVICE_CODE_SECRET,
      DEVICE_FINGERPRINT_PEPPER: process.env.DEVICE_FINGERPRINT_PEPPER,
    };
    process.env.NODE_ENV = "production";
    delete process.env.TOKEN_HASH_SECRET;
    delete process.env.DEVICE_CODE_SECRET;
    delete process.env.DEVICE_FINGERPRINT_PEPPER;
    try {
      expect(() => new TokSyncRepository()).toThrow(/TOKEN_HASH_SECRET/);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
      for (const [key, value] of Object.entries(previousSecrets)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("returns a consumed status after device-code token issuance", () => {
    const repo = createRepo();
    const started = repo.createDeviceCode({
      deviceName: "Test device",
      platform: "windows",
      agentVersion: "0.1.0",
      deviceFingerprint: "fingerprint",
    });
    repo.authorizeDeviceCode(started.userCode, "demo");
    expect(repo.pollDeviceCode(started.deviceCode).status).toBe("authorized");
    expect(repo.pollDeviceCode(started.deviceCode)).toEqual({
      status: "consumed",
    });
  });

  it("uses DEVICE_CODE_TTL_SECONDS when creating device codes", () => {
    const previous = process.env.DEVICE_CODE_TTL_SECONDS;
    process.env.DEVICE_CODE_TTL_SECONDS = "60";
    try {
      const repo = createRepo();
      const started = repo.createDeviceCode({
        deviceName: "Short lived device",
        platform: "windows",
        agentVersion: "0.1.0",
        deviceFingerprint: "short-lived",
      });

      expect(started.expiresIn).toBe(60);
    } finally {
      if (previous === undefined) {
        delete process.env.DEVICE_CODE_TTL_SECONDS;
      } else {
        process.env.DEVICE_CODE_TTL_SECONDS = previous;
      }
    }
  });

  it("prevents stale FileStore writes from overwriting concurrent disk changes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
    const file = path.join(dir, "db.json");
    const firstStore = new FileTokSyncStore(file);
    const secondStore = new FileTokSyncStore(file);
    firstStore.reset();
    const firstData = firstStore.read();
    const secondData = secondStore.read();
    sleepSync(10);

    firstData.users.push({
      id: "user-1",
      username: "demo",
      usernameLower: "demo",
      publicProfileEnabled: false,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
      showWorkspaceBreakdown: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
    firstStore.write(firstData);

    secondData.users.push({
      id: "user-2",
      username: "other",
      usernameLower: "other",
      publicProfileEnabled: false,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
      showWorkspaceBreakdown: false,
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
    expect(() => secondStore.write(secondData)).toThrow(/changed on disk/);
  });

  it("merges FileStore transactions from stale readers by rereading under the lock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
    const file = path.join(dir, "db.json");
    const firstStore = new FileTokSyncStore(file);
    const secondStore = new FileTokSyncStore(file);
    firstStore.reset();
    secondStore.read();

    firstStore.transaction((data) => {
      data.users.push({
        id: "user-1",
        username: "demo",
        usernameLower: "demo",
        publicProfileEnabled: false,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
        showWorkspaceBreakdown: false,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      });
      return { commit: true, result: null };
    });

    secondStore.transaction((data) => {
      data.users.push({
        id: "user-2",
        username: "other",
        usernameLower: "other",
        publicProfileEnabled: false,
        showCost: false,
        showSourceBreakdown: false,
        showModelBreakdown: false,
        showWorkspaceBreakdown: false,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      });
      return { commit: true, result: null };
    });

    expect(
      new FileTokSyncStore(file).read().users.map((user) => user.username),
    ).toEqual(["demo", "other"]);
  });

  it("routes repository mutations through FileStore transactions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
    const store = new TrackingFileStore(path.join(dir, "db.json"));
    const repo = new TokSyncRepository(store);
    const auth = authorizeDevice(repo);

    repo.setPublicProfile("demo", {
      enabled: true,
      showCost: false,
      showSourceBreakdown: true,
      showModelBreakdown: false,
    });
    repo.upsertCostGuardrail("demo", {
      scope: "global",
      period: "daily",
      limitUsd: 10,
      enabled: true,
    });
    repo.revokeDevice("demo", auth.deviceId);

    expect(store.transactions).toBeGreaterThanOrEqual(6);
    expect(store.writes).toBe(0);
  });

  it("waits for an active FileStore lock held by another process", async () => {
    const { store, file } = createRepoWithStore();
    store.reset();
    const lockPath = `${file}.lock`;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from "node:fs";
          const lockPath = ${JSON.stringify(lockPath)};
          const fd = fs.openSync(lockPath, "wx");
          fs.writeFileSync(fd, process.pid + "\\n" + new Date().toISOString() + "\\n");
          setTimeout(() => {
            fs.closeSync(fd);
            fs.rmSync(lockPath, { force: true });
          }, 150);
          setTimeout(() => process.exit(0), 250);
        `,
      ],
      { stdio: "ignore" },
    );
    await waitForFile(lockPath);

    const data = store.read();
    data.users.push({
      id: "lock-test-user",
      username: "lock-test",
      usernameLower: "lock-test",
      publicProfileEnabled: false,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
      showWorkspaceBreakdown: false,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    });
    store.write(data);
    const [code] = await once(child, "exit");

    expect(code).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
    expect(new FileTokSyncStore(file).read().users[0]?.username).toBe(
      "lock-test",
    );
  });

  it("keeps usage ingestion idempotent and recomputes after device deletion", () => {
    const repo = createRepo();
    const started = repo.createDeviceCode({
      deviceName: "Test device",
      platform: "windows",
      agentVersion: "0.1.0",
      deviceFingerprint: "fingerprint",
    });
    expect(repo.authorizeDeviceCode(started.userCode, "demo")).toEqual({
      status: "authorized",
      username: "demo",
    });
    const auth = repo.pollDeviceCode(started.deviceCode);
    expect(auth.status).toBe("authorized");
    if (auth.status !== "authorized") throw new Error("login failed");

    const payload = {
      schemaVersion: 1,
      runId: "run-1",
      device: {
        id: auth.deviceId,
        name: "Test device",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: { codex: null },
      events: [
        {
          schemaVersion: 1,
          source: "codex",
          sourceSessionId: "session-1",
          sourceMessageId: "message-1",
          dedupKey: "codex:session-1:message-1",
          deviceId: auth.deviceId,
          workspaceKeyHash: "sha256:test",
          workspaceLabel: "repo",
          modelId: "gpt-5.4",
          providerId: "openai",
          timestampMs: 1770000000000,
          localDate: "2026-02-03",
          tokens: {
            input: 100,
            output: 40,
            cacheRead: 5,
            cacheWrite: 2,
            reasoning: 10,
          },
          costUsd: 0.01,
          messageCount: 1,
          isTurnStart: true,
        },
      ],
    };

    const first = repo.ingestUsageBatch(auth.deviceToken, payload);
    const second = repo.ingestUsageBatch(auth.deviceToken, payload);
    expect(first.ok && first.response.inserted).toBe(1);
    expect(second.ok && second.response.skipped).toBe(1);
    expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(157);

    repo.setPublicProfile("demo", {
      enabled: true,
      showCost: true,
      showSourceBreakdown: false,
      showModelBreakdown: false,
    });
    expect(repo.getPublicStats("demo")?.totalTokens).toBe(157);
    expect(repo.dashboardSummary("demo")?.lastSyncAt).toEqual(
      expect.any(String),
    );
    expect(repo.dashboardOverview("demo")?.summary.lastSyncAt).toEqual(
      expect.any(String),
    );
    expect(repo.getPublicStats("demo")?.lastSyncAt).toEqual(expect.any(String));

    repo.deleteDeviceData("demo", auth.deviceId);
    expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(0);
    expect(repo.dashboardSummary("demo")?.lastSyncAt).toBeUndefined();
    expect(repo.dashboardOverview("demo")?.summary.lastSyncAt).toBeUndefined();
    expect(repo.getPublicStats("demo")?.totalTokens).toBe(0);
    expect(repo.getPublicStats("demo")?.lastSyncAt).toBeUndefined();
  });

  it("falls back to remaining device sync timestamps after clearing recent device data", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-03T12:00:00.000Z"));
      const repo = createRepo();
      const first = authorizeDevice(repo);
      ingestEvents(
        repo,
        first,
        [
          usageEvent(first.deviceId, "2026-02-03", 0.01, {
            dedupKey: "codex:first-device-before-delete",
            sourceMessageId: "first-device-before-delete",
          }),
        ],
        "first-device-run",
      );
      const firstSyncAt = repo.dashboardSummary("demo")?.lastSyncAt;
      expect(firstSyncAt).toEqual("2026-02-03T12:00:00.000Z");

      vi.setSystemTime(new Date("2026-02-04T12:00:00.000Z"));
      const second = authorizeDevice(repo, "demo", "demo-second-fingerprint");
      ingestEvents(
        repo,
        second,
        [
          usageEvent(second.deviceId, "2026-02-04", 0.02, {
            dedupKey: "codex:second-device-before-delete",
            sourceMessageId: "second-device-before-delete",
          }),
        ],
        "second-device-run",
      );
      repo.setPublicProfile("demo", {
        enabled: true,
        showCost: true,
        showSourceBreakdown: false,
        showModelBreakdown: false,
      });
      expect(repo.dashboardSummary("demo")?.lastSyncAt).toEqual(
        "2026-02-04T12:00:00.000Z",
      );
      expect(repo.getPublicStats("demo")?.lastSyncAt).toEqual(
        "2026-02-04T12:00:00.000Z",
      );

      vi.setSystemTime(new Date("2026-02-05T12:00:00.000Z"));
      repo.deleteDeviceData("demo", second.deviceId);
      expect(repo.listSyncRuns("demo").map((run) => run.clientRunId)).toEqual([
        "second-device-run",
        "first-device-run",
      ]);
      expect(repo.dashboardSummary("demo")?.lastSyncAt).toEqual(firstSyncAt);
      expect(repo.dashboardOverview("demo")?.summary.lastSyncAt).toEqual(
        firstSyncAt,
      );
      expect(repo.dashboardOverview("demo")?.status.lastSyncAt).toEqual(
        firstSyncAt,
      );
      expect(repo.getPublicStats("demo")?.lastSyncAt).toEqual(firstSyncAt);

      ingestEvents(
        repo,
        second,
        [
          usageEvent(second.deviceId, "2026-02-05", 0.03, {
            dedupKey: "codex:second-device-after-delete",
            sourceMessageId: "second-device-after-delete",
          }),
        ],
        "second-device-run",
      );

      expect(repo.dashboardSummary("demo")?.lastSyncAt).toEqual(
        "2026-02-05T12:00:00.001Z",
      );
      expect(
        repo
          .listSyncRuns("demo")
          .find((run) => run.clientRunId === "second-device-run")?.startedAt,
      ).toBe("2026-02-04T12:00:00.000Z");
      expect(repo.dashboardOverview("demo")?.summary.lastSyncAt).toEqual(
        "2026-02-05T12:00:00.001Z",
      );
      expect(repo.dashboardOverview("demo")?.status.lastSyncAt).toEqual(
        "2026-02-05T12:00:00.001Z",
      );
      expect(repo.getPublicStats("demo")?.lastSyncAt).toEqual(
        "2026-02-05T12:00:00.001Z",
      );

      repo.deleteDeviceData("demo", second.deviceId);
      expect(repo.dashboardSummary("demo")?.lastSyncAt).toEqual(firstSyncAt);
      expect(repo.dashboardOverview("demo")?.summary.lastSyncAt).toEqual(
        firstSyncAt,
      );
      expect(repo.dashboardOverview("demo")?.status.lastSyncAt).toEqual(
        firstSyncAt,
      );
      expect(repo.getPublicStats("demo")?.lastSyncAt).toEqual(firstSyncAt);

      repo.deleteDeviceData("demo", first.deviceId);
      expect(repo.dashboardSummary("demo")?.lastSyncAt).toBeUndefined();
      expect(
        repo.dashboardOverview("demo")?.summary.lastSyncAt,
      ).toBeUndefined();
      expect(repo.dashboardOverview("demo")?.status.lastSyncAt).toBeUndefined();
      expect(repo.getPublicStats("demo")?.lastSyncAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore public workspace labels after submitted data deletion", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          workspaceLabel: "oss-repo",
          workspaceKeyHash: "sha256:public-label",
        }),
      ],
      "workspace-public-run",
    );

    repo.setPublicProfile("demo", {
      enabled: true,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
      showWorkspaceBreakdown: true,
    });
    expect(repo.getPublicStats("demo")?.topWorkspaces).toEqual([
      { key: "oss-repo", tokens: 157, costUsd: 0.01, messages: 1 },
    ]);

    repo.deleteSubmittedData("demo");

    expect(repo.getUser("demo")).toMatchObject({
      publicProfileEnabled: false,
      showWorkspaceBreakdown: false,
    });
    expect(repo.getPublicStats("demo")).toBeNull();

    repo.setPublicProfile("demo", {
      enabled: true,
      showCost: false,
      showSourceBreakdown: false,
      showModelBreakdown: false,
      showWorkspaceBreakdown: false,
    });

    expect(repo.getPublicStats("demo")).toMatchObject({
      showWorkspaceBreakdown: false,
      topWorkspaces: [],
    });
    const proofPack = repo.getPublicProofPack("demo");
    expect(proofPack?.publicFields).not.toContain("topWorkspaces");
    expect(proofPack?.summary).toMatchObject({
      topWorkspaces: [],
      controls: {
        showWorkspaceBreakdown: false,
      },
    });
  });

  it("extends dashboard overview with compact stored sync status counts", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-03T13:00:00.000Z"));
      const { repo, store } = createRepoWithStore();
      const auth = authorizeDevice(repo);
      const result = repo.ingestUsageBatch(auth.deviceToken, {
        schemaVersion: 1,
        runId: "partial-run",
        device: {
          id: auth.deviceId,
          name: "Test device",
          platform: "windows",
          agentVersion: "0.1.0",
        },
        mode: "sync",
        sourceVersions: { codex: null },
        events: [
          usageEvent(auth.deviceId, "2026-02-03", 0.01, {
            dedupKey: "codex:overview-status-valid",
            sourceMessageId: "overview-status-valid",
          }),
          usageEvent("other-device", "2026-02-03", 0.01, {
            dedupKey: "codex:overview-status-wrong-device",
            sourceMessageId: "overview-status-wrong-device",
          }),
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("ingest failed");

      const user = repo.getUser("demo");
      expect(user).toBeDefined();
      if (!user) throw new Error("missing demo user");

      const data = store.read();
      data.mergeIssues.push({
        id: "merge-open",
        userId: user.id,
        type: "workspace_label_conflict",
        status: "open",
        source: "codex",
        devices: [auth.deviceId],
        affectedEvents: 1,
        affectedTokens: 157,
        suggestedAction: "rename_workspace",
        createdAt: "2026-02-03T12:00:02.000Z",
      });
      data.mergeIssues.push({
        id: "merge-resolved",
        userId: user.id,
        type: "identity_conflict",
        status: "resolved",
        source: "codex",
        devices: [auth.deviceId],
        affectedEvents: 1,
        affectedTokens: 157,
        suggestedAction: "split_device_identity",
        createdAt: "2026-02-03T12:00:01.000Z",
        resolvedAt: "2026-02-03T12:00:03.000Z",
      });
      store.write(data);

      const overview = repo.dashboardOverview("demo");

      expect(overview?.status?.state).toBe("needs_attention");
      expect(overview?.status?.lastSyncAt).toEqual(expect.any(String));
      expect(overview?.status?.latestRun).toMatchObject({
        clientRunId: "partial-run",
        status: "partial",
        insertedCount: 1,
        skippedCount: 0,
        errorCount: 1,
      });
      expect(overview?.status?.counts.latestRunErrors).toBe(1);
      expect(overview?.status?.counts.mergeIssues).toBe(1);
      expect(overview?.status?.counts.sourceHealthIssues).toBe(0);
      expect(overview?.status?.totalIssues).toBe(
        (overview?.status?.counts.latestRunErrors ?? 0) +
          (overview?.status?.counts.mergeIssues ?? 0) +
          (overview?.status?.counts.sourceHealthIssues ?? 0),
      );
      const sourceHealth = repo.sourceHealth("demo");
      expect(sourceHealth).toHaveLength(SOURCE_REGISTRY.length);
      expect(sourceHealth).toContainEqual(
        expect.objectContaining({
          source: "codex",
        }),
      );
      expect(sourceHealth.filter((row) => row.recommendedAction)).toHaveLength(
        overview?.status?.counts.sourceHealthIssues ?? 0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report unused source health rows as actionable dashboard issues", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-03T13:00:00.000Z"));
      const repo = createRepo();
      authorizeDevice(repo);

      expect(repo.dashboardOverview("demo")?.status).toMatchObject({
        state: "waiting_for_sync",
        counts: {
          latestRunErrors: 0,
          mergeIssues: 0,
          sourceHealthIssues: 0,
        },
        totalIssues: 0,
      });

      const auth = authorizeDevice(repo, "demo-codex-only");
      ingestEvents(
        repo,
        auth,
        [
          usageEvent(auth.deviceId, "2026-02-03", 0.01, {
            dedupKey: "codex:only-configured-source",
            sourceMessageId: "only-configured-source",
          }),
        ],
        "only-codex-run",
      );

      const overview = repo.dashboardOverview("demo-codex-only");
      const sourceHealth = repo.sourceHealth("demo-codex-only");

      expect(overview?.status?.state).toBe("healthy");
      expect(overview?.status?.counts.sourceHealthIssues).toBe(0);
      expect(sourceHealth).toHaveLength(SOURCE_REGISTRY.length);
      expect(sourceHealth).toContainEqual(
        expect.objectContaining({
          source: "codex",
          status: "ok",
        }),
      );
      expect(
        sourceHealth.filter(
          (row) => row.source !== "codex" && row.status !== "ok",
        ),
      ).not.toHaveLength(0);
      expect(sourceHealth.filter((row) => row.recommendedAction)).toHaveLength(
        0,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps dashboard overview and source health reads from mutating stored snapshots", () => {
    const { repo, store } = createRepoWithTrackingStore();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          dedupKey: "codex:read-only-health",
          sourceMessageId: "read-only-health",
        }),
      ],
      "read-only-health-run",
    );
    const before = {
      transactions: store.transactions,
      writes: store.writes,
      sourceHealthSnapshots: store.read().sourceHealthSnapshots,
    };

    repo.dashboardOverview("demo");
    repo.sourceHealth("demo");

    expect(store.transactions).toBe(before.transactions);
    expect(store.writes).toBe(before.writes);
    expect(store.read().sourceHealthSnapshots).toEqual(
      before.sourceHealthSnapshots,
    );
  });

  it("refreshes source health to stale on read-only time advancement", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-03T13:00:00.000Z"));
      const repo = createRepo();
      const auth = authorizeDevice(repo);
      ingestEvents(
        repo,
        auth,
        SOURCE_REGISTRY.map((source, index) =>
          usageEvent(auth.deviceId, "2026-02-03", 0.01, {
            source: source.id,
            sourceSessionId: `stale-${source.id}-session`,
            sourceMessageId: `stale-${source.id}-message`,
            dedupKey: `${source.id}:stale-${index}`,
          }),
        ),
        "fresh-source-health-run",
      );

      const initial = repo.sourceHealth("demo");
      expect(initial).toHaveLength(SOURCE_REGISTRY.length);
      expect(initial.every((row) => row.status === "ok")).toBe(true);

      vi.setSystemTime(new Date("2026-02-11T13:00:00.000Z"));

      const stale = repo.sourceHealth("demo");
      expect(stale).toHaveLength(SOURCE_REGISTRY.length);
      expect(stale.every((row) => row.status === "stale")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes cleared-device duplicate issues from merge issue derivation", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    const duplicateEvent = usageEvent(auth.deviceId, "2026-02-03", 0.01, {
      dedupKey: "codex:cleared-device-duplicate",
      sourceMessageId: "cleared-device-duplicate",
    });

    ingestEvents(repo, auth, [duplicateEvent], "cleared-device-base-run");
    ingestEvents(repo, auth, [duplicateEvent], "cleared-device-duplicate-run");

    expect(repo.mergeIssues("demo")).toEqual([
      expect.objectContaining({
        type: "duplicate_history",
        status: "open",
        devices: [auth.deviceId],
        affectedEvents: 1,
      }),
    ]);

    repo.deleteDeviceData("demo", auth.deviceId);

    expect(
      repo
        .mergeIssues("demo")
        .filter((issue) => issue.type === "duplicate_history"),
    ).toEqual([]);
  });

  it("ignores cleared-device sync runs when deriving source health", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-03T13:00:00.000Z"));
      const repo = createRepo();
      const auth = authorizeDevice(repo);
      ingestEvents(
        repo,
        auth,
        [
          usageEvent(auth.deviceId, "2026-02-03", 0.01, {
            dedupKey: "codex:cleared-source-health",
            sourceMessageId: "cleared-source-health",
          }),
        ],
        "cleared-source-health-run",
      );

      repo.deleteDeviceData("demo", auth.deviceId);

      expect(repo.listSyncRuns("demo")).toHaveLength(1);
      const sourceHealth = repo.sourceHealth("demo");
      expect(sourceHealth).toContainEqual(
        expect.objectContaining({
          source: "codex",
          status: "missing",
          lastSuccessfulSyncAt: undefined,
          lastEventAt: undefined,
          recommendedAction: undefined,
        }),
      );
      expect(sourceHealth.filter((row) => row.recommendedAction)).toHaveLength(
        0,
      );
      const status = repo.dashboardOverview("demo")?.status;
      expect(status).toMatchObject({
        state: "waiting_for_sync",
        latestRun: null,
        counts: {
          sourceHealthIssues: 0,
        },
        totalIssues: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps resolved duplicate issues resolved until skipped evidence increases", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
    const file = path.join(dir, "db.json");
    const store = new TrackingFileStore(file);
    const repo = new TokSyncRepository(store);
    const auth = authorizeDevice(repo);
    const duplicateEvent = usageEvent(auth.deviceId, "2026-02-03", 0.01, {
      dedupKey: "codex:resolved-duplicate",
      sourceMessageId: "resolved-duplicate",
    });

    ingestEvents(repo, auth, [duplicateEvent], "resolved-duplicate-base-run");
    ingestEvents(repo, auth, [duplicateEvent], "resolved-duplicate-run");

    const openIssue = repo
      .mergeIssues("demo")
      .find(
        (issue) =>
          issue.type === "duplicate_history" && issue.status === "open",
      );
    expect(openIssue).toBeDefined();
    if (!openIssue) throw new Error("missing duplicate issue");

    repo.resolveMergeIssue("demo", openIssue.id, "confirm_duplicate");
    const transactionsBeforeRead = store.transactions;

    expect(
      repo
        .mergeIssues("demo")
        .filter((issue) => issue.type === "duplicate_history"),
    ).toEqual([
      expect.objectContaining({
        id: openIssue.id,
        status: "resolved",
        source: "codex",
        affectedEvents: 1,
      }),
    ]);
    expect(store.transactions).toBe(transactionsBeforeRead + 1);

    ingestEvents(repo, auth, [duplicateEvent], "resolved-duplicate-run-2");

    expect(
      repo
        .mergeIssues("demo")
        .filter((issue) => issue.type === "duplicate_history"),
    ).toEqual([
      expect.objectContaining({
        status: "open",
        source: "codex",
        affectedEvents: 2,
      }),
      expect.objectContaining({
        id: openIssue.id,
        status: "resolved",
        source: "codex",
        affectedEvents: 1,
      }),
    ]);
  });

  it("keeps compact latest run ordering aligned with listSyncRuns", () => {
    const { repo, store } = createRepoWithStore();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          dedupKey: "codex:ordering-first",
          sourceMessageId: "ordering-first",
        }),
      ],
      "ordering-first-run",
    );
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-04", 0.01, {
          dedupKey: "codex:ordering-second",
          sourceMessageId: "ordering-second",
        }),
      ],
      "ordering-second-run",
    );

    const data = store.read();
    const firstRun = data.syncRuns.find(
      (run) => run.clientRunId === "ordering-first-run",
    );
    const secondRun = data.syncRuns.find(
      (run) => run.clientRunId === "ordering-second-run",
    );
    expect(firstRun).toBeDefined();
    expect(secondRun).toBeDefined();
    if (!firstRun || !secondRun) throw new Error("missing sync runs");

    firstRun.startedAt = "2026-02-03T10:00:00.000Z";
    firstRun.finishedAt = "2026-02-03T12:00:00.000Z";
    secondRun.startedAt = "2026-02-03T11:00:00.000Z";
    secondRun.finishedAt = "2026-02-03T11:05:00.000Z";
    store.write(data);

    const runs = repo.listSyncRuns("demo");
    const overview = repo.dashboardOverview("demo");

    expect(runs[0]?.clientRunId).toBe("ordering-second-run");
    expect(overview?.status?.latestRun?.clientRunId).toBe(runs[0]?.clientRunId);
  });

  it("updates events when parser fixes change generated dedup keys", () => {
    const repo = createRepo();
    const started = repo.createDeviceCode({
      deviceName: "Test device",
      platform: "windows",
      agentVersion: "0.1.0",
      deviceFingerprint: "fingerprint",
    });
    repo.authorizeDeviceCode(started.userCode, "demo");
    const auth = repo.pollDeviceCode(started.deviceCode);
    expect(auth.status).toBe("authorized");
    if (auth.status !== "authorized") throw new Error("login failed");

    const event = {
      schemaVersion: 1 as const,
      source: "codex",
      sourceSessionId: "session-1",
      sourceMessageId: "message-1",
      dedupKey: "codex:legacy-token-sensitive-key",
      deviceId: auth.deviceId,
      workspaceKeyHash: "sha256:test",
      workspaceLabel: "repo",
      modelId: "gpt-5.4",
      providerId: "openai",
      timestampMs: 1770000000000,
      localDate: "2026-02-03",
      tokens: {
        input: 100,
        output: 40,
        cacheRead: 20,
        cacheWrite: 0,
        reasoning: 10,
      },
      costUsd: 0.02,
      messageCount: 1,
      isTurnStart: true,
    };

    const first = repo.ingestUsageBatch(auth.deviceToken, {
      schemaVersion: 1,
      runId: "legacy-run",
      device: {
        id: auth.deviceId,
        name: "Test device",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: { codex: null },
      events: [event],
    });
    const second = repo.ingestUsageBatch(auth.deviceToken, {
      schemaVersion: 1,
      runId: "fixed-run",
      device: {
        id: auth.deviceId,
        name: "Test device",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: { codex: null },
      events: [
        {
          ...event,
          dedupKey: "codex:stable-source-message-key",
          tokens: {
            ...event.tokens,
            input: 80,
          },
          costUsd: 0.01,
        },
      ],
    });

    expect(first.ok && first.response.inserted).toBe(1);
    expect(second.ok && second.response.updated).toBe(1);
    expect(repo.dashboardSummary("demo")?.totals.messages).toBe(1);
    expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(150);
    expect(repo.dashboardSummary("demo")?.totals.costUsd).toBe(0.01);
  });

  it("escapes formula-prefixed values in CSV exports", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          modelId: '=IMPORTXML("https://example.test")',
          providerId: "@provider",
          dedupKey: "codex:csv-formula",
        }),
      ],
      "csv-export",
    );

    const exported = repo.exportMetrics("demo", { format: "csv" });

    expect(exported?.body).toContain('\'=IMPORTXML(""https://example.test"")');
    expect(exported?.body).toContain("'@provider");
    expect(exported?.body).not.toContain(",=IMPORTXML");
    expect(exported?.body).not.toContain(",@provider");
  });

  it("creates encrypted vault exports and previews importability without mutating events", () => {
    const { repo, store, file } = createRepoWithStore();
    const auth = authorizeDevice(repo);
    const recoveryPassphrase = "portable-vault-passphrase";
    const secretPath = "C:/Users/alice/private-client/source";
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          workspaceLabel: "source",
          workspaceKeyHash: "sha256:private-workspace",
          sourceSessionId: "private-session-id",
          sourceMessageId: "private-message-id",
          dedupKey: "codex:vault-export-event",
        }),
      ],
      "vault-run",
    );

    const created = repo.createVaultExport("demo", {
      format: "toksync-vault-v1",
      includePublicCache: true,
      includeReceipts: true,
      includeContent: false,
      recoveryPassphrase,
    });

    expect(created).not.toBeNull();
    expect(created?.export.payloadDigest).toMatch(/^sha256:/);
    expect(created?.payload.format).toBe("toksync-vault-v1");
    expect(created?.payload.keyDerivation.params).toEqual({
      N: 65536,
      r: 8,
      p: 1,
    });
    const encrypted = JSON.stringify(created?.payload);
    expect(encrypted).not.toContain(secretPath);
    expect(encrypted).not.toContain("private-session-id");
    expect(encrypted).not.toContain("private-message-id");
    expect(repo.listVaultExports("demo")).toEqual([
      expect.objectContaining({
        id: created?.export.id,
        format: "toksync-vault-v1",
        eventCount: 1,
      }),
    ]);
    expect(
      repo.getVaultExport("demo", created?.export.id ?? "")?.payload,
    ).toEqual(created?.payload);
    expect(store.read().vaultExports).toHaveLength(1);
    const reloadedRepo = new TokSyncRepository(new FileTokSyncStore(file));
    expect(
      reloadedRepo.getVaultExport("demo", created?.export.id ?? "")?.payload,
    ).toEqual(created?.payload);

    const preview = repo.previewVaultImport(
      "demo",
      created?.payload,
      recoveryPassphrase,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("vault preview failed");
    expect(preview.response).toMatchObject({
      format: "toksync-vault-v1",
      eventCount: 1,
      importableEvents: 0,
      duplicateEvents: 1,
      deviceCount: 1,
      receiptCount: 1,
      sourceSummary: { codex: 1 },
    });
    expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(157);
    expect(store.read().vaultExports).toHaveLength(1);

    const target = createRepo();
    const targetPreview = target.previewVaultImport(
      "demo",
      created?.payload,
      recoveryPassphrase,
    );
    expect(targetPreview.ok).toBe(true);
    if (!targetPreview.ok) throw new Error("target preview failed");
    expect(targetPreview.response).toMatchObject({
      eventCount: 1,
      importableEvents: 1,
      duplicateEvents: 0,
    });
    const imported = target.importVault(
      "demo",
      created?.payload,
      recoveryPassphrase,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error("vault import failed");
    expect(imported.response).toMatchObject({
      eventCount: 1,
      importedEvents: 1,
      duplicateEvents: 0,
      sourceSummary: { codex: 1 },
    });
    expect(target.dashboardSummary("demo")?.totals.tokens).toBe(157);
  });

  it("creates an empty encrypted vault export for an authenticated user without prior metrics", () => {
    const repo = createRepo();

    const created = repo.createVaultExport("demo", {
      format: "toksync-vault-v1",
      includePublicCache: true,
      includeReceipts: true,
      includeContent: false,
      recoveryPassphrase: "portable-vault-passphrase",
    });

    expect(created).not.toBeNull();
    expect(created?.export.eventCount).toBe(0);
    expect(repo.listVaultExports("demo")).toHaveLength(1);
  });

  it("stores vault artifacts through a hosted artifact store and keeps the ledger durable", () => {
    const { store, file } = createRepoWithStore();
    const artifactDir = mkdtempSync(path.join(tmpdir(), "toksync-vault-"));
    const artifactStore = new FileVaultArtifactStore(artifactDir);
    const repo = new TokSyncRepository(store, undefined, artifactStore);
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 0.01, {
          dedupKey: "codex:hosted-vault-artifact",
        }),
      ],
      "hosted-vault-run",
    );

    const created = repo.createVaultExport("demo", {
      format: "toksync-vault-v1",
      includePublicCache: true,
      includeReceipts: true,
      includeContent: false,
      recoveryPassphrase: "portable-vault-passphrase",
    });
    const ledgerRecord = store.read().vaultExports[0];

    expect(ledgerRecord?.artifact).toBeUndefined();
    expect(ledgerRecord?.artifactStorageKey).toMatch(/^vault\/.+\/.+\.json$/);
    expect(
      repo.getVaultExport("demo", created?.export.id ?? "")?.payload,
    ).toEqual(created?.payload);
    if (!ledgerRecord?.artifactStorageKey) {
      throw new Error("missing hosted artifact storage key");
    }
    expect(
      existsSync(
        path.join(artifactDir, ...ledgerRecord.artifactStorageKey.split("/")),
      ),
    ).toBe(true);

    const reloadedRepo = new TokSyncRepository(
      new FileTokSyncStore(file),
      undefined,
      new FileVaultArtifactStore(artifactDir),
    );
    expect(
      reloadedRepo.getVaultExport("demo", created?.export.id ?? "")?.payload,
    ).toEqual(created?.payload);
  });

  it("maps vault ledger rows through the Postgres repository adapter", async () => {
    const db = new FakeVaultDb();
    const repo = new PostgresVaultExportRepository(db);
    const artifact = {
      format: "toksync-vault-v1" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-05-20T00:00:00.000Z",
      payloadDigest: "sha256:vault-digest",
      includes: {
        publicCache: true,
        receipts: true,
        includeContent: false,
      },
      keyDerivation: {
        algorithm: "scrypt" as const,
        salt: "salt",
        keyLength: 32 as const,
      },
      encryption: {
        algorithm: "aes-256-gcm" as const,
        iv: "iv",
        authTag: "tag",
        ciphertext: "ciphertext",
      },
    };
    const record: VaultExportRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      kind: "export",
      status: "completed",
      format: "toksync-vault-v1",
      includePublicCache: true,
      includeReceipts: true,
      includeContent: false,
      artifactDigest: artifact.payloadDigest,
      artifactByteSize: 512,
      artifactStorageKey: "vault/user/export.json",
      artifact,
      eventCount: 2,
      deviceCount: 1,
      sourceCount: 1,
      receiptCount: 1,
      createdAt: "2026-05-20T00:00:00.000Z",
      finishedAt: "2026-05-20T00:00:01.000Z",
    };

    await repo.insert(record);

    expect(db.rows[0]).toMatchObject({
      id: record.id,
      userId: record.userId,
      artifactStorageKey: "vault/user/export.json",
      artifact,
    });
    await expect(repo.listExports(record.userId)).resolves.toEqual([record]);
    await expect(repo.getExport(record.userId, record.id)).resolves.toEqual(
      record,
    );
  });

  it("writes and reads hosted vault artifacts through the Postgres adapter", async () => {
    const db = new FakeVaultDb();
    const artifactStore = new FakeVaultArtifactStore();
    const repo = new PostgresVaultExportRepository(db, artifactStore);
    const artifact = {
      format: "toksync-vault-v1" as const,
      schemaVersion: 1 as const,
      createdAt: "2026-05-20T00:00:00.000Z",
      payloadDigest: "sha256:hosted-vault-digest",
      includes: {
        publicCache: true,
        receipts: false,
        includeContent: false,
      },
      keyDerivation: {
        algorithm: "scrypt" as const,
        salt: "salt",
        keyLength: 32 as const,
      },
      encryption: {
        algorithm: "aes-256-gcm" as const,
        iv: "iv",
        authTag: "tag",
        ciphertext: "ciphertext",
      },
    };
    const record: VaultExportRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      kind: "export",
      status: "completed",
      format: "toksync-vault-v1",
      includePublicCache: true,
      includeReceipts: false,
      includeContent: false,
      eventCount: 0,
      deviceCount: 0,
      sourceCount: 0,
      receiptCount: 0,
      createdAt: "2026-05-20T00:00:00.000Z",
      finishedAt: "2026-05-20T00:00:00.000Z",
    };
    const artifactStorageKey = `vault/${record.userId}/${record.id}.json`;
    const artifactByteSize = Buffer.byteLength(JSON.stringify(artifact));

    await repo.insertExportWithArtifact(record, artifact);

    expect(db.rows[0]).toMatchObject({
      id: record.id,
      userId: record.userId,
      artifact: undefined,
      artifactDigest: artifact.payloadDigest,
      artifactStorageKey,
      artifactByteSize,
    });
    await expect(
      repo.getExportArtifact(record.userId, record.id),
    ).resolves.toEqual({
      export: {
        ...record,
        artifactDigest: artifact.payloadDigest,
        artifactStorageKey,
        artifactByteSize,
      },
      payload: artifact,
      payloadDigest: artifact.payloadDigest,
    });
  });

  it("rejects vault payloads that violate the metrics-only privacy guard", () => {
    const repo = createRepo();
    const recoveryPassphrase = "portable-vault-passphrase";
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(recoveryPassphrase, salt, 32);
    const snapshot = {
      format: "toksync-vault-v1",
      schemaVersion: 1,
      prompt: "should never import",
      metrics: {
        events: [
          usageEvent("device-1", "2026-02-03", 0.01, {
            dedupKey: "codex:malicious-vault",
          }),
        ],
      },
      devices: [{ id: "device-1", platform: "windows" }],
    };
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(snapshot), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const payloadDigest = `sha256:${createHash("sha256").update(ciphertext).digest("base64url")}`;
    const payload = {
      format: "toksync-vault-v1",
      schemaVersion: 1,
      createdAt: "2026-05-20T00:00:00.000Z",
      payloadDigest,
      includes: {
        publicCache: false,
        receipts: false,
        includeContent: false,
      },
      keyDerivation: {
        algorithm: "scrypt",
        salt: salt.toString("base64url"),
        keyLength: 32,
      },
      encryption: {
        algorithm: "aes-256-gcm",
        iv: iv.toString("base64url"),
        authTag: authTag.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      },
    };

    const result = repo.previewVaultImport("demo", payload, recoveryPassphrase);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("vault preview unexpectedly succeeded");
    expect(result.status).toBe(400);
    expect(result.response.error.code).toBe("privacy_violation");
  });

  it("rejects incompatible vault snapshot versions without mutating metrics", () => {
    const repo = createRepo();
    const recoveryPassphrase = "portable-vault-passphrase";
    const payload = encryptedVaultPayload(recoveryPassphrase, {
      format: "toksync-vault-v1",
      schemaVersion: 2,
      metrics: { events: [] },
      devices: [],
    });

    const result = repo.previewVaultImport("demo", payload, recoveryPassphrase);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("vault preview unexpectedly succeeded");
    expect(result.status).toBe(400);
    expect(result.response.error).toMatchObject({
      code: "invalid_payload",
      message: "Vault schema version is not supported",
    });
    expect(repo.dashboardSummary("demo")).toBeNull();
  });

  it("upserts a cost guardrail and keeps budget exceeded anomalies private", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [usageEvent(auth.deviceId, "2026-02-03", 6)],
      "cost-run",
    );

    const first = repo.upsertCostGuardrail("demo", {
      scope: "global",
      period: "daily",
      limitUsd: 5,
      enabled: true,
    });
    const second = repo.upsertCostGuardrail("demo", {
      scope: "global",
      period: "daily",
      limitUsd: 10,
      enabled: true,
    });
    const guardrails = repo.listCostGuardrails("demo");

    expect(first.rule.limitUsd).toBe(5);
    expect(first.anomalies).toEqual([
      expect.objectContaining({
        ruleId: first.rule.id,
        type: "budget_exceeded",
        severity: "critical",
        deltaUsd: 1,
      }),
    ]);
    expect(second.rule.id).toBe(first.rule.id);
    expect(guardrails?.rules).toHaveLength(1);
    expect(guardrails?.rules[0]).toMatchObject({
      id: first.rule.id,
      limitUsd: 10,
    });
    expect(guardrails?.anomalies).toEqual([]);
    expect(repo.getPublicStats("demo")).toBeNull();
  });

  it("creates an unknown pricing anomaly when guarded events have no cost", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [usageEvent(auth.deviceId, "2026-02-03", undefined)],
      "unknown-pricing-run",
    );

    const result = repo.upsertCostGuardrail("demo", {
      scope: "global",
      period: "daily",
      limitUsd: 50,
      enabled: true,
    });

    expect(result.anomalies).toEqual([
      expect.objectContaining({
        type: "unknown_pricing",
        severity: "warning",
        deltaUsd: undefined,
      }),
    ]);
    expect(result.anomalies[0]?.explanation).toContain("unknown pricing");
  });

  it("uses the latest scoped event date for source cost guardrail windows", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    ingestEvents(
      repo,
      auth,
      [
        usageEvent(auth.deviceId, "2026-02-03", 6, {
          dedupKey: "codex:scoped-budget",
          source: "codex",
          sourceMessageId: "codex-budget-day",
        }),
        usageEvent(auth.deviceId, "2026-02-04", 0.25, {
          dedupKey: "claude:later-unrelated",
          source: "claude",
          sourceSessionId: "claude-later-session",
          sourceMessageId: "claude-later-message",
        }),
      ],
      "scoped-cost-run",
    );

    const result = repo.upsertCostGuardrail("demo", {
      scope: "source",
      source: "codex",
      period: "daily",
      limitUsd: 5,
      enabled: true,
    });

    expect(result.anomalies).toContainEqual(
      expect.objectContaining({
        type: "budget_exceeded",
        periodStart: "2026-02-03",
        periodEnd: "2026-02-03",
        deltaUsd: 1,
      }),
    );
  });

  it("preserves cost anomaly timestamps across read refreshes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-04T00:00:00.000Z"));
      const repo = createRepo();
      const auth = authorizeDevice(repo);
      ingestEvents(
        repo,
        auth,
        [usageEvent(auth.deviceId, "2026-02-03", 6)],
        "stable-anomaly-run",
      );

      const first = repo.upsertCostGuardrail("demo", {
        scope: "global",
        period: "daily",
        limitUsd: 5,
        enabled: true,
      });
      const firstAnomaly = first.anomalies[0];
      expect(firstAnomaly).toBeDefined();

      vi.setSystemTime(new Date("2026-02-04T01:00:00.000Z"));
      const refreshed = repo.listCostGuardrails("demo");

      expect(refreshed?.anomalies[0]).toMatchObject({
        id: firstAnomaly?.id,
        createdAt: firstAnomaly?.createdAt,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects device cost guardrails for devices owned by another user", () => {
    const repo = createRepo();
    authorizeDevice(repo, "demo");
    const otherAuth = authorizeDevice(repo, "other");

    expect(() =>
      repo.upsertCostGuardrail("demo", {
        scope: "device",
        deviceId: otherAuth.deviceId,
        period: "daily",
        limitUsd: 5,
        enabled: true,
      }),
    ).toThrow("Guardrail device target was not found for this user");
  });

  it("creates a cost spike anomaly when daily spend jumps above baseline", () => {
    const repo = createRepo();
    const auth = authorizeDevice(repo);
    const baselineEvents = [
      usageEvent(auth.deviceId, "2026-02-01", 1, {
        sourceMessageId: "baseline-1",
        dedupKey: "codex:baseline-1",
      }),
      usageEvent(auth.deviceId, "2026-02-02", 1, {
        sourceMessageId: "baseline-2",
        dedupKey: "codex:baseline-2",
      }),
      usageEvent(auth.deviceId, "2026-02-03", 1, {
        sourceMessageId: "baseline-3",
        dedupKey: "codex:baseline-3",
      }),
      usageEvent(auth.deviceId, "2026-02-04", 1, {
        sourceMessageId: "baseline-4",
        dedupKey: "codex:baseline-4",
      }),
      usageEvent(auth.deviceId, "2026-02-05", 1, {
        sourceMessageId: "baseline-5",
        dedupKey: "codex:baseline-5",
      }),
      usageEvent(auth.deviceId, "2026-02-06", 1, {
        sourceMessageId: "baseline-6",
        dedupKey: "codex:baseline-6",
      }),
      usageEvent(auth.deviceId, "2026-02-07", 1, {
        sourceMessageId: "baseline-7",
        dedupKey: "codex:baseline-7",
      }),
      usageEvent(auth.deviceId, "2026-02-08", 3, {
        sourceMessageId: "spike-day",
        dedupKey: "codex:spike-day",
      }),
    ];
    ingestEvents(repo, auth, baselineEvents, "cost-spike-run");

    const result = repo.upsertCostGuardrail("demo", {
      scope: "global",
      period: "daily",
      limitUsd: 50,
      enabled: true,
    });

    expect(result.anomalies).toContainEqual(
      expect.objectContaining({
        type: "cost_spike",
        severity: "warning",
        periodStart: "2026-02-08",
        periodEnd: "2026-02-08",
        deltaUsd: 2,
      }),
    );
    expect(
      result.anomalies.find((anomaly) => anomaly.type === "cost_spike")
        ?.explanation,
    ).toContain("baseline");
  });
});

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function waitForFile(file: string) {
  const startedAt = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error(`Timed out waiting for ${file}`);
    }
    await delay(10);
  }
}

function encryptedVaultPayload(recoveryPassphrase: string, snapshot: unknown) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(recoveryPassphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    format: "toksync-vault-v1" as const,
    schemaVersion: 1 as const,
    createdAt: "2026-05-21T00:00:00.000Z",
    payloadDigest: `sha256:${createHash("sha256").update(ciphertext).digest("base64url")}`,
    includes: {
      publicCache: false,
      receipts: false,
      includeContent: false,
    },
    keyDerivation: {
      algorithm: "scrypt" as const,
      salt: salt.toString("base64url"),
      keyLength: 32 as const,
    },
    encryption: {
      algorithm: "aes-256-gcm" as const,
      iv: iv.toString("base64url"),
      authTag: authTag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    },
  };
}
