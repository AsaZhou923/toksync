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
});
