import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokSyncRepository } from "./repository";
import { FileTokSyncStore } from "./store";

describe("user API token device revocation", () => {
  let directory: string;
  let file: string;
  let repo: TokSyncRepository;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "toksync-revoked-writers-"));
    file = path.join(directory, "db.json");
    repo = new TokSyncRepository(new FileTokSyncStore(file));
  });

  afterEach(() => {
    if (
      path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) &&
      path.basename(directory).startsWith("toksync-revoked-writers-")
    ) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps active headless ingestion and replay working", () => {
    const { token } = repo.createUserApiToken("alice", {
      name: "CI token",
      scopes: ["usage:write"],
    });
    const batch = usageBatch();

    expect(repo.ingestUsageBatch(token, batch)).toMatchObject({
      ok: true,
      response: { inserted: 1 },
    });
    expect(repo.ingestUsageBatch(token, batch)).toMatchObject({
      ok: true,
      response: { inserted: 0, skipped: 1 },
    });
    expect(repo.dashboardSummary("alice")?.totals.tokens).toBe(140);
  });

  it.each(["original", "fresh", "revoked"] as const)(
    "rejects the %s user API token for a revoked device without changing stored data",
    (tokenState) => {
      const original = repo.createUserApiToken("alice", {
        name: "CI token",
        scopes: ["usage:write"],
      });
      repo.setPublicProfile("alice", {
        enabled: true,
        showCost: true,
        showSourceBreakdown: true,
        showModelBreakdown: true,
        showWorkspaceBreakdown: false,
      });
      expect(repo.ingestUsageBatch(original.token, usageBatch())).toMatchObject(
        {
          ok: true,
          response: { inserted: 1 },
        },
      );
      expect(repo.revokeDevice("alice", "ci-runner")).toEqual({
        status: "revoked",
      });
      let token = original.token;
      if (tokenState === "fresh") {
        token = repo.createUserApiToken("alice", {
          name: "Replacement CI token",
          scopes: ["usage:write"],
        }).token;
      } else if (tokenState === "revoked") {
        repo.revokeUserApiToken("alice", original.metadata.id);
      }
      const before = readFileSync(file, "utf8");
      const batch = usageBatch("after-revoke");
      batch.device.name = "Changed device name";
      batch.device.agentVersion = "9.9.9";

      expect(repo.ingestUsageBatch(token, batch)).toMatchObject({
        ok: false,
        status: 401,
        response: { error: { code: "invalid_auth" } },
      });
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(repo.dashboardSummary("alice")?.totals.tokens).toBe(140);
      expect(repo.getPublicStats("alice")?.totalTokens).toBe(140);
    },
  );
});

function usageBatch(runId = "initial-run") {
  return {
    schemaVersion: 1,
    runId,
    device: {
      id: "ci-runner",
      name: "CI runner",
      platform: "linux",
      agentVersion: "0.1.0",
    },
    mode: "sync",
    sourceVersions: { codex: null },
    events: [
      {
        schemaVersion: 1,
        source: "codex",
        sourceSessionId: "ci-session",
        sourceMessageId: runId,
        dedupKey: `codex:ci-session:${runId}`,
        deviceId: "ci-runner",
        modelId: "gpt-5.4",
        timestampMs: Date.parse("2026-02-03T12:00:00.000Z"),
        localDate: "2026-02-03",
        tokens: {
          input: 100,
          output: 40,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
        costUsd: 0.01,
        messageCount: 1,
        isTurnStart: true,
      },
    ],
  };
}
