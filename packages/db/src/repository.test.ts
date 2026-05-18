import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileTokSyncStore } from "./store";
import { TokSyncRepository } from "./repository";

function createRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
  return new TokSyncRepository(new FileTokSyncStore(path.join(dir, "db.json")));
}

function authorizeDevice(repo: TokSyncRepository, username = "demo") {
  const started = repo.createDeviceCode({
    deviceName: "Test device",
    platform: "windows",
    agentVersion: "0.1.0",
    deviceFingerprint: `${username}-fingerprint`,
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
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    });
    expect(() => secondStore.write(secondData)).toThrow(/changed on disk/);
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

    repo.deleteDeviceData("demo", auth.deviceId);
    expect(repo.dashboardSummary("demo")?.totals.tokens).toBe(0);
    expect(repo.getPublicStats("demo")?.totalTokens).toBe(0);
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
