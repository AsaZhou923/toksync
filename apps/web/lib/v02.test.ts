import { describe, expect, it } from "vitest";
import {
  buildPrivacyReceipt,
  buildPublicGraph,
  buildSourceHealthRows,
  toDailyCsv,
  type DashboardSummary,
  type SyncRun,
} from "./v02";

const summary: DashboardSummary = {
  totals: {
    tokens: 157,
    costUsd: 0.01,
    activeDays: 1,
    messages: 1,
    turns: 1,
  },
  lastSyncAt: "2026-05-17T00:00:00.000Z",
  topSources: [{ key: "codex", tokens: 157, costUsd: 0.01, messages: 1 }],
};

const run: SyncRun = {
  id: "run-1",
  clientRunId: "client-run-1",
  mode: "sync",
  status: "completed",
  sourceSummary: { codex: 1 },
  insertedCount: 1,
  updatedCount: 0,
  skippedCount: 1,
  errorCount: 0,
  startedAt: "2026-05-17T00:00:00.000Z",
  finishedAt: "2026-05-17T00:01:00.000Z",
};

describe("v0.2 web helpers", () => {
  it("marks the latest source as healthy and untouched sources as idle/watch", () => {
    const rows = buildSourceHealthRows({ summary, latestRun: run });
    expect(rows.find((row) => row.id === "codex")?.status).toBe("healthy");
    expect(rows.find((row) => row.id === "claude")?.status).toBe("idle");
  });

  it("builds a deterministic privacy receipt digest", () => {
    const first = buildPrivacyReceipt({ summary, latestRun: run });
    const second = buildPrivacyReceipt({ summary, latestRun: run });
    expect(first.digest).toBe(second.digest);
    expect(first.uploadedFields).toContain("events[].tokens");
    expect(first.excludedFields).toContain("conversation content");
    expect(JSON.stringify(first)).not.toContain("sourceSessionId");
  });

  it("falls back to a derived public graph when daily points are missing", () => {
    const graph = buildPublicGraph({ totalTokens: 500, activeDays: 8 });
    expect(graph.mode).toBe("derived");
    expect(graph.points).toHaveLength(28);
    expect(graph.points.some((point) => point.level > 0)).toBe(true);
  });

  it("serializes aggregate-only CSV rows", () => {
    const csv = toDailyCsv([
      {
        date: "2026-05-17",
        tokens: 157,
        costUsd: 0.01,
        sourceBreakdown: {
          codex: { tokens: 157, costUsd: 0.01 },
        },
      },
    ]);

    expect(csv).toContain("date,tokens,costUsd,sourceCount,sources");
    expect(csv).toContain("2026-05-17,157,0.01,1,codex:157");
  });
});
