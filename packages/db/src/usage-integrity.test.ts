import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokSyncRepository } from "./repository";
import { FileTokSyncStore } from "./store";

describe("usage batch integrity", () => {
  let directory: string;
  let repo: TokSyncRepository;
  let token: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "toksync-usage-integrity-"));
    repo = new TokSyncRepository(
      new FileTokSyncStore(path.join(directory, "db.json")),
    );
    token = repo.createUserApiToken("alice", {
      name: "CI token",
      scopes: ["usage:write"],
    }).token;
  });

  afterEach(() => {
    if (
      path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) &&
      path.basename(directory).startsWith("toksync-usage-integrity-")
    ) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["oversized token count", { tokens: { ...tokens(), input: 9e15 } }],
    ["oversized cost", { costUsd: 1e300 }],
    ["impossible calendar date", { localDate: "2026-13-45" }],
    [
      "local date years away from the timestamp",
      {
        timestampMs: Date.parse("2020-01-01T12:00:00.000Z"),
        localDate: "2026-02-03",
      },
    ],
    [
      "timestamp far in the future",
      {
        timestampMs: Date.now() + 3 * 24 * 60 * 60 * 1000,
        localDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      },
    ],
  ])("rejects an event with %s without changing aggregates", (_, override) => {
    ingest([event("baseline")]);

    const result = ingest([event("bad", override)], "bad-run");

    expect(result).toMatchObject({
      status: "rejected",
      inserted: 0,
      errors: [{ index: 0, code: "invalid_event" }],
    });
    expect(repo.dashboardSummary("alice")?.totals.tokens).toBe(140);
  });

  it("accepts a local date one day away from the UTC timestamp date", () => {
    expect(
      ingest([
        event("tokyo-morning", {
          timestampMs: Date.parse("2026-02-02T23:30:00.000Z"),
          localDate: "2026-02-03",
        }),
      ]),
    ).toMatchObject({ status: "accepted", inserted: 1 });
  });

  it("counts Claude transcript lines of one message once", () => {
    const lines = [0, 1, 2].map((offset) =>
      event(`line-${offset}`, {
        source: "claude",
        sourceSessionId: "claude-session",
        sourceMessageId: "req_1",
        timestampMs: Date.parse("2026-02-03T12:00:00.000Z") + offset * 1000,
        modelId: "claude-sonnet-4-6",
      }),
    );

    // Older agents uploaded every line with its own dedup key.
    expect(ingest(lines)).toMatchObject({ inserted: 1, updated: 2 });
    expect(repo.dashboardSummary("alice")?.totals).toMatchObject({
      tokens: 140,
      messages: 1,
    });

    // Current agents send one message-scoped event, which matches it.
    expect(
      ingest(
        [
          event("message-scoped", {
            source: "claude",
            sourceSessionId: "claude-session",
            sourceMessageId: "req_1",
            modelId: "claude-sonnet-4-6",
          }),
        ],
        "current-agent",
      ),
    ).toMatchObject({ inserted: 0 });
    expect(repo.dashboardSummary("alice")?.totals.tokens).toBe(140);
  });

  it("keeps distinct Claude messages separate", () => {
    expect(
      ingest(
        ["req_1", "req_2"].map((sourceMessageId) =>
          event(sourceMessageId, {
            source: "claude",
            sourceSessionId: "claude-session",
            sourceMessageId,
            modelId: "claude-sonnet-4-6",
          }),
        ),
      ),
    ).toMatchObject({ inserted: 2 });
    expect(repo.dashboardSummary("alice")?.totals.tokens).toBe(280);
  });

  function ingest(events: unknown[], runId = "run-1") {
    const result = repo.ingestUsageBatch(token, {
      schemaVersion: 1,
      runId,
      device: {
        id: "ci-runner",
        name: "CI runner",
        platform: "linux",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      sourceVersions: {},
      events,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("ingest failed");
    return result.response;
  }
});

function tokens() {
  return { input: 100, output: 40, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: "codex",
    sourceSessionId: "ci-session",
    sourceMessageId: id,
    dedupKey: `${String(overrides.source ?? "codex")}:${id}`,
    deviceId: "ci-runner",
    modelId: "gpt-5.4",
    timestampMs: Date.parse("2026-02-03T12:00:00.000Z"),
    localDate: "2026-02-03",
    tokens: tokens(),
    costUsd: 0.01,
    messageCount: 1,
    isTurnStart: true,
    ...overrides,
  };
}
