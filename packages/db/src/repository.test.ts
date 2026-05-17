import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokSyncStore } from "./store";
import { TokSyncRepository } from "./repository";

function createRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-db-"));
  return new TokSyncRepository(new FileTokSyncStore(path.join(dir, "db.json")));
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
});

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
